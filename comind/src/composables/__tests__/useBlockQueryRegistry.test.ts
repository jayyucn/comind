import { describe, it, expect } from 'vitest'
import { createRegistry, type Condition, type ConditionGroup, type ViewQuery } from '../../core/query'
import {
  BLOCK_ENTITY,
  registerBlockBuiltinFields,
  syncBlockCustomProperties,
} from '../useBlockQueryRegistry'
import { createQueryEngine } from '../../core/query'
import type { BlockCard } from '../../wasm/types'

const blockEngine = createQueryEngine<BlockCard>(BLOCK_ENTITY)

function dr(kind: string, dateDay: string) {
  return { kind, iso: `${dateDay}T09:00:00`, date_day: dateDay, recurrence: 'none', event_ts: 0 }
}

const cards: BlockCard[] = [
  {
    block_id: 'a', page_id: 'p1', parent_id: null, content_preview: 'A',
    properties: { status: 'Done', priority: 'High', project: 'P1', area: 'A1', estimate: 5 },
    date_refs: [dr('deadline', '2026-01-10')], updated_at: 1,
  },
  {
    block_id: 'b', page_id: 'p1', parent_id: null, content_preview: 'B',
    properties: { status: 'Todo', priority: 'Low', project: 'P1', area: 'A2', estimate: 3 },
    date_refs: [], updated_at: 2,
  },
  {
    block_id: 'c', page_id: 'p2', parent_id: null, content_preview: 'C',
    properties: { status: 'Doing', priority: 'Medium', project: 'P2', area: 'A1', estimate: 2 },
    date_refs: [dr('schedule', '2026-03-01')], updated_at: 3,
  },
  {
    block_id: 'd', page_id: 'p2', parent_id: null, content_preview: 'D',
    properties: { status: 'Done', priority: 'Urgent', project: 'P2', area: 'A2', estimate: 8 },
    date_refs: [], updated_at: 4,
  },
]

function cond(field: string, op: Condition['op'], value?: unknown): Condition {
  return value === undefined ? { field, op } : { field, op, value: { kind: 'literal', value } }
}
function vq(filter: ConditionGroup, sort: ViewQuery['sort'] = [], groupBy: string | null = null): ViewQuery {
  return { version: 1, filter, sort, groupBy }
}
const emptyFilter: ConditionGroup = { combinator: 'and', children: [] }

function ids(list: BlockCard[]): string[] {
  return list.map((c) => c.block_id)
}

describe('Block 字段描述符注册表', () => {
  it('注册全部内置字段（含正确类型与 options）', () => {
    const registry = createRegistry()
    registerBlockBuiltinFields(registry)
    const keys = registry.list(BLOCK_ENTITY).map((f) => f.key).sort()
    expect(keys).toEqual([
      'area', 'content', 'dateRefDate', 'dateRefKind', 'deadline', 'done',
      'page', 'priority', 'project', 'schedule', 'status',
    ])

    const status = registry.get(BLOCK_ENTITY, 'status')!
    expect(status.type).toBe('select')
    expect(status.options?.map((o) => o.id)).toEqual(['Todo', 'Doing', 'Done', 'Canceled'])

    const date = registry.get(BLOCK_ENTITY, 'dateRefDate')!
    expect(date.type).toBe('date')
    expect(date.dateBucket).toBe('day')
  })

  it('subscribe 在注册/注销时触发（UI 跟随依据）', () => {
    const registry = createRegistry()
    let calls = 0
    const unsub = registry.subscribe(() => calls++)
    registerBlockBuiltinFields(registry)
    expect(calls).toBeGreaterThan(0) // 内置字段注册批量通知
    const before = calls
    registry.register(BLOCK_ENTITY, { key: 'x', label: 'X', type: 'text', get: () => 1 })
    expect(calls).toBe(before + 1)
    registry.unregister(BLOCK_ENTITY, 'x')
    expect(calls).toBe(before + 2)
    unsub()
  })
})

describe('Block 列表按 ViewQuery 过滤（经 evaluate）', () => {
  function setup() {
    const registry = createRegistry()
    registerBlockBuiltinFields(registry)
    return registry
  }

  it('按 select 字段 status = Done 过滤', () => {
    const registry = setup()
    const q = vq({ combinator: 'and', children: [cond('status', 'is', 'Done')] })
    expect(ids(blockEngine.filterSort(cards, q, registry))).toEqual(['a', 'd'])
  })

  it('按 text 字段 project 包含 P1', () => {
    const registry = setup()
    const q = vq({ combinator: 'and', children: [cond('project', 'is', 'P1')] })
    expect(ids(blockEngine.filterSort(cards, q, registry)).sort()).toEqual(['a', 'b'])
  })

  it('按 dateRefDate before 过滤', () => {
    const registry = setup()
    const q = vq({ combinator: 'and', children: [cond('dateRefDate', 'before', '2026-02-01')] })
    expect(ids(blockEngine.filterSort(cards, q, registry))).toEqual(['a'])
  })

  it('按 dateRefKind hasAny schedule 过滤（multiSelect）', () => {
    const registry = setup()
    const q = vq({ combinator: 'and', children: [cond('dateRefKind', 'hasAny', 'schedule')] })
    expect(ids(blockEngine.filterSort(cards, q, registry))).toEqual(['c'])
  })

  it('and 组合多条件', () => {
    const registry = setup()
    const q = vq({
      combinator: 'and',
      children: [cond('status', 'is', 'Done'), cond('project', 'is', 'P2')],
    })
    expect(ids(blockEngine.filterSort(cards, q, registry))).toEqual(['d'])
  })

  it('or 组合多条件', () => {
    const registry = setup()
    const q = vq({
      combinator: 'or',
      children: [cond('status', 'is', 'Todo'), cond('status', 'is', 'Doing')],
    })
    expect(ids(blockEngine.filterSort(cards, q, registry)).sort()).toEqual(['b', 'c'])
  })

  it('isEmpty / isNotEmpty 空值语义', () => {
    const registry = setup()
    const qEmpty = vq({ combinator: 'and', children: [cond('dateRefDate', 'isEmpty')] })
    expect(ids(blockEngine.filterSort(cards, qEmpty, registry)).sort()).toEqual(['b', 'd'])
    const qNotEmpty = vq({ combinator: 'and', children: [cond('dateRefDate', 'isNotEmpty')] })
    expect(ids(blockEngine.filterSort(cards, qNotEmpty, registry)).sort()).toEqual(['a', 'c'])
  })

  it('按自定义数值字段 estimate gt 过滤', () => {
    const registry = setup()
    syncBlockCustomProperties(registry, [{ key: 'estimate', title: '估算', type: 'number' }])
    const q = vq({ combinator: 'and', children: [cond('estimate', 'gt', 4)] })
    expect(ids(blockEngine.filterSort(cards, q, registry)).sort()).toEqual(['a', 'd'])
  })

  it('自定义 property 注销后条件不再匹配', () => {
    const registry = setup()
    syncBlockCustomProperties(registry, [{ key: 'estimate', title: '估算', type: 'number' }])
    let q = vq({ combinator: 'and', children: [cond('estimate', 'gt', 4)] })
    expect(ids(blockEngine.filterSort(cards, q, registry)).sort()).toEqual(['a', 'd'])
    syncBlockCustomProperties(registry, []) // 全部注销
    q = vq({ combinator: 'and', children: [cond('estimate', 'gt', 4)] })
    expect(ids(blockEngine.filterSort(cards, q, registry))).toEqual([])
  })

  it('多键排序（按 estimate 升序，空值恒末位）', () => {
    const registry = setup()
    syncBlockCustomProperties(registry, [{ key: 'estimate', title: '估算', type: 'number' }])
    const q = vq(emptyFilter, [{ field: 'estimate', dir: 'asc' }])
    // c(2) < b(3) < a(5) < d(8)；全部有 estimate 值
    expect(ids(blockEngine.filterSort(cards, q, registry))).toEqual(['c', 'b', 'a', 'd'])
  })

  it('按 status 分组（groupItems）', () => {
    const registry = setup()
    const sorted = blockEngine.filterSort(cards, vq(emptyFilter), registry)
    const groups = blockEngine.group(sorted, 'status', registry)
    const byKey = Object.fromEntries(groups.map((g) => [g.key, ids(g.items).sort()]))
    expect(byKey['Done'].sort()).toEqual(['a', 'd'])
    expect(byKey['Todo']).toEqual(['b'])
    expect(byKey['Doing']).toEqual(['c'])
  })

  it('runBlockQuery 端到端返回分组桶', () => {
    const registry = setup()
    const groups = blockEngine.run(cards, vq(emptyFilter, [], 'status'), registry)
    expect(groups.length).toBe(3)
    const total = groups.reduce((n, g) => n + g.items.length, 0)
    expect(total).toBe(4)
  })

  it('嵌套条件组（status=Done AND (priority=High OR priority=Urgent)）', () => {
    const registry = setup()
    const q = vq({
      combinator: 'and',
      children: [
        cond('status', 'is', 'Done'),
        { combinator: 'or', children: [cond('priority', 'is', 'High'), cond('priority', 'is', 'Urgent')] },
      ],
    })
    expect(ids(blockEngine.filterSort(cards, q, registry)).sort()).toEqual(['a', 'd'])
  })
})
