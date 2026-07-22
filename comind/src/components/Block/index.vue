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
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount, inject } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { useBlockStore } from '../../stores/blocks'
import { usePropertyStore } from '../../stores/property'
import { useNavigateToPage } from '../../composables/useNavigateToPage'
import { useBlockRegistry } from '../../composables/useBlockRegistry'
import { useRelationshipMenu } from '../../composables/useRelationshipMenu'
import { useBlockRelationshipCleanup } from '../../composables/useBlockRelationshipCleanup'
import { useBlockPropertySync } from './composables/useBlockPropertySync'
import { useBlockCollapse } from './composables/useBlockCollapse'
import { useBlockDragDrop } from './composables/useBlockDragDrop'
import BlockChildren from './components/BlockChildren.vue'
import BlockDropIndicator from './components/BlockDropIndicator.vue'
import { useDateTimePickerPanel, useDateRefClickListener, computeDatePickerPosition } from '../../composables/useDateTimePickerPanel'
import './handlers/bullet'
import './handlers/code'
import './handlers/image'
import './handlers/embed'
import './handlers/concept'
import PropertyDisplay from './PropertyDisplay.vue'
import PropertyInline from './PropertyInline.vue'

import { usePageStore } from '../../stores/pages'
import BlockSelector from '../BlockSelector.vue'
import { DATE_REF_REGEX, serializeDateRef, normalizeRecurrence } from '../../utils/date-ref'
import type { TreeNode } from '../../types/block'
import type { BlockTypeEditorExposed } from '../../types/block-type'
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
const { navigateToPage } = useNavigateToPage()
const { getHandler } = useBlockRegistry()
const relMenu = useRelationshipMenu()
const relationshipCleanup = useBlockRelationshipCleanup()

// ── dateRef 编辑面板 ────────────────────────────────────────────────────────
const {
  open: openDateRefPanel,
} = useDateTimePickerPanel()

useDateRefClickListener((payload, position) => {
  openDateRefPanel({ ...payload, position })
})

const showBlockSelector = ref(false)

function handleEmbedSelect(sourceBlockId: string, sourcePageId: string) {
  blockStore.updateBlockProperties(blockId.value, { sourceBlockId, sourcePageId })
  showBlockSelector.value = false
  editorStore.deactivateBlock()
}

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
  priorityClass,
} = useBlockPropertySync(blockId)

watch(() => block.value.type, (newType) => {
  if (newType === 'embed' && !getBlockProperty('sourceBlockId')) {
    nextTick(() => {
      showBlockSelector.value = true
    })
  }
})

const isActive = computed(() => editorStore.activeBlockId === blockId.value)
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
  const contentBlocks = blockStore.getBlocksByPage(pageStore.currentPageId)
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
// 指示器改为响应式 <BlockDropIndicator> 子组件，消除 document.querySelector DOM 操作。
const {
  indicatorStyle,
  indicatorClass,
  indicatorVisible,
  handleDragMove,
  handleBlockDragEnd,
} = useBlockDragDrop({
  blockId,
  pageId: props.pageId,
  blockStore,
  pageStore,
  onDragEnd,
})

// BlockChildren 实例 ref（用于获取子节点容器 DOM 做高度测量）
const blockChildrenRef = ref<InstanceType<typeof BlockChildren> | null>(null)

/** 获取子节点容器的 DOM 元素（透过 BlockChildren → VueDraggable → $el） */
const childrenEl = computed(() => {
  return (blockChildrenRef.value as any)?.draggableRef?.$el as HTMLElement | null
})

onMounted(() => {
  updateChildrenHeight(childrenEl.value)

  // 监听删除 between 属性的事件
  // 使用捕获阶段监听，以便在事件冒泡前处理
  document.addEventListener('delete-between-property', handleDeleteBetweenProperty, true)

  const el = document.querySelector(`[data-block-id="${blockId.value}"]`)
  if (el) {
    el.addEventListener('dragover', handleDragOver as EventListener)
    el.addEventListener('drop', handleDrop as EventListener)
    el.addEventListener('paste', handlePaste as unknown as EventListener)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('delete-between-property', handleDeleteBetweenProperty, true)

  const el = document.querySelector(`[data-block-id="${blockId.value}"]`)
  if (el) {
    el.removeEventListener('dragover', handleDragOver as EventListener)
    el.removeEventListener('drop', handleDrop as EventListener)
    el.removeEventListener('paste', handlePaste as unknown as EventListener)
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
          editorRef.value.focusAtCoords(clickCoords.x, clickCoords.y)
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

/** mousedown：捕获点击坐标，在 tiptap 挂载前通知 editor store */
function handleContentMousedown(e: MouseEvent) {
  const target = e.target as HTMLElement
  // .block-link 与 .rel-type-label 与 .date-ref 都由 handleContentClick 处理点击，
  // 不要让 mousedown 触发激活导致 BulletRender 被替换、
  // 进而让后续 click 事件落在新挂载的 Editor 上。
  if (target.closest('.block-link')) return
  if (target.closest('.rel-type-label')) return
  if (target.closest('.date-ref')) return

  if (handler.value?.type === 'embed' && getBlockProperty('sourceBlockId')) {
    e.preventDefault()
    return
  }

  if (e.ctrlKey || e.metaKey) {
    if (selection) {
      selection.toggleBlock(blockId.value, pageStore.currentPageId)
      e.preventDefault()
    }
    return
  }

  // 已激活的 block 交给 ProseMirror 原生处理光标定位
  if (editorStore.activeBlockId === blockId.value) return

  // 保存鼠标坐标，Editor 挂载后用 posAtCoords 精确定位
  editorStore.setClickCoords(e.clientX, e.clientY)

  if (selection) {
    selection.startTracking(blockId.value)
  }
}

async function handleSave(content: string) {
  return await blockStore.updateBlockContent(blockId.value, content)
}

async function handleLanguageChange(lang: string) {
  await blockStore.updateBlockProperties(blockId.value, { language: lang })
}

/** 同步block未保存内容到store */
async function syncBlockContent() {
  if (editorRef.value) {
    editorRef.value.markSaved()
    const editorComponent = editorRef.value as any
    if (editorComponent.cancelDebouncedSave) {
      editorComponent.cancelDebouncedSave()
    }
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
  await relationshipCleanup.cleanupAfterDelete(props.pageId, [blockId.value])
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
  if (handler.value?.type === 'embed') {
    const sourceBlockId = getBlockProperty('sourceBlockId')
    if (sourceBlockId) {
      const sourcePage = pageStore.pages.find(p => p.id === getBlockProperty('sourcePageId'))
      if (sourcePage) {
        navigateToPage(sourcePage.title)
      }
    } else {
      showBlockSelector.value = true
    }
    return
  }

  const target = e.target as HTMLElement

  const relLabel = target.closest('.rel-type-label') as HTMLElement | null
  if (relLabel) {
    const relType = relLabel.dataset.relType
    const targetBlockId = relLabel.dataset.blockId
    const labelFrom = Number(relLabel.dataset.labelFrom)
    const labelTo = Number(relLabel.dataset.labelTo)
    if (!relType || !targetBlockId || Number.isNaN(labelFrom) || Number.isNaN(labelTo)) return

    if (!blockStore.blocks.find(b => b.id === targetBlockId)) return

    const rect = relLabel.getBoundingClientRect()
    e.preventDefault()
    e.stopPropagation()

    relMenu.openSwitch({
      view: { dom: { isConnected: true } },
      position: { x: rect.left, y: rect.bottom + 4 },
      range: { from: labelFrom, to: labelTo },
      currentType: relType,
      onSelect: (newType) => {
        const latest = blockStore.blocks.find(b => b.id === targetBlockId)
        if (!latest) return
        const newContent = latest.content.slice(0, labelFrom) + newType + latest.content.slice(labelTo)
        blockStore.updateBlockContent(targetBlockId, newContent)
      }
    })
    return
  }

  // ── dateRef 阅读态点击（非 PM 编辑器环境，span 由 useContentRenderer 渲染）──
  const dateRefSpan = target.closest('.date-ref') as HTMLElement | null
  if (dateRefSpan) {
    e.preventDefault()
    const raw = dateRefSpan.dataset.raw
    const kind = dateRefSpan.dataset.kind as string | undefined
    const iso = dateRefSpan.dataset.iso
    const recurrence = dateRefSpan.dataset.recurrence
    const leadMinutes = parseInt(dateRefSpan.dataset.leadMinutes || '0', 10) || 0
    if (!raw || !kind || !iso || !recurrence) return

    // 在 block.content 中查找该 span 对应的 {{...}} 位置
    // 先数一下该 span 在同级 .block-text 内是第几个 .date-ref（支持重复内容）
    const blockText = dateRefSpan.closest('.block-text')
    let occurrence = 0
    if (blockText) {
      const allDateRefs = blockText.querySelectorAll('.date-ref')
      for (let i = 0; i < allDateRefs.length; i++) {
        if (allDateRefs[i] === dateRefSpan) {
          occurrence = i
          break
        }
      }
    }

    const content = blockStore.blocks.find(b => b.id === blockId.value)?.content ?? ''
    let idx = -1
    let matchCount = 0
    const searchPattern = new RegExp(DATE_REF_REGEX.source, 'g')
    let m: RegExpExecArray | null
    while ((m = searchPattern.exec(content)) !== null) {
      const matchedRaw = serializeDateRef({
        kind: m[1] as any,
        iso: m[2],
        recurrence: normalizeRecurrence(m[3]),
        leadMinutes: m[4] ? parseInt(m[4], 10) || 0 : 0,
      })
      if (matchedRaw === raw && matchCount === occurrence) {
        idx = m.index
        break
      }
      matchCount++
    }
    if (idx === -1) return

    // 垂直用 block 底部，水平用 date-ref 文字左侧对齐
    openDateRefPanel(
      {
        blockId: blockId.value,
        from: idx,
        to: idx + raw.length,
        kind: kind as any,
        iso,
        recurrence: recurrence as any,
        leadMinutes,
        position: computeDatePickerPosition(dateRefSpan),
      },
      'content'
    )
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

async function handleClear() {
  if (editorRef.value) editorRef.value.markSaved()
  await blockStore.updateBlockContent(blockId.value, '')
}

function handleDragOver(e: DragEvent) {
  if (handler.value?.type !== 'image') return
  if (!e.dataTransfer?.types.includes('Files')) return
  const file = e.dataTransfer.items[0]
  if (!file || !file.type.startsWith('image/')) return
  e.preventDefault()
  e.stopPropagation()
}

function handleDrop(e: DragEvent) {
  if (handler.value?.type !== 'image') return
  const file = e.dataTransfer?.files?.[0]
  if (!file || !file.type.startsWith('image/')) return
  e.preventDefault()
  e.stopPropagation()

  void (async () => {
    const { assetStorage } = await import('../../utils/asset')
    const asset = await assetStorage.save(file)
    const content = `![${asset.name}](asset://${asset.id})`
    await blockStore.updateBlockContent(blockId.value, content)
  })()
}

async function handlePaste(e: ClipboardEvent) {
  if (handler.value?.type !== 'image') return
  const items = e.clipboardData?.items
  if (!items) return
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      e.preventDefault()
      e.stopPropagation()
      const file = items[i].getAsFile()
      if (!file) continue
      const { assetStorage } = await import('../../utils/asset')
      const asset = await assetStorage.save(file)
      const content = `![${asset.name}](asset://${asset.id})`
      await blockStore.updateBlockContent(blockId.value, content)
      return
    }
  }
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
        <div class="block-content" @mousedown="handleContentMousedown">
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
            @exit-edit="handleExitEdit"
            @cursor-change="handleCursorChange"
            @language-change="handleLanguageChange"
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
            @content-click="handleContentClick"
            @language-change="handleLanguageChange"
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

    <BlockSelector
      :visible="showBlockSelector"
      :exclude-block-id="blockId"
      @select="handleEmbedSelect"
      @close="showBlockSelector = false"
    />

    <!-- 拖放指示器（由 useBlockDragDrop 的响应式状态驱动，替代原 document.querySelector DOM 操作） -->
    <BlockDropIndicator
      :style="indicatorStyle"
      :css-class="indicatorClass"
      :visible="indicatorVisible"
    />
  </div>
</template>

<style scoped lang="scss">
</style>
