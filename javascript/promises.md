---
title: Промисы
level: ядро
---

# Промисы

> **Коротко.** Промис — объект-заместитель результата асинхронной операции. Его состояние меняется один раз: из `pending` в `fulfilled` (выполнен) или `rejected` (отклонён). `then` не меняет исходный промис, а возвращает **новый**: его разрешает результат обработчика (вернул значение → выполнен, бросил исключение → отклонён, вернул промис → «следует» за ним). Обработчики всегда вызываются асинхронно, микрозадачей. На этом построены цепочки, проброс ошибок, `async/await` и комбинаторы `Promise.all` и компании.

**Связанные темы:** [Event loop](./event-loop.md), [Функции и `this`](./functions-and-this.md), [Замыкания](./closures.md)

## Теория

### Состояние и судьба

У промиса два независимых свойства:

| | Значения | Что значит |
| --- | --- | --- |
| **Состояние** (state) | `pending` → `fulfilled` или `rejected` | Есть ли уже результат. `fulfilled` и `rejected` вместе называют **settled** (завершён) |
| **Судьба** (fate) | unresolved → resolved | Можно ли ещё повлиять на исход. Resolved — промис завершён **или** «заперт» на другом промисе (thenable) |

Отсюда главная тонкость терминологии: **resolved ≠ fulfilled**. `resolve(otherPromise)` не выполняет промис, а привязывает его судьбу к `otherPromise`. Промис остаётся `pending`, пока `otherPromise` не завершится, и повторные вызовы `resolve`/`reject` уже ничего не меняют. Поэтому функция называется `resolve`, а не `fulfill`.

### Executor и функции разрешения

```js
const promise = new Promise((resolve, reject) => {
  // executor runs synchronously, right inside the constructor
});
```

- Executor вызывается **синхронно**. Асинхронность появляется только в обработчиках.
- Срабатывает **первый** вызов `resolve` или `reject`, остальные игнорируются. Исключение в executor превращается в `reject`, но только если промис ещё не разрешён: `resolve(1); throw err` даст выполненный промис.
- `resolve(x)` по спецификации ([Promise Resolve Functions](https://tc39.es/ecma262/#sec-promise-resolve-functions)):
  1. `x === promise` — отказ с `TypeError` (цикл).
  2. `x` не объект — выполнить промис значением `x`.
  3. Прочитать `x.then`. Геттер бросил исключение — отказ с этой ошибкой.
  4. `then` не функция — выполнить промис объектом `x`.
  5. Иначе `x` — **thenable**. Поставить задание `NewPromiseResolveThenableJob`, которое вызовет `x.then(resolve, reject)`. Оно идёт отдельной микрозадачей, и отсюда лишние тики из темы [Event loop](./event-loop.md).
- `reject(x)` ничего не разворачивает: `reject(somePromise)` сделает причиной отказа сам объект промиса.

### `then` создаёт новый промис

`p.then(onFulfilled, onRejected)` регистрирует **реакцию** и возвращает новый промис `p2`. Когда `p` завершится, ставится задание (микрозадача):

| Что сделал обработчик | Что стало с `p2` |
| --- | --- |
| Вернул значение `v` | `resolve(v)`: выполнен значением `v`, а если `v` — thenable, следует за ним |
| Бросил исключение `e` | Отклонён с причиной `e` |
| Обработчика нет (аргумент не функция) | Пропускает результат `p` дальше: значение — как значение, отказ — как отказ |

Следствия:

- **Обработчик всегда асинхронный**, даже на уже выполненном промисе. Код после `then` выполнится раньше обработчика. Это сделано намеренно: API никогда не бывает «то синхронным, то асинхронным» (проблема «Zalgo»).
- **Забытый `return`** в обработчике рвёт цепочку: следующий `then` получит `undefined` и не станет ждать внутреннюю операцию.
- `p.then(a); p.then(b)` — это **ветвление**, а не цепочка. Оба обработчика получат результат `p`, порядок вызова — порядок регистрации.

### Ошибки в цепочке

Отказ «пролетает» по цепочке: каждый `then` без `onRejected` передаёт его дальше, пока не встретится обработчик ошибки. `catch(f)` — это ровно `then(undefined, f)`. Если `catch` вернул значение, цепочка **восстановилась**: дальше идёт выполненный промис.

- `then(onOk, onErr)` не ловит ошибку, брошенную в `onOk`: оба обработчика висят на одном промисе. `then(onOk).catch(onErr)` ловит и её.
- `finally(f)`: `f` не получает аргументов, и результат по умолчанию проходит **насквозь** — `Promise.resolve(1).finally(() => 2)` даёт `1`. Переопределить результат `finally` может только отказом: бросить исключение или вернуть отклонённый промис. Если `f` вернул промис, цепочка ждёт его.
- `try/catch` вокруг вызова, который возвращает промис, асинхронный отказ не ловит: к моменту отказа `try` уже завершился. Ловить нужно через `catch` или `await` внутри `try`.

> [!WARNING]
> `new Promise(async (resolve, reject) => { ... })` — антипаттерн. Исключение внутри async-executor отклоняет **промис, который вернула executor-функция**, а не создаваемый: внешний промис навсегда останется `pending`, а отказ уйдёт в необработанные.

### Необработанные отказы

У каждого промиса есть внутренний флаг `[[PromiseIsHandled]]`: подключён ли хоть один обработчик. При отказе без обработчика и при позднем подключении обработчика язык вызывает хостовый хук `HostPromiseRejectionTracker`. Что делать дальше, решает хост.

- **Браузер** (HTML Living Standard). Отклонённый промис без обработчика попадает в список «о котором надо уведомить». После microtask checkpoint браузер ставит **задачу**. Если к её запуску обработчика всё ещё нет, на `window` срабатывает `unhandledrejection`. `event.preventDefault()` подавляет вывод в консоль. Если обработчик подключат позже, сработает `rejectionhandled`. Значит, подключить `catch` в той же задаче или в микрозадаче после отказа ещё не поздно.
- **Node.js.** С Node 15 по умолчанию действует `--unhandled-rejections=throw`: необработанный отказ становится неперехваченным исключением, и процесс **падает**. Перед этим срабатывает `process.on('unhandledRejection')`. Позднее подключение обработчика вызывает `rejectionHandled`.

Комбинаторы подписываются на все входные промисы. Поэтому второй отказ внутри `Promise.all` не считается необработанным, хотя результат `all` его уже не учитывает.

### Статические методы

`Promise.resolve(x)` возвращает `x` как есть, если это промис того же конструктора: `Promise.resolve(p) === p`. Остальное заворачивает в новый промис (thenable разворачивает). `Promise.reject(r)` всегда создаёт новый отклонённый промис.

| Метод | Выполняется | Отклоняется | Пустой вход |
| --- | --- | --- | --- |
| `Promise.all` | массивом значений в **исходном порядке**, когда выполнены все | с причиной **первого** отказа | выполнен `[]` |
| `Promise.allSettled` | массивом `{ status, value }` / `{ status, reason }`, когда завершились все | никогда | выполнен `[]` |
| `Promise.race` | если **первым** завершился выполненный | если **первым** завершился отклонённый | вечно `pending` |
| `Promise.any` | значением **первого** выполненного | `AggregateError` с массивом `errors`, когда отклонены все | отклонён `AggregateError` |

- Элементы входа проходят через `Promise.resolve`, поэтому в массиве могут быть обычные значения и thenable.
- **Комбинаторы ничего не отменяют.** После отказа `Promise.all` остальные запросы продолжают выполняться, их результаты просто выбрасываются. Отмена — через `AbortSignal`.
- Реализация комбинаторов с нуля, пул с лимитом конкурентности и `retry` — классические задачи live coding.

Новые методы (сверено по MDN 2026-11-11):

- `Promise.withResolvers()` (ES2024, Baseline с 2024) возвращает `{ promise, resolve, reject }`. Это замена ручному «deferred»: `let resolve; new Promise((r) => (resolve = r))`.
- `Promise.try(fn, ...args)` (ES2025, Baseline с января 2025) вызывает `fn` синхронно. Синхронный `throw` превращается в отказ, а не вылетает из вызова. Это единая обёртка для функций, которые «то бросают, то возвращают промис».

### Thenables и совместимость

Промис распознаётся по поведению (duck typing): любой объект с методом `then` — thenable. Благодаря этому в одной цепочке сосуществуют нативные промисы, старые библиотеки (Bluebird, `$.Deferred`) и самописные реализации стандарта Promises/A+. Обратная сторона: объект с полем `then`, который не промис, `await` и `resolve` «развернут», то есть вызовут его `then`. Коллбэк-API в стиле Node переводят на промисы промисификацией (`util.promisify` или обёрткой вручную, см. задачу 2).

### Vue: промисы в хуках, обработчиках и `nextTick`

Vue вызывает пользовательский код через `callWithAsyncErrorHandling` (исходники 3.5.45). Если хук жизненного цикла, обработчик события из шаблона или колбэк `watch` **вернул промис**, Vue подписывается на него через `.catch`. Ошибка проходит тот же путь, что и синхронная: `onErrorCaptured` предков, затем `app.config.errorHandler`. Поэтому ошибка в `async onMounted` или в `@click="save"` с async-методом попадает в обработчик ошибок приложения.

> [!WARNING]
> Vue ловит только **возвращённый** промис. Промис, запущенный «в фоне» (`fetchData()` без `return`/`await` или внутри `setTimeout`), Vue не видит: его отказ станет необработанным. Ещё одна деталь: Vue считает промисом объект, у которого есть и `then`, и `catch` (`isPromise` в `@vue/shared`). Голый thenable он не отслеживает.

`nextTick()` возвращает промис текущего сброса очереди планировщика. Как устроен сброс — в теме [Event loop](./event-loop.md).

## Примеры

```js
// Recovery: catch returns a value, the chain continues fulfilled
fetchConfig()
  .catch(() => DEFAULT_CONFIG)
  .then((config) => start(config));

// then(onOk, onErr) vs then(onOk).catch(onErr)
p.then(
  (v) => { throw new Error('in onOk'); },
  (e) => console.log('NOT called for the error above'),
);
p.then((v) => { throw new Error('in onOk'); })
  .catch((e) => console.log('called:', e.message));

// finally passes the result through and can only override it with a failure
await Promise.resolve(1).finally(() => 2); // 1
await Promise.resolve(1).finally(() => { throw new Error('x'); }); // rejects with x

// Resolved, but still pending: the fate is locked to the inner promise
const outer = new Promise((resolve) => resolve(delay(1000)));
// outer stays pending for ~1 s; calling resolve/reject again changes nothing

// Promise.withResolvers: settle a promise from outside
const { promise, resolve } = Promise.withResolvers();
button.addEventListener('click', resolve, { once: true });
await promise;

// Promise.try: one error path for sync throws and async rejections
Promise.try(() => JSON.parse(raw)).catch(handleParseError);
```

## Вопросы с интервью

::: details Какие состояния бывают у промиса и чем «разрешён» отличается от «выполнен»
Состояния — `pending`, `fulfilled`, `rejected`. Последние два вместе — settled, и из них промис уже никуда не перейдёт. «Разрешён» (resolved) — про судьбу, а не про состояние. Промис разрешён, если он уже завершён **или** привязан к другому промису через `resolve(otherPromise)`. Во втором случае он ещё `pending`, но повлиять на исход уже нельзя: повторные `resolve`/`reject` игнорируются, результат определит внутренний промис. Поэтому функция называется `resolve`, а не `fulfill`: она может и выполнить промис, и (если передан отклонённый промис) фактически привести к отказу.
:::

::: details Что возвращает then и от чего зависит результат цепочки
Всегда новый промис. Исходный не меняется, поэтому повторные `then` на одном промисе — ветвление, а не цепочка. Новый промис разрешается результатом обработчика: значение — выполнен этим значением; исключение — отклонён; промис или thenable — следует за ним, и цепочка ждёт. Если обработчик не передан (или передан не функцией), результат проходит насквозь. Обработчик всегда вызывается микрозадачей, даже на завершённом промисе. Типичная ошибка — забытый `return`: следующий шаг получит `undefined` и не дождётся внутренней операции.
:::

::: details Чем then с двумя аргументами отличается от then и следующего за ним catch
В `p.then(onOk, onErr)` оба обработчика висят на `p`, поэтому `onErr` ловит только отказ самого `p`, но не исключение из `onOk`. В `p.then(onOk).catch(onErr)` обработчик ошибки висит на промисе, который вернул `then`, и ловит оба случая. Двухаргументная форма уместна, когда ошибку из `onOk` **нельзя** смешивать с ошибкой источника, например чтобы не повторить запрос из-за бага в обработке ответа.
:::

::: details Как работает finally и чем он отличается от then с одним колбэком на оба случая
`finally(f)` вызывает `f` без аргументов и по умолчанию пропускает результат насквозь: значение остаётся значением, отказ — отказом. `then(f, f)` передал бы в `f` результат, превратил бы отказ в выполнение и заменил бы значение тем, что вернул `f`. Переопределить результат `finally` может только отказом: `throw` или возврат отклонённого промиса. Возвращённый промис `finally` дожидается, поэтому в нём можно асинхронно освобождать ресурсы. Типичный сценарий — сбросить флаг загрузки независимо от исхода.
:::

::: details Чем отличаются Promise.all, Promise.allSettled, Promise.race и Promise.any
`all` — все выполнены → массив значений в исходном порядке; первый отказ → отказ («всё или ничего»). `allSettled` никогда не отклоняется и даёт массив `{ status, value | reason }`; подходит, когда нужны частичные результаты. `race` повторяет первый завершившийся, неважно с каким исходом; классика — таймаут через гонку с таймером. `any` берёт первый **успех** и отклоняется `AggregateError`, только если провалились все; подходит для зеркал и резервных источников. Крайние случаи: пустой массив — `all` и `allSettled` выполнены `[]`, `any` отклонён, `race` висит вечно. Ни один комбинатор не отменяет проигравшие операции.
:::

::: details Что такое thenable и как промис с ним работает
Любой объект или функция с методом `then`. Когда промис разрешают таким значением (через `resolve`, `return` из обработчика или `await`), спецификация не проверяет, настоящий ли это промис. Она отдельной микрозадачей вызывает `x.then(resolve, reject)` и ждёт. Так обеспечена совместимость разных реализаций промисов. Цена — лишние тики и ловушка: объект с полем `then`, который не промис, «развернётся», и цепочка будет ждать вызова колбэков, которого может не случиться. `Promise.resolve(p)` возвращает `p` как есть, только если это нативный промис того же конструктора.
:::

::: details Что такое необработанный отказ и как на него реагируют браузер и Node
Отказ промиса, на который никто не подписался обработчиком ошибки. Язык только сообщает хосту о таких промисах через `HostPromiseRejectionTracker`. Браузер после microtask checkpoint ставит задачу. Если к её запуску обработчика нет, срабатывает событие `unhandledrejection` (`preventDefault()` глушит вывод в консоль), а при позднем подключении — `rejectionhandled`. Node с версии 15 по умолчанию роняет процесс как при неперехваченном исключении, предварительно вызвав `process.on('unhandledRejection')`. Частые причины — «запустил и забыл» без `catch`, забытый `return` в цепочке, `new Promise(async …)`. Глобальный обработчик нужен для логирования, но не заменяет `catch` на месте.
:::

::: details Почему ошибка в async-хуке Vue попадает в errorHandler, а отказ промиса внутри setTimeout в хуке — нет
Vue вызывает хуки, обработчики событий и колбэки `watch` через `callWithAsyncErrorHandling`. Если результат — промис (объект с `then` и `catch`), Vue вешает на него `.catch` и отправляет ошибку по обычному пути: `onErrorCaptured` предков, затем `app.config.errorHandler`. `async onMounted` возвращает промис, поэтому его ошибки пойманы. Промис, созданный внутри `setTimeout` или запущенный без `return`/`await`, Vue не возвращается и остаётся без обработчика: это необработанный отказ уровня `window`/`process`. Вывод: в хуках и обработчиках либо `await`-ить асинхронную работу, либо ловить ошибки самому.
:::

## Задачи

### 1. Значения в цепочке · легко

Что выведет код?

```js
Promise.resolve(1)
  .then((x) => x + 1)
  .then((x) => { throw new Error(`bad ${x}`); })
  .then((x) => console.log('skipped', x))
  .catch((e) => { console.log('caught', e.message); return 10; })
  .finally(() => 99)
  .then((x) => console.log('value', x))
  .then(null, () => console.log('never'))
  .then((x) => console.log('last', x));
```

::: details Решение и разбор
```
caught bad 2
value 10
last undefined
```

- `1 → 2`, затем исключение отклоняет третий промис. `then` без `onRejected` пропускает отказ, `skipped` не выводится.
- `catch` выводит `caught bad 2` и **возвращает** `10`: цепочка восстановилась.
- `finally` игнорирует свой возврат `99` и пропускает `10` дальше.
- `console.log` возвращает `undefined`, это и получает следующий шаг. `then(null, …)` пропускает значение, `never` не выводится, `last undefined`.
:::

### 2. promisify · легко

Напишите `promisify(fn)` для функций в стиле Node: последний аргумент — колбэк `(error, result)`. Результат должен сохранять `this`, чтобы работать как метод объекта.

::: details Решение и разбор
```js
function promisify(fn) {
  return function (...args) {
    return new Promise((resolve, reject) => {
      fn.call(this, ...args, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
  };
}

const readFileAsync = promisify(fs.readFile);
const user = await promisify(db.getUser).call(db, 42);
```

- Обёртка — обычная `function`, а не стрелка: только так `this` вызова попадёт в `fn.call(this, …)` (см. тему «Функции и `this`»).
- Синхронное исключение `fn` бросается внутри executor и само превращается в `reject`.
- Если колбэк вызовут дважды, второй вызов проигнорируется: промис завершается один раз. Колбэк с несколькими результатами (`(err, a, b)`) обёртка теряет. `util.promisify` решает это через символ `util.promisify.custom`.
:::

### 3. Последовательно и параллельно · средне

Дан массив функций `tasks`, каждая возвращает промис. Напишите `runSequentially(tasks)` — следующая задача стартует после завершения предыдущей, результат — массив значений по порядку. И `runInParallel(tasks)`. Почему этот вариант не работает?

```js
function runSequentially(tasks) {
  const results = [];
  tasks.forEach((task) => task().then((v) => results.push(v)));
  return Promise.resolve(results);
}
```

::: details Решение и разбор
```js
function runSequentially(tasks) {
  return tasks.reduce(
    (chain, task) => chain.then((results) => task().then((value) => [...results, value])),
    Promise.resolve([]),
  );
}

function runInParallel(tasks) {
  return Promise.all(tasks.map((task) => task()));
}
```

- Исходный вариант запускает все задачи сразу: `forEach` не ждёт промисы. Возвращает он пустой массив, который заполнится позже и в порядке **завершения**. Отказы при этом не обработаны.
- В `reduce` каждая задача вызывается внутри `then` предыдущего шага, поэтому стартует только после него. Отказ любой задачи пролетает до конца, и остальные не запускаются.
- Принципиально, что в массиве лежат **функции**, а не промисы: промис — уже запущенная операция, «последовательно» его не выполнить.
- С `async/await` последовательный вариант — цикл `for…of` с `await`. Он нагляднее, но семантика та же.

Сложность: время — сумма длительностей против максимума у параллельного варианта; память O(n) на результаты (в `reduce` с копированием массива — O(n²) копирований, для больших n лучше `push`).
:::

### 4. Дедупликация запросов · средне

Несколько компонентов одновременно вызывают `getUser(id)`. Напишите обёртку `dedupe(fetcher)`: одновременные и повторные вызовы с одним ключом делают **один** запрос, а неудачный запрос не кэшируется — следующий вызов повторяет его.

::: details Решение и разбор
```js
function dedupe(fetcher) {
  const cache = new Map();
  return (key) => {
    if (!cache.has(key)) {
      const promise = fetcher(key).catch((error) => {
        cache.delete(key);
        throw error;
      });
      cache.set(key, promise);
    }
    return cache.get(key);
  };
}

const getUser = dedupe((id) => fetch(`/api/users/${id}`).then((r) => r.json()));
```

- Кэшируется **промис**, а не результат. Иначе второй вызов, пришедший до ответа, увидел бы пустой кэш и сделал второй запрос.
- Промис кладётся в кэш **синхронно**, до первого `await`, поэтому гонки между вызовами нет: JavaScript однопоточный.
- При отказе запись удаляется, а ошибка пробрасывается дальше (`throw` в `catch`), чтобы все ожидающие её получили. Без удаления кэш навсегда запомнил бы отказ.
- Все вызывающие получают один и тот же объект. Если его мутировать, изменения увидят все; во Vue это аргумент держать такие данные в сторе, а не мутировать ответ.
- Для продакшна не хватает TTL, ограничения размера и отмены. Всё это дают библиотеки кэширования запросов (Pinia Colada, TanStack Query).

Сложность: O(1) на вызов, память — O(k) по числу ключей.
:::

### 5. Свой Promise · сложно

Реализуйте `MyPromise` с конструктором, `then` и `catch`: одно изменение состояния, асинхронные обработчики, проброс результата при отсутствии обработчика, разворачивание thenable и защита от цикла. Он должен работать вместе с нативными промисами в обе стороны.

::: details Решение и разбор
```js
const PENDING = 0, FULFILLED = 1, REJECTED = 2;

class MyPromise {
  #state = PENDING;
  #value;
  #reactions = [];

  constructor(executor) {
    const { resolve, reject } = this.#createResolvers();
    try {
      executor(resolve, reject);
    } catch (error) {
      reject(error);
    }
  }

  // A fresh pair of resolving functions that share one "already resolved" flag
  #createResolvers() {
    let done = false;
    const once = (fn) => (value) => {
      if (done) return;
      done = true;
      fn(value);
    };
    return {
      resolve: once((value) => this.#resolve(value)),
      reject: once((reason) => this.#settle(REJECTED, reason)),
    };
  }

  #resolve(value) {
    if (value === this) {
      this.#settle(REJECTED, new TypeError('Chaining cycle detected'));
      return;
    }
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      this.#settle(FULFILLED, value);
      return;
    }
    let then;
    try {
      then = value.then; // read once: a getter may throw or change
    } catch (error) {
      this.#settle(REJECTED, error);
      return;
    }
    if (typeof then !== 'function') {
      this.#settle(FULFILLED, value);
      return;
    }
    queueMicrotask(() => {
      const { resolve, reject } = this.#createResolvers();
      try {
        then.call(value, resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  #settle(state, value) {
    this.#state = state;
    this.#value = value;
    this.#reactions.forEach((reaction) => this.#schedule(reaction));
    this.#reactions = [];
  }

  #schedule({ onFulfilled, onRejected, resolve, reject }) {
    queueMicrotask(() => {
      const handler = this.#state === FULFILLED ? onFulfilled : onRejected;
      if (typeof handler !== 'function') {
        (this.#state === FULFILLED ? resolve : reject)(this.#value);
        return;
      }
      try {
        resolve(handler(this.#value));
      } catch (error) {
        reject(error);
      }
    });
  }

  then(onFulfilled, onRejected) {
    return new MyPromise((resolve, reject) => {
      const reaction = { onFulfilled, onRejected, resolve, reject };
      if (this.#state === PENDING) this.#reactions.push(reaction);
      else this.#schedule(reaction);
    });
  }

  catch(onRejected) {
    return this.then(undefined, onRejected);
  }
}
```

- **Резолв и сеттл разделены.** `resolve` — процедура разрешения (цикл, thenable, геттер `then`), `#settle` — окончательная смена состояния. Флаг `done` реализует судьбу: после первого `resolve` промис заперт, даже если ещё `pending`.
- **Thenable** разворачивается отдельной микрозадачей со свежей парой функций, как `NewPromiseResolveThenableJob` в спецификации. Поэтому `await new MyPromise(…)` и `new MyPromise((r) => r(fetch(url)))` работают в обе стороны.
- **Асинхронность** — `queueMicrotask`. С `setTimeout` реализация формально прошла бы тесты Promises/A+, но обработчики выполнялись бы после таймеров и рендеринга, а не вперемешку с нативными промисами.
- Отказ без обработчиков здесь молча теряется. Нативный промис сообщил бы хосту через `HostPromiseRejectionTracker`.
- Расширения на интервью: `finally` через `then`, статические `resolve`/`reject`/`all`. Подклассы (`Symbol.species`) обычно не спрашивают.

Сложность: O(1) на `then` и O(k) на завершение промиса с k подписчиками.
:::

## Источники

- [ECMAScript: Promise Objects](https://tc39.es/ecma262/#sec-promise-objects), [Promise Resolve Functions](https://tc39.es/ecma262/#sec-promise-resolve-functions), [NewPromiseResolveThenableJob](https://tc39.es/ecma262/#sec-newpromiseresolvethenablejob), [HostPromiseRejectionTracker](https://tc39.es/ecma262/#sec-host-promise-rejection-tracker), [Promise.try](https://tc39.es/ecma262/#sec-promise.try), [Promise.withResolvers](https://tc39.es/ecma262/#sec-promise.withResolvers)
- [HTML Living Standard: Unhandled promise rejections](https://html.spec.whatwg.org/multipage/webappapis.html#unhandled-promise-rejections)
- [Promises/A+](https://promisesaplus.com/)
- [MDN: Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise), [Using promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises), [Promise.try()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/try), [Promise.withResolvers()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers), [unhandledrejection](https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event)
- [Node.js: `--unhandled-rejections`](https://nodejs.org/api/cli.html#--unhandled-rejectionsmode), [`util.promisify`](https://nodejs.org/api/util.html#utilpromisifyoriginal)
- [Vue: app.config.errorHandler](https://vuejs.org/api/application.html#app-config-errorhandler), [onErrorCaptured](https://vuejs.org/api/composition-api-lifecycle.html#onerrorcaptured); исходники `@vue/runtime-core` 3.5.45 (`callWithAsyncErrorHandling`, `handleError`) и `@vue/shared` (`isPromise`)
