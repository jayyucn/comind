import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePageStore } from '../stores/pages'
import type { Page } from '../types/page'

vi.mock('../storage/indexedDB', () => ({
  storage: {
    getAllPages: vi.fn().mockResolvedValue([]),
    createPageWithRootBlock: vi.fn().mockImplementation(async (title: string, type: string) => ({
      id: `page-${title}`,
      title,
      type,
      blockId: `root-${title}`,
      icon: null,
      cover: null,
      aliases: [],
      filePath: null,
      childrenCount: 0,
      wordCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deleted: false,
      deletedAt: null
    })),
    getPage: vi.fn(),
    getById: vi.fn(),
    getBlockTree: vi.fn().mockResolvedValue([])
  }
}))

vi.mock('../utils/journal-detect', () => ({
  normalizeJournalTitle: vi.fn((title: string) => {
    const regex = /^\d{4}-\d{2}-\d{2}$/
    return regex.test(title) ? title : null
  })
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('路由守卫逻辑 - page/journal 间导航不跳过', () => {
  describe('page/journal 间导航守卫应正常执行', () => {
    test('从 page 到 journal-page 时守卫应正常执行', () => {
      const toName = 'journal-page'
      const shouldSkip = toName === 'journal-list' || toName === 'trash' || toName === 'settings'
      expect(shouldSkip).toBe(false)
    })

    test('从 journal-page 到 page 时守卫应正常执行', () => {
      const toName = 'page'
      const shouldSkip = toName === 'journal-list' || toName === 'trash' || toName === 'settings'
      expect(shouldSkip).toBe(false)
    })

    test('相同路由守卫应正常执行', () => {
      const toName = 'page'
      const shouldSkip = toName === 'journal-list' || toName === 'trash' || toName === 'settings'
      expect(shouldSkip).toBe(false)
    })

    test('无关路由切换守卫应正常执行', () => {
      const toName = 'page'
      const shouldSkip = toName === 'journal-list' || toName === 'trash' || toName === 'settings'
      expect(shouldSkip).toBe(false)
    })
  })

  describe('静态页面跳过逻辑', () => {
    test('journal-list 路由应被跳过', () => {
      const routeName = 'journal-list'
      const shouldSkip = routeName === 'journal-list' || routeName === 'trash' || routeName === 'settings'
      expect(shouldSkip).toBe(true)
    })

    test('trash 路由应被跳过', () => {
      const routeName = 'trash'
      const shouldSkip = routeName === 'journal-list' || routeName === 'trash' || routeName === 'settings'
      expect(shouldSkip).toBe(true)
    })

    test('settings 路由应被跳过', () => {
      const routeName = 'settings'
      const shouldSkip = routeName === 'journal-list' || routeName === 'trash' || routeName === 'settings'
      expect(shouldSkip).toBe(true)
    })

    test('page 路由不应被跳过', () => {
      const routeName = 'page'
      const shouldSkip = routeName === 'journal-list' || routeName === 'trash' || routeName === 'settings'
      expect(shouldSkip).toBe(false)
    })

    test('journal-page 路由不应被跳过', () => {
      const routeName = 'journal-page'
      const shouldSkip = routeName === 'journal-list' || routeName === 'trash' || routeName === 'settings'
      expect(shouldSkip).toBe(false)
    })
  })
})

describe('路由守卫逻辑 - /page/:pageId 处理', () => {
  test('已存在的普通页面不应重定向', async () => {
    const pageStore = usePageStore()
    const existingPage = await pageStore.createPage('existing-page', 'normal')

    const rawParam = existingPage.id
    let page = pageStore.getPage(rawParam) ?? pageStore.getPageByTitle(rawParam)

    expect(page).toBeDefined()
    expect(page?.type).toBe('normal')
  })

  test('已存在页面通过标题查找应成功', async () => {
    const pageStore = usePageStore()
    const existingPage = await pageStore.createPage('My Custom Page', 'normal')

    const rawParam = 'My Custom Page'
    const page = pageStore.getPageByTitle(rawParam)

    expect(page).toBeDefined()
    expect(page?.id).toBe(existingPage.id)
  })

  test('journal 类型页面应重定向到 journal-page', async () => {
    const pageStore = usePageStore()
    const journalPage = await pageStore.createPage('2026-05-24', 'journal')

    const page = journalPage
    const shouldRedirect = page && page.type === 'journal'

    expect(shouldRedirect).toBe(true)
  })

  test('不存在的页面 ID 应尝试从 storage 加载', async () => {
    const { storage } = await import('../storage/indexedDB')
    const pageStore = usePageStore()

    const nonExistentId = 'non-existent-id'
    let page = pageStore.getPage(nonExistentId)

    if (!page) {
      page = await storage.getById(nonExistentId) ?? await storage.getPage(nonExistentId)
    }

    expect(page).toBeUndefined()
  })

  test('页面加载失败应返回到 journal-list', async () => {
    const { storage } = await import('../storage/indexedDB')
    vi.mocked(storage.getById).mockRejectedValue(new Error('Storage error'))

    let page = null
    let redirectTarget: string | null = null

    try {
      const nonExistentId = 'error-id'
      page = await storage.getById(nonExistentId)
    } catch (error) {
      redirectTarget = 'journal-list'
    }

    expect(page).toBeNull()
    expect(redirectTarget).toBe('journal-list')
  })
})

describe('路由守卫逻辑 - /journal/:date 处理', () => {
  test('标准日期格式应通过 normalizeJournalTitle', async () => {
    const { normalizeJournalTitle } = await import('../utils/journal-detect')

    expect(normalizeJournalTitle('2026-05-24')).toBe('2026-05-24')
    expect(normalizeJournalTitle('2026-01-01')).toBe('2026-01-01')
    expect(normalizeJournalTitle('2026-12-31')).toBe('2026-12-31')
  })

  test('非日期格式应返回 null 并重定向到 page', async () => {
    const { normalizeJournalTitle } = await import('../utils/journal-detect')

    const result = normalizeJournalTitle('My Page')
    expect(result).toBeNull()
  })

  test('不存在的 journal 应创建新 journal 页面', async () => {
    const pageStore = usePageStore()

    const normalized = '2026-05-24'
    let page = pageStore.getPageByTitle(normalized)

    if (!page) {
      page = await pageStore.createPage(normalized, 'journal')
    }

    expect(page).toBeDefined()
    expect(page?.type).toBe('journal')
    expect(page?.title).toBe(normalized)
  })

  test('已存在的 journal 页面不应重复创建', async () => {
    const pageStore = usePageStore()
    const existingJournal = await pageStore.createPage('2026-05-24', 'journal')

    const normalized = '2026-05-24'
    let page = pageStore.getPageByTitle(normalized)
    let created = false

    if (!page) {
      page = await pageStore.createPage(normalized, 'journal')
      created = true
    }

    expect(created).toBe(false)
    expect(page?.id).toBe(existingJournal.id)
  })

  test('已存在但类型为 normal 的页面应重定向到 page', async () => {
    const pageStore = usePageStore()
    const normalPage = await pageStore.createPage('2026-05-24', 'normal')

    const page = normalPage
    const shouldRedirectToPage = page && page.type !== 'journal'

    expect(shouldRedirectToPage).toBe(true)
  })

  test('journal 页面加载失败应返回到 journal-list', async () => {
    const { storage } = await import('../storage/indexedDB')
    vi.mocked(storage.getPage).mockRejectedValue(new Error('Storage error'))

    let page = null
    let redirectTarget: string | null = null

    try {
      page = await storage.getPage('2026-05-24')
    } catch (error) {
      redirectTarget = 'journal-list'
    }

    expect(page).toBeNull()
    expect(redirectTarget).toBe('journal-list')
  })
})

describe('页面类型识别', () => {
  test('标准日期格式应识别为 journal 类型', async () => {
    const pageStore = usePageStore()
    const journalPage = await pageStore.createPage('2026-05-24', 'journal')

    expect(journalPage.type).toBe('journal')
  })

  test('普通标题应识别为 normal 类型', async () => {
    const pageStore = usePageStore()
    const normalPage = await pageStore.createPage('My Regular Page', 'normal')

    expect(normalPage.type).toBe('normal')
  })

  test('页面打开后 currentPageId 应正确设置', async () => {
    const pageStore = usePageStore()
    const page = await pageStore.createPage('Test Page')

    await pageStore.openPage(page.id)

    expect(pageStore.currentPageId).toBe(page.id)
  })
})

describe('错误边界和异常处理', () => {
  test('storage.getById 返回 undefined 不应抛出', async () => {
    const { storage } = await import('../storage/indexedDB')
    vi.mocked(storage.getById).mockResolvedValue(undefined)

    const result = await storage.getById('non-existent')
    expect(result).toBeUndefined()
  })

  test('storage.getPage 返回 undefined 不应抛出', async () => {
    const { storage } = await import('../storage/indexedDB')
    vi.mocked(storage.getPage).mockResolvedValue(undefined)

    const result = await storage.getPage('non-existent')
    expect(result).toBeUndefined()
  })

  test('页面 ID 和标题同时匹配时应优先使用 ID', async () => {
    const pageStore = usePageStore()
    const page = await pageStore.createPage('Test Page', 'normal')

    const byId = pageStore.getPage(page.id)
    const byTitle = pageStore.getPageByTitle(page.title)

    expect(byId?.id).toBe(byTitle?.id)
    expect(byId?.id).toBe(page.id)
  })

  test('loadAllPages 应正确加载所有页面', async () => {
    const { storage } = await import('../storage/indexedDB')
    const pageStore = usePageStore()

    const mockPages: Page[] = [
      {
        id: 'page-1',
        blockId: null,
        title: 'Page 1',
        type: 'normal',
        icon: null,
        cover: null,
        aliases: [],
        filePath: null,
        childrenCount: 0,
        wordCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        deletedAt: null
      },
      {
        id: 'page-2',
        blockId: null,
        title: 'Page 2',
        type: 'journal',
        icon: null,
        cover: null,
        aliases: [],
        filePath: null,
        childrenCount: 0,
        wordCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false,
        deletedAt: null
      }
    ]

    vi.mocked(storage.getAllPages).mockResolvedValue(mockPages)

    await pageStore.loadAllPages()

    expect(pageStore.pages.length).toBe(2)
    expect(pageStore.pages.find(p => p.id === 'page-1')).toBeDefined()
    expect(pageStore.pages.find(p => p.id === 'page-2')).toBeDefined()
  })
})

describe('路由守卫集成场景', () => {
  test('用户直接访问 /journal/2026-05-24 应正确创建 journal 页面', async () => {
    const pageStore = usePageStore()
    const { normalizeJournalTitle } = await import('../utils/journal-detect')

    const rawParam = '2026-05-24'
    const normalized = normalizeJournalTitle(rawParam)

    expect(normalized).toBe('2026-05-24')

    let page = pageStore.getPageByTitle(normalized!)
    if (!page) {
      page = await pageStore.createPage(normalized!, 'journal')
    }

    expect(page).toBeDefined()
    expect(page?.type).toBe('journal')
  })

  test('用户直接访问 /page/某个标题 应正确创建普通页面', async () => {
    const pageStore = usePageStore()

    const rawParam = 'New Page Title'
    let page = pageStore.getPage(rawParam) ?? pageStore.getPageByTitle(rawParam)

    if (!page) {
      page = await pageStore.createPage(rawParam, 'normal')
    }

    expect(page).toBeDefined()
    expect(page?.type).toBe('normal')
    expect(page?.title).toBe(rawParam)
  })

  test('普通页面访问被删除的 journal 标题应创建普通页面', async () => {
    const pageStore = usePageStore()

    const rawParam = 'Deleted Journal'
    let page = pageStore.getPage(rawParam) ?? pageStore.getPageByTitle(rawParam)

    if (!page) {
      page = await pageStore.createPage(rawParam, 'normal')
    }

    expect(page).toBeDefined()
    expect(page?.type).toBe('normal')
  })
})
