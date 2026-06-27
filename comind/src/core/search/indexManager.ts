/**
 * Core Layer - 索引管理器
 *
 * 管理搜索索引的增量更新，负责：
 * - 监听数据变化，自动更新索引
 * - 批量索引构建
 * - 索引持久化（可选）
 */

import type { StorageAdapter } from '../storage/adapter'
import type { Block, Page } from '../types'
import { LunrSearch, type IndexDocument, type IndexDocumentType } from './lunrSearch'

/**
 * 索引管理器配置
 */
export interface IndexManagerOptions {
  storage: StorageAdapter
  debounceMs?: number
}

/**
 * 待处理的索引更新
 */
interface PendingUpdate {
  type: 'add' | 'remove' | 'update'
  docType: IndexDocumentType
  id: string
  doc?: IndexDocument
}

/**
 * 索引管理器
 *
 * 提供增量索引更新能力，通过 debounce 合并频繁的更新。
 */
export class IndexManager {
  private storage: StorageAdapter
  private search: LunrSearch
  private debounceMs: number
  private pendingUpdates: Map<string, PendingUpdate> = new Map()
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private _ready = false

  constructor(options: IndexManagerOptions) {
    this.storage = options.storage
    this.search = new LunrSearch()
    this.debounceMs = options.debounceMs ?? 100
  }

  /**
   * 检查索引是否就绪
   */
  isReady(): boolean {
    return this._ready && this.search.isReady()
  }

  /**
   * 获取底层搜索实例
   */
  getSearchEngine(): LunrSearch {
    return this.search
  }

  /**
   * 构建完整索引
   *
   * 从存储中加载所有 Block 和 Page，构建完整的搜索索引。
   */
  async buildFullIndex(): Promise<void> {
    this._ready = false

    // 清空现有索引
    this.search.clear()

    // 加载所有 Page
    const pages = await this.storage.pages.findAll(10000, 0)
    const pageDocs: IndexDocument[] = pages.items.map(page => ({
      id: `page_${page.id}`,
      type: 'page' as const,
      pageId: page.id,
      title: page.title,
      content: page.title,
    }))

    // 加载所有 Block
    const blocks = await this.storage.blocks.findAll(100000, 0)
    const blockDocs: IndexDocument[] = blocks.items.map(block => ({
      id: `block_${block.id}`,
      type: 'block' as const,
      pageId: block.pageId,
      blockId: block.id,
      content: block.content,
    }))

    // 批量添加到索引
    this.search.addAll([...pageDocs, ...blockDocs])
    this._ready = true
  }

  /**
   * 更新 Block 索引
   */
  updateBlock(block: Block): void {
    const doc: IndexDocument = {
      id: `block_${block.id}`,
      type: 'block',
      pageId: block.pageId,
      blockId: block.id,
      content: block.content,
    }

    this.queueUpdate({
      type: 'update',
      docType: 'block',
      id: `block_${block.id}`,
      doc,
    })
  }

  /**
   * 更新 Page 索引
   */
  updatePage(page: Page): void {
    const doc: IndexDocument = {
      id: `page_${page.id}`,
      type: 'page',
      pageId: page.id,
      title: page.title,
      content: page.title,
    }

    this.queueUpdate({
      type: 'update',
      docType: 'page',
      id: `page_${page.id}`,
      doc,
    })
  }

  /**
   * 删除 Block 索引
   */
  removeBlock(blockId: string): void {
    this.queueUpdate({
      type: 'remove',
      docType: 'block',
      id: `block_${blockId}`,
    })
  }

  /**
   * 删除 Page 索引
   */
  removePage(pageId: string): void {
    // 删除页面
    this.queueUpdate({
      type: 'remove',
      docType: 'page',
      id: `page_${pageId}`,
    })

    // 该页面的所有 Block 也将在存储层被级联删除
    // 这里可以选择是否立即删除所有相关 Block 索引
    // 为了性能，暂时不做，等下次全量重建时清理
  }

  /**
   * 入队待处理更新
   */
  private queueUpdate(update: PendingUpdate): void {
    // 合并相同 ID 的更新
    this.pendingUpdates.set(update.id, update)

    // 取消之前的定时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    // 设置新的定时器
    this.debounceTimer = setTimeout(() => {
      this.flushUpdates()
    }, this.debounceMs)
  }

  /**
   * 刷新所有待处理的更新
   */
  private flushUpdates(): void {
    this.debounceTimer = null

    for (const [, update] of this.pendingUpdates) {
      if (update.type === 'remove') {
        this.search.remove(update.id)
      } else if (update.doc) {
        this.search.update(update.doc)
      }
    }

    this.pendingUpdates.clear()
  }

  /**
   * 立即刷新所有待处理更新
   */
  async flush(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    this.flushUpdates()
  }

  /**
   * 重建索引
   */
  async rebuild(): Promise<void> {
    await this.buildFullIndex()
  }

  /**
   * 获取索引大小
   */
  size(): number {
    return this.search.size()
  }
}
