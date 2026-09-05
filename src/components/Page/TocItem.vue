<script setup lang="ts">
// 通用 TOC 的递归行：渲染单个节点（标题/章节），点击定位到对应块；
// 书源叶子节点带 cfi 时显示「原文」跳回阅读器。自身递归渲染子树。
import { ChevronRight } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref } from 'vue'

export interface TocNode {
  id: string
  title: string
  level: number
  blockId: string
  cfi?: string | null
  children: TocNode[]
}

defineOptions({ name: 'TocItem' })

const props = defineProps<{
  node: TocNode
  depth: number
  canJump: boolean
  /** 当前滚动高亮对应的 blockId（由 Toc 计算并向下透传） */
  activeId?: string
}>()

/** 本节点是否为当前所在标题 */
const active = computed(() => (props.activeId ?? '') === props.node.blockId)

const emit = defineEmits<{
  (e: 'locate', blockId: string): void
  (e: 'jump', cfi: string): void
}>()

const expanded = ref(true)

/** 标题文本元素：用于判断是否被 ellipsis 裁剪 */
const titleEl = ref<HTMLElement | null>(null)
/** 悬浮全文提示 */
const showTip = ref(false)
const tipStyle = ref<Record<string, string>>({})

function onRow() {
  emit('locate', props.node.blockId)
}
function onChevron(e: MouseEvent) {
  e.stopPropagation()
  expanded.value = !expanded.value
}
function onJump(e: MouseEvent, cfi: string) {
  e.stopPropagation()
  emit('jump', cfi)
}
function forwardLocate(id: string) {
  emit('locate', id)
}
function forwardJump(cfi: string) {
  emit('jump', cfi)
}

/** 文本是否被 ellipsis 裁剪：scrollWidth 超出 clientWidth 即可判定 */
function isClipped(): boolean {
  const el = titleEl.value
  return !!el && el.scrollWidth > el.clientWidth + 1
}

function onEnter(e: MouseEvent) {
  if (!isClipped()) return
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  tipStyle.value = {
    position: 'fixed',
    top: `${Math.round(r.bottom + 6)}px`,
    left: `${Math.round(r.left)}px`,
    maxWidth: 'min(420px, calc(100vw - 24px))'
  }
  showTip.value = true
}
function onLeave() {
  showTip.value = false
}

onBeforeUnmount(() => {
  showTip.value = false
})
</script>

<template>
  <li class="toc-item">
    <div
      class="toc-row"
      :class="{ 'has-children': node.children.length > 0, 'is-active': active }"
      :style="{ paddingLeft: 8 + depth * 14 + 'px' }"
      @click="onRow"
      @mouseenter="onEnter"
      @mouseleave="onLeave"
    >
      <ChevronRight
        v-if="node.children.length > 0"
        class="chev"
        :class="{ open: expanded }"
        :size="13"
        @click.stop="onChevron"
      />
      <span
        v-else
        class="chev-placeholder"
      />
      <span
        ref="titleEl"
        class="row-title"
      >{{ node.title }}</span>
      <button
        v-if="node.cfi && canJump"
        class="jump-btn"
        title="回到书中该位置"
        @click.stop="onJump($event, node.cfi!)"
      >
        原文
      </button>
    </div>
    <ul
      v-if="node.children.length > 0 && expanded"
      class="toc-children"
    >
      <TocItem
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :can-jump="canJump"
        :active-id="activeId"
        @locate="forwardLocate"
        @jump="forwardJump"
      />
    </ul>
  </li>
  <Teleport to="body">
    <div
      v-if="showTip"
      class="toc-tip"
      :style="tipStyle"
    >
      {{ node.title }}
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.toc-item {
  list-style: none;
}

.toc-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;

  &:hover {
    background: var(--bg-hover);
  }

  // 滚动联动高亮：左侧强调条 + 强调色文字（无底色，保持浮层无背景风格）
  &.is-active {
    box-shadow: inset 2px 0 0 var(--accent);

    .row-title {
      color: var(--accent);
    }
  }
}

.row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.chev {
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: transform 120ms ease;

  &.open {
    transform: rotate(90deg);
  }
}

.chev-placeholder {
  width: 13px;
  flex-shrink: 0;
}

.jump-btn {
  flex-shrink: 0;
  border: none;
  background: transparent;
  padding: 0 4px;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  opacity: 0;
  transition: opacity 100ms ease, color 100ms ease;

  &:hover {
    color: var(--accent);
  }
}

.toc-row:hover .jump-btn {
  opacity: 1;
}

// 悬浮全文提示：仅当标题被 ellipsis 裁剪时显示，Teleport 到 body 规避面板 overflow:hidden 裁剪
.toc-tip {
  z-index: calc(var(--z-sidebar) + 10);
  padding: 6px 10px;
  background: var(--bg-elevated, var(--bg-hover));
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  line-height: 1.4;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  white-space: normal;
  word-break: break-word;
  pointer-events: none;
}
</style>
