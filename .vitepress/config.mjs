import { defineConfig } from 'vitepress'
import { sections, isWritten, titleToHtml } from './toc.mjs'

const repo = 'https://github.com/alexrehtide/learning'

const alertLabels = {
  noteLabel: 'Заметка',
  tipLabel: 'Совет',
  warningLabel: 'Внимание',
  infoLabel: 'Инфо',
  dangerLabel: 'Опасно',
  importantLabel: 'Важно',
  cautionLabel: 'Осторожно',
}

// Only written topics are shown; sections without a single written topic are hidden.
function sidebar() {
  return sections
    .map((section) => ({
      text: section.level === 'дополнительно' ? `${section.title} · дополнительно` : section.title,
      collapsed: false,
      items: section.topics
        .filter((topic) => isWritten(section, topic))
        .map((topic) => ({
          text: titleToHtml(topic.title),
          link: `/${section.dir}/${topic.file}`,
        })),
    }))
    .filter((group) => group.items.length > 0)
}

export default defineConfig({
  lang: 'ru-RU',
  title: 'Senior Frontend',
  description: 'Библиотека подготовки к senior frontend-интервью: JavaScript, браузер, Vue 3, Nuxt',
  base: '/learning/',
  cleanUrls: true,
  lastUpdated: true,

  // The site is built from the same Markdown files that live in the repo.
  // Everything that is not a topic or the home page stays out of the build.
  srcExclude: [
    'README.md',
    'AGENTS.md',
    'GLOSSARY.md',
    'docs/**',
    'templates/**',
    'research/**',
  ],

  markdown: {
    container: { ...alertLabels, detailsLabel: 'Подробнее' },
    config(md) {
      // VitePress 1.6 registers the GitHub alerts plugin without `container` options,
      // so `> [!NOTE]` keeps English titles. Translate titles that were not set explicitly.
      md.core.ruler.after('github-alerts', 'github-alerts-ru', (state) => {
        for (const token of state.tokens) {
          if (token.type !== 'github_alert_open') continue
          const { type, title } = token.meta
          if (title === type.toUpperCase()) token.meta.title = alertLabels[`${type}Label`] ?? title
        }
      })
    },
  },

  themeConfig: {
    nav: [{ text: 'Оглавление', link: '/' }],
    sidebar: sidebar(),
    socialLinks: [{ icon: 'github', link: repo }],

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'Поиск', buttonAriaLabel: 'Поиск' },
          modal: {
            displayDetails: 'Подробный список',
            resetButtonTitle: 'Сбросить поиск',
            backButtonTitle: 'Закрыть поиск',
            noResultsText: 'Ничего не найдено по запросу',
            footer: {
              selectText: 'выбрать',
              selectKeyAriaLabel: 'Enter',
              navigateText: 'перейти',
              navigateUpKeyAriaLabel: 'стрелка вверх',
              navigateDownKeyAriaLabel: 'стрелка вниз',
              closeText: 'закрыть',
              closeKeyAriaLabel: 'Escape',
            },
          },
        },
      },
    },

    editLink: {
      pattern: `${repo}/edit/main/:path`,
      text: 'Исправить на GitHub',
    },
    lastUpdated: { text: 'Обновлено' },
    outline: { level: [2, 3], label: 'На странице' },
    docFooter: { prev: 'Предыдущая тема', next: 'Следующая тема' },
    notFound: {
      title: 'Страница не найдена',
      quote: 'Возможно, эта тема ещё не написана.',
      linkText: 'К оглавлению',
    },
    darkModeSwitchLabel: 'Тема',
    lightModeSwitchTitle: 'Светлая тема',
    darkModeSwitchTitle: 'Тёмная тема',
    sidebarMenuLabel: 'Меню',
    returnToTopLabel: 'Наверх',
    langMenuLabel: 'Язык',
    skipToContentLabel: 'К содержанию',
  },
})
