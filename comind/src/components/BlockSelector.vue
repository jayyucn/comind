<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { usePageStore } from '../stores/pages'
import { useBlockStore } from '../stores/blocks'
import { storage } from '../storage/indexedDB'
import type { Block } from '../types/block'

const props = defineProps<{
  visible: boolean
  excludeBlockId?: string
}>()

const emit = defineEmits<{
  (e: 'select', sourceBlockId: string, sourcePageId: string): void
  (e: 'close'): void
}>()

const pageStore = usePageStore()
const blockStore = useBlockStore()

const searchQuery = ref('')
const selectedPageId = ref<string | null>(null)
const selectedPageBlocks = ref<Block[]>([])

const pages = computed(() =>
  pageStore.pages
    .filter(p => !p.deleted)
    .filter(p => searchQuery.value === '' ||
      p.title.toLowerCase().includes(searchQuery.value.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)
)

const pageBlocks = computed(() =>
  selectedPageBlocks.value
    .filter(b => b.id !== props.excludeBlockId)
    .sort((a, b) => a.pos - b.pos)
)

async function selectPage(pageId: string) {
  selectedPageId.value = pageId
  if (pageId === pageStore.currentPageId) {
    selectedPageBlocks.value = blockStore.blocks.filter(b => b.pageId === pageId)
  } else {
    selectedPageBlocks.value = await storage.getBlockTree(pageId)
  }
}

function selectBlock(blockId: string) {
  const block = selectedPageBlocks.value.find(b => b.id === blockId)
  if (!block) return
  emit('select', blockId, block.pageId)
}

function getBlockPreview(content: string): string {
  if (!content) return '(empty)'
  return content.substring(0, 80) + (content.length > 80 ? '...' : '')
}

function getBlockTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    bullet: '•',
    code: '</>',
    image: '🖼',
    embed: '📌',
    property: '📋',
    query: '🔍'
  }
  return labels[type] || type
}

watch(() => props.visible, (v) => {
  if (v) {
    searchQuery.value = ''
    selectedPageId.value = null
  }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="block-selector-overlay" @click.self="emit('close')">
      <div class="block-selector">
        <div class="bs-header">
          <input
            v-model="searchQuery"
            class="bs-search"
            placeholder="Search pages..."
            autofocus
          />
          <button class="bs-close-btn" @click="emit('close')">✕</button>
        </div>
        <div class="bs-body">
          <div class="bs-pages">
            <div
              v-for="page in pages"
              :key="page.id"
              class="bs-page-item"
              :class="{ active: selectedPageId === page.id }"
              @click="selectPage(page.id)"
            >
              {{ page.icon || '📄' }} {{ page.title }}
            </div>
            <div v-if="pages.length === 0" class="bs-empty">No pages found</div>
          </div>
          <div class="bs-blocks">
            <div v-if="!selectedPageId" class="bs-empty">Select a page</div>
            <div
              v-for="block in pageBlocks"
              :key="block.id"
              class="bs-block-item"
              @click="selectBlock(block.id)"
            >
              <span class="bs-block-type">{{ getBlockTypeLabel(block.type) }}</span>
              <span class="bs-block-preview">{{ getBlockPreview(block.content) }}</span>
            </div>
            <div v-if="selectedPageId && pageBlocks.length === 0" class="bs-empty">No blocks</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.block-selector-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.block-selector {
  width: 640px;
  max-height: 480px;
  background: var(--bg-primary, #fff);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.bs-header {
  display: flex;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--border-color, #E7E5E4);
  gap: 8px;
}

.bs-search {
  flex: 1;
  border: 1px solid var(--border-color, #E7E5E4);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 14px;
  outline: none;
  background: var(--bg-primary, #fff);
}

.bs-search:focus {
  border-color: var(--accent-color, #2563EB);
}

.bs-close-btn {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: var(--text-muted, #78716C);
  padding: 4px;
}

.bs-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.bs-pages {
  width: 200px;
  overflow-y: auto;
  border-right: 1px solid var(--border-color, #E7E5E4);
  padding: 4px;
}

.bs-blocks {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.bs-page-item {
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bs-page-item:hover,
.bs-page-item.active {
  background: var(--bg-secondary, #F5F5F4);
}

.bs-block-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
}

.bs-block-item:hover {
  background: var(--bg-secondary, #F5F5F4);
}

.bs-block-type {
  flex-shrink: 0;
  width: 24px;
  text-align: center;
  color: var(--text-muted, #78716C);
}

.bs-block-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary, #44403C);
}

.bs-empty {
  padding: 16px;
  color: var(--text-muted, #78716C);
  font-style: italic;
  text-align: center;
}
</style>