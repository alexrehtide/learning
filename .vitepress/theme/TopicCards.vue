<script setup>
// Topic cards: one card at a time, front shows a concept, back shows its gist.
// Cards come from the page frontmatter (`cards: [{ name, category, task, examples }]`).
// Click or Space flips, ←/→ navigate, the deck can be shuffled and filtered by category.
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useData } from 'vitepress'

const { frontmatter } = useData()

const cards = computed(() => frontmatter.value.cards ?? [])
const categories = computed(() => [...new Set(cards.value.map((card) => card.category))])

const category = ref(null) // null = all categories
const order = ref([])
const pos = ref(0)
const flipped = ref(false)

const filtered = computed(() =>
  cards.value.map((_, i) => i).filter((i) => !category.value || cards.value[i].category === category.value),
)
const current = computed(() => cards.value[order.value[pos.value]])

function reset(indices) {
  order.value = indices
  pos.value = 0
  flipped.value = false
}

watch(filtered, (indices) => reset(indices), { immediate: true })

function shuffle() {
  const a = [...filtered.value]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  reset(a)
}

function flip() {
  flipped.value = !flipped.value
}

function go(step) {
  const n = order.value.length
  if (!n) return
  pos.value = (pos.value + step + n) % n
  flipped.value = false
}

// Splits `code` spans out of plain text so they render as <code> without v-html.
function parts(text) {
  return String(text)
    .split('`')
    .map((value, i) => ({ value, code: i % 2 === 1 }))
    .filter((part) => part.value)
}

function onKeydown(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const target = event.target
  if (target instanceof Element && target.closest('input, textarea, select, button, [contenteditable], .VPLocalSearchBox')) {
    return
  }
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault()
    flip()
  } else if (event.key === 'ArrowRight') {
    go(1)
  } else if (event.key === 'ArrowLeft') {
    go(-1)
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div v-if="cards.length" class="topic-cards">
    <div class="tc-toolbar">
      <div class="tc-filters" role="group" aria-label="Категория">
        <button type="button" class="tc-chip" :aria-pressed="category === null" @click="category = null">
          Все
        </button>
        <button
          v-for="c in categories"
          :key="c"
          type="button"
          class="tc-chip"
          :aria-pressed="category === c"
          @click="category = c"
        >
          {{ c }}
        </button>
      </div>
      <button type="button" class="tc-chip" @click="shuffle">Перемешать</button>
    </div>

    <div
      v-if="current"
      class="tc-card"
      :class="{ 'is-flipped': flipped }"
      role="button"
      tabindex="0"
      :aria-label="flipped ? 'Оборотная сторона, нажмите, чтобы перевернуть' : 'Лицевая сторона, нажмите, чтобы перевернуть'"
      @click="flip"
    >
      <div class="tc-inner">
        <div class="tc-face tc-front" :aria-hidden="flipped">
          <span class="tc-name">{{ current.name }}</span>
          <span class="tc-hint">Нажмите или пробел — перевернуть</span>
        </div>
        <div class="tc-face tc-back" :aria-hidden="!flipped" aria-live="polite">
          <span class="tc-category">{{ current.category }}</span>
          <p class="tc-task">{{ current.task }}</p>
          <ul class="tc-examples">
            <li v-for="(example, i) in current.examples" :key="i">
              <template v-for="(part, j) in parts(example)" :key="j">
                <code v-if="part.code">{{ part.value }}</code>
                <template v-else>{{ part.value }}</template>
              </template>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <div class="tc-nav">
      <button type="button" class="tc-chip" aria-label="Предыдущая карточка" @click="go(-1)">←</button>
      <span class="tc-count" aria-live="polite">{{ pos + 1 }} из {{ order.length }}</span>
      <button type="button" class="tc-chip" aria-label="Следующая карточка" @click="go(1)">→</button>
    </div>
  </div>
</template>

<style scoped>
.topic-cards {
  margin: 24px 0;
}

.tc-toolbar,
.tc-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tc-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tc-nav {
  justify-content: center;
  gap: 16px;
  margin-top: 16px;
}

.tc-chip {
  padding: 4px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 14px;
  line-height: 24px;
  transition: border-color 0.2s, background-color 0.2s;
}

.tc-chip:hover {
  border-color: var(--vp-c-brand-1);
}

.tc-chip[aria-pressed='true'] {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.tc-count {
  min-width: 64px;
  text-align: center;
  color: var(--vp-c-text-2);
  font-variant-numeric: tabular-nums;
}

.tc-card {
  margin-top: 16px;
  perspective: 1200px;
  cursor: pointer;
  border-radius: 12px;
  outline: none;
}

.tc-card:focus-visible {
  box-shadow: 0 0 0 2px var(--vp-c-brand-1);
}

.tc-inner {
  display: grid;
  transition: transform 0.45s ease;
  transform-style: preserve-3d;
}

.tc-card.is-flipped .tc-inner {
  transform: rotateY(180deg);
}

/* Both faces share one grid cell, so the card takes the height of the taller one. */
.tc-face {
  grid-area: 1 / 1;
  display: flex;
  flex-direction: column;
  min-height: 260px;
  padding: 24px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

.tc-front {
  align-items: center;
  justify-content: center;
  gap: 16px;
  text-align: center;
}

.tc-back {
  transform: rotateY(180deg);
}

.tc-name {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--vp-c-text-1);
}

.tc-hint {
  font-size: 13px;
  color: var(--vp-c-text-3);
}

.tc-category {
  align-self: flex-start;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-size: 13px;
  font-weight: 500;
}

.vp-doc .tc-task {
  margin: 12px 0 8px;
  font-weight: 600;
}

.vp-doc .tc-examples {
  margin: 0;
}

@media (max-width: 640px) {
  .tc-face {
    min-height: 220px;
    padding: 16px;
  }

  .tc-name {
    font-size: 22px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tc-inner {
    transition: none;
  }
}
</style>
