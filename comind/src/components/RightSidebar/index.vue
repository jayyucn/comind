<script setup lang="ts">
import { computed } from 'vue'
import { useRightSidebar } from '../../composables/useRightSidebar'
import { getRegisteredPanels } from './panels'
import { X } from 'lucide-vue-next'

const { visible, activePanelId, settings, setActivePanel, setVisible } = useRightSidebar()

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
</script>

<template>
  <Transition name="right-sidebar">
    <div v-if="visible" class="right-sidebar">
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
  width: 360px;
  height: 100%;
  background: var(--bg-sidebar);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
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
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: inherit;
  transition: background 80ms ease, color 80ms ease;
  white-space: nowrap;
}

.tab-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.tab-btn.active {
  background: var(--bg-active);
  color: var(--text-primary);
  font-weight: 500;
}

.tab-icon {
  font-size: 12px;
}

.tab-label {
  font-size: 11px;
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
  width: 0;
  opacity: 0;
}
</style>
