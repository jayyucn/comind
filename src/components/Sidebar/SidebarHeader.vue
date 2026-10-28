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
  />
</template>

<style lang="scss" scoped>
// 仅保留 32px 高的顶部分隔线，与 pane-tabstrip 底部边框同一水平线；
// 折叠开关与导航按钮已上提到 SidebarContainer 的常驻 fixed 顶栏。
.sidebar-header {
  height: 31px;
  flex-shrink: 0;
  background: var(--surface-subtle);
  box-sizing: border-box;
}
</style>
