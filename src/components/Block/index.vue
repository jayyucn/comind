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
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useBlockRegistry } from '../../composables/useBlockRegistry'
import { useBlockRelationshipCleanup } from '../../composables/useBlockRelationshipCleanup'
import { useBlockStore } from '../../stores/blocks'
import { useEditorStore } from '../../stores/editor'
import { usePropertyStore } from '../../stores/property'
import BlockDraggableList from './components/BlockDraggableList.vue'
import { useBlockCollapse } from './composables/useBlockCollapse'
import { useBlockEditorLifecycle } from './composables/useBlockEditorLifecycle'
import { useBlockPropertySync } from './composables/useBlockPropertySync'
import './handlers/bullet'
import './handlers/code'
import './handlers/embed'
import './handlers/image'
import PropertyDisplay from './PropertyDisplay.vue'
import PropertyInline from './PropertyInline.vue'

import type { EditorView } from '@codemirror/view'
import type { CrossBlockSelection } from '../../composables/useCrossBlockSelection'
import { useNavigateToPage } from '../../composables/useNavigateToPage'
import { usePageStore } from '../../stores/pages'
import type { TreeNode } from '../../types/block'
import type { BlockSetupContext, BlockTypeEditorExposed, BlockTypeHooks } from '../../types/block-type'
import {
  decodeRelationshipContent,
  setRelationshipSnapshot,
} from '../../utils/relationship-content'
import type { DragEndIntent } from './composables/useBlockDragDrop'

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

// ── 属性读取 / 优先级 CSS 类（由 useBlockPropertySync 统一管理）──
const {
  getProperty: getBlockProperty,
  getPropertiesMap: getBlockPropertiesMap,
  setProperty,
  priorityClass,
  statusClass,
} = useBlockPropertySync(blockId)

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
const INDENT_WIDTH_PER_LEVEL = 24 // px

// ── 缩进（由 depth prop 直接计算，O(1)） ──
const indentWidth = computed(() => `${props.depth * INDENT_WIDTH_PER_LEVEL}px`)

// ── 折叠状态（由 useBlockCollapse 统一管理） ──
const {
  collapsed,
  isAnimating,
  toggleCollapse,
  updateChildrenHeight,
} = useBlockCollapse(computed(() => props.node))

// ── 子节点列表容器（拖拽接线由 BlockDraggableList 统一承载） ──
// 拖拽配置 / @move 循环嵌套守卫 / @end 指示器清理与落库，均与根级列表同源，
// 见 ./components/BlockDraggableList.vue。此处只负责本块子容器的类名（折叠动画）。
const childrenContainerClass = computed(() => ({
  'block-children': true,
  'has-children': !collapsed.value && props.node.children.length > 0,
  'is-collapsed': collapsed.value,
  'is-animating': isAnimating.value,
}))

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
  getProperty: getBlockProperty,
  getPropertiesMap: getBlockPropertiesMap,
  setProperty,
  blockStore,
  editorStore,
  propertyStore,
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
  
  const blockProps = propertyStore.getBlockProperties(blockId.value)

  // 查找 between 位置的属性（status/priority）
  const betweenProps = blockProps.filter(prop => {
    const def = propertyStore.getPropertyDef(prop.key)
    return def?.displayPosition === 'between-bullet-content'
  })

  if (betweenProps.length > 0) {
    // 阻止默认的 merge 行为
    customEvent.preventDefault()
    
    // 删除属性
    await propertyStore.deleteProperty(betweenProps[0].id, blockId.value)
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
    const editor = editorRef.value.getEditor()!
    // x = null：不保持列，'last' 直接落行尾 / 'first' 落行首（块首左移场景）
    if (arrowFocus.x === null) {
      editorRef.value.focus(arrowFocus.line === 'last' ? 'end' : 'start')
      return
    }
    // 代码块（CodeMirror）目标：getEditor() 返回 CM EditorView（无 .view），
    // 用 CM 的 coordsAtPos/posAtCoords 做同列落位（与 PM 分支同语义）
    if (typeof (editor as any).lineBlockAt === 'function') {
      const cm = editor as EditorView
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
    const view = (editor as any).view
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

  // 优先级：点击坐标 > cursorPos > end
  const clickCoords = editorStore.consumeClickCoords()
  if (clickCoords) {
    editorRef.value?.focusAtCoords?.(clickCoords.x, clickCoords.y)
  } else {
    const pendingPos = editorStore.consumeCursorPos()
    if (pendingPos !== null) {
      editorRef.value.focus(pendingPos)
    } else {
      editorRef.value.focus('end')
    }
  }
}

watch(
  isActive,
  (active) => {
    if (active) {
      focusActiveEditor()
    } else {
      editorStore.setActiveEditor(null)
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

/** 属性区 mousedown：作为块选区起点（ADR-0035 D6），只做块选区、不激活编辑器 */
function onPropertyMousedown(e: MouseEvent) {
  if (e.button !== 0) return
  selection?.startTracking(blockId.value, true)
}

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
    :class="[priorityClass, statusClass, { active: isActive, 'cb-selected': isSelected && !hasSelectedAncestor }]"
    :data-block-id="blockId"
    :style="{ '--block-indent': indentWidth }"
  >
    <div class="block-row">
      <!-- 缩进占位 -->
      <div class="block-indent" :style="{ width: indentWidth }"></div>

      <!-- 内容区域（bullet + content）- 选中时边框只应用到此容器 -->
      <div class="block-inner">
        <!-- Bullet：dot 常显，点击打开单块子树编辑弹窗（BlockModal）；
             chevron 仅在有子块且 hover 时显现，点击负责折叠/展开（ADR-0039） -->
        <span class="block-bullet" :class="{ collapsed, 'hide-empty-bullet': hideBulletForEmpty }">
          <span
            v-if="node.children.length > 0"
            class="bullet-chevron"
            title="折叠 / 展开"
            @click.stop="toggleCollapse"
          >
            <ChevronDown v-if="!collapsed" :size="18" :stroke-width="2" />
            <ChevronRight v-else :size="18" :stroke-width="2" />
          </span>
          <span class="bullet-dot" title="打开块详情" @click.stop="onBulletClick"></span>
        </span>

        <div class="block-body">
        <!-- Between 属性显示 -->
        <PropertyInline :block-id="blockId" position="between-bullet-content" />

        <!-- 内容区 -->
        <div class="block-content" @mousedown="onContentMousedown">
          <component
            v-if="isActive && handler"
            :is="handler.editorComponent"
            ref="editorRef"
            :block-id="blockId"
            :content="editContent"
            :show-full-placeholder="isSingleEmptyBlock"
            :properties="getBlockPropertiesMap()"
            :language="getBlockProperty('language')"
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
            @language-change="onLanguageChange"
          />
          <component
            v-else-if="handler"
            :is="handler.renderComponent"
            :block-id="blockId"
            :content="block.content"
            :properties="getBlockPropertiesMap()"
            :language="getBlockProperty('language')"
            :show-placeholder="isSingleEmptyBlock"
            :readonly="true"
            @content-click="onContentClick"
            @language-change="onLanguageChange"
            @clear="handleClear"
          />
          <div v-else class="block-text block-text--unregistered">
            <span class="block-placeholder">{{ block.type }} (not registered)</span>
          </div>
        </div>

        <!-- Right 属性显示 -->
        <PropertyInline :block-id="blockId" position="right-of-content" />
        </div>
      </div>
    </div>

    <!-- 属区显示区 -->
    <div class="block-properties" @mousedown="onPropertyMousedown">
      <PropertyDisplay :block-id="blockId" />
    </div>

    <!--
      子节点列表（BlockDraggableList：拖拽接线 + 折叠动画容器）
      - v-model="node.children" 驱动渲染与拖拽
      - embed 子块不渲染拖拽子列表（无可拖拽内容）
      - collapsed / isAnimating 驱动容器类名；childrenHeight 由 useBlockCollapse 维护
    -->
    <BlockDraggableList
      v-if="node.block.type !== 'embed'"
      ref="blockDraggableRef"
      v-model="node.children"
      :page-id="pageId"
      :parent-id="node.id"
      :depth="depth + 1"
      :class="childrenContainerClass"
      :style="{ '--indent-depth': depth }"
      @drag-end="intent => onDragEnd?.(intent)"
    />
  </div>
</template>

<style scoped lang="scss">
</style>
