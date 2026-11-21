---
title: '`KeepAlive`, `Teleport`, `Suspense`, `Transition` и асинхронные компоненты'
level: ядро
---

# `KeepAlive`, `Teleport`, `Suspense`, `Transition` и асинхронные компоненты

> **Коротко.** Встроенные компоненты — это не обычные компоненты, а особые типы, которые рендерер обрабатывает отдельно. `<KeepAlive>` при скрытии не размонтирует компонент. Он переносит DOM в отсоединённый контейнер и хранит экземпляр в `Map` по ключу. `<Teleport>` оставляет детей в логическом дереве Vue, но вставляет их DOM в другое место документа. `<Suspense>` (до сих пор экспериментальный) показывает `fallback`, пока не завершатся все асинхронные `setup()` в дереве. `<Transition>` вешает классы на кадрах и узнаёт конец анимации по `getComputedStyle`. `defineAsyncComponent` — обёртка, которая один раз вызывает `loader` и сама показывает состояния загрузки и ошибки.

**Связанные темы:** [Компоненты и шаблоны](./components-and-templates.md), [Жизненный цикл](./lifecycle.md), [Слоты и provide/inject](./slots-and-provide-inject.md), [Composables](./composables.md), [Конвейер рендеринга](../browser/rendering-pipeline.md), [Стеки и очереди](../algorithms/stacks-and-queues.md), [Производительность Vue и Nuxt](../performance/vue-performance.md), [Оптимизация загрузки](../performance/loading.md), [Утечки памяти](../performance/memory-leaks.md), [UI-coding: базовые компоненты на Vue](../live-coding/ui-components.md), [SSR и гидрация](./ssr-and-hydration.md)

## Теория

Все проверки в теме выполнены на Vue 3.5.45 в Node 26.13.1: DOM-сценарии — с happy-dom, SSR — через `@vue/server-renderer`, вывод компилятора — через `@vue/compiler-sfc`. Те же сценарии повторены на `3.6.0-rc.16` и дали тот же вывод.

### Чем встроенный компонент отличается от обычного

Компилятор импортирует встроенные компоненты напрямую, а не через `resolveComponent`. Неиспользуемые выпадают из бандла при tree-shaking. Рендерер узнаёт их по флагам `__isKeepAlive`, `__isTeleport`, `__isSuspense`, а не по сравнению с импортом, чтобы не тянуть их код в каждое приложение.

```js
// @vue/compiler-sfc 3.5.45: <KeepAlive :max="10"><component :is="view" /></KeepAlive>
_createBlock(_KeepAlive, { max: 10 }, [
  (_openBlock(), _createBlock(_resolveDynamicComponent(_ctx.view)))
], 1024 /* DYNAMIC_SLOTS */)

// <Teleport to="#modals" defer><div>m</div></Teleport>
_createBlock(_Teleport, { to: "#modals", defer: "" }, [ /* children as an array, not a slot */ ])
```

`Teleport` и `Suspense` реализованы внутри рендерера (`process`), у них нет экземпляра компонента. `KeepAlive` и `Transition` — настоящие компоненты с `setup()`, которые работают с внутренними функциями рендерера: `move`, `patch` и хуками перехода на VNode.

### `KeepAlive`: кэш экземпляров

Внутри `KeepAlive` (`runtime-core/src/components/KeepAlive.ts`) лежат `cache: Map<key, VNode>`, `keys: Set<key>` и `storageContainer`, отсоединённый `div`. Ключ — `vnode.key`, а без него — сам тип компонента. В рендер-функции `KeepAlive` происходит следующее:

1. Берёт единственного ребёнка слота. Если детей несколько, выдаёт предупреждение «KeepAlive should contain exactly one component child» и ничего не кэширует. Если ребёнок не компонент, возвращает его как есть.
2. Проверяет имя компонента по `include`/`exclude`. Не подошёл — рендерит без кэша.
3. Ключ найден в `cache` — берёт оттуда `el` и `component` и ставит флаг `COMPONENT_KEPT_ALIVE`: рендерер не монтирует компонент заново, а вызывает `activate`.
4. Ставит флаг `COMPONENT_SHOULD_KEEP_ALIVE`: при уходе рендерер вызовет `deactivate` вместо `unmount`.

`deactivate` переносит DOM в `storageContainer` и ставит `onDeactivated` в post-очередь. `activate` переносит DOM обратно, патчит его новыми props и вызывает `onActivated`. `setup()` повторно не выполняется, а состояние, DOM, позиция прокрутки внутри компонента и введённый текст сохраняются.

**Имя для `include`/`exclude`** — опция `name`, а в `<script setup>` — `__name`, который компилятор выводит из имени файла (`UserList.vue` → `__name: 'UserList'`, проверено). Шаблон — строка через запятую, `RegExp` или массив.

**`max` — это LRU.** При попадании в кэш ключ переставляется в конец `keys` (`delete` + `add`). Если после добавления нового ключа `keys.size > max`, вытесняется первый ключ: его экземпляр размонтируется по-настоящему. Устройство такого кэша разобрано в [«Стеках и очередях»](../algorithms/stacks-and-queues.md#lru-кэш-на-map).

**Хуки.** `onActivated` срабатывает и при первом монтировании, после `onMounted`. Он регистрируется не только на самом компоненте, но и на корне под `KeepAlive` (`injectToKeepAliveRoot`). Поэтому `onActivated` и `onDeactivated` получают и вложенные потомки закэшированного компонента. Порядок — снизу вверх, как у `mounted`.

> [!WARNING]
> Деактивированный компонент **жив**: его effect scope не остановлен. Проверено: `watch` на глобальный `ref` срабатывает, а рендер выполняется и вызывает `onUpdated`, хотя компонент скрыт. Таймеры из `onMounted` тоже продолжают работать: `onUnmounted` не наступит, пока компонент в кэше. Поэтому подписки и опрос сервера ставят на паузу в `onDeactivated` и возобновляют в `onActivated`, а `max` ограничивают. Без `max` кэш растёт на каждый новый ключ ([подробнее об утечках](../javascript/memory-and-gc.md#vue-где-здесь-сборка-мусора)).

На сервере `KeepAlive` просто рендерит ребёнка: в SSR-контексте нет рендерера, и кэш не создаётся.

### `Teleport`: другой DOM, то же дерево

`<Teleport to="#modals">` вставляет на место компонента два комментария, `<!--teleport start-->` и `<!--teleport end-->`, а детей монтирует в цель `to`. Это CSS-селектор или DOM-узел. Логически дети остаются на месте:

- props, `provide`/`inject`, `emit`, слоты и `$parent` работают как без телепорта;
- нативные DOM-события всплывают по **DOM**: `@click` на обёртке компонента клик из модалки, вынесенной в `body`, не поймает;
- scoped-стили применяются: атрибут `data-v-*` ставится на элементы, где бы они ни оказались.

Зачем это нужно: модалка внутри `overflow: hidden`, `transform` или своего контекста наложения обрезается и перекрывается соседями. В `body` она от этого свободна. Нативный `<dialog>` с top layer решает ту же задачу без телепорта ([«UI-coding: базовые компоненты на Vue»](../live-coding/ui-components.md)).

**Цель должна существовать до монтирования.** `resolveTarget` вызывает `querySelector` в момент монтирования `Teleport`. Если цель рендерит тот же компонент ниже по шаблону, её ещё нет. Проверено: dev-предупреждение «Failed to locate Teleport target with selector "#modals"», и контент не отрисован вообще.

- **`defer` (3.5)** откладывает монтирование в post-очередь, после текущего цикла рендера. Цель из того же дерева к этому моменту уже есть. Внутри ожидающего `Suspense` телепорт откладывается так же.
- **`disabled`** рендерит детей на месте, между комментариями. Переключение переносит DOM, а не пересоздаёт его: состояние сохраняется. Пример — модалка на десктопе, инлайн-блок на мобильном.
- Несколько телепортов в одну цель дописывают детей по порядку монтирования.

**`<Transition>` вокруг `<Teleport>`** работает с 3.5: хуки получают телепортированный элемент. Проверено: при уходе `leave`-классы стоят на `<div class="modal">` в `body`, и узел удаляется только после `done`.

**SSR.** `renderToString(app, ctx)` не вставляет телепорты в HTML. На месте остаются только комментарии, а разметка копится в `ctx.teleports['#modals']`, и её вставляют в шаблон страницы сами. При гидрации Vue ищет начало контента внутри цели, поэтому документация советует отдельный контейнер вместо `body`: в `body` много другой серверной разметки. Простой обход — рендерить `Teleport` только после монтирования на клиенте.

### `Suspense`: ожидание асинхронного дерева

> [!WARNING]
> `<Suspense>` — экспериментальная возможность. При первом использовании dev-сборка пишет «&lt;Suspense&gt; is an experimental feature and its API will likely change». Статус не изменился с Vue 3.0, и `3.6.0-rc.16` пишет то же самое. Nuxt и Vue Router его используют, но API может измениться.

`Suspense` ждёт **асинхронные зависимости** в своём дереве. Их два вида:

- компонент с `async setup()` или с верхнеуровневым `await` в `<script setup>`;
- асинхронный компонент (`defineAsyncComponent`): по умолчанию он `suspensible`, и внутри `Suspense` его опции `loadingComponent`, `errorComponent`, `delay` и `timeout` игнорируются. Отключается опцией `suspensible: false`.

Механика: дерево `#default` рендерится в отсоединённый контейнер. Каждая встреченная зависимость увеличивает счётчик `deps`, а пока он не ноль, показывается `#fallback`. Хуки `mounted` всего ожидающего дерева, включая синхронные компоненты, буферизуются в `suspense.effects`. Когда последняя зависимость разрешилась, дерево переносится в DOM, и буфер сбрасывается. Проверено: `pending → fallback`, затем `resolve`, и только потом `mounted` у всех компонентов дерева.

**После первого разрешения** `Suspense` возвращается в `pending`, только если сменился **корневой** узел `#default`. Новые асинхронные компоненты глубже по дереву этого не вызывают. При возврате старый контент остаётся на экране, пока новый не готов. Проп `timeout` (мс) переключает на `fallback`, если ожидание дольше. Проверено: без `timeout` при смене страницы виден старый `<p>A</p>`, с `timeout="0"` сразу `loading`.

**Вложенный `Suspense`** внешний считает синхронным: внутренний сам показывает свой `fallback`. Проп `suspensible` (3.3) передаёт зависимости внутреннего наружу, и тогда ожидание общее.

**Ошибки.** Своего состояния ошибки у `Suspense` нет. Ошибку async `setup` ловят `onErrorCaptured` выше по дереву или `app.config.errorHandler`. Проверено: после ошибки `Suspense` всё равно разрешается, и упавший компонент рендерится пустым комментарием. UI ошибки делают сами: флаг в `onErrorCaptured` и `v-if`.

С [роутером](./vue-router.md) порядок вложения такой: `RouterView` → `Transition` → `KeepAlive` → `Suspense` → компонент (пример ниже).

### `Transition` и `TransitionGroup`

`<Transition>` анимирует вход и уход **одного** элемента или компонента с одним корневым элементом. Срабатывает на `v-if`, `v-show`, смену `key` и `<component :is>`. Компилятор добавляет `persisted: ""` к `Transition` вокруг `v-show`: элемент не вставляется и не удаляется, хуки вызывает директива. Компонент с несколькими корнями анимировать нельзя: предупреждение «Component inside &lt;Transition&gt; renders non-element root node that cannot be animated», и анимации нет.

Классы для `name="fade"` (без `name` — префикс `v-`), проверено логом `className` в хуках:

```text
enter: beforeEnter → [fade-enter-from fade-enter-active] → next frame → [fade-enter-active fade-enter-to] → afterEnter → []
leave: beforeLeave → [fade-leave-from fade-leave-active] → next frame → [fade-leave-active fade-leave-to] → afterLeave → element removed
```

Как Vue узнаёт конец (`runtime-dom/src/components/Transition.ts`):

- `*-to` ставится через двойной `requestAnimationFrame`, а перед уходом делается принудительный reflow. Зачем, разобрано в [«Конвейере рендеринга»](../browser/rendering-pipeline.md#vue-где-рождается-layout);
- после этого `getComputedStyle` даёт `transition-duration`/`animation-duration` и задержки. Vue ждёт `transitionend`/`animationend` по числу свойств и страхуется `setTimeout(timeout + 1)`;
- длительность ноль (CSS не подключился, опечатка в `name`) — переход завершается сразу, элемент исчезает без анимации;
- проп `:duration` задаёт время явно, `type` выбирает между transition и animation, если есть оба.

**JS-хуки**: `onBeforeEnter`, `onEnter(el, done)`, `onAfterEnter`, `onEnterCancelled` и те же для `leave`. Если хук объявил второй параметр `done`, Vue ждёт его вызова, а не конца CSS. С `:css="false"` CSS-детекция отключена совсем, это экономит `getComputedStyle`.

**`mode`.** По умолчанию уход и вход идут одновременно, и оба элемента на время в DOM. `out-in`: новый элемент монтируется после `afterLeave` старого, проверено. `in-out` — наоборот. `appear` анимирует первое появление.

**`<TransitionGroup>`** — для списков: `mode` нет, каждый ребёнок обязан иметь `key`, обёртка рендерится только с `tag`, классы ставятся на элементы. Перемещения анимируются классом `*-move` по технике FLIP. Механика (`getBoundingClientRect` до и после патча, обратный `transform`, reflow) — в [«Конвейере рендеринга»](../browser/rendering-pipeline.md).

### `defineAsyncComponent`

`defineAsyncComponent(() => import('./Chart.vue'))` возвращает компонент-обёртку `AsyncComponentWrapper`. Сборщик выносит `import()` в отдельный чанк ([«Оптимизация загрузки»](../performance/loading.md)). Как устроена обёртка (`runtime-core/src/apiAsyncComponent.ts`):

- `loader` вызывается один раз на определение: промис кэшируется, результат хранится в замыкании. Проверено: два экземпляра — один вызов. Следующие экземпляры рендерятся синхронно;
- модуль с `default` разворачивается, если это настоящий ES-модуль (`__esModule` или `Symbol.toStringTag === 'Module'`). Обычный объект `{ default }` не разворачивается;
- `delay` по умолчанию **200 мс**: столько обёртка ничего не показывает, чтобы загрузчик не мигал на быстрой сети. Потом — `loadingComponent`;
- `timeout` по умолчанию не задан. По истечении показывается `errorComponent` с prop `error`, **но загрузка не отменяется**: проверено, поздний успех заменяет ошибку на компонент;
- при ошибке промис сбрасывается, поэтому следующий монтаж грузит заново. `onError(error, retry, fail, attempts)` позволяет повторить загрузку сразу;
- внутри `Suspense` (и при SSR) обёртка сама становится async-зависимостью и возвращает промис из `setup()`.

**Ленивая гидрация (3.5)**: `defineAsyncComponent({ loader, hydrate: hydrateOnVisible() })`. Сервер рендерит HTML сразу, а гидрация откладывается до срабатывания стратегии (`loader` при этом вызывается сразу, [подробнее](./ssr-and-hydration.md#ленивая-гидрация-3-5)): `hydrateOnIdle`, `hydrateOnVisible`, `hydrateOnMediaQuery`, `hydrateOnInteraction` или своя функция. Если компонент обновился до гидрации, Vue пропускает её с предупреждением. Обзор и связь с метриками — в [«Производительности Vue и Nuxt»](../performance/vue-performance.md).

> [!NOTE]
> Во Vue 3.6 (RC, `3.6.0-rc.16`, сверено 2026-11-21) поведение VDOM-версий не меняется: все сценарии темы дали тот же вывод. Для Vapor Mode в `@vue/runtime-vapor` есть отдельные `VaporKeepAlive`, `VaporTeleport`, `VaporTransition`, `VaporTransitionGroup` и `defineVaporAsyncComponent`. Своего `Suspense` у Vapor нет: Vapor-компонент можно рендерить только внутри VDOM-`Suspense`. Стабильного 3.6 пока нет.

## Примеры

### Модалка: `Teleport`, `Transition` и `defer`

```vue
<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <!-- the target is rendered later by App.vue, so `defer` is required -->
  <Teleport to="#modals" defer>
    <Transition name="fade">
      <div v-if="open" class="backdrop" @click.self="open = false">
        <div role="dialog" aria-modal="true"><slot /></div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
```

`Transition` внутри `Teleport` следит за `v-if` своего ребёнка. Состояние `open` живёт в родителе, `slot` берёт контекст родителя, scoped-класс `.backdrop` применяется в `#modals`.

### Роутер, кэш и ожидание вместе

```vue
<template>
  <RouterView v-slot="{ Component, route }">
    <template v-if="Component">
      <Transition mode="out-in">
        <KeepAlive :include="['FeedPage', 'SearchPage']" :max="5">
          <Suspense>
            <component :is="Component" :key="route.fullPath" />
            <template #fallback>Loading…</template>
          </Suspense>
        </KeepAlive>
      </Transition>
    </template>
  </RouterView>
</template>
```

`Transition` снаружи анимирует смену страниц. `KeepAlive` кэширует, а `:key="route.fullPath"` даёт разным параметрам маршрута разные записи кэша. `Suspense` ждёт async `setup` страницы. `mode="out-in"` нужен, чтобы две страницы не стояли в DOM одновременно.

## Вопросы с интервью

::: details Что происходит с компонентом под KeepAlive, когда его скрывают
Он не размонтируется. Рендерер вызывает `deactivate`: DOM переносится в отсоединённый `div`, экземпляр остаётся в `Map` по ключу (`key` или тип компонента), в post-очереди срабатывает `onDeactivated`. При возврате DOM переносится обратно, патчится новыми props, срабатывает `onActivated`. `setup()` повторно не выполняется, и всё состояние на месте. Effect scope не остановлен: watchers и рендер продолжают реагировать на изменения, таймеры идут. Поэтому подписки ставят на паузу в `onDeactivated`. `onActivated` срабатывает и при первом монтировании, а также у вложенных потомков.
:::

::: details Как работают include, exclude и max
`include`/`exclude` сравниваются с именем компонента: опция `name` или `__name`, который `<script setup>` выводит из имени файла. Шаблон — строка через запятую, `RegExp` или массив. Компонент, который не прошёл фильтр, рендерится без кэша. При изменении фильтров `KeepAlive` в post-watcher выкидывает из кэша неподходящие записи. `max` включает LRU: ключи хранятся в `Set`, попадание переставляет ключ в конец, при переполнении вытесняется первый (самый давний), и его экземпляр размонтируется по-настоящему. Без `max` кэш растёт неограниченно.
:::

::: details Зачем нужен Teleport и что он меняет, а что нет
Он переносит DOM детей в другое место документа, обычно в контейнер в `body`. Так модалка или тост избавляются от `overflow: hidden`, `transform` и чужого контекста наложения. Логическое дерево Vue не меняется: props, `emit`, `provide`/`inject`, слоты и scoped-стили работают как на месте. Меняется DOM: нативные события всплывают от нового места, а селекторы родителя вида `.page .modal` не сработают. Цель должна существовать к монтированию, иначе контента не будет. В 3.5 проп `defer` откладывает монтирование до конца цикла рендера. При SSR разметка телепортов приходит в `ctx.teleports`, и её вставляют в страницу вручную.
:::

::: details Что такое Suspense и чего он ждёт
Экспериментальный встроенный компонент, его статус не изменился с 3.0. Он ждёт асинхронные зависимости дерева `#default`: компоненты с `async setup()` или верхнеуровневым `await` в `<script setup>` и `suspensible`-асинхронные компоненты. Пока счётчик зависимостей не ноль, показывается `#fallback`, а `mounted` всего дерева буферизуются. После разрешения `Suspense` возвращается в ожидание только при смене корневого узла `#default`. Старый контент при этом виден, пока не истечёт `timeout`. Ошибки он не обрабатывает: их ловят через `onErrorCaptured` выше. Вложенный `Suspense` внешний считает синхронным, если у внутреннего нет `suspensible`.
:::

::: details Как Transition понимает, что анимация закончилась
После вставки `*-to`-класса (через двойной rAF) Vue читает `getComputedStyle(el)`: длительности и задержки `transition` и `animation`. Он берёт максимум, подписывается на `transitionend` или `animationend` и считает события по числу свойств, а для надёжности ставит `setTimeout` на `timeout + 1`. Если длительность ноль, переход завершается сразу: так выглядит баг «элемент исчезает без анимации», когда CSS не подключился. Явное время задаёт `:duration`. Если JS-хук объявил параметр `done`, Vue ждёт его, а `:css="false"` отключает CSS-детекцию совсем.
:::

::: details Чем defineAsyncComponent отличается от ленивого маршрута и что он делает сверх import
Ленивый маршрут — функция `() => import()`, её вызывает Vue Router при навигации. `defineAsyncComponent` делает из загрузчика компонент, который можно поставить в любой шаблон. Сверх `import()` обёртка: вызывает `loader` один раз и кэширует результат; до `delay` (200 мс) ничего не показывает, потом `loadingComponent`; по `timeout` показывает `errorComponent`, но загрузку не отменяет; сбрасывает промис при ошибке и даёт `onError` с `retry`. Внутри `Suspense` она становится async-зависимостью, и собственные состояния загрузки отключаются. С 3.5 — опция `hydrate` для ленивой гидрации при SSR.
:::

::: details В каком порядке вкладывать RouterView, Transition, KeepAlive и Suspense
`RouterView` со слотом `{ Component }` → `Transition` → `KeepAlive` → `Suspense` → `<component :is="Component">`. `Transition` и `KeepAlive` требуют одного ребёнка-компонента, поэтому стоят над `Suspense`: анимируется и кэшируется вся страница. `Suspense` прямо над страницей ждёт её async `setup`. Документация подчёркивает, что порядок важен, а ненужные обёртки можно просто убрать. `KeepAlive` с ребёнком-`Suspense` берёт ключ и имя из компонента внутри него, поэтому кэшируется страница. `mode="out-in"` убирает момент, когда в DOM две страницы.
:::

## Задачи

### 1. Что выведет · средне

```js
import { createApp, h, ref, nextTick, KeepAlive,
  onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'

const log = []
const mk = (name) => ({
  name,
  setup() {
    onMounted(() => log.push(`${name} mounted`))
    onActivated(() => log.push(`${name} activated`))
    onDeactivated(() => log.push(`${name} deactivated`))
    onUnmounted(() => log.push(`${name} unmounted`))
    return () => h('p', name)
  },
})
const comps = { A: mk('A'), B: mk('B'), C: mk('C') }
const view = ref('A')
createApp({ render: () => h(KeepAlive, { max: 2 }, () => h(comps[view.value])) })
  .mount(document.createElement('div'))

for (const v of ['B', 'C', 'A']) {
  log.push(`-> ${v}`)
  view.value = v
  await nextTick()
}
console.log(log.join(', '))
```

::: details Решение и разбор
```
A mounted, A activated, -> B, A deactivated, B mounted, B activated,
-> C, A unmounted, B deactivated, C mounted, C activated,
-> A, B unmounted, C deactivated, A mounted, A activated
```

- `activated` срабатывает и при первом монтировании, после `mounted`.
- На `C` в кэше три ключа при `max: 2`. Вытесняется самый давний — `A`, он размонтируется по-настоящему. `A unmounted` идёт раньше `B deactivated`: вытеснение происходит в рендер-функции `KeepAlive`, а деактивация `B` — позже, в `patch`. Оба хука стоят в post-очереди в этом порядке.
- На возврате к `A` его в кэше нет: снова `mounted`, состояние потеряно. Вытесняется `B`, а не `C`: `C` использован последним.
:::

### 2. Найдите баг · легко

Страница «Лента» под `<KeepAlive>`. Через несколько переходов между вкладками сервер жалуется на поток запросов, хотя ленту никто не смотрит.

```vue
<script setup>
import { onMounted, onUnmounted, ref } from 'vue'

const items = ref([])
let id
onMounted(() => {
  id = setInterval(async () => { items.value = await fetchFeed() }, 5000)
})
onUnmounted(() => clearInterval(id))
</script>
```

::: details Решение и разбор
Под `KeepAlive` скрытая вкладка не размонтируется, поэтому `onUnmounted` не наступает, и интервал работает в фоне. Это нормальная работа кэша, а не утечка Vue. Опрос нужно связать с активностью:

```js
import { onActivated, onDeactivated } from 'vue'

const start = () => { id ??= setInterval(refresh, 5000) }
const stop = () => { clearInterval(id); id = undefined }
onActivated(start)     // also runs on the first mount
onDeactivated(stop)
onUnmounted(stop)      // evicted by `max` or rendered without KeepAlive
```

`onActivated` срабатывает и при первом монтировании, поэтому `onMounted` не нужен. Обратите внимание: watchers и рендер деактивированного компонента тоже продолжают реагировать на изменения стора. Тяжёлые вычисления в скрытых вкладках ограничивают `max` и `include`.
:::

### 3. Найдите баг · средне

Профили пользователей открываются по `/users/:id` и кэшируются. Пользователь начал писать комментарий в профиле 1, перешёл в профиль 2 и увидел там свой черновик.

```vue
<KeepAlive>
  <UserProfile :id="route.params.id" />
</KeepAlive>
```

::: details Решение и разбор
Без `key` ключ кэша — тип компонента. У всех профилей одна запись: при смене `id` тот же экземпляр получает новый prop, а состояние (`draft`) остаётся прежним. Проверено: черновик `hello` виден в профиле 2.

Решение зависит от того, что нужно:

- отдельное состояние на каждого пользователя — `:key="route.params.id"`. Каждый `id` получит свою запись кэша, и черновик профиля 1 дождётся возвращения. Обязательно с `:max`, иначе кэш растёт с каждым открытым профилем;
- один экземпляр, но со сбросом — `watch(() => props.id, reset)` внутри компонента.

Тот же класс бага — `<component :is>` без `key` и `RouterView` без `:key` для одного компонента на разных параметрах.
:::

### 4. Найдите баг · легко

Модалка не появляется, в консоли dev-предупреждение.

```vue
<!-- App.vue -->
<template>
  <AppHeader />  <!-- contains <Teleport to="#modals"> with a modal -->
  <main><RouterView /></main>
  <div id="modals"></div>
</template>
```

::: details Решение и разбор
`Teleport` ищет цель через `querySelector` в момент своего монтирования. `AppHeader` монтируется раньше, чем `div#modals` ниже по шаблону, и цели ещё нет. Предупреждение: «Failed to locate Teleport target with selector "#modals"… the target cannot be rendered by the component itself». Контент не монтируется вообще, а не «потом».

Исправления:

- `<Teleport to="#modals" defer>` (3.5): монтирование уходит в post-очередь после текущего рендера, и цель уже есть. Проверено: модалка оказывается внутри `#modals`;
- вынести контейнер из дерева Vue: `<div id="modals">` в `index.html` рядом с `#app`. Для SSR так даже лучше: гидрация ищет контент телепорта в отдельном контейнере.
:::

### 5. Что выведет · средне

```js
import { createApp, h, Suspense, onMounted } from 'vue'

const log = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mkAsync = (name, ms) => ({
  async setup() {
    onMounted(() => log.push(`${name} mounted`))
    await sleep(ms)
    return () => h('p', name)
  },
})
const Sync = { setup() { onMounted(() => log.push('Sync mounted')); return () => h('i') } }

createApp({
  setup() {
    onMounted(() => log.push('App mounted'))
    return () => h(Suspense, { onResolve: () => log.push('resolve') }, {
      default: () => h('div', [h(mkAsync('A', 10)), h(Sync), h(mkAsync('B', 30))]),
      fallback: () => h('span', 'loading'),
    })
  },
}).mount(document.createElement('div'))

await sleep(50)
console.log(log.join(', '))
```

::: details Решение и разбор
```
App mounted, resolve, Sync mounted, A mounted, B mounted
```

- `App mounted` первый: при монтировании видна только `fallback`, и `App` смонтирован с ней.
- `Sync` синхронный, но его `mounted` буферизуется в `suspense.effects`: дерево ещё в отсоединённом контейнере, и DOM нет в документе.
- `A` после своего `await` ждёт `B`: `Suspense` разрешается целиком, когда счётчик зависимостей стал нулём. `resolve` идёт **до** хуков: сначала DOM переносится и вызывается событие, потом сбрасывается буфер.
- `Sync mounted` раньше `A`: его хук попал в буфер ещё на первом рендере, а хуки `A` и `B` — когда их `setup` разрешился и они отрендерились.
- `onMounted` зарегистрирован **до** `await`. После `await` в ручном `async setup()` он потерялся бы с предупреждением ([«Жизненный цикл»](./lifecycle.md)).
:::

### 6. Реализуйте `defineAsyncComponent` · сложно

Реализуйте `defineAsync({ loader, loadingComponent, errorComponent, delay = 200, timeout })`. Требования: `loader` вызывается один раз на все экземпляры; после загрузки новые экземпляры рендерятся сразу; `loadingComponent` появляется после `delay`; по `timeout` показывается `errorComponent` с prop `error`; после ошибки следующий монтаж грузит заново; attrs, слушатели и слоты доходят до загруженного компонента ровно один раз; таймеры снимаются при размонтировании.

::: details Решение и разбор
```js
import { defineComponent, h, ref, shallowRef, onScopeDispose } from 'vue'

export function defineAsync({ loader, loadingComponent, errorComponent, delay = 200, timeout }) {
  let resolved = null
  let pending = null
  const load = () => (pending ??= loader()
    .then((mod) => (resolved = mod.default ?? mod))
    .catch((err) => { pending = null; throw err })) // next mount retries

  return defineComponent({
    name: 'AsyncWrapper',
    inheritAttrs: false, // attrs go to the inner component exactly once
    setup(_, { attrs, slots }) {
      if (resolved) return () => h(resolved, attrs, slots)

      const loaded = ref(false)
      const error = shallowRef(null)
      const delayed = ref(delay > 0)
      const timers = []
      if (delay > 0) timers.push(setTimeout(() => { delayed.value = false }, delay))
      if (timeout != null) timers.push(setTimeout(() => {
        if (!loaded.value && !error.value) error.value = new Error(`Timed out after ${timeout}ms`)
      }, timeout))
      onScopeDispose(() => timers.forEach(clearTimeout))

      load().then(() => { loaded.value = true }, (err) => { error.value = err })

      return () => {
        if (loaded.value) return h(resolved, attrs, slots)
        if (error.value && errorComponent) return h(errorComponent, { error: error.value })
        if (loadingComponent && !delayed.value) return h(loadingComponent)
        return null
      }
    },
  })
}
```

Проверено в happy-dom: два экземпляра — один вызов `loader`; через 10 мс пусто, через 60 мс `loading`, после отказа сети `error`; повторный монтаж вызывает `loader` второй раз и рендерит компонент; клик эмитит событие ровно один раз; после загрузки экземпляр рендерится синхронно.

- `pending ??=` дедуплицирует параллельные запросы, а `.catch` сбрасывает его, чтобы ошибка не кэшировалась навсегда.
- `inheritAttrs: false` и явная передача `attrs`: иначе слушатель попал бы на внутренний компонент дважды, через fallthrough и через аргумент `h`.
- Проверка `loaded` в рендере идёт первой, поэтому поздний успех после `timeout` заменяет ошибку. Так же ведёт себя Vue.
- Чего нет по сравнению с Vue: `onError` с `retry`/`fail`, интеграции с `Suspense` (возврат промиса из `setup`), `hydrate`, передачи `ref` на внутренний компонент, обновления родительского `KeepAlive` после загрузки.

Сложность: O(1) на монтирование экземпляра, один сетевой запрос на определение.
:::

## Источники

- [Vue.js: KeepAlive](https://vuejs.org/guide/built-ins/keep-alive.html)
- [Vue.js: Teleport](https://vuejs.org/guide/built-ins/teleport.html)
- [Vue.js: Suspense](https://vuejs.org/guide/built-ins/suspense.html)
- [Vue.js: Transition](https://vuejs.org/guide/built-ins/transition.html), [TransitionGroup](https://vuejs.org/guide/built-ins/transition-group.html)
- [Vue.js: Async Components (включая Lazy Hydration)](https://vuejs.org/guide/components/async.html)
- [Vue.js: Built-in Components (API)](https://vuejs.org/api/built-in-components.html)
- [Vue.js: Server-Side Rendering — Teleports](https://vuejs.org/guide/scaling-up/ssr.html#teleports)
- [Исходники Vue 3.5.45: `runtime-core/src/components/` (`KeepAlive.ts`, `Teleport.ts`, `Suspense.ts`), `apiAsyncComponent.ts`](https://github.com/vuejs/core/tree/v3.5.45/packages/runtime-core/src)
- [Исходники Vue 3.5.45: `runtime-dom/src/components/Transition.ts`, `TransitionGroup.ts`](https://github.com/vuejs/core/tree/v3.5.45/packages/runtime-dom/src/components)
- [`vuejs/core` CHANGELOG.md, ветка `minor` (3.6)](https://github.com/vuejs/core/blob/minor/CHANGELOG.md)
