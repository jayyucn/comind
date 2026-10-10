import { describe, test, expect, vi } from 'vitest'
import { encodeFieldValueData, decodeFieldValueData } from './field-value-codec'

describe('field-value-codec encodeFieldValueData', () => {
  test('string/page 直通存原文', () => {
    expect(encodeFieldValueData('Todo', 'string')).toBe('Todo')
    expect(encodeFieldValueData('page-123', 'page')).toBe('page-123')
  })

  test('直通分支对非 string 入参兜底 String() 强转（DB 值恒为字符串）', () => {
    expect(encodeFieldValueData(42, 'string')).toBe('42')
    expect(encodeFieldValueData(true, 'page')).toBe('true')
  })

  test('number/boolean/date/array 按 type JSON 编码', () => {
    expect(encodeFieldValueData(42, 'number')).toBe('42')
    expect(encodeFieldValueData(true, 'boolean')).toBe('true')
    expect(encodeFieldValueData('2026-09-15', 'date')).toBe('"2026-09-15"')
    expect(encodeFieldValueData(['a', 'b'], 'array')).toBe('["a","b"]')
  })

  test('select/datetime 直通存原文（值即字符串，与 string 行为一致；issue #140）', () => {
    expect(encodeFieldValueData('Done', 'select')).toBe('Done')
    expect(encodeFieldValueData('2026-09-15 10:44', 'datetime')).toBe('2026-09-15 10:44')
  })

  test('multiSelect 按 JSON 编码（值为选项 id 数组）', () => {
    expect(encodeFieldValueData(['a', 'b'], 'multiSelect')).toBe('["a","b"]')
  })

  test('类型保真：number 型属性传字符串按 type 忠实编码（不静默变型）', () => {
    // 行为变化点（#117 明示）：旧按值编码存裸 42 → 读回变 number；
    // 新按 type 编码存 "\"42\"" → 读回仍是字符串
    expect(encodeFieldValueData('42', 'number')).toBe('"42"')
  })

  test('未知 type 按 JSON 编码（防御未知扩展）', () => {
    expect(encodeFieldValueData(42, 'mystery' as never)).toBe('42')
  })
})

describe('field-value-codec decodeFieldValueData', () => {
  test('string/page 直通返回原字符串', () => {
    expect(decodeFieldValueData('Todo', 'string')).toBe('Todo')
    expect(decodeFieldValueData('page-123', 'page')).toBe('page-123')
  })

  test('number/boolean/date/array 按 type 解码', () => {
    expect(decodeFieldValueData('42', 'number')).toBe(42)
    expect(decodeFieldValueData('true', 'boolean')).toBe(true)
    expect(decodeFieldValueData('"2026-09-15"', 'date')).toBe('2026-09-15')
    expect(decodeFieldValueData('["a","b"]', 'array')).toEqual(['a', 'b'])
  })

  test('select/datetime 直通返回原字符串，multiSelect 解码为数组（issue #140）', () => {
    expect(decodeFieldValueData('Done', 'select')).toBe('Done')
    expect(decodeFieldValueData('2026-09-15 10:44', 'datetime')).toBe('2026-09-15 10:44')
    expect(decodeFieldValueData('["a","b"]', 'multiSelect')).toEqual(['a', 'b'])
  })

  test('非法 JSON 容错：返回原字符串 + console.warn，不 throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(decodeFieldValueData('{oops', 'number')).toBe('{oops')
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
      // 新收口类型（issue #140）
      ['Done', 'select'],
      ['2026-09-15 10:44', 'datetime'],
      [['a', 'b'], 'multiSelect'],
    ]
    for (const [value, type] of cases) {
      expect(decodeFieldValueData(encodeFieldValueData(value, type), type)).toEqual(value)
    }
  })
})
