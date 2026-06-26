/**
 * Core Layer - Search 模块
 *
 * 全文搜索功能，基于 Lunr.js + segmentit（中文分词）。
 *
 * Phase 2 Sprint 3 实现。
 */

/**
 * 搜索服务接口
 */
export interface SearchService {
  /**
   * 搜索内容
   */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>

  /**
   * 更新索引
   */
  updateIndex(type: 'block' | 'page', id: string, content: string): Promise<void>

  /**
   * 删除索引
   */
  removeIndex(type: 'block' | 'page', id: string): Promise<void>

  /**
   * 重建索引
   */
  rebuildIndex(): Promise<void>

  /**
   * 检查索引是否就绪
   */
  isReady(): boolean
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  pageId?: string
  limit?: number
  offset?: number
}

/**
 * 搜索结果
 */
export interface SearchResult {
  id: string
  type: 'block' | 'page'
  blockId?: string
  pageId?: string
  title?: string
  content: string
  matchedText: string
  score: number
}
