import { describe, it, expect } from 'vitest'
import {
  computeVisibility,
  isEdgeDimmed,
  DEFAULT_FILTER_STATE,
  EMPTY_VISIBILITY,
  type FilterState,
  type SelectorNode,
  type SelectorEdge,
} from '../graphSelectors'

// ---- helpers ----

function makePage(overrides: Partial<SelectorNode> = {}): SelectorNode {
  return {
    id: 'page-1',
    title: 'Test Page',
    type: 'normal',
    updatedAt: Date.now(),
    createdAt: Date.now(),
    deleted: false,
    ...overrides,
  }
}

function makeEdge(overrides: Partial<SelectorEdge> = {}): SelectorEdge {
  return {
    id: 'edge-1',
    sourcePageId: 'page-a',
    targetPageId: 'page-b',
    relationshipType: 'related',
    ...overrides,
  }
}

const NO_FILTER: FilterState = {
  search: '',
  relationshipTypes: [],
  timeRange: { start: null, end: null },
  showIdeas: true,
  dimIsolated: false,
}

// ---- 测试数据 ----

const pages: SelectorNode[] = [
  { id: 'a', title: 'Alpha', type: 'normal', updatedAt: 1000, createdAt: 1000, deleted: false },
  { id: 'b', title: 'Beta', type: 'normal', updatedAt: 2000, createdAt: 2000, deleted: false },
  { id: 'c', title: 'Gamma', type: 'ideas', updatedAt: 3000, createdAt: 3000, deleted: false },
  { id: 'd', title: 'Delta', type: 'normal', updatedAt: 4000, createdAt: 4000, deleted: false },
  { id: 'e', title: 'Epsilon', type: 'normal', updatedAt: 5000, createdAt: 5000, deleted: false }, // 孤立节点
  { id: 'del', title: 'Deleted', type: 'normal', updatedAt: 6000, createdAt: 6000, deleted: true },
]

const edges: SelectorEdge[] = [
  { id: 'e1', sourcePageId: 'a', targetPageId: 'b', relationshipType: 'related' },
  { id: 'e2', sourcePageId: 'a', targetPageId: 'c', relationshipType: 'family' },
  { id: 'e3', sourcePageId: 'b', targetPageId: 'd', relationshipType: 'work' },
  // page-e 没有边
  // page-del 跳过
]

// ============================================================
// computeVisibility
// ============================================================

describe('computeVisibility', () => {

  // ---- 无筛选 ----
  describe('no filter', () => {
    it('returns empty visibility when no filter conditions are active', () => {
      const result = computeVisibility(pages, edges, NO_FILTER)
      expect(result.hiddenNodeIds.size).toBe(0)
      expect(result.dimmedNodeIds.size).toBe(0)
      expect(result.hiddenEdgeIds.size).toBe(0)
    })

    it('ignores deleted pages', () => {
      const result = computeVisibility(pages, edges, NO_FILTER)
      expect(result.hiddenNodeIds.has('del')).toBe(false)
      expect(result.dimmedNodeIds.has('del')).toBe(false)
    })
  })

  // ---- showIdeas ----
  describe('showIdeas', () => {
    it('hides ideas pages when showIdeas is false', () => {
      const filter = { ...NO_FILTER, showIdeas: false }
      const result = computeVisibility(pages, edges, filter)
      expect(result.hiddenNodeIds.has('c')).toBe(true)
      expect(result.hiddenNodeIds.has('a')).toBe(false)
    })

    it('does not hide ideas when showIdeas is true', () => {
      const filter = { ...NO_FILTER, showIdeas: true }
      const result = computeVisibility(pages, edges, filter)
      expect(result.hiddenNodeIds.has('c')).toBe(false)
    })
  })

  // ---- search ----
  describe('search', () => {
    it('dims nodes whose title does not match', () => {
      const filter = { ...NO_FILTER, search: 'alpha' }
      const result = computeVisibility(pages, edges, filter)
      expect(result.dimmedNodeIds.has('a')).toBe(false) // matches
      expect(result.dimmedNodeIds.has('b')).toBe(true)  // no match
      expect(result.dimmedNodeIds.has('e')).toBe(true)  // no match
    })

    it('is case-insensitive', () => {
      const filter = { ...NO_FILTER, search: 'ALPHA' }
      const result = computeVisibility(pages, edges, filter)
      expect(result.dimmedNodeIds.has('a')).toBe(false)
    })

    it('does not dim when search is empty', () => {
      const filter = { ...NO_FILTER, search: '' }
      const result = computeVisibility(pages, edges, filter)
      expect(result.dimmedNodeIds.size).toBe(0)
    })

    it('does not dim when search is whitespace only', () => {
      const filter = { ...NO_FILTER, search: '   ' }
      const result = computeVisibility(pages, edges, filter)
      expect(result.dimmedNodeIds.size).toBe(0)
    })
  })

  // ---- timeRange ----
  describe('timeRange', () => {
    it('dims nodes with updatedAt before start', () => {
      const filter = {
        ...NO_FILTER,
        timeRange: { start: 2500, end: null },
      }
      const result = computeVisibility(pages, edges, filter)
      expect(result.dimmedNodeIds.has('a')).toBe(true)  // updatedAt=1000 < 2500
      expect(result.dimmedNodeIds.has('b')).toBe(true)  // updatedAt=2000 < 2500
      expect(result.dimmedNodeIds.has('c')).toBe(false) // updatedAt=3000 >= 2500
    })

    it('dims nodes with updatedAt >= end', () => {
      const filter = {
        ...NO_FILTER,
        timeRange: { start: null, end: 3500 },
      }
      const result = computeVisibility(pages, edges, filter)
      expect(result.dimmedNodeIds.has('a')).toBe(false) // updatedAt=1000 < 3500
      expect(result.dimmedNodeIds.has('c')).toBe(false) // updatedAt=3000 < 3500
      expect(result.dimmedNodeIds.has('d')).toBe(true)  // updatedAt=4000 >= 3500
    })

    it('dims nodes outside [start, end) range', () => {
      const filter = {
        ...NO_FILTER,
        timeRange: { start: 2000, end: 4000 },
      }
      const result = computeVisibility(pages, edges, filter)
      // a=1000 < 2000 → dimmed
      // b=2000 >= 2000 and < 4000 → ok
      // c=3000 >= 2000 and < 4000 → ok
      // d=4000 >= 4000 → dimmed
      expect(result.dimmedNodeIds.has('a')).toBe(true)
      expect(result.dimmedNodeIds.has('b')).toBe(false)
      expect(result.dimmedNodeIds.has('c')).toBe(false)
      expect(result.dimmedNodeIds.has('d')).toBe(true)
    })

    it('falls back to createdAt when updatedAt is 0', () => {
      const pagesWithZeroUpdatedAt: SelectorNode[] = [
        { id: 'x', title: 'X', type: 'normal', updatedAt: 0, createdAt: 5000, deleted: false },
      ]
      const filter = {
        ...NO_FILTER,
        timeRange: { start: 3000, end: null },
      }
      const result = computeVisibility(pagesWithZeroUpdatedAt, [], filter)
      // updatedAt=0, fallback to createdAt=5000 >= 3000 → not dimmed
      expect(result.dimmedNodeIds.has('x')).toBe(false)
    })
  })

  // ---- relationshipTypes ----
  describe('relationshipTypes', () => {
    it('hides edges of unselected types', () => {
      const filter = { ...NO_FILTER, relationshipTypes: ['family'] }
      const result = computeVisibility(pages, edges, filter)
      // e1=related → hidden, e2=family → visible, e3=work → hidden
      expect(result.hiddenEdgeIds.has('e1')).toBe(true)
      expect(result.hiddenEdgeIds.has('e2')).toBe(false)
      expect(result.hiddenEdgeIds.has('e3')).toBe(true)
    })

    it('dims nodes without any selected-type edges', () => {
      const filter = { ...NO_FILTER, relationshipTypes: ['family'] }
      const result = computeVisibility(pages, edges, filter)
      // a has e2(family) → not dimmed
      // b has e1(related, hidden) + e3(work, hidden) → no visible edges → dimmed
      // c has e2(family, as target) → not dimmed
      // d has e3(work, hidden) → no visible edges → dimmed
      // e has no edges → dimmed (no selected type edges)
      expect(result.dimmedNodeIds.has('a')).toBe(false)
      expect(result.dimmedNodeIds.has('b')).toBe(true)
      expect(result.dimmedNodeIds.has('c')).toBe(false)
      expect(result.dimmedNodeIds.has('d')).toBe(true)
      expect(result.dimmedNodeIds.has('e')).toBe(true)
    })

    it('does not hide any edges when relationshipTypes is empty', () => {
      const filter = { ...NO_FILTER, relationshipTypes: [] }
      const result = computeVisibility(pages, edges, filter)
      expect(result.hiddenEdgeIds.size).toBe(0)
    })

    it('treats null relationshipType as "related"', () => {
      const edgesWithNull: SelectorEdge[] = [
        { id: 'en1', sourcePageId: 'a', targetPageId: 'b', relationshipType: null },
      ]
      const filter = { ...NO_FILTER, relationshipTypes: ['related'] }
      const result = computeVisibility(pages, edgesWithNull, filter)
      expect(result.hiddenEdgeIds.has('en1')).toBe(false) // null → 'related', matches
    })
  })

  // ---- dimIsolated ----
  describe('dimIsolated', () => {
    it('dims isolated nodes when dimIsolated is true', () => {
      const filter = { ...NO_FILTER, dimIsolated: true }
      const result = computeVisibility(pages, edges, filter)
      // e has no edges → dimmed
      expect(result.dimmedNodeIds.has('e')).toBe(true)
      // a has edges → not dimmed
      expect(result.dimmedNodeIds.has('a')).toBe(false)
    })

    it('does not dim isolated nodes when dimIsolated is false', () => {
      const filter = { ...NO_FILTER, dimIsolated: false }
      const result = computeVisibility(pages, edges, filter)
      expect(result.dimmedNodeIds.has('e')).toBe(false)
    })

    it('dims nodes that become isolated after edge filtering', () => {
      // Select 'family' only → e1(related) and e3(work) are hidden
      // b becomes isolated (only had e1 and e3) → should be dimmed by dimIsolated
      const filter = { ...NO_FILTER, relationshipTypes: ['family'], dimIsolated: true }
      const result = computeVisibility(pages, edges, filter)
      expect(result.dimmedNodeIds.has('b')).toBe(true)
    })
  })

  // ---- hidden > dimmed 优先级 ----
  describe('priority: hidden > dimmed', () => {
    it('hidden takes priority over dimmed', () => {
      // c is ideas + title doesn't match 'alpha'
      const filter: FilterState = {
        search: 'alpha',
        relationshipTypes: [],
        timeRange: { start: null, end: null },
        showIdeas: false,
        dimIsolated: false,
      }
      const result = computeVisibility(pages, edges, filter)
      // c is hidden (ideas), not dimmed
      expect(result.hiddenNodeIds.has('c')).toBe(true)
      expect(result.dimmedNodeIds.has('c')).toBe(false)
    })
  })

  // ---- 组合：多条件 AND ----
  describe('multiple conditions (AND)', () => {
    it('dims node if ANY condition fails', () => {
      const filter: FilterState = {
        search: 'alpha',
        relationshipTypes: [],
        timeRange: { start: null, end: null },
        showIdeas: true,
        dimIsolated: false,
      }
      const result = computeVisibility(pages, edges, filter)
      // a matches search → not dimmed
      // b doesn't match search → dimmed
      expect(result.dimmedNodeIds.has('a')).toBe(false)
      expect(result.dimmedNodeIds.has('b')).toBe(true)
    })

    it('dims node if both search and time fail', () => {
      const filter: FilterState = {
        search: 'nonexistent',
        relationshipTypes: [],
        timeRange: { start: 9000, end: null },
        showIdeas: true,
        dimIsolated: false,
      }
      const result = computeVisibility(pages, edges, filter)
      // All non-deleted pages fail both conditions
      for (const page of pages) {
        if (page.deleted) continue
        if (page.id === 'del') continue
        expect(result.dimmedNodeIds.has(page.id)).toBe(true)
      }
    })
  })

  // ---- 空数据 ----
  describe('empty data', () => {
    it('handles empty nodes and edges', () => {
      const result = computeVisibility([], [], NO_FILTER)
      expect(result.hiddenNodeIds.size).toBe(0)
      expect(result.dimmedNodeIds.size).toBe(0)
      expect(result.hiddenEdgeIds.size).toBe(0)
    })
  })
})

// ============================================================
// isEdgeDimmed
// ============================================================

describe('isEdgeDimmed', () => {
  it('returns true when source is dimmed', () => {
    const dimmed = new Set(['a'])
    expect(isEdgeDimmed({ sourcePageId: 'a', targetPageId: 'b' }, dimmed)).toBe(true)
  })

  it('returns true when target is dimmed', () => {
    const dimmed = new Set(['b'])
    expect(isEdgeDimmed({ sourcePageId: 'a', targetPageId: 'b' }, dimmed)).toBe(true)
  })

  it('returns false when neither endpoint is dimmed', () => {
    const dimmed = new Set(['c'])
    expect(isEdgeDimmed({ sourcePageId: 'a', targetPageId: 'b' }, dimmed)).toBe(false)
  })

  it('returns true when both endpoints are dimmed', () => {
    const dimmed = new Set(['a', 'b'])
    expect(isEdgeDimmed({ sourcePageId: 'a', targetPageId: 'b' }, dimmed)).toBe(true)
  })
})

// ============================================================
// 默认值
// ============================================================

describe('DEFAULT_FILTER_STATE', () => {
  it('has showIdeas=true and dimIsolated=true', () => {
    expect(DEFAULT_FILTER_STATE.showIdeas).toBe(true)
    expect(DEFAULT_FILTER_STATE.dimIsolated).toBe(true)
  })

  it('has empty search and relationshipTypes', () => {
    expect(DEFAULT_FILTER_STATE.search).toBe('')
    expect(DEFAULT_FILTER_STATE.relationshipTypes).toEqual([])
  })

  it('has null time range', () => {
    expect(DEFAULT_FILTER_STATE.timeRange.start).toBeNull()
    expect(DEFAULT_FILTER_STATE.timeRange.end).toBeNull()
  })
})

describe('EMPTY_VISIBILITY', () => {
  it('all sets are empty', () => {
    expect(EMPTY_VISIBILITY.hiddenNodeIds.size).toBe(0)
    expect(EMPTY_VISIBILITY.dimmedNodeIds.size).toBe(0)
    expect(EMPTY_VISIBILITY.hiddenEdgeIds.size).toBe(0)
  })
})
