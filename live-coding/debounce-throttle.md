---
title: debounce и throttle
level: ядро
---

# debounce и throttle

> **Коротко.** Обе утилиты прореживают частые вызовы функции. **Debounce** откладывает вызов, пока поток вызовов не затихнет на `wait` мс: подходит, когда важен только итог, например поиск по вводу. **Throttle** вызывает функцию не чаще раза в `wait` мс, пока вызовы продолжаются: подходит для промежуточных состояний — прокрутки, перетаскивания, resize. Обе написаны на замыкании и таймере. На интервью проверяют контракт: `this` и аргументы, `leading`/`trailing`, `maxWait`, `cancel`/`flush`, что возвращает обёртка и как обойтись с асинхронной функцией.

**Связанные темы:** [Замыкания](../javascript/closures.md), [Функции и `this`](../javascript/functions-and-this.md), [Event loop](../javascript/event-loop.md), [async/await, обработка ошибок и отмена](../javascript/async-await.md), [Конвейер рендеринга: layout, paint, composite](../browser/rendering-pipeline.md), [Оптимизация runtime и профилирование](../performance/runtime.md), [Производительность Vue и Nuxt](../performance/vue-performance.md)

## Теория

### Контракт debounce

Обёртка запоминает последний вызов и заводит таймер. Каждый новый вызов сдвигает срабатывание. Функция вызывается, когда с последнего вызова прошло `wait` мс. Эталон контракта — `_.debounce` из lodash:

| Опция или метод | По умолчанию | Что делает |
| --- | --- | --- |
| `trailing` | `true` | вызов в конце серии, через `wait` после последнего вызова |
| `leading` | `false` | вызов в начале серии, сразу на первом вызове |
| `maxWait` | нет | серия не откладывает вызов дольше `maxWait`; lodash поднимает его до `wait`, если он меньше |
| `cancel()` | — | сбросить отложенный вызов |
| `flush()` | — | выполнить отложенный вызов сейчас и вернуть результат |
| `pending()` | — | ждёт ли вызов; в lodash 4.17 нет, на интервью его часто просят добавить |

Что важно в контракте:

- **Аргументы и `this` — последнего вызова.** Обёртка — обычная функция, а не стрелка: так она получает `this` от точки вызова (`obj.search()`) и передаёт его через `fn.apply(this, args)`. Стрелочная обёртка взяла бы `this` из места создания.
- **`leading` и `trailing` вместе.** Trailing-вызов происходит, только если за время ожидания обёртку вызвали **ещё раз**. Один клик даёт один вызов, а не два. В документации lodash это оговорено отдельно.
- **Возвращаемое значение — результат предыдущего вызова `fn`.** На момент вызова обёртки функция ещё не выполнялась, поэтому lodash возвращает последний сохранённый результат, а до первого вызова — `undefined`. Ждать результат через `await debounced()` бессмысленно. Если нужен промис результата, это отдельная утилита (задача 6).
- **`wait = 0` не делает вызов синхронным.** Функция выполнится в отдельной задаче таймера, после текущего кода и всех микрозадач.

### Контракт throttle

Throttle вызывает функцию не чаще раза в `wait` мс, пока вызовы продолжаются. В lodash по умолчанию `leading: true` и `trailing: true`: первый вызов срабатывает сразу, последний — в конце окна с **последними** аргументами. Без trailing теряется финальное состояние: прокрутка закончилась, а обработчик видел позицию за 80 мс до конца.

Throttle в lodash — это debounce с `maxWait = wait`:

```js
// lodash 4.17.21, throttle
return debounce(func, wait, { leading, maxWait: wait, trailing });
```

Debounce откладывает вызов, а `maxWait` ограничивает откладывание. Без него бесконечная серия вызовов (пользователь печатает без пауз) не даёт ни одного срабатывания. Типичный случай — автосохранение: debounce 1 с, но не реже раза в 10 с. С `maxWait = wait` функция при непрерывных вызовах срабатывает раз в `wait` мс. Это и есть throttle.

Самописный throttle только на метке времени (`now - last >= wait`) теряет последний вызов серии, а только на таймере (`if (!timer) setTimeout(...)`) задерживает первый. Нужны оба механизма (задача 4).

### Таймеры и кадры: на что опирается реализация

Задержка `setTimeout` — **нижняя граница**, а не гарантия:

- По HTML Standard, если вложенность таймеров больше 5, задержка меньше 4 мс поднимается до 4 мс.
- В фоновых вкладках браузеры ограничивают таймеры: Firefox — не чаще раза в секунду, Chrome — тоже раз в секунду, а после 5 минут скрытой вкладки цепочки таймеров срабатывают раз в минуту (intensive throttling, Chrome 88).
- Таймер не прервёт долгую задачу. Если главный поток занят 300 мс, trailing-вызов произойдёт после неё.
- Задержка больше 2³¹−1 мс (≈24,8 дня) переполняется, и таймер срабатывает сразу.

Поэтому `wait = 300` означает «не раньше чем через 300 мс». Если важен реальный интервал, время меряют через `Date.now()` или `performance.now()`, как делает lodash.

**`requestAnimationFrame`** вызывает колбэк перед следующей отрисовкой, на шаге «update the rendering» цикла событий. Частоту определяют возможности рендеринга (rendering opportunities): обычно это частота экрана. Спецификация допускает падение до 30 кадров в секунду при перегрузке и до 4 или меньше для невидимой страницы. На практике в фоновых вкладках и скрытых iframe колбэки rAF не вызываются совсем. Поэтому rAF подходит для визуальной работы и не подходит для сетевых запросов и сохранения данных.

> [!WARNING]
> На том же шаге «update the rendering», до колбэков rAF, браузер выполняет «run the resize steps» и «run the scroll steps». По стандарту события `resize` и `scroll` и так приходят не чаще раза за кадр. Throttle через rAF не уменьшит их число. Он полезен для событий, которые к кадрам по стандарту не привязаны (`pointermove`, `input`, сообщения из сокета), и чтобы собрать несколько источников в одну запись в DOM за кадр. Chromium выравнивает по кадрам и непрерывный ввод (`pointermove`, `wheel`), но это поведение движка, а не стандарта.

Часто throttle не нужен вовсе, есть API точнее: `ResizeObserver` — размер **элемента**, а не окна; `IntersectionObserver` — видимость и бесконечная прокрутка без обработчика `scroll`; событие `scrollend` — «прокрутка закончилась» без debounce (на MDN — Baseline 2025, newly available с декабря 2025, сверено 2026-11-13); `{ passive: true }` у `touchmove` и `wheel` — браузер прокручивает, не дожидаясь обработчика.

### debounce асинхронной функции

Debounce уменьшает число запросов, но **не устраняет гонку**. Пользователь набрал `ab`, сделал паузу дольше `wait`, ушёл запрос. Затем набрал `abc`, ушёл второй. Если первый ответ придёт позже второго, на экране окажутся результаты для `ab`. Защита — та же, что для любых конкурирующих запросов (подробно в теме [async/await, обработка ошибок и отмена](../javascript/async-await.md)): **отменять предыдущий запрос** через `AbortController` перед отправкой нового и **проверять актуальность** ответа — сравнить номер запроса или сигнал с текущим. Проверка работает, даже если операция сигнал игнорирует.

Обёртка lodash возвращает результат предыдущего вызова, то есть для асинхронной функции — промис **прошлого** запроса. Утилита, которая отдаёт каждому вызывающему промис его собственного результата, разобрана в задаче 6.

### Во Vue

**Создавать debounce один раз на экземпляр.** Состояние утилиты (таймер, аргументы) живёт в замыкании. Поэтому важно, где оно создано:

- в `<script setup>` или `setup()` верхнего уровня — правильно: на каждый экземпляр своя обёртка;
- в `methods` Options API — `methods: { search: debounce(fn, 300) }` создаётся **один раз на определение компонента** и общая для всех экземпляров. Проверено на Vue 3.5.45: два экземпляра вызвали `search` в `created`, сработал только вызов второго. Создавайте обёртку в `created()`: `this.debouncedSearch = debounce(this.search, 300)`;
- в шаблоне — нельзя. `@input="debounce(search, 300)"` компилируется в `$event => debounce(search, 300)`: на каждое событие создаётся обёртка и тут же выбрасывается, `search` не вызывается ни разу. Вариант `debounce(search, 300)($event)` вызывает новую обёртку со своим таймером на каждое событие, и прореживания нет. То же в `computed` и render-функции.

**Отложенный вызов переживает размонтирование.** Watcher, созданный синхронно в `setup`, останавливается при размонтировании, но таймер уже заведён: функция выполнится после того, как компонент исчез. Проверено на Vue 3.5.45 через `effectScope().stop()`. Отменяйте отложенный вызов и запрос в `onScopeDispose` (или `onUnmounted`). И учтите: ошибку, брошенную из таймера, Vue не перехватит, она не попадёт в `app.config.errorHandler` (почему — в теме [Промисы](../javascript/promises.md)).

**`onWatcherCleanup` внутри debounce не работает.** Он должен быть вызван синхронно в колбэке watcher-а, а debounced-функция выполняется позже, из таймера. Vue 3.5.45 выводит предупреждение `onWatcherCleanup() was called when there was no active watcher` и очистку не регистрирует. `AbortController` держат внутри debounced-функции (см. пример ниже).

> [!TIP]
> В VueUse есть готовые `useDebounceFn`, `useThrottleFn`, `refDebounced` и `watchDebounced`: они сами отменяют таймер при размонтировании. Для формы, где хватает значения по уходу из поля, достаточно `v-model.lazy`: синхронизация по `change`, а не по `input`.

## Примеры

Вызовы каждые 10 мс с 0 до 290 мс (аргументы 0…29), `wait = 100`. Все строки проверены фейковыми часами:

| Утилита | Вызовы `fn` (момент → аргумент) |
| --- | --- |
| `debounce` | 390 → 29 |
| `debounce`, `leading: true` | 0 → 0, 390 → 29 |
| `debounce`, `maxWait: 250` | 250 → 24, 390 → 29 |
| `throttle` | 0 → 0, 100 → 9, 200 → 19, 300 → 29 |

```vue
<!-- Search: debounce, abort of the stale request, cleanup on unmount -->
<script setup>
import { ref, watch, onScopeDispose } from 'vue'
import { debounce } from '@/utils/debounce'

const query = ref('')
const results = ref([])
let controller = null

const search = debounce(async (q) => {
  controller?.abort() // the previous response is stale now
  controller = new AbortController()
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
    results.value = await res.json()
  } catch (error) {
    if (error.name !== 'AbortError') throw error
  }
}, 300)

watch(query, (q) => search(q.trim()))

onScopeDispose(() => {
  search.cancel()
  controller?.abort()
})
</script>
```

## Вопросы с интервью

::: details Чем debounce отличается от throttle и как выбрать
Debounce вызывает функцию после паузы в серии вызовов: пока события идут, вызовов нет. Throttle вызывает её не чаще раза в `wait`, пока события идут. Если важен только итог (запрос поиска, сохранение черновика, валидация поля, пересчёт раскладки после resize), нужен debounce. Если нужны промежуточные состояния (позиция прокрутки, перетаскивание, прогресс), нужен throttle. Риск debounce — бесконечный поток вызовов не даёт ни одного срабатывания, его лечит `maxWait`. Риск throttle — лишняя работа, если важен только итог. Throttle — частный случай debounce с `maxWait = wait`, так он и устроен в lodash. Для `scroll` и `resize` иногда не нужен ни тот, ни другой: есть `IntersectionObserver`, `ResizeObserver` и `scrollend`.
:::

::: details Когда срабатывает trailing-вызов при включённых leading и trailing
Только если за время ожидания обёртку вызвали ещё раз. Первый вызов выполняется сразу (leading) и «расходует» свои аргументы. Trailing-вызову нужны новые аргументы, поэтому одиночный клик даёт ровно один вызов. В lodash это видно по коду: `invokeFunc` обнуляет `lastArgs`, а `trailingEdge` вызывает функцию только при `trailing && lastArgs`.
:::

::: details Почему debounce поиска не спасает от гонки ответов
Debounce уменьшает число запросов, но не их порядок. Два запроса с паузой больше `wait` между ними уходят оба, и ответ на первый может прийти последним. Нужна отмена предыдущего запроса (`AbortController`) или проверка актуальности ответа: номер запроса или сигнал совпадает с текущим. Проверка нужна, даже если запрос отменяется, потому что не каждая операция слушает сигнал.
:::

::: details Почему debounce нельзя создавать в шаблоне Vue или в methods Options API
Состояние debounce живёт в замыкании обёртки. В шаблоне выражение выполняется на каждое событие. `@input="debounce(search, 300)"` создаёт обёртку и не вызывает её, а `debounce(search, 300)($event)` вызывает каждый раз новую со своим таймером, и прореживания нет. В `methods` обёртка создаётся один раз на определение компонента и общая для всех экземпляров: вызов из одного экземпляра отменяет вызов из другого. Правильно — создать обёртку в `setup` или в `created()`.
:::

::: details Что произойдёт с отложенным вызовом после размонтирования компонента
Он выполнится. Vue останавливает watcher-ы и эффекты компонента, но не знает про таймер внутри утилиты. Функция отработает на размонтированном компоненте: запишет в его состояние, отправит запрос, а если её ошибка всплывёт, то необработанной. Нужно вызвать `cancel()` и прервать запрос в `onScopeDispose` или `onUnmounted`. Готовые обёртки VueUse делают это сами.
:::

::: details Насколько точен wait и что происходит в фоновой вкладке
`wait` — минимальная задержка. Таймер ждёт освобождения главного потока, вложенные таймеры зажимаются до 4 мс, в фоновой вкладке Chrome и Firefox запускают таймеры не чаще раза в секунду, а Chrome при долгом скрытии — раз в минуту. Колбэки rAF в фоне не вызываются. Поэтому в реализации интервалы считают по `Date.now()`, а не по числу срабатываний. Работу, которая должна завершиться при уходе со страницы (сохранение черновика), делают в `visibilitychange` или через `flush()`, а не надеются на таймер.
:::

## Задачи

### 1. Базовый debounce · легко

Напишите `debounce(fn, wait)`: вызов `fn` через `wait` мс после последнего вызова обёртки, с аргументами и `this` последнего вызова.

::: details Решение и разбор
```js
function debounce(fn, wait) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args); // arrow callback keeps `this` of debounced
    }, wait);
  };
}
```

Обёртка — обычная функция, поэтому `obj.method()` передаёт свой `this`. Колбэк таймера — стрелка, она берёт `this` и `args` из этого вызова. Частые ошибки: стрелочная обёртка (теряется `this`), `setTimeout(fn, wait)` без аргументов, `timer` внутри обёртки (новый на каждый вызов, ничего не отменяется).

Сложность: O(1) по времени и памяти на вызов.
:::

### 2. leading, trailing, cancel и flush · средне

Добавьте опции `{ leading = false, trailing = true }` и методы `cancel()`, `flush()`, `pending()`. Обёртка возвращает результат последнего выполнения `fn`. При `leading` и `trailing` trailing-вызов происходит, только если обёртку вызвали снова.

::: details Решение и разбор
```js
function debounce(fn, wait, { leading = false, trailing = true } = {}) {
  let timer = null;
  let pendingArgs = null, pendingThis = null;
  let result;

  function invoke() {
    const args = pendingArgs;
    const ctx = pendingThis;
    pendingArgs = pendingThis = null; // a trailing call needs fresh args
    result = fn.apply(ctx, args);
    return result;
  }

  function trailingEdge() {
    timer = null;
    if (trailing && pendingArgs) invoke();
    pendingArgs = pendingThis = null;
  }

  function debounced(...args) {
    pendingArgs = args;
    pendingThis = this;
    const isNewBurst = timer === null;
    clearTimeout(timer);
    timer = setTimeout(trailingEdge, wait);
    if (isNewBurst && leading) invoke();
    return result;
  }

  debounced.cancel = () => {
    clearTimeout(timer);
    timer = pendingArgs = pendingThis = null;
  };
  debounced.flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      trailingEdge();
    }
    return result;
  };
  debounced.pending = () => timer !== null;
  return debounced;
}
```

Серия — промежуток, пока таймер заведён. Leading-вызов делается на первом вызове серии, и `invoke` обнуляет `pendingArgs`. Поэтому trailing сработает, только если за серию был ещё вызов. `flush()` без отложенного вызова просто возвращает прошлый результат, как в lodash. С `leading: true, trailing: false` получается «первый клик срабатывает, повторы в течение `wait` игнорируются» — защита от двойной отправки формы.

Сложность: O(1) на вызов.
:::

### 3. maxWait и throttle через debounce · сложно

Добавьте `maxWait`: при непрерывных вызовах `fn` выполняется не реже раза в `maxWait` мс. Затем выразите через него `throttle(fn, wait)`.

::: details Решение и разбор
```js
function debounce(fn, wait = 0, { leading = false, trailing = true, maxWait } = {}) {
  const maxing = maxWait !== undefined;
  if (maxing) maxWait = Math.max(maxWait, wait);
  let timer, lastArgs, lastThis, lastCallTime, result;
  let lastInvokeTime = 0;

  function invoke(time) {
    const args = lastArgs;
    const ctx = lastThis;
    lastArgs = lastThis = undefined;
    lastInvokeTime = time;
    return (result = fn.apply(ctx, args));
  }
  function shouldInvoke(time) {
    if (lastCallTime === undefined) return true;
    const sinceCall = time - lastCallTime;
    return sinceCall >= wait || sinceCall < 0 || (maxing && time - lastInvokeTime >= maxWait);
  }
  function remainingWait(time) {
    const left = wait - (time - lastCallTime);
    return maxing ? Math.min(left, maxWait - (time - lastInvokeTime)) : left;
  }
  function trailingEdge(time) {
    timer = undefined;
    if (trailing && lastArgs) return invoke(time);
    lastArgs = lastThis = undefined;
    return result;
  }
  function onTimer() {
    const time = Date.now();
    if (shouldInvoke(time)) return trailingEdge(time);
    timer = setTimeout(onTimer, remainingWait(time)); // re-arm, do not invoke
  }

  function debounced(...args) {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);
    lastArgs = args;
    lastThis = this;
    lastCallTime = time;
    if (isInvoking) {
      if (timer === undefined) { // leading edge of a new burst
        lastInvokeTime = time;
        timer = setTimeout(onTimer, wait);
        return leading ? invoke(time) : result;
      }
      if (maxing) { // maxWait elapsed inside a burst
        clearTimeout(timer);
        timer = setTimeout(onTimer, wait);
        return invoke(time);
      }
    }
    timer ??= setTimeout(onTimer, wait);
    return result;
  }
  debounced.flush = () => (timer === undefined ? result : trailingEdge(Date.now()));
  return debounced; // cancel(): clear the timer and reset all state, as in task 2
}

const throttle = (fn, wait, { leading = true, trailing = true } = {}) =>
  debounce(fn, wait, { leading, trailing, maxWait: wait });
```

Нужно считать время от последнего **выполнения** (`lastInvokeTime`), а не от последнего вызова (`lastCallTime`). Поэтому таймер один и не переставляется на каждом вызове. Когда он срабатывает, `onTimer` смотрит на часы. Если пауза ещё не набралась и `maxWait` не истёк, таймер заводится на остаток. Если вызовы идут плотнее, чем срабатывает таймер, `maxWait` проверяется прямо в обёртке. Реализация сверена с `_.debounce` из lodash 4.17.21 на 400 случайных сериях вызовов с разными опциями: моменты и аргументы вызовов совпали. Что спросят дальше: почему `maxWait < wait` поднимается до `wait` (иначе throttle срабатывал бы чаще, чем просили), что будет при переводе часов назад (`sinceCall < 0` трактуется как конец серии), чем `Date.now()` хуже `performance.now()` (системные часы можно перевести, монотонные — нет).

Сложность: O(1) на вызов.
:::

### 4. throttle без debounce · средне

Напишите `throttle(fn, wait)`: первый вызов сразу, дальше не чаще раза в `wait` мс, последний вызов серии не теряется и выполняется с последними аргументами.

::: details Решение и разбор
```js
function throttle(fn, wait) {
  let lastInvoke = -Infinity;
  let timer = null;
  let pendingArgs = null, pendingThis = null;

  function invoke(ctx, args) {
    lastInvoke = Date.now();
    fn.apply(ctx, args);
  }

  return function throttled(...args) {
    const remaining = wait - (Date.now() - lastInvoke);
    if (remaining <= 0) {
      clearTimeout(timer); // the timer may be late: the main thread was busy
      timer = pendingArgs = pendingThis = null;
      invoke(this, args);
      return;
    }
    pendingArgs = args; // the trailing call gets the latest arguments
    pendingThis = this;
    timer ??= setTimeout(() => {
      const ctx = pendingThis;
      const latest = pendingArgs;
      timer = pendingArgs = pendingThis = null;
      invoke(ctx, latest);
    }, remaining);
  };
}
```

Метка времени даёт leading-вызов, таймер на остаток окна — trailing. Таймер заводится один раз на окно, а аргументы обновляются на каждом вызове. Поэтому trailing получает последние, а не первые аргументы — самая частая ошибка. `clearTimeout` в ветке `remaining <= 0` нужен, когда таймер опоздал из-за долгой задачи: иначе он выполнится вторым с устаревшими аргументами.

Сложность: O(1) на вызов.
:::

### 5. throttle на requestAnimationFrame · легко

Напишите `rafThrottle(fn)`: не больше одного вызова за кадр, с последними аргументами, и метод `cancel()`.

::: details Решение и разбор
```js
function rafThrottle(fn) {
  let frame = 0;
  let lastArgs, lastThis;

  function throttled(...args) {
    lastArgs = args;
    lastThis = this;
    if (frame) return; // already scheduled for this frame
    frame = requestAnimationFrame(() => {
      frame = 0;
      fn.apply(lastThis, lastArgs);
    });
  }
  throttled.cancel = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  return throttled;
}
```

`requestAnimationFrame` возвращает ненулевой идентификатор, поэтому `0` годится как «ничего не запланировано». Интервал не задаётся: он равен кадру. В фоне колбэки не вызываются, поэтому для запросов и сохранения rAF не годится. Во Vue `cancel()` вызывают в `onUnmounted` вместе с `removeEventListener`.

Сложность: O(1) на вызов.
:::

### 6. Асинхронный debounce с отменой устаревшего запроса · сложно

Напишите `debounceAsync(fn, wait)`. Каждый вызов обёртки возвращает промис. Все вызовы одной серии получают результат одного запуска `fn`. Последним аргументом `fn` получает `AbortSignal`. Когда стартует новый запуск, предыдущий отменяется, и его вызывающие получают `AbortError`, даже если `fn` сигнал игнорирует. Метод `cancel()` отменяет всё.

::: details Решение и разбор
```js
function debounceAsync(fn, wait) {
  let timer = null;
  let callers = [];
  let lastArgs, lastThis;
  let controller = null;

  async function run() {
    timer = null;
    const batch = callers;
    callers = [];
    controller?.abort(); // the previous run is stale now
    const own = (controller = new AbortController());
    try {
      const value = await fn.apply(lastThis, [...lastArgs, own.signal]);
      own.signal.throwIfAborted(); // fn may ignore the signal
      for (const { resolve } of batch) resolve(value);
    } catch (error) {
      for (const { reject } of batch) reject(error);
    } finally {
      if (controller === own) controller = null;
    }
  }

  function debounced(...args) {
    lastArgs = args;
    lastThis = this;
    clearTimeout(timer);
    timer = setTimeout(run, wait);
    return new Promise((resolve, reject) => callers.push({ resolve, reject }));
  }
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
    controller?.abort();
    const reason = new DOMException('Debounced call cancelled', 'AbortError');
    for (const { reject } of callers) reject(reason);
    callers = [];
  };
  return debounced;
}
```

Вызывающие одной серии копятся в `callers` и при запуске уходят в `batch` этого запуска. `throwIfAborted()` после `await` — проверка актуальности: если за время запроса стартовал новый запуск, этот результат не отдаётся, даже когда `fn` не слушала сигнал. Проверено в Node 26: при запросах `ab` и `abc` поздний ответ на `ab` отклоняется с `AbortError`, промис `abc` получает свой ответ. Что спросят дальше: отменять ли запрос уже при новом вызове, а не при новом запуске (тогда пользователь, продолжив печатать, сразу гасит старый запрос); как не терять промисы при `cancel()` (отклонять, а не оставлять вечно висящими); как вызывающему отличить отмену от ошибки (`error.name === 'AbortError'`).

Сложность: O(k) по памяти, где k — число вызовов в серии; O(1) на вызов.
:::

## Источники

- [HTML Standard — Timers](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers)
- [HTML Standard — Event loop processing model («update the rendering»)](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model)
- [HTML Standard — Animation frames](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animation-frames)
- [MDN — `setTimeout()`: причины задержки дольше заданной](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout)
- [MDN — `requestAnimationFrame()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
- [MDN — событие `scrollend`](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollend_event)
- [MDN — `AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [lodash 4.17.21 — `_.debounce`](https://lodash.com/docs/4.17.21#debounce) и [`_.throttle`](https://lodash.com/docs/4.17.21#throttle)
- [lodash 4.17.21 — исходный код](https://github.com/lodash/lodash/blob/4.17.21/lodash.js)
- [Vue — Watchers: очистка побочных эффектов и остановка](https://vuejs.org/guide/essentials/watchers.html)
- [Vue — `onWatcherCleanup()`](https://vuejs.org/api/reactivity-core.html#onwatchercleanup) и [`onScopeDispose()`](https://vuejs.org/api/reactivity-advanced.html#onscopedispose)
- [VueUse — `useDebounceFn`](https://vueuse.org/shared/useDebounceFn/)
- [CSS-Tricks — Debouncing and Throttling Explained Through Examples](https://css-tricks.com/debouncing-throttling-explained-examples/)
