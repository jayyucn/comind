<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { useEditorStore } from '../stores/editor'
import { useBlockStore } from '../stores/blocks'
import { useSortable } from '../composables/useSortable'
import { useNavigateToPage } from '../composables/useNavigateToPage'
import Editor from './Editor.vue'

const props = defineProps<{
  blockId: string
  block: import('../types/block').BlockWithPos
}>()

const editorStore = useEditorStore()
const blockStore = useBlockStore()
const { navigateToPage } = useNavigateToPage()

const isActive = computed(() => editorStore.activeBlockId === props.blockId)
const children = computed(() => blockStore.getChildren(props.blockId))

/** 页面是否仅有一个空 Block（唯一场景显示 placeholder） */
const isSingleEmptyBlock = computed(() => {
  const contentBlocks = blockStore.blocks.filter(
    b => b.pageId === blockStore.currentPageId && !b.isPage
  )
  return contentBlocks.length === 1 && contentBlocks[0].content === '' && contentBlocks[0].id === props.blockId
})

const editorRef = ref<InstanceType<typeof Editor> | null>(null)
const childrenRef = ref<HTMLElement | null>(null)
const levelLineRef = ref<HTMLElement | null>(null)
const cursorPos = ref(0)
const levelLineHeight = ref('0px')
const levelLineTop = ref('0px')

// ── 子节点容器的 Sortable ──────────────────────────────────────────────
onMounted(() => {
  if (childrenRef.value) {
    useSortable(childrenRef.value)
    updateChildrenHeight()
  }
})

watch(
  isActive,
  async (active) => {
    if (active) {
      await nextTick()
      if (editorRef.value) {
        const pendingPos = editorStore.consumeCursorPos()
        if (pendingPos !== null) {
          editorRef.value.focus(pendingPos)
        } else {
          editorRef.value.focus('end')
        }
      }
    }
  },
  { immediate: false }
)

const indentDepth = computed(() => {
  let depth = 0
  let pid = props.block.parentId
  while (pid) {
    depth++
    const parent = blockStore.blocks.find(b => b.id === pid)
    pid = parent?.parentId ?? null
  }
  return depth
})

/** 缩进宽度（每层 24px） */
const indentWidth = computed(() => `${indentDepth.value * 24}px`)

/** 层级线左偏移（缩进宽度 - 2px） */
const levelLineLeft = computed(() => {
  const indentPx = indentDepth.value * 24 + 9
  return `${indentPx}px`
})

/** 是否折叠 - 从 props 读取初始值，确保组件重建时状态正确 */
const collapsed = ref(props.block.collapsed ?? false)

/** 监听外部 collapsed 变化（跨组件/页面恢复时同步） */
watch(() => props.block.collapsed, (newVal) => {
  if (collapsed.value !== newVal) {
    collapsed.value = newVal ?? false
  }
}, { immediate: true })

/** 动画进行中（防止快速切换导致动画错乱） */
const isAnimating = ref(false)

/** 当前子节点展开总高度（px）
 *  当子块挂载/卸载或内容变化时更新。
 *  用于嵌套折叠场景：子块已折叠时 scrollHeight=0，
 *  必须用此值作为展开动画的目标高度。 */
const childrenHeight = ref(0)

/** 更新 childrenHeight：计算当前 .block-children 的 scrollHeight */
async function updateChildrenHeight() {
  if (childrenRef.value) {
    childrenHeight.value = childrenRef.value.scrollHeight
  }
  /** 更新层级线高度 */
  calculateLevelLineHeight()
}

/** 监听直接子块数量变化时更新 childrenHeight
 *  当子块挂载/卸载时，scrollHeight 会反映新的完整展开高度，
 *  这解决了嵌套折叠场景中子块已折叠时 scrollHeight=0 的问题。 */
watch(children, async () => {
  await nextTick()
  updateChildrenHeight()
}, { deep: false })

/**
 * 监听 collapsed 状态，通过 nextTick + requestAnimationFrame 精确控制 maxHeight：
 * - 折叠：动画设为 0
 * - 展开：使用 childrenHeight（而非 scrollHeight，解决嵌套折叠时 scrollHeight=0 的问题）
 */
watch(collapsed, async (isCollapsed) => {
  if (!childrenRef.value) return

  if (isCollapsed) {
    // 折叠：先恢复到当前高度，再异步设为 0
    childrenRef.value.style.maxHeight = childrenRef.value.scrollHeight + 'px'
    await nextTick()
    requestAnimationFrame(() => {
      if (childrenRef.value) {
        childrenRef.value.style.maxHeight = '0px'
      }
      setTimeout(() => { isAnimating.value = false }, 220)
    })
    isAnimating.value = true
  } else {
    // 展开：使用 childrenHeight（所有子块完整展开时的高度）
    const targetHeight = childrenHeight.value || childrenRef.value.scrollHeight
    await nextTick()
    requestAnimationFrame(() => {
      if (childrenRef.value) {
        childrenRef.value.style.maxHeight = targetHeight + 'px'
      }
      setTimeout(() => { isAnimating.value = false }, 220)
    })
    isAnimating.value = true
  }
})

/**
 * 计算层级线高度：从当前 block 下方开始，到最后一个子孙节点底部
 */
function calculateLevelLineHeight() {
  if (!levelLineRef.value) return

  const blockEl = levelLineRef.value.parentElement
  if (!blockEl) return

  const blockRect = blockEl.getBoundingClientRect()
  const blockBottom = blockRect.bottom

  if (childrenRef.value) {
    const lastChild = childrenRef.value.lastElementChild as HTMLElement | null
    if (lastChild) {
      const lastChildRect = lastChild.getBoundingClientRect()
      const height = lastChildRect.bottom - blockBottom
      levelLineHeight.value = Math.max(0, height) + 'px'
    } else {
      levelLineHeight.value = '0px'
    }
  } else {
    levelLineHeight.value = '0px'
  }
  levelLineTop.value = `${blockRect.height}px`
}

/** mousedown：捕获点击坐标，在 tiptap 挂载前通知 editor store */
function handleContentMouseDown(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.block-link')) return

  const cursorPosVal = getCaretPositionFromPoint(e.clientX, e.clientY) ?? 0
  editorStore.setCursorPos(cursorPosVal + 1)
  editorStore.activateBlock(props.blockId)
}

function getCaretPositionFromPoint(x: number, y: number): number | null {
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y)
    return pos?.offset ?? null
  }
  return null
}

async function handleSave(content: string) {
  await blockStore.updateBlockContent(props.blockId, content)
}

async function handleSplit(cursorPosArg: number) {
  if (editorRef.value) {
    editorRef.value.markSaved()
    await handleSave(editorRef.value.getText())
  }
  editorStore.deactivateBlock()
  const newBlock = await blockStore.splitBlock(props.blockId, cursorPosArg, collapsed.value)
  if (newBlock) {
    editorStore.activateBlock(newBlock.id, 1)
  }
}

async function handleMerge() {
  if (editorRef.value) {
    editorRef.value.markSaved()
    await handleSave(editorRef.value.getText())
  }
  editorStore.deactivateBlock()
  const result = await blockStore.mergeWithPrevious(props.blockId)
  if (result) {
    editorStore.activateBlock(result.id, result.cursorPos)
  }
}

async function handleDelete() {
  const siblings = blockStore.blocks
    .filter(b => b.parentId === props.block.parentId && b.pageId === props.block.pageId && b.left < props.block.left)
    .sort((a, b) => b.left - a.left)
  const prevId = siblings[0]?.id

  if (!prevId) {
    if (editorRef.value) editorRef.value.markSaved()
    await blockStore.updateBlockContent(props.blockId, '')
    return
  }

  if (editorRef.value) editorRef.value.markSaved()
  editorStore.deactivateBlock()
  await blockStore.deleteBlock(props.blockId)
  if (prevId) {
    editorStore.activateBlock(prevId)
  }
}

async function handleIndent() {
  if (editorRef.value) {
    editorRef.value.markSaved()
    await handleSave(editorRef.value.getText())
  }
  editorStore.deactivateBlock()
  await blockStore.indent(props.blockId)
  editorStore.activateBlock(props.blockId)
}

async function handleOutdent() {
  if (editorRef.value) {
    editorRef.value.markSaved()
    await handleSave(editorRef.value.getText())
  }
  editorStore.deactivateBlock()
  await blockStore.outdent(props.blockId)
  editorStore.activateBlock(props.blockId)
}

async function handleMoveUp() {
  if (editorRef.value) {
    editorRef.value.markSaved()
    await handleSave(editorRef.value.getText())
  }
  const prevBlock = blockStore.findPreviousBlockInTreeOrder(props.blockId)
  if (prevBlock) {
    editorStore.deactivateBlock()
    editorStore.activateBlock(prevBlock.id)
  }
}

async function handleMoveDown() {
  if (editorRef.value) {
    editorRef.value.markSaved()
    await handleSave(editorRef.value.getText())
  }
  const nextBlock = blockStore.findNextBlockInTreeOrder(props.blockId)
  if (nextBlock) {
    editorStore.deactivateBlock()
    editorStore.activateBlock(nextBlock.id)
  }
}

async function handleExitEdit() {
  if (editorRef.value) {
    editorRef.value.markSaved()
    await handleSave(editorRef.value.getText())
  }
  editorStore.deactivateBlock()
}

function handleCursorChange(pos: number) {
  cursorPos.value = pos
}

function handleContentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const link = target.closest('.block-link') as HTMLElement | null
  if (!link) return

  if (link.dataset.external) {
    window.open(link.dataset.external, '_blank')
    return
  }

  const pageName = link.dataset.page
  if (pageName) {
    navigateToPage(pageName).catch(err => {
      console.error('导航失败:', err)
    })
  }
}

/** 切换折叠状态，并同步到 store */
async function handleToggleCollapse() {
  if (children.value.length === 0 || isAnimating.value) return

  const newCollapsed = !collapsed.value
  collapsed.value = newCollapsed

  // 同步到 store 持久化
  await blockStore.updateBlockCollapsed(props.blockId, newCollapsed)
}

/** HTML 转义（防 XSS） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 渲染内容（[[链接]] 高亮、#标签 样式） */
function renderContent(text: string): string {
  const html = escapeHtml(text)
  return html
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, alias) => {
      const display = alias || target
      return `<span class="block-link" data-page="${escapeHtml(target)}">${display}</span>`
    })
    .replace(/\[\[(https?:\/\/[^\]]+)\]\]/g, (_, url) => {
      return `<span class="block-link external" data-external href="${escapeHtml(url)}">${url}</span>`
    })
    .replace(/#([\p{L}_][\p{L}\p{N}_]*(?:\/[\p{L}_][\p{L}\p{N}_]*)*)/gu, (_, tag, offset) => {
      if (tag.includes('.')) return `#${tag}`
      const before = html.slice(Math.max(0, offset - 20), offset)
      if (/\w\/$/.test(before)) return `#${tag}`
      // 层级标签：斜杠分隔，每级独立着色
      const parts = tag.split('/')
      const rendered = parts.map((p: string, i: number) => {
        const span = `<span class="tag-segment">${escapeHtml(p)}</span>`
        return i < parts.length - 1 ? span + '<span class="tag-sep">/</span>' : span
      }).join('')
      return `<span class="block-tag">#${rendered}</span>`
    })
}
</script>

<template>
  <div class="block" :class="{ active: isActive }" :data-block-id="blockId">
    <div class="block-row">
      <!-- 层级线 -->
      <div v-if="children.length > 0 && !collapsed" ref="levelLineRef" class="block-level-line"
        :style="{ top: levelLineTop, height: levelLineHeight, left: levelLineLeft }"></div>

      <!-- 缩进占位 -->
      <div class="block-indent" :style="{ width: indentWidth }"></div>

      <!-- Bullet -->
      <span class="block-bullet" :class="{ collapsed }"
        @click.stop="handleToggleCollapse">
        <span v-if="children.length > 0" class="bullet-chevron" :class="{ 'is-collapsed': collapsed }"></span>
        <span v-else class="bullet-dot"></span>
      </span>

      <!-- 内容区 -->
      <div class="block-content" @mousedown="handleContentMouseDown">
        <Editor v-if="isActive" ref="editorRef" :block-id="blockId" :content="block.content" @save="handleSave"
          @split="handleSplit" @merge="handleMerge" @delete="handleDelete" @indent="handleIndent"
          @outdent="handleOutdent" @move-up="handleMoveUp" @move-down="handleMoveDown" @exit-edit="handleExitEdit"
          @cursor-change="handleCursorChange" />
        <div v-else class="block-text" @click="handleContentClick">
          <span v-if="isSingleEmptyBlock" class="block-placeholder">Type something...</span>
          <span v-else v-html="renderContent(block.content)"></span>
        </div>
      </div>
    </div>

    <!--
      子节点容器（Sortable group）
      - v-if 只在有子节点时渲染（Sortable 不需要空容器）
      - childrenRef = 此 div，onMounted 时初始化 Sortable
      - JS watch collapsed 状态直接控制 max-height，实现折叠动画
      - 注意：v-if 移除时 Sortable.destroy() 由 onBeforeUnmount 清理
    -->
    <div v-if="children.length > 0" ref="childrenRef" class="block-children" :data-parent-id="blockId">
      <Block v-for="child in children" :key="child.id" :block-id="child.id" :block="child" />
    </div>
  </div>
</template>

<style scoped>
.block {
  position: relative;
  user-select: none;
}

.block-row {
  display: flex;
  align-items: flex-start;
  min-height: 1.8em;
  line-height: 1.8;
}

.block-indent {
  flex-shrink: 0;
  height: 100%;
}

/* 层级线 */
.block-level-line {
  position: absolute;
  width: 1px;
  background: var(--color-accent);
  opacity: 0.15;
  pointer-events: none;
  z-index: 0;
  transition: height 200ms ease-out, opacity 200ms ease-out;
}

/* Bullet 区域 */
.block-bullet {
  flex-shrink: 0;
  width: 20px;
  height: 1.8em;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
}

/* ── Bullet 圆点（叶节点） ── */
.bullet-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-accent);
  opacity: 0.35;
  transform: translateY(1px);
  transition: opacity 150ms ease-out, transform 150ms ease-out, box-shadow 150ms ease-out;
  flex-shrink: 0;
}

/* ── Chevron 箭头（父节点） ── */
.bullet-chevron {
  width: 7px;
  height: 7px;
  border-right: 1.5px solid var(--color-accent);
  border-bottom: 1.5px solid var(--color-accent);
  transform: rotate(45deg) translateY(1px);
  opacity: 0.45;
  transition: transform 180ms ease-out, opacity 150ms ease-out;
  flex-shrink: 0;
}

.bullet-chevron.is-collapsed {
  transform: rotate(-45deg) translateY(1px);
}

/* ── Hover：墨水晕开感 ── */
.block-bullet:hover .bullet-dot {
  opacity: 0.7;
  transform: scale(1.4) translateY(1px);
  box-shadow: 0 0 0 3px var(--accent-08);
}

.block-bullet:hover .bullet-chevron {
  opacity: 0.75;
  transform: rotate(45deg) scale(1.2) translateY(1px);
  box-shadow: 0 0 0 3px var(--accent-06);
}

.block-bullet:hover .bullet-chevron.is-collapsed {
  transform: rotate(-45deg) scale(1.2) translateY(1px);
}

/* ── Active Block ── */
.block.active .bullet-dot {
  opacity: 0.55;
}

.block.active .bullet-chevron {
  opacity: 0.6;
}

.block-content {
  flex: 1;
  cursor: text;
  min-width: 0;
}

.block-text {
  min-height: 1.8em;
  padding: 0 4px;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-word;
}

.block-placeholder {
  color: var(--color-ink-faint);
  font-style: italic;
  pointer-events: none;
}

.block.active .block-text {
  background: var(--accent-06);
}

/* 子节点容器 */
.block-children {
  overflow: hidden;
  padding-left: 20px;
  /* 初始 maxHeight 由 JS 控制（见 Transition 钩子） */
}

/* ── 折叠过渡动画 ──
   注意：不设置 max-height 值，JS 钩子通过 el.style.maxHeight 动态控制
   （避免 CSS 优先级（!important）阻止 JS 设置的内联值） */
.collapse-enter-active,
.collapse-leave-active {
  transition: max-height 200ms ease-out;
  overflow: hidden;
}

/* Link & Tag styles */
:deep(.block-link) {
  color: var(--color-accent);
  cursor: pointer;
  border-bottom: 1px solid var(--accent-40);
}

:deep(.block-link.external) {
  color: var(--color-external);
  border-bottom-color: var(--ext-40);
}

:deep(.block-tag) {
  color: var(--color-tag);
  background: var(--tag-10);
  padding: 0 2px;
  border-radius: 3px;
  font-size: 0.9em;
}

:deep(.block-tag .tag-sep) {
  color: var(--tag-40);
  margin: 0 1px;
}

:deep(.block-tag .tag-segment) {
  /* 每级标签继承父级颜色，可按需分级着色 */
}
</style>
