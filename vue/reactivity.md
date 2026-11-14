---
title: 'Реактивность: `ref`, `reactive`, `computed`'
level: ядро
---

# Реактивность: `ref`, `reactive`, `computed`

> **Коротко.** `reactive(obj)` возвращает `Proxy`: чтение свойства подписывает текущий эффект, запись перезапускает подписчиков. `Proxy` не умеет оборачивать примитивы и переменные, поэтому `ref` — объект-контейнер с геттером и сеттером `.value`. Реактивна ссылка, через которую идёт доступ, а не значение. Отсюда все ловушки: деструктуризация, замена объекта целиком, сравнение прокси с исходником. `computed` — ленивый кэширующий `ref`: геттер выполняется только при чтении после изменения зависимостей, а подписчики просыпаются, только если значение действительно изменилось.

**Связанные темы:** [Мини-реактивность в стиле Vue](../live-coding/mini-reactivity.md), [Дескрипторы свойств, `Proxy` и `Reflect`](../javascript/property-descriptors-and-proxy.md), [Компоненты и шаблоны](./components-and-templates.md), [Производительность Vue и Nuxt](../performance/vue-performance.md), [Функциональные приёмы и иммутабельность](../javascript/functional-programming.md), [Прототипы и классы](../javascript/prototypes-and-classes.md), [Память и сборка мусора](../javascript/memory-and-gc.md)

## Теория

Все проверки в теме выполнены на Vue 3.5.45 в Node 26.13.1: поведение — запуском `vue`, DOM-сценарии — с happy-dom, вывод компилятора — через `@vue/compiler-sfc` в production-режиме. Здесь — модель пользователя. Как устроены `track`/`trigger`, эффекты и ловушки `Proxy`, показано с реализацией с нуля в [«Мини-реактивности»](../live-coding/mini-reactivity.md) и в [«Дескрипторах свойств, `Proxy` и `Reflect»`](../javascript/property-descriptors-and-proxy.md#vue-от-defineproperty-к-proxy).

### Почему два примитива

Реактивность Vue работает в рантайме: она должна узнать о чтении и записи в момент, когда они происходят. Для свойств объекта это делает `Proxy`. Но `let count = 0` — локальная переменная, и в JavaScript нет способа перехватить её чтение. Поэтому значение кладут в объект и читают через свойство: `count.value`. Это и есть `ref`. `.value` — геттер, который вызывает `track`, и сеттер, который вызывает `trigger`, если новое значение отличается по `Object.is`.

| | `ref(x)` | `reactive(obj)` |
| --- | --- | --- |
| Что принимает | что угодно | только объекты, массивы, `Map`/`Set`; на примитив — предупреждение `value cannot be made reactive` |
| Доступ | `.value` в JS, без него в шаблоне | как к обычному объекту |
| Замена целиком | `r.value = newObj` — реактивна | нельзя: переменная указывает на старый прокси |
| Деструктуризация | ref передаётся как есть | теряет связь (нужен `toRefs`) |
| Объект внутри | `.value` — это `reactive(obj)`, глубоко | глубоко, лениво при чтении |

Гайд Vue рекомендует `ref` как основной примитив: он работает с любым типом и не ломается при замене и передаче. `reactive` удобен для группы связанных полей, которые меняются на месте. Между ними нет пропасти: `ref(obj).value` — тот же прокси, что и `reactive(obj)` (проверено: `ref(raw).value === reactive(raw)`).

> [!NOTE]
> В Options API `data()` возвращает объект, который Vue оборачивает в `reactive`, а `computed` — объект функций. В методах пишут `this.count` без `.value`: `this` — прокси экземпляра, который разворачивает ref'ы из `setup()`. Механика та же, меняется только поверхность.

### Где `.value` разворачивается

Писать `.value` не нужно в трёх местах. В остальных ref остаётся объектом.

- **Шаблон, верхний уровень.** Компилятор `<script setup>` знает тип каждой привязки и сам подставляет доступ. Для шаблона <code v-pre>{{ count }} {{ maybe }} {{ n }} {{ state.n }}</code> получается:

  ```js
  // const count = ref(0)       → binding "setup-ref"
  // let maybe = ref(1)         → "setup-let"
  // const { n } = toRefs(st)   → "setup-maybe-ref"
  // const state = reactive({}) → "setup-reactive-const"
  _toDisplayString(count.value) + " " + _toDisplayString(_unref(maybe)) + " " +
  _toDisplayString(_unref(n)) + " " + _toDisplayString(state.n)
  ```

  Обработчик `@click="count++"` превращается в `count.value++`. Без `<script setup>` то же делает `proxyRefs` над объектом, который вернул `setup()`.
- **Свойство `reactive`.** `reactive({ count })` при чтении `state.count` отдаёт `count.value`, а запись `state.count = 10` пишет в сам ref. Если присвоить новый ref (`state.count = ref(20)`), он **заменяет** старый, и тот перестаёт быть связан с объектом.
- **`computed`** внутри `reactive` разворачивается так же, как ref.

Не разворачивается:

- **элементы массивов и значения `Map`/`Set`**: `reactive([ref(1)])[0]` и `reactive(new Map([['a', ref(1)]])).get('a')` — это ref'ы. Для массива так сделано намеренно: при развёртке `arr[0] = x` было бы неясно, писать в ref или заменить элемент;
- **свойства `shallowReactive`** — он не трогает значения;
- **вложенные свойства в шаблоне**: если `obj = { foo: ref(1) }` — обычный объект, то <code v-pre>{{ obj.foo + 1 }}</code> рендерится как `[object Object]1`. Проверено SSR. Компилятор разворачивает только сами привязки верхнего уровня. При этом <code v-pre>{{ obj.foo }}</code> покажет `1`: `toDisplayString` сам разворачивает ref, и эта случайная удача маскирует проблему.

### Связь теряется вместе со ссылкой

Реактивен **доступ через прокси**. Как только значение скопировали в переменную, перехватывать нечего.

```js
const state = reactive({ n: 1 })
let { n } = state // n is a plain number 1
state.n = 2       // n is still 1
```

Деструктуризация, `{ ...state }`, передача `state.n` в функцию — это копия примитива. Если свойство — объект, копируется ссылка на вложенный **прокси**, и мутации в нём реактивны. Но после `state.list = [9]` переменная `list` указывает на старый массив. Решения:

- `toRefs(state)` — объект из ref'ов, каждый читает и пишет `state[key]`. Это не копия, а «окно» в свойство: `toRefs(state).n.value = 5` меняет `state.n`. Его возвращают из composable, чтобы вызывающий мог деструктурировать результат;
- `toRef(state, 'n')` — то же для одного свойства;
- `toRef(() => props.id)` (3.3+) — **только для чтения** ref на геттер. `isReadonly` у него `true`, а запись в модуле (строгий режим) бросает `TypeError: Cannot set property value of #<GetterRefImpl> which has only a getter`.

Деструктуризация `defineProps` с 3.5 реактивна по другой причине: компилятор переписывает `count` в `__props.count` ([подробнее](./components-and-templates.md)). Это работает только в `<script setup>` и только для props.

### Замена `reactive` целиком

`state = reactive(newData)` создаёт **новый** прокси. Шаблон и эффекты подписаны на старый. Проверено в happy-dom на `let user = reactive({ name: '' })` и `user = reactive(await api.getUser())` в `onMounted`: страница остаётся пустой. Но после изменения несвязанного состояния появляется `Ann`: render-функция читает переменную `user` из замыкания и при следующем перерендере видит новый объект. Такой баг «то работает, то нет» особенно неприятен. Варианты исправления:

- `Object.assign(user, data)` — мутирует существующий прокси (лишние старые ключи не удаляются);
- `const user = ref(null)` и `user.value = data` — замена `.value` реактивна. Это главный довод за `ref` по умолчанию;
- `const state = reactive({ user: null })` и `state.user = data` — заменяется свойство, а не корень.

### Идентичность прокси

`reactive(raw) !== raw`. Прокси кэшируется в `WeakMap`, поэтому `reactive(raw) === reactive(raw)`, а `reactive(proxy) === proxy`. `toRaw(proxy)` возвращает исходник. Последствия:

- сравнение `===` прокси и исходника ложно. Методы поиска массива Vue инструментирует: `reactive([raw]).includes(raw)` и `indexOf(raw)` находят исходник. Обычный `Set` или `Map` вне реактивности по прокси не найдёт ничего;
- `ref(raw).value` тоже прокси, поэтому `selected.value === items[0]` истинно, если оба получены через реактивность;
- запись в `toRaw(state)` эффекты не запускает. Иногда это и нужно (кэш, служебное поле), но обычно это ошибка;
- `reactive(Object.freeze(obj))` возвращает `obj` без прокси: нерасширяемый объект Vue не оборачивает ([подробнее](../javascript/property-descriptors-and-proxy.md#vue-от-defineproperty-к-proxy)).

> [!WARNING]
> Экземпляр класса с приватными полями `#x` внутри `reactive` или глубокого `ref` ломается. Метод вызывается с `this` = прокси, и `this.#x = …` бросает `TypeError: Cannot write private member #x to an object whose class did not declare it`. Для сторонних классов — `markRaw` или `shallowRef`, разбор — в [«Прототипах и классах»](../javascript/prototypes-and-classes.md#vue-классы-и-реактивность).

### Меньше реактивности: shallow, readonly, raw

Глубокая реактивность лениво оборачивает каждый прочитанный вложенный объект и хранит зависимость на каждое прочитанное свойство. Для больших данных и чужих объектов это лишняя работа ([модель стоимости](../performance/vue-performance.md#большие-данные-меньше-реактивности)).

- **`shallowRef(x)`** реагирует только на замену `.value`. Проверено: `sr.value.count++` эффект не запускает, `sr.value = { … }` запускает. Подходит для ответов API, которые заменяются целиком, для иммутабельных обновлений (Immer, structural sharing) и для состояния внешних библиотек. В Nuxt 4 `data` у `useFetch` по умолчанию — `shallowRef`.
- **`triggerRef(sr)`** вручную уведомляет подписчиков `shallowRef` после мутации на месте, когда копировать большой массив дорого.
- **`shallowReactive(obj)`** реактивен только на верхнем уровне. `shr.nested` возвращается сырым (`isReactive` — `false`), а ref'ы в значениях не разворачиваются.
- **`readonly(x)`** — прокси, который запрещает запись (в dev — предупреждение `Set operation on key "a" failed: target is readonly`) и работает глубоко. `readonly(reactive(obj))` — **живое** представление: изменения через исходный прокси видны и запускают эффекты. Так отдают состояние наружу из composable или стора, не разрешая менять его в обход действий.
- **`markRaw(obj)`** ставит флаг `__v_skip`: объект не станет прокси, даже если его положить в `reactive`. Подходит для экземпляров карт, графиков, SDK-клиентов. Флаг стоит только на этом объекте, а не на его вложенных.
- **`toRaw(proxy)`** — исходник для чтения без трекинга и для API, которые не принимают прокси. Проверено: `structuredClone(reactive({ a: 1 }))` бросает `DataCloneError`, а с `toRaw` работает. То же касается `postMessage` и IndexedDB: они клонируют значение тем же алгоритмом.

Проверки — `isRef`, `isReactive`, `isReadonly`, `isProxy`, `unref`.

### `computed`: ленивость и кэш

`computed(getter)` — ref только для чтения, у которого значение вычисляется. Проверено со счётчиком вызовов геттера:

- **ленивость**: при создании геттер не вызывается. После изменения зависимостей тоже не вызывается, пока значение не прочитали. Две записи подряд и одно чтение дают один пересчёт;
- **кэш**: повторное чтение без изменения зависимостей возвращает сохранённое значение. Этим `computed` отличается от метода в шаблоне, который выполняется на каждом рендере. Обратная сторона: `computed(() => Date.now())` не обновится никогда, у него нет реактивных зависимостей;
- **стабильность (3.4+)**: подписчики перезапускаются, только если новое значение не равно старому по `Object.is`. `computed(() => n.value % 2)` при смене `n` с 1 на 3 эффект не будит. Для объектов значение новое при каждом вычислении. Геттер получает предыдущее значение аргументом (`computed((old) => …)`, с 3.4.0, #9497) и может вернуть его, если ничего не изменилось. Разбор — в [«Производительности Vue и Nuxt»](../performance/vue-performance.md#стабильность-computed).

С 3.5 `computed` подписывается на свои зависимости, только когда у него появился первый подписчик, и отписывается, когда подписчиков не осталось. Поэтому брошенный `computed` собирается GC. Алгоритм версий и `globalVersion` — в [«Мини-реактивности»](../live-coding/mini-reactivity.md#чем-настоящая-vue-3-5-отличается).

**Геттер без побочных эффектов.** Гайд требует, чтобы геттер только вычислял: не мутировал состояние, не делал запросов и не менял DOM. Причины следуют из модели. Неизвестно, когда и сколько раз геттер выполнится: может ни разу, если значение никто не читает. Мутация зависимости внутри геттера помечает его же грязным, а `items.value.sort()` в геттере сортирует исходный массив на месте (задача «Сортировка в computed» в [«Функциональных приёмах»](../javascript/functional-programming.md)). Для побочных эффектов есть `watch`.

**Writable computed.** `computed({ get, set })`. Сеттер не хранит значение сам, а пишет в источники. Следующее чтение пересчитает геттер. Запись в обычный `computed` в dev даёт предупреждение `Write operation failed: computed value is readonly` и игнорируется. С 3.5 типы геттера и сеттера могут различаться. Значение, полученное из `computed`, не мутируют: это снимок, и изменение потеряется при пересчёте.

### `toValue` и `MaybeRefOrGetter`

Composable часто хочет принимать и значение, и ref, и геттер: `useTitle('x')`, `useTitle(titleRef)`, `useTitle(() => props.title)`. Тип для этого — `MaybeRefOrGetter<T> = T | Ref<T> | ComputedRef<T> | (() => T)`, нормализатор — `toValue(x)` (3.3+): вызывает функцию, разворачивает ref, остальное возвращает как есть. Важно вызывать `toValue` **внутри** эффекта или геттера `computed`. Тогда чтение происходит под трекингом, и composable реагирует на изменения. `unref` делает то же, но не вызывает геттеры. Геттер `() => props.id` предпочтительнее `toRef(props, 'id')` и `computed(() => props.id)`: он ничего не создаёт и не кэширует там, где кэш не нужен.

> [!NOTE]
> Во Vue 3.6 (RC, `3.6.0-rc.15`, сверено 2026-11-14) ядро `@vue/reactivity` переписано по образцу alien-signals, но публичный API реактивности не меняется. Все проверки этой темы на 3.6.0-rc.15 дали тот же вывод, что и на 3.5.45, включая аргумент `oldValue` у геттера `computed` и стабильность `computed`. Vapor Mode пользуется той же реактивностью. Стабильного 3.6 пока нет.

## Примеры

### Composable, который можно деструктурировать

```ts
import { reactive, readonly, toRefs, onScopeDispose } from 'vue'

export function useMouse() {
  const pos = reactive({ x: 0, y: 0 })
  const onMove = (e: PointerEvent) => { pos.x = e.clientX; pos.y = e.clientY }
  window.addEventListener('pointermove', onMove)
  onScopeDispose(() => window.removeEventListener('pointermove', onMove))
  // Refs survive destructuring; readonly keeps writes inside the composable
  return toRefs(readonly(pos))
}

// const { x, y } = useMouse()  → x.value is reactive, x.value = 1 warns
```

### `shallowRef` для данных, которые заменяются целиком

```ts
import { shallowRef, triggerRef } from 'vue'

const rows = shallowRef<Row[]>([])

async function load() {
  rows.value = await api.getRows() // replacement triggers; rows are not proxied
}

function appendInPlace(row: Row) {
  rows.value.push(row) // mutation does not trigger by itself...
  triggerRef(rows)     // ...so notify subscribers explicitly
}
```

### Writable computed поверх источника

```js
import { ref, computed } from 'vue'

const first = ref('Ada')
const last = ref('Lovelace')
const fullName = computed({
  get: () => `${first.value} ${last.value}`,
  set: (v) => { [first.value, last.value] = v.split(' ') } // writes to sources only
})
fullName.value = 'Grace Hopper' // first.value === 'Grace', getter recomputes on read
```

## Вопросы с интервью

::: details Чем ref отличается от reactive и что выбрать
`reactive` — `Proxy` над объектом: перехватывает чтение и запись свойств, работает только с объектами, массивами и коллекциями. `ref` — контейнер с геттером и сеттером `.value`, нужен потому, что `Proxy` не может оборачивать примитивы и переменные. Объект внутри `ref` становится `reactive`. Практическая разница: `ref` можно заменить целиком (`r.value = newObj`), передать в функцию и вернуть из composable без потери связи. `reactive` теряет реактивность при деструктуризации и при замене переменной. Гайд советует `ref` по умолчанию. `reactive` — для группы полей, которые меняются на месте, например состояния формы.
:::

::: details Зачем нужен .value и где его можно не писать
В JavaScript нельзя перехватить чтение локальной переменной, только свойства объекта. `.value` — то самое свойство, на геттере которого висит `track`, а на сеттере — `trigger`. Не писать `.value` можно в шаблоне для привязок верхнего уровня: компилятор `<script setup>` знает, что `count` — ref, и генерирует `count.value` или `_unref(x)`. Ещё — при чтении ref как свойства `reactive`-объекта: `state.count` отдаёт `count.value`, а запись пишет в ref. Не разворачиваются элементы массивов, значения `Map`/`Set`, свойства `shallowReactive` и вложенные ref'ы в обычном объекте в шаблоне: <code v-pre>{{ obj.foo + 1 }}</code> даст `[object Object]1`.
:::

::: details Почему деструктуризация reactive теряет реактивность и как это исправить
Реактивен доступ через прокси: `state.n` вызывает ловушку `get`. `const { n } = state` один раз читает значение и кладёт число в локальную переменную. Дальше ловушек нет. Исправление — `toRefs(state)`: каждый ref делегирует чтение и запись `state[key]`, поэтому связь двусторонняя. Это стандартный способ вернуть состояние из composable так, чтобы его можно было деструктурировать. Для одного свойства — `toRef(state, 'n')`, для props — геттер `() => props.n`. Деструктуризация `defineProps` в 3.5 реактивна только потому, что компилятор переписывает обращения в `__props.n`.
:::

::: details Почему reactive(obj) не равен obj и к чему это приводит
`reactive` возвращает прокси, исходник остаётся сырым. Прокси кэшируются в `WeakMap`, поэтому повторный `reactive(obj)` возвращает тот же прокси, а `reactive(proxy)` — сам прокси. Изменения через исходник не отслеживаются: если код держит ссылку на `raw` и мутирует его, UI не обновится. Сравнения `proxy === raw` ложны, а обычный `Set` или `Map` с исходниками не находит прокси. `includes` и `indexOf` у реактивного массива Vue инструментирует, они ищут и по исходнику. `toRaw` возвращает исходник, `markRaw` запрещает оборачивание. Отдельная ловушка — классы с `#private`-полями: методы вызываются с `this` = прокси и падают с `TypeError`.
:::

::: details Когда нужны shallowRef, shallowReactive, triggerRef и markRaw
Глубокая реактивность платит за каждый прочитанный вложенный объект: прокси и зависимость на каждое свойство. `shallowRef` реагирует только на замену `.value`. Он подходит для больших ответов API, иммутабельных обновлений и состояния внешних библиотек. Signals в Preact и Qwik гайд Vue прямо сравнивает с `shallowRef`. `triggerRef` уведомляет подписчиков после мутации на месте, когда копировать дорого. `shallowReactive` реактивен только на верхнем уровне. `markRaw` навсегда исключает объект из реактивности: экземпляры карт, графиков, SDK-клиентов, классов с приватными полями. Цена — нужно помнить, что мутации внутри не видны.
:::

::: details Чем computed отличается от метода и от watch
Метод в шаблоне вызывается на каждом рендере. `computed` кэширует результат и пересчитывает его лениво: только при чтении и только после изменения зависимостей. Если значение никто не читает, геттер не выполняется вовсе. С 3.4 подписчики `computed` просыпаются, только если значение изменилось по `Object.is`, а с 3.5 `computed` без подписчиков отписывается от зависимостей и собирается GC. `watch` — для побочных эффектов: запрос, запись в `localStorage`, работа с DOM. `computed` производит значение, `watch` реагирует на изменение. Геттер с побочными эффектами — ошибка: неизвестно, сколько раз и когда он выполнится.
:::

::: details Что такое writable computed и когда он нужен
`computed({ get, set })`. Сеттер не хранит значение, а переводит запись в изменения источников, после чего геттер пересчитывается при следующем чтении. Типичные применения: `fullName` поверх `first` и `last`, значение, ограниченное диапазоном, прокси для `v-model` поверх prop и emit (теперь это чаще делает `defineModel`). Запись в обычный `computed` в dev даёт предупреждение «computed value is readonly» и игнорируется. Мутировать объект, полученный из `computed`, нельзя: это снимок, изменения пропадут при пересчёте.
:::

::: details Зачем нужны toValue и MaybeRefOrGetter
Чтобы composable принимал значение, ref или геттер одинаково: `useTitle('x')`, `useTitle(titleRef)`, `useTitle(() => props.title)`. Тип параметра — `MaybeRefOrGetter<T>`, нормализация — `toValue(x)`: функцию вызывает, ref разворачивает, остальное возвращает как есть. Вызывать `toValue` нужно внутри `watchEffect`, геттера `computed` или `watch`-источника. Тогда чтение отслеживается, и composable реагирует на изменения. Если вызвать один раз при создании, получится снимок. `unref` делает то же, но геттеры не вызывает. Геттер дешевле `computed` и `toRef(props, 'x')`: он ничего не создаёт.
:::

## Задачи

### 1. Что выведет · легко

```js
import { ref, reactive } from 'vue'

const count = ref(1)
const state = reactive({ count, list: [ref(1)], map: new Map([['a', ref(1)]]) })

state.count++
console.log(count.value)
console.log(state.list[0] + 1)
console.log(state.map.get('a').value)
state.count = 10
console.log(count.value)
state.count = ref(20)
console.log(count.value, state.count)
```

::: details Решение и разбор
```
2
[object Object]1
1
10
10 20
```

- `state.count++` читает `count.value` (развёртка в `reactive`) и пишет в ref, поэтому `count.value === 2`.
- Элементы массива не разворачиваются: `state.list[0]` — сам ref, сложение вызывает `toString` объекта.
- Значения `Map` тоже не разворачиваются, поэтому нужен `.value`.
- Присвоение не-ref значения свойству, где лежит ref, пишет в `ref.value`.
- Присвоение нового ref **заменяет** старый: `state.count` теперь читает новый ref, а `count` остаётся `10` и больше не связан с `state`.
:::

### 2. Найдите баг · легко

Координаты в шаблоне всегда `0, 0`.

```js
export function useMouse() {
  const pos = reactive({ x: 0, y: 0 })
  const onMove = (e) => { pos.x = e.clientX; pos.y = e.clientY }
  window.addEventListener('pointermove', onMove)
  onScopeDispose(() => window.removeEventListener('pointermove', onMove))
  return { ...pos }
}

// const { x, y } = useMouse()
```

::: details Решение и разбор
```js
return toRefs(pos)
// or keep refs from the start:
// const x = ref(0), y = ref(0); return { x, y }
```

`{ ...pos }` один раз читает `x` и `y` и копирует числа в новый обычный объект. Обработчик потом меняет `pos`, но шаблон держит копии. `toRefs` возвращает ref'ы, которые читают и пишут `pos[key]`, поэтому деструктуризация на стороне вызова безопасна. Проверено: после `move(5, 5)` с `{ ...pos }` осталось `0`, с `toRefs` стало `5`. Если вызывающий не должен менять координаты, отдают `toRefs(readonly(pos))`. Composable в стиле VueUse обычно сразу возвращает объект из ref'ов: это контракт, который выдерживает деструктуризацию.
:::

### 3. Найдите баг · средне

Имя пользователя не появляется после загрузки. Но иногда, «когда что-то ещё меняется на странице», оно вдруг появляется.

```vue
<script setup>
import { reactive, onMounted } from 'vue'
import { api } from './api'

let user = reactive({ name: '', email: '' })

onMounted(async () => {
  user = reactive(await api.getUser())
})
</script>

<template>
  <p>{{ user.name }}</p>
</template>
```

::: details Решение и разбор
```vue
<script setup>
import { ref, onMounted } from 'vue'
import { api } from './api'

const user = ref({ name: '', email: '' })

onMounted(async () => {
  user.value = await api.getUser()
})
</script>
```

Рендер прочитал `user.name` у **первого** прокси и подписался на него. Присваивание создаёт новый прокси, а старый никто не меняет, поэтому рендер не перезапускается. «Иногда появляется» объясняется выводом компилятора: для `let user` он генерирует `_unref(user).name`, то есть render-функция читает переменную из замыкания. Любой перерендер по другой причине увидит новый объект. Проверено в happy-dom: после загрузки `<p></p>`, после изменения несвязанного `ref` — `<p>Ann</p>`.

Варианты исправления: `ref` и замена `.value` (реактивна по определению); `Object.assign(user, data)` с `const user = reactive(…)` (старые лишние ключи останутся); обёртка `reactive({ user: null })` с заменой свойства. Объявление через `const` поймало бы баг на этапе присваивания. `let` для реактивного состояния — тревожный признак.
:::

### 4. Что выведет · средне

```js
import { ref, computed, watchSyncEffect } from 'vue'

const a = ref(1)
let calls = 0
const double = computed(() => { calls++; return a.value * 2 })

console.log(calls)
console.log(double.value, double.value, calls)
a.value = 2
a.value = 3
console.log(calls)
console.log(double.value, calls)
a.value = 3
console.log(double.value, calls)

const parity = computed(() => a.value % 2)
let runs = 0
watchSyncEffect(() => { parity.value; runs++ })
a.value = 5
console.log(runs, calls)
```

::: details Решение и разбор
```
0
2 2 1
1
6 2
6 2
1 2
```

- Создание `computed` геттер не вызывает: `calls === 0`.
- Первое чтение вычисляет значение, второе берёт его из кэша.
- Записи помечают `double` грязным, но геттер не выполняется, пока значение никто не читает. Две записи — ноль пересчётов.
- Чтение после изменений — ровно один пересчёт.
- `a.value = 3` при текущем `3` — не изменение: сеттер ref сравнивает через `Object.is` и не вызывает `trigger`.
- `parity` пересчитывается (3 → 5), но результат `1` равен прежнему. С 3.4 подписчики `computed` в таком случае не перезапускаются, поэтому `runs` остаётся `1`. Сам `double` никто не читает, и `calls` не меняется.
:::

### 5. Что выведет · средне

```js
import { ref, reactive, toRaw } from 'vue'

const raw = { id: 1 }
const items = reactive([raw])
const selected = ref(null)
selected.value = raw

console.log(items[0] === raw)
console.log(items[0] === selected.value)
console.log(items.includes(selected.value))
const set = reactive(new Set([raw]))
console.log(set.has(raw), set.has(items[0]))
console.log(new Set([raw]).has(items[0]))
console.log(toRaw(items[0]) === raw)
```

::: details Решение и разбор
```
false
true
true
true true
false
true
```

- `items[0]` — прокси, созданный лениво при чтении, поэтому он не равен исходнику.
- `ref` с объектом кладёт в `.value` `reactive(raw)`. Прокси кэшируются в `WeakMap` по исходнику, поэтому `selected.value` и `items[0]` — **один и тот же** прокси.
- `includes`, `indexOf` и `lastIndexOf` у реактивного массива инструментированы: сначала ищут как есть, затем по `toRaw` аргумента.
- Реактивный `Set` в `has` тоже проверяет и сам ключ, и его исходник.
- Обычный `Set` ничего не знает о прокси: исходник и прокси для него разные значения. Типичный баг — `Set` выбранных id-объектов вне реактивности, заполненный из реактивного списка.
- `toRaw` возвращает исходник. Надёжнее сравнивать по `id`, а не по ссылкам на объекты.
:::

### 6. Реализуйте `useClamp` · средне

Composable принимает `source: Ref<number>` и границы `min`, `max`, каждая из которых — число, ref или геттер. Он возвращает ref, который читает значение, ограниченное диапазоном, и при записи сохраняет в `source` ограниченное значение. Изменение границ должно сразу отражаться на чтении.

::: details Решение и разбор
```ts
import { computed, toValue, type Ref, type MaybeRefOrGetter, type WritableComputedRef } from 'vue'

export function useClamp(
  source: Ref<number>,
  min: MaybeRefOrGetter<number>,
  max: MaybeRefOrGetter<number>
): WritableComputedRef<number> {
  // toValue is called inside the getter, so min/max are tracked
  const clamp = (v: number) => Math.min(Math.max(v, toValue(min)), toValue(max))
  return computed({
    get: () => clamp(source.value),
    set: (v) => { source.value = clamp(v) }
  })
}
```

Проверено: при `source = 15` и `max = ref(10)` чтение даёт `10`. После записи `-5` и `source`, и результат равны `0`. После `max.value = 3` и `source.value = 7` чтение даёт `3`. Граница-геттер `() => 1` работает так же.

Разбор:

- `toValue` вызывается **внутри** геттера `computed`, поэтому чтение `max.value` или вызов геттера отслеживаются. Если нормализовать один раз при создании (`const hi = toValue(max)`), изменение границы не будет видно.
- Writable `computed` не хранит значение: сеттер пишет в источник, геттер пересчитывается при чтении. Отдельный `ref` с `watch` для синхронизации дал бы два источника истины и рассинхрон между ними.
- Чтение ограничивает даже значение, записанное в `source` в обход composable. Если нужен инвариант именно в данных, ограничение применяют и в сеттере, как здесь.
- Тип возврата — `WritableComputedRef<number>`, его можно передать в `v-model`.
:::

## Источники

- [Vue.js: Reactivity Fundamentals](https://vuejs.org/guide/essentials/reactivity-fundamentals.html)
- [Vue.js: Computed Properties](https://vuejs.org/guide/essentials/computed.html)
- [Vue.js: Reactivity API — Core](https://vuejs.org/api/reactivity-core.html)
- [Vue.js: Reactivity API — Utilities (`toRef`, `toRefs`, `toValue`)](https://vuejs.org/api/reactivity-utilities.html)
- [Vue.js: Reactivity API — Advanced (`shallowRef`, `triggerRef`, `markRaw`, `toRaw`)](https://vuejs.org/api/reactivity-advanced.html)
- [Vue.js: Reactivity in Depth](https://vuejs.org/guide/extras/reactivity-in-depth.html)
- [Vue.js: Composables — Input Arguments](https://vuejs.org/guide/reusability/composables.html#input-arguments)
- [Announcing Vue 3.3 (`toValue`, `toRef` с геттером)](https://blog.vuejs.org/posts/vue-3-3)
- [Announcing Vue 3.4 (стабильность `computed`)](https://blog.vuejs.org/posts/vue-3-4)
- [Announcing Vue 3.5](https://blog.vuejs.org/posts/vue-3-5)
- [`vuejs/core` CHANGELOG.md (3.4.0: `expose last result for computed getter`, #9497)](https://github.com/vuejs/core/blob/main/CHANGELOG.md)
- [Исходники Vue 3.5.45: `reactivity/src/ref.ts`, `reactive.ts`, `baseHandlers.ts`, `computed.ts`, `arrayInstrumentations.ts`](https://github.com/vuejs/core/tree/v3.5.45/packages/reactivity/src)
- [`vuejs/core` CHANGELOG.md, ветка `minor` (3.6: порт alien-signals)](https://github.com/vuejs/core/blob/minor/CHANGELOG.md)
