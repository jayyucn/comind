<script setup lang="ts">
import { Settings } from 'lucide-vue-next'
import { isTauriEnvironment } from '../../wasm/tauri-client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import Icon from '../Icons/Icon.vue'
import { useSettingsModal } from '../../composables/useSettingsModal'

const { open: openSettings } = useSettingsModal()

defineProps<{
  canGoBack: boolean
  canGoForward: boolean
}>()

const emit = defineEmits<{
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
    <div class="sidebar-logo-wrap">
      <span class="sidebar-logo">COMIND</span>
    </div>
    <div class="sidebar-nav" @mousedown.stop>
      <button
        class="sidebar-nav-btn"
        :class="{ disabled: !canGoBack }"
        :disabled="!canGoBack"
        title="后退"
        @click="emit('goBack')"
      >
        <Icon name="icon-arrow-left" :size="14" />
      </button>
      <button
        class="sidebar-nav-btn"
        :class="{ disabled: !canGoForward }"
        :disabled="!canGoForward"
        title="前进"
        @click="emit('goForward')"
      >
        <Icon name="icon-arrow-right" :size="14" />
      </button>
      <button
        class="sidebar-nav-btn settings-btn"
        title="设置"
        @click="openSettings"
      >
        <Settings :size="15" :stroke-width="1.75" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.sidebar-header {
  padding: 10px var(--space-3) 10px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  box-sizing: border-box;
  height: 40px;
}

.sidebar-logo-wrap {
  flex: 1;
  min-width: 0;
}

.sidebar-logo {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sidebar-nav {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.sidebar-nav-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  transition: background 100ms ease, color 100ms ease;
}

.sidebar-nav-btn:hover:not(.disabled) {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.sidebar-nav-btn:active:not(.disabled) {
  background: var(--bg-active);
  transform: scale(0.95);
}

.sidebar-nav-btn.disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
