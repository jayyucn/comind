import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CURRENCY_SYMBOL,
  effectiveNumberBounds,
  formatCurrency,
  parseCurrencySpec,
} from './field-number-format'

describe('parseCurrencySpec', () => {
  it('空 / 非 currency spec 回落默认符号 ¥、无单位', () => {
    expect(parseCurrencySpec(null)).toEqual({ symbol: DEFAULT_CURRENCY_SYMBOL, unit: '' })
    expect(parseCurrencySpec(undefined)).toEqual({ symbol: DEFAULT_CURRENCY_SYMBOL, unit: '' })
    expect(parseCurrencySpec('')).toEqual({ symbol: DEFAULT_CURRENCY_SYMBOL, unit: '' })
    expect(parseCurrencySpec('percent')).toEqual({ symbol: DEFAULT_CURRENCY_SYMBOL, unit: '' })
  })

  it("'currency' → 默认 ¥", () => {
    expect(parseCurrencySpec('currency')).toEqual({ symbol: DEFAULT_CURRENCY_SYMBOL, unit: '' })
  })

  it("'currency:$' → 自定义符号", () => {
    expect(parseCurrencySpec('currency:$')).toEqual({ symbol: '$', unit: '' })
  })

  it("'currency:¥/元' → 符号 + 单位", () => {
    expect(parseCurrencySpec('currency:¥/元')).toEqual({ symbol: '¥', unit: '元' })
  })

  it("'currency:/美元' → 默认符号 + 单位（符号段可空）", () => {
    expect(parseCurrencySpec('currency:/美元')).toEqual({ symbol: DEFAULT_CURRENCY_SYMBOL, unit: '美元' })
  })
})

describe('formatCurrency', () => {
  it('默认符号：¥42', () => {
    expect(formatCurrency(42)).toBe('¥42')
  })

  it('小数原样保留：¥12.5', () => {
    expect(formatCurrency(12.5)).toBe('¥12.5')
  })

  it('单位后置：¥42元', () => {
    expect(formatCurrency(42, { symbol: '¥', unit: '元' })).toBe('¥42元')
  })

  it('自定义符号：$9.9', () => {
    expect(formatCurrency(9.9, { symbol: '$', unit: '' })).toBe('$9.9')
  })

  it('非有限数回落空串（不渲染 NaN / Infinity）', () => {
    expect(formatCurrency(Number.NaN)).toBe('¥')
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe('¥')
  })
})

describe('effectiveNumberBounds', () => {
  it('percent spec：未配置界时默认 0–100', () => {
    expect(effectiveNumberBounds('percent', null, null)).toEqual({ min: 0, max: 100 })
    expect(effectiveNumberBounds('percent', undefined, undefined)).toEqual({ min: 0, max: 100 })
  })

  it('percent spec：用户显式配置的界优先（复用 ADR-0055 通道）', () => {
    expect(effectiveNumberBounds('percent', 10, 90)).toEqual({ min: 10, max: 90 })
    expect(effectiveNumberBounds('percent', 10, null)).toEqual({ min: 10, max: 100 })
  })

  it('非 percent spec：原样透传（null 归一）', () => {
    expect(effectiveNumberBounds('currency', null, null)).toEqual({ min: null, max: null })
    expect(effectiveNumberBounds(undefined, 0, 10)).toEqual({ min: 0, max: 10 })
  })
})
