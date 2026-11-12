---
title: 'Конвейер рендеринга: layout, paint, composite'
level: ядро
---

# Конвейер рендеринга: layout, paint, composite

> **Коротко.** Каждый кадр браузер проходит конвейер: **style** (вычислить стили) → **layout** (размеры и позиции) → **paint** (список команд отрисовки) → **composite** (собрать слои в кадр). Изменение запускает конвейер с того этапа, который оно затрагивает: геометрия — с layout (reflow), цвет — с paint (repaint), `transform` и `opacity` на отдельном слое — только composite, часто без главного потока. Самая частая ошибка производительности — **layout thrashing**: чтение геометрии после записи стилей заставляет браузер сделать layout синхронно, и в цикле это повторяется N раз вместо одного раза за кадр.

**Связанные темы:** [От ввода URL до отображения страницы](./from-url-to-pixels.md), [Event loop](../javascript/event-loop.md), [DOM API и observers](./dom.md), [Core Web Vitals и измерение](../performance/web-vitals.md)

## Теория

### Этапы и их результаты

Предыдущая тема довела страницу до первого кадра. Эта тема о том, что происходит в **каждом** кадре и сколько это стоит. Модель общая для движков, названия этапов и детали — разные.

| Этап | Вход | Результат | Что его запускает |
| --- | --- | --- | --- |
| **Style** (recalc style) | DOM + таблицы стилей | вычисленный стиль каждого элемента | смена класса, атрибута, inline-стиля, добавление узлов, `:hover` |
| **Layout** (reflow) | вычисленные стили | дерево блоков с размерами и позициями | изменение геометрии: `width`, `margin`, `font-size`, текст, размер окна |
| **Paint** | дерево блоков | список команд отрисовки (display list) по слоям | изменение вида без геометрии: `color`, `background`, `box-shadow`, `outline` |
| **Composite** | слои | итоговый кадр на GPU | `transform`, `opacity`, `filter` на слое, прокрутка |

«Reflow» — термин Gecko, «layout» — Blink и WebKit, на интервью это синонимы. «Repaint» — повторный paint без layout.

Главное правило: **этап запускает все последующие**, но не предыдущие. Изменили `width` — будут style, layout, paint и composite. Изменили `color` — style, paint, composite. Изменили `transform` элемента на своём слое — style и composite. Поэтому дешёвые анимации — это те, что начинаются как можно ближе к концу конвейера.

### Кадр в event loop

По HTML Living Standard рендеринг — шаг **update the rendering**, который выполняется при **возможности отрисовки** (rendering opportunity): её определяют частота экрана и троттлинг браузера. Перед шагом уже выполнены задача и все микрозадачи. Порядок внутри шага (сокращённо):

1. Документы, которые нельзя или незачем рисовать, отбрасываются: render-blocked, скрытая вкладка (`visibilityState === 'hidden'`), «ничего не изменилось и нет колбэков rAF».
2. События `resize` и `scroll`, изменения медиазапросов, обновление CSS- и Web-анимаций.
3. Колбэки **`requestAnimationFrame`** — все с одним и тем же временем кадра в аргументе.
4. **Пересчёт стилей и layout**, затем `ResizeObserver`. Если наблюдатель что-то изменил, стили и layout пересчитываются снова (только для более глубоких элементов, иначе — ошибка «ResizeObserver loop completed with undelivered notifications»).
5. `IntersectionObserver`, отметки paint timing и, наконец, «обновить отрисовку» — paint и composite.

Отсюда два вывода. Первый: rAF — **последнее** место, где можно изменить DOM до layout этого кадра, поэтому анимации пишут в rAF. Второй: всё, что вы меняете в задаче, браузер **копит** до этого шага и делает layout один раз. Если только вы сами не попросите его раньше.

> [!NOTE]
> Связь с очередями задач и микрозадач — в теме [Event loop](../javascript/event-loop.md). Там же: rAF внутри rAF выполнится в следующем кадре, а в скрытой вкладке rAF не вызывается.

### Принудительный синхронный layout и layout thrashing

Layout ленивый: запись стилей только помечает дерево «грязным». Но API, которые возвращают геометрию, обязаны вернуть **актуальное** значение. Если дерево грязное, браузер делает style и layout **синхронно**, прямо внутри вашего кода, — это forced synchronous layout (принудительный layout).

Что принуждает layout (неполный список, по движкам совпадает в основном):

- геометрия элемента: `offsetWidth/Height/Top/Left`, `clientWidth/Height`, `getBoundingClientRect()`, `getClientRects()`;
- прокрутка: чтение и запись `scrollTop/Left`, `scrollWidth/Height`, `scrollTo()`, `scrollIntoView()`;
- `window.innerWidth/Height`, `scrollX/Y`, `document.elementFromPoint()`;
- `el.focus()` (нужно знать, отрисован ли элемент), `innerText` (зависит от отрисовки, в отличие от `textContent`);
- `getComputedStyle(el).width` и другие свойства, зависящие от layout. Сам вызов `getComputedStyle` ничего не считает — пересчёт происходит при чтении свойства.

Один принудительный layout — это нормально: иногда геометрия нужна. Проблема — **чередование** записи и чтения в цикле:

```js
// Thrashing: write → read → write → read… = N layouts
for (const el of items) {
  el.style.width = container.offsetWidth / 2 + 'px';
}
```

Каждая итерация пишет стиль, а следующая читает `offsetWidth` — layout заново. Стоимость одного layout зависит от размера затронутого поддерева, в худшем случае — всей страницы. Итог — O(n) layout'ов, каждый до O(N) узлов. Исправление — разделить фазы: сначала все чтения, потом все записи. Тогда layout будет один, в кадре.

> [!TIP]
> В Chrome DevTools (Performance) принудительный layout помечается фиолетовым блоком **Layout** с предупреждением «Forced reflow is a likely performance bottleneck» и ссылкой на строку кода. Подробно о профилировании — раздел «Производительность».

### Paint и слои

Paint не рисует пиксели сразу: он строит **список команд** («прямоугольник такого цвета здесь, текст там»). Пиксели получаются на этапе **растеризации** (raster), обычно на GPU и вне главного потока.

Страница делится на **слои** (composited layers). Каждый слой растеризуется отдельно, а compositor собирает их в кадр, применяя к слою `transform`, `opacity`, обрезку и прокрутку. Если меняется только то, как слой сдвинут или прозрачен, перерисовывать и растеризовать его не нужно — достаточно собрать кадр заново.

> [!WARNING]
> Слои — деталь реализации, а не модель спецификации. **В Chromium** (RenderingNG) после paint идут commit на **compositor thread**, layerize, raster, activate и draw в процессе Viz. Анимации `transform`/`opacity` и прокрутка выполняются на compositor thread и остаются плавными, даже когда главный поток занят. Gecko (WebRender) и WebKit (Core Animation) устроены иначе, но принцип «transform и opacity не требуют layout и paint» общий.

Когда элемент получает свой слой (в Chromium, неполно): 3D-трансформ или `will-change: transform`, активная CSS-анимация `transform`/`opacity`/`filter`, `<video>`, `<canvas>` с WebGL, `position: fixed` при прокрутке. Элемент, который рисуется **поверх** слоя, тоже может быть вынесен в слой, иначе порядок наложения сломается. Это неявное повышение (overlap). Отсюда «взрыв слоёв»: тысячи слоёв занимают видеопамять и замедляют composite.

### `will-change`

`will-change` — подсказка: «это свойство скоро будет меняться, подготовьтесь». По спецификации CSS Will Change у неё есть и **видимые** эффекты. Если свойство при не начальном значении создаёт stacking context или containing block, то `will-change` с ним создаёт их **сразу**:

- `will-change: opacity` или `transform` — новый stacking context (меняется работа `z-index`);
- `will-change: transform` — containing block для `position: fixed` потомков: «фиксированная» модалка внутри такого элемента прокрутится вместе с ним.

Правила: ставить точечно и **заранее** (за кадр до анимации, например на `:hover` родителя или из JS перед стартом), снимать после. Не ставить на `*` и сотни элементов: спецификация прямо предупреждает, что это может замедлить или уронить страницу. Старый приём `transform: translateZ(0)` — то же самое без семантики подсказки.

### Как сделать изменения дешевле

- **Анимировать `transform` и `opacity`**, а не `top/left/width/height`. Движение — `translate`, раскрытие — `scale` (с компенсацией масштаба у содержимого или техникой FLIP).
- **Группировать чтения и записи** (read → write), читать геометрию в начале кадра, писать в rAF. Наблюдать размеры через `ResizeObserver`, а видимость — через `IntersectionObserver`, а не опросом `getBoundingClientRect()` в `scroll`.
- **Сужать область layout и paint**: `contain: layout paint` (или `strict`/`content`) говорит браузеру, что изменения внутри элемента не влияют на внешний мир. `content-visibility: auto` пропускает layout и paint содержимого вне экрана. Пару ей составляет `contain-intrinsic-size: auto 500px`, иначе пропущенный блок схлопнется (Baseline 2024).
- **Рендерить меньше**: виртуализация длинных списков, меньше DOM-узлов, проще селекторы на часто меняющихся элементах.

> [!NOTE]
> Мостик к разделу «Производительность»: долгий кадр ухудшает **INP**, сдвиг блоков после layout — **CLS** (подробно — «[Core Web Vitals и измерение](../performance/web-vitals.md)»). Найти виновника помогают Performance-панель и Long Animation Frames API (в Chromium): у записи есть `forcedStyleAndLayoutDuration` по каждому скрипту.

### Vue: где рождается layout

Vue обновляет DOM в одной микрозадаче после изменения состояния (подробно — «Event loop»). Поэтому десять изменений подряд дают **один** патч DOM и один layout в кадре: батчинг уже встроен. Ломается он там же, где и в обычном JS: в `onMounted`, `onUpdated`, `watch` с `flush: 'post'` или после `await nextTick()` код читает геометрию, пишет стили и снова читает.

Встроенные компоненты анимации сами пользуются конвейером (сверено по исходникам `@vue/runtime-dom` 3.5.45):

- `<Transition>` при входе вешает классы `*-enter-from` и `*-enter-active`, а `*-enter-to` ставит через **двойной rAF** (`nextFrame`): нужен хотя бы один кадр, посчитанный с начальным состоянием, иначе переход не запустится. При уходе — принудительный reflow (`document.body.offsetHeight`) между `leave-from` и `leave-active`.
- `<TransitionGroup>` анимирует перемещения техникой **FLIP**: запоминает `getBoundingClientRect()` до обновления, после патча измеряет снова, задаёт обратный `transform`, делает `forceReflow` и снимает `transform` с классом `*-move`. Всё перемещение анимируется дешёвым `transform`.

## Примеры

```js
// Which stage does a change start from?
el.style.width = '200px';          // style → layout → paint → composite
el.style.backgroundColor = 'red';  // style → paint → composite
el.style.transform = 'translateX(100px)'; // style → composite (if on its own layer)
el.style.opacity = '0.5';          // style → composite (if on its own layer)
```

```js
// Read phase and write phase: one layout instead of N
const width = container.offsetWidth;            // read (may force one layout)
const heights = items.map((el) => el.offsetHeight); // reads: layout is clean, cheap
items.forEach((el, i) => {
  el.style.width = width / 2 + 'px';            // writes: only mark the tree dirty
  el.style.minHeight = heights[i] + 'px';
});
// The browser lays out once, in the next frame
```

```js
// JS animation: per-frame writes in rAF, compositor-friendly property
function slideIn(el, duration = 300) {
  const start = performance.now();
  function frame(now) {
    const p = Math.min((now - start) / duration, 1);
    el.style.transform = `translateX(${(1 - p) * -100}%)`; // no layout, no paint
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Better: declarative animation can run on the compositor thread (Chromium)
el.animate(
  [{ transform: 'translateX(-100%)' }, { transform: 'none' }],
  { duration: 300, easing: 'ease-out' },
);
```

```css
/* Long page: skip layout and paint of off-screen sections */
.feed-section {
  content-visibility: auto;
  contain-intrinsic-size: auto 600px; /* placeholder size, then the last rendered size */
}

/* Hint right before the animation, not forever */
.menu:hover .menu__panel { will-change: transform; }
```

## Вопросы с интервью

::: details Какие этапы проходит браузер, чтобы показать изменение на экране
Style — пересчитать стили затронутых элементов. Layout — вычислить размеры и позиции блоков. Paint — построить список команд отрисовки по слоям. Composite — растеризовать слои (обычно на GPU) и собрать из них кадр. Изменение начинает конвейер с первого затронутого этапа и проходит все последующие. В event loop это шаг update the rendering, примерно раз в кадр, после задачи и всех микрозадач: события `resize`/`scroll`, анимации, колбэки rAF, style и layout, `ResizeObserver`, `IntersectionObserver`, отрисовка. Браузер копит изменения до этого шага, поэтому изменения в одной задаче дают один layout.
:::

::: details Чем reflow отличается от repaint и что их вызывает
Reflow (layout) — пересчёт геометрии: размеров и позиций. Его вызывают изменения, влияющие на блоки: `width`, `height`, `margin`, `padding`, `font-size`, `display`, текст, добавление и удаление узлов, размер окна. За reflow всегда следуют paint и composite. Repaint — перерисовка без смены геометрии: `color`, `background`, `box-shadow`, `visibility`. Reflow обычно дороже: изменение размера одного блока может сдвинуть соседей и предков, а в худшем случае — всю страницу. Дешевле обоих — изменения, которые решает compositor: `transform` и `opacity` на собственном слое.
:::

::: details Почему анимировать transform и opacity дешевле, чем top и width
`top`, `left`, `width` меняют геометрию, поэтому каждый кадр анимации — layout, paint и растеризация, всё на главном потоке. `transform` и `opacity` не влияют на соседей: если элемент на своём слое, слой не перерисовывается, compositor только иначе сдвигает или смешивает его. В Chromium CSS-анимации и Web Animations этих свойств выполняются на compositor thread и остаются плавными, даже когда главный поток занят JS. Оговорки: слой стоит видеопамяти; анимация `transform` через rAF всё равно требует главного потока каждый кадр, хотя и без layout; `transform` не меняет место в потоке — соседи не подвинутся, если нужна именно перестройка, применяют FLIP.
:::

::: details Что такое layout thrashing и как его избежать
Layout ленивый: запись стилей только помечает дерево грязным. Чтение геометрии (`offsetHeight`, `getBoundingClientRect`, `scrollTop`, `getComputedStyle(el).width`, `innerText`, даже `focus()`) обязано вернуть актуальное значение и заставляет браузер сделать layout синхронно. Если в цикле чередовать запись и чтение, layout будет на каждой итерации — это thrashing: O(n) layout'ов вместо одного. Решения: разделить фазы — сначала все чтения, затем все записи; писать в rAF, а читать до записей; кэшировать размеры и обновлять их через `ResizeObserver`; не опрашивать геометрию в обработчике `scroll`, а использовать `IntersectionObserver`. Найти — по фиолетовым блокам Layout с пометкой forced reflow в DevTools.
:::

::: details Что делает will-change и почему его нельзя ставить всем элементам
Это подсказка, что свойство скоро будет меняться. Браузер может заранее подготовиться, например вынести элемент на слой, чтобы первый кадр анимации не стоил растеризации. У неё есть видимые эффекты: `will-change: transform` или `opacity` создаёт stacking context, а `transform` ещё и containing block для `position: fixed` потомков — фиксированный элемент внутри начнёт прокручиваться. Массовое применение — это тысячи слоёв, расход видеопамяти, медленный composite, на слабых устройствах — падение вкладки. Ставят точечно, незадолго до анимации и снимают после.
:::

::: details Когда выполняется requestAnimationFrame и почему чтение геометрии в нём может всё равно стоить дорого
Колбэки rAF выполняются в шаге update the rendering перед пересчётом стилей и layout кадра — это последняя возможность изменить DOM до отрисовки. Все колбэки кадра получают одно и то же время. Если в начале колбэка дерево чистое, чтение геометрии дешёвое. Но если до этого в той же задаче или в предыдущем колбэке rAF стили изменили, первое же чтение запустит принудительный layout, а потом браузер может сделать ещё один в кадре. Правило: в начале кадра читать, в конце писать. Библиотеки вроде fastdom собирают чтения и записи в две очереди и выполняют их в rAF: сначала все `measure`, потом все `mutate`.
:::

::: details Как сократить стоимость layout и paint на большой странице
Уменьшить объём работы: меньше DOM-узлов, виртуализация длинных списков, ленивый рендер скрытых вкладок. Сузить область пересчёта: `contain: layout paint` или `content` изолирует элемент, и изменения внутри не заставляют пересчитывать остальную страницу. `content-visibility: auto` пропускает layout и paint содержимого вне экрана, а `contain-intrinsic-size` задаёт ему размер-заглушку, чтобы не прыгала полоса прокрутки. Убрать thrashing и тяжёлые эффекты на часто перерисовываемых элементах (большие `box-shadow`, `filter: blur`). Измерять, а не гадать: Performance-панель, Rendering → Paint flashing и Layer borders.
:::

::: details Почему Vue Transition ждёт два кадра перед добавлением класса enter-to
CSS-переход запускается, только когда браузер видит, что вычисленное значение изменилось между двумя пересчётами стилей. Если вставить элемент с `enter-from` и в той же задаче заменить его на `enter-to`, браузер посчитает стиль один раз — уже конечный, и перехода не будет. Один rAF не помогает: его колбэк выполняется до пересчёта стилей того же кадра, начальное состояние так и не будет посчитано. Двойной rAF гарантирует, что один кадр прошёл с `enter-from`, и замена на `enter-to` во втором кадре запустит переход. Для ухода Vue вместо этого делает принудительный reflow (`document.body.offsetHeight`). Современная альтернатива на чистом CSS — `@starting-style` (Baseline 2024).
:::

## Задачи

### 1. С какого этапа начнётся конвейер · легко

Для каждого изменения назовите первый этап конвейера и объясните. Элемент `.card` не на отдельном слое, если не сказано иное.

1. `card.style.padding = '24px'`
2. `card.style.color = 'gray'`
3. `card.style.transform = 'scale(1.05)'`, у `.card` есть `will-change: transform`
4. `card.classList.add('is-hidden')`, где `.is-hidden { visibility: hidden }`
5. `card.classList.add('is-hidden')`, где `.is-hidden { display: none }`
6. `card.textContent = 'New title'`

::: details Решение и разбор
1. **Layout.** Padding меняет размер блока и может сдвинуть соседей.
2. **Paint.** Геометрия та же, меняется только вид.
3. **Composite.** Элемент на своём слое: слой не перерисовывается, compositor применяет масштаб. Без своего слоя изменение `transform` обойдётся без layout, но потребует paint.
4. **Paint.** `visibility: hidden` сохраняет место в потоке: геометрия не меняется, элемент просто не рисуется.
5. **Layout.** `display: none` убирает блок из дерева, соседи сдвигаются.
6. **Layout.** Текст меняет размер строки и, возможно, блока. Даже если ширина совпала, браузер должен заново разбить текст на строки.

Все шесть начинаются со **style**: сначала пересчитываются стили, а уже потом выясняется, что задето. «Первый этап» на интервью обычно означает самый ранний дорогой этап после style.
:::

### 2. Найти и исправить layout thrashing · средне

Функция выравнивает высоты карточек в ряду по самой высокой. На 300 карточках она работает 200 мс. Почему и как исправить?

```js
function equalizeHeights(cards) {
  for (const card of cards) {
    card.style.height = 'auto';
    const max = Math.max(...cards.map((c) => c.offsetHeight));
    card.style.height = max + 'px';
  }
}
```

::: details Решение и разбор
```js
function equalizeHeights(cards) {
  // Write phase 1: reset
  for (const card of cards) card.style.height = 'auto';
  // Read phase: the first read forces one layout, the rest are cheap
  const max = Math.max(...cards.map((c) => c.offsetHeight));
  // Write phase 2: only marks the tree dirty, layout happens once in the frame
  for (const card of cards) card.style.height = max + 'px';
}
```

- В исходнике две беды. Первая — **алгоритмическая**: внутри цикла снова обходятся все карточки, O(n²) чтений. Вторая — **thrashing**: на каждой итерации запись `height`, а затем чтение `offsetHeight` заставляют браузер сделать layout. Получается n принудительных layout'ов, каждый по всему ряду.
- В исправлении — один принудительный layout (после сброса нужны реальные высоты) и один в кадре. Чтения и записи O(n).
- Ещё лучше — не считать вовсе: CSS Grid или Flexbox с `align-items: stretch` выравнивают высоту в рамках строки сами, на этапе layout, без JS.
- Если функция вызывается на `resize`, обернуть её в rAF или вызывать из `ResizeObserver` — не чаще раза в кадр.

Сложность: было O(n²) чтений и O(n) layout'ов, стало O(n) и 1–2 layout'а.
:::

### 3. Планировщик чтений и записей · средне

Реализуйте `measure(fn)` и `mutate(fn)`: колбэки копятся и выполняются один раз в ближайшем кадре — сначала **все** `measure`, затем **все** `mutate`. Функции возвращают промис с результатом колбэка. Код из разных компонентов не должен вызывать thrashing, даже если вызывает их вперемешку.

::: details Решение и разбор
```js
const reads = [];
const writes = [];
let scheduled = false;

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(flush);
}

function run(queue) {
  // splice: callbacks queued during the flush go to the next batch
  for (const { fn, resolve, reject } of queue.splice(0)) {
    try {
      resolve(fn());
    } catch (err) {
      reject(err);
    }
  }
}

function flush() {
  scheduled = false;
  run(reads);  // the tree is clean at the start of the frame: reads are cheap
  run(writes); // writes only mark the tree dirty
  // the browser does style and layout once, right after rAF callbacks
}

function enqueue(queue, fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    schedule();
  });
}

export const measure = (fn) => enqueue(reads, fn);
export const mutate = (fn) => enqueue(writes, fn);
```

- Пример: `const h = await measure(() => el.offsetHeight); await mutate(() => (other.style.height = h + 'px'))`. Продолжение после `await measure` выполнится микрозадачей **после** всего колбэка rAF, то есть после записей этого кадра. `mutate` из него уйдёт в **следующий** кадр. Это осознанная цена: задержка в кадр вместо thrashing.
- Почему `splice(0)`: `measure`, поставленный изнутри `mutate`, должен попасть в следующий кадр, а не прочитать грязное дерево сразу после записей.
- Ошибка одного колбэка не роняет остальные — у каждого свой `reject`.
- Ограничение: дерево чистое в начале rAF, только если до него в этой задаче никто не писал стили. Поэтому такие библиотеки работают, только когда **весь** код с DOM идёт через них. Так устроена fastdom.

Сложность: O(r + w) на кадр, один layout после записей вместо одного на каждую пару «запись → чтение».
:::

### 4. Переход, который не запускается · средне

Тост должен плавно появляться, но появляется сразу. Почему? Предложите три исправления.

```css
.toast { opacity: 0; transition: opacity 0.3s; }
.toast--visible { opacity: 1; }
```

```js
const toast = document.createElement('div');
toast.className = 'toast';
toast.textContent = 'Saved';
document.body.append(toast);
toast.classList.add('toast--visible');
```

::: details Решение и разбор
Переход запускается, когда вычисленное значение меняется между двумя пересчётами стилей. Здесь элемент вставлен и получил оба класса в одной задаче. Браузер пересчитает стиль один раз, в кадре, — сразу с `opacity: 1`. «До» у нового элемента не было, переходить не от чего.

1. **Принудительно посчитать начальный стиль:**

   ```js
   document.body.append(toast);
   toast.getBoundingClientRect(); // or getComputedStyle(toast).opacity — forces style
   toast.classList.add('toast--visible');
   ```

   Просто и синхронно, но это принудительный пересчёт: в цикле по многим элементам получится thrashing. Для `opacity` хватило бы пересчёта стилей без layout, но `getBoundingClientRect()` сделает и layout. Так поступает Vue `<Transition>` при уходе (`document.body.offsetHeight`).

2. **Двойной rAF:**

   ```js
   document.body.append(toast);
   requestAnimationFrame(() => {
     requestAnimationFrame(() => toast.classList.add('toast--visible'));
   });
   ```

   Первый кадр рисует `opacity: 0`, во втором класс меняет значение — переход запускается. Одного rAF мало: его колбэк выполняется **до** пересчёта стилей того же кадра. Так поступает Vue `<Transition>` при входе (`nextFrame`). Минус — задержка на кадр.

3. **`@starting-style`** — без JS-трюков (Baseline 2024):

   ```css
   .toast { opacity: 1; transition: opacity 0.3s; }
   @starting-style {
     .toast { opacity: 0; }
   }
   ```

   Стиль из `@starting-style` используется как «до» при первом вычислении стиля элемента. Работает и при переходе из `display: none` (вместе с `transition-behavior: allow-discrete`).

В реальном Vue-приложении — просто `<Transition name="toast">`: компонент делает вариант 2 сам.
:::

### 5. FLIP-анимация перестановки · сложно

Реализуйте `flip(elements, mutate, duration = 300)`: `mutate()` меняет DOM (сортировка, фильтр, добавление в начало), а элементы, которые остались, плавно переезжают на новые места. Анимировать только `transform`, без layout в каждом кадре.

::: details Решение и разбор
```js
function flip(elements, mutate, duration = 300) {
  // First: positions before the change (getBoundingClientRect includes transforms,
  // so an element caught mid-animation starts from where it is visible)
  const first = new Map(elements.map((el) => [el, el.getBoundingClientRect()]));

  mutate();

  // Last: measure everything before any write — one forced layout total
  const moves = [];
  for (const el of elements) {
    if (!el.isConnected) continue; // removed by mutate
    const last = el.getBoundingClientRect();
    const dx = first.get(el).left - last.left;
    const dy = first.get(el).top - last.top;
    if (dx || dy) moves.push({ el, dx, dy });
  }

  // Invert + Play: start at the old place, animate to the new one
  return Promise.all(
    moves.map(({ el, dx, dy }) =>
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration, easing: 'ease' },
      ).finished,
    ),
  );
}

// Usage
flip([...list.children], () => {
  list.append(...[...list.children].sort(byPrice));
});
```

- **F**irst — измерить до изменения, **L**ast — после, **I**nvert — сдвинуть элемент `transform` обратно на старое место, **P**lay — анимировать `transform` к нулю. Дорогой layout происходит **один** раз, сразу после `mutate`, а все кадры анимации — только composite.
- Ключевая деталь — **сначала все измерения Last, потом все `animate`**. Если вызывать `animate` внутри цикла измерений, каждый следующий `getBoundingClientRect()` будет видеть грязные стили и заставит пересчитать их — тот же thrashing.
- Измерения «до» учитывают текущий `transform`. Поэтому прерванная анимация начнётся с видимой позиции, а не прыгнет. Так делает и `<TransitionGroup>`. Если элементы меняют размер, к `translate` добавляют `scale` (отношение старой ширины к новой) и компенсируют масштаб у содержимого.
- Web Animations API вместо rAF: анимацию `transform` браузер может выполнять на compositor thread (в Chromium), а `.finished` даёт промис без подписки на `transitionend`.
- Во Vue эту задачу решает `<TransitionGroup>` с классом `*-move`: те же шаги, только с CSS-переходом и `forceReflow` вместо `animate`.

Сложность: O(n) измерений, один принудительный layout; каждый кадр анимации — O(1) работы главного потока на элемент или ноль, если анимация на compositor.
:::

## Источники

- [HTML Living Standard: Event loop processing model — update the rendering](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model), [Animation frames](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animation-frames)
- [W3C: CSS Will Change Module Level 1](https://www.w3.org/TR/css-will-change-1/); [CSS Containment Module Level 2](https://www.w3.org/TR/css-contain-2/) — `contain`, `content-visibility`; [CSS Transitions Level 2](https://www.w3.org/TR/css-transitions-2/) — `@starting-style`; [Web Animations](https://www.w3.org/TR/web-animations-1/)
- [MDN: Populating the page: how browsers work](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work), [requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame), [will-change](https://developer.mozilla.org/en-US/docs/Web/CSS/will-change), [content-visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility), [@starting-style](https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style), [Element.animate()](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate)
- [Chrome for Developers: RenderingNG architecture](https://developer.chrome.com/docs/chromium/renderingng-architecture), [Inside look at modern web browser (part 3)](https://developer.chrome.com/blog/inside-browser-part3), [Long Animation Frames API](https://developer.chrome.com/docs/web-platform/long-animation-frames)
- [web.dev: Avoid large, complex layouts and layout thrashing](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing), [Stick to compositor-only properties and manage layer count](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count), [content-visibility](https://web.dev/articles/content-visibility)
- [Paul Irish: What forces layout / reflow](https://gist.github.com/paulirish/5d52fb081b3570c81e3a)
- [Vue: Transition](https://vuejs.org/guide/built-ins/transition.html), [TransitionGroup](https://vuejs.org/guide/built-ins/transition-group.html); исходники `@vue/runtime-dom` 3.5.45 — `Transition.ts`, `TransitionGroup.ts`
- [Paul Lewis: FLIP your animations](https://aerotwist.com/blog/flip-your-animations/); [fastdom](https://github.com/wilsonpage/fastdom)
