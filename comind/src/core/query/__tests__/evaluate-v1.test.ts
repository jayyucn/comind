import { describe, it, expect } from 'vitest'
import { createRegistry, type Registry, type FieldDescriptor } from '@/core/query'
import { evaluate, matchCondition, evalGroup } from '@/core/query/evaluate'
import type { ConditionGroup, ViewQuery } from '@/core/query'

interface Row {
  name: string
  status: string | null
}

function textField(): FieldDescriptor<Row> {
  return { key: 'name', label: '名称', type: 'text', get: (r) => r.name }
}

function statusField(options: { id: string; label: string }[]): FieldDescriptor<Row> {
  return {
    key: 'status',
    label: '状态',
    type: 'select',
    get: (r) => r.status,
    options,
  }
}

function makeRegistry(opts: { id: string; label: string }[] = [
  { id: 'open', label: '进行中' },
  { id: 'done', label: '已完成' },
]): Registry {
  const reg = createRegistry()
  reg.register('row', textField())
  reg.register('row', statusField(opts))
  return reg
}

const rows: Row[] = [
  { name: 'Alpha Task', status: 'open' },
  { name: 'Beta Note', status: 'done' },
  { name: 'Gamma', status: null }, // 空值
  { name: 'alpha lowercase', status: 'open' },
]

function group(combinator: 'and' | 'or', children: ConditionGroup['children']): ConditionGroup {
  return { combinator, children }
}

function query(filter: ConditionGroup): ViewQuery {
  return { version: 1, filter, sort: [], groupBy: null }
}

describe('evaluate 入口', () => {
  it('返回过滤后的新集合，不修改入参', () => {
    const reg = makeRegistry()
    const q = query(group('and', [{ field: 'status', op: 'is', value: { kind: 'literal', value: 'open' } }]))
    const out = evaluate(q, rows, reg, 'row')

    expect(out).toHaveLength(2)
    expect(out.map((r) => r.name)).toEqual(['Alpha Task', 'alpha lowercase'])
    expect(rows).toHaveLength(4) // 原数组未变
  })

  it('空根组 = 无筛选，返回全部', () => {
    const reg = makeRegistry()
    const out = evaluate(query(group('and', [])), rows, reg, 'row')
    expect(out).toHaveLength(4)
  })
})

describe('AND / OR 组合', () => {
  it('and 组合：所有条件都满足才匹配', () => {
    const reg = makeRegistry()
    const q = query(
      group('and', [
        { field: 'status', op: 'is', value: { kind: 'literal', value: 'open' } },
        { field: 'name', op: 'contains', value: { kind: 'literal', value: 'alpha' } },
      ]),
    )
    const out = evaluate(q, rows, reg, 'row')
    expect(out.map((r) => r.name)).toEqual(['Alpha Task', 'alpha lowercase'])
  })

  it('or 组合：任一条件满足即匹配', () => {
    const reg = makeRegistry()
    const q = query(
      group('or', [
        { field: 'status', op: 'is', value: { kind: 'literal', value: 'done' } },
        { field: 'name', op: 'contains', value: { kind: 'literal', value: 'gamma' } },
      ]),
    )
    const out = evaluate(q, rows, reg, 'row')
    expect(out.map((r) => r.name).sort()).toEqual(['Beta Note', 'Gamma'])
  })
})

describe('text 操作符', () => {
  const reg = makeRegistry()
  it('is 精确匹配（区分大小写）', () => {
    expect(matchCondition({ field: 'name', op: 'is', value: { kind: 'literal', value: 'Gamma' } }, rows[2], reg, 'row')).toBe(true)
    expect(matchCondition({ field: 'name', op: 'is', value: { kind: 'literal', value: 'gamma' } }, rows[2], reg, 'row')).toBe(false)
  })
  it('isNot', () => {
    expect(matchCondition({ field: 'name', op: 'isNot', value: { kind: 'literal', value: 'Gamma' } }, rows[0], reg, 'row')).toBe(true)
  })
  it('contains 不区分大小写', () => {
    expect(matchCondition({ field: 'name', op: 'contains', value: { kind: 'literal', value: 'ALPHA' } }, rows[3], reg, 'row')).toBe(true)
  })
  it('notContains', () => {
    expect(matchCondition({ field: 'name', op: 'notContains', value: { kind: 'literal', value: 'task' } }, rows[1], reg, 'row')).toBe(true)
  })
  it('isEmpty / isNotEmpty：仅这两个关心空值', () => {
    expect(matchCondition({ field: 'status', op: 'isEmpty' }, rows[2], reg, 'row')).toBe(true)
    expect(matchCondition({ field: 'status', op: 'isNotEmpty' }, rows[0], reg, 'row')).toBe(true)
    expect(matchCondition({ field: 'status', op: 'isNotEmpty' }, rows[2], reg, 'row')).toBe(false)
  })
})

describe('select 操作符（按 id 比对）', () => {
  const reg = makeRegistry()
  it('is / isNot 按选项 id 比对', () => {
    expect(matchCondition({ field: 'status', op: 'is', value: { kind: 'literal', value: 'done' } }, rows[1], reg, 'row')).toBe(true)
    expect(matchCondition({ field: 'status', op: 'isNot', value: { kind: 'literal', value: 'done' } }, rows[0], reg, 'row')).toBe(true)
  })
  it('引用的选项 id 已从字段删除时降级为非匹配（不抛错）', () => {
    const reg2 = makeRegistry([{ id: 'open', label: '进行中' }]) // done 被删
    expect(matchCondition({ field: 'status', op: 'is', value: { kind: 'literal', value: 'done' } }, rows[1], reg2, 'row')).toBe(false)
    expect(matchCondition({ field: 'status', op: 'isNot', value: { kind: 'literal', value: 'done' } }, rows[1], reg2, 'row')).toBe(false)
  })
})

describe('空值通行语义', () => {
  const reg = makeRegistry()
  it('比较类操作符遇空返回 false', () => {
    expect(matchCondition({ field: 'status', op: 'is', value: { kind: 'literal', value: 'open' } }, rows[2], reg, 'row')).toBe(false)
    expect(matchCondition({ field: 'status', op: 'isNot', value: { kind: 'literal', value: 'open' } }, rows[2], reg, 'row')).toBe(false)
  })
  it('null 与 undefined 同样视为空', () => {
    const nullReg = createRegistry()
    nullReg.register('row', { key: 'x', label: 'X', type: 'text', get: () => null })
    expect(matchCondition({ field: 'x', op: 'isNotEmpty' }, { x: '' }, nullReg, 'row')).toBe(false)
  })
})

describe('防御性', () => {
  it('字段未在注册表时条件返回 false，不抛错', () => {
    const reg = makeRegistry()
    expect(matchCondition({ field: 'ghost', op: 'is', value: { kind: 'literal', value: 'x' } }, rows[0], reg, 'row')).toBe(false)
    expect(evalGroup(group('and', [{ field: 'ghost', op: 'is', value: { kind: 'literal', value: 'x' } }]), rows[0], reg, 'row')).toBe(false)
  })
})
