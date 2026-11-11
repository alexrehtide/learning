import DefaultTheme from 'vitepress/theme'
import LibraryToc from './LibraryToc.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('LibraryToc', LibraryToc)
  },
}
