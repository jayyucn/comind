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
  nodeIds: Set<string>          // 节点去重（替代 find）
  blockCache: Map<string, { pageId: string }>
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
): NodeData {
  return {
    id: pageId,
    data: {
      label: pageTitle,
      isCurrent,
      isHighlighted,
    },
  }
}

// ---- 纯函数：边数据构建 ----
export function createEdgeData(
  linkId: string,
  source: string,
  target: string,
  relationshipType: string,
): EdgeData {
  return {
    id: linkId,
    source,
    target,
    data: {
      relationshipType,
      label: getRelationshipLabel(relationshipType),
      color: getRelationshipColor(relationshipType),
    },
  }
}

// ---- 纯函数：加工邻居数据（同步，无 I/O） ----
export function processNeighbors(
  pageId: string,
  outLinks: RawLink[],
  inLinks: RawLink[],
  acc: GraphAccumulator,
  hidden: Set<string>,
  currentPageId: string | null,
  highlightedNodeId: string | null,
  getPage: (id: string) => { id: string; title: string; deleted: boolean } | undefined,
  getBlock: (id: string) => { pageId: string } | undefined,
): string[] {
  const neighbors: string[] = []

  // 处理 outlinks
  for (const link of outLinks) {
    if (acc.visitedEdges.has(link.id)) continue
    const targetPage = getPage(link.targetPageId)
    if (!targetPage || targetPage.deleted) continue
    if (hidden.has(targetPage.id)) continue

    if (!acc.nodeIds.has(targetPage.id)) {
      acc.nodeIds.add(targetPage.id)
      acc.nodes.push(createNodeData(
        targetPage.id, targetPage.title,
        targetPage.id === currentPageId,
        targetPage.id === highlightedNodeId,
      ))
    }
    neighbors.push(targetPage.id)

    const type = link.relationshipType ?? 'related'
    acc.visitedEdges.add(link.id)
    acc.edges.push(createEdgeData(link.id, pageId, link.targetPageId, type))
  }

  // 处理 backlinks
  for (const link of inLinks) {
    if (acc.visitedEdges.has(link.id)) continue

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
    if (hidden.has(sourcePageId)) continue

    if (!acc.nodeIds.has(sourcePageId)) {
      acc.nodeIds.add(sourcePageId)
      acc.nodes.push(createNodeData(
        sourcePage.id, sourcePage.title,
        sourcePage.id === currentPageId,
        sourcePage.id === highlightedNodeId,
      ))
    }
    neighbors.push(sourcePageId)

    const type = link.relationshipType ?? 'related'
    acc.visitedEdges.add(link.id)
    acc.edges.push(createEdgeData(link.id, sourcePageId, pageId, type))
  }

  return neighbors
}

// ---- 纯函数：过滤隐藏边 ----
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
  hidden: Set<string>,
  currentPageId: string | null,
  highlightedNodeId: string | null,
  getPage: (id: string) => { id: string; title: string; deleted: boolean } | undefined,
  fetchNeighbors: (pageId: string) => Promise<{ outLinks: RawLink[]; inLinks: RawLink[] }>,
  getBlock: (id: string) => { pageId: string } | undefined,
): Promise<void> {
  const visitedPages = new Set<string>([rootId])
  const rootPage = getPage(rootId)
  if (!rootPage) return

  acc.nodeIds.add(rootPage.id)
  acc.nodes.push(createNodeData(rootPage.id, rootPage.title, true, rootPage.id === highlightedNodeId))

  let frontier: string[] = [rootId]
  for (let depth = 0; depth < maxDepth; depth++) {
    const nextFrontier: string[] = []
    for (const pageId of frontier) {
      const { outLinks, inLinks } = await fetchNeighbors(pageId)
      const neighbors = processNeighbors(pageId, outLinks, inLinks, acc, hidden, currentPageId, highlightedNodeId, getPage, getBlock)
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

  filterHiddenEdges(acc.edges, hidden)
}

// ---- 全量构建（需要异步 I/O 回调） ----
export async function buildFullGraph(
  allPages: { id: string; title: string; deleted: boolean }[],
  acc: GraphAccumulator,
  hidden: Set<string>,
  currentPageId: string | null,
  highlightedNodeId: string | null,
  getPage: (id: string) => { id: string; title: string; deleted: boolean } | undefined,
  fetchNeighbors: (pageId: string) => Promise<{ outLinks: RawLink[]; inLinks: RawLink[] }>,
  getBlock: (id: string) => { pageId: string } | undefined,
): Promise<void> {
  // 先收集所有页面节点
  for (const page of allPages) {
    if (page.deleted || hidden.has(page.id)) continue
    acc.nodeIds.add(page.id)
    acc.nodes.push(createNodeData(page.id, page.title, page.id === currentPageId, page.id === highlightedNodeId))
  }
  // 再加载边
  for (const page of allPages) {
    if (page.deleted || hidden.has(page.id)) continue
    const { outLinks, inLinks } = await fetchNeighbors(page.id)
    processNeighbors(page.id, outLinks, inLinks, acc, hidden, currentPageId, highlightedNodeId, getPage, getBlock)
  }
  filterHiddenEdges(acc.edges, hidden)
}
