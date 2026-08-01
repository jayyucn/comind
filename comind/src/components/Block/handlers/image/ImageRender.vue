<script setup lang="ts">
import { ref, watch } from 'vue'
import { assetStorage } from '../../../../utils/asset'

const props = defineProps<{
  content: string
  showPlaceholder?: boolean
}>()

const emit = defineEmits<{
  (e: 'content-click', event: MouseEvent): void
  (e: 'clear'): void
}>()

const imgSrc = ref('')
const showActions = ref(false)
const copySuccess = ref(false)

const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/

function parseImage(content: string): { alt: string; url: string } | null {
  const match = content.match(IMAGE_REGEX)
  if (!match) return null
  return { alt: match[1] || '', url: match[2] || '' }
}

const parsed = ref<{ alt: string; url: string } | null>(null)

watch(
  () => props.content,
  async (content) => {
    const result = parseImage(content)
    parsed.value = result
    if (!result) {
      imgSrc.value = ''
      return
    }
    if (result.url.startsWith('asset://')) {
      const id = result.url.slice(8)
      try {
        const url = await assetStorage.loadUrl(id)
        imgSrc.value = url
      } catch {
        imgSrc.value = ''
      }
    } else {
      imgSrc.value = result.url
    }
  },
  { immediate: true }
)

function handleClick(e: MouseEvent) {
  emit('content-click', e)
}

async function copyImageUrl() {
  if (!parsed.value) return
  const url = parsed.value.url.startsWith('asset://')
    ? imgSrc.value
    : parsed.value.url
  try {
    await navigator.clipboard.writeText(url)
    copySuccess.value = true
    setTimeout(() => { copySuccess.value = false }, 1500)
  } catch {
    copySuccess.value = false
  }
}

function clearImage() {
  emit('clear')
}
</script>

<template>
  <div
    class="block-image"
    @click="handleClick"
    @mouseenter="showActions = true"
    @mouseleave="showActions = false"
  >
    <div v-if="showPlaceholder && !imgSrc" class="block-placeholder">
      Enter image...
    </div>
    <div v-else-if="imgSrc" class="image-container">
      <img :src="imgSrc" :alt="parsed?.alt ?? ''" />
      <div v-if="showActions" class="image-actions">
        <button class="image-action-btn" @mousedown.stop @click.stop="copyImageUrl" :title="copySuccess ? 'Copied!' : 'Copy URL'">
          <span v-if="copySuccess">✓</span>
          <span v-else>📋</span>
        </button>
        <button class="image-action-btn" @mousedown.stop @click.stop="clearImage" title="Clear image">
          ✕
        </button>
      </div>
    </div>
    <div v-else class="block-placeholder">Enter image...</div>
  </div>
</template>

<style scoped>
.block-image {
  position: relative;
  cursor: text;
  min-height: 1.5em;
}

.image-container {
  position: relative;
  display: inline-block;
}

.image-container img {
  max-width: 100%;
  max-height: 400px;
  border-radius: 4px;
  display: block;
}

.image-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.image-container:hover .image-actions {
  opacity: 1;
}

.image-action-btn {
  background: rgba(28, 25, 23, 0.7);
  color: #fff;
  border: none;
  border-radius: 4px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: var(--text-sm);
  transition: background 0.15s ease;
}

.image-action-btn:hover {
  background: rgba(28, 25, 23, 0.9);
}

.block-placeholder {
  color: var(--text-tertiary);
  font-style: italic;
}
</style>