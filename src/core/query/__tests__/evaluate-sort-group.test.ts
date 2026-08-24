import { describe, it, expect } from 'vitest'
import { createRegistry, type Registry } from '@/core/query'
import { evaluate, sortItems, groupItems, type Group } from '@/core/query/evaluate'
import type { SortRule, ViewQuery } from '@/core/query'

interface Doc {
  status: string | null
  due: string | null
  score: number
}

function makeRegistry(): Registry {
  const reg = createRegistry()
  reg.register('doc', {
    key: 'status',
    label: '状态',
    type: 'select',
    get: (d: Doc) => d.status,
    options: [
      { id: 'open', label: '进行中' },
      { id: 'done', label: '已完成' },
    ],
  })
  reg.register('doc', {
    key: 'due',
    label: '截止日',
    type: 'date',
    dateBucket: 'month',
    get: (d: Doc) => d.due,
  })
  reg.register('doc', { key: 'score', label: '分数', type: 'number', get: (d: Doc) => d.score })
  return reg
}

const docs: Doc[] = [
  { status: 'done', due: '2026-03-10', score: 5 },
  { status: 'open', due: '2026-01-05', score: 3 },
  { status: 'open', due: '2026-01-20', score: 9 },
  { status: null, due: null, score: 1 },
]

const reg = makeRegistry()

function query(sort: SortRule[], groupBy: string | null = null): ViewQuery {
  return { version: 1, filter: { combinator: 'and', children: [] }, sort, groupBy }
}

describe('多键排序', () => {
  it('单键 asc 按数值升序', () => {
    const out = sortItems(docs, [{ field: 'score', dir: 'asc' }], reg, 'doc')
    expect(out.map((d) => d.score)).toEqual([1, 3, 5, 9])
  })

  it('单键 desc', () => {
    const out = sortItems(docs, [{ field: 'score', dir: 'desc' }], reg, 'doc')
    expect(out.map((d) => d.score)).toEqual([9, 5, 3, 1])
  })

  it('多键逐级回退，且空值恒排末尾（与方向无关）', () => {
    const out = sortItems(
      docs,
      [
        { field: 'status', dir: 'asc' },
        { field: 'score', dir: 'asc' },
      ],
      reg,
      'doc',
    )
    // status 按值(id)升序：'done' < 'open'；空值恒末位；open 内 score 升序
    expect(out.map((d) => d.status)).toEqual(['done', 'open', 'open', null])
    expect(out.map((d) => d.score)).toEqual([5, 3, 9, 1])
  })

  it('sortItems 为纯函数，不修改入参', () => {
    const snapshot = docs.map((d) => d.score)
    sortItems(docs, [{ field: 'score', dir: 'desc' }], reg, 'doc')
    expect(docs.map((d) => d.score)).toEqual(snapshot)
  })
})

describe('单字段分组', () => {
  it('groupBy null → 单一全量桶', () => {
    const groups = groupItems(docs, null, reg, 'doc')
    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(4)
  })

  it('select 按选项 id 分桶，label 取选项 label', () => {
    const groups = groupItems(docs, 'status', reg, 'doc')
    const byKey = Object.fromEntries(groups.map((g: Group<Doc>) => [g.key, g]))
    expect(byKey['open'].items).toHaveLength(2)
    expect(byKey['done'].items).toHaveLength(1)
    expect(byKey[''].items).toHaveLength(1) // 空值桶
    expect(byKey['open'].label).toBe('进行中')
    expect(byKey['done'].label).toBe('已完成')
    expect(byKey[''].label).toBe('（空）')
  })

  it('date 按 month 分桶（dateBucket 取自字段描述符）', () => {
    const groups = groupItems(docs, 'due', reg, 'doc')
    const byKey = Object.fromEntries(groups.map((g: Group<Doc>) => [g.key, g]))
    expect(byKey['2026-01'].items).toHaveLength(2)
    expect(byKey['2026-03'].items).toHaveLength(1)
    expect(byKey[''].items).toHaveLength(1)
  })
})

describe('evaluate 串接排序', () => {
  it('evaluate 在过滤后应用 sort', () => {
    const out = evaluate(query([{ field: 'score', dir: 'desc' }]), docs, reg, 'doc')
    expect(out.map((d) => d.score)).toEqual([9, 5, 3, 1])
  })
})
