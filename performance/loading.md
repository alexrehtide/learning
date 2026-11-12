---
title: Оптимизация загрузки
level: ядро
---

# Оптимизация загрузки

> **Коротко.** У загрузки три рычага: **обнаружение** — браузер должен узнать о ресурсе как можно раньше, **приоритет** — важное идёт первым, **байты** — грузить меньше и только нужное. Обнаружение ускоряют подсказки (`preload`, `modulepreload`, `preconnect`, `103 Early Hints`), приоритет задают `fetchpriority` и порядок в разметке, байты сокращают форматы изображений, `loading="lazy"`, сабсеттинг шрифтов и code splitting. Следующую навигацию ускоряют заранее: `prefetch` и Speculation Rules вплоть до пререндера страницы целиком. Цель — LCP: главный ресурс должен начать грузиться сразу после HTML и не стоять в очереди за второстепенным.

**Связанные темы:** [От ввода URL до отображения страницы](../browser/from-url-to-pixels.md), [Core Web Vitals и измерение](./web-vitals.md), [HTTP-кэширование и CDN](../network/caching.md), [HTTP: методы, статусы, заголовки, версии](../network/http.md), [Модули: ESM и CommonJS](../javascript/modules.md), [Web Workers, Service Workers и PWA](../browser/workers.md)

## Теория

### Три рычага и подчасти LCP

Как браузер разбирает HTML, что блокирует парсер и рендеринг и что видит preload scanner, разобрано в «[От ввода URL до отображения страницы](../browser/from-url-to-pixels.md)». Здесь — что с этим делать. Удобнее всего идти от подчастей LCP из «[Core Web Vitals](./web-vitals.md)»: у каждой свой набор инструментов.

| Подчасть LCP | Рычаг | Инструменты |
| --- | --- | --- |
| `timeToFirstByte` | сеть и сервер | CDN и кэш (см. «[HTTP-кэширование и CDN](../network/caching.md)»), потоковый SSR, `103 Early Hints`, пререндер следующей страницы |
| `resourceLoadDelay` | обнаружение и приоритет | ресурс в HTML, `preload`, `fetchpriority="high"`, без `loading="lazy"`, `preconnect` к чужому origin |
| `resourceLoadDuration` | байты | AVIF/WebP, `srcset`/`sizes`, сжатие, меньше конкуренции за канал |
| `elementRenderDelay` | блокирующее | меньше блокирующего CSS и JS, шрифты с `font-display`, без скрытия контента до гидрации |

Ошибка, которую часто совершают: начинают с байтов (сжать картинку на 20%), хотя картинка стартует через 1,5 с после HTML, потому что найдена только в JS. Сначала смотрят водопад: **когда** ресурс начал грузиться и **что** грузилось параллельно, и только потом — сколько он весит.

### Приоритеты загрузки в Chromium

Браузер не грузит всё сразу с равным весом. Каждому запросу назначается приоритет, по HTTP/2 и HTTP/3 он уходит на сервер (заголовок `priority` по RFC 9218: `u=0` — самый срочный, `i` — можно отдавать по частям). Ресурсы одного приоритета грузятся в порядке обнаружения.

| Ресурс | Приоритет по умолчанию |
| --- | --- |
| Документ, CSS в `<head>` | VeryHigh |
| Шрифт из `@font-face` | VeryHigh |
| Синхронный скрипт в `<head>`, `type="module"`, `modulepreload` | High |
| `fetch()` без опций | High |
| `async` и `defer` скрипты | Low |
| Первые 5 изображений крупнее 10 000 px² | Medium (Chrome 117+) |
| Остальные изображения | Low, после layout во viewport — повышаются до High |
| `<link rel="preload">` | как у типа из `as` (шрифт — High, картинка — Low) |
| `<link rel="prefetch">` | VeryLow |

Отсюда главная мысль: **`preload` решает обнаружение, а не приоритет**. Предзагруженная картинка всё равно Low, пока браузер не сделает layout и не поймёт, что она во viewport. Для LCP-изображения нужны оба: обнаружение и `fetchpriority="high"`.

> [!WARNING]
> Проверено в Chromium 157 (Edge, HTTP/2) по CDP `Network.requestWillBeSent`. Картинки 150×100 получили Medium у первых пяти и Low у шестой и седьмой, после layout все видимые стали High. Картинка с `fetchpriority="high"` стартовала с High, с `fetchpriority="low"` осталась Low и во viewport. `<link rel="preload" as="image">` — Low, `as="font"` — High, а сам шрифт из `@font-face` — VeryHigh. `async`, `defer` и `async fetchpriority="low"` — Low; `prefetch` — VeryLow (`u=4` на проводе); `fetch(url, { priority: 'low' })` — Low.

### Resource hints

**Resource hints** (подсказки ресурсов) — элементы `<link>` или заголовок `Link`, которые говорят браузеру о будущих загрузках раньше, чем он найдёт их сам.

| Подсказка | Что делает | Когда |
| --- | --- | --- |
| `preload` | обязательная загрузка ресурса текущей страницы | ресурс нужен сейчас, но обнаруживается поздно: фон из CSS, шрифт, скрипт из JS |
| `modulepreload` | загрузка ES-модуля, разбор и компиляция, можно и зависимостей | чанки, которые точно понадобятся |
| `preconnect` | DNS + TCP + TLS к чужому origin заранее | 1–3 критичных origin: CDN картинок, API, шрифты |
| `dns-prefetch` | только DNS | менее важные origin; запасной вариант к `preconnect` |
| `prefetch` | низкоприоритетная загрузка для **следующей** навигации | чанк или документ, куда пользователь, скорее всего, пойдёт |

- **`as` обязателен для `preload`.** По нему браузер выбирает приоритет, заголовок `Accept`, CSP-директиву и ключ, по которому потом найдёт предзагруженный ответ. Без `as` или с неверным `as` ресурс скачается дважды.
- **Режим CORS должен совпадать.** Шрифты всегда грузятся в режиме CORS, поэтому `preload` шрифта без `crossorigin` не подойдёт к запросу из `@font-face`: будет две загрузки. То же с `modulepreload` (модули — CORS) и с `preconnect` к origin шрифтов: без `crossorigin` браузер подготовит соединение не того типа.
- **Неиспользованный preload — потеря.** Он отнимает канал у нужного. Chromium через несколько секунд после `load` пишет в консоль предупреждение «preloaded … but not used».
- **`modulepreload` в отличие от `preload as=script`** кладёт модуль в module map документа. Последующий `import` не скачивает и не разбирает его заново.
- **`preconnect` недолговечен.** По web.dev неиспользованное соединение закрывается примерно через 10 с, а каждое лишнее соединение тратит канал и CPU на TLS. Писать `rel="preconnect dns-prefetch"` в одном теге нельзя: в Safari это отменяет `preconnect`, нужны два тега.
- **`prefetch`** — только для безопасного контекста (HTTPS) в Chromium и Firefox; в Safari выключен по умолчанию (флаг), по MDN BCD. Запрос уходит с `Sec-Purpose: prefetch`, сервер может по нему не считать визит.

> [!WARNING]
> Проверено в Chromium 157. `<link rel="preload" as="font">` без `crossorigin` дал два запроса `/f.woff2`: `no-cors` с High и `cors` с VeryHigh. В консоли — «A preload … is found, but is not used because the request credentials mode does not match». Неиспользованные `preload` картинки и скрипта дали предупреждение «was preloaded using link preload but not used within a few seconds from the window's load event».

### Fetch Priority

Атрибут `fetchpriority="high" | "low" | "auto"` на `<img>`, `<link>`, `<script>` и опция `priority` у `fetch()` — **относительная** подсказка: сдвиг на ступень от умолчания, а не абсолютное значение. Поддержка — во всех трёх движках (Chromium 101, Firefox 132, Safari 17.2).

Где он реально что-то меняет:

- `fetchpriority="high"` на LCP-изображении — сразу High, без ожидания layout. web.dev приводит Google Flights: LCP с 2,6 до 1,9 с.
- `fetchpriority="low"` на изображениях карусели за пределами первого слайда, на неважных preload, на фоновых `fetch` (аналитика, предзагрузка данных).
- `fetchpriority="high"` на важном `async`-скрипте поднимает его из Low.

Это подсказка, а не приказ. Пометить «high» всё подряд — то же, что ничего не пометить. Выигрыш заметнее на HTTP/1.1 и медленном канале, где ресурсы реально конкурируют.

### 103 Early Hints

Сервер (или CDN) отправляет промежуточный ответ `103 Early Hints` с заголовками `Link`, пока сам ещё готовит страницу: идёт в базу, рендерит SSR. Браузер в это время уже открывает соединения и грузит CSS и шрифты. Фактически думающее время сервера перестаёт простаивать.

```http
HTTP/2 103
link: </assets/app.css>; rel=preload; as=style
link: <https://cdn.example.com>; rel=preconnect

HTTP/2 200
content-type: text/html
...
```

Ограничения:

- **Только навигации** — основной документ верхнего уровня, не подресурсы.
- **Только HTTP/2 и выше** в Chromium и Safari (по MDN BCD).
- **Поддержка подсказок разная.** Chromium 103+ — `preconnect` и `preload`, Firefox — `preconnect` со 120, `preload` со 123, Safari 17+ — только `preconnect`. `prefetch` не поддерживается.
- При cross-origin редиректе в финальном ответе подсказанное выбрасывается. Предзагруженное ложится в HTTP-кэш, поэтому подсказывают кэшируемые ресурсы.
- Подсказки должны быть верны для любого финального ответа: сервер отправляет их до того, как знает, будет ли 200 или 404. Поэтому туда кладут общие для шаблона ресурсы (главный CSS, шрифт, origin CDN), а не картинку конкретного товара.

> [!WARNING]
> Проверено в Chromium 157 на Node `http2` с `res.writeEarlyHints()` и задержкой финального ответа 1 с. По HTTP/2 подсказанные CSS и картинка запрошены через 5 мс после навигации — за секунду до HTML, и неиспользованный скрипт из подсказки тоже скачан. С `--disable-http2` (HTTP/1.1) подсказки проигнорированы: ресурсы запрошены только после разбора HTML.

### Speculation Rules: prefetch и prerender следующей страницы

Самая быстрая навигация — та, что уже загружена. **Speculation Rules API** описывает в JSON, какие навигации браузеру стоит предугадать:

```html
<script type="speculationrules">
{
  "prerender": [{
    "where": { "and": [
      { "href_matches": "/*" },
      { "not": { "href_matches": "/logout" } },
      { "not": { "selector_matches": "[data-no-prerender]" } }
    ]},
    "eagerness": "moderate"
  }],
  "prefetch": [{ "urls": ["/catalog"], "eagerness": "immediate" }]
}
</script>
```

- **`prefetch`** скачивает документ (без подресурсов) и держит его в памяти, привязанной к текущему документу. Chrome хранит такой ответ до 5 минут.
- **`prerender`** загружает и рендерит страницу целиком в невидимой вкладке, вместе со скриптами и подресурсами. При переходе она **активируется** мгновенно: LCP почти нулевой.
- **List rules** (`urls`) перечисляют адреса явно, **document rules** (`where`) выбирают ссылки на странице по шаблону URL и CSS-селектору.

**Eagerness** определяет, когда срабатывает правило (developer.chrome.com, сверено 2026-11-12):

| Eagerness | Десктоп | Мобильные | Лимит prefetch / prerender |
| --- | --- | --- | --- |
| `immediate` | сразу | сразу | 50 / 10 |
| `eager` | наведение 10 мс | ссылка 50 мс во viewport | 2 / 2 (мобильные 6 / 2), FIFO |
| `moderate` | наведение 200 мс или `pointerdown` | 500 мс после остановки прокрутки | как у `eager` |
| `conservative` | `pointerdown` / касание | `pointerdown` / касание | 2 / 2, FIFO |

По умолчанию list rules — `immediate`, document rules — `conservative`. До Chrome 143 `eager` вёл себя как `immediate`. Браузер может не выполнить правило вовсе: при Save-Data, режиме энергосбережения с низким зарядом, нехватке памяти, выключенной настройке «Preload pages» (её выключают и блокировщики рекламы), в фоновой вкладке.

Ограничения и последствия:

- **Пререндер — только same-origin.** Same-site cross-origin — с заголовком `Supports-Loading-Mode: credentialed-prerender` на целевой странице, cross-site — нельзя. Cross-site prefetch работает, только если у пользователя нет cookies целевого сайта.
- **Запросы помечены.** Prefetch — `Sec-Purpose: prefetch`, prerender — `Sec-Purpose: prefetch;prerender`. Ответ не 2xx отменяет спекуляцию.
- **Побочные эффекты GET.** Пререндер — настоящий заход на страницу. Ссылки вроде `/logout` или `/cart/add?id=1` исключают из правил, а GET с изменением состояния — плохая идея и без них.
- **Аналитика и «видимые» эффекты** откладывают до активации: `document.prerendering`, событие `prerenderingchange`, `activationStart` в Navigation Timing. Опасные API (геолокация, уведомления) откладываются браузером автоматически, `alert` возвращается сразу.
- **Протухание и цена.** Ответ с `Clear-Site-Data: "prefetchCache", "prerenderCache"` сбрасывает спекуляции, когда состояние изменилось (товар добавлен в корзину). `immediate` по десятку ссылок — лишняя нагрузка на сервер и трафик пользователя, разумный выбор по умолчанию — `moderate` на document rules.

> [!NOTE]
> Поддержка сверена 2026-11-12 по MDN BCD. Chromium: prefetch — 110, prerender — 105, document rules и `eagerness` — 121, заголовок `Speculation-Rules` — 121. Safari 26.2 — за флагом. Firefox — в превью, только prefetch. Остальные браузеры игнорируют `<script type="speculationrules">`, поэтому правила — чистое прогрессивное улучшение. `<link rel="prerender">` — устаревший нестандартный механизм Chrome, заменённый Speculation Rules.

> [!WARNING]
> Проверено в Chromium 157. Правило `immediate` дало запросы с `Sec-Purpose: prefetch` и `prefetch;prerender` и приоритетом `u=4`. Document rule `moderate` сработал на наведение 400 мс (приоритет уже `u=2`) и не сработал на наведение 50 мс. Переход по ссылке использовал подготовленный ответ — новых запросов на сервер не было. Сам пререндер под DevTools Protocol не запустился (`PrerenderingDisabledByDevTools`), и браузер откатился на prefetch того же ответа. Отлаживать пререндер нужно в обычной вкладке, где DevTools показывает его статус на панели Application → Speculative loads.

### Изображения

**Форматы.** При равном качестве AVIF обычно меньше WebP, а WebP — меньше JPEG; AVIF дольше кодируется. Поддержка по MDN BCD: WebP — везде (Safari 14), AVIF — везде (Chrome 85, Firefox 93, Safari 16.4), JPEG XL — Safari 17, Chrome 155, Firefox 158. Отдают через `<picture>` с `<source type>` или по заголовку `Accept` на CDN изображений (тогда нужен `Vary: Accept`).

**Адаптивность.** `srcset` и `sizes` позволяют браузеру выбрать файл под ширину слота и плотность экрана: телефон не качает картинку для 4K-монитора. Подробно — в теме «Адаптивная вёрстка» раздела «Вёрстка». Для ленивых картинок можно писать `sizes="auto"`: браузер возьмёт ширину из layout (Chrome 126, Firefox 150, в Safari 27 частично).

**Ленивая загрузка.** `loading="lazy"` на `<img>` и `<iframe>` откладывает загрузку до приближения к viewport. Работает во всех движках (для `<img>` — Safari 15.4, для `<iframe>` — Firefox 121). Правила:

- **Не на LCP и не на первом экране.** Ленивая картинка начинает грузиться только после layout, когда браузер знает её позицию. Для LCP это прямая прибавка к `resourceLoadDelay`.
- **Порог — не край экрана.** Chromium начинает загрузку заранее: 1250 px от viewport на быстром соединении, 2500 px на 3G и медленнее (web.dev). Ленивая загрузка «на 100 px ниже сгиба» не экономит ничего.
- **Размеры обязательны.** Без `width`/`height` (или `aspect-ratio`) картинка до загрузки 0×0: соседи прыгают (CLS), а в галерее все нулевые картинки оказываются «во viewport» и грузятся сразу.
- `display: none` на картинке или предке не грузит её вовсе, `opacity: 0` — грузит.

> [!WARNING]
> Проверено в Chromium 157 при viewport 800 px. Из ленивых картинок на высотах 600–4500 px сразу загрузились те, что до 2000 px, а 2500 px — нет: порог ≈ 1250 px от нижнего края. После прокрутки на 1500 px догрузились 2500 и 3200 px, но не 4500.

**LCP-изображение** — в HTML как `<img src>`/`srcset`, а не фоном из CSS и не через JS, чтобы его нашёл preload scanner; с `fetchpriority="high"` и без `loading="lazy"`; с собственного origin или с `preconnect` к CDN. Если URL обнаруживается поздно — `<link rel="preload" as="image" fetchpriority="high">` (для адаптивных — с `imagesrcset` и `imagesizes`). И не за JS-заглушкой, которую скрипт потом меняет на настоящую картинку.

### Шрифты

Веб-шрифт обнаруживается поздно: браузер узнаёт о нём, только когда построил CSSOM, и грузит, только когда шрифт понадобился видимому тексту. Цепочка «HTML → CSS → шрифт» — классический водопад. Что делает браузер, пока шрифта нет, задаёт `font-display`:

| Значение | Период блокировки (текст невидим) | Период замены | Итог |
| --- | --- | --- | --- |
| `block` | короткий, ~3 с | бесконечный | FOIT: текст невидим до 3 с |
| `swap` | минимальный (≤ 100 мс) | бесконечный | FOUT: сразу запасной шрифт, потом замена |
| `fallback` | минимальный | короткий, ~3 с | если не успел за ~3 с — остаётся запасной |
| `optional` | минимальный | нет | не успел к первой отрисовке — шрифт применится при следующем визите из кэша |
| `auto` | на усмотрение браузера (обычно как `block`) | | |

- **WOFF2** и **сабсеттинг** — убрать из файла неиспользуемые глифы. `unicode-range` в `@font-face` делит шрифт на поднаборы (латиница, кириллица), и браузер скачивает только те, символы которых есть на странице.
- **`preload` 1–2 критичных шрифтов** — обязательно с `crossorigin` и `type="font/woff2"`.
- **Самостоятельный хостинг.** Из-за разделения HTTP-кэша по сайтам (см. «[HTTP-кэширование и CDN](../network/caching.md)») шрифт с публичного CDN не будет «уже в кэше». Свой origin экономит DNS, TCP и TLS и даёт управлять кэшированием.
- **Метрики запасного шрифта.** `swap` даёт сдвиг при замене, если у запасного шрифта другие метрики. `@font-face` с `size-adjust`, `ascent-override`, `descent-override` подгоняет запасной шрифт под веб-шрифт, и CLS от замены почти исчезает. `size-adjust` — во всех движках (Safari 17), `ascent-override` в Safari пока только в превью.

### Бюджет JavaScript

JS — самый дорогой байт: его надо скачать, разобрать, скомпилировать и выполнить, и всё это на главном потоке. 200 КБ сжатого JS — это сотни миллисекунд работы CPU на бюджетном телефоне, а картинка того же веса только декодируется. В SSR-приложении к этому добавляется гидрация: до её конца страница видна, но не отвечает на ввод (INP).

Что сокращает JS на критическом пути — на уровне эффекта (механизмы сборщика — в разделе «Инструменты»):

- **Code splitting.** Ленивые маршруты (`component: () => import('./pages/Product.vue')`) и ленивые тяжёлые части (редактор, графики, модальные окна) через динамический `import()` по действию или видимости. В начальном бандле остаются общий код и текущая страница.
- **Tree shaking.** Неиспользуемые экспорты выбрасываются при сборке, но только для статических ESM-импортов и модулей без побочных эффектов: `import _ from 'lodash'` против `import debounce from 'lodash-es/debounce'`.
- **`modulepreload`** для чанков текущего маршрута — чтобы граф модулей не грузился цепочкой; **бюджет в CI** на размер чанков — чтобы ловить регресс до релиза.

Обратная сторона: чем мельче нарезка, тем больше запросов и тем хуже сжатие. Переход по маршруту с ленивым чанком ждёт загрузку — это лечат prefetch чанков при видимости ссылки (так делает Nuxt) или Speculation Rules.

### Сторонние скрипты

Аналитика, реклама, чаты, A/B-тесты и виджеты часто весят больше собственного кода. Их подключают только `async` или `defer`: синхронный скрипт с медленного чужого CDN держит весь разбор. Загрузку откладывают до взаимодействия или простоя (чат — по клику, аналитика — после `load`). Тяжёлые встраивания заменяют **фасадами**: вместо `<iframe>` YouTube — превью с кнопкой, плеер грузится по клику. Вынос в Web Worker (Partytown) возможен, но скрипт теряет синхронный доступ к DOM. A/B-тесты первого экрана лучше решать на сервере или CDN: клиентский вариант даёт мигание или блокировку рендеринга. Безопасность стороннего кода — тема раздела «Безопасность»: как CSP с `'strict-dynamic'` пропускает загрузчики сторонних скриптов — в [Content Security Policy](../security/csp.md).

### Vue и Nuxt: где это видно

- **Vue Router.** Ленивые маршруты через `() => import()`, Vite сам добавляет `modulepreload` для зависимостей чанка. `defineAsyncComponent` — ленивый компонент, а с Vue 3.5 у него есть стратегии ленивой гидрации: `hydrateOnVisible`, `hydrateOnIdle`, `hydrateOnInteraction`, `hydrateOnMediaQuery`.
- **`<NuxtLink>`** в Nuxt 4 по умолчанию (`prefetchOn: { visibility: true }`) предзагружает чанки маршрута и payload, когда ссылка попала во viewport. По исходникам 4.6.4: наблюдение начинается в `requestIdleCallback` после `onNuxtReady`, через общий `IntersectionObserver`. Предзагрузка пропускается при `navigator.connection.saveData` и на 2G. `prefetchOn="interaction"` переключает на `pointerenter`, `focus` и `pointerdown`, `:prefetch="false"` выключает.
- **Ленивые компоненты Nuxt.** Префикс `Lazy` (`<LazyCommentList v-if="show" />`) выносит компонент в отдельный чанк. Пропсы `hydrate-on-visible`, `hydrate-on-idle`, `hydrate-on-interaction`, `hydrate-on-media-query`, `hydrate-after`, `hydrate-when`, `hydrate-never` откладывают его гидрацию: HTML с сервера виден сразу, а JS грузится и выполняется позже ([подробнее](./vue-performance.md#nuxt-ленивые-компоненты-отложенная-гидрация-islands)).
- **`experimental.crossOriginPrefetch`** (выключено по умолчанию) превращает prefetch внешних ссылок `<NuxtLink>` в Speculation Rules с `requires: ["anonymous-client-ip-when-cross-origin"]`. **`experimental.writeEarlyHints`** (тоже выключено) отправляет `103 Early Hints` со ссылками на ресурсы страницы.
- **`@nuxt/image`** (2.2.1). `<NuxtImg preload>` на сервере добавляет в `<head>` `<link rel="preload" as="image">` с `imagesrcset`/`imagesizes`, а `:preload="{ fetchPriority: 'high' }"` — ещё и `fetchpriority`. Ловушка — `placeholder`. В HTML попадает размытая заглушка, а настоящее изображение запрашивается в `onMounted` через `new Image()`, то есть только после гидрации. Для LCP-картинки `placeholder` не используют.

## Примеры

`<head>` страницы товара с SSR: всё критичное обнаруживается из HTML, второстепенное отложено.

```html
<head>
  <!-- Third-party origin that is needed for the first screen -->
  <link rel="preconnect" href="https://img.example-cdn.com">
  <link rel="dns-prefetch" href="https://img.example-cdn.com">

  <!-- One critical font, same origin, CORS mode matches @font-face -->
  <link rel="preload" href="/fonts/inter-latin-cyrillic.woff2" as="font" type="font/woff2" crossorigin>

  <link rel="stylesheet" href="/assets/app.css">
  <script type="module" src="/assets/entry.js"></script>
  <link rel="modulepreload" href="/assets/product-page.js">

  <!-- Next likely navigation: prerender on hover, never logout or cart actions -->
  <script type="speculationrules">
    { "prerender": [{ "where": { "and": [
      { "href_matches": "/product/*" },
      { "not": { "selector_matches": "[data-no-prerender]" } }
    ]}, "eagerness": "moderate" }] }
  </script>

  <!-- Analytics must not compete with the LCP image -->
  <script async src="https://analytics.example.com/a.js" fetchpriority="low"></script>
</head>
<body>
  <!-- LCP: in HTML, high priority, explicit size, not lazy -->
  <img
    src="https://img.example-cdn.com/p/42-800.avif"
    srcset="https://img.example-cdn.com/p/42-400.avif 400w, https://img.example-cdn.com/p/42-800.avif 800w"
    sizes="(max-width: 600px) 100vw, 600px"
    width="800" height="600" alt="Product photo"
    fetchpriority="high">

  <!-- Below the fold: lazy, with dimensions to avoid layout shifts -->
  <img src="/img/review-1.avif" width="320" height="240" alt="" loading="lazy">
</body>
```

Шрифт с подогнанным запасным вариантом — без невидимого текста и почти без сдвига при замене:

```css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter-latin-cyrillic.woff2') format('woff2');
  font-display: swap;
  unicode-range: U+0000-00FF, U+0400-04FF;
}

/* Local fallback tuned to Inter's metrics: the swap barely moves text */
@font-face {
  font-family: 'Inter Fallback';
  src: local('Arial');
  size-adjust: 107%;
  ascent-override: 90%;
}

body {
  font-family: 'Inter', 'Inter Fallback', sans-serif;
}
```

## Вопросы с интервью

::: details Чем preload отличается от prefetch, preconnect и modulepreload
`preload` — обязательная загрузка ресурса **текущей** страницы, которую браузер нашёл бы поздно: фон из CSS, шрифт, скрипт из JS. Приоритет — как у типа из `as`. `prefetch` — необязательная загрузка с самым низким приоритетом для **следующей** навигации; браузер может её пропустить. `preconnect` ничего не качает: он заранее делает DNS, TCP и TLS к чужому origin и экономит 1–3 RTT. Он недолговечен (около 10 с), поэтому — только для origin, который точно понадобится на первом экране. `modulepreload` — preload для ES-модулей: загружает, разбирает и кладёт модуль в module map, так что последующий `import` его не повторяет, и может подтянуть зависимости. Общие ловушки: `preload` без `as` или с несовпадающим `crossorigin` скачивается дважды, а неиспользованный `preload` отнимает канал у нужных ресурсов.
:::

::: details Почему preload LCP-картинки не всегда ускоряет LCP и что делает fetchpriority
`preload` решает обнаружение, а не приоритет: предзагруженная картинка в Chromium получает тот же Low, что и обычная, и ждёт, пока layout покажет, что она во viewport. Если картинка и так стоит в HTML как `<img src>`, preload scanner найдёт её сам, и `preload` ничего не добавит. `fetchpriority="high"` поднимает приоритет сразу, и картинка не стоит в очереди за скриптами и шрифтами. Правильная комбинация: картинка в HTML с `fetchpriority="high"`; если её URL обнаруживается поздно (фон, JS) — `preload` тоже с `fetchpriority="high"`. Ещё одна причина «preload не помог» — LCP упирается не в загрузку, а в `elementRenderDelay`: блокирующий CSS, долгие задачи, скрытие контента до гидрации.
:::

::: details Когда loading lazy вредит
Когда стоит на картинке первого экрана, особенно на LCP: ленивая картинка начинает грузиться только после layout, и это прямая задержка LCP. Так часто бывает, когда `loading="lazy"` ставят глобально всем картинкам компонента-обёртки. Вредит и без размеров: нулевая до загрузки картинка даёт сдвиги, а в галерее все нулевые картинки разом оказываются «во viewport». Ожидание, что lazy грузит у самого края экрана, тоже неверно: Chromium начинает за 1250–2500 px, поэтому для картинок чуть ниже сгиба экономии нет. Правильно — eager и `fetchpriority="high"` для первого экрана, lazy с `width`/`height` для остального.
:::

::: details Что такое 103 Early Hints и чем он отличается от HTTP/2 Server Push
Промежуточный ответ, который сервер отправляет до финального, пока готовит страницу: в нём заголовки `Link` с `preload` и `preconnect`. Браузер начинает загрузку и соединения, пока сервер ещё ходит в базу. Server Push сам отправлял байты ресурса, не зная, есть ли он у клиента в кэше; он перегружал канал, плохо кэшировался и был удалён из Chrome. Early Hints лишь подсказывает, и браузер сам проверяет кэш. Ограничения: только навигации, только HTTP/2+, Safari — только `preconnect`. Подсказки уходят до того, как сервер знает итоговый статус, поэтому в них — общие для шаблона ресурсы, а не специфичные для страницы.
:::

::: details Как Speculation Rules ускоряют навигацию и чем рискуют
Правила в JSON (`<script type="speculationrules">` или заголовок `Speculation-Rules`) говорят браузеру, какие страницы заранее скачать (`prefetch`) или загрузить и отрендерить целиком в невидимой вкладке (`prerender`). Prerender при переходе активируется мгновенно. Document rules выбирают ссылки по шаблону URL и селектору, `eagerness` задаёт момент: сразу, по наведению 10 или 200 мс, по нажатию. Риски: нагрузка на сервер и трафик пользователя, побочные эффекты GET (`/logout`, добавление в корзину), аналитика, считающая визит, который не случился, устаревшие данные. Решения: исключения в `where`, отложенная аналитика через `document.prerendering` и `prerenderingchange`, `Clear-Site-Data` для сброса, `moderate` вместо `immediate`. Пререндер работает только same-origin, поддержка — Chromium (в Safari за флагом), для остальных правила просто игнорируются.
:::

::: details Как грузить веб-шрифты, чтобы не испортить LCP и CLS
Шрифт — водопад «HTML → CSS → шрифт», и пока его нет, текст либо невидим (FOIT при `block`), либо отрисован запасным шрифтом (FOUT при `swap`). Для текстового LCP невидимый текст — прямая задержка, поэтому — `swap` или `optional`. `swap` даёт сдвиг при замене; его гасят подгонкой метрик запасного шрифта через `size-adjust` и `ascent-override`. `optional` вообще не меняет шрифт после первой отрисовки, CLS нулевой, но первый визит может пройти с системным шрифтом. Байты сокращают WOFF2 и сабсеттинг с `unicode-range`. Обнаружение ускоряет `preload` 1–2 критичных файлов с `crossorigin`. Самостоятельный хостинг лучше Google Fonts: общий кэш между сайтами не работает из-за разделения кэша, а свой origin экономит соединение.
:::

::: details Как уменьшить стоимость JavaScript при загрузке Vue- или Nuxt-приложения
JS дорог не только байтами: разбор, компиляция, выполнение и гидрация идут на главном потоке. Code splitting по маршрутам (`() => import()`) оставляет в начальном бандле только общий код и текущую страницу. Тяжёлые редко нужные части — динамическим импортом по действию. Tree shaking работает только на ESM без побочных эффектов, поэтому важен выбор библиотек. В SSR дорогостоящую гидрацию откладывают: во Vue 3.5 — `defineAsyncComponent` с `hydrateOnVisible`/`hydrateOnIdle`, в Nuxt — `Lazy`-компоненты с `hydrate-on-visible`, а чисто статические куски можно не гидрировать вовсе (`hydrate-never`, серверные компоненты). Переходы не тормозят, потому что `<NuxtLink>` предзагружает чанки и payload видимых ссылок. Размер чанков контролируют бюджетом в CI.
:::

## Задачи

### 1. Расставить подсказки · легко

Для каждого случая выберите `preload`, `modulepreload`, `preconnect`, `dns-prefetch`, `prefetch`, `fetchpriority` или «ничего»:

1. Hero-картинка задана как `background-image` в CSS.
2. Шрифт с того же origin, используется в заголовке первого экрана.
3. API на `api.example.com`, первый запрос делает JS после загрузки бандла.
4. Чанк страницы оформления заказа, на которую ведёт кнопка в корзине.
5. Счётчик аналитики с отдельного origin.
6. `<img src="hero.avif">` прямо в HTML — LCP-элемент.

::: details Решение и разбор
1. `preload as="image" fetchpriority="high"` — фон невидим preload scanner, а без `fetchpriority` предзагрузка будет Low. Лучше — переделать на `<img>`.
2. `preload as="font" type="font/woff2" crossorigin` — без `crossorigin` будет две загрузки.
3. `preconnect` к `api.example.com` с `crossorigin` (запросы `fetch` с CORS), плюс `dns-prefetch` как запасной вариант. Ещё лучше — `<link rel="preload" as="fetch" crossorigin>` на сам URL данных, если он известен на сервере.
4. `prefetch` или `modulepreload` по наведению на кнопку, или Speculation Rules для документа страницы. На первой загрузке корзины — ничего.
5. `dns-prefetch` или ничего: аналитика не должна отнимать соединения у критического пути; сам скрипт — `async`.
6. Только `fetchpriority="high"`: preload scanner найдёт картинку сам, `preload` — лишний дубль.
:::

### 2. Разбор водопада · средне

Страница каталога на Nuxt, LCP — 4,1 с на мобильном. В водопаде:

```text
0      ms  document                          (TTFB 600 ms)
650    ms  entry.js, app.css                 (High, VeryHigh)
650    ms  analytics.js, chat-widget.js      (sync scripts in <head>, High)
1500   ms  fonts.googleapis.com/css2         (after app.css)
1900   ms  fonts.gstatic.com/....woff2       (new connection: DNS + TCP + TLS)
2300   ms  hydration starts
2900   ms  card-1.avif ... card-12.avif      (all requested now, Low)
4100   ms  LCP: card-1.avif
```

Картинки товаров рендерятся `<NuxtImg placeholder loading="lazy">`. Найдите причины и предложите исправления с ожидаемым эффектом.

::: details Решение и разбор
Причины по подчастям LCP:

- **`resourceLoadDelay` ≈ 2,3 с** — главная проблема. Картинки запрошены только после гидрации, потому что `placeholder` у `<NuxtImg>` ставит в `src` заглушку и запрашивает настоящую картинку в `onMounted`. Плюс `loading="lazy"` на первом экране: даже без заглушки загрузка ждала бы layout. Исправление: для первых 2–4 карточек — без `placeholder`, без `lazy`, у первой — `:preload="{ fetchPriority: 'high' }"` и `fetchpriority="high"`. Картинки окажутся в HTML и стартуют около 650 мс вместе с CSS.
- **Синхронные сторонние скрипты** держат парсер и конкурируют с CSS и JS за канал. `async` или `defer`, чат — по клику, аналитика — после `load`.
- **Шрифты — цепочка из трёх шагов** (CSS → CSS Google Fonts → woff2 на третьем origin с новым соединением). Самостоятельный хостинг с `preload` и `crossorigin` превращает её в один шаг рядом с `app.css`; минимум — `preconnect` к `fonts.gstatic.com` с `crossorigin`. `font-display: swap` и метрики запасного шрифта — чтобы текст не ждал.
- **TTFB 600 мс** — отдельная задача: кэширование страницы каталога на CDN или `routeRules` с `swr` (см. «[HTTP-кэширование и CDN](../network/caching.md)»).

Ожидаемый эффект: картинка стартует около 700 мс вместо 2900, при весе карточки ~60 КБ загрузка — 300–500 мс на 4G, отрисовка — сразу (картинка в HTML, не ждёт гидрации). LCP ≈ 1,3–1,6 с. Для LCP гидрация перестаёт иметь значение, но остаётся для INP: её можно облегчить ленивой гидрацией фильтров и виджетов ниже сгиба.
:::

### 3. Правила спекуляций для интернет-магазина · средне

Напишите Speculation Rules для магазина: мгновенный переход в карточку товара из каталога, предзагрузка корзины, но без пререндера ссылок выхода, добавления в корзину и ссылок с `?sort=` (их тысячи). Аналитика не должна считать непосещённые страницы. Учтите, что после добавления товара в корзину предзагруженная корзина устаревает.

::: details Решение и разбор
```html
<script type="speculationrules">
{
  "prerender": [{
    "where": { "and": [
      { "href_matches": "/product/*" },
      { "not": { "selector_matches": "a[href*='sort=']" } },
      { "not": { "selector_matches": "[data-no-prerender]" } }
    ]},
    "eagerness": "moderate"
  }],
  "prefetch": [{
    "where": { "and": [
      { "href_matches": "/cart" },
      { "not": { "href_matches": "/logout" } }
    ]},
    "eagerness": "moderate"
  }]
}
</script>
```

```js
// Server: the add-to-cart endpoint invalidates speculations
// res.setHeader('Clear-Site-Data', '"prefetchCache", "prerenderCache"');

// Client analytics: count the view only when the page is actually shown
if (document.prerendering) {
  document.addEventListener('prerenderingchange', trackView, { once: true });
} else {
  trackView();
}
```

Разбор:

- `moderate`, а не `immediate`: в каталоге десятки карточек, пререндер всех — десятки полноценных заходов на сервер. По наведению 200 мс угадывание точное, а лимит FIFO не даёт копиться пререндерам.
- Корзина — `prefetch`, не `prerender`: её содержимое меняется, пререндер выполнил бы скрипты со старым состоянием. `Clear-Site-Data` на эндпоинте добавления сбрасывает и то и другое.
- Добавление в корзину должно быть `POST`, а не GET-ссылкой: тогда его не затронут ни правила, ни краулеры. `/logout` исключён на всякий случай.
- На мобильных `moderate` срабатывает по остановке прокрутки, а не по наведению — проверьте нагрузку.
- В браузерах без поддержки правила игнорируются, навигации — обычные.
:::

### 4. Бюджет первого экрана · сложно

Лендинг на Nuxt: целевые показатели — LCP ≤ 2,5 с и INP ≤ 200 мс на p75 для мобильных (условно 4G, 1,6 Мбит/с полезной пропускной способности, RTT 150 мс). Сейчас на старте грузятся 450 КБ JS (сжатого), 120 КБ CSS, 4 начертания шрифта по 40 КБ, hero 300 КБ JPEG, YouTube-iframe и тег-менеджер с пятью тегами. Составьте план с бюджетом в байтах и обоснуйте порядок действий.

::: details Решение и разбор
**Оценка канала.** 1,6 Мбит/с ≈ 200 КБ/с. TTFB с CDN ≈ 300–400 мс (DNS + TCP + TLS + запрос, 3–4 RTT по 150 мс, без кэша соединения). Для LCP 2,5 с после TTFB остаётся ≈ 2 с, то есть ~400 КБ на всё, что конкурирует с hero до его отрисовки, — с запасом на разбор и отрисовку — ≤ 250–300 КБ критичных байт.

**Бюджет критического пути:**

| Ресурс | Было | Стало | Как |
| --- | --- | --- | --- |
| Hero | 300 КБ JPEG | ~60–80 КБ AVIF | формат, `srcset` под 360–430 px ширины экрана, `fetchpriority="high"` |
| CSS | 120 КБ | ~15 КБ критичный + остальное неблокирующе | удалить неиспользуемое, критичное — инлайн |
| Шрифты | 160 КБ | 1–2 файла по ~20 КБ | одно variable-начертание или два, сабсет латиница + кириллица, `swap` + метрики |
| JS на старте | 450 КБ | ≤ 150 КБ | ленивые маршруты и секции, ленивая гидрация ниже сгиба |
| YouTube-iframe | сотни КБ JS плеера | 0 до клика | фасад: превью и кнопка |
| Теги | 5 синхронных | 0 до `load` | загрузка тег-менеджера после `load`/в простое, ревизия тегов |

**Порядок.** От эффекта к стоимости:

1. **Hero и фасад YouTube** — самые большие байты в конкуренции, дёшево исправить: hero в 4 раза легче, плеер уходит с первого экрана целиком.
2. **Сторонние скрипты** — убрать с критического пути: это и байты, и главный поток (INP во время загрузки).
3. **Шрифты и CSS** — убирают водопад и блокировку рендеринга (`elementRenderDelay`).
4. **JS** — дольше всего: разбиение и ленивая гидрация требуют правок кода. Для INP это главный рычаг: 450 КБ JS — это 1–2 с работы главного потока на среднем телефоне.
5. **Защита результата** — бюджеты в CI (размер чанков, Lighthouse CI на LCP и TBT) и RUM с атрибуцией (см. «[Core Web Vitals и измерение](./web-vitals.md)»): лабораторные цифры подтверждают план, полевые — результат.

Ответ на интервью оценивают не за точные числа, а за то, что кандидат считает от сети и цели, разделяет метрики (LCP — байты и обнаружение, INP — главный поток) и предлагает механизм удержания результата.
:::

## Источники

- [HTML Living Standard: Link types](https://html.spec.whatwg.org/multipage/links.html#linkTypes) (`preload`, `modulepreload`, `preconnect`, `dns-prefetch`, `prefetch`), [Fetch priority attribute](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#fetch-priority-attributes), [Lazy loading attributes](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-loading-attributes), [Speculative loading](https://html.spec.whatwg.org/multipage/speculative-loading.html)
- [Fetch Standard](https://fetch.spec.whatwg.org/) — `priority` в `RequestInit`, режимы CORS
- [RFC 8297: An HTTP Status Code for Indicating Hints](https://www.rfc-editor.org/rfc/rfc8297), [RFC 9218: Extensible Prioritization Scheme for HTTP](https://www.rfc-editor.org/rfc/rfc9218)
- [CSS Fonts Module Level 4: font-display, metrics overrides](https://www.w3.org/TR/css-fonts-4/#font-display-desc)
- [MDN: Speculation Rules API](https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API), [rel=preload](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload), [rel=modulepreload](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload), [103 Early Hints](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/103), [font-display](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display); [MDN browser-compat-data](https://github.com/mdn/browser-compat-data) 8.1.8 — поддержка подсказок, `fetchpriority`, `loading`, Speculation Rules, Early Hints, форматов изображений, дескрипторов `@font-face`
- [developer.chrome.com: Prerender pages in Chrome for instant page navigations](https://developer.chrome.com/docs/web-platform/prerender-pages), [Faster page loads using server think-time with Early Hints](https://developer.chrome.com/docs/web-platform/early-hints)
- [web.dev: Optimize resource loading with the Fetch Priority API](https://web.dev/articles/fetch-priority), [Browser-level image lazy loading](https://web.dev/articles/browser-level-image-lazy-loading), [Establish network connections early](https://web.dev/articles/preconnect-and-dns-prefetch), [Optimize Largest Contentful Paint](https://web.dev/articles/optimize-lcp), [Best practices for fonts](https://web.dev/articles/font-best-practices), [Third-party JavaScript](https://web.dev/articles/optimizing-content-efficiency-loading-third-party-javascript)
- [Vue: Async Components — Lazy Hydration](https://vuejs.org/guide/components/async.html#lazy-hydration), [Vue Router: Lazy Loading Routes](https://router.vuejs.org/guide/advanced/lazy-loading.html)
- [Nuxt: `<NuxtLink>`](https://nuxt.com/docs/4.x/api/components/nuxt-link), [Components — Lazy Hydration](https://nuxt.com/docs/4.x/directory-structure/app/components#delayed-or-lazy-hydration), [Experimental features](https://nuxt.com/docs/4.x/guide/going-further/experimental-features); исходники `nuxt` 4.6.4 (`nuxt-link.js`, `prefetch-util.js`, `cross-origin-prefetch.client.js`)
- [Nuxt Image: `<NuxtImg>`](https://image.nuxt.com/usage/nuxt-img); исходники `@nuxt/image` 2.2.1 (`NuxtImg.vue`)
