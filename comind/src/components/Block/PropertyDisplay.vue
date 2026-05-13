<script setup lang="ts">
import { computed } from 'vue'
import { usePropertyStore } from '../../stores/property'
import type { Property } from '../../types/property'

interface Props {
  blockId: string
}

const props = defineProps<Props>()
const propertyStore = usePropertyStore()

const allProperties = computed<Property[]>(() => 
  propertyStore.getBlockProperties(props.blockId)
)

const visibleProperties = computed<Property[]>(() => 
  allProperties.value.filter(p => !p.isHidden)
)

function isBuiltIn(key: string): boolean {
  const def = propertyStore.getPropertyDef(key)
  return def?.isBuiltIn ?? false
}

function getPropertyTitle(key: string): string {
  const def = propertyStore.getPropertyDef(key)
  return def?.title ?? key
}

function renderPropertyValue(property: Property): string {
  const def = propertyStore.getPropertyDef(property.key)
  
  if (def?.closedValues) {
    const closedValue = def.closedValues.find(cv => cv.value === property.value)
    if (closedValue) {
      return closedValue.icon ? `${closedValue.icon} ${closedValue.label}` : closedValue.label
    }
  }

  switch (property.type) {
    case 'boolean':
      return property.value ? '✅' : '❌'
    case 'array':
      return Array.isArray(property.value) ? property.value.join(', ') : String(property.value)
    default:
      return String(property.value)
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
