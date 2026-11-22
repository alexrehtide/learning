---
title: 'Стили в компонентах: scoped, CSS Modules, `v-bind()` в `<style>`'
level: ядро
---

# Стили в компонентах: scoped, CSS Modules, `v-bind()` в `<style>`

> **Коротко.** `scoped` — это не изоляция, а переписывание селекторов. Компилятор добавляет атрибут `[data-v-<hash>]` к последней части каждого селектора, а рендерер ставит этот атрибут на элементы компонента. Корень дочернего компонента получает атрибуты и своего компонента, и родителя. `:deep()`, `:slotted()` и `:global()` переносят атрибут или убирают его. CSS Modules вместо атрибутов хешируют имена классов и отдают их как объект `$style`. `v-bind()` в `<style>` компилируется в `var(--hash-name)`. Значения рантайм ставит inline-стилем на корневые элементы компонента и переставляет их при каждом его обновлении.

**Связанные темы:** [Компоненты и шаблоны](./components-and-templates.md), [Слоты и provide/inject](./slots-and-provide-inject.md), [`KeepAlive`, `Teleport`, `Suspense`, `Transition` и асинхронные компоненты](./built-in-components.md), [DOM API и observers](../browser/dom.md), [Конвейер рендеринга](../browser/rendering-pipeline.md), [XSS и безопасный вывод во Vue](../security/xss.md), [Design system и UI-kit](../architecture/design-systems.md), [Масштабирование фронтенда](../architecture/scaling-frontend.md), [Производительность Vue и Nuxt](../performance/vue-performance.md), [SSR и гидрация](./ssr-and-hydration.md), [Каскад, специфичность, наследование и custom properties](../html-css/cascade.md)

## Теория

Все проверки в теме выполнены на Vue 3.5.45 в Node 26.13.1. Вывод компилятора получен через `@vue/compiler-sfc` (`compileStyle`, `compileScript`), DOM-сценарии запущены в happy-dom на `vue.esm-browser.js`, SSR — через `@vue/server-renderer`. Генерация id и CSS Modules сверены с исходниками `@vitejs/plugin-vue` 5.2.4. Механику каскада и специфичности тема не объясняет, только называет последствия: она — в теме [Каскад, специфичность, наследование и custom properties](../html-css/cascade.md).

### `scoped`: две половины механизма

`<style scoped>` работает в двух местах, и интервьюер часто проверяет, знает ли кандидат обе.

1. **Компилятор стилей** (`compileStyle`, PostCSS-плагин) переписывает селекторы и добавляет к ним атрибут `[data-v-<id>]`.
2. **Рендерер** ставит тот же атрибут на элементы. В шаблоне на клиенте атрибута нет. Компилятор SFC кладёт в компонент опцию `__scopeId: 'data-v-<id>'`, и рендерер (`setScopeId`) ставит атрибут при создании каждого элемента. В SSR-рендере атрибуты, наоборот, вшиты прямо в строки разметки.

**Откуда id.** `@vitejs/plugin-vue` берёт первые 8 hex-символов SHA-256 от пути файла относительно корня проекта. В production к пути добавляется исходник файла: `getHash(path + (isProduction ? source : ''))`. Поэтому id стабилен между сервером и клиентом одной сборки, но меняется при правке компонента в production. Опция `features.componentIdGenerator` позволяет выбрать другую схему.

Что делает компилятор, видно по его выводу (`id: 'data-v-7ba5bd90'`):

```css
/* source → @vue/compiler-sfc 3.5.45 */
.a .b {}                    /* → .a .b[data-v-7ba5bd90] */
.list li:hover::before {}   /* → .list li[data-v-7ba5bd90]:hover::before */
ul > li + li {}             /* → ul > li + li[data-v-7ba5bd90] */
h1, .t {}                   /* → h1[data-v-7ba5bd90], .t[data-v-7ba5bd90] */
@keyframes spin {}          /* → @keyframes spin-7ba5bd90 */
.r { animation: spin 1s }   /* → .r[data-v-7ba5bd90] { animation: spin-7ba5bd90 1s } */
```

Атрибут получает только **последний** составной селектор, перед псевдоклассами и псевдоэлементами. Отсюда три следствия:

- в `.a .b` предок `.a` может быть где угодно: в родителе, в `<html>`, в другом компоненте. Ограничен только `.b`. Поэтому `.dark .btn` в scoped-стилях работает без всяких `:global`;
- документация Vue предупреждает о **рекурсивных компонентах**: правило `.a .b` применится ко всем `.b` во вложенных экземплярах того же компонента, ведь у них тот же id;
- селектор по тегу (`p {}` → `p[data-v-…]`) документация называет во много раз более медленным, чем класс. Scoped не отменяет классы.

Имена `@keyframes` тоже получают суффикс, и ссылки на них в `animation` переписываются. Поэтому анимация из scoped-стилей не конфликтует с одноимённой глобальной.

### Какие элементы получают атрибут

Проверено в happy-dom: родитель `P`, scoped-дети `Child`, `Slotted`, `Multi` (два корня) и `NoScope` без стилей:

```html
<main data-v-P>
  <div data-v-Child data-v-P class="child">            <!-- child root: both ids -->
    <span data-v-Child>c</span>                          <!-- child internals: only its own -->
    <em data-v-P data-v-Child-s>slot</em>              <!-- slot content: parent id + `-s` -->
  </div>
  <div data-v-P class="ns"><b>n</b></div>              <!-- unscoped child: root gets P -->
  <i data-v-Multi>1</i><i data-v-Multi>2</i>         <!-- fragment root: no P -->
  <div data-v-P><p>raw</p></div>                      <!-- v-html content: nothing -->
</main>
<aside data-v-P class="tp">t</aside>                    <!-- teleported: keeps P -->
```

- **Корень ребёнка получает id родителя** намеренно: так родитель управляет раскладкой ребёнка (`margin`, `grid-area`). Если корень ребёнка — снова компонент, id передаются по цепочке. Проверено: кнопка в корне `Mid` в корне `Top` получила три атрибута. `inheritAttrs: false` это не отключает, ведь scope id — не fallthrough-атрибут.
- **У компонента с несколькими корнями** id родителя нет ни на одном корне. Стиль родителя `.p > i` до него не достанет.
- **Содержимое слота** принадлежит родителю: этот компонент его рендерит, а слот лишь вызывается внутри ребёнка ([«Слоты и provide/inject»](./slots-and-provide-inject.md)). Поэтому на нём id родителя. Маркер `<id ребёнка>-s` ставится всегда, а использует его только `:slotted()`.
- **`v-html`** вставляет `innerHTML` мимо рендерера, и атрибутов на этой разметке нет.

### `:deep()`, `:slotted()`, `:global()`

```css
.a :deep(.child) {}     /* → .a[data-v-x] .child      attribute moves to the left part */
:deep(.child) {}        /* → [data-v-x] .child        any element of this component as ancestor */
:slotted(.s) {}         /* → .s[data-v-x-s]           slot content inside this component */
:global(.g) {}          /* → .g                       no attribute at all */
:global(.dark) .btn {}  /* → .dark                    the rest of the selector is dropped! */
```

- **`:deep()`** ставит атрибут на часть **слева** и снимает ограничение справа. Так родитель стилизует внутренности ребёнка или разметку `v-html`. Старые формы `::v-deep`, `>>>` и `/deep/` компилируются так же, но дают предупреждение «deprecated. Use :deep()».
- **`:slotted()`** по умолчанию нужен потому, что содержимое слота несёт id родителя, а не ребёнка. Правило ребёнка `.s {}` до него не дотянется.
- **`:global()`** заменяет **весь** селектор своим аргументом. Проверено: `:global(.dark) .btn` и `.p :global(.g)` превращаются в `.dark` и `.g`. Это молчаливый баг: правило применится к самому `<html class="dark">`. Для темы пишут просто `.dark .btn`.

### Ограничения scoped

- **Это не изоляция.** Глобальные стили проникают внутрь, а scoped-стили родителя — на корень ребёнка. Настоящую изоляцию даёт только Shadow DOM, во Vue — через `defineCustomElement` ([сравнение в «DOM API»](../browser/dom.md)).
- **Специфичность растёт** на один атрибутный селектор: `.btn[data-v-x]` сильнее глобального `.btn` из UI-kit. Чтобы переопределить scoped-стиль библиотеки, приходится усиливать селектор. Стили родителя и ребёнка для корня ребёнка равны по специфичности, и выигрывает тот, кто подключён позже, а порядок задаёт сборщик.
- **`v-html` и чужой DOM** без атрибутов: разметка из Markdown, `innerHTML` в директиве, виджеты сторонних библиотек. Решение — `:deep()` от своего элемента-обёртки.
- **Teleport.** Атрибуты на телепортированных элементах сохраняются: scoped-класс `.modal` работает и в `body`. Не работают селекторы с предком по DOM: `.page .modal` после переноса не совпадёт ([«Встроенные компоненты»](./built-in-components.md)).
- **Несколько корней** у ребёнка — родитель не стилизует его корни без `:deep()`.

### CSS Modules

`<style module>` компилируется как CSS Modules: классы получают хешированные имена, а компонент — объект соответствий.

```css
/* <style module> → compileStyleAsync({ modules: true }) */
.red {}        /* → ._red_10q32_2 */
.big-title {}  /* → ._big-title_10q32_3     map: { red: '_red_10q32_2', 'big-title': '_big-title_10q32_3' } */
```

Как объект попадает в шаблон. `@vitejs/plugin-vue` импортирует блок как `*.module.css`. Хеширует Vite (формат имён задаётся `css.modules.generateScopedName`), а плагин кладёт объекты в опцию компонента `__cssModules: { $style: {...} }`. Публичный прокси экземпляра отдаёт `$style` из `type.__cssModules`, поэтому шаблон компилируется в обычный `_ctx.$style.red`. В `<script setup>` то же даёт `useCssModule()`, а для `<style module="classes">` — `useCssModule('classes')`. В режиме custom elements `<style module>` не поддерживается: плагин падает с ошибкой.

Чем модули отличаются от scoped:

| | `scoped` | `module` |
| --- | --- | --- |
| Механизм | атрибут на элементе + переписанный селектор | уникальное имя класса |
| Специфичность | +1 атрибут | как написано |
| Корень ребёнка | получает стили родителя автоматически | только если класс передан явно (`:class="$style.x"`) |
| Стилизовать ребёнка | `:deep()` | передать класс через prop или `class` |
| Классы в JS | нет | `$style`/`useCssModule`: можно отдать в `h()`, сторонний виджет, `classList` |

Модули удобнее, когда класс нужен в коде: рендер-функции, интеграция со сторонней библиотекой, класс, который передают в другой компонент. Они не трогают специфичность, и их проще переопределять снаружи. Scoped короче в шаблоне и стилизует корень ребёнка без договорённостей. Их можно смешивать: `<style scoped>` и `<style module>` в одном SFC.

### `v-bind()` в `<style>`

```vue
<script setup>
import { ref } from 'vue'

const color = ref('red')
const theme = { size: '12px' }
</script>

<style scoped>
.box { color: v-bind(color); font-size: v-bind('theme.size') }  /* expressions need quotes */
</style>
```

**Что генерирует компилятор.** Стили остаются статическими: `v-bind(color)` превращается в `var(--abc12345-color)`, а в production — в короткий хеш (`var(--v70215e88)`). В `setup` компилятор добавляет вызов `useCssVars`:

```js
// @vue/compiler-sfc 3.5.45, compileScript output (dev)
_useCssVars(_ctx => ({
  "abc12345-color": (color.value),
  "abc12345-theme\.size": (theme.size)
}))
```

**Что делает рантайм** (`runtime-dom/src/helpers/useCssVars.ts`):

- `setVars` вычисляет геттер и ставит `style.setProperty('--…', value)` на **корневые** элементы компонента: на корень, на каждый корень фрагмента, на хост custom element. Потомки получают значения через наследование custom properties;
- телепортированные элементы получают атрибут `data-v-owner="<uid>"`, и `setVars` находит их через `querySelectorAll`. Проверено: переменные стоят на `<p>` в `body`;
- запускается `setVars` из трёх мест: `watch(setVars, NOOP, { flush: 'post' })` (значение изменилось), `onBeforeUpdate` → post-очередь (при **каждом** обновлении компонента) и `MutationObserver` на родителе корня (корни заменились через `v-if`).

**Цена.** При каждом рендере компонента рантайм заново ставит все переменные на все корни, даже если они не менялись. Проверено подменой `setProperty`: обновление `n++`, не связанное со стилями, дало столько же вызовов, сколько монтирование. Смена переменной на корне заставляет браузер пересчитать стили всех элементов, которые её наследуют ([«Конвейер рендеринга»](../browser/rendering-pipeline.md)). Для темы, размеров и состояний это ничтожно. Для значений, которые меняются каждый кадр (координаты курсора, прогресс прокрутки), лучше `:style` на конкретном элементе или `transform`.

**SSR.** На сервере `useCssVars` пустой. SSR-компилятор сам добавляет переменные в атрибуты корня: `_cssVars = { style: { ':--abc12345-color': $setup.color } }` объединяется с `_attrs`. Проверено, HTML: `<div class="box" style="--f1aac64d-color:red;--f1aac64d-theme\.size:12px;" data-v-f1aac64d>`. Значения есть в разметке до гидрации, поэтому мигания нет. Dev-проверка расхождений при гидрации учитывает эти переменные при сравнении `style`.

> [!TIP]
> `v-bind()` работает и в обычном `<style>`, без `scoped`: переменные всё равно ставятся на корни компонента, но правило глобальное. Значение, нужное многим компонентам, — это токен design system, и его место — custom property на `:root` или `[data-theme]`, а не `v-bind()` в каждом компоненте ([«Design system и UI-kit»](../architecture/design-systems.md)).

### Архитектурный выбор

Scoped и модули — не единственные варианты. На интервью ждут не «что лучше», а критерии:

- **Scoped / CSS Modules** — CSS остаётся статическим файлом, который кэшируется и грузится параллельно. Изоляция по компоненту. Динамика — через классы, `:style` и custom properties.
- **Utility-first CSS** (Tailwind, UnoCSS) — классы прямо в шаблоне, итоговый CSS почти не растёт с числом компонентов, токены зашиты в конфиг. Цена — длинные списки классов и варианты, вынесенные в JS (Tailwind Variants). Так устроен Nuxt UI ([«Design system и UI-kit»](../architecture/design-systems.md)).
- **CSS-in-JS** — runtime-библиотеки генерируют стили в JS во время рендера и вставляют их в документ. Это гибко, но стоит времени на каждом рендере и требует отдельной сборки стилей при SSR. Zero-runtime варианты извлекают статический CSS при сборке. Во Vue-экосистеме CSS-in-JS редкость: SFC уже решает изоляцию, а динамику дают custom properties.
- **Микрофронтенды** добавляют требование изоляции между приложениями: префиксы, модули, `@layer` или Shadow DOM ([«Масштабирование фронтенда»](../architecture/scaling-frontend.md)).

> [!NOTE]
> Во Vue 3.6 (RC, `3.6.0-rc.16`, сверено 2026-11-21) трансформация селекторов не меняется: вывод `compileStyle` для всех селекторов темы совпал с 3.5.45. В Vapor-компонентах (`<script setup vapor>`) атрибут `data-v-…` вшит прямо в строку шаблона (`_template("<div data-v-abc12345>x")`). Вместо `useCssVars` вызывается `useVaporCssVars`, а `$style` превращается в локальную константу `useCssModule("$style")`. Стабильного 3.6 пока нет.

## Примеры

### Компонент со всеми тремя механизмами

```vue
<script setup lang="ts">
import { computed, useCssModule } from 'vue'

const props = defineProps<{ progress: number; tone: 'info' | 'danger'; html: string }>()
const tones = useCssModule('s')
const width = computed(() => `${Math.round(props.progress * 100)}%`)
</script>

<template>
  <section class="card" :class="tones[props.tone]">
    <div class="bar" />
    <!-- markdown from the server: sanitized, see the XSS topic -->
    <div class="body" v-html="props.html" />
    <slot name="footer" />
  </section>
</template>

<style scoped>
.card { padding: 16px; }
.bar { width: v-bind(width); height: 4px; background: currentColor; }
.body :deep(a) { text-decoration: underline; }     /* v-html content */
:slotted(button) { margin-inline-start: auto; }    /* parent's buttons in the slot */
.dark .card { background: #111; }                  /* ancestor class, no :global needed */
</style>

<style module="s">
.info { color: royalblue; }
.danger { color: crimson; }
</style>
```

`v-bind(width)` ставит `--<id>-width` на `<section>`, и `.bar` наследует его. `:deep(a)` нужен, потому что ссылки из `v-html` без атрибутов. Модуль `s` даёт классы тона без повышения специфичности, их легко переопределить снаружи. Почему `v-html` с данными сервера требует санитайзинга — в [«XSS»](../security/xss.md).

## Вопросы с интервью

::: details Как работает scoped CSS во Vue
Две половины. Компилятор стилей (PostCSS-плагин в `@vue/compiler-sfc`) добавляет атрибут `[data-v-<id>]` к последнему составному селектору каждого правила, перед псевдоклассами: `.a .b:hover` → `.a .b[data-v-x]:hover`. Имена `@keyframes` получают суффикс id. Рендерер ставит тот же атрибут на каждый элемент компонента по опции `__scopeId`, а SSR-компилятор вшивает его в разметку. Id в Vite — 8 символов SHA-256 от пути файла (в production — вместе с исходником). Ограничена только правая часть селектора: предок `.a` может быть где угодно, в том числе во вложенных экземплярах рекурсивного компонента.
:::

::: details Почему стили родителя действуют на корень дочернего компонента и как стилизовать его внутренности
Рендерер ставит на корневой элемент ребёнка и его id, и id родителя. Это сделано намеренно, чтобы родитель управлял раскладкой ребёнка. По цепочке корней id передаются дальше, а `inheritAttrs: false` на это не влияет. У ребёнка с несколькими корнями id родителя нет нигде. Внутренности ребёнка несут только его id, и до них достаёт `:deep()`: `.wrap :deep(.title)` → `.wrap[data-v-parent] .title`. Это связь с внутренней разметкой ребёнка, то есть хрупкий контракт. Лучше дать ребёнку prop, класс или custom property.
:::

::: details Почему scoped-стили не применяются к содержимому v-html и что не так со слотами
`v-html` записывает `innerHTML` мимо рендерера, и атрибутов на этой разметке нет. Стилизуют её через `:deep()` от элемента-обёртки. Содержимое слота рендерит родитель, поэтому на нём id родителя, и стили родителя к нему применяются. Ребёнок же своим `.item {}` его не достанет. Для этого `:slotted(.item)` → `.item[data-v-child-s]`, а маркер `-s` рендерер ставит на всё содержимое слотов.
:::

::: details Чем CSS Modules отличаются от scoped и когда что выбрать
Scoped изолирует атрибутом и переписанным селектором, модули — уникальным именем класса. Модули не повышают специфичность, отдают классы в JS (`$style`, `useCssModule`) и не стилизуют корень ребёнка сами: класс нужно передать явно. Scoped короче в шаблоне, сам стилизует корень ребёнка, для внутренностей есть `:deep()`. Модули выбирают, когда класс нужен в коде (рендер-функции, сторонние виджеты, передача класса в другой компонент) и когда стили библиотеки должны легко переопределяться. В одном SFC можно использовать оба.
:::

::: details Как работает v-bind в style и сколько он стоит
CSS остаётся статическим: `v-bind(color)` превращается в `var(--<id>-color)`, а в `setup` добавляется `useCssVars(_ctx => ({ '<id>-color': color.value }))`. Выражения нужно брать в кавычки. Рантайм ставит переменные inline-стилем на корневые элементы компонента и на его телепорты (через `data-v-owner`), а потомки их наследуют. Пересчёт идёт через post-watcher, на каждом `onBeforeUpdate` и по `MutationObserver`, когда меняются корни. Значит, на каждом рендере компонента все переменные ставятся заново, и смена переменной вызывает пересчёт стилей поддерева. На сервере переменные попадают в атрибут `style` корня, поэтому мигания нет.
:::

::: details Scoped CSS изолирует компонент так же, как Shadow DOM
Нет. Это соглашение об атрибутах, а не отдельное дерево. Глобальные стили проникают внутрь, стили родителя попадают на корень ребёнка, `querySelector` снаружи находит элементы, а `.dark .btn` зависит от любого предка. Специфичность scoped-правил на атрибут выше, и это мешает переопределять стили библиотек. Настоящая изоляция есть только в Shadow DOM: во Vue это `defineCustomElement`, где стили встраиваются в shadow root, а `<style module>` не поддерживается.
:::

::: details Что будет со scoped-стилями и v-bind при SSR и гидрации
SSR-компилятор вшивает `data-v-<id>` в строки разметки, а переменные `v-bind()` объединяет с атрибутами корня: `style="--id-color:red"`. HTML приходит уже со стилями, а dev-проверка гидрации сверяет `style` с учётом этих переменных. Id должен совпадать на сервере и клиенте. Это так, пока оба бандла собраны из одних исходников одним плагином: id зависит от пути, а в production и от содержимого файла.
:::

## Задачи

### 1. Что получит DOM · средне

`Leaf` и `Mid` — scoped-компоненты, у `Leaf` `inheritAttrs: false`. Какие `data-v-*` будут на каждой кнопке и будет ли на первой класс `extra`?

```vue
<!-- Leaf.vue -->   <template><button class="leaf">b</button></template>
<!-- Mid.vue -->    <template><Leaf /></template>
<!-- Top.vue -->    <template><div><Mid class="extra" /><Leaf /></div></template>
```

::: details Решение и разбор
```html
<div data-v-Top>
  <button data-v-Leaf data-v-Mid data-v-Top class="leaf">b</button>
  <button data-v-Leaf data-v-Top class="leaf">b</button>
</div>
```

Проверено в happy-dom. Первая кнопка — корень `Leaf`, который корень `Mid`, который ребёнок `Top`. Рендерер идёт вверх, пока элемент остаётся корнем, и ставит все id. Класса `extra` нет: `Mid` передал его `Leaf` как fallthrough-атрибут, а `Leaf` с `inheritAttrs: false` его не принял. Scope id — не атрибут из `$attrs`, и `inheritAttrs` на него не влияет. Поэтому стили `Top` вида `.leaf {}` применятся к обеим кнопкам, хотя первая лежит на два компонента глубже.
:::

### 2. Найдите баг · легко

Тёмная тема переключается классом `dark` на `<html>`. Кнопки не меняют цвет, зато фон всей страницы стал `#222`.

```css
/* Button.vue, <style scoped> */
:global(.dark) .btn { background: #222; color: #eee; }
```

::: details Решение и разбор
`:global()` заменяет весь селектор своим аргументом. Проверено: `:global(.dark) .btn` компилируется в `.dark { … }`, и правило применяется к самому `<html>`. Исправление проще, чем кажется:

```css
.dark .btn { background: #222; color: #eee; }  /* → .dark .btn[data-v-x] */
```

Атрибут получает только последняя часть селектора, поэтому предок `.dark` может находиться где угодно. Ещё лучше не дублировать правила под тему, а читать токены: `.btn { background: var(--color-bg-button) }`, а `[data-theme="dark"]` переопределяет переменные ([«Design system и UI-kit»](../architecture/design-systems.md)).
:::

### 3. Найдите баг · легко

Статья приходит с сервера как санитайзенный HTML. Ссылки и заголовки в ней без стилей, хотя в компоненте они описаны.

```vue
<template><article class="post" v-html="html" /></template>
<style scoped>
.post h2 { margin-top: 2em; }
.post a { color: royalblue; }
</style>
```

::: details Решение и разбор
`.post h2` компилируется в `.post h2[data-v-x]`, а у разметки из `v-html` атрибута нет: её вставляет `innerHTML`, а не рендерер. Атрибут надо перенести на обёртку:

```css
.post :deep(h2) { margin-top: 2em; }   /* → .post[data-v-x] h2 */
.post :deep(a) { color: royalblue; }
```

Альтернатива — отдельный не-scoped `<style>` с префиксом `.post`. То же касается разметки, которую создают сторонние библиотеки (редактор, график) и директивы через `innerHTML`.
:::

### 4. Найдите баг · средне

Подсветка следует за курсором по большой таблице, и на слабых машинах интерфейс дёргается.

```vue
<script setup>
import { ref } from 'vue'

const x = ref(0), y = ref(0)
const onMove = (e) => { x.value = e.clientX; y.value = e.clientY }
</script>
<template>
  <div class="grid" @pointermove="onMove">
    <div class="spot" />
    <Row v-for="r in rows" :key="r.id" :row="r" />
  </div>
</template>
<style scoped>
.spot { transform: translate(v-bind('x + "px"'), v-bind('y + "px"')); }
</style>
```

::: details Решение и разбор
`v-bind()` ставит переменные на **корень** компонента, то есть на `.grid` со всей таблицей. Каждое событие меняет две custom properties на корне, и браузер пересчитывает стили всего поддерева, которое их наследует. Кроме того, `useCssVars` переставляет переменные при каждом обновлении компонента. Значение нужно одному элементу, поэтому пишем его прямо в этот элемент:

```vue
<div class="spot" :style="{ transform: `translate(${x}px, ${y}px)` }" />
```

Ещё лучше не трогать реактивность на каждом событии: `ref` на элемент и `el.style.transform` внутри `requestAnimationFrame`. `transform` не вызывает layout ([«Конвейер рендеринга»](../browser/rendering-pipeline.md)). `v-bind()` хорош для редко меняющихся значений: темы, размера, состояния.
:::

### 5. Реализуйте трансформацию scoped-селектора · сложно

Напишите `scopeSelector(selector, id)`, который делает то же, что Vue: атрибут на последнем составном селекторе перед псевдоклассами, список через запятую, `:deep()`, `:slotted()`, `:global()`. Скобки и строки внутри `:not(...)` и `[href^="…"]` не должны ломать разбор.

::: details Решение и разбор
```js
// split at depth 0: outside (), [] and quotes
function splitTop(s, isSep) {
  const parts = []; let depth = 0, quote = null, cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote) { cur += ch; if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    const sep = depth === 0 && isSep(s, i)
    if (sep) { parts.push(cur, sep.token); cur = ''; i += sep.len - 1 } else cur += ch
  }
  parts.push(cur)
  return parts
}

function pseudoArg(compound, name) {
  const i = compound.indexOf(`:${name}(`)
  if (i === -1) return null
  for (let j = i + name.length + 1, depth = 0; j < compound.length; j++) {
    if (compound[j] === '(') depth++
    else if (compound[j] === ')' && --depth === 0) {
      return { before: compound.slice(0, i), arg: compound.slice(i + name.length + 2, j), after: compound.slice(j + 1) }
    }
  }
  return null
}

// `li:hover::before` -> `li[attr]:hover::before`
function withAttr(compound, attr) {
  const [head, ...rest] = splitTop(compound, (s, i) => s[i] === ':' && { token: ':', len: 1 })
  return `${head}[${attr}]${rest.join('')}`
}

const isComb = (s, i) => {
  const m = /^\s*([>+~])\s*|^\s+/.exec(s.slice(i))
  return m && { token: m[1] ? ` ${m[1]} ` : ' ', len: m[0].length }
}

function scopeOne(sel, id) {
  const global = pseudoArg(sel, 'global')
  if (global) return global.arg // like Vue: replaces the whole selector

  const t = splitTop(sel, isComb) // [compound, combinator, compound, ...]
  for (let i = 0; i < t.length; i += 2) {
    const deep = pseudoArg(t[i], 'deep')
    if (!deep) continue
    const left = deep.before ? t.slice(0, i).join('') + withAttr(deep.before, id)
      : i === 0 ? `[${id}]`
      : t.slice(0, i - 2).join('') + withAttr(t[i - 2], id) + t[i - 1].trimEnd() // `.a :deep(.b)`
    return `${left} ${[deep.arg + deep.after, ...t.slice(i + 1)].join('')}`.trim()
  }
  const last = t.length - 1
  const slotted = pseudoArg(t[last], 'slotted')
  t[last] = slotted ? withAttr(slotted.arg, `${id}-s`) + slotted.after : withAttr(t[last], id)
  return t.join('')
}

export const scopeSelector = (selector, id) =>
  splitTop(selector, (s, i) => s[i] === ',' && { token: ',', len: 1 })
    .filter((p) => p !== ',')
    .map((s) => scopeOne(s.trim(), id))
    .join(', ')
```

Проверено сравнением с `compileStyle` из `@vue/compiler-sfc` 3.5.45 на 21 селекторе (с точностью до пробелов), в том числе `.a > :deep(.b)`, `.p:hover :deep(.c)`, `.btn:not(.x, .y)`, `a[href^="http:"]`, `:global(.dark) .a`.

- Атрибут вставляется перед первым двоеточием верхнего уровня, поэтому `:hover` и `::before` остаются справа, а `:not(.a:b)` не разрезается.
- `.a :deep(.b)` переносит атрибут на **предыдущий** составной селектор и убирает пробел, как Vue: `.a[data-v-x] .b`.
- Чего нет по сравнению с Vue: `@keyframes` и переписывания `animation`, вложенных правил и `@media` (их обходит PostCSS), `::v-deep` и `>>>`, пропуска `:root`, `*` и `html`/`body` в разных позициях.

Сложность: O(n) по длине селектора.
:::

## Источники

- [Vue.js: SFC CSS Features (scoped, `:deep`, `:slotted`, `:global`, CSS Modules, `v-bind()`)](https://vuejs.org/api/sfc-css-features.html)
- [Vue.js: Vue and Web Components](https://vuejs.org/guide/extras/web-components.html)
- [Исходники Vue 3.5.45: `compiler-sfc/src/style/pluginScoped.ts`, `cssVars.ts`](https://github.com/vuejs/core/tree/v3.5.45/packages/compiler-sfc/src)
- [Исходники Vue 3.5.45: `runtime-dom/src/helpers/useCssVars.ts`, `useCssModule.ts`](https://github.com/vuejs/core/tree/v3.5.45/packages/runtime-dom/src/helpers)
- [Исходники `@vitejs/plugin-vue`: генерация id и CSS Modules](https://github.com/vitejs/vite-plugin-vue/tree/main/packages/plugin-vue/src)
- [Vite: CSS Modules и `css.modules`](https://vite.dev/guide/features.html#css-modules)
- [CSS Modules (спецификация проекта)](https://github.com/css-modules/css-modules)
- [`vuejs/core` CHANGELOG.md, ветка `minor` (3.6)](https://github.com/vuejs/core/blob/minor/CHANGELOG.md)
