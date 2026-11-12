---
title: CSRF, clickjacking и supply chain
level: ядро
---

# CSRF, clickjacking и supply chain

> **Коротко.** Все три атаки используют чужое доверие, а не баг в вашем коде. **CSRF** (Cross-Site Request Forgery, подделка межсайтового запроса): браузер сам прикладывает cookies к запросу, который отправила чужая страница. Защита — проверить, откуда пришёл изменяющий запрос (`Sec-Fetch-Site`, `Origin`) или потребовать токен, который чужая страница не может знать. `SameSite` — сильный дополнительный слой, но не единственный. **Clickjacking**: вашу страницу встраивают в прозрачный iframe, и пользователь кликает по ней, не видя этого. Защита — `frame-ancestors` в CSP (и `X-Frame-Options` для старых браузеров). **Supply chain**: вредоносный код приходит из зависимости или CDN и выполняется с правами вашего origin или на машине разработчика и CI. Защита — lockfile и `npm ci`, блокировка install-скриптов, задержка обновлений, SRI для чужих скриптов и минимум зависимостей.

**Связанные темы:** [Same-origin policy, CORS и cookies](../network/cors-and-cookies.md), [XSS и безопасный вывод во Vue](./xss.md), [Content Security Policy](./csp.md), [Хранилища браузера](../network/browser-storage.md), [Real-time: polling, SSE, WebSocket](../network/realtime.md), [HTTP: методы, статусы, заголовки, версии](../network/http.md), [Оптимизация загрузки](../performance/loading.md), [Аутентификация на фронтенде](./authentication.md)

## Теория

### CSRF: механизм

Same-origin policy запрещает чужой странице **читать** ответ, но не **отправлять** запрос (см. [Same-origin policy, CORS и cookies](../network/cors-and-cookies.md)). Форма, `<img>`, навигация уходят на любой origin, и браузер прикладывает к ним «окружающие» учётные данные (ambient credentials): cookies, HTTP-аутентификацию, клиентские сертификаты. Атакующему ответ не нужен — достаточно побочного эффекта: перевод денег, смена email, удаление.

Условия атаки:

- аутентификация **автоматическая**: cookie сессии, а не токен, который код кладёт в заголовок `Authorization` (его чужая страница не знает);
- запрос меняет состояние, и все его параметры атакующему известны;
- запрос можно отправить без preflight: `GET`, `POST` из формы с `application/x-www-form-urlencoded`, `multipart/form-data` или `text/plain`.

JSON API защищён только условно. `fetch` с `Content-Type: application/json` на чужой origin требует preflight, и без CORS-разрешения запрос не уйдёт. Но форма с `enctype="text/plain"` отправит тело, которое **выглядит** как JSON (пример ниже). Если сервер разбирает тело, не проверяя `Content-Type`, preflight ничего не дал.

Ещё два варианта, о которых спрашивают на интервью:

- **Login CSRF** — атакующий логинит жертву в **свой** аккаунт. Дальше жертва вводит в него данные карты или историю поиска. Поэтому форма входа тоже защищается, а после входа сессия пересоздаётся.
- **Client-side CSRF** — ваш же JavaScript строит запрос из данных атакующего (`location.hash`, query-параметр) и отправляет его с правильным токеном. Токены и `SameSite` здесь не помогают: запрос действительно same-origin.

> [!WARNING]
> XSS обходит любую защиту от CSRF: внедрённый скрипт работает в вашем origin, читает токен со страницы и отправляет same-origin запросы (см. [XSS](./xss.md)). Защиты из этой темы работают, только пока нет XSS.

### Почему `SameSite` не закрывает всё

`SameSite=Lax` (а в Chromium — и отсутствие атрибута) не отправляет cookie в cross-site подзапросах и `POST`. Это убирает большинство классических CSRF. Подробно атрибут разобран в [Same-origin policy, CORS и cookies](../network/cors-and-cookies.md#samesite), здесь — только дыры:

- **Site ≠ origin.** `SameSite` смотрит на registrable domain: запрос с `blog.example.com` на `bank.example.com` — same-site, и даже `Strict`-cookie уйдёт. Захваченный поддомен, пользовательский контент или XSS на соседнем поддомене обходят защиту.
- **`GET` с побочными эффектами.** `Lax` отправляет cookie при навигации верхнего уровня методом `GET`. `GET /account/delete?confirm=1` в ссылке или `location.href` выполнится.
- **Разные умолчания.** Cookie без атрибута Chromium считает `Lax` (с окном «Lax+POST» в 2 минуты), а Firefox и Safari — `None`.
- **Не только cookies.** HTTP Basic, клиентские сертификаты и доступ «по IP» во внутренней сети `SameSite` не управляет.

OWASP формулирует так: `SameSite` — полезный слой defense in depth, но в большинстве развёртываний он не заменяет основную защиту.

### Токены: synchronizer и double-submit

**Synchronizer token.** Сервер генерирует случайный токен, хранит его в сессии и вставляет в форму (скрытое поле) или в страницу, откуда код кладёт его в заголовок. На изменяющем запросе токен из тела или заголовка сравнивается с сохранённым. Чужая страница токен не знает: прочитать ваш HTML ей мешает SOP. Токен на сессию — компромисс по удобству, токен на запрос ломает кнопку «Назад» и несколько вкладок. Токен не кладут в URL: он попадёт в логи, историю и `Referer`.

**Double-submit cookie** — вариант без состояния на сервере: токен лежит в cookie и дублируется в заголовке, сервер сравнивает два значения. **Наивный** вариант (случайное значение, которое просто совпадает) уязвим к **cookie tossing**: соседний поддомен или MITM по HTTP **записывает** cookie для вашего домена и подставляет своё значение в обе части. Поэтому:

- токен **подписывают**: `HMAC(secret, sessionId + random)`, сервер пересчитывает HMAC от текущей сессии и сравнивает за постоянное время (`timingSafeEqual`);
- cookie называют с префиксом `__Host-`: такую cookie нельзя поставить с `Domain`, без `Secure` и с путём не `/`, а значит, поддомен её не перезапишет;
- сервер берёт токен из заголовка или поля формы, а не только из cookie: cookie браузер приложит и к поддельному запросу.

**Свой заголовок** (`X-Requested-With`, `X-CSRF-Token`) без значения тоже защищает API: чужая страница не может добавить его без preflight. Работает, пока CORS не разрешает чужие origin с credentials. Разрешающая регулярка `*.example.com` в CORS возвращает проблему захваченного поддомена.

### `Origin` и Fetch Metadata

Браузер сам сообщает, откуда пришёл запрос, и страница эти заголовки подделать не может.

**`Origin`** отправляется на запросы с CORS и на любые запросы с методом, отличным от `GET`/`HEAD`, включая отправку формы. Сервер сравнивает его со своим origin **целиком**: проверка префикса пропустит `https://example.com.evil.net`. `Origin: null` приходит из sandbox-iframe, `data:`-документов, после некоторых редиректов и при `Referrer-Policy: no-referrer` на странице атакующего. Значит, `null` в белый список не добавляют.

**Fetch Metadata** (W3C Working Draft) — заголовки `Sec-Fetch-*`, которые браузер ставит на запросы к HTTPS и localhost:

| Заголовок | Значения | Что значит |
| --- | --- | --- |
| `Sec-Fetch-Site` | `same-origin`, `same-site`, `cross-site`, `none` | связь инициатора и цели, по всей цепочке редиректов; `none` — пользователь сам открыл URL (адресная строка, закладка) |
| `Sec-Fetch-Mode` | `navigate`, `cors`, `no-cors`, `same-origin`, `websocket` | режим запроса |
| `Sec-Fetch-Dest` | `document`, `iframe`, `image`, `script`, `empty`… | куда пойдёт ответ |
| `Sec-Fetch-User` | `?1` | навигация по действию пользователя |

Для CSRF достаточно `Sec-Fetch-Site`: изменяющий запрос принимается при `same-origin` или `none`. **`same-site` пропускать нельзя** — по той же причине, что и `SameSite`: соседний поддомен. Если заголовка нет (старый браузер, HTTP, не-браузерный клиент), сервер сравнивает `Origin` с `Host`. Так устроен `http.CrossOriginProtection` в Go 1.25. OWASP тоже рекомендует Fetch Metadata при обязательном fallback на `Origin`. Запросы без обоих заголовков он пропускает: браузер их бы отправил, значит, это `curl` или бэкенд, а у них нет cookies жертвы.

> [!TIP]
> Проверка `Sec-Fetch-Site`/`Origin` закрывает CSRF без состояния, токенов на клиенте и правок фронтенда, поэтому её ставят первой. Токены добавляют, если нужна поддержка клиентов без этих заголовков или изменяющие `GET`, которые нельзя переписать.

### Clickjacking

Атакующий встраивает вашу страницу в `<iframe>` с `opacity: 0` поверх своей кнопки «Получить приз». Пользователь кликает по невидимой кнопке «Подтвердить перевод» или «Разрешить доступ» в своей сессии. Разновидности — перетаскивание (drag-and-drop текста в поле), многошаговые сценарии, курсор-подмена.

**`X-Frame-Options`** — старый заголовок: `DENY` или `SAMEORIGIN`. Значение `ALLOW-FROM` современные браузеры не поддерживают: если на него положиться, защиты нет вовсе. Перечислить несколько разрешённых origin нельзя.

**`frame-ancestors`** в CSP — замена: `'none'`, `'self'` или список origin, проверяется вся цепочка предков (подробно — в [Content Security Policy](./csp.md#frame-ancestors)). Если директива задана, браузер игнорирует `X-Frame-Options`, поэтому старый заголовок оставляют только для очень старых браузеров. Оба работают **только заголовком ответа**: в `<meta>` они игнорируются.

**Frame busting** — скрипт `if (top !== self) top.location = self.location` — защитой не считается. Атакующий встраивает страницу с `sandbox="allow-forms"` без `allow-scripts` или `allow-top-navigation`: скрипт не выполнится или не сможет увести вкладку, а формы работают. Атрибут `sandbox` полезен и вам: встраивая чужой или пользовательский контент, вы отнимаете у него скрипты, навигацию верхнего уровня и same-origin доступ.

`SameSite=Lax`/`Strict` частично спасает: в cross-site iframe такие cookies не уходят, и страница во фрейме видит пользователя разлогиненным. Но действия без входа и cookies с `SameSite=None` (виджеты, SSO) остаются под ударом, а встраивание `SameSite` не запрещает.

> [!WARNING]
> **DoubleClickjacking** (Паулос Йибело, декабрь 2024) обходит `frame-ancestors`, потому что фрейма нет. Страница атакующего открывает всплывающее окно с просьбой «кликните дважды», а скрипт в нём меняет `opener.location`: исходная вкладка под окном переходит на вашу страницу, например на OAuth-согласие. На `mousedown` первого клика окно закрывается (`window.close()`), и второй клик попадает в кнопку «Разрешить» на настоящей странице верхнего уровня. Стандартной защиты в браузерах нет. Автор предлагает держать критичные кнопки неактивными, пока на странице не было реального жеста: движения указателя или нажатия Tab.

### Supply chain: откуда приходит чужой код

Зависимость — это доверие её авторам, их учётным записям, их CI и всем их зависимостям. Атака может сработать в трёх местах:

| Где выполняется | Как | Что под угрозой |
| --- | --- | --- |
| **Установка** (машина разработчика, CI) | `preinstall`/`install`/`postinstall`, `prepare` у git-зависимостей | токены npm и GitHub, облачные ключи, SSH, переменные CI |
| **Импорт** (сборка, SSR, тесты) | код модуля при `import`/`require` | то же; `--ignore-scripts` не помогает |
| **Браузер пользователя** (бандл или CDN) | код в вашем бандле или скрипт с чужого CDN | всё, что доступно XSS: данные, сессия, платежи |

Громкие инциденты (факты — по первичным отчётам):

| Когда | Что | Урок |
| --- | --- | --- |
| Февраль–июнь 2024 | **polyfill.io**: домен и GitHub-аккаунт купила компания Funnull, с конца июня 2024 скрипт отправлял мобильных пользователей на мошеннические сайты; по отчёту Sansec от 25.06.2024 — более 100 000 сайтов | чужой CDN — это чужой код в вашем origin; сервис отдавал разный код по `User-Agent`, поэтому SRI был невозможен |
| 8 сентября 2025 | **debug, chalk** и ещё около 18 пакетов: фишинг аккаунта мейнтейнера, в версиях — код для браузера, перехватывающий криптовалютные транзакции | вредонос в runtime-коде: блокировка install-скриптов не спасает, спасают lockfile и задержка обновлений |
| Сентябрь 2025 | **Shai-Hulud**: червь собирал токены и публиковал себя в пакеты жертвы; CISA 23.09.2025 — более 500 пакетов | один украденный токен заражает всё, что владелец может опубликовать |
| 11 мая 2026 | **TanStack**: 84 версии 42 пакетов за 6 минут; `pull_request_target` → отравленный кэш GitHub Actions → OIDC-токен из памяти раннера → публикация через trusted publishing | у версий была настоящая provenance: она подтверждает, где собран пакет, а не что код безопасен |

### Supply chain: защита

**Lockfile и `npm ci`.** `package-lock.json` фиксирует точные версии всего дерева, `resolved` (откуда скачан tarball) и `integrity` (SHA-512 tarball). `npm ci` ставит строго по lockfile, падает, если он не совпадает с `package.json`, и никогда его не переписывает. В CI — только `npm ci`. Изменения lockfile в PR читают: подменённый `resolved` на чужой хост — известная атака.

**Install-скрипты.** Большинству пакетов они не нужны, а для атакующего это самый удобный вход. В npm 12 (12.0.0 вышел 08.07.2026) скрипты зависимостей **заблокированы по умолчанию**: выполняются только пакеты из поля `allowScripts` в `package.json`, которое ведёт `npm approve-scripts`. Одобрение по умолчанию привязано к версии (`"esbuild@0.25.0": true`), так что новая версия снова требует проверки (проверено на npm 12.2.2). Там же `allow-git` и `allow-remote` по умолчанию `none`: git- и URL-зависимости не ставятся без явного разрешения. В npm 11.16+ политика `allowScripts` работает только как предупреждение. pnpm 10 тоже не запускает скрипты зависимостей без разрешения. Старый способ — `ignore-scripts=true` в `.npmrc` — выключает все скрипты, включая нужные.

**Задержка обновлений (cooldown).** Вредоносные версии обычно находят и снимают за часы. `min-release-age` (npm 11.10+, в днях) не даёт поставить версию моложе N дней, `min-release-age-exclude` — исключения для своих пакетов. В pnpm это `minimumReleaseAge` (в минутах). Срочное исправление уязвимости ставят точечно в обход окна.

**Typosquatting и dependency confusion.** `reqeusts`, `vue-router-dom`, `@vue/compiler-ssr` против `vue-compiler-ssr` — похожие имена с вредоносным кодом, часто их «советует» LLM или опечатка. Dependency confusion — публичный пакет с именем вашего внутреннего: если реестр выбирается по версии, побеждает публичный. Защита: внутренние пакеты только в своём scope (`@company/…`), scope привязан к приватному реестру в `.npmrc`.

**Provenance и подписи.** `npm publish --provenance` или trusted publishing (OIDC из CI вместо долгоживущего токена) прикладывают подписанную через Sigstore аттестацию: какой репозиторий, коммит и workflow собрали пакет. `npm audit signatures` проверяет подписи реестра и аттестации установленных пакетов. Это доказывает **происхождение**, а не безопасность: TanStack опубликовал вредоносные версии из своего же CI. Полезный сигнал — версия популярного пакета **без** provenance, хотя предыдущие её имели.

**SRI для чужих скриптов.** `integrity="sha384-…"` на `<script>` или `<link rel="stylesheet">` с чужого CDN: если содержимое не совпало с хэшем, браузер не выполняет ресурс и выдаёт сетевую ошибку. Для cross-origin нужен CORS (`crossorigin="anonymous"`), иначе проверка невозможна. SRI работает только для неизменяемых версионированных файлов: `…/lib@3.2.1/dist/lib.min.js`, но не `…/latest/` и не сервис, который генерирует ответ под браузер. Требовать SRI для всех скриптов позволяет заголовок `Integrity-Policy` (по MDN — Limited availability, сверено 2026-11-12). Надёжнее всего — вообще не грузить код с чужих CDN, а положить его в свой бандл.

**Минимум зависимостей.** Каждая зависимость — новые люди с правом публикации. Перед добавлением: есть ли это в платформе (`structuredClone`, `Intl`, `fetch`, `AbortSignal.timeout`), сколько транзитивных зависимостей тянет пакет (`npm ls --all`), сколько у него мейнтейнеров и как он публикуется. `npm audit` ищет **известные** уязвимости в базе advisories. Свежий вредонос туда попадает уже после атаки.

### Nuxt: где ставить заголовки и защищать серверные маршруты

**Заголовки.** `routeRules` в `nuxt.config` задают `headers` по маршрутам, Nitro ставит их на ответ. Модуль nuxt-security (сверено 2.7.0) по умолчанию ставит `X-Frame-Options: SAMEORIGIN` и CSP с `frame-ancestors 'self'` и даёт их переопределить для маршрута через `routeRules[…].security`. Заголовок действует при загрузке документа: для встраивания важен именно ответ на документ во фрейме, клиентская навигация на это не влияет. Для пререндеренных страниц на статическом хостинге заголовки ставит хостинг или CDN.

**CSRF в `server/api`.** Nuxt 4 (сверено 4.6.4, h3 1.15) защиты от CSRF не включает: любой `server/api/*.post.ts` с cookie-сессией уязвим, пока вы не добавите проверку. Варианты:

- серверная middleware с `Sec-Fetch-Site` и fallback на `Origin` (пример ниже) — без изменений на клиенте;
- модуль **nuxt-csurf** (на нём же основан `security.csrf` в nuxt-security, по умолчанию выключен): секрет — в cookie `__Host-csrf` (`HttpOnly`, `SameSite=Strict`), зашифрованный токен — в `<meta name="csrf-token">` каждого SSR-ответа, клиент шлёт его заголовком `csrf-token` через `useCsrfFetch` или `$csrfFetch`.

> [!WARNING]
> В nuxt-csurf 1.6.6 `methodsToProtect` по умолчанию — `['POST', 'PUT', 'PATCH']`: **`DELETE` не проверяется** (сверено по исходникам модуля). Без `https: true` cookie называется просто `csrf`, без префикса `__Host-`. Токен зашит в HTML, поэтому страницы с `swr`/`isr` или CDN-кэшем отдадут всем чужой токен, и запросы будут отклоняться.

## Примеры

CSRF-атака формой: `POST` с cookie жертвы и «JSON» в теле без preflight:

```html
<!-- evil.example: auto-submits on load -->
<form id="f" method="POST" action="https://shop.example/api/transfer" enctype="text/plain">
  <!-- body becomes: {"to":"attacker","amount":1000,"x":"="} -->
  <input name='{"to":"attacker","amount":1000,"x":"' value='"}' />
</form>
<script>document.getElementById('f').submit()</script>
```

Защита в Nuxt: серверная middleware на Fetch Metadata с fallback на `Origin`:

```ts
// server/middleware/csrf.ts
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export default defineEventHandler((event) => {
  if (SAFE_METHODS.has(event.method)) return

  const site = getRequestHeader(event, 'sec-fetch-site')
  if (site) {
    // 'same-site' is rejected on purpose: a sibling subdomain is not trusted
    if (site === 'same-origin' || site === 'none') return
    throw createError({ statusCode: 403, statusMessage: 'Cross-site request' })
  }

  const origin = getRequestHeader(event, 'origin')
  if (!origin) return // no browser metadata at all: not a browser, no victim cookies

  const expected = getRequestURL(event).origin // behind a proxy: getRequestURL(event, { xForwardedHost: true })
  if (origin !== expected) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request' })
  }
})
```

Заголовки против встраивания по маршрутам:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  routeRules: {
    '/**': {
      headers: {
        'Content-Security-Policy': "frame-ancestors 'none'",
        'X-Frame-Options': 'DENY', // legacy browsers only
      },
    },
    // a widget that partners may embed: the more specific rule overrides the CSP key;
    // browsers ignore X-Frame-Options when frame-ancestors is present
    '/embed/**': {
      headers: {
        'Content-Security-Policy': "frame-ancestors https://partner.example",
      },
    },
  },
})
```

SRI для скрипта с CDN и вычисление хэша:

```html
<script
  src="https://cdn.jsdelivr.net/npm/vue@3.5.45/dist/vue.global.prod.js"
  integrity="sha384-<base64 hash>"
  crossorigin="anonymous"
></script>
```

```sh
# hash of the exact file you reviewed
curl -s https://cdn.jsdelivr.net/npm/vue@3.5.45/dist/vue.global.prod.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

Минимальная политика зависимостей в проекте:

```ini
# .npmrc
min-release-age=3
# fail instead of warn on unreviewed install scripts
strict-allow-scripts=true
```

```json
{
  "devDependencies": { "esbuild": "^0.25.0" },
  "allowScripts": { "esbuild@0.25.0": true }
}
```

## Вопросы с интервью

::: details Почему CSRF возможен, если same-origin policy запрещает читать чужие ответы
SOP ограничивает чтение, а не отправку: форма, картинка, навигация на чужой origin разрешены, и браузер прикладывает к ним cookies целевого сайта. Атакующему ответ не нужен — ему нужен побочный эффект на сервере. Поэтому CSRF работает против аутентификации, которую браузер прикладывает сам: cookie, HTTP Basic, клиентские сертификаты. Токен в `Authorization`, который кладёт ваш код, чужая страница не знает и отправить не может. Зато такой токен лежит в JavaScript и уязвим к XSS.
:::

::: details Достаточно ли SameSite=Lax для защиты от CSRF
Нет, это сильный слой, но не полный. `SameSite` смотрит на site, а не на origin: поддомен с XSS или захваченный поддомен — same-site, и cookie уйдёт даже со `Strict`. `Lax` отправляет cookie на `GET`-навигацию верхнего уровня, так что `GET` с побочным эффектом уязвим. Умолчания разные: без атрибута Chromium даёт `Lax` с окном Lax+POST, а Firefox и Safari — `None`. HTTP-аутентификацию и доступ по IP атрибут не покрывает. Поэтому основная защита — проверка `Sec-Fetch-Site`/`Origin` или токен, а `SameSite=Lax`, `__Host-` и отсутствие изменяющих `GET` — дополнительные слои.
:::

::: details Чем synchronizer token отличается от double-submit cookie и почему наивный double-submit слаб
Synchronizer token хранится в сессии на сервере и приходит с запросом в поле или заголовке. Сервер сравнивает его с сохранённым, и подделать значение нельзя. Double-submit обходится без состояния: токен в cookie и копия в заголовке должны совпасть. Наивный вариант проверяет только совпадение двух значений, а cookie для домена может **записать** соседний поддомен или MITM по HTTP (cookie tossing). Тогда атакующий ставит своё значение и отправляет его же в форме. Правильный вариант — подписанный: `HMAC(secret, sessionId + random)`, проверка привязана к текущей сессии и идёт за постоянное время. Cookie — с префиксом `__Host-`, который поддомен перезаписать не может.
:::

::: details Как Fetch Metadata помогает от CSRF и почему same-site нельзя пропускать
`Sec-Fetch-Site` браузер ставит сам, страница не может его подделать. Значение `cross-site` или `same-site` у изменяющего запроса значит, что его инициировала другая страница. Принимаются только `same-origin` и `none` (пользователь сам открыл URL). `same-site` — это любой поддомен вашего registrable domain, а именно через поддомены обходят `SameSite`. Без заголовка (старый браузер, HTTP) сервер сравнивает `Origin` с собственным origin целиком, `null` не принимается. Запрос без обоих заголовков пришёл не из браузера, а значит, без cookies жертвы. Так работают `http.CrossOriginProtection` в Go 1.25 и рекомендация OWASP. Плюс подхода — нет состояния и изменений на клиенте.
:::

::: details Нужна ли защита от CSRF SPA, которая шлёт JSON и токен в заголовке Authorization
Если аутентификация только через `Authorization: Bearer`, классический CSRF невозможен: браузер этот заголовок сам не прикладывает. Но почти всегда есть cookie: refresh-токен в `HttpOnly`-cookie, сессия SSR в Nuxt, BFF. Эндпоинты, которые её принимают (`/auth/refresh`, `/api/*` через прокси), уязвимы. Ставка на «JSON требует preflight» ненадёжна: форма с `enctype="text/plain"` отправит тело в формате JSON без preflight, если сервер не проверяет `Content-Type`. Вывод: проверять `Content-Type: application/json` и `Sec-Fetch-Site`/`Origin` на всех изменяющих маршрутах с cookie.
:::

::: details Что выбрать для защиты от clickjacking — X-Frame-Options или frame-ancestors
`frame-ancestors` в заголовке CSP. Директива принимает список origin, проверяет всю цепочку предков, а при её наличии браузеры игнорируют `X-Frame-Options`. У `X-Frame-Options` только `DENY` и `SAMEORIGIN`, а `ALLOW-FROM` современные браузеры не поддерживают, и защиты с ним нет вовсе. `X-Frame-Options` оставляют вторым заголовком для очень старых браузеров. Оба работают только как заголовок ответа: `<meta>` их не задаёт. Frame-busting скрипт защитой не считается: `sandbox` без `allow-scripts` его отключает.
:::

::: details Что дают lockfile, provenance и npm audit и чего они не дают
Lockfile с `npm ci` гарантирует, что в CI и проде ставятся именно проверенные версии с теми же хэшами tarball. Новая вредоносная версия не придёт сама, но ловушка в уже залоченной версии останется. Provenance подтверждает, из какого репозитория и workflow собран пакет, — это защита от публикации украденным токеном с ноутбука. Но TanStack в 2026 году опубликовал вредоносные версии из своего же CI с настоящей provenance. `npm audit` знает только опубликованные advisories, свежую атаку он не видит. Поэтому их дополняют блокировкой install-скриптов (`allowScripts` в npm 12), задержкой обновлений (`min-release-age`) и минимумом зависимостей. Код в бандле выполняется у пользователя с правами вашего origin, так что CSP ограничивает и его.
:::

::: details Почему подключать скрипт с публичного CDN опасно и помогает ли SRI
Скрипт с CDN выполняется с правами вашей страницы: владелец CDN или домена может отдать что угодно. polyfill.io в 2024 году после смены владельца начал перенаправлять мобильных пользователей более 100 000 сайтов. SRI (`integrity` + `crossorigin`) заставляет браузер сверить хэш и не выполнять изменённый файл. Но это работает только для неизменяемого версионированного файла. polyfill.io генерировал ответ под `User-Agent`, `/latest/` меняется со временем, и хэш для них не зафиксировать. Аналитика и платёжные SDK часто тоже меняются без смены URL. Лучше вообще убрать чужой CDN: положить код в бандл, а то, что нельзя, ограничить CSP и изолировать в iframe.
:::

## Задачи

### 1. Найти CSRF в API · легко

Сессия — cookie `sid; HttpOnly; Secure; SameSite=Lax`, фронтенд на `app.example.com`, API на `api.example.com`, CORS разрешает `https://*.example.com` с credentials. Какие эндпоинты уязвимы и почему?

1. `GET /api/logout`
2. `POST /api/profile/email`, тело `application/x-www-form-urlencoded`
3. `POST /api/orders`, сервер принимает JSON, не проверяя `Content-Type`
4. `DELETE /api/orders/:id`
5. `GET /api/orders` — список заказов

::: details Решение и разбор
1. **Уязвим.** `Lax` отправит cookie при навигации верхнего уровня `GET`: ссылка или `location.href` с чужого сайта разлогинит пользователя. Изменяющих `GET` быть не должно.
2. **С чужого site защищён** `Lax`: на cross-site `POST` cookie не уйдёт. **С поддомена** (`blog.example.com` с пользовательским контентом) — уязвим: это same-site.
3. Как 2, плюс форма с `enctype="text/plain"` подсунет тело в формате JSON без preflight. Поддомен сделает это даже без формы — CORS его разрешает.
4. С чужого site форма `DELETE` не отправит, а `fetch` требует preflight. Но CORS с `*.example.com` пропустит любой поддомен, и с credentials cookie уйдёт.
5. Не CSRF: побочного эффекта нет, а прочитать ответ чужой site не может. Поддомен — может, из-за широкого CORS. Это уже утечка данных.

Исправление: проверка `Sec-Fetch-Site === 'same-origin'` с fallback на `Origin` на всех изменяющих методах, точный список origin в CORS вместо маски, `POST /api/logout`, проверка `Content-Type`.
:::

### 2. Проверка Fetch Metadata · средне

Напишите чистую функцию `isAllowed({ method, headers, selfOrigin })` для серверной middleware. `headers` — объект с заголовками в нижнем регистре. Безопасные методы пропускаются, изменяющие — только same-origin или по прямой навигации пользователя. Для старых браузеров — fallback на `Origin`. Какие случаи нужно покрыть тестами?

::: details Решение и разбор
```js
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isAllowed({ method, headers, selfOrigin }) {
  if (SAFE.has(method.toUpperCase())) return true

  const site = headers['sec-fetch-site']
  if (site !== undefined) return site === 'same-origin' || site === 'none'

  const origin = headers.origin
  if (origin === undefined) return true // not a browser: no ambient cookies
  return origin === selfOrigin // exact match; 'null' never matches
}
```

Тесты:

- `POST` с `same-origin` → `true`; с `same-site` и `cross-site` → `false`;
- `POST` без `Sec-Fetch-Site`, `Origin` совпадает → `true`; `https://example.com.evil.net` → `false` (поэтому сравнение строгое, а не `startsWith`); `null` → `false`;
- `POST` без обоих заголовков → `true`; `GET` с `cross-site` → `true`;
- метод в нижнем регистре (`post`) не должен проскочить как «безопасный».

Почему `none` пропускается: так помечены навигации, которые пользователь начал сам (адресная строка, закладка), чужая страница их не инициирует. Почему запрос без заголовков пропускается: современный браузер прислал бы хотя бы `Origin` на `POST`, значит, это `curl` или сервер, а у них нет cookies жертвы. Если API должен принимать формы из очень старых браузеров, добавляют токен. Если на сайте есть изменяющие `GET`, эта функция их не защитит — их переписывают на `POST`.

Сложность: O(1).
:::

### 3. Подписанный double-submit токен · средне

Реализуйте в Node `createCsrfToken(sessionId)` и `verifyCsrfToken(sessionId, token)` по схеме OWASP «signed double-submit cookie»: токен — случайная часть и HMAC-SHA-256 от сессии и этой части на серверном секрете. Сам `sessionId` в токен не попадает.

::: details Решение и разбор
```js
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const SECRET = process.env.CSRF_SECRET // 32+ random bytes, never sent to the client

function sign(sessionId, random) {
  // length-prefixed message: no ambiguity between "ab"+"c" and "a"+"bc"
  const message = `${sessionId.length}!${sessionId}!${random}`
  return createHmac('sha256', SECRET).update(message).digest('base64url')
}

export function createCsrfToken(sessionId) {
  const random = randomBytes(32).toString('base64url')
  return `${random}.${sign(sessionId, random)}`
}

export function verifyCsrfToken(sessionId, token) {
  if (typeof token !== 'string') return false
  const [random, mac] = token.split('.')
  if (!random || !mac) return false
  const expected = Buffer.from(sign(sessionId, random))
  const actual = Buffer.from(mac)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
```

Токен кладут в cookie `__Host-csrf` (без `HttpOnly`, если клиент читает его из cookie, или отдают в `<meta>`) и ждут его же в заголовке `X-CSRF-Token`. Проверяется значение **из заголовка** против **текущей** сессии.

Почему это закрывает cookie tossing: атакующий с поддомена может записать свою cookie, но не может вычислить HMAC для сессии жертвы без серверного секрета. Свой валидный токен (от своей сессии) он подставить тоже не может: подпись не сойдётся с `sessionId` жертвы. Срок жизни в токен не добавляют — он живёт столько же, сколько сессия, а при её смене (вход, выход) токен автоматически становится невалидным. `timingSafeEqual` требует буферы одной длины, поэтому длины сравниваются заранее.

Сложность: O(1) по времени и памяти (длины токена и сессии ограничены).
:::

### 4. Аудит цепочки поставок · средне

Найдите риски в CI и `package.json` и предложите исправления.

```yaml
# .github/workflows/ci.yml
on: [pull_request_target]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { ref: '${{ github.event.pull_request.head.sha }}' }
      - run: npm install
      - run: npm run build
      - run: npm publish
        env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' }
```

```json
{
  "dependencies": {
    "vue": "^3.5.0",
    "lodash": "*",
    "internal-ui": "^2.0.0",
    "date-utils": "git+https://github.com/someone/date-utils.git"
  }
}
```

::: details Решение и разбор
1. **`pull_request_target` + checkout кода из PR.** Этот триггер работает с секретами и правами базового репозитория, а checkout `head.sha` запускает код из форка. Так началась атака на TanStack. Исправление: `pull_request` для проверки PR, публикация — в отдельном workflow по тегу или релизу, без кэша, общего с PR-сборками.
2. **`npm install` в CI.** Может обновить lockfile и поставить свежие версии. Нужен `npm ci`.
3. **Долгоживущий `NPM_TOKEN`.** Его крадут черви вроде Shai-Hulud. Нужен trusted publishing (OIDC, `permissions: id-token: write`) с provenance, а публикация — через environment с ручным подтверждением.
4. **`actions/checkout@v4`** — изменяемый тег. Сторонние actions закрепляют по SHA коммита.
5. **`"lodash": "*"`** — любая будущая версия, включая мажорную или вредоносную. Нужен нормальный диапазон, а лучше — проверить, нужен ли lodash вообще.
6. **`internal-ui` без scope** — кандидат на dependency confusion: кто-то опубликует в публичном реестре `internal-ui@99.0.0`. Нужен `@company/ui` и `@company:registry=…` в `.npmrc`.
7. **Git-зависимость** не проходит через реестр (нет подписей и provenance), может выполнить `prepare` и меняется вместе с веткой. В npm 12 по умолчанию не установится (`allow-git=none`). Нужна опубликованная версия или форк в своём scope.
8. Нет политики скриптов и задержки обновлений: `allowScripts` (npm 12), `min-release-age` в `.npmrc`, `npm audit signatures` в CI.
:::

### 5. Защитить страницу подтверждения платежа в Nuxt · сложно

Nuxt 4, сессия в cookie. Страница `/checkout/confirm` подтверждает платёж кнопкой, которая вызывает `POST /api/payments/:id/confirm`. Подключён платёжный SDK с CDN провайдера и аналитика с публичного CDN. Партнёры хотят встраивать каталог `/embed/catalog` к себе в iframe. Опишите защиту от CSRF, clickjacking и атак через сторонний код.

::: details Решение и разбор
**CSRF.** Серверная middleware на все изменяющие методы под `/api`: `Sec-Fetch-Site` ∈ {`same-origin`, `none`}, иначе fallback на точное сравнение `Origin`. Для платежа дополнительно — идемпотентный ключ и повторная проверка, что платёж принадлежит сессии. Cookie сессии — `__Host-sid; HttpOnly; Secure; SameSite=Lax`. Если подключаете nuxt-csurf, добавить `DELETE` в `methodsToProtect` и не кэшировать HTML с токеном (`swr`/`isr` не для `/checkout/**`).

**Clickjacking.** Глобально `frame-ancestors 'none'` (+ `X-Frame-Options: DENY`). Для `/embed/catalog/**` — `frame-ancestors` со списком партнёров, без `X-Frame-Options`, и в этих страницах никаких действий от имени пользователя: только чтение публичного каталога. Против DoubleClickjacking кнопка подтверждения становится активной только после реального взаимодействия с самой страницей (`pointermove` или `keydown` после загрузки). Альтернатива — подтверждение кодом.

**Платёжный SDK.** SRI обычно невозможен: провайдер обновляет файл по тому же URL. Поэтому SDK грузят только с домена провайдера, разрешённого в CSP (`script-src` с nonce и `'strict-dynamic'`, `connect-src` и `frame-src` на домены провайдера), а ввод карты делают в его iframe (hosted fields): данные карты не попадают в ваш DOM, даже если ваш JS скомпрометирован.

**Аналитика.** Убрать с `/checkout/**` совсем или самохостить конкретную версию в своём бандле. Если остаётся CDN — версионированный URL с `integrity` и `crossorigin`. `Integrity-Policy-Report-Only` покажет, какие скрипты грузятся без SRI.

**Зависимости.** `npm ci` в CI, `allowScripts` и `min-release-age`, trusted publishing для своих пакетов, ревью изменений lockfile. CSP с отчётами (`report-to`) — единственный сигнал, если вредоносный код всё-таки попал в бандл и начал ходить на чужие домены.
:::

## Источники

- [OWASP: Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP: Clickjacking Defense Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html)
- [W3C: Fetch Metadata Request Headers](https://www.w3.org/TR/fetch-metadata/)
- [WHATWG Fetch: `Origin` header](https://fetch.spec.whatwg.org/#origin-header)
- [IETF: RFC 6265bis, Cookies: HTTP State Management Mechanism](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/)
- [W3C: Content Security Policy Level 3, `frame-ancestors`](https://www.w3.org/TR/CSP3/#directive-frame-ancestors)
- [HTML Living Standard: the `iframe` `sandbox` attribute](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox)
- [W3C: Subresource Integrity](https://www.w3.org/TR/sri-2/)
- [npm Docs: package-lock.json](https://docs.npmjs.com/cli/configuring-npm/package-lock-json), [npm ci](https://docs.npmjs.com/cli/commands/npm-ci), [npm approve-scripts](https://docs.npmjs.com/cli/commands/npm-approve-scripts), [config: `min-release-age`, `allow-git`, `ignore-scripts`](https://docs.npmjs.com/cli/using-npm/config)
- [npm Docs: npm audit (signatures)](https://docs.npmjs.com/cli/commands/npm-audit), [Generating provenance statements](https://docs.npmjs.com/generating-provenance-statements), [Trusted publishing](https://docs.npmjs.com/trusted-publishers)
- [GitHub Changelog: Upcoming breaking changes for npm v12](https://github.blog/changelog/2026-06-24-upcoming-breaking-changes-for-npm-v12/)
- [Go: `net/http.CrossOriginProtection`](https://pkg.go.dev/net/http#CrossOriginProtection)
- [Nuxt: route rules](https://nuxt.com/docs/4.x/guide/concepts/rendering#route-rules)
- [nuxt-security: X-Frame-Options](https://nuxt-security.vercel.app/headers/xframeoptions), [CSRF](https://nuxt-security.vercel.app/middleware/csrf)
- [nuxt-csurf](https://github.com/Morgbn/nuxt-csurf)
- [MDN: Cross-site request forgery](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/CSRF), [Clickjacking](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/Clickjacking), [Sec-Fetch-Site](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site), [Integrity-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Integrity-Policy)
- [Sansec: Polyfill supply chain attack hits 100K+ sites](https://sansec.io/research/polyfill-supply-chain-attack)
- [debug-js/debug#1005: Version 4.4.2 published to npm is compromised](https://github.com/debug-js/debug/issues/1005)
- [CISA: Widespread Supply Chain Compromise Impacting npm Ecosystem](https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem)
- [TanStack: npm supply-chain compromise postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem)
- [Paulos Yibelo: DoubleClickjacking](https://www.paulosyibelo.com/2024/12/doubleclickjacking-what.html)
- [Filippo Valsorda: Cross-Site Request Forgery](https://words.filippo.io/csrf/)
