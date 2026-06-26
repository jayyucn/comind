/**
 * Core Layer - 核心导出
 *
 * 框架无关的核心层，提供：
 * - 类型定义（types/）
 * - 领域服务（services/）
 * - 存储抽象（storage/）
 * - 搜索功能（search/）
 *
 * 使用方式：
 * ```typescript
 * import { BlockService, LinkService, TagService, PropertyService } from '@/core'
 * import { createStorageAdapter } from '@/core'
 *
 * const storage = await createStorageAdapter('indexeddb')
 * const blockService = new BlockService({ storage })
 * const linkService = new LinkService({ storage })
 * ```
 */

// Types
export * from './types'

// Services
export { BlockService } from './services'
export { LinkService } from './services'
export { TagService } from './services'
export { PropertyService } from './services'

// Storage
export { createStorageAdapter } from './storage'
export type { StorageAdapter, StorageAdapterType } from './storage'

// Search
export type { SearchService, SearchOptions, SearchResult } from './search'
