---
title: 'Real-time: polling, SSE, WebSocket'
level: ядро
---

# Real-time: polling, SSE, WebSocket

> **Коротко.** Сервер не может сам начать HTTP-ответ, поэтому «пуш» в браузер делают одним из четырёх способов. **Polling** — регулярные запросы. **Long polling** — запрос, который висит, пока не появятся данные. **SSE** (`EventSource`) — один долгий HTTP-ответ, текстовый поток событий от сервера к клиенту со встроенным переподключением и `Last-Event-ID`. **WebSocket** — после HTTP-handshake отдельный двунаправленный протокол поверх TCP: кадры, текст и бинарные данные, но переподключение, heartbeat и доставку пишете сами. **WebTransport** — HTTP/3 с потоками и датаграммами, теперь во всех трёх движках. Выбор определяют направление данных, частота, требования к доставке и инфраструктура.

**Связанные темы:** [HTTP: методы, статусы, заголовки, версии](./http.md), [Same-origin policy, CORS и cookies](./cors-and-cookies.md), [Хранилища браузера](./browser-storage.md), [Web Workers, Service Workers и PWA](../browser/workers.md), [async/await, обработка ошибок и отмена](../javascript/async-await.md), [Event loop](../javascript/event-loop.md)

## Теория

### Карта механизмов

| | Polling | Long polling | SSE | WebSocket | WebTransport |
| --- | --- | --- | --- | --- | --- |
| Направление | клиент спрашивает | клиент спрашивает, сервер отвечает, когда есть что | сервер → клиент | в обе стороны | в обе стороны |
| Транспорт | обычные HTTP-запросы | HTTP-запрос с долгим ответом | один долгий HTTP-ответ | HTTP-handshake, затем свой протокол на TCP | HTTP/3 (QUIC) |
| Данные | любые | любые | текст UTF-8 | текст и бинарные | потоки и датаграммы, бинарные |
| Переподключение | не нужно | цикл в коде | встроено, с `Last-Event-ID` | вручную | вручную |
| Задержка | до интервала | ≈ RTT | ≈ RTT | ≈ RTT | ≈ RTT, без head-of-line между потоками |
| Инфраструктура | любая | таймауты прокси | HTTP-прокси и CDN с отключённой буферизацией | Upgrade через балансировщик, sticky-соединения | HTTP/3 и UDP по всей цепочке |

### Polling и long polling

**Short polling** — `setInterval(() => fetch('/updates'))`. Это просто, работает с любым кэшем и балансировщиком, сервер stateless. Цена — задержка до интервала и пустые запросы: 10 000 клиентов с опросом раз в 5 секунд дают 2 000 RPS, даже когда ничего не меняется. Годится для редких изменений (статус заказа, сборки) и как запасной вариант. Опрос стоит ставить на паузу в скрытой вкладке (`document.visibilityState`) и прибавлять к интервалу случайный разброс, чтобы клиенты не били в сервер синхронно.

**Long polling** — клиент отправляет запрос, сервер держит его открытым, пока не появятся данные или не истечёт таймаут (обычно 20–30 секунд, меньше таймаута прокси), затем клиент сразу отправляет следующий. Задержка ≈ RTT, но событие, случившееся, пока клиент переотправляет запрос, теряется, если сервер не знает, что клиент уже видел. Поэтому запрос несёт курсор (`?after=<lastId>`), а сервер отдаёт всё, что новее. При частых событиях каждый ответ — новый запрос со всеми заголовками и cookies, и long polling дороже SSE. Каждый висящий запрос занимает одно из шести соединений HTTP/1.1 к хосту (см. ниже). Long polling исторически был запасным транспортом Socket.IO и Bayeux, а сегодня остаётся вариантом, когда сеть режет и Upgrade, и долгие потоки.

### Server-Sent Events: формат

SSE описан в HTML Living Standard. Сервер отвечает `200` с `Content-Type: text/event-stream` и не закрывает ответ. Поток — строки UTF-8 (BOM в начале отбрасывается), события разделены пустой строкой:

```
retry: 5000
id: 42
event: price
data: {"ticker":"ACME","value":101.5}

: heartbeat comment, ignored by the client

data: first line
data: second line

```

- `data:` — строка данных; несколько `data:` склеиваются через `\n`. Блок с `data` без значения даёт событие с пустой строкой.
- `event:` — тип; по умолчанию `message`. Событие с другим типом получает только `addEventListener('<type>')`, `onmessage` его не видит.
- `id:` — **last event ID**. Он не сбрасывается между событиями и уходит на сервер при переподключении. Пустой `id` сбрасывает его.
- `retry:` — задержка переподключения в миллисекундах (только цифры, иначе строка игнорируется).
- строка, начинающаяся с `:`, — комментарий. Спецификация советует слать его примерно раз в 15 секунд, чтобы прокси не закрывали «молчащее» соединение.
- Блок без завершающей пустой строки в конце потока отбрасывается. Блок без `data` (только `event:`) события не порождает. Всё перечисленное, включая BOM и CRLF как разделитель, проверено в Chromium 157.

### `EventSource`: переподключение и его пределы

`new EventSource(url, { withCredentials })` делает `GET` с `Accept: text/event-stream`. Состояния: `CONNECTING` (0), `OPEN` (1), `CLOSED` (2). Спецификация делит неудачи на два вида:

- **переподключиться** — сетевая ошибка или нормальное завершение потока сервером. Браузер шлёт `error` с `readyState === CONNECTING`, ждёт reconnection time и повторяет запрос с заголовком `Last-Event-ID`;
- **провалить соединение** — ответ не `200` (в том числе `204`, `500`, `401`) или неверный `Content-Type`. Тогда `error` с `readyState === CLOSED`, и браузер больше не пытается.

Начальная задержка, по спецификации, — «implementation-defined, вероятно, несколько секунд». Проверено в Chromium 157: поток, закрытый сервером, переоткрывается через ≈3,1 с; после `retry: 300` — через ≈0,4 с; при обрыве TCP — тоже через ≈3 с с `Last-Event-ID`. Ответы `204`, `500` и `text/plain` дали одну ошибку, состояние `CLOSED` и ни одного повторного запроса за 5 секунд. Значит, `204` — штатный способ сказать клиенту «больше не приходи», а `500` при падении бэкенда **навсегда** останавливает `EventSource`. Повтор после `CLOSED` — забота приложения.

Ограничения API: нельзя задать заголовки (`Authorization`) и метод — только `GET`, только cookies (`withCredentials` для cross-origin с CORS) или токен в URL, который осядет в логах; только текст (бинарные данные — через base64); нет экспоненциальной задержки — постоянный `retry`, и тысячи клиентов вернутся одновременно. Стриминг ответов LLM (`POST` с телом, `Authorization`) поэтому читают через `fetch` + `response.body.pipeThrough(new TextDecoderStream())` и разбирают формат `text/event-stream` вручную. Цена — переподключение и `Last-Event-ID` тоже пишутся вручную.

### Лимит соединений HTTP/1.1

Браузеры держат не больше шести соединений HTTP/1.1 к одному хосту на весь профиль, а не на вкладку (см. [HTTP](./http.md#http-1-1-текст-и-очередь)). Каждый `EventSource` и висящий long-poll занимает одно. Проверено в Chromium 157 на HTTP/1.1: шесть открытых `EventSource` к одному origin — и обычный `fetch` к тому же origin висит, пока не сработает таймаут (3 с), седьмой `EventSource` остаётся в `CONNECTING`, пока не закроют один из шести. Запросы к другому порту (другой хост:порт) проходят. Шесть вкладок с лентой уведомлений — и приложение «зависает» целиком.

Решения: HTTP/2 или HTTP/3, где все потоки мультиплексируются в одно соединение (проверено в Chromium 157 на HTTP/2: десять `EventSource` открыты, `fetch` — 5 мс); одно соединение на все вкладки через `SharedWorker` или вкладку-лидера с `BroadcastChannel` (см. [Хранилища браузера](./browser-storage.md#событие-storage-и-синхронизация-вкладок)); отдельный поддомен для потока.

> [!WARNING]
> SSE ломают буферизующие посредники: сжатие, которое ждёт полный ответ, и прокси с буферизацией. nginx буферизует ответ upstream, пока ему не скажут `X-Accel-Buffering: no` (или `proxy_buffering off`). Симптом — события приходят пачками раз в несколько секунд или только при закрытии потока. Service Worker, который проксирует `fetch` всех запросов, тоже должен пропускать `text/event-stream` без чтения тела целиком.

### WebSocket: handshake и кадры

WebSocket определён RFC 6455 (протокол) и WHATWG WebSockets Standard (API). В HTTP/1.1 соединение начинается с обычного `GET`:

```
GET /ws HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Origin: https://app.example.com
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: D+C8xz8wvOAm3H0uZeG3AQ==
Sec-WebSocket-Protocol: chat.v1, chat.v0
Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits
```

Сервер отвечает `101 Switching Protocols` и `Sec-WebSocket-Accept: base64(SHA-1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))`. Это не аутентификация, а доказательство, что сервер понимает WebSocket, а не случайно отразил запрос. Неверный `Accept`, ответ `403` или отсутствие выбранного подпротокола — браузер отвергает соединение: `error`, затем `close` с кодом `1006` (проверено в Chromium 157). Причину отказа JavaScript не узнаёт: статус и тело ответа недоступны, чтобы страница не могла так сканировать чужие серверы.

Дальше TCP-соединение принадлежит протоколу WebSocket. Данные идут **кадрами**: `FIN`-бит, opcode (`0x1` текст, `0x2` бинарные, `0x0` продолжение, `0x8` close, `0x9` ping, `0xA` pong), длина и payload. Сообщение может быть разбито на несколько кадров: в Chromium 157 бинарное сообщение в 32 МБ ушло кадрами по 131 000 байт. Управляющие кадры — не больше 125 байт, поэтому `reason` в `close()` ограничен 123 байтами UTF-8.

**Маскирование.** Каждый кадр клиент → сервер маскируется случайным 32-битным ключом (XOR), кадры сервер → клиент — нет. Это не шифрование, ключ лежит рядом. Маска не даёт скрипту на странице управлять байтами на проводе и подсунуть промежуточному прокси, не знающему WebSocket, нечто похожее на HTTP-запрос — атака на отравление кэша прокси. Шифрование даёт только `wss://` (TLS). WebSocket вне HTTP-семантики: нет кэширования, статусов, CORS, заголовков у сообщений. RFC 8441 (HTTP/2) и RFC 9220 (HTTP/3) описывают WebSocket поверх одного потока через extended `CONNECT`, но для приложения это та же модель.

### WebSocket API и закрытие

`new WebSocket(url, protocols)` открывает соединение сразу; `binaryType` — `'blob'` по умолчанию или `'arraybuffer'`. Проверено в Chromium 157:
- `send()` до `open` бросает `InvalidStateError` — очередь до открытия пишут сами;
- `ws.protocol` — выбранный сервером подпротокол, `ws.extensions` — согласованные расширения;
- `close()` принимает только `1000` или `3000–4999`: `close(1001)` → `InvalidAccessError`, `reason` длиннее 123 байт → `SyntaxError`;
- ping от сервера браузер сам отвечает pong, JavaScript его не видит и не может отправить свой ping;
- после `send()` 32 МБ `bufferedAmount` сразу 33 554 432 — данные приняты в очередь, а не отправлены.

**Закрытие** — тоже handshake: сторона шлёт кадр close с кодом, другая отвечает своим, затем закрывается TCP. Событие `close` несёт `code`, `reason` и `wasClean`. Коды (RFC 6455): `1000` — нормально, `1001` — уход (вкладка закрывается, сервер перезапускается), `1008` — нарушение политики, `1009` — слишком большое сообщение, `1011` — ошибка сервера, `4000–4999` — свои коды приложения. `1006` по сети не передаётся никогда: браузер подставляет его сам, когда close-кадра не было. Проверено в Chromium 157: сервер закрыл кодом `4001` и причиной `expired` → `close 4001 "expired" wasClean=true`; сервер оборвал TCP после `open` → только `close 1006 wasClean=false`, **без** события `error`. `error` приходит, когда соединение провалено (handshake отвергнут, нарушение протокола), — поэтому логику переподключения вешают на `close`, а не на `error`.

### Heartbeat и полуоткрытые соединения

TCP не сообщает об обрыве, которого не видно: телефон ушёл из Wi-Fi, NAT забыл соединение, сервер завис. Проверено в Chromium 157: сервер принял соединение и замолчал — через 5 секунд `readyState` всё ещё `OPEN`, а пользователь видит «онлайн».

Поэтому нужен **heartbeat на уровне приложения**: клиент раз в N секунд шлёт `{"type":"ping"}`, сервер отвечает `pong`. Если ответа нет за таймаут, клиент сразу открывает новое соединение, а не ждёт `close` от старого: проверено в Chromium 157, после `close()` на сервере, который не отвечает close-кадром, событие `close` (`1006`) пришло только через 60 секунд. Серверный ping (протокольный, `0x9`) помогает серверу чистить мёртвых клиентов, но клиент о нём не знает. Интервал выбирают меньше idle-таймаута балансировщиков (у многих он 60 секунд), обычно 20–30 секунд. Дополнительный сигнал — события `online`/`offline` и `visibilitychange`: после возвращения сети или вкладки стоит проверить соединение сразу, не дожидаясь таймера.

> [!NOTE]
> `WebSocketStream` — API на потоках с встроенным backpressure: `const { readable, writable } = await new WebSocketStream(url).opened`. По MDN BCD (сверено 2026-11-12) есть только в Chromium (с 124), в Firefox и Safari нет. В классическом `WebSocket` backpressure есть только для отправки, и то вручную через `bufferedAmount`: входящие сообщения прилетают событиями, сколько бы их ни было.

### Переподключение, порядок и доставка

TCP гарантирует порядок и отсутствие потерь **внутри одного соединения**. Между переподключениями гарантий нет: сообщения, отправленные сервером, пока клиент переподключался, потеряны; сообщения клиента в `bufferedAmount` в момент обрыва — неизвестно, дошли ли.

- **Backoff с jitter.** Задержка растёт экспоненциально (`base * 2^attempt`, с потолком), а фактическая — случайная от нуля до неё («full jitter»). Без разброса после деплоя или сбоя все клиенты возвращаются одновременно, и сервер падает снова (thundering herd). После успешного соединения счётчик сбрасывают, лучше — после того, как соединение прожило несколько секунд.
- **Resume.** Сервер нумерует события (`seq`), клиент помнит последний полученный и после переподключения просит «всё после `seq`» — как `Last-Event-ID` в SSE. Если буфер на сервере уже не хранит нужное, клиент перезагружает состояние целиком (REST-снимок плюс подписка).
- **At-least-once и идемпотентность.** Клиент держит неподтверждённые сообщения в outbox и переотправляет их после переподключения с тем же `clientId`. Сервер подтверждает (`ack`) и отбрасывает дубли по ключу. Получатель тоже дедуплицирует по `id`. «Exactly once» на практике — at-least-once плюс идемпотентность.
- **Порядок** между разными соединениями и устройствами задаёт сервер (номер в комнате или логическое время), а не время клиента.

### WebTransport

WebTransport (W3C, протокол — IETF WebTransport over HTTP/3) даёт поверх одного QUIC-соединения: несколько надёжных потоков (однонаправленных и двунаправленных) без head-of-line blocking между ними и **ненадёжные датаграммы**, которые не переотправляются — для игр, позиций курсоров, медиа, где старое значение уже не нужно. API построен на Streams, backpressure встроен. По MDN BCD (сверено 2026-11-12): Chrome 97, Firefox 114, Safari 26.4. Препятствия на практике: нужен HTTP/3-сервер с поддержкой WebTransport, UDP режут корпоративные сети (запасной транспорт обязателен), серверная экосистема моложе WebSocket.

### Как выбрать

| Задача | Выбор | Почему |
| --- | --- | --- |
| Статус заказа, сборки, раз в минуты | polling | редко, просто, кэшируется |
| Уведомления, лента, прогресс задачи | SSE | только сервер → клиент; переподключение и `Last-Event-ID` бесплатно; обычный HTTP |
| Стриминг ответа LLM | `fetch` + разбор `text/event-stream` | нужен `POST` с телом и заголовки |
| Котировки | SSE или WebSocket | часто и односторонне; при подписке на тикеры с клиента — WebSocket |
| Чат, совместное редактирование, игры | WebSocket | частые сообщения в обе стороны, бинарные данные |
| Позиции в реальном времени, медиа | WebTransport (датаграммы) с запасным WebSocket | потеря старого значения лучше задержки |
| Корпоративная сеть режет Upgrade и потоки | long polling | работает везде |

Отправка с клиента не требует WebSocket: SSE для пуша плюс обычные `POST` для действий — частая и здоровая архитектура, особенно когда действия редки и им нужны HTTP-семантика, авторизация и ретраи.

### Сервер и масштабирование

Мостик в «Архитектуру и System Design». Каждое постоянное соединение — открытый сокет и память на сервере; ёмкость считают в соединениях, а не в RPS. **Fan-out:** участники комнаты сидят на разных инстансах, и сообщение доходит до всех через pub/sub-шину (Redis, NATS, Kafka) — без неё чат «работает на деве» и ломается на двух репликах. **Балансировка:** WebSocket привязан к инстансу на всё время жизни; балансировщик должен пропускать Upgrade и иметь idle-таймаут больше интервала heartbeat. **Деплой** рвёт все соединения разом: сервер закрывает с `1001`, клиенты возвращаются с jitter, и сервер должен выдержать пик handshake'ов и resume. **Авторизация** проверяется при handshake и периодически: токен истёк — сервер закрывает своим кодом (`4001`), клиент обновляет токен и переподключается. Если нужен только пуш, SSE через обычный HTTP масштабируется проще.

### Безопасность WebSocket

На WebSocket не распространяется CORS: браузер шлёт `Origin`, но открывает соединение с любым сервером. Проверено в Chromium 157: страница `http://127.0.0.1:8081` открыла соединение на `127.0.0.1:8082`, и в handshake ушла cookie хоста. Если сервер аутентифицирует по cookie и не проверяет `Origin`, чужой сайт откроет соединение от имени пользователя — **Cross-Site WebSocket Hijacking**. Защита: белый список `Origin` при handshake, cookies с `SameSite=Lax`/`Strict` (cross-site WebSocket — подзапрос, такие cookie не уйдут), короткоживущий одноразовый тикет вместо долгого токена в URL. `wss://` обязателен: часть прокси ломает незашифрованный WebSocket, а маскирование — не шифрование.

### Vue и Nuxt

- **Только на клиенте.** Соединение открывают в `onMounted` (или под `import.meta.client`), а закрывают в `onScopeDispose`/`onBeforeUnmount`. При SSR `setup` выполняется на сервере, и соединение, открытое там, протекло бы на каждый запрос.
- **Одно соединение на приложение.** Composable, который открывает сокет в каждом компоненте, умножает соединения. Соединение выносят в модуль или Pinia-стор, а компоненты подписываются на него.
- **Поток данных в реактивность.** Сотни сообщений в секунду в `reactive`-массив — сотни циклов рендера и глубокие прокси. Буферизуйте и применяйте пачкой раз в кадр, храните большие списки в `shallowRef` и заменяйте целиком.
- **Сервер в Nuxt 4.** Nitro 2.13 поддерживает SSE через `createEventStream` из h3 и WebSocket через crossws (`defineWebSocketHandler` с хуками `upgrade`, `open`, `message`, `close`, `error`, pub/sub через `peer.subscribe`/`peer.publish`). WebSocket в Nitro экспериментальный и включается `nitro.experimental.websocket: true`; встроенный pub/sub живёт в памяти одного инстанса.

## Примеры

```ts
// Nuxt 4 (Nitro 2.13): server/routes/notifications.ts — SSE endpoint.
export default defineEventHandler(async (event) => {
  const stream = createEventStream(event);
  const unsubscribe = notifications.subscribe(async (n) => {
    await stream.push({ id: String(n.seq), event: 'notification', data: JSON.stringify(n) });
  });
  // h3 1.x has no comment API: a typed event no client listens to keeps proxies busy.
  const heartbeat = setInterval(() => stream.push({ event: 'heartbeat', data: '' }), 15_000);
  stream.onClosed(async () => {
    clearInterval(heartbeat);
    unsubscribe();
    await stream.close();
  });
  return stream.send();
});
```

```ts
// nuxt.config.ts: nitro: { experimental: { websocket: true } }
// server/routes/_ws.ts — rooms with an Origin check during the upgrade.
const ALLOWED = new Set(['https://app.example.com']);

export default defineWebSocketHandler({
  upgrade(request) {
    if (!ALLOWED.has(request.headers.get('origin') ?? '')) {
      return new Response('Forbidden', { status: 403 }); // the browser only sees code 1006
    }
  },
  open(peer) {
    peer.subscribe('room:general');
  },
  message(peer, message) {
    const msg = message.json<{ type: string; text?: string }>();
    if (msg.type === 'ping') return peer.send(JSON.stringify({ type: 'pong' }));
    peer.publish('room:general', JSON.stringify({ type: 'chat', text: msg.text })); // sender excluded
  },
});
```

## Вопросы с интервью

::: details Чем отличаются polling, long polling, SSE и WebSocket и как выбрать
Polling — регулярные запросы: просто и кэшируемо, но задержка до интервала и пустые запросы. Long polling — сервер держит запрос до появления данных: задержка ≈ RTT, но каждый ответ — новый запрос, а между запросами нужен курсор, чтобы не терять события. SSE — один долгий HTTP-ответ, только сервер → клиент, текст, встроенное переподключение с `Last-Event-ID`, работает через обычную HTTP-инфраструктуру. WebSocket — отдельный двунаправленный протокол после `101`, текст и бинарные данные, но переподключение, heartbeat, resume и доставку пишет приложение. Выбор: уведомления и ленты — SSE; чат, совместное редактирование, игры — WebSocket; редкие изменения — polling; сети, режущие Upgrade, — long polling. Пуш через SSE плюс `POST` для действий часто проще WebSocket.
:::

::: details Как EventSource переподключается и когда перестаёт
Если поток оборвался по сети или сервер его завершил, браузер шлёт `error` с `readyState === CONNECTING`, ждёт reconnection time (в Chromium ≈3 с, сервер меняет его полем `retry:`) и повторяет `GET` с заголовком `Last-Event-ID` — последним `id`, который видел клиент. Сервер по нему досылает пропущенное. Если ответ не `200` (включая `204` и `500`) или `Content-Type` не `text/event-stream`, соединение проваливается: `readyState === CLOSED`, повторов больше нет. `204` — штатный «стоп», а падение бэкенда с `500` останавливает клиента навсегда, поэтому приложение само пересоздаёт `EventSource` с backoff. Встроенная задержка постоянная, без jitter.
:::

::: details Почему приложение зависает, если открыть его в нескольких вкладках с SSE
По HTTP/1.1 браузер держит не больше шести соединений к одному хосту на весь профиль. Каждый открытый `EventSource` занимает одно навсегда. Шесть вкладок — и все остальные запросы к этому хосту, включая API и статику, стоят в очереди. Это проверяется: седьмой `EventSource` и обычный `fetch` висят, пока не закроют один из потоков. Решения: HTTP/2 или HTTP/3 (все потоки мультиплексируются в одно соединение), одно соединение на все вкладки через `SharedWorker` или вкладку-лидера с рассылкой через `BroadcastChannel`, отдельный поддомен для потоков.
:::

::: details Как устанавливается WebSocket-соединение и зачем маскирование
Клиент отправляет `GET` с `Upgrade: websocket`, `Connection: Upgrade`, `Sec-WebSocket-Version: 13`, случайным `Sec-WebSocket-Key`, `Origin` и при необходимости подпротоколами и расширениями. Сервер отвечает `101 Switching Protocols` и `Sec-WebSocket-Accept` — SHA-1 от ключа и фиксированного GUID в base64, доказательство, что он понимает протокол. Дальше по тому же TCP идут кадры: FIN, opcode (текст, бинарные, продолжение, close, ping, pong), длина, payload. Кадры клиента маскируются случайным ключом, чтобы скрипт не мог управлять байтами на проводе и обмануть прокси, не знающий WebSocket (отравление кэша). Это не шифрование — для него `wss://`. При отказе браузер не показывает скрипту статус: только `error` и `close 1006`.
:::

::: details Как понять, что WebSocket-соединение мертво
`readyState` может оставаться `OPEN` бесконечно: если сеть пропала без FIN/RST (смена сети, NAT, зависший сервер), TCP об этом не узнает, пока не попробует отправить данные и не исчерпает ретраи. Протокольный ping/pong браузер обрабатывает сам, из JavaScript его не отправить. Поэтому делают heartbeat на уровне приложения: ping-сообщение раз в 20–30 секунд (меньше idle-таймаута балансировщика), и если pong не пришёл за таймаут — `close()` и переподключение. Дополнительно проверяют соединение по `online` и `visibilitychange`. Растущий `bufferedAmount` — тоже признак, что данные не уходят.
:::

::: details Есть ли у WebSocket CORS и как его защищают
Нет. Браузер отправляет `Origin` в handshake, но открывает соединение с любым сервером и прикладывает cookies этого сервера. Если аутентификация на cookie, а `Origin` не проверяется, чужой сайт откроет сокет от имени пользователя и будет читать и писать данные — Cross-Site WebSocket Hijacking. Защита: белый список `Origin` при handshake, cookies с `SameSite=Lax` или `Strict` (на cross-site подзапрос они не уйдут), одноразовый короткоживущий тикет, полученный обычным запросом с CSRF-защитой, вместо долгого токена в URL (он попадает в логи). `wss://` обязателен, сообщения валидируются на сервере, как любой ввод.
:::

::: details Как не терять и не дублировать сообщения при переподключениях
TCP гарантирует порядок и доставку только внутри одного соединения. Сервер нумерует события, клиент помнит последний `seq` и после переподключения просит всё, что новее (аналог `Last-Event-ID`). Если сервер столько не хранит — клиент загружает снимок состояния заново. Исходящие сообщения клиент держит в outbox до подтверждения сервера (`ack`) и переотправляет после переподключения с тем же идентификатором, а сервер отбрасывает дубли — это at-least-once плюс идемпотентность. Порядок между пользователями задаёт сервер, а не часы клиента. Переподключение — с экспоненциальной задержкой и jitter, чтобы клиенты не вернулись все разом.
:::

## Задачи

### 1. Какие события получит клиент · легко

Сервер отдаёт поток `text/event-stream` (символы `\n` показаны переводами строк; в начале — BOM):

```
data: a
data: b

event: price
data: 1

: just a comment

data

event: only-type

data: tail-without-blank-line
```

Клиент:

```js
const es = new EventSource('/stream');
es.onmessage = (e) => console.log('message', JSON.stringify(e.data));
es.addEventListener('price', (e) => console.log('price', e.data));
es.addEventListener('only-type', (e) => console.log('only-type', e.data));
```

Что выведется? Что случится после того, как сервер закроет поток?

::: details Решение и разбор
```
message "a\nb"
price 1
message ""
```

- BOM в начале потока отбрасывается; две строки `data` склеиваются через `\n`.
- Событие типа `price` получает только его слушатель, `onmessage` слушает лишь тип `message`.
- Комментарий игнорируется.
- `data` без значения — событие с пустой строкой.
- Блок только с `event:` без `data` событие не порождает.
- Последний блок без завершающей пустой строки при закрытии потока отбрасывается.

После закрытия потока сервером браузер шлёт `error` с `readyState === 0` и через reconnection time (≈3 с в Chromium) запрашивает поток заново. Если сервер не хочет повтора, он отвечает `204`. Вывод проверен в Chromium 157.
:::

### 2. Composable `useEventSource` для Nuxt · средне

Напишите для Vue 3.5 composable `useEventSource<T>(url)`, который возвращает последнее событие и статус, не открывает соединение при SSR, закрывается вместе с компонентом и переподключается с backoff, когда `EventSource` перешёл в `CLOSED`.

::: details Решение и разбор
```ts
import { shallowRef, ref, onMounted, onScopeDispose } from 'vue';

export function useEventSource<T>(url: string, event = 'message') {
  const data = shallowRef<T | null>(null);
  const status = ref<'connecting' | 'open' | 'closed'>('connecting');
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let disposed = false;

  const connect = () => {
    es = new EventSource(url);
    es.onopen = () => { status.value = 'open'; attempt = 0; };
    es.addEventListener(event, (e) => { data.value = JSON.parse((e as MessageEvent).data) as T; });
    es.onerror = () => {
      if (es!.readyState === EventSource.CONNECTING) { status.value = 'connecting'; return; } // built-in retry
      status.value = 'closed'; // failed: non-200 or wrong Content-Type, no built-in retry
      es!.close();
      if (disposed) return;
      const cap = Math.min(60_000, 1000 * 2 ** attempt++);
      timer = setTimeout(connect, Math.random() * cap);
    };
  };

  onMounted(connect); // never runs on the server
  onScopeDispose(() => {
    disposed = true;
    clearTimeout(timer);
    es?.close();
  });

  return { data, status };
}
```

Разбор:
- **SSR.** `onMounted` на сервере не вызывается, поэтому соединение открывается только в браузере. Открыть его прямо в `setup` — значит открывать поток на сервере при каждом рендере.
- **Два вида ошибок.** При `CONNECTING` браузер переподключается сам, с `Last-Event-ID`, — вмешиваться не нужно. При `CLOSED` встроенных повторов не будет, и composable ставит свой backoff с jitter. Новый `EventSource` после `CLOSED` не знает последний `id`; если важно не терять события, передайте его в URL (`?lastEventId=`).
- `shallowRef` — событие заменяется целиком, глубокая реактивность не нужна.
- `onScopeDispose` срабатывает и в компоненте, и в `effectScope` (например, в сторе Pinia).
- Если composable используют пять компонентов, откроются пять потоков. Общее соединение выносят в стор или модуль и раздают подписчикам.
:::

### 3. Надёжный WebSocket-клиент · сложно

Напишите класс `ReliableSocket` поверх `WebSocket`: переподключение с экспоненциальной задержкой и jitter, heartbeat с таймаутом, очередь сообщений до открытия, resume по последнему `seq` и подписка через `on(type, handler)`. Протокол сервера: сообщения `{ type, seq?, ... }`; на `{type:'ping'}` он отвечает `{type:'pong'}`; при открытии ждёт `{type:'resume', after}`.

::: details Решение и разбор
```js
export class ReliableSocket extends EventTarget {
  #url; #ws = null; #attempt = 0; #queue = []; #lastSeq = 0;
  #pingTimer; #pongTimer; #retryTimer; #stopped = false;

  constructor(url, { pingEvery = 25_000, pongTimeout = 10_000, maxDelay = 30_000 } = {}) {
    super();
    this.#url = url;
    this.opts = { pingEvery, pongTimeout, maxDelay };
    this.#connect();
  }

  send(msg) {
    const data = JSON.stringify(msg);
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(data);
    else this.#queue.push(data); // send() before open throws InvalidStateError
  }

  on(type, handler) {
    const listener = (e) => handler(e.detail);
    this.addEventListener(type, listener);
    return () => this.removeEventListener(type, listener);
  }

  close() {
    this.#stopped = true;
    clearTimeout(this.#retryTimer);
    this.#stopHeartbeat();
    this.#ws?.close(1000);
  }

  #connect() {
    const ws = (this.#ws = new WebSocket(this.#url));
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'resume', after: this.#lastSeq }));
      for (const data of this.#queue.splice(0)) ws.send(data);
      this.#startHeartbeat();
      this.dispatchEvent(new CustomEvent('open'));
    };
    ws.onmessage = (e) => {
      if (ws !== this.#ws) return;
      const msg = JSON.parse(e.data);
      this.#attempt = 0; // the connection really works
      if (msg.type === 'pong') return clearTimeout(this.#pongTimer);
      if (msg.seq !== undefined) {
        if (msg.seq <= this.#lastSeq) return; // duplicate after resume
        this.#lastSeq = msg.seq;
      }
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
    };
    ws.onclose = (e) => { // 'error' is not fired on an abrupt drop, 'close' always is
      if (ws !== this.#ws) return; // a socket already replaced by #reconnectNow
      this.#stopHeartbeat();
      this.dispatchEvent(new CustomEvent('close', { detail: { code: e.code } }));
      if (this.#stopped) return;
      const cap = Math.min(this.opts.maxDelay, 1000 * 2 ** this.#attempt++);
      this.#retryTimer = setTimeout(() => this.#connect(), Math.random() * cap); // full jitter
    };
  }

  #startHeartbeat() {
    this.#pingTimer = setInterval(() => {
      this.#ws.send(JSON.stringify({ type: 'ping' }));
      clearTimeout(this.#pongTimer);
      this.#pongTimer = setTimeout(() => this.#reconnectNow(), this.opts.pongTimeout);
    }, this.opts.pingEvery);
  }

  #reconnectNow() {
    const dead = this.#ws;
    this.#stopHeartbeat();
    this.#ws = null; // its late 'close' event is ignored by the identity check
    dead.close(4000, 'heartbeat timeout'); // the close handshake may never finish
    this.#connect();
  }

  #stopHeartbeat() {
    clearInterval(this.#pingTimer);
    clearTimeout(this.#pongTimer);
  }
}
```

Разбор:
- **Переподключение на `close`, а не на `error`.** При обрыве TCP после открытия Chromium шлёт только `close 1006`, без `error`; при отказе в handshake — оба события. Вешать логику на `error` — значит пропустить обрывы.
- **Сброс счётчика попыток** — при первом сообщении, а не при `open`: сервер, который принимает соединение и сразу падает, иначе получил бы переподключения без задержки в цикле.
- **Heartbeat.** Если pong не пришёл, ждать `close` от старого сокета нельзя: на полуоткрытом соединении close-handshake не завершится. Проверено в Chromium 157: сервер не ответил на close-кадр — событие `close` (`1006`, `wasClean=false`) пришло только через 60 секунд. Поэтому `#reconnectNow()` сразу открывает новый сокет, а поздний `close` старого отсекается проверкой `ws !== this.#ws`.
- **Resume и дедупликация.** `after: lastSeq` просит пропущенное; повторно пришедшие `seq` отбрасываются. Порядок внутри соединения гарантирует TCP.
- **Чего нет.** Очередь хранит только неотправленное: сообщения, ушедшие в `send()` перед обрывом, могли потеряться. Для гарантии нужен outbox до `ack` от сервера и идемпотентный `clientId`. Ещё стоит ограничить очередь по размеру, переподключаться сразу по `online` и не держать сокет в скрытой вкладке, если продукт это позволяет.
:::

## Источники

- [HTML Living Standard: Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [WHATWG WebSockets Standard](https://websockets.spec.whatwg.org/)
- [RFC 6455: The WebSocket Protocol](https://www.rfc-editor.org/rfc/rfc6455)
- [RFC 8441: Bootstrapping WebSockets with HTTP/2](https://www.rfc-editor.org/rfc/rfc8441)
- [RFC 9220: Bootstrapping WebSockets with HTTP/3](https://www.rfc-editor.org/rfc/rfc9220)
- [W3C WebTransport](https://www.w3.org/TR/webtransport/)
- [MDN: Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
- [MDN: EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
- [MDN: WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [MDN: WebSocketStream](https://developer.mozilla.org/en-US/docs/Web/API/WebSocketStream)
- [MDN: WebTransport API](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API)
- [MDN browser-compat-data](https://github.com/mdn/browser-compat-data)
- [developer.chrome.com: WebSocketStream](https://developer.chrome.com/docs/capabilities/web-apis/websocketstream)
- [developer.chrome.com: Using WebTransport](https://developer.chrome.com/docs/capabilities/web-apis/webtransport)
- [Nitro v2: WebSocket и SSE](https://github.com/nitrojs/nitro/blob/v2.13.6/docs/1.guide/3.websocket.md)
- [crossws: Hooks, Peer, Pub/Sub](https://github.com/h3js/crossws/tree/main/docs/1.guide)
- [h3 v1: createEventStream](https://github.com/h3js/h3/blob/v1.15.11/src/utils/sse/event-stream.ts)
- [Nuxt: Server directory](https://nuxt.com/docs/4.x/directory-structure/server)
- [AWS Architecture Blog: Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [OWASP: WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
