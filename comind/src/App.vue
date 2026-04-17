<script setup lang="ts">
import { computed } from 'vue'
import Sidebar from './components/Sidebar.vue'
import Block from './components/Block.vue'
import { usePageStore } from './stores/pages'
import { useBlockStore } from './stores/blocks'

const pageStore = usePageStore()
const blockStore = useBlockStore()

/** 顶级 Block（parentId = null，且属于当前 Page） */
const topLevelBlocks = computed(() => {
  return blockStore.blocks
    .filter(b => b.parentId === null && b.pageId === blockStore.currentPageId)
    .sort((a, b) => a.left - b.left)
})

/** 获取当前 Page 的标题 */
const currentPageTitle = computed(() => {
  const page = pageStore.getPage(blockStore.currentPageId)
  return page?.title ?? 'comind'
})

/** 点击空白处新增 Block */
async function handleAddBlock() {
  const newBlock = await blockStore.createBlock({
    pageId: blockStore.currentPageId,
    content: ''
  })
  editorStore.activateBlock(newBlock.id)
}
handleAddBlock()
</script>

<template>
  <div class="app-layout">
    <Sidebar />

    <main class="main-content">
      <div class="page-header">
        <h1 class="page-title">{{ currentPageTitle }}</h1>
      </div>

      <div class="block-list">
        <Block
          v-for="block in topLevelBlocks"
          :key="block.id"
          :block-id="block.id"
          :block="block"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: #fffbf5;
}

.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 32px 48px;
  max-width: 860px;
}

.page-header {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e8e0d4;
}

.page-title {
  font-family: 'Noto Sans SC', 'Geist', sans-serif;
  font-size: 24px;
  font-weight: 600;
  color: #1c1917;
  margin: 0;
  letter-spacing: -0.5px;
}

.block-list {
  padding-left: 0;
}

.add-block-btn {
  padding: 6px 16px;
  background: #b45309;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
}

.add-block-btn:hover {
  background: #92400e;
}
</style>
