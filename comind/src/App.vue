<script setup lang="ts">
import { computed, ref, onMounted, watch, nextTick } from 'vue'
import Sidebar from './components/Sidebar.vue'
import Block from './components/Block.vue'
import Backlinks from './components/Backlinks.vue'
import MergeDialog from './components/MergeDialog.vue'
import { usePageStore } from './stores/pages'
import { useBlockStore } from './stores/blocks'
import { useEditorStore } from './stores/editor'
import { useSortable } from './composables/useSortable'
import type { PageRecord } from './types/link'

const pageStore = usePageStore()
const blockStore = useBlockStore()
const editorStore = useEditorStore()

/** 顶级 Block（parentId = null，且属于当前 Page） */
const topLevelBlocks = computed(() => {
  return blockStore.blocks
    .filter(b => b.parentId === null && b.pageId === blockStore.currentPageId)
    .sort((a, b) => a.left - b.left)
})

/** 获取当前 Page 的标题 */
const currentPageTitle = computed(() => {
  const page = pageStore.getPage(blockStore.currentPageId)
  return page?.title ?? 'comind'
})

// ── 根容器的 Sortable（.block-list = 顶级 Block 容器） ──────────────────
const blockListRef = ref<HTMLElement | null>(null)

// ── 标题编辑状态 ──
const isEditingTitle = ref(false)
const editingTitle = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)

// ── 合并对话框状态 ──
const showMergeDialog = ref(false)
const mergeTarget = ref<PageRecord | null>(null)
onMounted(() => {
  if (blockListRef.value) {
    useSortable(blockListRef.value)
  }
})

// ── 页面加载完成后自动聚焦第一个空 Block ──
watch(() => blockStore.loading, async (isLoading, wasLoading) => {
  // 仅在 loading 从 true → false 时触发（页面加载完成）
  if (isLoading || !wasLoading) return
  // 如果已有激活 Block（用户可能在加载期间点击了），不覆盖
  if (editorStore.activeBlockId) return

  await nextTick()
  await autoFocusFirstEmptyBlock()
})

async function autoFocusFirstEmptyBlock() {
  const pageId = blockStore.currentPageId
  if (!pageId) return

  // 仅当页面有且只有一个空 Block 时自动聚焦
  const contentBlocks = blockStore.blocks
    .filter(b => b.pageId === pageId && !b.isPage)

  if (contentBlocks.length === 1 && contentBlocks[0].content === '') {
    editorStore.activateBlock(contentBlocks[0].id, 1)
  }
}

function handleMainClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.block')) return
  editorStore.deactivateBlock()
}

// ── 标题编辑 ──
function startEditTitle() {
  editorStore.deactivateBlock()
  editingTitle.value = currentPageTitle.value
  isEditingTitle.value = true
  nextTick(() => {
    titleInputRef.value?.focus()
    titleInputRef.value?.select()
  })
}

async function saveTitle() {
  isEditingTitle.value = false
  const newTitle = editingTitle.value.trim()
  if (!newTitle || newTitle === currentPageTitle.value) return

  const result = await pageStore.renamePage(blockStore.currentPageId, newTitle)
  if (result.duplicated) {
    // 保留新标题用于对话框显示，弹出合并确认
    editingTitle.value = newTitle
    showMergeDialog.value = true
    mergeTarget.value = result.duplicated
  }
}

function cancelEditTitle() {
  isEditingTitle.value = false
  editingTitle.value = ''
}

// ── 合并操作 ──
async function handleMerge() {
  if (!mergeTarget.value) return
  const sourceId = blockStore.currentPageId
  const targetId = mergeTarget.value.id
  showMergeDialog.value = false
  mergeTarget.value = null
  await pageStore.mergePage(sourceId, targetId)
  await pageStore.openPage(targetId)
}

function handleCancelMerge() {
  showMergeDialog.value = false
  mergeTarget.value = null
  editingTitle.value = ''
}
</script>

<template>
  <div class="app-layout" @click="handleMainClick">
    <Sidebar />

    <main class="main-content">
      <div class="page-header">
        <h1
          v-if="!isEditingTitle"
          class="page-title page-title--display"
          @click="startEditTitle"
        >{{ currentPageTitle }}</h1>
        <input
          v-else
          ref="titleInputRef"
          v-model="editingTitle"
          class="page-title page-title--input"
          @blur="saveTitle"
          @keydown.enter.prevent="saveTitle"
          @keydown.escape="cancelEditTitle"
        />
      </div>

      <div class="block-list" ref="blockListRef" data-parent-id="">
        <Block
          v-for="block in topLevelBlocks"
          :key="block.id"
          :block-id="block.id"
          :block="block"
        />
      </div>

      <Backlinks />
    </main>

    <MergeDialog
      :visible="showMergeDialog"
      :source-title="editingTitle"
      :target-title="mergeTarget?.title ?? ''"
      @merge="handleMerge"
      @cancel="handleCancelMerge"
    />
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: #fffbf5;
}

.main-content {
  flex: 1;
  overflow-y: auto ;
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding: 32px 48px;
  max-width: 860px;
}

.page-header {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e8e0d4;
}

.page-title {
  font-family: 'Noto Sans SC', 'Geist', sans-serif;
  font-size: 24px;
  font-weight: 600;
  color: #1c1917;
  margin: 0;
  letter-spacing: -0.5px;
}

.page-title--display {
  cursor: text;
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid transparent;
  transition: border-color 150ms ease, background 150ms ease;
}

.page-title--display:hover {
  border-color: #e8e0d4;
  background: rgba(180, 83, 9, 0.03);
}

.page-title--input {
  background: transparent;
  border: 1px solid #b45309;
  outline: none;
  padding: 2px 4px;
  border-radius: 4px;
  box-shadow: 0 0 0 3px rgba(180, 83, 9, 0.1);
  width: 100%;
  max-width: 600px;
}

.block-list {
  padding-left: 0;
}

.add-block-btn {
  padding: 6px 16px;
  background: #b45309;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
}

.add-block-btn:hover {
  background: #92400e;
}
</style>
