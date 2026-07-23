<script setup lang="ts">
</script>

<template>
  <div class="sidebar-footer">
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
