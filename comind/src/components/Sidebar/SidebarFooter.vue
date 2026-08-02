<script setup lang="ts">
import { Settings, Trash } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import SyncStatusBar from './SyncStatusBar.vue'
import { useSettingsModal } from '../../composables/useSettingsModal'

const { open: openSettings } = useSettingsModal()
const router = useRouter()

function openTrash() {
  router.push('/trash')
}
</script>

<template>
  <div class="sidebar-footer">
    <div class="footer-section">
      <button
        class="settings-btn"
        title="设置"
        @click="openSettings"
      >
        <Settings :size="15" :stroke-width="1.75" />
      </button>
    </div>
    <div class="footer-divider"></div>
    <div class="footer-section">
      <button
        class="settings-btn"
        title="回收站"
        @click="openTrash"
      >
        <Trash :size="15" :stroke-width="1.75" />
      </button>
    </div>
    <div class="footer-divider"></div>
    <div class="footer-section">
      <SyncStatusBar />
    </div>
  </div>
</template>

<style scoped>
.sidebar-footer {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  height: var(--footer-height);
  box-sizing: border-box;
}

.footer-section {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
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
