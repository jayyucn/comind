import Dexie, { type Table } from 'dexie'
import type { BlockRecord } from '../types/block'
import type { LinkRecord } from '../types/link'
import type { PageRecord } from '../types/page'
import type { PropertyRecord } from '../types/property'
import type { Asset } from '../types/asset'
import type { UserTemplate } from '../types/template'

/** 关系类型记录（成对组） */
export interface RelationshipTypeRecord {
  /** 稳定主键；种子用 `rt_seed_<type>`，用户新建用 `rt_user_<nanoid>` */
  id: string
  /** 正向英文标识 */
  type: string
  /** 反向英文标识；自反为 null */
  inverse: string | null
  /** 正向中文标签 */
  label: string
  /** 反向中文标签 */
  inverseLabel: string
  /** 颜色，hex 格式 */
  color: string
  /** 排序权重，越小越靠前 */
  order: number
  /** 软删除标记 */
  deleted: boolean
  /** 是否内置默认（防止用户硬删后迁移重新插入） */
  builtin: boolean
}

export class ComindDB extends Dexie {
  blocks!: Table<BlockRecord, string>
  links!: Table<LinkRecord, string>
  pages!: Table<PageRecord, string>
  properties!: Table<PropertyRecord, string>
  assets!: Table<Asset, string>
  relationshipTypes!: Table<RelationshipTypeRecord, string>
  templates!: Table<UserTemplate, string>

  constructor() {
    super('comind')
    // 保留 v7 兼容性
    this.version(7).stores({
      blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
      links: 'id, sourceBlockId, targetPageId, displayText, relationshipType, createdAt',
      pages: 'id, blockId, title, type, deleted, createdAt, updatedAt',
      properties: 'id, blockId, [blockId+key]',
      assets: 'id'
    })
    // v8 新增 relationshipTypes
    this.version(8).stores({
      blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
      links: 'id, sourceBlockId, targetPageId, displayText, relationshipType, createdAt',
      pages: 'id, blockId, title, type, deleted, createdAt, updatedAt',
      properties: 'id, blockId, [blockId+key]',
      assets: 'id',
      relationshipTypes: 'id, type, deleted, builtin, order'
    })
    // v9 新增 templates（用户另存的模板）
    this.version(9).stores({
      blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
      links: 'id, sourceBlockId, targetPageId, displayText, relationshipType, createdAt',
      pages: 'id, blockId, title, type, deleted, createdAt, updatedAt',
      properties: 'id, blockId, [blockId+key]',
      assets: 'id',
      relationshipTypes: 'id, type, deleted, builtin, order',
      templates: 'id, category, updatedAt, name'
    })
  }
}

export const db = new ComindDB()
