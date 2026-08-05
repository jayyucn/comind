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
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount, inject, toRef } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { useBlockStore } from '../../stores/blocks'
import { usePropertyStore } from '../../stores/property'
import { useBlockRegistry } from '../../composables/useBlockRegistry'
import { useBlockRelationshipCleanup } from '../../composables/useBlockRelationshipCleanup'
import { useBlockPropertySync } from './composables/useBlockPropertySync'
import { useBlockCollapse } from './composables/useBlockCollapse'
import { useBlockDragDrop } from './composables/useBlockDragDrop'
import { useBlockEditorLifecycle } from './composables/useBlockEditorLifecycle'
import BlockChildren from './components/BlockChildren.vue'
import './handlers/bullet'
import './handlers/code'
import './handlers/image'
import './handlers/embed'
import PropertyDisplay from './PropertyDisplay.vue'
import PropertyInline from './PropertyInline.vue'

import { usePageStore } from '../../stores/pages'
import { useNavigateToPage } from '../../composables/useNavigateToPage'
import { useIdeasFreeze } from '../../composables/useIdeasFreeze'
import type { TreeNode } from '../../types/block'
import type { BlockTypeEditorExposed, BlockSetupContext, BlockTypeHooks } from '../../types/block-type'
import type { CrossBlockSelection } from '../../composables/useCrossBlockSelection'

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
const { isFrozen } = useIdeasFreeze(toRef(props, 'pageId'))

// 注入拖拽结束回调（由 BlockList 提供）
const onDragEnd = inject<() => void>('onDragEnd')
const selection = inject<CrossBlockSelection>('crossBlockSelection')

// ── 便捷访问 ──
const blockId = computed(() => props.node.id)
const block = computed(() => props.node.block)

// ── 属性读取 / 优先级 CSS 类（由 useBlockPropertySync 统一管理）──
const {
  getProperty: getBlockProperty,
  getPropertiesMap: getBlockPropertiesMap,
  setProperty,
  priorityClass,
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
  return block.value.content
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
  childrenHeight,
  toggleCollapse,
  updateChildrenHeight,
} = useBlockCollapse(computed(() => props.node))

// ── 拖放逻辑（由 useBlockDragDrop 统一管理） ──
// 原 ~250 行 findDropTarget/handleDragMove/handleBlockDragEnd/指示器渲染
// 已抽离至 ./composables/useBlockDragDrop。
// 指示器状态为模块级共享 ref，由 BlockList 渲染单个 <BlockDropIndicator> 消费，
// 消除 document.querySelector DOM 操作并避免跨容器拖拽时的残留指示器。
const {
  handleDragMove,
  handleBlockDragEnd,
} = useBlockDragDrop({
  blockId,
  pageId: props.pageId,
  blockStore,
  pageStore,
  onDragEnd,
})

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
  handleExitEdit,
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

// BlockChildren 实例 ref（用于获取子节点容器 DOM 做高度测量）
const blockChildrenRef = ref<InstanceType<typeof BlockChildren> | null>(null)

/** 获取子节点容器的 DOM 元素（透过 BlockChildren → VueDraggable → $el） */
const childrenEl = computed(() => {
  return (blockChildrenRef.value as any)?.draggableRef?.$el as HTMLElement | null
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

watch(
  isActive,
  async (active) => {
    if (active) {
      selection?.clearSelection()
      await nextTick()
      // 等待浏览器完成 layout，确保 ProseMirror 的 view.dom 已渲染（posAtCoords 依赖布局信息）
      await new Promise(resolve => requestAnimationFrame(resolve))
      if (editorRef.value) {
        const editor = editorRef.value.getEditor()
        if (editor) {
          editorStore.setActiveEditor(editor)
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

async function onLanguageChange(lang: string) {
  if (typeHooks.value?.onLanguageChange) {
    await typeHooks.value.onLanguageChange(lang)
  } else {
    await handleLanguageChange(lang)
  }
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
</script>

<template>
  <div class="block" :class="[priorityClass, { active: isActive, 'cb-selected': isSelected && !hasSelectedAncestor }]" :data-block-id="blockId">
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
            :readonly="isFrozen"
            @save="handleSave"
            @split="handleSplit"
            @merge="handleMerge"
            @delete="handleDelete"
            @indent="handleIndent"
            @outdent="handleOutdent"
            @move-up="handleMoveUp"
            @move-down="handleMoveDown"
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

    <!-- 属区显示区 -->
    <div class="block-properties">
      <PropertyDisplay :block-id="blockId" />
    </div>

    <!--
      子节点容器（<BlockChildren> 封装 VueDraggable + 折叠动画）
      - 内部 v-model="node.children" 驱动渲染和拖拽
      - move-handler 保留返回值以阻止循环嵌套等非法移动
      - collapsed / isAnimating / childrenHeight 由 useBlockCollapse 管理
    -->
    <BlockChildren
      ref="blockChildrenRef"
      :node="node"
      :page-id="pageId"
      :depth="depth"
      :collapsed="collapsed"
      :is-animating="isAnimating"
      :children-height="childrenHeight"
      :move-handler="handleDragMove"
      @drag-start="editorStore.deactivateBlock()"
      @drag-end="handleBlockDragEnd"
    />
  </div>
</template>

<style scoped lang="scss">
</style>
