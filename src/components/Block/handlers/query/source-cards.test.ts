import { describe, expect, it } from 'vitest'

import type { BlockCard } from '../../../../wasm/types'
import { excludeEmptyCards, isEmptyCard } from './source-cards'

function card(over: Partial<BlockCard> = {}): BlockCard {
  return {
    block_id: 'b1',
    page_id: 'p1',
    parent_id: '',
    content_preview: '',
    properties: {},
    date_refs: [],
    tags: [],
    updated_at: 1,
    created_at: 1,
    ...over,
  }
}

describe('isEmptyCard', () => {
  it('有正文文本 → 非空', () => {
    expect(isEmptyCard(card({ content_preview: '写点东西' }))).toBe(false)
  })

  it('正文只有空白 → 空（content_preview 已被 Rust trim，这里兜手工构造的脏值）', () => {
    expect(isEmptyCard(card({ content_preview: '   ' }))).toBe(true)
  })

  it('无正文无挂载 → 空', () => {
    expect(isEmptyCard(card())).toBe(true)
  })

  it('只有属性没有正文 → 仍判空（块内列表读不出它是谁，属数据卫生问题）', () => {
    expect(isEmptyCard(card({ properties: { status: 'Todo', priority: 'Low' } }))).toBe(true)
  })

  it('只有日期引用没有正文 → 仍判空（{{deadline}} 被 preview 剥成空串）', () => {
    expect(
      isEmptyCard(
        card({
          date_refs: [
            { kind: 'deadline', iso: '2026-12-01', date_day: '2026-12-01', recurrence: '', event_ts: 0 },
          ],
        }),
      ),
    ).toBe(true)
  })
})

describe('excludeEmptyCards', () => {
  it('剔空保序、保留原对象引用', () => {
    const a = card({ block_id: 'a', content_preview: '甲' })
    const b = card({ block_id: 'b' })
    const c = card({ block_id: 'c', content_preview: '丙' })

    const out = excludeEmptyCards([a, b, c])

    expect(out.map((x) => x.block_id)).toEqual(['a', 'c'])
    expect(out[0]).toBe(a)
    expect(out[1]).toBe(c)
  })

  it('全空 → 空数组', () => {
    expect(excludeEmptyCards([card(), card({ block_id: 'b2' })])).toEqual([])
  })
})
