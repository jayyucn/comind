<script setup lang="ts">
import { useSidebar } from '../../composables/useSidebar'
import SidebarHeader from './SidebarHeader.vue'
import SidebarIdeas from './SidebarIdeas.vue'
import SidebarGraphItem from './SidebarGraphItem.vue'
import SidebarRecent from './SidebarRecent.vue'
import SidebarFavorites from './SidebarFavorites.vue'
import SidebarFooter from './SidebarFooter.vue'
import Icon from '../Icons/Icon.vue'

const { isCollapsed, toggle } = useSidebar()

defineProps<{
  canGoBack: boolean
  canGoForward: boolean
}>()
</script>

<template>
  <div class="sidebar-wrapper" :class="{ collapsed: isCollapsed }">
    <button class="sidebar-floating-toggle" :title="isCollapsed ? '展开侧边栏' : '折叠侧边栏'" :class="{ collapsed: isCollapsed }"
      @click="toggle">
      <Icon :name="isCollapsed ? 'icon-panel-left-open' : 'icon-panel-left-close'" :size="16" />
    </button>
    <aside class="sidebar">
      <SidebarHeader :can-go-back="canGoBack" :can-go-forward="canGoForward" @go-back="$emit('goBack')"
        @go-forward="$emit('goForward')" />

      <div class="sidebar-content">
        <!-- 搜索触发 -->
        <div class="search-trigger" @click="$emit('open-search')">
          <div class="search-icon">
            <Icon name="icon-search" color="var(--text-secondary)" />
            <span class="search-placeholder">搜索</span>
          </div>
          <span class="search-shortcut">Ctrl K</span>
        </div>

        <!-- 导航区 -->
        <SidebarIdeas />
        <SidebarGraphItem />

        <!-- 最近列表（固定高度，不滚动） -->
        <SidebarRecent />

        <!-- 收藏列表（flex 撑满，独立滚动） -->
        <SidebarFavorites />
      </div>

      <SidebarFooter />
    </aside>
  </div>
</template>

<script lang="ts">
export default {
  emits: ['open-search', 'goBack', 'goForward'],
}
</script>

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

.sidebar-floating-toggle {
  position: fixed;
  top: calc(var(--nav-height) / 2 - 13px);
  left: var(--space-2);
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
  transition: background 100ms ease, color 100ms ease, left 200ms ease;
  z-index: 1000;
}

.sidebar-floating-toggle:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.sidebar-floating-toggle:active {
  transform: scale(0.95);
}

.sidebar-content {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 8px 8px;
}

.search-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  background: var(--bg-hover);
  cursor: pointer;
  transition: background 80ms ease;
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
  border-radius: 3px;
  background: var(--bg-base);
  border: 1px solid var(--border);
}

/* 响应式：小屏 overlay */
@media (max-width: 900px) {
  .sidebar-wrapper:not(.collapsed) .sidebar {
    position: absolute;
    z-index: 100;
    height: 100%;
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.08);
  }
}
</style>
