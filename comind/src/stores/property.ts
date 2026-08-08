import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { initCoreClient } from '../wasm/client'
import type { Property, PropertyDefinition, PropertyValue, PropertyType } from '../types/property'
import { getAllPropertyDefinitions, getPropertyDefinition } from '../types/property'
import { useBlockStore } from './blocks'
import { useBlockCardStore } from './blockCard'
import { parseDateRefs, serializeDateRef } from '../utils/date-ref'
import { calculateNextRecurrence } from '../utils/recurrence'

import type { CoreClient } from '../wasm/client'

let coreClientPromise: Promise<CoreClient> | null = null

function safeParseJson(value: string): any {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

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
        value: safeParseJson(rustProp.value),
        type: rustProp.type as PropertyType,
        sortOrder: rustProp.sort_order,
        isHidden: rustProp.is_hidden === 1,
        isDeleted: rustProp.is_deleted === 1,
        schemaVersion: rustProp.schema_version,
        createdAt: rustProp.created_at,
        updatedAt: rustProp.updated_at
      }))
      
      propertiesByBlock.value = new Map(propertiesByBlock.value.set(blockId, props))
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
          value: safeParseJson(rustProp.value),
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
      propertiesByBlock.value = new Map(propertiesByBlock.value)
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
    
    // 反序列化：string/page 类型 Rust 直接返回字符串，无需 JSON.parse
    // number/boolean/date/array 类型 Rust 返回 JSON 编码字符串，需要解析
    const parsedType = rustProp.type as PropertyType
    const isPlainStringType = parsedType === 'string' || parsedType === 'page'
    const parsedValue: PropertyValue = isPlainStringType
      ? rustProp.value
      : JSON.parse(rustProp.value)

    const prop: Property = {
      id: rustProp.id,
      blockId: rustProp.block_id,
      key: rustProp.key,
      value: parsedValue,
      type: parsedType,
      sortOrder: rustProp.sort_order,
      isHidden: rustProp.is_hidden === 1,
      isDeleted: rustProp.is_deleted === 1,
      schemaVersion: rustProp.schema_version,
      createdAt: rustProp.created_at,
      updatedAt: rustProp.updated_at
    }
    
    await loadBlockProperties(blockId)
    
    // T11: 自动推进 dateRef（Done 语义）
    if (key === 'status' && value === 'Done') {
      await advanceDateRefInBlock(blockId)
    }
    
    const blockCardStore = useBlockCardStore()
    blockCardStore.invalidate(blockId)
    
    return prop
  }

  /**
   * T11: 推进 block content 中的 dateRef
   * 如果 block.content 含带 recurrence 的 dateRef，则推进日期 + 重置 status=Todo
   */
  async function advanceDateRefInBlock(blockId: string): Promise<void> {
    const blockStore = useBlockStore()
    const block = blockStore.blocks.find(b => b.id === blockId)
    if (!block || !block.content) return
    
    const refs = parseDateRefs(block.content)
    const refsToAdvance = refs.filter(ref => ref.recurrence && ref.recurrence !== 'none')
    if (refsToAdvance.length === 0) return
    
    // 推进日期
    let newContent = block.content
    for (const ref of refsToAdvance) {
      const nextIso = calculateNextRecurrence(ref.iso, ref.recurrence!)
      const oldText = serializeDateRef(ref)
      const newText = serializeDateRef({ kind: ref.kind, iso: nextIso, recurrence: ref.recurrence, leadMinutes: ref.leadMinutes })
      newContent = newContent.replace(oldText, newText)
    }
    
    // 更新 content
    await blockStore.updateBlockContent(blockId, newContent)
    
    // 重置 status 为 Todo（递归调用 setProperty 会再次触发 advanceDateRefInBlock，
    // 但此时 content 已无带 recurrence 的 dateRef，所以不会无限循环）
    await setProperty(blockId, 'status', 'Todo', 'string')
  }

  function inferType(value: PropertyValue): PropertyType {
    if (typeof value === 'boolean') return 'boolean'
    if (typeof value === 'number') return 'number'
    if (value instanceof Date) return 'date'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'object') return 'page'
    return 'string'
  }

  /**
   * 自动将 block 标记为 Todo 任务：仅当 block 尚未有任何 status
   * （Todo/Doing/Done/Canceled）时才补一个 Todo。
   *
   * 用于：为带 schedule/deadline 的 block 自动成为任务。
   * 注意：不会因移除 dateRef 而清除 status（保持任务状态，见需求约束）。
   */
  async function ensureTodo(blockId: string): Promise<void> {
    const existing = getBlockProperty(blockId, 'status')
    if (existing) return
    await setProperty(blockId, 'status', 'Todo', 'string')
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
    ensureTodo,
    deleteProperty,
    updateSortOrder,
    toggleHidden,
    clearBlockCache,
    advanceDateRefInBlock
  }
})
