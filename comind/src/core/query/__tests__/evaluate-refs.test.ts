import { describe, it, expect } from 'vitest'
import { createRegistry, type FieldDescriptor, type Registry, type QueryContext } from '@/core/query'
import { evaluate, matchCondition, evalGroup } from '@/core/query/evaluate'
import type { ConditionGroup, ViewQuery } from '@/core/query'

interface Row {
  name: string
  wordCount: number
  childrenCount: number | undefined
  status: string | null
}

interface RefPage {
  id: string
  wordCount: number
}

function wordCountField(): FieldDescriptor<Row> {
  return { key: 'wordCount', label: '字数', type: 'number', get: (r) => r.wordCount }
}
function childrenCountField(): FieldDescriptor<Row> {
  return { key: 'childrenCount', label: '子页面数', type: 'number', get: (r) => r.childrenCount }
}
function nameField(): FieldDescriptor<Row> {
  return { key: 'name', label: '名称', type: 'text', get: (r) => r.name }
}
function statusField(): FieldDescriptor<Row> {
  return {
    key: 'status',
    label: '状态',
    type: 'select',
    get: (r) => r.status,
    options: [
      { id: 'open', label: '进行中' },
      { id: 'done', label: '完成' },
    ],
  }
}
// page 命名空间：供 recordRef 引用解析（resolveTarget 按 cv.entityType + cv.recordId 取记录，再用其 fields 解析）
function pageWordCountField(): FieldDescriptor<RefPage> {
  return { key: 'wordCount', label: '字数', type: 'number', get: (p) => p.wordCount }
}

function makeRegistry(): Registry {
  const reg = createRegistry()
  reg.register('row', nameField())
  reg.register('row', wordCountField())
  reg.register('row', childrenCountField())
  reg.register('row', statusField())
  reg.register('page', pageWordCountField())
  return reg
}

const rows: Row[] = [
  { name: 'A', wordCount: 100, childrenCount: 10, status: 'open' },
  { name: 'B', wordCount: 5, childrenCount: 50, status: 'done' },
  { name: 'C', wordCount: 0, childrenCount: 0, status: null },
  { name: 'D', wordCount: 7, childrenCount: undefined, status: 'open' },
]

const pages: Record<string, RefPage> = {
  p1: { id: 'p1', wordCount: 80 },
  p2: { id: 'p2', wordCount: 3 },
}

const context: QueryContext = {
  getById: (et, id) => (et === 'page' ? pages[id] : undefined),
}

function group(combinator: 'and' | 'or', children: ConditionGroup['children']): ConditionGroup {
  return { combinator, children }
}
function query(filter: ConditionGroup): ViewQuery {
  return { version: 1, filter, sort: [], groupBy: null }
}

describe('同记录字段引用（field）', () => {
  const reg = makeRegistry()

  it('比较字段 > 同记录另一字段：命中与未命中', () => {
    const cond = { field: 'wordCount', op: 'gt' as const, value: { kind: 'field' as const, field: 'childrenCount' } }
    expect(matchCondition(cond, rows[0], reg, 'row')).toBe(true) // 100 > 10
    expect(matchCondition(cond, rows[1], reg, 'row')).toBe(false) // 5 > 50 否
    expect(matchCondition(cond, rows[2], reg, 'row')).toBe(false) // 0 > 0 否
  })

  it('目标字段为空（undefined）→ 无法比较，非匹配', () => {
    const cond = { field: 'wordCount', op: 'gt' as const, value: { kind: 'field' as const, field: 'childrenCount' } }
    expect(matchCondition(cond, rows[3], reg, 'row')).toBe(false) // childrenCount 为 undefined
  })

  it('同记录字段相等（is）', () => {
    const cond = { field: 'wordCount', op: 'is' as const, value: { kind: 'field' as const, field: 'childrenCount' } }
    expect(matchCondition(cond, rows[2], reg, 'row')).toBe(true) // 0 === 0
  })

  it('evaluate 端到端：字段引用参与过滤', () => {
    const q = query(group('and', [{ field: 'wordCount', op: 'gt', value: { kind: 'field', field: 'childrenCount' } }]))
    const out = evaluate(q, rows, reg, 'row')
    expect(out.map((r) => r.name)).toEqual(['A']) // 仅 100>10 命中
  })

  it('嵌套组内的字段引用也生效', () => {
    const q = query(
      group('or', [
        group('and', [{ field: 'wordCount', op: 'gt', value: { kind: 'field', field: 'childrenCount' } }]),
        { field: 'name', op: 'is', value: { kind: 'literal', value: 'B' } },
      ]),
    )
    const out = evaluate(q, rows, reg, 'row')
    expect(out.map((r) => r.name).sort()).toEqual(['A', 'B'])
  })
})

describe('跨记录字段引用（recordRef）', () => {
  const reg = makeRegistry()

  it('比较字段 > 其他 Page 字段：命中与未命中', () => {
    const cond = { field: 'wordCount', op: 'gt' as const, value: { kind: 'recordRef' as const, entityType: 'page', recordId: 'p1', field: 'wordCount' } }
    expect(matchCondition(cond, rows[0], reg, 'row', context)).toBe(true) // 100 > 80
    expect(matchCondition(cond, rows[1], reg, 'row', context)).toBe(false) // 5 > 80 否
  })

  it('引用不同目标页面：0 > 3 否', () => {
    const cond = { field: 'wordCount', op: 'gt' as const, value: { kind: 'recordRef' as const, entityType: 'page', recordId: 'p2', field: 'wordCount' } }
    expect(matchCondition(cond, rows[2], reg, 'row', context)).toBe(false) // 0 > 3 否
  })

  it('未提供 context 时 recordRef 一律非匹配（不抛错）', () => {
    const cond = { field: 'wordCount', op: 'gt' as const, value: { kind: 'recordRef' as const, entityType: 'page', recordId: 'p1', field: 'wordCount' } }
    expect(matchCondition(cond, rows[0], reg, 'row')).toBe(false)
    expect(evalGroup(group('and', [cond]), rows[0], reg, 'row')).toBe(false)
  })

  it('引用的目标页面不存在时非匹配', () => {
    const cond = { field: 'wordCount', op: 'gt' as const, value: { kind: 'recordRef' as const, entityType: 'page', recordId: 'missing', field: 'wordCount' } }
    expect(matchCondition(cond, rows[0], reg, 'row', context)).toBe(false)
  })

  it('evaluate 端到端：recordRef 引用参与过滤', () => {
    const q = query(group('and', [{ field: 'wordCount', op: 'gt', value: { kind: 'recordRef', entityType: 'page', recordId: 'p1', field: 'wordCount' } }]))
    const out = evaluate(q, rows, reg, 'row', context)
    expect(out.map((r) => r.name)).toEqual(['A']) // 仅 100>80 命中
  })

  it('context.getById 仅响应 page 命名空间，其他 entityType 返回 undefined', () => {
    const cond = { field: 'wordCount', op: 'gt' as const, value: { kind: 'recordRef' as const, entityType: 'page', recordId: 'p1', field: 'wordCount' } }
    const wrongCtx: QueryContext = { getById: (et, id) => (et === 'block' && id === 'p1' ? pages.p1 : undefined) }
    expect(matchCondition(cond, rows[0], reg, 'row', wrongCtx)).toBe(false)
  })
})
