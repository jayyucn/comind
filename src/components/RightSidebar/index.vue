<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRightSidebar } from '../../composables/useRightSidebar'
import Icon from '../Icons/Icon.vue'
import { getRegisteredPanels } from './panels'

const { visible, activePanelId, settings, setActivePanel,  setWidth, persistSettings } = useRightSidebar()

const isResizing = ref(false)

const sidebarWidth = computed(() => settings.value.width + 'px')

const orderedPanels = computed(() => {
  const all = getRegisteredPanels()
  const order = settings.value.panelOrder
  const ordered = order
    .map(id => all.find(p => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p)
  for (const panel of all) {
    if (!ordered.find(p => p.id === panel.id)) {
      ordered.push(panel)
    }
  }
  return ordered
})

const activePanel = computed(() => {
  return orderedPanels.value.find(p => p.id === activePanelId.value)
})

function handleResizeStart(e: MouseEvent) {
  e.preventDefault()
  isResizing.value = true
  const startX = e.clientX
  const startWidth = settings.value.width

  function onMouseMove(ev: MouseEvent) {
    const delta = startX - ev.clientX
    setWidth(startWidth + delta, false)
  }

  function onMouseUp() {
    isResizing.value = false
    // 拖拽结束时持久化宽度
    persistSettings()
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}
</script>

<template>
  <Transition name="right-sidebar">
    <div v-if="visible" class="right-sidebar" :style="{ width: sidebarWidth }">
      <div class="resize-handle" @mousedown="handleResizeStart"></div>

      <div class="right-sidebar-header">
        <div class="right-sidebar-tabs">
          <button v-for="panel in orderedPanels" :key="panel.id" class="tab-btn"
            :class="{ active: activePanelId === panel.id }" @click="setActivePanel(panel.id)">
            <span class="tab-icon">
              <Icon :name="panel.icon" :size="16" />
            </span>
            <span class="tab-label">{{ panel.label }}</span>
          </button>
        </div>
      </div>

      <div class="right-sidebar-content">
        <component :is="activePanel?.component" v-if="activePanel" />
      </div>
    </div>
  </Transition>
</template>

<style lang="scss" scoped>
.right-sidebar {
  top: var(--nav-height);
  height: calc(100vh - var(--nav-height));
  background: var(--bg-sidebar);
  border: 1px solid var(--border);
  border-top-left-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
  z-index: var(--z-sidebar);
}

.resize-handle {
  position: absolute;

  left: 0;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  z-index: var(--z-sticky);
}

.resize-handle:hover,
.resize-handle:active {
  background: var(--color-primary, #1890ff);
  opacity: 0.4;
}

.right-sidebar-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 8px 8px 0px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.right-sidebar-tabs {
  display: flex;
  flex: 1;
  min-width: 0;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 2px 8px;
  border: none;
  border-top-left-radius: var(--radius-sm);
  border-top-right-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  color: var(--text-tertiary);
  transition: background 80ms ease, color 80ms ease, border-color 120ms ease;
  border-bottom: 1px solid transparent;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  &.active {
    background: var(--bg-active);
    color: var(--text-primary);
    font-weight: var(--font-medium);
    border-bottom-color: var(--accent);
  }
}

.tab-icon {
  width: 16px;
  height: 16px;
}

.tab-label {
  font-size: var(--text-md);
}

.right-sidebar-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.right-sidebar-enter-active,
.right-sidebar-leave-active {
  transition: width 200ms ease, opacity 200ms ease;
}

.right-sidebar-enter-from,
.right-sidebar-leave-to {
  width: 0 !important;
  opacity: 0;
}
</style>
