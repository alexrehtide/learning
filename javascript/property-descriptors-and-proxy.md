---
title: Дескрипторы свойств, `Proxy` и `Reflect`
level: ядро
---

# Дескрипторы свойств, `Proxy` и `Reflect`

> **Коротко.** Свойство объекта — это ключ и набор атрибутов: `value`/`writable` у data-свойства или `get`/`set` у аксессора, плюс `enumerable` и `configurable`. Атрибутами управляют `Object.defineProperty`, `freeze` и `seal`. `Proxy` идёт дальше и перехватывает сами операции над объектом (чтение, запись, `in`, `delete`, перечисление ключей), но обязан соблюдать инварианты цели. `Reflect` даёт стандартную реализацию каждой операции, и прежде всего правильный `receiver`. На `defineProperty` была построена реактивность Vue 2, на `Proxy` — Vue 3.

**Связанные темы:** [Прототипы и классы](./prototypes-and-classes.md), [Функции и `this`](./functions-and-this.md), [Типы данных и приведение типов](./types-and-coercion.md), [Деструктуризация, spread/rest и современный синтаксис](./modern-syntax.md)

## Теория

### Свойство = ключ + атрибуты

Ключ свойства — строка или символ. Остальное описывает **дескриптор** (Property Descriptor). Он бывает двух видов:

| Атрибут | data-свойство | accessor-свойство | Смысл |
| --- | --- | --- | --- |
| `value` | ✓ | — | значение |
| `writable` | ✓ | — | можно ли менять `value` присваиванием |
| `get` / `set` | — | ✓ | функции, вызываемые при чтении и записи |
| `enumerable` | ✓ | ✓ | видно ли в `for...in`, `Object.keys`, spread, `JSON.stringify` |
| `configurable` | ✓ | ✓ | можно ли удалить свойство и менять его атрибуты |

Смешать виды нельзя: дескриптор с `get` и `value` одновременно — `TypeError`.

Значения по умолчанию зависят от способа создания, и на этом ловятся чаще всего:

- присваивание `o.x = 1` и литерал `{ x: 1 }` — все флаги `true`;
- `Object.defineProperty(o, 'x', { value: 1 })` — недостающие атрибуты становятся `false` (или `undefined` для `value`/`get`/`set`). Свойство получается неперечисляемым, неизменяемым и неудаляемым;
- методы и аксессоры класса — `enumerable: false` на прототипе, а поля класса — обычные свойства с `true` (см. [«Прототипы и классы»](./prototypes-and-classes.md)).

Прочитать дескриптор можно через `Object.getOwnPropertyDescriptor(o, key)` или `Object.getOwnPropertyDescriptors(o)`. Записать — через `Object.defineProperty`, `Object.defineProperties` или вторым аргументом `Object.create`.

### Что запрещает `configurable: false`

Правила проверяет `ValidateAndApplyPropertyDescriptor`. Для неконфигурируемого свойства нельзя:

- удалить его (`delete` в strict mode — `TypeError`, иначе `false`);
- поменять `enumerable` или `configurable`;
- превратить data-свойство в аксессор или обратно;
- заменить `get`/`set` на другие функции;
- поменять `value` у свойства с `writable: false` или вернуть `writable: true`.

Одно направление открыто: `writable` можно сменить с `true` на `false`, а пока свойство записываемое, `defineProperty` меняет его `value`. Повторный `defineProperty` с теми же значениями не ошибка. Так устроен `length` массива: `{ writable: true, enumerable: false, configurable: false }`, удалить его нельзя, менять можно.

### Уровни целостности: `preventExtensions`, `seal`, `freeze`

| | Новые свойства | Удаление | Смена атрибутов | Запись значений |
| --- | --- | --- | --- | --- |
| `Object.preventExtensions` | нет | да | да | да |
| `Object.seal` | нет | нет | нет | да |
| `Object.freeze` | нет | нет | нет | нет (у data-свойств) |

`seal` и `freeze` реализованы через `SetIntegrityLevel`: `[[PreventExtensions]]`, а затем `configurable: false` (и `writable: false` для `freeze`) у каждого **собственного** свойства. Отсюда следствия:

- `freeze` поверхностный: вложенные объекты и массивы остаются изменяемыми;
- аксессоры замороженного объекта работают: сеттер вызывается и может менять данные в замыкании;
- `freeze` не трогает внутренние слоты. Замороженный `Map` по-прежнему принимает `set`, `Date` — `setFullYear`. `Object.freeze` над непустым typed array — `TypeError`;
- у нерасширяемого объекта нельзя сменить `[[Prototype]]` (кроме установки того же самого);
- `const` не имеет отношения к заморозке: он запрещает переприсвоить привязку, а не менять объект.

`Object.isFrozen` проверяет состояние, а не историю: пустой объект после `preventExtensions` уже считается замороженным, примитив — тоже.

### Кто какие ключи видит и в каком порядке

Собственные ключи обычного объекта (`OrdinaryOwnPropertyKeys`) идут в фиксированном порядке: сначала целочисленные индексы по возрастанию, затем строки в порядке создания, затем символы в порядке создания. `'-1'` и `'01'` — не индексы, это обычные строки.

| API | Собственные | Унаследованные | Неперечисляемые | Символы |
| --- | --- | --- | --- | --- |
| `for...in` | ✓ | ✓ | — | — |
| `Object.keys` / `values` / `entries` | ✓ | — | — | — |
| `Object.getOwnPropertyNames` | ✓ | — | ✓ | — |
| `Object.getOwnPropertySymbols` | ✓ | — | ✓ | только они |
| `Reflect.ownKeys` | ✓ | — | ✓ | ✓ |
| `JSON.stringify` | ✓ | — | — | — |
| `{ ...obj }`, `Object.assign` | ✓ | — | — | ✓ |

Spread и `Object.assign` копируют одно и то же, но по-разному. `Object.assign` **присваивает** через `[[Set]]`: срабатывают сеттеры цели, а неперезаписываемое свойство цели даёт `TypeError`. Spread **определяет** свойства (`CopyDataProperties` → `CreateDataProperty`), поэтому сеттеры не вызываются. Оба читают геттеры источника и копируют **значение**, а не аксессор. Скопировать объект с геттерами, неперечисляемыми свойствами и прототипом можно так: `Object.create(Object.getPrototypeOf(o), Object.getOwnPropertyDescriptors(o))` (см. задачу 3).

### `Proxy`: перехват внутренних методов

Любая операция над объектом сводится к одному из внутренних методов: `[[Get]]`, `[[Set]]`, `[[HasProperty]]` и т. д. У обычного объекта они реализованы алгоритмами `Ordinary*`. `new Proxy(target, handler)` создаёт exotic-объект, у которого каждый внутренний метод сначала ищет **ловушку** (trap) в `handler`. Если ловушки нет, операция уходит в `target` как есть.

| Ловушка | Срабатывает на |
| --- | --- |
| `get` / `set` | `p.x`, `p[k]`; `p.x = v`, в том числе через прототип |
| `has` | `k in p`, `with` |
| `deleteProperty` | `delete p.x` |
| `ownKeys` | `Object.keys`, `Reflect.ownKeys`, `for...in`, spread, `JSON.stringify` |
| `getOwnPropertyDescriptor` / `defineProperty` | одноимённые методы `Object`, а также фильтр перечисляемости в `Object.keys` |
| `getPrototypeOf` / `setPrototypeOf` | `Object.getPrototypeOf`, `instanceof`, `__proto__` |
| `isExtensible` / `preventExtensions` | `Object.isExtensible`, `preventExtensions`, `seal`, `freeze` |
| `apply` / `construct` | `p()`, `new p()` — только если цель вызываемая |

Ловушек ровно 13, и у `Reflect` ровно 13 одноимённых методов. `Proxy` нельзя вызвать без `new`, цель и обработчик должны быть объектами. У `Proxy` нет `prototype`, поэтому `x instanceof Proxy` не работает: прокси снаружи неотличим от обычного объекта. `typeof` прокси совпадает с `typeof` цели, `Array.isArray` над прокси массива — `true`. `Proxy.revocable` возвращает `{ proxy, revoke }`: после `revoke()` любая операция с прокси — `TypeError`. Так выдают временный доступ к объекту.

Чего `Proxy` не перехватывает:

- **идентичность**: `proxy !== target`, `===`, `Set`, `WeakMap` и `includes` видят два разных объекта;
- **внутренние слоты**: `Map.prototype.get`, `Date.prototype.getTime` и подобные проверяют, что `this` — настоящий `Map` или `Date`, а не прокси. Поэтому `new Proxy(new Map(), {}).get('a')` даёт `TypeError: Method Map.prototype.get called on incompatible receiver`;
- **приватные элементы** `#x` хранятся в `[[PrivateElements]]` и не идут через `[[Get]]`. Метод с `this` = прокси падает на `this.#x` (подробнее — в [«Прототипах и классах»](./prototypes-and-classes.md#vue-классы-и-реактивность));
- `typeof`, строгое сравнение и операции над примитивами.

### Инварианты

Прокси не может врать о том, что цель зафиксировала навсегда. После каждой ловушки движок сверяет результат с целью и при нарушении бросает `TypeError`. Основные инварианты (`Invariants of the Essential Internal Methods`):

- `get` для неконфигурируемого незаписываемого data-свойства обязан вернуть его настоящее значение;
- `has` и `getOwnPropertyDescriptor` не могут скрыть неконфигурируемое свойство или любое свойство нерасширяемой цели;
- `ownKeys` возвращает список строк и символов без дублей. В нём обязаны быть все неконфигурируемые ключи цели, а у нерасширяемой цели — ровно её ключи;
- `getOwnPropertyDescriptor` не может назвать свойство неконфигурируемым, если у цели оно конфигурируемое или его нет;
- `getPrototypeOf` нерасширяемой цели обязан вернуть её настоящий прототип;
- `set`, `deleteProperty`, `defineProperty` возвращают boolean. `false` в strict mode превращается в `TypeError`, поэтому ловушка, которая забыла `return true`, ломает присваивание.

Практический вывод: прокси над замороженным объектом почти ничего не может подменить. Это касается и библиотек: ниже видно, как Vue из-за этого инварианта отказывается проксировать нерасширяемые объекты.

> [!NOTE]
> `Object.keys` над прокси вызывает две ловушки: `ownKeys`, а затем `getOwnPropertyDescriptor` для каждого ключа, чтобы отфильтровать неперечисляемые. Если `ownKeys` вернул ключ, которого у цели нет, а ловушки `getOwnPropertyDescriptor` нет, ключ молча пропадёт из `Object.keys`, хотя будет виден в `Reflect.ownKeys`.

### `Reflect` и `receiver`

`Reflect` — объект со статическими методами, повторяющими внутренние методы один к одному. Зачем он нужен, если есть `Object.*` и операторы:

- **результат вместо исключения.** `Reflect.defineProperty`, `Reflect.set`, `Reflect.deleteProperty`, `Reflect.setPrototypeOf` и `Reflect.preventExtensions` возвращают `false` там, где `Object.*` бросает `TypeError` (или где оператор молча не срабатывает в sloppy mode);
- **функции вместо операторов**: `Reflect.has(o, k)` вместо `k in o`, `Reflect.apply(fn, thisArg, args)` вместо `fn.apply`, который можно переопределить у самой функции, `Reflect.construct(C, args, newTarget)` вместо `new` с произвольным `new.target`;
- **точное соответствие ловушкам.** Сигнатура `Reflect.x` совпадает с ловушкой `x`, поэтому «сделай как обычно» в ловушке пишется как `return Reflect.x(...arguments)`.

Главная причина — **`receiver`**. `[[Get]](key, receiver)` и `[[Set]](key, value, receiver)` принимают объект, который станет `this` для геттера или сеттера. Для `p.x` receiver — сам прокси. Если прокси стоит в цепочке прототипов, receiver — наследник. Ловушка `get(t, k) { return t[k]; }` теряет его: геттер выполнится с `this === target`, и его внутренние чтения пройдут мимо прокси. `set(t, k, v) { t[k] = v; }` вдобавок пишет в цель, а не создаёт собственное свойство у наследника. `Reflect.get(t, k, receiver)` и `Reflect.set(t, k, v, receiver)` выполняют `OrdinaryGet`/`OrdinarySet` с правильным `this` (см. задачу 4).

> [!WARNING]
> Производительность — свойство движка, а не спецификации. В V8 доступ через прокси медленнее прямого: на каждую операцию вызывается JS-функция ловушки и проверяются инварианты. `delete` и массовая смена атрибутов могут перевести объект в dictionary mode с медленным доступом к свойствам. На горячих путях с большими данными это заметно.

### Vue: от `defineProperty` к `Proxy`

**Vue 2** при инициализации обходил весь объект и превращал каждое свойство в аксессор через `Object.defineProperty`: геттер отслеживал зависимость, сеттер уведомлял подписчиков. У такого подхода есть принципиальные ограничения: аксессор существует только у ключей, которые были при обходе. Отсюда известные ограничения Vue 2: не отслеживаются добавление и удаление свойств (нужны `Vue.set`/`Vue.delete`), присваивание по индексу массива и изменение `length`. Методы массива приходилось патчить, а большой объект обходился целиком сразу.

**Vue 3** создаёт `Proxy`, и операции перехватываются на уровне объекта, а не ключа. В `@vue/reactivity` 3.5 обработчик обычных объектов и массивов перехватывает `get` (track), `set` и `deleteProperty` (trigger), `has` (отслеживает `in`) и `ownKeys` (отслеживает перебор ключей, поэтому добавление свойства перезапускает эффекты с `Object.keys` или `v-for` по объекту). Вложенный объект оборачивается лениво, в момент чтения. Прокси кэшируются в `WeakMap`, поэтому `reactive(raw)` дважды возвращает один и тот же прокси. Внутри ловушек — `Reflect.get`/`Reflect.set` с `receiver`, а `set` проверяет `target === toRaw(receiver)`, чтобы не вызывать trigger, когда запись пришла от наследника через прототип.

Что осталось от природы `Proxy`:

- **идентичность**: `reactive(raw) !== raw`, вложенные `state.x !== raw.x`. Сравнивать с сырыми объектами — через `toRaw`. Для массивов Vue инструментирует `includes`/`indexOf`, чтобы они находили и сырые, и реактивные элементы;
- **примитивы и деструктуризация**: проксировать можно только объект, поэтому для примитивов нужен `ref`, а `const { count } = state` копирует значение и теряет связь;
- **внутренние слоты**: для `Map`/`Set`/`WeakMap`/`WeakSet` у Vue отдельные collection handlers, которые вызывают методы на сырой коллекции. `Date`, `RegExp`, `Promise` и прочие встроенные объекты Vue не проксирует вообще и возвращает как есть;
- **нерасширяемые объекты**: `reactive(Object.freeze(obj))` возвращает сам `obj` без прокси, и вложенный замороженный массив в реактивном состоянии остаётся сырым. Это дешёвый способ отключить реактивность для большого неизменяемого списка. `markRaw` делает то же самое явно: ставит неперечисляемый флаг `__v_skip` через `defineProperty`;
- **инварианты**: если у объекта есть неконфигурируемое незаписываемое свойство со значением-объектом, `reactive(obj).prop` бросает `TypeError`. Ловушка `get` пытается вернуть реактивную обёртку вместо настоящего значения (проверено на Vue 3.5.45).

Сами ловушки, `track`/`trigger` и устройство эффектов — тема раздела про Vue.

## Примеры

### Неизменяемая константа и вычисляемое свойство

```js
const config = {};
Object.defineProperty(config, 'API_URL', {
  value: 'https://api.example.com',
  enumerable: true,             // writable and configurable default to false
});
config.API_URL = 'x';           // silently ignored in sloppy mode, TypeError in strict

const rect = { w: 2, h: 3 };
Object.defineProperty(rect, 'area', {
  get() { return this.w * this.h; },
  enumerable: false,            // computed, not data: hide from keys and JSON
});
rect.area;                      // 6
JSON.stringify(rect);           // '{"w":2,"h":3}'
```

### Прокси-валидатор и «отрицательные индексы»

```js
function typed(schema) {
  return new Proxy({}, {
    set(target, key, value, receiver) {
      const type = schema[key];
      if (!type) throw new TypeError(`Unknown field: ${String(key)}`);
      if (typeof value !== type) throw new TypeError(`${String(key)} must be ${type}`);
      return Reflect.set(target, key, value, receiver);   // must return true on success
    },
  });
}
const user = typed({ name: 'string', age: 'number' });
user.name = 'Ann';
user.age = '42';                // TypeError: age must be number

const at = (arr) => new Proxy(arr, {
  get(target, key, receiver) {
    if (typeof key === 'string' && /^-\d+$/.test(key)) key = String(target.length + Number(key));
    return Reflect.get(target, key, receiver);
  },
});
at([1, 2, 3])[-1];              // 3 (the built-in alternative is arr.at(-1))
```

## Вопросы с интервью

::: details Какие бывают дескрипторы свойств и какие атрибуты получаются по умолчанию?
Data-дескриптор содержит `value` и `writable`, accessor-дескриптор — `get` и `set`. У обоих есть `enumerable` и `configurable`, а смешивать виды нельзя (`TypeError`). Значения по умолчанию зависят от способа создания. При присваивании и в литерале все флаги `true`. В `Object.defineProperty` недостающие флаги становятся `false`: свойство получается неперечисляемым, неизменяемым и неудаляемым. Поэтому `defineProperty(o, 'x', { value: 1 })` даёт свойство, которого не видно в `Object.keys` и которое нельзя ни перезаписать, ни удалить.
:::

::: details Что запрещает configurable false и можно ли после него изменить значение?
Неконфигурируемое свойство нельзя удалить, нельзя поменять его `enumerable`, тип (data ↔ accessor) и функции `get`/`set`. Значение менять можно, если свойство записываемое: и присваиванием, и через `defineProperty`. `writable` разрешено перевести из `true` в `false`, но не обратно. Пример — `length` массива: он неконфигурируемый, но записываемый. Полная заморозка свойства — `configurable: false` плюс `writable: false`, это и делает `Object.freeze`.
:::

::: details Чем отличаются preventExtensions, seal и freeze, и почему freeze не делает объект неизменяемым?
`preventExtensions` запрещает добавлять свойства и менять прототип. `seal` дополнительно делает все собственные свойства неконфигурируемыми: их нельзя удалить, но можно перезаписать. `freeze` вдобавок делает data-свойства незаписываемыми. Все три работают только с собственными свойствами верхнего уровня. Вложенные объекты остаются изменяемыми, аксессоры продолжают работать, а внутренние слоты (`Map`, `Date`) не затрагиваются. Глубокая заморозка требует рекурсивного обхода (задача 2). `const` здесь ни при чём: он запрещает переприсвоить переменную, а не изменять объект.
:::

::: details Чем Object.assign отличается от spread и как скопировать объект вместе с геттерами?
Оба копируют собственные перечисляемые свойства, включая символьные, и оба читают геттеры источника, поэтому в копию попадает значение, а не аксессор. Разница на стороне цели. `Object.assign` присваивает через `[[Set]]`: вызываются сеттеры цели, а неперезаписываемое свойство даёт `TypeError`. Spread определяет новые свойства и сеттеры не трогает. Чтобы сохранить аксессоры, неперечисляемые свойства и прототип, используют `Object.create(Object.getPrototypeOf(o), Object.getOwnPropertyDescriptors(o))`. Это всё равно поверхностная копия, она не переносит приватные поля и внутренние слоты.
:::

::: details Что такое Proxy и что он не может перехватить?
`Proxy` — exotic-объект, у которого каждый из 13 внутренних методов сначала ищет ловушку в `handler`, а без неё обращается к `target`. Так перехватываются чтение, запись, `in`, `delete`, перечисление ключей, дескрипторы, прототип, расширяемость, вызов и `new`. Не перехватываются идентичность (`proxy !== target`), `typeof` и доступ к внутренним слотам и приватным полям. Поэтому методы `Map`, `Date` и классов с `#x` падают, если `this` — прокси. Кроме того, ловушки ограничены инвариантами. Например, нельзя вернуть из `get` другое значение для замороженного свойства или скрыть неконфигурируемый ключ: движок проверяет результат и бросает `TypeError`.
:::

::: details Зачем нужен Reflect и параметр receiver в ловушках прокси?
`Reflect` содержит стандартные реализации тех же 13 операций с сигнатурами ловушек. Поэтому `Reflect.get(t, k, r)` — честное «сделай как обычно». Методы возвращают `false` вместо исключения и заменяют операторы функциями. `receiver` — объект, который станет `this` в геттере или сеттере: сам прокси или наследник, если прокси стоит в цепочке прототипов. `return target[key]` выполняет геттер с `this === target`, и его внутренние чтения не проходят через прокси, а значит, не логируются и не отслеживаются. `target[key] = value` при записи через наследника меняет общую цель вместо собственного свойства наследника. Vue 3 по этой причине везде использует `Reflect.get`/`Reflect.set` с `receiver`.
:::

::: details Почему Vue 3 перешёл с Object.defineProperty на Proxy и какие ограничения остались?
`defineProperty` превращает в аксессор каждый существующий ключ. Поэтому Vue 2 не видел добавления и удаления свойств (нужны были `Vue.set`/`Vue.delete`), записи по индексу массива и изменения `length`, а большой объект обходил целиком при инициализации. `Proxy` перехватывает операции на уровне объекта: `get`, `set`, `deleteProperty`, `has`, `ownKeys`. Вложенные объекты оборачиваются лениво при чтении. Остались ограничения самого `Proxy`: `reactive(obj) !== obj` (сравнивать через `toRaw`), примитивам нужен `ref`, деструктуризация теряет реактивность. Коллекциям нужны отдельные обработчики из-за внутренних слотов, а `#private` в реактивных классах ломаются. Замороженные объекты Vue не проксирует, поэтому `Object.freeze` и `markRaw` используют, чтобы отключить реактивность для больших неизменяемых данных.
:::

## Задачи

### 1. Предскажите вывод · легко

```js
'use strict';
const user = { name: 'Ann' };
Object.defineProperty(user, 'id', { value: 7 });
const copy = { ...user };
const frozen = Object.freeze({ user, tags: ['a'] });

console.log(Object.keys(user), JSON.stringify(user), copy.id, 'id' in user);
frozen.tags.push('b');
console.log(frozen.tags, Object.isFrozen(frozen.user));
user.id = 8;
```

::: details Решение и разбор
```text
[ 'name' ] {"name":"Ann"} undefined true
[ 'a', 'b' ] false
TypeError: Cannot assign to read only property 'id' of object '#<Object>'
```

- `defineProperty` без флагов создал `id` с `enumerable: false`, поэтому его нет в `Object.keys`, `JSON.stringify` и spread-копии. Но свойство существует, и `in` его видит.
- `freeze` поверхностный: массив `tags` и объект `user` не заморожены, `push` работает.
- `writable` по умолчанию `false`, и в strict mode присваивание бросает `TypeError`. В sloppy mode оно молча не сработало бы.
:::

### 2. `deepFreeze` · легко

Напишите `deepFreeze(value)`, который замораживает объект и всё, что в нём лежит: вложенные объекты, массивы, свойства-символы и неперечисляемые свойства. Циклические ссылки не должны приводить к бесконечной рекурсии.

::: details Решение и разбор
```js
function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const desc = Reflect.getOwnPropertyDescriptor(value, key);
    if ('value' in desc) deepFreeze(desc.value, seen);   // do not call getters
  }
  if (ArrayBuffer.isView(value)) return value;           // freeze throws on non-empty typed arrays
  return Object.freeze(value);
}
```

- `Reflect.ownKeys` вместо `Object.keys` нужен, чтобы не пропустить символы и неперечисляемые свойства.
- Значение берётся из дескриптора, а не через `value[key]`: геттер мог бы выполнить побочный эффект или вернуть каждый раз новый объект. Аксессоры остаются рабочими, это ограничение `freeze`.
- `WeakSet` защищает от циклов. Ранний выход по `Object.isFrozen` был бы ошибкой: замороженный объект может содержать незамороженных детей.
- Не замораживаются внутренние слоты: `Map`, `Set` и `Date` останутся изменяемыми через свои методы, а typed array заморозить нельзя вообще. Обход заходит в функции и их `prototype`, если они лежат в данных. Для общих объектов (классов, синглтонов) это неожиданный побочный эффект.

Сложность: O(n) по времени и памяти, где n — число достижимых объектов и свойств.
:::

### 3. Точная поверхностная копия · средне

Напишите `cloneExact(obj)`, который возвращает поверхностную копию с тем же прототипом, теми же дескрипторами (геттеры остаются геттерами, неперечисляемые свойства и символы сохраняются) и тем же уровнем целостности (`frozen`/`sealed`/нерасширяемый). Чем результат отличается от `{ ...obj }` и `structuredClone(obj)`?

::: details Решение и разбор
```js
function cloneExact(obj) {
  const copy = Object.create(Object.getPrototypeOf(obj), Object.getOwnPropertyDescriptors(obj));
  if (Object.isFrozen(obj)) Object.freeze(copy);
  else if (Object.isSealed(obj)) Object.seal(copy);
  else if (!Object.isExtensible(obj)) Object.preventExtensions(copy);
  return copy;
}
```

- `getOwnPropertyDescriptors` возвращает все собственные ключи, включая символы и неперечисляемые. `Object.create` определяет их тем же способом, поэтому аксессоры не вычисляются, а переносятся как функции.
- Уровень целостности копируется после определения свойств: замороженный объект уже не принял бы новых.
- Чего так не скопировать: приватные элементы `#x` и внутренние слоты. `cloneExact(new Date()).getTime()` — `TypeError: this is not a Date object`, а `cloneExact([1, 2])` — обычный объект с прототипом `Array.prototype`, а не exotic-массив: `Array.isArray` даёт `false`, и `length` не обновляется при записи по индексу.
- `{ ...obj }` теряет прототип, неперечисляемые свойства и аксессоры (копирует значения геттеров). `structuredClone` делает глубокую копию и умеет `Date`, `Map`, `Set` и циклы, но теряет прототип и аксессоры и бросает `DataCloneError` на функциях.

Сложность: O(k) по времени и памяти, где k — число собственных свойств.
:::

### 4. Логирующий прокси с ошибками · средне

Прокси должен логировать все чтения и записи. Найдите ошибки и исправьте.

```js
'use strict';
function withLog(target, log) {
  return new Proxy(target, {
    get(t, key) {
      log.push(`get ${String(key)}`);
      return t[key];
    },
    set(t, key, value) {
      log.push(`set ${String(key)}`);
      t[key] = value;
    },
  });
}

const log = [];
const user = withLog({ first: 'Ann', last: 'Lee', get full() { return `${this.first} ${this.last}`; } }, log);
user.full;            // log: ['get full'] — where are first and last?
user.first = 'Bo';    // ?
```

::: details Решение и разбор
Три ошибки:

1. **Геттер без `receiver`.** `t[key]` вызывает геттер `full` с `this === t`, поэтому чтения `first` и `last` идут мимо прокси, и в логе только `get full`. Для реактивной системы это значит, что зависимости вычисляемого свойства не отслеживаются.
2. **`set` не возвращает `true`.** Ловушка возвращает `undefined`, и в strict mode присваивание бросает `TypeError: 'set' on proxy: trap returned falsish for property 'first'`. Значение при этом уже записано: ошибка вводит в заблуждение.
3. **Запись через наследника.** Если `a = Object.create(user)`, то `a.x = 1` вызывает ловушку с `receiver === a`. Обычное `OrdinarySet` создало бы собственное свойство у `a`, а `t[key] = value` меняет общую цель, и изменение видят все наследники.

```js
function withLog(target, log) {
  return new Proxy(target, {
    get(t, key, receiver) {
      log.push(`get ${String(key)}`);
      return Reflect.get(t, key, receiver);
    },
    set(t, key, value, receiver) {
      log.push(`set ${String(key)}`);
      return Reflect.set(t, key, value, receiver);
    },
  });
}
// user.full → log: ['get full', 'get first', 'get last']
```

- `Reflect.get(t, key, receiver)` выполняет геттер с `this` = прокси, и внутренние чтения снова проходят через ловушку.
- `Reflect.set` возвращает `true` или `false`, как требует контракт ловушки. Для замороженной цели он вернёт `false`, и в strict mode будет честный `TypeError`.
- При записи с `receiver` = прокси `Reflect.set` вызовет у него `[[DefineOwnProperty]]`. Если добавить ловушку `defineProperty`, она тоже сработает на каждое присваивание, и её нужно учитывать, чтобы не залогировать запись дважды.

Сложность: O(1) на операцию.
:::

### 5. Глубокий readonly-прокси · сложно

Реализуйте `readonlyDeep(obj)` — представление объекта только для чтения в духе `readonly` из Vue:

- чтение вложенных объектов возвращает их readonly-представления;
- запись, удаление, `defineProperty`, смена прототипа и `freeze` запрещены: в strict mode — `TypeError`;
- для одного объекта всегда возвращается одно и то же представление, а повторная обёртка не создаётся;
- `toRaw(view)` возвращает исходный объект.

Какие дыры у такого решения остаются?

::: details Решение и разбор
```js
const RAW = Symbol('raw');
const views = new WeakMap();      // raw object -> view
const isView = new WeakSet();     // created views
const refuse = () => false;       // false → TypeError in strict mode, ignored in sloppy

const handler = {
  get(target, key, receiver) {
    if (key === RAW) return target;
    const value = Reflect.get(target, key, receiver);
    const desc = Reflect.getOwnPropertyDescriptor(target, key);
    // invariant: a non-configurable, non-writable data property must be returned as is
    if (desc && !desc.configurable && !desc.writable) return value;
    return readonlyDeep(value);
  },
  set: refuse,
  deleteProperty: refuse,
  defineProperty: refuse,
  setPrototypeOf: refuse,
  preventExtensions: refuse,
};

function readonlyDeep(value) {
  if (value === null || typeof value !== 'object' || isView.has(value)) return value;
  let view = views.get(value);
  if (!view) {
    view = new Proxy(value, handler);
    views.set(value, view);
    isView.add(view);
  }
  return view;
}

const toRaw = (value) => (isView.has(value) ? value[RAW] : value);

const state = { user: { name: 'Ann', tags: ['a'] } };
const ro = readonlyDeep(state);
ro.user === ro.user;              // true: cached view
ro.user.tags.push('b');           // TypeError: 'set' on proxy: trap returned falsish for property '1'
toRaw(ro.user) === state.user;    // true
```

- Обёртка ленивая: вложенный объект оборачивается при чтении, а не при создании. Кэш на `WeakMap` сохраняет идентичность (`ro.user === ro.user`) и не держит объекты в памяти. Без кэша каждое чтение давало бы новый прокси, и сравнения, `Set` и `watch` ломались бы.
- Мутирующие методы массива (`push`, `sort`, `splice`) работают через `[[Set]]` и `[[Delete]]` на `this` = прокси и поэтому блокируются автоматически. Немутирующие (`map`, `filter`) работают и возвращают readonly-представления элементов.
- **Инвариант `get`**: у замороженной цели все свойства неконфигурируемые и незаписываемые, и вернуть обёртку нельзя. Поэтому `readonlyDeep(Object.freeze({ inner: {} })).inner` — сырой изменяемый объект. Vue в этом случае вообще не создаёт прокси, а ловушка без проверки дескриптора упала бы с `TypeError`.
- **Утечки**: `Object.getOwnPropertyDescriptor(ro, 'user').value` отдаёт сырой вложенный объект, потому что ловушки `getOwnPropertyDescriptor` нет. Её добавление упирается в тот же инвариант. Spread-копия `{ ...ro.user }` — обычный изменяемый объект: это копия, а не представление.
- **Коллекции**: `readonlyDeep(new Map()).get('a')` — `TypeError` из-за внутренних слотов. Нужны отдельные обработчики, которые подменяют методы (`get`, `has`, `forEach`) и вызывают их на сырой коллекции, как collection handlers во Vue.
- `refuse` возвращает `false`, а не бросает исключение сам. В sloppy mode запись молча игнорируется, как у замороженного объекта, а `Reflect.set(ro, 'x', 1)` честно возвращает `false`. Vue в dev-режиме вместо этого выводит предупреждение.

Сложность: O(1) на операцию; память — O(число прочитанных вложенных объектов) в кэше.
:::

## Источники

- [ECMAScript: Property Attributes](https://tc39.es/ecma262/#sec-property-attributes), [ValidateAndApplyPropertyDescriptor](https://tc39.es/ecma262/#sec-validateandapplypropertydescriptor), [OrdinaryDefineOwnProperty](https://tc39.es/ecma262/#sec-ordinarydefineownproperty), [OrdinaryOwnPropertyKeys](https://tc39.es/ecma262/#sec-ordinaryownpropertykeys), [OrdinaryGet](https://tc39.es/ecma262/#sec-ordinaryget), [OrdinarySet](https://tc39.es/ecma262/#sec-ordinaryset)
- [ECMAScript: Object.defineProperty](https://tc39.es/ecma262/#sec-object.defineproperty), [Object.getOwnPropertyDescriptors](https://tc39.es/ecma262/#sec-object.getownpropertydescriptors), [Object.preventExtensions](https://tc39.es/ecma262/#sec-object.preventextensions), [Object.seal](https://tc39.es/ecma262/#sec-object.seal), [Object.freeze](https://tc39.es/ecma262/#sec-object.freeze), [SetIntegrityLevel](https://tc39.es/ecma262/#sec-setintegritylevel), [TestIntegrityLevel](https://tc39.es/ecma262/#sec-testintegritylevel)
- [ECMAScript: Object.assign](https://tc39.es/ecma262/#sec-object.assign), [CopyDataProperties](https://tc39.es/ecma262/#sec-copydataproperties), [EnumerateObjectProperties](https://tc39.es/ecma262/#sec-enumerate-object-properties), [ArraySetLength](https://tc39.es/ecma262/#sec-arraysetlength)
- [ECMAScript: Invariants of the Essential Internal Methods](https://tc39.es/ecma262/#sec-invariants-of-the-essential-internal-methods), [Proxy Object Internal Methods](https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots), [Proxy \[\[Get\]\]](https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-get-p-receiver), [Proxy \[\[OwnPropertyKeys\]\]](https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-ownpropertykeys), [Proxy Objects](https://tc39.es/ecma262/#sec-proxy-objects), [Proxy.revocable](https://tc39.es/ecma262/#sec-proxy.revocable)
- [ECMAScript: The Reflect Object](https://tc39.es/ecma262/#sec-reflect-object), [Reflect.get](https://tc39.es/ecma262/#sec-reflect.get), [Reflect.set](https://tc39.es/ecma262/#sec-reflect.set)
- [MDN: Object.defineProperty](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty), [Object.freeze](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze), [Enumerability and ownership of properties](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Enumerability_and_ownership_of_properties)
- [MDN: Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy), [Proxy handler](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy), [Reflect](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Reflect), [Meta programming](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Meta_programming)
- [Vue: Reactivity in Depth](https://vuejs.org/guide/extras/reactivity-in-depth.html), [Reactivity API: Advanced (`toRaw`, `markRaw`)](https://vuejs.org/api/reactivity-advanced.html), [исходники `@vue/reactivity`: baseHandlers.ts](https://github.com/vuejs/core/blob/main/packages/reactivity/src/baseHandlers.ts), [reactive.ts](https://github.com/vuejs/core/blob/main/packages/reactivity/src/reactive.ts)
- [Vue 2: Change Detection Caveats](https://v2.vuejs.org/v2/guide/reactivity.html#Change-Detection-Caveats)
- [V8: Fast properties in V8](https://v8.dev/blog/fast-properties)
