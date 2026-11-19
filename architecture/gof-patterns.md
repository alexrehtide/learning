---
title: Паттерны «банды четырёх» во фронтенде
level: ядро
---

# Паттерны «банды четырёх» во фронтенде

> **Коротко.** «Банда четырёх» (Гамма, Хелм, Джонсон, Влиссидес, 1994) описала 23 паттерна — именованные решения повторяющихся задач проектирования: порождающие, структурные и поведенческие. Фронтендер пользуется ими каждый день, часто не называя. Реактивность Vue и `addEventListener` — Observer. `reactive` — Proxy. Компаратор у `sort` и словарь валидаторов — Strategy. Маппер ответа API — Adapter. Навигационные guards и интерсепторы запросов — Chain of Responsibility. Дерево компонентов — Composite. Undo/redo — Command и Memento. В JavaScript многие паттерны сжимаются до функции и объекта, потому что функции — значения первого класса. Ценность паттернов — общий словарь команды и готовый ответ на вопрос «как расширять без переписывания». На интервью ценят не перечень из 23 названий, а пример из своего кода, проблему, которую паттерн решил, и его цену.

**Связанные темы:** [Карточки для повторения](gof-patterns.cards.md), [Принципы Роберта Мартина во фронтенде](robert-martin-principles.md), [EventEmitter](../live-coding/event-emitter.md), [Мини-реактивность в стиле Vue](../live-coding/mini-reactivity.md), [Дескрипторы свойств, Proxy и Reflect](../javascript/property-descriptors-and-proxy.md), [Итераторы и генераторы](../javascript/iterators-and-generators.md), [curry, compose, memoize, once](../live-coding/function-utilities.md)

## Теория

### Что такое паттерн и зачем он фронтендеру

Паттерн в книге GoF — это не код для копирования, а четвёрка: **имя**, **задача** (когда применять), **решение** (роли и связи между ними) и **последствия** (что получаем и чем платим). Ценность имени недооценивают: фраза «здесь адаптер над SDK» на ревью заменяет абзац объяснений.

Книга держится на двух принципах, которые важнее отдельных паттернов:

1. **Программируйте на уровне интерфейса, а не реализации.** Код зависит от контракта (`OrdersApi`, `(a, b) => number`), а не от конкретного класса или библиотеки.
2. **Предпочитайте композицию наследованию.** Поведение собирают из объектов и функций, а не наследуют вместе с чужим состоянием. Во Vue 3 это composables вместо mixins.

> [!NOTE]
> Книга написана для C++ и Smalltalk. В 1996 году Питер Норвиг показал, что в динамических языках 16 из 23 паттернов реализуются качественно проще или растворяются в самом языке. В JavaScript то же самое: Strategy — это функция, Iterator — `for...of` и генераторы, Prototype — прототипы языка, Observer — `EventTarget`. Писать на фронтенде «как в книге», с иерархией классов и интерфейсом на каждую роль, обычно лишнее.

### Порождающие паттерны: как создаются объекты

| Паттерн | Задача | Где фронтендер видит каждый день |
| --- | --- | --- |
| Factory Method / Abstract Factory | создать объект, не зная конкретного класса | `createApp`, `createRouter`, `createPinia`, `defineStore`, `$fetch.create({ baseURL })`, composables-фабрики |
| Builder | собрать сложный объект по шагам | схемы `zod`/`yup` (`z.string().min(3).email()`), сборщики тестовых данных, конструкторы запросов |
| Singleton | один экземпляр на систему | ES-модуль сам по себе синглтон; экземпляр стора на приложение |
| Prototype | создать объект копированием образца | прототипное наследование JS, `structuredClone`, клонирование черновика формы |

**Фабрики во фронтенде появились не ради красоты, а из-за SSR.** Модуль ES исполняется один раз на процесс. На клиенте это один пользователь, а на сервере Node — все запросы сразу. Если экспортировать готовый экземпляр (`export const store = reactive({})`), данные одного пользователя утекут к другому. Документация Vue называет это cross-request state pollution. Поэтому `createApp`, `createPinia` и `createRouter` — фабрики: на каждый запрос создаётся свой экземпляр.

- *Что даёт:* изоляция запросов в SSR, свежий экземпляр в каждом тесте, настройки по умолчанию в одном месте (`$fetch.create` с базовым URL и токеном).
- *Признак проблемы:* модульная переменная с пользовательскими данными; тесты, которые проходят по одному и падают вместе.

> [!WARNING]
> Singleton — самый спорный паттерн книги. Глобальный экземпляр — это скрытая зависимость: его не видно в сигнатуре, его трудно подменить в тесте, а в SSR он общий для всех. Синглтон оправдан для того, что не хранит пользовательского состояния: логгер, конфиг сборки, кэш экземпляров `Intl.NumberFormat` по локали.

### Структурные паттерны: как объекты складываются вместе

| Паттерн | Задача | Где фронтендер видит каждый день |
| --- | --- | --- |
| Adapter | привести чужой интерфейс к своему | маппер DTO → модель, обёртка над SDK аналитики или карт |
| Facade | простой вход в сложную подсистему | `useCheckout()` поверх корзины, доставки и оплаты; API-клиент поверх `fetch` |
| Proxy | перехватить доступ к объекту | `reactive` и `readonly` во Vue, кэширующий или ленивый доступ |
| Decorator | добавить поведение, сохранив интерфейс | `debounce`, `memoize`, `withRetry` вокруг функции; компонент-обёртка; декораторы TS 5 |
| Composite | работать с деревом как с одним узлом | дерево компонентов и DOM, рекурсивное меню, дерево файлов |
| Bridge | развести абстракцию и реализацию | headless-логика и разные визуальные реализации; уведомления через разные каналы |
| Flyweight | разделять общее неизменяемое состояние | один SVG-спрайт через `<use href>`, общие экземпляры форматтеров |

**Adapter — первая линия обороны от бэкенда.** Ответ сервера приходит в своём формате: `created_at` строкой, `status: 1`, вложенный `data.items`. Если этот формат расползается по шаблонам, переименование одного поля ломает десяток экранов. Адаптер на границе переводит его в модель фронтенда (`createdAt: Date`, `status: 'paid'`) в одном месте. Так же оборачивают сторонние SDK: приложение вызывает `analytics.track(event)`, а смена провайдера меняет один файл.

**Facade прячет оркестрацию.** Компонент оформления заказа вызывает `submit()`, а фасад внутри проверяет корзину, считает доставку, создаёт заказ и сбрасывает кэш. Риск — «божественный объект»: если фасад меняется при любой правке любой фичи, его пора делить.

**Proxy встроен во Vue.** `reactive(obj)` возвращает ES `Proxy`: ловушка `get` записывает, какой эффект прочитал свойство, ловушка `set` запускает зависимые эффекты. Отсюда известные ограничения: деструктуризация `reactive` теряет реактивность, потому что достаёт значения мимо прокси, а сравнение `reactive(obj) === obj` даёт `false`.

**Decorator отличается от наследования тем, что собирается во время выполнения.** `withRetry(withTimeout(fetchOrders, 5000), 3)` добавляет поведение, не меняя `fetchOrders` и сохраняя её сигнатуру. Компонент-обёртка над `<input>` — тот же декоратор на уровне UI: добавляет подпись и ошибку, но остаётся инпутом для внешнего кода.

**Composite — модель любого интерфейса.** Компонент рендерит компоненты, узел DOM содержит узлы. Рекурсивный компонент `TreeNode`, который рендерит сам себя для `children`, позволяет обрабатывать лист и ветку одним кодом: подсчитать выбранные, раскрыть всё, отфильтровать.

### Поведенческие паттерны: как объекты общаются

| Паттерн | Задача | Где фронтендер видит каждый день |
| --- | --- | --- |
| Observer | уведомить подписчиков об изменении | реактивность Vue, `watch`, `emit`, `addEventListener`, `IntersectionObserver`, `$subscribe` у Pinia |
| Strategy | выбрать алгоритм во время выполнения | компаратор `sort`, словарь валидаторов, `<component :is>`, стратегии кэширования в Service Worker |
| Chain of Responsibility | передать запрос по цепочке обработчиков | guards Vue Router, интерсепторы `ofetch`/`axios`, middleware Nuxt, всплытие событий DOM |
| Command | превратить действие в объект | undo/redo, очередь офлайн-мутаций, реестр горячих клавиш, палитра команд |
| Memento | сохранить и восстановить состояние | снимок формы перед редактированием, история для undo, time travel в devtools |
| State | поведение зависит от состояния | конечные автоматы (`idle`/`loading`/`success`/`error`), XState, шаги визарда |
| Mediator | убрать прямые связи между участниками | родительский компонент или стор, координирующий соседей |
| Iterator | обойти коллекцию, не раскрывая устройство | `for...of`, генераторы, `Symbol.iterator`, пагинация через async-итератор |
| Template Method | каркас алгоритма с шагами-крючками | хуки жизненного цикла: фреймворк вызывает `onMounted`, вы заполняете шаг |
| Visitor | операция над структурой без правки узлов | обход AST в плагинах Babel, ESLint, PostCSS и в компиляторе шаблонов Vue |

**Observer — основа реактивного UI.** Каждый `computed` подписан на то, что прочитал, и пересчитывается при изменении. Правило выбора: если подписчику нужно **значение**, это состояние (`ref` + `computed`/`watch`). Если ему важен **факт** («заказ отправлен»), это событие (`emit`, emitter). Цена Observer — неявность: глобальная шина событий делает поток данных невидимым, и через год никто не знает, кто слушает `order:updated`. Ещё одна цена — утечки: подписку на `window` или сокет нужно снимать в `onUnmounted`.

**Strategy убирает `switch` по типу.** Если цепочка `if (type === 'courier') … else if (type === 'pickup')` повторяется в расчёте цены, шаблоне и валидации, стратегии собирают в объект с общим интерфейсом. Новый вариант — новая запись в словаре, а не правка трёх файлов. В JS стратегия — это функция или объект функций, классы не нужны.

**Chain of Responsibility — модель всех middleware.** Каждый обработчик решает: обработать, изменить и передать дальше или прервать. `router.beforeEach` проверяет авторизацию и возвращает редирект или `true`. Интерсептор `onRequest` добавляет токен, `onResponseError` на `401` обновляет его. Всплытие событий DOM — тоже цепочка: каждый предок может обработать событие или вызвать `stopPropagation()`. Делегирование событий опирается именно на это.

**Command и Memento дают undo/redo.** Command хранит действие с методами `execute` и `undo`, Memento — снимок состояния. Редактор с историей выбирает одно из двух: хранить команды (экономно по памяти, но каждая команда должна уметь откатываться) или снимки (просто, но дорого на больших данных). Command также лежит в основе офлайн-очереди: мутация сериализуется в объект и отправляется, когда появится сеть.

**State делает невозможные состояния непредставимыми.** Набор флагов `isLoading`, `isError`, `data` допускает бессмысленное `isLoading && isError`. Объединение `{ status: 'loading' } | { status: 'error'; error } | { status: 'success'; data }` с переходами в одном месте — это State в духе TypeScript. Для сложных процессов (визард оплаты, загрузка файлов с паузой) берут явный конечный автомат.

### Как паттерны улучшают опыт разработки

- **Общий словарь.** «Адаптер», «стратегия», «фасад» на ревью и в ADR экономят объяснения и выравнивают решения в команде.
- **Расширение без переписывания.** Strategy, Chain of Responsibility и Decorator добавляют поведение новым кодом, а проверенный остаётся нетронутым — меньше регрессий.
- **Изоляция от внешнего мира.** Adapter и Facade удерживают изменения API и SDK в одном файле.
- **Тестируемость.** Фабрика даёт свежий экземпляр на тест, стратегию и команду проверяют как обычные функции, адаптер подменяют фейком.
- **Понимание инструментов.** Зная Observer, Proxy и Chain of Responsibility, проще понять, почему ломается реактивность при деструктуризации, в каком порядке срабатывают guards и почему всплывает событие.

### Цена и антипаттерны

Паттерн — это всегда косвенность. Если он не решает существующую задачу, он только усложняет чтение. Типичные ошибки на фронтенде:

- **Перенос Java-стиля в JS:** класс `SortStrategy` с интерфейсом, фабрикой и реестром там, где хватает функции-компаратора.
- **Глобальная шина событий** вместо явных props и стора: связи становятся невидимыми, отладка — долгой.
- **Модульные синглтоны с состоянием** в SSR-приложении.
- **Фасад-«бог»**, через который проходит каждая фича.
- **Паттерн ради паттерна:** «а давайте сделаем здесь Visitor», хотя операций над структурой две и новых не предвидится.

> [!TIP]
> Каркас ответа на 30 секунд: «Паттерны GoF я использую как словарь и как готовые ответы на типовые задачи, а не как классы из книги. Во Vue многие встроены: реактивность — Observer поверх Proxy, guards роутера и интерсепторы — Chain of Responsibility, дерево компонентов — Composite. Сам чаще всего применяю Adapter на границе с API, Strategy вместо `switch` по типу, Facade в composables и Command для undo и офлайн-очереди. В JS это обычно функции и объекты. Паттерн ввожу, когда есть второй случай или нужна изоляция для тестов, а не "на будущее"».

## Примеры

### 1. Adapter и Facade на границе с API

```ts
// api/orders.adapter.ts — Adapter: backend DTO -> frontend model
interface OrderDto { id: number; created_at: string; status: 0 | 1 | 2; total_cents: number }

export interface Order { id: string; createdAt: Date; status: 'new' | 'paid' | 'cancelled'; total: number }

const statusMap = { 0: 'new', 1: 'paid', 2: 'cancelled' } as const

export function toOrder(dto: OrderDto): Order {
  return {
    id: String(dto.id),
    createdAt: new Date(dto.created_at),
    status: statusMap[dto.status],
    total: dto.total_cents / 100,
  }
}
```

```ts
// features/checkout/use-checkout.ts — Facade: one entry point for the whole flow
export function useCheckout() {
  const cart = useCartStore()
  const loading = ref(false)

  async function submit() {
    loading.value = true
    try {
      const shipping = await shippingApi.quote(cart.items)
      const order = await ordersApi.create({ items: cart.items, shipping })
      cart.clear()
      return order
    } finally {
      loading.value = false
    }
  }

  return { loading, submit }
}
```

Шаблоны работают с `Order` и не знают о `total_cents`. Компонент вызывает `submit()` и не знает, сколько запросов за ним стоит.

### 2. Strategy: словарь вместо `switch`

```ts
type ShippingStrategy = {
  label: string
  price: (weightKg: number) => number
  validate: (address: string) => string | null
}

export const shipping: Record<'courier' | 'pickup' | 'post', ShippingStrategy> = {
  courier: { label: 'Курьер', price: w => 300 + w * 50, validate: a => (a ? null : 'Укажите адрес') },
  pickup: { label: 'Самовывоз', price: () => 0, validate: () => null },
  post: { label: 'Почта', price: w => 200 + w * 30, validate: a => (/\d{6}/.test(a) ? null : 'Нужен индекс') },
}

// usage: one line instead of three switch statements
const cost = shipping[method].price(weightKg)
```

Тип `Record<…>` заставит TypeScript потребовать все три стратегии: забыть новый способ доставки в одном из мест невозможно.

### 3. Chain of Responsibility: guards и интерсепторы

```ts
// router guard: each guard either passes or redirects
router.beforeEach(to => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  // returning nothing passes control further down the chain
})

// HTTP client: interceptors form a chain around every request
export const api = $fetch.create({
  baseURL: '/api',
  onRequest({ options }) {
    const token = useAuthStore().token
    if (token) options.headers.set('Authorization', `Bearer ${token}`)
  },
  onResponseError({ response }) {
    if (response.status === 401) useAuthStore().logout()
  },
})
```

Новое правило (проверка роли, логирование) добавляют ещё одним звеном, не трогая существующие.

### 4. Observer: состояние или событие

```ts
// state: subscribers need the current value -> reactivity
const cartCount = computed(() => cart.items.length)

// event: subscribers need the fact -> emitter, unsubscribed on unmount
const off = bus.on('order:placed', order => analytics.track('purchase', order))
onUnmounted(off)
```

### 5. State: невозможные состояния непредставимы

```ts
type Remote<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'success'; data: T }

function render(state: Remote<Order[]>) {
  switch (state.status) {
    case 'loading': return 'Spinner'
    case 'error': return state.error.message // error exists only here
    case 'success': return `${state.data.length} orders` // data exists only here
    case 'idle': return 'Nothing yet'
  }
}
```

## Вопросы с интервью

::: details Какие паттерны «банды четырёх» вы встречаете во фронтенде каждый день
Observer — реактивность Vue, `watch`, `emit`, `addEventListener`, `IntersectionObserver`. Proxy — `reactive` и `readonly`. Composite — дерево компонентов и DOM. Chain of Responsibility — guards роутера, интерсепторы HTTP-клиента, middleware Nuxt, всплытие событий. Factory — `createApp`, `createRouter`, `defineStore`, `$fetch.create`. Strategy — компаратор `sort`, словарь валидаторов, `<component :is>`. Adapter — маппер ответа API в модель. Facade — composable поверх нескольких API. Decorator — `debounce`, `memoize`, компонент-обёртка. Command и Memento — undo/redo и офлайн-очередь. Iterator — `for...of` и генераторы. Template Method — хуки жизненного цикла. Хороший ответ называет к каждому проблему и цену, а не только название.
:::

::: details Нужны ли паттерны GoF в JavaScript, если книга про C++ и классы
Нужны идеи, а не форма. Книга держится на двух принципах — программировать на уровне интерфейса и предпочитать композицию наследованию, — и они полностью применимы к JS. Но многие реализации упрощаются: Норвиг показал, что в динамических языках 16 из 23 паттернов становятся проще или исчезают. Strategy — это функция, Command — объект с `execute`/`undo`, Iterator встроен в язык, Observer — `EventTarget`, Prototype — сама модель объектов JS. Ошибка — переносить Java-стиль: класс, интерфейс и фабрику там, где хватает функции. Польза — общий словарь и понимание инструментов: зная Proxy и Observer, проще объяснить, почему деструктуризация `reactive` теряет реактивность.
:::

::: details Чем Adapter отличается от Facade и от Decorator
Все три оборачивают объект, но с разной целью. Adapter меняет интерфейс на нужный клиенту: DTO бэкенда в модель фронтенда, SDK аналитики в свой `track(event)`. Facade упрощает: даёт один вход в подсистему из нескольких объектов (`useCheckout().submit()` вместо пяти вызовов). Decorator сохраняет интерфейс и добавляет поведение: `withRetry(fetchOrders)` вызывается так же, как `fetchOrders`, но повторяет запрос. Проверочный вопрос: интерфейс изменился (Adapter), сократился (Facade) или остался тем же (Decorator)?
:::

::: details Почему Singleton считают антипаттерном и как с этим во Vue и Nuxt
Синглтон — глобальное состояние со скрытой зависимостью: его не видно в сигнатуре, его трудно подменить в тестах, состояние протекает между тестами. В SSR добавляется критичная проблема: модуль исполняется один раз на процесс Node, поэтому модульный экземпляр с данными общий для всех запросов, и данные одного пользователя видит другой. Поэтому Vue, Pinia и Vue Router дают фабрики (`createApp`, `createPinia`, `createRouter`), а Nuxt создаёт приложение на каждый запрос. Состояние храню в сторе или `useState`, зависимости отдаю через `provide`/`inject`. Синглтон оставляю для того, что не хранит пользовательских данных: логгер, конфиг, кэш форматтеров.
:::

::: details Как реактивность Vue связана с паттернами Observer и Proxy
`reactive` возвращает ES `Proxy`. Ловушка `get` вызывает `track`: текущий эффект (рендер, `computed`, `watch`) подписывается на это свойство. Ловушка `set` вызывает `trigger`: все подписанные эффекты перезапускаются. То есть Proxy — механизм перехвата, а Observer — модель подписки. Из этого следуют ограничения: деструктуризация или передача свойства в функцию достаёт значение мимо прокси, и связь теряется (поэтому `toRefs`); `reactive(obj)` и `obj` — разные объекты; примитив нельзя обернуть в Proxy, поэтому для него есть `ref` с геттером и сеттером `value`.
:::

::: details Как реализовать undo/redo и какие паттерны здесь подходят
Два подхода. Command: каждое действие — объект с `execute` и `undo`; два стека, `undo` переносит команду из `done` в `undone` и вызывает её `undo`, новая команда очищает `undone`. Экономно по памяти, но каждое действие должно уметь откатываться, и это источник багов. Memento: перед изменением сохраняется снимок состояния; откат — восстановление снимка. Просто и надёжно, но дорого на больших состояниях, лечится структурным разделением неизменяемых данных или хранением патчей. На практике часто комбинируют: команды для операций, снимки для контрольных точек. Важные детали: лимит истории, группировка ввода (не команда на каждую букву), хранение истории вне реактивности, если она большая.
:::

## Задачи

### 1. Замените `switch` стратегиями · легко

Расчёт скидки повторяется в корзине, в карточке товара и в чеке.

```ts
function discount(type: string, price: number, qty: number): number {
  switch (type) {
    case 'none': return 0
    case 'percent10': return price * qty * 0.1
    case 'bulk': return qty >= 10 ? price * qty * 0.15 : 0
    case 'fixed500': return Math.min(500, price * qty)
    default: throw new Error('Unknown discount')
  }
}
```

Перепишите так, чтобы новая скидка добавлялась без правки существующего кода, а TypeScript ловил опечатки в типе скидки.

::: details Решение и разбор
```ts
type Discount = (price: number, qty: number) => number

const discounts = {
  none: () => 0,
  percent10: (p, q) => p * q * 0.1,
  bulk: (p, q) => (q >= 10 ? p * q * 0.15 : 0),
  fixed500: (p, q) => Math.min(500, p * q),
} satisfies Record<string, Discount>

export type DiscountType = keyof typeof discounts

export function discount(type: DiscountType, price: number, qty: number): number {
  return discounts[type](price, qty)
}
```

`satisfies` проверяет, что каждая запись — `Discount`, но сохраняет точные ключи, поэтому `DiscountType` — объединение `'none' | 'percent10' | 'bulk' | 'fixed500'`, и опечатка не скомпилируется. Ветка `default` больше не нужна. Если скидки приходят из CMS строками, на границе нужен guard `type in discounts`. Классы не нужны: стратегия в JS — это функция.

Сложность: O(1) на выбор стратегии.
:::

### 2. Undo/redo на командах · средне

Реализуйте `createHistory()` с методами `run(command)`, `undo()`, `redo()`, `canUndo`, `canRedo`. Команда — объект `{ execute(): void; undo(): void }`. Новая команда после `undo` должна очищать ветку redo. Ограничьте историю 100 шагами.

::: details Решение и разбор
```ts
export interface Command {
  execute(): void
  undo(): void
}

export function createHistory(limit = 100) {
  const done: Command[] = []
  const undone: Command[] = []

  return {
    run(cmd: Command) {
      cmd.execute()
      done.push(cmd)
      if (done.length > limit) done.shift()
      undone.length = 0 // a new action invalidates the redo branch
    },
    undo() {
      const cmd = done.pop()
      if (!cmd) return
      cmd.undo()
      undone.push(cmd)
    },
    redo() {
      const cmd = undone.pop()
      if (!cmd) return
      cmd.execute()
      done.push(cmd)
    },
    get canUndo() { return done.length > 0 },
    get canRedo() { return undone.length > 0 },
  }
}

// usage
const moveShape = (shape: { x: number }, dx: number): Command => ({
  execute: () => { shape.x += dx },
  undo: () => { shape.x -= dx },
})
```

Разбор: команда хранит всё, что нужно для отката (здесь `dx`). Для команд, откат которых посчитать трудно (удаление с каскадом), команда сохраняет снимок в `execute` — это Memento внутри Command. `shift()` — O(n), при большом лимите заменяют кольцевым буфером. Для Vue стеки держат вне `reactive` (или в `shallowRef`), чтобы не проксировать всю историю, а `canUndo` и `canRedo` выставляют через отдельный счётчик версий.

Сложность: `run`, `undo`, `redo` — O(1) амортизированно (без учёта `shift`), память — O(limit).
:::

### 3. Конвейер middleware · средне

Реализуйте `compose(middlewares)` для цепочки обработчиков в стиле интерсепторов. Каждый middleware — `(ctx, next) => Promise<void>`; он может изменить `ctx` до и после `await next()` или не вызвать `next` и прервать цепочку. Повторный вызов `next` в одном middleware — ошибка.

```ts
type Middleware<C> = (ctx: C, next: () => Promise<void>) => Promise<void>
```

::: details Решение и разбор
```ts
export function compose<C>(middlewares: Middleware<C>[]) {
  return function run(ctx: C): Promise<void> {
    let lastIndex = -1

    function dispatch(i: number): Promise<void> {
      if (i <= lastIndex) return Promise.reject(new Error('next() called multiple times'))
      lastIndex = i
      const mw = middlewares[i]
      if (!mw) return Promise.resolve()
      try {
        return Promise.resolve(mw(ctx, () => dispatch(i + 1)))
      } catch (e) {
        return Promise.reject(e)
      }
    }

    return dispatch(0)
  }
}

// usage
const pipeline = compose<{ headers: Record<string, string>; log: string[] }>([
  async (ctx, next) => { ctx.log.push('auth'); ctx.headers.Authorization = 'Bearer t'; await next() },
  async (ctx, next) => { const t = Date.now(); await next(); ctx.log.push(`took ${Date.now() - t}ms`) },
  async ctx => { ctx.log.push('send') }, // last link does not call next
])
```

Это Chain of Responsibility в «луковичной» форме (как в Koa): код до `await next()` выполняется по пути внутрь, после — по пути наружу, поэтому один middleware может и подготовить запрос, и замерить время ответа. Прерывание — просто не вызвать `next`. `try/catch` нужен для синхронных исключений внутри middleware, иначе они вылетят мимо промиса. Проверка `i <= lastIndex` ловит двойной `next()`, который иначе отправил бы запрос дважды.

Сложность: O(n) по времени на прогон, O(n) по глубине стека вызовов.
:::

## Источники

- [Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software](https://www.oreilly.com/library/view/design-patterns-elements/0201633612/)
- [Peter Norvig — Design Patterns in Dynamic Languages (1996)](https://norvig.com/design-patterns/)
- [Vue.js — Reactivity in Depth](https://vuejs.org/guide/extras/reactivity-in-depth.html)
- [Vue.js — Server-Side Rendering: Cross-Request State Pollution](https://vuejs.org/guide/scaling-up/ssr.html#cross-request-state-pollution)
- [Vue Router — Navigation Guards](https://router.vuejs.org/guide/advanced/navigation-guards.html)
- [ofetch — Interceptors](https://github.com/unjs/ofetch#%EF%B8%8F-interceptors)
- [MDN — Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy)
- [MDN — Event bubbling](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Event_bubbling)
- [Refactoring.Guru — Design Patterns](https://refactoring.guru/design-patterns)
- [patterns.dev — Design Patterns](https://www.patterns.dev/)
