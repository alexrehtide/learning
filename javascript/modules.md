---
title: 'Модули: ESM и CommonJS'
level: ядро
---

# Модули: ESM и CommonJS

> **Коротко.** ES-модули (ESM) — модульная система самого языка: `import`/`export` статичны, граф модулей строится и связывается **до** выполнения кода, а импорт — это живая ссылка на привязку (live binding), а не копия значения. CommonJS — система Node: `require()` — обычная функция, которая синхронно выполняет файл и возвращает объект `module.exports`. Статичность ESM даёт tree shaking, top-level await и загрузку в браузере. Современный Node умеет обе системы и `require()` синхронного ES-модуля.

**Связанные темы:** [Область видимости и hoisting](./scope-and-hoisting.md), [Замыкания](./closures.md), [Функции и `this`](./functions-and-this.md), [Event loop](./event-loop.md), [async/await, обработка ошибок и отмена](./async-await.md)

## Теория

### Зачем модули и откуда две системы

До модулей код делил одну глобальную область: скрипты общались через `window`, порядок `<script>` задавал зависимости, а приватность держалась на паттерне «модуль» на IIFE (см. [Замыкания](./closures.md)). Node в 2009 году взял CommonJS — синхронный `require`, удобный для файловой системы. Для браузера появились AMD и UMD, затем сборщики. ES2015 стандартизировал ESM, но без флага Node поддержал его только в 2019–2020 годах (13.2 и 12.17), поэтому экосистема долго жила на CommonJS, и обе системы существуют до сих пор.

### ESM: три фазы

Спецификация описывает модуль как **Module Record**, а загрузку — как три фазы. Хост (браузер, Node) отвечает за получение файлов и разрешение спецификаторов, язык — за связывание и выполнение.

1. **Загрузка и разбор (load/parse).** Хост получает файл, движок разбирает его и **статически** находит все `import` и `export`. Затем рекурсивно загружаются зависимости. Код ещё не выполняется.
2. **Связывание (link).** Для каждого модуля создаётся модульная область (Module Environment Record). Каждый `import` связывается с привязкой экспортирующего модуля. Неизвестное имя — `SyntaxError` на этой фазе, до выполнения единой строки. Объявления функций уже инициализированы, `let`/`const`/`class` — в TDZ.
3. **Выполнение (evaluate).** Модули выполняются обходом графа в глубину, **зависимости раньше зависящих** (post-order), каждый — ровно один раз.

Следствия:

- `import` всегда поднимается: он работает до выполнения тела, где бы ни стоял в файле.
- Спецификатор в статическом `import` — только строковый литерал, а `import`/`export` — только на верхнем уровне. Иначе граф нельзя было бы построить заранее.
- Модуль выполняется один раз на URL (в Node — на разрешённый путь). Все импортёры видят **один** экземпляр: модуль — естественный синглтон.
- Модули всегда в strict mode, `this` на верхнем уровне — `undefined`, `var` не попадает на `globalThis` (см. [Область видимости и hoisting](./scope-and-hoisting.md)).

### Live bindings

Импорт — не переменная со скопированным значением, а **непрямая привязка** (indirect binding) к переменной экспортирующего модуля. Если модуль изменит экспортированный `let`, все импортёры увидят новое значение. Присвоить импорту нельзя: привязка неизменяема со стороны импортёра, будет `TypeError`.

```js
// counter.js
export let count = 0;
export function inc() { count++; }

// main.js
import { count, inc } from './counter.js';
inc();
console.log(count); // 1: the binding is live
count = 5;          // TypeError: Assignment to constant variable
```

Тонкости:

- `export default <выражение>` экспортирует **значение** выражения в момент выполнения, под скрытой привязкой `*default*`. Живой она не будет: `export default count` зафиксирует `0`. А `export { count as default }` — живая привязка.
- `import * as ns` даёт **module namespace object**: прототип `null`, нерасширяемый, свойства — геттеры живых привязок, `Symbol.toStringTag` — `'Module'`.
- Живая привязка защищает только саму переменную. Экспортированный объект изменяем: его мутацию увидят все импортёры.

### Циклические зависимости

ESM разрешает циклы по построению: связывание проходит до выполнения, и привязки уже существуют. Опасно только **обратиться** к значению, которое ещё не вычислено. Если `a` импортирует `b`, а `b` — `a`, то при входе с `a` первым выполнится `b`. Его обращение к `const` из `a` на верхнем уровне попадёт в TDZ — `ReferenceError`. Объявления функций при этом уже готовы, а обращения внутри функций, вызванных позже, работают.

В CommonJS цикл даёт **недоделанный объект**: `require` возвращает текущее состояние `module.exports` модуля, который ещё выполняется. Если тот потом **заменит** `module.exports` целиком, второй модуль так и останется со старым, частично заполненным объектом. Ошибки нет — просто `undefined`.

> [!TIP]
> Цикл в графе — обычно признак плохой границы между модулями. Лечат выносом общего кода в третий модуль. Найти циклы помогают `madge` и правило `import/no-cycle` в ESLint.

### Top-level await

На верхнем уровне ES-модуля можно писать `await` (ES2022). Модуль с ожиданием становится асинхронным, и выполнение **зависящих от него** модулей откладывается до завершения ожидания. Модули, которые от него не зависят, — в том числе соседние импорты того же родителя — выполняются, пока он ждёт. Цена — задержка всего поддерева: TLA на сетевом запросе в корне приложения задерживает старт. Удобные применения — условный импорт (`await import(…)`), инициализация WebAssembly, загрузка конфигурации.

### Динамический `import()`

`import(specifier)` (ES2020) — выражение, а не объявление. Работает где угодно, в том числе в классических скриптах и CommonJS, принимает вычисляемую строку и возвращает **промис namespace-объекта**. Это механизм ленивой загрузки и code splitting: сборщик видит `import()` и выносит модуль в отдельный чанк.

```js
const { default: Chart } = await import('./chart.js'); // default comes as a property
```

### Атрибуты импорта и `import.meta`

- **Import attributes** (ES2025): `import data from './data.json' with { type: 'json' }`. Атрибут — защита безопасности: тип модуля задаёт импортёр, а не сервер. Иначе подменённый ответ с MIME `text/javascript` выполнился бы как код. JSON-модуль экспортирует только `default`. Без атрибута Node отказывается импортировать JSON (`ERR_IMPORT_ATTRIBUTE_MISSING`). Ранний синтаксис `assert { type: 'json' }` устарел и удалён из движков.
- **`import.meta`** (ES2021) — объект с данными хоста о текущем модуле. Везде есть `import.meta.url` и `import.meta.resolve(specifier)`. В Node — ещё `import.meta.dirname` и `import.meta.filename` (замена `__dirname`/`__filename`, которых в ESM нет). Сборщики добавляют своё: `import.meta.env` и `import.meta.hot` в Vite, `import.meta.client`/`server` в Nuxt.

> [!NOTE]
> На stage 3 (сверено 2026-11-12): **import defer** (`import defer * as ns from './heavy.js'` — модуль загружается и связывается сразу, а выполняется при первом обращении к `ns`) и **source phase imports** (`import source wasm from './x.wasm'` — получить скомпилированный источник без выполнения). В стандарт они ещё не вошли.

### CommonJS: как устроен `require`

Node оборачивает файл в функцию — **module wrapper**:

```js
(function (exports, require, module, __filename, __dirname) {
  // file body
});
```

Отсюда все свойства CommonJS:

- `require` — обычная синхронная функция. Её можно вызвать в `if`, в цикле, с вычисленным путём. Поэтому граф заранее неизвестен.
- Результат — **значение** `module.exports` на момент возврата. `const { count } = require('./c')` копирует число, последующие изменения внутри модуля не видны.
- Модули кэшируются в `require.cache` по разрешённому пути: файл выполняется один раз. Удаление из кэша заставляет выполнить его заново (так работали старые hot reload).
- `exports` — просто ссылка на `module.exports`. `exports.x = 1` работает, `exports = { x: 1 }` — нет: переназначена локальная переменная, наружу уйдёт пустой объект.
- `this` на верхнем уровне — `module.exports` (см. [Функции и `this`](./functions-and-this.md)). Top-level await нет.

### ESM и CommonJS в Node

Какой системой Node читает файл, решает он сам:

| Признак | Система |
| --- | --- |
| `.mjs` | ESM |
| `.cjs` | CommonJS |
| `.js` и `"type": "module"` в ближайшем `package.json` | ESM |
| `.js` без `"type"` | CommonJS. Если в файле есть синтаксис ESM, Node 22.7+ и 20.19+ определяет это сам (syntax detection) |

Взаимодействие:

- **ESM импортирует CommonJS.** `module.exports` целиком становится `default`. Именованные импорты работают, если Node распознал их статическим анализом кода (`exports.x = …`, `module.exports = { a, b }`): это эвристика `cjs-module-lexer`, вычисляемые ключи она не видит.
- **CommonJS импортирует ESM.** Всегда — через `import()`. Синхронный `require(esm)` работает без флага с Node 20.19 / 22.12 и считается стабильным с 25.4. Он возвращает namespace-объект. Модуль с top-level await так не загрузить: `ERR_REQUIRE_ASYNC_MODULE`.

> [!WARNING]
> Interop `default` расходится между инструментами. Babel и TypeScript компилируют ESM в CommonJS с флагом `exports.__esModule = true` и `exports.default`. Сборщики и `esModuleInterop` такой флаг уважают: `import x` даст `exports.default`. Node — нет: `default` — это всегда весь `module.exports`, и нужное значение окажется в `x.default`. Отсюда «работает в Vite, падает в Node» у пакетов, собранных в CommonJS.

### Пакеты: `exports` и dual package

Поле `exports` в `package.json` задаёт **публичные точки входа** пакета и, когда оно есть, имеет приоритет над `main`. Всё, что не перечислено, импортировать нельзя (`ERR_PACKAGE_PATH_NOT_EXPORTED`) — это инкапсуляция внутренних файлов. Условия (conditions) выбирают файл под среду: `import`, `require`, `node`, `browser`, `types`, `default`. Они проверяются по порядку ключей, поэтому `types` пишут первым, а `default` — последним.

**Dual package hazard.** Пакет поставляет и ESM-, и CommonJS-сборку, а приложение подключает его обоими способами (одна зависимость через `import`, другая через `require`). В памяти окажутся **два экземпляра** модуля: два синглтона, два реестра, `instanceof` между ними ломается. Для Vue это классика: две копии `vue` — и `inject` не находит то, что положил `provide`, а реактивность «не работает». Решения — одна сборка (только ESM, теперь, когда есть `require(esm)`), или CommonJS-обёртка, реэкспортирующая ESM-ядро, или общий модуль состояния.

### ESM в браузере

- `<script type="module">` по умолчанию **отложен**, как `defer`: загружается параллельно, выполняется после разбора HTML, в порядке документа. `async` на модуле выполняет его сразу по готовности графа.
- Модули загружаются в режиме CORS: с другого origin нужен `Access-Control-Allow-Origin`, с `file://` модули не работают. MIME должен быть JavaScript.
- **Голые спецификаторы** (`import 'vue'`) браузер сам не разрешает. Нужна **import map** (`<script type="importmap">`) или сборщик, который перепишет пути.
- `<script nomodule>` выполняется только в браузерах без поддержки модулей — так раньше отдавали legacy-сборку.
- `<link rel="modulepreload">` заранее загружает и разбирает модуль вместе с зависимостями, срезая водопад запросов по графу. Vite вставляет его для чанков автоматически.

### Статичность и tree shaking

Сборщик видит граф ESM без выполнения кода, поэтому может **удалить неиспользуемые экспорты** (tree shaking) и разрезать граф по `import()` на чанки. С CommonJS это почти невозможно: `require` может быть где угодно, `module.exports` — что угодно. Удалить можно только код без **побочных эффектов**. Сборщику помогают поле `"sideEffects": false` в `package.json` и аннотация `/*#__PURE__*/` у вызовов. Подробности оптимизации бандла — в разделе «Инструменты».

### Vue и Nuxt: где это видно

- `<script setup>` — ES-модуль: его импорты сразу доступны шаблону, а компилятор по статическим импортам понимает, что компонент использует.
- Ленивые компоненты и маршруты — это `import()`: `defineAsyncComponent(() => import('./Heavy.vue'))`, `component: () => import('./pages/User.vue')` во Vue Router. Каждый такой вызов — отдельный чанк.
- Модуль — синглтон, поэтому `ref` на уровне модуля — общее состояние всех компонентов. В браузере это простой «стор без Pinia». На сервере при SSR модуль один на **все запросы**: состояние одного пользователя утечёт к другому (cross-request state pollution). Поэтому в Nuxt — `useState` и Pinia, а не модульные `ref`.
- Vite в dev-режиме отдаёт исходники браузеру как нативные ES-модули без сборки, а CommonJS-зависимости заранее перепаковывает в ESM (pre-bundling): браузер CommonJS не понимает.

## Примеры

```js
// Named, default and namespace imports
import App, { useCounter } from './App.js';
import * as utils from './utils.js';

// Re-exports: the barrel-file pattern
export { formatDate } from './date.js';
export * from './math.js';                // does not re-export default
export { default as Button } from './Button.js';

// Conditional loading: only a dynamic import can do this
if (import.meta.env.DEV) {
  const { setupDevtools } = await import('./devtools.js');
  setupDevtools();
}

// Paths relative to the current module, in the browser and in Node
const workerUrl = new URL('./worker.js', import.meta.url);

// JSON with an import attribute
import config from './config.json' with { type: 'json' };
```

```js
// CommonJS: exports is just a reference to module.exports
exports.a = 1;                 // ok
exports = { b: 2 };            // lost: rebinds the local variable only
module.exports = { c: 3 };     // replaces the export entirely
```

```json
{
  "name": "my-lib",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./package.json": "./package.json"
  },
  "sideEffects": false
}
```

## Вопросы с интервью

::: details Чем ESM отличается от CommonJS
ESM — стандарт языка, CommonJS — соглашение Node. ESM статичен: импорты и экспорты известны после разбора, граф связывается до выполнения, а неизвестное имя — ошибка до запуска. CommonJS динамичен: `require` — синхронная функция, вызываемая во время выполнения. Импорт в ESM — живая ссылка на привязку, в CommonJS — значение `module.exports` на момент вызова. ESM всегда в strict mode, поддерживает top-level await, загружается асинхронно и работает в браузере. CommonJS синхронен и привязан к файловой системе. Статичность ESM даёт tree shaking и надёжный code splitting.
:::

::: details Что такое live binding и чем он отличается от копии значения
Импорт в ESM — непрямая привязка к переменной экспортирующего модуля. Если модуль изменит экспортированный `let`, все импортёры увидят новое значение. Изменять привязку может только сам модуль, у импортёра присваивание даёт `TypeError`. В CommonJS `const { count } = require('./c')` копирует значение свойства, и дальнейшие изменения не видны. Исключение в ESM — `export default <выражение>`: экспортируется значение на момент выполнения. Объекты в обеих системах передаются по ссылке, поэтому мутации видны везде.
:::

::: details Как ESM и CommonJS ведут себя при циклических зависимостях
В ESM привязки создаются на фазе связывания, поэтому цикл не ломает загрузку. Ломается обращение к значению, которое ещё не вычислено: `const` модуля, который выполнится позже, находится в TDZ — `ReferenceError`. Объявления функций готовы сразу, а обращения в функциях, вызванных после загрузки, работают. В CommonJS `require` в цикле возвращает частично заполненный `module.exports` выполняющегося модуля. Если тот затем заменит `module.exports`, второй модуль останется со старым объектом и получит `undefined` без ошибки. Лучшее лечение в обоих случаях — вынести общее в третий модуль.
:::

::: details Почему tree shaking работает с ESM и почти не работает с CommonJS
Для удаления кода сборщик должен знать без выполнения, какие экспорты используются. В ESM импорты и экспорты статичны: спецификаторы — литералы, объявления — на верхнем уровне. В CommonJS `require` бывает в условиях, с вычисленным путём, а `module.exports` можно собрать во время выполнения. Но и в ESM удаляется только код без побочных эффектов. Модуль, который на верхнем уровне патчит глобальный объект или регистрирует компонент, оставят. Помогают `"sideEffects": false` в `package.json` и `/*#__PURE__*/` у вызовов. Barrel-файлы (`index.js` с `export *`) мешают, если пакет не помечен как свободный от побочных эффектов.
:::

::: details Как подключить ES-модуль из CommonJS и наоборот в современном Node
Из ESM CommonJS импортируется напрямую: `module.exports` становится `default`, именованные импорты доступны, если Node распознал их статически. Из CommonJS ES-модуль всегда можно загрузить асинхронно через `import()`. С Node 20.19 / 22.12 работает и синхронный `require(esm)`, стабильный с 25.4: он возвращает namespace-объект, но не умеет модули с top-level await (`ERR_REQUIRE_ASYNC_MODULE`). Систему файла Node выбирает по расширению `.mjs`/`.cjs` или по полю `"type"` в ближайшем `package.json`.
:::

::: details Что такое dual package hazard и как он проявляется во Vue
Пакет публикует ESM- и CommonJS-сборки, а приложение подключает его обоими способами. Node и сборщик загружают два разных файла — в памяти два экземпляра модуля. Ломается всё, что держится на идентичности: синглтоны, `instanceof`, `Symbol`-ключи, кэши. Для Vue две копии `vue` значат, что `provide` из одной не виден `inject` из другой, реактивность и текущий экземпляр компонента расходятся. Лечат одной сборкой (сейчас — только ESM), CommonJS-обёрткой над ESM-ядром или `resolve.dedupe` в Vite для дублей в `node_modules`.
:::

::: details Как браузер загружает ES-модули и что нужно для голых спецификаторов
`<script type="module">` отложен по умолчанию: граф загружается параллельно, выполнение — после разбора HTML, в порядке документа. Каждый модуль выполняется один раз на URL. Загрузка идёт в режиме CORS, нужен JavaScript MIME, `file://` не работает. Глубокий граф порождает водопад запросов, его срезают `modulepreload` и сборка. Голые спецификаторы вроде `'vue'` браузер сам не разрешает: их отображает на URL import map или переписывает сборщик. Поэтому Vite в dev-режиме переписывает импорты пакетов на пути к предсобранным зависимостям.
:::

::: details Почему состояние на уровне модуля опасно при SSR
Модуль выполняется один раз на процесс и живёт, пока жив процесс. В браузере у каждого пользователя свой процесс, и модульный `ref` — удобный общий стор. На SSR-сервере один процесс обслуживает все запросы, и модульный `ref` становится общим для всех пользователей: данные одного запроса утекают в ответ другому (cross-request state pollution). Поэтому состояние создают на каждый запрос: экземпляр Pinia на приложение, `useState` в Nuxt, фабрика вместо модульного объекта.
:::

## Задачи

### 1. Порядок выполнения · легко

Что выведет `node main.mjs`?

```js
// main.mjs
console.log('main');
import './x.mjs';
import './y.mjs';

// x.mjs
import './z.mjs';
console.log('x');

// y.mjs
import './z.mjs';
console.log('y');

// z.mjs
console.log('z');
```

::: details Решение и разбор
```
z
x
y
main
```

- Импорты поднимаются: граф загружается и связывается до выполнения тела `main`, место `import` в файле не важно.
- Выполнение — обход в глубину, зависимости раньше зависящих: `z` (как зависимость `x`), `x`, `y`, затем `main`.
- `z` выполняется один раз, хотя его импортируют двое: модуль — синглтон на URL.
- Если `z` содержит top-level await, порядок тот же: `x` и `y` дождутся `z`. Но модуль, который от ожидающего не зависит, выполнится, пока тот ждёт.
:::

### 2. Живая привязка или копия · легко

Что выведет каждый вариант?

```js
// counter.mjs
export let count = 0;
export function inc() { count++; }
export default count;

// main.mjs
import total, { count, inc } from './counter.mjs';
inc();
console.log(count, total);
```

```js
// counter.cjs
let count = 0;
module.exports = { count, inc() { count++; } };

// main.cjs
const { count, inc } = require('./counter.cjs');
inc();
console.log(count, require('./counter.cjs').count);
```

::: details Решение и разбор
- ESM: `1 0`. Именованный `count` — живая привязка. `export default count` экспортировал значение выражения в момент выполнения — `0`, и оно не меняется. С `export { count as default }` было бы `1 1`.
- CommonJS: `0 0`. В литерал `{ count }` скопировано значение `0`, а `inc` меняет локальную переменную модуля, не свойство объекта. Повторный `require` возвращает тот же объект из кэша, и там тоже `0`.
- Чтобы CommonJS-модуль отдавал актуальное значение, экспортируют геттер: `get count() { return count; }`, или функцию `getCount()`.
:::

### 3. Разорвать цикл · средне

`node cyc.mjs` падает с `ReferenceError: Cannot access 'ZERO' before initialization`. Объясните и исправьте, не меняя логику функций.

```js
// cyc.mjs
import { isEven } from './even.mjs';
console.log(isEven(4));

// even.mjs
import { isOdd } from './odd.mjs';
export const ZERO = 0;
export function isEven(n) { return n === ZERO ? true : isOdd(n - 1); }

// odd.mjs
import { isEven, ZERO } from './even.mjs';
export function isOdd(n) { return n === ZERO ? false : isEven(n - 1); }
export const ODD_BASE = isOdd(1); // runs during odd.mjs evaluation
```

::: details Решение и разбор
Порядок выполнения: `cyc` → `even` → `odd`. `odd` — зависимость `even`, поэтому выполняется **первым**. На этот момент `isEven` уже готова (объявления функций инициализируются при связывании), а `ZERO` — `const` модуля `even`, тело которого ещё не выполнялось. Вызов `isOdd(1)` на верхнем уровне `odd` обращается к `ZERO` в TDZ.

Исправления по убыванию предпочтительности:

```js
// constants.mjs: shared code goes to a third module with no cycle
export const ZERO = 0;

// even.mjs
import { isOdd } from './odd.mjs';
import { ZERO } from './constants.mjs';
export function isEven(n) { return n === ZERO ? true : isOdd(n - 1); }

// odd.mjs
import { isEven } from './even.mjs';
import { ZERO } from './constants.mjs';
export function isOdd(n) { return n === ZERO ? false : isEven(n - 1); }
export const ODD_BASE = isOdd(1);
```

- `constants` не участвует в цикле и выполняется раньше обоих. Цикл `even ↔ odd` остаётся, но безопасен: на верхнем уровне используются только объявления функций.
- Другие варианты: убрать вычисление с верхнего уровня (`ODD_BASE` сделать функцией) или поменять точку входа. Последний хрупок: порядок зависит от того, кто импортирован первым.
- В CommonJS тот же код не упал бы, а получил `undefined` из недозаполненного `module.exports` — ошибка всплыла бы позже и в неожиданном месте.
:::

### 4. Пакет для `import` и `require` · средне

Библиотека собирается в `dist/index.js` (ESM), `dist/index.cjs` (CommonJS) и `dist/index.d.ts`. Внутренние файлы `dist/internal/*` импортировать снаружи нельзя, а `my-lib/utils` — можно (`dist/utils.js`, `dist/utils.cjs`). Напишите `package.json` и назовите риск этой схемы.

::: details Решение и разбор
```json
{
  "name": "my-lib",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./utils": {
      "types": "./dist/utils.d.ts",
      "import": "./dist/utils.js",
      "require": "./dist/utils.cjs"
    },
    "./package.json": "./package.json"
  },
  "main": "./dist/index.cjs",
  "types": "./dist/index.d.ts",
  "sideEffects": false
}
```

- `exports` закрывает всё неперечисленное: `my-lib/dist/internal/x` даст `ERR_PACKAGE_PATH_NOT_EXPORTED`. Добавление `exports` в существующий пакет — ломающее изменение, его выпускают major-версией.
- Условия проверяются в порядке ключей: `types` первым, иначе TypeScript возьмёт JS-файл. `main` и корневой `types` — запасной вариант для старых инструментов.
- `"type": "module"` делает `.js` ESM-файлами, поэтому CommonJS-сборка обязана иметь `.cjs`.
- Риск — dual package hazard: если в приложении пакет загружен и через `import`, и через `require`, будет два экземпляра с раздельным состоянием. Если у библиотеки есть состояние (реестр, синглтон, `Symbol` для `provide`), безопаснее публиковать только ESM: пользователи CommonJS на Node 20.19+ получат его через `require(esm)`.
:::

### 5. Мини-`require` · сложно

Реализуйте `createRequire(files)`: `files` — объект «путь → исходник CommonJS-модуля» (пути абсолютные, разрешение путей не нужно). Поддержите `module.exports` и `exports`, кэш и циклы с тем же поведением, что у Node.

```js
const files = {
  '/a.js': "exports.early = 1; const b = require('/b.js'); exports.late = 2; module.exports.fromB = b.value;",
  '/b.js': "const a = require('/a.js'); module.exports = { value: 'B', seenA: { ...a } };",
};
const require = createRequire(files);
console.log(require('/a.js')); // { early: 1, late: 2, fromB: 'B' }
console.log(require('/b.js').seenA); // { early: 1 }
```

::: details Решение и разбор
```js
function createRequire(files) {
  const cache = Object.create(null);

  function require(path) {
    if (path in cache) return cache[path].exports; // cached or still loading (cycle)
    if (!(path in files)) throw new Error(`Cannot find module '${path}'`);

    const module = { exports: {}, loaded: false };
    cache[path] = module; // cache BEFORE running: this is what makes cycles work

    const wrapper = new Function('exports', 'require', 'module', files[path]);
    try {
      wrapper.call(module.exports, module.exports, require, module);
    } catch (error) {
      delete cache[path]; // a failed module must not stay half-initialised in the cache
      throw error;
    }
    module.loaded = true;
    return module.exports;
  }

  require.cache = cache;
  return require;
}
```

- Ключевой момент — запись в кэш **до** выполнения. Когда `b` в цикле вызывает `require('/a.js')`, он получает текущий, недозаполненный `module.exports` модуля `a`: `{ early: 1 }`. Так ведёт себя и Node.
- Возвращается `module.exports`, прочитанный **после** выполнения. Поэтому `module.exports = {…}` в `b` работает, а `exports = {…}` — нет: это переназначение параметра функции-обёртки.
- `this` верхнего уровня — `module.exports`, как в Node (`wrapper.call`).
- При исключении Node тоже удаляет модуль из кэша: следующий `require` выполнит его заново.
- Чего здесь нет по сравнению с Node: разрешения путей и `node_modules`, `__filename`/`__dirname`, загрузки JSON и `require(esm)`. Здесь же видно, почему у CommonJS нет live bindings: наружу отдаётся обычный объект.

Сложность: каждый модуль выполняется один раз; повторный `require` — O(1).
:::

## Источники

- [ECMAScript: Modules](https://tc39.es/ecma262/#sec-modules), [Cyclic Module Records](https://tc39.es/ecma262/#sec-cyclic-module-records), [Module Namespace Exotic Objects](https://tc39.es/ecma262/#sec-module-namespace-exotic-objects), [Import Calls](https://tc39.es/ecma262/#sec-import-calls)
- [TC39: Finished Proposals](https://github.com/tc39/proposals/blob/main/finished-proposals.md) — `import()` (ES2020), `import.meta` (ES2021), top-level await (ES2022), Import Attributes и JSON Modules (ES2025); [TC39: Active Proposals](https://github.com/tc39/proposals) — Deferring Module Evaluation и Source Phase Imports (stage 3)
- [HTML Living Standard: JavaScript module scripts](https://html.spec.whatwg.org/multipage/webappapis.html#module-script), [Import maps](https://html.spec.whatwg.org/multipage/webappapis.html#import-maps)
- [Node.js: Modules: CommonJS](https://nodejs.org/api/modules.html) — в том числе «Loading ECMAScript modules using require()», [ECMAScript modules](https://nodejs.org/api/esm.html), [Packages](https://nodejs.org/api/packages.html) — `type`, `exports`, conditional exports, dual package hazard
- [MDN: JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules), [import](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import), [export](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/export), [import()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import), [import.meta](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import.meta), [Import attributes](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import/with), [rel=modulepreload](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload)
- [Vue: Async Components](https://vuejs.org/guide/components/async.html), [SSR: Cross-Request State Pollution](https://vuejs.org/guide/scaling-up/ssr.html#cross-request-state-pollution); [Vue Router: Lazy Loading Routes](https://router.vuejs.org/guide/advanced/lazy-loading.html)
- [Vite: Dependency Pre-Bundling](https://vite.dev/guide/dep-pre-bundling.html)
- [Lin Clark: ES modules: A cartoon deep-dive](https://hacks.mozilla.org/2018/03/es-modules-a-cartoon-deep-dive/)
