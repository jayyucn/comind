export interface Page {
  id: string
  blockId: string | null
  title: string
  type: 'normal' | 'ideas'
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
  type: 'normal' | 'ideas' | 'book'
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
