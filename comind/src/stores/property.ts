import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { initCoreClient } from '../wasm/client'
import type { Property, PropertyDefinition, PropertyValue, PropertyType } from '../types/property'
import { getAllPropertyDefinitions, getPropertyDefinition } from '../types/property'

import type { CoreClient } from '../wasm/client'

let coreClientPromise: Promise<CoreClient> | null = null

async function getClient() {
  if (!coreClientPromise) {
    coreClientPromise = initCoreClient()
  }
  const client = await coreClientPromise
  if (!client) {
    throw new Error('Core client not initialized')
  }
  return client
}

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
      const client = await getClient()
      const rustProps = await client.getProperties(blockId)
      
      const props: Property[] = rustProps.map(rustProp => ({
        id: rustProp.id,
        blockId: rustProp.block_id,
        key: rustProp.key,
        value: JSON.parse(rustProp.value),
        type: rustProp.type as PropertyType,
        sortOrder: rustProp.sort_order,
        isHidden: rustProp.is_hidden === 1,
        isDeleted: rustProp.is_deleted === 1,
        schemaVersion: rustProp.schema_version,
        createdAt: rustProp.created_at,
        updatedAt: rustProp.updated_at
      }))
      
      propertiesByBlock.value.set(blockId, props)
      return props
    } finally {
      loading.value = false
    }
  }

  async function loadMultiBlockProperties(blockIds: string[]): Promise<void> {
    loading.value = true
    try {
      const client = await getClient()
      for (const blockId of blockIds) {
        const rustProps = await client.getProperties(blockId)
        const props: Property[] = rustProps.map(rustProp => ({
          id: rustProp.id,
          blockId: rustProp.block_id,
          key: rustProp.key,
          value: JSON.parse(rustProp.value),
          type: rustProp.type as PropertyType,
          sortOrder: rustProp.sort_order,
          isHidden: rustProp.is_hidden === 1,
          isDeleted: rustProp.is_deleted === 1,
          schemaVersion: rustProp.schema_version,
          createdAt: rustProp.created_at,
          updatedAt: rustProp.updated_at
        }))
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
    const client = await getClient()
    const valueStr = typeof value === 'string' ? value : JSON.stringify(value)
    const propType = type || inferType(value)
    
    const rustProp = await client.setProperty(blockId, key, valueStr, propType)
    
    const prop: Property = {
      id: rustProp.id,
      blockId: rustProp.block_id,
      key: rustProp.key,
      value: JSON.parse(rustProp.value),
      type: rustProp.type as PropertyType,
      sortOrder: rustProp.sort_order,
      isHidden: rustProp.is_hidden === 1,
      isDeleted: rustProp.is_deleted === 1,
      schemaVersion: rustProp.schema_version,
      createdAt: rustProp.created_at,
      updatedAt: rustProp.updated_at
    }
    
    await loadBlockProperties(blockId)
    return prop
  }

  function inferType(value: PropertyValue): PropertyType {
    if (typeof value === 'boolean') return 'boolean'
    if (typeof value === 'number') return 'number'
    if (value instanceof Date) return 'date'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'object') return 'page'
    return 'string'
  }

  async function deleteProperty(id: string, blockId: string): Promise<void> {
    const client = await getClient()
    const props = getBlockProperties(blockId)
    const prop = props.find(p => p.id === id)
    if (prop) {
      await client.deleteProperty(blockId, prop.key)
    }
    await loadBlockProperties(blockId)
  }

  async function updateSortOrder(blockId: string, _sortedIds: string[]): Promise<void> {
    await loadBlockProperties(blockId)
  }

  async function toggleHidden(id: string, blockId: string): Promise<Property> {
    const props = getBlockProperties(blockId)
    const prop = props.find(p => p.id === id)
    if (prop) {
      const client = await getClient()
      const valueStr = typeof prop.value === 'string' ? prop.value : JSON.stringify(prop.value)
      await client.setProperty(blockId, prop.key, valueStr, prop.type)
    }
    await loadBlockProperties(blockId)
    return getBlockProperty(blockId, props.find(p => p.id === id)?.key || '')!
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
