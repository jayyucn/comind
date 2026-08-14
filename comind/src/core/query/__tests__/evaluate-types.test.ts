import { describe, it, expect } from 'vitest'
import { createRegistry, type Registry } from '@/core/query'
import { evaluate, matchCondition } from '@/core/query/evaluate'
import type { ConditionGroup, ViewQuery } from '@/core/query'

interface Rec {
  score: number | null
  due: string | null
  tags: string[]
  archived: boolean | null
}

function makeRegistry(): Registry {
  const reg = createRegistry()
  reg.register('rec', { key: 'score', label: '分数', type: 'number', get: (r: Rec) => r.score })
  reg.register('rec', {
    key: 'due',
    label: '截止日',
    type: 'date',
    dateBucket: 'month',
    get: (r: Rec) => r.due,
  })
  reg.register('rec', {
    key: 'tags',
    label: '标签',
    type: 'multiSelect',
    get: (r: Rec) => r.tags,
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ],
  })
  reg.register('rec', { key: 'archived', label: '已归档', type: 'boolean', get: (r: Rec) => r.archived })
  return reg
}

const recs: Rec[] = [
  { score: 10, due: '2026-01-15', tags: ['a', 'b'], archived: false },
  { score: 20, due: '2026-03-01', tags: ['b', 'c'], archived: true },
  { score: null, due: null, tags: [], archived: null }, // 空值
  { score: 15, due: '2026-02-10', tags: ['a'], archived: false },
]

const reg = makeRegistry()

function grp(combinator: 'and' | 'or', children: ConditionGroup['children']): ConditionGroup {
  return { combinator, children }
}
function query(filter: ConditionGroup): ViewQuery {
  return { version: 1, filter, sort: [], groupBy: null }
}

describe('number', () => {
  it('eq / neq', () => {
    expect(matchCondition({ field: 'score', op: 'eq', value: { kind: 'literal', value: 10 } }, recs[0], reg, 'rec')).toBe(true)
    expect(matchCondition({ field: 'score', op: 'neq', value: { kind: 'literal', value: 10 } }, recs[1], reg, 'rec')).toBe(true)
    expect(matchCondition({ field: 'score', op: 'eq', value: { kind: 'literal', value: 10 } }, recs[1], reg, 'rec')).toBe(false)
  })
  it('gt / lt', () => {
    const q = query(grp('or', [{ field: 'score', op: 'gt', value: { kind: 'literal', value: 15 } }, { field: 'score', op: 'lt', value: { kind: 'literal', value: 15 } }]))
    const out = evaluate(q, recs, reg, 'rec')
    expect(out.map((r) => r.score).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([10, 20]) // 15 不满足任一
  })
  it('空值：比较遇空即 false', () => {
    expect(matchCondition({ field: 'score', op: 'eq', value: { kind: 'literal', value: 10 } }, recs[2], reg, 'rec')).toBe(false)
    expect(matchCondition({ field: 'score', op: 'isNotEmpty' }, recs[2], reg, 'rec')).toBe(false)
  })
})

describe('date（日粒度，yyyy-MM-dd）', () => {
  it('before / after', () => {
    expect(matchCondition({ field: 'due', op: 'before', value: { kind: 'literal', value: '2026-02-01' } }, recs[0], reg, 'rec')).toBe(true)
    expect(matchCondition({ field: 'due', op: 'before', value: { kind: 'literal', value: '2026-02-01' } }, recs[3], reg, 'rec')).toBe(false)
    const q = query(grp('or', [{ field: 'due', op: 'after', value: { kind: 'literal', value: '2026-01-31' } }]))
    expect(evaluate(q, recs, reg, 'rec').map((r) => r.due).sort()).toEqual(['2026-02-10', '2026-03-01'])
  })
  it('between 含端点（日粒度）', () => {
    const q = query(grp('and', [{ field: 'due', op: 'between', value: { kind: 'literal', value: ['2026-01-01', '2026-02-28'] } }]))
    expect(evaluate(q, recs, reg, 'rec').map((r) => r.due).sort()).toEqual(['2026-01-15', '2026-02-10'])
  })
  it('空值：比较遇空即 false', () => {
    expect(matchCondition({ field: 'due', op: 'after', value: { kind: 'literal', value: '2026-01-01' } }, recs[2], reg, 'rec')).toBe(false)
  })
})

describe('multiSelect', () => {
  it('hasAny：满足任一', () => {
    const q = query(grp('and', [{ field: 'tags', op: 'hasAny', value: { kind: 'literal', value: ['b'] } }]))
    expect(evaluate(q, recs, reg, 'rec').map((r) => r.tags)).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ])
  })
  it('hasAll：满足全部', () => {
    const q = query(grp('and', [{ field: 'tags', op: 'hasAll', value: { kind: 'literal', value: ['a', 'b'] } }]))
    expect(evaluate(q, recs, reg, 'rec').map((r) => r.tags)).toEqual([['a', 'b']])
  })
  it('删除选项降级：引用的 id 不在选项集合 → 非匹配', () => {
    const q = query(grp('and', [{ field: 'tags', op: 'hasAny', value: { kind: 'literal', value: ['x'] } }]))
    expect(evaluate(q, recs, reg, 'rec')).toHaveLength(0)
  })
})

describe('boolean', () => {
  it('is true / is false', () => {
    expect(matchCondition({ field: 'archived', op: 'is', value: { kind: 'literal', value: true } }, recs[1], reg, 'rec')).toBe(true)
    expect(matchCondition({ field: 'archived', op: 'is', value: { kind: 'literal', value: false } }, recs[0], reg, 'rec')).toBe(true)
    const q = query(grp('and', [{ field: 'archived', op: 'is', value: { kind: 'literal', value: true } }]))
    expect(evaluate(q, recs, reg, 'rec').map((r) => r.archived)).toEqual([true])
  })
  it('空值：is 遇 null 即 false', () => {
    expect(matchCondition({ field: 'archived', op: 'is', value: { kind: 'literal', value: false } }, recs[2], reg, 'rec')).toBe(false)
  })
})
