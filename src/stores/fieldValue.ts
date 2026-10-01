import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { initCoreClient } from '../wasm/client'
import type { FieldValue } from '../types/field-value'
import type { FieldDefinition, FieldType, FieldValueData } from '../types/field-definition'
import { getAllFieldDefinitions, getFieldDefinition } from '../types/field-definition'
import { useBlockStore } from './blocks'
import { useBlockCardStore } from './blockCard'
import { serializeDateRef, type DateRefKind } from '../utils/date-ref'
import { encodeFieldValueData } from '../utils/field-value-codec'
import type { RecurrenceRule } from '../utils/date-ref'
// 4.2 / S6: calculateNextRecurrence migrated to Rust
import { getCoreClient } from '../wasm/client'

import type { CoreClient } from '../wasm/client'

/** 把 Rust 返回的 string kind 收窄为 DateRefKind，未知值 fallback 'ref' */
function normalizeKind(kind: string): DateRefKind {
  if (kind === 'schedule' || kind === 'deadline' || kind === 'ref') return kind
  return 'ref'
}

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

export const useFieldValueStore = defineStore('fieldValue', () => {
  // State
  const fieldValuesByBlock = ref<Map<string, FieldValue[]>>(new Map())
  const loading = ref(false)
  // Prevent concurrent ensureTodo calls for the same block
  const ensureTodoInFlight = new Set<string>()

  // Getters
  const builtInFields = computed<FieldDefinition[]>(() => getAllFieldDefinitions())

  // Actions
  function getFieldDef(key: string): FieldDefinition | undefined {
    return getFieldDefinition(key)
  }

  function getBlockFieldValues(blockId: string): FieldValue[] {
    return fieldValuesByBlock.value.get(blockId) ?? []
  }

  function getBlockFieldValue(blockId: string, key: string): FieldValue | undefined {
    return getBlockFieldValues(blockId).find(fv => fv.key === key)
  }

  async function loadBlockFieldValues(blockId: string): Promise<FieldValue[]> {
    loading.value = true
    try {
      const client = await getClient()
      const rows = await client.getProperties(blockId)
      fieldValuesByBlock.value = new Map(fieldValuesByBlock.value.set(blockId, rows))
      return rows
    } finally {
      loading.value = false
    }
  }

  async function loadMultiBlockFieldValues(blockIds: string[]): Promise<void> {
    loading.value = true
    try {
      const client = await getClient()
      for (const blockId of blockIds) {
        const rows = await client.getProperties(blockId)
        fieldValuesByBlock.value.set(blockId, rows)
      }
      fieldValuesByBlock.value = new Map(fieldValuesByBlock.value)
    } finally {
      loading.value = false
    }
  }

  async function setFieldValue(
    blockId: string,
    key: string,
    value: FieldValueData,
    type?: FieldType
  ): Promise<FieldValue> {
    const client = await getClient()
    const fieldType = type || inferType(value)
    // codec 单源（#117）：按 type 判别（string/page 直通，其余 JSON 编码），
    // 不再按「值是否 string」——number 字段传字符串不再静默变型
    const valueJson = encodeFieldValueData(value, fieldType)

    const row = await client.setProperty(blockId, key, valueJson, fieldType)

    await loadBlockFieldValues(blockId)

    // T11: 自动推进 dateRef（Done 语义）
    if (key === 'status' && value === 'Done') {
      await advanceDateRefInBlock(blockId)
    }

    const blockCardStore = useBlockCardStore()
    blockCardStore.invalidate(blockId)

    return row
  }

  /**
   * T11: 推进 block content 中的 dateRef
   * 如果 block.content 含带 recurrence 的 dateRef，则推进日期 + 重置 status=Todo
   */
  async function advanceDateRefInBlock(blockId: string): Promise<void> {
    const blockStore = useBlockStore()
    const block = blockStore.blocks.find(b => b.id === blockId)
    if (!block || !block.content) return

    // 4.2: Use Rust DateRefService
    const client = await getClient()
    const dateRefs = await client.getDateRefsByBlock(blockId)
    const refsToAdvance = dateRefs.filter(ref => ref.recurrence && ref.recurrence !== 'none')
    if (refsToAdvance.length === 0) return

    // 推进日期
    let newContent = block.content
    for (const ref of refsToAdvance) {
      const rule: RecurrenceRule = (ref.recurrence && ref.recurrence !== 'none') ? ref.recurrence! as RecurrenceRule : 'none'
      const nextIso = await getCoreClient()!.calculateNextRecurrence(ref.iso, rule)
      const kind = normalizeKind(ref.kind)
      const oldText = serializeDateRef({ kind, iso: ref.iso, recurrence: rule, leadMinutes: ref.lead_minutes })
      const newText = serializeDateRef({ kind, iso: nextIso, recurrence: rule, leadMinutes: ref.lead_minutes })
      newContent = newContent.replace(oldText, newText)
    }

    // 更新 content
    await blockStore.updateBlockContent(blockId, newContent)

    // 重置 status 为 Todo（递归调用 setFieldValue 会再次触发 advanceDateRefInBlock，
    // 但此时 content 已无带 recurrence 的 dateRef，所以不会无限循环）
    await setFieldValue(blockId, 'status', 'Todo', 'string')
  }

  function inferType(value: FieldValueData): FieldType {
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
    if (ensureTodoInFlight.has(blockId)) return
    const existing = getBlockFieldValue(blockId, 'status')
    if (existing) return
    ensureTodoInFlight.add(blockId)
    try {
      await setFieldValue(blockId, 'status', 'Todo', 'string')
    } finally {
      ensureTodoInFlight.delete(blockId)
    }
  }

  async function deleteFieldValue(id: string, blockId: string): Promise<void> {
    const client = await getClient()
    const rows = getBlockFieldValues(blockId)
    const row = rows.find(r => r.id === id)
    if (row) {
      await client.deleteProperty(blockId, row.key)
    }
    await loadBlockFieldValues(blockId)
  }

  async function clearBlockCache(blockId: string): Promise<void> {
    fieldValuesByBlock.value.delete(blockId)
  }

  return {
    fieldValuesByBlock,
    loading,
    builtInFields,
    getFieldDef,
    getBlockFieldValues,
    getBlockFieldValue,
    loadBlockFieldValues,
    loadMultiBlockFieldValues,
    setFieldValue,
    ensureTodo,
    deleteFieldValue,
    clearBlockCache,
    advanceDateRefInBlock
  }
})
