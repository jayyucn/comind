export interface Link {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  createdAt: number
  relationshipType: string | null
  inverseRelationshipType: string | null
}

export interface LinkRecord {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  createdAt: number
  relationshipType: string | null
  inverseRelationshipType: string | null
}

// 预定义的关系类型配置
export interface RelationshipTypeConfig {
  key: string
  label: string
  color: string
  inverseKey?: string
  inverseLabel?: string
}

// 概念图谱节点
export interface GraphNode {
  id: string
  title: string
  isCurrentPage?: boolean
}

// 概念图谱边
export interface GraphEdge {
  id: string
  source: string
  target: string
  relationshipType: string | null
  relationshipLabel: string
  relationshipColor: string
}

// 概念图谱数据
export interface ConceptGraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}
