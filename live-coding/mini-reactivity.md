---
title: Мини-реактивность в стиле Vue
level: ядро
---

# Мини-реактивность в стиле Vue

> **Коротко.** Реактивность в стиле Vue — это `Proxy`, у которого `get` записывает «кто меня прочитал» (`track`), а `set` перезапускает этих читателей (`trigger`). Читатель — эффект: функция, которая на время выполнения становится текущим подписчиком. Подписки хранятся в `WeakMap<target, Map<key, Set<effect>>>`. Поверх эффекта строятся ленивый `computed` с флагом dirty, `ref` и `watch`, а пакетирование даёт планировщик на микрозадаче. На интервью базовую версию пишут за 15 минут, а потом спрашивают про вложенные эффекты, условные ветки, бесконечные циклы и про то, чем настоящая Vue 3.5 отличается от учебной.

**Связанные темы:** [Дескрипторы свойств, Proxy и Reflect](../javascript/property-descriptors-and-proxy.md), [Event loop](../javascript/event-loop.md), [Замыкания](../javascript/closures.md), [Память и сборка мусора](../javascript/memory-and-gc.md), [Производительность Vue и Nuxt](../performance/vue-performance.md), [Утечки памяти](../performance/memory-leaks.md), [Стеки и очереди](../algorithms/stacks-and-queues.md), [EventEmitter](./event-emitter.md), [curry, compose, memoize, once](./function-utilities.md), [deepClone, deepEqual, get/set по пути](./object-utilities.md)

## Теория

Механика `Proxy`, `Reflect` и `receiver` — в теме [«Дескрипторы свойств, Proxy и Reflect»](../javascript/property-descriptors-and-proxy.md#vue-от-defineproperty-к-proxy). Здесь — что строится поверх ловушек. Все утверждения о Vue проверены на `@vue/reactivity` 3.5.45, решения задач — в Node 26.

### Контракт

| API | Что делает |
| --- | --- |
| `reactive(obj)` | Прокси: чтение подписывает текущий эффект, запись перезапускает подписчиков |
| `effect(fn)` | Выполняет `fn` сразу и повторно при изменении всего, что `fn` прочитала |
| `computed(getter)` | Ленивое кэшированное значение: пересчёт только при чтении после изменения |
| `ref(value)` | Контейнер с `.value` для примитивов: `Proxy` умеет только объекты |
| `watch(source, cb)` | Вызывает `cb(new, old)` при изменении источника, по умолчанию пакетно |

Модель — двудольный граф: **зависимости** (свойство объекта, `ref`, `computed`) и **подписчики** (эффект, `computed`, рендер компонента). `computed` — одновременно и то и другое.

### Хранилище зависимостей

`targetMap: WeakMap<target, Map<key, Set<effect>>>` — так же называется и в исходниках Vue.

- **`WeakMap` по объекту**: таблица не держит объект. Когда состояние больше никому не нужно, GC собирает его вместе с подписками. Ключ — сырой объект (`target`), а не прокси.
- **`Map` по ключу**: подписка точечная. Эффект, читавший `state.a`, не перезапускается от записи в `state.b`.
- **`Set` эффектов**: эффект, прочитавший свойство дважды, подписан один раз.

### Текущий эффект и стек

`track` должен знать, кто сейчас выполняется. Это глобальная переменная `activeEffect` (во Vue 3.5 — `activeSub`). Эффект ставит в неё себя, вызывает `fn` и восстанавливает прежнее значение в `finally`. Типичная ошибка — обнулять `activeEffect` после выполнения. При вложенности (рендер родителя создаёт ребёнка, эффект читает `computed`) внутренний эффект обнуляет переменную, и всё, что внешний прочитает **после** него, не трекается. Нужен стек или сохранение предыдущего значения: Vue делает второе (`prevEffect = activeSub`).

У вложенности есть вторая сторона: при перезапуске внешнего эффекта внутренний `effect()` создаётся заново, а старый продолжает жить. В Vue 3.5.45 это так же: сырой `effect` внутри эффекта дублируется. Компоненты защищены **effect scope**: все эффекты `setup()` собираются в scope и останавливаются вместе с ним ([«Утечки памяти»](../performance/memory-leaks.md)).

### Очистка зависимостей перед перезапуском

Эффект `() => { el.textContent = state.ok ? state.text : 'off' }` после `state.ok = false`  больше не читает `text`, но остался в его `Set`. Без очистки запись в `text` перезапустит эффект зря. Решение — обратные ссылки: эффект хранит список своих `Set` и перед каждым запуском удаляет себя из них, а `track` при выполнении записывает заново.

Здесь же ловушка: если `trigger` перебирает живой `Set`, то запуск эффекта удаляет его и снова добавляет. `Set.prototype.forEach` посещает добавленные во время обхода элементы, и цикл не кончается. Перебирать нужно копию.

### Бесконечные циклы

- **Эффект пишет то, что читает:** `effect(() => state.n++)`. Чтение подписало, запись перезапускает тот же эффект изнутри — переполнение стека. Защита — не запускать в `trigger` текущий `activeEffect`. Во Vue это флаг `RUNNING`: эффект не уведомляется, пока выполняется (если не задан `ALLOW_RECURSE`).
- **Два эффекта и `push`:** `push` читает `length` и пишет его, поэтому `effect(() => arr.push(1))` и `effect(() => arr.push(2))` перезапускают друг друга. Наивная реализация падает с `RangeError`, Vue 3.5.45 — нет: `push`, `pop`, `shift`, `unshift` и `splice` выполняются с выключенным трекингом (`pauseTracking`) внутри батча.

### `computed` и `ref`

`computed` — эффект с `lazy: true` и **планировщиком** (scheduler). Планировщик — функция, которую `trigger` вызывает вместо перезапуска эффекта. Для `computed` она не пересчитывает значение, а только ставит `dirty = true` и уведомляет тех, кто читал сам `computed`. Пересчёт происходит при следующем чтении `.value`. Поэтому `computed`, который никто не читает, не стоит ничего, а пять чтений подряд дают один вызов геттера.

Учебная версия уведомляет подписчиков, даже если новое значение совпадёт со старым: узнать это можно только пересчитав. Vue с 3.4 делает эту проверку лениво: подписчик перед запуском спрашивает свои зависимости-`computed`, изменились ли они (`isDirty` → `refreshComputed`). Если `computed(() => n.value % 2)` вернул прежнее значение, эффект не перезапускается.

`ref` — объект с геттером и сеттером `.value` и своим набором подписчиков: ключ всегда один. Сеттер сравнивает через `Object.is` (во Vue — `hasChanged`), чтобы `NaN → NaN` не вызывал обновление. Объект внутри `ref` оборачивается в `reactive`, поэтому `ref({ n: 1 }).value.n = 2` тоже реактивно. Нужен `ref` потому, что `Proxy` нельзя поставить на примитив, а переменную нельзя перехватить вообще.

### Планировщик, пакетирование и `watch`

В `@vue/reactivity` эффект без `scheduler` **синхронный**: `s.n++; s.n++` в Vue 3.5.45 дают два запуска. Vue пакетирует только эффекты внутри одного `trigger` (`startBatch`/`endBatch`). Пакетирование «десять присваиваний — один рендер» — заслуга `runtime-core`: эффект рендера получает `scheduler`, который ставит задание в очередь, а очередь сбрасывается одной микрозадачей. `nextTick()` возвращает промис этого сброса. Устройство очереди (дедупликация, сортировка по `id`) — в [«Event loop»](../javascript/event-loop.md#vue-пакетные-обновления-и-nexttick).

`watch(source, cb)` — ленивый эффект, геттер которого читает источник, а `scheduler` ставит в очередь задание: перезапустить геттер, сравнить с прежним значением и вызвать `cb(new, old, onCleanup)`. Глубокий `watch` — тот же геттер, обёрнутый в `traverse`: обход читает все вложенные свойства и тем самым подписывается на них. В обходе нужен `seen`, иначе циклическая ссылка повесит его. `flush: 'sync'` — это `scheduler`, который выполняет задание сразу.

### Ленивая глубокая реактивность

`reactive` не обходит объект при создании (так делал Vue 2 с `defineProperty`). Вложенный объект оборачивается в момент чтения: ловушка `get` возвращает `reactive(res)`. Чтобы `state.user === state.user`, прокси кэшируются в `WeakMap<raw, proxy>`. При записи в сырой объект кладётся `toRaw(value)`, иначе внутри данных окажутся прокси. Перечисление и проверка ключей тоже трекаются: ловушка `ownKeys` подписывает на специальный `ITERATE_KEY`, `has` — на ключ. Добавление и удаление свойства триггерят `ITERATE_KEY`, поэтому `Object.keys` и `v-for` по объекту видят новые ключи. У массива перечисление трекается через `length`, а укорочение `length` триггерит индексы за новой границей.

### Чем настоящая Vue 3.5 отличается

- **Двусвязные списки вместо `Set`.** Связь «зависимость ↔ подписчик» — объект `Link`, узел сразу двух списков: зависимостей подписчика (`nextDep`/`prevDep`) и подписчиков зависимости (`nextSub`/`prevSub`).
- **Версии вместо очистки.** У `Dep` есть счётчик `version`. Перед запуском `prepareDeps` ставит всем линкам эффекта `version = -1`, чтение восстанавливает версию, после запуска `cleanupDeps` удаляет линки с `-1`. Это та же очистка условных веток, но без пересоздания `Set` на каждый запуск.
- **`globalVersion`.** Любая запись увеличивает глобальный счётчик. Если он не менялся с прошлого вычисления, `computed` отдаёт кэш без проверки зависимостей.
- **Ленивые подписки `computed`.** `computed` подписывается на свои зависимости, только когда у него появляется подписчик, и отписывается, когда подписчиков не осталось. Поэтому непрочитанный `computed` собирается GC, в том числе на SSR.
- **Массивы и коллекции.** Методы массивов инструментированы: `map`, `filter`, `reduce`, итератор трекают один ключ `ARRAY_ITERATE_KEY` вместо каждого индекса. Для `Map`/`Set` отдельные обработчики вызывают методы на сырой коллекции, у `Map.keys()` свой `MAP_KEY_ITERATE_KEY`.
- **Итог** PR #10397: −56 % памяти на тесте «1000 ref + 2000 computed + 1000 effect».

> [!NOTE]
> Во Vue 3.6 (RC, `3.6.0-rc.15`, сверено 2026-11-13): ядро `@vue/reactivity` переписано портом alien-signals (PR #12349). Единый узел `ReactiveNode` с `deps`/`subs` остаётся на двусвязных списках, меняется алгоритм: при записи `propagate()` помечает подписчиков `Pending` (push), при чтении `checkDirty()` проверяет, изменилось ли что-то на самом деле (pull). Публичный API не меняется.

## Примеры

Учебная реактивность и настоящая на одном сценарии:

```js
import { reactive, effect } from '@vue/reactivity'; // 3.5.45
import { ref, watchEffect, nextTick } from 'vue';

const state = reactive({ n: 0 });
effect(() => console.log('effect', state.n));
state.n++;
state.n++;
// effect 0, effect 1, effect 2: raw effects are synchronous

const count = ref(0);
watchEffect(() => console.log('watchEffect', count.value));
count.value++;
count.value++;
await nextTick();
// watchEffect 0, watchEffect 2: the scheduler batched the runs
```

## Вопросы с интервью

::: details Почему зависимости хранятся в WeakMap, Map и Set
`WeakMap` по объекту не мешает GC: когда состояние больше никто не держит, оно собирается вместе с подписками. `Map` по ключу делает подписку точечной: запись в одно свойство не трогает читателей другого. `Set` дедуплицирует эффект, который читал свойство много раз. Если взять `Map` вместо `WeakMap`, каждый когда-либо созданный реактивный объект останется в памяти навсегда.
:::

::: details Зачем нужен стек активных эффектов
Эффекты вкладываются: рендер родителя создаёт рендер ребёнка, эффект читает `computed`, который сам эффект. Если внутренний эффект после выполнения обнулит `activeEffect`, чтения внешнего после него никуда не запишутся, и внешний перестанет реагировать на эти данные. Поэтому прежний эффект восстанавливают в `finally`: стеком или локальной переменной, как Vue.
:::

::: details Зачем очищать зависимости перед перезапуском эффекта
Набор зависимостей меняется от запуска к запуску: `ok ? a : b` читает либо `a`, либо `b`. Без очистки эффект остаётся подписанным на ветку, которую больше не читает, и перезапускается зря. Учебная версия удаляет эффект из всех его `Set` перед запуском. Vue 3.5 делает то же через версии линков: помечает все `-1`, чтение восстанавливает, после запуска удаляет непрочитанные.
:::

::: details Почему computed ленивый и чем он отличается от watch
`computed` при изменении зависимостей не пересчитывается, а только помечается dirty и уведомляет своих читателей. Пересчёт идёт при чтении, результат кэшируется до следующего изменения. Это чистое производное значение без побочных эффектов. `watch` — наоборот, побочный эффект: он сам перезапускает геттер при изменении и вызывает колбэк с новым и старым значением, по умолчанию пакетно перед рендером. С 3.4 подписчики `computed` ещё и не перезапускаются, если его новое значение равно старому.
:::

::: details Почему изменения во Vue применяются не сразу и при чём тут nextTick
Сама реактивность синхронна: сырой `effect` в `@vue/reactivity` перезапускается при каждой записи. Пакетирует планировщик `runtime-core`. Эффект рендера и `watch` получают `scheduler`, который ставит задание в очередь с дедупликацией, а очередь сбрасывается одной микрозадачей. Десять записей дают один рендер, и он успевает до отрисовки кадра. `nextTick()` возвращает промис этого сброса, поэтому после `await nextTick()` DOM уже обновлён.
:::

::: details Как получается, что реактивность глубокая, но reactive не обходит объект
Ловушка `get` оборачивает вложенный объект в момент чтения, и платят только за то, что прочитали. Повторный `reactive` того же объекта возвращает тот же прокси из кэша `WeakMap<raw, proxy>`, поэтому `state.user === state.user`. Vue 2 обходил объект целиком при создании, и большой ответ API стоил дорого ещё до первого рендера. Если глубина не нужна совсем — `shallowRef` или `markRaw`.
:::

## Задачи

### 1. `reactive` и `effect` · легко

Реализуйте `reactive(obj)` на `Proxy` и `effect(fn)`: `fn` выполняется сразу и повторно при записи в прочитанные ею свойства. Запись того же значения эффект не запускает.

::: details Решение и разбор
```js
const targetMap = new WeakMap();
let activeEffect = null;

function track(target, key) {
  if (!activeEffect) return;
  let depsMap = targetMap.get(target);
  if (!depsMap) targetMap.set(target, (depsMap = new Map()));
  let dep = depsMap.get(key);
  if (!dep) depsMap.set(key, (dep = new Set()));
  dep.add(activeEffect);
}

function trigger(target, key) {
  const dep = targetMap.get(target)?.get(key);
  if (dep) [...dep].forEach((effect) => effect());
}

export function reactive(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      track(target, key);
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      const oldValue = target[key];
      const result = Reflect.set(target, key, value, receiver);
      if (!Object.is(oldValue, value)) trigger(target, key);
      return result;
    },
  });
}

export function effect(fn) {
  const run = () => {
    activeEffect = run;
    try {
      fn();
    } finally {
      activeEffect = null;
    }
  };
  run();
  return run;
}
```

- `Reflect.get`/`Reflect.set` с `receiver` сохраняют правильный `this` у геттеров. Ловушка `set` обязана вернуть `boolean`: `false` в строгом режиме бросит `TypeError`.
- `Object.is` вместо `===`: запись `NaN` поверх `NaN` — не изменение.

Сложность: `track` и `trigger` — O(1) на ключ плюс O(k) на запуск k подписчиков.
:::

### 2. Стек эффектов, очистка и защита от рекурсии · средне

Доработайте решение задачи 1: вложенный эффект не ломает трекинг внешнего, `effect(() => state.ok ? state.text : 'off')` после `ok = false` не реагирует на `text`, а `effect(() => state.n++)` не уходит в бесконечную рекурсию.

::: details Решение и разбор
```js
const effectStack = [];
let activeEffect;

function track(target, key) {
  if (!activeEffect) return;
  // ...depsMap / dep as in task 1
  if (dep.has(activeEffect)) return;
  dep.add(activeEffect);
  activeEffect.deps.push(dep); // back reference for cleanup
}

function trigger(target, key) {
  const dep = targetMap.get(target)?.get(key);
  if (!dep) return;
  // copy: run() removes and re-adds the effect while we iterate
  for (const effect of [...dep]) {
    if (effect !== activeEffect) effect(); // no self-trigger
  }
}

function cleanup(effect) {
  for (const dep of effect.deps) dep.delete(effect);
  effect.deps.length = 0;
}

export function effect(fn) {
  const run = () => {
    cleanup(run);
    effectStack.push(run);
    activeEffect = run;
    try {
      return fn();
    } finally {
      effectStack.pop();
      activeEffect = effectStack.at(-1);
    }
  };
  run.deps = [];
  run();
  return run;
}
```

- Проверка: в версии из задачи 1 `effect(() => { effect(() => s.b); log(s.a); })` после `s.a = 2` молчит, в этой — перезапускается.
- Копия в `trigger` обязательна: `Set.prototype.forEach` по живому множеству, из которого удаляют и снова добавляют элемент, не заканчивается.
- Вложенный эффект при каждом запуске внешнего создаётся заново, и после `s.b = 2` срабатывают оба экземпляра. Vue 3.5.45 ведёт себя так же. Исправление — владение: внешний эффект запоминает детей и останавливает их перед перезапуском, как это делает effect scope компонента.

Сложность: очистка — O(d) на запуск, где d — число зависимостей эффекта.
:::

### 3. `computed` и `ref` · средне

Добавьте `effect(fn, { lazy, scheduler })`: `lazy` не запускает эффект сразу, `scheduler` вызывается из `trigger` вместо перезапуска. На этой основе реализуйте ленивый кэшированный `computed(getter)` и `ref(value)`.

::: details Решение и разбор
```js
// in trigger: (effect.scheduler ? effect.scheduler() : effect())
// in effect(): run.scheduler = scheduler; if (!lazy) run();

export function computed(getter) {
  let value;
  let dirty = true;
  const runner = effect(getter, {
    lazy: true,
    scheduler() {
      if (dirty) return;
      dirty = true;
      trigger(result, 'value'); // notify whoever read this computed
    },
  });
  const result = {
    get value() {
      if (dirty) {
        value = runner();
        dirty = false;
      }
      track(result, 'value');
      return value;
    },
  };
  return result;
}

export function ref(raw) {
  raw = toRaw(raw);
  let value = reactive(raw); // objects become deep reactive (task 5)
  const result = {
    get value() {
      track(result, 'value');
      return value;
    },
    set value(next) {
      if (Object.is(toRaw(next), raw)) return;
      raw = toRaw(next);
      value = reactive(raw);
      trigger(result, 'value');
    },
  };
  return result;
}
```

- `computed` — одновременно подписчик (его `runner` читает зависимости) и зависимость (`track(result, 'value')`). Цепочки `computed` от `computed` работают без особых случаев.
- `if (dirty) return` в планировщике: повторные изменения до чтения не уведомляют подписчиков снова. Если геттер бросит, `dirty` останется `true` и следующее чтение повторит вычисление.
- Чего нет: `computed(() => n % 2)` уведомляет подписчиков, даже когда значение не изменилось. Проверить это без пересчёта нельзя. Vue откладывает проверку до подписчика: тот перед запуском пересчитывает свои `computed` и запускается, только если версия хоть одного выросла.

Сложность: чтение чистого `computed` — O(1), грязного — стоимость геттера.
:::

### 4. Пакетирование, `nextTick` и `watch` · сложно

Реализуйте `queueJob(job)` (задание выполнится один раз в ближайшей микрозадаче, сколько бы раз его ни поставили) и `nextTick(fn?)` — промис после сброса очереди. Поверх `effect` со `scheduler` напишите `watch(source, cb, { immediate, deep, flush })`: `source` — геттер или реактивный объект (тогда глубоко), `cb(newValue, oldValue, onCleanup)`, `flush: 'sync'` без очереди, возвращает функцию остановки.

::: details Решение и разбор
```js
const queue = new Set();
const resolved = Promise.resolve();
let flushPromise = null;

export function queueJob(job) {
  queue.add(job); // Set dedupes: one run per flush
  flushPromise ??= resolved.then(flushJobs);
}

function flushJobs() {
  try {
    for (const job of queue) job(); // jobs queued during the flush run too
  } finally {
    queue.clear();
    flushPromise = null;
  }
}

export function nextTick(fn) {
  const p = flushPromise ?? resolved;
  return fn ? p.then(fn) : p;
}

function traverse(value, seen = new Set()) {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const key in value) traverse(value[key], seen); // reading = tracking
  return value;
}

export function watch(source, cb, { immediate = false, deep = false, flush = 'pre' } = {}) {
  let getter = typeof source === 'function' ? source : () => source;
  if (deep || typeof source !== 'function') {
    const base = getter;
    getter = () => traverse(base());
    deep = true;
  }
  let oldValue;
  let cleanupFn;
  const job = () => {
    if (!runner.active) return;
    const newValue = runner();
    if (!deep && Object.is(newValue, oldValue)) return;
    cleanupFn?.();
    cleanupFn = undefined;
    cb(newValue, oldValue, (fn) => (cleanupFn = fn));
    oldValue = newValue;
  };
  const runner = effect(getter, {
    lazy: true,
    scheduler: flush === 'sync' ? job : () => queueJob(job),
  });
  if (immediate) job();
  else oldValue = runner();
  return () => {
    stop(runner); // cleanup(runner); runner.active = false: a queued job becomes a no-op
    cleanupFn?.();
  };
}
```

- `s.q = 'b'; s.q = 'c'` дают один вызов `cb('c', 'a')`, а `'b'`, затем обратно `'c'` — ни одного: сравнение идёт при сбросе, а не при каждой записи.
- `onCleanup` вызывается перед следующим колбэком и при остановке. Это место для отмены устаревшего запроса.
- Глубокий режим не сравнивает значения: объект тот же, изменилось содержимое. Поэтому у глубокого `watch` `newValue === oldValue`, во Vue так же.
- Чего нет по сравнению с Vue: сортировка заданий по `id` и pre/post-очереди (разобраны в задаче «Планировщик в стиле Vue» темы [«Event loop»](../javascript/event-loop.md)), `RECURSION_LIMIT`, источники-массивы, `once`, `pauseTracking` на время колбэка.

Сложность: `queueJob` — O(1), сброс — O(n) заданий; `traverse` — O(размер графа).
:::

### 5. Ленивая глубокая реактивность · средне

Доработайте `reactive`. Вложенные объекты реактивны, но оборачиваются только при чтении; `reactive(raw) === reactive(raw)` и `reactive(proxy) === proxy`. `Object.keys(state)` и `'key' in state` реагируют на добавление и удаление свойств, у массивов `push` и `arr.length = 0` перезапускают читателей. В сырых данных никогда не оказываются прокси (`toRaw`).

::: details Решение и разбор
```js
const RAW = Symbol('raw');
const ITERATE_KEY = Symbol('iterate');
const proxyMap = new WeakMap();
const isObject = (v) => typeof v === 'object' && v !== null;
export const toRaw = (v) => (isObject(v) && v[RAW]) || v;

const handlers = {
  get(target, key, receiver) {
    if (key === RAW) return target;
    track(target, key);
    const res = Reflect.get(target, key, receiver);
    return isObject(res) ? reactive(res) : res; // lazy: wrap on read
  },
  set(target, key, value, receiver) {
    value = toRaw(value);
    const oldValue = target[key];
    const hadKey = Array.isArray(target) && /^\d+$/.test(key)
      ? Number(key) < target.length
      : Object.hasOwn(target, key);
    const ok = Reflect.set(target, key, value, receiver);
    if (ok && target === toRaw(receiver)) { // skip writes coming via the prototype chain
      if (!hadKey) trigger(target, key, 'add', value);
      else if (!Object.is(oldValue, value)) trigger(target, key, 'set', value);
    }
    return ok;
  },
  deleteProperty(target, key) {
    const hadKey = Object.hasOwn(target, key);
    const ok = Reflect.deleteProperty(target, key);
    if (ok && hadKey) trigger(target, key, 'delete');
    return ok;
  },
  has(target, key) {
    track(target, key); // 'key' in state
    return Reflect.has(target, key);
  },
  ownKeys(target) {
    track(target, Array.isArray(target) ? 'length' : ITERATE_KEY);
    return Reflect.ownKeys(target);
  },
};

export function reactive(target) {
  if (!isObject(target) || target[RAW]) return target;
  let proxy = proxyMap.get(target);
  if (!proxy) proxyMap.set(target, (proxy = new Proxy(target, handlers)));
  return proxy;
}

// trigger(target, key, type, newValue) also runs: for arrays, indexes >= newValue
// when 'length' shrinks and 'length' on 'add'; for objects, ITERATE_KEY on 'add'/'delete'
```

- `reduce` по реактивному массиву читает `length` и каждый индекс, поэтому `push`, запись по индексу и `length = 1` перезапускают сумму. Vue 3.5 вместо подписки на каждый индекс трекает один `ARRAY_ITERATE_KEY`.
- Кэш `proxyMap` даёт стабильную идентичность: без него `state.user !== state.user`, и `watch` по объекту срабатывал бы на каждое чтение.
- Два эффекта с `push` в один массив здесь падают с `RangeError` (см. «Бесконечные циклы»): Vue выполняет мутирующие методы массива без трекинга.
- Не покрыто: `Map`/`Set` (их методы работают со внутренними слотами и требуют отдельных обработчиков), `readonly`, `shallowReactive`, `markRaw`, `ref` внутри `reactive` (Vue разворачивает его при чтении).

Сложность: создание — O(1), независимо от размера объекта; каждое чтение вложенного объекта — O(1) поиск в кэше.
:::

## Источники

- [Vue — Reactivity in Depth](https://vuejs.org/guide/extras/reactivity-in-depth.html), [Reactivity API: Core](https://vuejs.org/api/reactivity-core.html), [Reactivity API: Advanced](https://vuejs.org/api/reactivity-advanced.html), [Watchers](https://vuejs.org/guide/essentials/watchers.html), [`nextTick`](https://vuejs.org/api/general.html#nexttick)
- Исходники `@vue/reactivity` 3.5.45: [`effect.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/effect.ts), [`dep.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/dep.ts), [`computed.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/computed.ts), [`baseHandlers.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/baseHandlers.ts), [`arrayInstrumentations.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/arrayInstrumentations.ts), [`watch.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/watch.ts); [`scheduler.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/scheduler.ts)
- [Announcing Vue 3.5](https://blog.vuejs.org/posts/vue-3-5), [PR #10397: version counting and doubly-linked list tracking](https://github.com/vuejs/core/pull/10397)
- [Vue 3.6: CHANGELOG ветки `minor`](https://github.com/vuejs/core/blob/minor/CHANGELOG.md), [`system.ts` (порт alien-signals)](https://github.com/vuejs/core/blob/minor/packages/reactivity/src/system.ts)
- [ECMAScript — Proxy Object Internal Methods](https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots), [`Set.prototype.forEach`](https://tc39.es/ecma262/#sec-set.prototype.foreach)
- [MDN — `Proxy`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy), [`WeakMap`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap)
