import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { sections, root, isWritten } from '../toc.mjs'

// Build-time list of topics that have a plain-language version (`<topic>.simple.md`),
// as paths without extension: ['security/xss', …]. Used by the hidden toggle in Layout.vue.
export default {
  watch: ['*/*.simple.md'],
  load() {
    return sections.flatMap((section) =>
      section.topics
        .filter((topic) => isWritten(section, topic))
        .filter((topic) => existsSync(resolve(root, `${section.dir}/${topic.file}.simple.md`)))
        .map((topic) => `${section.dir}/${topic.file}`),
    )
  },
}
