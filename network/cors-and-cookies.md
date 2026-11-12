---
title: 'Same-origin policy, CORS и cookies'
level: ядро
---

# Same-origin policy, CORS и cookies

> **Коротко.** **Same-origin policy** запрещает скрипту *читать* ответы и DOM чужого origin (схема + хост + порт), но не запрещает *отправлять* запросы и встраивать ресурсы. **CORS** — способ, которым сервер ослабляет этот запрет заголовками `Access-Control-*`. Это защита пользователя, а не API: запрос до сервера доходит, браузер лишь не отдаёт ответ скрипту. **Cookies** живут по другим правилам: их граница — хост и путь, без порта, а `SameSite` смотрит на **site**, а не на origin. Отсюда половина ловушек темы.

**Связанные темы:** [HTTP: методы, статусы, заголовки, версии](./http.md), [HTTP-кэширование и CDN](./caching.md), [От ввода URL до отображения страницы](../browser/from-url-to-pixels.md), [Web Workers, Service Workers и PWA](../browser/workers.md), [Модули: ESM и CommonJS](../javascript/modules.md)

## Теория

### Origin и site

**Origin** (источник) — кортеж «схема, хост, порт». `https://app.example.com` и `https://app.example.com:8443` — разные origin; `http://` и `https://` — тоже. Бывает и **opaque origin** (непрозрачный): у документа из `data:` URL или из `<iframe sandbox>` без `allow-same-origin`. Он не равен никакому другому, даже самому себе в другом документе, и сериализуется как строка `"null"`.

**Site** — схема плюс **registrable domain** (eTLD+1): публичный суффикс из Public Suffix List и одна метка перед ним. Порт в site не входит.

| URL A | URL B | same-origin | same-site |
| --- | --- | --- | --- |
| `https://app.example.com` | `https://api.example.com` | нет | да |
| `https://example.com` | `https://example.com:8443` | нет | да |
| `http://example.com` | `https://example.com` | нет | нет (schemeful) |
| `https://a.github.io` | `https://b.github.io` | нет | нет: `github.io` — публичный суффикс |
| `https://example.co.uk` | `https://shop.example.co.uk` | нет | да |

Две эти границы применяются в разных местах: SOP и CORS работают с origin, `SameSite`, разделение кэша и сторонние cookies — с site. Поддомены одного сайта — «чужие» для `fetch`, но «свои» для cookies с `SameSite=Strict`.

> [!NOTE]
> Учёт схемы в site (**schemeful same-site**) появился позже самого понятия. Chromium и Firefox его применяют, Safari — нет (по MDN BCD, сверено 2026-11-12). В старых материалах `http://` и `https://` одного домена называются same-site.

### Что запрещает same-origin policy

Правило «писать можно, читать нельзя» объясняет почти всё:

- **Можно**: переходить по ссылкам, отправлять формы на чужой origin, встраивать `<img>`, `<script>`, `<link rel="stylesheet">`, `<video>`, `<iframe>`. Это было в вебе до появления JavaScript, и запрет сломал бы веб.
- **Нельзя читать**: тело и заголовки ответа на `fetch`/XHR; DOM чужого `<iframe>` или окна (`contentDocument` — `null`, у `contentWindow` доступны только `postMessage`, `location` на запись, `close()` и несколько свойств); пиксели картинки, нарисованной на `<canvas>` (canvas становится «испорченным», `getImageData` бросает `SecurityError`); детали ошибки чужого скрипта (в `window.onerror` — только `"Script error."`).
- **Хранилища** (`localStorage`, IndexedDB, Cache API) изолированы по origin.
- **Встроенный скрипт** выполняется с origin **страницы**, а не своего сервера. Поэтому `<script src="https://cdn.example/lib.js">` получает полный доступ к вашей странице, а вы к его исходнику — нет. Исключение из «нельзя читать» делает сам ресурс: атрибут `crossorigin` переводит загрузку в режим CORS, и ответ становится читаемым, если сервер разрешил. Модули (`<script type="module">`) грузятся только так.

> [!WARNING]
> Старый обход через `document.domain = 'example.com'` (два поддомена объявляют общий домен) больше не работает по умолчанию. В Chromium с версии 115 страницы изолированы по origin (origin-keyed agent clusters), и сеттер ничего не делает без заголовка `Origin-Agent-Cluster: ?0`. Для общения окон — `postMessage` с проверкой `event.origin`.

### CORS: сервер разрешает чтение

CORS (Cross-Origin Resource Sharing) описан в Fetch Standard. Браузер добавляет к cross-origin запросу заголовок `Origin`, сервер отвечает `Access-Control-Allow-Origin` с этим origin или `*`, и только тогда браузер отдаёт ответ скрипту. Иначе `fetch` отклоняется с `TypeError: Failed to fetch`. Причина есть только в консоли: скрипт не должен узнать о чужом сервере даже то, почему отказано.

Главное: **CORS защищает пользователя, а не сервер**. Простой cross-origin запрос уходит и выполняется на сервере в любом случае, блокируется лишь чтение ответа (проверено в Chromium 157: `GET` без CORS-заголовков доходит до сервера, `fetch` падает). `curl` и бэкенд CORS не знают вовсе. Авторизацию и защиту от CSRF CORS не заменяет.

#### Простые запросы и preflight

Запрос **простой** (без preflight), если одновременно:

- метод — `GET`, `HEAD` или `POST`;
- заголовки только CORS-safelisted: `Accept`, `Accept-Language`, `Content-Language`, `Content-Type` и простой `Range`, каждое значение не длиннее 128 байт, вместе не больше 1024;
- `Content-Type` — только `application/x-www-form-urlencoded`, `multipart/form-data` или `text/plain`;
- тело не `ReadableStream`, у XHR нет слушателей на `upload`.

Граница не случайна: ровно такие запросы умела отправлять HTML-форма до CORS, и серверы обязаны были их выдерживать. Всё остальное — `PUT`, `DELETE`, `Content-Type: application/json`, `Authorization`, любой `X-*` — сервер раньше от чужих страниц не получал. Поэтому браузер сначала спрашивает разрешения **preflight**-запросом:

```http
OPTIONS /api/items HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: PUT
Access-Control-Request-Headers: authorization, content-type

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
Access-Control-Allow-Headers: authorization, content-type
Access-Control-Max-Age: 7200
Vary: Origin
```

Правила preflight, которые ломают на практике:
- Он **никогда не несёт cookies**, даже при `credentials: 'include'`. Сервер, который требует сессию на `OPTIONS`, отвечает 401 и рушит весь запрос.
- Ответ должен иметь статус 2xx и **не может быть редиректом**. Проверено в Chromium 157: и `404`, и `302` на `OPTIONS` дают `Failed to fetch`. Типичный виновник — редирект со слэшем на конце или с `http` на `https`.
- Результат кэшируется по URL на `Access-Control-Max-Age` секунд (по умолчанию 5). Chromium ограничивает срок двумя часами, Firefox — сутками (по MDN). Кэш живёт по каждому URL отдельно: `/items/1` и `/items/2` — два preflight.

#### Credentials

По умолчанию `fetch` идёт с `credentials: 'same-origin'`: на чужой origin не уходят ни cookies, ни HTTP-аутентификация, а `Set-Cookie` в ответе игнорируется. Чтобы их отправить, нужен `credentials: 'include'` (у XHR — `withCredentials = true`), и тогда сервер обязан ответить строже:

- `Access-Control-Allow-Origin` — **точный** origin, не `*`;
- `Access-Control-Allow-Credentials: true`;
- `*` в `Allow-Headers`, `Allow-Methods`, `Expose-Headers` перестаёт быть подстановкой и значит буквальное имя `*`.

Запрет `*` с credentials защищает от того, чтобы любая страница читала персональные ответы от имени пользователя. Когда сервер отражает `Origin` запроса, он обязан добавить `Vary: Origin`, иначе CDN отдаст ответ с чужим `Allow-Origin` другому сайту (см. [HTTP-кэширование и CDN](./caching.md)). И `credentials: 'include'` не отменяет правила cookies: `SameSite` и блокировка сторонних cookies действуют поверх. Проверено в Chromium 157: при запросе с `include` на другой site ушла только cookie с `SameSite=None`.

#### Что видно в ответе

Без дополнительных разрешений скрипт видит тело, статус и только **CORS-safelisted** заголовки ответа: `Cache-Control`, `Content-Language`, `Content-Length`, `Content-Type`, `Expires`, `Last-Modified`, `Pragma`. Остальные (`X-Total-Count`, `ETag`, `Location`) сервер перечисляет в `Access-Control-Expose-Headers`. `Set-Cookie` не отдаётся скрипту никогда.

> [!WARNING]
> По Fetch Standard `Access-Control-Allow-Headers: *` не покрывает `Authorization`: его нужно перечислить явно. Ни Chromium, ни Safari этого не проверяют. В Chromium 157 preflight с `authorization` при ответе `*` проходит (проверено), в Firefox проверка есть только за флагом (MDN BCD, сверено 2026-11-12). Пишите `Authorization` явно: код, рассчитанный на нынешнее послабление, сломается, когда браузеры догонят спецификацию.

#### `mode: 'no-cors'` и `Origin: null`

`mode: 'no-cors'` не «выключает CORS», а возвращает **opaque**-ответ: `type: 'opaque'`, `status: 0`, тело недоступно. Это режим `<img>` и `<script>` без `crossorigin`. Для `fetch` он полезен только Service Worker'у, который кладёт ответ в кэш (см. [Web Workers, Service Workers и PWA](../browser/workers.md)). `Origin: null` приходит из sandbox-iframe, из `data:`-документов и после cross-origin редиректа внутри CORS-запроса (проверено в Chromium 157). Разрешать `null` в allowlist нельзя: такой origin может получить любая страница, просто встроив sandbox-iframe.

> [!NOTE]
> Chromium с версии 142 спрашивает у пользователя разрешение, когда публичный сайт обращается к локальной сети или `localhost` (Local Network Access). Это отдельный механизм поверх CORS. Если dev-инструмент на `localhost` вызывает из продакшена, CORS-заголовков уже недостаточно.

### Cookies

Cookie задаёт сервер через `Set-Cookie` или скрипт через `document.cookie`, а браузер прикладывает подходящие cookies в заголовок `Cookie` каждого запроса. Правила — RFC 6265 и его замена **RFC 6265bis** (одобрен к публикации, ожидает номер RFC; сверено 2026-11-12). Браузеры давно реализуют bis. **Граница cookie — хост и путь, а не origin.** Порт cookie не учитывает: `localhost:3000` и `localhost:5173` видят одни cookies (проверено в Chromium 157). Схему — только через `Secure`. Размер — около 4 КБ на cookie и порядка полусотни cookies на домен, и все они едут в **каждом** запросе к домену, включая картинки (см. [HTTP: методы, статусы, заголовки, версии](./http.md)).

| Атрибут | Что делает |
| --- | --- |
| `Domain` | без него cookie **host-only**: только этот хост. С ним — хост и все поддомены. Задать домен шире registrable domain (`Domain=co.uk`) или чужой нельзя: браузер отвергнет cookie |
| `Path` | префикс пути. Удобство, а не безопасность: страница из того же origin прочитает cookie другого пути через iframe |
| `Expires` / `Max-Age` | срок жизни; `Max-Age` важнее. Без обоих — сессионная cookie. 6265bis ограничивает срок 400 днями: Chromium обрезает `Max-Age` больше этого (проверено в 157) |
| `Secure` | только по HTTPS. `localhost` Chromium и Firefox считают безопасным, Safari — нет. Небезопасная страница не может создать или перезаписать `Secure`-cookie |
| `HttpOnly` | недоступна из `document.cookie`. XSS не украдёт сессию, но всё ещё сможет действовать от имени пользователя прямо со страницы |
| `SameSite` | когда cookie уходит в cross-site запросах (ниже) |
| `Partitioned` | cookie хранится отдельно для каждого сайта верхнего уровня (CHIPS, ниже) |

#### SameSite

- `Strict` — cookie уходит, только если запрос **инициирован тем же сайтом**. Даже переход по ссылке из почты на ваш сайт придёт без неё: пользователь будет выглядеть разлогиненным на первом экране.
- `Lax` — плюс **навигации верхнего уровня** безопасным методом. Переход по ссылке, `location.href` — с cookie. `POST`-форма с другого сайта, `fetch`, `<img>`, `<iframe>` — без неё.
- `None` — во всех контекстах, но **только с `Secure`**. Без него браузер отвергает cookie целиком (проверено в Chromium 157).

`SameSite` смотрит на **site**: запрос с `evil.example.com` на `bank.example.com` для него «свой», и `Strict`-cookie уйдёт (проверено в Chromium 157). Захваченный поддомен или пользовательский контент на соседнем поддомене обходит эту защиту.

> [!WARNING]
> Поведение cookie **без** `SameSite` различается. Chromium с версии 80 считает её `Lax` («Lax by default»), но 2 минуты после установки отправляет и на cross-site `POST`-навигации. Это исключение «Lax+POST» сделали для OAuth/SSO-потоков с `form_post` (проверено в Chromium 157: `POST`-форма с другого сайта унесла свежую cookie без атрибута, но не явную `Lax`). Firefox и Safari по умолчанию трактуют отсутствие атрибута как `None` (MDN BCD, сверено 2026-11-12). Вывод: всегда указывайте `SameSite` явно.

#### Префиксы имени

Сервер получает в `Cookie` только `имя=значение`, без атрибутов. Он не может узнать, была ли cookie поставлена с `Secure` или вообще поддоменом. Префиксы — гарантия, которую проверяет браузер при установке:

- `__Secure-` — cookie принимается, только если есть `Secure` и установка идёт с HTTPS;
- `__Host-` — плюс `Path=/` и **без** `Domain`. Значит, cookie host-only, её не перезапишет ни поддомен, ни HTTP-страница. Лучший выбор для сессии. При нарушении cookie молча отвергается (проверено в Chromium 157: `__Host-` с `Domain` и `__Secure-` без `Secure` не сохранились).

> [!NOTE]
> Новые префиксы `__Http-` и `__Host-Http-` требуют ещё и `HttpOnly`, то есть cookie гарантированно поставлена сервером, а не скриптом. Поддержка: Chromium 140, Firefox 143, в Safari нет (MDN BCD, сверено 2026-11-12).

#### Сторонние cookies и CHIPS

Cookie **сторонняя** (third-party), если запрос уходит в cross-site контексте: виджет чата, карта, iframe платёжки или пиксель аналитики на чужом сайте. Через них работал трекинг между сайтами, и браузеры их ограничили. Состояние на 2026-11-12:

- **Safari** блокирует все сторонние cookies по умолчанию (с 2020 года, ITP).
- **Firefox** по умолчанию включает Total Cookie Protection: сторонние cookies не блокируются, а **разделяются** по сайту верхнего уровня. Виджет на `a.com` и на `b.com` получает разные «банки» cookies. Известные трекеры блокируются.
- **Chrome** разрешает их по умолчанию и блокирует в режиме инкогнито или по выбору пользователя. План полного отказа Google отменил (решение 2024 года, подтверждено в апреле 2025).

**CHIPS** (Cookies Having Independent Partitioned State) — атрибут `Partitioned` (требует `Secure`). Он даёт стандартный способ получить поведение Firefox во всех браузерах: cookie виджета хранится под ключом «сайт верхнего уровня + хост» и не позволяет связать посещения разных сайтов. Поддержка: Chrome 114, Firefox 141, Safari 26.2 (MDN BCD, сверено 2026-11-12). Когда встраиваемому сервису нужна именно общая, неразделённая cookie (единый логин виджета везде), есть Storage Access API: `document.requestStorageAccess()` по жесту пользователя.

### Обход CORS через свой сервер

SOP — правило браузера. Запрос сервер → сервер его не проходит, поэтому самый частый «рецепт от CORS» — сделать API same-origin для браузера: фронтенд ходит на `/api` своего же origin, а сервер проксирует дальше. Попутно cookies API становятся первосторонними (host-only на вашем домене), и проблема `SameSite` и блокировки сторонних cookies исчезает.

- **Dev-сервер.** `server.proxy` в Vite или `nitro.devProxy` в Nuxt работают только в разработке. Ловушка: локально всё работает, а в продакшене CORS-ошибка возвращается, потому что прокси там нет.
- **`routeRules` в Nuxt** — `{ '/api/**': { proxy: 'https://api.example.com/**' } }`. Работает и в продакшене, Nitro проксирует на уровне маршрута.
- **Server route** (`server/api/...`) — когда нужна логика: подставить секретный токен, отфильтровать заголовки, переписать `Set-Cookie`.

Цена прокси — лишний сетевой хоп, нагрузка на свой сервер и ответственность. Проксировать нужно фиксированный upstream, а не URL из запроса (иначе это SSRF), и передавать только нужные заголовки.

> [!TIP]
> CSRF и XSS — тема раздела «Безопасность». Здесь важен мостик: `SameSite=Lax`/`Strict` — сильный, но не единственный слой защиты от CSRF (поддомены — тот же site, у Lax есть исключения). Сервер дополнительно проверяет `Origin` или `Sec-Fetch-Site` на изменяющих запросах. `HttpOnly` от XSS не спасает, а лишь не даёт унести сессию.

## Примеры

```js
// Cross-origin request with cookies: the server must echo the exact origin.
const res = await fetch('https://api.example.com/me', { credentials: 'include' });
console.log(res.headers.get('X-Total-Count')); // null unless exposed
```

```ts
// server/middleware/cors.ts — a CORS layer for an API served by Nitro (h3 v1)
const ALLOWED = new Set(['https://app.example.com', 'https://admin.example.com']);

export default defineEventHandler((event) => {
  const origin = getRequestHeader(event, 'origin');
  appendResponseHeader(event, 'Vary', 'Origin'); // response depends on Origin
  if (!origin || !ALLOWED.has(origin)) return; // same-origin or not allowed

  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'X-Total-Count',
  });

  if (event.method === 'OPTIONS') {
    setResponseHeaders(event, {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '7200',
    });
    return sendNoContent(event, 204); // answer the preflight before auth runs
  }
});
```

```http
Set-Cookie: __Host-session=9f1c…; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1209600
Set-Cookie: widget_state=abc; Path=/; Secure; SameSite=None; Partitioned
```

## Вопросы с интервью

::: details Чем same-origin отличается от same-site
Origin — схема, хост и порт целиком; site — схема и registrable domain (eTLD+1 по Public Suffix List), без поддоменов и порта. `app.example.com` и `api.example.com` — разные origin, но один site. `a.github.io` и `b.github.io` — разные site, потому что `github.io` — публичный суффикс. Same-origin policy и CORS работают с origin, а `SameSite` у cookies, разделение HTTP-кэша и понятие сторонней cookie — с site. Отсюда ловушка: для `fetch` поддомен чужой и нужен CORS, а для `SameSite=Strict` — свой, и защита от CSRF не действует против захваченного поддомена.
:::

::: details Что именно запрещает same-origin policy
Чтение, а не отправку. Страница может отправить форму на чужой origin, встроить картинку, скрипт, стиль или iframe — так веб работал до JavaScript. Но она не может прочитать ответ `fetch`, DOM чужого iframe, пиксели чужой картинки на canvas, детали ошибки чужого скрипта, хранилища чужого origin. Встроенный чужой скрипт выполняется с правами страницы. CORS и атрибут `crossorigin` позволяют серверу ресурса разрешить чтение. Из этой асимметрии следует CSRF: отправить запрос с cookies пользователя можно, прочитать ответ — нет, но для атаки это и не нужно.
:::

::: details Когда браузер отправляет preflight и зачем
Когда запрос не «простой»: метод не `GET`/`HEAD`/`POST`, есть заголовок вне safelist (`Authorization`, `X-*`), `Content-Type` не один из трёх «формовых» (`application/json` — уже не простой) или значение safelisted-заголовка длиннее 128 байт. Простые запросы умела отправлять HTML-форма, и серверы к ним готовы. Остальные раньше с чужих страниц не приходили, поэтому браузер сначала спрашивает `OPTIONS` с `Access-Control-Request-Method/Headers`, не отправляя основной запрос. Preflight идёт без cookies, должен вернуть 2xx без редиректа и кэшируется по URL на `Access-Control-Max-Age` (по умолчанию 5 секунд, в Chromium не больше 2 часов). Сократить число preflight: простые запросы где можно, `Max-Age`, меньше уникальных URL или same-origin прокси.
:::

::: details Почему Access-Control-Allow-Origin со звёздочкой не работает с cookies
`*` — разрешение «читать может кто угодно», и для публичных данных это нормально. С `credentials: 'include'` ответ персональный: если бы `*` работал, любой сайт читал бы профиль пользователя его же cookies. Поэтому Fetch Standard требует точный origin в `Allow-Origin` и `Access-Control-Allow-Credentials: true`, а `*` в остальных `Allow-*` с credentials становится буквальным именем. Правильный сервер сверяет `Origin` с allowlist, отражает его и добавляет `Vary: Origin`. Отражать любой `Origin` без проверки — то же, что `*` с credentials, только хуже. Разрешать `null` нельзя: его получает любой sandbox-iframe.
:::

::: details Защищает ли CORS API от чужих запросов
Нет. CORS — механизм ослабления same-origin policy, и действует он только в браузере. Простой cross-origin запрос выполняется на сервере в любом случае, браузер лишь прячет ответ. `curl`, бэкенд или скрипт-бот заголовки CORS не смотрят и `Origin` подделывают. Защита API — аутентификация и авторизация на сервере, от CSRF — `SameSite`, проверка `Origin`/`Sec-Fetch-Site`, CSRF-токены, rate limiting от злоупотреблений. Поэтому и ошибку CORS не «чинят» на клиенте: её чинят на сервере или убирают, сделав запрос same-origin через прокси.
:::

::: details Чем отличаются SameSite Strict, Lax и None
`Strict` — cookie только в запросах, инициированных тем же сайтом. Даже переход по внешней ссылке придёт без неё. `Lax` — плюс навигации верхнего уровня безопасным методом: ссылка с другого сайта приходит с cookie, а `POST`-форма, `fetch`, iframe и картинки — без. `None` — везде, но только с `Secure`. Без атрибута Chromium считает cookie `Lax`, но 2 минуты после установки отпускает её и на cross-site `POST`-навигации (исключение для SSO); Firefox и Safari — `None`. Поэтому атрибут указывают явно. Типичный выбор: сессия — `Lax` (или `Strict` для чувствительного, со второй `Lax`-cookie для навигаций), cookie виджета в iframe — `None; Secure; Partitioned`.
:::

::: details Что происходит со сторонними cookies и что такое CHIPS
Сторонняя cookie — та, что уходит в cross-site контексте: iframe виджета, пиксель на чужом сайте. Safari блокирует их по умолчанию, Firefox разделяет по сайту верхнего уровня (Total Cookie Protection), Chrome разрешает по умолчанию, а план отказа от них отменил. CHIPS — атрибут `Partitioned`: cookie хранится под ключом «сайт верхнего уровня + хост», виджет работает, но связать посещения разных сайтов нельзя. Поддержан в Chrome 114, Firefox 141, Safari 26.2. Если нужен неразделённый доступ (единый логин виджета), — Storage Access API по жесту пользователя. Для своего продукта проще всего вообще не жить в стороннем контексте: API на поддомене своего сайта или same-origin прокси.
:::

## Задачи

### 1. Будет ли preflight · легко

Страница на `https://app.example.com`. Для каждого вызова скажите, будет ли preflight и уйдут ли cookies `api.example.com`.

```js
fetch('https://api.example.com/items');
fetch('https://api.example.com/items', { method: 'POST', body: new FormData(form) });
fetch('https://api.example.com/items', { method: 'POST', body: JSON.stringify(data) });
fetch('https://api.example.com/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
fetch('https://api.example.com/items/1', { method: 'DELETE', credentials: 'include' });
fetch('https://api.example.com/items', { headers: { Authorization: 'Bearer t' } });
fetch('/api/items', { method: 'PUT' });
```

::: details Решение и разбор
1. Нет preflight: `GET` без заголовков. Cookies не уйдут: по умолчанию `credentials: 'same-origin'`, а `api.` — другой origin.
2. Нет: `FormData` даёт `multipart/form-data`, это «формовый» тип.
3. Нет, и это сюрприз: строковое тело без явного заголовка получает `text/plain;charset=UTF-8`. Запрос простой, но сервер, ожидающий JSON, может не разобрать тело.
4. Да: `application/json` не safelisted.
5. Да: `DELETE` не safelisted. Cookies уйдут, если сервер ответит точным origin и `Allow-Credentials: true`, а `SameSite` их пропустит. `app.` и `api.` — один site, так что подойдут и `Lax`, и `Strict`.
6. Да: `Authorization` не safelisted. Его надо явно перечислить в `Allow-Headers` (спецификация не покрывает его звёздочкой).
7. Нет CORS вообще: same-origin. Cookies уходят по умолчанию.
:::

### 2. Почему падает запрос · средне

SPA на `https://app.example.com` логинится в API на `https://api.example.com`. Логин проходит, но запрос профиля падает с CORS-ошибкой в консоли. В DevTools видно: `OPTIONS /me` → `401`. Сервер (Express) настроен так:

```js
app.use(session({ cookie: { sameSite: 'lax', secure: true } }));
app.use(requireAuth); // 401 without a session
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', '*');
  next();
});
app.get('/me', (req, res) => res.json(req.user));
```

```js
// client
await fetch('https://api.example.com/me', {
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
});
```

Найдите все проблемы и исправьте.

::: details Решение и разбор
1. **Preflight проходит через `requireAuth`.** `OPTIONS` никогда не несёт cookies, поэтому получает `401`, а не-2xx ответ на preflight — провал CORS. CORS-слой должен стоять до аутентификации и отвечать на `OPTIONS` сам.
2. **`*` с credentials.** Нужен точный origin из allowlist, `Access-Control-Allow-Credentials: true` и `Vary: Origin`.
3. **`Allow-Headers: *` с credentials** означает буквальное имя `*`, `content-type` не разрешён. Перечислить явно.
4. **Лишний preflight.** У `GET` нет тела, `Content-Type` ничего не значит и только делает запрос непростым. Убрать заголовок — preflight исчезнет.
5. Cookie `SameSite=Lax` здесь работает: `app.` и `api.` — один site. Если бы фронтенд жил на другом домене (`app.example.org`), понадобился бы `SameSite=None; Secure`, и в Safari всё равно бы не заработало: сторонние cookies заблокированы. Тогда — прокси на своём домене.

```js
const ALLOWED = new Set(['https://app.example.com']);
app.use((req, res, next) => {
  res.vary('Origin');
  const origin = req.get('Origin');
  if (origin && ALLOWED.has(origin)) {
    res.set({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' });
    if (req.method === 'OPTIONS') {
      res.set({
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '7200',
      });
      return res.sendStatus(204);
    }
  }
  next();
});
app.use(session({ cookie: { sameSite: 'lax', secure: true, httpOnly: true } }));
app.use(requireAuth);
```
:::

### 3. Какие cookies уйдут · средне

`https://shop.example.com` установил:

```http
Set-Cookie: a=1; Secure; Path=/; SameSite=Strict
Set-Cookie: b=1; Secure; Path=/; SameSite=Lax
Set-Cookie: c=1; Secure; Path=/; SameSite=None
Set-Cookie: d=1; Path=/; SameSite=None
Set-Cookie: e=1; Secure; Path=/; Domain=example.com; SameSite=Lax
Set-Cookie: __Host-f=1; Secure; Path=/; Domain=shop.example.com
```

Какие cookies сохранятся? Какие уйдут на `shop.example.com` (или `example.com`) в каждом случае: (1) пользователь пришёл по ссылке с `https://news.site`; (2) `<form method="POST">` с `https://news.site`; (3) `fetch(..., { credentials: 'include' })` с `https://blog.example.com`; (4) `<img>` с `https://news.site`; (5) `http://shop.example.com:8080` (по HTTP, другой порт)?

::: details Решение и разбор
Не сохранятся: `d` (`SameSite=None` без `Secure`) и `__Host-f` (у `__Host-` нельзя `Domain`, даже собственный). Остаются `a`, `b`, `c` (host-only на `shop.`) и `e` (на `example.com` и всех поддоменах).

1. **Ссылка с другого сайта** — навигация `GET` верхнего уровня: `b`, `c`, `e`. `a` (`Strict`) — нет.
2. **POST-форма с другого сайта**: только `c`. `Lax` не уходит на cross-site `POST`. Исключение Chromium «Lax+POST» касается только cookies **без** атрибута `SameSite`.
3. **`fetch` с `blog.example.com`** — cross-origin, но same-site: `a`, `b`, `c`, `e` (если сервер разрешит CORS с credentials). `SameSite` не защищает от соседнего поддомена.
4. **`<img>` с другого сайта** — подресурс в cross-site контексте: только `c`, и только если браузер не блокирует сторонние cookies (в Safari не уйдёт, в Firefox — уйдёт в разделённом виде, отдельном для `news.site`).
5. **HTTP, порт 8080**: ничего. Порт cookies не важен, но все оставшиеся cookies `Secure`, а запрос по HTTP.
:::

### 4. Отражение Origin без дыр · средне

На ревью пришёл код:

```js
function allowOrigin(origin) {
  return origin.endsWith('example.com') || origin === 'null' || /https:\/\/.*\.example\.com/.test(origin);
}
// if allowOrigin(origin): echo origin + Access-Control-Allow-Credentials: true
```

Найдите уязвимости и напишите корректную проверку для `https://example.com` и любого его поддомена по HTTPS.

::: details Решение и разбор
- `endsWith('example.com')` пропускает `https://evil-example.com` — домен, который может купить кто угодно.
- `'null'` — его получает любая страница через `<iframe sandbox="allow-scripts">`, то есть разрешён весь интернет.
- Регулярка без якорей `^…$`: `https://a.example.com.evil.net` совпадёт, ведь `test` ищет подстроку.
- Нет `Vary: Origin` — отражённый origin закэширует CDN.

Origin разбирают как URL и сравнивают части, а не подстроки:

```js
function isAllowedOrigin(origin) {
  if (!origin || origin === 'null') return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '') return false;
  return url.hostname === 'example.com' || url.hostname.endsWith('.example.com');
}
```

Ведущая точка в `'.example.com'` — суть исправления. Ещё надёжнее — явный список origin, а не «любой поддомен»: разрешая все поддомены, вы доверяете каждому из них, включая забытый CNAME, который можно захватить.

Сложность: O(L) по длине origin.
:::

### 5. Сессия теряется при SSR · сложно

Nuxt-приложение на `https://shop.example.com`, API — `https://api.example.com`, сессия в cookie `__Secure-sid` на `Domain=example.com`. В браузере всё работает. Но при SSR страница `/account` рендерится как для гостя. А после логина, сделанного на сервере, пользователь всё равно не залогинен.

```ts
// app/pages/account.vue
const { data: user } = await useAsyncData('me', () =>
  $fetch('https://api.example.com/me', { credentials: 'include' }),
);

// server/api/login.post.ts
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  return $fetch('https://api.example.com/login', { method: 'POST', body });
});
```

Объясните оба эффекта и исправьте, учитывая безопасность.

::: details Решение и разбор
**Гость при SSR.** На сервере `$fetch` — это запрос Node к API. Браузера нет, `credentials: 'include'` ничего не значит, а cookies пользователя лежат в заголовке входящего запроса к Nuxt и сами никуда не попадают. При гидрации `useAsyncData` не повторяет запрос, и на клиенте остаются данные гостя. `useFetch` на относительный URL пробрасывает заголовки через `useRequestFetch`, но здесь URL внешний и вызов — голый `$fetch`.

**Логин не прилипает.** `Set-Cookie` от API пришёл серверу Nuxt и остался там: обработчик вернул только тело. Переслать заголовок можно, потому что `Domain=example.com` — родитель `shop.example.com`, и браузер его примет. Если бы API ставил cookie с `Domain=api.example.com`, пересланную с `shop.example.com` cookie браузер бы отверг.

Решение 1 — передать ровно нужное:

```ts
// app/pages/account.vue
const headers = useRequestHeaders(['cookie']); // only cookie, not host/accept/etc.
const { data: user } = await useAsyncData('me', () =>
  $fetch('https://api.example.com/me', { headers, credentials: 'include' }),
);

// server/api/login.post.ts
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const res = await $fetch.raw('https://api.example.com/login', { method: 'POST', body });
  for (const cookie of res.headers.getSetCookie()) {
    appendResponseHeader(event, 'set-cookie', cookie);
  }
  return res._data;
});
```

Решение 2 — сделать API same-origin: `routeRules: { '/api/**': { proxy: 'https://api.example.com/**' } }` и `useFetch('/api/me')`. На клиенте запросы same-origin, и cookies уходят без `credentials: 'include'`. При SSR `useFetch` с относительным URL пробрасывает заголовки входящего запроса. Это убирает и CORS.

Безопасность: не пробрасывать все входящие заголовки во внешний API (Nuxt прямо предупреждает про `host`, `x-forwarded-*` и подобные). Upstream фиксирован, а не берётся из запроса. Страницу с персональными данными нельзя кэшировать через `swr`/`isr`: ключ кэша не содержит cookies (см. [HTTP-кэширование и CDN](./caching.md)).
:::

## Источники

- [Fetch Standard: CORS protocol, CORS-safelisted request-header, CORS-preflight fetch](https://fetch.spec.whatwg.org/#http-cors-protocol)
- [HTML Living Standard: Origin, sites, same-site](https://html.spec.whatwg.org/multipage/browsers.html#origin)
- [RFC 6265: HTTP State Management Mechanism](https://www.rfc-editor.org/rfc/rfc6265)
- [draft-ietf-httpbis-rfc6265bis: Cookies (статус в IETF Datatracker)](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/)
- [Public Suffix List](https://publicsuffix.org/)
- [MDN: Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy)
- [MDN: Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)
- [MDN: Set-Cookie (и данные browser-compat-data)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [MDN: Access-Control-Allow-Headers](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Allow-Headers)
- [MDN: Access-Control-Max-Age](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Max-Age)
- [MDN: Cookies Having Independent Partitioned State (CHIPS)](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Privacy_sandbox/Partitioned_cookies)
- [MDN: Storage Access API](https://developer.mozilla.org/en-US/docs/Web/API/Storage_Access_API)
- [web.dev: Understanding "same-site" and "same-origin"](https://web.dev/articles/same-site-same-origin)
- [web.dev: SameSite cookies explained](https://web.dev/articles/samesite-cookies-explained)
- [web.dev: Schemeful Same-Site](https://web.dev/articles/schemeful-samesite)
- [developer.chrome.com: Local Network Access](https://developer.chrome.com/blog/local-network-access)
- [privacysandbox.google.com: CHIPS](https://privacysandbox.google.com/3pcd/chips)
- [Mozilla: Total Cookie Protection](https://blog.mozilla.org/security/2021/02/23/total-cookie-protection/)
- [Nuxt: Data fetching — passing headers and cookies](https://nuxt.com/docs/4.x/getting-started/data-fetching)
- [Nuxt: useRequestFetch](https://nuxt.com/docs/4.x/api/composables/use-request-fetch)
- [Nitro: Route rules — proxy](https://nitro.build/config#routerules)
