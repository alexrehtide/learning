---
title: EventEmitter
level: ядро
---

# EventEmitter

> **Коротко.** EventEmitter — реализация паттерна «наблюдатель» (observer): объект хранит для каждого имени события список слушателей, `on` добавляет слушателя, `off` или функция отписки убирает его, `emit` синхронно вызывает слушателей по порядку подписки. Базовая версия укладывается в 20 строк. На интервью проверяют, что происходит при изменении списка во время `emit`, как снять `once` по исходной функции, что делать с исключением в слушателе, синхронный emit или асинхронный и почему забытая отписка становится утечкой. Встроенная альтернатива — `EventTarget` + `CustomEvent` с отпиской через `AbortSignal`.

**Связанные темы:** [Замыкания](../javascript/closures.md), [Функции и `this`](../javascript/functions-and-this.md), [Event loop](../javascript/event-loop.md), [async/await, обработка ошибок и отмена](../javascript/async-await.md), [Память и сборка мусора](../javascript/memory-and-gc.md), [События и событийная модель](../browser/events.md), [Утечки памяти](../performance/memory-leaks.md), [Generics](../typescript/generics.md), [Утилиты промисов: `Promise.all` и компания, пул, retry](./promise-utilities.md), [curry, compose, memoize, once](./function-utilities.md)

## Теория

### Контракт

| Метод | Что делает |
| --- | --- |
| `on(event, fn)` | Добавляет слушателя в конец списка и возвращает функцию отписки |
| `off(event, fn)` | Убирает одну регистрацию `fn` |
| `once(event, fn)` | Слушатель, который снимается перед первым вызовом |
| `emit(event, ...args)` | Синхронно вызывает слушателей в порядке подписки и возвращает, были ли слушатели |

Решения, которые стоит проговорить вслух:

- **Хранилище.** `Map<event, listeners[]>`, а не объект: ключом может быть любая строка (`'__proto__'`, `'constructor'`) или символ, и не нужен `Object.create(null)`. Пустой список удаляется из `Map`, иначе ключи копятся.
- **Дубликаты.** Node.js разрешает подписать одну функцию дважды: она и вызовется дважды. `removeListener` снимает одну регистрацию, причём **последнюю** добавленную. `EventTarget` дубликаты игнорирует: слушатель определяется тройкой (`type`, `callback`, `capture`). Массив даёт поведение Node, `Set` — поведение DOM.
- **Функция отписки** из `on` удобнее `off`: не нужно хранить ссылку на обработчик, а стрелку из шаблона иначе не снять. Отписка должна быть идемпотентной и снимать **свою** регистрацию, а не первую попавшуюся с той же функцией.
- **`this` слушателя.** Node вызывает обычные функции с `this === emitter`. Стрелки берут `this` снаружи ([подробнее](../javascript/functions-and-this.md)).

### Изменение списка во время emit

Слушатель может подписать нового слушателя или отписать соседа прямо во время `emit`. Если перебирать живой массив, `splice` сдвинет индексы и следующий слушатель будет пропущен, а добавленный в конец вызовется в том же `emit`. Поэтому все реализации перебирают **снимок** — копию списка на момент начала `emit`. Различаются они в отписке:

| | Добавлен во время `emit` | Удалён во время `emit` |
| --- | --- | --- |
| Node.js `EventEmitter` | не вызывается | **вызывается** |
| mitt 3.0.1 | не вызывается | **вызывается** |
| DOM `EventTarget` | не вызывается | не вызывается |

Node документирует это прямо: `removeListener()` после начала `emit` не убирает слушателя из текущего вызова. DOM Standard в алгоритме inner invoke тоже берёт клон списка, но у каждой записи есть флаг `removed`: `removeEventListener` его ставит, и цикл пропускает такие записи. Поведение DOM ближе к ожиданиям: отписанный не должен получать событие. Так и сделано в задаче 2: слушатель хранится записью `{ fn, once, removed }`.

### once и off по исходной функции

Наивный `once` подписывает обёртку, и `off(event, fn)` с исходной функцией её не находит: слушатель остаётся. Node хранит исходную функцию в свойстве обёртки `wrapper.listener`, поэтому `off` и `listeners()` работают с ней, а `rawListeners()` возвращает обёртки. В реализации на записях хватает флага `once`: запись хранит исходную функцию, а `emit` снимает её **до** вызова. Порядок важен. Если слушатель `once` снова вызовет `emit` того же события, снятый заранее слушатель не сработает второй раз. В DOM Standard слушатель `once` тоже удаляется до вызова.

### Ошибки слушателей

| | Что происходит при исключении в слушателе |
| --- | --- |
| Node.js | исключение вылетает из `emit`, остальные слушатели **не вызываются** |
| DOM | исключение сообщается (report an exception: событие `error` на `window`, консоль), остальные слушатели вызываются, `dispatchEvent` возвращается нормально |

Для своего emitter разумный вариант — изоляция: вызвать всех, собрать ошибки, после цикла бросить одну ошибку или `AggregateError`. Вызывающий узнаёт о сбое, соседи не страдают. Альтернатива — `reportError(error)` в браузере. В Node.js 26 глобального `reportError` нет.

У Node отдельное правило для события `'error'`: если на него никто не подписан, `emit('error', err)` бросает `err`, а для значения не-`Error` бросает `ERR_UNHANDLED_ERROR`. Без обработчика процесс падает, поэтому слушателя `'error'` вешают всегда.

### Синхронный и асинхронный emit

`emit` синхронный во всех трёх реализациях: слушатели отработали до возврата из `emit`, как и при `dispatchEvent`. Это даёт предсказуемый порядок, и слушатель может отменить действие (`preventDefault`) до того, как источник продолжит работу. Цена: тяжёлый слушатель блокирует источник, а промис `async`-слушателя никто не ждёт. Отклонение такого промиса — это необработанный rejection, а не ошибка `emit`. В Node его ловит `captureRejections: true`: он перенаправляет отклонение в событие `'error'`.

Если источнику нужно дождаться слушателей (сохранение перед закрытием, плагины-хуки), пишут отдельные методы. `emitAsync` запускает всех и ждёт `Promise.allSettled`. `emitSerial` ждёт каждого по очереди, и первая ошибка обрывает цепочку (задача 3). Чтобы отложить сам вызов слушателей, достаточно `queueMicrotask` или `await` в начале: тогда `emit` гарантированно не вызывает чужой код синхронно ([подробнее](../javascript/event-loop.md)).

### Утечки и maxListeners

Emitter держит сильные ссылки на слушателей, слушатели через замыкание держат компонент, его состояние и DOM. Долгоживущий emitter (шина приложения, сокет, стор) без отписки — классическая утечка: каждое открытие экрана добавляет слушателя ([подробнее](../performance/memory-leaks.md)).

Node предупреждает, когда на одно событие подписано больше `10` слушателей: `MaxListenersExceededWarning: Possible EventEmitter memory leak detected`. Это не жёсткий лимит, слушатель всё равно добавляется. Порог меняют через `setMaxListeners(n)`, `0` отключает проверку. Для своего emitter то же самое — счётчик и одно предупреждение на событие.

Надёжнее всего не хранить ссылки на обработчики: `on(event, fn, { signal })`, один `AbortController` на владельца, `abort()` при уничтожении. Тонкость: если слушатель снят раньше через `off`, обработчик `abort` тоже нужно снять. Иначе долгоживущий сигнал продолжит держать запись и замыкание слушателя (задача 4).

### EventTarget и CustomEvent

В браузере и в Node.js `EventTarget` можно наследовать, и это готовый emitter: данные передаются в `detail` у `CustomEvent`, есть опции `once` и `signal`, дубликаты игнорируются, удалённые во время рассылки слушатели не вызываются, ошибки изолированы. Чего у него нет: возврата отписки из `addEventListener`, подстановочного `*`, способа узнать число слушателей, нескольких аргументов. Кроме того, на каждый вызов создаётся объект события. Для доменных событий в браузере `EventTarget` — разумный выбор без зависимостей. Как устроены всплытие и `signal` у DOM-узлов, разобрано в теме [События и событийная модель](../browser/events.md).

### Шина событий во Vue

Во Vue 2 экземпляр компонента был emitter: `$on`, `$off`, `$once`, и пустой `new Vue()` служил глобальной шиной. Vue 3 убрал эти методы. Экземпляр больше не реализует интерфейс emitter, `$emit` остался только для событий, которые слушает родитель. Migration Guide называет глобальную шину долгосрочной проблемой поддержки: поток данных не виден по коду, подписки текут, порядок событий неявный. Документация предлагает по порядку:

1. **Props и события** между родителем и ребёнком, соседи общаются через родителя.
2. **provide/inject** — для глубокой иерархии и содержимого слотов.
3. **Стор** (Pinia) — для общего состояния: состояние читают, а не ловят событием.
4. **Внешний emitter** (mitt или tiny-emitter) — если нужна именно шина: уведомления «произошло X» без состояния, интеграция с не-Vue кодом.

mitt 3.0.1 — около 200 байт: `Map` списков, `on`, `off`, `emit` со снимком через `slice()` и подстановочный `'*'`. Подстановочный слушатель получает `(type, event)`. `once` нет, `emit` передаёт один аргумент. `off(type)` без обработчика очищает все слушатели типа. Отписка устроена так: `splice(indexOf(handler) >>> 0, 1)`. Для отсутствующего обработчика `-1 >>> 0` даёт `4294967295`, и `splice` за концом массива ничего не делает. Тип шины задаётся картой событий `mitt<Events>()`, как в задаче [Generics](../typescript/generics.md).

> [!WARNING]
> Подписка в `setup()` на шину уровня модуля течёт при SSR. На сервере компонент не размонтируется, и `onScopeDispose` не срабатывает. Проверено на Vue 3.5.45: три `renderToString` оставили на шине три слушателя. Подписывайтесь в `onMounted`, который на сервере не вызывается. Сама шина на уровне модуля на сервере общая для всех запросов.

## Примеры

```js
// Built-in emitter: EventTarget + CustomEvent, unsubscribe via AbortSignal
class Cart extends EventTarget {
  add(item) {
    this.dispatchEvent(new CustomEvent('add', { detail: item })); // synchronous
  }
}
const cart = new Cart();
const controller = new AbortController();
cart.addEventListener('add', (e) => console.log(e.detail.id), { signal: controller.signal });
cart.add({ id: 1 }); // 1
controller.abort();  // removes every listener registered with this signal
cart.add({ id: 2 }); // nothing
```

```js
// Node.js: the snapshot keeps a removed listener in the current emit
import { EventEmitter, once } from 'node:events';
const e = new EventEmitter();
const b = () => console.log('b');
e.on('x', () => e.off('x', b));
e.on('x', b);
e.emit('x'); // 'b' — removal takes effect from the next emit

const [value] = await once(e, 'ready'); // promise of the next event; rejects on 'error'
```

## Вопросы с интервью

::: details Зачем emit перебирает копию списка и чем Node отличается от DOM
Слушатель может подписать или отписать кого-то во время рассылки. Перебор живого массива после `splice` пропустит следующего слушателя, а добавленный в конец вызовется в той же рассылке. Поэтому все берут снимок, и добавленные во время `emit` не вызываются. Различие — в удалённых. Node и mitt вызывают их, потому что слушатель уже есть в снимке, и Node это документирует. DOM Standard ставит записи флаг `removed` и пропускает её. Свой emitter лучше делать как DOM: отписанный не должен получать событие. Записи `{ fn, once, removed }` вместо голых функций решают это без дополнительных структур.
:::

::: details Почему off с исходной функцией не снимает once и как это исправить
`once` подписывает обёртку, а `off` ищет переданную функцию по ссылке и обёртку не находит. Node хранит исходную функцию в `wrapper.listener` и сравнивает с ней. Проще хранить запись с флагом `once` и исходной функцией. Снимать её надо до вызова: если слушатель повторно вызовет `emit` того же события, он не сработает дважды.
:::

::: details Что должно происходить, если слушатель бросил исключение
Зависит от контракта, его надо назвать. Node: исключение вылетает из `emit`, остальные слушатели не вызываются. Для `'error'` без подписчика `emit` бросает сам. DOM: ошибка сообщается через report an exception, остальные слушатели вызываются, `dispatchEvent` возвращается нормально. Для своей шины разумна изоляция: вызвать всех, собрать ошибки, после цикла бросить одну или `AggregateError`. Один сломанный подписчик не должен ломать соседей, но и проглатывать ошибку молча нельзя.
:::

::: details Синхронный или асинхронный emit и что будет с async-слушателем
Обычно синхронный: порядок предсказуем, слушатель успевает вмешаться (`preventDefault`) до продолжения работы источника. Async-слушатель возвращает промис, который `emit` игнорирует. Его ошибка становится необработанным rejection, а источник не знает, когда слушатель закончил. Если ждать нужно, пишут отдельный `emitAsync` (`Promise.allSettled`, параллельно) или `emitSerial` (по одному, первая ошибка останавливает). В Node `captureRejections: true` направляет отклонения async-слушателей в `'error'`.
:::

::: details Почему EventEmitter часто становится источником утечек и что делает maxListeners
Emitter держит слушателей сильными ссылками, слушатель через замыкание держит компонент и DOM. Если emitter живёт дольше подписчика, а отписки нет, каждое открытие экрана добавляет слушателя, и старые экземпляры не собираются. `maxListeners` в Node (по умолчанию 10) — только эвристика: при превышении выводится `MaxListenersExceededWarning`, но слушатель добавляется. Лечение — отписка при уничтожении: функция из `on`, `AbortSignal` владельца, `onScopeDispose` во Vue.
:::

::: details Когда хватит EventTarget и CustomEvent вместо своего emitter
Когда нужны доменные события в браузере или Node без зависимостей. `EventTarget` даёт `once`, `signal`, изоляцию ошибок, корректную отписку во время рассылки и защиту от дубликатов. Своя реализация или mitt нужны, если требуются функция отписки из `on`, подстановочный `*`, число слушателей, несколько аргументов без обёртки в `detail`, асинхронный emit или типизация через карту событий без `CustomEvent<T>` и перегрузок `addEventListener`.
:::

::: details Почему во Vue 3 убрали $on и $off и чем заменить шину событий
Экземпляр компонента перестал быть emitter, `$emit` остался только для событий родителю. Глобальная шина прячет поток данных: по коду не видно, кто слушает, подписки текут, в SSR шина уровня модуля общая для всех запросов. Замены по порядку: props и события, provide/inject для глубокой иерархии, Pinia для общего состояния. Если нужны именно уведомления, подойдёт mitt или tiny-emitter, подписка в composable с отпиской в `onScopeDispose`.
:::

## Задачи

### 1. EventEmitter: on, off, once, emit · легко

Реализуйте класс с методами `on` (возвращает функцию отписки), `off`, `once`, `emit` (возвращает `true`, если слушатели были). Слушатели получают все аргументы `emit`.

::: details Решение и разбор
```js
class EventEmitter {
  #events = new Map(); // event -> Function[]

  on(event, fn) {
    const list = this.#events.get(event);
    if (list) list.push(fn);
    else this.#events.set(event, [fn]);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const list = this.#events.get(event);
    if (!list) return;
    const i = list.lastIndexOf(fn); // like Node: the most recent registration
    if (i !== -1) list.splice(i, 1);
    if (list.length === 0) this.#events.delete(event);
  }

  once(event, fn) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      fn.apply(this, args);
    };
    return this.on(event, wrapper);
  }

  emit(event, ...args) {
    const list = this.#events.get(event);
    if (!list) return false;
    for (const fn of [...list]) fn.apply(this, args); // snapshot
    return true;
  }
}
```

Снимок `[...list]` обязателен: `once` вызывает `splice` прямо во время цикла. Проверка `i !== -1` тоже: `splice(-1, 1)` удалил бы последний элемент. Ограничения этой версии — предмет задачи 2. `off(event, fn)` не снимает `once(event, fn)`: в списке лежит обёртка. Отписанный во время `emit` слушатель всё равно вызывается. Исключение одного слушателя обрывает рассылку.

Сложность: `on` — O(1), `off` и `emit` — O(k), где k — число слушателей события.
:::

### 2. Корректный emit: снимок, once по исходной функции, ошибки · средне

Доработайте emitter. Слушатель, отписанный во время `emit`, не вызывается. `off(event, fn)` снимает и `once(event, fn)`. `once` срабатывает ровно один раз, даже если сам снова вызывает `emit`. Исключение слушателя не мешает остальным, а `emit` после цикла бросает его или `AggregateError`.

::: details Решение и разбор
```js
class EventEmitter {
  #events = new Map(); // event -> Array<{ fn, once, removed }>

  on(event, fn, { once = false } = {}) {
    const record = { fn, once, removed: false };
    const list = this.#events.get(event);
    if (list) list.push(record);
    else this.#events.set(event, [record]);
    return () => this.#remove(event, record); // removes exactly this registration
  }

  once(event, fn) {
    return this.on(event, fn, { once: true });
  }

  off(event, fn) {
    const record = this.#events.get(event)?.findLast((r) => r.fn === fn);
    if (record) this.#remove(event, record);
  }

  #remove(event, record) {
    if (record.removed) return; // idempotent
    record.removed = true;
    const list = this.#events.get(event);
    list.splice(list.indexOf(record), 1);
    if (list.length === 0) this.#events.delete(event);
  }

  emit(event, ...args) {
    const list = this.#events.get(event);
    if (!list) return false;
    const errors = [];
    for (const record of [...list]) {
      if (record.removed) continue; // removed during this emit
      if (record.once) this.#remove(event, record); // before the call: re-entrancy
      try {
        record.fn.apply(this, args);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `${errors.length} "${String(event)}" listeners failed`);
    return true;
  }
}
```

Запись вместо функции решает три проблемы сразу. Флаг `removed` повторяет DOM Standard: снимок защищает от сдвига индексов, флаг — от вызова отписанных. Исходная функция в записи позволяет `off` найти слушателя `once`. Функция отписки замкнута на свою запись, поэтому при двойной подписке одной функции снимает именно её. Проверено в Node 26: `once`, который внутри снова вызывает `emit('x')`, срабатывает один раз. Соседний `once` вызывается во вложенном `emit` и пропускается во внешнем по флагу.

Сложность: `emit` — O(k) времени и O(k) памяти на снимок, `off` — O(k).
:::

### 3. Подстановочный `*` и асинхронный emit · средне

Добавьте к emitter из задачи 2 слушателей `'*'`: они получают `(event, ...args)` после слушателей события. Добавьте `emitAsync` (все слушатели параллельно, промис ждёт всех и отклоняется `AggregateError`) и `emitSerial` (по одному, первая ошибка останавливает).

::: details Решение и разбор
```js
// Methods replacing/added to the class from task 2 (#events, on, #remove unchanged)
#calls(event, args) {
  if (event === '*') throw new TypeError('"*" is reserved for wildcard listeners');
  const own = this.#events.get(event) ?? [];
  const any = this.#events.get('*') ?? [];
  return [
    ...own.map((r) => [event, r, args]),
    ...any.map((r) => ['*', r, [event, ...args]]),
  ]; // the snapshot
}

#take(calls) {
  return calls.filter(([key, record]) => {
    if (record.removed) return false;
    if (record.once) this.#remove(key, record);
    return true;
  });
}

emit(event, ...args) {
  const calls = this.#calls(event, args);
  const errors = [];
  for (const call of calls) {
    if (this.#take([call]).length === 0) continue;
    const [, record, callArgs] = call;
    try { record.fn.apply(this, callArgs); } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors);
  return calls.length > 0;
}

async emitAsync(event, ...args) {
  const calls = this.#calls(event, args);
  await null; // listeners never run synchronously inside emitAsync
  const results = await Promise.allSettled(
    this.#take(calls).map(async ([, record, callArgs]) => record.fn.apply(this, callArgs)),
  );
  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason);
  if (errors.length) throw new AggregateError(errors);
}

async emitSerial(event, ...args) {
  const calls = this.#calls(event, args);
  await null;
  for (const call of calls) {
    if (this.#take([call]).length === 0) continue; // re-checked before each step
    const [, record, callArgs] = call;
    await record.fn.apply(this, callArgs);
  }
}
```

`emit('*')` запрещён: иначе подстановочные слушатели получили бы событие дважды. mitt такой случай не проверяет. `async`-обёртка в `map` превращает синхронное исключение слушателя в отклонённый промис, поэтому `allSettled` соберёт и его. Проверено в Node 26 на слушателях по 30 и 10 мс: `emitAsync` занимает время самого медленного слушателя, и быстрый финиширует первым, а `emitSerial` — сумму, в порядке подписки. `once` срабатывает один раз даже при двух одновременных `emitAsync`: запись снимается в `#take` синхронно, до первого `await`. `emitSerial` проверяет флаг перед каждым шагом: слушатель, отписанный предыдущим шагом, не вызывается.

Сложность: O(k + w), где w — число подстановочных слушателей.
:::

### 4. Отписка через AbortSignal и maxListeners · средне

Добавьте в `on` опцию `signal`: `abort()` снимает слушателя, уже отменённый сигнал не подписывает. Добавьте `maxListeners` (по умолчанию 10): при превышении — одно предупреждение на событие, слушатель всё равно добавляется.

::: details Решение и разбор
```js
maxListeners = 10;
#warned = new Set();

on(event, fn, { once = false, signal } = {}) {
  if (signal?.aborted) return () => {};
  const record = { fn, once, removed: false, dispose: null };
  const list = this.#events.get(event);
  if (list) list.push(record);
  else this.#events.set(event, [record]);
  this.#checkLeak(event, list?.length ?? 1);

  if (signal) {
    const onAbort = () => this.#remove(event, record);
    signal.addEventListener('abort', onAbort, { once: true });
    record.dispose = () => signal.removeEventListener('abort', onAbort);
  }
  return () => this.#remove(event, record);
}

#checkLeak(event, count) {
  if (this.maxListeners > 0 && count > this.maxListeners && !this.#warned.has(event)) {
    this.#warned.add(event);
    console.warn(`Possible memory leak: ${count} "${String(event)}" listeners (max ${this.maxListeners})`);
  }
}

#remove(event, record) {
  if (record.removed) return;
  record.removed = true;
  record.dispose?.(); // release the signal's reference to this record
  const list = this.#events.get(event);
  list.splice(list.indexOf(record), 1);
  if (list.length === 0) this.#events.delete(event);
}
```

Главная тонкость — `dispose`. Без него слушатель, снятый через `off`, функцию отписки или `once`, остаётся в списке `abort` сигнала. Сигнал часто живёт дольше (один контроллер на страницу или на весь компонент) и через `onAbort` держит запись и замыкание слушателя. Проверено в Node 26 через `getEventListeners(signal, 'abort')`: после `off` и после срабатывания `once` слушателей `abort` ноль. `signal.aborted` проверяется до подписки: `abort` на уже отменённом сигнале не придёт. Так же поступает `addEventListener`.

Сложность: проверка лимита — O(1), отписка — O(k).
:::

### 5. waitFor: промис из события · средне

Напишите `waitFor(emitter, event, { signal, timeout })` для emitter из задачи 2. Промис выполняется массивом аргументов события, отклоняется на событии `'error'`, по таймауту (`TimeoutError`) и по отмене. В любом исходе все подписки и таймер снимаются.

::: details Решение и разбор
```js
function waitFor(emitter, event, { signal, timeout } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted(); // a throw in the executor rejects the promise
    const cleanups = [];
    const settle = (fn, value) => {
      cleanups.forEach((cleanup) => cleanup());
      fn(value);
    };

    cleanups.push(emitter.on(event, (...args) => settle(resolve, args)));
    if (event !== 'error') {
      cleanups.push(emitter.on('error', (error) => settle(reject, error)));
    }
    if (timeout !== undefined) {
      const id = setTimeout(
        () => settle(reject, new DOMException(`"${String(event)}" timed out`, 'TimeoutError')),
        timeout,
      );
      cleanups.push(() => clearTimeout(id));
    }
    if (signal) {
      const onAbort = () => settle(reject, signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      cleanups.push(() => signal.removeEventListener('abort', onAbort));
    }
  });
}
```

Так же устроен `events.once(emitter, name, { signal })` в Node: массив аргументов, отклонение на `'error'`, `AbortError` по сигналу. Типичная ошибка — снять только основного слушателя. Тогда после успеха на emitter остаётся слушатель `'error'`, а таймер держит процесс и потом отклоняет уже выполненный промис (молча, но лишняя работа). `settle` идемпотентен по смыслу: после первого вызова слушатели уже сняты, повторный `emit` ничего не делает. Проверено в Node 26 на пяти исходах: событие, `'error'`, таймаут, отмена, заранее отменённый сигнал. Во всех случаях на emitter ноль слушателей.

Сложность: O(1) подписок, O(k) на отписку.
:::

### 6. Шина событий во Vue 3 · легко

Сделайте `createEventBus()` на mitt с composable `useListener(event, handler)`, который отписывается сам, когда компонент или effect scope уничтожается, и возвращает функцию ручной отписки. Учтите SSR.

::: details Решение и разбор
```js
import { getCurrentScope, onScopeDispose } from 'vue';
import mitt from 'mitt';

export function createEventBus() {
  const bus = mitt();
  function useListener(event, handler) {
    bus.on(event, handler);
    const stop = () => bus.off(event, handler);
    if (getCurrentScope()) onScopeDispose(stop); // component or effectScope()
    return stop;
  }
  return { emit: bus.emit, useListener };
}

// Component: subscribe on the client only
// onMounted(() => useListener('toast', show));
```

`onScopeDispose` срабатывает и при размонтировании компонента, и при `effectScope().stop()`, поэтому composable работает вне компонентов. `getCurrentScope()` проверяется, чтобы вызов вне области не давал предупреждения: тогда отписка ручная. Внутри `onMounted` текущая область — область компонента, поэтому отписка привязывается к ней. Проверено на Vue 3.5.45 своим рендерером: после размонтирования на шине ноль слушателей. Подписка в `setup()` на сервере не снимается: три `renderToString` оставили три слушателя. Отсюда `onMounted` для подписок на шину уровня модуля. Сначала стоит спросить, нужна ли шина: если событие несёт состояние, его место в сторе.

Сложность: подписка — O(1), отписка — O(k).
:::

## Источники

- [DOM Standard — Interface `EventTarget`](https://dom.spec.whatwg.org/#interface-eventtarget): [add an event listener](https://dom.spec.whatwg.org/#add-an-event-listener), [remove an event listener](https://dom.spec.whatwg.org/#remove-an-event-listener), [inner invoke](https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke), [Interface `CustomEvent`](https://dom.spec.whatwg.org/#interface-customevent)
- [HTML Standard — report an exception](https://html.spec.whatwg.org/multipage/webappapis.html#report-an-exception)
- [Node.js 26 — Events](https://nodejs.org/api/events.html): [Asynchronous vs. synchronous](https://nodejs.org/api/events.html#asynchronous-vs-synchronous), [Error events](https://nodejs.org/api/events.html#error-events), [Capture rejections of promises](https://nodejs.org/api/events.html#capture-rejections-of-promises), [`setMaxListeners`](https://nodejs.org/api/events.html#emittersetmaxlistenersn), [`events.once`](https://nodejs.org/api/events.html#eventsonceemitter-name-options)
- [MDN — `EventTarget`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget), [`addEventListener()`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener), [`CustomEvent`](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent), [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal), [`reportError()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/reportError), [`AggregateError`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AggregateError)
- [Vue 3 Migration Guide — Events API](https://v3-migration.vuejs.org/breaking-changes/events-api.html)
- [Vue — Component Events](https://vuejs.org/guide/components/events.html), [Provide / Inject](https://vuejs.org/guide/components/provide-inject.html), [`onScopeDispose`](https://vuejs.org/api/reactivity-advanced.html#onscopedispose)
- [mitt 3.0.1 — исходный код](https://github.com/developit/mitt/blob/3.0.1/src/index.ts)
