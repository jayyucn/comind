export interface Block {
  id: string
  content: string
  parentId: string | null
  pageId: string
  left: number
  createdAt: string
  updatedAt: string
  isPage: boolean
  title?: string
  properties?: Record<string, any>
  collapsed?: boolean
}

export interface BlockRecord {
  id: string
  content: string
  parentId: string | null
  pageId: string
  left: number
  createdAt: number
  updatedAt: number
  isPage: boolean
  title?: string
  properties?: string
  collapsed?: boolean
}

// 定义BlockWithPos接口的pos字段
export interface BlockWithPos extends Block {
  pos?: number
}
