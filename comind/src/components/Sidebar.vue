<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { usePageStore } from '../stores/pages'
import { useBlockStore } from '../stores/blocks'

const pageStore = usePageStore()
const blockStore = useBlockStore()
const newPageTitle = ref('')
const creating = ref(false)

onMounted(async () => {
  await pageStore.loadAllPages()
  if (pageStore.pages.length > 0) {
    await pageStore.openPage(pageStore.pages[0].id)
    ensureFirstBlock()
  }
})

/** 确保当前 page 至少有一个空 block */
function ensureFirstBlock() {
  const hasBlock = blockStore.blocks.some(b => b.pageId === pageStore.currentPageId && b.parentId === null)
  if (!hasBlock) {
    blockStore.createBlock({ pageId: pageStore.currentPageId, content: '' })
  }
}

async function handleCreatePage() {
  const title = newPageTitle.value.trim()
  if (!title) return
  creating.value = true
  try {
    const page = await pageStore.createPage(title)
    await pageStore.openPage(page.id)
    ensureFirstBlock()
    newPageTitle.value = ''
  } finally {
    creating.value = false
  }
}

async function handleOpenPage(pageId: string) {
  await pageStore.openPage(pageId)
  ensureFirstBlock()
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-logo">comind</span>
    </div>

    <div class="sidebar-pages">
      <div class="page-list">
        <div
          v-for="page in pageStore.pages"
          :key="page.id"
          class="page-item"
          :class="{ active: pageStore.currentPageId === page.id }"
          @click="handleOpenPage(page.id)"
        >
          {{ page.title }}
        </div>
      </div>
    </div>

    <div class="sidebar-footer">
      <div class="new-page-form">
        <input
          v-model="newPageTitle"
          class="new-page-input"
          placeholder="New page..."
          @keydown.enter="handleCreatePage"
        />
        <button class="new-page-btn" :disabled="creating || !newPageTitle.trim()" @click="handleCreatePage">
          +
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 220px;
  height: 100%;
  background: #faf8f5;
  border-right: 1px solid #e8e0d4;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
}

.sidebar-header {
  padding: 16px 16px 12px;
  border-bottom: 1px solid #e8e0d4;
}

.sidebar-logo {
  font-family: 'Geist', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: #1c1917;
  letter-spacing: -0.3px;
}

.sidebar-pages {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  min-height: 0;
}

.page-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.page-item {
  padding: 6px 16px;
  font-size: 13px;
  color: #57534e;
  cursor: pointer;
  border-radius: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.page-item:hover {
  background: #f0ebe4;
  color: #1c1917;
}

.page-item.active {
  background: #fde68a;
  color: #92400e;
  font-weight: 500;
}

.sidebar-footer {
  padding: 12px;
  border-top: 1px solid #e8e0d4;
}

.new-page-form {
  display: flex;
  gap: 6px;
  align-items: center;
}

.new-page-input {
  flex: 1;
  padding: 5px 8px;
  font-size: 12px;
  border: 1px solid #d6cfc3;
  border-radius: 4px;
  background: #fff;
  outline: none;
  font-family: inherit;
  color: #1c1917;
}

.new-page-input:focus {
  border-color: #b45309;
}

.new-page-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: #b45309;
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.new-page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
