---
title: 'Pinia: сторы, getters, actions'
level: ядро
---

# Pinia: сторы, getters, actions

> **Коротко.** Pinia — тонкий слой над реактивностью Vue. `createPinia()` создаёт отвязанный effect scope, `ref({})` под состояние всех сторов и `Map` экземпляров, а `app.use(pinia)` отдаёт pinia через `app.provide`. `defineStore` ничего не создаёт: он возвращает функцию `useStore`, которая при первом вызове находит pinia (через `inject` или глобальную `activePinia`) и выполняет setup внутри своего effect scope. Стор — это `reactive`-объект: state — его `ref`, getters — `computed`, actions — функции в обёртке для `$onAction`. Отсюда все правила: деструктуризация теряет реактивность, getter с аргументом не кэшируется, внутренний вызов action в setup store не виден подписчикам, а `$reset` есть только у options store.

**Связанные темы:** [Реактивность: `ref`, `reactive`, `computed`](../vue/reactivity.md), [Как устроена реактивность](../vue/reactivity-internals.md), [`watch` и `watchEffect`](../vue/watchers.md), [Composables](../vue/composables.md), [Слоты и provide/inject](../vue/slots-and-provide-inject.md), [Плагины и обработка ошибок](../vue/plugins-and-error-handling.md), [TypeScript во Vue](../vue/typescript.md), [SSR и гидрация](../vue/ssr-and-hydration.md), [Данные и сеть](../architecture/data-and-network.md), [Утечки памяти](../performance/memory-leaks.md), [Pinia: плагины, SSR и тестирование](./pinia-advanced.md), [Архитектура состояния: локальное, глобальное, серверное](./state-architecture.md)

## Теория

Все фрагменты проверены на Pinia 4.1.0 (последняя версия на 2026-11-21) и Vue 3.5.45 в Node 26.13.1, SSR — через `@vue/server-renderer`, типы — `vue-tsc` 3.3 на TypeScript 6.0. Утверждения об устройстве взяты из `node_modules/pinia/dist/pinia.js`. Те же сценарии повторены на Vue `3.6.0-rc.16`, вывод совпал.

> [!NOTE]
> Pinia 4 ломает совместимость формально: пакет стал ESM-only, а `@vue/devtools-api` v8 — обязательной peer-зависимостью, её ставят рядом: `npm i pinia @vue/devtools-api`. Предупреждения переделаны в коды диагностики (`PINIA_R1004` и т. п.) с подсказкой и ссылкой. Pinia 3 убрала поддержку Vue 2 и форму `defineStore({ id })`. В 4.1 появился `getStores(pinia)` — массив созданных сторов.

### `createPinia` и как стор находит pinia

`createPinia()` возвращает обычный объект (под `markRaw`, чтобы Vue его не проксировал):

- `_e` — `effectScope(true)`, отвязанный scope. В нём живут все сторы этой pinia.
- `state` — `ref({})`. Ключ — id стора, значение — его state. Это единый источник правды: `store.$state` — геттер на `pinia.state.value[id]`.
- `_s` — `Map` id → экземпляр стора.
- `install(app)` выполняет `setActivePinia(pinia)`, `app.provide(piniaSymbol, pinia)` и кладёт `$pinia` в `globalProperties`. Pinia — обычный плагин и обычный `provide`, механизм разобран в темах [«Плагины»](../vue/plugins-and-error-handling.md) и [«provide/inject»](../vue/slots-and-provide-inject.md).

`useStore(pinia?)` ищет pinia в таком порядке: явный аргумент → `inject(piniaSymbol)`, если есть контекст инъекции (`setup()`, `app.runWithContext`) → глобальная `activePinia`. Найденную он делает активной. Если pinia нет нигде, в dev бросается ошибка `"getActivePinia()" was called but there was no active Pinia. Are you trying to use a store before calling "app.use(pinia)"?`.

Поэтому вне компонентов (router guard, обычный модуль) стор работает после `app.use(pinia)` — через `activePinia`. На клиенте это безопасно: pinia одна. На сервере `activePinia` — глобальная переменная модуля, общая для параллельных запросов, и Pinia 4 в dev пишет об этом диагностику `PINIA_R1004`: «falls back to the global activePinia, which exposes you to cross-request pollution on the server». Поэтому на сервере вне `setup` pinia передают явно: `useStore(pinia)`. Почему состояние на сервере не держат в модуле, разобрано в теме [«SSR и гидрация»](../vue/ssr-and-hydration.md).

### Стор создаётся лениво

`defineStore('cart', …)` только запоминает id и описание. Стор создаётся при **первом** вызове `useStore()` для данной pinia. Дальше `useStore()` возвращает тот же объект из `pinia._s` (проверено: setup выполнился один раз, `useStore() === useStore()`). Для другой pinia — другой экземпляр: так у каждого SSR-запроса свои сторы.

Создание в `createSetupStore` идёт так:

1. `store = reactive({ $id, $patch, $subscribe, $onAction, $reset, $dispose })` и сразу `pinia._s.set(id, store)` — **до** выполнения setup. Поэтому циклический вызов получает недостроенный стор (задача 4).
2. Setup выполняется внутри `app.runWithContext` → `pinia._e.run` → собственного `effectScope()` стора. `runWithContext` даёт работать `inject()` в setup store, а scope собирает `watch`, `computed` и `onScopeDispose`. Эффекты стора принадлежат pinia, а не компоненту, который первым вызвал `useStore`. Поэтому они не останавливаются при его размонтировании.
3. Возвращённые значения сортируются: `ref` (но не `computed`) или `reactive` — **state**, их кладут в `pinia.state.value[id]`; `computed` — **getter**; функция — **action**, её оборачивают; остальное копируется как есть.
4. Всё копируется в `store`. Стор — `reactive`, поэтому `store.count` разворачивает ref: это число, а не `Ref`.
5. Вызываются плагины, добавленные через `pinia.use` (о них — в теме [«Pinia: плагины, SSR и тестирование»](./pinia-advanced.md)).

### Options store и setup store

Options store описывают объектом `{ state, getters, actions }`, setup store — функцией, которая, как composable, возвращает refs, `computed` и функции (примеры обоих — ниже и в задачах). Options store — сахар над setup store. `createOptionsStore` собирает setup-функцию: вызывает `state()` (если в `pinia.state` ещё нет данных под этим id), берёт `toRefs(pinia.state.value[id])`, оборачивает каждый getter в `computed`, который вызывает его с `this = store`, и передаёт всё в тот же `createSetupStore`.

| | Options store | Setup store |
| --- | --- | --- |
| state | `state: () => ({…})` | `ref`, `reactive` |
| getters | `getters`, доступ через `state` или `this` | `computed` |
| actions | `actions`, `this` — стор | функции, состояние — через замыкание |
| `$reset()` | есть | нет: в dev бросает ошибку, в prod — пустая функция |
| watchers, composables, `inject` | нет | да |
| внутренний вызов action | `this.other()` — через обёртку, виден `$onAction` | `other()` — мимо обёртки, не виден |

**Что возвращать из setup store.** Весь state. Документация: «Not returning all state properties or making them readonly will break SSR, devtools, and other plugins». Невозвращённый `ref` не попадает в `pinia.state`: его не сериализует SSR, не видят devtools, плагины и `$subscribe` (задача 3). Приватного state в сторе нет. `computed` и функции можно не возвращать: они не состояние. Значения из `inject()` или `useRoute()` возвращать не нужно.

**Почему `$reset` только у options store.** У options store есть фабрика `state()`. `$reset` вызывает её заново и применяет результат через `$patch`. Setup-функцию повторно выполнить нельзя: она создаёт watchers и подписки. Поэтому в setup store `$reset` пишут сами и возвращают из setup. Он заменит встроенный и, как любая функция, станет action.

> [!TIP]
> Options store проще читать и стабить в тестах. Setup store нужен, когда в сторе работают composables (`useLocalStorage`, `useRoute`), watchers или `inject`. Это и есть критерий выбора, а не вкус.

### State

`state` — функция: каждая pinia (каждый SSR-запрос) получает свой объект. Все поля объявляют сразу, хотя бы как `null`: поле, добавленное после создания (`store.extra = 1`), не попадает в `$state` (проверено) и не сериализуется. Мутаций, как во Vuex, нет: state меняют прямо (`store.count++`), через `$patch` или в action.

`store.$state = { name: 'z' }` не заменяет объект состояния. Сеттер `$state` вызывает `$patch(s => Object.assign(s, value))`: указанные поля перезаписываются, остальные остаются (проверено: `items` сохранился, а объект `$state` тот же). Целиком состояние приложения задаётся через `pinia.state.value = …`. Так устроена гидратация, она разобрана в теме [«Pinia: плагины, SSR и тестирование»](./pinia-advanced.md).

### Getters

Getter options store превращается в `computed(() => getter.call(store, store))`: значение кэшируется до изменения зависимостей (проверено: повторное чтение не вызывает функцию). Внутри getter доступны другие getters через `this` и другие сторы: `const prices = usePrices()` прямо в теле getter. Getter, который зависит от другого стора, пересчитывается при его изменении.

Getter, который возвращает функцию (`byId: (s) => (id) => s.items.find(…)`), кэширует только саму функцию. Каждый вызов `store.byId(1)` выполняет поиск заново (проверено). Если нужен кэш по аргументу, getter строит `Map` и возвращает поиск по ней.

### Actions

Каждый action оборачивается функцией `wrappedAction`, которая:

1. делает pinia этого стора активной (`setActivePinia`), чтобы `useOtherStore()` внутри нашёл ту же pinia;
2. вызывает подписчиков `$onAction` с `{ name, store, args, after, onError }`;
3. вызывает функцию с `this`, равным стору;
4. если вернулся промис, вызывает `after` с результатом или `onError` с ошибкой. Синхронный `throw` тоже идёт в `onError`.

Отсюда следствия:

- Action можно деструктурировать (`const { inc } = store`): `this` и состояние берутся не из точки вызова. Стрелочная функция в `actions` options store `this` не получает: проверено, `this` там `undefined`.
- Асинхронный action — обычная `async`-функция. Флаги загрузки и ошибки хранят в state сами.
- В setup store action вызывает другой action через замыкание, мимо обёртки: `$onAction` видит только внешний вызов (проверено: `twice()`, вызывающий `inc()` дважды, дал одно событие). В options store `this.inc()` идёт через обёртку и виден. Хелпер `setup({ action })` (`defineStore('id', ({ action }) => …)`) оборачивает функцию явно. Исходники называют его редко нужным, «for advanced use cases like Pinia Colada».

### `storeToRefs` вместо деструктуризации

`const { count } = store` читает свойство `reactive` один раз и кладёт в переменную число без связи со стором. Почему так, разобрано в темах [«Реактивность»](../vue/reactivity.md) и [«Современный синтаксис»](../javascript/modern-syntax.md).

`storeToRefs(store)` проходит по `toRaw(store)` и берёт только реактивное. Для getter (`value.effect` — признак `computed`) он создаёт `computed` с `get: () => store[key]`, а для state (`ref`/`reactive`) — `toRef(store, key)`. Методы и `$`-поля пропускаются. Обычный `toRefs(store)` сделал бы refs из всего: `$patch`, `$subscribe`, actions, служебные `_hmrPayload` и `_p` (проверено). Actions берут прямо из стора. В типах ref getter только для чтения: `double.value = 3` — ошибка TS2540.

### `$patch` и `$subscribe`

`$patch` бывает двух видов:

- **объектом** — `store.$patch({ count: 1, user: { name: 'A' } })`: глубокое слияние plain-объектов (`mergeReactiveObjects`), массивы заменяются целиком;
- **функцией** — `store.$patch(state => { state.items.push(x) })`: для коллекций, которые объектом не выразить.

`$subscribe(cb, options)` — это `watch` с `deep: true` на `pinia.state.value[id]`, созданный в scope стора. Колбэк получает `mutation` (`type`: `'direct' | 'patch object' | 'patch function'`, `storeId`, `payload` — у `'patch object'`) и state. Механика `$patch`:

1. выставить флаги `isListening = isSyncListening = false` — watcher подписчиков будет молчать;
2. применить изменения;
3. **синхронно** вызвать всех подписчиков один раз с типом `patch …`;
4. вернуть `isSyncListening = true` сразу, а `isListening = true` — после `nextTick`.

Поэтому один `$patch` — одно событие и одна запись в devtools, сколько бы полей он ни менял. Прямые изменения (`'direct'`) идут через watcher. С `flush: 'pre'` (по умолчанию) несколько изменений в одном тике дают один вызов, с `flush: 'sync'` — вызов на каждое изменение (`push` — одна операция: Vue выполняет его в batch).

> [!WARNING]
> Прямое изменение и `$patch` в одном тике: подписчик с `flush: 'pre'` получит только `patch …`, а событие `direct` потеряется. Его watcher сработает до `nextTick` из `$patch`, пока `isListening` ещё `false` (задача 2). Для логирования и синхронизации, где важно каждое изменение, нужен `flush: 'sync'`.

Подписку снимает функция, которую вернул `$subscribe`. Если `$subscribe` вызван в активном scope (в `setup` компонента), подписка снимается при его остановке: `addSubscription` регистрирует `onScopeDispose`. `{ detached: true }` отключает это, и подписка живёт, пока не снимут вручную (проверено: после `scope.stop()` обычная подписка молчит, detached срабатывает). Pinia 4 игнорирует повторную подписку тем же колбэком (диагностика `PINIA_R1007`). Следить за всем состоянием приложения можно через `watch(pinia.state, cb, { deep: true })`.

### `$onAction` и `$dispose`

```js
const unsubscribe = store.$onAction(({ name, args, after, onError }) => {
  const start = performance.now()
  after((result) => log(name, 'ok', performance.now() - start)) // awaited for promises
  onError((error) => log(name, 'failed', error))
}, /* detached */ false)
```

Колбэк выполняется **до** тела action. `after` получает уже разрешённое значение промиса, `onError` — ошибку и при `throw`, и при reject. Ошибка после этого пробрасывается вызывающему. Применения — логирование, метрики, откат optimistic-обновления в `onError`. Привязка к scope и `detached` — как у `$subscribe`, только флаг — второй аргумент.

`store.$dispose()` останавливает scope стора (его watchers и `computed`), очищает подписки и удаляет стор из `pinia._s`. **State остаётся** в `pinia.state.value[id]`. Следующий `useStore()` создаст новый экземпляр и возьмёт это состояние, как при гидратации (проверено: `n` сохранился, новый стор — другой объект). Если `$dispose` вызвали у старой ссылки, когда уже создан новый стор, Pinia 4.1 предупреждает `PINIA_R1008`. Полный сброс — `disposePinia(pinia)`, он нужен в тестах.

> [!NOTE]
> Во Vue 3.6 (RC, сверено 2026-11-21 на `3.6.0-rc.16`) все проверки темы дали тот же вывод. Peer-зависимость Pinia `vue: ^3.5.11` не включает пре-релизы, поэтому npm требует `--legacy-peer-deps`.

### Сторы, использующие друг друга

Другой стор вызывают в начале setup или прямо в getter и action. Циклы разрешены, пока ни один из сторов не **читает** state другого во время своего setup. Чтение в `computed` или action безопасно: к моменту вызова оба стора достроены (проверено). Чтение в setup получает недостроенный стор без state: `undefined`, без ошибки (задача 4).

## Примеры

Setup store корзины с composable, другим стором и собственным `$reset`:

```ts
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { useCatalog } from './catalog'

interface CartLine { productId: number; qty: number }

export const useCart = defineStore('cart', () => {
  const catalog = useCatalog() // composing stores: call at the top
  const lines = ref<CartLine[]>([])
  const promo = useLocalStorage<string | null>('promo', null) // client-only: SSR needs skipHydrate()
  const status = ref<'idle' | 'saving' | 'error'>('idle')

  const total = computed(() =>
    lines.value.reduce((sum, l) => sum + catalog.priceOf(l.productId) * l.qty, 0))

  function add(productId: number) {
    const line = lines.value.find((l) => l.productId === productId)
    if (line) line.qty++
    else lines.value.push({ productId, qty: 1 })
  }

  async function checkout() {
    status.value = 'saving'
    try {
      await api.checkout(lines.value, promo.value)
      $reset()
    } catch (e) {
      status.value = 'error'
      throw e
    }
  }

  function $reset() {
    lines.value = []
    status.value = 'idle'
  }

  return { lines, promo, status, total, add, checkout, $reset } // all state is returned
})
```

```vue
<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useCart } from '@/stores/cart'

const cart = useCart()
const { lines, total, status } = storeToRefs(cart) // reactive refs
const { add, checkout } = cart // actions are bound to the store
</script>
```

Типизация выводится сама. В options store getter, который обращается к `this`, требует явного типа возврата. Без него TypeScript не может вывести тип `this` по кругу и выдаёт ошибки вроде `Property 'list' does not exist` (проверено `vue-tsc`):

```ts
export const useUsers = defineStore('users', {
  state: () => ({ list: [] as User[], selectedId: null as number | null }),
  getters: {
    count: (state) => state.list.length, // inferred from state
    selected(): User | undefined { // `this` needs an explicit return type
      return this.list.find((u) => u.id === this.selectedId)
    },
  },
  actions: { select(id: number) { this.selectedId = id } },
})
```

`$patch` типизирован по state: `cart.$patch({ status: 'done' })` — ошибка компиляции. Типы для свойств, добавленных плагинами, дописывают через module augmentation `PiniaCustomProperties` — пример в теме [«Система типов»](../typescript/type-system.md).

## Вопросы с интервью

::: details Как стор находит экземпляр pinia и почему useStore — composable
`app.use(pinia)` кладёт pinia в `app.provide` и запоминает как глобальную `activePinia`. `useStore()` берёт явный аргумент, иначе `inject` (если есть контекст инъекции), иначе `activePinia`. В `setup` pinia берётся из своего приложения, и поэтому несколько приложений и SSR-запросов не смешиваются. Вне компонентов работает fallback на `activePinia`: на клиенте это безопасно, на сервере это глобальная переменная, общая для запросов. Поэтому там pinia передают явно, `useStore(pinia)`, а Pinia 4 в dev выдаёт диагностику `PINIA_R1004`. Сам стор создаётся лениво при первом вызове, кладётся в `Map` этой pinia, и setup выполняется в effect scope pinia, а не компонента.
:::

::: details Options store или setup store: что выбрать
Options store — сахар над setup: Pinia собирает из `state`, `getters`, `actions` setup-функцию с `toRefs`, `computed` и обёрнутыми функциями. У него есть `$reset` (повторный вызов `state()`), а `this.other()` проходит через обёртку action и виден `$onAction` и тестовым стабам. Setup store — composable: в нём работают watchers, `inject`, `useRoute`, VueUse. Цена: нужно возвращать **весь** state (иначе его не увидят SSR, devtools, плагины и `$subscribe`), `$reset` пишется вручную, а вызовы actions через замыкание не перехватываются. Выбираю setup, когда в сторе нужны composables или watchers, иначе options.
:::

::: details Почему деструктуризация стора ломает реактивность и чем storeToRefs отличается от toRefs
Стор — `reactive`, и реактивность держится на чтении свойства через прокси. `const { count } = store` читает один раз и кладёт число в переменную. `storeToRefs` проходит по `toRaw(store)` и делает `toRef` для state и `computed` для getters, а методы и служебные `$`-поля пропускает. `toRefs` сделал бы refs из всего, включая `$patch` и actions. Actions деструктурируют прямо из стора: обёртка вызывает функцию с `this`, равным стору, независимо от того, как её вызвали.
:::

::: details Как кэшируются getters и когда кэша нет
Getter options store — `computed`, который вызывает функцию с `this = store`. Setup store использует `computed` напрямую. Значение пересчитывается только при изменении зависимостей, включая state других сторов, прочитанный в getter. Getter, который возвращает функцию (`byId(id)`), кэширует только функцию, а каждый вызов выполняется заново. Для частых вызовов строят `computed` с `Map` и возвращают поиск по ней. В TypeScript getter, использующий `this`, требует явного типа возврата.
:::

::: details Чем $patch объектом отличается от $patch функцией и почему присваивание $state не заменяет state
Объект глубоко сливается с state (plain-объекты рекурсивно, массивы и прочее заменяются), функция получает state и меняет его как угодно, например `push`. Оба вида дают одно событие подписчикам и одну запись в devtools: `$patch` глушит watcher подписок и вызывает их сам, синхронно, с типом `patch object` или `patch function`. Сеттер `store.$state` — это `$patch(s => Object.assign(s, value))`: объект состояния тот же, поля, которых нет в значении, остаются. Заменить состояние целиком можно только на уровне pinia: `pinia.state.value = …`, так работает гидратация.
:::

::: details Чем $subscribe отличается от watch на сторе и зачем flush и detached
`$subscribe` — тот же deep `watch` на `pinia.state.value[id]`, но с типом мутации и одним вызовом на `$patch`, сколько бы полей тот ни менял. С `flush: 'pre'` несколько прямых изменений в тике дают один вызов, а прямое изменение прямо перед `$patch` теряется. `flush: 'sync'` вызывает колбэк на каждое изменение. Подписка из `setup` снимается при размонтировании через `onScopeDispose`. `detached: true` оставляет её жить, например для синхронизации с `localStorage` на всё время приложения, и тогда снимать её — ответственность автора.
:::

::: details Как работает $onAction для асинхронных actions
Каждый action обёрнут. Обёртка делает pinia активной, вызывает подписчиков до тела action, выполняет его и, если вернулся промис, вызывает `after` с разрешённым значением или `onError` с причиной reject. Синхронный `throw` тоже идёт в `onError`, после чего ошибка пробрасывается. Так пишут логирование, метрики длительности, откат optimistic-обновлений. Ограничение setup store: внутренний вызов `inc()` через замыкание идёт мимо обёртки и не виден подписчикам. В options store `this.inc()` — через обёртку.
:::

::: details Чем Pinia отличается от Vuex и почему не хватает reactive в модуле
Pinia — официальная рекомендация, Vuex 3/4 поддерживаются без новых функций. Нет мутаций, только actions, в том числе асинхронные. Нет вложенных модулей и namespacing: сторы плоские и связываются импортом. Нет строковых ключей, типы выводятся. Сторы создаются лениво, бандлер выбрасывает неиспользуемые. Для Options API остались `mapStores`, `mapState`, `mapActions`. `export const state = reactive({})` в модуле работает на клиенте, но на сервере модуль один на процесс, и состояние утекает между запросами. Pinia держит сторы в экземпляре, созданном на приложение, и даёт devtools, плагины, `$subscribe` и SSR-сериализацию.
:::

## Задачи

### 1. Что выведет · легко

```js
const useCounter = defineStore('counter', () => {
  const count = ref(1)
  const double = computed(() => count.value * 2)
  function inc() { count.value++ }
  return { count, double, inc }
})

const store = useCounter()
const { count } = store
const { double } = storeToRefs(store)
const { inc } = store
inc()
console.log(count, double.value, store.count)
store.$patch({ count: 10 })
console.log(count, double.value)
```

::: details Решение и разбор
`1 4 2`, затем `1 20` (проверено).

- `count` — копия числа `1`, прочитанная из `reactive` до `inc()`. Связи со стором у неё нет.
- `double` из `storeToRefs` — `computed` с `get: () => store.double`, поэтому видит и `2 * 2`, и `10 * 2`.
- `inc` работает после деструктуризации: action обёрнут и меняет состояние через замыкание (в options store — через `this`, который обёртка подставляет сама).
:::

### 2. Что выведет · средне

```js
const useTodos = defineStore('todos', { state: () => ({ items: [], filter: 'all' }) })
const todos = useTodos()
const log = []
todos.$subscribe((m) => log.push(`A:${m.type}`))
todos.$subscribe((m) => log.push(`B:${m.type}`), { flush: 'sync' })

todos.items.push('a')
todos.filter = 'done'
todos.$patch((s) => { s.items.push('b'); s.filter = 'all' })
log.push('tick')
await nextTick()
await nextTick()
console.log(log.join(' '))
```

::: details Решение и разбор
`B:direct B:direct A:patch function B:patch function tick` (проверено).

- `B` с `flush: 'sync'` срабатывает на каждое прямое изменение: `push` и присваивание.
- `A` с `flush: 'pre'` поставил свой watcher в очередь на ближайший тик.
- `$patch` выставил `isListening = false`, применил изменения и **синхронно** вызвал обоих подписчиков: `A:patch function`, `B:patch function`. Флаг `isSyncListening` вернулся сразу, `isListening` вернётся в `nextTick().then(...)`.
- В тике сработал отложенный watcher `A`, но `isListening` ещё `false`, и событие `direct` пропало.

Вывод: если подписчику важна каждая запись (журнал, синхронизация), нужен `flush: 'sync'`. Для сохранения в `localStorage` хватает `pre`: колбэк получает актуальный state целиком.
:::

### 3. Найдите баг · средне

```js
export const useCart = defineStore('cart', () => {
  const items = ref([])
  const total = computed(() => items.value.reduce((s, p) => s + p.price, 0))
  function add(product) { items.value.push(product) }
  return { total, add } // items are "private"
})

// on logout
useCart().$reset()
```

Корзина работает, но при выходе из аккаунта она не очищается, в devtools пусто, а плагин персистентности ничего не сохраняет. Почему?

::: details Решение и разбор
Две ошибки, обе из-за того, что это setup store.

- `items` не возвращён, значит, это не state: `pinia.state.value.cart` — `{}` (проверено). Его не видят devtools, плагины и `$subscribe`, его не сериализует SSR. Приватного state в Pinia нет.
- `$reset` у setup store не реализован. В dev он бросает `Store "cart" is built using the setup syntax and does not implement $reset()`, а в production это пустая функция: корзина молча остаётся.

```js
export const useCart = defineStore('cart', () => {
  const items = ref([])
  const total = computed(() => items.value.reduce((s, p) => s + p.price, 0))
  function add(product) { items.value.push(product) }
  function $reset() { items.value = [] }
  return { items, total, add, $reset }
})
```

Возвращённый `$reset` заменяет встроенный и сам становится action: его видит `$onAction` (проверено). Если state нужно защитить от записи снаружи, это делают соглашением и линтером, а не скрытием.
:::

### 4. Найдите баг · средне

```js
export const useUser = defineStore('user', () => {
  const settings = useSettings()
  const name = ref('Ann')
  const greeting = ref(`${settings.locale}: hi, ${name.value}`)
  return { name, greeting }
})

export const useSettings = defineStore('settings', () => {
  const user = useUser()
  const locale = ref('en')
  const title = ref(`${user.name}'s settings`)
  return { locale, title }
})
```

Компонент вызывает `useUser()` и видит `greeting` — `"en: hi, Ann"`, но `useSettings().title` — `"undefined's settings"`. Ошибок в консоли нет. Почему и как исправить?

::: details Решение и разбор
`useUser()` кладёт свой стор в `pinia._s` **до** выполнения setup. Setup `user` вызывает `useSettings()`, тот создаётся и в своём setup вызывает `useUser()`. В `_s` уже есть `user`, и возвращается недостроенный стор: только `$id`, `$patch`, `$subscribe` и другие `$`-методы, без `name` (проверено: ключи и `undefined`). `title` вычисляется один раз из `undefined`. Если бы на этом месте было число, получился бы `NaN`.

Исправление — не читать state другого стора во время setup, а читать лениво:

```js
const title = computed(() => `${user.name}'s settings`)
```

К моменту чтения `computed` оба стора достроены. Чтение в action тоже безопасно. Если циклу не место по смыслу, общую часть выносят в третий стор, от которого зависят оба.
:::

### 5. Реализуйте упрощённый defineStore · сложно

Напишите `createMiniPinia()` и `defineMiniStore(id, setup)` для setup stores:

- стор создаётся лениво, один на pinia, разные pinia (SSR-запросы) не делят state;
- pinia ищется через `inject`, а вне компонентов — через последнюю активную;
- state (не `computed`) собирается в `pinia.state.value[id]`;
- эффекты стора живут в scope pinia, а `$dispose()` их останавливает.

::: details Решение и разбор
```js
import { effectScope, hasInjectionContext, inject, isReactive, isRef, markRaw, reactive, ref } from 'vue'

const piniaKey = Symbol('mini-pinia')
let activePinia

export function createMiniPinia() {
  const scope = effectScope(true) // detached: owned by the app, not a component
  const pinia = markRaw({
    _s: new Map(),
    _e: scope,
    state: scope.run(() => ref({})),
    install(app) {
      activePinia = pinia
      app.provide(piniaKey, pinia)
    },
  })
  return pinia
}

export function defineMiniStore(id, setup) {
  return function useStore(pinia) {
    pinia ||= (hasInjectionContext() && inject(piniaKey, null)) || activePinia
    if (!pinia) throw new Error('No active pinia: call app.use(pinia) first')
    activePinia = pinia
    if (!pinia._s.has(id)) {
      const store = reactive({ $id: id })
      pinia._s.set(id, store) // before setup: cycles get a partial store
      const scope = pinia._e.run(() => effectScope())
      const result = scope.run(setup)
      const state = (pinia.state.value[id] = {})
      for (const [key, value] of Object.entries(result)) {
        if (typeof value === 'function') {
          result[key] = (...args) => { activePinia = pinia; return value(...args) }
        } else if ((isRef(value) && !value.effect) || isReactive(value)) {
          state[key] = value
        }
      }
      Object.assign(store, result)
      store.$dispose = () => { scope.stop(); pinia._s.delete(id) }
    }
    return pinia._s.get(id)
  }
}
```

Проверено через `renderToString`: два «запроса» со своими pinia дали `alice:1/2` и `bob:2/4`, а `pinia.state.value` у каждого — свой `{ counter: { n } }`. После `$dispose()` watcher стора перестал срабатывать, а следующий `useStore()` вернул новый объект.

`markRaw` не даёт pinia стать прокси внутри реактивных объектов. `effectScope(true)` у pinia и вложенный scope у стора отвязывают эффекты стора от компонента, который первым его вызвал. Регистрация в `_s` до setup повторяет поведение Pinia в циклах (задача 4). `!value.effect` отличает `computed` от `ref`, как `isComputed` в исходниках.

Чего нет по сравнению с Pinia: setup не выполняется в `app.runWithContext`, поэтому `inject()` внутри стора не работает. Нет `$patch`, `$subscribe`, `$onAction`, гидратации из существующего `pinia.state` и плагинов. Гидратацию добавляют одной проверкой: если `pinia.state.value[id]` уже есть, присвоить его значения в возвращённые ref.

Сложность: O(k) на создание стора из k свойств, O(1) на повторный `useStore()`.
:::

## Источники

- [Pinia: Defining a Store](https://pinia.vuejs.org/core-concepts/)
- [Pinia: State](https://pinia.vuejs.org/core-concepts/state.html), [Getters](https://pinia.vuejs.org/core-concepts/getters.html), [Actions](https://pinia.vuejs.org/core-concepts/actions.html)
- [Pinia: Using a store outside of a component](https://pinia.vuejs.org/core-concepts/outside-component-usage.html)
- [Pinia: Composing Stores](https://pinia.vuejs.org/cookbook/composing-stores.html), [Composables in stores](https://pinia.vuejs.org/cookbook/composables.html)
- [Pinia: Introduction — Comparison with Vuex](https://pinia.vuejs.org/introduction.html#Comparison-with-Vuex)
- [Исходники Pinia 4.1.0: `store.ts`, `createPinia.ts`, `rootStore.ts`, `storeToRefs.ts`, `subscriptions.ts`](https://github.com/vuejs/pinia/tree/v4.1.0/packages/pinia/src)
- [Pinia: релизы v4.0.0 и v4.1.0](https://github.com/vuejs/pinia/releases)
- [Vue.js: State Management](https://vuejs.org/guide/scaling-up/state-management.html)
- [Vuex: What is Vuex? (Pinia is now the new default)](https://vuex.vuejs.org/)
- [Находки «Pinia: актуальный API, setup stores, SSR в Nuxt»](https://github.com/alexrehtide/learning/blob/research/pinia/research/pinia.md)
