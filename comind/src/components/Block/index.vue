<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { useBlockStore } from '../../stores/blocks'
import { useSortable } from '../../composables/useSortable'
import { useNavigateToPage } from '../../composables/useNavigateToPage'
import { useTagFilter } from '../../composables/useTagFilter'
import { TAG_REGEX } from '../../utils/parser'
import Editor from '../Editor.vue'
import { usePageStore } from '../../stores/pages'

defineOptions({
  name: 'Block'
})

const props = defineProps<{
  blockId: string
  block: import('../../types/block').BlockWithPos
}>()

const editorStore = useEditorStore()
const blockStore = useBlockStore()
const pageStore = usePageStore()
const { navigateToPage } = useNavigateToPage()
const { openFilter } = useTagFilter()

const isActive = computed(() => editorStore.activeBlockId === props.blockId)
const children = computed(() => blockStore.getChildren(props.blockId))

/** 页面是否仅有一个空 Block（唯一场景显示 placeholder） */
const isSingleEmptyBlock = computed(() => {
  const contentBlocks = blockStore.blocks.filter(
    b => b.pageId === pageStore.currentPageId
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
        // 设置当前编辑器实例
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
      // 失活时清除编辑器实例
      editorStore.setActiveEditor(null)
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

/** 是否折叠 - 本地状态，不持久化 */
const collapsed = ref(false)

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
function startEditingAtClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  // 链接和标签点击由 handleContentClick 单独处理，不触发编辑态
  if (target.closest('.block-link, .block-tag')) return

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
  const newBlock = await blockStore.insertBlockAtCursor(props.blockId, cursorPosArg, collapsed.value)
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
  // 找到前一个兄弟节点
  const prevBlock = blockStore.findPreviousBlockInTreeOrder(props.blockId)
  const prevId = prevBlock?.id

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

  // 标签点击 → 打开筛选面板
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

/** 切换折叠状态 */
async function toggleCollapse() {
  if (children.value.length === 0 || isAnimating.value) return

  const newCollapsed = !collapsed.value
  collapsed.value = newCollapsed
}

/** HTML 转义（防 XSS） */
function escapeHtmlEntities(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 渲染内容（[[链接]] 高亮、#标签 样式） */
function renderContentToHtml(text: string): string {
  const html = escapeHtmlEntities(text)
  return html
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, alias) => {
      const display = alias || target
      return `<span class="block-link" data-page="${escapeHtmlEntities(target)}">${display}</span>`
    })
    .replace(/\[\[(https?:\/\/[^\]]+)\]\]/g, (_, url) => {
      return `<span class="block-link external" data-external href="${escapeHtmlEntities(url)}">${url}</span>`
    })
    // 标签：使用 parser.ts 导出的 TAG_REGEX（单一来源，DRY）
    // 负向后顾断言逻辑已内聚到 TAG_REGEX 常量中
    .replace(TAG_REGEX, (_, tag) => {
      // 排除含 . 的（如域名中的 .）
      if (tag.includes('.')) return `#${tag}`
      // 层级标签：斜杠分隔，每级独立着色
      const parts = tag.split('/')
      const rendered = parts.map((p: string, i: number) => {
        const span = `<span class="tag-segment">${escapeHtmlEntities(p)}</span>`
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
        @click.stop="toggleCollapse">
        <span v-if="children.length > 0" class="bullet-chevron" :class="{ 'is-collapsed': collapsed }"></span>
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
@import './styles.css';
</style>