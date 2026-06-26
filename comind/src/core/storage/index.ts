/**
 * Core Layer - Storage 模块
 */

export {
  type StorageAdapter,
  type StorageAdapterType,
  type BlockRepository,
  type PageRepository,
  type LinkRepository,
  type TagRepository,
  type PropertyRepository,
  type TransactionCallback,
  createStorageAdapter,
} from './adapter'

// 实现文件（TypeScript 会在运行时动态导入）
// export { IndexedDBAdapter } from './indexedDBAdapter'
// export { MemoryAdapter } from './memoryAdapter'
