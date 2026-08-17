import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Condition, ConditionValue, SortRule, ViewQuery } from '../core/query'
import { defaultLayoutConfig } from '../core/view'
import type { CoreClient } from '../wasm/client'
import { initCoreClient } from '../wasm/client'
import type { ScreenViewRust } from '../wasm/types'

/** 空查询（无筛选/排序/分组）。 */
export const EMPTY_VIEW_QUERY: ViewQuery = {
  version: 1,
  filter: { combinator: 'and', children: [] },
  sort: [],
  groupBy: null,
}

/**
 * 旧 BlockQuery 遗留形状（迁移用，不进入运行时类型；旧 useBlockQuery 已删除）。
 * 仅用于把存量视图 JSON 重映射到新 ViewQuery。
 */
type LegacyBlockField =
  | { kind: 'property'; key: string }
  | { kind: 'content' }
  | { kind: 'dateRef'; ref: 'kind' | 'date' }
interface LegacyBlockQuery {
  filters: { field: LegacyBlockField; op: string; value: unknown }[]
  sort: { field: LegacyBlockField; dir: 'asc' | 'desc' }[]
  groupBy: string | null
}

/** 旧 BlockQuery 字段 → 新引擎字段 key（content/dateRef 映射到注册表字段）。 */
function blockFieldToKey(f: LegacyBlockField): string {
  if (f.kind === 'property') return f.key
  if (f.kind === 'content') return 'content'
  return f.ref === 'kind' ? 'dateRefKind' : 'dateRefDate'
}

/** 存量旧 BlockQuery → 新 ViewQuery（字段形状重映射；op 均被新引擎支持，无需丢弃）。 */
export function blockQueryToViewQuery(bq: LegacyBlockQuery): ViewQuery {
  const children: Condition[] = bq.filters 
    .map((c) => ({ field: blockFieldToKey(c.field), op: c.op as Condition['op'], value: c.value as ConditionValue }))
    .filter((c) => c.field)
  const sort: SortRule[] = bq.sort.map((s) => ({ field: blockFieldToKey(s.field), dir: s.dir }))
  return {
    version: 1,
    filter: { combinator: 'and', children },
    sort,
    groupBy: bq.groupBy,
  }
}

/**
 * 解析视图存储的 query_json：
 * - 新格式（version===1）→ 直接用；
 * - 旧格式（顶层 filters）→ blockQueryToViewQuery 迁移；
 * - 损坏/空 → EMPTY_VIEW_QUERY。
 */
export function parseViewQuery(json: string | undefined | null): ViewQuery {
  if (!json) return EMPTY_VIEW_QUERY
  try {
    const obj = JSON.parse(json)
    if (obj && obj.version === 1 && obj.filter) return obj as ViewQuery
    if (obj && Array.isArray(obj.filters)) return blockQueryToViewQuery(obj as LegacyBlockQuery)
  } catch {
    /* 解析失败回退空查询 */
  }
  return EMPTY_VIEW_QUERY
}

let coreClientPromise: Promise<CoreClient> | null = null

async function getClient(): Promise<CoreClient> {
  if (!coreClientPromise) {
    coreClientPromise = initCoreClient()
  }
  const client = await coreClientPromise
  if (!client) throw new Error('Core client not initialized')
  return client
}

export const useScreenViewStore = defineStore('screenView', () => {
  const views = ref<ScreenViewRust[]>([])
  const currentViewId = ref<string | null>(null)
  const loading = ref(false)

  async function load(): Promise<ScreenViewRust[]> {
    loading.value = true
    try {
      const client = await getClient()
      views.value = await client.getScreenViews()

      // Auto-create default "全部任务" view if none exist
      if (views.value.length === 0) {
        const defaultQuery: ViewQuery = {
          version: 1,
          filter: { combinator: 'and', children: [] },
          sort: [],
          groupBy: null,
        }
        const view = await client.saveScreenView(
          '全部任务',
          JSON.stringify(defaultQuery),
          'table',
          '',
          JSON.stringify(defaultLayoutConfig('table'))
        )
        views.value.push(view)
        try {
          const updated = await client.setDefaultScreenView(view.id)
          const idx = views.value.findIndex(v => v.id === view.id)
          if (idx !== -1) {
            views.value[idx] = updated
          }
        } catch {
          // setDefault may fail silently in WASM
        }
      }

      // Set initial currentViewId to default view
      if (!currentViewId.value) {
        const defaultView = views.value.find(v => v.is_default === 1)
        if (defaultView) {
          currentViewId.value = defaultView.id
        } else if (views.value.length > 0) {
          currentViewId.value = views.value[0].id
        }
      }

      return views.value
    } finally {
      loading.value = false
    }
  }

  async function save(name: string, queryJson: string, viewType: string, groupBy: string, config: string): Promise<ScreenViewRust> {
    const client = await getClient()
    const view = await client.saveScreenView(name, queryJson, viewType, groupBy, config)
    views.value.push(view)
    return view
  }

  async function update(id: string, name: string, queryJson: string, viewType: string, groupBy: string, isDefault: boolean, sortOrder: number, config: string): Promise<ScreenViewRust> {
    const client = await getClient()
    const view = await client.updateScreenView(id, name, queryJson, viewType, groupBy, isDefault, sortOrder, config)
    const idx = views.value.findIndex(v => v.id === id)
    if (idx !== -1) {
      views.value[idx] = view
    }
    return view
  }

  async function remove(id: string): Promise<void> {
    const client = await getClient()
    await client.deleteScreenView(id)
    views.value = views.value.filter(v => v.id !== id)
    if (currentViewId.value === id) {
      currentViewId.value = views.value.length > 0 ? views.value[0].id : null
    }
  }

  async function setDefault(id: string): Promise<ScreenViewRust> {
    const client = await getClient()
    const view = await client.setDefaultScreenView(id)
    // Update all views — only one should be default
    views.value = views.value.map(v => ({
      ...v,
      is_default: v.id === id ? 1 : 0,
    }))
    const idx = views.value.findIndex(v => v.id === id)
    if (idx !== -1) {
      views.value[idx] = view
    }
    return view
  }

  return {
    views,
    currentViewId,
    loading,
    load,
    save,
    update,
    remove,
    setDefault,
  }
})
