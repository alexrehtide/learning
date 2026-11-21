---
title: Vue Router
level: ядро
---

# Vue Router

> **Коротко.** Vue Router — это matcher, который превращает URL в цепочку записей маршрутов (`matched`), и обёртка над History API, которая меняет URL без перезагрузки. Текущий маршрут хранится в `shallowRef`, каждая навигация заменяет его целиком. `RouterView` рендерит `matched[depth]`, поэтому при смене только `params` запись та же и компонент переиспользуется, а не пересоздаётся. Навигация — очередь guards: каждый может пропустить переход, отменить его (`false`) или перенаправить (вернуть location). Guard на клиенте — это UX, а не защита данных.

**Связанные темы:** [`KeepAlive`, `Teleport`, `Suspense`, `Transition` и асинхронные компоненты](./built-in-components.md), [Реактивность: `ref`, `reactive`, `computed`](./reactivity.md), [`watch` и `watchEffect`](./watchers.md), [Жизненный цикл](./lifecycle.md), [Composables](./composables.md), [Аутентификация на фронтенде](../security/authentication.md), [Оптимизация загрузки](../performance/loading.md), [Модули: ESM и CommonJS](../javascript/modules.md), [Core Web Vitals и измерение](../performance/web-vitals.md), [Данные и сеть в System Design](../architecture/data-and-network.md)

## Теория

Все проверки в теме выполнены на Vue 3.5.45 и Vue Router 5.5.1 в Node 26.13.1: навигация — в happy-dom, SSR — через `@vue/server-renderer`, вывод компилятора — через `@vue/compiler-sfc`, типы — `tsc` 6.0.3. Сценарии навигации повторены на Vue `3.6.0-rc.16`, результат совпал. Сверено 2026-11-21.

### Версия: Vue Router 5

Актуальная major-версия — **5** (5.5.1 от 2026-11-13; 5.0.0 вышел 2026-01-29). Ветка 4.x ещё получает патчи (4.6.5). Пятая версия — переходный релиз: в ядро влит `unplugin-vue-router` (файловая маршрутизация и генерация типов). Для кода на v4 без этого плагина breaking changes нет. Плагин теперь импортируется из `vue-router/vite`, Data Loaders — из `vue-router/experimental`. Аргумент `next` в guards с 5.0.3 пишет предупреждение об устаревании в dev-режиме: guard должен возвращать значение. Vue Router 6 будет только ESM и уберёт устаревшие API. Nuxt строит маршруты из файлов поверх того же Vue Router; файловая маршрутизация — в разделе «Nuxt», здесь — ручная конфигурация.

### Из чего состоит роутер

`createRouter({ history, routes })` собирает три части:

- **matcher** компилирует `path` каждой записи в регулярное выражение и **ранжирует** записи: статический сегмент важнее динамического, динамический — важнее `(.*)`. Поэтому порядок в массиве `routes` почти не важен: catch-all можно объявить первым;
- **history** — адаптер над способом хранить URL: `createWebHistory`, `createWebHashHistory` или `createMemoryHistory`. Роутер вызывает у него `push`/`replace` и слушает `popstate`;
- **`currentRoute`** — `shallowRef` с нормализованным маршрутом. Каждая навигация кладёт в него **новый объект**, старый не мутируется.

`app.use(router)` регистрирует глобальные `RouterLink` и `RouterView`, `$router`/`$route` и делает `provide` для `useRouter()`/`useRoute()`. В браузере `app.use` запускает первую навигацию по текущему URL (кроме memory history). В шаблоне компилятор не знает о роутере: `<RouterLink>` превращается в `resolveComponent("RouterLink")`, `$route` — в `_ctx.$route` (проверено в `@vue/compiler-sfc` 3.5.45).

**`RouterView` и глубина.** Каждый `RouterView` делает `inject(viewDepthKey)` (по умолчанию 0), рендерит компонент записи `route.matched[depth]` и делает `provide` глубины `depth + 1` вниз. Так вложенный `RouterView` внутри компонента родительского маршрута рендерит дочернюю запись. Именованные представления — это объект `components: { default, sidebar }` в записи и `<RouterView name="sidebar">` в шаблоне.

**`useRoute()`** возвращает не `currentRoute.value`, а объект с геттерами `route[key] → currentRoute.value[key]`, обёрнутый в `shallowReactive`. Чтение `route.params` в рендере или `computed` подписывается на `currentRoute`. Сам `route.params` — обычный объект, который при каждой навигации заменяется. `const { params } = useRoute()` или `const id = route.params.id` в `setup` — снимок, он не обновится.

### Режимы history и что нужно от сервера

| Режим | URL | Сервер | Когда |
| --- | --- | --- | --- |
| `createWebHistory(base?)` | `/users/1` | fallback на `index.html` для всех путей | по умолчанию, SSR, SEO |
| `createWebHashHistory()` | `/#/users/1` | ничего: хеш не уходит на сервер | статический хостинг без настроек, `file://` (Electron) |
| `createMemoryHistory()` | не меняется | — | SSR на сервере, тесты, встраивание |

HTML5-режим использует `history.pushState`, URL выглядит обычным. Но при перезагрузке `/users/1` браузер запросит этот путь у сервера, и без fallback сервер ответит 404. Нужно правило «любой неизвестный путь → `index.html`» (`try_files $uri $uri/ /index.html` в nginx). После этого сервер больше не отдаёт 404 сам: нужен catch-all маршрут `{ path: '/:pathMatch(.*)*', component: NotFound }`. Хеш-режим работает без сервера, но путь не виден серверу: ни SSR, ни нормального SEO.

На сервере нет `window`: `createWebHistory()` падает (`ReferenceError: location is not defined`). При SSR роутер создаётся **на каждый запрос** с `createMemoryHistory()`, затем `router.push(req.url)` и `await router.isReady()` перед `renderToString`. Memory history не делает первую навигацию сама.

### Сопоставление: параметры, вложенность, имена

- **Динамический сегмент** `/users/:id` — `params.id` всегда **строка** (`'42'`). Число при `push` приводится к строке.
- **Свой regex**: `/users/:id(\\d+)`. В JS-строке обратный слеш экранируется дважды: `'/:id(\d+)'` превращается в `(d+)`, и маршрут молча перестаёт совпадать (задача 2).
- **Повторяемые** `:chapters+` / `:chapters*` дают массив, необязательный — `:id?`. Catch-all `/:pathMatch(.*)*` кладёт в `pathMatch` массив сегментов.
- **Вложенные маршруты** — `children`; относительный путь ребёнка (`'profile'`) склеивается с родителем. `route.matched` — массив записей от корня к листу; `route.meta` — слияние `meta` всех записей цепочки, поэтому `requiresAuth` на родителе действует на всех детей.
- **Имена** развязывают код и URL: `router.push({ name: 'user', params: { id } })` не ломается при смене пути, а без обязательного параметра бросает `Missing required param "id"`.
- `redirect` подменяет цель **до** guards исходного маршрута; `alias` отдаёт ту же запись по другому URL без редиректа.
- `props: true` передаёт `params` в props компонента, и компонент не знает о роутере. Так его проще тестировать и переиспользовать.

### Почему компонент не пересоздаётся при смене `params`

Для каждой навигации роутер делит записи на **уходящие**, **обновляемые** и **входящие**, сравнивая `from.matched` и `to.matched` по идентичности записи. При переходе `/users/1 → /users/2` запись та же: она «обновляемая». `RouterView` рендерит тот же компонент, Vue патчит его на месте, `setup` и `onMounted` не вызываются. Это дёшево, но код, который загрузил данные в `onMounted`, покажет старого пользователя.

Три способа отреагировать:

- `watch(() => route.params.id, load, { immediate: true })` или `watch` на prop при `props: true` — компонент и его состояние сохраняются;
- `onBeforeRouteUpdate(async (to) => …)` — то же, но это guard: он выполняется **до** подтверждения и может отменить навигацию;
- `<RouterView :key="route.fullPath">` — пересоздаёт компонент на каждый URL. Просто, но теряется локальное состояние и переиспользование DOM, а смена `query` тоже пересоздаёт страницу.

### Навигационные guards

Порядок разрешения навигации (из документации, проверен запуском):

1. Навигация запущена.
2. `beforeRouteLeave` в уходящих компонентах.
3. Глобальные `beforeEach`.
4. `beforeRouteUpdate` в переиспользуемых компонентах.
5. `beforeEnter` в записях маршрутов.
6. Загрузка ленивых компонентов маршрута.
7. `beforeRouteEnter` в входящих компонентах.
8. Глобальные `beforeResolve`.
9. Навигация подтверждена: меняется URL и `currentRoute`.
10. Глобальные `afterEach`.
11. Обновление DOM.
12. Колбэки, переданные в `next` внутри `beforeRouteEnter`, получают экземпляр.

Следствия порядка:

- `beforeEnter` записи срабатывает только при **входе** в запись. При `/users/1 → /users/2` его нет, есть только `beforeRouteUpdate`. Проверка доступа «по `id`» в `beforeEnter` при смене параметра не выполнится.
- `beforeRouteEnter` стоит после загрузки чанка, потому что объявлен в самом компоненте. Экземпляра ещё нет, `this` недоступен.
- `beforeResolve` — последняя точка, где все компоненты загружены и можно отменить переход. Сюда кладут «последнюю» загрузку данных или запрос разрешений.
- В `afterEach` URL уже новый, а DOM ещё старый. Отменить отсюда нельзя, зато третий аргумент — `failure`. Место для аналитики и `document.title`.

**Что возвращает guard** (в том числе через `async`):

- ничего или `true` — пропустить к следующему guard;
- `false` — отменить. Если URL поменял пользователь (кнопка «Назад»), роутер вернёт его к `from`;
- location (`'/login'`, `{ name: 'login', query }`) — отменить текущую навигацию и начать **новую с тем же `from`**. Новая навигация проходит все guards заново, поэтому guard, который перенаправляет на `/login`, должен пропускать сам `/login` (задача 4). Dev-сборка прерывает редирект на ту же location после 30 повторов, prod — нет;
- `throw` — отменить, `router.push` отклоняется, вызывается `router.onError`.

С Vue 3.3 в глобальных guards работает `inject()`: можно брать сторы и значения из `app.provide`.

**Неудачи навигации.** `router.push` не отклоняется, если guard отменил переход: промис разрешается объектом `NavigationFailure`. Тип проверяют через `isNavigationFailure(result, NavigationFailureType.aborted)`. Три типа: `aborted` (guard вернул `false`), `cancelled` (новая навигация началась раньше, чем закончилась эта), `duplicated` (уже на этом адресе). Редирект — не неудача: исходный адрес лежит в `route.redirectedFrom`.

**`meta` для авторизации.** `meta: { requiresAuth: true }` на записи и один `beforeEach`, который смотрит в `to.meta` (с учётом слияния по цепочке). Тип `meta` расширяют через `declare module 'vue-router' { interface RouteMeta { … } }`. Guard не защищает данные: чанк скачивается по прямому URL, API отвечает любому запросу с cookie. Подробно — в [«Аутентификации»](../security/authentication.md).

### Ленивые маршруты

`component: () => import('./UserPage.vue')` — функция, которую роутер вызовет на шаге 6, когда навигация впервые дойдёт до записи. Результат запоминается в записи, повторного `import()` нет. Сборщик делает из каждого `import()` отдельный чанк, Vite добавляет `modulepreload` для его зависимостей ([подробнее о чанках](../performance/loading.md)). Группировать чанки — `build.rollupOptions.output.manualChunks`.

> [!WARNING]
> Не оборачивайте компонент маршрута в `defineAsyncComponent`. Vue Router 5.5.1 предупреждает: `[VUE_ROUTER_R0029] Component "default" in record with path "/async" is defined using "defineAsyncComponent()"`. Роутер ждёт функцию-загрузчик, чтобы загрузить чанк **до** подтверждения навигации. Async-компонент отрендерится после перехода, и guards в нём (`beforeRouteEnter`) не выполнятся. Внутри страницы `defineAsyncComponent` уместен ([разбор](./built-in-components.md)).

Ошибка загрузки чанка (сеть, деплой удалил старые файлы) отменяет навигацию и приходит в `router.onError`. Типичная реакция — полная перезагрузка на целевой URL, в Vite — ещё и событие `vite:preloadError`.

### Загрузка данных: до или после навигации

- **После навигации.** Страница открывается сразу и показывает скелетон, данные загружаются в `watch` на параметр с `immediate`. Отклик мгновенный, нужно обрабатывать загрузку, ошибку и устаревший ответ (`onWatcherCleanup` + `AbortController`, см. [`watch`](./watchers.md)).
- **До навигации.** Данные загружаются в guard (`beforeRouteEnter`, `beforeResolve` или `beforeEnter`), страница появляется уже с ними. Пока идёт запрос, пользователь видит старую страницу, поэтому нужен глобальный индикатор. Ошибку можно превратить в отмену или редирект на страницу ошибки.

Классическая передача данных через `next(vm => vm.setData(data))` устарела вместе с `next`. На смену предлагают **Data Loaders** (`defineBasicLoader` из `vue-router/experimental`) — статус experimental. Nuxt решает ту же задачу через `useAsyncData` (раздел «Nuxt»).

### `scrollBehavior`

```ts
scrollBehavior(to, from, savedPosition) {
  if (savedPosition) return savedPosition // back/forward only (popstate)
  if (to.hash) return { el: to.hash, top: 64, behavior: 'smooth' } // offset for a sticky header
  return { top: 0 }
}
```

Функция вызывается после навигации и возвращает позицию (`{ top, left }`, `{ el }`) или промис с ней. Промис нужен, если страница появляется не сразу (`Transition mode="out-in"`). `savedPosition` есть только у переходов через `popstate`: роутер сохраняет позицию в `history.state` перед уходом. Пустой объект или falsy-значение — не прокручивать. Если задан `scrollBehavior`, роутер ставит `history.scrollRestoration = 'manual'`, отключая восстановление браузером.

### Типизированные маршруты

С 4.4 имена, пути и параметры можно типизировать картой `RouteNamedMap`: запись `RouteRecordInfo<name, path, rawParams, params, childNames>` и регистрация через `declare module 'vue-router' { interface TypesConfig { RouteNamedMap: RouteNamedMap } }`. Вручную это утомительно, поэтому карту генерирует плагин `vue-router/vite` из файлов (`dts: 'src/route-map.d.ts'`). Проверка `tsc` показала:

- неизвестное имя — ошибка с подсказкой («Did you mean `'user'`?»);
- `useRoute('user').params.id` — `string`, а у `useRoute()` без имени `params` — объединение по всем маршрутам, `params.id` без сужения — ошибка;
- `push({ name: 'user' })` без `params` ошибкой **не** считается: параметры могут взяться из текущего маршрута. Строковые пути (`push('/nope')`) не проверяются.

> [!NOTE]
> Во Vue 3.6 (RC, сверено 2026-11-21): API роутера не меняется, порядок guards, переиспользование компонента и `scrollBehavior` на `3.6.0-rc.16` дают тот же результат. Но `npm i vue@rc vue-router@5.5.1` падает с `ERESOLVE`: peer `vue@"^3.5.34 || ^4.0.0"` не включает пре-релизы. Для проб нужен `--legacy-peer-deps` или `overrides`.

## Примеры

### Роутер с ленивыми страницами, `meta` и единым guard

```ts
// router.ts (Vue Router 5)
import { createRouter, createWebHistory } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta { requiresAuth?: boolean; title?: string }
}

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: () => import('./pages/HomePage.vue') },
    { path: '/login', name: 'login', component: () => import('./pages/LoginPage.vue') },
    {
      path: '/account',
      component: () => import('./layouts/AccountLayout.vue'), // contains <RouterView />
      meta: { requiresAuth: true }, // merged into every child's route.meta
      children: [
        { path: '', name: 'account', component: () => import('./pages/AccountPage.vue') },
        { path: 'orders/:id(\\d+)', name: 'order', component: () => import('./pages/OrderPage.vue'), props: true },
      ],
    },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('./pages/NotFound.vue') },
  ],
  scrollBehavior: (to, from, saved) => saved ?? (to.hash ? { el: to.hash } : { top: 0 }),
})

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return // also lets /login through: no redirect loop
  const auth = useAuthStore() // inject() works in guards since Vue 3.3
  if (auth.user === undefined) await auth.fetchMe()
  if (!auth.user) return { name: 'login', query: { redirect: to.fullPath } }
})

router.afterEach((to, from, failure) => {
  if (!failure) document.title = to.meta.title ?? 'Shop'
})
```

### Страница, которая переживает смену параметра

```vue
<script setup lang="ts">
import { ref, watch, onWatcherCleanup } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

const props = defineProps<{ id: string }>() // props: true in the route record
const order = ref<Order | null>(null)
const error = ref<unknown>(null)
const dirty = ref(false)

watch(() => props.id, async (id) => {
  const controller = new AbortController()
  onWatcherCleanup(() => controller.abort()) // id changed again: drop the stale request
  order.value = error.value = null
  try {
    const res = await fetch(`/api/orders/${id}`, { signal: controller.signal })
    order.value = await res.json()
  } catch (e) {
    if (!controller.signal.aborted) error.value = e
  }
}, { immediate: true }) // the instance is reused for /orders/1 -> /orders/2

onBeforeRouteLeave(() => {
  if (dirty.value && !window.confirm('Discard changes?')) return false
})
</script>
```

### SSR: роутер на каждый запрос

```ts
// entry-server.ts
import { createSSRApp } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { renderToString } from 'vue/server-renderer'

export async function render(url: string) {
  const app = createSSRApp(App)
  const router = createRouter({ history: createMemoryHistory(), routes }) // no window on the server
  app.use(router)
  await router.push(url) // memory history does not start navigation by itself
  await router.isReady() // lazy components loaded, guards done
  const status = router.currentRoute.value.name === 'not-found' ? 404 : 200
  return { html: await renderToString(app), status }
}
// client: createWebHistory(), then `await router.isReady()` before app.mount(),
// otherwise hydration starts before the page chunk is loaded and mismatches the HTML
```

## Вопросы с интервью

::: details Чем history-режим отличается от hash и что нужно настроить на сервере
`createWebHistory` меняет путь через `history.pushState`, URL выглядит как обычный. При перезагрузке или прямом заходе браузер запрашивает этот путь у сервера, поэтому нужен fallback: любой путь, которому не соответствует файл, отдаёт `index.html`. После этого сервер сам 404 не вернёт, нужен catch-all маршрут, а при SSR — статус 404 из ответа сервера. `createWebHashHistory` хранит путь после `#`, который не уходит на сервер: настройки не нужны, но сервер не видит путь — нет SSR, хуже SEO. `createMemoryHistory` не трогает URL — для SSR на сервере и тестов.
:::

::: details Почему при переходе с users/1 на users/2 данные не обновились
Роутер сравнивает `from.matched` и `to.matched` по идентичности записей. Запись та же, поэтому `RouterView` рендерит тот же компонент и Vue патчит его на месте: `setup` и `onMounted` не вызываются заново. Если данные загружались в `onMounted`, они остаются от первого пользователя. Решения: `watch` на `route.params.id` или на prop (`props: true`) с `immediate`, `onBeforeRouteUpdate`, если нужно загрузить до подтверждения или отменить, либо `:key="route.fullPath"` на `RouterView` — пересоздание ценой потери состояния.
:::

::: details В каком порядке выполняются guards при навигации
`beforeRouteLeave` уходящих компонентов → глобальные `beforeEach` → `beforeRouteUpdate` переиспользуемых → `beforeEnter` записей → загрузка ленивых компонентов → `beforeRouteEnter` входящих → `beforeResolve` → подтверждение (URL, `currentRoute`) → `afterEach` → обновление DOM → колбэки из `next` в `beforeRouteEnter`. `beforeEnter` срабатывает только при входе в запись, не при смене `params`, `query` или `hash`. `beforeRouteEnter` идёт после загрузки, потому что объявлен в загружаемом компоненте, и `this` в нём ещё нет.
:::

::: details Что может вернуть guard и почему next устарел
Ничего или `true` — пропустить; `false` — отменить и вернуть URL к `from`; location — отменить и начать новую навигацию с тем же `from`, она снова пройдёт все guards; исключение — отмена, отклонение `push` и `router.onError`. `next` с Vue Router 5.0.3 даёт предупреждение в dev: его нужно было вызвать ровно один раз в каждой ветке, а забытый или двойной вызов давал зависшую или сломанную навигацию. Возврат значения из `async` функции проверяется типами и не забывается.
:::

::: details Как сделать авторизацию через роутер и что она не защищает
`meta: { requiresAuth: true }` на записи (она сливается вниз по вложенности) и один `beforeEach`: если маршрут требует входа, а сессии нет — вернуть `{ name: 'login', query: { redirect: to.fullPath } }`. `/login` не должен требовать входа, иначе редирект зациклится. В `redirect` кладут только внутренний путь (open redirect). Guard — это UX: код страницы скачивается по прямому URL, и API должен сам проверять сессию на каждом запросе.
:::

::: details Как router.push сообщает, что перехода не было
Промис `push` разрешается, а не отклоняется: `undefined` при успехе или `NavigationFailure` при отмене. Типы: `aborted` — guard вернул `false`, `cancelled` — новая навигация перебила эту, `duplicated` — уже на этом адресе. Проверка — `isNavigationFailure(result, NavigationFailureType.aborted)`. Отклоняется `push` только при исключении в guard или ошибке загрузки чанка. Редирект неудачей не считается, исходный адрес — в `route.redirectedFrom`. Глобально неудачи видны в третьем аргументе `afterEach`.
:::

::: details Почему маршрут нельзя объявить через defineAsyncComponent
Роутер ждёт функцию `() => import()` и вызывает её на шаге «загрузка ленивых компонентов», до `beforeRouteEnter` и подтверждения. Так страница появляется загруженной, а её guards выполняются. Async-компонент — уже компонент: роутер не знает, что его нужно ждать, переход подтверждается, страница грузится после, и in-component guards теряются. Vue Router 5 пишет об этом предупреждение `R0029`. Загрузчик вызывается один раз, результат сохраняется в записи.
:::

::: details Загружать данные до навигации или после
После: страница открывается сразу со скелетоном, данные — в `watch` с `immediate`, нужна обработка загрузки, ошибки и гонки при быстрой смене параметра. До: данные в `beforeResolve`/`beforeEnter`, страница появляется готовой, ошибку можно превратить в отмену или редирект, но пока идёт запрос, пользователь видит старую страницу, и нужен глобальный индикатор. Выбор — по UX: медленный API и частые переходы — «после», короткие запросы и нежелательное мигание — «до». Для «до» Vue Router предлагает experimental Data Loaders, в Nuxt — `useAsyncData`.
:::

## Задачи

### 1. Что выведет · средне

Пользователь на `/`. Компонент `User` переиспользует маршрут `/users/:id`, `Lazy` — ленивая страница.

```js
const routes = [
  { path: '/', component: Home },
  { path: '/users/:id', component: User, beforeEnter: (to) => log('beforeEnter ' + to.params.id) },
  { path: '/lazy', component: () => (log('load'), import('./Lazy.vue')) },
]
router.beforeEach((to) => log('beforeEach ' + to.path))
router.afterEach((to) => log('afterEach ' + to.path))
// User: beforeRouteEnter, onBeforeRouteUpdate, onBeforeRouteLeave, onMounted, onUnmounted
//       each logs its own name

await router.push('/users/1')
await router.push('/users/2')
await router.push('/lazy')
```

::: details Решение и разбор
```text
beforeEach /users/1
beforeEnter 1
beforeRouteEnter
afterEach /users/1
mounted
beforeEach /users/2
beforeRouteUpdate
afterEach /users/2
beforeRouteLeave
beforeEach /lazy
load
afterEach /lazy
unmounted
```

- `/users/1 → /users/2` — та же запись: нет `beforeEnter`, нет `mounted`, вместо них `beforeRouteUpdate`.
- `beforeRouteLeave` идёт **первым**, ещё до `beforeEach`.
- Загрузка чанка — после глобальных guards и `beforeEnter`: на `/lazy` его нет, поэтому сразу после `beforeEach`.
- `mounted` и `unmounted` — после `afterEach`: DOM обновляется после подтверждения навигации.
:::

### 2. Найдите баг · легко

Маршрут с числовым `id` перестал открываться: любой `/products/42` уходит на страницу 404.

```js
const routes = [
  { path: '/products/:id(\d+)', component: ProductPage },
  { path: '/:pathMatch(.*)*', component: NotFound },
]
```

::: details Решение и разбор
В обычной JS-строке `'\d'` — это просто `'d'`: неизвестная escape-последовательность теряет слеш. Роутер получает `/products/:id(d+)` и ждёт `d`, `dd`, … Проверка: `router.getRoutes()[0].path` — `'/products/:id(d+)'`.

```js
{ path: '/products/:id(\\d+)', component: ProductPage }
// or: path: String.raw`/products/:id(\d+)`
```

Ошибки не будет ни в консоли, ни у TypeScript: строка корректна, просто не та. Catch-all скрывает проблему: без него была бы видна пустая страница и dev-предупреждение `[VUE_ROUTER_R0004] No match found for location with path "/products/42"`.
:::

### 3. Найдите баг · средне

На странице заказа ссылки «следующий заказ» меняют URL, но заголовок показывает старый номер.

```vue
<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const { params } = useRoute()
const title = computed(() => `Order #${params.id}`)
</script>

<template><h1>{{ title }}</h1></template>
```

::: details Решение и разбор
`useRoute()` — `shallowReactive`-объект с геттерами к `currentRoute.value`. Реактивно только **чтение свойства** этого объекта. Деструктуризация в `setup` один раз читает `route.params` и сохраняет тот объект `params`. При навигации роутер кладёт в `currentRoute` новый маршрут с новым `params`, а старый объект не меняется, и `computed` ни на что не подписан.

```js
const route = useRoute()
const title = computed(() => `Order #${route.params.id}`)
```

Или `props: true` в записи и `defineProps<{ id: string }>()`: props реактивны, и компонент не зависит от роутера. Проверено: после перехода `/1 → /2` деструктурированный `params.id` остаётся `'1'`, `computed(() => route.params.id)` даёт `'2'`.
:::

### 4. Найдите баг · легко

После выхода из аккаунта переход никуда не происходит, в dev-консоли — «Detected a possibly infinite redirection in a navigation guard», а в production вкладка зависает.

```js
router.beforeEach((to) => {
  const auth = useAuthStore()
  if (!auth.user) return '/login'
})
```

::: details Решение и разбор
Редирект — новая навигация, и она снова проходит `beforeEach`. Для `/login` пользователь тоже не вошёл, guard снова возвращает `/login`, и так до бесконечности. Dev-сборка прерывает цикл после 30 повторов на ту же location: `push` отклоняется с `Infinite redirect in navigation guard`, пользователь остаётся на прежней странице. В production этой проверки нет.

```js
router.beforeEach((to) => {
  if (!to.meta.requiresAuth) return
  const auth = useAuthStore()
  if (!auth.user) return { name: 'login', query: { redirect: to.fullPath } }
})
```

Список «что защищать» (`meta.requiresAuth`) надёжнее списка «что не защищать»: новая публичная страница не окажется закрытой по ошибке. `redirect` в query сохраняет цель для возврата после входа — проверяйте, что это внутренний путь.
:::

### 5. Реализуйте очередь guards · сложно

Напишите `runGuards(guards, to, from)`, который выполняет guards по очереди, как Vue Router: `undefined`/`true` — дальше, `false` — отмена, строка или объект — редирект, исключение — ошибка. Верните `{ type: 'ok' | 'aborted' | 'redirect', location? }`. Затем `navigate(to)` с защитой от гонки: если пока выполнялись guards, началась другая навигация, вернуть `{ type: 'cancelled' }`.

::: details Решение и разбор
```js
async function runGuards(guards, to, from) {
  for (const guard of guards) {
    const result = await guard(to, from) // sync and async guards alike; throw propagates
    if (result === undefined || result === true) continue
    if (result === false) return { type: 'aborted' }
    if (typeof result === 'string' || (result && typeof result === 'object')) {
      return { type: 'redirect', location: result }
    }
    throw new Error(`Invalid navigation guard return: ${String(result)}`)
  }
  return { type: 'ok' }
}

function createNavigator(getGuards, commit, initial) {
  let current = initial
  let pending = null

  async function navigate(to, redirects = 0) {
    const from = current
    const token = (pending = {})
    const result = await runGuards(getGuards(to, from), to, from)
    if (pending !== token) return { type: 'cancelled' } // a newer navigation started
    if (result.type === 'redirect') {
      if (redirects > 30) throw new Error('Infinite redirect')
      return navigate(result.location, redirects + 1) // new navigation, same `from`
    }
    if (result.type === 'ok') {
      current = to
      commit(to) // update URL and currentRoute, then afterEach
    }
    return result
  }

  return { navigate }
}
```

- Guards выполняются **последовательно**: следующий видит только то, что пропустил предыдущий. Параллельный `Promise.all` нарушил бы семантику отмены и редиректа.
- Токен `pending` — то же, что `cancelled` у роутера: устаревшая навигация не коммитится, даже если её guards завершились позже.
- Редирект — рекурсивный вызов с тем же `from`: `current` до коммита не меняется.
- Чего нет по сравнению с Vue Router: деления на уходящие/обновляемые/входящие записи, загрузки компонентов между `beforeEnter` и `beforeRouteEnter`, `next`, отката URL при `popstate`, `afterEach` с `failure`.

Сложность: O(g) вызовов guards на навигацию, плюс по O(g) на каждый редирект.
:::

## Источники

- [Vue Router: Dynamic Route Matching (Reacting to Params Changes)](https://router.vuejs.org/guide/essentials/dynamic-matching.html)
- [Vue Router: Routes' Matching Syntax](https://router.vuejs.org/guide/essentials/route-matching-syntax.html), [Nested Routes](https://router.vuejs.org/guide/essentials/nested-routes.html), [Named Views](https://router.vuejs.org/guide/essentials/named-views.html), [History modes](https://router.vuejs.org/guide/essentials/history-mode.html)
- [Vue Router: Navigation Guards (The Full Navigation Resolution Flow)](https://router.vuejs.org/guide/advanced/navigation-guards.html), [Navigation Failures](https://router.vuejs.org/guide/advanced/navigation-failures.html)
- [Vue Router: Data Fetching](https://router.vuejs.org/guide/advanced/data-fetching.html), [Lazy Loading Routes](https://router.vuejs.org/guide/advanced/lazy-loading.html)
- [Vue Router: Scroll Behavior](https://router.vuejs.org/guide/advanced/scroll-behavior.html), [Typed Routes](https://router.vuejs.org/guide/advanced/typed-routes.html)
- [Vue Router: Migrating from v4 to v5](https://router.vuejs.org/guide/migration/v4-to-v5.html)
- [Исходники Vue Router: `packages/router/src` (`router.ts`, `RouterView.ts`, `navigationGuards.ts`, `matcher/`)](https://github.com/vuejs/router/tree/main/packages/router/src)
- [npm: vue-router (версии и даты релизов)](https://www.npmjs.com/package/vue-router?activeTab=versions)
- [Vite: Build Options (`build.rollupOptions`) и Load Error Handling](https://vite.dev/guide/build.html#load-error-handling)
