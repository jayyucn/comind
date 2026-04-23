<script setup lang="ts">
import { computed, ref, onMounted, watch, nextTick } from 'vue'
import Sidebar from './components/Sidebar.vue'
import Block from './components/Block.vue'
import Backlinks from './components/Backlinks.vue'
import MergeDialog from './components/MergeDialog.vue'
import TagFilterPanel from './components/TagFilterPanel.vue'
import SlashCommandMenu from './components/SlashCommandMenu.vue'
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

// ── 根容器的 Sortable ──────────────────────────────────────────
const blockListRef = ref<HTMLElement | null>(null)

// ── 标题编辑状态 ────────────────────────────────────────────────
const isEditingTitle = ref(false)
const editingTitle = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)

// ── 合并对话框状态 ───────────────────────────────────────────────
const showMergeDialog = ref(false)
const mergeTarget = ref<PageRecord | null>(null)

onMounted(() => {
  if (blockListRef.value) {
    useSortable(blockListRef.value)
  }
})

// ── 页面加载完成后自动聚焦第一个空 Block ────────────────────────
watch(() => blockStore.loading, async (isLoading, wasLoading) => {
  if (isLoading || !wasLoading) return
  if (editorStore.activeBlockId) return

  await nextTick()
  await autoFocusFirstEmptyBlock()
})

async function autoFocusFirstEmptyBlock() {
  const pageId = blockStore.currentPageId
  if (!pageId) return

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

// ── 标题编辑 ────────────────────────────────────────────────────
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
    editingTitle.value = newTitle
    showMergeDialog.value = true
    mergeTarget.value = result.duplicated
  }
}

function cancelEditTitle() {
  isEditingTitle.value = false
  editingTitle.value = ''
}

// ── 合并操作 ─────────────────────────────────────────────────────
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

    <!-- 页面滚动区：Backlinks 在内，随内容滚动 -->
    <div class="page-scroll-wrapper">
      <!-- 页面主体：占满滚动区，Backlinks 用 margin-top:auto 推底 -->
      <div class="page-body">
        <main class="main-content">
          <!-- 页面标题 -->
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

          <!-- Block 列表 -->
          <div class="block-list" ref="blockListRef" data-parent-id="">
            <Block
              v-for="block in topLevelBlocks"
              :key="block.id"
              :block-id="block.id"
              :block="block"
            />
          </div>
        </main>

        <!-- Backlinks：margin-top:auto，内容少时贴底，内容多时随页面滚动 -->
        <Backlinks />
      </div>
    </div>

    <MergeDialog
      :visible="showMergeDialog"
      :source-title="editingTitle"
      :target-title="mergeTarget?.title ?? ''"
      @merge="handleMerge"
      @cancel="handleCancelMerge"
    />

    <TagFilterPanel />
    <SlashCommandMenu />
  </div>
</template>

<style scoped>
/* ── 主布局：Sidebar + 滚动区 ─────────────────────────────────── */
.app-layout {
  display: flex;
  flex-direction: row;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--bg-base);
}

/* ── 页面滚动区 ─────────────────────────────────────────────── */
.page-scroll-wrapper {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.page-scroll-wrapper::-webkit-scrollbar {
  width: 6px;
}

.page-scroll-wrapper::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 3px;
}

.page-scroll-wrapper::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}

/* ── 页面主体：flex 垂直排列，gap 确保 Backlinks 与内容间距 ── */
.page-body {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  gap: 48px;
  padding-bottom: var(--space-6);
}

/* ── 主内容区：居中，max-width 约束 ──────────────────────────── */
.main-content {
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
  padding: var(--space-8) 48px var(--space-8);
  box-sizing: border-box;
  /* flex:1 让主内容优先占满页面高度 */
  flex: 1;
}

/* ── 页面标题区 ─────────────────────────────────────────────── */
.page-header {
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border);
}

.page-title {
  font-family: var(--font-sans);
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.5px;
  line-height: 1.4;
}

.page-title--display {
  cursor: text;
  padding: 2px var(--space-1);
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  transition: border-color 150ms ease, background 150ms ease;
}

.page-title--display:hover {
  border-color: var(--border);
  background: var(--accent-03);
}

.page-title--input {
  background: transparent;
  border: 1px solid var(--accent);
  outline: none;
  padding: 2px var(--space-1);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-focus);
  width: 100%;
  max-width: 600px;
}

/* ── Block 列表 ─────────────────────────────────────────────── */
.block-list {
  padding-left: 0;
}
</style>
