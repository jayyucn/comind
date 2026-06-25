import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IndexedDBAdapter } from './indexedDB'
import type { Block, Page } from '../types'

vi.mock('./db', () => ({
  db: {
    blocks: {
      put: vi.fn().mockResolvedValue('mock-uuid'),
      delete: vi.fn(),
      get: vi.fn(),
      update: vi.fn().mockResolvedValue(1),
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
      update: vi.fn(),
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
      add: vi.fn().mockResolvedValue('mock-uuid'),
      delete: vi.fn(),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          delete: vi.fn(),
          toArray: vi.fn().mockResolvedValue([])
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
    transaction: vi.fn((...args: any[]) => {
      const callback = args[args.length - 1]
      return typeof callback === 'function' ? callback() : undefined
    })
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

function createMockPage(overrides: Partial<Page> = {}): Page {
  return {
    id: 'page-1',
    title: 'Page1',
    type: 'normal',
    blockId: null,
    icon: null,
    cover: null,
    aliases: '[]',
    filePath: null,
    childrenCount: 0,
    wordCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
    deleted: 0,
    deletedAt: null,
    ...overrides
  }
}

describe('auto-inverse dedup bug', () => {
  let adapter: IndexedDBAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new IndexedDBAdapter()
  })

  it('scenario: 用户在 Page1 上保存两个块都引用 ((depends-on<->required-by))[[Page2]]，Page2 上不应有重复反向链接', async () => {
    const { db } = await import('./db')

    const state = {
      page2RootBlockId: 'page2-root',
      page2Blocks: [] as Array<{ id: string; pageId: string; parentId: string | null; pos: number; content: string; format: string; type: string; properties: string; createdAt: number; updatedAt: number }>
    }

    ;(db.pages.get as any).mockImplementation((id: string) => {
      if (id === 'page-1') {
        return Promise.resolve(createMockPage({ id: 'page-1', title: 'Page1', blockId: null }))
      }
      if (id === 'page-2') {
        return Promise.resolve(createMockPage({ id: 'page-2', title: 'Page2', blockId: state.page2RootBlockId }))
      }
      return Promise.resolve(undefined)
    })

    ;(db.pages.where('title').equals as any).mockImplementation((title: string) => ({
      first: vi.fn().mockImplementation(() => {
        if (title === 'Page2') {
          return Promise.resolve(createMockPage({ id: 'page-2', title: 'Page2' }))
        }
        if (title === 'Page1') {
          return Promise.resolve(createMockPage({ id: 'page-1', title: 'Page1' }))
        }
        return Promise.resolve(undefined)
      })
    }))

    ;(db.blocks.get as any).mockImplementation((id: string) => {
      const found = state.page2Blocks.find(b => b.id === id)
      if (found) {
        return Promise.resolve(found)
      }
      return Promise.resolve(undefined)
    })

    ;(db.blocks.where as any).mockImplementation((field: string) => ({
      equals: vi.fn().mockImplementation((value: string) => ({
        toArray: vi.fn().mockImplementation(() => {
          if (field === 'pageId' && value === 'page-2') {
            return Promise.resolve(state.page2Blocks)
          }
          return Promise.resolve([])
        }),
        first: vi.fn()
      }))
    }))

    ;(db.blocks.put as any).mockImplementation((record: any) => {
      if (record.pageId === 'page-2') {
        const existingIndex = state.page2Blocks.findIndex(b => b.id === record.id)
        if (existingIndex !== -1) {
          state.page2Blocks[existingIndex] = record
        } else {
          state.page2Blocks.push(record)
        }
      }
      return Promise.resolve(record.id)
    })

    ;(db.blocks.update as any).mockImplementation((id: string, changes: any) => {
      const index = state.page2Blocks.findIndex(b => b.id === id)
      if (index !== -1) {
        state.page2Blocks[index] = { ...state.page2Blocks[index], ...changes }
      }
      return Promise.resolve(1)
    })

    ;(db.pages.update as any).mockImplementation((id: string, changes: any) => {
      return Promise.resolve(1)
    })

    const block1 = createMockBlock({ id: 'block-1', pageId: 'page-1', content: '((depends-on<->required-by))[[Page2]]' })
    await adapter.saveBlock(block1)

    const block2 = createMockBlock({ id: 'block-2', pageId: 'page-1', content: '((depends-on<->required-by))[[Page2]]' })
    await adapter.saveBlock(block2)

    expect(state.page2Blocks.length).toBe(1)
    expect(state.page2Blocks[0].content).toBe('((required-by))[[Page1]]')
  })
})
