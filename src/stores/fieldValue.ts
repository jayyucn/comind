import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { initCoreClient } from '../wasm/client'
import type { FieldValue } from '../types/field-value'
import type { FieldDefinition, FieldType, FieldValueData } from '../types/field-definition'
import { getAllFieldDefinitions, getFieldDefinition } from '../types/field-definition'
import { useBlockStore } from './blocks'
import { useBlockCardStore } from './blockCard'
import { useTagsStore } from './tags'
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
      const rows = await client.getFieldValues(blockId)
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
        const rows = await client.getFieldValues(blockId)
        fieldValuesByBlock.value.set(blockId, rows)
      }
      fieldValuesByBlock.value = new Map(fieldValuesByBlock.value)
    } finally {
      loading.value = false
    }
  }

  /**
   * 把单行写入结果就地合并进缓存（取代写入后全量重拉 getFieldValues）：
   * key 命中即替换，否则追加。缓存为源（所有写路径经本 store 收口），无需回读。
   */
  function mergeFieldValueRow(blockId: string, row: FieldValue) {
    const rows = fieldValuesByBlock.value.get(blockId)
    if (!rows) {
      fieldValuesByBlock.value = new Map(fieldValuesByBlock.value.set(blockId, [row]))
      return
    }
    const idx = rows.findIndex(r => r.key === row.key)
    fieldValuesByBlock.value.set(blockId, idx >= 0 ? rows.map((r, i) => (i === idx ? row : r)) : [...rows, row])
    fieldValuesByBlock.value = new Map(fieldValuesByBlock.value)
  }

  async function setFieldValue(
    blockId: string,
    key: string,
    value: FieldValueData,
    type?: FieldType
  ): Promise<FieldValue> {
    const client = await getClient()
    const fieldType = type || inferType(value)
    // 块首次成为任务（status 由无到有）——写入前先记状态，供下方补默认 priority。
    // seed 里 priority 的 defaultValue 只覆盖「打任务标签后由 Rust 自动填默认」这一路径；
    // /todo、/status 快速编辑器、/schedule、/deadline 等直接写 status 的路径不经打标，
    // 故在 status 写入收口处统一补齐（与下方 Done→advanceDateRef 同属 status 驱动的副作用）。
    const becomesTask = key === 'status' && !!value && !getBlockFieldValue(blockId, 'status')
    // codec 单源（#117）：按 type 判别（string/page 直通，其余 JSON 编码），
    // 不再按「值是否 string」——number 字段传字符串不再静默变型
    const valueJson = encodeFieldValueData(value, fieldType)

    const row = await client.setFieldValue(blockId, key, valueJson, fieldType)

    // 就地合并（唯一一趟往返）：回显不再等第二次全量重拉
    mergeFieldValueRow(blockId, row)

    // T11: 自动推进 dateRef（Done 语义）
    if (key === 'status' && value === 'Done') {
      await advanceDateRefInBlock(blockId)
    }

    // 创建任务默认带 priority=Low（与 seed 默认值同值，单点兜底全部 status 写入路径）。
    // 幂等：仅在该块尚无 priority 时补，绝不覆盖用户手写值。
    if (becomesTask && !getBlockFieldValue(blockId, 'priority')) {
      await setFieldValue(blockId, 'priority', 'Low', 'string')
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
   * 确保系统任务 tag 已挂载（ADR-0050 D2 原子意图的挂载前置）。
   *
   * 挂载 = content 含 `#任务` 文本（Rust 保存时从 content 派生 `Block.tags`，打标唯一入口）。
   * 已挂载（tags 缓存命中，或 content 文本已含字面——防缓存滞后重复插入）→ 不动 content。
   * 返回值：`'mounted'` 已挂载 / `'degraded'` 标签树无系统任务 tag（未 seed，降级直写）/
   * `'missing'` 块不存在（中止，不写值）。
   */
  async function ensureTaskTagMounted(blockId: string): Promise<'mounted' | 'degraded' | 'missing'> {
    const blockStore = useBlockStore()
    const tagsStore = useTagsStore()
    await tagsStore.ensureLoaded()
    const taskTagId = blockStore.systemTaskTagId()
    if (!taskTagId) return 'degraded'
    const block = blockStore.getBlock(blockId)
    if (!block) return 'missing'
    if (block.tags?.includes(taskTagId)) return 'mounted'
    const tag = tagsStore.getTagById(taskTagId)
    if (!tag) return 'degraded'
    const literal = `#${tag.title}`
    if ((block.content ?? '').includes(literal)) return 'mounted'
    const next = block.content ? `${block.content} ${literal}` : literal
    await blockStore.updateBlockContent(blockId, next)
    // 强制落库：tags 由 Rust 在 save_block_tree 时从 content 派生，先于 status 写入完成挂载
    await blockStore.flushSave(blockId)
    return 'mounted'
  }

  /**
   * 自动将 block 标记为 Todo 任务：仅当 block 尚未有任何 status
   * （Todo/Doing/Done/Canceled）时才补一个 Todo。
   *
   * 用于：为带 schedule/deadline 的 block 自动成为任务。
   * 注意：不会因移除 dateRef 而清除 status（保持任务状态，见需求约束）。
   * 经 setFieldValue 写入收口，故「首次成为任务」时也会一并补默认 priority=Low（见该方法）。
   *
   * D2（ADR-0050）原子意图：先确保系统任务 tag 挂载，再写 status——挂载失败（块缺失）
   * 不写值，避免「有值无挂载」的半态；D4 过滤按 tags 后，未挂载的块不会出现在任务列表。
   * 标签树无系统任务 tag 时降级为旧口径（直接写 status）。
   */
  async function ensureTodo(blockId: string): Promise<void> {
    if (ensureTodoInFlight.has(blockId)) return
    const existing = getBlockFieldValue(blockId, 'status')
    if (existing) return
    ensureTodoInFlight.add(blockId)
    try {
      const mounted = await ensureTaskTagMounted(blockId)
      if (mounted === 'missing') return
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
      await client.deleteFieldValue(blockId, row.key)
      // 就地移除（取代全量重拉）：回显不再等第二次往返
      fieldValuesByBlock.value.set(blockId, rows.filter(r => r.id !== id))
      fieldValuesByBlock.value = new Map(fieldValuesByBlock.value)
    }
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
