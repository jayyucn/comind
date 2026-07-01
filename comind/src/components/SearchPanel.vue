<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { initCoreClient } from '../wasm/client'
import type { SearchResult } from '../core/types'
import { pushModal, popModal } from '../composables/useModalKeyboard'

let clientPromise: ReturnType<typeof initCoreClient> | null = null

async function getClient() {
  if (!clientPromise) {
    clientPromise = initCoreClient()
  }
  return clientPromise
}

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const router = useRouter()
const searchInput = ref<HTMLInputElement | null>(null)
const query = ref('')
const selectedIndex = ref(0)
const loading = ref(false)
const results = ref<SearchResult[]>([])

watch(() => props.visible, (isVisible) => {
  if (isVisible) {
    pushModal('search-panel')
    query.value = ''
    results.value = []
    selectedIndex.value = 0
    nextTick(() => {
      searchInput.value?.focus()
    })
  } else {
    popModal('search-panel')
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  popModal('search-panel')
  document.removeEventListener('keydown', handleKeydown)
})

function handleKeydown(e: KeyboardEvent) {
  if (!props.visible) return

  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (results.value.length > 0) {
      selectedIndex.value = (selectedIndex.value + 1) % results.value.length
    }
    return
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (results.value.length > 0) {
      selectedIndex.value = (selectedIndex.value - 1 + results.value.length) % results.value.length
    }
    return
  }

  if (e.key === 'Enter') {
    e.preventDefault()
    if (results.value[selectedIndex.value]) {
      navigateToResult(results.value[selectedIndex.value])
    }
    return
  }
}

let searchTimeout: ReturnType<typeof setTimeout> | null = null

watch(query, () => {
  if (searchTimeout) clearTimeout(searchTimeout)
  if (!query.value.trim()) {
    results.value = []
    return
  }

  searchTimeout = setTimeout(async () => {
    loading.value = true
    try {
      const client = await getClient()
      const coreResults = await client.search(query.value)
      results.value = coreResults.map(r => ({
        id: r.block_id,
        blockId: r.block_id,
        pageId: r.page_id,
        title: r.title,
        content: r.content,
        type: 'block' as const,
        score: r.score,
        matchedText: '',
        highlights: []
      }))
      selectedIndex.value = 0
    } catch (err) {
      console.error('[SearchPanel] Search failed:', err)
      results.value = []
    } finally {
      loading.value = false
    }
  }, 150)
})

const groupedResults = computed(() => {
  const pages = results.value.filter(r => r.type === 'page')
  const blocks = results.value.filter(r => r.type === 'block')
  return { pages, blocks }
})

function navigateToResult(result: SearchResult) {
  if (result.type === 'page' && result.pageId) {
    router.push(`/page/${result.pageId}`)
  } else if (result.type === 'block' && result.pageId) {
    router.push(`/page/${result.pageId}#${result.blockId}`)
  }
  emit('close')
}

function getResultTitle(result: SearchResult): string {
  if (result.type === 'page') {
    return result.title || result.content
  }
  return result.content.slice(0, 60)
}

function getResultTypeLabel(result: SearchResult): string {
  return result.type === 'page' ? '页面' : '内容'
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="search-overlay" @click.self="$emit('close')">
      <div class="search-panel">
        <div class="search-header">
          <input
            ref="searchInput"
            v-model="query"
            type="text"
            class="search-input"
            placeholder="搜索页面和内容..."
            @keydown.stop
          />
          <span class="search-hint">
            <kbd>↑</kbd><kbd>↓</kbd> 选择
            <kbd>Enter</kbd> 打开
            <kbd>Esc</kbd> 关闭
          </span>
        </div>

        <div class="search-results">
          <div v-if="loading" class="search-loading">
            搜索中...
          </div>

          <div v-else-if="query && results.length === 0" class="search-empty">
            未找到相关结果
          </div>

          <div v-else-if="!query" class="search-empty">
            输入关键词开始搜索
          </div>

          <template v-else>
            <div v-if="groupedResults.pages.length > 0" class="search-group">
              <div class="search-group-title">页面</div>
              <div
                v-for="(result, idx) in groupedResults.pages"
                :key="result.id"
                class="search-item"
                :class="{ active: idx === selectedIndex }"
                @click="navigateToResult(result)"
              >
                <span class="search-item-icon">📄</span>
                <div class="search-item-content">
                  <div class="search-item-title">{{ getResultTitle(result) }}</div>
                  <div class="search-item-type">{{ getResultTypeLabel(result) }}</div>
                </div>
              </div>
            </div>

            <div v-if="groupedResults.blocks.length > 0" class="search-group">
              <div class="search-group-title">内容</div>
              <div
                v-for="(result, idx) in groupedResults.blocks"
                :key="result.id"
                class="search-item"
                :class="{ active: idx + groupedResults.pages.length === selectedIndex }"
                @click="navigateToResult(result)"
              >
                <span class="search-item-icon">📝</span>
                <div class="search-item-content">
                  <div class="search-item-title">{{ getResultTitle(result) }}</div>
                  <div class="search-item-match">{{ result.matchedText }}</div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.search-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--overlay);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 120px;
  z-index: 1000;
}

.search-panel {
  width: 600px;
  max-height: 500px;
  background: var(--bg-base);
  border-radius: 12px;
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
}

.search-header {
  padding: 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-input {
  width: 100%;
  padding: 12px 16px;
  font-size: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-sidebar);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.2s;

  &:focus {
    border-color: var(--accent);
  }
}

.search-hint {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--text-tertiary);

  kbd {
    padding: 2px 6px;
    background: var(--bg-hover);
    border-radius: 4px;
    border: 1px solid var(--border);
    font-family: monospace;
  }
}

.search-results {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.search-loading,
.search-empty {
  padding: 40px;
  text-align: center;
  color: var(--text-tertiary);
}

.search-group {
  margin-bottom: 8px;
}

.search-group-title {
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.search-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover,
  &.active {
    background: var(--bg-hover);
  }
}

.search-item-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.search-item-content {
  flex: 1;
  min-width: 0;
}

.search-item-title {
  font-size: 14px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-item-type {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.search-item-match {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
