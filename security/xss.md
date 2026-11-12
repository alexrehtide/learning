---
title: XSS и безопасный вывод во Vue
level: ядро
---

# XSS и безопасный вывод во Vue

> **Коротко.** **XSS** (cross-site scripting, межсайтовый скриптинг) — выполнение чужого скрипта в origin вашей страницы. Скрипт получает всё, что есть у страницы: DOM, токены в хранилищах, право слать запросы от имени пользователя. Защита — не «фильтр плохих строк», а правило: данные попадают в документ только через API, которые понимают контекст (`textContent`, `setAttribute`, экранирование под HTML, атрибут, URL). Vue делает это сам для <code v-pre>{{ }}</code> и `:attr`, но не проверяет URL, не защищает `v-html`, `v-bind="obj"` и шаблоны, собранные из ввода. Последние рубежи — санитайзинг, Trusted Types, CSP и `HttpOnly`.

**Связанные темы:** [DOM API и observers](../browser/dom.md), [Same-origin policy, CORS и cookies](../network/cors-and-cookies.md), [Хранилища браузера](../network/browser-storage.md)

## Теория

### Почему XSS — это «полный доступ»

Same-origin policy отделяет origin друг от друга, но всё, что выполнилось **внутри** origin, считается своим. Внедрённый скрипт неотличим от вашего бандла: он читает `localStorage` и не-`HttpOnly` cookies, видит DOM с персональными данными, вызывает API с cookie сессии, подменяет форму входа, ставит кейлоггер. Поэтому XSS обесценивает почти все остальные защиты: CSRF-токен он прочитает со страницы, `SameSite` не мешает запросам со своего же origin.

### Виды XSS

| Вид | Где живёт полезная нагрузка | Кто вставляет её в документ |
| --- | --- | --- |
| **Reflected** (отражённая) | в запросе: `?q=<script>…` | сервер, который возвращает параметр в HTML |
| **Stored** (хранимая) | в БД: комментарий, имя профиля | сервер или клиент при каждом показе |
| **DOM-based** | в источнике на клиенте: `location.hash`, `postMessage` | клиентский JavaScript |

Reflected и stored различаются тем, откуда пришли данные, а DOM-based — тем, **где** происходит ошибка. В DOM-based XSS сервер может вообще не видеть нагрузку: фрагмент `#…` не отправляется в HTTP-запросе. Поэтому серверный WAF и экранирование в шаблонах бэкенда её не ловят.

Для DOM-based XSS удобна модель **источник → приёмник** (source → sink) из OWASP:

- **Источники** — данные, которыми управляет атакующий: `location` (`hash`, `search`, `href`), `document.referrer`, `window.name`, `event.data` у `postMessage`, `localStorage`, ответы API с пользовательским контентом.
- **Приёмники** — API, которые превращают строку в код или разметку: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `setTimeout`/`setInterval` со строкой, `location.href =`/`location.assign` (схема `javascript:`), `script.src`, `script.textContent`, `iframe.srcdoc`, атрибуты-обработчики `on*`.

Уязвимость — путь от источника к приёмнику без преобразования, подходящего этому приёмнику.

### Экранирование по контексту

Одна и та же строка безопасна в одном месте документа и опасна в другом. Универсального `escape()` нет — есть кодирование **под контекст вывода** (OWASP XSS Prevention Cheat Sheet):

| Контекст | Пример | Что делать |
| --- | --- | --- |
| Текст в HTML | `<p>DATA</p>` | `textContent` или замена `& < > " '` на сущности |
| Значение атрибута | `<input value="DATA">` | только в кавычках, кодировать сущностями; надёжнее `setAttribute` |
| URL целиком | `<a href="DATA">` | разобрать `new URL()` и пропустить только `http:`/`https:`/`mailto:` |
| Часть URL | `?q=DATA` | `encodeURIComponent` |
| JavaScript | `<script>let x = 'DATA'</script>` | не вставлять. Данные — в `<script type="application/json">` или `data-*`, читать через `JSON.parse` |
| CSS | `style="color: DATA"` | только значения из allowlist, через объект стилей |

Экранирование для HTML **не** защищает атрибут-обработчик или URL. `<a href="javascript:alert(1)">` не содержит ни одного опасного для HTML символа, а в `onclick="go('DATA')"` браузер сначала декодирует сущности и только потом отдаёт строку JavaScript. Поэтому `&#39;` внутри обработчика снова становится кавычкой.

> [!WARNING]
> Атрибуты без кавычек — отдельная ловушка: `<div title=DATA>` ломается пробелом, и `x onmouseover=alert(1)` становится новым атрибутом. Шаблонизаторы ставят кавычки сами, но HTML, собранный конкатенацией, обычно нет.

### Что Vue экранирует сам

- **Интерполяция** <code v-pre>{{ value }}</code> пишет текст через текстовые узлы и `textContent`. Разметка в строке показывается как текст.
- **Биндинг атрибута** `:title="value"` идёт через `setAttribute`: значение не может «закрыть» атрибут и добавить новый.
- **SSR** (`@vue/server-renderer`) экранирует интерполяции и значения атрибутов функцией `escapeHtml`, а имена атрибутов с недопустимыми символами (`>`, `/`, `=`, кавычки, пробелы) просто пропускает.
- `<script>` и `<style>` внутри шаблона компонента компилятор игнорирует с предупреждением.

Так что <code v-pre>{{ }}</code> и `:attr` закрывают контексты «текст» и «значение атрибута». Остальное — на вас.

### Где Vue не защищает

1. **`v-html`**, а также `innerHTML` в рендер-функциях и JSX. Это запись строки в `innerHTML`, то есть HTML-парсер. В документации Vue сказано, что пользовательскому HTML нельзя доверять на 100 %, если он не в sandbox-iframe и не виден только своему автору.
2. **URL-атрибуты.** `:href`, `:src`, `:action`, `:formaction`, `:srcdoc` экранируются как атрибуты, но схему Vue не проверяет: `:href="'javascript:alert(1)'"` выполнится по клику. Документация Vue советует проверять URL на бэкенде **до сохранения** в БД, а фронтенд-проверку считать вторым слоем.
3. **`v-bind="obj"` с ключами от пользователя.** В runtime-dom (сверено с Vue 3.5) ключ вида `onclick` (после `on` строчная буква) со **строковым** значением ставится через `setAttribute`. Получается инлайновый обработчик. Обработчики Vue — это `onClick` с заглавной и функцией, а `onclick: "alert(1)"` — обычный HTML-атрибут. SSR тоже отрисует его в разметку.
4. **`:style` строкой от пользователя.** Скрипта нет, но есть clickjacking: прозрачная ссылка поверх кнопки «Войти». Vue рекомендует объектный синтаксис и allowlist свойств.
5. **Шаблоны из пользовательских данных.** Выражения шаблона — это JavaScript. `template: '<div>' + userInput + '</div>'` равносилен `eval`. Ограниченный список глобалов в выражениях не спасает: <code v-pre>{{ constructor.constructor('alert(1)')() }}</code> достаёт `Function` через прототип.
6. **Монтирование на серверный HTML** (client-side template injection). Если бэкенд (PHP, Django) отрисовал страницу с пользовательским текстом, а Vue монтируется на её корень без своего шаблона, `innerHTML` контейнера становится шаблоном. Тогда комментарий <code v-pre>{{ … }}</code>, безопасный для бэкенда, выполнится во Vue. Документация Vue: никогда не монтируйте Vue на узлы, где может быть серверный и пользовательский контент.
7. **Динамические теги и компоненты** из ввода: `<component :is="userTag">`, `h(userTag, userAttrs)`. Имена тегов и атрибутов берите только из allowlist.

> [!TIP]
> Сборка без компилятора шаблонов в runtime (по умолчанию в Vite с SFC и в Nuxt) закрывает пункты 5 и 6: строковый шаблон просто не скомпилируется. `v-html`, URL и `v-bind="obj"` от сборки не зависят.

### SSR: сериализация состояния

При SSR состояние передаётся клиенту внутри HTML. Наивный вариант:

```js
html += `<script>window.__STATE__ = ${JSON.stringify(state)}</script>`
```

`JSON.stringify` экранирует кавычки, но не `<`. HTML-парсер ищет `</script>`, не зная о JavaScript-строках, поэтому значение `"</script><script>alert(1)</script>"` закрывает тег раньше времени. Нужна замена `<` на `<` (и, для старых движков, U+2028/U+2029). Внутри JS-строки это тот же символ, но парсер HTML его уже не видит.

Nuxt (исходники `nuxt/nuxt`, ветка main, сверено 2026-11-12) кладёт payload в `<script type="application/json" id="__NUXT_DATA__" data-nuxt-data="nuxt-app">`. Сериализует его `stringify` из библиотеки **devalue**: она заменяет `<` на `<` и экранирует U+2028/U+2029. Nuxt дополнительно кодирует каждый `/` как `/`. `runtimeConfig.public` уходит в `window.__NUXT__.config` через `uneval` из той же devalue. Тип `application/json` не исполняется, но вырваться из него через `</script>` можно, поэтому экранирование нужно и здесь. Если кладёте JSON в `useHead` или в свой `<script>` сами, экранируйте так же.

### XSS и гидрация

Гидрация не делает серверный HTML безопаснее. Браузер парсит ответ сервера **до** запуска Vue: `<img src=x onerror=…>` из серверной разметки сработает при разборе, Vue ещё не загружен. Отсюда типичная ошибка в Nuxt: DOMPurify нужен DOM, поэтому его вызывают только на клиенте (`import.meta.client`, `onMounted`, плагин `.client.ts`). На сервере `v-html` отрисовывает **сырую** строку, и атака срабатывает при первой загрузке, а клиентская санитизация опаздывает. Санитизируйте на сервере (DOMPurify с jsdom, `isomorphic-dompurify`) или ещё раньше, при сохранении. Хорошо, если санитизирует и сервер, и клиент.

### Санитайзинг

Когда нужен пользовательский HTML (rich-text, Markdown), экранирование не подходит: часть разметки должна выжить. **Санитайзер** разбирает HTML в дерево, удаляет всё вне allowlist и сериализует обратно.

- **DOMPurify** — стандарт де-факто. По умолчанию убирает `<script>`, обработчики `on*` и опасные схемы в `href`/`src`. Настраивается (`ALLOWED_TAGS`, `ALLOWED_ATTR`, хуки), умеет вернуть `TrustedHTML` (`RETURN_TRUSTED_TYPE: true`).
- **mXSS** (mutation XSS): санитайзер разбирает строку, сериализует безопасное дерево, а `innerHTML` разбирает результат **ещё раз**. Из-за особенностей HTML-парсера (`<noscript>`, `<svg>`/`<math>`, `<template>`) второй разбор может дать другое дерево, уже опасное. DOMPurify закрывает известные варианты, поэтому его нужно обновлять. Вставка строки, санитизированной давно и сохранённой в БД, ещё рискованнее: обход мог появиться позже.
- **Sanitizer API** (WICG, интегрирован в HTML Standard): `element.setHTML(html)` разбирает и санитизирует за **один** проход, без сериализации, и поэтому не подвержен mXSS этого вида. `setHTML` удаляет XSS-опасное (`<script>`, `<iframe>`, `<object>`, `<embed>`, обработчики `on*`) даже при конфиге, который это разрешает. Сырая вставка — `setHTMLUnsafe()`.

> [!WARNING]
> Поддержка Sanitizer API по MDN BCD (сверено 2026-11-12): Chrome/Edge 146, Firefox 148, в Safari нет. Это не Baseline. В Chrome до 153 и во всех версиях Firefox из allowlist не удаляется `<base>`. Пока Safari не поддерживает API, нужен фолбэк на DOMPurify.

Санитизируйте **на выходе**, в контексте использования: строка, безопасная для `innerHTML`, может быть опасна в атрибуте. Санитизация при сохранении — полезный дополнительный слой, но не единственный.

### Trusted Types

Trusted Types (W3C) переворачивают модель: опасные приёмники (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `script.src`, `iframe.srcdoc` и т. д.) перестают принимать строки и требуют типизированные объекты `TrustedHTML`, `TrustedScript`, `TrustedScriptURL`. Создать их можно только через **политики**, явно разрешённые в CSP:

```http
Content-Security-Policy: require-trusted-types-for 'script'; trusted-types sanitize
```

После этого `el.innerHTML = str` бросает `TypeError`, а все места, где строка становится разметкой, сведены в несколько политик, которые проходят ревью. DOM XSS становится ошибкой типа, а не ошибкой внимательности. Политика с именем `default` вызывается для любой строки неявно — это способ миграции, а не цель.

Поддержка (MDN BCD, сверено 2026-11-12): Chrome/Edge 83, Safari 26, Firefox 148 — Baseline 2026.

> [!WARNING]
> Vue и Trusted Types. `runtime-dom` (Vue 3.5) при загрузке создаёт политику `vue` с **пропускающим** `createHTML: (val) => val` и через неё пишет `innerHTML`, в том числе для `v-html`. Если директива `trusted-types` не ограничивает имена политик (или в ней есть `vue`), `v-html` с любой строкой проходит проверку. Чтобы Trusted Types что-то давали в Vue-приложении, не включайте `vue` в список. Тогда `createPolicy('vue')` упадёт (Vue это перехватит), и в `v-html` придётся передавать готовый `TrustedHTML` из своей санитизирующей политики. Но тогда не заработает и внутренняя вставка статического HTML, которой пользуется компилятор (`insertStaticContent`). Проверяйте приложение под `Content-Security-Policy-Report-Only`.

### Ограничение ущерба

XSS нужно предотвращать, но рассчитывать, что он невозможен, нельзя. Слои, которые уменьшают ущерб:

- **CSP** запрещает инлайновые скрипты и чужие источники. Внедрённый `<script>` или `onerror` тогда не выполнится. Подробно — в теме «Content Security Policy».
- **`HttpOnly`** на cookie сессии: скрипт не прочитает её и не унесёт. Но действовать от имени пользователя, пока вкладка открыта, он может. Подробнее — в [Same-origin policy, CORS и cookies](../network/cors-and-cookies.md) и [Хранилищах браузера](../network/browser-storage.md).
- **Отдельный origin для пользовательского контента**: загрузки и HTML пользователей отдаются с `usercontent.example` (не поддомен основного сайта — иначе same-site), плюс `X-Content-Type-Options: nosniff` и `Content-Disposition: attachment`.
- **`<iframe sandbox>`** без `allow-same-origin` даёт opaque origin. Документация Vue называет его единственным местом, где пользовательский HTML/CSS можно показывать без оговорок.
- Короткоживущие токены и повторная аутентификация для критичных действий (смена email, пароля, платёж).

## Примеры

Безопасный и опасный вывод во Vue рядом:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import DOMPurify from 'isomorphic-dompurify' // works on the server (jsdom) and in the browser

const props = defineProps<{
  name: string
  bioHtml: string
  website: string
  extraAttrs: Record<string, string>
}>()

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

const safeWebsite = computed(() => {
  try {
    const url = new URL(props.website, 'https://example.com')
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
})

// Sanitized on the server as well, so SSR never emits raw user HTML.
const safeBio = computed(() => DOMPurify.sanitize(props.bioHtml))

const ALLOWED_ATTRS = new Set(['title', 'lang', 'dir'])
const safeAttrs = computed(() =>
  Object.fromEntries(Object.entries(props.extraAttrs).filter(([k]) => ALLOWED_ATTRS.has(k))),
)
</script>

<template>
  <!-- Safe: textContent -->
  <h2>{{ name }}</h2>
  <!-- Safe only after protocol allowlist; undefined removes the attribute -->
  <a :href="safeWebsite" rel="noopener noreferrer">{{ website }}</a>
  <!-- Safe only because it is sanitized on both server and client -->
  <div v-html="safeBio" />
  <!-- Unfiltered v-bind="extraAttrs" would let { onclick: '...' } through -->
  <span v-bind="safeAttrs">…</span>
</template>
```

DOM-based XSS и её исправление без фреймворка:

```js
// Vulnerable: source (location.hash) flows into a sink (innerHTML).
const tab = decodeURIComponent(location.hash.slice(1))
document.querySelector('#title').innerHTML = `Tab: ${tab}`
// https://site/#<img src=x onerror=alert(document.cookie)>

// Fixed: textContent is not a sink.
document.querySelector('#title').textContent = `Tab: ${tab}`
```

Политика Trusted Types с санитайзером и фолбэком на Sanitizer API:

```js
const policy = trustedTypes.createPolicy('sanitize', {
  createHTML: (input) => DOMPurify.sanitize(input),
})

function renderUserHtml(el, html) {
  if ('setHTML' in Element.prototype) {
    el.setHTML(html) // single-pass parse and sanitize, no TrustedHTML needed
  } else {
    el.innerHTML = policy.createHTML(html)
  }
}
```

## Вопросы с интервью

::: details Почему script, вставленный через innerHTML, не выполняется, а img с onerror выполняется
HTML Standard помечает `<script>`, созданные фрагментным парсером (`innerHTML`, `outerHTML`, `insertAdjacentHTML`), как «already started», и они никогда не выполняются. Это защита от случайного исполнения, а не от атак: обработчики событий на других элементах работают как обычно. `<img src=x onerror=…>` начинает загрузку сразу после вставки, получает ошибку, и обработчик срабатывает. То же с `<svg onload>`, `<iframe src="javascript:…">`, `<details open ontoggle>`. Поэтому фильтр «вырезать `<script>`» бесполезен. А вот `document.createElement('script')` с последующей вставкой скрипт выполняет — так работают динамические загрузчики.
:::

::: details Во Vue интерполяция экранирует всё — значит, XSS во Vue-приложении невозможен
Нет. <code v-pre>{{ }}</code> и `:attr` закрывают два контекста: текст и значение атрибута. Остаются: `v-html` и `innerHTML` в рендер-функциях; URL-атрибуты (`:href` с `javascript:` Vue не проверяет); `v-bind="obj"`, где пользователь задаёт ключи (строковый `onclick` станет инлайновым обработчиком); строковый `:style` (clickjacking); шаблоны из пользовательских строк (выражения — это JavaScript); монтирование Vue на серверный HTML с пользовательским контентом (client-side template injection). Плюс всё, что Vue не контролирует: прямые обращения к DOM в директивах, сторонние компоненты, `eval`/`setTimeout` со строкой, сериализация состояния при SSR.
:::

::: details Почему проверка URL регуляркой на javascript: ненадёжна и как правильно
Парсер URL нормализует строку, а регулярка видит её как есть. По WHATWG URL Standard ведущие и хвостовые управляющие символы и пробелы отбрасываются, табы и переводы строк удаляются **везде**, схема не зависит от регистра. `' javascript:…'`, `'java\tscript:…'`, `'JaVaScRiPt:…'` проходят мимо `/^javascript:/` и выполняются. Кроме того, есть `data:`, `vbscript:` и схемы, которых вы ещё не знаете. Правильно — **allowlist после разбора**: `new URL(input, base)` и проверка `url.protocol` по набору `http:`, `https:`, `mailto:`. Отдавать нужно нормализованный `url.href`, а не исходную строку. По совету Vue это стоит делать и на бэкенде до сохранения.
:::

::: details Почему в Nuxt нельзя санитизировать v-html только на клиенте
Потому что при SSR сервер отрисует `v-html` с сырой строкой, а браузер разберёт этот HTML до загрузки Vue. `<img onerror>` сработает на первой же загрузке страницы. Гидрация не «чинит» разметку задним числом: код из неё уже выполнился. Санитайзер нужен на сервере (DOMPurify с jsdom или `isomorphic-dompurify`) либо при сохранении, плюс на клиенте для данных, которые приходят после гидрации. Отсюда общий принцип: каждый путь, по которому данные попадают в HTML, включая серверный рендер, должен проходить через одну и ту же функцию.
:::

::: details Чем опасен JSON.stringify состояния в script при SSR и как это решено в Nuxt
HTML-парсер закрывает `<script>` на первой подстроке `</script>`, ничего не зная о JavaScript-строках. `JSON.stringify` не экранирует `<`, поэтому значение `"</script><script>alert(1)</script>"` в состоянии выходит из тега. Решение — заменить `<` на `<` (для JS это тот же символ) и экранировать U+2028/U+2029. Nuxt сериализует payload через `devalue.stringify`, которая так и делает, дополнительно кодирует `/` и кладёт результат в `<script type="application/json" id="__NUXT_DATA__">`. Тип JSON не исполняется, но экранирование всё равно нужно: выход через `</script>` работает и там.
:::

::: details Что дают Trusted Types и почему они не включаются во Vue-приложении одной строкой
С `require-trusted-types-for 'script'` опасные приёмники принимают только `TrustedHTML`/`TrustedScript`/`TrustedScriptURL`. Их создают политики, имена которых перечислены в директиве `trusted-types`. Каждый путь «строка → код» становится явным и проверяемым, остальные падают с `TypeError`. Это Baseline 2026: Chrome 83, Safari 26, Firefox 148. Во Vue 3.5 `runtime-dom` сам создаёт пропускающую политику `vue` и пишет через неё `innerHTML`, включая `v-html`. Если `vue` разрешена, `v-html` фактически обходит защиту. Если запрещена, нужно передавать в `v-html` `TrustedHTML` из своей санитизирующей политики и проверить, что не ломается вставка статического контента. Включают поэтапно через Report-Only.
:::

::: details Защищает ли HttpOnly от XSS
От кражи cookie — да: `document.cookie` её не вернёт, и злоумышленник не унесёт сессию на свою машину. От самого XSS — нет: скрипт выполняется в origin страницы и шлёт запросы с cookie сессии, пока вкладка открыта. Может прочитать персональные данные из DOM, CSRF-токен со страницы, подменить форму ввода пароля. `HttpOnly` сокращает окно и масштаб атаки, но не заменяет предотвращение. Ту же роль играют CSP, короткоживущие токены и повторный ввод пароля для критичных операций.
:::

## Задачи

### 1. Подсветка совпадений без XSS · легко

Напишите `highlight(text, query)`. Функция возвращает HTML-строку для `v-html`, где все вхождения `query` (без учёта регистра) обёрнуты в `<mark>`. И `text`, и `query` приходят от пользователя.

::: details Решение и разбор
```js
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ENTITIES[ch])
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function highlight(text, query) {
  if (!query) return escapeHtml(text)
  const re = new RegExp(escapeRegExp(query), 'gi')
  let out = ''
  let last = 0
  for (const m of text.matchAll(re)) {
    out += escapeHtml(text.slice(last, m.index))
    out += `<mark>${escapeHtml(m[0])}</mark>`
    last = m.index + m[0].length
  }
  return out + escapeHtml(text.slice(last))
}
```

Порядок важен: сначала разбиваем **исходный** текст, потом экранируем каждый кусок. Если экранировать весь текст и затем искать `query`, запрос `amp` найдётся внутри `&amp;` и разорвёт сущность. Если не экранировать `query` для регулярки, ввод `(` бросит исключение, а `.*` подсветит всё. Во Vue надёжнее обойтись без `v-html`: вернуть массив `{ text, match }` и отрисовать `v-for` с <code v-pre>&lt;mark v-if="part.match"&gt;{{ part.text }}&lt;/mark&gt;</code>. Тогда экранирование делает Vue.

Сложность: O(n) по времени и памяти, n — длина текста.
:::

### 2. Безопасный href · средне

Напишите `toSafeHref(input, base)`. Функция возвращает нормализованный URL, если схема `http:`, `https:` или `mailto:`, иначе `undefined`. Должна выдерживать `' javascript:alert(1)'`, `'java\nscript:alert(1)'`, `'JAVASCRIPT:alert(1)'`, относительные пути и мусор.

::: details Решение и разбор
```js
const ALLOWED = new Set(['http:', 'https:', 'mailto:'])

export function toSafeHref(input, base = location.origin) {
  if (typeof input !== 'string') return undefined
  let url
  try {
    url = new URL(input, base)
  } catch {
    return undefined
  }
  return ALLOWED.has(url.protocol) ? url.href : undefined
}

toSafeHref(' javascript:alert(1)')   // undefined: parser strips the space, protocol is 'javascript:'
toSafeHref('java\nscript:alert(1)')  // undefined: newline removed
toSafeHref('/profile/42')            // 'https://site.example/profile/42'
toSafeHref('//evil.example/x')       // 'https://evil.example/x' — scheme-relative, still allowed
```

Ключ — проверять результат **парсера**, а не строку. URL Standard удаляет табы и переводы строк в любом месте, отбрасывает ведущие управляющие символы и пробелы, приводит схему к нижнему регистру. Возвращать надо `url.href`: исходная строка может разобраться иначе в другом месте. Allowlist, а не blocklist: `data:`, `vbscript:`, `blob:`, `filesystem:` в blocklist легко забыть. Последний пример показывает, чего функция **не** делает: схема безопасна, но домен чужой. Для open redirect (`?next=`) нужна отдельная проверка `url.origin === location.origin`. Во Vue `undefined` в `:href` убирает атрибут целиком.

Сложность: O(n) по длине строки.
:::

### 3. Найти уязвимости в компоненте · средне

Найдите все проблемы и исправьте компонент. `comment` приходит из API и полностью задаётся пользователем: `{ author, html, avatarUrl, link, style, attrs }`.

```vue
<script setup>
const props = defineProps(['comment'])
</script>

<template>
  <article v-bind="comment.attrs" :style="comment.style">
    <img :src="comment.avatarUrl" :alt="comment.author">
    <a :href="comment.link">{{ comment.author }}</a>
    <div v-html="comment.html" />
  </article>
</template>
```

::: details Решение и разбор
1. `v-bind="comment.attrs"` — ключ `onclick` со строкой станет инлайновым обработчиком, и SSR его тоже отрисует. Фильтровать по allowlist имён.
2. `:style="comment.style"` строкой — clickjacking (прозрачный блок поверх страницы, `position: fixed`). Объект стилей с allowlist свойств и значений или вообще без пользовательских стилей.
3. `:href="comment.link"` — `javascript:`. Нужен `toSafeHref` из задачи 2, а для внешних ссылок — `rel="noopener noreferrer ugc"`.
4. `v-html="comment.html"` — санитизировать на сервере и клиенте (`isomorphic-dompurify`), или хранить Markdown и рендерить его санитайзером на выходе.
5. `:src` у `<img>` скрипт не выполнит: `javascript:` в `src` картинки не исполняется. Но URL от пользователя — это трекинг (запрос уходит на чужой сервер с IP читателя) и подмена контента. Проксировать изображения через свой домен или ограничить хосты.
6. <code v-pre>{{ comment.author }}</code> и `:alt` безопасны: текст и значение атрибута.

```vue
<script setup>
import { computed } from 'vue'
import DOMPurify from 'isomorphic-dompurify'
import { toSafeHref } from './safe-href'

const props = defineProps(['comment'])
const ALLOWED_ATTRS = ['lang', 'dir', 'title']

const attrs = computed(() =>
  Object.fromEntries(ALLOWED_ATTRS.filter((k) => k in (props.comment.attrs ?? {}))
    .map((k) => [k, String(props.comment.attrs[k])])),
)
const link = computed(() => toSafeHref(props.comment.link))
const html = computed(() => DOMPurify.sanitize(props.comment.html ?? ''))
const avatar = computed(() => `/img-proxy?url=${encodeURIComponent(props.comment.avatarUrl ?? '')}`)
</script>

<template>
  <article v-bind="attrs">
    <img :src="avatar" :alt="comment.author">
    <a :href="link" rel="noopener noreferrer ugc">{{ comment.author }}</a>
    <div v-html="html" />
  </article>
</template>
```

Хороший ответ добавляет защитные слои: CSP без `'unsafe-inline'` в `script-src`, чтобы пропущенный инлайновый обработчик не выполнился, и санитизацию при сохранении на бэкенде.
:::

### 4. Встраивание состояния при SSR · средне

Напишите `serializeForScript(value)`. Результат вставляется как `<script>window.__STATE__ = ${result}</script>` и должен давать тот же объект для любых строк в данных, включая `</script>`, `<!--` и U+2028.

::: details Решение и разбор
```js
const UNSAFE = { '<': '\\u003C', '>': '\\u003E', '/': '\\u002F', '\u2028': '\\u2028', '\u2029': '\\u2029' }

export function serializeForScript(value) {
  return JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (ch) => UNSAFE[ch])
}

serializeForScript({ name: '</script><script>alert(1)</script>' })
// {"name":"</script><script>alert(1)</script>"}
```

Символы `<`, `>`, `/` встречаются в JSON только внутри строк, а там `<` — тот же символ. Значит, замена не меняет данные, но HTML-парсер больше не увидит `</script>` или `<!--` (последнее переводит парсер в особые состояния разбора скрипта). U+2028/U+2029 были недопустимы в строковых литералах JS до ES2019. Сейчас это перестраховка для старых движков. Ограничения `JSON.stringify`: `Date` становится строкой, `Map`/`Set`/`undefined`/циклы теряются. Поэтому Nuxt использует devalue — она сохраняет типы и ссылки и экранирует так же. Ещё лучше — не исполняемый скрипт, а `<script type="application/json">` и `JSON.parse(el.textContent)` на клиенте: тогда CSP не нужен `'unsafe-inline'` или nonce ради состояния.

Сложность: O(n) по длине сериализованной строки.
:::

### 5. Комментарии с Markdown в Nuxt · сложно

Спроектируйте вывод пользовательских комментариев с Markdown в Nuxt-приложении с SSR. Требования: ссылки и форматирование работают, XSS невозможен даже при ошибке в одном слое, страница корректна с первой загрузки (SSR), включены Trusted Types.

::: details Решение и разбор
**Хранение.** В БД — исходный Markdown, а не HTML. Тогда смена санитайзера или найденный обход исправляются без миграции данных, а риск mXSS для «санитизированного когда-то» HTML не возникает.

**Рендер.** Одна функция `renderComment(md)` в общем коде (`utils/`), которая работает и на сервере, и на клиенте:

```ts
import { marked } from 'marked'
import DOMPurify from 'isomorphic-dompurify'

const CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'a'],
  ALLOWED_ATTR: ['href'],
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('rel', 'noopener noreferrer ugc')
    node.setAttribute('target', '_blank')
  }
})

export function renderComment(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false }) as string, CONFIG)
}
```

Markdown-парсер сам по себе не санитайзер: он пропускает сырой HTML внутри Markdown и `[x](javascript:…)`. Поэтому санитизация идёт **после** него, по жёсткому allowlist тегов и атрибутов. DOMPurify проверяет схему `href`.

**SSR.** HTML вычисляется на сервере в `useAsyncData` и попадает в payload (devalue экранирует `<`). Компонент выводит его через `v-html`. На сервере санитизация уже прошла, поэтому первая загрузка безопасна.

**Trusted Types.** CSP: `require-trusted-types-for 'script'; trusted-types comment-html` — без `vue`, иначе `v-html` обходит проверку. На клиенте политика `comment-html` с `createHTML: renderComment` (повторная санитизация дешева). В `v-html` передаётся её результат. Вставку статического контента компилятором проверить в Report-Only до включения enforce.

**Слои на случай ошибки.** CSP с nonce и `'strict-dynamic'` без `'unsafe-inline'`: пропущенный `onerror` не выполнится. Cookie сессии — `HttpOnly; Secure; SameSite=Lax`. Ссылки — `rel="ugc noopener"`. Регулярное обновление DOMPurify. Тест с корпусом нагрузок (OWASP, PortSwigger cheat sheet), который прогоняет `renderComment` и проверяет, что в результате нет `on*` и опасных схем.

**Альтернатива** для сложного форматирования — `<iframe sandbox>` на отдельном домене. Это максимальная изоляция, но ценой высоты фрейма, стилей и доступности.
:::

## Источники

- [OWASP: Cross Site Scripting Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP: DOM based XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html)
- [HTML Standard: the script element (parser-inserted, «already started»)](https://html.spec.whatwg.org/multipage/scripting.html#the-script-element)
- [HTML Standard: Safe and unsafe HTML parsing methods (`setHTML`, `setHTMLUnsafe`)](https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#html-parsing-methods)
- [URL Standard: URL parsing](https://url.spec.whatwg.org/#url-parsing)
- [W3C: Trusted Types](https://w3c.github.io/trusted-types/dist/spec/)
- [WICG: HTML Sanitizer API](https://wicg.github.io/sanitizer-api/)
- [Vue.js: Security](https://vuejs.org/guide/best-practices/security.html)
- [Vue.js: Server-Side Rendering](https://vuejs.org/guide/scaling-up/ssr.html)
- [Исходники Vue: `runtime-dom` (политика Trusted Types, `patchProp`)](https://github.com/vuejs/core/tree/main/packages/runtime-dom/src)
- [Исходники Nuxt: рендер payload](https://github.com/nuxt/nuxt/blob/main/packages/nuxt/src/runtime/server/renderer/payload.ts)
- [devalue](https://github.com/sveltejs/devalue)
- [MDN: Element.setHTML()](https://developer.mozilla.org/en-US/docs/Web/API/Element/setHTML)
- [MDN: Trusted Types API](https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API)
- [MDN: Cross-site scripting (XSS)](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/XSS)
- [DOMPurify](https://github.com/cure53/DOMPurify)
- [PortSwigger: Cross-site scripting cheat sheet](https://portswigger.net/web-security/cross-site-scripting/cheat-sheet)
