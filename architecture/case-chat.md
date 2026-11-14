---
title: 'Разбор: чат'
level: ядро
---

# Разбор: чат

> **Коротко.** Чат — вторая по частоте задача раунда «спроектируйте приложение» после ленты. Её суть — доставка: сообщение не должно ни потеряться, ни задвоиться при обрывах, повторах и нескольких вкладках. Senior проектирует его по RADIO: требования (личные или групповые чаты, статусы, офлайн, вложения) → части (список чатов, переписка, композер, sync-движок, локальная база) → сообщение с клиентским `clientId` и серверным `seq` и курсоры прочтения вместо статуса у каждого сообщения → протокол поверх WebSocket с `ack`, догоном по `seq` и heartbeat → углубление: optimistic send с outbox, история вверх без сдвига прокрутки, одно соединение на все вкладки, непрочитанное и уведомления, E2E-шифрование. Каждое решение привязывают к требованиям и называют его цену.

**Связанные темы:** [Frontend System Design: фреймворк RADIO](system-design-framework.md), [Данные и сеть в System Design](data-and-network.md), [Нефункциональные требования: рендеринг, офлайн, i18n, наблюдаемость](non-functional.md), [Разбор: новостная лента](case-news-feed.md), [Real-time: polling, SSE, WebSocket](../network/realtime.md), [Хранилища браузера](../network/browser-storage.md), [Web Workers, Service Workers и PWA](../browser/workers.md), [DOM API и observers](../browser/dom.md), [Оптимизация runtime и профилирование](../performance/runtime.md), [Утечки памяти](../performance/memory-leaks.md), [Аутентификация на фронтенде](../security/authentication.md), [XSS и безопасный вывод во Vue](../security/xss.md), [Content Security Policy](../security/csp.md)

## Теория

Здесь те же механизмы, что и в других темах раздела, применены к одной задаче. Порядок разговора — в [теме про RADIO](system-design-framework.md). Кэш, optimistic updates, cursor-пагинация и идемпотентность в общем виде — в [«Данных и сети»](data-and-network.md), офлайн и outbox — в [нефункциональных требованиях](non-functional.md). Устройство WebSocket, heartbeat, backoff с jitter и resume разобраны в [Real-time](../network/realtime.md), там же задача «Надёжный WebSocket-клиент». Ниже — какие решения из этого набора принимают для чата и почему. Условие на интервью: «Спроектируйте мессенджер, как WhatsApp Web» (вариации: Messenger, Telegram Web, Slack). GreatFrontEnd формулирует ядро так: личный чат в браузере, доставка в реальном времени, optimistic send, офлайн-очередь, статусы доставки и догон после переподключения. Группы, медиа, поиск, push-уведомления, E2E и несколько вкладок там идут как продолжения. Это хорошая подсказка, в каком порядке расширять разговор.

### R — требования: что спрашивать

| Вопрос | Что решает |
| --- | --- |
| Только личные чаты или группы? Сколько участников? Какая задержка доставки? | Fan-out, статусы прочтения (у сообщения или курсором), транспорт: для «секунды и меньше» — WebSocket |
| Какие статусы: отправлено, доставлено, прочитано? Набор текста, онлайн? | События протокола, эфемерные и сохраняемые |
| Какая глубина истории, нужен ли поиск? | Пагинация вверх, локальная база, поиск на сервере или на клиенте |
| Вложения: фото, файлы, голосовые? Какой размер? | Отдельная загрузка по HTTP, прогресс, превью |
| Что работает без сети: чтение, отправка? | IndexedDB, outbox, объём кэша на устройстве |
| Несколько вкладок и устройств? | Одно соединение на браузер, синхронизация прочтения между устройствами |
| Нужно ли сквозное шифрование (E2E)? | Где живут ключи, возможен ли поиск на сервере и превью в push |

На «решите сами» записывают допущения с числами: «Личные чаты и группы до 100 человек; доставка за секунду; статусы „отправлено / доставлено / прочитано“ и набор текста; история на годы, листают вверх; фото и файлы до 100 МБ; чтение последних чатов и отправка офлайн; несколько вкладок; E2E — обзорно».

**Функциональные требования**: список чатов с превью и счётчиком непрочитанного; переписка с историей; отправка текста и вложений; статусы и индикатор набора; уведомления о новых сообщениях. **Нефункциональные**: сообщение не теряется и не задваивается; порядок одинаков у всех участников; открытие чата быстрое, прокрутка истории без прыжков; работает на мобильной сети с обрывами; доступность с клавиатуры и скринридером. **Вне рамок**: хранение и маршрутизация на сервере, звонки, боты, модерация.

### A — архитектура

```text
 ┌─────────────────────────────── Tab ─────────────────────────────────┐
 │  ChatLayout                                                         │
 │   ├─ ConversationList ── ConversationItem × N  (preview, unread)    │
 │   └─ ConversationView                                               │
 │        ├─ MessageList ── MessageBubble × N   (role="log")           │
 │        ├─ TypingIndicator                                           │
 │        └─ Composer ── draft, attachments ──┐                        │
 │               ▲ reads                      ▼ send(clientId)         │
 │   Message store (memory) ◀──────────── Sync engine                  │
 │               ▲                       (outbox, cursors, gaps)       │
 │   Local DB (IndexedDB) ◀──────────────┘   │                         │
 │                    Tab coordinator (Web Locks leader) ──────────────┼──▶ other tabs
 └───────────────────────────────────────────┼─────────────────────────┘   (BroadcastChannel)
                 WebSocket (events) · HTTP (history, uploads) ──▶ Server
```

- **ConversationList** — чаты по времени последнего сообщения, превью, счётчик, отметка «без звука».
- **MessageList** — переписка: подгрузка истории вверх, прилипание к низу, разделитель «Новые сообщения», виртуализация.
- **Composer** — черновик на каждый чат, вложения, отправка по Enter, сигнал «печатает».
- **Sync engine** — сердце дизайна: outbox, подтверждения, курсоры, обнаружение пропусков, догон после переподключения. Пишет в **Message store** (сообщения в памяти по `seq` плюс ожидающие) и в **Local DB** (IndexedDB: последние сообщения, чаты, outbox). Во Vue это стор или модуль без UI, компоненты только читают.
- **Tab coordinator** — выбирает вкладку, которая держит соединение, и раздаёт события остальным.

Главное решение — **UI читает из локального состояния, сеть только пишет в него**. Отправленное сообщение сразу попадает в стор и в outbox, а не ждёт ответа сервера. Входящее из сокета, из догона и из HTTP-истории проходит через одну функцию слияния. Поэтому дубли и порядок решаются в одном месте.

### D — модель данных

Сообщение: `id` (серверный, известен после `ack`), `clientId` (`crypto.randomUUID()` на устройстве отправителя — ключ идемпотентности), `conversationId`, `senderId`, `seq` (порядок внутри чата от сервера), `createdAt` (время сервера, только для показа), текст и вложения с размерами. Чат: `lastSeq` (последнее известное сообщение), `myReadSeq` (мой курсор прочтения), участники с `deliveredSeq` и `readSeq`, `muted`.

| Данные | Вид | Где живёт |
| --- | --- | --- |
| Сообщения, чаты, участники | server state | стор в памяти + IndexedDB (последние N на чат) |
| Ожидающие отправки (`sending`, `failed`) | client state, должен пережить перезагрузку | outbox в IndexedDB |
| Черновик и выбранные вложения | persistent client state | IndexedDB (файлы — Blob) |
| Набор текста, онлайн | эфемерный server state | только память, с таймаутом |
| Число непрочитанных | derived | `lastSeq - myReadSeq` минус свои сообщения |

**Порядок задаёт сервер, а не часы.** Время клиента врёт и совпадает до миллисекунды у двух отправителей. Сервер выдаёт каждому сообщению номер `seq`, монотонный внутри чата, и все клиенты сортируют по нему ([порядок между соединениями](../network/realtime.md)). Свои неподтверждённые сообщения ещё не имеют `seq`, поэтому их показывают внизу в порядке создания, а после `ack` ставят на место. Сообщение собеседника, отправленное раньше, может оказаться выше вашего: так и надо, ведь это порядок, который видят все.

**Статус — это курсор, а не поле сообщения.** «Прочитано» у каждого сообщения в группе на 100 человек — 100 записей на сообщение и шторм событий. Вместо этого у каждого участника два числа: `deliveredSeq` и `readSeq` — «доставлено и прочитано всё до этого номера». Галочки сообщения вычисляются: «прочитано», если `readSeq` собеседника ≥ `seq`; в группе — «прочитали 5 из 12». Счётчик непрочитанного тоже выводится из курсора, его не хранят отдельно. Цена: курсор не умеет «прочитал 40-е, но пропустил 39-е». Для чата это допустимо, потому что открытый чат читают снизу.

### I — интерфейс

```text
HTTP
GET  /conversations?cursor=<opaque>&limit=30      → { conversations, users, nextCursor }
GET  /conversations/:id/messages?before=<seq>&limit=50   → { messages, hasOlder }
GET  /conversations/:id/messages?after=<seq>&limit=200   → догон пропуска
POST /uploads  → { uploadId, uploadUrl }          (файл грузится напрямую в хранилище)

WebSocket: client → server
{ type: 'send', clientId, conversationId, text, attachmentIds }
{ type: 'read', conversationId, seq }   { type: 'typing', conversationId }
{ type: 'resume', after: <userEventSeq> }   { type: 'ping' }

WebSocket: server → client
{ type: 'ack', clientId, id, seq, createdAt }   | { type: 'nack', clientId, reason }
{ type: 'message', message, eventSeq }
{ type: 'receipt', conversationId, userId, deliveredSeq?, readSeq?, eventSeq }
{ type: 'typing', conversationId, userId }   (no eventSeq: not replayed)
{ type: 'resync' }   (the gap is too old: reload a snapshot)   { type: 'pong' }
```

Решения в контракте и их цена:

- **WebSocket, а не SSE + `POST`.** События идут в обе стороны и часто: отправка, «печатает», «прочитал». SSE + `POST` тоже рабочий вариант, он проще проходит через HTTP-инфраструктуру ([как выбрать](../network/realtime.md)). Но тогда `ack` придёт по другому каналу, а набор текста станет отдельным запросом на каждые 3 секунды. Цена WebSocket — переподключение, heartbeat и доставку пишем сами.
- **Отправка с `clientId` и подтверждение `ack`.** TCP гарантирует доставку только внутри соединения. Без `ack` клиент не знает, дошло ли сообщение, ушедшее перед обрывом. Сервер отбрасывает повтор по паре `(senderId, clientId)` и отвечает тем же `ack`. Это и есть ключ идемпотентности ([в общем виде](data-and-network.md)). `nack` с причиной (`not_member`, `too_large`) — окончательная ошибка: её не повторяют.
- **Один поток событий пользователя с `eventSeq`** для догона, а не курсор на каждый чат. После переподключения клиент шлёт один номер, а не сотню. Если сервер уже не хранит такую глубину, он отвечает `resync`, и клиент перезагружает список чатов, а открытые чаты догоняет по HTTP `after=<seq>`.
- **Эфемерные события** («печатает», онлайн) не нумеруются, не подтверждаются и не догоняются: через минуту они бессмысленны.
- **Вложения не идут через сокет.** Большой файл занял бы соединение, и сообщения встали бы в очередь за ним. Файл грузится по HTTP, в сообщение уходит только `attachmentId`.
- **Авторизация при handshake.** Браузерный `WebSocket` не умеет ставить заголовки, поэтому сервер проверяет cookie и `Origin` или короткоживущий билет, полученный по HTTP. Истёкший токен сервер закрывает своим кодом, клиент обновляет его и переподключается ([безопасность WebSocket](../network/realtime.md)).
- **Компоненты не знают о сокете.** `MessageList` получает строки, `hasOlder`, `loadingOlder` и испускает `loadOlder`, `Composer` — `send(text, files)` и `typing`.

### O — углубление: что выбрать за 15 минут

Обычно ждут отправку без потерь и догон после обрыва. Дальше выбирают по требованиям: историю и прокрутку, вкладки, непрочитанное или E2E.

#### Отправка: optimistic send и outbox

1. Enter → `clientId = crypto.randomUUID()`, запись в outbox в IndexedDB, пузырь внизу со статусом «отправляется» (часы). Ключ создаётся при нажатии, а не при каждой попытке, иначе повтор создаст дубль.
2. Sync engine шлёт `send`. Пришёл `ack` → сообщение получает `id` и `seq`, запись уходит из outbox, статус «отправлено» (одна галочка).
3. Нет `ack` за таймаут или соединение оборвалось → после переподключения outbox переотправляется **с тем же `clientId`**. Сервер дубль не создаст.
4. `nack` или N неудачных попыток → статус «не отправлено» с кнопками «Повторить» и «Удалить». Текст не теряется.
5. Outbox отправляется в порядке создания, иначе два быстрых сообщения получат `seq` наоборот. Конвейером, без ожидания `ack`, можно: одно соединение сохраняет порядок. Но после переподключения повтор идёт с первого неподтверждённого.

#### Догон после переподключения

Переподключение с backoff и jitter и heartbeat против полуоткрытых соединений — из [Real-time](../network/realtime.md). Для чата важно, что происходит после `open`:

1. `resume` с последним `eventSeq` → сервер присылает пропущенные события или `resync`.
2. **Пропуск в `seq`** внутри чата (пришло 6, а последнее известное 3) → клиент догружает 4–5 по HTTP. Это страховка на случай, если сервер или прокси что-то потерял.
3. Сообщения проходят одну функцию слияния: дубль по `seq` или `clientId` отбрасывается (пример 2).
4. Только после догона отправляется outbox. Иначе своё сообщение может получить `seq` раньше, чем придут пропущенные чужие, и в UI на секунду окажется не там. Индикатор «Подключение…» показывают через 1–2 секунды без связи, иначе на мобильной сети он мигает.

#### История: вверх без сдвига прокрутки

Чат открывается снизу, поэтому история грузится **вверх** по курсору `before=<seq>`. Открытый чат показывает последние 50 сообщений. Если есть непрочитанные, чат открывается на разделителе «Новые сообщения», а не в самом низу.

- **Сохранение позиции при подгрузке сверху.** Когда сверху вставили 50 сообщений, `scrollTop` не изменился, и пользователь видит другое место. Решение: запомнить `scrollHeight` до вставки и после рендера прибавить разницу к `scrollTop` (пример 3). Scroll anchoring браузера (`overflow-anchor`) делает это сам, по MDN он Baseline 2026. Но ручная поправка работает и в старых версиях, и тогда якорение выключают, чтобы правка не применилась дважды.
- **Прилипание к низу.** Новое сообщение прокручивает вниз, только если пользователь уже внизу (порог 50–100 px) или сообщение своё. Если человек читает историю, сдёрнуть его вниз — ошибка. Вместо этого появляется кнопка «↓ 3 новых».
- **Картинки, догрузившиеся у нижнего края**, сдвигают «низ». Размеры из API (`width`, `height`) резервируют место, как в [ленте](case-news-feed.md).
- **Трюк `flex-direction: column-reverse`** делает началом прокрутки низ, и подгрузка сверху не сдвигает экран. Цена: DOM идёт в обратном порядке, и скринридер с Tab читают переписку снизу вверх. Поэтому лучше поправка `scrollTop`.

- **Длинная переписка.** Тысячи сообщений разной высоты — `content-visibility: auto` на пузырях или виртуализация, как в ленте ([окно с переменной высотой](../performance/runtime.md)), но с якорем снизу. Промежуточный вариант — **окно страниц**: 3–5 страниц в DOM вокруг видимой, дальние выгружаются, курсоры остаются. Поиск браузера по выгруженному не работает, поэтому поиск по чату свой.

#### Локальная база и офлайн

IndexedDB: хранилище `messages` с ключом `[conversationId, seq]`, `conversations`, `outbox`, `drafts`. Кэшируют последние 100–200 сообщений каждого из последних чатов, а не всю историю: квота конечна, а вытеснение бьёт по всему origin ([квоты и `persist()`](../network/browser-storage.md)). Открыл приложение без сети → список чатов и последние сообщения из базы, пометка «Нет подключения», отправка уходит в outbox. Уровни и правила очереди мутаций — в [нефункциональных требованиях](non-functional.md). Переписка личная, поэтому при выходе из аккаунта базу удаляют, и на общих устройствах офлайн-кэш можно не включать.

#### Несколько вкладок

Пять открытых вкладок — это пять соединений, пять уведомлений на одно сообщение, разные счётчики непрочитанного и гонки записи в IndexedDB.

| Вариант | Как | Цена |
| --- | --- | --- |
| Соединение в каждой вкладке | ничего не делать | N соединений на сервере, дубли уведомлений, outbox делят все вкладки |
| Лидер через Web Locks | вкладка с блокировкой держит сокет и раздаёт события через `BroadcastChannel` | при закрытии лидера — переподключение в новой вкладке; лидер может оказаться скрытой вкладкой |
| `SharedWorker` | сокет живёт в общем воркере, вкладки — его клиенты | Chrome на Android поддерживает его только с 148 ([поддержка](../browser/workers.md)) |
| Service Worker | — | не годится: браузер останавливает SW в простое, долгое соединение он не держит |

Выбор: лидер через Web Locks (Baseline с 2022) и `BroadcastChannel` (задача 4) либо `SharedWorker` с лидером как запасным путём. Outbox в IndexedDB общий, отправляет его только лидер, поэтому дублей нет. Ловушка: в скрытой вкладке браузер замедляет таймеры, и heartbeat лидера может опоздать — серверный таймаут закладывают с запасом.

#### Непрочитанное, «прочитано», набор текста

- **Когда сообщение прочитано.** Не при получении, а когда пузырь виден (`IntersectionObserver`, [observers](../browser/dom.md)), вкладка видима (`visibilityState`) и в фокусе. Клиент шлёт `read` с максимальным видимым `seq` не чаще раза в секунду. Курсор только растёт: старый `read` не откатывает новый.
- **Между устройствами.** Прочитал на телефоне → сервер шлёт `receipt` с новым `myReadSeq`, и счётчик на ноутбуке гаснет без действия.
- **Группы.** «Прочитали 5 из 12» вычисляют из курсоров участников. В больших группах и каналах статусы прочтения отключают: число событий растёт как участники × сообщения.
- **Набор текста.** Отправитель шлёт `typing` не чаще раза в 3 секунды, пока печатает. Получатель скрывает индикатор через 5 секунд без нового сигнала. Не сохраняется, не догоняется, из скрытой вкладки не шлётся.

#### Уведомления

- **Вкладка открыта, но не видна**: счётчик в `document.title` («(3) Чат») и значок на favicon. Badging API (`navigator.setAppBadge(3)`) ставит число на иконку установленного PWA, но поддержка ограничена (по MDN не Baseline).
- **Системные уведомления** (Notification API): разрешение просят по нажатию кнопки, когда пользователь понял зачем, а не при загрузке. Отказ — навсегда, браузеры блокируют повторный запрос. Показывает только лидер. Опция `tag` с id чата заменяет предыдущее уведомление, а не копит десять. Чаты «без звука» не уведомляют.
- **Вкладка закрыта**: Web Push через Service Worker. Сервер шлёт push, SW показывает уведомление. Без E2E в push можно передать превью текста, с E2E — только «Новое сообщение» или расшифровку в SW.

#### Вложения

Файл выбран → превью сразу из локального Blob (`URL.createObjectURL`, после отправки — `revokeObjectURL`, иначе [утечка](../performance/memory-leaks.md)). Размеры картинки считают на клиенте до отправки. Загрузка идёт по HTTP напрямую в хранилище с прогрессом и отменой, для больших файлов — по частям с возобновлением. Сообщение со ссылкой на `attachmentId` уходит в outbox после загрузки. Пока файл грузится, пузырь показывает прогресс, а сообщение не отправлено. Лимиты размера проверяют до загрузки, а не после.

#### Безопасность и E2E обзорно

Текст сообщений, имена и названия чатов — пользовательские данные. Ссылки и упоминания собирают из токенов в компоненты, без `v-html` ([XSS](../security/xss.md)). Для сокета проверяют `Origin` при handshake, иначе чужой сайт откроет соединение с cookie пользователя.

**E2E** значит, что ключи есть только на устройствах участников, а сервер хранит и пересылает шифротекст. Протоколы — Signal (double ratchet, им шифрует WhatsApp) для личных чатов и MLS (RFC 9420) для групп. Криптографию фронтенд не изобретает, но платит за неё. Поиск на сервере невозможен, он идёт по локальному индексу. История на новом устройстве не появляется сама: её переносят со старого или из зашифрованной копии. У каждого устройства свои ключи, и сообщение шифруют для каждого устройства каждого участника. Ключи хранят в IndexedDB как неизвлекаемые `CryptoKey` (Web Crypto), но XSS всё равно может ими пользоваться, поэтому [CSP](../security/csp.md) обязателен. Главная слабость веб-версии: код каждый раз присылает сервер, и подменённый бандл обойдёт шифрование.

## Примеры

### 1. Доска к 25-й минуте

```text
DESIGN: Messenger (1:1 + groups ≤ 100, web desktop + mobile, several tabs)
R  Functional: chat list + unread · history · send text / files · sent/delivered/read · typing · notifications
   Non-functional: no loss, no duplicates · same order for all · fast open · flaky mobile network · a11y
   Out of scope: server storage & routing, calls, bots, moderation
A  ChatLayout: ConversationList · ConversationView (MessageList, Typing, Composer)
   Message store ↔ Sync engine (outbox, cursors, gaps) ↔ IndexedDB
   Tab coordinator: Web Locks leader holds the WebSocket, BroadcastChannel fan-out
D  Message {id, clientId, conversationId, senderId, seq, createdAt, text, attachments}
   Conversation {lastSeq, myReadSeq, members[{deliveredSeq, readSeq}]} · unread = derived
I  WS: send{clientId} → ack{clientId, id, seq} | nack · message · receipt · typing · resume{after} · ping
   HTTP: messages?before=seq (history) · ?after=seq (gaps) · POST /uploads
O  1) optimistic send + outbox in IndexedDB, retry with the same clientId
   2) reconnect: resume by eventSeq → fill gaps → flush outbox
   3) history upward, keep scroll position, stick to bottom only when at bottom
   4) one socket per browser · read = visible + focused · notifications only from the leader
```

### 2. Слияние сообщений: порядок, дубли и пропуски

Ожидающие отправки показаны внизу. `ack` и чужие сообщения проходят одну функцию, повтор отбрасывается, пропуск в `seq` возвращается для догрузки.

```ts
interface Message { id: string; clientId: string; seq: number; senderId: string; text: string }
interface Pending { clientId: string; text: string; status: 'sending' | 'failed' }
type Gap = { after: number; before: number }; // missing seq range, exclusive

class ConversationMessages {
  private bySeq = new Map<number, Message>();
  private known = new Set<string>(); // clientIds already confirmed
  pending: Pending[] = [];
  lastSeq = 0;

  send(text: string): Pending {
    const p: Pending = { clientId: crypto.randomUUID(), text, status: 'sending' };
    this.pending.push(p); // shown at the bottom right away
    return p;
  }

  // Both the ack for our own message and an incoming message from others land here.
  receive(msg: Message): Gap | null {
    if (this.bySeq.has(msg.seq) || this.known.has(msg.clientId)) return null; // duplicate after retry or resume
    this.bySeq.set(msg.seq, msg);
    this.known.add(msg.clientId);
    this.pending = this.pending.filter((p) => p.clientId !== msg.clientId);
    const gap = msg.seq > this.lastSeq + 1 ? { after: this.lastSeq, before: msg.seq } : null;
    this.lastSeq = Math.max(this.lastSeq, msg.seq);
    return gap; // the caller fetches the range over HTTP
  }

  view(): string[] {
    const confirmed = [...this.bySeq.values()].sort((a, b) => a.seq - b.seq).map((m) => `${m.seq}:${m.text}`);
    return [...confirmed, ...this.pending.map((p) => `…:${p.text} (${p.status})`)];
  }
}

const chat = new ConversationMessages();
const msg = (seq: number, text: string, clientId = `c${seq}`) => ({ id: `m${seq}`, clientId, seq, senderId: 'bob', text });

chat.receive(msg(1, 'hi'));
const mine = chat.send('hello, Bob');
chat.receive(msg(2, 'how are you?')); // arrives while ours is in flight
console.log(chat.view()); // [ '1:hi', '2:how are you?', '…:hello, Bob (sending)' ]

chat.receive({ ...msg(3, 'hello, Bob', mine.clientId), senderId: 'me' }); // ack: the server gave it seq 3
chat.receive({ ...msg(3, 'hello, Bob', mine.clientId), senderId: 'me' }); // the same ack replayed after resume
console.log(chat.view()); // [ '1:hi', '2:how are you?', '3:hello, Bob' ]

console.log(chat.receive(msg(6, 'are you there?'))); // { after: 3, before: 6 } — 4 and 5 were lost
```

### 3. Список сообщений: история сверху и прилипание к низу

Шаблон показывает решения, а не готовый компонент: поправка `scrollTop` после вставки сверху, автопрокрутка только для того, кто внизу, кнопка «новые» и роль `log` (живой регион, который скринридер объявляет вежливо).

```vue
<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue';

interface Row { key: string; text: string; mine: boolean }
const props = defineProps<{ rows: Row[]; hasOlder: boolean; loadingOlder: boolean }>();
const emit = defineEmits<{ loadOlder: [] }>();

const scroller = useTemplateRef<HTMLElement>('scroller');
const atBottom = ref(true);
const unseen = ref(0);
let heightBeforePrepend: number | null = null;

function onScroll() {
  const el = scroller.value!;
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  if (atBottom.value) unseen.value = 0;
  if (el.scrollTop < 300 && props.hasOlder && !props.loadingOlder) {
    heightBeforePrepend = el.scrollHeight; // remember the height before older messages arrive
    emit('loadOlder');
  }
}

function scrollToBottom() {
  const el = scroller.value!;
  el.scrollTop = el.scrollHeight;
  unseen.value = 0;
}

watch(
  () => [props.rows[0]?.key, props.rows.at(-1)?.key] as const,
  async ([first, last], [prevFirst, prevLast]) => {
    const wasAtBottom = atBottom.value;
    await nextTick();
    const el = scroller.value!;
    if (first !== prevFirst && heightBeforePrepend !== null) {
      el.scrollTop += el.scrollHeight - heightBeforePrepend; // older page on top: keep the same message under the eye
      heightBeforePrepend = null;
    }
    if (last !== prevLast) {
      if (wasAtBottom || props.rows.at(-1)?.mine) scrollToBottom(); // follow the conversation
      else unseen.value++; // the user is reading history: do not yank them down
    }
  },
);
</script>

<template>
  <div ref="scroller" class="messages" role="log" aria-label="Messages" @scroll.passive="onScroll">
    <p v-if="loadingOlder" class="hint">Loading…</p>
    <div v-for="row in rows" :key="row.key" :class="['bubble', { mine: row.mine }]">{{ row.text }}</div>
  </div>
  <button v-if="unseen > 0" type="button" class="jump" @click="scrollToBottom">↓ {{ unseen }} new</button>
</template>
```

У `.messages` в стилях — `overflow-y: auto` и `overflow-anchor: none`: поправку делает код, и браузер не должен сдвигать прокрутку второй раз.

## Вопросы с интервью

::: details С каких вопросов вы начнёте, если просят спроектировать мессенджер
С тех, что меняют дизайн. Личные чаты или группы и какого размера: от этого зависят fan-out и то, как хранить статусы прочтения. Какие статусы нужны: отправлено, доставлено, прочитано, набор текста, онлайн. Глубина истории и поиск. Вложения и их размер. Что работает офлайн: только чтение или и отправка. Несколько вкладок и устройств. Нужно ли E2E: оно запрещает поиск на сервере и превью в push. Хранение и маршрутизацию на сервере, звонки и ботов сразу отношу к вне рамок. На «решите сами» записываю допущения с числами.
:::

::: details Как гарантировать, что сообщение не потеряется и не задвоится
At-least-once плюс идемпотентность. При нажатии Enter клиент генерирует `clientId`, кладёт сообщение в outbox в IndexedDB и показывает его со статусом «отправляется». Сервер подтверждает `ack` с `id` и `seq`, и только тогда запись уходит из outbox. Если `ack` не пришёл, после переподключения сообщение переотправляется с тем же `clientId`, сервер узнаёт повтор по паре «отправитель, `clientId`» и отвечает тем же `ack`. Получатель тоже дедуплицирует по `seq`. Ключ создаётся один раз на намерение, а не на попытку. Окончательные ошибки (`nack`) не повторяются, а показываются с кнопкой «Повторить».
:::

::: details Как упорядочить сообщения и почему не по времени
По номеру `seq`, который сервер выдаёт внутри чата. Часы клиентов расходятся, а два сообщения могут получить одну миллисекунду, поэтому время отправителя даёт разный порядок у разных участников. Время показываю, но не сортирую по нему. Свои неподтверждённые сообщения номера ещё не имеют, поэтому стоят внизу в порядке создания и встают на место после `ack`. Outbox отправляю по порядку, чтобы два быстрых сообщения не поменялись местами. Пропуск в `seq` — сигнал догрузить диапазон по HTTP.
:::

::: details Как сделать «прочитано» и счётчики непрочитанного в групповых чатах
Курсорами, а не флагом у каждого сообщения. У каждого участника есть `readSeq` — «прочитано всё до этого номера». Галочки вычисляются сравнением с `seq`, «прочитали 5 из 12» — подсчётом курсоров, непрочитанное — `lastSeq - myReadSeq` без своих сообщений. Это одна запись на участника вместо записи на каждое сообщение. Прочитанным считаю сообщение, которое видно на экране в видимой вкладке с фокусом, а `read` шлю не чаще раза в секунду, и курсор только растёт. Изменение курсора приходит на другие устройства, и счётчик на ноутбуке гаснет после чтения на телефоне. В больших группах статусы прочтения отключаю.
:::

::: details Что происходит, когда соединение оборвалось и восстановилось
Обрыв часто не виден: TCP молчит, поэтому heartbeat с таймаутом, а переподключение — с экспоненциальной задержкой и jitter, чтобы после деплоя клиенты не пришли одновременно. После `open` клиент шлёт `resume` с последним номером события, и сервер досылает пропущенное. Если буфер уже не хранит такую глубину, приходит `resync`, и клиент перезагружает снимок: список чатов по HTTP и догон открытых чатов по `after=<seq>`. Только после догона отправляю outbox. Все входящие проходят одну функцию слияния с дедупликацией. Индикатор «Подключение…» показываю через пару секунд, а не мгновенно.
:::

::: details Как подгружать историю вверх и не сбить прокрутку
Курсор `before=<seq>` и подгрузка, когда до верха осталось меньше экрана. Вставка сверху не меняет `scrollTop`, поэтому видимое место уезжает. Запоминаю `scrollHeight` до вставки и после рендера прибавляю разницу. Можно положиться на scroll anchoring браузера, но тогда не делать ручную поправку, иначе экран сдвинется дважды. Отдельно — прилипание к низу: новое сообщение прокручивает вниз, только если пользователь внизу или сообщение своё, иначе появляется кнопка «↓ 3 новых». `column-reverse` решает прокрутку, но переворачивает порядок для скринридера и Tab.
:::

::: details Что делать, если чат открыт в нескольких вкладках
Не открывать соединение в каждой. Через Web Locks выбираю лидера: вкладка, получившая блокировку, держит сокет и рассылает события остальным через `BroadcastChannel`. Остальные шлют исходящие через лидера. Когда лидер закрывается, браузер передаёт блокировку следующей вкладке, и она переподключается с resume. Outbox общий в IndexedDB, отправляет его только лидер, поэтому дублей нет. Уведомления тоже показывает только лидер. Альтернатива — `SharedWorker`, он изящнее, но на Android поддерживается недавно. Service Worker не подходит: браузер останавливает его в простое.
:::

::: details Что меняет для фронтенда сквозное шифрование
Сервер видит только шифротекст, поэтому всё, что он делал с текстом, переезжает на устройство. Поиск — по локальному индексу. Превью в push — только «Новое сообщение» или расшифровка в Service Worker. История на новом устройстве — перенос со старого или зашифрованная резервная копия. Каждое устройство — свои ключи, и сообщение шифруется для каждого. Ключи храню как неизвлекаемые `CryptoKey` в IndexedDB, но XSS всё равно может ими пользоваться, поэтому строгий CSP обязателен. Протокол не изобретаю: Signal для личных чатов, MLS для групп. Главная слабость веба — код каждый раз приходит с сервера, и подменённый бандл обходит шифрование.
:::

## Задачи

### 1. Чат без сети · средне

Продолжение разбора: «А если пользователь в метро?». Что он увидит при открытии приложения без сети? Что будет с сообщениями, написанными в туннеле, и с теми, что ему прислали за это время?

::: details Решение и разбор
**Чтение.** Оболочка приложения — в precache Service Worker, список чатов и последние 100–200 сообщений каждого недавнего чата — в IndexedDB. Человек видит переписку и плашку «Нет подключения», а не пустой экран. Цена — место на устройстве и очистка при выходе из аккаунта ([уровни офлайна](non-functional.md)).

**Отправка.** Сообщение уходит в outbox с `clientId` и статусом «ожидает сети». Когда сеть вернулась (`online`, успешный heartbeat), Sync engine сначала догоняет входящие по `resume`, затем отправляет outbox по порядку. Своё сообщение получит `seq` после всего, что пришло за время туннеля. Это честно: так его увидят остальные. Время отправки стоит показывать как время нажатия, но сортировать по `seq`. **Входящие за время офлайна** приходят через `resume`. Если офлайн длился дни и сервер ответил `resync`, клиент перезагружает список чатов и догоняет только открытый чат, а остальные — при открытии.

**Чего не делать офлайн**: ставить в очередь большие вложения (100 МБ в IndexedDB ради очереди не держат) и создавать группы. Правку своего сообщения можно поставить в очередь отдельной мутацией с версией.
:::

### 2. В 10 раз больше пользователей · средне

Аудитория выросла в 10 раз. Серверы WebSocket упираются в число соединений, после каждого деплоя — шторм переподключений, групповые чаты на 5 000 человек кладут сервер статусами. Что может сделать фронтенд и чем заплатит?

::: details Решение и разбор
**Меньше соединений.** Одно на браузер, а не на вкладку: лидер через Web Locks (задача 4). Скрытая вкладка надолго — можно закрыть сокет и переключиться на Web Push, а при возврате переподключиться с `resume`. Цена — секунда задержки при возврате.

**Мягче переподключения.** Full jitter в backoff, сброс счётчика только после того, как соединение прожило несколько секунд. Сервер при деплое закрывает с `1001`, клиент ждёт случайную паузу ([деплой и thundering herd](../network/realtime.md)). `resume` вместо полной перезагрузки: догон дешевле снимка.

**Меньше событий в больших группах.** Статусы прочтения для групп больше N участников отключить или показывать только для своих сообщений по запросу. Набор текста — не чаще раза в 3–5 секунд и только «кто-то печатает» без списка. Онлайн-статусы — только для открытого чата и контактов на экране, подписка по запросу, а не на всех. Цена — точность UI: галочки в больших группах исчезают, «печатает» запаздывает. Порядок: одно соединение на браузер и jitter дают больше всего и почти не видны пользователю, ограничение статусов — следующим шагом вместе с продуктом.
:::

### 3. Чат на мобильном · средне

60 % пользователей — мобильный веб. Жалобы: «сообщения то уходят, то висят часами», «клавиатура закрывает поле ввода», «съедает батарею». Разберите причины и решения.

::: details Решение и разбор
- **«Висят»** — полуоткрытое соединение. Телефон сменил сеть, сокет в `OPEN`, но мёртв. Heartbeat с таймаутом 10 секунд, проверка соединения сразу по `online` и `visibilitychange`, а при таймауте `ack` — новое соединение и повтор из outbox ([heartbeat](../network/realtime.md)). Статус «не отправлено» с повтором вместо вечных часов. В фоне мобильный браузер замораживает вкладку целиком. При возврате первым делом `resume`.
- **Клавиатура**. Высота видимой области меняется. `100vh` не учитывает клавиатуру, поэтому раскладку строят на `dvh` или `visualViewport` с прокруткой к низу, когда поле получило фокус. Enter на мобильном — перевод строки, отправка — кнопкой.
- **Батарея и трафик**: частый heartbeat и «печатает» на каждое нажатие. Heartbeat 25–30 секунд, `typing` не чаще раза в 3 секунды, закрывать сокет в фоне и полагаться на push. Картинки — превью нужного размера, оригинал по нажатию. Голосовые и видео — `preload="none"`.
- **Прокрутка** длинной переписки на среднем Android: `content-visibility: auto` на пузырях, окно страниц вместо всей истории в DOM. Цели касания у «Отправить» и «Прикрепить» — 44–48 px.
:::

### 4. Одно соединение на все вкладки · сложно

Напишите `startTab(name, { connect, onEvent })` для каждой вкладки: только одна вкладка держит соединение, остальные получают события от неё и отправляют через неё. Когда вкладка-лидер закрывается, соединение должна поднять другая. API: Web Locks и `BroadcastChannel`.

::: details Решение и разбор
```js
// Each "tab" competes for one lock. The holder owns the socket; the others talk to it over BroadcastChannel.
function startTab(name, { connect, onEvent }) {
  const bus = new BroadcastChannel('chat');
  const abort = new AbortController();
  let socket = null;

  bus.onmessage = ({ data }) => {
    if (data.kind === 'event') onEvent(data.event); // the leader's fan-out
    if (data.kind === 'send' && socket) socket.send(data.payload); // a follower's outgoing message
  };

  navigator.locks
    .request('chat-leader', { signal: abort.signal }, async () => {
      socket = connect((event) => {
        onEvent(event); // the leader's own UI
        bus.postMessage({ kind: 'event', event }); // the sender never receives its own post
      });
      await new Promise((resolve) => abort.signal.addEventListener('abort', resolve)); // hold until the tab goes away
      socket.close();
      socket = null;
    })
    .catch((err) => { if (err.name !== 'AbortError') throw err; }); // closed while still waiting in the queue

  return {
    send(payload) {
      if (socket) socket.send(payload);
      else bus.postMessage({ kind: 'send', payload }); // nobody may be listening yet: keep it in the outbox until ack
    },
    close() { abort.abort(); bus.close(); },
  };
}
```

Проверено в Node 26 (там есть `navigator.locks` и `BroadcastChannel`) с поддельным `connect`: A стала лидером, сообщение B ушло через A и пришло обеим, после `a.close()` блокировку получила B и подключилась сама.

- **Почему Web Locks.** Блокировку освобождает браузер, когда вкладка закрыта или упала, а следующий запрос из очереди получает её сам. Ни голосования, ни слежки по таймерам. Блокировка держится, пока не выполнен промис колбэка, а `signal` снимает и ожидающий запрос (`AbortError`). Отправитель не получает свой `postMessage`, поэтому лидер вызывает `onEvent` сам.
- **Чего не хватает.** Сообщение, отправленное, пока лидера нет, потеряется. Поэтому настоящая отправка идёт через общий outbox в IndexedDB, а канал — только сигнал «в outbox новое». Новый лидер подключается с `resume` по `eventSeq` из IndexedDB. `steal: true` отбирает блокировку, но старый владелец продолжает работать: это крайняя мера против зависшей вкладки.

Сложность: O(1) на событие для лидера и O(число вкладок) на рассылку, которую делает браузер.
:::

## Источники

- [RFC 6455 — The WebSocket Protocol](https://www.rfc-editor.org/rfc/rfc6455)
- [HTML Living Standard — Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [HTML Living Standard — Broadcasting to other browsing contexts](https://html.spec.whatwg.org/multipage/web-messaging.html#broadcasting-to-other-browsing-contexts)
- [W3C Web Locks API](https://w3c.github.io/web-locks/)
- [W3C Indexed Database API 3.0](https://w3c.github.io/IndexedDB/)
- [RFC 9420 — The Messaging Layer Security (MLS) Protocol](https://www.rfc-editor.org/rfc/rfc9420)
- [MDN — BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
- [MDN — LockManager.request()](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request)
- [MDN — IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [MDN — Notification.requestPermission()](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static)
- [MDN — Badging API](https://developer.mozilla.org/en-US/docs/Web/API/Badging_API)
- [MDN — ARIA: log role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/log_role)
- [Signal — The Double Ratchet Algorithm](https://signal.org/docs/specifications/doubleratchet/)
- [GreatFrontEnd — Chat App (e.g. Messenger)](https://www.greatfrontend.com/questions/system-design/chat-application-messenger)
- [Находки «Ключевые темы senior frontend-интервью и System Design»](https://github.com/alexrehtide/learning/blob/research/senior-interview-topics/research/senior-interview-topics.md)
