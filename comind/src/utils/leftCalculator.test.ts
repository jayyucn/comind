import { describe, it, expect } from 'vitest'
import {
  calculateNewLeft,
  calculateOutdentLeft,
  calculateIndentLeft,
  reindexLeftValues,
  validateLeftValues
} from './leftCalculator'

describe('calculateNewLeft', () => {
  it('returns 100 for empty siblings', () => {
    expect(calculateNewLeft([])).toBe(100)
  })

  it('returns 100 for empty siblings when insertAfterId is provided', () => {
    expect(calculateNewLeft([], 'any-id')).toBe(100)
  })

  it('calculates correct position for insertion at end', () => {
    const siblings = [{ left: 100 }, { left: 200 }, { left: 300 }]
    expect(calculateNewLeft(siblings)).toBe(400)
  })

  it('calculates correct position after specific block', () => {
    const siblings = [{ id: 'a', left: 100 }, { id: 'b', left: 200 }, { id: 'c', left: 300 }]
    expect(calculateNewLeft(siblings, 'a')).toBe(150)
    expect(calculateNewLeft(siblings, 'b')).toBe(250)
  })

  it('handles unsorted siblings', () => {
    const siblings = [{ id: 'c', left: 300 }, { id: 'a', left: 100 }, { id: 'b', left: 200 }]
    expect(calculateNewLeft(siblings, 'a')).toBe(150)
  })

  it('inserts at end if insertAfterId not found', () => {
    const siblings = [{ id: 'a', left: 100 }]
    expect(calculateNewLeft(siblings, 'non-existent')).toBe(200)
  })

  it('inserts at end if insertAfterId is last sibling', () => {
    const siblings = [{ id: 'a', left: 100 }, { id: 'b', left: 200 }]
    expect(calculateNewLeft(siblings, 'b')).toBe(300)
  })

  it('calculates midpoint between siblings', () => {
    const siblings = [{ id: 'a', left: 100 }, { id: 'c', left: 200 }]
    expect(calculateNewLeft(siblings, 'a')).toBe(150)
  })
})

describe('calculateOutdentLeft', () => {
  it('returns parent left + 100 for empty siblings', () => {
    const parent = { left: 100 }
    expect(calculateOutdentLeft(parent, [])).toBe(200)
  })

  it('finds correct insertion point after parent', () => {
    const parent = { left: 100 }
    const siblings = [{ left: 200 }, { left: 300 }, { left: 400 }]
    const result = calculateOutdentLeft(parent, siblings)
    expect(result).toBe(150)
  })

  it('finds correct insertion point between siblings', () => {
    const parent = { left: 100 }
    const siblings = [{ left: 50 }, { left: 200 }, { left: 300 }]
    const result = calculateOutdentLeft(parent, siblings)
    expect(result).toBe(125)
  })

  it('handles siblings all with left less than parent', () => {
    const parent = { left: 300 }
    const siblings = [{ left: 100 }, { left: 200 }]
    const result = calculateOutdentLeft(parent, siblings)
    expect(result).toBe(300)
  })

  it('handles single sibling with left greater than parent', () => {
    const parent = { left: 100 }
    const siblings = [{ left: 200 }]
    const result = calculateOutdentLeft(parent, siblings)
    expect(result).toBe(150)
  })
})

describe('calculateIndentLeft', () => {
  it('returns parent left + 100 for empty children', () => {
    const parent = { left: 100 }
    expect(calculateIndentLeft(parent, [])).toBe(200)
  })

  it('returns last child left + 100 for existing children', () => {
    const parent = { left: 100 }
    const siblings = [{ left: 200 }, { left: 300 }]
    expect(calculateIndentLeft(parent, siblings)).toBe(400)
  })

  it('handles unsorted children', () => {
    const parent = { left: 100 }
    const siblings = [{ left: 300 }, { left: 200 }]
    expect(calculateIndentLeft(parent, siblings)).toBe(400)
  })

  it('handles single child', () => {
    const parent = { left: 100 }
    const siblings = [{ left: 200 }]
    expect(calculateIndentLeft(parent, siblings)).toBe(300)
  })
})

describe('reindexLeftValues', () => {
  it('reindexes empty array', () => {
    const blocks: any[] = []
    const result = reindexLeftValues(blocks)
    expect(result).toEqual([])
  })

  it('reindexes blocks with 100 increments', () => {
    const blocks = [
      { id: 'a', parentId: null, left: 50 },
      { id: 'b', parentId: null, left: 100 }
    ]
    const result = reindexLeftValues(blocks)
    expect(result).toContainEqual({ id: 'a', left: 100 })
    expect(result).toContainEqual({ id: 'b', left: 200 })
  })

  it('handles nested blocks separately', () => {
    const blocks = [
      { id: 'root', parentId: null, left: 500 },
      { id: 'child', parentId: 'root', left: 600 }
    ]
    const result = reindexLeftValues(blocks)
    expect(result).toContainEqual({ id: 'root', left: 100 })
    expect(result).toContainEqual({ id: 'child', left: 100 })
  })

  it('returns array with id and left only', () => {
    const blocks = [
      { id: 'a', parentId: null, left: 100, content: 'test' }
    ]
    const result = reindexLeftValues(blocks)
    expect(Object.keys(result[0])).toEqual(['id', 'left'])
  })
})

describe('validateLeftValues', () => {
  it('returns true for valid left values', () => {
    const blocks = [
      { parentId: null, left: 100 },
      { parentId: null, left: 200 }
    ]
    expect(validateLeftValues(blocks)).toBe(true)
  })

  it('returns false for duplicate left values in same parent', () => {
    const blocks = [
      { parentId: null, left: 100 },
      { parentId: null, left: 100 }
    ]
    expect(validateLeftValues(blocks)).toBe(false)
  })

  it('allows same left values in different parents', () => {
    const blocks = [
      { parentId: 'a', left: 100 },
      { parentId: 'b', left: 100 }
    ]
    expect(validateLeftValues(blocks)).toBe(true)
  })

  it('returns true for empty array', () => {
    expect(validateLeftValues([])).toBe(true)
  })

  it('detects duplicate in nested structure', () => {
    const blocks = [
      { parentId: null, left: 100 },
      { parentId: null, left: 200 },
      { parentId: 'parent', left: 100 }
    ]
    expect(validateLeftValues(blocks)).toBe(true)
  })
})
