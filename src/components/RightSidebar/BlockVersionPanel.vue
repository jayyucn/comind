<script setup lang="ts">
import { format } from 'date-fns'
import { AlertCircle, Clock, MessageSquare, RotateCcw, Trash2 } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { useContentRenderer } from '../../composables/useContentRenderer'
import { useBlockStore } from '../../stores/blocks'
import { useBlockVersionStore } from '../../stores/blockVersion'
import { useEditorStore } from '../../stores/editor'
import type { BlockVersion } from '../../wasm/types'
import ConfirmDialog from '../ConfirmDialog.vue'

interface SnapshotData {
  block: {
    id: string
    content: string
    type: string
    format: string
  }
  properties: Array<{ key: string; value: string; type: string }>
  relationships: Array<{ target_page_id: string; display_text: string }>
}

const versionStore = useBlockVersionStore()
const editorStore = useEditorStore()
const blockStore = useBlockStore()
const { renderContentToHtml } = useContentRenderer()

const versions = ref<BlockVersion[]>([])
const selectedVersion = ref<BlockVersion | null>(null)
const isLoading = ref(false)
const restoreError = ref<string | null>(null)
const deleteConfirmVersion = ref<BlockVersion | null>(null)
const deleteError = ref<string | null>(null)

const activeBlockId = computed(() => editorStore.activeBlockId)

async function loadVersions() {
  if (!activeBlockId.value) {
    versions.value = []
    return
  }

  isLoading.value = true
  restoreError.value = null

  try {
    versions.value = await versionStore.getVersions(activeBlockId.value)
    if (versions.value.length > 0) {
      selectedVersion.value = versions.value[0]
    }
  } catch (error) {
    console.error('[BlockVersionPanel] Failed to load versions:', error)
  } finally {
    isLoading.value = false
  }
}

async function handleRestore(versionId: string) {
  if (!activeBlockId.value) return

  restoreError.value = null

  try {
    await versionStore.restoreVersion(versionId)

    await blockStore.restoreBlock(activeBlockId.value)

    await loadVersions()
  } catch (error) {
    console.error('[BlockVersionPanel] Failed to restore:', error)
    restoreError.value = '恢复失败，请重试'
  }
}

function handleDelete(version: BlockVersion) {
  deleteConfirmVersion.value = version
  deleteError.value = null
}

async function confirmDelete() {
  if (!deleteConfirmVersion.value) return

  deleteError.value = null

  try {
    await versionStore.deleteVersion(deleteConfirmVersion.value.id)
    if (selectedVersion.value?.id === deleteConfirmVersion.value.id) {
      selectedVersion.value = null
    }
    await loadVersions()
  } catch (error) {
    console.error('[BlockVersionPanel] Failed to delete:', error)
    deleteError.value = '删除失败，请重试'
  } finally {
    deleteConfirmVersion.value = null
  }
}

function cancelDelete() {
  deleteConfirmVersion.value = null
  deleteError.value = null
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return format(date, 'yyyy-MM-dd HH:mm')
}

function getSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    auto: '自动保存',
    manual: '手动保存',
    major_op: '重要操作',
    app_exit: '应用退出',
    restore: '恢复操作'
  }
  return labels[source] || source
}

function parseSnapshot(snapshot: string): SnapshotData | null {
  try {
    return JSON.parse(snapshot) as SnapshotData
  } catch (error) {
    console.error('[BlockVersionPanel] Failed to parse snapshot:', error)
    return null
  }
}

function renderBlockContent(snapshot: string, blockId: string): string {
  const data = parseSnapshot(snapshot)
  if (!data?.block?.content) return ''
  return renderContentToHtml({ segments: [], content: data.block.content, blockId })
}

function getProperties(snapshot: string): Array<{ key: string; value: string; type: string }> {
  const data = parseSnapshot(snapshot)
  return data?.properties ?? []
}

function getRelationships(snapshot: string): Array<{ target_page_id: string; display_text: string }> {
  const data = parseSnapshot(snapshot)
  return data?.relationships ?? []
}

const sortedVersions = computed(() => {
  return [...versions.value].sort((a, b) => b.created_at - a.created_at)
})

watch(activeBlockId, async () => {
  await loadVersions()
})

onMounted(async () => {
  await loadVersions()
})
</script>

<template>
  <div class="block-version-panel">
    <div v-if="restoreError" class="error-message">
      <AlertCircle :size="14" />
      {{ restoreError }}
    </div>

    <div v-if="deleteError" class="error-message">
      <AlertCircle :size="14" />
      {{ deleteError }}
    </div>

    <div v-if="!activeBlockId" class="no-selection">
      <Clock :size="48" />
      <p>请选中一个 Block</p>
      <p class="hint">点击编辑区域中的任意 Block 来查看其版本历史</p>
    </div>

    <div v-else-if="isLoading" class="loading">
      <div class="loading-spinner"></div>
      <span>加载中...</span>
    </div>

    <div v-else-if="versions.length === 0" class="empty-state">
      <Clock :size="48" />
      <p>暂无版本历史</p>
      <p class="hint">编辑内容后将自动保存版本</p>
    </div>

    <div v-else class="version-list">
      <div class="version-list-header">
        <span class="version-count">共 {{ versions.length }} 个版本</span>
      </div>

      <div v-for="version in sortedVersions" :key="version.id" class="version-item"
        :class="{ selected: selectedVersion?.id === version.id }" @click="selectedVersion = version">
        <div class="version-header">
          <span class="version-date">{{ formatDate(version.created_at) }}</span>
          <div class="version-actions">
            <button v-if="selectedVersion?.id === version.id" class="action-btn restore-btn"
              @click.stop="handleRestore(version.id)" title="恢复此版本">
              <RotateCcw :size="14" />
            </button>
            <button class="action-btn delete-btn" @click.stop="handleDelete(version)" title="删除此版本">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <div class="version-body">
          <div class="version-title-row">
            <span class="version-number">版本 {{ version.version }}</span>
            <span class="version-source">{{ getSourceLabel(version.source) }}</span>
            <span v-if="version.message" class="version-message">
              <MessageSquare :size="12" />
              {{ version.message }}
            </span>
          </div>

          <div v-if="selectedVersion?.id === version.id" class="version-content-preview">
            <div class="block-row">
              <span class="block-bullet">
                <span class="bullet-dot"></span>
              </span>
              <div class="block-text" v-html="renderBlockContent(version.snapshot, version.block_id)"></div>
            </div>

            <div v-if="getProperties(version.snapshot).length > 0" class="version-properties">
              <div v-for="prop in getProperties(version.snapshot)" :key="prop.key" class="property-item">
                <span class="property-key">{{ prop.key }}</span>
                <span class="property-value">{{ prop.value }}</span>
              </div>
            </div>

            <div v-if="getRelationships(version.snapshot).length > 0" class="version-relationships">
              <div v-for="rel in getRelationships(version.snapshot)" :key="rel.target_page_id"
                class="relationship-item">
                <span class="rel-arrow">→</span>
                <span class="rel-target">{{ rel.display_text }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <ConfirmDialog :visible="!!deleteConfirmVersion" title="确认删除" message="确定要删除此版本吗？此操作不可撤销。" confirm-text="删除" danger
    :showDontRemindToday=true @confirm="confirmDelete" @cancel="cancelDelete" />
</template>

<style scoped lang="scss">
.block-version-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 8px;
  background: var(--bg-sidebar);
  color: var(--text-primary);
}

.error-message {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background-color: var(--accent-bg);
  color: var(--accent-hover);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  margin-bottom: 8px;
  border: 1px solid var(--accent-40);
}

.no-selection,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  gap: 12px;
  color: var(--text-tertiary);
}

.hint {
  font-size: var(--text-sm);
  margin-top: 4px;
  text-align: center;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 12px;
  color: var(--text-secondary);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.version-list-header {
  padding: 6px 10px;
  margin-bottom: 4px;
}

.version-count {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.version-item {
  display: flex;
  flex-direction: column;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 0.15s ease;
  border: 1px solid transparent;
  background: var(--bg-base);

  &:hover {
    background-color: var(--bg-hover);
  }

  &.selected {
    background-color: var(--accent-08);
    border-color: var(--accent-40);
  }
}

.version-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.version-date {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  font-weight: var(--font-medium);
}

.version-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s ease;

  .version-item:hover &,
  .version-item.selected & {
    opacity: 1;
  }
}

.action-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-tertiary);
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    background-color: var(--bg-hover);
    color: var(--text-secondary);
  }
}

.restore-btn {
  &:hover {
    color: var(--accent);
    background-color: var(--accent-08);
  }
}

.delete-btn {
  &:hover {
    color: var(--color-error);
    background-color: rgba(239, 68, 68, 0.08);
  }
}

.version-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.version-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.version-number {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.version-source {
  font-size: var(--text-xs);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background-color: var(--bg-active);
  color: var(--text-secondary);
}

.version-message {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.version-content-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  margin-top: 2px;
  background: var(--bg-sidebar);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}

.block-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  min-height: 1.3em;
  line-height: var(--leading-normal);
}

.block-bullet {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 1.6em;
  flex-shrink: 0;
}

.bullet-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-tertiary);
  opacity: 0.6;
}

.block-text {
  flex: 1;
  min-height: 1.3em;
  padding: 0 4px;
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

:deep(.block-link) {
  color: var(--accent);
  cursor: pointer;
  border-bottom: 1px solid var(--accent-40);

  &.external {
    color: var(--color-external);
    border-bottom-color: var(--ext-40);
  }
}

:deep(.block-tag) {
  color: var(--color-tag);
  background: var(--tag-10);
  padding: 0 2px;
  border-radius: var(--radius-sm);
  font-size: 0.9em;
}

:deep(.rel-type-label) {
  color: var(--rel-color, currentColor);
  font-size: var(--text-xs);
  font-style: italic;
  vertical-align: 6px;
  margin-left: 2px;
  padding: 0 4px;
  border-radius: var(--radius-sm);
}

.version-properties {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-top: 4px;
  border-top: 1px dashed var(--border);
}

.property-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--bg-active);
  font-size: var(--text-xs);
}

.property-key {
  color: var(--text-secondary);
}

.property-value {
  color: var(--text-primary);
  font-weight: var(--font-medium);
}

.version-relationships {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-top: 4px;
  border-top: 1px dashed var(--border);
}

.relationship-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--accent-08);
  font-size: var(--text-xs);
  color: var(--accent);
}

.rel-arrow {
  color: var(--text-tertiary);
}

.rel-target {
  color: var(--accent);
}
</style>