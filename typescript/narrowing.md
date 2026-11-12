---
title: Сужение типов и discriminated unions
level: ядро
---

# Сужение типов и discriminated unions

> **Коротко.** Сужение (narrowing) — это анализ потока управления (control flow analysis): компилятор идёт по веткам кода и в каждой точке знает более точный тип переменной, чем объявленный. Сужают обычные JavaScript-проверки: `typeof`, `===`, `in`, `instanceof`, проверка на истинность, присваивание, а также свои type guards и assertion functions. Discriminated union — объединение объектов с общим полем-литералом, по которому `switch` выбирает ровно один вариант. Остаток после всех веток — `never`, и на этом строится проверка исчерпываемости.

**Связанные темы:** [Система типов: структурная типизация, `type` и `interface`](./type-system.md), [Generics](./generics.md), [Типы данных и приведение типов](../javascript/types-and-coercion.md), [Прототипы и классы](../javascript/prototypes-and-classes.md), [async/await, обработка ошибок и отмена](../javascript/async-await.md)

## Теория

> [!NOTE]
> Версии сверены 2026-11-12: стабилен TypeScript 7.0 (7.0.2), 7.1 в бете с 20 октября 2026. В 7.1 beta нет изменений в результатах сужения, только ускорение: быстрый путь для сужения объединений при присваивании, `===` и `switch`. Все примеры и решения ниже проверены `tsc` 7.0.2 с `--strict`.

### Объявленный тип и сужённый

У переменной два типа. **Объявленный** (declared) задаётся аннотацией или выводом при объявлении и не меняется. **Сужённый** (narrowed) — то, что компилятор знает о значении в конкретной точке кода. Проверки и присваивания меняют только сужённый тип, а присваивание по-прежнему проверяется против объявленного:

```ts
let x: string | number = 'a'; // declared: string | number, narrowed: string
x = 1;                          // OK: checked against the declared type
x.toFixed();                    // narrowed to number
```

Компилятор строит граф потока управления: ветки `if` и `switch`, ранний `return` и `throw`, `&&`, `||`, `??`, `?:`. В точке слияния веток типы объединяются. После `if (typeof x === 'string') return;` весь остаток функции видит `x` без `string`. Сужение — чисто статическое: никакой рантайм-проверки компилятор не добавляет, он только **читает** ваши.

### Встроенные проверки

| Проверка | Что сужает | Ловушка |
| --- | --- | --- |
| `typeof x === 'string'` | по восьми результатам `typeof` | `typeof null === 'object'`: `null` остаётся в ветке `'object'` |
| `if (x)` (истинность) | убирает `null`, `undefined`, литералы `false`, `0`, `''` | `0` и `''` тоже отсекаются, а `number` в else-ветке остаётся `number` |
| `x === y`, `switch` | до общего типа обеих сторон, литералы | — |
| `x != null` | убирает и `null`, и `undefined` | единственное оправданное `!=` |
| `'k' in x` | до членов объединения, у которых есть `k` | необязательное `k?` попадает в **обе** ветки |
| `x instanceof C` | до типа экземпляра `C` | не работает для `interface`, ломается между realm-ами |
| `Array.isArray(x)` | до массива | `readonly T[]` не отсекается в else-ветке: предикат `arg is any[]` про `readonly` не знает |
| присваивание `x = …` | до типа присвоенного значения | — |

Несколько деталей, которые спрашивают на интервью:

- **`typeof` и `null`.** Проверка `typeof x === 'object'` пропускает `null`, и компилятор это знает: в ветке остаётся `T | null`. Нужна явная `x !== null`. Причина — историческая ошибка JavaScript, разобранная в [«Типах данных»](../javascript/types-and-coercion.md).
- **Истинность.** `if (count)` молча отбрасывает `0`, `if (name)` — пустую строку. Компилятор этого не подсвечивает: для него это легальное сужение. В else-ветке `number | undefined` остаётся `number | undefined`, потому что TypeScript не выражает «число, равное нулю» отдельным типом.
- **`in` с TypeScript 4.9** сужает и то, чего нет в типе: после `'id' in value` у `value: object` появляется тип `object & Record<'id', unknown>`. Это делает разбор `unknown` без `as` возможным.
- **`instanceof`** — проверка цепочки прототипов в рантайме, поэтому работает только с классами (значениями). С TypeScript 5.3 учитывается и `static [Symbol.hasInstance]` с предикатом в сигнатуре.

### Анализ потока: что сохраняет сужение и что сбрасывает

**Псевдонимы условий** (с TypeScript 4.4). Результат проверки можно сохранить в `const`: `const isStr = typeof x === 'string'; if (isStr) x.toUpperCase()` компилируется. Условия: и псевдоним, и проверяемая переменная — `const`, `readonly` или параметр без присваиваний в теле. С `let isStr` сужения нет: компилятор не может гарантировать, что флаг всё ещё соответствует значению.

**Деструктуризация** (с TypeScript 4.6). `const { type, payload } = action; if (type === 'add') payload.toFixed()` компилируется: компилятор помнит, что `type` и `payload` взяты из одного варианта объединения. Работает для `const` и параметров без переприсваивания.

**`switch (true)`** (с TypeScript 5.3) сужает по условию в каждом `case`: `case typeof x === 'string':`.

**Индексный доступ** (с TypeScript 5.5). `if (typeof obj[key] === 'string') obj[key].toUpperCase()` компилируется, если ни `obj`, ни `key` не переприсваиваются.

**Замыкания.** Колбэк может выполниться позже, когда переменная уже другая, поэтому по умолчанию сужение внутрь функций не переносится. Исключения:

- `const` и параметры, которые нигде не переприсваиваются, сохраняют сужение в замыканиях всегда.
- С TypeScript 5.4 `let` и параметры сохраняют сужение в замыкании, созданном **после последнего присваивания**, если замыкание — не поднимаемая (non-hoisted) функция: стрелка или функциональное выражение. В объявлении `function log() {}` сужения нет: объявление поднимается и может быть вызвано раньше присваивания. Любое присваивание переменной внутри вложенной функции, даже `v = v`, отменяет перенос.
- **Свойства** (`o.v`) не сохраняют сужение в колбэках никогда. Лечение — скопировать в `const`: `const v = o.v`.

> [!WARNING]
> Сужение свойства **не сбрасывается** вызовом функции или `await`, хотя они могут изменить объект. `if (user.value) { await reload(); user.value.name }` компилируется, а в рантайме `reload()` мог обнулить `user.value`. Это сознательный компромисс TypeScript: если сбрасывать сужения после каждого вызова, почти любой код потребует повторных проверок. Для Vue это особенно актуально: `ref` и `reactive` меняются из других мест, и после `await` значение стоит прочитать заново в `const` и проверить.

### Свои type guards: предикаты и утверждения

**Предикат типа** (type predicate) — функция с возвращаемым типом `x is T`. Её вызов в условии сужает аргумент: в true-ветке до `T`, в false-ветке — **исключает** `T`. Тело компилятор не проверяет: `function isString(x: unknown): x is string { return typeof x === 'number' }` компилируется. Предикат так же опасен, как `as`, только спрятан в функцию.

У предиката семантика «тогда и только тогда»: `true` — значение `T`, `false` — значение **не** `T`. Нарушение второй половины — частая ошибка. `function isFilled(x: string | undefined): x is string { return !!x }` в false-ветке сужает до `undefined`, хотя там может оказаться `''`.

**Выведенные предикаты** (с TypeScript 5.5). Функция без аннотации возвращаемого типа с одним `return`, которая не мутирует параметр и возвращает `boolean`-проверку **самого параметра**, получает предикат автоматически. Поэтому `[1, null, 2].filter((x) => x !== null)` теперь даёт `number[]`. Условие «тогда и только тогда» компилятор при выводе проверяет сам:

- `filter((x) => !!x)` на `(number | undefined)[]` предиката не даёт: `false` может означать и `undefined`, и `0`. Для объектов `!!x` предикат даёт, неоднозначности нет.
- Проверка свойства (`typeof value.id === 'number'`) предиката для `value` не даёт: `false` не означает, что `value` не того типа.
- `(x) => x` предиката не даёт: возвращает не `boolean`.

**Assertion function** (с TypeScript 3.7) — сигнатура `asserts x is T` или `asserts x`. Функция либо бросает, либо возвращается, и после вызова остаток кода видит `x: T`. Удобна на границе системы: `assertUser(data)` после `fetch`. Ограничение: имя в вызове должно иметь **явную аннотацию типа**. Стрелку `const assertX = (x: unknown): asserts x is X => …` вызвать как утверждение нельзя (ошибка 2775), нужно объявление `function` или `const assertX: (x: unknown) => asserts x is X = …`. Причина — анализ потока строится до вывода типов, и сигнатуру утверждения компилятор должен знать без вывода.

### Discriminated unions

**Размеченное объединение** (discriminated union, tagged union) — объединение объектных типов с общим свойством-**дискриминантом**, у которого в каждом варианте свой литеральный тип:

```ts
type RequestState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };
```

Проверка `state.status === 'success'` оставляет ровно один вариант, и `state.data` становится доступен. Требования к дискриминанту: литеральный тип (строка, число, `true`/`false`, `null`/`undefined`) хотя бы в одном варианте. Если в одном из вариантов дискриминант — просто `string`, сравнение с `'click'` его не отсекает (`'click'` входит в `string`), и объединение перестаёт работать как размеченное.

Главная причина использовать такие объединения — **недопустимые состояния становятся непредставимыми**. Модель `{ loading: boolean; data?: T; error?: Error }` допускает четыре комбинации флагов, из которых осмысленны две-три: «загрузка с ошибкой и данными одновременно» компилятор не запрещает. В размеченном объединении у `loading` нет поля `data`, и обратиться к нему без проверки нельзя.

Дискриминантом может быть и `undefined` у необязательного поля: `{ data: T; error?: undefined } | { data?: undefined; error: Error }` сужается по `if (r.error)`. Так типизируют результаты в стиле «`data` или `error`».

### `never` и исчерпываемость

Когда все варианты объединения отсечены, остаётся `never`. Это используют для проверки исчерпываемости (exhaustiveness checking): в `default` значение передают туда, где ожидается `never`. Если кто-то добавит вариант в объединение и забудет ветку, остаток станет этим вариантом, и компиляция упадёт **в месте, где ветку забыли**:

```ts
function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}
```

Варианты записи: `assertNever(x)` в `default` (плюс рантайм-ошибка для данных, которые пришли не того типа), `x satisfies never` (только компиляция) или явный возвращаемый тип без `default` — ошибка 2366 «Function lacks ending return statement». Третий способ слабее: он ловит пропуск, только если функция возвращает значение. Правило typescript-eslint `switch-exhaustiveness-check` делает то же линтером.

> [!TIP]
> `assertNever` в `default` полезен и в рантайме. Данные с сервера могут прийти с новым статусом раньше, чем обновится фронтенд. Тогда лучше явная ошибка с самим значением в сообщении, чем `undefined` дальше по коду.

## Примеры

```ts
// Narrowing an unknown API payload without `as` (relies on `in` narrowing, TS 4.9+).
function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string') {
    return e.message; // e: object & Record<'message', unknown>, e.message narrowed to string
  }
  return String(e);
}

// Aliased condition: works with const, not with let.
function format(x: string | number) {
  const isStr = typeof x === 'string';
  return isStr ? x.toUpperCase() : x.toFixed(2);
}

// Inferred type predicate (TS 5.5+).
const ids = [1, null, 3].filter((x) => x !== null); // number[]
```

```ts
// Request state in a Pinia setup store: impossible states are unrepresentable.
import { defineStore } from 'pinia';
import { ref } from 'vue';

type RequestState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };

export const useUsersStore = defineStore('users', () => {
  const state = ref<RequestState<string[]>>({ status: 'idle' });

  async function load() {
    state.value = { status: 'loading' };
    try {
      const data: string[] = await (await fetch('/api/users')).json();
      state.value = { status: 'success', data };
    } catch (e) {
      state.value = { status: 'error', error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  const count = () => {
    const s = state.value; // copy: narrowing a property does not survive callbacks
    return s.status === 'success' ? s.data.length : 0;
  };

  return { state, load, count };
});
```

`isRef` во Vue — тоже предикат: `isRef<T>(r: Ref<T> | unknown): r is Ref<T>`. Поэтому `isRef(x) ? x.value : x` компилируется без `as` (сверено по типам Vue 3.5.45). А `isReactive` возвращает просто `boolean` и ничего не сужает.

## Вопросы с интервью

::: details Что такое сужение типов и как компилятор его выполняет?
Сужение — уточнение типа переменной в конкретной точке кода по результатам проверок. Компилятор строит граф потока управления: ветки `if`/`switch`, ранние `return` и `throw`, логические операторы, и протаскивает по нему сужённый тип. В точках слияния веток типы объединяются. Сужают `typeof`, `===`/`!==`, `!= null`, `in`, `instanceof`, истинность, `Array.isArray`, присваивание, а также свои предикаты и assertion functions. Важно, что объявленный тип не меняется: присваивание проверяется против него. И что сужение статическое: TypeScript ничего не добавляет в рантайм, он только понимает проверки, которые написаны в JavaScript-коде.
:::

::: details Почему проверка typeof x === 'object' не убирает null и чем опасна проверка на истинность?
`typeof null === 'object'` — историческая ошибка JavaScript, и компилятор её моделирует честно: в ветке остаётся `T | null`, нужна отдельная `x !== null`. Проверка истинности убирает `null` и `undefined`, но заодно отсекает `0`, `''`, `0n` и `NaN`. Для компилятора это корректное сужение, поэтому ошибку он не покажет. `if (count)` пропустит ноль, `if (name)` — пустую строку. Для «есть значение» правильная проверка — `x != null` или `x !== undefined`. В TypeScript 5.5 это проявилось в выводе предикатов: `filter((x) => !!x)` по числам предиката не даёт, именно потому что `false` может означать `0`.
:::

::: details Что такое discriminated union и зачем он нужен?
Объединение объектных типов с общим полем-литералом, например `status: 'idle' | 'loading' | 'success' | 'error'`. Сравнение этого поля оставляет один вариант, и становятся доступны поля, которые есть только в нём: `data` у `success`, `error` у `error`. Главная выгода — недопустимые состояния непредставимы: в модели с флагами `loading`, `data?`, `error?` можно одновременно иметь загрузку и ошибку, а в размеченном объединении нет. Плюс проверка исчерпываемости: новый вариант заставляет обновить все `switch`. Требование — литеральный тип дискриминанта. Если в одном варианте он `string`, сравнение его не отсекает, и сужение по этому полю ломается.
:::

::: details Как гарантировать, что switch обрабатывает все варианты объединения?
Через `never`. После всех `case` остаток объединения пуст, то есть `never`. В `default` значение передают в `assertNever(x: never): never`, которая бросает ошибку. Если в объединение добавить вариант и забыть ветку, остаток станет этим вариантом, и компилятор укажет на строку с `assertNever`. Альтернативы: `x satisfies never` (без рантайм-части), явный возвращаемый тип без `default` (ошибка «Function lacks ending return statement», работает только если функция возвращает значение), правило typescript-eslint `switch-exhaustiveness-check`. Рантайм-бросок полезен для данных с сервера, где новый статус может прийти раньше нового фронтенда.
:::

::: details Чем пользовательский предикат типа отличается от assertion function, и насколько они безопасны?
Предикат `x is T` возвращает `boolean` и сужает в условии: в true-ветке до `T`, в false-ветке исключает `T`. Assertion function `asserts x is T` ничего не возвращает: она либо бросает, либо после её вызова весь остаток кода видит `x: T`. Ею удобно проверять данные на границе системы. Обе небезопасны так же, как `as`: тело компилятор не сверяет с сигнатурой. Ещё одна ловушка — семантика «тогда и только тогда»: если функция возвращает `false` и для значений типа `T` (`!!x` для пустой строки), false-ветка сузит неправильно. Ограничение утверждений: функцию нужно вызывать через имя с явной аннотацией типа. Стрелку с выведенным типом вызвать как утверждение нельзя, это ошибка 2775.
:::

::: details Почему сужение пропадает внутри колбэка и когда TypeScript 5.4 его сохраняет?
Колбэк может выполниться позже, когда переменная уже переприсвоена, поэтому сужение по умолчанию внутрь функций не переносится. `const` и параметры без присваиваний сохраняют его всегда: они не меняются. С TypeScript 5.4 `let` и параметры тоже сохраняют сужение в стрелке или функциональном выражении, созданных после последнего присваивания. В `function`-объявлении нет: оно поднимается и может быть вызвано раньше. Любое присваивание внутри вложенной функции отменяет перенос. Для свойств (`o.v`, `ref.value`) сужение в колбэк не переносится никогда. Решение — скопировать значение в `const` до колбэка.
:::

::: details Где сужение типов в TypeScript некорректно, то есть компилируется код, который падает?
Несколько известных мест. Первое — свои предикаты и утверждения: тело не проверяется. Второе — сужение свойства не сбрасывается вызовом функции и `await`: `if (user.value) { await reload(); user.value.name }` компилируется, хотя `reload` мог обнулить значение. Это сознательный компромисс, иначе почти любой код требовал бы повторных проверок. Во Vue с реактивным состоянием это реальный источник багов: после `await` значение нужно перечитать. Третье — `as` и `any`, которые сужение просто обходят. Четвёртое — данные из `JSON.parse` и `fetch`: им приписывают тип без проверки. Правильная граница — `unknown` плюс валидация схемой или assertion function.
:::

## Задачи

### 1. Исчерпывающий switch · легко

В объединение `Shape` добавили `triangle`. Сделайте так, чтобы `area` перестала компилироваться, пока ветку не добавят, а в рантайме неизвестная фигура давала понятную ошибку.

```ts
type Shape =
  | { kind: 'circle'; r: number }
  | { kind: 'square'; side: number }
  | { kind: 'triangle'; base: number; height: number };

function area(s: Shape): number {
  switch (s.kind) {
    case 'circle': return Math.PI * s.r ** 2;
    case 'square': return s.side ** 2;
  }
}
```

::: details Решение и разбор
```ts
function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}

function area(s: Shape): number {
  switch (s.kind) {
    case 'circle': return Math.PI * s.r ** 2;
    case 'square': return s.side ** 2;
    default: return assertNever(s);
    // Error: Argument of type '{ kind: "triangle"; base: number; height: number; }'
    // is not assignable to parameter of type 'never'.
  }
}
```

После двух `case` в `default` остаётся `{ kind: 'triangle'; … }`, и он не присваивается `never`. Ошибка называет пропущенный вариант. Когда ветку добавят, остаток станет `never`, и код скомпилируется. `return` перед `assertNever` нужен потому, что функция объявлена с типом `number`, а `never` присваивается чему угодно.

Исходный код, кстати, тоже не компилировался бы: явный тип `number` без `default` даёт ошибку 2366. Но этот способ не работает для функций, которые ничего не возвращают, и не даёт рантайм-ошибки. `s satisfies never` дал бы только проверку при компиляции.
:::

### 2. Где компилятор не видит сужения · средне

Какие строки не компилируются в режиме `strict` и почему?

```ts
type Fish = { swim(): void };
type Bird = { fly(): void };
type Duck = { swim?(): void; fly(): void };
type Ev = { kind: string; payload: unknown } | { kind: 'click'; x: number };

function t1(x: string[] | null) { if (typeof x === 'object') x.length; }                 // 1
function t2(x: number | undefined) { if (!x) return x; }                                // 2: type of x?
function t3(p: Fish | Bird | Duck) { if ('swim' in p) p.swim(); }                      // 3
function t4(x: string | number) { let isStr = typeof x === 'string'; if (isStr) x.toUpperCase(); }   // 4
function t5(x: string | number) { const isStr = typeof x === 'string'; if (isStr) x.toUpperCase(); } // 5
function t6(e: Ev) { if (e.kind === 'click') e.x; }                                     // 6
function t7(o: { v: string | null }) { if (o.v !== null) setTimeout(() => o.v.length); } // 7
```

::: details Решение и разбор
- **1 — ошибка.** `'x' is possibly 'null'`: `typeof null === 'object'`.
- **2 — компилируется**, но тип `x` в `return` — `number | undefined`, а не `undefined`. Ложным бывает и `0`, а отдельного типа «ноль из `number`» нет.
- **3 — ошибка.** `Cannot invoke an object which is possibly 'undefined'`. У `Duck` метод `swim` необязательный, поэтому `Duck` попадает в true-ветку `in`, где `swim` может отсутствовать.
- **4 — ошибка.** Псевдоним условия работает только для `const`: `let isStr` можно переприсвоить.
- **5 — компилируется.** Псевдоним условия (TypeScript 4.4+).
- **6 — ошибка.** У первого варианта `kind: string`, а `'click'` — подмножество `string`, так что сравнение первый вариант не отсекает. Это не discriminated union. Исправление — литералы во всех вариантах или `Exclude`-тип для «остальных».
- **7 — ошибка.** Сужение свойства не переносится в колбэк. Исправление: `const v = o.v; if (v !== null) setTimeout(() => v.length)`.

Все ответы проверены на TypeScript 7.0.2 (`--strict`).
:::

### 3. Type guard для ответа API · средне

Напишите проверку, которая из `unknown` получает `User`, без `as` внутри. Сделайте и версию-утверждение для использования сразу после `fetch`.

```ts
interface User { id: number; name: string; tags: string[] }
```

::: details Решение и разбор
```ts
function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' && value !== null &&
    'id' in value && typeof value.id === 'number' &&
    'name' in value && typeof value.name === 'string' &&
    'tags' in value && Array.isArray(value.tags) &&
    value.tags.every((t) => typeof t === 'string')
  );
}

function assertUser(value: unknown): asserts value is User {
  if (!isUser(value)) throw new TypeError('Response is not a User');
}

async function loadUser(id: number): Promise<User> {
  const data: unknown = await (await fetch(`/api/users/${id}`)).json();
  assertUser(data);
  return data; // narrowed to User
}
```

`as` не нужен благодаря сужению через `in` (TypeScript 4.9+): после `'id' in value` тип становится `object & Record<'id', unknown>`, и `value.id` можно проверить `typeof`. `.json()` возвращает `any`, поэтому явная аннотация `data: unknown` обязательна: с `any` компилятор пропустил бы всё без проверки.

Почему аннотация `value is User` всё равно нужна: TypeScript 5.5 выводит предикат, только если `false` гарантирует «не тот тип», а здесь проверяются свойства, не сам параметр. Без аннотации функция вернёт просто `boolean`. И раз тело с сигнатурой не сверяется, ошибка в проверке (забыли `tags`) станет дырой: тестируйте guard отдельно. На практике такие проверки генерируют из схемы (Zod, Valibot): схема даёт и рантайм-проверку, и тип.

`assertUser` объявлена через `function`: стрелку с выведенным типом нельзя вызывать как утверждение (ошибка 2775).
:::

### 4. Состояние запроса без невозможных комбинаций · средне

Composable хранит состояние запроса так. Перепишите тип, чтобы «загрузка с ошибкой» и «успех без данных» стали непредставимы, а шаблонный код получал `data` только после проверки.

```ts
const loading = ref(false);
const data = ref<User[] | undefined>();
const error = ref<Error | undefined>();
```

::: details Решение и разбор
```ts
type RequestState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };

function useRequest<T>(fetcher: () => Promise<T>) {
  const state = ref<RequestState<T>>({ status: 'idle' });

  async function run() {
    state.value = { status: 'loading' };
    try {
      state.value = { status: 'success', data: await fetcher() };
    } catch (e) {
      state.value = { status: 'error', error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  return { state, run };
}

const { state } = useRequest(() => api.getUsers());
if (state.value.status === 'success') state.value.data.length; // data: User[]
```

Три независимых `ref` дают 2 × 2 × 2 = 8 комбинаций, из которых осмысленны четыре. Объединение описывает ровно эти четыре. Каждое присваивание целиком заменяет состояние, поэтому забыть сбросить `error` при новой загрузке невозможно.

Проверка исчерпываемости работает и здесь: если в шаблоне или `computed` разбирать `status` через `switch` с `assertNever`, новый статус (`'refreshing'`) заставит обновить все места разбора. Типизация `ref` и шаблонов с `vue-tsc` — в теме «TypeScript во Vue».

Если состояние лежит в Pinia и читается внутри колбэка или после `await`, его копируют в `const`: сужение свойства в колбэк не переносится, а после `await` оно сохраняется, хотя значение могло смениться.
:::

### 5. Типобезопасный `match` · сложно

Напишите `match(value, handlers)`: в `handlers` должен быть ровно один обработчик на каждый вариант размеченного объединения, и каждый обработчик получает уже сужённый вариант. Забытый вариант и обращение к чужому полю — ошибки компиляции.

```ts
type Shape = { kind: 'circle'; r: number } | { kind: 'square'; side: number };

declare const shape: Shape;
match(shape, { circle: (c) => c.r, square: (s) => s.side });  // OK: number
match(shape, { circle: (c) => c.r });                         // Error: 'square' is missing
match(shape, { circle: (c) => c.side, square: (s) => s.side }); // Error: no 'side' on circle
```

::: details Решение и разбор
```ts
type Handlers<T extends { kind: string }, R> = {
  [K in T['kind']]: (value: Extract<T, { kind: K }>) => R;
};

function match<T extends { kind: string }, R>(value: T, handlers: Handlers<T, R>): R {
  const handler = handlers[value.kind as T['kind']] as (value: T) => R;
  return handler(value);
}
```

`T['kind']` — объединение всех дискриминантов (`'circle' | 'square'`). Mapped type `[K in T['kind']]` делает по обязательному ключу на каждый, отсюда ошибка о пропущенном `square`. `Extract<T, { kind: K }>` оставляет из объединения варианты, присваиваемые `{ kind: K }`, то есть делает то же сужение, что `if (v.kind === K)`, но на уровне типов. Поэтому `c` в обработчике `circle` — только круг.

Внутри `match` два `as`, и без них не обойтись. Компилятор не связывает тип `value.kind` с типом `value`: для него `handlers[value.kind]` — объединение всех обработчиков, и вызвать его с `value` нельзя. Это ограничение называют «correlated unions» (issue microsoft/TypeScript#30581). Небезопасный код локализован в одной функции, а снаружи API строго типизирован. Это обычный приём библиотек вроде ts-pattern.

Сравнение со `switch` + `assertNever`: `match` — выражение, его удобно использовать в `computed` и шаблонах. Зато `switch` не требует отдельной функции и лучше читается при сложных ветках. Подробнее о mapped и conditional types — в теме «Utility, conditional и mapped types».

Сложность: O(1) по времени — один поиск по ключу.
:::

## Источники

- [TypeScript Handbook: Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- [TypeScript 3.7 Release Notes: assertion functions](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html)
- [TypeScript 4.4 Release Notes: control flow analysis of aliased conditions](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-4.html)
- [TypeScript 4.6 Release Notes: destructured discriminated unions](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-6.html)
- [TypeScript 4.9 Release Notes: unlisted property narrowing with `in`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html)
- [TypeScript 5.3 Release Notes: `switch (true)` narrowing, `instanceof` through `Symbol.hasInstance`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-3.html)
- [TypeScript 5.4 Release Notes: preserved narrowing in closures](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-4.html)
- [TypeScript 5.5 Release Notes: inferred type predicates, constant indexed access narrowing](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html)
- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [Announcing TypeScript 7.1 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)
- [MDN: typeof](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof), [MDN: in](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/in)
- [TypeScript issue #9998: trade-offs in control flow analysis](https://github.com/microsoft/TypeScript/issues/9998), [#30581: correlated unions](https://github.com/microsoft/TypeScript/issues/30581)
- [Vue: Reactivity API — isRef](https://vuejs.org/api/reactivity-utilities.html#isref)
- [typescript-eslint: switch-exhaustiveness-check](https://typescript-eslint.io/rules/switch-exhaustiveness-check/)
