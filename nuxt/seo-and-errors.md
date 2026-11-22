---
title: SEO и обработка ошибок
level: ядро
---

# SEO и обработка ошибок

> **Коротко.** Мета-теги в Nuxt собирает Unhead: `useHead`, `useSeoMeta` и `app.head` добавляют записи в head-менеджер, а на сервере он сериализует их в `<head>` **после** рендера. Поэтому в HTML попадает всё, что задано в `setup`, в том числе после `await useFetch`, но не то, что появилось в `onMounted` или из данных с `server: false`. Ошибки проходят через `createError` и `useError()`: на сервере любая ошибка компонента заменяет страницу на `error.vue` со статусом ответа, а на клиенте страницу ошибки показывают только fatal-ошибки. Ошибка `useFetch` страницу не роняет и статус не меняет. Чтобы получить 404, её бросают сами.

**Связанные темы:** [Маршрутизация](./routing.md), [Работа с данными: `$fetch`, `useFetch`, `useAsyncData`](./data-fetching.md), [Middleware и плагины](./middleware-and-plugins.md), [Режимы рендеринга и lazy hydration](./rendering-modes.md), [Nitro: серверные маршруты и деплой](./nitro.md), [Структура проекта и auto-imports](./project-structure.md), [Плагины и обработка ошибок](../vue/plugins-and-error-handling.md), [SSR и гидрация](../vue/ssr-and-hydration.md), [XSS и безопасный вывод во Vue](../security/xss.md), [Нефункциональные требования](../architecture/non-functional.md)

## Теория

Все фрагменты проверены на Nuxt 4.6.4 (Unhead 3.4.3, Nitro 2.13.6) и Vue 3.5.45 в Node 26.13.1. Ответы сервера сняты `curl` с `nuxi build` + `node .output/server/index.mjs`, поведение на клиенте проверено в Chromium через Playwright, сравнение с dev — через `nuxi dev`. Типы проверены `vue-tsc -b` на TypeScript 6.0.3. Устройство описано по исходникам: `nuxt/dist/head/runtime/`, `nuxt/dist/app/components/nuxt-root.vue`, `nuxt-error-boundary.vue`, `nuxt/dist/app/composables/error.js`, `nuxt/dist/runtime/server/renderer/` и `@nuxt/nitro-server/dist/runtime/handlers/error.mjs`.

### Почему мета-теги должны быть в SSR-ответе

Боты соцсетей и мессенджеров, которые строят превью ссылки по Open Graph, читают только HTML ответа и JavaScript не выполняют. Поисковик, который умеет рендерить JS, делает это отдельным, более поздним проходом, и результат не гарантирован. Тег, добавленный после гидрации, для них не существует.

Как тег попадает в HTML. На сервере плагин `nuxt:head` подключает к приложению head-экземпляр из `ssrContext`. `useHead(input)` на сервере просто кладёт запись в список (`head.push`), не подписываясь на изменения. Рендерер Nuxt сначала выполняет `renderToString` и ждёт все `async setup` и `useFetch`, затем вызывает `renderSSRHead` и вставляет результат в `<head>`. Ref и геттеры во входных данных разрешаются в этот момент, поэтому `title: () => data.value?.name` даёт название товара, даже если `useHead` вызван до `await`.

Что видно в HTML (проверено, у каждой страницы шаблон заголовка `%s · Shop`):

| Как заданы данные | `<title>` в ответе сервера |
| --- | --- |
| `await useFetch(...)`, затем геттер в `useSeoMeta` | `Kettle · Shop` |
| `useFetch(..., { lazy: true })` без `await` | `Kettle · Shop`: на сервере `lazy` всё равно ждёт запрос |
| `useFetch(..., { server: false })` | `Loading · Shop`: запрос выполнится только в браузере |
| `ref` в `useHead`, изменён в `onMounted` | `Before mount · Shop`, а в браузере после гидрации `After mount · Shop` |

На клиенте `useHead` работает иначе: оборачивает вход в `watchEffect`, обновляет запись при изменении зависимостей и удаляет её при размонтировании компонента. Поэтому мета-теги страницы исчезают при уходе со страницы, и их не нужно чистить вручную.

### `app.head`, `useHead`, `useSeoMeta`

| API | Где | Для чего |
| --- | --- | --- |
| `app.head` в `nuxt.config` | на каждой странице | статические значения по умолчанию: `lang`, `charset`, `viewport`, favicon. Только сериализуемые данные, функции сюда не передать |
| `useHead` | компоненты, плагины | любые теги: `title`, `titleTemplate`, `meta`, `link`, `script`, `htmlAttrs`, `bodyAttrs` |
| `useSeoMeta` | компоненты | плоский типизированный объект: `description`, `ogTitle`, `ogImage`, `twitterCard`. Сам решает, где `name`, а где `property` |
| `useHeadSafe` | компоненты | ввод из недоверенного источника: пропускает только безопасные теги и атрибуты |
| `<Head>`, `<Title>`, `<Meta>` | шаблон | то же самое через компоненты |

Записи **дедуплицируются** по ключу: `<title>` один, `meta` — по `name` или `property`, `link rel="canonical"` один. Проверено: `description` страницы заменил `description` из `app.head`, а не добавился вторым тегом. Порядок тегов в `<head>` выбирает Unhead по весам Capo.js: `charset`, `viewport` и `title` идут первыми, затем скрипты и стили, затем остальные `meta`. Порядок вызовов в коде на него не влияет.

**`titleTemplate`.** Строка `'%s · Shop'` из `app.head` на странице без заголовка дала `<title>· Shop</title>` (проверено). Функция обрабатывает этот случай, но в `nuxt.config` её не передать, поэтому её ставят в `useHead` в `app.vue`. Страница отключает шаблон через `titleTemplate: null`. Ловушка: `app.vue` не рендерится, когда показана страница ошибки (см. ниже), и `error.vue` получает шаблон только из `app.head`.

**Реактивность.** `useSeoMeta({ title: data.value?.name })` передаёт значение, вычисленное в момент вызова, а `title: () => data.value?.name` — геттер, который Unhead перечитывает. На сервере разница видна, если данные приходят после вызова. На клиенте — когда данные обновляются без пересоздания компонента: `refresh()`, смена query, страница с одинаковым `key`.

### Canonical, Open Graph, структурированные данные

- **Canonical** — абсолютный URL без трекинговых параметров. Хост берут из конфигурации (`runtimeConfig.public.siteUrl`), а не из запроса: за прокси или CDN `useRequestURL()` может вернуть внутренний адрес.
- **`og:image` и `og:url`** должны быть абсолютными. Nuxt не дописывает домен: `ogImage: '/og.png'` в HTML остался `/og.png` (проверено). В Unhead v3 есть `CanonicalPlugin`, который это делает, но Nuxt по умолчанию его не подключает.
- **JSON-LD** — `useHead({ script: [{ type: 'application/ld+json', innerHTML: {...} }] })`. Объект Unhead сериализует сам, а `<` экранирует в `<`: имя товара `Kettle </script><script>alert(1)</script>` не закрыло тег (проверено, в том числе для строкового `innerHTML`). Общая картина XSS — в [отдельной теме](../security/xss.md).
- **`robots.txt` и sitemap** обычно отдают модули: `@nuxtjs/robots` (7.x), `@nuxtjs/sitemap` (9.x) или набор `@nuxtjs/seo` (6.x). Последние версии требуют Nuxt 4.6 и выше. Без модулей `robots.txt` — файл в `public/`, а sitemap — маршрут в `server/routes/sitemap.xml.ts` ([«Nitro»](./nitro.md)). Страницам ошибок и служебным страницам ставят `robots: 'noindex'`.

### Unhead: от v1 к v3

| Версия Nuxt | Unhead | Что важно |
| --- | --- | --- |
| 3.0–3.15 | v1 | `hid`, `vmid`, `children`, `body: true` ещё работают |
| 3.16+ | v2 | в Nuxt 3 — со слоем совместимости, поведение прежнее |
| 4.0–4.4 | v2 | `hid`/`vmid` → `key`, `children` → `innerHTML`, `body: true` → `tagPosition: 'bodyClose'`, промисы во входных данных устарели, сортировка по Capo.js |
| 4.5+ | v3 | синхронный движок (нужен для SSR streaming), строже типы `useHead` |

В Nuxt 4.5 (июль 2026) Unhead обновили до v3. Чтобы рантайм не сломался, при `compatibilityVersion < 5` Nuxt подключает `legacyPlugins` из `@unhead/vue/legacy`: `DeprecationsPlugin`, `PromisesPlugin`, `TemplateParamsPlugin`, `AliasSortingPlugin`. Поэтому миграция ломает в основном типы. `link` и `script` теперь сужаются по `rel` и `type`: `rel: 'preload'` требует `as`, а у `meta` обязателен `content`.

**`useServerSeoMeta` и `useServerHead`.** В Unhead v3 это просто псевдонимы `useSeoMeta` и `useHead`. Серверными их делает Nuxt: в прод-сборке клиентская версия — заглушка, которая ничего не делает (видно в собранном `_nuxt/*.js`). В dev заглушки нет, и вызов срабатывает и в браузере. В исходниках они помечены `@deprecated`: «используйте `useHead` и оберните в `if (import.meta.server)`». С `compatibilityVersion: 5` они убраны из авто-импортов. Чем грозит расхождение dev и прода — задача 3.

> [!NOTE]
> В Nuxt 3 было иначе: до 3.16 работал Unhead v1, а с 3.16 — v2 со слоем совместимости, поэтому `hid`, `vmid` и `children` продолжали работать ([nuxt.com/docs/3.x/getting-started/seo-meta](https://nuxt.com/docs/3.x/getting-started/seo-meta)). Отказ от них стал обязательным при переходе на Nuxt 4 (раздел «Unhead v2» в Upgrade Guide).

### Ошибка как объект

`createError` создаёт `NuxtError` — это `H3Error` с меткой `__nuxt_error`, поэтому один и тот же объект понимают и Vue-приложение, и Nitro. Поля:

- `status` и `statusText` — код и строка статуса. С Nuxt 4.3 это основные имена, а `statusCode` и `statusMessage` работают как deprecated-псевдонимы (подготовка к h3 v2). Если передан только `statusText`, он же становится `message`.
- `data` — произвольные данные для страницы ошибки. С Nuxt 4.0 (`experimental.parseErrorData`) в `error.vue` приходит объект, а не JSON-строка.
- `fatal` — показать ли страницу ошибки на клиенте.
- `unhandled` — ошибка не создана явно: Nuxt обернул обычное исключение. Её `message` и `data` в ответ сервера не попадают.

Текущая ошибка приложения — `useError()`, это `toRef(nuxtApp.payload, 'error')`. `showError(err)` записывает её, `clearError({ redirect })` очищает и при необходимости переходит по адресу. Корневой компонент `nuxt-root.vue` рендерит `error.vue` **вместо** `app.vue`, когда ошибка есть. Поэтому на странице ошибки нет layout, `app.vue` и всего, что в нём задано.

### Ошибка на сервере

В `nuxt-root.vue` стоит `onErrorCaptured`. На сервере он превращает **любую** ошибку компонента в `showError` и останавливает всплытие: флаг `fatal` здесь роли не играет. Проверено: `throw createError({ status: 400 })` без `fatal` в `setup` страницы дал ответ `400` и `error.vue`.

Как ошибка становится ответом:

1. `renderToString` завершается, рендерер видит `payload.error` и бросает её.
2. Обработчик ошибок Nitro (`@nuxt/nitro-server`) смотрит на запрос. Если клиент не просит HTML (`Accept` без `text/html`, как у `curl` по умолчанию), ответ — JSON с `status` и `statusText`.
3. Для браузера обработчик делает **внутренний запрос** `/__nuxt_error?status=...&statusText=...` через `localFetch` и рендерит приложение заново, теперь с `error.vue`. Статус ответа берётся из ошибки. В логе видно, что server middleware выполняется второй раз, уже для `/__nuxt_error`.

Необработанное исключение (`throw new Error('db password is hunter2')`) дало `500` со строкой `Server Error`. Текст ушёл только в лог и в хук `error` Nitro. Явный `createError` отдаёт `message` и `data` как есть.

**Ошибка `useFetch` — не ошибка страницы.** Запрос к API вернул 404, а страница ответила **`200`**: ошибка лежит в `error.value` и в `payload._errors`, а шаблон рендерится как обычно. Для поисковика это «мягкая 404» (soft 404) — пустая страница с кодом 200. Страница, которая не может существовать без данных, бросает ошибку сама:

```ts
const { data, error } = await useFetch(() => `/api/products/${route.params.id}`)
if (error.value) {
  throw createError({ status: error.value.status, statusText: error.value.statusText, fatal: true })
}
```

`error.value.data` — тело ответа API, то есть JSON ошибки h3 (`{ error, url, status, statusText, message, data }`), а не поле `data`, переданное в `createError` на сервере. Оно лежит уровнем глубже: `error.value.data.data`.

> [!TIP]
> Nuxt 4.6 добавил `experimental.inlineErrorRendering`: `error.vue` рендерится в том же запросе через `try/catch`, без захода в `/__nuxt_error`. Тогда cookie и заголовки, выставленные до ошибки, сохраняются, а middleware и `routeRules` не выполняются повторно. С `compatibilityVersion: 5` это поведение по умолчанию.

### Ошибка на клиенте

После гидрации корневой `onErrorCaptured` показывает страницу ошибки, только если пойман `NuxtError` с `fatal` или `unhandled`. Обычное исключение не является `NuxtError`, поэтому оно уходит дальше по цепочке Vue ([«Плагины и обработка ошибок»](../vue/plugins-and-error-handling.md)) и заканчивается в консоли. Что проверено в браузере:

| Что произошло | Результат |
| --- | --- |
| переход на страницу с `createError({ status: 400 })` без `fatal` | URL сменился, на месте страницы пусто, в консоли ошибка. Сервер на тот же адрес отдаёт 400 и `error.vue` |
| то же с `fatal: true` | `error.vue` с 403 |
| `throw new Error` в обработчике клика | только консоль |
| `throw new Error` в компоненте, смонтированном после гидрации | пустое место на месте компонента, консоль |
| `throw new Error` **во время гидрации** | `error.vue` с 500 и текстом ошибки: пока гидрация не закончилась, работает обработчик Nuxt по умолчанию |
| то же с User-Agent Googlebot | SSR-разметка осталась, страницы ошибки нет |
| `showError({ status: 418 })`, затем `clearError({ redirect: '/' })` | `error.vue`, затем главная |
| переход на несуществующий маршрут | `error.vue` с 404 (`fatal: false`, но его показывает плагин роутера) |

Последнее «во время гидрации» объясняет `entry.js`: до события `app:suspense:resolve` у приложения стоит `app.config.errorHandler`, который записывает ошибку в `payload.error`, а потом Nuxt его снимает. Исключение для ботов появилось в 4.5: если клиент — краулер, ошибки роутера и гидрации не заменяют серверный HTML, и бот индексирует то, что пришло с сервера.

В route middleware ошибку возвращают или передают в `abortNavigation(createError({ ..., fatal: true }))`. Разбор — в [«Middleware и плагины»](./middleware-and-plugins.md).

### `<NuxtErrorBoundary>`

Граница для части страницы: ловит ошибки поддерева через `onErrorCaptured`, сохраняет их в `shallowRef`, эмитит `error`, вызывает хук `vue:error` и рендерит слот `#error` с `{ error, clearError }`. Устройство то же, что у самодельной границы из [темы про Vue](../vue/plugins-and-error-handling.md). Три особенности видны в `nuxt-error-boundary.vue`:

- **Работает только на клиенте.** `onErrorCaptured` регистрируется под `if (import.meta.client)`. Если виджет внутри границы бросил при SSR, ошибка уходит в корень, и вся страница отвечает `500` (проверено). Граница защищает от ошибок после загрузки, а не от падения серверного рендера. Виджет, который может упасть на сервере, обрабатывает ошибку сам или рендерится в `<ClientOnly>` (проверено: страница `200`, а граница показала слот `#error` в браузере).
- **Во время гидрации** ошибка обрабатывается после `onNuxtReady`, чтобы не менять DOM посреди гидрации.
- **`return false`**: ошибка не дойдёт до `app.config.errorHandler`. Для мониторинга нужен хук `vue:error` или событие `@error`.

`clearError` из слота только сбрасывает состояние границы. Если причина осталась, повторный рендер упадёт снова.

### Хуки ошибок

| Хук | Где | Когда вызывается (проверено) |
| --- | --- | --- |
| `vue:error` | сервер и клиент | ошибка компонента, пойманная корнем или `<NuxtErrorBoundary>` |
| `app:error` | в основном клиент | `showError`, fatal-ошибка при навигации, ошибка инициализации плагинов. На сервере ошибка `setup` страницы его **не** вызвала: только `vue:error` |
| `error` в Nitro-плагине | сервер | любая ошибка запроса, в том числе ошибка рендера и API, с полным стеком |
| `app.config.errorHandler` | сервер и клиент | свой обработчик Vue. Корень Nuxt вызывает его явно, даже когда останавливает всплытие |

Клиентский мониторинг вешают на `vue:error` и `app:error` в плагине `.client.ts`, серверный — на хук `error` в `server/plugins/` ([«Nitro»](./nitro.md)). Что собирать и как не утечь данными — задача в [«Нефункциональных требованиях»](../architecture/non-functional.md).

> [!NOTE]
> В Nuxt 3 было иначе: `error.vue` лежал в корне проекта, а не в `app/`, `error.data` приходил JSON-строкой (нужен был `JSON.parse`), а `statusCode`/`statusMessage` были единственными именами полей ([nuxt.com/docs/3.x/getting-started/error-handling](https://nuxt.com/docs/3.x/getting-started/error-handling)).

> [!NOTE]
> Nuxt 5 (не выпущен, сверено 2026-11-22 по релизам `nuxt/nuxt`): `inlineErrorRendering` включён по умолчанию, `useServerHead`, `useServerSeoMeta` и `useServerHeadSafe` убраны из авто-импортов, legacy-плагины Unhead не подключаются (остаётся только `TemplateParamsPlugin`). Всё это уже можно включить через `future.compatibilityVersion: 5`.

## Примеры

### Значения по умолчанию и шаблон заголовка

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  app: {
    head: {
      htmlAttrs: { lang: 'ru' },
      titleTemplate: '%s · Shop', // used by error.vue: app.vue is not rendered there
      meta: [{ name: 'description', content: 'Default description' }],
    },
  },
  runtimeConfig: { public: { siteUrl: 'https://shop.example' } },
})
```

```vue
<!-- app/app.vue -->
<script setup lang="ts">
// A function handles pages without a title: "Shop" instead of "· Shop"
useHead({ titleTemplate: (title) => (title ? `${title} · Shop` : 'Shop') })
</script>

<template>
  <NuxtLayout><NuxtPage /></NuxtLayout>
</template>
```

### Страница товара: статус, мета-теги, JSON-LD

```vue
<!-- app/pages/products/[id].vue -->
<script setup lang="ts">
const route = useRoute()
const { public: { siteUrl } } = useRuntimeConfig()
const { data: product, error } = await useFetch(() => `/api/products/${route.params.id}`)

if (error.value) {
  // without this the page answers 200 with an empty template (soft 404)
  throw createError({ status: error.value.status, statusText: error.value.statusText, fatal: true })
}

useSeoMeta({
  title: () => product.value?.name,             // getters, not values
  description: () => product.value?.description,
  ogTitle: () => product.value?.name,
  ogImage: () => `${siteUrl}/og/${route.params.id}.png`, // absolute URL
})
useHead({
  link: [{ rel: 'canonical', href: () => `${siteUrl}${route.path}` }], // no query, no request host
  script: [{
    type: 'application/ld+json',
    innerHTML: () => ({ '@context': 'https://schema.org', '@type': 'Product', name: product.value?.name }),
  }],
})
</script>
```

### `error.vue`

```vue
<!-- app/error.vue -->
<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
useSeoMeta({ title: () => `Ошибка ${props.error.status}`, robots: 'noindex' })

const goHome = () => clearError({ redirect: '/' })
</script>

<template>
  <main>
    <h1>{{ error.status === 404 ? 'Страница не найдена' : 'Что-то пошло не так' }}</h1>
    <p>{{ error.statusText }}</p>
    <button @click="goHome">На главную</button>
  </main>
</template>
```

Layout здесь не применяется, поэтому шапку и подвал подключают в `error.vue` явно (`<NuxtLayout>` внутри работает).

## Вопросы с интервью

::: details Почему мета-теги должны быть в HTML ответа и как Nuxt их туда кладёт
Боты соцсетей и мессенджеров не выполняют JavaScript и строят превью только по HTML. Поисковики рендерят JS отдельным поздним проходом, без гарантии. На сервере `useHead` и `useSeoMeta` складывают записи в head-экземпляр из `ssrContext`. Рендерер Nuxt сначала дожидается `renderToString` со всеми `async setup` и `useFetch`, затем вызывает `renderSSRHead` и вставляет теги в `<head>`. Ref и геттеры разрешаются в этот момент, поэтому заголовок из данных `await useFetch` попадает в HTML. Не попадает то, что задано в `onMounted` или зависит от запроса с `server: false`. `lazy: true` на сервере не мешает: сервер всё равно ждёт запрос.
:::

::: details Чем отличаются app.head, useHead, useSeoMeta и useServerSeoMeta
`app.head` в `nuxt.config` — статические значения для всех страниц, только сериализуемые, функцию `titleTemplate` туда не передать. `useHead` — любые теги, реактивно, с удалением при размонтировании. `useSeoMeta` — плоский типизированный объект, где опечатка в `ogTitle` ловится типами, а `name` и `property` выбираются автоматически. Записи дедуплицируются по ключу, поэтому `description` страницы заменяет значение из `app.head`. `useServerSeoMeta` в Unhead v3 — псевдоним `useSeoMeta`, а серверным его делает Nuxt, подменяя клиентскую версию заглушкой в прод-сборке. В dev он срабатывает и на клиенте, помечен deprecated, рекомендуемая замена — `useSeoMeta` под `if (import.meta.server)`.
:::

::: details Что изменилось в управлении head между Nuxt 3 и Nuxt 4
Nuxt 3 до 3.16 работал на Unhead v1, с 3.16 — на v2 со слоем совместимости. Nuxt 4.0 убрал эту совместимость: `hid` и `vmid` заменил `key`, `children` — `innerHTML`, `body: true` — `tagPosition: 'bodyClose'`, промисы во входных данных устарели, теги сортируются по Capo.js. С Nuxt 4.5 под капотом Unhead v3: синхронный рендер (нужен для SSR streaming) и строгие типы `useHead`, где `preload` требует `as`, а у `meta` обязателен `content`. Рантайм почти не изменился, потому что при `compatibilityVersion < 5` Nuxt подключает legacy-плагины Unhead. В Nuxt 5 их не будет, а `useServer*` уйдут из авто-импортов.
:::

::: details Как ошибка при SSR превращается в ответ с правильным статусом
Корневой `onErrorCaptured` на сервере превращает любую ошибку компонента в `showError`, независимо от `fatal`, и ошибка записывается в `payload.error`. После рендера рендерер бросает её в Nitro. Обработчик ошибок отвечает JSON, если клиент не просит HTML. Для браузера он делает внутренний запрос `/__nuxt_error` с полями ошибки в query и рендерит приложение второй раз, уже с `error.vue`, а статус берёт из ошибки. Поэтому server middleware выполняется повторно, а заголовки и cookie, выставленные упавшим рендером, не доходят до ответа. В 4.6 это меняет `experimental.inlineErrorRendering`, по умолчанию он включится в Nuxt 5. Необработанное исключение даёт 500 с текстом `Server Error`, а `message` явного `createError` уходит клиенту как есть.
:::

::: details Чем fatal-ошибка отличается от обычной
На сервере ничем: любая ошибка в компоненте страницы даёт `error.vue` и статус ошибки. На клиенте после гидрации `nuxt-root.vue` показывает страницу ошибки только для `NuxtError` с `fatal` или `unhandled`. Обычный `createError` при клиентском переходе оставляет пустое место на месте страницы и ошибку в консоли. Получается, что один URL при прямом заходе отдаёт 400 и страницу ошибки, а при переходе по ссылке — пустой экран. Поэтому ошибки, после которых страница бессмысленна, помечают `fatal: true` или вызывают `showError`. Ошибки части страницы ловят `<NuxtErrorBoundary>` или обрабатывают локально. Исключение — гидрация: пока она не закончилась, работает обработчик Nuxt по умолчанию, и даже обычное исключение показывает `error.vue` с 500.
:::

::: details Как отдать 404 для несуществующего товара, если данные приходят через useFetch
`useFetch` ошибку не бросает: она лежит в `error.value`, страница рендерится, и сервер отвечает 200. Для поисковика это soft 404, пустая страница с кодом успеха. Нужно проверить `error.value` после `await` и бросить `createError({ status: error.value.status, statusText: error.value.statusText, fatal: true })`. На сервере это даст ответ 404 с `error.vue`, на клиентском переходе — страницу ошибки (без `fatal` её не было бы). Поля API-ошибки лежат в `error.value.data` как тело ответа h3, поэтому свой `data` с сервера читается из `error.value.data.data`. Если 404 означает «нет маршрута», а не «нет данных», его проверяют раньше, в `definePageMeta({ validate })`, до рендера страницы.
:::

::: details Как работает NuxtErrorBoundary и чего он не ловит
Это обёртка над `onErrorCaptured`: ошибка поддерева кладётся в `shallowRef`, вызываются `@error` и хук `vue:error`, всплытие останавливается (`return false`), и рендерится слот `#error` с `error` и `clearError`. Обработчик зарегистрирован только на клиенте. Ошибка внутри границы при SSR уходит в корень и роняет всю страницу в 500. Во время гидрации ошибка обрабатывается после `onNuxtReady`. Не ловит ошибки вне Vue: таймеры, промисы без `await`, глобальные события. Не ловит свои ошибки. `clearError` лишь сбрасывает состояние, поэтому если причина осталась, ветка упадёт снова. Остановленная ошибка не доходит до `app.config.errorHandler`, мониторинг подключают через `vue:error`.
:::

::: details Какие хуки ошибок есть в Nuxt и куда подключать мониторинг
`vue:error` — ошибки компонентов на сервере и клиенте, его вызывают корень и `<NuxtErrorBoundary>`. `app:error` — ошибки уровня приложения: `showError`, fatal-ошибки при навигации, падение плагинов при старте. На сервере ошибка `setup` страницы его не вызывает. Хук `error` в Nitro-плагине получает любую ошибку запроса с полным стеком, включая скрытые от клиента `unhandled`. Это главный источник серверных ошибок. `app.config.errorHandler` Nuxt вызывает явно, даже когда останавливает всплытие. Клиентский SDK мониторинга вешают в `.client`-плагине на `vue:error` и `app:error`, добавляют `unhandledrejection` и ошибки загрузки чанков (`app:chunkError`), серверный — в `server/plugins` на хук `error`.
:::

## Задачи

### 1. Найдите баг · легко

Поиск проиндексировал тысячи пустых страниц удалённых товаров. Все они отвечают `200`.

```vue
<script setup lang="ts">
const route = useRoute()
const { data } = await useFetch(() => `/api/products/${route.params.id}`)
useSeoMeta({ title: data.value?.name })
</script>

<template>
  <div v-if="data">{{ data.name }}</div>
</template>
```

::: details Решение и разбор
API отвечает 404, но `useFetch` не бросает: ошибка лежит в `error.value`, шаблон рендерит пустой `div`, и сервер отдаёт 200 (проверено). Это soft 404. Вторая проблема — `title: data.value?.name` передаёт значение, а не геттер.

```ts
const { data, error } = await useFetch(() => `/api/products/${route.params.id}`)
if (error.value) {
  throw createError({ status: error.value.status, statusText: error.value.statusText, fatal: true })
}
useSeoMeta({ title: () => data.value?.name })
```

Теперь сервер отвечает 404 с `error.vue`, а `robots: 'noindex'` в `error.vue` гарантирует, что страница ошибки не попадёт в индекс, даже если статус где-то потеряется. `fatal: true` нужен для клиентского перехода: без него вместо страницы ошибки будет пустое место. Ошибки 5xx пробрасывают так же, но с текстом для пользователя, а не из ответа API.
:::

### 2. Что выведет · средне

В `nuxt.config` задан `app.head.titleTemplate: '%s · Shop'`. Какой `<title>` будет в ответе сервера для каждой страницы и какой в браузере после загрузки?

```vue
<!-- a.vue -->
<script setup lang="ts">
const { data } = useFetch('/api/products/1', { lazy: true }) // { name: 'Kettle' }
useSeoMeta({ title: () => data.value?.name ?? 'Loading' })
</script>

<!-- b.vue: the same with { server: false } and await -->

<!-- c.vue -->
<script setup lang="ts">
const title = ref('Before mount')
useHead({ title })
onMounted(() => { title.value = 'After mount' })
</script>

<!-- d.vue: no title at all -->
```

::: details Решение и разбор
| Страница | Сервер | Браузер |
| --- | --- | --- |
| a | `Kettle · Shop` | `Kettle · Shop` |
| b | `Loading · Shop` | `Kettle · Shop` |
| c | `Before mount · Shop` | `After mount · Shop` |
| d | `· Shop` | `· Shop` |

- **a.** `lazy` влияет только на клиентскую навигацию. На сервере `useFetch` всё равно дожидается запроса до рендера, а `renderSSRHead` вызывается после него.
- **b.** С `server: false` запроса на сервере нет, геттер вернул `'Loading'`. Бот увидит «Loading».
- **c.** `onMounted` на сервере не вызывается. В HTML — начальное значение.
- **d.** Строковый шаблон подставляет пустую строку. Лечится функцией `titleTemplate` в `useHead` из `app.vue`. Страница ошибки при этом всё равно возьмёт шаблон из `app.head`, потому что `app.vue` там не рендерится.

Всё проверено на сборке через `curl` и в Chromium.
:::

### 3. Найдите баг · средне

В dev в DOM-инспекторе виден правильный `description`. В проде исходный HTML страницы тоже правильный, но после загрузки в DOM стоит `Default description`, и SEO-аудит, который выполняет JS, ругается на одинаковые описания.

```ts
// nuxt.config.ts
app: { head: { meta: [{ name: 'description', content: 'Default description' }] } }
```

```vue
<!-- pages/about.vue -->
<script setup lang="ts">
useServerSeoMeta({ description: 'About our shop' })
</script>
```

::: details Решение и разбор
`useServerSeoMeta` в прод-сборке на клиенте — заглушка (в собранном чанке её тело `return !1`). Клиентский head-менеджер знает только запись из `app.head`. При гидрации он сводит теги к своему состоянию, и `description` с ключом `name="description"` получает значение по умолчанию. В dev заглушки нет: в Unhead v3 `useServerSeoMeta` — псевдоним `useSeoMeta`, он срабатывает и на клиенте, поэтому баг не воспроизводится. Проверено: в dev `About`-описание осталось после загрузки, в проде заменилось на `Default description`.

```ts
useSeoMeta({ description: 'About our shop' }) // same value on both sides
```

`useServer*` экономят байты клиентского бандла, только если клиент про тег вообще не знает. При конфликте ключа с `app.head` или с тегом из `app.vue` клиент перезаписывает серверное значение. Эти функции deprecated и в Nuxt 5 исчезнут из авто-импортов. Общий урок: dev и прод отличаются tree-shaking-ом, и SEO проверяют на прод-сборке.
:::

### 4. Найдите баг · средне

На странице товара блок «Отзывы» обёрнут в `<NuxtErrorBoundary>`, чтобы падение отзывов не ломало страницу. Когда сервис отзывов лежит, страница целиком отвечает `500`.

```vue
<NuxtErrorBoundary>
  <ProductReviews :id="id" />
  <template #error>Отзывы временно недоступны</template>
</NuxtErrorBoundary>
```

```ts
// ProductReviews.vue
const { data, error } = await useFetch(`/api/reviews/${props.id}`)
if (error.value) throw createError({ status: 503, statusText: 'Reviews unavailable' })
```

::: details Решение и разбор
`<NuxtErrorBoundary>` регистрирует `onErrorCaptured` только на клиенте. На сервере ошибка из `ProductReviews` проходит мимо границы до `nuxt-root.vue`, а тот на сервере превращает любую ошибку в `showError`. Итог — 500 (в задаче 503) и `error.vue` вместо товара. Проверено: виджет, который бросает в `setup` внутри границы, при SSR дал 500.

Варианты:

```vue
<!-- 1. The widget handles its own failure: no throw, the page stays 200 -->
<script setup lang="ts">
const { data, error } = await useFetch(`/api/reviews/${props.id}`)
</script>
<template>
  <p v-if="error">Отзывы временно недоступны</p>
  <ReviewList v-else :items="data" />
</template>
```

```vue
<!-- 2. Render on the client only: the boundary works, reviews are not in the HTML -->
<NuxtErrorBoundary>
  <ClientOnly><ProductReviews :id="id" /></ClientOnly>
  <template #error>Отзывы временно недоступны</template>
</NuxtErrorBoundary>
```

Первый вариант лучше для SEO: товар и разметка остаются в HTML, а отказ части страницы — это состояние данных, а не исключение. Второй вариант проверен (страница 200, в браузере показан слот `#error`), но отзывы пропадают из HTML. Правило: бросать из компонента стоит только тогда, когда без него страница не имеет смысла.
:::

### 5. Что увидят пользователь и бот · сложно

Production-сборка. Для каждого случая: какой статус у ответа сервера и что видно в браузере после загрузки?

1. `throw new Error('boom')` в `setup` страницы.
2. Компонент бросает `new Error('widget')` только на клиенте (`if (import.meta.client)`), обычный браузер.
3. То же, но User-Agent — Googlebot.
4. Переход по `<NuxtLink>` на страницу с `throw createError({ status: 400, statusText: 'Bad' })`.
5. Тот же адрес открыт напрямую.
6. API под `useFetch` упал с 500, страница ошибку не проверяет.

::: details Решение и разбор
| # | Сервер | Браузер |
| --- | --- | --- |
| 1 | 500, `error.vue`, `message: 'Server Error'` | страница ошибки 500 |
| 2 | 200, нормальная разметка | `error.vue` с 500 и текстом `widget` |
| 3 | 200, нормальная разметка | серверная разметка осталась, предупреждение в консоли |
| 4 | — (запрос не к странице) | URL сменился, на месте страницы пусто, ошибка в консоли |
| 5 | 400, `error.vue` | страница ошибки 400 |
| 6 | 200 | шаблон страницы без данных |

- **1.** Ошибка необработанная, поэтому текст скрыт от клиента и остаётся в хуке `error` Nitro и в логе.
- **2.** Ошибка случилась во время гидрации. До `app:suspense:resolve` у приложения стоит обработчик Nuxt по умолчанию, он записывает ошибку в `payload.error`, и страница заменяется на `error.vue`. Текст при этом не скрыт: ошибка возникла в браузере.
- **3.** С 4.5 Nuxt не показывает ошибки роутера и гидрации краулерам: бот индексирует серверный HTML.
- **4 и 5.** На сервере `fatal` не важен, на клиенте после гидрации страницу ошибки показывает только fatal-ошибка. Один URL ведёт себя по-разному в зависимости от того, как на него пришли.
- **6.** Soft 404/500: статус успеха при отсутствии данных.

Всё проверено (`curl` и Chromium). Вывод для код-ревью: ошибки, после которых страница бессмысленна, помечают `fatal` и бросают явно после проверки `error.value`. Ошибки частей страницы обрабатывают в компоненте. Исключения при гидрации ловит мониторинг через `vue:error`.
:::

## Источники

- [Nuxt 4: SEO and Meta](https://nuxt.com/docs/4.x/getting-started/seo-meta) — `app.head`, `useHead`, `useSeoMeta`, `titleTemplate`, компоненты `<Head>`
- [Nuxt 4: `useHead`](https://nuxt.com/docs/4.x/api/composables/use-head), [`useSeoMeta`](https://nuxt.com/docs/4.x/api/composables/use-seo-meta), [`useHeadSafe`](https://nuxt.com/docs/4.x/api/composables/use-head-safe)
- [Nuxt 4: Error Handling](https://nuxt.com/docs/4.x/getting-started/error-handling) — `createError`, `showError`, `clearError`, `useError`, `error.vue`
- [Nuxt 4: `<NuxtErrorBoundary>`](https://nuxt.com/docs/4.x/api/components/nuxt-error-boundary) и [`app/error.vue`](https://nuxt.com/docs/4.x/directory-structure/app/error)
- [Nuxt 4: Upgrade Guide](https://nuxt.com/docs/4.x/getting-started/upgrade) — Unhead v2, `parseErrorData`, `compatibilityVersion: 5`
- [Nuxt 4: Experimental Features](https://nuxt.com/docs/4.x/guide/going-further/experimental-features) — `inlineErrorRendering`, `ssrStreaming`
- [Релиз Nuxt v4.3.0](https://github.com/nuxt/nuxt/releases/tag/v4.3.0) — `status`/`statusText` вместо `statusCode`/`statusMessage`
- [Релиз Nuxt v4.5.0](https://github.com/nuxt/nuxt/releases/tag/v4.5.0) — Unhead v3, ошибки для краулеров, SSR streaming
- [Релиз Nuxt v4.6.0](https://github.com/nuxt/nuxt/releases/tag/v4.6.0) — `experimental.inlineErrorRendering`
- [Unhead v3: release notes](https://github.com/unjs/unhead/releases/tag/v3.0.0) — синхронный движок, строгие типы, удалённые API, `CanonicalPlugin`
- [Nuxt 3: SEO and Meta](https://nuxt.com/docs/3.x/getting-started/seo-meta) и [Error Handling](https://nuxt.com/docs/3.x/getting-started/error-handling)
- [nuxt/nuxt: `nuxt-root.vue`](https://github.com/nuxt/nuxt/blob/main/packages/nuxt/src/app/components/nuxt-root.vue) и [`nuxt-error-boundary.vue`](https://github.com/nuxt/nuxt/blob/main/packages/nuxt/src/app/components/nuxt-error-boundary.vue)
- [Open Graph protocol](https://ogp.me/) и [Google: Soft 404 errors](https://developers.google.com/search/docs/crawling-indexing/http-network-errors#soft-404-errors)
- [Nuxt SEO](https://nuxtseo.com/) — модули `@nuxtjs/robots`, `@nuxtjs/sitemap`, `@nuxtjs/seo`
