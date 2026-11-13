---
title: Утечки памяти
level: ядро
---

# Утечки памяти

> **Коротко.** Утечка в SPA — это память, которая растёт с каждым повторением сценария (открыть и закрыть экран, сменить маршрут) и не возвращается после сборки мусора. Почти всегда причина одна: долгоживущий источник (`window`, таймер, стор, шина событий, кэш модуля) держит ссылку на короткоживущий объект, потому что у подписки не было владельца, который её снимет. Лечится дисциплиной «каждая подписка — со своим `dispose`»: `AbortController`, `onScopeDispose`, ограниченные кэши. Ищется в DevTools сравнением heap snapshots и путём удержания (retainers), а в проде измеряется через `performance.measureUserAgentSpecificMemory()`.

**Связанные темы:** [Память и сборка мусора](../javascript/memory-and-gc.md), [Замыкания](../javascript/closures.md), [async/await, обработка ошибок и отмена](../javascript/async-await.md), [События и событийная модель](../browser/events.md), [DOM API и observers](../browser/dom.md), [Оптимизация runtime и профилирование](./runtime.md)

## Теория

Модель сборки мусора, корни, достижимость, shallow и retained size разобраны в «[Памяти и сборке мусора](../javascript/memory-and-gc.md)». Здесь — откуда утечки берутся в приложениях и как их находить.

### Что считать утечкой

Высокое потребление памяти само по себе утечкой не является. Различают три случая:

| Что видно | Что это | Пример |
| --- | --- | --- |
| Память растёт и падает «пилой», после GC возвращается к базе | норма | создание временных объектов при прокрутке |
| Память большая, но стабильная | раздутие (bloat) | глубоко реактивный массив на 100 тысяч объектов, огромный DOM |
| После каждого повтора сценария база после GC выше («лестница») | утечка | каждый визит на страницу оставляет в куче компонент |

SPA живёт часами без перезагрузки, поэтому даже 2 МБ на переход между маршрутами за рабочий день превращаются в сотни мегабайт. Последствия: более долгие major GC (паузы ухудшают INP), вытеснение вкладки на мобильных и падение с Out of Memory.

### Корень проблемы: направление ссылки

Подписка — это ссылка **от источника к подписчику**. Утечка возникает, когда источник живёт дольше подписчика.

- Слушатель на **удалённой** кнопке не течёт. Ссылка идёт от кнопки к обработчику, и кнопка становится недостижимой вместе с ним. В Chromium 157 кнопка с обработчиком, замыкающим 0,8 МБ, после `remove()` собиралась без `removeEventListener`.
- Слушатель на `window` течёт. `window` живёт всё время жизни страницы и держит обработчик, а через замыкание — всё окружение компонента.

Долгоживущие источники в браузере:

| Источник | Что держит | Как освободить |
| --- | --- | --- |
| `window`, `document`, `matchMedia`, `visualViewport` | слушатели | `{ signal }`, `removeEventListener` с **той же** функцией |
| `setInterval`, рекурсивный `setTimeout`, цикл `requestAnimationFrame` | колбэк | `clearInterval`, флаг остановки, `cancelAnimationFrame` |
| `ResizeObserver`, `IntersectionObserver`, `MutationObserver` на живых узлах | observer и его колбэк | `disconnect()` |
| `WebSocket`, `EventSource`, `BroadcastChannel`, `MessagePort` | открытое соединение — корень, держит слушатели | `close()` |
| Стор, [шина событий](../live-coding/event-emitter.md), `AbortSignal` всей страницы | списки подписчиков | отписка, функция, которую вернул `subscribe` |
| `Map`, массив, объект на уровне модуля | всё, что туда положили | ограничение размера (LRU), TTL, `WeakMap` по объекту |
| Сторонние библиотеки: карты, графики, редакторы | свой DOM, слушатели, воркеры | `destroy()` / `dispose()` из их API |
| Консоль | аргументы `console.log` | не логировать объекты в проде |

Классическая ошибка — `removeEventListener` с новой функцией. `this.onKey.bind(this)` при каждом вызове создаёт новую функцию, поэтому снять слушатель так нельзя. Надёжнее не хранить ссылки на обработчики вовсе: один `AbortController` на владельца, его `signal` передаётся во все `addEventListener` и `fetch`, а `abort()` снимает всё разом. Как писать собственные API, принимающие `signal`, — в «[async/await и отмене](../javascript/async-await.md)».

Замыкания усиливают любую из этих утечек. Обработчик держит не только то, что использует: в V8 все функции одной области делят общий `Context` ([подробнее](../javascript/closures.md#замыкания-и-память)).

### Detached DOM

**Detached** (отсоединённый) узел удалён из документа, но на него ещё ссылается JavaScript. Ссылка на один узел держит всё его поддерево (через `parentNode` и `children`), а вместе с ним — слушатели и данные на узлах. Типичные источники:

- массив или `Map` с «отрисованными строками», который не чистится при перерисовке;
- замыкание обработчика на долгоживущем источнике, которое захватило узел;
- экземпляр сторонней библиотеки, созданный на узле и не уничтоженный;
- `IntersectionObserver`, который продолжает наблюдать удалённый узел.

Во Vue сами template refs не текут. При размонтировании Vue записывает в ref `null` (`setRef(..., isUnmount)` в runtime-core 3.5.45). Поэтому объект `ref`, сохранённый в глобальный массив, удалённый `<div>` не держит. Это проверено в Chromium 157: шесть циклов монтирования оставили ноль detached-узлов. Течёт сам элемент, скопированный из `el.value` куда-то за пределы компонента.

### Vue: что останавливается само, а что нет

У каждого компонента есть **effect scope**. `watch`, `watchEffect` и `computed`, созданные **синхронно** во время `setup()`, попадают в него и останавливаются при размонтировании. Всё остальное — на разработчике:

- **Watcher, созданный асинхронно**, к компоненту не привязан. В Chromium 157 watcher из `setTimeout` в `setup()` после шести размонтирований сработал шесть раз и удерживал данные всех шести экземпляров. Такой watcher останавливают вручную функцией, которую вернул `watch`.
- **`await` в `<script setup>` безопасен.** Компилятор оборачивает каждый `await` верхнего уровня в `withAsyncContext()`, который восстанавливает текущий экземпляр. Watcher после `await` привязан к компоненту. В обычном `async setup()` без компилятора, а также внутри вложенной `async`-функции экземпляр после `await` потерян: `getCurrentScope()` возвращает `undefined`, watcher переживает компонент. Оба случая проверены на Vue 3.5.45 с `<Suspense>`.
- **Внешние ресурсы**: слушатели на `window`, таймеры, observers, WebSocket, экземпляры библиотек. Создавать их в `onMounted`, освобождать в `onBeforeUnmount`/`onUnmounted` или в `onScopeDispose`.
- **Composables вне компонента.** `onScopeDispose()` регистрирует очистку в текущем scope — компонента или ручного `effectScope()`. Это позволяет composable работать в обоих местах. Без активного scope очистка не зарегистрируется, Vue 3.5 предупреждает об этом в dev-режиме.
- **Pinia.** Стор живёт столько же, сколько приложение: массив уведомлений или лог, который только растёт, — утечка в сторе. `$subscribe` и `$onAction`, вызванные в компоненте, снимаются при его размонтировании. С `{ detached: true }` они живут, пока их не снимут вручную. Setup store выполняется в effect scope самой pinia, а `store.$dispose()` останавливает его эффекты.
- **`<KeepAlive>` без `max`** держит все когда-либо показанные экземпляры ([подробнее](../javascript/memory-and-gc.md#vue-где-здесь-сборка-мусора)).

### SSR: утечки в процессе сервера

На сервере одна куча на все запросы, а процесс живёт днями. Отсюда два симптома одной причины — состояния на уровне модуля:

- **Утечка памяти**: `Map`-кэш или массив модуля растёт с каждым запросом;
- **Cross-request state pollution** (загрязнение состояния между запросами): данные одного пользователя видны в ответе другому.

Vue не вызывает на сервере `onMounted`, `onBeforeUnmount` и `onUnmounted`. Документация прямо предупреждает: таймер из `setup()`, который чистится в `onUnmounted`, на сервере останется навсегда. Проверено на Vue 3.5.45: после `renderToString` не вызывается и `onScopeDispose` компонента, потому что его scope на сервере не останавливается. Значит, composable с очисткой в `onScopeDispose` на сервере тоже течёт, если запускает ресурс в `setup()`. Watchers Vue обезвреживает сам: обычный `watch` на сервере даже не подписывается, `immediate`-watcher и `watchEffect` выполняются один раз и сразу останавливаются, а watcher с `flush: 'sync'` останавливается после рендера.

> [!WARNING]
> Правило для SSR: побочные эффекты, требующие очистки, запускаются только в `onMounted`. Состояние — внутри приложения: `useState` в Nuxt или Pinia (новая pinia на каждый запрос), а не `const state = ref()` на уровне модуля. Документация Nuxt называет такой `ref` причиной и утечки данных между запросами, и утечки памяти.

В чистом Vue SSR после `renderToString` `activePinia` продолжает указывать на pinia последнего запроса (проверено на Pinia 4.1.0). `@pinia/nuxt` сбрасывает её в хуке `app:rendered` — по комментарию в исходниках, чтобы не держать ссылку. Поэтому вне `setup()` на сервере pinia передают явно: `useStore(pinia)`.

Сервер диагностируют так же, как браузер: `node --inspect` открывает ту же вкладку Memory в DevTools, `v8.writeHeapSnapshot()` снимает снимок из кода, а `process.memoryUsage().heapUsed` под нагрузочным тестом показывает «лестницу».

### Диагностика в DevTools

**1. Подтвердить рост.** Колонка JavaScript Memory в диспетчере задач Chrome показывает кучу вкладки в реальном времени. В панели Performance с включённым чекбоксом Memory сценарий повторяют 5–10 раз, нажимая Collect garbage в начале и в конце записи. «Лестница» на графике JS heap, DOM-узлов или слушателей — утечка.

**2. Убрать ложные удержания.** Чужие ссылки маскируют настоящую утечку или создают ложную:

> [!WARNING]
> Проверено в Chromium 157. `console.log(obj)` удерживает `obj` **даже без открытых DevTools и без отладочного порта**. Хранятся аргументы последних 1000 сообщений: из 1100 залогированных объектов первые 100 собрались, остальные жили. Dev-сборка Vue 3.5.45 без расширения Vue Devtools первые 3 секунды буферизует события devtools вместе с экземплярами компонентов. В этом окне размонтированные компоненты живы, после него собираются. Поэтому утечки ищут на production-сборке, в окне без расширений и с очищенной консолью.

**3. Три снимка.** Снимок кучи всегда начинается со сборки мусора, поэтому в нём только достижимое.

1. Прогреть: пройти сценарий один раз (ленивые модули, кэши, JIT). Снять снимок 1.
2. Повторить сценарий N раз. Снять снимок 2.
3. Повторить ещё N раз. Снять снимок 3.
4. В снимке 3 в Summary выбрать «Objects allocated between Snapshot 1 and Snapshot 2». Это объекты, созданные в первой серии, которые пережили вторую. В здоровом приложении там почти пусто.

Режим Comparison показывает разницу между двумя снимками по конструкторам. Подозрительна колонка `# Delta`, кратная N: семь повторов дали семь лишних `ChartWidget`.

**4. Прочитать retainers.** У подозрительного объекта панель Retainers показывает, кто на него ссылается, вплоть до корня. Цепочку читают сверху вниз до первого имени из своего кода: переменной, свойства, `Map`, массива слушателей. `system / Context` — это окружение замыкания: имя функции на следующей строке говорит, чьё. Колонка Distance — длина кратчайшего пути до корня.

**5. Detached DOM.** Отсоединённые узлы в снимке называются `Detached <div class="…">`. Их находят, введя `Detached` в фильтр классов, или фильтром «Objects retained by detached nodes». Профиль Detached elements во вкладке Memory сразу показывает список отсоединённых узлов, которые удерживает JavaScript, и сколько узлов держит каждый. Это тот же список, что возвращает CDP-метод `DOM.getDetachedDomNodes`. Фильтр «Objects retained by the DevTools console» показывает объекты, которые держит консоль.

**6. Где выделяется.** «Allocations on timeline» записывает выделения во времени: синие столбики — ещё живые, серые — уже собранные. Выделение участка показывает, какие объекты созданы в нём и дожили до конца записи. «Allocation sampling» с низкими накладными расходами группирует выделения по функциям — для поиска раздутия, а не утечки.

### Измерение в поле

Утечки, которые не воспроизводятся локально, ловят метриками из прода.

- **`performance.measureUserAgentSpecificMemory()`** возвращает промис с полями `bytes` и `breakdown` (по realm: окно, iframe, воркер; с типами памяти). API экспериментальный: Chrome и Edge с 89, в Firefox и Safari нет (MDN BCD 8.1.8). Нужны secure context и cross-origin isolation (`COOP: same-origin` + `COEP: require-corp`).
- MDN рекомендует вызывать его периодически со **случайным** интервалом, например экспоненциальным со средним 5 минут, и анализировать динамику внутри сессии: растёт ли `bytes` с длительностью. Абсолютные значения несравнимы между браузерами и их версиями.
- `performance.memory` — нестандартный устаревший API Chrome: только JS-куча, грубые значения.

> [!WARNING]
> Проверено в Chromium 157. Без cross-origin isolation метода просто нет: вызов даёт `TypeError: ... is not a function`, а не `SecurityError`, как описывает MDN. Проверять нужно `crossOriginIsolated`, а не ловить исключение. Результат пришёл примерно через 10 с: браузер ждёт сборки мусора, а не выполняет её сразу.

**Автоматические тесты на утечки.** На уровне юнита: создать объект внутри `effectScope`, остановить scope, вызвать GC (`node --expose-gc`) и проверить, что `WeakRef` опустел (задача 5). На уровне приложения: Playwright или Puppeteer повторяют сценарий и считают живые экземпляры через CDP (`HeapProfiler.collectGarbage`, `Runtime.queryObjects`) или берут снимки и сравнивают их, как делает memlab от Meta.

## Примеры

Сторонняя библиотека в компоненте Vue: создать после монтирования, уничтожить до удаления DOM.

```ts
const el = useTemplateRef<HTMLDivElement>('chart');
let chart: Chart | undefined;

onMounted(() => {
  chart = new Chart(el.value!, options); // client only: never runs on the server
});
onBeforeUnmount(() => {
  chart?.destroy(); // removes its listeners, observers and canvas
  chart = undefined;
});
```

## Вопросы с интервью

::: details Как отличить утечку памяти от просто высокого потребления?
По форме графика после сборки мусора. Нормальная память ходит «пилой» и возвращается к базе. Раздутие — много, но стабильно. Утечка — «лестница»: каждый повтор сценария (открыть и закрыть модалку, перейти по маршруту и назад) поднимает базу после GC. Проверка: в Performance с чекбоксом Memory повторить сценарий 5–10 раз с принудительной сборкой в начале и в конце или снять heap snapshots и сравнить. Если число экземпляров компонента растёт кратно числу повторов, это утечка.
:::

::: details Почему слушатель на window вызывает утечку, а слушатель на удалённой кнопке — нет?
Подписка — ссылка от источника к обработчику. Удалённая кнопка становится недостижимой вместе со своими слушателями и их замыканиями, поэтому снимать слушатель не обязательно. `window` достижим всё время жизни страницы и держит обработчик, а через замыкание — компонент, его данные и DOM. Поэтому слушатели на долгоживущих источниках (`window`, `document`, сторы, шины, сокеты) снимают явно. Удобнее всего один `AbortController` на владельца: `signal` во всех `addEventListener`, `abort()` при уничтожении. Частая ошибка — `removeEventListener(type, fn.bind(this))`: `bind` создаёт новую функцию, и слушатель не снимается.
:::

::: details Что такое detached DOM и как его найти?
Узел, удалённый из документа, но достижимый из JavaScript: через переменную, массив, замыкание обработчика или экземпляр сторонней библиотеки. Одна ссылка держит всё поддерево. Найти: в Memory снять heap snapshot и ввести `Detached` в фильтр классов, или использовать фильтр «Objects retained by detached nodes», или профиль Detached elements. Затем по Retainers найти, кто держит узел. Во Vue template ref при размонтировании обнуляется сам, течёт элемент, скопированный из ref в долгоживущую структуру.
:::

::: details Какие эффекты Vue останавливаются при размонтировании сами, а какие нет?
Сами — `watch`, `watchEffect` и `computed`, созданные синхронно в `setup()`: они в effect scope компонента. В `<script setup>` это верно и после `await` верхнего уровня, потому что компилятор оборачивает его в `withAsyncContext`, который восстанавливает экземпляр. Не останавливаются: watcher из `setTimeout`, `then` или вложенной `async`-функции, `$subscribe` Pinia с `detached: true`, всё, что не является эффектом Vue: слушатели на `window`, таймеры, observers, сокеты, экземпляры библиотек. Их снимают в `onBeforeUnmount` или `onScopeDispose`. Для логики вне компонентов — `effectScope()` и его `stop()`.
:::

::: details Почему код в setup может течь на сервере Nuxt, хотя на клиенте всё чисто?
Потому что на сервере компонент никогда не размонтируется: Vue не вызывает `onMounted`, `onBeforeUnmount`, `onUnmounted`, а scope компонента не останавливается, так что и `onScopeDispose` не срабатывает. `setInterval` или подписка, запущенные в `setup()`, на сервере живут вечно, вместе с замыканием, удерживающим данные запроса. Вторая причина — состояние на уровне модуля: модуль загружается один раз на процесс, и `ref` или `Map` в нём общие для всех запросов. Это одновременно утечка памяти и утечка данных между пользователями. Решение: эффекты — только в `onMounted`, состояние — в `useState` или Pinia, модульные кэши — с ограничением размера и без персональных данных.
:::

::: details Опишите по шагам, как вы будете искать утечку в SPA.
Воспроизвести сценарий, который подозреваем, на production-сборке в окне без расширений. Подтвердить рост в Performance (Memory) или в диспетчере задач. Методика трёх снимков: прогрев → снимок 1 → N повторов → снимок 2 → N повторов → снимок 3. В снимке 3 смотреть объекты, выделенные между первым и вторым и пережившие третий. Либо Comparison с `# Delta`, кратной N. Для подозрительного конструктора открыть Retainers и идти до первого имени из своего кода: слушатель, таймер, кэш, стор. Проверить detached-узлы. Исправить и повторить измерение. Закрепить автотестом: сценарий в Playwright и счётчик экземпляров через CDP.
:::

::: details Как измерять память в продакшене?
`performance.measureUserAgentSpecificMemory()`: только Chromium, только при cross-origin isolation, результат асинхронный и приходит после сборки мусора. Вызывать со случайными интервалами и смотреть тренд `bytes` в зависимости от длительности сессии, сравнивать релизы. Значения несравнимы между браузерами и версиями. `performance.memory` — устаревший нестандартный API. Косвенные сигналы: деградация INP и долгих задач к концу длинных сессий, частота падений вкладки. На сервере — `process.memoryUsage()` в метриках и снимки через `v8.writeHeapSnapshot()`.
:::

::: details Почему утечка может «появляться» только при отладке?
Инструменты сами держат объекты. `console.log` хранит аргументы последних сообщений: в Chromium 157 — 1000, даже без открытых DevTools. Объекты, выведенные в консоль DevTools и выбранные в панелях (`$0`, `$_`), удерживаются. Dev-сборка Vue буферизует события для devtools с экземплярами компонентов (3 с, если расширения нет), расширение Vue Devtools держит дерево компонентов. Поэтому утечки ищут на production-сборке, с чистой консолью и фильтром «Objects retained by the DevTools console», чтобы отсеять ложные.
:::

## Задачи

### 1. Найдите утечки · легко

Виджет создаётся на каждом открытии страницы поиска и уничтожается через `destroy()`. Память растёт. Найдите все причины и исправьте.

```js
const cache = new Map();

class SearchWidget {
  constructor(root, bus) {
    this.root = root;
    window.addEventListener('resize', () => this.layout());
    document.addEventListener('keydown', this.onKey.bind(this));
    this.timer = setInterval(() => this.poll(), 5000);
    bus.on('theme', () => this.repaint());
  }
  async search(q) {
    if (!cache.has(q)) cache.set(q, await (await fetch(`/api?q=${q}`)).json());
    this.render(cache.get(q));
  }
  destroy() {
    document.removeEventListener('keydown', this.onKey.bind(this));
    this.root.remove();
  }
}
```

::: details Решение и разбор
Пять причин:

1. `resize` на `window` не снимается: замыкание держит `this`, а с ним `root`, то есть весь detached DOM.
2. `keydown` не снимается: `bind` в `destroy` создаёт новую функцию, не равную добавленной.
3. `setInterval` не очищается: очередь таймеров держит колбэк, и `poll` продолжает работать на мёртвом виджете.
4. Подписка на `bus` не снимается.
5. `cache` модуля растёт с каждым новым запросом без ограничения. Это не удержание виджета, но память растёт.

```js
const cache = new LRUCache(100); // bounded: evicts least recently used

class SearchWidget {
  #controller = new AbortController();

  constructor(root, bus) {
    this.root = root;
    const { signal } = this.#controller;
    window.addEventListener('resize', () => this.layout(), { signal });
    document.addEventListener('keydown', (e) => this.onKey(e), { signal });
    const timer = setInterval(() => this.poll(), 5000);
    const off = bus.on('theme', () => this.repaint()); // assume on() returns an unsubscribe fn
    signal.addEventListener('abort', () => { clearInterval(timer); off(); }, { once: true });
  }
  async search(q) {
    let data = cache.get(q);
    if (!data) {
      const res = await fetch(`/api?q=${encodeURIComponent(q)}`, { signal: this.#controller.signal });
      cache.set(q, (data = await res.json()));
    }
    this.render(data);
  }
  destroy() {
    this.#controller.abort();
    this.root.remove();
    this.root = null;
  }
}
```

Сигнал заодно отменяет незавершённый `fetch`: без этого `render` вызвался бы на уничтоженном виджете.
:::

### 2. `useEventListener` · средне

Напишите composable `useEventListener(target, type, handler, options?)`. `target` — элемент, `ref` или геттер (в том числе template ref, который бывает `null`). При смене цели слушатель переносится, при остановке scope (размонтирование или `effectScope().stop()`) снимается. Вернуть функцию ручной остановки. Composable не должен ничего делать на сервере.

::: details Решение и разбор
```ts
import { watch, toValue, getCurrentScope, onScopeDispose, type MaybeRefOrGetter } from 'vue';

export function useEventListener(
  target: MaybeRefOrGetter<EventTarget | null | undefined>,
  type: string,
  handler: (e: Event) => void,
  options?: AddEventListenerOptions,
) {
  let controller: AbortController | undefined;
  const cleanup = () => controller?.abort();

  const stopWatch = watch(
    () => toValue(target),
    (el) => {
      cleanup(); // detach from the previous target
      if (!el) return;
      controller = new AbortController();
      el.addEventListener(type, handler, { ...options, signal: controller.signal });
    },
    { immediate: true, flush: 'post' }, // template refs are set after render
  );

  const stop = () => {
    stopWatch();
    cleanup();
  };
  if (getCurrentScope()) onScopeDispose(stop);
  return stop;
}
```

- `AbortController` на каждую цель избавляет от хранения пары «функция + опции» для `removeEventListener`: `capture` в опциях должен совпадать при снятии, сигнал об этом не заботится.
- `immediate` вызывает колбэк сразу, синхронно. Для template ref в этот момент там ещё `null`, а после монтирования watcher перезапустится.
- На сервере `immediate`-watcher выполняется один раз и сразу останавливается, а template ref там всегда `null`, поэтому слушатель не добавится. Геттер `() => window` на сервере упадёт: для глобальных целей нужна проверка `import.meta.client` или `typeof window`.
- `getCurrentScope()` проверяется, чтобы composable можно было вызвать и вне scope, с ручной остановкой.

Решение проверено на Vue 3.5.45 в Node 26 с `EventTarget`: перенос между целями, `null`, остановка scope.
:::

### 3. Прочитайте retainers · средне

После пяти открытий и закрытий модалки в Comparison видно `# Delta = +5` у `Detached <div class="modal">`. Retainers одного из них (упрощённо):

```text
Detached <div class="modal">
  dialogEl in system / Context
    context in function onEscape()
      [3] in Array
        listeners in Object @ eventBus
          eventBus in Window
```

Код модалки:

```js
export function openModal(content) {
  const dialogEl = renderDialog(content);
  document.body.append(dialogEl);
  function onEscape() { dialogEl.remove(); }
  eventBus.on('escape', onEscape);
  dialogEl.querySelector('.close').onclick = () => dialogEl.remove();
}
```

Объясните цепочку и исправьте.

::: details Решение и разбор
Читаем снизу вверх: глобальный `eventBus` держит объект `listeners`, в нём массив, четвёртый элемент — функция `onEscape`. Её `Context` (окружение `openModal`) содержит `dialogEl`. Модалка удалена из документа, но достижима через подписку, которую никто не снял. Пять открытий — пять подписок и пять detached-деревьев. Вдобавок каждый Escape вызывает `remove()` у всех старых модалок.

```js
export function openModal(content) {
  const dialogEl = renderDialog(content);
  document.body.append(dialogEl);

  const off = eventBus.on('escape', close);
  dialogEl.querySelector('.close').addEventListener('click', close, { once: true });

  function close() {
    off();
    dialogEl.remove();
  }
  return close;
}
```

Единая точка закрытия снимает подписку при любом способе закрытия. Обработчик на `.close` снимать не обязательно: он живёт на самой модалке и соберётся вместе с ней.
:::

### 4. Утечка на сервере Nuxt · сложно

Composable используется на странице товара. Через сутки под нагрузкой память Node-процесса выросла до лимита, а пользователи иногда видят чужие «недавно просмотренные». Найдите все проблемы и исправьте.

```ts
// app/composables/useProduct.ts
const products = new Map<string, Product>();
const recentlyViewed = ref<string[]>([]);

export async function useProduct(id: string) {
  if (!products.has(id)) products.set(id, await $fetch<Product>(`/api/products/${id}`));
  recentlyViewed.value.push(id);

  const price = ref(products.get(id)!.price);
  const timer = setInterval(async () => {
    price.value = (await $fetch<Product>(`/api/products/${id}`)).price;
  }, 10_000);
  onUnmounted(() => clearInterval(timer));

  return { product: products.get(id)!, price, recentlyViewed };
}
```

::: details Решение и разбор
1. **`setInterval` в `setup()`.** На сервере `onUnmounted` не вызывается никогда. Каждый рендер страницы запускает вечный таймер, который раз в 10 с делает запрос и держит своё замыкание (`price`, `id`). Число таймеров растёт с числом запросов, а с ним память и нагрузка на API. Перенести в `onMounted`.
2. **`recentlyViewed` на уровне модуля.** Один массив на весь процесс: растёт с каждым запросом (утечка) и попадает в ответ другим пользователям (cross-request state pollution). Это состояние пользователя: `useState` (на запрос, сериализуется в payload) или Pinia. «Недавно просмотренные» между визитами хранятся в cookie или `localStorage`, а не на сервере.
3. **`products` без ограничения.** Общий кэш непользовательских данных на сервере допустим, но число ключей не ограничено: любой перебор `id` его раздувает, а цена в нём никогда не обновляется. Варианты: LRU-кэш с TTL, кэш Nitro (`defineCachedEventHandler` или `routeRules` для `/api/products/**`) или вовсе `useFetch` с ключом.

```ts
export function useProduct(id: MaybeRefOrGetter<string>) {
  const { data: product, refresh } = useFetch(() => `/api/products/${toValue(id)}`);
  const recentlyViewed = useState<string[]>('recently-viewed', () => []);
  watch(() => toValue(id), (v) => {
    recentlyViewed.value = [v, ...recentlyViewed.value.filter((x) => x !== v)].slice(0, 10);
  }, { immediate: true });

  let timer: ReturnType<typeof setInterval> | undefined;
  onMounted(() => { // client only
    timer = setInterval(() => refresh(), 10_000);
  });
  onBeforeUnmount(() => clearInterval(timer));

  return { product, recentlyViewed };
}
```

Хуки регистрируются синхронно на верхнем уровне composable, а сам таймер создаётся только в `onMounted`, то есть только на клиенте. Ограничение списка (`slice(0, 10)`) нужно и в `useState`: состояние уходит в payload каждой страницы.
:::

### 5. Тест на утечку · сложно

Напишите юнит-тест, который падает, если composable после остановки своего scope остаётся достижимым. Проверьте им такой composable:

```js
const bus = new EventTarget();

function useBus() {
  const payload = { big: new Array(1e6).fill(0) };
  bus.addEventListener('msg', () => payload.big.length);
  return payload;
}
```

::: details Решение и разбор
Идея: держать на результат только `WeakRef`, остановить scope, принудительно собрать мусор и проверить, что цель исчезла. Запуск — `node --expose-gc`.

```js
import { effectScope, nextTick } from 'vue';
import assert from 'node:assert/strict';

async function isCollected(ref) {
  for (let i = 0; i < 10 && ref.deref(); i++) {
    await new Promise((r) => setTimeout(r, 0)); // let ClearKeptObjects run
    globalThis.gc();
  }
  return ref.deref() === undefined;
}

let ref;
const scope = effectScope();
scope.run(() => { ref = new WeakRef(useBus()); });
await nextTick();
scope.stop();
assert.ok(await isCollected(ref), 'useBus leaks after scope.stop()');
```

Тест падает: `bus` модуля держит слушатель, а тот — `payload`. С исправлением через `useEventListener` из задачи 2 (`useEventListener(bus, 'msg', handler)`) тест проходит. Оба результата проверены на Node 26 и Vue 3.5.45.

Подробности, без которых тест врёт:

- Ссылку на цель нельзя держать в локальной переменной теста: она сама стала бы корнем. Поэтому результат сразу уходит в `WeakRef`.
- `new WeakRef(target)` и `deref()` кладут цель в `[[KeptAlive]]` до конца синхронного участка. Поэтому `gc()` вызывается после `setTimeout`, а не в том же тике ([подробнее](../javascript/memory-and-gc.md#слабые-ссылки-weakref-и-finalizationregistry)).
- Сборка не гарантирована спецификацией, поэтому несколько попыток. Отрицательный результат («не собрано») надёжен только в связке с `--expose-gc`.
:::

## Источники

- [Chrome DevTools: Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems)
- [Chrome DevTools: Record heap snapshots](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots), [Allocation timeline](https://developer.chrome.com/docs/devtools/memory-problems/allocation-profiler), [Memory terminology](https://developer.chrome.com/docs/devtools/memory-problems/memory-101)
- [Chrome DevTools Protocol: `DOM.getDetachedDomNodes`](https://chromedevtools.github.io/devtools-protocol/tot/DOM/#method-getDetachedDomNodes), [`Runtime.queryObjects`](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-queryObjects)
- [WICG: Measure Memory API](https://wicg.github.io/performance-measure-memory/)
- [MDN: Performance.measureUserAgentSpecificMemory()](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory), [MDN Browser Compat Data](https://github.com/mdn/browser-compat-data)
- [MDN: WeakRef](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakRef), [FinalizationRegistry](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry)
- [MDN: EventTarget.addEventListener() — `signal`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#signal)
- [web.dev: Monitor your web page's total memory usage with measureUserAgentSpecificMemory()](https://web.dev/articles/monitor-total-page-memory-usage)
- [Vue: Server-Side Rendering — Component Lifecycle Hooks, Cross-Request State Pollution](https://vuejs.org/guide/scaling-up/ssr.html)
- [Vue: Watchers — Stopping a Watcher](https://vuejs.org/guide/essentials/watchers.html#stopping-a-watcher)
- [Vue: Reactivity API — Advanced (`effectScope`, `onScopeDispose`)](https://vuejs.org/api/reactivity-advanced.html)
- [Vue: исходники runtime-core 3.5 (`setRef`, `doWatch`, `withAsyncContext`)](https://github.com/vuejs/core/tree/v3.5.45/packages/runtime-core/src)
- [Pinia: Server Side Rendering](https://pinia.vuejs.org/ssr/), [State — Subscribing to the state](https://pinia.vuejs.org/core-concepts/state.html#Subscribing-to-the-state)
- [Nuxt: State Management](https://nuxt.com/docs/4.x/getting-started/state-management)
- [Node.js: `process.memoryUsage()`](https://nodejs.org/api/process.html#processmemoryusage), [`v8.writeHeapSnapshot()`](https://nodejs.org/api/v8.html#v8writeheapsnapshotfilename-options)
- [memlab](https://facebook.github.io/memlab/)
