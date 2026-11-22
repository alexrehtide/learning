---
title: Селекторы, псевдоклассы и псевдоэлементы
level: ядро
---

# Селекторы, псевдоклассы и псевдоэлементы

> **Коротко.** Селектор — это условие на элемент. Спецификация проверяет его справа налево: сначала самый правый составной селектор (subject), потом комбинаторы ведут к предкам и соседям. Поэтому браузер начинает с правой части и отбрасывает лишнее по ней, а Chromium ещё и проверяет предков через bloom filter. Один неизвестный селектор в списке выбрасывает всё правило. Исключения — `:is()` и `:where()`, которые принимают forgiving selector list. `:has()` выбирает элемент по его потомкам или соседям, но за это платит инвалидацией вверх по дереву. Псевдоклассы описывают состояние элемента, а псевдоэлементы создают боксы, которых нет в DOM. CSS Nesting разворачивает `&` в `:is()` с селектором родителя, а не склеивает строки, как Sass.

**Связанные темы:** [Каскад, специфичность, наследование и custom properties](./cascade.md), [Стили в компонентах: scoped, CSS Modules, `v-bind()` в `<style>`](../vue/styles.md), [HTML-формы и нативная валидация](./html-forms.md), [DOM API и observers](../browser/dom.md), [Конвейер рендеринга: layout, paint, composite](../browser/rendering-pipeline.md), [Оптимизация runtime и профилирование](../performance/runtime.md), [Box model, BFC и схлопывание отступов](./box-model.md)

## Теория

Фрагменты проверены в Chromium 159 (Playwright 1.65, headless): страница через `page.setContent`, значения через `getComputedStyle`, `matches` и `querySelectorAll`, фокус и ввод через мышь и клавиатуру Playwright. Спецификации — Selectors Level 4 (Editor's Draft от 2026-11-10), CSS Pseudo-Elements 4, CSS Nesting 1, CSS Scoping 1, CSS Shadow Parts 1 (сверено 2026-11-22). Поддержка в браузерах — по MDN browser-compat-data 8.1.10 (2026-11-19).

### Из чего состоит селектор

- **Простой селектор** (simple selector) — одно условие: тип `p`, универсальный `*`, класс `.btn`, ID `#main`, атрибут `[href]`, псевдокласс `:hover`.
- **Составной** (compound) — цепочка простых без пробелов: `button.btn:hover`. Тип или `*` стоит первым.
- **Сложный** (complex) — составные, соединённые **комбинаторами**: потомок (пробел), ребёнок `>`, соседний следующий `+`, любой следующий сосед `~`.
- **Список** — сложные через запятую: `h1, h2`.

Последний составной селектор сложного — **subject**, тот элемент, к которому применяется правило. В `.menu > li a` это `a`, остальное — условия на его предков.

Атрибутные селекторы:

| Селектор | Совпадает, если значение атрибута |
| --- | --- |
| `[data-state]` | атрибут есть, значение любое |
| `[type="email"]` | равно строке целиком |
| `[class~="primary"]` | содержит слово в списке через пробелы (так устроен `.primary`) |
| `[lang\|="en"]` | равно `en` или начинается с `en-` |
| `[href^="https:"]`, `[href$=".pdf"]`, `[href*="docs"]` | начинается с, кончается на, содержит |
| `[href$=".pdf" i]` | то же без учёта регистра (флаг `s` — с учётом, но в Chromium его нет) |

Проверено: на `href="/Docs/a.PDF"` `[href$=".pdf"]` не совпал, `[href$=".pdf" i]` совпал, а на `class="btn  primary"` `[class="primary"]` — нет, `[class~="primary"]` — да. Регистр значений по умолчанию зависит от языка документа: в HTML часть атрибутов (`type`, `lang` и др.) сравнивается без учёта регистра, поэтому `[type="EMAIL"]` совпал с `type="email"`. Флаг `i`: Chrome 49, Firefox 47, Safari 9. Флаг `s`: Firefox 66, Safari 27, в Chromium `[type="EMAIL" s]` — `SyntaxError`. Атрибутный селектор смотрит на **атрибут**, а не на свойство DOM: `input.value` после ввода не меняет `[value="x"]` (подробно — в «[DOM API](../browser/dom.md)»).

### Как браузер сопоставляет селектор

Алгоритм спецификации (Selectors 4, §17.3) проверяет составные селекторы **справа налево**: сначала subject, потом комбинатор говорит, где искать следующий составной: среди предков, у родителя, у предыдущих соседей. Направление выбрано из-за задачи. Движку нужно ответить, какие правила подходят **этому** элементу. Начиная справа, большинство правил отсекается на первом же шаге: `.sidebar .card a` для `<span>` даже не дойдёт до предков. Слева направо пришлось бы для каждого `.sidebar` обходить всё поддерево в поисках `a`.

Цена селектора определяется тем, сколько элементов проходят правую часть и как далеко потом приходится идти:

- `.nav-link` — один хеш-поиск.
- `.sidebar a` — каждый `a` на странице поднимается по предкам до `.sidebar` или до корня.
- `.sidebar *` или `[data-x] div` — то же для каждого элемента.

> [!WARNING]
> Детали реализации, а не спецификации. В Chromium правила заранее раскладываются по корзинам по **ключевому селектору** (key selector) — правому составному: по ID, классу, атрибуту, тегу. Для элемента проверяются только корзины его ID, классов и тега плюс универсальная. Предков отсекает `SelectorFilter`: при обходе дерева хеши ID, тегов, классов и атрибутов предков кладутся в bitset (bloom filter с одной хеш-функцией), а для каждого правила хеши его предковых условий посчитаны заранее. Если какого-то бита нет, правило отбрасывается без обхода предков. Совпадение фильтра — не гарантия: дальше идёт обычная проверка. По комментарию в исходниках фильтр отсекает 60–70% правил на реальных страницах.

Поэтому на интервью отвечают так. Длина селектора сама по себе почти ничего не стоит, дорого обходятся широкий ключевой селектор (`*`, тег, атрибут без значения) и частые изменения, которые запускают пересчёт для многих элементов. Измеряют это в DevTools через **Enable CSS selector stats** в Performance (подробно — в «[Оптимизации runtime](../performance/runtime.md)»). Сам пересчёт — шаг Style в [конвейере рендеринга](../browser/rendering-pipeline.md).

Важно и обратное правило парсинга. **Невалидный селектор выбрасывает всё правило**, а не одну часть списка. `.b, :unknown-x { … }` в Chromium не применился к `.b` вовсе, а `querySelectorAll('.a, :unknown-x')` бросил `SyntaxError`.

### `:is()`, `:where()`, `:not()` и forgiving selector list

`:is(A, B)` совпадает, если совпал любой аргумент. Им сокращают перестановки: `:is(article, aside) :is(h2, h3)` вместо четырёх селекторов. `:where()` делает то же, но со специфичностью ноль. `:not(A, B)` — ни один из аргументов. Как каждый из них влияет на специфичность — в «[Каскаде](./cascade.md)».

У `:is()` и `:where()` аргумент — **forgiving selector list**: каждый селектор разбирается отдельно, неразобранные выбрасываются, остальные работают. Проверено: `:is(.a, :unknown-x)` применился к `.a`, а CSSOM показал `selectorText` `:is(.a)`. У `:not()`, `:has()` и `of S` в `:nth-child()` список **не** forgiving: `.d:not(.x, :unknown-x)` и `.e:has(.x, :unknown-x)` выбросили всё правило. `:has()` был forgiving в ранних черновиках, в 2022 году это убрали ради совместимости с jQuery: она пробует `querySelectorAll` и при исключении переходит на свой движок, а forgiving `:has()` не бросал и молча ничего не находил.

Две ловушки:

- **Псевдоэлементы внутри не работают.** `:is(::before)` ничего не выбирает: `:is()` и `:not()` описывают элементы, а псевдоэлемент — не элемент.
- **Сложный селектор внутри `:is()` проверяется независимо от внешнего.** `.a :is(.b .c)` совпадёт с `.c`, у которого есть предки `.a` и `.b` в **любом** порядке. Проверено на `.b > .a > .c`: `.a .b .c` не совпал, `.a :is(.b .c)` совпал. Тот же эффект даёт CSS Nesting (см. ниже).

### `:has()` — реляционный псевдокласс

`:has()` принимает **относительные** селекторы (relative selectors): каждый начинается с неявного или явного комбинатора относительно проверяемого элемента.

```css
.card:has(img) {}           /* has an img descendant */
.card:has(> img) {}         /* has an img child */
h2:has(+ p) {}              /* immediately followed by a p */
form:has(input:user-invalid) button {} /* a form with an error: style its button */
:root:has(dialog[open]) { overflow: hidden; } /* page-level state without JS */
```

Ограничения: `:has()` нельзя вкладывать в `:has()`, а псевдоэлементы внутри недопустимы. `:has(:has(.a))` и `:has(::before)` в Chromium бросили `SyntaxError`. Обход через `:has(:is(:has(.x)))` синтаксически прошёл, но ничего не выбрал. Специфичность `:has()` — по самому специфичному аргументу.

Почему его долго не было: селекторы проверяются от элемента к предкам, а изменение внутри элемента до сих пор не требовало пересчёта его предков. С `:has()` добавление `<img>` в карточку меняет стиль самой карточки. Проверено: `.card:has(img)` перекрасил карточку сразу после `append`, а `form:has(input:invalid) button` — кнопку после ввода значения.

> [!WARNING]
> Инвалидация в Chromium. При изменении DOM движок сверяется с **invalidation sets**: какие классы, атрибуты и псевдоклассы участвуют в аргументах `:has()`. Только изменение такого признака запускает обход **вверх** по предкам (а для `+` и `~` — по соседям) в поисках subject. Флаги на элементах (есть ли выше якорь `:has()`) обрывают обход раньше. Механизм не точный и иногда помечает лишние элементы. Отсюда практика: аргумент `:has()` — конкретный (`:has(> .error)`, а не `:has(*)`), а `:root:has()` и `body:has()` с часто меняющимся аргументом (`:hover`) дороги: каждое изменение может пересчитывать стиль большого поддерева.

Поддержка `:has()`: Chrome 105, Firefox 121, Safari 15.4.

### Структурные псевдоклассы

`:nth-child(An+B)` выбирает элемент, номер которого среди **всех** детей родителя равен `An+B` при некотором n ≥ 0: `2n+1` (= `odd`) — нечётные, `-n+3` — первые три, `n+4` — с четвёртого. `:nth-last-child()` считает с конца, `:first-child`, `:last-child` и `:only-child` — частные случаи.

`:nth-child(An+B of S)` сначала отфильтровывает детей по S, потом считает. Разница с `S:nth-child(…)` видна на списке со скрытыми строками. `li.item:nth-child(odd)` фильтрует уже посчитанные позиции, поэтому зебра сбивается. `li:nth-child(odd of .item)` нумерует только `.item`. Проверено: на `item, hidden, item, item` первый вариант выбрал 1-й и 3-й, второй — 1-й и 4-й. Специфичность у них одинаковая (0, 2, 1). Поддержка `of S`: Chrome 111, Firefox 113, Safari 9.

`:nth-of-type()` считает среди соседей **того же тега**, а класс на счёт не влияет. В `<span>, <p class="x">, <p class="x">, <span class="x">` селектор `.x:nth-of-type(1)` выбрал только первый `p.x`: `span.x` — второй `span`. Для «первого с классом» нужен `:nth-child(1 of .x)`.

Остальное:

- **`:root`** — корень документа (`<html>`), но со специфичностью класса: `:root {}` бьёт `html {}`. На нём объявляют глобальные custom properties.
- **`:empty`** — нет детей-элементов и текста. Комментарии не мешают.
- **`:scope`** — точка отсчёта. В `el.querySelectorAll(':scope > li')` это `el`, в `@scope` — корень области, без контекста — корень документа.

> [!WARNING]
> `:empty` и пробелы. Selectors 4 (ED) разрешает внутри `:empty` пробельный текст, а Selectors 3 — нет. Браузеры живут по старому правилу: в Chromium `<div> </div>` и `<div>\n</div>` не совпали с `:empty`, а `<div><!-- c --></div>` совпал. Перенос строки в разметке уже делает элемент непустым, поэтому на `:empty` для «пустого» состояния компонента лучше не полагаться.

> [!WARNING]
> Ловушка `querySelectorAll` на элементе. Селектор проверяется по всему документу, а ограничивается только результат: `section.querySelectorAll('.outer p')` найдёт абзацы внутри `section`, даже если `.outer` — предок самой `section`. Проверено: вернулось 2 элемента. Чтобы весь селектор жил внутри элемента, пишут `:scope .outer p`.

### Псевдоклассы состояния

- **Действия пользователя**: `:hover`, `:active` и `:focus-within` совпадают и на предках: при фокусе в `input` `:focus-within` есть у `fieldset`, `form` и `body`. `:focus` — только на самом элементе.
- **`:focus-visible`** — фокус, который браузер решил **показать**. Правила эвристические, спецификация их только рекомендует: всегда показывать у полей, принимающих ввод с клавиатуры, и при навигации с клавиатуры, не показывать при клике мышью по кнопке. Проверено: клик по `button` — `:focus` да, `:focus-visible` нет; клик по `input` — да; `Tab` — да; `el.focus()` после клика мышью — нет, после нажатия клавиши — да. Поддержка: Chrome 86, Firefox 85, Safari 15.4.
- **Формы**: `:checked`, `:disabled`/`:enabled`, `:required`, `:invalid`, `:user-invalid`, `:placeholder-shown` (пока поле пустое и плейсхолдер виден). Когда совпадает `:user-invalid`, разобрано в «[HTML-формах](./html-forms.md)».
- **`:target`** — элемент, на который указывает фрагмент URL (`#sec`).
- **`:defined`** — элемент определён: все встроенные и custom elements после `customElements.define`. `x-foo:not(:defined)` скрывает компонент до регистрации, чтобы не мигал сырой контент.

Стандартный приём для фокуса — не убирать outline совсем, а показывать его только там, где он нужен:

```css
.btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.btn:focus:not(:focus-visible) { outline: none; }
```

### Псевдоэлементы

Псевдоэлемент (`::`) — бокс, который рендерится как часть элемента, но не узел DOM. `p::before` не появляется в `childNodes`, его не найдёт `querySelector`, а событие на нём приходит с `target` = сам `p`. Значение стиля читают через `getComputedStyle(el, '::before')`.

- **`::before` / `::after`** — первый и последний ребёнок элемента. Бокс создаётся, только если `content` вычисляется не в `none`/`normal`: без `content: ""` правило ничего не рисует. У замещаемых элементов (`img`, `input`, `video`) детей нет, поэтому и `::before` нет. Проверено: блочный `::before` высотой 50px увеличил `div` и `span`, а `img`, `input` и checkbox — нет. Текст из `content` читают скринридеры, поэтому смысловой текст в `content` не кладут.
- **`::marker`** — маркер `li` и `summary`. Принимает только ограниченный список свойств: шрифт, `color`, `content`, анимации, white-space. Проверено: `color`, `font-size` и `content` применились, `background` и `padding` — нет. Поддержка: Chrome 86, Firefox 68, полная в Safari 27.3 (раньше только `color` и `font-size`).
- **`::placeholder`** — текст плейсхолдера (не путать с `:placeholder-shown` — состоянием поля). **`::selection`** — выделенный текст. **`::file-selector-button`** — кнопка в `<input type="file">`.
- **`::backdrop`** — подложка под элементом в top layer: модальный `<dialog>`, popover, fullscreen. Сейчас он наследует от своего элемента, поэтому custom properties `dialog` и `:root` доступны внутри `var()`. Проверено в Chromium: `var(--c)` из `dialog` сработал. Наследование: Chrome 122, Firefox 120, Safari 17.4. Раньше `::backdrop` ни от кого не наследовал, и токены приходилось объявлять прямо в нём.

Псевдоэлемент стоит **последним** в селекторе. За ним допустимы только некоторые псевдоклассы действий пользователя. `p::before:hover` и `p::before::after` Chromium выбросил, а рабочая форма — `p:hover::before`.

### Shadow DOM: `:host`, `::slotted()`, `::part()`

Селекторы не пересекают границу shadow root: снаружи `querySelectorAll('span.inner')` не находит элементы внутри, а правило `x-card span.inner` к ним не применяется. Как устроено shadow-дерево — в «[DOM API](../browser/dom.md)». Для стилизации через границу есть три селектора:

- **`:host`, `:host(.big)`** — хост изнутри его shadow root. Правило снаружи на сам хост **сильнее** `:host` при обычных объявлениях, независимо от специфичности: это шаг каскада «context», см. «[Каскад](./cascade.md)». Проверено: `x-card { color }` снаружи перебил `:host { color }`. Поэтому `:host` — значения по умолчанию, которые потребитель переопределит. `:host-context()` устарел и есть только в Chromium.
- **`::slotted(<compound>)`** — элементы, которые помещены в `<slot>`, и **только верхнего уровня**. Аргумент — один составной селектор: `::slotted(.a .b)` Chromium выбросил. Проверено: `::slotted(b)` не выбрал `<b>` внутри слотированного `span`, тот получил цвет наследованием. Внешние стили на слотированный элемент тоже побеждают: `x-a span` снаружи перебил `::slotted(span)`.
- **`::part(name)`** — элемент внутри shadow root с атрибутом `part="name"`, стилизуемый **снаружи**. Это явный API компонента. После `::part()` можно писать псевдоклассы состояния (`::part(label):hover` работает), но не структурные: `::part(label):first-child` выброшен. Иначе снаружи была бы видна внутренняя структура.

> [!NOTE]
> Scoped-стили Vue — не shadow DOM, а переписанные селекторы. У них свои `:deep()`, `:slotted()` и `:global()` с другой семантикой. Подробно — в «[Стилях в компонентах](../vue/styles.md)».

### CSS Nesting

Вложенное правило — селектор относительно родителя. `&` обозначает родителя и семантически равно `:is(<селектор родителя>)`, а вложенный селектор без `&` получает `& ` (потомок) неявно.

```css
.card {
  color: black;
  &:hover { color: navy; }        /* .card:hover */
  .title { font-weight: 700; }    /* .card .title */
  > img { display: block; }       /* .card > img */
  .theme-dark & { color: white; } /* .theme-dark .card */
  @media (width >= 40rem) { padding: 2rem; } /* nested conditional rule */
}
```

Отличия от Sass, на которых ломается миграция:

- **`&` — не строка.** `&__title` в Sass даёт `.card__title`, а в CSS это невалидный селектор (тип не может стоять после `&`). Проверено: Chromium выбросил правило, `.card2__title` не получил стиль. BEM-имена в нативном nesting пишут полностью.
- **`:hover` без `&` — это потомок.** `.card { :hover {} }` = `.card :hover`: hover на любом потомке, а не на карточке.
- **Семантика `:is()`.** `.a .b { .c & {} }` = `.c :is(.a .b)` и совпадает с `.a > .c > .b`. Sass развернул бы строку в `.c .a .b`, и такого совпадения бы не было. Проверено в Chromium.
- **Специфичность по `:is()`**: `.a, #b { & p {} }` получает ID-специфичность даже для `.a p` (подробно — в «[Каскаде](./cascade.md)»).
- **Объявления после вложенного правила** остаются на своём месте по порядку (CSSOM оборачивает их в `CSSNestedDeclarations`). `.btn { color: red; &:hover {} color: green }` даёт зелёный.

Поддержка: Chrome 120, Firefox 117, Safari 17.2. Chrome 112–119 и Safari 16.5–17.1 не принимали вложенный селектор, начинающийся с тега (`.card { img {} }`), его приходилось писать как `& img`.

## Примеры

Форма без JS-флагов состояния: карточки выбора тарифа, ошибка, зебра в таблице с фильтром.

```html
<form class="checkout">
  <fieldset class="plans">
    <label class="plan"><input type="radio" name="plan" value="basic"> Basic</label>
    <label class="plan"><input type="radio" name="plan" value="pro"> Pro</label>
  </fieldset>
  <label class="field">Email <input type="email" name="email" required></label>
  <button>Pay</button>
</form>

<table class="orders">
  <tr><td>1</td></tr>
  <tr hidden><td>2</td></tr>
  <tr><td>3</td></tr>
  <tr><td>4</td></tr>
</table>

<style>
  .plan {
    display: block;
    border: 2px solid #d4d4d8;
    &:has(:checked) { border-color: #2563eb; }                 /* selected card */
    &:has(:focus-visible) { outline: 2px solid #2563eb; }      /* keyboard focus on hidden radio */
  }
  .plans:has(:checked) .plan:not(:has(:checked)) { opacity: 0.6; } /* dim the others */

  .field:has(:required)::after { content: " *"; color: #dc2626; }  /* required marker */
  .field:has(input:user-invalid) { color: #dc2626; }

  .checkout:has(:user-invalid) button { opacity: 0.5; }

  .orders tr:nth-child(even of :not([hidden])) { background: #f4f4f5; }
</style>
```

Проверка в браузере: после выбора Pro у его карточки синяя рамка, у Basic `opacity: 0.6`. До взаимодействия с email ни поле, ни кнопка не красные, после ввода `abc` и ухода с поля — красные. Серым закрашена строка 3: вторая из видимых.

Отладка селектора в консоли:

```js
// Which rules match an element, and from where (CSSOM walk; same-origin sheets only)
function matchingRules(el) {
  const out = [];
  const walk = (rules, sheet) => {
    for (const rule of rules) {
      if (rule.selectorText && el.matches(rule.selectorText)) {
        out.push(`${rule.selectorText}  (${sheet.href ?? 'inline'})`);
      }
      if (rule.cssRules) walk(rule.cssRules, sheet); // @media, @layer, @supports
    }
  };
  for (const sheet of document.styleSheets) walk(sheet.cssRules, sheet);
  return out;
}

CSS.supports('selector(:has(a))');   // true where :has() is supported
CSS.supports('selector(:has-slotted)'); // false in Chromium 159
```

`matchingRules` грубая: вложенные правила проверяются по своему `selectorText` без родителя, а псевдоэлементы `matches` не принимает. Для точного ответа — панель Styles в DevTools.

## Вопросы с интервью

::: details Почему браузер сопоставляет селекторы справа налево
Движок решает задачу «какие правила подходят этому элементу». Справа стоит subject, и по нему большинство правил отсекается сразу: правило с ключевым селектором `.card a` не рассматривается для `span`. Затем комбинаторы ведут к предкам и соседям. Слева направо пришлось бы от каждого `.card` обходить поддерево. Спецификация (Selectors 4, §17.3) описывает тот же порядок. В Chromium правила заранее разложены по корзинам по ключевому селектору (ID, класс, тег), а предков отсекает bloom filter с хешами ID, классов, тегов и атрибутов предков. Практический вывод: дорог не длинный селектор, а широкий ключевой (`*`, тег, `[attr]`) с потомковым комбинатором, потому что каждый подходящий элемент поднимается по предкам.
:::

::: details Чем отличаются is, where и not и что такое forgiving selector list
`:is(A, B)` — совпал любой аргумент, специфичность по самому специфичному аргументу. `:where()` — то же, но специфичность ноль: на нём пишут сбросы и стили библиотек. `:not(A, B)` — не совпал ни один, специфичность как у `:is()`. Обычный список селекторов неустойчив: одна невалидная часть, например `::-moz-focus-inner` в Chromium, выбрасывает всё правило. `:is()` и `:where()` принимают forgiving list: невалидные аргументы выбрасываются, остальные работают. У `:not()`, `:has()` и `of S` список не forgiving. Псевдоэлементы внутри всех трёх недопустимы. И сложный селектор в аргументе проверяется независимо: `.a :is(.b .c)` совпадает и при `.b > .a > .c`.
:::

::: details Как работает has и почему его называют родительским селектором, хотя это не совсем так
`:has()` выбирает элемент, для которого относительный селектор из аргумента нашёл совпадение: потомка (`:has(img)`), ребёнка (`:has(> img)`), следующего соседа (`:has(+ p)`). Поэтому он покрывает больше, чем «родительский селектор»: можно стилизовать предыдущего соседа, всю форму по состоянию поля, страницу по открытому диалогу (`:root:has(dialog[open])`). Ограничения: нельзя вкладывать `:has()` в `:has()`, нельзя псевдоэлементы, список аргументов не forgiving. Цена — инвалидация: изменение внутри элемента теперь требует пересчитать стиль предков. Chromium по invalidation sets понимает, какие признаки участвуют в аргументах, и только при их изменении поднимается вверх по дереву. Поэтому аргумент делают конкретным, а `:root:has(:hover)` избегают.
:::

::: details Чем nth-child с of S отличается от класса плюс nth-child и от nth-of-type
`li.item:nth-child(odd)` считает позицию среди **всех** детей, а класс только отбрасывает лишних из посчитанных, поэтому скрытая строка сбивает зебру. `li:nth-child(odd of .item)` сначала оставляет только `.item`, потом считает: зебра идёт по видимым. Специфичность одинаковая. `:nth-of-type()` считает среди соседей того же **тега**, а класс на счёт не влияет: `.x:nth-of-type(1)` — это «первый элемент своего тега, если у него есть `.x`», а не «первый `.x`». Для последнего нужен `:nth-child(1 of .x)`.
:::

::: details Чем псевдокласс отличается от псевдоэлемента и почему у img нет before
Псевдокласс — дополнительное условие на существующий элемент: состояние (`:hover`, `:checked`), положение (`:first-child`), отношение (`:has()`). Псевдоэлемент — бокс, которого нет в DOM: `::before`, `::after`, `::marker`, `::placeholder`, `::backdrop`. Его не найдёт `querySelector`, клик по нему приходит с `target` элемента, стиль читают через `getComputedStyle(el, '::before')`. `::before` и `::after` — первый и последний **ребёнок** элемента и создаются, только если задан `content`. У замещаемых элементов (`img`, `input`, `video`) нет детей, которые рендерит CSS, поэтому нет и `::before`. Псевдоэлемент стоит в конце селектора: `p:hover::before`, а не `p::before:hover`.
:::

::: details Как стилизовать web component снаружи и изнутри
Изнутри: `:host` и `:host(.variant)` стилизуют хост, `::slotted(<compound>)` — элементы верхнего уровня, переданные в слот. Снаружи: обычные правила на хост, наследуемые свойства и custom properties проходят внутрь, а `::part(name)` — элементы с `part="name"`, которые автор компонента сделал публичными. После `::part()` разрешены псевдоклассы состояния, но не структурные, чтобы внутренняя разметка не стала API. По каскаду правила снаружи сильнее `:host` и `::slotted()` при обычных объявлениях, поэтому изнутри задают умолчания. Темизацию делают через custom properties, точечные переопределения — через `::part()`. Vue scoped-стили — не shadow DOM, у них свои `:deep()` и `:slotted()`.
:::

::: details Чем нативный CSS Nesting отличается от Sass
`&` в CSS — не подстановка строки, а `:is(<родитель>)`. Отсюда три отличия. `&__title` невалиден, BEM-конкатенации нет. `.a .b { .c & {} }` = `.c :is(.a .b)`, и он совпадает при любом порядке предков `.a` и `.c`. Специфичность родителя считается по `:is()`, поэтому `.a, #b { & p {} }` получает ID-специфичность и для `.a p`. Общие правила: вложенный селектор без `&` — потомок, то есть `.card { :hover {} }` — это hover на потомке. Вложенные `@media`, `@supports`, `@container` и `@layer` работают как в Sass. Объявления после вложенного правила сохраняют порядок. Поддержка — Chrome 120, Firefox 117, Safari 17.2. Если нужны старые Safari, сборщик (Lightning CSS, PostCSS) разворачивает nesting.
:::

## Задачи

### 1. Какие строки закрашены · легко

Какие `li` получат фон, а какие рамку?

```html
<style>
  li.item:nth-child(2n) { background: gold; }
  li:nth-child(2n of .item) { outline: 2px solid navy; }
  .item:nth-of-type(2) { color: red; }
</style>
<ul>
  <li class="item">A</li>
  <li class="ad">Ad</li>
  <li class="item">B</li>
  <li class="item">C</li>
  <li class="item">D</li>
</ul>
```

::: details Решение и разбор
- **Фон** — только у **C**. `li.item:nth-child(2n)` считает всех детей: чётные позиции — 2 (Ad) и 4 (C). Ad без `.item` отпадает.
- **Рамка** — `of .item` нумерует только `.item`: A=1, B=2, C=3, D=4. Чётные — **B и D**.
- **Красный текст** — `:nth-of-type(2)` считает все `li`, второй — Ad, у него нет `.item`. **Никто.**

Проверено в Chromium. Зебру по видимым строкам делают через `of S`, а не через класс.
:::

### 2. Найдите баг: фокус перестал работать в Chrome · легко

Дизайнер прислал стиль кнопки, и в Chrome кнопка потеряла и hover, и кольцо фокуса. В Firefox всё работает.

```css
.btn:hover,
.btn:focus-visible,
.btn::-moz-focus-inner {
  border-color: #2563eb;
}
```

::: details Решение и разбор
`::-moz-focus-inner` — псевдоэлемент Gecko. Chromium (и WebKit) его не знает, селектор невалиден, а невалидная часть обычного списка выбрасывает **всё** правило. Проверено: в Chromium правило не попало в CSSOM.

Исправление — разделить правила:

```css
.btn:hover,
.btn:focus-visible { border-color: #2563eb; }
.btn::-moz-focus-inner { border: 0; }
```

`:is()` здесь не поможет: forgiving list выбросил бы неизвестную часть, но псевдоэлементы внутри `:is()` недопустимы в принципе, поэтому `::-moz-focus-inner` в нём не сработал бы и в Firefox. Тот же баг возникает со смесью префиксных псевдоклассов (`:-webkit-autofill, :autofill`) и со свежими селекторами, которых нет в старых браузерах. Для них `:is()` как раз подходит: `:is(:autofill, :-webkit-autofill)`.
:::

### 3. Миграция с Sass на нативный nesting · средне

После удаления Sass из сборки сломались два места. Заголовки карточек перестали быть жирными. А ссылки в раскрытом подменю десктопной навигации стали белыми на белом фоне, хотя белыми они должны быть только в мобильном меню, которое открывается классом на `body`. Что сломалось и как исправить?

```html
<nav class="nav">
  <a class="link" href="/">Home</a>
  <ul class="submenu is-open">
    <li><a class="link" href="/docs">Docs</a></li>
  </ul>
</nav>

<style>
  .nav .link {
    color: navy;
    .is-open & { color: white; } /* mobile menu: <body class="is-open"> */
  }
  .card {
    &__title { font-weight: 700; }
  }
</style>
```

::: details Решение и разбор
- **`.is-open &`.** Sass подставлял строку: `.is-open .nav .link`, и `.is-open` обязан был стоять выше `.nav`. Нативно `&` — это `:is(.nav .link)`, правило становится `.is-open :is(.nav .link)`. `:is()` проверяется независимо, поэтому подходит любая `.link` с предками `.is-open` и `.nav` в **любом** порядке, в том числе `.nav > .submenu.is-open > li > .link`. Проверено в Chromium: Docs белая, Home синяя.
- **`&__title`.** Sass склеивал строку в `.card__title`. В CSS `&` — простой селектор, а `__title` после него читается как тип, который не может стоять после другого простого селектора. Правило невалидно и выброшено.

Исправление — не полагаться на склейку и на порядок предков в `:is()`:

```css
.nav .link { color: navy; }
body.is-open .nav .link { color: white; }  /* explicit chain, no :is() reordering */
.card__title { font-weight: 700; }
```

Если вложенность нужна, `.is-open` привязывают к конкретному месту: `body.is-open &` уже не совпадёт с `ul.is-open`. Ещё одна разница проявится позже: родитель-список `.card, #promo` даст `:is(.card, #promo)`, и все вложенные правила получат ID-специфичность.
:::

### 4. Сверстайте выбор тарифа без JS · сложно

Нужен выбор тарифа из карточек на радиокнопках. Выбранная карточка с синей рамкой, остальные приглушены, но только после выбора. Кольцо фокуса видно на карточке при навигации с клавиатуры и не видно при клике. Пока выбранный тариф `pro`, показывается блок с полем «Компания». Кнопка оплаты бледная, пока в форме есть поле с ошибкой после взаимодействия. Доступность радиогруппы не ломать.

::: details Решение и разбор
```html
<form class="checkout">
  <fieldset class="plans">
    <legend>Plan</legend>
    <label class="plan"><input type="radio" name="plan" value="basic" required> Basic</label>
    <label class="plan"><input type="radio" name="plan" value="pro"> Pro</label>
  </fieldset>
  <label class="company">Company <input name="company"></label>
  <label>Email <input type="email" name="email" required></label>
  <button>Pay</button>
</form>

<style>
  .plan {
    position: relative; /* containing block for the hidden radio */
    display: block;
    border: 2px solid #d4d4d8;
    border-radius: 8px;
    &:has(:checked) { border-color: #2563eb; }
    &:has(:focus-visible) { outline: 2px solid #2563eb; outline-offset: 2px; }
  }
  .plan input {
    /* visually hidden, still focusable and announced */
    position: absolute; width: 1px; height: 1px; overflow: hidden;
    clip-path: inset(50%); white-space: nowrap;
  }
  .plans:has(:checked) .plan:not(:has(:checked)) { opacity: 0.6; }

  .company { display: none; }
  .checkout:has([name="plan"][value="pro"]:checked) .company { display: block; }

  .checkout:has(:user-invalid) button { opacity: 0.5; }
</style>
```

- **Радио не удаляется и не получает `display: none`.** Иначе оно выпадет из порядка фокуса и дерева доступности. Оно визуально скрыто, а `label` даёт клик по всей карточке. Стрелки переключают выбор, как в нативной группе.
- **`:has(:focus-visible)`** переносит кольцо с невидимого радио на карточку. Проверено: клик по карточке — `:focus-visible` нет, `Tab` и стрелки — есть.
- **`.plans:has(:checked)`** — условие «уже выбрали», без него карточки были бы приглушены с самого начала.
- **Блок «Компания»** по значению выбранного радио. `display: none` выбрасывает поле из порядка фокуса, но не из отправки формы: если оно не нужно на сервере, поле дополнительно делают `disabled` из кода. Это граница чистого CSS.
- **`:user-invalid`**, а не `:invalid`: иначе кнопка была бы бледной с самого начала из-за пустого `required`.

Проверено в Chromium: до выбора рамки серые и `opacity` 1. После выбора Pro у него синяя рамка, у Basic 0.6, блок «Компания» виден. Кнопка бледнеет после ввода неверного email и ухода с поля. Стоимость: все `:has()` привязаны к форме, а не к `:root`, и аргументы конкретные, поэтому пересчёт ограничен формой.
:::

## Источники

- [Selectors Level 4](https://drafts.csswg.org/selectors-4/)
- [Selectors Level 5](https://drafts.csswg.org/selectors-5/)
- [CSS Pseudo-Elements Module Level 4](https://drafts.csswg.org/css-pseudo-4/)
- [CSS Nesting Module Level 1](https://drafts.csswg.org/css-nesting-1/)
- [CSS Scoping Module Level 1](https://drafts.csswg.org/css-scoping-1/)
- [CSS Shadow Parts](https://drafts.csswg.org/css-shadow-parts/)
- [HTML Living Standard: Pseudo-classes](https://html.spec.whatwg.org/multipage/semantics-other.html#pseudo-classes)
- [Chromium: `SelectorFilter` (bloom filter предков)](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/selector_filter.h)
- [Byungwoo Lee: How Blink invalidates styles when `:has()` in use?](https://blogs.igalia.com/blee/posts/2023/05/31/how-blink-invalidates-styles-when-has-in-use.html)
- [MDN: CSS selectors](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_selectors)
- [MDN: `:has()`](https://developer.mozilla.org/en-US/docs/Web/CSS/:has)
- [MDN: `:is()`](https://developer.mozilla.org/en-US/docs/Web/CSS/:is)
- [MDN: `:focus-visible`](https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible)
- [MDN: Using CSS nesting](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_nesting/Using_CSS_nesting)
- [MDN browser-compat-data](https://github.com/mdn/browser-compat-data)
