---
title: 'Полифилы: методы `Array`, `bind`/`call`/`apply`'
level: ядро
---

# Полифилы: методы `Array`, `bind`/`call`/`apply`

> **Коротко.** Полифил (polyfill) — код, который добавляет в старое окружение недостающий **API** так, чтобы он вёл себя как стандартный. Синтаксис полифилом не добавить: его транспилируют. Хороший полифил повторяет алгоритм спецификации: `ToObject(this)`, длина читается один раз до цикла, дырки пропускаются, проверка колбэка — после чтения длины. И ставится аккуратно: через feature detection и `Object.defineProperty` с `enumerable: false`. На интервью по `map`/`filter`/`reduce`/`flat` и `call`/`apply`/`bind` проверяют знание этих деталей. Отдельно спрашивают, чем самописный `bind` неизбежно отличается от настоящего.

**Связанные темы:** [Функции и `this`](../javascript/functions-and-this.md), [Прототипы и классы](../javascript/prototypes-and-classes.md), [Дескрипторы свойств, Proxy и Reflect](../javascript/property-descriptors-and-proxy.md), [Типы данных и приведение типов](../javascript/types-and-coercion.md), [Итераторы и генераторы](../javascript/iterators-and-generators.md), [Рекурсия и динамическое программирование](../algorithms/recursion-and-dp.md), [CSRF, clickjacking и supply chain](../security/csrf-and-clickjacking.md), [Утилиты промисов: `Promise.all` и компания, пул, retry](./promise-utilities.md)

## Теория

### Полифил, транспиляция, ponyfill

- **Полифил** дописывает в окружение недостающий встроенный API: `Array.prototype.flat`, `Promise.withResolvers`, `structuredClone`. Код пишется так, будто API есть всегда.
- **Транспиляция** переписывает **синтаксис**: `?.`, стрелки, поля классов, `async`/`await`. Новый синтаксис старый парсер не прочитает, и никакой код на старте страницы этого не исправит. Поэтому Babel или esbuild переводят его в старый синтаксис ещё при сборке.
- Часть возможностей требует обоих: `async`/`await` транспилируется в генераторы или конечный автомат, а `Promise` под ним полифилится.
- Часть не делается ни так, ни так. `Proxy` перехватывает **любое** обращение к объекту, а код на ES5 этого не выразит. Поэтому Vue 3, у которого реактивность построена на `Proxy`, не поддерживает IE11. Vue 2 строил реактивность на `Object.defineProperty`, который есть в ES5, и работал в IE9. Отсюда и ограничения Vue 2: он не видел добавление новых свойств и запись по индексу массива.
- **Ponyfill** — та же реализация, но как обычная функция, без патча глобальных объектов: `import flat from 'core-js-pure/actual/array/flat'`. Так делают библиотеки, чтобы не менять окружение приложения.

Промышленный набор — **core-js** (сверено 2026-11-13: версия 3.51.0). Его подключает Babel (`@babel/preset-env` с `useBuiltIns: 'usage'`) или Vite через `@vitejs/plugin-legacy`. Тогда в бандл попадают только полифилы для API, которые реально используются в коде и которых нет в целевых браузерах из `browserslist`. Подробно о сборке — в разделе «Инструменты».

> [!WARNING]
> Полифил с чужого CDN — чужой код в вашем origin. polyfill.io в 2024 году сменил владельца и начал перенаправлять пользователей более 100 000 сайтов. SRI его не спасал: сервис генерировал ответ под `User-Agent`, и хэш не зафиксировать. Разбор — в теме [CSRF, clickjacking и supply chain](../security/csrf-and-clickjacking.md). Полифилы кладут в свой бандл.

### Как правильно поставить полифил

```js
if (!Array.prototype.flat) {
  Object.defineProperty(Array.prototype, 'flat', {
    value: flat, writable: true, enumerable: false, configurable: true,
  });
}
```

1. **Feature detection**, а не проверка браузера по `User-Agent`. Если нативный метод есть, его не трогают: он быстрее и точнее.
2. **`enumerable: false`**, как у встроенных методов. Простое присваивание `Array.prototype.flat = …` создаёт **перечисляемое** свойство, и оно всплывёт в каждом `for...in` по любому массиву. Проверено в Node 26: после `Array.prototype.myMap = …` цикл `for (const k in [10, 20])` выдаёт `'0', '1', 'myMap'`.
3. **Сама функция — как у встроенной.** Встроенные методы не конструкторы: `new [].map()` даёт `TypeError`. Метод из литерала объекта (`{ flat(depth) {} }.flat`) тоже не конструктор, и у него правильное `name`. `length` совпадает с нативным: у `map` — 1, у `reduce` — 1, у `flat` — 0. Необязательные параметры дают через значение по умолчанию (`thisArg = undefined`) или rest: `length` считает параметры только до первого из них.

### SmooshGate: почему библиотеки не патчат прототипы

В 2018 году в Chrome 69 должен был выйти `Array.prototype.flatten`. MooTools давно определял свой нестандартный `flatten` присваиванием и копировал методы массива в свой класс `Elements` циклом `for (var key in Array.prototype)`. Пока нативного `flatten` не было, свойство MooTools было перечисляемым, и копирование работало. С нативным методом присваивание **перезаписало значение, но сохранило атрибуты** старого свойства, то есть `enumerable: false`. `for...in` перестал видеть `flatten`, у `Elements` он пропал, и старые сайты сломались. Проверено в Node 26: после `Array.prototype.flat = …` дескриптор по-прежнему `enumerable: false`. TC39 переименовал метод в `flat` (шутливое предложение было `smoosh`). Это не первый случай: в 2014 году `Array.prototype.contains` по той же причине — несовместимость с существующими сайтами — переименовали в `includes`.

Вывод: библиотека, которая патчит встроенные прототипы своим нестандартным методом, занимает имя, которое может понадобиться стандарту. Стандарт этого не учитывает и подстраивается сам. Приложение может полифилить **стандартный** API, а библиотека должна пользоваться ponyfill.

### Методы массива по спецификации

У `map`, `filter`, `forEach`, `some`, `every`, `reduce` общий каркас (ECMAScript, 23.1.3):

1. `O = ToObject(this)`. На `null`/`undefined` — `TypeError`, примитив упаковывается: `[].map.call('ab', f)` работает. Методы **generic**: они работают с любым array-like (`{ length: 2, 0: 'a', 1: 'b' }`), а не только с массивами.
2. `len = LengthOfArrayLike(O)` — **один раз, до цикла**. Элементы, добавленные колбэком, не посещаются. Удалённые до посещения — пропускаются. Изменённые — видны с новым значением.
3. Только **после** этого — проверка `IsCallable(callback)`. Проверено в Node 26: геттер `length` вызывается раньше, чем бросается `TypeError` на колбэк-не-функцию.
4. Цикл по `k` от 0 до `len`. Для каждого индекса — `HasProperty(O, k)`: **дырки пропускаются**, колбэк на них не вызывается. Потом `Get` и вызов `callback.call(thisArg, value, k, O)`.

Различия:

- **`map`** создаёт результат длины `len` (`ArraySpeciesCreate(O, len)`), поэтому дырки на тех же местах остаются дырками.
- **`filter`** создаёт пустой результат и дописывает в него по счётчику `to`. Кладётся значение, прочитанное **до** вызова колбэка, даже если колбэк потом поменял `O[k]`.
- **`reduce`** вызывает колбэк с `this = undefined` и без `thisArg`. Без начального значения аккумулятором становится первый **существующий** элемент. Если существующих нет — `TypeError` («Reduce of empty array with no initial value»). Это касается и `[]`, и `[, ,]`. Отсутствие аргумента и `undefined` — разные случаи: `[].reduce(f, undefined)` вернёт `undefined` без ошибки.
- **`flat(depth)`**: глубина по умолчанию 1, через `ToIntegerOrInfinity`, поэтому `flat(1.9)` — это `flat(1)`, `flat(NaN)` — `flat(0)`, отрицательные — 0. Разворачиваются только настоящие массивы (`IsArray`, он видит массив и сквозь `Proxy`), array-like остаются элементами. Дырки выбрасываются на всех уровнях. `Infinity - 1` даёт `Infinity`, поэтому `flat(Infinity)` идёт до конца.

> [!NOTE]
> `ArraySpeciesCreate` читает `O.constructor[Symbol.species]`, поэтому `map` и `filter` на подклассе `Array` возвращают подкласс. В задачах ниже результат — обычный массив, и это нужно оговорить на интервью. Species — тот же механизм, что у `Promise.prototype.then` (см. [Утилиты промисов](./promise-utilities.md)).

### Vue: методы массива на реактивном массиве

Generic-алгоритм на `Proxy` дорог: для каждого индекса — ловушки `has` и `get`. Проверено в Node 26: `Array.prototype.map` на `Proxy` над `[1, 2, 3]` даёт `get length, get constructor, has 0, get 0, has 1, get 1, has 2, get 2`. У реактивного массива каждое такое чтение — ещё и `track`. Vue 3.5 перехватывает итерирующие методы (`arrayInstrumentations` в `@vue/reactivity`, сверено по 3.5.45). Он вызывает нативный метод **на сыром массиве**, регистрирует одну зависимость на итерацию целиком, а колбэку отдаёт элемент, обёрнутый в `reactive`, и сам прокси третьим аргументом. Поэтому в `computed(() => list.map(…))` элементы остаются реактивными, а `push` перезапускает эффект.

### `call`, `apply`, `bind`

- `call(thisArg, ...args)` и `apply(thisArg, argArray)` вызывают функцию с заданным `this`. `apply` берёт аргументы через `CreateListFromArrayLike`. Примитив вместо массива — `TypeError`, `null`/`undefined` — вызов без аргументов. Читаются `length` и индексы, а **не итератор**: `Math.max.apply(null, new Set([1, 2]))` даёт `-Infinity`, потому что у `Set` нет `length`. Дырки становятся `undefined`.
- `bind` создаёт **bound function exotic object** (`BoundFunctionCreate`): слоты `[[BoundTargetFunction]]`, `[[BoundThis]]`, `[[BoundArguments]]`, у функции `name = 'bound ' + name`, `length = max(0, length цели − число привязанных аргументов)`. Свойства `prototype` у неё **нет**. `[[Construct]]` есть, только если он есть у цели. При `new` связанный `this` игнорируется, а если `newTarget` — сама bound function, вместо него подставляется цель. Поэтому `new B() instanceof Target`. А `instanceof B` работает, потому что `OrdinaryHasInstance` для bound function проверяет цель. Модель `this` и поведение повторного `bind` — в теме [Функции и `this`](../javascript/functions-and-this.md).

Самописные версии повторяют это лишь частично. Почему — в задачах 4 и 5.

## Примеры

### Чем наивный `map` отличается от нативного

```js
Array.prototype.myMap = function (cb) {
  const res = [];
  for (let i = 0; i < this.length; i++) res.push(cb(this[i], i));
  return res;
};

[1, , 3].myMap((x) => x); // [1, undefined, 3] — native map: [1, <empty>, 3]

const a = [1, 2];
a.myMap((x) => { if (a.length < 5) a.push(0); return x; }).length; // 5 — native map: 2

for (const k in [10, 20]) console.log(k); // '0', '1', 'myMap'
```

### Тонкость `reduce`: нет аргумента и `undefined` — разные вызовы

```js
[].reduce((a, b) => a + b);            // TypeError: Reduce of empty array with no initial value
[, ,].reduce((a, b) => a + b);         // TypeError: only holes, nothing to start from
[].reduce((a, b) => a + b, undefined); // undefined — the initial value is present
[, 5].reduce(() => { throw 1; });      // 5 — single element, callback is never called
```

### `bind` и `new`

```js
function Point(x, y) { this.x = x; this.y = y; }
const P = Point.bind({ ignored: true }, 1);

const p = new P(2);               // { x: 1, y: 2 } — bound this is ignored
p instanceof Point;               // true
p instanceof P;                   // true — checked against the target
Object.hasOwn(P, 'prototype');    // false
[P.name, P.length];               // ['bound Point', 1]

class A {}
class B extends A.bind(null) {}   // TypeError: Class extends value does not have valid prototype property undefined
```

## Вопросы с интервью

::: details Чем полифил отличается от транспиляции и что нельзя ни то, ни другое
Полифил добавляет недостающий API во время выполнения: метод, конструктор, глобальную функцию. Транспиляция при сборке переписывает синтаксис, который старый парсер не поймёт: `?.`, поля классов, `async`/`await`. Некоторым возможностям нужно оба (async-функции — транспиляция плюс полифил `Promise`). Некоторые не воспроизводятся вовсе: `Proxy`, `WeakRef`, `FinalizationRegistry`, хвостовые вызовы. Приватные поля `#x`, наоборот, транспилируются: Babel хранит их в `WeakMap`. Именно из-за `Proxy` Vue 3 не работает в IE11. Ponyfill — та же реализация как отдельная функция, без патча глобалов: им пользуются библиотеки.
:::

::: details Почему полифил ставят через defineProperty, а не присваиванием
Присваивание создаёт перечисляемое свойство, и метод появляется в `for...in` по любому массиву. Встроенные методы неперечисляемые. Кроме того, полифил ставят только при отсутствии нативного (feature detection), а сама функция должна быть похожа на встроенную: не конструктор, правильные `name` и `length`. Поэтому её берут из сокращённого метода объекта. Обратная сторона той же механики — SmooshGate: присваивание поверх нативного неперечисляемого метода сохраняет `enumerable: false`. MooTools копировал методы через `for...in`, и после выхода нативного `flatten` его копия пропала, поэтому стандарт переименовал метод в `flat`.
:::

::: details Что увидит колбэк map, если массив меняется во время обхода
Длина фиксируется до первого вызова, поэтому добавленные в конец элементы не посещаются. Каждый индекс проверяется через `HasProperty` прямо перед посещением: удалённый до этого элемент пропускается, изменённый виден с новым значением. Результат `map` имеет исходную длину, а на месте пропущенных элементов остаются дырки. У `filter` в результат попадает значение, прочитанное до вызова колбэка.
:::

::: details Почему пустой массив без начального значения в reduce — ошибка, а не undefined
Без начального значения аккумулятор берётся из первого существующего элемента, а в пустом массиве (или массиве из одних дырок) его нет. Вернуть `undefined` было бы неправильно: для суммы ожидался бы 0, для произведения — 1, для объединения массивов — `[]`. Нейтральный элемент знает только вызывающий. Поэтому начальное значение стоит передавать всегда, кроме случаев, когда массив гарантированно непуст. Заодно колбэк будет видеть первый элемент: без начального значения на массиве из одного элемента колбэк не вызывается вовсе.
:::

::: details Как реализовать call без call и apply и что в такой реализации неизбежно неверно
Функцию временно кладут свойством на объект `this` под уникальным ключом `Symbol` и вызывают как метод, потом свойство удаляют. Неточности три. Первая: ключ нужно куда-то положить, поэтому примитив приходится упаковывать, а `null`/`undefined` заменять на `globalThis`. Это семантика нестрогой функции, а strict-функция у нативного `call` получила бы `5` и `undefined` как есть. Вторая: на замороженном или нерасширяемом объекте запись бросает `TypeError`. Третья: ключ виден функции через `Reflect.ownKeys(this)`, ловушкам `Proxy` и геттерам. Точно повторить `call` без `Reflect.apply` нельзя, и это ожидаемый ответ на «что не так в вашей реализации».
:::

::: details Чем самописный bind отличается от нативного
Нативный `bind` создаёт экзотический объект: у него нет свойства `prototype`, `[[Construct]]` есть ровно тогда, когда он есть у цели, а `instanceof` смотрит на цель. Самописный возвращает обычную функцию. Она всегда конструктор, у неё есть свой `prototype`, а проверку «цель не конструктор» приходится делать вручную. Подмена `newTarget` повторяется через `new.target` и `Reflect.construct`, а `instanceof` — присваиванием `bound.prototype = target.prototype`. Из-за этого появляется видимое отличие: от самописной bound-функции класса можно унаследоваться, от нативной — нет (`extends` требует `prototype`). `name` и `length` выставляются через `defineProperty`. Исторический полифил с MDN без ES2015 проверял `this instanceof fBound` и подставлял промежуточный конструктор `fNOP`.
:::

::: details Зачем нужен flat с глубиной и как его реализовать без рекурсии
`flat()` разворачивает один уровень, `flat(Infinity)` — все. Рекурсивная реализация падает на глубокой вложенности. В Node 26 и нативный `flat(Infinity)`, и рекурсивный полифил на массиве глубины 10⁵ дают `RangeError: Maximum call stack size exceeded`. Итеративная версия держит явный стек кадров `{ source, index, level }` и не зависит от стека вызовов (подробно о переводе рекурсии в стек — в теме [Рекурсия и динамическое программирование](../algorithms/recursion-and-dp.md)). Порядок элементов сохраняется: кадр продолжает обход с сохранённого индекса.
:::

## Задачи

### 1. map и filter по спецификации · легко

Реализуйте `map` и `filter` как методы для `Array.prototype`: generic по `this`, длина фиксируется до цикла, дырки пропускаются, `thisArg`, `TypeError` на `null`/`undefined` и на колбэк-не-функцию, `length` методов — 1.

::: details Решение и разбор
```js
function toObject(value, method) {
  if (value == null) throw new TypeError(`Array.prototype.${method} called on null or undefined`);
  return Object(value);
}

function lengthOfArrayLike(obj) {
  const len = Math.trunc(Number(obj.length)) || 0; // ToLength: NaN -> 0
  return Math.min(Math.max(len, 0), Number.MAX_SAFE_INTEGER);
}

const methods = {
  map(callback, thisArg = undefined) { // the default value keeps map.length === 1
    const obj = toObject(this, 'map');
    const len = lengthOfArrayLike(obj); // fixed before the loop
    if (typeof callback !== 'function') throw new TypeError(`${String(callback)} is not a function`);
    const result = new Array(len); // holes stay holes
    for (let k = 0; k < len; k++) {
      if (k in obj) result[k] = callback.call(thisArg, obj[k], k, obj);
    }
    return result;
  },

  filter(callback, thisArg = undefined) {
    const obj = toObject(this, 'filter');
    const len = lengthOfArrayLike(obj);
    if (typeof callback !== 'function') throw new TypeError(`${String(callback)} is not a function`);
    const result = [];
    for (let k = 0; k < len; k++) {
      if (!(k in obj)) continue;
      const value = obj[k]; // read once: the callback may change obj[k]
      if (callback.call(thisArg, value, k, obj)) result.push(value);
    }
    return result;
  },
};
```

`k in obj` — это `HasProperty`: он видит и унаследованные индексы, как и спецификация. `String(callback)` вместо шаблонной строки с `callback` нужен для `Symbol`: неявное приведение символа к строке бросает. Проверено в Node 26 против нативных методов: дырки, array-like, строка, `null`, колбэк-не-функция, `thisArg`, изменение массива во время обхода (добавление, удаление, запись), порядок «длина — потом проверка колбэка». Результаты и типы ошибок совпали. Отличие одно: результат — всегда `Array`, без `Symbol.species`.

Сложность: O(n) по времени, O(n) по памяти на результат.
:::

### 2. reduce · легко

Реализуйте `reduce(callback, initialValue?)`. Различайте «начальное значение не передано» и «передан `undefined`». Без начального значения стартуйте с первого существующего элемента, на пустом массиве и массиве из одних дырок бросайте `TypeError`.

::: details Решение и разбор
```js
const methods = {
  reduce(callback, ...rest) { // rest keeps reduce.length === 1 and tells "absent" from undefined
    const obj = toObject(this, 'reduce');
    const len = lengthOfArrayLike(obj);
    if (typeof callback !== 'function') throw new TypeError(`${String(callback)} is not a function`);
    let k = 0;
    let acc;
    if (rest.length > 0) {
      acc = rest[0];
    } else {
      while (k < len && !(k in obj)) k++; // skip leading holes
      if (k >= len) throw new TypeError('Reduce of empty array with no initial value');
      acc = obj[k++];
    }
    for (; k < len; k++) {
      if (k in obj) acc = callback(acc, obj[k], k, obj); // this is undefined, no thisArg
    }
    return acc;
  },
};
```

Типичные ошибки кандидатов. Проверка `initialValue === undefined` ломает `reduce(f, undefined)`. Старт с `obj[0]` вместо первого существующего элемента ломает `[, 1, 2]`. Ещё забывают, что колбэк получает индекс и сам массив. Проверено в Node 26: `[]`, `[, ,]`, `[, 5]` (колбэк не вызывается), `reduce(f, undefined)` на пустом и непустом массиве, индексы при дырках, `this` в колбэке — всё совпало с нативным. `reduceRight` — тот же код с обходом от `len - 1` вниз.

Сложность: O(n) по времени, O(1) по памяти.
:::

### 3. flat с глубиной · средне

Реализуйте `flat(depth = 1)` по спецификации: `ToIntegerOrInfinity` для глубины, отрицательная — 0, разворачиваются только массивы, дырки выбрасываются. Затем — итеративная версия, которая не падает на вложенности 10⁵.

::: details Решение и разбор
```js
const methods = {
  flat(depth = undefined) { // flat.length === 0
    const obj = toObject(this, 'flat');
    let d = depth === undefined ? 1 : Math.trunc(Number(depth)) || 0; // NaN -> 0, Infinity stays
    if (d < 0) d = 0;
    const result = [];
    const walk = (source, level) => {
      const len = lengthOfArrayLike(source);
      for (let k = 0; k < len; k++) {
        if (!(k in source)) continue; // holes are dropped
        const el = source[k];
        if (level > 0 && Array.isArray(el)) walk(el, level - 1); // Infinity - 1 === Infinity
        else result.push(el);
      }
    };
    walk(obj, d);
    return result;
  },
};

function flatIterative(arr, depth = 1) {
  const result = [];
  const stack = [{ source: arr, index: 0, level: depth }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.source.length) {
      stack.pop();
      continue;
    }
    const k = frame.index++;
    if (!(k in frame.source)) continue;
    const el = frame.source[k];
    if (frame.level > 0 && Array.isArray(el)) stack.push({ source: el, index: 0, level: frame.level - 1 });
    else result.push(el);
  }
  return result;
}
```

`Array.isArray`, а не `instanceof Array`: он видит массивы из других realm (iframe) и массив сквозь `Proxy`, как `IsArray` в спецификации. Array-like `{ length: 1, 0: 'x' }` и строки не разворачиваются. Проверено в Node 26 на вложенном массиве с дырками, пустым массивом, строкой и array-like при глубине `undefined`, 0, 1, 2, `Infinity`, −1, `NaN`, `'2'`, 1.9: рекурсивная версия совпала с нативной во всех случаях, итеративная — на целых глубинах и `Infinity`. На массиве глубины 10⁵ нативный `flat(Infinity)` и рекурсивная версия бросают `RangeError`, итеративная возвращает `[1]`.

Что спросят дальше. **`flatMap`**: вызвать колбэк и развернуть результат ровно на один уровень. **Генератор**: `function* flatten(arr, depth)` с `yield*`. Он ленивый, но рекурсивный `yield*` стоит O(n·h) (см. [Деревья и графы](../algorithms/trees-and-graphs.md)). **Циклы**: на массиве, который содержит сам себя, `flat(Infinity)` нативный и рекурсивный варианты падают с `RangeError` (проверено в Node 26), а итеративный зацикливается и съедает память. Защищаются множеством `Set` из массивов на текущем пути.

Сложность: O(n) по времени, где n — число всех элементов на всех уровнях; память — O(n) на результат плюс O(h) на стек, h — глубина.
:::

### 4. call и apply · средне

Реализуйте `myCall(thisArg, ...args)` и `myApply(thisArg, argArray)` без использования `call`, `apply`, `bind` и `Reflect.apply`. `myApply` должен принимать array-like, бросать `TypeError` на примитив и вызывать без аргументов при `null`/`undefined`. Назовите, чем ваша реализация отличается от нативной.

::: details Решение и разбор
```js
const fns = {
  myCall(thisArg, ...args) {
    const fn = this;
    if (typeof fn !== 'function') throw new TypeError('myCall: target is not a function');
    const ctx = thisArg == null ? globalThis : Object(thisArg); // sloppy-mode semantics only
    const key = Symbol('fn'); // cannot clash with existing keys
    ctx[key] = fn;
    try {
      return ctx[key](...args); // method call: this === ctx
    } finally {
      delete ctx[key]; // also when fn throws
    }
  },

  myApply(thisArg, argArray) {
    const fn = this;
    if (typeof fn !== 'function') throw new TypeError('myApply: target is not a function');
    if (argArray == null) return fns.myCall.call(fn, thisArg);
    if (typeof argArray !== 'object' && typeof argArray !== 'function') {
      throw new TypeError('CreateListFromArrayLike called on non-object');
    }
    const len = lengthOfArrayLike(argArray);
    const args = [];
    for (let i = 0; i < len; i++) args.push(argArray[i]); // indices, not the iterator; holes -> undefined
    return fns.myCall.call(fn, thisArg, ...args);
  },
};
```

> В `myApply` вызов `fns.myCall.call(...)` — только для краткости примера. Без встроенного `call` там тоже ставится метод на функцию: `fn[myCallKey] = fns.myCall` и `fn[myCallKey](thisArg, ...args)`.

`Array.from(argArray)` вместо цикла был бы ошибкой: он использует итератор, если тот есть, а `apply` — только `length` и индексы. Проверено в Node 26 сравнением с нативными:

- `Math.max` через `myApply` с массивом и с `{ length: 2, 0: 1, 1: 9 }` даёт 5 и 9; с `new Set([1, 2])` оба варианта дают `-Infinity`; со строкой оба бросают `TypeError: CreateListFromArrayLike called on non-object`; дырки становятся `undefined`.
- **Отличие 1**: strict-функция через нативный `call(5)` получает число, через `myCall` — объект `Number`; при `call(undefined)` — `undefined` против `globalThis`.
- **Отличие 2**: `myCall` на `Object.freeze({ x: 1 })` бросает `TypeError: Cannot add property Symbol(fn), object is not extensible`, нативный возвращает 1.
- **Отличие 3**: функция видит временный ключ: `Reflect.ownKeys(this)` даёт `['a', 'Symbol(fn)']`.

Так выглядели полифилы эпохи ES3. До `Symbol` ключ делали случайной строкой и проверяли, что его нет на объекте.

Сложность: O(n) по числу аргументов.
:::

### 5. bind с частичным применением и new · сложно

Реализуйте `myBind(thisArg, ...boundArgs)`. Частичное применение аргументов, корректные `name` и `length`, повторный `bind` не меняет `this`. При `new` связанный `this` игнорируется, объект получает прототип цели, `instanceof` работает и для цели, и для bound-функции. `new` от bound-стрелки бросает `TypeError`. Перечислите оставшиеся отличия от нативного `bind`.

::: details Решение и разбор
```js
function isConstructor(value) {
  try {
    Reflect.construct(String, [], value); // throws if value has no [[Construct]]; value itself is not called
    return true;
  } catch {
    return false;
  }
}

const { myBind } = {
  myBind(thisArg, ...boundArgs) {
    const target = this;
    if (typeof target !== 'function') throw new TypeError('Bind must be called on a function');

    const bound = function (...args) {
      if (new.target === undefined) return Reflect.apply(target, thisArg, [...boundArgs, ...args]);
      if (!isConstructor(target)) throw new TypeError(`${target.name || 'anonymous'} is not a constructor`);
      const newTarget = new.target === bound ? target : new.target; // as in the spec's [[Construct]]
      return Reflect.construct(target, [...boundArgs, ...args], newTarget);
    };

    let length = 0;
    if (Object.hasOwn(target, 'length') && typeof target.length === 'number') {
      length = Math.max((Math.trunc(target.length) || 0) - boundArgs.length, 0); // Infinity stays Infinity
    }
    Object.defineProperty(bound, 'length', { value: length, configurable: true });
    Object.defineProperty(bound, 'name', { value: `bound ${typeof target.name === 'string' ? target.name : ''}`, configurable: true });
    bound.prototype = target.prototype; // so that `x instanceof bound` checks the target's prototype
    return bound;
  },
};
```

Как это работает:

- **Обычный вызов**: `Reflect.apply` с сохранённым `thisArg` — переданный `this` игнорируется. Поэтому повторный `myBind` не меняет `this`, а аргументы накапливаются.
- **`new`**: `new.target` отличает его от вызова. `Reflect.construct(target, args, newTarget)` создаёт объект с прототипом `newTarget.prototype`. Если `new` вызван на самой bound-функции, `newTarget` подменяется на цель — ровно шаг 5 bound `[[Construct]]`. Если bound-функцию унаследовали (`class S extends B`), `new.target` — это `S`, и подменять не нужно.
- **`isConstructor`**: `Reflect.construct(String, [], value)` бросает `TypeError`, если `value` не конструктор, и при этом **не вызывает** `value`. Известный приём без побочных эффектов.
- **Класс без `new`**: `Reflect.apply` бросает тот же `TypeError`, что и нативный bound-класс.

Проверено в Node 26 против нативного `bind` на `Point.bind({ t: 1 }, 1)`: `name` — `'bound Point'`, `length` — 1, `new B(2)` даёт `{ x: 1, y: 2 }`, `instanceof Point`, `instanceof B` и прототип совпали. Совпали двойной `bind` (`this` от первого, аргументы `a, b, c`, имя `'bound bound f'`), `length` для `Infinity` и `NaN` у цели, `TypeError` на `new` от bound-стрелки и на вызов bound-класса без `new`.

Оставшиеся отличия:

1. У `myBind`-функции есть собственное свойство `prototype` (`Object.hasOwn(B, 'prototype')` — `true`, у нативной — `false`). Обычная функция-конструктор создаётся с неудаляемым `prototype`.
2. Она всегда конструктор с точки зрения `isConstructor`, даже для стрелки: ошибка бросается изнутри, а не самим `new`. Сообщение тоже другое.
3. От неё можно унаследоваться: `class S extends myBind.call(A, null)` работает, а `class S extends A.bind(null)` бросает `TypeError: Class extends value does not have valid prototype property undefined`.
4. Лишний кадр в стеке вызовов и стоимость rest/spread на каждый вызов.

Точнее всего нативный `bind` повторяет `Proxy` с ловушками `apply` и `construct`: у прокси `[[Construct]]` есть ровно тогда, когда он есть у цели. Но `name`, `length` и `prototype` прокси отдаёт от цели, а не свои, и `Proxy` сам не полифилится.

Сложность: O(k + m) на вызов, где k — привязанные аргументы, m — переданные.
:::

### 6. Код-ревью полифила · средне

Коллега добавил в проект полифил. Найдите все отличия от нативного `map` и проблемы установки, исправьте.

```js
Array.prototype.map = function (cb) {
  let res = [];
  for (let i = 0; i < this.length; i++) {
    res.push(cb(this[i], i));
  }
  return res;
};
```

::: details Решение и разбор
Проблемы установки:

1. **Нет feature detection**: нативный `map` перезаписывается медленной и неточной версией во всех браузерах.
2. **Присваивание** поверх нативного метода сохранит `enumerable: false`, но в окружении без `map` создаст перечисляемое свойство, и `for...in` по массивам его покажет. Нужен `Object.defineProperty`.
3. **Функция — конструктор** (`new [].map()` перестанет бросать), у неё `name` равно `''`.

Отличия от спецификации:

4. **`this.length` читается на каждой итерации**: если колбэк делает `push`, цикл не закончится или пройдёт лишние элементы. Проверено в Node 26: на `[1, 2]` с `push` в колбэке результат длины 5, у нативного — 2.
5. **Дырки**: колбэк вызывается на них с `undefined`, и результат становится плотным: `[1, undefined, 3]` вместо `[1, <empty>, 3]`.
6. **`push` вместо записи по индексу** — следствие 5: индексы результата сдвинулись бы, если бы дырки пропускались.
7. **Нет `thisArg`** и третьего аргумента колбэка (сам массив).
8. **Нет проверок `this` и колбэка.** Функция нестрогая, поэтому `[].map.call(null, f)` получает `this = globalThis`, у которого нет `length`, и молча возвращает `[]` (проверено в Node 26). Нативный бросает `TypeError`. Колбэк-не-функция бросает только на первом элементе, а на пустом массиве — никогда: `[].map(5)` вернёт `[]`.

Исправление — задача 1 плюс установка из раздела «Как правильно поставить полифил»:

```js
if (typeof Array.prototype.map !== 'function') {
  Object.defineProperty(Array.prototype, 'map', {
    value: methods.map, writable: true, enumerable: false, configurable: true,
  });
}
```

`methods.map` взят из литерала объекта, поэтому не конструктор и называется `'map'`. На интервью сильный ответ — сгруппировать пункты: установка, контракт (длина, дырки, аргументы), ошибки. И сказать, что в реальном проекте этот файл удаляют: `map` есть везде с ES5, а нужные полифилы подставляет core-js.
:::

## Источники

- [ECMAScript — `Array.prototype.map`](https://tc39.es/ecma262/#sec-array.prototype.map), [`filter`](https://tc39.es/ecma262/#sec-array.prototype.filter), [`reduce`](https://tc39.es/ecma262/#sec-array.prototype.reduce), [`flat`](https://tc39.es/ecma262/#sec-array.prototype.flat) и [`FlattenIntoArray`](https://tc39.es/ecma262/#sec-flattenintoarray), [`ArraySpeciesCreate`](https://tc39.es/ecma262/#sec-arrayspeciescreate)
- [ECMAScript — `Function.prototype.call`](https://tc39.es/ecma262/#sec-function.prototype.call), [`apply`](https://tc39.es/ecma262/#sec-function.prototype.apply), [`bind`](https://tc39.es/ecma262/#sec-function.prototype.bind), [`CreateListFromArrayLike`](https://tc39.es/ecma262/#sec-createlistfromarraylike)
- [ECMAScript — Bound Function Exotic Objects и `BoundFunctionCreate`](https://tc39.es/ecma262/#sec-bound-function-exotic-objects)
- [MDN — `Array.prototype.map()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map), [`reduce()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce), [`flat()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/flat), [разреженные массивы](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Indexed_collections#sparse_arrays)
- [MDN — `Function.prototype.bind()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/bind), [`call()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/call), [`apply()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/apply)
- [MDN — Polyfill (глоссарий)](https://developer.mozilla.org/en-US/docs/Glossary/Polyfill)
- [Mathias Bynens — #SmooshGate FAQ](https://developer.chrome.com/blog/smooshgate)
- [core-js](https://github.com/zloirock/core-js) и [`@vitejs/plugin-legacy`](https://github.com/vitejs/vite/tree/main/packages/plugin-legacy)
- [Vue — исходники `arrayInstrumentations` (`@vue/reactivity`, 3.5)](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/arrayInstrumentations.ts)
- [Vue — поддержка браузеров](https://vuejs.org/about/faq#what-browsers-does-vue-support)
