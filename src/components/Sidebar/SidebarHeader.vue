<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window'

import { isTauriEnvironment } from '../../wasm/tauri-platform'

async function handleMouseDown() {
  if (!isTauriEnvironment()) return
  const window = getCurrentWindow()
  await window.startDragging()
}
</script>

<template>
  <div
    class="sidebar-header"
    @mousedown="handleMouseDown"
  >
    <span class="sidebar-logo">COMIND</span>
  </div>
</template>

<style lang="scss" scoped>
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-base);
  padding: 0 12px;
  // 与主内容区 pane-tabstrip 的 32px 对齐：两侧顶部分割线在同一水平线
  height: 32px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  box-sizing: border-box;
}

.sidebar-logo {
  margin-left: var(--space-6);
  font-size: var(--text-sm);
  font-weight: var(--font-bold);
  color: var(--text-secondary);
  letter-spacing: var(--letter-wide-3);
  text-transform: uppercase;
}
</style>
