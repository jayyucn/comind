<script setup lang="ts">
import { ref } from 'vue'
import Sidebar from './components/Sidebar/index.vue'
import Page from './components/Page/index.vue'
import JournalList from './components/Journal/JournalList.vue'
import { useBlockStore } from './stores/blocks'
import type { AppView } from './types/view'

const blockStore = useBlockStore()

// 视图状态管理
const currentView = ref<AppView>('journal-list')



</script>

<template>
  <div class="app-layout">
    <Sidebar />
    
    <div class="page-scroll-wrapper">
      <div class="page-body">
        <main class="main-content">
          <template v-if="currentView === 'editor'">
            <Page :page-id="blockStore.currentPageId" :editable-title="true" />
          </template>

          <!-- Journal 列表视图 -->
          <JournalList
            v-else-if="currentView === 'journal-list'"
          />
        </main>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: row;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--bg-base);
}

.page-scroll-wrapper {
  flex: 1;
  overflow-y: auto;
}

.page-body {
  max-width: 800px;
  margin: 0 auto;
  padding: 0 24px;
}

.main-content {
  padding: 48px 0;
}
</style>
