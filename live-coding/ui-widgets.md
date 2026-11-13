---
title: 'UI-coding: автокомплит, таблица, дерево'
level: ядро
---

# UI-coding: автокомплит, таблица, дерево

> **Коротко.** Это компоненты, которые работают с данными, поэтому основная сложность в них не в разметке, а в состоянии. Автокомплит проверяет асинхронность: debounce, отмену устаревших запросов, гонку ответов, кэш, а также паттерн combobox, где фокус остаётся в поле и активную опцию указывает `aria-activedescendant`. Таблица проверяет производные данные: цепочку `computed` «фильтр → сортировка → страница», стабильную сортировку по локали и `aria-sort`. Дерево проверяет рекурсию: компонент, который рендерит сам себя, ленивую загрузку детей, состояние раскрытия отдельно от данных и клавиатуру tree view. Для больших деревьев его превращают в плоский список.

**Связанные темы:** [UI-coding: базовые компоненты на Vue](./ui-components.md), [debounce и throttle](./debounce-throttle.md), [async/await, обработка ошибок и отмена](../javascript/async-await.md), [Сортировки и бинарный поиск](../algorithms/sorting-and-searching.md), [Деревья и графы](../algorithms/trees-and-graphs.md), [Оптимизация runtime и профилирование](../performance/runtime.md), [Производительность Vue и Nuxt](../performance/vue-performance.md), [XSS и безопасный вывод во Vue](../security/xss.md)

## Теория

Код — Vue 3.5 `<script setup lang="ts">`. Всё проверено на Vue 3.5.45: типы — `vue-tsc` в strict-режиме, поведение — в Edge (Chromium) через Playwright. Общие приёмы (контракт компонента, `provide`/`inject`, roving tabindex, `useId`) разобраны в теме [«UI-coding: базовые компоненты на Vue»](./ui-components.md). Здесь — то, что добавляют данные.

Общее правило для всех трёх виджетов: **данные отдельно, состояние интерфейса отдельно, производное — через `computed`**. Строки таблицы и узлы дерева приходят снаружи и не мутируются. Запрос, сортировка, страница и раскрытые узлы хранятся в компоненте, а то, что показывать, вычисляется из них.

### Автокомплит: конвейер запроса

На каждое изменение текста:

1. **Нормализовать** запрос (`trim`, нижний регистр) и проверить **минимальную длину**: по одной букве сервер вернёт половину базы.
2. **Кэш**: повторный запрос отдаётся сразу, без таймера и сети. Ключ нормализованный, иначе `Vue` и `vue ` — разные записи. Неограниченный `Map` растёт всю сессию, в проде нужны лимит ([LRU на `Map`](../algorithms/stacks-and-queues.md)) и время жизни записи.
3. **Debounce**: запрос уходит, когда пользователь перестал печатать на `wait` мс.
4. **Отмена**: новый ввод отменяет и ждущий таймер, и запрос в полёте (`AbortController`).
5. **Проверка актуальности** перед записью результата: fetcher может игнорировать `signal`, и тогда от гонки защищает только она.

Debounce уменьшает число запросов, но гонку не устраняет: два запроса с паузой больше `wait` уходят оба, и ответы могут прийти в обратном порядке ([подробнее](../javascript/async-await.md)). Пока идёт загрузка, старые результаты лучше оставить на экране, чтобы список не мигал.

> [!WARNING]
> Внешняя утилита `debounce` вокруг колбэка `watch` ломает очистку: `onWatcherCleanup` работает, только если вызван синхронно в колбэке watcher-а, а debounced-функция выполняется позже, из таймера ([разбор](./debounce-throttle.md)). Проще завести таймер прямо в колбэке и снимать его в той же очистке, что и `abort()` (задача 1). Очистка срабатывает перед следующим запуском и при размонтировании компонента.

### Combobox: фокус остаётся в поле

Паттерн APG «Combobox» с выпадающим списком: у `<input>` — `role="combobox"`, `aria-expanded`, `aria-controls` (id списка), `aria-autocomplete="list"` и `aria-activedescendant` (id активной опции); у списка — `role="listbox"` с именем; у опций — `role="option"`, `aria-selected="true"` у визуально активной. Клавиши: ↓/↑ открывают список и переходят по опциям (↑ к последней — опционально), Enter принимает опцию, Esc закрывает список, а если он уже закрыт — по желанию очищает поле. Home/End и ←/→ остаются за полем и двигают курсор в тексте. ARIA 1.0 связывал поле со списком через `aria-owns`, сейчас APG рекомендует `aria-controls`.

DOM-фокус всё время в `<input>`, иначе пользователь не сможет печатать дальше. Стрелки меняют только индекс активной опции, а `aria-activedescendant` сообщает о ней скринридеру. Отсюда обязанности, которые браузер сам не выполнит:

- **Прокрутка**: фокуса на опции нет, значит, браузер не прокрутит к ней список. Нужен `scrollIntoView({ block: 'nearest' })`.
- **Клик мышью**: `mousedown` на опции уводит фокус из поля, `blur` закрывает список, и `click` уходит в пустоту. Решение — `@mousedown.prevent` на опции: фокус остаётся в поле.
- **IME**: при вводе через метод ввода (китайский, японский) Enter подтверждает композицию, а не выбирает опцию. Проверяйте `event.isComposing`. `v-model` во время композиции не обновляется.
- **Объявление результатов**: «5 results», «Loading…», «Search failed» читаются через live region (`role="status"`), иначе незрячий пользователь не узнает, что список изменился. `autocomplete="off"` убирает подсказки браузера поверх ваших.

### Таблица данных: цепочка `computed`

Конвейер — три `computed`, каждый зависит от предыдущего: `filtered` → `sorted` → `visible` (страница). Переход на другую страницу пересчитывает только `slice`, фильтр и сортировка берутся из кэша. Тот же конвейер методом в шаблоне (`v-for="row in paginate(sort(filter(rows)))"`) выполняется заново на каждом рендере компонента, даже если поменялся только hover.

Детали, на которых ловят:

- **`sort()` мутирует массив.** Если это props, вы переставили массив родителя. `toSorted()` (ES2023) возвращает копию.
- **Стабильность** гарантирована с ES2019: при равных ключах сохраняется прежний порядок. Поэтому «по городу, затем по имени» — это сортировка по имени, а потом по городу ([подробно](../algorithms/sorting-and-searching.md)).
- **Строки — через `Intl.Collator`**, созданный один раз, с `numeric: true` (`file2` раньше `file10`). Числа сравнивают вычитанием.
- **Пустые значения** — в конце при любом направлении, поэтому их обрабатывают до умножения на знак направления.
- **Страница**: смена фильтра сбрасывает её на первую, а уменьшение числа строк ограничивает номер последней страницей.
- **Доступность**: `<caption>`, `<th scope="col">`, кнопка внутри `<th>` (её можно нажать с клавиатуры), `aria-sort="ascending|descending"` — только на текущей колонке. Стрелки ▲▼ — `aria-hidden`.

На десятках тысяч строк меняют архитектуру. Фильтр, сортировку и пагинацию переносят на сервер, а их параметры — в URL (`?sort=name&page=2`), чтобы ссылка воспроизводила вид. Если все строки нужны на клиенте, массив кладут в `shallowRef`, а DOM виртуализируют: рендерят только видимые строки ([как это устроено](../performance/runtime.md), [во Vue](../performance/vue-performance.md)).

### Дерево: рекурсивный компонент

SFC может ссылаться на себя по имени файла: `TreeItem.vue` рендерит `<TreeItem>` для каждого ребёнка. Если импорт с тем же именем конфликтует, у импорта приоритет, и его переименовывают. Глубина вложенности компонентов равна глубине дерева, и каждый узел — отдельный экземпляр компонента.

Состояние интерфейса лежит не в узлах (`node.expanded = true` — мутация чужих данных), а рядом, в корне, по id: раскрытые — `Set`, загруженные дети — `Map`, загружаемые — ещё один `Set`. Узлы получают его через `provide`/`inject`. **Ленивая загрузка**: дети запрашиваются при первом раскрытии папки. Повторное раскрытие берёт их из `Map`, повторный запрос во время загрузки отсекается проверкой `loading`. При ошибке папку сворачивают, и следующее раскрытие повторит запрос.

ARIA (APG «Tree View»): корневой `<ul role="tree">` с именем; каждый узел — `treeitem` с `aria-selected`, если узлы выбираемые; `aria-expanded` **только у папок**, у листьев атрибута нет вовсе; дети — в `<ul role="group">` внутри `treeitem`. Клавиатура: ↓/↑ — следующий и предыдущий видимый узел; → на закрытой папке открывает её, на открытой — переходит к первому ребёнку; ← на открытой закрывает, иначе переходит к родителю; Home/End; Enter — действие узла. По желанию: `*` раскрывает всех соседей, type-ahead переходит по первым буквам (APG рекомендует его для деревьев с более чем 7 корнями). Фокус — roving tabindex: дерево — одна остановка Tab, `tabindex="0"` у последнего сфокусированного узла, иначе у выбранного, иначе у первого.

**Плоское представление.** Для тысяч узлов дерево превращают в массив **видимых** строк `{ node, level, posinset, setsize }`: обход в глубину, который спускается только в раскрытые папки, `posinset` — номер среди соседей, `setsize` — их число. Работа — O(видимых узлов), а в `computed` список пересчитывается только при раскрытии, сворачивании и загрузке. Его рендерит один `v-for` с отступом по `level`, его можно виртуализировать, а клавиатура сводится к арифметике индексов. Цена — `aria-level`, `aria-setsize` и `aria-posinset` вручную: APG требует их, когда в DOM не все узлы, а уровни больше не следуют из вложенности `group`.

## Примеры

Подсветка совпадения без `v-html`: функция режет строку на сегменты, шаблон выводит их как текст, совпавшие — в `<mark>` (шаблон — в задаче 2).

```ts
// highlight.ts
export interface Segment { text: string; match: boolean }

export function highlight(text: string, query: string): Segment[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  // RegExp.escape: "." or "+" in the query are literal characters, not syntax
  const re = new RegExp(RegExp.escape(q), 'giu');
  const segments: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), match: false });
    segments.push({ text: m[0], match: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return segments;
}
```

Позиции берутся из того же регулярного выражения, которым ищем, поэтому совпадают с исходной строкой. Искать `text.toLowerCase().indexOf(q)` и резать исходный `text` по найденному индексу нельзя: нижний регистр может изменить длину строки (`'İ'.toLowerCase().length === 2`). `RegExp.escape` — ES2025 (Chrome 136, Firefox 134, Safari 18.2; типы — с TypeScript 6.0, `lib: es2025`). Без экранирования запрос `c++` бросит `SyntaxError`. Флаг `i` не отождествляет `е` и `ё`: это задача нормализации данных.

## Вопросы с интервью

::: details Как устранить гонку ответов в автокомплите и почему debounce не помогает
Debounce сокращает число запросов, но два запроса с паузой больше `wait` уходят оба, и ответ на старый может прийти позже. Надёжно — отменять предыдущий запрос при новом вводе (`AbortController`, `signal` в `fetch`) и перед записью проверять, что ответ относится к последнему запросу: не всякий API поддерживает отмену. Во Vue это `watch` с `onWatcherCleanup(() => controller.abort())`, зарегистрированным синхронно, до первого `await`. Та же очистка снимает таймер debounce и срабатывает при размонтировании.
:::

::: details Почему в комбобоксе фокус остаётся в поле и как тогда работает клавиатура
Пользователь должен продолжать печатать, поэтому DOM-фокус не уходит из `<input>`. Стрелки меняют индекс активной опции, а `aria-activedescendant` на поле сообщает скринридеру её id. Побочные эффекты: браузер не прокручивает активную опцию (нужен `scrollIntoView`), клик по опции уводит фокус до `click` (нужен `@mousedown.prevent`), Enter во время IME-композиции не должен выбирать опцию (`event.isComposing`).
:::

::: details Как подсветить совпадение в подсказке без v-html
Разбить строку на сегменты «совпало / не совпало» и вывести их в шаблоне как текст, совпавшие — в `<mark>`. Интерполяция экранирует, поэтому XSS исключён. HTML-строка с `<mark>` через `v-html` — XSS, если подсказки приходят от пользователей. Регулярное выражение строят через `RegExp.escape`, а позиции берут из самого совпадения: индексы, найденные в `toLowerCase()`-копии, не всегда совпадают с исходной строкой.
:::

::: details Где сортировать и фильтровать таблицу: в computed, в методе шаблона или на сервере
`computed` кэширует результат до изменения зависимостей, а цепочка «фильтр → сортировка → страница» пересчитывает только изменившееся звено. Метод в шаблоне выполняется на каждом рендере. На клиенте — пока строк тысячи и они уже загружены. Если больше или загружены не все — на сервере, с параметрами в URL. Тогда клиенту остаются запрос и отмена устаревших, как в автокомплите.
:::

::: details Как сделать сортируемую таблицу доступной
Настоящая `<table>` с `<caption>` и `<th scope="col">`. Сортировка запускается кнопкой внутри `<th>`: заголовок без кнопки нельзя нажать с клавиатуры. На отсортированной колонке — `aria-sort="ascending"` или `"descending"`, с остальных атрибут снимают. Иконки-стрелки — `aria-hidden`, чтобы не попали в имя кнопки. Номер страницы и «No results» полезно объявлять через live region.
:::

::: details Рекурсивный компонент или плоский список для дерева
Рекурсивный компонент повторяет структуру данных, а вложенные `<ul role="group">` сами задают уровни для доступности. Код короткий, свёрнутые ветки не рендерятся. Минусы: экземпляр компонента на узел, клавиатура через обход DOM, виртуализировать нельзя. Плоский список видимых узлов — один `v-for`, клавиатура по индексу, виртуализация, но `aria-level`, `aria-setsize` и `aria-posinset` ставятся вручную. Выбор — по размеру: сотни узлов — рекурсия, тысячи — плоский список.
:::

## Задачи

### 1. Поиск с debounce, отменой и кэшем · средне

Composable `useSearch(query, fetcher, { wait, minLength })` возвращает `results` и `status` (`idle`, `loading`, `success`, `error`). Лишние запросы не уходят, устаревший ответ не перезаписывает новый, повторный запрос берётся из кэша, при размонтировании всё отменяется.

::: details Решение и разбор
```ts
// useSearch.ts
import { onWatcherCleanup, ref, shallowRef, watch, type Ref } from 'vue';

export type Status = 'idle' | 'loading' | 'success' | 'error';
type Fetcher<T> = (query: string, signal: AbortSignal) => Promise<T[]>;

export function useSearch<T>(query: Ref<string>, fetcher: Fetcher<T>, { wait = 300, minLength = 2 } = {}) {
  const results = shallowRef<T[]>([]);
  const status = ref<Status>('idle');
  const cache = new Map<string, T[]>();

  watch(query, (raw) => {
    const q = raw.trim().toLowerCase(); // one cache key for "Vue", "vue " and "VUE"
    const cached = cache.get(q);
    if (q.length < minLength || cached) {
      results.value = cached ?? [];
      status.value = cached ? 'success' : 'idle';
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      status.value = 'loading'; // old results stay visible: no flicker
      try {
        const items = await fetcher(q, controller.signal);
        if (controller.signal.aborted) return; // the fetcher may ignore the signal
        cache.set(q, items);
        results.value = items;
        status.value = 'success';
      } catch {
        if (!controller.signal.aborted) status.value = 'error';
      }
    }, wait);
    // Registered synchronously, before any await: runs before the next run and on unmount
    onWatcherCleanup(() => {
      clearTimeout(timer); // debounce: a new keystroke cancels the pending request
      controller.abort(); // race: a request already in flight is cancelled
    });
  });

  return { results, status };
}
```

Debounce и отмена — одна очистка: новый ввод снимает таймер, если запрос ещё не ушёл, и отменяет запрос, если ушёл. Проверено в Node 26 на реальных таймерах: `ab` → `abc` быстрее `wait` дают один запрос; медленный `ab`, перебитый `abcd`, отменён, на экране — `abcd`; `' ABC '` берётся из кэша синхронно; после `scope.stop()` запрос в полёте отменён; ответ fetcher-а, игнорирующего `signal`, отброшен. `shallowRef`: массив заменяется целиком, глубокая реактивность не нужна. Ошибки и отмены не кэшируются.

Что спросят дальше: **TTL** (хранить `{ items, at }`), **лимит** — LRU, **ошибка с повтором** (`error` и `retry`), **префиксная фильтрация** — если ответ на `ab` полный, `abc` фильтруется из него на клиенте.
:::

### 2. Автокомплит по паттерну combobox · сложно

Компонент `Autocomplete<T>` поверх `useSearch`: `v-model` — выбранный элемент, props — `label`, `fetcher`, `getLabel`. Клавиатура по APG, подсветка совпадения, выбор мышью, объявление числа результатов. Компонент стоит внутри `<form>`, и Enter при выборе её не отправляет.

::: details Решение и разбор
```vue
<!-- Autocomplete.vue -->
<script setup lang="ts" generic="T">
import { computed, ref, useId, watch } from 'vue';
import { highlight } from './highlight';
import { useSearch } from './useSearch';

const selected = defineModel<T | null>({ required: true });
const { label, fetcher, getLabel } = defineProps<{
  label: string;
  fetcher: (query: string, signal: AbortSignal) => Promise<T[]>;
  getLabel: (item: T) => string;
}>();

const id = useId();
const query = ref('');
const { results, status } = useSearch(query, fetcher);
const open = ref(false);
const active = ref(-1); // index of the "virtually focused" option
const optionId = (i: number) => `${id}-option-${i}`;
const expanded = computed(() => open.value && results.value.length > 0);
const message = computed(() =>
  ({ idle: '', loading: 'Loading…', error: 'Search failed', success: `${results.value.length} results` })[status.value],
);

watch(results, () => (active.value = -1));
// DOM focus stays in the input, so the browser will not scroll the active option into view
watch(active, (i) => document.getElementById(optionId(i))?.scrollIntoView({ block: 'nearest' }), { flush: 'post' });

function choose(item: T) {
  selected.value = item;
  query.value = getLabel(item);
  open.value = false;
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return; // Enter confirms IME composition, not an option
  const n = results.value.length;
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      event.preventDefault(); // keep the caret in place
      open.value = true;
      if (!n) break;
      // Wrap around; Up from "nothing active" goes to the last option
      if (event.key === 'ArrowUp' && active.value < 0) active.value = n - 1;
      else active.value = (active.value + (event.key === 'ArrowDown' ? 1 : -1) + n) % n;
      break;
    case 'Enter':
      if (expanded.value && active.value >= 0) {
        event.preventDefault(); // do not submit the form
        choose(results.value[active.value]);
      }
      break;
    case 'Escape':
      if (expanded.value) open.value = false;
      else query.value = '';
      break;
  }
}
</script>

<template>
  <div class="combobox">
    <label :for="`${id}-input`">{{ label }}</label>
    <!-- typing clears the selection: the text no longer matches the chosen item -->
    <input :id="`${id}-input`" v-model="query" type="text" role="combobox" autocomplete="off"
      aria-autocomplete="list" :aria-expanded="expanded" :aria-controls="`${id}-listbox`"
      :aria-activedescendant="expanded && active >= 0 ? optionId(active) : undefined"
      @input="open = true; selected = null" @keydown="onKeydown" @blur="open = false" />
    <ul v-show="expanded" :id="`${id}-listbox`" role="listbox" :aria-label="label">
      <!-- mousedown.prevent: the input keeps focus, blur does not close the list before click -->
      <li v-for="(item, i) in results" :id="optionId(i)" :key="optionId(i)" role="option"
        :aria-selected="i === active" @mousedown.prevent @click="choose(item)">
        <template v-for="(part, k) in highlight(getLabel(item), query)" :key="k">
          <mark v-if="part.match">{{ part.text }}</mark>
          <template v-else>{{ part.text }}</template>
        </template>
      </li>
    </ul>
    <div role="status" class="visually-hidden">{{ message }}</div>
  </div>
</template>
```

`generic="T"` типизирует компонент: `getLabel` получает элемент того типа, который вернул `fetcher`. Список прячется через `v-show`, чтобы `aria-controls` всегда указывал на существующий элемент. `active` сбрасывается при каждом новом наборе результатов, иначе индекс указал бы на чужую опцию. Проверено в Edge: одна буква — ни одного запроса; ↓ и ↑ ходят по кругу, фокус всё время в поле; Enter выбирает и не отправляет форму; первый Esc закрывает список, второй очищает поле; медленный запрос, перебитый новым, отменён; клик по опции выбирает её, фокус остаётся в поле; `c++` подсвечен целиком.

Что спросят дальше: **inline-дополнение** (`aria-autocomplete="both"`: дописать в поле остаток первой подсказки и выделить его), **создание нового значения**, если ничего не нашлось, **мультивыбор** с чипами, **лишний запрос после выбора**: `choose` меняет `query`, и `useSearch` ищет подпись выбранного элемента. Его отсекают сравнением с `getLabel(selected)`.
:::

### 3. Таблица с сортировкой, фильтром и пагинацией · средне

`DataTable<Row>`: props — `rows`, `columns` (`key`, `label`, `sortable`), `rowKey`, `caption`, `pageSize`. Клик по заголовку сортирует по возрастанию, второй — по убыванию, третий сбрасывает сортировку. Фильтр ищет подстроку во всех колонках. Массив родителя не меняется.

::: details Решение и разбор
```vue
<!-- DataTable.vue -->
<script setup lang="ts" generic="Row extends Record<string, unknown>">
import { computed, ref, watch } from 'vue';
type Key = keyof Row & string;

const { rows, columns, rowKey, caption, pageSize = 10 } = defineProps<{
  rows: Row[]; columns: { key: Key; label: string; sortable?: boolean }[];
  rowKey: Key; caption: string; pageSize?: number;
}>();

const filter = ref('');
const sort = ref<{ key: Key; dir: 'ascending' | 'descending' } | null>(null); // the aria-sort values
const page = ref(1);
const collator = new Intl.Collator(undefined, { numeric: true }); // once, not per comparison

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => columns.some((c) => String(row[c.key] ?? '').toLowerCase().includes(q)));
});

const sorted = computed(() => {
  const s = sort.value;
  if (!s) return filtered.value;
  const sign = s.dir === 'ascending' ? 1 : -1;
  // toSorted: sort() would reorder the parent's array in place
  return filtered.value.toSorted((a, b) => {
    const x = a[s.key];
    const y = b[s.key];
    // Empty cells go last in both directions, so they are outside the sign
    if (x == null || y == null) return Number(x == null) - Number(y == null);
    return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y)));
  });
});

const pageCount = computed(() => Math.max(1, Math.ceil(sorted.value.length / pageSize)));
const visible = computed(() => sorted.value.slice((page.value - 1) * pageSize, page.value * pageSize));

watch(filter, () => (page.value = 1));
watch(pageCount, (count) => (page.value = Math.min(page.value, count))); // rows were removed

function toggleSort(key: Key) {
  const s = sort.value;
  if (s?.key !== key) sort.value = { key, dir: 'ascending' };
  else if (s.dir === 'ascending') sort.value = { key, dir: 'descending' };
  else sort.value = null; // third click restores the original order
}
</script>

<template>
  <label>Filter <input v-model="filter" type="search" /></label>
  <table>
    <caption>{{ caption }}</caption>
    <thead>
      <tr>
        <th v-for="c in columns" :key="c.key" scope="col" :aria-sort="sort?.key === c.key ? sort.dir : undefined">
          <button v-if="c.sortable" type="button" @click="toggleSort(c.key)">
            {{ c.label }}
            <span aria-hidden="true">{{ sort?.key !== c.key ? '↕' : sort.dir === 'ascending' ? '▲' : '▼' }}</span>
          </button>
          <template v-else>{{ c.label }}</template>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in visible" :key="String(row[rowKey])">
        <td v-for="c in columns" :key="c.key">{{ row[c.key] }}</td>
      </tr>
      <tr v-if="!visible.length"><td :colspan="columns.length">No results</td></tr>
    </tbody>
  </table>
  <nav aria-label="Pagination">
    <button type="button" :disabled="page === 1" @click="page--">Previous</button>
    <span aria-live="polite">Page {{ page }} of {{ pageCount }}</span>
    <button type="button" :disabled="page === pageCount" @click="page++">Next</button>
  </nav>
</template>
```

Проверено в Edge на русских фамилиях и возрастах с `null`: по имени — `алексеев, Андреев, Борисов, …, Евдокимов, Ёлкин` (регистр не мешает, `ё` рядом с `е`); по возрасту — `9, 25, 25, 30, 41, 100, —` и обратно `100, …, 9, —`, пустое значение последним в обе стороны; строки с равным возрастом сохраняют исходный порядок; после третьего клика порядок исходный, а массив родителя не тронут. Фильтр сбрасывает страницу на первую, удаление строк у родителя переводит с 3-й страницы на последнюю. Ключ строки — `rowKey`, а не индекс: при сортировке индекс «переедет» на другую строку вместе с её DOM-состоянием.

Что спросят дальше: **сортировка по нескольким колонкам** ([разбор](../algorithms/sorting-and-searching.md)), **свой рендер ячейки** — scoped slot, **выбор строк** с «выбрать все на странице» и `indeterminate` у чекбокса, **серверный режим** — те же `filter`, `sort`, `page`, но в URL и в запросе с отменой, **10 000 строк** — виртуализация.
:::

### 4. Файловое дерево с ленивой загрузкой · сложно

`TreeView` с `v-model` (id выбранного узла), `roots` и `load(folder)`, который возвращает промис детей. Папки загружаются при первом раскрытии и один раз, после ошибки загрузку можно повторить. Клавиатура и ARIA — по APG Tree View, дерево — одна остановка Tab.

::: details Решение и разбор
```ts
// tree.ts
import type { InjectionKey, Ref } from 'vue';

export interface TreeNode { id: string; name: string; isFolder: boolean }
export interface TreeContext {
  selected: Readonly<Ref<string | null>>;
  focused: Readonly<Ref<string | undefined>>;
  isExpanded(id: string): boolean;
  isLoading(id: string): boolean;
  childrenOf(id: string): TreeNode[];
  toggle(node: TreeNode): void;
  select(id: string): void;
  focus(id: string): void;
}
export const treeKey: InjectionKey<TreeContext> = Symbol('tree');
```

```vue
<!-- TreeView.vue -->
<script setup lang="ts">
import { computed, provide, reactive, readonly, ref } from 'vue';
import { treeKey, type TreeNode } from './tree';
import TreeItem from './TreeItem.vue';

const selected = defineModel<string | null>({ required: true });
const { roots, load, label } = defineProps<{
  roots: TreeNode[]; load: (folder: TreeNode) => Promise<TreeNode[]>; label: string;
}>();

// UI state lives beside the data, keyed by id: the nodes themselves are never mutated
const expanded = reactive(new Set<string>());
const loading = reactive(new Set<string>());
const children = reactive(new Map<string, TreeNode[]>());
const lastFocused = ref<string>();
// Roving tabindex: the tree is one Tab stop; fall back to the selection, then to the first root
const focused = computed(() => lastFocused.value ?? selected.value ?? roots[0]?.id);

async function loadChildren(folder: TreeNode) {
  if (children.has(folder.id) || loading.has(folder.id)) return; // cached or already in flight
  loading.add(folder.id);
  try {
    children.set(folder.id, await load(folder));
  } catch {
    expanded.delete(folder.id); // collapse back: the next expand retries
  } finally {
    loading.delete(folder.id);
  }
}

provide(treeKey, {
  selected: readonly(selected),
  focused: readonly(focused),
  isExpanded: (id) => expanded.has(id),
  isLoading: (id) => loading.has(id),
  childrenOf: (id) => children.get(id) ?? [],
  toggle(node) {
    if (!node.isFolder || expanded.delete(node.id)) return;
    expanded.add(node.id);
    loadChildren(node);
  },
  select: (id) => (selected.value = id),
  focus: (id) => (lastFocused.value = id),
});
</script>

<template>
  <ul role="tree" :aria-label="label">
    <TreeItem v-for="node in roots" :key="node.id" :node="node" />
  </ul>
</template>
```

```vue
<!-- TreeItem.vue -->
<script setup lang="ts">
import { computed, inject } from 'vue';
import { treeKey, type TreeNode } from './tree';

const { node } = defineProps<{ node: TreeNode }>();
const ctx = inject(treeKey);
if (!ctx) throw new Error('<TreeItem> must be used inside <TreeView>');
// undefined removes aria-expanded: leaves must not have it
const expanded = computed(() => (node.isFolder ? ctx.isExpanded(node.id) : undefined));

// An arrow function keeps the narrowing of ctx; a hoisted function declaration would not
const onKeydown = (event: KeyboardEvent) => {
  const item = event.currentTarget as HTMLElement;
  // Collapsed subtrees are not rendered, so DOM order is the visible order
  const items = [...item.closest('[role="tree"]')!.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const i = items.indexOf(item);
  let next: HTMLElement | null | undefined;
  switch (event.key) {
    case 'ArrowDown': next = items[i + 1]; break;
    case 'ArrowUp': next = items[i - 1]; break;
    case 'Home': next = items[0]; break;
    case 'End': next = items.at(-1); break;
    case 'ArrowRight':
      if (expanded.value === false) ctx.toggle(node);
      else if (expanded.value) next = item.querySelector<HTMLElement>('[role="treeitem"]'); // first child, if loaded
      break;
    case 'ArrowLeft':
      if (expanded.value) ctx.toggle(node);
      else next = item.parentElement?.closest<HTMLElement>('[role="treeitem"]'); // parent
      break;
    case 'Enter':
    case ' ':
      ctx.select(node.id);
      break;
    default:
      return;
  }
  event.preventDefault(); // arrows, Home/End and Space would scroll the page
  next?.focus();
};
</script>

<template>
  <!-- .self: keydown and focus from nested items bubble through this li -->
  <li role="treeitem" :aria-expanded="expanded" :aria-selected="ctx.selected.value === node.id"
    :tabindex="ctx.focused.value === node.id ? 0 : -1" @keydown.self="onKeydown" @focus.self="ctx.focus(node.id)">
    <span class="tree__label" @click="ctx.toggle(node); ctx.select(node.id)">{{ node.name }}</span>
    <ul v-if="expanded" role="group">
      <li v-if="ctx.isLoading(node.id)" role="none">Loading…</li>
      <!-- The SFC refers to itself by its file name -->
      <TreeItem v-for="child in ctx.childrenOf(node.id)" :key="child.id" :node="child" />
    </ul>
  </li>
</template>
```

`<li role="treeitem">` содержит своё поддерево, поэтому `keydown` от вложенного узла всплывает через всех предков. Без `.self` одно нажатие ← обработали бы и узел, и его родитель. Видимый порядок узлов берётся из DOM, как у вкладок: свёрнутых веток под `v-if` в нём просто нет. Обработчик — стрелочная функция не ради стиля: с `function onKeydown` `vue-tsc` выдаёт `'ctx' is possibly 'undefined'`, потому что объявление функции поднимается и сужение после `throw` на него не распространяется. `reactive(new Set())` и `reactive(new Map())` отслеживают `has`, `get`, `add` и `delete` по ключу, поэтому раскрытие перерисовывает только затронутые узлы.

Проверено в Edge: Tab попадает на первый корень; → открывает папку и показывает «Loading…», повторное → во время загрузки фокус не двигает, после загрузки переходит к первому ребёнку, и `tabindex="0"` переезжает за фокусом; ← с листа — к родителю, ← на открытой папке закрывает её, родитель вложенного узла остаётся открытым; Home/End; Space выбирает и не прокручивает страницу; повторное раскрытие — без запроса; после упавшей загрузки → загружает заново; Shift+Tab возвращает на последний сфокусированный узел.

Что спросят дальше: **type-ahead** (буфер символов со сбросом по таймеру и поиск следующего видимого узла с таким префиксом), **мультивыбор** с `aria-multiselectable`, **выбранный узел в свёрнутой ветке** — `tabindex="0"` не достаётся никому, нужен запасной вариант на первый корень, **drag-and-drop** с запретом переноса папки в собственного потомка, **10 000 узлов** — плоский список из «Теории» и виртуализация.
:::

## Источники

- [WAI-ARIA Authoring Practices Guide — Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/), [Tree View Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/), [Sortable Table Example](https://www.w3.org/WAI/ARIA/apg/patterns/table/examples/sortable-table/)
- [WAI-ARIA 1.2 — `combobox`](https://www.w3.org/TR/wai-aria-1.2/#combobox), [`aria-sort`](https://www.w3.org/TR/wai-aria-1.2/#aria-sort), [`treeitem`](https://www.w3.org/TR/wai-aria-1.2/#treeitem)
- [ECMAScript — `Array.prototype.toSorted`](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.tosorted), [`RegExp.escape`](https://tc39.es/ecma262/multipage/text-processing.html#sec-regexp.escape); [ECMA-402 — Collator Objects](https://tc39.es/ecma402/#collator-objects)
- [Vue — Watchers: Side Effect Cleanup](https://vuejs.org/guide/essentials/watchers.html#side-effect-cleanup), [Form Input Bindings (IME)](https://vuejs.org/guide/essentials/forms.html), [`<script setup>`: Recursive Components](https://vuejs.org/api/sfc-script-setup.html#recursive-components), [Generics](https://vuejs.org/api/sfc-script-setup.html#generics), [Computed Caching vs. Methods](https://vuejs.org/guide/essentials/computed.html#computed-caching-vs-methods)
- [MDN — `AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController), [`Intl.Collator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Collator), [`RegExp.escape()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/escape), [`KeyboardEvent.isComposing`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing); поддержка браузерами — по [MDN browser-compat-data](https://github.com/mdn/browser-compat-data), сверено 2026-11-13
- [Находки «Ключевые темы senior frontend-интервью и System Design»](https://github.com/alexrehtide/learning/blob/research/senior-interview-topics/research/senior-interview-topics.md)
