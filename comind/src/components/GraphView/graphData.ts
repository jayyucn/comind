import type { EdgeData, NodeData } from '@antv/g6'
import { getRelationshipColor, getRelationshipLabel } from '../../types/relationship'
import pLimit from 'p-limit'
import type { TauriGraphEdgeRecord } from '../../wasm/tauri-client'
import type { SelectorEdge } from './graphSelectors'

// 一次性图谱快照数据（由 build_graph_snapshot 命令返回）
export interface GraphSnapshot {
  edges: TauriGraphEdgeRecord[]
}

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

// ---- 快照映射：TauriGraphEdgeRecord[] → SelectorEdge[] ----
// GraphPage 通过 1 次 buildGraphSnapshot() IPC 取回全部边关系后，
// 用此助手映射为 graphSelectors.computeVisibility 所需的 SelectorEdge 结构，
// 供筛选可见性计算复用，避免子组件 GraphView 再独立发起一次 IPC（见 handoff 6.A）。
export function snapshotToSelectorEdges(edges: TauriGraphEdgeRecord[]): SelectorEdge[] {
  return edges.map(e => ({
    id: e.link_id,
    sourcePageId: e.source_page_id,
    targetPageId: e.target_page_id,
    relationshipType: e.relationship_type,
  }))
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
  const limit = pLimit(6)
  for (let depth = 0; depth < maxDepth; depth++) {
    const results = await Promise.all(frontier.map(pageId =>
      limit(async () => {
        const { outLinks, inLinks } = await fetchNeighbors(pageId)
        return processNeighbors(pageId, outLinks, inLinks, acc, visibility, currentPageId, highlightedNodeId, getPage, getBlock)
      })
    ))
    const nextFrontier: string[] = []
    for (const neighbors of results) {
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

// ---- 纯函数：从图谱快照构建边数据（同步，无 I/O） ----
export function processSnapshotEdges(
  snapshot: GraphSnapshot,
  acc: GraphAccumulator,
  visibility: VisibilityMap,
  currentPageId: string | null,
  highlightedNodeId: string | null,
  getPage: (id: string) => { id: string; title: string; deleted: boolean } | undefined,
): void {
  for (const edge of snapshot.edges) {
    if (acc.visitedEdges.has(edge.link_id)) continue
    if (visibility.hiddenEdgeIds.has(edge.link_id)) continue

    const sourcePage = getPage(edge.source_page_id)
    const targetPage = getPage(edge.target_page_id)
    if (!sourcePage || sourcePage.deleted) continue
    if (!targetPage || targetPage.deleted) continue
    if (visibility.hiddenNodeIds.has(sourcePage.id)) continue
    if (visibility.hiddenNodeIds.has(targetPage.id)) continue

    // 确保两端节点都存在
    const sourceDimmed = visibility.dimmedNodeIds.has(sourcePage.id)
    const targetDimmed = visibility.dimmedNodeIds.has(targetPage.id)
    if (!acc.nodeIds.has(sourcePage.id)) {
      acc.nodeIds.add(sourcePage.id)
      acc.nodes.push(createNodeData(sourcePage.id, sourcePage.title, sourcePage.id === currentPageId, sourcePage.id === highlightedNodeId, sourceDimmed))
    }
    if (!acc.nodeIds.has(targetPage.id)) {
      acc.nodeIds.add(targetPage.id)
      acc.nodes.push(createNodeData(targetPage.id, targetPage.title, targetPage.id === currentPageId, targetPage.id === highlightedNodeId, targetDimmed))
    }

    acc.visitedEdges.add(edge.link_id)
    const type = edge.relationship_type ?? 'related'
    acc.edges.push(createEdgeData(edge.link_id, sourcePage.id, targetPage.id, type, sourceDimmed || targetDimmed))
  }
  filterHiddenEdges(acc.edges, visibility.hiddenNodeIds)
}

// ---- 全量构建（使用一次性图谱快照，无 N 次 IPC） ----
export async function buildFullGraph(
  allPages: { id: string; title: string; deleted: boolean }[],
  acc: GraphAccumulator,
  visibility: VisibilityMap,
  currentPageId: string | null,
  highlightedNodeId: string | null,
  getPage: (id: string) => { id: string; title: string; deleted: boolean } | undefined,
  _fetchNeighbors: (pageId: string) => Promise<{ outLinks: RawLink[]; inLinks: RawLink[] }>,
  _getBlock: (id: string) => { pageId: string } | undefined,
  snapshot?: GraphSnapshot,
): Promise<void> {
  // 先收集所有可见页面节点
  for (const page of allPages) {
    if (page.deleted || visibility.hiddenNodeIds.has(page.id)) continue
    const isDimmed = visibility.dimmedNodeIds.has(page.id)
    acc.nodeIds.add(page.id)
    acc.nodes.push(createNodeData(page.id, page.title, page.id === currentPageId, page.id === highlightedNodeId, isDimmed))
  }

  if (snapshot) {
    // 快照模式：1 次 IPC 已拿到所有边，本地构建
    processSnapshotEdges(snapshot, acc, visibility, currentPageId, highlightedNodeId, getPage)
  } else {
    // 降级模式：并发 fetchNeighbors（向后兼容）
    const visiblePages = allPages.filter(p => !p.deleted && !visibility.hiddenNodeIds.has(p.id))
    const limit = pLimit(6)
    await Promise.all(visiblePages.map(page =>
      limit(async () => {
        const { outLinks, inLinks } = await _fetchNeighbors(page.id)
        processNeighbors(page.id, outLinks, inLinks, acc, visibility, currentPageId, highlightedNodeId, getPage, _getBlock)
      })
    ))
    filterHiddenEdges(acc.edges, visibility.hiddenNodeIds)
  }
}
