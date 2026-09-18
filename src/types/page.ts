export interface Page {
  id: string
  blockId: string | null
  title: string
  // book：书房 EPUB 导入生成的书 Page（票 01 / ADR-0040 D2，元数据照常同步）
  // tag：Supertag 标签落地页（#129 / ADR-0049 D1），不在导航列表展示，仍可经路由/查询/链接定位
  type: 'normal' | 'ideas' | 'book' | 'tag'
  icon: string | null
  cover: string | null
  aliases: string[]
  filePath: string | null
  childrenCount: number
  wordCount: number
  createdAt: number
  updatedAt: number
  deleted: boolean
  deletedAt: number | null
}

export interface PageRecord {
  id: string
  blockId: string | null
  title: string
  type: 'normal' | 'ideas' | 'book' | 'tag'
  icon: string | null
  cover: string | null
  aliases: string
  filePath: string | null
  childrenCount: number
  wordCount: number
  createdAt: number
  updatedAt: number
  deleted: number
  deletedAt: number | null
}
