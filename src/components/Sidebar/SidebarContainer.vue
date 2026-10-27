<script setup lang="ts">
import { ref, watch } from 'vue'

import { useLayoutShell } from '../../composables/useLayoutShell'
import { useSidebar } from '../../composables/useSidebar'
import { usePanesStore } from '../../stores/panes'
import Icon from '../Icons/Icon.vue'
import SidebarFooter from './SidebarFooter.vue'
import SidebarGraphItem from './SidebarGraphItem.vue'
import SidebarIdeas from './SidebarIdeas.vue'
import SidebarPages from './SidebarPages.vue'
import SidebarPinned from './SidebarPinned.vue'
import SidebarRecent from './SidebarRecent.vue'
import SidebarTagItem from './SidebarTagItem.vue'
import SidebarTaskItem from './SidebarTaskItem.vue'

const { isCollapsed, toggle } = useSidebar()
const panesStore = usePanesStore()

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
    <!-- 常驻顶栏：折叠开关 + 后退/前进。固定在视口左上，侧栏折叠时仍可见；
         且仅此一份，作用于活动 pane 的历史栈（所有 pane 共用一个 UI）。 -->
    <div class="sidebar-topbar">
      <button
        class="sidebar-floating-toggle"
        :title="isCollapsed ? '展开侧边栏' : '折叠侧边栏'"
        :class="{ collapsed: isCollapsed }"
        @click="toggle"
      >
        <Icon
          :name="isCollapsed ? 'icon-panel-left-open' : 'icon-panel-left-close'"
          :size="16"
        />
      </button>
      <div class="pane-nav-group">
        <button
          class="pane-nav"
          :disabled="!panesStore.canGoBack(panesStore.activePaneId)"
          title="后退"
          @click="panesStore.goBack()"
        >
          <Icon
            name="icon-arrow-left"
            :size="16"
          />
        </button>
        <button
          class="pane-nav"
          :disabled="!panesStore.canGoForward(panesStore.activePaneId)"
          title="前进"
          @click="panesStore.goForward()"
        >
          <Icon
            name="icon-arrow-right"
            :size="16"
          />
        </button>
      </div>
    </div>

    <aside
      ref="sidebarRef"
      class="sidebar"
    >
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

// 常驻顶栏：折叠开关 + 后退/前进，固定在视口左上，侧栏折叠态也可见（不再被折叠隐藏）。
.sidebar-topbar {
  position: fixed;
  top: 0;
  left: 0;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: var(--space-2);
  box-sizing: border-box;
  z-index: var(--z-dropdown);
}

.sidebar-wrapper.collapsed .sidebar {
  width: 0;
  opacity: 0;
  transform: translateX(-8px);
}

.sidebar-floating-toggle {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);

  &:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  &:active {
    transform: scale(0.95);
  }
}

// 后退/前进组：所有 pane 共用一个 UI，作用于活动 pane 的历史栈
.pane-nav-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.pane-nav {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }
}

.sidebar-content {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 32px 8px 8px;
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
