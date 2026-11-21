---
title: 'Архитектура состояния: локальное, глобальное, серверное'
level: ядро
---

# Архитектура состояния: локальное, глобальное, серверное

> **Коротко.** Состояние делят не по типу данных, а по тому, **кто владеет истиной** и **кому оно нужно**. Локальное UI-состояние живёт в компоненте, URL-состояние — в адресе, черновик формы — в форме, данные с сервера — в кэше запросов, а в глобальный стор попадает только общее клиентское состояние: сессия, корзина, настройки. Производное не хранят, а вычисляют. Каждое значение должно иметь ровно один источник истины. Почти все антипаттерны — это копия, которая со временем расходится с оригиналом.

**Связанные темы:** [Pinia: сторы, getters, actions](./pinia.md), [Pinia: плагины, SSR и тестирование](./pinia-advanced.md), [Данные и сеть в System Design](../architecture/data-and-network.md), [Frontend System Design: фреймворк RADIO](../architecture/system-design-framework.md), [Структура большого проекта и Feature-Sliced Design](../architecture/large-project-structure.md), [Реактивность: `ref`, `reactive`, `computed`](../vue/reactivity.md), [Composables](../vue/composables.md), [Слоты и provide/inject](../vue/slots-and-provide-inject.md), [Props, emits и `v-model` на компонентах](../vue/props-emits-v-model.md), [Формы и валидация](../vue/forms-and-validation.md), [Vue Router](../vue/vue-router.md), [SSR и гидрация](../vue/ssr-and-hydration.md), [`watch` и `watchEffect`](../vue/watchers.md)

## Теория

Все фрагменты проверены на Pinia 4.1.0, Pinia Colada 1.4.9, Vue Router 5.5.1 и Vue 3.5.45 в Node 26.13.1 (DOM — happy-dom 21, SSR — `@vue/server-renderer`), типы — `vue-tsc` 3.3 на TypeScript 6.0. Устройство Pinia Colada описано по `node_modules/@pinia/colada/dist/index.mjs`. Сверено 2026-11-21. Те же сценарии повторены на Vue `3.6.0-rc.16`, вывод совпал.

### Виды состояния и где каждое живёт

Документация Vue вводит управление состоянием через две проблемы: несколько представлений зависят от одного состояния, и действия из разных представлений меняют одно состояние. Если ни одной из них нет, стор не нужен. Удобная классификация — по владельцу и времени жизни:

| Вид | Примеры | Владелец истины | Где живёт |
| --- | --- | --- | --- |
| Локальное UI | открыт ли дропдаун, наведение, активная вкладка виджета | компонент | `ref` в компоненте |
| URL | страница, сортировка, фильтры, открытая карточка | адресная строка | `route.query`, `route.params` |
| Форма | введённые значения, touched, ошибки | форма до отправки | локальный `reactive`/composable формы |
| Серверное | товары, профиль, лента | сервер | кэш запросов (Pinia Colada, TanStack Query, `useAsyncData` в Nuxt) |
| Общее клиентское | сессия, корзина до оформления, тема, фичефлаги | клиент | стор Pinia |
| Производное | итог корзины, отфильтрованный список, «можно ли отправить» | вычисляется из других | `computed`, getter |

Порядок вопросов при выборе: можно ли это **вычислить**? Должно ли оно **пережить перезагрузку и копирование ссылки**? Пришло ли с **сервера**? Нужно ли оно **далёким** друг от друга частям дерева? Стор — ответ только на последний вопрос.

> [!TIP]
> TanStack Query в разделе «Does TanStack Query replace client state?» показывает типичный итог: после выноса projects, teams, tasks и users в кэш запросов в глобальном сторе остались `themeMode` и `sidebarStatus`. Большой глобальный стор — обычно признак, что в нём лежит серверное состояние.

### Лестница подъёма: от `ref` до стора

Состояние поднимают ровно настолько, насколько нужно:

1. **`ref` в компоненте** — нужно одному компоненту.
2. **Props и emits** — нужно родителю и паре детей. Поток данных явный, отладка простая. Механика — в теме [«Props, emits и `v-model`»](../vue/props-emits-v-model.md).
3. **`provide`/`inject`** — нужно поддереву: составной компонент (`Tabs` и `Tab`), форма и поля, экземпляр виджета. Важное свойство — **у каждого поддерева свой экземпляр**: две формы на странице не делят состояние. Как это устроено — в теме [«Слоты и provide/inject»](../vue/slots-and-provide-inject.md).
4. **Composable** — переиспользуемая логика. Состояние внутри функции у каждого вызова своё. Состояние **на уровне модуля** — общий синглтон.
5. **Стор Pinia** — общее клиентское состояние всего приложения.

Ступени 4 и 5 часто путают: «зачем Pinia, если есть `export const state = reactive({})`?». Документация Pinia отвечает: для SPA это работает, но при SSR открывает уязвимость. Разница в том, **кому принадлежит** состояние:

| | Синглтон в модуле | Стор Pinia |
| --- | --- | --- |
| Экземпляр | один на процесс (на сервере — на всех пользователей) | один на `pinia`, то есть на приложение или SSR-запрос |
| SSR | cross-request state pollution | сериализация `pinia.state` и гидратация |
| Devtools, `$subscribe`, плагины | нет | есть |
| Сброс в тестах | вручную, через экспорт `reset` | `setActivePinia(createPinia())` |

Pinia — это и есть «синглтон», только привязанный к приложению: `app.provide` + отвязанный `effectScope` + `reactive`-объекты в `Map` (разбор — в теме [«Pinia: сторы, getters, actions»](./pinia.md)). В проверке два SSR-рендера подряд: первый логинит `alice`, второй — никого. Синглтон во втором рендере всё ещё показывает `alice`, стор — `null` (пример 1). Почему модульное состояние на сервере опасно, подробно разобрано в теме [«Composables»](../vue/composables.md).

### Серверное состояние — это кэш

Данные с сервера — копия чужой истины. Она устаревает без ведома клиента, приходит асинхронно и может упасть. Поэтому ей нужны ключ, свежесть (`staleTime`), сборка мусора (`gcTime`), дедупликация, инвалидация и stale-while-revalidate. Всё это подробно разобрано в теме [«Данные и сеть в System Design»](../architecture/data-and-network.md). Здесь важен архитектурный вывод: `products = ref([])` плюс `fetchProducts()` в action — это кэш, написанный вручную и без всех этих свойств.

Кэширующий слой не заменяет Pinia, он стоит рядом или поверх. Pinia Colada 1.4 — буквально стор Pinia:

- `useQueryCache` — это `defineStore('_pc_query', …)`. После первого `useQuery` в `pinia._s` есть `_pc_query`, а в `pinia.state.value._pc_query` — поле `caches` (проверено).
- `caches` — `shallowRef(new Map())` под `skipHydrate`: записи гидратируются отдельной сериализацией, а не общим механизмом Pinia.
- Запись — `markRaw`-объект с `state` и `asyncStatus` в `shallowRef`, набором подписчиков `deps` и полем `pending`. Свежесть — геттер `stale`: `Date.now() >= when + staleTime`. Значения по умолчанию в исходниках: `staleTime: 5e3`, `gcTime: 3e5`, `refetchOnWindowFocus`, `refetchOnReconnect`, `refetchOnMount` — `true`.
- **Дедупликация** — в `refresh`: если запись устарела, а запрос уже идёт, возвращается `entry.pending.refreshCall`. Два компонента с ключом `['user', 1]` вызвали `query` один раз (проверено).
- Для сравнения, TanStack Query (`@tanstack/vue-query` 5.108): та же модель, свой `QueryClient`, без Pinia. В Nuxt часть этой роли берут `useAsyncData` и `useFetch`.

### URL как состояние

Всё, что должно пережить перезагрузку, открываться по ссылке и работать с кнопкой «Назад», живёт в URL: страница, сортировка, фильтры, поисковый запрос, открытая модалка с карточкой. Источник истины — `route.query`. Компонент читает его через `computed`, а пишет через `router.push` или `router.replace`.

Типичная ошибка — скопировать query в стор при монтировании. Компонент страницы при смене query **не пересоздаётся** (почему — в теме [«Vue Router»](../vue/vue-router.md)), поэтому копия остаётся старой. В проверке после перехода на `?page=2` и `router.back()` копия в сторе всё время равна `1`, а `computed` над `route.query` показал `2`, потом `1` (задача 3).

> [!TIP]
> `router.replace` — для частых изменений (поиск по мере ввода): иначе история заполнится промежуточными состояниями. `router.push` — для шагов, к которым пользователь вернётся кнопкой «Назад» (страница, фильтр).

### Формы

Черновик формы — локальное состояние: он принадлежит форме, пока его не отправили. Форма редактирования берёт **снимок** данных (из props или кэша) и меняет его, а не сами данные: иначе пользователь правит профиль в шапке до нажатия «Сохранить». После успешной отправки инвалидируют кэш, а не синхронизируют копии вручную. Модель формы и снимок — в теме [«Формы и валидация»](../vue/forms-and-validation.md).

В стор черновик выносят, только когда он должен пережить навигацию: многошаговый мастер, корзина с полями доставки, черновик письма. Тогда это осознанное общее клиентское состояние, часто с персистентностью.

### Производные данные и нормализация

Всё, что вычисляется, не хранят. Отфильтрованный список, сумма корзины, «есть ли непрочитанные» — `computed` или getter. Сохранённая копия производного обновляется в каждом action, который меняет источник. Первый же action, который об этом забудет, оставит её устаревшей (задача 1). `computed` дешевле, чем кажется: он кэширует результат до изменения зависимостей ([как устроено](../vue/reactivity.md)).

Нормализация — тот же принцип для сущностей: каждая хранится один раз в `byId`, а списки хранят `id`. Представления строятся `computed`, поэтому изменение сущности видно везде сразу (пример 2). Нормализовать клиентский стор стоит, когда одна и та же сущность видна в нескольких местах и меняется на клиенте: редактор с деревом и панелью свойств, доска задач. Для серверных данных решение принимают на уровне кэша, компромисс разобран в теме [«Данные и сеть»](../architecture/data-and-network.md).

### Разбиение на сторы и связи между ними

Сторы режут **по доменам**, а не по страницам и не по техническим слоям: `useSessionStore`, `useCartStore`, `useEditorStore`. Признак хорошего разреза — стор меняется по одной причине. Стор «страницы» дублирует данные, общие для нескольких страниц. Один стор на всё приложение превращает любую правку в конфликт и тянет весь код в каждый тест.

Связи:

- **Направленные зависимости.** `cart` читает `session` (цены для залогиненного), но не наоборот. Если два стора нужны друг другу, общее часто стоит вынести в третий.
- **Циклы** Pinia разрешает, пока ни один стор не **читает** state другого во время своего setup: на этот момент другой стор ещё не достроен (механизм и задача — в теме [«Pinia: сторы, getters, actions»](./pinia.md)). Вызов `useOther()` в начале setup и чтение в `computed` или action безопасны.
- **Сценарии на несколько доменов** («оформить заказ»: корзина, сессия, кэш заказов) лучше держать в action одного стора или в composable-сценарии. Сторы не должны подписываться друг на друга через `watch`: цепочка неявных реакций плохо читается и плохо тестируется.

В Feature-Sliced Design сторы лежат в слое `entities` или `features` своего домена, а импорт между срезами одного слоя запрещён. Это и есть правило направленных зависимостей, только проверяемое линтером ([подробно](../architecture/large-project-structure.md)).

### Антипаттерны

- **Всё в глобальном сторе.** `isModalOpen`, значение инпута, состояние виджета. Состояние переживает компонент (модалка открыта при возврате на страницу), второй экземпляр виджета делит его с первым, а каждое изменение видно всему приложению.
- **Копия props, URL или кэша в сторе.** Два источника истины расходятся при первом же обновлении оригинала (задача 3).
- **Хранение производного.** См. выше и задачу 1.
- **Серверные данные как обычный state.** Флаги загрузки на каждый запрос, ручная инвалидация, данные прошлого пользователя после логаута, гонки ответов.
- **Стор как шина событий.** `lastEvent = ref(...)` и `watch` в подписчиках. Состояние — не событие: `watch` с `flush: 'pre'` склеивает изменения за тик, а одинаковое значение подряд не вызывает реакцию. События теряются (задача 2). Для событий есть emits, колбэки, `$onAction` или явный эмиттер.
- **Изменение state из любого места.** Pinia это разрешает, но правила домена («нельзя добавить больше 10 штук») должны жить в actions. Иначе их обходят прямой записью.

## Примеры

### 1. Синглтон модуля и стор при SSR

```js
import { createSSRApp, ref, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createPinia, defineStore } from 'pinia'

const user = ref(null) // module-level: one per Node process
const useSession = () => ({ user, login: (name) => { user.value = name } })

const useSessionStore = defineStore('session', () => {
  const user = ref(null) // one per pinia, i.e. per request
  return { user, login: (name) => { user.value = name } }
})

async function render(name) {
  const app = createSSRApp({
    setup() {
      const a = useSession()
      const b = useSessionStore()
      if (name) { a.login(name); b.login(name) }
      return () => h('p', `module=${a.user.value} store=${b.user}`)
    },
  })
  app.use(createPinia()) // fresh pinia per request
  return renderToString(app)
}

console.log(await render('alice')) // <p>module=alice store=alice</p>
console.log(await render(null))    // <p>module=alice store=null</p>
```

### 2. Нормализованный стор

```js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const usePostsStore = defineStore('posts', () => {
  const byId = ref({})      // each entity is stored once
  const feedIds = ref([])   // lists keep ids only
  const pinnedIds = ref([])

  const feed = computed(() => feedIds.value.map((id) => byId.value[id]))
  const pinned = computed(() => pinnedIds.value.map((id) => byId.value[id]))

  function upsert(posts) {
    for (const p of posts) byId.value[p.id] = { ...byId.value[p.id], ...p }
  }
  return { byId, feedIds, pinnedIds, feed, pinned, upsert }
})

// upsert([{ id: 2, likes: 5 }]) updates the post both in feed and pinned:
// feed[1] === pinned[0], likes 5, title kept by the merge
```

### 3. Страница каталога: каждое состояние на своём месте

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuery } from '@pinia/colada'
import { useCartStore } from '@/stores/cart'
import { fetchProducts } from '@/api/products'

// URL state: the route is the source of truth, no copy in a store
const route = useRoute()
const router = useRouter()
const page = computed({
  get: () => Number(route.query.page ?? 1),
  set: (value: number) => router.push({ query: { ...route.query, page: value } }),
})
const sort = computed(() => String(route.query.sort ?? 'popular'))

// Server state: a cache entry keyed by every input of the request
const { data: products, isPending } = useQuery({
  key: () => ['products', { page: page.value, sort: sort.value }],
  query: () => fetchProducts({ page: page.value, sort: sort.value }),
  staleTime: 30_000,
})

// Global client state: the cart is needed by the header and checkout
const cart = useCartStore()

// Local UI state: nobody outside this component cares
const isFiltersOpen = ref(false)
</script>

<template>
  <button @click="isFiltersOpen = !isFiltersOpen">Filters</button>
  <p v-if="isPending">Loading…</p>
  <ul v-else>
    <li v-for="p in products" :key="p.id">
      {{ p.title }} <button @click="cart.add(p.id, p.price)">Add</button>
    </li>
  </ul>
  <button :disabled="page === 1" @click="page--">Prev</button>
  <button @click="page++">Next</button>
</template>
```

## Вопросы с интервью

::: details Какие виды состояния бывают во фронтенд-приложении и где каждое должно жить
Делю по владельцу истины. Локальное UI-состояние (открыт ли дропдаун) — `ref` в компоненте. URL-состояние (страница, фильтры, сортировка) — в `route.query`: оно переживает перезагрузку и работает с «Назад». Черновик формы — в форме, со снимком исходных данных. Серверные данные — в кэше запросов, потому что это копия чужой истины, которой нужны свежесть и инвалидация. В глобальный стор идёт только общее клиентское: сессия, корзина, тема. Производное не храню вообще, а вычисляю `computed`. Главное правило — один источник истины на значение: каждая копия рано или поздно разойдётся с оригиналом.
:::

::: details Когда хватает props, provide и composables, а когда нужен стор
Поднимаю состояние минимально. Нужно двум соседям — поднимаю в общего родителя и передаю props. Нужно поддереву — `provide`/`inject`, и у каждого поддерева будет свой экземпляр: две формы или два виджета на странице не мешают друг другу. Нужно переиспользовать логику — composable со своим состоянием на каждый вызов. Стор нужен, когда одно состояние нужно далёким частям приложения и его меняют из разных мест, например сессия или корзина. Состояние конкретного виджета в стор не кладу: второй экземпляр начнёт его делить.
:::

::: details Чем глобальный reactive в модуле отличается от стора Pinia
В SPA они похожи: оба — общий реактивный объект. Разница в том, кому принадлежит экземпляр. Модульная переменная одна на процесс, и на сервере её видят все запросы всех пользователей — cross-request state pollution. Стор принадлежит экземпляру `pinia`: `createPinia()` вызывают на каждый запрос, стор находится через `inject`, его state сериализуется в HTML и гидратируется. Сверху Pinia даёт devtools с таймлайном, `$subscribe` и `$onAction`, плагины, HMR и простой сброс в тестах через новый `createPinia()`. Документация Pinia прямо называет модульный `reactive({})` уязвимостью при SSR.
:::

::: details Почему серверное состояние называют кэшем и чем плох fetch в action стора
Потому что истиной владеет сервер, а у клиента копия, которая устаревает без его ведома: другой пользователь, другая вкладка, фоновая задача. Значит, нужны ключ запроса, время свежести, дедупликация одновременных запросов, инвалидация после мутаций, stale-while-revalidate, сборка мусора неиспользуемых записей. `products = ref([])` и `fetchProducts()` в action — это ручной кэш без всего перечисленного: флаги загрузки на каждый запрос, «не грузить повторно», перезагрузка после мутации, гонки, очистка при логауте. Поэтому серверные данные отдаю Pinia Colada или TanStack Query. Pinia Colada при этом сама построена на Pinia: её кэш — стор `_pc_query` с `Map` записей. Стор остаётся под клиентское состояние, и он обычно маленький.
:::

::: details Почему фильтры и пагинацию держат в URL, а не в сторе
Потому что это состояние должно открываться по ссылке, переживать перезагрузку и работать с кнопкой «Назад». Всё это даёт только URL. Если скопировать query в стор, появятся два источника истины: компонент страницы при смене query не пересоздаётся, и копия, сделанная в setup, остаётся старой после навигации назад. Правильно — `computed` с getter из `route.query` и setter через `router.push`, а ключ запроса строить из этих же `computed`. Для поиска по мере ввода — `router.replace`, чтобы не засорять историю.
:::

::: details Как разбить состояние на сторы и что делать с циклическими зависимостями
Режу по доменам, а не по страницам: сессия, корзина, редактор. Стор должен меняться по одной причине. Зависимости направленные: корзина знает о сессии, сессия о корзине — нет. Pinia допускает циклы, пока ни один стор не читает state другого в своём setup: стор регистрируется в `pinia._s` до выполнения setup, и цикл получит недостроенный объект без state. Чтение в `computed` или action безопасно. Если циклы появляются, обычно общее надо вынести в третий стор. Сценарии на несколько доменов держу в action или composable-сценарии, а не в цепочках `watch` между сторами.
:::

::: details Хранить производные данные в сторе или вычислять, и когда нормализовать
Производное вычисляю: `computed` кэширует результат до изменения зависимостей, а сохранённая копия требует обновления в каждом action, который меняет источник, и рано или поздно устареет. Нормализация — тот же принцип для сущностей: `byId` плюс массивы `id` в списках, представления через `computed`. Окупается, когда одна сущность видна в нескольких местах и меняется на клиенте. Для обычного каталога это лишняя сложность. Для серверных данных решение о нормализации принимается на уровне кэша.
:::

## Задачи

### 1. Найдите баг · легко

После `setFilter('active')` и `add('b')` новый элемент не появился в списке, хотя он активный. Почему и как исправить?

```js
export const useTodos = defineStore('todos', () => {
  const items = ref([{ id: 1, text: 'a', done: false }])
  const filter = ref('all')
  const visible = ref(items.value)

  function setFilter(f) {
    filter.value = f
    visible.value = f === 'all'
      ? items.value
      : items.value.filter((t) => t.done === (f === 'done'))
  }
  function add(text) {
    items.value = [...items.value, { id: Date.now(), text, done: false }]
  }
  return { items, filter, visible, setFilter, add }
})
```

::: details Решение и разбор
`visible` — производное, сохранённое как state. Его пересчитывает только `setFilter`, а `add` про него забыл: в проверке `visible` — `['a']`, хотя `items` уже два. Чинить добавлением пересчёта в `add` — значит ждать того же бага в `remove` и `toggle`. Правильно — вычислять:

```js
const visible = computed(() =>
  filter.value === 'all'
    ? items.value
    : items.value.filter((t) => t.done === (filter.value === 'done')),
)
```

`setFilter` больше не нужен: `filter` меняют напрямую или простым action. После исправления `visible` — `['a', 'b']`. Бонус: `visible` стал getter, его не сериализует SSR и не показывает devtools как state.
:::

### 2. Что выведет · средне

Стор используют как шину событий. Что окажется в `log`?

```js
const useBus = defineStore('bus', () => {
  const lastEvent = ref(null)
  function emit(e) { lastEvent.value = e }
  return { lastEvent, emit }
})

const bus = useBus()
const log = []
watch(() => bus.lastEvent, (e) => log.push(e))

bus.emit('saved')
bus.emit('deleted')
await nextTick()
bus.emit('deleted')
await nextTick()
bus.emit('saved')
await nextTick()
console.log(log)
```

::: details Решение и разбор
`['deleted', 'saved']`. Два `emit` в одном тике: `watch` с `flush: 'pre'` выполняется один раз и видит только последнее значение — `'saved'` потерян. Повторный `'deleted'` не меняет значение (`Object.is`), и watcher не срабатывает вовсе. Только последний `'saved'` отличается от предыдущего.

Состояние описывает «что сейчас», а событие — «что произошло». Шина на state теряет события по построению. Если событие действительно глобальное, подписываются на сам вызов: `bus.$onAction(({ name, args }) => …)` видит каждый вызов (в проверке два `emit('x')` дали два события), либо используют явный эмиттер. Чаще всего глобальная шина вообще не нужна: хватает emits или прямого вызова action нужного стора.
:::

### 3. Найдите баг · средне

Номер страницы хранится в сторе. После перехода на `?page=2` и нажатия «Назад» список не меняется. Почему?

```js
const useFilters = defineStore('filters', () => ({ page: ref(1) }))

// CatalogPage.vue, <script setup>
const route = useRoute()
const filters = useFilters()
filters.page = Number(route.query.page ?? 1)

const { data } = useQuery({
  key: () => ['products', filters.page],
  query: () => fetchProducts(filters.page),
})
```

::: details Решение и разбор
Query скопирован в стор один раз, в setup. При смене только query маршрут тот же, и компонент страницы переиспользуется, setup не выполняется повторно. В проверке копия в сторе после `push('/?page=2')` и `router.back()` оставалась `1`, а адрес менялся. Получились два источника истины, и они разошлись.

Чинится удалением копии: URL — единственный источник.

```js
const router = useRouter()
const page = computed({
  get: () => Number(route.query.page ?? 1),
  set: (value) => router.push({ query: { ...route.query, page: value } }),
})

const { data } = useQuery({
  key: () => ['products', page.value],
  query: () => fetchProducts(page.value),
})
```

С этим `computed` проверка дала `2` после перехода и `1` после «Назад». Синхронизация через `watch(route)` → стор тоже «работает», но остаётся двумя источниками истины с окном рассинхронизации и вопросом, кто кого перезаписывает.
:::

### 4. Реализуйте мини-кэш запросов на Pinia · сложно

Напишите `useQuery(key, fetcher, { staleTime })` поверх стора Pinia:

- одинаковый ключ — одна запись, одновременные запросы дедуплицируются;
- свежие данные (моложе `staleTime`) не перезапрашиваются;
- устаревшие показываются сразу, а запрос идёт в фоне (stale-while-revalidate);
- `invalidate(prefix)` перезапрашивает все записи, чей ключ начинается с `prefix`;
- ошибка не стирает старые данные.

::: details Решение и разбор
```js
import { reactive, computed, markRaw } from 'vue'
import { defineStore } from 'pinia'

export const useQueryStore = defineStore('queries', () => {
  const entries = markRaw(new Map()) // key hash -> reactive entry

  function ensure(key, fetcher) {
    const hash = JSON.stringify(key)
    let entry = entries.get(hash)
    if (!entry) {
      entry = reactive({
        key, data: undefined, error: null, isFetching: false,
        updatedAt: 0, promise: null, fetcher,
      })
      entries.set(hash, entry)
    }
    entry.fetcher = fetcher
    return entry
  }

  function fetch(entry) {
    if (entry.promise) return entry.promise // dedupe in-flight requests
    entry.isFetching = true
    const promise = entry.fetcher()
      .then((data) => { entry.data = data; entry.error = null; entry.updatedAt = Date.now() })
      .catch((error) => { entry.error = error }) // keep stale data on error
      .finally(() => { entry.isFetching = false; entry.promise = null })
    entry.promise = markRaw(promise)
    return promise
  }

  function refresh(entry, staleTime) {
    const isStale = Date.now() - entry.updatedAt >= staleTime
    return isStale ? fetch(entry) : Promise.resolve()
  }

  function invalidate(prefix) {
    const jobs = []
    for (const entry of entries.values()) {
      const matches = prefix.every(
        (part, i) => JSON.stringify(entry.key[i]) === JSON.stringify(part),
      )
      if (matches) {
        entry.updatedAt = 0
        jobs.push(fetch(entry))
      }
    }
    return Promise.all(jobs)
  }

  return { ensure, refresh, invalidate }
})

export function useQuery(key, fetcher, { staleTime = 0 } = {}) {
  const store = useQueryStore()
  const entry = store.ensure(key, fetcher)
  store.refresh(entry, staleTime)
  return {
    data: computed(() => entry.data),
    error: computed(() => entry.error),
    isPending: computed(() => entry.data === undefined && !entry.error),
    isFetching: computed(() => entry.isFetching),
  }
}
```

Проверено: два `useQuery(['user', 1])` подряд — один вызов `fetcher` и общий `data`. Третий вызов в пределах `staleTime` в сеть не идёт. После `staleTime` новый вызов сразу отдаёт старые данные с `isFetching: true` и `isPending: false`, затем получает новые. `invalidate(['user'])` перезапросил только `['user', 1]`, а `['posts']` не тронул. Ошибка заполнила `error`, не трогая `data`.

Почему так устроено:

- **Два статуса.** `isPending` — «данных ещё нет», `isFetching` — «идёт запрос». Полноэкранный спиннер — только на `isPending`.
- **`Map` под `markRaw` и не возвращается как state.** Иначе Pinia положит её в `pinia.state`, и SSR попытается сериализовать промисы и функции. Pinia Colada решает то же через `skipHydrate(shallowRef(new Map()))` и отдельную сериализацию записей.
- **Чего нет:** `gcTime` (удаление записей без подписчиков — понадобится счётчик подписчиков и `onScopeDispose`), отмена через `AbortSignal`, перезапрос при фокусе окна, реактивный ключ, SSR. Это и есть содержимое настоящих библиотек: [Данные и сеть](../architecture/data-and-network.md).

Сложность: `ensure` и `refresh` — O(1), `invalidate` — O(n·k) по числу записей и длине префикса.
:::

## Источники

- [Vue.js — State Management](https://vuejs.org/guide/scaling-up/state-management.html)
- [Pinia — Introduction: Why should I use Pinia?](https://pinia.vuejs.org/introduction.html), [Nesting stores](https://pinia.vuejs.org/cookbook/composing-stores.html)
- [Pinia Colada — Queries](https://pinia-colada.esm.dev/guide/queries.html), [Query Keys](https://pinia-colada.esm.dev/guide/query-keys.html)
- [TanStack Query (Vue) — Does TanStack Query replace client state?](https://tanstack.com/query/latest/docs/framework/vue/guides/does-this-replace-client-state)
- [Vue Router — Composition API](https://router.vuejs.org/guide/advanced/composition-api.html)
- [Исходники Pinia Colada — `useQueryCache`](https://github.com/posva/pinia-colada/blob/main/src/query-store.ts)
- [Находки «Pinia: актуальный API, setup stores, SSR в Nuxt»](https://github.com/alexrehtide/learning/blob/research/pinia/research/pinia.md)
- [Находки «Ключевые темы senior frontend-интервью и System Design»](https://github.com/alexrehtide/learning/blob/research/senior-interview-topics/research/senior-interview-topics.md)
