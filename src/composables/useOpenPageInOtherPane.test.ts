import { describe, test, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePanesStore } from '../stores/panes'
import { useOpenPageInOtherPane } from './useOpenPageInOtherPane'

const {
  getPageByTitleMock,
  ensurePagesLoadedMock,
  ensureTodayIdeasPageMock,
  getOrCreatePageByTitleMock,
} = vi.hoisted(() => ({
  getPageByTitleMock: vi.fn(),
  ensurePagesLoadedMock: vi.fn().mockResolvedValue(undefined),
  ensureTodayIdeasPageMock: vi.fn(),
  getOrCreatePageByTitleMock: vi.fn(),
}))

vi.mock('../stores/pages', () => ({
  usePageStore: () => ({
    ensurePagesLoaded: ensurePagesLoadedMock,
    getPageByTitle: getPageByTitleMock,
    ensureTodayIdeasPage: ensureTodayIdeasPageMock,
    getOrCreatePageByTitle: getOrCreatePageByTitleMock,
  }),
}))

const { normalizeJournalTitleMock, isTodayTitleMock } = vi.hoisted(() => ({
  normalizeJournalTitleMock: vi.fn(),
  isTodayTitleMock: vi.fn(),
}))

vi.mock('../wasm/client', () => ({
  getCoreClient: () => ({
    normalizeJournalTitle: normalizeJournalTitleMock,
    isTodayTitle: isTodayTitleMock,
  }),
}))

/** 读取对称 pane store：另一栏打开后应出现目标页 */
function otherPanePageIds(): string[] {
  const store = usePanesStore()
  return store.panes.map(p => p.pageId)
}

/** 模拟真实上下文：Ctrl+Click 时至少已有一个 pane（当前页） */
function seedPane(): void {
  usePanesStore().ensurePane('current-page')
}

beforeEach(() => {
  setActivePinia(createPinia())
  getPageByTitleMock.mockReset()
  ensurePagesLoadedMock.mockClear()
  ensureTodayIdeasPageMock.mockReset()
  getOrCreatePageByTitleMock.mockReset()
  normalizeJournalTitleMock.mockReset()
  isTodayTitleMock.mockReset()
})

describe('useOpenPageInOtherPane', () => {
  test('普通标题 → getOrCreatePageByTitle 解析后在另一栏打开（单 pane 拆双）', async () => {
    seedPane()
    normalizeJournalTitleMock.mockResolvedValue(null)
    getOrCreatePageByTitleMock.mockResolvedValue({ id: 'p1' })

    const { openPageInOtherPane } = useOpenPageInOtherPane()
    await openPageInOtherPane('My Page')

    expect(getOrCreatePageByTitleMock).toHaveBeenCalledWith('My Page')
    expect(otherPanePageIds()).toContain('p1')
    expect(usePanesStore().panes).toHaveLength(2)
  })

  test('今日 ideas 日期标题：不存在时幂等创建并在另一栏打开', async () => {
    seedPane()
    normalizeJournalTitleMock.mockResolvedValue('2026-04-26')
    getPageByTitleMock.mockReturnValue(undefined)
    isTodayTitleMock.mockResolvedValue(true)
    ensureTodayIdeasPageMock.mockResolvedValue({ id: 'p2' })

    const { openPageInOtherPane } = useOpenPageInOtherPane()
    await openPageInOtherPane('2026/04/26')

    expect(ensureTodayIdeasPageMock).toHaveBeenCalled()
    expect(otherPanePageIds()).toContain('p2')
  })

  test('已存在的 ideas 页：直接用既有页 id', async () => {
    seedPane()
    normalizeJournalTitleMock.mockResolvedValue('2026-04-26')
    getPageByTitleMock.mockReturnValue({ id: 'p3' })

    const { openPageInOtherPane } = useOpenPageInOtherPane()
    await openPageInOtherPane('2026/04/26')

    expect(getOrCreatePageByTitleMock).not.toHaveBeenCalled()
    expect(otherPanePageIds()).toContain('p3')
  })

  test('历史 ideas 页从未创建 → 解析失败不动作，不新增 pane', async () => {
    normalizeJournalTitleMock.mockResolvedValue('2020-01-01')
    getPageByTitleMock.mockReturnValue(undefined)
    isTodayTitleMock.mockResolvedValue(false)

    const { openPageInOtherPane } = useOpenPageInOtherPane()
    await openPageInOtherPane('2020/01/01')

    expect(ensureTodayIdeasPageMock).not.toHaveBeenCalled()
    expect(getOrCreatePageByTitleMock).not.toHaveBeenCalled()
    expect(usePanesStore().panes).toHaveLength(0)
  })
})
