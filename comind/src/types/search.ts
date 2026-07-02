export interface SearchResult {
  id: string
  type: 'block' | 'page'
  blockId?: string
  pageId?: string
  title?: string
  content: string
  matchedText: string
  score: number
  highlights: SearchHighlight[]
}

export interface SearchHighlight {
  start: number
  end: number
}

export interface SearchOptions {
  query: string
  pageId?: string
  limit?: number
  offset?: number
}