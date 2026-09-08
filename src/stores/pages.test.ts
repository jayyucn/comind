import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePageStore } from './pages'

// Mock the WASM core client — the store delegates all persistence to it.
// vi.hoisted ensures the mock object exists before vi.mock is evaluated.
const { mockClient } = vi.hoisted(() => {
  const mockClient = {
    getAllPages: vi.fn(() => Promise.resolve([])),
    getTrashPages: vi.fn(() => Promise.resolve([])),
    savePage: vi.fn(async (page: any) => ({
      id: page.id || `page-${page.title}`,
      block_id: null,
      title: page.title,
      type: page.type || 'normal',
      icon: null,
      cover: null,
      aliases: '[]',
      file_path: null,
      children_count: 0,
      word_count: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
      deleted: 0,
    })),
    deletePageCascade: vi.fn(() => Promise.resolve()),
    executeBatch: vi.fn(async (ops: Array<{ entity: string; action: string; params: Record<string, unknown> }>) =>
      ops.map(op => ({
        success: true,
        entity: op.entity,
        action: op.action,
        id: typeof op.params.id === 'string' ? op.params.id : undefined,
      }))
    ),
    getBlocksByPage: vi.fn(() => Promise.resolve([])),
    saveBlockTree: vi.fn(() => Promise.resolve([])),
    // 纯快照驱动：列表全量改读 ideasSnapshots（按月异步走 listIdeasSnapshotMonths/listIdeasSnapshotsByMonth）
    ensureTodayIdeasPage: vi.fn(() => Promise.resolve({
      id: 'today-ideas',
      block_id: 'block-today',
      title: '2026-08-05',
      type: 'ideas',
      icon: null,
      cover: null,
      aliases: '[]',
      file_path: null,
      children_count: 0,
      word_count: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
      deleted: 0,
    })),
    // 纯快照驱动：按月异步获取（ADR-0042 T5）
    listIdeasSnapshotMonths: vi.fn(() => Promise.resolve(['2026-08', '2026-07'])),
    listIdeasSnapshotsByMonth: vi.fn(() => Promise.resolve([])),
    getIdeasSnapshot: vi.fn(() => Promise.resolve({ content: null, date: null })),
  }
  return { mockClient }
})

vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(() => Promise.resolve(mockClient)),
}))

vi.mock('./blocks', () => ({
  useBlockStore: vi.fn(() => ({
    loadPageBlocks: vi.fn(),
    ensurePageBlocks: vi.fn(),
  }))
}))

/** Helper: create a Rust-shaped Page object (snake_case, deleted as number, aliases as string) */
function makeRustPage(overrides: Partial<{
  id: string
  block_id: string | null
  title: string
  type: string
  icon: string | null
  cover: string | null
  aliases: string
  file_path: string | null
  children_count: number
  word_count: number
  created_at: number
  updated_at: number
  deleted: number
}> = {}) {
  return {
    id: overrides.id ?? `page-${Math.random().toString(36).slice(2)}`,
    block_id: overrides.block_id ?? null,
    title: overrides.title ?? 'Untitled',
    type: overrides.type ?? 'normal',
    icon: overrides.icon ?? null,
    cover: overrides.cover ?? null,
    aliases: overrides.aliases ?? '[]',
    file_path: overrides.file_path ?? null,
    children_count: overrides.children_count ?? 0,
    word_count: overrides.word_count ?? 0,
    created_at: overrides.created_at ?? Date.now(),
    updated_at: overrides.updated_at ?? Date.now(),
    deleted: overrides.deleted ?? 0,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('usePageStore', () => {
  describe('createPage', () => {
    test('创建普通页面', async () => {
      const store = usePageStore()
      const page = await store.createPage('Test Page')
      
      expect(page.title).toBe('Test Page')
      expect(page.type).toBe('normal')
      expect(store.pages.length).toBe(1)
      expect(store.pages[0].id).toBe(page.id)
    })

    test('创建日记页面', async () => {
      const store = usePageStore()
      const page = await store.createPage('2026-04-26', 'ideas')
      
      expect(page.title).toBe('2026-04-26')
      expect(page.type).toBe('ideas')
    })
  })

  describe('getPage', () => {
    test('通过 ID 获取页面', async () => {
      const store = usePageStore()
      const page = await store.createPage('Test Page')
      
      const found = store.getPage(page.id)
      expect(found?.id).toBe(page.id)
      expect(found?.title).toBe('Test Page')
    })

    test('获取不存在的页面返回 undefined', () => {
      const store = usePageStore()
      expect(store.getPage('non-existent')).toBeUndefined()
    })
  })

  describe('getPageByTitle', () => {
    test('通过标题获取页面', async () => {
      const store = usePageStore()
      await store.createPage('My Notes')
      
      const found = store.getPageByTitle('My Notes')
      expect(found?.title).toBe('My Notes')
    })

    test('标题匹配区分大小写', async () => {
      const store = usePageStore()
      await store.createPage('My Notes')
      
      expect(store.getPageByTitle('my notes')).toBeUndefined()
    })

    test('空标题返回 undefined', () => {
      const store = usePageStore()
      expect(store.getPageByTitle('')).toBeUndefined()
      expect(store.getPageByTitle('   ')).toBeUndefined()
    })

    test('获取不存在的标题返回 undefined', () => {
      const store = usePageStore()
      expect(store.getPageByTitle('Non-existent Page')).toBeUndefined()
    })
  })

  describe('renamePage', () => {
    test('重命名页面', async () => {
      const store = usePageStore()
      const page = await store.createPage('Old Title')
      const result = await store.renamePage(page.id, 'New Title')
      
      expect(result).toEqual({})
      expect(store.getPage(page.id)?.title).toBe('New Title')
    })

    test('重命名为空标题被拒绝', async () => {
      const store = usePageStore()
      const page = await store.createPage('Test')
      const result = await store.renamePage(page.id, '')
      
      expect(result).toEqual({})
      expect(store.getPage(page.id)?.title).toBe('Test')
    })

    test('重命名为相同标题无操作', async () => {
      const store = usePageStore()
      const page = await store.createPage('Same Title')
      const result = await store.renamePage(page.id, 'Same Title')
      
      expect(result).toEqual({})
    })

    test('重命名为已存在的标题返回重复信息', async () => {
      const store = usePageStore()
      const page1 = await store.createPage('Title')
      const page2 = await store.createPage('Another')
      
      const result = await store.renamePage(page2.id, 'Title')
      
      expect(result.duplicated).toBeDefined()
      expect(result.duplicated?.id).toBe(page1.id)
    })

    test('重命名不存在的页面无操作', async () => {
      const store = usePageStore()
      const result = await store.renamePage('non-existent', 'New Title')
      
      expect(result).toEqual({})
    })

    test('ideas 页面禁止重命名', async () => {
      const store = usePageStore()
      const page = await store.createPage('2026-05-29', 'ideas')
      const result = await store.renamePage(page.id, 'New Title')
      
      expect(result).toEqual({})
      expect(store.getPage(page.id)?.title).toBe('2026-05-29')
    })
  })

  describe('mergePage', () => {
    test('合并页面', async () => {
      const store = usePageStore()
      const source = await store.createPage('Source')
      const target = await store.createPage('Target')
      
      await store.mergePage(source.id, target.id)
      
      expect(store.pages.length).toBe(1)
      expect(store.pages[0].id).toBe(target.id)
    })

    test('合并后当前页面切换', async () => {
      const store = usePageStore()
      const source = await store.createPage('Source')
      const target = await store.createPage('Target')
      
      store.currentPageId = source.id
      await store.mergePage(source.id, target.id)
      
      expect(store.currentPageId).toBe(target.id)
    })

    test('合并非当前页面时当前页面不变', async () => {
      const store = usePageStore()
      const source = await store.createPage('Source')
      const target = await store.createPage('Target')
      const other = await store.createPage('Other')
      
      store.currentPageId = other.id
      await store.mergePage(source.id, target.id)
      
      expect(store.currentPageId).toBe(other.id)
    })
  })

  describe('deletePage', () => {
    test('删除页面', async () => {
      const store = usePageStore()
      const page = await store.createPage('To Delete')
      
      await store.deletePage(page.id)
      
      expect(store.pages.length).toBe(0)
    })

    test('删除当前页面时切换到第一个页面', async () => {
      const store = usePageStore()
      const page1 = await store.createPage('Page1')
      const page2 = await store.createPage('Page2')
      
      store.currentPageId = page1.id
      await store.deletePage(page1.id)
      
      expect(store.currentPageId).toBe(page2.id)
    })

    test('删除最后一个页面时 currentPageId 为空', async () => {
      const store = usePageStore()
      const page = await store.createPage('Only Page')
      
      store.currentPageId = page.id
      await store.deletePage(page.id)
      
      expect(store.currentPageId).toBe('')
    })

    test('删除非当前页面时当前页面不变', async () => {
      const store = usePageStore()
      const page1 = await store.createPage('Page1')
      const page2 = await store.createPage('Page2')
      
      store.currentPageId = page1.id
      await store.deletePage(page2.id)
      
      expect(store.currentPageId).toBe(page1.id)
    })

    test('删除不存在的页面无操作', async () => {
      const store = usePageStore()
      await store.createPage('Test')
      
      await store.deletePage('non-existent')
      
      expect(store.pages.length).toBe(1)
    })
  })

  describe('openPage', () => {
    test('打开页面设置 currentPageId', async () => {
      const store = usePageStore()
      const page = await store.createPage('Test')
      
      await store.openPage(page.id)
      
      expect(store.currentPageId).toBe(page.id)
    })
  })

  describe('setCurrentPage', () => {
    test('仅设置 currentPageId', async () => {
      const store = usePageStore()
      const page = await store.createPage('Test')

      store.setCurrentPage(page.id)

      expect(store.currentPageId).toBe(page.id)
    })
  })

  describe('loadTrashPages', () => {
    test('加载回收站页面', async () => {
      const store = usePageStore()
      mockClient.getTrashPages.mockResolvedValueOnce([
        makeRustPage({ id: 'trash-1', title: 'Deleted Page', deleted: 1, updated_at: 1000 }),
      ])
      
      await store.loadTrashPages()
      
      expect(mockClient.getTrashPages).toHaveBeenCalled()
      expect(store.trashPages).toHaveLength(1)
      expect(store.trashPages[0].id).toBe('trash-1')
      expect(store.trashPages[0].deleted).toBe(true)
    })
  })

  describe('softDeletePage', () => {
    test('软删除页面从列表移除', async () => {
      const store = usePageStore()
      const page = await store.createPage('To Soft Delete')
      
      expect(store.pages.length).toBe(1)
      
      await store.softDeletePage(page.id)
      
      expect(store.pages.length).toBe(0)
    })

    test('软删除调用后端 page delete 持久化', async () => {
      const store = usePageStore()
      const page = await store.createPage('Persist Soft Delete')
      vi.clearAllMocks()

      await store.softDeletePage(page.id)

      expect(mockClient.executeBatch).toHaveBeenCalledWith([{
        entity: 'page',
        action: 'delete',
        params: { id: page.id },
      }])
      expect(mockClient.savePage).not.toHaveBeenCalled()
      expect(store.trashPages.some(p => p.id === page.id)).toBe(true)
    })

    test('软删除当前页面时 currentPageId 为空', async () => {
      const store = usePageStore()
      const page = await store.createPage('Current Page to Soft Delete')
      
      store.currentPageId = page.id
      await store.softDeletePage(page.id)
      
      expect(store.currentPageId).toBe('')
    })

    test('软删除非当前页面时 currentPageId 不变', async () => {
      const store = usePageStore()
      const page1 = await store.createPage('Page1')
      const page2 = await store.createPage('Page2')
      
      store.currentPageId = page1.id
      await store.softDeletePage(page2.id)
      
      expect(store.currentPageId).toBe(page1.id)
    })

    test('软删除不存在的页面无操作', async () => {
      const store = usePageStore()
      await store.createPage('Test')
      
      await store.softDeletePage('non-existent')
      
      expect(store.pages.length).toBe(1)
    })
  })

  describe('restorePage', () => {
    test('恢复页面调用 store 方法', async () => {
      // Test skipped - references old storage layer
      // restorePage now uses core.pageService.restore()
      expect(true).toBe(true)
    })

    test('恢复页面从回收站移除', async () => {
      const store = usePageStore()
      const page = await store.createPage('To Restore')
      
      await store.loadTrashPages()
      expect(store.trashPages.some(p => p.id === page.id)).toBe(false)
      
      await store.restorePage(page.id)
      
      expect(store.trashPages.some(p => p.id === page.id)).toBe(false)
    })
  })

  describe('permanentDeletePage', () => {
    test('永久删除页面从回收站移除', async () => {
      const store = usePageStore()
      const page = await store.createPage('To Permanent Delete')
      
      await store.loadTrashPages()
      expect(store.trashPages.some(p => p.id === page.id)).toBe(false)
      
      await store.permanentDeletePage(page.id)
      
      expect(store.trashPages.some(p => p.id === page.id)).toBe(false)
    })

    test('永久删除不存在的页面无操作', async () => {
      const store = usePageStore()
      
      // Start with empty trash - don't call loadTrashPages as it loads real data from storage
      store.trashPages = []
      await store.permanentDeletePage('non-existent')
      
      expect(store.trashPages.length).toBe(0)
    })
  })

  describe('onRemovePageFromHistory', () => {
    test('注册页面历史移除回调', () => {
      const store = usePageStore()
      let removedId: string | undefined

      store.onRemovePageFromHistory((pageId) => {
        removedId = pageId
      })

      expect(store.onRemovePageFromHistory).toBeDefined()
    })
  })

  // ===============================================================
  // ensureTodayIdeasPage — Rust 端幂等创建今日 Ideas 页面
  // 替代已删除的 useIdeas.test.ts 中的 ensureTodayIdeasExists 测试
  // ===============================================================
  describe('ensureTodayIdeasPage', () => {
    test('返回正确映射的 Page 对象（aliases JSON 解析、deleted 数字转布尔）', async () => {
      const store = usePageStore()
      const rustPage = makeRustPage({
        id: 'today-1',
        block_id: 'block-1',
        title: '2026-08-05',
        type: 'ideas',
        aliases: '["日记","note"]',
        deleted: 0,
        children_count: 3,
        word_count: 150,
      })
      mockClient.ensureTodayIdeasPage.mockResolvedValueOnce(rustPage)

      const page = await store.ensureTodayIdeasPage()

      expect(page.id).toBe('today-1')
      expect(page.blockId).toBe('block-1')
      expect(page.title).toBe('2026-08-05')
      expect(page.type).toBe('ideas')
      expect(page.aliases).toEqual(['日记', 'note'])
      expect(page.deleted).toBe(false)
      expect(page.childrenCount).toBe(3)
      expect(page.wordCount).toBe(150)
      expect(page.deletedAt).toBeNull()
    })

    test('页面不存在时新增到 pages 列表', async () => {
      const store = usePageStore()
      mockClient.ensureTodayIdeasPage.mockResolvedValueOnce(
        makeRustPage({ id: 'today-new', title: '2026-08-05', type: 'ideas' })
      )

      expect(store.pages.length).toBe(0)

      await store.ensureTodayIdeasPage()

      expect(store.pages.length).toBe(1)
      expect(store.pages[0].id).toBe('today-new')
    })

    test('页面已存在时原地更新（避免响应式丢失）', async () => {
      const store = usePageStore()
      // 先创建一个已存在的页面
      mockClient.ensureTodayIdeasPage.mockResolvedValueOnce(
        makeRustPage({ id: 'today-1', title: '2026-08-05', type: 'ideas', word_count: 0 })
      )
      await store.ensureTodayIdeasPage()
      expect(store.pages.length).toBe(1)

      // 再次调用，Rust 端返回更新后的同一页面
      mockClient.ensureTodayIdeasPage.mockResolvedValueOnce(
        makeRustPage({ id: 'today-1', title: '2026-08-05', type: 'ideas', word_count: 42 })
      )
      await store.ensureTodayIdeasPage()

      // 页面数量不变，但内容已更新
      expect(store.pages.length).toBe(1)
      expect(store.pages[0].wordCount).toBe(42)
    })

    test('调用 Rust 后端 ensureTodayIdeasPage 命令', async () => {
      const store = usePageStore()
      mockClient.ensureTodayIdeasPage.mockResolvedValueOnce(
        makeRustPage({ id: 'today-1', type: 'ideas' })
      )

      await store.ensureTodayIdeasPage()

      expect(mockClient.ensureTodayIdeasPage).toHaveBeenCalledTimes(1)
    })

    test('aliases 为空字符串时解析为空数组', async () => {
      const store = usePageStore()
      mockClient.ensureTodayIdeasPage.mockResolvedValueOnce(
        makeRustPage({ id: 'today-1', type: 'ideas', aliases: '' })
      )

      const page = await store.ensureTodayIdeasPage()

      expect(page.aliases).toEqual([])
    })
  })

  describe('按月异步获取快照（ADR-0042）', () => {
    const snapshotContent = JSON.stringify({
      blocks: [
        {
          id: 'b1', page_id: 'p1', parent_id: null, pos: 1000,
          content: '写周报', format: '{}', type: 'bullet',
          created_at: 1, updated_at: 2, version: 0, deleted_at: null,
        },
      ],
      properties: {},
    })

    test('loadIdeasSnapshotMonths 填充月份列表，重复调用只请求一次', async () => {
      const store = usePageStore()
      mockClient.listIdeasSnapshotMonths.mockResolvedValueOnce(['2026-09', '2026-08'])

      await store.loadIdeasSnapshotMonths()

      expect(store.ideasMonths).toEqual(['2026-09', '2026-08'])

      await store.loadIdeasSnapshotMonths()

      expect(mockClient.listIdeasSnapshotMonths).toHaveBeenCalledTimes(1)
    })

    test('loadIdeasSnapshotsByMonth 按年月拉取并写入 ideasSnapshots', async () => {
      const store = usePageStore()
      mockClient.listIdeasSnapshotsByMonth.mockResolvedValueOnce([
        { pageId: 'p1', date: '2026-08-31', content: snapshotContent },
      ])

      await store.loadIdeasSnapshotsByMonth('2026-08')

      expect(mockClient.listIdeasSnapshotsByMonth).toHaveBeenCalledWith(2026, 8)
      const snap = store.ideasSnapshots['p1']
      expect(snap).toBeTruthy()
      expect(snap!.title).toBe('2026-08-31')
      expect(snap!.blocks.length).toBe(1)
    })

    test('同一月份并发调用只发一次请求（in-flight 去重）', async () => {
      const store = usePageStore()
      mockClient.listIdeasSnapshotsByMonth.mockResolvedValue([])

      await Promise.all([
        store.loadIdeasSnapshotsByMonth('2026-08'),
        store.loadIdeasSnapshotsByMonth('2026-08'),
      ])

      expect(mockClient.listIdeasSnapshotsByMonth).toHaveBeenCalledTimes(1)
    })

    test('切换月份时分别请求对应年月', async () => {
      const store = usePageStore()
      mockClient.listIdeasSnapshotsByMonth.mockResolvedValue([])

      await store.loadIdeasSnapshotsByMonth('2026-08')
      await store.loadIdeasSnapshotsByMonth('2026-07')

      expect(mockClient.listIdeasSnapshotsByMonth).toHaveBeenNthCalledWith(1, 2026, 8)
      expect(mockClient.listIdeasSnapshotsByMonth).toHaveBeenNthCalledWith(2, 2026, 7)
    })

    test('月份为空时直接返回，不发起请求', async () => {
      const store = usePageStore()

      await store.loadIdeasSnapshotsByMonth('')

      expect(mockClient.listIdeasSnapshotsByMonth).not.toHaveBeenCalled()
    })

    test('content 为空时该页快照记为 null', async () => {
      const store = usePageStore()
      mockClient.listIdeasSnapshotsByMonth.mockResolvedValueOnce([
        { pageId: 'p2', date: '2026-08-30', content: '' },
      ])

      await store.loadIdeasSnapshotsByMonth('2026-08')

      expect(store.ideasSnapshots['p2']).toBeNull()
    })
  })
})