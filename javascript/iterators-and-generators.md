---
title: Итераторы и генераторы
level: ядро
---

# Итераторы и генераторы

> **Коротко.** Итерируемый объект (iterable) умеет отдать итератор по ключу `Symbol.iterator`. Итератор (iterator) — объект с методом `next()`, который возвращает `{ value, done }`. На этом протоколе стоят `for...of`, spread, деструктуризация массива, `Array.from`, `new Map(...)` и `Promise.all`. Если потребитель останавливается раньше времени, он вызывает у итератора `return()`, чтобы тот освободил ресурсы. Генератор — функция, которую можно приостановить: её вызов возвращает итератор, а тело выполняется по кускам, от `yield` до `yield`, по требованию потребителя. Асинхронный вариант — тот же протокол, только `next()` возвращает промис, а читает его `for await...of`.

**Связанные темы:** [Типы данных и приведение типов](./types-and-coercion.md), [Функции и `this`](./functions-and-this.md), [Прототипы и классы](./prototypes-and-classes.md), [Деструктуризация, spread/rest и современный синтаксис](./modern-syntax.md), [Event loop](./event-loop.md), [async/await, обработка ошибок и отмена](./async-await.md)

## Теория

### Два протокола: iterable и iterator

Протокол — это договорённость о форме объекта, а не класс или интерфейс в языке:

- **iterable** — объект, у которого метод `[Symbol.iterator]()` возвращает итератор;
- **iterator** — объект с методом `next()`, который возвращает **IteratorResult**: `{ value, done }`. Необязательные методы — `return(value)` (потребитель уходит раньше времени) и `throw(error)` (используется при делегировании `yield*`).

Разделение нужно, чтобы один источник можно было обходить многократно и параллельно: массив — iterable, и каждый `for...of` получает от него **новый** итератор со своей позицией. А сам итератор одноразовый: он помнит позицию и после `done: true` больше ничего не отдаёт.

Встроенные iterable: `Array`, `String` (по кодовым точкам, а не по UTF-16 code units), `Map`, `Set`, типизированные массивы, `arguments`, а в браузере — `NodeList`, `FormData`, `URLSearchParams`. Обычный объект **не** iterable: `for (const x of {})` — `TypeError: {} is not iterable`. Так задумано: у объекта нет одного очевидного порядка обхода («ключи? значения? пары?»), поэтому выбор явный — `Object.keys`, `Object.values`, `Object.entries`.

Кто потребляет протокол: `for...of`, spread `[...x]` и `f(...x)`, деструктуризация массива, `Array.from`, конструкторы `Map`/`Set`/`WeakMap`/`WeakSet`, `Object.fromEntries`, `Promise.all`/`race`/`allSettled`/`any`, `yield*`.

### `%IteratorPrototype%` и одноразовость

Все встроенные итераторы наследуют от `Iterator.prototype` (в спецификации — `%IteratorPrototype%`). Именно там живёт метод `[Symbol.iterator]() { return this; }`, поэтому **итератор сам является iterable** и его можно передать в `for...of`. Но второй обход вернёт пустоту:

```js
const it = [1, 2, 3].values();
[...it]; // [1, 2, 3]
[...it]; // [] — the same iterator, already done
```

Генератор-объект устроен так же: его `[Symbol.iterator]()` возвращает его самого. Отсюда частая ошибка: сохранить результат вызова генератора и обходить его дважды.

> [!WARNING]
> Итератор массива **живой**: на каждом `next()` он заново читает `length` и элемент по текущему индексу. Если удалить элемент во время `for...of`, следующий окажется пропущен; если добавить в конец — обход до него дойдёт. `Map` и `Set` тоже обходятся по порядку вставки и видят записи, добавленные во время обхода. Мутировать коллекцию во время обхода — запах кода.

### Закрытие итератора: `return()`

Если потребитель прекращает обход раньше времени — `break`, `return` из функции, исключение в теле `for...of`, деструктуризация `[a, b]` из длинного источника, — спецификация вызывает `IteratorClose`, то есть `iterator.return?.()`. Так итератор узнаёт, что пора освободить ресурс: закрыть файл, отписаться от события, отменить запрос.

`return()` **не** вызывается:

- при обычном завершении (`done: true`) — итератор закончился сам;
- если исключение бросил сам `next()` — считается, что сломанный итератор закрывать бессмысленно.

Если обход прервало исключение, а `return()` тоже бросил, наружу уходит **первое** исключение. Если же обход прервал `break`, ошибка из `return()` побеждает.

### Генераторы: функция, которую можно приостановить

`function*` при вызове **не выполняет тело**. Она возвращает генератор-объект — итератор, у которого внутри сохранён контекст исполнения функции: переменные, позиция, стек `try`. Состояния генератора по спецификации: `suspended-start` → `executing` → `suspended-yield` → … → `completed`.

- `next(v)` возобновляет тело. Выражение `yield`, на котором генератор стоял, получает значение `v`. Тело выполняется до следующего `yield x`, и `next` возвращает `{ value: x, done: false }`. `return x` в теле даёт `{ value: x, done: true }`.
- Аргумент **первого** `next()` теряется: генератор стоит в `suspended-start`, и нет `yield`, который мог бы его принять.
- `return(v)` возобновляет генератор так, будто на месте `yield` стоит `return v`: выполняются блоки `finally`, после чего генератор завершён. Если `finally` сам выполнит `yield`, генератор снова приостановится, и `return()` вернёт `done: false`.
- `throw(e)` возобновляет генератор так, будто `yield` бросил `e`: его можно поймать `try/catch` внутри тела.
- `return()` и `throw()` на генераторе в `suspended-start` сразу переводят его в `completed`: тело не начинало выполняться, поэтому никакой `finally` не срабатывает.
- Попытка возобновить генератор изнутри него самого — `TypeError: Generator is already running`.

`for...of`, spread и деструктуризация берут только значения с `done: false`. **Значение из `return` они игнорируют**: `[...gen]` не содержит того, что генератор вернул.

### `yield*`: делегирование

`yield* iterable` отдаёт все значения вложенного итератора, а кроме того **пробрасывает** внутрь вызовы `next(v)`, `throw(e)` и `return(v)` внешнего генератора. Значение выражения `yield*` — то, что вложенный генератор вернул через `return`. Так генераторы собираются из кусочков, а рекурсивный обход дерева пишется в три строки:

```js
function* walk(node) {
  yield node.value;
  for (const child of node.children) yield* walk(child);
}
```

> [!NOTE]
> Генератор — эквивалент машины состояний, которую компилятор (Babel, `regenerator`) и строит при транспиляции под ES5. На генераторах до появления `async/await` делали «корутины»: библиотека `co` возобновляла генератор, когда разрешался выданный им промис (см. задачу 5). `async`-функция — та же идея, встроенная в язык: `await` — это `yield` с автоматическим возобновлением.

### Iterator helpers (ES2025)

Глобальный `Iterator` и методы на `Iterator.prototype` дают итераторам ленивые аналоги методов массива:

| Ленивые (возвращают итератор) | Энергичные (обходят сразу) |
| --- | --- |
| `map`, `filter`, `take`, `drop`, `flatMap` | `reduce`, `toArray`, `forEach`, `some`, `every`, `find` |

Отличия от методов массива:

- **ленивость**: `map` и `filter` ничего не вычисляют, пока результат не начали читать. Поэтому можно работать с бесконечными последовательностями: `naturals().filter(isPrime).take(10)`;
- **один проход**: результат — итератор, обойти его повторно нельзя;
- колбэк получает `(value, counter)`, третьего аргумента «весь массив» нет;
- `take`, `some`, `every`, `find` **закрывают** исходный итератор (`return()`), как только ответ известен.

`Iterator.from(x)` приводит iterable или «голый» объект с `next()` к итератору, у которого есть эти методы. Массивы получают helpers через `arr.values()`.

> [!NOTE]
> `Iterator.concat(...iterables)` (ES2026, Baseline 2026) лениво склеивает iterable и закрывает текущий итератор при досрочном выходе. `Iterator.zip` (proposal Joint Iteration, stage 4, войдёт в ES2027; сверено 2026-11-11) склеивает итераторы попарно; в Node 26 его ещё нет. Асинхронных helpers (`asyncIterator.map`) в стандарте нет: proposal на stage 2.

### Асинхронная итерация

Асинхронный протокол повторяет синхронный: ключ `Symbol.asyncIterator`, `next()` возвращает **промис** IteratorResult. Его потребляет `for await...of` (в `async`-функции или на верхнем уровне модуля).

- `async function*` — асинхронный генератор: внутри доступны и `await`, и `yield`. `yield promise` дожидается промиса и отдаёт его значение.
- Вызовы `next()` ставятся в **очередь**: если вызвать `next()` дважды подряд, не дождавшись первого, второй выполнится после первого.
- `for await` по **синхронному** iterable (например, массиву промисов) оборачивает его и ждёт каждое значение по очереди.
- `Array.fromAsync` (ES2026) — асинхронный `Array.from`: собирает async iterable в массив, ожидая элементы по одному.

> [!WARNING]
> `for await (const x of [p1, p2])` — не замена `Promise.all`. Цикл ждёт `p1`, а отказ `p2`, случившийся раньше, в этот момент ещё никем не обработан: браузер генерирует `unhandledrejection`, а Node (режим по умолчанию `--unhandled-rejections=throw`) завершает процесс, хотя цикл обёрнут в `try/catch`. Для набора уже запущенных промисов нужен `Promise.all`/`allSettled`. `for await` подходит для потоков, где следующий элемент появляется только после запроса.

### Explicit resource management и итераторы

`using x = resource` (proposal Explicit Resource Management, stage 4, войдёт в ES2027) вызывает `x[Symbol.dispose]()` при выходе из блока. У `Iterator.prototype` есть `[Symbol.dispose]`, который вызывает `return()`. Поэтому `using it = gen()` гарантирует `finally` генератора, даже если его не дочитали.

> [!WARNING]
> `using` в Node 26 работает, но на MDN имеет статус «Limited availability»: в части основных браузеров его нет (сверено 2026-11-11). В клиентском коде — только через транспиляцию.

### Vue: итерируемые в шаблоне и реактивные коллекции

- `v-for` принимает любой iterable: `renderList` во Vue 3.5 проверяет `source[Symbol.iterator]` и вызывает `Array.from`. Итерируемое читается **при каждом рендере**. Если положить в `ref` генератор-объект, первый рендер его исчерпает, а после следующего обновления список окажется пустым. В `v-for` передавайте массив или iterable, который при каждом обходе выдаёт новый итератор (`Map`, `Set`, класс с `*[Symbol.iterator]`).
- Методы обхода у `reactive(new Map())` и `reactive(new Set())` возвращают **обёртку** над настоящим итератором: `Object.create(innerIterator)` со своим `next()`, который отдаёт значения через `toReactive`. Зависимость `ITERATE_KEY` регистрируется в момент **создания** итератора. `map.keys()` подписывается только на добавление и удаление ключей (`MAP_KEY_ITERATE_KEY`): изменение значения по существующему ключу эффект, который обходит ключи, не перезапускает.

## Примеры

### Свой iterable через генератор

```js
class Matrix {
  constructor(rows) {
    this.rows = rows;
  }
  // Each call returns a fresh generator, so the matrix can be iterated many times.
  *[Symbol.iterator]() {
    for (const row of this.rows) yield* row;
  }

  *cells() {
    for (const [r, row] of this.rows.entries()) {
      for (const [c, value] of row.entries()) yield { r, c, value };
    }
  }
}

const m = new Matrix([[1, 2], [3, 4]]);
Math.max(...m);                                    // 4
[...m.cells()].find((cell) => cell.value === 3);   // { r: 1, c: 0, value: 3 }
```

### Ленивый конвейер и закрытие источника

```js
function* readLines(lines) {
  console.log('open');
  try {
    for (const line of lines) yield line;
  } finally {
    console.log('close'); // runs on exhaustion, break, throw or take()
  }
}

const errors = readLines(['INFO a', 'ERROR b', 'INFO c', 'ERROR d', 'ERROR e'])
  .filter((line) => line.startsWith('ERROR'))
  .map((line) => line.slice(6))
  .take(2)
  .toArray();
// logs open, close; errors = ['b', 'd'] — 'ERROR e' is never read
```

### Поток событий как async iterable

```js
async function* streamEvents(url, { signal }) {
  const response = await fetch(url, { signal });
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock(); // break in the consumer lands here via return()
  }
}

for await (const chunk of streamEvents('/api/feed', { signal })) {
  if (chunk.includes('[DONE]')) break;
  render(chunk);
}
```

## Вопросы с интервью

::: details Чем итерируемый объект отличается от итератора и почему обычный объект не итерируем?
Iterable — объект, у которого метод `[Symbol.iterator]()` возвращает итератор. Итератор — объект с `next()`, возвращающим `{ value, done }`; он хранит позицию и одноразов. Разделение позволяет обходить один источник многократно и параллельно: каждый `for...of` по массиву получает новый итератор. Встроенные итераторы сами iterable (`[Symbol.iterator]` возвращает `this`), поэтому их можно передать в `for...of`, но только один раз. Обычный объект не iterable намеренно: у него нет единственного естественного порядка обхода, и язык заставляет выбрать явно — `Object.keys`/`values`/`entries`. Наличие `length` и индексов объект iterable не делает.
:::

::: details Что происходит при break в for...of и зачем итератору метод return?
При досрочном выходе — `break`, `return`, исключение в теле, неполная деструктуризация — выполняется `IteratorClose`: вызывается `iterator.return?.()`. Это сигнал источнику освободить ресурс. У генератора `return()` возобновляет тело как `return` на месте `yield`, поэтому выполняются блоки `finally`. При естественном завершении (`done: true`) и при исключении из самого `next()` `return()` не вызывается. Если тело цикла бросило исключение, а `return()` тоже бросил, наружу уходит первое исключение. Пример из практики: генератор, читающий файл или курсор БД, закрывает их в `finally`, и `take(10)` или `break` не оставляет ресурс открытым.
:::

::: details Как генератор работает как машина состояний и что делают next, return и throw?
Вызов генераторной функции не выполняет тело, а создаёт объект в состоянии `suspended-start` с сохранённым контекстом исполнения. `next(v)` возобновляет тело до следующего `yield`, а `v` становится значением того `yield`, на котором генератор стоял; аргумент первого `next` теряется. `return(v)` возобновляет так, будто на месте `yield` написано `return v`: выполняется `finally`, генератор завершается (если `finally` не сделает новый `yield`). `throw(e)` бросает `e` из точки `yield`, и его можно поймать внутри. На не начатом генераторе `return`/`throw` сразу завершают его без выполнения тела. Значение `return` попадает в `{ value, done: true }`, но `for...of` и spread его игнорируют. Транспилятор под ES5 разворачивает генератор в функцию со `switch` по номеру состояния.
:::

::: details Чем yield со звёздочкой отличается от обычного yield и что возвращает это выражение?
`yield x` отдаёт одно значение. `yield* iterable` отдаёт все значения вложенного итератора и пробрасывает в него `next(v)`, `throw(e)` и `return(v)` внешнего генератора. Для внешнего потребителя это выглядит так, будто он напрямую общается с вложенным генератором. Значение выражения `yield*` — то, что вложенный генератор вернул через `return`; так вложенный генератор может передать наверх результат, не смешивая его с потоком значений. Типичное применение — рекурсивный обход дерева и композиция генераторов.
:::

::: details Чем iterator helpers отличаются от методов массива?
`map`, `filter`, `take`, `drop`, `flatMap` на `Iterator.prototype` ленивые: они возвращают новый итератор и вычисляют элемент, только когда его запросили. Поэтому конвейер не создаёт промежуточных массивов, может работать с бесконечным источником и останавливается, как только `take` набрал нужное. Результат одноразовый. Колбэк получает `(value, counter)`, без ссылки на коллекцию. `take`, `find`, `some`, `every` закрывают источник через `return()`. Энергичные `toArray`, `reduce`, `forEach` дочитывают итератор до конца. У массива helpers доступны через `arr.values()`, у произвольного iterable — через `Iterator.from`. Цена ленивости — накладные расходы на каждый `next()`, поэтому на небольшом массиве обычные `map`/`filter` не медленнее.
:::

::: details Как работает for await и чем опасен for await по массиву уже созданных промисов?
`for await` берёт `[Symbol.asyncIterator]()`, а если его нет — синхронный итератор, обёрнутый в асинхронный (`CreateAsyncFromSyncIterator`). На каждом шаге он ждёт промис из `next()`, а у синхронного источника — ещё и само значение. Шаги строго последовательны. Для массива уже запущенных промисов это ловушка: пока цикл ждёт первый, отказ второго никем не обработан. Браузер фиксирует unhandled rejection, а Node по умолчанию завершает процесс, несмотря на `try/catch` вокруг цикла. Для набора параллельных задач — `Promise.all`/`allSettled`, для ленивого потока (пагинация, чтение стрима, события) — async-генератор и `for await`, который не запросит следующую страницу, пока не обработана текущая.
:::

::: details Как Vue обрабатывает итерируемые объекты в v-for и обход реактивных Map и Set?
`v-for` проверяет `Symbol.iterator` и вызывает `Array.from` при каждом рендере. Коллекции (`Map`, `Set`, свой класс с генератором) работают корректно, а сохранённый генератор-объект исчерпается на первом рендере, и при обновлении список станет пустым. Методы обхода реактивных `Map`/`Set` (`keys`, `values`, `entries`, `forEach`, `Symbol.iterator`) инструментированы: при создании итератора регистрируется зависимость на итерацию, а возвращается обёртка, чей `next()` оборачивает значения в `reactive`. Для `map.keys()` используется отдельный ключ зависимости, поэтому смена значения по существующему ключу не перезапускает эффекты, которые читают только ключи.
:::

## Задачи

### 1. Многоразовый `Range` · легко

Реализуйте класс `Range(start, end, step = 1)`: полуинтервал `[start, end)` с поддержкой отрицательного шага. Его можно обходить многократно, и он работает со spread, `for...of` и деструктуризацией.

::: details Решение и разбор
```js
class Range {
  constructor(start, end, step = 1) {
    if (step === 0) throw new RangeError('step must not be 0');
    Object.assign(this, { start, end, step });
  }

  *[Symbol.iterator]() {
    const { start, end, step } = this;
    for (let i = start; step > 0 ? i < end : i > end; i += step) yield i;
  }
}

const r = new Range(0, 10, 3);
[...r];                   // [0, 3, 6, 9]
[...r];                   // [0, 3, 6, 9] — a fresh generator every time
[...new Range(5, 0, -2)]; // [5, 3, 1]
```

- Многоразовость — потому что `Symbol.iterator` — метод-генератор: каждый обход создаёт новый генератор-объект. Если бы `Range` сам был итератором (хранил `current` и имел `next()`), второй spread вернул бы `[]`.
- Нулевой шаг дал бы бесконечный цикл, поэтому его отсекает конструктор. Границы читаются в начале обхода: изменение `r.end` во время обхода на текущий проход не влияет. Массив не хранится: память O(1) на любой длине.

Сложность: O(1) на каждый `next()`, O(1) по памяти.
:::

### 2. Предскажите вывод · средне

```js
function* steps() {
  try {
    const a = yield 'first';
    console.log('a =', a);
    yield a * 2;
  } finally {
    console.log('finally');
  }
}

const s = steps();
console.log(s.next(100).value);
console.log(s.next(21).value);
console.log(s.return('stop'));
console.log(s.next());

for (const v of steps()) {
  console.log(v);
  break;
}
```

::: details Решение и разбор
```text
first
a = 21
42
finally
{ value: 'stop', done: true }
{ value: undefined, done: true }
first
finally
```

- Первый `next(100)` запускает тело до `yield 'first'`. `100` теряется: нет `yield`, который бы его принял.
- `next(21)` — `21` становится значением `yield`, `a = 21`, затем `yield 42`.
- `return('stop')` возобновляет генератор как `return 'stop'` на месте `yield 42`: выполняется `finally`, результат — `{ value: 'stop', done: true }`.
- Завершённый генератор на `next()` отвечает `{ value: undefined, done: true }` бесконечно.
- `break` в `for...of` вызывает `return()`, поэтому `finally` печатается сразу после `first`, а не никогда.
:::

### 3. Ленивый `zip` с закрытием итераторов · средне

Напишите генератор `zip(...iterables)`, который отдаёт кортежи `[a, b, …]` и останавливается на самом коротком источнике. Он не должен оставлять открытыми остальные итераторы ни при естественном завершении, ни при досрочном выходе потребителя.

::: details Решение и разбор
```js
function* zip(...iterables) {
  const iterators = iterables.map((iterable) => iterable[Symbol.iterator]());
  const open = new Set(iterators);
  try {
    while (true) {
      const row = [];
      for (const it of iterators) {
        let result;
        try {
          result = it.next();
        } catch (error) {
          open.delete(it); // a throwing iterator counts as closed
          throw error;
        }
        if (result.done) {
          open.delete(it);
          return;
        }
        row.push(result.value);
      }
      yield row;
    }
  } finally {
    for (const it of open) {
      try {
        it.return?.();
      } catch {
        // the first error wins, as in IteratorClose
      }
    }
  }
}

function* letters() {
  try {
    yield 'a'; yield 'b'; yield 'c';
  } finally {
    console.log('letters closed');
  }
}

[...zip([1, 2], letters())];   // letters closed → [[1, 'a'], [2, 'b']]
for (const pair of zip([1, 2, 3], letters())) break; // letters closed
```

- Закончившийся или бросивший итератор не закрывают: так поступает и спецификация. Остальные закрываются в `finally`, который срабатывает и при `return` на коротком источнике, и при `break` потребителя (его `return()` приходит в генератор `zip`).
- Подавлять ошибки `return()` здесь — упрощение: в спецификации ошибка закрытия побеждает, если обход завершался нормально. Встроенный аналог — `Iterator.zip` (ES2027) с режимами `shortest`, `longest`, `strict`.

Сложность: O(k) на кортеж, где k — число источников; O(k) по памяти.
:::

### 4. Пагинация как async-генератор · средне

API отдаёт страницы `{ items, next }`, где `next` — курсор следующей страницы или `null`. Напишите `paginate(fetchPage)`, который отдаёт элементы по одному и запрашивает следующую страницу, только когда текущая прочитана. Напишите `take(asyncIterable, n)`. Сколько запросов уйдёт за первыми 4 элементами, если на странице 3 элемента?

::: details Решение и разбор
```js
async function* paginate(fetchPage, { signal } = {}) {
  let cursor = null;
  do {
    const page = await fetchPage(cursor, { signal });
    yield* page.items;
    cursor = page.next;
  } while (cursor !== null);
}

async function take(asyncIterable, n) {
  const out = [];
  if (n <= 0) return out;
  for await (const item of asyncIterable) {
    out.push(item);
    if (out.length === n) break; // closes the generator: no further requests
  }
  return out;
}

await take(paginate(fetchPage), 4);  // 2 requests
await Array.fromAsync(paginate(fetchPage)); // all pages, one after another
```

- Ответ: 2 запроса. Генератор ленивый: третья страница запрашивается, только если потребитель попросит седьмой элемент. `break` вызывает `return()`, и генератор завершается, стоя на `yield`.
- `yield*` в async-генераторе принимает и синхронный iterable — массив `page.items`.
- `take` проверяет `n <= 0` до цикла: иначе он прочитал бы лишний элемент и выполнил лишний запрос.
- Отмену запроса в полёте `return()` не даёт: генератор, ожидающий `await fetchPage`, закроется только после ответа (вызовы `next`/`return` у async-генератора ставятся в очередь). Для настоящей отмены нужен `AbortSignal`, поэтому он прокинут в `fetchPage`.

Сложность: O(n) элементов и ⌈n / pageSize⌉ запросов.
:::

### 5. Корутины на генераторах: `run` · сложно

Реализуйте `run(genFn, ...args)` — исполнитель в духе библиотеки `co`. Генератор выдаёт через `yield` промисы или обычные значения. `run` возобновляет его с результатом, а при отказе бросает ошибку внутрь генератора. Сам `run` возвращает промис с итогом `return`.

```js
const result = await run(function* (id) {
  const user = yield fetchUser(id);
  try {
    yield Promise.reject(new Error('fail'));
  } catch (e) {
    console.log('caught inside', e.message);
  }
  return user.name;
}, 42);
```

::: details Решение и разбор
```js
function run(genFn, ...args) {
  return new Promise((resolve, reject) => {
    const gen = genFn(...args);

    function step(method, arg) {
      let result;
      try {
        result = gen[method](arg); // 'next' or 'throw'
      } catch (error) {
        return reject(error);      // uncaught inside the generator
      }
      if (result.done) return resolve(result.value);
      Promise.resolve(result.value).then(
        (value) => step('next', value),
        (error) => step('throw', error),
      );
    }

    step('next', undefined);
  });
}
```

- Это и есть модель `async/await`: `yield` ≈ `await`, `run` ≈ встроенный механизм возобновления. Ошибка промиса превращается в `gen.throw(error)`, и её ловит обычный `try/catch` внутри генератора — так же, как `await` бросает при отказе.
- `Promise.resolve(value)` нормализует обычные значения и thenable. Первый шаг выполняется синхронно, как тело `async`-функции до первого `await`, а каждое возобновление идёт через микрозадачу — как и `await` обычного значения.
- Исключение, не пойманное в генераторе, вылетает из `gen.throw`/`gen.next` и отклоняет промис `run`. Генератор после этого уже `completed`.
- Чем `async`-функция лучше: нет промежуточных IteratorResult, в V8 стек ошибок восстанавливается через `await` (zero-cost async stack traces), а TypeScript выводит тип `await`. Чего у неё нет: внешнего управления. Исполнитель генераторов можно отменить (вызвать `gen.return()`), а `async`-функцию снаружи остановить нельзя. На этом построены redux-saga и ember-concurrency.

Сложность: O(k) шагов, где k — число `yield`; каждый шаг — одна микрозадача.
:::

## Источники

- [ECMAScript: Iteration](https://tc39.es/ecma262/#sec-iteration), [Iterator Objects](https://tc39.es/ecma262/#sec-iterator-objects), [%IteratorPrototype%](https://tc39.es/ecma262/#sec-%iteratorprototype%-object), [Operations on Iterator Objects](https://tc39.es/ecma262/#sec-operations-on-iterator-objects), [IteratorClose](https://tc39.es/ecma262/#sec-iteratorclose), [Iterator.prototype.take](https://tc39.es/ecma262/#sec-iterator.prototype.take), [Iterator.from](https://tc39.es/ecma262/#sec-iterator.from)
- [ECMAScript: Generator Objects](https://tc39.es/ecma262/#sec-generator-objects), [GeneratorResumeAbrupt](https://tc39.es/ecma262/#sec-generatorresumeabrupt), [Generator Function Definitions — yield*](https://tc39.es/ecma262/#sec-generator-function-definitions-runtime-semantics-evaluation), [AsyncGenerator Objects](https://tc39.es/ecma262/#sec-asyncgenerator-objects), [CreateAsyncFromSyncIterator](https://tc39.es/ecma262/#sec-createasyncfromsynciterator), [ForIn/OfBodyEvaluation](https://tc39.es/ecma262/#sec-runtime-semantics-forin-div-ofbodyevaluation-lhs-stmt-iterator-lhskind-labelset), [ArrayIterator next](https://tc39.es/ecma262/#sec-%arrayiteratorprototype%.next)
- [TC39: Finished Proposals](https://github.com/tc39/proposals/blob/main/finished-proposals.md) — Sync Iterator helpers (ES2025), Iterator Sequencing и `Array.fromAsync` (ES2026), Explicit Resource Management и Joint Iteration (ES2027)
- [MDN: Iteration protocols](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols), [Iterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterator), [Iterator.concat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterator/concat), [Generator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator), [function*](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function*), [yield*](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/yield*)
- [MDN: for await...of](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of), [async function*](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function*), [Array.fromAsync](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/fromAsync), [using](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/using)
- [Vue: List Rendering — v-for](https://vuejs.org/guide/essentials/list.html); исходники Vue core 3.5.45: [`renderList`](https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/helpers/renderList.ts), [`collectionHandlers`](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/collectionHandlers.ts)
- [co](https://github.com/tj/co)
