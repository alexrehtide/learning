---
title: Props, emits и `v-model` на компонентах
level: ядро
---

# Props, emits и `v-model` на компонентах

> **Коротко.** Props передают данные сверху вниз, события сообщают об изменениях снизу вверх. Владелец данных один, и меняет их только он. `emit('change')` — синхронный вызов функции `onChange` из props родителя, а не DOM-событие, поэтому событие не всплывает. `v-model` на компоненте — сахар компилятора: prop `modelValue` плюс слушатель `onUpdate:modelValue`. `defineModel` прячет эту пару за ref и работает как локальное состояние, если родитель не передал и значение, и слушатель. Деструктуризация props в 3.5 реактивна, потому что компилятор переписывает каждое обращение в `__props.x`. Всё, что не объявлено как prop или событие, становится fallthrough-атрибутом корневого элемента.

**Связанные темы:** [Компоненты и шаблоны](./components-and-templates.md), [Реактивность: `ref`, `reactive`, `computed`](./reactivity.md), [`watch` и `watchEffect`](./watchers.md), [Директивы](./directives.md), [Жизненный цикл](./lifecycle.md), [UI-coding: базовые компоненты на Vue](../live-coding/ui-components.md), [События](../browser/events.md), [Современный синтаксис](../javascript/modern-syntax.md), [Слоты и provide/inject](./slots-and-provide-inject.md)

## Теория

Все проверки выполнены на Vue 3.5.45 в Node 26.13.1. Вывод компилятора получен через `@vue/compiler-sfc`, поведение проверено запуском с happy-dom, prod — с `NODE_ENV=production`. Те же сценарии повторены на `3.6.0-rc.16` и дали тот же вывод.

### Однонаправленный поток данных

Props — входы компонента. Когда родитель перерисовывается, рантайм заново вычисляет props ребёнка (`updateProps` в `runtime-core/src/componentProps.ts`) и перезаписывает их. Поэтому у значения должен быть один владелец: если бы ребёнок мог менять prop, при следующем рендере родителя его запись бы исчезла, а откуда пришло значение, по коду не понять.

Что происходит при попытке записи (проверено):

- **dev:** `setup()` получает `shallowReadonly(props)`. `props.n = 99` даёт предупреждение «Set operation on key "n" failed: target is readonly», значение не меняется;
- **prod:** обёртки `shallowReadonly` нет. Запись **проходит**: ребёнок перерисовывается с `99`, а при следующем рендере родителя значение молча возвращается к родительскому. Баг виден только в prod и только иногда;
- **вложенный объект:** `props.user.name = 'Bob'` работает в обоих режимах. `readonly` поверхностный, а `user` — реактивный объект родителя, поэтому меняется состояние родителя. Документация называет это антипаттерном: поток данных становится неявным.

Правильный путь — событие: ребёнок сообщает «хочу другое значение», владелец решает. Если ребёнку нужна локальная копия для редактирования, её заводят явно: `const draft = ref(props.initial)` (начальное значение, дальше не синхронизируется) или `computed(() => props.size.trim())` (производное значение).

### Объявление props: runtime и через типы

Runtime-объявление — объект, который рантайм использует для нормализации и проверки:

```js
defineProps({
  id: { type: Number, required: true },
  size: { type: String, default: 'm', validator: (v) => ['s', 'm', 'l'].includes(v) },
  items: { type: Array, default: () => [] }, // objects and arrays need a factory
})
```

Объявление через типы компилятор переводит в такой же объект. Из `defineProps<{ label: string; items?: string[]; v?: string | boolean }>()` в dev получается `label: { type: String, required: true }`, `items: { type: Array, required: false }`, `v: { type: [String, Boolean], required: false }`. В prod-сборке компилятор оставляет `type` **только для boolean-props** (`disabled: { type: Boolean }`), а `required` и остальные типы выбрасывает: проверки в prod не работают, а приведение boolean нужно и там. Типы компилятор разбирает статически. Импортированные интерфейсы поддерживаются с 3.3, а условный тип даёт ошибку сборки «Unresolvable type: TSConditionalType». Смешать оба способа нельзя: «defineProps() cannot accept both type and non-type arguments at the same time».

**Валидация** работает только в dev и только предупреждает: «Invalid prop: type check failed for prop "id". Expected Number with value 1, got String with value "1"», «Missing required prop», «custom validator check failed». Значение всё равно передаётся.

**Boolean casting.** Для prop с типом `Boolean` рантайм приводит значение (`resolvePropValue`):

- атрибута нет → `false` (а не `undefined`, как у остальных типов);
- `<C disabled />` компилируется в `disabled: ""` → `true`;
- при типе `[String, Boolean]` пустая строка остаётся строкой: `String` стоит первым. При `[Boolean, String]` пустая строка становится `true` (проверено, см. задачу 1).

Имена: в шаблоне `foo-bar="1"` попадает в prop `fooBar`. Рантайм нормализует kebab-case в camelCase.

### Reactive Props Destructure (3.5)

```vue
<script setup lang="ts">
const { count = 0, label, items = [] } = defineProps<{ count?: number; label: string; items?: string[] }>()
const double = computed(() => count * 2)
watch(() => count, (v) => console.log(v))
</script>
```

Деструктуризации в рантайме нет. Компилятор её удаляет, переписывает каждое обращение к `count` в `__props.count`, а значения по умолчанию переносит в опции props (вывод сокращён):

```js
props: {
  count: { type: Number, required: false, default: 0 },
  label: { type: String, required: true },
  items: { type: Array, required: false, default: () => ([]) },
},
setup(__props) {
  const double = computed(() => __props.count * 2)
  watch(() => __props.count, (v) => console.log(v))
```

Отсюда три следствия:

- **`withDefaults` не нужен.** Дефолт пишется как в JS, а `items = []` компилятор сам оборачивает в фабрику `() => ([])`. Фабрику в дефолте деструктуризации писать нельзя: `items = () => []` для `string[]` — ошибка «Default value of prop "items" does not match declared type».
- **Реактивность держится на месте обращения.** `computed(() => count * 2)` реактивен, потому что читает `__props.count` внутри геттера.
- **Передать «prop» в функцию нельзя, передаётся значение.** `watch(count, …)` и `toRef(count)` компилятор ловит: «"count" is a destructured prop and should not be passed directly to watch(). Pass a getter () => count instead». Но `useUser(id)` в любой composable компилируется в `useUser(__props.id)` без ошибки: функция получает число и не узнает о смене `id`. Правильно — `useUser(() => id)` и `toValue(id)` внутри composable ([подробнее о геттерах в `watch`](./watchers.md)).

Без деструктуризации работает классика: `props.count`, геттер `() => props.count`, дефолты через `withDefaults(defineProps<…>(), { items: () => [] })`, где фабрика для объектов и массивов обязательна.

### События: `defineEmits` и почему они не всплывают

```ts
const emit = defineEmits<{
  change: [id: number]          // 3.3+: named tuple per event
  'update:title': [value: string]
}>()
```

Компилятор превращает это в `emits: ["change", "update:title"]` и передаёт `emit` из контекста `setup`. Runtime-форма с валидаторами — `defineEmits({ submit: (p) => !!p.email, close: null })`. Валидатор, как и у props, в dev только предупреждает: «Invalid event arguments: event validation failed for event "submit"», а обработчик всё равно вызывается.

Как работает `emit('change', 1)` (`runtime-core/src/componentEmits.ts`): рантайм ищет в **vnode props** ребёнка ключ `onChange` (а также варианты имени в kebab-case и camelCase) и синхронно вызывает его с аргументами. Родительский `@change="fn"` в шаблоне — это и есть prop `onChange: fn`. Отсюда свойства:

- **Синхронно.** Обработчик родителя выполняется до следующей строки после `emit`. Возвращаемое значение обработчика теряется: `emit` возвращает `undefined`.
- **Не всплывает.** Нет дерева, по которому идти: событие получает только тот, кто передал `onChange` этому vnode. Дедушка, слушающий `@change` на другом компоненте, ничего не получит. Для глубокой передачи — `provide`/`inject`, стор или явная проброска.
- **Но может «пролететь» через обёртку.** Если промежуточный компонент `Wrapper` не объявил `change` и рендерит один корень, `onChange` у него — fallthrough-атрибут. Он уходит на корень, то есть на внутренний компонент, и сработает. Это не всплытие, а проброс атрибутов (проверено, см. задачу 3).
- **Объявлять события нужно.** Необъявленное событие в dev работает, но с предупреждением «Component emitted event "other" but it is neither declared in the emits option nor as an "onOther" prop». Главное же: слушатель объявленного события **не попадает в `$attrs`**. Компонент, который объявил `click`, перестаёт пробрасывать нативный клик на корень (проверено: обработчик не вызвался). Без объявления `@click` на компоненте вешается на корневой элемент как DOM-слушатель ([подробнее о DOM-событиях](../browser/events.md)).

### `v-model` на компоненте

Для `<Child v-model="text" />` компилятор генерирует (вывод сокращён):

```js
_createVNode(Child, {
  modelValue: text.value,
  "onUpdate:modelValue": _cache[0] || (_cache[0] = $event => ((text).value = $event))
}, null, 8 /* PROPS */, ["modelValue"])
```

На нативном `<input>` `v-model` — директива с `withDirectives` ([подробнее](./directives.md)). На компоненте директивы нет вовсе: это обычный prop и обычный слушатель. Обработчик кэшируется в `_cache`, поэтому при перерисовке родителя ребёнок не получает «новую функцию». В patch flag попадает только `modelValue`.

- **Несколько `v-model`:** `v-model:title="title"` даёт пару `title` + `onUpdate:title`. В Vue 2 был один `v-model` с `value`/`input` и модификатор `.sync`. Во Vue 3 `.sync` удалён и заменён аргументом `v-model`.
- **Модификаторы:** `v-model.trim="text"` добавляет prop `modelModifiers: { trim: true }`, а для `v-model:title.capitalize` — `titleModifiers: { capitalize: true }`. Встроенные `.trim` и `.number` применяет сам `emit`: при `emit('update:modelValue', '  hi  ')` родитель получает `'hi'`, а `'42'` с `.number` — число `42`. Пользовательские модификаторы компонент читает сам.
- **Выражение должно быть присваиваемым:** `v-model="form.name"` разворачивается в `$event => (form.value.name = $event)`. Цепочка `form.name` здесь меняет объект родителя, но делает это код родителя, а не ребёнок.

### `defineModel` (3.4) и `useModel`

```vue
<script setup lang="ts">
const model = defineModel<string>()
const [title, mods] = defineModel<string>('title', {
  required: true,
  set: (v) => (mods.capitalize ? v.charAt(0).toUpperCase() + v.slice(1) : v),
})
</script>
```

Компилятор объявляет пару prop/событие за вас и вызывает рантайм-функцию `useModel`:

```js
props: {
  "modelValue": { type: String },
  "modelModifiers": {},
  "title": { type: String, ...{ required: true, } },
  "titleModifiers": {},
},
emits: ["update:modelValue", "update:title"],
setup(__props) {
  const model = _useModel(__props, "modelValue")
  const [title, mods] = _useModel(__props, 'title', { set(v) { /* … */ } })
```

`useModel` (`runtime-core/src/helpers/useModel.ts`) — `customRef` с локальным значением:

- `watchSyncEffect` копирует prop в локальное значение при каждом изменении prop;
- `get` отдаёт локальное значение, пропущенное через опциональный `get`;
- `set` пропускает значение через `set` (так работают модификаторы), не делает ничего при неизменном значении и проверяет **vnode props**. Если родитель передал и prop, и слушатель `onUpdate:*`, локальное значение не трогается, и компонент ждёт новый prop. Иначе локальное значение обновляется сразу. Событие `update:*` эмитится в обоих случаях.

Отсюда поведение, проверенное запуском:

| Что передал родитель | Запись `model.value = 'child'` |
| --- | --- |
| ничего | локальное состояние: ребёнок показывает `child` (неконтролируемый режим) |
| `v-model` | эмит, родитель обновил ref, ребёнок показывает новое значение **после** перерисовки родителя |
| `:model-value="'fixed'"` без слушателя | локальное значение `child`: ребёнок разошёлся с родителем, тот ничего не узнал |

Сразу после записи в контролируемом режиме `model.value` ещё старое: новое придёт только с новыми props. Поэтому `count.value++; count.value++` даёт родителю `11, 11`, а не `12` (задача 4).

Ловушки `defineModel` (оба режима в виджетах UI-kit — в [«UI-coding: базовые компоненты на Vue»](../live-coding/ui-components.md)):

- **`default` и `v-model="ref()"`.** Родитель передал `undefined`, ребёнок применил `default: 1`: у ребёнка `1`, у родителя `undefined`, пока ребёнок не запишет значение. Для обязательной модели — `required: true`, `default` — только для неконтролируемого режима.
- **Мутация объекта модели.** `model.value.tags.push('a')` меняет массив родителя напрямую: события нет (проверено: 0 эмитов), слушатель `update:modelValue` не вызовется, а в неконтролируемом режиме это мутация чужого prop. Присваивайте новое значение: `model.value = { ...model.value, tags: [...model.value.tags, 'a'] }`.

### Fallthrough attributes

Всё, что родитель передал компоненту и что не объявлено как prop или событие, попадает в `attrs` и автоматически добавляется к **единственному корневому** элементу (`renderComponentRoot` в `componentRenderUtils.ts`). Проверено:

```text
parent:  <Btn class="big" :style="{ color: 'blue', margin: 0 }" id="outer" data-x="1" @click="…" />
Btn:     <button class="btn" :style="{ color: 'red' }" id="inner" @click="own">
result:  <button class="btn big" style="color: blue; margin: 0px;" id="outer" data-x="1">
```

- `class` и `style` **сливаются**, при конфликте свойств стиля побеждает родитель;
- остальные атрибуты **перезаписывают** свои: `id="outer"`;
- слушатели **объединяются**: вызываются оба, сначала свой;
- если корень — другой компонент, атрибуты идут дальше, к его корню.

Во Vue 3 `$attrs` включает `class`, `style` и слушатели (`$listeners` из Vue 2 удалён). Объявленные props и события в `$attrs` нет: при `props: ['fooBar']`, `emits: ['save']` и переданных `foo-bar`, `onSave`, `onClose`, `data-id` в `attrs` остались `onClose` и `data-id`.

**Несколько корней.** Рантайм не знает, к какому корню отнести атрибуты, и не добавляет их никуда. В dev — предупреждение «Extraneous non-props attributes (class, id) were passed to component but could not be automatically inherited because component renders fragment or text or teleport root nodes». Решение — явный `v-bind="$attrs"` на нужном элементе: предупреждение пропадает.

**`inheritAttrs: false`** (`defineOptions({ inheritAttrs: false })`) отключает автоматическое добавление к корню. Типичный случай — обёртка поля: корень `<label>`, а `placeholder`, `autocomplete`, `aria-*` и слушатели должны попасть на `<input v-bind="$attrs">`. Иначе компонент нельзя подставить вместо нативного `<input>` (LSP в терминах [принципов проектирования](../architecture/principles-and-patterns.md)).

**Реактивность `attrs`.** Документация: объект `attrs` всегда актуален, но не реактивен, наблюдать его через `watch` нельзя, используйте `onUpdated`. В 3.5.45 на деле `watch(() => attrs.title)` срабатывает: прокси `attrs` в контексте `setup` подписывает эффект, а `updateProps` вызывает `trigger` при изменении атрибутов (проверено в dev и prod). Опираться на это поведение не стоит: оно не входит в документированный контракт. Если значение нужно наблюдать, объявите его prop.

> [!NOTE]
> Во Vue 3.6 (RC, `3.6.0-rc.16`, сверено 2026-11-21) публичный API props, emits, `defineModel` и fallthrough-атрибутов не меняется: все сценарии темы на 3.6 дали тот же вывод. В CHANGELOG ветки `minor` много исправлений fallthrough и props в `runtime-vapor`: Vapor Mode реализует ту же семантику своим рантаймом («align attrs fallthrough semantics with vdom»). Стабильного 3.6 пока нет.

**Options API для сравнения:** опции `props` и `emits`, `this.$emit('change', 1)`, `this.$attrs`. Компонентный `v-model` там — `props: ['modelValue']` и `emits: ['update:modelValue']` вручную, часто через `computed` с `get`/`set`. До 3.4 так же писали и в Composition API.

## Примеры

### Поле ввода, которое можно подставить вместо `<input>`

```vue
<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const { label, error } = defineProps<{ label: string; error?: string }>()
const model = defineModel<string>({ required: true })
const id = useId()
</script>

<template>
  <div class="field">
    <label :for="id">{{ label }}</label>
    <!-- placeholder, autocomplete, aria-*, @blur from the parent land here -->
    <input :id="id" v-model="model" v-bind="$attrs" :aria-invalid="!!error" />
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
```

Использование: `<BaseInput v-model.trim="email" label="Email" autocomplete="email" @blur="validate" />`. `.trim` применится в `emit` до родителя. `autocomplete` и `@blur` уйдут на `<input>`, а не на `<div>`. `class` от родителя тоже уйдёт на `<input>`: при `inheritAttrs: false` его надо пробрасывать вручную, если нужен на обёртке.

## Вопросы с интервью

::: details Почему ребёнок не должен менять props и что будет, если поменять
У значения один владелец — родитель. При каждом его рендере props ребёнка вычисляются заново, поэтому запись ребёнка будет перезаписана, а поток данных станет неявным. В dev `setup()` получает `shallowReadonly(props)`: запись не проходит и даёт предупреждение. В prod обёртки нет: запись проходит и живёт до следующего рендера родителя — баг, который проявляется только в prod. Вложенный объект `readonly` не защищает: `props.user.name = …` меняет реактивное состояние родителя. Правильно — событие или `defineModel`, а для редактирования — явная локальная копия.
:::

::: details Как работает деструктуризация props в Vue 3.5
Это преобразование компилятора, а не рантайма. `const { count = 0 } = defineProps()` удаляется, каждое обращение к `count` переписывается в `__props.count`, дефолт переносится в опцию `default` (для массивов и объектов компилятор сам делает фабрику). Поэтому `computed(() => count * 2)` реактивен: в геттере читается свойство реактивного объекта. Ограничение: передать «переменную» в функцию нельзя, передаётся значение. `watch(count)` и `toRef(count)` компилятор ловит с подсказкой «Pass a getter () => count instead», а `useUser(id)` — нет: composable получит число. Решение — `() => id` и `toValue` внутри composable.
:::

::: details Чем объявление props через типы отличается от runtime-объявления
Компилятор генерирует из типа тот же runtime-объект: `type` и `required`. Ограничения: тип разбирается статически, сложные типы (условные, вычисляемые) дают «Unresolvable type», а импортированные поддерживаются с 3.3. Совмещать тип и объект в одном `defineProps` нельзя. Дефолты — через деструктуризацию или `withDefaults`. Валидаторы есть только в runtime-форме. В prod-сборке компилятор выбрасывает типы, кроме `Boolean`: проверки там всё равно не работают, а приведение boolean-props нужно и в prod. Атрибут `<C disabled />` даёт `true`, отсутствующий — `false`.
:::

::: details Во что разворачивается v-model на компоненте
В prop `modelValue` и слушатель `onUpdate:modelValue`, который присваивает `$event` выражению. С аргументом `v-model:title` — `title` и `onUpdate:title`, поэтому их может быть несколько (замена `.sync` из Vue 2). Модификаторы передаются prop'ом `modelModifiers` или `titleModifiers`. `.trim` и `.number` применяет сам `emit` перед вызовом слушателя, пользовательские компонент читает сам. Никакой директивы на компоненте нет, в отличие от `<input>`, где `v-model` — `vModelText` с хуками.
:::

::: details Как устроен defineModel и когда он ведёт себя как локальное состояние
Макрос объявляет prop, prop модификаторов и событие `update:*` и вызывает `useModel`. Тот возвращает `customRef`: `watchSyncEffect` копирует prop в локальное значение, `set` эмитит событие. Локальное значение при записи обновляется сразу, только если родитель не передал одновременно prop и слушатель. Значит, без `v-model` компонент работает сам по себе, а с `v-model` ждёт, пока родитель перерисуется с новым значением. Ловушки: `default` при `undefined` у родителя даёт рассинхрон, мутация объекта модели обходит событие, а сразу после записи в контролируемом режиме `model.value` ещё старое.
:::

::: details Всплывают ли события компонентов
Нет. `emit('x')` ищет в vnode props ребёнка функцию `onX` и синхронно её вызывает. Дерева для всплытия нет, и `stopPropagation` не имеет смысла. Исключение только кажущееся: если промежуточный однокорневой компонент не объявил событие, `onX` у него — fallthrough-атрибут, и он уходит на внутренний компонент. Поэтому слушатель «через уровень» иногда срабатывает, а после добавления `emits` в обёртку перестаёт. Для передачи вглубь — явная проброска, `provide`/`inject` или стор.
:::

::: details Что такое fallthrough attributes и когда нужен inheritAttrs false
Это всё, что передано компоненту, но не объявлено в `props` и `emits`: `class`, `style`, `id`, `aria-*`, необъявленные слушатели. При одном корне они добавляются к нему: `class` и `style` сливаются, слушатели объединяются, остальное перезаписывается значением родителя. При нескольких корнях — никуда, с предупреждением в dev, нужен явный `v-bind="$attrs"`. `inheritAttrs: false` отключает автоматическое добавление: так обёртка поля отправляет атрибуты на `<input>`, а не на корневой `<label>`. Отсюда же причина объявлять события: объявленный `click` не попадает в `$attrs`, и родитель перестаёт получать нативный клик по корню.
:::

## Задачи

### 1. Что выведет · легко

```vue
<!-- Tag.vue -->
<script setup>
const props = defineProps({
  disabled: Boolean,
  label: [String, Boolean],
  icon: [Boolean, String],
  size: String,
  loading: Boolean,
})
console.log(JSON.stringify(props))
</script>

<!-- Parent.vue -->
<template><Tag disabled label icon size="" /></template>
```

::: details Решение и разбор
```
{"size":"","disabled":true,"label":"","icon":true,"loading":false}
```

- Атрибут без значения компилятор передаёт как пустую строку: `disabled: ""`.
- `disabled: Boolean` — пустая строка превращается в `true`. `size: String` — пустая строка как есть.
- `label: [String, Boolean]` — `String` стоит раньше `Boolean`, поэтому пустая строка остаётся строкой. `icon: [Boolean, String]` — наоборот, `true`.
- `loading` не передан, но тип `Boolean`, поэтому `false`, а не `undefined`. Это приведение работает и в prod: компилятор сохраняет `type: Boolean` даже там, где выбрасывает остальные типы.
:::

### 2. Найдите баг · легко

После перехода со страницы `/users/1` на `/users/2` роутер переиспользует компонент, `id` обновляется в шаблоне, но данные остаются от первого пользователя.

```vue
<script setup>
import { useUser } from './useUser'

const { id } = defineProps({ id: Number })
const { user } = useUser(id)
</script>

<template><h1>{{ id }}: {{ user?.name }}</h1></template>
```

```js
// useUser.js
export function useUser(id) {
  const user = ref()
  watchEffect(async () => { user.value = await fetchUser(toValue(id)) })
  return { user }
}
```

::: details Решение и разбор
Компилятор переписывает вызов в `useUser(__props.id)`: composable получает число `1`, а не реактивный источник. `watchEffect` читает `toValue(1)`, у него нет зависимостей, и он больше не запускается. Шаблон при этом обновляется, потому что там `id` тоже стал `__props.id` и читается при каждом рендере. Проверено: после смены `id` на `2` получилось `2:user1`, эффект выполнился один раз.

Для `watch(id)` и `toRef(id)` компилятор выдал бы ошибку, но про произвольную функцию он не знает. Исправление — геттер:

```js
const { user } = useUser(() => id) // compiles to () => __props.id
```

`toValue` внутри composable вызывает геттер, и чтение `__props.id` попадает в зависимости эффекта. Вариант без деструктуризации — `useUser(() => props.id)` или `toRef(props, 'id')`. Гонку ответов при быстром переключении стоит закрыть отменой через `onWatcherCleanup` ([подробнее](./watchers.md)).
:::

### 3. Что выведет · средне

```js
const log = []
const Inner = { emits: ['pick'], setup: (_, { emit }) => () => h('button', { onClick: () => emit('pick', 'x') }) }
const Open = { setup: () => () => h(Inner) }
const Closed = { emits: ['pick'], setup: () => () => h(Inner) }

const el = document.createElement('div')
createApp({ setup: () => () => h('div', [
  h(Open, { onPick: (v) => log.push('open ' + v) }),
  h(Closed, { onPick: (v) => log.push('closed ' + v) }),
]) }).mount(el)
el.querySelectorAll('button').forEach((b) => b.click())
console.log(log)
```

::: details Решение и разбор
```
[ 'open x' ]
```

События не всплывают: `Inner` вызывает `onPick` только из собственных vnode props. Но `Open` не объявил `pick`, поэтому `onPick` для него — fallthrough-атрибут. У `Open` один корень, `Inner`, и атрибут уходит на него. В итоге `Inner` получает `onPick` от «дедушки», и вызов срабатывает.

`Closed` объявил `pick`: `onPick` стал слушателем самого `Closed`, в `$attrs` его нет, и до `Inner` он не доходит. `Inner` эмитит в пустоту. Чтобы `Closed` работал, нужна явная проброска: `h(Inner, { onPick: (v) => emit('pick', v) })`.

Вывод для интервью: «событие дошло через уровень» — это проброс атрибутов, и он ломается, как только обёртка объявляет `emits`, получает второй корень или `inheritAttrs: false`.
:::

### 4. Что выведет · средне

```vue
<!-- Counter.vue -->
<script setup>
const count = defineModel({ type: Number, default: 0 })
function add() {
  count.value++
  count.value++
}
defineExpose({ add })
</script>

<template><b>{{ count }}</b></template>
```

Родитель A: `<Counter ref="a" v-model="total" />`, где `total = ref(10)` и слушатель логирует каждое значение. Родитель B: `<Counter ref="b" />` без `v-model`. Оба вызывают `add()`, затем `await nextTick()`. Что покажут компоненты и что получит родитель A?

::: details Решение и разбор
```
A: <b>11</b>, события: [11, 11], total = 11
B: <b>2</b>
```

В A родитель передал и prop, и слушатель, поэтому `useModel` не трогает локальное значение при записи: только эмитит. Первый `count.value++` читает `10` и эмитит `11`. Родитель записывает `total.value = 11`, но перерисуется лишь в следующей микрозадаче, и prop ребёнка всё ещё `10`. Второй `++` снова читает `10` и снова эмитит `11`.

В B родителя нет, значение локальное, и каждая запись обновляет его сразу: `0 → 1 → 2`.

Исправления для контролируемого режима: считать от локальной переменной (`count.value += 2`) или эмитить одно итоговое значение. Общее правило: в контролируемом компоненте `model.value` после записи — это ещё значение родителя, а не ваше.
:::

### 5. Реализуйте `useModel` без макроса · сложно

Реализуйте `useLocalModel(props, name = 'modelValue')` для компонента с `props: ['modelValue']` и `emits: ['update:modelValue']`. Требования, как у `defineModel`:

- возвращает ref, который следует за prop;
- запись эмитит `update:<name>`;
- если родитель передал и prop, и слушатель, значение меняется только после нового prop (контролируемый режим), иначе сразу (неконтролируемый);
- запись того же значения ничего не делает.

```js
const Counter = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  setup(props, { expose }) {
    const model = useLocalModel(props)
    expose({ inc: () => { model.value = (model.value ?? 0) + 1 } })
    return () => h('b', String(model.value))
  },
}
// <Counter />                                  inc() twice → 2
// <Counter v-model="v" />, v = 10              inc() twice → 11, emits [11, 11]
// :model-value="5" + listener that ignores it  inc() twice → 5, emits [6, 6]
```

::: details Решение и разбор
```js
import { customRef, getCurrentInstance, watchSyncEffect } from 'vue'

export function useLocalModel(props, name = 'modelValue') {
  const instance = getCurrentInstance()
  let local
  return customRef((track, trigger) => {
    // follow the parent: copy the prop whenever it changes
    watchSyncEffect(() => {
      const value = props[name]
      if (!Object.is(value, local)) { local = value; trigger() }
    })
    return {
      get() { track(); return local },
      set(value) {
        if (Object.is(value, local)) return
        const raw = instance.vnode.props ?? {}
        const controlled = name in raw && `onUpdate:${name}` in raw
        if (!controlled) { local = value; trigger() }
        instance.emit(`update:${name}`, value)
      },
    }
  })
}
```

- `customRef` даёт ручное управление `track`/`trigger`: ref реактивен для шаблона, но значение хранится в замыкании.
- `watchSyncEffect`, как в исходнике Vue: новый prop копируется синхронно в момент `updateProps`, до рендера ребёнка, и сразу при создании, без `immediate`.
- Режим определяется по `instance.vnode.props` — тому, что родитель реально передал. По `props[name] !== undefined` различить «не передал» и «передал `undefined`» нельзя.
- В контролируемом режиме локальное значение не трогаем: родитель может отклонить или изменить значение, и ребёнок покажет то, что решил владелец.

Решение проверено запуском на всех трёх сценариях. Чего нет по сравнению с `useModel` во Vue: вариантов имени в kebab-case (`onUpdate:model-value`), модификаторов и опций `get`/`set`, проверки, что prop объявлен, и обработки граничного случая, когда два слушателя подряд меняют и возвращают значение до перерисовки родителя.
:::

## Источники

- [Vue.js: Props](https://vuejs.org/guide/components/props.html)
- [Vue.js: Component Events](https://vuejs.org/guide/components/events.html)
- [Vue.js: Component v-model](https://vuejs.org/guide/components/v-model.html)
- [Vue.js: Fallthrough Attributes](https://vuejs.org/guide/components/attrs.html)
- [Vue.js: `<script setup>` — `defineProps()`, `defineEmits()`, `defineModel()`](https://vuejs.org/api/sfc-script-setup.html)
- [Vue.js: Composition API — `useModel()`, `useAttrs()`](https://vuejs.org/api/composition-api-helpers.html)
- [Vue.js: Options API — `props`, `emits`, `inheritAttrs`](https://vuejs.org/api/options-state.html)
- [Vue 3 Migration Guide: `v-model`, `$listeners` removed, `$attrs` includes `class` & `style`](https://v3-migration.vuejs.org/breaking-changes/v-model.html)
- [Исходники Vue 3.5.45: `runtime-core/src/componentProps.ts`, `componentEmits.ts`, `componentRenderUtils.ts`, `helpers/useModel.ts`](https://github.com/vuejs/core/tree/v3.5.45/packages/runtime-core/src)
- [Исходники Vue 3.5.45: `compiler-sfc/src/script/definePropsDestructure.ts`, `defineModel.ts`](https://github.com/vuejs/core/tree/v3.5.45/packages/compiler-sfc/src/script)
- [Announcing Vue 3.5 (Reactive Props Destructure)](https://blog.vuejs.org/posts/vue-3-5)
- [Announcing Vue 3.4 (`defineModel` stable)](https://blog.vuejs.org/posts/vue-3-4)
- [`vuejs/core` CHANGELOG.md, ветка `minor` (3.6)](https://github.com/vuejs/core/blob/minor/CHANGELOG.md)
