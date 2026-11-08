import { describe, expect, test } from 'vitest'

import type { Block } from '../types/block'
import { serializeBlockTree } from './serialize-block-tree'

function mk(
  id: string,
  parentId: string | null,
  pos: number,
  opts: { type?: Block['type']; content?: string; format?: Record<string, unknown> } = {}
): Block {
  return {
    id,
    pageId: 'page-1',
    parentId,
    pos,
    content: opts.content ?? '',
    format: opts.format ?? {},
    type: opts.type ?? 'bullet',
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('serializeBlockTree — 表格块', () => {
  test('跳过表格节点，不降级为 bullet，保留同级其他块', () => {
    const blocks = [
      mk('root', null, 1000, { content: '根' }),
      mk('t', 'root', 2000, { type: 'table', format: { table: { rows: [['a']], header: true } } }),
      mk('b', 'root', 3000, { content: '后一个' }),
    ]

    const tmpl = serializeBlockTree(blocks, 'root')
    expect(tmpl[0].content).toBe('根')
    expect(tmpl[0].children?.map(child => child.content)).toEqual(['后一个'])
  })

  test('表格作为根 → 空模板', () => {
    expect(serializeBlockTree([mk('t', null, 1000, { type: 'table' })], 't')).toEqual([])
  })
})
