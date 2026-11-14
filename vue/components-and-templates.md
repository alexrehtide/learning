---
title: Компоненты и шаблоны (Composition API vs Options API)
level: ядро
---

# Компоненты и шаблоны (Composition API vs Options API)

> **Коротко.** Компонент Vue — это объект опций с render-функцией. SFC (`.vue`-файл) — его исходник: на этапе сборки `@vue/compiler-sfc` превращает `<template>` в render-функцию, а `<script setup>` — в функцию `setup()`. В production шаблон встраивается прямо в замыкание `setup`, поэтому он обращается к локальным переменным без прокси, а снаружи компонент по умолчанию закрыт: родитель через ref видит только то, что открыто через `defineExpose`. Composition API группирует логику по смыслу, хорошо типизируется и переиспользуется через composables вместо mixins. Options API построен поверх него и уместен для простых компонентов и legacy-кода.

**Связанные темы:** [Функции и `this`](../javascript/functions-and-this.md), [Замыкания](../javascript/closures.md), [Модули: ESM и CommonJS](../javascript/modules.md), [Мини-реактивность в стиле Vue](../live-coding/mini-reactivity.md), [Производительность Vue и Nuxt](../performance/vue-performance.md), [XSS и безопасный вывод во Vue](../security/xss.md), [Content Security Policy](../security/csp.md), [UI-coding: базовые компоненты на Vue](../live-coding/ui-components.md)

## Теория

Все проверки в теме выполнены на Vue 3.5.45. Вывод компилятора получен через `@vue/compiler-sfc`, поведение проверено запуском `@vue/runtime-core` с минимальным рендерером без DOM в Node 26.13.1.

### Компонент — объект, SFC — его исходник

Рантайму нужен **объект опций** (`{ props, setup, render, … }`) или функция (функциональный компонент). Всё остальное — способы получить такой объект.

**SFC** (Single-File Component, однофайловый компонент) — файл `.vue` с блоками `<template>`, `<script>` и/или `<script setup>`, `<style>`. Сам браузер его не понимает. Плагин сборщика (`@vitejs/plugin-vue`) вызывает `@vue/compiler-sfc`: `parse` делит файл на блоки, `compileScript` собирает компонент из скрипта, `compileTemplate` превращает шаблон в render-функцию, `compileStyle` обрабатывает стили. На выходе получается обычный ES-модуль с `export default { … }`.

Шаблон можно скомпилировать и в браузере: опция `template: '<div>…</div>'` работает со сборкой `vue.esm-bundler.js`, в которую входит компилятор. Он собирает функцию через `new Function("Vue", code)`, поэтому такой код требует `'unsafe-eval'` в CSP ([подробнее](../security/csp.md)) и добавляет компилятор в бандл. Сборщики по умолчанию подключают runtime-only сборку: шаблоны в SFC уже скомпилированы.

### Что компилятор делает из шаблона

Компилятор видит шаблон целиком и передаёт рантайму то, что знает статически. Для компонента

```vue
<script setup>
import { ref } from 'vue'
import MyButton from './MyButton.vue'
const id = ref('main')
const count = ref(0)
function inc() { count.value++ }
</script>

<template>
  <div :id>
    <p>static text</p>
    <MyButton @click="inc">{{ count }}</MyButton>
    <OtherThing />
  </div>
</template>
```

в production-режиме получается (сокращено):

```js
const _hoisted_1 = ["id"]

export default {
  __name: 'a',
  setup(__props) {
    const id = ref('main')
    const count = ref(0)
    function inc() { count.value++ }

    return (_ctx, _cache) => {
      const _component_OtherThing = _resolveComponent("OtherThing")
      return (_openBlock(), _createElementBlock("div", { id: id.value }, [
        _cache[0] || (_cache[0] = _createElementVNode("p", null, "static text", -1 /* CACHED */)),
        _createVNode(MyButton, { onClick: inc }, { default: _withCtx(() => [
          _createTextVNode(_toDisplayString(count.value), 1 /* TEXT */)
        ]), _: 1 /* STABLE */ }),
        _createVNode(_component_OtherThing)
      ], 8 /* PROPS */, _hoisted_1))
    }
  }
}
```

Что здесь видно:

- `setup` **возвращает render-функцию**. Она — замыкание над `id`, `count`, `inc`, поэтому шаблон читает `count.value` напрямую, без прокси экземпляра и поиска по ключу.
- `:id` — сокращение (3.4+) для `:id="id"`. Для `:aria-label` берётся camelCase-имя: `"aria-label": _ctx.ariaLabel`.
- Статический `<p>` создаётся один раз и хранится в `_cache[0]` с флагом `CACHED`. Наверх модуля (`_hoisted_1`) вынесен только список динамических props `["id"]`: по нему и patch flag `8 /* PROPS */` рантайм сравнивает один атрибут, а не все.
- `MyButton` импортирован, и компилятор подставляет саму переменную. `OtherThing` не найден среди привязок, поэтому он ищется в runtime через `resolveComponent`.

Patch flags, блоки и кэширование подробно разобраны в [«Производительности Vue и Nuxt»](../performance/vue-performance.md#что-делает-компилятор).

### Синтаксис шаблона

- **Интерполяция** <code v-pre>{{ expr }}</code> превращается в `toDisplayString(expr)` и попадает в DOM как текст. HTML в ней не исполняется. `v-html` пишет в `innerHTML` и требует доверенной или очищенной строки ([XSS](../security/xss.md)).
- **`v-bind`** (сокращение `:`) связывает атрибут или prop с выражением. `v-bind="obj"` раскладывает объект в атрибуты, а `class` и `style` умеют объединять строки, массивы и объекты.
- **`v-on`** (сокращение `@`) подписывает обработчик. `@click="inc"` передаёт функцию, а `@click="count++"` компилятор оборачивает в стрелку `$event => (count++)` и кэширует её в `_cache`.
- **Выражения.** Внутри <code v-pre>{{ }}</code> и директив допускается ровно **одно JS-выражение**: тернарный оператор, вызов, `items.map(i => i * 2)`. Инструкции (`let x = 1`, `if (…) {}`, `a; b`) дают ошибку компиляции «Error parsing JavaScript expression».

Компилятор переписывает свободные идентификаторы выражения. Привязки `<script setup>` в production становятся прямыми ссылками (`count.value`), в dev — `$setup.count`, а всё неизвестное — `_ctx.x`, то есть поиск по прокси экземпляра. Параметры стрелок, переменные `v-for` и слотов он распознаёт как локальные и не трогает.

**Песочница глобальных имён.** Без префикса остаются только имена из белого списка `GLOBALS_ALLOWED` в `@vue/shared`: `Math`, `Number`, `Date`, `Array`, `Object`, `JSON`, `Intl`, `Map`, `Set`, `RegExp`, `BigInt`, `Symbol`, `Error`, `console`, `parseInt`, `encodeURIComponent` и ещё несколько. `window`, `document`, `localStorage`, `URL` в список не входят: <code v-pre>{{ window.innerWidth }}</code> компилируется в `_ctx.window.innerWidth`, и на экземпляре такого свойства нет. Это сделано намеренно: шаблон зависит только от состояния компонента, а не от глобального окружения (и на SSR `window` всё равно нет). Нужное глобальное значение кладут в переменную `<script setup>` или, для всего приложения, в `app.config.globalProperties`.

> [!TIP]
> Вызов функции в шаблоне выполняется при **каждом** рендере компонента. Если результат зависит только от реактивного состояния, используйте `computed`: он пересчитывается лишь при изменении зависимостей.

### Регистрация компонентов

| Способ | Как | Когда разрешается |
| --- | --- | --- |
| Глобальная | `app.component('BaseIcon', BaseIcon)` | в runtime, `resolveComponent` по имени |
| Локальная, Options API | `components: { BaseIcon }` | в runtime, сначала локальные, затем глобальные |
| `<script setup>` | `import BaseIcon from './BaseIcon.vue'` | на этапе компиляции: подставляется переменная |

`resolveComponent` ищет имя как есть, затем в camelCase и в PascalCase. Поэтому глобальный `GlobalThing` находится и по `<GlobalThing>`, и по `<global-thing>`. Если ничего не найдено, Vue предупреждает «Failed to resolve component» и рендерит тег как пользовательский элемент. Компилятор `<script setup>` делает то же сопоставление статически: `<my-button>` превращается в импорт `MyButton`.

Глобальная регистрация удобна для базовых компонентов, но у неё три минуса: сборщик не может выкинуть неиспользуемые компоненты (tree shaking), зависимости компонента не видны из его кода, а для типов нужно расширять интерфейс `GlobalComponents`. Поэтому по умолчанию используют локальный импорт.

> [!NOTE]
> В Nuxt компоненты из `components/` импортируются автоматически. Это не глобальная регистрация: Nuxt на этапе сборки дописывает в файл явный импорт только тех компонентов, которые в нём используются.

### Три способа написать логику

**Options API.** Логика раскладывается по опциям `data`, `computed`, `methods`, `watch` и хукам жизненного цикла. Все они работают через `this`: это прокси экземпляра (`publicThis`), а методы Vue связывает с ним через `bind` ([почему методы нельзя писать стрелками](../javascript/functions-and-this.md)). Шаблон и `this` ищут ключ по очереди: в том, что вернул `setup()`, в `data`, в `props`, в остальных опциях (methods, computed), а в конце в `app.config.globalProperties`.

**`setup()`.** Функция вызывается один раз при создании экземпляра, **раньше** обработки опций, с аргументами `(props, { attrs, slots, emit, expose })`. `this` внутри — `undefined`: экземпляр ещё не готов, состояние живёт в локальных переменных, функции видят его через замыкание. Если `setup` вернёт объект, его поля пройдут через `proxyRefs` и станут видны шаблону и Options API без `.value`. Если вернёт render-функцию, состояние останется закрытым внутри замыкания.

**`<script setup>`.** Это синтаксис поверх `setup()`: весь блок становится телом `setup`, и все переменные, функции и импорты верхнего уровня доступны в шаблоне. Макросы `defineProps`, `defineEmits`, `defineModel`, `defineExpose`, `defineOptions`, `defineSlots` не импортируются и в рантайме не существуют: компилятор вырезает их и переносит аргументы в опции компонента. Например, `defineOptions({ name: 'UserCard', inheritAttrs: false })` вместе с `defineProps` и `defineEmits` дают `Object.assign({ name: 'UserCard', inheritAttrs: false }, { __name: 'UserCard', props: {…}, emits: [...], setup(__props, { emit: __emit }) {…} })`.

`defineOptions` (3.3+) нужен для опций, у которых нет отдельного макроса: `name`, `inheritAttrs`, пользовательские опции. Объявить через него `props`, `emits`, `expose` или `slots` нельзя: компилятор выдаёт ошибку «defineOptions() cannot be used to declare props. Use defineProps() instead».

В dev-режиме шаблон не встраивается. `setup` возвращает объект всех привязок `__returned__` с флагом `__isScriptSetup`: так работают HMR и devtools. Шаблон компилируется в отдельную функцию `render(_ctx, _cache, $props, $setup)` и читает `$setup.count`.

### Закрытость `<script setup>` и `expose`

Ref на дочерний компонент (`useTemplateRef('child')` или `ref="child"`) получает **публичный экземпляр**. Рантайм выбирает его в `getComponentPublicInstance`: если у экземпляра задан `exposed`, возвращается прокси, где видны только открытые ключи и `$`-свойства (`$el`, `$props`, `$emit`…), иначе — полный прокси экземпляра.

| Дочерний компонент | Родитель видит `secret` | Видит `reset` |
| --- | --- | --- |
| `<script setup>` без `defineExpose` | нет | нет |
| `<script setup>` + `defineExpose({ reset })` | нет | да |
| Options API | да | да |
| Options API + `expose: ['reset']` | нет | да |

`<script setup>` закрыт по-разному в двух режимах, но с одинаковым результатом. В dev компилятор вставляет вызов `__expose()` без аргументов: `exposed` становится `{}`, и наружу не видно ничего. В production вызова нет, но и состояние не попадает в экземпляр: оно в замыкании render-функции, и полный прокси его не содержит. `defineExpose({ reset })` компилируется в `__expose({ reset })`. В `setup()` то же делает `expose()` из контекста, в Options API — опция `expose`.

Закрытость по умолчанию делает публичный API компонента явным: родитель зависит от `reset`, а не от любой внутренней переменной. Императивный доступ через ref — исключение для фокуса, прокрутки и сброса формы. Обычный путь — props вниз, события вверх.

### Почему Composition API

- **Логика по смыслу, а не по опциям.** В Options API одна функциональность (поиск: запрос, результаты, загрузка, debounce, отмена) размазана по `data`, `computed`, `watch`, `methods` и `mounted`. В Composition API она лежит рядом и выносится в функцию `useSearch()` целиком.
- **Переиспользование без mixins.** Mixin подмешивает опции в компонент неявно. Из шаблона не видно, откуда взялось `loading`, одинаковые ключи из двух mixins молча перезаписывают друг друга, а параметризовать mixin нельзя. Composable — обычная функция: явные аргументы, явный результат, конфликт имён решается переименованием при деструктуризации.
- **Типы.** Переменные и функции выводятся TypeScript без подсказок. Для Options API нужен `defineComponent` со сложной типизацией `this` через `ThisType`.
- **Бандл.** Встроенный в замыкание шаблон обращается к локальным переменным, а их минификатор сокращает. Имена свойств вида `this.searchQuery` сократить нельзя. Если в приложении нет Options API, флаг сборки `__VUE_OPTIONS_API__: false` убирает его поддержку из рантайма.

Options API всё ещё уместен в существующем коде на Vue 2/3, для простых компонентов «данные плюс пара методов» и в командах, которым нужна жёсткая структура «что куда класть». Оба стиля можно смешивать: опции видят то, что вернул `setup()`, а `setup()` опции не видит. Код Options API в соседнем `<script>` не видит привязок `<script setup>`: рантайм намеренно исключает такое состояние из `this` (проверка `__isScriptSetup`).

> [!NOTE]
> Во Vue 3.6 (RC, `3.6.0-rc.15`, сверено 2026-11-14) появляется Vapor Mode: `<script setup vapor>` компилируется без VDOM. Он поддерживает только `<script setup>` и компоненты без скрипта, **Options API в нём нет**. Стабильная версия на эту дату — 3.5.45. Подробнее о Vapor — в [«Производительности Vue и Nuxt»](../performance/vue-performance.md).

## Примеры

### Один компонент тремя способами

```vue
<!-- Options API -->
<script>
export default {
  props: { step: { type: Number, default: 1 } },
  emits: ['change'],
  data: () => ({ count: 0 }),
  computed: { double() { return this.count * 2 } },
  methods: {
    inc() { this.count += this.step; this.$emit('change', this.count) },
  },
}
</script>
```

```vue
<!-- setup(): the same component, state in closures -->
<script>
import { ref, computed } from 'vue'
export default {
  props: { step: { type: Number, default: 1 } },
  emits: ['change'],
  setup(props, { emit }) {
    const count = ref(0)
    const double = computed(() => count.value * 2)
    function inc() { count.value += props.step; emit('change', count.value) }
    return { count, double, inc } // exposed to the template and to Options API
  },
}
</script>
```

```vue
<!-- <script setup>: macros instead of options, nothing to return -->
<script setup>
import { ref, computed } from 'vue'
const { step = 1 } = defineProps({ step: Number })
const emit = defineEmits(['change'])
const count = ref(0)
const double = computed(() => count.value * 2)
function inc() { count.value += step; emit('change', count.value) }
</script>

<template>
  <button @click="inc">{{ count }} × 2 = {{ double }}</button>
</template>
```

Деструктуризация props с значением по умолчанию (`step = 1`) стабильна с 3.5: компилятор переписывает `step` в `__props.step`, поэтому реактивность не теряется.

## Вопросы с интервью

::: details Что такое SFC и что с ним происходит при сборке
Файл `.vue` с блоками шаблона, скрипта и стилей. Плагин сборщика вызывает `@vue/compiler-sfc`: `parse` делит файл на блоки, `compileScript` собирает объект компонента (макросы `defineProps` и другие превращаются в опции, `<script setup>` — в функцию `setup`), `compileTemplate` компилирует шаблон в render-функцию с patch flags и кэшированием статики, `compileStyle` обрабатывает scoped-стили. Результат — ES-модуль, экспортирующий объект компонента. Поэтому в рантайме компилятор шаблонов не нужен: сборщики подключают runtime-only сборку Vue, а строковая опция `template` требует полной сборки и `'unsafe-eval'` в CSP.
:::

::: details Чем script setup отличается от функции setup
`<script setup>` компилируется в `setup()`, но даёт больше трёх вещей. Не нужно возвращать объект: всё верхнего уровня, включая импорты компонентов, видно шаблону. Есть макросы времени компиляции (`defineProps`, `defineEmits`, `defineModel`, `defineExpose`, `defineOptions`), которые лучше типизируются. В production шаблон встраивается в замыкание `setup`, поэтому render-функция читает переменные напрямую, без прокси экземпляра, и минификатор сокращает их имена. Кроме того, компонент по умолчанию закрыт: родитель через ref не видит его состояния, пока оно не открыто через `defineExpose`. Обычный `setup()` нужен, когда скрипт без сборки или когда опции и `setup` надо смешать в одном объекте.
:::

::: details Почему внутри setup нет this
`setup` вызывается раньше обработки опций, и Vue не передаёт ему экземпляр в качестве `this`: внутри `this === undefined`. Идея Composition API в том, что состояние — локальные переменные, а функции работают с ним через замыкания. Поэтому их можно передать как колбэк без `bind`, вынести в composable и типизировать без `ThisType`. Всё, что в Options API бралось из `this`, приходит аргументами: `props` первым, `attrs`, `slots`, `emit`, `expose` — вторым. В `<script setup>` то же дают макросы `defineProps` и `defineEmits` и функции `useAttrs` и `useSlots`.
:::

::: details Почему родитель не может вызвать метод дочернего компонента через ref
Если ребёнок написан на `<script setup>`, он закрыт по умолчанию. Ref получает результат `getComponentPublicInstance`: при заданном `exposed` это прокси, где видны только открытые ключи и `$`-свойства. В dev компилятор вызывает `__expose()` без аргументов, то есть открывает пустой объект. В production состояние и так живёт в замыкании render-функции и в экземпляр не попадает. Решение — явно открыть API: `defineExpose({ validate })`. Компоненты на Options API открыты целиком, пока не задана опция `expose`. Хорошая практика — открывать минимум (фокус, сброс, прокрутка), а данные передавать через props и события.
:::

::: details Почему в шаблоне нельзя обратиться к window или localStorage
Компилятор оставляет без префикса только имена из белого списка (`Math`, `Date`, `JSON`, `Intl`, `Number`, `console` и ещё несколько). Остальные свободные идентификаторы переписываются в `_ctx.x`, то есть ищутся на экземпляре компонента, а `window` там нет. Это делает шаблон чистой функцией от состояния компонента и защищает от случайной зависимости от глобального окружения, которого, например, нет на SSR. Нужное значение кладут в переменную скрипта (лучше реактивную, если оно меняется) или в `app.config.globalProperties` для всего приложения.
:::

::: details Глобальная или локальная регистрация компонентов, что выбрать
По умолчанию — локальная, в `<script setup>` это просто импорт. Он разрешается на этапе компиляции, зависимости видны в коде, неиспользуемые компоненты не попадают в бандл, типы выводятся сами. Глобальная регистрация через `app.component` разрешается в runtime через `resolveComponent` (по имени, в camelCase и PascalCase). Она мешает tree shaking, скрывает зависимости и требует расширять `GlobalComponents` для типов. Её оставляют для небольшого набора базовых компонентов дизайн-системы. Авто-импорт Nuxt — компромисс: пишешь без импорта, а сборщик всё равно добавляет явный локальный импорт.
:::

::: details Почему Composition API и когда Options API всё ещё уместен
Composition API группирует код по функциональности, а не по типу опции, и позволяет вынести её целиком в composable. Это замена mixins без их проблем: неявного происхождения свойств, молчаливых конфликтов имён и невозможности передать параметры. Он лучше типизируется (обычные переменные вместо `this`), лучше минифицируется, а Vapor Mode из Vue 3.6 поддерживает только `<script setup>`. Цена — свобода: без соглашений `setup` превращается в длинный скрипт, поэтому нужна дисциплина выносить логику в composables. Options API подходит для простых компонентов, legacy-кода и команд, которым важна фиксированная структура. Он реализован поверх того же рантайма, а флаг `__VUE_OPTIONS_API__: false` убирает его из бандла, если он не используется.
:::

## Задачи

### 1. Что выведет · легко

```js
import { ref } from 'vue'

export default {
  props: { step: { type: Number, default: 1 } },
  setup() {
    console.log('setup this:', this)
    const count = ref(0)
    return { count }
  },
  data() {
    console.log('data sees count:', this.count)
    return { label: 'x' }
  },
  computed: { double() { return this.count * 2 } },
  mounted() {
    this.count += this.step
    console.log('mounted:', this.count, this.double)
  },
  render: () => null,
} // mounted with props { step: 5 }
```

::: details Решение и разбор
```text
setup this: undefined
data sees count: 0
mounted: 5 10
```

`setup` выполняется первым и без экземпляра в `this`. Опции обрабатываются после него, поэтому `data` уже видит `count`. Возвращённый объект прошёл через `proxyRefs`: `this.count` читает и пишет `count.value` без `.value`, а `computed` `double` отслеживает этот ref. В обратную сторону это не работает: из `setup` нельзя прочитать `data` или `methods`.
:::

### 2. Найдите баг · средне

Форма вызывает валидацию поля перед отправкой. В dev и в production падает с `TypeError: field.value.validate is not a function`.

```vue
<!-- EmailField.vue -->
<script setup>
import { ref } from 'vue'
const value = ref('')
const error = ref('')
function validate() {
  error.value = value.value.includes('@') ? '' : 'Invalid email'
  return !error.value
}
</script>
<template><input v-model="value" /><span>{{ error }}</span></template>

<!-- Form.vue -->
<script setup>
import { useTemplateRef } from 'vue'
import EmailField from './EmailField.vue'
const field = useTemplateRef('field')
function submit() { if (field.value.validate()) send() }
</script>
<template><EmailField ref="field" /><button @click="submit">Send</button></template>
```

::: details Решение и разбор
`<script setup>` закрыт: ref получает публичный экземпляр, в котором нет `validate`. Открываем только метод:

```js
// EmailField.vue
defineExpose({ validate })
```

В dev закрытость даёт `__expose()` без аргументов, который компилятор вставляет сам, а `defineExpose` превращается в `__expose({ validate })`. В production `validate` живёт в замыкании render-функции и в экземпляр не попадает, пока его не откроют явно.

Альтернатива без императивного вызова: поле сообщает о валидности событием, и форма держит состояние у себя. Тогда родитель не зависит от внутреннего API каждого поля.
:::

### 3. Найдите баг · легко

```vue
<script setup>
defineProps({ link: String })
</script>

<template>
  <a :href="link">{{ new URL(link).hostname }}</a>
  <span>Width: {{ window.innerWidth }}</span>
</template>
```

Ошибка: `TypeError: _ctx.URL is not a constructor`.

::: details Решение и разбор
Ни `URL`, ни `window` не входят в белый список глобальных имён. Компилятор выдаёт `new _ctx.URL(__props.link)` и `_ctx.window.innerWidth`: prop он распознал, а остальное ищет на экземпляре. Вычисляем значения в скрипте:

```vue
<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
const props = defineProps({ link: String })
const host = computed(() => new URL(props.link).hostname)
const width = ref(0) // 0 on the server: there is no window during SSR
const update = () => { width.value = window.innerWidth }
onMounted(() => { update(); window.addEventListener('resize', update) })
onUnmounted(() => window.removeEventListener('resize', update))
</script>

<template><a :href="link">{{ host }}</a> <span>Width: {{ width }}</span></template>
```

Даже если бы `window` был доступен, `window.innerWidth` не реактивен: шаблон не перерисуется при изменении размера окна. Поэтому нужен `ref` и подписка на событие. `computed` для хоста ещё и не пересоздаёт `URL` при каждом рендере.
:::

### 4. Переведите на script setup · средне

```vue
<script>
export default {
  name: 'TodoItem',
  inheritAttrs: false,
  props: { todo: { type: Object, required: true } },
  emits: ['toggle'],
  data: () => ({ editing: false }),
  computed: { label() { return this.todo.done ? `✓ ${this.todo.title}` : this.todo.title } },
  methods: { toggle() { this.$emit('toggle', this.todo.id) } },
  mounted() { console.log('mounted', this.todo.id) },
}
</script>
```

::: details Решение и разбор
```vue
<script setup>
import { ref, computed, onMounted } from 'vue'

defineOptions({ name: 'TodoItem', inheritAttrs: false })
const props = defineProps({ todo: { type: Object, required: true } })
const emit = defineEmits(['toggle'])

const editing = ref(false)
const label = computed(() => (props.todo.done ? `✓ ${props.todo.title}` : props.todo.title))
const toggle = () => emit('toggle', props.todo.id)

onMounted(() => console.log('mounted', props.todo.id))
</script>
```

Соответствие: `name` и `inheritAttrs` — в `defineOptions`, `props` и `emits` — в свои макросы, `data` — `ref`, `methods` — обычные функции, `mounted` — `onMounted`, `this.$emit` — `emit`, `this.todo` — `props.todo`.

`name` в `defineOptions` нужен, только если имя должно отличаться от имени файла: `__name` компилятор выводит из файла сам, и по нему работают devtools, рекурсия и `KeepAlive include`. Деструктуризация `const { todo } = defineProps(…)` в 3.5 тоже реактивна, но `todo` — объект, и для его полей разницы нет.
:::

### 5. Конфликт mixins · сложно

Компонент подключает два mixin: один для загрузки списка, другой для загрузки фильтров. Что выведет `mounted`? Перепишите на composables так, чтобы конфликт был невозможен.

```js
const listMixin = {
  data: () => ({ loading: 'list', page: 1 }),
  methods: { fetch() { return 'list.fetch' } },
}
const filtersMixin = {
  data: () => ({ loading: 'filters' }),
  methods: { fetch() { return 'filters.fetch' } },
}

export default {
  mixins: [listMixin, filtersMixin],
  data: () => ({ title: 'Products' }),
  mounted() { console.log(this.loading, this.page, this.title, this.fetch()) },
}
```

::: details Решение и разбор
Выводится `filters 1 Products filters.fetch`. При слиянии `data` и `methods` побеждает тот, кто подмешан позже, а собственные опции компонента — над всеми. Предупреждения нет: `loading` и `fetch` из `listMixin` молча потеряны, и список больше не загружается.

```js
// useList.js
import { ref } from 'vue'
export function useList(fetchPage) {
  const loading = ref(false)
  const page = ref(1)
  async function fetch() {
    loading.value = true
    try { return await fetchPage(page.value) } finally { loading.value = false }
  }
  return { loading, page, fetch }
}
```

```vue
<script setup>
import { useList } from './useList'
import { useFilters } from './useFilters'

const { loading: listLoading, page, fetch: fetchList } = useList(api.products)
const { loading: filtersLoading, fetch: fetchFilters } = useFilters(api.filters)
</script>
```

Composables решают три проблемы mixins: происхождение каждой переменной видно в компоненте, одинаковые имена переименовываются при деструктуризации, а не перезаписывают друг друга, и функция принимает параметры (`useList(api.products)`). Каждый вызов создаёт своё состояние, а TypeScript выводит типы результата сам.
:::

## Источники

- [Vue.js: Template Syntax](https://vuejs.org/guide/essentials/template-syntax.html)
- [Vue.js: Components Basics](https://vuejs.org/guide/essentials/component-basics.html)
- [Vue.js: Component Registration](https://vuejs.org/guide/components/registration.html)
- [Vue.js: SFC Syntax Specification](https://vuejs.org/api/sfc-spec.html)
- [Vue.js: `<script setup>`](https://vuejs.org/api/sfc-script-setup.html)
- [Vue.js: Composition API: setup()](https://vuejs.org/api/composition-api-setup.html)
- [Vue.js: Composition API FAQ](https://vuejs.org/guide/extras/composition-api-faq.html)
- [Vue.js: Options: State (`expose`)](https://vuejs.org/api/options-state.html#expose)
- [Vue.js: Compile-Time Flags](https://vuejs.org/api/compile-time-flags.html)
- [Исходники Vue 3.5.45: `runtime-core/src/componentPublicInstance.ts`, `component.ts`, `shared/src/globalsAllowList.ts`](https://github.com/vuejs/core/tree/v3.5.45/packages)
- [vuejs/core CHANGELOG (ветка `minor`, линия 3.6)](https://github.com/vuejs/core/blob/minor/CHANGELOG.md)
- [Announcing Vue 3.3 (`defineOptions`)](https://blog.vuejs.org/posts/vue-3-3)
- [Announcing Vue 3.4 (сокращение `:id`)](https://blog.vuejs.org/posts/vue-3-4)
- [Announcing Vue 3.5 (props destructure, `useTemplateRef`)](https://blog.vuejs.org/posts/vue-3-5)
