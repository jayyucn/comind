<script setup lang="ts">
import { computed } from 'vue';
import { parseHeading, useContentRenderer } from '../../../../composables/useContentRenderer';
import { useBlockStore } from '../../../../stores/blocks';
import { useTagsStore } from '../../../../stores/tags';
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
const tagsStore = useTagsStore()

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

/**
 * 渲染态标签色动态解析（ADR-0050 D11）：色真相在 tagsStore，渲染时实时取 ——
 * 标签改色后已渲染 chip 即时换色，不等 renderSegments 快照重建。与编辑态
 * `resolveInlineTag` 同构（渲染器不碰 Pinia，宿主注入闭包；闭包在 computed 内求值，
 * 对 tagsStore 的读取被依赖收集，改色即触发重渲）。
 *
 * - 标签树未就绪 → undefined：渲染器回退 seg.color 快照（加载窗口内不整批脱色）；
 *   树加载（`BlockFieldZone` 挂载即 ensureLoaded）到位后重渲为实时色。
 * - 树就绪：id 优先、title 兜底（与 Rust tag_cache 按 title 命中同口径）；
 *   查无（已删）→ ''（无色，与 Rust 缺行时 id/color 置空的兜底一致）。
 */
function resolveTagColor(tagId: string, title: string): string | undefined {
  if (!tagsStore.loaded) return undefined
  const byId = tagId ? tagsStore.getTagById(tagId) : undefined
  if (byId && !byId.deleted_at) return byId.color
  const byTitle = tagsStore.allTags.find((t) => t.title === title)
  return byTitle?.color ?? ''
}

const headingContent = computed(() => {
  if (!heading.value) return ''
  const segs = segments.value
  const input = { content: heading.value.title, blockId: props.blockId ?? '', resolveTagColor }
  return segs ? renderContentToHtml({ ...input, segments: segs })
              : renderContentToHtml({ ...input, segments: [] })
})

const normalContent = computed(() => {
  if (heading.value) return ''
  const segs = segments.value
  const input = { content: props.content, blockId: props.blockId ?? '', resolveTagColor }
  return segs ? renderContentToHtml({ ...input, segments: segs })
              : renderContentToHtml({ ...input, segments: [] })
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
