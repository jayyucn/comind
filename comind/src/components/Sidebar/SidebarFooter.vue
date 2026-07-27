<script setup lang="ts">
import SyncStatusBar from './SyncStatusBar.vue'
</script>

<template>
  <div class="sidebar-footer">
    <div class="shortcut-hint">
      <kbd>Ctrl</kbd>+<kbd>K</kbd>
      <span class="hint-text">命令与搜索</span>
    </div>
    <SyncStatusBar />
  </div>
</template>

<style scoped>
.sidebar-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: var(--space-3);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.shortcut-hint {
  display: flex;
  align-items: center;
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
