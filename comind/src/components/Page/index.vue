<script setup lang="ts">
import { computed, ref, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import BlockList from '../BlockList.vue'
import Backlinks from '../Backlinks.vue'
import MergeDialog from '../MergeDialog.vue'
import SlashCommandMenu from '../SlashCommandMenu.vue'
import PropertyQuickEditor from '../Block/PropertyQuickEditor.vue'
import PropertyEditor from '../Block/PropertyEditor.vue'
import RelationshipMenu from '../RelationshipMenu.vue'
import PageConceptBlock from './PageConceptBlock.vue'
import { usePageStore } from '../../stores/pages'
import { useEditorStore } from '../../stores/editor'
import { useRelationshipMenu } from '../../composables/useRelationshipMenu'
import type { Page } from '../../types/page'

const props = defineProps<{
  pageId: string
}>()

const router = useRouter()
const pageStore = usePageStore()
const editorStore = useEditorStore()
const relMenu = useRelationshipMenu()

/** 解析实际的 pageId：props 可能是 UUID 或 date title（journal-page 路由） */
const resolvedPageId = computed(() => {
  const direct = pageStore.getPage(props.pageId)
  if (direct) return direct.id
  const byTitle = pageStore.getPageByTitle(props.pageId)
  if (byTitle) return byTitle.id
  return props.pageId
})

const currentPageTitle = computed(() => {
  const page = pageStore.getPage(resolvedPageId.value)
  return page?.title ?? 'comind'
})

const isTitleEditable = computed(() => {
  const page = pageStore.getPage(resolvedPageId.value)
  return page?.type !== 'journal'
})

const isEditingTitle = ref(false)
const editingTitle = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)

const showMergeDialog = ref(false)
const mergeTarget = ref<Page | null>(null)

const showRenameDialog = ref(false)
const pendingNewTitle = ref('')

onBeforeUnmount(() => {
  editorStore.deactivateBlock()
})

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
              @keydown.escape="cancelEditTitle"
            />
          </div>
        </div>

        <PageConceptBlock :page-id="resolvedPageId" />

        <BlockList :page-id="resolvedPageId" />
      </main>

      <Backlinks />
    </div>

    <MergeDialog
      :visible="showMergeDialog"
      :source-title="editingTitle"
      :target-title="mergeTarget?.title ?? ''"
      @merge="handleMerge"
      @cancel="handleCancelMerge"
    />

    <SlashCommandMenu />
    <PropertyQuickEditor />
    <PropertyEditor />
    <RelationshipMenu :menu="relMenu" />

    <!-- 重命名确认弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="showRenameDialog"
          class="rename-overlay"
          @click.self="handleCancelRename"
        >
        <div class="rename-dialog">
          <div class="rename-dialog-title">修改页面标题</div>
          <div class="rename-dialog-body">
            将页面标题从「<strong class="rename-highlight">{{ currentPageTitle }}</strong>」
            修改为「<strong class="rename-highlight">{{ pendingNewTitle }}</strong>」？
          </div>
          <div class="rename-dialog-actions">
            <button class="btn btn-cancel" @click="handleCancelRename">取消</button>
            <button class="btn btn-confirm" @click="handleConfirmRename">确认修改</button>
          </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
// backdrop
.rename-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(6px);
}

// dialog card
.rename-dialog {
  background: var(--color-paper);
  border: 1px solid var(--color-border);
  border-radius: 14px;
  padding: 32px 40px 24px;
  min-width: 340px;
  max-width: 400px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.12),
    0 2px 8px rgba(0, 0, 0, 0.06);
}

.rename-dialog-title {
  text-align: center;
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 600;
  color: var(--color-ink);
  margin-bottom: 20px;
}

.rename-dialog-body {
  font-size: 14px;
  color: var(--color-ink-secondary);
  line-height: 1.7;
  margin-bottom: 28px;
  text-align: center;
}

.rename-highlight {
  color: var(--color-accent);
  font-weight: 600;
}

.rename-dialog-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.rename-dialog-actions .btn {
  padding: 8px 24px;
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: background 120ms ease, box-shadow 120ms ease;
}

.rename-dialog-actions .btn-cancel {
  background: transparent;
  color: var(--color-ink-secondary);
  border: 1px solid var(--color-border);
}

.rename-dialog-actions .btn-cancel:hover {
  background: rgba(0, 0, 0, 0.04);
}

.rename-dialog-actions .btn-confirm {
  background: var(--color-accent);
  color: #fff;
  border: none;
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.rename-dialog-actions .btn-confirm:hover {
  background: var(--color-accent-deep);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

// fade transition
.fade-enter-active,
.fade-leave-active {
  transition: opacity 160ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
