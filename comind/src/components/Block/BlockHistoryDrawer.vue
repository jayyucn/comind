<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { X, RotateCcw, Clock, MessageSquare } from 'lucide-vue-next'
import { useBlockVersionStore } from '../../stores/blockVersion'
import type { BlockVersion } from '../../wasm/types'
import { format } from 'date-fns'

const props = defineProps<{
  visible: boolean
  blockId: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const versionStore = useBlockVersionStore()
const versions = ref<BlockVersion[]>([])
const selectedVersion = ref<BlockVersion | null>(null)
const isLoading = ref(false)

async function loadVersions() {
  if (!props.blockId) return
  isLoading.value = true
  try {
    versions.value = await versionStore.getVersions(props.blockId)
    if (versions.value.length > 0) {
      selectedVersion.value = versions.value[0]
    }
  } catch (error) {
    console.error('[BlockHistoryDrawer] Failed to load versions:', error)
  } finally {
    isLoading.value = false
  }
}

async function handleRestore(versionId: string) {
  try {
    await versionStore.restoreVersion(versionId)
    emit('close')
  } catch (error) {
    console.error('[BlockHistoryDrawer] Failed to restore:', error)
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

watch(() => props.visible, async (visible) => {
  if (visible) {
    await loadVersions()
  } else {
    selectedVersion.value = null
  }
})

watch(() => props.blockId, async () => {
  if (props.visible) {
    await loadVersions()
  }
})

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    emit('close')
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})

const sortedVersions = computed(() => {
  return [...versions.value].sort((a, b) => b.created_at - a.created_at)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div
        v-if="visible"
        class="block-history-drawer-backdrop"
        @click="handleBackdropClick"
      >
        <div class="block-history-drawer">
          <div class="drawer-header">
            <h2 class="drawer-title">版本历史</h2>
            <button class="drawer-close" @click="emit('close')">
              <X :size="18" />
            </button>
          </div>

          <div class="drawer-body">
            <div v-if="isLoading" class="loading">
              <div class="loading-spinner"></div>
              <span>加载中...</span>
            </div>

            <div v-else-if="versions.length === 0" class="empty-state">
              <Clock :size="48" />
              <p>暂无版本历史</p>
              <p class="empty-hint">编辑内容后将自动保存版本</p>
            </div>

            <div v-else class="version-list">
              <div
                v-for="version in sortedVersions"
                :key="version.id"
                class="version-item"
                :class="{ selected: selectedVersion?.id === version.id }"
                @click="selectedVersion = version"
              >
                <div class="version-info">
                  <div class="version-header">
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
                  恢复此版本
                </button>
              </div>
            </div>
          </div>

          <div v-if="selectedVersion" class="drawer-footer">
            <button class="footer-close" @click="emit('close')">关闭</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-active .block-history-drawer,
.drawer-leave-active .block-history-drawer {
  transition: transform 0.25s ease;
}

.drawer-enter-from .block-history-drawer,
.drawer-leave-to .block-history-drawer {
  transform: translateX(100%);
}

.block-history-drawer-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
}

.block-history-drawer {
  width: 400px;
  max-width: 100%;
  height: 100%;
  background-color: #ffffff;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.1);
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.drawer-title {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  margin: 0;
  color: #1f2937;
}

.drawer-close {
  background: none;
  border: none;
  cursor: pointer;
  color: #6b7280;
  padding: 4px;
  border-radius: 4px;
  transition: background-color 0.15s ease;

  &:hover {
    background-color: #f3f4f6;
    color: #1f2937;
  }
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 12px;
  color: #6b7280;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 12px;
  color: #9ca3af;
}

.empty-hint {
  font-size: var(--text-sm);
  margin-top: 4px;
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.version-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s ease;

  &:hover {
    background-color: #f9fafb;
  }

  &.selected {
    background-color: #eff6ff;
    border: 1px solid #bfdbfe;
  }
}

.version-info {
  flex: 1;
  min-width: 0;
}

.version-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.version-number {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: #1f2937;
}

.version-source {
  font-size: var(--text-xs);
  padding: 2px 8px;
  border-radius: 4px;
  background-color: #f3f4f6;
  color: #6b7280;
}

.version-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--text-xs);
  color: #9ca3af;
}

.version-message {
  display: flex;
  align-items: center;
  gap: 4px;
}

.restore-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: #ffffff;
  background-color: #3b82f6;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s ease;

  &:hover {
    background-color: #2563eb;
  }
}

.drawer-footer {
  display: flex;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid #e5e7eb;
  flex-shrink: 0;
  gap: 12px;
}

.footer-close {
  padding: 8px 16px;
  font-size: var(--text-sm);
  color: #6b7280;
  background-color: #f3f4f6;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    background-color: #e5e7eb;
    color: #1f2937;
  }
}
</style>