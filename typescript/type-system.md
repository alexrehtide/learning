---
title: 'Система типов: структурная типизация, `type` и `interface`'
level: ядро
---

# Система типов: структурная типизация, `type` и `interface`

> **Коротко.** TypeScript сравнивает типы по **форме**, а не по имени: значение подходит под тип, если у него есть нужные члены с совместимыми типами. Это структурная типизация (structural typing), и она описывает то, как JavaScript-код на самом деле работает с объектами. Тип удобно понимать как множество значений: `unknown` — все значения, `never` — пустое множество, `|` — объединение, `&` — пересечение. Типы стираются при компиляции, поэтому в рантайме их нет. `type` и `interface` почти взаимозаменяемы. Главная разница: `interface` можно дополнить повторным объявлением, а `type` умеет описывать не только объекты.

**Связанные темы:** [Сужение типов и discriminated unions](./narrowing.md), [Generics](./generics.md), [Типы данных и приведение типов](../javascript/types-and-coercion.md), [Прототипы и классы](../javascript/prototypes-and-classes.md), [Функции и `this`](../javascript/functions-and-this.md), [Модули: ESM и CommonJS](../javascript/modules.md)

## Теория

> [!NOTE]
> Версии сверены 2026-11-12. Стабильная версия — **TypeScript 7.0** (7.0.2, релиз 8 июля 2026). Это нативный порт компилятора на Go, в среднем в 8–12 раз быстрее на полной сборке. Пакет и команда прежние: `typescript` и `tsc`. Система типов в 7.0 та же, что в 6.0. Код, который чисто компилируется в 6.0 с `stableTypeOrdering` и без `ignoreDeprecations`, в 7.0 компилируется так же. TypeScript 7.1 — в бете (с 20 октября 2026). Публичного API у 7.0 нет, поэтому инструменты, которые встраивают компилятор (typescript-eslint, Volar и `vue-tsc`), пока работают на 6.0 через пакет `@typescript/typescript6`.

### Типы стираются

TypeScript — надстройка над JavaScript: компилятор проверяет типы и выбрасывает их, а не превращает в рантайм-проверки. Следствия:

- **Типа нельзя проверить в рантайме.** `if (x instanceof User)` работает только для классов, потому что класс — значение. `interface User` после компиляции исчезает, и проверять приходится форму: `'id' in x`. Данные из `fetch`, `localStorage` и `JSON.parse` компилятор не проверяет. Для них нужна валидация схемой (Zod, Valibot) или своя проверка.
- **Утверждение типа (type assertion) — не приведение.** `x as User` ничего не делает в рантайме, это обещание компилятору. `as unknown as T` проходит всегда, поэтому каждое такое место — дыра в проверках.
- **Перегрузки и типы не влияют на поведение.** Поведение задаёт только JavaScript-код.

Почти весь синтаксис TypeScript стирается. Исключения генерируют код: `enum`, `namespace` с кодом внутри, parameter properties (`constructor(private x: number)`) и `import x = require()`. Флаг `erasableSyntaxOnly` (с TypeScript 5.8) запрещает эти конструкции. Его включают, когда код запускают через удаление типов (type stripping) без компиляции: так работает Node.js, и так, по сути, работают esbuild и Vite, которые транспилируют файл без проверки типов.

### Структурная типизация

В номинальной типизации (Java, C#) `Dog` совместим с `Animal`, только если объявлен его наследником. В TypeScript `Dog` совместим с `Animal`, если у `Dog` есть все обязательные члены `Animal` с совместимыми типами. Лишние члены не мешают. Имя типа, `implements` и `extends` здесь не нужны. `implements` только просит компилятор проверить форму класса заранее.

Так проверяется **присваиваемость** (assignability): присваивание, передача аргумента, возврат из функции, `extends` и `implements`. «`S` присваивается `T`» значит, что множество значений `S` входит в множество `T`.

Структурная типизация повторяет то, как работает JavaScript (duck typing). Функции нужен объект с полем `name`, и ей не важно, создан он литералом, классом или пришёл из JSON.

Где сравнение номинальное:

- **Классы с `private`, `protected` и `#private` членами.** Такой член совместим только с членом из *того же объявления класса*. Два класса одинаковой формы с `private id` несовместимы, а наследник совместим с родителем. Статические члены и конструктор в сравнении экземпляров не участвуют.
- **Enum.** Значения разных enum не присваиваются друг другу, даже если оба равны `0`. Числовой enum принимает переменную типа `number`, но с TypeScript 5.0 литерал `5` без соответствующего члена — ошибка.
- **`unique symbol`.** Каждое объявление даёт отдельный тип.

Номинальность для примитивов эмулируют **брендированием** (branded types): `type UserId = string & { readonly __brand: 'UserId' }`. Строку-литерал такому типу не присвоить, а `UserId` остаётся строкой при чтении. В рантайме бренда нет, значение создают через функцию-конструктор с проверкой и `as`.

### Тип как множество значений

| Тип | Множество | Присваивание |
| --- | --- | --- |
| `unknown` | все значения (top type) | принимает всё, отдаётся только в `unknown` и `any` |
| `never` | пустое множество (bottom type) | отдаётся куда угодно, не принимает ничего |
| `any` | выключатель проверки | присваивается в обе стороны (кроме `never`) |
| `'GET'` | одно значение | — |
| `string` | все строки | — |

`any` — не top type, а отказ от проверки: он «заражает» выражения, в которых участвует. Для значений неизвестной формы берут `unknown`: перед использованием его придётся сузить (см. [Сужение типов и discriminated unions](./narrowing.md)).

**Объединение** `A | B` — значение из `A` *или* из `B`. Без проверки доступны только общие члены. **Пересечение** `A & B` — значение, которое одновременно `A` *и* `B`, то есть у него все члены обоих типов. Отсюда кажущийся парадокс:

- `keyof (A | B)` — только общие ключи: объединение множеств значений даёт меньше гарантий.
- `keyof (A & B)` — все ключи обоих: пересечение множеств значений даёт больше гарантий.
- `string & number` — `never`: нет значения, которое одновременно строка и число.
- `{ a: string } & { a: number }` — свойство `a` типа `never`. Если конфликтуют дискриминанты (`{ kind: 'a' } & { kind: 'b' }`), с TypeScript 3.9 весь объект схлопывается в `never`.

Пустой объектный тип `{}` значит «любое значение, кроме `null` и `undefined`», включая примитивы: `const x: {} = 1` компилируется. `object` — любое непримитивное значение. `Object` (с большой буквы) почти совпадает с `{}`, его не используют. «Любой объект» записывают как `Record<string, unknown>` или `object`, а «вообще что угодно» — как `unknown`.

### Литеральные типы и расширение

`const method = 'GET'` получает тип `'GET'`: переменная не изменится. `let method = 'GET'` получает `string`. Это **расширение** (widening). В объекте `{ method: 'GET' }` свойство тоже расширяется до `string`, потому что свойство можно перезаписать. Тип описывает и чтение, и запись.

Как сохранить литералы:

- **`as const`** — всё дерево становится `readonly`, литералы не расширяются, массивы становятся `readonly`-кортежами.
- **Аннотация** `const req: Request = …` — проверка против `Request`, но тип переменной теперь `Request`, а конкретные ключи и литералы теряются.
- **`satisfies`** (с TypeScript 4.9) — проверка против типа, при этом **выведенный тип сохраняется**. `const routes = { … } satisfies Record<string, Route>` проверяет каждое значение, но `keyof typeof routes` остаётся объединением конкретных ключей, а не `string`. `as const satisfies T` даёт и литералы, и проверку.

### Проверка лишних свойств

Структурная типизация разрешает лишние свойства, но есть исключение. **Свежий** (fresh) объектный литерал, который сразу присваивают типу, проверяется на лишние свойства (excess property checking): `const p: Point = { x: 1, y: 2, z: 3 }` — ошибка. Если тот же объект сначала положить в переменную, проверки не будет: литерал уже не свежий. Смысл правила: в литерале лишнее свойство почти всегда опечатка (`colour` вместо `color`), а в существующем объекте это просто данные, о которых тип не знает.

Свежесть пропадает при сохранении литерала в переменную и при `as`. Проверка учитывает объединения: лишним считается ключ, которого нет **ни в одном** члене объединения. Отдельное правило — **weak type detection**: тип из одних необязательных свойств (`{ a?: number; b?: string }`) не принимает объект, у которого нет **ни одного** общего с ним свойства, даже если объект не свежий.

### Совместимость функций и вариантность

Функция `S` присваивается функции `T`, если:

- **параметров у `S` не больше**: `arr.forEach((x) => …)` передаёт три аргумента, а колбэк берёт один. Лишние аргументы JS просто игнорирует;
- **параметры контравариантны**: `S` должна принимать всё, что передаст вызывающий по типу `T`. Обработчик `(e: Event) => void` подходит туда, где ждут `(e: MouseEvent) => void`, наоборот — нет;
- **результат ковариантен**: `S` возвращает подтип результата `T`. `() => void` в позиции колбэка принимает функцию, которая что-то возвращает (`push` возвращает число). Объявленная `function f(): void` вернуть значение не может.

**Вариантность** (variance) описывает, как совместимость `F<Dog>` и `F<Animal>` следует из совместимости `Dog` и `Animal`. Ковариантность — в ту же сторону (`() => Dog` присваивается `() => Animal`), контравариантность — в обратную (`(a: Animal) => void` присваивается `(d: Dog) => void`). Для [generics](./generics.md) TypeScript вычисляет вариантность сам, а явно её задают аннотациями `in`/`out` (с 4.7): `interface Producer<out T>`.

Параметры контравариантны только при `strictFunctionTypes` (часть `strict`), и только для **типов функций**. Параметры **методов** (синтаксис `set(v: T): void`) остаются **бивариантными**: компилятор принимает параметр и уже, и шире. Это намеренная дыра. Без неё `Array<Dog>` не присваивался бы `Array<Animal>`, потому что у массива есть метод `push(item: T)`. Отсюда же **ковариантность массивов**: `const animals: Animal[] = dogs; animals.push(cat)` компилируется, и в массиве собак оказывается кошка.

> [!TIP]
> Для обработчиков и колбэков в своих интерфейсах пишите свойство с типом функции, `onChange: (v: T) => void`, а не метод `onChange(v: T): void`. Тогда сработает строгая проверка параметров. Правило typescript-eslint `method-signature-style` переписывает такие сигнатуры автоматически.

### `readonly` и необязательные свойства

- `readonly` на свойстве запрещает запись **через этот тип**, но присваиваемость не меняет: `{ readonly x: number }` молча присваивается `{ x: number }`, и через вторую ссылку объект можно изменить. Это не `Object.freeze`, а подсказка компилятору.
- `readonly T[]` (или `ReadonlyArray<T>`) — другой тип: в нём нет `push`, `sort` и `splice`, и в `T[]` его не присвоить. Обратно можно.
- `a?: number` без флага `exactOptionalPropertyTypes` значит «`a` нет или он `undefined`». С флагом `{ a: undefined }` — ошибка: «нет ключа» и «ключ со значением `undefined`» различаются, как в `'a' in obj` и `Object.keys`.

### `type` и `interface`

**`type`** — псевдоним (type alias) для **любого** типа: примитива, объединения, кортежа, функции, mapped или conditional type. **`interface`** описывает только объектную форму (включая функции и классы как объекты).

| | `interface` | `type` |
| --- | --- | --- |
| Объединения, кортежи, примитивы, mapped types | нет | да |
| Расширение | `extends`, с проверкой конфликтов | `&`, конфликт молча даёт `never` |
| Слияние объявлений | да | нет: `Duplicate identifier` |
| Неявная индексная сигнатура | нет | да |
| Имя в ошибках и подсказках | всегда сохраняется | может раскрыться в структуру |

Разберём строки таблицы.

- **Расширение.** `interface B extends A { a: number }` при `a: string` в `A` — ошибка в месте объявления. `type B = A & { a: number }` — ошибки нет, а `a` получается типа `never`, и ошибка всплывает позже и в другом месте.
- **Слияние объявлений** (declaration merging). Два `interface Window` в одной области сливаются в один. Через это расширяют чужие типы: глобальный `Window`, `ProcessEnv`, интерфейсы библиотек через `declare module` (module augmentation).
- **Неявная индексная сигнатура.** Объект типа-псевдонима `{ a: string }` присваивается `Record<string, string>`, а объект `interface` с той же формой — нет. Интерфейс открыт для слияния, и компилятор не может гарантировать, что потом не добавятся свойства других типов.
- **Производительность.** Компилятор кэширует отношения между именованными интерфейсами, а пересечения каждый раз пересчитывает по свойствам. На больших иерархиях `extends` заметно дешевле цепочек `&`. Это рекомендация из TypeScript wiki «Performance».

Практическое правило из Handbook: `interface` для объектных форм, пока не понадобится то, что умеет только `type`. Многие команды выбирают наоборот, `type` по умолчанию, ради единообразия. Важнее единый стиль (правило typescript-eslint `consistent-type-definitions`), чем конкретный выбор. Публичные расширяемые API библиотек описывают через `interface`, иначе пользователи не смогут их дополнить.

## Примеры

```ts
// Structural: Vec is never declared as Point, but it fits.
interface Point { x: number; y: number }
class Vec {
  constructor(public x: number, public y: number) {}
  length() { return Math.hypot(this.x, this.y); }
}
const p: Point = new Vec(3, 4); // OK: extra members are fine

// Excess property check applies only to fresh literals.
const raw = { x: 1, y: 2, z: 3 };
const ok: Point = raw;                     // OK: not fresh
const typo: Point = { x: 1, y: 2, z: 3 };  // Error: 'z' does not exist in type 'Point'

// Private members make classes nominal.
class A { private id = 1 }
class B { private id = 1 }
const a: A = new B(); // Error: types have separate declarations of a private property 'id'
```

```ts
// Widening, as const and satisfies.
declare function request(url: string, method: 'GET' | 'POST'): void;

const req = { url: '/api', method: 'GET' };
request(req.url, req.method); // Error: string is not assignable to 'GET' | 'POST'

const req2 = { url: '/api', method: 'GET' } as const;
request(req2.url, req2.method); // OK: method is 'GET'

type Theme = Record<string, `#${string}`>;
const colors = { primary: '#42b883', danger: '#e53935' } satisfies Theme;
type ColorName = keyof typeof colors; // 'primary' | 'danger', not string
```

```ts
// Declaration merging: augmenting Vue and Pinia types (module augmentation).
import 'vue';
import 'pinia';

declare module 'vue' {
  interface ComponentCustomProperties {
    $t: (key: string) => string; // now `$t` type-checks in every template
  }
}

declare module 'pinia' {
  export interface PiniaCustomProperties {
    router: import('vue-router').Router; // added by a Pinia plugin
  }
}
```

Слияние работает именно потому, что `ComponentCustomProperties` и `PiniaCustomProperties` объявлены через `interface`. Файл с `declare module` обязан быть модулем (иметь `import` или `export`), иначе объявление заменит модуль `'vue'` целиком, а не дополнит его.

> [!NOTE]
> В TypeScript 6.0 изменились дефолты, и 7.0 их сохранил: `strict: true`, `module: esnext`, `target` — последняя стабильная редакция ECMAScript, `types: []`. Раньше `strict` по умолчанию был выключен, поэтому в старых проектах без явного `"strict": true` не работали `strictNullChecks` и `strictFunctionTypes`, и `null` присваивался любому типу. После обновления такой проект может выдать сотни новых ошибок. `"strict": false` возвращает старое поведение.

## Вопросы с интервью

::: details Что такое структурная типизация и чем она отличается от номинальной?
Совместимость определяется формой: тип `S` присваивается `T`, если у `S` есть все обязательные члены `T` с совместимыми типами. Имя и явное наследование не нужны. В номинальной системе (Java, C#) нужна явная связь через `extends` или `implements`. TypeScript выбрал структурную модель, потому что так работает JavaScript: функции нужно поле, а не происхождение объекта. Объекты из литералов, JSON и классов без общих предков описываются одним типом. Цена: случайно совпавшие формы совместимы, поэтому `UserId` и `OrderId` как `string` не различаются. Номинальность появляется у классов с `private`/`#private` членами, у enum и у `unique symbol`. Для примитивов её эмулируют брендами.
:::

::: details Почему литерал с лишним свойством — ошибка, а тот же объект из переменной — нет?
Это проверка лишних свойств (excess property checking), и она применяется только к **свежим** объектным литералам, присвоенным в типизированное место. Лишний ключ в литерале почти всегда опечатка или забытое переименование, а в существующем объекте это законные данные, о которых тип просто не знает. Структурная совместимость лишние свойства разрешает, а excess check — дополнительная эвристика поверх неё. Свежесть теряется при сохранении в переменную и при `as`. Проверка учитывает объединения: ошибка, только если ключа нет ни в одном члене. Отдельно работает weak type detection: тип из одних необязательных свойств не принимает объект без единого общего свойства.
:::

::: details Чем отличаются type и interface, и что выбрать?
`type` — псевдоним для любого типа, включая объединения, кортежи, примитивы, mapped и conditional types. `interface` описывает только объектные формы. Отличия: интерфейсы с одним именем сливаются (declaration merging), на этом работает module augmentation; `extends` проверяет конфликт свойств при объявлении, а `&` молча даёт `never`; у псевдонима есть неявная индексная сигнатура, поэтому он присваивается `Record<string, string>`, а интерфейс — нет; имена интерфейсов сохраняются в ошибках, а `extends` дешевле пересечений для компилятора. Handbook советует `interface`, пока не нужны возможности `type`. Публичные расширяемые типы библиотек — всегда `interface`. В остальном важнее единый стиль в проекте, чем выбор.
:::

::: details Чем unknown отличается от any и never?
В модели «тип — множество значений» `unknown` — все значения (top type). Ему можно присвоить что угодно, но использовать его нельзя, пока не сузишь проверкой. `never` — пустое множество (bottom type): он присваивается чему угодно, и ему ничего не присвоить. Так типизируют недостижимый код, функции, которые всегда бросают, и исчерпывающие проверки. `any` — не тип в этой иерархии, а отключение проверки: присваивается в обе стороны и распространяется на выражения, где участвует. Для внешних данных (`JSON.parse`, `catch (e)`, ответы API) правильный тип — `unknown` плюс валидация. В `catch` переменная и так `unknown` при `useUnknownInCatchVariables`, который входит в `strict`.
:::

::: details Почему keyof от объединения даёт меньше ключей, а от пересечения больше?
Объединение `A | B` — значение, которое может оказаться любым из двух. Гарантированно у него есть только общие ключи, поэтому `keyof (A | B)` = `keyof A & keyof B`. Пересечение `A & B` — значение, которое одновременно и `A`, и `B`, у него есть все ключи обоих: `keyof (A & B)` = `keyof A | keyof B`. Операции над множествами значений и над множествами гарантий (членов) идут в разные стороны. Больше значений — меньше гарантий. Если в пересечении у ключа несовместимые типы, этот ключ становится `never`, а при конфликте литеральных дискриминантов `never` становится весь тип.
:::

::: details Что такое вариантность и почему параметры методов в TypeScript бивариантны?
Вариантность описывает, как совместимость `F<Dog>` и `F<Animal>` следует из `Dog` → `Animal`. Возвращаемое значение ковариантно, параметр контравариантен: функция, принимающая `Animal`, подходит туда, где передают `Dog`, но не наоборот. С `strictFunctionTypes` так проверяются типы функций, но не методы, объявленные синтаксисом `m(x: T): void`. Их параметры бивариантны. Это сознательный компромисс: иначе `Dog[]` не присваивался бы `Animal[]` из-за `push(item: T)`, и ломались бы многие DOM-типы. Цена — некорректный (unsound) код: `const animals: Animal[] = dogs; animals.push(cat)` компилируется. Для своих колбэков используют синтаксис свойства (`cb: (x: T) => void`), а для generics при необходимости задают вариантность явно, `in`/`out`.
:::

::: details Как отличить на уровне типов UserId от OrderId, если оба — строки?
Брендированием: `type UserId = string & { readonly __brand: 'UserId' }`, надёжнее — через `declare const brand: unique symbol` и ключ `[brand]`. Обычная строка такому типу не присваивается, разные бренды несовместимы, а `UserId` присваивается `string`, поэтому строковые методы и шаблоны работают. В рантайме бренда нет, затрат ноль. Значение создают одной функцией-конструктором, которая проверяет формат и делает `as UserId`. Это единственное место с утверждением типа. Альтернатива — класс-обёртка с `#private` полем: номинальность в рантайме, но аллокация и потеря примитивности (сериализация, сравнение `===`).
:::

## Задачи

### 1. Брендированные идентификаторы · легко

Сделайте так, чтобы `loadOrder(userId)` не компилировался, `loadOrder('o_1')` — тоже, а `UserId` можно было использовать как строку. Строку проверяйте по формату `u_<символы>`.

```ts
declare function loadOrder(id: OrderId): Promise<Order>;
```

::: details Решение и разбор
```ts
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

type UserId = Brand<string, 'UserId'>;
type OrderId = Brand<string, 'OrderId'>;

function toUserId(raw: string): UserId {
  if (!/^u_\w+$/.test(raw)) throw new TypeError(`Invalid user id: ${raw}`);
  return raw as UserId; // the only assertion: the brand exists in types only
}

const id = toUserId('u_1');
loadOrder(id);        // Error: UserId is not assignable to OrderId
loadOrder('o_1');     // Error: string is not assignable to OrderId
id.toUpperCase();     // OK: UserId is still a string
```

Литералы `'UserId'` и `'OrderId'` в свойстве бренда несовместимы, поэтому несовместимы и типы. Ключ `unique symbol` вместо `__brand` нельзя случайно подделать объектом и он не виден в автодополнении. Бренд объявлен через `declare`, поэтому значения символа в рантайме нет, как и самого свойства.

Крайние случаи: `JSON.parse` и ответы API возвращают обычные строки, их нужно пропустить через `toUserId`. Это и есть смысл: идентификатор становится `UserId` только после проверки. В Zod то же самое делает `.brand<'UserId'>()`.
:::

### 2. Найдите ошибки компиляции · средне

Какие строки не компилируются в режиме `strict` и почему?

```ts
interface Point { x: number; y: number }
interface Options { debug?: boolean; level?: number }
type Shape = { kind: 'circle'; r: number } | { kind: 'square'; side: number };

const a: Point = { x: 1, y: 2, z: 3 };                 // 1
const tmp = { x: 1, y: 2, z: 3 };
const b: Point = tmp;                                   // 2
const c = { x: 1, y: 2, z: 3 } as Point;                // 3
const flags = { verbose: true };
const d: Options = flags;                               // 4
const e: Shape = { kind: 'circle', r: 1, side: 2 };     // 5
const f: {} = 0;                                        // 6
const g: object = 'text';                               // 7
```

::: details Решение и разбор
- **1 — ошибка.** Свежий литерал с лишним `z`.
- **2 — компилируется.** `tmp` не свежий, лишние свойства структурная типизация разрешает.
- **3 — компилируется.** `as` снимает свежесть. Утверждение допустимо, если типы пересекаются хотя бы в одну сторону.
- **4 — ошибка.** Weak type detection: у `Options` все свойства необязательные, и у `flags` нет ни одного общего с ним. Свежесть здесь ни при чём.
- **5 — ошибка.** Ключа `side` нет в члене объединения с `kind: 'circle'`, который выбран по дискриминанту.
- **6 — компилируется.** `{}` — любое значение, кроме `null` и `undefined`, включая числа.
- **7 — ошибка.** `object` — только непримитивы.

Все ответы проверены на TypeScript 7.0.2 (`--strict`).
:::

### 3. Алгебра объединений и пересечений · средне

Чему равны `T1`–`T5`?

```ts
type A = { id: string; name: string; admin: boolean };
type B = { id: number; name: string; email: string };

type T1 = keyof (A | B);
type T2 = keyof (A & B);
type T3 = (A & B)['id'];
type T4 = (A | B)['id'];
type T5 = (string | number) & (number | boolean);
```

::: details Решение и разбор
```ts
type T1 = 'id' | 'name';                       // only common keys
type T2 = 'id' | 'name' | 'admin' | 'email';   // all keys
type T3 = never;                               // string & number
type T4 = string | number;
type T5 = number;                              // distribute & over |
```

`T1` и `T2` — двойственность: объединение значений даёт пересечение ключей, и наоборот. `T3` — `never`, но сам `A & B` не схлопывается в `never`: `id` не литеральный дискриминант, и объект с `email` и `admin` остаётся доступен. Если бы конфликтовали литералы (`kind: 'a'` и `kind: 'b'`), весь тип стал бы `never`. `T5` считается раскрытием скобок: `(string & number) | (string & boolean) | (number & number) | (number & boolean)`, пустые пересечения выпадают, остаётся `number`.
:::

### 4. Конфиг маршрутов с сохранением ключей · средне

Нужен объект маршрутов: каждое значение проверяется по типу `Route`, путь обязан начинаться с `/`, а из объекта выводится тип `RouteName` — объединение конкретных ключей. Почему аннотация `const routes: Record<string, Route>` не подходит?

```ts
type Route = { path: string; auth?: boolean };
```

::: details Решение и разбор
```ts
type Route = { path: `/${string}`; auth?: boolean };

const routes = {
  home: { path: '/' },
  admin: { path: '/admin', auth: true },
} as const satisfies Record<string, Route>;

type RouteName = keyof typeof routes;  // 'home' | 'admin'
routes.admin.path;                     // type '/admin'
routes.missing;                        // Error: property does not exist
```

Аннотация меняет тип переменной на `Record<string, Route>`: `RouteName` становится `string`, обращение `routes.missing` компилируется и даёт `Route` вместо ошибки. `satisfies` проверяет выражение против типа (включая проверку лишних свойств: `title` в маршруте будет ошибкой), но выведенный тип не трогает. `as const` перед `satisfies` сохраняет литералы путей, поэтому их можно использовать как ключи в других типах. Шаблонный литеральный тип `` `/${string}` `` отвергает `path: 'admin'` ещё при объявлении.
:::

### 5. Дыра бивариантности · сложно

Код компилируется в режиме `strict`, но падает в рантайме. Объясните почему и измените **только** интерфейс `Store`, чтобы ошибка ловилась при компиляции.

```ts
interface Store {
  set(value: string | number): void;
}

const upperStore = {
  set(value: string) {
    console.log(value.toUpperCase());
  },
};

const store: Store = upperStore;
store.set(42); // TypeError: value.toUpperCase is not a function
```

::: details Решение и разбор
```ts
interface Store {
  set: (value: string | number) => void; // property with a function type
}

const store: Store = upperStore;
// Error: Type '(value: string) => void' is not assignable to
// type '(value: string | number) => void'.
```

`set(value: …): void` в интерфейсе — сигнатура **метода**, и её параметры проверяются бивариантно даже при `strictFunctionTypes`. Компилятор принимает реализацию, которая принимает параметр **уже** (`string`), чем обещано в интерфейсе (`string | number`). Через интерфейс можно передать `42`, и реализация получает то, чего не ждёт. Сигнатура свойства с типом функции проверяется контравариантно: реализация обязана принимать не меньше, чем обещает тип.

Почему методы оставили бивариантными: по той же схеме устроены `Array<T>.push`, `Set<T>.add` и обработчики DOM. При строгой проверке `Dog[]` перестал бы присваиваться `Animal[]`, а это ломало бы огромное количество существующего кода. Поэтому `Array<T>` и сейчас некорректен (unsound): `const animals: Animal[] = dogs; animals.push(cat)` компилируется.

Обратная ситуация безопасна: реализация `on(handler: (e: ClickEvent) => void)` для интерфейса `on: (handler: (e: BaseEvent) => void) => void` компилируется и при строгой проверке. Двойная контравариантность (параметр колбэка — параметр параметра) даёт ковариантность. На интервью этот случай часто ошибочно называют дырой.
:::

## Источники

- [TypeScript Handbook: Type Compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility.html)
- [TypeScript Handbook: Everyday Types — Differences Between Type Aliases and Interfaces, Literal Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html)
- [TypeScript Handbook: Object Types](https://www.typescriptlang.org/docs/handbook/2/objects.html)
- [TypeScript Handbook: Declaration Merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html)
- [TypeScript 4.9 Release Notes: the satisfies operator](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html)
- [TypeScript 4.7 Release Notes: variance annotations](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-7.html)
- [TypeScript 5.0 Release Notes: enum overhaul](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html)
- [TypeScript 5.8 Release Notes: erasableSyntaxOnly](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html)
- [TSConfig: strictFunctionTypes](https://www.typescriptlang.org/tsconfig/#strictFunctionTypes), [exactOptionalPropertyTypes](https://www.typescriptlang.org/tsconfig/#exactOptionalPropertyTypes)
- [Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/), [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [Announcing TypeScript 7.1 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)
- [TypeScript wiki: Performance — Preferring Interfaces Over Intersections](https://github.com/microsoft/TypeScript/wiki/Performance#preferring-interfaces-over-intersections)
- [Vue: Augmenting Global Properties](https://vuejs.org/guide/typescript/options-api.html#augmenting-global-properties)
- [Pinia: Plugins — Typing new store properties](https://pinia.vuejs.org/core-concepts/plugins.html#Typing-new-store-properties)
- [typescript-eslint: method-signature-style](https://typescript-eslint.io/rules/method-signature-style/), [consistent-type-definitions](https://typescript-eslint.io/rules/consistent-type-definitions/)
