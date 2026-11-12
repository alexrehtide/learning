---
title: Функциональные приёмы и иммутабельность
level: ядро
---

# Функциональные приёмы и иммутабельность

> **Коротко.** Функциональный стиль в JavaScript держится на трёх вещах: функции — обычные значения, логика собирается из чистых функций, данные не меняются на месте, а заменяются новыми версиями. Язык ничего из этого не навязывает: объекты изменяемы, а `const` защищает привязку, а не значение. Иммутабельность здесь — дисциплина «изменение = копия» плюс инструменты: `Object.freeze`, методы массивов, которые возвращают копию (`toSorted`, `with`), и `structuredClone`. Во фронтенде она нужна там, где изменение определяют сравнением ссылок: `shallowRef`, мемоизация, история состояний, сравнение в `watch`.

**Связанные темы:** [Замыкания](./closures.md), [Функции и `this`](./functions-and-this.md), [Деструктуризация, spread/rest и современный синтаксис](./modern-syntax.md), [Дескрипторы свойств, `Proxy` и `Reflect`](./property-descriptors-and-proxy.md), [Итераторы и генераторы](./iterators-and-generators.md), [Память и сборка мусора](./memory-and-gc.md), [Web Workers, Service Workers и PWA](../browser/workers.md)

## Теория

### Чистые функции и побочные эффекты

**Чистая функция** (pure function) удовлетворяет двум условиям:

1. **Детерминированность.** Результат зависит только от аргументов. Те же аргументы — тот же результат.
2. **Нет наблюдаемых побочных эффектов** (side effects). Функция не мутирует аргументы и внешнее состояние, не делает I/O, не пишет в DOM и не логирует.

Отсюда **ссылочная прозрачность** (referential transparency): вызов можно заменить его результатом, и программа не изменится. Это свойство и даёт практическую пользу:

- **тестируемость** — вход и выход, без моков и подготовки окружения;
- **мемоизация** — кэш по аргументам корректен, только если функция чистая;
- **предсказуемый порядок** — чистые вычисления можно переставлять, откладывать, считать лениво или не считать вовсе (так `computed` Vue вычисляется только при чтении);
- **детерминизм SSR** — рендер на сервере и гидрация на клиенте дают одинаковый результат. `Date.now()`, `Math.random()` или чтение `window` в рендере ломают гидрацию.

Скрытые источники нечистоты: `Date.now()`, `Math.random()`, `crypto.randomUUID()`, чтение изменяемой переменной из замыкания или модуля, **мутирующие методы** (`sort`, `reverse`, `splice` над аргументом), исключения как управление потоком. Функция, которая создаёт и мутирует **локальный** массив, остаётся чистой: мутацию никто снаружи не видит.

Программа без эффектов бесполезна, поэтому цель — не избавиться от эффектов, а **изолировать** их. Схема «functional core, imperative shell»: расчёты — чистое ядро, ввод-вывод, таймеры и DOM — тонкая оболочка вокруг него. Во Vue так и выходит само: `computed` — чистые производные, `watch` и обработчики событий — эффекты.

### Функции высшего порядка

Функции в JS — объекты первого класса: их можно передать, вернуть, положить в структуру. **Функция высшего порядка** (higher-order function) принимает функцию или возвращает её. Примеры: `map`, `filter`, `reduce`, `addEventListener`, `debounce`, фабрики composables. Возвращённая функция обычно несёт состояние в [замыкании](./closures.md).

Цепочка `map`/`filter`/`reduce` над массивом **энергичная** (eager): каждый шаг создаёт промежуточный массив целиком. Для больших данных и ранней остановки есть ленивые **iterator helpers** (ES2025): `values().filter().map().take(10)` обрабатывает элементы по одному ([подробнее](./iterators-and-generators.md)).

Ловушки `reduce`:

- без начального значения на пустом массиве — `TypeError`;
- `reduce((acc, x) => ({ ...acc, [x.id]: x }), {})` копирует аккумулятор на каждом шаге — O(n²). Мутировать локальный аккумулятор внутри `reduce` можно: он не виден снаружи, функция остаётся чистой.

### Каррирование, частичное применение, композиция

**Частичное применение** (partial application) фиксирует часть аргументов и возвращает функцию от остальных: `const add5 = add.bind(null, 5)`. Это конкретная функция с меньшей арностью.

**Каррирование** (currying) — преобразование функции от n аргументов в цепочку функций по одному: `f(a, b, c)` → `f(a)(b)(c)`. Практичная JS-версия принимает и несколько аргументов за раз: `curried(a, b)(c)`. Число аргументов она берёт из `fn.length`, а он не считает параметры со значением по умолчанию и rest ([подробнее](./functions-and-this.md)). Поэтому каррировать функции с `b = 1` или `...rest` автоматически нельзя.

**Композиция** собирает функцию из функций: `compose(f, g)(x) === f(g(x))` выполняется справа налево, `pipe(g, f)` — то же слева направо и читается как конвейер. Стиль без явных аргументов (point-free) — `items.map(toView)` вместо `items.map((x) => toView(x))` — хорош, пока сигнатуры совпадают.

> [!WARNING]
> `map` передаёт колбэку три аргумента: элемент, индекс, массив. `['1', '2', '3'].map(parseInt)` вызывает `parseInt('2', 1)` и `parseInt('3', 2)` и возвращает `[1, NaN, NaN]`. Point-free безопасен, только когда функция игнорирует лишние аргументы.

> [!NOTE]
> Оператор конвейера `|>` (pipeline operator, вариант Hack с топик-токеном) — на stage 2 (сверено 2026-11-12). Пока его нет, вместо `x |> f(%) |> g(%)` пишут `pipe(f, g)(x)`.

Реализации `curry`, `compose`, `pipe` и `memoize` — задачи live coding, их разбирает раздел «Live coding».

### Иммутабельность: что неизменяемо в JS

**Примитивы неизменяемы**: `str.toUpperCase()` возвращает новую строку, а `str[0] = 'x'` ничего не меняет (в strict mode — `TypeError`). **Объекты изменяемы**, и защищать их можно на трёх уровнях.

1. **Привязка.** `const` запрещает переприсвоить переменную, но не менять объект ([подробнее](./scope-and-hoisting.md)).
2. **Объект.** `Object.freeze` делает свойства незаписываемыми и неконфигурируемыми и запрещает добавлять новые ([подробнее](./property-descriptors-and-proxy.md)). Заморозка **поверхностная**: вложенные объекты остаются изменяемыми. Запись в замороженный объект в sloppy mode молча игнорируется, в strict mode (модули, классы) бросает `TypeError`. Внутренние слоты `freeze` не трогает: замороженный `Map` по-прежнему принимает `set`.
3. **Дисциплина.** Данные не мутируют, а создают новую версию. Это главный уровень: заморозка лишь ловит нарушения дисциплины.

Методы массивов делятся на мутирующие и возвращающие копию:

| Мутирует | Возвращает новый массив |
| --- | --- |
| `sort` | `toSorted` (ES2023) |
| `reverse` | `toReversed` (ES2023) |
| `splice` | `toSpliced` (ES2023) |
| `arr[i] = v` | `with(i, v)` (ES2023) |
| `push`, `unshift` | `[...arr, v]`, `concat` |
| `pop`, `shift`, `fill`, `copyWithin` | `slice`, `filter`, `map` |

Детали change-by-copy методов:

- `with(i, v)` принимает отрицательный индекс, а за пределами массива бросает `RangeError`. Присваивание по индексу в таком случае молча расширило бы массив.
- `toSorted`, `toReversed`, `toSpliced` и `with` возвращают **плотный** массив: дырки становятся `undefined`.
- Результат — всегда обычный `Array`, даже для подкласса (`Symbol.species` не используется). Над реактивным массивом Vue `toSorted()` возвращает сырой массив, исходный не трогает.
- `sort` и `toSorted` **стабильны** с ES2019: элементы с равным ключом сохраняют исходный порядок. Поэтому многоуровневая сортировка — несколько проходов от младшего ключа к старшему.

Для объектов копия при изменении — spread: `{ ...user, name }`. Для группировки — `Object.groupBy` и `Map.groupBy` (ES2024). Первый возвращает объект с `null`-прототипом.

### Иммутабельные обновления и structural sharing

Изменить вложенное поле, не мутируя, — значит скопировать **каждый объект на пути** от корня до поля, а всё остальное переиспользовать:

```js
const next = {
  ...state,
  user: { ...state.user, address: { ...state.user.address, city } },
};
// next.settings === state.settings — untouched branches are shared
```

Это **structural sharing**: копируется путь, а не дерево. Стоимость — O(глубина), а не O(размер). Новая версия и старая делят неизменённые ветки. Из этого следует главное свойство: **изменилось ли поддерево, видно по ссылке**. Если `prev.items === next.items`, сравнивать содержимое не нужно. На этом строятся мемоизация по ссылке, дешёвая история (undo/redo хранит версии, а не глубокие копии) и `shallowRef`.

Ручной spread на глубине 3+ становится нечитаемым. Это решают библиотеки: Immer (`produce(state, (draft) => { draft.user.address.city = city })` — мутации черновика через `Proxy` превращаются в structural sharing, результат по умолчанию заморожен) или нормализация состояния: плоские словари по `id` вместо глубокой вложенности.

### Копирование: поверхностное и глубокое

**Поверхностная** копия (shallow) создаёт новый объект верхнего уровня, а вложенные объекты остаются общими: spread, `Object.assign`, `Array.from`, `slice`. **Глубокая** (deep) рекурсивно копирует всё.

| Способ | Что теряется или ломается |
| --- | --- |
| `{ ...obj }`, `Object.assign` | только верхний уровень; теряет прототип, неперечисляемые свойства, геттеры (копирует их значения) |
| `JSON.parse(JSON.stringify(x))` | `undefined` и функции пропадают, `Date` → строка, `Map`/`Set` → `{}`, `NaN`/`Infinity` → `null`, `BigInt` и циклы — `TypeError` |
| `structuredClone(x)` | прототип (экземпляр класса → обычный объект), геттеры (сохраняются значения), неперечисляемые свойства, символьные ключи, `#private`, «замороженность»; функции, DOM-узлы и `Proxy` → `DataCloneError` |

`structuredClone` — глобальная функция HTML Living Standard (не ECMAScript), доступна в браузерах, воркерах, Node и Deno. Она использует **structured clone algorithm** — тот же, что `postMessage`, IndexedDB и `history.pushState`. Алгоритм сначала сериализует значение, затем восстанавливает его и ведёт таблицу уже встреченных объектов. Поэтому:

- **циклы и общие ссылки сохраняются**: если `a.x === a.y`, то и в копии `copy.x === copy.y`;
- поддержаны `Date`, `RegExp` (без `lastIndex`), `Map`, `Set`, `ArrayBuffer`, typed arrays, `BigInt`, обёртки примитивов, `Error` (сохраняются `name`, `message`, `cause` и `stack`, но не свои дополнительные свойства), `Blob`, `File`, `ImageData` и другие сериализуемые объекты платформы;
- опция `transfer` **передаёт** `ArrayBuffer` без копирования: исходный буфер становится detached.

> [!WARNING]
> `structuredClone(reactive(obj))` бросает `DataCloneError`: реактивный объект Vue — это `Proxy`, а прокси алгоритм не клонирует. `structuredClone(toRaw(state))` работает, но только до первого прокси **внутри** сырого объекта. Подробно — в задаче 4.

> [!NOTE]
> Предложение Record & Tuple (`#{}` и `#[]` — глубоко неизменяемые примитивы со сравнением по значению) отозвано TC39 в апреле 2025. Его место заняло предложение **Composites** (stage 2, сверено 2026-11-12). `Composite({ x: 1, y: 4 })` возвращает замороженный объект без прототипа, равные композиты — один и тот же объект, и их можно использовать как ключи `Map` и `Set`. Неизменяемость у композитов поверхностная.

### Vue: мутабельная реактивность и иммутабельные приёмы

Реактивность Vue построена на **мутации**: `state.count++` и `list.push(x)` — нормальный API, прокси перехватывает запись и запускает эффекты. Иммутабельные обновления во Vue не обязательны, но в нескольких местах без них не обойтись.

- **`computed` должен быть чистым.** Документация прямо требует от геттера отсутствия побочных эффектов: никаких запросов, мутаций DOM и **мутаций источника**. `computed(() => list.value.sort())` сортирует исходный массив на месте. Нужно `toSorted()` или `[...list.value].sort()`. Значение `computed` тоже не мутируют: это производное, оно будет перезаписано.
- **Props — однонаправленный поток.** Объект props только для чтения на верхнем уровне. Вложенный объект из props — это реактивный объект родителя, и запись в него сработает и изменит состояние родителя. Документация называет это антипаттерном: ребёнок сообщает об изменении через `emit` или `defineModel`, а меняет данные владелец.
- **`shallowRef` реагирует только на замену `.value`.** `sr.value.count++` эффектов не запустит, `sr.value = { ...sr.value, count: sr.value.count + 1 }` — запустит. Для больших неизменяемых структур это и есть рекомендуемый путь: `shallowRef` плюс иммутабельные обновления со structural sharing. Альтернатива — мутация и `triggerRef(sr)`.
- **Старое и новое значение в `watch`.** При мутации реактивного объекта колбэк глубокого `watch` получает `newValue === oldValue`: это один и тот же объект. Разные значения бывают, только если объект заменили. Если нужно сравнить «до» и «после», состояние обновляют заменой или наблюдают геттер, который возвращает копию или примитив.

## Примеры

Чистое ядро и эффект на границе:

```js
// pure: same input -> same output, no mutation
export function summarizeCart(items, discountRate) {
  const subtotal = items.reduce((sum, it) => sum + it.price * it.qty, 0);
  return { subtotal, total: Math.round(subtotal * (1 - discountRate)) };
}

// impure shell: I/O and time live here
export async function checkout(api, items) {
  const { discountRate } = await api.getDiscount();
  const summary = summarizeCart(items, discountRate);
  await api.createOrder({ ...summary, createdAt: Date.now() });
}
```

Структурное разделение при обновлении:

```js
const state = {
  user: { name: 'Ann', address: { city: 'Riga' } },
  settings: { theme: 'dark' },
};
const next = {
  ...state,
  user: { ...state.user, address: { ...state.user.address, city: 'Oslo' } },
};

next.settings === state.settings; // true — shared
next.user === state.user;         // false — on the changed path
state.user.address.city;          // 'Riga' — the old version is intact
```

Сортировка во Vue без мутации источника:

```ts
const props = defineProps<{ users: User[] }>();
const sortBy = ref<'name' | 'age'>('name');

const sorted = computed(() =>
  props.users.toSorted((a, b) =>
    sortBy.value === 'name' ? a.name.localeCompare(b.name) : a.age - b.age,
  ),
);
```

## Вопросы с интервью

::: details Что такое чистая функция и зачем она во фронтенде?
Функция, результат которой зависит только от аргументов и которая не имеет наблюдаемых побочных эффектов: не мутирует аргументы и внешнее состояние, не делает I/O. Её вызов можно заменить результатом (ссылочная прозрачность). Отсюда польза: тесты без моков, корректная мемоизация, свобода откладывать и пропускать вычисления (`computed` во Vue ленивый и кэшируется именно потому, что геттер должен быть чистым), детерминированный SSR без hydration mismatch. Скрытые источники нечистоты — `Date.now()`, `Math.random()`, мутирующие методы вроде `sort` над аргументом, чтение изменяемых внешних переменных. Мутация локальной переменной чистоту не нарушает. Эффекты не убирают, а выносят на границу: чистое ядро, императивная оболочка.
:::

::: details Чем каррирование отличается от частичного применения?
Частичное применение фиксирует часть аргументов и возвращает функцию от остальных: `add.bind(null, 5)`. Каррирование превращает функцию от n аргументов в цепочку унарных: `f(a)(b)(c)`. Каррированную функцию можно частично применять на каждом шаге, поэтому каррирование — способ получить частичное применение для любой позиции. В JS «авто-curry» опирается на `fn.length`, а он не учитывает параметры по умолчанию и rest, поэтому такие функции каррировать нельзя без явной арности. На практике частичное применение встречается чаще: фабрики обработчиков, `bind`, конфигурируемые валидаторы. Полное каррирование нужно в основном для point-free композиции.
:::

::: details Почему const не делает объект неизменяемым и как сделать неизменяемым?
`const` защищает привязку: переменной нельзя присвоить другое значение, а сам объект можно менять. `Object.freeze` запрещает менять и добавлять свойства, но поверхностно: вложенные объекты остаются изменяемыми, а внутренние слоты (`Map`, `Set`, `Date`) не защищены. Запись в замороженный объект в sloppy mode игнорируется, в strict mode — `TypeError`. Глубокая неизменяемость — рекурсивный `deepFreeze` или иммутабельная структура данных (Immer с автозаморозкой). Главное на практике — дисциплина «изменение = новая версия», а заморозка служит проверкой в dev. В языке глубоко неизменяемых значений нет: Record & Tuple отозвали в 2025 году, его преемник Composites на stage 2.
:::

::: details Чем отличаются способы копирования: spread, JSON и structuredClone?
Spread и `Object.assign` копируют поверхностно: вложенные объекты общие, теряются прототип, неперечисляемые свойства и аксессоры. JSON-круг даёт глубокую копию только JSON-совместимых данных: пропадают `undefined` и функции, `Date` становится строкой, `Map`/`Set` — пустыми объектами, `NaN` — `null`, на циклах и `BigInt` бросается `TypeError`. `structuredClone` — structured clone algorithm из HTML, тот же, что у `postMessage`. Он сохраняет циклы и общие ссылки, поддерживает `Date`, `Map`, `Set`, `RegExp`, typed arrays, `BigInt`, `Error`, умеет передавать буферы (`transfer`). Но теряет прототипы (класс → обычный объект), геттеры, символьные ключи, `#private` и замороженность, а на функциях, DOM-узлах и `Proxy` (в том числе `reactive` Vue) бросает `DataCloneError`. Для экземпляров классов нужна собственная сериализация.
:::

::: details Что такое structural sharing и почему иммутабельные обновления не дорогие?
При обновлении копируются только объекты на пути от корня до изменённого поля, остальные ветки переиспользуются по ссылке. Обновление стоит O(глубина), а не O(размер), и старая версия остаётся целой. Главная выгода — изменения видны по ссылке: `prev.items !== next.items` означает «поменялось», равенство — «точно не поменялось», без глубокого сравнения. На этом держатся мемоизация по ссылке, `shallowRef` во Vue, React-рендер, дешёвые undo/redo и time-travel. Цена — давление на GC от короткоживущих копий (в V8 короткоживущие объекты дешёвые) и многословность ручных spread, которую убирают Immer или нормализация состояния.
:::

::: details Почему map с parseInt возвращает NaN?
`['1', '2', '3'].map(parseInt)` даёт `[1, NaN, NaN]`. `map` вызывает колбэк с тремя аргументами — элемент, индекс, массив, — а `parseInt` принимает второй аргумент как основание системы счисления. Получаются вызовы `parseInt('1', 0)` (0 — основание по умолчанию, 10), `parseInt('2', 1)` (основание 1 недопустимо — `NaN`) и `parseInt('3', 2)` (цифры 3 в двоичной системе нет — `NaN`). Мораль про point-free: передавать функцию напрямую безопасно, только если она игнорирует лишние аргументы. Правильно — `map(Number)` или `map((s) => parseInt(s, 10))`.
:::

::: details Как во Vue сочетаются мутабельная реактивность и иммутабельные приёмы?
Реактивность Vue работает на мутациях: прокси перехватывает запись, поэтому `push` и `state.x = 1` — штатный API. Иммутабельность нужна в конкретных местах. `computed` обязан быть чистым: `sort`/`reverse` внутри него мутируют источник, нужны `toSorted`/`toReversed`. Props — однонаправленный поток: вложенный объект из props технически изменяем, но мутировать его — антипаттерн, вместо этого `emit` или `defineModel`. `shallowRef` реагирует только на замену `.value`, и для больших структур это рекомендуемая связка: `shallowRef` плюс иммутабельные обновления. Глубокий `watch` при мутации получает `newValue === oldValue` — сравнить версии можно, только если их заменять. Снимки состояния (undo, отправка в воркер) упираются в то, что `structuredClone` не клонирует `Proxy`, поэтому нужен `toRaw`.
:::

## Задачи

### 1. Найдите побочные эффекты · легко

Какие из функций нечистые и почему? Перепишите их чистыми, сохранив смысл.

```js
function topScores(scores, n) {
  return scores.sort((a, b) => b - a).slice(0, n);
}

let taxRate = 0.2;
function withTax(price) {
  return price * (1 + taxRate);
}

function addTag(post, tag) {
  post.tags.push(tag);
  return post;
}

function createTodo(title) {
  return { id: crypto.randomUUID(), title, createdAt: Date.now() };
}
```

::: details Решение и разбор
```js
const topScores = (scores, n) => scores.toSorted((a, b) => b - a).slice(0, n);

const withTax = (price, taxRate) => price * (1 + taxRate);

const addTag = (post, tag) => ({ ...post, tags: [...post.tags, tag] });

const createTodo = (title, { id, now }) => ({ id, title, createdAt: now });
// at the boundary: createTodo(title, { id: crypto.randomUUID(), now: Date.now() })
```

- `topScores` мутирует аргумент: `sort` сортирует на месте, и вызывающий код получает переставленный массив. `slice` после `sort` не спасает — копия снимается уже после мутации.
- `withTax` читает изменяемую внешнюю переменную: результат зависит от состояния модуля, а не только от аргументов. Константа в модуле (`const TAX_RATE`) чистоту бы не нарушала.
- `addTag` мутирует вложенный массив и возвращает **тот же** объект. Сравнение `prev !== next` не заметит изменения, а мемоизация по ссылке вернёт старый результат.
- `createTodo` недетерминирована. Источники случайности и времени передают параметрами (dependency injection), тогда функцию можно тестировать без подмены `Date.now`.
:::

### 2. Иммутабельные операции над списком · средне

Состояние — массив задач `{ id, title, done }`. Реализуйте без мутации `toggle(list, id)`, `remove(list, id)`, `insertAt(list, index, item)` и `move(list, from, to)`. Неизменённые элементы должны оставаться теми же объектами (`===`).

::: details Решение и разбор
```js
const toggle = (list, id) =>
  list.map((item) => (item.id === id ? { ...item, done: !item.done } : item));

const remove = (list, id) => list.filter((item) => item.id !== id);

const insertAt = (list, index, item) => list.toSpliced(index, 0, item);

const move = (list, from, to) => {
  const item = list[from];
  return list.toSpliced(from, 1).toSpliced(to, 0, item);
};
```

- `toggle` копирует массив и **один** элемент. Остальные элементы общие со старой версией — это structural sharing. Компонент строки, мемоизированный по ссылке (`v-memo`, `shallowRef`-элементы), перерисуется только для изменённой задачи.
- `move` через два `toSpliced` создаёт два массива. Это O(n), как и любой вариант без мутации. `to` трактуется как индекс в итоговом массиве. Можно сделать одну копию и мутировать её локально — функция останется чистой.
- `remove` для несуществующего `id` возвращает новый массив с тем же содержимым. Если важна стабильность ссылки (чтобы не будить наблюдателей), проверяют `findIndex` и возвращают исходный `list`.
- До ES2023 то же писали через `slice` и spread: `[...list.slice(0, i), item, ...list.slice(i)]`.

Сложность: O(n) по времени и памяти на операцию; элементы не копируются, кроме изменённого.
:::

### 3. Сортировка в computed · легко

Компонент получает список пользователей от родителя и показывает его отсортированным. После этого у родителя «сам собой» меняется порядок в другой таблице, которая использует тот же массив. Найдите причину и исправьте.

```ts
const props = defineProps<{ users: User[] }>();
const sorted = computed(() => props.users.sort((a, b) => a.age - b.age));
```

::: details Решение и разбор
```ts
const sorted = computed(() => props.users.toSorted((a, b) => a.age - b.age));
```

`sort` сортирует массив на месте и возвращает **тот же** массив. `props.users` — реактивный массив родителя, поэтому геттер `computed` мутирует состояние родителя, и вторая таблица перерисовывается в новом порядке. Защита props «только для чтения» поверхностная и не мешает менять содержимое вложенного массива. Проверено на Vue 3.5.45: после чтения такого `computed` исходный массив отсортирован.

- Геттер `computed` по документации не должен иметь побочных эффектов, а `sort` и `reverse` — частая ловушка: документация Vue предупреждает о них отдельно.
- Над реактивным массивом `toSorted()` возвращает новый **сырой** массив. Элементы в нём — реактивные прокси, как при чтении из источника. Сам `computed` при этом подписан на массив и пересчитается при его изменении.
- До ES2023 — `[...props.users].sort(...)` или `props.users.slice().sort(...)`.

Сложность: O(n log n) по времени, O(n) по памяти на копию.
:::

### 4. Снимок состояния для undo · средне

Нужно хранить историю версий реактивного состояния для undo. Первая версия падает с `DataCloneError`. После замены на `structuredClone(toRaw(state))` всё работает, пока в коде не появляется строчка из последнего блока. Объясните оба падения и сделайте надёжный снимок.

```js
const state = reactive({ todos: [], updatedAt: new Date() });
const history = [];

function commit() {
  history.push(structuredClone(state)); // DataCloneError
}

// later, elsewhere:
state.todos = apiItems.map((item) => reactive({ ...item }));
```

::: details Решение и разбор
`reactive` возвращает `Proxy`, а structured clone algorithm прокси не клонирует. `toRaw(state)` снимает только **внешний** прокси. Обычно этого достаточно: при записи Vue кладёт в сырой объект `toRaw(value)`, поэтому `state.todos.push(reactive(x))` сохраняет сырой объект. Но `state.todos = [...]` сохраняет сырой **массив**, а его элементы, созданные через `reactive`, остаются прокси. Клонирование снова падает. Проверено на Vue 3.5.45.

```js
import { isRef, toRaw } from 'vue';

function deepToRaw(value) {
  if (isRef(value)) return deepToRaw(value.value);
  const raw = toRaw(value);
  if (Array.isArray(raw)) return raw.map(deepToRaw);
  if (raw !== null && typeof raw === 'object' && Object.getPrototypeOf(raw) === Object.prototype) {
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, deepToRaw(v)]));
  }
  return raw; // Date, Map, Set, primitives: structuredClone handles them
}

function commit() {
  history.push(structuredClone(deepToRaw(state)));
}
```

- `deepToRaw` уже строит новые объекты и массивы. `structuredClone` поверх него нужен для `Date`, `Map`, `Set` и других встроенных типов, которые `deepToRaw` возвращает как есть.
- Без `isRef` `ref` внутри `reactive` склонировался бы как внутренности `RefImpl`: поля `dep`, `_rawValue`, `__v_isRef`.
- Ограничения: циклы дадут переполнение стека (нужна `WeakMap` посещённых), прокси внутри `Map`/`Set` по-прежнему падают, экземпляры классов станут обычными объектами.
- Лучшее решение — не плодить прокси в данных: `state.todos = apiItems` (Vue обернёт элементы лениво при чтении) или хранить состояние в `shallowRef` и обновлять иммутабельно. Тогда снимок для undo — просто ссылка на предыдущую версию, без копирования.

Сложность: O(n) по времени и памяти, где n — число узлов состояния.
:::

### 5. deepFreeze · средне

Реализуйте `deepFreeze(value)` для dev-проверки, что состояние не мутируют. Требования: замораживаются все вложенные объекты, включая свойства с символьными ключами; циклы не приводят к зависанию; геттеры не вызываются; функция не падает на typed arrays. Что `deepFreeze` гарантировать не может?

::: details Решение и разбор
```js
function deepFreeze(root) {
  const seen = new WeakSet();
  const stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    if (ArrayBuffer.isView(value)) continue; // non-empty typed arrays cannot be frozen
    for (const key of Reflect.ownKeys(value)) {
      const desc = Object.getOwnPropertyDescriptor(value, key);
      if ('value' in desc) stack.push(desc.value); // never call getters
    }
    Object.freeze(value);
  }
  return root;
}
```

- `Reflect.ownKeys` даёт и неперечисляемые, и символьные ключи. `Object.keys` пропустил бы их.
- Значения берутся из дескрипторов: обращение `value[key]` вызвало бы геттер, а у геттера могут быть побочные эффекты или исключение.
- `WeakSet` посещённых защищает от циклов и не держит объекты после проверки. Проверять `Object.isFrozen` вместо `seen` нельзя: уже замороженный снаружи объект может содержать незамороженные вложенные.
- Явный стек вместо рекурсии не переполняется на глубоких структурах.
- `Object.freeze` над непустым typed array бросает `TypeError`, поэтому такие значения пропускаются: их содержимое останется изменяемым.

Чего `deepFreeze` не гарантирует: `Map`, `Set` и `Date` меняются через внутренние слоты (`map.set` работает и после заморозки); объекты в замыканиях и за геттерами не обходятся; прототипы не замораживаются. Во Vue замороженный объект не становится реактивным (`reactive` возвращает его без прокси), поэтому замораживают данные, которые и не должны быть реактивными, или только в dev-режиме для отлова мутаций.

Сложность: O(n) по времени и памяти, где n — число объектов и свойств.
:::

## Источники

- [ECMAScript: Array.prototype.toSorted](https://tc39.es/ecma262/#sec-array.prototype.tosorted), [toReversed](https://tc39.es/ecma262/#sec-array.prototype.toreversed), [toSpliced](https://tc39.es/ecma262/#sec-array.prototype.tospliced), [with](https://tc39.es/ecma262/#sec-array.prototype.with), [Array.prototype.sort](https://tc39.es/ecma262/#sec-array.prototype.sort)
- [ECMAScript: Object.freeze](https://tc39.es/ecma262/#sec-object.freeze), [Object.groupBy](https://tc39.es/ecma262/#sec-object.groupby)
- [HTML Living Standard: structuredClone()](https://html.spec.whatwg.org/multipage/structured-data.html#dom-structuredclone), [Safe passing of structured data](https://html.spec.whatwg.org/multipage/structured-data.html#safe-passing-of-structured-data)
- [MDN: structuredClone()](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone), [The structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- [MDN: Shallow copy](https://developer.mozilla.org/en-US/docs/Glossary/Shallow_copy), [Deep copy](https://developer.mozilla.org/en-US/docs/Glossary/Deep_copy), [Pure function](https://developer.mozilla.org/en-US/docs/Glossary/Pure_function)
- [MDN: Object.freeze()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze), [Array: copying methods and mutating methods](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array#copying_methods_and_mutating_methods)
- [TC39: Active proposals](https://github.com/tc39/proposals), [Pipe operator](https://github.com/tc39/proposal-pipeline-operator), [Composites](https://github.com/tc39/proposal-composites), [Record & Tuple (withdrawn)](https://github.com/tc39/proposal-record-tuple)
- [Vue: Computed Properties — Best Practices](https://vuejs.org/guide/essentials/computed.html#best-practices)
- [Vue: List Rendering — Displaying Filtered/Sorted Results](https://vuejs.org/guide/essentials/list.html#displaying-filtered-sorted-results)
- [Vue: Props — One-Way Data Flow](https://vuejs.org/guide/components/props.html#one-way-data-flow)
- [Vue: Reactivity in Depth — Immutable Data](https://vuejs.org/guide/extras/reactivity-in-depth.html#immutable-data), [Reactivity API — Advanced (`shallowRef`, `toRaw`, `markRaw`)](https://vuejs.org/api/reactivity-advanced.html)
- [Vue: Watchers — Deep Watchers](https://vuejs.org/guide/essentials/watchers.html#deep-watchers)
- [Immer: Introduction](https://immerjs.github.io/immer/)
