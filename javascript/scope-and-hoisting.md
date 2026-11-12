---
title: Область видимости и hoisting
level: ядро
---

# Область видимости и hoisting

> **Коротко.** Область видимости (scope) в JavaScript лексическая: её определяет место объявления в исходном коде, а не место вызова. Перед выполнением кода функции, блока или скрипта движок создаёт в окружении привязки (bindings) для всех его объявлений. Это и называют hoisting (поднятие). Код никуда не переносится. `var` сразу получает `undefined`, объявление функции — готовую функцию, а `let`/`const`/`class` остаются неинициализированными до своей строки. Этот промежуток называется temporal dead zone (TDZ, временная мёртвая зона).

**Связанные темы:** [Типы данных и приведение типов](./types-and-coercion.md), [Замыкания](./closures.md), [Функции и `this`](./functions-and-this.md), [Деструктуризация, spread/rest и современный синтаксис](./modern-syntax.md), [Event loop](./event-loop.md), [Модули: ESM и CommonJS](./modules.md)

## Теория

### Лексическая область видимости

Спецификация описывает области видимости через **Environment Record** (запись окружения): таблицу «имя → привязка» со ссылкой `[[OuterEnv]]` на внешнюю запись. Записи образуют цепочку от текущего блока до глобальной области.

Обращение к идентификатору — это `ResolveBinding`: поиск имени в текущей записи, затем во внешней, и так до глобальной (`GetIdentifierReference`). Цепочку задаёт **текст программы**. Функция запоминает окружение, в котором её создали (внутренний слот `[[Environment]]`), и при вызове строит своё окружение поверх него, а не поверх окружения вызывающего кода. На этом построены [замыкания](./closures.md).

Если имя не найдено нигде:

- чтение — `ReferenceError: x is not defined`;
- `typeof x` — `"undefined"` без ошибки;
- присваивание в sloppy mode создаёт свойство глобального объекта (неявная глобальная переменная), в strict mode — `ReferenceError`.

### Какие бывают записи окружения

| Область | Что её создаёт | Что в ней живёт |
| --- | --- | --- |
| Глобальная | один раз на realm, общая для всех классических `<script>` | встроенные глобальные объекты, объявления верхнего уровня скриптов |
| Модульная | каждый ES-модуль | объявления верхнего уровня модуля, привязки `import` |
| Функциональная | каждый вызов функции | параметры, `arguments`, `var`, объявления функций, `this` (у обычных функций) |
| Блочная | `{ … }`, `switch`, `catch`, циклы `for` | `let`, `const`, `class`, `using`, функции в блоке, параметр `catch` |
| Объектная | `with` и глобальный объект | свойства объекта в роли переменных |

Есть ещё две малозаметные области. **Именованное функциональное выражение** `const f = function g() {}` создаёт отдельную запись с одной неизменяемой привязкой `g`. Она видна только внутри функции, присваивание `g = 1` молча игнорируется (в strict mode — `TypeError`). **Класс** так же получает внутреннюю привязку своего имени.

Текущий контекст выполнения (execution context) хранит две ссылки: **LexicalEnvironment** — куда попадают `let`/`const`/`class` и где идёт поиск имён, и **VariableEnvironment** — куда попадают `var`. Вход в блок меняет только первую. Поэтому `var` «пробивает» блоки, а `let` — нет.

### Hoisting — это инстанцирование объявлений

Перед выполнением тела функции, скрипта, модуля или блока спецификация запускает **declaration instantiation**: `FunctionDeclarationInstantiation`, `GlobalDeclarationInstantiation`, `BlockDeclarationInstantiation`. Они собирают все объявления статически, по тексту, и создают привязки. Затем код выполняется сверху вниз.

| Объявление | Область | Состояние до своей строки | Повторное объявление в той же области |
| --- | --- | --- | --- |
| `var` | функция / скрипт | `undefined` | разрешено |
| `function f() {}` | функция / скрипт (в блоке — см. ниже) | готовая функция | разрешено, побеждает последняя |
| `let` | блок | неинициализирована (TDZ) | `SyntaxError` |
| `const` | блок | неинициализирована (TDZ) | `SyntaxError` |
| `class` | блок | неинициализирована (TDZ) | `SyntaxError` |
| `import` | модуль | связана при линковке модуля | `SyntaxError` |

Поэтому функцию-объявление можно вызвать до её строки, а функцию-выражение — нет. `var g = function () {}` поднимает только переменную `g` со значением `undefined`, и ранний вызов даёт `TypeError: g is not a function`.

Если имя объявлено и как `var`, и как функция, при инстанцировании побеждает функция: `var` не перезаписывает уже созданную привязку. Значение меняет только присваивание, когда до него дойдёт выполнение:

```js
console.log(typeof a); // 'function' — instantiation created a = function
var a = 1;
function a() {}
console.log(typeof a); // 'number' — the assignment ran
```

> [!NOTE]
> Слово hoisting в спецификации не встречается. Это неформальное название наблюдаемого эффекта: привязки создаются до выполнения кода. Модель «объявление переносится наверх» объясняет `var` и функции, но не объясняет TDZ. Модель «привязка создаётся заранее, инициализируется позже» объясняет всё.

### Temporal dead zone

`let`, `const` и `class` тоже «поднимаются»: привязка создаётся при входе в блок. Но она остаётся **неинициализированной**, пока выполнение не дойдёт до объявления. Любое обращение к ней — чтение, запись, `typeof` — бросает `ReferenceError: Cannot access 'x' before initialization`.

TDZ зависит от **времени**, а не от положения в тексте. Функция может ссылаться на переменную, объявленную ниже, если вызвать её после инициализации:

```js
function read() { return value; } // fine: no access yet
// read();                        // ReferenceError — still in TDZ
let value = 42;
read();                           // 42
```

Подъём `let` виден по затенению (shadowing): внутренняя привязка закрывает внешнюю с самого начала блока, а не со строки объявления.

```js
let x = 'outer';
{
  console.log(x); // ReferenceError, not 'outer': inner x already exists
  let x = 'inner';
}
```

Зачем TDZ:

- у `const` не может быть двух значений: «сначала `undefined`, потом настоящее»;
- обращение до инициализации почти всегда ошибка, и лучше упасть сразу;
- классы ведут себя как `let`: выражение `extends` и вычисляемые имена методов вычисляются в момент объявления, и раннее обращение к классу было бы бессмысленным.

> [!WARNING]
> Из TDZ следует, что `typeof` больше не «безопасен всегда». `typeof undeclared` даёт `"undefined"`, а `typeof x` до `let x` в той же области бросает `ReferenceError`.

`const` запрещает переприсвоить **привязку**, а не менять значение: `const o = {}; o.a = 1` работает. Неизменяемость объекта — это `Object.freeze`, а не `const`.

### Глобальная область

Глобальная запись окружения состоит из двух частей:

- **объектная** — поверх глобального объекта (`window`, `globalThis`). Сюда попадают `var` и объявления функций верхнего уровня скрипта, а также встроенные `Array`, `Math` и прочие;
- **декларативная** — для `let`, `const`, `class` верхнего уровня. Это не свойства глобального объекта: после `var a = 1; let b = 2` значение `globalThis.a` равно `1`, а `globalThis.b` — `undefined`.

Следствия:

- `let`/`const` верхнего уровня видны во **всех** классических скриптах страницы, хотя на `window` их нет;
- объявить `let x` в одном скрипте и `let x` или `var x` в другом — `SyntaxError`. Скрипт с конфликтом не выполняется целиком: проверка идёт в `GlobalDeclarationInstantiation` до первой строки;
- глобальный `let` может затенить свойство глобального объекта, созданное присваиванием (`globalThis.p = 1; let p = 2`), но не свойство, созданное через `var`: оно неконфигурируемое;

В **ES-модуле** верхний уровень — своя модульная область. `var` в модуле не попадает на `window`, а модули не видят объявления друг друга без `import`. Модули всегда в strict mode.

### Блоки и циклы

Каждый блок с лексическими объявлениями получает свою запись окружения. Самое важное следствие — циклы.

В `for (let i = 0; …; i++)` спецификация создаёт **новую запись окружения на каждую итерацию** (`CreatePerIterationEnvironment`). Значение переменной копируется в неё из предыдущей итерации, и инкремент выполняется уже в новой записи. Колбэк, созданный в теле, замыкает «свою» `i`:

```js
const fns = [];
for (var i = 0; i < 3; i++) fns.push(() => i);
fns.map((f) => f()); // [3, 3, 3] — one binding for the whole function

const gns = [];
for (let j = 0; j < 3; j++) gns.push(() => j);
gns.map((g) => g()); // [0, 1, 2] — a fresh binding per iteration
```

`for…in` и `for…of` тоже создают новую привязку на каждой итерации, поэтому там допустим `const`. В классическом `for (const i = 0; i < n; i++)` второй проход падает с `TypeError` на `i++`.

`switch` — один блок на все `case`. `let` из одного `case` виден в другом, но там он в TDZ. Поэтому тело `case` с объявлениями оборачивают в `{ }`.

`catch (err)` создаёт блочную привязку `err`, а `var` внутри `catch` уходит в функцию: `try { … } catch (e) { var leaked = e }` оставляет `leaked` снаружи.

> [!NOTE]
> `using` и `await using` из Explicit Resource Management объявляют блочные переменные с TDZ, как `const`. При выходе из блока у значения вызывается `[Symbol.dispose]()`. Предложение завершено (stage 4) и войдёт в ECMAScript 2027; уже есть в текущем черновике спецификации.

### Параметры функции

Если у параметров нет значений по умолчанию, параметры и `var` тела живут в одной записи окружения. `var a` с именем параметра — та же привязка, и `function f(a) { var a; return a }` вернёт аргумент.

Если значения по умолчанию есть (или деструктуризация с выражениями), параметры получают **отдельную запись окружения**, а тело — свою, вложенную в неё. Параметры инициализируются слева направо и имеют свою TDZ:

```js
function f(a = b, b = 1) {} // f() → ReferenceError: b is in TDZ while a is computed
function g(a = 1, b = a) {} // fine

var x = 'outer';
function h(read = () => x) {
  var x = 'inner';
  return read(); // 'outer' — the default sees the parameter scope, not the body
}
```

### Объявления функций в блоках

В strict mode (модули, классы, `'use strict'`) функция, объявленная в блоке, видна только в этом блоке и поднимается в его пределах.

В sloppy mode браузеры сохраняют старое поведение. Оно описано в приложении спецификации Annex B.3.2 (Normative Optional, обязательно для веб-хостов). Кроме блочной привязки создаётся `var`-привязка в функции или скрипте. До входа в блок она равна `undefined`. Когда выполнение доходит до строки объявления, текущее значение блочной привязки копируется в неё.

```js
// sloppy script
console.log(typeof foo); // 'undefined' — var-like binding exists, not yet assigned
if (true) {
  function foo() {}
}
console.log(typeof foo); // 'function' — copied when the declaration was evaluated
```

> [!WARNING]
> Не объявляйте функции в блоках sloppy-кода: поведение зависит от режима и неочевидно. Если блок не выполнился (`if (false) { function bar() {} }`), `bar` существует, но равен `undefined`. Внутри блока используйте `const bar = () => {}`.

### `eval` и `with`: динамическая область видимости

Лексическую модель ломают две конструкции, и обе ограничены в strict mode.

- **Прямой `eval`** в sloppy mode выполняет код в текущей области. `var` из строки становится переменной вызывающей функции: `eval('var v = 1')` добавляет `v`. В strict mode у `eval` своя область. Косвенный вызов `(0, eval)(code)` выполняет код в глобальной области.
- **`with (obj)`** вставляет объект в цепочку областей: любое имя внутри может оказаться свойством `obj`, и это определяется только во время выполнения. В strict mode `with` — `SyntaxError`.

Обе конструкции мешают движку заранее знать, к какой привязке относится имя.

> [!WARNING]
> Детали реализации, не спецификация. V8 анализирует области видимости при парсинге. Переменные, которые не захватывает ни одна вложенная функция, живут в регистрах или на стеке. Захваченные переносятся в объект `Context` в куче. Прямой `eval` или `with` заставляет считать захваченными все переменные вокруг, потому что строка может обратиться к любой. Проверки TDZ движок убирает там, где доказано, что инициализация уже прошла.

### Vue: области видимости в `<script setup>` и в шаблоне

Компилятор SFC превращает `<script setup>` в тело функции `setup()`. Поэтому все переменные и функции верхнего уровня становятся **локальными переменными этой функции**. В production-сборке render-функция шаблона создаётся прямо внутри `setup()` и обращается к ним как замыкание. В dev-режиме они передаются шаблону через объект, который возвращает `setup()`. Отсюда два следствия:

- код `<script setup>` выполняется заново для каждого экземпляра компонента, и каждый экземпляр получает свои `ref`. Состояние, объявленное в обычном `<script>` или на уровне модуля, — одно на все экземпляры (и на все запросы при SSR);
- `let` и `const` подчиняются TDZ и здесь: обращение к `ref`, объявленному ниже, в коде `setup` (не в шаблоне и не в колбэке) падает.

Выражения шаблона выполняются в «песочнице». Им доступны свойства компонента и ограниченный список глобальных имён: `Math`, `Date`, `JSON`, `console`, `Intl` и некоторые другие. `window`, `document` и произвольные глобальные переменные из шаблона не видны. Добавить своё можно через `app.config.globalProperties`.

## Примеры

### Что именно поднимается

```js
console.log(v);          // undefined — var initialized at instantiation
console.log(declared()); // 'ok' — function object created at instantiation
console.log(typeof expr); // 'undefined' — only the var is hoisted
// console.log(l);       // ReferenceError — let is in TDZ
// new C();              // ReferenceError — class is in TDZ

var v = 1;
function declared() { return 'ok'; }
var expr = function () {};
let l = 2;
class C {}
```

## Вопросы с интервью

::: details Что такое область видимости и какие области бывают в JavaScript?
Область видимости — часть программы, в которой имя ссылается на определённую привязку. В JavaScript она лексическая (статическая): цепочку областей задаёт вложенность кода, а не стек вызовов. Функция запоминает окружение, где её создали, и ищет свободные переменные там.

Виды: глобальная (одна на realm, общая для классических скриптов), модульная (у каждого ES-модуля), функциональная (у каждого вызова), блочная (`{}`, циклы, `switch`, `catch`). Особые случаи: отдельная область имени у именованного функционального выражения и у класса, отдельная область параметров со значениями по умолчанию. `with` и прямой `eval` в sloppy mode меняют области во время выполнения.

В спецификации каждая область — Environment Record со ссылкой на внешнюю. Поиск имени идёт по этой цепочке до глобальной записи.
:::

::: details Что такое hoisting на самом деле?
Код не переносится. Перед выполнением функции, скрипта, модуля или блока движок проходит по объявлениям и создаёт привязки — это declaration instantiation. Поэтому имена существуют ещё до своей строки. Разница — в начальном состоянии: `var` получает `undefined`, объявление функции — готовую функцию, `let`/`const`/`class` создаются неинициализированными и до своей строки находятся в TDZ.

Следствия: функцию-объявление можно вызвать выше её строки, функцию-выражение — нет (поднимается только переменная); `var` и функция с одним именем — функция побеждает при инстанцировании, а присваивание в `var` перезаписывает её позже. Все объявления блока известны заранее, поэтому `let x` затеняет внешний `x` с самого начала блока.
:::

::: details Чем отличаются var, let и const?
- **Область:** `var` — функция или скрипт, `let`/`const` — блок.
- **До объявления:** `var` — `undefined`; `let`/`const` — `ReferenceError` (TDZ).
- **Повторное объявление:** `var` — можно; `let`/`const` — `SyntaxError`, в том числе в паре с `var`.
- **Глобальный уровень:** `var` становится неконфигурируемым свойством `window`, `let`/`const` — нет, хотя видны во всех скриптах.
- **Циклы:** `let` в `for` даёт новую привязку на каждую итерацию, `var` — одну на всю функцию.
- **`const`:** обязателен инициализатор, привязку нельзя переприсвоить. Значение остаётся изменяемым: объект под `const` можно мутировать.

Правило для кода: `const` по умолчанию, `let`, когда нужно переприсваивание, `var` — не использовать.
:::

::: details Что такое temporal dead zone и зачем она нужна?
TDZ — время от входа в область до выполнения объявления `let`/`const`/`class`. Привязка уже существует (поэтому она затеняет внешнюю), но не инициализирована, и любое обращение, включая `typeof`, бросает `ReferenceError`.

Зона «временная», а не «пространственная»: функция, объявленная выше `let x`, может читать `x`, если её вызовут после инициализации. Ошибка будет, только если вызвать её раньше.

Зачем: у `const` должно быть ровно одно значение, без промежуточного `undefined`. Обращение до инициализации почти всегда ошибка, и лучше упасть сразу, чем молча получить `undefined`, как с `var`. Параметры со значениями по умолчанию тоже имеют TDZ: `function f(a = b, b) {}` падает при вызове `f()`.
:::

::: details Почему колбэки в цикле с var видят последнее значение и как let это исправляет?
У `var i` одна привязка на всю функцию. Колбэки, созданные в цикле, замыкают одну и ту же переменную, и к моменту их вызова цикл уже закончился: `i === 3`, все выведут `3`.

С `let` в заголовке `for` спецификация создаёт новую запись окружения на каждую итерацию (`CreatePerIterationEnvironment`). Текущее значение копируется в неё, и инкремент выполняется уже в новой записи. Каждый колбэк замыкает свою копию.

До ES2015 это решали IIFE (`(function (j) { … })(i)`), третьим аргументом `setTimeout` или `forEach`: каждый вызов функции — новая область. Транспиляторы так и переписывают `let` в циклах — выносят тело в функцию и передают ей текущее значение.
:::

::: details Как видны функции, объявленные внутри блока?
В strict mode (модули, классы, `'use strict'`) — только внутри блока, с подъёмом в его пределах.

В sloppy mode действует приложение спецификации Annex B.3.2 для веб-совместимости. Кроме блочной привязки создаётся `var`-подобная привязка во внешней функции или скрипте. До выполнения блока она `undefined`. В момент, когда выполнение доходит до объявления, в неё копируется значение блочной привязки. Если блок не выполнился, снаружи будет `undefined`. Если имя конфликтует с `let` во внешней области, внешняя привязка не создаётся.

Вывод для кода: в блоках используйте функциональные выражения через `const`. На интервью важно знать, что поведение зависит от режима.
:::

::: details Чем глобальный let отличается от глобального var?
Глобальная запись окружения двухслойная. `var` и объявления функций верхнего уровня скрипта становятся свойствами глобального объекта (`window.a`), причём неконфигурируемыми: `delete` их не удалит. `let`/`const`/`class` попадают в отдельную декларативную запись. На `window` их нет, но они видны всем классическим скриптам страницы.

Конфликт имён между скриптами (`let x` в одном, `let x` или `var x` в другом) — `SyntaxError`, и второй скрипт не выполняется целиком. Проверка проходит до первой строки.

В ES-модуле верхний уровень — своя область: ни `var`, ни `let` не попадают на `window` и не видны другим модулям без `import`.
:::

## Задачи

### 1. Предскажите вывод · легко

```js
console.log(a);
console.log(typeof b);
console.log(typeof c);
console.log(d());

var a = 1;
var b = function () {};
let c = 2;
function d() { return e; }
var e = 'e';
```

::: details Решение и разбор
```js
undefined   // var a exists, assigned later
'undefined' // var b exists, still undefined; typeof does not call it
ReferenceError: Cannot access 'c' before initialization
```

Выполнение останавливается на третьей строке: `typeof` не спасает от TDZ. Если её убрать, четвёртая строка выведет `undefined`. Функция `d` готова с начала скрипта, а `e` ещё не присвоена.
:::

### 2. Цикл с таймерами · легко

Код выводит `3 3 3`. Исправьте так, чтобы выводилось `0 1 2`, тремя разными способами.

```js
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);
}
```

::: details Решение и разбор
```js
// 1. Per-iteration binding
for (let i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);
}

// 2. A new function scope per iteration (pre-ES2015 idiom)
for (var i = 0; i < 3; i++) {
  (function (j) {
    setTimeout(() => console.log(j), 0);
  })(i);
}

// 3. Pass the current value as an argument, no closure over i
for (var i = 0; i < 3; i++) {
  setTimeout(console.log, 0, i);
}
```

Все колбэки выполняются после завершения цикла (это макрозадачи). С `var` они читают одну переменную, к этому моменту равную `3`. Способы 1 и 2 дают каждому колбэку свою привязку. Способ 3 вообще не замыкает `i`: значение копируется в аргумент в момент вызова `setTimeout`. Так же работает `[0, 1, 2].forEach((i) => …)`.

Сложность: O(n).
:::

### 3. Имена, которые спорят · средне

Предскажите вывод каждого фрагмента.

```js
// A
function a() {
  return typeof x;
  var x = 1;
  function x() {}
}
console.log(a());

// B
var x = 'global';
function b() {
  console.log(x);
  if (false) { var x = 'local'; }
}
b();

// C
const sum = function add(n) {
  add = null;
  return n > 0 ? n + add(n - 1) : 0;
};
console.log(sum(3));

// D
let y = 'outer';
function d(cb = () => y) {
  let y = 'inner';
  return cb();
}
console.log(d());
```

::: details Решение и разбор
```js
// A: 'function' — the function declaration wins at instantiation; var x = 1 never runs
// B: undefined   — var x is hoisted to b's scope even from a dead branch
// C: 6           — `add = null` is silently ignored: add is an immutable binding
// D: 'outer'     — the default runs in the parameter scope, which cannot see the body
```

- **A.** При инстанцировании `x` получает функцию. `var x` не перезаписывает существующую привязку, а до присваивания `x = 1` выполнение не доходит из-за `return`.
- **B.** Инстанцирование собирает объявления статически и не смотрит, выполнится ли ветка. Локальная `x` затеняет глобальную и равна `undefined`.
- **C.** Имя именованного функционального выражения — неизменяемая привязка во внутренней области. В sloppy mode присваивание игнорируется, в strict mode (модуль, класс) — `TypeError: Assignment to constant variable`.
- **D.** Параметры со значениями по умолчанию получают отдельную область. `cb` создаётся в ней, тело — вложенная область, которую `cb` не видит. Если бы в теле был `var y`, а не `let y`, ответ был бы тем же.
:::

### 4. Перепишите `let` в цикле без `let` · сложно

Перепишите код на ES5 (только `var` и функции) так, чтобы `fns.map((f) => f())` возвращал то же, что и оригинал. Объясните, что вернёт оригинал.

```js
const fns = [];
for (let i = 0; i < 3; i++) {
  fns.push(() => i);
  if (i === 0) i++;
}
```

::: details Решение и разбор
Оригинал вернёт `[1, 2]`. Итерация 1: `i = 0`, колбэк замыкает запись итерации, тело увеличивает `i` до `1`. Затем `CreatePerIterationEnvironment` копирует `1` в новую запись, и инкремент меняет уже её: `2`. Колбэк первой итерации видит `1`. Итерация 2: `i = 2`, колбэк видит `2`. Дальше `3`, цикл заканчивается.

```js
var fns = [];

function loopBody(i) {
  // `i` is this iteration's own binding
  fns.push(function () { return i; });
  if (i === 0) i++;
  return i; // copy the value back, as CreatePerIterationEnvironment does
}

for (var i = 0; i < 3; i++) {
  i = loopBody(i);
}

fns.map(function (f) { return f(); }); // [1, 2]
```

Ключевые детали:
- Каждый вызов `loopBody` создаёт новую функциональную область — аналог записи окружения итерации.
- Изменение `i` в теле должно попасть в следующую итерацию, поэтому значение возвращается и присваивается внешней `i`. Без этого шага получилось бы `[1, 1, 2]`: вариант «IIFE из учебника» ломается именно на мутации.
- Инкремент выполняется над внешней `i` уже после копирования, поэтому не виден колбэку прошлой итерации. Так и в спецификации.

Babel генерирует похожую функцию `_loop` и обрабатывает `break`, `continue` и `return` из тела через возвращаемые маркеры.

Сложность: O(n) по времени и памяти (n замыканий).
:::

## Источники

- [ECMAScript: Environment Records](https://tc39.es/ecma262/#sec-environment-records), [Declarative](https://tc39.es/ecma262/#sec-declarative-environment-records), [Object](https://tc39.es/ecma262/#sec-object-environment-records), [Global](https://tc39.es/ecma262/#sec-global-environment-records) и [Module Environment Records](https://tc39.es/ecma262/#sec-module-environment-records)
- [ECMAScript: Execution Contexts](https://tc39.es/ecma262/#sec-execution-contexts), [ResolveBinding](https://tc39.es/ecma262/#sec-resolvebinding), [GetIdentifierReference](https://tc39.es/ecma262/#sec-getidentifierreference)
- [ECMAScript: FunctionDeclarationInstantiation](https://tc39.es/ecma262/#sec-functiondeclarationinstantiation), [GlobalDeclarationInstantiation](https://tc39.es/ecma262/#sec-globaldeclarationinstantiation), [BlockDeclarationInstantiation](https://tc39.es/ecma262/#sec-blockdeclarationinstantiation)
- [ECMAScript: Let, Const, Using, and Await Using Declarations](https://tc39.es/ecma262/#sec-let-and-const-declarations), [Variable Statement](https://tc39.es/ecma262/#sec-variable-statement)
- [ECMAScript: CreatePerIterationEnvironment](https://tc39.es/ecma262/#sec-createperiterationenvironment)
- [ECMAScript: InstantiateOrdinaryFunctionExpression](https://tc39.es/ecma262/#sec-runtime-semantics-instantiateordinaryfunctionexpression)
- [ECMAScript: Block-Level Function Declarations Web Legacy Compatibility Semantics](https://tc39.es/ecma262/#sec-block-level-function-declarations-web-legacy-compatibility-semantics)
- [ECMAScript: The with Statement](https://tc39.es/ecma262/#sec-with-statement), [EvalDeclarationInstantiation](https://tc39.es/ecma262/#sec-evaldeclarationinstantiation)
- [TC39: Finished Proposals (Explicit Resource Management)](https://github.com/tc39/proposals/blob/main/finished-proposals.md)
- [MDN: Scope](https://developer.mozilla.org/en-US/docs/Glossary/Scope)
- [MDN: Hoisting](https://developer.mozilla.org/en-US/docs/Glossary/Hoisting)
- [MDN: var](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/var), [let — Temporal dead zone](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/let#temporal_dead_zone_tdz), [const](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/const), [using](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/using)
- [MDN: function — Block-level function declaration](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function#block-level_function_declaration)
- [MDN: eval — Direct and indirect eval](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval#direct_and_indirect_eval), [with](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/with), [Strict mode](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Strict_mode)
- [MDN: Closures — Lexical scoping](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures#lexical_scoping)
- [Vue: `<script setup>`](https://vuejs.org/api/sfc-script-setup.html)
- [Vue: Template Syntax — Restricted Globals Access](https://vuejs.org/guide/essentials/template-syntax.html#restricted-globals-access) и [`globalsAllowList.ts`](https://github.com/vuejs/core/blob/main/packages/shared/src/globalsAllowList.ts)
