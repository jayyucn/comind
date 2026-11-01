import { describe, it, expect } from 'vitest'
import { orderFieldsByColumns } from './field-order'
import type { FieldDescriptor } from '../../core/query'

const FIELDS: FieldDescriptor[] = [
  { key: 'title', label: '标题', type: 'string', get: () => '' },
  { key: 'type', label: '类型', type: 'select', get: () => '' },
  { key: 'createdAt', label: '创建日期', type: 'date', get: () => '' },
  { key: 'status', label: '状态', type: 'select', get: () => '' },
]

const keys = (fields: FieldDescriptor[]) => fields.map((f) => f.key)

describe('orderFieldsByColumns', () => {
  it('已用列字段按列顺序前置，其余字段保持注册表原序', () => {
    expect(keys(orderFieldsByColumns(FIELDS, ['status', 'createdAt']))).toEqual([
      'status',
      'createdAt',
      'title',
      'type',
    ])
  })

  it('列 key 不在字段池内（陈旧列配置）时忽略，不产出空洞', () => {
    expect(keys(orderFieldsByColumns(FIELDS, ['ghost', 'type']))).toEqual([
      'type',
      'title',
      'createdAt',
      'status',
    ])
  })

  it('无列配置 → 原序（仍返回新数组，不泄漏入参引用）', () => {
    const out = orderFieldsByColumns(FIELDS, [])
    expect(keys(out)).toEqual(keys(FIELDS))
    expect(out).not.toBe(FIELDS)
  })

  it('不修改入参', () => {
    const snapshot = keys(FIELDS)
    orderFieldsByColumns(FIELDS, ['status'])
    expect(keys(FIELDS)).toEqual(snapshot)
  })
})
