import { describe, it, expect } from 'vitest'
import { serializeQuery, parseQuery } from '@/core/query/serialize'
import type { ViewQuery } from '@/core/query'

const sample: ViewQuery = {
  version: 1,
  filter: {
    combinator: 'and',
    negate: false,
    children: [
      { field: 'status', op: 'is', value: 'open' },
      {
        combinator: 'or',
        children: [
          { field: 'name', op: 'contains', value: 'task' },
          { field: 'score', op: 'gt', value: 5 },
        ],
      },
    ],
  },
  sort: [{ field: 'score', dir: 'desc' }],
  groupBy: 'status',
}

describe('往返保真', () => {
  it('serialize → parse 还原等效 ViewQuery', () => {
    const round = parseQuery(serializeQuery(sample))
    expect(round).toEqual(sample)
  })

  it('序列化结果带 version: 1', () => {
    const json = serializeQuery(sample)
    expect(JSON.parse(json).version).toBe(1)
  })
})

describe('默认值兜底', () => {
  it('缺失 filter 补空组', () => {
    const q = parseQuery(JSON.stringify({ version: 1 }))
    expect(q.filter).toEqual({ combinator: 'and', children: [] })
  })
  it('缺失 sort 补空数组', () => {
    const q = parseQuery('{"version":1,"filter":{"combinator":"and","children":[]}}')
    expect(q.sort).toEqual([])
  })
  it('缺失 groupBy 补 null', () => {
    const q = parseQuery('{"version":1,"filter":{"combinator":"and","children":[]}}')
    expect(q.groupBy).toBeNull()
  })
})

describe('残缺 / 未知字段不抛错', () => {
  it('非法 JSON 返回默认查询', () => {
    expect(() => parseQuery('{not json')).not.toThrow()
    const q = parseQuery('{not json')
    expect(q.filter).toEqual({ combinator: 'and', children: [] })
    expect(q.sort).toEqual([])
    expect(q.groupBy).toBeNull()
  })
  it('filter 为非对象时退化为空组', () => {
    const q = parseQuery('{"version":1,"filter":"broken"}')
    expect(q.filter).toEqual({ combinator: 'and', children: [] })
  })
  it('嵌套组结构被递归归一（非组子节点当作条件）', () => {
    const q = parseQuery(
      JSON.stringify({
        version: 1,
        filter: {
          combinator: 'or',
          children: [
            { field: 'a', op: 'is', value: 1 },
            { combinator: 'and', children: [{ field: 'b', op: 'is', value: 2 }] },
          ],
        },
      }),
    )
    expect(q.filter.combinator).toBe('or')
    expect(q.filter.children).toHaveLength(2)
  })
})

describe('version 字段', () => {
  it('读取并保留 version（供未来迁移分支）', () => {
    const q = parseQuery('{"version":1,"filter":{"combinator":"and","children":[]}}')
    expect(q.version).toBe(1)
  })
})
