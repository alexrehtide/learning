// Single source of truth for the library's table of contents and study order.
// Used by the site sidebar, the home page and the README generator.
// A topic appears in the site navigation only once its file exists.

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * @typedef {{ file: string, title: string }} Topic
 * @typedef {{ dir: string, title: string, level: 'ядро' | 'дополнительно', topics: Topic[] }} Section
 */

/** @type {Section[]} */
export const sections = [
  {
    dir: 'javascript',
    title: 'JavaScript',
    level: 'ядро',
    topics: [
      { file: 'types-and-coercion', title: 'Типы данных и приведение типов' },
      { file: 'scope-and-hoisting', title: 'Область видимости и hoisting' },
      { file: 'closures', title: 'Замыкания' },
      { file: 'functions-and-this', title: 'Функции и `this`' },
      { file: 'prototypes-and-classes', title: 'Прототипы и классы' },
      { file: 'property-descriptors-and-proxy', title: 'Дескрипторы свойств, `Proxy` и `Reflect`' },
      { file: 'modern-syntax', title: 'Деструктуризация, spread/rest и современный синтаксис' },
      { file: 'iterators-and-generators', title: 'Итераторы и генераторы' },
      { file: 'event-loop', title: 'Event loop' },
      { file: 'promises', title: 'Промисы' },
      { file: 'async-await', title: 'async/await, обработка ошибок и отмена' },
      { file: 'modules', title: 'Модули: ESM и CommonJS' },
      { file: 'memory-and-gc', title: 'Память и сборка мусора' },
      { file: 'functional-programming', title: 'Функциональные приёмы и иммутабельность' },
    ],
  },
  {
    dir: 'typescript',
    title: 'TypeScript',
    level: 'ядро',
    topics: [
      { file: 'type-system', title: 'Система типов: структурная типизация, `type` и `interface`' },
      { file: 'narrowing', title: 'Сужение типов и discriminated unions' },
      { file: 'generics', title: 'Generics' },
      { file: 'type-level-programming', title: 'Utility, conditional и mapped types' },
    ],
  },
  {
    dir: 'browser',
    title: 'Браузер',
    level: 'ядро',
    topics: [
      { file: 'from-url-to-pixels', title: 'От ввода URL до отображения страницы' },
      { file: 'rendering-pipeline', title: 'Конвейер рендеринга: layout, paint, composite' },
      { file: 'dom', title: 'DOM API и observers' },
      { file: 'events', title: 'События и событийная модель' },
      { file: 'workers', title: 'Web Workers, Service Workers и PWA' },
    ],
  },
  {
    dir: 'network',
    title: 'Сеть',
    level: 'ядро',
    topics: [
      { file: 'http', title: 'HTTP: методы, статусы, заголовки, версии' },
      { file: 'caching', title: 'HTTP-кэширование и CDN' },
      { file: 'cors-and-cookies', title: 'Same-origin policy, CORS и cookies' },
      { file: 'browser-storage', title: 'Хранилища браузера' },
      { file: 'realtime', title: 'Real-time: polling, SSE, WebSocket' },
    ],
  },
  {
    dir: 'html-css',
    title: 'Вёрстка',
    level: 'ядро',
    topics: [
      { file: 'semantic-html', title: 'Семантический HTML и мультимедиа' },
      { file: 'html-forms', title: 'HTML-формы и нативная валидация' },
      { file: 'cascade', title: 'Каскад, специфичность, наследование и custom properties' },
      { file: 'box-model', title: 'Box model, BFC и схлопывание отступов' },
      { file: 'selectors', title: 'Селекторы, псевдоклассы и псевдоэлементы' },
      { file: 'positioning', title: 'Позиционирование и stacking context' },
      { file: 'flexbox', title: 'Flexbox' },
      { file: 'grid', title: 'Grid' },
      { file: 'responsive', title: 'Адаптивная вёрстка: media и container queries, единицы, адаптивные изображения' },
      { file: 'animations', title: 'Анимации и переходы' },
    ],
  },
  {
    dir: 'vue',
    title: 'Vue',
    level: 'ядро',
    topics: [
      { file: 'components-and-templates', title: 'Компоненты и шаблоны (Composition API vs Options API)' },
      { file: 'directives', title: 'Директивы, в том числе пользовательские' },
      { file: 'reactivity', title: 'Реактивность: `ref`, `reactive`, `computed`' },
      { file: 'watchers', title: '`watch` и `watchEffect`' },
      { file: 'lifecycle', title: 'Жизненный цикл' },
      { file: 'props-emits-v-model', title: 'Props, emits и `v-model` на компонентах' },
      { file: 'slots-and-provide-inject', title: 'Слоты и provide/inject' },
      { file: 'composables', title: 'Composables' },
      { file: 'built-in-components', title: '`KeepAlive`, `Teleport`, `Suspense`, `Transition` и асинхронные компоненты' },
      { file: 'styles', title: 'Стили в компонентах: scoped, CSS Modules, `v-bind()` в `<style>`' },
      { file: 'forms-and-validation', title: 'Формы и валидация' },
      { file: 'vue-router', title: 'Vue Router' },
      { file: 'plugins-and-error-handling', title: 'Плагины и обработка ошибок' },
      { file: 'typescript', title: 'TypeScript во Vue' },
      { file: 'reactivity-internals', title: 'Как устроена реактивность' },
      { file: 'rendering-mechanism', title: 'Механизм рендеринга: VDOM и компиляторные оптимизации' },
      { file: 'ssr-and-hydration', title: 'SSR и гидрация' },
    ],
  },
  {
    dir: 'state-management',
    title: 'Управление состоянием',
    level: 'ядро',
    topics: [
      { file: 'pinia', title: 'Pinia: сторы, getters, actions' },
      { file: 'pinia-advanced', title: 'Pinia: плагины, SSR и тестирование' },
      { file: 'state-architecture', title: 'Архитектура состояния: локальное, глобальное, серверное' },
    ],
  },
  {
    dir: 'nuxt',
    title: 'Nuxt',
    level: 'ядро',
    topics: [
      { file: 'project-structure', title: 'Структура проекта и auto-imports' },
      { file: 'routing', title: 'Маршрутизация: файловые, динамические и вложенные маршруты, layouts' },
      { file: 'middleware-and-plugins', title: 'Middleware и плагины' },
      { file: 'data-fetching', title: 'Работа с данными: `$fetch`, `useFetch`, `useAsyncData`' },
      { file: 'state-and-config', title: 'Состояние и конфигурация: `useState` vs Pinia, `runtimeConfig`' },
      { file: 'rendering-modes', title: 'Режимы рендеринга и lazy hydration' },
      { file: 'nitro', title: 'Nitro: серверные маршруты и деплой' },
      { file: 'seo-and-errors', title: 'SEO и обработка ошибок' },
    ],
  },
  {
    dir: 'tooling',
    title: 'Инструменты',
    level: 'ядро',
    topics: [
      { file: 'git', title: 'Git' },
      { file: 'package-managers', title: 'Пакетные менеджеры и монорепозитории' },
      { file: 'bundlers', title: 'Сборка и транспиляция: Vite, Rollup/Rolldown, Webpack' },
      { file: 'bundle-optimization', title: 'Оптимизация бандла: tree shaking, code splitting' },
      { file: 'ci-cd', title: 'CI/CD и качество кода' },
    ],
  },
  {
    dir: 'performance',
    title: 'Производительность',
    level: 'ядро',
    topics: [
      { file: 'web-vitals', title: 'Core Web Vitals и измерение' },
      { file: 'loading', title: 'Оптимизация загрузки' },
      { file: 'runtime', title: 'Оптимизация runtime и профилирование' },
      { file: 'memory-leaks', title: 'Утечки памяти' },
      { file: 'vue-performance', title: 'Производительность Vue и Nuxt' },
    ],
  },
  {
    dir: 'security',
    title: 'Безопасность',
    level: 'ядро',
    topics: [
      { file: 'xss', title: 'XSS и безопасный вывод во Vue' },
      { file: 'csp', title: 'Content Security Policy' },
      { file: 'csrf-and-clickjacking', title: 'CSRF, clickjacking и supply chain' },
      { file: 'authentication', title: 'Аутентификация на фронтенде' },
    ],
  },
  {
    dir: 'architecture',
    title: 'Архитектура и System Design',
    level: 'ядро',
    topics: [
      { file: 'principles-and-patterns', title: 'Принципы и паттерны проектирования' },
      { file: 'large-project-structure', title: 'Структура большого проекта и Feature-Sliced Design' },
      { file: 'design-systems', title: 'Design system и UI-kit' },
      { file: 'scaling-frontend', title: 'Масштабирование фронтенда: монорепозитории, микрофронтенды, Nuxt Layers' },
      { file: 'system-design-framework', title: 'Frontend System Design: фреймворк RADIO' },
      { file: 'data-and-network', title: 'Данные и сеть в System Design' },
      { file: 'non-functional', title: 'Нефункциональные требования: рендеринг, офлайн, i18n, наблюдаемость' },
      { file: 'case-autocomplete', title: 'Разбор: автокомплит' },
      { file: 'case-news-feed', title: 'Разбор: новостная лента' },
      { file: 'case-chat', title: 'Разбор: чат' },
    ],
  },
  {
    dir: 'live-coding',
    title: 'Live coding',
    level: 'ядро',
    topics: [
      { file: 'debounce-throttle', title: 'debounce и throttle' },
      { file: 'promise-utilities', title: 'Утилиты промисов: `Promise.all` и компания, пул, retry' },
      { file: 'polyfills', title: 'Полифилы: методы `Array`, `bind`/`call`/`apply`' },
      { file: 'function-utilities', title: 'curry, compose, memoize, once' },
      { file: 'object-utilities', title: 'deepClone, deepEqual, get/set по пути' },
      { file: 'event-emitter', title: 'EventEmitter' },
      { file: 'mini-reactivity', title: 'Мини-реактивность в стиле Vue' },
      { file: 'ui-components', title: 'UI-coding: базовые компоненты на Vue' },
      { file: 'ui-widgets', title: 'UI-coding: автокомплит, таблица, дерево' },
    ],
  },
  {
    dir: 'algorithms',
    title: 'Алгоритмы',
    level: 'ядро',
    topics: [
      { file: 'complexity', title: 'Оценка сложности' },
      { file: 'arrays-strings-hashing', title: 'Массивы, строки и хеш-таблицы' },
      { file: 'stacks-and-queues', title: 'Стеки и очереди' },
      { file: 'sorting-and-searching', title: 'Сортировки и бинарный поиск' },
      { file: 'trees-and-graphs', title: 'Деревья и графы: BFS и DFS' },
      { file: 'recursion-and-dp', title: 'Рекурсия и динамическое программирование' },
    ],
  },
  {
    dir: 'accessibility',
    title: 'Доступность',
    level: 'дополнительно',
    topics: [
      { file: 'semantics-and-aria', title: 'Семантика и ARIA' },
      { file: 'keyboard-and-focus', title: 'Клавиатура, фокус и WCAG' },
    ],
  },
  {
    dir: 'testing',
    title: 'Тестирование',
    level: 'дополнительно',
    topics: [
      { file: 'testing-strategy', title: 'Стратегия тестирования' },
      { file: 'unit-and-component', title: 'Unit- и компонентные тесты: Vitest, Vue Test Utils' },
      { file: 'e2e', title: 'E2E и тестирование Nuxt' },
    ],
  },
]

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** @param {Section} section @param {Topic} topic */
export const topicPath = (section, topic) => `${section.dir}/${topic.file}.md`

/** @param {Section} section @param {Topic} topic */
export const isWritten = (section, topic) => existsSync(resolve(root, topicPath(section, topic)))

/** Renders inline `code` in titles as HTML (sidebar and home use HTML, README keeps Markdown). */
export const titleToHtml = (title) =>
  title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
