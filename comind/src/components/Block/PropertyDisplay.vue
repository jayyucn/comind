<script setup lang="ts">
import { computed } from 'vue'
import { usePropertyStore } from '../../stores/property'
import { useEditorStore } from '../../stores/editor'
import type { Property } from '../../types/property'

interface Props {
  blockId: string
}

const props = defineProps<Props>()
const propertyStore = usePropertyStore()
const editorStore = useEditorStore()

const visibleProperties = computed<Property[]>(() => {
  const all = propertyStore.getBlockProperties(props.blockId)
  return all.filter(prop => !prop.isHidden && (propertyStore.getPropertyDef(prop.key)?.displayPosition === 'bottom-of-block'))
})

function isBuiltIn(key: string): boolean {
  const def = propertyStore.getPropertyDef(key)
  return def?.isBuiltIn ?? false
}

function editProperty(key: string) {
  editorStore.showPropertyEditor(props.blockId, key)
}

function getPropertyTitle(key: string): string {
  const def = propertyStore.getPropertyDef(key)
  return def?.title ?? key
}

function renderPropertyValue(prop: Property): string {
  const def = propertyStore.getPropertyDef(prop.key)
  const style = def?.displayStyle || 'icon-text'
  
  let icon: string | null = null
  let label: string = ''
  
  if (def?.closedValues) {
    const cv = def.closedValues.find(cv => cv.value === prop.value)
    if (cv) {
      icon = cv.icon || null
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
        @click.stop="editProperty(prop.key)"
      >
        <span class="property-key">{{ getPropertyTitle(prop.key) }}:</span>
        <span class="property-value">{{ renderPropertyValue(prop) }}</span>
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
  border-radius: 4px;
  transition: background 120ms ease;
}

.property-item:hover {
  background: var(--accent-08);
}

.property-item.built-in .property-key {
  color: var(--primary-color, #007bff);
  font-weight: 500;
}

.property-key {
  color: #666;
}

.property-value {
  color: #333;
}
</style>
