import { describe, expect, it } from 'vitest'
import { isQuadrantCard } from './quadrant-filter'
import type { BlockCard } from '../../wasm/types'

function card(p: Partial<BlockCard>): BlockCard {
  return {
    block_id: 'b1',
    page_id: 'p1',
    content_preview: '任务',
    tags: [],
    properties: {},
    parent_id: '',
    created_at: 0,
    updated_at: 0,
    ...p,
  } as BlockCard
}

describe('isQuadrantCard (quadrant inclusion is tag-independent)', () => {
  it('includes a card with priority + status but NO task tag', () => {
    // 复现 /midium 类回归：设了 priority+status，但编辑器防抖/任何原因没挂上 #任务
    const c = card({ properties: { priority: 'Medium', status: 'Todo' }, tags: [] })
    expect(isQuadrantCard(c)).toBe(true)
  })

  it('excludes a card that has the task tag but no priority', () => {
    const c = card({ tags: ['sys-tag-system-task'], properties: { status: 'Todo' } })
    expect(isQuadrantCard(c)).toBe(false)
  })

  it('excludes a card with priority but no status', () => {
    const c = card({ properties: { priority: 'Urgent' }, tags: [] })
    expect(isQuadrantCard(c)).toBe(false)
  })

  it('excludes a card with an unknown priority value', () => {
    const c = card({ properties: { priority: 'Someday', status: 'Todo' }, tags: [] })
    expect(isQuadrantCard(c)).toBe(false)
  })

  it('excludes a card with empty content (block id fallback is not a title)', () => {
    // content 为空的块即使具备 priority + status + 任务 tag 也不入矩阵——
    // 视图渲染会回退显示 block id（QuadrantView 的 `content_preview || idOf`）。
    const empty = card({ properties: { priority: 'High', status: 'Todo' }, tags: ['task-tag'], content_preview: '' })
    expect(isQuadrantCard(empty)).toBe(false)
    const whitespace = card({ properties: { priority: 'High', status: 'Todo' }, content_preview: '   ' })
    expect(isQuadrantCard(whitespace)).toBe(false)
  })

  it('applies the search query against content_preview (case-insensitive)', () => {
    const c = card({ properties: { priority: 'Low', status: 'Doing' }, content_preview: '买牛奶' })
    expect(isQuadrantCard(c, '牛奶')).toBe(true)
    expect(isQuadrantCard(c, '咖啡')).toBe(false)
  })

  it('still includes tagged tasks (no regression to D4-tagged cards)', () => {
    const c = card({ tags: ['sys-tag-system-task'], properties: { priority: 'High', status: 'Done' } })
    expect(isQuadrantCard(c)).toBe(true)
  })
})
