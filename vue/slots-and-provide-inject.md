---
title: Слоты и provide/inject
level: ядро
---

# Слоты и provide/inject

> **Коротко.** Слот — это функция, которую родитель передаёт ребёнку, а ребёнок вызывает в своём рендере. Отсюда три следствия: слот ленив (не вызван — не отрендерен), его зависимости отслеживает render-эффект **ребёнка**, а переменные он берёт из области видимости родителя через замыкание. Scoped slot — та же функция, которой ребёнок передаёт аргументы. Provide/inject передаёт значение вниз по дереву без проброса props через каждый уровень: каждый компонент наследует `provides` родителя через цепочку прототипов, а `inject` ищет ключ по этой цепочке. Реактивность не появляется сама: передавать нужно `ref` или `reactive` (лучше через `readonly`), а не `.value`. Ключом служит `InjectionKey<T>` — символ, к которому привязан тип.

**Связанные темы:** [Компоненты и шаблоны](./components-and-templates.md), [Props, emits и `v-model` на компонентах](./props-emits-v-model.md), [Реактивность: `ref`, `reactive`, `computed`](./reactivity.md), [Жизненный цикл](./lifecycle.md), [UI-coding: базовые компоненты на Vue](../live-coding/ui-components.md), [Принципы и паттерны проектирования](../architecture/principles-and-patterns.md), [Design system и UI-kit](../architecture/design-systems.md), [Производительность Vue и Nuxt](../performance/vue-performance.md), [Замыкания](../javascript/closures.md)

## Теория

Все проверки выполнены на Vue 3.5.45 в Node 26.13.1. Вывод компилятора получен через `@vue/compiler-sfc`, поведение проверено запуском с happy-dom, типы — `vue-tsc` 3.3.14 на TypeScript 6.0. Те же сценарии повторены на `3.6.0-rc.16`; отличие одно, оно описано во врезке про 3.6.

### Слот — это функция

Шаблон родителя

```vue
<List :items="items">
  <template #header>Users: {{ items.length }}</template>
  <template #item="{ item, index }">{{ index }}. {{ item.name }}</template>
</List>
```

компилятор превращает в третий аргумент `createVNode` — объект функций (вывод сокращён):

```js
_createVNode(_component_List, { items: _ctx.items }, {
  header: _withCtx(() => [
    _createTextVNode("Users: " + _toDisplayString(_ctx.items.length), 1 /* TEXT */)
  ]),
  item: _withCtx(({ item, index }) => [
    _createTextVNode(_toDisplayString(index) + ". " + _toDisplayString(item.name), 1 /* TEXT */)
  ]),
  _: 1 /* STABLE */
}, 8 /* PROPS */, ["items"])
```

А тег `<slot name="item" :item="item" :index="i">` с fallback-текстом `item.name` в шаблоне ребёнка становится вызовом:

```js
_renderSlot(_ctx.$slots, "item", { item: item, index: i }, () => [
  _createTextVNode(_toDisplayString(item.name), 1 /* TEXT */)   // fallback
])
```

Из этой модели следует всё остальное:

- **Область видимости.** Тело слота — стрелка, созданная в рендере родителя. Свободные идентификаторы в нём — `_ctx` **родителя** ([замыкание](../javascript/closures.md)). Данные ребёнка слот видит только через аргументы. Документация: «Slot content has access to the data scope of the parent component, because it is defined in the parent».
- **Scoped slot** — та же функция, только с параметрами. Документация так и говорит: «think of a scoped slot as a function being passed into the child component». Деструктуризация `v-slot="{ item, index }"` — это буквально деструктуризация параметра стрелки, поэтому работают значения по умолчанию и переименование: `#item="{ item: user = {} }"`.
- **Ленивость.** Ребёнок решает, вызывать ли функцию. `<slot v-if="open" />` при `open = false` вообще не выполняет выражения слота: функция `heavy()` в содержимом не вызвалась ни разу, пока панель была закрыта (проверено). Поэтому слот, в отличие от prop с готовым VNode, ничего не стоит, если его не показывают.
- **Реактивность.** Слот выполняется внутри render-эффекта ребёнка, и зависимости, прочитанные в нём, отслеживает этот эффект. Если состояние родителя читается **только** в слоте, при его изменении перерисовывается один ребёнок, а родитель — нет (задача 1). Как эффект собирает зависимости — в теме [«Мини-реактивность в стиле Vue»](../live-coding/mini-reactivity.md).
- **`withCtx`** запоминает экземпляр родителя, чтобы при вызове из ребёнка `currentRenderingInstance` указывал на родителя: от этого зависят scoped-стили (`data-v-*` родителя на элементах слота) и разрешение `resolveComponent`.

> [!WARNING]
> Слот нужно вызывать **в рендере**, а не в `setup`. `const vnodes = slots.default()` в `setup` создаёт VNode один раз, вне эффекта: изменения в родителе не дойдут до DOM (задача 4). Для слотов из render-функции (`h(Child, null, { default: () => … })`) Vue предупреждает: «Slot "default" invoked outside of the render function: this will not track dependencies used in the slot». Для скомпилированных из шаблона слотов предупреждения нет — вызов молча теряет обновления.

### Default, именованные, fallback

- Контент без `<template #…>` становится слотом `default`. Он может соседствовать с именованными `<template>`: `<List>loose<template #a>1</template></List>` даёт `{ a, default }`.
- `v-slot` (сокращение `#`) пишется на компоненте — только когда слот один, — или на `<template>`. На обычном элементе — ошибка компилятора «v-slot can only be used on components or `<template>` tags». Смешать `v-slot` на компоненте и `<template #footer>` внутри нельзя: «Mixed v-slot usage on both the component and nested `<template>`. When there are multiple named slots, all slots should use `<template>` syntax to avoid scope ambiguity». Причина в области видимости: непонятно, видят ли именованные слоты переменные из `v-slot` компонента. Два `<template #a>` дают «Duplicate slot names found».
- **Fallback** — содержимое между `<slot>` и `</slot>`, четвёртый аргумент `renderSlot`. Рантайм показывает его, если слота нет **или** он вернул только комментарии и пустые фрагменты (`ensureValidVNode`). Слот, внутри которого всё скрыто `v-if`, даёт fallback (задача 2).
- `<slot v-bind="obj">` передаёт все поля объекта как slot props (`_normalizeProps(_guardReactiveProps(obj))`), как `v-bind` без аргумента у элемента.

### Стабильные и динамические слоты

Флаг `_: 1 /* STABLE */` говорит рантайму, что набор слотов не меняется между рендерами родителя. Тогда `shouldUpdateComponent` может пропустить ребёнка, если не изменились его props: содержимое слотов ребёнок перерисует сам, когда сработают их зависимости.

Слот становится **динамическим**, если набор слотов зависит от данных:

```vue
<List>
  <template v-if="showFooter" #footer>bye</template>
  <template #[dyn]>x</template>
  <template v-for="c in cols" #[`cell-${c}`]="{ value }">{{ value }}</template>
</List>
```

Тогда компилятор собирает слоты через `_createSlots({ [_ctx.dyn]: …, _: 2 /* DYNAMIC */ }, [ showFooter ? { name: "footer", fn, key: "0" } : undefined ])` и ставит vnode флаг `1024 /* DYNAMIC_SLOTS */`. Такой ребёнок перерисовывается при **каждом** рендере родителя — цена разобрана в теме [«Производительность Vue и Nuxt»](../performance/vue-performance.md). Динамическое имя (`#[name]`) полезно для таблиц (`#cell-price`) и обёрток, которые прокидывают все слоты дальше:

```vue
<template v-for="(_, name) in $slots" #[name]="scope">
  <slot :name="name" v-bind="scope ?? {}" />
</template>
```

### `$slots`, `useSlots` и условные обёртки

`$slots` (в шаблоне), `slots` из контекста `setup`, `useSlots()` и результат `defineSlots()` — один и тот же объект. Типичное применение — не рисовать обёртку, если слот не передан:

```vue
<header v-if="$slots.header" class="card__header"><slot name="header" /></header>
```

Это проверка **наличия функции**, а не содержимого. `<template #header><span v-if="false" /></template>` даёт `$slots.header`, и обёртка рисуется — с fallback внутри (задача 2). Нужна условность — ставьте `v-if` на сам `<template #header>`: тогда слот не создаётся вовсе.

Объект `slots` не реактивен как таковой. Его не наблюдают через `watch`, а читают в рендере: при смене слотов ребёнок перерисовывается сам. В Vue 3 нет `$scopedSlots`: все слоты — функции и лежат в `$slots`.

### `defineSlots` и типизация

`defineSlots` (3.3+) принимает только тип и в рантайме ничего не объявляет. Компилятор заменяет его на `const slots = _useSlots()`, никакой опции `slots` в компоненте не появляется. Польза — в типах для родителя:

```vue
<script setup lang="ts" generic="T extends { id: number }">
defineProps<{ items: T[] }>()
defineSlots<{
  default(props: { item: T; index: number }): any
  empty?(): any
}>()
</script>
```

С таким объявлением `vue-tsc` проверяет родителя: `<List :items="users">` выводит `T` из `users`, в `#default="{ item }"` обращение к `item.age` даёт «Property 'age' does not exist on type '{ id: number; name: string; }'», а неизвестный слот `#footer` — «Property 'footer' does not exist on type '__VLS_Slots'» (проверено). Без `defineSlots` slot props вычисляются из `<slot>` в шаблоне, но имена и обязательность слотов не описаны контрактом.

> [!NOTE]
> Во Vue 3.6 (RC, сверено 2026-11-21: последняя версия `3.6.0-rc.16` от 2026-11-20) компилятор разрешает slot props как компоненты (`compiler-core: resolve slot prop bindings as components`, #13573, с `3.6.0-beta.11`). Для `<List v-slot="{ Icon }"><Icon /></List>` Vue 3.5.45 генерирует `_resolveComponent("Icon")` — поиск **зарегистрированного** компонента с таким именем, а slot prop игнорируется. В 3.6 генерируется `_createVNode(Icon, …)`. В 3.5 пишите `<component :is="Icon" />`.

### Renderless и headless-компоненты

Scoped slot позволяет отдать потребителю состояние и поведение, а разметку оставить ему: компонент рендерит только `<slot v-bind="state" />`. Так устроены headless-библиотеки — роли и зачем они нужны разобраны в темах [«Принципы и паттерны проектирования»](../architecture/principles-and-patterns.md) и [«Design system и UI-kit»](../architecture/design-systems.md). Документация Vue замечает, что большую часть renderless-компонентов эффективнее заменить composable — без лишнего уровня в дереве. Компонент со слотом нужен, когда логика неотделима от разметки: например, он сам ставит ARIA-атрибуты и обработчики на элементы, которые рисует потребитель.

### Provide/inject: как устроено

Provide/inject решает **prop drilling** — проброс значения через компоненты, которым оно не нужно. Компонент провайдит значение по ключу, любой потомок его инжектит.

Устройство (`runtime-core/src/apiInject.ts`):

- у каждого экземпляра есть `provides`. По умолчанию это **тот же объект**, что у родителя;
- первый `provide()` в компоненте делает `instance.provides = Object.create(parent.provides)` и пишет ключ в новый объект. Получается цепочка прототипов параллельно дереву компонентов: ближайший провайдер затеняет верхних только для своего поддерева;
- `inject(key)` смотрит в `instance.parent.provides` и проверяет `key in provides` — поиск идёт по цепочке прототипов до `app._context.provides`;
- поэтому компонент **не видит собственный** `provide`: если он провайдит `theme: 'dark'` и тут же инжектит `theme`, он получит значение родителя (`'light'` в проверке), а его дети — `'dark'`.

`provide`/`inject` работают только синхронно в `setup`, так как используют `currentInstance`. После `await` в `setup` `provide` предупреждает «provide() can only be used inside setup()» и ничего не делает. `inject` в обработчике события даёт «inject() can only be used inside setup() or functional components» и `undefined`. Функции `use…` с `inject` внутри поэтому вызывают синхронно в `setup`. Вне компонента контекст дают `app.runWithContext(() => inject(key))` (3.3+) — так `inject` работает в навигационных guard'ах и плагинах, — а `hasInjectionContext()` (3.3+) проверяет, можно ли сейчас вызвать `inject`.

**`app.provide(key, value)`** кладёт значение в `app._context.provides` — корень цепочки, видимый всему приложению. Так плагины отдают свои объекты: роутер, Pinia, i18n. Отдельные приложения на странице (микрофронтенды) не видят провайдеров друг друга — подробнее в теме [«Масштабирование фронтенда»](../architecture/scaling-frontend.md).

### Значение по умолчанию и отсутствующий ключ

```ts
const a = inject(themeKey)                            // Theme | undefined, warning if missing
const b = inject(themeKey, defaultTheme)              // Theme
const c = inject(cacheKey, () => new Map(), true)     // factory: called only if missing
```

Без значения по умолчанию отсутствующий ключ даёт `undefined` и предупреждение «injection "nope" not found». Функцию по умолчанию без третьего аргумента `true` Vue вернёт как есть: `inject('x', () => 1)` — это функция, а не `1` (проверено). Фабрика нужна для дорогих или изменяемых значений: литерал объекта по умолчанию вычисляется при каждом вызове `inject`, даже если ключ найден.

Если без провайдера компонент работать не может (`Tab` вне `Tabs`), лучше бросить понятную ошибку, чем упасть на `undefined.active` (задача 5).

### Реактивность: передавайте ref, а не значение

`provide` передаёт значение как есть — ссылку, без копирования и без обёртки:

- `provide('count', count.value)` передаёт число. Потомок получит `1` навсегда (задача 3);
- `provide('count', count)` передаёт ref: потомок видит обновления. Ref не разворачивается автоматически — в `<script setup>` нужен `.value`, в шаблоне верхнего уровня разворачивает `proxyRefs`;
- `provide('count', readonly(count))` — потомок видит обновления, но запись даёт «Set operation on key "value" failed: target is readonly» и не проходит.

Документация советует держать изменения внутри провайдера: наружу отдают `readonly(state)` и функции-мутаторы (`{ mode: readonly(mode), toggle }`). Тогда изменение состояния ищется в одном месте, как при однонаправленном потоке props.

### `InjectionKey` и типизация

Строковый ключ не типизирован и может совпасть с чужим: `inject<string>('theme')` — это просто утверждение программиста. `InjectionKey<T>` — тип `Symbol` с привязанным `T`:

```ts
// theme.ts — keys live in a dedicated module
export interface Theme { mode: Readonly<Ref<'light' | 'dark'>>; toggle(): void }
export const themeKey: InjectionKey<Theme> = Symbol('theme')
```

`provide(themeKey, { mode: 1 })` — ошибка типов, `inject(themeKey)` возвращает `Theme | undefined`, а с дефолтом — `Theme`. Два `Symbol('theme')` — разные ключи, поэтому библиотеки не конфликтуют. Третья перегрузка `inject(key, factory, true)` возвращает `T` из фабрики.

### Options API для сравнения

```js
export default {
  inject: { theme: { from: 'theme', default: 'light' } }, // or inject: ['theme']
  provide() {
    return { count: computed(() => this.count) } // provide() as a function to access `this`
  },
}
```

Инъекции разрешаются **раньше** собственного состояния, поэтому доступны в `data()`. Объектная форма `provide: { … }` не видит `this`, а `provide() { return { count: this.count } }` передаёт снимок значения — та же ловушка, что с `.value`. С 3.3 `computed`, переданный через `provide`, в Options API разворачивается автоматически (`app.config.unwrapInjectedRef` удалён в 3.4).

### Когда inject, а когда стор

Inject — **неявная** связь: по объявлению компонента не видно, что ему нужен провайдер, а тесту придётся этого провайдера смонтировать. Он хорош там, где связь и есть суть:

- составные компоненты (`Tabs`/`Tab`, `Form`/`Field`): контекст живёт ровно в поддереве, и у каждого экземпляра `Tabs` он свой — стор этого не даёт ([пример](../live-coding/ui-components.md));
- зависимости приложения от плагинов: роутер, i18n, клиент API — по сути DI-контейнер;
- конфигурация поддерева: тема, размер, `disabled` для формы.

Глобальное состояние приложения (пользователь, корзина) — задача стора: у него есть devtools, SSR-сериализация и доступ вне дерева компонентов. Pinia сама построена на `app.provide` и `inject`.

## Примеры

### Карточка с условными обёртками

```vue
<!-- Card.vue -->
<script setup lang="ts">
defineSlots<{ default(): any; header?(): any; footer?(props: { close: () => void }): any }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <article class="card">
    <header v-if="$slots.header" class="card__header"><slot name="header" /></header>
    <div class="card__body"><slot /></div>
    <footer v-if="$slots.footer" class="card__footer">
      <slot name="footer" :close="() => emit('close')" />
    </footer>
  </article>
</template>
```

```vue
<!-- usage: conditional slot is declared with v-if on <template> -->
<Card @close="open = false">
  <template #header>Order #{{ order.id }}</template>
  {{ order.summary }}
  <template v-if="canEdit" #footer="{ close }">
    <button @click="save().then(close)">Save</button>
  </template>
</Card>
```

## Вопросы с интервью

::: details Почему scoped slot называют функцией и что это даёт
Компилятор превращает содержимое слота в функцию `withCtx((slotProps) => vnodes)` в объекте слотов vnode ребёнка, а `<slot :item>` в ребёнке — в вызов `renderSlot($slots, 'name', { item }, fallback)`. Значит: слот ленив — ребёнок может его не вызвать, и выражения внутри не выполнятся; данные ребёнка приходят аргументами, а данные родителя — через замыкание; зависимости, прочитанные в слоте, отслеживает рендер ребёнка, поэтому изменение, видимое только в слоте, перерисует ребёнка без родителя. Отсюда и запрет вызывать `slots.default()` в `setup`: вызов вне рендера не отслеживается.
:::

::: details Какую область видимости видит содержимое слота
Родителя: содержимое определено в его шаблоне, и компилятор переписывает идентификаторы в `_ctx` родителя. Данные ребёнка доступны только как slot props. `withCtx` дополнительно восстанавливает экземпляр родителя на время вызова, поэтому scoped-стили родителя применяются к разметке слота, а компоненты разрешаются из регистрации родителя.
:::

::: details Что такое динамические слоты и почему они дороже
Слоты, набор которых зависит от данных: `v-if` или `v-for` на `<template #…>`, вычисляемое имя `#[name]`. Компилятор собирает их через `createSlots` с флагом `DYNAMIC` и ставит vnode `DYNAMIC_SLOTS`. Для стабильных слотов ребёнок может пропустить обновление, если props не изменились, — содержимое слотов он перерисует сам по своим зависимостям. С динамическими слотами рантайм не может доказать, что ничего не изменилось, и ребёнок перерисовывается при каждом рендере родителя.
:::

::: details Как отрисовать обёртку только при наличии слота и в чём подвох
`v-if="$slots.header"` на обёртке. Это проверка наличия функции слота, а не содержимого: слот, внутри которого всё скрыто `v-if`, существует, обёртка рисуется, а `renderSlot` видит одни комментарии и показывает fallback. Условный слот объявляют `v-if` на самом `<template #header>` — тогда функции нет. Проверять «пустоту» вызовом `slots.header()` в `setup` нельзя: вызов вне рендера не отслеживается.
:::

::: details Как работают provide и inject внутри
У экземпляра есть `provides`, по умолчанию общий с родителем. Первый `provide` создаёт `Object.create(parent.provides)`, так что получается цепочка прототипов вдоль дерева: ближайший провайдер затеняет верхних только в своём поддереве. `inject` ищет ключ оператором `in` в `parent.provides` до `app._context.provides`, поэтому компонент не видит собственный `provide`. Оба вызова опираются на `currentInstance` и работают только синхронно в `setup`; вне компонента — через `app.runWithContext`.
:::

::: details Почему значение из inject не обновляется и как передавать реактивные данные
`provide` передаёт значение как есть. `provide('count', count.value)` отдаёт число — снимок. Нужно передать сам ref или reactive-объект, а чтобы потомки не меняли его в обход владельца — `readonly(count)` плюс функции-мутаторы. Ref при инъекции не разворачивается: в коде нужен `.value`. В Options API та же ловушка у `provide() { return { x: this.x } }` — передают `computed(() => this.x)`.
:::

::: details Зачем InjectionKey и как типизировать inject
`InjectionKey<T>` — символ с привязанным типом: `provide` проверяет форму значения, `inject` возвращает `T | undefined`, с дефолтом — `T`. Символ уникален, поэтому ключи библиотек не конфликтуют, в отличие от строк. Ключи кладут в отдельный модуль. Обычно поверх пишут пару `provideX`/`useX`, где `useX` бросает понятную ошибку, если провайдера нет.
:::

::: details Когда выбрать provide/inject, а когда стор
Inject — неявная зависимость: по сигнатуре компонента её не видно, в тестах нужен провайдер. Он уместен для контекста поддерева — составные компоненты, где у каждого экземпляра свой контекст, конфигурация формы или темы — и для DI зависимостей от плагинов (`app.provide`). Глобальное состояние приложения отдают стору: devtools, SSR-гидрация состояния, доступ вне компонентов. Pinia, кстати, сама инжектится через `app.provide`.
:::

## Задачи

### 1. Что перерисуется · легко

```vue
<!-- Child.vue -->
<template><div>{{ log('child') }}<slot :n="1" /></div></template>

<!-- Parent.vue -->
<template>
  {{ log('parent') }}
  <Child v-slot="{ n }">{{ n }} {{ msg }}</Child>
</template>
```

`log` пишет имя в массив и возвращает пустую строку. После монтирования массив очищают и делают `msg.value = 'b'`. Что окажется в массиве после `nextTick`?

::: details Решение и разбор
`['child']`. `msg` читается только внутри функции слота, а её вызывает `renderSlot` в рендере ребёнка: зависимость попала в render-эффект `Child`. Рендер родителя `msg` не читал, поэтому его эффект не запускался. Слоты стабильные (`_: 1`), так что и ребёнка никто не трогал «сверху» — он обновился по собственной подписке.

Если бы родитель где-то ещё вывел <code v-pre>{{ msg }}</code>, перерисовались бы оба: родитель — из-за своей зависимости, ребёнок — из-за своей. Обе задачи попадают в одну очередь планировщика, и ребёнок рендерится один раз.
:::

### 2. Пустой футер · средне

```vue
<!-- Card.vue -->
<template>
  <footer v-if="$slots.footer">[<slot name="footer">Close</slot>]</footer>
  <p v-else>no footer</p>
</template>

<!-- usage, canEdit = false -->
<Card>
  <template #footer><button v-if="canEdit">Edit</button></template>
</Card>
```

Что будет отрисовано? Как сделать, чтобы футера не было?

::: details Решение и разбор
`<footer>[Close]</footer>`. Слот `footer` объявлен статически, поэтому `$slots.footer` — функция, и `v-if` пропускает обёртку. Функция возвращает только комментарий `<!--v-if-->`, а `renderSlot` через `ensureValidVNode` считает такой результат пустым и показывает fallback «Close». В итоге получились и лишний футер, и кнопка, которую никто не просил.

Исправление — объявлять условный слот целиком:

```vue
<template v-if="canEdit" #footer><button>Edit</button></template>
```

Теперь слот создаётся через `createSlots` и при `canEdit = false` отсутствует: рендерится `<p>no footer</p>` (проверено). Цена — слоты становятся динамическими.
:::

### 3. Найдите баг: счётчик не обновляется · легко

```vue
<!-- CartProvider.vue -->
<script setup>
import { provide, ref } from 'vue'
const count = ref(0)
provide('cartCount', count.value)
defineExpose({ add: () => count.value++ })
</script>
<template><slot /></template>

<!-- CartBadge.vue -->
<script setup>
import { inject } from 'vue'
const count = inject('cartCount')
</script>
<template><span>{{ count }}</span></template>
```

::: details Решение и разбор
`provide` получил число `0`, а не ref. Значение передаётся как есть, без обёртки, поэтому бейдж навсегда показывает `0` (проверено: после изменения ref потомок показывал прежнее значение).

```js
import { provide, readonly, ref } from 'vue'
import { cartKey } from './keys' // InjectionKey<{ count: Readonly<Ref<number>>; add(): void }>

const count = ref(0)
const add = () => count.value++
provide(cartKey, { count: readonly(count), add })
```

Ref передан целиком, `readonly` не даёт бейджу менять счётчик в обход `add`, а символьный ключ даёт тип и исключает коллизии. В бейдже `const { count } = inject(cartKey)` — шаблон развернёт ref на верхнем уровне.
:::

### 4. Найдите баг: обёртка не обновляет содержимое · средне

```js
// Highlight.js
import { h } from 'vue'

export default {
  setup(_, { slots }) {
    const content = slots.default()
    return () => h('mark', content)
  },
}
```

```vue
<Highlight>{{ query }}</Highlight>
```

Сначала выводится начальный `query`, но при вводе текст внутри `<mark>` не меняется. Почему?

::: details Решение и разбор
Слот вызван один раз в `setup`, вне render-эффекта. Чтение `query` внутри слота не привязалось ни к одному эффекту, а рендер `Highlight` возвращает те же самые VNode. Родитель `query` в своём рендере не читает (только внутри слота), а слоты стабильные, поэтому и сверху обновления не приходит. Предупреждения нет: для скомпилированных слотов Vue его не выдаёт (проверено: после изменения ref в DOM осталось старое значение).

```js
export default {
  setup(_, { slots }) {
    return () => h('mark', slots.default?.())
  },
}
```

Слот вызывается в рендере: зависимости отслеживаются, `?.` защищает от отсутствующего слота. Правило общее: всё, что зависит от слотов, — только в render-функции или шаблоне.
:::

### 5. Реализуйте `createContext` для составных компонентов · сложно

Напишите `createContext(name)`, который возвращает пару `[injectContext, provideContext]`:

- `provideContext(value)` провайдит значение и возвращает его;
- `injectContext()` возвращает значение или бросает ошибку с именем провайдера, если его нет;
- `injectContext(fallback)` возвращает `fallback` вместо ошибки;
- явно запровайженный `undefined` или `null` — это значение, а не «нет провайдера»;
- типы: `createContext<TabsContext>('Tabs')`.

::: details Решение и разбор
```ts
import { inject, provide, type InjectionKey } from 'vue'

export function createContext<T>(name: string) {
  const key: InjectionKey<T> = Symbol(name)
  const NONE = Symbol('none')

  function provideContext(value: T): T {
    provide(key, value)
    return value
  }

  function injectContext(): T
  function injectContext<F>(fallback: F): T | F
  function injectContext(...args: unknown[]) {
    const value = inject(key, NONE as T) // a default suppresses the "not found" warning
    if (value !== NONE) return value
    if (args.length) return args[0]
    throw new Error(`Injection "${name}" not found: the component must be used inside <${name}>`)
  }

  return [injectContext, provideContext] as const
}

// usage
interface TabsContext { active: Readonly<Ref<string>>; select(v: string): void }
export const [injectTabs, provideTabs] = createContext<TabsContext>('Tabs')
```

Разбор:

- **Сторож вместо `undefined`.** `inject(key)` без дефолта не отличит «не найдено» от запровайженного `undefined` и выдаст предупреждение. Уникальный `NONE` как дефолт решает обе проблемы: `inject` вернёт его, только если ключа нет в цепочке `provides`.
- **Наличие аргумента** проверяется через `args.length`, а не `fallback !== undefined`, иначе `injectContext(undefined)` бросал бы ошибку.
- **Ключ на каждый вызов `createContext`.** Два контекста с одинаковым именем не конфликтуют, а вложенные `Tabs` работают: внутренний провайдер затеняет внешний для своего поддерева.
- **Синхронность.** Обе функции вызываются в `setup` — это требование `provide`/`inject`, обёртка его не снимает.

Проверено: `Tab` внутри `Tabs` переключает вкладку, `Tab` без `Tabs` бросает ошибку (её ловит `app.config.errorHandler`), `injectTabs(null)` возвращает `null`, запровайженный `undefined` возвращается как `undefined`. Такая же утилита есть в Reka UI.

Сложность: O(d) на `inject`, где d — глубина цепочки прототипов `provides` (в ней только компоненты, которые что-то провайдят).
:::

## Источники

- [Vue.js: Slots](https://vuejs.org/guide/components/slots.html)
- [Vue.js: Provide / Inject](https://vuejs.org/guide/components/provide-inject.html)
- [Vue.js: Composition API — Dependency Injection (`provide`, `inject`, `hasInjectionContext`)](https://vuejs.org/api/composition-api-dependency-injection.html)
- [Vue.js: `<script setup>` — `defineSlots()`, `useSlots()`](https://vuejs.org/api/sfc-script-setup.html#defineslots)
- [Vue.js: Application API — `app.provide()`, `app.runWithContext()`](https://vuejs.org/api/application.html)
- [Vue.js: Options API — `provide`, `inject`](https://vuejs.org/api/options-composition.html)
- [Vue.js: TypeScript with Composition API — typing provide / inject](https://vuejs.org/guide/typescript/composition-api.html#typing-provide-inject)
- [Vue 3 Migration Guide: Slots Unification](https://v3-migration.vuejs.org/breaking-changes/slots-unification.html)
- [Исходники Vue 3.5.45: `runtime-core/src/apiInject.ts`, `componentSlots.ts`, `helpers/renderSlot.ts`, `helpers/createSlots.ts`](https://github.com/vuejs/core/tree/v3.5.45/packages/runtime-core/src)
- [Исходники Vue 3.5.45: `compiler-core/src/transforms/vSlot.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/compiler-core/src/transforms/vSlot.ts)
- [`vuejs/core` CHANGELOG.md, ветка `minor` (3.6, #13573 в 3.6.0-beta.11)](https://github.com/vuejs/core/blob/minor/CHANGELOG.md)
