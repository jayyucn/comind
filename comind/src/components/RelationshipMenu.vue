<script setup lang="ts">
import type { useRelationshipMenu } from '../composables/useRelationshipMenu'

const props = defineProps<{
  menu: ReturnType<typeof useRelationshipMenu>
}>()

const { state, items, select, moveSelection, close } = props.menu

function onItemMouseDown(event: MouseEvent, index: number) {
  // 防止编辑器失焦
  event.preventDefault()
  props.menu.setSelectedIndex(index)
  select()
}

defineExpose({ moveSelection, select, close })
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.visible"
      class="rel-menu"
      :style="{ left: (state.position?.x ?? 0) + 'px', top: (state.position?.y ?? 0) + 'px' }"
    >
      <ul
        v-if="items.length > 0"
        class="rel-menu-list"
      >
        <li
          v-for="(item, index) in items"
          :key="item.type"
          class="rel-menu-item"
          :class="{ selected: index === state.selectedIndex }"
          :style="{ '--rel-color': item.color }"
          @mousedown="onItemMouseDown($event, index)"
        >
          <span class="rel-menu-type">{{ item.type }}</span>
          <span
            v-if="item.inverse"
            class="rel-menu-inverse"
          >→ {{ item.inverse }}</span>
        </li>
      </ul>
      <div
        v-else
        class="rel-menu-empty"
      >
        No matches
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rel-menu {
  position: fixed;
  z-index: 1000;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  min-width: 200px;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px 0;
}

.rel-menu-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.rel-menu-item {
  padding: 6px 12px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  border-left: 3px solid transparent;
}

.rel-menu-item:hover,
.rel-menu-item.selected {
  background: rgba(0, 0, 0, 0.04);
  border-left-color: var(--rel-color);
}

.rel-menu-type {
  font-weight: 500;
  color: var(--rel-color);
}

.rel-menu-inverse {
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
  font-style: italic;
}

.rel-menu-empty {
  padding: 12px;
  text-align: center;
  color: var(--text-secondary, #6b7280);
  font-size: 13px;
}
</style>
