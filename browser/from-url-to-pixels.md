---
title: От ввода URL до отображения страницы
level: ядро
---

# От ввода URL до отображения страницы

> **Коротко.** Браузер разбирает введённое, находит сервер (DNS), устанавливает соединение (TCP + TLS или QUIC) и получает HTML. HTML разбирается **потоково**: DOM строится по мере прихода байтов. Внешний CSS **блокирует рендеринг**, а через «таблицу стилей, блокирующую скрипты», — и выполнение синхронных скриптов. Синхронный `<script>` **блокирует парсер**. `defer` и `type="module"` выполняются после разбора, но до `DOMContentLoaded`, `async` — когда готов. Preload scanner заранее находит ресурсы в разметке, пока парсер стоит. Быстрая страница — это короткий **критический путь**: мало блокирующих ресурсов, мало байтов, мало сетевых round trip.

**Связанные темы:** [Event loop](../javascript/event-loop.md), [Модули: ESM и CommonJS](../javascript/modules.md), [Конвейер рендеринга: layout, paint, composite](./rendering-pipeline.md), [Web Workers, Service Workers и PWA](./workers.md), [HTTP: методы, статусы, заголовки, версии](../network/http.md), [HTTP-кэширование и CDN](../network/caching.md), [Core Web Vitals и измерение](../performance/web-vitals.md), [Оптимизация загрузки](../performance/loading.md)

## Теория

### Общая картина

Классический вопрос «что происходит после ввода URL» проверяет не память, а умение держать в голове **конвейер** и знать, где он стоит. Этапы:

1. **Ввод.** Строка — URL или поисковый запрос? Если URL — дописать схему, применить HSTS (`http:` превращается в `https:` до любого запроса).
2. **Навигация.** У текущей страницы спрашивают `beforeunload`. Затем проверяются bfcache, [Service Worker](./workers.md#перехват-fetch) (может ответить сам) и [HTTP-кэш](../network/caching.md).
3. **Сеть.** DNS → TCP → TLS → HTTP-запрос → ответ. Обзор ниже, подробно — тема [«HTTP: методы, статусы, заголовки, версии»](../network/http.md).
4. **Решение по ответу.** Редирект (`3xx`) — навигация начинается заново. `Content-Type: text/html` — документ. `Content-Disposition: attachment` или неизвестный тип — загрузка файла.
5. **Коммит навигации.** Создаётся новый `Document`, старый выгружается (`pagehide`, `unload`) или уходит в bfcache.
6. **Разбор HTML** → DOM; параллельно загрузка и разбор CSS → CSSOM; загрузка и выполнение скриптов.
7. **Рендеринг:** стили → layout → paint → composite. Первый кадр случается, как только документ перестаёт быть render-blocked, — **до** конца разбора. Подробно — тема [«Конвейер рендеринга»](./rendering-pipeline.md).
8. **События загрузки:** `readyState = 'interactive'` → defer- и module-скрипты → `DOMContentLoaded` → (async-скрипты, изображения, iframe) → `readyState = 'complete'` → `load` → `pageshow`.

> [!WARNING]
> Как этапы распределены по процессам — деталь движка. В Chromium навигацией управляет **browser process**, запросы делает **network service**, а документ разбирает и рисует **renderer process**, отдельный на каждый сайт (site isolation). Renderer получает ответ только при коммите навигации. Спецификация говорит о «навигации» и «документе», а не о процессах.

### Сеть: обзорно

- **DNS.** Имя → IP. Кэши по цепочке: браузер → ОС → рекурсивный резолвер провайдера или DoH. Холодный запрос — от единиц до сотен миллисекунд.
- **TCP.** Рукопожатие — 1 RTT. Затем **slow start**: первое окно перегрузки по [RFC 6928](https://www.rfc-editor.org/rfc/rfc6928) — 10 сегментов, около 14 КБ. Отсюда эвристика «критическое — в первые ~14 КБ HTML»: остальное придёт следующим RTT. С учётом TLS и заголовков это ориентир, а не закон.
- **TLS 1.3** — ещё 1 RTT (TLS 1.2 — 2 RTT), повторное соединение может использовать 0-RTT.
- **HTTP/3 поверх QUIC** совмещает транспортное и TLS-рукопожатие в 1 RTT и не страдает от потери одного пакета для всех потоков сразу (head-of-line blocking на уровне TCP). Подробно — [«HTTP: версии»](../network/http.md#http-3-quic-поверх-udp).
- **Ответ.** Важна метрика **TTFB** (time to first byte): сколько ждали первый байт. В неё входят сеть и время работы сервера (SSR, база). `103 Early Hints` позволяет серверу прислать `Link: rel=preload/preconnect` ещё **до** финального ответа, пока страница рендерится.

### Разбор HTML

HTML-парсер — не классический парсер по грамматике, а **конечный автомат**, описанный в HTML Living Standard: токенизатор (теги, атрибуты, текст) и построение дерева с режимами вставки. Он **никогда не падает**: на любой ошибке спецификация задаёт восстановление (незакрытые теги закрываются, `<table>` с мусором перестраивается, `<p>` внутри `<p>` закрывает первый). Поэтому DOM может не совпадать с исходником — источник hydration mismatch при SSR.

Ключевые свойства:

- **Потоковость.** Парсер работает по мере прихода байтов. Сервер, отдающий `<head>` сразу (flush), позволяет браузеру начать грузить CSS и JS, пока он ещё считает тело.
- **Кодировка.** Определяется до разбора: BOM → `charset` в `Content-Type` → `<meta charset>` в первых **1024 байтах** (prescan) → эвристика. Поздно найденная кодировка заставляет разбирать документ заново. Поэтому `<meta charset="utf-8">` — первым в `<head>`.
- **Реентерабельность.** Синхронный скрипт может вызвать `document.write` и вставить разметку прямо в поток парсера. Именно поэтому парсер **обязан** остановиться перед синхронным скриптом: тот может изменить всё, что идёт дальше.

### Скрипты: что блокирует парсер

Спецификация раскладывает внешние скрипты по четырём очередям. Отсюда вся таблица поведения:

| Разметка | Загрузка | Выполнение | Порядок |
| --- | --- | --- | --- |
| `<script src>` | парсер стоит | сразу после загрузки | по документу |
| `<script defer src>` | параллельно | после разбора, до `DOMContentLoaded` | по документу |
| `<script async src>` | параллельно | как только загружен, может прервать разбор | любой |
| `<script type="module">` (и встроенный) | параллельно, весь граф | как `defer` | по документу |
| `<script type="module" async>` | параллельно, весь граф | как `async` | любой |
| встроенный `<script>` без `type` | — | сразу | по документу |

Детали, которые проверяют на senior-интервью:

- `defer` и `async` работают только с `src`. На встроенном классическом скрипте они игнорируются. На модуле `defer` ничего не меняет — он и так отложен; `async` на встроенном модуле работает.
- `async` вместе с `defer` → побеждает `async`. Сочетание исторически писали, чтобы старые браузеры без `async` взяли `defer`.
- **Динамически вставленный** скрипт (`document.createElement('script')`) по умолчанию ведёт себя как `async` (флаг force async). `script.async = false` переводит его в очередь «выполнить по порядку, как только возможно» — так грузят зависимые скрипты без блокировки парсера.
- `DOMContentLoaded` **ждёт** defer- и module-скрипты, но **не ждёт** async. `load` ждёт всё, что задерживает это событие: async-скрипты, изображения, iframe.

### CSS: что блокирует рендеринг и скрипты

CSS не блокирует **парсер**, но:

1. **Блокирует рендеринг.** Таблицы стилей из `<head>`, вставленные парсером, — *implicitly render-blocking*: браузер не рисует, пока их не загрузит. Иначе был бы FOUC (flash of unstyled content) и лишний layout. `media`, который не совпадает (`media="print"`, `(min-width: 1200px)` на телефоне), снимает блокировку — файл всё равно грузится, но с низким приоритетом.
2. **Блокирует скрипты.** Таблица стилей из разметки — *script-blocking style sheet*. Синхронный скрипт после неё (и внешний, и **встроенный**) не выполнится, пока она не загрузится: скрипт может спросить `getComputedStyle` и должен получить правильный ответ. А раз скрипт стоит, стоит и **парсер**. Так медленный CSS опосредованно блокирует разбор HTML.
3. **Задерживает `DOMContentLoaded`.** Defer-скрипты тоже ждут блокирующие таблицы стилей, а `DOMContentLoaded` ждёт defer-скрипты. Без defer-скриптов CSS на `DOMContentLoaded` не влияет.

Сам документ render-blocked, пока у него нет `<body>` (и не истёк таймаут движка): рисовать `<head>` бессмысленно. Явно заблокировать рендеринг можно атрибутом `blocking="render"` на `<script>`, `<link>` и `<style>` — например, для скрипта, который выбирает тему до первого кадра.

> [!NOTE]
> `blocking="render"` поддерживают Chromium 105+ и Safari 18.2+, в Firefox — только в превью-версиях (MDN BCD, сверено 2026-11-12). `fetchpriority` — во всех трёх движках: Chromium 101, Safari 17.2, Firefox 132.

> [!WARNING]
> Таблица стилей **в `<body>`** по спецификации не render-blocking: добавлять render-blocking элементы можно, только пока `body` нет. Движки исторически вели себя по-разному: одни переставали рисовать, найдя такую таблицу, другие рисовали контент выше неё. Стабильно одно: синхронный скрипт после неё ждёт её загрузки.

### Preload scanner

Пока основной парсер стоит на синхронном скрипте, **speculative parser** (в движках — preload scanner) читает разметку дальше и заранее запускает загрузки: `<script src>`, `<link rel=stylesheet>`, `<img src/srcset>`, `<link rel=preload>`. В спецификации это разрешённая оптимизация с правилом: не загружать то, что не загрузил бы обычный парсер, если бы скрипт ничего не сделал.

Сканер видит **только разметку**. Он не находит:

- изображения из CSS (`background-image`) и шрифты из `@font-face` — они видны только после разбора CSS;
- скрипты и стили, которые вставляет JavaScript;
- `<img data-src>` у ленивых загрузчиков на JS;
- всё, что рисует клиентский рендеринг: у SPA в HTML пустой `<div id="app">`.

Скрытые ресурсы образуют **водопад** (waterfall): HTML → JS → данные → изображение, каждый шаг — новый RTT. Лечение — сделать ресурс видимым в HTML (`<img src>`, SSR) или подсказать: `<link rel="preload">` для ресурса текущей страницы, `<link rel="preconnect">` для чужого origin, `fetchpriority="high"` для LCP-изображения. Подробно о подсказках — тема «[Оптимизация загрузки](../performance/loading.md)».

### Критический путь рендеринга

**Critical rendering path** — последовательность шагов от байтов до первого кадра: HTML → DOM, CSS → CSSOM, DOM + CSSOM → render tree (только видимые узлы с вычисленными стилями: без `<head>`, без `display: none`), layout, paint, composite. Длину пути описывают три числа:

- **число критических ресурсов** — блокирующих первый рендер;
- **критические байты** — их суммарный размер;
- **длина критического пути в round trip** — сколько последовательных сетевых шагов нужно, чтобы получить их все. Именно цепочки (`@import` внутри CSS, скрипт, который грузит скрипт) делают её длинной.

Оптимизация — уменьшить все три: убрать блокирующие ресурсы (`defer`/`module`, `media` у CSS), сократить байты (минификация, сжатие, critical CSS встроить, остальное грузить неблокирующе), разорвать цепочки (никаких `@import`, preload для поздно обнаруживаемого).

### Vue и Nuxt: где это видно

- **Vite** собирает `index.html` с `<script type="module" crossorigin src="/assets/index-….js">` в `<head>`: модуль отложен, поэтому к моменту `createApp().mount('#app')` DOM уже разобран. Чанки, которые точно понадобятся, Vite объявляет через `<link rel="modulepreload">`, срезая водопад по графу модулей.
- **SPA** отдаёт пустой `<div id="app">`. First Contentful Paint случается только после загрузки и выполнения JS, а preload scanner не видит ни данных, ни изображений. Отсюда типичный водопад: HTML → бандл → API → картинка.
- **SSR в Nuxt** отдаёт готовую разметку: контент и `<img src>` видны сканеру и рисуются сразу после CSS. Скрипты — модули, страница становится **интерактивной** только после загрузки JS и гидрации. Состояние приходит в той же странице как payload (`<script type="application/json" id="__NUXT_DATA__">`), без второго запроса. Подробно — темы «SSR и гидрация» и «Режимы рендеринга».

## Примеры

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"> <!-- first: must be within the first 1024 bytes -->
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shop</title>

  <!-- Third-party origin needed early: warm up DNS + TCP + TLS -->
  <link rel="preconnect" href="https://cdn.example.com" crossorigin>

  <!-- Render-blocking, but small and on the critical path -->
  <link rel="stylesheet" href="/css/main.css">
  <!-- Downloaded, but does not block rendering on screens -->
  <link rel="stylesheet" href="/css/print.css" media="print">

  <!-- LCP image is a CSS background: invisible to the preload scanner -->
  <link rel="preload" as="image" href="/img/hero.avif" fetchpriority="high">

  <!-- Deferred: parallel download, runs after parsing, in order -->
  <script type="module" src="/js/app.js"></script>
  <!-- Independent: runs whenever ready -->
  <script async src="https://analytics.example.com/a.js"></script>
</head>
<body>…</body>
</html>
```

```js
// Where did the time go? Navigation Timing Level 2
const [nav] = performance.getEntriesByType('navigation');
console.table({
  redirect: nav.redirectEnd - nav.redirectStart,
  dns: nav.domainLookupEnd - nav.domainLookupStart,
  tcpAndTls: nav.connectEnd - nav.connectStart,
  ttfb: nav.responseStart - nav.startTime,
  download: nav.responseEnd - nav.responseStart,
  domInteractive: nav.domInteractive,                // parsing finished
  domContentLoaded: nav.domContentLoadedEventStart,  // defer/module scripts done
  load: nav.loadEventStart,
});

// Which resources blocked rendering (Chromium: renderBlockingStatus)
for (const r of performance.getEntriesByType('resource')) {
  if (r.renderBlockingStatus === 'blocking') console.log(r.name, r.duration);
}
```

```js
// Readiness without races: the event may have already fired
function onReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn(); // 'interactive' or 'complete'
  }
}
```

## Вопросы с интервью

::: details Что происходит после ввода URL в адресную строку
Браузер решает, URL это или запрос, дописывает схему и применяет HSTS. Начинается навигация: `beforeunload` у текущей страницы, проверка bfcache, Service Worker и HTTP-кэша. Если ответа нет — DNS, TCP (1 RTT), TLS 1.3 (ещё 1 RTT; QUIC совмещает оба в одном), HTTP-запрос. По ответу: редирект — повтор, `text/html` — документ, иначе загрузка файла. После коммита навигации HTML разбирается потоково в DOM. Найденный CSS грузится и становится CSSOM, preload scanner заранее запускает загрузки. Синхронные скрипты останавливают парсер, defer и module выполняются после разбора. Когда блокирующий CSS загружен и есть `body`, движок строит дерево рендеринга, делает layout, paint и composite — первый кадр появляется ещё до конца разбора. Затем `DOMContentLoaded`, догрузка изображений и async-скриптов, `load`. На senior-уровне важно не перечислить шаги, а показать, где конвейер стоит и как это сократить.
:::

::: details Почему CSS блокирует рендеринг и может ли он блокировать JavaScript
Рисовать без стилей бессмысленно: будет вспышка нестилизованного контента и повторный layout, поэтому таблицы стилей из `<head>` блокируют первый рендер. `media`, который не совпадает, снимает блокировку. Парсер CSS не останавливает, но синхронный скрипт после таблицы стилей — внешний или встроенный — ждёт её загрузки: он может прочитать вычисленные стили и должен получить правильные. Пока ждёт скрипт, стоит и парсер. Поэтому порядок «CSS, потом синхронный скрипт» превращает медленный CSS в задержку всего разбора. Defer-скрипты тоже ждут таблицы стилей, а с ними сдвигается `DOMContentLoaded`.
:::

::: details Чем отличаются async, defer и type module
Все три грузят файл параллельно с разбором. `defer` выполняет скрипты после разбора, по порядку документа, до `DOMContentLoaded`. `async` выполняет скрипт, как только он загружен, — в любом порядке и, возможно, посреди разбора; `DOMContentLoaded` его не ждёт. Модуль по умолчанию отложен, как `defer`, но загружает весь граф импортов, всегда в strict mode и с CORS; с `async` ведёт себя как async. `defer`/`async` действуют только на скрипты с `src`. Выбор: `defer` или модуль — для кода приложения, которому нужен DOM и порядок; `async` — для независимых скриптов вроде аналитики.
:::

::: details Что такое preload scanner и что ему мешает
Второй, упрощённый парсер, который читает разметку вперёд, пока основной стоит на синхронном скрипте, и заранее запускает загрузку скриптов, стилей и изображений. Благодаря ему блокирующий скрипт не превращает загрузку страницы в последовательность. Он видит только HTML, поэтому ему мешают ресурсы, которые появляются позже: фоновые изображения и шрифты из CSS, скрипты, вставленные JS, `data-src` у ленивых загрузчиков, весь контент клиентского рендеринга. Решения — вернуть ресурс в разметку (`<img src>`, SSR) или подсказать: `preload`, `preconnect`, `fetchpriority`.
:::

::: details Чем DOMContentLoaded отличается от load
`DOMContentLoaded` срабатывает на `document`, когда разбор закончен и выполнены defer- и module-скрипты: DOM готов, можно вешать обработчики. Он не ждёт изображения, iframe и async-скрипты, но косвенно ждёт CSS, если есть defer-скрипты. `load` срабатывает на `window`, когда загружено всё, что задерживает событие load: изображения, iframe, async-скрипты. Перед ним `readyState` становится `'complete'`, после — `pageshow`. Ни одно из них не означает, что пользователь что-то увидел: для этого есть метрики отрисовки (FCP, LCP), см. «[Core Web Vitals и измерение](../performance/web-vitals.md)».
:::

::: details Что такое критический путь рендеринга и как его сократить
Последовательность от байтов HTML до первого кадра: DOM, CSSOM, дерево рендеринга, layout, paint. Его длину задают число блокирующих ресурсов, их байты и число последовательных round trip, чтобы их получить. Сокращают все три: скрипты — `defer` или модуль, некритичный CSS — с `media` или неблокирующей загрузкой, критический CSS — встроить; сжатие и минификация; разрыв цепочек — без `@import`, с `preload` для поздно обнаруживаемых ресурсов и `preconnect` для чужих origin. Отдельный рычаг — TTFB: кэш, CDN, потоковая отдача `<head>`.
:::

::: details Почему SSR показывает контент быстрее SPA, но не делает страницу интерактивной сразу
SPA отдаёт пустой контейнер: контент появляется только после загрузки, разбора и выполнения бандла, а данные и картинки обнаруживаются ещё позже — цепочка round trip. SSR отдаёт готовый HTML: он рисуется сразу после блокирующего CSS, изображения видны preload scanner. Но обработчики событий навешивает только JS после гидрации, и до неё кнопки не работают. Поэтому SSR улучшает FCP и LCP, но не обязательно INP, и стоимость JS остаётся. Nuxt дополнительно передаёт состояние в payload страницы, чтобы гидрация не повторяла запросы, и умеет откладывать гидрацию компонентов.
:::

## Задачи

### 1. Порядок выполнения · средне

`slow.css` загружается 2 секунды, остальные файлы — мгновенно. Каждый скрипт печатает свою метку. В каком порядке появятся метки и что можно сказать о времени?

```html
<head>
  <link rel="stylesheet" href="slow.css">
  <script>console.log('inline')</script>
  <script defer src="defer.js"></script>          <!-- 'defer' -->
  <script type="module">console.log('module')</script>
  <script async src="async.js"></script>          <!-- 'async' -->
  <script>
    document.addEventListener('DOMContentLoaded', () => console.log('DCL'));
    addEventListener('load', () => console.log('load'));
  </script>
</head>
<body>
  <p>Hello</p>
  <script>console.log('body')</script>
</body>
```

::: details Решение и разбор
Порядок: `inline` → `body` → `defer` → `module` → `DCL` → `load`, а `async` — где-то **после** `inline` и **до** `load`.

- `inline` — встроенный классический скрипт после таблицы стилей, блокирующей скрипты. Он ждёт `slow.css` 2 секунды, и всё это время **парсер стоит**. Это главный ответ задачи: встроенный скрипт без единого запроса сделал CSS блокирующим для разбора.
- После `slow.css` парсер идёт дальше. `defer` и встроенный модуль попадают в список «выполнить после разбора» **в порядке документа**: `defer` раньше `module`, хотя модуль встроенный.
- `async.js` скорее всего уже загружен preload scanner'ом, но выполнится только после того, как до тега дойдёт основной парсер. Дальше — как только готов: до `body`, между `body` и `DCL` или после `DCL`. Порядок не гарантирован.
- `DCL` — после всех defer и module. `load` ждёт и async-скрипт.
- Первый кадр — тоже только после `slow.css`: таблица стилей render-blocking.

Исправление: сделать встроенный скрипт не зависящим от CSS (перенести выше `<link>` или в модуль) или вынести некритичный CSS из блокирующих.
:::

### 2. Ревью `<head>` · средне

Найдите проблемы критического пути и перепишите `<head>`:

```html
<head>
  <title>Catalog</title>
  <link rel="stylesheet" href="/css/app.css">     <!-- contains @import url(/css/fonts.css) -->
  <script src="https://cdn.other.com/ab-test.js"></script>
  <script src="/js/vendor.js"></script>
  <script src="/js/app.js"></script>
  <link rel="stylesheet" href="/css/print.css">
  <meta charset="utf-8">
</head>
<body>
  <div class="hero"></div>                         <!-- background-image: url(/img/hero.jpg), LCP -->
  <img data-src="/img/product-1.jpg" class="lazy">  <!-- above the fold -->
```

::: details Решение и разбор
```html
<head>
  <meta charset="utf-8">
  <title>Catalog</title>
  <link rel="preconnect" href="https://cdn.other.com">
  <link rel="stylesheet" href="/css/app.css">
  <link rel="stylesheet" href="/css/fonts.css">
  <link rel="stylesheet" href="/css/print.css" media="print">
  <link rel="preload" as="image" href="/img/hero.jpg" fetchpriority="high">
  <script defer src="/js/vendor.js"></script>
  <script defer src="/js/app.js"></script>
  <script async src="https://cdn.other.com/ab-test.js"></script>
</head>
<body>
  <img src="/img/hero.jpg" alt="" class="hero" fetchpriority="high">
  <img src="/img/product-1.jpg" alt="Product">
```

- `<meta charset>` в конце: если кодировка не найдена в первых 1024 байтах, браузер может разобрать документ заново. Переносим первым.
- `@import` в CSS — цепочка: `fonts.css` обнаруживается только после загрузки и разбора `app.css`. Отдельный `<link>` грузится параллельно.
- `print.css` блокирует рендеринг на экране. С `media="print"` — нет.
- Три синхронных скрипта: парсер стоит на каждом. Вдобавок все они ждут `app.css` (таблица стилей блокирует скрипты). `vendor` и `app` зависят друг от друга — `defer` сохраняет порядок.
- Сторонний синхронный скрипт — точка отказа: медленный CDN держит весь разбор, вплоть до таймаута. `async` и `preconnect`. Оговорка: A/B-тест, который меняет вид первого экрана, с `async` даст мигание. Это компромисс, который решают на сервере (вариант в HTML) или осознанным `blocking="render"` с жёстким таймаутом.
- LCP в `background-image` и `data-src` невидимы preload scanner. Лучше `<img src>` с `fetchpriority="high"`; если фон оставить — хотя бы `preload`. Изображения выше сгиба лениво не грузят.

Итог: критический путь сократился с цепочки «app.css → fonts.css» плюс трёх последовательных скриптов до двух параллельных таблиц стилей.
:::

### 3. Загрузка скриптов по порядку · средне

Реализуйте `loadScripts(urls)`: загружает внешние классические скрипты **параллельно**, выполняет **строго по порядку** массива, не блокирует парсер и возвращает промис, который выполняется после последнего скрипта и отклоняется при ошибке любого.

::: details Решение и разбор
```js
function loadScripts(urls) {
  return Promise.all(
    urls.map(
      (url) =>
        new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = url;
          script.async = false; // ordered: "execute in order as soon as possible"
          script.onload = resolve;
          script.onerror = () => reject(new Error(`Failed to load ${url}`));
          document.head.append(script);
        }),
    ),
  );
}
```

- Вставленный скрипт по умолчанию «force async»: выполнится, как только загрузится, без порядка. `script.async = false` переводит его в список «выполнить по порядку, как только возможно»: загрузки идут параллельно, выполнение — в порядке вставки. Это именно то поведение, которое раньше эмулировали библиотеки вроде LABjs.
- Парсер такие скрипты не блокируют: их вставил не парсер.
- Наивное решение — цепочка «загрузить следующий в `onload` предыдущего» — сохраняет порядок, но превращает загрузку в последовательность: N round trip вместо одного.
- Если скрипт упал с ошибкой загрузки, следующие всё равно выполнятся — порядок не означает «отменить остальное». Для модулей задача решается проще: `import()` по порядку или один модуль-вход с обычными `import`.

Сложность: время загрузки — максимум из времён, а не сумма; выполнение — сумма времён выполнения.
:::

### 4. Разбор Navigation Timing · средне

Дан объект `PerformanceNavigationTiming` со страницы, где пользователи жалуются на «долгий белый экран»: `startTime: 0`, `domainLookupStart: 5`, `domainLookupEnd: 5`, `connectStart: 5`, `connectEnd: 5`, `requestStart: 8`, `responseStart: 1450`, `responseEnd: 1520`, `domInteractive: 3900`, `domContentLoadedEventStart: 3910`, `loadEventStart: 6200`. Что видно и куда смотреть?

::: details Решение и разбор
- DNS и соединение — по 0 мс: соединение переиспользовано или страница из того же origin. Сеть до сервера не проблема.
- **TTFB ≈ 1450 мс** (`responseStart − startTime`, почти всё — `responseStart − requestStart`): сервер долго думает. Это SSR, база или холодный старт функции. Белый экран полторы секунды — до первого байта браузер не может ничего. Лечить на сервере: кэш страниц или фрагментов, CDN, `stale-while-revalidate`, потоковая отдача `<head>` до готовности тела, `103 Early Hints` для CSS и шрифтов.
- **Скачивание 70 мс** — HTML небольшой.
- **От конца ответа до `domInteractive` — ~2,4 с.** Разбор такого HTML занимает миллисекунды, значит, парсер стоял: синхронные скрипты в `<head>` и CSS, который их держит. Следующий шаг — waterfall в DevTools (Network) и `renderBlockingStatus` у ресурсов.
- `DCL` почти сразу после `domInteractive` — defer-скриптов мало или они быстрые.
- `load` на 6,2 с — изображения или сторонние скрипты. Для «белого экрана» это вторично: смотрят FCP/LCP, а не `load`.

Вывод: две независимые проблемы — медленный сервер и блокирующие ресурсы в `<head>`. Порядок работы: сначала TTFB (он сдвигает всё остальное), потом критический путь.
:::

### 5. Белый экран у SPA · сложно

Vue SPA на Vite. Первый экран — карточка товара с фото. Водопад: `index.html` (300 мс) → `index-[hash].js` 450 КБ (900 мс) → после выполнения `fetch('/api/product/42')` (400 мс) → `<img :src="product.photo">` (500 мс). LCP — около 2,3 с плюс время выполнения JS. Предложите улучшения без перехода на Nuxt, затем — с ним, и оцените эффект.

::: details Решение и разбор
Корень — **последовательная цепочка** из четырёх шагов, каждый из которых обнаруживается только после предыдущего. Сокращать надо число шагов, а не только их длительность.

Без SSR:

1. **Данные параллельно с бандлом.** Небольшой встроенный скрипт в `index.html` начинает запрос сразу, а приложение забирает готовый промис:

   ```html
   <script>
     // Starts with HTML parsing, not after the bundle executes
     window.__productPromise = fetch('/api/product/' + location.pathname.split('/').pop())
       .then((r) => r.json());
   </script>
   ```

   Или `<link rel="preload" as="fetch" href="/api/product/42" crossorigin>`, если URL известен на сервере (тогда HTML всё равно генерируется сервером, хотя бы шаблоном). Шаг «API» уходит из цепочки: −400 мс.
2. **Меньше JS на критическом пути.** Маршрут карточки — отдельный чанк через `() => import(...)`, тяжёлые зависимости — ленивые. Vite добавит `modulepreload` для нужных чанков. Меньше байтов — быстрее загрузка и разбор.
3. **Изображение раньше.** URL фото известен только из данных, поэтому `fetchpriority="high"` на `<img>` и, если домен изображений другой, `preconnect` к нему в `index.html`.
4. **Скелетон в HTML.** Статическая разметка-заглушка внутри `#app` даёт FCP сразу после CSS; Vue заменит её при монтировании. LCP это не улучшит.

С Nuxt (SSR или prerender/ISR через `routeRules`):

- HTML уже содержит `<img src>` фото: preload scanner запросит его, пока грузится JS. Цепочка становится «HTML → (CSS, фото, JS параллельно)».
- Данные приходят в payload страницы, гидрация не повторяет запрос.
- Цена — TTFB растёт на время рендера на сервере, и интерактивность наступает только после гидрации. Это компенсируют кэшем (`swr`/`isr` в `routeRules`) и ленивой гидрацией некритичных компонентов.

Оценка: без SSR — от ~2,3 до ~1,6–1,8 с (минус запрос API и часть байтов бандла). С SSR и кэшем — LCP ≈ TTFB + max(CSS, фото), порядка 0,8–1 с, и он перестаёт зависеть от размера JS.
:::

## Источники

- [HTML Living Standard: Navigation and session history](https://html.spec.whatwg.org/multipage/browsing-the-web.html), [Parsing HTML documents](https://html.spec.whatwg.org/multipage/parsing.html) — в том числе [The end](https://html.spec.whatwg.org/multipage/parsing.html#the-end) и [Speculative HTML parsing](https://html.spec.whatwg.org/multipage/parsing.html#speculative-html-parsing), [The script element](https://html.spec.whatwg.org/multipage/scripting.html#the-script-element), [Render-blocking mechanism](https://html.spec.whatwg.org/multipage/dom.html#render-blocking-mechanism), [Script-blocking style sheets](https://html.spec.whatwg.org/multipage/semantics.html#interactions-of-styling-and-scripting)
- [W3C: Navigation Timing Level 2](https://www.w3.org/TR/navigation-timing-2/); [Resource Timing](https://www.w3.org/TR/resource-timing/)
- [RFC 6928: Increasing TCP's Initial Window](https://www.rfc-editor.org/rfc/rfc6928); [RFC 8446: TLS 1.3](https://www.rfc-editor.org/rfc/rfc8446); [RFC 9000: QUIC](https://www.rfc-editor.org/rfc/rfc9000); [RFC 8297: 103 Early Hints](https://www.rfc-editor.org/rfc/rfc8297)
- [MDN: `<script>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script), [DOMContentLoaded](https://developer.mozilla.org/en-US/docs/Web/API/Document/DOMContentLoaded_event), [load](https://developer.mozilla.org/en-US/docs/Web/API/Window/load_event), [Document.readyState](https://developer.mozilla.org/en-US/docs/Web/API/Document/readyState), [PerformanceNavigationTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceNavigationTiming), [Critical rendering path](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path); [MDN browser-compat-data](https://github.com/mdn/browser-compat-data) — `blocking`, `fetchpriority`
- [web.dev: Don't fight the browser preload scanner](https://web.dev/articles/preload-scanner), [Render-blocking CSS](https://web.dev/articles/critical-rendering-path/render-blocking-css), [Optimize Time to First Byte](https://web.dev/articles/optimize-ttfb), [Back/forward cache](https://web.dev/articles/bfcache)
- [Chrome for Developers: Inside look at modern web browser (part 2: navigation, part 3: renderer)](https://developer.chrome.com/blog/inside-browser-part2)
- [Vite: Features — Preload Directives Generation](https://vite.dev/guide/features.html#preload-directives-generation); [Nuxt: Rendering Modes](https://nuxt.com/docs/4.x/guide/concepts/rendering)
- [Jake Archibald: The future of loading CSS](https://jakearchibald.com/2016/link-in-body/)
