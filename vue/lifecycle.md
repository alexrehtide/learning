---
title: Жизненный цикл
level: ядро
---

# Жизненный цикл

> **Коротко.** Хук жизненного цикла — функция, которую `setup()` кладёт в массив на текущем экземпляре компонента, а рендерер вызывает в нужный момент. `before*`-хуки вызываются синхронно, до работы с DOM. `mounted`, `updated` и `unmounted` ставятся в post-очередь планировщика, поэтому дети завершают монтирование раньше родителя. Регистрация привязана к «текущему экземпляру», который существует только во время синхронного выполнения `setup()`. Поэтому хук в `setTimeout` или после `await` в обычном `async setup()` теряется, а в `<script setup>` компилятор восстанавливает экземпляр после `await`. На сервере хуки монтирования не вызываются вовсе.

**Связанные темы:** [Компоненты и шаблоны](./components-and-templates.md), [Директивы](./directives.md), [Реактивность: `ref`, `reactive`, `computed`](./reactivity.md), [`watch` и `watchEffect`](./watchers.md), [Event loop](../javascript/event-loop.md), [Утечки памяти](../performance/memory-leaks.md), [Мини-реактивность в стиле Vue](../live-coding/mini-reactivity.md), [Composables](./composables.md), [`KeepAlive`, `Teleport`, `Suspense`, `Transition` и асинхронные компоненты](./built-in-components.md), [SSR и гидрация](./ssr-and-hydration.md)

## Теория

Все проверки в теме выполнены на Vue 3.5.45 в Node 26.13.1: DOM-сценарии — с happy-dom, SSR — через `@vue/server-renderer`, вывод компилятора — через `@vue/compiler-sfc`, prod-поведение — с `NODE_ENV=production`. Те же сценарии повторены на `3.6.0-rc.15` и дали тот же вывод.

### Как хук попадает в компонент

`onMounted(fn)` ничего не вызывает. Он берёт глобальную переменную `currentInstance` и кладёт обёртку над `fn` в массив экземпляра: `instance.m` для `mounted`, `instance.bm` для `beforeMount` и т. д. (`injectHook` в `runtime-core/src/apiLifecycle.ts`). Обёртка делает три вещи:

- выключает трекинг (`pauseTracking`), чтобы чтение реактивных данных в хуке не подписывало на них рендер;
- снова выставляет `currentInstance` на свой экземпляр, поэтому внутри хука можно зарегистрировать другой хук, например `onUnmounted` внутри `onMounted`;
- вызывает `fn` через `callWithAsyncErrorHandling`, поэтому ошибка и отклонённый промис из `async`-хука попадают в `errorCaptured` и `app.config.errorHandler` (подробно — в [«Промисах»](../javascript/promises.md)).

`currentInstance` выставлен, пока **синхронно** выполняется `setup()`. Место вызова в исходнике не важно: composable, вызванный из `setup()`, регистрирует хуки на вызывающий компонент. Важен стек вызовов.

Если экземпляра нет, хук не регистрируется. В dev Vue предупреждает «onMounted is called when there is no active component instance», в prod молчит.

### Стадии и что доступно на каждой

```text
setup()             props ✔  state ✔   DOM ✘   template refs: null
  beforeCreate      (Options API, after setup)
  created           data(), computed, methods ready; $el: null
onBeforeMount       render not run yet; DOM ✘
  render + patch    children go through the same steps
onMounted           own DOM is in the container, refs filled, sync children mounted
  ── state changes → scheduler (one microtask) ──
onBeforeUpdate      new state, OLD DOM
  render + patch
onUpdated           NEW DOM
  ── unmount ──
onBeforeUnmount     everything still works
  effects stopped, children unmounted, DOM removed
onUnmounted         clean up timers, listeners, connections
```

Чего ждать от `onMounted` (по API-справочнику, подтверждено запуском): собственное DOM-дерево создано и вставлено в контейнер, а все **синхронные** дети смонтированы. В документе DOM окажется, только если контейнер приложения сам в документе. Асинхронные компоненты и дерево внутри `<Suspense>` в гарантию не входят.

Чтобы прочитать DOM после конкретного изменения состояния, нужен `nextTick()`, а не `onUpdated`: `onUpdated` срабатывает после любого обновления компонента, а несколько изменений склеиваются в одно.

### Почему дети монтируются раньше родителя

Рендер-функция компонента выполняется внутри его render-эффекта (`componentUpdateFn` в `runtime-core/src/renderer.ts`). При первом запуске:

1. синхронно вызываются хуки `bm`;
2. `renderComponentRoot` строит VNode-дерево, `patch` создаёт DOM. На каждом дочернем компоненте `patch` рекурсивно проходит те же шаги;
3. хуки `m` **не вызываются**, а ставятся в post-очередь (`queuePostRenderEffect`).

Ребёнок доходит до шага 3 раньше родителя, поэтому его `mounted` стоит в очереди раньше. Очередь выполняется после того, как DOM всего поддерева готов. Отсюда порядок:

```text
P setup → P beforeMount → A setup → A beforeMount → B setup → B beforeMount
→ A mounted → B mounted → P mounted
```

Для корня `app.mount()` сбрасывает post-очередь синхронно: `mounted` всего дерева выполнится до возврата из `mount()`. Компонент, который появился позже (например, через `v-if`), монтируется в задании планировщика. Его `mounted` срабатывает в ближайшей микрозадаче, до `await nextTick()`.

**Обновление** устроено так же: `beforeUpdate` синхронно, затем рендер и `patch`, `updated` в post-очередь. Ребёнок обновляется внутри `patch` родителя и только если изменились его props или слоты (`shouldUpdateComponent`). Изменился prop ребёнка — `P beforeUpdate → A beforeUpdate → A updated → P updated`; изменилось только состояние родителя — `P beforeUpdate → P updated`, хуки ребёнка не вызываются.

**Размонтирование** (`unmountComponent`): синхронно `beforeUnmount`, затем остановка effect scope компонента (render-эффект, `computed`, watchers из `setup()`), рекурсивное размонтирование детей, а `unmounted` — снова в post-очередь. Поэтому все `beforeUnmount` идут подряд сверху вниз, а `unmounted` — снизу вверх: `P beforeUnmount → A beforeUnmount → B beforeUnmount → A unmounted → B unmounted → P unmounted`. Если ребёнок исчезает при обновлении родителя (`v-if` стал ложным), его размонтирование вкладывается между `P beforeUpdate` и `P updated`.

### Options API ↔ Composition API

| Options API | Composition API |
| --- | --- |
| `beforeCreate`, `created` | сам `setup()` |
| `beforeMount` / `mounted` | `onBeforeMount` / `onMounted` |
| `beforeUpdate` / `updated` | `onBeforeUpdate` / `onUpdated` |
| `beforeUnmount` / `unmounted` | `onBeforeUnmount` / `onUnmounted` |
| `errorCaptured` | `onErrorCaptured` |
| `activated` / `deactivated` | `onActivated` / `onDeactivated` |
| `serverPrefetch` | `onServerPrefetch` |
| `renderTracked` / `renderTriggered` | `onRenderTracked` / `onRenderTriggered` |

`beforeDestroy`/`destroyed` из Vue 2 переименованы в `beforeUnmount`/`unmounted`. Если в компоненте есть и `setup()`, и опции, порядок такой: `setup` → `beforeCreate` → `data()` → `created`. `setup()` выполняется **раньше** `beforeCreate`: опции применяет `applyOptions` (`runtime-core/src/componentOptions.ts`) уже после `setup()`. В `beforeCreate` `this.x` из `data` ещё `undefined`. Хуки одного типа вызываются в порядке регистрации, поэтому `onMounted` из `setup()` срабатывает раньше опции `mounted`.

### Синхронная регистрация и `await`

В обычном `async setup()` после первого `await` код продолжается в микрозадаче. К этому времени `setup()` уже вернул промис, `currentInstance` сброшен, и хук теряется. В dev — предупреждение с подсказкой «register lifecycle hooks before the first await statement», в prod — тишина. Composable, вызванный после `await`, ломается так же: его `onUnmounted` не зарегистрирован, и ресурс течёт.

В `<script setup>` верхнеуровневый `await` компилятор оборачивает в `withAsyncContext`:

```js
// @vue/compiler-sfc 3.5.45, script setup: `const data = await fetch(...)`
const data = (
  ([__temp,__restore] = _withAsyncContext(() => fetch('/api').then(r => r.json()))),
  __temp = await __temp,
  __restore(),
  __temp
)
onMounted(() => console.log(box.value))
```

`__restore()` возвращает `currentInstance` после `await`, поэтому `onMounted` ниже регистрируется. Проверено запуском: хук срабатывает, а тот же код в ручном `async setup()` без `withAsyncContext` даёт предупреждение. Компонент с верхнеуровневым `await` асинхронный, ему нужен родительский `<Suspense>`.

### `onUpdated`: почему в нём не меняют состояние

Изменение состояния в `onUpdated` ставит новый рендер, после рендера снова срабатывает `onUpdated` и т. д. В dev планировщик считает повторные запуски одного задания за сброс очереди и после 100 бросает ошибку «Maximum recursive updates exceeded» (проверено: обрыв на 101-м вызове). В prod этой проверки нет: в Node стек переполнился примерно после 9 700 обновлений, в браузере вкладка зависает.

Чем заменить: производное значение — `computed`; реакция на конкретное изменение — `watch` (с `flush: 'post'`, если нужен обновлённый DOM, см. [`watch` и `watchEffect`](./watchers.md)); счётчик для отладки — обычная переменная, не `ref`.

### SSR

На сервере `createHook` не регистрирует хуки вовсе, кроме `serverPrefetch`. Проверено на `renderToString`: вызываются `setup`, `beforeCreate`/`created` из Options API и `onServerPrefetch`, а `onBeforeMount`, `onMounted`, `onBeforeUnmount`, `onUnmounted`, `onActivated` и отладочные хуки — нет.

Следствия:

- код с `window`, `document`, `localStorage` и измерениями DOM — только в `onMounted`. В `setup()` и `created` он упадёт на сервере;
- побочные эффекты, требующие очистки (таймер, подписка), в `setup()` на сервере текут: `onUnmounted` там не наступит. Разбор — в [«Утечках памяти»](../performance/memory-leaks.md);
- `onServerPrefetch(async () => …)` рендерер дожидается перед рендером компонента. Документация предлагает пару: данные загружает сервер, а в `onMounted` клиент загружает их сам, если они пусты (компонент отрендерен только на клиенте). В Nuxt эту работу делают `useFetch`/`useAsyncData`.

### Остальные хуки

- **`onErrorCaptured(err, instance, info)`** ловит ошибки потомков, но не свои. Хуки вызываются снизу вверх по цепочке родителей, ошибка затем уходит в `app.config.errorHandler`; `return false` останавливает всплытие. `info` в dev — строка вида `'mounted hook'`. Подробно — в теме [«Плагины и обработка ошибок»](./plugins-and-error-handling.md).
- **`onActivated` / `onDeactivated`** — для компонентов под `<KeepAlive>`: при переключении компонент не размонтируется, а деактивируется. Проверено: `mounted → activated → deactivated → activated → deactivated → unmounted`, то есть `activated` срабатывает и при первом монтировании. Подробно — в теме [«`KeepAlive`, `Teleport`, `Suspense`, `Transition` и асинхронные компоненты»](./built-in-components.md).
- **`onRenderTracked` / `onRenderTriggered`** — отладка: какие зависимости прочитал рендер и какая из них его перезапустила. Событие содержит `target`, `type` (`get`, `set`, `add`…), `key`, для `trigger` — `oldValue`/`newValue`. Работают только в dev и не на сервере: в prod-сборке колбэк не вызывается.

> [!NOTE]
> Во Vue 3.6 (RC, `3.6.0-rc.15`, сверено 2026-11-16) API хуков не меняется: все сценарии темы на 3.6 дали тот же вывод. В Vapor Mode нет перерендера компонента целиком, но `onBeforeUpdate`/`onUpdated` остаются: по исходникам `runtime-vapor`, они срабатывают вокруг точечных render-эффектов, один раз за сброс очереди. Стабильного 3.6 пока нет.

> [!TIP]
> Пара «создал в `onMounted` — убрал в `onBeforeUnmount`/`onUnmounted`» — главный паттерн хуков. В composable вместо `onUnmounted` удобнее `onScopeDispose`: он работает и внутри `effectScope()` без компонента.

## Примеры

### Подписка на внешний ресурс с очисткой

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

const box = useTemplateRef<HTMLElement>('box')
const width = ref(0)
let observer: ResizeObserver | undefined

onMounted(() => {
  // DOM exists only now; on the server this never runs
  observer = new ResizeObserver(([entry]) => {
    width.value = entry.contentRect.width
  })
  observer.observe(box.value!)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="box">{{ width }}px</div>
</template>
```

`useTemplateRef('box')` в `setup()` вернул `ref` со значением `null`: шаблон ещё не отрендерен. Компилятор связывает ref с элементом через `ref_key: "box"`, и к `onMounted` в нём лежит DOM-узел.

## Вопросы с интервью

::: details Расскажите о жизненном цикле компонента Vue 3
Создание: `setup()` (props и состояние есть, DOM нет), в Options API затем `beforeCreate`/`created`. Монтирование: `beforeMount`, рендер и `patch`, `mounted` — DOM в контейнере, template refs заполнены, синхронные дети смонтированы. Обновление: изменение состояния ставит задание в очередь, в микрозадаче `beforeUpdate` (DOM старый), рендер, `updated` (DOM новый). Размонтирование: `beforeUnmount` (всё ещё работает), остановка эффектов, дети, удаление DOM, `unmounted`. Механика: `before*` вызываются синхронно, `mounted`/`updated`/`unmounted` идут в post-очередь планировщика. Отдельно: `errorCaptured`, `activated`/`deactivated` для `KeepAlive`, `serverPrefetch` для SSR, `renderTracked`/`renderTriggered` для отладки.
:::

::: details В каком порядке вызываются хуки родителя и детей
Монтирование: родитель `setup` и `beforeMount`, затем каждый ребёнок `setup` и `beforeMount`, затем `mounted` детей по порядку и последним `mounted` родителя. Причина: `patch` родителя рекурсивно монтирует детей, а `mounted` каждый компонент ставит в post-очередь в конце своего монтирования; ребёнок заканчивает раньше. Обновление: `beforeUpdate` родителя, ребёнка, `updated` ребёнка, родителя, причём ребёнок обновляется, только если изменились его props или слоты. Размонтирование: `beforeUnmount` сверху вниз, `unmounted` снизу вверх. Поэтому в `mounted` родителя DOM детей уже есть, а в `unmounted` родителя дети уже размонтированы.
:::

::: details Почему хук нельзя зарегистрировать в setTimeout или после await
`onMounted` привязывает колбэк к глобальному `currentInstance`, а он выставлен только во время синхронного выполнения `setup()`. В `setTimeout` и после `await` в `async setup()` экземпляра уже нет: в dev будет предупреждение, в prod хук молча потеряется. Исключение — `<script setup>`: компилятор оборачивает каждый верхнеуровневый `await` в `withAsyncContext` и после него восстанавливает экземпляр. Внутри другого хука регистрировать можно: обёртка хука выставляет `currentInstance` на время вызова.
:::

::: details Чем setup отличается от created и где загружать данные
`setup()` заменяет `beforeCreate` и `created` и выполняется раньше обоих. Запрос, запущенный в `setup()`, стартует раньше, чем запрос из `onMounted`: не ждёт рендера и выполняется на сервере при SSR. Но без `onServerPrefetch` (или `useFetch` в Nuxt) сервер не ждёт его результата, а код с `window` в `setup()` падает на сервере. Правило: данные — в `setup()` через механизм, который понимает SSR; работа с DOM и браузерными API — в `onMounted`.
:::

::: details Какие хуки вызываются при SSR и что из этого следует
Только `setup()`, `beforeCreate`/`created` в Options API и `serverPrefetch`. Хуки монтирования, обновления, размонтирования и `activated` на сервере даже не регистрируются. Следствия: браузерные API — только в `onMounted`; таймеры и подписки из `setup()` на сервере никогда не очищаются и текут; асинхронные данные сервер ждёт только через `onServerPrefetch`, `async setup()` с `<Suspense>` или абстракции фреймворка.
:::

::: details Почему нельзя менять состояние в onUpdated
`onUpdated` вызывается после каждого обновления DOM. Изменение состояния в нём ставит новый рендер, который снова вызывает `onUpdated`. В dev планировщик обрывает цикл после 100 повторов ошибкой «Maximum recursive updates exceeded», в prod проверки нет, и страница зависает. Производное значение — `computed`, реакция на конкретный источник — `watch` (с `flush: 'post'`, если нужен новый DOM), чтение DOM после конкретного изменения — `await nextTick()`.
:::

::: details Гарантирует ли onMounted, что весь DOM поддерева готов
Только для синхронных детей. Асинхронные компоненты (`defineAsyncComponent`) и дерево под `<Suspense>` монтируются позже, со своими `mounted`. Кроме того, DOM компонента в документе, только если корневой контейнер приложения сам в документе. Компонент под `v-if`, появившийся позже, получает `mounted` в микрозадаче, а не синхронно с изменением флага.
:::

## Задачи

### 1. Что выведет · легко

```js
import { createApp, h, onBeforeMount, onMounted } from 'vue'

const log = []
const Item = {
  props: ['id'],
  setup(props) {
    log.push(`setup ${props.id}`)
    onMounted(() => log.push(`mounted ${props.id}`))
    return () => h('li', props.id)
  },
}
const List = {
  setup() {
    log.push('setup list')
    onBeforeMount(() => log.push('beforeMount list'))
    onMounted(() => log.push('mounted list'))
    return () => h('ul', [h(Item, { id: 1 }), h(Item, { id: 2 })])
  },
}

createApp(List).mount(document.createElement('div'))
log.push('after mount')
console.log(log.join(', '))
```

::: details Решение и разбор
```
setup list, beforeMount list, setup 1, setup 2, mounted 1, mounted 2, mounted list, after mount
```

- `beforeMount` родителя синхронный и идёт до рендера, поэтому раньше `setup` детей.
- `mounted` каждого компонента встаёт в post-очередь в конце его монтирования. Дети заканчивают раньше, их `mounted` стоят в очереди первыми.
- `after mount` последний: для корня `app.mount()` сбрасывает post-очередь синхронно.
:::

### 2. Найдите баг · легко

Через какое-то время после навигации между страницами в приложении копятся обработчики `resize`.

```js
import { onUnmounted, ref } from 'vue'

function useWindowWidth() {
  const width = ref(window.innerWidth)
  const update = () => { width.value = window.innerWidth }
  window.addEventListener('resize', update)
  onUnmounted(() => window.removeEventListener('resize', update))
  return width
}

export default {
  async setup() {
    const user = await fetchUser()
    const width = useWindowWidth()
    return { user, width }
  },
}
```

::: details Решение и разбор
`useWindowWidth()` вызван после `await`. К этому моменту `setup()` вернул промис, `currentInstance` сброшен, и `onUnmounted` не зарегистрирован. В dev в консоли предупреждение, в prod — ничего. Обработчик добавлен, но никогда не снимается.

Исправления:

- вызывать composable до первого `await`;
- перейти на `<script setup>`: там компилятор оборачивает `await` в `withAsyncContext` и восстанавливает экземпляр;
- `addEventListener` перенести в `onMounted`: тогда и на сервере не будет обращения к `window`.

Тот же класс бага — хук в `setTimeout`, в `.then()` и в обработчике события.
:::

### 3. Что выведет · средне

```js
import { createApp, h, ref, nextTick,
  onBeforeUpdate, onUpdated, onBeforeUnmount, onUnmounted } from 'vue'

const log = []
const count = ref(0)
const visible = ref(true)

const Child = {
  props: ['count'],
  setup(props) {
    onBeforeUpdate(() => log.push('child beforeUpdate'))
    onUpdated(() => log.push('child updated'))
    onBeforeUnmount(() => log.push('child beforeUnmount'))
    onUnmounted(() => log.push('child unmounted'))
    return () => h('span', props.count)
  },
}
const Parent = {
  setup() {
    onBeforeUpdate(() => log.push('parent beforeUpdate'))
    onUpdated(() => log.push('parent updated'))
    return () => h('div', visible.value ? h(Child, { count: count.value }) : 'empty')
  },
}

createApp(Parent).mount(document.createElement('div'))
count.value++
count.value++
await nextTick()
log.push('---')
visible.value = false
await nextTick()
console.log(log.join(', '))
```

::: details Решение и разбор
```
parent beforeUpdate, child beforeUpdate, child updated, parent updated, ---,
parent beforeUpdate, child beforeUnmount, child unmounted, parent updated
```

- Два изменения `count` в одном синхронном куске — одно задание в очереди и один проход хуков.
- Ребёнок обновляется внутри `patch` родителя, потому что изменился его prop. Его `updated` встаёт в post-очередь раньше родительского.
- Размонтирование ребёнка происходит внутри обновления родителя: `beforeUnmount` синхронно во время `patch`, `unmounted` — в post-очереди, но раньше `parent updated`.
:::

### 4. Найдите баг · средне

Разработчик добавил в компонент счётчик перерисовок для отладки. В dev консоль показывает «Maximum recursive updates exceeded», а prod-сборка зависает.

```vue
<script setup>
import { ref, onUpdated } from 'vue'

const props = defineProps(['items'])
const renders = ref(0)
onUpdated(() => { renders.value++ })
</script>

<template>
  <ul><li v-for="item in props.items" :key="item.id">{{ item.title }}</li></ul>
  <small>renders: {{ renders }}</small>
</template>
```

::: details Решение и разбор
`renders` читается в шаблоне, значит рендер подписан на него. Любое обновление вызывает `onUpdated`, тот меняет `renders`, это ставит новый рендер, после него снова `onUpdated`. В dev планировщик обрывает цикл на 101-м повторе, в prod проверки нет.

Исправления:

- счётчик — обычная переменная (`let renders = 0`) и вывод в консоль, а не в шаблон;
- для отладки, что именно вызвало перерисовку, — `onRenderTriggered((e) => console.log(e.key, e.oldValue, e.newValue))`. Он работает только в dev и не трогает состояние;
- общее правило: в `onUpdated` читают DOM, но не меняют состояние, от которого зависит рендер.
:::

### 5. Реализуйте хуки жизненного цикла · сложно

Реализуйте `onBeforeMount`, `onMounted`, `onBeforeUnmount`, `onUnmounted` и функции `mount(def)`/`unmount(instance)` для дерева компонентов вида `{ setup?, children? }`. Порядок вызовов должен совпадать с Vue. Хук, вызванный вне `setup()`, выводит предупреждение. Внутри хука можно зарегистрировать другой хук.

```js
const log = []
const comp = (name, children = []) => ({
  children,
  setup() {
    log.push(`${name} setup`)
    onBeforeMount(() => log.push(`${name} beforeMount`))
    onMounted(() => {
      log.push(`${name} mounted`)
      onUnmounted(() => log.push(`${name} unmounted`))
    })
    onBeforeUnmount(() => log.push(`${name} beforeUnmount`))
  },
})
const app = mount(comp('P', [comp('A'), comp('B')]))
// P setup, P beforeMount, A setup, A beforeMount, B setup, B beforeMount, A mounted, B mounted, P mounted
unmount(app)
// P beforeUnmount, A beforeUnmount, B beforeUnmount, A unmounted, B unmounted, P unmounted
```

::: details Решение и разбор
```js
let currentInstance = null
const postQueue = []

function setCurrent(instance) {
  const prev = currentInstance
  currentInstance = instance
  return () => { currentInstance = prev }
}

function injectHook(type, hook) {
  const instance = currentInstance
  if (!instance) return console.warn(`${type}: no active component instance`)
  ;(instance[type] ??= []).push(() => {
    const reset = setCurrent(instance) // hooks may register other hooks
    try { hook() } finally { reset() }
  })
}

export const onBeforeMount = (fn) => injectHook('bm', fn)
export const onMounted = (fn) => injectHook('m', fn)
export const onBeforeUnmount = (fn) => injectHook('bum', fn)
export const onUnmounted = (fn) => injectHook('um', fn)

function mountComponent(def) {
  const instance = { def, children: [] }
  const reset = setCurrent(instance)
  try { def.setup?.() } finally { reset() }
  instance.bm?.forEach((h) => h())
  instance.children = (def.children ?? []).map(mountComponent)
  if (instance.m) postQueue.push(...instance.m)
  return instance
}

function unmountComponent(instance) {
  instance.bum?.forEach((h) => h())
  instance.children.forEach(unmountComponent)
  if (instance.um) postQueue.push(...instance.um)
}

function flushPost() {
  for (let i = 0; i < postQueue.length; i++) postQueue[i]()
  postQueue.length = 0
}

export const mount = (def) => { const i = mountComponent(def); flushPost(); return i }
export const unmount = (instance) => { unmountComponent(instance); flushPost() }
```

- `setCurrent` возвращает функцию сброса, а `try/finally` гарантирует сброс при исключении в `setup`. Иначе следующий компонент зарегистрирует хуки на чужой экземпляр. Во Vue так же: `setCurrentInstance` возвращает `reset`.
- Обёртка хука выставляет экземпляр на время вызова, поэтому `onUnmounted` внутри `onMounted` попадает на нужный компонент.
- `before*` вызываются сразу, `mounted`/`unmounted` копятся в `postQueue`. Ребёнок заканчивает монтирование раньше родителя — отсюда порядок «дети, затем родитель».
- `flushPost` идёт по индексу, а не через `forEach` по копии: хуки, поставленные во время сброса, тоже выполнятся.
- Чего нет по сравнению с Vue: обновлений, сортировки очереди, `Suspense` (у него своя очередь эффектов), обработки ошибок через `callWithAsyncErrorHandling`, отключения трекинга внутри хуков.

Сложность: O(n) по времени и памяти на монтирование и размонтирование дерева из n компонентов.
:::

## Источники

- [Vue.js: Lifecycle Hooks (руководство, диаграмма)](https://vuejs.org/guide/essentials/lifecycle.html)
- [Vue.js: Composition API — Lifecycle Hooks](https://vuejs.org/api/composition-api-lifecycle.html)
- [Vue.js: Options API — Lifecycle](https://vuejs.org/api/options-lifecycle.html)
- [Vue.js: Server-Side Rendering — Component Lifecycle Hooks](https://vuejs.org/guide/scaling-up/ssr.html#component-lifecycle-hooks)
- [Vue.js: `<script setup>` — Top-level `await`](https://vuejs.org/api/sfc-script-setup.html#top-level-await)
- [Vue.js: Suspense](https://vuejs.org/guide/built-ins/suspense.html)
- [Vue 3 Migration Guide: переименование `destroyed` в `unmounted`](https://v3-migration.vuejs.org/breaking-changes/#other-minor-changes)
- [Исходники Vue 3.5.45: `runtime-core/src/apiLifecycle.ts`, `renderer.ts`, `componentOptions.ts`, `apiSetupHelpers.ts`](https://github.com/vuejs/core/tree/v3.5.45/packages/runtime-core/src)
- [`vuejs/core` CHANGELOG.md, ветка `minor` (3.6)](https://github.com/vuejs/core/blob/minor/CHANGELOG.md)
