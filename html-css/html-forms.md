---
title: HTML-формы и нативная валидация
level: ядро
---

# HTML-формы и нативная валидация

> **Коротко.** Отправка формы — алгоритм спецификации: проверка ограничений (её пропускают `novalidate` и `form.submit()`), событие `submit`, сборка набора данных с событием `formdata`, кодирование по `method` и `enctype`, навигация. В набор попадают только поля с `name`, без `disabled`, а checkbox и radio — только отмеченные. `<button>` без `type` — это кнопка отправки, и Enter в поле «нажимает» первую из них. Нативная валидация — `ValidityState` на каждом поле. Флаги считаются из атрибутов (`required`, `pattern`, `min`/`max`/`step`, `minlength`) и из `setCustomValidity`. `checkValidity` и `reportValidity` запускают эти проверки из кода. Для стилей ошибок есть `:user-invalid`: он срабатывает, когда пользователь уже взаимодействовал с полем, а `:invalid` — сразу при загрузке.

**Связанные темы:** [Формы и валидация](../vue/forms-and-validation.md), [Семантический HTML и мультимедиа](./semantic-html.md), [События](../browser/events.md), [DOM API и observers](../browser/dom.md), [UI-coding: базовые компоненты на Vue](../live-coding/ui-components.md), [CSRF, clickjacking и supply chain](../security/csrf-and-clickjacking.md), [Same-origin policy, CORS и cookies](../network/cors-and-cookies.md), [Аутентификация на фронтенде](../security/authentication.md)

## Теория

Фрагменты проверены в Chromium 159 (Playwright 1.65, headless) на локальном Node-сервере, который печатал полученные запросы: URL, `Content-Type`, тело. Vue-примеры — на Vue 3.5.45 в том же браузере. Спецификация — HTML Living Standard (forms, form submission, constraint validation, autofill, custom elements), сверено 2026-11-22. Поддержка в браузерах — по MDN browser-compat-data 8.1.10 (2026-11-19).

### Алгоритм отправки

Форму отправляют кнопка, Enter в поле, `form.requestSubmit()` или `form.submit()`. Все пути ведут в один алгоритм **form submission**, но с разными флагами:

1. Если отправка **не** из `submit()` и у формы нет `novalidate` (а у кнопки — `formnovalidate`): **interactively validate the constraints**. Каждое неверное поле получает событие `invalid`. Если хоть одно поле неверно, отправка прекращается.
2. Если отправка не из `submit()`: событие **`submit`** (`SubmitEvent`, всплывает, отменяемо). В `event.submitter` лежит нажатая кнопка или `null`. `preventDefault()` отменяет отправку — так работает `@submit.prevent`. Проверено: с пустым `required`-полем `requestSubmit()` дал только `invalid`, а `submit()` ушёл на сервер с `?q=` без события `submit`.
3. **Сборка набора данных** (constructing the entry list). В конце на форме срабатывает событие `formdata`, и обработчик может дописать поля в `event.formData`. Событие приходит **и** при `submit()`.
4. Выбор URL, метода и кодировки: атрибуты кнопки `formaction`, `formmethod`, `formenctype`, `formtarget` перекрывают атрибуты формы.
5. Навигация: `GET` записывает данные в query string, `POST` — в тело запроса. `method="dialog"` вместо запроса закрывает `<dialog>`.

### Что попадает в набор данных

Алгоритм обходит **связанные с формой** (form-associated) элементы в порядке дерева и пропускает:

| Элемент | В наборе? |
| --- | --- |
| поле без `name` | нет (кроме `<input type="image">`) |
| `disabled`, в том числе внутри `<fieldset disabled>` | нет, но поля в первом `<legend>` такого `<fieldset>` не отключаются |
| `readonly` | **да** |
| checkbox / radio без `checked` | нет, ключа нет совсем |
| checkbox с `checked` без `value` | `name=on` |
| `<select multiple>` | пара на каждую выбранную `<option>` |
| кнопки | только та, что отправила форму (`submitter`) |
| `<input type="file">` без файлов | пустой файл `filename=""` |
| `<output>` | нет: элемент не submittable |
| поле вне `<form>` с атрибутом `form="id"` | да |

Проверено одной формой: тело запроса — `b=2&d=on&e=yes&s=x&s=y&inlegend=L&sp=a+b%26c&btn=go`. Поле `disabled` и поле без `name` выпали, `readonly` осталось. Неотмеченный checkbox не попал в тело. Вторая кнопка тоже не попала: форму отправила первая. Поле в легенде `<fieldset disabled>` отправилось (`inlegend=L`), поле ниже — нет.

> [!WARNING]
> Неотмеченный checkbox не отправляет `false` — его просто нет. Сервер должен трактовать «ключа нет» как «не отмечено». Иначе снятие галочки в форме настроек не сохранится. Отсюда приём со скрытым полем: `<input type="hidden" name="news" value="0">` перед checkbox с тем же `name`. Для повторяющихся имён сервер должен брать последнее значение.

### Кодирование: `method` и `enctype`

- **`GET`** заменяет query string в `action` целиком: `action="/echo?keep=1"` дал запрос `/echo?n=a`, параметр `keep` пропал.
- **`application/x-www-form-urlencoded`** (по умолчанию): пробел → `+`, остальное процентно в UTF-8 (`a b+c=д&` → `a+b%2Bc%3D%D0%B4%26`). Файл передаётся только именем.
- **`multipart/form-data`** — единственный способ отправить содержимое файла. Пустой файл уходит частью с `filename=""` и `Content-Type: application/octet-stream`.
- **`text/plain`** — строки `name=value\r\n` без экранирования. Сервер не может отличить `=` в значении от разделителя. Формат нужен, по сути, только атакующему: такой запрос считается «простым» для CORS (см. «[CSRF, clickjacking и supply chain](../security/csrf-and-clickjacking.md)»).
- `method` бывает только `get`, `post` и `dialog`. `method="put"` — invalid value, и `form.method` вернул `"get"`. Для `PUT`/`DELETE` нужен `fetch`.

### `submit()`, `requestSubmit()` и `FormData`

`form.submit()` — старый API. Он не проверяет ограничения и не отправляет событие `submit`: ваш обработчик с `preventDefault()` и аналитикой просто не вызовется. `form.requestSubmit(submitter?)` ведёт себя как нажатие кнопки: валидация, `submit` с `event.submitter`, данные кнопки в наборе. Чужой `submitter` даёт `NotFoundError` («not owned by this form element»), а элемент, который не является кнопкой отправки, — `TypeError`.

`new FormData(form)` запускает тот же алгоритм сборки, поэтому тоже вызывает `formdata`: строки, которые дописал обработчик, появились и в `new FormData(form)`. Второй аргумент `new FormData(form, submitter)` добавляет данные кнопки (Chrome 112, Firefox 111, Safari 16.4). `Object.fromEntries(fd)` теряет повторяющиеся ключи, для них нужен `fd.getAll(name)`.

### `<button>` и неявная отправка

У `<button>` три состояния `type`: `submit`, `reset`, `button`. Missing value default и invalid value default — `submit`: `document.createElement('button').type` и `type="foo"` дали `"submit"`. Поэтому кнопка «удалить тег» или «показать пароль» внутри формы её отправляет. Пишите `type="button"` у каждой кнопки, которая не отправляет форму.

**Implicit submission** — Enter в текстовом поле:

- Если у формы есть **default button** — первая кнопка отправки в порядке дерева, — браузер отправляет на неё событие `click`. Её обработчик срабатывает, и она же становится `submitter`. Если default button `disabled`, форма не отправляется вовсе. Проверено: в форме `<input>`, `<button>Add</button>`, `<button>Save</button>` Enter в поле вызвал `click` на **Add**, `submitter.id === 'add'` — частый баг «Enter добавляет пустой элемент».
- Если кнопки отправки нет, форма отправляется, только когда в ней **не больше одного** поля, блокирующего неявную отправку (`text`, `email`, `password`, `number`, `date` и т. п.). Одно поле — отправка ушла, два поля без кнопки — нет. Checkbox поле-блокатор не считается.
- В `<textarea>` Enter вставляет перевод строки.

> [!NOTE]
> Если обработчик `click` синхронно удаляет кнопку из формы, отправки не будет. Активация кнопки выполняется после всех обработчиков, и к этому моменту у кнопки уже нет формы-владельца. Во Vue кнопка `@click="remove(i)"` из `v-for` внутри `<form @submit.prevent>` не вызвала `save`: перерисовка в microtask после обработчика успела убрать кнопку. Кнопка «добавить», которая остаётся на месте, `save` вызвала. Баг то проявляется, то нет, а лечится одинаково — `type="button"`.

### Связь полей с формой

- **Владелец формы** (form owner) — ближайший предок `<form>` или форма из атрибута `form="id"`. `form.elements` — живая коллекция связанных элементов. В ней есть `<fieldset>`, `<output>`, form-associated custom elements, но нет `<input type="image">`.
- **Named access.** `form.elements.email` и `form.email` возвращают поле по `name` или `id`. Поле `<input name="submit">` перекрыло метод: `f.submit` стал элементом, а `f.submit()` упал с `f.submit is not a function`. Так же ломаются `action`, `method`, `reset`. Выход — не использовать такие имена или вызвать `HTMLFormElement.prototype.submit.call(form)`.
- **`<label>`.** Явная связь — `for="id"`. Неявная — поле внутри `<label>`: подпись получает **первый** labelable-потомок, а второй `<input>` в той же метке остался без подписи (`labels.length === 0`). Клик по метке активирует поле: checkbox переключается, текстовое поле получает фокус. Метка — это и доступное имя, и область клика (на мобильном она больше маленького checkbox). `input.labels` — список всех меток поля.
- **`<fieldset>` + `<legend>`** группируют поля. Легенда становится доступным именем группы, `disabled` на `<fieldset>` отключает группу целиком. Это естественная разметка для radio-группы.

### `<select>`, `<datalist>`, `<output>`

- **`<select required>`** с первой `<option value="">` (placeholder label option) даёт `valueMissing`, пока выбрана она. Сообщение — «Please select an item in the list».
- **`<datalist>`** — подсказки, а не ограничение. `<input list="id">` предлагает варианты, но принимает любой ввод. Проверять «значение из списка» придётся самим.
- **`<output for="a b">`** — результат вычисления. `for` — `DOMTokenList` id полей-источников, и скринридер объявит изменение значения: у `<output>` неявная роль `status`. В набор данных не попадает, валидации не подлежит (`willValidate === false`). `reset()` возвращает его к `defaultValue` — исходному тексту.

### Тип поля, автозаполнение и клавиатура

`type` у `<input>` задаёт сразу несколько вещей: модель значения (`number` и `date` хранят строку, но с `valueAsNumber` и `valueAsDate`), встроенную проверку (`email`, `url` → `typeMismatch`), виджет (календарь, color picker) и экранную клавиатуру. Регистр не важен: `type="Email"` → `email`. Неизвестный тип становится `text`.

| Атрибут | Что даёт | Значения |
| --- | --- | --- |
| `inputmode` | только клавиатуру, без проверки и смены модели | `none`, `text`, `decimal`, `numeric`, `tel`, `search`, `email`, `url` |
| `enterkeyhint` | подпись клавиши Enter на экранной клавиатуре | `enter`, `done`, `go`, `next`, `previous`, `search`, `send` |
| `autocomplete` | подсказку автозаполнению, что это за поле | токены: `email`, `username`, `current-password`, `new-password`, `one-time-code`, `tel`, `postal-code`, `cc-number`… |

`autocomplete` — не флаг «включить/выключить», а список токенов: необязательный `section-*`, затем `shipping`/`billing`, затем `home`/`work`/`mobile` (для контактов), затем имя поля и `webauthn`. `autocomplete="shipping street-address"` отразился в `input.autocomplete` как есть. Неизвестное значение (`"nonsense"`) дало пустую строку. `new-password` подсказывает менеджеру паролей сгенерировать пароль, `one-time-code` — подставить код из SMS.

> [!WARNING]
> `autocomplete="off"` не гарантирует, что браузер не подставит значение. По MDN многие браузеры игнорируют его для полей логина и пароля, чтобы работали менеджеры паролей. Отключать автозаполнение входа почти всегда ошибка, правильный ход — точные токены.

**`type="number"` — для количеств, а не для «цифр».** Номер карты, PIN, индекс, телефон — это строки: ведущие нули важны, стрелки-счётчики и `e` с `-` не нужны. Для них подходит `type="text"` с `inputmode="numeric"`, `autocomplete="cc-number"` и при желании `pattern="[0-9 ]*"`. У `type="number"` при вводе `1e` значение — `""`, флаг `badInput`, а `valueAsNumber` — `NaN`: из JS нельзя отличить «пусто» от «ввели мусор» иначе как через `validity.badInput`. Буквы Chromium в такое поле не пропустил.

### Constraint Validation API

Каждый **кандидат на проверку** имеет `validity` (`ValidityState`) и `validationMessage`. Из проверки исключены (barred, `willValidate === false`): `disabled`, `readonly`, `type="hidden"`, кнопки `reset` и `button`, `<output>`, `<fieldset>`, потомки `<datalist>`. Проверено: `required` вместе с `readonly` поле **не** проверяет.

| Флаг | Источник | Пример |
| --- | --- | --- |
| `valueMissing` | `required` | пусто; radio-группа без выбора — у всех радио группы |
| `typeMismatch` | `type="email"`, `url` | `not-an-email`, `example.com` для `url` |
| `patternMismatch` | `pattern` | см. ниже |
| `tooShort` / `tooLong` | `minlength` / `maxlength` | только после ввода пользователем |
| `rangeUnderflow` / `rangeOverflow` | `min` / `max` | `11` при `max="10"`, дата раньше `min` |
| `stepMismatch` | `step` (база — `min`) | `4` при `min="1" step="2"`: «ближайшие 3 и 5» |
| `badInput` | браузер не смог разобрать ввод | `1e` в `type="number"` |
| `customError` | `setCustomValidity(msg)` | «Логин занят» |

`valid === true`, когда все флаги ложны. Детали, которые спрашивают:

- **`pattern`** компилируется как `^(?:pattern)$` с флагом **`v`** и проверяется только у непустого значения. Отсюда два следствия. `pattern="[a-z]+|\d+"` отверг `abc1`: якоря охватывают всю альтернативу, частичных совпадений нет. А `pattern="[\w-]+"` — синтаксическая ошибка в режиме `v` (`-` в классе нужно экранировать), и браузер **молча игнорирует** атрибут: значение `!!` прошло проверку, только в консоли появилось предупреждение. `[\w\-]+` работает.
- **`minlength`/`maxlength`** проверяются по dirty-флагу: только для значения, которое изменил пользователь. Значение `abc` при `minlength="8"`, выставленное скриптом (в том числе через `v-model`), дало `tooShort === false` и `checkValidity() === true`. После ввода двух символов руками — `tooShort === true`. `maxlength` не даёт пользователю ввести лишнее, но скриптовое значение длиннее лимита не обрезает и не делает неверным.
- **`setCustomValidity(msg)`** держит `customError`, пока его не сбросят вызовом `setCustomValidity('')`. Изменение значения флаг не снимает. Это частый баг: «поле навсегда красное».
- **`checkValidity()`** у поля или формы возвращает boolean и отправляет `invalid` каждому неверному полю. **`reportValidity()`** вдобавок показывает сообщение браузера и переводит фокус. `invalid` не всплывает (`bubbles: false`) и отменяем, поэтому ловить его делегированием на форме можно только в capture-фазе.
- **`preventDefault()` на `invalid`** отключает показ встроенного пузыря и фокус на поле, но отправку **не** разрешает. Проверено: форма не ушла, фокус остался на кнопке. Так подменяют пузырь своим сообщением.
- **`novalidate`** отключает только интерактивную проверку при отправке. API продолжает работать: `checkValidity()` вернул `false` и под `novalidate`. `formnovalidate` на кнопке «Сохранить черновик» отключает проверку для одной кнопки.

Сообщения браузера пишутся на языке браузера, а не страницы, и стилизовать их нельзя. Это главная причина ставить `novalidate` и показывать ошибки самим. Атрибуты при этом остаются источником правил, а `validity` — готовым движком проверки. Как это сочетается со схемами и `v-model` — в «[Формах и валидации](../vue/forms-and-validation.md#нативная-constraint-validation)».

### `:invalid` против `:user-invalid`

`:invalid` совпадает с любым неверным кандидатом сразу: пустое `required`-поле красное, пока пользователь его даже не видел. `:user-invalid` (и `:user-valid`) из Selectors 4 учитывают флаг **user validity**. Флаг ставится, когда пользователь изменил значение и ушёл с поля или когда форму попытались отправить. Сбрасывается он при `reset()`.

Проверено в Chromium 159:

| Действие | `:invalid` | `:user-invalid` |
| --- | --- | --- |
| пустое `required`, загрузка страницы | да | нет |
| фокус и blur без ввода | да | нет |
| ввод `x` в `type="email"`, фокус ещё в поле | да | нет |
| тот же ввод, затем blur | да | **да** |
| клик по кнопке отправки или `requestSubmit()` | да | **да** у всех неверных полей |
| `reportValidity()` | да | нет |
| `form.reset()` | — | нет |

Поддержка `:user-invalid`: Chrome 119, Firefox 88, Safari 16.5. Это ровно правило «показывать ошибку поздно» без строчки JS. Форма из «Форм и валидации» реализует то же вручную, когда нужны свои сообщения.

### Form-associated custom elements

Свой элемент становится полем формы через `static formAssociated = true` и `this.attachInternals()`. `ElementInternals` дают:

- `setFormValue(value)` — значение для набора данных (строка, `File` или `FormData`);
- `setValidity(flags, message, anchor)` — тот же `ValidityState`; `anchor` — элемент, на который браузер переведёт фокус;
- колбэки `formAssociatedCallback`, `formResetCallback`, `formDisabledCallback` (с `<fieldset disabled>` тоже), `formStateRestoreCallback`;
- `internals.form`, `internals.labels`, `internals.states` (`CustomStateSet` для `:state(...)`).

Проверено: `<rating-input name="rating" required>` попал в `form.elements` и в `FormData` (`rating=4`), совпал с `:invalid`, заблокировал отправку и получил фокус при неудаче. После `fieldset.disabled = true` элемент выпал из набора, `reset()` вызвал `formResetCallback`. `:user-invalid` после неудачной отправки на нём **не** совпал (в Chromium 159), поэтому стиль ошибки для своего поля задают через `:state(...)` или атрибут. Поддержка: Chrome 77, Firefox 98, Safari 16.4.

## Примеры

### Регистрация на нативном API: свои сообщения, правила в атрибутах

```html
<form id="signup" action="/api/signup" method="post" novalidate>
  <label for="email">Email</label>
  <input id="email" name="email" type="email" required autocomplete="email"
         aria-describedby="email-error">
  <p id="email-error" class="error" hidden></p>

  <label for="password">Password</label>
  <input id="password" name="password" type="password" required minlength="8"
         autocomplete="new-password" aria-describedby="password-error">
  <p id="password-error" class="error" hidden></p>

  <label for="confirm">Repeat password</label>
  <input id="confirm" type="password" autocomplete="new-password"
         aria-describedby="confirm-error"> <!-- no name: not sent -->
  <p id="confirm-error" class="error" hidden></p>

  <button type="button" id="toggle">Show password</button>
  <button>Sign up</button>
</form>
```

```js
const form = document.getElementById('signup');
// Submit buttons are validation candidates too, so filter by tag
const isField = (el) => el.willValidate && el.matches('input, select, textarea');

function messageFor(el) {
  const v = el.validity;
  if (v.valueMissing) return 'Required field';
  if (v.typeMismatch) return 'Enter a valid email';
  if (v.tooShort) return `At least ${el.minLength} characters`;
  if (v.customError) return el.validationMessage;
  return '';
}

function show(el) {
  const out = document.getElementById(`${el.id}-error`);
  out.textContent = messageFor(el);
  out.hidden = el.validity.valid;
  el.setAttribute('aria-invalid', String(!el.validity.valid)); // '' would mean false
}

// Cross-field rule lives in the same engine via customError
function syncConfirm() {
  const same = form.confirm.value === form.password.value;
  form.confirm.setCustomValidity(same ? '' : 'Passwords do not match');
}

form.addEventListener('input', (e) => {
  syncConfirm();
  for (const el of new Set([e.target, form.confirm])) {
    if (el.matches('[aria-invalid="true"]')) show(el); // clear early
  }
});
form.addEventListener('focusout', (e) => {
  if (isField(e.target)) show(e.target); // show late
});

form.addEventListener('submit', (e) => {
  syncConfirm();
  const fields = [...form.elements].filter(isField);
  fields.forEach(show);
  const firstInvalid = fields.find((el) => !el.validity.valid);
  if (firstInvalid) {
    e.preventDefault();
    firstInvalid.focus();
  }
  // valid: native POST proceeds; or preventDefault() + fetch(form.action, { method: 'POST', body: new FormData(form) })
});
```

- `novalidate` убирает пузырь браузера, а `required`, `type`, `minlength` остаются источником правил: `validity` считает всё сам.
- «Пароли совпадают» — через `setCustomValidity`, поэтому `form.checkValidity()` и `:invalid` учитывают и это правило. Сброс `''` при совпадении обязателен.
- Поле подтверждения без `name` в набор данных не попадает, а кнопка «Show password» с `type="button"` форму не отправляет.
- Ошибка показывается на `focusout`: он всплывает, а `blur` — нет (см. «[События](../browser/events.md)»).
- Правила на клиенте — для удобства пользователя. Сервер проверяет те же данные сам.

> [!WARNING]
> Ошибка, которая появляется на `blur`, сдвигает кнопку. Проверено: фокус ушёл с пустого пароля на `mousedown` по «Sign up», сообщение раздвинуло форму, кнопка опустилась на 71 px, и `mouseup` пришёлся мимо: события `click` не было, форма не отправилась. Резервируйте место под сообщение (`min-height` вместо `hidden`) или показывайте ошибки так, чтобы они не двигали кнопку.

То же во Vue (проверено на 3.5.45): `watch([pwd, confirm], …, { flush: 'post' })` вызывает `confirmEl.value.setCustomValidity(…)`, а `@submit.prevent` проверяет `e.currentTarget.checkValidity()` и фокусирует `form.querySelector(':invalid')`. Пароли `secret123` и `secret12` заблокировали отправку с сообщением «Passwords do not match», совпавшие — отправили `{"password":"secret123"}`.

## Вопросы с интервью

::: details Что происходит между нажатием кнопки отправки и запросом на сервер
Алгоритм form submission. Сначала интерактивная проверка ограничений: событие `invalid` каждому неверному полю, сообщение и фокус на первом из них. Шаг пропускается при `novalidate`, `formnovalidate` и `form.submit()`. Затем отменяемое событие `submit` с `event.submitter`, при `submit()` и оно пропускается. Дальше сборка набора данных в порядке дерева: поля с `name`, без `disabled`, только отмеченные checkbox и radio, только кнопка-submitter. В конце сборки — событие `formdata`, где можно дописать поля. Потом URL, метод и `enctype` (атрибуты кнопки `formaction`/`formmethod`/`formenctype` важнее атрибутов формы) и навигация: `GET` — query string, которая заменяет query в `action`, `POST` — тело.
:::

::: details Почему кнопка внутри формы её отправляет и как работает Enter
У `<button>` значение `type` по умолчанию, как и для неверного значения, — `submit`. Любая кнопка без `type` в форме — кнопка отправки. Enter в текстовом поле — implicit submission. Браузер отправляет `click` на default button, первую кнопку отправки в порядке дерева: срабатывает её обработчик, и она становится `submitter`. Если она `disabled`, отправки нет. Если кнопок отправки нет, форма отправляется по Enter, только когда в ней одно текстовое поле. Поэтому «Добавить» без `type="button"`, стоящая перед «Сохранить», ловит Enter. Решение — `type="button"` у всех вспомогательных кнопок.
:::

::: details Чем form.submit отличается от form.requestSubmit
`submit()` — прямой вход в отправку с флагом «из метода submit»: без проверки ограничений и без события `submit`. Обработчики аналитики, `preventDefault()` и `@submit.prevent` не сработают, но `formdata` при сборке данных придёт. `requestSubmit(submitter)` эквивалентен нажатию кнопки: валидация, событие `submit` с `submitter`, данные кнопки в наборе. Чужой `submitter` даёт `NotFoundError`. Отдельная ловушка: поле `name="submit"` перекрывает метод, и `form.submit()` бросает «is not a function».
:::

::: details Какие поля не попадут на сервер и почему
Поля без `name`. Поля `disabled`, включая потомков `<fieldset disabled>`, кроме первого `<legend>`. Неотмеченные checkbox и radio — ключа нет совсем, а не `false`. Кнопки, кроме нажатой. `<output>`. Поля внутри `<datalist>`. А `readonly` отправляется — в этом его отличие от `disabled`, которое ещё и исключает поле из валидации и фокуса. Если нужно показать значение и отправить его, ставят `readonly`. Если нужен «false» для checkbox, перед ним ставят hidden-поле с тем же `name`, а сервер берёт последнее значение.
:::

::: details Как устроен ValidityState и откуда берутся флаги
У каждого кандидата на проверку есть `validity` с флагами: `valueMissing` (`required`), `typeMismatch` (`email`, `url`), `patternMismatch`, `tooShort`/`tooLong`, `rangeUnderflow`/`rangeOverflow`, `stepMismatch`, `badInput` (ввод не разобран), `customError` (`setCustomValidity`). `valid` — когда все флаги ложны. Кандидаты — все поля, кроме `disabled`, `readonly`, `hidden`, кнопок `button`/`reset`, `<output>`, `<fieldset>` (`willValidate === false`). Тонкости: `pattern` — `^(?:…)$` с флагом `v`, невалидное выражение игнорируется молча. `minlength`/`maxlength` срабатывают только на пользовательский ввод. `customError` живёт до `setCustomValidity('')`.
:::

::: details Чем :user-invalid лучше :invalid для стилей ошибок
`:invalid` совпадает сразу: пустое обязательное поле красное при загрузке, а email — с первого символа. `:user-invalid` смотрит на флаг user validity. Флаг ставится, когда пользователь изменил значение и ушёл с поля, или при попытке отправки, а сбрасывается при `reset()`. Это правило «показывать поздно» без JS. Ограничения: сообщение браузера по-прежнему на языке браузера, а сложную логику (сводку ошибок, серверные ошибки) он не покрывает. Поддержка — Chrome 119, Firefox 88, Safari 16.5.
:::

::: details Зачем novalidate, если нативная валидация есть
`novalidate` отключает только интерактивную часть: пузырь браузера и блокировку отправки. Пузырь не стилизуется, пишет на языке браузера и показывает одну ошибку за раз. API остаётся: `validity`, `checkValidity()`, `setCustomValidity`, `:invalid`. Типичная схема — `novalidate`, правила в атрибутах, на `submit` свой обход полей с сообщениями из `validity` и фокус на первом неверном. Атрибуты `type`, `required`, `autocomplete`, `inputmode` нужны всё равно: клавиатура, автозаполнение, семантика для скринридера.
:::

::: details Как сделать свой компонент полем формы без скрытого input
Form-associated custom element: `static formAssociated = true` и `attachInternals()`. `internals.setFormValue()` кладёт значение в набор данных. `internals.setValidity(flags, message, anchor)` подключает элемент к constraint validation: он блокирует отправку, совпадает с `:invalid`, получает фокус через `anchor`. Колбэки `formResetCallback`, `formDisabledCallback` и `formStateRestoreCallback` повторяют поведение нативных полей. Работает с `<label>`, `<fieldset disabled>`, `form.elements`. Во Vue-компоненте обычно проще обернуть нативный `<input>`. Свой FACE нужен, когда виджет живёт в Shadow DOM или поставляется как Web Component в разные фреймворки.
:::

## Задачи

### 1. Что уйдёт на сервер · легко

```html
<form action="/search" method="get">
  <input name="q" value="vue">
  <input name="page" value="2" disabled>
  <input name="lang" value="ru" readonly>
  <input type="checkbox" name="exact">
  <input type="checkbox" name="safe" checked>
  <select name="tag" multiple>
    <option selected>ssr</option><option>spa</option><option selected>ssg</option>
  </select>
  <button name="sort" value="new">Newest</button>
  <button name="sort" value="top">Top</button>
</form>
```

Пользователь нажал «Top». Какой URL будет запрошен?

::: details Решение и разбор
`/search?q=vue&lang=ru&safe=on&tag=ssr&tag=ssg&sort=top`

`page` выпал как `disabled`, `lang` остался (`readonly` отправляется). `exact` не отмечен — ключа нет. Checkbox без `value` даёт `on`. `<select multiple>` даёт пару на каждую выбранную опцию. Из двух кнопок с одним `name` в набор попала только нажатая. Если бы в `action` стояло `/search?from=nav`, параметр `from` пропал бы: `GET` заменяет query целиком.
:::

### 2. Найдите баг: Enter добавляет пустой тег · легко

```html
<form @submit.prevent="save">
  <input v-model="title" required>
  <input v-model="tag" @keydown.enter.prevent="addTag">
  <button @click="addTag">Add tag</button>
  <button>Save</button>
</form>
```

Enter в поле `title` добавляет пустой тег и не сохраняет форму. Почему?

::: details Решение и разбор
Обе кнопки без `type` — кнопки отправки. Default button — **первая**, «Add tag». Enter в `title` запускает implicit submission: браузер шлёт `click` на «Add tag» (вызывается `addTag` с пустым `tag`). Затем идёт отправка с `submitter` = «Add tag», и `@submit.prevent` вызывает `save` от имени не той кнопки. В Chromium 159 Enter в поле дал `click` на первую кнопку и `event.submitter.id === 'add'`.

Исправление — `type="button"` у «Add tag». Тогда default button — «Save», и Enter в `title` сохраняет форму. Обработчик `@keydown.enter.prevent` на поле `tag` при этом нужен по-прежнему, чтобы Enter там добавлял тег, а не отправлял форму.
:::

### 3. Почему поле всегда неверное · средне

```js
const login = form.elements.login;
login.addEventListener('change', async () => {
  const free = await api.isLoginFree(login.value);
  if (!free) login.setCustomValidity('Login is taken');
});
```

После первого занятого логина форма не отправляется, даже когда пользователь вводит свободный. Найдите баг и предложите исправление.

::: details Решение и разбор
`customError` снимается только вызовом `setCustomValidity('')`, изменение значения его не трогает. Ветки «свободен» нет, флаг висит навсегда.

```js
let seq = 0;
login.addEventListener('input', () => login.setCustomValidity('')); // stale verdict is not valid
login.addEventListener('change', async () => {
  const value = login.value;
  const id = ++seq;
  const free = await api.isLoginFree(value);
  if (id !== seq || value !== login.value) return; // a newer check is running
  login.setCustomValidity(free ? '' : 'Login is taken');
  if (!free) login.reportValidity();
});
```

Второй баг — гонка. Медленный ответ на старое значение может перезаписать свежий вердикт, поэтому ответ сверяется с текущим значением. Пока проверка идёт, поле считается верным. Если это неприемлемо, на `submit` нужно дождаться проверки или запретить отправку (состояние `pending`, см. «[Формы и валидацию](../vue/forms-and-validation.md#асинхронная-проверка-и-гонки)»).
:::

### 4. pattern, который не работает · средне

```html
<input name="slug" pattern="[\w-]+" required>
<input name="code" pattern="\d{4}|[A-Z]{2}">
```

Пользователь ввёл `my slug!` в первое поле и `12345` во второе. Форма отправилась. Почему?

::: details Решение и разбор
`pattern` компилируется как `new RegExp('^(?:' + pattern + ')$', 'v')`. В режиме `v` дефис в классе символов после `\w` — синтаксическая ошибка, и браузер **игнорирует** атрибут: `patternMismatch === false` для любого значения, в консоли только предупреждение. Исправление — `[\w\-]+`.

Со вторым полем всё работает: `^(?:\d{4}|[A-Z]{2})$` отвергает `12345`, `patternMismatch === true`. Отправилось оно, видимо, потому что у формы `novalidate`, или потому что её отправили через `form.submit()`: оба пути пропускают проверку. Значит, нужен ещё вызов `checkValidity()`. Пустое `code` прошло бы в любом случае: `pattern` проверяет только непустое значение, а `required` у поля нет.
:::

### 5. Сверстайте форму оплаты · сложно

Сверстайте блок «Оплата картой»: номер карты, срок (месяц/год), CVC, имя на карте, checkbox «Сохранить карту» и адрес доставки, который скрывается флажком «Совпадает с адресом плательщика». Требования: автозаполнение браузера, цифровая клавиатура на мобильных, флажок отправляется и при снятии, скрытая часть адреса не валидируется и не отправляется.

::: details Решение и разбор
```html
<form action="/api/pay" method="post">
  <fieldset>
    <legend>Card</legend>
    <label>Card number
      <input name="cc-number" autocomplete="cc-number" inputmode="numeric"
             pattern="[0-9 ]{12,23}" required>
    </label>
    <label>Expiry
      <input name="cc-exp" autocomplete="cc-exp" inputmode="numeric"
             placeholder="MM/YY" pattern="(0[1-9]|1[0-2])\/[0-9]{2}" required>
    </label>
    <label>CVC
      <input name="cc-csc" autocomplete="cc-csc" inputmode="numeric"
             pattern="[0-9]{3,4}" required>
    </label>
    <label>Name on card
      <input name="cc-name" autocomplete="cc-name" required>
    </label>
    <input type="hidden" name="save-card" value="0">
    <label><input type="checkbox" name="save-card" value="1"> Save card</label>
  </fieldset>

  <label><input type="checkbox" id="same" checked> Same as billing address</label>
  <fieldset id="shipping" disabled hidden>
    <legend>Shipping address</legend>
    <label>Street
      <input name="ship-street" autocomplete="shipping street-address" required>
    </label>
    <label>Postal code
      <input name="ship-zip" autocomplete="shipping postal-code" required>
    </label>
  </fieldset>

  <button>Pay</button>
</form>
<script>
  same.addEventListener('change', () => {
    shipping.disabled = shipping.hidden = same.checked;
  });
</script>
```

- **Номер карты, срок, CVC** — `type="text"` с `inputmode="numeric"`, а не `type="number"`. Ведущие нули, пробелы и `/` сохраняются, счётчиков-стрелок нет. Токены `cc-*` дают автозаполнение из сохранённых карт.
- **`pattern="…\/…"`** — в режиме `v` экранирование `/` допустимо. Проверка идёт по всей строке, якоря не нужны.
- **«Сохранить карту»** — hidden-поле `0` перед checkbox с тем же `name`. Отмеченный даёт `save-card=0&save-card=1`, и сервер берёт последнее значение.
- **Скрытый адрес** — `<fieldset disabled>`: его поля исключены из валидации (`required` не мешает отправке) и из набора данных. Один `disabled` вместо снятия `required` с каждого поля. Одного `hidden` мало: скрытое `required`-поле блокирует отправку, а показать ошибку браузеру негде (проверено: запрос не ушёл, в консоли «An invalid form control … is not focusable»).
- `shipping` в `autocomplete` разделяет адреса плательщика и доставки при автозаполнении.
- Стили ошибок — через `input:user-invalid`. Данные карты в реальном продукте обычно вводят в iframe платёжного провайдера (см. «[Семантический HTML и мультимедиа](./semantic-html.md)» про `sandbox` и `allow="payment"`).
:::

## Источники

- [HTML Living Standard: Forms](https://html.spec.whatwg.org/multipage/forms.html)
- [HTML Living Standard: Form submission](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#form-submission-2)
- [HTML Living Standard: Constructing the entry list](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constructing-the-form-data-set)
- [HTML Living Standard: Implicit submission](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#implicit-submission)
- [HTML Living Standard: Constraints](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constraints)
- [HTML Living Standard: Autofill](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill)
- [HTML Living Standard: The button element](https://html.spec.whatwg.org/multipage/form-elements.html#the-button-element)
- [HTML Living Standard: The pattern attribute](https://html.spec.whatwg.org/multipage/input.html#the-pattern-attribute)
- [HTML Living Standard: Form-associated custom elements](https://html.spec.whatwg.org/multipage/custom-elements.html#form-associated-custom-elements)
- [HTML Living Standard: inputmode](https://html.spec.whatwg.org/multipage/interaction.html#input-modalities:-the-inputmode-attribute) и [enterkeyhint](https://html.spec.whatwg.org/multipage/interaction.html#input-modalities:-the-enterkeyhint-attribute)
- [Selectors Level 4: :user-valid и :user-invalid](https://drafts.csswg.org/selectors-4/#user-pseudos)
- [MDN: Client-side form validation](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Form_validation)
- [MDN: ValidityState](https://developer.mozilla.org/en-US/docs/Web/API/ValidityState)
- [MDN: HTMLFormElement.requestSubmit()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/requestSubmit)
- [MDN: HTML attribute: autocomplete](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete)
- [MDN: ElementInternals](https://developer.mozilla.org/en-US/docs/Web/API/ElementInternals)
- [MDN browser-compat-data](https://github.com/mdn/browser-compat-data)
- [web.dev: More capable form controls](https://web.dev/articles/more-capable-form-controls)
