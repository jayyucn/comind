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
  snapshotToSelectorEdges,
  type GraphAccumulator,
  type VisibilityMap,
  type RawLink,
} from '../graphData'

// ---- helpers ----
function emptyVisibility(): VisibilityMap {
  return {
    hiddenNodeIds: new Set(),
    dimmedNodeIds: new Set(),
    hiddenEdgeIds: new Set(),
  }
}

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
    it('creates node with correct fields including isFiltered=false', () => {
      const node = createNodeData('page-1', 'Title', true, false, false)
      expect(node.id).toBe('page-1')
      expect(node.data).toEqual({
        label: 'Title',
        isCurrent: true,
        isHighlighted: false,
        isFiltered: false,
      })
    })

    it('creates node with isFiltered=true when dimmed', () => {
      const node = createNodeData('page-2', 'Other', false, false, true)
      expect(node.data?.isFiltered).toBe(true)
    })
  })

  // =====================
  // createEdgeData
  // =====================
  describe('createEdgeData', () => {
    it('creates edge with relationship metadata and isFiltered=false', () => {
      const edge = createEdgeData('link-1', 'src', 'tgt', 'related', false)
      expect(edge.id).toBe('link-1')
      expect(edge.source).toBe('src')
      expect(edge.target).toBe('tgt')
      expect(edge.data?.relationshipType).toBe('related')
      expect(edge.data?.label).toBe('label-related')
      expect(edge.data?.color).toBe('color-related')
      expect(edge.data?.isFiltered).toBe(false)
    })

    it('creates edge with isFiltered=true when dimmed', () => {
      const edge = createEdgeData('link-2', 'a', 'b', 'family', true)
      expect(edge.data?.isFiltered).toBe(true)
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
        'page-a', outLinks, [], acc, emptyVisibility(), 'page-a', null, mockGetPage, mockGetBlock
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
        'page-a', [], inLinks, acc, emptyVisibility(), 'page-a', null, mockGetPage, mockGetBlock
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
        'page-a', outLinks, [], acc, emptyVisibility(), 'page-a', null, mockGetPage, mockGetBlock
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
        'page-a', outLinks, [], acc, emptyVisibility(), 'page-a', null, mockGetPage, mockGetBlock
      )
      expect(neighbors).toEqual(['page-b'])
      expect(acc.nodes).toHaveLength(0)
      expect(acc.edges).toHaveLength(1)
    })

    it('skips hidden target pages', () => {
      const vis = emptyVisibility()
      vis.hiddenNodeIds.add('page-b')
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-b', relationshipType: 'related' },
      ]
      const neighbors = processNeighbors(
        'page-a', outLinks, [], acc, vis, 'page-a', null, mockGetPage, mockGetBlock
      )
      expect(neighbors).toEqual([])
      expect(acc.nodes).toHaveLength(0)
      expect(acc.edges).toHaveLength(0)
    })

    it('skips hidden edges', () => {
      const vis = emptyVisibility()
      vis.hiddenEdgeIds.add('link-1')
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-b', relationshipType: 'related' },
      ]
      const neighbors = processNeighbors(
        'page-a', outLinks, [], acc, vis, 'page-a', null, mockGetPage, mockGetBlock
      )
      expect(neighbors).toEqual([])
      expect(acc.nodes).toHaveLength(0)
      expect(acc.edges).toHaveLength(0)
    })

    it('marks dimmed nodes with isFiltered=true', () => {
      const vis = emptyVisibility()
      vis.dimmedNodeIds.add('page-b')
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-b', relationshipType: 'related' },
      ]
      processNeighbors('page-a', outLinks, [], acc, vis, 'page-a', null, mockGetPage, mockGetBlock)
      expect(acc.nodes[0].data?.isFiltered).toBe(true)
    })

    it('marks edge as filtered when source node is dimmed', () => {
      const vis = emptyVisibility()
      vis.dimmedNodeIds.add('page-a')
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-b', relationshipType: 'related' },
      ]
      processNeighbors('page-a', outLinks, [], acc, vis, 'page-a', null, mockGetPage, mockGetBlock)
      expect(acc.edges[0].data?.isFiltered).toBe(true)
    })

    it('marks edge as filtered when target node is dimmed', () => {
      const vis = emptyVisibility()
      vis.dimmedNodeIds.add('page-b')
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-b', relationshipType: 'related' },
      ]
      processNeighbors('page-a', outLinks, [], acc, vis, 'page-a', null, mockGetPage, mockGetBlock)
      expect(acc.edges[0].data?.isFiltered).toBe(true)
    })

    it('blockCache hit: does not call getBlock on second use', () => {
      const getBlockSpy = vi.fn(mockGetBlock)
      const inLinks: RawLink[] = [
        { id: 'link-a', sourceBlockId: 'block-1', targetPageId: 'page-a', relationshipType: 'related' },
        { id: 'link-b', sourceBlockId: 'block-1', targetPageId: 'page-a', relationshipType: 'related' },
      ]
      processNeighbors('page-a', [], inLinks, acc, emptyVisibility(), 'page-a', null, mockGetPage, getBlockSpy)
      expect(getBlockSpy).toHaveBeenCalledTimes(1)
    })

    it('blockCache miss: calls getBlock to get pageId', () => {
      const inLinks: RawLink[] = [
        { id: 'link-1', sourceBlockId: 'block-1', targetPageId: 'page-a', relationshipType: 'related' },
      ]
      processNeighbors('page-a', [], inLinks, acc, emptyVisibility(), 'page-a', null, mockGetPage, mockGetBlock)
      expect(acc.blockCache.has('block-1')).toBe(true)
      expect(acc.blockCache.get('block-1')?.pageId).toBe('page-b')
    })

    it('skips deleted pages', () => {
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-deleted', relationshipType: 'related' },
      ]
      const neighbors = processNeighbors(
        'page-a', outLinks, [], acc, emptyVisibility(), 'page-a', null, mockGetPage, mockGetBlock
      )
      expect(neighbors).toEqual([])
      expect(acc.nodes).toHaveLength(0)
      expect(acc.edges).toHaveLength(0)
    })

    it('defaults relationshipType to "related" when undefined', () => {
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-b' },
      ]
      processNeighbors('page-a', outLinks, [], acc, emptyVisibility(), 'page-a', null, mockGetPage, mockGetBlock)
      expect(acc.edges[0].data?.relationshipType).toBe('related')
    })

    it('skips backlink when getBlock returns undefined', () => {
      const inLinks: RawLink[] = [
        { id: 'link-x', sourceBlockId: 'unknown-block', targetPageId: 'page-a', relationshipType: 'related' },
      ]
      const neighbors = processNeighbors(
        'page-a', [], inLinks, acc, emptyVisibility(), 'page-a', null, mockGetPage, mockGetBlock
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
        'page-a', [], inLinks, acc, emptyVisibility(), 'page-a', null, mockGetPage, getBlockDeleted
      )
      expect(neighbors).toEqual([])
      expect(acc.nodes).toHaveLength(0)
    })

    it('sets isCurrent flag correctly for neighbor nodes', () => {
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-b', relationshipType: 'related' },
      ]
      processNeighbors('page-a', outLinks, [], acc, emptyVisibility(), 'page-b', null, mockGetPage, mockGetBlock)
      expect(acc.nodes[0].data?.isCurrent).toBe(true)
    })

    it('sets isHighlighted flag correctly for neighbor nodes', () => {
      const outLinks: RawLink[] = [
        { id: 'link-1', targetPageId: 'page-b', relationshipType: 'related' },
      ]
      processNeighbors('page-a', outLinks, [], acc, emptyVisibility(), null, 'page-b', mockGetPage, mockGetBlock)
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
      await traverseBFS('root', 0, acc, emptyVisibility(), 'root', null, mockGetPage, fetchNeighbors, mockGetBlock)

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

      await traverseBFS('root', 1, acc, emptyVisibility(), 'root', null, mockGetPage, fetchNeighbors, mockGetBlock)

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

      await traverseBFS('root', 2, acc, emptyVisibility(), 'root', null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes.map(n => n.id).sort()).toEqual(['deep1', 'neighbor1', 'root'])
      expect(acc.edges).toHaveLength(2)
    })

    it('terminates early when frontier is empty', async () => {
      const acc = createAccumulator()
      const fetchNeighbors = vi.fn(async () => ({ outLinks: [], inLinks: [] }))

      await traverseBFS('root', 5, acc, emptyVisibility(), 'root', null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes).toHaveLength(1)
      expect(fetchNeighbors).toHaveBeenCalledTimes(1)
    })

    it('returns empty when root page does not exist', async () => {
      const acc = createAccumulator()
      const fetchNeighbors = vi.fn()

      await traverseBFS('nonexistent', 2, acc, emptyVisibility(), 'nonexistent', null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes).toHaveLength(0)
      expect(acc.edges).toHaveLength(0)
      expect(fetchNeighbors).not.toHaveBeenCalled()
    })

    it('does not revisit already-visited pages', async () => {
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
            outLinks: [{ id: 'l2', targetPageId: 'root', relationshipType: 'related' }],
            inLinks: [],
          }
        }
        return { outLinks: [], inLinks: [] }
      })

      await traverseBFS('root', 3, acc, emptyVisibility(), 'root', null, mockGetPage, fetchNeighbors, mockGetBlock)

      const rootNodes = acc.nodes.filter(n => n.id === 'root')
      expect(rootNodes).toHaveLength(1)
      const neighborNodes = acc.nodes.filter(n => n.id === 'neighbor1')
      expect(neighborNodes).toHaveLength(1)
    })

    it('filters hidden nodes', async () => {
      const acc = createAccumulator()
      const vis = emptyVisibility()
      vis.hiddenNodeIds.add('neighbor1')
      const fetchNeighbors = vi.fn(async (pageId: string) => {
        if (pageId === 'root') {
          return {
            outLinks: [{ id: 'l1', targetPageId: 'neighbor1', relationshipType: 'related' }],
            inLinks: [],
          }
        }
        return { outLinks: [], inLinks: [] }
      })

      await traverseBFS('root', 2, acc, vis, 'root', null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes.map(n => n.id)).toEqual(['root'])
      expect(acc.edges).toHaveLength(0)
    })

    it('marks root node as dimmed when in dimmedNodeIds', async () => {
      const acc = createAccumulator()
      const vis = emptyVisibility()
      vis.dimmedNodeIds.add('root')
      const fetchNeighbors = vi.fn(async () => ({ outLinks: [], inLinks: [] }))

      await traverseBFS('root', 0, acc, vis, 'root', null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes[0].data?.isFiltered).toBe(true)
    })
  })

  // =====================
  // snapshotToSelectorEdges
  // =====================
  describe('snapshotToSelectorEdges', () => {
    it('maps TauriGraphEdgeRecord[] to SelectorEdge[] with correct field names', () => {
      const records = [
        {
          link_id: 'link-1',
          source_page_id: 'page-a',
          source_page_title: 'Page A',
          target_page_id: 'page-b',
          target_page_title: 'Page B',
          relationship_type: 'family',
        },
        {
          link_id: 'link-2',
          source_page_id: 'page-c',
          source_page_title: 'Page C',
          target_page_id: 'page-d',
          target_page_title: 'Page D',
          relationship_type: null,
        },
      ]
      const result = snapshotToSelectorEdges(records)
      expect(result).toEqual([
        { id: 'link-1', sourcePageId: 'page-a', targetPageId: 'page-b', relationshipType: 'family' },
        { id: 'link-2', sourcePageId: 'page-c', targetPageId: 'page-d', relationshipType: null },
      ])
    })

    it('returns empty array for empty input', () => {
      expect(snapshotToSelectorEdges([])).toEqual([])
    })

    it('preserves field order independent of title fields', () => {
      const records = [{
        link_id: 'l',
        source_page_id: 's',
        source_page_title: 'S',
        target_page_id: 't',
        target_page_title: 'T',
        relationship_type: 'related',
      }]
      const [edge] = snapshotToSelectorEdges(records)
      // title 字段不应泄露进 SelectorEdge
      expect(Object.keys(edge).sort()).toEqual(['id', 'relationshipType', 'sourcePageId', 'targetPageId'])
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

      await buildFullGraph(allPages, acc, emptyVisibility(), null, null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes.map(n => n.id).sort()).toEqual(['page-a', 'page-b', 'page-c'])
    })

    it('keeps isolated nodes (no edges)', async () => {
      const acc = createAccumulator()
      const allPages = [
        { id: 'page-a', title: 'A', deleted: false },
        { id: 'page-b', title: 'B', deleted: false },
      ]
      const fetchNeighbors = vi.fn(async () => ({ outLinks: [], inLinks: [] }))

      await buildFullGraph(allPages, acc, emptyVisibility(), null, null, mockGetPage, fetchNeighbors, mockGetBlock)

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

      await buildFullGraph(allPages, acc, emptyVisibility(), null, null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes.map(n => n.id)).toEqual(['page-a'])
    })

    it('skips hidden pages', async () => {
      const acc = createAccumulator()
      const vis = emptyVisibility()
      vis.hiddenNodeIds.add('page-b')
      const allPages = [
        { id: 'page-a', title: 'A', deleted: false },
        { id: 'page-b', title: 'B', deleted: false },
      ]
      const fetchNeighbors = vi.fn(async () => ({ outLinks: [], inLinks: [] }))

      await buildFullGraph(allPages, acc, vis, null, null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.nodes.map(n => n.id)).toEqual(['page-a'])
    })

    it('marks dimmed nodes with isFiltered=true', async () => {
      const acc = createAccumulator()
      const vis = emptyVisibility()
      vis.dimmedNodeIds.add('page-a')
      const allPages = [
        { id: 'page-a', title: 'A', deleted: false },
        { id: 'page-b', title: 'B', deleted: false },
      ]
      const fetchNeighbors = vi.fn(async () => ({ outLinks: [], inLinks: [] }))

      await buildFullGraph(allPages, acc, vis, null, null, mockGetPage, fetchNeighbors, mockGetBlock)

      const nodeA = acc.nodes.find(n => n.id === 'page-a')
      const nodeB = acc.nodes.find(n => n.id === 'page-b')
      expect(nodeA?.data?.isFiltered).toBe(true)
      expect(nodeB?.data?.isFiltered).toBe(false)
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

      await buildFullGraph(allPages, acc, emptyVisibility(), null, null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.edges).toHaveLength(1)
      expect(acc.edges[0].source).toBe('page-a')
      expect(acc.edges[0].target).toBe('page-b')
    })

    it('skips hidden edges', async () => {
      const acc = createAccumulator()
      const vis = emptyVisibility()
      vis.hiddenEdgeIds.add('l1')
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

      await buildFullGraph(allPages, acc, vis, null, null, mockGetPage, fetchNeighbors, mockGetBlock)

      expect(acc.edges).toHaveLength(0)
    })
  })
})
