---
title: SSR и гидрация
level: ядро
---

# SSR и гидрация

> **Коротко.** При SSR (server-side rendering, рендеринг на сервере) приложение Vue выполняется в Node и отдаёт готовый HTML. Для сервера компилятор генерирует не vnode, а конкатенацию строк. Клиент создаёт то же приложение через `createSSRApp` и **гидрирует** разметку: проходит по готовому DOM параллельно с деревом vnode, забирает узлы себе и навешивает обработчики. Если серверный и клиентский рендер расходятся (дата, `Math.random`, `window`, неверная вложенность HTML), возникает hydration mismatch. Текст и узлы Vue чинит, а `class` и `style` только проверяет. Поэтому код должен давать одинаковый результат в обеих средах, а на сервере каждому запросу нужен свой экземпляр приложения.

**Связанные темы:** [Механизм рендеринга: VDOM и компиляторные оптимизации](./rendering-mechanism.md), [Жизненный цикл компонента](./lifecycle.md), [Composables](./composables.md), [`KeepAlive`, `Teleport`, `Suspense`, `Transition` и асинхронные компоненты](./built-in-components.md), [Директивы, в том числе пользовательские](./directives.md), [Производительность Vue и Nuxt](../performance/vue-performance.md), [XSS и безопасный вывод во Vue](../security/xss.md), [Утечки памяти](../performance/memory-leaks.md), [Нефункциональные требования](../architecture/non-functional.md), [Что происходит от ввода URL до отрисовки страницы](../browser/from-url-to-pixels.md), [Pinia: сторы, getters, actions](../state-management/pinia.md)

## Теория

Все утверждения проверены на Vue 3.5.45 в Node 26.13.1. Сервер — `vue/server-renderer`, гидрация — в happy-dom, вывод компилятора — `@vue/compiler-sfc`. Как браузер разбирает невалидный HTML, проверено парсером parse5, который реализует алгоритм HTML Living Standard. Те же сценарии повторены на `3.6.0-rc.16` и дали тот же вывод. Здесь разобран SSR на уровне Vue без фреймворка. Как выбрать стратегию рендеринга для маршрута (SSR, SSG, SWR, islands) — в [«Нефункциональных требованиях»](../architecture/non-functional.md#стратегии-рендеринга). Режимы рендеринга Nuxt разобраны в разделе «Nuxt».

### Сервер: строки вместо vnode

`renderToString(app, ctx?)` из `vue/server-renderer` возвращает промис с HTML. В браузере render-функция строит vnode, а рендерер превращает их в DOM. На сервере DOM нет, а HTML — это просто строка. Поэтому для SSR-сборки компилятор генерирует отдельную функцию `ssrRender`, которая пишет готовые куски разметки в буфер:

```js
// <div class="card" :title="n"><h1>Static title</h1>
//   <button @click="n++">{{ n }}</button><li v-for="i in items" :key="i">{{ i }}</li></div>
// compileScript(..., { inlineTemplate: true, templateOptions: { ssr: true } }), Vue 3.5.45
return (_ctx, _push, _parent, _attrs) => {
  _push(`<div${_ssrRenderAttrs(_mergeProps({ class: "card", title: n.value }, _attrs))
  }><h1>Static title</h1><button>${_ssrInterpolate(n.value)}</button><!--[-->`)
  _ssrRenderList(items.value, (i) => {
    _push(`<li>${_ssrInterpolate(i)}</li>`)
  })
  _push(`<!--]--></div>`)
}
```

Что видно в выводе:

- **Нет vnode и diff.** Статика вшита в строковые литералы. Сервер рендерит один раз, сравнивать не с чем.
- **Нет обработчиков и `key`.** `@click` и `:key` нужны только клиенту, в HTML их нет.
- **Экранирование.** `_ssrInterpolate` и `_ssrRenderAttrs` экранируют значения через `escapeHtml` ([«XSS»](../security/xss.md)).
- **Маркеры фрагментов.** `<!--[-->` и `<!--]-->` отмечают границы фрагмента: `v-for`, компонент с несколькими корнями, слот. Пустая ветка `v-if` даёт `<!--v-if-->`. Клиенту эти комментарии нужны, чтобы понять, где фрагмент кончается.

Буфер может содержать промисы: компонент с `async setup()` или `onServerPrefetch` откладывает свою часть разметки, а соседи рендерятся дальше. `renderToString` склеивает буфер, когда все промисы разрешены. Потоковые API (`renderToWebStream`, `pipeToNodeWritable`, `renderToNodeStream`, `pipeToWebWritable`) отдают куски по мере готовности. Это сокращает TTFB (время до первого байта). Но статус и заголовки ответа уходят с первым куском, поэтому ошибку посреди рендера уже не превратить в 500. Кроме того, `ctx.teleports` и состояние для клиента известны только в конце, и их дописывают после основного потока.

### Код в двух средах

Один и тот же код компонента выполняется дважды: в Node при рендере и в браузере при гидрации. Отсюда три правила.

1. **На сервере работает только начало жизненного цикла.** `setup`, `beforeCreate`/`created`, `onServerPrefetch`. `onMounted`, `onUpdated`, `onUnmounted` на сервере не вызываются. Обычный `watch` не подписывается, а `watchEffect` и `immediate`-watcher выполняются один раз. Подробно — в [«Жизненном цикле»](./lifecycle.md#ssr), а что из этого течёт — в [«Утечках памяти»](../performance/memory-leaks.md#ssr-утечки-в-процессе-сервера).
2. **Браузерные API — только в `onMounted`** или за проверкой `import.meta.env.SSR` (Vite подставляет её при сборке, и мёртвая ветка выпадает из бандла). `window`, `localStorage` или `document` в `setup()` уронят серверный рендер с `ReferenceError`. Пользовательские директивы на сервере не вызываются: разметку для них даёт хук `getSSRProps` ([«Директивы»](./directives.md#ssr-getssrprops)).
3. **Данные — до рендера.** `onServerPrefetch(async () => …)` (в Options API — `serverPrefetch`) или `async setup()`: рендерер дождётся промиса, и в HTML попадут уже загруженные данные. Но клиент должен получить те же данные, иначе первый клиентский рендер разойдётся с HTML. Поэтому сервер сериализует состояние в страницу, а клиент восстанавливает его до `mount` (пример ниже).

### Фабрика приложения на запрос

Модуль в Node загружается один раз на процесс, а не на запрос. `const user = ref(null)` на уровне модуля — одна переменная для всех пользователей. Запрос Анны запишет в неё имя, и рендер для Бориса, который идёт в это время, его покажет. Это **cross-request state pollution** (загрязнение состояния между запросами). Проверка и разбор для composables — в [«Composables»](./composables.md#ssr-общее-состояние-модуля).

Лечение — **фабрика**: модуль экспортирует функцию `createApp()`, которая на каждый запрос создаёт новое приложение, роутер и хранилище. Общее состояние раздаётся через `app.provide`, а не через импорт синглтона. Pinia устроена именно так: `createPinia()` вызывают внутри фабрики, сторы живут в экземпляре `pinia`, а `pinia.state.value` сериализуют в HTML и восстанавливают на клиенте до `mount`. Как pinia находит свой экземпляр и создаёт сторы, разобрано в теме [«Pinia: сторы, getters, actions»](../state-management/pinia.md).

### Гидрация: что делает клиент

`createSSRApp(App).mount('#app')` не создаёт DOM, а включает режим гидрации (`runtime-core/src/hydration.ts`):

1. Компоненты выполняют `setup` и render как обычно и строят то же дерево vnode, что и сервер.
2. `hydrateNode(domNode, vnode)` идёт по DOM и vnode одновременно. Вместо `createElement` он пишет `vnode.el = domNode` и сверяет тип узла.
3. Обработчики событий (`onClick` и др.) навешиваются через `patchProp`. Остальные props пропускаются: атрибуты уже в HTML. Исключения — `value` у `<input>` и `<option>`, `.prop`-привязки, custom elements и props из `dynamicProps` (динамические атрибуты с флагом `PROPS`).
4. Соседние текстовые узлы, которые HTML склеил (`ab` вместо `a` и `b`), гидрация снова разделяет.
5. После прохода вызываются `onMounted`. С этого момента компонент обновляется обычным `patch`.

Если контейнер пуст, Vue предупреждает и делает обычный mount. Гидрация дешевле mount по DOM-операциям, но не по JS: `setup`, render и создание vnode выполняются целиком. Поэтому SSR ускоряет первую отрисовку, но не интерактивность. Как это бьёт по INP — в [«Производительности Vue и Nuxt»](../performance/vue-performance.md#keepalive-асинхронные-компоненты-и-ленивая-гидрация).

### Hydration mismatch

Mismatch — расхождение серверного HTML и клиентского дерева vnode. Что Vue 3.5.45 делает с каждым видом расхождения (проверено):

| Расхождение | Предупреждение в dev | Что с DOM |
| --- | --- | --- |
| Текст | `Hydration text content mismatch` | заменяется клиентским |
| Тип узла (`<i>` против `<b>`) | `Hydration node mismatch` | серверный узел удаляется, клиентский монтируется |
| Лишние или недостающие дети | `Hydration children mismatch` | лишние удаляются, недостающие монтируются |
| `class`, `style` | `Hydration class/style mismatch` | **не исправляется** («check-only») |
| Атрибут | `Hydration attribute mismatch` | динамический (`:title`, попал в `dynamicProps`) перезаписывается клиентским, остальные остаются серверными |

После прохода в консоль один раз пишется `console.error("Hydration completed but contains mismatches.")`, в том числе в production. Подробные предупреждения в production вырезаны. Вернуть их можно флагом сборки `__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true'` (с 3.4, через `define` в Vite): кода в бандле станет больше, поэтому флаг включают только для отладки.

> [!WARNING]
> Неисправленный `class` остаётся серверным **и после следующих обновлений**. Сервер отдал `class="a"`, клиент вычислил `'b'`. При ререндере `patch` сравнивает новый vnode со старым клиентским (`'b'` с `'b'`), разницы не видит и DOM не трогает. Проверено: после изменения другого состояния `<p class="a">` так и остался с `a`. Это реальный баг в проде, а не косметика в консоли.

**Типичные причины:**

- **Время и локаль.** `new Date().toLocaleString()` на сервере в UTC и `en-US`, у пользователя — в своём часовом поясе и локали. Перевод в локальное время делают только на клиенте или передают серверу часовой пояс (например, в cookie).
- **Случайность.** `Math.random()`, `crypto.randomUUID()` для id. Для id есть `useId()`, для остального — сид, переданный в состоянии.
- **Среда.** `typeof window !== 'undefined'` в шаблоне, `localStorage`, ширина экрана, `navigator.language`. Сервер не знает этих значений. Решение — одинаковый первый рендер и обновление в `onMounted`.
- **Невалидный HTML.** Строка `<p><div>hi</div></p>` для HTML-парсера — не дерево из шаблона: `<div>` закрывает открытый `<p>`, а `</p>` без открытого `<p>` создаёт пустой абзац. Браузер построит `<p></p><div>hi</div><p></p>`. Vue получает children mismatch и перемонтирует поддерево. Компилятор 3.5.45 в dev предупреждает заранее: `<div> cannot be child of <p>, according to HTML specifications`. То же с `<tr>` прямо в `<table>` (парсер вставляет `<tbody>`) и с `<a>` внутри `<a>`.
- **Данные разошлись.** Сервер загрузил данные, а клиент их не получил или загрузил заново и получил другие.
- **Расширения браузера и CDN,** которые правят HTML до гидрации (переводчики, блокировщики, вставка скриптов).

### `data-allow-mismatch` (3.5)

Некоторые расхождения неизбежны: «вы смотрите страницу 3 минуты назад», локальная дата. Атрибут `data-allow-mismatch` подавляет предупреждение на элементе:

```html
<time data-allow-mismatch="text">{{ updatedAt.toLocaleString() }}</time>
```

Значения: `text`, `children` (только прямые дети), `class`, `style`, `attribute`, несколько через запятую. Без значения разрешено всё. Vue ищет атрибут вверх по предкам (`isMismatchAllowed`). Атрибут убирает только предупреждение и `console.error`, а поведение из таблицы не меняется: текст по-прежнему заменится, `class` по-прежнему останется серверным. Это способ сказать «я знаю», а не способ исправить.

### `useId` (3.5): стабильные id

`aria-describedby`, `<label for>` и подобные связи требуют id, одинаковых на сервере и клиенте. Счётчик на уровне модуля не годится: на сервере он не сбрасывается между запросами, а порядок вызова зависит от того, какие асинхронные компоненты разрешились раньше.

`useId()` возвращает строку вида `v-0`, `v-1`, `v-0-0`. Устройство (`runtime-core/src/helpers/useId.ts`):

```js
// Vue 3.5.45, simplified
function useId() {
  const i = getCurrentInstance()
  return (i.appContext.config.idPrefix || 'v') + '-' + i.ids[0] + i.ids[1]++
}
// a child instance shares the parent's array: ids = parent ? parent.ids : ['', 0, 0]
function markAsyncBoundary(instance) { // async setup, serverPrefetch, async component
  instance.ids = [instance.ids[0] + instance.ids[2]++ + '-', 0, 0]
}
```

Счётчик живёт в приложении, а не в модуле, поэтому каждый запрос начинает с нуля. Асинхронная граница получает свой префикс, и id под ней не зависят от того, когда она разрешится. Проверено: у корня с `onServerPrefetch` вызовы `useId()` дали `v-0` и `v-1`, а у двух дочерних полей — `v-0-0` и `v-0-1`. Клиент повторяет ту же структуру и получает те же строки. Если на странице несколько приложений, им задают разные `app.config.idPrefix`. Вызывать `useId()` нужно в `setup`, а не внутри `computed`.

### Ленивая гидрация (3.5)

`defineAsyncComponent({ loader, hydrate: strategy })` откладывает гидрацию компонента. Пока стратегия не сработала, его серверный HTML виден, но не реагирует на ввод. Встроенные стратегии импортируются по отдельности и выпадают из бандла, если не используются:

| Стратегия | Когда гидрирует | Как устроена |
| --- | --- | --- |
| `hydrateOnIdle(timeout = 10000)` | браузер простаивает | `requestIdleCallback` с `timeout` |
| `hydrateOnVisible(options?)` | элемент в зоне видимости | `IntersectionObserver`. Если элемент уже в окне, гидрирует сразу |
| `hydrateOnMediaQuery(query)` | совпал media query | `matchMedia` и событие `change` |
| `hydrateOnInteraction(events)` | событие на корневых элементах | слушатели `{ once: true }`, затем **повтор события** |

Как это устроено (`runtime-core/src/apiAsyncComponent.ts`, `hydrationStrategies.ts`):

- **Код загружается сразу.** При гидрации приложения обёртка вызывает `loader()` и только после его разрешения запускает стратегию. Проверено: на клиенте `loader called` записан до `mounted` приложения, а `setup` компонента — только после клика. Ленивая гидрация экономит выполнение `setup`, render и навешивание обработчиков на главном потоке, но не загрузку чанка. Чтобы не загружать код вовсе, компонент не рендерят на клиенте (islands, server components в Nuxt).
- **Повтор события.** `hydrateOnInteraction` после `hydrate()` делает `e.target.dispatchEvent(new e.constructor(e.type, e))`. Проверено: первый клик по негидрированной кнопке после гидрации увеличил счётчик. Повторённое событие синтетическое: у него `isTrusted === false`, и обработчик, который проверяет это поле, его отбросит.
- **Обновление до гидрации отменяет её.** Если родитель перерисовал компонент раньше, чем сработала стратегия, Vue пишет `Skipping lazy hydration … it was updated before lazy hydration performed`, и компонент остаётся без гидрации. В Nuxt поэтому изменение пропа сразу запускает гидрацию.
- **Своя стратегия** — функция `(hydrate, forEachElement) => teardown?`. `forEachElement` обходит корневые элементы, в том числе фрагмента между `<!--[-->` и `<!--]-->`. Teardown вызывается при размонтировании.

Без SSR опция `hydrate` ничего не делает. Nuxt строит на ней атрибуты `hydrate-on-visible` и подобные ([«Производительность Vue и Nuxt»](../performance/vue-performance.md#nuxt-ленивые-компоненты-отложенная-гидрация-islands)).

**Islands** (острова) доводят идею до конца: страница по умолчанию — статичный HTML без JS, а гидрируются только интерактивные «острова». Во Vue это не встроено. Это архитектура фреймворков: Astro, server components и `<NuxtIsland>` в Nuxt.

> [!NOTE]
> Во Vue 3.6 (RC, `3.6.0-rc.16`, сверено 2026-11-21) гидрация VDOM-компонентов не меняется: все сценарии темы дали тот же вывод. Vapor Mode получает свою гидрацию в `@vue/runtime-vapor`: без vnode, по шаблону и маркерам диапазонов. По CHANGELOG её активно чинят (восстановление после mismatch, слоты, `Transition`, асинхронные компоненты). Стабильного 3.6 пока нет.

## Примеры

### SSR без фреймворка

Три файла: универсальная фабрика, сервер и клиент. Сервер проверен в Node 26 (HTML ниже — реальный ответ). Клиентский код собирает сборщик (Vite) вместе с компилятором SFC.

```js
// app.js — universal code: one fresh app per request (server) or per page (client)
import { createSSRApp, reactive } from 'vue'
import App from './App.vue'

export function createApp(initialState) {
  const state = reactive(initialState ?? { user: null, todos: [] })
  const app = createSSRApp(App)
  app.provide('state', state) // composables inject it, never import a module-level ref
  return { app, state }
}
```

```js
// server.js
import { createServer } from 'node:http'
import { renderToString } from 'vue/server-renderer'
import { createApp } from './app.js'

// JSON.stringify does not escape "<": a string with </script> would close the tag.
// Also escape U+2028/U+2029 or use devalue (see the XSS topic).
const serialize = (data) => JSON.stringify(data).replace(/</g, '\\u003c')

createServer(async (req, res) => {
  const { app, state } = createApp()               // per request: no state shared between users
  state.user = await getUser(req)                  // data before render, as onServerPrefetch would
  state.todos = await getTodos(state.user)
  const ctx = {}
  const html = await renderToString(app, ctx)
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><div id="app">${html}</div>
<div id="teleports">${ctx.teleports?.['#teleports'] ?? ''}</div>
<script>window.__STATE__ = ${serialize(state)}</script>
<script type="module" src="/client.js"></script>`)
}).listen(3000)
```

```js
// client.js
import { createApp } from './app.js'

const { app } = createApp(window.__STATE__) // the same data, so the first render matches the HTML
app.mount('#app')                           // createSSRApp + existing markup = hydration
```

`App.vue` здесь — `<h1>` с именем и `<ul>` со списком. Ответ сервера, когда в `todos` попала строка `'</script><script>alert(1)</script>'`:

```html
<div id="app"><!--[--><h1>ann</h1><ul><!--[--><li>&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;</li><!--]--></ul><!--]--></div>
<script>window.__STATE__ = {"user":"ann","todos":["\u003c/script>\u003cscript>alert(1)\u003c/script>"]}</script>
```

Шаблон экранирован рендерером, состояние — функцией `serialize`. Без замены `<` строка закрыла бы `<script>` раньше времени. Разбор — в [«XSS»](../security/xss.md#ssr-сериализация-состояния). Телепорты в HTML приложения не попадают: их разметка копится в `ctx.teleports`, и вставить её — задача сервера ([«`Teleport`»](./built-in-components.md#teleport-другой-dom-то-же-дерево)).

### Компонент, безопасный для SSR

```vue
<script setup>
import { ref, onMounted, useId } from 'vue'

const props = defineProps({ updatedAt: Date })
const hintId = useId()                       // same on server and client
const relative = ref(null)                   // unknown on the server: render a neutral value

onMounted(() => {                            // browser only
  relative.value = formatRelative(props.updatedAt)
})
</script>

<template>
  <label :for="hintId + '-input'">Search</label>
  <input :id="hintId + '-input'" :aria-describedby="hintId">
  <p :id="hintId">
    Updated
    <time :datetime="updatedAt.toISOString()">
      {{ relative ?? updatedAt.toISOString().slice(0, 10) }}
    </time>
  </p>
</template>
```

Первый рендер на клиенте совпадает с сервером: `relative` — `null` в обеих средах. Дата в UTC (`toISOString`) не зависит от часового пояса, поэтому одинакова в обеих средах. Относительное время («5 минут назад») появляется после `onMounted` обычным обновлением, а не при гидрации, и mismatch нет. Цена — второй рендер и смена текста на глазах у пользователя. `data-allow-mismatch` здесь не нужен: он для случаев, когда первый клиентский рендер обязан отличаться.

## Вопросы с интервью

::: details Что такое гидрация и чем она отличается от обычного монтирования
Гидрация — оживление серверного HTML. Клиент создаёт то же приложение (`createSSRApp`), выполняет `setup` и render, строит дерево vnode, но не создаёт DOM. Вместо этого `hydrateNode` идёт по существующим узлам параллельно с vnode, записывает `vnode.el = node`, сверяет тип и содержимое и навешивает обработчики событий. Атрибуты не перезаписываются: они уже в HTML. Экономится создание DOM и первая отрисовка, но не JS: setup, render и vnode выполняются полностью. Поэтому SSR даёт ранний FCP/LCP, но страница «мёртвая» до конца гидрации, и это бьёт по INP. После гидрации компонент живёт как обычный: дальше работает `patch`.
:::

::: details Что Vue делает при hydration mismatch
Зависит от вида. Текст заменяется клиентским. Узел другого типа удаляется, и на его месте монтируется клиентский. Лишние дети удаляются, недостающие монтируются. А `class`, `style` и статические атрибуты только проверяются: DOM остаётся серверным, и последующие обновления это не исправят, потому что `patch` сравнивает vnode с vnode, а не с DOM. В dev каждое расхождение — предупреждение с серверным и клиентским значением. В production — одна строка `Hydration completed but contains mismatches.`, а детали включаются флагом `__VUE_PROD_HYDRATION_MISMATCH_DETAILS__`. Mismatch нужно устранять, а не глушить: это и баги в разметке, и лишняя работа на перемонтирование.
:::

::: details Назовите типичные причины расхождения серверного и клиентского рендера
Недетерминированные значения: дата и часовой пояс, локаль `Intl`, `Math.random`, `Date.now`. Значения среды: `window`, `localStorage`, размер экрана, `navigator`, авторизация, известная только клиенту. Невалидная вложенность: `<div>` в `<p>`, `<tr>` в `<table>` без `<tbody>`, ссылка в ссылке — браузерный парсер перестраивает дерево. Данные, которые клиент не получил из сериализованного состояния и загрузил заново. Директивы без `getSSRProps`, меняющие атрибуты. Чужие правки HTML: расширения, прокси, CDN. Лечение — одинаковый первый рендер в обеих средах, клиентские значения — в `onMounted`, данные — через состояние в HTML, id — через `useId`.
:::

::: details Зачем на сервере создавать приложение на каждый запрос
Node-модуль загружается один раз на процесс, и всё, что объявлено на уровне модуля, общее для всех запросов. Состояние в модульном `ref` или синглтоне стора видят параллельные рендеры разных пользователей — это cross-request state pollution, утечка чужих данных. Плюс такое состояние растёт и не освобождается — утечка памяти. Поэтому код пишут как фабрику: `createApp()` на каждый запрос создаёт приложение, роутер, pinia, а общее состояние раздаётся через `app.provide`. На клиенте модульный синглтон безопасен, потому что пользователь один, но код универсальный, и правило действует в обе стороны.
:::

::: details Как useId даёт одинаковые id на сервере и клиенте
Счётчик хранится не в модуле, а в дереве компонентов приложения: дочерние экземпляры делят массив `ids` родителя, и `useId` возвращает префикс плюс инкремент. Порядок вызовов `setup` при обходе дерева одинаков на сервере и клиенте, значит совпадают и строки. Опасное место — асинхронность: на сервере соседи рендерятся, пока async-компонент ждёт, и общий счётчик пошёл бы в другом порядке. Поэтому асинхронная граница (`async setup`, `serverPrefetch`, `defineAsyncComponent`) получает свой префикс (`v-0-`) и собственный счётчик. Новое приложение начинает с нуля, поэтому запросы не влияют друг на друга. Несколько приложений на странице разводят через `app.config.idPrefix`.
:::

::: details Что делает SSR-компилятор иначе, чем клиентский
Клиентская render-функция возвращает vnode с patch flags и блоками для будущих обновлений. Серверная `ssrRender` ничего не возвращает: она вызывает `_push` со строковыми кусками, статика вшита в литералы, значения проходят через `ssrInterpolate` и `ssrRenderAttrs` с экранированием. Обработчиков событий, `key`, ref и пользовательских директив в выводе нет: на сервере они бессмысленны, а для директив есть `getSSRProps`. Вставляются комментарии-маркеры фрагментов, без которых клиент не нашёл бы границы `v-for` и многокорневых компонентов. Выигрыш — сервер не тратит время и память на дерево vnode, которое сразу бы выбросил.
:::

::: details Как работает ленивая гидрация и что она не экономит
С 3.5 `defineAsyncComponent` принимает `hydrate`: стратегию, которая решает, когда вызвать `hydrate()`. Встроенные — idle, visible, media query, interaction. До срабатывания компонент — статичный серверный HTML: setup не выполнялся, обработчиков нет. `hydrateOnInteraction` после гидрации повторяет событие, поэтому первый клик не теряется, но повтор синтетический, `isTrusted` у него `false`. Экономится JS на главном потоке во время загрузки: setup, render, листенеры. Не экономится сеть: `loader()` вызывается сразу при гидрации приложения, и стратегия стартует только после загрузки чанка. Если родитель обновит компонент до гидрации, Vue её пропустит. Откладывать первый экран нельзя: пользователь будет кликать по мёртвому HTML.
:::

::: details Зачем потоковый рендеринг и какие у него ограничения
`renderToWebStream` или `pipeToNodeWritable` отдают HTML по мере рендера, поэтому браузер раньше получает `<head>`, начинает грузить CSS и скрипты и рисует верх страницы. Ограничения следуют из HTTP: статус и заголовки уходят с первым куском, поэтому ошибку или редирект посреди рендера уже не отдать как 500 или 302. Всё, что известно только после рендера — `ctx.teleports`, сериализованное состояние, мета-теги, собранные компонентами, — пишется в конец потока или требует отложенной вставки. `renderToNodeStream` не работает в ESM-сборке `server-renderer`, вместо него — `pipeToNodeWritable`.
:::

## Задачи

### 1. Что выведет · легко

Что окажется в `log` и в HTML после `renderToString`?

```js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = []
const App = {
  beforeCreate() { log.push('beforeCreate') },
  created() { log.push('created') },
  setup() {
    const n = ref(1)
    log.push('setup')
    watch(n, (v) => log.push('watch ' + v))
    watchEffect(() => log.push('effect ' + n.value))
    onMounted(() => log.push('mounted'))
    onServerPrefetch(async () => { await sleep(10); n.value = 2; log.push('prefetch') })
    return () => { log.push('render'); return h('p', n.value) }
  },
}
const html = await renderToString(createSSRApp(App))
```

::: details Решение и разбор
```text
<p>2</p>
['setup', 'effect 1', 'beforeCreate', 'created', 'prefetch', 'render']
```

- `setup` идёт раньше `beforeCreate`: хуки Options API применяются после `setup()`.
- `watchEffect` выполняется один раз и на сервере больше не перезапускается, поэтому `effect 2` нет.
- Обычный `watch` на сервере не подписывается: `watch 2` нет, хотя `n` изменился.
- `onMounted` на сервере не регистрируется.
- Рендер ждёт промис `onServerPrefetch`, поэтому в HTML уже `2`. Проверено на Vue 3.5.45.
:::

### 2. Найдите баг · легко

Компонент работает при CSR, но с SSR то падает, то шумит в консоли. Найдите четыре проблемы.

```vue
<script setup>
import { ref } from 'vue'

const tipId = 'tip-' + Math.random().toString(36).slice(2)
const now = new Date().toLocaleTimeString()
const theme = ref(localStorage.getItem('theme') ?? 'light')
</script>

<template>
  <p :class="theme">
    <span :aria-describedby="tipId">{{ now }}</span>
    <div :id="tipId" role="tooltip">Local time</div>
  </p>
</template>
```

::: details Решение и разбор
1. `localStorage` в `setup` — `ReferenceError` на сервере, рендер падает. Если тему просто проверить через `typeof window`, будет class mismatch, а `class` гидрация не исправляет (задача 3). Тему, нужную в первом HTML, сервер читает из cookie. Иначе — значение по умолчанию и смена в `onMounted`.
2. `Math.random()` даёт разные id: attribute mismatch, и `aria-describedby` указывает на несуществующий элемент. Нужен `useId()`.
3. `toLocaleTimeString()` зависит от часового пояса и локали: text mismatch. Время показывают после `onMounted` или помечают `data-allow-mismatch="text"`, если расхождение допустимо.
4. `<div>` внутри `<p>` — браузер закроет `<p>` до `<div>`, Vue получит children mismatch и перемонтирует поддерево. Компилятор об этом предупреждает ещё при сборке. Внешний элемент — `<div>`, или подсказка — `<span>`.

```vue
<script setup>
import { ref, onMounted, useId } from 'vue'

const tipId = useId()
const now = ref('')
const theme = ref('light') // or from a cookie read on the server
onMounted(() => {
  now.value = new Date().toLocaleTimeString()
  theme.value = localStorage.getItem('theme') ?? 'light'
})
</script>

<template>
  <div :class="theme">
    <span :aria-describedby="tipId">{{ now }}</span>
    <span :id="tipId" role="tooltip">Local time</span>
  </div>
</template>
```
:::

### 3. Что останется в DOM · средне

Сервер отрендерил `<p class="a">0</p>`, потому что `c` на сервере `'a'`, а на клиенте `'b'`. После гидрации `tick` увеличили на 1. Какой будет разметка `<p>`?

```vue
<template><p :class="c">{{ tick }}</p></template>
```

::: details Решение и разбор
```html
<p class="a">1</p>
```

При гидрации текст сверяется и совпадает (`0`), а `class` проверяется, но не исправляется: в dev — `Hydration class mismatch`, в DOM остаётся `a`. Клиентский vnode при этом хранит `class: 'b'`. При обновлении `patch` сравнивает старый vnode (`'b'`) с новым (`'b'`), видит, что `CLASS` не изменился, и DOM не трогает. Текст обновится до `1`, а класс останется серверным, пока `c` не поменяется. Проверено на 3.5.45 и `3.6.0-rc.16`. Вывод: mismatch по `class` и `style` — не предупреждение «на потом», а неверный UI до следующего изменения значения.
:::

### 4. Реализуйте `ClientOnly` · средне

Компонент рендерит слот `default` только в браузере, а на сервере и при гидрации — слот `fallback`. Гидрация не должна давать mismatch.

::: details Решение и разбор
```js
import { ref, onMounted } from 'vue'

export const ClientOnly = {
  setup(_, { slots }) {
    const mounted = ref(false)
    onMounted(() => { mounted.value = true })
    return () => (mounted.value ? slots.default?.() : slots.fallback?.())
  },
}
```

Проверка флагом `typeof window` здесь не годится: на клиенте он сразу `true`, и первый рендер разошёлся бы с сервером. Флаг из `onMounted` гарантирует, что гидрация увидит то же, что сервер (`fallback`), а содержимое появится обычным обновлением. Проверено: сервер — `<!--[--><span>loading</span><!--]-->`, после гидрации — тот же HTML, после тика — клиентский слот, без предупреждений. Цена — второй рендер и сдвиг макета, если `fallback` не занимает то же место. Код клиентской части всё равно в бандле: компонент экономит серверный рендер, а не загрузку.
:::

### 5. Своя стратегия гидрации · сложно

Напишите `hydrateAfter(ms)` — гидрация через таймер — и комбинатор `anyOf(...strategies)`: гидрировать по первой сработавшей стратегии и снять остальные. Пример: `anyOf(hydrateOnInteraction('click'), hydrateAfter(3000))`.

::: details Решение и разбор
```js
export const hydrateAfter = (ms) => (hydrate) => {
  const timer = setTimeout(hydrate, ms)
  return () => clearTimeout(timer)
}

export const anyOf = (...strategies) => (hydrate, forEachElement) => {
  let done = false
  let teardowns = []
  const cleanup = () => teardowns.forEach((t) => t && t())
  const once = () => {
    if (done) return
    done = true
    cleanup()
    hydrate()
  }
  teardowns = strategies.map((strategy) => strategy(once, forEachElement))
  if (done) cleanup() // a strategy fired synchronously before the rest registered
  return cleanup
}
```

- Стратегия — функция `(hydrate, forEachElement)`, возвращающая teardown. Vue вызывает teardown при размонтировании, поэтому таймер не переживёт компонент.
- `hydrateOnVisible` может вызвать `hydrate` синхронно, если элемент уже на экране. Тогда `teardowns` ещё не заполнен, и второй вызов `cleanup` после регистрации снимает то, что успели навесить.
- `hydrateOnInteraction` сама повторит клик после гидрации, если сработала она. Если первым сработал таймер, её слушатели снимаются в `cleanup`.
- Проверено в happy-dom: при `anyOf(hydrateOnInteraction('click'), hydrateAfter(30))` компонент гидрировался через ~30 мс без клика, а следующий клик обработал уже живой обработчик.

Сложность: O(k) на регистрацию для k стратегий.
:::

## Источники

- [Vue: Server-Side Rendering (SSR)](https://vuejs.org/guide/scaling-up/ssr.html)
- [Vue API: Server-Side Rendering — `renderToString`, потоковые API, `useSSRContext`, `data-allow-mismatch`](https://vuejs.org/api/ssr.html)
- [Vue: Async Components — Lazy Hydration](https://vuejs.org/guide/components/async.html#lazy-hydration)
- [Vue API: `useId()`](https://vuejs.org/api/composition-api-helpers.html#useid) и [`app.config.idPrefix`](https://vuejs.org/api/application.html#app-config-idprefix)
- [Vue API: Compile-Time Flags — `__VUE_PROD_HYDRATION_MISMATCH_DETAILS__`](https://vuejs.org/api/compile-time-flags.html)
- [Vue API: `onServerPrefetch()`](https://vuejs.org/api/composition-api-lifecycle.html#onserverprefetch)
- [HTML Living Standard: Parsing HTML documents — правила для `p` и `</p>`](https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inbody)
- [vuejs/core v3.5.45: `runtime-core/src/hydration.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/hydration.ts) — `hydrateNode`, `propHasMismatch`, `isMismatchAllowed`
- [vuejs/core v3.5.45: `runtime-core/src/hydrationStrategies.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/hydrationStrategies.ts) и [`apiAsyncComponent.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/apiAsyncComponent.ts)
- [vuejs/core v3.5.45: `runtime-core/src/helpers/useId.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/helpers/useId.ts)
- [vuejs/core v3.5.45: `packages/server-renderer`](https://github.com/vuejs/core/tree/v3.5.45/packages/server-renderer) и [`compiler-ssr`](https://github.com/vuejs/core/tree/v3.5.45/packages/compiler-ssr)
- [vuejs/core CHANGELOG, ветка `minor`](https://github.com/vuejs/core/blob/minor/CHANGELOG.md) — 3.6.0-rc.16, исправления гидрации Vapor
- [Pinia: Server Side Rendering](https://pinia.vuejs.org/ssr/)
