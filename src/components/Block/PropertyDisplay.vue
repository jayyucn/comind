<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePropertyStore } from '../../stores/property'
import { useEditorStore } from '../../stores/editor'
import type { Property } from '../../types/property'
import { Icon } from '../Icons'

const props = defineProps<{
  blockId: string
}>()

const propertyStore = usePropertyStore()
const editorStore = useEditorStore()

const visibleProperties = computed<Property[]>(() => {
  const all = propertyStore.getBlockProperties(props.blockId)
  return all.filter(prop => {
    if (prop.isHidden) return false
    // T14: deadline/scheduled 已内联为 dateRef，不在属性面板展示
    if (prop.key === 'deadline' || prop.key === 'scheduled') return false
    const def = propertyStore.getPropertyDef(prop.key)
    // 显示内置属性（displayPosition === 'bottom-of-block'）和所有自定义属性
    return def?.displayPosition === 'bottom-of-block' || !def?.isBuiltIn
  })
})

const hoveredPropertyId = ref<string | null>(null)

function isBuiltIn(key: string): boolean {
  const def = propertyStore.getPropertyDef(key)
  return def?.isBuiltIn ?? false
}

function editProperty(prop: Property, event: MouseEvent) {
  if (isBuiltIn(prop.key)) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    editorStore.showQuickPropertyEditor(
      props.blockId,
      prop.key,
      { x: rect.left, y: rect.bottom + 4 }
    )
  } else {
    editorStore.showPropertyEditor(props.blockId, prop.key)
  }
}

function deleteProperty(prop: Property, event: MouseEvent) {
  event.stopPropagation()
  propertyStore.deleteProperty(prop.id, props.blockId)
}

function getPropertyTitle(key: string): string {
  const def = propertyStore.getPropertyDef(key)
  return def?.title ?? key
}

function getIcon(key: string, value: Property['value']): string | null {
  const def = propertyStore.getPropertyDef(key)
  if (def?.closedValues) {
    const cv = def.closedValues.find(cv => cv.value === value)
    if (cv?.icon) {
      return cv.icon
    }
  }
  switch (key) {
    case 'tags':
      return '🏷️'
    case 'project':
      return '📁'
    case 'area':
      return '🌐'
    default:
      return null
  }
}

function getLabel(key: string, value: Property['value']): string {
  const def = propertyStore.getPropertyDef(key)
  if (def?.closedValues) {
    const cv = def.closedValues.find(cv => cv.value === value)
    if (cv?.label) {
      return cv.label
    }
  }
  switch (key) {
    case 'project':
    case 'area':
      return String(value)
    case 'tags':
      return Array.isArray(value) ? value.join(', ') : String(value)
    case 'boolean':
      return value ? '是' : '否'
    default:
      return String(value)
  }
}

function isSvgIcon(icon: string): boolean {
  return icon.startsWith('status-') || icon.startsWith('priority-') || icon.startsWith('icon-')
}
</script>

<template>
  <div v-if="visibleProperties.length > 0" class="property-display">
    <div class="property-list">
      <div
        v-for="prop in visibleProperties"
        :key="prop.id"
        class="property-item"
        :class="{ 'built-in': isBuiltIn(prop.key) }"
        @mouseenter="hoveredPropertyId = prop.id"
        @mouseleave="hoveredPropertyId = null"
        @click.stop="editProperty(prop, $event)"
      >
        <!-- project/area 直接以图标+名称展示，不渲染标签 -->
        <span v-if="prop.key !== 'project' && prop.key !== 'area'" class="property-key">{{ getPropertyTitle(prop.key) }}:</span>
        <span class="property-value">
          <template v-if="getIcon(prop.key, prop.value)">
            <Icon 
              v-if="isSvgIcon(getIcon(prop.key, prop.value)!)"
              :name="getIcon(prop.key, prop.value)!"
              :size="14"
            />
            <span v-else>{{ getIcon(prop.key, prop.value) }}</span>
            <span v-if="getLabel(prop.key, prop.value) && propertyStore.getPropertyDef(prop.key)?.displayStyle !== 'icon'">
              {{ getLabel(prop.key, prop.value) }}
            </span>
          </template>
          <span v-else>{{ getLabel(prop.key, prop.value) }}</span>
        </span>
        <button
          v-if="hoveredPropertyId === prop.id"
          class="delete-button"
          @click.stop="deleteProperty(prop, $event)"
          title="删除属性"
        >
          ×
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.property-display {
  margin-top: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  background-color: rgba(0, 0, 0, 0.02);
}

.property-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}

.property-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-sm);
  cursor: pointer;
  padding: 2px 4px;
  padding-right: 20px;
  border-radius: 4px;
  transition: background 120ms ease;
  position: relative;
}

.property-item:hover {
  background: var(--accent-08, rgba(59, 130, 246, 0.08));
}

.property-item.built-in .property-key {
  color: var(--primary-color, #007bff);
  font-weight: var(--font-medium);
}

.property-key {
  color: #6b7280;
}

.property-value {
  color: #374151;
}

.delete-button {
  position: absolute;
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--heading-5);
  line-height: var(--leading-none);
  color: #9ca3af;
  padding: 0 4px;
  border-radius: 4px;
  transition: color 120ms ease, background 120ms ease;
}

.delete-button:hover {
  color: #374151;
  background: rgba(0, 0, 0, 0.05);
}
</style>
