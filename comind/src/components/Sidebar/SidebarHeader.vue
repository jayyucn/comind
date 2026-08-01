<script setup lang="ts">
import { isTauriEnvironment } from '../../wasm/tauri-client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import Icon from '../Icons/Icon.vue'

defineProps<{
  canGoBack: boolean
  canGoForward: boolean
}>()

defineEmits<{
  goBack: []
  goForward: []
}>()

async function handleMouseDown() {
  if (!isTauriEnvironment()) return
  const window = getCurrentWindow()
  await window.startDragging()
}
</script>

<template>
  <div class="sidebar-header" @mousedown="handleMouseDown">
    <span class="sidebar-logo">COMIND</span>
    <div class="header-right">
      <button
        class="nav-btn"
        :disabled="!canGoBack"
        title="后退"
        @mousedown.stop
        @click="$emit('goBack')"
      >
        <Icon name="icon-arrow-left" :size="16" />
      </button>
      <button
        class="nav-btn"
        :disabled="!canGoForward"
        title="前进"
        @mousedown.stop
        @click="$emit('goForward')"
      >
        <Icon name="icon-arrow-right" :size="16" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: var(--nav-height);
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  box-sizing: border-box;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 2px;
}

.sidebar-logo {
  margin-left: var(--space-6);
  font-size: var(--text-sm);
  font-weight: var(--font-bold);
  color: var(--text-secondary);
  letter-spacing: var(--letter-wide-3);
  text-transform: uppercase;
}

.nav-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--text-tertiary);
  transition: background 100ms ease, color 100ms ease;
}

.nav-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.nav-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.nav-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
