---
title: 'Nitro: серверные маршруты и деплой'
level: ядро
---

# Nitro: серверные маршруты и деплой

> **Коротко.** Nitro — серверный движок Nuxt: он собирает `server/` и SSR-рендерер в один h3-сервер и упаковывает его под платформу (пресет) в `.output/`. h3 — минимальный HTTP-фреймворк, на котором всё работает: обработчик получает `event` и возвращает значение, а Nitro превращает его в ответ. Маршруты генерируются из имён файлов, `$fetch` на сервере вызывает свой маршрут в том же процессе без сети, а кэш (`defineCachedEventHandler`, `cachedFunction`, `routeRules`) лежит в хранилище unstorage. По умолчанию это память процесса. Пресет определяет, что доступно в рантайме: на node-server есть файловая система и долгий процесс, на edge — только web API и заглушки `node:*`.

**Связанные темы:** [Структура проекта и auto-imports](./project-structure.md), [Режимы рендеринга и lazy hydration](./rendering-modes.md), [Работа с данными: `$fetch`, `useFetch`, `useAsyncData`](./data-fetching.md), [Middleware и плагины](./middleware-and-plugins.md), [Состояние и конфигурация: `useState` vs Pinia, `runtimeConfig`](./state-and-config.md), [HTTP](../network/http.md), [HTTP-кэширование и CDN](../network/caching.md), [Same-origin policy, CORS и cookies](../network/cors-and-cookies.md), [CSRF, clickjacking и supply chain](../security/csrf-and-clickjacking.md), [Аутентификация на фронтенде](../security/authentication.md)

## Теория

Все фрагменты проверены на Nuxt 4.6.4 с Nitro 2.13.6 (h3 1.15.11) в Node 26.13.1. Ответы сняты `curl` с `nuxi build` + `node .output/server/index.mjs`. Пресеты `cloudflare-module` и `vercel` собраны через `NITRO_PRESET`, их вывод изучен на диске, но не запущен на платформе. Типы проверены `vue-tsc -b` на TypeScript 6.0.3. Устройство описано по исходникам: `nitropack/dist/runtime/internal/app.mjs`, `cache.mjs`, `storage.mjs`, h3 `dist/index.mjs`, `nuxt/dist/server/` и `@nuxt/nitro-server/dist/runtime/server.mjs`.

### Nitro и h3

h3 отвечает за запрос: `createApp`, роутер на radix-дереве, `event` и функции-хелперы (`getQuery`, `readBody`, `setCookie`). Обработчик в h3 — функция `(event) => value`. Если она вернула объект, h3 отдаёт JSON, строку — как есть, а брошенная ошибка становится ответом с её статусом. В отличие от Express, здесь нет `res.send` и `next()`: ответ задаёт возвращаемое значение.

Nitro отвечает за сборку и рантайм вокруг h3:

- сканирует `server/` и генерирует таблицу обработчиков;
- собирает сервер Rollup-ом и трассирует зависимости в `.output/server/node_modules`;
- даёт хранилище (`useStorage`), кэш, плагины с хуками, `runtimeConfig`;
- через пресет адаптирует один и тот же h3-app к Node, serverless-функции или edge-воркеру.

Nuxt подключает к Nitro свой SSR-рендерер как обработчик `/**`. Поэтому страница и API — обработчики одного h3-приложения.

### Как имена файлов становятся маршрутами

| Каталог | Что это | Маршрут |
| --- | --- | --- |
| `server/api/` | API-обработчики | `/api/...` |
| `server/routes/` | обработчики без префикса | `/sitemap.xml`, `/feed` |
| `server/middleware/` | выполняются на **каждый** запрос до маршрутов | без маршрута |
| `server/plugins/` | выполняются один раз при старте сервера | без маршрута |
| `server/utils/` | авто-импорт на сервере | — |

Имя файла задаёт путь и метод: `users/[id].get.ts` → `GET /api/users/:id`, `[...].ts` → catch-all, `index.post.ts` → `POST` на каталог. Файл без суффикса принимает любой метод. В сгенерированном `.output/server/chunks/_/nitro.mjs` видна вся таблица (сокращено):

```js
const handlers = [
  { route: '', handler: _PKVios, middleware: true },            // static assets from public/
  { route: '', handler: _kat6eI, middleware: true },            // server/middleware/01.context.ts
  { route: '/api/hello', handler: _lazy_KF9AcZ, lazy: true, method: "get" },
  { route: '/api/hello', handler: _lazy_utK20k, lazy: true, method: "post" },
  { route: '/api/users/:id', handler: _lazy_JYHyFc, lazy: true, method: "get" },
  { route: '/sitemap.xml', handler: _lazy_Ug7tZ9, lazy: true },
  { route: '/**', handler: _lazy_cVimHw, lazy: true },          // Nuxt SSR renderer
]
```

Каждый маршрут — отдельный чанк в `chunks/routes/`, загружается лениво при первом запросе (`lazyEventHandler`). Middleware и плагины импортируются сразу.

### Путь запроса

`createNitroApp` в `app.mjs` собирает h3-приложение так:

1. `onRequest`: кладёт в `event` методы `event.fetch`, `event.$fetch`, `event.waitUntil` и вызывает хук `request` плагинов.
2. Обработчик `routeRules`: `redirect`, `headers`, `proxy`, `cors`.
3. Middleware по порядку: сначала статика из `public/`, затем `server/middleware/` по имени файла.
4. Роутер: API, `server/routes`, рендерер `/**`. Маршрут с `cache` в `routeRules` при этом оборачивается в `cachedEventHandler`.
5. Ошибка в любом шаге → хук `error` плагинов → `errorHandler` Nuxt.

Server middleware ничего не возвращает: если вернуть значение, оно станет ответом, и маршрут не выполнится. Чем она отличается от route middleware Vue-приложения — в теме [«Middleware и плагины»](./middleware-and-plugins.md#server-middleware-—-другои-механизм).

> [!WARNING]
> Документация обещает `405` на неподходящий метод. В Nuxt 4.6.4 `PUT /api/hello` при наличии только `hello.get.ts` вернул **404** `Page not found: /api/hello`: запрос провалился в рендерер `/**`, Vue Router выдал `No match found`, и сервер отрендерил страницу ошибки. С неизвестным `/api/nope` то же самое: полный SSR-проход, HTML для браузера и JSON для `curl`. Задача 1 — как это закрыть.

Плагин Nitro — функция `(nitroApp) => void`, она вызывается один раз при старте. `runNitroPlugins` вызывает её **без `await`**: в асинхронном плагине сервер начнёт принимать запросы раньше, чем плагин закончит работу. Это проверено: `/api/ready` сразу после старта ответил `{"ready":false}`. Плагины нужны для хуков (`request`, `afterResponse`, `error`, `render:html`) и для `useStorage().mount(...)`, а не для асинхронной инициализации. Асинхронную инициализацию делают лениво, при первом запросе.

### Хелперы h3

- `getQuery(event)` — объект строк. `?n=1&tag=a&tag=b` → `{ n: '1', tag: ['a', 'b'] }`: число не приводится, повтор становится массивом.
- `readBody(event)` — разбирает JSON и `application/x-www-form-urlencoded` (проверено: оба дали `{ name: 'x' }`). Тело не проверяется, тип `<T>` — только обещание.
- `readValidatedBody(event, validate)` и `getValidatedQuery` — тело или query через функцию. `false` или исключение превращаются в `400 Validation Error`, `true` пропускает данные. Любое другое значение **заменяет** данные, а `undefined` пропускает их как есть. Тип результата — тип возврата валидатора: при `(b) => isPayload(b)` это `boolean`, и `body.name` даёт `TS2339`. Поэтому передают `schema.parse` из Zod или Valibot: он бросает ошибку и возвращает типизированное значение.
- `getRouterParam(event, 'id')` — строка из `:id`, число из неё надо получить самому.
- `createError({ statusCode, statusMessage, data })` — ошибка со статусом. Строка статуса уходит в status line, а `data` — в JSON ответа.

**Что клиент видит при ошибке.** Необработанный `throw new Error('db password is hunter2')` в production вернул `500` `{"statusMessage":"Server Error","message":"Server Error"}`: h3 помечает ошибку `unhandled`, и Nuxt скрывает текст. Полный стек при этом попадает в лог сервера и в хук `error`. Но `createError({ statusCode: 500, message: 'explicit secret message' })` вернул текст как есть: ошибку, созданную явно, Nuxt считает предназначенной клиенту. Значит, в `message` и `data` нельзя класть внутренние детали.

### `$fetch` к своим маршрутам

Nitro подменяет `globalThis.$fetch`. Для пути, который начинается с `/`, `localFetch` не открывает сокет: через `node-mock-http` он создаёт фейковые `req`/`res` и прогоняет их через тот же h3-обработчик. Внешний URL уходит в обычный `fetch`. Внутренний вызов — **новый запрос**: middleware выполняется снова (`mwCount: 1` у вложенного вызова), контекст `event.context` не наследуется.

Заголовки тоже не наследуются. Проверено: `/api/internal` вызвал `/api/cookie-echo` двумя способами при входящем `cookie: sid=abc`:

```json
{ "plain": { "cookie": null }, "viaEvent": { "cookie": "sid=abc" } }
```

`event.$fetch` (`fetchWithEvent`) копирует заголовки входящего запроса, кроме hop-by-hop, `host` и `accept`. В коде Vue-приложения та же логика — `useRequestFetch()`, разобрано в [«Работе с данными»](./data-fetching.md#заголовки-и-cookie-при-ssr).

**Типы.** `nuxi prepare` пишет `.nuxt/types/nitro-routes.d.ts`, где каждому маршруту и методу сопоставлен `Serialize<ReturnType<handler>>`. Как это работает для `useFetch` и почему `Date` становится `string`, описано в [«Работе с данными»](./data-fetching.md#типизация-fetch-к-своим-server-api). Здесь важна ловушка: для `'/api/users/1'` тип выбирается из объединения лучшего динамического совпадения и **всех catch-all**. С `server/api/[...].ts`, у которого метод `default`, тип `$fetch('/api/users/1')` превратился в `unknown` (`TS18046`), а без catch-all был `{ id: number; name: string }`. На статические пути это не влияет.

Тип, общий для клиента и сервера, кладут в `shared/types/`. В `server/` он доступен без импорта: `User` в `server/utils/db.ts` собрался и прошёл `vue-tsc`. Ограничения `shared/` — в [«Структуре проекта»](./project-structure.md#код-общии-для-приложения-и-сервера).

> [!NOTE]
> В Nuxt 3 было иначе: каталог `shared/` появился в 3.14, а авто-импорт из `shared/utils` и `shared/types` работал только с `future.compatibilityVersion: 4` ([nuxt.com/docs/3.x/directory-structure/shared](https://nuxt.com/docs/3.x/directory-structure/shared)).

### Хранилище и кэш

`useStorage(base)` — это [unstorage](https://unstorage.unjs.io/): key-value API (`getItem`, `setItem`, `getKeys`) поверх драйвера. Точки монтирования задают в `nitro.storage` (`{ redis: { driver: 'redis', url } }`) или в плагине через `useStorage().mount()`. Что смонтировано на node-server после сборки (видно в `nitro.mjs`):

- корень — память процесса. Там лежит кэш, ключи `cache:nitro:handlers:...`, `cache:nitro:routes:...`, `cache:nitro:functions:...`;
- `data` — драйвер `fs-lite` в `./.data/kv`. Путь отсчитывается от **текущего каталога** процесса, а не от `.output`.

**`defineCachedEventHandler(handler, opts)`** сохраняет ответ целиком: тело, статус, заголовки, и сам ставит `etag`, `last-modified` и `cache-control: max-age=<maxAge>`. **`defineCachedFunction`** (`cachedFunction`) сохраняет результат функции по ключу из аргументов. **`routeRules: { cache: {...} }`** оборачивает существующий маршрут тем же `cachedEventHandler` (группа `nitro/routes`), не трогая его код. SSR-страницы под `swr`/`cache` разобраны в [«Режимах рендеринга»](./rendering-modes.md#swr-cache-и-isr-кто-кэширует).

Что видно в `cache.mjs` и в экспериментах:

- **Значения по умолчанию — `swr: true, maxAge: 1`.** Без `maxAge` кэш живёт секунду.
- **SWR.** После истечения `maxAge: 5` первый запрос получил старый ответ (`calls: 1`), обновление пошло в фоне, а следующий запрос получил `calls: 2`. Фоновое обновление регистрируется через `event.waitUntil`: на serverless-платформе оно доживает до конца.
- **Дедупликация.** Три одновременных запроса к пустому кэшу вызвали обработчик один раз: идущий промис хранится в `pending[key]`. Это защищает от stampede, но только внутри одного процесса.
- **Ключ.** Для обработчика ключ — это путь (первые 16 символов без спецсимволов плюс хэш полного URL с query) и хэши заголовков из `varies`. `?x=1` — другой ключ. Для функции ключ — `hash(args)` или результат `getKey`.
- **Integrity.** В запись кэша пишется хэш исходника функции и опций. После деплоя с изменённым обработчиком старые записи не совпадут и будут пересчитаны, даже если хранилище общее.
- **Что не кэшируется:** статус `>= 400`, ответ без тела, ответ с `Set-Cookie`.

Память у каждого процесса своя: два инстанса за балансировщиком — два независимых кэша, а после рестарта кэш пуст. Общий кэш получается, если смонтировать `cache` на Redis или KV платформы.

### Пресеты и деплой

Пресет выбирают через `nitro.preset` или `NITRO_PRESET`, а на известных платформах (Vercel, Netlify, Cloudflare Pages) Nitro определяет его сам по переменным CI. Пресет записывается в `.output/nitro.json` вместе с командами `preview` и `deploy`.

| Тип | Пресет | Что в выводе | Ограничения |
| --- | --- | --- | --- |
| Node-сервер | `node-server` (по умолчанию), `node-cluster` | `server/index.mjs` с `http.Server`, `server/node_modules` | долгий процесс: память, `fs`, фоновые задачи доступны |
| Статика | `static` (`nuxi generate`) | только `public/` | нет `server/api`, кэша и `routeRules` с рантаймом ([«Режимы рендеринга»](./rendering-modes.md#ssg-prerender-и-nuxi-generate)) |
| Serverless | `vercel`, `netlify`, `aws-lambda` | функция платформы | холодный старт, процесс живёт между вызовами недолго, файловая система только для чтения (кроме `/tmp`) |
| Edge | `cloudflare-module`, `vercel-edge`, `netlify-edge` | один бандл без `node_modules` | web API вместо Node, лимиты CPU и размера, нет `fs` |

Node-сервер запускается командой `node .output/server/index.mjs`. Порт и хост берутся из `NITRO_PORT`/`PORT` и `NITRO_HOST`/`HOST`, документация советует ещё `NODE_ENV=production`. Пресет `vercel` собрал **одну** функцию `__fallback.func` со всем приложением, а `api/hello.func` и остальные — symlink на неё. Поэтому разбиение на файлы не даёт отдельных функций, и холодный старт у всех маршрутов общий.

`cloudflare-module` собрал всё в один бандл, без `node_modules`, с `nodeCompat: true`. `node:*` там подменяет [unenv](https://unenv.unjs.io/). Часть API реализована поверх рантайма Workers, а остальное — заглушки. Например, `readFileSync` в бандле стал `notImplemented("fs.readFileSync")`: сборка прошла **без предупреждений**, а исключение будет при вызове. Монтирования `data` на этом пресете нет, а смонтированный в конфиге драйвер `fs` попал в бандл как есть. Хранилище на edge — драйвер платформы (KV, R2, D1).

> [!TIP]
> Код, который должен работать на любом пресете, пишут на web API (`fetch`, `Request`, `crypto.subtle`, `ReadableStream`), а данные держат во внешнем хранилище через `useStorage`. Модульные переменные (`let calls = 0`) на serverless и edge — состояние одного экземпляра на неопределённое время, а не счётчик приложения.

> [!NOTE]
> Nuxt 5 (не выпущен, сверено 2026-11-22 по релизам `nuxt/nuxt`, `nitrojs/nitro`, `h3js/h3`): переход на Nitro v3 (на эту дату RC, `v3.0.261103-rc`) и h3 v2 (стабильный, 2.0.x). В h3 v2 `event.req` — web `Request`, хелперы другие. Мост уже есть в Nuxt 4.6.0: `nuxt/server` с портируемым `RequestEvent` (`event.req`, `event.url`, `event.res.headers`), который работает на Nitro v2 и v3. Его `readValidatedBody` принимает Standard Schema, а `serverFetch(event, path)` вызывает маршрут в процессе и по умолчанию пробрасывает `cookie` и `authorization` (проверено: `cookie: sid=abc` дошёл). Смешивать нельзя: хелпер из `nuxt/server` внутри авто-импортированного h3 `defineEventHandler` дал 500 `NUXT_E8012`, поэтому `defineEventHandler` импортируют из `nuxt/server` вместе с хелперами. С `compatibilityVersion: 5` авто-импорты Nitro выключены ([«Структура проекта»](./project-structure.md#поддержка-версии-и-миграция)).

## Примеры

### API-маршрут с параметром, ошибкой и общим типом

```ts
// shared/types/user.ts
export interface User { id: number; name: string }

// server/utils/db.ts — auto-imported on the server
const users: User[] = [{ id: 1, name: 'Ada' }]
export const findUser = (id: number) => users.find((u) => u.id === id)

// server/api/users/[id].get.ts
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  const user = findUser(id)
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'User not found', data: { id } })
  }
  return user // typed for $fetch('/api/users/1') on the client
})
```

### Хук ошибок и контекст запроса

```ts
// server/middleware/01.context.ts
export default defineEventHandler((event) => {
  event.context.requestId = crypto.randomUUID() // returns nothing: continue to routes
})

// server/plugins/errors.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, { event }) => {
    // full error with stack, even when the client sees only "Server Error"
    console.error(event?.context.requestId, event?.path, error)
  })
})
```

### Кэш с общим хранилищем

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  nitro: {
    storage: { cache: { driver: 'redis', url: process.env.REDIS_URL } }, // shared across instances
  },
  routeRules: { '/api/catalog': { cache: { maxAge: 60 } } },             // wrap without touching code
})
```

## Вопросы с интервью

::: details Что такое Nitro и чем серверная часть Nuxt отличается от Express
Nitro — серверный движок и сборщик: он берёт `server/`, SSR-рендерер Nuxt и конфиг, собирает h3-приложение Rollup-ом и упаковывает его под пресет в самодостаточный `.output/`. h3 — HTTP-слой: обработчик `(event) => value`, возвращаемое значение становится ответом, ошибка — ответом с её статусом. Отличия от Express: нет `res.send` и `next()`, маршруты задаются именами файлов, обработчики грузятся лениво отдельными чанками, а пресет позволяет запустить тот же код в Node, serverless или edge. Сверху — хранилище, кэш, плагины и типизация ответов для `$fetch`. Страница Nuxt — тоже обработчик Nitro (`/**`), поэтому API и SSR живут в одном процессе.
:::

::: details Как вызов $fetch к своему API на сервере обходится без HTTP и что при этом теряется
Nitro подменяет глобальный `$fetch`: путь с `/` идёт в `localFetch`, который создаёт фейковые `req`/`res` (`node-mock-http`) и прогоняет их через тот же h3-обработчик. Сокета, DNS и TLS нет. Но это новый запрос: middleware выполняется снова, `event.context` пустой, заголовки входящего запроса не копируются, поэтому `cookie` на вложенном вызове — `null`. Чтобы пробросить заголовки, используют `event.$fetch` (копирует всё, кроме hop-by-hop, `host` и `accept`), во Vue-коде — `useRequestFetch()`, а в `nuxt/server` — `serverFetch`, который передаёт `cookie` и `authorization`. Если нужна только логика, а не HTTP-семантика, проще вызвать функцию из `server/utils` напрямую.
:::

::: details В каком порядке Nitro обрабатывает запрос и почему неправильный метод даёт 404
Хук `request` плагинов, затем обработчик `routeRules` (redirect, headers, proxy), затем middleware: статика из `public/` и `server/middleware/` по имени файла, затем роутер. Роутер содержит API, `server/routes` и последним — SSR-рендерер на `/**`. Маршрут с `cache` в `routeRules` при этом обёрнут в кэширующий обработчик. Если путь есть, но метода нет (`PUT` на `hello.get.ts`) или пути нет вовсе, запрос доходит до рендерера, Vue Router не находит страницу, и сервер рендерит 404-страницу. Это лишний SSR-проход и HTML в ответ API-клиенту. Документация обещает 405, но в Nuxt 4.6.4 так не происходит. Закрывают через `server/api/[...].ts`, который бросает 404.
:::

::: details Как устроен кэш в Nitro и что с ним будет при нескольких инстансах
Три входа: `defineCachedEventHandler` (кэш ответа целиком с `etag`, `last-modified`, `cache-control`), `defineCachedFunction` (результат функции по ключу из аргументов) и `routeRules.cache` (обёртка того же обработчика без правки кода). Всё хранится в unstorage, по умолчанию в памяти процесса. По умолчанию `swr: true, maxAge: 1`: просроченная запись отдаётся сразу, обновление идёт в фоне через `waitUntil`. Параллельные промахи схлопываются в один вызов через `pending[key]`. Ключ состоит из пути, хэша URL с query и заголовков из `varies`. В записи хранится хэш кода, поэтому деплой с новым кодом инвалидирует кэш. При нескольких инстансах у каждого свой кэш и своя дедупликация, после рестарта кэш пуст. Нужна согласованность — монтируют `cache` на Redis или KV. Ответы с ошибкой и `Set-Cookie` не кэшируются.
:::

::: details Чем отличаются пресеты node-server, serverless и edge, и что сломается при переезде
node-server — долгий процесс с `http.Server`. Там есть файловая система, память между запросами, модульные переменные, фоновые таймеры и `.data/kv` на диске. Serverless (`vercel`, `netlify`, `aws-lambda`) — функция с холодным стартом. На Vercel всё приложение — одна функция, на остальные маршруты стоят symlink. Диск только для чтения (кроме `/tmp`), память живёт недолго и у каждого экземпляра своя. Edge (`cloudflare-module`, `vercel-edge`) — один бандл на web API, `node:*` подменены unenv. Чего нет, то стало заглушкой: `readFileSync` собирается без предупреждений и бросает ошибку при вызове. При переезде ломаются `fs`, нативные модули, состояние в памяти, кэш в памяти и драйвер `fs` в `nitro.storage`. Переносимый код — это web API, внешнее хранилище через `useStorage` и отказ от модульного состояния.
:::

::: details Как правильно отдавать ошибки из серверного маршрута
Ожидаемые ошибки бросают через `createError({ statusCode, statusMessage, data })`: статус уходит в ответ, `data` — в JSON, и `useFetch` получает их в `error`. Необработанное исключение в production даёт 500 с текстом `Server Error`: Nuxt скрывает `message`, а полный стек остаётся в логе и в хуке `error` плагина, через который подключают Sentry и подобное. Ловушка: `message` в явном `createError`, даже со статусом 500, уходит клиенту как есть. Поэтому текст ошибки драйвера БД нельзя заворачивать в `createError({ message: e.message })`. Входные данные проверяют `readValidatedBody` со схемой: это даст 400 с описанием проблем, а не 500 из глубины кода.
:::

::: details Откуда берётся тип ответа у $fetch к своему маршруту и когда он ломается
`nuxi prepare` генерирует `nitro-routes.d.ts`: для каждого маршрута и метода — `Serialize<Awaited<ReturnType<handler>>>`. `$fetch` и `useFetch` ищут тип по литералу URL и методу. `Serialize` моделирует JSON, поэтому `Date` превращается в `string`. Тип ломается в трёх случаях. URL не литерал (`$fetch(url)` со строкой) — тип `unknown`. Ответ формирует не возврат функции, а `event.node.res.end` или `send`. Есть catch-all `server/api/[...].ts` — тогда для динамических путей тип выбирается из объединения с ним и становится `unknown`. Общие типы кладут в `shared/types`, и они видны в обеих средах.
:::

::: details Что меняется в серверном коде с Nuxt 5 и как подготовиться заранее
Nuxt 5 переходит на Nitro v3 и h3 v2. На 2026-11-22 Nuxt 5 не вышел, Nitro v3 в RC, h3 v2 стабилен. В h3 v2 событие построено на web `Request`, часть хелперов и их сигнатур меняется. Авто-импорты Nitro в Nuxt 5 выключены. Готовиться можно с Nuxt 4.6: импортировать `defineEventHandler` и хелперы из `nuxt/server`, который даёт портируемый `RequestEvent` и работает и на Nitro v2, и на v3. Смешивать с авто-импортом h3 нельзя (`NUXT_E8012`). Дальше включить `future.compatibilityVersion: 5` и прогнать `typecheck`: всё, что не резолвится, — кандидаты на перенос. Прямые импорты из `h3` и `nitropack` по-прежнему работают, но привязывают код к мажору.
:::

## Задачи

### 1. Найдите баг · средне

Мобильное приложение ходит в API Nuxt. На опечатку в URL оно получает 404, но в ответе HTML страницы ошибки, а в логах сервера — `[Vue Router warn]: No match found for location with path "/api/ordrs"`. На `PUT /api/orders`, где есть только `orders.get.ts`, — тоже 404, хотя клиент ждёт 405.

::: details Решение и разбор
Неизвестный путь и неизвестный метод не находят обработчика в роутере Nitro и доходят до последнего маршрута — SSR-рендерера на `/**`. Тот запускает Vue-приложение, Vue Router не находит страницу, и рендерится 404. Это лишний SSR-проход и HTML в ответ API (проверено: `Accept: text/html` даёт HTML, `*/*` — JSON).

```ts
// server/api/[...].ts — catches everything under /api that no other file matched
export default defineEventHandler((event) => {
  throw createError({ statusCode: 404, statusMessage: `API route not found: ${event.path}` })
})
```

После этого `/api/ordrs` и `PUT /api/orders` возвращают JSON 404 без рендера. Для честного 405 нужен файл без суффикса метода и `assertMethod(event, ['GET'])` внутри, либо отдельный `orders.put.ts`, который бросает `405`.

Цена catch-all: типы `$fetch` для динамических путей под `/api` стали `unknown`, потому что тип выбирается из объединения с catch-all. Варианты — явный generic `$fetch<User>(...)` там, где это важно, или catch-all уровнем выше.
:::

### 2. Найдите баг · легко

```ts
// server/api/profile.post.ts
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (b) => {
    typeof (b as any)?.age === 'number'
  })
  return save(body)
})
```

На `{"age":"old"}` обработчик сохранил данные.

::: details Решение и разбор
У стрелки с фигурными скобками нет `return`: валидатор вернул `undefined`, а h3 понимает `undefined` как «данные не меняются» (`return res ?? data`). Проверено: ответ `{"accepted":{"age":"old"}}`. Отказ означают только `false` и исключение.

```ts
import { z } from 'zod'
const Profile = z.object({ age: z.number().int().min(0) })

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (b) => Profile.parse(b)) // throws → 400, typed result
  return save(body)
})
```

Вторая проблема исходного варианта — тип. Даже с `return` результат был бы `boolean`, потому что тип берётся из возврата валидатора, а type guard его не сужает. `schema.parse` решает обе проблемы. В `nuxt/server` можно передать саму схему (Standard Schema).
:::

### 3. Что выведет · средне

Пользователь с `cookie: sid=abc` открывает `/api/dashboard`.

```ts
// server/middleware/auth.ts
export default defineEventHandler((event) => {
  event.context.user = getCookie(event, 'sid') ? 'alice' : null
})

// server/api/me.get.ts
export default defineEventHandler((event) => ({ user: event.context.user }))

// server/api/dashboard.get.ts
export default defineEventHandler(async (event) => {
  const a = await $fetch('/api/me')
  const b = await event.$fetch('/api/me')
  return { a, b, same: event.context.user }
})
```

::: details Решение и разбор
```json
{ "a": { "user": null }, "b": { "user": "alice" }, "same": "alice" }
```

Оба вызова не идут в сеть, но каждый — новый запрос через h3. Middleware выполняется для каждого заново, а `event.context` не наследуется. Голый `$fetch` не копирует заголовки, поэтому cookie нет, и `user` — `null`. `event.$fetch` копирует заголовки входящего запроса, и middleware видит `sid` (проверено на аналогичном маршруте: `cookie: null` против `cookie: "sid=abc"`).

Опасность такой ошибки в том, что она не падает: эндпоинт, который на сервере ходит в свой API за правами, молча получает анонима. Лучший вариант — вообще не делать HTTP внутри процесса: вынести `getUser(event)` в `server/utils` и вызвать его напрямую.
:::

### 4. Реализуйте · средне

`/api/price?currency=EUR` считает цену, используя курс из внешнего API. Тот отвечает 300 мс и ограничивает частоту запросов. Нужно: курс не чаще раза в минуту на валюту, без шквала запросов при истечении, и общий кэш для трёх инстансов.

::: details Решение и разбор
```ts
// server/utils/rates.ts
export const getRate = defineCachedFunction(
  async (currency: string) => {
    const { rate } = await $fetch<{ rate: number }>(`https://rates.example.com/${currency}`)
    return rate
  },
  { name: 'rate', maxAge: 60, swr: true, getKey: (currency: string) => currency },
)

// server/api/price.get.ts
import { z } from 'zod'
const Query = z.object({ currency: z.enum(['EUR', 'USD']) })

export default defineEventHandler(async (event) => {
  const { currency } = await getValidatedQuery(event, (q) => Query.parse(q))
  return { price: 100 * (await getRate(currency)), currency }
})
```

```ts
// nuxt.config.ts
nitro: { storage: { cache: { driver: 'redis', url: process.env.REDIS_URL } } }
```

- Кэшируется функция, а не весь ответ: другие query-параметры не размножают записи курса. Проверено: два вызова `EUR` — один запрос, `USD` — второй, ключи `cache:nitro:functions:rate:EUR.json` и `...:USD.json`.
- `swr: true` (значение по умолчанию): после минуты пользователь получает старый курс сразу, а обновление идёт в фоне.
- Дедупликация `pending[key]` схлопывает одновременные промахи, но только **внутри процесса**. При трёх инстансах и общем Redis каждый может один раз сходить за курсом. Если лимит строгий, нужна блокировка в Redis или фоновое обновление по расписанию.
- `getValidatedQuery` со схемой ограничивает ключи кэша. Иначе произвольный `currency` создаёт неограниченное число записей и запросов во внешний API.
:::

### 5. Найдите баг · сложно

Приложение работало на `node-server` и переехало на `cloudflare-module`. Сборка прошла без предупреждений, но `/api/terms` отвечает 500, счётчик просмотров каждый раз начинается заново, а кэш «то есть, то нет».

```ts
// server/api/terms.get.ts
import { readFileSync } from 'node:fs'
export default defineEventHandler(() => readFileSync('content/terms.md', 'utf8'))

// server/api/views.post.ts
let views = 0
export default defineEventHandler(() => ({ views: ++views }))

// nuxt.config.ts
nitro: { storage: { kv: { driver: 'fs', base: './.data/kv' } } }
```

::: details Решение и разбор
- **`readFileSync`.** На edge нет файловой системы, unenv подставил `notImplemented("fs.readFileSync")`. Это видно в собранном `nitro.mjs`, а сборка не предупреждает. Исправление: положить файл в `server/assets/` и читать через `useStorage('assets:server').getItem('terms.md')` (Nitro встраивает такие файлы в бандл) либо брать текст из KV/R2.
- **`let views`.** Модульная переменная живёт в одном изоляте воркера: запросы распределяются по многим изолятам, и те перезапускаются. На node-server это «работало» только до рестарта и до второго инстанса. Счётчик хранят во внешнем хранилище.
- **Драйвер `fs`.** Он попал в бандл как есть, но писать некуда. Монтирования `data` на этом пресете нет. Нужен драйвер платформы: `cloudflare-kv-binding` для `kv`, тот же или Redis для `cache`. Иначе кэш живёт в памяти изолята, отсюда «то есть, то нет».

Общий вывод: пресет меняет рантайм, а не только формат вывода. Перед переездом ищут `node:*`, нативные зависимости, модульное состояние и драйверы `fs` в `nitro.storage`. Проверять нужно на `wrangler dev`, а не на `node .output/server/index.mjs`.
:::

## Источники

- [Nuxt 4: `server`](https://nuxt.com/docs/4.x/directory-structure/server) — маршруты, суффиксы методов, catch-all, middleware, плагины, `event.$fetch`, storage
- [Nuxt 4: Server](https://nuxt.com/docs/4.x/getting-started/server) и [Deployment](https://nuxt.com/docs/4.x/getting-started/deployment) — пресеты, `NITRO_PRESET`, переменные `PORT`/`HOST`
- [Nuxt 4: `$fetch`](https://nuxt.com/docs/4.x/api/utils/dollarfetch) и [`useRequestFetch`](https://nuxt.com/docs/4.x/api/composables/use-request-fetch)
- [Nuxt 4: Upgrade Guide](https://nuxt.com/docs/4.x/getting-started/upgrade) — переход на `nuxt/server`, `compatibilityVersion: 5`
- [Nuxt 4.6](https://nuxt.com/blog/v4-6) и [release v4.6.0](https://github.com/nuxt/nuxt/releases/tag/v4.6.0) — `nuxt/server`, `RequestEvent`, `NUXT_E8012`
- [Nuxt 3: `shared`](https://nuxt.com/docs/3.x/directory-structure/shared)
- [Nitro v2: Cache](https://v2.nitro.build/guide/cache), [Storage](https://v2.nitro.build/guide/storage), [Plugins](https://v2.nitro.build/guide/plugins), [Fetch](https://v2.nitro.build/guide/fetch), [Deploy](https://v2.nitro.build/deploy), [Cloudflare](https://v2.nitro.build/deploy/workers)
- [h3 v1: Guide](https://v1.h3.dev/guide) и [Request utils](https://v1.h3.dev/utils/request)
- [unstorage](https://unstorage.unjs.io/) и [unenv](https://unenv.unjs.io/)
- [nitrojs/nitro v2.13.6: `runtime/internal/app.ts`](https://github.com/nitrojs/nitro/blob/v2.13.6/src/runtime/internal/app.ts) — `localFetch`, порядок обработчиков, `runNitroPlugins`
- [nitrojs/nitro v2.13.6: `runtime/internal/cache.ts`](https://github.com/nitrojs/nitro/blob/v2.13.6/src/runtime/internal/cache.ts) — значения по умолчанию, `pending`, integrity, ключ
- [Релизы nitrojs/nitro](https://github.com/nitrojs/nitro/releases) и [h3js/h3](https://github.com/h3js/h3/releases) — статус Nitro v3 и h3 v2
