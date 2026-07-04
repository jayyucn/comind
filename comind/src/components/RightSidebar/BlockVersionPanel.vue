<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { RotateCcw, Clock, MessageSquare, AlertCircle } from 'lucide-vue-next'
import { useBlockVersionStore } from '../../stores/blockVersion'
import { useEditorStore } from '../../stores/editor'
import { useBlockStore } from '../../stores/blocks'
import { useContentRenderer } from '../../composables/useContentRenderer'
import type { BlockVersion } from '../../wasm/types'
import { format } from 'date-fns'

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

    // 恢复成功后，重新加载 Block 所在 Page 的数据以同步前端状态
    const block = blockStore.getBlock(activeBlockId.value)
    if (block) {
      await blockStore.loadPageBlocks(block.pageId)
    }

    await loadVersions()
  } catch (error) {
    console.error('[BlockVersionPanel] Failed to restore:', error)
    restoreError.value = '恢复失败，请重试'
  }
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return format(date, 'yyyy-MM-dd HH:mm:ss')
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
  return renderContentToHtml(data.block.content, blockId)
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
      <div class="version-header">
        <span class="version-count">共 {{ versions.length }} 个版本</span>
      </div>

      <div
        v-for="version in sortedVersions"
        :key="version.id"
        class="version-item"
        :class="{ selected: selectedVersion?.id === version.id }"
        @click="selectedVersion = version"
      >
        <div class="version-meta-row">
          <div class="version-info">
            <div class="version-header-row">
              <span class="version-number">版本 {{ version.version }}</span>
              <span class="version-source">{{ getSourceLabel(version.source) }}</span>
            </div>
            <div class="version-meta">
              <span class="version-date">{{ formatDate(version.created_at) }}</span>
              <span v-if="version.message" class="version-message">
                <MessageSquare :size="12" />
                {{ version.message }}
              </span>
            </div>
          </div>
          <button
            v-if="selectedVersion?.id === version.id"
            class="restore-button"
            @click.stop="handleRestore(version.id)"
          >
            <RotateCcw :size="14" />
            恢复
          </button>
        </div>

        <div class="version-content-preview">
          <div class="block-row">
            <span class="block-bullet">
              <span class="bullet-dot"></span>
            </span>
            <div class="block-text" v-html="renderBlockContent(version.snapshot, version.block_id)"></div>
          </div>

          <div v-if="getProperties(version.snapshot).length > 0" class="version-properties">
            <div
              v-for="prop in getProperties(version.snapshot)"
              :key="prop.key"
              class="property-item"
            >
              <span class="property-key">{{ prop.key }}</span>
              <span class="property-value">{{ prop.value }}</span>
            </div>
          </div>

          <div v-if="getRelationships(version.snapshot).length > 0" class="version-relationships">
            <div
              v-for="rel in getRelationships(version.snapshot)"
              :key="rel.target_page_id"
              class="relationship-item"
            >
              <span class="rel-arrow">→</span>
              <span class="rel-target">{{ rel.display_text }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
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
  to { transform: rotate(360deg); }
}

.version-header {
  padding: 8px 12px;
  margin-bottom: 4px;
}

.version-count {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.version-item {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  border-radius: var(--radius-md);
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

.version-meta-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 8px;
}

.version-info {
  flex: 1;
  min-width: 0;
}

.version-header-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.version-number {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.version-source {
  font-size: var(--text-xs);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background-color: var(--bg-active);
  color: var(--text-secondary);
}

.version-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.version-message {
  display: flex;
  align-items: center;
  gap: 4px;
}

.restore-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--color-white);
  background-color: var(--accent);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 0.15s ease;
  flex-shrink: 0;

  &:hover {
    background-color: var(--accent-hover);
  }
}

.version-content-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: var(--bg-sidebar);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}

.block-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 1.3em;
  line-height: 1.5;
}

.block-bullet {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 1.8em;
  flex-shrink: 0;
}

.bullet-dot {
  width: 6px;
  height: 6px;
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
  line-height: 1.5;
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
  gap: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
}

.property-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-active);
  font-size: var(--text-xs);
}

.property-key {
  color: var(--text-secondary);
}

.property-value {
  color: var(--text-primary);
  font-weight: 500;
}

.version-relationships {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
}

.relationship-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
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