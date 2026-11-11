---
title: Функции и `this`
level: ядро
---

# Функции и `this`

> **Коротко.** Функция — объект с внутренним методом `[[Call]]`, а у конструкторов есть ещё `[[Construct]]`. Виды функций (объявление, выражение, стрелка, метод, класс) различаются набором внутренних слотов: есть ли у функции свой `this`, `arguments`, `prototype` и можно ли вызвать её через `new`. `this` — не переменная. Его значение задаёт **способ вызова**: `new`, `call`/`apply`/`bind`, вызов через свойство объекта, обычный вызов. Стрелка своего `this` не имеет и берёт его из внешней функции.

**Связанные темы:** [Область видимости и hoisting](./scope-and-hoisting.md), [Замыкания](./closures.md)

## Теория

### Функция — объект с внутренними методами

В спецификации нет типа «функция». Есть объект, у которого есть внутренний метод `[[Call]]`. Поэтому функции можно класть свойства, передавать её как значение и хранить в `Map`. Конструктор — функция, у которой есть ещё `[[Construct]]`: только к ней применим `new`.

Функцию создаёт `OrdinaryFunctionCreate`. Кроме `[[Environment]]` (основа [замыканий](./closures.md)) она заполняет слоты, которые и отличают виды функций:

- `[[ThisMode]]` — откуда берётся `this`: `lexical` (стрелка), `strict` или `global` (обычная функция в нестрогом коде);
- `[[ConstructorKind]]` и `[[IsClassConstructor]]` — базовый или производный класс, запрет вызова класса без `new`;
- `[[HomeObject]]` — объект, на котором определён метод. От него считается `super`.

`MakeConstructor` добавляет `[[Construct]]` и свойство `prototype`. Его вызывают только для объявлений и выражений `function` и для классов.

| | `function` | стрелка | метод `m() {}` | `class` |
| --- | --- | --- | --- | --- |
| Свой `this` | да, от вызова | нет, из внешней функции | да, от вызова | да, новый объект |
| Свои `arguments` | да | нет | да | да |
| `new` | да | `TypeError` | `TypeError` | только `new` |
| Свойство `prototype` | да | нет | нет | да |
| `super` | нет | из внешней функции | да | да |
| Hoisting | объявление — целиком | как переменная | — | TDZ, как `let` |

Генераторы и `async`-функции тоже не конструкторы. У генератора `prototype` есть, но это прототип будущих итераторов, а не создаваемых через `new` объектов.

### `name` и `length`

- `name` выводится при создании (`NamedEvaluation` → `SetFunctionName`): `const f = () => {}` даёт `'f'`, метод `{ get x() {} }` — `'get x'`, `bind` — `'bound f'`. Имя есть у анонимной функции, только если её **сразу** присвоили привязке или свойству.
- `length` — число параметров **до** первого параметра со значением по умолчанию или rest (`ExpectedArgumentCount`). `function f(a, b = 1, c) {}` даёт `1`. На `length` опираются `curry` и проверки арности.

### `arguments`

Объект `arguments` создаётся только у обычных функций и методов. В нестрогом коде и при «простых» параметрах (без значений по умолчанию, rest и деструктуризации) он **mapped** (`CreateMappedArgumentsObject`): `arguments[0]` и параметр `a` — одна ячейка, присваивание одному меняет другое. В strict mode или при сложных параметрах объект **unmapped**: это копия значений. Сегодня `arguments` заменяют rest-параметром: настоящий массив, понятная сигнатура, работает и в стрелках.

### Контекст исполнения и привязка `this`

Каждый вызов создаёт **контекст исполнения** (execution context) и кладёт его на стек. У контекста есть LexicalEnvironment, VariableEnvironment и PrivateEnvironment, а у функционального контекста — ещё сама функция. `this` хранится в Function Environment Record вызова: поля `[[ThisValue]]` и `[[ThisBindingStatus]]` (`lexical`, `initialized`, `uninitialized`).

Выражение `this` вычисляется через `ResolveThisBinding` → `GetThisEnvironment`. Операция идёт по цепочке `[[OuterEnv]]` до первой записи, у которой **есть** привязка `this`. У стрелки её нет (`lexical`), поэтому поиск уходит в окружение, где стрелку создали. Отсюда «лексический `this`».

Какое значение получает обычная функция, решает место вызова:

1. **`EvaluateCall`.** Если вызываемое выражение — ссылка на свойство (`obj.m`, `obj[k]`, `obj?.m`), `thisValue` = база ссылки, то есть `obj`. Иначе (`f()`, `(0, obj.m)()`) — `undefined`.
2. **`OrdinaryCallBindThis`.** Если `[[ThisMode]]` = `strict`, значение берётся как есть. Иначе (`global`) `undefined` и `null` заменяются на `globalThis`, а примитив упаковывается через `ToObject`.

Из этих двух шагов выводятся все «правила `this`».

| Способ вызова | `this` |
| --- | --- |
| `new F()` | новый объект с прототипом `F.prototype` (точнее, `newTarget.prototype`) |
| `f.call(x)`, `f.apply(x)`, `f.bind(x)()` | `x` |
| `obj.f()`, `obj[k]()`, `obj?.f()` | `obj` |
| `f()` | `undefined` в strict mode, `globalThis` в нестрогом |
| стрелка | `this` внешней функции, любой способ вызова игнорируется |

Приоритет: `new` > `bind` > `call`/`apply` > вызов через свойство > обычный вызов. Стрелку переопределить нельзя ничем.

### Ссылка, а не значение

`obj.f` вычисляется не в функцию, а в **Reference Record**: пару «база + имя». `this` получается из базы, поэтому важно, дошла ли до вызова ссылка или уже значение.

- `(obj.f)()` — скобки (grouping operator) возвращают ссылку как есть: `this === obj`.
- `(0, obj.f)()`, `(obj.f = obj.f)()`, `(cond ? obj.f : g)()` — оператор вычисляет **значение** (`GetValue`), база теряется: `this === undefined`.
- `const f = obj.f; f()` и `setTimeout(obj.f)` — то же самое: передаётся функция, без объекта.

Приём `(0, fn)()` встречается в выводе сборщиков: так вызывают импортированную функцию, не передавая ей объект модуля в `this`.

### `bind`: bound function

`f.bind(thisArg, ...args)` создаёт не обёртку, а **bound function exotic object** (`BoundFunctionCreate`) со слотами `[[BoundTargetFunction]]`, `[[BoundThis]]`, `[[BoundArguments]]`. Его `[[Call]]` игнорирует переданный `this` и вызывает цель с `[[BoundThis]]`.

- Повторный `bind` создаёт bound function над bound function. Внутренний `[[BoundThis]]` побеждает: `f.bind(a).bind(b)()` вызовет `f` с `this === a`. Дополнительные аргументы при этом накапливаются.
- `[[Construct]]` у bound function есть, только если он есть у цели. При `new` связанный `this` игнорируется, аргументы подставляются, а `instanceof` смотрит на цель: `new B() instanceof f === true`.
- `length` = `max(0, f.length - args.length)`, `name` = `'bound ' + f.name`.

### `new` пошагово

`new F(...args)` вызывает `F.[[Construct]](args, newTarget = F)`. Для базового конструктора (не `extends`):

1. `OrdinaryCreateFromConstructor`: создать объект, прототип — `newTarget.prototype`. Если это не объект — `%Object.prototype%` из realm конструктора.
2. Привязать этот объект как `this` и выполнить тело.
3. Если тело вернуло **объект** — результат он. Примитив в `return` игнорируется, возвращается `this`.

`new.target` внутри функции — это `newTarget`: так функция отличает вызов через `new` от обычного. В производном классе (`extends`) `this` до вызова `super()` не инициализирован, и его создаёт базовый конструктор. Это разобрано в теме о прототипах и классах.

### `this` вне функций

| Где | `this` |
| --- | --- |
| Верхний уровень классического скрипта | `globalThis` (`window`) |
| Верхний уровень ES-модуля | `undefined` |
| Верхний уровень CommonJS-модуля в Node | `module.exports` |
| Обработчик `addEventListener` (обычная функция) | `event.currentTarget` |
| Объект-слушатель `{ handleEvent(e) {} }` | сам объект |
| Колбэк `setTimeout` (обычная функция) | в браузере — `window`, в Node — объект `Timeout` |
| Колбэк `forEach`/`map` | `thisArg`, иначе `undefined` |

Строки про DOM и таймеры — не ECMAScript, а соглашения хоста. DOM вызывает слушатель с `this` = `currentTarget` (шаг «inner invoke»).

> [!WARNING]
> Стрелка в поле класса (`handle = () => {}`) создаётся **для каждого экземпляра** в конструкторе. Это удобно для колбэков, но такой метод не лежит на прототипе: его нельзя переопределить через `super.handle()` в наследнике, и он занимает память на каждый объект. Метод на прототипе + `bind` в момент передачи — тоже одна новая функция на передачу.

### Vue: `this` в Options API и его отсутствие в Composition API

В Options API Vue при инициализации компонента делает `methods[key].bind(publicThis)` для каждого метода, а `data` вызывает как `data.call(publicThis, publicThis)`. `publicThis` — прокси экземпляра, через который видны `data`, `props`, `computed` и методы. Следствия:

- методы можно передавать как колбэки (`setTimeout(this.save)`) без потери `this`;
- метод-стрелка в `methods` не работает: `bind` не меняет `this` стрелки, а внешний `this` модуля — `undefined`;
- `data: (vm) => ({ ... })` допустим: экземпляр приходит первым аргументом.

В Composition API и `<script setup>` `this` нет вообще: `setup()` вызывается без экземпляра в `this`, состояние — локальные переменные, и функции работают через [замыкания](./closures.md). Колбэки можно передавать куда угодно без `bind`. В шаблоне `this` тоже не нужен: выражения компилируются в обращения к контексту рендера.

## Примеры

### Потеря `this` и три способа её избежать

```js
class Uploader {
  files = [];
  add(file) { this.files.push(file); }
  addArrow = (file) => { this.files.push(file); };
}

const u = new Uploader();
['a', 'b'].forEach(u.add);              // TypeError: Cannot read properties of undefined
['a', 'b'].forEach(u.add, u);           // thisArg of forEach
['a', 'b'].forEach(u.add.bind(u));      // bound function
['a', 'b'].forEach((f) => u.add(f));    // call through the property
['a', 'b'].forEach(u.addArrow);         // arrow field: own this per instance
```

Тело класса — строгий код, поэтому `this` в оторванном методе — `undefined`, а не `window`. Ошибка честная и видна сразу.

### `this` в обработчике событий

```js
const counter = {
  count: 0,
  handleEvent(e) { this.count++; },     // object listener: this === counter
};
button.addEventListener('click', counter);

button.addEventListener('click', function () {
  this.disabled = true;                 // this === event.currentTarget
});
```

Объект с `handleEvent` — забытая альтернатива `bind`: один и тот же объект можно снять через `removeEventListener`, и `this` остаётся правильным.

## Вопросы с интервью

::: details Как определяется значение this? Перечислите правила и их приоритет.
`this` задаётся при вызове, а не при объявлении. Правила по убыванию приоритета: `new` — новый объект с прототипом `F.prototype`; явная привязка (`bind`, затем `call`/`apply`) — переданное значение; вызов через свойство (`obj.f()`) — объект слева от точки; обычный вызов — `undefined` в strict mode или `globalThis` в нестрогом. Стрелки вне правил: у них нет своего `this`, он берётся из окружения, где стрелку создали. По спецификации это два шага: `EvaluateCall` берёт базу из Reference Record, `OrdinaryCallBindThis` применяет `[[ThisMode]]` (в нестрогом режиме подставляет `globalThis` и упаковывает примитивы).
:::

::: details Чем стрелочная функция отличается от обычной?
У стрелки нет своих `this`, `arguments`, `super` и `new.target`: всё берётся из внешней функции (`[[ThisMode]]: lexical`). Нет `[[Construct]]` и свойства `prototype`, поэтому `new` даёт `TypeError`. `call`/`apply`/`bind` не меняют её `this`, только передают аргументы. Не может быть генератором. Тело-выражение возвращает значение неявно. Практически: стрелки — для колбэков, которым нужен `this` окружения; обычные функции и методы — когда `this` должен зависеть от объекта, например методы прототипа и методы в `methods` во Vue.
:::

::: details Что делает оператор new по шагам?
Вызывает `[[Construct]]` с `newTarget` = сам конструктор. Создаётся объект с прототипом `newTarget.prototype` (если там не объект — `Object.prototype`). Тело выполняется с этим объектом в `this`. Если тело вернуло объект, результат — он, иначе — созданный `this`. Внутри доступен `new.target`. В производном классе объект создаёт не `new`, а базовый конструктор при вызове `super()`, поэтому `this` до `super()` — `ReferenceError`.
:::

::: details Почему метод теряет this, когда его передают как колбэк?
`obj.f` в позиции вызова — ссылка «база + имя», и `this` берётся из базы. Когда метод передают (`setTimeout(obj.f)`, `arr.map(obj.f)`, `const f = obj.f`), передаётся только значение — функция без объекта. Получатель вызывает её как `f()`, и `this` становится `undefined` (или `globalThis`). Решения: `bind`, обёртка-стрелка `() => obj.f()`, параметр `thisArg` у методов массива, стрелка в поле класса. В Options API Vue уже связал методы с экземпляром.
:::

::: details Что будет, если вызвать bind дважды, и что делает new с bound function?
Второй `bind` не меняет `this`: внешняя bound function вызывает внутреннюю, а та игнорирует переданный `this` и использует свой `[[BoundThis]]`. Аргументы при этом накапливаются. При `new` bound function вызывает `[[Construct]]` цели: связанный `this` игнорируется, частично применённые аргументы сохраняются, `instanceof` работает с исходным конструктором. Если цель не конструктор (стрелка, метод), у bound function тоже нет `[[Construct]]`.
:::

::: details Чему равен this на верхнем уровне и в обработчике события?
В классическом скрипте — `globalThis` (`window`), в ES-модуле — `undefined`, в CommonJS-модуле Node — `module.exports`. В обработчике `addEventListener`, объявленном обычной функцией, — `event.currentTarget` (элемент, на котором висит слушатель, а не `event.target`). Если слушатель — объект с `handleEvent`, `this` — этот объект. Стрелка-обработчик берёт `this` снаружи. Независимо от среды есть `globalThis`.
:::

::: details Что такое arguments и почему его заменяют rest-параметрами?
Массивоподобный объект с переданными аргументами, есть только у обычных функций. В нестрогом коде с простыми параметрами он mapped: `arguments[0]` и первый параметр — одна ячейка, и запись в один меняет другой. Это неочевидно и мешает оптимизациям. В strict mode или с параметрами по умолчанию, rest или деструктуризацией объект unmapped. Rest-параметр — настоящий массив, виден в сигнатуре, работает в стрелках и не связан с параметрами.
:::

::: details Почему в Options API Vue нельзя объявлять методы стрелками?
Vue связывает каждый метод с прокси экземпляра через `bind(publicThis)`. У стрелки нет своего `this`, `bind` его не меняет, и внутри остаётся `this` модуля — `undefined` в ES-модуле. Обращение `this.count` падает. Обычные функции и сокращённые методы `inc() {}` получают `this` = экземпляр и остаются связанными, даже если их передать как колбэк. В Composition API вопроса нет: `this` не используется, функции замыкают локальные `ref`.
:::

## Задачи

### 1. Предскажите вывод · легко

```js
'use strict';
const user = {
  login: 'Ann',
  regular() { return this?.login; },
  arrow: () => this?.login,
  nested() {
    const inner = function () { return this?.login; };
    const innerArrow = () => this.login;
    return [inner(), innerArrow()];
  },
};

console.log(user.regular());
const { regular } = user;
console.log(regular());
console.log(user.arrow());
console.log(user.nested());
```

::: details Решение и разбор
`'Ann'`, `undefined`, `undefined`, `[undefined, 'Ann']`.

- `user.regular()` — вызов через свойство, `this === user`.
- Деструктуризация вынимает значение, `regular()` — обычный вызов, в strict mode `this === undefined`.
- `arrow` создана на верхнем уровне скрипта, где `this` — `globalThis`, и у него нет `login`. В модуле `this` — `undefined`, и `?.` тоже даёт `undefined`. Литерал объекта не создаёт область для `this`.
- `inner()` — обычный вызов, `this` потерян. `innerArrow` берёт `this` метода `nested`, то есть `user`.
:::

### 2. Ссылка или значение · средне

```js
'use strict';
const obj = { f() { return this === obj; } };

console.log((obj.f)());
console.log((0, obj.f)());
console.log((obj.f = obj.f)());
console.log(obj?.f());
console.log((obj?.f)());
console.log([obj.f][0]());
```

::: details Решение и разбор
`true`, `false`, `false`, `true`, `true`, `false`.

- Скобки возвращают ссылку без изменений, база `obj` сохраняется.
- Запятая и присваивание вычисляют значение через `GetValue` — до вызова доходит голая функция.
- Optional chaining возвращает ссылку на свойство, в том числе в скобках: `(obj?.f)()` вызывается с `this === obj`.
- `[obj.f][0]()` — тоже вызов через свойство, но база — массив: `this` — массив, а не `obj`.

Правило одно: `this` — это база ссылки, которая дошла до скобок вызова.
:::

### 3. `bind`, `call` и `new` вперемешку · средне

```js
function Point(x, y) {
  this.x = x;
  this.y = y;
  return this.label ?? 'point';
}

const a = { label: 'A' };
const b = { label: 'B' };

const boundA = Point.bind(a, 1);
console.log(boundA(2), a.x, a.y);
console.log(boundA.call(b, 3), b.x);
console.log(boundA.bind(b)(4), a.y);

const p = new boundA(5);
console.log(p.x, p.y, p.label, p instanceof Point);
console.log(boundA.name, boundA.length);
```

::: details Решение и разбор
```text
A 1 2
A undefined
A 4
1 5 undefined true
bound Point 1
```

- `boundA(2)` → `Point.call(a, 1, 2)`: поля записаны в `a`, возвращена метка `'A'`.
- `call(b, …)` не перебивает `[[BoundThis]]`: снова пишется в `a`, `b.x` остаётся `undefined`.
- Повторный `bind` тоже: `this` — `a`, `a.y` становится `4`.
- `new boundA(5)` игнорирует связанный `this`: создаётся новый объект с прототипом `Point.prototype`, аргументы `1, 5`. Строка из `return` — примитив, поэтому результат — созданный объект.
- `length` = `2 − 1` = `1`.
:::

### 4. Реализуйте `new` как функцию · средне

Напишите `construct(Ctor, ...args)`, повторяющий `new Ctor(...args)` для обычных функций-конструкторов: прототип, `this`, правило возврата объекта, `TypeError` для не-конструкторов. `Reflect.construct` использовать нельзя.

::: details Решение и разбор
```js
function construct(Ctor, ...args) {
  if (typeof Ctor !== 'function' || !Object.hasOwn(Ctor, 'prototype')) {
    throw new TypeError('Ctor is not a constructor');
  }
  const proto = Ctor.prototype;
  const instance = Object.create(
    proto !== null && (typeof proto === 'object' || typeof proto === 'function')
      ? proto
      : Object.prototype,                 // OrdinaryCreateFromConstructor fallback
  );
  const result = Ctor.apply(instance, args);
  const isObject = result !== null && (typeof result === 'object' || typeof result === 'function');
  return isObject ? result : instance;
}

function User(name) { this.name = name; }
User.prototype.hi = function () { return `hi, ${this.name}`; };
construct(User, 'Ann').hi();              // 'hi, Ann'
```

Что модель не покрывает и почему:

- **Проверка конструктора** приблизительная: настоящий признак — наличие `[[Construct]]`, снаружи он не виден. Стрелки и методы отсекаются по отсутствию `prototype`, но bound function без `prototype` — конструктор, а функцию с вручную добавленным `prototype` пропустим ошибочно. Честная проверка — `Reflect.construct(String, [], Ctor)` в `try`.
- **Классы** так не создать: `Ctor.apply` для класса — `TypeError` (`[[IsClassConstructor]]`), а для производного класса `this` создаёт базовый конструктор.
- **`new.target`** внутри `Ctor` будет `undefined`. Передать его можно только через `Reflect.construct(Ctor, args, newTarget)`.

Сложность: O(1) сверх работы конструктора.
:::

### 5. `softBind` · сложно

`bind` привязывает `this` навсегда. Реализуйте `softBind(fn, defaultThis, ...args)`: возвращаемая функция использует `defaultThis` только при обычном вызове, а при вызове через свойство или `call`/`apply` берёт переданный `this`. Должны работать частичное применение аргументов и `new`.

```js
function hello() { return this.name; }
const greet = softBind(hello, { name: 'default' });
const obj = { name: 'obj', greet };

greet();                    // 'default'
obj.greet();                // 'obj'
greet.call({ name: 'x' });  // 'x'
setTimeout(obj.greet);      // 'default' in the browser, not window
```

::: details Решение и разбор
```js
function softBind(fn, defaultThis, ...bound) {
  function softBound(...args) {
    if (new.target) return Reflect.construct(fn, [...bound, ...args], new.target);
    const isDefault = this === undefined || this === globalThis;
    return fn.apply(isDefault ? defaultThis : this, [...bound, ...args]);
  }
  softBound.prototype = fn.prototype;    // instanceof keeps working
  Object.defineProperty(softBound, 'name', { value: `softBound ${fn.name}` });
  Object.defineProperty(softBound, 'length', {
    value: Math.max(0, fn.length - bound.length),
  });
  return softBound;
}
```

- `softBound` должна быть обычной функцией, а не стрелкой: ей нужен свой `this`, чтобы отличить вызов через свойство от обычного. Модуль — строгий код, поэтому «обычный вызов» даёт `undefined`. Проверка на `globalThis` нужна для хостов, которые передают глобальный объект явно (колбэк `setTimeout` в браузере).
- `new.target` отличает `new` от вызова. `Reflect.construct(fn, args, new.target)` создаёт объект с прототипом `new.target.prototype`, поэтому `softBound.prototype = fn.prototype` нужен для `instanceof` обеих функций. Так же ведёт себя настоящий `bind` при `new`.
- Ограничение: если `this` намеренно равен `globalThis` (`greet.call(window)`), его не отличить от вызова «без объекта». Встроенный `bind` такой проблемы не имеет: он не смотрит на `this` вовсе.
- Реализация `bind`, `call` и `apply` с нуля — в теме о полифилах.

Сложность: O(k) на вызов, где k — число аргументов (копирование в массив).
:::

## Источники

- [ECMAScript: ECMAScript Function Objects](https://tc39.es/ecma262/#sec-ecmascript-function-objects), [OrdinaryFunctionCreate](https://tc39.es/ecma262/#sec-ordinaryfunctioncreate), [MakeConstructor](https://tc39.es/ecma262/#sec-makeconstructor), [MakeMethod](https://tc39.es/ecma262/#sec-makemethod)
- [ECMAScript: [[Call]]](https://tc39.es/ecma262/#sec-ecmascript-function-objects-call-thisargument-argumentslist), [PrepareForOrdinaryCall](https://tc39.es/ecma262/#sec-prepareforordinarycall), [OrdinaryCallBindThis](https://tc39.es/ecma262/#sec-ordinarycallbindthis)
- [ECMAScript: Function Calls — Runtime Semantics](https://tc39.es/ecma262/#sec-function-calls-runtime-semantics-evaluation), [EvaluateCall](https://tc39.es/ecma262/#sec-evaluatecall), [Grouping Operator](https://tc39.es/ecma262/#sec-grouping-operator), [Comma Operator](https://tc39.es/ecma262/#sec-comma-operator), [Optional Chains](https://tc39.es/ecma262/#sec-optional-chains)
- [ECMAScript: Execution Contexts](https://tc39.es/ecma262/#sec-execution-contexts), [Function Environment Records](https://tc39.es/ecma262/#sec-function-environment-records), [GetThisEnvironment](https://tc39.es/ecma262/#sec-getthisenvironment), [ResolveThisBinding](https://tc39.es/ecma262/#sec-resolvethisbinding), [The this Keyword](https://tc39.es/ecma262/#sec-this-keyword)
- [ECMAScript: Bound Function Exotic Objects](https://tc39.es/ecma262/#sec-bound-function-exotic-objects), [BoundFunctionCreate](https://tc39.es/ecma262/#sec-boundfunctioncreate), [Function.prototype.bind](https://tc39.es/ecma262/#sec-function.prototype.bind), [call](https://tc39.es/ecma262/#sec-function.prototype.call), [apply](https://tc39.es/ecma262/#sec-function.prototype.apply)
- [ECMAScript: The new Operator](https://tc39.es/ecma262/#sec-new-operator), [EvaluateNew](https://tc39.es/ecma262/#sec-evaluatenew), [[[Construct]]](https://tc39.es/ecma262/#sec-ecmascript-function-objects-construct-argumentslist-newtarget), [OrdinaryCreateFromConstructor](https://tc39.es/ecma262/#sec-ordinarycreatefromconstructor), [GetPrototypeFromConstructor](https://tc39.es/ecma262/#sec-getprototypefromconstructor)
- [ECMAScript: Arguments Exotic Objects](https://tc39.es/ecma262/#sec-arguments-exotic-objects), [CreateMappedArgumentsObject](https://tc39.es/ecma262/#sec-createmappedargumentsobject), [CreateUnmappedArgumentsObject](https://tc39.es/ecma262/#sec-createunmappedargumentsobject)
- [ECMAScript: SetFunctionName](https://tc39.es/ecma262/#sec-setfunctionname), [NamedEvaluation](https://tc39.es/ecma262/#sec-runtime-semantics-namedevaluation), [Function instances: length](https://tc39.es/ecma262/#sec-function-instances-length), [name](https://tc39.es/ecma262/#sec-function-instances-name)
- [ECMAScript: Arrow Function Definitions](https://tc39.es/ecma262/#sec-arrow-function-definitions), [globalThis](https://tc39.es/ecma262/#sec-globalthis)
- [DOM Standard: inner invoke](https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke)
- [MDN: this](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/this)
- [MDN: Arrow function expressions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Arrow_functions)
- [MDN: Function.prototype.bind](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/bind)
- [MDN: new](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/new), [new.target](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/new.target)
- [MDN: The arguments object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/arguments)
- [MDN: EventTarget.addEventListener — The value of this within the handler](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#the_value_of_this_within_the_handler)
- [Vue: Reactivity Fundamentals — Declaring Methods](https://vuejs.org/guide/essentials/reactivity-fundamentals.html#declaring-methods), [`componentOptions.ts`](https://github.com/vuejs/core/blob/main/packages/runtime-core/src/componentOptions.ts)
