<script setup lang="ts">
import { useSidebar } from '../../composables/useSidebar'
import SidebarHeader from './SidebarHeader.vue'
import SidebarIdeas from './SidebarIdeas.vue'
import SidebarGraphItem from './SidebarGraphItem.vue'
import SidebarRecent from './SidebarRecent.vue'
import SidebarFavorites from './SidebarFavorites.vue'
import SidebarFooter from './SidebarFooter.vue'
import SyncStatusBar from './SyncStatusBar.vue'

const { isCollapsed } = useSidebar()

defineProps<{
  canGoBack: boolean
  canGoForward: boolean
}>()
</script>

<template>
  <div class="sidebar-wrapper" :class="{ collapsed: isCollapsed }">
    <aside class="sidebar">
      <SidebarHeader v-bind="$props" @go-back="$emit('goBack')" @go-forward="$emit('goForward')" />

      <div class="sidebar-content">
        <SidebarIdeas />

        <SidebarGraphItem />

        <SidebarRecent />

        <SidebarFavorites />
      </div>

      <SidebarFooter />
    </aside>

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