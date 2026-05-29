<script setup lang="ts">
import { Settings } from 'lucide-vue-next'
import { useSettingsModal } from '../../composables/useSettingsModal'

const { open } = useSettingsModal()
</script>

<template>
  <div class="sidebar-footer">
    <button class="settings-btn" title="设置" @click="open">
      <Settings :size="15" :stroke-width="1.75" />
    </button>
    <div class="shortcut-hint">
      <kbd>Ctrl</kbd>+<kbd>K</kbd>
      <span class="hint-text">命令与搜索</span>
    </div>
  </div>
</template>

<style scoped>
.sidebar-footer {
  padding: var(--space-3);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.settings-btn {
  width: 100%;
  height: 30px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  transition: background 80ms ease, color 80ms ease;
  margin-bottom: var(--space-2);
}

.settings-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.shortcut-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}

kbd {
  display: inline-block;
  padding: 2px 4px;
  font-size: 10px;
  font-family: inherit;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 3px;
  box-shadow: 0 1px 0 var(--border);
}

.hint-text {
  margin-left: 6px;
  font-weight: 400;
}
</style>
