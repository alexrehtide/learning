---
title: Деструктуризация, spread/rest и современный синтаксис
level: ядро
---

# Деструктуризация, spread/rest и современный синтаксис

> **Коротко.** Деструктуризация — шаблон, который раскладывает значение по переменным: объектный шаблон читает свойства, массивный — проходит по протоколу итерации. Значение по умолчанию срабатывает только на `undefined`. Многоточие означает spread там, где значения создаются, и rest там, где они собираются; оба копируют поверхностно. `?.` обрывает всю цепочку на `null`/`undefined`, `??` подставляет значение только для них, а `??=`, `||=` и `&&=` не выполняют запись, если она не нужна. Во Vue деструктуризация копирует значение и рвёт реактивность — кроме props в `<script setup>`, где компилятор переписывает обращения.

**Связанные темы:** [Типы данных и приведение типов](./types-and-coercion.md), [Область видимости и hoisting](./scope-and-hoisting.md), [Функции и `this`](./functions-and-this.md), [Дескрипторы свойств, `Proxy` и `Reflect`](./property-descriptors-and-proxy.md), [Итераторы и генераторы](./iterators-and-generators.md), [Функциональные приёмы и иммутабельность](./functional-programming.md), [deepClone, deepEqual, get/set по пути](../live-coding/object-utilities.md)

## Теория

### Шаблон, а не выражение

Слева от `=` в `const { a } = obj` стоит не литерал объекта, а **шаблон** (pattern). Спецификация различает два вида:

- **binding pattern** — в объявлениях (`const`, `let`, `var`), параметрах и `catch (…)`. Создаёт новые привязки, в листьях — только идентификаторы;
- **assignment pattern** — в обычном присваивании. В листьях может стоять любая ссылка: `({ x: obj.p, y: arr[0] } = source)`. Инструкция, начинающаяся с `{`, парсится как блок, поэтому присваивание объектным шаблоном берут в скобки.

Шаблоны вкладываются, а в каждом листе может быть значение по умолчанию.

### Деструктуризация объекта

Объектный шаблон — это серия чтений `[[Get]]` по ключам:

```js
const { id, name: title, [key]: value, meta: { tags = [] } = {}, ...rest } = source;
```

- `name: title` — читается `name`, привязывается `title`. Слева от двоеточия ключ, справа — цель;
- ключ можно вычислить: `[key]`. Порядок вычисления — слева направо, ключ вычисляется перед чтением, значение по умолчанию — после;
- источник сначала проверяется `RequireObjectCoercible`: `null` и `undefined` дают `TypeError` даже для пустого шаблона `const {} = null`. Примитивы оборачиваются в объект: `const { length } = 'abc'` даёт `3`, `const { toFixed } = 1` достаёт метод из `Number.prototype`;
- читаются в том числе унаследованные свойства и геттеры: шаблон — это просто `obj.key`.

**Значение по умолчанию** срабатывает, только если прочитано ровно `undefined`. `null`, `0`, `''` и `false` проходят как есть. Выражение по умолчанию вычисляется лениво: функция в нём не вызывается, если значение пришло.

**Rest-свойство** `...rest` собирает в новый обычный объект собственные перечисляемые свойства, включая символьные, кроме уже названных в шаблоне (`CopyDataProperties` с исключёнными ключами). Прототип у результата — `Object.prototype`, геттеры источника вызываются и превращаются в data-свойства, неперечисляемые и унаследованные свойства теряются. Rest должен быть последним, и в нём нельзя вложить шаблон.

### Деструктуризация массива — это протокол итерации

Массивный шаблон не читает индексы. Он берёт у источника итератор (`GetIterator`) и вызывает `next()` по одному разу на элемент шаблона. Отсюда следствия:

- работает с любым итерируемым: строками (по кодовым точкам), `Map`, `Set`, генераторами. Объект без `Symbol.iterator` — `TypeError: {} is not iterable`, даже если у него есть `length` и индексы;
- пропуски `[a, , b]` тоже вызывают `next()`;
- если шаблон кончился раньше итератора или вычисление бросило исключение, вызывается `IteratorClose`, то есть `iterator.return()`. У генератора при этом выполняется `finally`. Rest-элемент выбирает итератор до конца, и закрывать уже нечего (см. задачу 5);
- обмен значениями `[a, b] = [b, a]` создаёт временный массив и итератор. Это читаемо, но не бесплатно на горячем цикле.

Подробно протокол — в теме [Итераторы и генераторы](./iterators-and-generators.md).

### Параметры функции

Параметр — тоже binding pattern, поэтому объект опций разбирают прямо в сигнатуре:

```js
function request(url, { method = 'GET', headers = {}, retry: { count = 3 } = {} } = {}) {}
```

Внешний `= {}` нужен, чтобы вызов без второго аргумента не упал на `RequireObjectCoercible`. Вложенный `= {}` защищает от отсутствующего `retry`. От `null` не спасает ни то ни другое (задача 2).

Параметры со значениями по умолчанию или шаблонами получают отдельную запись окружения со своей TDZ ([«Область видимости и hoisting»](./scope-and-hoisting.md)), делают `arguments` unmapped и обрывают подсчёт `length` ([«Функции и `this`»](./functions-and-this.md)).

### Многоточие: spread и rest

Одни и те же три точки означают противоположное в зависимости от позиции:

| Позиция | Что это | Как работает |
| --- | --- | --- |
| аргументы вызова `f(...xs)` | spread | итератор, каждый элемент — отдельный аргумент |
| литерал массива `[...xs]` | spread | итератор; `null`/`undefined` — `TypeError` |
| литерал объекта `{ ...o }` | spread | `CopyDataProperties`; `null`/`undefined` молча пропускаются |
| параметры `function f(...args)` | rest | настоящий массив оставшихся аргументов, только последним |
| шаблон массива `[a, ...tail]` | rest | дочитывает итератор до конца |
| шаблон объекта `{ a, ...others }` | rest | собственные перечисляемые свойства, кроме названных |

Spread объекта **определяет** свойства (`CreateDataProperty`), а `Object.assign` **присваивает** их через `[[Set]]`. Поэтому spread не вызывает сеттеры и не трогает прототип даже на ключе `__proto__`, а `Object.assign` вызывает. Подробнее — в [«Дескрипторах свойств»](./property-descriptors-and-proxy.md#кто-какие-ключи-видит-и-в-каком-порядке). Позднее свойство перекрывает раннее, поэтому порядок задаёт приоритет: `{ ...defaults, ...options }` — опции побеждают, `{ ...options, id }` — `id` нельзя переопределить снаружи. Spread примитива даёт его собственные перечисляемые свойства: `{ ...'hi' }` — `{ 0: 'h', 1: 'i' }`, `{ ...5 }` — `{}`. На этом построен условный spread `{ ...(isAdmin && { role: 'admin' }) }`: `false` ничего не добавляет.

Любая spread-копия **поверхностная**: вложенные объекты общие у копии и оригинала. Глубокое копирование и `structuredClone` — тема [«Функциональные приёмы и иммутабельность»](./functional-programming.md#копирование-поверхностное-и-глубокое).

> [!WARNING]
> Spread в аргументы кладёт каждый элемент на стек вызова. В V8 это упирается в размер стека: в Node 26 `Math.max(...arr)` бросает `RangeError: Maximum call stack size exceeded` примерно со 125 тысяч элементов. Спецификация лимита не задаёт, он зависит от движка и размера стека. Для больших массивов — цикл или `reduce`, для `push` — по частям.

### Optional chaining: `?.`

`a?.b`, `a?.[k]` и `f?.()` проверяют, что значение **слева** не `null` и не `undefined`. Если проверка не прошла, вычисление всей оставшейся цепочки отменяется и результат — `undefined`:

- **короткое замыкание на всю цепочку.** `user.profile?.city.toUpperCase()` при `profile === null` не дойдёт до `.city`. Аргументы не вычисляются: в `o?.a.b(n++)` при `o == null` счётчик не меняется;
- **скобки обрывают цепочку.** `(o?.a).b` при `o == null` — `TypeError`: скобки превращают `undefined` в значение, к которому применяется `.b`;
- **`f?.()` проверяет только `null`/`undefined`.** Если `f` — число, будет `TypeError: f is not a function`;
- **`this` сохраняется**: `obj?.method()` и даже `(obj?.method)()` вызываются с `this === obj` ([«Функции и `this`»](./functions-and-this.md));
- **запрещено**: присваивание `a?.b = 1`, `new a?.()`, шаблон-тег `` a?.b`x` `` и `super?.()` — `SyntaxError`. `delete a?.b` разрешён и возвращает `true` при `a == null`.

`?.` — не замена проверке. Цепочка `a?.b?.c?.d` на обязательных данных прячет ошибку, которая должна была упасть громко. Ставьте `?.` там, где `null` — законное состояние.

### `??` и логическое присваивание

`a ?? b` возвращает `b`, только если `a` — `null` или `undefined`. `||` подставляет значение для любого falsy (`0`, `''`, `NaN`, `false`), из-за чего `timeout || 5000` превращает осознанный `0` в `5000`. Тот же критерий «пустоты», что и у `?.`, — `x == null` ([«Типы данных»](./types-and-coercion.md)).

`??` нельзя смешивать с `||` и `&&` без скобок: `a || b ?? c` — `SyntaxError`. Приоритеты смешанных операторов в грамматике не определены намеренно, чтобы не гадать.

Логическое присваивание (ES2021) — это короткое замыкание, а не сахар над `a = a ?? b`:

| Запись | Эквивалент |
| --- | --- |
| `a ??= b` | `a ?? (a = b)` |
| `a \|\|= b` | `a \|\| (a = b)` |
| `a &&= b` | `a && (a = b)` |

Если левая часть уже «достаточна», **присваивания нет**: сеттер не вызывается, ловушка `set` у `Proxy` не срабатывает, и `b` не вычисляется. Для обычной переменной разницы почти нет. Для свойства с сеттером, реактивного объекта или `const` разница видна: `const x = 1; x ||= 2` не бросит `TypeError`, потому что записи не будет.

### Шаблонные строки и теги

Подстановка `${v}` приводит значение через `ToString`, то есть со строковым хинтом. `` `${o}` `` вызывает `o.toString()`, а `'' + o` — `valueOf()` (хинт `default`). Символ в подстановке — `TypeError`, хотя `String(sym)` работает.

**Тегированный шаблон** `` tag`a${x}b` `` — вызов функции `tag(strings, ...values)`:

- `strings` — массив «приготовленных» строк с полем `raw`, где лежат исходные, без обработки escape-последовательностей. Оба массива заморожены;
- объект `strings` создаётся **один раз на место в коде** (`GetTemplateObject` кэширует его по узлу разбора) и при каждом вызове этой строки кода приходит тот же. Два одинаковых шаблона в разных местах дают разные объекты. На этой идентичности строят кэш разобранного шаблона в `WeakMap` (так делает lit-html);
- в тегированном шаблоне некорректные escape-последовательности (`\unicode`, `\xyz`) разрешены: приготовленная строка становится `undefined`, `raw` сохраняется. В обычном шаблоне это `SyntaxError`;
- `String.raw` — встроенный тег, который склеивает `raw`: `` String.raw`C:\new` `` — строка с обратным слешем, а не с переводом строки.

Теги нужны для встроенных языков: `css`, `html`, `gql`, `sql`, i18n. Суть в том, что тег отделяет статические части, написанные программистом, от подставленных значений и может экранировать только вторые (задача 4).

### Мелочи, которые спрашивают

- **Сокращённые свойства и методы**: `{ id, load() {} }`. Метод-сокращение получает `[[HomeObject]]` и может вызывать `super.method()` ([«Прототипы и классы»](./prototypes-and-classes.md)); `load: function () {}` — нет.
- **Вычисляемые ключи**: ``{ [`on${name}`]: handler }``. Ключ приводится к строке или символу в момент создания.
- **`**`**: правоассоциативный, `2 ** 3 ** 2` — `512`. Унарный минус перед основанием запрещён: `-2 ** 2` — `SyntaxError`, пишут `(-2) ** 2` или `-(2 ** 2)`.
- **Разделители разрядов** `1_000_000` — только в литералах. `Number('1_000')` и `parseInt` их не понимают.
- **Висячие запятые** разрешены в литералах, параметрах и вызовах, но не после rest: `function f(...a,) {}` — `SyntaxError`.
- **`catch` без параметра** (ES2019): `try { … } catch { … }`.

### Vue: деструктуризация и реактивность

Реактивность Vue перехватывает чтение свойства у прокси ([«Дескрипторы свойств, `Proxy` и `Reflect`»](./property-descriptors-and-proxy.md#vue-от-defineproperty-к-proxy)). Деструктуризация и spread читают свойство один раз и кладут значение в переменную или в новый объект, поэтому связь с источником теряется:

- `const { count } = reactive(state)` — `count` больше не обновится. Решение — `toRefs(state)` или `toRef(state, 'count')`: каждый ref читает `state.count` при обращении к `.value`;
- `{ ...state }` — обычный объект-снимок верхнего уровня. Вложенные объекты в нём остаются реактивными прокси: при чтении через `reactive` Vue вернул обёртку (проверено на Vue 3.5.45);
- store Pinia — тоже `reactive`, поэтому state и getters достают через `storeToRefs(store)`, а actions можно деструктурировать напрямую;
- `??=` и `||=` на реактивном свойстве не вызывают `trigger`, если записи не было. Обычно это то, что нужно.

Исключение — **деструктуризация props** в `<script setup>` (стабильна с Vue 3.5). `const { count = 0 } = defineProps<{ count?: number }>()` остаётся реактивной, потому что это не деструктуризация в рантайме. Компилятор удаляет её и переписывает каждое обращение к `count` в `__props.count`, а значение по умолчанию переносит в опции props через `mergeDefaults`. Отсюда ограничение: `watch(count, …)` передал бы в `watch` число. Компилятор ловит это и падает с ошибкой «"count" is a destructured prop and should not be passed directly to watch(). Pass a getter () => count instead». В composable тоже передают геттер `() => count` и нормализуют его через `toValue`.

## Примеры

### Опции с умолчаниями и белый список полей

```js
const DEFAULTS = { page: 1, perPage: 20, sort: 'createdAt' };

function buildQuery(input = {}) {
  // Defaults first, user input wins; null from a form still means "use default".
  const { page, perPage, sort, ...unknown } = { ...DEFAULTS, ...input };
  if (Object.keys(unknown).length) console.warn('Unknown params:', Object.keys(unknown));
  return {
    page: page ?? DEFAULTS.page,
    perPage: Math.min(perPage ?? DEFAULTS.perPage, 100),
    sort,
  };
}

buildQuery({ perPage: 500, debug: true }); // warns about debug; { page: 1, perPage: 100, sort: 'createdAt' }
```

### Иммутабельное обновление и безопасное чтение

```js
const state = { user: { id: 1, settings: { theme: 'dark' } }, items: [] };

const next = {
  ...state,
  user: { ...state.user, settings: { ...state.user.settings, theme: 'light' } },
  ...(state.items.length === 0 && { empty: true }), // conditional spread
};

next.user !== state.user;           // true: the changed branch is copied
next.items === state.items;         // true: untouched branches are shared

const theme = next.user?.settings?.theme ?? 'system';
const { user: { id: userId } } = next;   // userId === 1
```

## Вопросы с интервью

::: details Когда срабатывает значение по умолчанию при деструктуризации и почему null его не включает?
Значение по умолчанию подставляется, только если прочитано ровно `undefined`: отсутствующее свойство, пропущенный аргумент или явный `undefined`. `null` — осмысленное значение «пусто», его спецификация не трогает, как и `0`, `''`, `false`. Выражение по умолчанию вычисляется лениво и только при необходимости. Отдельная ловушка — сама деструктуризация `null`: `const { a } = null` бросает `TypeError`, и `= {}` в параметре от этого не спасает, потому что тоже срабатывает только на `undefined`. Если `null` должен означать «по умолчанию», нормализуют через `??`.
:::

::: details Чем деструктуризация массива отличается от деструктуризации объекта?
Объектный шаблон делает серию чтений свойств: он работает с любым значением, кроме `null` и `undefined` (примитивы оборачиваются), и видит унаследованные свойства и геттеры. Массивный шаблон использует протокол итерации: берёт итератор и вызывает `next()` на каждый элемент шаблона, включая пропуски. Поэтому он работает со строками, `Map`, `Set`, генераторами, но падает на объекте с `length` без `Symbol.iterator`. Если шаблон закончился раньше итератора или выражение бросило ошибку, вызывается `iterator.return()`, и у генератора выполняется `finally`. Если нужен доступ по индексу без итерации, можно написать объектный шаблон по массиву: `const { 0: first, length } = arr`.
:::

::: details Чем spread отличается от rest и что именно копирует spread объекта?
Spread раскладывает значения там, где они создаются: в аргументах вызова, литерале массива и литерале объекта. Rest собирает остаток там, где значения принимаются: в параметрах и шаблонах. Spread массива и аргументов идёт по итератору и падает на `null`. Spread объекта копирует собственные перечисляемые свойства, включая символы, а `null` и `undefined` пропускает. Геттеры источника вызываются, и в копию попадает значение. Свойства определяются, а не присваиваются, поэтому сеттеры цели и ключ `__proto__` не срабатывают, в отличие от `Object.assign`. Копия поверхностная, прототип и неперечисляемые свойства теряются.
:::

::: details Чем отличаются операторы ?? и ||, и что делают ??=, ||= и &&=?
`||` возвращает правую часть для любого falsy-значения, `??` — только для `null` и `undefined`. Поэтому `count || 10` ломает осознанный `0`, а `count ?? 10` — нет. Смешивать `??` с `||` и `&&` без скобок нельзя, это `SyntaxError`. Логическое присваивание сокращённо вычисляется: `a ??= b` означает `a ?? (a = b)`, а не `a = a ?? b`. Если значение уже есть, записи нет вовсе: сеттер не вызывается, `Proxy` не получает `set`, реактивный эффект не запускается, правая часть не вычисляется.
:::

::: details Как работает optional chaining и где его нельзя использовать?
`?.` проверяет значение слева на `null`/`undefined` и, если проверка не прошла, отменяет вычисление всей оставшейся цепочки, включая аргументы вызовов, и возвращает `undefined`. Скобки обрывают цепочку: `(a?.b).c` упадёт. `f?.()` проверяет только `null`/`undefined`, а не «вызываемость». `this` при `obj?.method()` сохраняется. Нельзя использовать в левой части присваивания, с `new`, с тегированным шаблоном и с `super`, а `delete a?.b` разрешён. По смыслу `?.` — для данных, где пустота законна. На обязательных данных он превращает понятный `TypeError` в тихий `undefined` где-то дальше.
:::

::: details Что такое тегированный шаблон и почему массив строк одинаков между вызовами?
Это вызов функции, где первый аргумент — замороженный массив статических частей шаблона (с полем `raw` для необработанных строк), а остальные — вычисленные подстановки. Тег сам решает, как их склеить: экранировать значения, строить запрос с параметрами, парсить CSS. Массив строк создаётся один раз на место в исходном коде и кэшируется движком, поэтому при повторных вызовах той же строки кода приходит тот же объект. Библиотеки вроде lit-html используют его как ключ `WeakMap` и разбирают шаблон один раз. Ещё одна деталь: в тегированном шаблоне допустимы некорректные escape-последовательности, тогда приготовленная строка — `undefined`, а `raw` остаётся.
:::

::: details Почему деструктуризация reactive теряет реактивность, а деструктуризация props во Vue 3.5 — нет?
Реактивность держится на перехвате чтения свойства у прокси в момент рендера или эффекта. Деструктуризация читает свойство один раз во время `setup` и кладёт в переменную примитив, у которого нет ни прокси, ни подписки. Поэтому для `reactive` нужны `toRefs`/`toRef`, а для store Pinia — `storeToRefs`. Деструктуризация `defineProps` в `<script setup>` — это не деструктуризация в рантайме, а синтаксис для компилятора. Он переписывает каждое обращение к `count` в `__props.count`, а значение по умолчанию переносит в объявление props. Чтение остаётся ленивым и реактивным. Граница — передача значения наружу: `watch(count)` компилятор запрещает, нужен геттер `() => count`, а composable принимает `MaybeRefOrGetter` и вызывает `toValue`.
:::

## Задачи

### 1. Предскажите вывод · легко

```js
const { a = 1, b = 2, c = 3 } = { a: null, b: undefined, c: 0 };
const [x, , y = x * 10, ...rest] = [1, 2];
console.log(a, b, c, x, y, rest);

const user = { name: 'Ann', profile: null };
console.log(user.profile?.city.toUpperCase(), user.settings?.theme ?? 'light');

console.log({ ...null, ...'hi', ...[7] }, 0 || 'zero', 0 ?? 'zero');

const { length, ...chars } = 'ok';
console.log(length, chars);
```

::: details Решение и разбор
```text
null 2 0 1 10 []
undefined light
{ '0': 7, '1': 'i' } zero 0
2 { '0': 'o', '1': 'k' }
```

- Умолчание срабатывает только для `b`: `null` и `0` — значения. Третьего элемента в массиве нет, поэтому `y = x * 10` вычисляется уже с известным `x`; rest от исчерпанного итератора — пустой массив.
- `profile` — `null`, поэтому `?.` обрывает всю цепочку, и `.city.toUpperCase()` не выполняется. `user.settings` — `undefined`, дальше `??`.
- Spread `null` ничего не добавляет. `'hi'` даёт `{ 0: 'h', 1: 'i' }`, затем `[7]` перезаписывает ключ `0`.
- Строка оборачивается в `String`. `length` у неё неперечисляемый, поэтому в rest попадают только индексы, но прочитать `length` шаблоном можно.
:::

### 2. Сигнатура с опциями · легко

Найдите ошибки и перепишите сигнатуру через деструктуризацию так, чтобы осознанные `0` и `false` не терялись, а лишние опции уходили в `fetchOptions`.

```js
function createClient(options) {
  const baseURL = options.baseURL || '/api';
  const timeout = options.timeout || 5000;
  const retries = options.retry.count || 3;
  const cache = options.cache || true;
  // ...
}

createClient({ timeout: 0, cache: false });
```

::: details Решение и разбор
Ошибки: вызов без аргумента падает на `options.baseURL`. Отсутствующий `retry` падает на `.count`. `timeout: 0` превращается в `5000`, `count: 0` — в `3`, а `cache: false` — в `true`, потому что `||` реагирует на любое falsy-значение.

```js
function createClient({
  baseURL = '/api',
  timeout = 5000,
  retry: { count = 3, delay = 100 } = {},
  cache = true,
  ...fetchOptions
} = {}) {
  return { baseURL, timeout, retry: { count, delay }, cache, fetchOptions };
}

createClient();
// { baseURL: '/api', timeout: 5000, retry: { count: 3, delay: 100 }, cache: true, fetchOptions: {} }
createClient({ timeout: 0, cache: false, retry: { count: 0 }, headers: { a: 1 } });
// { ..., timeout: 0, retry: { count: 0, delay: 100 }, cache: false, fetchOptions: { headers: { a: 1 } } }
```

Остаются две ловушки `null`. `{ timeout: null }` пройдёт как `null`, потому что умолчание — только для `undefined`. `{ retry: null }` упадёт с `TypeError: Cannot read properties of null (reading 'count')`, так как вложенный `= {}` не сработал. Если опции приходят из JSON или формы, где «пусто» — это `null`, вложенный объект разбирают отдельно: `retry = {}` в сигнатуре, затем `const { count = 3 } = retry ?? {}`. Для скаляров используют `timeout ?? 5000` в теле.
:::

### 3. `pick` и `omit` · средне

Напишите `pick(obj, keys)` и `omit(obj, keys)` с семантикой rest-свойства: только собственные перечисляемые свойства, включая символьные, значения геттеров копируются как данные. Объект, разобранный из JSON `{"__proto__": {"admin": true}, "a": 1}`, не должен менять прототип результата.

::: details Решение и разбор
```js
const isOwnEnumerable = (obj, key) => Object.prototype.propertyIsEnumerable.call(obj, key);

function pick(obj, keys) {
  // fromEntries uses CreateDataProperty, so '__proto__' becomes an own key.
  return Object.fromEntries(keys.filter((key) => isOwnEnumerable(obj, key)).map((key) => [key, obj[key]]));
}

function omit(obj, keys) {
  const drop = new Set(keys);
  const out = {};
  for (const key of Reflect.ownKeys(obj)) {
    if (drop.has(key) || !isOwnEnumerable(obj, key)) continue;
    Object.defineProperty(out, key, { value: obj[key], writable: true, enumerable: true, configurable: true });
  }
  return out;
}

const src = JSON.parse('{"__proto__": {"admin": true}, "a": 1, "b": 2}');
pick(src, ['__proto__', 'a', 'toString']); // { ['__proto__']: { admin: true }, a: 1 }
omit(src, ['a']).admin;                    // undefined: the prototype is untouched
```

- Для фиксированного списка ключей `omit` пишется одной строкой: `const { password, token, ...safe } = user`. Динамический список шаблоном не выразить, отсюда функция. По семантике она повторяет rest-свойство.
- `JSON.parse` создаёт `__proto__` как обычное собственное свойство. Наивное `out[key] = obj[key]` на этом ключе вызывает сеттер `Object.prototype.__proto__` и меняет прототип результата: `out.admin` становится `true`. Это и есть prototype pollution в миниатюре. Полностью, с `set` по пути, `merge` и защитой, он разобран в теме [deepClone, deepEqual, get/set по пути](../live-coding/object-utilities.md). `Object.fromEntries`, `defineProperty` и spread определяют свойство, а не присваивают его.
- `propertyIsEnumerable` проверяет собственное перечисляемое свойство, поэтому `toString` из прототипа не попадёт в `pick`. `Object.hasOwn` пропустил бы неперечисляемые.
- `Reflect.ownKeys` даёт и символы, в отличие от `Object.keys`.

Сложность: O(n + k) по времени, где n — число ключей объекта, k — длина списка; O(n) по памяти.
:::

### 4. Тег `html` с экранированием · средне

Напишите тег `html`, который экранирует подставленные значения, но не статические части шаблона. Массивы подстановок склеиваются, `null`, `undefined` и `false` не выводятся, а результат вложенного `html` и явно помеченная разметка не экранируются повторно.

```js
const comment = '<img src=x onerror=alert(1)>';
const items = ['a & b', '<i>c</i>'];
const page = html`
  <p title="${'"quoted"'}">${comment}</p>
  <ul>${items.map((item) => html`<li>${item}</li>`)}</ul>
  ${false}${null}${unsafeRaw('<hr>')}
`;
```

::: details Решение и разбор
```js
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (value) => String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

class SafeHTML {
  #value;
  constructor(value) { this.#value = value; }
  toString() { return this.#value; }
}

const unsafeRaw = (markup) => new SafeHTML(markup);

function render(value) {
  if (value == null || value === false) return '';
  if (value instanceof SafeHTML) return String(value);
  if (Array.isArray(value)) return value.map(render).join('');
  return escape(value);
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHTML(out);
}
```

```text
  <p title="&quot;quoted&quot;">&lt;img src=x onerror=alert(1)&gt;</p>
  <ul><li>a &amp; b</li><li>&lt;i&gt;c&lt;/i&gt;</li></ul>
  <hr>
```

- `strings.length === values.length + 1` всегда, даже если шаблон начинается или кончается подстановкой: там будет пустая строка.
- Доверие выражено типом: `SafeHTML` не подделать строкой, а приватное поле не даёт подменить содержимое снаружи. Без такого маркера вложенный `html` экранировался бы дважды.
- `0` выводится, а `false` — нет: так условный рендер ``${isAdmin && html`…`}`` не печатает `false`.
- Ограничение — контекст. Экранирование защищает текст и атрибут в кавычках, но не `href="${url}"` с `javascript:` и не атрибут без кавычек. Настоящие библиотеки (lit-html) разбирают статические части, знают позицию каждой подстановки и кэшируют разбор по объекту `strings`, пользуясь тем, что он один на место в коде. Шаблоны Vue экранируют интерполяции так же, а `v-html` — аналог `unsafeRaw`.

Сложность: O(L) по времени и памяти, где L — длина результата.
:::

### 5. Итератор под деструктуризацией · сложно

Предскажите вывод и объясните, когда вызывается `finally` генератора.

```js
const log = (tag, value) => (console.log(tag), value);

function* nums() {
  try {
    yield 1;
    yield undefined;
    yield 3;
  } finally {
    console.log('closed');
  }
}

const [a = log('default a', 0), b = log('default b', 2)] = nums();
console.log(a, b);

const { x = log('default x'), [log('key', 'y')]: y = log('default y', 'Y') } = { x: 0 };
console.log(x, y);

const [p, ...q] = nums();
console.log(p, q);

try {
  const [first, second = missing] = nums();
} catch (e) {
  console.log(e.name);
}
```

::: details Решение и разбор
```text
default b
closed
1 2
key
default y
0 Y
closed
1 [ undefined, 3 ]
closed
ReferenceError
```

- Первый шаблон вызывает `next()` дважды: `1`, затем `undefined`, и срабатывает умолчание `b`. Генератор ещё не завершён, поэтому после шаблона `IteratorBindingInitialization` вызывает `IteratorClose` → `return()`. Генератор возобновляется как будто с `return` на месте `yield`, выполняется `finally`, и `closed` печатается **до** `console.log(a, b)`.
- Объектный шаблон идёт слева направо: `x` равен `0`, умолчание не вычисляется. Затем вычисляется ключ (`key`), читается `y`, его нет — вычисляется умолчание.
- Rest выбирает итератор до `done: true`. Генератор доходит до конца тела, `finally` выполняется сам, и `return()` уже не нужен.
- Умолчание `second` обращается к необъявленной `missing` — `ReferenceError`. Перед тем как пробросить ошибку, деструктуризация закрывает итератор, поэтому `closed` печатается раньше, чем `catch`. Это та же гарантия, что у `for...of` при `break` и `throw`: ресурсы генератора освобождаются.

Сложность: O(m) вызовов `next()`, где m — число элементов шаблона, или длина итератора при rest.
:::

## Источники

- [ECMAScript: Destructuring Assignment](https://tc39.es/ecma262/#sec-destructuring-assignment), [Destructuring Binding Patterns](https://tc39.es/ecma262/#sec-destructuring-binding-patterns), [KeyedBindingInitialization](https://tc39.es/ecma262/#sec-runtime-semantics-keyedbindinginitialization), [IteratorBindingInitialization](https://tc39.es/ecma262/#sec-runtime-semantics-iteratorbindinginitialization), [RestDestructuringAssignmentEvaluation](https://tc39.es/ecma262/#sec-runtime-semantics-restdestructuringassignmentevaluation), [RequireObjectCoercible](https://tc39.es/ecma262/#sec-requireobjectcoercible), [IteratorClose](https://tc39.es/ecma262/#sec-iteratorclose)
- [ECMAScript: Object Initializer](https://tc39.es/ecma262/#sec-object-initializer), [Array Initializer](https://tc39.es/ecma262/#sec-array-initializer), [Argument Lists](https://tc39.es/ecma262/#sec-argument-lists), [CopyDataProperties](https://tc39.es/ecma262/#sec-copydataproperties), [CreateDataProperty](https://tc39.es/ecma262/#sec-createdataproperty), [Object.fromEntries](https://tc39.es/ecma262/#sec-object.fromentries), [Function Definitions](https://tc39.es/ecma262/#sec-function-definitions)
- [ECMAScript: Optional Chains](https://tc39.es/ecma262/#sec-optional-chains), [Left-Hand-Side Expressions](https://tc39.es/ecma262/#sec-left-hand-side-expressions), [Binary Logical Operators](https://tc39.es/ecma262/#sec-binary-logical-operators), [Assignment Operators](https://tc39.es/ecma262/#sec-assignment-operators), [Exponentiation Operator](https://tc39.es/ecma262/#sec-exp-operator), [The try Statement](https://tc39.es/ecma262/#sec-try-statement)
- [ECMAScript: Template Literals](https://tc39.es/ecma262/#sec-template-literals), [GetTemplateObject](https://tc39.es/ecma262/#sec-gettemplateobject), [Tagged Templates](https://tc39.es/ecma262/#sec-tagged-templates), [TV and TRV](https://tc39.es/ecma262/#sec-static-semantics-tv-and-trv), [String.raw](https://tc39.es/ecma262/#sec-string.raw)
- [MDN: Destructuring](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring), [Spread syntax](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax), [Rest parameters](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/rest_parameters), [Default parameters](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Default_parameters)
- [MDN: Optional chaining](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining), [Nullish coalescing](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing), [Nullish coalescing assignment](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing_assignment), [Template literals](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals), [Exponentiation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Exponentiation)
- [Vue: Reactive Props Destructure](https://vuejs.org/guide/components/props.html#reactive-props-destructure), [Reactivity Fundamentals — limitations of `reactive()`](https://vuejs.org/guide/essentials/reactivity-fundamentals.html#limitations-of-reactive), [`toRefs`](https://vuejs.org/api/reactivity-utilities.html#torefs)
- [Pinia: Destructuring from a Store](https://pinia.vuejs.org/core-concepts/#Destructuring-from-a-Store)
- [lit-html: Expressions and templates](https://lit.dev/docs/templates/expressions/)
