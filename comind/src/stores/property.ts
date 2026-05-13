import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { propertyService } from '../services/property'
import type { Property, PropertyDefinition, PropertyValue, PropertyType } from '../types/property'
import { getAllPropertyDefinitions, getPropertyDefinition } from '../types/property'

export const usePropertyStore = defineStore('property', () => {
  // State
  const propertiesByBlock = ref<Map<string, Property[]>>(new Map())
  const loading = ref(false)

  // Getters
  const builtInProperties = computed<PropertyDefinition[]>(() => getAllPropertyDefinitions())

  // Actions
  function getPropertyDef(key: string): PropertyDefinition | undefined {
    return getPropertyDefinition(key)
  }

  function getBlockProperties(blockId: string): Property[] {
    return propertiesByBlock.value.get(blockId) ?? []
  }

  function getBlockProperty(blockId: string, key: string): Property | undefined {
    return getBlockProperties(blockId).find(p => p.key === key)
  }

  async function loadBlockProperties(blockId: string): Promise<Property[]> {
    loading.value = true
    try {
      const props = await propertyService.getProperties(blockId)
      propertiesByBlock.value.set(blockId, props)
      return props
    } finally {
      loading.value = false
    }
  }

  async function loadMultiBlockProperties(blockIds: string[]): Promise<void> {
    loading.value = true
    try {
      const map = await propertyService.getPropertiesByBlockIds(blockIds)
      for (const [blockId, props] of map.entries()) {
        propertiesByBlock.value.set(blockId, props)
      }
    } finally {
      loading.value = false
    }
  }

  async function setProperty(
    blockId: string,
    key: string,
    value: PropertyValue,
    type?: PropertyType
  ): Promise<Property> {
    const prop = await propertyService.setProperty(blockId, key, value, type)
    // Refresh the block's properties
    await loadBlockProperties(blockId)
    return prop
  }

  async function deleteProperty(id: string, blockId: string): Promise<void> {
    await propertyService.deleteProperty(id)
    await loadBlockProperties(blockId)
  }

  async function updateSortOrder(blockId: string, sortedIds: string[]): Promise<void> {
    await propertyService.updateSortOrder(blockId, sortedIds)
    await loadBlockProperties(blockId)
  }

  async function toggleHidden(id: string, blockId: string): Promise<Property> {
    const prop = await propertyService.toggleHidden(id)
    await loadBlockProperties(blockId)
    return prop
  }

  async function clearBlockCache(blockId: string): Promise<void> {
    propertiesByBlock.value.delete(blockId)
  }

  return {
    propertiesByBlock,
    loading,
    builtInProperties,
    getPropertyDef,
    getBlockProperties,
    getBlockProperty,
    loadBlockProperties,
    loadMultiBlockProperties,
    setProperty,
    deleteProperty,
    updateSortOrder,
    toggleHidden,
    clearBlockCache
  }
})
