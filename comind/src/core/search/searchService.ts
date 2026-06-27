/**
 * Core Layer - 搜索服务
 *
 * 提供统一的搜索 API，封装索引管理和搜索引擎。
 */

import type { StorageAdapter } from '../storage/adapter'
import type { Block, Page } from '../types'
import { IndexManager } from './indexManager'
import type { LunrSearchResult } from './lunrSearch'

/**
 * 搜索结果
 */
export interface SearchResult {
  id: string
  type: 'block' | 'page'
  pageId?: string
  blockId?: string
  title?: string
  content: string
  score: number
  matchedText: string
  highlights: { start: number; end: number }[]
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  limit?: number
  type?: 'block' | 'page' | 'all'
}

/**
 * 搜索服务
 */
export class SearchService {
  private indexManager: IndexManager
  private initialized = false

  constructor(options: { storage: StorageAdapter }) {
    this.indexManager = new IndexManager({ storage: options.storage })
  }

  /**
   * 初始化搜索服务
   *
   * 构建完整索引（如果尚未初始化）。
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    await this.indexManager.buildFullIndex()
    this.initialized = true
  }

  /**
   * 搜索
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    if (!this.initialized) {
      await this.initialize()
    }

    const limit = options.limit ?? 20
    const type = options.type ?? 'all'

    const engine = this.indexManager.getSearchEngine()
    const results = engine.search(query, limit * 3)

    let filtered = results

    if (type !== 'all') {
      filtered = results.filter(r => r.type === type)
    }

    return filtered.slice(0, limit).map(r => this.toSearchResult(r))
  }

  /**
   * 更新 Block 索引
   */
  updateBlock(block: Block): void {
    this.indexManager.updateBlock(block)
  }

  /**
   * 更新 Page 索引
   */
  updatePage(page: Page): void {
    this.indexManager.updatePage(page)
  }

  /**
   * 删除 Block 索引
   */
  removeBlock(blockId: string): void {
    this.indexManager.removeBlock(blockId)
  }

  /**
   * 删除 Page 索引
   */
  removePage(pageId: string): void {
    this.indexManager.removePage(pageId)
  }

  /**
   * 重建索引
   */
  async rebuild(): Promise<void> {
    await this.indexManager.rebuild()
  }

  /**
   * 立即刷新待处理的索引更新
   */
  async flush(): Promise<void> {
    await this.indexManager.flush()
  }

  /**
   * 获取索引大小
   */
  getIndexSize(): number {
    return this.indexManager.size()
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * 转换为搜索结果格式
   */
  private toSearchResult(result: LunrSearchResult): SearchResult {
    return {
      id: result.id,
      type: result.type,
      pageId: result.pageId,
      blockId: result.blockId,
      title: result.title,
      content: result.content,
      score: result.score,
      matchedText: result.matchedText,
      highlights: [],
    }
  }
}
