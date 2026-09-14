<script setup lang="ts">
/**
 * BlockList - 基于 TreeNode 树形结构的可拖拽 Block 列表容器
 *
 * 职责：
 * 1. 从 store 的扁平 blocks[] 构建 TreeNode 树
 * 2. 通过 <BlockDraggableList> 驱动根级渲染和拖拽
 * 3. 通过 provide 向子 Block 组件注入拖拽回调
 *
 * 架构：
 * - tree ref 是 BlockDraggableList 的 v-model 数据源（唯一渲染权威）
 * - 拖拽后 tree 已被 vue-draggable-plus 更新（update:modelValue）
 * - handleDragEnd 将 tree 变更同步回 store（parentId + pos）
 * - store 变更通过 structureVersion watch 触发 syncFromStore 重建树
 */
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { buildTree, syncTreeToStore } from '../composables/useBlockTree'
import type { CrossBlockSelection } from '../composables/useCrossBlockSelection'
import { useCrossBlockSelection } from '../composables/useCrossBlockSelection'
import { ensureStack, hasStack } from '../composables/useUndoHistory'
import { runUndoOrRedo } from '../composables/useUndoRestore'
import { resolveUndoChord, resolveUndoScopeBlockPage } from '../utils/undo-chord'
import { COMIND_BLOCK_MIME, resolveClipboardForest } from '../services/external-paste-parse'
import { ensureWikiLinkTargets, notifyCreatedPages } from '../services/paste-ensure-wiki-targets'
import { blockOffsetFromPoint, selectionClientRects } from '../services/selection-geometry'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { usePageStore } from '../stores/pages'
import type { TreeNode } from '../types/block'
import { sortByDocumentOrderIds } from '../utils/block-helpers'
import BlockDraggableList from './Block/components/BlockDraggableList.vue'
import BlockDropIndicator from './Block/components/BlockDropIndicator.vue'
import type { DragEndIntent } from './Block/composables/useBlockDragDrop'
import { applyDropTarget, useSharedDropIndicator } from './Block/composables/useBlockDragDrop'

const props = defineProps<{
  /** 页面 ID，用于过滤 Block */
  pageId: string
}>()

/** 本实例渲染树根：粘贴归属判定用（KeepAlive 缓存实例的 DOM 会脱离文档） */
const rootEl = ref<HTMLElement | null>(null)

const blockStore = useBlockStore()
const editorStore = useEditorStore()
const pageStore = usePageStore()

/** 当前页面的根 Block ID */
const rootBlockId = computed(() => pageStore.getPage(props.pageId)?.blockId ?? null)

// ── 树形结构（writable ref，作为 VueDraggable 的 v-model） ──
const tree = ref<TreeNode[]>([])

// ── 从 store 构建 tree ──
function syncFromStore() {
  tree.value = buildTree(blockStore.blocks, props.pageId, rootBlockId.value)
}

// ── 拖拽结束：先按落位意图校正 tree（Sortable 的吸附结果不等同于判定意图），再同步回 store ──
function handleDragEnd(intent?: DragEndIntent | null) {
  if (intent) applyDropTarget(tree.value, intent.draggedId, intent.target)
  // 搬迁影响面：新父块「获得」子节点、旧父块「可能失去」（ADR-0045 D2/D4 对账输入）
  const affected = { gained: new Set<string>(), emptied: new Set<string>() }
  const changed = syncTreeToStore(tree.value, rootBlockId.value, blockStore.blocks, undefined, affected)
  for (const id of changed) {
    blockStore.scheduleSave(id)
  }
  blockStore.structureVersion++
  blockStore.reconcileCollapse(affected.emptied, affected.gained)
}

// ── 双击底部留白区域创建新 block ──
async function handleCreateBlock() {
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
    editorStore.activateBlock(blockId)
    return
  }

  // 块选区（属性区起点）
  if (!selection.dragStartBlockId.value) {
    const target = e.target as HTMLElement
    // 点击选中区域外任意位置 → 取消选中（页面空白、sidebar、未选中 block、留白等）。
    // shift+mouseup 豁免：shift+click 是延伸尝试（ADR-0035 D10），落空（head 无效）
    // 时应保住既有选区——与浏览器 shift+click 不因点击位置而放弃选区一致。
    if (!isInSelectedArea(target)) {
      if (selection.textRange.value && e.shiftKey) return
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
    if (!fromProperty) {
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

/** 选中的块是否为「无编辑态块」（当前仅 image）。
 * 这类块被选中时会走 activateBlock，但无真实编辑器，
 * 其 Enter/Tab 不会被编辑器 keymap 拦截，需在文档级兜底处理。 */
function isNoEditTextBlock(id: string): boolean {
  const b = blockStore.blocks.find((x) => x.id === id)
  return !!b && b.type === 'image'
}

/**
 * 按当前选区类型复制（文本选区优先——两类选区互斥，只会命中其一）；无选区时不做任何事。
 * Ctrl+C 与 Ctrl+X 共用同一分流，保证复制口径单源。
 */
function copySelectionToClipboard(): void {
  if (selection.textRange.value) selection.copyTextToClipboard(props.pageId)
  else if (selection.anchorIds.size > 0) selection.copyToClipboard()
}

/**
 * 块选区删除编排：Backspace/Delete 与 Ctrl+X 共用同一落库路径。
 * 乐观过滤 + 延迟落库 + 全选删除的保留块兜底（原 Backspace 分支原样上提）。
 */
async function deleteSelectedBlocks(): Promise<void> {
  const selected = [...selection.anchorIds]
  // 同步：仅 tree 过滤（store 保留，cleanupAfterDelete 需要这些块数据）
  // 乐观过滤也守「至少留一块」：若移除选中会让 tree 空，则保留最后一块
  // （与 store deleteBlocks 闸门一致），避免瞬时空屏；其内容随后由 store 清空。
  const remaining = tree.value.filter(node => !selected.includes(node.id))
  let keptId: string | null = null
  if (remaining.length > 0) {
    tree.value = remaining
  } else if (tree.value.length > 0) {
    // 全选删除：保留文档序最后一块（store 会清空其内容），待删除完成后激活它
    keptId = tree.value[tree.value.length - 1].id
    tree.value = [tree.value[tree.value.length - 1]]
  } else {
    tree.value = []
  }
  // paint 完成后才从 store 删除（含 cleanupAfterDelete 的 cross-page link 降级）
  setTimeout(() => {
    selection.deleteSelected().then(() => {
      if (keptId) {
        // 全选删除后页面只剩被保留的空 block：清选区并进入编辑态，光标落其内便于续写
        selection.clearSelection()
        editorStore.activateBlock(keptId, 1)
      }
    })
  }, 0)
}

async function handleDocKeyDown(e: KeyboardEvent) {
  if (isInSidebar(e)) return
  // 输入框内 Backspace/Ctrl+C 保留控件自身行为（如搜索框、重命名输入）
  if (isInEditableInput(e)) return
  // 非 Ctrl/Cmd+V 键击一律清 Shift+V 标志，避免 keydown 后 paste 未触发导致残留污染
  if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey)) {
    pasteShiftHeld = e.shiftKey
  } else {
    pasteShiftHeld = false
  }
  // Ctrl/Cmd+X（不带 Shift/Alt）：剪切的字面授权只有这一 chord，其余组合交还原生行为
  const isCutKey = (e.key === 'x' || e.key === 'X') && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
  if (e.key === 'Backspace' || e.key === 'Delete' || isCutKey) {
    // 键盘删除/剪切分派表：{Backspace, Delete, Ctrl+X} × {文本选区, 块选区}（#95 / #96）。
    // 两类选区语义一致：选中即被支配。文本选区优先——与 Ctrl+C 同一口径（互斥，只会命中其一）。
    // 剪切 = 先复制后删除：复制函数在首个 await 前同步快照选区内容，先于删除的落库变更。
    // 无选区时不接管（preventDefault 都不做），保留编辑器/浏览器原生命中剪切。
    if (isCutKey) copySelectionToClipboard()
    if (selection.textRange.value) {
      e.preventDefault()
      const deleted = await selection.deleteTextSelection(props.pageId)
      // 裁剪/合并后的落点：光标就地进编辑态，可直接接着打字
      if (deleted) editorStore.activateBlock(deleted.id, deleted.cursorPos)
      return
    }
    const selected = [...selection.anchorIds]
    if (selected.length > 0) {
      e.preventDefault()
      await deleteSelectedBlocks()
      return
    }
  }
  if (e.key === 'Escape') {
    selection.clearSelection()
    selection.clearTextSelection()
    return
  }
  if (e.key === 'Enter') {
    // 跨块选区态下按 Enter：在当前选中块【上方】插入空文本块并聚焦。
    // image/embed 等无编辑态块无法用行内 Enter 建块，此分支补齐该路径
    // （首块为 image 时也能在其上方新建 block）。
    const ordered = sortByDocumentOrderIds([...selection.anchorIds], blockStore.blocks)
    if (ordered.length > 0 && isNoEditTextBlock(ordered[0])) {
      e.preventDefault()
      const newBlock = await blockStore.insertBlockAtCursor(ordered[0], 1, false)
      if (newBlock) {
        selection.clearSelection()
        selection.clearTextSelection()
        editorStore.activateBlock(newBlock.id, 1)
      }
      return
    }
  }
  if (e.key === 'Tab') {
    // 与普通文本 block 一致：Tab=缩进，Shift-Tab=反缩进。
    // 文本块在编辑器内由 EnterAsBlockExtension 处理；无编辑态块（image/embed 等）
    // 选中后无激活编辑器，Tab 落到此处，按选中的块缩进/反缩进。
    const ordered = sortByDocumentOrderIds([...selection.anchorIds], blockStore.blocks)
    if (ordered.length > 0 && isNoEditTextBlock(ordered[0])) {
      e.preventDefault()
      if (e.shiftKey) {
        await blockStore.outdent(ordered[0])
      } else {
        await blockStore.indent(ordered[0])
      }
      return
    }
  }
  if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey)) {
    // 文本选区优先于块选区（互斥，只会命中其一）
    if (selection.textRange.value || selection.anchorIds.size > 0) {
      e.preventDefault()
      copySelectionToClipboard()
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

/**
 * 捕获阶段接管 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y（ADR-0046 D2：统一栈全权接管）。
 *
 * 为什么必须是捕获阶段：TipTap 与 CodeMirror 的按键处理都挂在编辑区自身（目标阶段），
 * 捕获阶段先于它们执行才能把按键拿掉。两者的内置历史由同票一并禁用（Editor.vue
 * `undoRedo:false` / CodeMirrorEditor 去 `history()`+`historyKeymap`）—— 接管与禁用
 * 是一对，中间态会让两个栈互抢（D7 拒绝分阶段）。
 *
 * 豁免面比 Ctrl+A 窄：原生输入控件（搜索框 / 重命名）保留浏览器自身撤销；CodeMirror
 * 编辑区同样是 contenteditable 但不豁免，它归统一栈。**本实例不接管的落点**（不 preventDefault，
 * 交还原生行为）见 resolveUndoScopePage —— 无栈页块与列表外目标两类（#109 已裁定的边界）。
 */
function handleDocUndoRedoKeyDown(e: KeyboardEvent) {
  const chord = resolveUndoChord(e)
  if (!chord) return
  const pageId = resolveUndoScopePage(e)
  if (!pageId || !hasStack(pageId)) return
  e.preventDefault()
  e.stopPropagation()
  runUndoRedo(pageId, chord).catch((err) => console.error('[undo] 恢复失败:', err))
}

/**
 * 本次按键的撤销作用域页；null = 本实例不接管（按键交还原生行为）。
 * - 焦点在某块内 → 复用全局作用域裁决单一真源 `resolveUndoScopeBlockPage`（B2：
 *   与 App 的全局兜底共用，杜绝两处口径漂移），取该块所属页（含 BlockModal 内的
 *   **他页块**）。是否接管由 handleDocUndoRedoKeyDown 的 `hasStack` 判定：那页有栈
 *   （曾整页加载）才接管；无栈（从未整页加载，memento 无快照可撤）交还原生行为（D6 机制边界）。
 * - 焦点不在块内（底部留白 / 属性区 / 点击不可聚焦元素后焦点落回 body）→ 按实例归属判定；
 *   目标落在本列表之外（页面标题区、右栏等）同样不接管。
 */
function resolveUndoScopePage(e: KeyboardEvent): string | null {
  // 块内焦点：复用全局作用域裁决单一真源（B2：与 App 的全局兜底共用，杜绝口径漂移），
  // 取该块所属页（含 BlockModal 内的**他页块**）。是否接管由 handleDocUndoRedoKeyDown
  // 的 `hasStack` 判定：那页有栈（曾整页加载）才接管；无栈（从未整页加载，memento 无快照可撤）
  // 交还原生行为（D6 机制边界）。
  const blockPage = resolveUndoScopeBlockPage(e)
  if (blockPage) return blockPage
  // 非块元素：实例归属判定（仅 BlockList 有此逻辑；App 全局兜底只认块内焦点，无此分支）。
  // 注意：原生输入控件（input/textarea）必须在此再豁免一次 —— 全局裁决对「非块」统一返回
  // null，但本函数有实例归属兜底（下方 return props.pageId），input 焦点不能落到该兜底被接管。
  const target = e.target as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return null
  if (target.closest('input, textarea')) return null
  // 口径同 handleDocPaste 的「DOM 已摘离文档的缓存实例不接管」那一半（ADR-0043）。另一半
  // （按 lastClickedBlockId 校验页归属）只在粘贴需要锚点块时才有意义，撤销作用域恒为
  // props.pageId，故不需要。
  const isBodyOrDocument = target === document.body || target === document.documentElement
  if (rootEl.value && (isBodyOrDocument ? !rootEl.value.isConnected : !rootEl.value.contains(target))) {
    return null
  }
  return props.pageId
}

/**
 * 撤销 / 重做 + 落点（#109）。执行（退出编辑态 → 封口 → 恢复）收口在 useUndoRestore 的
 * runUndoOrRedo，此处只补「落点」：受影响块置为块选区并滚入视野（D-rollback landing）。
 * 落点只在本页做 —— 跨页（BlockModal 他页块）恢复只改 store，弹窗经响应式自刷，
 * 本列表的块选区 / 滚动对 props.pageId 之外的页无意义。
 */
async function runUndoRedo(pageId: string, chord: 'undo' | 'redo'): Promise<void> {
  const changed = await runUndoOrRedo(pageId, chord)
  if (!changed || changed.length === 0) return
  if (pageId === props.pageId) landOnChangedBlocks(changed)
}

/** 落点：受影响块整体置为**块选区**（不进文字编辑态）+ 文档序首块滚入视野 */
function landOnChangedBlocks(ids: string[]): void {
  // 恢复后 store 里只剩快照内的块：撤销「新建」时受影响块已被软删，sortByDocumentOrderIds
  // 会按块现有文档序把不存在的 id 过滤掉 —— 无可落点块时保持原状即可。
  // 另须排除页面根块：它不参与渲染/选区（同 selectAll 的 excludeRootId 口径），
  // 一旦进 anchorIds，后续的复制/删除会波及整页根。
  const ordered = sortByDocumentOrderIds(
    ids.filter((id) => id !== rootBlockId.value),
    blockStore.blocks,
  )
  if (ordered.length === 0) return
  selection.selectBlocks(ordered)
  nextTick(() => {
    // 限定在本实例的渲染树内查：多实例共存时避免滚到弹窗/抽屉里的副本
    const el = rootEl.value?.querySelector(`[data-block-id="${ordered[0]}"]`)
    // jsdom 等测试环境没有 scrollIntoView
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' })
  })
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
  // 多实例归属（粘贴即建页实测回归，ADR-0043）：paste 捕获监听对所有已挂载 BlockList 实例都触发——
  // RouterView KeepAlive 缓存 /ideas 今日面板后其实例与当前页并存、document 监听仍存活，
  // 会让缓存实例二次 ensure（toast 双弹）并二次 pasteBlocks（今日 ideas 页莫名多 block）。
  // 事件落点不在本实例渲染树内、或本实例 DOM 已摘离文档（KeepAlive 缓存态）→ 非本实例的粘贴，忽略。
  if (rootEl.value) {
    if (isBodyOrDocument ? !rootEl.value.isConnected : !rootEl.value.contains(target)) return
  }
  if (isBodyOrDocument) {
    const ctx = lastClickedBlockId ? blockStore.getBlock(lastClickedBlockId) : null
    if (!ctx || ctx.pageId !== props.pageId) return
  }
  // 输入框/非 TipTap contenteditable 内粘贴走浏览器默认（文本进输入框）
  if (isInEditableInput(e)) return
  // 先消费 Shift+V 标志（无论粘贴分发与否），避免残留污染下一次普通粘贴
  const wasShiftPaste = pasteShiftHeld
  pasteShiftHeld = false
  // D9：Shift+V 纯文本粘贴，交还默认行为（单 block 落文本）
  if (wasShiftPaste) return

  const data = e.clipboardData
  if (!data) return

  // 粘贴即建页（ADR-0043）：对剪贴板可读文本提取 [[目标]] 并 Ensure 建页（幂等、与键入同源），
  // 使随后块保存抽链命中、Link 边与图谱边成立——[[x]] 粘贴语义统一为「声明页面」。
  const ensurePages = ensureWikiLinkTargets({
    plain: data.getData('text/plain'),
    html: data.getData('text/html'),
  })

  const forest = resolveClipboardForest(mime => data.getData(mime))
  // 无结构化内容（如纯图片）→ 放行默认行为（image 钩子在编辑态先消费）
  if (!forest || forest.length === 0) return

  const hasInternal = !!data.getData(COMIND_BLOCK_MIME)
  // 外部内容 + 行内光标（块内有文本、无选区）→ TipTap 默认行内粘贴（ADR-0026 D1）；
  // ensure fire-and-forget：wasm 本地毫秒级 + 块保存有 debounce，极端竞争 miss 由后续保存/点击自愈
  if (!hasInternal && selection.anchorIds.size === 0 && isInlineCaretContext(e)) {
    void ensurePages.then(({ created }) => notifyCreatedPages(created, editorStore.showToast))
    return
  }

  e.preventDefault()
  // 块级粘贴：ensure 先于块落库完成，保存抽链必然命中
  const { created } = await ensurePages
  notifyCreatedPages(created, editorStore.showToast)
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

// ── 撤销栈（ADR-0046）：本页整页加载完成后建立/接管（幂等）──
// 收口在 BlockList 内部而不是各调用方：/page（Page/index.vue）与 /ideas（IdeasList.vue）
// 两处都各自加载页面，若各自接线必然漂移。前置条件是**整页已加载** —— 残缺快照会在撤销时
// 把未加载的块当「新增」软删。isPageFullyLoaded 读的是非响应式 Set，故用「页 id + 块数」
// 这个派生值作观察源（既随 blocks 变化重算，又不会在「切到块数相同的另一页」时漏触发）；
// 块数为 0 同样不建栈（空快照入栈 = 撤销时整页被软删）。
watch(
  () => {
    if (!blockStore.isPageFullyLoaded(props.pageId)) return ''
    const count = blockStore.getBlocksByPage(props.pageId).length
    return count > 0 ? `${props.pageId}:${count}` : ''
  },
  (key) => {
    if (key) ensureStack(props.pageId)
  },
  { immediate: true },
)

onMounted(() => {
  syncFromStore()
  document.addEventListener('mousemove', handleDocMouseMove)
  document.addEventListener('mouseup', handleDocMouseUp)
  document.addEventListener('keydown', handleDocKeyDown)
  document.addEventListener('keydown', handleDocKeyDownCapture, true)
  document.addEventListener('keydown', handleDocUndoRedoKeyDown, true)
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
  document.removeEventListener('keydown', handleDocUndoRedoKeyDown, true)
  document.removeEventListener('paste', handleDocPaste, true)
  document.removeEventListener('scroll', handleViewportChange, true)
  window.removeEventListener('resize', handleViewportChange)
})
</script>

<template>
  <div ref="rootEl" class="block-list">
    <!-- 根级拖拽列表：与 Block 子级列表共用同一实现（BlockDraggableList），
         接线只有一份，避免两处配置漂移。落库由 @drag-end 统一接管。 -->
    <BlockDraggableList
      v-model="tree"
      :page-id="pageId"
      :parent-id="null"
      :depth="0"
      @drag-end="handleDragEnd"
    />
    <!-- 底部留白：双击创建新 block -->
    <div class="block-list-padding" @dblclick="handleCreateBlock" />

    <!-- 拖放指示器：模块级共享状态，整个 BlockList 只渲染一次。
         由各 Block 的 useBlockDragDrop.handleDragMove 写入共享 ref。 -->
    <BlockDropIndicator
      :style="indicatorStyle"
      :css-class="indicatorClass"
      :visible="indicatorVisible"
    />

    <!-- 文本选区覆盖层高亮（ADR-0035 D4）：Teleport 到 body，避免 transform 祖先困住 fixed 定位（ADR-0032 铁律 2） -->
    <Teleport to="body">
      <div
        v-for="(rect, i) in highlightRects"
        :key="i"
        class="text-selection-rect"
        :class="{ 'is-first': i === 0, 'is-last': i === highlightRects.length - 1 }"
        :style="{ top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` }"
      />
    </Teleport>
  </div>
</template>

<style lang="scss" scoped>
.block-list {
  padding-left: 0;
  padding-bottom: 40px;
  min-height: 100px;
}

.block-list-padding {
  height: 40px;
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
}

/* 文本选区覆盖层高亮：position:fixed + 视口矩形，pointer-events 穿透。
   圆角只在多行选区的「两端」：首矩形左侧、末矩形右侧，中间矩形直角——
   避免每段四角圆角把连续选区切成一节一节的外观；单矩形时 is-first 与
   is-last 同时命中，四角圆角与旧观感一致。 */
.text-selection-rect {
  position: fixed;
  pointer-events: none;
  background: var(--selection-bg);
  z-index: var(--z-sticky);
}

.text-selection-rect.is-first {
  border-top-left-radius: var(--radius-xs);
  border-bottom-left-radius: var(--radius-xs);
}

.text-selection-rect.is-last {
  border-top-right-radius: var(--radius-xs);
  border-bottom-right-radius: var(--radius-xs);
}
</style>
