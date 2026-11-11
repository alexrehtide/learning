---
title: Замыкания
level: ядро
---

<!-- PROTOTYPE: образец для утверждения шаблона темы (тикет «Шаблон файла темы»). Не мержить в main. -->

# Замыкания

> **Коротко.** Замыкание (closure) — функция вместе со ссылкой на лексическое окружение, в котором она была создана. В JavaScript замыканием является _любая_ функция: при создании она запоминает окружение во внутреннем слоте `[[Environment]]` и при каждом вызове ищет свободные переменные по цепочке окружений, начиная с него.

## Теория

### Лексическое окружение

Спецификация ECMAScript описывает области видимости через **Environment Record** (запись окружения) — структуру, которая хранит привязки (bindings) имён к значениям и ссылку `[[OuterEnv]]` на внешнюю запись. Виды записей:

| Environment Record | Где создаётся | Что хранит |
| --- | --- | --- |
| Declarative | блок `{}`, `catch`, тело функции | `let`, `const`, `class`, параметры |
| Function | вызов обычной функции | то же + привязку `this`, `super`, `new.target` |
| Module | модуль | импорты (как live bindings) и объявления модуля |
| Object | `with`, глобальный объект | свойства объекта как привязки |
| Global | один на realm | Object Record (`var`, function) + Declarative Record (`let`, `const`) |

Цепочка `[[OuterEnv]]` — это и есть **scope chain** (цепочка областей видимости). Она строится по тексту программы — где функция _написана_, а не откуда она _вызвана_. Это и называется лексической (статической) областью видимости.

### Как функция «запоминает» окружение

1. **Создание.** Когда движок вычисляет объявление или выражение функции, он вызывает абстрактную операцию `OrdinaryFunctionCreate` и кладёт в слот `F.[[Environment]]` текущее лексическое окружение — то, что активно в момент создания.
2. **Вызов.** `PrepareForOrdinaryCall` создаёт новую Function Environment Record, у которой `[[OuterEnv]] = F.[[Environment]]`.
3. **Поиск имени.** `ResolveBinding` → `GetIdentifierReference` идёт от текущей записи по `[[OuterEnv]]` до глобальной. Первая найденная привязка побеждает; не нашли — `ReferenceError` (в strict mode при присваивании тоже).

```js
function makeCounter() {
  let count = 0;            // binding in makeCounter's Function Environment Record
  return function inc() {   // inc.[[Environment]] -> that record
    return ++count;
  };
}

const a = makeCounter();
const b = makeCounter();
a(); a();                   // 1, 2
b();                        // 1 — every makeCounter() call creates a new record
```

Ключевое: функция захватывает **привязку**, а не значение. Если переменную изменить после создания функции, функция увидит новое значение.

### Почему `let` в цикле «чинит» замыкания

```js
for (var i = 0; i < 3; i++) setTimeout(() => console.log(i)); // 3 3 3
for (let j = 0; j < 3; j++) setTimeout(() => console.log(j)); // 0 1 2
```

`var` объявлена в окружении функции — одна привязка на весь цикл. Для `for (let ...)` спецификация вызывает `CreatePerIterationEnvironment`: перед каждой итерацией создаётся **новая** Declarative Record, в которую копируется текущее значение `j`. Каждая стрелка захватывает свою запись.

> [!NOTE]
> Копирование происходит _до_ шага инкремента, поэтому `j++` меняет уже новую запись. Именно поэтому замыкание из тела цикла видит значение своей итерации, а не следующей.

### `this` не замыкается (кроме стрелочных функций)

`this` — не переменная, а привязка Function Environment Record, которая задаётся **при вызове**. Обычная функция получает свой `this` от способа вызова. У стрелочной функции `[[ThisMode]]` равен `lexical`: своей привязки `this` нет, и поиск идёт по цепочке окружений как для обычного имени. Поэтому говорят, что стрелка «замыкает» `this`, хотя формально она просто его не имеет. То же для `arguments`, `super`, `new.target`.

### Замыкания и память

Пока функция достижима, достижимо и её `[[Environment]]`, а через него вся цепочка внешних записей. Сборщик мусора не удалит их.

Спецификация описывает модель, а не реализацию. Движки оптимизируют:

- **V8** анализирует, какие переменные используются вложенными функциями. Только они размещаются в heap-объекте `Context`, остальные живут на стеке и умирают с вызовом.
- Но `Context` **один на область видимости** и общий для всех замыканий, созданных в ней. Если одна функция захватила большой объект, его удерживают все её «соседи» — даже те, что его не используют.
- Прямой `eval` внутри функции отключает оптимизацию: движок не знает заранее, какие имена понадобятся, и сохраняет все.

> [!WARNING]
> Общий контекст — деталь реализации V8, а не стандарта. На интервью уместно сказать «в V8» и отделять модель спецификации от оптимизаций движка.

### Где замыкания встречаются на практике

- **Инкапсуляция:** модули до ESM (IIFE), фабрики, приватное состояние.
- **Функции высшего порядка:** `debounce`, `throttle`, `once`, `memoize`, `curry`, частичное применение.
- **Колбэки и обработчики событий:** обработчик видит переменные компонента.
- **Vue composables:** `useX()` возвращает функции, которые замыкают `ref`-ы, созданные внутри.

### Vue: почему в composables нет «устаревших замыканий»

В React функция компонента выполняется при каждом рендере, и колбэк, созданный в прошлом рендере, видит значения _прошлого_ рендера (stale closure). Отсюда массивы зависимостей у `useEffect` и `useCallback`.

Во Vue `setup()` выполняется **один раз**. Замыкание захватывает не значение, а `ref` — объект-контейнер, у которого меняется `.value`. Поэтому колбэк всегда читает актуальное значение.

```ts
export function useCounter() {
  const count = ref(0);
  const inc = () => count.value++;     // captures the ref object, not a number
  return { count, inc };
}
```

> [!TIP]
> Stale closure во Vue всё же возможна, если сохранить в переменную _примитив_: `const n = count.value` внутри `setup` и использовать `n` в таймере. Захвачено число, а не реактивный источник.

## Примеры

### Приватное состояние: замыкание против `#private`

```js
function createAccount(initial) {
  let balance = initial;
  return {
    deposit(sum) { balance += sum; },
    get balance() { return balance; },
  };
}

class Account {
  #balance;
  constructor(initial) { this.#balance = initial; }
  deposit(sum) { this.#balance += sum; }
  get balance() { return this.#balance; }
}
```

| | Замыкание | `#private` |
| --- | --- | --- |
| Методы | создаются на каждый экземпляр | одни на прототипе |
| Память при 10⁵ объектов | больше (N копий функций) | меньше |
| `instanceof`, наследование | нет | да |
| Проверка «это наш объект» | нет | `#balance in obj` (brand check) |
| Доступ снаружи | невозможен | невозможен |

### Утечка через общий контекст

```js
let theThing = null;

function replaceThing() {
  const originalThing = theThing;
  const unused = () => {
    if (originalThing) console.log('hi');   // captures originalThing
  };
  theThing = {
    longStr: 'x'.repeat(1_000_000),
    someMethod() { console.log('message'); }, // shares the same Context in V8
  };
}

setInterval(replaceThing, 1000);
```

`unused` захватила `originalThing`, поэтому та попала в общий `Context` области `replaceThing`. `someMethod` тоже ссылается на этот `Context`. Цепочка: новый `theThing` → `someMethod` → `Context` → `originalThing` (прошлый `theThing`) → его `someMethod` → … Каждый тик добавляет мегабайт, ничего не освобождается.

**Исправление:** обнулить `originalThing = null` в конце функции или не держать ссылку в той же области.

### Отписка в компоненте

```ts
onMounted(() => {
  const onResize = () => { width.value = window.innerWidth; };
  window.addEventListener('resize', onResize);
  onUnmounted(() => window.removeEventListener('resize', onResize));
});
```

Обработчик замыкает `width`, а через неё и весь `setup`-контекст компонента. Без `removeEventListener` размонтированный компонент остаётся в памяти, пока жив `window`.

## Вопросы с интервью

::: details Что такое замыкание? Объясните на уровне спецификации.

Функция плюс ссылка на лексическое окружение места создания. При создании функции в её слот `[[Environment]]` записывается текущая Environment Record. При вызове новая запись получает `[[OuterEnv]] = [[Environment]]`, и поиск имён идёт по этой цепочке. Следствие: любая функция в JS — замыкание; интересным оно становится, когда функция переживает окружение, в котором создана.

:::

::: details Что выведет код с var и setTimeout в цикле? Как исправить — тремя способами.

`3 3 3`: одна привязка `i` на всю функцию, к моменту срабатывания таймеров цикл закончился.

1. `let` вместо `var` — новая привязка на каждую итерацию (`CreatePerIterationEnvironment`).
2. IIFE: `(function (i) { setTimeout(() => console.log(i)); })(i)` — параметр создаёт новую запись.
3. Передать значение аргументом: `setTimeout(console.log, 0, i)` или `fn.bind(null, i)`.

:::

::: details Замыкание захватывает значение или переменную?

Переменную (привязку). Изменение после создания функции видно внутри неё. Иллюзия «захвата значения» в цикле с `let` возникает потому, что на каждой итерации создаётся новая привязка.

:::

::: details Может ли замыкание вызвать утечку памяти? Приведите пример.

Да, если долгоживущий объект (глобальная переменная, `window`, кэш, подписка) держит функцию, а функция держит большое окружение. Типичные случаи: не снятый обработчик события, таймер без `clearInterval`, кэш мемоизации без ограничения размера. Пример senior-уровня — общий `Context` в V8: функция, которая сама ничего не захватила, удерживает переменные, захваченные соседней функцией из той же области. Диагностика: снимки кучи (heap snapshot) в DevTools, поиск объектов `(closure)` и `system / Context` в retainers.

:::

::: details Замыкает ли функция this?

Обычная — нет: `this` задаётся при вызове и зависит от способа вызова. Стрелочная — не имеет собственной привязки `this` (`[[ThisMode]]: lexical`), поэтому `this` ищется по цепочке окружений и берётся из внешней обычной функции. То же для `arguments`, `super`, `new.target`.

:::

::: details Приватность через замыкание или через #private-поля — что выбрать?

`#private` при большом количестве экземпляров: методы на прототипе, есть наследование и brand check (`#x in obj`). Замыкание — для фабрик и функционального стиля, когда объектов немного и важна композиция; плюс работает с любыми объектами и не требует классов. Обе дают настоящую приватность — снаружи не достать ни через `Object.keys`, ни через `Reflect`.

:::

::: details Что такое stale closure? Почему во Vue Composition API их почти нет, а в React Hooks есть?

Stale closure — колбэк, который видит устаревшее значение, потому что захватил привязку из прошлого вызова. В React функция компонента вызывается на каждый рендер, и колбэк из прошлого рендера держит значения того рендера — отсюда массивы зависимостей. Во Vue `setup` выполняется один раз, а колбэки замыкают `ref`/`reactive` — контейнеры с изменяемым `.value`, поэтому читают актуальное значение. Ловушка остаётся, если вынуть примитив (`const n = count.value`) или деструктурировать `reactive` без `toRefs`.

:::

::: details Как движок понимает, какие переменные нужно сохранить после выхода из функции?

Статический анализ на этапе парсинга: V8 определяет, какие переменные используются вложенными функциями, и размещает их в heap-объекте `Context`; остальные — на стеке или в регистрах. Прямой `eval` или `with` ломают анализ, и тогда в контекст уходит всё. Это оптимизация движка, спецификация говорит только о Environment Records.

:::

## Задачи

### 1. Что выведет код? · легко

```js
let x = 1;
function show() { console.log(x); }
function run() {
  let x = 2;
  show();
}
run();
x = 3;
show();
```

::: details Решение и разбор

`1`, затем `3`.

`show` создана в глобальной области, её `[[Environment]]` — глобальная запись. Локальная `x = 2` внутри `run` не видна: область видимости лексическая, а не динамическая. После `x = 3` вызов видит новое значение — захвачена привязка, а не значение.

:::

### 2. `once(fn)` · легко

Напишите `once(fn)`: возвращает функцию, которая вызывает `fn` только при первом вызове и затем всегда возвращает первый результат. Сохраните `this` и аргументы.

::: details Решение и разбор

```js
function once(fn) {
  let called = false;
  let result;
  return function (...args) {
    if (!called) {
      called = true;
      result = fn.apply(this, args);
      fn = null; // release fn and everything it captures
    }
    return result;
  };
}
```

- `called` — отдельный флаг: результат может быть `undefined`, поэтому проверять `result` нельзя.
- `function`, а не стрелка — чтобы получить `this` вызывающего кода.
- `fn = null` освобождает исходную функцию и её окружение для GC.
- Если `fn` бросит исключение, `called` уже `true` — повторного вызова не будет. Стоит обсудить с интервьюером, какое поведение ожидается.

Сложность: O(1) по времени на вызов, O(1) по памяти.

:::

### 3. `memoize(fn)` · средне

Напишите `memoize(fn)` для функции от одного аргумента. Затем обсудите: как поддержать несколько аргументов и как не допустить утечки памяти.

::: details Решение и разбор

```js
function memoize(fn) {
  const cache = new Map();
  return function (arg) {
    if (cache.has(arg)) return cache.get(arg);
    const value = fn.call(this, arg);
    cache.set(arg, value);
    return value;
  };
}
```

- `Map`, а не объект: ключи любого типа, без приведения к строке (`1` и `'1'` различаются).
- `has` + `get`, а не `get` + проверка на `undefined`: функция может вернуть `undefined`.
- **Несколько аргументов:** вложенные `Map` по аргументам (дерево) или ключ `JSON.stringify(args)` — второй вариант ломается на объектах с одинаковой структурой, функциях, `undefined` и циклах.
- **Утечка:** кэш растёт бесконечно. Варианты — LRU с лимитом, `WeakMap` для объектных ключей (запись умирает вместе с ключом), TTL.

Сложность: O(1) в среднем на попадание в кэш; память O(k), где k — число уникальных аргументов.

:::

### 4. `sum(1)(2)(3)()` · средне

Реализуйте `sum`, который принимает числа по одному и возвращает сумму, когда вызван без аргументов: `sum(1)(2)(3)() === 6`, `sum(5)() === 5`.

::: details Решение и разбор

```js
function sum(a) {
  return function next(b) {
    if (b === undefined) return a;
    return sum(a + b);
  };
}
```

Каждый вызов `sum` создаёт новое окружение с накопленным `a`, поэтому цепочки независимы: `const s = sum(1); s(2)(); s(10)();` вернут `3` и `11`.

**Вариант со звёздочкой:** `sum(1)(2)(3) == 6` без финального вызова. Решение — переопределить `valueOf` (или `Symbol.toPrimitive`) у возвращаемой функции:

```js
function sum(a) {
  const next = (b) => sum(a + b);
  next[Symbol.toPrimitive] = () => a;
  return next;
}
```

Сложность: O(n) по времени и O(n) по памяти на цепочку из n вызовов (каждый создаёт функцию и окружение).

:::

### 5. Найдите утечку · сложно

Приложение с этим кодом растёт в памяти. Найдите причину, не меняя публичного поведения `createWidget`.

```js
const registry = new Set();

function createWidget(data) {
  const heavy = new Array(1e6).fill(data);
  const log = () => console.log(heavy.length);
  log();

  const widget = {
    id: Math.random(),
    destroy() { registry.delete(widget); },
  };
  registry.add(widget);
  return widget;
}
```

Вызывающий код создаёт виджеты и вызывает `destroy()` у ненужных.

::: details Решение и разбор

Есть две проблемы.

1. **Общий контекст (V8).** `log` захватывает `heavy`, поэтому `heavy` лежит в общем `Context` области `createWidget`. `destroy` создан в той же области и держит тот же `Context`. Пока жив виджет, жив и массив на миллион элементов, хотя `destroy` его не использует.
2. **Реестр.** Если вызывающий код забывает `destroy()`, `registry` держит виджет вечно.

Исправление:

```js
function createWidget(data) {
  logSize(data);                          // heavy lives in a separate scope

  const widget = {
    id: Math.random(),
    destroy() { registry.delete(widget); },
  };
  registry.add(widget);
  return widget;
}

function logSize(data) {
  const heavy = new Array(1e6).fill(data);
  console.log(heavy.length);
}
```

Альтернатива — `heavy = null` после использования. Для реестра без явного `destroy` — `WeakRef` + `FinalizationRegistry` или отказ от глобального `Set`, если он нужен только для перечисления.

Как найти без подсказки: два heap snapshot в DevTools, сравнение (Comparison), у растущих массивов смотреть Retainers → `context in destroy()`.

:::

## Источники

- [ECMAScript® 2026 — Environment Records](https://tc39.es/ecma262/#sec-environment-records)
- [ECMAScript® 2026 — OrdinaryFunctionCreate](https://tc39.es/ecma262/#sec-ordinaryfunctioncreate)
- [ECMAScript® 2026 — CreatePerIterationEnvironment](https://tc39.es/ecma262/#sec-createperiterationenvironment)
- [ECMAScript® 2026 — GetIdentifierReference](https://tc39.es/ecma262/#sec-getidentifierreference)
- [MDN — Closures](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures)
- [MDN — Private properties](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_properties)
- [Vue — Composition API FAQ: сравнение с React Hooks](https://vuejs.org/guide/extras/composition-api-faq.html#comparison-with-react-hooks)
- [Chrome DevTools — Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems)
- [Meteor Blog — An interesting kind of JavaScript memory leak](https://blog.meteor.com/an-interesting-kind-of-javascript-memory-leak-8b47d2e7f156)
