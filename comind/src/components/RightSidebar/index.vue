<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRightSidebar } from '../../composables/useRightSidebar'
import { getRegisteredPanels } from './panels'
import { X } from 'lucide-vue-next'

const { visible, activePanelId, settings, setActivePanel, setVisible, setWidth, persistSettings } = useRightSidebar()

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
          <button
            v-for="panel in orderedPanels"
            :key="panel.id"
            class="tab-btn"
            :class="{ active: activePanelId === panel.id }"
            @click="setActivePanel(panel.id)"
          >
            <span class="tab-icon">{{ panel.icon }}</span>
            <span class="tab-label">{{ panel.label }}</span>
          </button>
        </div>
        <button class="close-btn" @click="setVisible(false)">
          <X :size="14" :stroke-width="1.75" />
        </button>
      </div>

      <div class="right-sidebar-content">
        <component :is="activePanel?.component" v-if="activePanel" />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.right-sidebar {
  height: 100%;
  background: var(--bg-sidebar);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
}

.resize-handle {
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
}

.resize-handle:hover,
.resize-handle:active {
  background: var(--color-primary, #1890ff);
  opacity: 0.4;
}

.right-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.right-sidebar-tabs {
  display: flex;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-family: inherit;
  transition: background 80ms ease, color 80ms ease, border-color 120ms ease;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
}

.tab-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.tab-btn.active {
  background: var(--bg-active);
  color: var(--text-primary);
  font-weight: var(--font-medium);
  border-bottom-color: var(--accent);
}

.tab-icon {
  font-size: var(--text-xs);
}

.tab-label {
  font-size: var(--text-xs);
}

.close-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  flex-shrink: 0;
  transition: background 80ms ease, color 80ms ease;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
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
