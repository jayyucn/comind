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
    transaction: vi.fn((...args: unknown[]) => {
      const callback = args[args.length - 1]
      return typeof callback === 'function' ? (callback as () => unknown)() : undefined
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

describe('auto-inverse new block (no root block pollution)', () => {
  let adapter: IndexedDBAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new IndexedDBAdapter()
  })

  it('C 已有 block ((required-by))[[B]], A 添加 ((depends-on<->required-by))[[C]] 后应为 A 新建 block, 不修改 C 现有 block', async () => {
    const { db } = await import('./db')

    interface BlockSnapshot {
      id: string
      pageId: string
      parentId: string | null
      pos: number
      content: string
      format: string
      type: string
      properties: string
      createdAt: number
      updatedAt: number
    }
    const state = {
      cRootBlockId: 'c-root-block',
      existingCBlock: {
        id: 'c-existing-block',
        pageId: 'page-c',
        parentId: 'c-root-block',
        pos: 1000,
        content: '((required-by))[[B]]',
        format: '{}',
        type: 'bullet',
        properties: '{}',
        createdAt: 1000,
        updatedAt: 1000
      } as BlockSnapshot,
      autoCreatedBlocks: [] as BlockSnapshot[]
    }

    ;(db.pages.get as unknown as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
      if (id === 'page-a') {
        return Promise.resolve(createMockPage({ id: 'page-a', title: 'First', blockId: null }))
      }
      if (id === 'page-c') {
        return Promise.resolve(createMockPage({ id: 'page-c', title: 'C', blockId: state.cRootBlockId }))
      }
      if (id === 'page-b') {
        return Promise.resolve(createMockPage({ id: 'page-b', title: 'B', blockId: null }))
      }
      return Promise.resolve(undefined)
    })

    ;(db.pages.where('title').equals as unknown as ReturnType<typeof vi.fn>).mockImplementation((title: string) => ({
      first: vi.fn().mockImplementation(() => {
        if (title === 'C') return Promise.resolve(createMockPage({ id: 'page-c', title: 'C' }))
        if (title === 'First') return Promise.resolve(createMockPage({ id: 'page-a', title: 'First' }))
        if (title === 'B') return Promise.resolve(createMockPage({ id: 'page-b', title: 'B' }))
        return Promise.resolve(undefined)
      })
    }))

    ;(db.blocks.get as unknown as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
      if (id === state.existingCBlock.id) {
        return Promise.resolve(state.existingCBlock)
      }
      const found = state.autoCreatedBlocks.find(b => b.id === id)
      return Promise.resolve(found)
    })

    ;(db.blocks.where as unknown as ReturnType<typeof vi.fn>).mockImplementation((field: string) => ({
      equals: vi.fn().mockImplementation((value: string) => ({
        toArray: vi.fn().mockImplementation(() => {
          if (field === 'pageId' && value === 'page-c') {
            return Promise.resolve([state.existingCBlock, ...state.autoCreatedBlocks.filter(b => b.pageId === 'page-c')])
          }
          return Promise.resolve([])
        })
      }))
    }))

    ;(db.blocks.put as unknown as ReturnType<typeof vi.fn>).mockImplementation((record: { id: string; pageId: string }) => {
      if (record.pageId === 'page-c') {
        state.autoCreatedBlocks.push(record as BlockSnapshot)
      }
      return Promise.resolve(record.id)
    })

    ;(db.blocks.update as unknown as ReturnType<typeof vi.fn>).mockImplementation((id: string, changes: { content?: string; updatedAt?: number }) => {
      if (id === state.existingCBlock.id) {
        state.existingCBlock = { ...state.existingCBlock, ...changes }
      }
      return Promise.resolve(1)
    })

    const blockOnA = createMockBlock({ id: 'block-a', pageId: 'page-a', content: '((depends-on<->required-by))[[C]]' })
    await adapter.saveBlock(blockOnA)

    expect(state.existingCBlock.content).toBe('((required-by))[[B]]')

    const newBlockForA = state.autoCreatedBlocks.find(b => b.pageId === 'page-c')
    expect(newBlockForA).toBeDefined()
    expect(newBlockForA!.content).toBe('((required-by))[[First]]')
  })
})
