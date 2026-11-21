---
title: Как устроена реактивность
level: ядро
---

# Как устроена реактивность

> **Коротко.** `Proxy` перехватывает операции над объектом: чтение вызывает `track`, запись — `trigger`. Подписки хранятся в `targetMap: WeakMap<target, Map<key, Dep>>`. С 3.5 связь «зависимость ↔ подписчик» — объект `Link`, узел сразу двух двусвязных списков, а лишние перезапуски отсекают счётчики версий: эффект запускается, только если версия хоть одной его зависимости выросла. `computed` подписывается на источники лениво, только когда у него есть подписчик, поэтому брошенный `computed` собирается GC. Сама реактивность синхронна. Пакетирует обновления планировщик `runtime-core`: очередь заданий, отсортированная по `id` компонента, сбрасывается одной микрозадачей.

**Связанные темы:** [Реактивность: `ref`, `reactive`, `computed`](./reactivity.md), [Мини-реактивность в стиле Vue](../live-coding/mini-reactivity.md), [Дескрипторы свойств, `Proxy` и `Reflect`](../javascript/property-descriptors-and-proxy.md), [`watch` и `watchEffect`](./watchers.md), [Жизненный цикл](./lifecycle.md), [Event loop](../javascript/event-loop.md), [Производительность Vue и Nuxt](../performance/vue-performance.md), [Память и сборка мусора](../javascript/memory-and-gc.md), [Утечки памяти](../performance/memory-leaks.md)

## Теория

Все утверждения проверены на исходниках и сборке `@vue/reactivity` и `@vue/runtime-core` 3.5.45 в Node 26.13.1. Компоненты рендерились через `createRenderer` с минимальным набором `nodeOps`, вывод компилятора получен из `@vue/compiler-sfc`. Модель пользователя (`ref`, `reactive`, `computed`, развёртка `.value`) — в теме [«Реактивность: `ref`, `reactive`, `computed`»](./reactivity.md). Учебная реализация с `Set` и флагом dirty — в [«Мини-реактивности»](../live-coding/mini-reactivity.md). Здесь — чем настоящая реализация отличается от учебной и почему.

### Почему `Proxy`, а не `defineProperty`

Vue 2 при создании обходил объект и превращал каждое существующее свойство в аксессор. Поэтому он не видел добавление и удаление свойств (нужны были `Vue.set` и `Vue.delete`), запись по индексу массива и изменение `length`, не умел работать с `Map` и `Set` и платил за обход всего объекта ещё до первого рендера. `Proxy` перехватывает операции на уровне объекта, а не ключа: `get`, `set`, `deleteProperty`, `has` и `ownKeys`. Ключ, которого не было при создании, ловится так же, как существующий. Вложенные объекты оборачиваются лениво, при чтении. Как устроены ловушки, `receiver` и инварианты — в [«Дескрипторах свойств, `Proxy` и `Reflect»`](../javascript/property-descriptors-and-proxy.md#vue-от-defineproperty-к-proxy).

У `Map` и `Set` данные лежат во внутренних слотах, и ловушки их не видят. Для коллекций Vue подменяет методы (`get`, `set`, `has`, `forEach`, итераторы): они вызывают метод на сырой коллекции и сами вызывают `track` и `trigger`.

### Граф: `Dep`, подписчик и `Link`

Реактивность — двудольный граф. С одной стороны **зависимости** (`Dep`): одна на каждую пару «объект + ключ», одна на каждый `ref` и одна внутри каждого `computed`. С другой — **подписчики**: `ReactiveEffect` (рендер компонента, `watch`, `watchEffect`) и `ComputedRefImpl`. `computed` стоит в обеих долях: у него есть свой `dep` для читателей и свой список `deps` того, что читает он сам.

```text
targetMap: WeakMap<target, Map<key, Dep>>    // reactive(): one Dep per property
RefImpl.dep, ComputedRefImpl.dep             // ref / computed: one Dep each

Dep  { version, subs (tail), subsHead (dev), sc, activeLink, map, key }
Sub  { deps (head), depsTail, flags, next }  // ReactiveEffect | ComputedRefImpl
Link { sub, dep, version, nextDep, prevDep, nextSub, prevSub, prevActiveLink }
```

- **`Link` — узел двух списков.** По `nextDep`/`prevDep` подписчик обходит свои зависимости, по `nextSub`/`prevSub` зависимость обходит подписчиков. Одна связь — один объект, а в учебной версии это две записи: эффект в `Set` зависимости и `Set` в массиве эффекта. Удалить связь из обоих списков — O(1).
- **`activeSub` и `shouldTrack`.** Текущий подписчик — модульная переменная. `run()` сохраняет прежнее значение и восстанавливает его в `finally`, поэтому вложенные эффекты не ломают трекинг внешнего. `pauseTracking()` выключает `shouldTrack`: так выполняются мутирующие методы массивов.
- **`dep.activeLink`** указывает на связь с текущим подписчиком. Повторное чтение того же свойства в одном прогоне — проверка `link.sub === activeSub`, без поиска в `Set`.
- **`sc`** — счётчик подписчиков. Когда последний отписался, `Dep` удаляется из `Map` своего объекта (`dep.map.delete(dep.key)`). Таблица не копит пустые записи по ключам, которые больше никто не читает.

`targetMap` — `WeakMap`, поэтому ключи-объекты не удерживаются: когда на состояние не осталось ссылок, GC собирает его вместе с таблицей подписок.

### Версии вместо очистки

Набор зависимостей эффекта меняется от прогона к прогону: `ok ? a : b` читает то `a`, то `b`. Учебная версия перед каждым запуском удаляет эффект из всех `Set` и собирает подписки заново. Vue 3.5 делает это через версии ([PR #10397](https://github.com/vuejs/core/pull/10397), «version counting and doubly-linked list tracking», по образцу Preact Signals):

1. У `Dep` есть счётчик `version`, он растёт на каждом `trigger`. `Link` хранит версию зависимости, которую подписчик видел при последнем чтении.
2. `prepareDeps` перед прогоном ставит всем связям подписчика `version = -1`.
3. Чтение в прогоне восстанавливает версию связи и переносит связь в хвост списка. Порядок `deps` всегда совпадает с порядком чтения.
4. `cleanupDeps` после прогона удаляет связи, которые остались с `-1`: эту зависимость в этот раз не читали.

Связи, которые пережили прогон, не пересоздаются: при стабильном наборе зависимостей прогон не создаёт ни одного нового `Link`.

### Как подписчик решает, что он грязный

Запись не перезапускает подписчика сразу. Сначала она только **уведомляет**: эффект попадает в батч, `computed` получает флаг `DIRTY` и уведомляет своих читателей дальше по графу. Решение «запускаться или нет» принимается позже, в `isDirty(sub)`. Функция обходит зависимости подписчика по порядку:

- если `dep.version !== link.version`, значит зависимость изменилась после последнего чтения, и подписчик грязный;
- если зависимость — `computed`, сначала вызывается `refreshComputed`. `computed` пересчитывается, и его `dep.version` растёт, **только если** новое значение отличается от прежнего по `hasChanged` (`Object.is`).

Поэтому `computed(() => n.value % 2)` при смене `n` с 1 на 3 пересчитывается, но его версия не растёт, и читатель не запускается. Задание рендера компонента — это `effect.runIfDirty`: компонент, который читает только такой `computed`, не перерисовывается вовсе. Проверено: после `n.value = 6` при прежней чётности перерисовался только дочерний компонент, читающий `n` напрямую, а родитель — нет.

У `refreshComputed` два быстрых выхода:

- **`globalVersion`.** Глобальный счётчик растёт на каждом `trigger`. Если он не изменился с прошлого вычисления, ни одна зависимость в программе не менялась, и `computed` отдаёт кэш без обхода зависимостей.
- **`isDirty(computed)`.** Если глобальный счётчик вырос, но версии зависимостей этого `computed` прежние, пересчёта нет. Проверено: после записи в посторонний `ref` геттер не вызвался.

Обход идёт сверху вниз: подписчик спрашивает источники, источники — свои источники. Поэтому в «ромбе» (`b` и `c` зависят от `a`, `d` — от `b` и `c`) после записи в `a` каждый геттер выполняется ровно один раз, а эффект никогда не видит `d`, посчитанный по старому `b` и новому `c`. Такую несогласованность называют **glitch**. Проверено: счётчики `b`, `c`, `d` и эффекта после записи — `1 1 1 1`.

### Ленивые подписки `computed` и утечка на SSR

`addSub` вписывает связь в список подписчиков зависимости, только если у подписчика стоит флаг `TRACKING`. Обычный эффект получает его при создании. `computed` получает его вместе с первым подписчиком: тогда он рекурсивно подписывается на свои зависимости. Когда последний подписчик уходит, `removeSub` снимает флаг и отписывает `computed` от источников.

`computed`, который читают вне эффекта, держит ссылки на свои зависимости, но они на него не ссылаются. Проверено: после `c.value` без эффекта у зависимостей `c` пустой `subs`. После создания эффекта, читающего `c`, подписка появилась, после его остановки снова исчезла. Три таких `computed` над глобальным `reactive` после `gc()` были собраны (`FinalizationRegistry`).

До 3.5 `computed` подписывался на источники сразу. `computed` над долгоживущим состоянием (глобальный стор, модульная переменная) оставался в списке подписчиков этого состояния, пока его явно не остановят. На сервере каждый запрос создаёт свои компоненты и свои `computed`, а эффекты рендера на SSR не живут. Висящие подписки на модульное состояние копились от запроса к запросу. В PR #10397 это сформулировано так: `computed` «more reliably garbage-collected, including in SSR». Итог рефакторинга на тесте «1000 ref + 2000 computed (1000 цепочек по два) + 1000 effect»: 1426k → 631k, **−56 % памяти**. В бенчмарках «single ref invoking multiple effects» стал быстрее на 118–185 %, «reading multiple invalidated computeds» — на 176–244 %.

### Батчинг: `startBatch` и `endBatch`

`dep.trigger()` увеличивает `dep.version` и `globalVersion` и вызывает `notify`. Уведомление обёрнуто в `startBatch()`/`endBatch()` со счётчиком глубины `batchDepth`:

- уведомлённый подписчик получает флаг `NOTIFIED` и встаёт в односвязный список `batchedSub` через поле `next`, без массивов и `Set`. Повторное уведомление в том же батче ничего не добавляет;
- `computed` при уведомлении ставит себе `DIRTY` и уведомляет **свой** `dep`, поэтому сигнал доходит до эффектов через любую глубину цепочки;
- эффекты запускаются только при выходе из самого внешнего батча (`--batchDepth === 0`). Каждый вызывает `trigger()`: без планировщика это `runIfDirty`, с планировщиком — постановка в очередь;
- подписчики обходятся от хвоста к голове, а батч складывает их в стек. В итоге эффекты запускаются в порядке подписки. Проверено: три эффекта на одном `ref` отработали как `ABC`.

Один `trigger` может затронуть несколько `Dep`, и он тоже обёрнут в батч. `arr.length = 0` трогает `length`, отрезанные индексы и `ARRAY_ITERATE_KEY`, но эффект, читавший всё это, запускается один раз. `push`, `pop`, `shift`, `unshift` и `splice` выполняются с выключенным трекингом внутри одного батча: `unshift` в массив из трёх элементов меняет четыре индекса и `length`, а эффект запускается один раз.

> [!WARNING]
> Батч охватывает один `trigger` или один мутирующий метод, а не синхронный кусок кода. Сырой `effect` из `@vue/reactivity` после `o.a++; o.b++` запускается **дважды**. `list.sort()` не входит в список методов без трекинга: он пишет индексы по одному, и эффект с `reduce` по массиву из четырёх элементов запустился четыре раза. В компонентах этого не видно: эффект рендера и watcher получают `scheduler`, и дубликаты схлопывает очередь планировщика.

`startBatch` и `endBatch` в 3.5 не входят в публичный API `vue`. Публичного `batch()`, как в Preact Signals, нет.

### Массивы: `ARRAY_ITERATE_KEY`

Наивный проход по реактивному массиву трекает каждый индекс. `for (let i = 0; i < list.length; i++) list[i]` по массиву из 1000 элементов создаёт 1001 связь: `length` и каждый индекс. [PR #9511](https://github.com/vuejs/core/pull/9511) (3.5) добавил специальный ключ `ARRAY_ITERATE_KEY`, который означает «зависимость от всего массива». Инструментированные методы — `map`, `filter`, `reduce`, `find`, `some`, `includes`, `indexOf`, `join`, итераторы и `for...of` — работают на сыром массиве и трекают этот один ключ. Проверено: `reduce` и `for...of` по тому же массиву дают одну связь вместо 1001.

- `trigger` запускает `ARRAY_ITERATE_KEY` при записи в целочисленный индекс и при изменении `length`. Запись в нечисловой ключ (`list.foo = 1`) его не трогает.
- `v-for` компилируется в `_renderList(items.value, …)`, а `renderList` читает массив через `shallowReadArray`. Список в шаблоне — одна зависимость, а не N.
- Цена — грубость. `find` и `some`, которые остановились на первом элементе, всё равно подписаны на весь массив и перезапустятся при записи в последний.
- Блог Vue 3.5 обещает до 10 раз более быстрые операции над большими глубоко реактивными массивами.

### Планировщик `runtime-core`

`@vue/reactivity` ничего не знает об очереди. Пакетирование «десять записей — один рендер» строится поверх `scheduler` эффекта:

```js
// runtime-core 3.5.45, setupRenderEffect (simplified)
const effect = new ReactiveEffect(componentUpdateFn)
const job = effect.runIfDirty.bind(effect) // re-render only if a dep really changed
job.id = instance.uid                      // parents are created first → smaller id
effect.scheduler = () => queueJob(job)
```

- **Очередь отсортирована по `id`.** `queueJob` кладёт задание в хвост, если его `id` не меньше последнего, иначе вставляет бинарным поиском (`findInsertionIndex`). Родитель обновляется раньше ребёнка. Проверено: при записи сначала в состояние ребёнка, потом родителя порядок — `parent, child`, и ребёнок рендерится один раз. Если родитель в этом сбросе убрал ребёнка из дерева, задание ребёнка не выполняется: размонтированный компонент не рендерится.
- **Дедупликация** — флаг `QUEUED` на самом задании: повторный `queueJob` до сброса ничего не делает.
- **`flush`.** Watcher с `flush: 'pre'` получает флаг `PRE` и тот же `id`, что и его компонент. Бинарный поиск ставит его перед заданием рендера. `flush: 'post'` уходит в `pendingPostFlushCbs`: этот список дедуплицируется, сортируется и выполняется после основной очереди. Проверено: `pre-watch, parent, child, post-watch`. Как выбирать `flush`, разобрано в [«`watch` и `watchEffect`»](./watchers.md#flush-и-планировщик).
- **Микрозадача.** Первая постановка вызывает `queueFlush`: `currentFlushPromise = resolvedPromise.then(flushJobs)`. `nextTick()` возвращает `currentFlushPromise || resolvedPromise`. Место этого сброса в цикле событий — в [«Event loop»](../javascript/event-loop.md#vue-пакетные-обновления-и-nexttick).
- **`RECURSION_LIMIT = 100`.** В dev-сборке `flushJobs` считает запуски каждого задания за один сброс. Больше 100 запусков — ошибка `Maximum recursive updates exceeded`: эффект меняет собственные зависимости. В prod-сборке проверки нет: тот же цикл крутится, пока рекурсивные вызовы `flushJobs` не переполнят стек (проверено: `RangeError: Maximum call stack size exceeded` примерно после 9400 рендеров).

Задания добавляются и во время сброса. Если после основной очереди и post-колбэков в очереди снова что-то есть, `flushJobs` вызывается ещё раз в той же микрозадаче.

> [!NOTE]
> Во Vue 3.6 (RC, `3.6.0-rc.16` от 2026-11-20, сверено по CHANGELOG ветки `minor` 2026-11-21) ядро `@vue/reactivity` переписано портом alien-signals ([PR #12349](https://github.com/vuejs/core/pull/12349), вошёл в 3.6.0-alpha.1). Узел графа — `ReactiveNode` с `deps`/`depsTail`/`subs`/`subsTail`. Списки остаются двусвязными, меняется алгоритм. При записи `propagate()` помечает подписчиков `Pending` (push), при чтении `checkDirty()` проверяет, изменилось ли что-то на самом деле (pull). Флаги — `Mutable`, `Watching`, `RecursedCheck`, `Recursed`, `Dirty`, `Pending`. В release notes обещано «significantly improves the reactivity system's performance and memory usage». Публичный API не меняется, Vapor Mode работает на той же реактивности. Стабильного 3.6 пока нет.

### Signals в других фреймворках

Гайд Vue прямо называет signals «the same kind of reactivity primitive as Vue refs»: контейнер значения, который трекает чтение и запускает эффекты при записи. Идея старше Vue: Knockout observables, Meteor Tracker, MobX.

- **Preact и Qwik:** интерфейс `.value`, по устройству ближе всего к `shallowRef`. Алгоритм Preact Signals (версии плюс связные списки) взят за основу рефакторинга 3.5.
- **Solid:** `createSignal()` разделяет чтение и запись: `[count, setCount]`. Гайд эмулирует это через `shallowRef`, а `equals: false` — через `triggerRef`.
- **Angular:** `signal(0)`, чтение вызовом `count()`, запись через `set` и `update`. Эмулируется через `shallowRef`.
- **Отличие Vue** — не примитив, а рендер. Vue перерисовывает компонент целиком через VDOM, а мелкую гранулярность добирает компилятором. Solid обновляет конкретный узел DOM прямо из эффекта. Vapor Mode — шаг Vue в ту же сторону.

Для отладки графа есть `onTrack`/`onTrigger` у `computed` и watcher'ов, у компонента — `onRenderTracked`/`onRenderTriggered`. Все они работают только в dev-сборке.

## Примеры

### Почему компонент не перерисовался

```js
import { ref, computed, watch, h, nextTick } from 'vue'

const n = ref(1)
const parity = computed(() => n.value % 2)

const Child = {
  setup: () => () => { log.push('child'); return h('i', String(n.value)) }
}
const Parent = {
  setup() {
    watch(n, () => log.push('pre-watch'))                     // flush: 'pre'
    watch(n, () => log.push('post-watch'), { flush: 'post' })
    return () => { log.push('parent'); return h('div', [String(parity.value), h(Child)]) }
  }
}

// after mount:
n.value = 2; n.value = 3; n.value = 4  // nothing runs synchronously
await nextTick()                       // pre-watch, parent, child, post-watch

n.value = 6                            // parity stays 0
await nextTick()                       // pre-watch, child, post-watch: parent is skipped
```

Три записи — одно задание каждого компонента (флаг `QUEUED`). Pre-watcher встаёт перед рендером своего компонента, родитель идёт раньше ребёнка, post-watcher — после всех рендеров. Во втором сбросе задание родителя вообще не ставится в очередь: `computed` пересчитался, но его версия не выросла.

### Сколько связей создаёт чтение массива

```js
import { reactive, effect } from '@vue/reactivity'

const list = reactive(Array.from({ length: 1000 }, (_, i) => i))
const count = (e) => { let n = 0; for (let l = e.deps; l; l = l.nextDep) n++; return n }

const loop = effect(() => { for (let i = 0; i < list.length; i++) list[i] }).effect
const sum = effect(() => list.reduce((a, b) => a + b, 0)).effect
console.log(count(loop), count(sum)) // 1001 1  (deps is internal: debugging only)
```

## Вопросы с интервью

::: details Почему Vue 3 перешёл с defineProperty на Proxy
`defineProperty` превращает в аксессор конкретное существующее свойство. Поэтому Vue 2 обходил весь объект при создании, не видел новых и удалённых свойств (нужны были `Vue.set`/`Vue.delete`), не ловил запись по индексу и `length` и патчил методы массивов. `Proxy` перехватывает операции над объектом целиком: `get`, `set`, `deleteProperty`, `has`, `ownKeys`. Новый ключ, удаление, `in` и `Object.keys` видны без особых API, вложенные объекты оборачиваются лениво при чтении. Цена — идентичность (`reactive(raw) !== raw`), невозможность обернуть примитив (отсюда `ref`) и отдельные обработчики для `Map`/`Set`, чьи данные лежат во внутренних слотах.
:::

::: details Как Vue узнаёт, от чего зависит эффект
Через глобальный текущий подписчик. `run()` ставит `activeSub = this`, выполняет функцию и в `finally` восстанавливает прежнее значение, поэтому вложенность не ломается. Каждое чтение реактивного свойства вызывает `track(target, key)`: в `targetMap: WeakMap<target, Map<key, Dep>>` находится или создаётся `Dep`, и между ним и `activeSub` создаётся `Link`. Запись вызывает `trigger`, который увеличивает версию `Dep` и уведомляет подписчиков. Зависимости определяются динамически, по фактическим чтениям в этом прогоне. Поэтому условная ветка, которую не выполнили, не подписывает. А `watchEffect` не видит того, что прочитано после первого `await`: к тому моменту `activeSub` уже восстановлен.
:::

::: details Что изменилось в реактивности Vue 3.5 и зачем
PR #10397 по образцу Preact Signals. Вместо пары `Set` на каждую связь — объект `Link`, узел двух двусвязных списков: зависимостей подписчика и подписчиков зависимости. Вместо очистки перед каждым прогоном — версии: связи помечаются `-1`, чтение их восстанавливает, после прогона удаляются непрочитанные. Подписчик запускается, только если версия хоть одной зависимости выросла. `computed` поднимает версию, только если значение изменилось. `globalVersion` даёт быстрый выход, когда в программе вообще ничего не менялось. `computed` подписывается на источники лениво, только при появлении подписчика. Итог: −56 % памяти на тесте «1000 ref + 2000 computed + 1000 effect» и исчезнувшие утечки `computed` на SSR. Отдельно PR #9511 ввёл `ARRAY_ITERATE_KEY`: проход по массиву инструментированным методом — одна зависимость вместо N.
:::

::: details Как computed понимает, что пересчитывать ничего не нужно
Три уровня. Первый — `globalVersion`: если глобальный счётчик записей не изменился с прошлого вычисления, кэш верен. Второй — версии зависимостей: если ни у одной `dep.version` не ушла вперёд от версии в связи, пересчёта нет. Для зависимости-`computed` проверка рекурсивна: он сначала обновляется сам. Третий — результат: после пересчёта версия `computed` растёт, только если новое значение отличается по `Object.is`. Иначе его читатели остаются чистыми, и компонент не перерисовывается. Проверка идёт от читателя к источникам (pull), поэтому в ромбе каждый узел вычисляется один раз и эффект не видит промежуточного состояния.
:::

::: details Почему до 3.5 computed могли течь на сервере
До 3.5 `computed` подписывался на источники при создании, и источник держал ссылку на него, пока его не остановят. Если `computed` построен над долгоживущим состоянием (модульный стор, глобальный `reactive`), а создан в компоненте на каждый SSR-запрос, ссылки от состояния к `computed` копились от запроса к запросу. С 3.5 `computed` вписывается в список подписчиков источника, только когда его самого кто-то читает из эффекта, и выписывается, когда читателей не осталось. `computed`, прочитанный без эффекта (как на SSR), держит источники, но они его не держат, и GC его собирает. Общий вывод для SSR остаётся: модульное состояние разделяется между запросами, его нужно создавать на запрос.
:::

::: details Как устроен планировщик обновлений и почему родитель обновляется раньше ребёнка
Эффект рендера получает `scheduler`, который вызывает `queueJob(job)`, где `job` — `effect.runIfDirty`, а `job.id` — `uid` компонента. Родитель создаётся раньше ребёнка, поэтому его `id` меньше. Очередь держится отсортированной: вставка бинарным поиском, быстрый путь — в хвост. Дедупликация — флаг `QUEUED`. Сброс планируется одной микрозадачей `resolvedPromise.then(flushJobs)`, а `nextTick()` возвращает этот промис. Порядок по `id` даёт две вещи: ребёнок получает свежие props от уже обновлённого родителя, и задание ребёнка, которого родитель размонтировал, не выполняется. Pre-watchers встают перед рендером своего компонента, post-колбэки идут после всей очереди. В dev больше 100 запусков одного задания за сброс дают ошибку `Maximum recursive updates exceeded`.
:::

::: details Что такое signals и чем они отличаются от ref
Гайд Vue называет их тем же примитивом, что и `ref`: контейнер значения, чтение которого трекается, а запись запускает эффекты. Signals в Preact и Qwik — почти `shallowRef` с `.value`. В Solid и Angular — геттер-функция (`count()`) и отдельный сеттер. Гайд показывает, как построить оба API поверх `shallowRef` и `triggerRef`. Разница не в примитиве, а в рендере: Vue по-прежнему перерисовывает компонент и сравнивает VDOM, а Solid обновляет узел DOM прямо из эффекта. Внутри Vue сближается с signals: в 3.5 взяты версии и связные списки Preact Signals, в 3.6 (RC) ядро — порт alien-signals. Публичный API при этом не меняется.
:::

## Задачи

### 1. Что выведет: массив и `ARRAY_ITERATE_KEY` · легко

```js
import { reactive, effect } from '@vue/reactivity'

const list = reactive([3, 1, 2])
let a = 0, b = 0, c = 0
effect(() => { list.reduce((x, y) => x + y, 0); a++ })
effect(() => { for (let i = 0; i < list.length; i++) list[i]; b++ })
effect(() => { list[0]; c++ })

const reset = () => { a = b = c = 0 }
reset(); list[2] = 5;    console.log(a, b, c)
reset(); list.foo = 1;   console.log(a, b, c)
reset(); list.push(4);   console.log(a, b, c)
reset(); list.sort();    console.log(a, b, c)
```

::: details Решение и разбор
```
1 1 0
0 0 0
1 1 0
4 4 1
```

- Запись в индекс `2` запускает `ARRAY_ITERATE_KEY` (на нём `reduce`) и зависимость индекса `2` (на ней цикл). Третий эффект читает только `list[0]`.
- `foo` — не целочисленный ключ: `ARRAY_ITERATE_KEY` и `length` не трогаются, а `foo` никто не читал.
- `push` меняет индекс и `length`, но выполняется в одном батче без трекинга, поэтому каждый эффект запускается один раз.
- `sort` не инструментирован: он пишет четыре индекса по одному (`[3, 1, 5, 4]` → `[1, 3, 4, 5]`), и каждая запись — отдельный `trigger`. Сырые эффекты синхронны, поэтому четыре запуска. `list[0]` изменился один раз. В компоненте планировщик схлопнул бы это в один рендер.
:::

### 2. Что выведет: ромб и стабильный `computed` · средне

```js
import { ref, computed, effect } from '@vue/reactivity'

const a = ref(1)
let bc = 0, cc = 0, dc = 0, ec = 0
const b = computed(() => { bc++; return a.value + 1 })
const c = computed(() => { cc++; return a.value * 2 })
const d = computed(() => { dc++; return b.value + c.value })
effect(() => { d.value; ec++ })

bc = cc = dc = ec = 0
a.value = 2
console.log(bc, cc, dc, ec)

const n = ref(1)
const parity = computed(() => n.value % 2)
let runs = 0
effect(() => { parity.value; runs++ })
runs = 0
n.value = 3
console.log(runs)
```

::: details Решение и разбор
```
1 1 1 1
0
```

- Запись в `a` только уведомляет: `b` и `c` получают `DIRTY` и передают уведомление в `d`, `d` — эффекту. Эффект попадает в батч один раз (флаг `NOTIFIED`).
- При выходе из батча эффект вызывает `isDirty`. Тот обновляет `d`, а `d` при обходе своих зависимостей обновляет `b` и `c`. Каждый геттер выполняется ровно один раз, и `d` считается по новым `b` и `c`, без glitch.
- `parity` пересчитывается (`3 % 2`), но значение `1` прежнее, и `dep.version` не растёт. У эффекта нет изменившихся зависимостей, `runIfDirty` его не запускает.
- В учебной реализации с push-уведомлениями без версий эффект запустился бы во втором случае, а в ромбе мог бы увидеть `d`, посчитанный по старому `b`.
:::

### 3. Найдите баг: `Maximum recursive updates exceeded` · средне

После первой загрузки `items` в dev появляется ошибка, а в prod — `RangeError: Maximum call stack size exceeded`.

```vue
<script setup>
import { ref, onUpdated } from 'vue'

const items = ref([])
const renders = ref(0)

onUpdated(() => {
  renders.value++ // count renders for a debug badge
})
</script>

<template>
  <span class="badge">{{ renders }}</span>
  <ul><li v-for="item in items" :key="item.id">{{ item.title }}</li></ul>
</template>
```

::: details Решение и разбор
```js
let renders = 0 // plain variable: not reactive, does not schedule anything
onUpdated(() => {
  renders++
  console.debug('renders', renders)
})
```

Шаблон читает `renders`, значит, эффект рендера на него подписан. `onUpdated` выполняется после рендера (post-колбэк) и пишет в `renders`. Запись ставит задание рендера в очередь, и `flushJobs` видит его после post-колбэков и сбрасывает очередь ещё раз. Рендер снова вызывает `onUpdated`, и так без конца. В dev `checkRecursiveUpdates` считает запуски задания за сброс и после 100 бросает `Maximum recursive updates exceeded … a reactive effect that is mutating its own dependencies`. Проверено на 3.5.45. В prod-сборке этой проверки нет, и цикл кончается переполнением стека.

Правило: в `onUpdated`, `flush: 'post'`-watcher и render-функции не пишут в состояние, которое читает этот же рендер. Счётчик для отладки держат вне реактивности, а производное значение считают через `computed`. Для отладки графа есть `onRenderTriggered`: он показывает, какая запись вызвала рендер.
:::

### 4. Что выведет: порядок в планировщике · средне

```js
import { ref, h, nextTick } from 'vue'

const a = ref(1), b = ref(1), show = ref(true)
const log = []
const Child = {
  props: ['v'],
  setup: (p) => () => { log.push('child'); return h('i', `${p.v}:${b.value}`) }
}
const Parent = {
  setup: () => () => {
    log.push('parent')
    return h('div', show.value ? [h(Child, { v: a.value })] : [])
  }
}
// mounted, log cleared

b.value++; a.value++
await nextTick(); console.log(log.join()); log.length = 0

b.value++; show.value = false
await nextTick(); console.log(log.join())
```

::: details Решение и разбор
```
parent,child
parent
```

- Задание ребёнка встало в очередь первым, но у родителя `id` меньше, и бинарная вставка ставит его в начало. Родитель рендерится, при патче видит новые props и обновляет ребёнка синхронно. Когда очередь доходит до задания ребёнка, `runIfDirty` видит, что зависимости уже прочитаны в новых версиях, и рендера нет. Итого ребёнок рендерится один раз.
- Во втором случае родитель размонтирует ребёнка, его эффект останавливается, а задание пропускается. Рендера размонтированного компонента нет.
- Если бы очередь шла в порядке постановки, ребёнок отрендерился бы дважды, а во втором случае — ещё и перед размонтированием.
:::

### 5. Реализуйте `computed` на версиях · сложно

Реализуйте `signal(value)` и `computed(getter)` без списков подписчиков, только на версиях (pull). Каждый узел хранит `version`. `computed` помнит, какую версию каждой зависимости видел, и пересчитывается, только если хоть одна изменилась. Его собственная версия растёт, только если значение изменилось по `Object.is`. Если с последнего вычисления в программе не было ни одной записи, проверка зависимостей не нужна.

::: details Решение и разбор
```js
let activeSub = null
let globalVersion = 0

export function signal(value) {
  return {
    version: 0,
    get value() {
      activeSub?.deps.set(this, this.version) // remember the version we saw
      return value
    },
    set value(next) {
      if (Object.is(next, value)) return
      value = next
      this.version++
      globalVersion++
    },
  }
}

function isDirty(sub) {
  for (const [dep, seen] of sub.deps) {
    dep.refresh?.() // a computed dep re-evaluates first, possibly bumping its version
    if (dep.version !== seen) return true
  }
  return false
}

export function computed(getter) {
  let value
  const node = {
    version: 0,
    deps: new Map(), // dep -> version seen on the last evaluation
    globalVersion: -1,
    refresh() {
      if (node.globalVersion === globalVersion) return // nothing changed anywhere
      node.globalVersion = globalVersion
      if (node.version > 0 && !isDirty(node)) return  // deps unchanged: keep cache
      const prev = activeSub
      activeSub = node
      node.deps.clear() // dynamic deps: collect again
      try {
        const next = getter()
        if (node.version === 0 || !Object.is(next, value)) { value = next; node.version++ }
      } finally {
        activeSub = prev
      }
    },
    get value() {
      node.refresh()
      activeSub?.deps.set(node, node.version)
      return value
    },
  }
  return node
}
```

Проверено в Node 26 на цепочке `parity = n % 2` → `label = parity ? 'odd' : 'even'`. При `n` 1 → 3 `parity` пересчитался, а `label` нет. При 3 → 4 пересчитались оба. Повторное чтение и запись в посторонний `signal` геттеры не вызвали.

Разбор:

- Это pull-половина модели Vue: `isDirty` и `refreshComputed`. Без списков подписчиков нет push-уведомлений, поэтому эффекту пришлось бы опрашивать свои `computed` по таймеру или на каждом кадре. Vue дополняет схему двусвязными списками: запись проталкивает флаги `DIRTY`/`NOTIFIED`, и опрашиваются только уведомлённые подписчики.
- `Map` с версиями — упрощение `Link`. В Vue связь переиспользуется между прогонами (пометка `-1` и `cleanupDeps`), а `deps.clear()` выделяет память на каждый пересчёт.
- Исключение из геттера оставляет `node.globalVersion` обновлённым, и следующее чтение отдаст старый кэш. Vue в этом случае увеличивает `dep.version` и пробрасывает ошибку. Здесь нужно сбросить `node.globalVersion = -1` в `catch`.
- Нет защиты от цикла (`computed`, читающий сам себя) — Vue проверяет `activeSub !== this.computed`.

Сложность: чтение чистого `computed` без записей — O(1). После записи — O(размер подграфа зависимостей), каждый узел пересчитывается не больше одного раза.
:::

## Источники

- [Vue.js: Reactivity in Depth (в том числе «Connection to Signals»)](https://vuejs.org/guide/extras/reactivity-in-depth.html)
- [Vue.js: Reactivity API — Advanced](https://vuejs.org/api/reactivity-advanced.html), [Global API: `nextTick`](https://vuejs.org/api/general.html#nexttick)
- Исходники `@vue/reactivity` 3.5.45: [`dep.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/dep.ts), [`effect.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/effect.ts), [`computed.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/computed.ts), [`arrayInstrumentations.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/arrayInstrumentations.ts), [`collectionHandlers.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/collectionHandlers.ts)
- Исходники `@vue/runtime-core` 3.5.45: [`scheduler.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/scheduler.ts), [`renderer.ts` (`setupRenderEffect`)](https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/renderer.ts), [`helpers/renderList.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/helpers/renderList.ts)
- [PR #10397: Refactor reactivity system to use version counting and doubly-linked list tracking](https://github.com/vuejs/core/pull/10397)
- [PR #9511: optimize array tracking](https://github.com/vuejs/core/pull/9511)
- [Announcing Vue 3.5](https://blog.vuejs.org/posts/vue-3-5)
- [`vuejs/core` CHANGELOG.md, ветка `minor` (3.6.0-rc.16; порт alien-signals, #12349)](https://github.com/vuejs/core/blob/minor/CHANGELOG.md), [`system.ts` ветки `minor`](https://github.com/vuejs/core/blob/minor/packages/reactivity/src/system.ts)
- [Preact Signals: `packages/core/src/index.ts`](https://github.com/preactjs/signals/blob/main/packages/core/src/index.ts), [alien-signals](https://github.com/stackblitz/alien-signals)
- [MDN: `Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy), [`WeakMap`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap), [`FinalizationRegistry`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry)
