---
title: Хранилища браузера
level: ядро
---

# Хранилища браузера

> **Коротко.** У браузера несколько хранилищ, и выбирают их по трём осям: синхронность, объём и кто имеет доступ. **Cookies** маленькие и сами едут на сервер с каждым запросом. **`localStorage`/`sessionStorage`** синхронные, только строки и около 5 млн символов, а в воркерах их нет. **IndexedDB** асинхронная, транзакционная, хранит структурированные данные на сотни мегабайт и доступна из воркеров. **Cache API** хранит пары запрос–ответ, **OPFS** — файлы. Всё, кроме cookies, изолировано по origin, делит одну квоту и вытесняется целиком. Во встроенных cross-site iframe хранилища дополнительно разделены по сайту верхнего уровня (партиционирование).

**Связанные темы:** [Same-origin policy, CORS и cookies](./cors-and-cookies.md), [HTTP-кэширование и CDN](./caching.md), [Web Workers, Service Workers и PWA](../browser/workers.md), [Event loop](../javascript/event-loop.md), [Промисы](../javascript/promises.md), [Функциональные приёмы и иммутабельность](../javascript/functional-programming.md)

## Теория

### Карта хранилищ

| | Cookies | `localStorage` | `sessionStorage` | IndexedDB | Cache API | OPFS |
| --- | --- | --- | --- | --- | --- | --- |
| Данные | строка | строки | строки | structured clone: объекты, `Date`, `Map`, `Blob`, `ArrayBuffer` | `Request` → `Response` | файлы (байты) |
| Объём | ~4 КБ на cookie | ~5 млн символов на origin | столько же, на вкладку | доля диска (квота origin) | квота origin | квота origin |
| API | `document.cookie`, `Set-Cookie`, Cookie Store API | синхронный | синхронный | асинхронный, события | промисы | промисы; синхронный в dedicated worker |
| Воркеры | нет (`cookieStore` — в Service Worker) | нет | нет | да | да | да |
| Уходит на сервер | да, в каждом запросе | нет | нет | нет | нет | нет |
| Живёт | до `Expires`/`Max-Age` или конца сессии | пока не удалят | пока жива вкладка | пока не удалят или не вытеснят | так же | так же |

Граница у всех, кроме cookies, — **origin** (схема, хост, порт). Cookies живут по своим правилам: хост и путь без порта, `SameSite` по site (см. [Same-origin policy, CORS и cookies](./cors-and-cookies.md)). В терминах WHATWG Storage Standard данные origin лежат в **storage bucket** (корзине) под **storage key** — ключом, который при партиционировании включает и сайт верхнего уровня. Корзина подчиняется общей квоте, и вытесняют её целиком: IndexedDB, Cache API и OPFS одного origin пропадают одновременно, а не по частям.

### Web Storage: `localStorage` и `sessionStorage`

Интерфейс `Storage` описан в HTML Living Standard. Это словарь «строка → строка» с методами `getItem`, `setItem`, `removeItem`, `clear`, `key(i)` и свойством `length`.

**Только строки.** Значение приводится через `String()`. Проверено в Chromium 157: `setItem('o', { a: 1 })` хранит `"[object Object]"`, `setItem('n', null)` — строку `"null"`, `setItem('u', undefined)` — `"undefined"`. Отсутствующий ключ даёт `null` из `getItem`, но `undefined` при обращении как к свойству (`localStorage.missing`). Структуры сериализуют через `JSON.stringify`, а значит, теряют `Date` (станет строкой), `Map`, `Set`, `undefined` и циклические ссылки.

**Синхронность — главный недостаток.** `getItem` возвращает значение сразу, поэтому браузер держит копию данных origin в памяти процесса страницы и подгружает её с диска при первом обращении. Первый `localStorage.getItem` на холодной странице может заблокировать главный поток на чтение диска, а большой `setItem` — на сериализацию. Отсюда два следствия: в воркерах Web Storage нет (синхронный общий API не совместим с потоками), и большие данные туда не кладут.

**Квота.** Спецификация не задаёт число. На практике около 5 МиБ на origin, MDN называет «до 5 МиБ» для каждого из двух хранилищ. Проверено в Chromium 157: `QuotaExceededError` (это `DOMException`) наступил примерно на 5,24 млн символов — сумме длин ключей и значений, и для латиницы, и для кириллицы. То есть считаются символы UTF-16, а не байты UTF-8, и строка из кириллицы влезает не вдвое меньшая. У `sessionStorage` в той же вкладке — отдельные ~5 МиБ.

**`sessionStorage`** — та же модель, но хранилище принадлежит паре «вкладка + origin». Оно переживает перезагрузку и восстановление вкладки, но не закрытие. Две вкладки одного сайта видят разные `sessionStorage`. Новая вкладка получает копию в двух случаях: при дублировании вкладки и при `window.open` с сохранённым `opener`. Копия независима. Проверено в Chromium 157: после `window.open('/page')` popup видит значение открывшей вкладки, его изменения в ней не видны. А `window.open(url, '_blank', 'noopener')` и обычная ссылка `target="_blank"` (в современных браузерах она неявно `noopener`) дают пустое хранилище.

> [!WARNING]
> Web Storage недоступен в opaque origin. В `<iframe sandbox="allow-scripts">` без `allow-same-origin` даже чтение `localStorage.length` бросает `SecurityError` (проверено в Chromium 157). Так же он может бросить при отключённых cookies и сайт-данных в настройках браузера. Поэтому обращение к хранилищу оборачивают в `try/catch`, а не только запись.

### Событие `storage` и синхронизация вкладок

Когда `localStorage` меняется, браузер отправляет событие `storage` во **все другие** окна того же origin (и того же партиционного ключа). Поля события: `key`, `oldValue`, `newValue`, `url` (страница, сделавшая изменение) и `storageArea`. Проверено в Chromium 157:

- вкладка, которая сделала запись, событие **не получает**;
- `setItem` с тем же значением, что уже лежит, события не порождает, как и `removeItem` несуществующего ключа;
- после `clear()` приходит одно событие с `key === null`;
- запись в `sessionStorage` в другие вкладки события не шлёт: их `sessionStorage` — другое хранилище. Событие получают только окна с тем же хранилищем, то есть same-origin iframe внутри той же вкладки.

Первое правило делает `storage` удобным транспортом между вкладками без эха. Второе — ловушка: сообщение «выйти» через `setItem('logout', '1')` сработает один раз. Во второй раз значение то же, и события не будет, поэтому пишут уникальное значение (`Date.now()`).

Для обмена сообщениями есть специальный API — **`BroadcastChannel`**. `new BroadcastChannel('auth')` в каждой вкладке, `postMessage(data)` копирует данные через structured clone всем остальным экземплярам канала с тем же именем в пределах origin, включая воркеры. Отправитель своё сообщение не получает, другой экземпляр того же канала в той же странице — получает. Функцию отправить нельзя: `DataCloneError` (проверено в Chromium 157). Хранить ничего не нужно, и вкладка, открытая позже, прошлых сообщений не увидит.

> [!TIP]
> Когда из нескольких вкладок должна работать одна (держать WebSocket, синхронизировать данные), нужен «лидер». Его выбирают через Web Locks API: `navigator.locks.request('leader', () => new Promise(() => {}))`. Вкладка держит блокировку, пока жива, а когда закрывается, блокировка переходит следующей в очереди.

### IndexedDB

IndexedDB (W3C Indexed Database API, 3.0 — рабочий черновик) — транзакционная база «ключ → значение» на стороне браузера. Устройство:

- **база** с целочисленной **версией**; схема меняется только в `upgradeneeded` при открытии с большей версией;
- **object store** — аналог таблицы: ключ — путь в объекте (`keyPath`) или автоинкремент;
- **индексы** по полям — для поиска и диапазонов (`IDBKeyRange`), курсоры для обхода;
- значения хранятся через **structured clone**: `Date`, `Map`, `Blob`, `File`, typed arrays сохраняются как есть (проверено в Chromium 157: `Date` и `Map` вернулись своими типами). Функции, DOM-узлы и `Proxy` дают `DataCloneError` — в том числе `reactive`-объект Vue (см. [Функциональные приёмы и иммутабельность](../javascript/functional-programming.md)).

API старше промисов: запрос (`IDBRequest`) сообщает о результате событиями `success`/`error`. Поэтому почти всегда используют тонкую обёртку (`idb` Джейка Арчибальда) или собственный промисификатор.

**Транзакция живёт, пока на неё есть запросы.** Транзакция активна в задаче, где её создали, и в колбэках её запросов. Когда задача завершилась, а запросов в очереди нет, она **автоматически коммитится**. Любой следующий запрос бросает `TransactionInactiveError`. Отсюда главная ловушка с `async/await`. Проверено в Chromium 157:

- `await` промиса, который резолвится в `onsuccess` запроса, — работает: продолжение выполняется микрозадачей, пока транзакция ещё активна;
- `await null` до первого запроса — работает: микрозадачи выполняются до конца задачи;
- `await fetch(...)` или `await` таймера внутри транзакции — `TransactionInactiveError`: к моменту продолжения задача закончилась, и транзакция закоммичена.

Правило: сначала собрать все данные (сеть, вычисления), потом открыть транзакцию и выполнить в ней только запросы к базе. Модель задач и микрозадач — в [Event loop](../javascript/event-loop.md).

**Версии и несколько вкладок.** Открытая вкладка держит соединение со старой версией. Когда новая вкладка открывает базу с большей версией, старое соединение получает `versionchange`. Если оно не закрылось, новая вкладка получает `blocked` и ждёт. Проверено в Chromium 157: `versionchange 1→2` → `blocked` → после `db.close()` → `upgradeneeded` → `success`. Поэтому в `onversionchange` закрывают соединение и предлагают перезагрузить страницу, иначе после деплоя новая версия приложения зависнет на открытии базы.

### Cache API и OPFS

**Cache API** (`caches.open(name)`) хранит пары `Request` → `Response`, доступен со страницы и из воркеров и чаще всего работает в Service Worker. Заголовки кэширования он игнорирует, срока жизни у записей нет — подробно в [Web Workers, Service Workers и PWA](../browser/workers.md#cache-api-против-http-кэша).

**OPFS** (Origin Private File System, File System Standard) — приватная файловая система origin. Пользователь её не видит, разрешений она не требует. Вход: `navigator.storage.getDirectory()`, затем `getFileHandle`, `createWritable`, `getFile`. Отличие от остальных хранилищ — `createSyncAccessHandle()`: синхронные чтение и запись по смещению, быстрые и без копий. Он есть только в dedicated worker: в главном потоке метода нет (проверено в Chromium 157: `typeof` — `'undefined'`). На OPFS работают SQLite, скомпилированный в WebAssembly, и подобные базы.

### Квоты, вытеснение и `persist()`

IndexedDB, Cache API и OPFS делят одну квоту origin. Цифры по MDN (сверено 2026-11-12):

| Браузер | Квота origin | Особенности |
| --- | --- | --- |
| Chromium | до 60% объёма диска | всем origin вместе — до 80% |
| Firefox | best-effort: меньшее из 10% диска и 10 ГиБ; persistent — до 50% диска | при `persist()` спрашивает пользователя |
| Safari 17+ | около 60% диска для браузера | cross-origin iframe — около 1/10 квоты родителя |

Квота считается от **размера диска, а не от свободного места**, чтобы её нельзя было использовать для fingerprinting. Поэтому место может кончиться раньше квоты. `navigator.storage.estimate()` возвращает `{ usage, quota }`, но это оценки: размер cross-origin ответов в Cache API намеренно завышается, чтобы по `usage` нельзя было узнать размер чужого ресурса. При переполнении запись падает с `QuotaExceededError`.

**Режимы.** По умолчанию корзина **best-effort**: при нехватке места браузер вытесняет данные origin, которыми давно не пользовались (LRU), целиком. `navigator.storage.persist()` просит режим **persistent**: тогда данные удаляет только пользователь. Chromium и Safari решают без запроса, по вовлечённости пользователя (установленное PWA, закладка, частые визиты). Firefox показывает запрос. В свежем профиле Chromium 157 `persist()` вернул `false`. Это нормально: результат нужно проверять, а не предполагать.

> [!WARNING]
> Safari с включённой защитой от трекинга (по умолчанию) удаляет всё, что сайт записал скриптом (IndexedDB, `localStorage`, Cache API, Service Worker), если на сайте не было взаимодействия пользователя последние 7 дней использования браузера. Cookies, поставленные сервером, не трогаются. Для офлайн-приложения на iOS это значит: данные в браузере — кэш, а не единственная копия. Установленное на домашний экран PWA под это правило не попадает.

### Партиционирование хранилищ

Раньше iframe `widget.example` на сайтах `a.com` и `b.com` видел один и тот же `localStorage` — идеальный канал для слежки между сайтами. Теперь хранилища cross-site iframe разделены по **сайту верхнего уровня**. Ключ — пара «origin ресурса + top-level site». В Chromium (с версии 115) в ключе есть ещё «ancestor bit» — признак cross-site предка в цепочке фреймов. Разделены: Web Storage, IndexedDB, Cache API, OPFS, Storage Buckets, `BroadcastChannel`, `SharedWorker`, Web Locks, Service Workers, зарегистрированные из стороннего контекста, и blob URL. Firefox разделяет состояние по умолчанию с версии 103 (State Partitioning), Safari — тоже.

Проверено в Chromium 157: iframe `b.test` внутри `a.test` пишет в `localStorage` — открытая напрямую `b.test` этого не видит, и наоборот. `BroadcastChannel` между ними тоже молчит.

Последствия для практики:
- Виджет (чат, плеер, авторизация) во фрейме не делит состояние с собственным сайтом. «Залогинен на `widget.com` — значит, залогинен в виджете» больше не работает без Storage Access API (`document.requestStorageAccess()` по жесту пользователя).
- Синхронизация вкладок через `storage`/`BroadcastChannel` внутри iframe работает только между копиями фрейма на одном и том же сайте верхнего уровня.
- Квота сторонних фреймов меньше (в Safari — около десятой части родительской).

> [!WARNING]
> Playwright по умолчанию запускает Chromium с `--disable-features=ThirdPartyStoragePartitioning`. Из-за этого e2e-тест встроенного виджета проходит, хотя у пользователя в Chrome тот же сценарий сломан. Проверено на `playwright-core` 1.56: без этого флага партиционирование в тесте включается.

### SSR: хранилищ нет на сервере

Код `<script setup>` в Nuxt выполняется дважды: на сервере при рендеринге HTML и в браузере при гидратации. На сервере нет `window`, `localStorage`, `IndexedDB`: `localStorage.getItem` в setup падает с `ReferenceError` при SSR. Если обойти это проверкой `import.meta.client`, получится расхождение гидратации: сервер отрисовал `'light'`, клиент прочитал `'dark'`, разметка не совпала. Варианты:

- **`useCookie`** — когда значение нужно уже при рендеринге (тема, язык, валюта). Сервер читает cookie из запроса и рисует правильный HTML, клиент получает то же значение, и гидратация совпадает. Именно этот вариант документация Nuxt даёт для темы. Цена — cookie едет в каждом запросе, поэтому данные должны быть маленькими.
- **`onMounted`** — когда значение влияет только на поведение или его можно показать после загрузки. Сервер и первая отрисовка клиента используют значение по умолчанию, затем `onMounted` читает хранилище. Минус — видимое «мигание».
- **`<ClientOnly>`** с `#fallback` — для блока, который целиком зависит от браузерного состояния.

`useState` в Nuxt — состояние, общее для SSR и клиента в пределах одного рендеринга (передаётся в payload). Оно не сохраняется между визитами, это не замена `localStorage`.

### Где хранить токены

Мостик в раздел «Безопасность». Всё, что доступно JavaScript (`localStorage`, `sessionStorage`, IndexedDB, не-`HttpOnly` cookie), прочитает любой скрипт, который выполнился на странице: XSS или скомпрометированная зависимость унесёт долгоживущий токен, и злоумышленник будет пользоваться им со своей машины. Распространённая схема: короткий access-токен в памяти (переменная, не хранилище), refresh-токен или сессия — в cookie `HttpOnly; Secure; SameSite=Lax` (или `Strict`) на своём домене. Цена cookie — защита от CSRF (`SameSite`, проверка `Origin`). `HttpOnly` не спасает от XSS полностью: скрипт всё равно отправит запрос от имени пользователя, пока тот на странице. Он лишь не даёт унести учётные данные.

## Примеры

```ts
// Safe JSON wrapper around Web Storage: storage access can throw on read and write.
export function readJSON<T>(storage: Storage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback; // SecurityError, malformed JSON
  }
}

export function writeJSON(storage: Storage, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') return false;
    throw e;
  }
}
```

```js
// Minimal promise wrapper for IndexedDB.
const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

function openDB() {
  const r = indexedDB.open('app', 2);
  r.onupgradeneeded = (e) => {
    const db = r.result;
    if (e.oldVersion < 1) db.createObjectStore('drafts', { keyPath: 'id' });
    // Schema changes are allowed only here, inside the versionchange transaction.
    if (e.oldVersion < 2) r.transaction.objectStore('drafts').createIndex('byUpdated', 'updatedAt');
  };
  r.onblocked = () => console.warn('Close other tabs to upgrade the database');
  return req(r).then((db) => {
    db.onversionchange = () => db.close(); // let a newer tab upgrade
    return db;
  });
}

const db = await openDB();
const tx = db.transaction('drafts', 'readwrite');
await req(tx.objectStore('drafts').put({ id: 1, text: 'hi', updatedAt: Date.now() }));
```

```ts
// Nuxt 4: theme known on the server, no hydration mismatch.
const theme = useCookie<'light' | 'dark'>('theme', {
  default: () => 'light',
  maxAge: 60 * 60 * 24 * 365,
  sameSite: 'lax',
});
useHead({ htmlAttrs: { 'data-theme': theme } });
```

```js
// Storage estimate and persistence.
const { usage, quota } = await navigator.storage.estimate(); // estimates, padded
const persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
```

## Вопросы с интервью

::: details Сравните cookies, localStorage, sessionStorage и IndexedDB
Cookies — до ~4 КБ, автоматически уходят на сервер в каждом запросе к домену и поэтому годятся для сессии и данных, нужных серверу при рендеринге. Могут быть `HttpOnly`, то есть недоступны JS. `localStorage` — синхронный словарь строк на ~5 млн символов, живёт бессрочно, общий для всех вкладок origin, недоступен в воркерах. `sessionStorage` — то же, но на вкладку: переживает перезагрузку, умирает с вкладкой, копируется только при дублировании или `window.open` с opener. IndexedDB — асинхронная транзакционная база со structured clone, индексами и квотой в доли диска, доступна в воркерах. Для маленьких настроек — `localStorage`, для данных приложения, офлайна и бинарных данных — IndexedDB, для серверного состояния — cookies.
:::

::: details Почему не стоит хранить много данных в localStorage
API синхронный: браузер держит копию данных origin в памяти процесса страницы и при первом обращении читает её с диска, блокируя главный поток. Запись большого значения сериализуется тоже синхронно. Хранятся только строки, поэтому каждый раз — `JSON.stringify`/`parse` всего значения, без частичных обновлений, индексов и транзакций. Квота — около 5 млн символов UTF-16, при переполнении `QuotaExceededError`. Из воркера достать данные нельзя. Для больших или структурированных данных — IndexedDB (можно из воркера), для файлов — OPFS.
:::

::: details Как синхронизировать состояние между вкладками
Три механизма. Событие `storage`: при записи в `localStorage` все **другие** вкладки origin получают `key`, `oldValue`, `newValue`. Вкладка-автор его не получает, запись того же значения события не даёт, поэтому для команд пишут уникальное значение. `BroadcastChannel` — канал сообщений со structured clone, ничего не хранит, отправитель своё сообщение не получает, работает и с воркерами. `SharedWorker` — общий воркер, через который вкладки обмениваются и держат одно соединение. Если должна работать одна вкладка (WebSocket, синхронизация), лидера выбирают через Web Locks. Ограничения: всё это в пределах origin, а во фреймах — ещё и в пределах сайта верхнего уровня (партиционирование).
:::

::: details Как браузер решает, когда удалить данные сайта
У origin есть квота от размера диска: в Chromium до 60% диска, в Firefox в режиме best-effort — меньшее из 10% и 10 ГиБ. При нехватке места браузер вытесняет best-effort данные наименее недавно использованных origin, целиком: IndexedDB, Cache API и OPFS вместе. `navigator.storage.persist()` переводит origin в persistent-режим, и тогда удалить данные может только пользователь. Chromium и Safari решают без запроса по вовлечённости, Firefox спрашивает. Отдельно Safari удаляет записанные скриптом данные сайта, с которым не взаимодействовали 7 дней. Вывод: клиентское хранилище — кэш, и приложение должно уметь восстановиться с сервера. `estimate()` даёт лишь оценку с намеренным завышением.
:::

::: details Что такое партиционирование хранилищ и что оно ломает
Хранилища cross-site iframe разделены по сайту верхнего уровня: ключ — «origin фрейма + top-level site» (в Chromium плюс ancestor bit). Iframe `widget.com` на `a.com` и на `b.com` получает два разных `localStorage`, IndexedDB, Cache API, `BroadcastChannel`, Service Worker. Так браузеры закрыли слежку через общее хранилище стороннего фрейма. В Chromium это с версии 115, Firefox и Safari тоже разделяют. Ломается всё, что рассчитывало на общее состояние виджета с его собственным сайтом: логин, синхронизация между фреймами на разных сайтах. Легальный путь — Storage Access API по жесту пользователя или не жить в стороннем контексте. Ловушка тестов: Playwright по умолчанию выключает партиционирование.
:::

::: details Почему localStorage нельзя читать в setup при SSR
Setup выполняется на сервере, а там нет `window` и `localStorage`: будет `ReferenceError`. Если завернуть в `import.meta.client`, сервер отрисует значение по умолчанию, клиент — сохранённое, и разметка разойдётся: hydration mismatch. Vue предупредит и исправит текст, но несовпавшие атрибуты и классы при гидратации не исправляет. Если значение нужно в HTML (тема, язык) — хранить его в cookie через `useCookie`: сервер читает его из запроса и рисует правильно. Если нет — читать в `onMounted` или прятать блок в `<ClientOnly>`, смирившись с «миганием».
:::

::: details Где хранить токен доступа на клиенте
Всё, что видит JavaScript, видит и XSS. Токен в `localStorage` злоумышленник унесёт и будет использовать вне браузера до истечения срока. Распространённый компромисс: сессия или refresh-токен — в cookie `HttpOnly; Secure; SameSite=Lax`, короткий access-токен — в памяти, обновляется по refresh. Цена cookie — нужна защита от CSRF (`SameSite`, проверка `Origin`/`Sec-Fetch-Site`). `HttpOnly` не делает XSS безопасным: пока пользователь на странице, скрипт отправит запросы от его имени. Но сократить срок и место кражи — уже выигрыш. Для API на другом домене ещё проще — same-origin прокси, тогда cookie первосторонняя.
:::

::: details Как живёт транзакция IndexedDB и что ломает async/await
Транзакция активна в задаче, где её создали, и в колбэках своих запросов. Когда задача кончилась, а невыполненных запросов нет, она автоматически коммитится, и следующий запрос бросает `TransactionInactiveError`. `await` промиса, который резолвится в `onsuccess`, безопасен: продолжение выполняется микрозадачей, пока транзакция ещё активна. Но `await fetch()` или таймера внутри транзакции её закрывает. Поэтому сеть и вычисления — до транзакции, внутри — только запросы к базе. Явный `tx.commit()` позволяет закоммитить раньше, не дожидаясь автокоммита.
:::

## Задачи

### 1. Какие события увидит вторая вкладка · легко

Две вкладки `https://app.example.com`. В вкладке A:

```js
addEventListener('storage', (e) => console.log('A', e.key, e.newValue));
```

Затем в вкладке B, где `localStorage.theme` уже `'dark'`:

```js
addEventListener('storage', (e) => console.log('B', e.key));
localStorage.setItem('theme', 'dark');
localStorage.setItem('lang', 'ru');
localStorage.removeItem('missing');
sessionStorage.setItem('draft', 'x');
localStorage.clear();
```

Что выведется и где?

::: details Решение и разбор
Только в A:

```
A lang ru
A null null
```

- `theme` уже `'dark'` — значение не изменилось, события нет.
- `lang` — новое значение, событие во **все другие** вкладки origin.
- `removeItem` несуществующего ключа ничего не меняет — события нет.
- `sessionStorage` у вкладки свой: A его не разделяет, событие не уходит.
- `clear()` — одно событие с `key`, `oldValue`, `newValue`, равными `null`.

B не выводит ничего: автор изменения событие не получает. Поведение проверено в Chromium 157.
:::

### 2. Composable `useLocalStorage` · средне

Напишите для Vue 3.5 `useLocalStorage<T>(key, initial)`, который возвращает `Ref<T>`, сохраняет изменения (включая вложенные) в `localStorage`, подхватывает изменения из других вкладок и не ломает SSR и гидратацию в Nuxt.

::: details Решение и разбор
```ts
import { ref, watch, onMounted, onBeforeUnmount, type Ref } from 'vue';

export function useLocalStorage<T>(key: string, initial: T): Ref<T> {
  const state = ref(initial) as Ref<T>; // SSR and first client render use `initial`

  const read = () => {
    try {
      const raw = localStorage.getItem(key);
      state.value = raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      state.value = initial;
    }
  };

  const onStorage = (e: StorageEvent) => {
    if (e.storageArea !== localStorage) return;
    if (e.key === key || e.key === null) read(); // null = clear()
  };

  onMounted(() => {
    read();
    addEventListener('storage', onStorage);
  });
  onBeforeUnmount(() => removeEventListener('storage', onStorage));

  watch(state, (value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // QuotaExceededError or storage disabled: keep the in-memory value
    }
  }, { deep: true });

  return state;
}
```

Разбор:
- **SSR.** Хранилище читается в `onMounted`, который на сервере не вызывается. Сервер и первая отрисовка клиента показывают `initial`, гидратация совпадает, затем значение обновляется («мигание»). Если значение нужно в HTML, правильнее `useCookie`.
- **Нет пинг-понга.** Событие из другой вкладки → `read()` → `watch` записывает то же значение обратно. `setItem` с тем же значением события не порождает, поэтому цикла между вкладками нет. Это верно, пока `JSON.stringify` даёт ту же строку, что пришла.
- **Вложенные изменения** ловит `deep: true`. Цена — обход всего значения при каждой проверке, для больших структур это повод уйти в IndexedDB.
- **Лишняя запись при монтировании.** `read()` в `onMounted` присваивает `state.value`, и `watch` один раз записывает значение обратно. Если ключа не было, в хранилище появится `initial`. Обычно это безвредно, но если важно, чтение можно пометить флагом и пропустить эту запись.
- Альтернатива для проекта — `useStorage` из VueUse: те же идеи плюс сериализаторы и SSR-опции.
:::

### 3. Почему черновик не сохраняется · средне

Функция сохраняет черновик в IndexedDB и иногда бросает `TransactionInactiveError`. Найдите причину и исправьте.

```js
async function saveDraft(db, draft) {
  const tx = db.transaction('drafts', 'readwrite');
  const store = tx.objectStore('drafts');
  const prev = await req(store.get(draft.id));
  const { version } = await fetch(`/api/drafts/${draft.id}/version`).then((r) => r.json());
  await req(store.put({ ...prev, ...draft, version }));
}
```

::: details Решение и разбор
`await req(store.get(...))` безопасен: промис резолвится в `onsuccess`, продолжение — микрозадача, транзакция ещё активна. А `await fetch(...)` ждёт сетевую задачу. Пока она идёт, текущая задача заканчивается, запросов в транзакции нет, и она автоматически коммитится. `store.put` после этого бросает `TransactionInactiveError` (проверено в Chromium 157). «Иногда» — потому что при ошибке сети исключение падает раньше.

```js
async function saveDraft(db, draft) {
  // 1. Everything that is not IndexedDB happens before the transaction.
  const { version } = await fetch(`/api/drafts/${draft.id}/version`).then((r) => r.json());

  // 2. One transaction, only database requests inside.
  const tx = db.transaction('drafts', 'readwrite');
  const store = tx.objectStore('drafts');
  const prev = await req(store.get(draft.id));
  store.put({ ...prev, ...draft, version });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
```

Ожидание `complete`, а не `success` у `put`, гарантирует, что данные действительно записаны: `success` запроса ещё не значит, что транзакция не откатится. Если `draft` — `reactive`-объект Vue, `put` бросит `DataCloneError`. Нужен `toRaw` для плоского объекта или `structuredClone(toRaw(...))` / JSON-копия для вложенного.
:::

### 4. Выход во всех вкладках · средне

Пользователь нажал «Выйти» в одной вкладке. Остальные вкладки приложения должны сразу перейти на `/login`. Предложите реализацию и объясните ограничения.

::: details Решение и разбор
```js
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('auth') : null;

export function broadcastLogout() {
  if (channel) channel.postMessage({ type: 'logout' });
  else localStorage.setItem('auth:logout', String(Date.now())); // fallback via storage event
}

function onLogout() {
  location.assign('/login');
}

channel?.addEventListener('message', (e) => {
  if (e.data?.type === 'logout') onLogout();
});
addEventListener('storage', (e) => {
  if (e.key === 'auth:logout') onLogout();
});

// In the logout handler of the current tab:
await fetch('/api/logout', { method: 'POST' }); // server clears the HttpOnly cookie
broadcastLogout();
onLogout(); // the sender does not receive its own message
```

Разбор:
- Отправитель своё сообщение не получает ни через `BroadcastChannel`, ни через `storage`, поэтому текущая вкладка уходит сама.
- В запасном пути значение уникальное (`Date.now()`): повторная запись того же значения события не даст, и второй выход за сессию не дошёл бы.
- Сообщение — только сигнал. Источник истины — сервер: сессия должна быть отозвана на нём, иначе спящая вкладка, которая не получила сообщение, продолжит работать с cookie. Вкладки, открытые позже, проверят сессию при загрузке.
- Если приложение работает во фрейме на чужом сайте, сообщения доходят только до копий фрейма на том же сайте верхнего уровня (партиционирование).
:::

## Источники

- [HTML Living Standard: Web Storage](https://html.spec.whatwg.org/multipage/webstorage.html)
- [HTML Living Standard: Broadcasting to other browsing contexts (BroadcastChannel)](https://html.spec.whatwg.org/multipage/web-messaging.html#broadcasting-to-other-browsing-contexts)
- [WHATWG Storage Standard](https://storage.spec.whatwg.org/)
- [W3C Indexed Database API 3.0](https://www.w3.org/TR/IndexedDB/)
- [Service Workers: Cache API](https://w3c.github.io/ServiceWorker/#cache-objects)
- [WHATWG File System Standard (OPFS)](https://fs.spec.whatwg.org/)
- [W3C Web Locks API](https://w3c.github.io/web-locks/)
- [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [MDN: Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
- [MDN: Window: storage event](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event)
- [MDN: Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [MDN: Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [MDN: State Partitioning (Firefox)](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/State_Partitioning)
- [privacysandbox.google.com: Storage partitioning](https://privacysandbox.google.com/cookies/storage-partitioning)
- [web.dev: Storage for the web](https://web.dev/articles/storage-for-the-web)
- [web.dev: Persistent storage](https://web.dev/articles/persistent-storage)
- [WebKit: Full Third-Party Cookie Blocking and More (7-day cap)](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)
- [Nuxt: useCookie](https://nuxt.com/docs/4.x/api/composables/use-cookie)
- [Nuxt: Hydration best practices](https://nuxt.com/docs/4.x/guide/best-practices/hydration)
- [Playwright: chromiumSwitches.ts (disabled features)](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts)
- [idb — IndexedDB with promises](https://github.com/jakearchibald/idb)
