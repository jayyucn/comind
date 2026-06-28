/**
 * Core Layer - 初始化入口
 *
 * 负责初始化 Core 层服务，连接到存储后端。
 * 这是 UI 层与 Core 层之间的桥接点。
 */

import { createStorageAdapter, type StorageAdapter } from './storage/adapter'
import { BlockService } from './services/blockService'
import { LinkService } from './services/linkService'
import { TagService } from './services/tagService'
import { PropertyService } from './services/propertyService'
import { PageService } from './services/pageService'
import { RelationshipTypeService } from './services/relationshipTypeService'
import { TemplateService } from './services/templateService'
import { SearchService } from './search/searchService'

/**
 * Core 层上下文
 */
export interface CoreContext {
  storage: StorageAdapter
  blockService: BlockService
  linkService: LinkService
  tagService: TagService
  propertyService: PropertyService
  pageService: PageService
  relationshipTypeService: RelationshipTypeService
  templateService: TemplateService
  searchService: SearchService
}

/** 全局 Core 上下文 */
let coreContext: CoreContext | null = null

/**
 * 初始化 Core 层
 *
 * @param type 存储类型 ('indexeddb' | 'memory')
 * @returns Core 上下文
 */
export async function initCore(type: 'indexeddb' | 'memory' = 'indexeddb'): Promise<CoreContext> {
  if (coreContext) {
    return coreContext
  }

  // 创建存储适配器
  const storage = await createStorageAdapter(type)

  // 创建服务实例
  const blockService = new BlockService({ storage })
  const linkService = new LinkService({ storage })
  const tagService = new TagService()
  const propertyService = new PropertyService({ storage })
  const pageService = new PageService({ storage })
  const relationshipTypeService = new RelationshipTypeService({ storage })
  const templateService = new TemplateService({ storage })
  const searchService = new SearchService({ storage })

  coreContext = {
    storage,
    blockService,
    linkService,
    tagService,
    propertyService,
    pageService,
    relationshipTypeService,
    templateService,
    searchService,
  }

  return coreContext
}

/**
 * 获取 Core 上下文
 *
 * @throws 如果 Core 未初始化
 */
export function getCore(): CoreContext {
  if (!coreContext) {
    throw new Error('Core not initialized. Call initCore() first.')
  }
  return coreContext
}

/**
 * 检查 Core 是否已初始化
 */
export function isCoreInitialized(): boolean {
  return coreContext !== null
}

/**
 * 关闭 Core 层
 */
export async function closeCore(): Promise<void> {
  if (coreContext) {
    await coreContext.storage.close()
    coreContext = null
  }
}

// Re-export types and utilities
export * from './types'
export * from './storage/adapter'
