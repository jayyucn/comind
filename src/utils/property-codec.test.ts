import { describe, test, expect, vi } from 'vitest'
import { encodePropertyValue, decodePropertyValue } from './property-codec'

describe('property-codec encodePropertyValue', () => {
  test('string/page 直通存原文', () => {
    expect(encodePropertyValue('Todo', 'string')).toBe('Todo')
    expect(encodePropertyValue('page-123', 'page')).toBe('page-123')
  })

  test('直通分支对非 string 入参兜底 String() 强转（DB 值恒为字符串）', () => {
    expect(encodePropertyValue(42, 'string')).toBe('42')
    expect(encodePropertyValue(true, 'page')).toBe('true')
  })

  test('number/boolean/date/array 按 type JSON 编码', () => {
    expect(encodePropertyValue(42, 'number')).toBe('42')
    expect(encodePropertyValue(true, 'boolean')).toBe('true')
    expect(encodePropertyValue('2026-09-15', 'date')).toBe('"2026-09-15"')
    expect(encodePropertyValue(['a', 'b'], 'array')).toBe('["a","b"]')
  })

  test('类型保真：number 型属性传字符串按 type 忠实编码（不静默变型）', () => {
    // 行为变化点（#117 明示）：旧按值编码存裸 42 → 读回变 number；
    // 新按 type 编码存 "\"42\"" → 读回仍是字符串
    expect(encodePropertyValue('42', 'number')).toBe('"42"')
  })

  test('未知 type 按 JSON 编码（防御未知扩展）', () => {
    expect(encodePropertyValue(42, 'mystery' as never)).toBe('42')
  })
})

describe('property-codec decodePropertyValue', () => {
  test('string/page 直通返回原字符串', () => {
    expect(decodePropertyValue('Todo', 'string')).toBe('Todo')
    expect(decodePropertyValue('page-123', 'page')).toBe('page-123')
  })

  test('number/boolean/date/array 按 type 解码', () => {
    expect(decodePropertyValue('42', 'number')).toBe(42)
    expect(decodePropertyValue('true', 'boolean')).toBe(true)
    expect(decodePropertyValue('"2026-09-15"', 'date')).toBe('2026-09-15')
    expect(decodePropertyValue('["a","b"]', 'array')).toEqual(['a', 'b'])
  })

  test('非法 JSON 容错：返回原字符串 + console.warn，不 throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(decodePropertyValue('{oops', 'number')).toBe('{oops')
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
    }
  })

  test('编解码往返自洽（每 type）', () => {
    const cases: Array<[unknown, string]> = [
      ['Todo', 'string'],
      ['page-1', 'page'],
      [42, 'number'],
      [true, 'boolean'],
      ['2026-09-15', 'date'],
      [['a', 'b'], 'array'],
    ]
    for (const [value, type] of cases) {
      expect(decodePropertyValue(encodePropertyValue(value, type), type)).toEqual(value)
    }
  })
})
