# Research: Pinia — актуальный API, setup stores, SSR в Nuxt

> Тикет: [#6](https://github.com/alexrehtide/learning/issues/6) · карта: [#1](https://github.com/alexrehtide/learning/issues/1) · дата сверки: 2026-11-11
>
> Только первоисточники: pinia.vuejs.org, исходники и релизы `vuejs/pinia` (тег `v4.1.0`), vuejs.org, vuex.vuejs.org, nuxt.com. Ссылка на источник стоит у каждого утверждения; номера в квадратных скобках — список источников в конце.

## TL;DR

- **Актуальная версия — Pinia 4.1.0** (14.10.2026), вместе с ней `@pinia/nuxt@1.0.3` и `@pinia/testing@2.0.2` [R1]. Pinia 4 ломает совместимость только формально: пакет теперь **ESM-only**, а `@vue/devtools-api` (v8) стал **обязательной peer-зависимостью**, которую ставят рядом с pinia. Ещё в v4 переделаны ошибки и dev-предупреждения (Nostics) [R2]. Peer-зависимости: `vue ^3.5.11`, `typescript >=5.6` (опционально) [S1].
- Pinia 3 (раньше) убрала поддержку Vue 2, `defineStore({ id })` и `PiniaStorePlugin` [R4]. Для библиотеки: **Vue 3.5+, Pinia 4, `defineStore('id', …)`** — устаревшие формы не упоминаем, разве что в сравнении.
- `@pinia/nuxt@1.x` объявляет совместимость с `nuxt: ^3.15.0 || ^4.0.0 || ^5.0.0` [S2]. Это закрывает «Nuxt 3 + врезки Nuxt 4» из карты.
- Vuex официально больше не по умолчанию: «Pinia is now the new default». Vuex 3/4 поддерживаются, но новых функций, скорее всего, не будет [V2].

## 1. Определение store: options vs setup

`defineStore(id, optionsOrSetup)`. `id` должен быть уникален в приложении, по нему store связывается с devtools. Возвращаемую функцию по конвенции называют `use…Store` [D1].

| | Options store | Setup store |
|---|---|---|
| state | `state: () => ({…})` | `ref()` / `reactive()` |
| getters | `getters: { double: (s) => s.n * 2 }` | `computed()` |
| actions | `actions: { inc() { this.n++ } }` | обычные функции |
| `$reset()` | встроен: заново вызывает `state()` и применяет через `$patch` [S3] | **нет**: в dev бросает `Store "x" is built using the setup syntax and does not implement $reset()`, нужно писать свой [D2][S3] |
| watchers, composables | ограниченно (composable внутри `state` может вернуть только записываемый state) [D7] | да, почти любые composables [D7] |
| `inject()`, `useRoute()` | — | да, но возвращать их из store не нужно: это не state [D1] |
| кастомные опции плагинов | в объекте опций | третьим аргументом `defineStore` [D5] |

Ключевые правила setup stores:

- **Возвращать нужно всё состояние.** «Not returning all state properties or making them readonly will break SSR, devtools, and other plugins» — поэтому приватного state в store нет [D1].
- Композиция store'ов: другой store вызывают в начале setup-функции. При циклической зависимости два store не могут оба читать state друг друга прямо в setup; такие чтения переносят в `computed` или actions [D9].
- Хелпер `setup({ action })` (`SetupStoreHelpers.action`) оборачивает функцию, чтобы `$onAction` видел вызовы *изнутри* store. В исходниках он помечен как редко нужный, «for advanced use cases like Pinia Colada» [S3].

### State и TypeScript

- `state` — функция, иначе SSR не работает. Каждое поле нужно объявить в `state()`, даже со значением `undefined`: новые поля после создания store не добавляются [D2].
- Типы выводятся при `strict` / `noImplicitThis`. Пустые массивы и nullable приводят явно (`[] as User[]`) или задают интерфейсом [D2].
- Getter, который обращается к `this`, требует явного типа возврата. Getter, возвращающий функцию, **не кешируется** [D3].

## 2. `storeToRefs`

- Store — это `reactive`-объект. Деструктуризация state/getter копирует текущее значение, и реактивность теряется [D1].
- `storeToRefs(store)` делает refs только из state, getters и state, добавленного плагинами. Actions и нереактивные свойства пропускаются: «methods and non reactive properties are completely ignored» [S4]. Actions можно деструктурировать прямо из store, они привязаны к нему [D1].
- Чем отличается от `toRefs`: `toRefs(store)` сделал бы refs и из методов, и из служебных `$`-полей. `storeToRefs` берёт `toRaw(store)` и раскладывает state через `toRef`, а getters — как computed [S4].
- Нюансы v4: nullish-значения пропускаются без ошибки, на невалидные свойства выдаётся диагностика [R2].

## 3. API экземпляра store

### `$patch`

- Объектная форма: `store.$patch({ a: 1, b: 2 })` — частичный deep-merge [D2].
- Функциональная форма: `store.$patch(state => { state.items.push(x) })`. Нужна для коллекций: push/splice объектом не выразить [D2].
- Обе формы попадают в devtools одной записью и вызывают подписчиков `$subscribe` один раз [D2].
- `store.$state = {...}` присвоить нельзя, иначе сломается реактивность; на деле это вызов `$patch`. Состояние всего приложения целиком задаётся через `pinia.state.value = …`, и так работает гидратация [D2].
- 4.1.0: объектная форма `$patch` теперь триггерит `shallowRef` [R3].

### `$subscribe(callback, options?)`

- `callback(mutation, state)`, где `mutation.type` — одно из `'direct' | 'patch object' | 'patch function'`; есть `mutation.storeId`, а `mutation.payload` бывает только у `'patch object'` [D2].
- Под капотом `watch()`, но срабатывает один раз на patch. `flush: 'sync'` вызывает callback на каждое изменение без батчинга [D2].
- Подписка, созданная в компоненте, снимается при его unmount; `{ detached: true }` её сохраняет [D2].
- Всё состояние целиком можно наблюдать через `watch(pinia.state, cb, { deep: true })` — например, для персистентности [D2].
- v4: повторная подписка тем же callback больше не создаёт второй watcher [R2].

### `$onAction(callback, detached?)`

- `callback({ name, store, args, after, onError })` выполняется **до** action. `after(result)` вызывается после успешного завершения и ждёт возвращённый промис; `onError(err)` — при throw или reject [D4].
- Возвращает функцию отписки; второй аргумент `true` отвязывает подписку от компонента [D4].
- Типичное применение — логирование, аналитика, optimistic UI, метрики длительности.

### `$reset`, `$dispose`, `getStores`

- `$reset` см. выше. В setup store его пишут вручную, сбрасывая каждый ref [D2].
- `$dispose()` останавливает effect scope store'а, чистит подписки и удаляет store из `pinia._s`. State в `pinia.state` **остаётся** [S3]. В 4.1 добавлено dev-предупреждение, если dispose вызвали для уже заменённого store [R3].
- 4.1.0: `getStores(pinia)` возвращает массив созданных store'ов (`Array.from(pinia._s.values())`) [R3][S5].

## 4. Плагины

- Регистрация — `pinia.use(plugin)`. Плагин получает `{ pinia, app, store, options }`. Применяется **только к store'ам, созданным после** `pinia.use` **и после** `app.use(pinia)` [D5].
- Лучше возвращать объект с новыми свойствами: devtools их отследит. Прямое присваивание `store.x = …` в dev требует ещё `store._customProperties.add('x')` [D5].
- Новый **state** плагин добавляет и в `store`, и в `store.$state`, иначе он не сериализуется при SSR и не виден в devtools. Канонический шаблон: `if (!Object.hasOwn(store.$state, 'k')) store.$state.k = ref(...)`, затем `store.k = toRef(store.$state, 'k')` — так значение с сервера не затирается [D5].
- Изменения state внутри плагина не вызывают подписчиков. `$reset` по умолчанию не трогает state, добавленный плагином [D5].
- Внешние объекты (router и т. п.) оборачивают в `markRaw` [D5].
- Типизация через module augmentation: `PiniaCustomProperties`, `PiniaCustomStateProperties<S>`, `DefineStoreOptionsBase<S, Store>`. Имена generic-параметров должны совпадать с исходниками [D5].
- В Nuxt плагин подключают через Nuxt-плагин: `defineNuxtPlugin(({ $pinia }) => { $pinia.use(MyPlugin) })` [D5].
- v4 выдаёт диагностику, если плагин вернул некорректное значение [R2].

## 5. HMR

- В обычном Vite-проекте `acceptHMRUpdate` подключают в каждом файле store вручную [D6]:

  ```ts
  if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useAuth, import.meta.hot))
  }
  ```

- Официально поддерживается только Vite; у webpack вместо этого `import.meta.webpackHot` [D6].
- **`@pinia/nuxt` в dev-режиме вставляет этот код сам.** Vite-плагин `pinia:auto-hmr-registration` находит файлы с `defineStore` без `acceptHMRUpdate` и дописывает блок за ними [S2][S6]. Docs об этом не пишут, факт взят из исходников.
- Исправления HMR в v4/4.1: сохраняются свойства, добавленные к ref'ам setup store во время работы, и состояние пустых placeholder-объектов [R2][R3].

## 6. Тестирование

### Unit-тесты store

```ts
beforeEach(() => { setActivePinia(createPinia()) }) // свежий pinia на каждый тест
```

Если нужны плагины, создают app и вызывают `app.use(pinia)`: плагины ждут установки pinia в приложение [D8].

### Компоненты: `createTestingPinia()` из `@pinia/testing`

Опции по исходникам v4.1.0 [S7]:

| опция | по умолчанию | смысл |
|---|---|---|
| `initialState` | `{}` | частичный state по id store'а, мержится после создания |
| `stubActions` | `true` | `true` — все actions заменяются шпионами и не выполняются; `false` — только шпионы; массив имён или функция `(name, store) => boolean` — выборочно |
| `stubPatch` / `stubReset` | `false` | `$patch` / `$reset` не меняют state |
| `fakeApp` | `false` | создаёт пустой app и вызывает `app.use(pinia)`, чтобы плагины сработали в unit-тесте store |
| `plugins` | — | плагины ставятся до testing-плагина; `testingPinia.use()` не использовать [D8] |
| `createSpy` | `jest.fn` / `vi.fn` при `globals: true` | иначе обязателен: `createSpy: vi.fn` (именно `vi.fn`, а не `vi.fn()` — передача результата вызова ловится проверкой) [S7] |

- Getters в тестах записываемые: `store.double = 3`, а присваивание `undefined` возвращает исходное вычисление [D8].
- Ограничение setup stores: action, который вызывает другой action через замыкание, обходит стаб. Обходной путь — вызывать через `useStore()` [D8].
- Для типов моков есть хелпер `mockedStore(useStore)` — обёртка с типом `Mock` [D8].
- Nuxt: тесты используют общий app и pinia, поэтому state может протекать между тестами. Рекомендация — выставлять нужный state через `$patch` или в `beforeEach` делать dispose всех store'ов и удалять их state [D10].

## 7. SSR и Nuxt

### Cross-request state pollution (утечка состояния между запросами)

- На сервере модули инициализируются один раз. Синглтон-state на уровне модуля общий для всех запросов, и данные одного пользователя могут утечь другому. Решение Vue — новый экземпляр приложения (router, stores) на каждый запрос, раздача через app-level `provide`. «State Management libraries like Pinia are designed with this in mind» [V1].
- Как это сделано в Pinia: store — не синглтон модуля. `defineStore` возвращает лишь функцию, а экземпляр живёт в `pinia._s` (Map) конкретного `pinia`, созданного `createPinia()` на каждый app [S3][S5]. `useStore()` берёт pinia через `inject` из текущего app, вне setup — через `activePinia` [D11][S3].
- Отсюда правила:
  - вне компонентов (router guards, middleware, другие store'ы) в SSR передавать pinia явно: `useStore(pinia)` [D11][D12];
  - в action все `useOtherStore()` вызывать **до первого `await`**, иначе после await можно получить чужой `activePinia` [D9];
  - `this.$pinia` доступен в `serverPrefetch`, а `onServerPrefetch()` ничего особого не требует [D12].
- В Nuxt есть своё правило: никогда не объявлять `const state = ref()` вне `setup` — «state shared across requests on the server … can lead to memory leaks». Альтернатива — `useState` или Pinia [N1].

### Гидратация (hydration)

- Без фреймворка: на сервере после рендера сериализовать `pinia.state.value` и **экранировать** (devalue; XSS, если state приходит от пользователя). Если state совместим с JSON, `JSON.stringify` / `JSON.parse` заметно быстрее. На клиенте `pinia.state.value = …` нужно выполнить **до** первого `useStore()` [D12].
- Механика: при создании store'а Pinia берёт `pinia.state.value[id]`. В options store `state()` тогда не вызывается; в setup store каждый ref, если `shouldHydrate(prop)`, получает значение из initialState [S3][D7].
- `skipHydrate(ref)` исключает state из гидратации — для client-only данных вроде `useLocalStorage`. Только для state. Для options store аналог — опция `hydrate(state, initialState)` [D7]. Не стоит возвращать из store несериализуемое (DOM-refs) [D7].
- В v4 `skipHydrate` учитывается и на не-plain объектах [R2].

### `@pinia/nuxt` — что делает модуль (по исходникам v4.1.0)

- Runtime-плагин: `createPinia()` → `vueApp.use(pinia)` → `setActivePinia(pinia)`. Если в `nuxtApp.payload.pinia` что-то есть, присваивает это в `pinia.state.value` (гидратация на клиенте). Pinia доступна как `$pinia` [S8].
- Хук `app:rendered` на сервере: `payload.pinia = toRaw(pinia).state.value`, затем `setActivePinia(undefined)` — «to avoid holding onto the variable», то есть против утечек между запросами [S8].
- Payload-плагин регистрирует reducer/reviver `skipHydrate`: помеченные данные вообще не уходят в payload [S8]. Payload сериализует сам Nuxt (devalue) [D12].
- Автоимпорты: `defineStore`, `acceptHMRUpdate`, `usePinia` (= `useNuxtApp().$pinia`), `storeToRefs`, плюс stores из `storesDirs`, по умолчанию `['stores']` относительно `app`-dir каждого слоя. Значит, в Nuxt 4 это `app/stores`, вложенные папки — только через glob `stores/**` [S2][D10]. 4.1.0 исправил разрешение `storesDirs` для layers [R3].
- Установка: `npx nuxi@latest module add pinia`; при ручной установке нужен `pinia @vue/devtools-api` (требование v4) [D10].
- Загрузка данных: `await callOnce('user', () => store.fetchUser())` выполняет запрос один раз (на сервере), а результат уходит на клиент вместе с state. Возвращать значение не нужно, данные уже в store. `{ mode: 'navigation' }` — перезапуск на каждой навигации [D10][N1].

## 8. Pinia vs Vuex

По [D13] и [V2]:

- Нет мутаций (их считали слишком многословными), только actions, в том числе асинхронные.
- TypeScript через вывод типов, без обёрток; нет «magic strings» (`commit('ns/TYPE')`) — импортируешь и вызываешь функцию.
- Нет вложенных модулей и namespacing: store'ы плоские, namespace задаёт id; store'ы динамические по умолчанию (не нужен `registerModule`); можно использовать один store в другом, циклы допустимы.
- Devtools: timeline, time travel; HMR с сохранением state; плагины; SSR из коробки.
- История: Pinia появилась в конце 2019 как прототип Vuex 5 на Composition API; позже её сделали официальной рекомендацией вместо Vuex 5. Vuex 3/4 поддерживаются без новых функций [D13][V2].
- Почему не просто `export const state = reactive({})`: в SSR это открывает уязвимость (утечка между запросами), и к тому же нет devtools, плагинов, тестовых утилит [D13][V1].

## 9. Что вероятно спросят на senior-интервью

1. **Options vs setup store: что выбрать и почему?** Setup — composables, watchers, `inject`, гибкость. Цена: нет встроенного `$reset`, нужно возвращать весь state, actions зовут друг друга через замыкание (неудобно стабить в тестах).
2. **Почему деструктуризация store ломает реактивность и чем `storeToRefs` отличается от `toRefs`?**
3. **Как Pinia избегает cross-request state pollution?** pinia на каждый app, Map store'ов внутри pinia, `inject` / `activePinia`, `useStore(pinia)` вне setup, `useStore` до `await`, `setActivePinia(undefined)` после рендера в Nuxt.
4. **Как работает гидратация state?** `pinia.state.value` → payload (devalue, экранирование против XSS) → клиент присваивает до `useStore`; `skipHydrate` / `hydrate` для client-only state.
5. **`$patch` объектом vs функцией; почему нельзя `store.$state = …`?**
6. **`$subscribe` vs `watch`; что такое `flush: 'sync'` и `detached`?**
7. **`$onAction`: порядок `after` / `onError` для async-actions; как сделать логирование или ретраи?**
8. **Как написать плагин, добавляющий state (персистентность), чтобы он работал с SSR и devtools?** (`$state` + `toRef` + `Object.hasOwn`)
9. **Как тестировать компонент со store?** `createTestingPinia`, `stubActions`, моки getters, `createSpy`; ограничение setup stores.
10. **Pinia vs Vuex** — что убрали и почему; **Pinia vs `useState` в Nuxt** — когда хватает `useState` (простой ключ-значение, сериализуемый в JSON) и когда нужен store (actions, getters, devtools, плагины).
11. **Циклические зависимости store'ов**: что разрешено, что приведёт к бесконечному циклу.
12. **Что нового в Pinia 3/4?** Vue 2 убран, ESM-only, devtools-api v8 как peer, `getStores()`.

## Пробелы / открытые вопросы

- Страница docs про HMR не говорит, что в Nuxt HMR регистрируется автоматически; это утверждение взято только из исходников `@pinia/nuxt` [S6].
- На странице SSR в Pinia нет термина «cross-request state pollution»; формулировка — из vuejs.org [V1], а механизм восстановлен по исходникам [S3][S8].
- Опции `stubPatch` / `stubReset` / `fakeApp` описаны в JSDoc исходников, в cookbook не раскрыты [S7].
- В документации Pinia 4 не найдено описание Options API хелперов (`mapStores`, `mapState`, `mapActions`) на текущей версии; для библиотеки их хватит кратко, «для сравнения».

## Источники

**Релизы и исходники (vuejs/pinia)**
- [R1] Список релизов: https://github.com/vuejs/pinia/releases
- [R2] v4.0.0: https://github.com/vuejs/pinia/releases/tag/v4.0.0
- [R3] v4.1.0: https://github.com/vuejs/pinia/releases/tag/v4.1.0
- [R4] v3.0.0: https://github.com/vuejs/pinia/releases/tag/v3.0.0 (+ migration guide https://pinia.vuejs.org/cookbook/migration-v2-v3.html)
- [S1] https://github.com/vuejs/pinia/blob/v4.1.0/packages/pinia/package.json
- [S2] https://github.com/vuejs/pinia/blob/v4.1.0/packages/nuxt/src/module.ts
- [S3] https://github.com/vuejs/pinia/blob/v4.1.0/packages/pinia/src/store.ts
- [S4] https://github.com/vuejs/pinia/blob/v4.1.0/packages/pinia/src/storeToRefs.ts
- [S5] https://github.com/vuejs/pinia/blob/v4.1.0/packages/pinia/src/rootStore.ts
- [S6] https://github.com/vuejs/pinia/blob/v4.1.0/packages/nuxt/src/auto-hmr-plugin.ts
- [S7] https://github.com/vuejs/pinia/blob/v4.1.0/packages/testing/src/testing.ts
- [S8] https://github.com/vuejs/pinia/tree/v4.1.0/packages/nuxt/src/runtime (`plugin.ts`, `payload-plugin.ts`, `composables.ts`)

**Документация Pinia**
- [D1] https://pinia.vuejs.org/core-concepts/
- [D2] https://pinia.vuejs.org/core-concepts/state.html
- [D3] https://pinia.vuejs.org/core-concepts/getters.html
- [D4] https://pinia.vuejs.org/core-concepts/actions.html
- [D5] https://pinia.vuejs.org/core-concepts/plugins.html
- [D6] https://pinia.vuejs.org/cookbook/hot-module-replacement.html
- [D7] https://pinia.vuejs.org/cookbook/composables.html
- [D8] https://pinia.vuejs.org/cookbook/testing.html
- [D9] https://pinia.vuejs.org/cookbook/composing-stores.html
- [D10] https://pinia.vuejs.org/ssr/nuxt.html
- [D11] https://pinia.vuejs.org/core-concepts/outside-component-usage.html
- [D12] https://pinia.vuejs.org/ssr/
- [D13] https://pinia.vuejs.org/introduction.html

**Vue / Vuex / Nuxt**
- [V1] https://vuejs.org/guide/scaling-up/ssr.html#cross-request-state-pollution
- [V2] https://vuex.vuejs.org/
- [N1] https://nuxt.com/docs/4.x/getting-started/state-management
