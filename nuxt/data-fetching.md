---
title: 'Работа с данными: `$fetch`, `useFetch`, `useAsyncData`'
level: ядро
---

# Работа с данными: `$fetch`, `useFetch`, `useAsyncData`

> **Коротко.** `$fetch` — просто HTTP-клиент (ofetch): в `setup` он выполнится на сервере и ещё раз на клиенте при гидрации. `useAsyncData(key, handler)` запоминает результат под ключом в `nuxtApp.payload.data`. Payload сериализуется `devalue` в HTML, поэтому клиент при гидрации берёт данные оттуда и не повторяет запрос. `useFetch(url)` — это `useAsyncData` с ключом из URL и опций и с `$fetch`, который на сервере пробрасывает заголовки запроса. В Nuxt 4 все вызовы с одним ключом делят один `data`, `data` — `shallowRef`, а пустое значение — `undefined`.

**Связанные темы:** [Состояние и конфигурация: `useState` vs Pinia, `runtimeConfig`](./state-and-config.md), [SSR и гидрация](../vue/ssr-and-hydration.md), [Производительность Vue и Nuxt](../performance/vue-performance.md), [Middleware и плагины](./middleware-and-plugins.md), [Маршрутизация: файловые, динамические и вложенные маршруты, layouts](./routing.md), [Структура проекта и auto-imports](./project-structure.md), [Composables](../vue/composables.md), [Реактивность: `ref`, `reactive`, `computed`](../vue/reactivity.md), [`KeepAlive`, `Teleport`, `Suspense`, `Transition` и асинхронные компоненты](../vue/built-in-components.md), [Данные и сеть в System Design](../architecture/data-and-network.md), [Архитектура состояния: локальное, глобальное, серверное](../state-management/state-architecture.md), [HTTP-кэширование и CDN](../network/caching.md), [Same-origin policy, CORS и cookies](../network/cors-and-cookies.md), [Аутентификация на фронтенде](../security/authentication.md), [Промисы](../javascript/promises.md), [Режимы рендеринга и lazy hydration](./rendering-modes.md), [Nitro: серверные маршруты и деплой](./nitro.md), [SEO и обработка ошибок](./seo-and-errors.md)

## Теория

Все фрагменты проверены на Nuxt 4.6.4 с Nitro 2.13.6 и Vue 3.5.45 в Node 26.13.1: `nuxi build` + `node .output/server/index.mjs` (ответы и payload — `curl`), гидрация и клиентская навигация — в браузере через Playwright, предупреждения — в `nuxi dev`, типы — `nuxi typecheck` на TypeScript 6.0. Устройство описано по `node_modules/nuxt/dist/app/composables/`: `asyncData.js`, `fetch.js`, `ssr.js`, `payload.js`. Сама гидрация разобрана в теме [«SSR и гидрация»](../vue/ssr-and-hydration.md), влияние payload на скорость — в [«Производительности Vue и Nuxt»](../performance/vue-performance.md#nuxt-payload-и-загрузка-данных).

### Три инструмента

| | Что это | Когда |
| --- | --- | --- |
| `$fetch` | `ofetch`: `fetch` + разбор JSON + ошибка на статус 4xx/5xx | действия пользователя: submit, клик, внутри `useAsyncData` |
| `useAsyncData(key, handler)` | кэш результата `handler` под ключом + передача на клиент | данные страницы из любого источника: SDK, несколько запросов, вычисление |
| `useFetch(url, opts)` | `useAsyncData` + `$fetch` с ключом, собранным из запроса | данные страницы по одному URL |

### Почему `$fetch` в `setup` выполняется дважды

`$fetch` ничего не знает о SSR. Сервер выполняет `setup`, ждёт запрос, рендерит HTML. Клиент при гидрации выполняет тот же `setup` заново — и тот же запрос. Проверено на странице `const res = await $fetch('/api/count')`, где API считает обращения: сервер отрендерил `double 2`, браузер сделал свой запрос, получил `3`, и Vue вывел `Hydration completed but contains mismatches`. Лишний запрос, расхождение разметки и задержка интерактивности — вот почему данные страницы грузят через `useFetch`/`useAsyncData`.

Деталь: на сервере `$fetch('/api/count')` с относительным URL не идёт в сеть. Nitro подменяет глобальный `$fetch` на `localFetch`: запрос на путь с `/` вызывает обработчик h3 в том же процессе (`nitropack/dist/runtime/internal/app.mjs`). Абсолютный URL уходит обычным `fetch`.

### Payload: как данные попадают на клиент

На сервере `useAsyncData`:

1. Создаёт запись `nuxtApp._asyncData[key]` и запускает `handler`.
2. Регистрирует `onServerPrefetch(() => promise)`, поэтому рендерер дождётся данных **даже без `await`**. `await` на сервере влияет только на код ниже по `setup`, HTML от него не меняется.
3. Записывает результат (после `transform` и `pick`) в `nuxtApp.payload.data[key]`, ошибку — в `payload._errors[key]`.

После рендера payload сериализуется `devalue` в `<script type="application/json" id="__NUXT_DATA__">`. Фрагмент реального ответа:

```html
<script type="application/json" id="__NUXT_DATA__" data-ssr="true">[["ShallowReactive",1],{"data":2,...},
["ShallowReactive",3],{"$f1qvna04pp4f4w":4,"date-direct":6},{"n":5},1,{"at":7,"m":8},
["Date","2026-01-01T00:00:00.000Z"],["Map",9,5],"k",...]</script>
```

`devalue` умеет то, чего нет в JSON: `Date`, `Map`, `Set`, циклические ссылки, `ref`/`reactive` (через reducers плагина `revive-payload`), `NuxtError`, и экранирует `</script>`. На клиенте `getNuxtClientPayload()` разбирает этот тег до создания приложения. Когда `useAsyncData` вызывается при гидрации, он видит ключ в `payload.data` и непустой `data`: ставит `status = 'success'` и **не вызывает** `handler`. Проверено: на странице с `useFetch` клиент не сделал ни одного запроса к API.

Две оговорки из исходников:

- **`handler` вернул `undefined`** — для клиента это «данных нет». Он перезапрашивает их перед монтированием, `status` становится `'pending'`, и разметка расходится с серверной. Проверено: повторный запрос и `Hydration completed but contains mismatches`. В dev — `[NUXT_E3006] useAsyncData handler returned undefined`. Возвращайте `null`.
- **Ответ API идёт через JSON, а не через `devalue`.** `server/api/date.ts`, вернувший `{ at: new Date(), tags: new Set(['a']) }`, даёт в `useFetch` строку и `{}`. Тот же объект, созданный прямо в `handler` у `useAsyncData`, приходит на клиент как `Date` и `Map`: `devalue` сериализует payload, а не ответ API.

Для пререндеренных страниц и маршрутов `isr`/`swr` данные выносятся в `_payload.json`: в HTML остаётся `data-src="/slug/a/_payload.json?..."`, а при клиентской навигации Nuxt загружает только этот файл.

### Ключ

От ключа зависит всё: где лежат данные в payload, кто делит состояние, когда перезапрашивать.

| Вызов | Ключ |
| --- | --- |
| `useAsyncData('user', fn)` | `'user'` |
| `useAsyncData(fn)` | автоключ: компилятор Nuxt дописывает последним аргументом строку вида `'$zLvGbNYpzI'` — хэш файла и места вызова |
| ``useAsyncData(() => `user-${id.value}`, fn)`` | реактивный: getter, `ref` или `computed` |
| `useFetch('/api/x', opts)` | `'$f' + hash([автоключ, URL, method, baseURL, query, body])`, если не задан `opts.key` |

Автоключ виден в клиентском бандле: `useAsyncData(() => $fetch(...), '$zLvGbNYpzI')`. Поэтому два `useFetch('/api/user')` в разных компонентах — **разные** ключи и два запроса. Поделить данные можно только явным `key`.

**Один ключ — одно состояние.** В Nuxt 4 все вызовы с одним ключом получают computed-обёртки над одной записью `nuxtApp._asyncData[key]`. Запись создаёт **первый** вызов, и в ней остаются его `handler` и опции. Проверено: `UsersA` вызвал `useAsyncData('users', h)`, `UsersB` — тот же ключ с `transform: r => ({ n: r.n * 100 })`. Оба показали `8`, а не `800`: `transform` второго вызова не применился. На сервере второй вызов перезапустил запрос (`dedupe: 'cancel'`), поэтому API получил два обращения. В dev Nuxt предупреждает: `[NUXT_E3004] Incompatible options detected for "users": different transform option`. Должны совпадать `handler`, `transform`, `pick`, `getCachedData`, `default`, `deep`, `serialize`, `middleware`. Различаться могут `server`, `lazy`, `immediate`, `dedupe`, `watch`. Общий запрос с опциями оборачивают в свой composable.

**Реактивный ключ.** Смена ключа создаёт новую запись, запускает `handler` и отписывает компонент от старой. Когда у записи не остаётся подписчиков (компоненты размонтированы), Nuxt удаляет её из `_asyncData` и `payload.data` (`experimental.purgeCachedData`, в Nuxt 4 включён). `useFetch` с функцией-URL работает так же: URL входит в ключ. Проверено: переход `/user/1 → /user/2` дал один запрос `/api/user/2`.

> [!WARNING]
> При пререндеринге включён `sharedPrerenderData`: страницы, которые генерируются в одном процессе, делят результаты по ключу. ``useAsyncData(() => $fetch(`/api/item/${route.params.slug}`))`` в `[slug].vue` получает один автоключ для всех slug. Проверено: `/slug/b/index.html` содержит `Item a`. Ключ должен однозначно определять данные: ``useAsyncData(`item-${slug}`, ...)`` (задача 3). `useFetch` безопасен: URL входит в ключ.

### Что возвращается

`{ data, status, error, pending, refresh, execute, clear }` — и одновременно промис, который на клиенте разрешается, когда запрос завершён.

- **`data`** — `shallowRef` (опция `deep: false` по умолчанию). Реактивна только замена `data.value`. Мутация `data.value.profile.name = 'Bob'` экран не обновит (задача 1). Для глубокой реактивности — `deep: true` или замена объекта целиком. Пустое значение — `undefined` или результат `default()`.
- **`status`** — `'idle' | 'pending' | 'success' | 'error'`.
- **`pending`** — `computed(() => status.value === 'pending')`.
- **`error`** — `NuxtError` или `undefined`. При ошибке `data` сбрасывается в `default()`.
- **`clear()`** — отменяет запрос, возвращает `data` к `default()`, `status` к `'idle'` и удаляет ключ из payload.

### `await`, `lazy`, `server: false`, `immediate: false`

Страницы Nuxt рендерятся внутри `<Suspense>`. Асинхронный `setup` (`await` на верхнем уровне) держит **старую страницу на экране**, пока новая не разрешится. Проверено переходом на страницу с запросом на 1,5 с: адрес в браузере сменился через ~80 мс, а содержимое — только когда пришли данные.

| Вариант | Клиентская навигация | Когда стартует запрос на клиенте | Сервер |
| --- | --- | --- | --- |
| `await useFetch(url)` | ждёт данных | в `setup` | запрос, данные в payload |
| `useFetch(url)` без `await` | сразу; `status` — `'pending'` | в `setup` | то же |
| `await useFetch(url, { lazy: true })` | сразу; после `await` — `status: 'idle'`, `data: undefined` | в `onBeforeMount` | то же |
| `{ server: false }` | как без `server: false` | при гидрации — в `onBeforeMount` | запроса нет, в payload ничего |
| `{ immediate: false }` | сразу, `status: 'idle'` | только по `execute()` | запроса нет |

`await` и `lazy` независимы: `await` у ленивого вызова на клиенте разрешается сразу. `server: false` нужен для данных, которые не нужны в HTML: персональные блоки, тяжёлые виджеты ниже первого экрана. Цена — данные появятся только после гидрации, их нет для SEO и в LCP ([«Core Web Vitals»](../performance/web-vitals.md)). `useLazyFetch` и `useLazyAsyncData` — те же функции с `lazy: true`.

### Перезапрос и отмена

- **Автоматически:** смена реактивного ключа, источники из `watch: [page]` и любые реактивные опции `useFetch` (`query`, `body`, `headers`): `useFetch` сам добавляет их объект в `watch`. `watch: false` это выключает.
- **Вручную:** `refresh()` у результата, `refreshNuxtData('key')` или `refreshNuxtData()` — по всем ключам через хук `app:data:refresh`. На сервере `refreshNuxtData` ничего не делает. `clearNuxtData(keys)` очищает записи.
- **`dedupe`** — что делать, если запрос по ключу уже идёт. `'cancel'` (по умолчанию) отменяет его через `AbortController` и запускает новый. `'defer'` возвращает текущий промис. Проверено: два `refresh()` подряд с `'cancel'` — два запроса, первый браузер оборвал, в `data` второй. С `'defer'` ушёл один запрос.
- **`signal`** (4.2): `handler(nuxtApp, { signal })` получает сигнал, который срабатывает при дедупликации, `clear()`, размонтировании и `timeout` (4.2). `useFetch` передаёт его в `$fetch` сам, в `useAsyncData` его нужно передать в свой запрос. `refresh({ signal })` добавляет внешний сигнал.
- **`enabled`** (4.5): `MaybeRefOrGetter<boolean>`. Пока `false`, `handler` не запускается ни одним способом. Переход в `false` отменяет текущий запрос, но `data` не трогает. Включение запрос не запускает.
- **`serialize: false`** и **`middleware`** (4.6): не класть результат в payload и обернуть `handler` цепочкой `next()` — для повторов, логирования, заголовков.

**`getCachedData(key, nuxtApp, ctx)`** решает, брать ли данные без запроса. По умолчанию при гидрации это `payload.data[key]`, иначе `nuxtApp.static.data[key]` (данные пререндера) — кроме ручного `refresh`. В Nuxt 4 функция вызывается при **каждом** запуске, а `ctx.cause` сообщает причину: `'initial' | 'watch' | 'refresh:manual' | 'refresh:hook'`. Классический клиентский кэш между переходами:

```ts
const { data } = await useFetch('/api/count', {
  key: 'cached-count',
  getCachedData: (key, nuxtApp, ctx) =>
    ctx.cause === 'refresh:manual' ? undefined : nuxtApp.payload.data[key] ?? nuxtApp.static.data[key],
})
```

Проверено: «страница → главная → страница» с этим `getCachedData` даёт один запрос, без него — два, `refresh()` всегда идёт в сеть. Своя `getCachedData` отключает очистку записи при размонтировании, поэтому данные переживают уход со страницы. Это кэш без TTL и инвалидации: если нужна свежесть, берут библиотеку server state ([«Архитектура состояния»](../state-management/state-architecture.md)) или ставят TTL в `getCachedData`.

### Заголовки и cookie при SSR

В браузере cookie прикладывает браузер. На сервере `$fetch` — запрос из Node, и **никаких** заголовков пользователя у него нет.

- `useFetch('/api/me')` с относительным URL на сервере берёт `useRequestFetch()`, то есть `event.$fetch`. Он копирует заголовки входящего запроса, кроме `host`, `accept`, `accept-encoding`, `connection` и других hop-by-hop (`getProxyRequestHeaders` из h3).
- `$fetch('/api/me')` внутри `useAsyncData` — без cookie.
- `useRequestFetch()` или `$fetch(url, { headers: useRequestHeaders(['cookie']) })` — с cookie.

Проверено запросом с `cookie: session=abc` на страницу с четырьмя вариантами: `abc | (пусто) | abc | abc`. Во **внешний** API все заголовки не пробрасывают: `useFetch` использует `useRequestFetch` только для путей, которые начинаются с `/`. Для внешнего API — явный список через `useRequestHeaders(['cookie'])`. Обратное направление (`Set-Cookie` из ответа API в ответ браузеру) Nuxt не делает: это `$fetch.raw` и `appendResponseHeader`, разобрано в задаче «Сессия теряется при SSR» темы [«Same-origin policy, CORS и cookies»](../network/cors-and-cookies.md).

### Типизация `$fetch` к своим `server/api`

`nuxi prepare` генерирует `.nuxt/types/nitro-routes.d.ts`: для каждого маршрута `'/api/date': { default: Simplify<Serialize<Awaited<ReturnType<typeof import('../../server/api/date').default>>>> }`. `$fetch` и `useFetch` подбирают тип по строке URL и методу. `Serialize` повторяет JSON: `Date` становится `string`. Проверено `nuxi typecheck`: `const at: Date = r.at` — `TS2322`, `data.value.profile` без проверки — `TS18048` (`data` может быть `undefined`). Тип общего для сервера и клиента кода кладут в `shared/` ([«Структура проекта»](./project-structure.md#код-общии-для-приложения-и-сервера)).

> [!NOTE]
> В Nuxt 3 было иначе ([3.x](https://nuxt.com/docs/3.x/getting-started/data-fetching)): `data` — глубокий `ref`, пустые `data` и `error` — `null`, а не `undefined`. Вызовы с одним ключом имели независимые refs, данные не удалялись при размонтировании, ключ был только строкой. `getCachedData` вызывался только при первой загрузке, `pending` был `true` и в состоянии `idle`, `dedupe` принимал `true`/`false`, `clear()` не учитывал `default`. Почти всё откатывается флагами: `experimental.granularCachedData`, `purgeCachedData`, `pendingWhenIdle`, `defaults.useAsyncData.deep`. Кодмод для `shallowRef` — `npx codemod@latest nuxt/4/shallow-function-reactivity`.

> [!WARNING]
> Nuxt 5 (не выпущен, сверено 2026-11-21 по схеме `@nuxt/schema` 4.6.4 и флагу `compatibilityVersion: 5`): `experimental.routeTypedFetch` включается по умолчанию. Типы `$fetch` и `useFetch` берутся из маршрутов, о которых сообщает сервер, вместе со схемами запроса. Опция `params` у `useFetch` больше не принимается: Nuxt удаляет её с предупреждением `NUXT_E3010`, используйте `query`. `payloadExtraction` становится `'client'`: при первой загрузке payload пререндеренной страницы встроен в HTML, `_payload.json` загружается только при клиентской навигации.

## Примеры

### Страница товара: payload, ленивый блок, мутация

```vue
<!-- app/pages/products/[id].vue -->
<script setup lang="ts">
const route = useRoute()
const id = computed(() => String(route.params.id))

// blocks navigation, goes into the payload
const { data: product, error } = await useFetch(() => `/api/products/${id.value}`, {
  key: computed(() => `product-${id.value}`), // explicit: other components can refresh it
  pick: ['id', 'title', 'price', 'stock'], // only these fields reach the payload
})
if (error.value) throw createError({ status: error.value.status, fatal: true })

// below the fold: does not block navigation, not in the SSR HTML
const { data: reviews, status } = useLazyFetch(() => `/api/products/${id.value}/reviews`, {
  server: false,
  default: () => [],
})

async function buy() {
  // an action, not page data: plain $fetch
  await $fetch(`/api/products/${id.value}/orders`, { method: 'POST' })
  // stock changed on the server: refetch by key (the mini cart can do the same)
  await refreshNuxtData(`product-${id.value}`)
}
</script>
```

Проверено: в payload под ключом `product-5` четыре поля без `description`, отзывы браузер запросил после гидрации, а `buy()` дал `POST` и один `GET /api/products/5`. Явный ключ нужен, чтобы перезапросить данные из другого места: автоключ `useFetch` — хэш, угадать его нельзя. Внутри самой страницы хватило бы `refresh` из результата. `pick` урезает объект до записи в payload, но не уменьшает ответ API: если поля не нужны вовсе, их убирают на сервере.

### Свой `useFetch` для внешнего API

```ts
// app/composables/useApi.ts — createUseFetch is 4.4+
export const useApi = createUseFetch((options) => ({
  baseURL: useRuntimeConfig().public.apiBase,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined, // only cookie
  ...options,
}))
// usage: const { data } = await useApi('/orders', { query: { page } })
```

Nuxt находит такие фабрики в `app/composables/` и подставляет автоключи в их вызовы, как в `useFetch`. Функция-аргумент вызывается на каждый вызов `useApi`, поэтому composables внутри неё работают. Проверено: при SSR внешний API получил `cookie` пользователя и `user-agent: node`, то есть только явно переданный заголовок. До 4.4 то же делали обёрткой над `useFetch` с `$fetch.create` из плагина ([«Middleware и плагины»](./middleware-and-plugins.md#плагин-с-типизированным-provide)).

## Вопросы с интервью

::: details Зачем нужны useFetch и useAsyncData, если есть $fetch
`$fetch` в `setup` выполнится на сервере при SSR и ещё раз на клиенте при гидрации: лишний запрос, возможный hydration mismatch, если ответ изменился, и задержка интерактивности. `useAsyncData` кладёт результат под ключом в `nuxtApp.payload`, payload сериализуется в HTML, и клиент при гидрации берёт данные оттуда без запроса. Кроме того, он даёт `status`/`error`, блокирует клиентскую навигацию через `Suspense`, умеет перезапрос, отмену и дедупликацию. `useFetch` — это `useAsyncData` с ключом из URL и опций и с пробросом заголовков на сервере. `$fetch` остаётся для действий: submit, клик, и как запрос внутри `useAsyncData`.
:::

::: details Как данные с сервера попадают на клиент и почему клиент не повторяет запрос
На сервере `useAsyncData` запускает `handler`, регистрирует `onServerPrefetch`, чтобы рендерер дождался промиса, и пишет результат в `nuxtApp.payload.data[key]`. После рендера payload сериализуется `devalue` в `<script id="__NUXT_DATA__">`: в отличие от JSON, он сохраняет `Date`, `Map`, `Set`, refs и экранирует `</script>`. На клиенте payload разбирается до создания приложения. При гидрации `useAsyncData` находит ключ и непустые данные, ставит `status: 'success'` и `handler` не вызывает. Если `handler` вернул `undefined`, клиент считает данные отсутствующими и перезапрашивает. Для пререндеренных страниц данные лежат в `_payload.json`.
:::

::: details Как устроен ключ и что будет, если два компонента вызовут useAsyncData с одним ключом
Ключ — адрес данных в payload и в `nuxtApp._asyncData`. Явный — первый аргумент; без него компилятор подставляет автоключ — хэш файла и позиции вызова. У `useFetch` ключ — хэш автоключа, URL, метода, `baseURL`, `query` и `body`, поэтому одинаковые `useFetch` в двух компонентах дают два запроса. В Nuxt 4 вызовы с одним ключом делят одну запись: один `data`, `error`, `status`. Запись создаёт первый вызов, с его `handler` и опциями, поэтому `transform`, `pick`, `default`, `deep`, `getCachedData` и `handler` должны совпадать, иначе dev-предупреждение `NUXT_E3004` и неожиданные данные. Ключ может быть реактивным: смена создаёт новую запись и запускает запрос. Запись удаляется, когда размонтирован последний компонент. В Nuxt 3 refs с одним ключом были независимыми.
:::

::: details Почему data в Nuxt 4 стал shallowRef и какой баг это даёт при миграции
Ответы API обычно заменяются целиком, а глубокий `ref` оборачивает в `Proxy` каждый вложенный объект при чтении. Для больших ответов это лишняя работа и память, поэтому в Nuxt 4 `deep: false` по умолчанию. Баг миграции: код из Nuxt 3, который мутирует `data.value.user.name = ...` или делает `data.value.items.push(...)`, перестаёт обновлять экран. Значение изменилось, но эффект подписан только на `.value`. Изменение всплывёт при следующем рендере по другой причине, что ещё запутаннее. Лечится заменой объекта, `deep: true` для конкретного вызова или `experimental.defaults.useAsyncData.deep`. Второй миграционный баг — проверки `data.value === null`: пустое значение теперь `undefined`.
:::

::: details Чем отличаются lazy, server false и immediate false и что выбрать вместо pending
`lazy: true` не блокирует клиентскую навигацию: страница показывается сразу, запрос на клиенте стартует в `onBeforeMount`, а `await` такого вызова разрешается сразу. На сервере `lazy` ничего не меняет, данные всё равно в HTML. `server: false` — запроса на сервере нет, в payload ничего, клиент запросит данные при гидрации. `immediate: false` — запроса нет вообще, пока не вызовут `execute()`, `status` — `'idle'`. Индикатор — `status` (`idle`/`pending`/`success`/`error`). В Nuxt 4 `pending` — производное `status === 'pending'`, в Nuxt 3 он был `true` и в `idle`, поэтому `immediate: false` показывал вечный спиннер.
:::

::: details Как на сервере передать в API cookie пользователя
При SSR запрос делает Node, браузерных cookie у него нет. `useFetch` с относительным URL на сервере использует `useRequestFetch()` (`event.$fetch`), который копирует заголовки входящего запроса, кроме hop-by-hop, `host` и `accept`. Голый `$fetch` внутри `useAsyncData` ничего не передаёт: нужен `useRequestFetch()` или `headers: useRequestHeaders(['cookie'])`. Во внешний API пробрасывают только нужные заголовки, а не все: `host`, `x-forwarded-*` и подобные ломают маршрутизацию и могут подделать данные о клиенте. `Set-Cookie` из ответа API сам до браузера не дойдёт: его переносят через `$fetch.raw` и `appendResponseHeader`. Надёжнее — BFF: браузер ходит только в свой `/api`.
:::

::: details Как типизируется $fetch к своим API и почему Date приходит строкой
`nuxi prepare` генерирует `.nuxt/types/nitro-routes.d.ts`: каждому маршруту из `server/api` сопоставлен тип `Serialize<Awaited<ReturnType<handler>>>`. `$fetch` и `useFetch` выбирают тип по литералу URL и методу. `Serialize` моделирует `JSON.stringify`, которым Nitro отдаёт ответ: `Date` становится `string`, `Set` — объектом без полей. Это не ограничение payload: payload сериализует `devalue`, но в него попадает уже разобранный JSON. Нужен `Date` — восстанавливают в `transform`. В Nuxt 5 типы будут строиться из маршрутов, о которых сообщает сервер, с учётом схем валидации, а `params` у `useFetch` уберут.
:::

## Задачи

### 1. Что выведет · средне

```vue
<script setup lang="ts">
// GET /api/user/1 → { id: 1, profile: { name: 'Ann' } }
const { data } = await useFetch('/api/user/1')
const { data: deepData } = await useFetch('/api/user/1', { key: 'deep-user', deep: true })
const renameShallow = () => { data.value!.profile.name = 'Bob' }
const renameDeep = () => { deepData.value!.profile.name = 'Bob' }
const replace = () => { data.value = { ...data.value!, profile: { name: 'Eve' } } }
</script>
<template>
  <h1>{{ data?.profile.name }}</h1>
  <p>{{ deepData?.profile.name }}</p>
</template>
```

Пользователь по очереди вызывает `renameShallow`, `renameDeep`, `replace`. Что в `<h1>` и `<p>` после каждого шага?

::: details Решение и разбор
```text
renameShallow → Ann | Ann
renameDeep    → Bob | Bob
replace       → Eve | Bob
```

Проверено в браузере. `data` — `shallowRef`: мутация вложенного поля не вызывает эффектов, на экране `Ann`, хотя в объекте уже `Bob`. `deepData` с `deep: true` — обычный `ref`, мутация вызывает перерисовку компонента. Компонент перерисовывается целиком, читает `data.value.profile.name` заново и показывает изменённый ранее `Bob`. «Чинит» первую ошибку случайный ререндер, поэтому такой баг трудно воспроизвести. Замена `data.value` реактивна всегда.

Чтобы не было разных ключей с одинаковым URL, у второго вызова явный `key`. Без него у вызовов и так разные автоключи (разные строки файла), но при одинаковом ключе `deep` должен совпадать (`NUXT_E3004: mismatching deep option`).
:::

### 2. Найдите баг · легко

Счётчик просмотров увеличивается на 2 за одно открытие страницы, а в консоли браузера — предупреждение о hydration mismatch.

```vue
<script setup lang="ts">
const route = useRoute()
const { status } = await useAsyncData(`view-${route.params.id}`, async () => {
  await $fetch(`/api/articles/${route.params.id}/view`, { method: 'POST' })
})
</script>
<template><span>{{ status }}</span></template>
```

::: details Решение и разбор
`handler` ничего не возвращает. На сервере в payload записывается `undefined`. При гидрации Nuxt видит ключ, но `data === undefined` и считает, что данных нет: перед монтированием запускает `handler` снова. `status` становится `'pending'`, сервер же отрендерил `'success'` — отсюда mismatch и второй POST. Проверено: повторный запрос и `Hydration completed but contains mismatches`; в `nuxi dev` — `NUXT_E3006`.

Минимально — `return null` или вернуть ответ. Но главная ошибка глубже: `useAsyncData` предназначен для чтения, а `handler` должен быть без побочных эффектов. Учёт просмотра — действие, выполняемое один раз:

```ts
await callOnce(`view-${route.params.id}`, () =>
  $fetch(`/api/articles/${route.params.id}/view`, { method: 'POST' }),
)
```

`callOnce` выполнит функцию на сервере и отметит ключ в payload, клиент её не повторит. Ещё проще — считать просмотр в самом GET-обработчике статьи на сервере.
:::

### 3. Найдите баг · средне

Сайт документации пререндерится (`nuxi generate`). Каждая статья в сгенерированном HTML показывает заголовок первой статьи, а в `nuxi dev` всё правильно.

```vue
<!-- app/pages/docs/[slug].vue -->
<script setup lang="ts">
const route = useRoute()
const { data: page } = await useAsyncData(() => $fetch(`/api/docs/${route.params.slug}`))
</script>
<template><h1>{{ page?.title }}</h1></template>
```

::: details Решение и разбор
Ключ не задан, и компилятор подставил автоключ — хэш файла и позиции вызова. Он одинаков для всех slug. При пререндеринге в Nuxt 4 включён `experimental.sharedPrerenderData`: результаты `useAsyncData` кэшируются по ключу между страницами одной сборки, чтобы не запрашивать общие данные (меню, настройки) на каждой странице. Вторая страница получает из кэша данные первой. Проверено: `/slug/b/index.html` содержит `Item a`. В dev кэша пререндера нет, поэтому там всё работает.

```ts
const slug = computed(() => String(route.params.slug))
const { data: page } = await useAsyncData(
  () => `docs-${slug.value}`, // the key identifies the data
  () => $fetch(`/api/docs/${slug.value}`),
)
// or simply: await useFetch(() => `/api/docs/${slug.value}`) — the URL is part of the key
```

Реактивный ключ заодно правит клиентский переход между статьями при переиспользуемой странице. Отключать `sharedPrerenderData` не нужно: ключ, однозначно определяющий данные, — правило и без пререндера, ведь по ключу делится состояние.
:::

### 4. Найдите баг · средне

В шапке и в сайдбаре — счётчик уведомлений. Сайдбар должен показывать «99+», но показывает точное число, а в Network два запроса к `/api/notifications` при каждом SSR.

```ts
// app/components/HeaderBell.vue
const { data } = useAsyncData('notifications', () => $fetch('/api/notifications'))
// app/components/SidebarBadge.vue
const { data } = useAsyncData('notifications', () => $fetch('/api/notifications'), {
  transform: (r) => ({ ...r, label: r.count > 99 ? '99+' : String(r.count) }),
})
```

::: details Решение и разбор
Один ключ — одна запись `nuxtApp._asyncData['notifications']`. Её создал первый вызов (`HeaderBell`) без `transform`, второй получил обёртки над тем же `data`, и его `transform` не применяется. На сервере второй вызов перезапустил запрос: по умолчанию `dedupe: 'cancel'`, отсюда два обращения к API. Проверено на аналогичной паре компонентов: оба показали исходное значение, API вызван дважды, в dev — `[NUXT_E3004] ... different transform option`.

Общий запрос — в один composable, производное — через `computed`:

```ts
// app/composables/useNotifications.ts
export function useNotifications() {
  const result = useAsyncData('notifications', () => $fetch('/api/notifications'))
  const label = computed(() => {
    const count = result.data.value?.count ?? 0
    return count > 99 ? '99+' : String(count)
  })
  return Object.assign(result, { label })
}
```

Если два представления действительно нужны как разные данные, у них должны быть разные ключи. Но тогда и запросов будет два.
:::

### 5. Реализуйте слой данных · сложно

Напишите `createDataLayer({ isServer, payload })` с методом `useAsyncData(key, handler)` — упрощённую модель Nuxt без Vue. Требования: вызовы с одним ключом делят одно состояние `{ data, error, status }`; на сервере результат пишется в `payload[key]`; на клиенте при наличии `payload[key]` запрос не выполняется; `refresh({ dedupe })` поддерживает `'cancel'` (отменить текущий запрос через `AbortController`, победит новый) и `'defer'` (вернуть текущий промис); результат отменённого запроса не должен перезаписать данные.

::: details Решение и разбор
```js
export function createDataLayer({ isServer, payload }) {
  const entries = new Map() // key -> shared state for every caller
  const running = new Map() // key -> in-flight promise

  function execute(entry, { dedupe = 'cancel' } = {}) {
    if (running.has(entry.key) && dedupe === 'defer') return running.get(entry.key)
    entry.controller?.abort() // 'cancel': the newest call wins
    const controller = (entry.controller = new AbortController())
    entry.status = 'pending'
    const promise = Promise.resolve()
      .then(() => entry.handler({ signal: controller.signal }))
      .then(
        (result) => {
          if (running.get(entry.key) !== promise) return // superseded
          Object.assign(entry, { data: result, error: undefined, status: 'success' })
          if (isServer) payload[entry.key] = result
        },
        (error) => {
          if (running.get(entry.key) !== promise) return
          Object.assign(entry, { error, status: 'error' })
        },
      )
      .finally(() => {
        if (running.get(entry.key) === promise) running.delete(entry.key)
      })
    running.set(entry.key, promise)
    return promise
  }

  function useAsyncData(key, handler) {
    let entry = entries.get(key)
    if (!entry) {
      entry = { key, handler, data: undefined, error: undefined, status: 'idle' }
      entries.set(key, entry)
      if (!isServer && payload[key] !== undefined) {
        Object.assign(entry, { data: payload[key], status: 'success' }) // hydration
      } else {
        execute(entry)
      }
    }
    return {
      entry,
      refresh: (opts) => execute(entry, opts),
      ready: () => running.get(key) ?? Promise.resolve(),
    }
  }

  return { useAsyncData }
}
```

Проверено в Node: два вызова на сервере делят запись и делают один запрос; payload после `JSON.parse(JSON.stringify(...))` гидрирует клиента без запроса; два `refresh()` с `'cancel'` оставляют результат второго, а первый отменён; с `'defer'` уходит один запрос; ошибка даёт `status: 'error'`.

Главная деталь — проверка `running.get(key) !== promise`: отменённый или вытесненный запрос может завершиться позже нового, и без неё он перезапишет свежие данные (та же гонка, что в [«Данных и сети»](../architecture/data-and-network.md#гонки-отмена-и-повторы)). `payload[key] !== undefined` объясняет, почему `handler`, вернувший `undefined`, запрашивается повторно. Чего нет по сравнению с Nuxt: refs вместо полей, сериализация `devalue`, `onServerPrefetch`, автоключи, `transform`/`pick`, `getCachedData`, подсчёт подписчиков и очистка. Кроме того, в Nuxt второй вызов с тем же ключом на сервере перезапускает запрос, а здесь переиспользует.

Сложность: O(1) на вызов и `refresh`, память — O(k) по числу ключей.
:::

## Источники

- [Nuxt 4: Data Fetching](https://nuxt.com/docs/4.x/getting-started/data-fetching) — `$fetch` против `useFetch`, `await` и `lazy`, ключи, общий state, заголовки, сериализация
- [Nuxt 4: `useAsyncData`](https://nuxt.com/docs/4.x/api/composables/use-async-data) — опции и версии (`timeout` 4.2, `enabled` 4.5, `serialize` и `middleware` 4.6), `getCachedData`
- [Nuxt 4: `useFetch`](https://nuxt.com/docs/4.x/api/composables/use-fetch), [`$fetch`](https://nuxt.com/docs/4.x/api/utils/dollarfetch), [`useRequestFetch`](https://nuxt.com/docs/4.x/api/composables/use-request-fetch), [`useRequestHeaders`](https://nuxt.com/docs/4.x/api/composables/use-request-headers)
- [Nuxt 4: `refreshNuxtData`](https://nuxt.com/docs/4.x/api/utils/refresh-nuxt-data), [`clearNuxtData`](https://nuxt.com/docs/4.x/api/utils/clear-nuxt-data), [`callOnce`](https://nuxt.com/docs/4.x/api/utils/call-once), [`createUseFetch`](https://nuxt.com/docs/4.x/api/composables/create-use-fetch)
- [Nuxt 4: `useNuxtApp` — payload](https://nuxt.com/docs/4.x/api/composables/use-nuxt-app#payload)
- [Nuxt 4: Upgrade Guide](https://nuxt.com/docs/4.x/getting-started/upgrade) — Singleton Data Fetching Layer, shallow `data`, `undefined` по умолчанию, Shared Prerender Data
- [Nuxt 4: Experimental features](https://nuxt.com/docs/4.x/guide/going-further/experimental-features) — `granularCachedData`, `purgeCachedData`, `pendingWhenIdle`, `sharedPrerenderData`, `routeTypedFetch`
- [Nuxt 3: Data Fetching](https://nuxt.com/docs/3.x/getting-started/data-fetching)
- [nuxt/nuxt v4.6.4: `app/composables/asyncData.ts`](https://github.com/nuxt/nuxt/blob/v4.6.4/packages/nuxt/src/app/composables/asyncData.ts) — запись по ключу, гидрация из payload, `dedupe`, очистка
- [nuxt/nuxt v4.6.4: `app/composables/fetch.ts`](https://github.com/nuxt/nuxt/blob/v4.6.4/packages/nuxt/src/app/composables/fetch.ts) — ключ `useFetch`, `useRequestFetch` для относительных URL
- [Релизы Nuxt 4.2](https://github.com/nuxt/nuxt/releases/tag/v4.2.0), [4.4](https://github.com/nuxt/nuxt/releases/tag/v4.4.0), [4.5](https://github.com/nuxt/nuxt/releases/tag/v4.5.0), [4.6](https://github.com/nuxt/nuxt/releases/tag/v4.6.0)
- [unjs/ofetch](https://github.com/unjs/ofetch), [sveltejs/devalue](https://github.com/sveltejs/devalue)
- [Находки «Nuxt 3 → Nuxt 4: отличия, важные для интервью»](https://github.com/alexrehtide/learning/blob/research/nuxt-3-vs-4/research/nuxt-3-vs-4.md)
