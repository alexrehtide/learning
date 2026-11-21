---
title: Middleware и плагины
level: ядро
---

# Middleware и плагины

> **Коротко.** Route middleware в Nuxt — не отдельный механизм, а один `router.beforeEach`, который Nuxt регистрирует в своём плагине роутера: внутри он по очереди вызывает глобальные middleware, затем middleware совпавших записей маршрута. Поэтому для первой страницы middleware выполняется дважды — при SSR и снова при начальной навигации на клиенте. Плагины — функции, которые Nuxt вызывает при создании приложения: на сервере на **каждый запрос**, на клиенте один раз. Composables работают в них только с контекстом Nuxt, а на сервере он хранится в общей переменной процесса и теряется после `await`, если код не преобразован сборкой.

**Связанные темы:** [Маршрутизация](./routing.md), [Структура проекта и auto-imports](./project-structure.md), [Vue Router](../vue/vue-router.md), [Плагины и обработка ошибок](../vue/plugins-and-error-handling.md), [Composables](../vue/composables.md), [SSR и гидрация](../vue/ssr-and-hydration.md), [Аутентификация на фронтенде](../security/authentication.md), [CSRF, clickjacking и supply chain](../security/csrf-and-clickjacking.md), [Pinia: плагины, SSR и тестирование](../state-management/pinia-advanced.md), [Принципы и паттерны проектирования](../architecture/gof-patterns.md), [Работа с данными: `$fetch`, `useFetch`, `useAsyncData`](./data-fetching.md)

## Теория

Все фрагменты проверены на Nuxt 4.6.4 с Nitro 2.13.6 и Vue 3.5.45 в Node 26.13.1: `nuxi build` + `node .output/server/index.mjs` (параллельные запросы — `curl`), клиентская навигация — в браузере через Playwright, предупреждения — в `nuxi dev`, типы — `nuxi typecheck` на TypeScript 6.0. Устройство описано по `node_modules/nuxt/dist`: `pages/runtime/plugins/router.js` (запуск middleware), `app/nuxt.js` (плагины и контекст), `app/composables/router.js`, а также по `unctx` 3.0.1. Vue Router и порядок его guards разобраны в теме [«Vue Router»](../vue/vue-router.md#навигационные-guards), Vue-плагины и `app.config.errorHandler` — в теме [«Плагины и обработка ошибок»](../vue/plugins-and-error-handling.md).

### Три вида route middleware

| Вид | Где | Когда выполняется |
| --- | --- | --- |
| глобальный | `app/middleware/*.global.ts` | при каждой навигации |
| именованный | `app/middleware/auth.ts` или `auth/index.ts` | только если страница указала `definePageMeta({ middleware: 'auth' })` |
| анонимный (inline) | функция в `definePageMeta({ middleware: [...] })` | только для этой страницы |

Есть и четвёртый путь — `addRouteMiddleware(name, fn, { global })` во время работы, обычно из плагина. Для набора путей — `routeRules: { '/admin/**': { appMiddleware: { auth: true } } }`. Middleware — функция `(to, from) => result`, обёрнутая в `defineNuxtRouteMiddleware`. В исходниках эта обёртка возвращает аргумент без изменений: она нужна для типов и для трансформа контекста (ниже). Третьего аргумента `next` нет, решение передаётся возвращаемым значением.

### Как Nuxt запускает middleware

Плагин `nuxt:router` создаёт роутер и регистрирует **один** `router.beforeEach`. Внутри — функция `runMiddleware`:

1. Собирает `Set`: глобальные из файлов, глобальные из `addRouteMiddleware`, затем `meta.middleware` каждой записи в `to.matched` — от родителя к дочерней, затем `appMiddleware` из route rules.
2. Вызывает их по очереди, каждую через `nuxtApp.runWithContext`. Именованные загружаются лениво: в прод-сборке это `() => import(...)`, отдельный чанк. Глобальные импортируются статически во входной чанк.
3. `undefined` или `true` — следующая middleware. Любое другое значение прерывает цепочку и уходит в Vue Router как результат guard.

Из этого следуют правила порядка:

- **Глобальные** выполняются по имени файла, поэтому порядок задают префиксом: `01.setup.global.ts`, `02.auth.global.ts`. Сортировка строковая: `10.x` окажется раньше `2.x`.
- **Страничные** — в порядке массива, родитель раньше дочерней страницы.
- **Повторы схлопываются.** Если `'admin'` указан и в `parent.vue`, и в `parent/child.vue`, он выполнится один раз — на месте первого упоминания (проверено, задача 1).
- **Редирект запускает всё заново.** Возврат location — новая навигация, и все глобальные middleware выполняются ещё раз уже для неё. Middleware, которая перенаправляет на `/login`, не должна перенаправлять сам `/login`.
- Опечатка в имени ловится типами (`TS2322`: `'atuh'` не входит в `MiddlewareKey`), а в рантайме даёт `NUXT_E2004` и ответ 500.

| Результат | Клиентская навигация | SSR |
| --- | --- | --- |
| ничего, `true` | дальше | дальше |
| `return navigateTo('/login')` | редирект | `302` с `Location` |
| `return abortNavigation()` | переход отменён, пользователь остаётся на старой странице | `404 Page Not Found` |
| `return abortNavigation({ status: 403 })` | переход отменён, страницы ошибки нет | страница ошибки, статус `403` |
| `throw createError({ status: 403, fatal: true })` | страница ошибки | страница ошибки, `403` |

Всё в таблице проверено. На клиенте нефатальная ошибка только отменяет навигацию, а на сервере «остаться на предыдущей странице» некуда, поэтому Nuxt показывает ошибку со статусом.

> [!WARNING]
> `navigateTo` в middleware **без `return`** ничего не делает. На клиенте внутри middleware он не вызывает `router.push`, а только возвращает location, который должен стать результатом. На сервере он ставит `afterEach`, который запишет редирект, только если навигация закончилась на целевом адресе. Проверено: без `return` прямой заход отдаёт `200` с защищённой страницей, клиентский переход тоже её открывает (задача 2).

### Почему middleware выполняется дважды

При SSR сервер создаёт роутер, делает `router.push(url)`, и `beforeEach` с middleware отрабатывает. Состояние роутера в payload не передаётся. На клиенте плагин роутера в хуке `app:created` делает начальную навигацию `router.replace({ ...initialRoute, force: true })`: guards — и вместе с ними все middleware — проходят второй раз. Так клиент сам доходит до того же маршрута, загружает чанки страниц и повторяет побочные эффекты, которые нужны клиенту (например, `setPageLayout`).

Как отличить проходы:

- `import.meta.server` / `import.meta.client` — код только для одной среды. Сборщик вырезает ветку из другого бандла.
- `nuxtApp.isHydrating && nuxtApp.payload.serverRendered` — это начальная навигация после SSR. Проверено: на сервере `isHydrating === false`, на клиенте при первом проходе `true`, при следующих переходах снова `false`.

```ts
export default defineNuxtRouteMiddleware(() => {
  const nuxtApp = useNuxtApp()
  // the server already did this for the initial page
  if (import.meta.client && nuxtApp.isHydrating && nuxtApp.payload.serverRendered) return
  // ...
})
```

Пропускать клиентский проход стоит только для работы, результат которой уже есть в payload (запрос, который записал `useState`). Проверки доступа и редиректы безопасно оставлять двойными: на клиенте они дадут тот же результат. Без `serverRendered` условие неверно: `isHydrating` на клиенте `true` при любом старте, в том числе при `ssr: false`.

### Почему `to` и `from`, а не `useRoute()`

`useRoute()` в Nuxt возвращает маршрут **отрендеренной** страницы ([подробнее](./routing.md#useroute-в-nuxt-—-маршрут-отрендереннои-страницы)). Middleware работает до подтверждения навигации, поэтому на клиенте `useRoute()` в ней — это ещё **старый** маршрут. Проверено: при переходе `/ → /ur` middleware видит `useRoute().fullPath === '/'` и `to.fullPath === '/ur'`. В dev Nuxt предупреждает: `[NUXT_E2005] useRoute was called within middleware`. В документации: «There is no concept of a 'current route' in middleware».

### Server middleware — другой механизм

`server/middleware/*.ts` — обработчики Nitro (h3), а не часть Vue-приложения:

| | Route middleware | Server middleware |
| --- | --- | --- |
| Где работает | Vue Router, сервер и клиент | только сервер, Nitro |
| На что срабатывает | навигация между страницами | каждый HTTP-запрос: страницы, `/api`, неизвестные пути |
| Аргументы | `to`, `from` | `event` (h3) |
| Контекст | `useNuxtApp`, `useState`, сторы | `event.context`, без Vue и `useNuxtApp` |
| Результат | `navigateTo`, `abortNavigation` | ничего не возвращает: дополняет `event.context` или бросает ошибку |

Проверено: server middleware вывела лог для `/api/ping`, `/login` и `/favicon.ico`, а route middleware — только для `/login`. Поэтому авторизация API — задача server middleware или каждого обработчика, а route middleware отвечает за UX ([«Аутентификация»](../security/authentication.md#vue-и-nuxt-что-защищает-guard-а-что-нет)). Пример server middleware с проверкой `Origin` — в теме [«CSRF, clickjacking и supply chain»](../security/csrf-and-clickjacking.md).

### Плагины: когда и в каком порядке

Каждый файл верхнего уровня в `app/plugins/` (и `index` во вложенных каталогах) регистрируется сам. Суффикс `.client` или `.server` оставляет плагин только в одном бандле. Плагины выполняются при создании `nuxtApp`: **на сервере — на каждый запрос**, ведь каждый запрос создаёт своё приложение, на клиенте — один раз. Проверено логом: все серверные плагины выполнились заново для каждого `curl`.

Порядок определяется так:

1. `order`: `enforce: 'pre'` = −20, по умолчанию 0, `'post'` = 20. Встроенные плагины Nuxt распределены по тем же группам: `nuxt:router` выполняется раньше пользовательских.
2. Внутри одного `order` — по имени файла, поэтому снова префиксы `01.`, `02.`.
3. `parallel: true` — следующий плагин не ждёт завершения асинхронного. Nuxt дождётся всех параллельных до монтирования.
4. `dependsOn: ['name']` — плагин ждёт плагинов с этими `name`, даже если они параллельные.

Проверено: `z-pre.ts` с `enforce: 'pre'` выполнился раньше `a.ts`. У параллельного `slow` между `slow start` и `slow done` успел выполниться следующий плагин, а `needs-slow` с `dependsOn: ['slow']` — только после `slow done`.

Метаданные (`name`, `enforce`, `order`, `dependsOn`, `parallel`) Nuxt читает **при сборке**: парсит файл и ищет объект в `defineNuxtPlugin({...})`. Поэтому значения должны быть литералами, спред даёт ошибку сборки `NUXT_B2002`. Потом трансформ вырезает их из кода. Отсюда рекомендация документации: объектный синтаксис с `setup` вместо функции, иначе метаданные не видны.

```ts
export default defineNuxtPlugin({
  name: 'api',
  enforce: 'pre',
  parallel: true,
  async setup(nuxtApp) { /* ... */ },
  hooks: { 'app:mounted'() { /* ... */ } }, // registered before any plugin runs
})
```

### Что плагин может сделать

- **`return { provide: { hello } }`** — `nuxtApp.provide('hello', value)`: геттер `$hello` на `nuxtApp` и в `vueApp.config.globalProperties`. Получается `useNuxtApp().$hello` в коде и `$hello` в шаблоне. Тип выводится из возвращаемого значения: `nuxi prepare` пишет `.nuxt/types/plugins.d.ts`, где `NuxtApp` расширяется типами каждого плагина. Проверено: `$hello(42)` — `TS2345`. Ручной `nuxtApp.provide()` такого вывода не даёт.
- **`nuxtApp.vueApp.use(plugin)`** — обычный Vue-плагин (директивы, компоненты, `app.provide`). Механика `install` — в [«Плагинах и обработке ошибок»](../vue/plugins-and-error-handling.md#что-такое-плагин).
- **`nuxtApp.hook('page:finish', fn)`** — хуки жизненного цикла Nuxt: `app:created`, `app:mounted`, `page:start`, `page:finish`, `vue:error`, `app:error` и другие.
- **`addRouteMiddleware`** — middleware, которая зависит от рантайма (флага, конфигурации).

> [!WARNING]
> Код на верхнем уровне файла плагина выполняется **один раз на процесс**, а не на запрос. `const cache = new Map()` вне `setup` на сервере общий для всех пользователей. Состояние запроса создают внутри `setup` или через `useState`. Тот же класс ошибки — синглтон в модуле во Vue SSR ([«Composables»](../vue/composables.md#ssr-общее-состояние-модуля)).

### Контекст Nuxt: `useNuxtApp`, `tryUseNuxtApp`, `runWithContext`

Composables Nuxt (`useState`, `useRuntimeConfig`, `useCookie`, `navigateTo`) начинают с `useNuxtApp()`. Он ищет приложение в двух местах:

1. экземпляр компонента — `getCurrentInstance()?.appContext.app.$nuxt`, если есть injection context;
2. контекст `unctx` — переменная, которую Nuxt выставляет перед вызовом плагина, middleware или хука.

Если ни там, ни там нет, `useNuxtApp()` бросает `NUXT_E1001`, а `tryUseNuxtApp()` возвращает `null`. `nuxtApp.runWithContext(fn)` выставляет контекст и вызывает `fn`. На сервере это `vueApp.runWithContext(() => ctx.callAsync(nuxtApp, fn))`.

**Почему контекст теряется после `await`.** В JavaScript нет неявного контекста, который переживает `await`. На сервере в одном процессе одновременно обрабатываются несколько запросов, а у каждого свой `nuxtApp`. `unctx` без `AsyncLocalStorage` хранит текущий экземпляр в одной переменной: `callAsync` выставляет её, запускает функцию и **очищает**, как только та дошла до первого `await` и вернула промис. Чтобы код после `await` работал, Nuxt при сборке сервера переписывает `await` в функциях, переданных в `defineNuxtPlugin`, `defineNuxtRouteMiddleware`, а также в `middleware` и `validate` из `definePageMeta`:

```js
// .output/server/chunks/_/ctx-*.mjs
var ctx_default = defineNuxtRouteMiddleware(async () => {
  let __temp, __restore;
  [__temp, __restore] = executeAsync(() => sleep(10)), await __temp, __restore();
  log("mw ctx: direct after await", !!tryUseNuxtApp());
  // ...
});
```

Это тот же приём, что `withAsyncContext` в `<script setup>` ([«Composables»](../vue/composables.md#await-где-контекст-восстанавливается-а-где-нет)). И та же граница: трансформ видит только `await` **в теле** middleware или плагина. Во вложенной функции контекста после её собственного `await` нет. Проверено:

- helper вызывается до любого `await` в теле, `await` внутри, потом `useState` — SSR отвечает `500 NUXT_E1001`, клиентская навигация работает;
- если перед вызовом helper в теле уже был `await`, `__restore()` выставил переменную, и её никто не очистил. Один запрос проходит. Под нагрузкой (6 параллельных `curl`) три helper получили `nuxtApp` **чужого запроса**, остальные — `null`.

На клиенте трансформа нет и он не нужен: в браузере одно приложение, контекст — синглтон, который не очищается. Поэтому ошибка видна только при SSR и часто только под нагрузкой.

Как чинить:

- вызывать composables в теле middleware или плагина, а из helper возвращать данные (задача 3);
- захватить `nuxtApp = useNuxtApp()` до первого `await` и после него вызывать `nuxtApp.runWithContext(() => useState(...))`;
- `experimental.asyncContext: true` — `unctx` хранит контекст в `AsyncLocalStorage` Node, и он переживает любые `await`. Проверено: тот же тест с 6 запросами — у всех свой `nuxtApp`. Флаг экспериментальный и выключен по умолчанию.

> [!NOTE]
> В Nuxt 3 было иначе: каталоги — `middleware/` и `plugins/` в корне проекта ([3.x](https://nuxt.com/docs/3.x/directory-structure/middleware)). В `middleware/` регистрировались только файлы верхнего уровня. В Nuxt 4 `auth/index.ts` тоже становится middleware `auth` — upgrade guide помечает это как изменение со средним влиянием: прежде игнорируемый файл может начать выполняться. Для `plugins/` `index` во вложенных каталогах работал и раньше.

> [!WARNING]
> Nuxt 5 (не выпущен, сверено 2026-11-21 по схеме `@nuxt/schema` 4.6.4 и флагу `compatibilityVersion: 5`): `experimental.asyncCallHook` выключается, и `nuxtApp.callHook()` может вернуть не промис, если обработчики синхронные. Код плагинов и модулей вида `nuxtApp.callHook('x').then(...)` нужно переписать на `await`.

## Примеры

### Авторизация: страница, API и редирект обратно

```ts
// app/middleware/auth.ts — UX only: the API checks the session itself
export default defineNuxtRouteMiddleware((to) => {
  const session = useCookie('session')
  if (!session.value) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
// usage in app/pages/account.vue: definePageMeta({ middleware: 'auth' })
```

```ts
// server/middleware/auth.ts — the real check for /api/**
export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/') || event.path.startsWith('/api/auth/')) return
  const session = getCookie(event, 'session')
  if (!session) throw createError({ status: 401 })
  event.context.session = session
})
```

Проверено на стенде: без cookie страница отвечает `302` на `/login?redirect=…`, с cookie — `200`; `/api/*` без cookie — `401`. На клиенте после редиректа глобальные middleware выполняются второй раз — уже для `/login`.

### Плагин с типизированным `provide`

```ts
// app/plugins/api.ts
export default defineNuxtPlugin({
  name: 'api',
  setup(nuxtApp) {
    const config = useRuntimeConfig()
    const api = $fetch.create({
      baseURL: config.public.apiBase,
      onResponseError({ response }) {
        // runWithContext: the callback runs after an await, outside the plugin call
        if (response.status === 401) nuxtApp.runWithContext(() => navigateTo('/login'))
      },
    })
    return { provide: { api } }
  },
})
// any component, typed via .nuxt/types/plugins.d.ts: const { $api } = useNuxtApp()
```

Так устроен рецепт «Custom `useFetch`» в документации: после ответа код выполняется вне вызова плагина, поэтому `navigateTo` обёрнут в `runWithContext`.

## Вопросы с интервью

::: details Чем route middleware отличается от server middleware
Route middleware — часть Vue-приложения: Nuxt вызывает её из одного `router.beforeEach` при навигации, на сервере во время SSR и на клиенте. Аргументы — `to` и `from`, доступны composables, результат — `navigateTo`, `abortNavigation` или ничего. Server middleware — обработчики Nitro в `server/middleware/`. Они срабатывают на каждый HTTP-запрос, включая `/api`, получают `event`, ничего не возвращают и только дополняют `event.context` или бросают ошибку. Route middleware не срабатывает на запросы к API, поэтому не защищает данные: защита API — в server middleware или в обработчике.
:::

::: details Почему middleware срабатывает дважды и как этого избежать
При SSR сервер выполняет навигацию на запрошенный URL, и middleware отрабатывает. Состояние роутера не сериализуется, поэтому клиентский плагин роутера в `app:created` делает начальную навигацию `router.replace(..., force: true)`, и guards проходят ещё раз. Различать: `import.meta.server`/`import.meta.client`, а клиентский проход после SSR — по `nuxtApp.isHydrating && nuxtApp.payload.serverRendered`. Пропускать стоит только работу, результат которой уже в payload; редиректы и проверки доступа можно оставить. Проверка одного `isHydrating` без `serverRendered` — ошибка: на клиенте он `true` при старте и в режиме `ssr: false`, где серверного прохода не было.
:::

::: details Почему в middleware используют to и from, а не useRoute
`useRoute()` в Nuxt — маршрут уже отрендеренной страницы: внутри страницы из её `RouteProvider`, снаружи `nuxtApp._route`, который синхронизируется после разрешения `Suspense`. Middleware выполняется до подтверждения навигации, поэтому на клиенте `useRoute()` в ней — старый маршрут (проверено: `'/'` при переходе на `/ur`). Цель навигации — `to`. В dev Nuxt предупреждает кодом `NUXT_E2005`.
:::

::: details В каком порядке выполняются middleware и плагины
Плагины: по `order` (`enforce: 'pre'`, обычные, `'post'`), внутри — по имени файла. `parallel: true` не блокирует следующий, `dependsOn` ждёт плагины с указанными `name`. На сервере все выполняются на каждый запрос, на клиенте — один раз до монтирования. Middleware: одна цепочка в `beforeEach`. Сначала глобальные из файлов по имени файла, затем из `addRouteMiddleware`, затем `meta.middleware` записей `to.matched` от родителя к дочерней, затем `appMiddleware` из route rules. Повторы схлопываются через `Set`. Первый результат, отличный от `undefined` и `true`, прерывает цепочку, а редирект запускает её заново для нового адреса.
:::

::: details Почему composables теряют контекст Nuxt после await
Composables вызывают `useNuxtApp()`. Вне компонента он берёт приложение из `unctx` — переменной, которую Nuxt выставляет перед вызовом плагина или middleware. На сервере один процесс обслуживает много запросов, и без `AsyncLocalStorage` переменная очищается после синхронной части. Nuxt при сборке сервера переписывает `await` в теле `defineNuxtPlugin` и `defineNuxtRouteMiddleware` (и в `middleware`/`validate` из `definePageMeta`) так, чтобы после него контекст восстанавливался. Во вложенные функции трансформ не заглядывает. Итог — `NUXT_E1001` или, хуже, `nuxtApp` чужого запроса под нагрузкой. Чинят так: composables в теле, `nuxtApp.runWithContext()` с захваченным заранее `nuxtApp` или `experimental.asyncContext`. На клиенте проблемы нет: контекст там — синглтон.
:::

::: details Что делает provide в плагине Nuxt и чем он отличается от Vue-плагина
`return { provide: { api } }` вызывает `nuxtApp.provide('api', api)`: появляется геттер `$api` на `nuxtApp` и в `globalProperties`. Доступ — `useNuxtApp().$api` или `$api` в шаблоне. Тип выводится автоматически из возвращаемого значения, через сгенерированный `.nuxt/types/plugins.d.ts`. Vue-плагин — объект с `install(app)`. В Nuxt его подключают через `nuxtApp.vueApp.use()` внутри плагина Nuxt. Главное отличие — момент и частота: плагин Nuxt выполняется на каждый серверный запрос со своим `nuxtApp` и может быть асинхронным, иметь порядок и зависимости. При этом `vueApp.provide` даёт значение для `inject`, а `nuxtApp.provide` — `$`-свойство.
:::

::: details Что вернуть из middleware, чтобы не пустить пользователя
`return navigateTo('/login')` — редирект: на клиенте новая навигация, на сервере `302`. `return abortNavigation()` — отмена: на клиенте пользователь остаётся на прежней странице, на сервере прежней страницы нет, поэтому `404`. `abortNavigation({ status: 403 })` — на сервере страница ошибки с `403`, на клиенте отмена без страницы ошибки. Ошибку с `fatal: true` (или `throw createError({ fatal: true })`) показывают и на клиенте. Без `return` `navigateTo` в middleware ничего не делает.
:::

## Задачи

### 1. Что выведет · средне

Файлы и страницы:

```ts
// app/middleware/01.log.global.ts
export default defineNuxtRouteMiddleware(() => console.log('01.log.global'))
// app/middleware/auth.global.ts
export default defineNuxtRouteMiddleware(() => console.log('auth.global'))
// app/middleware/admin/index.ts
export default defineNuxtRouteMiddleware(() => console.log('admin'))
// app/plugins/flags.ts
export default defineNuxtPlugin(() => {
  addRouteMiddleware('flags', () => console.log('flags'), { global: true })
})
```

```ts
// app/pages/parent.vue
definePageMeta({ middleware: ['admin', () => { console.log('inline parent') }] })
// app/pages/parent/child.vue
definePageMeta({ middleware: [() => { console.log('inline child') }, 'admin'] })
```

Пользователь открывает `/parent/child` по прямой ссылке. Что будет в логе сервера и в консоли браузера?

::: details Решение и разбор
```text
01.log.global
auth.global
flags
admin
inline parent
inline child
```

Одинаково на сервере и в браузере (проверено): клиент повторяет навигацию при старте. Глобальные из файлов идут по имени (`01.` раньше `auth`), за ними — добавленная в плагине: Nuxt берёт `[...globalMiddleware, ...nuxtApp._middleware.global]`. Затем `meta.middleware` совпавших записей, от родителя к дочерней. `'admin'` из дочерней страницы не повторяется: записи собираются в `Set`, и строка уже есть. `admin/index.ts` в Nuxt 4 — middleware `admin`, в Nuxt 3 этот файл не зарегистрировался бы.

Ловушка: inline-стрелка без фигурных скобок, `() => console.log(...)`, вернула бы `undefined` и сработала бы. А `() => log.push(x)` вернёт число, и Nuxt примет его за результат guard.
:::

### 2. Найдите баг · легко

Неавторизованный пользователь видит страницу заказов и при переходе по ссылке, и при прямом заходе.

```ts
// app/middleware/auth.ts
export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn } = await useUserSession()
  if (!loggedIn.value) {
    navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
```

::: details Решение и разбор
Нет `return`. В middleware на клиенте `navigateTo` не вызывает `router.push`, а только возвращает location: решение принимает возвращаемое значение. Функция вернула `undefined`, цепочка продолжилась. На сервере `navigateTo` в middleware ставит `afterEach`, который запишет `302`, только если навигация закончится на `/login`. Она закончилась на `/orders`, поэтому ответ `200` со страницей (проверено).

```ts
if (!loggedIn.value) {
  return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
}
```

Вторая проверка: `auth` не должна стоять на самой `/login`, иначе редирект зациклится. И помнить, что это UX: данные заказов защищает API.
:::

### 3. Найдите баг · средне

Локально всё работает. На проде при прямом заходе на страницы с этой middleware часть ответов — 500 `NUXT_E1001`, а изредка в шапке оказывается имя **другого** пользователя.

```ts
// app/middleware/user.global.ts
async function loadUser() {
  const user = await $fetch<User | null>('/api/me', { headers: useRequestHeaders(['cookie']) })
  useState<User | null>('user').value = user
}

export default defineNuxtRouteMiddleware(async () => {
  await useFeatureFlags().ready()
  if (!useState('user').value) await loadUser()
})
```

::: details Решение и разбор
`useState` вызывается во вложенной функции после **её** `await`. Трансформ Nuxt переписывает только `await` в теле middleware: после `await useFeatureFlags().ready()` и после `await loadUser()` контекст восстанавливается, а внутри `loadUser` — нет. На сервере контекст — одна переменная `unctx` на процесс:

- если её уже очистили, `useState` → `useNuxtApp()` бросает `NUXT_E1001` → 500;
- если её успел выставить другой запрос, `useState('user')` пишет пользователя в **чужой** `nuxtApp`, и тот уходит в чужой payload.

Локально запросы последовательные: `__restore()` после первого `await` выставил переменную, и её никто не очистил — поэтому «работает». Проверено: при 6 параллельных запросах три helper получили чужой `nuxtApp`, три — `null`. На клиенте ошибки нет, контекст там синглтон.

Исправление — вернуть данные и вызвать composable в теле:

```ts
async function fetchUser(headers: Record<string, string>) {
  return await $fetch<User | null>('/api/me', { headers })
}

export default defineNuxtRouteMiddleware(async () => {
  await useFeatureFlags().ready()
  const user = useState<User | null>('user')
  if (!user.value) user.value = await fetchUser(useRequestHeaders(['cookie']))
})
```

Composables (`useState`, `useRequestHeaders`) вызваны синхронно в теле, после `await` только присваивание в уже полученный `ref`. Альтернативы — `const nuxtApp = useNuxtApp()` до `await` и `nuxtApp.runWithContext(() => ...)` после, или `experimental.asyncContext: true` (с ним тест с 6 запросами прошёл без ошибок).
:::

### 4. Найдите баг · легко

Плагин метрик использует HTTP-клиент из другого плагина. После переименования `api.ts` в `ofetch.ts` каждый переход падает с `Cannot read properties of undefined (reading 'post')`.

```ts
// app/plugins/metrics.client.ts
export default defineNuxtPlugin((nuxtApp) => {
  const { $api } = nuxtApp
  nuxtApp.hook('page:finish', () => $api.post('/track', { path: location.pathname }))
})
// app/plugins/ofetch.ts (was api.ts)
export default defineNuxtPlugin(() => ({ provide: { api: $fetch.create({ baseURL: '/api' }) } }))
```

::: details Решение и разбор
Плагины одного `order` выполняются по имени файла. Раньше `api.ts` шёл перед `metrics.client.ts`, теперь `ofetch.ts` — после него. `metrics` деструктурирует `$api` в момент своего выполнения, когда `provide` ещё не случился, и в замыкании остаётся `undefined` (проверено: ошибка в `page:finish` первой же страницы).

Надёжно — явная зависимость вместо порядка алфавита:

```ts
// app/plugins/ofetch.ts
export default defineNuxtPlugin({
  name: 'ofetch',
  setup: () => ({ provide: { api: $fetch.create({ baseURL: '/api' }) } }),
})
// app/plugins/metrics.client.ts
export default defineNuxtPlugin({
  name: 'metrics',
  dependsOn: ['ofetch'],
  setup(nuxtApp) {
    const { $api } = nuxtApp
    nuxtApp.hook('page:finish', () => $api.post('/track', { path: location.pathname }))
  },
})
```

Проверено: с `dependsOn` запрос уходит, `nuxi typecheck` проходит. `dependsOn` работает только с объектным синтаксисом и литеральными `name`: метаданные читаются при сборке. Проще, но хрупче — префиксы `01.ofetch.ts`, `02.metrics.client.ts` или `enforce: 'pre'` у HTTP-клиента.
:::

### 5. Реализуйте цепочку middleware · сложно

Напишите `runMiddleware(to, from, { global, named })` — упрощённую версию того, что Nuxt вызывает в `router.beforeEach`. `global` — массив функций, `named` — объект `name → () => Promise<{ default: fn }>`, `to.matched[i].meta.middleware` — строка, функция или массив. Требования: порядок «глобальные, затем записи от родителя к дочерней», повторы не выполняются, именованные загружаются лениво, неизвестное имя — исключение, `undefined` и `true` пропускают дальше, иное значение прерывает цепочку и возвращается, исключение middleware возвращается как `Error`.

::: details Решение и разбор
```js
export async function runMiddleware(to, from, { global, named }) {
  const entries = new Set(global)
  for (const record of to.matched) {
    const mw = record.meta.middleware
    if (!mw) continue
    for (const entry of Array.isArray(mw) ? mw : [mw]) entries.add(entry)
  }
  for (const entry of entries) {
    const fn = typeof entry === 'string' ? (await named[entry]?.())?.default : entry
    if (!fn) throw new Error(`Unknown route middleware: '${String(entry)}'`)
    let result
    try {
      result = await fn(to, from)
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err))
    }
    if (result === undefined || result === true) continue
    return result // false, a location or an Error stops the chain
  }
}

// router.beforeEach((to, from) => runMiddleware(to, from, { global, named }))
```

`Set` хранит и строки, и функции: одинаковое имя схлопывается, а две разные inline-функции — нет, как в Nuxt. Ленивые `import()` дают отдельный чанк на именованную middleware, глобальные Nuxt импортирует статически. Возвращённое значение Vue Router трактует сам: `false` — отмена, location — редирект, `Error` — отмена с `router.onError`. Чего здесь нет по сравнению с Nuxt: `nuxtApp.runWithContext` вокруг вызова, особый путь на сервере (`false` и `Error` → `showError` со статусом), `appMiddleware` из route rules. Проверено в Node: ожидаемый порядок, редирект, ошибка на неизвестном имени, `throw 'boom'` → `Error`.

Сложность: O(n) по времени и памяти, n — число записей middleware.
:::

## Источники

- [Nuxt 4: `app/middleware`](https://nuxt.com/docs/4.x/directory-structure/app/middleware) — виды, порядок, двойной запуск, «no concept of a current route»
- [Nuxt 4: `app/plugins`](https://nuxt.com/docs/4.x/directory-structure/app/plugins) — регистрация, порядок, `parallel`, `dependsOn`, типизация `provide`
- [Nuxt 4: NuxtApp](https://nuxt.com/docs/4.x/guide/going-further/nuxt-app) — контекст, `runWithContext`, потеря контекста после `await`
- [Nuxt 4: `useNuxtApp`](https://nuxt.com/docs/4.x/api/composables/use-nuxt-app) — `tryUseNuxtApp`, `runWithContext`, `asyncContext`
- [Nuxt 4: `defineNuxtRouteMiddleware`](https://nuxt.com/docs/4.x/api/utils/define-nuxt-route-middleware), [`abortNavigation`](https://nuxt.com/docs/4.x/api/utils/abort-navigation), [`addRouteMiddleware`](https://nuxt.com/docs/4.x/api/utils/add-route-middleware), [`defineNuxtPlugin`](https://nuxt.com/docs/4.x/api/utils/define-nuxt-plugin)
- [Nuxt 4: `server`](https://nuxt.com/docs/4.x/directory-structure/server) — server middleware
- [Nuxt 4: Custom `useFetch`](https://nuxt.com/docs/4.x/guide/recipes/custom-usefetch) — плагин с `$fetch.create` и `runWithContext`
- [Nuxt 4: Lifecycle Hooks](https://nuxt.com/docs/4.x/api/advanced/hooks)
- [Nuxt 4: Upgrade Guide](https://nuxt.com/docs/4.x/getting-started/upgrade) — `index` во вложенных каталогах `app/middleware/`
- [Nuxt 4: Experimental features](https://nuxt.com/docs/4.x/guide/going-further/experimental-features) — `asyncContext`, `asyncCallHook`
- [Nuxt 4: ошибки `NUXT_E1001`](https://nuxt.com/docs/4.x/errors/e1001) и [`NUXT_E2005`](https://nuxt.com/docs/4.x/errors/e2005)
- [Nuxt 3: `middleware`](https://nuxt.com/docs/3.x/directory-structure/middleware) и [`plugins`](https://nuxt.com/docs/3.x/directory-structure/plugins)
- [nuxt/nuxt v4.6.4: `pages/runtime/plugins/router.ts`](https://github.com/nuxt/nuxt/blob/v4.6.4/packages/nuxt/src/pages/runtime/plugins/router.ts) — `runMiddleware`, начальная навигация на клиенте
- [nuxt/nuxt v4.6.4: `app/nuxt.ts`](https://github.com/nuxt/nuxt/blob/v4.6.4/packages/nuxt/src/app/nuxt.ts) — `applyPlugins`, `provide`, `useNuxtApp`, `callWithNuxt`
- [nuxt/nuxt v4.6.4: `app/composables/router.ts`](https://github.com/nuxt/nuxt/blob/v4.6.4/packages/nuxt/src/app/composables/router.ts) — `navigateTo` в middleware, `abortNavigation`, `addRouteMiddleware`
- [unjs/unctx](https://github.com/unjs/unctx) — `callAsync`, `executeAsync`, трансформ `await`
