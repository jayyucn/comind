<script setup lang="ts">
/**
 * BlockList - 基于 TreeNode 树形结构的可拖拽 Block 列表容器
 *
 * 职责：
 * 1. 从 store 的扁平 blocks[] 构建 TreeNode 树
 * 2. 通过 VueDraggable 驱动根级渲染和拖拽
 * 3. 通过 provide 向子 Block 组件注入拖拽回调
 *
 * 架构：
 * - tree ref 是 VueDraggable 的 v-model 数据源（唯一渲染权威）
 * - 拖拽后 tree 已被 vue-draggable-plus 直接修改
 * - handleDragEnd 将 tree 变更同步回 store（parentId + pos）
 * - store 变更通过 structureVersion watch 触发 syncFromStore 重建树
 */
import { ref, watch, onMounted, onBeforeUnmount, provide, computed, toRef } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { usePageStore } from '../stores/pages'
import { useIdeasFreeze } from '../composables/useIdeasFreeze'
import Block from './Block/index.vue'
import BlockDropIndicator from './Block/components/BlockDropIndicator.vue'
import { useSharedDropIndicator } from './Block/composables/useBlockDragDrop'
import { buildTree, syncTreeToStore } from '../composables/useBlockTree'
import type { TreeNode } from '../types/block'
import { useCrossBlockSelection } from '../composables/useCrossBlockSelection'
import type { CrossBlockSelection } from '../composables/useCrossBlockSelection'
import { resolveClipboardForest, COMIND_BLOCK_MIME } from '../services/external-paste-parse'
import { sortByDocumentOrderIds } from '../utils/block-helpers'
import { blockOffsetFromPoint, selectionClientRects } from '../services/selection-geometry'

const props = defineProps<{
  /** 页面 ID，用于过滤 Block */
  pageId: string
}>()

const blockStore = useBlockStore()
const editorStore = useEditorStore()
const pageStore = usePageStore()
const { isFrozen } = useIdeasFreeze(toRef(props, 'pageId'))

/** 当前页面的根 Block ID */
const rootBlockId = computed(() => pageStore.getPage(props.pageId)?.blockId ?? null)

// ── 树形结构（writable ref，作为 VueDraggable 的 v-model） ──
const tree = ref<TreeNode[]>([])

// ── 从 store 构建 tree ──
function syncFromStore() {
  tree.value = buildTree(blockStore.blocks, props.pageId, rootBlockId.value)
}

// ── 拖拽结束：tree 已被 vue-draggable-plus 修改，同步回 store ──
function handleDragEnd() {
  if (isFrozen.value) return
  const changed = syncTreeToStore(tree.value, rootBlockId.value, blockStore.blocks)
  for (const id of changed) {
    blockStore.scheduleSave(id)
  }
  blockStore.structureVersion++
}

// ── 双击底部留白区域创建新 block ──
async function handleCreateBlock() {
  if (isFrozen.value) return
  const newBlock = await blockStore.createBlock({
    pageId: props.pageId,
    parentId: rootBlockId.value,
    content: '',
    format: {}
  })

  if (newBlock) {
    blockStore.structureVersion++
    editorStore.activateBlock(newBlock.id, 1)
  }
}

// ── 跨 Block 选区事件处理 ──
const TEXT_DRAG_THRESHOLD_PX = 4

function handleDocMouseMove(e: MouseEvent) {
  // 文本选区拖拽（内容区起点，ADR-0035 D1）
  if (selection.textDragAnchor.value) {
    if (!selection.isTextDragging.value) {
      const sp = selection.textDragStartPoint.value
      if (sp && Math.hypot(e.clientX - sp.x, e.clientY - sp.y) < TEXT_DRAG_THRESHOLD_PX) {
        return // 未超过最小位移，仍视为单击
      }
      editorStore.deactivateBlock()
    }
    const head = blockOffsetFromPoint(e.clientX, e.clientY)
    if (head) {
      selection.updateTextDrag(head)
    }
    return
  }

  // 块选区拖拽（属性区起点，ADR-0035 D6）
  if (!selection.dragStartBlockId.value) return

  const el = document.elementFromPoint(e.clientX, e.clientY)
  const blockEl = el?.closest('[data-block-id]') as HTMLElement | null
  if (!blockEl) return

  const targetId = blockEl.dataset.blockId
  if (!targetId) return

  if (!selection.isDragging.value) {
    if (targetId === selection.dragStartBlockId.value) return
    editorStore.deactivateBlock()
    selection.isDragging.value = true
  }

  const range = selection.computeRange(targetId, props.pageId)
  selection.selectedIds.clear()
  for (const id of range) {
    selection.selectedIds.add(id)
  }
}

/**
 * 最近一次点击交互的 block 及是否位于属性区。
 * 属性区/bullet 等不可聚焦元素点击后焦点落回 body，keydown 的 e.target 不再是
 * BlockList 内元素——Ctrl+A 等接管需回退到该状态判断 BlockList 上下文。
 */
let lastClickedBlockId: string | null = null
let lastClickedInPropertyArea = false

/**
 * 点击位置是否在当前块选区（anchorIds，含选中块的后代子树）内。
 * 选中区域外任意位置（页面空白、sidebar、未选中 block、留白等）点击 → 取消选中。
 */
function isInSelectedArea(target: HTMLElement): boolean {
  if (selection.anchorIds.size === 0) return false
  const blockEl = target.closest('[data-block-id]') as HTMLElement | null
  if (!blockEl) return false
  // 自身或祖先在选区中（子块属于选中块子树，视觉同高亮）
  let cur: HTMLElement | null = blockEl
  while (cur) {
    const id = cur.dataset.blockId
    if (id && selection.anchorIds.has(id)) return true
    cur = cur.parentElement?.closest('[data-block-id]') ?? null
  }
  return false
}

function handleDocMouseUp(e: MouseEvent) {
  // 记录最近点击交互（供 Ctrl+A 焦点丢失到 body 时回退判断上下文）
  const mouseTarget = e.target as HTMLElement | null
  if (mouseTarget && typeof mouseTarget.closest === 'function') {
    const blockEl = mouseTarget.closest('[data-block-id]') as HTMLElement | null
    const bid = blockEl?.dataset.blockId ?? null
    if (bid && blockStore.getBlock(bid)?.pageId === props.pageId) {
      lastClickedBlockId = bid
      lastClickedInPropertyArea = !!mouseTarget.closest('.block-properties')
    } else {
      // 点击非本页区域（sidebar、弹层、留白等）→ 清标记，避免误判
      lastClickedBlockId = null
      lastClickedInPropertyArea = false
    }
  }
  // 文本选区拖拽结束：固化选区
  if (selection.isTextDragging.value) {
    selection.finalizeTextDrag()
    return
  }

  // 内容区单击（未拖）：激活编辑器
  if (selection.textDragAnchor.value) {
    const blockId = selection.textDragAnchor.value.blockId
    selection.clearTextTracking()
    if (!isFrozen.value) {
      editorStore.activateBlock(blockId)
    }
    return
  }

  // 块选区（属性区起点）
  if (!selection.dragStartBlockId.value) {
    const target = e.target as HTMLElement
    // 点击选中区域外任意位置 → 取消选中（页面空白、sidebar、未选中 block、留白等）
    if (!isInSelectedArea(target)) {
      if (selection.anchorIds.size > 0) selection.clearSelection()
      if (selection.textRange.value) selection.clearTextSelection()
    }
    return
  }

  if (selection.isDragging.value) {
    selection.finalizeSelection()
  } else {
    const blockId = selection.dragStartBlockId.value
    const fromProperty = selection.trackingFromProperty.value
    selection.clearTracking()
    // 属性区起点（ADR-0035 D6）只做块选区，单击不激活编辑器
    if (!isFrozen.value && !fromProperty) {
      editorStore.activateBlock(blockId)
    }
  }
}

/** 事件目标是否在侧边栏内（sidebar 是导航区，BlockList 的全局键盘/粘贴接管均不生效） */
function isInSidebar(e: { target: EventTarget | null }): boolean {
  const target = e.target as HTMLElement | null
  return !!target && typeof target.closest === 'function' && !!target.closest('.sidebar-wrapper')
}

/**
 * 事件目标是否在可编辑输入区（input/textarea/非 TipTap contenteditable）内。
 * 这些区域保留控件自身的键盘/粘贴默认行为（全选文本、删字符、粘贴文本），
 * 不被 BlockList 的主文档接管劫持（如 SearchPanel 搜索框、BlockTaskItem 编辑、PageItem 重命名）。
 * TipTap 编辑区（.ProseMirror）不豁免——Ctrl+A/Backspace 等由 BlockList 接管。
 */
function isInEditableInput(e: { target: EventTarget | null }): boolean {
  const target = e.target as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return false
  if (target.closest('input, textarea')) return true
  const editable = target.closest('[contenteditable="true"]') as HTMLElement | null
  return !!editable && !editable.closest('.ProseMirror')
}

function handleDocKeyDown(e: KeyboardEvent) {
  if (isInSidebar(e)) return
  // 输入框内 Backspace/Ctrl+C 保留控件自身行为（如搜索框、重命名输入）
  if (isInEditableInput(e)) return
  if (isFrozen.value) {
    // 冻结时只允许 Escape 清除选区
    if (e.key === 'Escape') {
      selection.clearSelection()
      selection.clearTextSelection()
    }
    return
  }
  // 非 Ctrl/Cmd+V 键击一律清 Shift+V 标志，避免 keydown 后 paste 未触发导致残留污染
  if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey)) {
    pasteShiftHeld = e.shiftKey
  } else {
    pasteShiftHeld = false
  }
  if (e.key === 'Backspace') {
    const selected = [...selection.anchorIds]
    if (selected.length > 0) {
      e.preventDefault()
      // 同步：仅 tree 过滤（store 保留，cleanupAfterDelete 需要这些块数据）
      tree.value = tree.value.filter(node => !selected.includes(node.id))
      // paint 完成后才从 store 删除（含 cleanupAfterDelete 的 cross-page link 降级）
      setTimeout(() => { selection.deleteSelected() }, 0)
      return
    }
  }
  if (e.key === 'Escape') {
    selection.clearSelection()
    selection.clearTextSelection()
    return
  }
  if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey)) {
    // 文本选区优先于块选区（互斥，只会命中其一）
    if (selection.textRange.value) {
      e.preventDefault()
      selection.copyTextToClipboard(props.pageId)
    } else if (selection.anchorIds.size > 0) {
      e.preventDefault()
      selection.copyToClipboard()
    }
  }
}

/**
 * 捕获阶段拦截 Ctrl+A：在 ProseMirror（TipTap）处理之前屏蔽单 block 内容全选
 * （ProseMirror 的 Mod-a → selectAll 在目标阶段执行，冒泡阶段拦截已晚于它）。
 * 仅处理 BlockList 区域：激活块 / 块选区 / 本页属性区（含空白）→ 全选 Blocklist；
 * 冻结态与其余情况仅屏蔽浏览器默认（整页文本全选）。非 BlockList 区域交由 App.vue 全局兜底。
 *
 * 注意：keydown 的 e.target 是焦点元素。点击属性区/bullet 等不可聚焦元素后焦点落回 body，
 * 此时回退用 lastClickedBlockId 判断 BlockList 上下文。
 */
function handleDocKeyDownCapture(e: KeyboardEvent) {
  if ((e.key !== 'a' && e.key !== 'A') || !(e.ctrlKey || e.metaKey)) return
  if (isInSidebar(e)) return
  const target = e.target as HTMLElement | null
  // 焦点丢失到 body/document（点击不可聚焦元素后）：回退到最近一次点击的 block 判断上下文
  const isBodyOrDocument = !target || target === document.body || target === document.documentElement
  const fallbackBlockId = isBodyOrDocument ? lastClickedBlockId : null
  const ctxBlockId = fallbackBlockId ?? (
    target && typeof target.closest === 'function'
      ? (target.closest('[data-block-id]') as HTMLElement | null)?.dataset.blockId ?? null
      : null
  )
  if (!ctxBlockId) return // 非 BlockList 区域交由 App.vue 全局兜底
  const ctxBlock = blockStore.getBlock(ctxBlockId)
  if (!ctxBlock || ctxBlock.pageId !== props.pageId) return
  // 输入框/非 TipTap contenteditable（含 CodeMirror 编辑区）保留控件自身 Ctrl+A
  if (isInEditableInput(e)) return
  e.preventDefault()
  e.stopPropagation()
  // 冻结态（只读视图）：仅屏蔽浏览器默认，不全选
  if (isFrozen.value) return
  const activeId = editorStore.activeBlockId
  const activeInPage = !!activeId
    && blockStore.getBlock(activeId)?.pageId === props.pageId
  const inPropertyArea = fallbackBlockId
    ? lastClickedInPropertyArea
    : !!target?.closest('.block-properties')
  if (activeInPage || selection.anchorIds.size > 0 || inPropertyArea) {
    selection.selectAll(props.pageId, rootBlockId.value)
  }
}

// ── 粘贴分发控制器（ADR-0025 D13 + ADR-0026 D8） ──
// 捕获阶段拦截 document paste，集中决策：
// ① Ctrl/Cmd+Shift+V → 放行（TipTap 单 block 纯文本，D9）
// ② 内部 MIME → 一律 pasteBlocks（复制与粘贴两端均为 block 语义，D1/D13）
// ③ 外部源 + block 级上下文（有选区 / 非行内 / 空 block）→ external-paste-parse 拆分
// ④ 外部源 + 行内光标（块内有文本、无选区）→ 放行（TipTap 单 block，image 钩子先消费）
/** Shift+V 标志：由 keydown 记录，paste 事件消费后复位 */
let pasteShiftHeld = false
/** 行内光标上下文：目标在 contenteditable 内且该编辑区有文本（空块视为 block 级上下文） */
function isInlineCaretContext(e: ClipboardEvent): boolean {
  const target = e.target as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return false
  const editable = target.closest('[contenteditable="true"]') as HTMLElement | null
  if (!editable) return false
  return (editable.textContent ?? '').trim().length > 0
}

/** 粘贴锚点：文档序最后一个选中块；无选区时取聚焦块；皆无 → 页尾追加 */
function resolvePasteAnchor(): string | null {
  if (selection.anchorIds.size > 0) {
    const anchors = sortByDocumentOrderIds(selection.anchorIds, blockStore.blocks)
    return anchors[anchors.length - 1] ?? null
  }
  return editorStore.activeBlockId
}

async function handleDocPaste(e: ClipboardEvent) {
  // 侧边栏粘贴不进入主文档分发（无编辑上下文，避免误粘到主文档）
  if (isInSidebar(e)) return
  // 焦点丢失到 body/document（点击 sidebar/空白等不可聚焦区域后）：回退最近点击上下文，
  // 最近一次点击不在本页（lastClickedBlockId 已被清空）→ 不分发，避免误粘到主文档
  const target = e.target as HTMLElement | null
  const isBodyOrDocument = !target || target === document.body || target === document.documentElement
  if (isBodyOrDocument) {
    const ctx = lastClickedBlockId ? blockStore.getBlock(lastClickedBlockId) : null
    if (!ctx || ctx.pageId !== props.pageId) return
  }
  // 输入框/非 TipTap contenteditable 内粘贴走浏览器默认（文本进输入框）
  if (isInEditableInput(e)) return
  // 先消费 Shift+V 标志（无论冻结与否），避免残留污染下一次普通粘贴
  const wasShiftPaste = pasteShiftHeld
  pasteShiftHeld = false
  if (isFrozen.value) return
  // D9：Shift+V 纯文本粘贴，交还默认行为（单 block 落文本）
  if (wasShiftPaste) return

  const data = e.clipboardData
  if (!data) return

  const forest = resolveClipboardForest(mime => data.getData(mime))
  // 无结构化内容（如纯图片）→ 放行默认行为（image 钩子在编辑态先消费）
  if (!forest || forest.length === 0) return

  const hasInternal = !!data.getData(COMIND_BLOCK_MIME)
  // 外部内容 + 行内光标（块内有文本、无选区）→ TipTap 默认行内粘贴（ADR-0026 D1）
  if (!hasInternal && selection.anchorIds.size === 0 && isInlineCaretContext(e)) return

  e.preventDefault()
  const anchorBlockId = resolvePasteAnchor()
  await blockStore.pasteBlocks(forest, {
    pageId: props.pageId,
    anchorBlockId,
    fallbackParentId: rootBlockId.value,
  })
  // 粘贴目标为空活动块（无选区）：插入后清掉空壳，避免残留空行（仅限本页块）
  if (!selection.anchorIds.size && anchorBlockId) {
    const anchorBlock = blockStore.getBlock(anchorBlockId)
    if (
      anchorBlock
      && anchorBlock.pageId === props.pageId
      && anchorBlock.content.trim() === ''
      && anchorBlock.type === 'bullet'
    ) {
      editorStore.deactivateBlock()
      await blockStore.deleteBlock(anchorBlockId)
    }
  }
}

// ── 提供给子 Block 组件 ──
const selection = useCrossBlockSelection()
provide<CrossBlockSelection>('crossBlockSelection', selection)
provide('onDragEnd', handleDragEnd)

// ── 文本选区覆盖层高亮（ADR-0035 D4）──
const highlightRects = ref<DOMRect[]>([])

function refreshTextHighlight() {
  const tr = selection.textRange.value
  highlightRects.value = tr ? selectionClientRects(tr.anchor, tr.head) : []
}

function handleViewportChange() {
  refreshTextHighlight()
}

watch(() => selection.textRange.value, () => refreshTextHighlight())

// ── 拖放指示器（模块级共享状态，渲染一次） ──
// 所有 Block 的 useBlockDragDrop 写入同一组 ref，这里统一渲染单个 <BlockDropIndicator>，
// 复现原全局 .drop-indicator DOM 元素行为，避免跨容器拖拽时残留指示器。
const {
  style: indicatorStyle,
  cssClass: indicatorClass,
  visible: indicatorVisible
} = useSharedDropIndicator()

// ── 监听结构变化重建树 ──
watch(() => blockStore.structureVersion, () => {
  syncFromStore()
})

// ── 页面 ID 变化时清除选区，同步由 structureVersion 变化触发 ──
watch(() => props.pageId, (newId, oldId) => {
  if (newId !== oldId) {
    selection.clearSelection()
    selection.clearTextSelection()
    syncFromStore()
  }
})

onMounted(() => {
  syncFromStore()
  document.addEventListener('mousemove', handleDocMouseMove)
  document.addEventListener('mouseup', handleDocMouseUp)
  document.addEventListener('keydown', handleDocKeyDown)
  document.addEventListener('keydown', handleDocKeyDownCapture, true)
  document.addEventListener('paste', handleDocPaste, true)
  // 文本选区覆盖层高亮需随滚动/缩放重绘（视口矩形会失效）
  document.addEventListener('scroll', handleViewportChange, true)
  window.addEventListener('resize', handleViewportChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', handleDocMouseMove)
  document.removeEventListener('mouseup', handleDocMouseUp)
  document.removeEventListener('keydown', handleDocKeyDown)
  document.removeEventListener('keydown', handleDocKeyDownCapture, true)
  document.removeEventListener('paste', handleDocPaste, true)
  document.removeEventListener('scroll', handleViewportChange, true)
  window.removeEventListener('resize', handleViewportChange)
})
</script>

<template>
  <div class="block-list" :class="{ 'is-frozen': isFrozen }">
    <VueDraggable
      v-model="tree"
      :group="{ name: 'blocks', pull: true, put: true }"
      :disabled="isFrozen"
      handle=".block-bullet"
      :animation="150"
      ghost-class="block-ghost"
      drag-class="block-drag"
      chosen-class="block-chosen"
      :force-fallback="true"
      :empty-insert-threshold="0"
      data-parent-id=""
      @start="editorStore.deactivateBlock()"
      @end="handleDragEnd"
    >
      <Block v-for="node in tree" :key="node.id" :node="node" :page-id="pageId" :depth="0" />
    </VueDraggable>
    <!-- 底部留白：冻结时不允许双击创建新 block -->
    <div v-if="!isFrozen" class="block-list-padding" @dblclick="handleCreateBlock" />

    <!-- 拖放指示器：模块级共享状态，整个 BlockList 只渲染一次。
         由各 Block 的 useBlockDragDrop.handleDragMove 写入共享 ref。 -->
    <BlockDropIndicator
      :style="indicatorStyle"
      :css-class="indicatorClass"
      :visible="indicatorVisible"
    />

    <!-- 文本选区覆盖层高亮（ADR-0035 D4）：Teleport 到 body，避免 transform 祖先困住 fixed 定位（ADR-0012 铁律 2） -->
    <Teleport to="body">
      <div
        v-for="(rect, i) in highlightRects"
        :key="i"
        class="text-selection-rect"
        :style="{ top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` }"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.block-list {
  padding-left: 0;
  padding-bottom: 40px;
  min-height: 100px;
}

.block-list.is-frozen {
  /* 冻结状态：降低视觉权重，但保持可点击选择 */
}

.block-list.is-frozen :deep(.block-bullet) {
  cursor: default;
}

.block-list-padding {
  height: 40px;
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
}

/* 文本选区覆盖层高亮：position:fixed + 视口矩形，pointer-events 穿透 */
.text-selection-rect {
  position: fixed;
  pointer-events: none;
  background: rgba(66, 133, 244, 0.15);
  border-radius: 2px;
  z-index: var(--z-sticky);
}
</style>
