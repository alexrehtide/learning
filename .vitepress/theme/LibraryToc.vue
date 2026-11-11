<script setup>
import { computed } from 'vue'
import { withBase } from 'vitepress'
import { data as sections } from './toc.data.mjs'

const total = computed(() => sections.reduce((sum, s) => sum + s.topics.length, 0))
const written = computed(() =>
  sections.reduce((sum, s) => sum + s.topics.filter((t) => t.written).length, 0),
)
</script>

<template>
  <div class="library-toc">
    <p class="progress">Написано тем: {{ written }} из {{ total }}</p>

    <section v-for="(section, i) in sections" :key="section.dir">
      <h2 :id="section.dir">
        {{ i + 1 }}. {{ section.title }}
        <span v-if="section.level === 'дополнительно'" class="level">дополнительно</span>
      </h2>
      <ol>
        <li v-for="topic in section.topics" :key="topic.link" :class="{ pending: !topic.written }">
          <a v-if="topic.written" :href="withBase(topic.link)" v-html="topic.html" />
          <template v-else>
            <span v-html="topic.html" />
            <span class="soon">скоро</span>
          </template>
        </li>
      </ol>
    </section>
  </div>
</template>
