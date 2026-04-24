<script setup lang="ts">
import Sidebar from './components/Sidebar/index.vue'
import Page from './components/Page/index.vue'
import { useBlockStore } from './stores/blocks'

const blockStore = useBlockStore()
</script>

<template>
  <div class="app-layout">
    <Sidebar />
    <Page :page-id="blockStore.currentPageId" :editable-title="true" />
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
</style>
