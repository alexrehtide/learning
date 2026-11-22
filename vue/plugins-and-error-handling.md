---
title: Плагины и обработка ошибок
level: ядро
---

# Плагины и обработка ошибок

> **Коротко.** Плагин — это объект с методом `install(app, ...options)` или просто функция. `app.use` вызывает её один раз, синхронно и в порядке вызовов. Внутри плагин делает то же, что можно сделать с `app` вручную: `app.provide`, `app.component`, `app.directive`, `app.config.globalProperties`, а с Vue 3.5 ещё и `app.onUnmount` для очистки. Ошибки из кода, который **вызывает сам Vue** (рендер, `setup`, хуки, watchers, обработчики из шаблона, директивы), проходят через `handleError`. Ошибка всплывает по цепочке родителей через `onErrorCaptured`, любой из них может остановить её, вернув `false`, а в конце она попадает в `app.config.errorHandler`. Код, который Vue не вызывал (`setTimeout`, промис без `await`, `addEventListener`), этот путь обходит. Без обработчика dev и прод ведут себя по-разному: dev пробрасывает ошибку, прод только логирует. `throwUnhandledErrorInProduction` (3.5) выравнивает это поведение.

**Связанные темы:** [Middleware и плагины в Nuxt](../nuxt/middleware-and-plugins.md), [Жизненный цикл](./lifecycle.md), [Слоты и provide/inject](./slots-and-provide-inject.md), [Composables](./composables.md), [Директивы](./directives.md), [`KeepAlive`, `Teleport`, `Suspense`, `Transition` и асинхронные компоненты](./built-in-components.md), [Vue Router](./vue-router.md), [Промисы](../javascript/promises.md), [Нефункциональные требования](../architecture/non-functional.md), [Принципы и паттерны проектирования](../architecture/principles-and-patterns.md), [curry, compose, memoize, once](../live-coding/function-utilities.md), [Pinia: сторы, getters, actions](../state-management/pinia.md), [Pinia: плагины, SSR и тестирование](../state-management/pinia-advanced.md), [SEO и обработка ошибок](../nuxt/seo-and-errors.md)

## Теория

Все проверки выполнены на Vue 3.5.45 в Node 26.13.1: компоненты монтировались в happy-dom, прод-поведение проверено со сборкой `runtime-core.cjs.prod.js` (`NODE_ENV=production`), типы — через `vue-tsc` на TS 6.0. Те же сценарии повторены на `3.6.0-rc.16`, отличия описаны во врезке про 3.6.

### Что такое плагин

У плагина нет особых прав. Это функция, которой передают `app`, и всё, что она делает, можно сделать вызовами `app` из `main.ts`. Плагин нужен, чтобы упаковать эти вызовы вместе с настройками и раздавать их как библиотеку: Vue Router, Pinia, i18n.

`app.use(plugin, ...options)` в runtime-core 3.5.45 устроен так:

- если у `plugin` есть функция `install`, вызывается `plugin.install(app, ...options)`, иначе, если `plugin` сам функция, вызывается `plugin(app, ...options)`;
- установленные плагины лежат в `WeakSet`. Повторный `use` того же объекта выдаёт `Plugin has already been applied to target app.` и `install` **не вызывает**, даже с другими опциями (проверено);
- плагин попадает в набор **до** вызова `install`. Если `install` бросил исключение, повторный `use` его уже не установит;
- `use` возвращает `app`, поэтому вызовы складываются в цепочку: `createApp(App).use(router).use(pinia).mount('#app')`.

`install` вызывается синхронно, поэтому порядок `use` и есть порядок установки. Это важно, когда один плагин читает то, что положил другой. Например, плагин, который в `install` вызывает `app.runWithContext(() => inject(routerKey))`, должен подключаться после роутера. Асинхронный `install` Vue не ждёт: возвращённый промис просто игнорируется, и `mount` может пройти раньше, чем плагин закончит работу.

Что плагин может сделать с приложением:

| Вызов | Что даёт | Область |
| --- | --- | --- |
| `app.provide(key, value)` | значение для `inject` в любом компоненте | всё приложение, но перекрывается `provide` в поддереве |
| `app.component(name, comp)` | глобальный компонент: доступен в шаблонах без импорта | всё приложение |
| `app.directive(name, dir)` | глобальная директива `v-name` | всё приложение |
| `app.config.globalProperties.$x` | свойство `this.$x` и `$x` в шаблоне | только публичный экземпляр компонента |
| `app.config.errorHandler` и др. | настройка приложения | одно приложение |
| `app.onUnmount(fn)` (3.5) | очистка при `app.unmount()` | одно приложение |
| `app.mixin(...)` | глобальный mixin | все компоненты (Options API, не рекомендуется) |

Всё это хранится в **контексте приложения** (`appContext`), а не в глобальном `Vue`, как было во Vue 2. Два `createApp` на одной странице не видят компоненты, директивы и `provide` друг друга. В SSR это свойство и даёт изоляцию запросов: на каждый запрос создают новое приложение и ставят плагины заново. Состояние, созданное **внутри** `install`, тоже получается своё на каждый запрос. Состояние на уровне модуля плагина общее для всех пользователей процесса (задача 3).

### `provide` против `globalProperties`

Документация Vue перечисляет оба способа как обычные сценарии для плагина. Senior-ответ: для новых API выбирают `app.provide` и composable, а `globalProperties` оставляют для совместимости с Options API.

`globalProperties` — это последний уровень поиска в прокси публичного экземпляра. Сначала ищутся `setupState`, `data`, `props` и контекст компонента, и только потом `appContext.config.globalProperties`. Отсюда последствия:

- **В `<script setup>` значения нет.** Там нет `this`. Достать его можно только через `getCurrentInstance().proxy.$x`, а это внутренний API. Шаблон и Options API свойство видят.
- **Типы нужно дописывать вручную.** Через module augmentation: `declare module 'vue' { interface ComponentCustomProperties { $formatPrice: (n: number) => string } }`. Файл с этой декларацией обязан быть модулем (хотя бы `export {}`), иначе она заменит типы Vue, а не дополнит их. После этого `$formatPrice` в шаблоне проверяется `vue-tsc`.
- **Имя может затенить или быть затенено.** Собственное свойство компонента с тем же именем побеждает. Документация так и пишет: «the component's own property will have higher priority». Ключ `provide` — `Symbol`, поэтому коллизий нет.
- **Подмена в тестах и в поддереве невозможна.** Значение `provide` можно переопределить для части дерева или передать через `global.provide` в тестах. Глобальное свойство одно на всё приложение.
- **Vapor Mode его не поддерживает** (см. врезку про 3.6).

`app.provide` + composable `useX()` даёт то же, что `this.$x`, и при этом с выводом типов из `InjectionKey<T>`, с понятной ошибкой при отсутствии плагина и с работой в `<script setup>` и в других composables. Как устроен поиск `inject` по цепочке `provides`, разобрано в теме [«Слоты и provide/inject»](./slots-and-provide-inject.md).

### `app.onUnmount` и очистка

До 3.5 у плагина не было штатного способа узнать, что приложение размонтировано. Глобальный слушатель `online`, интервал опроса или WebSocket, открытые в `install`, переживали `app.unmount()`. Это утечка при микрофронтендах, в тестах и при HMR. Во Vue 3.5 появился `app.onUnmount(cb)`.

Порядок в `app.unmount()` (исходники 3.5.45, проверено): сначала колбэки `onUnmount` в порядке регистрации, через `callWithAsyncErrorHandling` с кодом `16` («app unmount cleanup function»), и только потом `render(null, container)` размонтирует дерево. То есть ресурс плагина закрывается **раньше**, чем компоненты получают `onUnmounted`. Компонент, который в `onUnmounted` ещё обращается к API плагина (например, отписывается от сокета), должен быть готов к тому, что ресурс уже закрыт.

### Как ошибка проходит через Vue

Весь пользовательский код, который вызывает рантайм, обёрнут в две функции из `errorHandling.ts`:

- `callWithErrorHandling(fn, instance, type, args)` — `try/catch` вокруг вызова, в `catch` вызывается `handleError`;
- `callWithAsyncErrorHandling(...)` — то же, плюс если `fn` вернула промис, на него вешается `.catch(err => handleError(...))`. Поэтому ошибка в `async onMounted` или в async-обработчике `@click` тоже поймана (подробно — в теме [«Промисы»](../javascript/promises.md)).

`handleError(err, instance, type)` делает следующее:

1. Идёт от `instance.parent` вверх до корня. У каждого предка, который ещё не размонтирован, вызывает его хуки `errorCaptured` с аргументами `(err, instance.proxy, info)`. Если какой-то вернул `false`, обработка закончена.
2. Если цепочка дошла до конца и задан `app.config.errorHandler`, вызывает его с теми же аргументами (на время вызова отслеживание зависимостей выключено) и выходит.
3. Иначе вызывает `logError`. В dev это предупреждение `Unhandled error during execution of <info>` и **повторный `throw`**. В проде это `console.error(err)`, или `throw`, если включён `throwUnhandledErrorInProduction`.

Что получает обработчик (проверено на 3.5.45):

| Источник | `info` в dev | `info` в проде |
| --- | --- | --- |
| `setup()` | `setup function` | `…#runtime-0` |
| рендер | `render function` | `…#runtime-1` |
| колбэк `watch` | `watcher callback` | `…#runtime-3` |
| `@click` на элементе | `native event handler` | `…#runtime-5` |
| `@go` на компоненте (`emit`) | `component event handler` | `…#runtime-6` |
| хук директивы | `directive hook` | `…#runtime-8` |
| `onMounted` | `mounted hook` | `…#runtime-m` |
| загрузчик `defineAsyncComponent` | `async component loader` | `…#runtime-13` |

Префикс `…` — это `https://vuejs.org/error-reference/`. Строки описаний в прод-сборку не попадают, чтобы не раздувать бандл: остаётся короткий код, а расшифровка лежит на странице Production Error Code Reference. У хуков жизненного цикла код буквенный (`m`, `bum`, `ec`), у остального числовой. Для мониторинга `info` полезен как тег: по нему группируют ошибки рендера отдельно от ошибок обработчиков.

### Что `errorHandler` не ловит

Документация перечисляет источники: рендер, обработчики событий, хуки, `setup()`, watchers, хуки директив и `Transition`. Всё остальное идёт мимо (проверено):

- **`setTimeout`, `setInterval`, `requestAnimationFrame`.** Колбэк вызывает браузер, а не Vue. Исключение становится `error` на `window` (`uncaughtException` в Node).
- **Промис, который никто не вернул и не `await`-ил.** `fetch(...).then(...)` внутри обычного (не async) `onMounted`, вызов async-функции без `await`. Vue видит только возвращённое значение хука, поэтому отказ становится `unhandledrejection`.
- **Слушатели `addEventListener`**, подписки на сокеты и сторонние библиотеки. Это не обработчики из шаблона, invoker их не оборачивает.
- **Код вне компонентов:** модульный уровень, `main.ts` до `createApp`, guards роутера (у роутера свой `router.onError`).
- **Ошибки без экземпляра.** `handleError` читает `errorHandler` из `instance.appContext`. Ошибка самого `errorHandler` и dev-проверка `Maximum recursive updates exceeded` передаются с `instance = null` и сразу уходят в `logError`.

Поэтому полный сбор ошибок — это три источника: `app.config.errorHandler`, `window` `error` и `unhandledrejection`. К ним добавляют упавшие загрузки чанков и ответы API с кодом `5xx`. Как собранное превращается в наблюдаемость (релиз, хлебные крошки, source maps, алерты), разобрано в теме [«Нефункциональные требования»](../architecture/non-functional.md).

### `onErrorCaptured`: всплытие и остановка

`onErrorCaptured((err, instance, info) => boolean | void)` регистрирует хук `ec` на текущем компоненте. Правила (документация и исходники совпадают, проверено):

- **Ловит ошибки потомков, но не свои.** Обход начинается с `instance.parent`. Ошибка в `setup` компонента `Mid` не попадёт в его собственный `onErrorCaptured`, только в хуки родителей.
- **Порядок — снизу вверх**, как всплытие DOM-событий. Вызываются все хуки на цепочке, на каждом уровне в порядке регистрации.
- **`return false` останавливает всплытие.** Не будут вызваны ни верхние `onErrorCaptured`, ни `errorHandler`. Документация: «this error has been handled and should be ignored».
- **Если хук сам бросил исключение,** до `errorHandler` дойдут обе ошибки. Хук вызывается через `callWithAsyncErrorHandling` с типом `ec`, поэтому его ошибка запускает собственное всплытие от родителя хука. После этого исходная ошибка продолжает путь.
- **Размонтированные предки пропускаются.** Для асинхронных ошибок пропускаются и предки с остановленным scope.
- `instance` во втором аргументе — публичный экземпляр компонента, где **произошла** ошибка, а не того, кто её поймал. Options API-аналог — опция `errorCaptured` с теми же правилами.

### Error boundary

Компонент, который ловит ошибки поддерева и вместо него показывает запасной UI, во Vue пишется в несколько строк: `onErrorCaptured` кладёт ошибку в `shallowRef` и возвращает `false`, а рендер выбирает между слотами `default` и `fallback`. Встроенного компонента нет, `<Suspense>` ловит не ошибки, а ожидание.

Что важно знать о поведении (проверено):

- **Подмена — на следующем тике.** Если поддерево падает при первом монтировании, на месте упавшего компонента остаётся комментарий `<!---->`. Ошибка изменила `shallowRef` границы, и fallback появится после ближайшего flush планировщика. Соседние ветки не страдают.
- **Состояние поддерева теряется.** Fallback заменяет ветку целиком. `reset()` монтирует её заново, с новым `setup`. Если причина ошибки не устранена, граница сразу поймает её снова.
- **`return false` скрывает ошибку от мониторинга.** Граница, которая остановила всплытие, сама отвечает за отправку отчёта: вызывает репортер или эмитит событие. Иначе ошибка исчезнет из `errorHandler`.
- **Не всякая ошибка требует fallback.** Ошибка обработчика клика тоже всплывает к границе (`info` — `native event handler`), но заменять форму экраном ошибки из-за одного неудачного запроса — плохой UX. Граница может фильтровать по `info` и возвращать `false` только для ошибок рендера и `setup`.
- **Граница не ловит свои ошибки** и ошибки за пределами Vue (см. выше).

### Dev против прода и `throwUnhandledErrorInProduction`

Без `errorHandler` один и тот же код ведёт себя по-разному (проверено):

- **dev:** `logError` выводит предупреждение и пробрасывает ошибку. Если ошибка случилась в `setup` при `app.mount()`, бросает сам `mount`. Если в асинхронном хуке — получается `unhandledrejection`.
- **прод:** `console.error(err)`, и приложение продолжает работу. `mount` завершается, упавший компонент рендерится пустым.

Прод-поведение мягче для пользователя, но опасно для отладки: тесты и e2e на прод-сборке не падают, а ошибка видна только в консоли. В 3.5 добавили `app.config.throwUnhandledErrorInProduction = true`: необработанные ошибки пробрасываются и в проде. Это нужно, например, когда снаружи стоит свой глобальный обработчик или тестовый раннер должен увидеть исключение. Опция действует только при отсутствии `errorHandler`: если он задан, ошибка считается обработанной.

`app.config.warnHandler(msg, instance, trace)` перехватывает предупреждения Vue. Он работает **только в dev**: в прод-сборке `warn` — пустая функция. Его используют, чтобы в тестах превращать предупреждения в падения.

> [!NOTE]
> Во Vue 3.6 (RC, `3.6.0-rc.16`, сверено 2026-11-21) путь ошибки тот же: `handleError`, всплытие по `ec`, `errorHandler`, `logError`. Проверенные на 3.6 сценарии (плагины, всплытие, `errorHandler`, error boundary) дали тот же вывод. Отличия касаются Vapor Mode. `createVaporApp` использует тот же `createAppAPI`, поэтому `use`, `provide`, `onUnmount` и `errorHandler` работают так же. Но у Vapor-компонента нет прокси, и вторым аргументом в обработчик приходит сам внутренний экземпляр (`instance.proxy || instance`). А `app.config.globalProperties` в Vapor-компонентах не поддерживается: рантайм предупреждает «Property "$x" is provided via app.config.globalProperties, which is not supported in Vapor components». Ещё одна причина строить API плагина на `provide`.

> [!TIP]
> Плагин, который нужно настраивать, оформляйте фабрикой: `createApi({ baseURL })` возвращает объект с `install`. Тогда опции типизированы без `Plugin<[Options]>`, а повторный `app.use(createApi(...))` с другими опциями создаёт новый объект и не упирается в `WeakSet` (так устроены `createRouter` и `createPinia`).

## Примеры

### Плагин: `provide`, composable и очистка

```ts
// plugins/api.ts
import { inject, type App, type InjectionKey } from 'vue'

export interface Api {
  get<T>(path: string): Promise<T>
}

export interface ApiOptions {
  baseURL: string
}

const apiKey: InjectionKey<Api> = Symbol('api')

export function createApi({ baseURL }: ApiOptions) {
  return {
    install(app: App) {
      // Created inside install: one instance per app, i.e. per SSR request.
      const controller = new AbortController()
      const api: Api = {
        async get(path) {
          const res = await fetch(baseURL + path, { signal: controller.signal })
          if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
          return res.json()
        },
      }
      app.provide(apiKey, api)
      // Vue 3.5+: runs before the component tree is unmounted.
      app.onUnmount(() => controller.abort())
    },
  }
}

export function useApi(): Api {
  const api = inject(apiKey)
  if (!api) throw new Error('useApi() requires app.use(createApi(...))')
  return api
}
```

### Глобальный сбор ошибок

```ts
// plugins/error-reporting.ts
import type { App } from 'vue'

type Report = (err: unknown, context: Record<string, string | undefined>) => void

export function createErrorReporting(report: Report) {
  return {
    install(app: App) {
      app.config.errorHandler = (err, instance, info) => {
        report(err, { source: 'vue', info, component: instance?.$options.name })
      }
      const onError = (e: ErrorEvent) => report(e.error ?? e.message, { source: 'window' })
      const onRejection = (e: PromiseRejectionEvent) =>
        report(e.reason, { source: 'unhandledrejection' })
      window.addEventListener('error', onError)
      window.addEventListener('unhandledrejection', onRejection)
      app.onUnmount(() => {
        window.removeEventListener('error', onError)
        window.removeEventListener('unhandledrejection', onRejection)
      })
    },
  }
}
```

`errorHandler` один на приложение: следующее присваивание заменит предыдущее. Если обработчиков несколько (мониторинг, тосты, логирование), их объединяют в одном месте.

### Компонент `ErrorBoundary`

```vue
<!-- ErrorBoundary.vue -->
<script setup lang="ts">
import { onErrorCaptured, shallowRef } from 'vue'

const emit = defineEmits<{ error: [err: unknown, info: string] }>()
defineSlots<{
  default(): unknown
  fallback(props: { error: unknown; reset: () => void }): unknown
}>()

// Wrapped in an object so that `throw 0` or `throw null` still counts as a failure.
const failure = shallowRef<{ error: unknown } | null>(null)
const reset = () => {
  failure.value = null
}

onErrorCaptured((err, _instance, info) => {
  failure.value = { error: err }
  emit('error', err, info) // the boundary stops propagation, so it reports itself
  return false
})
</script>

<template>
  <slot v-if="failure" name="fallback" :error="failure.error" :reset="reset">
    <p role="alert">Something went wrong.</p>
  </slot>
  <slot v-else />
</template>
```

```vue
<ErrorBoundary @error="report">
  <OrdersTable />
  <template #fallback="{ reset }">
    <p role="alert">Не удалось показать заказы.</p>
    <button @click="reset">Повторить</button>
  </template>
</ErrorBoundary>
```

## Вопросы с интервью

::: details Что такое плагин во Vue и что он может сделать с приложением
Плагин — объект с `install(app, ...options)` или функция с той же сигнатурой. У него нет особых прав: он вызывает методы `app`, которые доступны и в `main.ts`. Может зарегистрировать глобальные компоненты и директивы, сделать `app.provide`, добавить `globalProperties`, настроить `app.config` (например, `errorHandler`), с 3.5 зарегистрировать очистку через `app.onUnmount`. `app.use` вызывает `install` синхронно, один раз на объект (дальше `WeakSet` и предупреждение), и возвращает `app` для цепочки. Всё регистрируется в контексте конкретного приложения, а не глобально, как во Vue 2. Поэтому в SSR на каждый запрос создают новое приложение и ставят плагины заново, а состояние создают внутри `install`, а не на уровне модуля.
:::

::: details Почему для API плагина лучше provide, а не globalProperties
`globalProperties` — последний уровень поиска в прокси экземпляра. Это свойство доступно через `this` и в шаблоне, но не в `<script setup>` и не в composables. Типы нужно дописывать через augmentation `ComponentCustomProperties`. Собственное свойство компонента с тем же именем его затеняет. Подменить его для поддерева или в тесте нельзя, и в Vapor Mode (3.6) оно не поддерживается. `app.provide(key, value)` с `InjectionKey<T>` и composable `useX()` типизирован из ключа, работает везде, где работает `inject`, переопределяется `provide` ниже по дереву и через `global.provide` в тестах, а при отсутствии плагина даёт понятную ошибку. `globalProperties` оставляют для совместимости с Options API и для хелперов шаблона.
:::

::: details Какие ошибки ловит app.config.errorHandler, а какие нет
Ловит ошибки из кода, который вызывает сам рантайм через `callWithErrorHandling`/`callWithAsyncErrorHandling`: `setup`, рендер, хуки жизненного цикла, watchers (getter, колбэк, cleanup), обработчики событий из шаблона и `emit`, хуки директив и `Transition`, загрузчики async-компонентов. Ловит и асинхронные ошибки, если хук или обработчик **вернул** промис: Vue вешает на него `.catch`. Не ловит ошибки там, где колбэк вызывает браузер или библиотека: `setTimeout`, промисы без `return`/`await`, `addEventListener`, сокеты, код модуля и `main.ts`, guards роутера (там `router.onError`). Не ловит и ошибки без экземпляра: ошибку самого `errorHandler`, dev-проверку бесконечной рекурсии обновлений. Поэтому мониторинг подписывается ещё на `error` и `unhandledrejection` у `window`.
:::

::: details Как работает onErrorCaptured и как остановить всплытие
`handleError` идёт от **родителя** упавшего компонента вверх до корня и вызывает все хуки `errorCaptured` снизу вверх, на каждом уровне в порядке регистрации. Аргументы: ошибка, публичный экземпляр, где она произошла, и `info`. Свои ошибки компонент не ловит. Если хук вернул `false`, обработка закончена: ни верхние хуки, ни `errorHandler` не вызываются. Если хук сам бросил исключение, в `errorHandler` придут обе ошибки: новая всплывает от родителя хука, а исходная продолжает путь. Размонтированные предки пропускаются. Без `false` ошибка дойдёт до `errorHandler`, и это поведение по умолчанию: так ошибки доходят до мониторинга в одном месте.
:::

::: details Как сделать error boundary во Vue и какие у него ограничения
Компонент с `onErrorCaptured`, который кладёт ошибку в `shallowRef` и возвращает `false`, и рендером «`fallback`, если есть ошибка, иначе `default`». В слот fallback передают `reset`, который сбрасывает состояние и монтирует ветку заново. Ограничения: подмена происходит на следующем тике (при падении на монтировании до этого на месте ветки комментарий), состояние упавшей ветки теряется, свои ошибки граница не ловит, ошибки вне Vue (таймеры, промисы без `await`) не ловит. Главное: `return false` скрывает ошибку от `errorHandler`, поэтому граница должна сама отправить отчёт. Ошибки обработчиков событий тоже всплывают к границе. Разумно фильтровать по `info` и показывать fallback только при ошибках рендера и `setup`.
:::

::: details Почему необработанная ошибка в dev роняет приложение, а в проде нет
Без `errorHandler` вызывается `logError`. В dev сборке он выводит предупреждение `Unhandled error during execution of …` и пробрасывает ошибку: `app.mount` бросает, асинхронная ошибка становится `unhandledrejection`. В прод-сборке ветка dev вырезана, остаётся `console.error(err)`, и приложение продолжает работу с пустым компонентом. Мягче для пользователя, но тесты на прод-сборке ошибку не замечают. Vue 3.5 добавил `app.config.throwUnhandledErrorInProduction = true`: необработанные ошибки пробрасываются и в проде. Если `errorHandler` задан, ошибка считается обработанной и не пробрасывается ни там, ни там.
:::

::: details Что делает app.onUnmount и когда он вызывается
Регистрирует колбэк на `app.unmount()` (Vue 3.5). Нужен плагинам, которые в `install` открывают ресурсы на уровне приложения: глобальные слушатели, интервалы, соединения. Без него эти ресурсы переживают размонтирование: утечки в микрофронтендах, тестах и при HMR. Колбэки вызываются в порядке регистрации через `callWithAsyncErrorHandling` (ошибка с `info` `app unmount cleanup function` уходит в `errorHandler`) **до** размонтирования дерева компонентов. Значит, `onUnmounted` компонентов срабатывает уже после закрытия ресурса плагина.
:::

## Задачи

### 1. Что выведет · средне

```js
const Leaf = { name: 'Leaf', setup() { throw new Error('boom') } }
const Mid = {
  name: 'Mid',
  setup() {
    onErrorCaptured((err, inst) => { console.log('Mid', inst.$options.name); return false })
    return () => h(Leaf)
  },
}
const Root = {
  name: 'Root',
  setup() {
    onErrorCaptured(() => console.log('Root'))
    return () => h(Mid)
  },
}
const app = createApp(Root)
app.config.errorHandler = (err, inst, info) => console.log('handler', info)
app.mount(document.createElement('div'))
```

Что изменится, если `Mid` вернёт `undefined`? А если ошибку бросит `setup` самого `Mid`, а не `Leaf`?

::: details Решение и разбор
```text
Mid Leaf
```

В dev после этого будет ещё предупреждение `Component is missing template or render function`: `setup` у `Leaf` не вернул render-функцию, и компонент рендерится комментарием.

`handleError` начинает обход с родителя `Leaf`, то есть с `Mid`. Хук получает экземпляр, **где** произошла ошибка (`Leaf`). `return false` останавливает обработку: ни `Root`, ни `errorHandler` не вызываются.

Если `Mid` вернёт `undefined`: `Mid Leaf`, `Root`, `handler setup function`. Всплытие идёт снизу вверх, а потом ошибка попадает в `errorHandler`.

Если бросит `Mid`: его собственный хук не вызывается, потому что обход начинается с `instance.parent`. Вывод: `Root`, `handler setup function`. Хук, зарегистрированный до `throw`, к этому моменту уже есть, но компонент свои ошибки не ловит.
:::

### 2. Найдите баг · легко

Мониторинг подключён через `app.config.errorHandler`, но ошибки загрузки профиля в него не попадают. Почему?

```js
onMounted(() => {
  fetch('/api/profile')
    .then((r) => r.json())
    .then((data) => { profile.value = data.user.name })
})
onMounted(() => {
  setTimeout(() => { widget.init() }, 0)
})
```

::: details Решение и разбор
Оба хука синхронные и возвращают `undefined`. `callWithAsyncErrorHandling` вешает `.catch` только на **возвращённый** промис. Цепочка `fetch` здесь живёт сама по себе, и её отказ становится `unhandledrejection` на `window`. Колбэк `setTimeout` вызывает браузер, а не Vue, поэтому исключение из `widget.init()` уходит в `error` на `window`.

```js
onMounted(async () => {
  const r = await fetch('/api/profile')
  profile.value = (await r.json()).user.name
})
onMounted(() => {
  setTimeout(() => {
    try { widget.init() } catch (err) { report(err, { source: 'widget' }) }
  }, 0)
})
```

Теперь отказ `fetch` попадает в `errorHandler` с `info` `mounted hook`. Ошибку таймера можно поймать только самому. Страховка для всего, что прошло мимо Vue, — подписка на `error` и `unhandledrejection` у `window` в плагине мониторинга. Отдельно: `async onMounted` не задерживает монтирование, Vue не ждёт промис.
:::

### 3. Найдите баг · средне

Плагин уведомлений работает в SPA, но в Nuxt-подобном SSR пользователи иногда видят чужие уведомления, а в `<script setup>` `$notify` недоступен. Найдите обе проблемы и перепишите.

```js
const items = reactive([])

export const notifyPlugin = {
  install(app) {
    app.config.globalProperties.$notify = (text) => items.push({ id: Date.now(), text })
    app.config.globalProperties.$notifications = items
  },
}
```

::: details Решение и разбор
1. `items` объявлен на уровне модуля. Модуль на сервере загружается один раз на процесс, поэтому массив общий для всех запросов: уведомление, добавленное при рендере страницы одного пользователя, попадёт в HTML другого. Состояние нужно создавать внутри `install`: `install` вызывается для каждого `createApp`, а значит для каждого запроса.
2. `globalProperties` видны только через `this` и в шаблоне. В `<script setup>` нет `this`, и дотянуться можно только через внутренний `getCurrentInstance()`. Нужны `provide` и composable.

```ts
import { inject, reactive, readonly, type App, type InjectionKey } from 'vue'

interface Notifications {
  items: readonly { id: number; text: string }[]
  notify(text: string): void
}
const key: InjectionKey<Notifications> = Symbol('notifications')

export const notifyPlugin = (app: App) => {
  let seq = 0
  const items = reactive<{ id: number; text: string }[]>([]) // per app, per request
  app.provide(key, {
    items: readonly(items),
    notify: (text) => { items.push({ id: ++seq, text }) },
  })
}

export function useNotifications() {
  const n = inject(key)
  if (!n) throw new Error('useNotifications() requires app.use(notifyPlugin)')
  return n
}
```

Попутно `Date.now()` заменён счётчиком: два уведомления за одну миллисекунду получили бы одинаковый `id`, а это ключ в `v-for`. `readonly` не даёт компонентам менять список мимо `notify`.
:::

### 4. Реализуйте error boundary с фильтром · сложно

Доработайте `ErrorBoundary` из «Примеров». Fallback должен показываться только тогда, когда ветка осталась без DOM: при ошибках `setup`, рендера и загрузчика async-компонента. Остальные ошибки (обработчики событий, watchers, хуки) граница должна пропускать дальше, к `errorHandler`. Учтите, что в проде `info` — это ссылка с кодом.

::: details Решение и разбор
```ts
const FALLBACK_CODES = new Set(['0', '1', '13']) // setup, render, async component loader
const FALLBACK_INFO = new Set(['setup function', 'render function', 'async component loader'])

function shouldShowFallback(info: string): boolean {
  const code = info.match(/#runtime-(\w+)$/)?.[1] // production: short code
  return code !== undefined ? FALLBACK_CODES.has(code) : FALLBACK_INFO.has(info)
}

onErrorCaptured((err, _instance, info) => {
  if (!shouldShowFallback(info)) return // keep propagating to errorHandler
  failure.value = { error: err }
  emit('error', err, info)
  return false
})
```

- Ошибка в `@click` или `watch` не ломает дерево: компонент остался смонтированным. Заменять его экраном ошибки значит терять ввод пользователя. Такая ошибка уходит дальше, к `errorHandler`, и там, например, показывается тост.
- Ошибка в хуке тоже не прерывает монтирование. Хук вызывается через `callWithAsyncErrorHandling`, исключение поймано, и рендер продолжается: компонент с упавшими `onBeforeMount` и `onMounted` всё равно оказывается в DOM (проверено). Поэтому хуки в списке нет.
- Ошибка рендера или `setup` оставляет ветку без DOM (на её месте комментарий), поэтому fallback обязателен.
- Справочник кодов — Production Error Code Reference. В dev сверяем строку, в проде код из хвоста URL. Формат `info` — часть контракта Vue. Если закрепить его тестом на прод-сборке, смена формата не пройдёт незамеченной.
:::

## Источники

- [Vue: Plugins](https://vuejs.org/guide/reusability/plugins.html)
- [Vue: Application API — `app.use`, `app.onUnmount`, `app.runWithContext`, `app.config.errorHandler`, `warnHandler`, `globalProperties`, `throwUnhandledErrorInProduction`](https://vuejs.org/api/application.html)
- [Vue: `onErrorCaptured` и правила всплытия](https://vuejs.org/api/composition-api-lifecycle.html#onerrorcaptured)
- [Vue: Production Error Code Reference](https://vuejs.org/error-reference/)
- [Vue: TypeScript — Augmenting Global Properties](https://vuejs.org/guide/typescript/options-api.html#augmenting-global-properties)
- [Vue 3.5 CHANGELOG: `app.onUnmount`, `throwUnhandledErrorInProduction`](https://github.com/vuejs/core/blob/main/CHANGELOG.md)
- Исходники `@vue/runtime-core` 3.5.45: `errorHandling.ts` (`callWithErrorHandling`, `callWithAsyncErrorHandling`, `handleError`, `logError`, `ErrorCodes`), `apiCreateApp.ts` (`use`, `onUnmount`, `unmount`); `@vue/runtime-vapor` 3.6.0-rc.16 (предупреждение о `globalProperties`)
- [HTML Living Standard: report an exception](https://html.spec.whatwg.org/multipage/webappapis.html#report-the-exception)
