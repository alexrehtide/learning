---
title: Аутентификация на фронтенде
level: ядро
---

# Аутентификация на фронтенде

> **Коротко.** Фронтенд никого не защищает: guard в роутере и скрытая кнопка — это UX, а решение «можно или нельзя» принимает сервер на каждом запросе. Задача фронтенда — получить учётные данные безопасным способом и не дать их унести. Для SPA с внешним провайдером это Authorization Code + PKCE, а лучше — **BFF** (Backend for Frontend): токены живут на сервере, браузер держит только `HttpOnly`-cookie. JWT не делает систему «stateless» бесплатно: отзыв токена до истечения срока снова требует состояния на сервере. Поэтому access-токен короткий, а refresh-токен ротируется при каждом использовании.

**Связанные темы:** [Хранилища браузера](../network/browser-storage.md), [Same-origin policy, CORS и cookies](../network/cors-and-cookies.md), [CSRF, clickjacking и supply chain](./csrf-and-clickjacking.md), [XSS и безопасный вывод во Vue](./xss.md), [Content Security Policy](./csp.md), [HTTP: методы, статусы, заголовки, версии](../network/http.md), [Промисы](../javascript/promises.md), [Web Workers, Service Workers и PWA](../browser/workers.md)

## Теория

### Аутентификация, авторизация и место фронтенда

**Аутентификация** (authentication) отвечает на вопрос «кто это», **авторизация** (authorization) — «что ему можно». Сервер проверяет обе на каждом запросе: код фронтенда принадлежит пользователю, его можно прочитать, изменить в DevTools или обойти `curl`. Поэтому всё, что фронтенд делает с правами, — подсказка интерфейсу: показать кнопку, перенаправить на `/login`, не грузить лишний чанк.

На фронтенде остаются три настоящие задачи безопасности:

- получить учётные данные так, чтобы их нельзя было перехватить (OAuth-редиректы, PKCE, WebAuthn);
- хранить их так, чтобы XSS и зависимости не унесли их с машины пользователя;
- не открыть новых дыр: CSRF при cookie-сессии, утечка токена в URL, `Referer` и логи.

### Сессия на cookie и токен

**Сессия на сервере (stateful).** После входа сервер создаёт запись сессии и отдаёт её случайный идентификатор в cookie `HttpOnly; Secure; SameSite=Lax`. На каждом запросе браузер прикладывает cookie сам, сервер ищет сессию в хранилище. Выход и отзыв мгновенные: удалить запись. Цена — поиск в хранилище на каждый запрос и защита от CSRF, ведь cookie прикладывается автоматически (см. [CSRF, clickjacking и supply chain](./csrf-and-clickjacking.md)).

**Самодостаточный токен (JWT).** JWT (JSON Web Token, RFC 7519) — три части в base64url через точку: заголовок (`alg`, `kid`), payload с утверждениями (claims: `sub`, `exp`, `iat`, `aud`, `iss`) и подпись. Сервер проверяет подпись ключом и срок `exp`, и в базу идти не нужно. Это и называют «stateless».

Почему «stateless» неправда на практике:

- **Отзыв.** Подписанный токен валиден до `exp`. Выход, смена пароля, блокировка пользователя требуют denylist по `jti` или номер версии сессии у пользователя — то есть то же хранилище, от которого уходили.
- **Устаревшие права.** Роли в payload замораживаются на время жизни токена. Сняли права администратора — токен ещё 15 минут говорит обратное.
- **Refresh-токен** почти всегда хранится на сервере, чтобы его можно было ротировать и отозвать.

Итог: JWT удобен там, где токен проверяют много независимых сервисов (микросервисы, внешние API), и только при коротком сроке жизни. Для одного бэкенда с одним фронтендом сессия на cookie проще и безопаснее.

> [!WARNING]
> JWT обычно **подписан** (JWS), а не зашифрован: payload читается кем угодно — `atob` после замены `-_` на `+/`. Не кладите туда персональные данные. Проверку подписи делает только сервер: явный список допустимых алгоритмов (атаки `alg: none` и подмена RS256 на HS256 с публичным ключом в роли секрета), проверка `iss`, `aud` и `exp`. Клиент может декодировать payload для UI (имя, время истечения), но никогда не доверяет ему решения о доступе.

### Где хранить токены

Подробно — в [Хранилищах браузера](../network/browser-storage.md) (раздел «Где хранить токены») и [Same-origin policy, CORS и cookies](../network/cors-and-cookies.md). Вывод оттуда: всё, что видит JavaScript, унесёт XSS; распространённый компромисс — access-токен в памяти, refresh-токен или сессия в `HttpOnly`-cookie.

RFC 10017 добавляет к этому неприятный факт (раздел 5.1.3). Если XSS выполняется в origin приложения, ему не нужны ваши токены: он открывает скрытый iframe, запускает **новый** «тихий» Authorization Code flow на живой сессии у провайдера и получает собственный комплект токенов. Изоляция хранения (память, Web Worker, неизвлекаемые ключи DPoP), короткий срок и ротация от этого не спасают. Помогает только одно: не давать браузеру токенов вовсе, то есть BFF.

### Access и refresh, ротация и отзыв

**Access-токен** живёт минуты (5–15), уходит в `Authorization: Bearer` на каждый запрос к API и не отзывается — истекает. **Refresh-токен** живёт дни или недели, уходит только на token endpoint и обменивается на новый access-токен.

**Ротация** (RFC 9700, раздел 4.14.2): при каждом обмене сервер выдаёт **новый** refresh-токен и инвалидирует старый. Это делает кражу заметной. Если украденный токен использовали и вор, и настоящий клиент, второй предъявит уже погашенный токен. Сервер видит повторное использование (reuse detection) и отзывает всё семейство токенов: выйдут оба, и пользователь залогинится заново. RFC 10017 требует от сервера для браузерных клиентов либо ротацию, либо привязку токена к ключу клиента, а также максимальный срок жизни: ротированный токен не живёт дольше исходного.

Ротация ломает наивный клиент: две вкладки или два параллельных запроса одновременно отправляют один и тот же refresh-токен, второй сервер считает повторным, и пользователя выбрасывает. Поэтому обновление на клиенте делают **single-flight** (задача 2), между вкладками — через Web Locks (задача 4), а серверы часто дают короткое окно, в котором предыдущий токен ещё принимается.

**Отзыв.** Refresh-токен отзывают через revocation endpoint (RFC 7009) при выходе. Access-токен отозвать нельзя, только дождаться `exp` или проверять его через introspection (RFC 7662) — что снова stateful.

**Привязка к отправителю** (sender-constrained). DPoP (RFC 9449): клиент создаёт пару ключей WebCrypto с `extractable: false`, хранит её в IndexedDB и подписывает каждый запрос. Украденный токен без ключа бесполезен. От XSS, который делает запросы прямо со страницы или запускает новый flow, DPoP не защищает.

> [!NOTE]
> **DBSC** (Device Bound Session Credentials) — то же для cookie: браузер привязывает сессию к ключу в TPM устройства и периодически доказывает владение им, так что украденная инфостилером cookie на другой машине не работает. В стабильном Chrome — с версии 146 на Windows (апрель 2026), другие платформы и браузеры — позже (сверено 2026-11-12). Это защита от кражи cookie с диска, а не от XSS.

### OAuth 2.0 и OpenID Connect для SPA

**OAuth 2.0** (RFC 6749) — делегирование **доступа**: пользователь разрешает клиенту ходить в API (resource server) от своего имени, а authorization server выдаёт клиенту access-токен. Аутентификации пользователя в нём нет. **OpenID Connect** (OIDC) — слой поверх OAuth: со scope `openid` провайдер выдаёт ещё **ID-токен** — JWT с `sub`, `iss`, `aud` = `client_id` и `nonce`, который говорит клиенту, кто вошёл. ID-токен предназначен клиенту, а не API: в `Authorization` идёт access-токен.

**Authorization Code + PKCE** (RFC 7636):

1. Клиент создаёт случайный `code_verifier` (43–128 символов) и вычисляет `code_challenge = BASE64URL(SHA-256(code_verifier))`. Ещё он генерирует `state` (и `nonce` для OIDC) и сохраняет всё в `sessionStorage`.
2. Редирект на `/authorize?response_type=code&client_id&redirect_uri&scope&state&code_challenge&code_challenge_method=S256`.
3. Пользователь входит у провайдера и возвращается на `redirect_uri?code=…&state=…`. Клиент сверяет `state`.
4. Клиент отправляет `code` и `code_verifier` на token endpoint и получает токены. Перехваченный `code` без `code_verifier` бесполезен.

Что от чего защищает:

| Параметр | Против чего |
| --- | --- |
| `code_challenge`/`code_verifier` | перехват кода (вредоносное приложение на том же redirect URI, логи, `Referer`) и подстановка чужого кода (code injection) |
| `state` | CSRF на redirect URI: атакующий подсовывает жертве свой код — login CSRF |
| `nonce` | повтор и подмена ID-токена |
| точное совпадение `redirect_uri` | открытый редирект, уводящий код атакующему |

RFC 9700 (OAuth 2.0 Security BCP, январь 2025) требует PKCE для публичных клиентов, рекомендует его и конфиденциальным, запрещает `plain`, если сервер умеет `S256`, и требует точного сравнения `redirect_uri`. Если провайдер гарантированно поддерживает PKCE, он сам защищает от CSRF на redirect URI, но `state` всё равно передают для возврата на исходную страницу и для старых серверов.

**Почему implicit flow устарел.** В implicit (`response_type=token`) access-токен приходит прямо во фрагменте URL. Оттуда он утекает в историю браузера, в расширения, в логи и при редиректах. Привязать токен к клиенту невозможно, подсунуть чужой токен (token injection) — легко. Refresh-токена нет, и продлевают сессию «тихим» iframe-запросом, который ломается блокировкой сторонних cookies. Implicit появился, когда у браузеров не было CORS и token endpoint из SPA был недоступен. RFC 9700 говорит: клиентам **не следует** (SHOULD NOT) использовать implicit; черновик OAuth 2.1 (draft-17 от 31.10.2026, ещё не RFC) убирает его из спецификации вместе с паролевым грантом (ROPC).

### BFF: токены не попадают в браузер

RFC 10017 «OAuth 2.0 for Browser-Based Applications» (BCP, август 2026) описывает три архитектуры в порядке убывания безопасности:

| Архитектура | Где токены | Что в браузере |
| --- | --- | --- |
| **BFF** | на сервере BFF, конфиденциальный клиент с секретом | только cookie сессии; запросы к API проксирует BFF |
| **Token-mediating backend** | бэкенд получает токены и отдаёт access-токен браузеру | access-токен в памяти, refresh — на сервере |
| **Браузерный OAuth-клиент** | всё в браузере, публичный клиент + PKCE | access и refresh |

Для приложений с бизнес-данными и персональными данными RFC «настоятельно рекомендует» BFF. Требования к его cookie (раздел 6.1.3.2): обязательно `Secure` и `HttpOnly`, желательно `SameSite=Strict`, `Path=/`, без `Domain` и с префиксом `__Host-Http-`. Содержимое шифруется, если сессия хранится в самой cookie. BFF **обязан** защищаться от CSRF: `SameSite` достаточно, только если с ним на одном site нет чужих приложений. Иначе — свой заголовок, который вызывает preflight, или токены.

> [!WARNING]
> Префиксы `__Http-` и `__Host-Http-` гарантируют, что cookie поставлена через `Set-Cookie` с `HttpOnly`, а не скриптом. Поддержка: Chrome 140, Firefox 143, в Safari нет (MDN BCD, сверено 2026-11-12). Браузер без поддержки примет такую cookie как обычную с этими атрибутами, так что имя безвредно, но гарантии в Safari нет. Классический `__Host-` поддерживают все.

Nuxt естественно становится BFF: Nitro — свой сервер на том же origin. Сессия — зашифрованная cookie (например, `nuxt-auth-utils`: `setUserSession`/`requireUserSession` на сервере, `useUserSession()` на клиенте), запросы к внешнему API идут через `server/api`, а токены провайдера лежат в серверном хранилище сессий.

### Выход и истечение сессии на нескольких вкладках

Сессия общая для всех вкладок (cookie одна), а состояние интерфейса — у каждой своё. Отсюда три сценария:

- **Выход в одной вкладке.** Сервер отзывает сессию и refresh-токен, вкладка рассылает сигнал через `BroadcastChannel` — реализация в задаче «Выход во всех вкладках» [Хранилищ браузера](../network/browser-storage.md). Сигнал — подсказка, источник истины — сервер: спящая вкладка узнает о выходе по первому `401`.
- **Истечение.** На `401` клиент пытается обновить токен один раз. Не вышло — переход на `/login?redirect=<текущий путь>` (путь проверяют, чтобы не получить открытый редирект). Черновики форм сохраняют до перехода.
- **Вход в другой аккаунт в соседней вкладке.** Cookie уже чужая, а вкладка показывает данные прежнего пользователя. Сервер возвращает `sub`, вкладка сравнивает его с запомненным и перезагружается.

Если токены живут в памяти, каждая вкладка обновляет их сама. При ротации это гонка между вкладками, и её решают блокировкой `navigator.locks` (задача 4).

### Passkeys и WebAuthn

**WebAuthn** (W3C Recommendation Level 3, 25.08.2026) — вход по ключевой паре вместо пароля. При регистрации аутентификатор (Touch ID, Windows Hello, телефон, USB-ключ) создаёт пару ключей для **RP ID** — домена сайта. Сервер хранит только публичный ключ. При входе сервер даёт случайный challenge, аутентификатор подписывает его вместе с origin страницы, сервер проверяет подпись, origin и challenge. **Passkey** — такие учётные данные, синхронизируемые между устройствами через менеджер паролей.

Почему это сильнее пароля и OTP:

- **Фишинг невозможен на уровне протокола.** Браузер не даст использовать ключ `bank.com` на `bank-login.com`, а подписанный origin сервер всё равно проверит.
- **Утечка базы ничего не даёт**: публичный ключ не секрет.
- Нет общего секрета, который можно перехватить или подобрать.

Что видит фронтенд: `navigator.credentials.create({ publicKey })` и `navigator.credentials.get({ publicKey, mediation: 'conditional' })`. Conditional mediation показывает passkeys в автозаполнении поля логина с `autocomplete="username webauthn"`. Опции приходят с сервера в JSON, и бинарные поля превращаются в `ArrayBuffer` методом `PublicKeyCredential.parseRequestOptionsFromJSON` (Chrome 129, Firefox 119, Safari 18.4).

| API | Chrome | Firefox | Safari |
| --- | --- | --- | --- |
| `isConditionalMediationAvailable()` | 108 | 119 | 16 |
| `getClientCapabilities()` | 133 | 135 | 17.4 |
| `parseCreationOptionsFromJSON()`, `toJSON()` | 129 | 119 | 18.4 |
| `signalUnknownCredential()`, `signalAllAcceptedCredentials()` | 132 | нет | 26 |

Поддержка — по MDN BCD, сверено 2026-11-12. Signal API сообщает менеджеру паролей, что passkey удалён на сервере, чтобы он не предлагал его снова. Сама криптография — забота сервера и библиотеки (SimpleWebAuthn и аналоги), руками её не пишут.

### Vue и Nuxt: что защищает guard, а что нет

**Guard в Vue Router** (`router.beforeEach`) решает, показать ли маршрут: вернуть `false` — отменить, вернуть location — перенаправить, ничего или `true` — пропустить. Третий аргумент `next` с Vue Router 5.0.3 выдаёт предупреждение об устаревании. Guard не защищает **данные**: чанк страницы скачивается по прямому URL, API отвечает любому запросу с валидной cookie. Его задача — UX: не показать пустую страницу с ошибками и вернуть пользователя после входа.

**Route middleware Nuxt** (`app/middleware/*.ts`, глобальная — с суффиксом `.global`) — тот же guard, но для начальной страницы он выполняется дважды: при SSR и снова в браузере. Различать окружения позволяют `import.meta.server`/`import.meta.client`, пропустить повтор при гидрации — `nuxtApp.isHydrating && nuxtApp.payload.serverRendered`. Route middleware **не** выполняется для запросов к `server/api`: это часть Vue-приложения, а серверная middleware Nitro (`server/middleware`) — отдельный механизм. Каждый обработчик API проверяет сессию сам (`requireUserSession(event)`) или через серверную middleware.

**Cookies при SSR.** В браузере cookie прикладывается сама, на сервере Nuxt её нужно передать: `useFetch` и `useRequestFetch` пробрасывают заголовки входящего запроса (кроме `host`, `connection`, `accept` и других hop-by-hop) на свои же маршруты, голый `$fetch` — нет. Для внешнего API — `useRequestHeaders(['cookie'])`, и только этот заголовок. `Set-Cookie` из ответа, полученного на сервере, в браузер сам не попадёт. Разбор с кодом — в задаче «Сессия теряется при SSR» темы [Same-origin policy, CORS и cookies](../network/cors-and-cookies.md).

> [!WARNING]
> Страницы с данными пользователя нельзя отдавать из общего кэша: `routeRules` с `swr`/`isr` и CDN не включают cookie в ключ, и один пользователь увидит страницу другого. Состояние, заполненное на сервере, уходит в payload — не кладите туда токены: payload встраивается в HTML и доступен любому скрипту на странице.

## Примеры

Глобальный guard: UX, а не защита. Сессию узнаём у сервера, а не из `localStorage`:

```ts
// router.ts (Vue Router 5)
router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return
  const auth = useAuthStore()
  if (auth.user === undefined) await auth.fetchMe() // GET /api/me, cookie goes automatically
  if (!auth.user) {
    // only an internal path goes into ?redirect=, never a full URL
    return { name: 'login', query: { redirect: to.fullPath } }
  }
})
```

Nuxt: middleware для страниц и отдельная защита для API.

```ts
// app/middleware/auth.ts — protects navigation, not data
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession() // nuxt-auth-utils
  if (!loggedIn.value) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
})

// server/api/orders.get.ts — the real check, on every request
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event) // 401 without a valid sealed cookie
  return listOrders(user.id)
})
```

Cookie сессии BFF:

```http
Set-Cookie: __Host-Http-session=<opaque id>; Path=/; Secure; HttpOnly; SameSite=Strict
```

Декодирование payload JWT на клиенте — только для интерфейса:

```ts
function readJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1]
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes)) // UTF-8 safe, unlike plain atob
}
// fine: schedule a refresh shortly before `exp`; not fine: `if (payload.role === 'admin')` as access control
```

Вход по passkey через автозаполнение:

```ts
async function startConditionalLogin(signal: AbortSignal) {
  if (!(await PublicKeyCredential.isConditionalMediationAvailable?.())) return
  const json = await (await fetch('/api/webauthn/options', { method: 'POST' })).json()
  const credential = await navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(json),
    mediation: 'conditional', // shows passkeys in the autofill of <input autocomplete="username webauthn">
    signal, // abort when the user chooses another sign-in method
  })
  await fetch('/api/webauthn/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify((credential as PublicKeyCredential).toJSON()),
  })
}
```

## Вопросы с интервью

::: details Чем аутентификация отличается от авторизации и что из этого делает фронтенд
Аутентификация устанавливает, кто пользователь, авторизация — что ему разрешено. Обе выполняет сервер на каждом запросе, потому что клиентский код под контролем пользователя: guard в роутере обходится прямым запросом к API, скрытая кнопка — через DevTools. Фронтенд отвечает за безопасное получение учётных данных (OAuth с PKCE, WebAuthn), их хранение и за то, чтобы не открыть новых дыр — CSRF при cookie, утечку токена в URL. Проверки ролей на клиенте — подсказка интерфейсу, которая должна дублироваться на сервере.
:::

::: details Правда ли, что JWT делает аутентификацию stateless
Только пока не нужен отзыв. Подпись и `exp` проверяются без базы, но выход, смена пароля и блокировка требуют сделать токен невалидным до истечения: denylist по `jti` или версия сессии у пользователя, а это снова хранилище. Роли в payload замораживаются на срок жизни токена. Refresh-токен для ротации тоже хранится на сервере. Поэтому access-токен делают коротким (минуты), а stateless-проверку берут там, где её дешевле масштабировать: много сервисов, внешние API. Для одного бэкенда сессия на cookie проще: мгновенный отзыв, нет криптографии на клиенте, а CSRF закрывается `SameSite` и проверкой `Sec-Fetch-Site`.
:::

::: details Зачем refresh-токен и что даёт его ротация
Access-токен короткий, чтобы украденный быстро протух, а refresh позволяет получать новые без повторного входа. Refresh уходит только на token endpoint, поэтому реже светится. Ротация — новый refresh-токен на каждый обмен, старый погашается. Если вор и клиент используют один токен, второй предъявит погашенный, сервер обнаружит повторное использование и отзовёт всё семейство. Цена — гонки: параллельные запросы или вкладки отправят один токен дважды, поэтому обновление делают single-flight и синхронизируют между вкладками. Ротация не защищает от XSS, который всегда берёт свежий токен или запускает новый flow.
:::

::: details Как работает Authorization Code с PKCE и зачем нужны state и nonce
Клиент генерирует секретный `code_verifier`, отправляет на `/authorize` только его SHA-256 (`code_challenge`), получает `code` на redirect URI и обменивает его на токены, приложив `code_verifier`. Перехваченный код без верификатора бесполезен, а подставленный чужой код не сойдётся с верификатором текущей сессии. `state` связывает ответ с запросом, начатым этим браузером: без него атакующий завершит flow своим кодом и залогинит жертву в свой аккаунт. `nonce` в OIDC попадает в ID-токен и защищает от его повтора. RFC 9700 требует PKCE с `S256` для публичных клиентов и точное сравнение `redirect_uri`.
:::

::: details Почему implicit flow больше не рекомендуют
Токен приходит во фрагменте URL и оттуда утекает в историю, расширения, логи и при редиректах. Его нельзя привязать к клиенту, и чужой токен легко подсунуть. Refresh-токена нет: сессию продлевали скрытым iframe, а он не работает при блокировке сторонних cookies. Implicit существовал, потому что SPA не могли ходить на token endpoint без CORS. Сейчас могут, и Authorization Code + PKCE даёт то же без токена в URL. RFC 9700 говорит не использовать implicit, черновик OAuth 2.1 его удаляет.
:::

::: details Что такое BFF и почему его рекомендуют для SPA
Backend for Frontend — серверный компонент на том же site, который выступает конфиденциальным OAuth-клиентом: получает и хранит токены, проксирует запросы к API, а браузеру отдаёт только `HttpOnly`-cookie сессии. RFC 10017 (август 2026) называет его самой безопасной из трёх архитектур и настоятельно рекомендует для приложений с персональными и бизнес-данными. Главный довод: XSS в браузерном клиенте может не красть токены, а запустить новый тихий flow и получить свои — от этого спасает только отсутствие токенов в браузере. Цена — свой сервер, прокси для каждого запроса и обязательная защита от CSRF. В Nuxt BFF получается почти бесплатно: Nitro и есть этот сервер.
:::

::: details Защищает ли middleware Nuxt или guard Vue Router данные пользователя
Нет. Они решают, какую страницу показать: при SSR — что отрендерить, в браузере — куда перейти. Чанк страницы скачивается напрямую, а `server/api` route middleware вообще не видит: это Nitro, отдельный механизм. Каждый обработчик API проверяет сессию сам или через `server/middleware`. Ещё две ловушки: middleware начальной страницы выполняется и на сервере, и при гидрации (повторный запрос `/api/me`), а на сервере для внешнего API cookie нужно передать вручную через `useRequestHeaders(['cookie'])`.
:::

::: details Чем passkeys лучше пароля с одноразовым кодом
Passkey — ключевая пара WebAuthn, привязанная к домену сайта. Браузер не предложит ключ `bank.com` на фишинговом `bank-login.com`, и подписанный origin проверяет сервер, поэтому фишинг не работает на уровне протокола. OTP фишится: пользователь вводит код на поддельной странице, и прокси атакующего тут же использует его. Сервер хранит только публичный ключ, утечка базы ничего не даёт. Passkeys синхронизируются между устройствами, а conditional mediation показывает их в автозаполнении. Слабые места — восстановление доступа при потере устройств (обычно сводится к email) и то, что это вход, а не защита сессии после него: украденную cookie passkey не спасает.
:::

## Задачи

### 1. Найти ошибки в работе с JWT · легко

```js
// login
const { token } = await api.post('/login', creds)
localStorage.setItem('token', token)

// guard
const payload = JSON.parse(atob(token.split('.')[1]))
if (payload.role === 'admin') showAdminPanel()

// server
const payload = jwt.verify(token, PUBLIC_KEY) // library accepts the alg from the token header
if (payload) next()
```

::: details Решение и разбор
1. **`localStorage`.** Долгоживущий токен унесёт любой XSS или скомпрометированная зависимость и будет пользоваться им со своей машины. Лучше cookie `HttpOnly` от BFF или access-токен в памяти с коротким сроком.
2. **`atob` без замены алфавита.** base64url использует `-` и `_`, без padding: `atob` бросит `InvalidCharacterError` на части токенов. Кириллица в payload сломается без `TextDecoder`.
3. **Роль из payload как решение.** Это допустимо для показа панели, но данные панели сервер обязан отдавать только после своей проверки роли. Роль в токене к тому же устаревает до `exp`.
4. **Алгоритм из заголовка токена.** Атака подменой алгоритма: токен с `alg: HS256`, подписанный публичным ключом как HMAC-секретом, пройдёт проверку. Нужен явный список: `jwt.verify(token, key, { algorithms: ['RS256'], issuer, audience })`.
5. **Нет проверки `aud` и `iss`.** Токен, выданный тем же провайдером для другого приложения, будет принят.
:::

### 2. Single-flight refresh при параллельных 401 · средне

Страница одновременно делает пять запросов, access-токен истёк, все пять получают `401`. Сервер ротирует refresh-токен: повторное использование отзывает сессию. Напишите `authFetch(input, init)`, который обновляет токен **один раз**, повторяет запросы с новым токеном и не зацикливается.

::: details Решение и разбор
```js
let accessToken = null
let refreshing = null // shared promise: the single flight

function refreshOnce() {
  refreshing ??= fetch('/auth/refresh', { method: 'POST', credentials: 'include' })
    .then((res) => {
      if (!res.ok) throw new Error('Session expired')
      return res.json()
    })
    .then(({ access_token }) => (accessToken = access_token))
    .finally(() => { refreshing = null })
  return refreshing
}

function withAuth(init = {}, token = accessToken) {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return { ...init, headers }
}

export async function authFetch(input, init) {
  const usedToken = accessToken
  const res = await fetch(input, withAuth(init, usedToken))
  if (res.status !== 401) return res

  // Another request may have refreshed already while this one was in flight.
  if (accessToken === usedToken) await refreshOnce()
  return fetch(input, withAuth(init)) // retried once: a second 401 goes to the caller
}
```

Разбор:

- Все пять запросов ждут **один** промис `refreshing` — сервер увидит один обмен refresh-токена. `finally` сбрасывает промис, и следующее истечение снова вызовет обновление.
- Проверка `accessToken === usedToken` нужна для запроса, который получил `401` уже после обновления: его отправили со старым токеном, а новый уже есть — повторять обновление нельзя, это лишняя ротация.
- Повтор ровно один: если и с новым токеном `401` (права отозваны), ответ уходит вызывающему, без бесконечного цикла. Неудачное обновление — ошибка у всех ожидающих, по ней приложение уходит на `/login`.
- Тело запроса — поток: `ReadableStream` в `init.body` второй раз не отправить. Для повтора тело должно быть строкой, `Blob` или `FormData`.
- Между вкладками этот промис не общий — задача 4. В BFF задача исчезает: обновлением занимается сервер.

Сложность: O(1) обновлений на любое число параллельных запросов.
:::

### 3. PKCE: верификатор и challenge · средне

Напишите `createPkcePair()`, который возвращает `{ verifier, challenge }` по RFC 7636 для метода `S256`, и объясните, где хранить `verifier` между редиректом и возвратом.

::: details Решение и разбор
```js
function base64url(bytes) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function createPkcePair() {
  // 32 random bytes -> 43 base64url characters: the minimum length the RFC allows
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}
```

Проверка по тестовому вектору из приложения B RFC 7636: для `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` challenge равен `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM` (проверено в Node 26).

`verifier` кладут в `sessionStorage` вместе с `state`: он переживает редирект на провайдера и обратно в той же вкладке, но не виден другим вкладкам, а значит, параллельный вход во второй вкладке не перепутает пары. После обмена кода значения удаляют. `Math.random()` не годится — нужен криптостойкий генератор. Метод `plain` (challenge = verifier) не используют: он не защищает, если `/authorize`-запрос утёк.

Сложность: O(1).
:::

### 4. Обновление токена в нескольких вкладках · средне

Access-токен в памяти каждой вкладки, refresh-токен — в `HttpOnly`-cookie и ротируется. Две вкладки одновременно получили `401` и обе отправили `/auth/refresh` с одной cookie: вторая получила отказ, сервер отозвал сессию. Исправьте `refreshOnce` из задачи 2.

::: details Решение и разбор
```js
const channel = new BroadcastChannel('auth')
let accessToken = null
let refreshing = null

channel.onmessage = (e) => {
  if (e.data.type === 'token') accessToken = e.data.accessToken
}

function refreshOnce(staleToken) {
  refreshing ??= navigator.locks
    .request('auth-refresh', async () => {
      // While we waited for the lock, another tab may have refreshed and broadcast a token.
      if (accessToken && accessToken !== staleToken) return accessToken
      const res = await fetch('/auth/refresh', { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error('Session expired')
      const { access_token } = await res.json()
      accessToken = access_token
      channel.postMessage({ type: 'token', accessToken })
      return accessToken
    })
    .finally(() => { refreshing = null })
  return refreshing
}
```

Разбор:

- `navigator.locks.request` — эксклюзивная блокировка в пределах origin: обмен refresh-токена выполняет одна вкладка за раз. Блокировка снимается, когда промис колбэка завершился или вкладка закрылась.
- Вторая вкладка входит в блокировку после первой и видит новый токен, пришедший по `BroadcastChannel`. Поэтому повторного обмена не будет. Сравнивают с токеном, с которым запрос получил `401`.
- Отправка access-токена в канал расширяет его видимость на все вкладки. Альтернатива без этого — второй вкладке после блокировки сделать обмен заново: cookie уже новая, это не повтор.
- Даже с блокировкой бывают гонки (вкладка уснула посередине обмена), поэтому серверы держат короткое окно, в котором предыдущий refresh-токен ещё принимается.
- BFF снимает задачу целиком: токены у сервера, вкладки делят одну cookie.
:::

### 5. Аутентификация для Nuxt-приложения с внешним провайдером · сложно

Nuxt 4, вход через корпоративный OIDC-провайдер, данные — во внешнем API `https://api.example.com`, которое принимает access-токены провайдера. Страницы `/account/**` рендерятся на сервере, есть кэшируемый публичный каталог. Сейчас SPA хранит токены в `localStorage`. Спроектируйте замену и объясните, где какие проверки.

::: details Решение и разбор
**Архитектура — BFF на Nitro.** Nuxt-сервер — конфиденциальный OIDC-клиент с секретом. `/auth/login` генерирует `state`, `nonce` и PKCE, сохраняет их в короткой cookie и редиректит на провайдера. `/auth/callback` сверяет `state`, обменивает код с `code_verifier` и секретом, проверяет ID-токен (подпись, `iss`, `aud`, `nonce`, `exp`). Токены провайдера кладутся в серверное хранилище сессий (Redis), браузер получает `__Host-Http-session` (`Secure; HttpOnly; SameSite=Lax`, без `Domain`). `Lax`, а не `Strict`: возврат от провайдера — cross-site навигация, а пользователь, пришедший по ссылке из почты, должен быть залогинен.

**Доступ к API.** Браузер ходит только на `/api/**` своего origin. Серверные маршруты находят сессию, при необходимости обновляют access-токен (single-flight на сессию на сервере) и проксируют на фиксированный upstream с `Authorization: Bearer`. Токены не попадают ни в браузер, ни в payload, CORS не нужен.

**Проверки:**

- `server/middleware` или `requireUserSession` в каждом обработчике `/api/**` — настоящая авторизация; внешний API проверяет токен ещё раз.
- CSRF: `Sec-Fetch-Site` с fallback на `Origin` на изменяющих методах (см. [CSRF, clickjacking и supply chain](./csrf-and-clickjacking.md)), проверка `Content-Type: application/json`.
- Route middleware `auth` на `/account/**` — только UX: при SSR редирект на `/auth/login?redirect=…` без отрисовки чужой страницы, на клиенте — переход. `redirect` проверяется: только внутренний путь.
- SSR: `useFetch('/api/me')` пробрасывает cookie на свой маршрут сам. `/account/**` не кэшируется (`swr`/`isr` только для каталога), ответ — `Cache-Control: private, no-store`.

**Выход:** `POST /auth/logout` удаляет серверную сессию, отзывает refresh-токен у провайдера (RFC 7009), чистит cookie, рассылает `BroadcastChannel`-сигнал. Для выхода у провайдера — RP-initiated logout с `id_token_hint`.

**Миграция:** при первом заходе новой версии удалить `localStorage.token`; старые refresh-токены отозвать на стороне провайдера.

**Что остаётся открытым:** XSS по-прежнему действует от имени пользователя, пока он на странице, — поэтому строгая CSP (см. [Content Security Policy](./csp.md)). Кражу cookie с диска закрывает DBSC там, где он есть. Вход можно усилить passkeys на стороне провайдера.
:::

## Источники

- [IETF: RFC 6749, The OAuth 2.0 Authorization Framework](https://www.rfc-editor.org/rfc/rfc6749)
- [IETF: RFC 9700, Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)
- [IETF: RFC 7636, Proof Key for Code Exchange (PKCE)](https://www.rfc-editor.org/rfc/rfc7636)
- [IETF: RFC 10017, OAuth 2.0 for Browser-Based Applications](https://www.rfc-editor.org/rfc/rfc10017)
- [IETF: The OAuth 2.1 Authorization Framework (draft-ietf-oauth-v2-1-17, сверено 2026-11-12)](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/)
- [IETF: RFC 7519, JSON Web Token (JWT)](https://www.rfc-editor.org/rfc/rfc7519), [RFC 8725, JWT Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725)
- [IETF: RFC 7009, Token Revocation](https://www.rfc-editor.org/rfc/rfc7009), [RFC 7662, Token Introspection](https://www.rfc-editor.org/rfc/rfc7662), [RFC 9449, DPoP](https://www.rfc-editor.org/rfc/rfc9449)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html), [RP-Initiated Logout 1.0](https://openid.net/specs/openid-connect-rpinitiated-1_0.html)
- [W3C: Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/)
- [IETF: RFC 6265bis, Cookies: HTTP State Management Mechanism (префиксы `__Host-`, `__Host-Http-`)](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/)
- [OWASP: Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [MDN: Web Authentication API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API), [`PublicKeyCredential.getClientCapabilities()`](https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredential/getClientCapabilities_static), [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API), [Set-Cookie: cookie prefixes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#cookie_prefixes)
- [Vue Router: Navigation Guards](https://router.vuejs.org/guide/advanced/navigation-guards.html)
- [Nuxt: route middleware](https://nuxt.com/docs/4.x/directory-structure/app/middleware), [`useRequestFetch`](https://nuxt.com/docs/4.x/api/composables/use-request-fetch), [`useRequestHeaders`](https://nuxt.com/docs/4.x/api/composables/use-request-headers), [server middleware](https://nuxt.com/docs/4.x/directory-structure/server#server-middleware)
- [nuxt-auth-utils](https://github.com/atinux/nuxt-auth-utils)
- [Google: Protecting cookies with Device Bound Session Credentials](https://blog.google/security/protecting-cookies-with-device-bound-session-credentials/)
