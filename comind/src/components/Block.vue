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

function handleBulletClick() {
  collapsed.value = !collapsed.value
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
    editorStore.activateBlock(newBlock.id)
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

/** 渲染内容（[[链接]] 高亮、#标签 样式） */
function renderContent(text: string): string {
  // 内部链接 [[xxx]] 和 [[xxx|yyy]]
  let html = text
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, alias) => {
      const display = alias || target
      return `<span class="block-link">${display}</span>`
    })
    // 外部链接 [[http://...]]
    .replace(/\[\[(https?:\/\/[^\]]+)\]\]/g, (_, url) => {
      return `<span class="block-link external">${url}</span>`
    })
    // 标签 #tag
    .replace(/#([\p{L}_][\p{L}\p{N}_]*)/gu, (_, tag) => {
      return `<span class="block-tag">#${tag}</span>`
    })
  return html
}
</script>

<template>
  <div class="block" :class="{ active: isActive }">
    <div class="block-row">
      <!-- 缩进占位 -->
      <div class="block-indent" :style="{ width: indentWidth }"></div>

      <!-- Bullet -->
      <span class="block-bullet" @click="handleBulletClick">
        <span v-if="children.length > 0" class="bullet-icon">{{ collapsed ? '▶' : '▼' }}</span>
        <span v-else class="bullet-dot">•</span>
      </span>

      <!-- 内容区 -->
      <div class="block-content" @mousedown="handleContentMouseDown">
        <Editor v-if="isActive" ref="editorRef" :block-id="blockId" :content="block.content" @save="handleSave"
          @split="handleSplit" @merge="handleMerge" @delete="handleDelete" @indent="handleIndent"
          @outdent="handleOutdent" @cursor-change="handleCursorChange" />
        <div v-else class="block-text" v-html="renderContent(block.content)"></div>
      </div>
    </div>

    <!-- 子节点 -->
    <div v-if="children.length > 0 && !collapsed" class="block-children">
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

.block-bullet {
  flex-shrink: 0;
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #b45309;
  font-size: 10px;
  margin-top: 0.1em;
}

.bullet-dot {
  font-size: 14px;
  color: #b45309;
  opacity: 0.7;
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

.block-children {
  margin-left: 0;
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
