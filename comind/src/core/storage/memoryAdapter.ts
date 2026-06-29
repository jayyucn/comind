/**
 * Core Layer - 内存存储适配器（用于测试）
 *
 * 将所有数据存储在内存中，不进行持久化。
 * 用于单元测试和快速原型开发。
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
  RelationshipType,
  RelationshipTypeCreateOptions,
  RelationshipTypeUpdateOptions,
  UserTemplate,
  TemplateCreateOptions,
  TemplateUpdateOptions,
  PagedResult,
} from '../types'
import type {
  StorageAdapter,
  BlockRepository,
  PageRepository,
  LinkRepository,
  TagRepository,
  PropertyRepository,
  RelationshipTypeRepository,
  TemplateRepository,
  TransactionCallback,
} from './adapter'
import { generateUUID } from '../../utils/id'

/**
 * 内存存储实现
 */
class MemoryBlockRepository implements BlockRepository {
  private blocks: Map<string, Block> = new Map()

  async findById(id: string): Promise<Block | undefined> {
    return this.blocks.get(id)
  }

  async findByPageId(pageId: string): Promise<Block[]> {
    return Array.from(this.blocks.values()).filter(b => b.pageId === pageId)
  }

  async findByParentId(parentId: string | null): Promise<Block[]> {
    return Array.from(this.blocks.values())
      .filter(b => b.parentId === parentId)
      .sort((a, b) => a.pos - b.pos)
  }

  async findByIds(ids: string[]): Promise<Block[]> {
    return Array.from(this.blocks.values()).filter(b => ids.includes(b.id))
  }

  async findAll(limit = 100, offset = 0): Promise<PagedResult<Block>> {
    const items = Array.from(this.blocks.values()).slice(offset, offset + limit)
    return { items, total: this.blocks.size, page: Math.floor(offset / limit) + 1, pageSize: limit, hasMore: offset + limit < this.blocks.size }
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
      createdAt: now,
      updatedAt: now,
    }
    this.blocks.set(block.id, block)
    return block
  }

  async update(id: string, options: BlockUpdateOptions): Promise<Block> {
    const block = this.blocks.get(id)
    if (!block) throw new Error(`Block not found: ${id}`)
    const updated: Block = {
      ...block,
      ...options,
      updatedAt: Date.now(),
    }
    this.blocks.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    this.blocks.delete(id)
  }

  async deleteByPageId(pageId: string): Promise<void> {
    for (const [id, block] of this.blocks) {
      if (block.pageId === pageId) {
        this.blocks.delete(id)
      }
    }
  }

  async reorder(_parentId: string | null, blockIds: string[]): Promise<void> {
    for (let i = 0; i < blockIds.length; i++) {
      const block = this.blocks.get(blockIds[i])
      if (block) {
        block.pos = (i + 1) * 1000
        block.updatedAt = Date.now()
      }
    }
  }
}

class MemoryPageRepository implements PageRepository {
  private pages: Map<string, Page> = new Map()

  async findById(id: string): Promise<Page | undefined> {
    return this.pages.get(id)
  }

  async findByTitle(title: string): Promise<Page | undefined> {
    return Array.from(this.pages.values()).find(p => p.title === title)
  }

  async findByIds(ids: string[]): Promise<Page[]> {
    return Array.from(this.pages.values()).filter(p => ids.includes(p.id))
  }

  async findAll(limit = 100, offset = 0): Promise<PagedResult<Page>> {
    const items = Array.from(this.pages.values()).slice(offset, offset + limit)
    return { items, total: this.pages.size, page: Math.floor(offset / limit) + 1, pageSize: limit, hasMore: offset + limit < this.pages.size }
  }

  async findRecent(limit = 10): Promise<Page[]> {
    return Array.from(this.pages.values())
      .filter(p => !p.deleted)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
  }

  async findDeleted(limit = 100, offset = 0): Promise<PagedResult<Page>> {
    const deleted = Array.from(this.pages.values()).filter(p => p.deleted)
    const items = deleted.slice(offset, offset + limit)
    return { items, total: deleted.length, page: Math.floor(offset / limit) + 1, pageSize: limit, hasMore: offset + limit < deleted.length }
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
    this.pages.set(page.id, page)
    return page
  }

  async update(id: string, options: PageUpdateOptions): Promise<Page> {
    const page = this.pages.get(id)
    if (!page) throw new Error(`Page not found: ${id}`)
    const updated: Page = { ...page, ...options, updatedAt: Date.now() }
    this.pages.set(id, updated)
    return updated
  }

  async softDelete(id: string): Promise<void> {
    const page = this.pages.get(id)
    if (page) {
      page.deleted = true
      page.deletedAt = Date.now()
    }
  }

  async restore(id: string): Promise<void> {
    const page = this.pages.get(id)
    if (page) {
      page.deleted = false
      page.deletedAt = null
    }
  }

  async permanentDelete(id: string): Promise<void> {
    this.pages.delete(id)
  }

  async emptyTrash(): Promise<void> {
    for (const [id, page] of this.pages) {
      if (page.deleted) {
        this.pages.delete(id)
      }
    }
  }
}

class MemoryLinkRepository implements LinkRepository {
  private links: Map<string, Link> = new Map()

  async findById(id: string): Promise<Link | undefined> {
    return this.links.get(id)
  }

  async findBySourceBlockId(blockId: string): Promise<Link[]> {
    return Array.from(this.links.values()).filter(l => l.sourceBlockId === blockId)
  }

  async findByTargetPageId(pageId: string): Promise<Link[]> {
    return Array.from(this.links.values()).filter(l => l.targetPageId === pageId)
  }

  async findAll(limit = 100, offset = 0): Promise<PagedResult<Link>> {
    const items = Array.from(this.links.values()).slice(offset, offset + limit)
    return { items, total: this.links.size, page: Math.floor(offset / limit) + 1, pageSize: limit, hasMore: offset + limit < this.links.size }
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
    this.links.set(link.id, link)
    return link
  }

  async update(id: string, options: Partial<LinkCreateOptions>): Promise<Link> {
    const link = this.links.get(id)
    if (!link) throw new Error(`Link not found: ${id}`)
    const updated: Link = { ...link, ...options }
    this.links.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    this.links.delete(id)
  }

  async deleteBySourceBlockId(blockId: string): Promise<void> {
    for (const [id, link] of this.links) {
      if (link.sourceBlockId === blockId) {
        this.links.delete(id)
      }
    }
  }

  async deleteByTargetPageId(pageId: string): Promise<void> {
    for (const [id, link] of this.links) {
      if (link.targetPageId === pageId) {
        this.links.delete(id)
      }
    }
  }
}

class MemoryTagRepository implements TagRepository {
  private tags: Map<string, Tag> = new Map()

  async findById(id: string): Promise<Tag | undefined> {
    return this.tags.get(id)
  }

  async findByName(name: string): Promise<Tag | undefined> {
    return Array.from(this.tags.values()).find(t => t.name === name)
  }

  async findAll(): Promise<Tag[]> {
    return Array.from(this.tags.values())
  }

  async create(name: string, parentId?: string | null): Promise<Tag> {
    const tag: Tag = {
      id: generateUUID(),
      name,
      parentId: parentId ?? null,
      color: null,
      createdAt: Date.now(),
    }
    this.tags.set(tag.id, tag)
    return tag
  }

  async update(id: string, updates: Partial<Tag>): Promise<Tag> {
    const tag = this.tags.get(id)
    if (!tag) throw new Error(`Tag not found: ${id}`)
    const updated: Tag = { ...tag, ...updates }
    this.tags.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    this.tags.delete(id)
  }
}

class MemoryPropertyRepository implements PropertyRepository {
  private properties: Map<string, Property> = new Map()

  async findById(id: string): Promise<Property | undefined> {
    return this.properties.get(id)
  }

  async findByBlockId(blockId: string): Promise<Property[]> {
    return Array.from(this.properties.values())
      .filter(p => p.blockId === blockId && !p.isDeleted)
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }

  async findByKey(blockId: string, key: string): Promise<Property | undefined> {
    return Array.from(this.properties.values())
      .find(p => p.blockId === blockId && p.key === key && !p.isDeleted)
  }

  async findAll(limit = 100, offset = 0): Promise<PagedResult<Property>> {
    const items = Array.from(this.properties.values()).slice(offset, offset + limit)
    return { items, total: this.properties.size, page: Math.floor(offset / limit) + 1, pageSize: limit, hasMore: offset + limit < this.properties.size }
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
    this.properties.set(property.id, property)
    return property
  }

  async update(id: string, options: PropertyUpdateOptions): Promise<Property> {
    const property = this.properties.get(id)
    if (!property) throw new Error(`Property not found: ${id}`)
    const updated: Property = { ...property, ...options, updatedAt: Date.now() }
    this.properties.set(id, updated)
    return updated
  }

  async upsert(blockId: string, key: string, value: PropertyCreateOptions['value'], type?: PropertyCreateOptions['type']): Promise<Property> {
    const existing = await this.findByKey(blockId, key)
    if (existing) {
      return this.update(existing.id, { value })
    }
    return this.create({ blockId, key, value, type })
  }

  async delete(id: string): Promise<void> {
    const property = this.properties.get(id)
    if (property) {
      property.isDeleted = true
      property.updatedAt = Date.now()
    }
  }

  async deleteByBlockId(blockId: string): Promise<void> {
    for (const property of this.properties.values()) {
      if (property.blockId === blockId) {
        property.isDeleted = true
        property.updatedAt = Date.now()
      }
    }
  }

  async deleteByBlockIdAndKey(blockId: string, key: string): Promise<void> {
    const property = await this.findByKey(blockId, key)
    if (property) {
      property.isDeleted = true
      property.updatedAt = Date.now()
    }
  }
}

/**
 * Memory Storage Adapter
 *
 * 所有数据存储在内存中，不进行持久化。
 * 用于单元测试和快速原型开发。
 */
export class MemoryAdapter implements StorageAdapter {
  readonly blocks: BlockRepository = new MemoryBlockRepository()
  readonly pages: PageRepository = new MemoryPageRepository()
  readonly links: LinkRepository = new MemoryLinkRepository()
  readonly tags: TagRepository = new MemoryTagRepository()
  readonly properties: PropertyRepository = new MemoryPropertyRepository()
  readonly relationshipTypes: RelationshipTypeRepository = new MemoryRelationshipTypeRepository()
  readonly templates: TemplateRepository = new MemoryTemplateRepository()

  async transaction<T>(callback: TransactionCallback<T>): Promise<T> {
    // 内存存储天然支持事务，直接执行回调
    return callback(this)
  }

  async close(): Promise<void> {
    // 内存存储无需关闭
  }

  isReady(): boolean {
    return true
  }
}

class MemoryRelationshipTypeRepository implements RelationshipTypeRepository {
  private relationshipTypes: Map<string, RelationshipType> = new Map()

  async findById(id: string): Promise<RelationshipType | undefined> {
    return this.relationshipTypes.get(id)
  }

  async findByType(type: string): Promise<RelationshipType | undefined> {
    return Array.from(this.relationshipTypes.values()).find(r => r.type === type)
  }

  async findAll(limit = 100, offset = 0): Promise<PagedResult<RelationshipType>> {
    const all = Array.from(this.relationshipTypes.values()).sort((a, b) => a.order - b.order)
    const items = all.slice(offset, offset + limit)
    return { items, total: all.length, page: Math.floor(offset / limit) + 1, pageSize: limit, hasMore: offset + limit < all.length }
  }

  async findActive(): Promise<RelationshipType[]> {
    return Array.from(this.relationshipTypes.values())
      .filter(r => !r.deleted)
      .sort((a, b) => a.order - b.order)
  }

  async findByGroup(group: string): Promise<RelationshipType[]> {
    return Array.from(this.relationshipTypes.values())
      .filter(r => !r.deleted && r.group === group)
      .sort((a, b) => a.order - b.order)
  }

  async create(options: RelationshipTypeCreateOptions): Promise<RelationshipType> {
    const now = Date.now()
    const id = options.id ?? (options.type.startsWith('rt_') ? options.type : `rt_user_${generateUUID()}`)
    const relationshipType: RelationshipType = {
      id,
      type: options.type,
      inverse: options.inverse,
      label: options.label,
      inverseLabel: options.inverseLabel,
      description: options.description ?? null,
      color: options.color ?? '#1890ff',
      group: options.group ?? 'custom',
      strength: options.strength ?? 'medium',
      order: options.order ?? 0,
      deleted: false,
      builtin: options.builtin ?? false,
      createdAt: now,
      updatedAt: now,
    }
    this.relationshipTypes.set(relationshipType.id, relationshipType)
    return relationshipType
  }

  async update(id: string, options: RelationshipTypeUpdateOptions): Promise<RelationshipType> {
    const relationshipType = this.relationshipTypes.get(id)
    if (!relationshipType) throw new Error(`RelationshipType not found: ${id}`)
    const updated: RelationshipType = { ...relationshipType, ...options, updatedAt: Date.now() }
    this.relationshipTypes.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    this.relationshipTypes.delete(id)
  }

  async softDelete(id: string): Promise<void> {
    const relationshipType = this.relationshipTypes.get(id)
    if (relationshipType) {
      relationshipType.deleted = true
      relationshipType.updatedAt = Date.now()
    }
  }

  async restore(id: string): Promise<void> {
    const relationshipType = this.relationshipTypes.get(id)
    if (relationshipType) {
      relationshipType.deleted = false
      relationshipType.updatedAt = Date.now()
    }
  }
}

class MemoryTemplateRepository implements TemplateRepository {
  private templates: Map<string, UserTemplate> = new Map()

  async findById(id: string): Promise<UserTemplate | undefined> {
    return this.templates.get(id)
  }

  async findByCategory(category: string): Promise<UserTemplate[]> {
    return Array.from(this.templates.values())
      .filter(t => t.category === category)
      .sort((a, b) => a.updatedAt - b.updatedAt)
  }

  async findAll(limit = 100, offset = 0): Promise<PagedResult<UserTemplate>> {
    const all = Array.from(this.templates.values()).sort((a, b) => b.updatedAt - a.updatedAt)
    const items = all.slice(offset, offset + limit)
    return { items, total: all.length, page: Math.floor(offset / limit) + 1, pageSize: limit, hasMore: offset + limit < all.length }
  }

  async create(options: TemplateCreateOptions): Promise<UserTemplate> {
    const now = Date.now()
    const template: UserTemplate = {
      id: `tpl_${generateUUID()}`,
      name: options.name,
      description: options.description,
      category: options.category ?? 'custom',
      sourcePageId: options.sourcePageId,
      blocks: options.blocks,
      createdAt: now,
      updatedAt: now,
    }
    this.templates.set(template.id, template)
    return template
  }

  async update(id: string, options: TemplateUpdateOptions): Promise<UserTemplate> {
    const template = this.templates.get(id)
    if (!template) throw new Error(`Template not found: ${id}`)
    const updated: UserTemplate = { ...template, ...options, updatedAt: Date.now() }
    this.templates.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    this.templates.delete(id)
  }
}
