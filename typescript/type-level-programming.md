---
title: Utility, conditional и mapped types
level: ядро
---

# Utility, conditional и mapped types

> **Коротко.** На уровне типов в TypeScript есть свой небольшой язык. **Mapped type** обходит ключи и строит из них новый объектный тип: так устроены `Partial`, `Readonly`, `Pick`. **Conditional type** `T extends U ? X : Y` — ветвление, а `infer` в нём достаёт часть типа (`ReturnType`, `Awaited`). Над объединением conditional type с «голым» параметром срабатывает **дистрибутивно**, по каждому члену отдельно: на этом построены `Exclude` и `Extract`. Template literal types добавляют работу со строками. Вместе с рекурсией это даёт вычисления на типах. Их цена — читаемость, сообщения об ошибках и время компиляции.

**Связанные темы:** [Generics](./generics.md), [Сужение типов и discriminated unions](./narrowing.md), [Система типов: структурная типизация, `type` и `interface`](./type-system.md), [Функциональные приёмы и иммутабельность](../javascript/functional-programming.md)

## Теория

> [!NOTE]
> Версии сверены 2026-11-12: стабилен TypeScript 7.0 (7.0.2), 7.1 в бете с 20 октября 2026. Все примеры и решения ниже проверены `tsc` 7.0.2 и 7.1.0-beta с `--strict`. Версия, с которой появилась возможность, указана в тексте.

### Строительные блоки: `keyof`, `typeof`, индексный доступ

- **`keyof T`** — объединение ключей: `keyof { a: 1; b: 2 }` = `'a' | 'b'`. С индексной сигнатурой `[k: string]: …` получается `string | number`, потому что числовые ключи в JS — те же строки.
- **`typeof x`** в позиции типа берёт тип значения: `typeof config`.
- **Indexed access** `T[K]` — тип свойства, `T[K1 | K2]` — объединение типов. `T[number]` — тип элемента массива: `(typeof ROLES)[number]` превращает `as const`-массив в объединение литералов.

Из этих трёх операций и двух конструкций ниже собраны почти все utility types.

### Mapped types

Mapped type перебирает объединение ключей и для каждого вычисляет тип свойства:

```ts
type Flags<T> = { [K in keyof T]: boolean };
type Mutable<T> = { -readonly [K in keyof T]-?: T[K] }; // drop readonly and ?
```

**Модификаторы.** `readonly` и `?` добавляются с префиксом `+` (его можно не писать) и снимаются с `-`. `Required<T>` — это `-?`, `Partial<T>` — это `?`.

**Гомоморфные mapped types.** Если ключи берутся как `keyof T` (или как параметр `K extends keyof T`, как в `Pick`), mapped type называют гомоморфным (homomorphic): он повторяет структуру `T`. Из этого следуют три свойства, которых нет у обхода произвольного объединения:

- модификаторы `readonly` и `?` исходных свойств **сохраняются**: `Pick<{ readonly id: number }, 'id'>` остаётся `readonly`, а `{ [K in 'id']: … }` — уже нет;
- массив и кортеж остаются массивом и кортежем (с TypeScript 3.1): `Partial<[number, string]>` = `[number?, string?]`, а не объект с ключами `push` и `length`;
- примитив проходит насквозь: `Partial<string>` = `string`.

**Переименование ключей** (key remapping, с TypeScript 4.1) — клауза `as` после ключа. Если в `as` получился `never`, ключ выбрасывается: так фильтруют свойства по типу значения.

```ts
type Getters<T> = { [K in keyof T as `get${Capitalize<K & string>}`]: () => T[K] };
type MethodsOf<T> = { [K in keyof T as T[K] extends Function ? K : never]: T[K] };
```

> [!WARNING]
> С фильтрующей `as`-клаузой кортеж перестаёт быть кортежем. `{ [K in keyof T as K extends 'length' ? never : K]: T[K] }` от `[1, 2]` даёт объект со всеми ключами массива, включая `push` и `map`. Модификаторы при этом сохраняются. Тождественная клауза `as K` форму кортежа не ломает.

### Conditional types

`T extends U ? X : Y` — если `T` присваивается `U`, результат `X`, иначе `Y`. Для конкретных типов это просто ветвление. Интересное начинается с параметров типа.

**Отложенное вычисление.** Пока `T` неизвестен, `T extends string ? 1 : 2` не вычисляется: тип остаётся отложенным (deferred). Поэтому в generic-функции с возвращаемым типом `IsStr<T>` нельзя написать `return 1`: компилятор не знает, какая ветка выберется. Такие функции реализуют через перегрузки или `as` внутри.

**Сужение в ветке.** В true-ветке `T` дополнительно ограничен проверяемым типом: в `T extends { message: unknown } ? T['message'] : never` обращение к `message` разрешено.

### Дистрибутивность

Если слева от `extends` стоит **голый** параметр типа (naked type parameter), а аргумент — объединение, conditional type применяется к каждому члену отдельно, и результаты объединяются:

```ts
type ToArray<T> = T extends unknown ? T[] : never;
type A = ToArray<string | number>; // string[] | number[]
type B = ToArray<boolean>;         // false[] | true[]: boolean is true | false
```

На этом построены `Exclude<T, U> = T extends U ? never : T` и `Extract`: член, давший `never`, исчезает из объединения. Три следствия, о которых спрашивают:

- **Только голый параметр.** `[T] extends [unknown]`, `Array<T> extends …`, `T[] extends …` не дистрибутивны. Квадратные скобки вокруг обеих сторон — стандартный способ отключить распределение: `[T] extends [unknown] ? T[] : never` даёт `(string | number)[]`.
- **Только при подстановке.** Объединение, написанное прямо в условии (`(string | number) extends string ? …`), не распределяется. Распределение — свойство generic-типа, применённого к объединению.
- **`never` — пустое объединение.** Распределение по нулю членов даёт `never`. Поэтому наивная проверка `T extends never ? true : false` от `never` возвращает `never`, а не `true`. Правильно: `[T] extends [never]`.

`any` в голой позиции даёт объединение обеих веток: `IsStr<any>` = `1 | 2`.

> [!NOTE]
> В TypeScript 7.1 (бета, сверено 2026-11-12) в ветках дистрибутивного conditional type параметр считается уже распределённым, и ограничения, которые держались для исходного параметра, могут не выполняться. Пример из анонса: при `B extends A` выражение `A extends B ? never : Show<A, B>` компилируется в 7.0.2, а в 7.1 beta даёт ошибку 2344 «'B' is only assignable to the non-distributed 'A', but 'A' has been distributed here». Исправление — отключить распределение (`[A] extends [B]`) или убрать лишнее ограничение.

### `infer`

`infer X` объявляет переменную типа прямо в условии: «если `T` имеет такую форму, назови эту часть `X`». Так устроены `ReturnType`, `Parameters` и `Awaited`:

```ts
type ElementOf<T> = T extends readonly (infer E)[] ? E : never;
type FirstIfString<T> = T extends [infer S extends string, ...unknown[]] ? S : never;
type ToNumber<S> = S extends `${infer N extends number}` ? N : never; // ToNumber<'42'> = 42
```

- **`infer X extends C`** (с TypeScript 4.7) проверяет найденный тип на месте: если он не подходит под `C`, выбирается false-ветка. Раньше для этого нужен был вложенный conditional. Внутри template literal такое ограничение превращает строку в число или литерал (`'42'` → `42`, с TypeScript 4.8).
- **Одно имя в нескольких местах.** В ковариантных позициях (поля, результат) кандидаты объединяются: `{ a: infer U; b: infer U }` от `{ a: string; b: number }` даёт `string | number`. В контравариантных (параметры функций) — пересекаются. На этом держится известный трюк `UnionToIntersection`.
- **Перегрузки.** Из типа с несколькими сигнатурами вывод берёт **последнюю**. `ReturnType<typeof f>` для перегруженной `f` — тип последней перегрузки, а выбрать перегрузку по типам аргументов на уровне типов нельзя.

### Template literal types

С TypeScript 4.1 строковые литеральные типы можно собирать шаблоном: `` `on${Capitalize<E>}` ``. Подстановка объединения даёт **декартово произведение**: `` `${'sm' | 'lg'}-${'red' | 'blue'}` `` — четыре литерала. Встроенные `Uppercase`, `Lowercase`, `Capitalize`, `Uncapitalize` реализованы в компиляторе (intrinsic), их нельзя написать самому.

В позиции `infer` шаблон разбирает строку: `` S extends `${infer Head}.${infer Rest}` `` отделяет первый сегмент пути. Шаблон с `${number}` или `${string}` описывает бесконечное множество строк: тип `` `id-${number}` `` принимает `'id-42'` и отвергает `'id-x'`.

### Рекурсия и её пределы

Conditional type может ссылаться на себя (с TypeScript 4.1). Так разбирают пути, кортежи, вложенные объекты. Компилятор защищается от бесконечной рекурсии ошибкой 2589 «Type instantiation is excessively deep and possibly infinite».

С TypeScript 4.5 рекурсия в **хвостовой позиции**, когда ветка — сразу следующий conditional type без обёрток, вычисляется без промежуточных инстанцирований, и лимит намного выше. Если результат рекурсии во что-то обёрнут (`` `${Trim<R>}` ``, `Head | Rec<R>`, `[H, ...Rec<R>]`), рекурсия не хвостовая. Её переписывают с аккумулятором, как хвостовую рекурсию в функциях.

> [!WARNING]
> Лимиты — деталь реализации, в спецификации и Handbook их нет. В `tsc` 7.0.2 хвостовой `Trim` справляется с 999 ведущими пробелами и падает на 1000. Тот же `Trim` с обёрткой в шаблон падает уже на ~100. В 7.1 beta нехвостовой вариант даёт другую ошибку — 5114 «appear infinitely circular».

### Встроенные utility types

| Тип | Как устроен | Версия |
| --- | --- | --- |
| `Partial`, `Required`, `Readonly` | гомоморфный mapped type с `?`, `-?`, `readonly` | 2.1, 2.8, 2.1 |
| `Pick<T, K extends keyof T>` | `{ [P in K]: T[P] }` | 2.1 |
| `Record<K, T>` | `{ [P in K]: T }`, `K extends keyof any` | 2.1 |
| `Exclude`, `Extract` | дистрибутивный conditional | 2.8 |
| `Omit<T, K extends keyof any>` | `Pick<T, Exclude<keyof T, K>>` | 3.5 |
| `NonNullable<T>` | `T & {}` (с 4.8, раньше через conditional) | 2.8 |
| `ReturnType`, `Parameters`, `InstanceType`, `ConstructorParameters` | conditional + `infer` | 2.8–3.1 |
| `Awaited<T>` | рекурсивно разворачивает thenable, как `await` | 4.5 |
| `NoInfer<T>` | intrinsic, исключает место из вывода ([Generics](./generics.md)) | 5.4 |

У двух из них есть ловушки, о которых стоит знать.

**`Omit` не проверяет ключи.** Ограничение `K extends keyof any`, а не `keyof T`, поэтому `Omit<User, 'typo'>` молча возвращает весь `User`. Это осознанное решение: `Omit` используют и с ключами, которых в типе может не быть. Строгий вариант пишут сами: `type StrictOmit<T, K extends keyof T> = Omit<T, K>`.

**`Omit` и `Pick` не дистрибутивны.** `keyof (A | B)` — только **общие** ключи, поэтому `Omit<A | B, 'x'>` теряет всё, кроме общих полей, и discriminated union разваливается. Нужен дистрибутивный вариант:

```ts
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
```

> [!WARNING]
> `Omit` на типе с индексной сигнатурой теряет все именованные поля. `keyof` такого типа — `string | number`, `Exclude` ничего из него не убирает, и `Pick` оставляет одну сигнатуру. От `{ [k: string]: unknown; id: number; name: string }` остаётся только `{ [k: string]: unknown; [k: number]: unknown }`.

`Readonly` — поверхностный: `Readonly<{ a: { b: number } }>` запрещает присвоить `a`, но не `a.b`. Глубокая версия — задача ниже.

> [!TIP]
> Type-level код — тоже код, и его поддерживают. Признаки, что пора остановиться: тип нельзя прочитать без отладки, ошибки компилятора занимают экран, редактор начал тормозить. Часто проще указать тип явно, чем вывести его пятиэтажным conditional. Сложные типы прячут в библиотеке, а наружу отдают простое API, как делают Vue Router, Pinia и `ts-pattern`.

## Примеры

```ts
// Form state derived from one model: no duplicated field lists.
interface SignUp {
  email: string;
  password: string;
  age?: number;
}

type FormErrors<T> = { [K in keyof T]?: string };
type Touched<T> = { [K in keyof T]-?: boolean }; // every field, even optional ones

const errors: FormErrors<SignUp> = { email: 'Invalid email' };
const touched: Touched<SignUp> = { email: true, password: false, age: false };
```

Добавили поле в `SignUp` — `Touched` сразу требует его в объекте, а `FormErrors` разрешает ошибку для него. `-?` в `Touched` нужен, потому что гомоморфный mapped type иначе скопировал бы `?` у `age`.

```ts
// Event map -> handler props, the same naming rule Vue uses: event 'update' <-> prop 'onUpdate'.
type Events = { update: string; close: undefined };

type HandlerProps<E> = {
  [K in keyof E & string as `on${Capitalize<K>}`]?: (payload: E[K]) => void;
};

const props: HandlerProps<Events> = {
  onUpdate: (value) => console.log(value.toUpperCase()), // value: string
};
```

`keyof E & string` отбрасывает числовые и символьные ключи: `Capitalize` принимает только строки.

## Вопросы с интервью

::: details Что такое mapped type и чем гомоморфный mapped type отличается от обычного?
Mapped type обходит объединение ключей и для каждого вычисляет тип свойства: `{ [K in Keys]: … }`. Модификаторы `readonly` и `?` добавляются `+` и снимаются `-`. Гомоморфным называют mapped type по `keyof T` (или по `K extends keyof T`): он повторяет структуру `T`. Поэтому он сохраняет модификаторы исходных свойств, оставляет массивы и кортежи массивами и кортежами и пропускает примитивы насквозь. Обход произвольного объединения (`[K in 'a' | 'b']`) ничего из этого не делает. Клауза `as` (4.1) переименовывает ключи, `never` в ней выбрасывает ключ, но фильтрующая `as` превращает кортеж в объект с ключами массива.
:::

::: details Что такое дистрибутивный conditional type и как отключить распределение?
Если слева от `extends` стоит голый параметр типа, а подставлено объединение, условие применяется к каждому члену, а результаты объединяются. `ToArray<string | number>` даёт `string[] | number[]`, `boolean` распределяется как `true | false`. На этом работают `Exclude` и `Extract`. Отключают распределение, обернув обе стороны в кортеж: `[T] extends [U]`. Граничные случаи: `never` — пустое объединение, и дистрибутивный тип от него даёт `never` (поэтому `IsNever` пишут через `[T] extends [never]`). `any` даёт объединение обеих веток. Объединение, написанное в условии напрямую, не распределяется. В 7.1 параметр в ветках считается распределённым, и некоторые ограничения перестают выполняться.
:::

::: details Как работает infer и какие у него ограничения?
`infer X` объявляет переменную типа в правой части `extends`: если `T` подходит под шаблон, `X` получает соответствующую часть. Так устроены `ReturnType`, `Parameters`, `Awaited`. С 4.7 можно сразу ограничить: `infer S extends string`, и при несовпадении выбирается false-ветка. В template literal это превращает `'42'` в число `42` (4.8). Если одно имя встречается несколько раз, в ковариантных позициях кандидаты объединяются, в контравариантных пересекаются. Из перегруженной функции вывод берёт последнюю сигнатуру, поэтому `ReturnType` перегрузки часто «не тот», а выбрать перегрузку по аргументам на уровне типов нельзя.
:::

::: details Почему Omit не ругается на несуществующий ключ и ломает объединения?
`Omit<T, K extends keyof any>` — это `Pick<T, Exclude<keyof T, K>>`. Ключ ограничен любым `PropertyKey`, а не `keyof T`, поэтому опечатка проходит молча. Это решение авторов: `Omit` используют и для ключей, которых может не быть. Строгий вариант — `StrictOmit<T, K extends keyof T>`. С объединением проблема в `keyof (A | B)`: это только общие ключи, поэтому `Omit<A | B, 'x'>` теряет поля конкретных вариантов, и discriminated union превращается в один объект. Лечится дистрибутивной обёрткой `T extends unknown ? Omit<T, K> : never`. Ещё ловушка: на типе с индексной сигнатурой `Omit` выбрасывает все именованные поля.
:::

::: details Чем Exclude и Extract отличаются от Omit и Pick?
`Exclude` и `Extract` работают с **объединениями**: убирают или оставляют члены, присваиваемые `U`. Это дистрибутивные conditional types. `Omit` и `Pick` работают с **объектами**: убирают или оставляют свойства по ключам. Это mapped types. Связь между ними: `Omit` реализован через `Exclude` над `keyof T`. Типичная ошибка — `Exclude<User, 'password'>`: `User` не объединение и не присваивается `'password'`, поэтому результат — весь `User`, без ошибки.
:::

::: details Что такое template literal types и где они полезны на практике?
Строковые литеральные типы, собранные шаблоном (4.1): `` `on${Capitalize<E>}` ``. Подстановка объединений даёт декартово произведение, поэтому `` `${Size}-${Color}` `` порождает все комбинации. С `infer` шаблон разбирает строку: параметры маршрута из `'/users/:id'`, сегменты пути `'a.b.c'`, имена событий. `${number}` описывает бесконечное множество строк вроде `'id-42'`. Применения: имена обработчиков из карты событий, типизированные пути в `get`/`set` и i18n-ключах, CSS-классы дизайн-системы, параметры роутов. Ограничения: размер декартова произведения ограничен, а глубокий разбор строк упирается в лимит рекурсии.
:::

::: details Когда вычисления на типах вредят и как это заметить?
Когда стоимость превышает пользу. Признаки: тип нельзя понять без отладки, ошибка компилятора занимает экран и указывает на внутренности типа, IDE тормозит, появляется «excessively deep and possibly infinite». Каждый рекурсивный тип инстанцируется при проверке, и в большой кодовой базе это заметно по времени сборки. Практика: держать сложные типы внутри библиотеки, а наружу отдавать простое API; писать рекурсию хвостовой; кэшировать промежуточные результаты в именованных псевдонимах; проверять типы тестами (`Expect<Equal<…>>`, `expectTypeOf` в Vitest). Иногда явная аннотация лучше вывода.
:::

## Задачи

### 1. `Pick`, `Omit`, `Exclude`, `Readonly` своими руками · легко

Реализуйте `MyPick`, `MyReadonly`, `MyExclude` и `MyOmit` без встроенных utility types. `MyOmit` должен сохранять `readonly` и `?`.

```ts
type Todo = { readonly id: number; title: string; done?: boolean };
type A = MyOmit<Todo, 'title'>; // { readonly id: number; done?: boolean }
```

::: details Решение и разбор
```ts
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };
type MyReadonly<T> = { readonly [P in keyof T]: T[P] };
type MyExclude<T, U> = T extends U ? never : T;
type MyOmit<T, K extends PropertyKey> = {
  [P in keyof T as P extends K ? never : P]: T[P];
};
```

`MyPick` гомоморфен, хотя обходит `K`, а не `keyof T`: ограничение `K extends keyof T` говорит компилятору, что ключи взяты из `T`, и модификаторы копируются. `MyExclude` работает только благодаря дистрибутивности: `T` — голый параметр, каждый член проверяется отдельно, а `never` исчезает из объединения.

`MyOmit` через `as`-клаузу обходит `keyof T` напрямую и поэтому сохраняет модификаторы. Вариант как во встроенном `Omit`, `MyPick<T, MyExclude<keyof T, K>>`, тоже их сохраняет. Ограничение `K extends PropertyKey` повторяет поведение встроенного `Omit`: несуществующий ключ не ошибка.
:::

### 2. Что выведет компилятор · средне

Назовите тип каждого псевдонима.

```ts
type IsString<T> = T extends string ? 'yes' : 'no';
type Box<T> = [T] extends [string] ? 'yes' : 'no';

type Q1 = IsString<'a' | 1>;
type Q2 = Box<'a' | 1>;
type Q3 = IsString<never>;
type Q4 = Box<never>;
type Q5 = IsString<any>;
type Q6 = IsString<boolean>;
type Q7 = Exclude<string | (() => void), Function>;
type Q8 = keyof ({ a: 1; b: 2 } | { a: 3; c: 4 });
```

::: details Решение и разбор
1. **`'yes' | 'no'`.** Распределение: `'a'` → `'yes'`, `1` → `'no'`.
2. **`'no'`.** Скобки отключают распределение, и `'a' | 1` целиком не присваивается `string`.
3. **`never`.** Распределение по пустому объединению.
4. **`'yes'`.** Без распределения: `never` присваивается чему угодно, включая `string`.
5. **`'yes' | 'no'`.** `any` в голой позиции даёт обе ветки.
6. **`'no'`.** `boolean` — это `true | false`, обе ветки `'no'`, объединение схлопывается.
7. **`string`.** Функция присваивается `Function` и исключается.
8. **`'a'`.** `keyof` объединения — общие ключи: значение может оказаться любым из вариантов, и безопасно читать только `a`.

Все ответы проверены `tsc` 7.0.2 и 7.1.0-beta с `--strict`.
:::

### 3. Параметры маршрута из строки · средне

Напишите `RouteParams<P>`: из шаблона пути `'/users/:id/posts/:postId'` получается `{ id: string; postId: string }`, из пути без параметров — `{}`. Затем типизируйте `navigate(path, params)`.

```ts
navigate('/users/:id/posts/:postId', { id: '1', postId: '2' }); // OK
navigate('/users/:id', { userId: '1' });                        // Error
```

::: details Решение и разбор
```ts
type RouteParams<P extends string> =
  P extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof RouteParams<`/${Rest}`>]: string }
    : P extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : {};

declare function navigate<P extends string>(path: P, params: RouteParams<P>): void;
```

Первая ветка находит параметр, за которым идёт `/`. `${string}` перед `:` съедает всё до первого двоеточия, `infer Param` берёт имя до следующего `/`. Остаток разбирается рекурсивно, и его ключи объединяются с текущим. Вторая ветка — последний параметр в конце строки. Ключи собираются в одно объединение, и из него строится mapped type, поэтому в подсказке IDE видно `{ id: string; postId: string }`, а не пересечение `{ id: string } & { postId: string }`.

`P` выводится из литерала в вызове как литеральный тип: ограничение `string` примитивное ([Generics](./generics.md)). Если передать путь из переменной типа `string`, `RouteParams<string>` даст `{}`, и проверка пропадёт.

Сложность: на уровне типов — по числу параметров; в рантайме ничего не происходит.
:::

### 4. `DeepReadonly` · средне

Сделайте глубокую версию `Readonly`: запрещена запись на любой глубине, массивы и кортежи становятся `readonly`, функции остаются вызываемыми.

```ts
type Cfg = { api: { url: string; retries: number[] }; tags: [string, number]; onError: (e: Error) => void };
declare const cfg: DeepReadonly<Cfg>;
cfg.api.url = 'x';        // Error
cfg.api.retries.push(1);  // Error
cfg.onError(new Error()); // OK
```

::: details Решение и разбор
```ts
type DeepReadonly<T> = T extends (...args: any[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
```

Порядок веток важен. Функция — тоже `object`, и без первой ветки она превратилась бы в объект без сигнатуры вызова. Примитивы уходят в последнюю ветку. Массивы и кортежи обрабатывает средняя ветка: гомоморфный mapped type над массивом даёт `readonly`-массив, над кортежем — `readonly`-кортеж, поэтому `push` недоступен.

Ограничение: встроенные классы с внутренним состоянием этим не защищены. `DeepReadonly<Map<string, number>>` оставляет метод `set` вызываемым: mapped type делает `readonly` свойство `set`, а не запрещает менять содержимое. Для них добавляют ветки `T extends Map<infer K, infer V> ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>` и аналогичную для `Set`. Это только проверка типов: в рантайме объект по-прежнему изменяем, для заморозки нужен `Object.freeze` ([«Функциональные приёмы и иммутабельность»](../javascript/functional-programming.md)). Во Vue `readonly()` возвращает тип `DeepReadonly<UnwrapNestedRefs<T>>` и защищает и в рантайме, через прокси.

Сложность: на уровне типов — по размеру структуры; в рантайме ничего не происходит.
:::

### 5. Типизированный `get` по пути · сложно

Напишите типы для `get(obj, path)`: `path` — только существующие пути через точку, результат — тип значения по этому пути.

```ts
type State = { user: { name: string; address: { city: string } }; count: number };
get(state, 'user.address.city'); // string
get(state, 'count');             // number
get(state, 'user.adress');       // Error
```

::: details Решение и разбор
```ts
type Paths<T> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object ? K | `${K}.${Paths<T[K]>}` : K;
    }[keyof T & string]
  : never;

type PathValue<T, P extends string> = P extends `${infer H}.${infer R}`
  ? H extends keyof T
    ? PathValue<T[H], R>
    : never
  : P extends keyof T
    ? T[P]
    : never;

function get<T, P extends Paths<T>>(obj: T, path: P): PathValue<T, P> {
  return path.split('.').reduce<any>((acc, key) => acc?.[key], obj);
}
```

**`Paths`** — mapped type с последующим индексным доступом `[keyof T & string]`. Mapped type строит объект «ключ → все пути, начинающиеся с этого ключа», а индексный доступ собирает значения в одно объединение. Этот приём (mapped type + `[keyof T]`) превращает обход свойств в объединение и встречается постоянно. `& string` отбрасывает символьные ключи, которые нельзя вставить в шаблон.

**`PathValue`** отрезает первый сегмент шаблоном `${infer H}.${infer R}` и спускается в тип. Рекурсия хвостовая: ветка — сразу `PathValue<…>`.

Ограничения, которые стоит назвать на интервью. Для массивов `Paths` перечислит ключи `length`, `push` и индексы, поэтому массивы обычно обрабатывают отдельной веткой (`items.${number}`). На больших или рекурсивных типах (`type Tree = { children: Tree[] }`) число путей взрывается, и компилятор упирается в лимит глубины. Тогда глубину ограничивают счётчиком-кортежем. `any` в реализации — осознанная граница: связь пути и результата гарантирует сигнатура, а не тело.

Сложность: в рантайме O(d), где d — глубина пути; число путей на уровне типов растёт с размером `T`.
:::

## Источники

- [TypeScript Handbook: Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)
- [TypeScript Handbook: Mapped Types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html)
- [TypeScript Handbook: Template Literal Types](https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html)
- [TypeScript Handbook: Keyof, Typeof, Indexed Access Types](https://www.typescriptlang.org/docs/handbook/2/indexed-access-types.html)
- [TypeScript: Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html)
- [TypeScript 4.1 Release Notes: template literal types, key remapping, recursive conditional types](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-1.html)
- [TypeScript 4.5 Release Notes: `Awaited`, tail-recursion elimination on conditional types](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-5.html)
- [TypeScript 4.7 Release Notes: `extends` constraints on `infer`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-7.html)
- [TypeScript 4.8 Release Notes: improved inference for `infer` types in template string types](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-8.html)
- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [Announcing TypeScript 7.1 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)
- [Vue: Reactivity API — `readonly`](https://vuejs.org/api/reactivity-core.html#readonly)
- [type-challenges](https://github.com/type-challenges/type-challenges) — сборник задач на уровне типов
