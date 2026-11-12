---
title: DOM API и observers
level: ядро
---

# DOM API и observers

> **Коротко.** DOM — дерево **узлов** (элементы, текст, комментарии, фрагменты), а не HTML-строка: атрибуты из разметки и свойства объектов — разные вещи, связанные отражением (reflection). Сам вызов DOM API дешёвый. Дорого то, что он запускает: пересчёт стилей и layout, разбор HTML, потерю состояния узлов при перемещении. Поэтому изменения группируют (`DocumentFragment`, `append(...nodes)`, `replaceChildren`) и не читают геометрию между записями. За DOM следят тремя наблюдателями, и у каждого своё место в event loop: `MutationObserver` — микрозадача после изменения, `ResizeObserver` — внутри кадра после layout и до paint, `IntersectionObserver` — расчёт в кадре, колбэк отдельной задачей.

**Связанные темы:** [От ввода URL до отображения страницы](./from-url-to-pixels.md), [Конвейер рендеринга: layout, paint, composite](./rendering-pipeline.md), [Event loop](../javascript/event-loop.md), [Память и сборка мусора](../javascript/memory-and-gc.md)

## Теория

### Дерево узлов

DOM Standard описывает документ как дерево объектов `Node`. Главные типы:

| Узел | `nodeType` | Что это |
| --- | --- | --- |
| `Element` | 1 | тег; у HTML-элементов — подклассы `HTMLDivElement`, `HTMLInputElement`… |
| `Text` | 3 | текст, в том числе пробелы и переводы строк между тегами |
| `Comment` | 8 | комментарий; Vue и другие фреймворки ставят такие узлы как якоря (`<!--v-if-->`) |
| `Document` | 9 | корень дерева |
| `DocumentFragment` | 11 | лёгкий контейнер без родителя; `ShadowRoot` — его подкласс |

Отсюда две пары API: «по узлам» (`childNodes`, `firstChild`, `nextSibling`, `parentNode`) и «по элементам» (`children`, `firstElementChild`, `nextElementSibling`). Первая видит текстовые узлы из пробелов, вторая — нет. DOM не равен исходному HTML: парсер исправляет разметку (добавляет `<tbody>`, закрывает теги), а скрипты меняют дерево после разбора.

> [!WARNING]
> JS-объект узла — обёртка (wrapper) над объектом движка. **В Chromium** узлы живут в C++ (Blink), а V8 держит для них обёртки. Поэтому сам вызов `appendChild` стоит немного дороже обычного вызова функции, но это почти никогда не узкое место. Узкое место — работа, которую вызов запускает.

### Атрибуты и свойства

**Атрибут** — строка в разметке: `getAttribute('value')`. **Свойство** — поле JS-объекта: `input.value`. Большинство стандартных атрибутов **отражаются** (reflect) в свойства. Спецификация HTML для каждого описывает, как: `id` ↔ `id`, `class` ↔ `className` и `classList`, `for` ↔ `htmlFor`, `data-*` ↔ `dataset`. Отражение не всегда симметрично:

- `input.value` — **текущее** значение, атрибут `value` — значение по умолчанию (отражается в `defaultValue`). Пользователь ввёл текст — свойство изменилось, атрибут нет. Так же устроены `checked` ↔ `defaultChecked` и `selected` ↔ `defaultSelected`.
- `a.href` возвращает **абсолютный** URL, `getAttribute('href')` — то, что написано.
- Булевы атрибуты (`disabled`, `hidden`) включены самим **наличием**: `disabled="false"` — это включено. Свойство же булево.
- Нестандартный атрибут (`<div foo="1">`) в свойство не отражается: `div.foo === undefined`. А селекторы CSS (`[value="x"]`) смотрят на атрибуты, а не на свойства.

Vue при патче решает сам: свойство или атрибут (сверено по исходникам `@vue/runtime-dom` 3.5.45, `shouldSetAsProp`). Правило — `key in el`: есть свойство, ставим свойство. Исключения ставятся атрибутом, потому что соответствующее свойство только для чтения или ведёт себя иначе: `form`, `list` у `<input>`, `width`/`height` у `<img>`, `<video>`, `<canvas>`, `spellcheck`, `draggable`. Модификатор `.prop` (`:foo.prop`, сокращение `.foo`) заставляет ставить свойство, `.attr` (`^foo` в скомпилированном коде) — атрибут.

### Коллекции: live и static

| Метод или свойство | Тип | Живая? |
| --- | --- | --- |
| `getElementsByTagName`, `getElementsByClassName`, `children`, `form.elements` | `HTMLCollection` | да |
| `childNodes`, `getElementsByName` | `NodeList` | да |
| `querySelectorAll` | `NodeList` | **нет** — снимок на момент вызова |

**Живая** (live) коллекция отражает текущее состояние дерева при каждом обращении. Удалили элемент или класс — он исчез из коллекции, и индексы сдвинулись. Отсюда классическая ошибка — изменять дерево в цикле по живой коллекции (задача 1). Статическая коллекция дешевле в обращении, но устаревает.

> [!NOTE]
> Живая коллекция не пересчитывается целиком на каждое изменение: движки кэшируют её и сбрасывают кэш при изменении поддерева. Но `length` после изменения — новый обход. `NodeList` из `querySelectorAll` имеет `forEach`, `HTMLCollection` — нет. Оба итерируемы, поэтому надёжный путь — `[...collection]` или `Array.from`.

### Сколько стоит работа с DOM

Цена DOM-операции почти вся — в последствиях:

1. **Инвалидация.** Вставка, удаление, смена класса помечают стили и layout «грязными». Сами по себе пересчёта не вызывают: браузер сделает его один раз в кадре. Пока вы не прочитаете геометрию — тогда layout синхронный (layout thrashing, подробно — [Конвейер рендеринга](./rendering-pipeline.md)).
2. **Разбор HTML.** `innerHTML = ...` запускает HTML-парсер и **уничтожает** старые узлы вместе с их слушателями, состоянием ввода и фокусом. `el.innerHTML += '<li>…'` пересоздаёт всё содержимое. Плюс риск XSS, если в строке есть пользовательские данные.
3. **Потеря состояния при перемещении.** `insertBefore` и `append` для узла, который уже в дереве, — это удаление и вставка. `<iframe>` перезагрузится, CSS-анимация начнётся сначала, фокус пропадёт.

Как дешевле:

- **Собирать вне документа.** Узлы, которые ещё не вставлены, не участвуют в стилях и layout. Создать их, наполнить и вставить **одним** вызовом: `DocumentFragment`, `parent.append(...nodes)`, `parent.replaceChildren(...nodes)`.
- **Клонировать шаблон.** `<template>` разбирается один раз, а `template.content.cloneNode(true)` копирует готовое поддерево без парсера. Так Vue вставляет статические куски шаблона (`insertStaticContent`: первый раз через `innerHTML` у `<template>`, дальше — `cloneNode`).
- **Текст — через `textContent`**, а не `innerHTML` (нет парсера и XSS) и не `innerText` (тот зависит от отрисовки и принуждает layout).
- **Перемещать с сохранением состояния — `moveBefore`.** `parent.moveBefore(node, ref)` переносит узел без удаления: `<iframe>` не перезагружается, фокус, анимации, открытый popover и модальный `<dialog>` сохраняются. Работает только внутри одного документа, иначе — `HierarchyRequestError`.

> [!NOTE]
> `moveBefore` есть в Chrome 133+ и Firefox 144+, в Safari нет (MDN BCD, сверено 2026-11-12) — пока не Baseline, нужна проверка `typeof parent.moveBefore === 'function'` с откатом на `insertBefore`. Vue 3.5 переставляет узлы при обновлении `v-for` с ключами через `insertBefore`, поэтому `<iframe>` в переставленном элементе списка перезагружается.

### `DocumentFragment` и `<template>`

`DocumentFragment` — узел без родителя и без отрисовки. При вставке фрагмента вставляются его **дети**, а сам фрагмент остаётся **пустым**: для повторной вставки нужен `cloneNode(true)`. `template.content` — тоже фрагмент, но в «инертном» документе: картинки не грузятся, скрипты не выполняются, пока клон не попадёт в живой документ. С появлением `append(...nodes)` фрагмент нужен реже. И выигрыш над циклом `appendChild` меньше, чем пишут старые статьи: layout и так один на кадр. Реальная экономия — меньше мутаций, меньше записей для `MutationObserver` и нет случайного thrashing.

### `MutationObserver`

Следит за изменениями дерева: дети (`childList`), атрибуты (`attributes`, `attributeFilter`, `attributeOldValue`), текст (`characterData`, `characterDataOldValue`), всё поддерево (`subtree`).

Как работает по DOM Standard (`new MutationObserver(cb).observe(target, { childList: true, subtree: true })`):

- Каждое изменение создаёт `MutationRecord` и кладёт его в очередь наблюдателя. **Первая** запись ставит одну микрозадачу «notify mutation observers», следующие только добавляются. Колбэк получает **пачку** записей сразу после текущего синхронного кода — до промисов, поставленных позже, до рендеринга и до следующей задачи (задача 2).
- `observe()` без `childList`, `attributes` и `characterData` бросает `TypeError`. `attributeOldValue` или `attributeFilter` сами включают `attributes`. Повторный `observe()` того же наблюдателя на тот же узел **заменяет** опции.
- `takeRecords()` забирает накопленные записи синхронно (например, перед `disconnect()`, чтобы не потерять последние). `disconnect()` останавливает наблюдение за всеми узлами.
- Наблюдатель держит наблюдаемые узлы **слабыми** ссылками: удалённое поддерево соберётся GC и без `disconnect()`.

Изменение DOM в колбэке создаёт новые записи и новую микрозадачу. Если колбэк меняет то, за чем сам следит, получится бесконечная цепочка микрозадач, которая вешает страницу (голодание, см. [Event loop](../javascript/event-loop.md)). Защита — проверять, нужно ли изменение, или отключаться на время записи.

> [!NOTE]
> `MutationObserver` заменил синхронные **mutation events** (`DOMNodeInserted`, `DOMSubtreeModified`): те срабатывали на каждое изменение посреди операции и тормозили любую работу с DOM. Сейчас они удалены из всех движков: Chrome 127, Firefox 140, Safari 26 (MDN BCD).

### `ResizeObserver`

Сообщает об изменении размера **элемента**, а не окна. Поэтому подходит для компонентов, которые подстраиваются под свой контейнер: графики, виртуальные списки, `textarea` с авторостом.

- Опция `box`: `'content-box'` (по умолчанию), `'border-box'` или `'device-pixel-content-box'` (для `<canvas>` без размытия).
- В записи: `contentBoxSize`, `borderBoxSize`, `devicePixelContentBoxSize` — **массивы** `ResizeObserverSize` (`inlineSize`, `blockSize`; задел на фрагменты в multi-column), и старый `contentRect`, оставленный ради совместимости.
- Первое уведомление приходит **сразу после `observe()`**, даже для элемента 0×0: начальный «последний размер» в спецификации равен (−1, −1).

Место в цикле — внутри шага update the rendering, **после** style и layout и **до** paint. Колбэк вызывается синхронно, в том же кадре: изменения в нём попадут на экран без мерцания. Но после колбэка браузер снова считает style и layout, а затем ещё раз собирает изменённые размеры — только у элементов **глубже** самого мелкого из уже обработанных. Это защита от бесконечного цикла. Если наблюдение пропущено (колбэк изменил размер элемента того же или меньшего уровня), браузер откладывает его на следующий кадр и сообщает ошибку «ResizeObserver loop completed with undelivered notifications» через событие `error` на `window`. Исключения она не бросает, но мониторинг ошибок и оверлеи dev-серверов её ловят (задача 5).

### `IntersectionObserver`

Сообщает, пересекается ли элемент (target) с областью (root): с viewport (`root: null`) или с прокручиваемым предком.

- `threshold` — доли видимости, при пересечении которых приходит уведомление: `0` (по умолчанию: «появился хоть пиксель»), `[0, 0.5, 1]`.
- `rootMargin` — расширить или сузить область root: `'200px 0px'` начнёт грузить за 200 px до появления. `scrollMargin` — то же для промежуточных прокручиваемых контейнеров (Baseline 2025). Обе опции **игнорируются** для target в cross-origin iframe, а `rootBounds` там равен `null`: иначе по ним можно было бы узнать геометрию чужой страницы.
- В записи: `isIntersecting`, `intersectionRatio`, `boundingClientRect`, `intersectionRect`, `rootBounds`, `time`. `isIntersecting` — `true` и при касании краями с нулевой площадью, когда `intersectionRatio === 0`. Поэтому проверять видимость надо по `isIntersecting`, а не по `ratio > 0`.
- Первое уведомление приходит **после `observe()` всегда**, даже если элемент не виден: начальный индекс порога в спецификации равен −1.

Место в цикле: пересечения **вычисляются** в шаге update the rendering, после layout. Но колбэк ставится **задачей** в очередь IntersectionObserver task source и выполняется позже, обычно после отрисовки кадра. Наблюдатель асинхронный и неточный по времени: он не скажет, что элемент виден «прямо сейчас», и пропустит пересечение, если элемент пролетел область быстрее кадра. Зато не нагружает главный поток и не принуждает layout, в отличие от `getBoundingClientRect()` в обработчике `scroll`.

> [!WARNING]
> IntersectionObserver v2 (`trackVisibility`, `delay`, `entry.isVisible` — «элемент не перекрыт и не прозрачен») есть только **в Chromium**. Его используют против кликджекинга во встраиваемых виджетах, но в Firefox и Safari опций нет.

### Три наблюдателя в event loop

| Наблюдатель | Когда считается | Когда вызывается колбэк | Первое уведомление после `observe()` |
| --- | --- | --- | --- |
| `MutationObserver` | при каждом изменении DOM | микрозадача после текущего кода | нет, только при изменениях |
| `ResizeObserver` | update the rendering, после layout | синхронно там же, до paint | да |
| `IntersectionObserver` | update the rendering, после layout | отдельная задача, обычно после paint | да |

Общее у всех трёх: один наблюдатель на много элементов дешевле, чем много наблюдателей, и всем нужен `disconnect()` или `unobserve()`, когда компонент уходит. Иначе колбэк и всё, что он замыкает, живут дольше компонента.

### Shadow DOM обзорно

Shadow DOM прикрепляет к элементу-хосту отдельное дерево — **shadow root**, — которое снаружи не видно обычным обходом и селекторами:

```js
const root = host.attachShadow({ mode: 'open' }); // host.shadowRoot === root
root.innerHTML = '<style>p { color: red }</style><p><slot></slot></p>';
```

- **Инкапсуляция стилей.** Стили внутри не действуют снаружи, внешние селекторы не попадают внутрь. Проходят только **наследуемые** свойства (`color`, `font`) и **custom properties** — через них темизируют компоненты. Хост стилизуется изнутри через `:host`, содержимое слотов — через `::slotted()`, а внутренние части снаружи — через `::part()`, если автор их открыл (`part="label"`).
- **Слоты.** Дети хоста (light DOM) остаются в своём месте дерева, но **отображаются** в `<slot>`: по атрибуту `slot="name"` или в слот по умолчанию.
- **Режим.** `closed` возвращает `host.shadowRoot === null`. Это не граница безопасности: код, который вызвал `attachShadow`, сохранил ссылку.
- **События** из shadow-дерева **перенацеливаются** (retargeting): снаружи `event.target` — хост. Наружу выходят только события с `composed: true`; все нативные события UI такие. Подробно — в следующей теме.
- **Declarative Shadow DOM** — `<template shadowrootmode="open">` внутри хоста. Shadow root создаётся парсером, без JS, поэтому web-компоненты можно рендерить на сервере (Baseline 2024).

Vue scoped CSS (`<style scoped>`) — **не** Shadow DOM: компилятор добавляет атрибут `data-v-xxx` к элементам и к селекторам. Изоляция условная: глобальные стили проникают внутрь, корневой элемент дочернего компонента получает стили родителя. Настоящую инкапсуляцию даёт `defineCustomElement`: он рендерит компонент в shadow root. С Vue 3.5 есть `shadowRoot: false` (без shadow root), `useHost()`, `useShadowRoot()` и `this.$host`. События `emit` выходят наружу как `CustomEvent`, аргументы — массивом в `event.detail`.

### Vue и DOM

Рендерер Vue ходит в DOM через тонкий слой `nodeOps` (`@vue/runtime-dom`): `insertBefore`, `removeChild`, `createElement`, `textContent` для текста элемента, `nodeValue` для текстового узла. Доступ к элементу из компонента — template ref. С Vue 3.5 удобнее `useTemplateRef('key')`: ключ — строка в runtime, поэтому работают и динамические `:ref`. Элемент появляется после монтирования, а после `v-if="false"` ref снова `null`. Поэтому observers подключают в `onMounted` или в `watch` за ref и отключают в `onUnmounted` или `onScopeDispose` (пример ниже).

## Примеры

```js
// Attribute vs property
const input = document.querySelector('input'); // <input value="draft">
input.value = 'typed';
input.getAttribute('value'); // 'draft' — the default value (input.defaultValue)
input.value;                 // 'typed'
document.querySelector('a').href; // <a href="/docs"> → 'https://example.com/docs'
```

```js
// Build off-document, insert once; clone a parsed template instead of re-parsing
const tpl = document.querySelector('#row-tpl'); // <template id="row-tpl"><li><span></span></li></template>
const rows = items.map((item) => {
  const li = tpl.content.firstElementChild.cloneNode(true);
  li.querySelector('span').textContent = item.title; // no parser, no XSS
  return li;
});
list.replaceChildren(...rows); // one mutation, old nodes removed
```

```js
// One IntersectionObserver for many images
const io = new IntersectionObserver((entries, observer) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.src = entry.target.dataset.src;
    observer.unobserve(entry.target);
  }
}, { rootMargin: '300px 0px' });
document.querySelectorAll('img[data-src]').forEach((img) => io.observe(img));
// For plain images, native <img loading="lazy"> does the same without JS
```

```vue
<script setup>
import { onMounted, onUnmounted, ref, useTemplateRef } from 'vue';

const box = useTemplateRef('box');
const width = ref(0);
let ro;

onMounted(() => {
  ro = new ResizeObserver(([entry]) => {
    width.value = entry.contentBoxSize[0].inlineSize; // the size is an array
  });
  ro.observe(box.value);
});
onUnmounted(() => ro.disconnect());
</script>

<template>
  <div ref="box">{{ width > 600 ? 'wide' : 'narrow' }}</div>
</template>
```

## Вопросы с интервью

::: details Чем атрибут отличается от свойства DOM-элемента
Атрибут — строка в разметке, читается `getAttribute`. Свойство — поле JS-объекта узла. Стандартные атрибуты отражаются в свойства, но не всегда один к одному. Атрибут `value` у `<input>` — значение по умолчанию (`defaultValue`), а свойство `value` — текущее: ввод пользователя меняет только свойство. `href` в свойстве абсолютный, в атрибуте — как написан. Булевы атрибуты включаются наличием: `disabled="false"` всё равно выключает поле. Нестандартные атрибуты в свойства не отражаются, для своих данных есть `data-*` и `dataset`. CSS-селекторы смотрят на атрибуты. Во Vue биндинг ставит свойство, если `key in el`, иначе атрибут; исключения вроде `form`, `list`, `width` у `<img>` ставятся атрибутом, `.prop` и `.attr` задают выбор явно.
:::

::: details Что такое живые коллекции и чем опасны
`getElementsByClassName`, `getElementsByTagName`, `children`, `childNodes` возвращают живые коллекции: при каждом обращении они отражают текущее дерево. `querySelectorAll` возвращает статический снимок. Опасность — менять дерево в цикле по живой коллекции: удалили элемент или класс, индексы сдвинулись, и цикл пропускает каждый второй элемент. Решения: скопировать в массив (`[...coll]`), идти с конца, использовать `while (coll.length)` или сразу `querySelectorAll`. Плюс: обращение к `length` живой коллекции после изменения — новый обход.
:::

::: details Как быстро вставить тысячу элементов и что в работе с DOM действительно дорого
Сам вызов DOM API дешёвый. Дорого: пересчёт стилей и layout, особенно принудительный, когда чтение геометрии идёт между записями; разбор HTML в `innerHTML`; уничтожение и пересоздание узлов с потерей их состояния. Тысячу элементов собирают вне документа и вставляют одним вызовом — `append(...nodes)`, `replaceChildren` или `DocumentFragment`. Повторяющуюся разметку клонируют из `<template>` (`cloneNode(true)` без парсера), текст ставят через `textContent`. В цикле не читают `offsetHeight` и подобное. Если элементов десятки тысяч — виртуализация: в DOM только видимые строки.
:::

::: details Когда вызывается колбэк MutationObserver и почему не сразу
В микрозадаче. Первое изменение после последнего уведомления ставит одну микрозадачу, все следующие изменения в том же синхронном коде только добавляют записи. Колбэк получает всю пачку после текущего скрипта, до рендеринга и до следующей задачи. Так сделано из-за опыта mutation events: они были синхронными и срабатывали посреди операции, поэтому каждая вставка в цикле вызывала обработчики, а обработчик мог менять DOM в середине чужой мутации. Пакетная доставка дешевле и безопаснее. Следствие: если колбэк меняет наблюдаемое дерево, возможна бесконечная цепочка микрозадач, которая вешает страницу.
:::

::: details Чем ResizeObserver отличается от IntersectionObserver по моменту срабатывания
Оба считаются в шаге update the rendering после layout, и оба присылают первое уведомление сразу после `observe()`. `ResizeObserver` вызывает колбэк синхронно в том же кадре, до paint: изменения из колбэка попадут в этот кадр без мерцания, но браузер пересчитает layout ещё раз. Защита от цикла — повторно обрабатываются только более глубокие элементы, иначе ошибка «ResizeObserver loop completed with undelivered notifications» и перенос на следующий кадр. `IntersectionObserver` ставит колбэк отдельной задачей, обычно уже после отрисовки: он асинхронный и неточный, зато дешёвый, и годится для «подгрузить, когда почти видно», но не для покадровой синхронизации.
:::

::: details Как сделать бесконечную прокрутку или ленивую загрузку и почему не через scroll
Через `IntersectionObserver`: в конце списка ставится элемент-сентинел, наблюдатель с `rootMargin: '400px'` сообщает, что до конца осталось 400 px, — загружаем следующую страницу. Для картинок проще нативный `loading="lazy"`. Обработчик `scroll` с `getBoundingClientRect()` срабатывает много раз за кадр, каждый раз читает геометрию (возможен принудительный layout) и работает на главном потоке. Throttle только снижает частоту. Наблюдатель считает пересечения в браузере раз в кадр и вызывает колбэк только при пересечении порога. Видимость проверяют по `isIntersecting`, а не по `intersectionRatio > 0`: при касании краями ratio равен нулю.
:::

::: details Что даёт Shadow DOM и чем он отличается от scoped-стилей Vue
Shadow DOM — отдельное дерево, прикреплённое к хосту. Внешние селекторы и `querySelector` внутрь не попадают, внутренние стили не утекают наружу. Проходят наследуемые свойства и custom properties, поэтому темизация идёт через переменные, а точечная стилизация — через `::part`. Дети хоста отображаются в `<slot>`. События изнутри перенацеливаются на хост, наружу выходят только `composed`. Declarative Shadow DOM позволяет рендерить это на сервере. Scoped-стили Vue — это переписанные селекторы с атрибутом `data-v-*`: глобальные стили проникают внутрь, корень дочернего компонента получает стили родителя, отдельного дерева нет. Shadow DOM во Vue — это `defineCustomElement`.
:::

## Задачи

### 1. Цикл по живой коллекции · легко

Код должен снять класс `todo` со всех элементов, но снимает только с половины. Почему? Исправьте.

```js
const items = document.getElementsByClassName('todo'); // 4 elements
for (let i = 0; i < items.length; i++) {
  items[i].classList.remove('todo');
}
```

::: details Решение и разбор
`getElementsByClassName` возвращает живую коллекцию. После снятия класса с `items[0]` элемент выпадает из коллекции, бывший `items[1]` становится `items[0]`, а `i` уже равен 1. Каждый второй элемент пропускается: из `a, b, c, d` класс останется у `b` и `d` (проверено в jsdom).

```js
// 1. Snapshot first
for (const el of [...document.getElementsByClassName('todo')]) el.classList.remove('todo');
// 2. Static collection from the start
document.querySelectorAll('.todo').forEach((el) => el.classList.remove('todo'));
// 3. Keep the live one, always take the first
const items = document.getElementsByClassName('todo');
while (items.length) items[0].classList.remove('todo');
```

Тот же эффект при удалении узлов в цикле по `children` или `childNodes`. Идти с конца (`for (let i = items.length - 1; i >= 0; i--)`) тоже работает: удаление не сдвигает ещё не пройденные индексы.

Сложность: O(n) во всех вариантах.
:::

### 2. Порядок вывода · средне

Что выведет код и сколько записей получит наблюдатель?

```js
const mo = new MutationObserver((records) => console.log('mo', records.length));
mo.observe(el, { attributes: true });

el.dataset.a = '1';
Promise.resolve().then(() => console.log('promise'));
el.dataset.b = '2';
console.log('sync');
setTimeout(() => console.log('timeout'));
```

::: details Решение и разбор
```
sync
mo 2
promise
timeout
```

- `el.dataset.a = '1'` создаёт запись и ставит **одну** микрозадачу уведомления. Она в очереди раньше, чем реакция промиса.
- `el.dataset.b = '2'` только добавляет вторую запись в очередь наблюдателя — новой микрозадачи нет.
- После синхронного кода микрозадачи выполняются в порядке постановки: сначала уведомление с **двумя** записями, потом промис. Таймер — задача, он после всех микрозадач.

Если поменять местами первые две строки (`Promise.then` до первой мутации), промис выведется раньше `mo`. Порядок определяется моментом **первой** мутации. Проверено в jsdom, который реализует алгоритм DOM Standard.
:::

### 3. Дождаться элемента · средне

Реализуйте `waitForElement(selector, { root = document, timeout = 5000, signal } = {})`: промис с первым элементом, подходящим под селектор. Если элемент уже есть — сразу. Если не появился за `timeout` или пришёл `abort` — reject. Наблюдатель и таймер не должны жить после завершения. Так ждут виджет стороннего скрипта или элемент в e2e-тестах.

::: details Решение и разбор
```js
function waitForElement(selector, { root = document, timeout = 5000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const found = root.querySelector(selector);
    if (found) return resolve(found);
    if (signal?.aborted) return reject(signal.reason);

    const mo = new MutationObserver(() => {
      const el = root.querySelector(selector);
      if (el) finish(() => resolve(el));
    });
    const timer = setTimeout(
      () => finish(() => reject(new Error(`Timeout waiting for ${selector}`))),
      timeout,
    );
    const onAbort = () => finish(() => reject(signal.reason));

    function finish(settle) {
      mo.disconnect();
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      settle();
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    // attributes too: the element may start matching after a class change
    mo.observe(root, { childList: true, subtree: true, attributes: true });
  });
}
```

- Проверка **до** подписки обязательна: элемент мог появиться раньше, и мутаций больше не будет.
- `querySelector` в колбэке, а не разбор `addedNodes`: селектор может совпасть с потомком вставленного узла или начать совпадать после смены атрибута. Колбэк приходит пачкой раз в микрозадачу, так что запрос не на каждую мутацию. На очень частых мутациях огромного дерева можно сузить `attributeFilter: ['class', 'id']` или проверять `addedNodes` через `matches` и `querySelector`.
- `finish` снимает всё сразу: без `disconnect()` наблюдатель жил бы, пока жив `root`, а `document` живёт всегда.

Сложность: O(N) на каждую пачку мутаций (N — размер поддерева `root`), память O(1).
:::

### 4. Композабл `useInView` с общим наблюдателем · средне

Напишите Vue-композабл `useInView(target, options)`: возвращает `ref<boolean>` — виден ли элемент. Компонентов в списке может быть тысяча, поэтому все вызовы с одинаковыми `options` должны делить **один** `IntersectionObserver`. Элемент может появиться позже монтирования (`v-if`), наблюдение снимается при размонтировании.

::: details Решение и разбор
```js
import { onScopeDispose, ref, watch } from 'vue';

const pool = new Map(); // options key -> { io, handlers: Map<Element, fn> }

function getShared(options) {
  const key = JSON.stringify([options.rootMargin ?? '0px', options.threshold ?? 0]);
  let shared = pool.get(key);
  if (!shared) {
    const handlers = new Map();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) handlers.get(e.target)?.(e);
    }, options);
    shared = { io, handlers, key };
    pool.set(key, shared);
  }
  return shared;
}

export function useInView(target, options = {}) {
  const inView = ref(false);
  let shared = null; // the pool entry the current element is registered in

  function release(el) {
    shared.io.unobserve(el);
    shared.handlers.delete(el);
    if (shared.handlers.size === 0) {
      shared.io.disconnect();
      pool.delete(shared.key);
    }
    shared = null;
  }

  // target is a template ref: the element appears after mount or v-if
  const stop = watch(target, (el, prevEl) => {
    if (prevEl && shared) release(prevEl);
    inView.value = false;
    if (el) {
      shared = getShared(options); // re-fetch: the pool entry may have been dropped
      shared.handlers.set(el, (e) => (inView.value = e.isIntersecting));
      shared.io.observe(el);
    }
  }, { immediate: true, flush: 'post' });

  onScopeDispose(() => {
    stop();
    if (target.value && shared) release(target.value);
  });
  return inView;
}

// Usage: const card = useTemplateRef('card'); const visible = useInView(card, { rootMargin: '200px' });
```

- Один наблюдатель вместо тысячи: браузер считает пересечения для всех целей одним проходом, а колбэк получает пачку записей. Маршрутизация — через `Map<Element, handler>`.
- Ключ пула — только сериализуемые опции. Если передан `root` (элемент), его нельзя положить в JSON: тогда нужен пул по `WeakMap<root, …>`.
- `flush: 'post'` — колбэк после патча DOM, ref уже указывает на элемент. Когда у наблюдателя не осталось целей, он отключается и уходит из пула, поэтому при новом появлении элемента запись пула берётся заново.
- `onScopeDispose` вместо `onUnmounted`: композабл работает и внутри `effectScope`, не только в компоненте.
- `isIntersecting`, а не `intersectionRatio > 0`: касание краями даёт ratio 0.

Сложность: O(1) на подписку и отписку, O(k) на пачку из k записей.
:::

### 5. Ошибка ResizeObserver loop · сложно

Компонент подгоняет высоту блока под ширину, чтобы сохранить соотношение 16:9. В консоли и в Sentry — «ResizeObserver loop completed with undelivered notifications». Объясните, почему, и предложите исправления.

```js
const ro = new ResizeObserver(([entry]) => {
  const width = entry.contentBoxSize[0].inlineSize;
  entry.target.style.height = (width * 9) / 16 + 'px';
});
ro.observe(card);
```

::: details Решение и разбор
Колбэк меняет размер **того же** элемента, за которым следит. После колбэков браузер пересчитывает layout и снова собирает изменённые наблюдения, но обрабатывает в этом кадре только элементы **глубже** самого мелкого из уже обработанных. `card` на той же глубине, поэтому новое наблюдение (высота изменилась) пропускается и уходит в следующий кадр, а браузер сообщает ошибку через событие `error` на `window`. Если ширина зависит от высоты (появляется полоса прокрутки, flex-контейнер), получится и визуальное дрожание: размер скачет кадр за кадром.

Исправления — от лучшего к худшему:

1. **Не нужен JS.** `aspect-ratio: 16 / 9` решает задачу в layout, без наблюдателя.
2. **Наблюдать одно, менять другое — глубже.** Наблюдать контейнер, а высоту ставить ребёнку. Ребёнок глубже, поэтому его изменение обработается в том же кадре без ошибки.

   ```js
   const ro = new ResizeObserver(([entry]) => {
     const width = entry.contentBoxSize[0].inlineSize;
     const h = (width * 9) / 16 + 'px';
     if (inner.style.height !== h) inner.style.height = h; // skip no-op writes
   });
   ro.observe(container);
   ```

3. **Отложить запись в следующий кадр** — `requestAnimationFrame(() => …)` внутри колбэка. Ошибки не будет, но теряется главное преимущество колбэка до paint: один кадр покажет старую высоту, а цикл «запись → новое наблюдение» станет покадровым.

Ошибку не стоит просто подавлять: это сигнал, что layout не сошёлся за кадр. Иногда она безвредна (одна лишняя итерация), но при циклической зависимости размеров страница дрожит кадр за кадром.

Сложность: O(1) на уведомление, но каждая запись в колбэке — дополнительный проход style и layout в кадре.
:::

## Источники

- [DOM Living Standard](https://dom.spec.whatwg.org/) — узлы, коллекции, `ParentNode` (`append`, `replaceChildren`, `moveBefore`), [Mutation observers](https://dom.spec.whatwg.org/#mutation-observers), [Shadow trees](https://dom.spec.whatwg.org/#shadow-trees)
- [HTML Living Standard: Reflecting content attributes in IDL attributes](https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflecting-content-attributes-in-idl-attributes), [The template element](https://html.spec.whatwg.org/multipage/scripting.html#the-template-element), [Update the rendering](https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering)
- [W3C: Resize Observer](https://drafts.csswg.org/resize-observer/), [Intersection Observer](https://w3c.github.io/IntersectionObserver/)
- [MDN: MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver), [ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver), [Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API), [Element.moveBefore()](https://developer.mozilla.org/en-US/docs/Web/API/Element/moveBefore), [Element.attachShadow()](https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow), [Using shadow DOM](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM); [browser-compat-data](https://github.com/mdn/browser-compat-data) — поддержка `moveBefore`, mutation events, `scrollMargin`, declarative Shadow DOM
- [Chrome for Developers: Atomic DOM moves with moveBefore](https://developer.chrome.com/blog/movebefore-api), [Declarative Shadow DOM](https://developer.chrome.com/docs/css-ui/declarative-shadow-dom); [web.dev: ResizeObserver](https://web.dev/articles/resize-observer), [Trust is good, observation is better: Intersection Observer v2](https://web.dev/articles/intersectionobserver-v2)
- [Vue: Template refs](https://vuejs.org/guide/essentials/template-refs.html), [Vue and Web Components](https://vuejs.org/guide/extras/web-components.html), [Custom Elements API](https://vuejs.org/api/custom-elements.html), [Scoped CSS](https://vuejs.org/api/sfc-css-features.html#scoped-css); исходники `@vue/runtime-dom` 3.5.45 — `nodeOps.ts`, `patchProp.ts`, `apiCustomElement.ts`
