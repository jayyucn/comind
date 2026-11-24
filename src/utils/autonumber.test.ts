import { describe, expect, it } from 'vitest'
import type { FieldValue } from '../types/field-value'
import { computeNextAutonumber } from './autonumber'

function row(key: string, valueType: string, value_json: string): FieldValue {
  return {
    id: `${key}-${value_json}`,
    block_id: 'b',
    key,
    value_type: valueType,
    value_json,
    created_at: 0,
    updated_at: 0,
    version: 1,
    deleted_at: null,
  } as unknown as FieldValue
}

describe('computeNextAutonumber（issue T12 自增编号）', () => {
  it('无任何行时返回 1', () => {
    expect(computeNextAutonumber([], 'seq')).toBe(1)
  })

  it('取现存最大值 +1', () => {
    const rows = [
      row('seq', 'autonumber', '3'),
      row('seq', 'autonumber', '1'),
      row('seq', 'autonumber', '5'),
    ]
    expect(computeNextAutonumber(rows, 'seq')).toBe(6)
  })

  it('忽略其它 key 与非 autonumber 行', () => {
    const rows = [
      row('seq', 'autonumber', '2'),
      row('other', 'autonumber', '99'),
      row('seq', 'number', '7'),
      row('seq', 'autonumber', '4'),
    ]
    expect(computeNextAutonumber(rows, 'seq')).toBe(5)
  })

  it('跨块摊平后唯一性：连续取号不重复', () => {
    // 模拟先写入 1，再为第二个块取号应为 2
    const afterFirst = [row('seq', 'autonumber', '1')]
    expect(computeNextAutonumber(afterFirst, 'seq')).toBe(2)
    const afterSecond = [...afterFirst, row('seq', 'autonumber', '2')]
    expect(computeNextAutonumber(afterSecond, 'seq')).toBe(3)
  })
})
