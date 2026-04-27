export interface Block {
  id: string
  pageId: string
  parentId: string | null
  pos: number  // 排序位置（Gap 排序，初始间隔 1000）
  content: string
  format: Record<string, any>
  type: 'bullet' | 'property' | 'query' | 'embed'
  properties: Record<string, any>
  createdAt: number
  updatedAt: number
}

export interface BlockRecord {
  id: string
  pageId: string
  parentId: string | null
  pos: number
  content: string
  format: string
  type: string
  properties: string
  createdAt: number
  updatedAt: number
}

// BlockWithPos 已被 pos 字段取代，保留类型别名以兼容
export type BlockWithPos = Block
