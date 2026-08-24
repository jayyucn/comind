import { describe, it, expect } from 'vitest'
import { deriveOps, DEFAULT_OPS } from '@/core/query/operators'
import type { FieldDescriptor } from '@/core/query'

interface Item {
  v: unknown
}

function field(type: FieldDescriptor['type'], extra: Partial<FieldDescriptor> = {}): FieldDescriptor<Item> {
  return {
    key: 'f',
    label: 'F',
    type,
    get: (item) => item.v,
    ...extra,
  }
}

describe('DEFAULT_OPS 默认映射', () => {
  it('text → is/isNot/contains/notContains/isEmpty/isNotEmpty', () => {
    expect(DEFAULT_OPS.text).toEqual(['is', 'isNot', 'contains', 'notContains', 'isEmpty', 'isNotEmpty'])
  })

  it('number → eq/neq/gt/lt/isEmpty/isNotEmpty', () => {
    expect(DEFAULT_OPS.number).toEqual(['eq', 'neq', 'gt', 'lt', 'isEmpty', 'isNotEmpty'])
  })

  it('date → before/after/between/within/isEmpty/isNotEmpty', () => {
    expect(DEFAULT_OPS.date).toEqual(['before', 'after', 'between', 'within', 'isEmpty', 'isNotEmpty'])
  })

  it('select → is/isNot/isEmpty/isNotEmpty', () => {
    expect(DEFAULT_OPS.select).toEqual(['is', 'isNot', 'isEmpty', 'isNotEmpty'])
  })

  it('multiSelect → contains/notContains/hasAll/isEmpty/isNotEmpty', () => {
    expect(DEFAULT_OPS.multiSelect).toEqual(['contains', 'notContains', 'hasAll', 'isEmpty', 'isNotEmpty'])
  })

  it('boolean → is', () => {
    expect(DEFAULT_OPS.boolean).toEqual(['is'])
  })
})

describe('deriveOps', () => {
  it('六内置类型各返回类型默认集', () => {
    expect(deriveOps(field('text'))).toEqual(DEFAULT_OPS.text)
    expect(deriveOps(field('number'))).toEqual(DEFAULT_OPS.number)
    expect(deriveOps(field('date'))).toEqual(DEFAULT_OPS.date)
    expect(deriveOps(field('select'))).toEqual(DEFAULT_OPS.select)
    expect(deriveOps(field('multiSelect'))).toEqual(DEFAULT_OPS.multiSelect)
    expect(deriveOps(field('boolean'))).toEqual(DEFAULT_OPS.boolean)
  })

  it('字段通过 ops 覆盖时以覆盖为准（含扩展与缩减）', () => {
    expect(deriveOps(field('text', { ops: ['is', 'isEmpty'] }))).toEqual(['is', 'isEmpty'])
    expect(deriveOps(field('boolean', { ops: ['is', 'isNot', 'contains'] }))).toEqual(['is', 'isNot', 'contains'])
  })

  it('自定义类型（不在 DEFAULT_OPS 中）且无 ops 时返回空数组', () => {
    expect(deriveOps(field('richtext' as FieldDescriptor['type']))).toEqual([])
  })

  it('自定义类型带 ops 覆盖时返回 ops', () => {
    expect(deriveOps(field('richtext' as FieldDescriptor['type'], { ops: ['contains'] }))).toEqual(['contains'])
  })

  it('纯函数：返回的是拷贝，外部改动不影响内部映射', () => {
    const result = deriveOps(field('text'))
    result.push('hacked' as FilterOp)
    expect(DEFAULT_OPS.text).toEqual(['is', 'isNot', 'contains', 'notContains', 'isEmpty', 'isNotEmpty'])
  })

  it('不依赖 Vue / Pinia / WASM，可在无框架环境单测', () => {
    expect(deriveOps(field('select'))).toBeInstanceOf(Array)
  })
})
