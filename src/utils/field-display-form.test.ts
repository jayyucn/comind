import { describe, expect, it } from 'vitest'
import {
  DISPLAY_FORM_OVERRIDES,
  normalizeDisplayFormOverride,
  resolveDisplayForm,
  typeDefaultForm,
} from './field-display-form'

/** 构造持久化形定义（只填解析所需字段） */
function persistedDef(over: Partial<{ type: string; closed_values: string[] | null; display_form_override: string | null }> = {}) {
  return {
    id: 'f1',
    key: 'rating',
    title: '评级',
    type: 'string',
    closed_values: null as string[] | null,
    display_form_override: null as string | null,
    ...over,
  }
}

/** 构造编译期定义（系统字段形） */
function compiledDef(over: Partial<{ type: string; closedValues: { value: string; label: string }[]; displayStyle: 'icon-text' | 'icon' | 'text' }> = {}) {
  return {
    key: 'progress',
    title: '进度',
    type: 'string' as const,
    ...over,
  }
}

describe('typeDefaultForm（类型 → 默认形态映射，ADR-0050 D21 决策 1）', () => {
  it('选项型（枚举）→ chip，无论基础类型', () => {
    expect(typeDefaultForm('string', true)).toBe('chip')
    expect(typeDefaultForm('number', true)).toBe('chip')
  })

  it('date / array / page / number → chip（胶囊家族）', () => {
    expect(typeDefaultForm('date', false)).toBe('chip')
    expect(typeDefaultForm('array', false)).toBe('chip')
    expect(typeDefaultForm('page', false)).toBe('chip')
    expect(typeDefaultForm('number', false)).toBe('chip')
  })

  it('boolean → icon（值即 ✓/✗ 图标）', () => {
    expect(typeDefaultForm('boolean', false)).toBe('icon')
  })

  it('纯 string → text', () => {
    expect(typeDefaultForm('string', false)).toBe('text')
  })
})

describe('normalizeDisplayFormOverride（取值空间封闭，ADR-0050 D21 决策 5）', () => {
  it('合法值原样通过', () => {
    for (const v of DISPLAY_FORM_OVERRIDES) {
      expect(normalizeDisplayFormOverride(v)).toBe(v)
    }
  })

  it('非法 / 空 / null 一律归一为 auto', () => {
    expect(normalizeDisplayFormOverride('badge')).toBe('auto')
    expect(normalizeDisplayFormOverride('')).toBe('auto')
    expect(normalizeDisplayFormOverride(null)).toBe('auto')
    expect(normalizeDisplayFormOverride(undefined)).toBe('auto')
    expect(normalizeDisplayFormOverride(42)).toBe('auto')
  })
})

describe('resolveDisplayForm（解析优先级：用户覆盖 > 编译期 displayStyle > 类型默认）', () => {
  it('override 非 auto 时胜过一切', () => {
    const def = persistedDef({ type: 'string', display_form_override: 'text' })
    expect(resolveDisplayForm(def)).toBe('text')
  })

  it('override = auto 时回落类型默认（枚举 → chip）', () => {
    const def = persistedDef({ type: 'string', closed_values: ['A', 'B'], display_form_override: 'auto' })
    expect(resolveDisplayForm(def)).toBe('chip')
  })

  it('无 override 的编译期定义：displayStyle 参与解析（系统字段编译期定死通道）', () => {
    expect(resolveDisplayForm(compiledDef({ type: 'string', displayStyle: 'icon' }))).toBe('icon')
    expect(resolveDisplayForm(compiledDef({ type: 'string', displayStyle: 'icon-text' }))).toBe('icon-text')
    expect(resolveDisplayForm(compiledDef({ type: 'string', displayStyle: 'text' }))).toBe('text')
  })

  it('既无 override 也无 displayStyle → 类型默认（编译期枚举字段 → chip）', () => {
    const def = compiledDef({ type: 'string', closedValues: [{ value: 'High', label: '高' }] })
    expect(resolveDisplayForm(def)).toBe('chip')
  })

  it('无 override、无 displayStyle、纯 string → text（现状兜底）', () => {
    expect(resolveDisplayForm(compiledDef({ type: 'string' }))).toBe('text')
  })

  it('用户字段的空串 override 视为 auto，走类型默认', () => {
    const def = persistedDef({ type: 'date', display_form_override: '' })
    expect(resolveDisplayForm(def)).toBe('chip')
  })
})
