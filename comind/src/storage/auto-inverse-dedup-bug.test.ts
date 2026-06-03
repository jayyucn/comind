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

  it('scenario: 用户在 Page1 上保存两个块都引用 Page2^(depends-on)，Page2 上不应有重复反向链接', async () => {
    const { db } = await import('./db')

    // 持久化状态：模拟 Page2 已经有反向链接
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

    // 捕获 put 和 update 调用
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

    ;(db.pages.update as any).mockImplementation((id: string, changes: any) => {
      // 模拟页面更新
      return Promise.resolve(1)
    })

    // 第一次保存：Block 1 在 Page1 上引用 [[Page2]]^(depends-on)
    const block1 = createMockBlock({ id: 'block-1', pageId: 'page-1', content: '[[Page2]]^(depends-on)' })
    await adapter.saveBlock(block1)

    console.log('After save block 1:')
    console.log('  state.page2Content =', state.page2Content)
    console.log('  state.page2BlockId =', state.page2BlockId)

    // 第二次保存：Block 2 在 Page1 上也引用 [[Page2]]^(depends-on)
    const block2 = createMockBlock({ id: 'block-2', pageId: 'page-1', content: '[[Page2]]^(depends-on)' })
    await adapter.saveBlock(block2)

    console.log('After save block 2:')
    console.log('  state.page2Content =', state.page2Content)

    // Page2 的根块内容应该只有一个反向链接，不应该有重复
    expect(state.page2Content).toBe('[[Page1]]^(required-by)')

    // 计算出现的次数，应该只有一次
    const occurrences = (state.page2Content.match(/\[\[Page1\]\]\^\(required-by\)/g) || []).length
    expect(occurrences).toBe(1)
  })
})
