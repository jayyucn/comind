<script setup lang="ts">
import { computed } from 'vue';
import { parseHeading, useContentRenderer } from '../../../../composables/useContentRenderer';
import { useBlockStore } from '../../../../stores/blocks';
import SaveErrorBadge from './SaveErrorBadge.vue';

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

const hasSaveError = computed(() => {
  if (!props.blockId) return false
  return !!blockStore.saveErrors[props.blockId]
})

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
  <div
    class="block-text"
    @click="handleClick"
  >
    <span
      v-if="showPlaceholder && !content"
      class="block-placeholder"
    >写点什么…</span>
    <component
      :is="headingTag"
      v-else-if="headingTag"
      :class="['block-heading', headingTag]"
    >
      <!-- eslint-disable-next-line vue/no-v-html -- 渲染器对所有插值已做 HTML 转义（useContentRenderer.escapeHtmlEntities），受控输出 -->
      <span v-html="headingContent" />
    </component>
    <!-- vue/no-v-html: 渲染器对所有插值已做 HTML 转义（useContentRenderer.escapeHtmlEntities），受控输出 -->
    <!-- eslint-disable vue/no-v-html -->
    <span
      v-else
      v-html="normalContent"
    />
    <!-- eslint-enable vue/no-v-html -->
    <!-- S9: 保存失败指示抽为独立展示组件，重试调度在其内部 -->
    <SaveErrorBadge
      v-if="hasSaveError"
      :block-id="props.blockId ?? ''"
      :save-error="hasSaveError"
    />
  </div>
</template>
