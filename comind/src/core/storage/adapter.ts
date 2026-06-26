/**
 * Core Layer - 存储适配器接口
 *
 * 定义统一的存储接口，支持 IndexedDB → SQLite 的平滑迁移。
 * 采用 Repository 模式，每个实体对应独立的 Repository。
 */

import type {
  Block,
  BlockCreateOptions,
  BlockUpdateOptions,
  Page,
  PageCreateOptions,
  PageUpdateOptions,
  Link,
  LinkCreateOptions,
  Tag,
  Property,
  PropertyCreateOptions,
  PropertyUpdateOptions,
  PagedResult,
} from '../types'

// =============================================================================
// Repository Interfaces
// =============================================================================

/**
 * Block Repository - Block 数据访问接口
 */
export interface BlockRepository {
  findById(id: string): Promise<Block | undefined>
  findByPageId(pageId: string): Promise<Block[]>
  findByParentId(parentId: string | null): Promise<Block[]>
  findByIds(ids: string[]): Promise<Block[]>
  findAll(limit?: number, offset?: number): Promise<PagedResult<Block>>
  create(options: BlockCreateOptions): Promise<Block>
  update(id: string, options: BlockUpdateOptions): Promise<Block>
  delete(id: string): Promise<void>
  deleteByPageId(pageId: string): Promise<void>
  reorder(parentId: string | null, blockIds: string[]): Promise<void>
}

/**
 * Page Repository - Page 数据访问接口
 */
export interface PageRepository {
  findById(id: string): Promise<Page | undefined>
  findByTitle(title: string): Promise<Page | undefined>
  findByIds(ids: string[]): Promise<Page[]>
  findAll(limit?: number, offset?: number): Promise<PagedResult<Page>>
  findRecent(limit?: number): Promise<Page[]>
  findDeleted(limit?: number, offset?: number): Promise<PagedResult<Page>>
  create(options: PageCreateOptions): Promise<Page>
  update(id: string, options: PageUpdateOptions): Promise<Page>
  softDelete(id: string): Promise<void>
  restore(id: string): Promise<void>
  permanentDelete(id: string): Promise<void>
  emptyTrash(): Promise<void>
}

/**
 * Link Repository - 链接数据访问接口
 */
export interface LinkRepository {
  findById(id: string): Promise<Link | undefined>
  findBySourceBlockId(blockId: string): Promise<Link[]>
  findByTargetPageId(pageId: string): Promise<Link[]>
  findAll(limit?: number, offset?: number): Promise<PagedResult<Link>>
  create(options: LinkCreateOptions): Promise<Link>
  update(id: string, options: Partial<LinkCreateOptions>): Promise<Link>
  delete(id: string): Promise<void>
  deleteBySourceBlockId(blockId: string): Promise<void>
  deleteByTargetPageId(pageId: string): Promise<void>
}

/**
 * Tag Repository - 标签数据访问接口
 *
 * Phase 1 中从 Block.content 解析，暂不使用独立存储。
 * Phase 2 可扩展为独立 Tag 表。
 */
export interface TagRepository {
  findById(id: string): Promise<Tag | undefined>
  findByName(name: string): Promise<Tag | undefined>
  findAll(): Promise<Tag[]>
  create(name: string, parentId?: string | null): Promise<Tag>
  update(id: string, updates: Partial<Tag>): Promise<Tag>
  delete(id: string): Promise<void>
}

/**
 * Property Repository - 属性数据访问接口
 */
export interface PropertyRepository {
  findById(id: string): Promise<Property | undefined>
  findByBlockId(blockId: string): Promise<Property[]>
  findByKey(blockId: string, key: string): Promise<Property | undefined>
  findAll(limit?: number, offset?: number): Promise<PagedResult<Property>>
  create(options: PropertyCreateOptions): Promise<Property>
  update(id: string, options: PropertyUpdateOptions): Promise<Property>
  upsert(blockId: string, key: string, value: PropertyCreateOptions['value'], type?: PropertyCreateOptions['type']): Promise<Property>
  delete(id: string): Promise<void>
  deleteByBlockId(blockId: string): Promise<void>
  deleteByBlockIdAndKey(blockId: string, key: string): Promise<void>
}

// =============================================================================
// Storage Adapter Interface
// =============================================================================

/**
 * 事务回调类型
 */
export type TransactionCallback<T> = (tx: StorageAdapter) => Promise<T>

/**
 * Storage Adapter - 统一存储接口
 *
 * 提供对所有数据实体的访问，支持事务操作。
 */
export interface StorageAdapter {
  /** Block 数据访问 */
  blocks: BlockRepository

  /** Page 数据访问 */
  pages: PageRepository

  /** Link 数据访问 */
  links: LinkRepository

  /** Tag 数据访问 */
  tags: TagRepository

  /** Property 数据访问 */
  properties: PropertyRepository

  /**
   * 执行事务
   *
   * 在事务中执行多个操作，保证原子性。
   * 如果任何操作失败，整个事务回滚。
   */
  transaction<T>(callback: TransactionCallback<T>): Promise<T>

  /**
   * 关闭存储连接
   */
  close(): Promise<void>

  /**
   * 检查存储是否就绪
   */
  isReady(): boolean
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Storage Adapter 类型
 */
export type StorageAdapterType = 'indexeddb' | 'sqlite' | 'memory'

/**
 * 创建 Storage Adapter
 *
 * @param type 存储类型
 * @param options 存储选项
 * @returns Storage Adapter 实例
 */
export async function createStorageAdapter(
  type: StorageAdapterType,
  _options?: Record<string, any>
): Promise<StorageAdapter> {
  switch (type) {
    case 'indexeddb':
      const { IndexedDBAdapter } = await import('./indexedDBAdapter')
      const adapter = new IndexedDBAdapter()
      await adapter.open()
      return adapter

    case 'sqlite':
      // Phase 3 实现
      throw new Error('SQLite adapter not implemented yet. Planned for Phase 3.')

    case 'memory':
      const { MemoryAdapter } = await import('./memoryAdapter')
      return new MemoryAdapter()

    default:
      throw new Error(`Unknown storage type: ${type}`)
  }
}
