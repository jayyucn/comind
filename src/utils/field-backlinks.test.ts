/**
 * extractFieldBacklinks（字段引用反链聚合）纯函数测试（issue T3 AC4）。
 */
import { describe, it, expect } from 'vitest'
import { extractFieldBacklinks } from './field-backlinks'
import type { FieldValue } from '../types/field-value'

function row(over: Partial<FieldValue> & { id: string; key: string }): FieldValue {
  return {
    block_id: 'b-x',
    field_definition_id: over.key,
    value_json: '',
    value_type: 'string',
    seq: 0,
    created_at: 1,
    updated_at: 1,
    version: 0,
    deleted_at: null,
    ...over,
  }
}

const cache = new Map<string, FieldValue[]>([
  // 命中：page 类型 + 值 = 目标页 id
  ['b1', [row({ id: 'v1', key: 'ref', value_json: 'p-target', value_type: 'page' })]],
  // 非 page 类型同值：不命中
  ['b2', [row({ id: 'v2', key: 'note', value_json: 'p-target' })]],
  // page 类型但指向别的页：对 p-target 不命中
  ['b3', [row({ id: 'v3', key: 'ref', value_json: 'p-other', value_type: 'page' })]],
  // 同块多字段引用同一页：块级去重，key 取首个命中
  ['b4', [
    row({ id: 'v4', key: 'a', value_json: 'p-target', value_type: 'page' }),
    row({ id: 'v5', key: 'b', value_json: 'p-target', value_type: 'page' }),
    row({ id: 'v6', key: 'c', value_json: 'p-target', value_type: 'page', deleted_at: 9 }),
  ]],
  // 仅软删行命中：不计
  ['b5', [row({ id: 'v7', key: 'ref', value_json: 'p-target', value_type: 'page', deleted_at: 9 })]],
])

describe('extractFieldBacklinks（字段引用反链聚合）', () => {
  it('value_type=page 且值=目标页 id 的块命中', () => {
    expect(extractFieldBacklinks(cache, 'p-target')).toEqual([
      { blockId: 'b1', key: 'ref' },
      { blockId: 'b4', key: 'a' },
    ])
  })

  it('指向其他页的引用单独命中', () => {
    expect(extractFieldBacklinks(cache, 'p-other')).toEqual([{ blockId: 'b3', key: 'ref' }])
  })

  it('非 page 类型 / 软删行 / 空目标页 id 不命中', () => {
    // b2（string 同值）与 b5（仅软删行）都不出现
    const hits = extractFieldBacklinks(cache, 'p-target')
    expect(hits.map((h) => h.blockId)).not.toContain('b2')
    expect(hits.map((h) => h.blockId)).not.toContain('b5')
    expect(extractFieldBacklinks(cache, '')).toEqual([])
  })

  it('空缓存返回空数组', () => {
    expect(extractFieldBacklinks(new Map(), 'p-target')).toEqual([])
  })

  // ── person 特化（issue T10 AC4）─────────────────────────────

  it('spec=person 的 page 值（负责人字段）同样命中——判定按 value_type 全量生效，不区分特化', () => {
    // person 字段落库即 page 类型（值 = person 页 id），extractFieldBacklinks 对其天然生效；
    // 本用例钉死该契约，防止未来按 spec 收窄判定时悄悄破坏负责人反链。
    const personCache = new Map<string, FieldValue[]>([
      ['b9', [row({ id: 'v9', key: 'ownerRef', value_json: 'p-person-1', value_type: 'page' })]],
    ])
    expect(extractFieldBacklinks(personCache, 'p-person-1')).toEqual([
      { blockId: 'b9', key: 'ownerRef' },
    ])
  })
})
