<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useEditorStore } from '../stores/editor'
import { useBlockStore } from '../stores/blocks'
import Editor from './Editor.vue'

const props = defineProps<{
  blockId: string
  block: import('../types/block').BlockWithPos
}>()

const editorStore = useEditorStore()
const blockStore = useBlockStore()

const isActive = computed(() => editorStore.activeBlockId === props.blockId)
const children = computed(() => blockStore.getChildren(props.blockId))

const editorRef = ref<InstanceType<typeof Editor> | null>(null)
const transitionRef = ref<HTMLElement | null>(null)
const cursorPos = ref(0)

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
          // 无显式位置（普通点击触发）：默认光标到末尾
          // click 事件已传播完毕，tiptap 的默认行为已就绪
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

/** 是否折叠 */
const collapsed = ref(false)

/** 折叠动画目标 max-height（展开时 auto-collapsed 时设为 0） */
const maxHeight = ref<string>('auto')

/** 动画进行中，防止重复触发 */
const isAnimating = ref(false)

function handleCollapseToggle() {
  // 规范 §2.2：只有有子节点时才响应
  if (children.value.length === 0) return

  if (isAnimating.value) {
    // 规范 §2.2：动画进行中直接切换到目标状态
    isAnimating.value = false
  }

  if (!collapsed.value) {
    // 展开 → 折叠：先记录当前高度，再设为 0 触发动画
    const el = transitionRef.value as HTMLElement | undefined
    if (el) {
      maxHeight.value = el.scrollHeight + 'px'
      // 强制让浏览器应用当前高度
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          maxHeight.value = '0px'
          isAnimating.value = true
        })
      })
    }
    collapsed.value = true
  } else {
    // 折叠 → 展开：先设为 0，再在 nextFrame 设为 auto（实际由 scrollHeight 撑开）
    collapsed.value = false
    isAnimating.value = true
    maxHeight.value = '0px'
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = transitionRef.value as HTMLElement | undefined
        maxHeight.value = el ? el.scrollHeight + 'px' : '2000px'
      })
    })
  }
}

function onTransitionEnd() {
  isAnimating.value = false
  if (collapsed.value) {
    maxHeight.value = 'auto'
  }
}

/** mousedown：捕获点击坐标，在 tiptap 挂载前通知 editor store */
function handleContentMouseDown(e: MouseEvent) {
  const cursorPos = getCaretPositionFromPoint(e.clientX, e.clientY) ?? 0
  editorStore.setCursorPos(cursorPos + 1)
  editorStore.activateBlock(props.blockId)
}

/**
 * 通过 document.caretPositionFromPoint 获取点击处的字符偏移（ProseMirror position）。
 * 返回 null 表示无法获取（如点击 padding 等空白区域），此时回退到末尾。
 */
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

async function handleSplit(cursorPos: number) {
  // 先保存当前编辑器内容，并标记已保存（阻止 onBlur 重复写入旧内容）
  if (editorRef.value) {
    editorRef.value.markSaved()
    await handleSave(editorRef.value.getText())
  }
  editorStore.deactivateBlock()
  const newBlock = await blockStore.splitBlock(props.blockId, cursorPos)
  if (newBlock) {
    // 新 Block 是刚创建的空白 Block，光标应落在最前面
    editorStore.activateBlock(newBlock.id, 1)
  }
}

async function handleMerge() {
  // 先保存当前编辑器内容，并标记已保存（阻止 onBlur 重复写入旧内容）
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
  if (editorRef.value) editorRef.value.markSaved()
  editorStore.deactivateBlock()
  // 获取前一个 Block（合并目标）
  const siblings = blockStore.blocks
    .filter(b => b.parentId === props.block.parentId && b.pageId === props.block.pageId && b.left < props.block.left)
    .sort((a, b) => b.left - a.left)
  const prevId = siblings[0]?.id

  await blockStore.deleteBlock(props.blockId)

  // 激活前一个 Block
  if (prevId) {
    editorStore.activateBlock(prevId)
  }
}

async function handleIndent() {
  if (editorRef.value) editorRef.value.markSaved()
  editorStore.deactivateBlock()
  await blockStore.indent(props.blockId)
  editorStore.activateBlock(props.blockId)
}

async function handleOutdent() {
  if (editorRef.value) editorRef.value.markSaved()
  editorStore.deactivateBlock()
  await blockStore.outdent(props.blockId)
  editorStore.activateBlock(props.blockId)
}

function handleCursorChange(pos: number) {
  cursorPos.value = pos
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
  // 先转义 HTML 特殊字符，再用正则替换生成安全的 span 标签
  const html = escapeHtml(text)
  return html
    // 内部链接 [[xxx]] 和 [[xxx|yyy]]
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, alias) => {
      const display = alias || target
      return `<span class="block-link">${display}</span>`
    })
    // 外部链接 [[http://...]]
    .replace(/\[\[(https?:\/\/[^\]]+)\]\]/g, (_, url) => {
      return `<span class="block-link external">${url}</span>`
    })
    // 标签 #tag（排除 URL 锚点，如 https://x.com#section）
    .replace(/#([\p{L}_][\p{L}\p{N}_]*)/gu, (_, tag, offset) => {
      // 检查 # 前面是否紧跟 URL 字符（排除锚点）
      const before = html.slice(Math.max(0, offset - 20), offset)
      if (/\w\/$/.test(before)) return `#${tag}` // URL 尾部
      return `<span class="block-tag">#${tag}</span>`
    })
}
</script>

<template>
  <div class="block" :class="{ active: isActive }">
    <div class="block-row">
      <!-- 缩进占位 -->
      <div class="block-indent" :style="{ width: indentWidth }"></div>

<!-- Bullet（stop 防止误触编辑态） -->
      <span class="block-bullet" :class="{ collapsed }" @click.stop="handleCollapseToggle">
        <span v-if="children.length > 0" class="bullet-chevron" :class="{ 'is-collapsed': collapsed }"></span>
        <span v-else class="bullet-dot"></span>
      </span>

      <!-- 内容区 -->
      <div class="block-content" @mousedown="handleContentMouseDown">
        <Editor v-if="isActive" ref="editorRef" :block-id="blockId" :content="block.content" @save="handleSave"
          @split="handleSplit" @merge="handleMerge" @delete="handleDelete" @indent="handleIndent"
          @outdent="handleOutdent" @cursor-change="handleCursorChange" />
        <div v-else class="block-text" v-html="renderContent(block.content)"></div>
      </div>
    </div>

    <!-- 子节点（折叠动画） -->
    <Transition name="collapse" @after-leave="onTransitionEnd">
      <div
        v-if="children.length > 0 && !collapsed"
        ref="transitionRef"
        class="block-children"
        :style="{ maxHeight }"
      >
        <Block v-for="child in children" :key="child.id" :block-id="child.id" :block="child" />
      </div>
    </Transition>
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


/* Bullet 区域 — 高度与行高一致，圆点/箭头垂直居中 */
.block-bullet {
  flex-shrink: 0;
  width: 20px;
  height: 1.8em;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 120ms ease;
}

/* 默认：可点击指针 + 透明 */
.block-bullet {
  cursor: pointer;
}

/* Hover：显示 grab 光标（类似 Logseq，表示可拖拽） */
.block-bullet.bullet-drag-ready {
  cursor: pointer;
}

/* 拖拽进行中（被拽的 Block 的 bullet） */
.block-bullet.bullet-dragging {
  cursor: grabbing;
}

/* ── Bullet 圆点（叶节点） ── */
.bullet-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-accent, #b45309);
  opacity: 0.35;
  /* 初始位置：稍微偏下，与文本视觉中心对齐 */
  transform: translateY(1px);
  transition: opacity 150ms ease-out, transform 150ms ease-out, box-shadow 150ms ease-out;
  flex-shrink: 0;
}

/* ── Chevron 箭头（父节点） ── */
.bullet-chevron {
  width: 7px;
  height: 7px;
  border-right: 1.5px solid var(--color-accent, #b45309);
  border-bottom: 1.5px solid var(--color-accent, #b45309);
  transform: rotate(45deg) translateY(1px); /* ▼ 展开态 */
  opacity: 0.45;
  transition: transform 180ms ease-out, opacity 150ms ease-out, box-shadow 150ms ease-out;
  flex-shrink: 0;
}

.bullet-chevron.is-collapsed {
  transform: rotate(-45deg) translateY(1px); /* ▶ 折叠态 */
}

/* ── Hover：墨水晕开感 — transform-origin 远离光标，展开方向不影响指针 ── */
.block-bullet.bullet-drag-ready .bullet-dot {
  opacity: 0.7;
  transform: scale(1.4) translateY(1px);
  transform-origin: center bottom;  /* 向上扩，远离指针 */
  box-shadow: 0 0 0 3px rgba(180, 83, 9, 0.08);
}

.block-bullet.bullet-drag-ready .bullet-chevron {
  opacity: 0.75;
  transform: rotate(45deg) scale(1.2) translateY(1px);
  transform-origin: center top;      /* 向下扩，远离指针 */
  box-shadow: 0 0 0 3px rgba(180, 83, 9, 0.06);
}

.block-bullet.bullet-drag-ready.bullet-dragging .bullet-chevron,
.block-bullet.bullet-dragging .bullet-chevron {
  transform: rotate(-45deg) scale(1.2) translateY(1px);
  transform-origin: center top;
}

/* ── Active Block：bullet 更醒目 ── */
.block.active .bullet-dot {
  opacity: 0.55;
  transform: translateY(1px);
}

.block.active .bullet-chevron {
  opacity: 0.6;
  transform: rotate(45deg) translateY(1px);
}

.block.active .bullet-chevron.is-collapsed {
  transform: rotate(-45deg) translateY(1px);
}

/* ── Dragging：焦点感 ── */
.block-bullet.bullet-dragging .bullet-dot {
  opacity: 0.9;
  transform: scale(1.6) translateY(1px);
  transform-origin: center bottom;
  box-shadow: 0 0 0 4px rgba(180, 83, 9, 0.12);
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

.block-text .placeholder {
  color: #adb5bd;
}

.block.active .block-text {
  background: rgba(180, 83, 9, 0.06);
}

/* 折叠动画（max-height 过渡） */
.collapse-enter-active,
.collapse-leave-active {
  transition: max-height 180ms ease, opacity 180ms ease, overflow hidden;
}

.collapse-enter-from,
.collapse-leave-to {
  max-height: 0 !important;
  opacity: 0;
}

.collapse-enter-to,
.collapse-leave-from {
  opacity: 1;
}

/* collapsed 态 bullet 视觉反馈 */
.block-bullet.collapsed .bullet-chevron,
.block-bullet.collapsed .bullet-icon {
  opacity: 0.7;
}

/* Link & Tag styles */
:deep(.block-link) {
  color: #b45309;
  cursor: pointer;
  border-bottom: 1px solid rgba(180, 83, 9, 0.4);
}

:deep(.block-link.external) {
  color: #64748b;
  border-bottom-color: rgba(100, 116, 139, 0.4);
}

:deep(.block-tag) {
  color: #6366f1;
  background: rgba(99, 102, 241, 0.1);
  padding: 0 2px;
  border-radius: 3px;
  font-size: 0.9em;
}
</style>
