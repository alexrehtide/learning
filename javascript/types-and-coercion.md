---
title: Типы данных и приведение типов
level: ядро
---

# Типы данных и приведение типов

> **Коротко.** В JavaScript восемь типов: семь примитивов (`undefined`, `null`, `boolean`, `number`, `bigint`, `string`, `symbol`) и `object`. Примитивы неизменяемы и сравниваются по значению, объекты сравниваются по ссылке. Неявное приведение типов (coercion) — не магия, а несколько абстрактных операций спецификации: `ToPrimitive`, `ToNumber`, `ToString`, `ToBoolean`. Операторы `+`, `==`, `<` и `if` просто вызывают их в определённом порядке.

**Связанные темы:** [Область видимости и hoisting](./scope-and-hoisting.md), [Функции и `this`](./functions-and-this.md), [Прототипы и классы](./prototypes-and-classes.md), [Дескрипторы свойств, `Proxy` и `Reflect`](./property-descriptors-and-proxy.md), [Деструктуризация, spread/rest и современный синтаксис](./modern-syntax.md)

## Теория

### Восемь типов

Спецификация ECMAScript называет их **language types** (типы языка). Тип есть у значения, а не у переменной: переменная может хранить сначала число, потом строку.

| Тип | Значения | `typeof` |
| --- | --- | --- |
| Undefined | `undefined` | `"undefined"` |
| Null | `null` | `"object"` (исторический баг) |
| Boolean | `true`, `false` | `"boolean"` |
| Number | IEEE 754 double, включая `NaN`, `±Infinity`, `-0` | `"number"` |
| BigInt | целые произвольной длины: `10n` | `"bigint"` |
| String | последовательность 16-битных code units (UTF-16) | `"string"` |
| Symbol | уникальный идентификатор: `Symbol('id')` | `"symbol"` |
| Object | всё остальное: объекты, массивы, функции, `Date`, `Map`… | `"object"` или `"function"` |

Функция — не отдельный тип, а объект с внутренним методом `[[Call]]`. Поэтому `typeof` возвращает для неё `"function"`, хотя в таблице типов её нет. Виды функций и их внутренние слоты — в теме [«Функции и `this`»](./functions-and-this.md).

### Примитивы и объекты

**Примитив** — неизменяемое значение. Методы строки не меняют строку, а возвращают новую: `s.toUpperCase()` не трогает `s`. Сравнение `===` у примитивов идёт по значению.

**Объект** — изменяемая коллекция свойств, доступная по ссылке. Два объекта равны (`===`), только если это один и тот же объект.

Аргументы в функцию передаются всегда **по значению**. Но у объекта «значение» — это ссылка, поэтому функция может изменить объект, но не может подменить его у вызывающего. Это иногда называют call by sharing.

### Автоупаковка: почему у строки есть методы

У примитива нет свойств, но `'abc'.length` работает. При обращении к свойству спецификация вызывает `ToObject`: для строки создаётся временная обёртка `String`, свойство читается у неё (или у `String.prototype`), обёртка выбрасывается. Это называется **автоупаковка** (autoboxing).

Записать свойство в примитив нельзя. Операция `OrdinarySet` получает примитив в роли receiver и возвращает `false`. В sloppy mode запись `'abc'.foo = 1` молча теряется, в strict mode — `TypeError: Cannot create property 'foo' on string 'abc'`.

> [!WARNING]
> `new String('abc')`, `new Number(0)`, `new Boolean(false)` создают **объекты-обёртки**. `typeof new Boolean(false)` — `"object"`, и в `if` он истинный: любой объект truthy. Не используйте конструкторы обёрток с `new`. Без `new` (`String(x)`, `Number(x)`) они просто приводят тип.

### `undefined` и `null`

- `undefined` — «значения нет»: неинициализированная переменная, отсутствующее свойство, не переданный аргумент, функция без `return`.
- `null` — «значения нет, и это намеренно»: его присваивают явно.

Различия, которые видны в коде:

| | `undefined` | `null` |
| --- | --- | --- |
| Параметр по умолчанию срабатывает | да | нет |
| `JSON.stringify({ a: … })` | свойство пропадает | `{"a":null}` |
| `Number(…)` | `NaN` | `0` |
| `typeof` | `"undefined"` | `"object"` |

`??` и `?.` считают «пустыми» оба значения. `x == null` — единственный идиоматичный случай `==`: он истинен ровно для `null` и `undefined` (и для `document.all`, см. ниже).

> [!NOTE]
> `typeof null === "object"` — ошибка первой реализации 1995 года. Тип хранился в младших битах значения, у объектов тег был `0`, а `null` был нулевым указателем. Исправление предлагали в ES2015 (`typeof null === "null"`), но отклонили: сломалось бы слишком много сайтов.

### Number: что нужно знать о double

Все числа `number` — 64-битные числа с плавающей точкой IEEE 754. Отсюда:

- `0.1 + 0.2 === 0.30000000000000004`: `0.1` и `0.2` не представимы в двоичной дроби точно, ошибки округления складываются.
- Точно представимы целые до `Number.MAX_SAFE_INTEGER` (`2**53 - 1`). Дальше `2**53 + 1 === 2**53`.
- `NaN` — единственное значение, не равное самому себе: `NaN === NaN` ложно.
- Есть `-0`: `-0 === 0` истинно, но `1 / -0 === -Infinity` и `Object.is(-0, 0) === false`.

Числа с плавающей точкой сравнивают с допуском. Деньги хранят в целых копейках или используют `BigInt`/библиотеку десятичной арифметики.

`BigInt` нельзя смешивать с `number` в арифметике: `1n + 1` — `TypeError`. А сравнения работают: `1n == 1` истинно, `2n > 1` истинно, `1n === 1` ложно (разные типы).

### Строки и UTF-16

Строка — последовательность 16-битных code units, а не символов. Символ за пределами BMP занимает два code units (суррогатная пара):

```js
'😀'.length;        // 2
[...'😀'].length;   // 1 — the string iterator walks code points
'😀'.at(0);         // '\uD83D' — half of a surrogate pair
```

### Абстрактные операции приведения

Неявное приведение спецификация описывает несколькими операциями. Всё, что «странно» ведёт себя на интервью-квизах, выводится из них.

**`ToPrimitive(input, hint)`** превращает объект в примитив. `hint` — `"string"`, `"number"` или отсутствует (`"default"`).

1. Если у объекта есть метод `[Symbol.toPrimitive]`, он вызывается с подсказкой. Вернул объект — `TypeError`.
2. Иначе вызывается `OrdinaryToPrimitive`: при hint `"string"` пробует `toString()`, потом `valueOf()`; при `"number"` и `"default"` — наоборот, `valueOf()`, потом `toString()`. Первый результат-примитив возвращается. Ни один не вернул примитив — `TypeError`.

У обычного объекта `valueOf()` возвращает сам объект, поэтому дело доходит до `toString()`: `"[object Object]"`. У массива `toString()` — это `join(',')`: `[]` → `""`, `[1, 2]` → `"1,2"`, `[null]` → `""`.

Свой `[Symbol.toPrimitive]` в стандартной библиотеке есть только у `Date` и `Symbol`. `Date` при `"default"` ведёт себя как при `"string"`, поэтому `date + 1` — конкатенация строк, а `date - 1` — число.

**`ToNumber`:**

| Значение | Результат |
| --- | --- |
| `undefined` | `NaN` |
| `null`, `false`, `""`, `"  "` | `0` |
| `true` | `1` |
| `"42"`, `" 42\n"`, `"0x2A"`, `"4.2e1"` | `42` |
| `"42px"`, `"1_000"` | `NaN` |
| `Symbol`, `BigInt` | `TypeError` |
| объект | `ToNumber(ToPrimitive(obj, "number"))` |

`Number('42px')` — `NaN`, а `parseInt('42px', 10)` — `42`: `parseInt` и `parseFloat` читают префикс строки и останавливаются на первом неподходящем символе. `Number(10n)` работает (конструктор `Number` умеет `BigInt`), а `+10n` — `TypeError`.

**`ToString`:** `null` → `"null"`, `-0` → `"0"`, массив → `join(',')`, обычный объект → `"[object Object]"`. Неявно привести `Symbol` к строке нельзя: `` `${sym}` `` и `'' + sym` дают `TypeError`, а явный `String(sym)` работает.

**`ToBoolean`** таблицы не требует: ложных (falsy) значений восемь — `false`, `0`, `-0`, `0n`, `NaN`, `""`, `null`, `undefined`. Всё остальное истинно (truthy), включая `[]`, `{}`, `"0"`, `"false"` и `new Boolean(false)`.

> [!NOTE]
> Девятое ложное значение — `document.all`. HTML Living Standard даёт ему внутренний слот `[[IsHTMLDDA]]`, и спецификация ECMAScript (раздел Normative Optional) делает для него исключения: `typeof document.all === "undefined"`, он falsy и `document.all == null`. Так старый код вида `if (document.all) { /* IE */ }` перестал считать современные браузеры за IE.

### Оператор `+`

`+` — единственный арифметический оператор, который умеет и складывать, и конкатенировать. Алгоритм `ApplyStringOrNumericBinaryOperator`:

1. Оба операнда → `ToPrimitive` **без подсказки**.
2. Если хотя бы один получился строкой — оба → `ToString`, конкатенация.
3. Иначе оба → `ToNumeric`; если один `BigInt`, а другой `number` — `TypeError`.

Остальные арифметические операторы (`-`, `*`, `/`, `%`, `**`) сразу приводят к числу. Поэтому `'5' + 1 === '51'`, но `'5' - 1 === 4`.

### Сравнения: `==`, `===`, `Object.is`

В языке четыре алгоритма равенства:

| Алгоритм | Где используется | `NaN` и `NaN` | `+0` и `-0` |
| --- | --- | --- | --- |
| `IsLooselyEqual` | `==` | не равны | равны |
| `IsStrictlyEqual` | `===`, `indexOf`, `switch` | не равны | равны |
| `SameValueZero` | `includes`, `Map`, `Set` | равны | равны |
| `SameValue` | `Object.is` | равны | не равны |

`IsLooselyEqual(x, y)` по шагам:

1. Типы совпадают → `x === y`.
2. `null` и `undefined` равны друг другу (и только друг другу).
3. Число и строка → строка приводится к числу.
4. `BigInt` и строка → строка приводится к `BigInt` (не удалось — `false`).
5. Булево → приводится к числу. Поэтому `'1' == true` истинно, а `'true' == true` ложно.
6. Объект и примитив (не `null`/`undefined`) → объект через `ToPrimitive` без подсказки.
7. `BigInt` и конечное число → сравнение математических значений.
8. Иначе `false`.

Отсюда `null == 0` ложно (правило 2 не даёт `null` приводиться к числу), хотя `null >= 0` истинно: операторы `<`, `>`, `<=`, `>=` используют `IsLessThan`, который приводит `null` к `0`.

> [!TIP]
> Правило для кода: всегда `===`, кроме проверки `x == null`. В TypeScript и линтерах (`eqeqeq` с опцией `null: "ignore"`) это общепринятое исключение.

### Как определить тип значения

| Способ | Плюсы | Ловушки |
| --- | --- | --- |
| `typeof x` | работает для необъявленной переменной; быстрый | `null` → `"object"`; массив, `Date`, `Map` — все `"object"` |
| `x instanceof C` | проверяет цепочку прототипов | не работает между realm (iframe, `vm`); ложен для примитивов; переопределяется через `Symbol.hasInstance` |
| `Array.isArray(x)` | работает между realm и для `Proxy` массива | только массивы |
| `Object.prototype.toString.call(x)` | `"[object Null]"`, `"[object Date]"`, `"[object Map]"` | подменяется через `Symbol.toStringTag` |
| `Number.isNaN(x)` | без приведения | глобальный `isNaN('abc')` — `true`, потому что приводит к числу |

`typeof` необъявленной переменной — `"undefined"` без ошибки. Но для `let`/`const` в [temporal dead zone](./scope-and-hoisting.md#temporal-dead-zone) `typeof` бросает `ReferenceError`.

### Vue: почему примитив нельзя сделать `reactive`

Реактивность Vue 3 построена на [`Proxy`](./property-descriptors-and-proxy.md), а `Proxy` принимает только объект в качестве цели. Примитив — значение, у него нет «места», где перехватить чтение и запись. Поэтому `reactive(1)` возвращает `1` с предупреждением в dev-режиме, а для примитивов существует `ref`: объект-контейнер, у которого перехватывается `.value`. По той же причине деструктуризация `reactive`-объекта теряет реактивность: в переменную копируется примитив, а не ссылка на источник.

Приведение типов встречается и в шаблонах. Модификатор `v-model.number` вызывает `parseFloat` и, если получился `NaN`, оставляет исходную строку. Поэтому значение может оказаться и `number`, и `string` — проверяйте тип перед вычислениями.

## Примеры

### `[Symbol.toPrimitive]` и подсказки

```js
const temperature = {
  celsius: 21,
  [Symbol.toPrimitive](hint) {
    if (hint === 'string') return `${this.celsius}°C`;
    if (hint === 'number') return this.celsius;
    return `t=${this.celsius}`; // 'default': used by + and ==
  },
};

`${temperature}`;    // '21°C'   — template literal uses hint 'string'
temperature * 2;     // 42       — hint 'number'
temperature + '';    // 't=21'   — hint 'default'
temperature == 't=21'; // true   — == also uses no hint
```

### Классика квизов, разобранная по шагам

```js
[] + [];     // '' + ''                      → ''
[] + {};     // '' + '[object Object]'        → '[object Object]'
[] == ![];   // [] == false → [] == 0 → '' == 0 → 0 == 0 → true
'b' + 'a' + +'a' + 'a'; // 'ba' + NaN + 'a'   → 'baNaNa'
[1, 2] + [3];          // '1,2' + '3'         → '1,23'
null + 1;    // ToNumber(null) = 0             → 1
undefined + 1;         // NaN + 1              → NaN
true + true;           // 1 + 1                → 2
```

> [!WARNING]
> `{} + []` в консоли даёт `0`, а не `'[object Object]'`: в начале инструкции `{}` разбирается как пустой блок, остаётся унарный `+[]` → `0`. Внутри выражения (`({} + [])`) результат `'[object Object]'`.

## Вопросы с интервью

::: details Какие типы есть в JavaScript и чем примитив отличается от объекта?
Восемь типов: семь примитивов (`undefined`, `null`, `boolean`, `number`, `bigint`, `string`, `symbol`) и `object`. Функции и массивы — объекты.

Примитив неизменяем и сравнивается по значению; у него нет собственных свойств, а методы доступны через автоупаковку — временную обёртку `String`/`Number`/… Объект изменяем, хранится по ссылке и сравнивается по ссылке: `{} === {}` ложно.

При передаче в функцию копируется значение; у объекта значение — ссылка. Поэтому функция может мутировать переданный объект, но не может заменить его у вызывающего кода.
:::

::: details Почему typeof null возвращает "object"?
Это баг первой реализации JavaScript. Значения хранились с тегом типа в младших битах, у объектов тег был `0`, а `null` представлялся нулевым указателем — и проверка тега давала «объект». Исправление (`typeof null === "null"`) предлагали для ES2015, но отклонили из-за обратной совместимости.

Проверка на `null` — `x === null`, на «объект, но не `null`» — `x !== null && typeof x === 'object'`.
:::

::: details Как работает нестрогое равенство и когда его оправданно использовать?
`==` запускает алгоритм `IsLooselyEqual`. Если типы одинаковы — это `===`. `null` и `undefined` равны только друг другу. Число и строка: строка приводится к числу. Булево приводится к числу. Объект и примитив: объект приводится через `ToPrimitive` без подсказки (`valueOf`, потом `toString`). `BigInt` сравнивается с числом и строкой по математическому значению.

Следствия: `'1' == true` (`1 == 1`), но `'true' == true` ложно (`NaN == 1`); `[] == false` истинно; `null == 0` ложно.

Оправданный случай один: `x == null` как короткая проверка «`null` или `undefined`». В остальных — `===`.
:::

::: details Как объект приводится к примитиву?
Через `ToPrimitive(obj, hint)`. Сначала ищется метод `obj[Symbol.toPrimitive]` и вызывается с подсказкой `"string"`, `"number"` или `"default"`. Если его нет — `OrdinaryToPrimitive`: для подсказки `"string"` порядок `toString` → `valueOf`, иначе `valueOf` → `toString`. Возвращается первый примитивный результат; если оба метода вернули объекты — `TypeError`.

Подсказку `"string"` дают шаблонные строки и `String(obj)`, `"number"` — арифметика, `Number(obj)`, сравнения `<`/`>`; без подсказки работают `+` и `==`. `Date` трактует «без подсказки» как `"string"`, поэтому `new Date() + 1` — строка.
:::

::: details Почему 0.1 + 0.2 не равно 0.3 и как сравнивать дробные числа?
Числа хранятся как двоичные IEEE 754 double. `0.1` и `0.2` — бесконечные двоичные дроби, они округляются при записи, и ошибки складываются: результат `0.30000000000000004`.

Сравнивают с допуском: `Math.abs(a - b) < Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b))` или с прикладным допуском (`1e-9`). Для денег — целые минимальные единицы (копейки), `BigInt` или десятичная библиотека. `toFixed` годится для отображения, но не для вычислений — он возвращает строку и сам может округлить неожиданно (`(1.005).toFixed(2) === '1.00'`).
:::

::: details Чем отличаются ===, Object.is и SameValueZero?
Все три не приводят типы и различаются двумя краевыми случаями. `===` (`IsStrictlyEqual`) считает `NaN !== NaN` и `+0 === -0`. `Object.is` (`SameValue`) — наоборот: `NaN` равен `NaN`, `+0` не равен `-0`. `SameValueZero` — среднее: `NaN` равен `NaN`, `+0` равен `-0`.

Практические следствия: `[NaN].indexOf(NaN) === -1`, но `[NaN].includes(NaN) === true`; `Map` и `Set` используют `SameValueZero`, поэтому ключ `NaN` находится. Во Vue `hasChanged` сравнивает через `Object.is`, чтобы присваивание `NaN` поверх `NaN` не запускало эффекты повторно.
:::

::: details Как надёжно проверить, что значение — массив, и почему instanceof не всегда подходит?
`Array.isArray(x)`. `instanceof Array` проверяет, есть ли `Array.prototype` в [цепочке прототипов](./prototypes-and-classes.md), а у массива из другого realm (iframe, Node `vm`) — свой `Array.prototype`, и проверка даёт `false`. `Array.isArray` смотрит на внутреннюю природу объекта (exotic Array object), поэтому работает между realm и для `Proxy` над массивом.

Для остальных встроенных типов есть `Object.prototype.toString.call(x)` → `"[object Date]"`, `"[object Map]"`, но его можно подменить через `Symbol.toStringTag`. Для примитивов достаточно `typeof`, с поправкой на `null`.
:::

::: details Почему у строки можно вызвать метод, а записать в неё свойство нельзя?
При чтении свойства у примитива спецификация вызывает `ToObject`: создаётся временная обёртка (`String`), свойство ищется у неё и в `String.prototype`. Движки эту обёртку не создают физически, но семантика такая.

При записи `OrdinarySet` получает примитив как receiver и возвращает `false`: свойство некуда сохранить. В sloppy mode это молчаливая потеря, в strict mode (а модули и классы всегда strict) — `TypeError`.
:::

## Задачи

### 1. Предскажите вывод · легко

```js
console.log(1 < 2 < 3);
console.log(3 > 2 > 1);
console.log('2' + 2 * '2');
console.log([] == 0, [0] == false, [1, 2] == '1,2');
console.log(null == 0, null >= 0, undefined == 0);
console.log(typeof NaN, typeof typeof 1, typeof class {});
```

::: details Решение и разбор
```js
true                  // (1 < 2) → true → true < 3 → 1 < 3
false                 // (3 > 2) → true → true > 1 → 1 > 1
'24'                  // * first: 2 * 2 = 4, then '2' + 4
true true true        // '' == 0; '0' == 0 → 0 == 0; '1,2' == '1,2'
false true false      // == has no null→number rule; >= uses ToNumber(null) = 0
'number' 'string' 'function'
```

Цепочки сравнений вычисляются слева направо, и промежуточный `boolean` приводится к числу. `typeof` всегда возвращает строку, поэтому `typeof typeof x` — всегда `'string'`. Класс — функция с `[[Call]]` (вызывать без `new` запрещено, но тип от этого не меняется).
:::

### 2. Реализуйте `Object.is` · легко

Напишите `objectIs(a, b)`, совпадающий с `Object.is`, используя только `===`.

::: details Решение и разбор
```js
function objectIs(a, b) {
  if (a === b) {
    // +0 === -0 is true, but 1 / +0 = Infinity and 1 / -0 = -Infinity
    return a !== 0 || 1 / a === 1 / b;
  }
  // NaN is the only value not equal to itself
  return a !== a && b !== b;
}
```

`===` расходится с `SameValue` ровно в двух случаях, и оба закрываются отдельной веткой. Так выглядел полифил `Object.is` для ES5.

Сложность: O(1).
:::

### 3. Функция `getType` · средне

Напишите `getType(value)`, которая возвращает точный тип строкой в нижнем регистре: `'null'`, `'undefined'`, `'number'`, `'array'`, `'date'`, `'map'`, `'function'`, `'object'` и т. д. Должна работать с массивами из другого realm.

::: details Решение и разбор
```js
function getType(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t !== 'object') return t; // primitives and functions
  if (Array.isArray(value)) return 'array';
  // '[object Date]' -> 'date'; works across realms
  return Object.prototype.toString.call(value).slice(8, -1).toLowerCase();
}

getType(null);           // 'null'
getType([]);             // 'array'
getType(new Date());     // 'date'
```

`null` отсекаем первым из-за бага `typeof`. Примитивы и функции надёжно определяет `typeof`. Для объектов `Object.prototype.toString` читает встроенный тег и не зависит от realm. Слабое место — `Symbol.toStringTag`: объект `{ [Symbol.toStringTag]: 'Date' }` вернёт `'date'`. Если это важно, проверяйте внутренние слоты косвенно: например, `Date.prototype.getTime.call(value)` бросит `TypeError` для не-`Date`.

Сложность: O(1).
:::

### 4. `a == 1 && a == 2 && a == 3` · средне

Сделайте так, чтобы выражение было истинным. Затем — чтобы истинным было `a === 1 && a === 2 && a === 3`.

::: details Решение и разбор
```js
// Loose equality: object vs number → ToPrimitive(a) on every comparison
const a = {
  current: 0,
  valueOf() { return ++this.current; },
};
console.log(a == 1 && a == 2 && a == 3); // true

// Strict equality: no coercion, so intercept the read of `b` itself
let i = 0;
Object.defineProperty(globalThis, 'b', {
  get: () => ++i,
});
console.log(b === 1 && b === 2 && b === 3); // true
```

Для `==` каждое сравнение объекта с числом заново вызывает `ToPrimitive`, а он — `valueOf`. Подойдёт и `[Symbol.toPrimitive]`.

Со `===` приведения нет, поэтому меняться должно само значение при каждом чтении: геттер на глобальном объекте (или `with` с `Proxy` в sloppy mode). Смысл задачи на интервью — показать, что вы знаете, где вызывается пользовательский код при сравнении.
:::

### 5. Реализуйте `==` · сложно

Напишите `looseEquals(x, y)`, совпадающую с `x == y` для любых значений, без использования `==` и `!=`. Разрешены `===`, `typeof`, `Number()`, `BigInt()`.

::: details Решение и разбор
```js
const isObject = (v) => (typeof v === 'object' && v !== null) || typeof v === 'function';

function toPrimitive(obj) {
  // ToPrimitive with no hint
  const exotic = obj[Symbol.toPrimitive];
  if (exotic !== undefined && exotic !== null) {
    const result = exotic.call(obj, 'default');
    if (isObject(result)) throw new TypeError('Cannot convert object to primitive value');
    return result;
  }
  for (const name of ['valueOf', 'toString']) {
    const method = obj[name]; // read once, as the spec's Get does
    const result = typeof method === 'function' ? method.call(obj) : obj;
    if (!isObject(result)) return result;
  }
  throw new TypeError('Cannot convert object to primitive value');
}

function stringToBigInt(s) {
  // BigInt(string) follows StringToBigInt but throws instead of returning undefined
  try { return BigInt(s); } catch { return undefined; }
}

function looseEquals(x, y) {
  const tx = isObject(x) ? 'object' : x === null ? 'null' : typeof x;
  const ty = isObject(y) ? 'object' : y === null ? 'null' : typeof y;

  if (tx === ty) return x === y;
  if ((tx === 'null' && ty === 'undefined') || (tx === 'undefined' && ty === 'null')) return true;
  if (tx === 'number' && ty === 'string') return looseEquals(x, Number(y));
  if (tx === 'string' && ty === 'number') return looseEquals(Number(x), y);
  if (tx === 'bigint' && ty === 'string') {
    const n = stringToBigInt(y);
    return n === undefined ? false : looseEquals(x, n);
  }
  if (tx === 'string' && ty === 'bigint') return looseEquals(y, x);
  if (tx === 'boolean') return looseEquals(Number(x), y);
  if (ty === 'boolean') return looseEquals(x, Number(y));
  const primitive = ['string', 'number', 'bigint', 'symbol'];
  if (primitive.includes(tx) && ty === 'object') return looseEquals(x, toPrimitive(y));
  if (tx === 'object' && primitive.includes(ty)) return looseEquals(toPrimitive(x), y);
  if ((tx === 'bigint' && ty === 'number') || (tx === 'number' && ty === 'bigint')) {
    const [num, big] = tx === 'number' ? [x, y] : [y, x];
    return Number.isInteger(num) && BigInt(num) === big; // isInteger rejects NaN and ±Infinity
  }
  return false;
}
```

Решение повторяет шаги `IsLooselyEqual` из спецификации в том же порядке — порядок важен: булево приводится к числу _до_ сравнения с объектом, поэтому `[1] == true` → `[1] == 1` → `'1' == 1` → `true`.

Тонкие места:
- `typeof` разделяет `null` и объект, а функции — тоже объекты.
- `StringToBigInt` принимает пустую и пробельную строку как `0n` и hex (`'0x10'`), но не принимает `'1.5'` и `'1e3'`. Спецификация в этом случае возвращает `undefined`, а `BigInt()` бросает `SyntaxError` — ловим.
- `BigInt` и `number` сравниваются по математическому значению. Дробное число не может быть равно целому `BigInt`, поэтому сразу `false`; иначе `BigInt(num)` точен.
- Исключение `document.all` опущено — это Normative Optional часть для браузеров.

Сложность: O(1) без учёта пользовательских `valueOf`/`toString`; глубина рекурсии не больше 3.
:::

## Источники

- [ECMAScript: ECMAScript Language Types](https://tc39.es/ecma262/#sec-ecmascript-language-types)
- [ECMAScript: ToPrimitive](https://tc39.es/ecma262/#sec-toprimitive) и [OrdinaryToPrimitive](https://tc39.es/ecma262/#sec-ordinarytoprimitive)
- [ECMAScript: ToBoolean](https://tc39.es/ecma262/#sec-toboolean), [ToNumber](https://tc39.es/ecma262/#sec-tonumber), [StringToNumber](https://tc39.es/ecma262/#sec-stringtonumber), [ToString](https://tc39.es/ecma262/#sec-tostring)
- [ECMAScript: IsLooselyEqual](https://tc39.es/ecma262/#sec-islooselyequal), [IsStrictlyEqual](https://tc39.es/ecma262/#sec-isstrictlyequal), [SameValue](https://tc39.es/ecma262/#sec-samevalue), [SameValueZero](https://tc39.es/ecma262/#sec-samevaluezero), [IsLessThan](https://tc39.es/ecma262/#sec-islessthan)
- [ECMAScript: ApplyStringOrNumericBinaryOperator](https://tc39.es/ecma262/#sec-applystringornumericbinaryoperator)
- [ECMAScript: The typeof Operator](https://tc39.es/ecma262/#sec-typeof-operator)
- [ECMAScript: The \[\[IsHTMLDDA\]\] Internal Slot](https://tc39.es/ecma262/#sec-IsHTMLDDA-internal-slot)
- [ECMAScript: Object.prototype.toString](https://tc39.es/ecma262/#sec-object.prototype.tostring)
- [HTML Living Standard: document.all](https://html.spec.whatwg.org/multipage/obsolete.html#dom-document-all)
- [MDN: JavaScript data types and data structures](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Data_structures)
- [MDN: Equality comparisons and sameness](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness)
- [MDN: typeof](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof)
- [MDN: Symbol.toPrimitive](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/toPrimitive)
- [MDN: Number — Number coercion](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number#number_coercion)
- [MDN: Number.EPSILON](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/EPSILON)
- [MDN: Falsy](https://developer.mozilla.org/en-US/docs/Glossary/Falsy)
- [Vue: Limitations of reactive()](https://vuejs.org/guide/essentials/reactivity-fundamentals.html#limitations-of-reactive)
- [Vue: Form Input Bindings — .number](https://vuejs.org/guide/essentials/forms.html#number)
