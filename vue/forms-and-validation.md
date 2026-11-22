---
title: Формы и валидация
level: ядро
---

# Формы и валидация

> **Коротко.** `v-model` на нативном поле — директива из `runtime-dom`. Она слушает `input` или `change`, приводит строку модификаторами и пропускает промежуточный ввод IME. Источник истины — состояние в JS: атрибут `value` в разметке игнорируется. Форму описывают одним объектом значений плюс снимком начального состояния, от которого считаются `dirty` и `reset`. Отдельно хранится, какие ошибки уже показаны пользователю. Ошибки показывают поздно и убирают рано: первый раз — на `blur` или при отправке, а исправленное поле очищается сразу при вводе. Правила описывают одной схемой (Zod, Valibot) через общий интерфейс Standard Schema и проверяют ею и клиент, и сервер. Проверка на клиенте нужна для удобства пользователя, решение принимает сервер.

**Связанные темы:** [Директивы](./directives.md), [Props, emits и `v-model` на компонентах](./props-emits-v-model.md), [Реактивность: `ref`, `reactive`, `computed`](./reactivity.md), [`watch` и `watchEffect`](./watchers.md), [Composables](./composables.md), [События](../browser/events.md), [debounce и throttle](../live-coding/debounce-throttle.md), [deepClone и deepEqual](../live-coding/object-utilities.md), [Данные и сеть](../architecture/data-and-network.md), [Разбор: автокомплит](../architecture/case-autocomplete.md), [Система типов TypeScript](../typescript/type-system.md), [HTML-формы и нативная валидация](../html-css/html-forms.md)

## Теория

Все проверки выполнены на Vue 3.5.45 в Node 26.13.1. Вывод компилятора получен через `@vue/compiler-sfc`, поведение проверено в happy-dom, SSR — через `@vue/server-renderer`. Схемы проверены на Zod 4.6.7 и Valibot 1.5.0, библиотеки — на VeeValidate 4.15.1 и 5.0.0-beta.1. Те же сценарии `v-model` повторены на `3.6.0-rc.16` и дали тот же результат.

### `v-model` на поле: что важно для форм

Как компилятор выбирает `vModelText`, `vModelCheckbox`, `vModelRadio`, `vModelSelect` или `vModelDynamic` и что делают хуки директивы, разобрано в теме [«Директивы»](./directives.md#v-model-на-нативных-элементах). Для форм важны следствия:

| Элемент | Свойство DOM | Событие | Значение модели |
| --- | --- | --- | --- |
| `<input>`, `<textarea>` | `value` | `input` (`.lazy` — `change`) | строка, с `.number` — число или исходная строка |
| `checkbox` | `checked` | `change` | `boolean`, `true-value`/`false-value`, массив или `Set` |
| `radio` | `checked` | `change` | `value` выбранного (`:value` может быть объектом) |
| `<select>` | `selected` у `<option>` | `change` | значение, для `multiple` — массив или `Set` |

- **Атрибут `value` игнорируется.** `<input value="x" v-model="m">` при `m = ''` даёт пустое поле: `mounted` директивы пишет в `el.value` значение модели. Для статического `value` компилятор молчит, для `:value` выдаёт ошибку «Unnecessary value binding used alongside v-model». Начальные значения задают в состоянии.
- **`.number` и `type="number"`.** Приведение — `looseToNumber`: `parseFloat`, а при `NaN` остаётся исходная строка. Проверено: `''` → `''`, `'abc'` → `'abc'`, `'12px'` → `12`, `'1e3'` → `1000`. Для `type="number"` приведение включается само: рантайм смотрит на `vnode.props.type`, компилятор модификатор не добавляет. На `change` директива перезаписывает поле приведённым значением, и `12px` превращается в `12` на глазах пользователя. Пустое поле даёт `''`, а не `null` и не `0`, поэтому тип `number | null` в состоянии формы врёт.
- **IME.** На `compositionstart` директива ставит `el.composing = true`, и обработчик `input` молча выходит. На `compositionend` флаг снимается, и директива сама отправляет `input`: модель получает итоговый иероглиф, а не латиницу набора. С `.lazy` слушателей композиции нет: `change` и так приходит после окончания ввода. Если нужна реакция на каждый промежуточный символ (подсказки при наборе), вместо `v-model` используют `:value` и свой `@input`.
- **Группа чекбоксов присваивает новый массив.** При отметке директива делает `modelValue.concat(value)`, при снятии — копию со `splice`. Исходный массив не мутирует, поэтому `watch(tags, …)` без `deep` срабатывает. Для `Set` создаётся новый `Set`.
- **`<select>` без совпадающего значения** рисуется невыбранным, а iOS тогда не присылает `change` на первый пункт. Гайд советует первым поставить `<option disabled value="">`.
- **Ввод до гидрации.** При SSR пользователь может начать печатать до того, как загрузился JS. С 3.5.41 `vModelText` сравнивает `el.value` с серверным `defaultValue`. Если пользователь успел что-то ввести, директива записывает это в модель, а не затирает поле. Проверено: `<input>` и `<textarea>` сохранили набранное. Работает **только для `type="text"` и `<textarea>`**: у `type="email"` набранный до гидрации текст заменился значением модели.

Обёртка над полем (`<BaseInput v-model="…">`) — это уже `v-model` на компоненте, то есть prop и событие ([подробнее](./props-emits-v-model.md)). Модификаторы `.trim` и `.number` такой обёртке нужно обработать самой.

### Модель формы: значения, снимок, состояние полей

Форма — это не набор независимых `ref`, а одно состояние со служебными полями вокруг:

- **values** — один `reactive` объект: его отправляют, сбрасывают и валидируют целиком;
- **снимок начальных значений** — отдельная копия, от которой считаются `dirty` (отличается ли форма от исходной) и `reset`;
- **touched** — пользователь побывал в поле и ушёл (`blur`). Это не то же самое, что dirty: можно пройти Tab по полю, ничего не меняя;
- **errors** — результат последней проверки, и отдельно **shown** — ошибки, которые пользователь уже видит. Показ — решение UX, а не результат схемы;
- **isSubmitting**, **submitCount** — для блокировки повторной отправки и для режима «после первой попытки показывать всё».

Две ловушки со снимком. `reactive(initial)` не копирует объект, а оборачивает его в Proxy, и запись в форму меняет сам `initial`. После этого `reset` возвращает форму к уже изменённым значениям. Копировать нужно явно, но `structuredClone(values)` от реактивного объекта падает с `DataCloneError`: Proxy не клонируется. Нужно `structuredClone(toRaw(values))`. `toRaw` снимает Proxy только сверху, но вложенные объекты в сыром оригинале и так сырые. Для `dirty` нужно глубокое сравнение. `JSON.stringify` годится для плоских данных с фиксированным порядком ключей, в общем случае — `deepEqual` ([контракт](../live-coding/object-utilities.md#контракт-deepequal)).

### Когда показывать ошибки

У каждого момента своя цена:

- **на каждый ввод** — ошибка «неверный email» появляется на первой же букве. Пользователь ещё не закончил, а его уже ругают. Такую ошибку исследования UX называют преждевременной;
- **на `blur`** — пользователь закончил с полем. Хорошо подходит для первого показа, но если ошибку исправили, она висит до следующего ухода из поля;
- **при отправке** — честно, но поздно: пользователь узнаёт о пяти ошибках сразу, когда уже ушёл от полей.

Рабочий компромисс называют «reward early, punish late» (хвалить рано, ругать поздно). Новую ошибку показывают на `blur` или при отправке. Уже показанную пересчитывают на каждом вводе, чтобы она исчезла, как только поле стало верным. После первой попытки отправки показывают все ошибки и переводят фокус на первое неверное поле в порядке DOM. Браузер реализует ту же идею в псевдоклассе `:user-invalid`: в отличие от `:invalid`, он срабатывает только после взаимодействия с полем или попытки отправки (Baseline с ноября 2023).

### Нативная constraint validation

Браузер умеет проверять сам: `required`, `type="email"`/`url`, `pattern`, `min`/`max`/`step`, `minlength`/`maxlength`. Результат лежит в `el.validity` (`ValidityState`: `valueMissing`, `typeMismatch`, `patternMismatch`, `tooShort`, `rangeOverflow`, `badInput`, `customError`, `valid` и др.), текст — в `el.validationMessage`.

- **`setCustomValidity(msg)`** делает поле неверным со своим сообщением. Сбрасывается только вызовом `setCustomValidity('')`: пока он не вызван, форма не отправится, что бы пользователь ни вводил.
- **`checkValidity()`** молча проверяет и на каждом неверном поле отправляет отменяемое событие `invalid`. **`reportValidity()`** ещё и показывает ошибку браузерным пузырём. Оба метода есть у поля и у `<form>`.
- При отправке браузер проверяет форму, показывает первую ошибку и переводит на неё фокус. `novalidate` на `<form>` отключает эту интерактивную проверку, а API (`validity`, `checkValidity`) продолжает работать. `form.submit()` проверку и событие `submit` пропускает, `form.requestSubmit()` — нет ([подробнее о событиях](../browser/events.md)).
- Поля с `disabled` (и внутри `<fieldset disabled>`) исключены из проверки (`willValidate === false`) и не попадают в отправляемые данные. `minlength`/`maxlength` проверяются только для ввода пользователя, не для значения, выставленного скриптом.

Чего нативная проверка не умеет: сравнить два поля («пароли совпадают»), сходить на сервер, показать сообщение в дизайне продукта (пузырь не стилизуется, текст на языке браузера) и разделить одни и те же правила с сервером. Частый вариант на практике — `novalidate` плюс своя логика. Атрибуты `required`, `type`, `inputmode` и `autocomplete` при этом оставляют: они дают нужную клавиатуру на мобильных, автозаполнение и семантику для скринридеров. Плюс `:user-invalid` для стилей. Алгоритм отправки и тонкости `ValidityState` — в «[HTML-формах и нативной валидации](../html-css/html-forms.md#constraint-validation-api)».

### Схемная валидация и общая схема с сервером

Схема (Zod, Valibot, ArkType) описывает данные один раз. Из неё получаются рантайм-проверка и тип (`z.infer<typeof schema>`, `v.InferOutput`). Её же импортирует сервер. Клиентская проверка нужна для удобства пользователя: её обходит любой `curl`, поэтому сервер проверяет те же данные сам ([почему типов нет в рантайме](../typescript/type-system.md)).

**Standard Schema** — общий интерфейс таких библиотек. У схемы есть свойство `'~standard'` с `version: 1`, `vendor` и `validate(value)`. `validate` возвращает `{ value }` или `{ issues }`, где у каждой ошибки есть `message` и `path`, либо промис такого результата. Проверено: у схем Zod 4.6 и Valibot 1.5 это свойство есть (`vendor: 'zod'` и `'valibot'`). Для синхронных схем `validate` возвращает результат сразу, со схемой с асинхронным `refine` — промис. Поэтому код формы пишется один раз, а библиотека схем меняется без адаптеров. VeeValidate 4.15 подключает схемы через адаптеры (`toTypedSchema` из `@vee-validate/zod`), а 5.0 (бета, сверено 2026-11-21) принимает Standard Schema напрямую.

Тонкости, которые всплывают в формах:

- **Пустое числовое поле — это `''`.** `z.number()` ругается «expected number, received string»: техническое сообщение для пользователя. `z.coerce.number()` превращает `''` в `0`, и пустое поле молча проходит проверку. Правильно — явно превратить `''` в `undefined` (`z.preprocess`) и дать понятное сообщение.
- **Проверки между полями не запускаются, пока не сошлась структура.** `refine` на объекте в Zod и `v.forward(v.check(…))` в Valibot не выполнились, когда у одного из полей был неверный тип. Когда ошибка была только в значении (возраст меньше 18), выполнились. Поэтому «пароли не совпадают» может появиться только после исправления других полей.
- **Асинхронный `refine`** делает схему асинхронной целиком: синхронный `safeParse` бросает `$ZodAsyncError`. Проверку «логин свободен» лучше держать отдельно от схемы, с debounce и отменой (задача 4).

### Асинхронная проверка и гонки

Проверка на сервере (логин, промокод) — та же задача, что поиск при вводе: debounce, отмена прошлого запроса через `AbortController` в `onWatcherCleanup` и отбрасывание ответа, который пришёл для устаревшего значения. Механика разобрана в темах [«`watch` и `watchEffect`»](./watchers.md#очистка-и-гонки), [«debounce и throttle»](../live-coding/debounce-throttle.md) и [«Разбор: автокомплит»](../architecture/case-autocomplete.md). Специфика форм — состояние `pending`. Пока проверка идёт, поле не считается ни верным, ни неверным, и отправку надо либо дождаться, либо запретить. FormKit, например, считает поле с незавершённым асинхронным правилом неверным.

### Отправка

- **Двойной сабмит.** Флаг `isSubmitting` проверяют и ставят **до первого `await`**. Если сначала дождаться валидации, а флаг поставить потом, два быстрых Enter запустят две отправки (задача 3). `disabled` на кнопке — подсказка, а не защита: атрибут появится только после перерисовки, а второй Enter или клик до неё успевает пройти.
- **Повтор после обрыва.** Флаг не защищает от повтора, когда ответ потерялся в сети. Для этого нужен ключ идемпотентности, созданный при нажатии кнопки, а не при каждой попытке ([«Идемпотентность мутаций»](../architecture/data-and-network.md#идемпотентность-мутаций)).
- **Ошибки сервера** (422 с картой «поле → сообщение») кладут в те же `shown`: пользователь видит их там же, где клиентские. При следующем вводе в поле клиентская проверка их снимает.

### Библиотеки: что дают и чем платите

- **VeeValidate** — composable `useForm` и `defineField(path)`. `defineField` возвращает пару «модель + атрибуты» для поля, форма собирает значения, ошибки, `meta` (`dirty`, `touched`, `valid`) и даёт `handleSubmit`. Работает со схемами, разметку не навязывает. По умолчанию `defineField` проверяет на каждое изменение модели, это настраивается.
- **FormKit** — компоненты `<FormKit type="email" validation="required|email">` с готовыми label, help и сообщениями. Режимы показа ошибок — `validation-visibility`: `blur` (по умолчанию), `live`, `dirty`, `submit`. Есть генерация формы из JSON-схемы.

Цена — объём бандла, своя модель поверх Vue и привязка к компонентам или строковым правилам. В FormKit разметка и стили идут от библиотеки. Для пяти полей хватает своего composable на сотню строк (пример ниже). Библиотека окупается, когда есть массивы полей, вложенные группы, мастера на несколько шагов и десятки однотипных форм.

### Доступность ошибок, кратко

У каждого поля есть `<label for>`. Неверное поле получает `aria-invalid="true"` и `aria-describedby` с id элемента ошибки: скринридер прочитает сообщение вместе с полем. При неудачной отправке фокус переходит на первое неверное поле. Для длинной формы можно показать сводку ошибок со ссылками на поля. Сообщение не должно передаваться только цветом. Подробно — в разделе «Доступность».

> [!NOTE]
> Во Vue 3.6 (RC, `3.6.0-rc.16`, сверено 2026-11-21) для обычных компонентов `v-model` компилируется так же. Все сценарии этой темы (модификаторы, IME, чекбоксы, ввод до гидрации) дали тот же результат. В Vapor-режиме директив нет: компилятор вызывает `applyTextModel(el, () => _ctx.a, v => (_ctx.a = v), { trim: true })`, `applyCheckboxModel`, `applySelectModel` с геттером и сеттером. Работа с DOM — те же функции `vModelTextInit` и `vModelTextUpdate` из `runtime-dom`. Стабильного 3.6 пока нет.

## Примеры

### `useForm` поверх Standard Schema

Значения, снимок для `reset` и `dirty`, «reward early, punish late», защита от двойной отправки, фокус на первую ошибку и ошибки сервера в одном месте. Проверено в happy-dom со схемой Zod. Ошибка не видна во время набора. Она появляется на `blur`, исчезает на вводе исправления и не появляется снова, пока пользователь не уйдёт из поля. Два `submit` подряд дали один вызов `onSubmit`.

```js
// useForm.js
import { reactive, ref, computed, toRaw, watch, nextTick } from 'vue'

const keyOf = (path = []) => path.map((p) => (typeof p === 'object' ? p.key : p)).join('.')

export function useForm(schema, initial, onSubmit) {
  const snapshot = structuredClone(initial) // a private copy: values must not share objects with it
  const values = reactive(structuredClone(snapshot))
  const errors = ref({}) // current schema result: path -> first message
  const shown = reactive({}) // what the user sees
  const isSubmitting = ref(false)
  const serialized = computed(() => JSON.stringify(values))
  const dirty = computed(() => serialized.value !== JSON.stringify(snapshot))

  async function validate() {
    const result = await schema['~standard'].validate(structuredClone(toRaw(values)))
    const next = {}
    for (const issue of result.issues ?? []) next[keyOf(issue.path)] ??= issue.message
    errors.value = next
    return result
  }

  // Validate on every change; refresh only the errors that are already shown.
  watch(values, () => {
    validate().then(() => {
      for (const name in shown) if (shown[name]) shown[name] = errors.value[name]
    })
  }, { deep: true })

  async function blur(name) {
    await validate()
    shown[name] = errors.value[name]
  }

  async function handleSubmit(event) {
    if (isSubmitting.value) return // the guard comes before any await
    isSubmitting.value = true
    try {
      const result = await validate()
      if (result.issues) {
        Object.assign(shown, errors.value)
        await nextTick() // wait for aria-invalid in the DOM
        event.target.querySelector('[aria-invalid="true"]')?.focus()
        return
      }
      await onSubmit(result.value, (serverErrors) => Object.assign(shown, serverErrors))
    } finally {
      isSubmitting.value = false
    }
  }

  function reset() {
    Object.assign(values, structuredClone(snapshot))
    for (const name in shown) delete shown[name]
  }

  return { values, shown, dirty, isSubmitting, blur, handleSubmit, reset }
}
```

```vue
<script setup>
import * as z from 'zod'
import { useForm } from './useForm'

const schema = z.object({ email: z.email('Enter a valid email'), name: z.string().min(2, 'Too short') })
const { values, shown, isSubmitting, blur, handleSubmit } = useForm(
  schema,
  { email: '', name: '' },
  async (data, setErrors) => {
    const res = await fetch('/api/signup', { method: 'POST', body: JSON.stringify(data) })
    if (res.status === 422) setErrors(await res.json()) // { email: 'Already registered' }
  },
)
</script>

<template>
  <form novalidate @submit.prevent="handleSubmit">
    <label for="email">Email</label>
    <input id="email" v-model.trim="values.email" type="email" autocomplete="email" required
      :aria-invalid="!!shown.email" :aria-describedby="shown.email ? 'email-error' : undefined"
      @blur="blur('email')">
    <p v-if="shown.email" id="email-error">{{ shown.email }}</p>
    <!-- the name field is the same -->
    <button :disabled="isSubmitting">Sign up</button>
  </form>
</template>
```

Чего здесь нет, а в продакшне понадобится: массивы и вложенные поля (путь `items.0.title` уже собирается из `issue.path`), отмена устаревшей асинхронной валидации и `deepEqual` вместо `JSON.stringify`.

## Вопросы с интервью

::: details Как v-model работает на обычном input и почему модель не меняется во время ввода через IME
Компилятор ставит на элемент директиву `vModelText` и кэшированный обработчик `onUpdate:modelValue`, который присваивает значение. Директива в `created` вешает слушатель `input` (с `.lazy` — `change`), читает `el.value`, применяет `.trim`/`.number` и вызывает присваивание. В `mounted` и `beforeUpdate` она пишет модель обратно в `el.value`, но не трогает поле, если значение совпадает. Если поле в фокусе, то с `.trim` не съедает только что набранные пробелы. Во время композиции IME (`compositionstart` → `compositionend`) стоит флаг `el.composing`, и `input` игнорируется. На `compositionend` директива сама отправляет `input`, и модель получает итоговый текст. Если нужен каждый промежуточный символ, используют `:value` и `@input` вручную. Атрибут `value` в разметке игнорируется: источник истины — состояние.
:::

::: details Почему пустое поле с модификатором number даёт пустую строку, а не ноль или null
`.number` вызывает `looseToNumber`: `parseFloat`, и если получился `NaN`, остаётся исходная строка. `parseFloat('')` — `NaN`, поэтому `''` остаётся `''`, а `'abc'` — `'abc'`. Это отличается от `valueAsNumber` (`NaN`) и от `Number('')` (`0`). Для `type="number"` то же приведение включается само. Следствия: тип поля фактически `number | string`, а схема должна явно превращать `''` в «не заполнено». `z.coerce.number()` для этого не годится, он даёт `0`.
:::

::: details Когда показывать ошибки валидации и почему
Новую ошибку — не раньше, чем пользователь закончил с полем: на `blur` или при попытке отправки. Ошибка на каждом вводе ругает человека, который ещё печатает. Уже показанную ошибку пересчитывают на каждый ввод, чтобы она исчезла сразу после исправления, иначе пользователь не понимает, исправил ли он. При неудачной отправке показывают все ошибки и переводят фокус на первое неверное поле в порядке DOM. Такой подход называют «reward early, punish late». Браузер делает то же для стилей через `:user-invalid`, у FormKit по умолчанию показ на `blur`. Для этого нужно хранить два набора: текущие ошибки схемы и ошибки, которые пользователь уже видит.
:::

::: details Нативная constraint validation или своя: что выбрать
Нативная бесплатна: `required`, `type`, `pattern`, `min`/`max` проверяет браузер, `ValidityState` и `:user-invalid` доступны без JS, а при отправке браузер сам ставит фокус на ошибку. Ограничения: пузырь не стилизуется и говорит на языке браузера, нет проверок между полями и запросов на сервер, правила не разделить с сервером. `setCustomValidity` расширяет её, но сообщение надо снимать `setCustomValidity('')`, иначе форма заблокирована навсегда. Типичный выбор в SPA — `novalidate` плюс схема. Атрибуты `required`, `type`, `autocomplete`, `inputmode` остаются ради клавиатуры, автозаполнения и семантики. Сервер проверяет данные в любом случае.
:::

::: details Как правильно сделать dirty и reset
Нужен снимок начальных значений, отдельный от состояния формы. `reactive(initial)` оборачивает тот же объект, поэтому запись в форму меняет снимок, и `reset` ничего не сбрасывает. `structuredClone` от реактивного объекта падает с `DataCloneError`, поэтому клонируют `toRaw(values)`. `dirty` — глубокое сравнение значений со снимком, а не флаг «было событие input»: если пользователь ввёл и стёр, форма не грязная. `touched` — отдельный признак (поле посетили), не путать с `dirty`. Когда данные пришли с сервера после монтирования, снимок обновляют вместе со значениями, иначе форма сразу станет грязной.
:::

::: details Зачем общая схема клиента и сервера и что такое Standard Schema
Одна схема даёт рантайм-проверку, тип TypeScript и одинаковые правила на клиенте и сервере: нет расхождения «на клиенте пропустило, сервер отклонил с непонятной ошибкой». Клиентская проверка нужна для удобства, обходится она тривиально, поэтому сервер проверяет те же данные сам. Standard Schema — общий интерфейс: у схемы есть свойство `'~standard'` с `validate(value)`, которое возвращает `{ value }` или `{ issues: [{ message, path }] }`, синхронно или промисом. Его реализуют Zod 4, Valibot 1, ArkType 2. Форма или библиотека форм пишется против интерфейса и не зависит от конкретной библиотеки схем: VeeValidate 5 (бета) принимает такие схемы напрямую.
:::

::: details Как защититься от двойной отправки формы
Флаг `isSubmitting`, который проверяют и ставят синхронно, до первого `await`. Если поставить его после асинхронной валидации, два быстрых submit оба пройдут проверку. `disabled` на кнопке — подсказка, а не защита: он появится только после перерисовки, а второй Enter или клик до неё успевает пройти. Снимают флаг в `finally`. От повтора после потерянного ответа флаг не спасает: для этого нужен ключ идемпотентности, созданный один раз на намерение, и сервер, который по нему узнаёт повтор.
:::

## Задачи

### 1. Найдите баг · легко

После правки полей кнопка «Сбросить» ничего не меняет.

```js
const initial = { email: '', name: '' }
const values = reactive(initial)

function reset() {
  Object.assign(values, initial)
}
```

::: details Решение и разбор
`reactive(initial)` не копирует объект: Proxy пишет прямо в `initial`. После ввода `initial.email` уже равен введённому значению (проверено), и `reset` копирует значения сами в себя.

```js
const snapshot = structuredClone(initial)
const values = reactive(structuredClone(snapshot))

function reset() {
  Object.assign(values, structuredClone(snapshot)) // a fresh copy: nested objects must not be shared
}
```

Копия в `reset` тоже нужна: без неё вложенные объекты снимка попадут в форму и испортятся при следующей правке. Если копировать от текущей формы, то только через `toRaw`: `structuredClone(values)` бросает `DataCloneError`.
:::

### 2. Что окажется в модели · легко

```vue
<script setup>
const age = ref(null)
const price = ref('')
</script>

<template>
  <input type="number" v-model="age">
  <input v-model.number="price">
</template>
```

Пользователь стирает возраст до пустого поля, а в цену вводит по очереди `12px`, `abc`, `1e3`. Что будет в `age` и `price` после каждого ввода и что увидит пользователь в поле цены, уйдя из него после `12px`?

::: details Решение и разбор
`age` — `''`, а не `null`: пустая строка не парсится, и `looseToNumber` возвращает исходную строку. `price`: `12px` → `12`, `abc` → `'abc'`, `1e3` → `1000`. После `change` директива перезаписывает поле приведённым значением, и пользователь видит `12` вместо `12px`. Проверено в happy-dom.

Вывод для формы: модель числового поля имеет тип `number | string`. Схема должна явно превратить `''` в «не заполнено» и дать понятную ошибку для нечисла. `z.coerce.number()` не подходит: `''` станет `0` и пройдёт проверку.
:::

### 3. Найдите баг · средне

Форма регистрации иногда создаёт двух пользователей. Проверка асинхронная (схема с `refine`, который ходит на сервер).

```js
const isSubmitting = ref(false)

async function handleSubmit() {
  if (isSubmitting.value) return
  const result = await schema['~standard'].validate(toRaw(values))
  if (result.issues) return showErrors(result.issues)
  isSubmitting.value = true
  try {
    await api.signup(result.value)
  } finally {
    isSubmitting.value = false
  }
}
```

::: details Решение и разбор
Флаг ставится после `await`. Пока идёт валидация, второй submit (двойной Enter, двойной клик до перерисовки) видит `isSubmitting === false` и тоже проходит. В проверке два вызова подряд дали два `signup`. Исправление — занять флаг синхронно, до первого `await`:

```js
async function handleSubmit() {
  if (isSubmitting.value) return
  isSubmitting.value = true
  try {
    const result = await schema['~standard'].validate(structuredClone(toRaw(values)))
    if (result.issues) return showErrors(result.issues)
    await api.signup(result.value)
  } finally {
    isSubmitting.value = false
  }
}
```

Если ответ сервера потерялся, а пользователь нажал ещё раз, флаг уже снят, и запрос уйдёт повторно. От этого защищает ключ идемпотентности, созданный при первом нажатии. Вторая мелочь: в схему лучше передавать копию, иначе асинхронная проверка читает объект, который пользователь продолжает править.
:::

### 4. Проверка «логин свободен» · средне

Реализуйте `useAsyncCheck(source, check, delay)`: при изменении `source` ждёт `delay` мс тишины, вызывает `check(value, signal)` и возвращает `ref` со статусом `'idle' | 'pending' | 'ok' | 'invalid' | 'error'`. Устаревший запрос отменяется, а его ответ, если сервер проигнорировал `signal`, не должен перезаписать статус.

::: details Решение и разбор
```js
import { ref, watch } from 'vue'

export function useAsyncCheck(source, check, delay = 300) {
  const state = ref('idle')
  watch(source, (value, _old, onCleanup) => {
    if (!value) {
      state.value = 'idle'
      return
    }
    state.value = 'pending'
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const ok = await check(value, controller.signal)
        if (controller.signal.aborted) return // check() ignored the signal: drop the stale answer
        state.value = ok ? 'ok' : 'invalid'
      } catch {
        if (!controller.signal.aborted) state.value = 'error'
      }
    }, delay)
    onCleanup(() => {
      clearTimeout(timer)
      controller.abort()
    })
  })
  return state
}
```

Очистка `watch` выполняется перед следующим запуском и при остановке scope. Она снимает таймер (debounce) и отменяет запрос. Проверка `signal.aborted` после `await` закрывает гонку с сервером, который сигнал игнорирует. В проверке медленный ответ «занят» для `alic` пришёл после быстрого «свободен» для `alice` и был отброшен: итог `ok`. `pending` ставится сразу, а не после задержки, чтобы форма не считала поле проверенным и кнопка отправки знала, что ждать.
:::

### 5. Найдите баг · средне

Поле «Повторите пароль» использует нативную проверку. После первого несовпадения форма перестаёт отправляться, даже когда пароли одинаковые.

```vue
<script setup>
const password = ref('')
const confirm = ref('')
const confirmEl = useTemplateRef('confirmEl')

function check() {
  if (confirm.value !== password.value) {
    confirmEl.value.setCustomValidity('Passwords differ')
  }
}
</script>

<template>
  <form @submit.prevent="save">
    <input v-model="password" type="password" required>
    <input ref="confirmEl" v-model="confirm" type="password" required @input="check">
    <button>Save</button>
  </form>
</template>
```

::: details Решение и разбор
Два бага. Первый: `setCustomValidity` с непустой строкой ставит `customError`, и снимается он только вызовом `setCustomValidity('')`. Его здесь нет, поэтому поле неверно навсегда, и браузер блокирует отправку. Второй: проверка запускается только при вводе в подтверждение. Если пользователь исправит первый пароль, сообщение останется.

```js
watch([password, confirm], ([p, c]) => {
  confirmEl.value?.setCustomValidity(c && p !== c ? 'Passwords differ' : '')
}, { flush: 'post' })
```

`flush: 'post'` гарантирует, что ref на элемент уже заполнен. Проверку зависимого поля ставят на оба источника. Это частый случай, где нативной проверки не хватает: в схеме то же правило — `refine` с `path: ['confirm']`, и оно работает и на сервере.
:::

## Источники

- [Vue.js: Form Input Bindings](https://vuejs.org/guide/essentials/forms.html)
- [Исходники Vue 3.5.45: `runtime-dom/src/directives/vModel.ts`](https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-dom/src/directives/vModel.ts)
- [`vuejs/core` CHANGELOG.md: 3.5.41 — v-model: preserve text input before hydration (#14411)](https://github.com/vuejs/core/blob/v3.5.45/CHANGELOG.md)
- [`vuejs/core` CHANGELOG.md, ветка `minor` (3.6)](https://github.com/vuejs/core/blob/minor/CHANGELOG.md)
- [HTML Living Standard: Constraints (constraint validation, user validity)](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constraints)
- [MDN: Constraint validation](https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Constraint_validation)
- [MDN: `:user-invalid`](https://developer.mozilla.org/en-US/docs/Web/CSS/:user-invalid)
- [Standard Schema](https://standardschema.dev/)
- [Zod 4](https://zod.dev/)
- [Valibot](https://valibot.dev/)
- [VeeValidate: Composition API](https://vee-validate.logaretm.com/v4/guide/composition-api/getting-started/)
- [FormKit: Validation](https://formkit.com/essentials/validation)
