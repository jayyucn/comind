<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import Sidebar from './components/Sidebar/index.vue'
import PageMenuButton from './components/PageMenuButton.vue'
import { useEditorStore } from './stores/editor'

const editorStore = useEditorStore()
const route = useRoute()

const historyStack = ref<string[]>([''])
const historyIndex = ref(0)

watch(() => route.fullPath, (newPath) => {
  if (newPath === historyStack.value[historyIndex.value]) return

  if (historyIndex.value < historyStack.value.length - 1) {
    historyStack.value = historyStack.value.slice(0, historyIndex.value + 1)
  }
  historyStack.value.push(newPath)
  historyIndex.value = historyStack.value.length - 1
})

const canGoBack = computed(() => historyIndex.value > 0)
const canGoForward = computed(() => historyIndex.value < historyStack.value.length - 1)

function handleGoBack() {
  if (!canGoBack.value) return
  historyIndex.value--
  window.history.go(-1)
}

function handleGoForward() {
  if (!canGoForward.value) return
  historyIndex.value++
  window.history.go(1)
}

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
      <div class="nav-controls">
        <button
          class="nav-btn"
          :class="{ disabled: !canGoBack }"
          :disabled="!canGoBack"
          title="后退"
          @click="handleGoBack"
        >
          <span class="nav-icon">←</span>
        </button>
        <button
          class="nav-btn"
          :class="{ disabled: !canGoForward }"
          :disabled="!canGoForward"
          title="前进"
          @click="handleGoForward"
        >
          <span class="nav-icon">→</span>
        </button>
      </div>
      <div class="page-body">
        <main class="main-content">
          <RouterView />
        </main>
      </div>
    </div>
    
    <PageMenuButton />
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
  min-width: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
  position: relative;
}

.nav-controls {
  position: sticky;
  top: 12px;
  left: 12px;
  display: flex;
  gap: 4px;
  z-index: 10;
  width: fit-content;
}

.nav-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  background: var(--bg-sidebar);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: all 120ms ease;
}

.nav-btn:hover:not(.disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-strong);
}

.nav-btn:active:not(.disabled) {
  background: var(--bg-active);
  transform: scale(0.95);
}

.nav-btn.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.nav-icon {
  font-size: 14px;
  line-height: 1;
}

.page-scroll-wrapper::-webkit-scrollbar {
  width: 6px;
}

.page-scroll-wrapper::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 3px;
}

.page-scroll-wrapper::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
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
