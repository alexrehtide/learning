---
title: Прототипы и классы
level: ядро
---

# Прототипы и классы

> **Коротко.** У каждого объекта есть скрытая ссылка `[[Prototype]]` на другой объект или `null`. Если свойства нет на самом объекте, чтение идёт дальше по этой цепочке. Так в JavaScript устроено наследование: методы лежат один раз на прототипе, а не копируются в каждый объект. `class` строит ту же схему (функция-конструктор + объект `prototype`), но это не просто сахар. Класс добавляет строгий режим, запрет вызова без `new`, `super` через `[[HomeObject]]`, поля с семантикой define, настоящие приватные элементы `#x` и другой порядок создания `this` в наследниках.

**Связанные темы:** [Типы данных и приведение типов](./types-and-coercion.md), [Замыкания](./closures.md), [Функции и `this`](./functions-and-this.md)

## Теория

### `[[Prototype]]` и поиск свойства

У обычного объекта есть внутренний слот `[[Prototype]]`: объект или `null`. Свойство читается операцией `OrdinaryGet`. Если у объекта есть **своё** свойство с таким ключом, берётся оно. Если нет, поиск повторяется на `[[Prototype]]` и так до `null`, а в конце возвращается `undefined`. Своё свойство **затеняет** (shadowing) одноимённое свойство прототипа.

Ключевое место: геттер, найденный на прототипе, вызывается с `this` = исходный объект (receiver), а не прототип. Поэтому метод прототипа работает с данными конкретного экземпляра.

Как задать и прочитать прототип:

| Способ | Что делает |
| --- | --- |
| `Object.create(proto, descriptors?)` | новый объект с заданным прототипом; `Object.create(null)` — объект без прототипа |
| `{ __proto__: proto }` | особый синтаксис литерала, задаёт прототип при создании |
| `Object.getPrototypeOf(o)` / `Object.setPrototypeOf(o, p)` | стандартные чтение и смена прототипа |
| `o.__proto__` | аксессор на `Object.prototype` (Annex B, legacy) |
| `new F()` | прототип — `F.prototype` |

`o.__proto__` — обычный геттер, унаследованный от `Object.prototype`. У объекта из `Object.create(null)` его нет: `o.__proto__` там — просто ключ. Поэтому `Object.create(null)` — честный словарь без унаследованных `toString`, `constructor` и `__proto__`. Цикл в цепочке запрещён (`TypeError`), а прототип самого `Object.prototype` сменить нельзя: это immutable prototype exotic object.

### Запись не идёт по цепочке так же, как чтение

Присваивание `o.x = v` выполняет `OrdinarySet`. Оно тоже ищет `x` по цепочке, но реагирует на найденное по-разному:

- свойства нет нигде или на прототипе data-свойство с `writable: true` — создаётся **своё** свойство на `o`, прототип не меняется;
- на прототипе data-свойство с `writable: false` — присваивание не выполняется: в strict mode `TypeError`, иначе молча. Это «override mistake»: замороженный прототип мешает экземплярам завести своё свойство;
- на прототипе аксессор — вызывается его сеттер с `this === o`, своё свойство не создаётся; без сеттера — отказ, как выше.

`Object.defineProperty` цепочку не смотрит вообще: он всегда создаёт или меняет своё свойство. Отличие «присвоить» от «определить» понадобится дальше, в полях класса. `delete` тоже работает только со своими свойствами.

Проверки тоже различаются: `key in o` и `for...in` видят унаследованные свойства (`for...in` — только перечисляемые), а `Object.hasOwn(o, key)`, `Object.keys` и `Object.entries` — только свои.

### `prototype` и `[[Prototype]]` — разные вещи

`F.prototype` — обычное свойство функции. Его создаёт `MakeConstructor`, и оно нужно только `new`: так задаётся `[[Prototype]]` будущих экземпляров. У самой функции `[[Prototype]]` — `Function.prototype`. В объекте `F.prototype` есть `constructor`, указывающий обратно на `F`.

```text
instance ──[[Prototype]]──► F.prototype ──[[Prototype]]──► Object.prototype ──► null
F        ──[[Prototype]]──► Function.prototype ──[[Prototype]]──► Object.prototype
F.prototype.constructor === F
```

`constructor` — обычное перезаписываемое свойство. Если заменить `F.prototype = { ... }` целиком, `constructor` пропадёт, и `instance.constructor` найдёт `Object` выше по цепочке.

### `instanceof`

`x instanceof C` (`InstanceofOperator`):

1. Если у `C` есть метод `Symbol.hasInstance` — вернуть результат его вызова. Так `instanceof` можно переопределить.
2. Иначе `OrdinaryHasInstance`: у bound function взять целевую функцию; примитив — `false`; дальше идти по цепочке `x` и искать в ней объект `C.prototype`.

Проверяется не «кто создал объект», а «есть ли `C.prototype` в цепочке **сейчас**». Отсюда ловушки: после `C.prototype = {}` старые экземпляры перестают быть `instanceof C`. Объект из другого realm (iframe, `vm`) не проходит проверку, потому что там свой `Array.prototype`. А `Object.create(C.prototype)` проходит, хотя конструктор не вызывался. `C.prototype.isPrototypeOf(x)` делает то же самое без `Symbol.hasInstance`.

### Класс — больше, чем сахар

`class A { m() {} }` создаёт функцию `A` и объект `A.prototype` с методом `m`, как функция-конструктор. Но поведение отличается:

| | `function F() {}` + `F.prototype.m = …` | `class A { m() {} }` |
| --- | --- | --- |
| Вызов без `new` | работает, `this` по правилам вызова | `TypeError` (`[[IsClassConstructor]]`) |
| Режим | как у окружающего кода | всегда strict |
| Методы | перечисляемые, конструкторы (`new obj.m()` работает) | неперечисляемые, без `[[Construct]]` и `prototype` |
| Hoisting | объявление поднимается целиком | TDZ, как у `let` |
| `super` | нет | есть: методы получают `[[HomeObject]]` |
| Поля, `#private`, `static {}` | нет | есть |
| Наследование | вручную, через `Object.create` | `extends`; `this` создаёт базовый конструктор |

Внутри класса его имя — неизменяемая привязка (`CreateImmutableBinding`): `A = null` внутри методов — `TypeError`, даже если снаружи `A` переприсвоили.

### `extends`: две цепочки и `this` от базового класса

`class B extends A` связывает две цепочки (`ClassDefinitionEvaluation`):

- `B.prototype.[[Prototype]] = A.prototype` — наследование методов экземпляра;
- `B.[[Prototype]] = A` — наследование статических методов и свойств.

После `extends` может стоять любое выражение, которое вычисляется в конструктор или `null`. На этом построены миксины: `class C extends withLogging(Base)`.

Главное отличие от ES5-наследования — кто создаёт объект. У производного класса `[[ConstructorKind]]: derived`, и `new B()` не создаёт `this`. Объект создаёт вызов `super(...args)`: он выполняет `Construct(A, args, newTarget)`, где `newTarget` — это `B`. Поэтому объект создаёт `A`, но с прототипом `B.prototype`. Только после этого `this` привязывается (`BindThisValue`) и инициализируются поля `B`. Следствия:

- `this` до `super()` — `ReferenceError`; конструктор наследника обязан вызвать `super()` или вернуть объект;
- конструктор по умолчанию у наследника — `constructor(...args) { super(...args); }`;
- встроенные классы наследуются правильно: `class MyArray extends Array` получает настоящий exotic-массив с живым `length`, потому что объект создаёт `Array`. ES5-приём `Array.call(this)` так не умеет;
- `class X extends null` даёт `X.prototype.[[Prototype]] = null`, но `super()` вызвать нельзя, потому что `Function.prototype` — не конструктор. Конструктор должен сам вернуть объект.

### `super` и `[[HomeObject]]`

`super.m()` ищет `m` не в прототипе `this`, а в прототипе **объекта, где метод определён**. Это `GetSuperBase`: `[[HomeObject]].[[GetPrototypeOf]]()`. `this` при этом остаётся текущим (`[[ThisValue]]` в Super Reference). `[[HomeObject]]` задаётся при создании метода (`MakeMethod`) и потом не меняется. Поэтому:

- метод, скопированный в другой объект, продолжает звать `super` своего исходного родителя;
- `super` работает и в методах литерала объекта (`{ m() { return super.m(); } }`), если у литерала есть прототип;
- в стрелке `super` берётся из внешнего метода, как и `this`;
- обычная функция, присвоенная свойством (`m: function () {}`), `[[HomeObject]]` не получает, и `super` в ней — синтаксическая ошибка.

### Поля класса: define, а не присваивание

`x = 1` в теле класса — **определение** собственного свойства: `DefineField` → `CreateDataPropertyOrThrow`, а не `this.x = 1`. Поле затеняет аксессор с тем же именем на прототипе, и сеттер родителя **не вызывается**. Порядок инициализации (`InitializeInstanceElements`):

- в базовом классе — сразу при входе в конструктор, до его тела;
- в производном — сразу после возврата из `super()`.

Отсюда классическая ловушка: конструктор родителя вызывает переопределённый метод, а тот читает поле наследника. Поле ещё не инициализировано, и метод видит `undefined` (см. задачу 3).

> [!WARNING]
> В TypeScript поведение полей зависит от `useDefineForClassFields`. Флаг по умолчанию `true` при `target` ES2022 и новее: поля становятся define-полями по стандарту. При `false` TypeScript компилирует их в `this.x = …` в конструкторе. После смены `target` поле без инициализатора (`name!: string`) начинает перезаписывать значение, которое поставил родитель, на `undefined`, а поле с инициализатором перестаёт вызывать сеттер родителя. Чтобы объявить только тип, пишите `declare name: string`.

Поле-стрелка (`handle = () => {}`) создаётся на каждый экземпляр, а не лежит на прототипе. Это разобрано в теме [«Функции и `this`»](./functions-and-this.md).

### Приватные элементы `#x`

`#x` — не свойство с особым именем. Это запись в отдельном слоте объекта `[[PrivateElements]]`, а ключ — **Private Name**, новое уникальное значение при каждом вычислении класса. Доступ к нему лексический: написать `obj.#x` можно только в теле класса, который объявил `#x`.

- `#x` нет в `Object.keys`, `Reflect.ownKeys` и `JSON.stringify`, его не достать через `Proxy` и не перебрать. Обращение к объекту без такого элемента — `TypeError`. Проверить, есть ли элемент, можно через brand check `#x in obj`.
- Приватные поля добавляются к объекту, когда отработал конструктор класса. Экземпляр наследника тоже их получает, но код наследника назвать `#x` не может.
- `PrivateFieldAdd` бросает `TypeError`, если элемент уже есть. Поэтому одному объекту нельзя дважды добавить одни и те же приватные поля.
- `static #count` есть только у самого класса. Унаследованный статический метод, вызванный как `Child.inc()`, получает `this === Child`, и `this.#count` даёт `TypeError`. В статических методах обращайтесь по имени класса: `Parent.#count`.
- Приватные методы общие для всех экземпляров и неперезаписываемые.

> [!NOTE]
> `private` в TypeScript — проверка компилятора: в рантайме это обычное свойство, видное в `Object.keys` и доступное через `obj['x']`. `_x` — только соглашение. Настоящую приватность дают `#x` и [замыкание](./closures.md).

### `static` и статические блоки

Статические методы и поля — свойства самого конструктора. В них `this` — класс, на котором вызвали метод: при `Child.create()` это `Child`, поэтому `static create() { return new this(); }` создаёт экземпляр наследника. Блок `static { … }` выполняется один раз при определении класса. В нём доступны приватные имена класса: так инициализируют сложную статику или «выдают» доступ к `#x` коду вне класса.

### Встроенные классы и `Symbol.species`

`class List extends Array` — `list.map(fn)` возвращает `List`, а не `Array`. `ArraySpeciesCreate` берёт конструктор результата из `list.constructor[Symbol.species]`, который по умолчанию возвращает `this`. Чтобы методы возвращали обычный массив, переопределите `static get [Symbol.species]() { return Array; }`. У наследников `Error` задайте `name`, иначе стек и `toString` покажут `Error`. Передавайте `cause` в `super(message, { cause })`.

> [!WARNING]
> Смена прототипа у существующего объекта (`Object.setPrototypeOf`, присваивание `__proto__`) медленная во всех движках: в V8 она сбрасывает оптимизации доступа к свойствам (hidden classes, inline caches) для этого объекта и кода, который его видел. Задавайте прототип при создании: `Object.create`, `{ __proto__ }`, `class`.

### Vue: классы и реактивность

`reactive()` и `ref()` оборачивают экземпляр класса в `Proxy`, как обычный объект. Методы прототипа работают: при вызове `state.inc()` `this` — прокси, и чтения и записи отслеживаются. Но приватные поля ломаются. Внутри метода `this.#x` применяется к прокси, у которого нет `#x`, и выбрасывается `TypeError: Cannot read private member #x from an object whose class did not declare it`. Решения:

- держать состояние в обычных объектах; состояние Pinia к тому же сериализуется при SSR, и экземпляры классов это ломают;
- для экземпляров сторонних классов (карта, SDK-клиент) — `markRaw(instance)` или `shallowRef`, чтобы Vue не создавал прокси;
- в своём классе вместо `#x` использовать замыкание или `WeakMap`, если объект должен быть реактивным.

## Примеры

### ES5-наследование и его эквивалент на `class`

```js
function Animal(name) { this.name = name; }
Animal.prototype.speak = function () { return `${this.name} makes a sound`; };
Animal.create = function (name) { return new this(name); };

function Dog(name) { Animal.call(this, name); }                 // fields of the parent
Dog.prototype = Object.create(Animal.prototype, {
  constructor: { value: Dog, writable: true, configurable: true }, // non-enumerable
});
Object.setPrototypeOf(Dog, Animal);                              // static inheritance
Dog.prototype.speak = function () {
  return Animal.prototype.speak.call(this) + ' (woof)';         // manual "super"
};

class Cat extends Animal {
  speak() { return `${super.speak()} (meow)`; }
}

Dog.create('Rex').speak();   // 'Rex makes a sound (woof)'
Cat.create('Tom').speak();   // 'Tom makes a sound (meow)'
```

`class` за одну строку делает обе связки цепочек, ставит неперечисляемый `constructor` и даёт `super` вместо явного `Animal.prototype.speak.call(this)`.

### Затенение и замороженный прототип

```js
'use strict';
const proto = { greeting: 'hi', get upper() { return this.greeting.toUpperCase(); } };
const obj = Object.create(proto);

obj.greeting = 'hello';      // own property, proto.greeting is untouched
obj.upper;                   // 'HELLO': the getter runs with this === obj

Object.freeze(proto);
const other = Object.create(proto);
other.greeting = 'yo';       // TypeError: Cannot assign to read only property
Object.defineProperty(other, 'greeting', { value: 'yo' }); // works: define ignores the chain
```

## Вопросы с интервью

::: details Что такое прототип и как происходит поиск свойства?
У каждого объекта есть внутренний слот `[[Prototype]]` — ссылка на другой объект или `null`. Чтение свойства сначала проверяет собственные свойства, затем идёт по цепочке прототипов до `null`. Найденный на прототипе метод или геттер выполняется с `this` = исходный объект, поэтому один метод на прототипе обслуживает все экземпляры. Запись работает иначе: присваивание создаёт собственное свойство и затеняет прототипное. Исключения — сеттер на прототипе (вызывается он) и неперезаписываемое свойство на прототипе (присваивание не выполняется). `Object.defineProperty` всегда работает с собственным свойством.
:::

::: details Чем свойство prototype отличается от __proto__ и Object.getPrototypeOf?
`F.prototype` — обычное свойство функции-конструктора. Это объект, который станет `[[Prototype]]` экземпляров, созданных через `new F()`. `[[Prototype]]` — внутренний слот любого объекта. Его читают через `Object.getPrototypeOf(o)`, а `o.__proto__` — legacy-аксессор на `Object.prototype`, которого нет у объектов из `Object.create(null)`. Для функции `F` это разные вещи: `Object.getPrototypeOf(F) === Function.prototype`, а `F.prototype` — прототип её экземпляров. В литерале объекта `{ __proto__: p }` — отдельный синтаксис, он работает всегда.
:::

::: details Как работает instanceof и когда он даёт неожиданный результат?
Сначала проверяется `C[Symbol.hasInstance]`. Если он есть, результат — его вызов. Иначе движок идёт по цепочке прототипов объекта и ищет `C.prototype`. Сбои: объект из другого realm (iframe, `vm`) — у него свой `Array.prototype`, поэтому для массивов нужен `Array.isArray`; после замены `C.prototype` старые экземпляры дают `false`; `Object.create(C.prototype)` даёт `true` без вызова конструктора; примитивы всегда `false`. Для «есть ли у объекта приватное поле моего класса» надёжнее brand check `#x in obj`.
:::

::: details Классы в JavaScript — это просто синтаксический сахар над прототипами?
Модель та же: функция-конструктор и объект `prototype` с методами, наследование через цепочку. Но класс нельзя полностью выразить через ES5. Его нельзя вызвать без `new`. Тело всегда в strict mode. Методы неперечисляемые и не являются конструкторами. Имя класса в TDZ. Методы получают `[[HomeObject]]`, на котором работает `super`. Поля определяются через define, а не через присваивание. `#private` хранятся в отдельном слоте, недоступном рефлексии. Главное: в наследнике `this` создаёт базовый конструктор через `super()`, поэтому `extends Array`/`Error`/`HTMLElement` даёт настоящие встроенные объекты, чего ES5-наследование не умело.
:::

::: details Почему в конструкторе наследника нельзя обратиться к this до вызова super?
Конструктор производного класса не создаёт объект. `this` в его окружении не инициализирован, пока `super()` не вызовет `Construct(Parent, args, newTarget)`. Объект создаёт родитель (в конечном счёте базовый класс), но с прототипом `newTarget.prototype`, то есть прототипом наследника. Только после возврата из `super()` `this` привязывается и инициализируются поля наследника. Обращение к `this` раньше — `ReferenceError`. Так можно корректно наследовать встроенные объекты: `Array` сам создаёт exotic-массив.
:::

::: details Как работает super в методах и почему скопированный метод ведёт себя странно?
`super.m()` ищет `m` в прототипе объекта, на котором метод **определён** (`[[HomeObject]]`), а не в прототипе `this`. `this` при этом остаётся текущим. `[[HomeObject]]` фиксируется при создании метода, поэтому скопированный в другой объект метод продолжает обращаться к старому родителю. Это работает и в методах литерала объекта. Функция, присвоенная свойством (`m: function () {}`), `[[HomeObject]]` не имеет, и `super` в ней запрещён.
:::

::: details Почему поле наследника не видно, если конструктор родителя вызывает переопределённый метод?
Поля производного класса инициализируются сразу после возврата из `super()`, то есть после того, как отработал весь конструктор родителя. Если родитель в конструкторе вызывает `this.render()`, а наследник переопределил `render` и читает в нём своё поле, поле ещё не существует, и метод видит `undefined`. Решения: не вызывать переопределяемые методы из конструктора, передавать данные через аргументы `super(...)` или делать двухфазную инициализацию (`init()` после создания).
:::

::: details Чем #private отличаются от private в TypeScript и почему они ломаются в reactive во Vue?
`private` в TypeScript существует только при компиляции: в рантайме это обычное свойство. `#x` хранится в `[[PrivateElements]]` объекта и адресуется уникальным Private Name. Его не видно в `Object.keys`, `Reflect.ownKeys` и `JSON.stringify`, к нему не обратиться через `obj['#x']`. Обращение к объекту без такого элемента — `TypeError`. `Proxy` не пересылает приватные элементы. `reactive(instance)` возвращает прокси, метод вызывается с `this` = прокси, и `this.#x` падает. Поэтому реактивное состояние держат в обычных объектах, а сторонние экземпляры классов помечают `markRaw` или кладут в `shallowRef`.
:::

## Задачи

### 1. Предскажите вывод · легко

```js
'use strict';
function User(name) { this.name = name; }
User.prototype.role = 'guest';
User.prototype.tags = [];

const a = new User('Ann');
const b = new User('Bob');

a.role = 'admin';
a.tags.push('x');
delete a.role;
User.prototype = { role: 'root' };

console.log(a.role, b.tags, a instanceof User, a.constructor === User);
console.log(new User('Cid').role, new User('Cid').constructor === User);
```

::: details Решение и разбор
```text
guest [ 'x' ] false true
root false
```

- `a.role = 'admin'` создаёт собственное свойство, `delete` его удаляет, и снова виден прототипный `'guest'`.
- `a.tags.push('x')` не присваивает `tags`, а мутирует массив на прототипе, общий для всех экземпляров. Поэтому изменяемые значения не кладут на прототип: их создают в конструкторе.
- После замены `User.prototype` старые объекты указывают на старый прототип, а `instanceof` проверяет новый: `false`. `a.constructor` берётся из старого прототипа: `true`.
- У нового прототипа нет `constructor`, поэтому `new User('Cid').constructor` находится в `Object.prototype`, и это `Object`.
:::

### 2. Реализуйте `instanceof` · легко

Напишите `isInstance(value, Ctor)`, повторяющий `value instanceof Ctor`, включая `Symbol.hasInstance` и ошибки для неподходящего правого операнда.

::: details Решение и разбор
```js
function isInstance(value, Ctor) {
  if (Ctor === null || (typeof Ctor !== 'object' && typeof Ctor !== 'function')) {
    throw new TypeError('Right-hand side of instanceof is not an object');
  }
  const handler = Ctor[Symbol.hasInstance];
  if (handler != null) return Boolean(handler.call(Ctor, value));
  if (typeof Ctor !== 'function') {
    throw new TypeError('Right-hand side of instanceof is not callable');
  }
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }
  const proto = Ctor.prototype;
  if (proto === null || (typeof proto !== 'object' && typeof proto !== 'function')) {
    throw new TypeError('Function has non-object prototype in instanceof check');
  }
  for (let p = Object.getPrototypeOf(value); p !== null; p = Object.getPrototypeOf(p)) {
    if (p === proto) return true;
  }
  return false;
}
```

- У любой функции есть унаследованный `Function.prototype[Symbol.hasInstance]`, который вызывает `OrdinaryHasInstance`. Поэтому для функций срабатывает ветка `handler`, а цикл ниже — модель самого `OrdinaryHasInstance`: на интервью обычно просят именно его. Bound function цикл не поддерживает (у неё нет `prototype`), но до цикла она не доходит: встроенный обработчик сам переходит к целевой функции.
- `Function.prototype[Symbol.hasInstance]` неперезаписываемый, поэтому `F[Symbol.hasInstance] = fn` не сработает: в strict mode `TypeError`, иначе молча (override mistake). Переопределять нужно через `static [Symbol.hasInstance]()` или `Object.defineProperty`.
- Ловушка интервью — проверка `value.__proto__`: у `Object.create(null)` нет `__proto__`, а у `Proxy` прототип отдаёт ловушка `getPrototypeOf`. `Object.getPrototypeOf` корректен в обоих случаях.

Сложность: O(d) по времени, где d — длина цепочки прототипов; O(1) по памяти.
:::

### 3. Порядок инициализации · средне

```js
class Base {
  greeting = 'base';
  constructor() {
    console.log('Base ctor:', this.greeting, this.describe());
  }
  describe() { return 'base'; }
  set label(v) { console.log('Base setter:', v); }
}

class Child extends Base {
  greeting = 'child';
  label = 'from field';
  #secret = 42;
  describe() { return `child ${this.#secret ?? '?'}`; }
}

const c = new Child();
console.log(c.greeting, Object.keys(c));
```

::: details Решение и разбор
```text
TypeError: Cannot read private member #secret from an object whose class did not declare it
```

Порядок: `new Child()` → конструктор по умолчанию → `super()` → в `Base` сначала поля (`greeting = 'base'`), потом тело. Тело вызывает `this.describe()`, а это метод `Child`, потому что прототип объекта уже `Child.prototype`. В нём `this.#secret`, но приватные поля `Child` добавятся только после возврата из `super()`. `??` не помогает: ошибка случается при чтении, а не из-за значения.

Если заменить `this.#secret` на обычное поле `this.secret ?? '?'`, вывод будет таким:

```text
Base ctor: base child ?
child [ 'greeting', 'label', 'secret' ]
```

- В конструкторе `Base` поля `Child` ещё не определены: `greeting` — `'base'`, `secret` — `undefined`.
- `label = 'from field'` — define, а не присваивание: сеттер `Base` не вызывается, на экземпляре появляется собственное data-свойство `label`.
- Вывод: не вызывайте из конструктора методы, которые наследники могут переопределить.
:::

### 4. Наследование без `class` · средне

Напишите `inherit(Child, Parent)`, который связывает две функции-конструктора так же, как `class Child extends Parent`: методы и статика наследуются, `instanceof` работает, `constructor` указывает на `Child` и не виден в `for...in`. Покажите, как вызвать конструктор и метод родителя.

::: details Решение и разбор
```js
function inherit(Child, Parent) {
  Child.prototype = Object.create(Parent.prototype, {
    constructor: { value: Child, writable: true, configurable: true },
  });
  Object.setPrototypeOf(Child, Parent);  // static methods: Child.create()
  return Child;
}

function Shape(name) { this.name = name; }
Shape.prototype.toString = function () { return `Shape(${this.name})`; };
Shape.of = function (...args) { return new this(...args); };

function Circle(r) {
  Shape.call(this, 'circle');              // "super(...)" for an ES5 constructor
  this.r = r;
}
inherit(Circle, Shape);
Circle.prototype.toString = function () {
  return `${Shape.prototype.toString.call(this)} r=${this.r}`; // "super.toString()"
};

const c = Circle.of(2);
String(c);                                 // 'Shape(circle) r=2'
c instanceof Shape;                        // true
```

- `Object.create(Parent.prototype)`, а не `new Parent()`: иначе конструктор родителя выполнится с побочными эффектами и без аргументов, а его поля окажутся на прототипе, общие для всех.
- `Object.setPrototypeOf(Child, Parent)` вызывается один раз при объявлении, а не на горячем пути, поэтому замедление от смены прототипа здесь не важно.
- Методы `Circle.prototype` нужно добавлять **после** `inherit`: замена `Child.prototype` сотрёт то, что было добавлено раньше.
- Методы, добавленные присваиванием, перечисляемые: `for (const k in c)` выдаст `name`, `r` и `toString`. Чтобы повторить класс, определяйте их через `Object.defineProperty` с `enumerable: false`.
- Чего так не повторить: наследование встроенных объектов (`Array.call(this)` не создаст exotic-массив), `super` через `[[HomeObject]]`, запрет вызова без `new`. Для запрета пригодится проверка `if (!new.target) throw new TypeError(...)`.

Сложность: O(1).
:::

### 5. Миксины через `extends`-выражение · сложно

Реализуйте миксины `Serializable` и `Observable` как функции «класс → класс», чтобы их можно было комбинировать: `class Store extends Observable(Serializable(Base))`. `Serializable` добавляет `toJSON()`, который собирает собственные поля и даёт следующим слоям дополнить результат. `Observable` добавляет `on(event, fn)`, `emit(event, payload)` и вызывает `emit('serialize')` в `toJSON`. Каждый слой должен вызывать реализацию нижнего через `super`, а `instanceof Serializable` должен работать.

::: details Решение и разбор
```js
const brand = Symbol('mixins');

function defineMixin(apply) {
  const mixin = (Base) => {
    const Mixed = apply(Base);
    Mixed[brand] = new Set([...(Base[brand] ?? []), mixin]);
    return Mixed;
  };
  Object.defineProperty(mixin, Symbol.hasInstance, {
    value: (obj) => obj != null && Boolean(obj.constructor?.[brand]?.has(mixin)),
  });
  return mixin;
}

const Serializable = defineMixin((Base) => class extends Base {
  toJSON() {
    const base = super.toJSON?.() ?? {};
    return { ...base, ...Object.fromEntries(Object.entries(this)) };
  }
});

const Observable = defineMixin((Base) => class extends Base {
  #handlers = new Map();
  on(event, fn) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(fn);
    return () => this.#handlers.get(event).delete(fn);
  }
  emit(event, payload) {
    for (const fn of this.#handlers.get(event) ?? []) fn(payload);
  }
  toJSON() {
    const json = super.toJSON?.() ?? {};
    this.emit('serialize', json);
    return json;
  }
});

class Base { createdAt = 0; }
class Store extends Observable(Serializable(Base)) { items = ['a']; }

const s = new Store();
s.on('serialize', (json) => console.log('saving', Object.keys(json)));
JSON.stringify(s);              // logs: saving [ 'createdAt', 'items' ]
s instanceof Serializable;      // true
s instanceof Observable;        // true
```

- Каждый вызов миксина создаёт **новый** анонимный класс. Цепочка получается `Store → Observable(…) → Serializable(…) → Base`, и `super` в каждом слое указывает на слой ниже благодаря `[[HomeObject]]`.
- `super.toJSON?.()` — optional call: слой не знает, есть ли `toJSON` у нижнего уровня, поэтому миксины комбинируются без ошибок. Но порядок важен: слои выполняются снизу вверх. В `Serializable(Observable(Base))` событие `serialize` сработает раньше, чем `Serializable` добавит поля, и подписчик получит `{}`.
- `instanceof Serializable` сам по себе не работает: `Serializable` — стрелка без `prototype`, а каждый вызов даёт новый класс. Поэтому каждый результат помечается множеством применённых миксинов, а `Symbol.hasInstance` проверяет метку. Обработчик нужно определять через `defineProperty`: присваивание `mixin[Symbol.hasInstance] = …` не сработает из-за неперезаписываемого свойства на `Function.prototype` (override mistake).
- `#handlers` у каждого вызова `Observable` свой Private Name. Два применения одного миксина в одной цепочке не конфликтуют, а чужой код этот `Map` не увидит. Обратная сторона — `reactive(s)` во Vue на таком объекте сломается (см. теорию).
- `Object.entries(this)` видит только собственные перечисляемые свойства, поэтому `#handlers` и методы в JSON не попадают.

Сложность: O(k) на создание класса и на `instanceof`, где k — число миксинов; `toJSON` — O(f), где f — число полей.
:::

## Источники

- [ECMAScript: Ordinary Object Internal Methods and Internal Slots](https://tc39.es/ecma262/#sec-ordinary-object-internal-methods-and-internal-slots), [OrdinaryGet](https://tc39.es/ecma262/#sec-ordinaryget), [OrdinarySet](https://tc39.es/ecma262/#sec-ordinaryset), [OrdinarySetWithOwnDescriptor](https://tc39.es/ecma262/#sec-ordinarysetwithowndescriptor), [OrdinarySetPrototypeOf](https://tc39.es/ecma262/#sec-ordinarysetprototypeof)
- [ECMAScript: Object.create](https://tc39.es/ecma262/#sec-object.create), [Object.getPrototypeOf](https://tc39.es/ecma262/#sec-object.getprototypeof), [Object.setPrototypeOf](https://tc39.es/ecma262/#sec-object.setprototypeof), [Object.prototype.\_\_proto\_\_](https://tc39.es/ecma262/#sec-object.prototype.__proto__), [\_\_proto\_\_ in Object Initializers](https://tc39.es/ecma262/#sec-__proto__-property-names-in-object-initializers), [Immutable Prototype Exotic Objects](https://tc39.es/ecma262/#sec-immutable-prototype-exotic-objects)
- [ECMAScript: InstanceofOperator](https://tc39.es/ecma262/#sec-instanceofoperator), [OrdinaryHasInstance](https://tc39.es/ecma262/#sec-ordinaryhasinstance), [Function.prototype\[%Symbol.hasInstance%\]](https://tc39.es/ecma262/#sec-function.prototype-%symbol.hasinstance%), [Object.prototype.isPrototypeOf](https://tc39.es/ecma262/#sec-object.prototype.isprototypeof)
- [ECMAScript: Class Definitions](https://tc39.es/ecma262/#sec-class-definitions), [ClassDefinitionEvaluation](https://tc39.es/ecma262/#sec-runtime-semantics-classdefinitionevaluation), [MakeMethod](https://tc39.es/ecma262/#sec-makemethod), [[[Construct]]](https://tc39.es/ecma262/#sec-ecmascript-function-objects-construct-argumentslist-newtarget), [OrdinaryCreateFromConstructor](https://tc39.es/ecma262/#sec-ordinarycreatefromconstructor)
- [ECMAScript: The super Keyword](https://tc39.es/ecma262/#sec-super-keyword), [super — Runtime Semantics](https://tc39.es/ecma262/#sec-super-keyword-runtime-semantics-evaluation), [MakeSuperPropertyReference](https://tc39.es/ecma262/#sec-makesuperpropertyreference), [GetSuperBase](https://tc39.es/ecma262/#sec-getsuperbase)
- [ECMAScript: DefineField](https://tc39.es/ecma262/#sec-definefield), [InitializeInstanceElements](https://tc39.es/ecma262/#sec-initializeinstanceelements), [Private Names](https://tc39.es/ecma262/#sec-private-names), [PrivateElementFind](https://tc39.es/ecma262/#sec-privateelementfind), [PrivateFieldAdd](https://tc39.es/ecma262/#sec-privatefieldadd), [PrivateGet](https://tc39.es/ecma262/#sec-privateget)
- [ECMAScript: ArraySpeciesCreate](https://tc39.es/ecma262/#sec-arrayspeciescreate), [get Array\[%Symbol.species%\]](https://tc39.es/ecma262/#sec-get-array-%symbol.species%), [Symbol.hasInstance](https://tc39.es/ecma262/#sec-symbol.hasinstance)
- [MDN: Inheritance and the prototype chain](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Inheritance_and_the_prototype_chain)
- [MDN: Classes](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes), [extends](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/extends), [super](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/super), [Public class fields](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Public_class_fields), [Private elements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_elements), [Static initialization blocks](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Static_initialization_blocks)
- [MDN: Object.setPrototypeOf](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/setPrototypeOf), [Object.prototype.\_\_proto\_\_](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/proto), [instanceof](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/instanceof), [Symbol.species](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/species)
- [TypeScript: useDefineForClassFields](https://www.typescriptlang.org/tsconfig/#useDefineForClassFields)
- [Vue: markRaw](https://vuejs.org/api/reactivity-advanced.html#markraw), [Reactivity Fundamentals](https://vuejs.org/guide/essentials/reactivity-fundamentals.html)
