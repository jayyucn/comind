/**
 * 持久化适配 —— 把无头查询引擎的 ViewQuery 接到现有 savedFilter 的 WASM 持久化通道。
 *
 * 设计要点（对应 issue #23）：
 * - 引擎只产出 ViewQuery（domain 模型），本 store 负责把它经 serializeQuery 序列化为
 *   JSON 字符串，复用现有 useSavedFilterStore 的 load/save/update/remove 写入 WASM；
 *   加载时再经 parseQuery 还原。后端零改动——saved_filters 表本就只存不透明 query_json。
 * - 同一张表此前已被旧的 TaskFilterBar（BlockQuery 形状：{filters,sort,groupBy}）写入过
 *   遗留数据。load() 会跳过这些「无 version 且有顶层 filters 数组」的旧行，避免通用 UI
 *   出现空壳条目；遗留行仍归旧 UI 使用，互不干扰。
 * - 实体作用域（entityType）由上层适配器（#24/#25）决定，本层保持 entityType 无关。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useSavedFilterStore } from './savedFilter'
import { serializeQuery, parseQuery, type ViewQuery } from '../core/query'
import type { SavedFilterRust } from '../wasm/types'

/** 已持久化的 ViewQuery：从 saved_filters 行解析而来。 */
export interface SavedViewQuery {
  id: string
  name: string
  query: ViewQuery
  createdAt: number
  updatedAt: number
}

/** 判断一行 query_json 是否为旧的 BlockQuery 遗留数据（无 version 且有顶层 filters 数组）。 */
function isLegacySavedFilter(json: string): boolean {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>
    return Array.isArray(obj.filters) && obj.version === undefined
  } catch {
    return false
  }
}

/** 把 saved_filters 行解码为 SavedViewQuery；遗留行返回 null（由 load 过滤）。 */
function decodeSavedFilter(f: SavedFilterRust): SavedViewQuery | null {
  if (isLegacySavedFilter(f.query_json)) return null
  return {
    id: f.id,
    name: f.name,
    query: parseQuery(f.query_json),
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  }
}

export const useQueryFilterStore = defineStore('queryFilter', () => {
  const saved = useSavedFilterStore()
  const filters = ref<SavedViewQuery[]>([])
  const loading = ref(false)

  /** 从 WASM 加载全部已保存的 ViewQuery（跳过旧 BlockQuery 遗留行）。 */
  async function load(): Promise<SavedViewQuery[]> {
    loading.value = true
    try {
      const raw = await saved.load()
      filters.value = raw
        .map(decodeSavedFilter)
        .filter((f): f is SavedViewQuery => f !== null)
      return filters.value
    } finally {
      loading.value = false
    }
  }

  /** 保存一个 ViewQuery：序列化为 JSON 后经现有 savedFilter store 落库。 */
  async function save(name: string, query: ViewQuery): Promise<SavedViewQuery> {
    const raw = await saved.save(name, serializeQuery(query))
    const decoded = decodeSavedFilter(raw)
    if (decoded) filters.value.push(decoded)
    // 我们写入的始终是 version:1 的 ViewQuery，decode 不会为 null
    return decoded as SavedViewQuery
  }

  /** 更新已保存的 ViewQuery：序列化后委托现有 savedFilter store。 */
  async function update(id: string, name: string, query: ViewQuery): Promise<SavedViewQuery> {
    const raw = await saved.update(id, name, serializeQuery(query))
    const decoded = decodeSavedFilter(raw)
    if (decoded) {
      const idx = filters.value.findIndex((f) => f.id === id)
      if (idx !== -1) filters.value[idx] = decoded
    }
    return decoded as SavedViewQuery
  }

  /** 删除已保存的 ViewQuery：委托现有 savedFilter store 并从本地列表移除。 */
  async function remove(id: string): Promise<void> {
    await saved.remove(id)
    filters.value = filters.value.filter((f) => f.id !== id)
  }

  return { filters, loading, load, save, update, remove }
})
