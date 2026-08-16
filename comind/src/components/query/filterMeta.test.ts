import { describe, it, expect } from 'vitest'
import { opLabel, defaultOpFor, summarizeCondition, formatLiteral } from './filterMeta'
import type { Condition, FieldDescriptor } from '../../core/query'

const selectField: FieldDescriptor<string> = {
  key: 'type', label: '类型', type: 'select',
  options: [{ id: 'normal', label: '普通' }, { id: 'ideas', label: '灵感' }],
  get: () => 'normal',
}
const dateField: FieldDescriptor<string> = {
  key: 'createdAt', label: '创建日期', type: 'date', get: () => '2026-01-01',
}
const multiField: FieldDescriptor<string> = {
  key: 'aliases', label: '别名', type: 'multiSelect',
  options: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }],
  get: () => [],
}

describe('filterMeta', () => {
  it('opLabel maps known ops to Chinese', () => {
    expect(opLabel('is')).toBe('是')
    expect(opLabel('between')).toBe('介于')
    expect(opLabel('isNotEmpty')).toBe('不为空')
  })

  it('defaultOpFor returns first derived op for the field type', () => {
    expect(defaultOpFor(selectField)).toBe('is')
    expect(defaultOpFor(dateField)).toBe('before')
  })

  it('formatLiteral maps select id to label', () => {
    expect(formatLiteral(selectField, 'ideas')).toBe('灵感')
  })

  it('formatLiteral renders date between range', () => {
    expect(formatLiteral(dateField, ['2026-01-01', '2026-02-01'])).toBe('2026-01-01 ~ 2026-02-01')
  })

  it('formatLiteral joins multiSelect labels', () => {
    expect(formatLiteral(multiField, ['a', 'b'])).toBe('甲、乙')
  })

  it('summarizeCondition: 字段 操作符 值', () => {
    const cond: Condition = { field: 'type', op: 'is', value: { kind: 'literal', value: 'normal' } }
    expect(summarizeCondition(selectField, cond)).toBe('类型 是 普通')
  })

  it('summarizeCondition: empty-check op has no value', () => {
    const cond: Condition = { field: 'type', op: 'isEmpty' }
    expect(summarizeCondition(selectField, cond)).toBe('类型 为空')
  })
})
