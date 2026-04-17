export interface Link {
  id: string
  sourceBlockId: string
  targetPageId: string | null
  displayText: string
  position?: number
  linkType: 'internal' | 'external'
  createdAt: string
}

export interface LinkRecord {
  id?: number
  sourceBlockId: string
  targetPageId: string | null
  displayText: string
  position?: number
  linkType: 'internal' | 'external'
  createdAt: number
}

export interface PageRecord {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}
