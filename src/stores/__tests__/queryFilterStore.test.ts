import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createRegistry, type FieldDescriptor, type ViewQuery } from '../../core/query'
import type { SavedFilterRust } from '../../wasm/types'
import { useQueryFilterStore } from '../queryFilterStore'

// 用一个假的 CoreClient 替换真实的 WASM 客户端，避免测试加载 WASM 二进制。
// saved_filters 表用内存数组模拟；save/update/delete 直接操作该数组。
const h = vi.hoisted(() => {
  const table: SavedFilterRust[] = []
  const make = (id: string, name: string, json: string): SavedFilterRust => ({
    id,
    name,
    query_json: json,
    created_at: 1,
    updated_at: 1,
  })
  return {
    table,
    fakeClient: {
      getSavedFilters: vi.fn(async () => table),
      saveSavedFilter: vi.fn(async (name: string, json: string) => {
        const f = make(`sf-${table.length + 1}`, name, json)
        table.push(f)
        return f
      }),
      updateSavedFilter: vi.fn(async (id: string, name: string, json: string) => {
        const f = table.find((x) => x.id === id)
        if (!f) throw new Error(`not found: ${id}`)
        f.name = name
        f.query_json = json
        f.updated_at = 2
        return f
      }),
      deleteSavedFilter: vi.fn(async (id: string) => {
        const i = table.findIndex((x) => x.id === id)
        if (i >= 0) table.splice(i, 1)
      }),
    },
  }
})

vi.mock('../../wasm/client', () => ({
  initCoreClient: async () => h.fakeClient,
}))

function statusField(): FieldDescriptor<string> {
  return {
    key: 'status',
    label: '状态',
    type: 'select',
    options: [
      { id: 'todo', label: '待办' },
      { id: 'done', label: '完成' },
    ],
    get: (item: unknown) => (item as { status: string }).status,
  }
}

function sampleQuery(): ViewQuery {
  return {
    version: 1,
    filter: {
      combinator: 'and',
      children: [{ field: 'status', op: 'is', value: { kind: 'literal', value: 'done' } }],
    },
    sort: [],
    groupBy: null,
  }
}

const items: { id: string; status: string }[] = [
  { id: 'a', status: 'done' },
  { id: 'b', status: 'todo' },
  { id: 'c', status: 'done' },
]

beforeEach(() => {
  setActivePinia(createPinia())
  h.table.length = 0
  h.fakeClient.getSavedFilters.mockClear()
  h.fakeClient.saveSavedFilter.mockClear()
  h.fakeClient.updateSavedFilter.mockClear()
  h.fakeClient.deleteSavedFilter.mockClear()
})

describe('queryFilterStore', () => {
  it('save(): 序列化 ViewQuery 并经 savedFilter store 落库', async () => {
    const store = useQueryFilterStore()
    const q = sampleQuery()
    const saved = await store.save('已完成', q)

    // 落库调用了底层 saveSavedFilter，且传入的是序列化后的 JSON
    expect(h.fakeClient.saveSavedFilter).toHaveBeenCalledTimes(1)
    expect(h.fakeClient.saveSavedFilter).toHaveBeenCalledWith('已完成', JSON.stringify({ ...q, version: 1 }))
    // 返回对象可还原为等效 ViewQuery
    expect(saved.name).toBe('已完成')
    expect(saved.query).toEqual(q)
    // 本地列表已包含
    expect(store.filters).toHaveLength(1)
  })

  it('load(): 解析已保存的 ViewQuery，并跳过旧 BlockQuery 遗留行', async () => {
    // 新 ViewQuery 行
    h.table.push({
      id: 'new-1',
      name: '新查询',
      query_json: JSON.stringify({ version: 1, filter: { combinator: 'and', children: [] }, sort: [], groupBy: null }),
      created_at: 10,
      updated_at: 10,
    })
    // 旧 BlockQuery 遗留行（无 version、顶层 filters）
    h.table.push({
      id: 'legacy-1',
      name: '旧规则',
      query_json: JSON.stringify({ filters: [{ field: 'status', op: 'is', value: 'todo' }], sort: [], groupBy: null }),
      created_at: 5,
      updated_at: 5,
    })

    const store = useQueryFilterStore()
    const list = await store.load()

    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('new-1')
    expect(list[0].query.version).toBe(1)
    expect(store.filters).toHaveLength(1)
  })

  it('update(): 委托 savedFilter.update 并写入序列化后的查询', async () => {
    const store = useQueryFilterStore()
    const saved = await store.save('原名', sampleQuery())

    const updatedQuery: ViewQuery = {
      version: 1,
      filter: { combinator: 'or', children: [{ field: 'status', op: 'isNot', value: { kind: 'literal', value: 'todo' } }] },
      sort: [],
      groupBy: null,
    }
    await store.update(saved.id, '改名', updatedQuery)

    expect(h.fakeClient.updateSavedFilter).toHaveBeenCalledWith(
      saved.id,
      '改名',
      JSON.stringify({ ...updatedQuery, version: 1 }),
    )
    expect(store.filters[0].name).toBe('改名')
    expect(store.filters[0].query).toEqual(updatedQuery)
  })

  it('remove(): 委托 savedFilter.remove 并从本地列表移除', async () => {
    const store = useQueryFilterStore()
    const saved = await store.save('待删', sampleQuery())
    expect(store.filters).toHaveLength(1)

    await store.remove(saved.id)

    expect(h.fakeClient.deleteSavedFilter).toHaveBeenCalledWith(saved.id)
    expect(store.filters).toHaveLength(0)
  })

  it('存-取-求值 链路：经 save→load→parse 还原的查询与原始查询在同一数据集求值结果一致', async () => {
    const registry = createRegistry()
    registry.register('task', statusField())

    const store = useQueryFilterStore()
    const q = sampleQuery()

    // 原始查询的直接求值
    const { evaluate } = await import('../../core/query')
    const direct = evaluate(q, items, registry, 'task').map((i: { id: string }) => i.id)

    // 经持久化通道：save → load → 取出的 query → 再求值
    await store.save('已完成', q)
    const loaded = await store.load()
    const restored = evaluate(loaded[0].query, items, registry, 'task').map((i: { id: string }) => i.id)

    expect(direct).toEqual(['a', 'c'])
    expect(restored).toEqual(direct)
  })
})
