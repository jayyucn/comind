import { describe, it, expect } from 'vitest'
import { formatPropertyValue, inferPropertyType } from './property'

describe('formatPropertyValue', () => {
  it('formats string values', () => {
    expect(formatPropertyValue('进行中', 'string')).toBe('进行中')
    expect(formatPropertyValue('  hello  ', 'string')).toBe('hello')
  })

  it('formats number values', () => {
    expect(formatPropertyValue(42, 'number')).toBe(42)
    expect(formatPropertyValue('42', 'number')).toBe(42)
    expect(formatPropertyValue('3.14', 'number')).toBe(3.14)
    expect(formatPropertyValue('invalid', 'number')).toBeNull()
  })

  it('formats boolean values', () => {
    expect(formatPropertyValue(true, 'boolean')).toBe(true)
    expect(formatPropertyValue(false, 'boolean')).toBe(false)
    expect(formatPropertyValue('true', 'boolean')).toBe(true)
    expect(formatPropertyValue('false', 'boolean')).toBe(false)
    expect(formatPropertyValue('yes', 'boolean')).toBeNull()
  })

  it('formats date values', () => {
    expect(formatPropertyValue('2026-04-20', 'date')).toBe('2026-04-20')
    expect(formatPropertyValue('April 20, 2026', 'date')).toBeDefined() // 会尝试解析
  })

  it('formats array values', () => {
    expect(formatPropertyValue(['a', 'b', 'c'], 'array')).toEqual(['a', 'b', 'c'])
    expect(formatPropertyValue('[a, b, c]', 'array')).toEqual(['a', 'b', 'c'])
    expect(formatPropertyValue('single item', 'array')).toEqual(['single item'])
  })

  it('formats page reference values', () => {
    expect(formatPropertyValue('[[页面名]]', 'page')).toBe('[[页面名]]')
    expect(formatPropertyValue('页面名', 'page')).toBe('页面名')
  })
})

describe('inferPropertyType', () => {
  it('infers boolean type', () => {
    expect(inferPropertyType('true')).toBe('boolean')
    expect(inferPropertyType('false')).toBe('boolean')
  })

  it('infers number type', () => {
    expect(inferPropertyType('42')).toBe('number')
    expect(inferPropertyType('3.14')).toBe('number')
  })

  it('infers date type', () => {
    expect(inferPropertyType('2026-04-20')).toBe('date')
  })

  it('infers array type', () => {
    expect(inferPropertyType('[a, b, c]')).toBe('array')
  })

  it('infers page type', () => {
    expect(inferPropertyType('[[页面名]]')).toBe('page')
  })

  it('defaults to string type', () => {
    expect(inferPropertyType('进行中')).toBe('string')
    expect(inferPropertyType('普通文本')).toBe('string')
  })
})
