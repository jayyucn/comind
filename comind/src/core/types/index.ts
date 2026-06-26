/**
 * Core Layer - 框架无关的核心类型定义
 *
 * 本模块定义 comind 的核心数据类型，与任何框架（Vue、Pinia、tiptap）无关。
 * 所有框架特定的适配器都依赖这些类型。
 */

// =============================================================================
// Block Types
// =============================================================================

/**
 * Block 类型枚举
 */
export type BlockType = 'bullet' | 'property' | 'query' | 'embed' | 'code' | 'image' | 'concept'

/**
 * Block - 最小编辑单位
 *
 * 系统所有数据围绕 Block 构建。
 */
export interface Block {
  id: string
  pageId: string
  parentId: string | null
  pos: number
  content: string
  format: Record<string, any>
  type: BlockType
  properties: Record<string, any>
  createdAt: number
  updatedAt: number
}

/**
 * Block 创建选项
 */
export interface BlockCreateOptions {
  pageId: string
  parentId?: string | null
  content?: string
  type?: BlockType
  properties?: Record<string, any>
}

/**
 * Block 更新选项
 */
export interface BlockUpdateOptions {
  content?: string
  parentId?: string | null
  pos?: number
  format?: Record<string, any>
  properties?: Record<string, any>
  type?: BlockType
}

/**
 * 树形节点 - Block 的树形视图
 */
export interface TreeNode {
  id: string
  block: Block
  children: TreeNode[]
}

/**
 * 子树节点 - 简化版树节点（用于渲染）
 */
export interface SubtreeNode {
  block: Block
  children: SubtreeNode[]
}

/**
 * 块路径 - 从根到目标节点的路径
 */
export interface BlockPath {
  ancestors: Block[]
  current: Block
}

// =============================================================================
// Page Types
// =============================================================================

/**
 * Page 类型枚举
 */
export type PageType = 'normal' | 'journal'

/**
 * Page - 顶级 Block
 *
 * Page 是顶级 Block（parentId = NULL, isPage = true）
 */
export interface Page {
  id: string
  blockId: string | null
  title: string
  type: PageType
  icon: string | null
  cover: string | null
  aliases: string[]
  filePath: string | null
  childrenCount: number
  wordCount: number
  createdAt: number
  updatedAt: number
  deleted: boolean
  deletedAt: number | null
}

/**
 * Page 创建选项
 */
export interface PageCreateOptions {
  title: string
  type?: PageType
  icon?: string | null
  aliases?: string[]
}

/**
 * Page 更新选项
 */
export interface PageUpdateOptions {
  title?: string
  type?: PageType
  icon?: string | null
  cover?: string | null
  aliases?: string[]
  filePath?: string | null
}

// =============================================================================
// Link Types
// =============================================================================

/**
 * Link - 双向链接
 *
 * 记录 Block 到 Page 的引用关系。
 */
export interface Link {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  relationshipType: string | null
  inverseRelationshipType: string | null
  createdAt: number
}

/**
 * Link 创建选项
 */
export interface LinkCreateOptions {
  sourceBlockId: string
  targetPageId: string
  displayText?: string
  relationshipType?: string | null
}

/**
 * 链接解析结果
 */
export interface LinkParse {
  fullMatch: string
  target: string
  displayText: string | null
  isExternal: boolean
}

// =============================================================================
// Tag Types
// =============================================================================

/**
 * Tag - 标签
 *
 * Phase 1 中从 Block.content 解析，不单独存储。
 * Phase 2 可能引入独立的 Tag 存储。
 */
export interface Tag {
  id: string
  name: string
  parentId: string | null
  color: string | null
  createdAt: number
}

/**
 * Tag 解析结果
 */
export interface TagParse {
  fullMatch: string
  name: string
  isNested: boolean
}

// =============================================================================
// Property Types
// =============================================================================

/**
 * 属性类型
 */
export type PropertyType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'array' | 'page'

/**
 * 属性值映射（类型安全）
 */
export type PropertyValueMap = {
  string: string
  number: number
  boolean: boolean
  date: string
  datetime: string
  array: string[]
  page: string
}

export type PropertyValue = PropertyValueMap[PropertyType]

/**
 * 封闭值选项
 */
export interface ClosedValue {
  value: string | number | boolean
  label: string
  description?: string
  icon?: string
}

/**
 * 属性定义（元数据）
 *
 * 全局配置，描述一个属性的元信息。
 */
export interface PropertyDefinition {
  key: string
  title: string
  type: PropertyType
  closedValues?: ClosedValue[]
  isBuiltIn?: boolean
  description?: string
  displayPosition?: 'between-bullet-content' | 'right-of-content' | 'bottom-of-block'
  displayStyle?: 'icon-text' | 'icon' | 'text'
}

/**
 * 属性实例
 *
 * 存储在数据库中的实际数据。
 */
export interface Property<T = PropertyValue> {
  id: string
  blockId: string
  key: string
  value: T
  type: PropertyType
  sortOrder: number
  isHidden: boolean
  isDeleted: boolean
  schemaVersion: number
  createdAt: number
  updatedAt: number
}

/**
 * 属性创建选项
 */
export interface PropertyCreateOptions {
  blockId: string
  key: string
  value: PropertyValue
  type?: PropertyType
}

/**
 * 属性更新选项
 */
export interface PropertyUpdateOptions {
  value?: PropertyValue
  type?: PropertyType
  sortOrder?: number
  isHidden?: boolean
}

// =============================================================================
// Search Types
// =============================================================================

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
  highlights: SearchHighlight[]
}

/**
 * 搜索高亮
 */
export interface SearchHighlight {
  start: number
  end: number
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  query: string
  pageId?: string
  limit?: number
  offset?: number
}

// =============================================================================
// Sort Types
// =============================================================================

/**
 * 排序选项
 */
export interface SortOptions {
  field: 'pos' | 'createdAt' | 'updatedAt'
  direction: 'asc' | 'desc'
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * 操作结果
 */
export interface Result<T = void> {
  success: boolean
  data?: T
  error?: string
}

/**
 * 分页结果
 */
export interface PagedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}
