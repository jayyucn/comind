/**
 * Core Layer - IndexedDB 存储适配器
 *
 * 使用 Dexie.js 实现 StorageAdapter 接口，
 * 与现有的 IndexedDB 数据库交互。
 */

import Dexie from 'dexie'
import type {
  Block,
  BlockCreateOptions,
  BlockUpdateOptions,
  Page,
  PageCreateOptions,
  PageUpdateOptions,
  Link,
  LinkCreateOptions,
  Property,
  PropertyCreateOptions,
  PropertyUpdateOptions,
  PagedResult,
  Tag,
} from '../types'
import type {
  StorageAdapter,
  BlockRepository,
  PageRepository,
  LinkRepository,
  TagRepository,
  PropertyRepository,
  TransactionCallback,
} from './adapter'
import { generateUUID } from '../../utils/id'

// =============================================================================
// Record Types (IndexedDB Storage Format)
// =============================================================================

/** Block 存储记录 */
interface BlockRecord {
  id: string
  pageId: string
  parentId: string | null
  pos: number
  content: string
  format: string      // JSON string
  type: string
  properties: string  // JSON string
  createdAt: number
  updatedAt: number
}

/** Page 存储记录 */
interface PageRecord {
  id: string
  blockId: string | null
  title: string
  type: string
  icon: string | null
  cover: string | null
  aliases: string    // JSON string
  filePath: string | null
  childrenCount: number
  wordCount: number
  createdAt: number
  updatedAt: number
  deleted: number    // 0 or 1
  deletedAt: number | null
}

/** Link 存储记录 */
interface LinkRecord {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  relationshipType: string | null
  inverseRelationshipType: string | null
  createdAt: number
}

/** Property 存储记录 */
interface PropertyRecord {
  id: string
  blockId: string
  key: string
  value: string      // JSON string
  type: string
  sortOrder: number
  isHidden: number   // 0 or 1
  isDeleted: number  // 0 or 1
  schemaVersion: number
  createdAt: number
  updatedAt: number
}

// =============================================================================
// Database Schema
// =============================================================================

class CoreDB extends Dexie {
  blocks!: Dexie.Table<BlockRecord, string>
  links!: Dexie.Table<LinkRecord, string>
  pages!: Dexie.Table<PageRecord, string>
  properties!: Dexie.Table<PropertyRecord, string>

  constructor() {
    super('comind')
    this.version(1).stores({
      blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
      links: 'id, sourceBlockId, targetPageId, displayText, relationshipType, createdAt',
      pages: 'id, blockId, title, type, deleted, createdAt, updatedAt',
      properties: 'id, blockId, [blockId+key]',
    })
  }
}

// =============================================================================
// Type Converters
// =============================================================================

/** Block Record -> Block */
function recordToBlock(record: BlockRecord): Block {
  return {
    id: record.id,
    pageId: record.pageId,
    parentId: record.parentId,
    pos: record.pos,
    content: record.content,
    format: JSON.parse(record.format || '{}'),
    type: record.type as Block['type'],
    properties: JSON.parse(record.properties || '{}'),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Block -> Block Record */
function blockToRecord(block: Block): BlockRecord {
  return {
    id: block.id,
    pageId: block.pageId,
    parentId: block.parentId,
    pos: block.pos,
    content: block.content,
    format: JSON.stringify(block.format || {}),
    type: block.type,
    properties: JSON.stringify(block.properties || {}),
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  }
}

/** Page Record -> Page */
function recordToPage(record: PageRecord): Page {
  return {
    id: record.id,
    blockId: record.blockId,
    title: record.title,
    type: record.type as Page['type'],
    icon: record.icon,
    cover: record.cover,
    aliases: JSON.parse(record.aliases || '[]'),
    filePath: record.filePath,
    childrenCount: record.childrenCount,
    wordCount: record.wordCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deleted: record.deleted === 1,
    deletedAt: record.deletedAt,
  }
}

/** Page -> Page Record */
function pageToRecord(page: Page): PageRecord {
  return {
    id: page.id,
    blockId: page.blockId,
    title: page.title,
    type: page.type,
    icon: page.icon,
    cover: page.cover,
    aliases: JSON.stringify(page.aliases || []),
    filePath: page.filePath,
    childrenCount: page.childrenCount,
    wordCount: page.wordCount,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    deleted: page.deleted ? 1 : 0,
    deletedAt: page.deletedAt,
  }
}

/** Link is identical between Core and Record */
function recordToLink(record: LinkRecord): Link {
  return { ...record }
}

function linkToRecord(link: Link): LinkRecord {
  return { ...link }
}

/** Property Record -> Property */
function recordToProperty(record: PropertyRecord): Property {
  return {
    id: record.id,
    blockId: record.blockId,
    key: record.key,
    value: JSON.parse(record.value || 'null'),
    type: record.type as Property['type'],
    sortOrder: record.sortOrder,
    isHidden: record.isHidden === 1,
    isDeleted: record.isDeleted === 1,
    schemaVersion: record.schemaVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Property -> Property Record */
function propertyToRecord(property: Property): PropertyRecord {
  return {
    id: property.id,
    blockId: property.blockId,
    key: property.key,
    value: JSON.stringify(property.value),
    type: property.type,
    sortOrder: property.sortOrder,
    isHidden: property.isHidden ? 1 : 0,
    isDeleted: property.isDeleted ? 1 : 0,
    schemaVersion: property.schemaVersion,
    createdAt: property.createdAt,
    updatedAt: property.updatedAt,
  }
}

// =============================================================================
// Repositories
// =============================================================================

class IndexedDBBlockRepository implements BlockRepository {
  private db: CoreDB

  constructor(db: CoreDB) {
    this.db = db
  }

  async findById(id: string): Promise<Block | undefined> {
    const record = await this.db.blocks.get(id)
    return record ? recordToBlock(record) : undefined
  }

  async findByPageId(pageId: string): Promise<Block[]> {
    const records = await this.db.blocks.where('pageId').equals(pageId).toArray()
    return records.map(recordToBlock)
  }

  async findByParentId(parentId: string | null): Promise<Block[]> {
    if (parentId === null) {
      const records = await this.db.blocks.where('parentId').equals('').toArray()
      return records.map(recordToBlock)
    }
    const records = await this.db.blocks.where('parentId').equals(parentId).toArray()
    const sorted = records.sort((a, b) => a.pos - b.pos)
    return sorted.map(recordToBlock)
  }

  async findByIds(ids: string[]): Promise<Block[]> {
    const records = await this.db.blocks.where('id').anyOf(ids).toArray()
    return records.map(recordToBlock)
  }

  async findAll(limit = 100, offset = 0): Promise<PagedResult<Block>> {
    const total = await this.db.blocks.count()
    const records = await this.db.blocks.offset(offset).limit(limit).toArray()
    return {
      items: records.map(recordToBlock),
      total,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
      hasMore: offset + limit < total,
    }
  }

  async create(options: BlockCreateOptions): Promise<Block> {
    const now = Date.now()
    const block: Block = {
      id: generateUUID(),
      pageId: options.pageId,
      parentId: options.parentId ?? null,
      pos: 1000,
      content: options.content ?? '',
      format: {},
      type: options.type ?? 'bullet',
      properties: options.properties ?? {},
      createdAt: now,
      updatedAt: now,
    }
    await this.db.blocks.add(blockToRecord(block))
    return block
  }

  async update(id: string, options: BlockUpdateOptions): Promise<Block> {
    const existing = await this.db.blocks.get(id)
    if (!existing) throw new Error(`Block not found: ${id}`)

    const updated: Block = {
      ...recordToBlock(existing),
      ...options,
      updatedAt: Date.now(),
    }
    await this.db.blocks.put(blockToRecord(updated))
    return updated
  }

  async delete(id: string): Promise<void> {
    await this.db.blocks.delete(id)
  }

  async deleteByPageId(pageId: string): Promise<void> {
    await this.db.blocks.where('pageId').equals(pageId).delete()
  }

  async reorder(_parentId: string | null, blockIds: string[]): Promise<void> {
    await this.db.transaction('rw', this.db.blocks, async () => {
      for (let i = 0; i < blockIds.length; i++) {
        const record = await this.db.blocks.get(blockIds[i])
        if (record) {
          record.pos = (i + 1) * 1000
          record.updatedAt = Date.now()
          await this.db.blocks.put(record)
        }
      }
    })
  }
}

class IndexedDBPageRepository implements PageRepository {
  private db: CoreDB

  constructor(db: CoreDB) {
    this.db = db
  }

  async findById(id: string): Promise<Page | undefined> {
    const record = await this.db.pages.get(id)
    return record ? recordToPage(record) : undefined
  }

  async findByTitle(title: string): Promise<Page | undefined> {
    const records = await this.db.pages.where('title').equals(title).toArray()
    return records.length > 0 ? recordToPage(records[0]) : undefined
  }

  async findByIds(ids: string[]): Promise<Page[]> {
    const records = await this.db.pages.where('id').anyOf(ids).toArray()
    return records.map(recordToPage)
  }

  async findAll(limit = 100, offset = 0): Promise<PagedResult<Page>> {
    const total = await this.db.pages.count()
    const records = await this.db.pages.offset(offset).limit(limit).toArray()
    return {
      items: records.map(recordToPage),
      total,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
      hasMore: offset + limit < total,
    }
  }

  async findRecent(limit = 10): Promise<Page[]> {
    const records = await this.db.pages
      .filter(p => p.deleted === 0)
      .reverse()
      .sortBy('updatedAt')
    return records.slice(0, limit).map(recordToPage)
  }

  async findDeleted(limit = 100, offset = 0): Promise<PagedResult<Page>> {
    const all = await this.db.pages.filter(p => p.deleted === 1).toArray()
    const total = all.length
    const items = all.slice(offset, offset + limit)
    return {
      items: items.map(recordToPage),
      total,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
      hasMore: offset + limit < total,
    }
  }

  async create(options: PageCreateOptions): Promise<Page> {
    const now = Date.now()
    const page: Page = {
      id: generateUUID(),
      blockId: null,
      title: options.title,
      type: options.type ?? 'normal',
      icon: options.icon ?? null,
      cover: null,
      aliases: options.aliases ?? [],
      filePath: null,
      childrenCount: 0,
      wordCount: 0,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      deletedAt: null,
    }
    await this.db.pages.add(pageToRecord(page))
    return page
  }

  async update(id: string, options: PageUpdateOptions): Promise<Page> {
    const existing = await this.db.pages.get(id)
    if (!existing) throw new Error(`Page not found: ${id}`)

    const updated: Page = {
      ...recordToPage(existing),
      ...options,
      updatedAt: Date.now(),
    }
    await this.db.pages.put(pageToRecord(updated))
    return updated
  }

  async softDelete(id: string): Promise<void> {
    const record = await this.db.pages.get(id)
    if (record) {
      record.deleted = 1
      record.deletedAt = Date.now()
      await this.db.pages.put(record)
    }
  }

  async restore(id: string): Promise<void> {
    const record = await this.db.pages.get(id)
    if (record) {
      record.deleted = 0
      record.deletedAt = null
      await this.db.pages.put(record)
    }
  }

  async permanentDelete(id: string): Promise<void> {
    await this.db.pages.delete(id)
  }

  async emptyTrash(): Promise<void> {
    await this.db.pages.where('deleted').equals(1).delete()
  }
}

class IndexedDBLinkRepository implements LinkRepository {
  private db: CoreDB

  constructor(db: CoreDB) {
    this.db = db
  }

  async findById(id: string): Promise<Link | undefined> {
    const record = await this.db.links.get(id)
    return record ? recordToLink(record) : undefined
  }

  async findBySourceBlockId(blockId: string): Promise<Link[]> {
    const records = await this.db.links.where('sourceBlockId').equals(blockId).toArray()
    return records.map(recordToLink)
  }

  async findByTargetPageId(pageId: string): Promise<Link[]> {
    const records = await this.db.links.where('targetPageId').equals(pageId).toArray()
    return records.map(recordToLink)
  }

  async findAll(limit = 100, offset = 0): Promise<PagedResult<Link>> {
    const total = await this.db.links.count()
    const records = await this.db.links.offset(offset).limit(limit).toArray()
    return {
      items: records.map(recordToLink),
      total,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
      hasMore: offset + limit < total,
    }
  }

  async create(options: LinkCreateOptions): Promise<Link> {
    const link: Link = {
      id: generateUUID(),
      sourceBlockId: options.sourceBlockId,
      targetPageId: options.targetPageId,
      displayText: options.displayText ?? options.targetPageId,
      relationshipType: options.relationshipType ?? null,
      inverseRelationshipType: null,
      createdAt: Date.now(),
    }
    await this.db.links.add(linkToRecord(link))
    return link
  }

  async update(id: string, options: Partial<LinkCreateOptions>): Promise<Link> {
    const existing = await this.db.links.get(id)
    if (!existing) throw new Error(`Link not found: ${id}`)

    const updated: Link = { ...recordToLink(existing), ...options }
    await this.db.links.put(linkToRecord(updated))
    return updated
  }

  async delete(id: string): Promise<void> {
    await this.db.links.delete(id)
  }

  async deleteBySourceBlockId(blockId: string): Promise<void> {
    await this.db.links.where('sourceBlockId').equals(blockId).delete()
  }

  async deleteByTargetPageId(pageId: string): Promise<void> {
    await this.db.links.where('targetPageId').equals(pageId).delete()
  }
}

class IndexedDBPropertyRepository implements PropertyRepository {
  private db: CoreDB

  constructor(db: CoreDB) {
    this.db = db
  }

  async findById(id: string): Promise<Property | undefined> {
    const record = await this.db.properties.get(id)
    return record ? recordToProperty(record) : undefined
  }

  async findByBlockId(blockId: string): Promise<Property[]> {
    const records = await this.db.properties.where('blockId').equals(blockId).toArray()
    return records
      .filter(r => r.isDeleted === 0)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(recordToProperty)
  }

  async findByKey(blockId: string, key: string): Promise<Property | undefined> {
    const records = await this.db.properties
      .where('[blockId+key]')
      .equals([blockId, key])
      .toArray()
    const record = records.find(r => r.isDeleted === 0)
    return record ? recordToProperty(record) : undefined
  }

  async findAll(limit = 100, offset = 0): Promise<PagedResult<Property>> {
    const total = await this.db.properties.count()
    const records = await this.db.properties.offset(offset).limit(limit).toArray()
    return {
      items: records.map(recordToProperty),
      total,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
      hasMore: offset + limit < total,
    }
  }

  async create(options: PropertyCreateOptions): Promise<Property> {
    const now = Date.now()
    const existing = await this.findByBlockId(options.blockId)

    const property: Property = {
      id: generateUUID(),
      blockId: options.blockId,
      key: options.key,
      value: options.value,
      type: options.type ?? 'string',
      sortOrder: existing.length,
      isHidden: false,
      isDeleted: false,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    }
    await this.db.properties.add(propertyToRecord(property))
    return property
  }

  async update(id: string, options: PropertyUpdateOptions): Promise<Property> {
    const existing = await this.db.properties.get(id)
    if (!existing) throw new Error(`Property not found: ${id}`)

    const updated: Property = {
      ...recordToProperty(existing),
      ...options,
      updatedAt: Date.now(),
    }
    await this.db.properties.put(propertyToRecord(updated))
    return updated
  }

  async upsert(
    blockId: string,
    key: string,
    value: PropertyCreateOptions['value'],
    type?: PropertyCreateOptions['type']
  ): Promise<Property> {
    const existing = await this.findByKey(blockId, key)
    if (existing) {
      return this.update(existing.id, { value })
    }
    return this.create({ blockId, key, value, type })
  }

  async delete(id: string): Promise<void> {
    const record = await this.db.properties.get(id)
    if (record) {
      record.isDeleted = 1
      record.updatedAt = Date.now()
      await this.db.properties.put(record)
    }
  }

  async deleteByBlockId(blockId: string): Promise<void> {
    const records = await this.db.properties.where('blockId').equals(blockId).toArray()
    const now = Date.now()
    await this.db.transaction('rw', this.db.properties, async () => {
      for (const record of records) {
        record.isDeleted = 1
        record.updatedAt = now
        await this.db.properties.put(record)
      }
    })
  }

  async deleteByBlockIdAndKey(blockId: string, key: string): Promise<void> {
    const property = await this.findByKey(blockId, key)
    if (property) {
      await this.delete(property.id)
    }
  }
}

// =============================================================================
// Tag Repository (Phase 2 扩展)
// =============================================================================

class IndexedDBTagRepository implements TagRepository {
  async findById(_id: string): Promise<Tag | undefined> {
    // Phase 2: 实现 Tag 表后完善
    return undefined
  }

  async findByName(_name: string): Promise<Tag | undefined> {
    // Phase 2: 实现 Tag 表后完善
    return undefined
  }

  async findAll(): Promise<Tag[]> {
    // Phase 2: 实现 Tag 表后完善
    return []
  }

  async create(name: string, parentId?: string | null): Promise<Tag> {
    // Phase 2: 实现 Tag 表后完善
    const tag: Tag = {
      id: generateUUID(),
      name,
      parentId: parentId ?? null,
      color: null,
      createdAt: Date.now(),
    }
    return tag
  }

  async update(_id: string, _updates: Partial<Tag>): Promise<Tag> {
    // Phase 2: 实现 Tag 表后完善
    throw new Error('Tag repository not fully implemented')
  }

  async delete(_id: string): Promise<void> {
    // Phase 2: 实现 Tag 表后完善
  }
}

// =============================================================================
// IndexedDB Adapter
// =============================================================================

export class IndexedDBAdapter implements StorageAdapter {
  readonly blocks: BlockRepository
  readonly pages: PageRepository
  readonly links: LinkRepository
  readonly tags: TagRepository
  readonly properties: PropertyRepository

  private db: CoreDB
  private _ready = false

  constructor() {
    this.db = new CoreDB()
    this.blocks = new IndexedDBBlockRepository(this.db)
    this.pages = new IndexedDBPageRepository(this.db)
    this.links = new IndexedDBLinkRepository(this.db)
    this.tags = new IndexedDBTagRepository()
    this.properties = new IndexedDBPropertyRepository(this.db)
  }

  isReady(): boolean {
    return this._ready
  }

  async open(): Promise<void> {
    await this.db.open()
    this._ready = true
  }

  async transaction<T>(callback: TransactionCallback<T>): Promise<T> {
    return this.db.transaction('rw', [this.db.blocks, this.db.pages, this.db.links, this.db.properties], callback as any) as Promise<T>
  }

  async close(): Promise<void> {
    await this.db.close()
    this._ready = false
  }
}
