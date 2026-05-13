<script setup lang="ts">
/**
 * Block - 基于 TreeNode 的递归 Block 组件
 *
 * 架构变化（vs 旧版 useSortable）：
 * - 接收 TreeNode 而非 Block，子节点直接从 node.children 读取
 * - 子节点容器使用 VueDraggable（vue-draggable-plus）替代 Sortable.js
 * - 拖拽后 VueDraggable 直接修改 node.children（v-model），
 *   通过 inject 的 onDragEnd 同步回 store
 * - depth prop 替代 parentId 链计算缩进层级（O(1) vs O(n)）
 *
 * 数据流：
 *   tree ref (BlockList) → VueDraggable v-model → node.children (渲染)
 *   拖拽结束 → onDragEnd → syncTreeToStore → store → structureVersion++
 *   → BlockList watch → syncTreeToStore → tree 重建
 */
import { computed, ref, watch, nextTick, onMounted, inject } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useEditorStore } from '../../stores/editor'
import { useBlockStore } from '../../stores/blocks'
import { usePropertyStore } from '../../stores/property'
import { useNavigateToPage } from '../../composables/useNavigateToPage'
import { useTagFilter } from '../../composables/useTagFilter'
import { useContentRenderer } from '../../composables/useContentRenderer'
import Editor from '../Editor.vue'
import PropertyDisplay from './PropertyDisplay.vue'
import { usePageStore } from '../../stores/pages'
import { isDescendantOf } from '../../utils/block-helpers'
import { computeDropZone, computeSortPosition } from '../../composables/useDragDrop'
import type { TreeNode, Block } from '../../types/block'

defineOptions({
  name: 'Block'
})

const props = defineProps<{
  node: TreeNode
  pageId: string
  depth: number
}>()

const editorStore = useEditorStore()
const blockStore = useBlockStore()
const propertyStore = usePropertyStore()
const pageStore = usePageStore()
const { navigateToPage } = useNavigateToPage()
const { openFilter } = useTagFilter()
const { renderContentToHtml } = useContentRenderer()

// Load properties for this block
onMounted(async () => {
  await propertyStore.loadBlockProperties(blockId.value)
})

watch(() => props.node.id, async (newBlockId) => {
  if (newBlockId) {
    await propertyStore.loadBlockProperties(newBlockId)
  }
})

// 注入拖拽结束回调（由 BlockList 提供）
const onDragEnd = inject<() => void>('onDragEnd')

// ── 便捷访问 ──
const blockId = computed(() => props.node.id)
const block = computed(() => props.node.block)
const isActive = computed(() => editorStore.activeBlockId === blockId.value)

/** 页面是否仅有一个空 Block（唯一场景显示 placeholder） */
const isSingleEmptyBlock = computed(() => {
  const contentBlocks = blockStore.getBlocksByPage(pageStore.currentPageId)
  return contentBlocks.length === 1 && contentBlocks[0].content === '' && contentBlocks[0].id === blockId.value
})

const editorRef = ref<InstanceType<typeof Editor> | null>(null)
const cursorPos = ref(0)

// ── 常量配置 ──────────────────────────────────────────────
const COLLAPSE_ANIMATION_DURATION = 220 // ms
const INDENT_WIDTH_PER_LEVEL = 24 // px

// ── 放置目标类型 ──
type DropAction = 'sort' | 'nest' | 'promote' | null

interface DropTarget {
  action: DropAction
  toParentId: string | null
  beforeId: string | null
}

// ── 拖拽状态 ──
const dragState = ref<{
  currentDropTarget: DropTarget | null
  indicator: HTMLElement | null
}>({
  currentDropTarget: null,
  indicator: null
})

// ── 缩进（由 depth prop 直接计算，O(1)） ──
const indentWidth = computed(() => `${props.depth * INDENT_WIDTH_PER_LEVEL}px`)

// ── 折叠状态 ──
const collapsed = ref(block.value?.format?.collapsed ?? false)
const isAnimating = ref(false)
const childrenHeight = ref(0)

// VueDraggable ref（用于获取 DOM 元素做高度测量）
const draggableRef = ref<any>(null)

/** 获取子节点容器的 DOM 元素 */
const childrenEl = computed(() => {
  // VueDraggable 渲染 tag="div"，$el 即为该 div
  return draggableRef.value?.$el as HTMLElement | null
})

/** 子节点容器的 CSS 类 */
const childrenContainerClass = computed(() => ({
  'block-children': true,
  'has-children': !collapsed.value && props.node.children.length > 0,
  'is-collapsed': collapsed.value,
  'is-animating': isAnimating.value
}))

onMounted(() => {
  updateChildrenHeight()
})

watch(
  isActive,
  async (active) => {
    if (active) {
      await nextTick()
      if (editorRef.value) {
        const editor = editorRef.value.getEditor()
        if (editor) {
          editorStore.setActiveEditor(editor)
        }
        
        const pendingPos = editorStore.consumeCursorPos()
        if (pendingPos !== null) {
          editorRef.value.focus(pendingPos)
        } else {
          editorRef.value.focus('end')
        }
      }
    } else {
      editorStore.setActiveEditor(null)
    }
  },
  { immediate: false }
)

/** 更新 childrenHeight */
async function updateChildrenHeight() {
  const el = childrenEl.value
  if (el) {
    const scrollH = el.scrollHeight
    childrenHeight.value = scrollH > 0 ? scrollH : await calcAllChildrenHeight()
  }
}

/** 递归计算所有子块的展开高度 */
async function calcAllChildrenHeight(): Promise<number> {
  const el = childrenEl.value
  if (!el) return 0
  let total = 0
  for (const childEl of el.children) {
    const rowEl = childEl.querySelector('.block-row') as HTMLElement | null
    if (rowEl) total += rowEl.offsetHeight
    const grandchildrenEl = childEl.querySelector('.block-children') as HTMLElement | null
    if (grandchildrenEl) {
      const bid = (childEl as HTMLElement).dataset.blockId
      const blk = blockStore.blocks.find(b => b.id === bid)
      if (blk?.format?.collapsed) {
        total += 1
      } else {
        const orig = grandchildrenEl.style.maxHeight
        grandchildrenEl.style.maxHeight = 'none'
        total += grandchildrenEl.scrollHeight
        grandchildrenEl.style.maxHeight = orig
      }
    }
  }
  return total
}

/** 监听子节点数量/内容变化时更新 childrenHeight */
watch(
  () => props.node.children.map(c => c.id).join(','),
  async () => {
    await nextTick()
    updateChildrenHeight()
  },
  { flush: 'post' }
)

/** 监听折叠状态：同步到 store + 控制动画 */
watch(collapsed, async (isCollapsed) => {
  blockStore.updateBlockFormat(blockId.value, { collapsed: isCollapsed })

  if (props.node.children.length === 0) return

  await updateChildrenHeight()
  
  isAnimating.value = true
  setTimeout(() => { isAnimating.value = false }, COLLAPSE_ANIMATION_DURATION)
})

/** mousedown：捕获点击坐标，在 tiptap 挂载前通知 editor store */
function startEditingAtClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.block-link, .block-tag')) return

  const cursorPosVal = getCaretPositionFromPoint(e.clientX, e.clientY) ?? 0
  editorStore.setCursorPos(cursorPosVal + 1)
  editorStore.activateBlock(blockId.value)
}

function getCaretPositionFromPoint(x: number, y: number): number | null {
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y)
    return pos?.offset ?? null
  }
  return null
}

async function handleSave(content: string) {
  await blockStore.updateBlockContent(blockId.value, content)
}

/** 同步block未保存内容到store */
async function syncBlockContent() {
  if (editorRef.value) {
    editorRef.value.markSaved()
    await handleSave(editorRef.value.getText())
  }
}

/** 高阶函数：统一处理内容同步 */
function withContentSync<T extends (...args: any[]) => Promise<void>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    await syncBlockContent()
    return fn(...args)
  }) as T
}

const handleSplit = withContentSync(async (cursorPosArg: number) => {
  editorStore.deactivateBlock()
  const newBlock = await blockStore.insertBlockAtCursor(blockId.value, cursorPosArg, collapsed.value)
  if (newBlock) {
    editorStore.activateBlock(newBlock.id, 1)
  }
})

const handleMerge = withContentSync(async () => {
  editorStore.deactivateBlock()
  const result = await blockStore.mergeWithPrevious(blockId.value)
  if (result) {
    editorStore.activateBlock(result.id, result.cursorPos)
  }
})

async function handleDelete() {
  const prevBlock = blockStore.findPreviousBlockInTreeOrder(blockId.value)
  const prevId = prevBlock?.id

  if (!prevId) {
    if (editorRef.value) editorRef.value.markSaved()
    await blockStore.updateBlockContent(blockId.value, '')
    return
  }

  if (editorRef.value) editorRef.value.markSaved()
  editorStore.deactivateBlock()
  await blockStore.deleteBlock(blockId.value)
  if (prevId) {
    editorStore.activateBlock(prevId)
  }
}

const handleIndent = withContentSync(async () => {
  editorStore.deactivateBlock()
  await blockStore.indent(blockId.value)
  editorStore.activateBlock(blockId.value)
})

const handleOutdent = withContentSync(async () => {
  editorStore.deactivateBlock()
  await blockStore.outdent(blockId.value)
  editorStore.activateBlock(blockId.value)
})

const handleMoveUp = withContentSync(async () => {
  const prevBlock = blockStore.findPreviousBlockInTreeOrder(blockId.value)
  if (prevBlock) {
    editorStore.deactivateBlock()
    editorStore.activateBlock(prevBlock.id)
  }
})

const handleMoveDown = withContentSync(async () => {
  const nextBlock = blockStore.findNextBlockInTreeOrder(blockId.value)
  if (nextBlock) {
    editorStore.deactivateBlock()
    editorStore.activateBlock(nextBlock.id)
  }
})

const handleExitEdit = withContentSync(async () => {
  editorStore.deactivateBlock()
})

function handleCursorChange(pos: number) {
  cursorPos.value = pos
}

function handleContentClick(e: MouseEvent) {
  const target = e.target as HTMLElement

  const tagEl = target.closest('.block-tag') as HTMLElement | null
  if (tagEl) {
    const tagText = tagEl.textContent?.replace(/^#/, '').trim() ?? ''
    if (tagText) {
      openFilter(tagText)
    }
    return
  }

  const link = target.closest('.block-link') as HTMLElement | null
  if (!link) return

  if (link.dataset.external) {
    window.open(link.dataset.external, '_blank', 'noopener,noreferrer')
    return
  }
  const pageName = link.dataset.page
  if (pageName) {
    navigateToPage(pageName).catch(err => {
      console.error('导航失败:', err)
    })
  }
}

/** 切换折叠状态 */
async function toggleCollapse() {
  if (props.node.children.length === 0 || isAnimating.value) return
  collapsed.value = !collapsed.value
}

function findDropTarget(
  cursorX: number,
  cursorY: number,
  targetBlockEl: HTMLElement
): DropTarget | null {
  const bullet = targetBlockEl.querySelector('.block-bullet') as HTMLElement
  if (!bullet) return null

  const bulletRect = bullet.getBoundingClientRect()
  const zone = computeDropZone(cursorX, bulletRect)

  if (zone === 'left') {
    const parentBlock = targetBlockEl.parentElement?.closest('.block') as HTMLElement | null
    if (parentBlock) {
      return {
        action: 'promote',
        toParentId: parentBlock.dataset.blockId ?? null,
        beforeId: targetBlockEl.dataset.blockId ?? null
      }
    }
    return {
      action: 'sort',
      toParentId: null,
      beforeId: targetBlockEl.dataset.blockId ?? null
    }
  }

  if (zone === 'right') {
    return {
      action: 'nest',
      toParentId: targetBlockEl.dataset.blockId ?? null,
      beforeId: null
    }
  }

  const position = computeSortPosition(cursorY, bulletRect)
  const parentBlock = targetBlockEl.parentElement?.closest('.block') as HTMLElement | null
  const parentId = parentBlock?.dataset.blockId ?? null

  if (position === 'before') {
    return {
      action: 'sort',
      toParentId: parentId,
      beforeId: targetBlockEl.dataset.blockId ?? null
    }
  } else {
    const nextSibling = targetBlockEl.nextElementSibling as HTMLElement | null
    return {
      action: 'sort',
      toParentId: parentId,
      beforeId: nextSibling?.dataset.blockId ?? null
    }
  }
}

function getOrCreateIndicator(): HTMLElement {
  let indicator = document.querySelector('.drop-indicator') as HTMLElement | null
  if (!indicator) {
    indicator = document.createElement('div')
    indicator.className = 'drop-indicator'
    indicator.style.cssText = 'position:fixed;pointer-events:none;z-index:1000;opacity:0;transition:opacity 0ms;'
    document.body.appendChild(indicator)
    dragState.value.indicator = indicator
  }
  return indicator
}

function renderDropIndicator(targetBlockEl: HTMLElement, dropTarget: DropTarget) {
  const indicator = getOrCreateIndicator()
  const bullet = targetBlockEl.querySelector('.block-bullet')
  if (!bullet) {
    clearDropIndicator()
    return
  }

  const rect = bullet.getBoundingClientRect()

  if (rect.width <= 0 || rect.height <= 0) {
    clearDropIndicator()
    return
  }

  const viewportHeight = window.innerHeight
  const viewportWidth = window.innerWidth

  if (rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) {
    clearDropIndicator()
    return
  }

  const left = Math.max(0, Math.min(rect.left, viewportWidth - 1))
  const width = Math.max(1, Math.min(rect.right - rect.left, viewportWidth - left))

  indicator.style.left = `${left}px`
  indicator.style.width = `${width}px`
  indicator.style.top = `${rect.top}px`
  indicator.style.height = '2px'

  indicator.className = 'drop-indicator'
  if (dropTarget.action === 'sort') {
    const position = dropTarget.beforeId ? 'before' : 'after'
    if (position === 'after') {
      indicator.style.top = `${rect.bottom}px`
    } else {
      indicator.style.top = `${rect.top}px`
    }
    indicator.classList.add('sort')
  } else if (dropTarget.action === 'nest') {
    const targetDepth = parseInt(targetBlockEl.dataset.depth ?? '0', 10)
    const indentWidth = 24 * (targetDepth + 1)
    const nestLeft = Math.max(0, Math.min(rect.left + indentWidth, viewportWidth - 1))
    const nestWidth = Math.max(1, Math.min(rect.right - rect.left - indentWidth, viewportWidth - nestLeft))
    indicator.style.left = `${nestLeft}px`
    indicator.style.width = `${nestWidth}px`
    indicator.style.top = `${rect.top}px`
    indicator.style.height = `${Math.max(1, rect.height)}px`
    indicator.classList.add('nest')
  } else if (dropTarget.action === 'promote') {
    indicator.style.top = `${rect.top}px`
    indicator.classList.add('promote')
  }

  indicator.classList.add('visible')
}

function clearDropIndicator() {
  const indicator = document.querySelector('.drop-indicator') as HTMLElement | null
  if (indicator) {
    indicator.classList.remove('visible')
  }
  dragState.value.indicator = null
}

/** 拖拽移动检测（防止循环嵌套） */
function handleDragMove(evt: any): boolean | void {
  const draggedId = (evt.dragged as HTMLElement)?.dataset.blockId
  const related = evt.related as HTMLElement

  if (draggedId && related) {
    const targetBlock = related.closest('.block') as HTMLElement | null
    if (targetBlock?.dataset.blockId === draggedId) {
      clearDropIndicator()
      return false
    }
  }

  const toEl = evt.to as HTMLElement
  if (!toEl) {
    clearDropIndicator()
    return true
  }

  const rawTargetId = toEl.dataset.parentId ?? null
  const targetId = rawTargetId === '' ? null : rawTargetId

  if (draggedId && targetId && isDescendantOf(blockStore.blocks, targetId, draggedId)) {
    clearDropIndicator()
    return false
  }

  const cursorX = evt.originalEvent.clientX
  const cursorY = evt.originalEvent.clientY
  const targetBlock = related?.closest('.block') as HTMLElement | null

  if (!targetBlock) {
    clearDropIndicator()
    return true
  }

  const dropTarget = findDropTarget(cursorX, cursorY, targetBlock)
  if (dropTarget) {
    const bullet = targetBlock.querySelector('.block-bullet')
    if (!bullet) {
      clearDropIndicator()
      return true
    }

    const rect = bullet.getBoundingClientRect()
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      clearDropIndicator()
      return true
    }

    dragState.value.currentDropTarget = dropTarget
    renderDropIndicator(targetBlock, dropTarget)
  } else {
    clearDropIndicator()
  }

  return true
}

/** 拖拽结束：计算放置位置并同步到 store */
async function handleBlockDragEnd() {
  const dropTarget = dragState.value.currentDropTarget

  if (dropTarget && dropTarget.action) {
    const draggedEl = document.querySelector('.block-chosen') as HTMLElement
    const draggedId = draggedEl?.dataset.blockId

    if (draggedId) {
      let siblings: Block[]
      if (dropTarget.toParentId === null) {
        siblings = blockStore.getBlocksByPage(pageStore.currentPageId).filter(b => b.parentId === null)
      } else {
        siblings = blockStore.getChildren(dropTarget.toParentId)
      }

      let newIndex: number
      if (dropTarget.action === 'sort') {
        if (dropTarget.beforeId === null) {
          newIndex = siblings.length
        } else {
          const insertIdx = siblings.findIndex(b => b.id === dropTarget.beforeId)
          newIndex = insertIdx >= 0 ? insertIdx : siblings.length
        }
      } else {
        newIndex = siblings.length
      }

      await blockStore.moveBlock({
        blockId: draggedId,
        toParentId: dropTarget.toParentId,
        newIndex
      })
    }
  }

  clearDropIndicator()
  dragState.value.currentDropTarget = null
  onDragEnd?.()
}
</script>

<template>
  <div class="block" :class="{ active: isActive }" :data-block-id="blockId">
    <div class="block-row">
      <!-- 缩进占位 -->
      <div class="block-indent" :style="{ width: indentWidth }"></div>

      <!-- 内容区域（bullet + content）- 选中时边框只应用到此容器 -->
      <div class="block-inner">
        <!-- Bullet -->
        <span class="block-bullet" :class="{ collapsed }"
          @click.stop="toggleCollapse">
          <span v-if="node.children.length > 0" class="bullet-chevron" :class="{ 'is-collapsed': collapsed }"></span>
          <span v-else class="bullet-dot"></span>
        </span>

        <!-- 内容区 -->
        <div class="block-content" @mousedown="startEditingAtClick">
          <Editor v-if="isActive" ref="editorRef" :block-id="blockId" :content="block.content" @save="handleSave"
            @split="handleSplit" @merge="handleMerge" @delete="handleDelete" @indent="handleIndent"
            @outdent="handleOutdent" @move-up="handleMoveUp" @move-down="handleMoveDown" @exit-edit="handleExitEdit"
            @cursor-change="handleCursorChange" />
          <div v-else class="block-text" @click="handleContentClick">
            <span v-if="isSingleEmptyBlock" class="block-placeholder">Type something...</span>
            <span v-else v-html="renderContentToHtml(block.content)"></span>
          </div>
        </div>
      </div>
    </div>

    <!-- 属区显示区 -->
    <div class="block-properties">
      <PropertyDisplay :block-id="blockId" />
    </div>

    <!--
      子节点容器（VueDraggable）
      - v-model="node.children" 驱动渲染和拖拽
      - vue-draggable-plus 直接修改 node.children 数组
      - tag="div" 渲染为 <div>，接受 class/style/data-* 属性
      - v-if 只在有子节点时渲染
    -->
    <VueDraggable
      ref="draggableRef"
      v-model="node.children"
      tag="div"
      :group="{ name: 'blocks', pull: true, put: true }"
      :sort="true"
      handle=".block-bullet"
      :animation="150"
      ghost-class="block-ghost"
      drag-class="block-drag"
      chosen-class="block-chosen"
      :force-fallback="true"
      :empty-insert-threshold="0"
      :class="childrenContainerClass"
      :data-parent-id="blockId"
      :style="{ '--indent-depth': depth }"
      @start="editorStore.deactivateBlock()"
      @move="handleDragMove"
      @end="handleBlockDragEnd"
    >
      <Block v-for="child in node.children" :key="child.id" :node="child" :page-id="pageId" :depth="depth + 1" />
    </VueDraggable>
  </div>
</template>

<style scoped>
@import './styles.css';
</style>
