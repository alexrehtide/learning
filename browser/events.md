---
title: События и событийная модель
level: ядро
---

# События и событийная модель

> **Коротко.** Событие диспатчится (dispatch) по **пути**, который вычисляется заранее: от `window` вниз к цели (capture), на самой цели (target), обратно вверх (bubble, если `bubbles: true`). На каждом узле вызываются слушатели этого узла — клон списка на момент входа. `stopPropagation` останавливает путь, но не остальные слушатели текущего узла; `stopImmediatePropagation` — и их. `preventDefault` отменяет действие по умолчанию, если событие `cancelable` и слушатель не `passive`. На всплытии держится делегирование: один слушатель на предке вместо тысячи на элементах. `dispatchEvent` синхронный, и синтетические события, кроме `click`, не запускают действий браузера.

**Связанные темы:** [DOM API и observers](./dom.md), [Event loop](../javascript/event-loop.md), [Конвейер рендеринга: layout, paint, composite](./rendering-pipeline.md), [async/await, обработка ошибок и отмена](../javascript/async-await.md), [Память и сборка мусора](../javascript/memory-and-gc.md)

## Теория

### `Event` и `EventTarget`

Событие — объект `Event` (или подкласса: `MouseEvent`, `KeyboardEvent`, `PointerEvent`, `CustomEvent`). Слушателей держит `EventTarget`: это узлы DOM, `window`, `AbortSignal`, `WebSocket`, `Worker` и любой ваш класс — `class Store extends EventTarget {}`. У события есть флаги, которые задаются при создании и потом не меняются:

| Флаг | Что значит | По умолчанию в `new Event()` |
| --- | --- | --- |
| `bubbles` | после цели идти вверх | `false` |
| `cancelable` | `preventDefault()` имеет силу | `false` |
| `composed` | выходить за границу shadow root | `false` |

Нативные события задают флаги сами: `click`, `input`, `keydown`, `submit` всплывают и, кроме `input`, отменяемы. `focus`, `blur`, `mouseenter`, `mouseleave`, `load` — не всплывают.

### Диспатч: путь и три фазы

Алгоритм dispatch из DOM Standard:

1. **Путь** строится **до** вызова слушателей: цель и её предки до `document` и `window` (с учётом shadow DOM). Перенос узла посреди диспатча путь не меняет.
2. **Capture** — от `window` вниз до родителя цели, `eventPhase === 1`. Вызываются слушатели с `capture: true`.
3. **Target** — на цели, `eventPhase === 2`. Сначала слушатели с `capture: true`, затем остальные.
4. **Bubble** — от родителя цели вверх, `eventPhase === 3`, только если `bubbles`. Вызываются слушатели без `capture`.

Capture-фаза идёт **всегда**, даже у невсплывающих событий. Поэтому `focus` или `error` картинки можно поймать на предке, если слушать с `capture: true`.

> [!NOTE]
> Правило «на цели сначала capture» — относительно новое. Раньше браузеры вызывали слушатели на цели в порядке регистрации, независимо от `capture`, и в старых статьях встречается именно это. Текущий порядок по DOM Standard проверен в Chromium 157.

Детали, о которых спрашивают:

- На каждом узле вызывается **клон** списка слушателей на момент входа в узел. Слушатель, добавленный во время диспатча на **текущий** узел, в этот раз не вызовется. А добавленный на узел **дальше по пути** — вызовется: его список ещё не клонирован (задача 2). Удалённый во время диспатча слушатель не вызывается, даже если попал в клон.
- Исключение в слушателе **не прерывает** диспатч: браузер сообщает о нём (`window.onerror`, консоль) и вызывает следующих. `dispatchEvent` не бросает.
- `dispatchEvent` **синхронный**: слушатели отработают до возврата. Возвращает `false`, если событие отменили. Повторно диспатчить событие, которое ещё в полёте, нельзя (`InvalidStateError`); после завершения — можно.
- `event.target` — где событие началось, `event.currentTarget` — чей слушатель сейчас работает. После диспатча `currentTarget` становится `null`, `eventPhase` — `0`.

### Остановка распространения

| Метод | Что делает |
| --- | --- |
| `stopPropagation()` | дальше по пути не идти; остальные слушатели **текущего** узла вызываются |
| `stopImmediatePropagation()` | то же и сразу прекратить вызов слушателей текущего узла |
| `preventDefault()` | отменить действие по умолчанию; распространение не трогает |

Тонкость: на цели capture- и bubble-слушатели вызываются двумя отдельными проходами, а флаг остановки проверяется перед каждым. Поэтому `stopPropagation()` в capture-слушателе **цели** не даст вызваться обычным слушателям той же цели (проверено в Chromium 157).

`stopPropagation` в прикладном коде — почти всегда запах. Он ломает всё, что слушает выше: «клик снаружи» у соседнего меню, аналитику на `document`, делегирование фреймворка. Если нужно «это событие уже обработано», лучше проверить `event.defaultPrevented` или собственную метку.

### Действие по умолчанию

Действие по умолчанию — то, что браузер сделает после диспатча: перейдёт по ссылке, отправит форму, переключит чекбокс, прокрутит страницу, вставит символ. `preventDefault()` выставляет флаг отмены, если событие `cancelable` и слушатель не `passive`. Иначе вызов молча игнорируется. Прочитать флаг — `event.defaultPrevented`.

- Обработчик-свойство (`el.onclick = …`, атрибут `onclick`), вернувший `false`, отменяет событие — как `preventDefault()`. Для `addEventListener` возвращаемое значение ничего не значит.
- У `click` часть работы делается **до** слушателей: чекбокс переключается сразу, и внутри обработчика `checked` уже новый. Если отменить событие, браузер откатит значение после диспатча (legacy-canceled-activation behavior).
- Отмену нужно решить **синхронно**, пока событие в диспатче. Отмена после `await` — ловушка (задача 4).

### Опции `addEventListener`

```js
el.addEventListener(type, listener, { capture, once, passive, signal });
el.addEventListener(type, listener, true); // legacy form: capture only
```

- **Идентичность** слушателя — тройка (`type`, `listener`, `capture`). Повторный `addEventListener` с той же тройкой ничего не делает, даже с другими `passive`/`once`. Снять — `removeEventListener` с тем же `capture`: слушатель, добавленный с `capture: true`, без него не снимется. Анонимную функцию так не снять вовсе.
- **`once`** — слушатель снимается перед первым вызовом.
- **`signal`** — `controller.abort()` снимает слушатель. Один контроллер снимает сразу все слушатели компонента. С уже отменённым сигналом слушатель не добавляется.
- **`passive`** — обещание не вызывать `preventDefault()`. Прокрутка колёсиком и касанием отменяема. Пока не отработают все неpassive-слушатели `wheel`/`touchmove`, браузер не знает, можно ли прокручивать, и композитор ждёт главный поток. Пассивный слушатель снимает это ожидание.
- **Default passive.** Для `touchstart`, `touchmove`, `wheel`, `mousewheel` на `window`, `document`, `<html>` и `<body>` по умолчанию `passive: true` (DOM Standard). Поэтому `preventDefault()` в `document.addEventListener('touchmove', …)` молча не работает. Нужен явный `{ passive: false }`, а лучше CSS `touch-action` или `overscroll-behavior`.
- Слушатель — функция или объект с методом `handleEvent(event)`; во втором случае `this` — сам объект.

Обработчик-свойство (`onclick`) — один слот на событие. Его место в списке слушателей фиксируется при первом присваивании. Новое значение место сохраняет, а `null` удаляет: следующее присваивание встанет в конец.

### Делегирование

Один слушатель на общем предке вместо слушателя на каждом элементе:

```js
list.addEventListener('click', (event) => {
  const item = event.target.closest('[data-id]');
  if (!item || !list.contains(item)) return; // click outside items or above the list
  select(item.dataset.id);
});
```

Плюсы: меньше слушателей и памяти, работает для элементов, добавленных позже, не нужно снимать слушатели с удалённых узлов. Ограничения:

- `event.target` — самый глубокий элемент (`<span>` внутри кнопки), поэтому нужен `closest`. `contains` отсекает совпадения **выше** контейнера, если селектор подходит и к предку.
- Невсплывающие события: `focus`/`blur` → всплывающие `focusin`/`focusout`, `mouseenter`/`mouseleave` → `mouseover`/`mouseout` (или `pointerover`/`pointerout`), `scroll` на элементе не всплывает. Или ловить в capture-фазе.
- `stopPropagation` внутри ломает делегирование выше.
- Клик по `<label>` порождает **второй** `click` — на связанном поле. Делегированный обработчик на форме получит оба.

### Trusted и синтетические события

`event.isTrusted === true`, только если событие создал браузер в ответ на действие пользователя или в рамках своего алгоритма. События из `new Event()` + `dispatchEvent()` и из `el.click()` — **недоверенные**.

- Синтетические события **не запускают действий по умолчанию**: `new KeyboardEvent('keydown', { key: 'a' })` не введёт символ, синтетический `wheel` не прокрутит. Исключение — `click`: `el.click()` и `dispatchEvent` с объектом `MouseEvent` (в том числе `PointerEvent`) запускают activation behavior — чекбокс переключается, ссылка открывается. Простой `new Event('click')` — не запускает.
- Некоторые API требуют **user activation** (открыть попап, полноэкранный режим, запись в буфер обмена). Синтетический `click()` из таймера её не даёт.
- `CustomEvent` несёт данные в `detail`. Свои события называют без префикса `on` и в нижнем регистре. Чтобы они были видны предкам, нужен `bubbles: true`, а через shadow DOM — ещё и `composed: true`. `EventTarget` с `CustomEvent` годится и как emitter без DOM-узла: сравнение со своей реализацией — в теме [EventEmitter](../live-coding/event-emitter.md).

### Shadow DOM

Путь события проходит через shadow root к хосту, только если `composed: true`; все нативные UI-события такие. При выходе наружу `target` **перенацеливается** (retargeting) на хост: внешний код не видит внутренние узлы. `event.composedPath()` возвращает путь, видимый вызывающему: изнутри — с внутренними узлами, снаружи закрытого (`closed`) root — без них. Поэтому «клик снаружи» для компонентов с shadow DOM проверяют через `composedPath().includes(el)`, а не через `el.contains(event.target)`.

### Обработчики и микрозадачи

При действии пользователя браузер вызывает каждый слушатель со **своего пустого стека**, поэтому микрозадачи выполняются **между** слушателями. При `el.click()` или `dispatchEvent` из скрипта на стеке остаётся вызвавший код, и микрозадачи ждут конца всего диспатча. Порядок разобран в задаче 3 темы [Event loop](../javascript/event-loop.md). Отсюда две практические вещи:

- Тест, который кликает через `click()`, видит другой порядок, чем пользователь.
- Vue обновляет DOM в микрозадаче. При настоящем клике патч может случиться **посреди** всплытия, между слушателями ребёнка и родителя.

### Vue и события

Сверено по исходникам `@vue/runtime-dom` и `@vue/compiler-dom` 3.5.45.

- **Invoker.** `@click="handler"` вешает на элемент **один** нативный слушатель — функцию-invoker. При обновлении меняется только `invoker.value`, `removeEventListener`/`addEventListener` не вызываются. Ошибки обработчика идут через `callWithAsyncErrorHandling` в `app.config.errorHandler`.
- **Защита от слушателей, подключённых во время всплытия.** Invoker помнит момент подключения (`invoker.attached`), а событие получает метку `e._vts` при первом invoker'е. Если invoker подключён позже, чем событие началось, он его пропускает. Без этого клик по кнопке «открыть» менял бы состояние, патч в микрозадаче вешал бы обработчик «закрыть» на родителя, и тот срабатывал бы на том же клике (задача 2).
- **Модификаторы.** `.capture`, `.once`, `.passive` становятся опциями `addEventListener`: компилятор кодирует их в имени пропа (`onClickCaptureOnce`). `.stop`, `.prevent`, `.self`, клавиши и кнопки мыши — проверки-обёртки `withModifiers`/`withKeys` вокруг обработчика. Они выполняются **по порядку**: `@click.prevent.self` отменяет клики и по детям, `@click.self.prevent` — только по самому элементу. `@click.right` компилируется в `contextmenu`, `@click.middle` — в `mouseup`.
- `.passive` вместе с `.prevent` компилируется без ошибки, но `preventDefault` в пассивном слушателе не сработает, и браузер напишет предупреждение в консоль.
- **События компонентов — не DOM-события.** `emit('select')` синхронно вызывает функцию из пропа `onSelect` родителя: всплытия нет, `stopPropagation` не нужен и невозможен. Слушатель, который компонент не объявил в `emits`, проходит через `$attrs` на корневой элемент как **нативный** (`.native` из Vue 2 больше не нужен). Объявите `click` в `emits` — и родитель перестанет получать нативный клик по корню.
- `defineCustomElement` превращает `emit` в `CustomEvent` на хосте, аргументы — массивом в `detail`. По умолчанию событие не всплывает. Если первый аргумент — простой объект, его поля становятся опциями события: `emit('change', { bubbles: true, composed: true })`.

## Примеры

```js
// Teardown of many listeners with one AbortController
function mountWidget(root) {
  const controller = new AbortController();
  const { signal } = controller;
  window.addEventListener('resize', onResize, { signal, passive: true });
  document.addEventListener('keydown', onKeydown, { signal });
  root.addEventListener('click', onClick, { signal });
  return () => controller.abort(); // removes all three
}
```

```js
// Catch non-bubbling events on an ancestor via the capture phase
document.addEventListener('error', (event) => {
  if (event.target instanceof HTMLImageElement) event.target.src = '/fallback.png';
}, { capture: true }); // 'error' on <img> does not bubble, but capture always runs

form.addEventListener('focusout', (event) => validate(event.target)); // focusout bubbles, blur does not
```

```js
// A typed event bus on top of EventTarget
class CartEvents extends EventTarget {
  add(item) {
    this.dispatchEvent(new CustomEvent('add', { detail: item })); // synchronous
  }
}
const cart = new CartEvents();
cart.addEventListener('add', (e) => console.log(e.detail.id), { once: true });
cart.add({ id: 1 });
```

```vue
<template>
  <!-- Native listener options: capture + once; guard: stop -->
  <div @click.capture.once.stop="onFirstClick">…</div>
  <!-- Passive scroll listener: never blocks scrolling -->
  <div @scroll.passive="onScroll">…</div>
  <!-- Order matters: only clicks on the overlay itself close the modal -->
  <div class="overlay" @click.self="close"><div class="modal">…</div></div>
  <input @keydown.enter.exact="submit" @keydown.ctrl.enter="submitAll" />
</template>
```

## Вопросы с интервью

::: details Расскажите, как событие проходит по DOM
Перед вызовом слушателей браузер строит путь: цель и все её предки до `document` и `window`. Сначала capture-фаза — от `window` вниз до родителя цели, вызываются слушатели с `capture: true`. Затем цель: по текущей спецификации сначала её capture-слушатели, потом обычные. Затем bubble-фаза — от родителя вверх, если у события `bubbles: true`. На каждом узле вызывается клон списка слушателей на момент входа: добавленные на этот узел во время диспатча не вызовутся, а добавленные на узлы выше по пути — вызовутся. Исключение в слушателе не прерывает диспатч. `dispatchEvent` синхронный и возвращает `false`, если событие отменили. Capture-фаза идёт и у невсплывающих событий, поэтому `focus` можно поймать на предке с `capture: true`.
:::

::: details Чем отличаются stopPropagation, stopImmediatePropagation и preventDefault
`stopPropagation` запрещает событию идти к следующим узлам пути, но слушатели текущего узла дорабатывают. `stopImmediatePropagation` вдобавок прекращает вызов оставшихся слушателей этого узла. `preventDefault` не связан с распространением: он отменяет действие по умолчанию (переход по ссылке, отправку формы, прокрутку), если событие `cancelable` и слушатель не `passive`. Событие при этом продолжает всплывать, а предки видят `defaultPrevented === true`. В прикладном коде `stopPropagation` — запах: он ломает «клик снаружи», аналитику и делегирование выше. Вместо него лучше проверять `defaultPrevented` или отсекать по `target`.
:::

::: details Что такое делегирование событий и где оно не работает
Один слушатель на общем предке вместо слушателей на каждом элементе. В нём `event.target.closest(selector)` находит нужный элемент, а `container.contains(item)` отсекает совпадения выше контейнера. Плюсы: меньше памяти и подписок, работает для элементов, добавленных позже, ничего не нужно снимать при удалении строк. Не работает напрямую для невсплывающих событий — `focus`/`blur`, `mouseenter`/`mouseleave`, `scroll` на элементе, `load`/`error` ресурсов. Для них есть всплывающие аналоги (`focusin`/`focusout`, `mouseover`/`mouseout`) или capture-фаза. Ломается, если кто-то ниже вызвал `stopPropagation`. И помните, что клик по `<label>` даёт второй `click` на поле.
:::

::: details Зачем нужен passive и что такое default passive
Прокрутку колёсиком и касанием можно отменить через `preventDefault`. Поэтому, пока не отработают все не-passive слушатели `wheel`/`touchmove`, композитор не может начать прокрутку и ждёт главный поток. Если тот занят, прокрутка дёргается. `passive: true` — обещание не вызывать `preventDefault`: браузер прокручивает сразу, а вызов `preventDefault` в таком слушателе игнорируется с предупреждением в консоли. Спецификация делает `touchstart`, `touchmove`, `wheel` и `mousewheel` на `window`, `document`, `<html>` и `<body>` пассивными по умолчанию. Поэтому `preventDefault` в таком слушателе на `document` молча не работает — нужно явно указать `{ passive: false }`. Блокировать прокрутку лучше декларативно: `touch-action`, `overscroll-behavior`, `overflow: hidden`.
:::

::: details Чем событие от пользователя отличается от созданного скриптом
У событий, которые создал браузер, `isTrusted === true`. У созданных через конструктор и `dispatchEvent`, а также у `el.click()` — `false`. Синтетические события не запускают действий браузера: `KeyboardEvent` не введёт символ, `wheel` не прокрутит. Исключение — `click` объектом `MouseEvent`: он запускает activation behavior (чекбокс переключится, ссылка откроется). Синтетика не даёт user activation, поэтому попапы и fullscreen из неё не откроются. Ещё одно отличие — микрозадачи: при настоящем клике они выполняются между слушателями, а при `click()` из скрипта — после всего диспатча. Тесты на jsdom или с `click()` поэтому видят другой порядок, чем пользователь.
:::

::: details Как Vue работает с событиями и чем emit отличается от DOM-события
`@click` вешает на элемент один нативный слушатель-invoker. При обновлении меняется только ссылка на обработчик внутри, перевешивания нет. `.capture`, `.once`, `.passive` превращаются в опции `addEventListener`. `.stop`, `.prevent`, `.self` и клавиши — проверки перед вызовом обработчика, и выполняются они в порядке записи. Invoker пропускает события, начавшиеся до его подключения: так обработчик, появившийся после патча посреди всплытия, не срабатывает на том же клике. `emit` компонента — не DOM-событие: это синхронный вызов функции из пропа `onXxx` родителя, без всплытия. Необъявленные в `emits` слушатели проваливаются на корневой элемент как нативные.
:::

::: details Почему в async-обработчике event.currentTarget оказывается null
`currentTarget` — узел, чей слушатель работает **сейчас**. После диспатча браузер обнуляет его, а `eventPhase` ставит в `0`. В `async`-обработчике код после `await` выполняется, когда диспатч уже завершён: `currentTarget` равен `null`, а `preventDefault` и `stopPropagation` ни на что не влияют. Исключение — `await` уже готового значения при настоящем клике: микрозадача успевает до конца диспатча, и всё «работает», но только в этом случае. Решение — читать `currentTarget` и решать про отмену синхронно, до первого `await`. `event.target` сохраняется, но может оказаться уже удалённым из DOM.
:::

## Задачи

### 1. Порядок слушателей · легко

Что выведет код? `button` вложен в `div`.

```js
div.addEventListener('click', () => console.log('div bubble'));
div.addEventListener('click', () => console.log('div capture'), true);
button.addEventListener('click', () => console.log('button bubble'));
button.addEventListener('click', (e) => {
  console.log('button capture');
  e.stopPropagation();
}, true);
button.click();
```

::: details Решение и разбор
```text
div capture
button capture
```

- Capture-фаза: `window` → … → `div` — выводится `div capture`.
- Цель: сначала capture-слушатели, хотя `button bubble` зарегистрирован раньше, — `button capture`.
- `stopPropagation()` выставил флаг остановки. Обычные слушатели цели вызываются **отдельным** проходом, а он проверяет флаг на входе. Поэтому `button bubble` не выведется, и `div bubble` тоже (проверено в Chromium 157).

Без `stopPropagation`: `div capture`, `button capture`, `button bubble`, `div bubble`. По старому правилу (на цели — в порядке регистрации) `button bubble` вывелся бы раньше `button capture`.
:::

### 2. Меню закрывается сразу после открытия · средне

Почему меню не открывается? Предложите исправления.

```js
toggle.addEventListener('click', () => {
  menu.hidden = false;
  document.addEventListener('click', function close() {
    menu.hidden = true;
    document.removeEventListener('click', close);
  });
});
```

::: details Решение и разбор
Слушатель на `document` добавлен **во время** диспатча этого же клика. Клон списка слушателей берётся при входе в каждый узел. `document` выше по пути, его список ещё не склонирован, поэтому `close` вызывается на всплытии того же клика: меню открывается и закрывается в одном событии (проверено настоящим кликом в Chromium 157).

Исправления — от лучшего к худшему:

1. **Один постоянный слушатель** без добавления на лету, с проверкой цели:

   ```js
   document.addEventListener('click', (e) => {
     const path = e.composedPath(); // works across shadow DOM
     if (menu.hidden || path.includes(menu) || path.includes(toggle)) return;
     menu.hidden = true;
   });
   ```

2. **Слушать в capture-фазе**: `document.addEventListener('click', close, { capture: true })`. Capture-фаза `document` для текущего клика уже прошла, и слушатель сработает только со следующего. Плюс: внутренние `stopPropagation` ему не мешают.
3. **Отложить подписку** через `setTimeout`. Работает, но это гонка с другими задачами.
4. `stopPropagation()` в `toggle` — худший вариант: ломает «клик снаружи» у всех остальных меню и аналитику.

Во Vue такой же сценарий возникает без явного `addEventListener`. Обработчик кнопки меняет состояние, а при настоящем клике патч выполняется в микрозадаче между слушателями и вешает `@click` на родителя. Vue защищается сам: invoker сравнивает момент своего подключения с меткой события `e._vts` и пропускает «старое» событие.
:::

### 3. Функция `delegate` · средне

Реализуйте `delegate(root, type, selector, handler, { signal } = {})`. `handler(event, matched)` вызывается, если событие пришло из элемента, подходящего под `selector`, внутри `root`. Учтите вложенные элементы, совпадение выше `root`, невсплывающие `focus`/`blur`/`mouseenter`/`mouseleave` и отписку.

::: details Решение и разбор
```js
const NON_BUBBLING = { focus: 'focusin', blur: 'focusout' };
const CAPTURE_ONLY = new Set(['mouseenter', 'mouseleave', 'load', 'error', 'scroll']);

function delegate(root, type, selector, handler, { signal } = {}) {
  const realType = NON_BUBBLING[type] ?? type;
  const capture = CAPTURE_ONLY.has(type);

  const listener = (event) => {
    if (!(event.target instanceof Element)) return; // text node, document, window
    const matched = event.target.closest(selector);
    if (!matched || !root.contains(matched)) return; // no match or match above root
    // mouseenter fires per element: react only when it is the matched one itself
    if (capture && event.target !== matched) return;
    handler.call(matched, event, matched);
  };

  root.addEventListener(realType, listener, { capture, signal });
  return () => root.removeEventListener(realType, listener, { capture });
}

// Usage
const ac = new AbortController();
delegate(table, 'click', 'tr[data-id]', (e, row) => open(row.dataset.id), { signal: ac.signal });
delegate(form, 'blur', 'input', (e, input) => validate(input), { signal: ac.signal });
```

- `closest` нужен, потому что `target` — самый глубокий элемент. `root.contains` отсекает предка снаружи `root`, который тоже подходит под селектор.
- `focus`/`blur` заменены всплывающими `focusin`/`focusout` — те же моменты, но доходят до `root`.
- `mouseenter`/`mouseleave` у предка в capture-фазе вызываются для **каждого** элемента, в который вошёл курсор, включая детей. Поэтому реагируем, только когда `target` — сам найденный элемент. Иначе вход во вложенный `<span>` выглядел бы как повторный вход в строку.
- Снимать слушатель нужно с тем же `capture`, иначе он останется. Это частая ошибка.
- `stopPropagation` ниже `root` сломает делегирование для всплывающих событий. Capture-слушатель на `root` его переживёт, но вызовется раньше обработчиков цели.

Сложность: O(d) на событие, где d — глубина от `target` до совпадения; O(1) памяти на подписку.
:::

### 4. `preventDefault` после `await` · сложно

Ссылка должна открываться, только если сервер разрешил. Тестировщик говорит, что «иногда работает», а в e2e с `link.click()` переход не отменяется никогда. Объясните и исправьте.

```js
link.addEventListener('click', async (event) => {
  const allowed = await checkAccess(link.href); // fetch
  if (!allowed) event.preventDefault();
});
```

::: details Решение и разбор
`preventDefault` имеет силу, только пока событие в диспатче: действие по умолчанию выполняется **после** диспатча. Функция возвращает управление на первом `await`, слушатель завершается, и дальше важно, когда выполнится продолжение:

- `fetch` — сетевая задача. Продолжение выполнится сильно позже, диспатч давно завершён и переход уже начат. `preventDefault` ни на что не влияет, `event.currentTarget` равен `null`.
- Если `checkAccess` вернул уже готовое значение (кэш), продолжение — микрозадача. При **настоящем** клике она выполняется сразу после слушателя, ещё внутри диспатча, и отмена срабатывает. Отсюда «иногда работает».
- При `link.click()` микрозадачи ждут конца всего вызова `click()`, включая действие по умолчанию. Поэтому в e2e отмена не срабатывает никогда.

Проверено в Chromium 157: настоящий клик + `await null` + `preventDefault()` — перехода нет; `link.click()` с тем же кодом или `await` таймера — переход есть.

Исправление — отменять **синхронно** и повторять действие самим:

```js
link.addEventListener('click', async (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return; // new tab etc.
  event.preventDefault(); // decide now, while dispatching
  const href = event.currentTarget.href; // currentTarget is null after await
  if (await checkAccess(href)) location.assign(href);
  else showAccessDenied();
});
```

Так же устроена отправка формы с асинхронной проверкой: `preventDefault()` на `submit`, проверка, затем `form.requestSubmit()` (с валидацией и событием `submit`) или `fetch`. Не используйте `form.submit()`: он пропускает и то, и другое.
:::

### 5. Композабл `onClickOutside` · сложно

Напишите Vue-композабл `onClickOutside(target, handler, { ignore = [] } = {})`. `target` — template ref. Обработчик вызывается при нажатии вне элемента и вне элементов из `ignore` (например, кнопки-переключателя). Учтите shadow DOM, элементы, которые удаляются по клику (крестик внутри меню), `stopPropagation` во внутренних компонентах и снятие слушателя.

::: details Решение и разбор
```js
import { onScopeDispose, toValue } from 'vue';

export function onClickOutside(target, handler, { ignore = [] } = {}) {
  const controller = new AbortController();
  let downInside = false;

  const isInside = (event) => {
    const path = event.composedPath(); // computed at dispatch time
    return [target, ...ignore].some((r) => {
      const el = toValue(r);
      return el && path.includes(el);
    });
  };

  // capture: stopPropagation inside the app cannot hide the event from us
  const opts = { capture: true, signal: controller.signal };
  document.addEventListener('pointerdown', (e) => { downInside = isInside(e); }, opts);
  document.addEventListener('click', (e) => {
    const startedInside = downInside;
    downInside = false; // a keyboard click (Enter on a button) has no pointerdown
    if (!toValue(target) || startedInside || isInside(e)) return;
    handler(e);
  }, opts);

  const stop = () => controller.abort();
  onScopeDispose(stop);
  return stop;
}

// Usage: const menu = useTemplateRef('menu'); onClickOutside(menu, () => (open.value = false), { ignore: [toggleBtn] });
```

- **`composedPath()`, а не `el.contains(event.target)`.** Путь фиксируется при диспатче. Если крестик удалили до проверки (обработчиком `pointerdown` внутри меню или если слушатель стоит на всплытии), `contains` по отсоединённому `target` вернёт `false`, и меню закроется. В shadow DOM `target` перенацелен на хост, и `contains` тоже ошибётся.
- **Сброс `downInside` на `click`.** Клик с клавиатуры (Enter на кнопке) приходит без `pointerdown`, и без сброса он унаследовал бы флаг от прошлого нажатия.
- **Capture на `document`.** Срабатывает раньше всех и не зависит от `stopPropagation` во внутренних компонентах. Подписка в capture-фазе не ловит текущий клик, даже если композабл вызван из обработчика клика (см. задачу 2).
- **`pointerdown` + `click`.** Если пользователь нажал внутри (например, начал выделять текст в поле) и отпустил снаружи, `click` уйдёт общему предку — снаружи. Запоминаем, где было нажатие.
- **`ignore`** — кнопка-переключатель. Без неё клик по кнопке закрыл бы меню, а её обработчик тут же открыл бы его снова.
- `toValue` читает ref на каждом событии: элемент может появиться позже (`v-if`). `AbortController` снимает оба слушателя одним вызовом, `onScopeDispose` работает и вне компонента, внутри `effectScope`.

Сложность: O(d · k) на клик, где d — длина пути, k — число отслеживаемых элементов.
:::

## Источники

- [DOM Living Standard: Events](https://dom.spec.whatwg.org/#events) — [dispatching events](https://dom.spec.whatwg.org/#dispatching-events), [default passive value](https://dom.spec.whatwg.org/#default-passive-value), [AddEventListenerOptions](https://dom.spec.whatwg.org/#dictdef-addeventlisteneroptions), [`composedPath()`](https://dom.spec.whatwg.org/#dom-event-composedpath)
- [HTML Living Standard: Event handlers](https://html.spec.whatwg.org/multipage/webappapis.html#event-handler-attributes), [Activation behavior](https://html.spec.whatwg.org/multipage/interaction.html#activation), [User activation](https://html.spec.whatwg.org/multipage/interaction.html#tracking-user-activation)
- [W3C UI Events](https://w3c.github.io/uievents/) — порядок и свойства событий мыши, клавиатуры и фокуса; trusted events
- [MDN: EventTarget.addEventListener()](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener), [Event bubbling](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Event_bubbling), [Event.isTrusted](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted), [Event.composedPath()](https://developer.mozilla.org/en-US/docs/Web/API/Event/composedPath), [CustomEvent](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent)
- [Chrome Platform Status: Fire capture event listeners before bubble event listeners at event target](https://chromestatus.com/feature/5892189387227136); [Chrome for Developers: Use passive listeners to improve scrolling performance](https://developer.chrome.com/docs/lighthouse/best-practices/uses-passive-event-listeners)
- [Vue: Event Handling](https://vuejs.org/guide/essentials/event-handling.html), [Component Events](https://vuejs.org/guide/components/events.html), [Fallthrough Attributes](https://vuejs.org/guide/components/attrs.html), [Vue and Web Components](https://vuejs.org/guide/extras/web-components.html); исходники `@vue/runtime-dom` 3.5.45 — `modules/events.ts` (`patchEvent`, `createInvoker`), `directives/vOn.ts` (`withModifiers`, `withKeys`), `apiCustomElement.ts`
