import { describe, it, expect } from 'vitest'
import { getNodeStyle, getEdgeStyle, getNodeState, NODE_STYLES, EDGE_STYLES } from '../graphStyle'
import type { NodeData } from '@antv/g6'

function makeNode(data: Record<string, unknown>): NodeData {
  return { id: 'test', data }
}

describe('graphStyle', () => {

  // =====================
  // getNodeState
  // =====================
  describe('getNodeState', () => {
    it('returns "current" when isCurrent is true', () => {
      const node = makeNode({ isCurrent: true })
      expect(getNodeState(node)).toBe('current')
    })

    it('returns "highlighted" when isHighlighted is true (no isCurrent)', () => {
      const node = makeNode({ isHighlighted: true })
      expect(getNodeState(node)).toBe('highlighted')
    })

    it('returns "filtered" when isFiltered is true (no current/highlighted)', () => {
      const node = makeNode({ isFiltered: true })
      expect(getNodeState(node)).toBe('filtered')
    })

    it('returns "default" when no flags are set', () => {
      const node = makeNode({})
      expect(getNodeState(node)).toBe('default')
    })

    it('priority: isCurrent > isHighlighted > isFiltered', () => {
      expect(getNodeState(makeNode({ isCurrent: true, isHighlighted: true, isFiltered: true }))).toBe('current')
      expect(getNodeState(makeNode({ isCurrent: false, isHighlighted: true, isFiltered: true }))).toBe('highlighted')
      expect(getNodeState(makeNode({ isCurrent: false, isHighlighted: false, isFiltered: true }))).toBe('filtered')
    })
  })

  // =====================
  // getNodeStyle
  // =====================
  describe('getNodeStyle', () => {
    it('returns current config for isCurrent node', () => {
      const style = getNodeStyle(makeNode({ isCurrent: true }))
      expect(style).toEqual(NODE_STYLES.current)
      expect(style.size).toEqual([120, 36])
      expect(style.fill).toBe('#1890ff')
      expect(style.fontWeight).toBe(600)
    })

    it('returns highlighted config for isHighlighted node', () => {
      const style = getNodeStyle(makeNode({ isHighlighted: true }))
      expect(style).toEqual(NODE_STYLES.highlighted)
      expect(style.size).toEqual([100, 32])
      expect(style.fill).toBe('#e6f7ff')
      expect(style.fontWeight).toBe(500)
    })

    it('returns filtered config for isFiltered node', () => {
      const style = getNodeStyle(makeNode({ isFiltered: true }))
      expect(style).toEqual(NODE_STYLES.filtered)
      expect(style.size).toEqual([90, 28])
      expect(style.fill).toBe('#808080')
      expect(style.fillOpacity).toBe(0.15)
      expect(style.fontWeight).toBe(400)
    })

    it('returns default config for plain node', () => {
      const style = getNodeStyle(makeNode({}))
      expect(style).toEqual(NODE_STYLES.default)
      expect(style.size).toEqual([90, 28])
      expect(style.fill).toBe('#ffffff')
      expect(style.fontWeight).toBe(400)
    })

    it('priority: isCurrent overrides isHighlighted', () => {
      const style = getNodeStyle(makeNode({ isCurrent: true, isHighlighted: true }))
      expect(style).toEqual(NODE_STYLES.current)
    })

    it('priority: isHighlighted overrides isFiltered', () => {
      const style = getNodeStyle(makeNode({ isHighlighted: true, isFiltered: true }))
      expect(style).toEqual(NODE_STYLES.highlighted)
    })
  })

  // =====================
  // getEdgeStyle
  // =====================
  describe('getEdgeStyle', () => {
    it('returns filtered config when isFiltered is true', () => {
      const edge = { data: { isFiltered: true } }
      expect(getEdgeStyle(edge)).toEqual(EDGE_STYLES.filtered)
      expect(getEdgeStyle(edge).stroke).toBe('#808080')
      expect(getEdgeStyle(edge).strokeOpacity).toBe(0.25)
    })

    it('returns default config when isFiltered is not set', () => {
      const edge = { data: {} }
      expect(getEdgeStyle(edge)).toEqual(EDGE_STYLES.default)
      expect(getEdgeStyle(edge).stroke).toBe('#8c8c8c')
      expect(getEdgeStyle(edge).strokeOpacity).toBe(1)
    })

    it('returns default config when data is undefined', () => {
      const edge = { data: undefined }
      expect(getEdgeStyle(edge)).toEqual(EDGE_STYLES.default)
    })
  })

  // =====================
  // Config table integrity
  // =====================
  describe('NODE_STYLES config', () => {
    it('all states have lineType "solid"', () => {
      for (const state of Object.keys(NODE_STYLES) as Array<keyof typeof NODE_STYLES>) {
        expect(NODE_STYLES[state].lineType).toBe('solid')
      }
    })

    it('all states have valid size tuples', () => {
      for (const state of Object.keys(NODE_STYLES) as Array<keyof typeof NODE_STYLES>) {
        expect(NODE_STYLES[state].size).toHaveLength(2)
        expect(NODE_STYLES[state].size[0]).toBeGreaterThan(0)
        expect(NODE_STYLES[state].size[1]).toBeGreaterThan(0)
      }
    })
  })

  describe('EDGE_STYLES config', () => {
    it('all states have valid stroke colors', () => {
      for (const state of Object.keys(EDGE_STYLES) as Array<keyof typeof EDGE_STYLES>) {
        expect(EDGE_STYLES[state].stroke).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    })
  })
})
