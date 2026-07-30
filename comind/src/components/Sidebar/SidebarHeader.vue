<script setup lang="ts">
import { Settings } from 'lucide-vue-next'
import { isTauriEnvironment } from '../../wasm/tauri-client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useSettingsModal } from '../../composables/useSettingsModal'

const { open: openSettings } = useSettingsModal()

async function handleMouseDown() {
  if (!isTauriEnvironment()) return
  const window = getCurrentWindow()
  await window.startDragging()
}
</script>

<template>
  <div class="sidebar-header" @mousedown="handleMouseDown">
    <span class="sidebar-logo">COMIND</span>
    <button
      class="settings-btn"
      title="设置"
      @mousedown.stop
      @click="openSettings"
    >
      <Settings :size="15" :stroke-width="1.75" />
    </button>
  </div>
</template>

<style scoped>
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 40px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  box-sizing: border-box;
}

.sidebar-logo {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.settings-btn {
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

.settings-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.settings-btn:active {
  transform: scale(0.95);
}
</style>
