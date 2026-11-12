---
title: Core Web Vitals и измерение
level: ядро
---

# Core Web Vitals и измерение

> **Коротко.** Core Web Vitals — три полевые метрики пользовательского опыта. **LCP** (Largest Contentful Paint) — когда отрисован самый крупный элемент контента, норма ≤ 2,5 с. **INP** (Interaction to Next Paint) — сколько проходит от клика или нажатия клавиши до следующего кадра в худшем взаимодействии, норма ≤ 200 мс. **CLS** (Cumulative Layout Shift) — сумма неожиданных сдвигов в худшем «всплеске», норма ≤ 0,1. Оценивается 75-й перцентиль реальных визитов, отдельно для мобильных и десктопа. Lighthouse даёт лабораторные цифры, а значение имеют полевые: CrUX и собственный RUM. В поле измеряют библиотекой `web-vitals`, а причины ищут через атрибуцию: Long Animation Frames и разбивку метрики на части.

**Связанные темы:** [Event loop](../javascript/event-loop.md), [От ввода URL до отображения страницы](../browser/from-url-to-pixels.md), [Конвейер рендеринга: layout, paint, composite](../browser/rendering-pipeline.md), [События и событийная модель](../browser/events.md), [HTTP-кэширование и CDN](../network/caching.md), [Оптимизация загрузки](./loading.md)

## Теория

### Три метрики и пороги

Web Vitals — инициатива Google: единый набор сигналов качества страницы. **Core** Web Vitals — его стабильное ядро, по одной метрике на каждый аспект опыта:

| Метрика | Что измеряет | Хорошо | Плохо |
| --- | --- | --- | --- |
| LCP | загрузку: когда виден главный контент | ≤ 2,5 с | > 4 с |
| INP | отзывчивость: задержку до кадра после ввода | ≤ 200 мс | > 500 мс |
| CLS | визуальную стабильность: неожиданные сдвиги | ≤ 0,1 | > 0,25 |

Между порогами — «требует улучшения» (needs improvement). Страница проходит оценку, если **все три** метрики хороши на **75-м перцентиле** визитов. Перцентиль выбран намеренно: среднее скрывает хвост медленных устройств, а p75 требует, чтобы хорошо было у трёх пользователей из четырёх, и при этом устойчив к единичным выбросам. Мобильные и десктопные визиты оцениваются раздельно, иначе быстрые десктопы маскируют медленные телефоны.

INP стал Core Web Vital **12 марта 2024 года** и заменил FID (First Input Delay). FID мерил только задержку до запуска обработчика первого ввода. Он не видел ни время самого обработчика, ни отрисовку, ни все последующие взаимодействия, поэтому почти у всех сайтов был «хорошим».

Вспомогательные метрики помогают диагностике, но в оценку не входят:

- **TTFB** (Time to First Byte) — от начала навигации до первого байта ответа: редиректы, запуск Service Worker, DNS, соединение и TLS, ожидание сервера. Хорошо ≤ 0,8 с, плохо > 1,8 с. Ответ `103 Early Hints` тоже считается первым байтом.
- **FCP** (First Contentful Paint) — первый кадр с любым контентом: текстом, изображением (и фоновым), `<svg>`, непустым `<canvas>`. Хорошо ≤ 1,8 с, плохо > 3 с.
- **TBT** (Total Blocking Time) — только лабораторная. Сумма «лишних» частей долгих задач (сверх 50 мс) между FCP и стабилизацией страницы. Это лабораторный заменитель INP: без реального пользователя INP измерить нечего.

### LCP: какой элемент и когда

Кандидатом в LCP может быть:

- `<img>` (для анимированных — первый кадр), `<image>` внутри `<svg>` (сам `<svg>` — нет);
- `<video>` — постер или первый кадр, что раньше;
- элемент с фоновым изображением через `url()` (градиенты не считаются);
- блочный элемент с текстом.

Размер — только **видимая** во viewport часть. Для изображения берётся меньшее из отрисованного и натурального размера: картинка 100×100, растянутая до 500×500, считается как 100×100. У текста — прямоугольник вокруг текстовых узлов. `margin`, `padding` и `border` не входят.

Браузер рисует страницу постепенно, поэтому записей `largest-contentful-paint` несколько. Новая запись появляется, когда отрисован элемент **крупнее** предыдущего кандидата. LCP — время последней записи. Правила, о которых часто не знают:

- **Ввод останавливает отчёт.** После клика, нажатия клавиши или прокрутки новые кандидаты не регистрируются: дальше пользователь уже действует, а не ждёт.
- **Учитывается только первая отрисовка.** Если элемент потом увеличился, сдвинулся или въехал во viewport, нового кандидата не будет.
- **Удалённый элемент остаётся LCP**, пока не отрисуется элемент крупнее. Смена слайдов в карусели не сбрасывает метрику.
- **Эвристики Chromium** отбрасывают элементы с `opacity: 0`, элементы на весь viewport (их считают фоном) и «низкоэнтропийные» изображения — заглушки и однотонные плейсхолдеры, у которых мало байт на пиксель.

> [!WARNING]
> Проверено в Chromium 157. После нажатия клавиши фоновое изображение 700×400, появившееся через 1,5 с, в LCP не попало, а без ввода — стало кандидатом. Картинка 900×450 сначала была видна во viewport лишь частично и меньше текущего кандидата. Когда удаление элемента над ней подняло её целиком во viewport, новой записи не появилось.

**Подчасти LCP.** Время LCP-изображения раскладывается на четыре отрезка. Ровно эту разбивку отдаёт атрибуция `web-vitals`:

| Подчасть | Отрезок | Что раздувает |
| --- | --- | --- |
| `timeToFirstByte` | навигация → первый байт HTML | медленный сервер, редиректы, нет кэша на CDN |
| `resourceLoadDelay` | TTFB → начало загрузки ресурса | картинка обнаружена поздно: в JS, в CSS-фоне, `loading="lazy"` |
| `resourceLoadDuration` | загрузка самого ресурса | вес, формат, конкуренция за канал |
| `elementRenderDelay` | ресурс загружен → элемент нарисован | блокирующие CSS/JS, долгие задачи, гидрация, скрытие до выполнения JS |

web.dev рекомендует, чтобы обе «задержки» были близки к нулю, а время делили TTFB и загрузка (примерно по 40%). Для текстового LCP загрузки нет: остаются TTFB и задержка отрисовки, в которую входят блокирующий CSS и веб-шрифты.

> [!NOTE]
> Для cross-origin изображения без `Timing-Allow-Origin` `renderTime` раньше был `0`, и оставался только `loadTime`. Теперь браузеры отдают огрублённое время отрисовки и без этого заголовка: Chrome 133, Firefox 141, Safari 26.2 (по MDN BCD). Для точных цифр `Timing-Allow-Origin` на CDN картинок по-прежнему нужен.

### INP: отзывчивость за весь визит

INP строится на **Event Timing API**. Для каждого события браузер записывает:

- `startTime` — время аппаратного ввода;
- `processingStart` и `processingEnd` — начало и конец обработчиков;
- `duration` — от ввода до **следующей отрисовки** после обработчиков, с округлением до 8 мс.

Отсюда три фазы взаимодействия:

1. **Input delay** — от ввода до запуска обработчиков. Главный поток занят чужой задачей: гидрацией, аналитикой, таймером.
2. **Processing duration** — сами обработчики, включая синхронный ре-рендер, который они запускают.
3. **Presentation delay** — от конца обработчиков до кадра: style, layout, paint, `requestAnimationFrame`-колбэки и микрозадачи. Здесь же сказывается огромный DOM.

**Взаимодействие** — это клик, тап или нажатие клавиши. Hover, прокрутка и зум не считаются. Одно физическое действие порождает несколько событий: `pointerdown`, `pointerup`, `click` или `keydown`, `keypress`, `keyup`. Браузер объединяет их общим `interactionId`. Длительность взаимодействия — максимум `duration` его событий. `mouseover`, `mouseup` и прочие события без `interactionId` (он равен `0`) в INP не входят.

**Значение INP** — самое долгое взаимодействие за визит, но на каждые 50 взаимодействий отбрасывается одно самое долгое. На странице с 30 кликами INP — худший клик, на странице со 120 — третий по длительности. Так длинная сессия в редакторе не наказывается за один случайный выброс. Если взаимодействий не было (пользователь только прокручивал, или зашёл бот), INP не сообщается вовсе.

> [!WARNING]
> Проверено в Chromium 157. Наблюдатель `event` по умолчанию получает только события с `duration` ≥ 104 мс (`durationThreshold`, минимум — 16 мс). Клик с обработчиком на 50 мс (`duration` 56) виден только при `durationThreshold: 16`. `pointerdown`, `pointerup` и `click` одного клика получили общий `interactionId`, а `mouseup` — `0`. В Chromium `interactionId` соседних взаимодействий растёт с шагом 7, а не 1.

Связь с event loop прямая. Input delay — это долгая задача, которая уже идёт в момент ввода. Presentation delay — работа шага update the rendering. Подробно — в «[Event loop](../javascript/event-loop.md)» и «[Конвейере рендеринга](../browser/rendering-pipeline.md)», лечение — в «[Оптимизации runtime и профилировании](./runtime.md)».

### CLS: всплески сдвигов

**Layout shift** — видимый элемент сменил начальную позицию между кадрами. Новые элементы сдвигом не считаются, сдвинутые ими соседи — считаются. Оценка одного сдвига:

```text
layout shift score = impact fraction × distance fraction
```

- **impact fraction** — площадь объединения старой и новой позиции нестабильных элементов, делённая на площадь viewport;
- **distance fraction** — наибольшее смещение по горизонтали или вертикали, делённое на больший размер viewport.

Элемент на половину экрана сдвинулся вниз на 25% высоты. Объединение позиций — 75% экрана, итог: 0,75 × 0,25 = 0,1875, уже «требует улучшения».

**Окна сессий.** До 2021 года CLS суммировал все сдвиги за жизнь страницы, и долгоживущие SPA копили его бесконечно. Сейчас сдвиги группируются в **окна**: следующий сдвиг меньше чем через 1 с после предыдущего, и окно длится не больше 5 с. CLS — сумма в **худшем** окне.

**Ожидаемые сдвиги** не считаются. Сдвиг в течение 500 мс после дискретного ввода (клик, клавиша) получает `hadRecentInput: true`: пользователь сам раскрыл аккордеон и ждёт, что контент поедет. Прокрутка, перетаскивание и pinch-zoom вводом здесь не считаются. Анимация через `transform` не меняет layout-позицию, поэтому сдвигом не является. Анимация `top`, `height` или `margin` — является. Причины на уровне движка разобраны в «[Конвейере рендеринга](../browser/rendering-pipeline.md)».

> [!WARNING]
> Проверено в Chromium 157. Блок, выросший через 400 мс после загрузки, дал сдвиг с `hadRecentInput: false`. Тот же рост в обработчике клика дал `true`. Переход по `transform: translateX` записей не дал. В `sources` перечислены сдвинутые узлы (до пяти), а не тот, который вырос.

### Лабораторные и полевые данные

| | Лаборатория (lab) | Поле (field) |
| --- | --- | --- |
| Источник | Lighthouse, DevTools Performance, WebPageTest | CrUX, свой RUM |
| Условия | одно устройство, эмулированная сеть и CPU | реальные устройства, сети, кэши, расширения |
| INP | нет (замена — TBT); в режиме timespan Lighthouse — по сценарию | да |
| Назначение | воспроизвести и отладить, проверить в CI | понять, что видят пользователи |

**CrUX** (Chrome User Experience Report) — публичный датасет Google. Он собирается от пользователей Chrome на десктопе и Android, согласившихся на отправку статистики, в скользящем окне за 28 дней, по origin и по популярным URL. Его показывают PageSpeed Insights и Search Console, и именно он используется как сигнал ранжирования. Ограничения: только Chrome (нет Safari, Firefox и Chrome на iOS), нет данных у малопосещаемых страниц, и цифры запаздывают на недели.

**RUM** (Real User Monitoring) — свой сбор метрик со всех браузеров, с разрезами по роуту, устройству, версии релиза и атрибуцией. Расхождения с CrUX нормальны: другая выборка браузеров и устройств, своё сэмплирование. Кроме того, CrUX учитывает содержимое iframe, а Web API из основного документа его не видят.

Почему Lighthouse зелёный, а поле красное: в лаборатории холодный, но «чистый» запуск без взаимодействий, без сторонних A/B-скриптов и без кэша. Пользователь же кликает в момент гидрации, у него медленный телефон и баннер согласия на cookies.

### Измерение в браузере

Все метрики приходят через `PerformanceObserver`:

| Метрика | Entry type | Поддержка (MDN BCD) |
| --- | --- | --- |
| LCP | `largest-contentful-paint` | Chrome 77, Firefox 122, Safari 26.2 |
| INP | `event` с `interactionId` | Chrome 96, Firefox 144, Safari 26.2 |
| CLS | `layout-shift` | только Chromium |
| FCP | `paint` (`first-contentful-paint`) | Chrome 60, Firefox 84, Safari 14.1 |
| TTFB | `navigation` (`responseStart`) | все |
| Атрибуция | `long-animation-frame` | только Chromium (123+) |

С Safari 26.2 LCP и INP впервые измеримы во всех трёх движках, а CLS по-прежнему есть только в Chromium. Опция `buffered: true` отдаёт записи, созданные до подписки: скрипт аналитики обычно грузится позже первой отрисовки.

Сырой `PerformanceObserver` недостаточен. Готовая библиотека `web-vitals` (Google, v6) закрывает краевые случаи, которые легко пропустить:

- страница открыта **в фоновой вкладке**: LCP и FCP не репортятся, потому что браузер не рисовал;
- **восстановление из bfcache** — новый визит, а браузер записей не создаёт: библиотека сама считает метрики заново с новым `id`;
- **пререндер**: время отсчитывается от `activationStart`, а не от навигации;
- **когда отправлять**: CLS и INP финальны только к концу визита, поэтому отчёт уходит при `visibilitychange` в `hidden`. Событие `unload` на мобильных ненадёжно и ломает bfcache;
- выбор INP (группировка по `interactionId`, правило «1 на 50») и окна CLS.

Метрика из `web-vitals` содержит `name`, `value`, `delta`, `rating`, `id`, `entries` и `navigationType`. `delta` нужен, потому что CLS и INP могут репортиться несколько раз: суммирование дельт по `id` даёт итоговое значение.

### Атрибуция: Long Animation Frames

Метрика говорит «плохо», атрибуция — «почему». Сборка `web-vitals/attribution` добавляет к метрике поле `attribution`. Для LCP это элемент и четыре подчасти, для CLS — `largestShiftTarget`, для INP — `interactionTarget`, три фазы, `longAnimationFrameEntries` и `longestScript`.

**LoAF** (Long Animation Frames API, Chromium 123+) сообщает о кадре, обновление которого задержалось больше чем на 50 мс. В отличие от Long Tasks API, он:

- видит кадр целиком, включая рендеринг, поэтому ловит и серию коротких задач, которые вместе задержали кадр;
- указывает **скрипты**, а не только окно: `invoker`, `invokerType`, `sourceURL`, `sourceFunctionName`, `forcedStyleAndLayoutDuration`, `pauseDuration`.

Атрибуция выдаётся для скриптов дольше 5 мс. `blockingDuration` — сумма превышений 50 мс по долгим задачам кадра (рендер прибавляется к самой длинной). Источником указывается точка входа: обработчик события, а не библиотека, которую он вызвал. У cross-origin скрипта без CORS (`crossorigin`) виден только `sourceURL`.

> [!WARNING]
> Проверено в Chromium 157. Клик с обработчиком на 150 мс дал LoAF с `duration` 150 и `blockingDuration` 100. В `scripts` оказались `invoker: "BUTTON#slow.onclick"`, `invokerType: "event-listener"` и имя функции. С Chrome 158 у LoAF есть раздельные `styleDuration` и `layoutDuration`, а у скрипта — `forcedStyleDuration` и `forcedLayoutDuration`. В Firefox и Safari LoAF нет, поэтому атрибуция INP там ограничена фазами Event Timing.

### SPA и soft navigations

Изначально метрики привязаны к **документу**. В SPA переход по роуту через `history.pushState` новым визитом не является. LCP фиксируется один раз на входе, а CLS и INP копятся за всю сессию и приписываются URL первой страницы. Отсюда типичный перекос: SPA выглядит быстрой по LCP (переходы не измеряются), но плохой по INP на «входном» URL.

**Soft Navigations API** включён по умолчанию с Chrome 151. Браузер сам распознаёт мягкую навигацию по трём признакам: взаимодействие пользователя, смена URL и последующая отрисовка. Фреймворку ничего вызывать не нужно. Появились записи `soft-navigation` (URL, `navigationId`, `interactionId` вызвавшего клика) и `interaction-contentful-paint` (из него берётся LCP мягкой навигации). У записей LCP, `event` и `layout-shift` есть `navigationId`. Для мягкой навигации TTFB равен 0, LCP учитывает только перерисованные элементы (шапка, оставшаяся с прошлой страницы, не считается), INP и CLS начинаются заново.

> [!NOTE]
> Статус сверен 2026-11-12. `web-vitals` 6.x репортит метрики мягких навигаций с опцией `reportSoftNavs: true` (`navigationType: 'soft-navigation'`, `navigationURL`). В CrUX метрики soft navigations пока экспериментальные, перевод в стабильные запланирован на май 2027 года. В Firefox и Safari API нет. Проверено в Chromium 157: клик по ссылке с `pushState` и отрисовкой заголовка дал записи `interaction-contentful-paint` и `soft-navigation` с общим `interactionId`.

## Примеры

Минимальный сбор через `PerformanceObserver` — понять устройство, а не заменить библиотеку:

```js
// LCP: the last candidate before the first input wins.
let lcp;
new PerformanceObserver((list) => {
  const last = list.getEntries().at(-1);
  lcp = { value: last.startTime, element: last.element, url: last.url };
}).observe({ type: 'largest-contentful-paint', buffered: true });

// CLS: largest session window (gap < 1 s, window <= 5 s), skipping input-driven shifts.
let cls = 0, windowValue = 0, windowStart = 0, lastShift = 0;
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    if (e.hadRecentInput) continue;
    const sameWindow = e.startTime - lastShift < 1000 && e.startTime - windowStart < 5000;
    if (sameWindow) windowValue += e.value;
    else { windowValue = e.value; windowStart = e.startTime; }
    lastShift = e.startTime;
    cls = Math.max(cls, windowValue);
  }
}).observe({ type: 'layout-shift', buffered: true });
```

RUM в Nuxt 4: клиентский плагин отправляет метрики с атрибуцией пачкой при уходе со страницы. Группировка идёт по **имени роута**, а не по URL, иначе `/product/1` и `/product/2` окажутся разными страницами.

```ts
// app/plugins/web-vitals.client.ts
import { onCLS, onINP, onLCP, type MetricWithAttribution } from 'web-vitals/attribution';

export default defineNuxtPlugin(() => {
  const router = useRouter();
  const queue = new Map<string, Record<string, unknown>>();

  const add = (m: MetricWithAttribution) => {
    const url = m.navigationURL ?? location.href;
    queue.set(m.id, {
      name: m.name,
      value: m.value,
      rating: m.rating,
      navigationType: m.navigationType,
      route: router.resolve(new URL(url).pathname).name ?? 'unknown', // 'product-id', not '/product/42'
      target:
        m.name === 'INP' ? m.attribution.interactionTarget
        : m.name === 'CLS' ? m.attribution.largestShiftTarget
        : m.attribution.target,
    });
  };

  const flush = () => {
    if (!queue.size) return;
    navigator.sendBeacon('/api/vitals', JSON.stringify([...queue.values()]));
    queue.clear();
  };

  // Sample sessions to keep volume sane; decide once per page load.
  if (Math.random() < 0.1) {
    onLCP(add);
    onINP(add);
    onCLS(add);
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }
});
```

`Map` по `metric.id` хранит последнее значение метрики: CLS и INP могут прийти несколько раз до отправки. Сэмплирование решается один раз на визит, а не на каждую метрику, чтобы метрики одного визита не терялись по отдельности. Пороги для своих отчётов не нужно хардкодить: библиотека экспортирует `LCPThresholds` (`[2500, 4000]`), `INPThresholds` (`[200, 500]`) и `CLSThresholds` (`[0.1, 0.25]`), а также `rating` у каждой метрики.

Отладка INP прямо в консоли — какие кадры и скрипты были долгими во время ввода:

```js
new PerformanceObserver((list) => {
  for (const frame of list.getEntries()) {
    if (!frame.firstUIEventTimestamp || frame.blockingDuration < 100) continue;
    console.table(frame.scripts.map((s) => ({
      invoker: s.invoker,
      source: `${s.sourceURL}:${s.sourceFunctionName}`,
      duration: Math.round(s.duration),
      forcedLayout: Math.round(s.forcedStyleAndLayoutDuration),
    })));
  }
}).observe({ type: 'long-animation-frame', buffered: true });
```

## Вопросы с интервью

::: details Что такое Core Web Vitals и почему оценивается 75-й перцентиль
Три полевые метрики опыта: LCP — загрузка (≤ 2,5 с), INP — отзывчивость (≤ 200 мс), CLS — визуальная стабильность (≤ 0,1). Страница «хорошая», если хороши все три на 75-м перцентиле визитов, отдельно на мобильных и десктопе. Среднее скрывает хвост медленных устройств и плохих сетей. p75 требует хорошего опыта у большинства и при этом не дёргается от единичных выбросов, как p99. Раздельная оценка мобильных нужна, чтобы быстрые десктопы не маскировали медленные телефоны. Вспомогательные TTFB и FCP помогают в диагностике, но в оценку не входят. TBT — лабораторный заменитель INP.
:::

::: details Почему INP заменил FID и из чего складывается задержка взаимодействия
FID мерил только задержку до запуска обработчика **первого** ввода. Он не видел время обработчика, отрисовку и все последующие клики, поэтому почти у всех был зелёным и не отражал реальную отзывчивость. INP с марта 2024 года покрывает **все** клики, тапы и нажатия клавиш за визит и меряет до **следующего кадра**. Задержка состоит из трёх фаз: input delay (главный поток занят чужой задачей), processing (сами обработчики и синхронный ре-рендер), presentation delay (style, layout, paint до кадра). Итог — худшее взаимодействие с отбрасыванием одного выброса на каждые 50. Без взаимодействий INP не сообщается.
:::

::: details Почему Lighthouse показывает 98 баллов, а Search Console жалуется на INP
Lighthouse — лаборатория: один запуск на эмулированном устройстве без взаимодействий. INP он в обычном режиме не измеряет, вместо него TBT. Search Console берёт данные CrUX — реальных пользователей Chrome за 28 дней. Они кликают во время гидрации, у них медленные телефоны, сторонние скрипты, A/B-тесты, баннеры согласия, а в длинных SPA-сессиях копятся тяжёлые компоненты. Лабораторные данные нужны, чтобы воспроизводить и ловить регрессии в CI, полевые — чтобы знать правду. Чтобы найти причину, нужен свой RUM с атрибуцией (LoAF, фазы INP, `interactionTarget`), а в лаборатории — сценарий в режиме timespan или запись в DevTools с замедлением CPU.
:::

::: details Как считается CLS и какие сдвиги в него не попадают
Каждый сдвиг оценивается как impact fraction (доля viewport, которую затронули старая и новая позиции) × distance fraction (наибольшее смещение, делённое на больший размер viewport). Сдвиги группируются в окна сессий: разрыв меньше 1 с, окно не длиннее 5 с. CLS — сумма в худшем окне, а не за всю жизнь страницы, поэтому долгая SPA-сессия не копит его бесконечно. Не считаются: сдвиги в течение 500 мс после клика или клавиши (`hadRecentInput`), анимации через `transform`, появление новых элементов (сдвигом считается смещение соседей). Прокрутка вводом для этого правила не считается: подгрузка, сдвинувшая контент во время скролла, — честный CLS.
:::

::: details Какой элемент станет LCP и как разобрать, почему LCP медленный
Кандидаты — изображения, постер или первый кадр видео, элементы с фоном через `url()`, блоки с текстом. Размер — видимая часть во viewport, у картинки не больше натурального размера. Новый кандидат появляется только при отрисовке элемента крупнее. Ввод пользователя останавливает отчёт, удалённый элемент остаётся LCP, сдвиг или рост элемента нового кандидата не создают. Chromium отбрасывает элементы с `opacity: 0`, полноэкранные фоны и низкоэнтропийные заглушки. Медленный LCP раскладывается на TTFB, задержку начала загрузки, загрузку и задержку отрисовки. Большая задержка начала загрузки значит, что картинку поздно обнаружили: она в JS, в CSS-фоне или помечена `loading="lazy"`. Большая задержка отрисовки — блокирующий CSS или JS, шрифты, гидрация. Лечится по-разному, поэтому сначала разбивка, потом оптимизация.
:::

::: details Как собирать Web Vitals в проде и почему не хватает голого PerformanceObserver
Через библиотеку `web-vitals` (лучше attribution-сборку) с отправкой через `sendBeacon` при `visibilitychange` → `hidden`: CLS и INP финальны только к концу визита, а `unload` ненадёжен и ломает bfcache. Библиотека учитывает то, что легко упустить: фоновые вкладки (LCP не репортится), восстановление из bfcache (новый визит без записей от браузера), пререндер (отсчёт от `activationStart`), группировку событий по `interactionId` и окна CLS. Отправлять нужно с разрезами: имя роута, тип устройства, версия релиза, `navigationType`, атрибуция. Сэмплирование — на визит. Помнить про ограничения: CLS есть только в Chromium, LCP и INP в Safari — с 26.2, содержимое iframe API не видят.
:::

::: details Как Web Vitals работают для SPA на Vue Router или Nuxt
Классически метрики привязаны к документу. Переход через `pushState` не новый визит, поэтому LCP меряется только на входе, а CLS и INP копятся за всю сессию на URL первой страницы. С Chrome 151 браузер сам распознаёт soft navigation по признакам «взаимодействие + смена URL + отрисовка» и создаёт записи `soft-navigation` и `interaction-contentful-paint`. У остальных записей появляется `navigationId`. `web-vitals` 6 с `reportSoftNavs: true` репортит отдельные LCP, INP и CLS для каждой мягкой навигации, TTFB у них равен 0. В CrUX эти метрики пока экспериментальные, в Firefox и Safari API нет. Программный `router.push` без клика пользователя мягкой навигацией не считается.
:::

## Задачи

### 1. Посчитать CLS · легко

Записи `layout-shift` за визит (время от начала навигации):

| t, с | value | hadRecentInput |
| --- | --- | --- |
| 0,3 | 0,04 | false |
| 0,9 | 0,05 | false |
| 1,6 | 0,03 | false |
| 4,0 | 0,06 | false |
| 4,5 | 0,02 | true |
| 4,7 | 0,05 | false |
| 10,0; 10,8; … ; 16,4 (каждые 0,8 с, 9 сдвигов) | по 0,01 | false |

Чему равен CLS и какая это оценка? Сколько получилось бы по определению до 2021 года?

::: details Решение и разбор
Сдвиг в 4,5 с отбрасываем: `hadRecentInput`. Окна:

- 0,3–1,6 с: разрывы 0,6 и 0,7 с — одно окно, 0,04 + 0,05 + 0,03 = **0,12**;
- 4,0–4,7 с: разрыв 2,4 с от предыдущего — новое окно, 0,06 + 0,05 = 0,11;
- 10,0–14,8 с: семь сдвигов, окно уже 4,8 с, следующий сдвиг (15,6 с) вышел бы за 5 с — 0,07;
- 15,6–16,4 с — 0,02.

CLS = максимум = **0,12**, «требует улучшения» (> 0,1). Старая сумма за всю жизнь страницы — 0,12 + 0,11 + 0,09 = 0,32, «плохо». Видно, зачем ввели окна: девять мелких сдвигов ленты за 6 секунд не делают страницу хуже одного всплеска. Чинить нужно первое окно: это загрузка, скорее всего картинки без `width`/`height` или поздний баннер.
:::

### 2. Какое взаимодействие станет INP · легко

За визит было 120 взаимодействий. Пять самых долгих: 680, 410, 260, 240, 190 мс. Остальные короче 150 мс. Какое значение INP и какая оценка? А если взаимодействий 30, с теми же худшими? Клик дал события `pointerdown` 16 мс, `pointerup` 152 мс, `click` 152 мс — сколько это взаимодействий и какая у него длительность?

::: details Решение и разбор
Отбрасывается одно самое долгое на каждые 50 взаимодействий: ⌊120 / 50⌋ = 2. Отбрасываем 680 и 410, INP = **260 мс** — «требует улучшения» (200 < 260 ≤ 500). При 30 взаимодействиях ничего не отбрасывается: INP = 680 мс, «плохо». Пример показывает, что на коротких визитах один тяжёлый клик решает всё.

Три события клика — **одно** взаимодействие (общий `interactionId`). Его длительность — максимум, 152 мс, а не сумма. Обработчики `pointerup` и `click` выполняются в одной задаче до одного кадра, поэтому их `duration` совпадают.

Сложность: O(n) с хранением k худших (в `web-vitals` k = 10).
:::

### 3. Свой сборщик INP · средне

Напишите `observeINP(report)`. Функция группирует события по `interactionId`, применяет правило «1 на 50» и вызывает `report(value)` при уходе страницы в фон. Память не должна расти с числом взаимодействий. Как узнать число взаимодействий, если быстрые события до наблюдателя не доходят?

::: details Решение и разбор
```js
export function observeINP(report) {
  const MAX_KEPT = 10;
  let longest = []; // [{ id, duration }], sorted by duration desc
  let minId = Infinity, maxId = 0;

  const interactionCount = () =>
    'interactionCount' in performance
      ? performance.interactionCount
      : maxId ? (maxId - minId) / 7 + 1 : 0; // Chromium step; estimate only

  const handle = (entries) => {
    for (const e of entries) {
      if (!e.interactionId) continue; // mouseover, mouseup...
      minId = Math.min(minId, e.interactionId);
      maxId = Math.max(maxId, e.interactionId);
      const existing = longest.find((i) => i.id === e.interactionId);
      if (existing) existing.duration = Math.max(existing.duration, e.duration);
      else longest.push({ id: e.interactionId, duration: e.duration });
      longest.sort((a, b) => b.duration - a.duration);
      longest = longest.slice(0, MAX_KEPT);
    }
  };
  const po = new PerformanceObserver((list) => handle(list.getEntries()));
  po.observe({ type: 'event', durationThreshold: 40, buffered: true });

  addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    handle(po.takeRecords()); // entries not yet delivered to the callback
    if (!longest.length) return; // no interactions → no INP
    const skip = Math.min(longest.length - 1, Math.floor(interactionCount() / 50));
    report(longest[skip].duration);
  });
}
```

Разбор:

- **Число взаимодействий.** Наблюдатель видит только события с `duration` ≥ порога, а «1 на 50» требует числа **всех** взаимодействий. `performance.interactionCount` (Chrome 144, Firefox 144, Safari 26.2) даёт его напрямую. Для старых браузеров число оценивают по диапазону `interactionId`: в Chromium он растёт с шагом 7 (проверено в Chromium 157). Так поступала и `web-vitals`.
- **Память.** Хранятся 10 худших. Отбросить больше 9 можно только при 500+ взаимодействиях, а там погрешность в один слот несущественна.
- **`takeRecords()`.** Колбэк наблюдателя вызывается асинхронно. Записи последнего клика перед уходом вкладки могли ещё не дойти до него, поэтому перед отчётом их забирают синхронно и обрабатывают той же функцией.
- **Не учтено**: bfcache-восстановление (нужен сброс состояния на `pageshow` с `persisted`), повторные `hidden` (отправлять дельту), пререндер. Поэтому в продакшене — библиотека.

Сложность: O(k log k) на событие при k = 10, то есть O(1); память O(1).
:::

### 4. Разбор медленного LCP · средне

Страница каталога на Nuxt, мобильный p75. Данные атрибуции LCP:

```js
{
  value: 3400,
  attribution: {
    target: 'main > section.hero > img',
    url: 'https://cdn.example.com/hero.avif',
    timeToFirstByte: 650,
    resourceLoadDelay: 1550,
    resourceLoadDuration: 450,
    elementRenderDelay: 750,
  },
}
```

В шаблоне: `<img :src="banner.url" loading="lazy" class="hero">`, где `banner` приходит из `useFetch` на клиенте (`server: false`). Что не так, что исправить и каков ожидаемый эффект?

::: details Решение и разбор
Оценка: 3,4 с — «требует улучшения». TTFB (0,65 с) и загрузка (0,45 с) в норме. Проблема — две задержки, 2,3 с из 3,4.

**`resourceLoadDelay` 1,55 с** — картинку поздно обнаружили:

- `server: false` — данные запрашиваются только после гидрации, в SSR-HTML `<img>` нет, и preload scanner его не видит. Нужно убрать `server: false`, чтобы `useFetch` выполнился на сервере и `<img src>` попал в HTML;
- `loading="lazy"` на изображении первого экрана откладывает загрузку до layout. Для LCP-картинки — `loading="eager"` (по умолчанию) и `fetchpriority="high"`;
- если CDN на другом origin — `<link rel="preconnect">`.

**`elementRenderDelay` 0,75 с** — ресурс загружен, но не нарисован. Изображение вставлялось клиентским рендером после загрузки и выполнения бандла и гидрации. После переноса в SSR эта часть сводится к блокирующему CSS.

Ожидаемый эффект: LCP ≈ TTFB + (небольшая задержка) + загрузка + немного отрисовки ≈ 0,65 + 0,1 + 0,45 + 0,1 ≈ 1,3 с, «хорошо». Отдельно стоит проверить `Timing-Allow-Origin` на CDN: без него `renderTime` cross-origin картинки огрублён, а в старых браузерах равен `0`. Подробно о подсказках загрузки — в «[Оптимизации загрузки](./loading.md)».
:::

## Источники

- [W3C: Largest Contentful Paint](https://w3c.github.io/largest-contentful-paint/)
- [W3C: Event Timing API](https://w3c.github.io/event-timing/)
- [WICG: Layout Instability API](https://wicg.github.io/layout-instability/)
- [W3C: Long Animation Frames API](https://w3c.github.io/long-animation-frames/)
- [W3C: Performance Timeline](https://w3c.github.io/performance-timeline/), [Navigation Timing Level 2](https://w3c.github.io/navigation-timing/), [Resource Timing](https://w3c.github.io/resource-timing/), [Paint Timing](https://w3c.github.io/paint-timing/)
- [WICG: Soft Navigations](https://github.com/WICG/soft-navigations)
- [web.dev: Web Vitals](https://web.dev/articles/vitals), [LCP](https://web.dev/articles/lcp), [INP](https://web.dev/articles/inp), [CLS](https://web.dev/articles/cls), [TTFB](https://web.dev/articles/ttfb), [FCP](https://web.dev/articles/fcp), [Optimize LCP](https://web.dev/articles/optimize-lcp)
- [web.dev: Why lab and field data can be different](https://web.dev/articles/lab-and-field-data-differences), [CrUX and RUM differences](https://web.dev/articles/crux-and-rum-differences)
- [Chrome for Developers: Long Animation Frames API](https://developer.chrome.com/docs/web-platform/long-animation-frames), [Soft navigations](https://developer.chrome.com/docs/web-platform/soft-navigations), [CrUX methodology](https://developer.chrome.com/docs/crux/methodology)
- [GoogleChrome/web-vitals (README и CHANGELOG, v6.2.3)](https://github.com/GoogleChrome/web-vitals)
- [MDN: PerformanceObserver](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver), [LargestContentfulPaint](https://developer.mozilla.org/en-US/docs/Web/API/LargestContentfulPaint), [PerformanceEventTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming), [LayoutShift](https://developer.mozilla.org/en-US/docs/Web/API/LayoutShift), [Performance.interactionCount](https://developer.mozilla.org/en-US/docs/Web/API/Performance/interactionCount); поддержка — по MDN browser-compat-data
- [Nuxt: Plugins](https://nuxt.com/docs/4.x/guide/directory-structure/app/plugins), [useFetch](https://nuxt.com/docs/4.x/api/composables/use-fetch)
