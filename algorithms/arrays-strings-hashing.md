---
title: Массивы, строки и хеш-таблицы
level: ядро
---

# Массивы, строки и хеш-таблицы

> **Коротко.** Большинство задач на массивы и строки решаются за один проход одним из четырёх приёмов: хеш-таблица («что я уже видел»), два указателя, скользящее окно и префиксные суммы. Наивный вложенный цикл превращается в O(n). В JavaScript хеш-таблица — это `Map`/`Set`: в отличие от объекта у них нет ключей-прототипов, ключи любого типа и честный порядок вставки. Строка в JS — последовательность UTF-16 code units: `length` и индекс считают не символы, поэтому эмодзи и буквы с диакритикой ломают наивные `split('')`, `reverse` и `slice`.

**Связанные темы:** [Оценка сложности](./complexity.md), [Типы данных и приведение типов](../javascript/types-and-coercion.md), [Итераторы и генераторы](../javascript/iterators-and-generators.md), [Прототипы и классы](../javascript/prototypes-and-classes.md), [Функциональные приёмы и иммутабельность](../javascript/functional-programming.md), [Память и сборка мусора](../javascript/memory-and-gc.md), [Стеки и очереди](./stacks-and-queues.md)

## Теория

### Четыре паттерна одного прохода

Почти все «простые» задачи на интервью проверяют, увидите ли вы, как убрать внутренний цикл. Узнаются они по условию:

| Паттерн | Сигнал в условии | Что хранится | Типичная задача |
| --- | --- | --- | --- |
| Хеш-таблица | «найти пару / дубликат / встречалось ли» | `Map`/`Set` увиденного | two sum, первый неповторяющийся символ |
| Подсчёт частот | «анаграмма», «перестановка», «самый частый» | `Map` символ → счётчик | анаграммы, top-k слов |
| Два указателя | отсортированный вход, палиндром, «слить», «развернуть на месте» | два индекса | two sum на отсортированном, палиндром |
| Скользящее окно | «самая длинная / короткая **непрерывная** подстрока (подмассив), где…» | границы окна + состояние окна | подстрока без повторов, минимальное окно |
| Префиксные суммы | «сумма на отрезке», много запросов, отрицательные числа | `prefix[i]` или `Map` сумм | число подмассивов с суммой k |

**Хеш-таблица** меняет время на память: вместо поиска по массиву за O(n) — проверка в `Set` за O(1) в среднем. Вложенный цикл O(n²) становится проходом O(n) с O(n) памяти.

**Два указателя** работают, когда по сравнению можно решить, какой указатель двигать. На отсортированном массиве сумма `a[l] + a[r]` меньше цели — значит, `a[l]` не войдёт ни в одну пару с меньшими `r`, и его можно отбросить. Каждый шаг выбрасывает один элемент: O(n) времени, O(1) памяти.

**Скользящее окно** — частный случай двух указателей для непрерывных отрезков. Правая граница расширяет окно, левая сжимает его, пока условие нарушено. Каждый индекс входит в окно и выходит из него не больше одного раза, поэтому вложенный `while` даёт O(n), а не O(n²). Условие работает, если оно **монотонно**: сжатие окна не может сделать «плохое» окно ещё хуже. Для «сумма ≥ k» на положительных числах это так, а с отрицательными — нет. Там нужны префиксные суммы.

**Префиксные суммы**: `prefix[i]` — сумма первых i элементов, тогда сумма отрезка `[l, r)` равна `prefix[r] − prefix[l]` за O(1). Препроцессинг — O(n). Если вместо массива префиксов хранить `Map` «сумма → сколько раз встречалась», то вопрос «сколько отрезков с суммой k заканчивается здесь» превращается в поиск `sum − k` в таблице (см. задачу 4).

### Как устроена хеш-таблица

Хеш-функция превращает ключ в номер корзины (bucket), запись кладётся туда. Коллизии — несколько ключей в одной корзине — разрешаются цепочками или открытой адресацией. При заполнении таблица перестраивается с увеличением (rehash), и это амортизированно O(1) на вставку, как рост массива ([подробнее](./complexity.md)). Поэтому `get`/`set`/`has` — O(1) **в среднем**, а при массовых коллизиях — O(n).

> [!WARNING]
> Спецификация ECMAScript требует от `Map` и `Set` только сублинейного доступа в среднем и **порядка вставки** при обходе. В V8 они устроены как детерминированная хеш-таблица (OrderedHashTable): записи лежат в массиве по порядку вставки, а корзины хранят цепочки индексов. Поэтому обход идёт в порядке вставки, а удалённая запись оставляет «дырку» до следующей перестройки.

### `Map` против объекта

Объект тоже работает как словарь, но он не для этого спроектирован:

| | Объект `{}` | `Object.create(null)` | `Map` |
| --- | --- | --- | --- |
| Типы ключей | строки и символы, остальное приводится к строке | так же | любые, сравнение по SameValueZero |
| Унаследованные ключи | `constructor`, `toString`, `__proto__`… | нет | нет |
| Порядок обхода | целочисленные ключи по возрастанию, затем строки по вставке, затем символы | так же | порядок вставки |
| Размер | `Object.keys(o).length` — O(n) | O(n) | `size` — O(1) |
| Частые удаления | `delete` переводит объект в медленный словарный режим | так же | рассчитан на это |
| JSON | сериализуется напрямую | напрямую | нужен `Object.fromEntries` |

**Ключи-прототипы.** Частотный словарь на `{}` ломается на «неудачных» словах:

```js
const count = {};
for (const w of ['constructor', 'a', 'a']) count[w] = (count[w] || 0) + 1;
count.constructor; // 'function Object() { [native code] }1'
```

`count['constructor']` нашёлся в `Object.prototype`, и `+ 1` склеил функцию со строкой. А `count['__proto__'] = 1` вызывает **сеттер** прототипа: число он игнорирует, и ключ просто не появится. Если ключи приходят от пользователя (`JSON.parse`, query-строка), запись в `obj[key]` по ключу `__proto__` — путь к prototype pollution ([подробнее](../javascript/modern-syntax.md)). `Object.create(null)` лечит обе проблемы: у объекта без прототипа нет ни унаследованных ключей, ни сеттера `__proto__`.

**Приведение ключей.** `obj[1]` и `obj['1']` — один ключ, а любой объект становится `'[object Object]'`: два разных объекта-ключа перезапишут друг друга. `Map` различает `1` и `'1'`, а ключом может быть объект или DOM-узел. Сравнение — SameValueZero: `NaN` равен `NaN`, а `+0` и `−0` — один ключ.

**Порядок ключей объекта.** `OrdinaryOwnPropertyKeys` сначала отдаёт ключи — индексы массива (целые от 0 до 2³² − 2) по возрастанию, затем остальные строки в порядке создания, затем символы. Поэтому `{ b: 1, 2: 1, a: 1, 1: 1 }` обходится как `1, 2, b, a`. Ключи `'-1'` и `'01'` — не индексы, они идут в порядке вставки. Если словарь `id → запись` должен сохранить порядок с сервера, а id числовые, объект его потеряет. `Map` — нет.

> [!NOTE]
> По скорости объект и `Map` для подсчёта частот сопоставимы. В Node 26 подсчёт 2 млн слов занял 30–300 мс у обоих в зависимости от размера словаря. Разница видна на удалениях: 200 000 вставок и удалений — 92 мс у объекта и 19 мс у `Map`. В V8 объект, которому ключи добавляются динамически, переходит в словарный режим уже примерно на 20-м ключе, а `delete` переводит его туда сразу.

> [!TIP]
> `Object.groupBy` (ES2024) возвращает объект **без прототипа**, а `Map.groupBy` — `Map`. Для группировки по произвольным строкам из данных обе безопасны, а `reduce` с `acc[key] ||= []` на обычном объекте — нет. Во Vue `reactive(new Map())` и `ref(new Set())` отслеживаются так же, как объекты: у коллекций свои обработчики прокси.

### Массивы: плотные и разреженные

Массив в JS — объект с особым свойством `length`, а элементы — свойства с ключами-индексами. Если индекса нет, это **дырка** (hole), а не `undefined`: `[1, , 3]`, `new Array(3)`, `arr[100] = x` на пустом массиве, `delete arr[i]`. Методы обращаются с дырками по-разному:

| Пропускают дырки | Видят дырку как `undefined` |
| --- | --- |
| `forEach`, `map`, `filter`, `reduce`, `some`, `every`, `indexOf`, `Object.keys`, `for…in` | `for…of`, spread, `Array.from`, `includes`, `find`, `findIndex`, `join`, `JSON.stringify` (→ `null`) |

Отсюда ловушки: `new Array(3).map(() => 0)` возвращает `[ <3 empty items> ]`, `[1, , 3].indexOf(undefined)` — `-1`, а `includes(undefined)` — `true`. `sort` переносит дырки в самый конец, после `undefined`. Методы ES2023 `toSorted`, `toReversed`, `with` возвращают плотный массив ([подробнее](../javascript/functional-programming.md)). Массив нужной длины создают через `Array.from({ length: n }, (_, i) => …)` или `new Array(n).fill(x)`.

> [!WARNING]
> В V8 у массива есть **вид элементов** (elements kind): PACKED или HOLEY, SMI, DOUBLE или ELEMENTS. Переход идёт только в сторону общего. Массив, который стал HOLEY, остаётся им навсегда, даже если дыры заполнить: в Node 26 `h[5] = 1` на массиве длины 3 и последующие `h[3] = h[4] = 1` оставили его HOLEY. Чтение из такого массива проверяет цепочку прототипов на каждой дырке. `arr[1e7] = 1` на пустом массиве переводит элементы в словарный режим. Это детали движка: алгоритмическая сложность не меняется, меняются константы.

### Строки: code units, code points, графемы

Строка — иммутабельная последовательность 16-битных **code units** (кодовых единиц) UTF-16 ([подробнее](../javascript/types-and-coercion.md)). Символ вне BMP (эмодзи, редкие иероглифы) занимает **суррогатную пару** — два code units. А то, что пользователь видит как один символ, — **графема** (grapheme cluster, UAX #29) — может состоять из нескольких code points:

| Строка | `length` (code units) | `[...s].length` (code points) | графемы |
| --- | --- | --- | --- |
| `'é'` (U+00E9) | 1 | 1 | 1 |
| `'é'` (e + комбинирующий акут) | 2 | 2 | 1 |
| `'😀'` | 2 | 1 | 1 |
| `'🇷🇺'` (два regional indicator) | 4 | 2 | 1 |
| `'👨‍👩‍👧'` (три эмодзи и два ZWJ) | 8 | 5 | 1 |

Что по чему ходит:

- **По code units:** `length`, `s[i]`, `charCodeAt`, `slice`, `substring`, `split('')`, регулярные выражения без флага `u`, `maxlength` у `<input>` и `selectionStart`.
- **По code points:** итератор строки — `for…of`, spread, `Array.from`; `codePointAt` (принимает индекс code unit); регулярные выражения с флагом `u` или `v`.
- **По графемам:** только `Intl.Segmenter` с `granularity: 'grapheme'`.

Поэтому `'a😀'.split('').reverse().join('')` даёт две «половинки» суррогатной пары, а `[...s].reverse()` правильно разворачивает эмодзи, но всё ещё ломает `é` и флаги: комбинирующий знак переезжает на соседнюю букву. `'a😀'.slice(0, 2)` отрезает половину пары. Такая строка не «хорошо сформирована»: `isWellFormed()` (ES2024) вернёт `false`, `encodeURIComponent` бросит `URIError`, а `toWellFormed()` заменит одиночный суррогат на U+FFFD.

**Нормализация.** `'é'` и `'é'` выглядят одинаково, но `===` их различает. `normalize('NFC')` склеивает их в одну форму (композиция), `NFD` раскладывает. `NFKC`/`NFKD` ещё и сводят «совместимые» символы: `'ﬁ'` → `'fi'`, `'①'` → `'1'`. Перед сравнением, дедупликацией и использованием строки как ключа `Map` пользовательский ввод нормализуют: macOS и вставка из разных источников дают разные формы.

**Сравнение и сортировка.** `sort()` без компаратора и операторы `<`/`>` сравнивают code units. Поэтому `'B' < 'a'`, а `'ё'` (U+0451) сортируется после `'ж'` (U+0436). Для текста пользователю нужен `localeCompare` или, для больших массивов, переиспользуемый `Intl.Collator` — он ещё и умеет `numeric: true` (`a2` раньше `a10`) и `sensitivity: 'base'` ([подробнее](./sorting-and-searching.md)). Регистр тоже не 1 : 1: `'ß'.toUpperCase()` — `'SS'`, длина меняется.

**Иммутабельность.** `s[0] = 'x'` молча игнорируется, а в strict mode бросает `TypeError`. Любая «правка» строки создаёт новую. Цена `s += x` в цикле в V8 — отдельный разговор про ropes ([подробнее](./complexity.md)). Для посимвольной сборки надёжнее массив и один `join`.

## Примеры

```js
// Hash set: has the array a duplicate? O(n) time, O(n) memory
const hasDuplicate = (arr) => new Set(arr).size !== arr.length;

// Frequency map: first non-repeating character (by code points)
function firstUnique(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  for (const [ch, n] of freq) if (n === 1) return ch; // Map keeps insertion order
  return null;
}
```

```js
// Two pointers: palindrome ignoring case, punctuation and accents form
function isPalindrome(s) {
  const chars = [...s.normalize('NFC').toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c));
  let l = 0;
  let r = chars.length - 1;
  while (l < r) if (chars[l++] !== chars[r--]) return false;
  return true;
}
isPalindrome('А роза упала на лапу Азора'); // true
```

```js
// Sliding window: shortest subarray with sum >= target (positive numbers only)
function minSubarrayLen(nums, target) {
  let best = Infinity;
  let sum = 0;
  let left = 0;
  for (let right = 0; right < nums.length; right++) {
    sum += nums[right];
    while (sum >= target) {
      best = Math.min(best, right - left + 1);
      sum -= nums[left++]; // each index leaves the window once: O(n) overall
    }
  }
  return best === Infinity ? 0 : best;
}
```

```js
// Prefix sums: O(1) range sum after O(n) preprocessing
const prefix = [0];
for (const x of nums) prefix.push(prefix.at(-1) + x);
const rangeSum = (l, r) => prefix[r] - prefix[l]; // sum of nums[l..r)

// Graphemes: what the user counts as characters
const segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' });
const graphemeCount = (s) => [...segmenter.segment(s)].length;
graphemeCount('👨‍👩‍👧'); // 1, while length is 8
```

## Вопросы с интервью

::: details Когда использовать Map, а когда обычный объект как словарь
`Map` — когда ключи приходят из данных: от пользователя, с сервера, из текста. У него нет унаследованных ключей вроде `constructor` и сеттера `__proto__`, ключи любого типа (объект, DOM-узел, число отдельно от строки), порядок обхода — порядок вставки, `size` за O(1), и он рассчитан на частые удаления. Объект — когда набор ключей известен заранее (запись, конфиг) или нужен JSON напрямую. Промежуточный вариант — `Object.create(null)`: без прототипа, но с приведением ключей к строкам и «целочисленные сначала». По скорости на подсчёте частот они сопоставимы. На удалениях `Map` выигрывает в разы, потому что `delete` в V8 переводит объект в словарный режим.
:::

::: details Почему порядок ключей объекта не совпадает с порядком вставки
Спецификация (`OrdinaryOwnPropertyKeys`) задаёт порядок: сначала ключи — индексы массива (целые от 0 до 2³² − 2) по возрастанию, затем остальные строки в порядке создания, затем символы. Это нужно, чтобы массивы и объекты обходились одинаково. Следствие: словарь `{ 10: …, 2: … }` с числовыми id обходится по возрастанию id, а не в порядке ответа сервера. `'01'` и `'-1'` — не индексы, они остаются на своих местах. Сохранить порядок можно `Map` или массивом пар.
:::

::: details Почему length строки не равен числу символов
`length` считает UTF-16 code units. Символы вне BMP (эмодзи) занимают суррогатную пару — два code units. То, что видит пользователь, — графема — может состоять из нескольких code points: буква с комбинирующим знаком, флаг из двух regional indicator, семья эмодзи через ZWJ (8 code units, 5 code points, 1 графема). Итератор строки (`for…of`, spread) ходит по code points, графемы даёт только `Intl.Segmenter`. Практика на фронтенде: `maxlength` и `selectionStart` тоже считают code units, поэтому счётчик «осталось N символов» и обрезку текста надо делать по графемам.
:::

::: details Что такое дырки в массиве и чем они опасны
Дырка — отсутствующий индекс внутри `length`: `[1, , 3]`, `new Array(3)`, `delete arr[i]`, запись далеко за конец. Это не `undefined`: `1 in [1, , 3]` — `false`. Старые методы (`forEach`, `map`, `filter`, `indexOf`) дырки пропускают, новые и итератор (`for…of`, `includes`, `find`, `Array.from`) видят как `undefined`. Поэтому `new Array(3).map(() => 0)` ничего не заполняет, а `indexOf(undefined)` и `includes(undefined)` расходятся. В V8 массив с дыркой навсегда становится HOLEY: чтение проверяет цепочку прототипов, константы растут. Создавать массивы нужно через `Array.from({ length: n }, fn)` или `fill`.
:::

::: details Как понять, что задача решается скользящим окном, а не префиксными суммами
Окно подходит для «самого длинного или короткого **непрерывного** отрезка с условием», если условие монотонно: сжатие окна слева только улучшает «плохое» окно. Тогда каждый индекс входит и выходит один раз — O(n), O(1) или O(алфавит) памяти. С отрицательными числами монотонность ломается: убрать элемент слева может и увеличить сумму. Тогда берут префиксные суммы: сумма отрезка — разность двух префиксов, а `Map` префиксов отвечает «встречался ли нужный префикс» за O(1). Это O(n) времени и O(n) памяти. Подсчёт **числа** отрезков с точной суммой — тоже префиксы.
:::

::: details Почему хеш-таблица даёт O(1) только в среднем
Ключ хешируется в номер корзины. Если хеш-функция распределяет ключи равномерно, а таблица растёт при заполнении, в корзине в среднем O(1) записей. Худший случай — все ключи в одной корзине: O(n) на операцию. Его может подобрать атакующий (HashDoS), поэтому движки рандомизируют seed хеша строк. Рост таблицы стоит O(n), но случается геометрически реже, поэтому вставка амортизированно O(1). Спецификация ECMAScript требует от `Map` и `Set` лишь сублинейного доступа в среднем и порядка вставки при обходе. В V8 это детерминированная хеш-таблица, где записи лежат в массиве по порядку вставки.
:::

::: details Как правильно сравнивать и сортировать строки пользователя
Сначала нормализовать: `'é'` одним code point и `'é'` выглядят одинаково, но `===` их различает. `normalize('NFC')` приводит к одной форме, `NFKC` ещё и сводит совместимые символы (лигатуры, круглые цифры). Затем сравнивать с учётом языка: `sort()` без компаратора и `<` сравнивают code units, поэтому `'B'` раньше `'a'`, а `'ё'` после `'ж'`. `localeCompare` или `Intl.Collator` (его стоит создать один раз для большого массива) сортируют по правилам языка, умеют `numeric: true` и сравнение без учёта регистра и диакритики (`sensitivity: 'base'`). Сравнение через `toLowerCase()` ненадёжно: `'ß'.toUpperCase()` — это `'SS'`.
:::

## Задачи

### 1. Two sum · легко

Дан массив чисел `nums` и число `target`. Верните индексы двух **разных** элементов, сумма которых равна `target`, или `null`. Затем решите тот же вопрос для отсортированного массива без дополнительной памяти.

::: details Решение и разбор
Наивно — двойной цикл, O(n²). Хеш-таблица «значение → индекс» позволяет за один проход спросить: «встречалось ли `target − x`?»

```js
function twoSum(nums, target) {
  const seen = new Map(); // value -> index
  for (let i = 0; i < nums.length; i++) {
    const j = seen.get(target - nums[i]);
    if (j !== undefined) return [j, i];
    seen.set(nums[i], i); // after the lookup: an element can't pair with itself
  }
  return null;
}

twoSum([3, 2, 4], 6); // [1, 2], not [0, 0]
twoSum([3, 3], 6); // [0, 1]
```

Проверка до записи решает случай `[3, 2, 4], 6`: тройка не сложится сама с собой. Сравнение с `undefined`, а не `if (j)`, — потому что индекс `0` ложен. Объект вместо `Map` сработал бы для чисел, но ключи стали бы строками.

На отсортированном массиве — два указателя: если сумма мала, левый элемент слишком мал для любого оставшегося правого, и его можно отбросить.

```js
function twoSumSorted(a, target) {
  let l = 0;
  let r = a.length - 1;
  while (l < r) {
    const sum = a[l] + a[r];
    if (sum === target) return [l, r];
    if (sum < target) l++;
    else r--;
  }
  return null;
}
```

Сложность: `Map` — O(n) по времени в среднем, O(n) по памяти; два указателя — O(n) по времени, O(1) по памяти (сортировка, если она нужна, добавит O(n log n) и потеряет исходные индексы).
:::

### 2. Группировка анаграмм · средне

Сгруппируйте слова так, чтобы в группе были анаграммы друг друга (без учёта регистра). Порядок групп — по первому появлению. Слова могут быть на любом языке.

```js
groupAnagrams(['eat', 'tea', 'tan', 'ate', 'nat', 'bat']);
// [['eat', 'tea', 'ate'], ['tan', 'nat'], ['bat']]
```

::: details Решение и разбор
У анаграмм одинаковый **канонический ключ** — отсортированные символы. Группы держим в `Map`: порядок вставки даёт порядок первого появления, а ключ из данных не столкнётся с `Object.prototype`.

```js
function groupAnagrams(words) {
  const groups = new Map(); // canonical key -> words
  for (const w of words) {
    const key = [...w.toLowerCase()].sort().join('');
    const group = groups.get(key);
    if (group) group.push(w);
    else groups.set(key, [w]);
  }
  return [...groups.values()];
}

groupAnagrams(['Листок', 'столик', 'слиток']); // [['Листок', 'столик', 'слиток']]
```

`[...w]`, а не `w.split('')`: сортировка code units разорвала бы суррогатные пары, и эмодзи превратились бы в мусор. Для текста с диакритикой стоит добавить `normalize('NFC')`. Короче — `Map.groupBy(words, keyFn)` (ES2024).

Альтернатива для латиницы `a–z` — ключ из счётчиков: массив из 26 чисел, склеенный в строку. Ключ строится за O(k) вместо O(k log k), но работает только для известного алфавита.

Сложность: O(n · k log k) по времени, где n — число слов, k — длина самого длинного; O(n · k) по памяти. Со счётчиками — O(n · k).
:::

### 3. Самая длинная подстрока без повторов · средне

Верните длину самой длинной подстроки без повторяющихся символов. Символ — code point: `'😀😁😀'` → 2.

```js
lengthOfLongestSubstring('abcabcbb'); // 3 ('abc')
lengthOfLongestSubstring('abba'); // 2
```

::: details Решение и разбор
Скользящее окно: правая граница идёт по строке, а встреченный повтор сдвигает левую границу за его прошлое вхождение. Вместо `while`, который выбрасывает символы по одному, храним позицию **после** последнего вхождения каждого символа и прыгаем сразу.

```js
function lengthOfLongestSubstring(s) {
  const last = new Map(); // char -> index right after its last occurrence
  let start = 0;
  let best = 0;
  let i = 0; // index in code points, not code units
  for (const ch of s) {
    const prev = last.get(ch);
    if (prev !== undefined && prev > start) start = prev; // never move left
    last.set(ch, ++i);
    best = Math.max(best, i - start);
  }
  return best;
}
```

Ловушка — `'abba'`. На второй `a` её прошлое вхождение (индекс 0) уже за левой границей окна (2). Без проверки `prev > start` окно «откатилось бы» назад, и ответ стал бы 3. `for…of` идёт по code points, поэтому эмодзи — один символ. Обход через `s[i]` сравнивал бы половинки суррогатных пар и мерил окно в code units: для `'😀😁'` (обе пары начинаются с одного code unit `\uD83D`) он вернёт 3 — больше, чем символов в строке.

Проверено на `''`, `' '`, `'bbbbb'`, `'dvdf'`, `'abba'` и строках с эмодзи.

Сложность: O(n) по времени, O(min(n, σ)) по памяти, где σ — размер алфавита.
:::

### 4. Число подмассивов с суммой k · средне

Посчитайте непрерывные подмассивы `nums` с суммой ровно `k`. Числа могут быть отрицательными. Почему скользящее окно здесь не работает?

```js
subarraySum([1, 1, 1], 2); // 2
subarraySum([1, -1, 0], 0); // 3
```

::: details Решение и разбор
Окно опирается на монотонность: расширение увеличивает сумму, сжатие уменьшает. С отрицательными числами и нулями это неверно. В `[1, -1, 0]` при k = 0 подходят `[1, -1]`, `[0]` и `[1, -1, 0]`, а окно не знает, когда сжиматься.

Префиксные суммы: отрезок `(j, i]` имеет сумму k, если `prefix[i] − prefix[j] = k`, то есть `prefix[j] = prefix[i] − k`. Значит, для каждого i надо знать, **сколько раз** уже встречалась сумма `prefix[i] − k`.

```js
function subarraySum(nums, k) {
  const seen = new Map([[0, 1]]); // prefix sum -> how many times; empty prefix counts
  let sum = 0;
  let count = 0;
  for (const x of nums) {
    sum += x;
    count += seen.get(sum - k) ?? 0;
    seen.set(sum, (seen.get(sum) ?? 0) + 1);
  }
  return count;
}
```

Запись `[0, 1]` учитывает отрезки от начала массива. Без неё `[2], 2` дал бы 0. Порядок «сначала спросить, потом записать» не даёт посчитать пустой отрезок при k = 0. Решение проверено против перебора O(n²) на 2000 случайных массивов с отрицательными числами и нулями.

Сложность: O(n) по времени в среднем, O(n) по памяти.
:::

### 5. Обрезать текст, не ломая символы · средне

Для превью комментария обрежьте строку до `max` видимых символов, включая многоточие `…`. Эмодзи, флаги и буквы с диакритикой нельзя резать пополам. Почему `text.slice(0, max - 1) + '…'` не годится?

```js
truncate('hello!', 5); // 'hell…'
truncate('👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧', 2); // '👨‍👩‍👧…'
```

::: details Решение и разбор
`slice` режет по code units. `'👨‍👩‍👧👨‍👩‍👧'.slice(0, 4)` оставляет мужчину, ZWJ и половину суррогатной пары женщины. На экране это `👨‍�`, а `encodeURIComponent` такой строки бросит `URIError`. `[...text].slice(...)` спасает суррогатные пары, но всё ещё разрывает семью, флаг и `é`. Видимый символ — графема, её границы знает `Intl.Segmenter`.

```js
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function truncate(text, max, ellipsis = '…') {
  if (max <= 0) return '';
  let count = 0;
  let cutAt = 0; // code-unit offset where the first (max - 1) graphemes end
  for (const { index } of segmenter.segment(text)) {
    if (count === max - 1) cutAt = index;
    if (++count > max) return text.slice(0, cutAt) + ellipsis;
  }
  return text; // fits as is: no ellipsis
}
```

Сегменты отдают `index` в code units, поэтому итоговый `slice` безопасен: он режет ровно по границе графемы. Обход ленивый и останавливается на `max + 1`-й графеме, так что длинный текст целиком не сегментируется. Строка, которая помещается, возвращается без многоточия.

Проверено на пустой строке, `max = 0`, точном попадании в лимит, флагах `🇷🇺` и `é`. Тот же подход нужен для счётчика «осталось N символов»: `maxlength` у `<textarea>` считает code units, и эмодзи «съедает» два символа лимита.

Сложность: O(max) по времени (сегментация до точки обрезки, плюс O(max) на `slice`), O(max) по памяти на результат.
:::

## Источники

- [ECMAScript® 2027 Language Specification — OrdinaryOwnPropertyKeys (порядок ключей объекта)](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinaryownpropertykeys)
- [ECMAScript® 2027 Language Specification — Keyed Collections: Map и Set (порядок вставки, SameValueZero, сублинейный доступ)](https://tc39.es/ecma262/multipage/keyed-collections.html)
- [ECMAScript® 2027 Language Specification — String Objects (UTF-16, итератор по code points, normalize, isWellFormed)](https://tc39.es/ecma262/multipage/text-processing.html#sec-string-objects)
- [ECMAScript® 2027 Language Specification — Array Exotic Objects и индексы массива](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-array-exotic-objects)
- [ECMA-402 — Intl.Segmenter](https://tc39.es/ecma402/#segmenter-objects)
- [Unicode Standard Annex #29 — Unicode Text Segmentation (grapheme clusters)](https://www.unicode.org/reports/tr29/)
- [Unicode Standard Annex #15 — Unicode Normalization Forms](https://www.unicode.org/reports/tr15/)
- [HTML Standard — Limiting user input length: the maxlength attribute](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#limiting-user-input-length:-the-maxlength-attribute)
- [MDN: Map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map)
- [MDN: String — UTF-16 characters, Unicode code points, and grapheme clusters](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String#utf-16_characters_unicode_code_points_and_grapheme_clusters)
- [MDN: Indexed collections — Sparse arrays](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Indexed_collections#sparse_arrays)
- [MDN: Intl.Segmenter](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter)
- [Vue.js — Reactivity Fundamentals: limitations of reactive() (Map и Set)](https://vuejs.org/guide/essentials/reactivity-fundamentals.html#limitations-of-reactive)
- [V8 blog: Elements kinds in V8](https://v8.dev/blog/elements-kinds)
- [V8 blog: Fast properties in V8 (словарный режим объектов)](https://v8.dev/blog/fast-properties)
- [V8 blog: Optimizing hash tables: hiding the hash code](https://v8.dev/blog/hash-code)
- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th ed. (гл. 11 «Hash Tables»)](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/)
- [Sedgewick, Wayne — Algorithms, 4th ed., 3.4 Hash Tables](https://algs4.cs.princeton.edu/34hash/)
