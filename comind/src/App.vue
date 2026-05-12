<script setup lang="ts">
import Sidebar from './components/Sidebar/index.vue'
import { useEditorStore } from './stores/editor'

const editorStore = useEditorStore()

function handleMainClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.block')) return
  editorStore.deactivateBlock()
}
</script>

<template>
  <div class="app-layout">
    <Sidebar />
    
    <div class="page-scroll-wrapper" @click="handleMainClick">
      <div class="page-body">
        <main class="main-content">
          <RouterView />
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
  overflow-x: hidden;
}

.page-body {
  max-width: 800px;
  min-width: 0;
  margin: 0 auto;
  padding: 0 24px;
}

.main-content {
  padding: 48px 0;
}
</style>
