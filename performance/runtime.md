---
title: Оптимизация runtime и профилирование
level: ядро
---

# Оптимизация runtime и профилирование

> **Коротко.** Пока выполняется задача, браузер не обработает ввод и не нарисует кадр. Поэтому в runtime оптимизируют не «скорость кода» вообще, а **длину задач** на главном потоке. Задачу дольше 50 мс разбивают на куски и между ними отдают управление (yield): `scheduler.yield()` с запасным `setTimeout`, `scheduler.postTask()` с приоритетами, `requestIdleCallback` для фона. В обработчике ввода сначала делают визуальный отклик, а остальное переносят за кадр. Рендерят меньше (виртуализация, `content-visibility`), тяжёлые вычисления уносят в воркер. Искать проблему нужно в DevTools Performance с замедлением CPU, по flame chart и Bottom-Up, а свои участки размечать через User Timing.

**Связанные темы:** [Event loop](../javascript/event-loop.md), [Конвейер рендеринга: layout, paint, composite](../browser/rendering-pipeline.md), [Web Workers, Service Workers и PWA](../browser/workers.md), [Память и сборка мусора](../javascript/memory-and-gc.md), [Core Web Vitals и измерение](./web-vitals.md), [Оптимизация загрузки](./loading.md), [UI-coding: автокомплит, таблица, дерево](../live-coding/ui-widgets.md)

## Теория

### Бюджеты: 16 мс, 50 мс, 100 мс

Три числа объясняют почти все советы этой темы:

| Бюджет | Откуда | Что значит |
| --- | --- | --- |
| ≈ 16,7 мс | кадр при 60 Гц | вся работа кадра (JS, style, layout, paint) для плавной анимации и прокрутки |
| 50 мс | порог долгой задачи (Long Tasks API, TBT) | ввод, пришедший в начале задачи, ждёт её конца |
| 100 мс | восприятие отклика (модель RAIL) | реакция быстрее воспринимается как мгновенная; 50 мс задачи + 50 мс обработки укладываются в 100 |

Задача дольше 50 мс — **долгая** (long task). Всё сверх 50 мс — её **блокирующая** часть, из этих частей складывается лабораторная TBT. В поле страдает **INP**: время от ввода до следующего кадра раскладывается на три фазы. Метрики подробно разобраны в «[Core Web Vitals и измерении](./web-vitals.md)», здесь — что делать с каждой фазой:

| Фаза INP | Кто виноват | Лечение |
| --- | --- | --- |
| Input delay | чужая долгая задача: гидрация, исполнение бандла, аналитика, таймеры | разбить и отложить работу при загрузке, ленивая гидрация, меньше JS, сторонние скрипты — после интерактивности |
| Processing | сами обработчики и синхронный ре-рендер фреймворка | в обработчике — только визуальный отклик, остальное после yield; не делать лишнего; воркер |
| Presentation delay | style, layout, paint после обработчиков; огромный DOM; layout thrashing | меньше DOM (виртуализация), `content-visibility`, дешёвые свойства, без forced layout |

Механика долгих задач, микрозадач и шага update the rendering — в «[Event loop](../javascript/event-loop.md)». Layout thrashing, слои и дешёвые анимации (`transform`, `opacity`) — в «[Конвейере рендеринга](../browser/rendering-pipeline.md)». Здесь эти темы только используются.

### Разбиение работы: чем отдавать управление

JavaScript выполняется до завершения (run-to-completion): функция, вызвавшая десять функций, — это одна задача. Чтобы браузер мог вклиниться, продолжение должно стать **новой задачей**. Микрозадача (`await Promise.resolve()`) не подходит: очередь микрозадач опустошается до ввода и рендеринга.

| Способ | Куда встаёт продолжение | Поддержка (MDN BCD) |
| --- | --- | --- |
| `setTimeout(fn, 0)` | в конец очереди таймеров; после 5 уровней вложенности — не раньше 4 мс | везде |
| `MessageChannel` | задача без задержки в 4 мс, тоже в конец своей очереди | везде |
| `await scheduler.yield()` | продолжение с повышенным приоритетом, впереди обычных задач | Chrome 129, Firefox 142, Safari — нет |
| `scheduler.postTask(fn, { priority })` | очередь своего приоритета | Chrome 94, Firefox 142, Safari — нет |
| `requestIdleCallback(fn)` | когда браузер простаивает | Chrome 47, Firefox 55, Safari — только в Technology Preview за флагом |
| `requestAnimationFrame(fn)` | перед style и layout ближайшего кадра | везде |
| Web Worker | в другой поток | везде |

Последние две строки — не «отдать управление», а «сделать в нужный момент» и «сделать не здесь». rAF нужен для визуальной работы, привязанной к кадру. Воркер подходит для вычислений без DOM, ценой копирования данных (подробно — «[Web Workers, Service Workers и PWA](../browser/workers.md)»).

### Prioritized Task Scheduling: модель спецификации

Спецификация WICG Prioritized Task Scheduling вводит три приоритета:

- `user-blocking` — то, что пользователь ждёт прямо сейчас: отклик на ввод, критичный рендер;
- `user-visible` (по умолчанию) — видимое, но не срочное: догрузка ниже первого экрана;
- `background` — то, что можно отложить: аналитика, прогрев кэшей, индексация.

У каждого приоритета две очереди: **задачи** (`postTask`) и **продолжения** (`yield`). Эффективный приоритет растёт так: background-задача → background-продолжение → user-visible-задача → user-visible-продолжение → user-blocking-задача → user-blocking-продолжение. Продолжение `yield` старше задачи **того же** приоритета, но младше задач более высокого. Так работа, начатая раньше, не теряется в хвосте очереди, но и не обгоняет срочное.

**Наследование.** `scheduler.yield()` берёт приоритет и сигнал отмены у задачи, в которой вызван. Внутри `postTask(..., { priority: 'background' })` продолжение тоже фоновое. Внутри `requestIdleCallback` — фоновое без отмены. В обычной задаче (таймер, обработчик события) — `user-visible` без отмены.

**Отмена и смена приоритета.** `TaskController` — это `AbortController`, чей `signal` (`TaskSignal`) несёт ещё и приоритет. `controller.abort()` отклоняет промис `postTask` (с `AbortError` или своей причиной) и выкидывает задачу из очереди. Если отменён сигнал, унаследованный `yield`, отклоняется и `await scheduler.yield()`. `controller.setPriority('user-blocking')` переставляет уже поставленные задачи и шлёт событие `prioritychange`. `TaskSignal.any([...])` объединяет сигналы. Опция `delay` откладывает постановку в очередь не меньше чем на указанные миллисекунды.

Как задачи планировщика соотносятся с остальными источниками задач (таймеры, сеть, ввод) и с рендерингом, спецификация оставляет браузеру. Ненормативная заметка предлагает ставить их ниже ввода и рендеринга.

> [!WARNING]
> Проверено в Chromium 157. Из одной задачи поставлены `setTimeout(0)`, `postTask` всех трёх приоритетов, `yield`, `requestIdleCallback` и микрозадача. Порядок: микрозадача → `user-blocking` → продолжение `yield` → `setTimeout` → `user-visible` → `background` → rIC. `yield` внутри `background`-задачи и внутри rIC пропустил вперёд поставленные позже `user-visible`-задачи. `setPriority` с `background` на `user-blocking` обогнал обычную задачу. `postTask` с `delay: 120` выполнился через 124 мс.

### Продолжения `yield` и голодание очередей

`scheduler.yield()` спроектирован для работы, которую надо **закончить** побыстрее, не блокируя ввод. В Chromium приоритет его продолжений выше обычных задач, и это имеет обратную сторону.

> [!WARNING]
> Проверено в Chromium 157. Цикл на 1 с: кусок по 5 мс, затем `await scheduler.yield()`. Клик посреди работы обработан с input delay 2 мс, то есть ввод проходит. Но `setInterval(..., 16)` за эту секунду не сработал ни разу, промис `fetch` разрешился только после конца работы (через 1003 мс вместо 6), а кадров было 11 вместо 61. С `await scheduler.postTask(() => {})` (user-visible) и с `setTimeout` интервал сработал 62 раза, кадров было 61–62. Без разбиения и с `await Promise.resolve()` клик ждал 812–815 мс.

Вывод: `yield` — для разбиения короткой срочной работы (обработчик, ре-рендер, разбор ответа) на десятки-сотни миллисекунд. Долгую фоновую работу планируют задачами: `postTask` с `user-visible` или `background`, `setTimeout`, rIC, а лучше уносят в воркер. Иначе фоновая работа отнимет ход у сети, таймеров и чужих скриптов. `navigator.scheduling.isInputPending()` в Chromium 157 ещё есть, но web.dev его больше не рекомендует: он может ошибочно вернуть `false`, а отдавать управление нужно и ради рендеринга. Правило проще — отдавать всегда, по бюджету времени.

### «Сначала отклик, потом работа»

Event Timing меряет INP до **следующего кадра** после обработчиков. Значит, в обработчике достаточно сделать видимое изменение (нажатое состояние, спиннер, введённый символ), а всё остальное перенести за yield. Кадр с откликом успеет отрисоваться до продолжения, и взаимодействие закончится на нём.

> [!WARNING]
> Проверено в Chromium 157. Обработчик клика: смена текста и 20 мс работы, затем ещё 200 мс. Без yield `duration` клика — 224–240 мс. С `await scheduler.yield()`, с `setTimeout(0)` и с `requestAnimationFrame(() => setTimeout(...))` между частями — 24–40 мс: кадр отрисовывается до продолжения. Сами 200 мс никуда не делись. Если следующий клик придёт во время них, у него вырастет input delay.

Вариант `requestAnimationFrame` + `setTimeout` web.dev приводит для браузеров без `scheduler`: продолжение гарантированно встаёт после кадра. Второе, о чём часто забывают, — **устаревшая работа**. Если пользователь печатает в поиске, результат для каждого символа, кроме последнего, не нужен. Отложенную работу проверяют на актуальность после каждого yield или отменяют через `AbortController`/`TaskController`.

### Меньше рендерить

Когда фреймворк уже ничего лишнего не делает, остаётся стоимость самого DOM. Presentation delay и время ре-рендера растут с числом узлов: style и layout проходят по дереву, `querySelectorAll` и сопоставление селекторов тоже.

**Виртуализация** (windowing) — в DOM только видимые строки плюс запас (overscan), остальное заменено распоркой с полной высотой. Список на 10 000 строк превращается в 20–40 узлов, и стоимость рендера перестаёт зависеть от длины данных. Цена: **переменная высота** строк требует измерять их после рендера (`ResizeObserver`) и считать позиции префиксными суммами (задача 3); **поиск браузера** (Ctrl+F), якоря и печать не видят строк вне DOM; для **доступности** нужны `aria-setsize`/`aria-posinset` или `aria-rowcount`/`aria-rowindex`, а фокус теряется, когда строка уходит из DOM; при быстрой прокрутке дорогой рендер строки виден как пустые места.

Готовые решения для Vue: `@tanstack/vue-virtual`, `vue-virtual-scroller`, `useVirtualList` из VueUse.

**`content-visibility: auto`** — почти бесплатная альтернатива. Узлы остаются в DOM (работают поиск и доступность), но браузер не делает layout и paint для блоков вне экрана. Пару ей составляет `contain-intrinsic-size: auto 500px`. Есть везде: Chrome 85, Firefox 125, Safari 18. Это экономит рендеринг, но не стоимость создания узлов и не работу фреймворка над ними. Для 300 карточек статьи хватит `content-visibility`, для 50 000 строк таблицы нужна виртуализация. Большой HTML, собранный на клиенте (`innerHTML`, крупное поддерево), вставляется одной задачей, а потоковый HTML с сервера браузер разбирает и рисует частями.

### Профилирование в DevTools Performance

Порядок работы, который стоит рассказать на интервью:

1. **Воспроизвести в условиях пользователя.** Ноутбук разработчика в разы быстрее медианного телефона. В Capture settings ставят **CPU throttling** (×4 или ×6). Кнопка **Calibrate** подбирает пресеты под конкретную машину: «низкий» и «средний» мобильный. Заодно включают замедление сети, если важна загрузка. Расширения мешают замеру — запись делают в гостевом профиле или инкогнито.
2. **Записать.** **Record** — для взаимодействия (нажать, выполнить сценарий, остановить), **Record and reload** — для загрузки. Стартовый экран **Live metrics** показывает локальные LCP, INP и CLS с элементом-виновником и рядом — полевые данные CrUX.
3. **Найти проблему на таймлайне.** Трек **Interactions** показывает взаимодействия и подсвечивает долгие. В треке **Main** долгие задачи отмечены красным треугольником, а часть сверх 50 мс заштрихована. Боковая панель **Insights** сразу разбирает типовые случаи: INP breakdown, Forced reflow, Optimize DOM size, Layout shift culprits, Third parties.
4. **Разобрать задачу.** Flame chart в Main: ось X — время, ось Y — стек вызовов, вызывающий выше вызываемого. Ширина блока — его время с потомками. Жёлтое — скрипты, фиолетовое — style и layout, зелёное — paint. Фиолетовый Layout, вызванный изнутри скрипта, — принудительный layout.
5. **Обобщить.** Нижняя панель: **Summary** — разбивка выделения по категориям, **Bottom-Up** — функции по **собственному** времени (self time): где реально тратится CPU, **Call Tree** — дерево от корневых вызовов: какой сценарий дорог целиком, **Event Log** — события по порядку.

Полезные переключатели: **Dim 3rd parties** — приглушает сторонний код и показывает таблицу 1st/3rd party; **ignore list** (например, `node_modules`) сворачивает фреймы библиотек, оставляя видимым свой код; **Enable CSS selector stats** показывает стоимость селекторов в Recalculate Style; **Disable JavaScript samples** снижает накладные расходы, когда интересен только рендеринг. Без source maps на проде flame chart состоит из `a`, `b` и `e` — карты нужно хотя бы загружать в DevTools или в систему мониторинга.

> [!WARNING]
> Профилировщик сэмплирующий: стек снимается с интервалом, и очень короткие вызовы могут не попасть в запись. Запись сама замедляет страницу. Сравнивают поэтому относительные доли и повторяемые картины, а не абсолютные миллисекунды одного прогона. В Chromium 157 одна и та же вычислительная функция заняла 30 мс без замедления и 133–146 мс при `Emulation.setCPUThrottlingRate` ×4 (именно это включает CPU throttling в DevTools).

Lighthouse и вкладка Performance дают **лабораторную** картину. Что видят пользователи, показывает RUM с атрибуцией INP через Long Animation Frames (только Chromium) — см. «[Core Web Vitals и измерение](./web-vitals.md)».

### User Timing: разметить свой код

Flame chart отвечает «какая функция», но не «какой бизнес-сценарий». User Timing добавляет свои отметки: `performance.mark(name, { startTime?, detail? })` — точку во времени, `performance.measure(name, { start, end, duration, detail })` — отрезок между метками или временами (возвращает `PerformanceMeasure`). Записи видны в `PerformanceObserver`, `performance.getEntriesByName` и в треке **Timings** DevTools.

DevTools в Chromium понимают `detail.devtools` (extensibility API): `measure` с `dataType: 'track-entry'` и `track` попадает на **собственный трек** (включается в Capture settings → Show custom tracks), `mark` с `dataType: 'marker'` — вертикальная отметка через все треки. Есть ещё `properties` для панели деталей и `color`. `console.timeStamp(label, start, end, track, group, color)` рисует то же самое почти без накладных расходов, но в Performance Timeline записей не создаёт.

Метки бесплатны только условно: в горячем цикле их не ставят. В проде отрезки User Timing отправляют в RUM наравне с Web Vitals: «время от клика до отрисовки фильтра» по роутам и релизам полезнее абстрактного INP.

### Vue и Nuxt: где рождаются долгие задачи

Кратко, подробно — в «[Производительности Vue и Nuxt](./vue-performance.md)». Изменение реактивного состояния не перерисовывает сразу. Vue копит задания и выполняет flush **одной микрозадачей**, поэтому весь ре-рендер, вызванный обработчиком, — часть той же задачи, и разбить его через yield нельзя. Сокращают сам ре-рендер (меньше компонентов затронуто, `shallowRef` для больших неизменяемых данных, виртуализация), а дорогие вычисления выносят из `computed` в отложенную задачу или воркер. При загрузке Nuxt-страницы главная долгая задача — **гидрация**: исполнение бандла и обход всего дерева компонентов. Её режут ленивой гидрацией и `lazy`-компонентами (см. «[Оптимизацию загрузки](./loading.md)»).

## Примеры

Универсальный `yieldToMain` и разбиение по бюджету времени, а не по числу элементов:

```js
export function yieldToMain() {
  if (globalThis.scheduler?.yield) return scheduler.yield();
  // Fallback: a new task; MessageChannel avoids the 4 ms clamp of nested timers.
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => resolve();
    port2.postMessage(null);
  });
}

export async function runJobs(jobs, { budget = 10 } = {}) {
  let deadline = performance.now() + budget;
  for (const job of jobs) {
    job();
    if (performance.now() >= deadline) {
      await yieldToMain();
      deadline = performance.now() + budget;
    }
  }
}
```

Фоновая работа с приоритетом и отменой — индексация данных, которую можно повысить, когда пользователь открыл поиск, и отменить при уходе со страницы:

```js
// Chromium and Firefox only: Safari has no scheduler.
const indexing = new TaskController({ priority: 'background' });

async function buildIndex(docs, index, signal) {
  for (let i = 0; i < docs.length; i++) {
    index.add(docs[i]);
    if (i % 200 === 199) {
      // A new background task each time: does not starve timers or network.
      await scheduler.postTask(() => {}, { signal });
    }
  }
}

buildIndex(docs, index, indexing.signal).catch((e) => { if (e.name !== 'AbortError') throw e; });

searchInput.addEventListener('focus', () => indexing.setPriority('user-visible'), { once: true });
addEventListener('pagehide', () => indexing.abort());
```

Свой трек в DevTools для этапов фильтрации:

```js
function filterRows(rows, query) {
  const start = performance.now();
  const result = rows.filter((r) => r.title.includes(query));
  const properties = [['rows', String(rows.length)], ['matches', String(result.length)]];
  performance.measure('filter', {
    start,
    detail: { devtools: { dataType: 'track-entry', track: 'Catalog', color: 'tertiary', properties } },
  });
  return result;
}
```

## Вопросы с интервью

::: details Что такое долгая задача и почему порог 50 мс
Задача — единица работы event loop: выполнение скрипта, обработчик события, таймер. Пока она идёт, браузер не обрабатывает ввод и не рисует. Долгая — дольше 50 мс. Порог из модели RAIL: отклик быстрее 100 мс воспринимается как мгновенный. Если задачи не длиннее 50 мс, ввод, пришедший в худший момент, ждёт не больше 50 мс, и на обработку остаётся ещё 50. Всё сверх 50 мс — блокирующая часть: из неё складывается TBT в лаборатории, а в поле она проявляется как input delay в INP. Лечение — разбивать задачи и отдавать управление между кусками, сокращать работу или уносить её в воркер.
:::

::: details Чем отличаются способы отдать управление главному потоку
`await Promise.resolve()` не отдаёт ничего: это микрозадача, она выполнится до ввода и рендеринга. `setTimeout(0)` создаёт новую задачу, но продолжение встаёт в конец очереди, а после пяти уровней вложенности получает задержку 4 мс; `MessageChannel` — без задержки. `scheduler.yield()` продолжает в новой задаче с приоритетом выше обычных задач своего уровня и наследует приоритет и сигнал отмены текущей `postTask`-задачи. `postTask` ставит задачу в очередь одного из трёх приоритетов и умеет отмену, смену приоритета и задержку. `requestIdleCallback` — для некритичной работы в простое, с дедлайном до 50 мс. `scheduler` нет в Safari, rIC там только за флагом в Technology Preview, поэтому нужен запасной вариант.
:::

::: details Когда scheduler.yield вреден
Когда им режут долгую **фоновую** работу. Продолжения `yield` в Chromium идут впереди обычных задач. Ввод при этом проходит, но таймеры, колбэки сети, `postMessage` и сторонние скрипты голодают, кадры реже. В Chromium 157 за секунду такой работы `setInterval` не сработал ни разу, а `fetch` разрешился только после её конца. `yield` подходит для срочной работы, которую нужно быстро закончить, не блокируя ввод: обработчик, разбор ответа. Фон планируют `postTask` с `background`/`user-visible`, rIC или выносят в воркер.
:::

::: details Как бы вы улучшили INP конкретного взаимодействия
Сначала разбить на фазы — атрибуция `web-vitals` в поле, трек Interactions и INP breakdown в DevTools. Input delay: искать, что занимало поток в момент ввода (гидрация, исполнение бандла, аналитика, таймеры), и резать или откладывать это. Processing: в обработчике оставить только визуальный отклик, остальное — после yield. Убрать лишнюю работу: устаревшие запросы, повторный ре-рендер всего списка. Вычисления — в воркер. Presentation delay: уменьшить DOM (виртуализация, `content-visibility`), убрать forced layout, анимировать `transform`/`opacity`. Проверять с замедлением CPU, а результат — по полевому p75, не по одному прогону.
:::

::: details Помогает ли debounce для поля поиска
Частично. [Debounce](../live-coding/debounce-throttle.md) уменьшает число запусков тяжёлой работы, но тот запуск, что всё-таки произошёл, по-прежнему одна долгая задача. Если пользователь в этот момент нажмёт клавишу, её input delay будет большим. Нужно три вещи. Ввод символа и визуальный отклик — сразу, синхронно. Фильтрацию — кусками с yield, с проверкой актуальности запроса после каждого куска и отменой устаревшего. Отрисовку результата — дешёвую: виртуализированный список. Если данных много, фильтрацию переносят в воркер, а в главный поток приходит только результат.
:::

::: details Как устроена виртуализация списка и какие у неё проблемы
В DOM рендерятся только строки, попадающие в окно прокрутки, плюс запас сверху и снизу. Полная высота задаётся распоркой, а строки позиционируются через `transform` или отступ. По `scrollTop` вычисляется первый видимый индекс: при фиксированной высоте делением, при переменной — бинарным поиском по префиксным суммам высот, а реальные высоты измеряются после рендера. Проблемы: поиск браузера, якоря и печать не видят невидимых строк; для скринридера нужны `aria-setsize`/`aria-posinset` или `aria-rowcount`/`aria-rowindex`, фокус теряется при уходе строки; при переменной высоте прыгает прокрутка, когда оценка заменяется измерением. Если строк сотни, а не десятки тысяч, проще `content-visibility: auto`: узлы в DOM, но layout и paint за экраном пропускаются.
:::

::: details Как вы профилируете медленное взаимодействие
Воспроизвожу в DevTools Performance с CPU throttling ×4–×6 или откалиброванным пресетом, в профиле без расширений, с source maps. Записываю именно взаимодействие. В треке Interactions нахожу долгое, в Main — его задачи с красным треугольником. По flame chart смотрю, кто занимает время: жёлтые блоки скриптов или фиолетовые style и layout. Принудительный layout виден как Layout внутри скрипта, его подсвечивает insight Forced reflow. Bottom-Up по self time показывает горячие функции, Call Tree — дорогие сценарии целиком. Сторонний код отделяю через Dim 3rd parties, библиотеки сворачиваю через ignore list. Свои этапы размечаю `performance.measure`, чтобы видеть их на отдельном треке. После исправления — повторная запись в тех же условиях и проверка в поле.
:::

## Задачи

### 1. Порядок выполнения при разных приоритетах · средне

Что выведет код в Chromium? Как изменится порядок частей второго блока, если `background` заменить на `user-blocking`?

```js
setTimeout(() => {
  setTimeout(() => console.log('timeout'), 0);
  scheduler.postTask(() => console.log('bg'), { priority: 'background' });
  scheduler.postTask(() => console.log('uv'));
  scheduler.postTask(() => console.log('ub'), { priority: 'user-blocking' });
  (async () => { await scheduler.yield(); console.log('yield'); })();
  requestIdleCallback(() => console.log('idle'));
  Promise.resolve().then(() => console.log('micro'));
}, 0);

setTimeout(() => {
  scheduler.postTask(async () => {
    console.log('A1');
    await scheduler.yield();
    console.log('A2');
  }, { priority: 'background' });
  scheduler.postTask(() => console.log('B'));
}, 100);
```

::: details Решение и разбор
Первый блок: `micro`, `ub`, `yield`, `timeout`, `uv`, `bg`, `idle`.

- `micro` — микрозадача, выполняется сразу после текущей задачи, до любой новой.
- `ub` — `user-blocking`-задача старше user-visible-продолжения.
- `yield` вызван в задаче таймера, значит, продолжение `user-visible`. Продолжения старше задач своего приоритета, поэтому оно раньше `uv`.
- Место `timeout` относительно задач планировщика спецификация отдаёт браузеру. В Chromium 157 таймер выполнился между продолжением и `user-visible`-задачей. На это нельзя опираться в коде.
- `bg` — только когда нет более приоритетной работы, `idle` — в простое.

Второй блок: `B`, `A1`, `A2`. Обе задачи стоят в очередях до начала выполнения: `B` (user-visible) старше `A1` (background). `A2` наследует фоновый приоритет, поэтому, будь в очереди ещё user-visible-задачи, они бы выполнились раньше. С `user-blocking` порядок — `A1`, `A2`, `B`: продолжение наследует `user-blocking` и опережает user-visible-задачу.

Все порядки проверены в Chromium 157. Вывод для практики: `yield` внутри фоновой задачи не делает работу срочной, а внутри `user-blocking` — обгоняет все задачи более низких приоритетов.
:::

### 2. Отзывчивый поиск по большому списку · средне

Поиск по 50 000 товаров. Обработчик фильтрует массив и перерисовывает список на каждый символ, INP на мобильных — 600 мс. Перепишите `onInput`, чтобы ввод оставался отзывчивым, а результат соответствовал последнему запросу.

```js
input.addEventListener('input', () => {
  const q = input.value.toLowerCase();
  const found = products.filter((p) => p.searchText.includes(q));
  renderList(found);
});
```

::: details Решение и разбор
```js
let version = 0;

input.addEventListener('input', async () => {
  const current = ++version;
  const q = input.value.toLowerCase();
  status.textContent = 'Ищем…'; // visual response in the next frame

  const found = [];
  let deadline = performance.now() + 8;
  for (let i = 0; i < products.length; i++) {
    if (products[i].searchText.includes(q)) found.push(products[i]);
    if (performance.now() >= deadline) {
      await yieldToMain();
      if (current !== version) return; // a newer keystroke superseded this one
      deadline = performance.now() + 8;
    }
  }
  if (current !== version) return;
  status.textContent = `${found.length} товаров`;
  renderList(found); // virtualized: cost depends on the viewport, not on found.length
});
```

- Ввод символа браузер рисует сам. Обработчик ставит статус и уступает поток на первом же куске, так что взаимодействие заканчивается кадром с откликом, а не кадром с результатом.
- Счётчик `version` отменяет устаревший поиск после каждого yield. Без него три быстрых символа запускают три полных прохода, и их куски чередуются.
- Бюджет 8 мс оставляет место кадру. Проверка времени на каждом элементе дешева. Если тело цикла крошечное, проверяют раз в N элементов.
- `yieldToMain` на `scheduler.yield()` здесь уместен: работа срочная и короткая. Медленная непрерывная работа так голодала бы таймеры.
- `renderList` на 20 000 найденных узлов сам по себе долгая задача, и синхронный рендер (Vue flush) через yield не разбить — поэтому список виртуализирован. Дальше по нарастающей: предвычисленный `searchText` в нижнем регистре (уже есть), индекс (префиксное дерево, n-граммы), перенос фильтрации в воркер с передачей только индексов результата.

Сложность: O(n · m) сравнений на запрос (m — длина строки), но не больше ≈ 8 мс непрерывной работы на главном потоке.
:::

### 3. Окно виртуального списка с переменной высотой · сложно

Реализуйте `createVirtualizer({ count, estimateSize, overscan })` с методами `getRange(scrollTop, viewportHeight)` и `measure(index, size)`. `getRange` возвращает `{ items: [{ index, top, size }], totalSize }` — строки, пересекающие окно, плюс `overscan` с каждой стороны. `measure` сообщает реальную высоту строки после рендера. На 100 000 строк `getRange` должен работать быстрее O(n).

::: details Решение и разбор
```js
export function createVirtualizer({ count, estimateSize, overscan = 3 }) {
  const sizes = Array.from({ length: count }, (_, i) => estimateSize(i));
  let offsets = []; // offsets[i] = top of row i; offsets[count] = total height
  let dirtyFrom = 0;

  const ensureOffsets = () => {
    if (dirtyFrom > count) return;
    if (dirtyFrom === 0) offsets = [0];
    for (let i = Math.max(dirtyFrom, 1); i <= count; i++) offsets[i] = offsets[i - 1] + sizes[i - 1];
    dirtyFrom = count + 1;
  };

  // Largest i with offsets[i] <= y.
  const indexAt = (y) => {
    let lo = 0, hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= y) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  return {
    getRange(scrollTop, viewportHeight) {
      ensureOffsets();
      if (count === 0) return { items: [], totalSize: 0 };
      const first = indexAt(scrollTop);
      let last = first;
      while (last < count - 1 && offsets[last + 1] < scrollTop + viewportHeight) last++;
      const start = Math.max(0, first - overscan);
      const end = Math.min(count - 1, last + overscan);
      const items = [];
      for (let i = start; i <= end; i++) items.push({ index: i, top: offsets[i], size: sizes[i] });
      return { items, totalSize: offsets[count] };
    },
    measure(index, size) {
      if (sizes[index] === size) return;
      sizes[index] = size;
      dirtyFrom = Math.min(dirtyFrom, index + 1); // offsets after this row are stale
    },
  };
}
```

- Префиксные суммы превращают «какая строка на высоте y» в бинарный поиск. Последняя видимая строка находится линейно от первой, но это O(k), где k — число видимых строк.
- `measure` не пересчитывает суммы сразу, а запоминает самую раннюю «грязную» позицию. Пересчёт ленивый, в следующем `getRange`, и один на пачку измерений: `ResizeObserver` присылает высоты всех новых строк одним колбэком.
- Пересчёт хвоста — O(n) в худшем случае. Если высоты меняются постоянно (раскрывающиеся строки), берут дерево Фенвика: обновление и префиксная сумма за O(log n).
- В компоненте: распорка высотой `totalSize`, строки с `transform: translateY(top)`, `scrollTop` читается в обработчике `scroll` с `passive: true`, пересчёт — не чаще раза за кадр. Когда измерение строки **выше** окна меняет её высоту, контент под окном сдвигается — нужно скорректировать `scrollTop` на разницу. Иначе список «прыгает».
- Решение проверено в Node против перебора на 2000 случайных окон с высотами 10–100 px.

Сложность: `getRange` — O(log n + k) после пересчёта; пересчёт — O(n − i) от первой изменённой строки; память O(n).
:::

### 4. Разбор профиля · средне

Клик «Применить фильтры» на дашборде (Vue 3, мобильный p75 INP — 480 мс). Запись в DevTools с CPU ×4 показывает одну задачу 410 мс с красным треугольником. Внутри: `onApply` → `store.applyFilters` (20 мс), затем блок Run microtasks, а в нём `flushJobs` → `patch` (230 мс), и десятки фиолетовых блоков Layout по 3–5 мс под `ChartTooltip.updated` → `getBoundingClientRect`. В Bottom-Up по self time лидируют `patchElement` и `Layout`. После задачи — Recalculate Style 60 мс и Paint. Что происходит и что делать, по порядку пользы?

::: details Решение и разбор
Всё взаимодействие — одна задача: обработчик меняет стор, Vue выполняет flush ре-рендера микрозадачей той же задачи, а хуки `updated` выполняются внутри flush. Input delay мал, проблема в processing (≈ 410 мс) и presentation delay (≈ 70 мс).

1. **Layout thrashing в `ChartTooltip.updated`.** Каждая подсказка читает геометрию после того, как patch изменил DOM: десятки принудительных layout'ов. Это видно по фиолетовым Layout внутри скрипта (insight Forced reflow). Чтения нужно собрать в одну фазу (один rAF на все подсказки) или считать позицию лениво при показе подсказки, а не на каждый `updated`.
2. **Слишком большой patch.** `patchElement` в лидерах Bottom-Up значит, что перерисовывается много узлов. Таблица под графиками, скорее всего, рендерит все строки: нужны виртуализация, стабильные `key` и точечная реактивность. Подробности — в теме о производительности Vue.
3. **Отклик до работы.** Сразу показать состояние загрузки фильтра, а применение отложить на yield. Сам flush не разбить, но взаимодействие закончится кадром со спиннером.
4. **Recalculate Style 60 мс** — большой DOM или дорогие селекторы. Включить CSS selector stats, проверить селекторы и размер DOM (insight Optimize DOM size); вне экрана — `content-visibility: auto`.

Проверка: повторная запись с теми же условиями и метками `performance.measure('apply-filters')` на своём треке. Затем полевой INP по роуту дашборда.
:::

### 5. Очередь фоновой работы на простое · средне

Напишите `createIdleQueue()` с методом `push(job)`. Задания выполняются, пока у браузера есть время простоя. Если простоя нет, хотя бы одно задание выполняется не позже чем через 2 с. В Safari (нет `requestIdleCallback`) очередь тоже работает. При уходе страницы в фон оставшиеся задания (отправка аналитики) выполняются сразу.

::: details Решение и разбор
```js
export function createIdleQueue({ timeout = 2000 } = {}) {
  const jobs = [];
  let head = 0;
  let scheduled = false;

  const requestIdle = globalThis.requestIdleCallback
    ? (cb) => requestIdleCallback(cb, { timeout })
    : (cb) => setTimeout(() => {
        const start = performance.now();
        cb({ didTimeout: false, timeRemaining: () => Math.max(0, 10 - (performance.now() - start)) });
      }, 0);

  const schedule = () => {
    if (scheduled || head === jobs.length) return;
    scheduled = true;
    requestIdle(run);
  };

  const run = (deadline) => {
    scheduled = false;
    if (head === jobs.length) return; // flushed before the callback arrived
    // Forced by timeout: run one job and let the browser breathe.
    do jobs[head++]();
    while (head < jobs.length && !deadline.didTimeout && deadline.timeRemaining() > 1);
    if (head === jobs.length) { jobs.length = 0; head = 0; }
    schedule();
  };

  const flush = () => {
    while (head < jobs.length) jobs[head++]();
    jobs.length = 0; head = 0;
  };

  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  return {
    push(job) { jobs.push(job); schedule(); },
    flush,
  };
}
```

- `timeRemaining()` в Chromium не больше 50 мс (проверено в Chromium 157: в простое — ровно 50). Задания должны быть короткими. Длинное задание всё равно станет долгой задачей: rIC выбирает момент, но не режет работу.
- `timeout` гарантирует прогресс. Когда в Chromium 157 главный поток был занят задачами по 30 мс подряд, колбэк пришёл с `didTimeout: true` и `timeRemaining() === 0`. Поэтому по таймауту выполняется ровно одно задание.
- Запасной вариант на `setTimeout` эмулирует бюджет в 10 мс. Простоя он не знает, это лишь «позже и понемногу».
- `head` вместо `shift()` — O(1) на извлечение, массив очищается целиком, когда опустел.
- В rIC не трогают DOM: колбэк может прийти в конце кадра, и запись в DOM сделает лишний layout. Визуальную работу планируют через rAF.
- Сброс на `hidden` нужен, потому что после ухода вкладки в фон rIC может не прийти вовсе. Это паттерн «idle until urgent».

Сложность: O(1) амортизированно на `push` и на выполнение задания.
:::

## Источники

- [HTML Living Standard: Event loops, update the rendering](https://html.spec.whatwg.org/multipage/webappapis.html#event-loops); [requestIdleCallback — W3C Cooperative Scheduling of Background Tasks](https://w3c.github.io/requestidlecallback/)
- [WICG: Prioritized Task Scheduling](https://wicg.github.io/scheduling-apis/) — приоритеты, очереди продолжений, наследование, `TaskController`, `TaskSignal.any`
- [W3C: Long Tasks API](https://w3c.github.io/longtasks/), [Long Animation Frames API](https://w3c.github.io/long-animation-frames/), [User Timing Level 3](https://w3c.github.io/user-timing/)
- [web.dev: Optimize long tasks](https://web.dev/articles/optimize-long-tasks), [Optimize Interaction to Next Paint](https://web.dev/articles/optimize-inp), [Optimize input delay](https://web.dev/articles/optimize-input-delay), [Script evaluation and long tasks](https://web.dev/articles/script-evaluation-and-long-tasks), [DOM size and interactivity](https://web.dev/articles/dom-size-and-interactivity), [content-visibility](https://web.dev/articles/content-visibility), [Measure performance with the RAIL model](https://web.dev/articles/rail)
- [Chrome for Developers: Use scheduler.yield() to break up long tasks](https://developer.chrome.com/blog/use-scheduler-yield), [Performance features reference](https://developer.chrome.com/docs/devtools/performance/reference), [Customize your performance data with extensibility API](https://developer.chrome.com/docs/devtools/performance/extension), [Performance insights](https://developer.chrome.com/docs/performance/insights)
- [MDN: Prioritized Task Scheduling API](https://developer.mozilla.org/en-US/docs/Web/API/Prioritized_Task_Scheduling_API), [Scheduler.yield()](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield), [Scheduler.postTask()](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/postTask), [TaskController](https://developer.mozilla.org/en-US/docs/Web/API/TaskController), [requestIdleCallback](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback), [Performance.measure()](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measure), [content-visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility); поддержка — по MDN browser-compat-data 8.1.8
- [WAI-ARIA 1.2: aria-setsize, aria-posinset, aria-rowcount](https://www.w3.org/TR/wai-aria-1.2/)
- [Vue: Performance — Virtualize Large Lists](https://vuejs.org/guide/best-practices/performance.html#virtualize-large-lists); исходники Vue core 3.5.45: [`scheduler.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/scheduler.ts)
