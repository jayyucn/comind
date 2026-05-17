<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePropertyStore } from '../../stores/property'
import { useEditorStore } from '../../stores/editor'
import type { Property } from '../../types/property'

const props = defineProps<{
  blockId: string
}>()

const propertyStore = usePropertyStore()
const editorStore = useEditorStore()

const visibleProperties = computed<Property[]>(() => {
  const all = propertyStore.getBlockProperties(props.blockId)
  return all.filter(prop => {
    if (prop.isHidden) return false
    const def = propertyStore.getPropertyDef(prop.key)
    return def?.displayPosition === 'bottom-of-block'
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

function renderPropertyValue(prop: Property): string {
  const def = propertyStore.getPropertyDef(prop.key)
  const style = def?.displayStyle ?? 'icon-text'

  let icon: string | null = null
  let label: string = ''

  if (def?.closedValues) {
    const cv = def.closedValues.find(cv => cv.value === prop.value)
    if (cv) {
      icon = cv.icon ?? null
      label = cv.label
    }
  }

  if (!icon) {
    switch (prop.key) {
      case 'deadline':
      case 'scheduled':
        icon = '📅'
        label = String(prop.value)
        break
      case 'tags':
        icon = '🏷️'
        label = Array.isArray(prop.value) ? prop.value.join(', ') : String(prop.value)
        break
      case 'project':
        icon = '📁'
        label = String(prop.value)
        break
      case 'area':
        icon = '🌐'
        label = String(prop.value)
        break
      case 'boolean':
        label = prop.value ? '✅' : '❌'
        break
      default:
        label = String(prop.value)
    }
  }

  if (style === 'icon' && icon) {
    return icon
  } else if (style === 'text') {
    return label
  } else {
    return icon ? `${icon} ${label}` : label
  }
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
        <span class="property-key">{{ getPropertyTitle(prop.key) }}:</span>
        <span class="property-value">{{ renderPropertyValue(prop) }}</span>
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
  font-size: 13px;
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
  font-weight: 500;
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
  font-size: 16px;
  line-height: 1;
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
