<script setup lang="ts">
import { computed } from 'vue'
import { usePropertyStore } from '../../stores/property'
import { useEditorStore } from '../../stores/editor'
import type { Property } from '../../types/property'

interface Props {
  blockId: string
  position: 'between-bullet-content' | 'right-of-content'
}

const props = defineProps<Props>()
const propertyStore = usePropertyStore()
const editorStore = useEditorStore()

const properties = computed<Property[]>(() => {
  const all = propertyStore.getBlockProperties(props.blockId)
  return all.filter(prop => !prop.isHidden && (propertyStore.getPropertyDef(prop.key)?.displayPosition === props.position))
})

function getIcon(key: string, value: Property['value']): string | null {
  const def = propertyStore.getPropertyDef(key)
  if (def?.closedValues) {
    const cv = def.closedValues.find(cv => cv.value === value)
    if (cv?.icon) {
      return cv.icon
    }
  }
  switch (key) {
    case 'deadline':
    case 'scheduled':
      return '📅'
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
    case 'deadline':
    case 'scheduled':
    case 'project':
    case 'area':
      return String(value)
    case 'tags':
      return Array.isArray(value) ? value.join(', ') : String(value)
    default:
      return String(value)
  }
}

function editProperty(key: string) {
  editorStore.showPropertyEditor(props.blockId, key)
}
</script>

<template>
  <div class="property-inline">
    <div
      v-for="prop in properties"
      :key="prop.id"
      class="property-inline-item"
      @click.stop="editProperty(prop.key)"
    >
      <template v-if="getIcon(prop.key, prop.value) as string">
        <span class="property-icon">
          {{ getIcon(prop.key, prop.value) as string }}
        </span>
        <span v-if="propertyStore.getPropertyDef(prop.key)?.displayStyle !== 'icon'" class="property-label">
          {{ getLabel(prop.key, prop.value) }}
        </span>
      </template>
      <template v-else>
        <span>{{ getLabel(prop.key, prop.value) }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.property-inline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.property-inline-item {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 120ms ease;
  font-size: 14px;
}

.property-inline-item:hover {
  background: var(--accent-08, rgba(0, 128, 255, 0.08));
}

.property-icon {
  margin-right: 4px;
}
</style>
