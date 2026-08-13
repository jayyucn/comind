<script setup lang="ts">
import { computed, ref } from 'vue'
import { useContentRenderer, parseHeading } from '../../../../composables/useContentRenderer'
import { useBlockStore } from '../../../../stores/blocks'

const props = defineProps<{
  content: string
  showPlaceholder?: boolean
  blockId?: string
}>()

const emit = defineEmits<{
  (e: 'content-click', event: MouseEvent): void
}>()

const { renderContentToHtml } = useContentRenderer()
const blockStore = useBlockStore()

/** S9: retry-saving state — true while retrySave is in-flight */
const isRetrying = ref(false)

const hasSaveError = computed(() => {
  if (!props.blockId) return false
  return !!blockStore.saveErrors[props.blockId]
})

async function handleRetrySave() {
  if (!props.blockId || isRetrying.value) return
  isRetrying.value = true
  try {
    await blockStore.retrySave(props.blockId)
  } finally {
    isRetrying.value = false
  }
}

const heading = computed(() => parseHeading(props.content))

const headingTag = computed(() => {
  if (!heading.value) return null
  return `h${heading.value.level}` as const
})

/** Get render segments from the block store (pre-computed by Rust via getPageWithBlocks) */
const segments = computed(() => {
  if (!props.blockId) return undefined
  return blockStore.getBlock(props.blockId)?.renderSegments
})

const headingContent = computed(() => {
  if (!heading.value) return ''
  const segs = segments.value
  return segs ? renderContentToHtml({ segments: segs, content: heading.value.title, blockId: props.blockId ?? '' })
              : renderContentToHtml({ segments: [], content: heading.value.title, blockId: props.blockId ?? '' })
})

const normalContent = computed(() => {
  if (heading.value) return ''
  const segs = segments.value
  return segs ? renderContentToHtml({ segments: segs, content: props.content, blockId: props.blockId ?? '' })
              : renderContentToHtml({ segments: [], content: props.content, blockId: props.blockId ?? '' })
})

function handleClick(e: MouseEvent) {
  emit('content-click', e)
}
</script>

<template>
  <div class="block-text" @click="handleClick">
    <span v-if="showPlaceholder && !content" class="block-placeholder">写点什么…</span>
    <component
      v-else-if="headingTag"
      :is="headingTag"
      :class="['block-heading', headingTag]"
      v-html="headingContent"
    ></component>
    <span v-else v-html="normalContent"></span>
    <!-- S9: save error indicator (rendered state only) -->
    <span
      v-if="hasSaveError"
      class="save-error-dot"
      :class="{ 'save-error-dot--retrying': isRetrying }"
      @click.stop="handleRetrySave"
      title="保存失败，点击重试"
    ></span>
  </div>
</template>
