---
title: Режимы рендеринга и lazy hydration
level: ядро
---

# Режимы рендеринга и lazy hydration

> **Коротко.** Режим рендеринга в Nuxt выбирают для каждого маршрута, а не для проекта. По умолчанию это universal rendering: SSR и гидрация. `ssr: false` даёт пустую оболочку SPA, `prerender` — HTML на этапе сборки, `swr`/`cache` — кэш ответа в хранилище Nitro, `isr` — кэш на CDN платформы. Все `routeRules` превращаются в обработчики Nitro и проверяются по пути URL. Поэтому они управляют рендерингом и кэшем, но ничего не защищают. Внутри страницы границу между сервером и клиентом двигают компоненты: `<ClientOnly>` и `.client` не рендерятся на сервере, `.server` и `<NuxtIsland>` не попадают в клиентский JS, а `Lazy`-компоненты с `hydrate-on-*` откладывают гидрацию.

**Связанные темы:** [SSR и гидрация](../vue/ssr-and-hydration.md), [`KeepAlive`, `Teleport`, `Suspense`, `Transition` и асинхронные компоненты](../vue/built-in-components.md), [Нефункциональные требования](../architecture/non-functional.md), [HTTP-кэширование и CDN](../network/caching.md), [Производительность Vue и Nuxt](../performance/vue-performance.md), [Core Web Vitals и измерение](../performance/web-vitals.md), [Работа с данными: `$fetch`, `useFetch`, `useAsyncData`](./data-fetching.md), [Состояние и конфигурация: `useState` vs Pinia, `runtimeConfig`](./state-and-config.md), [Middleware и плагины](./middleware-and-plugins.md), [Структура проекта и auto-imports](./project-structure.md), [Аутентификация на фронтенде](../security/authentication.md), [CSP](../security/csp.md)

## Теория

Все фрагменты проверены на Nuxt 4.6.4 с Nitro 2.13.6 и Vue 3.5.45 в Node 26.13.1. Заголовки и HTML сняты `curl` с `nuxi build` + `node .output/server/index.mjs`, статическая сборка — `nuxi generate`. Гидрация, загрузка чанков и запросы при навигации проверены в Chromium через Playwright, на production-сборке и в `nuxi dev`. Nuxt 5 проверен на 4.6.4 с `future.compatibilityVersion: 5`. Устройство описано по исходникам: `nuxt/dist/runtime/server/renderer/`, `components/runtime/lazy-hydrated-component.js`, `app/composables/manifest.js` и `payload.js`, `@nuxt/nitro-server/dist/runtime/handlers/island.mjs`, `nitropack/dist/runtime/internal/route-rules.mjs` и `cache.mjs`.

Как Vue рендерит в строку и гидрирует, здесь не повторяется: это тема [«SSR и гидрация»](../vue/ssr-and-hydration.md). Как выбрать стратегию под требования — [«Нефункциональные требования»](../architecture/non-functional.md#стратегии-рендеринга). Заголовки кэша, которые ставят правила, — [«HTTP-кэширование и CDN»](../network/caching.md#nuxt-routerules-как-кэш-политика).

### Три режима и один гибрид

| Режим | Как включить | Что в HTML | Кто рендерит |
| --- | --- | --- | --- |
| Universal (по умолчанию) | ничего | разметка страницы + payload | Nitro на каждый запрос |
| Client-side (SPA) | `ssr: false` в конфиге или в правиле | `<div id="__nuxt"></div>`, конфиг, скрипты | браузер |
| Static (SSG) | `nuxi generate` или `prerender: true` | разметка, снятая при сборке | Nitro на этапе сборки |
| Гибрид | `routeRules` | по правилу маршрута | Nitro, кэш Nitro или CDN |

Ответ SPA-маршрута проверен: 1551 байт, в `#__nuxt` пусто, payload пустой (`window.__NUXT__={}`). Payload extraction для `ssr: false` принудительно выключен. Edge-side rendering в документации назван deployment target, а не режимом: тот же universal rendering, но Nitro собран под пресет edge-платформы (`cloudflare-pages`, `vercel-edge`, `netlify-edge`).

### Что стоит за `routeRules`

`routeRules` — это не настройка Vue Router, а конфигурация Nitro. При сборке Nitro нормализует правила: `swr: 10` превращается в `cache: { swr: true, maxAge: 10 }`, строковый `redirect` — в `{ to, statusCode: 307 }`, `cors: true` — в набор заголовков `access-control-*`. В рантайме правила работают в трёх местах:

1. **Общий обработчик правил.** Его ставят перед всеми маршрутами (`createRouteRulesHandler`). Он находит все подходящие шаблоны через radix-роутер и сливает их `defu`. Более конкретный шаблон побеждает. Обработчик ставит `headers`, отвечает на `redirect` (проверено: `/old` → `307`, `location: /pre`) и проксирует `proxy`.
2. **Обёртка кэша.** Если у маршрута есть `cache` (или `swr`), его обработчик оборачивается в `cachedEventHandler` с группой `nitro/routes`. Сюда попадает и рендерер страниц, и `server/api/*`.
3. **Рендерер Nuxt.** Он читает `ssr`, `noScripts`, `isr`/`cache` (для payload extraction) и `prerender`.

Часть правил уходит и в клиентский бандл. Nuxt генерирует `#build/route-rules.mjs`, и в собранном JS видны только `ssr`, `prerender`, `payload` и `redirect`: `{ssr:!1}`, `{prerender:!0}`, `{redirect:'/pre'}`. Клиент использует их при навигации: решает, грузить ли `_payload.json`, и выполняет `redirect` без сервера. `headers` и `cache` на клиент не попадают.

### `swr`, `cache` и `isr`: кто кэширует

Проверено на node-сервере с `swr: 10`, `cache: { maxAge: 30 }` и `isr: 60`:

- **`swr: 10`.** Первый ответ рендерится и сохраняется, в нём `cache-control: s-maxage=10, stale-while-revalidate`, слабый `etag` и `last-modified`. Через 17 секунд пришёл старый HTML, а в фоне запустился рендер. Следующий запрос получил уже новую версию.
- **`cache: { maxAge: 30 }`.** То же хранилище, но с `cache-control: max-age=30`. У `cachedEventHandler` по умолчанию `swr: true`, поэтому после срока он тоже сначала отдаёт старую версию.
- **`isr: 60`.** На node-сервере **кэша нет вообще**: каждый запрос отрендерился заново, заголовков кэша нет. `isr` — инструкция для пресетов Vercel и Netlify: там Nitro генерирует конфиг платформы, и кэширует CDN. `isr: true` живёт до следующего деплоя.

Хранилище кэша по умолчанию — память процесса (в dev — файлы). При нескольких инстансах у каждого свой кэш, пока в `nitro.storage` не подключён общий драйвер (Redis и т. п.).

**Ключ кэша — путь с query и метод.** Внутрь закэшированного обработчика Nitro передаёт копию запроса, где остались **только заголовки из `varies`**. Cookie и `Authorization` до рендера не доходят. Проверено: страница с `useCookie('user')` под `swr` при `cookie: user=alice` и при `cookie: user=bob` отрендерила `user=anon cookieHeader=none`. Ответ с `Set-Cookie` не кэшируется: страница, которая ставит cookie, на каждом запросе рендерилась заново. Последствие для персональных страниц — в [«Аутентификации»](../security/authentication.md) и [«CSP»](../security/csp.md) (один nonce на всех).

### Почему route rules — не security boundary

Правило срабатывает по **пути URL** и описывает, **как** отдать ответ, но не **кому**. `'/admin/**': { ssr: false }` только убирает SSR: оболочка `/admin` отдаётся любому с кодом `200`, а данные страница берёт из API. Проверено: `curl /api/secret` без cookie вернул `{"secret":"admin-only"}`, а при переходе на `/admin` клиент сам запросил `/api/secret`. Шаблоны правил видны в клиентском бандле. Middleware страниц (`appMiddleware`) выполняется в приложении и тоже не закрывает серверные маршруты. Доступ проверяют в `server/` (`server/middleware` или в каждом обработчике), а страница только отражает результат ([«Middleware и плагины»](./middleware-and-plugins.md)).

### SSG: `prerender` и `nuxi generate`

`prerender: true` в правиле заставляет `nuxi build` запустить Nitro в режиме пререндера и сохранить HTML маршрута в `.output/public/pre/index.html`. При `nuxi build` краулер по ссылкам выключен: страница `/pre` ссылается на `/swr`, но пререндерился только `/pre` и его `_payload.json`. В рантайме такой файл отдаётся как статика с сильным `ETag`, без рендера.

`nuxi generate` — это `prerender` с краулером (`crawlLinks: true`) от `/`. Проверено: он начал с `/`, `/200.html`, `/404.html` и маршрутов с `prerender`, затем прошёл по всем `<a href>`. Что получилось:

- `redirect` стал HTML с `<meta http-equiv="refresh" content="0; url=/pre">`;
- `ssr: false` (`/spa`, `/admin`) — пустая оболочка, как и `200.html` (fallback для SPA-хостинга);
- `headers`, `swr` и `isr` пропали: в `.output` остались только `public/` и `nitro.json`, сервера нет. Документация прямо пишет, что гибридный рендеринг недоступен при `nuxt generate`;
- islands тоже сохранены статикой: `__nuxt_island/Markdown_<hash>.json`;
- страницы, на которые нет ссылок (динамические `/user/42`), краулер не найдёт. Их перечисляют в `nitro.prerender.routes` или добавляют из кода через `prerenderRoutes()`.

### Payload extraction

Для пререндеренных и закэшированных маршрутов (`prerender`, `swr`, `cache`, `isr`) Nuxt выносит часть payload в отдельный `_payload.json`. В HTML появляются `<link rel="preload" as="fetch" href="/swr/_payload.json?_b=<buildId>">` и `data-src` у `__NUXT_DATA__`. Разделение видно в рендерере (`splitPayload`): в файл уходят только `data` (кэш `useAsyncData`/`useFetch`) и `prerenderedAt`. `state` (`useState`, Pinia) остаётся в HTML.

Зачем это нужно, видно при навигации. Переход с `/go` на `/pre` и на `/swr` загрузил `/pre/_payload.json` и `/swr/_payload.json`, а запроса к `/api/stamp` не было. Данные пришли из того же снимка, что и HTML. `<NuxtLink>` к тому же заранее загружает payload видимых ссылок. Обычная SSR-страница `_payload.json` не создаёт: на ней `useFetch` при навигации идёт в API.

> [!NOTE]
> В Nuxt 5 (`compatibilityVersion: 5`; на npm 5.0 ещё нет, сверено 2026-11-22) `payloadExtraction` по умолчанию `'client'`. Payload целиком встраивается в HTML первого ответа, а `_payload.json` остаётся только для клиентской навигации. Проверено на 4.6.4: в HTML `/swr` нет `preload`, а `/swr/_payload.json` отвечает `200`. В Nuxt 3 настройки режимов, правил, extraction и islands те же. Lazy hydration появилась в 3.16.

### `<ClientOnly>`, `.client`, `.server`, `<NuxtIsland>`

| Что | На сервере | На клиенте | JS компонента в браузере |
| --- | --- | --- | --- |
| `<ClientOnly>` | `fallback` или пустой `<div>` | слот после `mounted` | да |
| `Foo.client.vue` | пустой `<div>` | компонент после `mounted` | да |
| `Foo.server.vue` | HTML | тот же HTML, без гидрации | нет |
| `<NuxtIsland name="Foo">` из `components/islands/` | HTML | HTML, при навигации — запрос | нет |
| пара `Foo.server.vue` + `Foo.client.vue` | серверная версия | клиентская после `mounted` | только `.client` |

Проверено на странице с `<Md>` (`.server`), `<NuxtIsland name="Markdown">`, `<Clock>` (`.client`) и `<ClientOnly fallback="loading...">`. Сервер отдал HTML островов с `data-island-uid`, `<div></div>` на месте `Clock` и `<span>loading...</span>`. Код островов в клиентские чанки не попал. При первой загрузке запросов к островам нет: HTML уже на странице. При клиентском переходе на эту страницу ушли `GET /__nuxt_island/Md_<hash>.json?props={"text":"hello"}` и такой же для `Markdown`.

Server components работают через `experimental.componentIslands`. В 4.6.4 по умолчанию это `'auto'`: islands включаются, когда в проекте есть `.server`-компоненты или страницы. Опция остаётся в пространстве `experimental`. Интерактивный кусок внутри острова (`nuxt-client`) требует `componentIslands: { selectiveClient: true }`. У острова должен быть один корневой элемент. `useId` и `provide`/`inject` через его границу не проходят.

> [!WARNING]
> Эндпоинт `/__nuxt_island/<Name>_<hash>.json` публичный. Хэш в URL с 4.5.0 считается от имени, props и контекста (`getIslandHash`, `ohash`) и защищает только от несовпадения URL и props, например для кэша. Это не подпись: секрета в нём нет. Проверено: хэш посчитан отдельно для `{"text":"evil"}`, и сервер отрендерил `EVIL @ …`. Props острова — недоверенный ввод, как query любого API.

### Lazy hydration в Nuxt

Какие стратегии есть и чем они ограничены, разобрано в [«Производительности Vue и Nuxt»](../performance/vue-performance.md#nuxt-ленивые-компоненты-отложенная-гидрация-islands). Ленивая гидрация во Vue 3.5 — в [«SSR и гидрации»](../vue/ssr-and-hydration.md). Здесь — что Nuxt делает поверх Vue.

**Трансформ шаблона.** Плагин сборки `nuxt:components-loader-pre` разбирает `<template>` и ищет компоненты с атрибутами `hydrate-on-*`, `hydrate-after`, `hydrate-when`, `hydrate-never`. Тег `<LazyChart hydrate-on-visible>` он переименовывает в `<LazyVisible_Chart>`. Затем загрузчик компонентов подставляет фабрику `createLazyVisibleComponent(id, () => import('Chart.vue'))`. Отсюда два ограничения:

- **Нужен префикс `Lazy`.** У `<Chart hydrate-on-idle>` без префикса трансформа нет: атрибут ушёл в DOM как `hydrate-on-idle=""`, а компонент гидрировался сразу. В dev сборка пишет `[NUXT_B3006] Component <Chart> … has lazy-hydration props but is not declared as a lazy component`. В production предупреждения нет.
- **Стратегия видна только в шаблоне.** Через `v-bind="obj"`, в render-функции и при импорте из `#components` трансформ её не найдёт.

**Рантайм.** Фабрика создаёт обёртку `defineComponent`, а внутри — `defineAsyncComponent({ hydrate: hydrateOnVisible(props.hydrateOnVisible) })` из Vue. Стратегии `hydrate-after` и `hydrate-when` Nuxt пишет сам, `hydrate-never` — пустая функция, которая никогда не вызывает `hydrate`. После монтирования обёртка шлёт событие `hydrated`.

**Загрузка кода.** На сервере обёртка добавляет id модуля в `ssrContext['~lazyHydratedModules']`, и рендерер исключает такие модули из `modulepreload`. Проверено: чанк `Chart` пришёл в HTML как `<link rel="prefetch">`, то есть с низким приоритетом. Выполнился он только после прокрутки: `Chart mounted visible`, затем `hydrated`. Для `hydrate-never` модуль убирается и из prefetch.

**Изменение props до гидрации.** `:hydrate-when="ready"` проверено так: клик по негидрированной кнопке ничего не сделал, после `ready = true` компонент смонтировался, и клики заработали. Стратегия `If` вычисляется один раз в `setup`. Гидрацию здесь запускает перерисовка: новый проп обновляет обёртку раньше стратегии. По той же причине любой изменившийся проп будит компонент.

### `<Teleport>` при SSR

Vue при SSR не вставляет телепорты в строку, а копит их в `ssrContext.teleports` по селектору ([«Встроенные компоненты»](../vue/built-in-components.md)). Nuxt добавляет в шаблон страницы контейнер `<div id="teleports">` сразу после `#__nuxt` и вставляет туда `ssrContext.teleports['#teleports']`. Документация Nuxt формулирует правило так: SSR поддерживается только для `to="#teleports"`, другие цели — на клиенте внутри `<ClientOnly>`.

Проверено на странице с двумя телепортами:

```html
<body><!--teleport start anchor--><div id="modal-b">B</div><!--teleport anchor-->
<div id="__nuxt"><div><p>page</p><!--teleport start--><!--teleport end-->…</div></div>
<div id="teleports"><!--teleport start anchor--><div id="modal-a">A</div><!--teleport anchor--></div>
```

`to="#teleports"` попал в контейнер. `to="body"` в 4.6.4 тоже отрендерился: рендерер вставляет `ssrContext.teleports.body` в **начало** `<body>`, и гидрация прошла без предупреждений даже в dev. Но это деталь реализации, а не обещание документации. Любой другой селектор (`#modals` внутри layout) при SSR теряется: Nuxt его никуда не вставит.

### Hydration mismatch в Nuxt

Механика расхождений и `useId` — в [«SSR и гидрации»](../vue/ssr-and-hydration.md#hydration-mismatch). Nuxt добавляет свои инструменты:

- **`import.meta.client` / `import.meta.server`** — константы, которые сборка заменяет на `true`/`false`. Ветка вырезается из другого бандла. Для **ветвления рендера** они не годятся: проверено, <code v-pre>{{ where }}</code> с `import.meta.client ? 'client' : 'server'` дал `Hydration text content mismatch`. Их место — побочные эффекты: подписки, `localStorage`, аналитика.
- **`onMounted`** не выполняется на сервере. Значение, известное только в браузере, ставят после монтирования. Тогда первый клиентский рендер совпадает с серверным.
- **`useId()`** дал `id="v-0"` и на сервере, и на клиенте.
- **`useState`** переносит значение с сервера (`useState('r', () => Math.random())`), `useCookie` читает cookie одинаково в обеих средах, `<NuxtTime>` и `<ClientOnly>` закрывают время и браузерные API.

## Примеры

### Гибрид для магазина

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  routeRules: {
    '/': { swr: 60 },                       // Nitro storage, s-maxage=60, stale-while-revalidate
    '/blog/**': { prerender: true },        // HTML at build time, linked pages only
    '/products/**': { swr: 300 },           // same HTML for everyone: no cookies inside
    '/account/**': { ssr: false },          // SPA shell; access is checked by the API
    '/checkout': { headers: { 'cache-control': 'private, no-store' } },
    '/old-catalog/**': { redirect: { to: '/products/**', statusCode: 301 } },
  },
})
```

```ts
// server/middleware/account-guard.ts — the real boundary
export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/account')) return
  const session = await getUserSession(event)   // your own session helper
  if (!session) throw createError({ statusCode: 401 })
})
```

Кэшируемые страницы одинаковы для всех. Корзина и имя пользователя на них догружаются на клиенте (`useFetch(..., { server: false })`). Защита — в серверном middleware, а `ssr: false` для `/account` только экономит рендер.

### Тяжёлые блоки ниже первого экрана

```vue
<template>
  <ProductHero :product="product" />                     <!-- first screen: hydrate now -->
  <LazyReviewsList hydrate-on-visible :id="product.id" @hydrated="track('reviews')" />
  <LazyDeliveryMap hydrate-on-interaction="pointerenter" />
  <SpecsTable :specs="product.specs" />                  <!-- SpecsTable.server.vue: no JS -->
  <Teleport to="#teleports"><CartDrawer v-if="cartOpen" /></Teleport>
</template>
```

`SpecsTable.server.vue` рендерится островом: его разметка есть в HTML, но кода в бандле нет. При навигации клиент получит HTML запросом `/__nuxt_island/...`. Модалка телепортируется в `#teleports`, единственную цель с поддержкой SSR.

## Вопросы с интервью

::: details Чем universal rendering отличается от SPA и SSG в Nuxt
Universal: Nitro рендерит страницу на каждый запрос, отдаёт HTML с payload, а клиент гидрирует его тем же кодом. SPA (`ssr: false`): сервер или CDN отдаёт пустой `#__nuxt` со скриптами, всё рендерит браузер. Payload пустой, extraction выключен. SSG (`nuxi generate` или `prerender`): тот же SSR, но выполненный при сборке. Краулер обходит ссылки от `/`, HTML и `_payload.json` лежат в `.output/public`, сервера нет. Гидрация на клиенте одинакова для universal и SSG. Режим выбирают по маршрутам через `routeRules`, и обычно получается гибрид.
:::

::: details Что происходит с правилом swr на уровне Nitro и чем оно отличается от isr
`swr: N` нормализуется в `cache: { swr: true, maxAge: N }`. Обработчик маршрута, в том числе рендерер, оборачивается в `cachedEventHandler`. Ответ хранится в storage Nitro (по умолчанию в памяти процесса) с ключом по пути, query и методу. Ставится `s-maxage=N, stale-while-revalidate`, после срока отдаётся старая версия, а новая рендерится в фоне. `isr` делает то же через CDN платформы: на Vercel и Netlify Nitro генерирует их конфиг. На node-сервере `isr` не кэширует ничего, каждый запрос рендерится заново.
:::

::: details Почему routeRules нельзя использовать для защиты страниц
Правило выбирает способ ответа по пути URL и не знает о пользователе. `ssr: false` для `/admin/**` отдаёт оболочку любому, а данные страница всё равно получает из API, который открыт без правила. Клиент получает шаблоны правил в бандле и выполняет `redirect` сам. Кэширующие правила вдобавок вырезают cookie из запроса, так что персональная логика внутри них не работает. Доступ проверяется в серверном коде: `server/middleware` или в каждом обработчике.
:::

::: details Что такое payload extraction и когда появляется _payload.json
Для маршрутов с `prerender`, `swr`, `cache` или `isr` Nuxt выносит `data` (кэш `useAsyncData`/`useFetch`) в `/<route>/_payload.json`, а в HTML оставляет `state` и ссылку `preload`. Зачем: при клиентском переходе на такой маршрут Nuxt грузит этот файл вместо вызова API. Данные совпадают со снимком HTML, а пререндеренный сайт работает без сервера. `NuxtLink` заранее загружает payload видимых ссылок. Для `ssr: false` extraction выключен. В Nuxt 5 по умолчанию `'client'`: первый ответ содержит payload целиком, файл нужен только для навигации.
:::

::: details Чем отличаются ClientOnly, .client, .server и NuxtIsland
`<ClientOnly>` и `.client.vue` на сервере дают заглушку (`fallback` или пустой `div`) и рендерятся после `mounted`. JS у них есть, но HTML первого экрана беднее: хуже LCP и возможен CLS. `.server.vue` и `<NuxtIsland>` — обратный случай: HTML рендерит только сервер, кода в клиентском бандле нет, гидрации нет. При навигации клиент получает HTML острова запросом `GET /__nuxt_island/<Name>_<hash>.json?props=…`. Это публичный эндпоинт, хэш — не подпись. Пара `.server` + `.client` с одним именем даёт серверный HTML, который после монтирования заменяется клиентской версией.
:::

::: details Как Nuxt реализует hydrate-on-visible поверх Vue
Плагин сборки ищет в шаблоне `Lazy`-компоненты с атрибутами стратегии и переименовывает `<LazyChart hydrate-on-visible>` в `<LazyVisible_Chart>`. Загрузчик подставляет фабрику `createLazyVisibleComponent`. Это обёртка над `defineAsyncComponent({ hydrate: hydrateOnVisible() })` из Vue 3.5. Сервер помечает модуль в `ssrContext['~lazyHydratedModules']`, и рендерер ставит чанк в `prefetch`, а не в `modulepreload`. Без префикса `Lazy` трансформа нет, и компонент гидрируется сразу (в dev — `NUXT_B3006`). Изменение пропа до срабатывания стратегии перерисовывает компонент и тем самым гидрирует.
:::

::: details Как работает Teleport при SSR в Nuxt
Vue копит HTML телепортов в `ssrContext.teleports` по селектору цели. Nuxt вставляет `#teleports` в контейнер `<div id="teleports">` после `#__nuxt`, и только эту цель документация поддерживает при SSR. Другие цели оборачивают в `<ClientOnly>`. В 4.6.4 `to="body"` тоже работает, его HTML вставляется в начало `<body>`, но это деталь реализации. Селектор внутри приложения, например `#modals` в layout, при SSR теряется.
:::

## Задачи

### 1. Что выведет · легко

Страница под правилом `'/me': { swr: 60 }`. Её открывают по очереди Алиса (`cookie: user=alice`) и Боб (`cookie: user=bob`). Что увидит каждый?

```vue
<script setup lang="ts">
const user = useCookie('user')
</script>
<template><p>user={{ user ?? 'anon' }}</p></template>
```

::: details Решение и разбор
Оба увидят `user=anon`. Проверено: при обеих cookie HTML был `user=anon cookieHeader=none`.

Можно ожидать, что Боб увидит закэшированную страницу Алисы. Но Nitro передаёт закэшированному обработчику копию запроса, в которой остались только заголовки из `varies`. Cookie до рендера не доходят, и страница рендерится как для анонима. Ключ кэша — путь и query, поэтому этот единственный вариант получат все.

Утечка данных всё же возможна: если страница берёт пользователя не из cookie, а, например, из query `?token=`, или если CDN перед сервером кэширует ответ по `s-maxage`. Персональные части на кэшируемой странице загружают на клиенте (`useFetch('/api/me', { server: false })`), а персональные страницы не кэшируют.
:::

### 2. Найдите баг · средне

Команда закрыла админку так:

```ts
export default defineNuxtConfig({
  routeRules: { '/admin/**': { ssr: false, appMiddleware: { auth: true } } },
})
```

```ts
// server/api/admin/users.get.ts
export default defineEventHandler(() => db.users.findMany())
```

::: details Решение и разбор
Правила защищают только страницу, и то условно. `ssr: false` убирает серверный рендер. `appMiddleware` — middleware Vue-приложения, оно выполняется в браузере пользователя, и его можно обойти. Проверено: `curl /api/secret` без cookie вернул данные, а `ssr: false`-оболочка `/admin` отдаётся всем с `200`. Шаблон `/admin/**` при этом виден в клиентском бандле.

Проверка должна быть на сервере, рядом с данными:

```ts
// server/api/admin/users.get.ts
export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)   // throws createError({ statusCode: 403 })
  return db.users.findMany()
})
```

Middleware страницы оставляют для UX: редирект на логин без мигания. `ssr: false` можно оставить для экономии рендера.
:::

### 3. Найдите баг · средне

Блок отзывов должен гидрироваться при появлении в viewport. По Performance-профилю он гидрируется сразу при загрузке.

```vue
<template>
  <ProductHero />
  <ReviewsList hydrate-on-visible :product-id="id" />
</template>
```

::: details Решение и разбор
Нет префикса `Lazy`. Трансформ Nuxt переименовывает только `Lazy`-теги (`<LazyReviewsList hydrate-on-visible>` → `<LazyVisible_ReviewsList>`). Для обычного компонента `hydrate-on-visible` — просто атрибут. Он попадает в DOM как `hydrate-on-visible=""`, а компонент гидрируется вместе со страницей. Проверено на аналогичном компоненте: лог из `onMounted` появился до прокрутки. В `nuxi dev` есть подсказка `[NUXT_B3006] … has lazy-hydration props but is not declared as a lazy component`, в production предупреждения нет.

```vue
<LazyReviewsList hydrate-on-visible :product-id="id" />
```

Есть и вторая ловушка: если тот же компонент где-то используется без `Lazy`, его модуль импортируется статически, и отдельного чанка не будет. Сборка предупреждает `INEFFECTIVE_DYNAMIC_IMPORT`. Гидрация всё равно отложится, но JS загрузится сразу.
:::

### 4. Что выведет · средне

Приложение задеплоено как `node .output/server/index.mjs`. Время рендера страница выводит из `useState('at', () => new Date().toISOString())`. Сколько разных значений покажут три запроса подряд с интервалом в секунду для `/a` с `swr: 60` и `/b` с `isr: 60`?

::: details Решение и разбор
`/a` — одно значение: первый ответ лежит в storage Nitro 60 секунд. `/b` — три разных значения. На node-пресете `isr` ничего не кэширует. Проверено: заголовков кэша нет, каждый запрос отрендерен заново.

`isr` — правило для платформ с CDN-кэшем (Vercel, Netlify): там Nitro генерирует конфиг, по которому кэширует CDN. На своём сервере нужен `swr` или `cache` и, при нескольких инстансах, общий storage (`nitro.storage` с Redis), иначе у каждого процесса свой кэш в памяти. Переезд с Vercel на свой сервер без замены `isr` на `swr` молча выключает кэш, и нагрузка на рендер возрастает в разы.
:::

### 5. Найдите баг · сложно

Модалка подтверждения в layout. В SPA-навигации всё работает. При открытии страницы по прямой ссылке с `?confirm=1` модалки в серверном HTML нет. Она появляется только после гидрации, а Vue сообщает о расхождении.

```vue
<!-- app/layouts/default.vue -->
<template>
  <slot />
  <div id="modals" />
</template>
```

```vue
<!-- app/pages/order.vue -->
<script setup lang="ts">
const open = computed(() => useRoute().query.confirm === '1')
</script>
<template>
  <Teleport to="#modals"><ConfirmDialog v-if="open" /></Teleport>
</template>
```

::: details Решение и разбор
При SSR Vue кладёт HTML телепорта в `ssrContext.teleports['#modals']`. Nuxt вставляет в страницу только `#teleports` (и в 4.6.4 — `body`), поэтому разметка диалога пропала, а `#modals` пришёл пустым. При гидрации цель уже есть в DOM. Vue находит в ней меньше узлов, чем в vnode, и монтирует диалог заново. Проверено на странице с `<Teleport to="#modals">` и `<div id="modals" />`: `Hydration children mismatch … Server rendered element contains fewer child nodes than client vdom`, затем `Hydration completed but contains mismatches`. До загрузки JS диалога нет ни в HTML, ни на экране.

```vue
<Teleport to="#teleports"><ConfirmDialog v-if="open" /></Teleport>
```

`#teleports` есть в каждом HTML Nuxt и стоит вне `#__nuxt`, поэтому SSR и гидрация согласованы. Проверено: `<div id="teleports"><!--teleport start anchor--><div id="modal-a">A</div>…`. Если нужна именно своя цель, телепорт рендерят только на клиенте: `<ClientOnly><Teleport to="#modals">…</Teleport></ClientOnly>`. Но тогда модалки нет в серверном HTML.
:::

## Источники

- [Nuxt 4: Rendering Modes](https://nuxt.com/docs/4.x/guide/concepts/rendering)
- [Nuxt 4: Prerendering (crawler, `prerenderRoutes`, payload extraction)](https://nuxt.com/docs/4.x/getting-started/prerendering)
- [Nuxt 4: Components — `.client`, `.server`, Lazy, Delayed Hydration](https://nuxt.com/docs/4.x/directory-structure/app/components)
- [Nuxt 4: `<ClientOnly>`](https://nuxt.com/docs/4.x/api/components/client-only), [`<NuxtIsland>`](https://nuxt.com/docs/4.x/api/components/nuxt-island), [`<Teleport>`](https://nuxt.com/docs/4.x/api/components/teleports)
- [Nuxt 4: Nuxt and Hydration](https://nuxt.com/docs/4.x/guide/best-practices/hydration)
- [Nuxt 4: Upgrade Guide — Testing Nuxt 5](https://nuxt.com/docs/4.x/getting-started/upgrade)
- [Nuxt 3: Rendering Modes](https://nuxt.com/docs/3.x/guide/concepts/rendering)
- [Nitro: Route Rules](https://nitro.build/config#routerules), [Cache](https://nitro.build/guide/cache)
- [Vue.js: Server-Side Rendering — Teleports](https://vuejs.org/guide/scaling-up/ssr.html#teleports), [Lazy Hydration](https://vuejs.org/guide/components/async.html#lazy-hydration)
- [Исходники Nuxt: `runtime/server/renderer`, `components/runtime/lazy-hydrated-component.ts`, `app/composables/payload.ts`](https://github.com/nuxt/nuxt/tree/v4.6.4/packages/nuxt/src)
- [Исходники Nitro: `runtime/internal/route-rules.ts`, `cache.ts`](https://github.com/nitrojs/nitro/tree/v2.13.6/src/runtime/internal)
- [Находки «Nuxt 3 → Nuxt 4: отличия, важные для интервью»](https://github.com/alexrehtide/learning/blob/research/nuxt-3-vs-4/research/nuxt-3-vs-4.md)
- [Находки «Ключевые темы senior frontend-интервью»](https://github.com/alexrehtide/learning/blob/research/senior-interview-topics/research/senior-interview-topics.md)
