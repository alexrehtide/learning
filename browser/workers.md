---
title: Web Workers, Service Workers и PWA
level: ядро
---

# Web Workers, Service Workers и PWA

> **Коротко.** Воркер — отдельный поток со своим event loop и глобальным объектом, но без DOM. С ним общаются сообщениями: `postMessage` копирует данные через structured clone, а transferable-объекты (`ArrayBuffer`, `MessagePort`, `OffscreenCanvas`) передаёт без копирования. Dedicated Worker принадлежит одной странице, Shared Worker общий для вкладок одного origin. Service Worker — воркер-прокси между страницами своего scope и сетью. Он живёт по событиям (`install`, `activate`, `fetch`), обновляется по жизненному циклу с фазой ожидания и кэширует ответы через Cache API, который HTTP-заголовки не учитывает. PWA — сайт с Web App Manifest, который можно установить, обычно с офлайн-режимом на Service Worker.

**Связанные темы:** [Event loop](../javascript/event-loop.md), [Функциональные приёмы и иммутабельность](../javascript/functional-programming.md), [Память и сборка мусора](../javascript/memory-and-gc.md), [Модули: ESM и CommonJS](../javascript/modules.md), [От ввода URL до отображения страницы](./from-url-to-pixels.md), [Конвейер рендеринга: layout, paint, composite](./rendering-pipeline.md), [События и событийная модель](./events.md), [HTTP-кэширование и CDN](../network/caching.md)

## Теория

### Зачем воркеры

JavaScript страницы, стили, layout и обработка ввода делят **главный поток**. Задача на 300 мс — это 300 мс без кликов и кадров ([Event loop](../javascript/event-loop.md)). Воркер (worker) запускает скрипт в **отдельном агенте**: свой поток, свой event loop, своя куча, свой глобальный объект. Памяти с главным потоком у него нет, есть только сообщения.

В воркере нет `window`, `document` и DOM. Есть `fetch`, `WebSocket`, IndexedDB, таймеры, `crypto`, `OffscreenCanvas`, `importScripts` (только в классических воркерах). Нет `localStorage`: это синхронный API, общий с главным потоком.

### Dedicated Worker

```js
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'parser' });
worker.postMessage({ text });
worker.onmessage = (event) => render(event.data);
worker.onerror = (event) => console.error(event.message); // uncaught error inside the worker
worker.terminate(); // kills it immediately, pending work is lost
```

- Скрипт — того же origin (или `blob:`/`data:` URL). `type: 'module'` разрешает `import` и поддержан везде: Chromium 80, Firefox 114, Safari 15.
- Внутри воркера: `self.onmessage`, `self.postMessage`, `self.close()`.
- Создание воркера — это новый изолят, загрузка и разбор скрипта, мегабайты памяти. Воркеры переиспользуют (один долгоживущий или пул), а не создают на каждую задачу.

### `postMessage`: копия, а не ссылка

`postMessage(data, transfer)` **синхронно сериализует** `data` в отправителе по structured clone algorithm (подробно — [«Функциональные приёмы»](../javascript/functional-programming.md#копирование-поверхностное-и-глубокое)), а получатель десериализует копию в своей задаче `message`. Следствия (проверено в Chromium 157):

- Функция, DOM-узел, `Proxy` (и реактивный объект Vue) → `DataCloneError` **сразу в отправителе**, сообщение не уходит.
- Экземпляр класса приходит обычным объектом: прототип теряется. `Date`, `Map`, `Set`, `Blob`, typed arrays, циклы — сохраняются.
- Сериализация тратит время **главного потока**. Отправить 50 МБ JSON-подобных объектов — та же долгая задача, от которой бежали.
- Порядок сообщений по одному каналу сохраняется. Если получатель не смог десериализовать данные, ему придёт событие `messageerror`, а не `message`.

**Transfer.** Второй аргумент — список transferable-объектов: они **передаются**, а не копируются. Отправитель теряет к ним доступ: `ArrayBuffer` становится detached (`byteLength === 0`), повторная передача бросает `DataCloneError` (задача 1). Передаются `ArrayBuffer`, `MessagePort`, `ImageBitmap`, `OffscreenCanvas`, потоки (`ReadableStream` и другие; в Safari — с 27). Передача — O(1) по объёму: меняется владелец памяти, байты не копируются.

**Общая память.** `SharedArrayBuffer` не копируется и не передаётся: обе стороны видят одни байты и синхронизируются через `Atomics`. Он доступен, только если страница **cross-origin isolated** (`crossOriginIsolated === true`). Для этого нужны заголовки `Cross-Origin-Opener-Policy: same-origin` и `Cross-Origin-Embedder-Policy: require-corp` (или `credentialless`). Так закрыли атаки класса Spectre через точные таймеры. Скрипт воркера на такой странице тоже отдают с COEP, иначе воркер не загрузится. `Atomics.wait` на главном потоке бросает `TypeError`, блокироваться можно только в воркере (оба факта проверены в Chromium 157).

### Каналы: `MessageChannel` и `BroadcastChannel`

- `MessageChannel` — пара связанных портов `port1`/`port2`. Порт можно передать (transfer) в воркер или iframe и получить прямой канал «точка — точка», например для RPC (задача 2) или связи двух воркеров минуя страницу.
- `BroadcastChannel(name)` — шина «один ко многим» для всех контекстов одного origin: вкладки, iframe, воркеры. Отправитель своё сообщение не получает. Типичное применение — «разлогиниться во всех вкладках».

### Shared Worker

`new SharedWorker(url, name)` — **один** экземпляр на (URL, имя, origin), общий для всех вкладок. Каждая вкладка получает в воркере событие `connect` со своим `MessagePort`. Воркер живёт, пока жив хотя бы один клиент.

```js
// shared.js
const ports = new Set();
self.onconnect = (event) => {
  const port = event.ports[0];
  ports.add(port);
  port.onmessage = (e) => ports.forEach((p) => p.postMessage(e.data)); // fan-out
};
```

Применение — одно WebSocket-соединение на все вкладки, общий кэш, единая очередь запросов. Поддержка долго была дырявой: Safari вернул Shared Worker в 16, Chrome на Android — только в 148 (MDN browser-compat-data, сверено 2026-11-12). Запасной вариант — «лидер» среди вкладок через Web Locks и рассылка через `BroadcastChannel`.

> [!WARNING]
> Если порт слушают через `addEventListener('message')`, нужен явный `port.start()`. Присваивание `port.onmessage` запускает порт само. Забытый `start()` — частая причина «сообщения не доходят».

### Service Worker: прокси под управлением событий

Service Worker (SW) — воркер, который браузер запускает **по событию** (`fetch`, `push`, `message`) и останавливает, когда тот простаивает (в Chromium — примерно через 30 секунд). Отсюда правила:

- Глобальные переменные **не переживают** остановку. Состояние — в IndexedDB или Cache API.
- Синхронных API нет: ни `localStorage`, ни синхронного XHR.
- Долгую работу объявляют через `event.waitUntil(promise)`, иначе браузер вправе остановить воркер раньше.
- Только secure context: HTTPS или `localhost`.

**Регистрация и scope.**

```js
navigator.serviceWorker.register('/sw.js', { scope: '/', type: 'module', updateViaCache: 'imports' });
```

- **Scope** — префикс URL, страницы под которым SW контролирует. По умолчанию — каталог скрипта: `/a/sw.js` получит `/a/`. Шире каталога скрипта нельзя (`SecurityError`), если сервер не разрешит заголовком `Service-Worker-Allowed: /` (проверено в Chromium 157). Поэтому `sw.js` обычно кладут в корень.
- Страница выбирает контролирующий SW **при создании документа** и до конца жизни его не меняет. Исключение — `clients.claim()`. Поэтому при первом визите страница **не контролируется**, даже когда SW уже активен (проверено).
- Жёсткая перезагрузка (Shift + Reload) обходит SW: страница не контролируется.
- `type: 'module'` в SW: Chromium 91, Safari 15, Firefox 147.

### Жизненный цикл

| Состояние | Событие | Что делают |
| --- | --- | --- |
| `installing` | `install` | предзагрузка оболочки в кэш (`waitUntil(cache.addAll(...))`); отказ промиса → воркер `redundant` |
| `installed` (waiting) | — | ждёт, пока старую версию не отпустят все клиенты |
| `activating` | `activate` | удаление кэшей старых версий, миграции |
| `activated` | `fetch`, `message`, `push` | обслуживает клиентов |
| `redundant` | — | заменён или не установился |

**Обновление.** Браузер проверяет скрипт при навигации в scope, при функциональных событиях, если с прошлой проверки прошло больше 24 часов, и при `registration.update()`. Скрипт и его `importScripts` сравниваются **побайтово**: если ничего не изменилось, новой версии нет (проверено). `updateViaCache` по умолчанию `'imports'`: главный скрипт запрашивается мимо HTTP-кэша, импортируемые — через него.

**Ожидание.** Новая версия устанавливается **рядом** со старой и ждёт. Пока хотя бы одна вкладка контролируется старой версией, новая не активируется. **Перезагрузка не помогает**: новая страница загружается до выгрузки старой, клиент не исчезает ни на миг. Помогает закрыть все вкладки scope (проверено в Chromium 157). Зачем так: страница, загруженная со старыми ассетами, не должна вдруг получать ответы нового SW со своим набором кэшей.

- `self.skipWaiting()` — активироваться сразу. Старые вкладки переходят под новый SW (событие `controllerchange` на странице), хотя их JS — от старой сборки. Это безопасно, только если версии совместимы, или если страница сразу перезагрузится (задача 4).
- `clients.claim()` в `activate` — взять под контроль страницы, которые ещё не контролируются, в том числе первый визит.

### Перехват `fetch`

Событие `fetch` приходит на навигации и подресурсы контролируемых страниц (и их dedicated-воркеров). Без `respondWith` запрос уходит в сеть как обычно.

- `event.respondWith(promise)` нужно вызвать **синхронно, пока идёт диспатч**. После `await caches.match(...)` уже поздно: `InvalidStateError`, а запрос молча уходит в сеть (проверено в Chromium 157). `await null` при этом проходит: микрозадачи выполняются до конца диспатча, как с `preventDefault` в [«Событиях»](./events.md#обработчики-и-микрозадачи). Правило простое: передайте в `respondWith` промис, а асинхронную логику спрячьте внутрь него.
- `fetch()` из SW идёт **через HTTP-кэш** браузера, как и любой другой.
- **Navigation preload.** Старт остановленного SW стоит десятки миллисекунд на каждой навигации. `registration.navigationPreload.enable()` запускает сетевой запрос параллельно со стартом, ответ — в `event.preloadResponse`. Поддержано везде: Chromium 59, Firefox 99, Safari 15.4.
- **Opaque-ответы** (кросс-доменные `no-cors`, например картинка с CDN без CORS) имеют `status === 0`, их содержимое и успех не видны. Закэшировать можно, но в квоте они раздуваются (padding: размер скрыт, в Chromium — порядка мегабайт на ответ).

### Cache API против HTTP-кэша

`caches` — хранилище пар `Request → Response` под контролем **вашего кода**. Оно доступно и на странице, не только в SW.

| | HTTP-кэш | Cache API |
| --- | --- | --- |
| Кто управляет | браузер по заголовкам `Cache-Control`, `ETag` | ваш код: `put`, `match`, `delete` |
| Срок жизни | по заголовкам, вытесняется браузером | пока вы не удалите (или не вытеснит квота) |
| Заголовки ответа | учитываются | **игнорируются**: ответ с `no-store` сохраняется и отдаётся (проверено) |
| Что хранится | GET-ответы | только GET: `put` с `POST` → `TypeError` |

Поиск идёт по URL **с query-строкой** (`?v=2` — другой ключ, `ignoreSearch: true` отключает) и учитывает `Vary`. Удаление старых версий — ваша работа: кэш с хэшированными чанками растёт с каждым деплоем, если в `activate` не удалять чужие кэши. Подробно об HTTP-кэше — в теме [HTTP-кэширование и CDN](../network/caching.md).

**Стратегии кэширования:**

| Стратегия | Как | Для чего |
| --- | --- | --- |
| Cache first | кэш, при промахе — сеть и запись в кэш | хэшированные ассеты, шрифты |
| Network first | сеть, при ошибке или таймауте — кэш | HTML-навигации, данные API |
| Stale-while-revalidate | сразу кэш, параллельно обновить кэш из сети | аватары, некритичные данные |
| Cache only | только кэш | предзагруженная оболочка (app shell) |
| Network only | только сеть | `POST`, аналитика, платежи |

На практике стратегии собирают из Workbox, а не пишут руками. Руками их пишут на интервью (задача 3).

### Web App Manifest и установка

Манифест — JSON по `<link rel="manifest" href="/app.webmanifest">`: `name`/`short_name`, `start_url`, `scope`, `display` (`standalone`, `fullscreen`, `minimal-ui`), `icons`, `id`, `theme_color`, `background_color`.

Критерии установки в Chromium (web.dev, сверено 2026-11-12): HTTPS; приложение ещё не установлено; пользователь хотя бы раз кликнул и провёл на странице 30 секунд; в манифесте есть `name` или `short_name`, иконки 192 и 512 px, `start_url`, `display` из списка выше, а `prefer_related_applications` нет или он `false`. Service Worker в критериях больше не значится. Офлайн-режим — отдельное свойство PWA, а не условие установки.

> [!WARNING]
> Установка зависит от браузера. `beforeinstallprompt` (своя кнопка «Установить») есть только в Chromium. Safari ставит сайт через «Поделиться → На экран Домой» на iOS и «Add to Dock» на macOS (Safari 17+). Firefox на десктопе манифест для установки не использует (MDN browser-compat-data, сверено 2026-11-12). Web Push на iOS (16.4+) работает только у сайта, добавленного на экран Домой. Background Sync — только Chromium.

### Vue и Nuxt

- **Vite** собирает воркер, если `new URL(...)` стоит **прямо** внутри `new Worker(...)`, а опции — литералы: `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`. Альтернатива — `import Parser from './parser.ts?worker'` (или `?sharedworker`) — импорт конструктора.
- **SSR.** На сервере `Worker` нет. Создавайте воркер в `onMounted` (или в клиентском плагине `*.client.ts` в Nuxt) и вызывайте `terminate()` в `onBeforeUnmount`, иначе каждый заход на страницу оставит живой поток.
- **Реактивные данные.** `worker.postMessage(state)` с `reactive`/`ref`-значением бросает `DataCloneError`: это `Proxy`. Передавайте сырую копию — разбор `toRaw` и вложенных прокси в [«Функциональных приёмах»](../javascript/functional-programming.md).
- **PWA в Nuxt** встроенно не поддерживается. Обычно берут модуль сообщества `@vite-pwa/nuxt` (Workbox под капотом). Навигации SSR-страниц кэшируют по network first: HTML из кэша ссылается на чанки, которых после деплоя уже нет на сервере. Такую ошибку загрузки чанка Nuxt 4 по умолчанию обрабатывает перезагрузкой маршрута (`experimental.emitRouteChunkError: 'automatic'`, хук `app:chunkError`).

## Примеры

```js
// main.js: heavy parsing off the main thread, result buffer transferred back
const worker = new Worker(new URL('./csv-worker.js', import.meta.url), { type: 'module' });

export function parseCsv(file) {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => resolve(new Float64Array(e.data)); // e.data is an ArrayBuffer
    worker.onerror = (e) => reject(new Error(e.message));
    worker.postMessage(file); // File is cloned by reference to the same blob data, cheap
  });
}

// csv-worker.js
self.onmessage = async (e) => {
  const text = await e.data.text();
  const numbers = Float64Array.from(text.split(/[,\n]/).filter(Boolean), Number);
  self.postMessage(numbers.buffer, [numbers.buffer]); // transfer, no copy
};
```

```js
// sw.js: precache the shell, drop old caches, serve by strategy
const VERSION = 'v42';
const SHELL = ['/', '/offline.html', '/assets/app.3f9a1c.js', '/assets/app.8b2e4d.css'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.registration.navigationPreload?.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // network only
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(event)); // called synchronously
  } else if (new URL(request.url).pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request))); // cache first
  }
});

async function networkFirst(event) {
  try {
    return (await event.preloadResponse) ?? (await fetch(event.request));
  } catch {
    return (await caches.match(event.request)) ?? caches.match('/offline.html');
  }
}
```

## Вопросы с интервью

::: details Чем Web Worker отличается от Service Worker?
Оба — воркеры: отдельный поток, нет DOM, общение через `postMessage`. Различаются назначением и временем жизни. Dedicated Worker создаёт страница, он живёт, пока жива страница или до `terminate()`, и нужен для вычислений вне главного потока. Service Worker регистрируется на scope, существует независимо от вкладок, браузер запускает его на события и останавливает при простое. Его роль — прокси между страницами и сетью: перехват `fetch`, кэш, push, офлайн. У SW есть жизненный цикл с установкой, ожиданием и активацией, у обычного воркера его нет. SW требует HTTPS, а глобальное состояние в нём ненадёжно.
:::

::: details Что происходит с объектом при отправке в воркер и когда нужен transfer?
`postMessage` синхронно сериализует данные в отправителе по structured clone algorithm, получатель получает копию. Функции, DOM-узлы и `Proxy` дают `DataCloneError` сразу при вызове. Прототип класса теряется, `Date`, `Map`, `Set`, циклы сохраняются. Цена — время сериализации на главном потоке, пропорциональное размеру, и двойная память. Transfer нужен для больших бинарных данных: `ArrayBuffer`, `ImageBitmap`, `OffscreenCanvas`, потоки передаются за O(1), но отправитель теряет к ним доступ — буфер становится detached. Если нужен общий доступ без копий — `SharedArrayBuffer` с `Atomics`, но только на cross-origin isolated странице.
:::

::: details Почему новая версия Service Worker не включается после перезагрузки страницы?
Новая версия устанавливается и ждёт (`waiting`), пока старую не перестанут использовать все клиенты. При перезагрузке новая страница загружается раньше, чем выгружается старая, поэтому клиент под старой версией есть всегда. Активация произойдёт, когда закроют все вкладки scope. Так спецификация защищает страницу, загруженную со старыми ассетами, от ответов нового SW. Ускорить можно через `skipWaiting()`, но тогда старые страницы окажутся под новым SW. Безопасный вариант — показать «Доступна новая версия», по клику отправить SW сообщение на `skipWaiting` и перезагрузить страницу по `controllerchange`.
:::

::: details Чем Cache API отличается от HTTP-кэша?
HTTP-кэшем управляет браузер по заголовкам `Cache-Control`, `ETag`, `Vary`: он сам решает, свежий ли ответ, и сам вытесняет записи. Cache API — программное хранилище пар запрос–ответ: заголовки кэширования игнорируются (ответ с `no-store` сохранится), срока жизни нет, удаление и версии — забота кода. Хранит только GET, ключ — URL с query-строкой. Слои работают вместе: `fetch()` из Service Worker сам проходит через HTTP-кэш. Поэтому `sw.js` и HTML обычно отдают с `no-cache`, а хэшированные ассеты — с долгим `max-age` и `immutable`.
:::

::: details Какие стратегии кэширования вы знаете и что для чего подходит?
Cache first — для неизменяемых ресурсов с хэшем в имени: из кэша, при промахе — из сети. Network first — для HTML и данных, где важна свежесть: сначала сеть, кэш — запасной вариант офлайн или по таймауту. Stale-while-revalidate — отдать из кэша сразу и обновить в фоне, когда допустимо показать чуть устаревшее: аватары, ленты, справочники. Cache only — для предзагруженной оболочки. Network only — для мутаций, аналитики, платежей. Отдельно решают, сколько хранить (лимиты числа записей и возраста), что делать с opaque-ответами и как чистить кэш при деплое.
:::

::: details Почему в Service Worker нельзя хранить состояние в глобальных переменных?
Браузер запускает SW на событие и останавливает при простое — в Chromium примерно через 30 секунд. При следующем событии скрипт выполняется заново, и глобальные переменные начинаются с начальных значений. Счётчик или очередь запросов в памяти пропадут в произвольный момент. Состояние хранят в IndexedDB или Cache API, а незаконченную асинхронную работу оборачивают в `event.waitUntil`, чтобы браузер не остановил воркер посреди неё.
:::

::: details Когда перенос работы в воркер не ускорит приложение?
Когда работа связана с DOM: воркер не видит документ, а layout и paint всё равно на главном потоке (исключение — `OffscreenCanvas`). Когда задача короткая: создание воркера и сериализация данных туда и обратно стоят больше самой задачи. Когда данных много, а считать мало: копирование большого графа объектов само станет долгой задачей. Тогда помогают transfer бинарных данных, разбиение работы на куски с `scheduler.yield()` или устранение лишней работы. Воркер хорош для тяжёлых вычислений с компактным входом и выходом: парсинг, сжатие, криптография, поиск, обработка изображений.
:::

## Задачи

### 1. Что станет с буфером · легко

Что выведет код в главном потоке?

```js
const worker = new Worker('/echo.js');
const buf = new ArrayBuffer(8);
worker.postMessage({ buf }, [buf]);
console.log(buf.byteLength);
try {
  worker.postMessage({ buf }, [buf]);
} catch (e) {
  console.log(e.name);
}
try {
  worker.postMessage({ format: (x) => x.toFixed(2) });
} catch (e) {
  console.log(e.name);
}
```

::: details Решение и разбор
```
0
DataCloneError
DataCloneError
```

После передачи буфер detached: память теперь принадлежит воркеру, `byteLength` в отправителе — `0`. Повторная передача detached-буфера — `DataCloneError`. Функцию structured clone не сериализует — тоже `DataCloneError`, причём синхронно, в отправителе: ошибки сериализации видны в месте вызова, а не в воркере. Проверено в Chromium 157.

Если буфер нужен и отправителю, его не передают, а копируют (`postMessage({ buf })` без списка) или передают копию `buf.slice(0)`.
:::

### 2. RPC поверх `postMessage` · средне

Напишите `wrap(worker)`, который возвращает `call(method, ...args)` → `Promise`. Ответы могут приходить в любом порядке. Ошибка в воркере должна отклонять промис именно этого вызова. Напишите и сторону воркера `expose(handlers)`.

::: details Решение и разбор
```js
// main thread
export function wrap(worker) {
  let nextId = 0;
  const pending = new Map();
  worker.addEventListener('message', (e) => {
    const { id, result, error } = e.data;
    const call = pending.get(id);
    if (!call) return;
    pending.delete(id);
    error ? call.reject(Object.assign(new Error(error.message), { name: error.name })) : call.resolve(result);
  });
  return function call(method, ...args) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, method, args });
      } catch (err) {
        pending.delete(id); // DataCloneError is thrown synchronously
        reject(err);
      }
    });
  };
}

// worker
export function expose(handlers) {
  self.addEventListener('message', async (e) => {
    const { id, method, args } = e.data;
    try {
      if (!(method in handlers)) throw new Error(`Unknown method: ${method}`);
      self.postMessage({ id, result: await handlers[method](...args) });
    } catch (err) {
      self.postMessage({ id, error: { name: err.name, message: err.message } });
    }
  });
}
```

- Корреляция по `id` нужна, потому что асинхронные обработчики завершаются в любом порядке.
- `Error` structured clone поддерживает, но свои поля и подклассы теряются. Явная форма `{ name, message }` надёжнее и не падает на несериализуемом `cause`.
- `DataCloneError` при отправке ловится синхронно, иначе запись в `pending` повиснет навсегда.
- Чего нет: таймаутов, отмены (передать `AbortSignal` нельзя — его не клонировать, нужно отдельное сообщение `cancel`), передачи transfer-списка. Всё это даёт библиотека Comlink, построенная на той же идее и `MessageChannel`.

Решение проверено в Chromium 157: ответы приходят не по порядку вызовов, `RangeError` доходит с именем, функция в аргументах отклоняет промис `DataCloneError`.

Сложность: O(1) на вызов, память O(число незавершённых вызовов).
:::

### 3. Почему stale-while-revalidate не работает · средне

Обработчик должен отдавать ответ из кэша и обновлять кэш в фоне. На деле страница всегда получает ответ из сети, а в консоли SW — `InvalidStateError`. Найдите обе ошибки и исправьте.

```js
self.addEventListener('fetch', async (event) => {
  const cache = await caches.open('swr');
  const cached = await cache.match(event.request);
  const network = fetch(event.request).then((res) => {
    cache.put(event.request, res);
    return res;
  });
  event.respondWith(cached ?? network);
});
```

::: details Решение и разбор
```js
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open('swr');
    const cached = await cache.match(event.request);
    const network = fetch(event.request).then((res) => {
      if (res.ok) return cache.put(event.request, res.clone()).then(() => res);
      return res;
    });
    event.waitUntil(network.catch(() => {})); // keep the SW alive until the cache is updated
    return cached ?? network;
  })());
});
```

1. `respondWith` вызван после `await`. К этому моменту диспатч `fetch` закончился, вызов бросает `InvalidStateError`, а браузер, не получив ответа, отправляет запрос в сеть сам. Слушатель-`async` здесь не помогает: возвращённый промис никто не ждёт. `respondWith` вызывают синхронно и передают в него промис.
2. Тело `Response` читается один раз. Один и тот же `res` нельзя и положить в кэш, и отдать странице — нужен `res.clone()`.

Ещё две детали. `waitUntil` продлевает жизнь SW до конца фонового обновления: иначе после отдачи ответа из кэша браузер может остановить воркер, не дождавшись `put`. `res.ok` не даёт закэшировать `500`. Вызывать `waitUntil` внутри промиса, переданного в `respondWith`, можно: событие ещё живо, пока этот промис не завершился. Оба варианта проверены в Chromium 157: исходный каждый раз отдаёт ответ сети, исправленный на втором запросе отдаёт кэш, а на третьем — уже обновлённый ответ.
:::

### 4. Кнопка «Доступна новая версия» · сложно

После деплоя пользователи сидят на старой версии, пока не закроют все вкладки. Нужно показать баннер, когда новая версия установлена, а по клику — переключиться на неё без смеси старого JS и нового SW. Реализуйте клиентскую часть и часть SW. Что будет, если перезагружаться на любой `controllerchange`?

::: details Решение и разбор
```js
// sw.js
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// page
export async function watchForUpdates(showBanner) {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.register('/sw.js');

  const offer = (worker) => showBanner(() => worker.postMessage({ type: 'SKIP_WAITING' }));
  const hadController = Boolean(navigator.serviceWorker.controller);

  if (reg.waiting && hadController) offer(reg.waiting); // installed while the tab was closed
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker.addEventListener('statechange', () => {
      // 'installed' with an existing controller means "update", without it means "first install"
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
    });
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // first install with clients.claim(): nothing to reload
    reloading = true;
    location.reload();
  });

  setInterval(() => reg.update(), 60 * 60 * 1000); // long-lived tabs: check hourly
}
```

- Различать «первая установка» и «обновление» нужно по наличию `controller`. При первом визите тоже бывает `installed` и, с `clients.claim()`, `controllerchange` — без проверки страница перезагрузится на ровном месте.
- Флаг `reloading` защищает от двойной перезагрузки. А если включить DevTools-опцию «Update on reload», безусловная перезагрузка на `controllerchange` уходит в бесконечный цикл.
- `skipWaiting()` переключает **все** вкладки, а нажал кнопку пользователь одной. Остальные получат `controllerchange` и тоже перезагрузятся — иначе они останутся со старым JS под новым SW. Если перезагрузка без спроса недопустима (несохранённая форма), вкладка может вместо этого показать баннер.
- Для долгоживущих SPA проверка обновлений только на навигациях редка, отсюда `reg.update()` по таймеру или при `visibilitychange`.

В Workbox то же самое даёт `workbox-window` (событие `waiting`, `messageSkipWaiting()`), в `@vite-pwa/nuxt` — режим `registerType: 'prompt'`.
:::

## Источники

- [HTML Living Standard: Web workers](https://html.spec.whatwg.org/multipage/workers.html)
- [HTML Living Standard: Cross-document messaging, channel messaging, broadcasting](https://html.spec.whatwg.org/multipage/web-messaging.html)
- [HTML Living Standard: Structured data, transferable objects](https://html.spec.whatwg.org/multipage/structured-data.html)
- [W3C: Service Workers](https://w3c.github.io/ServiceWorker/)
- [W3C: Web Application Manifest](https://w3c.github.io/manifest/)
- [MDN: Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API), [Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [MDN: Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API), [Cache](https://developer.mozilla.org/en-US/docs/Web/API/Cache)
- [MDN: SharedWorker](https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker), [BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)
- [MDN: Window.crossOriginIsolated](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated)
- [MDN browser-compat-data](https://github.com/mdn/browser-compat-data) — поддержка, сверено 2026-11-12
- [web.dev: The service worker lifecycle](https://web.dev/articles/service-worker-lifecycle)
- [web.dev: What does it take to be installable?](https://web.dev/articles/install-criteria)
- [web.dev: Speed up service worker with navigation preloads](https://web.dev/blog/navigation-preload)
- [Chrome for Developers: Workbox — caching strategies](https://developer.chrome.com/docs/workbox/caching-strategies-overview)
- [Vite: Web Workers](https://vite.dev/guide/features.html#web-workers)
- [Nuxt: Experimental features — emitRouteChunkError](https://nuxt.com/docs/4.x/guide/going-further/experimental-features)
