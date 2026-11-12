---
title: Generics
level: ядро
---

# Generics

> **Коротко.** Generic — это функция, тип или класс с **параметром типа**: тип, который подставляется при использовании, как аргумент при вызове. Параметр нужен, чтобы выразить **связь** между типами: «возвращает элемент того же типа, что лежит в массиве», «ключ — один из ключей этого объекта». Аргументы типа компилятор обычно выводит сам по аргументам вызова, а `extends` задаёт ограничение, без которого с параметром внутри функции почти ничего нельзя сделать. В рантайме параметров типа нет: они стираются вместе с остальными типами.

**Связанные темы:** [Система типов: структурная типизация, `type` и `interface`](./type-system.md), [Сужение типов и discriminated unions](./narrowing.md), [Функции и `this`](../javascript/functions-and-this.md), [Прототипы и классы](../javascript/prototypes-and-classes.md)

## Теория

> [!NOTE]
> Версии сверены 2026-11-12: стабилен TypeScript 7.0 (7.0.2), 7.1 в бете с 20 октября 2026. В выводе аргументов типа 7.1 beta ничего не меняет. Единственное изменение, связанное с generics, — более строгая проверка параметра типа в ветках дистрибутивных conditional types; это тема «Utility, conditional и mapped types». Все примеры и решения ниже проверены `tsc` 7.0.2 с `--strict`.

### Параметр типа выражает связь

Функция `first(xs: any[]): any` теряет тип: результат `any`, и дальше проверок нет. `first(xs: unknown[]): unknown` честнее, но вызывающему коду придётся сужать результат, хотя он и так знает, что передал массив чисел. Параметр типа решает задачу иначе: он **связывает** вход с выходом.

```ts
function first<T>(xs: readonly T[]): T | undefined {
  return xs[0];
}

const n = first([1, 2, 3]); // number | undefined
const s = first(['a']);     // string | undefined
```

Это параметрический полиморфизм (parametric polymorphism): одна реализация работает для любого `T` и не зависит от того, какой он. Отсюда главное правило: параметр типа оправдан, только если он **встречается хотя бы дважды**, то есть связывает два места. `function len<T>(xs: T[]): number` ничего не связывает, и `xs: unknown[]` проще и точнее.

Перегрузки решают другую задачу: несколько разных сигнатур, когда тип результата зависит от аргумента нерегулярно. Если связь выражается одной формулой (`T` → `T[]`), generic лучше перегрузок.

### Где объявляются параметры типа

- **Функция:** `function f<T>(x: T)`, стрелка `const f = <T,>(x: T) => x`. Запятая в `<T,>` нужна только в `.tsx`, чтобы не спутать с JSX-тегом.
- **Тип и интерфейс:** `type Box<T> = { value: T }`, `interface Repo<T> { get(id: string): T }`.
- **Класс:** `class Store<T> { items: T[] = [] }`. Класс обобщён только по **экземпляру**: статические члены не могут ссылаться на параметр класса (ошибка 2302). Статический член один на все экземпляры, а `T` у каждого свой.

Важно, **где** стоит параметр. `interface Fn<T> { (x: T): T }` фиксирует `T` при использовании типа: `Fn<number>` принимает только числа. `interface Fn { <T>(x: T): T }` описывает generic-функцию, и `T` выбирается заново при каждом вызове. Это частый источник ошибок при типизации колбэков.

**Instantiation expressions** (с TypeScript 4.7) позволяют зафиксировать аргументы типа без вызова: `const makeErrorMap = makeMap<string, Error>` даёт функцию `() => Map<string, Error>`.

### Вывод аргументов типа

Явно аргументы пишут редко: `first<number>([1])` работает, но компилятор выведет (infer) `T` сам. Он сопоставляет типы аргументов с типами параметров и собирает **кандидатов** для каждого `T`, а потом выбирает из них. Несколько правил, которые объясняют почти все «странные» выводы:

- **Литералы.** `const a = id('a')` даёт `'a'`, а `let a = id('a')` — `string`. Для `T` без ограничения выводится литерал, но он расширяется (widening) при записи в изменяемое место. Если ограничение примитивное (`T extends string`), литерал сохраняется и в `let`.
- **Объекты и массивы** выводятся расширенными: `id([1, 2])` — `number[]`, `id({ k: 'x' })` — `{ k: string }`. Сохранить литералы помогают `as const` у аргумента или `const`-параметр типа (ниже).
- **Несколько кандидатов.** `pair<T>(a: T, b: T)` при вызове `pair(1, 'a')` не выводит `number | string`: компилятор не придумывает объединение, а берёт первого кандидата. Получается ошибка «Argument of type '"a"' is not assignable to parameter of type '1'». Если объединение и задумано, его указывают явно: `pair<number | string>(1, 'a')`.
- **Колбэки выводятся после остальных аргументов.** Стрелка без аннотаций параметров контекстно-зависима (context-sensitive): её параметры получают тип от `T`, поэтому компилятор сначала выводит `T` из остальных аргументов. `call((x) => x.toFixed(), 1)` компилируется, хотя колбэк стоит первым.
- **Нет кандидатов** — берётся значение по умолчанию, а без него ограничение или `unknown`.

Явный аргумент нужен, когда по значению нельзя вывести задуманный тип. Классика во Vue — `ref<User | null>(null)`: из `null` выводится `Ref<null>`, и присвоить пользователя потом нельзя.

### Ограничения: `extends` и `keyof`

Внутри тела про `T` без ограничения известно только то, что верно для **любого** типа: у него нельзя взять `.length` и даже `.toString()` (а вдруг `null`). Ограничение (constraint) `T extends X` сужает допустимые аргументы и открывает члены `X`:

```ts
function longest<T extends { length: number }>(a: T, b: T): T {
  return a.length >= b.length ? a : b;
}

function getProp<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
```

`K extends keyof T` — один параметр ограничивает другой: ключ должен быть ключом именно этого объекта, а результат `T[K]` — тип именно этого свойства. На этом паттерне построены `pick`, `pluck`, типизированные `emit` и `watch` по ключу.

Ограничение — нижняя граница, а не сам тип. Поэтому такой код не компилируется:

```ts
function make<T extends { id: number }>(): T {
  return { id: 1 };
  // Error: '{ id: number; }' is assignable to the constraint of type 'T',
  // but 'T' could be instantiated with a different subtype of constraint '{ id: number; }'.
}
```

Вызывающий может подставить `T = { id: number; name: string }` и получить объект без `name`. Тип `T` внутри тела непрозрачен: значение типа `T` можно только получить извне (аргументом) и вернуть, а не создать. Если функция действительно возвращает ровно `{ id: number }`, параметр типа не нужен.

### Значения по умолчанию

`type Res<T = unknown>` делает аргумент необязательным: `Res` — то же, что `Res<unknown>`. Правила: параметры со значением по умолчанию идут после обязательных (ошибка 2706), значение по умолчанию должно удовлетворять ограничению (`T extends string = number` — ошибка 2344), а при выводе оно используется, только если кандидатов нет.

Ограничение и значение по умолчанию часто путают. `T extends X` — «любой подтип `X`», проверяется всегда. `T = X` — «если ничего не сказано, то `X`», ничего не ограничивает. В библиотеках их пишут вместе: `<T extends HTMLElement = HTMLDivElement>`.

### `const`-параметры и `NoInfer`

**`const`-параметр типа** (с TypeScript 5.0) выводит тип так, будто к аргументу дописали `as const`: литералы, `readonly`-кортежи, литеральные поля объектов.

```ts
declare function routes<const T extends readonly string[]>(paths: T): T;
const r = routes(['/', '/about']); // readonly ["/", "/about"]
```

`const` влияет только на литералы, написанные прямо в вызове. Переменная `const arr = ['a']` уже имеет тип `string[]`, и `routes(arr)` даст `string[]`.

> [!NOTE]
> С ограничением-изменяемым массивом (`const T extends string[]`) TypeScript 5.0–5.2 молча выводил `string[]`: `readonly`-кортеж не подходил под ограничение. С TypeScript 5.3 выводится изменяемый кортеж `["a", "b"]`. Ограничение `readonly unknown[]` работает одинаково во всех версиях, поэтому его и пишут.

**`NoInfer<T>`** (с TypeScript 5.4) запрещает выводить `T` из этого места. В `select(options: T[], initial: T)` вызов `select(['a', 'b'], 'c')` компилируется: `'c'` стал кандидатом, и `T = 'a' | 'b' | 'c'`. С `initial: NoInfer<T>` тип выводится только из `options`, и `'c'` — ошибка. Раньше то же делали трюком `initial: T & {}` или вторым параметром `U extends T`.

### Generics стираются

Параметр типа — тип, а не значение, поэтому в рантайме его нет. `new T()` и `x instanceof T` — ошибка 2693 «'T' only refers to a type». Создавать экземпляры можно, только получив конструктор аргументом:

```ts
function create<T, A extends unknown[]>(Ctor: new (...args: A) => T, ...args: A): T {
  return new Ctor(...args);
}
```

`A extends unknown[]` в позиции rest-параметра выводится как кортеж аргументов конструктора. Для `class Point { constructor(x: number, y: number) }` вызов `create(Point, 1, '2')` — ошибка и по типу, и по числу аргументов.

> [!WARNING]
> Из перегруженной сигнатуры вывод берёт **последнюю** перегрузку. У `Date` она принимает один аргумент, поэтому `create(Date, 2026, 0)` не компилируется («Expected 2 arguments, but got 3»), хотя `new Date(2026, 0)` работает. То же касается `Parameters<typeof f>` и `ReturnType` для перегруженных функций.

### Вариантность generic-типов

Вариантность разобрана в [«Системе типов»](./type-system.md): она описывает, присваивается ли `Box<Dog>` типу `Box<Animal>`. Для generics её выводит компилятор по тому, где используется `T`: только на выходе — ковариантен, только на входе (параметр функции) — контравариантен, и там, и там — инвариантен. Поэтому `Container<T>` с методами `get(): T` и `set(v: T)`, записанными как свойства-функции, не присваивается `Container<unknown>`. Это не ошибка компилятора, а честное «в `Container<unknown>` можно записать что угодно».

Аннотации `in`/`out` (с TypeScript 4.7) не меняют поведение. Они фиксируют вариантность для скорости проверки и для отладки. Handbook прямо пишет: аннотация, не совпадающая со структурной вариантностью, — ошибка, и писать их почти никогда не нужно.

> [!TIP]
> Три правила из Handbook для хороших generic-функций. **Опускайте параметр вниз**: `<T>(xs: T[]): T` лучше, чем `<A extends any[]>(xs: A): A[number]`, потому что компилятору проще выводить и проще читать ошибку. **Меньше параметров**: каждый должен что-то связывать. **Параметр встречается дважды**: если `T` появляется один раз, замените его на ограничение.

## Примеры

```ts
// Generic composable: T links the default value, the ref and the setter.
import { ref, watch, type Ref } from 'vue';

export function useStorage<T>(key: string, initial: T): Ref<T> {
  const raw = localStorage.getItem(key);
  const state = ref(raw === null ? initial : (JSON.parse(raw) as T)) as Ref<T>;
  watch(state, (v) => localStorage.setItem(key, JSON.stringify(v)), { deep: true });
  return state;
}

const theme = useStorage('theme', 'light' as 'light' | 'dark'); // Ref<'light' | 'dark'>
const user = ref<{ id: number } | null>(null); // explicit: ref(null) would be Ref<null>
```

`as Ref<T>` здесь нужен из-за того, что `ref` разворачивает вложенные `ref` в типе (`UnwrapRef<T>`). Для произвольного `T` компилятор не может доказать, что `Ref<UnwrapRef<T>>` — это `Ref<T>`. Подробнее о типах `ref` — в теме «TypeScript во Vue».

```ts
// A typed API client: the path decides the response type.
interface Api {
  '/users': { id: number; name: string }[];
  '/me': { id: number; email: string };
}

async function get<P extends keyof Api>(path: P): Promise<Api[P]> {
  const res = await fetch(path);
  return res.json() as Promise<Api[P]>;
}

const me = await get('/me'); // { id: number; email: string }
```

Здесь виден компромисс: `as` на границе с `fetch` всё равно нужен, но он один и спрятан в функции. Снаружи API строго типизирован, а опечатка в пути — ошибка компиляции.

## Вопросы с интервью

::: details Зачем нужны generics и чем они лучше any, unknown и перегрузок?
Generic выражает связь между типами: тип результата зависит от типа аргумента. `any` эту связь теряет и отключает проверки. `unknown` безопасен, но заставляет вызывающего сужать результат, который он и так знает. Перегрузки перечисляют сигнатуры по одной и не масштабируются, если связь описывается одной формулой: `T` → `T[]`, ключ → тип свойства. Перегрузки уместны, когда зависимость нерегулярная. Признак правильного generic — параметр встречается хотя бы дважды. `function len<T>(xs: T[]): number` ничего не связывает, `unknown[]` проще.
:::

::: details Как TypeScript выводит аргументы типа и когда их нужно указывать явно?
Компилятор сопоставляет типы аргументов с типами параметров и собирает кандидатов для каждого параметра. Затем выбирает из них, при этом объединение сам не придумывает: `pair(1, 'a')` при `pair<T>(a: T, b: T)` — ошибка, а не `number | string`. Литералы выводятся как литералы, но расширяются в `let` и в полях объектов, если ограничение не примитивное. Контекстно-зависимые колбэки обрабатываются после остальных аргументов, поэтому порядок аргументов почти не важен. Явно указывают, когда по значению нельзя вывести задуманный тип: `ref<User | null>(null)`, пустой массив `useState<string[]>([])`, или когда нужен более широкий тип, чем у литерала.
:::

::: details Почему нельзя вернуть объект как T, если он подходит под ограничение?
Ограничение `T extends { id: number }` означает «любой подтип», а выбирает его вызывающий. Он может подставить `{ id: number; name: string }` и ожидать объект с `name`, а функция вернёт только `id`. Отсюда ошибка «could be instantiated with a different subtype of constraint». Внутри тела `T` непрозрачен: значение этого типа можно получить извне и вернуть, а создать нельзя. Решения: убрать параметр, если функция всегда возвращает `{ id: number }`; принять значение или фабрику аргументом; или, если это осознанный компромисс библиотеки, поставить `as T` в одном месте.
:::

::: details Чем ограничение extends отличается от значения по умолчанию у параметра типа?
`T extends X` — проверка: аргумент обязан быть подтипом `X`, а внутри тела доступны члены `X`. `T = X` — подстановка, когда аргумент не указан и вывести его не из чего. Она ничего не ограничивает: `Res<number>` при `Res<T = string>` допустим. Их комбинируют: `<T extends HTMLElement = HTMLDivElement>`. Правила для значений по умолчанию: такие параметры идут после обязательных, значение по умолчанию удовлетворяет ограничению, и при выводе оно используется только при отсутствии кандидатов.
:::

::: details Что дают const type parameters и NoInfer?
`const`-параметр (TypeScript 5.0) выводит аргумент как с `as const`: литералы и `readonly`-кортежи вместо `string[]`. Удобно для конфигураций, списков маршрутов, ключей. Ограничение лучше писать `readonly unknown[]`: с изменяемым массивом до 5.3 вывод молча откатывался к `string[]`. Работает только для литералов прямо в вызове. `NoInfer<T>` (5.4) исключает место из вывода: в `select(options: T[], initial: NoInfer<T>)` тип берётся только из `options`, и `initial` проверяется против него, а не расширяет `T`. Без `NoInfer` `select(['a', 'b'], 'c')` компилируется, потому что `'c'` становится кандидатом.
:::

::: details Что от generics остаётся в рантайме?
Ничего: параметры типа стираются, как все типы. Поэтому `new T()`, `instanceof T` и `typeof T` в выражении — ошибка «only refers to a type». Если нужен экземпляр, передают конструктор `new (...args: A) => T` или фабрику `() => T`. Если нужна проверка, передают предикат или схему (Zod), из которой выводится тип. Ещё следствие: статические члены класса не видят параметр класса, потому что статика одна на все экземпляры, а `T` у каждого свой. По той же причине нельзя перегрузить функцию по `T`: в рантайме останется одна реализация.
:::

::: details Почему контейнер строк не присваивается контейнеру unknown, хотя string присваивается unknown?
Из-за вариантности. Если `T` стоит и в выходе (`get(): T`), и во входе (`set: (v: T) => void`), тип инвариантен. Иначе через `Container<unknown>` можно было бы записать число в контейнер строк. Компилятор вычисляет вариантность по использованию `T` автоматически. Аннотации `in`/`out` (4.7) её не меняют, а только фиксируют и ускоряют проверку, и Handbook предупреждает: аннотация, расходящаяся со структурой, — ошибка. Методы, объявленные синтаксисом `set(v: T): void`, проверяются бивариантно, поэтому с ними контейнер присвоится, но это дыра, а не свойство. Если в API нужен «контейнер чего угодно», используют `Container<any>` в одном месте или разделяют интерфейс на читающую и пишущую части.
:::

## Задачи

### 1. `pluck` · легко

Напишите `pluck(items, key)`: возвращает массив значений поля. Тип результата должен следовать из ключа, а несуществующий ключ — быть ошибкой.

```ts
const users = [{ id: 1, name: 'Ann' }, { id: 2, name: 'Bob' }];
pluck(users, 'name');  // string[]
pluck(users, 'email'); // Error
```

::: details Решение и разбор
```ts
function pluck<T, K extends keyof T>(items: readonly T[], key: K): T[K][] {
  return items.map((item) => item[key]);
}
```

`T` выводится из массива, `K` — из второго аргумента, и ограничение `keyof T` отвергает `'email'` с ошибкой «not assignable to parameter of type '"id" | "name"'». `T[K]` — indexed access type: тип того поля, чей ключ передан, поэтому `pluck(users, 'id')` даёт `number[]`. `readonly T[]` в параметре принимает и обычные, и `readonly`-массивы.

Если передать ключ из переменной типа `'id' | 'name'`, результат будет `(string | number)[]`: `T[K]` распределяется по объединению ключей.

Сложность: O(n) по времени и памяти.
:::

### 2. Что выведет компилятор · средне

Назовите тип каждой переменной или ошибку.

```ts
declare function id<T>(x: T): T;
declare function idS<T extends string>(x: T): T;
declare function pair<T>(a: T, b: T): T;
declare function call<T>(f: (x: T) => void, x: T): void;
declare function tuple<const T extends string[]>(x: T): T;
declare function d<T = string>(x?: T): T;

const a = id('a');            // 1
let b = id('a');              // 2
let c = idS('a');             // 3
const e = pair(1, 'a');       // 4
call((x) => x.toFixed(), 1);  // 5
const f = tuple(['a', 'b']);  // 6
const g = d();                // 7
```

::: details Решение и разбор
1. **`'a'`.** Для параметра без ограничения выводится литерал, и `const` его сохраняет.
2. **`string`.** Тот же литерал расширяется при записи в `let`.
3. **`'a'`.** Ограничение `string` — примитивное, литерал не расширяется даже в `let`.
4. **Ошибка** «Argument of type '"a"' is not assignable to parameter of type '1'». Первый кандидат — `1`, объединение компилятор не строит.
5. **Компилируется**, `T = number`. Колбэк контекстно-зависим, и `T` выводится сначала из `1`.
6. **`["a", "b"]`** (изменяемый кортеж) с TypeScript 5.3. В 5.0–5.2 было `string[]`.
7. **`string`.** Кандидатов нет, берётся значение по умолчанию.

Все ответы проверены на TypeScript 7.0.2 (`--strict`), пункт 6 — дополнительно на 5.0, 5.2 и 5.3.
:::

### 3. Типизированный EventEmitter · средне

Типизируйте шину событий: карта событий задаёт тип payload, `on` и `emit` проверяют имя события и данные, `on` возвращает функцию отписки. Реализация самого `EventEmitter` — в live coding; здесь главное — типы.

```ts
type AppEvents = { login: { userId: number }; logout: undefined };
const bus = new Emitter<AppEvents>();
bus.on('login', (p) => p.userId); // p: { userId: number }
bus.emit('login', { id: 1 });     // Error
bus.emit('signup', {});           // Error
```

::: details Решение и разбор
```ts
type Listener<A> = (payload: A) => void;

class Emitter<Events extends Record<string, unknown>> {
  private listeners: { [E in keyof Events]?: Set<Listener<Events[E]>> } = {};

  on<E extends keyof Events>(event: E, fn: Listener<Events[E]>): () => void {
    (this.listeners[event] ??= new Set()).add(fn);
    return () => this.listeners[event]?.delete(fn);
  }

  emit<E extends keyof Events>(event: E, payload: Events[E]): void {
    this.listeners[event]?.forEach((fn) => fn(payload));
  }
}
```

Два уровня параметров. `Events` стоит на классе и фиксируется один раз при создании шины. `E` стоит на методах и выбирается заново при каждом вызове, поэтому `on('login', …)` и `on('logout', …)` получают разные типы payload. Если бы `E` был параметром класса, вся шина работала бы с одним событием.

Хранилище — mapped type: для каждого ключа свой `Set` слушателей нужного типа. Без него пришлось бы хранить `Set<Listener<any>>` и терять проверку внутри класса.

Так же типизирован `defineEmits` во Vue: карта событий → тип `emit`. Об этом — в теме «TypeScript во Vue».

Сложность: `on` — O(1), `emit` — O(k), где k — число слушателей события.
:::

### 4. Select с допустимыми значениями · средне

Напишите `createSelect(options, initial)`: значения — литералы из `options`, `initial` и `set` принимают только их. `options` передаются литералом прямо в вызове, без `as const`.

```ts
const size = createSelect(['sm', 'md', 'lg'], 'md');
size.set('lg');                            // OK
createSelect(['sm', 'md', 'lg'], 'xl');    // Error
size.set('xs');                            // Error
```

::: details Решение и разбор
```ts
function createSelect<const T extends string>(options: readonly T[], initial: NoInfer<T>) {
  let current: T = initial;
  return {
    options,
    get: () => current,
    set: (v: T) => { current = v; },
  };
}
```

Два приёма работают вместе. `const` даёт `T = 'sm' | 'md' | 'lg'` вместо `string`: без него литералы в массиве расширились бы. В этом случае хватило бы и ограничения `T extends string`: примитивное ограничение само сохраняет литералы. `const` делает намерение явным и сохраняет литералы, если ограничение потом расширят.

`NoInfer<T>` (TypeScript 5.4) убирает `initial` из вывода. Без него `'xl'` стал бы ещё одним кандидатом, `T` вывелся бы как `'sm' | 'md' | 'lg' | 'xl'`, и ошибки не было бы. Решение до 5.4 — второй параметр: `<T extends string, I extends T>(options: readonly T[], initial: I)`.

Сложность: O(1) на операцию.
:::

### 5. DI-контейнер с типизированными ключами · сложно

Сделайте контейнер зависимостей: `createKey<T>(name)` создаёт ключ, `register(key, factory)` проверяет, что фабрика возвращает `T`, а `resolve(key)` возвращает `T` без `as` в вызывающем коде. Ключ `Key<string>` не должен подходить туда, где ждут `Key<number>`.

```ts
const ApiUrl = createKey<string>('ApiUrl');
container.register(ApiUrl, () => 'https://api.example.com');
container.register(ApiUrl, () => 42); // Error
const url = container.resolve(ApiUrl); // string
```

::: details Решение и разбор
```ts
interface Key<T> {
  readonly description: string;
  readonly __type?: T; // phantom: never set, only carries T
}

function createKey<T>(description: string): Key<T> {
  return { description };
}

class Container {
  private factories = new Map<Key<unknown>, () => unknown>();
  private cache = new Map<Key<unknown>, unknown>();

  register<T>(key: Key<T>, factory: () => T): void {
    this.factories.set(key, factory);
  }

  resolve<T>(key: Key<T>): T {
    if (!this.cache.has(key)) {
      const factory = this.factories.get(key);
      if (!factory) throw new Error(`No provider for ${key.description}`);
      this.cache.set(key, factory());
    }
    return this.cache.get(key) as T;
  }
}
```

**Фантомный параметр.** Значение `T` в ключе не хранится, ключ — просто объект с именем. Но при структурной типизации неиспользуемый параметр ничего не различает: у `interface Key<T> { description: string }` типы `Key<string>` и `Key<number>` одинаковы. Поэтому `T` нужно упомянуть в структуре: необязательное поле `__type?: T`, которое никогда не заполняется. Теперь `Key<string>` и `Key<number>` различаются, а `register(ApiUrl, () => 42)` — ошибка: кандидаты `string` и `number` не сходятся.

**Вариантность.** Поле `__type?: T` делает ключ ковариантным, и `Key<string>` присваивается `Key<unknown>`: это нужно для `Map<Key<unknown>, …>`. Первая мысль — сделать поле функцией `(v: T) => T`, чтобы ключ был строже. Но тогда ключ инвариантен, и `this.factories.set(key, …)` перестаёт компилироваться: `Key<T>` не присваивается `Key<unknown>`.

**`as T` в `resolve`** неизбежен: `Map` хранит значения разных типов, и связь «ключ → тип значения» компилятор через `Map` не протаскивает. Небезопасное место одно, и его корректность гарантирует `register`.

**Как это сделано во Vue.** `InjectionKey<T>` — `symbol & InjectionConstraint<T>`, где `InjectionConstraint<T>` — пустой интерфейс. Параметр не используется в структуре, поэтому `InjectionKey<string>` присваивается `InjectionKey<number>` (проверено на типах Vue 3.5.45). Вывод при этом работает: `inject(key)` выводит `T` из аргумента того же generic-типа, сопоставляя аргументы типа напрямую. Так что `provide`/`inject` защищают от ошибки в значении, но не от подмены одного ключа другим.

Сложность: `register` и `resolve` — O(1) в среднем.
:::

## Источники

- [TypeScript Handbook: Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html)
- [TypeScript Handbook: More on Functions — generic functions, guidelines for writing good generic functions](https://www.typescriptlang.org/docs/handbook/2/functions.html#generic-functions)
- [TypeScript 4.7 Release Notes: instantiation expressions, variance annotations](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-7.html)
- [TypeScript 5.0 Release Notes: `const` type parameters](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html)
- [TypeScript 5.4 Release Notes: the `NoInfer` utility type](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-4.html)
- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [Announcing TypeScript 7.1 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)
- [Vue: Typing Provide / Inject — `InjectionKey`](https://vuejs.org/guide/typescript/composition-api.html#typing-provide-inject)
- [Vue: Reactivity API — `ref`](https://vuejs.org/api/reactivity-core.html#ref)
