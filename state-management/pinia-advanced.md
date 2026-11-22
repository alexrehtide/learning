---
title: 'Pinia: плагины, SSR и тестирование'
level: ядро
---

# Pinia: плагины, SSR и тестирование

> **Коротко.** Плагин Pinia — функция, которую Pinia вызывает для каждого **нового** стора после `app.use(pinia)`, внутри effect scope этого стора. Возвращённый объект копируется в стор, а новый state добавляют в `store.$state`, иначе его не увидят SSR и devtools. На сервере у каждого запроса своя pinia, но `activePinia` — одна глобальная переменная, поэтому вне `setup` pinia передают явно, а сторы в action берут до первого `await`. Гидратация — это присваивание `pinia.state.value` до первого `useStore()`: стор при создании берёт готовое состояние вместо начального, а `skipHydrate` исключает client-only значения. В тестах — свежая pinia на каждый тест или `createTestingPinia`, которая через те же плагины подменяет actions шпионами.

**Связанные темы:** [Состояние и конфигурация: `useState` vs Pinia, `runtimeConfig`](../nuxt/state-and-config.md), [Pinia: сторы, getters, actions](./pinia.md), [SSR и гидрация](../vue/ssr-and-hydration.md), [Плагины и обработка ошибок](../vue/plugins-and-error-handling.md), [Composables](../vue/composables.md), [Система типов: структурная типизация, `type` и `interface`](../typescript/type-system.md), [TypeScript во Vue](../vue/typescript.md), [Утечки памяти](../performance/memory-leaks.md), [XSS и безопасный вывод во Vue](../security/xss.md), [debounce и throttle](../live-coding/debounce-throttle.md), [Хранилища браузера](../network/browser-storage.md), [Архитектура состояния: локальное, глобальное, серверное](./state-architecture.md), [Структура проекта и auto-imports](../nuxt/project-structure.md)

## Теория

Все фрагменты проверены на Pinia 4.1.0 (последняя на 2026-11-21), `@pinia/testing` 2.0.2, `@pinia/nuxt` 1.0.3 и Vue 3.5.45 в Node 26.13.1. SSR проверен через `@vue/server-renderer`, тесты — Vitest 5.1 с happy-dom, типы — `vue-tsc` 3.3 на TypeScript 6.0. Устройство описано по `node_modules/pinia/dist/pinia.js` и исходникам `@pinia/testing` и `@pinia/nuxt`. На Vue `3.6.0-rc.16` сценарии дали тот же вывод.

Как pinia создаёт сторы, ищет свой экземпляр и что такое `pinia.state`, разобрано в теме [«Pinia: сторы, getters, actions»](./pinia.md). Здесь — то, что строится поверх.

### Плагины: когда и где выполняются

`pinia.use(plugin)` кладёт плагин в массив `pinia._p`, но только если pinia уже установлена в приложение. До `app.use(pinia)` плагины ждут в отдельной очереди и переносятся в `_p` в `install`. Сам плагин вызывается в конце создания стора, один раз на стор:

```js
pinia._p.forEach((extender) => {
  const extensions = scope.run(() => extender({ store, app: pinia._a, pinia, options }))
  Object.assign(store, extensions)
})
```

Отсюда правила (все проверены):

- Плагин действует только на сторы, созданные **после** него и **после** `app.use(pinia)`. Стор, созданный раньше, плагин не получит никогда (задача 1). В unit-тесте с `setActivePinia(createPinia())` плагины не работают вовсе: приложения нет.
- Плагин выполняется в `scope.run` стора. `watch`, `computed` и `onScopeDispose` внутри плагина принадлежат стору и останавливаются его `$dispose()`.
- `options` — опции `defineStore`: для options store — объект целиком, для setup store — третий аргумент. Плюс `options.actions` с исходными функциями. Так плагин читает свои опции, например `persist` или `debounce` (задача 5).
- Возвращать объект лучше, чем присваивать: ключи возвращённого объекта Pinia в dev добавляет в `store._customProperties`, и devtools их показывают. После прямого `store.x = …` ключ в `_customProperties` добавляют вручную.
- Если плагин вернул нереактивный объект (роутер, клиент API), Pinia 4 в dev пишет `PINIA_R1006`: `storeToRefs()` его пропустит. Внешние объекты оборачивают в `markRaw`.

### Новый state из плагина

Свойство на сторе ещё не state. State — то, что лежит в `pinia.state.value[id]`: его сериализует SSR, видят devtools и `$subscribe`. Поэтому state кладут в `store.$state` и связывают со стором через `toRef`:

```js
pinia.use(({ store }) => {
  if (!Object.hasOwn(store.$state, 'hasError')) {
    store.$state.hasError = ref(false) // not hydrated yet: create
  }
  store.hasError = toRef(store.$state, 'hasError') // same ref on the store
})
```

Проверка `Object.hasOwn` нужна для гидратации: на клиенте `$state` уже содержит значение с сервера, и безусловный `ref(false)` его затёр бы. `$reset()` такой state не трогает (проверено: после `$reset` обычные поля вернулись к начальным, а поле плагина осталось), сбрасывать его плагин должен сам, обернув `store.$reset`.

### Типизация плагинов

Свойства и опции плагина описывают через module augmentation (механизм — в теме [«Система типов»](../typescript/type-system.md)):

- `PiniaCustomProperties` — свойства и методы на сторе;
- `PiniaCustomStateProperties<S>` — state плагина: попадает и в `store.x`, и в `store.$state.x`;
- `DefineStoreOptionsBase<S, Store>` — новые опции `defineStore`.

Имена параметров должны совпадать с объявлением в Pinia: `DefineStoreOptionsBase<State, Store>` даёт TS2428 «All declarations of 'DefineStoreOptionsBase' must have identical type parameters», и опция пропадает из типов (проверено). Пример — ниже.

### HMR

В Vite стор подключают к горячей замене вручную:

```js
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useCart, import.meta.hot))
}
```

`acceptHMRUpdate` берёт pinia из `hot.data`, находит существующий стор по id и вызывает новый `useStore(pinia, existingStore)`. Pinia строит стор заново в режиме `hot` и переносит в **тот же объект** новые actions и getters, а state сохраняет (`patchObject` сливает старые значения в новые). Проверено симуляцией: объект стора тот же, `items` сохранились, action вернул новый результат, новое поле `coupon` появилось в `pinia.state`. Если id в модуле изменился, Pinia пишет `PINIA_R1005` и вызывает `hot.invalidate()` — полную перезагрузку. В production `acceptHMRUpdate` возвращает пустую функцию. Официально поддержан только Vite.

`@pinia/nuxt` в dev добавляет Vite-плагин `pinia:auto-hmr-registration`: в каждый файл с `defineStore`, где ещё нет `acceptHMRUpdate`, он сам дописывает этот блок. В документации этого нет, видно в исходниках модуля.

### SSR: pinia на запрос и `activePinia`

Почему состояние на сервере нельзя держать в модуле, разобрано в теме [«SSR и гидрация»](../vue/ssr-and-hydration.md). Pinia решает это экземпляром на приложение: `createPinia()` вызывают в фабрике `createApp()` на каждый запрос, и сторы живут в `pinia._s` этого экземпляра.

Слабое место — `activePinia`. Это переменная модуля, общая для всех запросов. `useStore()` без контекста инъекции берёт pinia из неё, а каждый action при входе выставляет её заново (`setActivePinia(pinia)` в обёртке). Пока код синхронный, `activePinia` указывает на нужную pinia. После `await` параллельный запрос мог её перезаписать. Два правила:

1. **Вне `setup`** (router guard, `serverPrefetch`, серверный код) pinia передают явно: `useStore(pinia)`. В `serverPrefetch` Options API она есть в `this.$pinia`, `onServerPrefetch()` внутри `setup` работает без этого.
2. **В action все `useOtherStore()` — до первого `await`.** Проверено двумя параллельными «запросами»: `alice` и `bob` с задержкой 2 мс. Вызов `useUser()` после `await` вернул обоим стор `bob` (задача 2).

Pinia 4 в dev на сервере пишет `PINIA_R1004`, когда стор берёт pinia из глобальной переменной, а не из контекста. После `renderToString` `activePinia` продолжает держать pinia последнего запроса. `@pinia/nuxt` поэтому сбрасывает её в хуке `app:rendered`.

### Гидратация состояния

На сервере после рендера сериализуют `pinia.state.value`, на клиенте присваивают его **до первого** `useStore()`:

```js
// server, after renderToString
const state = devalue.uneval(pinia.state.value) // escapes </script>
// client entry, before mount and before any useStore()
pinia.state.value = window.__PINIA_STATE__
```

Сериализатор должен экранировать строки. `JSON.stringify` оставит `</script>` как есть, и строка из пользовательских данных закроет тег скрипта: это XSS. `devalue` (его использует Nuxt) выдаёт `</script>` (проверено). Подробно — в теме [«XSS»](../security/xss.md). Если состояние совместимо с JSON, документация советует `JSON.stringify` и `JSON.parse` ради скорости, но тогда экранирование — на вас.

Как стор подхватывает состояние, видно в `createSetupStore`: при создании `initialState = pinia.state.value[id]`.

- Options store не вызывает `state()`, если `initialState` есть, и берёт `toRefs` готового объекта.
- Setup store выполняет setup как обычно, затем каждому возвращённому `ref` присваивает `initialState[key]`, а `reactive` сливает (`mergeReactiveObjects`). Setup при этом выполняется, поэтому побочные эффекты setup на клиенте всё равно происходят.
- Стор, созданный **до** присваивания, не узнает о новом состоянии: `pinia.state.value = …` заменяет объект целиком, а стор держит refs старого (задача 3).

**`skipHydrate(ref)`** ставит на объект символ, и при создании стора `shouldHydrate` возвращает `false`: ref сохраняет своё клиентское значение. Применяется к client-only state setup store: `useLocalStorage`, данные из `window`. В чистом SSR это не исключает значение из сериализации, `JSON.stringify(pinia.state.value)` его содержит, оно лишь не применяется на клиенте (проверено). Для options store аналог — опция `hydrate(state, initialState)`, которая вызывается после создания стора и может переписать state.

### `@pinia/nuxt`

Подробно — в теме [«Состояние и конфигурация»](../nuxt/state-and-config.md). По исходникам модуля:

- runtime-плагин: `createPinia()`, `vueApp.use(pinia)`, `setActivePinia(pinia)`. На клиенте, если в `nuxtApp.payload.pinia` есть состояние, присваивает его в `pinia.state.value` до появления сторов; pinia доступна как `$pinia`;
- хук `app:rendered` на сервере: `payload.pinia = toRaw(pinia).state.value` и `setActivePinia(undefined)`. Payload сериализует Nuxt через `devalue`;
- payload-плагин регистрирует reducer `skipHydrate`: в Nuxt помеченные значения **не попадают** в payload вообще;
- автоимпорт `defineStore`, `storeToRefs`, `acceptHMRUpdate`, `usePinia()` и сторов из `storesDirs` (по умолчанию `stores` в `app/` каждого слоя, в Nuxt 4 — `app/stores`);
- плагины Pinia подключают через [плагин Nuxt](../nuxt/middleware-and-plugins.md#плагины-когда-и-в-каком-порядке): `defineNuxtPlugin(({ $pinia }) => { $pinia.use(myPlugin) })`.

> [!TIP]
> В Nuxt данные в стор загружают через `await callOnce('user', () => user.fetch())`: запрос выполнится на сервере, результат уйдёт на клиент вместе с state, и клиент не повторит запрос. Без `callOnce` вызов в `setup` сработает и на сервере, и при гидратации.

### Тестирование

**Unit-тест стора** — новая pinia перед каждым тестом, чтобы state не протекал между тестами:

```js
beforeEach(() => { setActivePinia(createPinia()) })
```

Если стор зависит от плагинов, pinia нужно установить в приложение: `createApp({}).use(pinia)`. Без этого плагины не применяются (проверено).

**Компонент со стором** — `createTestingPinia()` из `@pinia/testing`. Это обычная `createPinia()`, в `_p` которой сразу положены служебные плагины. Поэтому, в отличие от обычной pinia, они работают и без приложения:

- `initialState: { cart: { … } }` — частичный state по id, сливается при создании стора;
- `stubActions` (по умолчанию `true`) — каждый action заменяется шпионом `createSpy()` и не выполняется. `false` — шпион вызывает настоящий action. Массив имён или функция `(name, store) => boolean` — выборочно;
- `stubPatch`, `stubReset` — то же для `$patch` и `$reset`; шпионами они обёрнуты всегда;
- getters становятся записываемыми: `store.double = 100` подменяет значение, `store.double = undefined` возвращает вычисление (проверено);
- `createSpy` — фабрика шпионов: `vi.fn`, а не `vi.fn()`. Без неё работает только при глобальных `vi`/`jest`, иначе `PINIA_TESTING_C0001`; с `vi.fn()` — `Invalid "createSpy" option`;
- `fakeApp: true` создаёт пустое приложение, чтобы плагины из опции `plugins` сработали в unit-тесте стора.

Пока активна тестовая pinia, `useStore(otherPinia)` в `NODE_ENV=test` игнорирует явный аргумент и использует тестовую (проверено). Так сторы, которые код получает с явной pinia, тоже попадают под стабы.

> [!WARNING]
> Ограничение setup store: стаб заменяет `store.inc`, но `twice()`, вызывающий `inc()` через замыкание, обращается к исходной функции. Шпион `inc` не увидит этих вызовов, а при `stubActions: true` их нельзя отключить. В options store `this.inc()` идёт через стор и через шпиона (задача 4).

> [!NOTE]
> В Nuxt-тестах (`@nuxt/test-utils`) приложение и pinia общие для файла, и state протекает между тестами. Документация советует задавать state через `$patch` или в `beforeEach` вызывать `$dispose()` у сторов и удалять их state из `pinia.state.value`.

## Примеры

Плагин персистентности: опция стора, state плагина и метод, с типами (проверено `vue-tsc` и в happy-dom):

```ts
// plugins/persist.ts
import type { PiniaPluginContext } from 'pinia'
import { ref, toRef } from 'vue'

declare module 'pinia' {
  export interface DefineStoreOptionsBase<S, Store> {
    persist?: { key?: string }
  }
  export interface PiniaCustomProperties {
    $clearPersisted: () => void
  }
  export interface PiniaCustomStateProperties<S> {
    restored: boolean
  }
}

export function persistPlugin({ store, options }: PiniaPluginContext) {
  if (!Object.hasOwn(store.$state, 'restored')) {
    ;(store.$state as any).restored = ref(false) // keep the server value on the client
  }
  ;(store as any).restored = toRef(store.$state, 'restored')

  if (!options.persist || typeof localStorage === 'undefined') return // SSR: no storage
  const key = options.persist.key ?? `pinia:${store.$id}`
  const saved = localStorage.getItem(key)
  if (saved) {
    store.$patch(JSON.parse(saved))
    store.restored = true
  }
  store.$subscribe((_mutation, state) => {
    localStorage.setItem(key, JSON.stringify(state))
  }, { detached: true }) // lives as long as the store, not the first component

  return { $clearPersisted: () => localStorage.removeItem(key) }
}
```

```ts
const pinia = createPinia().use(persistPlugin) // applied after app.use(pinia)

export const useCart = defineStore('cart', () => {
  const items = ref<string[]>([])
  return { items }
}, { persist: { key: 'cart' } }) // setup store: options are the third argument
```

> [!WARNING]
> При SSR такой плагин на клиенте подменит гидратированное состояние до монтирования: разметка с сервера и состояние разойдутся (hydration mismatch). В SSR-приложении восстановление из `localStorage` откладывают до монтирования: `onMounted` или хук Nuxt `app:mounted`.

Тест компонента с `createTestingPinia`:

```ts
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { vi } from 'vitest'

const wrapper = mount(Counter, {
  global: { plugins: [createTestingPinia({ createSpy: vi.fn, initialState: { counter: { n: 5 } } })] },
})
const counter = useCounter() // the testing pinia is active
await wrapper.find('button').trigger('click')
expect(counter.inc).toHaveBeenCalledTimes(1) // stubbed: n is still 5
counter.double = 42 // getters are writable in tests
await nextTick()
expect(wrapper.text()).toContain('42')
```

## Вопросы с интервью

::: details Как устроен плагин Pinia и почему он не подействовал на часть сторов
Плагин — функция `({ pinia, app, store, options }) => object | void`. Pinia вызывает её в конце создания каждого стора, внутри effect scope этого стора, и копирует результат в стор через `Object.assign`. Список плагинов наполняется только после `app.use(pinia)`: раньше они ждут в очереди. Поэтому плагин не подействует на стор, созданный до `pinia.use()` или до установки pinia в приложение, например в модуле при импорте или в unit-тесте без приложения. Эффекты плагина (`watch`, `onScopeDispose`) принадлежат стору и останавливаются его `$dispose()`. Опции стора плагин читает из `options`, у setup store это третий аргумент `defineStore`.
:::

::: details Как плагин добавляет state, чтобы он работал с SSR и devtools
Свойство на сторе — ещё не state. State — это `pinia.state.value[id]`, его сериализуют и показывают devtools. Плагин кладёт `ref` в `store.$state` и связывает со стором через `toRef(store.$state, key)`. Перед созданием проверяет `Object.hasOwn(store.$state, key)`: на клиенте там уже значение с сервера, и новый `ref` его затёр бы. `$reset` такой state не сбрасывает, это делает сам плагин. Тип описывают в `PiniaCustomStateProperties<S>`, свойства — в `PiniaCustomProperties`, опции — в `DefineStoreOptionsBase<S, Store>`; имена параметров должны совпадать с исходными.
:::

::: details Как Pinia защищает от cross-request state pollution и где эта защита заканчивается
На сервере модули общие для всех запросов, поэтому стор не синглтон модуля: `defineStore` возвращает функцию, а экземпляры живут в `pinia._s` конкретной pinia, созданной на запрос. В `setup` стор находит свою pinia через `inject`. Защита заканчивается на `activePinia`, глобальной переменной модуля: `useStore()` без контекста инъекции берёт pinia из неё, а параллельный запрос может её перезаписать. Отсюда правила: вне `setup` — `useStore(pinia)`, в async action — `useOtherStore()` до первого `await`. Pinia 4 в dev сообщает о fallback кодом `PINIA_R1004`, а `@pinia/nuxt` после рендера сбрасывает `activePinia` в `undefined`.
:::

::: details Как работает гидратация состояния Pinia и зачем skipHydrate
Сервер после рендера сериализует `pinia.state.value` экранирующим сериализатором (`devalue`), иначе строка `</script>` из данных пользователя даст XSS. Клиент присваивает его в `pinia.state.value` до первого `useStore()`. При создании стор смотрит в `pinia.state.value[id]`: options store не вызывает `state()`, setup store выполняет setup и переписывает возвращённые refs значениями с сервера. Стор, созданный раньше присваивания, останется со старыми refs. `skipHydrate(ref)` помечает client-only state (`useLocalStorage`), и стор его не перезаписывает. В Nuxt такие значения вообще не попадают в payload. Для options store аналог — опция `hydrate(state, initialState)`.
:::

::: details Как тестировать стор и компонент, который его использует
Стор тестируют как обычный модуль: `setActivePinia(createPinia())` в `beforeEach` дает свежее состояние каждому тесту. Если нужны плагины, pinia ставят в пустое приложение. Компонент монтируют с `createTestingPinia({ createSpy: vi.fn })` в `global.plugins`. Actions по умолчанию становятся шпионами и не выполняются, тест проверяет вызов, а не побочный эффект. State задают через `initialState`, getters в тестах записываемые. `stubActions` принимает массив или функцию, если часть actions должна работать. Ограничение: в setup store вызовы action через замыкание обходят шпиона.
:::

::: details Как Pinia сохраняет состояние при горячей замене модуля
В Vite файл стора вызывает `import.meta.hot.accept(acceptHMRUpdate(useStore, import.meta.hot))`. При изменении файла `acceptHMRUpdate` находит существующий стор в pinia и пересобирает его в режиме `hot`: в тот же объект переносятся новые actions и getters, а state сливается со старым, новые поля добавляются. Компоненты держат тот же объект, поэтому перерисовываются, не теряя данных. Если сменился id стора, выполняется полная перезагрузка. В Nuxt модуль `@pinia/nuxt` дописывает этот блок в файлы сторов сам, в production `acceptHMRUpdate` — пустая функция.
:::

## Задачи

### 1. Что выведет · легко

```js
const pinia = createPinia()
pinia.use(() => ({ tag: 'x' }))
setActivePinia(pinia)
const a = useA()
createApp({}).use(pinia)
const b = useB()
pinia.use(() => ({ late: true }))
const c = useC()
console.log(a.tag, b.tag, b.late, c.tag, c.late)
```

::: details Решение и разбор
`undefined x undefined x true` (проверено).

- `a` создан до `app.use(pinia)`: первый плагин ещё лежал в очереди. Позже его к `a` не применят: плагины вызываются только при создании стора.
- `b` создан после установки и получил `tag`. Плагин `late` добавлен позже, `b` его не получит.
- `c` получил оба плагина.

Вывод: плагины регистрируют рядом с `createPinia()`, а сторы не вызывают на уровне модуля.
:::

### 2. Найдите баг · средне

```js
export const useOrder = defineStore('order', {
  state: () => ({ owner: '' }),
  actions: {
    async create() {
      await api.reserve()
      const user = useUser()
      this.owner = user.name
    },
  },
})
```

На клиенте всё работает. Под нагрузкой SSR иногда записывает в заказ имя другого пользователя. Почему?

::: details Решение и разбор
`useUser()` вызван после `await`. В action нет контекста инъекции, поэтому стор берёт pinia из глобальной `activePinia`. Обёртка action выставила её при входе, но за время `await` параллельный запрос вызвал свой action и перезаписал её. Проверено: два параллельных запроса `alice` и `bob` получили `['bob', 'bob']`. После переноса вызова наверх — `['alice', 'bob']`.

```js
async create() {
  const user = useUser() // before the first await
  await api.reserve()
  this.owner = user.name
}
```

`this` в action — свой стор, и он не зависит от `activePinia`. Ломается только поиск **других** сторов. Тот же класс ошибки — `useStore()` без аргумента в router guard или серверном middleware. Pinia 4 в dev сообщает о нём кодом `PINIA_R1004`.
:::

### 3. Найдите баг · средне

```js
// entry-client.js
const pinia = createPinia()
const app = createSSRApp(App)
app.use(pinia)
const auth = useAuth(pinia) // check token early
if (!auth.token) router.replace('/login')
pinia.state.value = devalue.parse(window.__PINIA__)
app.mount('#app')
```

Сервер отрисовал страницу пользователя, но клиент перекидывает на `/login`, а после этого `auth.token` остаётся пустым, хотя в devtools `$state.token` заполнен. Почему?

::: details Решение и разбор
Стор `auth` создан до гидратации и получил начальный state. `pinia.state.value = …` заменяет объект состояния целиком, а стор держит refs старого объекта. Проверено: после такого присваивания `store.name` — `""`, а `store.$state.name` — `"late"`. Геттер `$state` читает `pinia.state.value[id]` и видит новый объект, но свойства стора смотрят в старый. Запись `store.name = 'x'` идёт в старый объект и не попадёт в `$state`.

Исправление — гидратировать до любого `useStore()`:

```js
app.use(pinia)
pinia.state.value = devalue.parse(window.__PINIA__)
const auth = useAuth(pinia)
```

То же правило для плагинов Nuxt: состояние из payload присваивает `@pinia/nuxt` в своём плагине, и плагин, вызывающий `useStore()`, должен выполняться после него.
:::

### 4. Что выведет · средне

```js
const useSetup = defineStore('s', () => {
  const n = ref(0)
  function inc() { n.value++ }
  function twice() { inc(); inc() }
  return { n, inc, twice }
})
const useOptions = defineStore('o', {
  state: () => ({ n: 0 }),
  actions: { inc() { this.n++ }, twice() { this.inc(); this.inc() } },
})

createTestingPinia({ createSpy: vi.fn, stubActions: false })
const s = useSetup(); s.twice()
const o = useOptions(); o.twice()
console.log(s.n, s.inc.mock.calls.length, o.n, o.inc.mock.calls.length)
```

::: details Решение и разбор
`2 0 2 2` (проверено).

`createTestingPinia` через плагин присваивает `store.inc = createSpy(store.inc)`. В options store `twice` вызывает `this.inc()`, а `this` — стор, поэтому вызов проходит через шпиона: два вызова. В setup store `twice` вызывает `inc` из замыкания, то есть исходную функцию, и шпион её не видит, хотя `n` изменился. По той же причине `stubActions: ['inc']` не отключит `inc` внутри настоящего `twice` setup store.

Обход для setup store — вызывать другие actions через стор, `useSetup().inc()`, или проверять результат (state), а не вызовы.
:::

### 5. Реализуйте плагин debounce · сложно

Сторы объявляют опцию `debounce: { search: 300 }`. Плагин должен заменить указанные actions версиями с debounce, сохранить `$onAction` для реального вызова, не оставлять таймеров после `$dispose()` и работать с options и setup stores. Опция должна быть типизирована: ключи — только имена actions.

::: details Решение и разбор
```ts
import type { PiniaPluginContext, StoreActions } from 'pinia'
import { onScopeDispose } from 'vue'

declare module 'pinia' {
  export interface DefineStoreOptionsBase<S, Store> {
    debounce?: Partial<Record<keyof StoreActions<Store>, number>>
  }
}

export function debouncePlugin({ store, options }: PiniaPluginContext) {
  if (!options.debounce) return
  const timers = new Set<ReturnType<typeof setTimeout>>()
  onScopeDispose(() => timers.forEach(clearTimeout)) // plugin runs in the store's scope

  const wrapped: Record<string, (...args: unknown[]) => void> = {}
  for (const [name, ms] of Object.entries(options.debounce) as [string, number][]) {
    const action = store[name] as (...args: unknown[]) => unknown // already wrapped for $onAction
    let timer: ReturnType<typeof setTimeout> | undefined
    wrapped[name] = (...args) => {
      if (timer) { clearTimeout(timer); timers.delete(timer) }
      timer = setTimeout(() => { timers.delete(timer!); action(...args) }, ms)
      timers.add(timer)
    }
  }
  return wrapped
}
```

Проверено с фейковыми таймерами: три вызова `search` подряд дали один реальный вызов с последним аргументом и одно событие `$onAction` — `search(abc)`. Вызов перед `$dispose()` не выполнился. Опция `debounce: { a: 100 }`, где `a` — state, даёт ошибку типа.

- `store[name]` — уже обёрнутый action, поэтому `$onAction` срабатывает на реальный вызов, а не на каждое нажатие.
- `onScopeDispose` работает, потому что плагин выполняется в scope стора.
- Функции из плагина возвращаются, а не присваиваются: Pinia копирует их в стор, и devtools видят ключи.
- В setup store опция передаётся третьим аргументом, а внутренние вызовы через замыкание обходят debounce, как и любые обёртки стора.
- Сам приём debounce разобран в теме [«debounce и throttle»](../live-coding/debounce-throttle.md). Версия, возвращающая промис, потребовала бы решить, что получают отменённые вызовы.

Сложность: O(k) на создание стора из k опций, O(1) на вызов.
:::

## Источники

- [Pinia: Plugins](https://pinia.vuejs.org/core-concepts/plugins.html)
- [Pinia: Server Side Rendering](https://pinia.vuejs.org/ssr/), [Nuxt](https://pinia.vuejs.org/ssr/nuxt.html)
- [Pinia: Testing stores](https://pinia.vuejs.org/cookbook/testing.html)
- [Pinia: HMR](https://pinia.vuejs.org/cookbook/hot-module-replacement.html)
- [Pinia: Composing Stores — SSR и `await`](https://pinia.vuejs.org/cookbook/composing-stores.html), [Composables in stores — `skipHydrate`](https://pinia.vuejs.org/cookbook/composables.html)
- [Исходники Pinia 4.1.0: `store.ts`, `createPinia.ts`, `hmr.ts`, `rootStore.ts`](https://github.com/vuejs/pinia/tree/v4.1.0/packages/pinia/src)
- [Исходники `@pinia/testing`](https://github.com/vuejs/pinia/blob/v4.1.0/packages/testing/src/testing.ts) и [`@pinia/nuxt`](https://github.com/vuejs/pinia/tree/v4.1.0/packages/nuxt/src)
- [Vue.js: SSR — Cross-Request State Pollution](https://vuejs.org/guide/scaling-up/ssr.html#cross-request-state-pollution)
- [Nuxt: State Management](https://nuxt.com/docs/4.x/getting-started/state-management)
- [devalue](https://github.com/sveltejs/devalue)
- [Находки «Pinia: актуальный API, setup stores, SSR в Nuxt»](https://github.com/alexrehtide/learning/blob/research/pinia/research/pinia.md)
