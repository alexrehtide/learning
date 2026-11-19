---
title: 'Паттерны «банды четырёх»: карточки'
level: ядро
cards:
  # Creational
  - name: Factory Method / Abstract Factory
    category: Порождающий
    task: Создать объект, не зная конкретного класса
    examples:
      - '`createApp`, `createRouter`, `createPinia` — свой экземпляр на каждый SSR-запрос'
      - '`defineStore`'
      - '`$fetch.create({ baseURL })` — настройки по умолчанию в одном месте'
      - 'composables-фабрики'
  - name: Builder
    category: Порождающий
    task: Собрать сложный объект по шагам
    examples:
      - 'схемы `zod`/`yup`: `z.string().min(3).email()`'
      - 'сборщики тестовых данных'
      - 'конструкторы запросов'
  - name: Singleton
    category: Порождающий
    task: Один экземпляр на систему
    examples:
      - 'ES-модуль сам по себе синглтон'
      - 'экземпляр стора на приложение'
      - 'оправдан без пользовательского состояния: логгер, конфиг сборки, кэш `Intl.NumberFormat` по локали'
  - name: Prototype
    category: Порождающий
    task: Создать объект копированием образца
    examples:
      - 'прототипное наследование JS'
      - '`structuredClone`'
      - 'клонирование черновика формы'
  # Structural
  - name: Adapter
    category: Структурный
    task: Привести чужой интерфейс к своему
    examples:
      - 'маппер DTO → модель: `created_at` → `createdAt: Date`, `status: 1` → `''paid''`'
      - 'обёртка над SDK аналитики или карт: приложение вызывает `analytics.track(event)`'
  - name: Facade
    category: Структурный
    task: Простой вход в сложную подсистему
    examples:
      - '`useCheckout()` поверх корзины, доставки и оплаты'
      - 'API-клиент поверх `fetch`'
  - name: Proxy
    category: Структурный
    task: Перехватить доступ к объекту
    examples:
      - '`reactive` и `readonly` во Vue: `get` отслеживает, `set` запускает эффекты'
      - 'кэширующий или ленивый доступ'
  - name: Decorator
    category: Структурный
    task: Добавить поведение, сохранив интерфейс
    examples:
      - '`debounce`, `memoize`, `withRetry` вокруг функции'
      - 'компонент-обёртка над `<input>` с подписью и ошибкой'
      - 'декораторы TS 5'
  - name: Composite
    category: Структурный
    task: Работать с деревом как с одним узлом
    examples:
      - 'дерево компонентов и DOM'
      - 'рекурсивный `TreeNode`, рекурсивное меню'
      - 'дерево файлов'
  - name: Bridge
    category: Структурный
    task: Развести абстракцию и реализацию
    examples:
      - 'headless-логика и разные визуальные реализации'
      - 'уведомления через разные каналы'
  - name: Flyweight
    category: Структурный
    task: Разделять общее неизменяемое состояние
    examples:
      - 'один SVG-спрайт через `<use href>`'
      - 'общие экземпляры форматтеров'
  # Behavioral
  - name: Observer
    category: Поведенческий
    task: Уведомить подписчиков об изменении
    examples:
      - 'реактивность Vue, `computed`, `watch`'
      - '`emit`, `addEventListener`'
      - '`IntersectionObserver`'
      - '`$subscribe` у Pinia'
  - name: Strategy
    category: Поведенческий
    task: Выбрать алгоритм во время выполнения
    examples:
      - 'компаратор `sort`'
      - 'словарь валидаторов вместо `switch` по типу'
      - '`<component :is>`'
      - 'стратегии кэширования в Service Worker'
  - name: Chain of Responsibility
    category: Поведенческий
    task: Передать запрос по цепочке обработчиков
    examples:
      - 'guards Vue Router (`router.beforeEach`)'
      - 'интерсепторы `ofetch`/`axios`'
      - 'middleware Nuxt'
      - 'всплытие событий DOM и делегирование'
  - name: Command
    category: Поведенческий
    task: Превратить действие в объект
    examples:
      - 'undo/redo: объект с `execute` и `undo`'
      - 'очередь офлайн-мутаций'
      - 'реестр горячих клавиш, палитра команд'
  - name: Memento
    category: Поведенческий
    task: Сохранить и восстановить состояние
    examples:
      - 'снимок формы перед редактированием'
      - 'история для undo'
      - 'time travel в devtools'
  - name: State
    category: Поведенческий
    task: Поведение зависит от состояния
    examples:
      - 'конечный автомат `idle`/`loading`/`success`/`error`'
      - 'XState'
      - 'шаги визарда'
  - name: Mediator
    category: Поведенческий
    task: Убрать прямые связи между участниками
    examples:
      - 'родительский компонент, координирующий соседей'
      - 'стор, координирующий соседей'
  - name: Iterator
    category: Поведенческий
    task: Обойти коллекцию, не раскрывая устройство
    examples:
      - '`for...of`, `Symbol.iterator`'
      - 'генераторы'
      - 'пагинация через async-итератор'
  - name: Template Method
    category: Поведенческий
    task: Каркас алгоритма с шагами-крючками
    examples:
      - 'хуки жизненного цикла: фреймворк вызывает `onMounted`, вы заполняете шаг'
  - name: Visitor
    category: Поведенческий
    task: Операция над структурой без правки узлов
    examples:
      - 'обход AST в плагинах Babel, ESLint, PostCSS'
      - 'компилятор шаблонов Vue'
---

# Паттерны «банды четырёх»: карточки

> **Коротко.** 21 карточка по паттернам GoF из темы. На лицевой стороне название, на оборотной категория, задача паттерна и примеры из фронтенда. Клик или пробел переворачивает карточку, стрелки ← и → листают колоду.

<TopicCards />

Подробно, с примерами кода и ценой каждого паттерна: [Паттерны «банды четырёх» во фронтенде](./gof-patterns.md)
