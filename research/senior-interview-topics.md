# Ключевые темы senior frontend-интервью (Vue/Nuxt) и Frontend System Design

> Research-тикет [#3](https://github.com/alexrehtide/learning/issues/3) карты [#1](https://github.com/alexrehtide/learning/issues/1).
> Вопрос: какие темы реально спрашивают на senior frontend-интервью (Vue/Nuxt), особенно в System Design и live coding; чего не хватает в исходном плане.
> Дата: 2026-11-11.

## TL;DR

- Типовое senior-интервью складывается из **пяти форматов**: JS-coding (утилиты и полифилы), UI-coding (компонент или мини-приложение), алгоритмы, quiz/trivia (короткие теоретические вопросы) и **Frontend System Design** [S1]. В крупных компаниях это 4–6 раундов по ~45 минут, и среди них отдельный раунд UI-архитектуры без кода [S3, S4]. В Яндексе 2–5 технических секций плюс финал с руководителем [S5].
- Live coding на фронтенде всё больше смещается от LeetCode к **утилитам** (`debounce`, `throttle`, `Promise.all`, `cloneDeep`, полифилы Array/Promise, `JSON.stringify`) и **UI-компонентам** (табы, модалка, автокомплит, таблица с сортировкой) [S1, S2, S6]. Исходный план покрывает это только пунктом «простейшие задачи на массивы и строки». Это **самый большой пробел**.
- System Design проходят по фреймворку **RADIO**: Requirements → Architecture → Data model → Interface (API) → Optimizations [S7]. Senior-уровень отличают глубокие разборы производительности, доступности и i18n [S7, S2].
- Для стека Vue/Nuxt senior-глубина — это механика: Proxy-реактивность (`track`/`trigger`, эффекты), рендеринг через compiler-informed VDOM, SSR и гидрация, cross-request state pollution, режимы рендеринга Nuxt, `useFetch`/`useAsyncData` и payload [S8–S12]. В исходном плане Vue и Nuxt даны на уровне «основ».
- Целиком отсутствуют в плане: **TypeScript, производительность (Core Web Vitals), веб-безопасность, сеть (HTTP, кэширование, CORS), System Design/архитектура, a11y, тестирование**. Часть из них уже утверждена в Notes карты, остальные предлагаются ниже.

## Методология и оговорки

- Первоисточник о том, что спрашивают на интервью, — это сами компании. Публично они почти ничего не описывают: у Яндекса есть только общая структура процесса без списка тем [S5], у Meta подробные гайды доступны только кандидатам в портале. Публичные данные о Meta получены из вторичных источников [S3, S4].
- Поэтому форматы и типовые задачи взяты из **Front End Interview Handbook** (Yangshun Tay, бывший инженер Meta) [S1, S2, S6, S7]. Это самый цитируемый открытый справочник по frontend-интервью, но он вторичен по отношению к компаниям. Фреймворк RADIO придумала GreatFrontEnd, и handbook зеркалит их playbook.
- Технические факты (механика Vue/Nuxt, метрики Web Vitals, безопасность) сверены с первоисточниками: vuejs.org, nuxt.com, web.dev.
- **Важность** проставлена экспертной оценкой на основе того, как часто тема фигурирует в форматах и примерах [S1, S2, S6, S7]. Статистикой по частоте это не является:
  - ★★★ — спрашивают почти всегда, нужна глубина «почему»;
  - ★★ — частая тема, нужны уверенные ответы;
  - ★ — встречается реже, хватит обзора и умения поддержать разговор.
- Пометка **[нет в плане]** значит, что темы нет в исходном плане карты; **[частично]** — тема упомянута в плане, но поверхностно.

---

## 1. JavaScript

| Тема / подтемы | Важность | Статус |
|---|---|---|
| Типы, приведение типов (coercion), `==` vs `===`, `typeof`/`instanceof`, `null`/`undefined`, mutable vs immutable | ★★ | частично |
| Область видимости, hoisting, TDZ, `var`/`let`/`const` | ★★★ | частично |
| Замыкания: применение (модули, мемоизация, приватность), утечки памяти через замыкания | ★★★ | есть |
| `this`: 4 правила привязки, стрелочные функции, `call`/`apply`/`bind`, `new` | ★★★ | есть |
| Прототипы: `[[Prototype]]`, цепочка, `Object.create`, классы как сахар, приватные поля `#x`, static | ★★★ | есть |
| **Event loop**: call stack, macrotask/microtask, порядок `Promise`/`setTimeout`/`queueMicrotask`, место рендера и `requestAnimationFrame` | ★★★ | **нет в плане** (есть только «промисы») |
| Промисы: состояния, цепочки, комбинаторы `all`/`allSettled`/`race`/`any`, async/await, обработка ошибок, `AbortController`, отмена и гонки запросов | ★★★ | частично |
| Генераторы, итераторы, протокол `Symbol.iterator`, async-итераторы | ★ | есть |
| `Proxy`/`Reflect`, `Symbol`, геттеры и сеттеры, дескрипторы свойств (это база реактивности Vue) | ★★ | **нет в плане** |
| Модули: ESM vs CommonJS, live bindings, динамический `import()`, tree shaking | ★★ | **нет в плане** |
| Память и GC: достижимость, утечки (слушатели, таймеры, замыкания, detached DOM), `WeakMap`/`WeakRef` | ★★ | **нет в плане** |
| Функциональные приёмы: higher-order functions, каррирование, композиция, чистые функции | ★★ | **нет в плане** |
| Копирование: shallow/deep, `structuredClone`, циклические ссылки | ★★ | **нет в плане** |
| Современный синтаксис: деструктуризация, spread/rest, optional chaining, `??`, шаблонные строки | ★ | есть |

Источник списка — JS-quiz handbook'а (54 вопроса: event delegation, `this`, prototypal inheritance, closures, hoisting, event loop, `let`/`var`/`const`, currying, spread/rest, ESM/CJS и т.д.) [S6].

## 2. Браузеры и сеть

| Тема / подтемы | Важность | Статус |
|---|---|---|
| Critical rendering path: HTML → DOM, CSSOM, render tree, layout, paint, composite; render-blocking ресурсы; `defer`/`async`/`type=module` | ★★★ | есть |
| Reflow/repaint, layout thrashing, свойства только для compositor (`transform`/`opacity`) | ★★★ | частично |
| События: capture/target/bubble, делегирование, `preventDefault`/`stopPropagation`, passive listeners, custom events | ★★★ | есть |
| DOM API: attributes vs properties, обход DOM, `MutationObserver`/`IntersectionObserver`/`ResizeObserver` | ★★ | частично |
| «Что происходит после ввода URL»: DNS, TCP/TLS, HTTP, парсинг, рендер | ★★★ | частично |
| **HTTP**: методы, статусы, заголовки, HTTP/1.1 vs HTTP/2 vs HTTP/3, keep-alive | ★★ | **нет в плане** |
| **Кэширование**: `Cache-Control`, `ETag`/`Last-Modified`, хэш в имени файла, CDN, Service Worker cache | ★★★ | **нет в плане** |
| **CORS** и same-origin policy, preflight, cookies (`SameSite`, `HttpOnly`, `Secure`) | ★★★ | **нет в плане** |
| Хранилища: cookies, localStorage, sessionStorage, IndexedDB, Cache API | ★★ | **нет в плане** |
| Real-time: polling, long polling, SSE, WebSocket (выбор и компромиссы) | ★★ | **нет в плане** |
| Web Workers, Service Workers, PWA и офлайн | ★ | **нет в плане** |
| Resource hints: `preload`, `prefetch`, `preconnect`, `fetchpriority`, lazy loading | ★★ | **нет в плане** |

## 3. Вёрстка (HTML/CSS)

| Тема / подтемы | Важность | Статус |
|---|---|---|
| Семантический HTML, формы (нативная валидация, `label`, `fieldset`), мультимедиа | ★★ | есть |
| Каскад: специфичность, наследование, `@layer`, `!important` | ★★★ | **нет в плане** |
| Box model, `box-sizing`, margin collapsing, BFC | ★★★ | **нет в плане** |
| Flexbox, Grid (и когда что выбирать) | ★★★ | есть |
| Позиционирование, **stacking context** и `z-index` | ★★★ | частично |
| Адаптивность: media queries, **container queries**, `srcset`/`sizes`/`<picture>`, единицы измерения (`rem`, `vw`, `dvh`, `clamp`) | ★★ | частично |
| Современный CSS: custom properties, `:has()`, `:is()`/`:where()`, логические свойства | ★★ | **нет в плане** |
| Анимации: `transition`, `@keyframes`, `transform`, производительность анимаций, `prefers-reduced-motion` | ★★ | есть |
| Изоляция стилей в Vue: scoped CSS, CSS Modules, `v-bind()` в `<style>`; методологии (BEM) | ★★ | **нет в плане** |

## 4. Vue 3 / Nuxt / Pinia

Senior-вопросы по Vue касаются того, как устроен фреймворк, а не того, как им пользоваться.

### Vue

| Тема / подтемы | Важность | Статус |
|---|---|---|
| **Реактивность изнутри**: Proxy для `reactive`, getter/setter для `ref`, `track`/`trigger`, `WeakMap<target, Map<key, Set<effect>>>`, `computed` как ленивый эффект, ограничения `reactive` (деструктуризация, identity), `shallowRef`/`markRaw`/`toRaw`, связь с signals [S8] | ★★★ | частично («реактивность») |
| `ref` vs `reactive`, `computed` vs `watch` vs `watchEffect`, `flush`, `onWatcherCleanup` (3.5) [S9] | ★★★ | есть |
| **Механизм рендеринга**: VDOM, compiler-informed оптимизации (static hoisting, patch flags, block tree), роль `key`, Vapor Mode как направление развития [S8] | ★★★ | **нет в плане** |
| Компоненты: props/emits, `v-model` на компонентах (`defineModel`), слоты (scoped), provide/inject, атрибуты fallthrough | ★★★ | частично |
| Жизненный цикл, в том числе какие хуки выполняются на сервере [S10] | ★★ | есть |
| Composables: дизайн, разделение логики, сравнение с mixins, VueUse | ★★★ | частично |
| Встроенные компоненты: `KeepAlive`, `Teleport` (и `defer` в 3.5), `Suspense`, `Transition`; async components | ★★ | **нет в плане** |
| Custom directives, plugins, глобальная обработка ошибок (`app.config.errorHandler`, `onErrorCaptured`) | ★ | **нет в плане** |
| Vue Router: guards, lazy routes, scroll behavior, мета маршрутов | ★★ | частично (через Nuxt) |
| **SSR и гидрация**: причины hydration mismatch (невалидная вложенность HTML, `Math.random`, часовые пояса), `data-allow-mismatch`, **cross-request state pollution**, browser-only API, `getSSRProps` для директив, Teleport в SSR [S10] | ★★★ | **нет в плане** |
| Новое в Vue 3.5: reactive props destructure, `useTemplateRef`, `useId`, lazy hydration, рефакторинг реактивности (−56% памяти) [S9] | ★★ | **нет в плане** |
| Формы и валидация (VeeValidate/Zod/Valibot, schema-first подход) | ★★ | есть |
| Производительность Vue: `v-once`/`v-memo`, стабильность props, виртуализация, `shallowRef` для больших данных | ★★ | **нет в плане** |
| Безопасность Vue: что экранируется автоматически, `v-html`, `javascript:` URL в `:href`, style injection, запрет на пользовательские шаблоны [S11] | ★★★ | **нет в плане** |

### Pinia

| Тема / подтемы | Важность | Статус |
|---|---|---|
| Options stores vs setup stores, `storeToRefs`, getters/actions, `$patch`/`$subscribe` | ★★ | частично |
| Архитектура состояния: что хранить в store, а что локально или в server-state; нормализация | ★★★ | **нет в плане** |
| SSR и Pinia: store на каждый запрос, сериализация состояния, почему Pinia спроектирована под этот паттерн [S10] | ★★ | **нет в плане** |
| Плагины Pinia, тестирование stores | ★ | **нет в плане** |

### Nuxt

| Тема / подтемы | Важность | Статус |
|---|---|---|
| **Режимы рендеринга**: universal (по умолчанию), CSR (`ssr: false`), hybrid через `routeRules`, prerender, SWR/ISR, edge как deployment target [S12] | ★★★ | **нет в плане** |
| **Data fetching**: `$fetch` vs `useFetch` vs `useAsyncData`, двойной запрос и payload, опции `key`/`lazy`/`server`/`pick`/`transform`/`watch`/`getCachedData`, проброс заголовков (`useRequestFetch`, `useRequestHeaders`) [S13] | ★★★ | частично («fetch и asyncData») |
| Структура, auto-imports, file-based routing, динамические и вложенные маршруты, layouts | ★★ | есть |
| Middleware (route/global), плагины, `useState`, `runtimeConfig` (public и private) | ★★ | **нет в плане** |
| Nitro: server routes/API, server middleware, деплой-пресеты | ★★ | **нет в плане** |
| SEO: `useHead`/`useSeoMeta`, canonical, sitemap | ★ | **нет в плане** |
| Обработка ошибок: `createError`, `error.vue`, `showError` | ★ | **нет в плане** |
| **Nuxt 4**: директория `app/` и `shared/`, `shallowRef`-данные в `useAsyncData`, `undefined` по умолчанию, общие refs по ключу, раздельные tsconfig, `noUncheckedIndexedAccess` [S14] | ★★ | Notes карты (врезки) |

## 5. Инструменты

| Тема / подтемы | Важность | Статус |
|---|---|---|
| Сборка: Vite (dev на нативных ESM, prod через Rollup/Rolldown), сравнение с Webpack, HMR | ★★ | частично |
| Bundle-оптимизация: tree shaking, code splitting, chunking, анализ бандла, source maps | ★★★ | **нет в плане** |
| Транспиляция и полифилы: Babel/esbuild/SWC, browserslist, `core-js` | ★ | есть |
| Пакеты: npm/pnpm, lockfile, semver, монорепозитории (pnpm workspaces, Turborepo/Nx) | ★★ | **нет в плане** |
| Качество кода: ESLint, Prettier, Stylelint, pre-commit-хуки | ★ | **нет в плане** |
| Git: rebase vs merge, стратегии ветвления, conventional commits | ★ | есть |
| CI/CD: пайплайн (lint → test → build → deploy), preview-окружения, кэш | ★★ | есть |
| Наблюдаемость в проде: Sentry, RUM для Web Vitals, feature flags | ★★ | **нет в плане** |

## 6. TypeScript — **нет в плане** (в Notes карты есть как ядро)

| Тема / подтемы | Важность |
|---|---|
| Структурная типизация, `type` vs `interface`, union/intersection, сужение (narrowing), type guards, discriminated unions | ★★★ |
| Generics, ограничения (`extends`), дефолтные параметры | ★★★ |
| Utility types (`Partial`, `Pick`, `Omit`, `Record`, `ReturnType`…) и их реализация с нуля | ★★★ |
| Conditional types, `infer`, mapped types, template literal types | ★★ |
| `unknown` vs `any` vs `never`, `satisfies`, `as const`, проверка исчерпываемости | ★★ |
| TS во Vue: `defineProps<T>()`, generic-компоненты, типизация `emits`, слотов, provide/inject (`InjectionKey`), типизация Pinia | ★★★ |
| Настройки: `strict`, `noUncheckedIndexedAccess` (по умолчанию в Nuxt 4) [S14], declaration files, module augmentation | ★ |

## 7. Производительность — **нет в плане как раздела** (в Notes как ядро)

| Тема / подтемы | Важность |
|---|---|
| **Core Web Vitals**: LCP ≤ 2,5 с, INP ≤ 200 мс, CLS ≤ 0,1 на 75-м перцентиле; INP заменил FID в 2024. Вспомогательные метрики: TTFB, FCP, TBT (лабораторный прокси INP) [S15] | ★★★ |
| Lab vs field: Lighthouse, CrUX, RUM, `web-vitals` | ★★ |
| Профилирование: Performance panel в DevTools, long tasks, Vue DevTools | ★★★ |
| Оптимизация загрузки: critical CSS, code splitting, lazy loading, изображения (форматы, `srcset`, `fetchpriority`), шрифты (`font-display`), сжатие и кэш | ★★★ |
| Оптимизация runtime: разбиение длинных задач (`scheduler.yield`, `requestIdleCallback`), debounce/throttle, виртуализация списков, Web Workers | ★★ |
| **Утечки памяти**: heap snapshots, типовые причины в SPA (неотписанные слушатели, таймеры, глобальные stores) | ★★ |
| Performance budget, мониторинг регрессий в CI | ★ |

## 8. Веб-безопасность — **нет в плане** (в Notes как ядро)

| Тема / подтемы | Важность |
|---|---|
| **XSS**: reflected/stored/DOM-based, экранирование, `v-html`, `innerHTML` vs `textContent`, санитизация (DOMPurify), `javascript:` URL [S11, S2] | ★★★ |
| **CSP**: директивы, nonce/hash, `strict-dynamic`, report-only | ★★ |
| **CSRF**: SameSite cookies, CSRF-токены (Vue отмечает, что это в основном зона бэкенда) [S11] | ★★ |
| CORS (как механизм ослабления SOP, а не защиты) | ★★ |
| Аутентификация на фронте: где хранить токены (`HttpOnly` cookie vs localStorage), refresh-флоу, OAuth 2.0/PKCE | ★★★ |
| Clickjacking (`frame-ancestors`, `X-Frame-Options`), style injection [S11] | ★ |
| Supply chain: зависимости, lockfile, SRI | ★ |
| SSR-специфика: утечка данных между запросами, секреты в `runtimeConfig` (public и private) [S10] | ★★ |

## 9. Доступность (a11y) — облегчённо (Notes: «дополнительно»)

| Тема / подтемы | Важность |
|---|---|
| Семантика прежде ARIA; роли, состояния, `aria-label`/`aria-labelledby`/`aria-describedby`, live regions | ★★ |
| Клавиатура: порядок фокуса, focus trap в модалке, roving tabindex, `:focus-visible` | ★★ |
| Контраст, масштабирование текста, `prefers-reduced-motion` | ★ |
| WCAG 2.2 (уровни A/AA), проверка (axe, скринридеры) | ★ |
| a11y в UI-coding и System Design: handbook прямо называет её признаком senior-уровня [S2, S7] | ★★ |

## 10. Тестирование — облегчённо (Notes: «дополнительно»)

| Тема / подтемы | Важность |
|---|---|
| Пирамида и trophy: unit, integration, e2e; что и зачем тестировать | ★★ |
| Vitest + Vue Test Utils / Testing Library; тестирование composables и Pinia stores | ★★ |
| Моки сети (MSW), фейковые таймеры | ★ |
| E2E: Playwright/Cypress; визуальная регрессия; тестирование в Nuxt (`@nuxt/test-utils`) | ★ |

## 11. Frontend System Design и архитектура — **нет в плане** (в Notes как ядро)

### Фреймворк ответа — RADIO [S7]

1. **Requirements**: уточняющие вопросы, функциональные и нефункциональные требования, границы задачи.
2. **Architecture**: ключевые компоненты (view, controller, client store, server API) и связи между ними.
3. **Data model**: сущности, поля, кто ими владеет (server state vs client state).
4. **Interface (API)**: API между компонентами и с сервером (REST/GraphQL, пагинация cursor vs offset, real-time).
5. **Optimizations and deep dive**: около 40% времени. Производительность, UX, a11y, i18n, безопасность, офлайн.

Сервер считается чёрным ящиком: схему БД обычно не проектируют [S7]. В Meta это отдельный раунд около 45 минут без кода [S4].

### Типовые задачи [S7]

- **Компоненты**: autocomplete/typeahead ★★★, image carousel, dropdown, modal, data table (сортировка, фильтры, виртуализация) ★★, rich text editor, poll widget.
- **Приложения**: news feed с бесконечной лентой ★★★, чат/мессенджер ★★★, e-commerce, photo sharing (Pinterest), email-клиент, коллаборативный редактор или таблица, видеостриминг, travel booking.

### Сквозные темы для разборов

| Тема | Важность |
|---|---|
| Выбор стратегии рендеринга: CSR/SSR/SSG/ISR/hybrid, islands, streaming; связь с Nuxt `routeRules` [S12] | ★★★ |
| Управление состоянием: server state vs client state, кэш и инвалидация, нормализация, optimistic updates | ★★★ |
| Сеть: пагинация (cursor/offset), дедупликация и отмена запросов, retry/backoff, гонки, real-time транспорт | ★★★ |
| Производительность: виртуализация, lazy loading, prefetch, оптимизация изображений, бюджет бандла | ★★★ |
| Офлайн и PWA, синхронизация, разрешение конфликтов (CRDT/OT для коллаборативных редакторов, обзорно) | ★ |
| i18n и l10n (RTL, плюрализация, форматы дат и чисел), a11y | ★★ |
| Безопасность (XSS в пользовательском контенте), аутентификация | ★★ |
| Наблюдаемость: логирование ошибок, RUM, feature flags, A/B-тесты | ★ |

### Архитектура фронтенд-приложений (вне формата RADIO, но частый senior-разговор)

| Тема | Важность |
|---|---|
| Структура большого Vue/Nuxt-проекта: слои, границы модулей; **Feature-Sliced Design** (популярен на российском рынке) [S16] | ★★ |
| Design system и UI-kit: токены, headless-компоненты, версионирование | ★★ |
| Микрофронтенды: Module Federation, Nuxt Layers, компромиссы | ★ |
| Монорепозитории, общие пакеты | ★ |
| Принципы: SOLID/DRY/KISS применительно к фронту, паттерны (Observer, Strategy, Facade, DI через provide/inject) | ★★ |

## 12. Live coding / реализации с нуля

Handbook выделяет **три coding-формата**: JS-утилиты, UI и алгоритмы [S1]. Ориентир по времени: 10–15 минут на базовую утилиту, 25–30 минут на продвинутую [S6-coding].

### JS-утилиты и полифилы (★★★) [S6-coding]

- `debounce` (с `leading`/`trailing`/`cancel`), `throttle`
- `Promise.all`, `Promise.allSettled`, `Promise.race`, `Promise.any`; свой `Promise` (★★); пул промисов с лимитом конкурентности; `retry`; `sleep`/`timeout`
- `Array.prototype.map`/`filter`/`reduce`/`flat`; `Function.prototype.bind`/`call`/`apply`
- `cloneDeep` (циклы, `Map`/`Set`, `Date`), `deepEqual`, `flatten` объекта, `get`/`set` по пути, `groupBy`, `chunk`, преобразование ключей snake_case ↔ camelCase
- `curry`, `compose`/`pipe`, `memoize`, `once`
- `EventEmitter` / Observer (`on`/`off`/`once`/`emit`)
- `classnames`, `JSON.stringify` (★★), простой шаблонизатор (★★), `getElementsByClassName` / обход DOM
- **Мини-реактивность** во Vue-стиле (`reactive`/`effect`/`computed` на Proxy) — профильная задача для Vue-кандидата [S8]
- TS-упражнения: реализовать `Pick`/`Omit`/`DeepPartial`/`Awaited` (★★)

Что проверяют: чистота функций, глубина рекурсии, циклические ссылки, выбор структуры данных и Big O [S6-coding].

### UI-coding (★★★) [S2]

- Компоненты: tabs, accordion, modal, carousel, star rating, progress bar, autocomplete
- Виджеты: таймер/секундомер, transfer list
- Приложения: todo, data table с сортировкой и фильтрами, file explorer (дерево), kanban
- Игры: tic-tac-toe, Wordle
- Критерии оценки: организация кода и переиспользуемость, состояния empty/loading/error, гонки запросов, a11y (клавиатура, ARIA), безопасный вывод (`textContent`), адаптивность. Для Vue-кандидата задачу обычно решают на Vue.

### Алгоритмы (★★)

Классические паттерны на JS: хеш-таблицы, два указателя, скользящее окно, стек/очередь, BFS/DFS по деревьям (в том числе DOM-дереву), бинарный поиск, сортировки, базовая рекурсия и мемоизация. Вопросы на оценку сложности.

---

## Чего не хватает в исходном плане (сводка)

Отмечено, покрывают ли тему уже утверждённые расширения из Notes карты.

### Целые разделы

| Отсутствует | В Notes карты? |
|---|---|
| Frontend System Design (RADIO, типовые задачи) и архитектура фронтенда | да («Архитектура и System Design») |
| TypeScript | да |
| Производительность (Web Vitals, профилирование, утечки) | да |
| Веб-безопасность | да |
| a11y, тестирование | да (облегчённо) |
| Live coding: JS-утилиты и полифилы | да (список реализаций с нуля) |
| **UI-coding (компонент с нуля за 30–45 минут)** | **нет**. Предлагаю добавить как формат задач или тему |
| **Сеть: HTTP, кэширование, CORS, cookies, хранилища, real-time** | **нет**. В плане есть только рендеринг и события |

### Пробелы внутри существующих разделов (не покрыты Notes)

- **JavaScript**: event loop (micro/macrotasks) как отдельная тема; `Proxy`/`Reflect` (база реактивности Vue); модули ESM/CJS; память и GC; копирование и `structuredClone`; функциональные приёмы.
- **Вёрстка**: каскад и специфичность (`@layer`), box model и BFC, stacking context, container queries, современные селекторы, изоляция стилей во Vue.
- **Vue**: механизм рендеринга (VDOM, compiler-оптимизации), SSR и гидрация, встроенные компоненты (`KeepAlive`/`Teleport`/`Suspense`), provide/inject, слоты, дизайн composables, новое в 3.5, Vue Router.
- **Pinia**: архитектура состояния, SSR-аспекты.
- **Nuxt**: режимы рендеринга и `routeRules`, Nitro и server routes, middleware, plugins, `useState`, `runtimeConfig`, SEO, обработка ошибок.
- **Инструменты**: bundle-оптимизация (tree shaking, code splitting), монорепозитории и менеджеры пакетов, наблюдаемость в проде.

## Новые вопросы для карты

1. Делать ли **UI-coding** отдельной темой (например, `live-coding/ui-components.md` с 4–6 компонентами на Vue) или распределить его по задачам в темах Vue?
2. Нужен ли отдельный раздел или тема **«Сеть»** (HTTP, кэширование, CORS, хранилища, real-time)? Сейчас в плане «Браузеры и сеть» о сети почти ничего нет.
3. Где живут **SSR и гидрация**: в Vue, в Nuxt или в System Design (стратегии рендеринга)? Тема пересекает все три раздела.
4. Включать ли **Feature-Sliced Design** и микрофронтенды в раздел архитектуры (это специфика российского рынка), и на какой глубине?

## Источники

- [S1] Front End Interview Handbook — Introduction (Yangshun Tay / GreatFrontEnd): https://www.frontendinterviewhandbook.com/introduction
- [S2] Front End Interview Handbook — User interface coding: https://www.frontendinterviewhandbook.com/coding/build-user-interfaces
- [S3] GreatFrontEnd — Meta Front End Interview Guide (вторичный источник): https://www.greatfrontend.com/interviews/company/meta/questions-guides
- [S4] Prepfully — Meta Front End Engineer, UIE architecture & design round (вторичный источник): https://prepfully.com/interview-guides/meta-frontend-engineer-uie-architecture-design-interview
- [S5] Яндекс — Как устроено собеседование (официально): https://yandex.ru/jobs/interview
- [S6] Front End Interview Handbook — JavaScript quiz questions: https://www.frontendinterviewhandbook.com/javascript-questions
- [S6-coding] Front End Interview Handbook — JavaScript utility functions: https://www.frontendinterviewhandbook.com/coding/javascript-utility-function
- [S7] Front End Interview Handbook — Front End System Design (RADIO): https://www.frontendinterviewhandbook.com/front-end-system-design; первоисточник фреймворка: https://www.greatfrontend.com/front-end-system-design-playbook/framework
- [S8] Vue.js — Reactivity in Depth: https://vuejs.org/guide/extras/reactivity-in-depth.html; Rendering Mechanism: https://vuejs.org/guide/extras/rendering-mechanism.html
- [S9] Vue.js blog — Announcing Vue 3.5: https://blog.vuejs.org/posts/vue-3-5
- [S10] Vue.js — Server-Side Rendering: https://vuejs.org/guide/scaling-up/ssr.html
- [S11] Vue.js — Security: https://vuejs.org/guide/best-practices/security.html
- [S12] Nuxt — Rendering Modes: https://nuxt.com/docs/4.x/guide/concepts/rendering
- [S13] Nuxt — Data Fetching: https://nuxt.com/docs/4.x/getting-started/data-fetching
- [S14] Nuxt — Upgrade Guide (Nuxt 3 → 4): https://nuxt.com/docs/4.x/getting-started/upgrade
- [S15] web.dev — Web Vitals: https://web.dev/articles/vitals
- [S16] Feature-Sliced Design (официальная документация): https://feature-sliced.design/
