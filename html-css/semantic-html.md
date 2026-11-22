---
title: Семантический HTML и мультимедиа
level: ядро
---

# Семантический HTML и мультимедиа

> **Коротко.** Каждый элемент HTML относится к категориям контента (flow, phrasing, interactive и др.) и имеет **модель контента** — список того, что можно положить внутрь. Часть нарушений парсер исправляет сам, перестраивая дерево по алгоритму спецификации (`<div>` закрывает `<p>`, `<a>` внутри `<a>` становится соседом), поэтому DOM может не совпасть с шаблоном. Остальные нарушения он оставляет как есть. Семантика — не стиль: от тега зависят роль в дереве доступности, поведение с клавиатуры, работа поиска и встроенная интерактивность (`<details>`, `<dialog>`, `popover`). Для медиа главное — размеры у `<img>` (место резервируется до загрузки), политика autoplay (без звука можно, со звуком — после жеста) и `sandbox` у чужого `<iframe>`.

**Связанные темы:** [От ввода URL до отображения страницы](../browser/from-url-to-pixels.md), [DOM API и observers](../browser/dom.md), [SSR и гидрация](../vue/ssr-and-hydration.md), [Оптимизация загрузки](../performance/loading.md), [Core Web Vitals и измерение](../performance/web-vitals.md), [UI-coding: базовые компоненты на Vue](../live-coding/ui-components.md), [CSRF, clickjacking и supply chain](../security/csrf-and-clickjacking.md), [SEO и обработка ошибок](../nuxt/seo-and-errors.md), [HTML-формы и нативная валидация](./html-forms.md), [Box model, BFC и схлопывание отступов](./box-model.md)

## Теория

Фрагменты проверены в Chromium 159 (Playwright 1.65, headless): DOM после `DOMParser`, computed styles, `getBoundingClientRect`, дерево доступности через CDP `Accessibility.getFullAXTree`. Предупреждения компилятора — `@vue/compiler-dom` 3.5.45. Поддержка в браузерах — по MDN browser-compat-data 8.1.10, сверено 2026-11-22.

### Модель контента: категории

Спецификация не делит элементы на «блочные» и «строчные»: это свойство CSS (`display`). Вместо этого у элемента есть **категории контента** (content categories) и **модель контента** (content model) — что допустимо внутри.

| Категория | Что это | Примеры |
| --- | --- | --- |
| metadata | настройка документа | `<link>`, `<meta>`, `<script>`, `<template>` |
| flow | почти всё, что бывает в `<body>` | `<div>`, `<p>`, `<ul>`, `<section>`, текст |
| sectioning | создаёт раздел | `<article>`, `<aside>`, `<nav>`, `<section>` |
| heading | заголовок раздела | `<h1>`–`<h6>`, `<hgroup>` |
| phrasing | текст и разметка внутри абзаца | `<span>`, `<a>`, `<strong>`, `<img>`, `<button>` |
| embedded | внешний ресурс | `<img>`, `<video>`, `<iframe>`, `<svg>` |
| interactive | предназначено для взаимодействия | `<a href>`, `<button>`, `<details>`, `<iframe>`, `<label>`, `<select>`, `<input>` (кроме `hidden`), `<video controls>` |

У `<p>` модель — phrasing content, поэтому `<div>` внутри недопустим. У `<a>` модель **прозрачная** (transparent): допустимо то же, что у родителя, но без interactive-потомков, другого `<a>` и элементов с `tabindex`. Поэтому `<a>` вокруг карточки с `<div>` валиден в `<div>` и невалиден в `<p>`. У `<button>` — phrasing без interactive-потомков.

### Почему парсер «чинит» вложенность

Нарушения модели бывают двух видов, и разница важна для SSR.

**Парсер перестраивает дерево.** Построение дерева в HTML Living Standard работает со **стеком открытых элементов** и списком активных элементов форматирования. Для каждого тега правило задано явно:

- Открывающий тег `<div>`, `<ul>`, `<section>`, `<h1>`, `<table>` и других «блочных» элементов: если в стеке есть `<p>` (в button scope), сначала **закрыть `<p>`**. Отсюда `<p>a<div>b</div>c</p>` → `<p>a</p><div>b</div>c<p></p>`: `</p>` без открытого `<p>` создаёт **пустой** `<p>`.
- `<a>`, когда в списке форматирования уже есть `<a>`: ошибка разбора, запускается **adoption agency algorithm**, первая ссылка закрывается. `<a href="/1">one<a href="/2">two</a></a>` → две соседние ссылки. Тот же алгоритм разбирает перекрёстное `<b>1<i>2</b>3</i>` в `<b>1<i>2</i></b><i>3</i>`.
- Не-табличный контент внутри `<table>` выносится **перед** таблицей (foster parenting), а `<tr>` без `<tbody>` получает неявный `<tbody>`.
- `<button>` внутри `<button>`, `<h2>` внутри открытого `<h1>`, второй `<li>` закрывают предыдущий элемент.

**Парсер оставляет как есть.** `<ul><div>x</div></ul>` и `<button><a href="/">x</a></button>` невалидны, но дерево совпадает с разметкой. Это проблема доступности и валидатора, а не гидрации.

Ловушка в том, что DOM API не проверяют модель контента: и `p.innerHTML = '<div>x</div>'`, и `p.append(div)` дают `<p><div>x</div></p>`. Vue на клиенте создаёт элементы через `createElement` и `insertBefore` и тоже получает такое дерево. А сервер отдаёт строку, браузер разбирает её парсером и получает другое дерево. Отсюда hydration mismatch, разобранный в «[SSR и гидрации](../vue/ssr-and-hydration.md)».

> [!NOTE]
> Компилятор Vue 3.5 в dev проверяет вложенность (`validateHtmlNesting` в `@vue/compiler-dom`) и пишет `<div> cannot be child of <p>, according to HTML specifications`. Предупреждения есть для `<div>` в `<p>`, `<a>` в `<a>` и `<tr>` прямо в `<table>`. Для `<ul><div>` и `<button><a>` их нет: парсер такие деревья не перестраивает. В prod-сборке проверка вырезана.

### `<template>`

Содержимое `<template>` разбирается, но не становится детьми элемента: `template.childNodes.length === 0`, а разметка лежит в `template.content` — `DocumentFragment`, у которого **другой** `ownerDocument` (документ без браузингового контекста). Поэтому `<img>` из шаблона не загружается, а `<script>` не выполняется, пока фрагмент не клонируют в документ (проверено: после `append(content.cloneNode(true))` сработали и запрос картинки, и скрипт). `<template>` разрешён почти везде, в том числе внутри `<p>` и `<table>`, и парсер его не перестраивает. Как его используют для быстрой вставки — в «[DOM API и observers](../browser/dom.md)».

### Секционирование, landmarks и заголовки

Sectioning content — только `<article>`, `<aside>`, `<nav>`, `<section>`. `<header>`, `<footer>` и `<main>` разделов не создают, но вместе с ними дают **landmarks** (ориентиры) — роли, по которым скринридер прыгает по странице.

| Элемент | Неявная роль (HTML-AAM) |
| --- | --- |
| `<header>` | `banner`, только если не внутри `<article>`, `<aside>`, `<main>`, `<nav>`, `<section>`; иначе `sectionheader` (в Chromium 159) или `generic` |
| `<footer>` | `contentinfo` по тому же правилу, иначе `sectionfooter` |
| `<main>` | `main`; видимый `<main>` в документе один |
| `<nav>`, `<aside>`, `<search>` | `navigation`, `complementary`, `search` |
| `<section>` | `region`, **только если у него есть доступное имя** (`aria-labelledby`, `aria-label`), иначе `generic` |
| `<article>` | `article` |

Неявные роли — то, что получается без `role`. Подробно о дереве доступности — в разделе «Доступность».

**`article` против `section` против `div`.** `<article>` — самодостаточная единица, которую можно вынести отдельно: пост, карточка товара, комментарий. `<section>` — тематическая часть документа со своим заголовком. Если у блока нет заголовка и он нужен только для стилей — это `<div>`.

**Миф об outline-алгоритме.** HTML5 описывал document outline: уровень заголовка определяла вложенность секций, и в каждой `<section>` можно было писать `<h1>`. Ни один браузер и ни один скринридер этот алгоритм не реализовал, и в 2022 году его удалили из спецификации. Сейчас outline — это все заголовки документа в порядке дерева, уровень берётся из цифры тега. Спецификация требует хотя бы один заголовок уровня 1 и запрещает перескакивать через уровень вниз (`<h1>` → `<h3>` — ошибка).

Вслед за спецификацией браузеры убрали стили, уменьшавшие `<h1>` внутри `<article>`, `<aside>`, `<nav>`, `<section>`: Chrome 140, Firefox 140, Safari 26.2. В Chromium 159 `<h1>` на любом уровне вложенности — `32px` (`2em`). Если дизайн полагался на уменьшенный `<h1>` в секциях, размер нужно задать в CSS явно.

> [!NOTE]
> Для компонентов, которые не знают свою глубину, в спецификацию добавили `headingoffset` (0–8, сдвигает уровень заголовков потомков, максимум 9) и `headingreset`. По MDN BCD на 2026-11-22: Safari 27.3, в Chrome 151 и Firefox — за флагом. В Chromium 159 без флага `headingOffset` в `HTMLElement.prototype` нет. Пока поддержки нет, уровень передают компоненту prop'ом.

### Текстовая семантика

Пары с одинаковым видом по умолчанию, но разным смыслом:

- `<strong>` — важность, серьёзность, срочность («**Не выключайте устройство**»). `<b>` — привлечь внимание без дополнительной важности: ключевые слова, название продукта в обзоре.
- `<em>` — логическое ударение, меняющее смысл фразы («я *не* говорил»). `<i>` — другой голос: термин, иностранное слово, мысль персонажа.
- `<small>` — примечание, мелкий шрифт договора, а не «маленький текст». `<cite>` — название произведения, а не имя автора.

Без пары: `<time datetime="2026-11-22">22 ноября</time>` даёт машиночитаемую дату; `<abbr title="…">` — расшифровку; `<code>`, `<kbd>`, `<samp>`, `<var>` — код, ввод с клавиатуры, вывод программы, переменную; `<mark>` — подсветку совпадения. Это смысл для машин (поиск, перевод, режим чтения), а не для внешнего вида.

### `button`, `a` и `div` с обработчиком

- **`<a href>`** — навигация: у ссылки есть URL, её можно открыть в новой вкладке, скопировать, её видит краулер. `<a>` без `href` — не ссылка: не фокусируется и не активируется.
- **`<button>`** — действие на этой странице. Фокус, роль `button`, активация с клавиатуры — бесплатно. Внутри `<form>` у кнопки по умолчанию `type="submit"` (подробнее — в «[HTML-формах и нативной валидации](./html-forms.md#button-и-неявная-отправка)»).
- **`<div @click>`** — ничего из этого: нет фокуса, нет роли, нет клавиатуры.

Проверено: Tab обходит `<button>`, `<a href>` и `<span role="button" tabindex="0">`, но не `<div onclick>` и не `<a>` без `href`. `<button>` даёт `click` на Enter (на keydown) и на Space (на keyup). `<a href>` — только на Enter, Space прокручивает страницу. `<span role="button" tabindex="0">` не даёт `click` ни на одну клавишу: `role` меняет только то, что объявляется скринридеру, поведение нужно писать самому. Поэтому «кнопка-div» с ARIA — это переписывание `<button>`, обычно с ошибками.

### Интерактивность без JS

**`<details>`/`<summary>`** — раскрывающийся блок без скрипта. Атрибут `name` объединяет элементы в группу: открытие одного закрывает остальные — эксклюзивный аккордеон (Chrome 120, Firefox 130, Safari 17.2). Событие `toggle` приходит асинхронно (задачей), с `oldState`/`newState`. Если в разметке открыты два элемента одной группы, при вставке в документ второй закрывается. Анимировать раскрытие можно через `::details-content` (Chrome 131, Firefox 143, Safari 18.4).

**`<dialog>`** — `show()` для немодального окна, `showModal()` для модального: top layer, инертный фон, Esc, возврат фокуса. Разбор с кодом — в «[UI-coding: базовые компоненты](../live-coding/ui-components.md#модальное-окно-dialog-или-teleport)».

**`popover`** — немодальный слой поверх страницы: меню, подсказка, тост. Элемент с атрибутом `popover` уходит в **top layer**, поэтому `overflow: hidden`, `z-index` и `transform` предков его не обрезают (проверено: popover внутри `overflow: hidden` высотой 20 px отрисовался целиком, `position: fixed`). Кнопка с `popovertarget="id"` открывает и закрывает его без JS, браузер сам связывает их для доступности.

| Значение | Закрывает другие | Light dismiss (клик мимо) и Esc |
| --- | --- | --- |
| `auto` (по умолчанию) | другие `auto`, кроме своих предков | да |
| `manual` | нет | нет, только `hidePopover()` или кнопка |
| `hint` | другие `hint`, но не `auto` | да |

`hint` поддерживается с Chrome 151, Firefox 153, Safari 27.3. В отличие от модального `<dialog>`, popover не делает фон инертным и не держит фокус.

**Invoker commands** — `commandfor="id"` и `command` на `<button>` вызывают действие без JS: `show-modal`, `close`, `request-close` для `<dialog>`, `toggle-popover`, `show-popover`, `hide-popover` для popover (Chrome 135, Firefox 144, Safari 26.2). Свои команды начинаются с `--`: браузер ничего не делает сам, но на цели срабатывает событие `command` с `event.command === '--archive'`. Событие приходит и для встроенных команд.

### Изображения

**`alt`.** Информативная картинка — `alt` с тем, что она сообщает, а не «картинка». Декоративная — `alt=""`: скринридер её пропустит. Без `alt` скринридер может прочитать имя файла. Картинка — единственное содержимое ссылки: `alt` описывает, куда ведёт ссылка.

**`width` и `height`.** По разделу Rendering спецификации пара атрибутов становится presentational hint `aspect-ratio: auto w / h`. Даже при `width: 100%; height: auto` из CSS браузер знает пропорцию **до** загрузки и резервирует место. Проверено: в контейнере 400 px картинка `width="800" height="600"` до ответа сервера занимала 300 px, без атрибутов — 0 px. Ноль — это сдвиг соседей при загрузке (CLS, см. «[Core Web Vitals](../performance/web-vitals.md)»). Атрибуты задают пропорцию, а реальный размер по-прежнему задаёт CSS.

**Загрузка.** `loading="lazy"` откладывает загрузку до приближения к viewport. `fetchpriority="high"` поднимает приоритет LCP-картинки. `decoding="async"` разрешает браузеру не ждать декодирования картинки, чтобы показать остальной контент, а `img.decode()` возвращает промис, когда картинку можно вставить без рывка. Когда что ставить и как это видно в водопаде — в «[Оптимизации загрузки](../performance/loading.md)».

**`srcset` и `<picture>` кратко.** `srcset` с дескрипторами `w` и атрибут `sizes` дают браузеру выбрать файл под ширину слота и плотность экрана. `<picture>` с `<source type="image/avif">` выбирает формат, а с `<source media>` — другой кадр для другого экрана (art direction). Отрисовывает и несёт `alt` всё равно вложенный `<img>`. Подробно — в теме «Адаптивная вёрстка» этого раздела. Подпись к картинке — `<figure>` с `<figcaption>`.

### Видео и аудио

- **`preload`**: `none`, `metadata` (размеры, длительность, иногда первый кадр), `auto`. Значение по умолчанию определяет браузер, спецификация советует `metadata`. В Chromium 159 по умолчанию `metadata`. Это подсказка: `autoplay` её перекрывает.
- **Политика autoplay.** Видео без звука (`muted`) может стартовать само во всех браузерах. Со звуком — только после активации пользователем (клик, клавиша), в Chrome ещё по истории взаимодействия с сайтом. `play()` возвращает промис, отказ приходит как `NotAllowedError`. Проверено в Chromium 159 с `--autoplay-policy=document-user-activation-required`: `<video autoplay>` без `muted` осталось на паузе, `play()` из скрипта отклонился с `NotAllowedError`, после клика `play()` выполнился. Видео с `autoplay muted` проиграло до конца.
- **`muted`**: атрибут задаёт `defaultMuted`, а текущее состояние — свойство `muted`. Выставить `el.muted = true` из JS перед `play()` достаточно, атрибут при этом не появляется.
- **`playsinline`** — подсказка воспроизводить в области элемента, а не на весь экран. На iPhone без неё видео разворачивается на весь экран, поэтому фоновое видео — `autoplay muted loop playsinline`. Firefox атрибут не поддерживает, но и не нуждается в нём.
- **`<track>`** — субтитры WebVTT: `kind` (`subtitles`, `captions`, `descriptions`, `chapters`, `metadata`), `srclang`, `label`, `default`. Файл с другого origin загрузится только при `crossorigin` на `<video>` и CORS на сервере.
- Несколько `<source type>` — браузер берёт первый, который может воспроизвести. `poster` показывается до первого кадра и считается кандидатом LCP.

> [!NOTE]
> `loading="lazy"` для `<video>` и `<audio>` уже есть в спецификации: откладывается загрузка ресурса и постера. По MDN BCD на 2026-11-22: Chrome 150, в Firefox — за флагом, в Safari нет.

### `<iframe>`: `sandbox`, `allow`, `loading`

`sandbox` без значения включает все ограничения: скрипты не выполняются, формы не отправляются, всплывающие окна и навигация верхнего окна запрещены, документ получает **непрозрачный origin**. Токены снимают ограничения по одному: `allow-scripts`, `allow-forms`, `allow-popups`, `allow-same-origin` и др.

Проверено на документе с того же origin:

| `sandbox` | `self.origin` | `parent.document` | `localStorage`, cookies |
| --- | --- | --- | --- |
| нет | `http://localhost:4518` | доступен | работают |
| `""` | скрипт не выполнился | — | — |
| `allow-scripts` | `"null"` | `SecurityError` | `SecurityError` |
| `allow-scripts allow-same-origin` | `http://localhost:4518` | доступен | работают |

Последняя строка — ловушка, о которой предупреждает спецификация: документ того же origin со скриптами и своим origin может просто снять `sandbox` с собственного `<iframe>` у родителя и перезагрузиться. Проверено: `parent.document.querySelector('#esc').removeAttribute('sandbox')` сработал. Флаги применяются при навигации, поэтому изменение `sandbox` на уже загруженном документе ничего не меняет. Комбинацию разрешают только для **чужого** origin, а недоверенный HTML отдают с отдельного домена.

`allow` задаёт Permissions Policy для фрейма: `allow="fullscreen; camera 'none'"`. Без разрешения встроенный документ не получит камеру, геолокацию и т. п., даже если пользователь согласился бы. `loading="lazy"` работает и для `<iframe>`. Нужен `title`: по нему скринридер называет фрейм. Обратная задача — запретить встраивать **свою** страницу — решается заголовком `frame-ancestors`, см. «[CSRF, clickjacking и supply chain](../security/csrf-and-clickjacking.md)».

### SVG: inline или `<img>`

`<img src="icon.svg">` — отдельный документ в защищённом режиме: скрипты не выполняются, внешние ресурсы не грузятся, CSS страницы на него не действует, `currentColor` берётся из самого SVG. Проверено: `fill="currentColor"` при `color: red` у страницы дал чёрный пиксель, `<script>` внутри не отправил `postMessage`. Зато файл кэшируется, работают `loading="lazy"` и `alt`.

Inline `<svg>` — часть DOM: его стилизует CSS страницы, `currentColor` наследуется, на узлы можно повесить обработчики и анимацию. Цена — разметка повторяется в HTML каждой страницы и не кэшируется отдельно. Атрибуты представления (`fill="…"`) проигрывают **любому** CSS-правилу: проверено, правило `rect { fill: blue }` перекрыло `fill="currentColor"`, а `style="fill: currentColor"` — нет. Для доступности: декоративной иконке — `aria-hidden="true"`, смысловой — `role="img"` и `aria-label` или `<title>`.

Правило: иконки, которые меняют цвет по состоянию, — inline (или спрайт через `<use>`); иллюстрации и логотипы — `<img>`.

### Семантика для SEO

Поисковик извлекает структуру из разметки: `<title>`, заголовки, текст ссылок, `alt`. Google переходит только по `<a href>`, а не по элементам с обработчиком клика, поэтому навигация на `<div @click="router.push()">` для краулера не существует. **Структурированные данные** описывают сущность словарём schema.org. Google рекомендует формат JSON-LD — `<script type="application/ld+json">` в документе, отдельно от разметки. Данные должны совпадать с видимым содержимым страницы. Как вывести JSON-LD в Nuxt безопасно — в «[SEO и обработке ошибок](../nuxt/seo-and-errors.md)».

## Примеры

Каркас страницы статьи: один `banner`, один `main`, заголовки по порядку, машиночитаемая дата, картинка с размерами.

```html
<body>
  <header>
    <a href="/">Shop blog</a>
    <nav aria-label="Main"><a href="/guides">Guides</a> <a href="/news">News</a></nav>
  </header>
  <main>
    <article>
      <h1>How to choose a kettle</h1>
      <p>Published <time datetime="2026-11-22">November 22</time></p>
      <figure>
        <img src="/kettle.avif" width="1200" height="800" alt="Steel kettle on a stove" fetchpriority="high" />
        <figcaption>Steel kettles heat faster than ceramic ones.</figcaption>
      </figure>
      <section aria-labelledby="materials">
        <h2 id="materials">Materials</h2>
        <p><strong>Never</strong> heat an empty kettle.</p>
      </section>
    </article>
    <aside aria-label="Related posts">…</aside>
  </main>
  <footer>© 2026 Shop</footer>
</body>
```

Меню, FAQ и подтверждение во Vue без единой строки обработчиков (проверено во Vue 3.5.45 в Chromium 159):

```vue
<script setup lang="ts">
defineProps<{ items: { id: number; question: string; answer: string }[] }>();
</script>

<template>
  <!-- Exclusive accordion: opening one item closes the others -->
  <details v-for="item in items" :key="item.id" name="faq">
    <summary>{{ item.question }}</summary>
    <p>{{ item.answer }}</p>
  </details>

  <!-- Top layer, light dismiss and Esc for free -->
  <button popovertarget="user-menu">Account</button>
  <ul id="user-menu" popover>
    <li><a href="/profile">Profile</a></li>
  </ul>

  <!-- Invoker commands: no JS to open or close the modal -->
  <button commandfor="confirm-delete" command="show-modal">Delete</button>
  <dialog id="confirm-delete">
    <p>Delete this item?</p>
    <button commandfor="confirm-delete" command="close">Cancel</button>
  </dialog>
</template>
```

Фиксированные `id` годятся для одного экземпляра на странице. В переиспользуемом компоненте их генерируют через `useId()`, чтобы два экземпляра не открывали чужие окна.

## Вопросы с интервью

::: details Почему div внутри p ломает гидрацию, а div внутри ul — нет
Обе вложенности невалидны по модели контента, но HTML-парсер обращается с ними по-разному. Открывающий `<div>` по алгоритму построения дерева закрывает открытый `<p>`, а `</p>` без пары создаёт пустой абзац: из `<p><div>x</div></p>` получается `<p></p><div>x</div><p></p>`. Для `<ul><div>` такого правила нет, дерево совпадает с разметкой. Vue на клиенте строит DOM через API, которые модель контента не проверяют, а SSR-ответ проходит через парсер. Если парсер перестроил дерево, серверный DOM не совпадает с vnode, и Vue перемонтирует поддерево. Компилятор Vue в dev предупреждает о `<div>` в `<p>`, `<a>` в `<a>` и `<tr>` в `<table>`. `<ul><div>` и `<button><a>` — ошибка для доступности и валидатора, но не для гидрации.
:::

::: details Что стало с outline-алгоритмом и как выбирать уровни заголовков
Outline-алгоритм HTML5 вычислял уровень заголовка по вложенности секций и разрешал `<h1>` в каждой `<section>`. Его не реализовали ни браузеры, ни скринридеры, и в 2022 году его удалили из спецификации. Скринридер видит уровень из цифры тега: страница из одних `<h1>` для него плоская. Правило сейчас — один или несколько `<h1>` верхнего уровня, дальше по порядку без пропусков вниз. Вслед за этим браузеры убрали уменьшение `<h1>` в секциях (Chrome и Firefox 140, Safari 26.2), так что старая вёрстка могла визуально измениться. Для компонентов неизвестной глубины есть `headingoffset`, но пока он работает только в Safari, а в остальных браузерах уровень передают через prop.
:::

::: details Когда button, когда a, и что не так с div с обработчиком клика
Ссылка — навигация, у неё есть адрес: её открывают в новой вкладке, копируют, по ней ходит краулер. Кнопка — действие на текущей странице. Обе фокусируются и активируются с клавиатуры: кнопка — на Enter и Space, ссылка — только на Enter. `<div>` с обработчиком не фокусируется, не имеет роли и не реагирует на клавиши. Добавить `role="button"` и `tabindex="0"` недостаточно: `click` на Enter и Space всё равно не придёт, обработчики клавиш, `disabled` и состояние фокуса придётся писать самому. Частые ошибки: `<a href="#" @click.prevent>` для действия, `<button>` с `router.push` вместо `<RouterLink>` и забытый `type="button"` у кнопки внутри формы.
:::

::: details Зачем width и height у img, если размер задан в CSS
Атрибуты задают не размер, а пропорцию до загрузки. Спецификация превращает их в `aspect-ratio: auto w / h`. При `width: 100%; height: auto` браузер вычисляет высоту ещё до того, как пришли байты картинки, и резервирует место. Без атрибутов высота до загрузки равна нулю, и после загрузки контент ниже сдвигается — это CLS. У ленивых картинок без размеров ещё и ломается ленивость: нулевые картинки оказываются во viewport и грузятся сразу. `auto` в значении означает, что после загрузки берётся настоящая пропорция файла. Для адаптивных картинок атрибуты ставят по любому из вариантов с той же пропорцией.
:::

::: details Чем отличаются section, article и div и что такое landmarks
`<article>` — самодостаточная единица, которую можно показать отдельно: пост, комментарий, карточка. `<section>` — тематическая часть документа с заголовком. `<div>` — контейнер без смысла, для стилей. Landmarks — роли, по которым пользователь скринридера прыгает по странице: `banner`, `navigation`, `main`, `complementary`, `contentinfo`, `search`, `region`. Нюансы: `<header>` даёт `banner`, только если не вложен в `<article>`, `<section>`, `<main>`, `<nav>` или `<aside>`. `<section>` становится `region`, только когда у него есть имя через `aria-labelledby` или `aria-label`. Если на странице несколько `<nav>`, их различают по `aria-label`.
:::

::: details Почему видео с autoplay не запускается и как это исправить
Браузеры разрешают автозапуск без звука, а со звуком — только после активации пользователем (в Chrome ещё по истории взаимодействия с сайтом). Видео с `autoplay` без `muted` просто остаётся на паузе, а `play()` из скрипта возвращает отклонённый промис с `NotAllowedError`. Решения: для фонового видео — `autoplay muted loop playsinline` (`playsinline` нужен iPhone, иначе он развернёт видео на весь экран). Для видео со звуком — запускать в обработчике клика и обрабатывать отказ промиса: показать кнопку «Включить звук» или запустить без звука. Промис `play()` всегда ловят, иначе в консоли будет необработанное отклонение.
:::

::: details Что даёт sandbox у iframe и почему опасно сочетание allow-scripts и allow-same-origin
Пустой `sandbox` запрещает скрипты, формы, всплывающие окна, навигацию верхнего окна и даёт документу непрозрачный origin: `self.origin === "null"`, доступа к родителю, cookies и `localStorage` нет. Токены возвращают возможности по одной. `allow-scripts` без `allow-same-origin` — безопасный режим для чужого кода: скрипты работают, но origin непрозрачный. Если добавить `allow-same-origin` документу с **того же** origin, что и родитель, он получит доступ к `parent.document`. Тогда он может снять `sandbox` со своего `<iframe>` и перезагрузиться уже без ограничений. Поэтому недоверенный HTML отдают с отдельного домена. Возможности браузера (камера, полноэкранный режим) задаются отдельно, атрибутом `allow`.
:::

::: details Inline SVG или img с файлом svg
`<img>` грузит SVG как отдельный изолированный документ: без скриптов и внешних ресурсов, CSS страницы на него не действует, `currentColor` не наследуется. Плюсы — кэш, `loading="lazy"`, `alt`, безопасность для пользовательских файлов. Inline `<svg>` — часть DOM: его красит CSS, `currentColor` берёт цвет текста, на узлы можно повесить события и анимацию. Минус — разметка повторяется в каждой странице и в JS-бандле, если иконка — компонент. Иконки, которые меняют цвет по hover или теме, — inline или спрайт с `<use>`. Иллюстрации и логотипы — `<img>`. Загруженный пользователем SVG встраивать inline нельзя: это XSS.
:::

## Задачи

### 1. Что построит парсер · средне

Какой DOM получится из каждого фрагмента внутри `<body>`?

```html
<p>Intro<section><h2>T</h2></section></p>
<a href="/a">A <a href="/b">B</a></a>
<table><span>x</span><tr><td>1</td></tr></table>
<ul><li>a<p>b</li><li>c</ul>
```

::: details Решение и разбор
```html
<p>Intro</p><section><h2>T</h2></section><p></p>
<a href="/a">A </a><a href="/b">B</a>
<span>x</span><table><tbody><tr><td>1</td></tr></tbody></table>
<ul><li>a<p>b</p></li><li>c</li></ul>
```

1. `<section>` закрывает открытый `<p>`, а `</p>` без пары создаёт пустой абзац.
2. Второй `<a>` при открытом первом запускает adoption agency algorithm: первая ссылка закрывается, ссылки становятся соседями.
3. `<span>` не может стоять в таблице: foster parenting выносит его **перед** `<table>`, а `<tr>` получает неявный `<tbody>`.
4. Ошибки нет: конец `</li>` неявно закрывает `<p>`, а `<li>` и `</ul>` закрывают предыдущий `<li>`. Опускать эти теги разрешено спецификацией.

Проверка — `new DOMParser().parseFromString(html, 'text/html').body.innerHTML`. Если такой фрагмент лежит в шаблоне Vue и рендерится на сервере, первые три дадут hydration mismatch.
:::

### 2. Ревью карточки товара · легко

Найдите проблемы семантики и медиа.

```html
<div class="card">
  <img src="/kettle.jpg">
  <h1>Kettle</h1>
  <b>Only 2 left!</b>
  <div class="link" onclick="location.href='/kettle'">Details</div>
  <div class="btn" onclick="addToCart()">Add to cart</div>
</div>
```

::: details Решение и разбор
```html
<article class="card">
  <img src="/kettle.jpg" width="400" height="300" alt="Steel kettle" loading="lazy" />
  <h2><a href="/kettle">Kettle</a></h2>
  <p><strong>Only 2 left!</strong></p>
  <button type="button" onclick="addToCart()">Add to cart</button>
</article>
```

- Карточка — самодостаточная единица списка: `<article>`.
- `<img>` без `alt` (скринридер может прочитать имя файла) и без `width`/`height` (CLS при загрузке). Карточки ниже первого экрана — `loading="lazy"`, первая видимая — без него.
- `<h1>` в каждой карточке ломает outline: у страницы каталога свой `<h1>`, карточки — `<h2>`.
- «Осталось 2» — важная информация: `<strong>`, а не `<b>`.
- Переход — `<a href>`: открывается в новой вкладке, видна краулеру, фокусируется. Ссылку кладут в заголовок, а не отдельной «Подробнее»: имя ссылки становится осмысленным.
- Действие — `<button type="button">`: фокус, Enter и Space, роль.
:::

### 3. Аккордеон FAQ без JS · легко

Сделайте FAQ, в котором одновременно открыт только один ответ, и отправляйте в аналитику, какой вопрос открыли. JavaScript для раскрытия не использовать.

::: details Решение и разбор
```vue
<script setup lang="ts">
const props = defineProps<{ items: { id: string; question: string; answer: string }[] }>();
const emit = defineEmits<{ opened: [id: string] }>();

function onToggle(event: ToggleEvent, id: string) {
  if (event.newState === 'open') emit('opened', id);
}
</script>

<template>
  <details v-for="item in props.items" :key="item.id" name="faq" @toggle="onToggle($event, item.id)">
    <summary>{{ item.question }}</summary>
    <p>{{ item.answer }}</p>
  </details>
</template>
```

Общий `name` делает группу эксклюзивной: браузер сам закрывает открытый элемент, когда открывается другой (проверено: клик по второму закрыл первый). Клавиатура, роль и состояние раскрытия у `<summary>` встроены. `toggle` приходит асинхронно и **для каждого** элемента, который изменился, поэтому фильтр по `newState`. Ограничения по сравнению с аккордеоном на компонентах из «[UI-coding](../live-coding/ui-components.md)»: нет режима «нельзя закрыть все» и нет управления стрелками между заголовками. Если `open` хранится в состоянии Vue, его синхронизируют из `toggle`, иначе Vue и браузер будут спорить за атрибут.
:::

### 4. Видео на первом экране · средне

На главной — фоновое видео 8 МБ без звука. На iPhone оно открывается на весь экран, в Chrome иногда не стартует, LCP — 4 с. Исправьте разметку.

```html
<video src="/hero.mp4" autoplay loop></video>
```

::: details Решение и разбор
```html
<video autoplay muted loop playsinline preload="metadata"
       poster="/hero-poster.avif" width="1280" height="720" aria-hidden="true">
  <source src="/hero.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"' />
  <source src="/hero.h264.mp4" type="video/mp4" />
</video>
```

- `muted` — без него автозапуск со звуком блокируется политикой autoplay. `playsinline` — иначе iPhone разворачивает видео на весь экран.
- `poster` — кандидат LCP. Лёгкий постер становится LCP быстро, вместо ожидания первого кадра из 8 МБ. Его стоит найти preload scanner'у и дать `fetchpriority` через `<link rel="preload" as="image" fetchpriority="high">`, если постер — главный элемент экрана.
- `width`/`height` резервируют место, как у `<img>`.
- Несколько `<source type>`: браузер возьмёт первый поддерживаемый, AV1 обычно меньше H.264.
- Декоративное видео без смысла — `aria-hidden="true"`. Для людей с `prefers-reduced-motion: reduce` видео лучше не запускать: в CSS спрятать, в JS не вызывать `play()`.
:::

### 5. Встроить чужой виджет · сложно

Нужно показать на странице HTML-превью письма, которое прислал пользователь, и виджет оплаты партнёра `https://pay.partner.example`. Опишите разметку и настройки.

::: details Решение и разбор
```html
<!-- Untrusted HTML: no scripts, opaque origin -->
<iframe title="Email preview" sandbox srcdoc="…escaped email HTML…" loading="lazy"></iframe>

<!-- Partner widget: own origin, scripts and forms, nothing else -->
<iframe
  title="Payment"
  src="https://pay.partner.example/widget"
  sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
  allow="payment"
  referrerpolicy="strict-origin-when-cross-origin"
></iframe>
```

- **Письмо** — пустой `sandbox`: скрипты, формы и навигация верхнего окна запрещены, origin непрозрачный. `srcdoc` без `sandbox` унаследовал бы ваш origin, и `<script>` из письма получил бы доступ к странице. Безопаснее всего отдавать такое превью с отдельного домена (`usercontent.example`).
- **Виджет партнёра** — `allow-same-origin` здесь допустим, потому что origin чужой: виджет получает **свой** origin (без него у виджета не было бы своего хранилища и cookies), но не ваш. Снять `sandbox` с вашего `<iframe>` он не может, `parent.document` для него закрыт политикой same-origin. `allow-popups` нужен окну банка, `allow="payment"` открывает Payment Request API.
- `title` нужен скринридеру. Обмен с виджетом — `postMessage` с проверкой `event.origin === 'https://pay.partner.example'` и явным `targetOrigin` при отправке, а не `'*'`.
- Ваши собственные страницы от встраивания в чужие iframe защищает `frame-ancestors` (clickjacking), см. «[CSRF, clickjacking и supply chain](../security/csrf-and-clickjacking.md)».
:::

## Источники

- [HTML Living Standard: Kinds of content](https://html.spec.whatwg.org/multipage/dom.html#kinds-of-content)
- [HTML Living Standard: Tree construction](https://html.spec.whatwg.org/multipage/parsing.html#tree-construction)
- [HTML Living Standard: Sections, headings and outlines](https://html.spec.whatwg.org/multipage/sections.html#headings-and-outlines-2)
- [HTML Living Standard: Text-level semantics](https://html.spec.whatwg.org/multipage/text-level-semantics.html)
- [HTML Living Standard: The details element](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-details-element)
- [HTML Living Standard: The popover attribute](https://html.spec.whatwg.org/multipage/popover.html)
- [HTML Living Standard: The img element](https://html.spec.whatwg.org/multipage/embedded-content.html#the-img-element)
- [HTML Living Standard: Media elements](https://html.spec.whatwg.org/multipage/media.html)
- [HTML Living Standard: The iframe element](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#the-iframe-element)
- [HTML Living Standard: Rendering — attributes for embedded content and images](https://html.spec.whatwg.org/multipage/rendering.html#attributes-for-embedded-content-and-images)
- [HTML Accessibility API Mappings (HTML-AAM)](https://w3c.github.io/html-aam/)
- [MDN: Heading elements — uniform font size for h1](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/Heading_Elements)
- [MDN: Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API)
- [MDN: Invoker Commands API](https://developer.mozilla.org/en-US/docs/Web/API/Invoker_Commands_API)
- [MDN: Autoplay guide for media and Web Audio APIs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- [MDN browser-compat-data](https://github.com/mdn/browser-compat-data)
- [Vue: `@vue/compiler-dom`, htmlNesting](https://github.com/vuejs/core/blob/main/packages/compiler-dom/src/htmlNesting.ts)
- [web.dev: Optimize Cumulative Layout Shift](https://web.dev/articles/optimize-cls)
- [Google Search Central: Make your links crawlable](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)
- [Google Search Central: Introduction to structured data](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data)
