<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePageStore } from '../../stores/pages'
import ConfirmDialog from '../ConfirmDialog.vue'
import { Icon } from '../Icons'

const router = useRouter()
const pageStore = usePageStore()

const showRestoreConfirm = ref(false)
const showPermanentDeleteConfirm = ref(false)
const selectedPageId = ref('')

onMounted(async () => {
  await pageStore.loadTrashPages()
})

function handleRestore(pageId: string) {
  selectedPageId.value = pageId
  showRestoreConfirm.value = true
}

async function confirmRestore() {
  showRestoreConfirm.value = false
  await pageStore.restorePage(selectedPageId.value)
}

function handlePermanentDelete(pageId: string) {
  selectedPageId.value = pageId
  showPermanentDeleteConfirm.value = true
}

async function confirmPermanentDelete() {
  showPermanentDeleteConfirm.value = false
  await pageStore.permanentDeletePage(selectedPageId.value)
}

function handleNavigateToPage(pageId: string) {
  const page = pageStore.trashPages.find(p => p.id === pageId)
  if (page?.type === 'journal') {
    router.push(`/journal/${page.title}`)
  } else {
    router.push(`/page/${pageId}`)
  }
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<template>
  <div class="trash-list-view">
    <div class="trash-header">
      <h1 class="trash-title">回收站</h1>
      <span class="trash-count">{{ pageStore.trashPages.length }} 个页面</span>
    </div>

    <div class="trash-list">
      <div
        v-for="page in pageStore.trashPages"
        :key="page.id"
        class="trash-item"
      >
        <div class="trash-item-info" @click="handleNavigateToPage(page.id)">
          <span class="trash-item-title">{{ page.title }}</span>
          <span class="trash-item-date">删除于 {{ formatDate(page.deletedAt!) }}</span>
        </div>
        <div class="trash-item-actions">
          <button class="action-btn restore" title="恢复" @click="handleRestore(page.id)">
            <Icon name="icon-restore" :size="16" />
            <span>恢复</span>
          </button>
          <button class="action-btn delete" title="永久删除" @click="handlePermanentDelete(page.id)">
            <Icon name="icon-trash-permanent" :size="16" />
            <span>删除</span>
          </button>
        </div>
      </div>

      <div v-if="pageStore.trashPages.length === 0" class="empty-state">
        <Icon name="icon-trash" :size="48" />
        <div class="empty-text">回收站为空</div>
      </div>
    </div>

    <ConfirmDialog
      :visible="showRestoreConfirm"
      title="恢复页面"
      :message="`确定要恢复页面「${pageStore.trashPages.find(p => p.id === selectedPageId)?.title || ''}」吗？`"
      confirm-text="恢复"
      cancel-text="取消"
      @confirm="confirmRestore"
      @cancel="showRestoreConfirm = false"
    />

    <ConfirmDialog
      :visible="showPermanentDeleteConfirm"
      title="永久删除页面"
      :message="`确定要永久删除页面「${pageStore.trashPages.find(p => p.id === selectedPageId)?.title || ''}」吗？此操作不可撤销。`"
      confirm-text="永久删除"
      cancel-text="取消"
      danger
      @confirm="confirmPermanentDelete"
      @cancel="showPermanentDeleteConfirm = false"
    />
  </div>
</template>

<style scoped>
.trash-list-view {
  max-width: var(--max-width);
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}

.trash-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border);
}

.trash-title {
  font-family: var(--font-sans);
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.trash-count {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.trash-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.trash-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: background 80ms ease;
}

.trash-item:hover {
  background: var(--bg-hover);
}

.trash-item-info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.trash-item-title {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.trash-item-date {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.trash-item-actions {
  display: flex;
  gap: var(--space-2);
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  font-family: inherit;
  transition: all 80ms ease;
}

.action-btn:hover {
  background: var(--bg-hover);
}

.action-btn.restore:hover {
  border-color: var(--success);
  color: var(--success);
}

.action-btn.delete:hover {
  border-color: var(--error);
  color: var(--error);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-8) 0;
  color: var(--text-tertiary);
  gap: var(--space-4);
}

.empty-state svg {
  opacity: 0.5;
}

.empty-text {
  font-size: var(--text-sm);
}
</style>
