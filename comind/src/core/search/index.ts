/**
 * Core Layer - Search 模块
 *
 * 全文搜索功能，基于 Lunr.js + @node-rs/jieba（中文分词）。
 *
 * Phase 2 Sprint 3 实现。
 */

export { LunrSearch } from './lunrSearch'
export type { IndexDocument, IndexDocumentType, LunrSearchResult } from './lunrSearch'
export { IndexManager } from './indexManager'
export { SearchService } from './searchService'
export type { SearchResult, SearchOptions } from './searchService'
