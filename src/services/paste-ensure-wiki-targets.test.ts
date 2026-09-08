import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock WASM client（ensure 走页面层 get-or-create → client.savePage）
const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    getAllPages: vi.fn(() => Promise.resolve([])),
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
    executeBatch: vi.fn(() => Promise.resolve([])),
    getBlocksByPage: vi.fn(() => Promise.resolve([])),
    saveBlockTree: vi.fn(() => Promise.resolve([])),
    ensureTodayIdeasPage: vi.fn(),
    listIdeasSnapshotMonths: vi.fn(() => Promise.resolve([])),
    listIdeasSnapshotsByMonth: vi.fn(() => Promise.resolve([])),
    getIdeasSnapshot: vi.fn(() => Promise.resolve({ content: null, date: null })),
  },
}))

vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(() => Promise.resolve(mockClient)),
}))

vi.mock('./blocks', () => ({
  useBlockStore: vi.fn(() => ({
    loadPageBlocks: vi.fn(),
    ensurePageBlocks: vi.fn(),
  })),
}))

import { ensureWikiLinkTargets, notifyCreatedPages } from './paste-ensure-wiki-targets'
import { usePageStore } from '../stores/pages'

function rustPage(title: string) {
  return {
    id: `page-${title}`,
    block_id: null,
    title,
    type: 'normal',
    icon: null,
    cover: null,
    aliases: '[]',
    file_path: null,
    children_count: 0,
    word_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
    deleted: 0,
  }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mockClient.getAllPages.mockResolvedValue([])
})

describe('ensureWikiLinkTargets（ADR-0043）', () => {
  test('文本含一个/多个不存在的 [[目标]] → 逐个新建并返回 created', async () => {
    const store = usePageStore()
    const result = await ensureWikiLinkTargets({ plain: '见 [[产品评审]] 与 [[复盘模板]]' })

    expect(result.created).toEqual(['产品评审', '复盘模板'])
    expect(mockClient.savePage).toHaveBeenCalledTimes(2)
    expect(mockClient.savePage).toHaveBeenCalledWith(expect.objectContaining({ title: '产品评审', type: 'normal' }))
    expect(mockClient.savePage).toHaveBeenCalledWith(expect.objectContaining({ title: '复盘模板' }))
    expect(store.pages.map(p => p.title)).toEqual(['产品评审', '复盘模板'])
  })

  test('目标已存在 → 不重复建、created 为空', async () => {
    mockClient.getAllPages.mockResolvedValue([rustPage('已存在页')])
    const store = usePageStore()
    await store.loadAllPages()

    const result = await ensureWikiLinkTargets({ plain: '引用 [[已存在页]]' })

    expect(result.created).toEqual([])
    expect(mockClient.savePage).not.toHaveBeenCalled()
  })

  test('[[a|b]] 别名语法 → 按前段 a 建页', async () => {
    const result = await ensureWikiLinkTargets({ plain: '看 [[产品|产品评审记录]]' })

    expect(result.created).toEqual(['产品'])
    expect(mockClient.savePage).toHaveBeenCalledTimes(1)
    expect(mockClient.savePage).toHaveBeenCalledWith(expect.objectContaining({ title: '产品' }))
  })

  test('[[ 带空白标题 ]] → trim 后建页', async () => {
    const result = await ensureWikiLinkTargets({ plain: '[[  复盘模板  ]]' })

    expect(result.created).toEqual(['复盘模板'])
    expect(mockClient.savePage).toHaveBeenCalledWith(expect.objectContaining({ title: '复盘模板' }))
  })

  test('[[]] / 纯空白目标 / 外部链接 → 跳过、不建页', async () => {
    const result = await ensureWikiLinkTargets({
      plain: '空 [[]]、空白 [[   ]]、外链 [[https://example.com]]、mailto [[mailto:a@b.c]]',
    })

    expect(result.created).toEqual([])
    expect(mockClient.savePage).not.toHaveBeenCalled()
  })

  test('同一文本内重复引用同一目标 → 只建一次', async () => {
    const result = await ensureWikiLinkTargets({ plain: '[[产品]] 与 [[产品]] 还有 [[产品]]' })

    expect(result.created).toEqual(['产品'])
    expect(mockClient.savePage).toHaveBeenCalledTimes(1)
  })

  test('html 源：富文本中提取目标（与外部粘贴落库同源提炼）', async () => {
    const result = await ensureWikiLinkTargets({
      html: '<p>引用 <strong>[[产品评审]]</strong> 页</p><ul><li>以及 [[复盘模板]]</li></ul>',
    })

    expect(result.created).toEqual(['产品评审', '复盘模板'])
    expect(mockClient.savePage).toHaveBeenCalledTimes(2)
  })

  test('html 与 plain 并存 → html 优先（与落库 D2 同源，永不落库的 plain 不产生目标）', async () => {
    const result = await ensureWikiLinkTargets({
      html: '<p>[[产品评审]]</p>',
      plain: '[[复盘模板]]',
    })

    expect(result.created).toEqual(['产品评审'])
    expect(mockClient.savePage).toHaveBeenCalledTimes(1)
    expect(mockClient.savePage).toHaveBeenCalledWith(expect.objectContaining({ title: '产品评审' }))
  })

  test('html 无可提炼内容（如纯图片）→ 降级扫 plain', async () => {
    const result = await ensureWikiLinkTargets({
      html: '<img src="x.png">',
      plain: '[[产品评审]]',
    })

    expect(result.created).toEqual(['产品评审'])
  })

  test('重复调用幂等：第二次全部已存在、created 为空', async () => {
    const first = await ensureWikiLinkTargets({ plain: '[[产品]] [[复盘]]' })
    expect(first.created).toEqual(['产品', '复盘'])

    const second = await ensureWikiLinkTargets({ plain: '[[产品]] [[复盘]]' })
    expect(second.created).toEqual([])
    expect(mockClient.savePage).toHaveBeenCalledTimes(2)
  })

  test('无可解析文本 → 零副作用', async () => {
    const result = await ensureWikiLinkTargets({ plain: '   ', html: '' })

    expect(result.created).toEqual([])
    expect(mockClient.savePage).not.toHaveBeenCalled()
  })
})

describe('notifyCreatedPages（toast 汇总）', () => {
  test('N>0 → 调一次 toast 且文案含标题列表', () => {
    const spy = vi.fn()
    notifyCreatedPages(['产品评审', '复盘模板'], spy)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('已创建 2 个页面：产品评审、复盘模板', 'info')
  })

  test('N=0 → 完全不调 toast', () => {
    const spy = vi.fn()
    notifyCreatedPages([], spy)

    expect(spy).not.toHaveBeenCalled()
  })
})
