---
title: deepClone, deepEqual, get/set по пути
level: ядро
---

# deepClone, deepEqual, get/set по пути

> **Коротко.** Три утилиты для вложенных данных, и все обходят **граф** объектов, а не дерево. `deepClone` ведёт таблицу «оригинал → копия» в `WeakMap`, поэтому циклы и общие ссылки переживают копирование. Встроенные типы (`Date`, `Map`, типизированные массивы) хранят данные во внутренних слотах, перебором свойств их не скопировать. `deepEqual` сравнивает структуру, и его контракт надо проговорить: `NaN` и `-0`, прототипы, `undefined` против отсутствующего ключа, циклы, `Set` из объектов за O(n²). `get`/`set` по пути разбирают `a.b[0].c` в массив ключей, а `set` ещё и создаёт промежуточные объекты. Без запрета ключей `__proto__`, `constructor` и `prototype` такой `set` — классический вектор prototype pollution.

**Связанные темы:** [Типы данных и приведение типов](../javascript/types-and-coercion.md), [Прототипы и классы](../javascript/prototypes-and-classes.md), [Дескрипторы свойств, Proxy и Reflect](../javascript/property-descriptors-and-proxy.md), [Деструктуризация, spread/rest и современный синтаксис](../javascript/modern-syntax.md), [Функциональные приёмы и иммутабельность](../javascript/functional-programming.md), [Память и сборка мусора](../javascript/memory-and-gc.md), [Оценка сложности](../algorithms/complexity.md), [Массивы, строки и хеш-таблицы](../algorithms/arrays-strings-hashing.md), [Деревья и графы: BFS и DFS](../algorithms/trees-and-graphs.md), [XSS и безопасный вывод во Vue](../security/xss.md), [curry, compose, memoize, once](./function-utilities.md)

## Теория

### Граф, а не дерево

Наивная рекурсия «для каждого ключа скопируй значение» предполагает дерево. Реальные данные — граф: общие ссылки (`a.x === a.y`) и циклы (`node.parent.children[0] === node`). На цикле наивная рекурсия падает с `RangeError`. На общей ссылке она молча делает две разные копии, и `copy.x === copy.y` становится `false`.

Лечится это **таблицей посещённых**: `WeakMap` «оригинал → копия». Копию регистрируют **до** спуска к детям, иначе цикл вернётся к объекту раньше, чем тот попадёт в таблицу. Ту же таблицу ведут `structuredClone` (memory в алгоритме сериализации HTML), lodash (`Stack` в `baseClone`) и Vue (`seen` в `traverse` для глубокого `watch`). `WeakMap` здесь не обязателен, таблица живёт один вызов. Важно другое: ключ — идентичность объекта.

Вторая граница — **глубина**. Рекурсивное решение задачи 3 в Node 26 падает с `RangeError` на вложенности около 9000 уровней, а `structuredClone` — на 100 000. Для недоверенных данных обход делают на явном стеке ([подробнее](../algorithms/complexity.md)).

### Контракт deepClone

Что считать копией, решает автор. На интервью эти решения проговаривают вслух:

- **Какие ключи.** `Object.keys` и `Object.entries` дают только собственные перечисляемые строковые ключи, `for...in` добавляет унаследованные. `Reflect.ownKeys` возвращает все собственные: строки, символы, неперечисляемые. Порядок: целочисленные индексы по возрастанию, затем строки в порядке создания, затем символы ([подробнее](../javascript/property-descriptors-and-proxy.md)).
- **Значения или дескрипторы.** `copy[key] = value[key]` вызывает геттер и сохраняет его результат, а запись идёт через `[[Set]]`. На ключе `__proto__` такая запись вызывает сеттер и меняет прототип копии. Ключ этот вполне реален: `JSON.parse('{"__proto__": …}')` создаёт его как собственное свойство. `Object.defineProperty` с дескриптором из `getOwnPropertyDescriptor` переносит аксессоры, флаги `enumerable`/`writable` и определяет `__proto__` как обычное свойство.
- **Прототип.** `Object.create(Object.getPrototypeOf(value))` сохраняет методы класса, а `{}` превращает экземпляр в обычный объект (так делает `structuredClone`). Но прототип не переносит то, что конструктор хранит вне свойств: приватные поля `#x`, замыкания, внутренние слоты. Метод копии, читающий `#x`, бросит `TypeError: Cannot read private member #x from an object whose class did not declare it`. Для классов нужен явный протокол: метод `clone()` или собственная сериализация.
- **Встроенные типы.** Данные `Date`, `Map`, `Set`, `RegExp`, `ArrayBuffer` и типизированных массивов лежат во внутренних слотах (`[[DateValue]]`, `[[MapData]]`), а не в свойствах. Поэтому `Object.create(Date.prototype).getTime()` бросает `TypeError: this is not a Date object`. Каждому типу нужен свой конструктор. Типизированный массив создают как представление над **скопированным** буфером: тогда два представления одного буфера и в копии останутся связаны.
- **Что не клонируется.** Функции: замыкание не скопировать, их оставляют общими. `WeakMap` и `WeakSet` нельзя обойти. `Promise`, DOM-узлы (у них свой `cloneNode(true)`). `Proxy` из JS не распознать вовсе: клон читает объект через ловушки.
- **Замороженность.** Перенос дескрипторов сохраняет `writable: false` и `configurable: false`. Если вдобавок вызвать `Object.preventExtensions` для нерасширяемого оригинала, замороженный объект останется замороженным, а запечатанный — запечатанным.

> [!WARNING]
> `Error` клонируется лишь наполовину. В Node 26 (V8) `stack` — собственный аксессор экземпляра, который читает внутренний слот. Перенесённый на копию, он возвращает `undefined`, а `Error.isError(copy)` (ES2026) — `false`. `message` и `cause` переносятся. `structuredClone` поддерживает `Error` штатно.

Как ведут себя готовые варианты. Колонка lodash сверена по исходникам 4.18.1, остальное проверено в Node 26:

| | `JSON` | `structuredClone` | `_.cloneDeep` | задача 3 |
| --- | --- | --- | --- | --- |
| циклы и общие ссылки | цикл — `TypeError`, общая ссылка дублируется | да | да | да |
| прототип класса | нет | нет | да | да |
| символьные ключи | нет | нет | перечисляемые | все |
| неперечисляемые | нет | нет | нет | да |
| геттеры | значение | значение | значение | аксессор |
| ключи `Map` | — | копируются | **общие** | копируются |
| функция | пропадает | `DataCloneError` | `{}` на верхнем уровне, вложенная — общая | общая |

Чем ещё отличаются `JSON` и `structuredClone`, разобрано в теме [Функциональные приёмы и иммутабельность](../javascript/functional-programming.md).

### Контракт deepEqual

Глубокое сравнение отвечает на вопрос «одинаковы ли данные», и каждое слово в нём требует решения:

- **Примитивы.** `===` считает `NaN` не равным себе, `Object.is` (SameValue) различает `0` и `-0`, SameValueZero (`Map`, `Set`, `includes`) равняет и то и другое ([подробнее](../javascript/types-and-coercion.md)). `util.isDeepStrictEqual` в Node опирается на `Object.is`: `NaN` равен `NaN`, а `[0]` не равен `[-0]`. `_.isEqual` сравнивает как `a === b || (a !== a && b !== b)`, то есть `0` равен `-0`.
- **Тип и прототип.** `[1]` и `{ 0: 1 }` не равны. `{}` и `Object.create(null)` Node считает разными, сравнивая прототипы. lodash сравнивает `constructor`, поэтому экземпляр класса не равен обычному объекту с теми же полями.
- **Ключи.** Сравнивают множества собственных перечисляемых ключей, порядок не важен. `{ a: undefined }` и `{}` не равны и в Node, и в lodash: ключ есть против ключа нет. Дыра в массиве (`[, 1]`) не равна `undefined` (`[undefined, 1]`).
- **Встроенные типы.** `Date` — по `getTime()` (два невалидных `Date` дают `NaN` и равны через `Object.is`). `RegExp` — по `source` и `flags`. Node строго сравнивает ещё и `lastIndex`.
- **`Map` и `Set`.** Ключ `Map` с примитивом находится через `has` за O(1). Объекты в `Set` (и объектные ключи `Map`, если сравнивать их структурно) приходится сопоставлять перебором: каждому элементу ищется ещё не занятая пара. Это O(n²), и именно так сделано у Node, lodash и Vue.
- **Циклы.** Пары, которые уже сравниваются на текущем пути, помнят в двух `Map` (`a → b` и `b → a`). Повторная встреча пары считается равенством, если циклы устроены одинаково. После сравнения пару снимают с пути, иначе общая ссылка в одном графе «привяжется» к одному объекту другого.

### get, set и has по пути

Строковый путь — это мини-язык: `a.b[0].c`, `a["b.c"]`, `a[0][1]`. Сначала его разбирают в массив ключей. Массив пути (`['a', 'b.c']`) однозначнее строки: ключ с точкой в строке не выразить без кавычек. lodash принимает оба вида, а строку, которая целиком является собственным ключом объекта, трактует как один ключ: `_.get({ 'a.b': 1 }, 'a.b')` вернёт `1`.

- **`get`** останавливается на `null`/`undefined` и возвращает значение по умолчанию **только** для `undefined`: `_.get(obj, 'a', 'd')` при `a: null` вернёт `null`. Похожее `obj?.a ?? 'd'` заменит и `null`. Разница — частый уточняющий вопрос.
- **`has`** проверяет **собственные** свойства на каждом шаге (`Object.hasOwn`), иначе `has({}, 'toString')` вернёт `true`. В lodash `has` — собственные, `hasIn` — с прототипом.
- **`set`** создаёт недостающие узлы: массив, если следующий ключ похож на индекс (`'0'`, `'12'`), иначе объект. Примитив на пути перезаписывается объектом. `set` мутирует. Иммутабельная версия копирует только узлы на пути, а остальное делит со старой версией (structural sharing, [подробнее](../javascript/functional-programming.md)).

### Prototype pollution

Если путь или ключи приходят снаружи (query-строка, JSON, форма), наивный `set` пишет в `Object.prototype`:

```js
set({}, '__proto__.isAdmin', true);          // obj.__proto__ is Object.prototype
set({}, 'constructor.prototype.isAdmin', 1); // obj.constructor is Object
({}).isAdmin; // true — every object in the realm now "has" it
```

`obj.__proto__` — геттер на `Object.prototype`, а `obj.constructor` найден по цепочке. Так что путь выходит из графа данных в общие для всего realm объекты. Тот же механизм у рекурсивного `merge` и `defaultsDeep` поверх `JSON.parse`. Отсюда CVE lodash: `_.merge` (CVE-2018-3721, CVE-2018-16487), `_.defaultsDeep` (CVE-2019-10744, critical), `_.zipObjectDeep` (CVE-2020-8203). Последствие на фронтенде — **гаджет**: код, который читает необязательную опцию (`options.sanitize`, `config.html`), находит её в загрязнённом прототипе. Так загрязнение превращается в XSS ([подробнее](../security/xss.md)).

Защита — в несколько слоёв:

1. **Запретить ключи** `__proto__`, `constructor`, `prototype` в любом месте пути. Так делает `baseSet` в lodash 4.18.1: на таком ключе он молча возвращает объект без изменений. Проверять надо **нормализованный** ключ. В lodash 4.17.23 проверка в `_.unset`, `_.omit` и `_.pullAt` смотрела только на строки. Путь `[['__proto__'], …]` её обходил, потому что `String(['__proto__'])` — это `'__proto__'`, и позволял удалять свойства встроенных прототипов (CVE-2026-2950, исправлено в 4.18.1).
2. **Спускаться только по собственным свойствам** (`Object.hasOwn`), а не по цепочке прототипов.
3. **Хранить словари без прототипа:** `Object.create(null)` или `Map`. У такого объекта нет ни сеттера `__proto__`, ни унаследованного `constructor` ([подробнее](../algorithms/arrays-strings-hashing.md)).
4. **Определять, а не присваивать:** `Object.defineProperty`, `Object.fromEntries` и spread не вызывают сеттер `__proto__`.
5. **Закалить среду:** `Object.freeze(Object.prototype)` или флаг Node `--disable-proto=delete|throw`. Заморозка ломает код, который присваивает свойство, уже определённое в прототипе (например, `obj.toString = …`): в строгом режиме это `TypeError` (override mistake).

### Во Vue

- **`v-model` сравнивает через `looseEqual`** из `@vue/shared`. Им выбирается отмеченный чекбокс, радиокнопка и `<option>`. Сравнение намеренно «рыхлое»: примитивы — через `String(a) === String(b)` (`1` равен `'1'`, `0` равен `-0`), `Date` — по времени, объекты — по ключам без учёта прототипа. `Map` и `Set` правильно сравниваются с 3.5.42, циклы поддержаны с 3.5.43 (обе правки — 2026 год, проверено на 3.5.45).
- **Реактивность сравнивает по `Object.is`** (`hasChanged`). `ref` с `NaN` не перезапускает эффекты при записи `NaN`, а запись `-0` вместо `0` перезапускает. Новый объект с тем же содержимым — тоже изменение: глубокого сравнения Vue не делает, его ставят сами (`if (!deepEqual(next, state.value)) state.value = next`).
- **Глубокий `watch`** обходит значение функцией `traverse` с таблицей `seen: Map<object, depth>`. Она защищает от циклов, а с 3.5 ещё и ограничивает глубину (`deep: number`). Колбэк при мутации получает `newValue === oldValue`: снимок «до» нужно делать самим.
- **Снимок `reactive`.** `structuredClone(state)` бросает `DataCloneError` ([подробнее](../javascript/functional-programming.md)). Клон через дескрипторы (задача 3) работает и даёт нереактивную копию. У прокси Vue нет ловушки `getOwnPropertyDescriptor`, поэтому дескриптор приходит от сырого объекта, и чтение не подписывает эффект на свойства. Клон через `value[key]` прошёл бы через ловушку `get`: получил бы реактивные вложенные объекты и в `computed` или `watchEffect` подписался бы на каждое поле. Надёжнее вызвать `toRaw(state)` перед любым клоном.

## Примеры

```js
// Form "dirty" flag: a snapshot outside effects, a comparison inside computed
const initial = deepClone(toRaw(form));
const isDirty = computed(() => !deepEqual(form, initial)); // reads through the proxy: tracked
const reset = () => Object.assign(form, deepClone(initial));

// Reading nested API data with a default
const city = get(response, ['user', 'addresses', 0, 'city'], '—');

// Query string -> nested filters, with a guard against pollution
const filters = {};
for (const [path, value] of new URLSearchParams(location.search)) {
  if (path.startsWith('filter.')) set(filters, path.slice('filter.'.length), value); // throws on __proto__
}
```

В первом примере легко ошибиться: `deepEqual(toRaw(form), initial)` внутри `computed` читает сырой объект, ни на что не подписывается, и `isDirty` навсегда останется `false`. Сравнение через прокси читает поля ловушкой `get` и подписывает `computed` на всё, что прочитано. Проверено на Vue 3.5.45: флаг включается после `push` в массив и замены вложенного `Date` и выключается после отката. `toRaw` нужен для снимка, который делают вне эффектов.

## Вопросы с интервью

::: details Как глубоко скопировать объект и когда своей реализации не избежать
По умолчанию — `structuredClone`: он сохраняет циклы и общие ссылки, понимает `Date`, `Map`, `Set`, `RegExp`, типизированные массивы и `Error`. JSON-круг годится только для JSON-совместимых данных. Своя реализация (или `_.cloneDeep`) нужна, когда важно то, что `structuredClone` теряет или на чём падает: прототип класса, символьные и неперечисляемые ключи, аксессоры, замороженность, функции внутри данных, а также `Proxy` — например, реактивный объект Vue. Ещё один случай — копия с преобразованием, вроде переименования ключей.
:::

::: details Почему копия Date перебором свойств не работает
У `Date` нет собственных свойств: время хранится во внутреннем слоте `[[DateValue]]`, а методы прототипа проверяют этот слот у `this`. `Object.create(Date.prototype)` слота не имеет, и `getTime()` бросает `TypeError`. То же с `Map`, `Set`, `RegExp`, `ArrayBuffer`, типизированными массивами и приватными полями классов. Поэтому `deepClone` разбирает встроенные типы отдельно и создаёт копию их конструктором: `new Date(d.getTime())`, `new Map()` с перенесёнными записями, представление над скопированным буфером.
:::

::: details Зачем deepClone нужен WeakMap и почему копию регистрируют до рекурсии
Данные — граф: в них бывают общие ссылки и циклы. Таблица «оригинал → копия» решает обе проблемы: встретив объект повторно, функция возвращает уже созданную копию. Цикл не уходит в бесконечную рекурсию, а общая ссылка остаётся общей и в копии. Регистрировать копию надо сразу после создания пустой оболочки, до обхода детей: иначе цикл дойдёт до объекта, пока того ещё нет в таблице. `WeakMap` подходит естественно — ключ по идентичности, объекты не удерживаются. Но и `Map` корректен, потому что таблица живёт один вызов.
:::

::: details Как deepEqual должен сравнивать NaN, минус ноль и undefined
Это решения контракта, их проговаривают. Сравнение через `Object.is` (SameValue) считает `NaN` равным себе и различает `0` и `-0` — так делает `util.isDeepStrictEqual` в Node. Вариант lodash равняет и `NaN`, и нули. Простое `===` даёт `deepEqual(NaN, NaN) === false`, что почти никогда не нужно. Ключ со значением `undefined` и отсутствующий ключ обычно различают (`{ a: undefined }` не равен `{}`): сравнивают множества ключей, а не только значения. Если сравнение нужно для данных после JSON, где `undefined` исчезает, это отдельный, «рыхлый» режим.
:::

::: details Почему сравнение двух Set с объектами квадратичное
`Set` ищет элемент по SameValueZero, то есть объект — только по ссылке. Два структурно равных, но разных объекта `has` не найдёт. Для каждого объекта из первого множества приходится перебирать ещё не сопоставленные элементы второго и глубоко сравнивать: O(n²) сравнений, каждое из которых само рекурсивно. Примитивы и общие ссылки отсекаются заранее за O(1) через `has`, перебор нужен только для остатка. Так устроены `isDeepStrictEqual` в Node, `_.isEqual` и `looseEqual` во Vue. Ускорить можно каноническим хешем элемента, но его построение — тоже обход.
:::

::: details Что такое prototype pollution и как защитить set и merge
Это запись в `Object.prototype` через путь или ключ из внешних данных. `obj.__proto__` — геттер, возвращающий прототип, а `obj.constructor.prototype` ведёт к нему же. Поэтому `set(obj, '__proto__.isAdmin', true)` или рекурсивный `merge` поверх `JSON.parse` добавляет свойство всем объектам. Опасно это через гаджеты: код, читающий необязательную опцию, найдёт её в прототипе. Защита: запрет ключей `__proto__`, `constructor`, `prototype` после нормализации (строка и массив `['__proto__']` дают один ключ), спуск только по собственным свойствам, словари на `Object.create(null)` или `Map`, `defineProperty` вместо присваивания, обновление lodash (свежая CVE-2026-2950 исправлена в 4.18.1), а для Node — `--disable-proto`.
:::

::: details Чем get с значением по умолчанию отличается от optional chaining
`obj?.a?.b ?? d` подставит `d` и для `undefined`, и для `null`. `_.get(obj, 'a.b', d)` — только для `undefined`: существующий `null` вернётся как есть. Кроме того, `get` принимает путь как данные: строку или массив, пришедшие из конфигурации, колонки таблицы или формы. Optional chaining записывается в коде и путь не параметризует. Цена `get` — разбор строки на каждый вызов (lodash кэширует его в `memoizeCapped`) и потеря типизации: TS выводит тип по пути только с типами уровня шаблонных строк.
:::

## Задачи

### 1. get, set и has по пути · легко

Напишите `get(obj, path, defaultValue)`, `has(obj, path)` и `set(obj, path, value)`. Путь — строка (`a.b[0].c`, `a["b.c"]`) или массив. `set` создаёт промежуточные массивы и объекты и не должен давать prototype pollution.

::: details Решение и разбор
```js
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const isIndex = (key) => /^(0|[1-9]\d*)$/.test(key);

function toPath(path) {
  if (Array.isArray(path)) return path.map(String); // ['__proto__'] becomes '__proto__' too
  const keys = [];
  for (const [, , quoted, index, plain] of path.matchAll(/\[(["'])(.*?)\1\]|\[(\d+)\]|([^.[\]]+)/g)) {
    keys.push(quoted ?? index ?? plain);
  }
  return keys;
}

function get(obj, path, defaultValue) {
  let current = obj;
  for (const key of toPath(path)) {
    if (current == null) return defaultValue;
    current = current[key];
  }
  return current === undefined ? defaultValue : current;
}

function has(obj, path) {
  const keys = toPath(path);
  let current = obj;
  for (const key of keys) {
    if (current == null || !Object.hasOwn(current, key)) return false;
    current = current[key];
  }
  return keys.length > 0;
}

function set(obj, path, value) {
  const keys = toPath(path);
  if (keys.length === 0) return obj;
  if (keys.some((key) => UNSAFE.has(key))) throw new TypeError(`Unsafe key in path: ${keys.join('.')}`);
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = Object.hasOwn(current, key) ? current[key] : undefined; // never walk the prototype chain
    current = next !== null && typeof next === 'object'
      ? next
      : (current[key] = isIndex(keys[i + 1]) ? [] : {});
  }
  current[keys.at(-1)] = value;
  return obj;
}
```

Проверено в Node 26: `get` возвращает `null` как есть и `defaultValue` для `undefined`, `get('abc', 'length') === 3`; `has(data, 'a.toString')` — `false`; `set({}, 'a.b[0].c', 1)` создаёт `{ a: { b: [{ c: 1 }] } }`; `set({}, 'toString.x', 1)` создаёт собственное `toString`, а не пишет в `Object.prototype.toString`. Пути `'__proto__.x'`, `'constructor.prototype.x'`, `'a["__proto__"].x'` и `[['__proto__'], 'x']` бросают `TypeError`. Бросать или молча игнорировать, как lodash, — решение контракта; ошибка заметнее. Запрет ключей и спуск только по собственным свойствам дополняют друг друга: без второго `set` пишет в унаследованные функции, без первого запись `current['__proto__'] = {}` вызывает сеттер. Что спросят дальше: `unset`, иммутабельный `setIn` с копированием узлов пути, `deepMerge` с той же защитой, типизация пути шаблонными строками.

Сложность: O(k) по времени, k — длина пути (плюс разбор строки, O(длина строки)).
:::

### 2. deepEqual · средне

Напишите `deepEqual(a, b)`: примитивы — по `Object.is`, одинаковые прототипы, одинаковые множества собственных перечисляемых ключей (включая символы), `Date`, `RegExp`, `Map`, `Set` (в том числе с объектами), циклы.

::: details Решение и разбор
```js
const isObject = (v) => typeof v === 'object' && v !== null;
const isEnumerable = (o, key) => Object.prototype.propertyIsEnumerable.call(o, key);
const ownKeys = (o) => Reflect.ownKeys(o).filter((key) => isEnumerable(o, key));

function deepEqual(a, b) {
  const seenA = new Map(); // pairs on the current path
  const seenB = new Map();

  function equal(x, y) {
    if (Object.is(x, y)) return true;
    if (!isObject(x) || !isObject(y)) return false;
    if (Object.getPrototypeOf(x) !== Object.getPrototypeOf(y)) return false;
    if (seenA.has(x) || seenB.has(y)) return seenA.get(x) === y && seenB.get(y) === x;
    seenA.set(x, y);
    seenB.set(y, x);
    try {
      return compare(x, y);
    } finally {
      seenA.delete(x);
      seenB.delete(y);
    }
  }

  function compare(x, y) {
    if (x instanceof Date) return Object.is(x.getTime(), y.getTime());
    if (x instanceof RegExp) return x.source === y.source && x.flags === y.flags;
    if (x instanceof Map) {
      if (x.size !== y.size) return false;
      for (const [key, value] of x) {
        if (!y.has(key) || !equal(value, y.get(key))) return false;
      }
      return true;
    }
    if (x instanceof Set) {
      if (x.size !== y.size) return false;
      const unmatched = [...y].filter((value) => !x.has(value));
      for (const value of x) {
        if (y.has(value)) continue;
        const i = unmatched.findIndex((candidate) => equal(value, candidate));
        if (i === -1) return false;
        unmatched.splice(i, 1);
      }
      return true;
    }
    if (Array.isArray(x) && x.length !== y.length) return false;
    const keys = ownKeys(x);
    if (keys.length !== ownKeys(y).length) return false;
    return keys.every((key) => isEnumerable(y, key) && equal(x[key], y[key]));
  }

  return equal(a, b);
}
```

Массивы идут по общей ветке: `Reflect.ownKeys` даёт индексы, а неперечисляемый `length` отфильтрован. Поэтому длину сверяют отдельно, иначе `new Array(1)` равнялся бы `[]`. Проверено в Node 26: `NaN` равен `NaN`, `0` не равен `-0`, `{ a: undefined }` не равен `{}`, `[, 1]` не равен `[undefined, 1]`, `{}` не равен `Object.create(null)`, экземпляр класса не равен обычному объекту; `Set` с `{ a: 1 }, { a: 2 }` в разном порядке равны, а `{ a: 1 }, { a: 1 }` против `{ a: 1 }, { a: 2 }` — нет; одинаковые самоссылающиеся объекты и взаимные циклы равны. Объект с петлёй на себя и цикл длины 2 с теми же данными признаются разными: формы циклов отличаются. Так же решает и `util.isDeepStrictEqual`. Ключи `Map` сравниваются по ссылке: две `Map` с разными объектами-ключами `{}` не равны. Node сопоставляет такие ключи структурно — это и есть «что спросят дальше», вместе с `Error`, обёртками примитивов, типизированными массивами и режимом `partial` (`_.isMatch`).

Сложность: O(n) по времени для деревьев, n — число узлов; O(n²) сравнений для `Set` из объектов; память O(глубина).
:::

### 3. deepClone · сложно

Напишите `deepClone(value)`: циклы и общие ссылки, `Date`, `RegExp` с `lastIndex`, `Map`, `Set`, `ArrayBuffer` и типизированные массивы, прототип, символьные и неперечисляемые ключи, геттеры как аксессоры, замороженность. Функции остаются общими, `WeakMap`/`WeakSet`/`Promise` — ошибка.

::: details Решение и разбор
```js
function deepClone(value, seen = new WeakMap()) {
  if (typeof value !== 'object' || value === null) return value; // functions are shared
  if (seen.has(value)) return seen.get(value);
  if (value instanceof WeakMap || value instanceof WeakSet || value instanceof Promise) {
    throw new TypeError(`${Object.prototype.toString.call(value)} cannot be cloned`);
  }

  let copy;
  if (value instanceof Date) copy = new Date(value.getTime());
  else if (value instanceof RegExp) copy = new RegExp(value.source, value.flags);
  else if (value instanceof Map) copy = new Map();
  else if (value instanceof Set) copy = new Set();
  else if (value instanceof ArrayBuffer) copy = value.slice(0);
  else if (ArrayBuffer.isView(value)) {
    const buffer = deepClone(value.buffer, seen); // views over one buffer keep sharing it
    const length = value instanceof DataView ? value.byteLength : value.length;
    copy = new value.constructor(buffer, value.byteOffset, length);
  } else if (Array.isArray(value)) copy = new Array(value.length);
  else copy = Object.create(Object.getPrototypeOf(value));

  seen.set(value, copy); // before recursion

  if (value instanceof Map) {
    for (const [key, item] of value) copy.set(deepClone(key, seen), deepClone(item, seen));
  } else if (value instanceof Set) {
    for (const item of value) copy.add(deepClone(item, seen));
  }

  const keys = ArrayBuffer.isView(value) ? [] : Reflect.ownKeys(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if ('value' in descriptor) descriptor.value = deepClone(descriptor.value, seen);
    Object.defineProperty(copy, key, descriptor); // accessors, flags, symbols, own __proto__
  }
  if (!Object.isExtensible(value)) Object.preventExtensions(copy);
  return copy;
}
```

`lastIndex` отдельно копировать не нужно: это собственное свойство `RegExp`, его переносит общий цикл по дескрипторам. По этой же причине массив сохраняет дыры, `length` и лишние свойства (`arr.extra`). Проверено в Node 26: `copy.self === copy`, общая ссылка `copy.a === copy.b`, ключи `Map` скопированы, `Uint8Array` и `Uint32Array` над одним буфером в копии делят новый буфер, а оригинал не меняется; геттер класса на копии читает её собственные поля; замороженный объект остаётся замороженным, запечатанный — запечатанным; `JSON.parse('{"__proto__": {"admin": true}}')` даёт копию с собственным ключом `__proto__` и прежним прототипом. Ограничения: приватные поля (`TypeError` при обращении), `Error` (см. врезку выше), обёртки примитивов (`new Number(1)` уйдёт в `Object.create` и потеряет слот), глубина около 9000 уровней. Частые ошибки: `seen.set` после рекурсии, `Object.keys` вместо `Reflect.ownKeys`, присваивание вместо `defineProperty`, `new value.constructor()` для обычных объектов (вызывает конструктор с побочными эффектами и без аргументов). Что спросят дальше: обход на явном стеке, `customizer` как в `_.cloneDeepWith`, клон в режиме «только данные» (геттеры — в значения, прототип — `Object.prototype`).

Сложность: O(n) по времени и памяти, n — число узлов графа (плюс размер буферов).
:::

### 4. flatten и unflatten · легко

`flatten({ a: { b: 1, c: [1, { d: 2 }] } })` возвращает `{ 'a.b': 1, 'a.c.0': 1, 'a.c.1.d': 2 }`. Пустые объекты и массивы, `null`, `Date` остаются листьями. `unflatten` восстанавливает структуру и не допускает prototype pollution.

::: details Решение и разбор
```js
const isContainer = (v) =>
  typeof v === 'object' && v !== null &&
  (Array.isArray(v) || [Object.prototype, null].includes(Object.getPrototypeOf(v)));

function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isContainer(value) && Object.keys(value).length > 0) flatten(value, path, out);
    else Object.defineProperty(out, path, { value, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

function unflatten(flat) {
  const out = {};
  for (const [path, value] of Object.entries(flat)) set(out, path.split('.'), value); // set from task 1
  return out;
}
```

`defineProperty` нужен ради ключа `__proto__` верхнего уровня: `out['__proto__'] = value` вызвал бы сеттер. `unflatten` переиспользует `set` из задачи 1, поэтому `{ '__proto__.admin': true }` бросает `TypeError`. Это реальный вектор: так разбирают вложенные query-строки и `FormData`. Проверено в Node 26: `unflatten(flatten(o))` восстанавливает `o` с массивами. Неоднозначность: `{ 'a.b': 1, a: { c: 2 } }` после круга становится `{ a: { b: 1, c: 2 } }`. Ключи с точкой надо экранировать или хранить путь массивом. Что спросят дальше: разделитель как параметр, нотация `a[0].b`, ограничение глубины, циклы (тот же `seen`).

Сложность: O(n · d) по времени, n — число листьев, d — глубина (длина строки пути).
:::

### 5. snake_case ↔ camelCase для ключей · легко

API отдаёт `{ user_id: 1, created_at: Date, tags_list: [{ tag_name: 'x' }] }`. Напишите `mapKeysDeep(value, fn)` и преобразователи `toCamel` и `toSnake`. `Date`, `Map` и экземпляры классов не трогать, `__typename` не ломать.

::: details Решение и разбор
```js
const toCamel = (s) => s.replace(/(?<=[^_])_+([a-z0-9])/gi, (_, c) => c.toUpperCase());
const toSnake = (s) => s.replace(/(?<=[a-z0-9])([A-Z])/g, '_$1').toLowerCase();

function mapKeysDeep(value, fn) {
  if (Array.isArray(value)) return value.map((item) => mapKeysDeep(item, fn));
  if (!isContainer(value)) return value; // Date, Map, class instances stay as they are
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [fn(key), mapKeysDeep(item, fn)]));
}
```

Ретроспективная проверка `(?<=[^_])` оставляет ведущие подчёркивания: `__typename` и `_private_field` → `_privateField`. Проверено в Node 26: `toSnake('userID') === 'user_id'`, `toCamel('address_line_1') === 'addressLine1'`, но обратно получается `address_line1` — круг не тождествен, если в ключах есть цифры. Аббревиатуры склеиваются: `HTMLParser` → `htmlparser`. Коллизия `{ user_id: 1, userId: 2 }` даёт `{ userId: 2 }`: последний побеждает молча. `Object.fromEntries` определяет свойства, поэтому `__proto__` из JSON остаётся собственным ключом и не меняет прототип. Во Vue похожие преобразования делают `camelize` и `hyphenate` для props и событий, с кэшем ([подробнее](./function-utilities.md)). Что спросят дальше: кэш преобразования ключей, типизация (`CamelCase<'user_id'>` на шаблонных строках), обход только на границе API, а не в каждом компоненте.

Сложность: O(n) по времени и памяти, n — суммарный размер ключей и узлов.
:::

## Источники

- [HTML Living Standard — Safe passing of structured data (`structuredClone`)](https://html.spec.whatwg.org/multipage/structured-data.html#safe-passing-of-structured-data)
- [ECMAScript — SameValue](https://tc39.es/ecma262/#sec-samevalue), [SameValueZero](https://tc39.es/ecma262/#sec-samevaluezero), [`Reflect.ownKeys`](https://tc39.es/ecma262/#sec-reflect.ownkeys), [OrdinaryOwnPropertyKeys](https://tc39.es/ecma262/#sec-ordinaryownpropertykeys)
- [ECMAScript — `Object.prototype.__proto__`](https://tc39.es/ecma262/#sec-object.prototype.__proto__)
- [MDN — `structuredClone()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone), [The structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- [MDN — Equality comparisons and sameness](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness)
- [MDN — Prototype pollution](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/Prototype_pollution)
- [Node.js — `util.isDeepStrictEqual`](https://nodejs.org/api/util.html#utilisdeepstrictequalval1-val2-options), [`assert.deepStrictEqual`](https://nodejs.org/api/assert.html#assertdeepstrictequalactual-expected-message), [`--disable-proto`](https://nodejs.org/api/cli.html#--disable-protomode)
- [lodash 4.18.1 — `_.cloneDeep`](https://lodash.com/docs/4.18.1#cloneDeep), [`_.isEqual`](https://lodash.com/docs/4.18.1#isEqual), [`_.get`](https://lodash.com/docs/4.18.1#get), [`_.set`](https://lodash.com/docs/4.18.1#set), [исходный код](https://github.com/lodash/lodash/blob/4.18.1/lodash.js)
- GitHub Advisory Database: [CVE-2019-10744](https://github.com/advisories/GHSA-jf85-cpcp-j695), [CVE-2020-8203](https://github.com/advisories/GHSA-p6mc-m468-83gw), [CVE-2026-2950](https://github.com/advisories/GHSA-f23m-r3pf-42rh)
- [Vue 3.5.45 — `looseEqual.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/shared/src/looseEqual.ts), [`watch.ts` (`traverse`)](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/watch.ts), [`baseHandlers.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/baseHandlers.ts)
- [Vue — Form Input Bindings](https://vuejs.org/guide/essentials/forms.html), [Watchers: Deep Watchers](https://vuejs.org/guide/essentials/watchers.html#deep-watchers)
