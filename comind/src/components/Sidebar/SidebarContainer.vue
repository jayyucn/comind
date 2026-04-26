<script setup lang="ts">
import { useSidebar } from '../../composables/useSidebar'
import SidebarHeader from './SidebarHeader.vue'
import SidebarJournal from './SidebarJournal.vue'
import SidebarRecent from './SidebarRecent.vue'
import SidebarFavorites from './SidebarFavorites.vue'
import SidebarFooter from './SidebarFooter.vue'

const { isCollapsed, toggle } = useSidebar()
</script>

<template>
  <div class="sidebar-wrapper" :class="{ collapsed: isCollapsed }">
    <aside class="sidebar">
      <SidebarHeader @toggle-collapse="toggle" />
      
      <div class="sidebar-content">
        <SidebarJournal />
        
        <SidebarRecent />
        
        <SidebarFavorites 
          @add-favorite="() => {}"
        />
      </div>
      
      <SidebarFooter />
    </aside>

    <!-- 浮动展开按钮：折叠时贴在主内容区左边缘 -->
    <button
      v-if="isCollapsed"
      class="expand-float-btn"
      title="展开侧边栏"
      @click="toggle"
    >▶</button>
  </div>
</template>

<style scoped>
.sidebar-wrapper {
  position: relative;
  flex-shrink: 0;
}

.sidebar {
  width: 240px;
  height: 100%;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 200ms ease, opacity 200ms ease, transform 200ms ease;
}

/* 折叠：完全消失 */
.sidebar-wrapper.collapsed .sidebar {
  width: 0;
  border-right-color: transparent;
  opacity: 0;
  transform: translateX(-8px);
}

/* 浮动展开按钮 */
.expand-float-btn {
  position: absolute;
  top: 12px;
  left: 0;
  width: 24px;
  height: 32px;
  border: none;
  border-radius: 0 6px 6px 0;
  background: var(--bg-sidebar);
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.06);
  transition: background 120ms, color 120ms, width 120ms;
  z-index: 10;
}

.expand-float-btn:hover {
  background: var(--accent-03);
  color: var(--accent-dark);
  width: 28px;
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.sidebar-content::-webkit-scrollbar {
  width: 4px;
}

.sidebar-content::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}
</style>