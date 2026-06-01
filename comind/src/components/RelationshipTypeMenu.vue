<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { PREDEFINED_RELATIONSHIPS } from '../utils/parser'
import { pushModal, popModal } from '../composables/useModalKeyboard'

export interface RelationshipMenuItem {
  key: string
  label: string
  inverseLabel: string
  color: string
  hasInverse: boolean
}

const props = defineProps<{
  visible: boolean
  position: {
    x: number
    y: number
  }
  currentRelationshipType: string | null
}>()

const emit = defineEmits<{
  (e: 'select', relationshipType: string | null): void
  (e: 'selectBidirectional', relationshipType: string | null): void
  (e: 'close'): void
}>()

const selectedIndex = ref(0)
const createBidirectional = ref(false)

watch(() => props.visible, (isVisible) => {
  if (isVisible) {
    pushModal('relationship-type-menu')
    selectedIndex.value = 0
    createBidirectional.value = false
    const currentIdx = menuItems.value.findIndex(
      item => item.key === props.currentRelationshipType
    )
    if (currentIdx >= 0) {
      selectedIndex.value = currentIdx + 1
    }
  } else {
    popModal('relationship-type-menu')
  }
})

onUnmounted(() => {
  popModal('relationship-type-menu')
})

watch(() => props.currentRelationshipType, () => {
  selectedIndex.value = 0
  createBidirectional.value = false
})

const menuItems = computed<Array<RelationshipMenuItem | { key: 'remove'; label: string; color: string; isRemove: boolean }>>(() => {
  const items: Array<RelationshipMenuItem | { key: 'remove'; label: string; color: string; isRemove: boolean }> = []

  PREDEFINED_RELATIONSHIPS.forEach(rel => {
    items.push({
      key: rel.key,
      label: rel.label,
      inverseLabel: rel.inverseLabel,
      color: rel.color,
      hasInverse: rel.inverseKey !== rel.key
    })
  })

  return items
})

const allItems = computed(() => {
  const hasCurrent = props.currentRelationshipType !== null
  if (hasCurrent) {
    return [
      { key: 'remove', label: '移除关系类型', color: '#9E9E9E', isRemove: true },
      { separator: true },
      ...menuItems.value
    ]
  }
  return menuItems.value
})

function selectItem(item: typeof allItems.value[number], bidirectionally = false) {
  if ('separator' in item) return

  if (item.key === 'remove') {
    emit('select', null)
  } else {
    if (bidirectionally) {
      emit('selectBidirectional', item.key)
    } else {
      emit('select', item.key)
    }
  }
}

function selectNext() {
  selectedIndex.value = Math.min(selectedIndex.value + 1, allItems.value.length - 1)
}

function selectPrev() {
  selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
}

function confirmSelect() {
  const item = allItems.value[selectedIndex.value]
  if (item && !('separator' in item)) {
    const relItem = item as RelationshipMenuItem
    if ('hasInverse' in relItem && relItem.hasInverse && createBidirectional.value) {
      selectItem(item, true)
    } else {
      selectItem(item)
    }
  }
}

function close() {
  emit('close')
}

function toggleBidirectional() {
  createBidirectional.value = !createBidirectional.value
}

defineExpose({ selectNext, selectPrev, confirmSelect, close })
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="relationship-menu-overlay" @click.self="emit('close')">
      <div
        class="relationship-menu"
        :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      >
        <div class="rm-header">
          <span class="rm-title">选择关系类型</span>
        </div>
        <div class="rm-body">
          <template v-for="(item, index) in allItems" :key="index">
            <div v-if="'separator' in item" class="rm-separator"></div>
            <div
              v-else-if="'isRemove' in item"
              class="rm-item rm-remove"
              :class="{ active: selectedIndex === index }"
              @click="selectItem(item)"
              @mouseenter="selectedIndex = index"
            >
              <span class="rm-label">{{ item.label }}</span>
            </div>
            <div
              v-else
              class="rm-item"
              :class="{ active: selectedIndex === index }"
              @click="selectItem(item)"
              @mouseenter="selectedIndex = index"
            >
              <span
                class="rm-color"
                :style="{ backgroundColor: item.color }"
              ></span>
              <span class="rm-label">{{ item.label }}</span>
              <span v-if="'hasInverse' in item && (item as RelationshipMenuItem).hasInverse" class="rm-bidirectional">
                <span
                  class="rm-bidir-btn"
                  :class="{ active: createBidirectional && selectedIndex === index }"
                  @click.stop="toggleBidirectional(); selectItem(item, true)"
                  title="同时创建反向关系"
                >↔</span>
              </span>
            </div>
          </template>
        </div>
        <div class="rm-footer">
          <span class="rm-hint">↔ 同时创建反向关系</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.relationship-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 1001;
}

.relationship-menu {
  position: absolute;
  width: 220px;
  background: var(--bg-base);
  border-radius: 8px;
  box-shadow: var(--shadow-elevation-2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
}

.rm-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.rm-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
}

.rm-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
  max-height: 320px;
}

.rm-separator {
  height: 1px;
  background: var(--border);
  margin: 4px 8px;
}

.rm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 14px;
  transition: background-color 0.15s;
}

.rm-item:hover {
  background: var(--bg-hover);
}

.rm-item.active {
  background: var(--accent-subtle);
}

.rm-color {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}

.rm-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary, #1C1917);
}

.rm-item.rm-remove {
  color: var(--text-tertiary);

  .rm-label {
    color: var(--text-tertiary);
  }
}

.rm-item.rm-remove:hover,
.rm-item.rm-remove.active {
  color: var(--text-secondary);

  .rm-label {
    color: var(--text-secondary);
  }
}

.rm-bidirectional {
  flex-shrink: 0;
  margin-left: auto;
}

.rm-bidir-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 20px;
  border-radius: 4px;
  font-size: 14px;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s;
}

.rm-bidir-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.rm-bidir-btn.active {
  background: var(--accent-subtle);
  color: var(--accent);
}

.rm-footer {
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
}

.rm-hint {
  font-size: 11px;
  color: var(--text-tertiary);
}
</style>
