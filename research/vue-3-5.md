# Vue 3.5+: актуальные API и устройство реактивности

> Research-тикет [#4](https://github.com/alexrehtide/learning/issues/4) карты [#1](https://github.com/alexrehtide/learning/issues/1).
> Дата среза: 2026-11-11. Источники только первичные: vuejs.org, blog.vuejs.org, `CHANGELOG.md` и исходники `vuejs/core`, npm registry. Номера в квадратных скобках ведут к списку источников в конце.

## TL;DR

- **Стабильная версия — Vue 3.5.45** (npm `latest`, 2026-11-05). Ветка 3.5 жива уже больше двух лет (3.5.0 вышел 2024-09-03) и получает только патчи [S1][S2].
- **Vue 3.6 находится в RC** (`3.6.0-rc.14`, 2026-10-30; rc.1 — 2026-07-18). Главное в 3.6: Vapor Mode и переписанное ядро `@vue/reactivity` по образцу alien-signals. Стабильного 3.6 на дату среза **нет** [S1][S3].
- Ключевые API 3.5: стабильная деструктуризация реактивных props, `useTemplateRef`, `useId`, lazy hydration (`hydrateOn*`), `data-allow-mismatch`, `<Teleport defer>`, `onWatcherCleanup`, `deep: number`, `pause`/`resume` у watcher'ов, `app.onUnmount`, улучшения custom elements [S4][S2].
- Реактивность в 3.5 переписана на **version counting + двусвязные списки** (идея взята из Preact Signals): памяти на 56 % меньше, computed подписывается лениво и нормально собирается GC [S5][S6].
- Для senior-интервью актуальная планка — 3.5 (Composition API, `<script setup>`, `defineModel`, props destructure). О Vapor и 3.6 полезно знать на уровне «что это и зачем», но не как о production-стандарте.

## 1. Версии и статус

| Линия | Статус на 2026-11-11 | Факты |
|---|---|---|
| 3.4 | устарела | 3.4.0 — 2023-12-29 [S1] |
| **3.5** | **stable, `latest`** | 3.5.0 — 2024-09-03, последняя 3.5.45 — 2026-11-05 [S1][S2] |
| 3.6 | RC (`rc`), также висят теги `alpha` 3.6.0-alpha.7 и `beta` 3.6.0-beta.17 | alpha.1 — 2025-07-12, beta.1 — 2025-12-23, rc.1 — 2026-07-18, rc.14 — 2026-10-30 [S1][S3] |
| 2.7 | EOL (`legacy` / `v2-latest` = 2.7.16) | конец жизни Vue 2 объявлен в [S12] |

В npm dist-tags на дату среза: `latest: 3.5.45`, `rc: 3.6.0-rc.14`, `beta: 3.6.0-beta.17`, `alpha: 3.6.0-alpha.7` [S1].

Разработка 3.6 идёт в ветке `minor` репозитория `vuejs/core`, а патчи 3.5 выходят из `main`. Поэтому у каждой ветки свой `CHANGELOG.md` [S2][S3].

## 2. API по версиям появления

Ниже перечислено то, что спрашивают про «современный Vue 3». Где указано «3.5.0-alpha.N» или «beta.N», это первый пре-релиз с фичей по changelog; в стабильной ветке все они доступны с 3.5.0.

### 3.3 (май 2023) [S7]

- `defineProps` и `defineEmits` с импортированными и сложными типами.
- Generic-компоненты: `<script setup lang="ts" generic="T">`.
- Короткий синтаксис `defineEmits<{ foo: [id: number] }>()`.
- `defineSlots` (типизация слотов, в runtime ничего не делает) и `defineOptions`.
- `toRef` принимает значения, геттеры и ref'ы; новая утилита `toValue`, рядом тип `MaybeRefOrGetter`.
- Опт-ин и экспериментально: props destructure и `defineModel`.
- Reactivity Transform (`$ref` и т. п.) прекращён.

### 3.4 (декабрь 2023) [S8]

- Парсер шаблонов переписан в однопроходный конечный автомат и стал «в 2 раза быстрее».
- `defineModel` стал стабильным; под капотом работает `useModel()`, помеченный в API-справочнике «Only available in 3.4+» [S9].
- Сокращение `:id` вместо `:id="id"`.
- Рефакторинг computed: `watchEffect` больше не перезапускается, если значение computed не изменилось.
- `watch(..., { once: true })` (3.4+) [S10].
- Флаг `__VUE_PROD_HYDRATION_MISMATCH_DETAILS__` и более подробные сообщения о hydration mismatch.

### 3.5 (сентябрь 2024) [S4][S2]

| API | Где появился | Суть |
|---|---|---|
| **Reactive Props Destructure** включён по умолчанию | 3.5.0-alpha.1 | `const { count = 0 } = defineProps<...>()` остаётся реактивным: компилятор переписывает обращения в `props.count`. Дефолты задаются нативным синтаксисом, `withDefaults` больше не нужен. `watch(count)` даёт ошибку компиляции, правильно писать `watch(() => count)`. В composable передают геттер и нормализуют его через `toValue()`. |
| `onEffectCleanup` (в `@vue/reactivity`), `failSilently` у `onScopeDispose` | 3.5.0-alpha.1 | низкоуровневые хуки очистки |
| `<Transition>` может напрямую оборачивать `<Teleport>` | 3.5.0-alpha.1 | |
| `app.onUnmount()` | 3.5.0-alpha.2 | регистрирует cleanup на размонтирование приложения |
| **`useTemplateRef(key)`** | 3.5.0-alpha.3 | возвращает shallow ref на элемент или компонент с `ref="key"`. Ключ — строка в runtime, поэтому работают и динамические `:ref`. Тип `TemplateRef` экспортируется с 3.5.14. |
| **`useId()`** + `app.config.idPrefix` | 3.5.0-alpha.3 | id уникален в пределах приложения и одинаков на сервере и клиенте, что нужно для a11y-атрибутов и `for`/`id` в формах. Нельзя вызывать внутри `computed()` [S9]. |
| **`<Teleport defer>`** | 3.5.0-alpha.3 | монтирование откладывается до конца текущего цикла рендера, так что target может отрисовать сам Vue ниже по дереву |
| `app.config.throwUnhandledErrorInProduction` | 3.5.0-alpha.3 | |
| `Symbol` в выражениях шаблона | 3.5.0-alpha.3 | |
| **`data-allow-mismatch`** (`text`, `children`, `class`, `style`, `attribute`) | 3.5.0-alpha.5 | подавляет предупреждения о неизбежных расхождениях SSR и клиента, например в датах |
| **Lazy hydration**: `defineAsyncComponent({ hydrate })` со стратегиями `hydrateOnIdle`, `hydrateOnVisible`, `hydrateOnMediaQuery`, `hydrateOnInteraction`, кастомная `HydrationStrategy` | 3.5.0-alpha.5 / beta.1 | у `hydrateOnInteraction` событие-триггер воспроизводится повторно после гидратации [S11] |
| **`watch` с `deep: number`** | 3.5.0-beta.1 | ограничивает глубину обхода [S10] |
| **`pause()` / `resume()`** у `WatchHandle`, `EffectScope`, `ReactiveEffect` | 3.5.0-beta.1 | `watch` и `watchEffect` возвращают `WatchHandle`: его можно вызвать как функцию (это `stop`), а также есть `pause`, `resume` и `stop` [S10] |
| Типы геттера и сеттера у `computed` могут различаться | 3.5.0-beta.1 | |
| Trusted Types в `runtime-dom` | 3.5.0-beta.1 | |
| Custom elements: `useHost()`, `useShadowRoot()`, `this.$host`, `shadowRoot: false`, `nonce`, `configureApp`, опции вторым аргументом `defineCustomElement` | 3.5.0-beta.1 | |
| **`onWatcherCleanup()`** и base `watch` в `@vue/reactivity`, `getCurrentWatcher` | 3.5.0-beta.3 | вызывается синхронно внутри watcher'а (не после `await`), типичное применение — `AbortController` |

Кроме того, `computed(getter)` получает предыдущее значение аргументом: `getter: (oldValue: T | undefined) => T` [S10]. В API-справочнике версия появления не указана, а changelog я до неё не проследил.

### 3.6 (RC, не stable) [S3]

- Вне Vapor и реактивности в changelog ветки `minor` есть только одна заметная пользовательская фича: `compiler-core: resolve slot prop bindings as components` (#13573).
- Подробнее о Vapor Mode — в разделе 4, о реактивности на alien-signals — в разделе 5.3.

## 3. Deprecated и удалённое

| Что | Статус | Источник |
|---|---|---|
| Reactivity Transform (`$ref`, `$computed`…) | прекращён в 3.3, удалён из core в 3.4 (живёт в Vue Macros) | [S7][S8] |
| Глобальный JSX-namespace | не регистрируется с 3.4; нужен `jsxImportSource: 'vue'` или `vue/jsx` | [S8] |
| `v-is` | удалён в 3.4; вместо него `is="vue:Comp"` | [S8] |
| `@vnodeXXX`-слушатели | с 3.4 ошибка компилятора; вместо них `@vue:XXX` | [S8] |
| `app.config.unwrapInjectedRef` | удалён в 3.4 | [S8] |
| Опция компилятора `parseExpressions` | удалена в 3.5.0-beta.2 | [S2] |
| `deferredComputed`, `pauseScheduling`/`resetScheduling` в `@vue/reactivity` | удалены в 3.5 (публичный API Vue не затронут) | [S5] |
| `withDefaults` | формально **не** deprecated, но с props destructure в 3.5 не нужен | [S4] |
| Строковые ref'ы с одноимённой переменной `ref(null)` | работают, но в 3.5+ рекомендуется `useTemplateRef` | [S4] |
| Vapor: `compilerOptions.eventDelegation` | удалён в 3.6.0-rc.2 (breaking для пре-релизов) | [S3] |

Сам блог прямо пишет, что в 3.5 «no breaking changes» [S4].

## 4. Vapor Mode: статус

Источник — release notes 3.6.0-beta.1 и rc.1 в changelog ветки `minor` [S3]:

- **Что это.** Новый режим компиляции SFC без Virtual DOM. Цели — меньший базовый бандл и выше производительность. Режим «100% opt-in» и поддерживает **подмножество** API с почти идентичным поведением. По заявлению команды, в js-framework-benchmark он показывает уровень Solid и Svelte 5.
- **Хронология.** Появился в 3.6.0-alpha.1 (2025-07-12). В beta.1 (2025-12-23) достигнут паритет со стабильными фичами VDOM-режима. В rc.1 (2026-07-18) объявлен «feature-complete». **В стабильном релизе Vapor пока нет.**
- **Рекомендации команды.** Использовать для отдельных performance-критичных страниц в существующих приложениях и для небольших новых приложений целиком на Vapor. На alpha-стадии было прямо сказано: «We do not recommend migrating existing components to Vapor Mode yet».
- **Как включить:** `<script setup vapor>`, сокращение `<script vapor>` или `<template vapor>`. Поддерживаются только `<script setup>` и template-only SFC; **Options API не поддерживается**.
- **Приложение:**
  - `createVaporApp(App)` — чистый Vapor без VDOM-рантайма в бандле;
  - `createApp(App).use(vaporInteropPlugin)` — вложение Vapor-компонентов в VDOM-приложение. Interop покрывает props, events и slots, но в крайних случаях возможны шероховатости. Рекомендуется держать раздельные «регионы» каждого режима.
- **Не поддерживается:** Options API, `app.config.globalProperties`, `getCurrentInstance()` (возвращает `null`), `@vue:xxx`, `v-memo`, `$el`/`$props`/`$attrs`/`$slots`/`$refs` на template ref компонента. Suspense в чистом Vapor не поддерживается, но Vapor-компонент можно рендерить внутри VDOM-Suspense (beta.1).
- **Отличия в поведении:**
  - другой интерфейс кастомных директив: функция `(node, valueGetter, arg, modifiers) => cleanup?`;
  - `slots.default()` не является безопасным «пробным» вызовом, он реально рендерит;
  - с rc.2 делегирование событий на `document` стало opt-in через модификатор `.delegate`.

## 5. Как устроена реактивность

### 5.1 Базовая модель (одинакова для всех версий 3.x) [S6]

- `reactive()` — это `Proxy`: в `get` вызывается `track(target, key)`, в `set` — `trigger(target, key)`. `ref` устроен как объект с getter/setter у `.value`.
- Подписки хранятся в `WeakMap<target, Map<key, Dep>>`; в исходниках это `targetMap` в `dep.ts` [S13]. Ключ `WeakMap` позволяет GC собрать target.
- Текущий подписчик хранится в глобальной переменной `activeEffect` / `activeSub`. Эффект выставляет себя активным, выполняет функцию, и все `track()` во время выполнения записывают его в зависимости. На этом построены рендер компонента, `computed`, `watch` и `watchEffect`.
- Реактивность Vue работает **в runtime**: она не требует сборки, но из-за ограничений JS нужны контейнеры (`ref`). Svelte делает то же на этапе компиляции. Reactivity Transform был попыткой compile-time-подхода и от него отказались.
- Signals в Preact и Qwik «very similar to Vue's `shallowRef`». Solid и Angular эмулируются через `shallowRef` + `triggerRef`. Для внешнего состояния (Immer, XState, RxJS) рекомендован `shallowRef`.
- Для отладки есть `onRenderTracked` / `onRenderTriggered` (работают только в dev) и опции `onTrack` / `onTrigger` у `computed` и watcher'ов.

### 5.2 Что изменилось в 3.5 (PR #10397, #9511) [S5][S14][S13]

Рефакторинг «version counting + doubly-linked list tracking», вдохновлённый Preact Signals:

- **`Link`.** Каждая связь «зависимость ↔ подписчик» — отдельный объект `Link`. Он одновременно является узлом двух двусвязных списков: списка зависимостей подписчика (`nextDep`/`prevDep`) и списка подписчиков зависимости (`nextSub`/`prevSub`). Раньше у каждой стороны было своё множество `Set`.
- **Версии.**
  - У `Dep` есть счётчик `version`, у `Link` — копия версии на момент чтения.
  - Перед перезапуском эффекта `prepareDeps` ставит всем его линкам `version = -1`. При чтении версия синхронизируется. После прогона `cleanupDeps` удаляет линки, оставшиеся с `-1`.
  - Так отписка от неиспользуемых зависимостей стоит O(deps) без пересоздания `Set`.
- **`globalVersion`.** Глобальный счётчик увеличивается при любом реактивном изменении. Если с момента последнего вычисления computed `globalVersion` не изменился, `refreshComputed` сразу возвращает кэш.
- **`isDirty`.** Эффект считается «грязным», только если у какой-то зависимости версия ушла вперёд, либо зависимость — computed, который после пересчёта (`refreshComputed`) действительно поменял значение. Это и устраняет лишние перезапуски.
- **Ленивые подписки computed.** Computed подписывается на свои зависимости только при появлении первого подписчика и отписывается, когда подписчиков не осталось. Поэтому он надёжно собирается GC, в том числе на SSR: это исправление утечек памяти из-за «висящих» computed.
- **Батчинг.** `startBatch`/`endBatch` со счётчиком `batchDepth`. Уведомлённые подписчики складываются в связный список (`batch()`, флаг `NOTIFIED`) и запускаются один раз в конце внешнего батча.
- **Флаги.** `EffectFlags` (битовая маска): `ACTIVE`, `RUNNING`, `TRACKING`, `NOTIFIED`, `DIRTY`, `ALLOW_RECURSE`, `PAUSED`, `EVALUATED`. Флаг `PAUSED` лежит в основе `pause()`/`resume()`.
- **Цифры.** Тест «1000 ref + 2000 computed + 1000 effect»: 1426k → 631k, то есть **−56 % памяти**. «Single ref invoking multiple effects» быстрее на 118–185 %, «reading multiple invalidated computeds» — на 176–244 %.
- **Массивы (#9511).** Введён специальный ключ `ARRAY_ITERATE_KEY`. Методы массивов (`map`, `filter`, `reduce`, итератор, `indexOf`…) инструментированы так, что обход трекается **одной** записью вместо O(N) записей по индексам и без прокси-накладных на каждый элемент. Отсюда «up to 10x faster» для больших глубоко реактивных массивов [S4]. Ключ триггерится при изменении `length` или любого целочисленного индекса.

### 5.3 Что меняется в 3.6 (RC): порт alien-signals [S3][S15]

- PR #12349 «refactor reactivity core by porting alien-signals» вошёл в 3.6.0-alpha.1. В release notes: «significantly improves the reactivity system's performance and memory usage».
- В `packages/reactivity/src/system.ts` (ветка `minor`) единый узел `ReactiveNode` имеет `deps/depsTail/subs/subsTail`. Флаги: `Mutable`, `Watching`, `RecursedCheck`, `Recursed`, `Dirty`, `Pending`.
- Используется push-pull-схема:
  - `propagate()` при записи помечает подписчиков `Pending` (push);
  - `checkDirty()` при чтении лениво проверяет, действительно ли изменились зависимости (pull);
  - `shallowPropagate()` помечает прямых подписчиков.
- Структура двусвязных списков из 3.5 сохраняется, меняется алгоритм распространения изменений.
- Публичный API реактивности не меняется. Это внутренняя переработка.

### 5.4 Планировщик (runtime-core, 3.5) [S16][S10]

- Очередь задач `queueJob` отсортирована по `id`, вставка идёт бинарным поиском. У родителя id меньше, чем у ребёнка, поэтому обновления идут сверху вниз, а при размонтировании ребёнка в ходе обновления родителя его задачу можно пропустить.
- Pre-watcher получает тот же id, что и update-задача его компонента, и встаёт прямо перед ней.
- `flush`:
  - `'pre'` (по умолчанию) — до рендера компонента;
  - `'post'` — после него, через `queuePostFlushCb`; синонимы `watchPostEffect` и `onMounted`/`onUpdated`-хуки;
  - `'sync'` — сразу при изменении. Документация предупреждает о рисках для производительности и консистентности.
- Задачи дедуплицируются, поэтому несколько синхронных изменений дают один рендер.
- `nextTick()` возвращает промис, который разрешается после flush'а. Механизм — микротаска на базе `Promise.resolve()`.
- Есть `RECURSION_LIMIT = 100`: защита от бесконечных рекурсивных обновлений.

## 6. Что вероятно спросят на senior-интервью

Это выжимка для будущей темы «Реактивность / Composition API». Ответы опираются на факты выше.

1. **Как работает реактивность Vue 3? Почему Proxy, а не `defineProperty`, как во Vue 2?** Proxy перехватывает добавление и удаление свойств, индексы массивов и коллекции. Модель: `track`/`trigger`, `targetMap`, активный эффект.
2. **Чем `ref` отличается от `reactive`? Зачем `.value`? Когда нужен `shallowRef`?** Ограничения runtime-реактивности. Деструктуризация `reactive` теряет реактивность. `shallowRef` подходит для внешних и иммутабельных данных.
3. **Почему computed ленивый и как он кэширует?** Флаг `DIRTY`, версии, `globalVersion` fast path. С 3.4 эффект не перезапускается, если значение computed не изменилось.
4. **Что изменилось в реактивности 3.5?** Version counting, двусвязные списки `Link`, −56 % памяти, ленивая подписка computed (утечки на SSR), `ARRAY_ITERATE_KEY`.
5. **Что такое signals и как они соотносятся с ref?** «Same kind of primitive». Порт alien-signals в 3.6.
6. **Порядок обновлений: `flush: 'pre' | 'post' | 'sync'`, `nextTick`, почему обновления батчатся.** Очередь, отсортированная по id; рендер родителя идёт раньше ребёнка.
7. **Props destructure в 3.5: как компилятор сохраняет реактивность и почему `watch(count)` — ошибка?** Обращение переписывается в `props.count`; в `watch` передаётся геттер; `toValue` / `MaybeRefOrGetter`.
8. **`defineModel`: во что разворачивается?** Prop `modelValue` + emit `update:modelValue` через `useModel`; модификаторы.
9. **`useTemplateRef` против `ref(null)` с тем же именем: в чём выигрыш?** Runtime-ключ, динамические ref'ы, типизация.
10. **SSR и гидратация:** что такое hydration mismatch, как поможет `useId`, когда `data-allow-mismatch`, lazy hydration и её стратегии (связь с islands/Nuxt).
11. **Очистка побочных эффектов:** `onWatcherCleanup` против аргумента `onCleanup` в колбэке, гонки при async-запросах, `AbortController`, `pause`/`resume`, `effectScope`.
12. **Vapor Mode:** что это, чем отличается от VDOM, когда применять, ограничения (нет Options API, `getCurrentInstance() === null`), статус на сегодня (RC, не stable).
13. **Утечки памяти в реактивности:** `WeakMap`, `effectScope().stop()`, авто-остановка watcher'ов при unmount, но не при асинхронном создании после `await`.
14. **Что удалено или устарело:** Reactivity Transform, `v-is`, глобальный JSX, Vue 2 EOL.

## 7. Открытые вопросы и замечания для карты

- **Vue 3.6 на финише RC.** Если 3.6 выйдет stable во время написания тем, нужно обновить разделы про Vapor и реактивность. Предлагаю писать темы под 3.5 и сделать врезку «что меняется в 3.6».
- **В блоге нет поста о 3.6** (последний пост — 3.5, 2024-09-01). Первоисточник по 3.6 — release notes в changelog ветки `minor`.
- **Версия появления `oldValue` в геттере `computed`** в справочнике не указана; при написании темы стоит проверить по changelog 3.4.
- Связь lazy hydration с Nuxt (`hydrate-on-*` / `LazyX`) относится к research-тикету по Nuxt.

## Источники

- [S1] npm registry, пакет `vue`: dist-tags и время публикации — https://registry.npmjs.org/vue
- [S2] `vuejs/core` CHANGELOG.md (ветка `main`, линия 3.5) — https://github.com/vuejs/core/blob/main/CHANGELOG.md
- [S3] `vuejs/core` CHANGELOG.md (ветка `minor`, линия 3.6: release notes alpha.1, beta.1, rc.1, rc.2) — https://github.com/vuejs/core/blob/minor/CHANGELOG.md
- [S4] Announcing Vue 3.5 — https://blog.vuejs.org/posts/vue-3-5
- [S5] PR #10397 «Refactor reactivity system to use version counting and doubly-linked list tracking» — https://github.com/vuejs/core/pull/10397
- [S6] Reactivity in Depth — https://vuejs.org/guide/extras/reactivity-in-depth.html
- [S7] Announcing Vue 3.3 — https://blog.vuejs.org/posts/vue-3-3
- [S8] Announcing Vue 3.4 — https://blog.vuejs.org/posts/vue-3-4
- [S9] API: Composition API Helpers — https://vuejs.org/api/composition-api-helpers.html
- [S10] API: Reactivity Core — https://vuejs.org/api/reactivity-core.html
- [S11] Guide: Async Components → Lazy Hydration — https://vuejs.org/guide/components/async.html#lazy-hydration
- [S12] Vue 2 is Approaching End Of Life — https://blog.vuejs.org/posts/vue-2-eol
- [S13] Исходники 3.5: `packages/reactivity/src/dep.ts`, `effect.ts`, `arrayInstrumentations.ts` @ v3.5.45 — https://github.com/vuejs/core/tree/v3.5.45/packages/reactivity/src
- [S14] PR #9511 «optimize array tracking» — https://github.com/vuejs/core/pull/9511
- [S15] Исходники 3.6: `packages/reactivity/src/system.ts` (ветка `minor`, «Ported from alien-signals») — https://github.com/vuejs/core/blob/minor/packages/reactivity/src/system.ts
- [S16] Исходники 3.5: `packages/runtime-core/src/scheduler.ts` @ v3.5.45 — https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/scheduler.ts
