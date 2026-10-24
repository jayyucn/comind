import { describe, it, expect, vi } from 'vitest'
import { deriveOps, getDefaultOps } from '@/core/query/operators'
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

describe('getDefaultOps 默认映射', () => {
  it('string → is/isNot/contains/notContains/isEmpty/isNotEmpty', () => {
    expect(getDefaultOps().string).toEqual(['is', 'isNot', 'contains', 'notContains', 'isEmpty', 'isNotEmpty'])
  })

  it('number → eq/neq/gt/lt/isEmpty/isNotEmpty', () => {
    expect(getDefaultOps().number).toEqual(['eq', 'neq', 'gt', 'lt', 'isEmpty', 'isNotEmpty'])
  })

  it('date → before/after/between/within/isEmpty/isNotEmpty', () => {
    expect(getDefaultOps().date).toEqual(['before', 'after', 'between', 'within', 'isEmpty', 'isNotEmpty'])
  })

  it('select → is/isNot/isEmpty/isNotEmpty', () => {
    expect(getDefaultOps().select).toEqual(['is', 'isNot', 'isEmpty', 'isNotEmpty'])
  })

  it('multiSelect → contains/notContains/hasAny/hasAll/isEmpty/isNotEmpty（T4 补 hasAny）', () => {
    expect(getDefaultOps().multiSelect).toEqual(['contains', 'notContains', 'hasAny', 'hasAll', 'isEmpty', 'isNotEmpty'])
  })

  it('boolean → is', () => {
    expect(getDefaultOps().boolean).toEqual(['is'])
  })
})

describe('deriveOps', () => {
  it('各内置类型各返回类型默认集', () => {
    expect(deriveOps(field('string'))).toEqual(getDefaultOps().string)
    expect(deriveOps(field('number'))).toEqual(getDefaultOps().number)
    expect(deriveOps(field('date'))).toEqual(getDefaultOps().date)
    expect(deriveOps(field('select'))).toEqual(getDefaultOps().select)
    expect(deriveOps(field('multiSelect'))).toEqual(getDefaultOps().multiSelect)
    expect(deriveOps(field('boolean'))).toEqual(getDefaultOps().boolean)
  })

  it('字段通过 ops 覆盖时以覆盖为准（含扩展与缩减）', () => {
    expect(deriveOps(field('string', { ops: ['is', 'isEmpty'] }))).toEqual(['is', 'isEmpty'])
    expect(deriveOps(field('boolean', { ops: ['is', 'isNot', 'contains'] }))).toEqual(['is', 'isNot', 'contains'])
  })

  it('自定义类型（不在默认映射中）且无 ops 时返回空数组', () => {
    expect(deriveOps(field('richtext' as FieldDescriptor['type']))).toEqual([])
  })

  it('自定义类型带 ops 覆盖时返回 ops', () => {
    expect(deriveOps(field('richtext' as FieldDescriptor['type'], { ops: ['contains'] }))).toEqual(['contains'])
  })

  it('纯函数：返回的是拷贝，外部改动不影响内部映射', () => {
    const result = deriveOps(field('string'))
    result.push('hacked' as FilterOp)
    expect(getDefaultOps().string).toEqual(['is', 'isNot', 'contains', 'notContains', 'isEmpty', 'isNotEmpty'])
  })

  it('不依赖 Vue / Pinia / WASM，可在无框架环境单测', () => {
    expect(deriveOps(field('select'))).toBeInstanceOf(Array)
  })
})

// 生产白屏回归网（2026-10-23）：打包后本模块与 field-type-registry 分属不同 chunk，
// 而 wasm 动态导入链给共享 chunk 带来的 top-level await 会让模块求值顺序失去保证。
// 若在模块顶层就 Object.entries(FIELD_TYPE_REGISTRY)，注册表可能尚未赋值 → 抛
// TypeError 导致整张模块图求值中断、应用白屏。故必须惰性到首次取值才读注册表。
describe('模块求值期副作用', () => {
  it('注册表未就绪时 import 不抛错，直到取值才解引用（惰性读取）', async () => {
    vi.resetModules()
    vi.doMock('@/types/field-type-registry', () => ({
      FIELD_TYPE_REGISTRY: undefined,
      fieldTypeSpec: () => ({ editor: 'text', displayForm: 'text', filterOps: [] }),
    }))

    const mod = await import('@/core/query/operators')
    // 求值期不解引用：拿到模块即成功
    expect(typeof mod.getDefaultOps).toBe('function')
    // 证明读取确实发生在调用时（而不是启动时缓存了 undefined）
    expect(() => mod.getDefaultOps()).toThrow(TypeError)

    vi.doUnmock('@/types/field-type-registry')
    vi.resetModules()
  })
})
