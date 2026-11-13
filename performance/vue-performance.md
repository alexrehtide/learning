---
title: Производительность Vue и Nuxt
level: ядро
---

# Производительность Vue и Nuxt

> **Коротко.** Во Vue единица обновления — компонент. Изменение состояния перезапускает рендер тех компонентов, которые его читали, а дальше компилятор сужает сравнение до динамических узлов (patch flags, block tree). Работы становится меньше, когда меньше компонентов перерисовывается (стабильные props, стабильные значения `computed`, `v-memo`) и когда реактивности меньше (`shallowRef`, `markRaw`). В Nuxt главная стоимость — загрузка и гидрация. Её снижают маленьким payload (`pick`/`transform`), ленивыми компонентами, отложенной гидрацией (`hydrate-on-*`) и server components.

**Связанные темы:** [Конвейер рендеринга: layout, paint, composite](../browser/rendering-pipeline.md), [Дескрипторы свойств, Proxy и Reflect](../javascript/property-descriptors-and-proxy.md), [Функциональные приёмы и иммутабельность](../javascript/functional-programming.md), [Core Web Vitals и измерение](./web-vitals.md), [Оптимизация загрузки](./loading.md), [Оптимизация runtime и профилирование](./runtime.md), [Утечки памяти](./memory-leaks.md), [HTTP-кэширование и CDN](../network/caching.md)

## Теория

Все проверки в теме — на Vue 3.5.45 (компилятор `@vue/compiler-dom` в режиме SFC, рендер в jsdom) и исходниках Nuxt 4.6.4.

### Откуда берётся работа

Реактивность и VDOM подробно разбираются в разделе «Vue». Здесь нужна только модель стоимости.

1. У каждого экземпляра компонента есть **render effect**. Во время рендера он подписывается на всё реактивное, что прочитал.
2. Запись в реактивное состояние ставит затронутые эффекты в очередь. Vue выполняет очередь одной микрозадачей, родители раньше детей.
3. Рендер возвращает новое дерево vnode. `patch` сравнивает его со старым и трогает DOM только там, где есть различия.
4. Дочерний компонент при этом перерисовывается, только если `shouldUpdateComponent` решит, что изменились его props или слоты.

Стоимость обновления примерно равна сумме по перерисованным компонентам: рендер плюс сравнение их деревьев. Отсюда два рычага: **меньше компонентов** перерисовывается и **дешевле каждый** рендер. Весь flush — одна задача, поэтому разбить его через yield нельзя ([подробнее](./runtime.md#vue-и-nuxt-где-рождаются-долгие-задачи)).

### Что делает компилятор

Шаблон, в отличие от render-функции, анализируется статически. Компилятор знает, какие части никогда не меняются, и передаёт эти знания рантайму.

| Оптимизация | Что делает | Как выглядит в выводе 3.5.45 |
| --- | --- | --- |
| Кэширование статики | Статический узел создаётся один раз на экземпляр и переиспользуется. При сравнении он пропускается целиком | `_cache[2] \|\| (_cache[2] = _createElementVNode("h1", null, "Title", -1 /* CACHED */))` |
| Строковая статика | Длинный статический фрагмент превращается в строку HTML и вставляется через `innerHTML` | `_createStaticVNode("<ul><li>…</li>…</ul>", 1)` при ≥ 20 узлах или ≥ 5 элементах с атрибутами подряд |
| Patch flags | У динамического узла число-битовая маска: что именно в нём может меняться | `3 /* TEXT, CLASS */`, `8 /* PROPS */, ["fn"]` |
| Block tree | Корень блока собирает плоский массив `dynamicChildren`. Сравнение идёт по этому массиву, а не по всему дереву | `_openBlock(), _createElementBlock(...)` |
| Кэш обработчиков | Inline-обработчик `@click="count++"` создаётся один раз, поэтому ребёнку не передаётся новая функция | `onClick: _cache[0] \|\| (_cache[0] = $event => (_ctx.count++))` |

**Block tree.** Сравнение обходит не дерево, а только динамических потомков блока. Структура блока должна быть стабильна, поэтому `v-if`/`v-else` и `v-for` открывают **новый** блок: каждая ветка `v-if` и фрагмент `v-for` — отдельный блок со своим `dynamicChildren`. Шаблон из 200 узлов с двумя интерполяциями сравнивается за две операции.

> [!NOTE]
> Во Vue 3.4 и раньше статика **поднималась** (hoisting) в константы модуля: `const _hoisted_1 = _createElementVNode(...)`. Во Vue 3.5 это заменено кэшированием на экземпляр (`compiler-core: change node hoisting to caching per instance`, #11067, 3.5.0-alpha.3). Общий vnode на все экземпляры приводил к багам: в нём оставалась ссылка `el` на DOM. В константы модуля теперь поднимаются только объекты props (`const _hoisted_1 = { key: 0 }`) и массивы имён динамических props. На интервью оба названия встречаются, а суть одна: статику не создают и не сравнивают повторно.

**Как сломать оптимизации:**

- **Render-функции и JSX без компилятора Vue.** У `h()` нет patch flags, поэтому сравнивается всё. Для детей с ручными слотами Vue в этом режиме перерисовывает ребёнка при каждом рендере родителя (слоты без `$stable`).
- **`v-bind="obj"`** даёт флаг `FULL_PROPS`: props сравниваются по всем ключам.
- **Динамические слоты** (`v-if` или `v-for` на `<template #slot>`, вычисляемое имя слота) дают флаг `DYNAMIC_SLOTS`. Такой ребёнок перерисовывается при **каждом** рендере родителя, даже если ничего не изменилось. Это проверено: компонент со слотом `<template v-if="flag" #default>` перерисовывался на любое обновление родителя.

> [!WARNING]
> Шаблон, скомпилированный **в браузере** (`template: '...'` с полной сборкой Vue), оптимизирован хуже, чем SFC. Без `prefixIdentifiers` компилятор не знает, какие идентификаторы — переменные. Например, `:opts="{ a: 1 }"` в SFC считается константой и в `dynamicProps` не попадает, а в рантайм-компиляции получает `8 /* PROPS */, ["opts"]` и перерисовывает ребёнка на каждый рендер родителя. Бенчмарки делают на SFC-сборке.

### Стабильность props

Если у ребёнка есть `PROPS`, рантайм сравнивает только динамические props из списка `dynamicProps` и сравнивает их по ссылке (`!==`). Новая ссылка с тем же содержимым — это изменение. Что показал эксперимент: родитель перерисовался, дочерние компоненты считают свои рендеры.

| Как передан prop | Ребёнок перерисовался? | Почему |
| --- | --- | --- |
| `:val="base"`, `base` не менялся | нет | то же значение |
| `:opts="{ a: 1 }"` | нет | константа, не попадает в `dynamicProps` |
| `:opts="{ a: base }"` | **да** | новый объект на каждый рендер |
| `:fn="() => go()"` | **да** | prop, а не `v-on`: функция не кэшируется |
| `@select="(id) => go(id)"` | нет | `v-on` кэшируется в `_cache` |
| слот <code v-pre>{{ tick }}</code>, изменился `tick` | да | слот выполняется в рендере ребёнка, его зависимости — зависимости ребёнка |
| слот `static text` | нет | слот скомпилирован как стабильный (`_: 1 /* STABLE */`) |

Главный приём из гайда Vue — **передавать ребёнку уже вычисленное значение**. Список из 10 строк с `:active-id="activeId"` при смене `activeId` перерисовал все 10 строк. С `:active="item.id === activeId"` перерисовались две: та, что потеряла выделение, и та, что его получила.

### `v-once` и `v-memo`

- **`v-once`** рендерит поддерево один раз. Компилятор кладёт его в `_cache` и выключает для него трекинг блока (`setBlockTracking(-1)`), поэтому дальше оно не обновляется никогда. Подходит для действительно неизменного контента: текст условий, тяжёлая разметка из CMS.
- **`v-memo="[a, b]"`** пропускает рендер и сравнение поддерева, пока все значения массива равны прежним (`isMemoSame`). Внутри `v-for` компилятор проверяет ещё и ключ: `_cached.key === it.id`. Пустой массив `v-memo="[]"` работает как `v-once`.

Ловушка `v-memo`: в массив должно попасть всё, от чего зависит поддерево. Пропущенная зависимость не даст поддереву обновиться, и это баг, а не оптимизация. Гайд Vue рекомендует `v-memo` для редких случаев: списки более 1000 элементов (`v-for` и `v-memo` на одном элементе). Сначала стоит проверить стабильность props: часто её хватает.

### Стабильность `computed`

С Vue 3.4 `computed` уведомляет подписчиков, только если **новое значение отличается** от прежнего (`hasChanged`, то есть `Object.is`). Для примитивов это работает само: `computed(() => n.value % 2)` при смене `n` с 1 на 3 эффекты не запускает. Объект же новый при каждом вычислении:

```ts
const n = ref(1);
const parity = computed(() => ({ odd: n.value % 2 === 1 })); // new object every time
watchEffect(() => console.log(parity.value)); // runs on 1 → 3 although odd is still true
```

Решение из гайда Vue — геттер получает прежнее значение аргументом и возвращает его, если ничего не изменилось. Аргумент `oldValue` появился в 3.4.0 (`reactivity: expose last result for computed getter`, #9497).

```ts
const parity = computed((old) => {
  const next = { odd: n.value % 2 === 1 };
  return old && old.odd === next.odd ? old : next; // same reference → no trigger
});
```

Проверено: в первом варианте эффект перезапустился, во втором — нет. Сравнение внутри геттера должно быть дешевле пересчёта у подписчиков, иначе выигрыша нет.

### Большие данные: меньше реактивности

`reactive` и глубокий `ref` оборачивают в прокси каждый вложенный объект при чтении и хранят по записи зависимости на каждое прочитанное свойство. Массив из 50 тысяч строк таблицы — это до 50 тысяч прокси и сотни тысяч зависимостей, созданных при первом рендере.

| Инструмент | Что делает | Когда |
| --- | --- | --- |
| `shallowRef` | Реактивна только замена `.value`. Мутация `big.value[0].a = 2` эффекты не запускает (проверено) | данные с сервера, которые заменяют целиком; иммутабельные обновления |
| `shallowReactive` | Реактивны только ключи верхнего уровня | объект-контейнер с тяжёлыми значениями |
| `markRaw(obj)` | Объект никогда не станет прокси (флаг `__v_skip`), даже внутри `reactive` | экземпляры сторонних классов: карта, график, SDK-клиент |
| `triggerRef(ref)` | Вручную уведомить подписчиков `shallowRef` после мутации | когда копировать большой массив дорого |

Иммутабельный стиль хорошо сочетается с `shallowRef`: обновление заменяет объект, а structural sharing делает замену дешёвой ([подробнее](../javascript/functional-programming.md)). Кроме того, огромный DOM не лечится реактивностью. 10 тысяч строк в DOM дороги для layout и памяти, поэтому длинные списки **виртуализируют**: рендерят только видимые строки (`vue-virtual-scroller`, `@tanstack/vue-virtual`, `useVirtualList` из VueUse).

> [!TIP]
> Лишние абстракции тоже стоят денег. Экземпляр компонента дороже узла DOM. Гайд Vue советует не дробить на компоненты элементы большого списка без необходимости: 100 строк по 3 вложенных компонента — это 300 экземпляров с effect, props и слотами.

### `KeepAlive`, асинхронные компоненты и ленивая гидрация

- **`<KeepAlive>`** не размонтирует скрытый компонент, а переносит его DOM в отсоединённый контейнер. Возврат на вкладку дешёвый: нет `setup`, нет запросов, сохранено состояние. Цена — память. Проп `max` включает LRU-вытеснение, `include`/`exclude` ограничивают круг компонентов. Хуки — `onActivated`/`onDeactivated`: там ставят на паузу таймеры и подписки.
- **`defineAsyncComponent(() => import('./Chart.vue'))`** выносит компонент в отдельный чанк, который грузится при первом рендере. Опции `loadingComponent`, `errorComponent`, `delay`, `timeout`.
- **Ленивая гидрация (3.5)**: `defineAsyncComponent({ loader, hydrate: hydrateOnVisible() })`. При SSR HTML компонента приходит сразу, а его код грузится и гидрируется по стратегии: `hydrateOnIdle(timeout)`, `hydrateOnVisible(intersectionOptions)`, `hydrateOnMediaQuery(query)`, `hydrateOnInteraction(events)` или своя функция `HydrationStrategy`. `hydrateOnInteraction` после гидрации повторно воспроизводит событие, которое её вызвало, поэтому первый клик не теряется. Без SSR опция `hydrate` ничего не меняет: компонент просто асинхронный.

### Профилирование

1. **Vue DevTools** (расширение или `vite-plugin-vue-devtools`): дерево компонентов, Timeline с событиями рендера и патча по компонентам. Это первый способ увидеть, **какие** компоненты перерисовываются на действие.
2. **`app.config.performance = true`** ставит `performance.mark`/`measure` на инициализацию, рендер и патч каждого компонента. Они видны в дорожке Timings панели Performance в Chrome. Работает только в dev-сборке.
3. **`onRenderTriggered(e)`** и `onRenderTracked` (только dev) показывают, какая зависимость (`e.target`, `e.key`, `e.type`) запустила рендер. Опции `onTrack`/`onTrigger` есть у `computed` и watcher'ов.
4. **Панель Performance** в production-сборке — для финальных цифр: длинные задачи, INP, время скрипта ([подробнее](./runtime.md)). Dev-сборка Vue заметно медленнее из-за проверок и devtools-хуков, поэтому мерить по ней бессмысленно.

### Nuxt: payload и загрузка данных

При SSR страница рендерится на сервере, а клиент **гидрирует** её: выполняет тот же код и привязывает его к готовому DOM. Чтобы клиент не повторял запросы, `useFetch`/`useAsyncData` кладут результат в **payload**. Это `<script type="application/json" id="__NUXT_DATA__">` внутри HTML, сериализованный `devalue` (умеет `Date`, `Map`, `Set`, `ref`, циклы). При клиентской навигации на пререндеренные и `swr`/`isr`-маршруты payload приходит файлом `_payload.json`.

Payload — часть HTML: каждый лишний килобайт откладывает разбор документа, а его разбор и оживление идут на главном потоке до гидрации. Что влияет на размер и время:

| Опция | Что делает | Эффект |
| --- | --- | --- |
| `pick: ['id', 'title']` | оставить только нужные ключи | В исходниках 4.6.4 `transform` и `pick` применяются к результату **до** записи в `nuxtApp.payload.data[key]`, поэтому в payload уходит уже урезанный объект |
| `transform: (r) => r.items.map(...)` | преобразовать ответ | то же: тяжёлые поля не сериализуются |
| `lazy: true` | не блокировать навигацию на клиенте | страница показывается сразу, данные приходят позже: нужен `status === 'pending'` |
| `server: false` | запрос только на клиенте после гидрации | данные не попадают в HTML и payload. Для персональных и не нужных для SEO блоков |
| `deep` (по умолчанию `false`) | `data` — `shallowRef` | в Nuxt 4 глубокая реактивность выключена по умолчанию ради производительности ([подробнее](https://github.com/alexrehtide/learning/blob/research/nuxt-3-vs-4/research/nuxt-3-vs-4.md)) |
| `serialize: false` (4.6) | не класть результат в payload | клиент перезапросит данные после гидрации, если компонент их отрисует |

> [!NOTE]
> В Nuxt 3 было иначе: `data` был глубоким `ref`, а пустое значение было `null`, а не `undefined`. Миграционный баг — мутация вложенного поля `data.value.user.name = …`, после которой экран в Nuxt 4 не обновляется.

`$fetch` в `setup()` выполняется дважды: на сервере и снова на клиенте при гидрации. Его используют для запросов по событиям, а для данных страницы — `useFetch`/`useAsyncData`.

### Nuxt: ленивые компоненты, отложенная гидрация, islands

- **Префикс `Lazy`** (`<LazyCommentList v-if="open" />`) выносит компонент в отдельный чанк и грузит его при первом рендере.
- **Отложенная гидрация** (с Nuxt 3.16): `hydrate-on-visible`, `hydrate-on-idle`, `hydrate-on-interaction`, `hydrate-on-media-query`, `hydrate-after="2000"`, `:hydrate-when="ready"`, `hydrate-never`, событие `@hydrated`. В исходниках 4.6.4 это обёртка над `defineAsyncComponent({ hydrate })` из Vue 3.5. Ограничения из документации: только в SFC, проп пишется в шаблоне явно (не через `v-bind="obj"`), не работает с прямым импортом из `#components`. **Изменение любого пропа сразу запускает гидрацию**, поэтому общий `v-model` может разбудить все связанные компоненты. Первый экран откладывать нельзя: пользователь кликнет по «мёртвому» HTML.
- **Server components** (`Foo.server.vue`) рендерятся только на сервере, их код и зависимости (парсер markdown, подсветка синтаксиса) в клиентский бандл не попадают. Отдельно стоящий server component — **island**: при смене его props клиент делает запрос и заменяет HTML на месте. Должен быть один корневой элемент. Флаг `experimental.componentIslands` в 4.6.4 по умолчанию `'auto'`: islands включаются, если в проекте есть `.server.vue`. С `experimental.componentIslands: { selectiveClient: true }` внутри island можно оставить интерактивный кусок атрибутом `nuxt-client`.
- **`.client.vue`** и `<ClientOnly>` не рендерятся на сервере: меньше работы при SSR, но в HTML этого блока нет, и для первого экрана это ухудшает LCP и CLS.
- **Кэш маршрутов** (`routeRules` со `swr`/`isr`/`prerender`) снимает стоимость SSR на каждый запрос ([подробнее](../network/caching.md)).

> [!WARNING]
> `hydrate-never` с `useFetch` внутри всё равно кладёт данные в payload, хотя на клиенте они не понадобятся. В 4.6.4 это лечит флаг `experimental.stripNeverHydratedData` (по умолчанию `false`): данные внутри `hydrate-never` не сериализуются, если `serialize` не задан явно.

### Vapor Mode

> [!NOTE]
> Во Vue 3.6 (RC, `3.6.0-rc.15`, сверено 2026-11-12) появляется **Vapor Mode**: `<script setup vapor>` компилируется без VDOM. Шаблон клонируется из `<template>`-строки, а каждая динамическая привязка становится точечным эффектом: `renderEffect(() => setText(x0, msg.value))`. Нет рендера компонента и сравнения деревьев, поэтому стоимость обновления пропорциональна числу изменившихся привязок, а не размеру компонента. В Vapor не поддерживаются Options API, `getCurrentInstance()` и `v-memo`: на `v-memo` компилятор 3.6.0-rc.15 выдаёт предупреждение «not supported in Vapor mode and will be ignored». Команда Vue рекомендует Vapor для отдельных критичных по производительности страниц и для новых небольших приложений. В стабильной версии его пока нет.

## Примеры

Список, где при выборе строки перерисовываются две строки, а не все:

```vue
<script setup lang="ts">
const props = defineProps<{ rows: Row[] }>();
const selectedId = ref<number | null>(null);
</script>

<template>
  <!-- active is computed in the parent: only rows whose boolean changed update -->
  <TableRow
    v-for="row in props.rows"
    :key="row.id"
    :row="row"
    :active="row.id === selectedId"
    @select="selectedId = row.id"
  />
</template>
```

Данные страницы, урезанные до того, что реально рендерится:

```ts
// app/pages/products/index.vue
const { data: products, status } = await useFetch('/api/products', {
  // runs on the server before the payload is written: only these fields reach the HTML
  transform: (res: ProductsResponse) =>
    res.items.map(({ id, title, price }) => ({ id, title, price })),
  lazy: true, // do not block client-side navigation
});
const { data: recommendations } = useFetch('/api/recommendations', {
  server: false, // personal, not needed for SEO: keep it out of HTML and payload
});
```

Тяжёлый блок ниже первого экрана: HTML с сервера сразу, JS — когда блок доскроллили:

```vue
<template>
  <ProductGallery :images="product.images" />
  <LazyReviewsSection hydrate-on-visible :product-id="product.id" @hydrated="trackReviews" />
  <LazyFooterMap hydrate-on-interaction="pointerenter" />
</template>
```

## Вопросы с интервью

::: details Когда во Vue перерисовывается дочерний компонент
Когда изменилось реактивное состояние, которое он сам прочитал в рендере, или когда родитель перерисовался и `shouldUpdateComponent` нашёл изменения в props или слотах. Props из `dynamicProps` сравниваются по ссылке, поэтому объект или функция, созданные в шаблоне (`:opts="{ a: x }"`, `:fn="() => go()"`), меняются при каждом рендере родителя и тянут за собой ребёнка. Inline-обработчики `@event` компилятор кэширует, константные литералы в SFC в сравнение не попадают. Ребёнок с динамическими слотами (`v-if` на `<template #slot>`) перерисовывается всегда. Приём — передавать вычисленное значение (`:active="id === activeId"`, а не `:active-id`) и выносить объекты в `computed` или константы.
:::

::: details Что такое patch flags и block tree и зачем они нужны
Это оптимизации компилятора, которые сужают сравнение VDOM до заведомо динамических мест. Patch flag — битовая маска на vnode: `TEXT`, `CLASS`, `STYLE`, `PROPS` со списком имён, `FULL_PROPS` и т. п. Рантайм сравнивает только то, что указано во флаге. Block — узел, собирающий плоский массив `dynamicChildren` из всех динамических потомков. Сравнение идёт по этому массиву, статические поддеревья не обходятся вообще. Структурные директивы `v-if` и `v-for` открывают новые блоки, потому что внутри них меняется сама структура. Добавьте кэширование статики (в 3.5 — в `_cache` экземпляра, раньше — hoisting в модуль) и кэш обработчиков. Итог: стоимость обновления зависит от числа динамических привязок, а не от размера шаблона. Render-функции и JSX без компилятора Vue этого лишены.
:::

::: details Чем отличаются v-once, v-memo и computed
`v-once` — поддерево рендерится один раз и больше не обновляется никогда. `v-memo="[deps]"` — рендер и сравнение поддерева пропускаются, пока зависимости равны прежним. Это мемоизация **рендера** с ручным списком зависимостей: пропущенная зависимость даёт баг «не обновляется». Применяют точечно, обычно на `v-for` больших списков. `computed` мемоизирует **значение**, а зависимости отслеживает автоматически. С 3.4 он не будит подписчиков, если новое значение равно старому по `Object.is`. Для объектов это работает только через возврат `oldValue` из геттера.
:::

::: details Когда использовать shallowRef и когда markRaw
`shallowRef` — когда данные большие и заменяются целиком: ответ API, иммутабельные обновления, состояние внешней библиотеки (Immer, XState). Реактивна только замена `.value`, вложенные объекты остаются обычными, без прокси и зависимостей. `markRaw` — когда объект вообще не должен становиться реактивным, даже попав внутрь `reactive`: экземпляры классов карт, графиков, SDK, у которых свои мутации, приватные поля `#x` и ссылки на DOM. Ловушка `shallowRef`: мутация внутри не обновит экран, нужна замена или `triggerRef`. Ловушка `markRaw`: флаг ставится на сам объект, а его вложенные объекты, вынутые и положенные в `reactive` отдельно, станут прокси.
:::

::: details Чем ленивая гидрация отличается от ленивого компонента
Ленивый компонент (`defineAsyncComponent`, префикс `Lazy`) откладывает **загрузку кода** до первого рендера. При SSR компонент отрендерен сразу, поэтому код тоже нужен сразу. Ленивая гидрация откладывает **загрузку кода и гидрацию** уже отрендеренного на сервере HTML до наступления условия: видимость, простой, взаимодействие, медиазапрос. Пользователь видит контент сразу (LCP не страдает), а главный поток при загрузке свободнее (лучше TBT и INP первых кликов). Цена: до гидрации блок не интерактивен. Поэтому `hydrateOnInteraction` воспроизводит событие-триггер. Первый экран так не откладывают.
:::

::: details Что попадает в payload Nuxt и как его уменьшить
Результаты `useFetch`/`useAsyncData` (после `transform` и `pick`), состояние `useState` и Pinia, ошибки. Всё это сериализуется `devalue` в `<script id="__NUXT_DATA__">` внутри HTML или в `_payload.json` для пререндеренных маршрутов. Payload увеличивает HTML, а его разбор и оживление стоят времени главного потока до гидрации. Уменьшают его так: `pick`/`transform` до нужных полей, `server: false` для персональных и не SEO-данных, `serialize: false`, не хранить в `useState` и сторе производные и огромные данные, `hydrate-never` или server components для статичных блоков. Проверяют в Nuxt DevTools (вкладка Payload) или по размеру `__NUXT_DATA__` в HTML.
:::

::: details Как найти причину лишних перерисовок
1. Воспроизвести действие и посмотреть Timeline в Vue DevTools: какие компоненты перерисовались и сколько раз.
2. В подозрительном компоненте добавить `onRenderTriggered((e) => console.log(e.key, e.type, e.target))`: видно, какая зависимость запустила рендер. Если рендер запустил родитель, событий не будет: значит, виноваты props или слоты.
3. Проверить props: новые объекты и функции в шаблоне, `v-bind="obj"`, динамические слоты, общий prop вроде `activeId` на каждый элемент списка.
4. Финальные цифры снимать в production-сборке панелью Performance: dev-сборка искажает время.
:::

::: details Что такое Vapor Mode и почему он быстрее
Режим компиляции Vue 3.6 (на 2026-11-12 — RC), в котором нет VDOM. Шаблон клонируется из статической HTML-строки, а каждая динамическая привязка компилируется в отдельный эффект, который точечно обновляет свой узел. Нет рендер-функции компонента, создания vnode и сравнения деревьев, меньше рантайм в бандле (`createVaporApp`). Это та же идея, что у Solid и Svelte 5, на той же реактивности Vue (в 3.6 переписанной по alien-signals). Ограничения: только `<script setup>`, нет Options API, `getCurrentInstance()` и `v-memo`, а с VDOM-компонентами он смешивается через `vaporInteropPlugin`. Ответ senior: знать модель и статус, а не мигрировать production на RC.
:::

## Задачи

### 1. Лишние перерисовки · легко

Список из 500 карточек тормозит, когда пользователь выбирает карточку или печатает в поиске (`query` живёт в этом же компоненте). Найдите причины лишних перерисовок `ProductCard` и исправьте.

```vue
<template>
  <input v-model="query" />
  <ProductCard
    v-for="p in filtered"
    :key="p.id"
    :product="p"
    :selected-id="selectedId"
    :style="{ order: p.rank }"
    :format-price="(v) => formatPrice(v, currency)"
    @click="selectedId = p.id"
  />
</template>
```

::: details Решение и разбор
Каждая буква в `query` перерисовывает родителя, а вместе с ним все 500 карточек, хотя у них ничего не изменилось:

- `:selected-id="selectedId"` — общий prop: при смене выделения меняется у всех 500. Нужен `:selected="p.id === selectedId"`, тогда обновятся две карточки.
- `:style="{ order: p.rank }"` — новый объект на каждый рендер родителя. Передать число `:rank="p.rank"` и ставить стиль внутри карточки.
- `:format-price="(v) => …"` — prop-функция, её компилятор не кэширует. Передать `currency` (примитив), а форматирование делать в карточке или передать заранее отформатированную строку.
- `@click` трогать не нужно: обработчики `v-on` кэшируются.

```vue
<ProductCard
  v-for="p in filtered"
  :key="p.id"
  :product="p"
  :selected="p.id === selectedId"
  :rank="p.rank"
  :currency="currency"
  @click="selectedId = p.id"
/>
```

`:product="p"` стабилен, пока `filtered` возвращает те же объекты, а `filter` их не копирует. Если в `filtered` есть `map(p => ({ ...p }))`, ссылки новые при каждом пересчёте, и все карточки снова перерисуются. Поле ввода лучше вынести в свой компонент: тогда ввод вообще не перерисовывает родителя, пока не изменится результат фильтрации.
:::

### 2. computed, который будит всех · средне

Компонент показывает панель «Есть несохранённые изменения». При каждом нажатии клавиши в форме перезапускается дорогой `watch` с сохранением черновика, хотя флаги не меняются. Объясните и исправьте, не меняя форму данных.

```ts
const form = reactive({ title: '', body: '', tags: [] as string[] });
const saved = shallowRef({ title: '', body: '', tags: [] as string[] });

const status = computed(() => ({
  dirty: JSON.stringify(form) !== JSON.stringify(saved.value),
  valid: form.title.length > 0,
}));

watch(status, (s) => { if (s.dirty && s.valid) saveDraft(form); });
```

::: details Решение и разбор
`computed` зависит от всех полей `form` (их читает `JSON.stringify`) и при каждом пересчёте возвращает **новый** объект. Начиная с 3.4 подписчик не уведомляется только при `Object.is(old, new)`, а два разных объекта не равны. Поэтому `watch` срабатывает на каждую клавишу, даже когда `dirty` и `valid` прежние.

```ts
const status = computed((old) => {
  const next = {
    dirty: JSON.stringify(form) !== JSON.stringify(saved.value),
    valid: form.title.length > 0,
  };
  return old && old.dirty === next.dirty && old.valid === next.valid ? old : next;
});
```

Альтернативы: два отдельных примитивных `computed` (`dirty`, `valid`) или `watch([() => status.value.dirty, () => status.value.valid], ...)` — массив источников `watch` сравнивает поэлементно (все четыре варианта проверены на Vue 3.5.45). Геттер `() => [a, b]` не подойдёт: он каждый раз возвращает новый массив, и watcher сработает снова. Обратите внимание: само `JSON.stringify` при каждом вводе остаётся, и на большой форме это тоже дорого. Флаг `dirty` можно ставить в обработчике ввода и сбрасывать при сохранении. А сохранение черновика по каждой смене стоит обернуть в [debounce](../live-coding/debounce-throttle.md).

Сложность: O(размер формы) на каждый ввод из-за сериализации, и это отдельная проблема от лишних срабатываний.
:::

### 3. Таблица на 20 000 строк · средне

Экран журнала: 20 000 записей с сервера, сортировка и фильтр на клиенте, строки только читаются. Первый рендер — 4 с, сортировка — 1,5 с, память вкладки — 600 МБ.

```ts
const rows = ref<LogEntry[]>([]);
onMounted(async () => { rows.value = await api.getLogs(); });
const sorted = computed(() => [...rows.value].sort(byDate));
```

```vue
<LogRow v-for="r in sorted" :key="r.id" :entry="r" />
```

Предложите план по шагам и объясните, что даёт каждый шаг.

::: details Решение и разбор
1. **`shallowRef` вместо `ref`.** Сейчас каждая из 20 000 записей и её вложенные объекты при чтении становятся прокси, а каждое прочитанное поле — зависимостью рендера. Данные только читаются и заменяются целиком, поэтому глубокая реактивность не нужна. Сортировка тоже ускорится: компаратор читает поля сырых объектов, а не прокси.
2. **Виртуализация.** Рендерить 30–50 видимых строк, а не 20 000. Это главный выигрыш: меньше экземпляров компонентов, узлов DOM, layout и памяти. Нужна фиксированная или измеряемая высота строки.
3. **Без лишних компонентов.** Если `LogRow` — простой шаблон, сделать строку элементом внутри родителя или функциональным компонентом: экземпляр компонента дороже узла.
4. **Сортировка и фильтр.** Отложить пересчёт при вводе в фильтр ([debounce](../live-coding/debounce-throttle.md)), а очень тяжёлую сортировку вынести в Web Worker. Для строк, которые только читаются, `v-memo="[r.id === selectedId]"` пропускает рендер при смене выделения.
5. **Измерить.** Vue DevTools — сколько компонентов перерисовывается при сортировке. Performance в production-сборке — длительность задачи. Memory — размер кучи до и после.

```ts
const rows = shallowRef<LogEntry[]>([]);
onMounted(async () => { rows.value = await api.getLogs(); });
const sorted = computed(() => rows.value.toSorted(byDate)); // ES2023, does not mutate
```

Сортировка — O(n log n), и её не отменить. Но рендер после неё — O(видимых строк) вместо O(n).
:::

### 4. Медленная страница товара на Nuxt · сложно

Страница товара: HTML 1,8 МБ, из них 1,3 МБ — `__NUXT_DATA__`. LCP 3,2 с, TBT 900 мс, INP первых кликов плохой. Найдите проблемы и предложите исправления.

```vue
<script setup lang="ts">
const route = useRoute();
const { data: product } = await useFetch(`/api/products/${route.params.id}`); // ~1.1 MB: includes all variants and 400 reviews
const { data: recs } = await useFetch(`/api/recommendations?user=me`);
const product2 = await $fetch(`/api/products/${route.params.id}/stock`);
</script>

<template>
  <ProductHero :product="product" />
  <ReviewsList :reviews="product.reviews" />
  <Recommendations :items="recs" />
  <SiteFooter />
</template>
```

::: details Решение и разбор
1. **Payload.** В HTML уходят все варианты и 400 отзывов. Урезать через `transform`/`pick` до полей первого экрана. В Nuxt 4.6.4 они применяются до записи в payload. Отзывы грузить отдельным запросом.
2. **Отзывы ниже первого экрана.** `<LazyReviewsList hydrate-on-visible>` с собственным `useFetch` внутри, `lazy: true`, первые 10 штук и пагинация. Если отзывы статичны, их можно сделать server component: их HTML будет на странице без JS.
3. **Рекомендации персональные.** Они не нужны для SEO и мешают кэшировать HTML. `useFetch(..., { server: false, lazy: true })` и `<LazyRecommendations hydrate-on-visible>` с заглушкой фиксированной высоты (против CLS).
4. **`$fetch` в `setup`** выполняется дважды: на сервере и при гидрации. Плюс он блокирует рендер. Остаток на складе — `useFetch` с `lazy: true` или `server: false`, если он должен быть свежим.
5. **Футер** — `hydrate-never` или server component: он не интерактивен.
6. **Кэш.** Без персональных данных HTML страницы товара можно кэшировать: `routeRules: { '/products/**': { swr: 300 } }` ([подробнее](../network/caching.md)).
7. **Проверить.** Размер `__NUXT_DATA__`, `nuxi analyze` для бандла, Lighthouse и Performance в production-сборке, RUM-метрики LCP и INP ([подробнее](./web-vitals.md)).

```vue
<script setup lang="ts">
const route = useRoute();
const { data: product } = await useFetch(`/api/products/${route.params.id}`, {
  pick: ['id', 'title', 'price', 'images', 'description'],
});
const { data: stock } = useFetch(`/api/products/${route.params.id}/stock`, { lazy: true });
</script>

<template>
  <ProductHero :product="product" :stock="stock" />
  <LazyReviewsList hydrate-on-visible :product-id="product.id" />
  <LazyRecommendations hydrate-on-visible />
  <LazySiteFooter hydrate-never />
</template>
```

Лучше всего — урезать данные в самом API-маршруте (`/api/products/:id?view=card`). Тогда они не передаются даже от API к Nitro. `pick` на клиентской стороне `useFetch` урезает payload, но не ответ API.
:::

## Источники

- [Vue: Performance](https://vuejs.org/guide/best-practices/performance.html)
- [Vue: Rendering Mechanism — Compiler-Informed Virtual DOM](https://vuejs.org/guide/extras/rendering-mechanism.html)
- [Vue: Reactivity in Depth](https://vuejs.org/guide/extras/reactivity-in-depth.html), [Reactivity API — Advanced (`shallowRef`, `markRaw`, `triggerRef`)](https://vuejs.org/api/reactivity-advanced.html)
- [Vue: Computed Properties — Getting the Previous Value](https://vuejs.org/guide/essentials/computed.html#getting-the-previous-value)
- [Vue: Built-in Directives (`v-once`, `v-memo`)](https://vuejs.org/api/built-in-directives.html)
- [Vue: KeepAlive](https://vuejs.org/guide/built-ins/keep-alive.html), [Async Components — Lazy Hydration](https://vuejs.org/guide/components/async.html#lazy-hydration)
- [Vue: `app.config.performance`](https://vuejs.org/api/application.html#app-config-performance), [Composition API: Lifecycle Hooks (`onRenderTriggered`)](https://vuejs.org/api/composition-api-lifecycle.html#onrendertriggered)
- [Vue: CHANGELOG (3.5: #11067 node caching, #11458 lazy hydration)](https://github.com/vuejs/core/blob/main/CHANGELOG.md), [CHANGELOG 3.4 (#9497 computed previous value)](https://github.com/vuejs/core/blob/main/changelogs/CHANGELOG-3.4.md), [CHANGELOG ветки `minor` (3.6, Vapor Mode)](https://github.com/vuejs/core/blob/minor/CHANGELOG.md)
- [Vue: исходники 3.5 (`compiler-core`, `compiler-dom/transforms/stringifyStatic`, `runtime-core/componentRenderUtils`)](https://github.com/vuejs/core/tree/v3.5.45/packages)
- [Nuxt: Performance best practices](https://nuxt.com/docs/4.x/guide/best-practices/performance)
- [Nuxt: `useFetch`](https://nuxt.com/docs/4.x/api/composables/use-fetch), [Data Fetching](https://nuxt.com/docs/4.x/getting-started/data-fetching)
- [Nuxt: Components — Lazy, Delayed Hydration, Server Components](https://nuxt.com/docs/4.x/directory-structure/app/components)
- [Nuxt: исходники 4.6.4 (`asyncData`, `lazy-hydrated-component`)](https://github.com/nuxt/nuxt/tree/v4.6.4/packages/nuxt/src)
- [Находки: Vue 3.5+](https://github.com/alexrehtide/learning/blob/research/vue-3-5/research/vue-3-5.md), [Nuxt 3 → Nuxt 4](https://github.com/alexrehtide/learning/blob/research/nuxt-3-vs-4/research/nuxt-3-vs-4.md)
