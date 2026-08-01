<script setup lang="ts">
import SyncStatusBar from './SyncStatusBar.vue'
</script>

<template>
  <div class="sidebar-footer">
    <span class="version-text">v0.2.35</span>
    <SyncStatusBar />
  </div>
</template>

<style scoped>
.sidebar-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  height: 36px;
  box-sizing: border-box;
}

.version-text {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-family: inherit;
}
</style>
