import { describe, expect, it } from 'vitest'
import { FIELD_TYPE_REGISTRY, fieldTypeSpec } from './field-type-registry'
import type { FieldType } from './field-definition'

/** 规范联合全量成员（field-definition.ts 单源，issue #140）。 */
const CANONICAL_TYPES: FieldType[] = [
  'string', 'number', 'boolean', 'date', 'datetime', 'select', 'multiSelect', 'array', 'page',
]

describe('field-type-registry', () => {
  it('注册表覆盖规范联合的每一个成员', () => {
    for (const t of CANONICAL_TYPES) {
      expect(FIELD_TYPE_REGISTRY[t], `missing spec for ${t}`).toBeDefined()
    }
  })

  // ── 既有类型回归（与旧 DEFAULT_OPS / typeDefaultForm 逐项对齐）──

  it('string（文本）：text 编辑器 / text 形态 / 文本操作符', () => {
    const s = fieldTypeSpec('string')
    expect(s.editor).toBe('text')
    expect(s.displayForm).toBe('text')
    expect(s.filterOps).toEqual(['is', 'isNot', 'contains', 'notContains', 'isEmpty', 'isNotEmpty'])
  })

  it('number（数值）：number 编辑器 / chip 形态 / 数值操作符', () => {
    const s = fieldTypeSpec('number')
    expect(s.editor).toBe('number')
    expect(s.displayForm).toBe('chip')
    expect(s.filterOps).toEqual(['eq', 'neq', 'gt', 'lt', 'isEmpty', 'isNotEmpty'])
  })

  it('date（日期）：date 编辑器 / chip 形态 / 日期操作符', () => {
    const s = fieldTypeSpec('date')
    expect(s.editor).toBe('date')
    expect(s.displayForm).toBe('chip')
    expect(s.filterOps).toEqual(['before', 'after', 'between', 'within', 'isEmpty', 'isNotEmpty'])
  })

  it('boolean：boolean 编辑器 / icon 形态 / 仅 is（复用）', () => {
    const s = fieldTypeSpec('boolean')
    expect(s.editor).toBe('boolean')
    expect(s.displayForm).toBe('icon')
    expect(s.filterOps).toEqual(['is'])
  })

  // ── 新收口类型（issue #140 验收 2/3）──

  it('datetime：datetime 编辑器 / chip 形态 / 仅 before-after（闭区间同日语义不成立，不开放 between/within）', () => {
    const s = fieldTypeSpec('datetime')
    expect(s.editor).toBe('datetime')
    expect(s.displayForm).toBe('chip')
    expect(s.filterOps).toEqual(['before', 'after', 'isEmpty', 'isNotEmpty'])
  })

  it('select（枚举）：enum 编辑器 / chip 形态 / select 操作符', () => {
    const s = fieldTypeSpec('select')
    expect(s.editor).toBe('enum')
    expect(s.displayForm).toBe('chip')
    expect(s.filterOps).toEqual(['is', 'isNot', 'isEmpty', 'isNotEmpty'])
  })

  it('multiSelect（多选枚举）：multiEnum 编辑器 / chip 形态 / 多选操作符', () => {
    const s = fieldTypeSpec('multiSelect')
    expect(s.editor).toBe('multiEnum')
    expect(s.displayForm).toBe('chip')
    expect(s.filterOps).toEqual(['contains', 'notContains', 'hasAll', 'isEmpty', 'isNotEmpty'])
  })

  it('array（标签数组）：tags 编辑器 / chip 形态 / multiSelect 操作符', () => {
    const s = fieldTypeSpec('array')
    expect(s.editor).toBe('tags')
    expect(s.displayForm).toBe('chip')
    expect(s.filterOps).toEqual(['contains', 'notContains', 'hasAll', 'isEmpty', 'isNotEmpty'])
  })

  it('page（页面引用）：pageRef 编辑器 / chip 形态 / 文本操作符', () => {
    const s = fieldTypeSpec('page')
    expect(s.editor).toBe('pageRef')
    expect(s.displayForm).toBe('chip')
    expect(s.filterOps).toEqual(['is', 'isNot', 'contains', 'notContains', 'isEmpty', 'isNotEmpty'])
  })

  // ── 未知类型与防御性 ──

  it('未知类型保守回落：text 编辑器 / text 形态 / 空操作符（v1 不认识即不可筛）', () => {
    const s = fieldTypeSpec('rating')
    expect(s.editor).toBe('text')
    expect(s.displayForm).toBe('text')
    expect(s.filterOps).toEqual([])
  })

  it('查表返回 ops 副本，调用方改动不污染注册表', () => {
    const a = fieldTypeSpec('string')
    a.filterOps.push('bogus' as never)
    expect(fieldTypeSpec('string').filterOps).not.toContain('bogus')
  })
})
