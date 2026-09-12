import { describe, it, expect } from 'vitest'
import { computeDepthDelta, computeSortPosition } from './useDragDrop'

function createMockRect(options: {
  left?: number
  right?: number
  top?: number
  bottom?: number
  width?: number
  height?: number
}): DOMRect {
  const left = options.left ?? 100
  const width = options.width ?? 50
  const top = options.top ?? 100
  const height = options.height ?? 30
  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect
}

describe('computeDepthDelta', () => {
  // 刻度 step=44，锚点 left=100：中列 [78, 122)
  const step = 44
  const anchorLeft = 100

  it('returns 0 when cursor is within a half step of the anchor（垂直拖动常态）', () => {
    expect(computeDepthDelta(100, anchorLeft, step)).toBe(0)
    expect(computeDepthDelta(110, anchorLeft, step)).toBe(0)
    expect(computeDepthDelta(90, anchorLeft, step)).toBe(0)
  })

  it('returns +1 at/beyond the right half step（降级为子级）', () => {
    expect(computeDepthDelta(121, anchorLeft, step)).toBe(0)
    expect(computeDepthDelta(122, anchorLeft, step)).toBe(1)
    expect(computeDepthDelta(200, anchorLeft, step)).toBe(1)
  })

  it('returns -1 at/beyond the left half step（提升一级）', () => {
    expect(computeDepthDelta(79, anchorLeft, step)).toBe(0)
    expect(computeDepthDelta(78, anchorLeft, step)).toBe(-1)
    expect(computeDepthDelta(0, anchorLeft, step)).toBe(-1)
  })

  it('clamps to a single level（本轮不启用多级切换）', () => {
    expect(computeDepthDelta(anchorLeft + step * 2, anchorLeft, step)).toBe(1)
    expect(computeDepthDelta(anchorLeft - step * 2, anchorLeft, step)).toBe(-1)
  })
})

describe('computeSortPosition', () => {
  it('returns before when cursor is above center', () => {
    const rect = createMockRect({ top: 100, height: 40 })
    expect(computeSortPosition(100, rect)).toBe('before')
    expect(computeSortPosition(119, rect)).toBe('before')
  })

  it('returns after when cursor is at or below center', () => {
    const rect = createMockRect({ top: 100, height: 40 })
    expect(computeSortPosition(120, rect)).toBe('after')
    expect(computeSortPosition(140, rect)).toBe('after')
  })

  it('returns after at exact center', () => {
    const rect = createMockRect({ top: 100, height: 40 })
    expect(computeSortPosition(120, rect)).toBe('after')
  })

  it('handles odd height values', () => {
    const rect = createMockRect({ top: 100, height: 41 })
    expect(computeSortPosition(120, rect)).toBe('before')
    expect(computeSortPosition(121, rect)).toBe('after')
  })

  it('handles even height values', () => {
    const rect = createMockRect({ top: 100, height: 42 })
    expect(computeSortPosition(120, rect)).toBe('before')
    expect(computeSortPosition(121, rect)).toBe('after')
  })

  it('handles single pixel height', () => {
    const rect = createMockRect({ top: 100, height: 1 })
    expect(computeSortPosition(100, rect)).toBe('before')
    expect(computeSortPosition(101, rect)).toBe('after')
  })
})
