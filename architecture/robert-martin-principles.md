---
title: Принципы Роберта Мартина во фронтенде
level: ядро
---

# Принципы Роберта Мартина во фронтенде

> **Коротко.** Роберт Мартин («дядя Боб») сформулировал четыре слоя идей: SOLID для модулей, принципы компонентов для пакетов и папок, Clean Architecture для всего приложения и Clean Code для строк и функций. Все они про одно: сделать изменение дешёвым и предсказуемым. Фронтендер встречает их каждый день. Компонент разбивают по причинам изменения (SRP). Таблицу расширяют слотом, а не новым `v-if` (OCP). Обёртка над `<input>` ведёт себя как `<input>` (LSP). Аватар получает `name`, а не весь `user` (ISP). Компонент получает API через `inject`, а не импортирует `fetch` (DIP). Бизнес-правила живут в чистых функциях, которые не знают о Vue, а фреймворк, сеть и хранилище остаются деталями на краю. На интервью ценят не расшифровку аббревиатуры, а пример из своего кода и честную цену принципа.

**Связанные темы:** [Структура большого проекта и Feature-Sliced Design](large-project-structure.md), [Система типов: структурная типизация, type и interface](../typescript/type-system.md), [UI-coding: базовые компоненты на Vue](../live-coding/ui-components.md)

## Теория

### Карта идей Мартина

Мартин писал о Java и C++, но его принципы сформулированы через **модули, зависимости и причины изменения**, а не через классы. Поэтому они переносятся на компоненты, composables, сторы и папки фич.

| Уровень | Идеи | Где их видит фронтендер |
| --- | --- | --- |
| Строки и функции | Clean Code: имена, маленькие функции, правило бойскаута | code review, каждый коммит |
| Модули | SOLID | компоненты, composables, сторы, API-клиент |
| Группы модулей | принципы компонентов: REP, CCP, CRP, ADP, SDP, SAP | папки фич, UI-kit, пакеты монорепозитория |
| Приложение | Clean Architecture: правило зависимостей | где лежит бизнес-логика, кто знает о Vue, `fetch`, `localStorage` |

> [!NOTE]
> Не все принципы придумал Мартин. OCP сформулировал Бертран Мейер (1988), LSP — Барбара Лисков (1987), аббревиатуру SOLID сложил Майкл Фезерс в начале 2000-х. Мартин собрал их в систему и переформулировал через зависимости.

### SOLID на фронтенде

**S — Single Responsibility.** В книге «Чистая архитектура» Мартин уточняет формулировку: модуль отвечает перед одним **актором**, то есть одной группой людей, которая просит изменений. Это не «делает одну вещь». Компонент оформления заказа, где лежат вёрстка, правила скидок и формат запроса, меняется по просьбе дизайнера, продакта и бэкенда. Три актора — три причины конфликтов в одном файле.

- *Каждый день:* разбор «толстого» компонента на компонент разметки, composable с состоянием и чистые функции с правилами.
- *Что даёт:* правка дизайна не задевает расчёт цены, мерж-конфликты реже, правила тестируются без монтирования.
- *Признак нарушения:* в одном файле `fetch`, `if (user.role === …)` с бизнес-смыслом и CSS-классы; задачи разных команд правят один и тот же файл.

**O — Open/Closed.** Модуль открыт для расширения и закрыт для изменения: новое поведение добавляют новым кодом, а не правкой старого.

- *Каждый день:* слоты (`#cell-status` у таблицы), реестр компонентов полей формы, плагины Vue и Nuxt, middleware роутера, словарь стратегий вместо `switch`.
- *Что даёт:* новый тип ячейки или способ оплаты не трогает проверенный код, а значит, не ломает его.
- *Признак нарушения:* на каждый новый случай компонент получает ещё один булев prop и ветку `v-if`.

**L — Liskov Substitution.** Реализацию можно подставить везде, где ожидают контракт, и поведение не удивит.

- *Каждый день:* `BaseInput` над нативным `<input>` пробрасывает атрибуты (`name`, `autocomplete`, `aria-*`), поддерживает `v-model` и события фокуса. Все реализации `StorageAdapter` (localStorage, память, cookie) одинаково возвращают `null` на отсутствующий ключ.
- *Что даёт:* обёртки и моки можно подставлять без сюрпризов, тесты на фейке что-то доказывают.
- *Признак нарушения:* «наш инпут не работает с автозаполнением», фейковый API бросает другие ошибки, чем настоящий.

**I — Interface Segregation.** Клиент не должен зависеть от того, чем не пользуется.

- *Каждый день:* узкие props (`name`, `photoUrl` вместо целого `user`), маленькие сторы вместо одного глобального, `Pick<User, 'name'>` в типах, composable возвращает только нужное.
- *Что даёт:* компонент переиспользуется в другом контексте, лишние перерисовки и падения от чужих изменений исчезают, тестовые данные короче.
- *Признак нарушения:* чтобы показать аватар в сторибуке, приходится собирать объект пользователя из 30 полей.

**D — Dependency Inversion.** Код высокого уровня (правила, сценарии) зависит от абстракций, а детали (HTTP, хранилище, SDK) реализуют эти абстракции.

- *Каждый день:* компонент или стор работают с интерфейсом `OrdersApi`, а реализацию получают через `provide`/`inject` или параметр composable. Модель данных бэкенда переводится в модель фронтенда в одном адаптере.
- *Что даёт:* тест без мока сети, сторибук на фейковых данных, переход с REST на GraphQL меняет один файл.
- *Признак нарушения:* `import axios` и строка URL внутри компонента; переименование поля в API ломает десяток шаблонов.

### Принципы компонентов: как резать код на папки и пакеты

Под «компонентом» Мартин понимает единицу развёртывания — пакет, библиотеку. Во фронтенде это фича-папка, пакет монорепозитория или UI-kit. Принципы делятся на две группы.

**Связность — что класть вместе.**

- **REP** (Reuse/Release Equivalence): то, что переиспользуют, выпускают вместе с версией и changelog. UI-kit с семвером, а не «скопируй папку из соседнего проекта».
- **CCP** (Common Closure): классы, которые меняются по одной причине, лежат в одном компоненте. Это SRP на уровне папок; отсюда раскладка по фичам (`features/checkout/`), а не по типам файлов (`components/`, `stores/`, `api/`).
- **CRP** (Common Reuse): не заставляйте зависеть от того, что не используете. ISP на уровне пакетов: если для кнопки нужно затянуть весь пакет с графиками, пакет пора делить.

CCP тянет к крупным компонентам, CRP — к мелким. Мартин прямо называет это напряжением, которое решают по стадии проекта: в начале важнее удобство разработки (CCP), позже — удобство переиспользования.

**Зацепление — как компоненты зависят друг от друга.**

- **ADP** (Acyclic Dependencies): в графе зависимостей нет циклов. `cart` импортирует `user`, а `user` импортирует `cart` — такие фичи нельзя ни понять, ни протестировать, ни вынести по отдельности. Во фронтенде циклы ещё и ломают порядок инициализации модулей (`undefined` при импорте) и мешают разбиению бандла.
- **SDP** (Stable Dependencies): зависьте в сторону стабильности. Фича может зависеть от UI-kit, а UI-kit от фичи — нет.
- **SAP** (Stable Abstractions): чем стабильнее компонент, тем абстрактнее он должен быть. Ядро UI-kit — headless-логика и токены, на которые опирается всё остальное, а конкретная стилизация меняется чаще.

> [!TIP]
> Слои Feature-Sliced Design (`shared` → `entities` → `features` → `widgets` → `pages` → `app`) с правилом «импортировать только из слоёв ниже» — это ADP и SDP, превращённые в соглашение. Проверяют их линтером: `eslint-plugin-boundaries`, `dependency-cruiser` или `no-restricted-imports`.

### Clean Architecture: правило зависимостей

Главная мысль статьи 2012 года — **правило зависимостей**: зависимости в исходном коде направлены только внутрь, к политикам высокого уровня. Внутренний круг ничего не знает о внешнем: ни имён, ни функций, ни форматов данных.

| Круг (изнутри наружу) | Что это у Мартина | Что это во фронтенде |
| --- | --- | --- |
| Entities | бизнес-правила предприятия | типы `Order`, `Money`, чистые функции `calcTotal`, `canCancel` |
| Use Cases | сценарии приложения | «оформить заказ», «применить промокод»: функция или action стора, которая оркестрирует правила и порты |
| Interface Adapters | контроллеры, презентеры, шлюзы | реализация `OrdersApi` на `fetch`, мапперы DTO → модель, composables, связывающие сценарий с UI |
| Frameworks & Drivers | БД, веб, фреймворки | Vue, Nuxt, роутер, `fetch`, `localStorage`, SDK аналитики |

Во фронтенде из этого следуют три привычки:

1. **Бизнес-правило не знает о Vue.** `calcTotal(items, promo)` — чистая функция без `ref`, её проверяют одним юнит-тестом за миллисекунды.
2. **Граница с внешним миром — интерфейс, описанный в терминах приложения.** Сценарий зависит от `OrdersApi.create(order)`, а не от URL и snake_case.
3. **Компонент — «скромный объект» (Humble Object).** Мартин советует делать тонким то, что трудно тестировать (отрисовку), и выносить логику туда, где её легко проверить. Компонент показывает данные и пересылает события, решения принимает логика рядом.

> [!WARNING]
> Мартин пишет, что «фреймворк — это деталь». На фронтенде это верно наполовину: реактивность Vue пронизывает состояние, и полностью изолировать приложение от неё дорого и почти никогда не нужно. Практичный компромисс — держать без Vue только доменные правила и границы с API и хранилищами, а сценарии писать как composables или actions Pinia.

### Clean Code в ежедневной работе

Здесь принципы мельче, зато применяются в каждом пулреквесте:

- **Говорящие имена:** `isCartEmpty` вместо `flag`, `fetchOrders` вместо `getData`, обработчик называют по смыслу (`submitOrder`), а не по событию (`onClick2`).
- **Маленькие функции, один уровень абстракции:** `watch`, где смешаны запрос, преобразование данных и работа с DOM, разбивают на функции с понятными именами.
- **Без скрытых побочных эффектов:** `computed` не мутирует состояние и не ходит в сеть; функция с именем `getUser` не пишет в `localStorage`.
- **Меньше аргументов:** вместо `createToast(text, 3000, true, 'top', null)` — объект опций.
- **Правило бойскаута:** оставляй код чуть чище, чем он был. Это маленькие безопасные рефакторинги вместо «большого переписывания».
- **Тесты — тоже код:** быстрые, независимые, повторяемые (F.I.R.S.T. из «Чистого кода»).

### Как принципы улучшают опыт разработки и где вредят

Выигрыш виден в повседневных метриках команды:

- **Меньше файлов на задачу.** Изменение одного требования затрагивает один модуль (SRP, CCP).
- **Меньше регрессий.** Новое поведение добавляют, а не переписывают (OCP).
- **Быстрые тесты.** Правила проверяются без браузера и сети, компоненты — с фейковыми зависимостями (DIP, Humble Object).
- **Предсказуемые зависимости.** Нет циклов, понятно, что можно импортировать (ADP, SDP), — проще онбординг и код-ревью.
- **Дешёвая смена технологий.** HTTP-клиент, сборщик аналитики или хранилище меняются в адаптере.

Цена — косвенность. Каждый интерфейс, порт и слой надо прочитать, назвать и поддерживать. Принципы окупаются там, где код живёт долго, меняется часто и тестируется. В прототипе на две недели порт над `fetch` и четыре круга архитектуры — это оверинжиниринг. Сам Мартин подчёркивает, что архитектура нужна, чтобы держать **открытыми** варианты решений, а не чтобы строить абстракции заранее.

> [!TIP]
> Каркас ответа на 30 секунд: «SOLID и Clean Architecture для меня — про стоимость изменения. Каждый день это выглядит так: компоненты режу по причинам изменения, расширяю слотами и реестрами, зависимости от API получаю через интерфейс и `inject`, правила держу в чистых функциях без Vue, а границы слоёв проверяет линтер. Абстракцию добавляю, когда она окупается тестами или вторым случаем, а не "на будущее"».

## Примеры

### 1. SRP и DIP: компонент оформления заказа

До: компонент знает о скидках, формате API и разметке одновременно.

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{ items: { price: number; qty: number }[]; promo?: string }>()
const loading = ref(false)

const total = computed(() => {
  const sum = props.items.reduce((acc, i) => acc + i.price * i.qty, 0)
  return props.promo === 'SALE10' ? sum * 0.9 : sum // business rule inside UI
})

async function submit() {
  loading.value = true
  await fetch('/api/v2/orders', { // transport details inside UI
    method: 'POST',
    body: JSON.stringify({ line_items: props.items, promo_code: props.promo }),
  })
  loading.value = false
}
</script>
```

После: правило, порт и сценарий разделены, компонент стал «скромным».

```ts
// domain/order.ts — entities: no Vue, no fetch
export interface LineItem { price: number; qty: number }

export function calcTotal(items: LineItem[], promo?: string): number {
  const sum = items.reduce((acc, i) => acc + i.price * i.qty, 0)
  return promo === 'SALE10' ? sum * 0.9 : sum
}

// domain/orders-api.ts — port described in app terms
export interface OrdersApi {
  create(order: { items: LineItem[]; promo?: string }): Promise<{ id: string }>
}

// infrastructure/http-orders-api.ts — adapter knows URL and DTO format
export function createHttpOrdersApi(baseURL: string): OrdersApi {
  return {
    async create({ items, promo }) {
      const res = await fetch(`${baseURL}/v2/orders`, {
        method: 'POST',
        body: JSON.stringify({ line_items: items, promo_code: promo }),
      })
      if (!res.ok) throw new Error(`Order failed: ${res.status}`)
      return res.json()
    },
  }
}
```

```ts
// features/checkout/use-checkout.ts — use case wired to Vue
import { inject, ref, type InjectionKey } from 'vue'
import type { OrdersApi } from '@/domain/orders-api'

export const ordersApiKey: InjectionKey<OrdersApi> = Symbol('OrdersApi')

export function useCheckout() {
  const api = inject(ordersApiKey)
  if (!api) throw new Error('OrdersApi is not provided')
  const loading = ref(false)

  async function submit(order: Parameters<OrdersApi['create']>[0]) {
    loading.value = true
    try {
      return await api.create(order)
    } finally {
      loading.value = false
    }
  }

  return { loading, submit }
}
```

Теперь `calcTotal` проверяется юнит-тестом, компонент монтируется в тесте с `global.provide` и фейковым `OrdersApi`, а смена версии API трогает только адаптер.

### 2. OCP: реестр полей формы

```ts
// form/registry.ts
import type { Component } from 'vue'
import TextField from './TextField.vue'
import DateField from './DateField.vue'

const fields = new Map<string, Component>([
  ['text', TextField],
  ['date', DateField],
])

export function registerField(type: string, component: Component) {
  fields.set(type, component)
}

export function resolveField(type: string): Component {
  const field = fields.get(type)
  if (!field) throw new Error(`Unknown field type: ${type}`)
  return field
}
```

```vue
<!-- FormRenderer.vue: closed for modification -->
<template>
  <component
    :is="resolveField(field.type)"
    v-for="field in schema"
    :key="field.name"
    v-model="model[field.name]"
    v-bind="field.props"
  />
</template>
```

Новый тип поля добавляют вызовом `registerField('phone', PhoneField)` в своей фиче. `FormRenderer` при этом не меняется.

### 3. LSP: обёртка, которую можно подставить вместо `<input>`

```vue
<script setup lang="ts">
defineOptions({ inheritAttrs: false })
const model = defineModel<string>()
defineProps<{ label: string }>()
</script>

<template>
  <label class="field">
    <span>{{ label }}</span>
    <!-- $attrs go to the real input: name, autocomplete, aria-*, listeners -->
    <input v-model="model" v-bind="$attrs" />
  </label>
</template>
```

Без `v-bind="$attrs"` атрибуты `autocomplete`, `required` и слушатели `@blur` попали бы на `<label>`, и `BaseInput` перестал бы быть заменой `<input>`.

### 4. Правило зависимостей, проверяемое линтером

```js
// eslint.config.js — domain must not know about Vue, HTTP or features
export default [
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['vue', 'pinia', 'nuxt', '#app'], message: 'Domain is framework-free.' },
          { group: ['@/features/*', '@/infrastructure/*'], message: 'Dependencies point inward only.' },
        ],
      }],
    },
  },
]
```

Правило, которое проверяет CI, переживает смену команды. Правило в вики — нет.

## Вопросы с интервью

::: details Расскажите про SOLID на примерах из фронтенда
SRP: компонент отвечает перед одним актором. Если в нём вёрстка (дизайнер), правила скидок (продукт) и формат запроса (бэкенд), правила выношу в чистые функции, а запрос — в адаптер. OCP: таблицу расширяю слотами `#cell-<key>`, форму — реестром полей, а не новыми булевыми props и `v-if`. LSP: обёртка `BaseInput` пробрасывает `$attrs`, `v-model` и события, иначе её нельзя подставить вместо `<input>`; фейковый API бросает те же ошибки, что настоящий. ISP: аватар принимает `name` и `photoUrl`, а не весь `user`; сторы маленькие. DIP: компонент получает `OrdersApi` через `inject`, а не импортирует `axios` — поэтому тестируется без мока сети. Обязательно добавляю цену: это эвристики про стоимость изменения, и дробление на части, которые всегда меняются вместе, — тоже ошибка.
:::

::: details SRP означает, что модуль должен делать одну вещь?
Нет, это частая ошибка. «Делать одну вещь» — правило для функций из «Чистого кода». SRP в формулировке «Чистой архитектуры» — модуль отвечает перед одним актором, одной группой людей, которые просят изменений. Компонент может делать много мелких вещей (показывать, валидировать ввод, форматировать дату), если все они меняются по просьбе одних и тех же людей. И наоборот, короткий файл нарушает SRP, если в нём смешаны правило оплаты и формат API. Практический тест: какие задачи из трекера правят этот файл и от кого они приходят.
:::

::: details Что такое Clean Architecture и как применить её к фронтенд-приложению
Это концентрические слои с правилом зависимостей: код зависит только от того, что внутри. В центре — доменные сущности и правила, дальше сценарии, затем адаптеры, снаружи фреймворки и драйверы. Во фронтенде: типы и чистые функции домена без Vue (`calcTotal`, `canCancel`); сценарии — composables или actions Pinia, которые работают через порты; адаптеры — реализация API на `fetch`, мапперы DTO, хранилища; снаружи Vue, Nuxt, роутер, браузерные API. Компонент — скромный объект: показывает данные и пересылает события. Правило зависимостей закрепляю линтером. Полную изоляцию от Vue не строю: реактивность пронизывает состояние, и это дорого. Изолирую домен и границы с внешним миром — там отдача максимальна: тесты, смена API, переиспользование.
:::

::: details Как принципы Мартина улучшают опыт разработки в команде
Сокращают число файлов на задачу (SRP, CCP), снижают регрессии, потому что новое добавляется, а не переписывается (OCP), ускоряют тесты: правила проверяются без браузера, компоненты — с фейками через `provide` (DIP). Ацикличные и направленные зависимости (ADP, SDP) делают проект понятным: новичок знает, что откуда можно импортировать, ревью проще, бандл режется лучше. Смена HTTP-клиента, аналитики или формата API затрагивает один адаптер. Мерж-конфликтов меньше, потому что разные команды правят разные файлы.
:::

::: details Когда эти принципы вредят
Когда абстракция появляется раньше второго случая. Порт над тем, что никогда не заменят и не подменяют в тестах; интерфейс на каждый composable; слой «сервисов», который просто пробрасывает вызов; четыре круга архитектуры в прототипе на две недели. Каждый слой — это косвенность, которую читают и поддерживают. Признаки перегиба: чтобы понять фичу, нужно открыть восемь файлов; компоненты разрезаны на части, которые всегда меняются вместе. Я добавляю абстракцию, когда она окупается сразу (тесты, второй случай, граница с внешним API), и откладываю, если это «на будущее».
:::

::: details Что такое принцип ацикличных зависимостей и как его соблюдать во фронтенде
ADP: в графе зависимостей компонентов (фич, пакетов) нет циклов. Цикл `cart ↔ user` превращает две фичи в одну: их нельзя понять, протестировать и вынести по отдельности. В ESM циклы ещё дают `undefined` при инициализации модулей и мешают разбиению бандла. Разрываю цикл тремя способами: выношу общее в слой ниже (`entities/user`), инвертирую зависимость (фича объявляет интерфейс, другая его реализует) или заменяю прямой вызов событием. Соблюдение проверяю автоматически: слои Feature-Sliced Design, `eslint-plugin-boundaries`, `dependency-cruiser`, `import/no-cycle`.
:::

## Задачи

### 1. Найдите нарушения SOLID · легко

Назовите, какие принципы нарушает компонент, и как его исправить.

```vue
<script setup lang="ts">
import axios from 'axios'
import { ref, onMounted } from 'vue'

const props = defineProps<{
  user: { id: string; name: string; email: string; role: string; address: object; orders: object[] }
  compact?: boolean
  showBadge?: boolean
  adminMode?: boolean
}>()

const stats = ref()
onMounted(async () => {
  stats.value = (await axios.get(`/api/users/${props.user.id}/stats`)).data
})
</script>
```

::: details Решение и разбор
- **ISP:** принимает весь `user`, хотя карточке нужны `name` и, возможно, `role`. Передавать узкие props.
- **OCP:** булевы `compact`, `showBadge`, `adminMode` — каждый новый вариант добавляет prop и `v-if`. Вынести варианты в слоты (`#badge`, `#actions`) или в отдельные компоненты, собранные из общих частей.
- **DIP:** импорт `axios` и URL внутри компонента. Получать статистику через порт `UsersApi` из `inject` или принимать уже загруженные `stats` пропсом от страницы.
- **SRP:** загрузка данных (бэкенд), режим администратора (права, продукт) и вид карточки (дизайн) — три актора. Карточка становится презентационной, загрузку делает composable `useUserStats(id)` на уровне страницы.

Компромисс: если карточка используется в одном месте и не тестируется, достаточно вынести запрос и сузить props, а не строить реестр вариантов.
:::

### 2. Разорвите цикл между фичами · средне

Фича `cart` импортирует `useUser()` из `features/user`, чтобы взять скидку пользователя. Фича `user` импортирует `useCart()` из `features/cart`, чтобы показать в профиле число товаров. Сборка иногда выдаёт `undefined` при импорте, тесты `cart` тянут весь `user`. Предложите структуру без цикла.

::: details Решение и разбор
Нарушен ADP. Варианты от простого к сложному:

1. **Вынести общее ниже.** Скидка пользователя — доменная сущность: `entities/user/model.ts` с типом `User` и функцией `discountFor(user)`. Число товаров — `entities/cart`. Обе фичи импортируют `entities`, но не друг друга.
2. **Собрать на уровне выше.** Профиль — это виджет или страница, которая вызывает и `useUser()`, и `useCart()` и передаёт счётчик в компонент профиля пропсом. Фича `user` больше не знает о корзине.
3. **Инвертировать зависимость.** Если `cart` действительно нужен «источник скидки», она объявляет интерфейс `DiscountSource` и получает его через `inject`; реализацию на основе `user` подключает слой `app`.

```ts
// features/cart/discount-source.ts
export interface DiscountSource { current(): number }
export const discountSourceKey: InjectionKey<DiscountSource> = Symbol('DiscountSource')
```

Закрепить результат правилом линтера (`import/no-cycle` или запрет импорта между фичами одного слоя), чтобы цикл не вернулся.
:::

### 3. Вынесите сценарий из компонента и протестируйте без Vue · средне

В компоненте промокода логика: промокод нельзя применить к пустой корзине; код проверяется на сервере; при ошибке `404` показывается «Промокод не найден», при других ошибках — «Попробуйте позже». Вынесите сценарий так, чтобы его можно было проверить обычным юнит-тестом без монтирования и без мока `fetch`.

::: details Решение и разбор
```ts
// domain/promo.ts
export interface PromoApi {
  check(code: string): Promise<{ percent: number }>
}

export class PromoNotFoundError extends Error {}

export type ApplyPromoResult =
  | { ok: true; percent: number }
  | { ok: false; message: string }

export async function applyPromo(
  api: PromoApi,
  code: string,
  itemsCount: number,
): Promise<ApplyPromoResult> {
  if (itemsCount === 0) return { ok: false, message: 'Корзина пуста' }
  try {
    const { percent } = await api.check(code.trim().toUpperCase())
    return { ok: true, percent }
  } catch (e) {
    const message = e instanceof PromoNotFoundError ? 'Промокод не найден' : 'Попробуйте позже'
    return { ok: false, message }
  }
}
```

```ts
// domain/promo.test.ts
import { describe, expect, it } from 'vitest'
import { applyPromo, PromoNotFoundError, type PromoApi } from './promo'

const api = (impl: PromoApi['check']): PromoApi => ({ check: impl })

describe('applyPromo', () => {
  it('rejects empty cart without calling api', async () => {
    let called = false
    const result = await applyPromo(api(async () => { called = true; return { percent: 10 } }), 'x', 0)
    expect(result).toEqual({ ok: false, message: 'Корзина пуста' })
    expect(called).toBe(false)
  })

  it('maps not found to a user message', async () => {
    const result = await applyPromo(api(async () => { throw new PromoNotFoundError() }), 'x', 2)
    expect(result).toEqual({ ok: false, message: 'Промокод не найден' })
  })
})
```

HTTP-адаптер переводит `404` в `PromoNotFoundError` — так статус-коды не протекают в домен (правило зависимостей). Компонент вызывает `applyPromo(api, code, items.length)` и только показывает результат (Humble Object). Сценарий возвращает результат-объединение вместо исключения, поэтому UI не обязан знать о типах ошибок.
:::

## Источники

- [Robert C. Martin — Clean Architecture: A Craftsman's Guide to Software Structure and Design](https://www.oreilly.com/library/view/clean-architecture-a/9780134494272/)
- [Robert C. Martin — Clean Code: A Handbook of Agile Software Craftsmanship](https://www.oreilly.com/library/view/clean-code-a/9780136083238/)
- [Robert C. Martin — The Clean Architecture (2012)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Robert C. Martin — The Single Responsibility Principle (2014)](https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html)
- [Robert C. Martin — The Open Closed Principle (2014)](https://blog.cleancoder.com/uncle-bob/2014/05/12/TheOpenClosedPrinciple.html)
- [Vue.js — Provide / Inject](https://vuejs.org/guide/components/provide-inject.html)
- [Vue.js — Fallthrough Attributes](https://vuejs.org/guide/components/attrs.html)
- [Feature-Sliced Design — Layers](https://feature-sliced.design/docs/reference/layers)
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)
