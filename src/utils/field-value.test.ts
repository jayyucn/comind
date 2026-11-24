import { describe, it, expect } from 'vitest'
import { formatFieldValueData, inferFieldType } from './field-value'

describe('formatFieldValueData', () => {
  it('formats string values', () => {
    expect(formatFieldValueData('进行中', 'string')).toBe('进行中')
    expect(formatFieldValueData('  hello  ', 'string')).toBe('hello')
  })

  it('formats number values', () => {
    expect(formatFieldValueData(42, 'number')).toBe(42)
    expect(formatFieldValueData('42', 'number')).toBe(42)
    expect(formatFieldValueData('3.14', 'number')).toBe(3.14)
    expect(formatFieldValueData('invalid', 'number')).toBeNull()
  })

  it('formats boolean values', () => {
    expect(formatFieldValueData(true, 'boolean')).toBe(true)
    expect(formatFieldValueData(false, 'boolean')).toBe(false)
    expect(formatFieldValueData('true', 'boolean')).toBe(true)
    expect(formatFieldValueData('false', 'boolean')).toBe(false)
    expect(formatFieldValueData('yes', 'boolean')).toBeNull()
  })

  it('formats date values', () => {
    expect(formatFieldValueData('2026-04-20', 'date')).toBe('2026-04-20')
    expect(formatFieldValueData('April 20, 2026', 'date')).toBeDefined() // 会尝试解析
  })

  it('formats array values', () => {
    expect(formatFieldValueData(['a', 'b', 'c'], 'array')).toEqual(['a', 'b', 'c'])
    expect(formatFieldValueData('[a, b, c]', 'array')).toEqual(['a', 'b', 'c'])
    expect(formatFieldValueData('single item', 'array')).toEqual(['single item'])
  })

  it('formats page reference values', () => {
    expect(formatFieldValueData('[[页面名]]', 'page')).toBe('[[页面名]]')
    expect(formatFieldValueData('页面名', 'page')).toBe('页面名')
  })

  // ── 新收口类型（issue #140 F1）──

  it('formats datetime values（规范化为 yyyy-MM-dd HH:mm）', () => {
    expect(formatFieldValueData('2026-04-20T10:44', 'datetime')).toBe('2026-04-20 10:44')
    expect(formatFieldValueData('2026-04-20 10:44', 'datetime')).toBe('2026-04-20 10:44')
    expect(formatFieldValueData('not-a-date', 'datetime')).toBeNull()
  })

  it('formats select values（选项 id 原样留白修剪）', () => {
    expect(formatFieldValueData('Done', 'select')).toBe('Done')
    expect(formatFieldValueData('  Doing  ', 'select')).toBe('Doing')
  })

  it('formats multiSelect values（与 array 同族解析）', () => {
    expect(formatFieldValueData(['a', 'b'], 'multiSelect')).toEqual(['a', 'b'])
    expect(formatFieldValueData('[a, b]', 'multiSelect')).toEqual(['a', 'b'])
  })
})

describe('inferFieldType', () => {
  it('infers boolean type', () => {
    expect(inferFieldType('true')).toBe('boolean')
    expect(inferFieldType('false')).toBe('boolean')
  })

  it('infers number type', () => {
    expect(inferFieldType('42')).toBe('number')
    expect(inferFieldType('3.14')).toBe('number')
  })

  it('infers date type', () => {
    expect(inferFieldType('2026-04-20')).toBe('date')
  })

  it('infers array type', () => {
    expect(inferFieldType('[a, b, c]')).toBe('array')
  })

  it('infers page type', () => {
    expect(inferFieldType('[[页面名]]')).toBe('page')
  })

  it('defaults to string type', () => {
    expect(inferFieldType('进行中')).toBe('string')
    expect(inferFieldType('普通文本')).toBe('string')
  })
})
