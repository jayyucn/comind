import { describe, it, expect } from 'vitest'
import { computeDropZone, computeSortPosition, DRAG_THRESHOLD } from './useDragDrop'

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

describe('DRAG_THRESHOLD', () => {
  it('has reasonable default values', () => {
    expect(DRAG_THRESHOLD.LEFT).toBe(15)
    expect(DRAG_THRESHOLD.RIGHT).toBe(15)
  })
})

describe('computeDropZone', () => {
  it('returns left when cursor is in left zone', () => {
    const rect = createMockRect({ left: 100, width: 50 })
    expect(computeDropZone(50, rect)).toBe('left')
    expect(computeDropZone(85, rect)).toBe('left')
  })

  it('returns right when cursor is in right zone', () => {
    const rect = createMockRect({ left: 100, width: 50 })
    expect(computeDropZone(185, rect)).toBe('right')
    expect(computeDropZone(200, rect)).toBe('right')
  })

  it('returns center when cursor is in middle zone', () => {
    const rect = createMockRect({ left: 100, width: 50 })
    expect(computeDropZone(116, rect)).toBe('center')
    expect(computeDropZone(130, rect)).toBe('center')
    expect(computeDropZone(134, rect)).toBe('center')
  })

  it('returns left at exact left threshold boundary', () => {
    const rect = createMockRect({ left: 100, width: 50 })
    expect(computeDropZone(115, rect)).toBe('left')
  })

  it('returns right at exact right threshold boundary', () => {
    const rect = createMockRect({ left: 100, width: 50 })
    expect(computeDropZone(135, rect)).toBe('right')
  })

  it('handles narrow bullet widths', () => {
    const rect = createMockRect({ left: 100, width: 10 })
    // left zone (x <= 115), right zone (x >= 95). The left condition takes priority.
    expect(computeDropZone(100, rect)).toBe('left')
    expect(computeDropZone(105, rect)).toBe('left')
    expect(computeDropZone(110, rect)).toBe('left')
  })

  it('handles wide bullet widths', () => {
    const rect = createMockRect({ left: 100, width: 200 })
    expect(computeDropZone(100, rect)).toBe('left')
    expect(computeDropZone(114, rect)).toBe('left')
    expect(computeDropZone(115, rect)).toBe('left')
    expect(computeDropZone(116, rect)).toBe('center')
    expect(computeDropZone(284, rect)).toBe('center')
    expect(computeDropZone(285, rect)).toBe('right')
    expect(computeDropZone(300, rect)).toBe('right')
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
