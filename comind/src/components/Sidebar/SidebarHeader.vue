<script setup lang="ts">
import { isTauriEnvironment } from '../../wasm/tauri-client'
import { getCurrentWindow } from '@tauri-apps/api/window'

async function handleMouseDown() {
  if (!isTauriEnvironment()) return
  const window = getCurrentWindow()
  await window.startDragging()
}
</script>

<template>
  <div class="sidebar-header" @mousedown="handleMouseDown">
    <span class="sidebar-logo">COMIND</span>
  </div>
</template>

<style scoped>
.sidebar-header {
  padding: 14px var(--space-4) 12px;
  border-bottom: 1px solid var(--border);
  height: 40px;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  flex-shrink: 0;
}

.sidebar-logo {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
</style>