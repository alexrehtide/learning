---
title: 'Механизм рендеринга: VDOM и компиляторные оптимизации'
level: ядро
---

# Механизм рендеринга: VDOM и компиляторные оптимизации

> **Коротко.** Шаблон компилируется в render-функцию, которая возвращает дерево vnode — обычных JS-объектов. При монтировании рендерер создаёт по ним DOM, при обновлении сравнивает новое дерево со старым (**patch**) и трогает DOM только там, где есть различия. Реактивность сообщает, **какой компонент** перерисовать, а VDOM — **что изменилось внутри**. Vue не сравнивает деревья вслепую: компилятор оставляет подсказки (кэш статики, patch flags, блоки с плоским списком динамических узлов), и стоимость обновления зависит от числа динамических привязок, а не от размера шаблона. Списки с `key` сравниваются по ключам, а перемещения минимизирует наибольшая возрастающая подпоследовательность (LIS). Во Vue 3.6 появляется Vapor Mode — компиляция вообще без VDOM.

**Связанные темы:** [Компоненты и шаблоны](./components-and-templates.md), [Директивы, в том числе пользовательские](./directives.md), [Как устроена реактивность](./reactivity-internals.md), [Производительность Vue и Nuxt](../performance/vue-performance.md), [Конвейер рендеринга: layout, paint, composite](../browser/rendering-pipeline.md), [Рекурсия и динамическое программирование](../algorithms/recursion-and-dp.md), [Слоты и provide/inject](./slots-and-provide-inject.md), [`KeepAlive`, `Teleport`, `Suspense`, `Transition` и асинхронные компоненты](./built-in-components.md), [XSS и безопасный вывод во Vue](../security/xss.md), [SSR и гидрация](./ssr-and-hydration.md)

## Теория

Все утверждения проверены на Vue 3.5.45 в Node 26.13.1: вывод компилятора — `@vue/compiler-sfc` и `@vue/compiler-dom`, поведение — через `createRenderer` с минимальным набором `nodeOps`, который считает операции с DOM. Как компилируется SFC целиком — в [«Компонентах и шаблонах»](./components-and-templates.md#что-компилятор-делает-из-шаблона). Как выбирать оптимизации и что их ломает на практике — в [«Производительности Vue и Nuxt»](../performance/vue-performance.md#что-делает-компилятор). Здесь — что генерирует компилятор и что с этим делает рантайм.

### VNode и render-функция

**VNode** (virtual node, виртуальный узел) — объект, описывающий элемент, текст, комментарий, фрагмент или компонент. Поля, важные для рендерера:

```text
VNode { type, props, children, key,
        shapeFlag,        // what it is: ELEMENT, STATEFUL_COMPONENT, TEXT_CHILDREN, ARRAY_CHILDREN…
        patchFlag,        // compiler hint: what can change (see below)
        dynamicProps,     // names of props to compare when patchFlag has PROPS
        dynamicChildren,  // flat list of dynamic descendants (only on a block)
        el, anchor,       // real DOM node(s) after mount
        component }       // instance, for component vnodes
```

**Render-функция** возвращает дерево vnode. У каждого экземпляра компонента есть **эффект рендера**: он вызывает render-функцию, подписывается на всё прочитанное и передаёт результат рендереру. Первый вызов — **mount** (создать DOM), следующие — **patch** (сравнить с прошлым деревом `instance.subTree`). Как эффект попадает в очередь и почему десять записей дают один рендер — в [«Как устроена реактивность»](./reactivity-internals.md#планировщик-runtime-core).

Зачем VDOM, если реактивность и так знает, что изменилось? Реактивность во Vue доходит до компонента, а не до узла: эффект рендера один на компонент. Внутри компонента нужен способ понять, какие узлы затронуты, — это и делает VDOM. Это компромисс: подписок меньше (по одной на компонент, а не на каждую привязку), зато каждое обновление пересоздаёт vnode и сравнивает их. Компилятор сокращает эту работу, а Vapor Mode убирает её совсем.

Рендерер не привязан к браузеру. `@vue/runtime-core` получает операции с узлами (`createElement`, `insert`, `remove`, `setElementText`, `patchProp` и др.) через `createRenderer(options)`. `@vue/runtime-dom` передаёт туда DOM API. Так же устроены рендереры для canvas и WebGL, а в проверках этой темы — счётчик операций.

### `patch`: что делает рендерер

```js
// runtime-core 3.5.45, renderer.ts (simplified)
function patch(n1, n2, container, anchor) {
  if (n1 === n2) return                        // the very same vnode: cached static, v-memo, v-once
  if (n1 && !isSameVNodeType(n1, n2)) {        // type or key differ
    anchor = getNextHostNode(n1)
    unmount(n1)                                 // no diff: destroy the old subtree
    n1 = null                                   // ...and mount the new one in its place
  }
  switch (n2.type) {
    case Text: case Comment: case Static: case Fragment: /* … */ break
    default:
      if (n2.shapeFlag & ELEMENT) processElement(n1, n2, container, anchor)
      else if (n2.shapeFlag & COMPONENT) processComponent(n1, n2, container, anchor)
      // Teleport and Suspense handle themselves via type.process()
  }
}
```

- **`isSameVNodeType`** — это `n1.type === n2.type && n1.key === n2.key`. Если тип или ключ другой, сравнения нет: старое поддерево размонтируется со всем состоянием, новое монтируется с нуля. Отсюда приём «сменить `key`, чтобы сбросить компонент».
- **Элемент.** `patchElement` переносит `el` со старого vnode на новый и обновляет props и детей. Если у vnode есть `dynamicChildren`, обходит только их, иначе сравнивает детей целиком.
- **Компонент.** `shouldUpdateComponent` сравнивает props и слоты. Если они не изменились, рендер ребёнка не запускается, а vnode просто получает ссылку на прежний экземпляр. Когда ребёнок всё же перерисовывается — в [«Производительности Vue и Nuxt»](../performance/vue-performance.md#стабильность-props).

### Patch flags

Patch flag — число на vnode, битовая маска «что в этом узле может измениться». Значения из `@vue/shared` 3.5.45:

| Флаг | Значение | Что делает рантайм |
| --- | --- | --- |
| `TEXT` | 1 | сравнивает только текст ребёнка: `n1.children !== n2.children` |
| `CLASS` | 2 | сравнивает только `class` |
| `STYLE` | 4 | обновляет только `style` |
| `PROPS` | 8 | сравнивает только props из `dynamicProps` (`["id"]`), по ссылке |
| `FULL_PROPS` | 16 | ключи props динамические (`v-bind="obj"`, `:[key]`): полный `patchProps` |
| `NEED_HYDRATION` | 32 | props, которые нужны при гидрации, но не при patch: обработчики событий, `.prop` |
| `STABLE_FRAGMENT` | 64 | порядок детей фрагмента не меняется (корень с несколькими узлами) |
| `KEYED_FRAGMENT` / `UNKEYED_FRAGMENT` | 128 / 256 | фрагмент `v-for` с `key` и без |
| `NEED_PATCH` | 512 | узел без динамических props, но с `ref` или директивой: попадает в блок ради их обновления |
| `DYNAMIC_SLOTS` | 1024 | у компонента динамические слоты: перерисовывать всегда |
| `CACHED` | −1 | статический vnode из `_cache`: не сравнивать никогда |
| `BAIL` | −2 | подсказкам верить нельзя (vnode пришёл извне, например `<component :is="vnode">`): полный diff |

Флаги объединяются: <code v-pre>&lt;p :class="cls"&gt;{{ msg }}&lt;/p&gt;</code> получает `3 /* TEXT, CLASS */`. Проверка — побитовое `&`, без обхода props:

```js
// runtime-core 3.5.45, patchElement (simplified)
if (patchFlag & FULL_PROPS) patchProps(el, oldProps, newProps)
else {
  if (patchFlag & CLASS && oldProps.class !== newProps.class) hostPatchProp(el, 'class', null, newProps.class)
  if (patchFlag & STYLE) hostPatchProp(el, 'style', oldProps.style, newProps.style)
  if (patchFlag & PROPS) for (const key of n2.dynamicProps) {
    if (newProps[key] !== oldProps[key] || key === 'value') hostPatchProp(el, key, oldProps[key], newProps[key])
  }
}
if (patchFlag & TEXT && n1.children !== n2.children) hostSetElementText(el, n2.children)
```

`value` патчится всегда, даже если в vnode он не изменился: пользователь мог напечатать в поле, и DOM разошёлся с vnode. `runtime-dom` сравнивает с реальным `el.value` и пишет, только если они разные.

Статика тоже оптимизируется: узлы без привязок создаются один раз и хранятся в `_cache` экземпляра с флагом `CACHED`, длинные статические фрагменты становятся одной строкой HTML. Чем кэширование 3.5 отличается от hoisting 3.4 — в [«Производительности Vue и Nuxt»](../performance/vue-performance.md#что-делает-компилятор).

### Блоки и tree flattening

**Блок** — vnode, который во время рендера собирает в плоский массив `dynamicChildren` всех своих динамических потомков, на любой глубине. При обновлении `patchBlockChildren` идёт по этому массиву и не обходит статику вообще (**tree flattening**, уплощение дерева). Как блок собирается — видно по выводу компилятора:

```js
// <div class="card"><h1>Title</h1><p :class="cls">{{ msg }}</p>
//   <ul><li v-for="it in items" :key="it.id">{{ it.t }}</li></ul>
//   <section v-if="ok"><b>{{ msg }}</b></section></div>   (Vue 3.5.45, shortened)
return (_openBlock(), _createElementBlock("div", _hoisted_1, [
  _cache[0] || (_cache[0] = _createElementVNode("h1", null, "Title", -1 /* CACHED */)),
  _createElementVNode("p", { class: _normalizeClass(cls.value) }, _toDisplayString(msg.value), 3 /* TEXT, CLASS */),
  _createElementVNode("ul", null, [
    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(items.value, (it) =>
      (_openBlock(), _createElementBlock("li", { key: it.id }, _toDisplayString(it.t), 1 /* TEXT */))
    ), 128 /* KEYED_FRAGMENT */))
  ]),
  (ok.value)
    ? (_openBlock(), _createElementBlock("section", _hoisted_3 /* { key: 0 } */, [
        _createElementVNode("b", null, _toDisplayString(msg.value), 1 /* TEXT */)
      ]))
    : _createCommentVNode("v-if", true)
]))
```

1. `openBlock()` кладёт в стек `blockStack` новый пустой массив `currentBlock`. Аргументы вызываются раньше внешней функции, поэтому стек открывается до создания детей.
2. Каждый `createElementVNode` с `patchFlag > 0`, а также каждый компонент, добавляет себя в `currentBlock`. Компонент попадает туда всегда: даже если он не обновится, новому vnode нужна ссылка на экземпляр.
3. `createElementBlock` закрывает блок: `vnode.dynamicChildren = currentBlock`, снимает массив со стека и добавляет сам блок в массив родительского блока.

У корня `div` в `dynamicChildren` оказались `p`, фрагмент `v-for` и ветка `v-if`. `h1` и `ul` туда не попали. Шаблон из 200 узлов с двумя интерполяциями при обновлении сравнивается за два шага.

**Почему `v-if` и `v-for` открывают новый блок.** `patchBlockChildren` сопоставляет старый и новый `dynamicChildren` **по индексу**: i-й с i-м. Это корректно, только если структура блока стабильна. `v-if` и `v-for` меняют её, поэтому их содержимое изолируется в отдельный блок:

- **Ветка `v-if`** — блок с автоматическим ключом (`key: 0`, `key: 1` у `v-else`). Ложная ветка — тоже блок, комментарий `createCommentVNode("v-if", true)`. В родителе на этом месте всегда ровно один элемент. Ключи у веток разные, поэтому `isSameVNodeType` при переключении даёт `false`, и ветка заменяется целиком. Проверено: `<input v-if>` и `<input v-else>` после переключения — разные DOM-элементы. Во Vue 2 элемент переиспользовался, и ключи на ветки ставили вручную. Vue 3 генерирует их сам.
- **Фрагмент `v-for`** открывается как `openBlock(true)`: трекинг выключен, потомков он не собирает. Число элементов меняется, поэтому дети сравниваются алгоритмом для списков (ниже), а каждый элемент списка — свой блок.

Если блок всё же оказался нестабильным (например, vnode собран вручную), `patchElement` видит, что длины `dynamicChildren` не совпадают, и переходит на полный diff. Те же флаги и блоки ускоряют **гидрацию**: рантайм проходит только блоки и их динамических потомков.

### Списки с `key`: алгоритм

Фрагмент с флагом `KEYED_FRAGMENT` сравнивается функцией `patchKeyedChildren`. Пусть старый список `A B C D E F G`, новый `A B E C D H F G`:

1. **Общее начало.** Пока `isSameVNodeType(c1[i], c2[i])`, патчим и идём вперёд: `A`, `B`.
2. **Общий конец.** То же с конца: `G`, `F`.
3. **Простые случаи.** Если старый список кончился, оставшиеся новые монтируются. Если кончился новый, оставшиеся старые размонтируются. Добавление в конец или удаление из начала решается здесь, за O(n).
4. **Середина.** Старые `C D E`, новые `E C D H`. Строим `Map` «ключ → новый индекс» и проходим старые узлы. Не нашёлся ключ — размонтировать. Нашёлся — пропатчить и записать в `newIndexToOldIndexMap` старый индекс + 1 (0 значит «нового узла не было»): `[5, 3, 4, 0]` для `E C D H`. Если новые индексы при этом проходе шли не по возрастанию, ставится флаг `moved`.
5. **Перемещения.** Если `moved`, ищем **LIS** — наибольшую возрастающую подпоследовательность массива (`getSequence`, O(n log n), нули пропускаются). Здесь это `[3, 4]`: `C` и `D` уже стоят в нужном порядке и остаются на месте. Дальше обход **с конца**: узел с 0 монтируется, узел вне LIS переносится через `insertBefore` перед следующим (уже правильно расположенным) соседом.

Итог проверен счётчиком операций: одно создание (`H`) и два `insert` (`H` и `E`). Для `A B C D E → A C D B E` — один `insert` (`B`). Для разворота пяти элементов — четыре: LIS имеет длину 1. В общем случае перемещений ровно n − |LIS|, и меньше не бывает. LIS разобрана в [«Рекурсии и динамическом программировании»](../algorithms/recursion-and-dp.md#классические-задачи).

Сложность: проход по общим краям и `Map` — O(n), LIS — O(n log n). Если порядок не менялся (`moved === false`), LIS не считается вовсе. Узлы **без** ключа в середине ищутся линейным перебором среди новых, это O(n²): так бывает в render-функциях, где ключи забыли поставить.

**Без `key`** компилятор ставит `UNKEYED_FRAGMENT`, и `patchUnkeyedChildren` сравнивает по позиции: i-й старый с i-м новым, лишние размонтирует или домонтирует в конце.

### Почему индекс в `key` ломает состояние

Ключ отвечает на вопрос «какой узел чей». Индекс на него не отвечает: после перестановки или удаления тот же индекс достаётся другому элементу. Рантайм видит знакомый ключ и **патчит существующий узел** новыми данными, а всё, что живёт вне props, остаётся от прежнего элемента: локальный `ref`, значение и фокус `<input>`, состояние анимации, экземпляр в `KeepAlive`.

Проверено на списке компонентов `Row` с локальным `draft = ref('draft-' + props.label)`. Удалили первый элемент из `a, b, c`:

| `:key` | Результат | Что случилось |
| --- | --- | --- |
| `x` (идентификатор) | `b:draft-b`, `c:draft-c` | размонтирован `a`, остальные не тронуты |
| `i` (индекс) | `b:draft-a`, `c:draft-b` | размонтирован **последний**, двум оставшимся переписаны props |

Индекс ещё и дороже. Перестановка `A B C D E → A C D B E` с `:key="x"` — один перенос узла. С `:key="i"` — ноль переносов, но три перезаписи текста: каждый узел на позициях 1–3 получил чужое содержимое. Для узлов с вложенными компонентами это три лишних перерисовки. Пример с `v-model` в каждой строке — в [«Директивах»](./directives.md#v-for-и-key).

Тот же механизм работает и в обратную сторону: **смена `key` пересоздаёт компонент**. `<UserForm :key="user.id" :user="user" />` при смене пользователя размонтирует старую форму и смонтирует новую с чистым состоянием (проверено: `mounted Ann, unmounted, mounted Bob`).

### Render-функции и JSX

`h(type, props?, children?)` создаёт vnode вручную: `type` — тег, компонент или функциональный компонент, `children` — строка, массив vnode или объект слотов (для компонентов).

У vnode из `h()` нет подсказок: `patchFlag` равен 0, `dynamicChildren` — `null`. Рендерер сравнивает все props и всех детей. Проверено: корень из 2000 статических `<li>` и одного `<p>` с числом, production-сборка, фиктивный DOM. Обновление шаблона занимает около 0,003 мс (сравнивается один `<p>`), обновление `h()` — около 0,3 мс (обходятся все 2000). Порядок разницы, а не точные цифры.

**JSX** во Vue компилирует `@vue/babel-plugin-jsx` (в Vite — `@vitejs/plugin-vue-jsx`). Это не JSX React: работают `class` и `for`, дети компонента передаются как слоты. Для TSX нужны `"jsx": "preserve"` и `"jsxImportSource": "vue"` в `tsconfig.json`. Опция `optimize` плагина по умолчанию `false`, и JSX превращается в `createVNode` без флагов. С `optimize: true` (проверено на плагине 3.0.0) появляются `PROPS` и `dynamicProps`, но блоков и кэша статики нет. README плагина советует включать её только с тщательным тестированием.

Render-функции нужны там, где шаблон выражает структуру плохо: тег или уровень заголовка по пропу, библиотечные обёртки, которые анализируют или клонируют переданные vnode (`cloneVNode`, `slots.default()` как массив), **функциональные компоненты** — функция `(props, { slots, emit, attrs })` без экземпляра и хуков жизненного цикла, рендер из данных (дерево из JSON, markdown в vnode). В остальных случаях шаблон предпочтительнее: он ближе к HTML и получает все оптимизации компилятора. Гайд Vue называет render-функции инструментом для переиспользуемых компонентов с очень динамической логикой рендера. Vnode из `setup` можно вставить в шаблон (`<component :is="vnode">`), но экземпляр компонента при этом не создаётся, а vnode получает флаг `BAIL`.

### `v-once` и `v-memo` изнутри

Обе директивы работают через `patch`: если новый vnode — **тот же объект**, что и старый, `n1 === n2` выходит сразу.

```js
// <p v-once>{{ msg }}</p>   (Vue 3.5.45); vnodes created between the two calls stay out of the block
_cache[2] || (_setBlockTracking(-1, true), (_cache[2] = _createElementVNode("p", null, /* … */)).cacheIndex = 2,
  _setBlockTracking(1), _cache[2])

// <div v-for="it in items" :key="it.id" v-memo="[it.id === sel]">
_renderList(items.value, (it, __, ___, _cached) => {
  const _memo = ([it.id === sel.value])
  if (_cached && _cached.el && _cached.key === (it.id) && _isMemoSame(_cached, _memo)) return _cached
  const _item = (_openBlock(), _createElementBlock("div", { key: it.id, /* … */ }, /* … */))
  _item.memo = _memo
  return _item
}, _cache, 0)
```

- `v-once` создаёт поддерево один раз и выключает для него сбор в блок: динамический `msg` внутри не попадает в `dynamicChildren` и больше не обновляется.
- `v-memo` в `v-for` хранит прошлые vnode элементов в `_cache`. Если ключ тот же, а все значения массива равны прежним по `Object.is` (`isMemoSame`), возвращается старый vnode. `isMemoSame` при этом сам кладёт его в текущий блок, чтобы структура блока не поменялась. Пропущены и рендер, и сравнение поддерева.

Когда их применять и чем опасна пропущенная зависимость — в [«Производительности Vue и Nuxt»](../performance/vue-performance.md#v-once-и-v-memo).

### Где рендеринг упирается в браузер

Patch синхронно выполняет найденные операции с DOM внутри одной микрозадачи сброса очереди. Layout и paint браузер делает позже, в кадре, поэтому десять изменений состояния дают один патч и один layout. Чтение геометрии в `onUpdated` или после `nextTick()` между записями ломает это так же, как в обычном JS. Подробно — в [«Конвейере рендеринга»](../browser/rendering-pipeline.md#vue-где-рождается-layout). VDOM экономит операции с DOM, но не стоимость layout большого DOM: длинные списки виртуализируют ([подробнее](../performance/vue-performance.md#большие-данные-меньше-реактивности)). Статический vnode-строка вставляется через `innerHTML`, но его содержимое известно на этапе компиляции. Пользовательские строки так в DOM не попадают, в отличие от `v-html` ([подробнее](../security/xss.md)).

### Vapor Mode

> [!NOTE]
> Во Vue 3.6 (RC, `3.6.0-rc.16` от 2026-11-20, сверено 2026-11-21) появляется **Vapor Mode** — режим компиляции SFC без VDOM. Включается атрибутом: `<script setup vapor>`, сокращённо `<script vapor>`, или `<template vapor>` для SFC без скрипта. Приложение только из Vapor-компонентов создаётся через `createVaporApp(App)` и не тянет рантайм VDOM. Чтобы смешать режимы в обычном `createApp`, нужен `app.use(vaporInteropPlugin)`. Release notes советуют держать режимы в отдельных областях приложения и не вкладывать их друг в друга без нужды. Не поддерживаются: Options API, `app.config.globalProperties`, `getCurrentInstance()` (возвращает `null`), события `@vue:xxx`, `v-memo` (компилятор предупреждает и игнорирует), `$el`/`$props`/`$attrs` у ref на компонент. У пользовательских директив другой интерфейс. Компоненты на render-функциях и JSX остаются VDOM-компонентами.

Что генерирует компилятор 3.6.0-rc.16 вместо дерева vnode:

```js
// the block example above without v-if, plus <button @click="msg += '!'">go</button> (shortened)
const t1 = _template("<div class=card><h1>Title</h1><p> </p><ul></ul><button>go", 1)

const n6 = t1()                               // clone the static HTML once
const n0 = _next(_child(n6))                  // <p>, found by walking siblings
const x0 = _txt(n0)
_renderEffect(() => {                         // one fine-grained effect per binding group
  _setClass(n0, cls.value)
  _setText(x0, _toDisplayString(msg.value))
})
const n1 = _createFor(() => (items.value), (_for_item0) => { /* t0(), renderEffect */ }, (it) => (it.id))
_on(n5, "click", () => (msg.value += '!'))
```

Нет render-функции компонента, vnode и сравнения деревьев. Изменение `msg` перезапускает один эффект, который пишет в один текстовый узел. Это модель Solid и Svelte 5 на реактивности Vue, и в js-framework-benchmark Vapor показывает тот же уровень производительности. Списки и в Vapor сравниваются по ключам: `createFor` использует тот же `getSequence` (LIS). С `3.6.0-rc.2` обработчики вешаются прямо на элемент, а делегирование на `document` включается модификатором `.delegate`. VDOM-режим в 3.6 не меняется: шаблоны этой темы компилируются в тот же вывод, а эксперименты со списками дают те же операции с DOM.

## Примеры

Компонент, который удобнее написать функцией, а не шаблоном:

```jsx
// AnchoredHeading.jsx: <AnchoredHeading :level="2" id="setup">Setup</AnchoredHeading>
import { defineComponent } from 'vue'

export default defineComponent({
  props: {
    level: { type: Number, required: true, validator: (n) => n >= 1 && n <= 6 },
    id: { type: String, required: true },
  },
  setup(props, { slots }) {
    return () => {
      const Tag = `h${props.level}`
      return <Tag id={props.id}><a href={`#${props.id}`}>{slots.default?.()}</a></Tag>
    }
  },
})
```

## Вопросы с интервью

::: details Зачем Vue виртуальный DOM, если реактивность и так знает, что изменилось
Реактивность во Vue доходит до компонента: эффект рендера один на экземпляр, а не на каждую привязку. Она говорит, **какой компонент** перерисовать. Что именно изменилось внутри него, определяет VDOM: render-функция возвращает новое дерево vnode, рендерер сравнивает его со старым и выполняет минимум операций с DOM. Компромисс: подписок мало, но каждое обновление создаёт vnode и сравнивает их. Компилятор сокращает сравнение до динамических узлов, а Vapor Mode в 3.6 убирает VDOM и делает подписку на каждую привязку, как Solid. Ещё VDOM даёт render-функции: UI как обычные JS-объекты, которые можно создавать, анализировать и комбинировать.
:::

::: details Что такое compiler-informed virtual DOM и чем он отличается от VDOM React
В чистом runtime-VDOM алгоритм сравнения ничего не знает о дереве. Он обходит его целиком, сравнивает props каждого узла и пересоздаёт vnode даже для неизменных частей. Во Vue компилятор и рантайм — одна система, и компилятор оставляет подсказки. Статика создаётся один раз и хранится в `_cache` (флаг `CACHED`, `patch` выходит на `n1 === n2`). Динамический узел несёт patch flag: рантайм проверяет только `class`, текст или перечисленные в `dynamicProps` атрибуты. Блок собирает плоский `dynamicChildren`, и сравнение обходит только его. Итог: стоимость обновления пропорциональна числу привязок, а не размеру шаблона. Render-функции и JSX этих подсказок не получают.
:::

::: details Как Vue обновляет список с ключами
`patchKeyedChildren`: синхронизирует общее начало и общий конец. Если осталась только вставка или только удаление, делает её. Иначе строит `Map` «ключ → новый индекс», проходит старые узлы: ненайденные размонтирует, найденные патчит и записывает в массив «новая позиция → старый индекс». Если индексы шли не по возрастанию, считает LIS этого массива за O(n log n). Узлы из LIS остаются на месте, остальные переносятся через `insertBefore`, обход с конца, чтобы якорь уже стоял правильно. Перемещений получается n − |LIS|, это минимум. `A B C D E → A C D B E` — один перенос, разворот пяти — четыре.
:::

::: details Почему нельзя использовать индекс как key и когда это допустимо
Ключ — идентичность узла. С индексом после удаления или перестановки тот же ключ получает другой элемент. Рантайм патчит существующий узел новыми props, а локальное состояние (`ref` в дочернем компоненте, значение и фокус `<input>`, анимация, `KeepAlive`) остаётся от старого. Удаление первого из трёх с `:key="i"` размонтирует **последний** узел и переписывает props двум оставшимся. Перестановка вместо одного переноса даёт перезапись каждого сдвинутого узла. Допустимо, если список только дописывается в конец или статичен, а у элементов нет состояния вне props. Ключ должен быть стабильным и уникальным среди соседей. `Math.random()` пересоздаёт всё на каждом рендере.
:::

::: details Почему v-if и v-for создают новый блок
Блок сравнивает свой плоский `dynamicChildren` со старым по индексу, поэтому его структура должна быть стабильной. `v-if` и `v-for` меняют структуру и изолируются. Ветка `v-if` — отдельный блок с автоматическим ключом (`0`, `1`), ложная ветка — блок-комментарий, так что в родителе на этом месте всегда один элемент. Разные ключи веток дают `isSameVNodeType === false`, и ветка заменяется целиком, даже если обе ветки — `<input>`. Фрагмент `v-for` (`openBlock(true)`) потомков не собирает: число детей меняется, они сравниваются алгоритмом списков, а каждый элемент — свой блок. Если блок всё же нестабилен, `patchElement` откатывается на полный diff.
:::

::: details Когда писать render-функцию или JSX вместо шаблона
Когда структура слишком динамична для шаблона: тег или уровень заголовка по пропу, обёртки, которые анализируют или клонируют переданные vnode, рекурсивный рендер из данных, функциональные компоненты в библиотеках. Цена — потеря оптимизаций: у `h()` нет patch flags и блоков, сравнивается всё. `@vue/babel-plugin-jsx` по умолчанию тоже не ставит флаги, а с `optimize: true` ставит только часть. Плюс шаблон ближе к HTML, его проще читать и проверять на доступность. Поэтому по умолчанию — шаблон, а `<component :is>` и динамические слоты закрывают большинство «динамических» случаев без render-функций.
:::

::: details Как включить Vapor Mode в существующем приложении и что в нём недоступно
Vapor — режим компиляции Vue 3.6, на 2026-11-21 в статусе RC (`3.6.0-rc.16`). Компонент переводится атрибутом `<script setup vapor>`. В обычном приложении `createApp(App).use(vaporInteropPlugin)` позволяет вкладывать Vapor- и VDOM-компоненты друг в друга. Рекомендация команды Vue — отдельные критичные страницы в Vapor или небольшие новые приложения целиком через `createVaporApp`, без глубокого смешивания. Нет Options API, `globalProperties`, `getCurrentInstance()`, `v-memo`, событий `@vue:xxx`, `$el` и `$props` у ref на компонент. Компоненты на render-функциях и JSX остаются VDOM. Ответ senior — понимать модель и ограничения, а не мигрировать production на RC.
:::

## Задачи

### 1. Сколько переносов · легко

Список `<li v-for="x in list" :key="x">` содержит `A B C D E`. Сколько вызовов `insertBefore` сделает Vue после `list.value = ['A', 'C', 'D', 'B', 'E']`? А после разворота `['E', 'D', 'C', 'B', 'A']`? Что изменится с `:key="i"`?

::: details Решение и разбор
Первый случай — **один** перенос. Общие края: `A` в начале, `E` в конце. Середина: старые `B C D`, новые `C D B`, массив «новая позиция → старый индекс + 1» — `[3, 4, 2]`. Его LIS — `[3, 4]` (`C`, `D`), они остаются на месте. Переносится только `B`: перед `E`.

Разворот — **четыре** переноса. Общих краёв нет, массив `[5, 4, 3, 2, 1]` убывает, LIS длины 1. На месте остаётся один узел, остальные четыре переносятся. Меньше нельзя: n − |LIS| = 5 − 1.

С `:key="i"` ключи до и после — `0…4`, все узлы «на месте». Переносов ноль, но меняется текст каждого узла, чьё содержимое сдвинулось: три перезаписи в первом случае, четыре во втором (`C` в центре на месте). Для простого текста это даже дешевле. Для строк с компонентами и состоянием — лишние перерисовки и перепутанное состояние.

Сложность: O(n log n) по времени на LIS, O(n) по памяти.
:::

### 2. Форма не сбрасывается · легко

При выборе другого пользователя в списке форма показывает имя прежнего. Почему и как исправить, не меняя `UserForm`?

```vue
<!-- Parent.vue -->
<UserForm :user="current" />

<!-- UserForm.vue -->
<script setup>
import { ref } from 'vue'
const props = defineProps(['user'])
const draft = ref(props.user.name) // editable copy
</script>

<template>
  <form><input v-model="draft" /></form>
</template>
```

::: details Решение и разбор
Тип vnode (`UserForm`) и ключ (`undefined`) не изменились, поэтому `isSameVNodeType` возвращает `true`, и рендерер **патчит** существующий экземпляр. `setup` больше не вызывается, `draft` остаётся `'Ann'`, хотя `props.user` уже Bob.

```vue
<UserForm :key="current.id" :user="current" />
```

Новый ключ — новый vnode другого «типа» с точки зрения `patch`: старый экземпляр размонтируется, новый монтируется с `draft = 'Bob'`. Проверено: `mounted Ann, unmounted, mounted Bob`.

Альтернатива внутри компонента — `watch(() => props.user, (u) => (draft.value = u.name))`. Но сброс через `key` надёжнее: он сбрасывает **всё** состояние, включая вложенные компоненты, фокус и ошибки валидации, ценой полного перемонтирования.
:::

### 3. Что сгенерирует компилятор · средне

Не запуская компилятор, ответьте: какие узлы попадут в `_cache`, какие patch flags получат `<p>` и `<input>`, что окажется в `dynamicChildren` корневого `div` и изменится ли его длина, когда `items` станет пустым?

```vue
<template>
  <div>
    <h2>Cart</h2>
    <p :class="{ empty: !items.length }">{{ total }}</p>
    <input :value="query" placeholder="Search">
    <ItemRow v-for="it in items" :key="it.id" :item="it" />
    <footer v-if="items.length">{{ items.length }} items</footer>
  </div>
</template>
```

::: details Решение и разбор
- В `_cache` — только `<h2>`. `placeholder` статичен, поэтому у `<input>` флаг `PROPS` и `dynamicProps = ["value"]`, а не `FULL_PROPS`.
- `<p>` — `3 = TEXT | CLASS`: рантайм сравнит класс и текст, больше ничего.
- `dynamicChildren` корня (проверено в рантайме): `p`, `input`, фрагмент `v-for` (128), `footer` (блок).
- Длина не изменится. Пустой список — тот же фрагмент без детей, ложная ветка `v-if` — блок-комментарий. В родителе всегда четыре элемента, поэтому сравнение по индексу корректно. `ItemRow` внутри фрагмента — каждый свой блок, их сравнит `patchKeyedChildren`.
:::

### 4. Diff списка с ключами · сложно

Реализуйте `diffKeys(oldKeys, newKeys)`: вернуть минимальный список операций `['mount' | 'unmount' | 'move', key]`, который превращает старый порядок в новый, по стратегии Vue 3. Ключи уникальны.

```js
diffKeys([...'ABCDEFG'], [...'ABECDHFG']) // [['mount', 'H'], ['move', 'E']]
diffKeys([...'ABCD'], [...'DXAB'])        // [['unmount', 'C'], ['mount', 'X'], ['move', 'D']]
```

::: details Решение и разбор
```js
function diffKeys(oldKeys, newKeys) {
  const ops = []
  let i = 0
  let e1 = oldKeys.length - 1
  let e2 = newKeys.length - 1
  while (i <= e1 && i <= e2 && oldKeys[i] === newKeys[i]) i++              // common prefix
  while (i <= e1 && i <= e2 && oldKeys[e1] === newKeys[e2]) { e1--; e2-- } // common suffix
  if (i > e1) {
    for (let k = i; k <= e2; k++) ops.push(['mount', newKeys[k]])
    return ops
  }
  if (i > e2) {
    for (let k = i; k <= e1; k++) ops.push(['unmount', oldKeys[k]])
    return ops
  }
  const keyToNewIndex = new Map()
  for (let k = i; k <= e2; k++) keyToNewIndex.set(newKeys[k], k)
  const toPatch = e2 - i + 1
  const newToOld = new Array(toPatch).fill(0) // 0 = no old node, else oldIndex + 1
  let moved = false
  let maxNewIndex = 0
  for (let k = i; k <= e1; k++) {
    const newIndex = keyToNewIndex.get(oldKeys[k])
    if (newIndex === undefined) { ops.push(['unmount', oldKeys[k]]); continue }
    newToOld[newIndex - i] = k + 1
    if (newIndex >= maxNewIndex) maxNewIndex = newIndex
    else moved = true
  }
  const stable = moved ? lis(newToOld) : []
  let j = stable.length - 1
  for (let k = toPatch - 1; k >= 0; k--) { // backwards: the anchor (next sibling) is already placed
    const key = newKeys[i + k]
    if (newToOld[k] === 0) ops.push(['mount', key])
    else if (moved) {
      if (j < 0 || k !== stable[j]) ops.push(['move', key])
      else j--
    }
  }
  return ops
}

// Indices of a longest strictly increasing subsequence, zeros skipped.
function lis(arr) {
  const prev = new Array(arr.length)
  const tails = [] // tails[len - 1] = index of the smallest tail of a run of that length
  for (let k = 0; k < arr.length; k++) {
    if (arr[k] === 0) continue
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (arr[tails[mid]] < arr[k]) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[k] = tails[lo - 1]
    tails[lo] = k
  }
  const result = []
  for (let k = tails.at(-1), n = tails.length; n > 0; n--, k = prev[k]) result[n - 1] = k
  return result
}
```

Решение сверено со счётчиком операций настоящего рендерера Vue 3.5.45 на тех же входах: `ABCDE → ACDBE` — `[['move', 'B']]`, разворот — четыре `move`, `ABCDEFG → ABECDHFG` и `ABCD → DXAB` — как в условии. Флаг `moved` экономит LIS, когда порядок сохранился и были только вставки и удаления. В настоящем `patchKeyedChildren` есть ещё одно сокращение: когда все новые узлы уже сопоставлены (`patched >= toBePatched`), оставшиеся старые размонтируются без поиска.

Сложность: O(n log n) по времени (LIS), O(n) по памяти.
:::

## Источники

- [Vue: Rendering Mechanism](https://vuejs.org/guide/extras/rendering-mechanism.html)
- [Vue: Render Functions & JSX](https://vuejs.org/guide/extras/render-function.html)
- [Vue API: Render Function APIs — `h()`, `cloneVNode`, `withMemo`](https://vuejs.org/api/render-function.html)
- [Vue API: `v-once`, `v-memo`](https://vuejs.org/api/built-in-directives.html#v-memo) и [`key`](https://vuejs.org/api/built-in-special-attributes.html#key)
- [Vue 3 Migration Guide: `key` Attribute](https://v3-migration.vuejs.org/breaking-changes/key-attribute.html)
- [vuejs/core v3.5.45: `runtime-core/src/renderer.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/renderer.ts) — `patch`, `patchElement`, `patchKeyedChildren`, `getSequence`
- [vuejs/core v3.5.45: `runtime-core/src/vnode.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/vnode.ts) — `openBlock`, `setupBlock`, `isSameVNodeType`
- [vuejs/core v3.5.45: `shared/src/patchFlags.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/shared/src/patchFlags.ts)
- [Vue Template Explorer](https://template-explorer.vuejs.org/) — вывод компилятора шаблонов
- [vuejs/core CHANGELOG, ветка `minor`](https://github.com/vuejs/core/blob/minor/CHANGELOG.md) — Vue 3.6.0-rc.1, раздел «About Vapor Mode»; rc.2 — делегирование событий; rc.16
- [`@vue/babel-plugin-jsx`: README, опция `optimize`](https://github.com/vuejs/babel-plugin-jsx/tree/main/packages/babel-plugin-jsx)
- [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
