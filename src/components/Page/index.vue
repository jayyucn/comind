<script setup lang="ts">
import { computed, ref, onBeforeUnmount, onMounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import BlockList from '../BlockList.vue'
import Backlinks from '../Backlinks.vue'
import ConfirmDialog from '../ConfirmDialog.vue'
import SlashCommandMenu from '../SlashCommandMenu.vue'
import PropertyQuickEditor from '../Block/PropertyQuickEditor.vue'
import PropertyEditor from '../Block/PropertyEditor.vue'
import RelationshipMenu from '../RelationshipMenu.vue'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '../../stores/blocks'
import { useEditorStore } from '../../stores/editor'
import { useRelationshipMenu } from '../../composables/useRelationshipMenu'
import { openReaderWindow } from '../../composables/useReaderWindow'
import { isTauriEnvironment } from '../../wasm/tauri-platform'
import type { Page } from '../../types/page'

const props = defineProps<{
  pageId: string
}>()

const router = useRouter()
const pageStore = usePageStore()
const blockStore = useBlockStore()
const editorStore = useEditorStore()
const relMenu = useRelationshipMenu()

/** 页面 block 加载代数，快速切换路由时丢弃过期结果 */
let pageLoadGeneration = 0

async function loadBlocksForPage(pageId: string) {
  const myGen = ++pageLoadGeneration
  await blockStore.ensurePageBlocks(pageId)
  if (myGen !== pageLoadGeneration) return
}

/** 解析实际的 pageId：props 可能是 UUID 或 date title（ideas-page 路由） */
const resolvedPageId = computed(() => {
  const direct = pageStore.getPage(props.pageId)
  if (direct) return direct.id
  const byTitle = pageStore.getPageByTitle(props.pageId)
  if (byTitle) return byTitle.id
  return props.pageId
})

watch(resolvedPageId, (pageId) => {
  if (pageId) loadBlocksForPage(pageId)
}, { immediate: true })

const currentPageTitle = computed(() => {
  const page = pageStore.getPage(resolvedPageId.value)
  return page?.title ?? 'comind'
})

const isTitleEditable = computed(() => {
  const page = pageStore.getPage(resolvedPageId.value)
  return page?.type !== 'ideas'
})

// 书 Page（type=book，票 01 导入生成）：标题下显示「阅读」入口，
// 唤起独立阅读器窗口（ADR-0040 D4；仅桌面端，web/Android 无阅读器）
const isBookPage = computed(() => pageStore.getPage(resolvedPageId.value)?.type === 'book')
const canOpenReader = computed(() => isBookPage.value && isTauriEnvironment())

function handleOpenReader(): void {
  const bookId = resolvedPageId.value
  if (bookId) openReaderWindow(bookId)
}

const isEditingTitle = ref(false)
const editingTitle = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)

const showMergeDialog = ref(false)
const mergeTarget = ref<Page | null>(null)

const showRenameDialog = ref(false)
const pendingNewTitle = ref('')

onMounted(() => {
  // TaskHub navigate-to-block: scroll to target block after route change
  window.addEventListener('navigate-to-block' as any, handleNavigateToBlockEvent)
})

onBeforeUnmount(() => {
  pageLoadGeneration++
  editorStore.deactivateBlock()
  window.removeEventListener('navigate-to-block' as any, handleNavigateToBlockEvent)
})

function handleNavigateToBlockEvent(e: Event) {
  const { blockId } = (e as CustomEvent).detail as { blockId: string }
  if (!blockId) return
  nextTick(() => {
    const el = document.querySelector(`[data-block-id="${blockId}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Brief highlight
      el.classList.add('navigate-highlight')
      setTimeout(() => el.classList.remove('navigate-highlight'), 2000)
    }
  })
}

async function startEditTitle() {
  if (!isTitleEditable.value) return
  editorStore.deactivateBlock()
  editingTitle.value = await currentPageTitle.value
  isEditingTitle.value = true
  nextTick(() => {
    titleInputRef.value?.focus()
    // 光标放到末尾，不选中全选
    const len = titleInputRef.value?.value.length ?? 0
    titleInputRef.value?.setSelectionRange(len, len)
  })
}

async function saveTitle() {
  isEditingTitle.value = false
  const newTitle = editingTitle.value.trim()
  if (!newTitle || newTitle === await currentPageTitle.value) return

  // 先检查重名冲突
  const pageId = await resolvedPageId.value
  const existingPage = pageStore.getPageByTitle(newTitle)
  if (existingPage && existingPage.id !== pageId) {
    editingTitle.value = newTitle
    mergeTarget.value = existingPage
    showMergeDialog.value = true
    return
  }

  // 确认弹窗
  pendingNewTitle.value = newTitle
  showRenameDialog.value = true
}

async function handleConfirmRename() {
  showRenameDialog.value = false
  if (!pendingNewTitle.value) return
  await pageStore.renamePage(await resolvedPageId.value, pendingNewTitle.value)
  pendingNewTitle.value = ''
}

function handleCancelRename() {
  showRenameDialog.value = false
  pendingNewTitle.value = ''
  cancelEditTitle()
}

function cancelEditTitle() {
  isEditingTitle.value = false
  editingTitle.value = ''
}

async function handleMerge() {
  if (!mergeTarget.value) return
  const sourceId = await resolvedPageId.value
  const targetId = mergeTarget.value.id
  showMergeDialog.value = false
  mergeTarget.value = null
  await pageStore.mergePage(sourceId, targetId)
  router.push(`/page/${targetId}`)
}

function handleCancelMerge() {
  showMergeDialog.value = false
  mergeTarget.value = null
  editingTitle.value = ''
}
</script>

<template>
  <div class="page-container">
    <div class="page-body">
      <main class="main-content">
        <div class="page-header">
          <div class="page-header-content">
            <h1
              v-if="!isEditingTitle"
              class="page-title page-title--display"
              :class="{ 'page-title--editable': isTitleEditable }"
              @click="startEditTitle"
            >{{ currentPageTitle }}</h1>
            <input
              v-else
              ref="titleInputRef"
              v-model="editingTitle"
              class="page-title page-title--input"
              @blur="saveTitle"
              @keydown.enter.prevent="saveTitle"
              @keydown.escape.prevent="cancelEditTitle"
            />
            <button
              v-if="canOpenReader"
              class="read-book-btn"
              title="在独立窗口中阅读这本书"
              @click="handleOpenReader"
            >开始阅读</button>
          </div>
        </div>

        <BlockList :page-id="resolvedPageId" />
      </main>

      <Backlinks />
    </div>

    <ConfirmDialog
      :visible="showMergeDialog"
      title="合并页面"
      confirm-text="合并"
      @confirm="handleMerge"
      @cancel="handleCancelMerge"
    >
      <template #icon>⚡</template>
      页面「<strong class="dialog-highlight">{{ editingTitle }}</strong>」已存在，合并后将把所有内容移入已有页面。
    </ConfirmDialog>

    <SlashCommandMenu />
    <PropertyQuickEditor />
    <PropertyEditor />
    <RelationshipMenu :menu="relMenu" />

    <!-- 重命名确认弹窗 -->
    <ConfirmDialog
      :visible="showRenameDialog"
      title="修改页面标题"
      confirm-text="确认修改"
      @confirm="handleConfirmRename"
      @cancel="handleCancelRename"
    >
      将页面标题从「<strong class="dialog-highlight">{{ currentPageTitle }}</strong>」
      修改为「<strong class="dialog-highlight">{{ pendingNewTitle }}</strong>」？
    </ConfirmDialog>
  </div>
</template>

<style lang="scss" scoped>
:deep(.navigate-highlight) {
  animation: navigate-pulse 2s ease-out;
}

// 书 Page 标题下的「开始阅读」入口（票 03 / ADR-0040 D4：唤起独立阅读器窗口）
.read-book-btn {
  display: block;
  margin: var(--space-3) auto 0;
  padding: 4px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all 120ms ease;

  &:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-03);
  }
}

@keyframes navigate-pulse {
  0%   { background: rgba(99, 102, 241, 0.12); }
  100% { background: transparent; }
}
</style>


