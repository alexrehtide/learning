---
title: Composables
level: ядро
---

# Composables

> **Коротко.** Composable — функция с префиксом `use`, которая через Composition API инкапсулирует логику **с состоянием**: создаёт `ref`, `computed`, watchers, хуки и подписки и возвращает их вызывающему. Особой поддержки рантайма у composable нет. Он работает, потому что вызывается внутри `setup()`, где Vue выставил два глобальных указателя: текущий экземпляр (к нему цепляются хуки и `inject`) и текущий effect scope (в него попадают watchers, `computed` и `onScopeDispose`). Отсюда правило синхронного вызова: после собственного `await` composable пишет уже в пустоту. Соглашения такие: аргументы принимают как `MaybeRefOrGetter` и читают через `toValue`, возвращают обычный объект из `ref`, побочные эффекты убирают в `onScopeDispose`. Вне компонента и для общего состояния используют `effectScope`.

**Связанные темы:** [Реактивность: `ref`, `reactive`, `computed`](./reactivity.md), [`watch` и `watchEffect`](./watchers.md), [Жизненный цикл](./lifecycle.md), [Слоты и provide/inject](./slots-and-provide-inject.md), [Props, emits и `v-model` на компонентах](./props-emits-v-model.md), [Принципы и паттерны проектирования](../architecture/principles-and-patterns.md), [Утечки памяти](../performance/memory-leaks.md), [UI-coding: автокомплит, таблица, дерево](../live-coding/ui-widgets.md), [Мини-реактивность в стиле Vue](../live-coding/mini-reactivity.md), [Замыкания](../javascript/closures.md)

## Теория

Все проверки выполнены на Vue 3.5.45 в Node 26.13.1: компоненты — с happy-dom, SSR — через `@vue/server-renderer`, `<script setup>` — компиляцией `@vue/compiler-sfc`. Те же сценарии повторены на `3.6.0-rc.16`. Отличия касаются только `effectScope` и описаны во врезке про 3.6.

### Что такое composable и чем он не является

Документация определяет composable как функцию, которая «leverages Vue's Composition API to encapsulate and reuse **stateful logic**». Граница проходит по состоянию и времени жизни:

| | Утилита | Composable |
| --- | --- | --- |
| Пример | `formatDate(d)`, `debounce(fn, ms)` | `useMouse()`, `useFetch(url)` |
| Состояние | нет или только в замыкании | `ref`/`computed`, которые меняются со временем |
| Эффекты | нет | watchers, слушатели, таймеры, хуки |
| Где вызывать | где угодно | в `setup()` или внутри `effectScope().run()` |
| Время жизни | время одного вызова | время жизни владельца: компонента или scope |

Composable — это **соглашение**, а не API. Префикс `use` в camelCase не проверяется ни компилятором, ни рантаймом. Он сообщает читателю, что функция привязывается к текущему владельцу и вызывать её в обработчике клика нельзя (задача 2).

Каждый вызов создаёт **свои** `ref`. Два компонента, вызвавших `useCounter()`, получают независимые счётчики. Общим состояние становится, только если объявить его на уровне модуля, вне функции (задача 1).

### Почему вызов должен быть синхронным в `setup`

У composable нет ссылки на компонент, его не передают аргументом. Все API внутри него находят владельца через глобальные указатели, которые выставлены только во время синхронного выполнения `setup()`:

- **`currentInstance`** нужен хукам (`onMounted`, `onUnmounted`, …), `inject`/`provide`, `useId`, `useTemplateRef`, `useSlots`. Хук без экземпляра не регистрируется. Vue предупреждает: «onUnmounted is called when there is no active component instance to be associated with. Lifecycle injection APIs can only be used during execution of setup()».
- **`activeEffectScope`** нужен `watch`, `watchEffect`, `computed` и `onScopeDispose`. У каждого компонента свой scope (`instance.scope`). Вызов `setCurrentInstance(instance)` в runtime-core делает и `instance.scope.on()`, поэтому оба указателя выставляются и снимаются вместе.

Документация называет обе причины прямо: хукам нужно куда регистрироваться, а watchers привязываются к экземпляру, «so that they can be disposed when the instance is unmounted to prevent memory leaks». Как хук попадает в массив экземпляра, разобрано в теме [«Жизненный цикл»](./lifecycle.md). Как effect scope останавливает watchers, разобрано в теме [«`watch` и `watchEffect`»](./watchers.md).

Отсюда три следствия:

- **Можно вызывать в хуке жизненного цикла.** `injectHook` оборачивает колбэк хука в `setCurrentInstance(target)`. Composable, вызванный в `onMounted`, получает и экземпляр, и scope, и его watcher останавливается при размонтировании (проверено). Документация допускает это: «In some cases, you can also call them in lifecycle hooks like `onMounted()`».
- **Нельзя вызывать в обработчике события, `setTimeout`, `.then`.** Указатели там уже сброшены, поэтому watchers не привязаны к компоненту, а `onScopeDispose` предупреждает «onScopeDispose() is called when there is no active effect scope to be associated with» и ничего не регистрирует.
- **Можно вызывать условно.** `setup()` выполняется один раз, поэтому `if (props.track) useMouse()` безопасен, в отличие от React hooks. Но условие читается только при создании компонента: если `props.track` станет `true` позже, composable не вызовется (проверено). Для включения и выключения на лету composable принимает флаг `enabled` как `MaybeRefOrGetter<boolean>`.

### `await`: где контекст восстанавливается, а где нет

В `<script setup>` компилятор оборачивает каждый `await` **верхнего уровня**:

```js
const { user } = (
  ([__temp, __restore] = _withAsyncContext(() => useUser(1))),
  __temp = await __temp,
  __restore(),
  __temp
)
```

`__restore()` возвращает экземпляр после `await`, поэтому composables, вызванные ниже, работают. Документация: «`<script setup>` is the only place where you can call composables **after** using `await`».

Внутрь самого `useUser` компилятор не заглядывает. Если composable — `async`-функция и создаёт watcher или хук после **своего** `await`, контекста уже нет: `withAsyncContext` сбрасывает текущий экземпляр сразу после запуска выражения. Проверено: `getCurrentScope()` после `await` внутри composable возвращает `undefined`, `onUnmounted` даёт предупреждение, а watcher срабатывает и после размонтирования (задача 4). В обычном `async setup()` без компилятора контекст теряется уже после первого `await` верхнего уровня ([подробнее](./lifecycle.md)).

Поэтому асинхронный composable **синхронно** создаёт состояние и эффекты, а результат запроса потом записывает в `ref`: `const { data, loading } = useFetch(url)`. Если нужна возможность ждать результат, возвращают объект с `then` или отдельный промис рядом с `ref`. Создать всё до первого `await` — обязанность автора composable.

### Соглашения: вход и выход

**Аргументы.** Composable принимает значение, ref или геттер. Тип — `MaybeRefOrGetter<T>`, нормализация — `toValue()` (3.3+). `toValue` вызывают **внутри** эффекта: в источнике `watch`, в теле `watchEffect`, в геттере `computed`. Тогда чтение отслеживается. Если нормализовать один раз в начале, composable навсегда запомнит первое значение. Подробно об этой паре — в теме [«Реактивность»](./reactivity.md), ловушка с деструктурированными props — в теме [«Props, emits и `v-model`»](./props-emits-v-model.md). Больше двух-трёх параметров собирают в объект `options`. Так поступает VueUse: `useFetch(url, { immediate, timeout })`.

**Результат.** Документация: «always return a plain, non-reactive object containing multiple refs». Тогда работает `const { x, y } = useMouse()`: деструктурированный `ref` сохраняет связь, а поле `reactive` потеряло бы её. Кому удобнее без `.value`, оборачивает результат сам: `const mouse = reactive(useMouse())`. Ref, который снаружи менять нельзя, отдают через `readonly` или `shallowReadonly`. Запись тогда даёт предупреждение «Set operation on key "value" failed: target is readonly». Изменения идут через функции, которые вернул composable (`refresh`, `reset`).

**Эффекты.** Всё, что composable включил, он и выключает. Сюда входят слушатели, таймеры, observers, запросы в полёте и соединения. DOM-эффекты для SSR запускают в `onMounted`: на сервере хуки монтирования не вызываются.

### `onScopeDispose` против `onUnmounted`

| | `onUnmounted` | `onScopeDispose` |
| --- | --- | --- |
| К чему привязан | к `currentInstance` | к `activeEffectScope` |
| Работает в `effectScope().run()`, в setup store Pinia | нет | да |
| Когда вызывается при размонтировании | после `onBeforeUnmount`, в post-очереди | раньше: при `instance.scope.stop()`, между `onBeforeUnmount` и `onUnmounted` |
| Без владельца | предупреждение про экземпляр | предупреждение про scope, с 3.5 подавляется `failSilently = true` |

Порядок проверен: `beforeUnmount` → `scopeDispose` → `unmounted`. Документация называет `onScopeDispose` «a non-component-coupled replacement of `onUnmounted` in reusable composition functions». Поэтому библиотечные composables используют его. Если владельца может не быть, сначала проверяют `getCurrentScope()`. Так устроен `tryOnScopeDispose` во VueUse: он регистрирует очистку, если scope есть, и возвращает `false`, если нет. Пример — `useEventListener` в теме [«Утечки памяти»](../performance/memory-leaks.md).

> [!WARNING]
> На сервере scope компонента не останавливается, и `onScopeDispose` после `renderToString` не вызывается ([подробнее](../performance/memory-leaks.md)). Composable, который запускает таймер или подписку прямо в `setup`, течёт на сервере, даже если очистка у него написана правильно. Ресурсы, требующие очистки, запускают в `onMounted`.

### `effectScope`: владелец вне компонента

`effectScope()` — тот же механизм, что у компонента, только вручную. `scope.run(fn)` выставляет `activeEffectScope` на время `fn`. Все `watch`, `computed` и `onScopeDispose` внутри собираются в scope, а `scope.stop()` останавливает их разом. Устройство `stop()` в 3.5 (`reactivity/src/effectScope.ts`):

1. останавливает свои эффекты (watchers, `computed`), и у них срабатывает очистка `onWatcherCleanup`;
2. вызывает колбэки `onScopeDispose` в порядке регистрации;
3. останавливает дочерние scope.

**Дочерний scope.** `effectScope()`, созданный внутри активного scope, регистрируется у родителя и останавливается вместе с ним. **`effectScope(true)`** (detached) ни к кому не привязан и живёт, пока его не остановят явно (задача 3). `run()` у остановленного scope в 3.5 не выполняет функцию: «cannot run an inactive effect scope».

Где это нужно:

- **Composable вне компонента**: в тестах, в сторе, в плагине, в фоновом сервисе. Вызов оборачивают в `scope.run()` и останавливают scope, когда сервис больше не нужен.
- **Общее состояние (shared composable).** Слушатель `online` или `resize` нужен десяти компонентам, но подписка должна быть одна. Состояние создают в detached scope при первом вызове, считают подписчиков и останавливают scope, когда уходит последний. Так устроен `createSharedComposable` во VueUse (задача 5). `createGlobalState` создаёт detached scope и не останавливает его никогда.
- **Пересоздание группы эффектов.** Например, по смене ключа: старый scope останавливают, новый создают. Тот же приём применяет setup store Pinia: стор выполняется в scope самой pinia, а `store.$dispose()` его останавливает.

Цена detached scope: Vue его не остановит. Забытый `stop()` — классическая утечка, и в DevTools она выглядит как растущее число подписок.

> [!NOTE]
> Во Vue 3.6 (RC, сверено 2026-11-21: последняя версия `3.6.0-rc.16` от 2026-11-20) `@vue/reactivity` переписан по образцу alien-signals, и `EffectScope` хранит эффекты и дочерние scope в одном связном списке. Публичный API тот же, но два наблюдаемых отличия есть. В задаче 3 дочерний scope остановился **раньше**, чем вызвался `onScopeDispose` родителя, то есть на порядок колбэков полагаться нельзя. `run()` у остановленного scope выполняет функцию без предупреждения. Отдельно для Vapor Mode в release notes `3.6.0-rc.1` сказано: «`getCurrentInstance()` returns `null` in Vapor components». Composable, который лезет во внутренний экземпляр, там сломается, поэтому опирайтесь на `getCurrentScope()` и публичные API. Стабильного 3.6 пока нет.

### Composables против mixins и renderless-компонентов

Документация называет у mixins три недостатка: неясный источник свойств, конфликты имён между mixins разных авторов и неявная связь mixins через общие ключи. Composable — обычная функция. Её результат деструктурируется, поэтому источник виден, имена можно переименовать, а зависимости передаются аргументами: `useFilter(items)`. Разбор с переписыванием mixin — в теме [«Принципы и паттерны проектирования»](../architecture/principles-and-patterns.md).

Renderless-компонент со scoped slot ([как он устроен](./slots-and-provide-inject.md)) делает то же, но добавляет экземпляр компонента в дерево. Цена — память, лишний уровень в DevTools и логика, доступная только из шаблона. Документация советует composable для чистой логики, а компонент — когда переиспользуются логика **и** разметка.

От React hooks composables отличаются моделью выполнения. `setup()` выполняется один раз, поэтому порядок вызовов не важен, условный вызов допустим, нет устаревших замыканий и массивов зависимостей, а `useMemo`/`useCallback` не нужны. Зависимости собирает реактивность. Обратная сторона — правило синхронного вызова и необходимость передавать геттер, а не значение.

### SSR: общее состояние модуля

`const total = ref(0)` на уровне модуля — одна переменная на весь процесс Node. На сервере её видят все запросы всех пользователей. Это **cross-request state pollution** (загрязнение состояния между запросами): в проверке второй `renderToString` показал счётчик `2`, хотя каждый рендер инкрементировал его один раз. Поэтому общее состояние на сервере живёт в экземпляре приложения: в Pinia, в `useState` Nuxt или в `provide` на уровне приложения. VueUse 15 по той же причине на сервере вообще не делится состоянием: `createSharedComposable` начинается с `if (!isClient) return composable`. Подробнее — в теме [«Утечки памяти»](../performance/memory-leaks.md), про гидрацию — в теме «SSR и гидрация» этого раздела.

## Примеры

### `useFetch` с отменой

```ts
import { shallowRef, shallowReadonly, watch, toValue, onScopeDispose, type MaybeRefOrGetter } from 'vue'

export function useFetch<T>(url: MaybeRefOrGetter<string>) {
  const data = shallowRef<T>()
  const error = shallowRef<unknown>()
  const loading = shallowRef(false)
  let controller: AbortController | undefined

  async function execute() {
    controller?.abort() // a newer request supersedes the previous one
    const c = (controller = new AbortController())
    loading.value = true
    error.value = undefined
    try {
      const res = await fetch(toValue(url), { signal: c.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as T
      c.signal.throwIfAborted() // aborted between the two awaits
      data.value = json
    } catch (e) {
      if (!c.signal.aborted) error.value = e
    } finally {
      if (controller === c) loading.value = false
    }
  }

  // toValue inside the source: a ref or getter argument is tracked
  watch(() => toValue(url), execute, { immediate: true })
  // unmount or scope.stop(): cancel the request in flight
  onScopeDispose(() => controller?.abort())

  return {
    data: shallowReadonly(data),
    error: shallowReadonly(error),
    loading: shallowReadonly(loading),
    refresh: execute,
  }
}
```

```vue
<script setup lang="ts">
const props = defineProps<{ id: number }>()
const { data: user, loading, refresh } = useFetch<User>(() => `/api/users/${props.id}`)
</script>
```

Что здесь от соглашений composable:

- **Синхронная часть.** `ref`, watcher и `onScopeDispose` созданы до любого `await`. `await` есть только внутри `execute`, а там уже ничего не регистрируется. Поэтому вызов в `setup` безопасен и без `withAsyncContext`.
- **Вход.** Строка, ref и геттер работают одинаково. Смена `props.id` отменяет прежний запрос: в проверке запрос `/api/users/1` получил `abort`, в `data` попал только ответ `/api/users/2`.
- **Выход.** Обычный объект, деструктуризация работает. `shallowReadonly` запрещает запись `.value` снаружи и при этом не оборачивает сами данные в прокси. `shallowRef` вместо `ref`: ответ заменяется целиком, глубокая реактивность не нужна.
- **Очистка.** После `scope.stop()` запрос в полёте отменён, `loading` сброшен (проверено). Отмена по смене URL сделана через свой `controller`, а не через `onWatcherCleanup`, потому что `refresh()` вызывается и вне watcher. Вариант на `onWatcherCleanup` разобран в теме [«`watch` и `watchEffect`»](./watchers.md).

В SSR такой composable отправит запрос на сервере (`immediate`-watcher выполняется один раз), но `renderToString` его не дождётся. Серверную загрузку делают через `onServerPrefetch` или `useFetch`/`useAsyncData` в Nuxt. Composable поиска с debounce и кэшем — в задаче `useSearch` темы [«UI-coding: автокомплит, таблица, дерево»](../live-coding/ui-widgets.md).

## Вопросы с интервью

::: details Что такое composable и чем он отличается от обычной функции-утилиты
Composable — функция с префиксом `use`, которая через Composition API инкапсулирует логику с состоянием: создаёт `ref`, `computed`, watchers, хуки, подписки и возвращает их. Утилита вроде `formatDate` состояния не держит и вызывается где угодно. Composable привязывается к владельцу — экземпляру компонента или effect scope — и живёт столько же, сколько он. Поэтому вызывать его можно только там, где владелец есть: в `setup()`, в хуке жизненного цикла или в `effectScope().run()`. Каждый вызов создаёт своё состояние, а общим оно становится, только если объявлено на уровне модуля.
:::

::: details Почему composable нужно вызывать синхронно в setup
Внутри composable `onMounted`, `inject`, `watch` и `computed` ищут владельца через глобальные указатели: `currentInstance` для хуков и `inject`, `activeEffectScope` для watchers и `onScopeDispose`. Vue выставляет их на время синхронного выполнения `setup()` и снимает после. В обработчике события, в `setTimeout` или после `await` указателей нет: хук не регистрируется (предупреждение «no active component instance»), watcher не останавливается при размонтировании, очистка не регистрируется. В `<script setup>` компилятор восстанавливает контекст после `await` верхнего уровня через `withAsyncContext`. Внутри хуков жизненного цикла контекст тоже выставлен: `injectHook` оборачивает колбэк в `setCurrentInstance`.
:::

::: details Что сломается, если внутри composable есть await
Всё, что создано после этого `await`. `withAsyncContext` в `<script setup>` восстанавливает экземпляр только в коде компонента, внутрь composable компилятор не заглядывает. Внутри `async`-функции после её собственного `await` текущего экземпляра и scope уже нет. `onUnmounted` выдаёт предупреждение и не регистрируется, а `watch` создаётся без владельца и срабатывает после размонтирования, удерживая данные. Правильная форма — синхронно создать `ref` и эффекты, запустить запрос и записать результат в `ref`, когда он придёт. Если нужно ждать, вернуть рядом промис или сделать результат thenable.
:::

::: details Почему composable возвращает объект из ref, а не reactive
Чтобы результат можно было деструктурировать. `const { x, y } = useMouse()` копирует ссылки на ref-объекты, и связь с состоянием сохраняется. Поле `reactive` при деструктуризации — просто значение на момент чтения. Документация так и рекомендует: «a plain, non-reactive object containing multiple refs». Кто хочет обращаться без `.value`, оборачивает сам: `reactive(useMouse())` разворачивает ref'ы. То, что снаружи менять нельзя, отдают через `readonly`/`shallowReadonly`, а изменения — функциями.
:::

::: details Как composable принимает аргументы, чтобы реагировать на их изменения
Тип параметра — `MaybeRefOrGetter<T>`: значение, ref или геттер. Читать его нужно через `toValue()` внутри отслеживаемого кода: в источнике `watch`, в `watchEffect`, в геттере `computed`. Тогда смена ref или пропса, прочитанного в геттере, перезапускает эффект. Типичная ошибка — `const id = toValue(arg)` в начале функции: composable навсегда запомнит первое значение. Вторая ошибка — передать деструктурированный prop (`useUser(id)`): компилятор подставит `__props.id`, и composable получит число. Передают геттер `() => id`.
:::

::: details Чем onScopeDispose отличается от onUnmounted
`onUnmounted` привязан к экземпляру компонента и вызывается в post-очереди после размонтирования. `onScopeDispose` привязан к активному effect scope. Компонент тоже выполняет `setup` в своём scope, поэтому в компоненте `onScopeDispose` срабатывает при размонтировании, раньше `onUnmounted`: между `onBeforeUnmount` и `onUnmounted`. Главное отличие — `onScopeDispose` работает и вне компонентов: в `effectScope().run()`, в setup store Pinia, в shared composable. Поэтому библиотечные composables чистят ресурсы им, а при неизвестном контексте сначала проверяют `getCurrentScope()`. На сервере не срабатывает ни тот, ни другой.
:::

::: details Что такое effectScope и когда он нужен в composables
Ручной владелец эффектов. `scope.run(fn)` собирает всё, что создано в `fn` (watchers, `computed`, `onScopeDispose`), а `scope.stop()` останавливает это разом: сначала эффекты, потом колбэки очистки, потом дочерние scope. Scope, созданный внутри другого, останавливается вместе с родителем, а `effectScope(true)` (detached) живёт сам по себе. Нужен для composables вне компонента (тесты, сервисы, сторы) и для общего состояния: shared composable создаёт состояние в detached scope при первом вызове, считает подписчиков и останавливает scope, когда уходит последний. Цена detached scope — его не остановит никто, кроме вас.
:::

::: details Чем composables лучше mixins и renderless-компонентов и чем отличаются от React hooks
У mixins три проблемы: неясно, откуда взялось свойство, имена разных mixins конфликтуют, mixins неявно связаны через общие ключи. Composable возвращает значения явно, их можно переименовать при деструктуризации, а зависимости передаются аргументами. Renderless-компонент даёт ту же переиспользуемость, но добавляет экземпляр в дерево. Его оставляют, когда переиспользуется и разметка. От React hooks отличие в модели выполнения: `setup` выполняется один раз, поэтому порядок вызовов не важен, условный вызов допустим, нет устаревших замыканий, массивов зависимостей и `useCallback`. Цена — синхронный вызов в `setup` и передача геттеров вместо значений.
:::

## Задачи

### 1. Что выведет · легко

```js
// useCounter.js
const total = ref(0)

export function useCounter() {
  const count = ref(0)
  const inc = () => { count.value++; total.value++ }
  return { count, total, inc }
}
```

Компоненты `A` и `B` вызывают `useCounter()` и рендерят `` `${name}: ${count} / ${total}` ``. В `A` дважды вызвали `inc`, в `B` — один раз. Что на экране? Что изменится, если этот компонент рендерить на сервере и он вызывает `inc()` в `setup`?

::: details Решение и разбор
`A: 2 / 3` и `B: 1 / 3`. `count` создаётся при каждом вызове composable, поэтому у каждого компонента свой. `total` объявлен в модуле, и это одна переменная на всех, кто импортировал файл (проверено).

На клиенте это осознанный приём — простейшее общее состояние без стора. На сервере модуль один на весь процесс: первый `renderToString` дал `1/1`, второй — `1/2` (проверено). Значение одного запроса видно в ответе другому. Это cross-request state pollution, и вдобавок рассинхрон гидрации: клиент начнёт с `0`. Для SSR общее состояние переносят в экземпляр приложения: Pinia, `useState` в Nuxt или `app.provide`.
:::

### 2. Найдите баг · легко

```vue
<script setup>
function useWindowEvent(type, handler) {
  window.addEventListener(type, handler)
  onScopeDispose(() => window.removeEventListener(type, handler))
}

const width = ref(window.innerWidth)
function startTracking() {
  useWindowEvent('resize', () => { width.value = window.innerWidth })
}
</script>

<template><button @click="startTracking">Track width</button> {{ width }}</template>
```

::: details Решение и разбор
Composable вызывается в обработчике клика. Там нет ни текущего экземпляра, ни effect scope, поэтому `onScopeDispose` выдаёт «onScopeDispose() is called when there is no active effect scope to be associated with» и очистку не регистрирует. Каждый клик добавляет ещё один слушатель, и после размонтирования они остаются. В проверке после двух кликов и размонтирования событие `resize` вызвало оба обработчика. Каждый держит замыкание с `width`, а через него и компонент.

Исправление: вызвать composable в `setup`, а включение сделать параметром.

```js
const enabled = ref(false)
useWindowEvent('resize', () => { width.value = window.innerWidth }, { enabled })
```

Внутри `watch(() => toValue(options.enabled), (on, _, onCleanup) => { … })` добавляет слушатель при `true` и снимает его в `onCleanup`. Watcher принадлежит компоненту и останавливается вместе с ним, а при остановке вызывается и очистка. SSR-замечание: `window.innerWidth` в `setup` на сервере упадёт, начальное значение читают в `onMounted`.
:::

### 3. Что выведет · средне

```js
const src = ref(0)
const parent = effectScope()
let detached

parent.run(() => {
  watchEffect(() => { src.value; onWatcherCleanup(() => log('cleanup')) })
  onScopeDispose(() => log('parent'))
  effectScope().run(() => onScopeDispose(() => log('child')))
  detached = effectScope(true)
  detached.run(() => {
    onScopeDispose(() => log('detached'))
    watch(src, () => log('detached watch'))
  })
  watch(src, () => log('watch'))
})

parent.stop()
src.value++
await nextTick()
detached.stop()
```

::: details Решение и разбор
Vue 3.5.45: `cleanup`, `parent`, `child`, `detached watch`, `detached` (проверено).

- `stop()` сначала останавливает эффекты scope. У `watchEffect` при этом срабатывает очистка: `cleanup`.
- Потом вызываются колбэки `onScopeDispose` самого scope: `parent`.
- Потом останавливаются дочерние scope: `child`. Scope без аргумента, созданный внутри `run`, стал ребёнком `parent`.
- `detached` к `parent` не привязан. Его watcher пережил `parent.stop()` и сработал на `src.value++`: `detached watch`. Обычный `watch` из `parent` уже остановлен.
- `detached` останавливается только явно: `detached`.

Во Vue 3.6 RC порядок другой: `cleanup`, `child`, `parent`, а остальное совпадает. Вывод для кода: очистка не должна зависеть от порядка между scope. Вывод для интервью: detached scope — ответственность автора, Vue его не остановит.
:::

### 4. Найдите баг · средне

```js
// useUser.js
export async function useUser(id) {
  const data = await api.getUser(id)
  const user = ref(data)
  watch(user, (u) => api.saveDraft(u), { deep: true })
  onUnmounted(() => api.flush())
  return { user }
}
```

```vue
<!-- Profile.vue, rendered inside <Suspense> -->
<script setup>
const { user } = await useUser(1)
</script>
```

Профиль открыли и закрыли. Через минуту другой экран меняет тот же объект пользователя (он взят из общего кэша), и черновик продолжает сохраняться. А `api.flush()` не вызвался ни разу. Почему?

::: details Решение и разбор
Компилятор оборачивает `await useUser(1)` в `withAsyncContext` и восстанавливает экземпляр после него, но только в коде `Profile`. Внутри `useUser` после `await api.getUser` текущего экземпляра и scope нет. `withAsyncContext` сбрасывает их сразу после запуска выражения. Поэтому:

- `onUnmounted` выдаёт «onUnmounted is called when there is no active component instance to be associated with…» и не регистрируется, и `flush` не вызывается;
- `watch` создан без владельца и не останавливается при размонтировании. Он держит `user` и продолжает реагировать (проверено: `getCurrentScope()` после `await` внутри composable — `undefined`, watcher сработал после размонтирования, а watcher в самом `Profile` — нет).

Исправление: создать состояние и эффекты синхронно, а данные записать, когда придут.

```js
export function useUser(id) {
  const user = ref(null)
  const ready = api.getUser(toValue(id)).then((d) => { user.value = d })
  watch(user, (u) => u && api.saveDraft(u), { deep: true })
  onScopeDispose(() => api.flush())
  return { user, ready }
}
```

Компонент вызывает `const { user, ready } = useUser(1)` и, если нужен `<Suspense>`, делает `await ready`. Это `await` верхнего уровня, его компилятор обработает. Альтернатива — передать уже загруженные данные в синхронный composable.
:::

### 5. Реализуйте `createSharedComposable` · сложно

Напишите `createSharedComposable(composable)`, который возвращает функцию с той же сигнатурой:

- первый вызов выполняет `composable` и запоминает результат, следующие возвращают тот же объект;
- эффекты composable (слушатели, watchers) не принадлежат первому вызвавшему компоненту и не умирают вместе с ним;
- когда размонтирован последний потребитель, эффекты останавливаются, а следующий вызов создаёт состояние заново;
- вызов вне scope не должен падать.

::: details Решение и разбор
```js
import { effectScope, getCurrentScope, onScopeDispose } from 'vue'

export function createSharedComposable(composable) {
  let subscribers = 0
  let state
  let scope

  return (...args) => {
    subscribers++
    if (!scope) {
      scope = effectScope(true) // detached: not owned by the first caller
      state = scope.run(() => composable(...args))
    }
    if (getCurrentScope()) {
      onScopeDispose(() => {
        if (--subscribers === 0) {
          scope.stop()
          scope = state = undefined
        }
      })
    }
    return state
  }
}

export const useOnline = createSharedComposable(() => {
  const online = shallowRef(navigator.onLine)
  const update = () => { online.value = navigator.onLine }
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
  onScopeDispose(() => {
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  })
  return { online: readonly(online) }
})
```

Проверено: два компонента дали одну подписку. Размонтирование первого её не сняло, размонтирование второго сняло, а новый потребитель подписался заново.

- **Detached scope** — ключевое место. Без `true` scope стал бы ребёнком scope первого компонента и остановился бы при его размонтировании, оставив остальных с мёртвым состоянием.
- **Подсчёт** идёт через `onScopeDispose` в scope потребителя. Он работает и для компонентов, и для ручных `effectScope`.
- **Вне scope** подписчик не может отписаться, поэтому состояние живёт вечно. Это осознанный выбор VueUse: `tryOnScopeDispose` просто возвращает `false`.
- **Аргументы** берутся только из первого вызова. Если они важны, ключуйте кэш по аргументам (`Map<key, { scope, state, subscribers }>`).
- **SSR**: модульный `state` общий для всех запросов. VueUse 15 на сервере возвращает исходный composable без разделения (`if (!isClient) return composable`).

Отличие от `createGlobalState` во VueUse: тот тоже создаёт detached scope, но не считает подписчиков и не останавливает его никогда. Отличие от Pinia: у стора есть devtools, SSR-сериализация состояния и экземпляр на каждое приложение.

Сложность: O(1) на вызов и на отписку.
:::

## Источники

- [Vue.js: Composables](https://vuejs.org/guide/reusability/composables.html)
- [Vue.js: Composition API FAQ — сравнение с mixins и React Hooks](https://vuejs.org/guide/extras/composition-api-faq.html)
- [Vue.js: Reactivity API — Advanced (`effectScope`, `getCurrentScope`, `onScopeDispose`)](https://vuejs.org/api/reactivity-advanced.html)
- [Vue.js: Reactivity API — Utilities (`toValue`, `MaybeRefOrGetter`)](https://vuejs.org/api/reactivity-utilities.html)
- [Vue.js: `<script setup>` — top-level `await`](https://vuejs.org/api/sfc-script-setup.html#top-level-await)
- [Vue RFC 0041: Reactivity Effect Scope](https://github.com/vuejs/rfcs/blob/master/active-rfcs/0041-reactivity-effect-scope.md)
- [Исходники Vue 3.5.45: `reactivity/src/effectScope.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/effectScope.ts)
- [Исходники Vue 3.5.45: `runtime-core/src/apiLifecycle.ts`, `component.ts`, `apiSetupHelpers.ts` (`withAsyncContext`)](https://github.com/vuejs/core/tree/v3.5.45/packages/runtime-core/src)
- [`vuejs/core` CHANGELOG.md, ветка `minor` (3.6.0-rc.1: Vapor Mode, alien-signals)](https://github.com/vuejs/core/blob/minor/CHANGELOG.md)
- [VueUse: Guidelines (соглашения для composables)](https://vueuse.org/guidelines)
- [VueUse: `createSharedComposable`](https://vueuse.org/shared/createSharedComposable/), [`createGlobalState`](https://vueuse.org/shared/createGlobalState/), [`tryOnScopeDispose`](https://vueuse.org/shared/tryOnScopeDispose/)
