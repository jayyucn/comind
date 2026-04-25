export interface Page {
  id: string
  blockId: string | null
  title: string
  type: 'normal' | 'journal'
  icon: string | null
  cover: string | null
  aliases: string[]
  filePath: string | null
  childrenCount: number
  wordCount: number
  createdAt: number
  updatedAt: number
}

export interface PageRecord {
  id: string
  blockId: string | null
  title: string
  type: 'normal' | 'journal'
  icon: string | null
  cover: string | null
  aliases: string
  filePath: string | null
  childrenCount: number
  wordCount: number
  createdAt: number
  updatedAt: number
}
