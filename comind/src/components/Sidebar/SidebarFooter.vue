<script setup lang="ts">
import { Settings } from 'lucide-vue-next'
import SyncStatusBar from './SyncStatusBar.vue'
import { useSettingsModal } from '../../composables/useSettingsModal'

const { open: openSettings } = useSettingsModal()
</script>

<template>
  <div class="sidebar-footer">
    <button
      class="settings-btn"
      title="设置"
      @click="openSettings"
    >
      <Settings :size="15" :stroke-width="1.75" />
    </button>
    <div class="footer-divider"></div>
    <SyncStatusBar />
  </div>
</template>

<style scoped>
.sidebar-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  height: 36px;
  box-sizing: border-box;
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

.footer-divider {
  width: 1px;
  height: 16px;
  background: var(--border);
  flex-shrink: 0;
}
</style>
