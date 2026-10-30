<script setup lang="ts">
import { ref, watch } from 'vue'

import { useLayoutShell } from '../../composables/useLayoutShell'
import { useSidebar } from '../../composables/useSidebar'
import Icon from '../Icons/Icon.vue'
import SidebarFooter from './SidebarFooter.vue'
import SidebarGraphItem from './SidebarGraphItem.vue'
import SidebarIdeas from './SidebarIdeas.vue'
import SidebarPages from './SidebarPages.vue'
import SidebarPinned from './SidebarPinned.vue'
import SidebarRecent from './SidebarRecent.vue'
import SidebarTagItem from './SidebarTagItem.vue'
import SidebarTaskItem from './SidebarTaskItem.vue'

const { isCollapsed } = useSidebar()

// 把侧栏根元素写入布局壳，供 Toc 实测定位（取代全局 querySelector('.sidebar')）。
const shell = useLayoutShell()
const sidebarRef = ref<HTMLElement | null>(null)
watch(sidebarRef, el => { shell.sidebarEl.value = el }, { immediate: true })

defineEmits<{
  (e: 'open-search'): void
}>()
</script>

<template>
  <div
    class="sidebar-wrapper"
    :class="{ collapsed: isCollapsed }"
  >
    <aside
      ref="sidebarRef"
      class="sidebar"
    >
      <!-- <SidebarHeader /> -->
      <div class="sidebar-content">
        <!-- 搜索触发 -->
        <div
          class="search-trigger"
          @click="$emit('open-search')"
        >
          <div class="search-icon">
            <Icon
              name="icon-search"
              color="var(--text-secondary)"
            />
            <span class="search-placeholder">搜索</span>
          </div>
          <span class="search-shortcut">Ctrl K</span>
        </div>

        <!-- 导航区 -->
        <SidebarIdeas />
        <SidebarPages />
        <SidebarGraphItem />
        <SidebarTaskItem />
        <SidebarTagItem />

        <!-- 置顶列表（随内容取高，条目多时自身滚动） -->
        <SidebarPinned />

        <!-- 最近列表（固定高度，不滚动） -->
        <SidebarRecent />
      </div>

      <SidebarFooter />
    </aside>
  </div>
</template>

<style lang="scss" scoped>
.sidebar-wrapper {
  position: relative;
  flex-shrink: 0;
}

.sidebar-wrapper.collapsed .sidebar {
  width: 0;
  opacity: 0;
  transform: translateX(-8px);
}

.sidebar-content {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  display: flex;
  flex-direction: column;
  // border-right: 1px solid var(--border);
  gap: var(--space-2);
  // 原 32px 顶部留白用于避开覆盖式顶栏；顶栏入文档流后改为常规 8px
  padding: 8px 8px 8px;
}

.search-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.search-trigger:hover {
  background: var(--bg-active, var(--border));
}

.search-icon {
  display: flex;
  align-items: center;
}

.search-placeholder {
  margin-left: var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}

.search-shortcut {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--bg-active);
  border: 1px solid var(--border);
}

/* 响应式：小屏 overlay */
@media (max-width: 900px) {
  .sidebar-wrapper:not(.collapsed) .sidebar {
    position: absolute;
    z-index: var(--z-sidebar);
    height: 100%;
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.08);
  }
}
</style>
