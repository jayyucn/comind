import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IndexedDBAdapter, recordToBlock, recordToPage, recordToProperty, blockToRecord, pageToRecord, propertyToRecord } from './indexedDB'
import type { Block } from '../types/block'
import type { LinkParse } from '../utils/parser'
import type { BlockRecord, PageRecord, PropertyRecord } from './db'
import type { Property } from '../types/property'
import type { Page } from '../types/page'

vi.mock('./db', () => ({
  db: {
    blocks: {
      put: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          first: vi.fn(),
          toArray: vi.fn().mockResolvedValue([])
        }),
        anyOf: vi.fn().mockReturnValue({
          delete: vi.fn()
        })
      }),
      bulkDelete: vi.fn()
    },
    pages: {
      put: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          first: vi.fn()
        })
      }),
      orderBy: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([])
      })
    },
    links: {
      put: vi.fn(),
      add: vi.fn(),
      delete: vi.fn(),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          delete: vi.fn()
        }),
        anyOf: vi.fn().mockReturnValue({
          delete: vi.fn()
        })
      })
    },
    properties: {
      put: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          first: vi.fn(),
          delete: vi.fn(),
          toArray: vi.fn().mockResolvedValue([])
        }),
        anyOf: vi.fn().mockReturnValue({
          delete: vi.fn()
        })
      })
    },
    transaction: vi.fn((stores, callback) => callback())
  }
}))

vi.mock('../utils/id', () => ({
  generateUUID: vi.fn().mockReturnValue('mock-uuid')
}))

function createMockBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 'block-1',
    pageId: 'page-1',
    parentId: null,
    pos: 1000,
    content: 'Test content',
    format: {},
    type: 'bullet',
    properties: {},
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides
  }
}

describe('IndexedDBAdapter', () => {
  let adapter: IndexedDBAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new IndexedDBAdapter()
  })

  describe('saveBlock', () => {
    it('saves block record to database', async () => {
      const block = createMockBlock()
      await adapter.saveBlock(block)

      const { db } = await import('./db')
      expect(db.blocks.put).toHaveBeenCalled()
    })

    it('parses links from block content', async () => {
      const block = createMockBlock({ content: 'See [[Page1]] and [[Page2]]' })
      const saveLinksSpy = vi.spyOn(adapter, 'saveLinks' as any)

      await adapter.saveBlock(block)

      expect(saveLinksSpy).toHaveBeenCalled()
    })

    it('does not create page when linked page does not exist', async () => {
      const { db } = await import('./db')

      ;(db.pages.where('title').equals as any).mockImplementation(() => ({
        first: vi.fn().mockResolvedValue(undefined)
      }))

      const createPageSpy = vi.spyOn(adapter, 'createPageWithRootBlock')

      const block = createMockBlock({ content: 'Check [[NewLinkedPage]]' })
      await adapter.saveBlock(block)

      expect(createPageSpy).not.toHaveBeenCalled()
      expect(db.links.add).not.toHaveBeenCalled()
    })
  })

  describe('getBlockTree', () => {
    it('returns empty array when no blocks exist', async () => {
      const { db } = await import('./db')
      ;(db.blocks.where('pageId').equals('page-1').toArray as any).mockResolvedValueOnce([])

      const result = await adapter.getBlockTree('page-1')
      expect(result).toEqual([])
    })

    it('orders blocks by pos within same parent', async () => {
      const { db } = await import('./db')
      ;(db.blocks.where('pageId').equals('page-1').toArray as any).mockResolvedValueOnce([
        { id: 'b1', pageId: 'page-1', parentId: null, pos: 2000, content: 'Second', format: '{}', type: 'bullet', properties: '{}', createdAt: 0, updatedAt: 0 },
        { id: 'b2', pageId: 'page-1', parentId: null, pos: 1000, content: 'First', format: '{}', type: 'bullet', properties: '{}', createdAt: 0, updatedAt: 0 }
      ])

      const result = await adapter.getBlockTree('page-1')
      expect(result[0].id).toBe('b2')
      expect(result[1].id).toBe('b1')
    })
  })

  describe('deleteBlock', () => {
    it('deletes block and related links', async () => {
      await adapter.deleteBlock('block-1')

      const { db } = await import('./db')
      expect(db.blocks.delete).toHaveBeenCalledWith('block-1')
    })
  })

  describe('deleteBlockCascade', () => {
    it('deletes multiple blocks and their links', async () => {
      await adapter.deleteBlockCascade(['block-1', 'block-2'])

      const { db } = await import('./db')
      expect(db.blocks.bulkDelete).toHaveBeenCalledWith(['block-1', 'block-2'])
      expect(db.links.where('sourceBlockId').anyOf(['block-1', 'block-2']).delete).toHaveBeenCalled()
    })
  })

  describe('mergePage', () => {
    it('moves blocks from source to target page', async () => {
      const { db } = await import('./db')

      ;(db.pages.get as any).mockImplementation((id: string) => {
        if (id === 'source-id') {
          return Promise.resolve({
            id: 'source-id',
            title: 'Source Page',
            type: 'normal',
            blockId: null,
            icon: null,
            cover: null,
            aliases: '[]',
            filePath: null,
            childrenCount: 0,
            wordCount: 0,
            createdAt: 0,
            updatedAt: 0
          })
        }
        if (id === 'target-id') {
          return Promise.resolve({
            id: 'target-id',
            title: 'Target Page',
            type: 'normal',
            blockId: null,
            icon: null,
            cover: null,
            aliases: '[]',
            filePath: null,
            childrenCount: 0,
            wordCount: 0,
            createdAt: 0,
            updatedAt: 0
          })
        }
        return Promise.resolve(undefined)
      })

      ;(db.blocks.where as any).mockImplementation((field: string) => {
        if (field === 'pageId') {
          return {
            equals: (value: string) => ({
              toArray: () => {
                if (value === 'source-id') {
                  return Promise.resolve([{
                    id: 'block-1',
                    pageId: 'source-id',
                    parentId: null,
                    pos: 1000,
                    content: 'Content',
                    format: '{}',
                    type: 'bullet',
                    properties: '{}',
                    createdAt: 0,
                    updatedAt: 0
                  }])
                }
                return Promise.resolve([])
              }
            })
          }
        }
        return { equals: () => ({ toArray: () => Promise.resolve([]) }) }
      })

      await adapter.mergePage('source-id', 'target-id')

      expect(db.transaction).toHaveBeenCalled()
    })
  })

  describe('getPage', () => {
    it('returns page by title', async () => {
      const { db } = await import('./db')
      ;(db.pages.where('title').equals('Test').first as any).mockResolvedValueOnce({
        id: 'page-1',
        title: 'Test',
        type: 'normal',
        blockId: null,
        icon: null,
        cover: null,
        aliases: '[]',
        filePath: null,
        childrenCount: 0,
        wordCount: 0,
        createdAt: 0,
        updatedAt: 0
      })

      const result = await adapter.getPage('Test')
      expect(result?.title).toBe('Test')
    })

    it('returns undefined for non-existent page', async () => {
      const { db } = await import('./db')
      ;(db.pages.where('title').equals('NonExistent').first as any).mockResolvedValueOnce(undefined)

      const result = await adapter.getPage('NonExistent')
      expect(result).toBeUndefined()
    })
  })

  describe('createPageWithRootBlock', () => {
    it('creates both page and root block', async () => {
      const { db } = await import('./db')

      await adapter.createPageWithRootBlock('New Page', 'normal')

      expect(db.pages.put).toHaveBeenCalled()
      expect(db.blocks.put).toHaveBeenCalled()
    })

    it('associates root block with page', async () => {
      const { db } = await import('./db')
      let savedBlock: any = null
      ;(db.blocks.put as any).mockImplementation((block) => {
        savedBlock = block
        return Promise.resolve()
      })

      await adapter.createPageWithRootBlock('Test Page')

      expect(savedBlock.pageId).toBeDefined()
    })
  })

  describe('deletePage', () => {
    it('deletes page and all related blocks', async () => {
      const { db } = await import('./db')
      ;(db.blocks.where('pageId').equals('page-1').toArray as any).mockResolvedValueOnce([
        { id: 'block-1', pageId: 'page-1' },
        { id: 'block-2', pageId: 'page-1' }
      ])

      await adapter.deletePage('page-1')

      expect(db.blocks.bulkDelete).toHaveBeenCalledWith(['block-1', 'block-2'])
      expect(db.pages.delete).toHaveBeenCalledWith('page-1')
    })
  })

  describe('softDeletePage', () => {
    it('marks page as deleted without removing blocks', async () => {
      const { db } = await import('./db')
      ;(db.pages.get as any).mockResolvedValueOnce({
        id: 'page-1',
        title: 'Test Page',
        type: 'normal',
        blockId: null,
        icon: null,
        cover: null,
        aliases: '[]',
        filePath: null,
        childrenCount: 0,
        wordCount: 0,
        createdAt: 0,
        updatedAt: 0,
        deleted: 0
      })

      await adapter.softDeletePage('page-1')

      expect(db.pages.put).toHaveBeenCalled()
      const updateCall = (db.pages.put as any).mock.calls[0][0]
      expect(updateCall.deleted).toBe(1)
      expect(updateCall.deletedAt).toBeDefined()
    })

    it('does nothing for non-existent page', async () => {
      const { db } = await import('./db')
      ;(db.pages.get as any).mockResolvedValueOnce(undefined)

      await adapter.softDeletePage('non-existent')

      expect(db.pages.put).not.toHaveBeenCalled()
    })
  })

  describe('restorePage', () => {
    it('restores deleted page', async () => {
      const { db } = await import('./db')
      ;(db.pages.get as any).mockResolvedValueOnce({
        id: 'page-1',
        title: 'Test Page',
        type: 'normal',
        blockId: null,
        icon: null,
        cover: null,
        aliases: '[]',
        filePath: null,
        childrenCount: 0,
        wordCount: 0,
        createdAt: 0,
        updatedAt: 0,
        deleted: 1,
        deletedAt: Date.now()
      })

      await adapter.restorePage('page-1')

      expect(db.pages.put).toHaveBeenCalled()
      const updateCall = (db.pages.put as any).mock.calls[0][0]
      expect(updateCall.deleted).toBe(0)
      expect(updateCall.deletedAt).toBeNull()
    })

    it('does nothing for non-existent page', async () => {
      const { db } = await import('./db')
      ;(db.pages.get as any).mockResolvedValueOnce(undefined)

      await adapter.restorePage('non-existent')

      expect(db.pages.put).not.toHaveBeenCalled()
    })
  })

  describe('permanentDeletePage', () => {
    it('deletes page from database', async () => {
      const { db } = await import('./db')
      ;(db.pages.get as any).mockResolvedValue({
        id: 'page-1',
        title: 'Test Page',
        type: 'normal',
        blockId: null,
        icon: null,
        cover: null,
        aliases: '[]',
        filePath: null,
        childrenCount: 0,
        wordCount: 0,
        createdAt: 0,
        updatedAt: 0
      })
      ;(db.blocks.toArray as any).mockResolvedValue([
        { id: 'block-1', pageId: 'page-1', content: 'Test content' }
      ])

      await adapter.permanentDeletePage('page-1')

      expect(db.pages.delete).toHaveBeenCalledWith('page-1')
    })
  })

  describe('getTrashedPages', () => {
    it('returns deleted pages sorted by deletedAt descending', async () => {
      const { db } = await import('./db')
      ;(db.pages.where as any).mockImplementation(() => ({
        equals: (value: number) => ({
          sortBy: (field: string) => Promise.resolve([
            { id: 'page-1', title: 'Deleted 1', type: 'normal', deleted: 1, deletedAt: 1000 },
            { id: 'page-2', title: 'Deleted 2', type: 'normal', deleted: 1, deletedAt: 2000 }
          ])
        })
      }))

      const result = await adapter.getTrashedPages()

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('page-2')
      expect(result[1].id).toBe('page-1')
    })

    it('returns empty array when no deleted pages', async () => {
      const { db } = await import('./db')
      ;(db.pages.where as any).mockImplementation(() => ({
        equals: (value: number) => ({
          sortBy: (field: string) => Promise.resolve([])
        })
      }))

      const result = await adapter.getTrashedPages()

      expect(result).toEqual([])
    })
  })

  describe('cleanupPageReferences', () => {
    it('handles non-existent page gracefully', async () => {
      const { db } = await import('./db')
      ;(db.pages.get as any).mockResolvedValueOnce(undefined)

      await adapter.cleanupPageReferences('non-existent')

      expect(db.blocks.toArray).not.toHaveBeenCalled()
    })
  })

  describe('getTrashedPageByTitle', () => {
    it('returns deleted page by title', async () => {
      const { db } = await import('./db')
      ;(db.pages.where as any).mockImplementation(() => ({
        equals: (value: string) => ({
          and: (fn: (r: any) => boolean) => ({
            first: () => Promise.resolve({
              id: 'page-1',
              title: 'Deleted Page',
              type: 'normal',
              deleted: 1
            })
          })
        })
      }))

      const result = await adapter.getTrashedPageByTitle('Deleted Page')

      expect(result).toBeDefined()
      expect(result?.title).toBe('Deleted Page')
    })

    it('returns undefined when page not found', async () => {
      const { db } = await import('./db')
      ;(db.pages.where as any).mockImplementation(() => ({
        equals: (value: string) => ({
          and: () => ({
            first: () => Promise.resolve(undefined)
          })
        })
      }))

      const result = await adapter.getTrashedPageByTitle('Non-existent')

      expect(result).toBeUndefined()
    })
  })

  describe('getBacklinks', () => {
    it('returns links pointing to target page', async () => {
      const { db } = await import('./db')
      ;(db.links.where as any).mockImplementation(() => ({
        equals: () => ({
          toArray: () => Promise.resolve([
            { id: 'link-1', targetPageId: 'page-1' }
          ])
        })
      }))

      const result = await adapter.getBacklinks('page-1')

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('link-1')
    })
  })

  describe('updatePage', () => {
    it('updates page record', async () => {
      const { db } = await import('./db')
      const page: Page = {
        id: 'page-1',
        blockId: 'block-1',
        title: 'Updated Title',
        type: 'normal',
        icon: null,
        cover: null,
        aliases: [],
        filePath: null,
        childrenCount: 0,
        wordCount: 0,
        createdAt: 0,
        updatedAt: Date.now()
      }

      await adapter.updatePage(page)

      expect(db.pages.put).toHaveBeenCalled()
    })
  })

  describe('syncPageStats', () => {
    it('updates page with correct count and word count', async () => {
      const { db } = await import('./db')

      ;(db.blocks.where('pageId').equals('page-1').toArray as any).mockResolvedValueOnce([
        { id: 'b1', pageId: 'page-1', parentId: null, pos: 1000, content: 'Hello world', format: '{}', type: 'bullet', properties: '{}', createdAt: 0, updatedAt: 0 },
        { id: 'b2', pageId: 'page-1', parentId: null, pos: 2000, content: 'Test content', format: '{}', type: 'bullet', properties: '{}', createdAt: 0, updatedAt: 0 }
      ])

      ;(db.pages.get as any).mockResolvedValueOnce({
        id: 'page-1',
        title: 'Test',
        type: 'normal',
        blockId: null,
        icon: null,
        cover: null,
        aliases: '[]',
        filePath: null,
        childrenCount: 0,
        wordCount: 0,
        createdAt: 0,
        updatedAt: 0
      })

      await adapter.syncPageStats('page-1')

      const updateCall = (db.pages.put as any).mock.calls[0][0]
      expect(updateCall.childrenCount).toBe(2)
      expect(updateCall.wordCount).toBe(4)
    })
  })
})

describe('Conversion Functions', () => {
  describe('recordToBlock', () => {
    it('correctly converts valid JSON records', () => {
      const record: BlockRecord = {
        id: 'b1',
        pageId: 'p1',
        parentId: null,
        pos: 1000,
        content: 'Test content',
        format: '{"font": "bold"}',
        type: 'bullet',
        properties: '{"color": "red"}',
        createdAt: 0,
        updatedAt: 0
      }

      const block = recordToBlock(record)
      expect(block.format).toEqual({ font: 'bold' })
      expect(block.properties).toEqual({ color: 'red' })
    })

    it('gracefully handles invalid format JSON', () => {
      const record: BlockRecord = {
        id: 'b1',
        pageId: 'p1',
        parentId: null,
        pos: 1000,
        content: 'Test',
        format: 'invalid-json',
        type: 'bullet',
        properties: '{}',
        createdAt: 0,
        updatedAt: 0
      }

      const block = recordToBlock(record)
      expect(block.format).toEqual({})
    })

    it('gracefully handles invalid properties JSON', () => {
      const record: BlockRecord = {
        id: 'b1',
        pageId: 'p1',
        parentId: null,
        pos: 1000,
        content: 'Test',
        format: '{}',
        type: 'bullet',
        properties: 'invalid-json',
        createdAt: 0,
        updatedAt: 0
      }

      const block = recordToBlock(record)
      expect(block.properties).toEqual({})
    })

    it('gracefully handles both invalid format and properties JSON', () => {
      const record: BlockRecord = {
        id: 'b1',
        pageId: 'p1',
        parentId: null,
        pos: 1000,
        content: 'Test',
        format: 'invalid-json',
        type: 'bullet',
        properties: 'invalid-json',
        createdAt: 0,
        updatedAt: 0
      }

      const block = recordToBlock(record)
      expect(block.format).toEqual({})
      expect(block.properties).toEqual({})
    })
  })

  describe('recordToPage', () => {
    it('correctly converts valid JSON records', () => {
      const record: PageRecord = {
        id: 'p1',
        blockId: 'b1',
        title: 'Test Page',
        type: 'normal',
        icon: null,
        cover: null,
        aliases: '["alias1", "alias2"]',
        filePath: null,
        childrenCount: 0,
        wordCount: 0,
        createdAt: 0,
        updatedAt: 0
      }

      const page = recordToPage(record)
      expect(page.aliases).toEqual(['alias1', 'alias2'])
    })

    it('gracefully handles invalid aliases JSON', () => {
      const record: PageRecord = {
        id: 'p1',
        blockId: 'b1',
        title: 'Test Page',
        type: 'normal',
        icon: null,
        cover: null,
        aliases: 'invalid-json',
        filePath: null,
        childrenCount: 0,
        wordCount: 0,
        createdAt: 0,
        updatedAt: 0
      }

      const page = recordToPage(record)
      expect(page.aliases).toEqual([])
    })
  })

  describe('recordToProperty', () => {
    it('correctly converts valid JSON records', () => {
      const record: PropertyRecord = {
        id: 'prop1',
        blockId: 'b1',
        key: 'testKey',
        value: '{"nested": "value"}',
        type: 'text',
        sortOrder: 1,
        isHidden: 0,
        isDeleted: 0,
        schemaVersion: 1,
        createdAt: 0,
        updatedAt: 0
      }

      const property = recordToProperty(record)
      expect(property.value).toEqual({ nested: 'value' })
    })

    it('gracefully handles invalid value JSON', () => {
      const record: PropertyRecord = {
        id: 'prop1',
        blockId: 'b1',
        key: 'testKey',
        value: 'invalid-json',
        type: 'text',
        sortOrder: 1,
        isHidden: 0,
        isDeleted: 0,
        schemaVersion: 1,
        createdAt: 0,
        updatedAt: 0
      }

      const property = recordToProperty(record)
      expect(property.value).toEqual('')
    })
  })

  describe('blockToRecord', () => {
    it('correctly converts block to record', () => {
      const block: Block = {
        id: 'b1',
        pageId: 'p1',
        parentId: null,
        pos: 1000,
        content: 'Test content',
        format: { font: 'bold' },
        type: 'bullet',
        properties: { color: 'red' },
        createdAt: 1000,
        updatedAt: 2000
      }

      const record = blockToRecord(block)
      expect(JSON.parse(record.format)).toEqual({ font: 'bold' })
      expect(JSON.parse(record.properties)).toEqual({ color: 'red' })
      expect(record.createdAt).toBe(1000)
      expect(record.updatedAt).toBe(2000)
    })
  })

  describe('pageToRecord', () => {
    it('correctly converts page to record', () => {
      const page: Page = {
        id: 'p1',
        blockId: 'b1',
        title: 'Test Page',
        type: 'normal',
        icon: null,
        cover: null,
        aliases: ['alias1', 'alias2'],
        filePath: null,
        childrenCount: 0,
        wordCount: 0,
        createdAt: 0,
        updatedAt: 0,
        deleted: false,
        deletedAt: null
      }

      const record = pageToRecord(page)
      expect(JSON.parse(record.aliases)).toEqual(['alias1', 'alias2'])
    })
  })

  describe('propertyToRecord', () => {
    it('correctly converts property to record', () => {
      const property: Property = {
        id: 'prop1',
        blockId: 'b1',
        key: 'testKey',
        value: { nested: 'value' },
        type: 'text',
        sortOrder: 1,
        isHidden: false,
        isDeleted: false,
        schemaVersion: 1,
        createdAt: 0,
        updatedAt: 0
      }

      const record = propertyToRecord(property)
      expect(JSON.parse(record.value)).toEqual({ nested: 'value' })
      expect(record.isHidden).toBe(0)
      expect(record.isDeleted).toBe(0)
    })
  })
})
