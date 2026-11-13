---
title: 'Утилиты промисов: `Promise.all` и компания, пул, retry'
level: ядро
---

# Утилиты промисов: `Promise.all` и компания, пул, retry

> **Коротко.** Комбинаторы `all`, `allSettled`, `race` и `any` пишутся по одной схеме. Обходим любой iterable, каждый элемент пропускаем через `Promise.resolve`, подписываемся через `then`, результат кладём по индексу и считаем незавершённые счётчиком. Утилиты поверх них — таймаут, пул с лимитом конкурентности, `retry` — держатся на одном правиле: промис ничего не отменяет, поэтому отмену проводят через `AbortSignal`. На интервью проверяют крайние случаи: пустой вход, не-промисы, порядок результатов, ошибку итератора. А ещё — что происходит с операциями, которые уже не нужны.

**Связанные темы:** [Промисы](../javascript/promises.md), [async/await, обработка ошибок и отмена](../javascript/async-await.md), [Event loop](../javascript/event-loop.md), [Итераторы и генераторы](../javascript/iterators-and-generators.md), [HTTP: методы, статусы, заголовки, версии](../network/http.md), [debounce и throttle](./debounce-throttle.md), [Стеки и очереди](../algorithms/stacks-and-queues.md)

## Теория

Как устроены состояния, `then` и разрешение thenable — в теме [Промисы](../javascript/promises.md). Там же таблица: чем выполняется и отклоняется каждый комбинатор. Здесь — как написать их самому.

### Общая схема комбинаторов по спецификации

В ECMAScript все четыре метода устроены одинаково (`Promise.all` → `PerformPromiseAll` и соседи):

1. `C = this` — конструктор, на котором вызвали метод. Поэтому `MyPromise.all` возвращает `MyPromise`.
2. **Один раз, до обхода**, читается `C.resolve`. Если это не функция, возвращается отклонённый промис. Проверено в Node 26: геттер `resolve` вызывается раньше, чем `[Symbol.iterator]`.
3. Вход обходится как **iterable**: массив, `Set`, строка, генератор. Не-iterable (`Promise.all(5)`) даёт **отклонённый промис** с `TypeError`, а не синхронное исключение.
4. Каждый элемент проходит через `C.resolve(item)`. Поэтому в массиве могут быть обычные значения, промисы и thenable. Затем у результата вызывается `then` с парой функций для этого элемента.
5. У каждой функции элемента свой флаг `[[AlreadyCalled]]`: повторный вызов от «кривого» thenable ничего не меняет.
6. Счётчик `remainingElementsCount` начинается с **1**. Каждый элемент добавляет единицу, а после обхода её снимают. Если счётчик дошёл до нуля, результат готов. Пустой вход сразу обнуляет счётчик: `all` и `allSettled` выполняются `[]`, `any` отклоняется `AggregateError`.
7. Если итератор бросил исключение, возвращённый промис отклоняется этой ошибкой. Если упал `C.resolve` или `then`, итератор ещё и закрывается (`IteratorClose` вызывает его `return()`).

| Метод | Что делает функция элемента | Когда счётчик дошёл до нуля | Пустой вход |
| --- | --- | --- | --- |
| `all` | значение → `values[i]` | выполнить `values` | `[]` |
| `allSettled` | любой исход → `{ status, value/reason }` в `results[i]` | выполнить `results` | `[]` |
| `any` | отказ → `errors[i]` | отклонить `AggregateError(errors)` | `AggregateError` |
| `race` | счётчика нет: `then(resolve, reject)` | — | вечно `pending` |

`any` — зеркало `all`: роли значения и отказа меняются местами. Пустой вход у них отличается по той же причине: «все выполнились» для пустого множества истинно, а «хоть один выполнился» ложно. У `race` победителя нет, поэтому он висит вечно.

### Типичные ошибки кандидатов

- **`results.push(value)`** вместо `results[i] = value`. Результаты встают в порядке завершения, а не входа.
- **`if (results.length === n)`** как признак готовности. Присваивание `results[3] = x` делает длину равной 4, хотя индексы 0–2 пусты. Проверено: `[slow, 'fast']` выполняется `[<empty>, 'fast']`, не дождавшись медленного. Нужен отдельный счётчик.
- **`var i`** в цикле или индекс, взятый после `await`. Все колбэки получают последний индекс. Индекс фиксируют `const` внутри тела цикла.
- **`arr.length` и `arr.forEach`.** Работает только с массивами. Вариант `Array.from(iterable)` годится, но по поведению отличается от спецификации: если итератор бросит на середине, уже прочитанные элементы останутся без подписчика. Проверено: отклонённый первый элемент генератора, который затем бросил, даёт `unhandledrejection`. У нативного `Promise.all` — нет.
- **Пустой вход забыт.** Цикл не выполнится, и промис повиснет навсегда. Отсюда «лишняя единица» в счётчике.
- **`item.then(...)`** без `Promise.resolve`. Падает на обычных значениях, а у thenable вызывает `then` синхронно, в обход очереди микрозадач.
- **Синхронный `throw`** из функции, которая возвращает промис. Ошибки входа превращают в отказ: код внутри executor так и работает.

### Комбинаторы ничего не отменяют

После первого отказа `Promise.all` уже отклонён, но остальные операции идут дальше. Сетевые запросы, таймеры и обработка продолжаются, их результаты просто выбрасываются. Отказы «проигравших» не станут необработанными: комбинатор подписался на каждый элемент. Если операции нужно остановить, им передают общий `AbortSignal` и отменяют его при первом сбое. Так устроен пул в задаче 4. Как писать отменяемые операции — в теме [async/await, обработка ошибок и отмена](../javascript/async-await.md).

### Таймаут

`Promise.race([operation, timer])` — самый частый ответ, и у него три проблемы:

1. **Операция не останавливается.** `race` выбирает победителя, а запрос продолжает грузить данные.
2. **Таймер не снимается.** Если операция успела раньше, таймер всё равно сработает. В Node он держит процесс, а в цикле на тысячи элементов копятся тысячи таймеров. Снимают его в `finally`.
3. **Причина отказа не отличима от сбоя.** Отклоняйте с `DOMException` `TimeoutError`, как `AbortSignal.timeout`, — вызывающий проверит `error.name`.

Правильная форма принимает **функцию**, которая получает сигнал, а не готовый промис. Тогда таймаут отменяет саму операцию. `AbortSignal.timeout(ms)` создаёт сигнал-таймер, `AbortSignal.any([...])` объединяет его с внешней отменой. Прерываемый `sleep` уже написан в задаче 3 темы [async/await, обработка ошибок и отмена](../javascript/async-await.md). Здесь он используется как готовый.

> [!NOTE]
> По MDN, `AbortSignal.timeout` считает **активное** время, а не прошедшее. Таймер замирает, пока документ лежит в back/forward cache или воркер приостановлен. Снять таймер этого сигнала нельзя, но он ничего не удерживает: сигнал без слушателей соберёт сборщик мусора.

### Пул с лимитом конкурентности

Задача: обработать 1000 элементов так, чтобы одновременно выполнялось не больше `k`. `Promise.all(items.map(fn))` запустит все сразу, `for...of` с `await` — по одному.

**Пачки** (`k` штук через `Promise.all`, потом следующие `k`) — частый неверный ответ. Каждая пачка ждёт самый медленный элемент. Пока он грузится, остальные `k − 1` слотов простаивают.

Два правильных устройства:

- **Воркеры над общим итератором.** Запускаем `k` асинхронных циклов. Каждый берёт из **одного** итератора следующий элемент, обрабатывает его и берёт снова. Свободный слот занимается сразу. Вход читается лениво: подходит генератор, даже бесконечный. Это задача 4.
- **Лимитер** (как `p-limit`). Функция `limit(fn)` ставит вызов в очередь, а очередь отдаёт задачи, пока активных меньше `k`. Удобно, когда задачи приходят из разных мест, а не одним списком (пример ниже).

Что уточнить на интервью:

- **Порядок результатов.** Как у `Promise.all` — по индексу входа, не по завершению.
- **Fail-fast или «дождаться всех».** Fail-fast: на первой ошибке перестать брать новые элементы, отменить идущие и отклонить результат. «Дождаться всех»: собрать `{ status, value/reason }` по каждому элементу, как `allSettled`.
- **Отмена извне.** Внешний `signal` объединяется с внутренним. Воркер проверяет его перед каждым новым элементом, операция получает его аргументом.
- **Лимит считают по операциям, а не по элементам.** Браузер сам ограничивает соединения к одному хосту по HTTP/1.1 (в Chromium 6). Но в пуле может быть не только сеть — например, декодирование изображений или запись в IndexedDB.

### retry с экспоненциальной задержкой

Повтор помогает от **временных** сбоев: обрыв сети, `408`, `429`, `502`, `503`, `504`. Повторять `400`, `401`, `403`, `404`, `422` бессмысленно, ответ будет тем же. Поэтому `retry` принимает фильтр `shouldRetry(error, attempt)`.

**Задержка.** Фиксированная пауза плохо работает при перегрузке: все клиенты, упавшие одновременно, вернутся одновременно (thundering herd). Экспоненциальная (`base · 2^attempt`, с потолком `maxDelay`) даёт серверу время. Но клиенты всё равно приходят волнами. **Jitter** — случайная часть задержки — размазывает волну. Разбор AWS «Exponential Backoff And Jitter» сравнивает варианты. «Full jitter» — `random(0, min(cap, base · 2^attempt))` — даёт меньше всего лишней работы при почти том же времени завершения.

Что ещё входит в контракт:

- **Отмена.** Отменённый сигнал прерывает и попытку, и паузу между попытками. Отмена — не сбой, её не повторяют.
- **`Retry-After`.** На `503` и `429` сервер может прислать паузу в секундах или HTTP-дату (RFC 9110). Её стоит взять вместо своей задержки.
- **Идемпотентность.** Автоматически повторяют только идемпотентные запросы. `POST` — только с ключом идемпотентности (подробно в теме [HTTP: методы, статусы, заголовки, версии](../network/http.md)).
- **Общий бюджет.** Ограничение «не дольше 10 секунд на всё» задаётся сигналом `AbortSignal.timeout`, объединённым с внешним. Отдельный таймаут на попытку — `withTimeout` вокруг `fn`.

> [!WARNING]
> Повторы на нескольких уровнях перемножаются. Если `retry(3)` стоит в компоненте, в HTTP-клиенте и в API-шлюзе, один сбой даёт до 4 · 4 · 4 = 64 запросов к упавшему сервису. Повторяют на одном уровне, обычно ближе к сети.

### Во Vue

Пул и `retry` живут дольше компонента. Если загрузка запущена в `setup`, отменяйте её в `onScopeDispose` (или `onUnmounted`) через `AbortController`: иначе после ухода со страницы продолжатся и запросы, и повторы с паузами. Ошибку, которая всплыла из «фоновой» операции без `await`, Vue не перехватит. Почему — в теме [Промисы](../javascript/promises.md).

## Примеры

```js
// Limiter in the style of p-limit: tasks come from different places
function createLimiter(limit) {
  const queue = [];
  let active = 0;

  function runNext() {
    if (active >= limit || queue.length === 0) return;
    active++;
    const { fn, args, resolve, reject } = queue.shift(); // O(n); a real queue is O(1)
    Promise.try(fn, ...args) // a sync throw becomes a rejection
      .then(resolve, reject)
      .finally(() => {
        active--;
        runNext();
      });
  }

  return (fn, ...args) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, args, resolve, reject });
      runNext();
    });
}

const limit = createLimiter(2);
const thumbnails = await Promise.allSettled(files.map((file) => limit(makeThumbnail, file)));
```

## Вопросы с интервью

::: details Зачем в реализации Promise.all счётчик, если можно сравнить длину массива результатов
Результат кладут по индексу: `values[i] = value`. Если элемент 3 завершился раньше элемента 0, длина массива станет 4, хотя три значения ещё не пришли. Проверка `values.length === n` сработает раньше времени и вернёт массив с дырами. Нужен отдельный счётчик незавершённых. В спецификации он начинается с 1, а эту единицу снимают после обхода. Так пустой вход сразу даёт `[]`, а длину входа не нужно знать заранее: iterable может быть генератором.
:::

::: details Что будет, если передать в Promise.all не массив или если итератор бросит исключение
`Promise.all` принимает любой iterable: `Set`, строку, генератор. Не-iterable и исключение итератора дают отклонённый промис, а не синхронное исключение. Если итератор бросил на середине, уже прочитанные элементы подписаны, и их отказы не станут необработанными. Если упал вызов `resolve` или `then` у элемента, спецификация ещё и закрывает итератор через `return()`. Самописная версия через `Array.from` теряет первое свойство: элементы до ошибки остаются без подписчика.
:::

::: details Почему Promise.race с пустым массивом никогда не завершается, а Promise.any отклоняется
`race` ждёт первый завершившийся элемент. В пустом входе его нет, и счётчика у `race` нет вовсе: результат вечно `pending`. `any` — зеркало `all` со счётчиком отказов. Для пустого множества «все отклонены» истинно, поэтому он сразу отклоняется `AggregateError` с пустым `errors`. `all` по той же логике сразу выполняется `[]`. Отсюда практическое правило: `Promise.race(list)` с динамическим списком нужно защищать от пустого входа, иначе код повиснет.
:::

::: details Как сделать таймаут для асинхронной операции и почему Promise.race с setTimeout недостаточно
`race` только выбирает, кого ждать: операция продолжается, а таймер, если его не снять, срабатывает впустую и держит процесс в Node. Правильно передавать операции сигнал: `AbortSignal.any([signal, AbortSignal.timeout(ms)])`. Тогда по таймауту отменится сам запрос. Обёртка всё равно отклоняет промис по сигналу, даже если операция его игнорирует. Отклонять нужно с `TimeoutError`, чтобы вызывающий отличил таймаут от отмены пользователем (`AbortError`) и от сбоя.
:::

::: details Чем пул с лимитом конкурентности лучше обработки пачками
Пачка из `k` элементов через `Promise.all` ждёт самый медленный элемент: остальные слоты простаивают. Пул держит занятыми все `k` слотов: освободился слот — сразу берётся следующий элемент. На неравных длительностях выигрыш большой. Пример: 10 задач по 100 мс и одна на 1 с при `k = 5`. Пачками это ≈ 1,2 с, если медленная попала в первую пачку. Пулом ≈ 1 с: пока идёт медленная, остальные 4 слота пропускают через себя короткие.
:::

::: details Какие ошибки стоит повторять и зачем в retry случайная задержка
Повторяют временные сбои: обрыв сети, `408`, `429`, `502`, `503`, `504`. Клиентские ошибки (`400`, `401`, `403`, `404`, `422`) не повторяют: ответ не изменится. Отмену тоже не повторяют. Мутации повторяют, только если они идемпотентны или у них есть ключ идемпотентности. Задержка растёт экспоненциально, чтобы перегруженный сервер успел восстановиться. Случайная часть (jitter) нужна, чтобы тысячи клиентов, упавших одновременно, не вернулись одной волной. Если сервер прислал `Retry-After`, берут его значение.
:::

::: details Пул упал на одном элементе: что происходит с остальными
Зависит от контракта, его нужно уточнить. При fail-fast пул отклоняется первой ошибкой, перестаёт брать новые элементы и отменяет идущие через общий `AbortSignal`. Операции, которые сигнал игнорируют, доработают, но их результаты выбрасываются, а отказы не станут необработанными: `Promise.all` над воркерами подписан на всех. Если нужен полный отчёт, каждый элемент заворачивают в `{ status, value/reason }`, и пул никогда не отклоняется. Это аналог `allSettled`.
:::

## Задачи

### 1. Promise.all · легко

Напишите `promiseAll(iterable)` с поведением `Promise.all`: любой iterable, обычные значения и thenable наравне с промисами, порядок результатов по входу, первая ошибка отклоняет результат, пустой вход даёт `[]`.

::: details Решение и разбор
```js
function promiseAll(iterable) {
  return new Promise((resolve, reject) => {
    const values = [];
    let remaining = 1; // the extra 1 is released after the loop
    let index = 0;
    for (const item of iterable) {
      const i = index++; // block-scoped: each callback keeps its own index
      remaining++;
      Promise.resolve(item).then((value) => {
        values[i] = value;
        if (--remaining === 0) resolve(values);
      }, reject);
    }
    if (--remaining === 0) resolve(values); // empty input
  });
}
```

Цикл стоит внутри executor. Поэтому не-iterable и ошибка итератора превращаются в отказ, а не в синхронное исключение. `reject` после первого вызова ничего не делает: функции разрешения срабатывают один раз. Отдельный флаг `[[AlreadyCalled]]` на элемент не нужен, потому что `then` у результата `Promise.resolve` вызывает колбэк ровно один раз. Отличие от спецификации одно: вместо `this.resolve` жёстко взят `Promise.resolve`, так что подклассы не поддерживаются (см. задачу 6). Проверено в Node 26 на 8 видах входа — пустой, значения, thenable, отказы, `Set`, строка, не-iterable, бросающий генератор. Результат и число микротиков до завершения совпадают с нативным `Promise.all`.

Сложность: O(n) по времени и памяти.
:::

### 2. allSettled, race, any · средне

Напишите `promiseAllSettled`, `promiseRace` и `promiseAny` с поведением встроенных методов, включая пустой вход.

::: details Решение и разбор
```js
function promiseAllSettled(iterable) {
  return new Promise((resolve) => {
    const results = [];
    let remaining = 1;
    let index = 0;
    const settle = (i, result) => {
      results[i] = result;
      if (--remaining === 0) resolve(results);
    };
    for (const item of iterable) {
      const i = index++;
      remaining++;
      Promise.resolve(item).then(
        (value) => settle(i, { status: 'fulfilled', value }),
        (reason) => settle(i, { status: 'rejected', reason }),
      );
    }
    if (--remaining === 0) resolve(results);
  });
}

function promiseRace(iterable) {
  return new Promise((resolve, reject) => {
    for (const item of iterable) Promise.resolve(item).then(resolve, reject);
  });
}

function promiseAny(iterable) {
  return new Promise((resolve, reject) => {
    const errors = [];
    let remaining = 1;
    let index = 0;
    const rejectAll = () => reject(new AggregateError(errors, 'All promises were rejected'));
    for (const item of iterable) {
      const i = index++;
      remaining++;
      Promise.resolve(item).then(resolve, (reason) => {
        errors[i] = reason;
        if (--remaining === 0) rejectAll();
      });
    }
    if (--remaining === 0) rejectAll();
  });
}
```

`allSettled` можно короче: `promiseAll` над элементами, заранее переведёнными в `{ status, … }` через `then`. Результат тот же, но каждый элемент проходит лишний `then`, и итог приходит на микротик позже нативного. Проверено: прямая версия совпадает с нативной и по результату, и по числу тиков. `race` — единственный комбинатор без счётчика: первый вызов `resolve` или `reject` побеждает, остальные игнорируются. В `any` ошибки лежат в порядке входа, а не завершения. Сообщение `'All promises were rejected'` — то же, что у V8.

Сложность: O(n) по времени и памяти; `race` — O(1) дополнительной памяти.
:::

### 3. Таймаут · средне

Напишите `timeout(promise, ms)`: отклонить с `TimeoutError`, если промис не завершился за `ms`. Затем — `withTimeout(fn, ms, { signal })`, который отменяет саму операцию: `fn` получает сигнал, внешний `signal` тоже отменяет её, а результат отклоняется вовремя, даже если `fn` сигнал игнорирует.

::: details Решение и разбор
```js
function timeout(promise, ms) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DOMException(`Timed out after ${ms} ms`, 'TimeoutError')), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

function withTimeout(fn, ms, { signal } = {}) {
  const deadline = AbortSignal.timeout(ms);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  return new Promise((resolve, reject) => {
    combined.throwIfAborted();
    const onAbort = () => reject(combined.reason); // even if fn ignores the signal
    combined.addEventListener('abort', onAbort, { once: true });
    Promise.try(fn, combined)
      .then(resolve, reject)
      .finally(() => combined.removeEventListener('abort', onAbort));
  });
}

const user = await withTimeout((signal) => fetch('/api/user', { signal }), 5000);
```

`timeout` снимает таймер в `finally`, иначе он сработает впустую. Но операция продолжается: у `timeout` нет доступа к ней. `withTimeout` отменяет её через сигнал и отклоняется причиной сигнала: `TimeoutError` по таймауту, `AbortError` или своя причина — по внешней отмене. `Promise.try` превращает синхронный `throw` из `fn` в отказ. Слушатель снимается в обоих исходах, иначе долгоживущий внешний сигнал копил бы замыкания. Проверено в Node 26: операция, которая игнорирует сигнал и длится 200 мс, при таймауте 50 мс отклоняется через ≈ 50 мс; уже отменённый сигнал отклоняет без вызова `fn`.

Сложность: O(1).
:::

### 4. Пул с лимитом конкурентности · средне

Напишите `mapLimit(items, limit, fn, { signal })`. Не больше `limit` вызовов `fn(item, index, signal)` одновременно. Результаты — в порядке входа. `items` — любой iterable. При первой ошибке новые элементы не берутся, идущие отменяются через сигнал, результат отклоняется этой ошибкой.

::: details Решение и разбор
```js
async function mapLimit(items, limit, fn, { signal } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer');
  const controller = new AbortController();
  const shared = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const iterator = items[Symbol.iterator](); // one iterator shared by all workers
  const results = [];
  let next = 0;

  async function worker() {
    while (true) {
      shared.throwIfAborted(); // do not take new items after a failure or cancel
      const { value, done } = iterator.next();
      if (done) return;
      const i = next++;
      results[i] = await fn(value, i, shared);
    }
  }

  try {
    await Promise.all(Array.from({ length: limit }, worker));
    return results;
  } catch (error) {
    controller.abort(error); // fail fast: cancel the items still running
    throw error;
  }
}
```

`limit` воркеров читают **один** итератор. Освободившийся воркер сразу берёт следующий элемент, так что слоты не простаивают, а вход читается лениво. `next()` вызывается явно, а не через `for...of`: при выходе из `for...of` по исключению итератор закрывается через `return()`. Генератор закрылся бы для всех воркеров сразу — неочевидная связь, лучше обойтись без неё. Если `limit` больше числа элементов, лишние воркеры сразу завершаются. Проверено в Node 26: при `limit = 2` одновременно идут ровно 2 задачи; результаты `[30, 10, 20, 5, 15] → ×2` встают по порядку входа; на ошибке пул отклоняется через ≈ 10 мс, не дожидаясь задач по 50 мс, а идущие получают `abort`; необработанных отказов нет.

Что спросят дальше. **«Дождаться всех»**: обернуть `fn` в `then`, возвращающий `{ status, value/reason }`. **Дождаться, пока отменённые операции действительно остановятся**: после `abort` выполнить `await Promise.allSettled(workers)`, потом пробросить ошибку. **Прогресс**: колбэк после каждого `results[i] = …`. **Приоритеты**: заменить итератор очередью с приоритетом — кучей (heap).

Сложность: O(n) по времени и памяти на результаты; одновременно в работе не больше `limit` операций.
:::

### 5. retry с экспоненциальной задержкой и jitter · средне

Напишите `retry(fn, options)`. `fn(attempt, signal)` повторяется до `retries` раз после первой попытки. Пауза — full jitter: случайная от 0 до `min(maxDelay, baseDelay · 2^attempt)`. Фильтр `shouldRetry(error, attempt)` решает, повторять ли. `signal` прерывает и попытку, и паузу; отмену не повторять. Источник случайности передаётся параметром, чтобы функцию можно было тестировать.

::: details Решение и разбор
```js
// sleep(ms, { signal }) is task 3 of the async/await topic
async function retry(fn, {
  retries = 3, // extra attempts after the first one
  baseDelay = 200,
  maxDelay = 10_000,
  shouldRetry = () => true,
  signal,
  random = Math.random,
} = {}) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn(attempt, signal);
    } catch (error) {
      signal?.throwIfAborted(); // a cancel is not a failure to retry
      if (attempt >= retries || !shouldRetry(error, attempt)) throw error;
      const cap = Math.min(maxDelay, baseDelay * 2 ** attempt);
      await sleep(random() * cap, { signal }); // full jitter
    }
  }
}

const isTransient = (error) =>
  error.name === 'TypeError' || [408, 429, 502, 503, 504].includes(error.status); // TypeError: fetch network failure
const data = await retry((attempt, signal) => getJson('/api/feed', { signal }), {
  shouldRetry: isTransient,
  signal: AbortSignal.timeout(15_000), // overall budget
});
```

`return await` внутри `try` обязателен: без `await` отказ `fn` прошёл бы мимо `catch` (подробно — в теме [async/await, обработка ошибок и отмена](../javascript/async-await.md)). Наружу уходит последняя ошибка, а не обёртка: вызывающий проверит её как обычно. Проверено в Node 26 с `random = () => 1`: паузы между попытками — не меньше 20 и 40 мс при `baseDelay = 20`; потолки при `maxDelay = 8` — 1, 2, 4, 8, 8, 8; отмена во время секундной паузы отклоняет промис через ≈ 30 мс, без новой попытки.

Что спросят дальше. **`Retry-After`**: `shouldRetry` или отдельный колбэк возвращает задержку из заголовка, и она заменяет свою. **Таймаут на попытку**: `retry((attempt, s) => withTimeout((t) => fn(attempt, t), 3000, { signal: s }))`. **Все ошибки**: собрать их в массив и бросить `AggregateError`. **Circuit breaker**: после серии сбоев перестать обращаться к сервису на время.

Сложность: O(retries) попыток, O(1) по памяти.
:::

### 6. Свой Promise: finally и статические методы · сложно

Возьмите `MyPromise` из задачи 5 темы [Промисы](../javascript/promises.md): конструктор, `then`, `catch`. Добавьте `finally`, статические `resolve`, `reject`, `withResolvers` и `all` с поддержкой подклассов: `Sub.all([...])` возвращает `Sub`. Затем проверьте реализацию набором тестов Promises/A+.

::: details Решение и разбор
```js
// Added to the body of class MyPromise
finally(onFinally) {
  if (typeof onFinally !== 'function') return this.then(onFinally, onFinally);
  const C = this.constructor;
  return this.then(
    (value) => C.resolve(onFinally()).then(() => value),
    (reason) => C.resolve(onFinally()).then(() => { throw reason; }),
  );
}

static resolve(value) {
  const isOwn = typeof value === 'object' && value !== null && #state in value; // brand check
  if (isOwn && value.constructor === this) return value;
  return new this((resolve) => resolve(value));
}

static reject(reason) {
  return new this((_, reject) => reject(reason));
}

static withResolvers() {
  let resolve, reject;
  const promise = new this((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

static all(iterable) {
  const C = this;
  return new C((resolve, reject) => {
    const promiseResolve = C.resolve; // read once, before iterating
    if (typeof promiseResolve !== 'function') throw new TypeError('C.resolve is not a function');
    const values = [];
    let remaining = 1;
    let index = 0;
    for (const item of iterable) {
      const i = index++;
      remaining++;
      promiseResolve.call(C, item).then((value) => {
        values[i] = value;
        if (--remaining === 0) resolve(values);
      }, reject);
    }
    if (--remaining === 0) resolve(values);
  });
}
```

- **`finally`** пропускает результат насквозь и ждёт промис, который вернул колбэк. Переопределить результат он может только отказом. Пустой `finally()` ведёт себя как `then()`, как в спецификации.
- **`resolve`** возвращает аргумент как есть, только если это промис **того же** конструктора: `Sub.resolve(myPromise)` завернёт его в `Sub`. `#state in value` — эргономичная проверка бренда (ES2022): она отличает настоящий `MyPromise` от объекта, который просто подделал `constructor`.
- **`all`** — задача 1, где `Promise` заменён на `this`, а `C.resolve` прочитан один раз до обхода. Так у нативного метода (проверено в Node 26 геттером на подклассе).
- **Проверка.** Набор `promises-aplus-tests` (872 теста) подключается адаптером `{ resolved: (v) => MyPromise.resolve(v), rejected: (r) => MyPromise.reject(r), deferred: () => MyPromise.withResolvers() }`. Набор покрывает только `then`, но ловит ошибки разворачивания thenable: геттер `then`, который бросает, повторные вызовы `resolve`. Статику и `finally` проверяют своими тестами: `finally(() => 2)` даёт исходное значение, `finally(() => { throw e })` отклоняется `e`, `MyPromise.all(5)` отклоняется `TypeError`, промисы обоих классов проходят через `await` и `Promise.all` в обе стороны.
- **Ограничение.** `then` базового класса создаёт `new MyPromise`, а не `new this.constructor[Symbol.species]`. Поэтому `Sub.resolve(1).finally(…)` вернёт `MyPromise`, а не `Sub`. Species на интервью спрашивают редко, но знать о нём стоит.

Сложность: `all` — O(n); остальные методы — O(1).
:::

## Источники

- [ECMAScript — `Promise.all`](https://tc39.es/ecma262/#sec-promise.all), [`Promise.allSettled`](https://tc39.es/ecma262/#sec-promise.allsettled), [`Promise.any`](https://tc39.es/ecma262/#sec-promise.any), [`Promise.race`](https://tc39.es/ecma262/#sec-promise.race), [`GetPromiseResolve`](https://tc39.es/ecma262/#sec-getpromiseresolve)
- [ECMAScript — `AggregateError`](https://tc39.es/ecma262/#sec-aggregate-error-objects) и [`Promise.prototype.finally`](https://tc39.es/ecma262/#sec-promise.prototype.finally)
- [Promises/A+](https://promisesaplus.com/) и [набор тестов `promises-aplus-tests`](https://github.com/promises-aplus/promises-tests)
- [DOM Standard — `AbortController` и `AbortSignal`](https://dom.spec.whatwg.org/#aborting-ongoing-activities)
- [MDN — `AbortSignal.timeout()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static) и [`AbortSignal.any()`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static)
- [MDN — `Promise.try()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/try) и [`Promise.withResolvers()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers)
- [RFC 9110 — `Retry-After`](https://www.rfc-editor.org/rfc/rfc9110#field.retry-after) и [RFC 6585 — `429 Too Many Requests`](https://www.rfc-editor.org/rfc/rfc6585#section-4)
- [AWS Architecture Blog — Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [`p-limit`](https://github.com/sindresorhus/p-limit) и [`p-retry`](https://github.com/sindresorhus/p-retry)
