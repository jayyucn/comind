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

describe('daterange（区间整体 before/after，issue T8）', () => {
  interface SpanRec {
    span: { start: string; end: string } | null
  }
  const spanReg = createRegistry()
  spanReg.register('span', { key: 'span', label: '区间', type: 'daterange', get: (r: SpanRec) => r.span })

  // 区间 2026-01-10 ~ 2026-01-20
  const item: SpanRec = { span: { start: '2026-01-10', end: '2026-01-20' } }
  const empty: SpanRec = { span: null }

  it('before：区间整体早于参照（end < 参照，严格小于）', () => {
    const op = { field: 'span', op: 'before' as const, value: { kind: 'literal' as const, value: '2026-01-21' } }
    expect(matchCondition(op, item, spanReg, 'span')).toBe(true)
  })
  it('before 边界：end == 参照日不算整体早于（严格小于）', () => {
    const op = { field: 'span', op: 'before' as const, value: { kind: 'literal' as const, value: '2026-01-20' } }
    expect(matchCondition(op, item, spanReg, 'span')).toBe(false)
    // 参照落在区间内（start < 参照 < end）也不算整体早于
    const mid = { field: 'span', op: 'before' as const, value: { kind: 'literal' as const, value: '2026-01-15' } }
    expect(matchCondition(mid, item, spanReg, 'span')).toBe(false)
  })
  it('after：区间整体晚于参照（start > 参照，严格大于）', () => {
    const op = { field: 'span', op: 'after' as const, value: { kind: 'literal' as const, value: '2026-01-09' } }
    expect(matchCondition(op, item, spanReg, 'span')).toBe(true)
  })
  it('after 边界：start == 参照日不算整体晚于（严格大于）', () => {
    const op = { field: 'span', op: 'after' as const, value: { kind: 'literal' as const, value: '2026-01-10' } }
    expect(matchCondition(op, item, spanReg, 'span')).toBe(false)
    // 参照落在区间内也不算整体晚于
    const mid = { field: 'span', op: 'after' as const, value: { kind: 'literal' as const, value: '2026-01-15' } }
    expect(matchCondition(mid, item, spanReg, 'span')).toBe(false)
  })
  it('空值：比较遇空即 false，isEmpty / isNotEmpty 正常', () => {
    expect(matchCondition({ field: 'span', op: 'before', value: { kind: 'literal', value: '2026-01-21' } }, empty, spanReg, 'span')).toBe(false)
    expect(matchCondition({ field: 'span', op: 'after', value: { kind: 'literal', value: '2026-01-01' } }, empty, spanReg, 'span')).toBe(false)
    expect(matchCondition({ field: 'span', op: 'isEmpty' }, empty, spanReg, 'span')).toBe(true)
    expect(matchCondition({ field: 'span', op: 'isNotEmpty' }, empty, spanReg, 'span')).toBe(false)
  })
  it('evaluate 集成：按区间边界过滤', () => {
    const a: SpanRec = { span: { start: '2026-01-01', end: '2026-01-05' } } // 整体早于 01-10
    const b: SpanRec = { span: { start: '2026-01-02', end: '2026-01-20' } } // 跨参照，两侧都不匹配
    const c: SpanRec = { span: { start: '2026-02-01', end: '2026-02-15' } } // 整体晚于 01-31
    const d: SpanRec = { span: null }
    const beforeQ = query(grp('and', [{ field: 'span', op: 'before', value: { kind: 'literal', value: '2026-01-10' } }]))
    expect(evaluate(beforeQ, [a, b, c, d], spanReg, 'span')).toEqual([a])
    const afterQ = query(grp('and', [{ field: 'span', op: 'after', value: { kind: 'literal', value: '2026-01-31' } }]))
    expect(evaluate(afterQ, [a, b, c, d], spanReg, 'span')).toEqual([c])
  })
})
