---
title: TypeScript во Vue
level: ядро
---

# TypeScript во Vue

> **Коротко.** `tsc` не умеет читать `.vue`. `vue-tsc` (обёртка над `tsc` из Vue Language Tools) превращает каждый SFC в виртуальный TS-файл: `<script setup>` остаётся как есть, шаблон становится TS-выражениями, а ошибки через source maps возвращаются на строки исходника. Vite и esbuild типы только вырезают, поэтому проверять их должен отдельный шаг `vue-tsc --noEmit`. Тип в `defineProps<T>()` читают два разных инструмента. `@vue/compiler-sfc` разбирает его по AST и строит runtime-объявление props, а `vue-tsc` проверяет его как настоящий тип. Отсюда ограничения: условный тип всего объекта props компилятор не разрешает. Generic-компонент для `vue-tsc` — это generic-функция, поэтому `InstanceType` к нему не применяется, нужен `ComponentExposed`. Стабильный TypeScript 7.0 у `vue-tsc` 3.x не поддерживается: проверка остаётся на TypeScript 6.

**Связанные темы:** [Система типов: структурная типизация, `type` и `interface`](../typescript/type-system.md), [Generics](../typescript/generics.md), [Сужение типов и discriminated unions](../typescript/narrowing.md), [Utility, conditional и mapped types](../typescript/type-level-programming.md), [Props, emits и `v-model` на компонентах](./props-emits-v-model.md), [Реактивность: `ref`, `reactive`, `computed`](./reactivity.md), [Слоты и provide/inject](./slots-and-provide-inject.md), [Компоненты и шаблоны](./components-and-templates.md), [Composables](./composables.md), [Плагины и обработка ошибок](./plugins-and-error-handling.md), [Vue Router](./vue-router.md)

## Теория

Все проверки выполнены на Vue 3.5.45 в Node 26.13.1. Типы проверены `vue-tsc` 3.3.14 на TypeScript 6.0.3 в strict-режиме, вывод компилятора получен через `@vue/compiler-sfc`, виртуальный код — через `@vue/language-core` 3.3.14. Те же сценарии повторены на `3.6.0-rc.16` и дали тот же результат. Общий TypeScript здесь не объясняется: он разобран в разделе [«TypeScript»](../typescript/type-system.md).

### Почему `tsc` не понимает SFC

Для `tsc` файл `.vue` не модуль. `import List from './List.vue'` даёт ошибку «Cannot find module './List.vue' or its corresponding type declarations». Старое обходное решение — shim:

```ts
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
```

С ним `tsc` перестаёт ругаться, но каждый компонент получает тип `DefineComponent<{}, {}, any>`: props, события и слоты теряются, шаблоны не проверяются. В проекте с `vue-tsc` shim не нужен и даже вреден.

`vue-tsc` устроен иначе. Пакет `@vue/language-core` для каждого SFC генерирует **виртуальный код** (virtual code), обычный TypeScript. `<script setup>` копируется как есть, макросы получают типы, шаблон превращается в выражения: каждый компонент становится вызовом функции с объектом props, `v-for` — циклом `for…of`, слот — вызовом функции слота. Source maps связывают виртуальный код с исходником, поэтому ошибка показывается на строке `.vue`. Фрагмент реального вывода для `<List :items="nums" :get-label="String" />` (сокращён):

```ts
const __VLS_0 = List;
const __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({ /* … */ }));
const __VLS_2 = __VLS_1({
  items: (__VLS_unwrap(nums, {} as import('vue').Ref<unknown>)),
  getLabel: (String),
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
```

`useTemplateRef('inp')` в виртуальном коде переписывается в приведение к типу из карты ссылок шаблона:

```ts
const inp = (useTemplateRef({} as any) as Readonly<import('vue').ShallowRef<__VLS_TemplateRefs['inp'] | null>>)
type __VLS_TemplateRefs = {} & { inp: __VLS_Elements['input'] }
```

Отсюда автоматический вывод типа: `inp` получает тип `Readonly<ShallowRef<HTMLInputElement | null>>`, а опечатка `useTemplateRef('inpt')` даёт «Property 'inpt' does not exist on type '__VLS_TemplateRefs'». Рантайм про это ничего не знает: для него ключ — просто строка.

### `vue-tsc`, редактор и сборка

- **Сборка типы не проверяет.** Документация Vue: «the dev server and the bundler are transpilation-only and do not perform any type-checking». esbuild вырезает аннотации по одному файлу, поэтому в tsconfig нужен `isolatedModules` (или `verbatimModuleSyntax`, как в `@vue/tsconfig`). Проверка — отдельный шаг `vue-tsc --noEmit` в CI и pre-commit, в разработке — `vue-tsc --watch` или `vite-plugin-checker`.
- **`vue-tsc` — обёртка над `tsc`.** Он вызывает `runTsc` из `@volar/typescript` с языковым плагином для `.vue`. Флаги и `tsconfig` те же, генерация `.d.ts` тоже работает.
- **Редактор.** Расширение Vue (Official), бывший Volar, запускает Vue language server и плагин `@vue/typescript-plugin` для tsserver. Код генерируется тот же, поэтому редактор и `vue-tsc` в CI видят одинаковые ошибки.
- **Строгость шаблонов.** По умолчанию неизвестный prop (`<AppExpose :foo="1" />`) и незарегистрированный компонент (`<UnknownThing />`) ошибок не дают. С `"vueCompilerOptions": { "strictTemplates": true }` появляются «'foo' does not exist in type …» и «Property 'UnknownThing' does not exist on type '{}'». Неверный тип известного prop ловится и без этой опции.

> [!WARNING]
> TypeScript 7 (сверено 2026-11-21). `typescript@latest` — 7.0.2, нативный компилятор без JS API. `vue-tsc` 3.3.14 (последняя версия) объявляет `peerDependencies: { "typescript": ">=5.0.0" }`, поэтому npm ставит его вместе с 7.0.2 без предупреждений. Но запуск падает: `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './lib/tsc' is not defined by "exports"` (проверено). Языковой сервер и плагин для tsserver тоже требуют JS API TypeScript 6. Решение — закрепить `typescript@^6` для `vue-tsc`, а `tsgo` можно запускать рядом для `.ts`-файлов. Поддержка TS 7 планируется через content mappers из TypeScript 7.1 (бета `7.1.0-beta`). Это Vue Language Tools v4: `tsc` проверяет `.vue` сам, отдельный `vue-tsc` не нужен. Сейчас это черновой PR «feat: content mapper (v4 alpha)» (vuejs/language-tools#6170), не релиз.

### Один тип, два читателя

Тип из `defineProps<Props>()` нужен двум инструментам, и понимают они его по-разному.

1. **`@vue/compiler-sfc`** строит runtime-объявление props: ключи, `type` для проверки и boolean casting, `required`. TypeScript он не запускает и разбирает тип по AST. С 3.3 он ходит по импортам (относительные пути, алиасы, `node_modules`, для пакетов нужен `typescript` как peer dependency), раскрывает `extends`, `Pick`, `Omit`, индексные типы.
2. **`vue-tsc`** видит тот же тип как обычный TypeScript-тип и проверяет по нему родителя и шаблон.

Где их возможности расходятся:

```ts
import type { Base, Pick2 } from './types' // Base = { id: number; label: string }
type IsStr<X> = X extends string ? 'yes' : 'no'
interface Props extends Base { flag: IsStr<number>; picked: Pick2; maybe?: boolean; cb: () => void }
defineProps<Props>()
```

Компилятор выдал (проверено):

```js
props: {
  flag: { type: null, required: true },     // conditional type: runtime type unknown
  picked: { type: Object, required: true },
  maybe: { type: Boolean, required: false },
  cb: { type: Function, required: true },
  id: { type: Number, required: true },     // from the imported base interface
  label: { type: String, required: true },
},
```

- **Условный тип одного prop** допустим: ключ известен, а `type: null` означает, что в рантайме тип не проверяется. `vue-tsc` при этом проверяет `flag` полностью.
- **Условный тип всего объекта** — ошибка сборки «Unresolvable type: TSConditionalType»: компилятор не знает, какие ключи объявить. Документация так и пишет: «You can use conditional types for the type of a single prop, but not the entire props object».
- **Сложные внешние типы** тоже могут не разрешиться. `defineProps<ButtonHTMLAttributes>()` из `vue` в 3.5.45 падает с «Failed to resolve extends base type». Выход — объявить нужные props явно или взять `Pick` от внешнего типа.

Поэтому ошибка «Unresolvable type» приходит от **сборки** (Vite-плагина), а не от `vue-tsc`: редактор может показывать, что всё в порядке, а `vite build` падает.

### Макросы: emits, model, slots

Как макросы превращаются в runtime-код, разобрано в теме [«Props, emits и `v-model`»](./props-emits-v-model.md). Здесь только типы:

- **`defineEmits`.** С 3.3 есть краткая форма — именованные кортежи `{ select: [item: T]; 'update:size': [size: Size] }`. Старая форма — перегрузки `(e: 'change', id: number): void`. Компилятор берёт из типа только имена событий: `emits: ["select", "update:size"]`. Типы аргументов проверяет только `vue-tsc`.
- **`defineModel<T>()`** возвращает `Ref<T | undefined>`, с `{ required: true }` — `Ref<T>`. `defineModel<string, 'trim' | 'uppercase'>()` типизирует модификаторы: `Record<'trim' | 'uppercase', true | undefined>`. В runtime-объявлении prop модели с generic-типом получает `type: null`.
- **`defineSlots`** — только тип, в рантайме ничего не объявляет ([подробнее](./slots-and-provide-inject.md)).
- **Значения по умолчанию.** При деструктуризации props (3.5) дефолт пишется как в JS, и `vue-tsc` сверяет его с типом. `withDefaults` нужен для `props.x` без деструктуризации и для 3.4 и ниже.

### Generic-компоненты

```vue
<script setup lang="ts" generic="T extends { id: number | string }">
import type { Size } from './types'
const props = defineProps<{ items: T[]; size?: Size; getLabel: (item: T) => string }>()
const emit = defineEmits<{ select: [item: T]; 'update:size': [size: Size] }>()
const selected = defineModel<T | null>('selected', { required: true })
defineSlots<{ default(props: { item: T }): any }>()
defineExpose({ focus: () => {} })
</script>
```

Значение `generic` — это список параметров между `<…>` в TypeScript: несколько параметров, `extends`, значения по умолчанию, импортированные типы.

**В рантайме generic-компонент — обычный компонент.** `@vue/compiler-sfc` выдаёт тот же `defineComponent({ props: { items: { type: Array, … } … } })`, параметр `T` остаётся только в TS-аннотациях вывода (`_useModel<T | null>(__props, 'selected')`), и их срезает esbuild.

**Для `vue-tsc` это generic-функция.** Виртуальный код экспортирует (сокращено):

```ts
const __VLS_export = (<T extends { id: number | string },>(
  __VLS_props: NonNullable<Awaited<typeof __VLS_setup>>['props'],
  __VLS_ctx?: /* attrs, emit, slots */,
  __VLS_exposed?: NonNullable<Awaited<typeof __VLS_setup>>['expose'],
  __VLS_setup = (async () => { /* the body of <script setup> */ })(),
) => import('vue').VNode & { __ctx?: /* … */ })
```

Тег `<List …>` в шаблоне родителя — вызов этой функции, поэтому `T` выводится, как у любого вызова, **из всех props сразу**: из `items`, `selected`, параметра колбэка `getLabel`. `<List :items="users">` с `users: User[]` даёт в слоте `item: User`, а `<List :items="[{ name: 'x' }]">` — ошибку «Property 'id' is missing». Когда `T` вывести не из чего (например, компонент сам грузит данные), тип передают явно комментарием `<!-- @vue-generic {import('@/api').Actor} -->` перед тегом.

### Типы `ref`, `reactive`, `computed`

Как реактивность устроена в рантайме, разобрано в теме [«Реактивность»](./reactivity.md). Типы (проверено):

| Выражение | Тип |
| --- | --- |
| `ref()` | `Ref<any>` |
| `ref<number>()` | `Ref<number \| undefined>` |
| `ref(null)` | `Ref<null>`: присвоить объект нельзя, нужен `ref<User \| null>(null)` |
| `reactive({ n: ref(1), list: [ref(1)] })` | `{ n: number; list: Ref<number>[] }` |
| `computed(() => 1)` | `ComputedRef<number>`: `.value = 2` — «Cannot assign to 'value' because it is a read-only property» |
| `useTemplateRef('el')` | `Readonly<ShallowRef<T \| null>>` |

- **`Ref<T, S>`.** С 3.5 у `Ref` два параметра: тип чтения и тип записи. `const k: Ref<string, string | number>` читается как `string`, а принимает и число (так в 3.5 разрешили разные типы геттера и сеттера у writable `computed` и `defineModel`, #11472 и #11699).
- **Разворачивание.** Тип `ref(v)` — `Ref<UnwrapRef<T>>`: вложенные ref в объекте разворачиваются, потому что `.value` в рантайме — `reactive`-прокси. Массивы и коллекции внутри `reactive` ref не разворачивают ни в рантайме, ни в типе: `list: Ref<number>[]`.
- **Generic-аргумент `reactive` не рекомендуется.** `reactive<Book>()` возвращает развёрнутый тип, а не `Book`. Документация советует аннотировать переменную: `const book: Book = reactive({ … })`.
- **`Ref` против `ShallowRef`.** `ShallowRef<T>` — это `Ref<T> & { [ShallowRefMarker]?: true }`. Маркер необязательный, поэтому присваивание в обе стороны проходит. Его задача — `UnwrapRef`: для `ShallowRef` значение не разворачивается вглубь. `ref({ inner: ref(1) }).value.inner` — `number`, `shallowRef({ inner: ref(1) }).value.inner` — `Ref<number>`, и рантайм ведёт себя так же (`typeof` дал `number` и `object`).
- **`MaybeRef<T>` и `MaybeRefOrGetter<T>`** — типы параметров composables (`T | Ref<T> | ShallowRef<T> | WritableComputedRef<T>`, плюс `ComputedRef<T> | (() => T)`). Читаются через `toValue()` ([подробнее](./composables.md)).
- **Обработчики событий.** Параметр обработчика без аннотации — `any`. Пишите `(e: Event) => (e.target as HTMLInputElement).value`. В inline-обработчике шаблона `$event` типизирован по элементу.

**Generic-обёртка над `ref`.** `function useState<T>(v: T): Ref<T> { return ref(v) }` не компилируется: «`Type 'UnwrapRef<T>' is not assignable to type 'T'`». Для произвольного `T` компилятор не может доказать, что разворачивать нечего ([подробнее](../typescript/generics.md)). Частое решение `as Ref<T>` врёт, если `T` содержит ref: тип говорит `Ref<number>`, а в рантайме там `number` (см. задачу 3).

### provide/inject

`InjectionKey<T>` — символ с привязанным типом: `provide` проверяет значение, `inject(key)` возвращает `T | undefined`, с дефолтом — `T`. Строковый ключ без generic даёт `unknown`, а `inject<string>('foo')` — просто утверждение программиста. Подробно — в теме [«Слоты и provide/inject»](./slots-and-provide-inject.md), как устроен сам тип — в [«Generics»](../typescript/generics.md).

### Ссылки на элементы и компоненты

- **Элемент.** Для статического `ref="inp"` `vue-tsc` выводит тип сам (Vue 3.5 + Language Tools 2.1+). Явный параметр нужен, когда ключ динамический: `useTemplateRef<HTMLInputElement>('inp')`. Значение — `null` до монтирования и после `v-if`, поэтому `inp.value?.focus()`. Ref внутри `v-for` получает тип массива: `(Instance | null)[] | null`.
- **Обычный компонент.** `InstanceType<typeof Expose>` — публичный экземпляр. В нём видно только то, что открыто через `defineExpose`, плюс `$el`, `$props` и т. д.: обращение к внутреннему `secret` даёт «Property 'secret' does not exist». Это та же закрытость `<script setup>`, что и в рантайме ([подробнее](./components-and-templates.md)).
- **Generic-компонент.** `InstanceType<typeof List>` — ошибка «does not satisfy the constraint 'abstract new (...args: any) => any'»: у функции нет конструктора. `ComponentInstance<typeof List>` из `vue` молча даёт `never`. Правильно — `ComponentExposed<typeof List>` из `vue-component-type-helpers`, он вернул `{ focus: () => void }`. При статическом `ref="list"` и `useTemplateRef('list')` тип выводится автоматически и равен тому же `{ focus } | null`.
- **Любой компонент.** `ComponentPublicInstance` — только общие свойства (`$el` и т. п.).

### Глобальные типы: module augmentation

Всё, что регистрируется на `app`, Vue не может вывести из кода. Типы дописывают слиянием интерфейсов модуля `'vue'`:

```ts
// src/env.d.ts — must be a module: the import below makes it one
import type AppExpose from './components/AppExpose.vue'

declare module 'vue' {
  interface ComponentCustomProperties { $t: (key: string) => string } // app.config.globalProperties
  interface GlobalComponents { AppExpose: typeof AppExpose }         // app.component('AppExpose', …)
}
```

После этого <code v-pre>{{ $t(1) }}</code> в шаблоне даёт «Argument of type 'number' is not assignable to parameter of type 'string'», а `<AppExpose>` проверяется по своим props. Если в файле нет ни одного `import` или `export`, объявление **заменяет** модуль `'vue'`, а не дополняет его: в проекте появляются ошибки «Module '"vue"' has no exported member 'ref'» (проверено). Почему так работает слияние объявлений, разобрано в теме [«Система типов»](../typescript/type-system.md), когда `globalProperties` уместны — в теме [«Плагины и обработка ошибок»](./plugins-and-error-handling.md). Так же типизируют `RouteMeta` и карту маршрутов во [Vue Router](./vue-router.md).

### Options API для сравнения

```ts
export default defineComponent({
  props: { book: { type: Object as PropType<Book>, required: true } },
  emits: { pick: (id: number) => typeof id === 'number' },
  data: () => ({ count: 0 }),
  computed: { label(): string { return `${this.book.title} (${this.count})` } },
  methods: { go() { this.$emit('pick', this.book.title) } }, // error: string is not number
})
```

Тип `this` строится через `defineComponent` и `ThisType`. Без `strict` (или хотя бы `noImplicitThis`) `this` становится `any`. Сложный prop описывают через `PropType<T>`, а у `computed` с `this` указывают тип результата, иначе TypeScript может не вывести его из-за циклической зависимости от `this`. В Composition API всё это выводится из обычных переменных.

> [!NOTE]
> Во Vue 3.6 (RC, сверено 2026-11-21: последняя версия `3.6.0-rc.16` от 2026-11-20) типизация макросов `<script setup>`, generic-компонентов и `useTemplateRef` не меняется: все сценарии темы на `3.6.0-rc.16` с `vue-tsc` 3.3.14 дали те же ошибки и тот же вывод компилятора. Новое в типах связано с Vapor Mode: вывод типов для `defineVaporComponent` (#13831), generic-компоненты с runtime props в нём (#14770), тип `expose` ограничен типом `Exposed` (#15188). Это по CHANGELOG, отдельно не проверялось.

## Примеры

Родитель generic-списка из раздела «Generic-компоненты». Все ошибки в комментариях получены `vue-tsc`:

```vue
<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import List from './List.vue'

interface User { id: number; name: string }
const users = ref<User[]>([{ id: 1, name: 'Ann' }])
const current = ref<User | null>(null)

const list = useTemplateRef('list') // Readonly<ShallowRef<{ focus: () => void } | null>>
list.value?.focus()
</script>

<template>
  <List ref="list" :items="users" :get-label="(u) => u.name" v-model:selected="current">
    <!-- error: Property 'age' does not exist on type '{ id: number; name: string; }' -->
    <template #default="{ item }">{{ item.age }}</template>
  </List>
</template>
```

`u` в `:get-label` и `item` в слоте получили тип `User`, хотя нигде не аннотированы: `T` выведен из `users`.

Минимальный tsconfig для проверки SFC и скрипт CI:

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true, // esbuild transpiles file by file
    "noEmit": true,
    "jsx": "preserve",
    "paths": { "@/*": ["./src/*"] } // mirror the Vite alias
  },
  "vueCompilerOptions": { "strictTemplates": true },
  "include": ["src/**/*.ts", "src/**/*.vue"]
}
```

```json
{ "scripts": { "type-check": "vue-tsc --noEmit", "build": "vue-tsc --noEmit && vite build" } }
```

## Вопросы с интервью

::: details Почему для Vue-проекта нужен vue-tsc, а не tsc
`tsc` не умеет читать `.vue`: импорт компонента — «Cannot find module», а shim `declare module '*.vue'` даёт всем компонентам тип `DefineComponent<{}, {}, any>`, и шаблоны вообще не проверяются. `vue-tsc` — обёртка над `tsc` с языковым плагином из `@vue/language-core`. Для каждого SFC он генерирует виртуальный TS-файл: скрипт как есть, шаблон в виде выражений (компонент — вызов функции с props, `v-for` — цикл, слот — вызов функции слота). Ошибки возвращаются на исходные строки через source maps. Редактор (Vue Official) использует тот же генератор. Отдельным шагом проверка нужна потому, что Vite и esbuild типы только вырезают: «transpilation-only».
:::

::: details Что сломается в проверке типов Vue-проекта после выхода TypeScript 7
Stable TypeScript 7.0 — нативный компилятор без JS API, а `vue-tsc` 3.x, языковой сервер и плагин для tsserver работают через JS API TypeScript 6. Peer dependency у `vue-tsc` — `>=5.0.0`, поэтому `npm i -D typescript` молча ставит 7.0.2, и `vue-tsc` падает с `ERR_PACKAGE_PATH_NOT_EXPORTED` на `./lib/tsc`. Поэтому `typescript` закрепляют на `^6` (lock-файл, Renovate с правилом), а `tsgo` можно запускать рядом для `.ts`-кода ради скорости. Будущее — content mappers в TypeScript 7.1 (сейчас бета): `.vue` проверяет сам `tsc` через Vue content mapper, это Vue Language Tools v4, пока в черновом PR. На интервью важно показать понимание причины: Vue-инструменты встраиваются в компилятор TypeScript через его API, и смена компилятора ломает именно эту точку.
:::

::: details Почему defineProps не принимает условный тип всего объекта, хотя vue-tsc его понимает
Тип в `defineProps<T>()` читают два инструмента. `vue-tsc` проверяет его как настоящий TS-тип. А `@vue/compiler-sfc` должен на этапе сборки выдать runtime-объявление props: список ключей, `type` для dev-проверок и boolean casting, `required`. TypeScript он не запускает и разбирает тип по AST: ходит по импортам (с 3.3), раскрывает `extends`, `Pick`, `Omit`. Для условного типа всего объекта он не знает, какие ключи объявить, отсюда «Unresolvable type: TSConditionalType». Условный тип отдельного prop допустим: ключ известен, а `type: null` просто выключает runtime-проверку. Ошибка приходит от сборки, поэтому редактор может молчать, а `vite build` падать.
:::

::: details Как устроен generic-компонент и откуда берётся T
`generic="T extends …"` работает только в типах. В рантайме это обычный компонент с обычным объявлением props, `T` остаётся в аннотациях, которые срезает esbuild. `vue-tsc` описывает компонент как generic-функцию `<T>(props, ctx, exposed) => VNode`, а тег в шаблоне родителя — как её вызов. Поэтому `T` выводится, как у любого вызова, из всех props сразу, включая параметры колбэков, и попадает в типы слотов и событий. Если вывести не из чего, тип передают явно: `<!-- @vue-generic {Actor} -->`. Следствие для ссылок: у функции нет конструктора, поэтому `InstanceType<typeof List>` не работает, нужен `ComponentExposed` из `vue-component-type-helpers`.
:::

::: details Чем Ref отличается от ShallowRef на уровне типов
`ShallowRef<T>` — это `Ref<T> & { [ShallowRefMarker]?: true }`. Маркер необязательный, поэтому значения взаимозаменяемы при присваивании. Маркер нужен `UnwrapRef`: обычный `ref(v)` имеет тип `Ref<UnwrapRef<T>>`, потому что его `.value` в рантайме — reactive-прокси, который разворачивает вложенные ref. У `shallowRef` значение не проксируется, вложенный ref остаётся ref, и маркер говорит типу не разворачивать его. Отдельно: с 3.5 у `Ref` два параметра, `Ref<T, S>`, где `S` — тип записи.
:::

::: details Как типизировать ref на дочерний компонент
В 3.5 при статическом `ref="child"` и `useTemplateRef('child')` `vue-tsc` выводит тип сам. Явно: для обычного компонента `InstanceType<typeof Child>`, для generic-компонента `ComponentExposed<typeof Child>`, для «любого» — `ComponentPublicInstance`. В типе видно только то, что открыто через `defineExpose`, так же как в рантайме: `<script setup>` закрыт по умолчанию. Значение — `null` до монтирования и после `v-if`, поэтому обращение через `?.`. Ссылка из `v-for` типизирована как массив.
:::

::: details Как типизировать глобальные свойства и компоненты
Через module augmentation модуля `'vue'`: `ComponentCustomProperties` для `globalProperties` (`$t`), `GlobalComponents` для `app.component`. Тогда `vue-tsc` проверяет их в каждом шаблоне. Две ловушки. Файл с `declare module 'vue'` должен быть модулем (есть `import` или `export`), иначе объявление заменяет модуль, и пропадают `ref`, `computed` и всё остальное. И типы не связаны с регистрацией: забыли `app.component(…)` — типы есть, а в рантайме компонента нет. Поэтому для новых API лучше `provide` + `InjectionKey`: там тип выводится из ключа.
:::

## Задачи

### 1. Какие типы получатся · легко

Не запуская компилятор, назовите тип каждой константы.

```ts
const a = ref<number>()
const b = ref(null)
const c = reactive({ n: ref(1), list: [ref(1)] })
const d = shallowRef({ inner: ref(1) })
const e = computed(() => 'x')
```

::: details Решение и разбор
- `a` — `Ref<number | undefined>`: generic без начального значения добавляет `undefined`.
- `b` — `Ref<null>`, присвоить потом объект нельзя. Нужно `ref<User | null>(null)`.
- `c` — `{ n: number; list: Ref<number>[] }`. Свойство-ref развёрнуто, а элементы массива нет: так ведёт себя и рантайм.
- `d` — `ShallowRef<{ inner: Ref<number> }>`. Shallow-значение не разворачивается: `d.value.inner.value === 1`.
- `e` — `ComputedRef<string>`, `e.value = 'y'` — ошибка «read-only property».

Все типы проверены `vue-tsc`. Пункт `c` — частый источник багов: `c.list[0] + 1` не скомпилируется, а в шаблоне ref из массива тоже не развернётся.
:::

### 2. Почему generic не ловит ошибку · средне

Компонент `List` из раздела «Generic-компоненты» требует `T extends { id: number | string }`. Почему первая строка не даёт ошибки типов, а вторая даёт?

```vue
<List :items="[1, 2]" :get-label="String" :selected="null" />
<List :items="[1, 2]" :get-label="(n) => String(n)" :selected="null" />
```

::: details Решение и разбор
Тег — вызов generic-функции, и `T` выводится из **всех** props. `getLabel: (item: T) => string` сопоставляется с `String`, а `StringConstructor` вызывается как `(value?: any) => string`. Из параметра `any` TypeScript выводит `T = any`, а `any` удовлетворяет любому ограничению, и проверка `items` выключается. Во второй строке параметр `n` контекстно типизируется из `T`, `T` выводится из `items` как `number`, и `vue-tsc` сообщает: «Type 'number[]' is not assignable to type '{ id: string | number; }[]'» (оба случая проверены).

Исправления:
- не передавать функции с `any` в параметрах в позиции, откуда выводится `T`: `(item) => String(item.id)`;
- закрепить источник вывода: `NoInfer` (TS 5.4+) в колбэке, `getLabel: (item: NoInfer<T>) => string`, тогда `T` выводится только из `items`;
- передать тип явно через `@vue-generic`.

То же бывает с `JSON.parse`, `console.log` и любыми нетипизированными колбэками. `noImplicitAny` тут не поможет: `any` явный, он приходит из `lib.d.ts`.
:::

### 3. Generic-composable над ref · средне

Composable не компилируется. Коллега предлагает `as Ref<T>`. Что не так с этим решением и как сделать честно?

```ts
export function useState<T>(init: T): Ref<T> {
  return ref(init) // error: Type 'UnwrapRef<T>' is not assignable to type 'T'
}
```

::: details Решение и разбор
`ref(init)` имеет тип `Ref<UnwrapRef<T>>`. Для произвольного `T` компилятор не может доказать, что `UnwrapRef<T>` совпадает с `T`. Приведение `as Ref<T>` скомпилируется, но для `useState({ inner: ref(1) })` тип скажет, что `s.value.inner` — `Ref<number>`, а в рантайме `.value` — reactive-прокси, и там `number`. Код по типам `s.value.inner.value` вернёт `undefined`.

Честные варианты (проверены `vue-tsc`):

```ts
// 1. Deep: say what ref really does
export function useState<T>(init: T): Ref<UnwrapRef<T>> {
  return ref(init) as Ref<UnwrapRef<T>>
}

// 2. Shallow: no unwrapping, no cast needed
export function useState<T>(init: T): ShallowRef<T> {
  return shallowRef(init)
}
```

Для generic-контейнеров (кэш, стор данных, результат запроса) обычно выбирают `shallowRef`: тип совпадает с данными, а прокси на всё дерево не нужен ([подробнее о стоимости глубокой реактивности](../performance/vue-performance.md)). `as Ref<T>` безопасен, только если `T` гарантированно не содержит ref.
:::

### 4. Ref на generic-модалку · сложно

`ConfirmDialog.vue` — generic-компонент `generic="T"` с `defineExpose({ open: (payload: T) => Promise<boolean> })`. Родитель вызывает `dialog.value.open(order)`. Типизируйте ref тремя способами и объясните, какой из них сломан.

```ts
const a = useTemplateRef<InstanceType<typeof ConfirmDialog>>('dialog')
const b = useTemplateRef<ComponentExposed<typeof ConfirmDialog>>('dialog')
const c = useTemplateRef('dialog')
```

::: details Решение и разбор
- `a` — ошибка компиляции: generic-компонент для `vue-tsc` — функция, у неё нет construct-сигнатуры, «does not satisfy the constraint 'abstract new (...args: any) => any'». Похожий `ComponentInstance<typeof ConfirmDialog>` из `vue` хуже: он не падает, а молча даёт `never`.
- `b` — правильный явный вариант: `ComponentExposed` из `vue-component-type-helpers` достаёт тип третьего параметра функции (`exposed`).
- `c` — при статическом `ref="dialog"` в шаблоне тип выводится сам, через карту `__VLS_TemplateRefs`, и совпадает с `b` (`| null`). Опечатка в ключе даст ошибку.

Есть тонкость: `T` у ссылки уже не выведен из props конкретного тега, а остаётся параметром. Поэтому `open` принимает `unknown` или ограничение `T`, а не тип `order`. Если тип payload важен, лучше не императивный `open(payload)`, а prop и событие (`v-model:open` + `:payload`) или composable `useConfirm<T>()`. Тогда `T` выводится обычным способом.
:::

## Источники

- [Vue.js: Using Vue with TypeScript — Overview](https://vuejs.org/guide/typescript/overview.html)
- [Vue.js: TypeScript with Composition API](https://vuejs.org/guide/typescript/composition-api.html)
- [Vue.js: TypeScript with Options API](https://vuejs.org/guide/typescript/options-api.html)
- [Vue.js: `<script setup>` — Generics, `defineModel`, `defineSlots`](https://vuejs.org/api/sfc-script-setup.html#generics)
- [Vue.js: Augmenting Global Properties](https://vuejs.org/guide/typescript/options-api.html#augmenting-global-properties)
- [vuejs/language-tools: README и CHANGELOG (`vue-tsc` 3.3.14)](https://github.com/vuejs/language-tools)
- [vuejs/language-tools#5381: TypeScript 7 (`tsgo`) support](https://github.com/vuejs/language-tools/issues/5381)
- [vuejs/language-tools#6170: content mapper (v4 alpha)](https://github.com/vuejs/language-tools/pull/6170)
- [Vue core: CHANGELOG ветки minor (3.6)](https://github.com/vuejs/core/blob/minor/CHANGELOG.md)
- [`vue-component-type-helpers`](https://www.npmjs.com/package/vue-component-type-helpers)
- Исходники: `@vue/reactivity` и `@vue/runtime-core` — `dist/*.d.ts` (`Ref`, `ShallowRef`, `UnwrapRef`, `TemplateRef`, `ComponentInstance`)
