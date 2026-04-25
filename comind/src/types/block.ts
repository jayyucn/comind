export interface Block {
  id: string
  pageId: string
  parentId: string | null
  leftId: string | null
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
  leftId: string | null
  content: string
  format: string
  type: string
  properties: string
  createdAt: number
  updatedAt: number
}

// 定义BlockWithPos接口的pos字段
export interface BlockWithPos extends Block {
  pos?: number
}
