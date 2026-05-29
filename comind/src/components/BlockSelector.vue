<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { usePageStore } from '../stores/pages'
import { useBlockStore } from '../stores/blocks'
import { storage } from '../storage/indexedDB'
import { pushModal, popModal } from '../composables/useModalKeyboard'
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
const allBlocks = ref<Block[]>([])
const selectedIndex = ref(0)

const filteredBlocks = computed(() => {
  const q = searchQuery.value.toLowerCase()
  let blocks = allBlocks.value.filter(b => b.id !== props.excludeBlockId && b.type !== 'embed' && b.content.trim() !== '')

  if (q) {
    blocks = blocks.filter(b => b.content.toLowerCase().includes(q))
  }

  return blocks.slice(0, 50)
})

const menuItems = computed(() => {
  return filteredBlocks.value.map(block => {
    const page = pageStore.pages.find(p => p.id === block.pageId)
    return {
      blockId: block.id,
      pageId: block.pageId,
      content: block.content,
      type: block.type,
      pageTitle: page?.title ?? 'Deleted page',
      pageIcon: page?.icon ?? '📄'
    }
  })
})

async function loadAllBlocks() {
  const currentBlocks = blockStore.blocks.filter(b => b.id !== props.excludeBlockId && b.type !== 'embed')
  const currentPageId = pageStore.currentPageId
  const otherPageIds = pageStore.pages
    .filter(p => !p.deleted && p.id !== currentPageId)
    .map(p => p.id)

  const otherBlocks: Block[] = []
  for (const pageId of otherPageIds) {
    const blocks = await storage.getBlockTree(pageId)
    otherBlocks.push(...blocks.filter(b => b.id !== props.excludeBlockId && b.type !== 'embed'))
  }

  allBlocks.value = [...currentBlocks, ...otherBlocks]
}

function selectBlock(blockId: string) {
  const item = menuItems.value.find(m => m.blockId === blockId)
  if (!item) return
  emit('select', blockId, item.pageId)
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
    pushModal('block-selector')
    searchQuery.value = ''
    selectedIndex.value = 0
    loadAllBlocks()
  } else {
    popModal('block-selector')
  }
})

watch(searchQuery, () => {
  selectedIndex.value = 0
})

function handleKeyDown(e: KeyboardEvent) {
  if (!props.visible) return

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      selectedIndex.value = Math.min(selectedIndex.value + 1, menuItems.value.length - 1)
      break
    case 'ArrowUp':
      e.preventDefault()
      selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
      break
    case 'Enter':
      e.preventDefault()
      if (menuItems.value[selectedIndex.value]) {
        selectBlock(menuItems.value[selectedIndex.value].blockId)
      }
      break
    case 'Escape':
      e.preventDefault()
      emit('close')
      break
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="block-selector-overlay" @click.self="emit('close')" @keydown="handleKeyDown">
      <div class="block-selector">
        <div class="bs-header">
          <input
            v-model="searchQuery"
            class="bs-search"
            placeholder="Search blocks..."
            autofocus
            @keydown="handleKeyDown"
          />
          <button class="bs-close-btn" @click="emit('close')">✕</button>
        </div>
        <div class="bs-body">
          <div v-if="menuItems.length === 0" class="bs-empty">
            <span v-if="!searchQuery">No blocks found</span>
            <span v-else>No blocks match "{{ searchQuery }}"</span>
          </div>
          <div
            v-for="(item, index) in menuItems"
            :key="item.blockId"
            class="bs-block-item"
            :class="{ active: selectedIndex === index }"
            @click="selectBlock(item.blockId)"
            @mouseenter="selectedIndex = index"
          >
            <span class="bs-block-type">{{ getBlockTypeLabel(item.type) }}</span>
            <div class="bs-block-info">
              <span class="bs-block-preview">{{ getBlockPreview(item.content) }}</span>
              <span class="bs-block-page">{{ item.pageIcon }} {{ item.pageTitle }}</span>
            </div>
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
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.block-selector {
  width: 520px;
  max-height: 480px;
  background: var(--bg-base);
  border-radius: 8px;
  box-shadow: var(--shadow-elevation-2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.bs-header {
  display: flex;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--border);
  gap: 8px;
}

.bs-search {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 14px;
  outline: none;
  background: var(--bg-base);
}

.bs-search:focus {
  border-color: var(--accent);
}

.bs-close-btn {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: var(--text-tertiary);
  padding: 4px;
}

.bs-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.bs-block-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
}

.bs-block-item:hover,
.bs-block-item.active {
  background: var(--bg-hover);
}

.bs-block-type {
  flex-shrink: 0;
  width: 24px;
  text-align: center;
  color: var(--text-tertiary);
  padding-top: 1px;
}

.bs-block-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bs-block-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.bs-block-page {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bs-empty {
  padding: 16px;
  color: var(--text-tertiary);
  font-style: italic;
  text-align: center;
}
</style>
