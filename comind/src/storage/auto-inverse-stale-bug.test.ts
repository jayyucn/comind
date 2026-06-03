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

describe('auto-inverse stale entry bug', () => {
  let adapter: IndexedDBAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new IndexedDBAdapter()
  })

  it('scenario: 切换关系类型后，旧的反向链接应被替换/移除', async () => {
    const { db } = await import('./db')

    // 持久化状态
    const state = {
      page2BlockId: null as string | null,
      page2Content: '' as string
    }

    ;(db.pages.get as any).mockImplementation((id: string) => {
      if (id === 'page-1') {
        return Promise.resolve(createMockPage({ id: 'page-1', title: 'Page1', blockId: null }))
      }
      if (id === 'page-2') {
        return Promise.resolve(createMockPage({ id: 'page-2', title: 'Page2', blockId: state.page2BlockId }))
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
      if (id === state.page2BlockId) {
        return Promise.resolve({
          id: state.page2BlockId,
          pageId: 'page-2',
          parentId: null,
          pos: 1000,
          content: state.page2Content,
          format: '{}',
          type: 'bullet',
          properties: '{}',
          createdAt: 1000,
          updatedAt: 1000
        })
      }
      return Promise.resolve(undefined)
    })

    ;(db.blocks.put as any).mockImplementation((record: any) => {
      if (record.pageId === 'page-2') {
        state.page2BlockId = record.id
        state.page2Content = record.content
      }
      return Promise.resolve(record.id)
    })

    ;(db.blocks.update as any).mockImplementation((id: string, changes: any) => {
      if (id === state.page2BlockId) {
        state.page2Content = changes.content
      }
      return Promise.resolve(1)
    })

    // 第一次保存: [[Page2]]^(depends-on) → 反向链接 [[Page1]]^(required-by)
    const block1 = createMockBlock({ id: 'block-1', pageId: 'page-1', content: '[[Page2]]^(depends-on)' })
    await adapter.saveBlock(block1)
    console.log('After first save:', state.page2Content)

    // 第二次保存: 改变为 [[Page2]]^(related) → 反向链接 [[Page1]]^(related)
    const block2 = createMockBlock({ id: 'block-1', pageId: 'page-1', content: '[[Page2]]^(related)' })
    await adapter.saveBlock(block2)
    console.log('After change to related:', state.page2Content)

    // 期望：旧的反向链接 [[Page1]]^(required-by) 应该被替换为 [[Page1]]^(related)
    // 而不是累积成两行
    expect(state.page2Content).not.toContain('[[Page1]]^(required-by)')
    expect(state.page2Content).toContain('[[Page1]]^(related)')
  })
})
