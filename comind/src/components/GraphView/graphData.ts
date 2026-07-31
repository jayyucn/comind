import type { EdgeData, NodeData } from '@antv/g6'
import { getRelationshipColor, getRelationshipLabel } from '../../types/relationship'

export interface RawLink {
  id: string
  sourceBlockId?: string
  targetPageId: string
  relationshipType?: string | null
}

export interface GraphAccumulator {
  nodes: NodeData[]
  edges: EdgeData[]
  visitedEdges: Set<string>
  nodeIds: Set<string>
  blockCache: Map<string, { pageId: string }>
}

/**
 * 可见性 map——由 graphSelectors.computeVisibility 产出。
 * GraphView 传给 graphData，graphData 据此跳过隐藏节点/边、标记置灰。
 */
export interface VisibilityMap {
  hiddenNodeIds: Set<string>
  dimmedNodeIds: Set<string>
  hiddenEdgeIds: Set<string>
}

export function createAccumulator(): GraphAccumulator {
  return {
    nodes: [],
    edges: [],
    visitedEdges: new Set(),
    nodeIds: new Set(),
    blockCache: new Map(),
  }
}

// ---- 纯函数：节点数据构建 ----
export function createNodeData(
  pageId: string,
  pageTitle: string,
  isCurrent: boolean,
  isHighlighted: boolean,
  isFiltered: boolean,
): NodeData {
  return {
    id: pageId,
    data: {
      label: pageTitle,
      isCurrent,
      isHighlighted,
      isFiltered,
    },
  }
}

// ---- 纯函数：边数据构建 ----
export function createEdgeData(
  linkId: string,
  source: string,
  target: string,
  relationshipType: string,
  isFiltered: boolean,
): EdgeData {
  return {
    id: linkId,
    source,
    target,
    data: {
      relationshipType,
      label: getRelationshipLabel(relationshipType),
      color: getRelationshipColor(relationshipType),
      isFiltered,
    },
  }
}

// ---- 纯函数：加工邻居数据（同步，无 I/O） ----
export function processNeighbors(
  pageId: string,
  outLinks: RawLink[],
  inLinks: RawLink[],
  acc: GraphAccumulator,
  visibility: VisibilityMap,
  currentPageId: string | null,
  highlightedNodeId: string | null,
  getPage: (id: string) => { id: string; title: string; deleted: boolean } | undefined,
  getBlock: (id: string) => { pageId: string } | undefined,
): string[] {
  const neighbors: string[] = []

  // 处理 outlinks
  for (const link of outLinks) {
    if (acc.visitedEdges.has(link.id)) continue
    // 边被隐藏 → 跳过
    if (visibility.hiddenEdgeIds.has(link.id)) continue

    const targetPage = getPage(link.targetPageId)
    if (!targetPage || targetPage.deleted) continue
    if (visibility.hiddenNodeIds.has(targetPage.id)) continue

    const isDimmed = visibility.dimmedNodeIds.has(targetPage.id)
    if (!acc.nodeIds.has(targetPage.id)) {
      acc.nodeIds.add(targetPage.id)
      acc.nodes.push(createNodeData(
        targetPage.id, targetPage.title,
        targetPage.id === currentPageId,
        targetPage.id === highlightedNodeId,
        isDimmed,
      ))
    }
    neighbors.push(targetPage.id)

    const type = link.relationshipType ?? 'related'
    acc.visitedEdges.add(link.id)
    // 边置灰：任一端点 dimmed → 边 dimmed
    const edgeDimmed = isDimmed || visibility.dimmedNodeIds.has(pageId)
    acc.edges.push(createEdgeData(link.id, pageId, link.targetPageId, type, edgeDimmed))
  }

  // 处理 backlinks
  for (const link of inLinks) {
    if (acc.visitedEdges.has(link.id)) continue
    // 边被隐藏 → 跳过
    if (visibility.hiddenEdgeIds.has(link.id)) continue

    let block = acc.blockCache.get(link.sourceBlockId!)
    if (!block) {
      const record = getBlock(link.sourceBlockId!)
      if (!record) continue
      block = { pageId: record.pageId }
      acc.blockCache.set(link.sourceBlockId!, block)
    }

    const sourcePageId = block.pageId
    const sourcePage = getPage(sourcePageId)
    if (!sourcePage || sourcePage.deleted) continue
    if (visibility.hiddenNodeIds.has(sourcePageId)) continue

    const isDimmed = visibility.dimmedNodeIds.has(sourcePageId)
    if (!acc.nodeIds.has(sourcePageId)) {
      acc.nodeIds.add(sourcePageId)
      acc.nodes.push(createNodeData(
        sourcePage.id, sourcePage.title,
        sourcePage.id === currentPageId,
        sourcePage.id === highlightedNodeId,
        isDimmed,
      ))
    }
    neighbors.push(sourcePageId)

    const type = link.relationshipType ?? 'related'
    acc.visitedEdges.add(link.id)
    // 边置灰：任一端点 dimmed → 边 dimmed
    const edgeDimmed = isDimmed || visibility.dimmedNodeIds.has(pageId)
    acc.edges.push(createEdgeData(link.id, sourcePageId, pageId, type, edgeDimmed))
  }

  return neighbors
}

// ---- 纯函数：过滤隐藏边（兼容旧接口，隐藏的边从数组中移除） ----
export function filterHiddenEdges(edges: EdgeData[], hidden: Set<string>): void {
  for (let i = edges.length - 1; i >= 0; i--) {
    if (hidden.has(edges[i].source) || hidden.has(edges[i].target)) {
      edges.splice(i, 1)
    }
  }
}

// ---- BFS 遍历（需要异步 I/O 回调） ----
export async function traverseBFS(
  rootId: string,
  maxDepth: number,
  acc: GraphAccumulator,
  visibility: VisibilityMap,
  currentPageId: string | null,
  highlightedNodeId: string | null,
  getPage: (id: string) => { id: string; title: string; deleted: boolean } | undefined,
  fetchNeighbors: (pageId: string) => Promise<{ outLinks: RawLink[]; inLinks: RawLink[] }>,
  getBlock: (id: string) => { pageId: string } | undefined,
): Promise<void> {
  const visitedPages = new Set<string>([rootId])
  const rootPage = getPage(rootId)
  if (!rootPage) return

  const rootDimmed = visibility.dimmedNodeIds.has(rootPage.id)
  acc.nodeIds.add(rootPage.id)
  acc.nodes.push(createNodeData(rootPage.id, rootPage.title, true, rootPage.id === highlightedNodeId, rootDimmed))

  let frontier: string[] = [rootId]
  for (let depth = 0; depth < maxDepth; depth++) {
    const nextFrontier: string[] = []
    for (const pageId of frontier) {
      const { outLinks, inLinks } = await fetchNeighbors(pageId)
      const neighbors = processNeighbors(pageId, outLinks, inLinks, acc, visibility, currentPageId, highlightedNodeId, getPage, getBlock)
      for (const neighborId of neighbors) {
        if (!visitedPages.has(neighborId)) {
          visitedPages.add(neighborId)
          nextFrontier.push(neighborId)
        }
      }
    }
    frontier = nextFrontier
    if (frontier.length === 0) break
  }

  filterHiddenEdges(acc.edges, visibility.hiddenNodeIds)
}

// ---- 全量构建（需要异步 I/O 回调） ----
export async function buildFullGraph(
  allPages: { id: string; title: string; deleted: boolean }[],
  acc: GraphAccumulator,
  visibility: VisibilityMap,
  currentPageId: string | null,
  highlightedNodeId: string | null,
  getPage: (id: string) => { id: string; title: string; deleted: boolean } | undefined,
  fetchNeighbors: (pageId: string) => Promise<{ outLinks: RawLink[]; inLinks: RawLink[] }>,
  getBlock: (id: string) => { pageId: string } | undefined,
): Promise<void> {
  // 先收集所有可见页面节点
  for (const page of allPages) {
    if (page.deleted || visibility.hiddenNodeIds.has(page.id)) continue
    const isDimmed = visibility.dimmedNodeIds.has(page.id)
    acc.nodeIds.add(page.id)
    acc.nodes.push(createNodeData(page.id, page.title, page.id === currentPageId, page.id === highlightedNodeId, isDimmed))
  }
  // 再加载边
  for (const page of allPages) {
    if (page.deleted || visibility.hiddenNodeIds.has(page.id)) continue
    const { outLinks, inLinks } = await fetchNeighbors(page.id)
    processNeighbors(page.id, outLinks, inLinks, acc, visibility, currentPageId, highlightedNodeId, getPage, getBlock)
  }
  filterHiddenEdges(acc.edges, visibility.hiddenNodeIds)
}
