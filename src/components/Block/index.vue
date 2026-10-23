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
 *   拖拽结束 → onDragEnd → syncTreeToStore → store
 *   → 结构签名变化（#118 D2）→ BlockList watch → syncFromStore → tree 重建
 */
import './handlers/bullet'
import './handlers/code'
import './handlers/embed'
import './handlers/image'

import type { EditorView } from '@codemirror/view'
import type { Editor } from '@tiptap/core'
import { ChevronDown } from 'lucide-vue-next'
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'

import { useBlockRegistry } from '../../composables/useBlockRegistry'
import { useBlockRelationshipCleanup } from '../../composables/useBlockRelationshipCleanup'
import type { CrossBlockSelection } from '../../composables/useCrossBlockSelection'
import { useNavigateToPage } from '../../composables/useNavigateToPage'
import { recordSelection } from '../../composables/useUndoHistory'
import { useBlockStore } from '../../stores/blocks'
import { useEditorStore } from '../../stores/editor'
import { useFieldValueStore } from '../../stores/fieldValue'
import { usePageStore } from '../../stores/pages'
import type { TreeNode } from '../../types/block'
import type { BlockSetupContext, BlockTypeEditorExposed, BlockTypeHooks } from '../../types/block-type'
import {
  decodeRelationshipContent,
  setRelationshipSnapshot,
} from '../../utils/relationship-content'
import BlockFieldZone from './BlockFieldZone.vue'
import BlockDraggableList from './components/BlockDraggableList.vue'
import TaskProgressBar from './components/TaskProgressBar.vue'
import { useBlockCollapse } from './composables/useBlockCollapse'
import type { DragEndIntent } from './composables/useBlockDragDrop'
import { useBlockEditorLifecycle } from './composables/useBlockEditorLifecycle'
import { useBlockFieldRows } from './composables/useBlockFieldRows'
import { useBlockFieldValueSync } from './composables/useBlockFieldValueSync'
import { useChildTaskProgress } from './composables/useTaskProgress'

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
const fieldValueStore = useFieldValueStore()
const pageStore = usePageStore()
const { getHandler } = useBlockRegistry()
const relationshipCleanup = useBlockRelationshipCleanup()
const { navigateToPage } = useNavigateToPage()

// 注入拖拽结束落库回调（由 BlockList / BlockModal 提供，syncTreeToStore 完整树 diff）
const onDragEnd = inject<(intent: DragEndIntent | null) => void>('onDragEnd')
const selection = inject<CrossBlockSelection>('crossBlockSelection')
// 是否处于 BlockModal 子树编辑器内（由 BlockModal provide）。弹窗内 dot 点击为 no-op，避免递归开弹窗。
const inBlockModal = inject<boolean>('inBlockModal', false)

// ── 便捷访问 ──
const blockId = computed(() => props.node.id)
const block = computed(() => props.node.block)

// ── 字段区行集合（折叠守卫的第二通道）──
// 与 `BlockFieldZone variant="list"` 的渲染集合**同一单源**（useBlockFieldRows），
// 故「chevron 说能折叠」与「折叠下去真的藏了行」不会漂移。tag 与本守卫无关。
const { fields: blockFields } = useBlockFieldRows(blockId, computed(() => block.value.tags ?? []))
const fieldRowCount = computed(() => blockFields.value.length)

// ── 子级列表 v-model ──
// 树节点由 BlockList 的 tree 持有（唯一渲染权威），Block 只是渲染层，写入路径
// 是同一份响应式数据。node.children 的写回经 toRef 代理完成（模板直接
// v-model="node.children" 会触发 vue/no-mutating-props），赋值行为与原先完全一致。
const nodeRef = toRef(props, 'node')
const childrenModel = computed<TreeNode[]>({
  get: () => nodeRef.value.children,
  set: children => { nodeRef.value.children = children },
})

// ── 字段值读取 / 优先级 CSS 类（由 useBlockFieldValueSync 统一管理）──
const {
  getFieldValue: getBlockFieldValue,
  getFieldValuesMap: getBlockFieldValuesMap,
  setFieldValue,
  priorityClass,
  statusClass,
} = useBlockFieldValueSync(blockId)

const hasSelectedAncestor = computed(() => {
  if (!selection) return false
  let currentParentId = block.value.parentId
  while (currentParentId) {
    if (selection.isBlockSelected(currentParentId)) {
      return true
    }
    const parentBlock = blockStore.blocks.find(b => b.id === currentParentId)
    currentParentId = parentBlock?.parentId ?? null
  }
  return false
})
const isSelected = computed(() => {
  if (!selection) return false
  return selection.isBlockSelected(blockId.value)
})
const handler = computed(() => getHandler(block.value.type))

const editContent = computed(() => {
  // 编辑态显示中文 label：存储 type → 显示 label（decode）
  const { text, snapshot } = decodeRelationshipContent(block.value.content ?? '')
  setRelationshipSnapshot(blockId.value, snapshot)
  return text
})

/** 空 block：无内容且非标题（如 '# ' 开头） */
const isEmptyBlock = computed(() => {
  const c = block.value.content ?? ''
  return !/^#{1,6}\s+/.test(c) && c.trim() === ''
})

/** 同级兄弟节点（按 pos 排序） */
const siblings = computed(() => {
  return blockStore
    .getBlocksByPage(props.pageId)
    .filter(b => b.parentId === block.value.parentId)
    .sort((a, b) => a.pos - b.pos)
})

/** 是否为首行或尾行（同级） */
const isEdgeInLevel = computed(() => {
  if (siblings.value.length <= 1) return true
  const first = siblings.value[0]?.id === blockId.value
  const last = siblings.value[siblings.value.length - 1]?.id === blockId.value
  return first || last
})

/** 空 block 且非首行/尾行：未激活且未 hover 时隐藏 bullet */
const hideBulletForEmpty = computed(() => {
  return isEmptyBlock.value && !isEdgeInLevel.value
})

/** 页面是否仅有一个空 Block（唯一场景显示 placeholder） */
const isSingleEmptyBlock = computed(() => {
  const contentBlocks = blockStore.getBlocksByPage(props.pageId)
  return contentBlocks.length === 1 && contentBlocks[0].content === '' && contentBlocks[0].id === blockId.value
})

const editorRef = ref<BlockTypeEditorExposed | null>(null)
const cursorPos = ref(0)

// ── 常量配置 ──────────────────────────────────────────────
const INDENT_WIDTH_PER_LEVEL = 14 // px

// ── 缩进（由 depth prop 直接计算，O(1)） ──
const indentWidth = computed(() => `${props.depth * INDENT_WIDTH_PER_LEVEL}px`)

// ── 折叠状态（由 useBlockCollapse 统一管理） ──
// fieldRowCount = 第二路折叠守卫（ADR-0045 折叠范围扩展：子树 + 字段带）
const {
  collapsed,
  canCollapse,
  isAnimating,
  toggleCollapse,
  updateChildrenHeight,
} = useBlockCollapse(
  computed(() => props.node),
  fieldRowCount,
  // 子节点容器 DOM（.block-children）：折叠/展开动画用它注入真实高度，消除末段卡顿
  () => blockDraggableRef.value?.getContainerEl() ?? null,
)

// ── 子节点列表容器（拖拽接线由 BlockDraggableList 统一承载） ──
// 拖拽配置 / @move 循环嵌套守卫 / @end 指示器清理与落库，均与根级列表同源，
// 见 ./components/BlockDraggableList.vue。此处只负责本块子容器的类名（折叠动画）。
// hasChildren 只问「有没有子块」——不含字段行（canCollapse 才含）。
// 折叠态 chevron 永久显示只对子块生效：纯字段折叠没有子树可指认，
// 常亮箭头会暗示「下面藏着一棵子树」。
const hasChildren = computed(() => props.node.children.length > 0)
const childrenContainerClass = computed(() => ({
  'block-children': true,
  'has-children': !collapsed.value && hasChildren.value,
  'is-collapsed': collapsed.value,
  'is-animating': isAnimating.value,
}))

// ── 子任务进度：子 block 含任务项（status 字段，Canceled/Archived 除外）时显示进度条 ──
const { progress: childTaskProgress } = useChildTaskProgress(childrenModel)

/**
 * 进度条左侧对齐到上方任务图标右缘（grill 意见）：
 * 行内偏移 = 缩进(depth × --block-indent-width) + bullet(20px) + 状态图标(24px)。
 */
const taskProgressLeft = computed(() => `calc(${props.depth} * var(--block-indent-width) + 44px)`)

// ── 编辑器生命周期（由 useBlockEditorLifecycle 统一管理） ──
// 原 ~300 行 save/split/merge/delete/indent/outdent/move/exit/click/mousedown
// 已抽离至 ./composables/useBlockEditorLifecycle。
// watch(isActive, ...) 保留在此处：涉及 nextTick/requestAnimationFrame/editorRef，
// 属于渲染周期协调，不宜移入 composable。
const {
  isActive,
  handleSave,
  handleLanguageChange,
  handleSplit,
  handleMerge,
  handleDelete,
  handleIndent,
  handleOutdent,
  handleMoveUp,
  handleMoveDown,
  handleMoveLeft,
  handleMoveRight,
  handleExitEdit,
  handleBackspaceEmpty,
  handleClear,
  handleCursorChange,
  handleContentMousedown,
  handleContentClick,
  syncBlockContent,
} = useBlockEditorLifecycle({
  blockId,
  pageId: props.pageId,
  editorRef,
  cursorPos,
  collapsed,
  blockStore,
  editorStore,
  pageStore,
  relationshipCleanup,
  selection: selection ?? undefined,
})

// ── 类型特化钩子（由各 handler 的 setupBlock 提供）──
// handler 变化（block.type 改变）时重新调用 setupBlock 获取该类型的钩子。
// index.vue 不再包含任何 block.type === 'xxx' 分支，全部通过 typeHooks 派发。
const setupCtx: BlockSetupContext = {
  blockId,
  block,
  pageId: props.pageId,
  getFieldValue: getBlockFieldValue,
  getFieldValuesMap: getBlockFieldValuesMap,
  setFieldValue,
  blockStore,
  editorStore,
  fieldValueStore,
  pageStore,
  navigateToPage,
}

const typeHooks = computed<BlockTypeHooks | undefined>(() => {
  return handler.value?.setupBlock?.(setupCtx) ?? undefined
})

watch(() => block.value.type, (newType, oldType) => {
  typeHooks.value?.onTypeChanged?.(newType, oldType)
})

// 子节点列表实例 ref（用于获取子节点容器 DOM 做高度测量）
const blockDraggableRef = ref<InstanceType<typeof BlockDraggableList> | null>(null)

/** 子节点容器 DOM（由 BlockDraggableList 暴露的 getContainerEl） */
const childrenEl = computed<HTMLElement | null>(() => {
  return blockDraggableRef.value?.getContainerEl() ?? null
})

onMounted(() => {
  typeHooks.value?.onMounted?.()
  updateChildrenHeight(childrenEl.value)

  // 监听删除 between 属性的事件
  // 使用捕获阶段监听，以便在事件冒泡前处理
  document.addEventListener('delete-between-property', handleDeleteBetweenProperty, true)

  const el = document.querySelector(`[data-block-id="${blockId.value}"]`)
  if (el) {
    el.addEventListener('dragover', onDragOver as unknown as EventListener)
    el.addEventListener('drop', onDrop as unknown as EventListener)
    el.addEventListener('paste', onPaste as unknown as EventListener)
  }

  // 挂载时若已是激活态（新建块在 activateBlock 之后才渲染、或懒加载后才挂载的根块），
  // isActive 在挂载瞬间即为 true，watch(isActive) 不会因「变化」触发，需在此主动聚焦，
  // 否则新块停在只读渲染态 / 光标未落位（Issue 2：弹窗内 Enter 新建节点未激活）。
  if (isActive.value) {
    registerContentFlusher()
    focusActiveEditor()
  }
})

onBeforeUnmount(() => {
  typeHooks.value?.onBeforeUnmount?.()
  document.removeEventListener('delete-between-property', handleDeleteBetweenProperty, true)

  const el = document.querySelector(`[data-block-id="${blockId.value}"]`)
  if (el) {
    el.removeEventListener('dragover', onDragOver as unknown as EventListener)
    el.removeEventListener('drop', onDrop as unknown as EventListener)
    el.removeEventListener('paste', onPaste as unknown as EventListener)
  }
})

async function handleDeleteBetweenProperty(e: Event) {
  const customEvent = e as CustomEvent
  
  // 检查事件是否已经处理过
  if (customEvent.defaultPrevented) {
    return
  }
  
  // 只在当前 Block 激活时处理
  if (!isActive.value) {
    return
  }
  
  const blockFields = fieldValueStore.getBlockFieldValues(blockId.value)

  // 查找 between 位置的字段值（status/priority）
  const betweenFields = blockFields.filter(fv => {
    const def = fieldValueStore.getFieldDef(fv.key)
    return def?.displayPosition === 'between-bullet-content'
  })

  if (betweenFields.length > 0) {
    // 阻止默认的 merge 行为
    customEvent.preventDefault()
    
    // 删除字段值
    await fieldValueStore.deleteFieldValue(betweenFields[0].id, blockId.value)
  }
}

/**
 * 激活后聚焦编辑器。
 * 优先级：点击坐标 > cursorPos > end。
 * 等待浏览器 layout 完成，确保 ProseMirror 的 view.dom 已渲染（posAtCoords 依赖布局信息）。
 */
async function focusActiveEditor() {
  if (!isActive.value) return
  selection?.clearSelection()
  await nextTick()
  await new Promise(resolve => requestAnimationFrame(resolve))
  if (!editorRef.value) return
  const editor = editorRef.value.getEditor()
  if (editor) {
    editorStore.setActiveEditor(editor)
  }

  // 优先级：跨块同列 > 点击坐标 > cursorPos > end
  const arrowFocus = editorStore.consumeArrowFocus()
  if (arrowFocus && editorRef.value?.getEditor()) {
    const editor = editorRef.value.getEditor() as Editor | EditorView
    // x = null：不保持列，'last' 直接落行尾 / 'first' 落行首（块首左移场景）
    if (arrowFocus.x === null) {
      editorRef.value.focus(arrowFocus.line === 'last' ? 'end' : 'start')
      return
    }
    // 代码块（CodeMirror）目标：getEditor() 返回 CM EditorView（无 .view），
    // 用 CM 的 coordsAtPos/posAtCoords 做同列落位（与 PM 分支同语义）
    if ('lineBlockAt' in editor) {
      const cm = editor as unknown as EditorView
      const docLen = cm.state.doc.length
      // 目标落位行：'first' → 文档起始，'last' → 文档末尾
      const linePos = arrowFocus.line === 'last' ? docLen : 0
      const lineRect = cm.coordsAtPos(linePos)
      if (lineRect) {
        // 末行用底线略上、首行用顶线略下，水平用源块 caret x（posAtCoords 钳制到该行最近位置）
        const top = arrowFocus.line === 'last' ? lineRect.bottom - 1 : lineRect.top + 1
        const hit = cm.posAtCoords({ x: arrowFocus.x, y: top })
        cm.dispatch({
          selection: { anchor: hit ?? linePos },
          scrollIntoView: true,
        })
      } else {
        cm.dispatch({ selection: { anchor: linePos }, scrollIntoView: true })
      }
      cm.focus()
      return
    }
    const view = editor.view
    const doc = view.state.doc
    // 目标落位行：上移→上一块末行，下移→下一块首行
    const linePos = arrowFocus.line === 'last'
      ? Math.max(1, doc.content.size - 1)
      : 1
    const lineCoords = view.coordsAtPos(linePos)
    // 取该行纵坐标（末行用底线略上、首行用顶线略下），水平用源块 caret x
    const top = arrowFocus.line === 'last' ? lineCoords.bottom - 1 : lineCoords.top + 1
    const hit = view.posAtCoords({ left: arrowFocus.x, top })
    if (hit) {
      editorRef.value.focus(hit.pos)
    } else if (arrowFocus.line === 'last') {
      editorRef.value.focus('end')
    } else {
      editorRef.value.focus('start')
    }
    return
  }

  // 优先级：点击坐标 > 撤销恢复的选区 > cursorPos > end
  const clickCoords = editorStore.consumeClickCoords()
  const pendingRange = editorStore.consumeSelectionRange()
  if (clickCoords) {
    editorRef.value?.focusAtCoords?.(clickCoords.x, clickCoords.y)
  } else {
    const pendingPos = editorStore.consumeCursorPos()
    if (pendingRange) {
      // 撤销/重做恢复的选区优先于单点：范围（选中态）也是状态的一部分
      if (editorRef.value.focusRange) editorRef.value.focusRange(pendingRange.from, pendingRange.to)
      else editorRef.value.focus(pendingRange.to)
    } else if (pendingPos !== null) {
      editorRef.value.focus(pendingPos)
    } else {
      editorRef.value.focus('end')
    }
  }
}

/**
 * 把「编辑器里未落库的正文 → store」的出口挂到 editorStore：撤销/重做前由
 * `runUndoOrRedo` 调用（打字进 store 走 300ms 防抖，不同步会撤错步，见该函数注释）。
 * 用 flush: false 只写内存 —— 落库交给恢复时的单事务，不给撤销热路径加 save_block_tree。
 */
function registerContentFlusher() {
  editorStore.registerContentFlusher(blockId.value, () => syncBlockContent(false))
}

/**
 * 选区上报（撤销历史视图态）：把「现在光标/选区在哪」写进历史栈，供撤销/重做回放。
 * `contentChanged` 由编辑器事务给出 —— 只有**纯移动/纯选中**才就地更新当前快照的选区；
 * 与正文改动同事务时不动旧快照（改动后那一刻属于即将入栈的新快照）。
 */
function handleSelectionChange(payload: { from: number; to: number; contentChanged: boolean }) {
  // 只认活动块的选区：非活动块的编辑器在挂载/失焦时也会走事务，若上报进来会把
  // 历史栈顶的视图态改成「用户根本不在的那一块」—— 下次撤销就把光标送错块。
  if (!isActive.value) return
  recordSelection(
    props.pageId,
    { blockId: blockId.value, from: payload.from, to: payload.to },
    { contentChanged: payload.contentChanged },
  )
}

watch(
  isActive,
  (active) => {
    if (active) {
      // 撤销/重做前要把编辑器里未落库的正文同步进 store（打字走 300ms 防抖），
      // 出口挂在 store 上供 runUndoOrRedo 调用 —— 见 editorStore.registerContentFlusher。
      registerContentFlusher()
      focusActiveEditor()
    } else {
      editorStore.setActiveEditor(null)
      editorStore.registerContentFlusher(blockId.value, null)
    }
  },
  { immediate: false }
)

/** 监听子节点数量/内容变化时更新 childrenHeight */
watch(
  () => props.node.children.map(c => c.id).join(','),
  async () => {
    await nextTick()
    updateChildrenHeight(childrenEl.value)
  },
  { flush: 'post' }
)

/** mousedown/click/save/split/merge/delete/indent/outdent/move/exit/cursor/clear
 * 等编辑器生命周期逻辑已抽离至 ./composables/useBlockEditorLifecycle。
 * 此处仅保留 watch(isActive, ...) 做渲染周期协调。 */

// ── 事件派发：先询问类型钩子，钩子返回 true 则跳过默认行为 ──
function onContentMousedown(e: MouseEvent) {
  if (typeHooks.value?.onContentMousedown?.(e) === true) return
  handleContentMousedown(e)
}

function onContentClick(e: MouseEvent) {
  if (typeHooks.value?.onContentClick?.(e) === true) return
  handleContentClick(e)
}

/** 内容区以外的「自交互」元素：保留自身点击语义，Ctrl/Cmd+Click 不接管 */
const SELF_INTERACTIVE_SELECTOR =
  '.block-link, .rel-type-label, .date-ref, .property-item, .property-inline-item'

/**
 * 块选区命中面（ADR-0035 D6）：`Ctrl/Cmd+Click` 在**整块行内、内容区以外**的任意
 * 非自交互落点都切换整块选中。
 *
 * 修正前的缺陷：命中面只挂在 `.block-content`，块内其余落点（属性区、缩进行空白、
 * 行内空隙）按 Ctrl/Cmd 毫无反应；而属性区在无属性块上高度为 0，更是完全点不到。
 *
 * 不接管内容区：那里由 handleContentMousedown 处理，且类型钩子（image/embed/code）
 * 对 mousedown 有专属语义，上提会破坏它们。
 * 不接管 bullet 区：它是 Sortable 的拖拽手柄，点击又归 BlockModal（ADR-0039）。
 */
function onBlockMousedown(e: MouseEvent) {
  if (e.button !== 0) return
  if (!e.ctrlKey && !e.metaKey) return
  const target = e.target as HTMLElement | null
  if (typeof target?.closest !== 'function') return
  // 归属守卫：子块的事件会冒泡到祖先 .block，不得越权切换祖先的选中态
  if (target.closest('[data-block-id]')?.getAttribute('data-block-id') !== blockId.value) return
  if (target.closest('.block-content')) return
  if (target.closest('.block-bullet')) return
  if (target.closest(SELF_INTERACTIVE_SELECTOR)) return

  selection?.toggleBlock(blockId.value, pageStore.currentPageId)
  e.preventDefault()
}

/** 字段区 mousedown：作为块选区起点（ADR-0035 D6），只做块选区、不激活编辑器 */
function onFieldValueMousedown(e: MouseEvent) {
  if (e.button !== 0) return
  // Ctrl/Cmd+Click 交给块级命中面 onBlockMousedown 统一接管（其命中面覆盖本区域）
  if (e.ctrlKey || e.metaKey) return
  selection?.startTracking(blockId.value, true)
}

// ── 字段区显隐 ─────────────────────────────────────────────
// D21 决策 3/8 的 `format.fields_hidden`（hover「×」隐藏 + 「显示字段区」恢复）已废弃：
// 字段带的显隐统一并入块折叠（ADR-0045 折叠范围扩展），隐藏只有一个来源。

async function onLanguageChange(lang: string) {
  if (typeHooks.value?.onLanguageChange) {
    await typeHooks.value.onLanguageChange(lang)
  } else {
    await handleLanguageChange(lang)
  }
}

/** bullet dot 点击：打开单块子树编辑弹窗；弹窗内（inBlockModal）为 no-op（ADR-0039） */
function onBulletClick() {
  if (inBlockModal) return
  editorStore.openBlockModal(blockId.value)
}

function onDragOver(e: DragEvent) {
  if (typeHooks.value?.onDragOver?.(e) === true) return
  // 默认无行为
}

async function onDrop(e: DragEvent) {
  // onDrop 钩子为 async，需 await 拿到布尔结果；e.preventDefault() 已在钩子内同步调用
  if (await typeHooks.value?.onDrop?.(e) === true) return
}

async function onPaste(e: ClipboardEvent) {
  // onPaste 钩子为 async，需 await 拿到布尔结果；e.preventDefault() 已在钩子内同步调用
  if (await typeHooks.value?.onPaste?.(e) === true) return
}

/** 选中（激活）Block 时：锁定 activeBlockId。不再自动切右侧栏面板（保持用户当前面板，避免误打断）。 */
watch(isActive, (active) => {
  if (!active) return
  editorStore.activateBlock(blockId.value)
})
</script>

<template>
  <div
    class="block"
    :class="[priorityClass, statusClass, { active: isActive, 'cb-selected': isSelected && !hasSelectedAncestor, 'is-collapsed': collapsed, 'is-animating': isAnimating }]"
    :data-block-id="blockId"
    :style="{ '--block-indent': indentWidth, '--indent-depth': depth }"
    @mousedown="onBlockMousedown"
  >
    <div class="block-row">
      <!-- 缩进占位 -->
      <div
        class="block-indent"
        :style="{ width: indentWidth }"
      />

      <!-- 内容区域（bullet + content）- 选中时边框只应用到此容器 -->
      <div class="block-inner">
        <!-- Bullet：dot 常显，点击打开单块子树编辑弹窗（BlockModal）；
             chevron 在有子块**或有字段行**时（canCollapse，ADR-0045 折叠范围扩展）且 hover 时显现，
             点击负责折叠/展开（ADR-0039） -->
        <span
          class="block-bullet"
          :class="{ collapsed, 'hide-empty-bullet': hideBulletForEmpty }"
        >
          <span
            v-if="canCollapse"
            class="bullet-chevron"
            :class="{ 'is-pinned': collapsed && hasChildren }"
            title="折叠 / 展开"
            @click.stop="toggleCollapse"
          >
            <!-- 单图标 + CSS 旋转：展开 0°（朝下），折叠 rotate(-90°)（朝右，视觉同 ChevronRight）。
                 v-if 换图标只能瞬间跳变，旋转过渡才能与折叠动效同步（参数见 _block.scss） -->
            <ChevronDown
              :size="18"
              :stroke-width="2"
            />
          </span>
          <span
            class="bullet-dot"
            title="打开块详情"
            @click.stop="onBulletClick"
          />
        </span>

        <div class="block-body">
          <!-- Between 字段值显示 -->
          <BlockFieldZone
            :block-id="blockId"
            variant="between"
          />

          <!-- 内容区 -->
          <div
            class="block-content"
            @mousedown="onContentMousedown"
          >
            <component
              :is="handler.editorComponent"
              v-if="isActive && handler"
              ref="editorRef"
              :block-id="blockId"
              :content="editContent"
              :show-full-placeholder="isSingleEmptyBlock"
              :field-values="getBlockFieldValuesMap()"
              :language="getBlockFieldValue('language')"
              @save="handleSave"
              @split="handleSplit"
              @merge="handleMerge"
              @delete="handleDelete"
              @indent="handleIndent"
              @outdent="handleOutdent"
              @move-up="handleMoveUp"
              @move-down="handleMoveDown"
              @move-left="handleMoveLeft"
              @move-right="handleMoveRight"
              @backspace-empty="handleBackspaceEmpty"
              @exit-edit="handleExitEdit"
              @cursor-change="handleCursorChange"
              @selection-change="handleSelectionChange"
              @language-change="onLanguageChange"
            />
            <component
              :is="handler.renderComponent"
              v-else-if="handler"
              :block-id="blockId"
              :content="block.content"
              :field-values="getBlockFieldValuesMap()"
              :language="getBlockFieldValue('language')"
              :show-placeholder="isSingleEmptyBlock"
              :readonly="true"
              @content-click="onContentClick"
              @language-change="onLanguageChange"
              @clear="handleClear"
            />
            <div
              v-else
              class="block-text block-text--unregistered"
            >
              <span class="block-placeholder">{{ block.type }} (not registered)</span>
            </div>
          </div>

          <!-- 内容行尾内联槽：priority 象限网格图标（ADR-0054 D3/D4 恢复）。
               只读展示位 —— 与下方字段区（录入面）职责不同，不互斥。 -->
          <BlockFieldZone
            :block-id="blockId"
            variant="right"
          />
        </div>
      </div>
    </div>

    <!-- 字段带（content 下方）：书笔记来源行 + 块字段区。
         本块折叠时整带隐藏（`.block.is-collapsed > .block-properties`，见 _block.scss）——
         字段带与子树同属「本块的可折叠细节」（ADR-0045 折叠范围扩展）。 -->
    <div
      class="block-properties"
      @mousedown="onFieldValueMousedown"
    >
      <BlockFieldZone
        :block-id="blockId"
        variant="book-note"
      />
      <!-- 块字段区（ADR-0050 D1「挂载即显示」）：只渲染该块已挂标签的有效字段。
           是否渲染由 `fields.length` 决定——全被 hide_when 拦掉时不出空容器（与折叠守卫同源） -->
      <BlockFieldZone
        :block-id="blockId"
        :tag-ids="block.tags ?? []"
        variant="list"
      />
    </div>

    <!-- 子任务进度条：子 block 含任务项（status 字段）时显示在 block 下方；
         Canceled/Archived 不参与，全部删除后随树重建自动消失。
         随本块折叠一起隐藏（`.block.is-collapsed > .block-child-task-progress`，见 _block.scss）——
         与字段带、子树同属「本块的可折叠细节」（ADR-0045 折叠范围扩展）。 -->
    <TaskProgressBar
      v-if="childTaskProgress"
      :done="childTaskProgress.done"
      :total="childTaskProgress.total"
      class="block-child-task-progress"
      :style="{ marginLeft: taskProgressLeft }"
    />

    <!--
      子节点列表（BlockDraggableList：拖拽接线 + 折叠动画容器）
      - v-model="node.children" 驱动渲染与拖拽
      - embed 子块不渲染拖拽子列表（无可拖拽内容）
      - collapsed / isAnimating 驱动容器类名；childrenHeight 由 useBlockCollapse 维护
    -->
    <BlockDraggableList
      v-if="node.block.type !== 'embed'"
      ref="blockDraggableRef"
      v-model="childrenModel"
      :page-id="pageId"
      :parent-id="node.id"
      :depth="depth + 1"
      :class="childrenContainerClass"
      @drag-end="intent => onDragEnd?.(intent)"
    />
  </div>
</template>
