import { describe, expect, it } from 'vitest'
import {
  FIELD_TYPE_REGISTRY,
  fieldTypeSpec,
  numberSpecialization,
  pageSpecialization,
  stringSpecialization,
} from './field-type-registry'
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

  it('multiSelect（多选枚举）：multiEnum 编辑器 / chip 形态 / 多选操作符（T4 补 hasAny）', () => {
    const s = fieldTypeSpec('multiSelect')
    expect(s.editor).toBe('multiEnum')
    expect(s.displayForm).toBe('chip')
    expect(s.filterOps).toEqual(['contains', 'notContains', 'hasAny', 'hasAll', 'isEmpty', 'isNotEmpty'])
  })

  it('array（标签数组）：tags 编辑器 / chip 形态 / multiSelect 操作符', () => {
    const s = fieldTypeSpec('array')
    expect(s.editor).toBe('tags')
    expect(s.displayForm).toBe('chip')
    expect(s.filterOps).toEqual(['contains', 'notContains', 'hasAny', 'hasAll', 'isEmpty', 'isNotEmpty'])
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

// ── number 特化族（issue T7）：currency / percent / rating ─────────────────

describe('numberSpecialization', () => {
  it('无标记 / 空串 → undefined（number 走原路径，零回归）', () => {
    expect(numberSpecialization(undefined)).toBeUndefined()
    expect(numberSpecialization(null)).toBeUndefined()
    expect(numberSpecialization('')).toBeUndefined()
  })

  it('未知 spec → undefined（保守回落）', () => {
    expect(numberSpecialization('bogus')).toBeUndefined()
  })

  it('currency：number 编辑器 / chip 形态（编辑不特化，展示特化）', () => {
    expect(numberSpecialization('currency')).toEqual({ editor: 'number', displayForm: 'chip' })
  })

  it('percent：number 编辑器 / chip 形态', () => {
    expect(numberSpecialization('percent')).toEqual({ editor: 'number', displayForm: 'chip' })
  })

  it('rating：rating 星级编辑器 / chip 形态', () => {
    expect(numberSpecialization('rating')).toEqual({ editor: 'rating', displayForm: 'chip' })
  })

  it("currency 带符号/单位后缀（'currency:¥/元'）取首段命中", () => {
    expect(numberSpecialization('currency:¥/元')).toEqual({ editor: 'number', displayForm: 'chip' })
  })
})

// ── page 特化族（issue T10）：person（负责人）─────────────────────────────

describe('pageSpecialization', () => {
  it('无标记 / 空串 → undefined（page 走原路径，零回归）', () => {
    expect(pageSpecialization(undefined)).toBeUndefined()
    expect(pageSpecialization(null)).toBeUndefined()
    expect(pageSpecialization('')).toBeUndefined()
  })

  it('未知 spec → undefined（保守回落）', () => {
    expect(pageSpecialization('bogus')).toBeUndefined()
  })

  it('person：personRef 编辑器 / chip 形态', () => {
    expect(pageSpecialization('person')).toEqual({ editor: 'personRef', displayForm: 'chip' })
  })

  it("参数化标记取冒号前首段命中（与 T7 numberSpecialization 同约定）", () => {
    expect(pageSpecialization('person:extra')).toEqual(pageSpecialization('person'))
  })
})

// ── string 特化族（issue T6）：email / phone / url / richtext ─────────────

describe('stringSpecialization', () => {
  it('无标记 / 空串 → undefined（string 走原路径，零回归）', () => {
    expect(stringSpecialization(undefined)).toBeUndefined()
    expect(stringSpecialization(null)).toBeUndefined()
    expect(stringSpecialization('')).toBeUndefined()
  })

  it('未知 spec → undefined（保守回落）', () => {
    expect(stringSpecialization('bogus')).toBeUndefined()
  })

  it('参数化标记取冒号前首段命中（与 T7 numberSpecialization 同约定）', () => {
    expect(stringSpecialization('email:x@y.z')).toEqual(stringSpecialization('email'))
  })

  it('email：text 编辑器 / text 形态 / validate 单源', () => {
    const s = stringSpecialization('email')
    expect(s?.editor).toBe('text')
    expect(s?.displayForm).toBe('text')
    expect(typeof s?.validate).toBe('function')
  })

  it('phone：text 编辑器 / text 形态 / validate 单源', () => {
    const s = stringSpecialization('phone')
    expect(s?.editor).toBe('text')
    expect(s?.displayForm).toBe('text')
    expect(typeof s?.validate).toBe('function')
  })

  it('url：text 编辑器 / chip 形态（展示带链接）/ 无 validate', () => {
    const s = stringSpecialization('url')
    expect(s?.editor).toBe('text')
    expect(s?.displayForm).toBe('chip')
    expect(s?.validate).toBeUndefined()
  })

  it('richtext：multiline 编辑器（T6 新增 token）/ text 形态', () => {
    const s = stringSpecialization('richtext')
    expect(s?.editor).toBe('multiline')
    expect(s?.displayForm).toBe('text')
  })

  // validate 纯函数：合法 / 非法各 3 例（空串 = 未填恒合法）

  it('email validate：合法 3 例', () => {
    const v = stringSpecialization('email')?.validate
    expect(v?.('a@b.com')).toBeNull()
    expect(v?.('user.name+tag@sub.domain.io')).toBeNull()
    expect(v?.('  x@y.cn  ')).toBeNull() // 前后空白容忍
  })

  it('email validate：非法 3 例', () => {
    const v = stringSpecialization('email')?.validate
    expect(v?.('不是邮箱')).toBe('邮箱格式不正确')
    expect(v?.('a@b')).toBe('邮箱格式不正确') // 缺域名点段
    expect(v?.('a b@c.com')).toBe('邮箱格式不正确') // 含空格
  })

  it('email validate：空串 = 未填，恒合法', () => {
    const v = stringSpecialization('email')?.validate
    expect(v?.('')).toBeNull()
    expect(v?.('   ')).toBeNull()
  })

  it('phone validate：合法 3 例（数字 / + / - / 空格，7-20 位）', () => {
    const v = stringSpecialization('phone')?.validate
    expect(v?.('13800138000')).toBeNull()
    expect(v?.('+86 138-0013-8000')).toBeNull()
    expect(v?.('010-1234567')).toBeNull()
  })

  it('phone validate：非法 3 例', () => {
    const v = stringSpecialization('phone')?.validate
    expect(v?.('abc123')).toBe('电话格式不正确') // 含字母
    expect(v?.('123456')).toBe('电话格式不正确') // 不足 7 位
    expect(v?.('123456789012345678901234567890')).toBe('电话格式不正确') // 超 20 位
  })
})
