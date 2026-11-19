import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import LibraryToc from './LibraryToc.vue'
import TopicCards from './TopicCards.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('LibraryToc', LibraryToc)
    app.component('TopicCards', TopicCards)
  },
}
