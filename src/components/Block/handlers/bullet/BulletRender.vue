<script setup lang="ts">
import { computed } from 'vue'

import { parseParagraphStyle, shiftSegments, useContentRenderer } from '../../../../composables/useContentRenderer'
import { useBlockStore } from '../../../../stores/blocks'
import { useTagsStore } from '../../../../stores/tags'
import { readInlineMarks } from '../../../../utils/inline-marks'
import SaveErrorBadge from './SaveErrorBadge.vue'

const props = defineProps<{
  content: string
  showPlaceholder?: boolean
  blockId?: string
  /** block.format：行内格式存于 `format.inlineMarks` */
  blockFormat?: Record<string, unknown>
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

/** `format` 只用于标题的双读兜底（模板插入的标题块正文里没有前缀） */
const paragraph = computed(() => parseParagraphStyle(props.content, { format: props.blockFormat }))

const headingTag = computed(() => {
  const style = paragraph.value.style
  return style === 'h1' || style === 'h2' || style === 'h3' ? style : null
})

/**
 * 列表项（`- ` 无序 / `1. ` 有序）：渲染态画一个常显标记，正文缩进对齐。
 * 与标题同一层语法 —— 都是正文前缀，不是块类型。
 */
const list = computed(() => {
  const { style, listIndex } = paragraph.value
  if (style !== 'ul' && style !== 'ol') return null
  return { kind: style === 'ol' ? 'ordered' : 'unordered', index: listIndex }
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

const inlineMarks = computed(() => readInlineMarks(props.blockFormat, props.content.length))

/**
 * 带前缀的行（标题 / 列表）：渲染丢掉前缀，正文用 `title`。
 *
 * 两处坐标都要跟着平移，否则按错偏移切字：
 * - `markOffset` −前缀长：marks 存在 content 坐标系；
 * - `shiftSegments` −前缀长：segments 由 Rust 按**完整 content** 算出（含前缀），
 *   含 `#tag`/`[[link]]` 的标题以前在这里会串字。
 */
const prefixedContent = computed(() => {
  const { title, prefixLength } = paragraph.value
  if (prefixLength === 0) return ''
  const input = {
    content: title,
    blockId: props.blockId ?? '',
    resolveTagColor,
    inlineMarks: inlineMarks.value,
    markOffset: -prefixLength,
  }
  const segs = segments.value
  return segs
    ? renderContentToHtml({ ...input, segments: shiftSegments(segs, prefixLength) })
    : renderContentToHtml({ ...input, segments: [] })
})

const normalContent = computed(() => {
  if (paragraph.value.prefixLength > 0) return ''
  const segs = segments.value
  const input = {
    content: props.content,
    blockId: props.blockId ?? '',
    resolveTagColor,
    inlineMarks: inlineMarks.value,
  }
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
      <span v-html="prefixedContent" />
    </component>
    <!-- 列表项：常显标记 + 正文。标记单独占一列（flex 的挂起缩进），正文换行时对齐在
         marker 右侧而不是绕回 marker 底下。 -->
    <div
      v-else-if="list"
      class="block-list"
      :class="`is-${list.kind}`"
    >
      <span
        class="block-list-marker"
        aria-hidden="true"
      >{{ list.kind === 'ordered' ? `${list.index}.` : '•' }}</span>
      <!-- vue/no-v-html: 同标题分支，渲染器已转义，受控输出 -->
      <!-- eslint-disable vue/no-v-html -->
      <span
        class="block-list-text"
        v-html="prefixedContent"
      />
      <!-- eslint-enable vue/no-v-html -->
    </div>
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
