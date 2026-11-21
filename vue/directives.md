---
title: Директивы, в том числе пользовательские
level: ядро
---

# Директивы, в том числе пользовательские

> **Коротко.** Встроенная директива — подсказка компилятору. `v-if` становится тернарным оператором с отдельным блоком, `v-for` — вызовом `renderList` с фрагментом, `v-html` — свойством `innerHTML`. Только `v-show`, `v-model` и пользовательские директивы доходят до рантайма как объекты с хуками и вызываются через `withDirectives`. Пользовательская директива — это хуки жизненного цикла **элемента** для низкоуровневой работы с DOM. Логику с состоянием выносят в composable, а разметку — в компонент.

**Связанные темы:** [Компоненты и шаблоны](./components-and-templates.md), [Жизненный цикл](./lifecycle.md), [Производительность Vue и Nuxt](../performance/vue-performance.md), [Механизм рендеринга: VDOM и компиляторные оптимизации](./rendering-mechanism.md), [XSS и безопасный вывод во Vue](../security/xss.md), [События](../browser/events.md), [Утечки памяти](../performance/memory-leaks.md), [UI-coding: базовые компоненты на Vue](../live-coding/ui-components.md)

## Теория

Все проверки в теме выполнены на Vue 3.5.45. Вывод компилятора получен через `@vue/compiler-sfc` в production-режиме, поведение проверено запуском `vue` и `@vue/server-renderer` в Node 26.13.1 с DOM из happy-dom. Врезки про 3.6 сверены с `vue@3.6.0-rc.15`.

### Что компилятор делает с директивами

Директива — атрибут с префиксом `v-`: `v-name:arg.mod1.mod2="expr"`. Аргумент бывает динамическим (`v-bind:[key]`), модификаторы собираются в объект `{ mod1: true, mod2: true }`. Дальше пути расходятся. Одни директивы компилятор **растворяет** в коде render-функции, другие передаёт рантайму как объекты:

| В шаблоне | В render-функции |
| --- | --- |
| `v-if` / `v-else` | тернарный оператор, у каждой ветки свой `openBlock()` и `key: 0`, `key: 1` |
| `v-for` | `_renderList(items, it => …)` внутри `Fragment` с флагом `KEYED_FRAGMENT` или `UNKEYED_FRAGMENT` |
| `v-html` / `v-text` | DOM-свойство `innerHTML` / `textContent` |
| `v-once` | `_cache[n]` и `setBlockTracking(-1)` |
| `v-pre` | статический текст: `"{{ raw }}"` не компилируется |
| `v-cloak` | исчезает из vnode |
| `v-show`, `v-model`, `v-focus` | `_withDirectives(vnode, [[dir, value, arg, modifiers]])` |

Для шаблона с `v-show`, `v-model.trim` и пользовательской директивой получается (сокращено):

```js
_withDirectives(_createElementVNode("p", null, "show", 512 /* NEED_PATCH */), [
  [_vShow, ok.value]
]),
_withDirectives(_createElementVNode("input", {
  "onUpdate:modelValue": _cache[0] || (_cache[0] = $event => ((msg).value = $event))
}, null, 512 /* NEED_PATCH */), [
  [_vModelText, msg.value, void 0, { trim: true }]
]),
_withDirectives(_createElementVNode("input", null, null, 512 /* NEED_PATCH */), [
  [vFocus, msg.value, "top", { once: true }]   // <input v-focus:top.once="msg">
])
```

Флаг `NEED_PATCH` нужен, чтобы элемент со статическими атрибутами попал в `dynamicChildren` блока: иначе рантайм не вызвал бы для него хуки при обновлении. `vShow` и `vModelText` — обычные объекты-директивы из `runtime-dom`, устроенные так же, как ваши.

`withDirectives` складывает привязки в `vnode.dirs`. Директива-функция превращается в `{ mounted: fn, updated: fn }`, а с опцией `deep: true` значение обходится глубоко (`traverse`), чтобы рендер подписался на вложенные поля. Рантайм вызывает хуки из `dirs` в тех же точках, где монтирует, обновляет и удаляет элемент.

### `v-if` против `v-show`

`v-if` — структурная директива: ветка с ложным условием не создаётся вообще (на её месте комментарий `<!--v-if-->`). Переключение монтирует и размонтирует поддерево целиком: дочерние компоненты проходят `mounted`/`unmounted`, их состояние теряется. `v-show` рендерит элемент всегда и переключает `style.display`. Исходное значение `display` он запоминает при `beforeMount` и возвращает при показе.

Отсюда правило из гайда: у `v-if` выше **стоимость переключения**, у `v-show` — стоимость **первого рендера**. `v-if` ленивый: тяжёлая скрытая панель не стоит ничего, пока её не открыли. `v-show` подходит для частых переключений и для случаев, когда элемент обязан быть в DOM: на него ссылается `aria-controls`, внутри форма с несохранённым вводом (см. [аккордеон и вкладки](../live-coding/ui-components.md)). `v-show` не работает на `<template>` и не имеет `v-else`.

Компилятор сам ставит веткам `v-if` разные ключи (`key: 0`, `key: 1`). Поэтому `<input v-if="a">` и `<input v-else>` — разные элементы, и введённый текст не «перетекает» из одной ветки в другую. Во Vue 2 для этого приходилось писать `key` вручную.

### `v-for` и `key`

Без `key` компилятор ставит фрагменту флаг `UNKEYED_FRAGMENT`, и рантайм сравнивает списки **по позиции**: i-й старый vnode патчится i-м новым. С `key` (флаг `KEYED_FRAGMENT`) рантайм сопоставляет узлы по идентичности: синхронизирует общие начало и конец, остальное ищет по ключу, а перемещения минимизирует через наибольшую возрастающую подпоследовательность. Алгоритм по шагам — в [«Механизме рендеринга»](./rendering-mechanism.md#списки-с-key-алгоритм).

`key` — это ответ на вопрос «какой элемент чей». Индекс на него не отвечает: после удаления первого элемента индекс `0` достаётся бывшему второму. Рантайм видит тот же ключ, патчит существующий узел новыми props и **оставляет ему старое состояние**. Проверено: в списке строк A, B, C с `<input v-model="note">` в каждой строке после `items.shift()` с `:key="i"` получилось `B:note-A | C:note-B`. С `:key="it.id"` — `B:note-B | C:note-C`. Ломается всё, что живёт вне props: локальный `ref`, значение и фокус `<input>`, состояние анимации, `KeepAlive`. Индекс безопасен только для статического списка без состояния.

Ключ должен быть примитивом (строка или число), уникальным среди соседей и стабильным между рендерами. `Math.random()` в ключе пересоздаёт все элементы на каждом рендере. С `<template v-for>` ключ во Vue 3 ставится на сам `<template>`.

### `v-if` и `v-for` на одном элементе

Во Vue 3 у `v-if` приоритет **выше**, чем у `v-for`. Компилятор выносит условие наружу:

```js
// <li v-for="it in items" v-if="it.done" :key="it.id">
(_ctx.it.done)
  ? (_openBlock(true), _createElementBlock(_Fragment, { key: 0 }, _renderList(items.value, (it) => …)))
  : _createCommentVNode("v-if", true)
```

`it` здесь ещё не объявлен, поэтому компилятор ищет его на экземпляре (`_ctx.it`). Запуск даёт предупреждение `Property "it" was accessed during render but is not defined on instance` и `TypeError: Cannot read properties of undefined (reading 'done')`. Во Vue 2 приоритет был обратным: код работал, но условие проверялось на каждом элементе при каждом рендере. Поэтому их не ставят вместе: фильтр — в `computed`, условие на весь список — на обёртку `<template v-if>`. Правило ESLint `vue/no-use-v-if-with-v-for` ловит это заранее.

### `v-model` на нативных элементах

Компилятор выбирает директиву по элементу: `vModelText` для `<input>` и `<textarea>`, `vModelCheckbox`, `vModelRadio`, `vModelSelect`. Если `type` динамический (`:type="t"`), выбор откладывается до рантайма: `vModelDynamic`. Запись значения — обычный обработчик `onUpdate:modelValue` в кэше. Чтение и обновление DOM делает директива:

- **`created`** вешает слушатель `input` (с `.lazy` — `change`) и `compositionstart`/`compositionend`. Пока идёт ввод через IME (китайский, японский), `el.composing === true`, и модель не обновляется на каждом промежуточном символе.
- **`mounted`** пишет значение в `el.value`. Это сделано не в `beforeMount`, чтобы у `type="range"` к этому моменту уже стояли `min`/`max`.
- **`beforeUpdate`** не перезаписывает поле, если значение совпадает с текущим. Если поле в фокусе, с `.trim` оно не теряет пробелы, которые пользователь только что набрал, а с `.lazy` не перезаписывается до `change`.

Модификаторы: `.lazy` синхронизирует по `change`, `.trim` обрезает пробелы, `.number` приводит через `parseFloat`. Если результат `NaN`, модель получает исходную строку: проверено, `'42'` стало `42`, а `'abc'` осталось `'abc'`. Для `type="number"` приведение включается само. `<select multiple>` и группа чекбоксов с массивом работают с массивом значений, а `true-value`/`false-value` задают значения чекбокса. `v-model` на компоненте — это props и emits, без директивы ([подробнее](./props-emits-v-model.md)). Что это значит для форм (IME, пустое числовое поле, ввод до гидрации, валидация) — в теме [«Формы и валидация»](./forms-and-validation.md).

### `v-once`, `v-memo`, `v-pre`, `v-cloak`, `v-html`

- **`v-once`** кэширует поддерево в `_cache` и выключает для него трекинг блока. **`v-memo="[deps]"`** пропускает рендер поддерева, пока зависимости равны. Модель стоимости и ловушки — в [«Производительности Vue и Nuxt»](../performance/vue-performance.md#v-once-и-v-memo).
- **`v-pre`** выключает компиляцию поддерева: <code v-pre>{{ raw }}</code> выводится как текст. Пригодится, чтобы показать синтаксис шаблона в документации. Сама эта страница собрана VitePress как шаблон Vue и пользуется тем же приёмом.
- **`v-cloak`** нужен только без сборки, когда шаблон лежит прямо в HTML страницы. До монтирования браузер показывает сырые <code v-pre>{{ msg }}</code>. Правило `[v-cloak] { display: none }` прячет их, а Vue снимает атрибут при монтировании. В SFC шаблон скомпилирован заранее, и компилятор просто выбрасывает `v-cloak`.
- **`v-html`** компилируется в `innerHTML`. Содержимое не компилируется как шаблон, `scoped`-стили на него не действуют, а пользовательская строка в нём — XSS. Разбор — в [«XSS и безопасном выводе во Vue»](../security/xss.md#где-vue-не-защищает).

### Пользовательские директивы: хуки и `binding`

Директива — объект с необязательными хуками. Они привязаны к жизненному циклу **элемента**, а `beforeUpdate`/`updated`/`unmounted` — к компоненту-владельцу шаблона:

```js
const vExample = {
  created(el, binding, vnode) {},      // before attributes and listeners are applied
  beforeMount(el, binding, vnode) {},  // before insertion into the DOM
  mounted(el, binding, vnode) {},      // owner and all its children are mounted
  beforeUpdate(el, binding, vnode, prevVnode) {},
  updated(el, binding, vnode, prevVnode) {},
  beforeUnmount(el, binding, vnode) {},
  unmounted(el, binding, vnode) {}
}
```

`binding` содержит `value`, `oldValue`, `arg`, `modifiers`, `instance` (публичный экземпляр владельца) и `dir` (сам объект директивы). Запуск `<p v-log:color.once="v">` показал детали, которые спрашивают на интервью:

- В `created` и `beforeMount` элемент ещё не в документе. В `mounted` он вставлен, поэтому измерять размеры, ставить фокус и создавать `IntersectionObserver` нужно здесь.
- `beforeUpdate`/`updated` вызываются при **каждом** перерендере владельца, а не только при смене `value`. После изменения несвязанного состояния хуки сработали с `value=2 old=2`. Дорогую работу защищают проверкой `binding.value !== binding.oldValue`.
- `oldValue` есть только в `beforeUpdate` и `updated`. В остальных хуках он `undefined`.

`binding` и `vnode` — только для чтения. Состояние между хуками (слушатель, observer) хранят на элементе через `dataset` или в `WeakMap` с ключом `el`. Всё, что повешено в `mounted`, снимают в `unmounted`, иначе слушатель на `document` будет держать отсоединённый элемент и замыкание ([утечки памяти](../performance/memory-leaks.md#detached-dom)).

Регистрация: глобально через `app.directive('focus', vFocus)`, локально через опцию `directives` или в `<script setup>` переменной вида `vFocus`. Компилятор узнаёт её по префиксу `v` и заглавной букве и подставляет напрямую. Незнакомая директива ищется в рантайме через `resolveDirective("tooltip")`.

### Директива на компоненте

Директива на компоненте применяется к его **корневому элементу**, как fallthrough-атрибуты. Если корней несколько (фрагмент), рантайм пишет предупреждение `Runtime directive used on component with non-element root node. The directives will not function as intended.`. Хуки при этом не вызываются: в проверке `mounted` сработал для однокорневого компонента и не сработал для двухкорневого. Передать директиву дальше через `v-bind="$attrs"` нельзя. Гайд прямо не рекомендует директивы на компонентах: корень — деталь реализации, и рефакторинг компонента молча ломает директиву. Исключение — встроенный `v-show`, но и у него та же зависимость от единственного корня.

### SSR: `getSSRProps`

При SSR нет DOM, поэтому хуки директив на сервере не вызываются. Для серверной разметки у директивы есть хук `getSSRProps(binding)`: он возвращает атрибуты, которые попадут в HTML. Проверено `renderToString`:

```js
const vTooltip = {
  mounted(el, { value }) { el.title = value },
  getSSRProps({ value }) { return { title: value } }
}
// <button v-tooltip="msg">  →  <button title="hi">
// v-show="false"            →  style="color:red;display:none;"
// a directive without getSSRProps leaves no trace in the HTML
```

Встроенные `v-show` и `v-model` реализуют этот хук. Директива без `getSSRProps`, которая меняет атрибуты на клиенте, даёт расхождение серверного и клиентского HTML при гидрации. Поэтому гайд советует предпочитать декларативный `v-bind`: он одинаково работает на сервере и клиенте.

### Директива, composable или компонент

- **Директива** — когда нужен прямой доступ к DOM конкретного элемента, без своего состояния и разметки, для любого элемента: фокус, click-outside, автоизменение высоты `<textarea>`, ленивая загрузка через `IntersectionObserver`. Гайд формулирует так: директива нужна, только если задачу нельзя решить без прямой работы с DOM.
- **Composable** — когда у логики есть состояние, которое нужно отдать шаблону: `useIntersectionObserver(target)` возвращает `isVisible`, а директива ничего вернуть не может. Composable работает с template ref, типизируется и тестируется без шаблона.
- **Компонент** — когда есть своя разметка, стили или доступность: tooltip с позиционированием, `role` и `aria-describedby` — это компонент, а не директива, которая вставляет узлы в DOM в обход Vue.

> [!NOTE]
> Во Vue 3.6 (RC, `3.6.0-rc.15`, сверено 2026-11-14) у Vapor Mode (`<script setup vapor>`) **другой интерфейс** директив. Директива — функция `(el, value, arg, modifiers) => cleanup?`, где `value` и `arg` — геттеры. Вызывается она один раз, сразу после создания элемента и до вставки в DOM, а реагировать на изменения должна сама: через `watchEffect(() => …value())`. Возвращённая функция вызывается при уничтожении scope. Компилятор генерирует `_withVaporDirectives(n0, [[vTip, () => (msg.value), () => ("top"), { once: true }]])`, а `v-show` и `v-model` — `applyVShow` и `applyTextModel`. Объект с хуками в Vapor-шаблоне игнорируется с предупреждением «Vapor directives must be a function». В стабильной версии Vapor пока нет.

## Примеры

### `v-autofocus` с `<script setup>`

```vue
<script setup>
// The v + PascalCase name makes it usable as v-autofocus in the template
const vAutofocus = {
  mounted(el, { modifiers }) {
    el.focus()
    if (modifiers.select) el.select()
  }
}
</script>

<template>
  <!-- Unlike the autofocus attribute, it also works when Vue inserts the element later -->
  <input v-if="editing" v-autofocus.select :value="title" />
</template>
```

### Директива-функция с реакцией только на изменения

```js
// Function shorthand = { mounted: fn, updated: fn }
export const vColor = (el, { value, oldValue, arg = 'color' }) => {
  if (value === oldValue) return // updated runs on every owner re-render
  el.style[arg] = value
}
// <p v-color="textColor">, <p v-color:background-color="bg">
```

## Вопросы с интервью

::: details Чем v-if отличается от v-show и как выбрать
`v-if` — структурная директива: компилятор превращает её в тернарный оператор, ложная ветка не создаётся, переключение монтирует или размонтирует поддерево. Дочерние компоненты теряют состояние и проходят полный жизненный цикл. `v-show` рендерит элемент всегда и переключает `style.display`. У `v-if` выше стоимость переключения, у `v-show` — первого рендера. Частое переключение и элементы, которые должны оставаться в DOM (ссылки `aria-controls`, формы с вводом), — `v-show`. Редко меняющееся условие и тяжёлые скрытые блоки — `v-if`, он ленивый. `v-show` не работает на `<template>`, у него нет `v-else`, а на компоненте он требует единственного корня.
:::

::: details Почему в v-for нельзя использовать индекс как key
`key` говорит рантайму, какой vnode соответствует какому элементу данных. По ключу keyed-diff сопоставляет старые и новые узлы и переставляет DOM вместо пересоздания. Индекс привязан к позиции, а не к данным. После удаления или вставки в начало тот же индекс получает другой элемент. Vue патчит старый узел новыми props, но оставляет ему локальное состояние: `ref` внутри строки, значение `<input>`, фокус, анимацию. В итоге текст строки B оказывается рядом с заметкой, введённой для A. Ключ должен быть стабильным уникальным id из данных. Индекс допустим только для статического списка без состояния, а случайный ключ пересоздаёт всё на каждом рендере.
:::

::: details Почему v-if и v-for не ставят на один элемент
Во Vue 3 у `v-if` приоритет выше, чем у `v-for`. Условие выносится наружу и проверяется до цикла, поэтому переменной цикла в нём ещё нет: `v-if="item.done"` превращается в `_ctx.item.done` и падает с TypeError. Во Vue 2 приоритет был обратным: код работал, но фильтровал на каждом рендере и смешивал две ответственности. Правильно — фильтрация в `computed` (`visibleItems`), а условие на весь список — на `<template v-if>` снаружи. Линтер ловит это правилом `vue/no-use-v-if-with-v-for`.
:::

::: details Как v-model работает на обычном input
Это синтаксический сахар над директивой и обработчиком. Компилятор генерирует `onUpdate:modelValue` с присваиванием и `withDirectives(vnode, [[vModelText, value, , modifiers]])`. Директиву выбирает по элементу: text, checkbox, radio, select, при динамическом `type` — `vModelDynamic`. В `created` она вешает слушатель `input` (с `.lazy` — `change`) и пропускает промежуточный ввод IME через `compositionstart`/`compositionend`. В `beforeUpdate` она не трогает поле, если значение уже совпадает. `.trim` и `.number` применяются при записи в модель. `.number` при `NaN` оставляет строку.
:::

::: details Какие хуки есть у пользовательской директивы и когда вызывается updated
Хуки повторяют [жизненный цикл компонента](./lifecycle.md), но относятся к элементу: `created`, `beforeMount`, `mounted`, `beforeUpdate`, `updated`, `beforeUnmount`, `unmounted`. Работа с DOM, которому нужен документ (фокус, размеры, observers), — в `mounted`. Очистка — в `unmounted`. `beforeUpdate`/`updated` вызываются при каждом перерендере компонента-владельца, даже если значение директивы не изменилось. Поэтому сравнивают `binding.value` и `binding.oldValue`, который есть только в этих двух хуках. `binding` — только для чтения, состояние между хуками хранят на `el` или в `WeakMap`. Короткая форма-функция означает `mounted` + `updated`.
:::

::: details Что происходит с директивой на компоненте
Она применяется к корневому элементу компонента, как fallthrough-атрибуты. У многокорневого компонента директива игнорируется с предупреждением «Runtime directive used on component with non-element root node», а передать её через `$attrs` нельзя. Гайд не рекомендует так делать: корень — деталь реализации компонента. Если компоненту нужно поведение, лучше дать ему prop или сделать composable.
:::

::: details Как директивы работают при SSR
На сервере нет DOM, поэтому хуки директив не вызываются. Чтобы директива повлияла на серверный HTML, у неё есть хук `getSSRProps(binding)`: он возвращает атрибуты для разметки. Так делают встроенные `v-show` (рендерит `display:none`) и `v-model` (`value`, `checked`). Директива, которая меняет атрибуты только в `mounted`, даёт разный HTML на сервере и клиенте. Если то же можно выразить через `v-bind`, лучше использовать его.
:::

::: details Когда писать директиву, а когда composable или компонент
Директива — для низкоуровневой работы с DOM конкретного элемента без своего состояния и разметки: фокус, click-outside, автовысота, наблюдатели. Composable — когда логика должна вернуть реактивное состояние: директива не может ничего вернуть шаблону, а composable возвращает `isVisible` и тестируется отдельно. Компонент — когда есть разметка, стили и доступность. Например, tooltip с ARIA-связями лучше сделать компонентом, а не директивой, которая вставляет узлы в обход Vue. Во Vue 3.6 Vapor у директив другой интерфейс, ещё один повод держать в них минимум логики.
:::

## Задачи

### 1. Что выведет · легко

```vue
<script setup>
import { ref } from 'vue'
const color = ref('red')
const count = ref(0)
const vLog = {
  updated: (el, { value, oldValue }) => console.log('updated', value, oldValue)
}
setTimeout(() => { count.value++ }, 0)
setTimeout(() => { color.value = 'blue' }, 10)
</script>

<template>
  <p v-log="color">{{ count }}</p>
</template>
```

::: details Решение и разбор
```
updated red red
updated blue red
```

`updated` вызывается при каждом перерендере владельца. Изменение `count` перерисовывает `<p>`, и хук срабатывает, хотя значение директивы не менялось: `value === oldValue`. Если бы `{{ count }}` не было в шаблоне, первого обновления не случилось бы: компонент не читает `count`, и рендер не запускается. Хуки, которые должны работать только при смене значения, начинают с `if (value === oldValue) return`.
:::

### 2. Найдите баг · легко

После удаления первой задачи заметка остаётся у другой задачи.

```vue
<template>
  <TodoRow
    v-for="(todo, i) in todos"
    :key="i"
    :todo="todo"
    @remove="todos.splice(i, 1)"
  />
</template>
<!-- TodoRow keeps a local `const note = ref('')` bound to an <input> -->
```

::: details Решение и разбор
```vue
<TodoRow
  v-for="todo in todos"
  :key="todo.id"
  :todo="todo"
  @remove="todos.splice(todos.indexOf(todo), 1)"
/>
```

С `:key="i"` после удаления первого элемента ключ `0` получает бывшая вторая задача. Рантайм считает, что это тот же компонент: он обновляет prop `todo`, а `note` оставляет прежним, и заметка «съезжает» вверх. Затем лишний последний компонент размонтируется. Ключ из данных (`todo.id`) переносит компонент вместе с его состоянием. Если id нет, его назначают при создании задачи (`crypto.randomUUID()`), а не при рендере.
:::

### 3. Найдите баг · легко

```vue
<template>
  <ul>
    <li v-for="user in users" v-if="user.active" :key="user.id">{{ user.name }}</li>
  </ul>
</template>
```

::: details Решение и разбор
```vue
<script setup>
import { computed } from 'vue'
const props = defineProps({ users: Array })
const activeUsers = computed(() => props.users.filter(u => u.active))
</script>

<template>
  <ul>
    <li v-for="user in activeUsers" :key="user.id">{{ user.name }}</li>
  </ul>
</template>
```

Во Vue 3 `v-if` вычисляется раньше `v-for`, и `user` в условии ещё не объявлен. Компилятор превращает его в `_ctx.user.active`, и рендер падает с `TypeError: Cannot read properties of undefined`. `computed` фильтрует один раз на изменение `users`, а не на каждый рендер. Если условие относится ко всему списку (например, «показать, если загружено»), его ставят на `<template v-if>` вокруг `v-for`.
:::

### 4. Реализуйте `v-click-outside` · средне

Директива вызывает переданную функцию при нажатии вне элемента. Функция может меняться между рендерами, директива не должна оставлять слушателей после удаления элемента.

::: details Решение и разбор
```js
const state = new WeakMap()

export const vClickOutside = {
  mounted(el, { value }) {
    const s = { handler: value }
    s.listener = (event) => {
      if (!el.contains(event.target)) s.handler(event)
    }
    state.set(el, s)
    // pointerdown + capture: runs before any handler inside el can remove the target
    document.addEventListener('pointerdown', s.listener, true)
  },
  updated(el, { value }) {
    state.get(el).handler = value
  },
  unmounted(el) {
    document.removeEventListener('pointerdown', state.get(el).listener, true)
    state.delete(el)
  }
}
```

```vue
<div v-if="open" v-click-outside="() => (open = false)">…</div>
```

Разбор:

- **Свежий обработчик.** Инлайн-стрелка в шаблоне — новая функция на каждом рендере. Без `updated` директива вызывала бы обработчик из первого рендера со старым замыканием. Поэтому функция лежит в изменяемом `s.handler`, а слушатель на `document` один и тот же.
- **Очистка.** `removeEventListener` требует ту же ссылку и тот же `capture`. Без `unmounted` каждое открытие меню добавляет слушатель, который держит отсоединённый `el`. Это утечка, а заодно вызовы обработчика уже закрытого меню.
- **`pointerdown` и capture.** Если слушать `click` на `document`, обработчик кнопки внутри меню успеет сработать раньше. Если он удалит кнопку из DOM, `el.contains(event.target)` вернёт `false`, и меню закроется по ошибке. `pointerdown` наступает до `click`, а фаза capture на `document` срабатывает раньше обработчиков внутри `el`, в том числе тех, что вызывают `stopPropagation()`.
- **Shadow DOM.** Внутри веб-компонентов `event.target` ретаргетится на хост. Надёжнее `event.composedPath().includes(el)`.

Проверено в happy-dom: нажатие внутри не вызывает обработчик, снаружи вызывает актуальную функцию, после `v-if="false"` вызовов нет. Если нужен ещё и флаг «открыт», лучше composable `onClickOutside(targetRef, handler)`: он работает с template ref и возвращает функцию остановки.
:::

### 5. Что выведет · средне

```vue
<script setup>
import { ref, nextTick } from 'vue'
import Child from './Child.vue' // logs `${n} mounted` / `${n} unmounted`

const on = ref(false)
async function toggle() {
  on.value = true; await nextTick()
  on.value = false; await nextTick()
  on.value = true; await nextTick()
}
toggle()
</script>

<template>
  <Child v-if="on" n="if" />
  <Child v-show="on" n="show" />
</template>
```

::: details Решение и разбор
```
show mounted
if mounted
if unmounted
if mounted
```

`v-show` монтирует компонент сразу, даже скрытым: при первом рендере в DOM уже `<p style="display: none;">show</p>` рядом с комментарием `<!--v-if-->`. Дальше он только переключает `display` на корневом элементе `Child`, и хуки компонента больше не вызываются. `v-if` ленивый: при первом рендере `Child` не создаётся. Каждое переключение полностью монтирует или размонтирует компонент, а локальное состояние создаётся заново. Если состояние нужно сохранить при `v-if`, используют `<KeepAlive>`.
:::

## Источники

- [Vue.js: Built-in Directives](https://vuejs.org/api/built-in-directives.html)
- [Vue.js: Custom Directives](https://vuejs.org/guide/reusability/custom-directives.html)
- [Vue.js: Conditional Rendering](https://vuejs.org/guide/essentials/conditional.html)
- [Vue.js: List Rendering](https://vuejs.org/guide/essentials/list.html)
- [Vue.js: Form Input Bindings](https://vuejs.org/guide/essentials/forms.html)
- [Vue.js: Server-Side Rendering — Custom Directives](https://vuejs.org/guide/scaling-up/ssr.html#custom-directives)
- [Vue.js: Render Function APIs (`withDirectives`)](https://vuejs.org/api/render-function.html#withdirectives)
- [Vue 3 Migration Guide: `v-if` vs. `v-for` Precedence](https://v3-migration.vuejs.org/breaking-changes/v-if-v-for.html)
- [Исходники Vue 3.5.45: `runtime-core/src/directives.ts`, `runtime-dom/src/directives/vModel.ts`, `vShow.ts`](https://github.com/vuejs/core/tree/v3.5.45/packages)
- [Исходники Vue 3.6.0-rc.15: `runtime-vapor/src/directives`](https://github.com/vuejs/core/tree/v3.6.0-rc.15/packages/runtime-vapor/src)
- [eslint-plugin-vue: `vue/no-use-v-if-with-v-for`](https://eslint.vuejs.org/rules/no-use-v-if-with-v-for.html)
