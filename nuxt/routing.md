---
title: 'Маршрутизация: файловые, динамические и вложенные маршруты, layouts'
level: ядро
---

# Маршрутизация: файловые, динамические и вложенные маршруты, layouts

> **Коротко.** Nuxt при сборке превращает файлы `app/pages/` в обычные записи Vue Router: каждая страница — ленивый чанк, а метаданные из `definePageMeta` вырезаются в отдельный модуль и попадают в общий бандл. `<NuxtPage>` — это `RouterView`, обёрнутый в `Suspense`, `Transition` и `KeepAlive`, и с ключом по пути: в отличие от голого Vue Router, смена параметра (`/users/1 → /users/2`) пересоздаёт страницу. `definePageMeta` — макрос компилятора, поэтому он вычисляется один раз при загрузке модуля и не видит состояние компонента. Layouts — асинхронные компоненты-обёртки, которые `<NuxtLayout>` выбирает по `meta.layout`.

**Связанные темы:** [Vue Router](../vue/vue-router.md), [Структура проекта и auto-imports](./project-structure.md), [Middleware и плагины](./middleware-and-plugins.md), [`KeepAlive`, `Teleport`, `Suspense`, `Transition` и асинхронные компоненты](../vue/built-in-components.md), [SSR и гидрация](../vue/ssr-and-hydration.md), [Оптимизация загрузки](../performance/loading.md), [TypeScript во Vue](../vue/typescript.md), [`watch` и `watchEffect`](../vue/watchers.md), [Структура большого проекта и Feature-Sliced Design](../architecture/large-project-structure.md), [Разбор: лента новостей](../architecture/case-news-feed.md), [Работа с данными: `$fetch`, `useFetch`, `useAsyncData`](./data-fetching.md), [SEO и обработка ошибок](./seo-and-errors.md)

## Теория

Все фрагменты проверены на Nuxt 4.6.4 (последний релиз на 2026-11-21) с Nitro 2.13.6, Vue 3.5.45 и Vue Router 5.5.1 в Node 26.13.1: `nuxi dev`, `nuxi build` + `node .output/server/index.mjs`, клиентская навигация — в браузере через Playwright, типы — `nuxi typecheck` на TypeScript 6.0. Устройство описано по `node_modules/nuxt/dist` (`pages/runtime/`, `app/components/`, `app/composables/router.js`). Сам Vue Router (matcher, guards, `scrollBehavior`) разобран в теме [«Vue Router»](../vue/vue-router.md); здесь — то, что Nuxt делает поверх него. Route middleware — в теме [«Middleware и плагины»](./middleware-and-plugins.md).

### Что Nuxt генерирует из `app/pages/`

При старте модуль страниц сканирует `app/pages/` во всех слоях, строит дерево файлов (библиотека `unrouting`) и превращает его в массив записей Vue Router. Массив лежит не на диске, а в виртуальной ФС под `#build/routes`. Вот что получилось для `users.vue`, `users/index.vue`, `users/[id].vue` (пути сокращены):

```js
import { default as _91id_93...Meta } from "/app/pages/users/[id].vue?macro=true"
export default [
  {
    path: "/users",
    component: () => import("/app/pages/users.vue"),
    children: [
      { name: "users-id", path: ":id()", meta: _91id_93...Meta || {},
        component: () => import("/app/pages/users/[id].vue") },
      { name: "users", path: "", component: () => import("/app/pages/users/index.vue") },
    ],
  },
]
```

Из этого кода видно три вещи:

- **Каждая страница — ленивый маршрут** `() => import()`, то есть отдельный чанк. Это то же самое, что ручной ленивый маршрут во Vue Router.
- **Метаданные импортируются статически.** `?macro=true` — это виртуальный модуль, в котором остался только аргумент `definePageMeta`. Он попадает в бандл вместе со списком маршрутов, а не в чанк страницы (подробнее ниже).
- **Имя маршрута** складывается из пути через `-`: `users/[id].vue` → `users-id`, `index.vue` → имя каталога. Родитель `users.vue` имени не получил: его забрал дочерний `index.vue`.

Увидеть итоговый список можно в Nuxt DevTools (вкладка Pages) или хуком сборки `pages:resolved`, который получает массив страниц уже после сканирования метаданных. Без каталога `app/pages/` Nuxt не подключает `vue-router` вовсе — приложение из одного `app.vue` его не грузит.

### Синтаксис имён файлов

| Файл | Путь Vue Router | `params` |
| --- | --- | --- |
| `index.vue` | `/` | — |
| `users/[id].vue` | `/users/:id()` | `id: '42'` — всегда строка |
| `posts/[[slug]].vue` | `/posts/:slug?` | совпадает с `/posts` и `/posts/x` |
| `docs/[...slug].vue` | `/docs/:slug(.*)*` | `slug: ['a', 'b']` — массив сегментов |
| `p/[id]-[slug].vue` | `/p/:id()-:slug()` | `/p/12-hello` → `id: '12'`, `slug: 'hello'` |
| `(marketing)/about.vue` | `/about` | группа не входит в URL, но есть в `route.meta.groups` (с 4.3) |
| `users.vue` + `users/` | родитель с `children` | см. ниже |

Порядок файлов значения не имеет: записи ранжирует matcher Vue Router, поэтому `/docs/a/b` уйдёт в `docs/[...slug].vue`, а не в корневой `[...slug].vue`. Ограничить параметр регулярным выражением именем файла нельзя. Для этого есть два способа с разной семантикой (задача 2):

- `definePageMeta({ path: '/items/:id(\\d+)' })` — маршрут просто не совпадает, и URL уходит дальше, например в catch-all;
- `definePageMeta({ validate })` — маршрут совпал, но навигация заканчивается ошибкой 404.

### Вложенные маршруты и `<NuxtPage>`

Файл `users.vue` рядом с каталогом `users/` делает запись-родителя, а файлы каталога — её `children`. Дочерняя страница рендерится там, где в родителе стоит `<NuxtPage />`, — как вложенный `RouterView` со своей глубиной.

`<NuxtPage>` — это `RouterView`, слот которого Nuxt оборачивает так:

```text
Transition (pageTransition) → KeepAlive (keepalive) → Suspense → RouteProvider(key) → page
```

- **`Suspense`** разрешает `await` на верхнем уровне `<script setup>`: старая страница остаётся на экране, пока новая не разрешится. Хуки `page:start` / `page:finish` и индикатор загрузки висят на событиях этого `Suspense`.
- **`RouteProvider`** передаёт странице её маршрут и получает **ключ**.

### Ключ страницы: главное отличие от `RouterView`

Голый `RouterView` переиспользует экземпляр компонента при смене `params`: запись та же, Vue патчит на месте ([механика](../vue/vue-router.md#почему-компонент-не-пересоздается-при-смене-params)). В Nuxt по умолчанию иначе. Ключ строится в `generateRouteKey` (`pages/runtime/utils.js`): в путь совпавшей записи подставляются текущие параметры. Для `/users/:id()` ключ — `/users/1`, затем `/users/2`. Ключ изменился — `RouteProvider` пересоздан, страница монтируется заново.

Проверено в браузере:

- `/users/1 → /users/2` — новый `setup`, локальный `ref` сброшен;
- `/users/2 → /users/2?tab=x` — ключ тот же (в пути записи нет `query`), страница переиспользована;
- родитель `users.vue` не перемонтируется: путь его записи `/users` без параметров, ключ не меняется.

Переопределить можно `definePageMeta({ key: route => route.fullPath })` (пересоздавать и при смене `query`), функцией, которая возвращает постоянное значение (переиспользовать, как во Vue Router), или пропом `<NuxtPage :page-key="…">` сразу для всех страниц уровня.

### `useRoute()` в Nuxt — маршрут отрендеренной страницы

Auto-import `useRoute` — это не функция из `vue-router`, а обёртка Nuxt. Внутри страницы она возвращает маршрут из `RouteProvider`, а вне страницы — `nuxtApp._route`, который синхронизируется только тогда, когда `Suspense` новой страницы разрешился. Проверено со страницей, у которой `await` длится 1,5 с: сразу после клика URL уже `/slow`, `useRouter().currentRoute.value.path === '/slow'`, а `useRoute().path` в layout всё ещё `/`, и на экране старая страница. Так шаблон старой страницы не получает чужих `params` во время перехода. Если нужна цель навигации — это `router.currentRoute`, а в middleware — аргумент `to`.

### `definePageMeta` — макрос, а не вызов

Как и `defineProps`, `definePageMeta` обрабатывается при сборке:

1. Трансформ страниц создаёт для каждого файла модуль `page.vue?macro=true`. В нём только объект-аргумент и объявления, на которые он ссылается: импорты и локальные переменные копируются туда.
2. Этот модуль импортируется **статически** в `#build/routes`. Проверено в `.output/public/_nuxt`: функция `validate` из `users/[id].vue` лежит во входном чанке рядом со списком маршрутов, а в чанке страницы вызова `definePageMeta` нет.
3. Сериализуемые поля `name`, `path`, `alias`, `redirect`, `props`, `middleware` извлекаются при сборке прямо в запись маршрута (`experimental.scanPageMeta`, включено по умолчанию). Поэтому они работают для генерации маршрутов, хотя страница ещё не загружена.

Следствия:

- **Метаданные вычисляются один раз**, при загрузке модуля, вне экземпляра компонента. `const title = ref('A'); definePageMeta({ title: title.value })` скопирует `ref` в модуль-макрос, а значение не будет реактивным и не связано с компонентом.
- **Нет контекста Nuxt.** `useRoute()` внутри `definePageMeta` бросает исключение при загрузке модуля. Nuxt 4.6.4 оборачивает такой макрос в `try/catch` и подменяет метаданные middleware, которое отменяет навигацию: ответ `500 NUXT_E2013`.
- **Тяжёлые импорты в метаданных** попадают во входной чанк, а не в чанк страницы.

Документация формулирует правило так: в метаданных можно ссылаться на импорты и локальные **чистые** функции, но не на реактивные данные и не на код с побочными эффектами.

**`validate`** — функция `(route) => boolean | Partial<NuxtError>`. Nuxt выполняет её во встроенном глобальном middleware (`pages/runtime/validate.js`). Пропускает только результат `=== true`. `false`, `undefined` или объект дают `createError` со статусом 404 (или из объекта), на клиенте ошибка фатальная — показывается страница ошибки.

**`alias`** отдаёт ту же запись по другому URL без редиректа, **`name`** заменяет сгенерированное имя.

> [!NOTE]
> В Nuxt 3 было иначе: `name` и `path` из `definePageMeta` были и на маршруте, и в `route.meta` (`route.meta.name`). В Nuxt 4 они только на объекте маршрута (`route.name`): это следствие `scanPageMeta` по умолчанию. Метаданные теперь сканируются **после** хука `pages:extend`, поэтому переопределять их нужно в `pages:resolved`. Каталог страниц в Nuxt 3 — `pages/` в корне проекта ([3.x](https://nuxt.com/docs/3.x/guide/directory-structure/pages)).

### Навигация: `<NuxtLink>` и `navigateTo`

**`<NuxtLink>`** для внутреннего пути рендерит `RouterLink`, а для абсолютного URL — обычный `<a>` и сам добавляет `rel="noopener noreferrer"` (проверено в SSR-выводе). Главное отличие от `RouterLink` — prefetch: чанки и payload страницы загружаются, когда ссылка попала во viewport. Механика и настройки (`prefetchOn`, `:prefetch="false"`) — в теме [«Оптимизация загрузки»](../performance/loading.md#vue-и-nuxt-где-это-видно).

**`navigateTo(to, options)`** ведёт себя по-разному в зависимости от среды:

| Где вызвана | Что делает |
| --- | --- |
| клиент, обычный код | `router.push` (или `replace` с `{ replace: true }`), возвращает промис |
| клиент, route middleware | возвращает location, который middleware отдаёт роутеру как редирект |
| сервер, SSR | вместо рендера кладёт ответ `302` (или `redirectCode`) с `Location` и HTML с `<meta http-equiv="refresh">` |
| внешний URL | без `{ external: true }` — ошибка `NUXT_E2001` (на сервере ответ 500), с ним — `location.href` или 30x |

Поэтому `navigateTo` в `setup` пишут с `await` или `return`: на сервере это и есть способ вернуть HTTP-редирект (проверено: `await navigateTo('/about', { redirectCode: 301 })` → `301`, `location: /about`). URL с протоколом `javascript:` `navigateTo` отклоняет даже с `external: true` (`NUXT_E2002`).

### Layouts

Каждый файл `app/layouts/*.vue` становится записью в `#build/layouts`, обёрнутой в `defineAsyncComponent(() => import(...))`. Значит, layout — отдельный чанк, который грузится при первом использовании. `<NuxtLayout>` в `app.vue` выбирает layout по цепочке из `resolveLayoutName` (`app/composables/layout.js`):

```text
prop name → route.meta.layout (definePageMeta) → routeRules appLayout (4.3+) → 'default'
```

- `definePageMeta({ layout: 'admin' })` — layout для страницы; `layout: false` — без layout. Имя проверяется типами: опечатка `'admn'` даёт `TS2820 … Did you mean '"admin"'?`.
- Страница рендерится в `<slot />` layout. Корень layout — один элемент и не `<slot />`, иначе не работают переходы.
- **`setPageLayout(name, props?)`** меняет layout во время работы. На клиенте — в любой момент. На сервере вызов из `setup` страницы опаздывает: `<NuxtLayout>` уже отрендерил layout. В Nuxt 4.6.4 он остаётся прежним (проверено), в dev выводится `NUXT_E2007`. На сервере layout меняют до рендера — в route middleware или плагине (задача 4).
- С 4.4 layout принимает props: `definePageMeta({ layout: { name: 'panel', props: { sidebar: true } } })`. С 4.5 `useLayout()` возвращает текущее имя.

### Переходы страниц

`app.pageTransition` и `app.layoutTransition` в `nuxt.config` или `pageTransition` в `definePageMeta` передаются в тот самый `Transition` вокруг страницы. Отсюда требование документации: у страницы один корневой элемент (HTML-комментарий тоже считается). `keepalive: true` в `definePageMeta` включает `KeepAlive` для страницы. Как работают `Transition` и `KeepAlive` — в теме [«Встроенные компоненты»](../vue/built-in-components.md).

### Когда файлов не хватает

- **`app/router.options.ts`** — опции `createRouter`: `scrollBehavior` (пример — в [«Разборе: лента новостей»](../architecture/case-news-feed.md)), `hashMode`, `sensitive`, функция `routes(_routes)` для полной замены списка.
- **Хук `pages:extend`** в `nuxt.config` или модуле — добавить, удалить или переименовать записи до генерации.
- **`dir.pages`** — другой каталог маршрутов. Так делают при FSD, где `pages` — слой ([«Структура большого проекта»](../architecture/large-project-structure.md)).

### Типизированные маршруты

`experimental.typedPages` (в 4.x выключено, статус experimental) подключает генератор типов из `vue-router/vite`: `nuxi prepare` пишет `.nuxt/types/typed-router.d.ts` с картой `RouteNamedMap`. Проверено `nuxi typecheck`:

- без флага `navigateTo({ name: 'user-id' })` с опечаткой проходит, а `useRoute('users-id').params.id` — тип `string | string[] | undefined`;
- с флагом опечатка — ошибка `TS2345`, `useRoute('users-id').params.id` — `string`. `router.push({ name: 'users-id' })` без `params` ошибкой не считается — как и в самом Vue Router ([почему](../vue/vue-router.md#типизированные-маршруты)).

> [!WARNING]
> Nuxt 5 (не выпущен, сверено 2026-11-21 по upgrade guide и `compatibilityVersion: 5` на 4.6.4) ломает маршрутизацию в двух местах. **Регистрозависимые пути**: `router.options.sensitive` по умолчанию `true`, и `/About` больше не совпадает с `pages/about.vue`. Проверено: на 4.6.4 `/About` отдаёт страницу about, под флагом уходит в catch-all. Ссылки и закладки со «случайным» регистром начнут вести на 404; включить заранее — `router: { options: { sensitive: true } }`. **Typed pages** включены: код, который читал `route.params.id` без имени маршрута (например, в `validate`), перестаёт типизироваться (`TS2339`). Кроме того, имя компонента страницы станет равным имени маршрута (`normalizePageNames`), что важно для `KeepAlive include`.

## Примеры

### Детальная страница: валидация, ключ, layout

```vue
<!-- app/pages/users/[id].vue -->
<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  // runs as a global route middleware; only `true` lets the navigation through
  validate: (route) => /^\d+$/.test(String(route.params.id)),
  // keep one instance across /users/1 -> /users/2 and react to the param instead
  key: (route) => String(route.name),
})

const route = useRoute()
const { data: user } = await useFetch(() => `/api/users/${route.params.id}`)
</script>

<template>
  <article>{{ user?.name }}</article>
</template>
```

С постоянным `key` страница переиспользуется, а `useFetch` с функцией-URL сам перезапрашивает при смене `id`. Без `key` Nuxt пересоздал бы страницу, и запрос выполнился бы в новом `setup`. Оба варианта рабочие: первый сохраняет локальное состояние и DOM, второй проще.

### Страница 404 с правильным статусом

```vue
<!-- app/pages/[...slug].vue -->
<script setup lang="ts">
const route = useRoute()
throw createError({ status: 404, statusText: `Not found: ${route.path}` })
</script>
```

Ответ — `404` и `app/error.vue` (или встроенная страница ошибки). Обработку ошибок подробно разбирает тема [«SEO и обработка ошибок»](./seo-and-errors.md).

### Маршрут без файла

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  hooks: {
    'pages:extend'(pages) {
      // same page component under a second name and path
      pages.push({ name: 'profile', path: '/me', file: '~/pages/users/[id].vue' })
      // drop a route generated from a file
      const i = pages.findIndex((p) => p.name === 'legacy')
      if (i !== -1) pages.splice(i, 1)
    },
  },
})
```

## Вопросы с интервью

::: details Как Nuxt превращает файлы из pages в маршруты и где посмотреть результат
При сборке модуль страниц сканирует `app/pages/` во всех слоях, строит дерево (`unrouting`) и генерирует массив записей Vue Router в виртуальный модуль `#build/routes`. `[id]` становится `:id()`, `[[id]]` — `:id?`, `[...slug]` — `:slug(.*)*`, `(group)` выпадает из URL, файл рядом с одноимённым каталогом — родитель с `children`. Каждая страница — `() => import()`, то есть отдельный чанк. Метаданные из `definePageMeta` импортируются статически через `?macro=true`, а сериализуемые поля (`name`, `path`, `alias`, `redirect`) вписываются в запись при сборке. Посмотреть можно в Nuxt DevTools или в хуке `pages:resolved`. Дальше работает обычный Vue Router: matcher, guards, history.
:::

::: details Почему в Nuxt страница пересоздаётся при смене параметра, а во Vue Router нет
`RouterView` сравнивает записи маршрутов: при `/users/1 → /users/2` запись та же, и Vue патчит компонент на месте, `setup` не вызывается. `<NuxtPage>` кладёт страницу в `RouteProvider` с ключом. По умолчанию ключ — путь записи с подставленными параметрами (`/users/1`, `/users/2`), поэтому при смене параметра страница монтируется заново. `query` в ключ не входит, родительская страница не перемонтируется. Переопределить — `definePageMeta({ key })` или проп `pageKey`. Вопрос важен, когда переносят код с чистого Vue: `watch` на параметр в Nuxt часто не нужен, а локальное состояние сбрасывается.
:::

::: details Почему definePageMeta не видит переменные компонента и не реактивен
Это макрос компилятора. Его аргумент выносится в отдельный модуль `page.vue?macro=true`, который статически импортирует список маршрутов: метаданные нужны роутеру до загрузки страницы (layout, middleware, validate, редиректы). Модуль выполняется один раз при загрузке, вне экземпляра и вне контекста Nuxt. Локальные объявления копируются в него, но это копия: `ref` из `setup` там — другой объект, и изменения не видны. Composable с контекстом (`useRoute()`) бросает исключение, и Nuxt 4.6.4 отвечает 500 (`NUXT_E2013`). Можно ссылаться на импорты и чистые функции. Побочный эффект: всё, что импортировано в метаданных, попадает во входной чанк.
:::

::: details Чем navigateTo на сервере отличается от navigateTo на клиенте
На клиенте это `router.push`/`replace`, в middleware — возврат location роутеру. На сервере во время SSR `navigateTo` не навигирует, а формирует HTTP-ответ: `302` (или `redirectCode`), заголовок `Location` и HTML с `meta refresh` как запасной вариант. Поэтому его нужно `await`-ить или возвращать, иначе код страницы продолжит выполняться. Внешний URL требует `{ external: true }`, без него — ошибка `NUXT_E2001`, на сервере 500. Протокол `javascript:` запрещён.
:::

::: details Как Nuxt выбирает layout и как поменять его динамически
`<NuxtLayout>` берёт имя по цепочке: проп `name`, затем `route.meta.layout` из `definePageMeta`, затем `appLayout` из route rules, затем `default`. `false` — без layout. Сами layouts — асинхронные компоненты, каждый в своём чанке. Динамически — `setPageLayout`. На клиенте его можно вызвать где угодно. На сервере его вызывают до рендера layout: в route middleware или плагине. Вызов в `setup` страницы на сервере опаздывает, layout остаётся прежним, в dev — предупреждение `NUXT_E2007`. Если бы layout поменялся только на клиенте, был бы hydration mismatch.
:::

::: details Чем useRoute в Nuxt отличается от router.currentRoute
`router.currentRoute` — цель последней навигации, он меняется сразу после её подтверждения. `useRoute()` из Nuxt внутри страницы возвращает маршрут её `RouteProvider`, а вне страниц — `nuxtApp._route`, который синхронизируется, когда `Suspense` новой страницы разрешился. Пока новая страница ждёт `await` в `setup`, на экране старая, и `useRoute()` показывает старый маршрут, а `currentRoute` — новый. Это защищает уходящую страницу от чужих `params`. В middleware нужно использовать `to` и `from`: текущего маршрута там нет.
:::

::: details Что поменяется в маршрутизации при переходе на Nuxt 5
Проверяется флагом `future.compatibilityVersion: 5` на Nuxt 4. Пути становятся регистрозависимыми: `/About` больше не совпадает с `about.vue` и уходит в catch-all или 404. Нужно найти ссылки со смешанным регистром или заранее включить `router.options.sensitive`. Включаются typed pages: имена маршрутов проверяются, `useRoute('name').params` типизирован, а код, который читает `params` без имени, перестаёт компилироваться. Сериализуемые поля `definePageMeta` извлекаются при сборке, имя компонента страницы совпадает с именем маршрута. Плюс `await navigateTo()` на верхнем уровне `<script setup>` прерывает `setup` (`navigateToEarlyReturn`).
:::

## Задачи

### 1. Что выведет · средне

Страница `app/pages/users/[id].vue` вложена в `app/pages/users.vue` (там `<NuxtPage />` и `onMounted(() => console.log('parent mounted'))`). Пользователь открывает `/users/1`, дважды жмёт `inc`, затем `next`, затем один раз `inc` и `query`. Что будет в консоли и в `<p>` после каждого перехода?

```vue
<script setup lang="ts">
const route = useRoute()
const n = ref(0)
console.log('setup', route.params.id)
</script>

<template>
  <p>user {{ route.params.id }} n={{ n }}</p>
  <button @click="n++">inc</button>
  <NuxtLink :to="`/users/${Number(route.params.id) + 1}`">next</NuxtLink>
  <NuxtLink :to="{ query: { tab: 'x' } }">query</NuxtLink>
</template>
```

::: details Решение и разбор
```text
setup 1            // client hydration (the server logged "setup 1" too)
parent mounted
// <p>user 1 n=2</p>
setup 2            // next: /users/1 -> /users/2
// <p>user 2 n=0</p>
// query: /users/2?tab=x — no log
// <p>user 2 n=1</p>
```

Ключ `<NuxtPage>` — путь записи `/users/:id()` с подставленным `id`: `/users/1` и `/users/2` различаются, страница пересоздаётся, `n` сбрасывается. `query` в ключ не входит, поэтому третий переход патчит ту же страницу. Родитель `users.vue` не перемонтируется: путь его записи `/users` не зависит от параметров. В чистом Vue Router `setup 2` не было бы, и `n` остался бы `2` (проверено в браузере на Nuxt 4.6.4).

Чтобы сохранить состояние, задают `definePageMeta({ key: route => String(route.name) })` и реагируют на `route.params.id` через `watch` или реактивный URL в `useFetch`.
:::

### 2. Найдите баг · легко

Нужно открывать товар только по числовому `id`, а всё остальное — отдавать странице `[...slug].vue` с каталогом. Сейчас `/items/42` работает, но `/items/abc` вместо каталога показывает 404, а после рефакторинга 404 стал и на `/items/42`.

```ts
// app/pages/items/[id].vue
definePageMeta({
  validate: (route) => {
    /^\d+$/.test(String(route.params.id)) // after refactoring
  },
})
```

::: details Решение и разбор
Две ошибки.

1. После рефакторинга функция ничего не возвращает. Встроенный middleware пропускает только `result === true`, `undefined` превращается в `createError({ status: 404 })` — 404 на любом URL. Нужен `return` или стрелка без фигурных скобок.
2. `validate` не подходит для требования «отдать дальше». Он срабатывает, когда маршрут **уже совпал**, и заканчивает навигацию ошибкой. Чтобы matcher не выбрал запись и перешёл к следующей, ограничение должно быть в пути:

```ts
definePageMeta({ path: '/items/:id(\\d+)' })
```

Проверено: с `path` `/items/abc` отдаёт catch-all, с `validate` — 404. Двойной обратный слеш обязателен: `'(\d+)'` в JS-строке превращается в `(d+)` (см. задачу 2 в теме [«Vue Router»](../vue/vue-router.md)).
:::

### 3. Найдите баг · средне

Страница каталога отдаёт поисковику 200 на любой несуществующий URL, и в Search Console копятся soft 404. Почему и как исправить?

```vue
<!-- app/pages/[...slug].vue -->
<template>
  <h1>Page not found</h1>
</template>
```

::: details Решение и разбор
Catch-all — обычный маршрут. Он совпал, страница отрендерилась без ошибок, значит статус 200 (проверено: `/nope` → `200`). Текст «not found» статус не меняет. Исправление — бросить ошибку, тогда Nuxt рендерит страницу ошибки со статусом:

```vue
<script setup lang="ts">
const route = useRoute()
throw createError({ status: 404, statusText: `Not found: ${route.path}` })
</script>
```

Проверено: `404 Page Not Found`. Если catch-all реально показывает контент (CMS по слагу), ошибку бросают только когда данных нет: после `await useFetch(...)` проверить `data.value` и бросить `createError`. Для отдельных маршрутов то же даёт `validate` с результатом `false`.
:::

### 4. Найдите баг · средне

Пользователям с ролью администратора нужен layout `admin`. При клиентском переходе на `/dashboard` всё работает, а при прямом заходе по ссылке страница отрисована в `default`.

```vue
<!-- app/pages/dashboard.vue -->
<script setup lang="ts">
const user = useUser() // the user is already known on the server
if (user.value?.isAdmin) setPageLayout('admin')
</script>
```

::: details Решение и разбор
При SSR `<NuxtLayout>` в `app.vue` рендерится раньше страницы. Когда `setup` страницы вызывает `setPageLayout`, layout уже выбран, и он остаётся `default` (проверено на 4.6.4; в dev Nuxt пишет `NUXT_E2007`: «called to change the layout on the server within a component»). На клиенте вызов меняет `route.meta.layout` реактивно, поэтому при клиентском переходе всё выглядит верно.

Layout нужно выбрать до рендера — в route middleware страницы (она выполняется на сервере до рендера и снова на клиенте):

```ts
// app/middleware/admin-layout.ts
export default defineNuxtRouteMiddleware(() => {
  if (useUser().value?.isAdmin) setPageLayout('admin')
})
```

```ts
// app/pages/dashboard.vue
definePageMeta({ middleware: 'admin-layout' })
```

Если layout зависит только от пути, а не от пользователя, проще статично: `layout` в `definePageMeta` или `appLayout` в `routeRules`.
:::

### 5. Найдите баг · легко

После входа пользователя нужно отправить на внешний SSO-портал. Прямой заход на `/login-redirect` отвечает 500.

```vue
<!-- app/pages/login-redirect.vue -->
<script setup lang="ts">
navigateTo('https://sso.example.com/start')
</script>
```

::: details Решение и разбор
Две ошибки. Абсолютный URL без `{ external: true }` — ошибка `NUXT_E2001`: Nuxt требует явно подтвердить уход с сайта. На сервере она превращается в ответ 500 (проверено). Вторая: результат не ожидается. На сервере `navigateTo` только записывает ответ-редирект, и без `await` страница продолжит `setup` и рендер.

```ts
await navigateTo('https://sso.example.com/start', { external: true, redirectCode: 302 })
```

На сервере это `302` с `Location`, на клиенте — `location.href`. Для открытия в новой вкладке есть `open: { target: '_blank' }`.
:::

## Источники

- [Nuxt 4: `app/pages`](https://nuxt.com/docs/4.x/directory-structure/app/pages) — синтаксис файлов, группы, `key`, единый корень, `definePageMeta` как макрос
- [Nuxt 4: Routing](https://nuxt.com/docs/4.x/getting-started/routing) и [Custom Routing](https://nuxt.com/docs/4.x/guide/recipes/custom-routing) — `router.options.ts`, `pages:extend`
- [Nuxt 4: `definePageMeta`](https://nuxt.com/docs/4.x/api/utils/define-page-meta) — `validate`, `alias`, `name`, `key`, `layout`
- [Nuxt 4: `<NuxtPage>`](https://nuxt.com/docs/4.x/api/components/nuxt-page), [`<NuxtLink>`](https://nuxt.com/docs/4.x/api/components/nuxt-link), [`<NuxtLayout>`](https://nuxt.com/docs/4.x/api/components/nuxt-layout)
- [Nuxt 4: `navigateTo`](https://nuxt.com/docs/4.x/api/utils/navigate-to), [`setPageLayout`](https://nuxt.com/docs/4.x/api/utils/set-page-layout), [`useRoute`](https://nuxt.com/docs/4.x/api/composables/use-route)
- [Nuxt 4: `app/layouts`](https://nuxt.com/docs/4.x/directory-structure/app/layouts) — `appLayout` в route rules (4.3), props (4.4)
- [Nuxt 4: Transitions](https://nuxt.com/docs/4.x/getting-started/transitions)
- [Nuxt 4: Experimental features](https://nuxt.com/docs/4.x/guide/going-further/experimental-features) — `typedPages`, `scanPageMeta`, `normalizePageNames`
- [Nuxt 4: Upgrade Guide](https://nuxt.com/docs/4.x/getting-started/upgrade) — дедупликация метаданных маршрута, `pages:resolved`, `compatibilityVersion: 5`
- [Nuxt 3: `pages`](https://nuxt.com/docs/3.x/guide/directory-structure/pages)
- [nuxt/nuxt v4.6.4: `pages/runtime/page.ts`](https://github.com/nuxt/nuxt/blob/v4.6.4/packages/nuxt/src/pages/runtime/page.ts) и [`pages/runtime/utils.ts`](https://github.com/nuxt/nuxt/blob/v4.6.4/packages/nuxt/src/pages/runtime/utils.ts) — обёртки `<NuxtPage>`, `generateRouteKey`
- [nuxt/nuxt v4.6.4: `pages/utils.ts`](https://github.com/nuxt/nuxt/blob/v4.6.4/packages/nuxt/src/pages/utils.ts) — генерация маршрутов, извлечение метаданных
- [nuxt/nuxt v4.6.4: `app/composables/router.ts`](https://github.com/nuxt/nuxt/blob/v4.6.4/packages/nuxt/src/app/composables/router.ts) — `navigateTo`, `setPageLayout`, `useRoute`
- [Vue Router: Typed Routes](https://router.vuejs.org/guide/advanced/typed-routes.html)
