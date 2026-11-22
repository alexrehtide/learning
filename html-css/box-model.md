---
title: Box model, BFC и схлопывание отступов
level: ядро
---

# Box model, BFC и схлопывание отступов

> **Коротко.** Каждый элемент порождает бокс из четырёх областей: content, padding, border, margin. `box-sizing` решает, к какой из них относится `width`. Внешний тип `display` задаёт, как бокс участвует в раскладке родителя (block или inline), внутренний — как он раскладывает детей (flow, flow-root, flex, grid). Block formatting context (BFC) — изолированная область потока: он содержит свои float, не наезжает на чужие и не схлопывает margin с детьми. Вертикальные margin соседних блоков в одном BFC схлопываются в один: берётся максимум положительных плюс минимум отрицательных. Схлопывание не происходит во flex и grid, через padding или border и на границе BFC.

**Связанные темы:** [Конвейер рендеринга: layout, paint, composite](../browser/rendering-pipeline.md), [Каскад, специфичность, наследование и custom properties](./cascade.md), [Семантический HTML и мультимедиа](./semantic-html.md), [Стили в компонентах: scoped, CSS Modules, `v-bind()` в `<style>`](../vue/styles.md), [Селекторы, псевдоклассы и псевдоэлементы](./selectors.md)

## Теория

Фрагменты проверены в Chromium 159 (Playwright 1.65, headless): страница через `page.setContent`, геометрия через `getBoundingClientRect` и `getComputedStyle`. Спецификации — CSS 2.2 (главы 8–10), CSS Box Model 3, CSS Display 3, CSS Box Sizing 3, CSS Overflow 3 (сверено 2026-11-22). Поддержка в браузерах — по MDN browser-compat-data 8.1.10 (2026-11-19).

### Четыре области и `box-sizing`

Бокс состоит из **content box**, вокруг него **padding box**, **border box** и **margin box**. Фон рисуется до края border box (`background-clip` меняет это), margin всегда прозрачен.

`box-sizing` решает, что измеряют `width` и `height`:

- **`content-box`** (начальное значение): `width` — ширина контента. `width: 200px; padding: 20px; border: 5px` даёт бокс шириной 250px.
- **`border-box`**: `width` — ширина border box, контенту остаётся 200 − 40 − 10 = 150px. Если padding и border больше `width`, контент сжимается до нуля, но бокс не меньше их суммы: `width: 20px; padding: 0 30px` даёт 60px.

Поэтому почти каждый reset начинается с `*, *::before, *::after { box-sizing: border-box }`: размер, указанный в макете, совпадает с размером на экране. `getComputedStyle(el).width` для отрисованного элемента возвращает used value в терминах его `box-sizing` (подробно о resolved value — в теме «[Каскад](./cascade.md#стадии-значения)»).

**Проценты.** `width` и горизонтальные padding/margin считаются от ширины **containing block** — обычно content box ближайшего блочного предка. Вертикальные `padding` и `margin` в процентах тоже считаются **от ширины**, а не от высоты: в блоке 400×100 `padding-top: 10%` — это 40px. Точнее, от inline size containing block: в `writing-mode: vertical-rl` они считаются от высоты. Иначе высота зависела бы от процента от самой себя. На этом держался старый приём «резиновое видео»: `padding-top: 56.25%` давал 16:9. Сейчас это `aspect-ratio`.

Процентная `height` считается от высоты containing block, только если та задана явно. У родителя с `height: auto` `height: 50%` ведёт себя как `auto`: высота родителя зависит от детей, и цикл разрывается так.

Что включает containing block для абсолютного и фиксированного позиционирования — в теме «Позиционирование и stacking context».

### `display`: внешний и внутренний тип

CSS Display 3 раскладывает `display` на два ключевых слова:

| Короткая форма | Полная | Внешний: как участвует в родителе | Внутренний: как раскладывает детей |
| --- | --- | --- | --- |
| `block` | `block flow` | блок, с новой строки | normal flow |
| `inline` | `inline flow` | в строке | normal flow (inline-контент) |
| `flow-root` | `block flow-root` | блок | normal flow в **новом BFC** |
| `inline-block` | `inline flow-root` | в строке | normal flow в новом BFC |
| `flex` / `inline-flex` | `block flex` / `inline flex` | блок / в строке | flex formatting context |
| `grid` / `inline-grid` | `block grid` / `inline grid` | блок / в строке | grid formatting context |

Многословный синтаксис поддерживают Chrome 115, Firefox 70, Safari 15. `getComputedStyle` сериализует значение в короткую форму: `display: inline flow-root` читается как `inline-block`.

**Normal flow** — раскладка по умолчанию. Блочные боксы идут сверху вниз в **block formatting context**, inline-контент — слева направо строками в **inline formatting context**. Каждая строка — **line box**. Его высота складывается из `line-height` и `vertical-align` всех inline-боксов строки и невидимого **strut** — пустого inline-бокса со шрифтом и `line-height` самого блока. Поэтому `<span style="font-size: 32px; line-height: 20px">` в строке с `line-height: 20px` дал line box 26px, а не 20: у крупного шрифта своя базовая линия, и выравнивание по ней раздвигает строку. `vertical-align: super` у мелкого шрифта тоже увеличил строку (20 → 23.33px).

Inline-бокс (`span`, `a`, `em`) не управляет геометрией строки:

- `width` и `height` к нему не применяются;
- вертикальные `margin` не действуют, а вертикальные `padding` и `border` рисуются, но высоту строки не меняют и наезжают на соседние строки. У `span` с `margin: 30px; padding: 10px` высота родителя осталась 20px, а фон вылез на 9px выше;
- горизонтальные margin, padding и border раздвигают текст.

**`inline-block`** снаружи inline (встаёт в строку и выравнивается по `vertical-align`), а внутри — новый BFC, поэтому у него работают размеры и все отступы. Два побочных эффекта, о которых спрашивают:

- **Пробел между тегами** в разметке — текст, и между двумя `inline-block` появляется зазор шириной пробела (4.45px для 16px sans-serif). Лечение — flex или grid вместо `inline-block`.
- **Базовая линия.** Baseline `inline-block` — baseline его последнего line box. Но если `overflow` не `visible`, baseline становится нижним краем margin box. Две одинаковые плашки рядом, у одной `overflow: hidden`: она поднялась, другая сдвинулась вниз на 25px, строка выросла с 60 до 85px.

**Анонимные боксы.** Box tree не совпадает с DOM. Если в блоке смешаны текст и блочные дети (`<div>text<p>para</p>more</div>`), текст оборачивается в **анонимные блочные боксы**: в блочном контейнере дети либо все блочные, либо все inline. Анонимный бокс не выбирается селектором, наследует от родителя и не имеет своих стилей. Так же текст внутри flex-контейнера оборачивается в анонимный flex-элемент.

**`display: contents`** убирает бокс элемента, а дети встают на его место в box tree. `padding`, `border`, `background` и `margin` элемента пропадают, у него нет `getBoundingClientRect` (нули) и `getClientRects()` пуст. Наследование при этом идёт по DOM: `color` с `display: contents` дети получают. Типичное применение — обёртка, которая мешает flex или grid: дети обёртки становятся flex-элементами внешнего контейнера.

> [!WARNING]
> Для замещаемых элементов и некоторых элементов форм (`img`, `video`, `input` и др.) CSS Display 3 предписывает поведение как у `display: none`. В Chromium `img` с `display: contents` не отрисовался совсем. По MDN, в ранних реализациях элемент с `display: contents` выпадал из дерева доступности вместе с ролью (у `button` — тоже), поэтому на интерактивных элементах и элементах со смыслом (`ul`, `table`) его не применяют.

**Blockification.** Некоторые контексты принудительно делают внешний тип блочным. Float, `position: absolute`/`fixed`, а также дети flex- и grid-контейнера получают computed `display: block` даже у `span`. Поэтому `display: inline` у абсолютно позиционированного элемента ничего не меняет.

### Block formatting context

BFC — область, внутри которой блоки раскладываются по правилам normal flow независимо от внешнего мира. CSS Display 3 называет это **independent formatting context**: внешнее не влияет на раскладку внутри, внутреннее не выходит наружу.

Что создаёт новый BFC для своего содержимого (проверено: float внутри растягивал высоту родителя до 100px):

- `display: flow-root` (и `inline-block`) — единственный способ без побочных эффектов;
- `overflow` со значением `hidden`, `auto` или `scroll` — элемент становится **scroll container**, а он всегда устанавливает independent formatting context;
- `float` и `position: absolute`/`fixed`;
- flex- и grid-элементы: их содержимое раскладывается в своём контексте;
- `contain: layout`, `contain: paint` и включающие их `content`/`strict`;
- multicol-контейнер (`columns`), ячейки таблицы, `display: table-caption`.

**`overflow: clip` не создаёт BFC** и не делает элемент scroll container: float внутри него высоту родителя не растянул (0px), а margin ребёнка схлопнулся с родительским. Это отличие от `hidden` прописано в CSS Overflow 3.

Что даёт BFC:

1. **Содержит float.** Высота блока с `height: auto` в обычном потоке float не учитывает: родитель с одним float внутри имеет высоту 0, и следующий блок встаёт под float, обтекая его текстом. Корень BFC растягивается до нижнего края своих float. Раньше для этого писали clearfix (`::after { content: ""; display: block; clear: both }`), сейчас — `display: flow-root`.
2. **Не наезжает на внешние float.** Обычный блок рядом с float начинается под ним: его бокс занимает всю ширину 400px, отодвигается только текст. Блок с `flow-root` сужается до свободного места (300px справа от float шириной 100px). Если ему задана ширина, которая не помещается (350px), он целиком уходит ниже float.
3. **Не схлопывает margin с детьми**, см. ниже. Свои margin корня BFC схлопывает с соседями снаружи как обычно: `flow-root` с `margin-top: 10px` после блока с `margin-bottom: 20px` дал зазор 20px.

### Схлопывание margin

В CSS 2.2 (§8.3.1) вертикальные margin **соседствуют** (adjoining), если принадлежат in-flow блочным боксам одного BFC и между ними нет line box, clearance, padding и border. Соседствующие margin схлопываются в один. Горизонтальные margin не схлопываются никогда.

Три ситуации:

- **Соседи.** `margin-bottom: 30px` и следующий `margin-top: 20px` — зазор 30px.
- **Родитель и первый или последний ребёнок.** `margin-top` первого ребёнка схлопывается с `margin-top` родителя, если у родителя нет верхних padding и border и он не корень BFC. Результат оказывается **снаружи** родителя: `margin-top: 40px` ребёнка сдвинул родителя с фоном на 40px вниз, а фон начинается сразу над текстом. Для нижнего края есть ещё условие: у родителя `height: auto` (с `height: 100px` схлопывания нет). `min-height` в Chromium этому не помешал.
- **Пустой блок.** Если у блока нет контента, padding, border, высоты и `min-height`, его `margin-top` и `margin-bottom` схлопываются друг с другом и со всеми соседними: `20px` и `30px` пустого блока между двумя текстами дали зазор 30px. Добавили `min-height: 1px` — 51px.

Как считается результат, если margin несколько и они разных знаков: **максимальный положительный плюс минимальный (самый отрицательный) отрицательный**. Цепочка 30px, пустой блок с 10px и −25px, затем 20px даёт 30 − 25 = 5px. Только отрицательные (−30px и −10px) дают −30px, блоки перекрываются.

Когда схлопывания **нет**:

- у flex- и grid-элементов: в колонке `flex-direction: column` margin 30px и 20px дали 50px, и margin первого элемента остался внутри контейнера;
- у float, абсолютно позиционированных и `inline-block` боксов;
- между родителем и ребёнком, если их разделяет padding, border или line box;
- между корнем BFC и его детьми (`flow-root`, `overflow: hidden`);
- у корневого элемента.

> [!TIP]
> Межблочные отступы надёжнее задавать через `gap` во flex или grid или одной стороной (`* + * { margin-block-start: … }`), тогда схлопывание не участвует. `margin-trim` (обрезать margin детей у краёв контейнера) поддержан в Safari 16.4 и Chrome 155, в Firefox нет.

### Ширина: `auto`, `100%` и внутренние размеры

У блока в normal flow `width: auto` значит **stretch-fit**: занять ширину containing block минус свои margin, border и padding. `width: 100%` — это ширина containing block, к которой при `content-box` прибавятся padding и border. В контейнере 300px блок с `padding: 0 20px` и `width: auto` занял 300px, а с `width: 100%` — 340px и вылез наружу. `width: auto` почти всегда правильнее. `width: stretch` (Chrome 138, Firefox 146, Safari 27) даёт поведение `auto` там, где `auto` значит другое, например у flex-элемента.

Сумма `margin-left + border + padding + width + … + margin-right` должна равняться ширине containing block (CSS 2.2 §10.3.3). Если всё задано и сумма не сходится (over-constrained), браузер игнорирует `margin-right` в LTR и `margin-left` в RTL. Поэтому `margin: 0 auto` центрирует блок с заданной шириной: два `auto` делят остаток поровну. Вертикальные `auto` у блока в normal flow равны нулю, а во flex, grid и у абсолютного бокса с `inset: 0` центрируют и по вертикали (проверено: 125px сверху в контейнере 300px).

> [!WARNING]
> В Chromium `getComputedStyle(el).marginRight` у over-constrained блока возвращает указанные 50px, хотя фактически отступ справа 250px. CSSOM требует для margin used value. Геометрию проверяйте через `getBoundingClientRect`.

Внутренние размеры (intrinsic sizes) из CSS Box Sizing 3:

- **`min-content`** — самая узкая ширина без переполнения: по самому длинному неразрывному слову (69px для «hello wonderful world»);
- **`max-content`** — ширина без переносов строк (150px);
- **`fit-content`** — `min(max-content, max(min-content, доступная ширина))`: короткий текст — по содержимому (150px), длинный — не шире контейнера (500px). Так ведут себя float, `inline-block` и абсолютные боксы с `width: auto`.

**`aspect-ratio`** задаёт пропорцию, если один из размеров `auto`: при ширине 300px `aspect-ratio: 16 / 9` дал 168.75px. Пропорция — не жёсткая высота. Высоту ограничивает автоматический минимум (`min-height: auto`), поэтому контент высотой 500px растянул квадрат до 500px. `min-height: 0` или `overflow` кроме `visible` возвращают 300px, и контент переполняет блок. Как атрибуты `width`/`height` у `<img>` превращаются в `aspect-ratio` — в теме «[Семантический HTML и мультимедиа](./semantic-html.md)».

### `overflow` и scroll container

`overflow` решает, что делать с содержимым, которое не поместилось в padding box:

| Значение | Обрезает | Scroll container | Новый BFC | Прокрутка |
| --- | --- | --- | --- | --- |
| `visible` | нет | нет | нет | — |
| `clip` | да | нет | нет | никакой, `scrollTop` остаётся 0 |
| `hidden` | да | да | да | нет полос, но скрипт прокручивает (`scrollTop = 100` сработал) |
| `auto` / `scroll` | да | да | да | полосы по необходимости / всегда |

`overflow` задаёт `overflow-x` и `overflow-y`. Если одна ось прокручиваемая (`hidden`, `auto`, `scroll`), то `visible` на другой вычисляется в `auto`: `overflow-x: hidden; overflow-y: visible` читается как `overflow-y: auto`. Поэтому нельзя обрезать по горизонтали и выпустить тень по вертикали через `hidden`, а с `clip` можно: `overflow-x: clip` оставил `overflow-y: visible`. `overflow-clip-margin` расширяет область обрезки `clip` (Chrome 90 с ограничениями, Firefox 102, в Safari нет).

Scroll container — не только полосы прокрутки. Для него `position: sticky` ищет ближайший прокручиваемый предок, и `overflow: hidden` на обёртке ломает липкий заголовок. Об этом и о том, как `overflow` обрезает абсолютных потомков, — в теме «Позиционирование и stacking context».

### Float — кратко

Float изначально был для обтекания текстом картинки. Float выходит из потока: блоки за ним его не видят, их line box сужаются. Margin float не схлопываются: 20px соседа и 30px float дали 50px. `clear: left|right|both` опускает блок ниже float через clearance. Раскладки на float (колонки, сетки) заменены flex и grid. Остаётся обтекание (`shape-outside`) и вопрос на интервью «что такое clearfix и почему его заменил `flow-root`».

Стоимость: изменение `width`, `padding`, `margin` и `display` запускает layout, см. «[Конвейер рендеринга](../browser/rendering-pipeline.md)». `contain: layout` ограничивает пересчёт поддеревом как раз потому, что делает элемент independent formatting context.

## Примеры

Карточка с float-картинкой и заголовком. Родитель видит float, margin заголовка не выходит наружу, текст не заходит под картинку:

```html
<article class="card">
  <img class="card__media" src="cover.jpg" width="120" height="120" alt="">
  <div class="card__body">
    <h2>Title</h2>
    <p>Long description that would otherwise wrap under the image.</p>
  </div>
</article>

<style>
  *, *::before, *::after { box-sizing: border-box; }

  .card {
    display: flow-root;      /* new BFC: contains the float, keeps h2 margin inside */
    padding: 16px;
    background: #f4f4f5;
  }
  .card__media {
    float: left;
    margin-inline-end: 16px;
  }
  .card__body {
    display: flow-root;      /* BFC next to a float: narrows instead of wrapping */
  }
  .card__body > :first-child { margin-block-start: 0; }
</style>
```

Проверка в браузере: высота `.card` — 152px (120 + 2 × 16), `.card__body` начинается на 152px от левого края (16 + 120 + 16), `h2` начинается внутри карточки.

Измерить схлопывание в консоли:

```js
// Gap between two blocks = distance between border boxes
function gap(a, b) {
  return b.getBoundingClientRect().top - a.getBoundingClientRect().bottom;
}

// Does the element contain floats (is it a BFC root)?
// Put a float taller than the element inside and see if the element grows.
function containsFloats(el) {
  const before = el.getBoundingClientRect().height;
  const probe = document.createElement('div');
  probe.style.cssText = `float: left; width: 1px; height: ${before + 50}px`;
  el.prepend(probe);
  const result = el.getBoundingClientRect().height > before;
  probe.remove();
  return result;
}
```

На блоке с `display: flow-root` или `overflow: hidden` `containsFloats` вернёт `true`, на обычном блоке и на `overflow: clip` — `false`. Задача 1 ниже решается через `gap`.

## Вопросы с интервью

::: details Чем content-box отличается от border-box и почему все ставят border-box
`box-sizing` определяет, к чему относятся `width` и `height`. При `content-box` (по умолчанию) это ширина контента, и padding с border прибавляются сверху: `width: 200px; padding: 20px; border: 5px` даёт бокс 250px. При `border-box` `width` — это внешний край border, контенту остаётся 150px. С `border-box` размер из макета равен размеру на экране, и `width: 50%` с padding не переполняет родителя. Если padding и border больше `width`, контент сжимается до нуля, а бокс получает их сумму. Margin в `width` не входит ни в одном режиме.
:::

::: details Что такое внешний и внутренний display и что значат inline-block, flow-root и contents
CSS Display 3 раскладывает `display` на два типа. Внешний — как бокс участвует в раскладке родителя: `block` (с новой строки, на всю ширину) или `inline` (в строке). Внутренний — как он раскладывает детей: `flow`, `flow-root` (flow в новом BFC), `flex`, `grid`, `table`. Отсюда `inline-block = inline flow-root`: в строке, но внутри свой BFC, поэтому работают размеры и вертикальные отступы. `flow-root = block flow-root`: обычный блок, который создаёт BFC без побочных эффектов `overflow`. `contents` убирает бокс элемента: дети занимают его место, а padding, border, фон и margin элемента пропадают. Наследование при этом идёт по DOM. Для `img`, `input` и подобных `contents` работает как `none`, а на семантических элементах исторически ломал доступность.
:::

::: details Что такое BFC, что его создаёт и какие проблемы он решает
Block formatting context — изолированная область normal flow. Его создают `display: flow-root` и `inline-block`, `overflow` кроме `visible` и `clip` (элемент становится scroll container), float, абсолютное позиционирование, flex- и grid-элементы, `contain: layout`/`paint`, multicol, ячейки таблицы. Что даёт: корень BFC растягивается до своих float (замена clearfix), не наезжает на внешние float, а сужается рядом с ними (раскладка «картинка слева, колонка текста справа» без переносов под картинку). И margin детей не схлопываются с его margin, то есть не выходят наружу. На практике выбирают `flow-root`: `overflow: hidden` тоже создаёт BFC, но обрезает тени и выпадающие меню и ломает `position: sticky` у потомков.
:::

::: details Когда схлопываются вертикальные margin и как считается результат
Схлопываются соседствующие вертикальные margin in-flow блоков одного BFC, если их не разделяют line box, padding, border или clearance. Три случая: соседние блоки, родитель с первым или последним ребёнком (у последнего — только при `height: auto` родителя) и пустой блок, у которого схлопываются собственные верхний и нижний margin. Результат: максимальный положительный плюс самый отрицательный: 30 и 20 → 30, 30 и −10 → 20, −30 и −10 → −30. Не схлопываются горизонтальные margin, margin flex- и grid-элементов, float, абсолютных и `inline-block`, корня BFC с его детьми и корневого элемента. Классический симптом — `margin-top` у заголовка внутри секции с фоном сдвигает всю секцию, а не заголовок внутри неё.
:::

::: details Почему padding-top в процентах считается от ширины
По CSS 2.2 проценты у всех padding и margin считаются от ширины containing block, точнее от его inline size. Если бы вертикальные считались от высоты, получился бы цикл: высота родителя с `auto` зависит от детей, а их отступы — от высоты родителя. Ширина известна до раскладки содержимого, поэтому основа выбрана она. В вертикальном `writing-mode` основой становится высота. Отсюда старый приём для блока с соотношением сторон: `height: 0; padding-top: 56.25%` даёт 16:9 от ширины. Сейчас вместо него `aspect-ratio`.
:::

::: details Чем width auto отличается от width 100 процентов и что такое min-content, max-content, fit-content
`width: auto` у блока в потоке — stretch-fit: ширина containing block минус свои margin, border и padding, поэтому блок никогда не вылезает. `width: 100%` — ширина containing block, к которой при `content-box` прибавятся padding и border, а margin выдавит блок за край. Внутренние размеры зависят от контента: `min-content` — по самому длинному неразрывному куску, `max-content` — без переносов, `fit-content` — max-content, но не шире доступного места и не уже min-content. Так по умолчанию измеряются float, `inline-block` и абсолютные боксы. Если сумма ширин и margin не сходится с containing block, браузер игнорирует `margin-right` в LTR, поэтому `margin: 0 auto` центрирует.
:::

::: details Чем overflow hidden отличается от overflow clip
Оба обрезают содержимое по padding box. `hidden` делает элемент scroll container: пользователь прокрутить не может, но скрипт может (`scrollTop`, `scrollIntoView`, фокус на элементе за краем). Элемент создаёт BFC, а `position: sticky` потомков привязывается к нему. Кроме того, `visible` на другой оси вычисляется в `auto`. `clip` не создаёт scroll container и BFC и не прокручивается вообще, поэтому `overflow-x: clip` не трогает вертикальную ось. Для обрезки по одной оси или без побочных эффектов на sticky выбирают `clip` (Chrome 90, Firefox 81, Safari 16).
:::

::: details Почему вертикальные отступы у span не работают, а у inline-block работают
`span` — inline-бокс, он лежит в line box. Высоту строки определяют `line-height` и `vertical-align` его содержимого и strut блока, а не его бокс. Поэтому `width` и `height` к нему не применяются, вертикальные margin игнорируются, а вертикальные padding и border рисуются, но строку не раздвигают и наезжают на соседние. `inline-block` снаружи тоже участвует в строке, но внутри он блочный контейнер с собственным BFC: строка учитывает его margin box целиком. За это он платит зазором от пробела в разметке и выравниванием по baseline: у него снизу щель под выносные элементы, а при `overflow` кроме `visible` его baseline переезжает на нижний край margin.
:::

## Задачи

### 1. Посчитайте отступы · легко

Чему равны расстояние от верха страницы до фона `.hero`, расстояние от верха фона до `h1` и зазор между `.hero` и `.next`? У `body` `margin: 0`.

```html
<section class="hero" style="margin-top: 10px; background: navy">
  <h1 style="margin: 40px 0 24px">Title</h1>
  <div style="margin-bottom: -30px"></div>
</section>
<div class="next" style="margin-top: 16px">Next</div>
```

::: details Решение и разбор
Фон `.hero` начинается на 40px от верха, `h1` — на самом верхнем краю фона (0px), зазор между фоном и `.next` — 0px. Проверено в Chromium.

- **Сверху.** У `.hero` нет padding и border, поэтому `margin-top` `h1` (40px) схлопывается с `margin-top` секции (10px). Получается 40px **снаружи** секции, фон сдвигается вместе с `h1`.
- **Снизу.** Пустой `div` без высоты схлопывает свои margin (0 и −30px) и пропускает схлопывание сквозь себя. В одну цепочку попадают `margin-bottom` `h1` (24px), −30px пустого блока, `margin-bottom` секции (0, она с `height: auto`) и `margin-top` `.next` (16px). Результат: 24 − 30 = −6px, и это общий margin снаружи секции. Раз он схлопнулся с нижним краем секции, фон кончается сразу под `h1`. `.next` стоит ещё на 6px выше и наезжает на фон.

Чтобы отступы `h1` остались внутри, секции дают `padding-block` или `display: flow-root`. С `flow-root` фон начинается на 10px, `h1` — на 40px ниже его края, а `.next` — на 16px ниже секции. Но цепочка 24px и −30px теперь схлопывается внутри, и нижний край фона проходит на 6px выше низа `h1`: отрицательный margin пустого блока лучше убрать.
:::

### 2. Найдите баг: фон карточки не обнимает картинку · легко

У карточки нет фона под картинкой, следующая карточка налезает и обтекает её. Почему и как исправить без лишней разметки?

```css
.card { background: #eee; padding: 8px; }
.card img { float: left; width: 120px; height: 120px; }
.card p { margin: 0; }
```

::: details Решение и разбор
Float вышел из потока. Высота `.card` с `height: auto` считается по in-flow содержимому, то есть по короткому абзацу. Картинка свисает ниже, а следующая карточка стоит в том же BFC, и её line box обходят float.

Исправление — сделать карточку корнем BFC:

```css
.card { display: flow-root; background: #eee; padding: 8px; }
```

Корень BFC растягивается до нижнего края своих float. Альтернативы хуже: `overflow: hidden` обрежет тень и выпадающее меню внутри карточки, clearfix через `::after` — лишний код. Если float нужен только для раскладки «картинка слева, текст справа», правильнее `display: flex` или `grid`: float там вообще не нужен.
:::

### 3. Откуда щели · средне

Галерея из `inline-block` плиток с картинками. Между плитками горизонтальные щели около 4px, под каждой картинкой — щель 5px. Ширины `calc(25% - …)` не помещаются по 4 в ряд. Объясните каждую щель и исправьте.

```html
<ul class="gallery">
  <li><img src="1.jpg" width="200" height="200" alt=""></li>
  <li><img src="2.jpg" width="200" height="200" alt=""></li>
</ul>

<style>
  .gallery li { display: inline-block; width: 25%; }
  .gallery img { width: 100%; height: auto; }
</style>
```

::: details Решение и разбор
- **Горизонтальная щель.** Перевод строки и отступы между `</li>` и `<li>` — пробельный текст. В inline formatting context он схлопывается до одного пробела, и пробел занимает место (4.45px в 16px sans-serif). Четыре `25%` плюс три пробела больше 100%, поэтому четвёртая плитка уходит на следующую строку.
- **Щель под картинкой.** `img` — inline-бокс (замещаемый) и по умолчанию стоит на **базовой линии**. Под базовой линией в line box остаётся место для выносных элементов букв (descent шрифта и strut). В Chromium плитка с картинкой 200px получила высоту 205px.

Исправления:

```css
.gallery { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.gallery img { display: block; width: 100%; height: auto; }
```

Grid игнорирует пробельный текст между элементами (он не создаёт анонимных элементов), `gap` задаёт явный зазор. `display: block` у картинки убирает её из line box. Если картинка должна остаться inline, щель убирает `vertical-align: top` или `middle`. Обнулять `font-size` у родителя ради пробелов — старый трюк, который ломает `em` у детей.
:::

### 4. Отступ «протекает» из компонента · сложно

Во Vue-приложении компонент `<PromoBanner>` с корнем `<section class="banner">` и фоном. Внутри — `<h2>` из типографических стилей (`h2 { margin-block: 2em 1em }`). Когда баннер стоит первым в `<main>`, над ним появляется полоса фона `body`. В `<aside>` с `display: flex; flex-direction: column` полосы нет, зато над заголовком внутри баннера появляется пустая полоса его собственного фона. Объясните оба поведения и предложите исправление, которое не зависит от места, где стоит компонент.

```vue
<template>
  <section class="banner">
    <h2>{{ title }}</h2>
    <slot />
  </section>
</template>

<style scoped>
.banner { background: var(--banner-bg); }
</style>
```

::: details Решение и разбор
**В `<main>`** (normal flow) у `.banner` нет padding и border, и `margin-top` первого ребёнка `h2` схлопывается с margin баннера, а через них — с margin `main`, если у того тоже нет верхних padding и border. Отступ оказывается снаружи баннера и сдвигает его фон вниз. Над баннером виден фон родителя.

**В `<aside>` с flex** баннер — flex-элемент. Его margin не схлопываются с margin соседей и родителя, а сам flex-элемент устанавливает independent formatting context для содержимого. Поэтому margin `h2` остаётся внутри баннера: над заголовком видна полоса фона баннера высотой 2em (48px при `h2` 24px). Проверено в Chromium: в `main` баннер начинается на 48px, `h2` — у его верхнего края; во flex наоборот.

Компонент ведёт себя по-разному в зависимости от родителя, а это нарушает инкапсуляцию. Исправление внутри компонента:

```css
.banner {
  display: flow-root;           /* children's margins never leave the banner */
  padding-block: 24px;
  background: var(--banner-bg);
}
.banner > :first-child { margin-block-start: 0; }
.banner > :last-child  { margin-block-end: 0; }
```

- `flow-root` делает поведение одинаковым в любом родителе: margin детей не выходят наружу ни в потоке, ни во flex.
- Внутренние отступы задаёт padding баннера, а margin первого и последнего ребёнка обнуляются: `h2` и слот из дизайн-системы не влияют на края компонента. В Safari и свежем Chrome то же делает `margin-trim: block`, но в Firefox его нет.
- Внешние отступы компонент не задаёт: расстояние между блоками — забота родителя, через `gap` во flex/grid или `* + *`.

С исправлением баннер в обоих родителях начинается с 24px до `h2`. Оговорка про scoped: атрибут компонента добавляется к последнему составному селектору, `.banner > :last-child[data-v-…]`. Последним ребёнком обычно оказывается элемент из слота, а у него атрибута компонента нет, и правило его не выберет. Нужен `:slotted(:last-child)` или правило без scoped (подробно — в теме «[Стили в компонентах](../vue/styles.md)»).
:::

## Источники

- [CSS 2.2: Box model (§8), margin collapsing (§8.3.1)](https://www.w3.org/TR/CSS22/box.html)
- [CSS 2.2: Visual formatting model (§9) и Visual formatting model details (§10)](https://www.w3.org/TR/CSS22/visuren.html)
- [CSS Box Model Module Level 3](https://drafts.csswg.org/css-box-3/)
- [CSS Display Module Level 3](https://drafts.csswg.org/css-display-3/)
- [CSS Box Sizing Module Level 3](https://drafts.csswg.org/css-sizing-3/)
- [CSS Overflow Module Level 3](https://drafts.csswg.org/css-overflow-3/)
- [CSS Containment Module Level 2](https://drafts.csswg.org/css-contain-2/)
- [MDN: Introduction to the CSS basic box model](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_box_model/Introduction_to_the_CSS_box_model)
- [MDN: Mastering margin collapsing](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_box_model/Mastering_margin_collapsing)
- [MDN: Block formatting context](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_display/Block_formatting_context)
- [MDN: display](https://developer.mozilla.org/en-US/docs/Web/CSS/display)
- [MDN: overflow](https://developer.mozilla.org/en-US/docs/Web/CSS/overflow)
- [MDN: aspect-ratio](https://developer.mozilla.org/en-US/docs/Web/CSS/aspect-ratio)
- [MDN browser-compat-data](https://github.com/mdn/browser-compat-data)
