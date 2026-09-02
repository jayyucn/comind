// types imported from graphSelectors

// ============================================================
// 类型定义
// ============================================================

/**
 * 扁平筛选状态，替代旧的 FilterCondition 数组。
 * 所有条件之间是 AND 关系。
 */
export interface FilterState {
  /** 标题模糊匹配（空字符串 = 不筛选） */
  search: string
  /** 选中的关系类型（空数组 = 不筛选边） */
  relationshipTypes: string[]
  /** 时间范围（start/end 都为 null = 不筛选） */
  timeRange: { start: number | null; end: number | null }
  /** false = 隐藏 ideas 类型节点 */
  showIdeas: boolean
  /** true = 置灰孤立节点 */
  dimIsolated: boolean
}

/**
 * 筛选计算结果——节点/边的可见性状态。
 * GraphView 只接收这个，不知道 FilterState 的存在。
 */
export interface VisibilityResult {
  /** 不渲染的节点 */
  hiddenNodeIds: Set<string>
  /** 渲染但置灰的节点 */
  dimmedNodeIds: Set<string>
  /** 不渲染的边 */
  hiddenEdgeIds: Set<string>
}

/**
 * selectors 需要的边数据。
 * 已从 blockId 解析为 sourcePageId → targetPageId。
 */
export interface SelectorEdge {
  id: string
  sourcePageId: string
  targetPageId: string
  relationshipType: string | null
}

/**
 * selectors 需要的节点数据（Page 的精简版）。
 */
export interface SelectorNode {
  id: string
  title: string
  type: 'normal' | 'ideas' | 'book'
  updatedAt: number
  createdAt: number
  deleted: boolean
}

// ============================================================
// 默认值
// ============================================================

export const DEFAULT_FILTER_STATE: FilterState = {
  search: '',
  relationshipTypes: [],
  timeRange: { start: null, end: null },
  showIdeas: true,
  dimIsolated: true,
}

export const EMPTY_VISIBILITY: VisibilityResult = {
  hiddenNodeIds: new Set(),
  dimmedNodeIds: new Set(),
  hiddenEdgeIds: new Set(),
}

// ============================================================
// 核心纯函数
// ============================================================

/**
 * 根据筛选状态计算每个节点和边的可见性。
 *
 * 计算顺序（后步依赖前步）：
 * 1. 算 hiddenEdgeIds（关系类型筛选：未选中类型的边隐藏）
 * 2. 算 hiddenNodeIds（ideas 隐藏）
 * 3. 用剩余边（排除 hiddenEdgeIds）判断每个节点的连接数
 * 4. 算 dimmedNodeIds（search + time + relationship + isolated）
 *
 * 优先级：hidden > dimmed
 */
export function computeVisibility(
  nodes: SelectorNode[],
  edges: SelectorEdge[],
  filter: FilterState,
): VisibilityResult {
  const allPages = nodes.filter(n => !n.deleted)

  // ---- Step 1: hiddenEdgeIds ----
  // 关系类型非空时，不在选中列表中的边隐藏
  const hiddenEdgeIds = new Set<string>()
  if (filter.relationshipTypes.length > 0) {
    const selectedSet = new Set(filter.relationshipTypes)
    for (const edge of edges) {
      const type = edge.relationshipType ?? 'related'
      if (!selectedSet.has(type)) {
        hiddenEdgeIds.add(edge.id)
      }
    }
  }

  // ---- Step 2: hiddenNodeIds ----
  // showIdeas === false 时隐藏 ideas 类型节点
  const hiddenNodeIds = new Set<string>()
  if (!filter.showIdeas) {
    for (const page of allPages) {
      if (page.type === 'ideas') {
        hiddenNodeIds.add(page.id)
      }
    }
  }

  // ---- Step 3: 用剩余边判断每个节点的连接数 ----
  // 排除 hiddenEdgeIds 后的边，用于判断孤立节点和关系类型筛选
  const visibleEdges = edges.filter(e => !hiddenEdgeIds.has(e.id))

  // 每个节点的连接数（基于可见边）
  const connectionCount = new Map<string, number>()
  for (const edge of visibleEdges) {
    connectionCount.set(edge.sourcePageId, (connectionCount.get(edge.sourcePageId) ?? 0) + 1)
    connectionCount.set(edge.targetPageId, (connectionCount.get(edge.targetPageId) ?? 0) + 1)
  }

  // 节点是否有任一选中类型的边
  const nodesWithSelectedRelTypes = new Set<string>()
  if (filter.relationshipTypes.length > 0) {
    for (const edge of visibleEdges) {
      nodesWithSelectedRelTypes.add(edge.sourcePageId)
      nodesWithSelectedRelTypes.add(edge.targetPageId)
    }
  }

  // ---- Step 4: dimmedNodeIds ----
  const dimmedNodeIds = new Set<string>()
  const hasSearch = filter.search.trim().length > 0
  const searchQuery = filter.search.trim().toLowerCase()
  const hasTimeFilter = filter.timeRange.start !== null || filter.timeRange.end !== null

  for (const page of allPages) {
    // 已隐藏的节点跳过
    if (hiddenNodeIds.has(page.id)) continue

    let isDimmed = false

    // 搜索：标题不匹配
    if (hasSearch && !page.title.toLowerCase().includes(searchQuery)) {
      isDimmed = true
    }

    // 时间范围：updatedAt 不在范围内
    if (hasTimeFilter) {
      const pageTime = page.updatedAt || page.createdAt
      if (filter.timeRange.start !== null && pageTime < filter.timeRange.start) isDimmed = true
      if (filter.timeRange.end !== null && pageTime >= filter.timeRange.end) isDimmed = true
    }

    // 关系类型：节点没有任何选中类型的边
    if (filter.relationshipTypes.length > 0 && !nodesWithSelectedRelTypes.has(page.id)) {
      isDimmed = true
    }

    // 孤立节点：在可见边中没有连接
    if (filter.dimIsolated && (connectionCount.get(page.id) ?? 0) === 0) {
      isDimmed = true
    }

    if (isDimmed) {
      dimmedNodeIds.add(page.id)
    }
  }

  return { hiddenNodeIds, dimmedNodeIds, hiddenEdgeIds }
}

/**
 * 判断一条边是否应该置灰。
 * 规则：边的任一端点是 dimmed 节点 → 边置灰。
 * 注意：调用方应先检查边是否在 hiddenEdgeIds 中（隐藏优先于置灰）。
 */
export function isEdgeDimmed(
  edge: { sourcePageId: string; targetPageId: string },
  dimmedNodeIds: Set<string>,
): boolean {
  return dimmedNodeIds.has(edge.sourcePageId) || dimmedNodeIds.has(edge.targetPageId)
}
