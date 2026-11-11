# Nuxt 3 → Nuxt 4: отличия, важные для интервью

> Research-тикет [#5](https://github.com/alexrehtide/learning/issues/5) карты [#1](https://github.com/alexrehtide/learning/issues/1).
> Дата сверки: 2026-11-11. Только первоисточники: nuxt.com (docs 4.x/3.x, блог), GitHub-релизы `nuxt/nuxt`.

## TL;DR

- **Nuxt 3 снят с поддержки 31 июля 2026** (статус «Unsupported»: ни багфиксов, ни security-патчей). Последний релиз ветки — `v3.21.11` от 2026-08-05 с пометкой «Nuxt v3 is now end-of-life». [R1][R2]
- **Актуальная версия — Nuxt 4** (`latest` на npm, первый релиз 2025-07-16; на дату сверки — `v4.6.4` от 2026-11-02). Поддерживается минимум 6 месяцев после выхода Nuxt 5. [R1][R3]
- **Nuxt 5** запланирован на Q4 2026 (оценка), главное — Nitro v3 / h3 v2 и Vite Environment API. Часть его поведения уже включается в Nuxt 4.2+ через `future.compatibilityVersion: 5`. [R1][R4][R5]
- Nuxt 4 — «stability-focused release»: почти все изменения существовали в Nuxt 3 под флагом `future.compatibilityVersion: 4`; новый «Nuxt-движок» не появился, поменялись **дефолты**. [R1][R3]

> **Вывод для карты.** Решение «основа — Nuxt 3, врезки про Nuxt 4» опирается на версию, которая уже не поддерживается. Ментальная модель (SSR + гидрация, payload, `useFetch`/`useAsyncData`, file-based routing, route middleware, Nitro, route rules) общая для 3 и 4, но в интервью конца 2026 логичнее отвечать «в терминах Nuxt 4» (структура `app/`, `undefined`-дефолты, `shallowRef`, общий стейт по ключу), а Nuxt 3 упоминать как «как было раньше». См. раздел «Вопросы для карты».

## 1. Версии и статус поддержки

| Версия | Статус (по roadmap) | Первый релиз | EOL |
|---|---|---|---|
| 5.x | Scheduled | Q4 2026 (оценка) | TBA |
| 4.x | Stable, `latest` | 2025-07-16 | через 6 мес. после 5.x |
| 3.x | Unsupported | 2022-11-16 | **2026-07-31** |
| 2.x | Unsupported | 2018-09-21 | 2024-06-30 |

Источник: [R1]. Изначально при анонсе Nuxt 4 поддержка Nuxt 3 обещалась «until the end of January 2026» [R3], затем срок продлили до 31 июля 2026 [R1]. Платный post-EOL-саппорт для Nuxt 3 даёт партнёр HeroDevs (ссылка — в релиз-нотах `v3.21.11`) [R2].

## 2. Структура проекта

- **`srcDir` по умолчанию — `app/`**; алиас `~` указывает на `app/`. В `app/` переезжают `assets/`, `components/`, `composables/`, `layouts/`, `middleware/`, `pages/`, `plugins/`, `utils/`, `app.vue`, `error.vue`, `app.config.ts`. [R6]
- В корне остаются `server/` (`serverDir`), `layers/`, `modules/`, `public/`, а также новая папка **`shared/`** — код, общий для Vue-приложения и Nitro; из `shared/utils/` и `shared/types/` идёт авто-импорт. [R6]
- Зачем (вопрос «почему»): разделение клиентского и серверного кода → быстрее file-watching (особенно Windows/Linux), точнее типизация, IDE не путает контексты. Связано с разделением TS-проектов (ниже). [R3][R6]
- **Обратная совместимость:** если Nuxt не находит `app/pages/` и т.п., он продолжает работать со старой структурой Nuxt 3. Явно вернуть старое: `srcDir: '.'`, `dir: { app: 'app' }`. Кодмод: `npx codemod@latest nuxt/4/file-structure`. [R6]

**TypeScript.** Nuxt 4 генерирует отдельные конфиги `.nuxt/tsconfig.app.json`, `tsconfig.server.json`, `tsconfig.node.json`, `tsconfig.shared.json` (project references; проверка — `vue-tsc -b --noEmit`); `noUncheckedIndexedAccess: true` по умолчанию. Аугментации типов должны лежать в `app/`, `server/` или `shared/`. [R6]

## 3. Data fetching (`useFetch` / `useAsyncData` / `$fetch`)

Неизменная база (3 и 4):
- `$fetch` в `setup` выполнится дважды (сервер + клиент при гидрации); `useFetch`/`useAsyncData` кладут результат в **payload**, и клиент переиспользует его при гидрации. `$fetch` — для событийных запросов (submit, клик). [R7]
- `useFetch(url)` ≈ `useAsyncData(key, () => $fetch(url))`; ключ `useFetch` генерируется из URL, опций и места вызова. [R7]
- Payload сериализуется `devalue` (Date, Map, Set, ref…), ответ API-роутов — `JSON.stringify` (Date приходит строкой). [R7]
- На сервере относительный `useFetch` проксирует заголовки/куки через `useRequestFetch`; с голым `$fetch` — вручную через `useRequestHeaders(['cookie'])`. [R7]

Что изменилось в Nuxt 4 [R6][R8]:

| Тема | Nuxt 3 | Nuxt 4 |
|---|---|---|
| Реактивность `data` | `ref` (deep) | **`shallowRef`** (`deep: false`); мутации вложенных полей не триггерят обновление — нужен `{ deep: true }` или замена объекта целиком |
| Дефолт `data` / `error` | `null` | **`undefined`** (проверки `=== null` ломаются) |
| Одинаковый ключ | независимые refs | **общие** `data`, `error`, `status` для всех вызовов с ключом; опции `handler`, `deep`, `transform`, `pick`, `getCachedData`, `default` должны совпадать (иначе warning); `server`, `lazy`, `immediate`, `dedupe`, `watch` могут различаться |
| Ключ | строка | может быть `ref`/`computed`/getter; смена ключа → refetch |
| Очистка | данные висят в кеше | удаляются, когда размонтирован последний компонент с этим ключом |
| `getCachedData` | только на первичной загрузке | вызывается на каждый fetch (в т.ч. watch, `refreshNuxtData`), 3-й аргумент `ctx.cause`: `'initial' \| 'refresh:hook' \| 'refresh:manual' \| 'watch'` |
| `pending` | `true` и в `idle` | computed: `true` только при `status === 'pending'`; рекомендуется `status` |
| `dedupe` | `true`/`false` | только `'cancel'` (default) / `'defer'` |
| `clear()` | обнуляет | восстанавливает `default()` если задан |
| Prerender | — | `sharedPrerenderData` по умолчанию: ключ обязан однозначно определять данные (`useAsyncData(route.params.slug, …)`) |

Новое в минорах 4.x [R8][R9]: `handler(nuxtApp, { signal })` с `AbortSignal` и `timeout` (4.2), `enabled` (4.5), `serialize` и `middleware` (4.6). Почти каждое изменение откатывается флагом `experimental.*` (`granularCachedData`, `purgeCachedData`, `pendingWhenIdle`, `defaults.useAsyncData.deep`…). [R6]

## 4. Роутинг и динамические маршруты

- File-based routing на `vue-router` не поменялся по сути: `[id].vue`, `[[optional]].vue`, `[...slug].vue`, вложенные маршруты через `<NuxtPage>`. Меняется только путь — `app/pages/`. [R6]
- `definePageMeta({ name, path })` теперь только на объекте маршрута: `route.name` вместо `route.meta.name`. [R6]
- Имена компонентов нормализуются по схеме авто-импорта (`SomeFolder/MyComponent.vue` → `SomeFolderMyComponent`) — важно для `<KeepAlive include>` и `findComponent` в тестах. [R6]
- Метаданные страниц сканируются после хука `pages:extend`; переопределять — в `pages:resolved`. [R6]
- Под `compatibilityVersion: 5`: **регистрозависимый роутинг** (`/About` ≠ `pages/about.vue`), нормализованные имена страниц (`pages/foo/index.vue` → `foo`), typed pages и typed `$fetch`, ранний return из `navigateTo`. [R6]

## 5. Middleware

Модель одинакова в 3 и 4 [R10]:
- **Route middleware** (во Vue-приложении): анонимная (inline в `definePageMeta`), именованная (`app/middleware/auth.ts`), глобальная (`*.global.ts`). Порядок: глобальные (по алфавиту, отсюда префиксы `01.`), затем страничные в порядке массива.
- `defineNuxtRouteMiddleware((to, from) => …)`; никакого `next()` — результат возвращается: `navigateTo()` (redirect, на сервере 302 по умолчанию) или `abortNavigation()`.
- При SSR middleware первой страницы выполняется **на сервере и снова на клиенте**; разводить через `import.meta.server/client` или `nuxtApp.isHydrating`. «There is no concept of a 'current route' in middleware» — используй `to`/`from`, не `useRoute()`.
- **Server middleware** (`server/middleware/`, Nitro) — «completely different» сущность, запускается на каждый запрос к серверу.
- Динамически: `addRouteMiddleware()`; на этапе сборки — `page.meta.middleware` в `pages:extend`; для путей — route rule `appMiddleware`.

Отличие Nuxt 4: `index`-файлы во вложенных папках `app/middleware/` (`auth/index.ts`) теперь регистрируются как middleware (`auth`). [R6][R10]

## 6. Рендеринг (SSR / SPA / SSG / ISR / route rules)

Набор режимов не изменился между 3 и 4 [R11]:
- **Universal (SSR + hydration)** — по умолчанию; **SPA** — `ssr: false` (+ `spa-loading-template.html`); **SSG** — `nuxt generate` / prerender; **Hybrid** — `routeRules`; **ESR** — «more a deployment target than an actual rendering mode».
- `routeRules`: `redirect`, `proxy`, `ssr`, `cors`, `headers`, `swr`, `isr`, `prerender`, `noScripts`, `appMiddleware`.
- **`swr` vs `isr`:** одинаковая логика stale-while-revalidate; `swr` кеширует на сервере/в заголовках, `isr` дополнительно кладёт в CDN платформы (Netlify, Vercel), `isr: true` — до следующего деплоя. Для `swr`/`isr` генерируются `_payload.json`.
- Route rules **не граница безопасности**: `redirect`/`proxy` могут сработать до server middleware.

Отличия Nuxt 4 [R6]:
- Конфиг **`generate` удалён** → `nitro.prerender` (`exclude` → `ignore`, `routes` как было).
- `window.__NUXT__` удаляется после гидрации → `useNuxtApp().payload`.
- Инлайнится только CSS Vue-компонентов, глобальный CSS — отдельным кешируемым файлом (`features.inlineStyles`).
- SPA loading template рендерится рядом с `#__nuxt`, а не внутри.
- Head: **Unhead v2** — удалены `vmid`, `hid`, `children`, `body`, промисы в input; сортировка тегов по Capo.js.
- `error.data` парсится автоматически (убрать `JSON.parse` в `error.vue`).

## 7. Nitro

- Nuxt 4 работает на **том же Nitro v2 / h3 v1**, что и Nuxt 3; в upgrade guide нет отдельного раздела Nitro для 3→4. В 4.2 интеграция вынесена в пакет `@nuxt/nitro-server` (внутренний рефакторинг). [R6][R9]
- Отдельный TS-проект для `server/` (`tsconfig.server.json`), `shared/` для общего кода. [R6]
- **Большой сдвиг — Nuxt 5 (Nitro v3, h3 v2):** с 4.6 рекомендуется импортировать `defineEventHandler` и хелперы из `nuxt/server`; в h3 v2 `sendRedirect` возвращает Response, `createError` использует `status`/`statusText`, `useRuntimeConfig()` без `event`, глобальный `$fetch` на сервере заменяется `serverFetch(event, path)`, `event.node` → web-стандартные `req`/`res`. Под `compatibilityVersion: 5` отключаются Nitro auto-imports. [R6]

## 8. Что устарело / удалено (сводно)

- Плоская структура без `app/` (работает, но не дефолт). [R6]
- `data`/`error` === `null`, `pending` как основной индикатор, булевы `dedupe`, мутации глубоких полей `data` без `deep: true`. [R6]
- `route.meta.name` для значений из `definePageMeta`. [R6]
- Конфиг `generate`, `window.__NUXT__`, `experimental.treeshakeClientOnly/configSchema/polyfillVueUseHead/respectNoSSRHeader`, `lodash/template` в шаблонах модулей. [R6]
- Unhead: `hid`/`vmid`/`children`/`body`. [R6]
- Совместимость с Nuxt 2 в `@nuxt/kit` (для авторов модулей). [R3]
- На горизонте Nuxt 5: h3-импорты в `server/`, Nitro auto-imports, Options API в клиентском бандле (компилируется прочь под v5), регистронезависимый роутинг. [R6]

## 9. Что вероятно спросят на senior-интервью

1. Зачем `useFetch`/`useAsyncData`, если есть `$fetch`? (двойной запрос, payload, гидрация, блокировка навигации) [R7]
2. Как работает ключ в `useAsyncData`, что будет при двух вызовах с одним ключом в Nuxt 4 и почему опции должны совпадать? [R6][R7]
3. Почему `data` стал `shallowRef` и какой баг это вызовет при миграции? (мутация вложенного поля без ре-рендера) [R6][R8]
4. `lazy` vs `server: false` vs `immediate: false`; `status` vs `pending`. [R8]
5. Route middleware vs server middleware; почему middleware срабатывает дважды при SSR; почему не `useRoute()` в middleware. [R10]
6. SSR vs SSG vs SPA vs hybrid; `swr` vs `isr` vs `prerender`; почему route rules не security boundary. [R11]
7. Что такое Nitro, `server/api`, `shared/`, как типизируется `$fetch` к своим API. [R6][R7]
8. Что изменилось в Nuxt 4 и как бы вы мигрировали проект (флаг `compatibilityVersion: 4` в Nuxt 3, кодмоды, `experimental.*`-откаты). [R3][R6]
9. Поддержка версий: что значит EOL Nuxt 3 для продакшена (security), когда Nuxt 5 и что он ломает (Nitro v3/h3 v2). [R1][R6]
10. Hydration mismatch: причины (`Date.now()`, `window` в setup, `$fetch` в setup) и инструменты (`<ClientOnly>`, `import.meta.client`, `onMounted`). [R7][R11]

## Вопросы для карты

- Пересмотреть Notes «Nuxt 3 как основа + врезки „что изменилось в Nuxt 4“»: Nuxt 3 EOL с 2026-07-31. Вариант — основа Nuxt 4, врезки «как было в Nuxt 3» (вакансии/легаси-проекты всё ещё на 3).
- Переименовать темы исходного плана «Основы Nuxt 3» / «Маршрутизация в Nuxt 3» в версионно-нейтральные («Nuxt: …»)?
- Нужны ли врезки «что будет в Nuxt 5» (Nitro v3/h3 v2), учитывая плановый релиз в Q4 2026?
- Ссылки в «источниках» тем — на `nuxt.com/docs/4.x/...`.

## Источники

- [R1] Nuxt Roadmap / release schedule — https://nuxt.com/docs/4.x/community/roadmap
- [R2] GitHub release `v3.21.11` (2026-08-05) — https://github.com/nuxt/nuxt/releases/tag/v3.21.11 ; список релизов — https://github.com/nuxt/nuxt/releases
- [R3] Блог «Announcing Nuxt 4.0» — https://nuxt.com/blog/v4
- [R4] Nuxt 3 docs, баннер EOL — https://nuxt.com/docs/3.x/migration/overview
- [R5] Блог «Nuxt 4.2» — https://nuxt.com/blog/v4-2
- [R6] Upgrade Guide (Nuxt 3 → 4, compatibilityVersion 5, Nuxt 5 notes) — https://nuxt.com/docs/4.x/getting-started/upgrade
- [R7] Data Fetching guide — https://nuxt.com/docs/4.x/getting-started/data-fetching
- [R8] `useAsyncData` API — https://nuxt.com/docs/4.x/api/composables/use-async-data
- [R9] Блог «Nuxt 4.2» (abort signal, `@nuxt/nitro-server`) — https://nuxt.com/blog/v4-2
- [R10] `app/middleware` — https://nuxt.com/docs/4.x/directory-structure/app/middleware
- [R11] Rendering Modes — https://nuxt.com/docs/4.x/guide/concepts/rendering
