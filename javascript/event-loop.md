---
title: Event loop
level: ядро
---

# Event loop

> **Коротко.** JavaScript выполняет код в одном потоке, и каждый кусок кода работает до конца (run-to-completion): его ничто не прерывает. Event loop (цикл событий) — механизм хоста (браузера, Node), который решает, что выполнять следующим. Он берёт одну задачу (task) из очереди, выполняет её, затем **полностью** опустошает очередь микрозадач (microtasks: промисы, `queueMicrotask`, `MutationObserver`) и время от времени отдаёт кадр рендерингу: `requestAnimationFrame`, стили, layout, отрисовка. Отсюда вытекают порядок `console.log`, `Promise.then` и `setTimeout`, «зависания» страницы и `nextTick` во Vue.

**Связанные темы:** [Область видимости и hoisting](./scope-and-hoisting.md), [Итераторы и генераторы](./iterators-and-generators.md), [Промисы](./promises.md), [async/await, обработка ошибок и отмена](./async-await.md), [Модули: ESM и CommonJS](./modules.md), [От ввода URL до отображения страницы](../browser/from-url-to-pixels.md), [Конвейер рендеринга: layout, paint, composite](../browser/rendering-pipeline.md), [DOM API и observers](../browser/dom.md), [События и событийная модель](../browser/events.md), [Web Workers, Service Workers и PWA](../browser/workers.md)

## Теория

### Кто определяет event loop

В спецификации ECMAScript нет слов «event loop». Язык определяет только **задания** (jobs) — например, реакцию промиса — и просит хост поставить их в очередь через `HostEnqueuePromiseJob`. Ещё язык гарантирует, что задание запускается, только когда стек вызовов пуст. Сам цикл, очереди, таймеры и рендеринг описаны в HTML Living Standard (для браузера) и в документации libuv/Node.

Поэтому «как работает event loop» — вопрос про хост. Ответ для браузера и для Node различается в деталях, но общая модель одна:

1. Есть **стек вызовов** (call stack). Синхронный код выполняется на нём до конца.
2. Есть **очереди задач** (task queues). Задачи туда ставят таймеры, события ввода, сеть, `postMessage`. Термин «макрозадача» (macrotask) — жаргон: в спецификации это просто task.
3. Есть **одна очередь микрозадач** (microtask queue). Её опустошают каждый раз, когда стек становится пустым.

### Один оборот цикла в браузере

Упрощённо, по HTML Living Standard:

1. Выбрать очередь задач с готовой задачей (какую — решает браузер) и взять из неё **самую старую** задачу.
2. Выполнить её до конца.
3. **Microtask checkpoint:** выполнять микрозадачи, пока очередь не опустеет, — включая те, что добавились по ходу. Затем сообщить о необработанных отказах промисов (`unhandledrejection`).
4. Если пришло время кадра (обычно раз в ~16,7 мс при 60 Гц, и только если есть что рисовать), выполнить **update the rendering**: события `resize` и `scroll`, медиазапросы, анимации, колбэки `requestAnimationFrame`, пересчёт стилей и layout, `ResizeObserver`, `IntersectionObserver`, отрисовку.
5. Если делать нечего — колбэки `requestIdleCallback`.

> [!NOTE]
> В актуальной редакции стандарта обновление рендеринга — это тоже задача: параллельный шаг ставит её в очередь rendering task source при каждой «возможности отрисовки» (rendering opportunity). На наблюдаемый порядок это не влияет: перед кадром всё равно выполнились все микрозадачи, а между двумя задачами кадр может случиться, а может и нет.

Из этой модели следуют три правила, на которых держатся почти все вопросы:

- **Между двумя задачами всегда выполняются все микрозадачи.** Промис, разрешённый в задаче, обработается раньше любого таймера.
- **Рендеринг не может вклиниться в задачу или в цепочку микрозадач.** Если поменять DOM десять раз за задачу, пользователь увидит только итоговое состояние.
- **Очереди задач неравноправны.** Браузер может отдавать приоритет вводу пользователя перед таймерами. Порядок гарантирован только внутри одного источника: два `setTimeout(fn, 0)` выполнятся в порядке вызова.

### Микрозадачи

Источники микрозадач: реакции промисов (`then`, `catch`, `finally`, продолжение после `await`), `queueMicrotask(fn)`, `MutationObserver` (подробно — [DOM API и observers](../browser/dom.md)).

Важное следствие правила «опустошать до конца»: микрозадача, которая ставит новую микрозадачу, не отдаёт управление никогда. Бесконечная цепочка `then` или рекурсивный `queueMicrotask` вешают страницу так же, как `while (true)`: ни таймеры, ни клики, ни рендеринг не получат ход. Это называется голоданием (starvation).

Микрозадачи выполняются не только между задачами. По стандарту чекпоинт делается в шаге **clean up after running script**: всякий раз, когда стек JavaScript опустел после вызова колбэка. Поэтому при **настоящем** клике микрозадачи успевают выполниться между двумя обработчиками одного события: браузер вызывает каждый обработчик с пустого стека. При `element.click()` из скрипта стек не пуст, и микрозадачи ждут конца всего скрипта (см. задачу 3).

### Сколько тиков стоит `await`

«Тик» здесь — одна микрозадача. Цены, которые полезно помнить (после оптимизации `await` в ES2019, V8 7.2+):

| Конструкция | Через сколько микрозадач продолжится код |
| --- | --- |
| `promise.then(cb)` на выполненном промисе | 1 |
| `await value` или `await nativePromise` | 1 |
| `resolve(nativePromise)` в `new Promise`, затем `then(cb)` | 3: задание `NewPromiseResolveThenableJob` подписывается через `then`, и только потом промис разрешается |
| `return nativePromise` в `async`-функции, затем `then(cb)` на её результате | 3 по той же причине; с `return await nativePromise` — 2 |
| `await thenable` (не настоящий промис) | 2: `thenable.then` вызывается в отдельном задании |

Знать точное число тиков в продакшен-коде не нужно — полагаться на него хрупко. Но на интервью задачи «в каком порядке выведется» проверяют как раз это (см. задачу 2).

> [!WARNING]
> До ES2019 `await` стоил три тика, и старые статьи и ответы на Stack Overflow дают порядок, который в современных движках уже не воспроизводится. Сверяйтесь с актуальным движком, а не со статьёй 2018 года.

### Таймеры

`setTimeout(fn, ms)` не выполняет `fn` через `ms`. Он ставит задачу в очередь **не раньше**, чем через `ms`. Дальше задача ждёт своей очереди: текущую задачу, все микрозадачи, возможно кадр рендеринга и задачи из других источников.

- Задержка `0` значит «как можно скорее, но в следующей задаче».
- По стандарту, если таймеры вложены глубже 5 уровней (таймер ставит таймер и так далее, включая `setInterval`), задержка меньше 4 мс поднимается до 4 мс. Цепочка `setTimeout(…, 0)` поэтому не может выполняться чаще ~250 раз в секунду.
- В фоновых вкладках браузеры сильно троттлят таймеры: до раза в секунду и реже.
- `setInterval` не догоняет пропущенные срабатывания. Если колбэк дольше интервала, срабатывания просто съезжают.

### `requestAnimationFrame` и рендеринг

`requestAnimationFrame(cb)` выполняет `cb` **перед следующей отрисовкой**, в шаге update the rendering, — один раз на кадр и с временем кадра в аргументе. Поэтому анимации и чтение-запись layout делают в rAF, а не в `setTimeout`: таймер не синхронизирован с частотой экрана. Он может выпасть дважды на один кадр (лишняя работа) или ни разу (пропуск кадра). Во вкладке, которая не видна, rAF не вызывается вовсе.

Колбэк rAF, поставленный внутри rAF, выполнится в **следующем** кадре: список колбэков фиксируется перед запуском. На этом основан приём «двойной rAF» — дождаться, пока браузер действительно отрисует состояние (например, перед запуском CSS-перехода).

### Долгие задачи и отзывчивость

Пока задача выполняется, браузер не обработает клик и не нарисует кадр. Задача дольше 50 мс считается **долгой** (long task) и попадает в Long Tasks API. От таких задач страдает метрика INP (Interaction to Next Paint). Лечение — разбить работу на куски и между ними **отдавать управление главному потоку** (yield to main):

- `await new Promise((r) => setTimeout(r, 0))` — работает везде, но продолжение встаёт в **конец** очереди, а на глубине вложенности 5+ ловит минимум в 4 мс;
- `await scheduler.yield()` — продолжение получает повышенный приоритет и выполняется раньше других задач того же приоритета; `scheduler.postTask(fn, { priority })` — задачи с приоритетами `user-blocking`, `user-visible`, `background`;
- перенос вычислений в [Web Worker](../browser/workers.md) — у воркера свой event loop и свой поток.

`await Promise.resolve()` управление **не** отдаёт: это микрозадача, она выполнится до рендеринга и до обработки ввода.

> [!NOTE]
> `scheduler.yield()` и `scheduler.postTask()` есть в Chromium (с 129 и 94) и Firefox (с 142), в Safari их нет (сверено по MDN browser-compat-data 2026-11-11). Нужен запасной вариант через `setTimeout` или `MessageChannel`.

### Event loop в Node.js

Node построен на libuv, и его цикл разбит на **фазы**. В каждой фазе своя очередь колбэков:

1. **timers** — `setTimeout`, `setInterval`;
2. **pending callbacks** — отложенные системные колбэки;
3. **poll** — ожидание и обработка I/O (большинство колбэков `fs`, сети);
4. **check** — `setImmediate`;
5. **close callbacks** — `socket.on('close')` и т. п.

После **каждого** колбэка (с Node 11 — так же, как в браузере) Node опустошает две очереди: сначала `process.nextTick`, затем микрозадачи промисов. Отличия от браузера, о которых спрашивают:

- `process.nextTick` в CommonJS выполняется раньше `Promise.then`. В ES-модуле верхнего уровня порядок обратный: модуль сам исполняется внутри промисного задания, и его микрозадачи опустошаются раньше очереди `nextTick`.
- `setTimeout(fn, 0)` против `setImmediate(fn)` в главном модуле — порядок **не определён**: он зависит от того, истекла ли 1 мс к входу в фазу timers. Внутри I/O-колбэка `setImmediate` всегда первый: после poll идёт check, а timers — только на следующем обороте.
- Рекурсивный `process.nextTick` морит голодом весь цикл, как и бесконечные микрозадачи.

### Vue: пакетные обновления и `nextTick`

Vue не перерисовывает компонент на каждое изменение состояния. Изменение ставит **задание** (job) компонента в очередь планировщика с дедупликацией. Первая постановка планирует сброс (flush) очереди микрозадачей: в исходниках 3.5.45 это `resolvedPromise.then(flushJobs)`. Поэтому:

- десять присваиваний за один синхронный кусок кода дают **один** рендер;
- DOM обновляется асинхронно, но **до** отрисовки кадра — пользователь не видит промежуточного состояния;
- `nextTick()` возвращает промис текущего сброса (`currentFlushPromise || resolvedPromise`). `await nextTick()` продолжится, когда DOM уже обновлён;
- задания сортируются по `id` компонента: родитель создан раньше дочернего и обновляется первым, а дочерний компонент, размонтированный родителем, не рендерится зря;
- `watch` с `flush: 'pre'` (по умолчанию) выполняется в том же сбросе до рендера, `flush: 'post'` — после обновления DOM, `flush: 'sync'` — синхронно, в обход очереди.

> [!TIP]
> «Почему в тесте DOM ещё старый» — почти всегда пропущенный `await nextTick()` (или `await` у `wrapper.setValue`/`trigger` в Vue Test Utils: они возвращают именно `nextTick()`).

## Примеры

```js
// Classic order: sync → microtasks → tasks.
console.log('script start');

setTimeout(() => console.log('timeout'), 0);

Promise.resolve()
  .then(() => console.log('then 1'))
  .then(() => console.log('then 2'));

queueMicrotask(() => console.log('microtask'));

console.log('script end');
// script start, script end, then 1, microtask, then 2, timeout
```

```js
// Starvation: the page freezes, the timer never fires.
setTimeout(() => console.log('never'), 0);
function spin() {
  queueMicrotask(spin);
}
spin();
```

```js
// A frame-synced animation instead of setTimeout(step, 16).
function animate(el, duration) {
  const start = performance.now();
  function frame(now) {
    const progress = Math.min((now - start) / duration, 1);
    el.style.transform = `translateX(${progress * 300}px)`;
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
```

```js
// Vue: batched updates and nextTick.
import { ref, nextTick } from 'vue';

const count = ref(0);

async function increment() {
  count.value++;
  count.value++;            // still one render
  console.log(el.textContent); // old value: the DOM is not updated yet
  await nextTick();
  console.log(el.textContent); // new value
}
```

## Вопросы с интервью

::: details Что такое event loop и зачем он нужен, если JavaScript однопоточный
JavaScript выполняет код на одном потоке и одном стеке, и каждый кусок выполняется до конца (run-to-completion). Асинхронность обеспечивает хост: таймеры, сеть и ввод работают вне JS-потока, а когда результат готов, ставят колбэк в очередь задач. Event loop в цикле берёт задачу, выполняет её, опустошает очередь микрозадач и при необходимости рисует кадр. Однопоточность даёт простую модель без гонок данных внутри кода: между двумя строками синхронного кода ничего не произойдёт. Цена — любой долгий синхронный кусок блокирует и ввод, и отрисовку. Сам ECMAScript описывает только задания (jobs) и требование пустого стека; цикл определяет HTML Living Standard или libuv в Node.
:::

::: details Чем микрозадача отличается от задачи
Задача (task, на жаргоне «макрозадача») — единица работы цикла: колбэк таймера, событие ввода, сообщение `postMessage`, ответ сети. За один оборот берётся **одна** задача. Микрозадача — реакция промиса, `queueMicrotask`, `MutationObserver`. Очередь микрозадач опустошается **целиком**, включая добавленные по ходу, каждый раз, когда стек пуст: после задачи и после каждого колбэка, вызванного браузером. Следствия: промис обработается раньше любого таймера; между микрозадачами не бывает рендеринга и ввода; бесконечная цепочка микрозадач вешает страницу, а бесконечная цепочка `setTimeout` — нет.
:::

::: details Где в цикле рендеринг и когда срабатывает requestAnimationFrame
Рендеринг — шаг update the rendering. Браузер выполняет его, когда есть возможность отрисовки (обычно раз в кадр, ~16,7 мс при 60 Гц) и есть что рисовать, — всегда **после** задачи и всех микрозадач. Внутри шага: `resize`/`scroll`, анимации, колбэки rAF, пересчёт стилей и layout, `ResizeObserver`, `IntersectionObserver`, отрисовка. Значит, rAF выполняется перед отрисовкой кадра, один раз на кадр, и не выполняется в скрытой вкладке. Анимация на `setTimeout(…, 16)` не синхронизирована с экраном: то два шага на кадр, то пропуск, — отсюда рывки. rAF внутри rAF выполнится уже в следующем кадре.
:::

::: details Почему setTimeout с нулевой задержкой не выполняется сразу
Задержка — это минимальное время до постановки задачи в очередь, а не время выполнения. После этого задача ждёт: текущий синхронный код, все микрозадачи, возможный кадр рендеринга, задачи из других источников. Кроме того, по стандарту при вложенности таймеров глубже 5 уровней задержка меньше 4 мс поднимается до 4 мс. В фоновых вкладках браузеры троттлят таймеры до раза в секунду и реже. Поэтому `setTimeout` — инструмент «выполнить позже, отдав управление», а не точный таймер. Для синхронизации с кадром есть rAF, для измерения времени — `performance.now()`.
:::

::: details Как выполнить тяжёлое вычисление и не заморозить интерфейс
Варианты по возрастанию надёжности. Первый — разбить работу на куски и между ними отдавать управление главному потоку: `await scheduler.yield()` (продолжение получает приоритет) с запасным вариантом через `setTimeout`/`MessageChannel`. Кусок ограничивают бюджетом времени, а не числом элементов, — несколько миллисекунд, заведомо меньше 50 мс (порог долгой задачи). `await Promise.resolve()` не подходит: это микрозадача, она не пропустит ни ввод, ни рендеринг. Второй — `requestIdleCallback` для фоновой некритичной работы. Третий — Web Worker: отдельный поток со своим event loop, главный поток свободен полностью; цена — сериализация данных (`structuredClone`) или `Transferable`, и в воркере нет DOM. Для тяжёлых списков во Vue часто правильнее не считать меньше, а рендерить меньше — виртуализация.
:::

::: details Чем event loop Node.js отличается от браузерного
У Node цикл libuv разбит на фазы: timers → pending callbacks → poll (I/O) → check (`setImmediate`) → close callbacks. Рендеринга нет. После каждого колбэка Node опустошает сначала очередь `process.nextTick`, затем микрозадачи промисов (с Node 11 — после каждого колбэка, раньше — после каждой фазы). Типовые ловушки: `setTimeout(0)` против `setImmediate` в главном модуле — порядок не определён, а внутри I/O-колбэка `setImmediate` всегда первый. `nextTick` в CommonJS раньше промисов, но в ES-модуле верхнего уровня — позже. Рекурсивный `nextTick` блокирует I/O. Документация Node советует предпочитать `queueMicrotask` или `setImmediate`, а не `nextTick`.
:::

::: details Как Vue пакетирует обновления и что делает nextTick
Изменение реактивного состояния не перерисовывает компонент сразу. Эффект рендера ставит задание компонента в очередь планировщика (повторная постановка игнорируется) и, если сброс ещё не запланирован, планирует его одной микрозадачей через `Promise.resolve().then(flushJobs)`. В сбросе задания сортируются по `id` (родители раньше детей), затем выполняются pre-watchers, рендеры, а после — post-колбэки (`flush: 'post'`, `onUpdated`, `onMounted`). Поэтому несколько изменений подряд дают один рендер, а DOM обновляется до отрисовки кадра. `nextTick()` возвращает промис текущего сброса: после `await nextTick()` DOM уже актуален. Vue 2 выбирал между `Promise`, `MutationObserver`, `setImmediate` и `setTimeout`; Vue 3 использует только промис.
:::

::: details Может ли страница зависнуть без единого цикла while
Может. Очередь микрозадач опустошается до конца, включая новые, поэтому микрозадача, которая ставит микрозадачу, никогда не отдаёт управление: `function loop() { queueMicrotask(loop) }` или промисная цепочка, которая бесконечно сама себя продолжает. Таймеры, ввод и рендеринг при этом не получают хода — для пользователя это то же самое, что `while (true)`. То же в Node с рекурсивным `process.nextTick`. Рекурсия через `setTimeout` или `scheduler.yield` страницу не вешает: каждое продолжение — новая задача, и между ними цикл успевает всё остальное.
:::

## Задачи

### 1. Порядок вывода: таймеры и промисы · легко

Что выведет код?

```js
console.log('A');
setTimeout(() => console.log('B'), 0);
Promise.resolve()
  .then(() => {
    console.log('C');
    setTimeout(() => console.log('D'), 0);
  })
  .then(() => console.log('E'));
queueMicrotask(() => console.log('F'));
console.log('G');
```

::: details Решение и разбор
```text
A G C F E B D
```

- Синхронно: `A`, `G`. Таймер `B` уже в очереди задач, а в очереди микрозадач — `C` и `F` (в порядке постановки).
- `C` печатается и ставит таймер `D` **после** `B`. Её завершение ставит в микрозадачи `E` — за `F`.
- `F`, затем `E`: очередь микрозадач опустошается до конца.
- Только теперь задачи: `B`, потом `D`.
:::

### 2. `await` и `return` промиса · средне

Что выведет код?

```js
async function a() {
  console.log('a1');
  await b();
  console.log('a2');
}

async function b() {
  console.log('b');
  return Promise.resolve();
}

console.log('start');
setTimeout(() => console.log('timeout'));
a();
new Promise((resolve) => {
  console.log('executor');
  resolve();
})
  .then(() => console.log('then1'))
  .then(() => console.log('then2'))
  .then(() => console.log('then3'))
  .then(() => console.log('then4'));
console.log('end');
```

::: details Решение и разбор
```text
start a1 b executor end then1 then2 a2 then3 then4 timeout
```

- Синхронно выполняются тело `a` до `await`, тело `b` целиком и executor промиса: `start a1 b executor end`.
- `b` возвращает промис из `async`-функции, поэтому промис `b()` разрешается этим промисом. Это задание `NewPromiseResolveThenableJob`: тик 1 — подписка через `then`, тик 2 — промис `b()` выполнен. `await` на уже выполненном промисе — ещё тик, и `a2` выполняется на тике 3.
- Цепочка `then` идёт по тику на звено: `then1` (1), `then2` (2), `then3` (3). На тике 3 продолжение `a` встало в очередь раньше, чем `then3`, поэтому `a2` перед `then3`.
- Если в `b` написать `return await Promise.resolve()`, `a2` выведется сразу после `then1`: промис `b()` разрешается обычным значением. А если `b` ничего не возвращает, `a2` выйдет первой из микрозадач, ещё до `then1`.
- `timeout` — последним: это задача, а всё остальное — микрозадачи.

Вывод: `return promise` в `async`-функции стоит лишних тиков. На порядок тиков нельзя опираться в коде, но на интервью проверяют именно его.
:::

### 3. Настоящий клик против `element.click()` · средне

Что выведется при клике мышью по кнопке? А если вместо клика вызвать `button.click()` из скрипта?

```js
button.addEventListener('click', () => {
  Promise.resolve().then(() => console.log('microtask 1'));
  console.log('listener 1');
});

button.addEventListener('click', () => {
  Promise.resolve().then(() => console.log('microtask 2'));
  console.log('listener 2');
});
```

::: details Решение и разбор
```text
Клик мышью:      listener 1, microtask 1, listener 2, microtask 2
button.click():  listener 1, listener 2, microtask 1, microtask 2
```

- Микрозадачи выполняются, когда опустел стек JavaScript (шаг clean up after running script), а не только между задачами.
- При клике мышью браузер вызывает каждый обработчик со своего пустого стека. После `listener 1` стек пуст, и `microtask 1` выполняется до `listener 2`.
- `button.click()` синхронно диспетчеризует событие **внутри** вызывающего скрипта. Между обработчиками на стеке остаётся код, вызвавший `click()`, поэтому микрозадачи ждут, пока он закончится.
- Практическое следствие: тест, который симулирует событие через `dispatchEvent`/`click()`, может видеть другой порядок, чем пользователь. Код, который зависит от этого порядка, хрупок: решения о событии (`preventDefault`, `stopPropagation`) принимают синхронно в обработчике, а не в `then`.
:::

### 4. Обработка большого массива без долгих задач · средне

Напишите `processInChunks(items, fn, { budget, signal })`: вызывает `fn` для каждого элемента и отдаёт управление главному потоку, когда кусок работы превысил бюджет в миллисекундах. Поддержите отмену через `AbortSignal`.

::: details Решение и разбор
```js
function yieldToMain() {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function processInChunks(items, fn, { budget = 8, signal } = {}) {
  let deadline = performance.now() + budget;
  for (let i = 0; i < items.length; i++) {
    signal?.throwIfAborted();
    fn(items[i], i);
    if (performance.now() >= deadline) {
      await yieldToMain();
      deadline = performance.now() + budget;
    }
  }
}

const controller = new AbortController();
await processInChunks(rows, indexRow, { signal: controller.signal });
```

- Бюджет по времени, а не по числу элементов: стоимость `fn` заранее неизвестна. 8 мс оставляют кадру место на рендеринг и держат задачу далеко от порога в 50 мс.
- `performance.now()` проверяется на каждом элементе — это дёшево. Если `fn` совсем мелкая, проверку можно делать раз в N элементов.
- `scheduler.yield()` ставит продолжение впереди обычных задач, поэтому работа не «теряется» в конце очереди. Запасной `setTimeout(0)` после 5 уровней вложенности получает минимум в 4 мс: продолжение после `await` выполняется внутри задачи таймера, и следующий `setTimeout` считается вложенным. Без этой задержки можно обойтись через `MessageChannel`.
- `await Promise.resolve()` вместо `yieldToMain` сломал бы решение: микрозадача не пропускает ни ввод, ни рендеринг.
- Отмена проверяется перед каждым элементом, `throwIfAborted` бросает `signal.reason`.

Сложность: O(n) вызовов `fn`; число отдач управления ≈ общее время / бюджет.
:::

### 5. Планировщик в стиле Vue: `queueJob` и `nextTick` · сложно

Реализуйте минимальный планировщик:

- `queueJob(job)` — ставит функцию с полем `id` в очередь. Повторная постановка игнорируется, очередь отсортирована по `id`, сброс — одной микрозадачей;
- если задание во время сброса ставит новое, оно выполняется в этом же сбросе;
- ошибка одного задания не мешает остальным;
- `nextTick(fn?)` — промис, который выполняется после текущего сброса.

::: details Решение и разбор
```js
const queue = [];
const queued = new Set();
const resolvedPromise = Promise.resolve();
let flushPromise = null;
let flushIndex = -1;

export function queueJob(job) {
  if (queued.has(job)) return;
  queued.add(job);
  // keep the queue sorted by id; never insert before the job being flushed
  let i = flushIndex + 1;
  while (i < queue.length && queue[i].id <= job.id) i++;
  queue.splice(i, 0, job);
  flushPromise ??= resolvedPromise.then(flushJobs);
}

function flushJobs() {
  try {
    for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
      const job = queue[flushIndex];
      queued.delete(job); // the job may queue itself again
      try {
        job();
      } catch (error) {
        console.error(error);
      }
    }
  } finally {
    queue.length = 0;
    queued.clear();
    flushIndex = -1;
    flushPromise = null;
  }
}

export function nextTick(fn) {
  const p = flushPromise ?? resolvedPromise;
  return fn ? p.then(fn) : p;
}
```

```js
const child = () => console.log('render child');
child.id = 2;
const parent = () => {
  console.log('render parent');
  queueJob(child); // already queued: ignored
};
parent.id = 1;

queueJob(child);
queueJob(parent);
queueJob(parent);
nextTick(() => console.log('DOM is up to date'));
// render parent, render child, DOM is up to date
```

- Один `flushPromise` на сброс — это и есть пакетирование: сколько бы раз ни вызвали `queueJob` синхронно, сброс будет один и выполнится микрозадачей, то есть до отрисовки кадра.
- `nextTick` подписывается на тот же промис, поэтому колбэк выполняется после всех заданий. Колбэк, переданный до первого `queueJob`, ждёт пустой промис и выполнится раньше сброса — во Vue так же.
- Вставка с `flushIndex + 1` не даёт поставить новое задание перед уже выполненными: иначе оно бы потерялось.
- Сортировка по `id` гарантирует, что родитель рендерится раньше детей. Если родитель удалит дочерний компонент, Vue пометит его задание как неактивное, и оно не выполнится.
- Чего здесь нет по сравнению с Vue 3.5: флаги заданий вместо `Set`, pre-задания (watchers с `flush: 'pre'`), очередь post-колбэков, защита от бесконечной рекурсии (`RECURSION_LIMIT = 100`) и вызов через `callWithErrorHandling`, который передаёт ошибку в `app.config.errorHandler`.

Сложность: O(n) на вставку (поиск позиции и `splice`; Vue ищет позицию бинарным поиском, но сдвиг массива остаётся O(n)), O(n) на сброс.
:::

## Источники

- [HTML Living Standard: Event loop processing model](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model), [Microtask queue](https://html.spec.whatwg.org/multipage/webappapis.html#microtask-queue), [Perform a microtask checkpoint](https://html.spec.whatwg.org/multipage/webappapis.html#perform-a-microtask-checkpoint), [Clean up after running script](https://html.spec.whatwg.org/multipage/webappapis.html#clean-up-after-running-script), [Update the rendering](https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering), [Timers](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers)
- [ECMAScript: Jobs and Host Operations to Enqueue Jobs](https://tc39.es/ecma262/#sec-jobs), [HostEnqueuePromiseJob](https://tc39.es/ecma262/#sec-hostenqueuepromisejob), [NewPromiseResolveThenableJob](https://tc39.es/ecma262/#sec-newpromiseresolvethenablejob), [Await](https://tc39.es/ecma262/#await), [Agents](https://tc39.es/ecma262/#sec-agents)
- [MDN: In depth: Microtasks and the JavaScript runtime environment](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide/In_depth), [Using microtasks with queueMicrotask()](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide), [setTimeout](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout), [requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame), [Scheduler.yield](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield), [Prioritized Task Scheduling API](https://developer.mozilla.org/en-US/docs/Web/API/Prioritized_Task_Scheduling_API)
- [Node.js: The Node.js Event Loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick), [Understanding process.nextTick()](https://nodejs.org/en/learn/asynchronous-work/understanding-processnexttick), [process.nextTick](https://nodejs.org/api/process.html#processnexttickcallback-args)
- [Vue: nextTick](https://vuejs.org/api/general.html#nexttick), [Watchers — Callback Flush Timing](https://vuejs.org/guide/essentials/watchers.html#callback-flush-timing); исходники Vue core 3.5.45: [`scheduler.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/scheduler.ts)
- [V8: Faster async functions and promises](https://v8.dev/blog/fast-async)
- [Jake Archibald: Tasks, microtasks, queues and schedules](https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/)
- [web.dev: Optimize long tasks](https://web.dev/articles/optimize-long-tasks)
