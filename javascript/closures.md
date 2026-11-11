---
title: Замыкания
level: ядро
---

# Замыкания

> **Коротко.** Замыкание (closure) — это функция вместе с окружением, в котором её создали. При создании функция запоминает текущую запись окружения во внутреннем слоте `[[Environment]]`. При каждом вызове её собственное окружение строится поверх этой записи, а не поверх окружения вызывающего кода. Поэтому в JavaScript замыканием является любая функция. Захватывается привязка (переменная), а не значение, и всё окружение живёт, пока жива функция.

**Связанные темы:** [Область видимости и hoisting](./scope-and-hoisting.md), [Функции и `this`](./functions-and-this.md), [Прототипы и классы](./prototypes-and-classes.md)

## Теория

### Модель: записи окружения

Области видимости спецификация описывает через **Environment Record** (запись окружения): таблицу привязок со ссылкой `[[OuterEnv]]` на внешнюю запись. Виды записей, hoisting и TDZ разобраны в теме [«Область видимости и hoisting»](./scope-and-hoisting.md). Для замыканий важны три момента жизни функции.

1. **Создание.** Объявление, функциональное выражение, стрелка или метод создаются через `OrdinaryFunctionCreate`. Эта операция кладёт в слот `F.[[Environment]]` запись окружения, в которой функция создаётся (для выражений и стрелок — текущий LexicalEnvironment), а в `F.[[PrivateEnvironment]]` — текущее окружение приватных имён класса. В алгоритме для стрелки спецификация так и называет результат: `closure`.
2. **Вызов.** `PrepareForOrdinaryCall` создаёт новую Function Environment Record (`NewFunctionEnvironment`), и её `[[OuterEnv]]` = `F.[[Environment]]`. Каждый вызов получает свежую запись для параметров и локальных переменных.
3. **Поиск имени.** `ResolveBinding` идёт от текущей записи по цепочке `[[OuterEnv]]` (`GetIdentifierReference`). Первая найденная привязка побеждает.

Цепочка определяется местом, где функция **написана** (точнее, где выполнилось её создание), а не местом вызова:

```js
function makeCounter() {
  let count = 0;            // binding in this call's Function Environment Record
  return function inc() {   // inc.[[Environment]] -> that record
    return ++count;
  };
}

const a = makeCounter();
const b = makeCounter();
a(); a();                   // 1, 2
b();                        // 1 — every call of makeCounter creates a new record
```

Запись окружения `makeCounter` не уничтожается после возврата: на неё ссылается `inc.[[Environment]]`. Спецификация не привязывает записи окружения к стеку вызовов: запись существует, пока на неё есть ссылка.

### Захватывается привязка, а не значение

Функция не копирует значения переменных. Она держит ссылку на запись, и чтение идёт в момент вызова. Отсюда два следствия.

- Изменение переменной после создания функции видно внутри неё.
- Все функции, созданные **в одном вызове**, делят одну запись. Это способ дать нескольким функциям общее приватное состояние.

```js
function createStore() {
  let state = 0;
  return {
    inc: () => state++,
    get: () => state,       // sees changes made by inc
    reset: () => { state = 0; },
  };
}
```

«Захват значения» в цикле `for (let i …)` — тоже не исключение. Спецификация создаёт новую запись на каждую итерацию (`CreatePerIterationEnvironment`), и каждая функция замыкает свою привязку. Подробности и вариант с `var` — в теме [«Область видимости и hoisting»](./scope-and-hoisting.md#блоки-и-циклы).

### `new Function` и `eval`

Два способа выполнить код из строки по-разному относятся к замыканиям.

- **`new Function(...)`** создаёт функцию, у которой `[[Environment]]` — **глобальная** запись realm, а `[[PrivateEnvironment]]` пустое (`CreateDynamicFunction`). Локальные переменные вокруг недоступны, приватные поля класса тоже.
- **Прямой `eval`** выполняет код в текущем LexicalEnvironment. Функции, созданные внутри строки, замыкают локальные переменные.

```js
function outer() {
  const secret = 42;
  const viaFunction = new Function('return typeof secret');
  const viaEval = eval('() => typeof secret');
  return [viaFunction(), viaEval()];
}
outer(); // ['undefined', 'number']
```

### `this`, `arguments`, `super`, `new.target`

`this` — не переменная, а состояние Function Environment Record, которое задаётся **при вызове**. Обычная функция получает свой `this` от способа вызова и не берёт его из внешней области. У стрелки `[[ThisMode]]` равен `lexical`: её запись окружения не имеет привязки `this`, и поиск идёт по `[[OuterEnv]]` к ближайшей обычной функции. Поэтому говорят, что стрелка «замыкает» `this`, хотя формально у неё просто нет своего. То же самое верно для `arguments`, `super` и `new.target`. Все правила привязки `this` разобраны в теме [«Функции и `this`»](./functions-and-this.md).

### Приватные имена класса

`#x` разрешается не через записи окружения, а через отдельную цепочку **PrivateEnvironment Record**, которую создаёт тело класса. Функция, созданная внутри класса, запоминает её в `[[PrivateEnvironment]]`. Поэтому стрелка или вложенная функция из метода может обращаться к `this.#x` и после того, как метод вернул управление. Синтаксическая проверка тоже лексическая: `obj.#x` вне тела класса — `SyntaxError` ещё при разборе.

### Замыкания и память

Пока функция достижима, достижима и её `[[Environment]]`, а через неё вся цепочка внешних записей. Спецификация на этом останавливается. Как именно это хранится — решает движок.

> [!WARNING]
> Детали реализации V8, не спецификация. При разборе V8 определяет, какие переменные используются вложенными функциями. Только они переносятся в объект `Context` в куче. Остальные живут в регистрах и на стеке и пропадают после возврата. Обращение к захваченной переменной компилируется в чтение слота по заранее вычисленным глубине и индексу (в байткоде — `LdaCurrentContextSlot` или `LdaContextSlot`), без поиска по имени. Цена оптимизации: `Context` **один на область видимости** и общий для всех функций, созданных в ней. Если одна функция захватила большой объект, его держат и её «соседи», даже если сами его не используют. Прямой `eval` внутри функции заставляет захватить всё.

### Где замыкания встречаются на практике

- **Инкапсуляция:** паттерн «модуль» на IIFE до ESM, фабрики, приватное состояние.
- **Функции высшего порядка:** `debounce`, `throttle`, `once`, `memoize`, `curry`, частичное применение — всё это функции, которые возвращают функции с состоянием.
- **Колбэки и обработчики:** обработчик события, таймер, `then` видят переменные места создания.
- **Vue:** composables возвращают функции, замыкающие созданные внутри `ref`. Render-функция `<script setup>` в production-сборке — замыкание над локальными переменными `setup()`.

### Vue: почему в composables почти нет «устаревших замыканий»

В React функция компонента выполняется на каждый рендер. Колбэк, созданный в прошлом рендере, замкнул записи окружения прошлого вызова и видит их значения. Это stale closure (устаревшее замыкание), и от него защищают массивы зависимостей в `useEffect` и `useCallback`.

Во Vue `setup()` выполняется **один раз** на экземпляр компонента. Колбэки замыкают не значения, а `ref` и `reactive` — объекты с изменяемым содержимым. Чтение `.value` в момент вызова всегда даёт актуальное значение.

```ts
export function useCounter() {
  const count = ref(0);
  const inc = () => count.value++;      // captures the ref object, not a number
  return { count, inc };
}
```

> [!TIP]
> Stale closure во Vue всё же возможна: если вынуть примитив (`const n = count.value`) или деструктурировать `reactive` и props без `toRefs` / `toRef`, а затем использовать результат в таймере или обработчике. Захвачено число, а не реактивный источник.

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
| Методы | новые функции на каждый объект | одни на прототипе |
| Память при 10⁵ объектов | больше (N копий функций и записей) | меньше |
| `instanceof`, наследование | нет | да |
| Проверка «это наш объект» | нет | `#balance in obj` (brand check) |
| Доступ снаружи | невозможен | невозможен |

### Утечка через общий контекст

```js
let theThing = null;

function replaceThing() {
  const originalThing = theThing;
  const unused = () => {
    if (originalThing) console.log('hi');     // captures originalThing
  };
  theThing = {
    longStr: 'x'.repeat(1_000_000),
    someMethod() { console.log('message'); }, // shares the same Context in V8
  };
}

setInterval(replaceThing, 1000);
```

`unused` захватила `originalThing`, и та попала в общий `Context` области `replaceThing`. `someMethod` ссылается на тот же `Context`. Цепочка: новый `theThing` → `someMethod` → `Context` → `originalThing` (прошлый `theThing`) → его `someMethod` → … Каждый тик добавляет мегабайт, и ничего не освобождается. Исправление — `originalThing = null` в конце функции или вынести `unused` в другую область.

### Отписка в компоненте

```ts
onMounted(() => {
  const onResize = () => { width.value = window.innerWidth; };
  window.addEventListener('resize', onResize);
  onUnmounted(() => window.removeEventListener('resize', onResize));
});
```

Обработчик замыкает `width`, а через неё и окружение `setup()` компонента. Без `removeEventListener` размонтированный компонент остаётся в памяти, пока жив `window`. Ссылка на ту же функцию `onResize` нужна, чтобы её можно было снять: новая стрелка — другой объект.

## Вопросы с интервью

::: details Что такое замыкание? Объясните на уровне спецификации.
Функция плюс ссылка на окружение места создания. `OrdinaryFunctionCreate` записывает текущую запись окружения в слот `[[Environment]]`. При вызове новая Function Environment Record получает `[[OuterEnv]] = F.[[Environment]]`, и поиск имён идёт по этой цепочке. Следствие: любая функция в JS — замыкание. Интересным оно становится, когда функция переживает вызов, в котором создана: возвращена, сохранена как обработчик, передана в таймер.
:::

::: details Замыкание захватывает значение или переменную?
Переменную (привязку). Изменение после создания функции видно внутри неё, а функции из одного вызова делят одну запись и видят изменения друг друга. Иллюзия «захвата значения» в `for (let …)` возникает потому, что на каждой итерации создаётся новая привязка. Чтобы зафиксировать значение, его копируют в новую привязку: параметр функции, `const` внутри блока, `bind`.
:::

::: details Почему функция, созданная через new Function, не видит локальные переменные, а функция из eval видит?
`CreateDynamicFunction` передаёт в `OrdinaryFunctionCreate` глобальную запись realm, а не текущую. Такая функция замыкает только глобальную область и не видит ни локальных переменных, ни приватных имён класса. Прямой `eval` выполняет код в текущем LexicalEnvironment, поэтому созданные в нём функции замыкают локальные переменные. Практический вывод: `new Function` безопаснее для оптимизаций (не ломает анализ областей вокруг), но обе конструкции блокируются CSP без `'unsafe-eval'`.
:::

::: details Замыкает ли функция this?
Обычная — нет: `this` задаётся при вызове и зависит от способа вызова. Стрелка не имеет своей привязки `this` (`[[ThisMode]]: lexical`), поэтому `this` ищется по цепочке окружений и берётся у ближайшей внешней обычной функции. Так же стрелка ведёт себя с `arguments`, `super` и `new.target`. Поэтому стрелку нельзя «перепривязать» через `call`, `apply` или `bind`, а `new` для неё — `TypeError`.
:::

::: details Может ли замыкание вызвать утечку памяти? Приведите пример.
Да, если долгоживущий объект держит функцию, а функция держит большое окружение. Типичные случаи: обработчик на `window` или `document` без снятия, `setInterval` без `clearInterval`, подписка на внешний источник, кэш мемоизации без ограничения размера. Пример senior-уровня — общий `Context` в V8: функция, которая сама ничего не захватила, удерживает переменные, захваченные соседней функцией из той же области. Диагностика — два heap snapshot в DevTools, сравнение и цепочка retainers до объекта `system / Context`.
:::

::: details Как движок понимает, какие переменные нужно сохранить после выхода из функции?
Статическим анализом при разборе. V8 знает, какие имена используют вложенные функции, и только эти переменные размещает в heap-объекте `Context`. Остальные остаются в регистрах или на стеке. Доступ к захваченной переменной компилируется в чтение слота по глубине и индексу, без поиска по имени. Прямой `eval` или `with` ломают анализ, и тогда в `Context` уходит всё. Это оптимизация движка: спецификация говорит только о записях окружения.
:::

::: details Приватность через замыкание или через #private-поля — что выбрать?
`#private` ([подробнее](./prototypes-and-classes.md#приватные-элементы-x)), когда объектов много: методы на прототипе, есть наследование и brand check (`#x in obj`). Замыкание — для фабрик и функционального стиля, когда объектов немного и важна композиция. Замыкание работает без классов и не зависит от `this`, поэтому методы можно передавать как колбэки без `bind`. Обе дают настоящую приватность: снаружи не достать ни через `Object.keys`, ни через `Reflect.ownKeys`. Ограничение `#private` — `Proxy` над таким объектом ломает доступ к полям, потому что `this` в методе становится прокси.
:::

::: details Что такое stale closure? Почему во Vue Composition API их почти нет, а в React Hooks есть?
Stale closure — колбэк, который видит устаревшее значение, потому что замкнул привязку из прошлого вызова. В React функция компонента вызывается на каждый рендер, и колбэк из прошлого рендера держит значения того рендера — отсюда массивы зависимостей. Во Vue `setup` выполняется один раз, а колбэки замыкают `ref` и `reactive` — контейнеры с изменяемым содержимым, поэтому читают актуальное значение. Ловушка остаётся, если вынуть примитив (`const n = count.value`) или деструктурировать `reactive` без `toRefs`.
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

`show` создана на верхнем уровне, её `[[Environment]]` — глобальная область. Локальная `x = 2` внутри `run` не видна: область видимости лексическая, а не динамическая. После `x = 3` вызов видит новое значение, потому что захвачена привязка, а не значение.
:::

### 2. Общие и раздельные окружения · легко

```js
function make() {
  let n = 0;
  return [() => ++n, () => n];
}

const [inc1, get1] = make();
const [inc2, get2] = make();
inc1(); inc1(); inc2();
console.log(get1(), get2());
```

::: details Решение и разбор
`2 1`.

Функции из одного вызова `make` делят одну запись окружения: `inc1` и `get1` видят одну `n`. Второй вызов создаёт новую запись, и `inc2`/`get2` работают со своей `n`. На этом построены фабрики с общим приватным состоянием: несколько методов, одна «скрытая» переменная.
:::

### 3. `sum(1)(2)(3)()` · средне

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

Каждый вызов `sum` создаёт новую запись с накопленным `a`, поэтому цепочки независимы: `const s = sum(1); s(2)(); s(10)();` вернут `3` и `11`. Вариант с одной изменяемой переменной (`total += b; return next`) ломает это свойство: ветки начнут влиять друг на друга.

**Со звёздочкой:** `sum(1)(2)(3) == 6` без финального вызова. Решение — задать возвращаемой функции `Symbol.toPrimitive`:

```js
function sum(a) {
  const next = (b) => sum(a + b);
  next[Symbol.toPrimitive] = () => a;
  return next;
}
```

Сложность: O(n) по времени и O(n) по памяти на цепочку из n вызовов (каждый создаёт функцию и запись окружения).
:::

### 4. Модель записей окружения · средне

Смоделируйте записи окружения классом `Env`: `new Env(outer)`, методы `declare(name, mutable)`, `initialize(name, value)`, `get(name)`, `set(name, value)`. Поиск идёт по цепочке `outer`. Ошибки как в JS: `ReferenceError` для неизвестного имени и для обращения до инициализации (TDZ), `TypeError` при присваивании константе. Затем с помощью `Env` смоделируйте `makeCounter` из теории: функция — это тело плюс запомненное окружение.

::: details Решение и разбор
```js
const UNINITIALIZED = Symbol('uninitialized');

class Env {
  #bindings = new Map(); // name -> { value, mutable }

  constructor(outer = null) { this.outer = outer; }

  declare(name, mutable = true) {
    if (this.#bindings.has(name)) throw new SyntaxError(`'${name}' has already been declared`);
    this.#bindings.set(name, { value: UNINITIALIZED, mutable });
  }

  initialize(name, value) { this.#bindings.get(name).value = value; }

  #resolve(name) { // GetIdentifierReference
    for (let env = this; env; env = env.outer) {
      const binding = env.#bindings.get(name);
      if (binding) return binding;
    }
    throw new ReferenceError(`${name} is not defined`);
  }

  get(name) {
    const binding = this.#resolve(name);
    if (binding.value === UNINITIALIZED) throw new ReferenceError(`Cannot access '${name}' before initialization`);
    return binding.value;
  }

  set(name, value) {
    const binding = this.#resolve(name);
    if (binding.value === UNINITIALIZED) throw new ReferenceError(`Cannot access '${name}' before initialization`);
    if (!binding.mutable) throw new TypeError('Assignment to constant variable.');
    binding.value = value;
  }
}

// A "function" is its body plus the environment captured at creation.
const makeFunction = (body, env) => ({
  environment: env,                                     // F.[[Environment]]
  invoke(...args) { return body(new Env(this.environment), ...args); }, // NewFunctionEnvironment
});

const globalEnv = new Env();
const makeCounter = makeFunction((env) => {
  env.declare('count');
  env.initialize('count', 0);
  return makeFunction((inner) => {
    inner.set('count', inner.get('count') + 1);
    return inner.get('count');
  }, env);                                              // inner closes over makeCounter's record
}, globalEnv);

const counter = makeCounter.invoke();
counter.invoke(); // 1
counter.invoke(); // 2
```

- `env.#bindings` у другого экземпляра того же класса доступен: приватные имена проверяются лексически, по телу класса, а не по `this`.
- Модель опускает `var` и VariableEnvironment, двухслойную глобальную запись, `this` и hoisting функций — их можно обсудить как расширения.
- Важная деталь — окружение для `inner` берётся из места создания (`env`), а не из места вызова. Если передать в `invoke` окружение вызывающего кода, получится динамическая область видимости.

Сложность: `get`/`set` — O(d), где d — глубина цепочки. Движок разрешает имена при компиляции и обращается к слоту по индексу, поэтому на практике поиск по цепочке не стоит ничего.
:::

### 5. Найдите утечку · сложно

Приложение с этим кодом растёт в памяти, хотя ненужные виджеты уничтожаются через `destroy()`. Найдите причину, не меняя публичного поведения `createWidget`.

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

::: details Решение и разбор
Причина — общий `Context` в V8. `log` захватывает `heavy`, поэтому `heavy` лежит в `Context` области `createWidget`. `destroy` создан в той же области и держит тот же `Context` (он захватывает `widget`). Пока виджет жив у вызывающего кода, жив и массив на миллион элементов, хотя `destroy` его не использует. На Node 26 двадцать таких виджетов держат около 150 МБ.

Исправление — разнести тяжёлые данные и долгоживущие функции по разным областям:

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

Альтернатива — `heavy = null` после использования (тогда `heavy` должна быть `let`). Вторая проблема того же кода: если вызывающий код забудет `destroy()`, `registry` удержит виджет навсегда. Если реестр нужен только для перечисления, его заменяют на `WeakRef` + `FinalizationRegistry` или убирают.

Как найти без подсказки: два heap snapshot в DevTools, режим Comparison, у растущих массивов — Retainers: массив → `system / Context` → `destroy`.
:::

## Источники

- [ECMAScript: Environment Records](https://tc39.es/ecma262/#sec-environment-records), [Function Environment Records](https://tc39.es/ecma262/#sec-function-environment-records), [NewFunctionEnvironment](https://tc39.es/ecma262/#sec-newfunctionenvironment)
- [ECMAScript: ECMAScript Function Objects](https://tc39.es/ecma262/#sec-ecmascript-function-objects), [OrdinaryFunctionCreate](https://tc39.es/ecma262/#sec-ordinaryfunctioncreate), [PrepareForOrdinaryCall](https://tc39.es/ecma262/#sec-prepareforordinarycall)
- [ECMAScript: InstantiateArrowFunctionExpression](https://tc39.es/ecma262/#sec-runtime-semantics-instantiatearrowfunctionexpression), [Arrow Function Definitions](https://tc39.es/ecma262/#sec-arrow-function-definitions)
- [ECMAScript: ResolveBinding](https://tc39.es/ecma262/#sec-resolvebinding), [GetIdentifierReference](https://tc39.es/ecma262/#sec-getidentifierreference), [CreatePerIterationEnvironment](https://tc39.es/ecma262/#sec-createperiterationenvironment)
- [ECMAScript: PrivateEnvironment Records](https://tc39.es/ecma262/#sec-privateenvironment-records)
- [ECMAScript: CreateDynamicFunction](https://tc39.es/ecma262/#sec-createdynamicfunction), [PerformEval](https://tc39.es/ecma262/#sec-performeval)
- [MDN: Closures](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures)
- [MDN: Arrow function expressions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Arrow_functions)
- [MDN: Function() constructor](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/Function)
- [MDN: Private properties](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_properties)
- [Vue: Composition API FAQ — Comparison with React Hooks](https://vuejs.org/guide/extras/composition-api-faq.html#comparison-with-react-hooks)
- [Vue: Composables](https://vuejs.org/guide/reusability/composables.html)
- [V8: Blazingly fast parsing, part 2: lazy parsing](https://v8.dev/blog/preparser)
- [Chrome DevTools: Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems)
- [Meteor Blog: An interesting kind of JavaScript memory leak](https://blog.meteor.com/an-interesting-kind-of-javascript-memory-leak-8b47d2e7f156)
