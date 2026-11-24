<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { usePageStore } from '../stores/pages'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  select: [pageId: string]
  close: []
}>()

const pageStore = usePageStore()
const searchInput = ref<HTMLInputElement | null>(null)
const query = ref('')
const selectedIndex = ref(0)

const pages = computed(() => pageStore.pages.filter(p => !p.deleted))

const filteredPages = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return pages.value
  return pages.value.filter(p => (p.title ?? '').toLowerCase().includes(q))
})

interface Item {
  type: 'create' | 'page'
  id?: string
  title: string
}

/** 列表：query 非空时首行「新建页面」，其后为匹配页面。 */
const items = computed<Item[]>(() => {
  const list: Item[] = []
  const q = query.value.trim()
  if (q) {
    const exact = pages.value.some(p => (p.title ?? '').toLowerCase() === q.toLowerCase())
    if (!exact) list.push({ type: 'create', title: q })
  }
  for (const p of filteredPages.value) {
    list.push({ type: 'page', id: p.id, title: p.title || '未命名页面' })
  }
  return list
})

watch(
  () => props.visible,
  (v) => {
    if (v) {
      query.value = ''
      selectedIndex.value = 0
      void pageStore.ensurePagesLoaded()
      nextTick(() => searchInput.value?.focus())
    }
  },
)

watch(items, () => {
  if (selectedIndex.value >= items.value.length) selectedIndex.value = 0
})

function activate(item: Item | undefined) {
  if (!item) return
  if (item.type === 'create') {
    void pageStore.getOrCreatePageByTitle(item.title).then((page) => {
      emit('select', page.id)
    })
    return
  }
  if (item.id) emit('select', item.id)
}

function onKeydown(e: KeyboardEvent) {
  if (!props.visible) return
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (items.value.length > 0) {
      selectedIndex.value = (selectedIndex.value + 1) % items.value.length
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (items.value.length > 0) {
      selectedIndex.value = (selectedIndex.value - 1 + items.value.length) % items.value.length
    }
  } else if (e.key === 'Enter') {
    e.preventDefault()
    activate(items.value[selectedIndex.value])
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="page-search-overlay"
      @click.self="emit('close')"
    >
      <div class="page-search-panel">
        <div class="ps-header">
          <input
            ref="searchInput"
            v-model="query"
            type="text"
            class="ps-input"
            placeholder="搜索页面，或输入名称新建…"
            @keydown.stop
          >
          <span class="ps-hint">
            <kbd>↑</kbd><kbd>↓</kbd> 选择
            <kbd>Enter</kbd> 打开
            <kbd>Esc</kbd> 关闭
          </span>
        </div>
        <div class="ps-results">
          <div
            v-if="items.length === 0"
            class="ps-empty"
          >
            输入关键词开始搜索
          </div>
          <button
            v-for="(item, idx) in items"
            :key="item.type + (item.id ?? item.title)"
            class="ps-item"
            :class="{ active: idx === selectedIndex }"
            @mousemove="selectedIndex = idx"
            @click="activate(item)"
          >
            <span class="ps-item-icon">{{ item.type === 'create' ? '➕' : '📄' }}</span>
            <span class="ps-item-title">
              <template v-if="item.type === 'create'">新建页面「{{ item.title }}」</template>
              <template v-else>{{ item.title }}</template>
            </span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.page-search-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay, rgba(0, 0, 0, 0.4));
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 120px;
  z-index: var(--z-dialog, 1000);
}

.page-search-panel {
  width: 600px;
  max-width: calc(100vw - 32px);
  max-height: 500px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-floating, 0 12px 40px rgba(0, 0, 0, 0.25));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ps-header {
  padding: 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ps-input {
  width: 100%;
  padding: 12px 16px;
  font-size: var(--text-base, 15px);
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-sidebar, var(--bg-base));
  color: var(--text-primary);
  outline: none;

  &:focus {
    border-color: var(--accent, #4f7cff);
  }
}

.ps-hint {
  display: flex;
  gap: 8px;
  font-size: var(--text-xs, 11px);
  color: var(--text-tertiary);

  kbd {
    padding: 2px 6px;
    background: var(--bg-hover);
    border-radius: 4px;
    border: 1px solid var(--border);
    font-family: var(--font-mono, monospace);
  }
}

.ps-results {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.ps-empty {
  padding: 40px;
  text-align: center;
  color: var(--text-tertiary);
}

.ps-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: var(--text-primary);
  font-size: var(--text-sm, 13px);

  &:hover,
  &.active {
    background: var(--bg-hover);
  }
}

.ps-item-icon {
  font-size: var(--text-lg, 16px);
  flex-shrink: 0;
}

.ps-item-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
