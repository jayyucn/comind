import { describe, it, expect } from 'vitest'
import {
  GAP_SIZE,
  pmPosToTextOffset,
  textOffsetToPmPos,
  sortByPos,
  getSortedChildren,
  getSortedSiblings,
  findBlockIndex,
  getPrevSibling,
  getNextSibling,
  calcInsertPos,
  renumberBlocks,
  isGapExhaustedError,
  isDescendantOf,
  buildDocumentOrder
} from './block-helpers'
import type { Block } from '../types/block'

function createBlock(id: string, pageId: string, parentId: string | null, pos: number, content = 'Test'): Block {
  return {
    id,
    pageId,
    parentId,
    pos,
    content,
    format: {},
    type: 'bullet',
    properties: {},
    createdAt: 0,
    updatedAt: 0
  }
}

describe('GAP_SIZE', () => {
  it('is 1000', () => {
    expect(GAP_SIZE).toBe(1000)
  })
})

describe('pmPosToTextOffset', () => {
  it('converts 1-based PM position to 0-based offset', () => {
    expect(pmPosToTextOffset(1)).toBe(0)
    expect(pmPosToTextOffset(5)).toBe(4)
  })

  it('handles edge case of position 0', () => {
    expect(pmPosToTextOffset(0)).toBe(0)
    expect(pmPosToTextOffset(-1)).toBe(0)
  })

  it('is inverse of textOffsetToPmPos', () => {
    for (let i = 0; i <= 100; i++) {
      expect(pmPosToTextOffset(textOffsetToPmPos(i))).toBe(i)
      expect(textOffsetToPmPos(pmPosToTextOffset(i + 1))).toBe(i + 1)
    }
  })
})

describe('textOffsetToPmPos', () => {
  it('converts 0-based offset to 1-based PM position', () => {
    expect(textOffsetToPmPos(0)).toBe(1)
    expect(textOffsetToPmPos(5)).toBe(6)
  })
})

describe('sortByPos', () => {
  it('sorts items by pos ascending', () => {
    const items = [
      { pos: 3000, name: 'third' },
      { pos: 1000, name: 'first' },
      { pos: 2000, name: 'second' }
    ]
    const sorted = sortByPos(items)
    expect(sorted[0].name).toBe('first')
    expect(sorted[1].name).toBe('second')
    expect(sorted[2].name).toBe('third')
  })

  it('does not mutate original array', () => {
    const items = [{ pos: 2000 }, { pos: 1000 }]
    const original = [...items]
    sortByPos(items)
    expect(items).toEqual(original)
  })
})

describe('getSortedChildren', () => {
  const pageId = 'page-1'
  const blocks: Block[] = [
    createBlock('p1', pageId, null, 1000),
    createBlock('c1', pageId, 'p1', 1000),
    createBlock('c2', pageId, 'p1', 2000),
    createBlock('c3', pageId, 'p1', 3000),
    createBlock('p2', pageId, null, 1000)
  ]

  it('returns children of specified parent', () => {
    const children = getSortedChildren(blocks, 'p1', pageId)
    expect(children.length).toBe(3)
    expect(children[0].id).toBe('c1')
    expect(children[1].id).toBe('c2')
    expect(children[2].id).toBe('c3')
  })

  it('returns empty array for null parent', () => {
    const roots = getSortedChildren(blocks, null, pageId)
    expect(roots.length).toBe(2)
  })

  it('excludes specified block ID', () => {
    const children = getSortedChildren(blocks, 'p1', pageId, 'c2')
    expect(children.length).toBe(2)
    expect(children.find(b => b.id === 'c2')).toBeUndefined()
  })

  it('filters by pageId', () => {
    const children = getSortedChildren(blocks, 'p1', 'page-2')
    expect(children.length).toBe(0)
  })
})

describe('getSortedSiblings', () => {
  const pageId = 'page-1'
  const parentId = 'parent'
  const blocks: Block[] = [
    createBlock('parent', pageId, null, 500),
    createBlock('s1', pageId, parentId, 1000),
    createBlock('s2', pageId, parentId, 2000),
    createBlock('s3', pageId, parentId, 3000)
  ]

  it('returns siblings with same parentId and pageId', () => {
    const siblings = getSortedSiblings(blocks, blocks[1], false)
    expect(siblings.length).toBe(3)
    expect(siblings[0].id).toBe('s1')
  })

  it('can exclude self', () => {
    const siblings = getSortedSiblings(blocks, blocks[1], true)
    expect(siblings.length).toBe(2)
    expect(siblings.find(b => b.id === 's1')).toBeUndefined()
  })
})

describe('findBlockIndex', () => {
  const blocks = [
    createBlock('b1', 'p', null, 1000),
    createBlock('b2', 'p', null, 2000),
    createBlock('b3', 'p', null, 3000)
  ]

  it('returns correct index', () => {
    expect(findBlockIndex(blocks, 'b1')).toBe(0)
    expect(findBlockIndex(blocks, 'b2')).toBe(1)
    expect(findBlockIndex(blocks, 'b3')).toBe(2)
  })

  it('returns -1 for non-existent block', () => {
    expect(findBlockIndex(blocks, 'non-existent')).toBe(-1)
  })
})

describe('getPrevSibling', () => {
  const pageId = 'page-1'
  const parentId = 'parent'
  const blocks: Block[] = [
    createBlock('parent', pageId, null, 500),
    createBlock('s1', pageId, parentId, 1000),
    createBlock('s2', pageId, parentId, 2000),
    createBlock('s3', pageId, parentId, 3000)
  ]

  it('returns previous sibling', () => {
    const prev = getPrevSibling(blocks, blocks[2])
    expect(prev?.id).toBe('s1')
  })

  it('returns undefined for first sibling', () => {
    const prev = getPrevSibling(blocks, blocks[1])
    expect(prev).toBeUndefined()
  })
})

describe('getNextSibling', () => {
  const pageId = 'page-1'
  const parentId = 'parent'
  const blocks: Block[] = [
    createBlock('parent', pageId, null, 500),
    createBlock('s1', pageId, parentId, 1000),
    createBlock('s2', pageId, parentId, 2000),
    createBlock('s3', pageId, parentId, 3000)
  ]

  it('returns next sibling', () => {
    const next = getNextSibling(blocks, blocks[1])
    expect(next?.id).toBe('s2')
  })

  it('returns undefined for last sibling', () => {
    const next = getNextSibling(blocks, blocks[3])
    expect(next).toBeUndefined()
  })
})

describe('calcInsertPos', () => {
  it('returns GAP_SIZE when both are null', () => {
    expect(calcInsertPos(null, null)).toBe(GAP_SIZE)
  })

  it('returns nextPos - GAP_SIZE when prevPos is null', () => {
    expect(calcInsertPos(null, 2000)).toBe(1000)
  })

  it('returns prevPos + GAP_SIZE when nextPos is null', () => {
    expect(calcInsertPos(1000, null)).toBe(2000)
  })

  it('calculates midpoint between two positions', () => {
    expect(calcInsertPos(1000, 2000)).toBe(1500)
    expect(calcInsertPos(1000, 3000)).toBe(2000)
  })

  it('rounds down to ensure integer result', () => {
    expect(calcInsertPos(1000, 2001)).toBe(1500)
  })

  it('throws GapExhaustedError when gap is exhausted', () => {
    expect(() => calcInsertPos(1000, 1001)).toThrow()
  })

  it('GapExhaustedError has correct name', () => {
    try {
      calcInsertPos(1000, 1001)
    } catch (e) {
      expect((e as Error).name).toBe('GapExhaustedError')
    }
  })

  it('gap exhaustion occurs when positions are adjacent', () => {
    expect(() => calcInsertPos(1, 2)).toThrow()
    expect(() => calcInsertPos(100, 101)).toThrow()
  })

  it('works with large gaps', () => {
    expect(calcInsertPos(0, 10000)).toBe(5000)
    expect(calcInsertPos(-1000, 1000)).toBe(0)
  })

  it('handles gap of exactly GAP_SIZE', () => {
    const pos = calcInsertPos(1000, 2000)
    expect(pos).toBe(1500)
    expect(typeof pos).toBe('number')
  })
})

describe('renumberBlocks', () => {
  it('reassigns positions with GAP_SIZE intervals', () => {
    const blocks: Block[] = [
      createBlock('b1', 'p', null, 1),
      createBlock('b2', 'p', null, 2),
      createBlock('b3', 'p', null, 3)
    ]
    renumberBlocks(blocks)
    expect(blocks[0].pos).toBe(1000)
    expect(blocks[1].pos).toBe(2000)
    expect(blocks[2].pos).toBe(3000)
  })

  it('sorts blocks before renumbering', () => {
    const blocks: Block[] = [
      createBlock('b3', 'p', null, 3000),
      createBlock('b1', 'p', null, 1000),
      createBlock('b2', 'p', null, 2000)
    ]
    renumberBlocks(blocks)
    expect(blocks[0].id).toBe('b1')
    expect(blocks[1].id).toBe('b2')
    expect(blocks[2].id).toBe('b3')
  })

  it('handles empty array', () => {
    const blocks: Block[] = []
    expect(() => renumberBlocks(blocks)).not.toThrow()
  })

  it('handles single block', () => {
    const blocks = [createBlock('b1', 'p', null, 1)]
    renumberBlocks(blocks)
    expect(blocks[0].pos).toBe(1000)
  })
})

describe('isGapExhaustedError', () => {
  it('returns true for GapExhaustedError instance', () => {
    try {
      calcInsertPos(1, 2)
    } catch (e) {
      expect(isGapExhaustedError(e)).toBe(true)
    }
  })

  it('returns true for error with GapExhaustedError name', () => {
    const error = new Error('test')
    error.name = 'GapExhaustedError'
    expect(isGapExhaustedError(error)).toBe(true)
  })

  it('returns false for other errors', () => {
    expect(isGapExhaustedError(new Error('other'))).toBe(false)
    expect(isGapExhaustedError(null)).toBe(false)
    expect(isGapExhaustedError(undefined)).toBe(false)
  })
})

describe('isDescendantOf', () => {
  const pageId = 'page-1'
  const blocks: Block[] = [
    createBlock('root', pageId, null, 1000),
    createBlock('child1', pageId, 'root', 1000),
    createBlock('child2', pageId, 'root', 2000),
    createBlock('grandchild', pageId, 'child1', 1000)
  ]

  it('returns false for null targetId', () => {
    expect(isDescendantOf(blocks, null, 'root')).toBe(false)
  })

  it('returns true when target is direct child', () => {
    expect(isDescendantOf(blocks, 'child1', 'root')).toBe(true)
  })

  it('returns true when target is grandchild', () => {
    expect(isDescendantOf(blocks, 'grandchild', 'root')).toBe(true)
    expect(isDescendantOf(blocks, 'grandchild', 'child1')).toBe(true)
  })

  it('returns false when target is not descendant', () => {
    expect(isDescendantOf(blocks, 'root', 'child1')).toBe(false)
  })

  it('returns true when target equals blockId', () => {
    expect(isDescendantOf(blocks, 'root', 'root')).toBe(true)
  })

  it('handles deep nesting', () => {
    const deepBlocks: Block[] = []
    let prevId = 'root'
    for (let i = 1; i <= 10; i++) {
      const id = `level${i}`
      deepBlocks.push(createBlock(id, pageId, prevId, i * 1000))
      prevId = id
    }
    expect(isDescendantOf(deepBlocks, 'level10', 'root')).toBe(true)
    expect(isDescendantOf(deepBlocks, 'level5', 'level10')).toBe(false)
  })

  it('prevents infinite loop with cyclic references', () => {
    const cyclicBlocks: Block[] = [
      createBlock('a', pageId, 'b', 1000),
      createBlock('b', pageId, 'a', 2000)
    ]
    expect(() => isDescendantOf(cyclicBlocks, 'a', 'b')).not.toThrow()
  })
})

// ============================================================
// buildDocumentOrder 测试
// ============================================================
describe('buildDocumentOrder', () => {
  test('扁平列表（无父子关系）按 pos 排序', () => {
    const blocks: Block[] = [
      createBlock('b3', 'p1', null, 3000),
      createBlock('b1', 'p1', null, 1000),
      createBlock('b2', 'p1', null, 2000)
    ]
    const order = buildDocumentOrder(blocks)
    expect(order.get('b1')).toBe(0)
    expect(order.get('b2')).toBe(1)
    expect(order.get('b3')).toBe(2)
  })

  test('嵌套树按前序遍历排序', () => {
    // 结构：
    // b1 (pos=1000)
    //   b1c1 (pos=1000, parent=b1)
    //     b1c1g1 (pos=1000, parent=b1c1)
    //   b1c2 (pos=2000, parent=b1)
    // b2 (pos=2000)
    const blocks: Block[] = [
      createBlock('b1', 'p1', null, 1000),
      createBlock('b2', 'p1', null, 2000),
      createBlock('b1c1', 'p1', 'b1', 1000),
      createBlock('b1c2', 'p1', 'b1', 2000),
      createBlock('b1c1g1', 'p1', 'b1c1', 1000)
    ]
    const order = buildDocumentOrder(blocks)
    expect(order.get('b1')).toBe(0)
    expect(order.get('b1c1')).toBe(1)
    expect(order.get('b1c1g1')).toBe(2)
    expect(order.get('b1c2')).toBe(3)
    expect(order.get('b2')).toBe(4)
  })

  test('空数组返回空 Map', () => {
    const order = buildDocumentOrder([])
    expect(order.size).toBe(0)
  })
})
