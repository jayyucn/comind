import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock relationship module so we don't need the WASM core
vi.mock('../../../types/relationship', () => ({
  getRelationshipColor: vi.fn((type: string) => `color-${type}`),
  getRelationshipLabel: vi.fn((type: string) => `label-${type}`),
}))

import {
  createAccumulator,
  createNodeData,
  createEdgeData,
  processNeighbors,
  filterHiddenEdges,
  traverseBFS,
  buildFullGraph,
  type GraphAccumulator,
  type RawLink,
} from '../graphData'

// ---- helpers ----
function mockGetPage(id: string) {
  const pages: Record<string, { id: string; title: string; deleted: boolean }> = {
    'page-a': { id: 'page-a', title: 'Page A', deleted: false },
    'page-b': { id: 'page-b', title: 'Page B', deleted: false },
    'page-c': { id: 'page-c', title: 'Page C', deleted: false },
    'page-deleted': { id: 'page-deleted', title: 'Deleted', deleted: true },
    'root': { id: 'root', title: 'Root', deleted: false },
    'neighbor1': { id: 'neighbor1', title: 'Neighbor 1', deleted: false },
    'neighbor2': { id: 'neighbor2', title: 'Neighbor 2', deleted: false },
    'deep1': { id: 'deep1', title: 'Deep 1', deleted: false },
    'deep2': { id: 'deep2', title: 'Deep 2', deleted: false },
  }
  return pages[id]
}

function mockGetBlock(id: string) {
  const blocks: Record<string, { pageId: string }> = {
    'block-1': { pageId: 'page-b' },
    'block-2': { pageId: 'page-c' },
  }
  return blocks[id]
}

describe('graphData', () => {

  // =====================
  // createAccumulator
  // =====================
  describe('createAccumulator', () => {
    it('returns empty accumulator with all fields initialized', () => {
      const acc = createAccumulator()
      expect(acc.nodes).toEqual([])
      expect(acc.edges).toEqual([])
      expect(acc.visitedEdges.size).toBe(0)
      expect(acc.nodeIds.size).toBe(0)
      expect(acc.blockCache.size).toBe(0)
    })
  })

  // =====================
  // createNodeData
  // =====================
  describe('createNodeData', () => {
    it('creates node with correct fields', () => {
      const node = createNodeData('page-1', 'Title', true, false)
      expect(node.id).toBe('page-1')
      expect(node.data).toEqual({
        label: 'Title',
        isCurrent: true,
        isHighlighted: false,
      })
    })

    it('creates node with both flags false', () => {
      const node = createNodeData('page-2', 'Other', false, false)
      expect(node.data?.isCurrent).toBe(false)
      expect(node.data?.isHighlighted).toBe(false)
    })
  })

  // =====================
  // createEdgeData
  // =====================
  describe('createEdgeData', () => {
    it('creates edge with relationship metadata', () => {
      const edge = createEdgeData('link-1', 'src', 'tgt', 'related')
      expect(edge.id).toBe('link-1')
      expect(edge.source).toBe('src')
      expect(edge.target).toBe('tgt')
      expect(edge.data?.relationshipType).toBe('related')
      expect(edge.data?.label).toBe('label-related')
      expect(edge.data?.color).toBe('color-related')
    })
  })

  // =====================
  // processNeighbors
  // =====================
  describe('processNeighbors', () => {
    let acc: GraphAccumulator

    beforeEach(() => {
      acc = createAccumulator()
    })

    it('outlink: adds 1 node and 1 edge for a single outlink', () => {
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-b', relationshipType: 'related' },
      ]
      const neighbors = processNeighbors(
        'page-a', outLinks, [], acc, new Set(), 'page-a', null, mockGetPage, mockGetBlock
      )
      expect(neighbors).toEqual(['page-b'])
      expect(acc.nodes).toHaveLength(1)
      expect(acc.nodes[0].id).toBe('page-b')
      expect(acc.edges).toHaveLength(1)
      expect(acc.edges[0].source).toBe('page-a')
      expect(acc.edges[0].target).toBe('page-b')
    })

    it('backlink: adds 1 node and 1 edge for a single backlink', () => {
      const inLinks: RawLink[] = [
        { id: 'link-2', sourceBlockId: 'block-1', targetPageId: 'page-a', relationshipType: 'related' },
      ]
      const neighbors = processNeighbors(
        'page-a', [], inLinks, acc, new Set(), 'page-a', null, mockGetPage, mockGetBlock
      )
      expect(neighbors).toEqual(['page-b'])
      expect(acc.nodes).toHaveLength(1)
      expect(acc.nodes[0].id).toBe('page-b')
      expect(acc.edges).toHaveLength(1)
      expect(acc.edges[0].source).toBe('page-b')
      expect(acc.edges[0].target).toBe('page-a')
    })

    it('skips duplicate edges (visitedEdges)', () => {
      acc.visitedEdges.add('link-1')
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-b', relationshipType: 'related' },
      ]
      const neighbors = processNeighbors(
        'page-a', outLinks, [], acc, new Set(), 'page-a', null, mockGetPage, mockGetBlock
      )
      expect(neighbors).toEqual([])
      expect(acc.nodes).toHaveLength(0)
      expect(acc.edges).toHaveLength(0)
    })

    it('skips duplicate nodes (nodeIds)', () => {
      acc.nodeIds.add('page-b')
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-b', relationshipType: 'related' },
      ]
      const neighbors = processNeighbors(
        'page-a', outLinks, [], acc, new Set(), 'page-a', null, mockGetPage, mockGetBlock
      )
      // neighbor still returned, but node not re-added
      expect(neighbors).toEqual(['page-b'])
      expect(acc.nodes).toHaveLength(0)
      // edge is still added
      expect(acc.edges).toHaveLength(1)
    })

    it('skips hidden target pages', () => {
      const hidden = new Set(['page-b'])
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-b', relationshipType: 'related' },
      ]
      const neighbors = processNeighbors(
        'page-a', outLinks, [], acc, hidden, 'page-a', null, mockGetPage, mockGetBlock
      )
      expect(neighbors).toEqual([])
      expect(acc.nodes).toHaveLength(0)
      expect(acc.edges).toHaveLength(0)
    })

    it('blockCache hit: does not call getBlock on second use', () => {
      const getBlockSpy = vi.fn(mockGetBlock)
      const inLinks: RawLink[] = [
        { id: 'link-a', sourceBlockId: 'block-1', targetPageId: 'page-a', relationshipType: 'related' },
        { id: 'link-b', sourceBlockId: 'block-1', targetPageId: 'page-a', relationshipType: 'related' },
      ]
      // First call caches block-1, second should use cache
      processNeighbors('page-a', [], inLinks, acc, new Set(), 'page-a', null, mockGetPage, getBlockSpy)
      // getBlock called only once for block-1 (first link), second link uses cache
      expect(getBlockSpy).toHaveBeenCalledTimes(1)
    })

    it('blockCache miss: calls getBlock to get pageId', () => {
      const inLinks: RawLink[] = [
        { id: 'link-1', sourceBlockId: 'block-1', targetPageId: 'page-a', relationshipType: 'related' },
      ]
      processNeighbors('page-a', [], inLinks, acc, new Set(), 'page-a', null, mockGetPage, mockGetBlock)
      expect(acc.blockCache.has('block-1')).toBe(true)
      expect(acc.blockCache.get('block-1')?.pageId).toBe('page-b')
    })

    it('skips deleted pages', () => {
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-deleted', relationshipType: 'related' },
      ]
      const neighbors = processNeighbors(
        'page-a', outLinks, [], acc, new Set(), 'page-a', null, mockGetPage, mockGetBlock
      )
      expect(neighbors).toEqual([])
      expect(acc.nodes).toHaveLength(0)
      expect(acc.edges).toHaveLength(0)
    })

    it('defaults relationshipType to "related" when undefined', () => {
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-b' },
      ]
      processNeighbors('page-a', outLinks, [], acc, new Set(), 'page-a', null, mockGetPage, mockGetBlock)
      expect(acc.edges[0].data?.relationshipType).toBe('related')
    })

    it('skips backlink when getBlock returns undefined', () => {
      const inLinks: RawLink[] = [
        { id: 'link-x', sourceBlockId: 'unknown-block', targetPageId: 'page-a', relationshipType: 'related' },
      ]
      const neighbors = processNeighbors(
        'page-a', [], inLinks, acc, new Set(), 'page-a', null, mockGetPage, mockGetBlock
      )
      expect(neighbors).toEqual([])
      expect(acc.edges).toHaveLength(0)
    })

    it('skips backlink when source page is deleted', () => {
      const getBlockDeleted = (id: string) => {
        if (id === 'block-del') return { pageId: 'page-deleted' }
        return undefined
      }
      const inLinks: RawLink[] = [
        { id: 'link-d', sourceBlockId: 'block-del', targetPageId: 'page-a', relationshipType: 'related' },
      ]
      const neighbors = processNeighbors(
        'page-a', [], inLinks, acc, new Set(), 'page-a', null, mockGetPage, getBlockDeleted
      )
      expect(neighbors).toEqual([])
      expect(acc.nodes).toHaveLength(0)
    })

    it('sets isCurrent flag correctly for neighbor nodes', () => {
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-b', relationshipType: 'related' },
      ]
      processNeighbors('page-a', outLinks, [], acc, new Set(), 'page-b', null, mockGetPage, mockGetBlock)
      expect(acc.nodes[0].data?.isCurrent).toBe(true)
    })

    it('sets isHighlighted flag correctly for neighbor nodes', () => {
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-b', relationshipType: 'related' },
      ]
      processNeighbors('page-a', outLinks, [], acc, new Set(), null, 'page-b', mockGetPage, mockGetBlock)
      expect(acc.nodes[0].data?.isHighlighted).toBe(true)
    })
  })

  // =====================
  // filterHiddenEdges
  // =====================
  describe('filterHiddenEdges', () => {
    it('removes edge when source is hidden', () => {
      const edges = [
        { id: 'e1', source: 'hidden', target: 'visible', data: {} },
      ]
      filterHiddenEdges(edges, new Set(['hidden']))
      expect(edges).toHaveLength(0)
    })

    it('removes edge when target is hidden', () => {
      const edges = [
        { id: 'e1', source: 'visible', target: 'hidden', data: {} },
      ]
      filterHiddenEdges(edges, new Set(['hidden']))
      expect(edges).toHaveLength(0)
    })

    it('keeps edge when neither source nor target is hidden', () => {
      const edges = [
        { id: 'e1', source: 'a', target: 'b', data: {} },
      ]
      filterHiddenEdges(edges, new Set(['c']))
      expect(edges).toHaveLength(1)
    })

    it('removes multiple edges and keeps others', () => {
      const edges = [
        { id: 'e1', source: 'a', target: 'b', data: {} },
        { id: 'e2', source: 'hidden', target: 'b', data: {} },
        { id: 'e3', source: 'a', target: 'hidden', data: {} },
        { id: 'e4', source: 'c', target: 'd', data: {} },
      ]
      filterHiddenEdges(edges, new Set(['hidden']))
      expect(edges).toHaveLength(2)
      expect(edges.map(e => e.id)).toEqual(['e1', 'e4'])
    })
  })

  // =====================
  // traverseBFS
  // =====================
  describe('traverseBFS', () => {
    it('depth=0: only root node exists', async () => {
      const acc = createAccumulator()
      const fetchNeighbors = vi.fn()
      await traverseBFS('root', 0, acc, new Set(), 'root', null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes).toHaveLength(1)
      expect(acc.nodes[0].id).toBe('root')
      expect(acc.edges).toHaveLength(0)
      expect(fetchNeighbors).not.toHaveBeenCalled()
    })

    it('depth=1: root + direct neighbors', async () => {
      const acc = createAccumulator()
      const fetchNeighbors = vi.fn(async (pageId: string) => {
        if (pageId === 'root') {
          return {
            outLinks: [{ id: 'l1', targetPageId: 'neighbor1', relationshipType: 'related' }],
            inLinks: [],
          }
        }
        return { outLinks: [], inLinks: [] }
      })

      await traverseBFS('root', 1, acc, new Set(), 'root', null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes.map(n => n.id).sort()).toEqual(['neighbor1', 'root'])
      expect(acc.edges).toHaveLength(1)
      expect(acc.edges[0].source).toBe('root')
      expect(acc.edges[0].target).toBe('neighbor1')
    })

    it('depth=2: root + neighbors + neighbors of neighbors', async () => {
      const acc = createAccumulator()
      const fetchNeighbors = vi.fn(async (pageId: string) => {
        if (pageId === 'root') {
          return {
            outLinks: [{ id: 'l1', targetPageId: 'neighbor1', relationshipType: 'related' }],
            inLinks: [],
          }
        }
        if (pageId === 'neighbor1') {
          return {
            outLinks: [{ id: 'l2', targetPageId: 'deep1', relationshipType: 'related' }],
            inLinks: [],
          }
        }
        return { outLinks: [], inLinks: [] }
      })

      await traverseBFS('root', 2, acc, new Set(), 'root', null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes.map(n => n.id).sort()).toEqual(['deep1', 'neighbor1', 'root'])
      expect(acc.edges).toHaveLength(2)
    })

    it('terminates early when frontier is empty', async () => {
      const acc = createAccumulator()
      const fetchNeighbors = vi.fn(async () => ({ outLinks: [], inLinks: [] }))

      await traverseBFS('root', 5, acc, new Set(), 'root', null, mockGetPage, fetchNeighbors, mockGetBlock)

      // root has no neighbors, so fetchNeighbors is called once for root, then frontier is empty
      expect(acc.nodes).toHaveLength(1)
      expect(fetchNeighbors).toHaveBeenCalledTimes(1)
    })

    it('returns empty when root page does not exist', async () => {
      const acc = createAccumulator()
      const fetchNeighbors = vi.fn()

      await traverseBFS('nonexistent', 2, acc, new Set(), 'nonexistent', null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes).toHaveLength(0)
      expect(acc.edges).toHaveLength(0)
      expect(fetchNeighbors).not.toHaveBeenCalled()
    })

    it('does not revisit already-visited pages', async () => {
      const acc = createAccumulator()
      // root -> neighbor1, neighbor1 -> root (cycle)
      const fetchNeighbors = vi.fn(async (pageId: string) => {
        if (pageId === 'root') {
          return {
            outLinks: [{ id: 'l1', targetPageId: 'neighbor1', relationshipType: 'related' }],
            inLinks: [],
          }
        }
        if (pageId === 'neighbor1') {
          return {
            outLinks: [{ id: 'l2', targetPageId: 'root', relationshipType: 'related' }],
            inLinks: [],
          }
        }
        return { outLinks: [], inLinks: [] }
      })

      await traverseBFS('root', 3, acc, new Set(), 'root', null, mockGetPage, fetchNeighbors, mockGetBlock)

      // root should only appear once
      const rootNodes = acc.nodes.filter(n => n.id === 'root')
      expect(rootNodes).toHaveLength(1)
      // neighbor1 should only appear once
      const neighborNodes = acc.nodes.filter(n => n.id === 'neighbor1')
      expect(neighborNodes).toHaveLength(1)
    })

    it('filters hidden edges at the end', async () => {
      const acc = createAccumulator()
      const hidden = new Set(['neighbor1'])
      const fetchNeighbors = vi.fn(async (pageId: string) => {
        if (pageId === 'root') {
          return {
            outLinks: [{ id: 'l1', targetPageId: 'neighbor1', relationshipType: 'related' }],
            inLinks: [],
          }
        }
        return { outLinks: [], inLinks: [] }
      })

      await traverseBFS('root', 2, acc, hidden, 'root', null, mockGetPage, fetchNeighbors, mockGetBlock)

      // neighbor1 is hidden, so no edges
      expect(acc.nodes.map(n => n.id)).toEqual(['root'])
      expect(acc.edges).toHaveLength(0)
    })
  })

  // =====================
  // buildFullGraph
  // =====================
  describe('buildFullGraph', () => {
    it('adds all non-deleted pages as nodes', async () => {
      const acc = createAccumulator()
      const allPages = [
        { id: 'page-a', title: 'A', deleted: false },
        { id: 'page-b', title: 'B', deleted: false },
        { id: 'page-c', title: 'C', deleted: false },
      ]
      const fetchNeighbors = vi.fn(async () => ({ outLinks: [], inLinks: [] }))

      await buildFullGraph(allPages, acc, new Set(), null, null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes.map(n => n.id).sort()).toEqual(['page-a', 'page-b', 'page-c'])
    })

    it('keeps isolated nodes (no edges)', async () => {
      const acc = createAccumulator()
      const allPages = [
        { id: 'page-a', title: 'A', deleted: false },
        { id: 'page-b', title: 'B', deleted: false },
      ]
      const fetchNeighbors = vi.fn(async () => ({ outLinks: [], inLinks: [] }))

      await buildFullGraph(allPages, acc, new Set(), null, null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes).toHaveLength(2)
      expect(acc.edges).toHaveLength(0)
    })

    it('skips deleted pages', async () => {
      const acc = createAccumulator()
      const allPages = [
        { id: 'page-a', title: 'A', deleted: false },
        { id: 'page-deleted', title: 'Deleted', deleted: true },
      ]
      const fetchNeighbors = vi.fn(async () => ({ outLinks: [], inLinks: [] }))

      await buildFullGraph(allPages, acc, new Set(), null, null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes.map(n => n.id)).toEqual(['page-a'])
    })

    it('skips hidden pages', async () => {
      const acc = createAccumulator()
      const allPages = [
        { id: 'page-a', title: 'A', deleted: false },
        { id: 'page-b', title: 'B', deleted: false },
      ]
      const hidden = new Set(['page-b'])
      const fetchNeighbors = vi.fn(async () => ({ outLinks: [], inLinks: [] }))

      await buildFullGraph(allPages, acc, hidden, null, null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes.map(n => n.id)).toEqual(['page-a'])
    })

    it('loads edges between pages', async () => {
      const acc = createAccumulator()
      const allPages = [
        { id: 'page-a', title: 'A', deleted: false },
        { id: 'page-b', title: 'B', deleted: false },
      ]
      const fetchNeighbors = vi.fn(async (pageId: string) => {
        if (pageId === 'page-a') {
          return {
            outLinks: [{ id: 'l1', targetPageId: 'page-b', relationshipType: 'related' }],
            inLinks: [],
          }
        }
        return { outLinks: [], inLinks: [] }
      })

      await buildFullGraph(allPages, acc, new Set(), null, null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.edges).toHaveLength(1)
      expect(acc.edges[0].source).toBe('page-a')
      expect(acc.edges[0].target).toBe('page-b')
    })
  })
})
