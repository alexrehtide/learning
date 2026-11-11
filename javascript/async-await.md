---
title: async/await, обработка ошибок и отмена
level: ядро
---

# async/await, обработка ошибок и отмена

> **Коротко.** `async`-функция всегда возвращает новый промис. Её тело выполняется синхронно до первого `await`, а `await` приостанавливает функцию и продолжает её микрозадачей. Отказ промиса превращается в исключение в точке `await`, поэтому асинхронные ошибки ловит обычный `try/catch`. Промис отменить нельзя. Отмена в JavaScript кооперативная: операция принимает `AbortSignal` и сама решает, как остановиться. Тем же механизмом закрывают гонки запросов.

**Связанные темы:** [Промисы](./promises.md), [Event loop](./event-loop.md), [Итераторы и генераторы](./iterators-and-generators.md)

## Теория

### Что делает `async`-функция

- **Возвращает промис всегда.** `return value` выполняет его, `throw` отклоняет. Даже `return somePromise` возвращает **другой** объект: промис функции следует за `somePromise` и разрешается на пару тиков позже (цены в тиках — в теме [Event loop](./event-loop.md)).
- **Тело до первого `await` выполняется синхронно**, прямо в вызове. Если там бросить исключение, оно не вылетит из вызова, а отклонит возвращённый промис.
- **`await x`** заворачивает `x` в промис (`PromiseResolve`), подписывается на него и приостанавливает функцию. Продолжение — микрозадача, даже если `x` не промис или промис уже выполнен. Значение промиса становится результатом выражения, отказ бросается как исключение в точке `await`.

По модели `async`-функция — генератор, которым управляет встроенный исполнитель: `await` работает как `yield` с автоматическим возобновлением. Такой исполнитель пишется руками в теме [Итераторы и генераторы](./iterators-and-generators.md). Разница в том, что у `async`-функции нет внешнего управления: остановить её снаружи нельзя, она дойдёт до конца или до исключения.

Где можно писать `await`:

- внутри `async function`, `async`-стрелки и `async`-метода;
- на верхнем уровне **модуля** (top-level await, ES2022). Модуль с top-level await задерживает выполнение модулей, которые его импортируют, пока не разрешится ожидание. В классических скриптах и CommonJS top-level await нет;
- `for await...of` — для async iterable.

Во вложенной обычной функции `await` недоступен, даже если внешняя функция асинхронная. Поэтому колбэк `forEach` приходится делать `async`, и в этот момент начинается ловушка из следующего раздела.

### Последовательно и параллельно

`await` в цикле выполняет операции **по одной**. Это правильно, когда следующий шаг зависит от предыдущего, и медленно, когда шаги независимы.

| Нужно | Как | Время |
| --- | --- | --- |
| По одной, по порядку | `for (const x of items) await work(x)` | сумма длительностей |
| Все сразу, всё или ничего | `await Promise.all(items.map(work))` | максимум |
| Все сразу, частичный результат | `await Promise.allSettled(items.map(work))` | максимум |
| Не больше k одновременно | пул с лимитом конкурентности (live coding) | ≈ сумма / k |

`items.forEach(async (x) => { await work(x) })` не делает ни того, ни другого. `forEach` игнорирует промисы, которые возвращает колбэк: все операции стартуют сразу, код после `forEach` выполняется, не дождавшись их, а отказы остаются необработанными. То же с `filter`, `some`, `reduce` и любым API, которое не знает про промисы.

> [!WARNING]
> «Запустить сразу, дождаться потом» — `const a = getA(); const b = getB(); await a; await b;` — параллельно, но опасно. Пока функция ждёт `a`, у `b` нет обработчика. Если `b` отклонится раньше, хост сочтёт отказ необработанным: в браузере сработает `unhandledrejection`, Node по умолчанию завершит процесс. А если отклонится `a`, функция выйдет и до `b` уже не дойдёт. `Promise.all` подписывается на все промисы сразу и этих проблем не имеет.

### Ошибки

`try/catch` вокруг `await` ловит и синхронные исключения, и отказы промисов: отказ бросается в точке `await`. `finally` выполняется при любом исходе и подходит для освобождения ресурсов и сброса флага загрузки.

**`return promise` против `return await promise`.** Внутри `try` разница принципиальна:

```js
async function load() {
  try {
    return fetchData(); // the promise leaves the try before it settles: catch never runs
  } catch {
    return FALLBACK;
  }
}
```

С `return await fetchData()` функция дожидается результата **внутри** `try`, и `catch` срабатывает. То же касается `finally`: без `await` он выполнится до завершения операции. Вне `try` разница только в стеке ошибки и в паре тиков. В современных движках `return await` лишней микрозадачи не добавляет, поэтому правило ESLint `no-return-await` с версии 8.46 устарело.

Где и как обрабатывать:

- **Ловите там, где знаете, что делать**: показать сообщение, повторить запрос, взять запасное значение. Промежуточный `catch`, который только логирует и возвращает `undefined`, превращает ошибку в тихие неверные данные дальше по коду.
- **Оборачивайте с причиной.** `throw new Error('Failed to load profile', { cause: error })` (ES2022) добавляет контекст и сохраняет исходную ошибку в `error.cause`. Консоль и Sentry показывают всю цепочку.
- **Свои классы ошибок** (`class HttpError extends Error`) с полем `name` и данными (`status`) позволяют различать ошибки через `instanceof` или `name`. Между realm-ами (iframe, `vm` в Node) `instanceof` ломается. `Error.isError(x)` (ES2026) проверяет ошибку по внутреннему слоту, но в части браузеров его ещё нет: на MDN статус «Limited availability» (сверено 2026-11-11).
- **Несколько ошибок сразу** собирают в `AggregateError` (`errors` — массив), как это делает `Promise.any`.
- **«Запустил и забыл»** — только с явным обработчиком: `void sendAnalytics().catch(report)`. `void` здесь — сигнал читателю и линтеру (`no-floating-promises` в typescript-eslint), что промис не ждут намеренно.
- Кортежи в стиле Go (`const [error, data] = await to(promise)`) делают ошибку явной частью результата. Цена — проверка после каждого вызова и потеря автоматического проброса.

> [!WARNING]
> Стек ошибки через `await` в V8 восстанавливается (zero-cost async stack traces): в стеке видны `async`-функции, которые ждали друг друга. Через цепочки `then` и колбэки таймеров стек обрывается. Это деталь движка, а не спецификации, но ещё один довод за `await`, в том числе за `return await`.

Как Vue перехватывает ошибки async-хуков и обработчиков событий, разобрано в теме [Промисы](./promises.md): Vue ловит только тот промис, который ему вернули.

### Отмена: `AbortController` и `AbortSignal`

Промис — это результат, а не операция. У него нет метода `cancel`: proposal об отменяемых промисах отозвали в 2016 году. Отменяют саму операцию, и делает это она сама по сигналу. Механизм описан не в ECMAScript, а в DOM Standard. Он есть в браузерах, воркерах, Node и Deno.

```js
const controller = new AbortController();
fetch(url, { signal: controller.signal });
controller.abort(); // the fetch promise rejects with signal.reason
```

| API | Что делает |
| --- | --- |
| `controller.abort(reason?)` | Отменяет сигнал. Без аргумента причина — `DOMException` с именем `AbortError`. Повторный вызов ничего не делает |
| `signal.aborted`, `signal.reason` | Отменён ли сигнал и с какой причиной |
| `signal.throwIfAborted()` | Бросает `signal.reason`, если сигнал отменён |
| событие `abort` | Срабатывает один раз, **синхронно** внутри `abort()` |
| `AbortSignal.timeout(ms)` | Сигнал, который отменится сам. Причина — `DOMException` `TimeoutError` |
| `AbortSignal.any(signals)` | Отменяется вместе с первым из входных, с его причиной (Baseline с марта 2024) |
| `AbortSignal.abort(reason?)` | Уже отменённый сигнал |

Как пишется отменяемый API (DOM Standard прямо рекомендует отклонять незавершённый промис причиной из сигнала):

1. Проверить сигнал **до** начала работы: отменённый сигнал мог прийти на вход.
2. Подписаться на `abort` и остановить работу: снять таймер, закрыть соединение, отклонить промис с `signal.reason`.
3. Снять подписку, когда операция завершилась. Иначе долгоживущий сигнал (например, на всё время жизни страницы) копит слушатели вместе с их замыканиями — утечка памяти.
4. В длинном цикле вызывать `signal.throwIfAborted()` между шагами.

Отличить отмену от сбоя: проверить `signal.aborted` у своего сигнала или `error.name` (`AbortError`, `TimeoutError`). Отмену обычно не показывают пользователю как ошибку: её инициировал сам код.

> [!WARNING]
> Отмена на клиенте не откатывает того, что уже сделал сервер. Отменённый `POST` мог дойти и выполниться. Повторяемые после отмены мутации должны быть идемпотентными (ключ идемпотентности в заголовке) — это тема System Design. И ещё: `fetch` выполняется, когда пришли **заголовки**. Если отменить сигнал во время чтения тела, отклонится `response.json()`.

> [!NOTE]
> `await using` (proposal Explicit Resource Management, stage 4, войдёт в ES2027; сверено 2026-11-11) вызывает `await resource[Symbol.asyncDispose]()` при выходе из блока, как `finally` без ручного кода. `AsyncDisposableStack` собирает несколько таких ресурсов. В Node 26 работает, в браузерах — «Limited availability» на MDN; в клиентском коде только через транспиляцию.

### Гонки запросов

Пользователь вводит `vu`, затем `vue`. Ответ на `vu` пришёл позже ответа на `vue` и перезаписал результат: на экране подсказки к устаревшему запросу. Это гонка (race condition): результат зависит от порядка ответов, а не запросов. Способы устранить по убыванию предпочтительности:

1. **Отменить предыдущий запрос** при старте нового (`abort()` у прежнего контроллера). Экономит сеть и решает проблему целиком.
2. **Проверить актуальность** перед записью результата: номер запроса или «тот ли это ещё контроллер». Подходит для API, которые не умеют отменяться.
3. Debounce уменьшает число запросов, но гонку **не** устраняет: медленный ответ всё равно может прийти последним.

### Vue: очистка в `watch`

Колбэк `watch` и функция `watchEffect` могут зарегистрировать очистку. Vue вызывает её перед следующим запуском и при остановке наблюдателя, в том числе при размонтировании компонента (в исходниках 3.5.45 очистка — это `effect.onStop`). Самый удобный способ — `onWatcherCleanup` из Vue 3.5. До 3.5 — третий аргумент колбэка `watch` (`onCleanup`) или первый аргумент `watchEffect`.

```js
import { watch, onWatcherCleanup } from 'vue';

watch(query, async (q) => {
  const controller = new AbortController();
  onWatcherCleanup(() => controller.abort()); // register BEFORE the first await
  try {
    results.value = await search(q, { signal: controller.signal });
  } catch (error) {
    if (!controller.signal.aborted) lastError.value = error;
  }
});
```

> [!WARNING]
> `onWatcherCleanup` работает только во время **синхронной** части колбэка: после первого `await` текущий наблюдатель уже неизвестен, и Vue выведет предупреждение. Поэтому контроллер создаётся и регистрируется в самом начале.

## Примеры

```js
// The body runs synchronously up to the first await
async function f() {
  console.log('1: inside f');
  await null;
  console.log('3: after await');
}
f();
console.log('2: after the call');

// A sync throw inside an async function becomes a rejection, not an exception
const p = (async () => { throw new Error('boom'); })();
p.catch((e) => console.log('caught', e.message));

// Wrap with context, keep the original
try {
  await saveDraft(draft);
} catch (error) {
  throw new Error(`Failed to save draft ${draft.id}`, { cause: error });
}

// Timeout + user cancellation in one signal
const controller = new AbortController();
cancelButton.onclick = () => controller.abort();
try {
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
  const response = await fetch('/api/report', { signal });
  render(await response.json());
} catch (error) {
  if (error.name === 'TimeoutError') showMessage('The server is too slow');
  else if (error.name !== 'AbortError') throw error;
}
```

## Вопросы с интервью

::: details Что возвращает async-функция и когда выполняется её тело
Всегда новый промис. Возврат значения выполняет его, исключение отклоняет, возврат промиса или thenable заставляет следовать за ним (с лишними тиками). Тело выполняется синхронно в момент вызова до первого `await`. Поэтому синхронная подготовка, например постановка промиса в кэш, происходит без гонок. По той же причине исключение в начале функции не вылетает из вызова, а отклоняет промис: `try/catch` вокруг вызова без `await` его не поймает. После `await` продолжение идёт микрозадачей, даже если ждали не промис.
:::

::: details Чем async/await отличается от цепочек then и что он даёт кроме синтаксиса
По семантике это та же машина промисов: `await` подписывается на промис, продолжение — реакция-микрозадача. Отличия практические. Ошибки синхронного и асинхронного кода ловит один `try/catch`, а `finally` работает как обычно. Промежуточные значения — обычные переменные в одной области видимости, без вложенных `then` или протаскивания через цепочку. Ветвления и циклы пишутся обычными `if`/`for`. В V8 стек ошибки восстанавливается через `await`, а через `then` — нет. Обратная сторона: шаги по умолчанию **последовательные**, и независимые операции легко случайно выполнить по одной.
:::

::: details Почему forEach с async-колбэком не ждёт и как обойти массив правильно
`forEach` вызывает колбэк и выбрасывает возвращённое значение, а у `async`-колбэка это промис. Все итерации стартуют сразу, код после `forEach` идёт дальше, отказы никто не обрабатывает. Последовательно — `for...of` с `await` внутри. Параллельно — `await Promise.all(items.map(async (x) => …))`. Параллельно с частичным результатом — `Promise.allSettled`. С ограничением одновременных операций — пул с лимитом конкурентности. Выбор зависит от того, зависят ли шаги друг от друга и выдержит ли сервер пачку запросов.
:::

::: details Зачем писать return await, если можно просто вернуть промис
Внутри `try` без `await` функция возвращает промис раньше, чем он завершится: `catch` не поймает его отказ, а `finally` выполнится до окончания операции. С `return await` результат ждут внутри `try`. Вне `try` поведение одинаковое, но `return await` даёт полный async-стек в V8 и не стоит лишней микрозадачи в современных движках. Поэтому правило ESLint `no-return-await` устарело с версии 8.46. Разумное правило: `return await` всегда, по крайней мере внутри `try`.
:::

::: details Как отменить асинхронную операцию, если промис отменить нельзя
Промис — только результат, он не управляет операцией. Отмену делают кооперативно через `AbortController`: операция принимает `signal` и сама останавливается по событию `abort`. `fetch`, `addEventListener` (опция `signal` снимает слушатель), потоки и многие библиотеки (axios, `ofetch`) принимают сигнал напрямую. Свой отменяемый API проверяет сигнал до старта, подписывается на `abort`, отклоняет промис с `signal.reason` и снимает подписку по завершении. Таймаут — `AbortSignal.timeout(ms)`, комбинация нескольких причин — `AbortSignal.any`. Отмена не откатывает работу, уже сделанную сервером.
:::

::: details Как отличить отмену от ошибки и как её обрабатывать
По своему сигналу (`signal.aborted`) или по имени ошибки: `AbortError` при `abort()` без причины, `TimeoutError` у `AbortSignal.timeout`. Если причину передали явно (`abort(reason)`), отклонение придёт именно с ней: `fetch` отклоняется причиной сигнала. Отмену, которую инициировал сам код (пользователь ушёл со страницы, пришёл новый запрос), не показывают как ошибку и не отправляют в мониторинг. Таймаут, наоборот, — сбой с понятным сообщением и, возможно, повтором. Главное — не глотать все ошибки подряд ради отмены: проверка должна быть точной.
:::

::: details Что такое гонка запросов и как её устранить во Vue
Ответы приходят не в том порядке, в котором ушли запросы, и устаревший ответ перезаписывает актуальный. Типичные места — автокомплит, фильтры, смена `id` в маршруте. Лучшее решение — отменять предыдущий запрос при старте нового. Если API отмену не поддерживает, проверять перед записью, что ответ относится к последнему запросу. Debounce уменьшает число запросов, но гонку не устраняет. Во Vue это `watch` с очисткой: `onWatcherCleanup(() => controller.abort())` (3.5+) или аргумент `onCleanup`. Очистка вызывается перед следующим запуском и при размонтировании компонента, но регистрировать её нужно до первого `await`.
:::

## Задачи

### 1. Кто поймает ошибку · легко

Чем завершится каждый вызов: значением или отказом?

```js
async function load() {
  throw new Error('boom');
}

async function a() { try { return load(); } catch { return 'a caught'; } }
async function b() { try { return await load(); } catch { return 'b caught'; } }
async function c() { try { load(); } catch { return 'c caught'; } return 'c done'; }
function d() { try { return load(); } catch { return 'd caught'; } }
```

::: details Решение и разбор
- `a()` — **отклонён** с `boom`. `return load()` вернул промис и покинул `try` до его отказа.
- `b()` — выполнен значением `'b caught'`. `await` бросает отказ внутри `try`.
- `c()` — выполнен значением `'c done'`, а промис `load()` отклоняется **без обработчика**: необработанный отказ. Node по умолчанию завершит процесс.
- `d()` — обычная функция вернула отклонённый промис, `catch` не сработал: синхронного исключения не было, `load` сама `async`.

Вывод: `try/catch` ловит асинхронную ошибку только при `await` внутри `try`.
:::

### 2. Параллельно, но надёжно · средне

Код загружает данные параллельно. Найдите проблемы и исправьте. При ошибке одной загрузки вторая должна отменяться.

```js
async function loadDashboard(userId) {
  const userPromise = fetchJson(`/api/users/${userId}`);
  const statsPromise = fetchJson(`/api/stats/${userId}`);
  const user = await userPromise;
  const stats = await statsPromise;
  return { user, stats };
}
```

::: details Решение и разбор
```js
async function loadDashboard(userId, { signal } = {}) {
  const controller = new AbortController();
  const shared = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    const [user, stats] = await Promise.all([
      fetchJson(`/api/users/${userId}`, { signal: shared }),
      fetchJson(`/api/stats/${userId}`, { signal: shared }),
    ]);
    return { user, stats };
  } catch (error) {
    controller.abort(); // fail fast: stop the other request
    throw error;
  }
}
```

- В исходном коде, пока функция ждёт `user`, у `statsPromise` нет обработчика. Если статистика упадёт первой, это необработанный отказ: `unhandledrejection` в браузере, падение процесса в Node.
- Если первым упадёт `user`, функция выйдет и отказ `statsPromise` не обработает никто.
- `Promise.all` подписывается на оба промиса сразу и отклоняется на первой ошибке. Но второй запрос он не останавливает, поэтому в `catch` отменяется общий контроллер.
- Внешний `signal` объединён с внутренним через `AbortSignal.any`: вызывающий (например, компонент при размонтировании) тоже может отменить обе загрузки.
- Если нужен частичный результат (дашборд без статистики), берите `Promise.allSettled` и обрабатывайте каждый исход отдельно.
:::

### 3. Прерываемый sleep · средне

Напишите `sleep(ms, { signal })`: промис выполняется через `ms` миллисекунд. При отмене он сразу отклоняется с `signal.reason`, а таймер снимается. Уже отменённый сигнал отклоняет промис без запуска таймера.

::: details Решение и разбор
```js
function sleep(ms, { signal } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted(); // a throw inside the executor becomes a rejection

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const controller = new AbortController();
setTimeout(() => controller.abort(), 100);
await sleep(1000, { signal: controller.signal }); // rejects with AbortError after ~100 ms
```

- `throwIfAborted` внутри executor превращается в отказ, а не в синхронное исключение. Функция, возвращающая промис, не должна бросать синхронно.
- Слушатель снимается в обоих исходах: `once` — при отмене, `removeEventListener` — при обычном завершении. Без снятия каждый `sleep` на долгоживущем сигнале оставлял бы в нём замыкание — утечка.
- Отклонение именно с `signal.reason` позволяет вызывающему отличить таймаут (`TimeoutError`) от ручной отмены и передать свою причину.
- Тот же каркас подходит для любой операции на колбэках: подписка на `abort`, освобождение ресурса, `reject(signal.reason)`, отписка в конце.
:::

### 4. Автокомплит без гонок · средне

Напишите обёртку `takeLatest(fn)`: `fn(signal, ...args)` возвращает промис. Новый вызов отменяет предыдущий, а устаревший результат не возвращается, даже если `fn` игнорирует сигнал. Покажите использование в компоненте Vue.

::: details Решение и разбор
```js
function takeLatest(fn) {
  let current = null;
  return async (...args) => {
    current?.abort();
    const controller = (current = new AbortController());
    try {
      const result = await fn(controller.signal, ...args);
      controller.signal.throwIfAborted(); // fn may ignore the signal: never return a stale result
      return result;
    } finally {
      if (current === controller) current = null;
    }
  };
}

const search = takeLatest((signal, q) =>
  fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.json()),
);

async function onInput(q) {
  try {
    suggestions.value = await search(q);
  } catch (error) {
    if (error.name !== 'AbortError') lastError.value = error;
  }
}
```

- Отмена прежнего запроса экономит сеть, а проверка `throwIfAborted` после `await` — страховка для API без отмены. Вместе они гарантируют, что вызов, на смену которому пришёл новый, никогда не вернёт результат.
- Отменённые вызовы отклоняются с `AbortError`, и вызывающий их отфильтровывает. Альтернатива — вечно висящий промис для отменённых вызовов. Она избавляет от фильтрации, но удерживает в памяти всё, что ждёт этот промис.
- `finally` сбрасывает ссылку, только если за это время не стартовал новый вызов.
- Во Vue тот же эффект без обёртки даёт `watch(query, …)` с `onWatcherCleanup(() => controller.abort())` — пример в теории. Обёртка удобна, когда запрос запускают обработчики событий, а не `watch`.
:::

### 5. `AbortSignal.any` своими руками · сложно

Напишите `anySignal(signals)`: возвращает сигнал, который отменяется вместе с первым из входных, с его причиной. Учтите уже отменённые входы и то, что входные сигналы бывают долгоживущими.

::: details Решение и разбор
```js
function anySignal(signals) {
  const controller = new AbortController();
  const unsubscribers = [];
  const dispose = () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    unsubscribers.length = 0;
  };

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const onAbort = () => {
      controller.abort(signal.reason);
      dispose();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    unsubscribers.push(() => signal.removeEventListener('abort', onAbort));
  }
  if (controller.signal.aborted) dispose();

  return { signal: controller.signal, dispose };
}

// One request: page lifetime + user cancel + timeout
const { signal, dispose } = anySignal([pageSignal, cancelSignal, AbortSignal.timeout(5000)]);
try {
  await fetch(url, { signal });
} finally {
  dispose(); // pageSignal lives for the whole session: drop our listener
}
```

- Уже отменённый вход отменяет результат сразу и с его причиной, как в спецификации. Подписки, сделанные до него, снимаются.
- После первой отмены подписки на остальные входы снимаются, повторная отмена ничего не меняет (`abort` идемпотентен).
- Главное отличие от встроенного `AbortSignal.any` — `dispose`. В браузере связь между входами и результатом **слабая**: результат не удерживает входы, а сам живёт, только пока на нём есть слушатели или его использует API. Пользовательский код слабые слушатели не выразит (кроме `WeakRef`, что сложно и недетерминированно). Поэтому полифил без явного `dispose` копил бы слушатели на долгоживущем сигнале страницы — по одному на каждый запрос.
- Отмена результата не отменяет входы. Таймер `AbortSignal.timeout` тоже продолжает тикать, но ничего не удерживает.
- Различить причину можно по `signal.reason`: у таймаута это `TimeoutError`.

Сложность: O(n) на создание и на отмену, память O(n) на подписки.
:::

## Источники

- [ECMAScript: Async Function Definitions](https://tc39.es/ecma262/#sec-async-function-definitions), [Await](https://tc39.es/ecma262/#await), [AsyncFunctionStart](https://tc39.es/ecma262/#sec-async-functions-abstract-operations-async-function-start)
- [TC39: Finished Proposals](https://github.com/tc39/proposals/blob/main/finished-proposals.md) — Top-level await и Error Cause (ES2022), `Error.isError` (ES2026), Explicit Resource Management (ES2027)
- [DOM Standard: Aborting ongoing activities](https://dom.spec.whatwg.org/#aborting-ongoing-activities)
- [MDN: async function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function), [await](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await), [Error: cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause), [Error.isError()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/isError), [AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController), [AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal), [AbortSignal.any()](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static), [await using](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/await_using)
- [Vue: onWatcherCleanup](https://vuejs.org/api/reactivity-core.html#onwatchercleanup), [Watchers: Side Effect Cleanup](https://vuejs.org/guide/essentials/watchers.html#side-effect-cleanup); исходники `@vue/reactivity` 3.5.45 (`watch`, `onWatcherCleanup`)
- [ESLint: no-return-await (deprecated)](https://eslint.org/docs/latest/rules/no-return-await), [typescript-eslint: no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/)
- [V8: Faster async functions and promises](https://v8.dev/blog/fast-async) — в том числе zero-cost async stack traces
