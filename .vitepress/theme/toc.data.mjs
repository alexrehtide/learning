import { sections, isWritten, titleToHtml } from '../toc.mjs'

// Build-time data for the home page table of contents.
export default {
  watch: ['*/*.md'],
  load() {
    return sections.map((section) => ({
      dir: section.dir,
      title: section.title,
      level: section.level,
      topics: section.topics.map((topic) => ({
        html: titleToHtml(topic.title),
        link: `/${section.dir}/${topic.file}`,
        written: isWritten(section, topic),
      })),
    }))
  },
}
