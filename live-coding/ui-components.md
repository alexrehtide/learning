---
title: 'UI-coding: базовые компоненты на Vue'
level: ядро
---

# UI-coding: базовые компоненты на Vue

> **Коротко.** UI-coding — задача на 30–45 минут: написать компонент вроде вкладок, аккордеона, модального окна, рейтинга или прогресс-бара. Оценивают не вёрстку, а контракт компонента (props, `v-model`, события, слоты), его переиспользуемость, доступность с клавиатуры и для скринридера и аккуратность с DOM: фокус, слушатели, очистка. Вкладки и аккордеон собирают из составных компонентов (compound components) через `provide`/`inject`, состояние отдают наружу через `defineModel`, клавиатуру и ARIA берут из паттернов WAI-ARIA APG. Модальное окно на `<dialog>` и `showModal()` бесплатно получает top layer, инертный фон, Esc и возврат фокуса. Блокировка прокрутки остаётся на вас.

**Связанные темы:** [DOM API и observers](../browser/dom.md), [События и событийная модель](../browser/events.md), [XSS и безопасный вывод во Vue](../security/xss.md), [Конвейер рендеринга: layout, paint, composite](../browser/rendering-pipeline.md), [Мини-реактивность в стиле Vue](./mini-reactivity.md), [Generics](../typescript/generics.md)

## Теория

Код темы — Vue 3.5 `<script setup lang="ts">`. Все компоненты проверены на Vue 3.5.45: типы — `vue-tsc`, поведение — в Edge (Chromium) через Playwright, включая клавиатуру, фокус и клики по фону.

### Формат и что оценивают

Хороший порядок работы на интервью:

1. **Уточнить требования** (2–3 минуты): одна или несколько открытых секций, нужен ли контролируемый режим, что с disabled, нужна ли анимация, SSR.
2. **Объявить контракт** до разметки: props, `v-model`, события, слоты. Это 5 строк, и по ним видно, как компонент будут использовать.
3. **Разметка с семантикой**: сначала нативный элемент (`<button>`, `<dialog>`, `<progress>`, radio), ARIA — только там, где нативного нет.
4. **Состояние и клавиатура**, затем крайние случаи: пустой список, `loading` и `error` (у компонента данных — отдельные слоты или props), выход значения за границы, двойной монтаж. **Стили** — в последнюю очередь и минимально.

Что оценивают, кроме «работает»: API, которым удобно пользоваться, и слоты вместо props-конфигов; клавиатуру и ARIA; отсутствие `v-html` и ручного `innerHTML`; снятые слушатели и восстановленный фокус; типы. Молча написанный компонент без пояснений проигрывает компоненту попроще, но с проговорёнными компромиссами.

### Контракт: props, `v-model`, события, слоты

| Канал | Для чего |
| --- | --- |
| props | Данные и настройки снаружи: `label`, `max`, `multiple` |
| `v-model` (`defineModel`) | Значение, которое компонент меняет сам: активная вкладка, открытые секции, рейтинг |
| события (`defineEmits`) | Сообщения без состояния: `close`, `select`, `load-more` |
| слоты | Произвольная разметка вместо строковых props: заголовок, содержимое, пустое состояние |

`defineModel()` — макрос: компилятор объявляет prop `modelValue` и событие `update:modelValue` и возвращает ref. Чтение отдаёт значение родителя, запись эмитит событие. Если родитель `v-model` не передал, ref работает как локальное состояние: компонент сразу и **контролируемый** (controlled), и **неконтролируемый** (uncontrolled). Ловушка из документации: `defineModel({ default: 1 })` при `v-model="ref()"` у родителя даёт рассинхрон: у родителя `undefined`, у ребёнка `1`. Поэтому для обязательного значения — `{ required: true }`, а `default` — только для неконтролируемого режима.

Второе правило: значение модели не мутируют. `open.value.push(x)` поменяет массив родителя напрямую, без `update:modelValue`. Родитель не узнает об изменении, а в неконтролируемом режиме это и вовсе мутация чужого prop. Нужно присваивать новый массив.

### Compound components через `provide`/`inject`

Вкладки — это `Tabs`, `TabList`, `Tab`, `TabPanel`, которые пользователь собирает сам:

```vue
<Tabs v-model="active">
  <TabList label="Settings">
    <Tab value="profile">Profile</Tab>
    <Tab value="billing" :disabled="!isAdmin">Billing</Tab>
  </TabList>
  <TabPanel value="profile"><ProfileForm /></TabPanel>
  <TabPanel value="billing"><BillingForm /></TabPanel>
</Tabs>
```

Альтернатива — `<Tabs :items="[{ label, content }]">`. Она проще, но каждое новое желание (иконка во вкладке, бейдж, disabled по условию) превращается в новое поле конфига или слот с именем `tab-${id}`. Составные компоненты отдают разметку пользователю, а общее состояние делят через `provide`/`inject`: корень провайдит контекст, дети его инжектят. Ключ — `InjectionKey<T>`, поэтому `inject` типизирован. `inject` вне корня вернёт `undefined`: лучше бросить понятную ошибку, чем упасть на `undefined.active`. Наружу из контекста отдают `readonly(ref)` и функции: менять состояние могут только методы корня. `$children` из Vue 2 во Vue 3 удалён, и дети не регистрируются сами по себе. Порядок вкладок для стрелок проще всего брать из DOM: `querySelectorAll('[role="tab"]')` (задача 3).

id для ARIA-связок (`aria-controls`, `aria-labelledby`, `name` радиогруппы) — `useId()` из Vue 3.5: он уникален в приложении и одинаков на сервере и клиенте (почему не счётчик и не `Math.random()` — в вопросах ниже). Вызывать его можно только в `setup`, не внутри `computed`.

### Клавиатура: roving tabindex и паттерны APG

WAI-ARIA Authoring Practices (APG) задают ожидаемую клавиатуру для каждого виджета. Кратко:

| Виджет | Роли и атрибуты | Клавиши |
| --- | --- | --- |
| Tabs | `tablist` с `aria-label`; `tab` с `aria-selected`, `aria-controls`; `tabpanel` с `aria-labelledby` | Tab — в список и сразу из него; ←/→ с переходом по кругу; Home/End (опционально) |
| Accordion | Кнопка внутри заголовка (`role="heading"` + `aria-level` или `<h3>`); `aria-expanded`, `aria-controls`; панель — `region` (опционально) | Enter/Space на кнопке, Tab между заголовками |
| Dialog (modal) | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` | Tab и Shift+Tab по кругу внутри, Esc закрывает |

**Roving tabindex**: у активной вкладки `tabindex="0"`, у остальных `-1`. Tab попадает в виджет одной остановкой, внутри перемещают стрелки, которые переносят и фокус, и `tabindex="0"`. Альтернатива — `aria-activedescendant`: фокус остаётся на контейнере (или на `<input>` комбобокса), а атрибут указывает на «виртуально» активный элемент. Её берут, когда фокус обязан остаться в поле ввода.

**Автоматическая активация** (вкладка открывается при фокусе) — рекомендация APG, если панель показывается без задержки. Если панель грузится по сети, нужна ручная: стрелки двигают фокус, Enter/Space открывают. Если у панели нет фокусируемого содержимого, ей ставят `tabindex="0"`, чтобы Tab из списка вкладок попадал в неё.

Неактивные панели прячут через `v-show` (или атрибут `hidden`), а не `v-if`: элемент остаётся в DOM, `aria-controls` не ссылается в пустоту, а формы внутри не теряют состояние. `hidden="until-found"` ещё и даёт браузерному поиску (Ctrl+F) открыть найденную секцию через событие `beforematch` (Chrome 102, Firefox 148, Safari 26.2). Нативный аккордеон без JS — `<details name="faq">`: одинаковое `name` делает секции взаимоисключающими (Baseline 2024).

### Модальное окно: `<dialog>` или `<Teleport>`

`dialog.showModal()` делает за вас почти всё:

- **Top layer.** Окно рисуется поверх всего, и никакой `z-index`, `overflow: hidden` или `transform` предка его не обрежет. Фон — псевдоэлемент `::backdrop`.
- **Инертный фон.** Документ «заблокирован модальным диалогом»: клики, фокус и поиск по странице до фона не доходят. Tab циклически ходит по окну и интерфейсу браузера, ручная фокус-ловушка не нужна.
- **Фокус при открытии**: на элемент с `autofocus`, иначе на первый фокусируемый, иначе на сам диалог. **При закрытии** спецификация возвращает фокус на элемент, который был в фокусе до `showModal()`.
- **Esc** закрывает окно. Сначала идёт отменяемое событие `cancel`, затем `close`. `<form method="dialog">` закрывает окно без отправки, а `returnValue` получает `value` нажатой кнопки.
- **Роль**: `aria-modal="true"` выставляется неявно.

Не делает: **не блокирует прокрутку страницы** под окном (это класс на `<html>` с `overflow: hidden` и `scrollbar-gutter: stable`, чтобы контент не прыгал на ширину скроллбара) и **не закрывается по клику на фон**. Клик по фону — `@click.self` на диалоге без внутренних отступов либо атрибут `closedby="any"` (Chrome 134, Firefox 141, Safari 27.3).

> [!WARNING]
> Событие `close` асинхронное: спецификация ставит его в очередь задач. После Esc `dialog.open` уже `false`, а обработчик `@close` и, значит, `update:open` выполнятся в следующей задаче. И `close` не наступает вовсе, если диалог удалили из DOM открытым (`v-if` у родителя): снимать блокировку прокрутки надо и в `onBeforeUnmount`.

Путь через `<Teleport to="body">` с `<div role="dialog" aria-modal="true">` нужен, когда есть свои требования к анимации или поддержка старых браузеров. Teleport переносит только DOM: `provide`/`inject`, события и props работают как раньше, а `<Teleport defer>` (3.5) ждёт, пока цель отрисует сам Vue. Всё остальное делается вручную:

1. Запомнить `document.activeElement` до открытия, после закрытия вернуть на него фокус (если элемент ещё `isConnected`).
2. После монтирования перевести фокус внутрь окна.
3. Сделать фон инертным: атрибут `inert` на корне приложения (`#app`), окно при этом — вне его, в `body`. Ловушка держит только фокус клавиатуры: без `inert` скринридер в режиме чтения пройдёт по странице под окном, а мышь кликнет сквозь прозрачный фон. `aria-modal="true"` — лишь подсказка, её поддерживают не все скринридеры.
4. Esc на `keydown`, а при вложенных окнах закрывать только верхнее.
5. Фокус-ловушка для Tab:

```ts
const FOCUSABLE = ['a[href]', 'button', 'input', 'select', 'textarea', '[tabindex]']
  .map((s) => `${s}:not(:disabled):not([tabindex="-1"])`)
  .join(', ');

export function trapTab(event: KeyboardEvent, container: HTMLElement) {
  if (event.key !== 'Tab') return;
  // checkVisibility() skips display: none, including v-show
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.checkVisibility());
  const active = document.activeElement;
  const atEdge = event.shiftKey ? active === items[0] || active === container : active === items.at(-1);
  if (!items.length || atEdge) {
    event.preventDefault();
    items.at(event.shiftKey ? -1 : 0)?.focus();
  }
}
```

### Рейтинг и прогресс: сначала нативный элемент

**Рейтинг звёздами** по смыслу — выбор одного из N, то есть радиогруппа. `<fieldset>` с `<legend>` и пятью `<input type="radio">` с общим `name` дают бесплатно: одну остановку Tab, стрелки, озвучку «3 из 5» и работу в `<form>`. Звёзды — декорация с `aria-hidden="true"`, сами radio визуально скрыты, но не через `display: none` (иначе пропадёт фокус). Режим «только показ» — не радиогруппа, а `role="img"` с `aria-label="4 of 5"`.

**Прогресс-бар**: нативный `<progress value max>` без `value` становится неопределённым (indeterminate). Свой компонент — `role="progressbar"` с `aria-valuenow`, `aria-valuemin`, `aria-valuemax` и подписью. Для неопределённого состояния `aria-valuenow` не ставят. `<meter>` — другое: шкала величины (заряд, заполненность диска), а не ход процесса. Анимировать полосу лучше через `transform: scaleX()`: это композиция, а `width` запускает layout на каждом кадре (см. [«Конвейер рендеринга»](../browser/rendering-pipeline.md)).

### Безопасный вывод

<code v-pre>{{ title }}</code> и `:title` экранируют значение, поэтому строковые props безопасны. Опасно передавать «HTML-строку для заголовка» и выводить её через `v-html`: это XSS, если строка хоть раз пришла от пользователя. Разметка снаружи передаётся слотом. Остальные дыры (`:href` с `javascript:`, `v-bind="obj"`) — в теме [«XSS и безопасный вывод во Vue»](../security/xss.md).

## Примеры

Прогресс-бар: ограничение значения, неопределённое состояние и анимация на композиторе.

```vue
<script setup lang="ts">
import { computed } from 'vue';
// value: null means indeterminate
const { value = null, max = 100, label } = defineProps<{ value?: number | null; max?: number; label: string }>();
// Clamp to [0, 1]; NaN, Infinity or max <= 0 fall back to indeterminate
const ratio = computed(() =>
  value === null || !Number.isFinite(value) || !(max > 0)
    ? null
    : Math.min(Math.max(value / max, 0), 1),
);
const percent = computed(() => (ratio.value === null ? null : Math.round(ratio.value * 100)));
</script>

<template>
  <div class="progress" :class="{ 'progress--indeterminate': percent === null }" role="progressbar"
    :aria-label="label" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="percent ?? undefined">
    <!-- transform runs on the compositor; animating width triggers layout -->
    <div class="progress__bar" :style="{ transform: `scaleX(${ratio ?? 0.3})` }" />
  </div>
</template>
```

`undefined` и `null` в привязке удаляют атрибут, а `false` во Vue 3 рендерится как строка `"false"`. Поэтому `:aria-expanded="expanded"` и `:aria-selected="selected"` можно привязывать прямо к булеву значению.

## Вопросы с интервью

::: details С чего начать UI-coding задачу и что в ней оценивают
С вопросов о требованиях и с контракта: props, `v-model`, события, слоты, — до разметки. Затем семантическая разметка на нативных элементах, состояние, клавиатура и ARIA, крайние случаи (пусто, загрузка, ошибка, disabled, значение за границами) и только потом стили. Оценивают API компонента и его переиспользуемость, доступность, безопасный вывод, очистку слушателей и фокус, типы и то, как кандидат проговаривает компромиссы.
:::

::: details Как работает defineModel и что значит контролируемый и неконтролируемый компонент
Макрос объявляет prop `modelValue` и событие `update:modelValue` и возвращает ref: чтение отдаёт prop, запись эмитит событие. Контролируемый компонент получает значение от родителя и только просит его изменить. Неконтролируемый хранит значение сам. `defineModel` поддерживает оба режима: без `v-model` у родителя ref ведёт себя как локальное состояние. Ловушки: `default` при переданном, но `undefined` значении у родителя даёт рассинхрон, а мутация (`model.value.push`) обходит событие.
:::

::: details Чем compound components лучше массива конфигов в props
Конфиг (`:items="[{ label, content }]"`) прост, пока требования не растут: иконка, бейдж, disabled по условию, своя разметка вкладки — каждое становится полем или динамическим слотом. Составные компоненты отдают разметку пользователю, а общее состояние делят через `provide`/`inject` с типизированным `InjectionKey`. Цена — больше файлов и нужно знать порядок детей. Его берут из DOM или регистрацией детей в корне.
:::

::: details Что такое roving tabindex и чем он отличается от aria-activedescendant
Roving tabindex: у текущего элемента группы `tabindex="0"`, у остальных `-1`, стрелки переносят и фокус, и «нулевой» tabindex. Группа — одна остановка Tab. При `aria-activedescendant` фокус остаётся на контейнере или на поле ввода, а атрибут указывает id активного элемента: так делают комбобокс, где печатать нужно, не теряя фокус. Первый проще и надёжнее работает со скринридерами, второй нужен, когда фокус двигать нельзя.
:::

::: details Что браузер делает за вас в модальном dialog, а что остаётся вам
`showModal()` переносит окно в top layer, делает остальной документ инертным, переводит фокус внутрь (на `autofocus` или первый фокусируемый), закрывает по Esc с событиями `cancel` и `close` и возвращает фокус при закрытии. `aria-modal` выставляется неявно. Остаётся блокировка прокрутки страницы, закрытие по клику на фон (или `closedby="any"`), синхронизация с `v-model` через событие `close`, которое асинхронно, и очистка при размонтировании открытого окна.
:::

::: details Почему для id в ARIA-связках нужен useId
`aria-controls`, `aria-labelledby`, `for` и `name` радиогруппы требуют уникальных id, одинаковых на сервере и клиенте. Счётчик в модуле на сервере растёт между запросами, `Math.random()` даёт разные значения на сервере и клиенте: и то и другое — расхождение при гидратации. `useId()` (Vue 3.5) берёт счётчик экземпляра приложения в порядке рендера: порядок на сервере и клиенте совпадает, а каждый SSR-запрос создаёт новое приложение со счётчиком с нуля. Префикс задаёт `app.config.idPrefix`, если на странице несколько приложений.
:::

## Задачи

### 1. Рейтинг звёздами · легко

Компонент `StarRating` с `v-model` (число от 1 до `max`, 0 — не выбрано) и подписью. Ховер подсвечивает звёзды до курсора, клавиатура и скринридер работают.

::: details Решение и разбор
```vue
<script setup lang="ts">
import { computed, ref, useId } from 'vue';
const rating = defineModel<number>({ required: true });
const { max = 5, label } = defineProps<{ max?: number; label: string }>();
const name = useId(); // one radio group per instance, stable across SSR
const hovered = ref(0);
const shown = computed(() => hovered.value || rating.value);
</script>

<template>
  <fieldset class="rating" @mouseleave="hovered = 0">
    <legend>{{ label }}</legend>
    <label v-for="n in max" :key="n" @mouseenter="hovered = n">
      <input v-model="rating" type="radio" class="visually-hidden" :name="name" :value="n" />
      <span aria-hidden="true" :class="{ filled: n <= shown }">★</span>
      <span class="visually-hidden">{{ n }} of {{ max }}</span>
    </label>
  </fieldset>
</template>
```

Радиогруппа даёт всё нужное без JS: Tab попадает в группу одной остановкой, стрелки выбирают соседнюю звезду (проверено: → дважды даёт 2, затем 3). `v-model` работает прямо с ref из `defineModel`. Без `useId` два рейтинга на странице оказались бы одной группой. `.visually-hidden` — `position: absolute`, размер 1px, `clip-path: inset(50%)`, но не `display: none`.

Что спросят дальше: **сброс** в 0 (кнопка «Clear» или повторный клик по выбранной звезде: на выбранном radio `change` не срабатывает, нужен `@click`), **половинки звёзд** (шаг 0.5: radio на каждую половину, звезда рисуется двумя половинами), **read-only** — `role="img"` с `aria-label`.
:::

### 2. Аккордеон · средне

`Accordion` и `AccordionItem`: `v-model` — массив открытых секций, prop `multiple`. Без `v-model` аккордеон работает сам. Разметка и ARIA — по APG.

::: details Решение и разбор
```ts
// accordion.ts
import type { InjectionKey } from 'vue';
export interface AccordionContext {
  isOpen(value: string): boolean;
  toggle(value: string): void;
}
export const accordionKey: InjectionKey<AccordionContext> = Symbol('accordion');
```

```vue
<!-- Accordion.vue -->
<script setup lang="ts">
import { provide } from 'vue';
import { accordionKey } from './accordion';
const open = defineModel<string[]>({ default: () => [] });
const { multiple = false } = defineProps<{ multiple?: boolean }>();
provide(accordionKey, {
  isOpen: (value) => open.value.includes(value),
  toggle(value) {
    // Assign a new array: push() would mutate the parent's array without an emit
    if (open.value.includes(value)) open.value = open.value.filter((v) => v !== value);
    else open.value = multiple ? [...open.value, value] : [value];
  },
});
</script>

<template>
  <div class="accordion"><slot /></div>
</template>
```

```vue
<!-- AccordionItem.vue -->
<script setup lang="ts">
import { computed, inject, useId } from 'vue';
import { accordionKey } from './accordion';
const { value, title, level = 3 } = defineProps<{ value: string; title: string; level?: number }>();
const ctx = inject(accordionKey);
if (!ctx) throw new Error('<AccordionItem> must be used inside <Accordion>');

const id = useId();
const expanded = computed(() => ctx.isOpen(value));
</script>

<template>
  <div class="accordion__item">
    <div role="heading" :aria-level="level">
      <button
        :id="`${id}-button`"
        type="button"
        :aria-expanded="expanded"
        :aria-controls="`${id}-panel`"
        @click="ctx.toggle(value)"
      >
        {{ title }}
      </button>
    </div>
    <!-- v-show keeps the panel in the DOM: aria-controls stays valid, slot state survives -->
    <div v-show="expanded" :id="`${id}-panel`" role="region" :aria-labelledby="`${id}-button`">
      <slot />
    </div>
  </div>
</template>
```

Кнопка внутри заголовка: скринридер находит секции навигацией по заголовкам, а `<button>` даёт Enter/Space и фокус бесплатно. `level` — prop, потому что уровень зависит от места на странице. `value` вместо индекса: секции можно переставлять и фильтровать, и состояние за ними не «переедет». Корень в `AccordionItem` один, поэтому `class` и `data-*` проваливаются на него без предупреждения о фрагменте.

Что спросят дальше: `region` при большом числе секций APG советует не ставить (больше ~6 открытых одновременно — засилье landmark-ов); **запрет закрытия последней** секции — `aria-disabled="true"` на её кнопке; **анимация высоты** — `<Transition>` с `height` от `0` до `scrollHeight` или `interpolate-size: allow-keywords` там, где он поддерживается; **без JS** — `<details name>`.
:::

### 3. Вкладки · средне

`Tabs`, `TabList`, `Tab`, `TabPanel` с `v-model` (значение активной вкладки), disabled-вкладками и клавиатурой по APG: ←/→ по кругу, Home/End, автоматическая активация, пропуск disabled.

::: details Решение и разбор
```ts
// tabs.ts
import type { InjectionKey, Ref } from 'vue';
export interface TabsContext {
  active: Readonly<Ref<string>>;
  select(value: string): void;
  tabId(value: string): string;
  panelId(value: string): string;
}
export const tabsKey: InjectionKey<TabsContext> = Symbol('tabs');
```

```vue
<!-- Tabs.vue -->
<script setup lang="ts">
import { provide, readonly, useId } from 'vue';
import { tabsKey } from './tabs';
const active = defineModel<string>({ required: true });
const id = useId();

provide(tabsKey, {
  active: readonly(active),
  select: (value) => (active.value = value),
  tabId: (value) => `${id}-tab-${value}`,
  panelId: (value) => `${id}-panel-${value}`,
});
</script>

<template>
  <div class="tabs"><slot /></div>
</template>
```

```vue
<!-- TabList.vue -->
<script setup lang="ts">
const { label } = defineProps<{ label: string }>();
function onKeydown(event: KeyboardEvent) {
  const list = event.currentTarget as HTMLElement;
  // DOM order is the source of truth: no registration, works with v-if and v-for
  const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)')];
  const i = tabs.indexOf(event.target as HTMLElement);
  if (i === -1) return;
  const moves: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: -1 };
  if (!(event.key in moves)) return;
  event.preventDefault(); // Home/End would scroll the page
  const tab = tabs.at(moves[event.key] % tabs.length)!; // at(-1) is the last tab
  tab.focus();
  tab.click(); // automatic activation
}
</script>

<template>
  <div role="tablist" :aria-label="label" @keydown="onKeydown"><slot /></div>
</template>
```

```vue
<!-- Tab.vue; TabPanel.vue is the same inject plus
     <div v-show="selected" :id="ctx.panelId(value)" role="tabpanel"
          :aria-labelledby="ctx.tabId(value)" tabindex="0"><slot /></div> -->
<script setup lang="ts">
import { computed, inject } from 'vue';
import { tabsKey } from './tabs';
const { value, disabled = false } = defineProps<{ value: string; disabled?: boolean }>();
const ctx = inject(tabsKey);
if (!ctx) throw new Error('<Tab> must be used inside <Tabs>');
const selected = computed(() => ctx.active.value === value);
</script>

<template>
  <button :id="ctx.tabId(value)" type="button" role="tab" :aria-selected="selected"
    :aria-controls="ctx.panelId(value)" :tabindex="selected ? 0 : -1" :disabled="disabled"
    @click="ctx.select(value)"><slot /></button>
</template>
```

Обработчик один, на `tablist`: всплытие доставит `keydown` от любой вкладки. Порядок берётся из DOM, поэтому `v-if` и `v-for` во вкладках не требуют регистрации. Disabled-вкладки отфильтрованы `:not(:disabled)`, и стрелка через них перепрыгивает. Остаток `% tabs.length` и `at()` с отрицательным индексом дают переход по кругу в обе стороны: `i - 1 = -1` превращается в последнюю вкладку. `tab.click()` переиспользует путь выбора мышью. Проверено в браузере: A → (B disabled) → C → D → A, Home/End, после Tab фокус в панели.

Что спросят дальше: **значение без вкладки** — если `active` не совпал ни с одной вкладкой, у всех `tabindex="-1"` и список недоступен с клавиатуры. Нужен запасной вариант: `tabindex="0"` у первой доступной. **Ручная активация** — убрать `tab.click()`, выбор по Enter/Space даёт сама `<button>`. **Вертикальные вкладки** — `aria-orientation="vertical"` и ↑/↓. **Ленивые панели** — `v-if` по флагу «уже открывалась» внутри `v-show`. **Значения с пробелами** не годятся в id: экранировать или брать индекс.
:::

### 4. Модальное окно · сложно

`Modal` с `v-model:open` и заголовком: фон недоступен, фокус переходит внутрь и возвращается на кнопку-открыватель, Esc, кнопка Close и клик по фону закрывают, прокрутка страницы заблокирована. Окно должно работать и под `v-if` у родителя.

::: details Решение и разбор
```vue
<script setup lang="ts">
import { onBeforeUnmount, useId, useTemplateRef, watch } from 'vue';
const open = defineModel<boolean>('open', { required: true });
const { title } = defineProps<{ title: string }>();
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const titleId = useId();

function lockScroll(on: boolean) {
  document.documentElement.classList.toggle('scroll-locked', on);
}

// Watch the element too: with v-if on the parent it appears after the first run
watch([open, dialog], ([isOpen, el]) => {
  if (!el) return;
  if (isOpen && !el.open) {
    el.showModal(); // top layer, the rest of the page is inert, focus moves inside
    lockScroll(true);
  } else if (!isOpen && el.open) {
    el.close(); // restores focus to the opener
  }
}, { immediate: true });

// Single exit path: Esc, <form method="dialog">, backdrop and close() all fire "close"
function onClose() {
  lockScroll(false);
  open.value = false;
}

onBeforeUnmount(() => {
  if (dialog.value?.open) lockScroll(false); // removal from the DOM fires no "close"
});
</script>

<template>
  <dialog ref="dialog" class="modal" :aria-labelledby="titleId" @close="onClose" @click.self="dialog?.close()">
    <!-- The dialog has no padding: a click on the element itself is a click on the backdrop -->
    <div class="modal__body">
      <h2 :id="titleId">{{ title }}</h2>
      <slot />
      <form method="dialog"><button>Close</button></form>
    </div>
  </dialog>
</template>
```

Два источника истины — `open` и `dialog.open` — сведены так: наружу меняет состояние только `onClose`, а `watch` лишь приводит DOM к модели и проверяет `el.open`, чтобы не вызывать `showModal()` на уже открытом окне: на окне, открытом через `show()`, это `InvalidStateError`. `watch` за самим template ref нужен для `v-if`: при `immediate` первый запуск идёт в `setup`, когда элемента ещё нет, а второй — когда ref заполнится. Клик по фону — это клик по самому `<dialog>`, потому что `::backdrop` принадлежит ему. Если у диалога есть padding, клик по отступу тоже закроет окно, отсюда отступы на внутреннем блоке. Ловушка `.self`: если зажать кнопку мыши на тексте внутри окна и отпустить на фоне, `click` придёт на общего предка — диалог — и закроет окно. Точнее проверять, что и `pointerdown` начался на фоне.

Проверено в Edge: фокус уходит в первое поле, `elementFromPoint` над кнопкой-открывателем возвращает `DIALOG`, после Esc фокус на открывателе и `scroll-locked` снят, `v-if` открывает окно сразу.

Что спросят дальше: **вложенные окна** (top layer — стек, Esc закрывает только верхнее, а блокировку прокрутки нужно считать счётчиком, а не флагом); **подтверждение перед закрытием** — `@cancel` с `preventDefault()` (браузер может проигнорировать повторную отмену без действия пользователя); **анимация** открытия и закрытия — `@starting-style` и `transition-behavior: allow-discrete` для `display` и `overlay`; **версия на `<Teleport>`** — пять пунктов из теории.
:::

## Источники

- [WAI-ARIA Authoring Practices Guide — Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/), [Accordion Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/), [Dialog (Modal) Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), [Radio Group Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/), [Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [HTML Standard — The `dialog` element](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element), [`inert`](https://html.spec.whatwg.org/multipage/interaction.html#the-inert-attribute), [`hidden`](https://html.spec.whatwg.org/multipage/interaction.html#the-hidden-attribute), [`details`](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-details-element), [`progress`](https://html.spec.whatwg.org/multipage/form-elements.html#the-progress-element)
- [WAI-ARIA 1.2 — `progressbar`](https://www.w3.org/TR/wai-aria-1.2/#progressbar)
- [Vue — Component v-model](https://vuejs.org/guide/components/v-model.html), [Provide / Inject](https://vuejs.org/guide/components/provide-inject.html), [Slots](https://vuejs.org/guide/components/slots.html), [Teleport](https://vuejs.org/guide/built-ins/teleport.html), [`useId()`](https://vuejs.org/api/composition-api-helpers.html#useid), [`useTemplateRef()`](https://vuejs.org/api/composition-api-helpers.html#usetemplateref)
- [MDN — `<dialog>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog), [`inert`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert), [`hidden="until-found"`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/hidden), [`checkVisibility()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/checkVisibility); поддержка браузерами — по [MDN browser-compat-data](https://github.com/mdn/browser-compat-data), сверено 2026-11-13
- [Находки «Vue 3.5+: актуальные API и устройство реактивности»](https://github.com/alexrehtide/learning/blob/research/vue-3-5/research/vue-3-5.md)
