---
title: 'Состояние и конфигурация: `useState` vs Pinia, `runtimeConfig`'
level: ядро
---

# Состояние и конфигурация: `useState` vs Pinia, `runtimeConfig`

> **Коротко.** `useState(key, init)` — это `toRef` на `nuxtApp.payload.state['$s' + key]`. Состояние живёт в приложении, созданном на запрос, и уходит на клиент в payload, поэтому оно не протекает между пользователями и не теряется при гидрации. Цена — значение обязано сериализоваться. Pinia в Nuxt работает так же: `@pinia/nuxt` создаёт pinia на запрос и кладёт её state в тот же payload. `runtimeConfig` задаётся в `nuxt.config`, а переопределяется переменными `NUXT_*` при старте сервера. На клиент уходит только `public`. `app.config.ts` — код в бандле: реактивный, с HMR, но без переменных окружения и без секретов.

**Связанные темы:** [Работа с данными: `$fetch`, `useFetch`, `useAsyncData`](./data-fetching.md), [Middleware и плагины](./middleware-and-plugins.md), [Структура проекта и auto-imports](./project-structure.md), [Pinia: сторы, getters, actions](../state-management/pinia.md), [Pinia: плагины, SSR и тестирование](../state-management/pinia-advanced.md), [Архитектура состояния: локальное, глобальное, серверное](../state-management/state-architecture.md), [SSR и гидрация](../vue/ssr-and-hydration.md), [Реактивность: `ref`, `reactive`, `computed`](../vue/reactivity.md), [Composables](../vue/composables.md), [Модули: ESM и CommonJS](../javascript/modules.md), [Утечки памяти](../performance/memory-leaks.md), [XSS и безопасный вывод во Vue](../security/xss.md), [Хранилища браузера](../network/browser-storage.md), [Режимы рендеринга и lazy hydration](./rendering-modes.md)

## Теория

Все фрагменты проверены на Nuxt 4.6.4 с Nitro 2.13.6, Vue 3.5.45, Pinia 4.1.0 и `@pinia/nuxt` 1.0.3 в Node 26.13.1. Ответы и payload сняты `curl` с `nuxi build` + `node .output/server/index.mjs`. Гидрация и предупреждения проверены в браузере через Playwright, на production-сборке и в `nuxi dev`. Типы проверены `nuxi typecheck` на TypeScript 6.0. Поведение Nuxt 5 проверено на 4.6.4 с `future.compatibilityVersion: 5`. Устройство описано по `node_modules/nuxt/dist/app/composables/state.js`, `app/nuxt.js`, `app/config.js`, `nitropack/dist/runtime/internal/config.mjs` и `utils.env.mjs`, `@pinia/nuxt/dist/`.

### Почему не `ref` на уровне модуля

Модуль выполняется один раз на процесс ([«Модули»](../javascript/modules.md)). В браузере процесс у каждого пользователя свой, а на сервере Nitro один процесс обслуживает всех. `export const count = ref(0)` в файле — одна переменная на всех пользователей. Это **cross-request state pollution** (загрязнение состояния между запросами). Проверено: страница с `moduleCount.value++` на трёх запросах подряд отрендерила `module=1`, `module=2`, `module=3`. Тот же счётчик через `useState` каждый раз давал `1`.

Nuxt создаёт `nuxtApp` на каждый запрос, и состояние должно жить в нём. Документация формулирует правило так: никогда не определять `const state = ref()` вне `<script setup>` или `setup()`. Общее состояние оформляют composable-обёрткой: `export const useCart = () => useState('cart', () => [])`.

### Как устроен `useState`

Исходник короткий, вот его суть:

```js
const key = '$s' + _key
const nuxtApp = useNuxtApp()
const state = toRef(nuxtApp.payload.state, key)
if (init) nuxtApp._state[key] ??= { _default: init }
if (state.value === undefined && init) {
  const initialValue = init()
  if (isRef(initialValue)) { nuxtApp.payload.state[key] = initialValue; return state }
  state.value = initialValue
}
return state
```

Отсюда следует всё поведение:

- **Хранилище — `payload.state`**, объект `reactive({})` внутри `nuxtApp`. В HTML ключ виден с префиксом: `{"$scount":6}` в `__NUXT_DATA__`.
- **`init` вызывается, только пока значения нет.** На клиенте значение приходит из payload до первого вызова, поэтому `init` при гидрации не выполняется.
- **Один ключ — одно состояние, первый `init` побеждает.** Проверено: `KeyA` вызвал `useState('shared', () => 'A')`, `KeyB` — тот же ключ с `() => 'B'`. Оба показали `A`.
- **`init` должен быть функцией.** Значение вместо функции бросает `NUXT_E7007`. Функция откладывает создание значения: на клиенте оно не нужно.
- **Ключ можно не писать.** Компилятор Nuxt допишет последним аргументом хэш файла и места вызова, как у `useAsyncData` ([«Работа с данными»](./data-fetching.md)). Такой ключ уникален для места вызова. Чтобы поделить состояние между файлами, нужен явный ключ. Поэтому своя функция с именем `useState` запрещена: компилятор трансформирует вызовы по имени.
- **Нужен контекст Nuxt.** `useNuxtApp()` внутри `useState` бросает `NUXT_E1001` вне `setup`, плагина или middleware и после `await` во вложенной функции. Подробно — в [«Middleware и плагины»](./middleware-and-plugins.md).

> [!WARNING]
> Код в `setup` выполняется дважды: на сервере и при гидрации. `useState` переносит **значение**, но не отменяет повторный побочный эффект. Проверено: на странице с `perRequest.value++` сервер отрендерил `state=1`, клиент получил из payload `1`, увеличил до `2`, и Vue сообщил `Hydration completed but contains mismatches`. Однократную инициализацию на сервере делают через `callOnce`: он помечает ключ в `payload.once`, и клиент функцию не повторит.

### Сериализуемость

Payload сериализует `devalue`. Документация пишет «будет сериализовано в JSON», но реально `devalue` шире JSON. `Date`, `Map`, `Set`, `ref`/`reactive` и циклические ссылки переживают передачу: проверено, `useState` с `Date`, `Set` и `Map` дал на клиенте `true true 1`.

Не переживают передачу функции и экземпляры классов. Ошибка возникает **на сервере при рендеринге**, и страница отвечает 500:

- `useState('fn', () => ({ fmt: n => n.toFixed(2) }))` → `DevalueError: Cannot stringify a function`, `path: '.state.$sfn.fmt'`;
- `useState('money', () => new Money(5))` → `Cannot stringify arbitrary non-POJOs`.

Класс можно научить сериализоваться: `definePayloadPlugin` с парой `definePayloadReducer` / `definePayloadReviver` (задача 5). Обычно проще хранить данные, а методы держать в composable.

Всё, что лежит в `useState`, попадает в HTML каждой страницы. Это объём, который клиент разбирает до гидрации ([«Производительность Vue и Nuxt»](../performance/vue-performance.md)), и это публичные данные. Токены и персональные данные других пользователей сюда класть нельзя.

> [!TIP]
> Для больших списков `init` может вернуть `shallowRef(list)`: значение ляжет в payload как ref, и Vue не станет делать его глубоко реактивным. Проверено: `list.value.push()` перерисовку не вызвал, нужна замена `list.value = [...]`. Документация обещает `isShallow(state) === true`, но в 4.6.4 `useState` возвращает обёртку `toRef`, и флаг равен `false`. Поэтому проверяйте поведение, а не флаг. В Nuxt 3 (3.21.11, по исходнику) первый вызов возвращал сам `shallowRef`, и флаг был `true`.

### `clearNuxtState`

`clearNuxtState(keys?)` удаляет ключи из `payload.state`: без аргумента удаляет все, принимает строку, массив или функцию-фильтр. В Nuxt 3 было иначе: ключ оставался со значением `undefined`, опции `reset` не было. Ссылки, полученные раньше, остаются связанными с тем же ключом. Они не «отвязываются», а читают `undefined`. Проверено: после `clearNuxtState('a')` старый `a.value` стал `undefined`, а следующий `useState('a', () => 2)` снова вызвал `init`, и оба ref показали `2`.

> [!NOTE]
> В Nuxt 5 (`compatibilityVersion: 5`; на npm 5.0 ещё нет, сверено 2026-11-22) `clearNuxtState` сбрасывает значение к результату `init` из первого `useState`, а не к `undefined`. Проверено на 4.6.4 с `future.compatibilityVersion: 5`: после очистки `a.value === 1`. Включить заранее — `experimental.defaults.useState.resetOnClear: true`, оставить старое поведение для одного вызова — `clearNuxtState('a', { reset: false })`.

### `useState` или Pinia

`@pinia/nuxt` 1.x решает ту же задачу тем же способом. Устройство Pinia и её гидрации — в темах [«Pinia: сторы, getters, actions»](../state-management/pinia.md) и [«Pinia: плагины, SSR и тестирование»](../state-management/pinia-advanced.md). Здесь важно, что модуль делает поверх них. По исходникам `@pinia/nuxt` 1.0.3:

- плагин `pinia` на каждый запрос вызывает `createPinia()`, `vueApp.use(pinia)` и отдаёт её как `$pinia`. На клиенте он присваивает `payload.pinia` в `pinia.state.value` до первого стора;
- хук `app:rendered` кладёт `toRaw(pinia).state.value` в `payload.pinia` и сбрасывает `activePinia`. В HTML это видно рядом с `useState`: `"state":{"$sviaState":…},"pinia":{"counter":{"n":…}}`;
- payload-плагин регистрирует reducer `skipHydrate`: помеченные значения в payload не попадают;
- auto-import `defineStore`, `storeToRefs`, `acceptHMRUpdate`, `usePinia` и всех экспортов из `storesDirs`. По умолчанию это `['stores']` относительно `app/` каждого слоя, в Nuxt 4 — `app/stores/`. Проверено: `useCounter` из `app/stores/counter.ts` работает без импорта;
- в dev — Vite-плагин, который сам дописывает `acceptHMRUpdate` в файлы сторов.

Ограничения сериализации у них общие: payload один.

> [!NOTE]
> В Nuxt 3 было иначе только в раскладке: сторы по умолчанию искались в `stores/` в корне проекта, `app.config.ts` тоже лежал в корне. В Nuxt 4 оба переехали в `app/` вместе с `srcDir` ([«Структура проекта»](./project-structure.md)). Модель `useState`, `runtimeConfig` и `app.config` та же, отличия в `useState` — во врезках выше.

| | `useState` | Pinia |
| --- | --- | --- |
| Что это | ref по ключу в payload | стор с state, getters, actions |
| Зависимость | встроен | модуль `@pinia/nuxt` |
| Логика рядом с данными | в своём composable | actions и getters в сторе |
| DevTools | вкладка Payload | вкладка Pinia: timeline, правка state |
| Плагины, `$subscribe`, `$reset` | нет | есть |
| Тесты | через `@nuxt/test-utils` | ещё и `createTestingPinia` |

Практическое правило: `useState` — для нескольких значений без логики (тема, открыт ли сайдбар, текущий пользователь из middleware). Pinia — когда у состояния есть операции, инварианты и много потребителей, то есть клиентское доменное состояние. Данные с сервера (списки, карточки) обычно не кладут ни туда, ни туда: это кэш `useFetch`/`useAsyncData` ([«Архитектура состояния»](../state-management/state-architecture.md)).

### `runtimeConfig`: что и когда фиксируется

`runtimeConfig` в `nuxt.config.ts` объявляет **ключи и значения по умолчанию**:

```ts
export default defineNuxtConfig({
  runtimeConfig: {
    apiSecret: '',                 // server only
    public: { apiBase: '/api' },   // server and client
  },
})
```

`nuxt.config.ts` выполняется в Node **при сборке**. Значения попадают в серверный бандл: в `.output/server/chunks/_/nitro.mjs` лежит объект `runtimeConfig` с `"envPrefix": "NUXT_"`. Поэтому `buildFlag: process.env.FEATURE_X` читает окружение машины сборки, а не сервера. Проверено: сборка с `FEATURE_X=on`, запуск с `FEATURE_X=runtime-value` дал `buildFlag: "on"`.

При старте Nitro проходит по объявленным ключам (`applyEnv`) и для каждого ищет переменную `NUXT_` + путь в `SCREAMING_SNAKE_CASE`: `apiSecret` → `NUXT_API_SECRET`, `public.apiBase` → `NUXT_PUBLIC_API_BASE`, `public.nested.a` → `NUXT_PUBLIC_NESTED_A`. Подходит и префикс `NITRO_`. Из устройства следует несколько правил, все проверены:

- **Переопределяются только объявленные ключи.** `NUXT_NEW_KEY=zzz` без `newKey` в конфиге ничего не дал. Поэтому ключ объявляют хотя бы пустой строкой.
- **Значение разбирает `destr`.** `NUXT_PUBLIC_FLAG=true` стало boolean `true`, `NUXT_API_SECRET='"0123"'` — строкой `"0123"` (без кавычек было бы числом `123`). Тип из конфига не проверяется: `NUXT_PUBLIC_FLAG=abc` дал строку `"abc"` при `flag: false` в конфиге, а сгенерированный тип по-прежнему `boolean`.
- **Объект можно подмешать JSON-ом.** `NUXT_PUBLIC_NESTED='{"c":3}'` слился с `{ a, b }`. Это единственный способ добавить необъявленный вложенный ключ.
- **`.env` читает только CLI** (`nuxi dev`, `build`, `generate`). `node .output/server/index.mjs` его не читает: переменные задаёт окружение запуска.

> [!NOTE]
> В Nuxt 5 (Nitro v3; сверено 2026-11-22 по руководству по обновлению) переменная приводится к типу значения из конфига, а не через `destr`. Если привести нельзя, сервер не стартует. На 4.6.4 с `compatibilityVersion: 5` этого нет: `abc` для boolean-ключа по-прежнему стал строкой. Там же: на сервере `useRuntimeConfig()` вызывается без `event`, а конфиг — один объект на все запросы.

### `runtimeConfig` на сервере и на клиенте

На сервере рендерер Nuxt получает конфиг через `useRuntimeConfig(event)`. В Nitro 2 это `klona` исходного объекта с применёнными переменными, своя копия на запрос. `useRuntimeConfig()` без `event` в серверном коде возвращает общий объект, глубоко замороженный `Object.freeze`. В серверных маршрутах документация советует передавать `event`.

На клиент уходит только `{ public, app }`: `nuxtApp.ssrContext.config` собирается из этих двух ключей и сериализуется отдельным скриптом:

```html
<script>window.__NUXT__.config={public:{apiBase:"https://api.example.com",flag:true,nested:{a:2,b:"x"}},app:{baseURL:"/",buildId:"…",buildAssetsDir:"/_nuxt/",cdnURL:""}}</script>
```

Значения приходят **из HTML, а не из бандла**. Поэтому один и тот же образ можно запускать с разными `NUXT_PUBLIC_*` без пересборки. В `.output/public/` значения приватных ключей не встречаются: проверено поиском по `dev-secret`.

**Как секрет всё-таки утекает.** Приватный ключ на клиенте — `undefined`, но тот же компонент сначала рендерится на сервере, где ключ есть. Проверено: шаблон <code v-pre>secret={{ config.apiSecret }}</code> отдал в HTML `secret=prod-secret`. Клиент отрендерил `secret=`, и гидрация сообщила о расхождении. В dev браузер дополнительно пишет `[NUXT_E1003] Could not access apiSecret. The only available runtime config keys on the client side are public and app.` Тип это не ловит: в `.nuxt/types/runtime-config.d.ts` поле `apiSecret: string` доступно везде. Другие пути утечки — положить секрет в `public`, в `useState`, в стор или в ответ API. Правило: приватный ключ читают только в `server/`, а клиенту отдают результат.

### `app.config.ts`

`app/app.config.ts` (в Nuxt 3 — в корне проекта) — обычный модуль, который **импортируется в бандл**. В `.nuxt/app.config.mjs` он подключается через `import cfg0 from ".../app/app.config.ts"` и `defuFn` со слоями. Отсюда его свойства:

- **Значения — в клиентском JS.** Документация прямо запрещает секреты: файл попадает в клиентский бандл.
- **Переменных окружения нет.** `process.env.FEATURE_X` в нём не подставляется при сборке. В клиентском бандле Vite превратил его в `{}.FEATURE_X`, а сервер прочитал переменную в рантайме. Проверено: сервер с `FEATURE_X=runtime-value` отрендерил `build=runtime-value`, клиент — `build=off`, и гидрация разошлась (задача 4). Типы это не ловят: с `@types/node` в проекте `process` в `app.config.ts` проходит `nuxi typecheck`.
- **Реактивен.** На клиенте `useAppConfig()` — это `reactive(__appConfig)`, `updateAppConfig()` делает глубокое слияние. Проверено: клик с `updateAppConfig({ theme: { color: 'red' } })` перерисовал страницу.
- **Своя копия на запрос.** На сервере `useAppConfig()` возвращает `klona(__appConfig)` в `nuxtApp`, поэтому изменение в одном запросе не видно другим.
- **HMR.** В dev модуль принимает горячее обновление и через `_replaceAppConfig` подменяет значения без перезагрузки.
- **Любые JS-значения.** Это код, поэтому в нём допустимы функции и другие несериализуемые значения. Но с Nuxt 3.3 файл используется и в Nitro: импортировать в него Vue-компоненты нельзя. В `server/` и `shared/` его ключи типизированы как `unknown`.

| | `runtimeConfig` | `app.config.ts` |
| --- | --- | --- |
| Как попадает на клиент | `public` — скриптом в HTML | в JS-бандле |
| Переменные окружения | да, `NUXT_*` при старте | нет |
| Секреты | да, вне `public` | нет |
| Реактивность на клиенте | да | да |
| HMR | нет | да |
| Несериализуемые значения | нет | да |
| Для чего | URL API, ключи, флаги окружения | тема, тексты, UI-настройки |

## Примеры

### Общее состояние через composable

```ts
// app/composables/useCurrentUser.ts
export interface User { id: number; name: string }

export const useCurrentUser = () => useState<User | null>('current-user', () => null)
```

```ts
// app/middleware/auth.global.ts
export default defineNuxtRouteMiddleware(async () => {
  const user = useCurrentUser()                  // before any await
  if (user.value) return
  const headers = useRequestHeaders(['cookie'])
  user.value = await $fetch<User | null>('/api/me', { headers }).catch(() => null)
})
```

Ключ один на весь проект, тип задан в одном месте. На клиенте `user.value` уже заполнен из payload, поэтому повторного `/api/me` нет. `useState` вызывается до `await`, чтобы не потерять контекст Nuxt.

### Секрет только на сервере

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    weatherKey: '',                       // NUXT_WEATHER_KEY
    public: { apiBase: '/api' },          // NUXT_PUBLIC_API_BASE
  },
})
```

```ts
// server/api/weather.get.ts
export default defineEventHandler(async (event) => {
  const { weatherKey } = useRuntimeConfig(event)
  const { city } = getQuery(event)
  return $fetch('https://weather.example.com/v1/now', { query: { city, key: weatherKey } })
})
```

Компонент вызывает `useFetch('/api/weather', { query: { city } })`. Ключ не покидает сервер, а в продакшене задаётся `NUXT_WEATHER_KEY` без пересборки.

### Pinia в Nuxt

```ts
// app/stores/cart.ts — auto-imported as useCart
export const useCart = defineStore('cart', () => {
  const items = ref<{ id: number; qty: number }[]>([])
  const count = computed(() => items.value.reduce((n, i) => n + i.qty, 0))
  function add(id: number) {
    const item = items.value.find((i) => i.id === id)
    item ? item.qty++ : items.value.push({ id, qty: 1 })
  }
  return { items, count, add }
})
```

```vue
<script setup lang="ts">
const cart = useCart()
await callOnce('cart', () => $fetch('/api/cart').then((items) => { cart.items = items }))
</script>
```

`callOnce` выполнит загрузку на сервере. State стора уйдёт в `payload.pinia`, и клиент запрос не повторит.

## Вопросы с интервью

::: details Почему в Nuxt нельзя хранить состояние в ref на уровне модуля
Модуль выполняется один раз на процесс, а серверный процесс Nitro обслуживает все запросы. Такой `ref` — одна переменная на всех пользователей: данные одного запроса появятся в HTML другого (cross-request state pollution), а значение растёт, пока жив процесс. Вдобавок клиент начнёт с начального значения, и гидрация разойдётся. Nuxt создаёт `nuxtApp` на запрос, и состояние должно жить в нём: `useState` хранит его в `nuxtApp.payload.state`, Pinia — в pinia, созданной на запрос. Модульные переменные допустимы для того, что не зависит от пользователя: константы, кэш форматтеров.
:::

::: details Как useState передаёт значение на клиент и почему init не вызывается при гидрации
`useState(key, init)` — это `toRef(nuxtApp.payload.state, '$s' + key)`. `init` вызывается, только если значение `undefined`. После рендеринга payload сериализуется `devalue` в `<script id="__NUXT_DATA__">`. На клиенте Nuxt разбирает его до создания приложения и копирует `state` в новый `payload.state`. Когда компонент снова вызывает `useState`, значение уже есть, и `init` пропускается. Отсюда два следствия: первый `init` для ключа побеждает, а побочные эффекты в `setup` выполняются дважды, их выносят в `callOnce`.
:::

::: details Что можно и что нельзя хранить в useState
Только то, что умеет сериализовать `devalue`: примитивы, обычные объекты и массивы, `Date`, `Map`, `Set`, `RegExp`, `BigInt`, циклические ссылки, `ref` и `reactive`. Функция даёт `Cannot stringify a function`, экземпляр класса — `Cannot stringify arbitrary non-POJOs`, и это 500 на сервере. Класс можно поддержать парой `definePayloadReducer`/`definePayloadReviver` в `definePayloadPlugin`. Кроме того, всё содержимое оказывается в HTML: никаких секретов и лишнего объёма.
:::

::: details Когда useState, а когда Pinia
Механизм у них один: состояние на запрос, передача через payload, одни ограничения сериализации. `useState` встроен и подходит для нескольких простых значений без логики. Pinia добавляет структуру: actions, getters, `$subscribe`, плагины, DevTools с timeline, `createTestingPinia`. Её берут, когда у состояния есть операции, инварианты и много потребителей. Серверные данные не кладут ни туда, ни туда: для них есть кэш `useFetch`/`useAsyncData` с ключами, перезапросом и инвалидацией.
:::

::: details Как runtimeConfig получает значения из переменных окружения
Nuxt собирает конфиг из `nuxt.config.ts` при сборке и вшивает его в серверный бандл. При старте Nitro проходит по объявленным ключам и для каждого ищет `NUXT_<ПУТЬ>` в `SCREAMING_SNAKE_CASE`, значение разбирает `destr`. Необъявленный ключ переменной не создать, поэтому ключи объявляют хотя бы пустыми. `process.env.X` прямо в `nuxt.config` фиксируется на сборке. `.env` читает только CLI, production-сервер берёт переменные из окружения. В Nuxt 5 переменные будут приводиться к типу значения из конфига, а при ошибке сервер не стартует.
:::

::: details Чем приватный ключ runtimeConfig отличается от public и как секрет может утечь
На клиент уходят только `public` и `app`: Nuxt сериализует их в `window.__NUXT__.config` в HTML, приватные ключи на клиенте равны `undefined`. Утечь секрет может через код, который выполняется и на сервере. Если компонент выводит `config.apiSecret` в шаблон, SSR запишет значение в HTML, а гидрация разойдётся. В dev Nuxt предупредит `NUXT_E1003`, типы не предупредят. Другие пути — положить секрет в `public`, в `useState`, в стор или вернуть его из API. Правило: приватные ключи читают только в `server/` через `useRuntimeConfig(event)`.
:::

::: details Чем app.config отличается от runtimeConfig
`app.config.ts` — модуль, импортированный в бандл. Значения известны на сборке, видны в клиентском JS, реактивны (`updateAppConfig`), обновляются через HMR и могут быть любыми JS-значениями. Переменных окружения в нём нет: `process.env` на клиенте превращается в `{}`, а на сервере читается в рантайме, и гидрация расходится. `runtimeConfig` задаётся при старте сервера через `NUXT_*`, умеет приватные ключи, без HMR, только сериализуемые значения. Тему и тексты UI кладут в `app.config`, URL API и ключи — в `runtimeConfig`.
:::

## Задачи

### 1. Что выведет · легко

Страница отрендерена production-сервером три раза подряд, каждый раз новым запросом `curl`. Что будет в HTML?

```ts
// app/lib/module-state.ts
export const moduleCount = ref(0)
```

```vue
<script setup lang="ts">
import { moduleCount } from '~/lib/module-state'
moduleCount.value++
const perRequest = useState('count', () => 0)
perRequest.value++
</script>
<template><p>module={{ moduleCount }} state={{ perRequest }}</p></template>
```

::: details Решение и разбор
```text
module=1 state=1
module=2 state=1
module=3 state=1
```

`moduleCount` — одна переменная на процесс, она растёт с каждым запросом любого пользователя. `useState` живёт в `nuxtApp.payload.state`, а `nuxtApp` новый на каждый запрос.

В браузере обе части сломаются по-разному. `moduleCount` на клиенте начнётся с `0` и станет `1`, а сервер отрендерил, например, `3`. `perRequest` придёт из payload равным `1`, `setup` снова увеличит его до `2`. Проверено: `module=1 state=2` и `Hydration completed but contains mismatches`. Инкремент «один раз на сервере» пишут через `callOnce`. Ещё лучше считать на сервере в обработчике.
:::

### 2. Найдите баг · средне

Конфиг API читается из окружения. Команда DevOps задала `API_URL=https://api.prod.example.com` на production-сервере. Клиент всё равно ходит на `http://localhost:8080`.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    public: { apiBase: process.env.API_URL ?? 'http://localhost:8080' },
  },
})
```

::: details Решение и разбор
`nuxt.config.ts` выполняется при сборке. `process.env.API_URL` прочитан на машине CI, где переменной не было, и `'http://localhost:8080'` вшит в серверный бандл как значение по умолчанию. При старте Nitro ищет только `NUXT_PUBLIC_API_BASE`, а `API_URL` для него ничего не значит. Проверено тем же механизмом: сборка с `FEATURE_X=on`, запуск с другим `FEATURE_X` — в конфиге осталось `on`.

```ts
export default defineNuxtConfig({
  runtimeConfig: {
    public: { apiBase: 'http://localhost:8080' },  // dev default
  },
})
```

На сервере задают `NUXT_PUBLIC_API_BASE=https://api.prod.example.com`. Значение подхватится при старте, придёт на клиент в `window.__NUXT__.config`, и пересборка не понадобится. Если имя переменной менять нельзя, то `API_URL` переименовывают при запуске: `NUXT_PUBLIC_API_BASE=$API_URL node .output/server/index.mjs`.
:::

### 3. Найдите баг · средне

Страница показывает статус интеграции. Что не так?

```vue
<script setup lang="ts">
const config = useRuntimeConfig()
const connected = computed(() => Boolean(config.paymentsKey))
</script>
<template>
  <p>Payments: {{ connected ? 'on' : 'off' }}</p>
  <small v-if="$route.query.debug">key: {{ config.paymentsKey }}</small>
</template>
```

::: details Решение и разбор
Две ошибки, и обе из-за того, что шаблон рендерится в двух средах.

1. **Утечка секрета.** На сервере `config.paymentsKey` есть. С `?debug=1` SSR запишет ключ прямо в HTML. Проверено на аналогичном шаблоне: ответ содержал `secret=prod-secret`. HTML кэшируют CDN и браузер, его видит любой, кто подставит параметр.
2. **Расхождение гидрации.** На клиенте приватного ключа нет (`undefined`), поэтому `connected` на сервере `true`, на клиенте `false`. Результат — `Hydration completed but contains mismatches`, в dev ещё `NUXT_E1003`.

TypeScript не поможет: в сгенерированном типе `paymentsKey: string` доступен везде.

```ts
// server/api/payments/status.get.ts
export default defineEventHandler((event) => ({
  connected: Boolean(useRuntimeConfig(event).paymentsKey),
}))
```

```vue
<script setup lang="ts">
const { data } = await useFetch('/api/payments/status')
</script>
<template><p>Payments: {{ data?.connected ? 'on' : 'off' }}</p></template>
```

Клиенту уходит только булево значение. Для отладки ключ смотрят в логах сервера, а не на странице.
:::

### 4. Что выведет · средне

Сборка без `FEATURE_X`, запуск с `FEATURE_X=on node .output/server/index.mjs`. Что покажет HTML от сервера и что будет после гидрации?

```ts
// app/app.config.ts
export default defineAppConfig({
  feature: process.env.FEATURE_X ?? 'off',
})
```

```vue
<template><p>feature={{ useAppConfig().feature }}</p></template>
```

::: details Решение и разбор
Сервер отрендерит `feature=on`, клиент — `feature=off`, и Vue сообщит о расхождении гидрации. Проверено: `build=runtime-value` в HTML, `build=off` на клиенте, `Hydration completed but contains mismatches`.

`app.config.ts` не вычисляется при сборке, его код целиком попадает в оба бандла. На сервере `process.env` — настоящее окружение процесса. В клиентском бандле Vite подставил `{}`: в `.output/public/_nuxt/*.js` виден фрагмент `` build:{}.FEATURE_X??`off` ``.

Значение из окружения должно идти через `runtimeConfig.public.feature` и `NUXT_PUBLIC_FEATURE=on`. Тогда сервер передаст его клиенту в `window.__NUXT__.config`, и обе стороны увидят одно и то же.
:::

### 5. Реализуйте сериализацию класса · сложно

`useState('price', () => new Money(5, 'EUR'))` отвечает 500: `Cannot stringify arbitrary non-POJOs`. Сделайте так, чтобы на клиенте `price.value` был экземпляром `Money` с рабочим `format()`.

```ts
// app/lib/money.ts
export class Money {
  constructor(public amount: number, public currency: string) {}
  format() { return `${this.amount.toFixed(2)} ${this.currency}` }
}
```

::: details Решение и разбор
```ts
// app/plugins/money-payload.ts
import { Money } from '~/lib/money'

export default definePayloadPlugin(() => {
  definePayloadReducer('Money', (value) => value instanceof Money && [value.amount, value.currency])
  definePayloadReviver('Money', ([amount, currency]) => new Money(amount, currency))
})
```

Reducer вызывается для каждого значения при сериализации payload. Если он вернул truthy, `devalue` записывает тип `"Money"` и сериализует возвращённые данные вместо объекта. В HTML это видно: `"$sprice":6},["Money",7],[8,9],5,"EUR"`. Reviver с тем же именем на клиенте восстанавливает экземпляр. Проверено: страница отрендерила `5.00 EUR true` на сервере и на клиенте, без расхождения гидрации.

Почему `definePayloadPlugin`, а не `defineNuxtPlugin`. В рантайме это одна и та же функция, но при сборке Nuxt ставит такому плагину порядок `user-revivers` (−40). Он раньше плагина `revive-payload` (−30), который оживляет payload на клиенте. Обычный плагин (0) зарегистрировал бы reviver слишком поздно. Так же Nuxt сам поддерживает `ref`, `reactive` и `NuxtError`, а `@pinia/nuxt` — `skipHydrate`.

Альтернатива проще: хранить в `useState` данные `{ amount, currency }`, а `format` держать в composable или утилите. Свой reducer оправдан, когда объект-значение проходит через всё приложение.
:::

## Источники

- [Nuxt 4: State Management](https://nuxt.com/docs/4.x/getting-started/state-management)
- [Nuxt 4: `useState`](https://nuxt.com/docs/4.x/api/composables/use-state), [`clearNuxtState`](https://nuxt.com/docs/4.x/api/utils/clear-nuxt-state), [`callOnce`](https://nuxt.com/docs/4.x/api/utils/call-once)
- [Nuxt 4: Runtime Config](https://nuxt.com/docs/4.x/guide/going-further/runtime-config), [`useRuntimeConfig`](https://nuxt.com/docs/4.x/api/composables/use-runtime-config)
- [Nuxt 4: Configuration — `runtimeConfig` vs `app.config`](https://nuxt.com/docs/4.x/getting-started/configuration)
- [Nuxt 4: `app.config.ts`](https://nuxt.com/docs/4.x/directory-structure/app/app-config), [`updateAppConfig`](https://nuxt.com/docs/4.x/api/utils/update-app-config)
- [Nuxt 4: `useNuxtApp` (`payload`, `definePayloadReducer`, `definePayloadReviver`)](https://nuxt.com/docs/4.x/api/composables/use-nuxt-app)
- [Nuxt 4: Upgrade Guide — Testing Nuxt 5](https://nuxt.com/docs/4.x/getting-started/upgrade)
- [Nuxt 3: State Management](https://nuxt.com/docs/3.x/getting-started/state-management)
- [Исходники Nuxt: `state.ts`, `config.ts`, `nuxt.ts`](https://github.com/nuxt/nuxt/tree/v4.6.4/packages/nuxt/src/app)
- [Исходники Nitro: `runtime/internal/config.ts`, `utils.env.ts`](https://github.com/nitrojs/nitro/tree/v2.13.6/src/runtime/internal)
- [Pinia: Nuxt](https://pinia.vuejs.org/ssr/nuxt.html), [исходники `@pinia/nuxt`](https://github.com/vuejs/pinia/tree/v4.1.0/packages/nuxt/src)
- [devalue](https://github.com/sveltejs/devalue)
- [Находки «Nuxt 3 → Nuxt 4: отличия, важные для интервью»](https://github.com/alexrehtide/learning/blob/research/nuxt-3-vs-4/research/nuxt-3-vs-4.md)
- [Находки «Pinia: актуальный API, setup stores, SSR в Nuxt»](https://github.com/alexrehtide/learning/blob/research/pinia/research/pinia.md)
- [Находки «Ключевые темы senior frontend-интервью»](https://github.com/alexrehtide/learning/blob/research/senior-interview-topics/research/senior-interview-topics.md)
