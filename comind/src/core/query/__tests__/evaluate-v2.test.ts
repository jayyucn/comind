import { describe, it, expect } from 'vitest'
import { createRegistry, type Registry } from '@/core/query'
import { evaluate, evalGroup } from '@/core/query/evaluate'
import type { ConditionGroup, ViewQuery } from '@/core/query'

interface Row {
  name: string
  status: string | null
}

function makeRegistry(): Registry {
  const reg = createRegistry()
  reg.register('row', { key: 'name', label: '名称', type: 'text', get: (r: Row) => r.name })
  reg.register('row', {
    key: 'status',
    label: '状态',
    type: 'select',
    get: (r: Row) => r.status,
    options: [
      { id: 'open', label: '进行中' },
      { id: 'done', label: '已完成' },
    ],
  })
  return reg
}

const rows: Row[] = [
  { name: 'Alpha Task', status: 'open' },
  { name: 'Beta Note', status: 'done' },
  { name: 'Gamma', status: null },
]

const reg = makeRegistry()

function grp(combinator: 'and' | 'or', children: ConditionGroup['children'], negate = false): ConditionGroup {
  return { combinator, children, ...(negate ? { negate: true } : {}) }
}

function query(filter: ConditionGroup): ViewQuery {
  return { version: 1, filter, sort: [], groupBy: null }
}

describe('嵌套条件组递归', () => {
  it('AND 内含 OR：(name contains a) AND (name contains task OR name contains gamma)', () => {
    const q = query(
      grp('and', [
        { field: 'name', op: 'contains', value: 'a' },
        grp('or', [
          { field: 'name', op: 'contains', value: 'task' },
          { field: 'name', op: 'contains', value: 'gamma' },
        ]),
      ]),
    )
    const out = evaluate(q, rows, reg, 'row')
    expect(out.map((r) => r.name).sort()).toEqual(['Alpha Task', 'Gamma'])
  })

  it('深层嵌套：OR > AND > (status is done AND name contains note)', () => {
    const q = query(
      grp('or', [
        { field: 'status', op: 'is', value: 'open' },
        grp('and', [
          { field: 'status', op: 'is', value: 'done' },
          { field: 'name', op: 'contains', value: 'note' },
        ]),
      ]),
    )
    const out = evaluate(q, rows, reg, 'row')
    expect(out.map((r) => r.name).sort()).toEqual(['Alpha Task', 'Beta Note'])
  })
})

describe('组级 negate', () => {
  it('negate: true 对子结果整体取反', () => {
    const q = query(grp('and', [{ field: 'status', op: 'is', value: 'done' }], true))
    const out = evaluate(q, rows, reg, 'row')
    expect(out.map((r) => r.name).sort()).toEqual(['Alpha Task', 'Gamma'])
  })

  it('negate 与嵌套组合：NOT (status is done AND name contains note)', () => {
    const q = query(
      grp(
        'and',
        [
          { field: 'status', op: 'is', value: 'done' },
          { field: 'name', op: 'contains', value: 'note' },
        ],
        true,
      ),
    )
    const out = evaluate(q, rows, reg, 'row')
    expect(out.map((r) => r.name).sort()).toEqual(['Alpha Task', 'Gamma'])
  })

  it('negate 缺省为 false，不影响既有行为', () => {
    const plain = grp('and', [{ field: 'status', op: 'is', value: 'done' }])
    const withFalse = grp('and', [{ field: 'status', op: 'is', value: 'done' }], false)
    expect(evalGroup(plain, rows[1], reg, 'row')).toBe(evalGroup(withFalse, rows[1], reg, 'row'))
  })
})

describe('空 children 组语义', () => {
  it('空 children 的组 = 无条件通过（等价于 ViewQuery.filter 空组）', () => {
    expect(evalGroup(grp('and', []), rows[0], reg, 'row')).toBe(true)
    expect(evalGroup(grp('or', []), rows[0], reg, 'row')).toBe(true)
  })

  it('AND 组内含一个空 OR 子组：子组为 true，整体退化为其余条件', () => {
    const q = query(
      grp('and', [{ field: 'status', op: 'is', value: 'open' }, grp('or', [])]),
    )
    const out = evaluate(q, rows, reg, 'row')
    expect(out.map((r) => r.name)).toEqual(['Alpha Task'])
  })
})
