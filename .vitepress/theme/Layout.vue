<script setup>
// Default layout plus a hidden toggle between a topic and its plain-language version:
// a triple click (or triple tap) on the page title switches pages. Nothing on the page hints at it.
import { onMounted, onBeforeUnmount } from 'vue'
import DefaultTheme from 'vitepress/theme'
import { useData, useRouter, withBase } from 'vitepress'
import { data as pairs } from './plain.data.mjs'

const CLICKS = 3
const WINDOW_MS = 600
const SUFFIX = '.simple'

const { page } = useData()
const router = useRouter()
let clicks = []

function counterpart() {
  const path = page.value.relativePath.replace(/\.md$/, '')
  if (path.endsWith(SUFFIX)) {
    const base = path.slice(0, -SUFFIX.length)
    return pairs.includes(base) ? base : null
  }
  return pairs.includes(path) ? path + SUFFIX : null
}

function onClick(event) {
  if (!(event.target instanceof Element) || !event.target.closest('.vp-doc h1')) {
    clicks = []
    return
  }
  const now = event.timeStamp
  clicks = clicks.filter((t) => now - t < WINDOW_MS)
  clicks.push(now)
  if (clicks.length < CLICKS) return
  clicks = []
  const target = counterpart()
  if (!target) return
  window.getSelection()?.removeAllRanges()
  router.go(withBase(`/${target}`))
}

onMounted(() => document.addEventListener('click', onClick))
onBeforeUnmount(() => document.removeEventListener('click', onClick))
</script>

<template>
  <DefaultTheme.Layout />
</template>
