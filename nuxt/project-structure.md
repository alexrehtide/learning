---
title: Структура проекта и auto-imports
level: ядро
---

# Структура проекта и auto-imports

> **Коротко.** Nuxt — это Vue-приложение плюс соглашения: по каталогам он генерирует маршруты, плагины, middleware и реестр auto-imports, по умолчанию рендерит страницу на сервере и гидрирует её на клиенте, а серверную часть собирает Nitro. В Nuxt 4 код приложения лежит в `app/` (это `srcDir`), серверный — в `server/`, общий — в `shared/`, и у каждой части свой TS-проект. Auto-imports — не глобальные переменные: при сборке плагин на базе unimport дописывает в модуль `import` только для тех имён, которые в нём использованы, поэтому tree shaking работает. Цена — неявные зависимости: линтер их не видит, а ошибка контекста (composable приложения в `server/`) проявится только в `typecheck` или в рантайме.

**Связанные темы:** [Состояние и конфигурация: `useState` vs Pinia, `runtimeConfig`](./state-and-config.md), [Middleware и плагины](./middleware-and-plugins.md), [Composables](../vue/composables.md), [Компоненты и шаблоны](../vue/components-and-templates.md), [Встроенные компоненты](../vue/built-in-components.md), [SSR и гидрация](../vue/ssr-and-hydration.md), [Модули: ESM и CommonJS](../javascript/modules.md), [Оптимизация загрузки](../performance/loading.md), [TypeScript во Vue](../vue/typescript.md), [Структура большого проекта и Feature-Sliced Design](../architecture/large-project-structure.md), [Масштабирование фронтенда: монорепозитории, микрофронтенды, Nuxt Layers](../architecture/scaling-frontend.md), [Pinia: плагины, SSR и тестирование](../state-management/pinia-advanced.md), [Маршрутизация: файловые, динамические и вложенные маршруты, layouts](./routing.md), [Работа с данными: `$fetch`, `useFetch`, `useAsyncData`](./data-fetching.md)

## Теория

Все фрагменты проверены на Nuxt 4.6.4 (последний релиз на 2026-11-21) с Nitro 2.13.6 и Vue 3.5.45 в Node 26.13.1: `nuxi dev`, `nuxi build` + `node .output/server/index.mjs`, типы — `nuxi typecheck` на TypeScript 6.0. Устройство описано по `node_modules/nuxt/dist`, `@nuxt/schema`, `@nuxt/kit` и `unimport`.

### Что Nuxt добавляет поверх Vue

Чистое Vue-приложение собирают из библиотек: роутер, SSR, сборщик, сервер. Nuxt берёт эти решения на себя:

- **Соглашения вместо конфигурации.** Каталог определяет роль файла: `pages/` — маршруты Vue Router ([«Маршрутизация»](./routing.md)), `layouts/` — обёртки страниц, `plugins/` и `middleware/` регистрируются сами ([«Middleware и плагины»](./middleware-and-plugins.md)), `components/`, `composables/` и `utils/` попадают в auto-imports.
- **Универсальный рендеринг** по умолчанию: первый запрос рендерится на сервере (механика — в теме [«SSR и гидрация»](../vue/ssr-and-hydration.md)), дальше приложение работает как SPA.
- **Nitro** — серверный движок: API-маршруты из `server/`, SSR-рендерер и сборка под платформу деплоя в `.output/`.
- **Модули** — расширения сборки. Модуль вызывается при старте Nuxt и может добавить компоненты, auto-imports, плагины, серверные маршруты, поменять конфиг Vite или Nitro.

### Структура Nuxt 4

```text
my-app/
  app/                  # srcDir, alias ~ and @
    assets/ components/ composables/ layouts/ middleware/
    pages/ plugins/ utils/
    app.vue  error.vue  app.config.ts
  server/               # Nitro: api/, routes/, middleware/, plugins/, utils/
  shared/               # code for both app and server: utils/, types/ are auto-imported
  public/               # served as is from /
  layers/               # local layers, connected without extends
  modules/              # local modules, registered without config
  nuxt.config.ts
```

`srcDir` вычисляется в `@nuxt/schema`: если каталога `app/` нет, или он пуст, а в корне лежит `app.vue` либо `pages/`, `srcDir` равен корню проекта. Поэтому проект с раскладкой Nuxt 3 продолжает работать на Nuxt 4 без переноса файлов (проверено: `components/Foo.vue` в корне подхватился, `~` указал на корень). Явно вернуть старую раскладку — `srcDir: '.'` и `dir: { app: 'app' }`.

Зачем делить. Vue-приложение, Nitro-сервер и Node-процесс сборки — три разные среды выполнения. В `app/` есть `window` и composables Nuxt, в `server/` — `event` и h3, в `nuxt.config.ts` — Node. Отдельные каталоги дают отдельные проверки типов, а watcher следит за меньшим деревом: документация называет это причиной ускорения на Windows и Linux.

- **`app.config.ts`** — публичная конфигурация приложения (тема, флаги UI). Она попадает в сборку, реактивна в рантайме и меняется без перезапуска dev-сервера. Секреты и значения из переменных окружения сюда не кладут, для них — `runtimeConfig`.
- **`nuxt.config.ts`** выполняется в Node при сборке. Функции и импорты из него в браузер не попадают, наружу уходит только `runtimeConfig` и то, что модули передали явно.

> [!NOTE]
> В Nuxt 3 было иначе: `srcDir` по умолчанию — корень проекта, `~` указывал на корень, а `components/`, `pages/` и `app.vue` лежали рядом с `server/` и `nuxt.config.ts`. Перенос автоматизирует `npx codemod@latest nuxt/4/file-structure`.

### Четыре TS-проекта и что лежит в `.nuxt/`

`nuxi prepare` (его вызывают `dev`, `build` и `postinstall`) пишет в `.nuxt/` четыре конфига, а корневой `tsconfig.json` только ссылается на них через `references`:

| Конфиг | Что проверяет | Чего не видит |
| --- | --- | --- |
| `tsconfig.app.json` | `app/**`, `.d.ts` из `shared/`, runtime модулей | `server/**`, `nuxt.config.ts` (в `exclude`) |
| `tsconfig.server.json` | `server/**`, `.d.ts` из `shared/` | `app/**` |
| `tsconfig.shared.json` | `shared/**` | ни приложения, ни сервера |
| `tsconfig.node.json` | `nuxt.config.ts`, `modules/*` | runtime-код |

Кроме конфигов на диске лежат типы: `.nuxt/types/imports.d.ts` (auto-imports приложения как `declare global { const useCounter: typeof import(...) }`), `.nuxt/types/nitro-imports.d.ts` (то же для сервера), `components.d.ts` (компоненты для `GlobalComponents`), `schema/` (типы опций модулей), `app.config.mjs`. Остальные шаблоны — список плагинов, маршруты, роутер — Nuxt держит в виртуальной файловой системе в памяти. Шаблон модуля из `addTemplate` без `write: true` на диск не пишется (проверено).

Проверка типов — `nuxi typecheck`, он запускает `vue-tsc -b` по ссылкам. Composable приложения в серверном маршруте даёт `server/api/bad.ts: error TS2304: Cannot find name 'formatPrice'`, хотя `nuxi build` проходит молча (задача 2). В TS-проекте Nuxt 4 по умолчанию включён `noUncheckedIndexedAccess: true`.

> [!WARNING]
> `nuxi build` при существующем `.nuxt/` собирает во временный `node_modules/.cache/nuxt/.nuxt`, чтобы не сломать запущенный рядом dev-сервер (это есть в `@nuxt/kit` `loadNuxtConfig`). Не ищите артефакты продакшен-сборки в `.nuxt/dist`.

Результат `nuxi build` — каталог `.output/`, самодостаточный для деплоя: `public/_nuxt/` с клиентскими чанками, `server/index.mjs` (точка входа Nitro), `server/chunks/` (рендерер, маршруты, приложение), `server/node_modules/` с трассированными зависимостями и `nitro.json`. `node_modules` проекта на сервере не нужен. Подробно про Nitro и пресеты деплоя — отдельная тема раздела.

### Auto-imports: что подхватывается

| Источник | Что попадает | Где доступно |
| --- | --- | --- |
| `app/components/` (рекурсивно) | компоненты, имя по пути | шаблоны приложения |
| `app/composables/`, `app/utils/` (только верхний уровень) | именованные экспорты; `default` — под именем файла в camelCase | приложение |
| `shared/utils/`, `shared/types/` | экспорты верхнего уровня | приложение и сервер |
| `server/utils/` | экспорты | только сервер |
| пресеты | API Vue (`ref`, `computed`…), Nuxt (`useFetch`, `navigateTo`…), h3 на сервере, модули (Pinia: `defineStore`, `storeToRefs`) | по среде |

Правила, которые спрашивают:

- **Вложенные каталоги `composables/` и `utils/` не сканируются.** `app/composables/nested/useDeep.ts` и даже `app/composables/feature/index.ts` в реестр не попадают: unimport ищет по маске `*.{ts,js,…}` только на верхнем уровне. Решения — реэкспорт из `app/composables/index.ts` или `imports: { dirs: ['composables/**'] }`.
- **Компоненты сканируются рекурсивно, имя складывается из пути.** `components/base/ui/Button.vue` → `<BaseUiButton>`. Повтор сегментов схлопывается: `components/base/form/BaseFormInput.vue` → `<BaseFormInput>`, а не `BaseFormBaseFormInput`. С `pathPrefix: false` имя берётся только из файла.
- **Конфликт имён не ошибка.** Два файла экспортируют `formatPrice` — в лог пишется `WARN Duplicated imports "formatPrice", the one from ".../money.ts" has been ignored`, и один экспорт молча проигрывает.
- **Префикс `Lazy`.** `<LazyHeavyChart>` превращается в `defineAsyncComponent(() => import('.../HeavyChart.vue'))`: отдельный чанк, который на странице только предзагружается (`<link rel="prefetch">`) и скачивается, когда компонент действительно рендерится. Механику асинхронного компонента см. в теме [«Встроенные компоненты»](../vue/built-in-components.md#defineasynccomponent).
- **Суффикс `.client`.** `Clock.client.vue` регистрируется как `<Clock>` и оборачивается в `createClientOnly`. Сервер рендерит на его месте `ServerPlaceholder` (пустой `<div></div>`), клиент монтирует компонент после гидрации. Это готовая версия `ClientOnly` из темы [«SSR и гидрация»](../vue/ssr-and-hydration.md).
- **Суффикс `.server`.** Компонент рендерится только на сервере как island (нужен `experimental.componentIslands`). Если рядом есть `.client` с тем же именем, сервер берёт `.server`, клиент — `.client`.

### Auto-imports: как это работает

Механизма три, и все работают при сборке, а не в рантайме.

1. **Сканирование.** Модуль `nuxt:imports` собирает каталоги, на хуке `modules:done` создаёт контекст `createUnimport` с пресетами и вызывает `scanDirExports`. Модули Nuxt дополняют реестр через `addImports` и хуки `imports:sources`, `imports:dirs`, `imports:extend`.
2. **Трансформация скриптов.** Vite-плагин `nuxt:imports-transform` (`enforce: 'post'`) получает каждый JS-модуль и script-блок SFC, парсит его (парсер oxc) и для каждого **свободного** идентификатора из реестра дописывает `import` в начало файла. Свободный — значит не объявленный в модуле: своя `const ref` перекрывает авто-импорт. Аддон `vueTemplate` делает то же для имён в шаблоне (`formatPrice(x)` в <code v-pre>{{ }}</code>).
3. **Компоненты.** Шаблон компилируется в `resolveComponent("BaseUiButton")`. Плагин `nuxt:components-loader` регулярным выражением находит такие вызовы с **литеральной** строкой и заменяет их прямым импортом: `import { default as __nuxt_component_0 } from '/components/base/ui/Button.vue'`. Для `Lazy` — `__defineAsyncComponent(...)`, для `.client` — `createClientOnly(...)`.

Вот что dev-сервер отдаёт браузеру вместо `app.vue` (пути сокращены):

```js
import { useCounter } from '/_nuxt/composables/useCounter.ts'
import { formatPrice } from '/_nuxt/utils/format.ts'
import { slugify } from '/_nuxt/@fs/.../shared/utils/slug.ts'
import { ref } from '/_nuxt/@fs/.../vue.runtime.esm-bundler.js'
// ...
import { default as __nuxt_component_0 } from '/_nuxt/components/base/ui/Button.vue'
const __nuxt_component_1_client_wrapped = createClientOnly(__nuxt_component_1_client)
const __nuxt_component_2_lazy = __defineAsyncComponent(() => import('/_nuxt/components/HeavyChart.vue').then(c => c.default || c))
```

Следствия:

- **Tree shaking работает.** Импортируются только использованные имена, дальше это обычные ESM-импорты (как они анализируются — в теме [«Модули»](../javascript/modules.md)). Функция `unusedHelper` из `app/utils/format.ts` в `.output` не попала ни в клиентский, ни в серверный бандл (проверено поиском по строке).
- **Типы — отдельный артефакт.** Редактор узнаёт о `useCounter` из сгенерированного `.d.ts`, а не из кода. Пока `nuxi prepare` не отработал (свежий клон без `postinstall`), IDE показывает ошибки на каждом авто-импорте.
- **Динамическое имя не работает.** `<component :is="'HeavyChart'">` компилируется в `resolveDynamicComponent(name)`: литерала нет, плагин его не заменил, и в HTML уходит неизвестный тег `<HeavyChart></HeavyChart>` (задача 3).
- **`#imports` и `#components`** — виртуальные модули с теми же реестрами. Через них импортируют явно: `import { ref, useFetch } from '#imports'`, `import { HeavyChart } from '#components'`. Это работает и при выключенных auto-imports.

### Цена неявности и как её выключить

Auto-import прячет зависимость: в файле нет `import`, поэтому линтер границ модулей, поиск использований и code review её не видят. Зависимость возникает по имени: переименовали файл в `composables/` — и тот же идентификатор незаметно разрешился в одноимённый экспорт из другого каталога. Сервер и клиент разделены только сгенерированными типами: сборка не падает, если серверный код зовёт composable приложения.

Рычаги:

- `imports: { autoImport: false }` — выключает **все** авто-импорты функций: и свои, и `ref`, и `useFetch`, и в `server/` тоже. `#imports` продолжает работать (проверено: после явного `import { ref } from '#imports'` typecheck проходит).
- `imports: { scan: false }` — не сканировать `composables/` и `utils/`, API Vue и Nuxt оставить.
- `components: { dirs: [] }` — не регистрировать свои компоненты; компоненты Nuxt (`<NuxtLink>`, `<ClientOnly>`) остаются.

Как это применяют для проверяемых границ в большом проекте — в теме [«Структура большого проекта и Feature-Sliced Design»](../architecture/large-project-structure.md). Переопределение файлов через Nuxt Layers работает именно через сканирование — см. [«Масштабирование фронтенда»](../architecture/scaling-frontend.md#nuxt-layers).

### Модули Nuxt

Модуль — функция, которую Nuxt вызывает при старте, до сборки. Локальные модули из `modules/*.ts` и `modules/*/index.ts` подключаются без записи в `modules` конфига.

```ts
// modules/greeting/index.ts
import { defineNuxtModule, createResolver, addImports, addTemplate } from 'nuxt/kit'

export default defineNuxtModule<{ text: string }>({
  meta: { name: 'greeting', configKey: 'greeting' }, // options from nuxt.config `greeting: {}`
  defaults: { text: 'Hi' },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    addImports({ name: 'useGreeting', from: resolve('./runtime/useGreeting') })
    addTemplate({ filename: 'greeting.mjs', getContents: () => `export default ${JSON.stringify(options.text)}` })
    nuxt.hook('components:dirs', (dirs) => { /* add or remove scanned dirs */ })
  },
})
```

- `setup` выполняется в Node при сборке, в браузер не попадает. Код для рантайма лежит рядом (`runtime/`) и подключается через `addImports`, `addPlugin`, `addComponent`, `addServerHandler`.
- `configKey` связывает модуль с ключом конфига, `defaults` сливаются с ним, а тип опций уходит в `.nuxt/types/modules.d.ts`.
- Хуки сборки (`modules:done`, `components:dirs`, `imports:extend`, `pages:extend`, `nitro:config`, `vite:extendConfig`) — то, через что работают и встроенные части Nuxt: auto-imports, компоненты и страницы сами устроены как внутренние модули.

### Поддержка версий и миграция

- **Nuxt 3 снят с поддержки 31 июля 2026**: ни исправлений, ни security-патчей. Последний релиз ветки — `v3.21.11` с пометкой «Nuxt v3 is now end-of-life». Проект на Nuxt 3 в 2026 году — технический долг с риском безопасности.
- **Nuxt 4** — релиз ради стабильности: почти все изменения существовали в Nuxt 3 за флагом `future.compatibilityVersion: 4`. Поменялись дефолты, а не движок. Путь миграции: включить флаг на последнем Nuxt 3, прогнать кодмоды (`npx codemod@latest nuxt/4/migration-recipe` или по одному: `file-structure`, `default-data-error-value`, `shallow-function-reactivity`), исправить тесты, затем поднять мажор. Отдельные изменения откатываются флагами `experimental.*` — это способ мигрировать по частям.
- **Nuxt 5** (на 2026-11-21 не вышел, план — Q4 2026) переходит на Nitro v3 и h3 v2. Включить его поведение заранее можно флагом `future.compatibilityVersion: 5`.

> [!WARNING]
> Nuxt 5 (не выпущен, сверено 2026-11-21 по upgrade guide и `compatibilityVersion: 5` на 4.6.4): Nitro auto-imports выключены. `defineEventHandler` в `server/` перестаёт резолвиться (`TS2304`), helpers импортируют из `nuxt/server`; вернуть старое — `experimental.nitroAutoImports: true`. Экспорты `shared/utils/` на сервере остаются авто-импортом (проверено).

## Примеры

### Проверить, во что развернулся auto-import

```sh
npx nuxi prepare
grep useCounter .nuxt/imports.d.ts
# export { useCounter } from '../app/composables/useCounter';
npx nuxi dev
curl 'localhost:3000/_nuxt/app.vue?vue&type=script&setup=true&lang.ts' | head
# import { useCounter } from "/_nuxt/composables/useCounter.ts"; ...
```

### Вложенные composables через реэкспорт

```ts
// app/composables/index.ts — the only scanned entry for nested folders
export { useDeep } from './nested/useDeep'
export { useCart, useCartTotal } from './cart'
```

### Явные импорты при выключенных auto-imports

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  imports: { scan: false },      // own composables/utils: explicit imports only
  components: { dirs: [] },      // own components: explicit imports only
})
```

```vue
<script setup lang="ts">
import { useCart } from '~/features/cart'
import CartLine from '~/features/cart/ui/CartLine.vue'
const { items } = useCart() // ref, computed, useFetch are still auto-imported
</script>
```

### Код, общий для приложения и сервера

```ts
// shared/utils/slug.ts — auto-imported in app/ and server/
export const slugify = (s: string) => s.toLowerCase().trim().replace(/\s+/g, '-')

// server/api/hello.ts
import { defineEventHandler } from 'nuxt/server' // ready for Nuxt 5
export default defineEventHandler(() => ({ slug: slugify('From Server') }))
```

В `shared/` нельзя импортировать ни Vue, ни Nitro: этот код должен выполняться в обеих средах.

## Вопросы с интервью

::: details Что Nuxt добавляет поверх Vue и Vite
Соглашения по каталогам, из которых генерируются маршруты Vue Router, layouts, плагины, middleware и реестр auto-imports. Универсальный рендеринг по умолчанию: сервер отдаёт HTML, клиент гидрирует, дальше работает как SPA; плюс payload, чтобы данные не загружались второй раз. Nitro — серверный движок с API-маршрутами и сборкой под платформу деплоя. Система модулей, которые расширяют сборку через хуки. Цена — меньше контроля и больше магии: нужно понимать, что Nuxt сгенерировал, иначе отладка превращается в угадывание.
:::

::: details Как работают auto-imports и почему они не раздувают бандл
Это не глобальные переменные, а трансформация при сборке. При старте unimport сканирует `composables/`, `utils/`, `shared/utils/` и пресеты (Vue, Nuxt, модули) и строит реестр имён. Vite-плагин `nuxt:imports-transform` разбирает каждый модуль, находит свободные идентификаторы из реестра и дописывает для них `import`. Для компонентов плагин `nuxt:components-loader` заменяет `resolveComponent('Name')` в скомпилированном шаблоне прямым импортом. В итоге получается обычный ESM, и неиспользованные экспорты удаляет tree shaking. Типы — отдельный артефакт: `.nuxt/types/imports.d.ts` объявляет глобальные `const` с `typeof import(...)`, поэтому без `nuxi prepare` редактор их не знает.
:::

::: details Почему в Nuxt 4 код приложения переехал в app
Три среды — Vue-приложение, Nitro-сервер и Node при сборке — раньше лежали в одном дереве. Отдельный `app/` (он же `srcDir`) позволяет держать четыре TS-проекта: приложение не видит серверных типов и наоборот, а `shared/` явно помечает код для обеих сторон. Watcher следит за меньшим деревом, что ускоряет dev на Windows и Linux. Старая раскладка работает: если `app/` нет, `srcDir` остаётся корнем. Перенос делает кодмод `nuxt/4/file-structure`.
:::

::: details Какие минусы у auto-imports и что бы вы сделали в большом проекте
Зависимость не видна: линтер границ, поиск использований и ревью не видят, кто что использует. Имена глобальны: два одинаковых экспорта дают только warning, и один молча проигрывает. Контекст не проверяется сборкой: composable приложения в `server/` собирается и падает `ReferenceError` в рантайме, ловит только `typecheck`. Вложенные каталоги не сканируются, что удивляет при росте. В большом проекте я бы оставил авто-импорт API Vue и Nuxt, а для своего кода выключил сканирование (`imports.scan: false`, `components.dirs: []`) и импортировал явно через публичный API модулей. Плюс `nuxi typecheck` в CI.
:::

::: details Зачем нужны префикс Lazy и суффикс client у компонентов
`Lazy` — ленивая загрузка кода: компонент становится `defineAsyncComponent` с динамическим `import()`, попадает в отдельный чанк и скачивается, только когда реально рендерится (например, под `v-if` модального окна). На странице чанк лишь предзагружается через `prefetch`. `.client` — компонент только для клиента: сервер рендерит пустой плейсхолдер, а клиент монтирует компонент после гидрации, поэтому mismatch нет. Это для кода с `window`, `localStorage`, текущим временем. `.server` — наоборот, island-компонент, который рендерится только на сервере.
:::

::: details Что лежит в каталогах .nuxt и .output и что из них коммитят
Ни то ни другое не коммитят. `.nuxt/` — сгенерированное для разработки: четыре tsconfig, `.d.ts` для auto-imports, компонентов, маршрутов и опций модулей, `app.config.mjs`. Большая часть шаблонов (плагины, маршруты) живёт в виртуальной ФС и на диск не пишется. `.output/` — результат `nuxi build`, самодостаточный артефакт деплоя: `public/` со статикой и клиентскими чанками, `server/index.mjs` и чанки Nitro, трассированные `node_modules`. Запуск — `node .output/server/index.mjs`, `node_modules` проекта не нужен.
:::

::: details Как бы вы мигрировали проект с Nuxt 3 на Nuxt 4 и почему это срочно
Срочно, потому что Nuxt 3 с 31 июля 2026 не получает security-патчей. План: обновиться до последнего 3.x, включить `future.compatibilityVersion: 4`, прогнать кодмоды (структура `app/`, `undefined` вместо `null` в `data`/`error`, `shallowRef` для `data`), прогнать тесты и `typecheck`, точечно откатить проблемные изменения флагами `experimental.*`, затем поднять мажор и по одному убрать откаты. Отдельно смотрю модули: каждый должен поддерживать Nuxt 4. И сразу проверяю `compatibilityVersion: 5` — Nitro v3 сломает серверный код с h3-импортами и авто-импортами.
:::

## Задачи

### 1. Почему composable не найден · легко

Проект на Nuxt 4. Сборка проходит, но страница отвечает 500 с `ReferenceError: useDeep is not defined`. Почему и как исправить двумя способами?

```text
app/
  app.vue                      # const v = useDeep()
  composables/
    useCounter.ts              # works
    nested/useDeep.ts          # export const useDeep = () => 'deep'
```

::: details Решение и разбор
Auto-imports сканируют только верхний уровень `app/composables/` (маска `*.{ts,js,…}`), подкаталоги — нет, даже `feature/index.ts`. `useDeep` нет в реестре, плагин не дописал `import`, и идентификатор остался свободным. `nuxi typecheck` это ловит (`TS2304: Cannot find name 'useDeep'`), `nuxi build` — нет.

Исправления:

```ts
// 1. Re-export (recommended): explicit list of the public API
// app/composables/index.ts
export { useDeep } from './nested/useDeep'
```

```ts
// 2. Scan nested folders
export default defineNuxtConfig({ imports: { dirs: ['composables/**'] } })
```

Первый способ лучше: в реестр попадает только то, что вы решили сделать публичным. Проверено: после реэкспорта `.nuxt/imports.d.ts` содержит `export { useDeep } from '../app/composables/index'`.
:::

### 2. Найдите баг · средне

`nuxi build` проходит, `GET /api/price` отвечает 500. Найдите причину и исправьте.

```ts
// app/utils/format.ts
export const formatPrice = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

// server/api/price.ts
export default defineEventHandler(() => ({ price: formatPrice(1234.5) }))
```

::: details Решение и разбор
`app/utils/` — авто-импорт **приложения**. Nitro собирает сервер со своим реестром: `server/utils/`, `shared/utils/` и h3. `formatPrice` на сервере не импортирован, и в рантайме: `ReferenceError: formatPrice is not defined` (проверено на `node .output/server/index.mjs`). Сборка молчит, потому что свободный идентификатор в JS — не ошибка компиляции, а ловит его только отдельный TS-проект сервера: `nuxi typecheck` → `server/api/price.ts: error TS2304`.

Исправление — перенести функцию туда, где она нужна обеим сторонам:

```ts
// shared/utils/format.ts — auto-imported in app/ and server/
export const formatPrice = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
```

В `shared/` нельзя использовать ни API Vue, ни h3. Вывод для процесса: `nuxi typecheck` в CI обязателен, иначе разделение на TS-проекты ничего не даёт.
:::

### 3. Что отрендерит сервер · средне

`app/components/HeavyChart.vue` рендерит `<div class="chart">heavy chart</div>`. Что окажется в трёх `section` после SSR?

```vue
<script setup lang="ts">
import { HeavyChart } from '#components'
const name = ref('HeavyChart')
const byResolve = resolveComponent('HeavyChart')
</script>

<template>
  <section id="a"><component :is="name" /></section>
  <section id="b"><component :is="HeavyChart" /></section>
  <section id="c"><component :is="byResolve" /></section>
</template>
```

::: details Решение и разбор
```html
<section id="a"><HeavyChart></HeavyChart></section>
<section id="b"><div class="chart">heavy chart</div></section>
<section id="c"><div class="chart">heavy chart</div></section>
```

- `a`: строка в `:is` компилируется в `resolveDynamicComponent(name)`. Компоненты Nuxt не регистрируются глобально, а плагин `nuxt:components-loader` заменяет только вызовы `resolveComponent` с литералом. Vue не нашёл компонент и отрендерил неизвестный элемент — в dev с предупреждением `Failed to resolve component`.
- `b`: явный импорт из `#components` — обычная ссылка на объект компонента.
- `c`: `resolveComponent('HeavyChart')` с литералом в `<script setup>` плагин тоже переписал в прямой импорт.

Для выбора компонента по данным держат карту `{ chart: HeavyChart, table: DataTable }` из явных импортов. Глобальная регистрация (`components: { global: true }` или суффикс `.global.vue`) тоже работает, но такой компонент попадает в общий бандл.
:::

### 4. Модуль, который добавляет auto-import · сложно

Напишите локальный модуль `featureFlags`: опции `{ flags: Record<string, boolean> }` из `nuxt.config`, composable `useFlag(name)` доступен без импорта в приложении и возвращает значение флага. Флаги должны попасть в сборку как данные, без чтения `nuxt.config` в рантайме.

::: details Решение и разбор
```ts
// modules/feature-flags/index.ts
import { defineNuxtModule, createResolver, addImports, addTemplate } from 'nuxt/kit'

export default defineNuxtModule<{ flags: Record<string, boolean> }>({
  meta: { name: 'feature-flags', configKey: 'featureFlags' },
  defaults: { flags: {} },
  setup(options) {
    const { resolve } = createResolver(import.meta.url)
    addTemplate({
      filename: 'feature-flags.mjs',
      getContents: () => `export default ${JSON.stringify(options.flags)}`,
    })
    addImports({ name: 'useFlag', from: resolve('./runtime/useFlag') })
  },
})
```

```ts
// modules/feature-flags/runtime/useFlag.ts
import flags from '#build/feature-flags.mjs'
export const useFlag = (name: string): boolean => flags[name] ?? false
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({ featureFlags: { flags: { newCheckout: true } } })
```

Разбор:

- `setup` работает в Node при сборке, поэтому данные передаются в рантайм через шаблон: `addTemplate` кладёт модуль в виртуальную ФС под `#build/feature-flags.mjs`, и Vite встраивает его в бандл.
- `addImports` добавляет `useFlag` в тот же реестр unimport, что и `composables/`, и в `.nuxt/types/imports.d.ts`.
- Локальный модуль из `modules/` подключается автоматически; тип опций `featureFlags` появляется в `nuxt.config` после `nuxi prepare`.
- Флаги вшиты в сборку. Чтобы менять их без пересборки — переменной окружения, — нужен `runtimeConfig.public`, а не шаблон.
:::

## Источники

- [Nuxt 4: Directory Structure](https://nuxt.com/docs/4.x/directory-structure) — `app/`, `server/`, `shared/`, `layers/`, `modules/`
- [Nuxt 4: Auto-imports](https://nuxt.com/docs/4.x/guide/concepts/auto-imports) — `#imports`, `imports.autoImport`, `imports.scan`
- [Nuxt 4: `app/components`](https://nuxt.com/docs/4.x/directory-structure/app/components) — имена по пути, `Lazy`, `.client`/`.server`, `#components`, динамические компоненты
- [Nuxt 4: `app/composables`](https://nuxt.com/docs/4.x/directory-structure/app/composables) — «How Files Are Scanned», вложенные каталоги
- [Nuxt 4: `shared`](https://nuxt.com/docs/4.x/directory-structure/shared), [`.nuxt`](https://nuxt.com/docs/4.x/directory-structure/nuxt), [`.output`](https://nuxt.com/docs/4.x/directory-structure/output), [`app.config.ts`](https://nuxt.com/docs/4.x/directory-structure/app/app-config)
- [Nuxt 4: TypeScript](https://nuxt.com/docs/4.x/guide/concepts/typescript) — project references, `nuxi typecheck`
- [Nuxt 4: Modules — Module Anatomy](https://nuxt.com/docs/4.x/guide/modules/module-anatomy) и [Kit: Auto-imports](https://nuxt.com/docs/4.x/api/kit/autoimports)
- [Nuxt 4: Lifecycle Hooks](https://nuxt.com/docs/4.x/api/advanced/hooks)
- [Nuxt 4: Upgrade Guide](https://nuxt.com/docs/4.x/getting-started/upgrade) — Nuxt 3 → 4, кодмоды, `compatibilityVersion: 5`, переход на `nuxt/server`
- [Nuxt Roadmap](https://nuxt.com/docs/4.x/community/roadmap) — EOL Nuxt 3, план Nuxt 5
- [Nuxt 3: `components`](https://nuxt.com/docs/3.x/guide/directory-structure/components) — раскладка без `app/`
- [nuxt/nuxt v3.21.11](https://github.com/nuxt/nuxt/releases/tag/v3.21.11) — последний релиз Nuxt 3
- [nuxt/nuxt v4.6.4: `imports/module.ts`](https://github.com/nuxt/nuxt/blob/v4.6.4/packages/nuxt/src/imports/module.ts) и [`imports/transform.ts`](https://github.com/nuxt/nuxt/blob/v4.6.4/packages/nuxt/src/imports/transform.ts) — сканирование и трансформация
- [nuxt/nuxt v4.6.4: `components/plugins/loader.ts`](https://github.com/nuxt/nuxt/blob/v4.6.4/packages/nuxt/src/components/plugins/loader.ts) и [`components/scan.ts`](https://github.com/nuxt/nuxt/blob/v4.6.4/packages/nuxt/src/components/scan.ts) — замена `resolveComponent`, имена по пути
- [nuxt/nuxt v4.6.4: `schema/src/config/common.ts`](https://github.com/nuxt/nuxt/blob/v4.6.4/packages/schema/src/config/common.ts) — вычисление `srcDir`; [`kit/src/loader/config.ts`](https://github.com/nuxt/nuxt/blob/v4.6.4/packages/kit/src/loader/config.ts) — `buildDir` продакшен-сборки
- [unjs/unimport](https://github.com/unjs/unimport) — движок auto-imports
- [Блог Nuxt: Announcing Nuxt 4.0](https://nuxt.com/blog/v4)
