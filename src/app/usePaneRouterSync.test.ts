import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref, type EffectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const route = reactive({ fullPath: '/', path: '/', name: undefined as string | undefined, params: {} as Record<string, string> })
const mockReplace = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ replace: mockReplace }),
}))

const currentPageId = ref('')
const setCurrentPage = vi.fn((id: string) => { currentPageId.value = id })
const getPage = vi.fn()
const getPageByTitle = vi.fn()
const onRemovePageFromHistory = vi.fn()
vi.mock('../stores/pages', () => ({
  usePageStore: () => ({ currentPageId, setCurrentPage, getPage, getPageByTitle, onRemovePageFromHistory }),
}))

import { usePanesStore } from '../stores/panes'
import { usePaneRouterSync } from './usePaneRouterSync'

let scope: EffectScope

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  scope = effectScope()
  Object.assign(route, { fullPath: '/', path: '/', name: undefined, params: {} })
  mockReplace.mockReset()
  currentPageId.value = ''
  setCurrentPage.mockClear()
  getPage.mockReset()
  getPageByTitle.mockReset()
  onRemovePageFromHistory.mockClear()
  usePanesStore().loadFromStorage()
})

afterEach(() => scope.stop())

function setup() {
  return scope.run(() => usePaneRouterSync())!
}

describe('usePaneRouterSync（ADR-0060 URL 镜像）', () => {
  it('活动标签跨目的地切换用 replace 同步 URL，并清空非页 currentPageId', async () => {
    const store = usePanesStore()
    store.ensurePane({ kind: 'page', ref: 'a' })
    setup()
    expect(currentPageId.value).toBe('a')

    store.navigate({ kind: 'graph' })
    await nextTick()
    expect(mockReplace).toHaveBeenCalledWith('/graph')
    expect(currentPageId.value).toBe('')

    store.navigate({ kind: 'tags', ref: 'tag-a' })
    await nextTick()
    expect(mockReplace).toHaveBeenCalledWith('/tags/tag-a')
  })

  it('外部 URL 导航 push 到当前活动标签', async () => {
    const store = usePanesStore()
    store.ensurePane({ kind: 'page', ref: 'a' })
    setup()
    Object.assign(route, { name: 'tasks', path: '/tasks', fullPath: '/tasks', params: {} })
    await nextTick()
    expect(store.activeView).toEqual({ kind: 'tasks' })
    const pane = store.panes[0]
    expect(pane.tabs[0].entries).toEqual([{ kind: 'page', ref: 'a' }, { kind: 'tasks' }])
  })

  it('restore 匹配存储标签当前视图时激活对应 pane/tab', () => {
    const store = usePanesStore()
    store.ensurePane({ kind: 'page', ref: 'a' })
    store.openInOtherPane({ kind: 'graph' })
    Object.assign(route, { name: 'page', path: '/page/a', fullPath: '/page/a', params: { pageId: 'a' } })
    setup().restore()
    expect(store.activePaneId).toBe(store.panes[0].id)
    expect(store.activeView).toEqual({ kind: 'page', ref: 'a' })
  })

  it('restore 未命中 URL 时保留存储布局，空态才用 URL 初始化', () => {
    const store = usePanesStore()
    store.ensurePane({ kind: 'tasks' })
    Object.assign(route, { name: 'graph', path: '/graph', fullPath: '/graph', params: {} })
    setup().restore()
    expect(store.activeView).toEqual({ kind: 'tasks' })

    setActivePinia(createPinia())
    const empty = usePanesStore()
    empty.loadFromStorage()
    setup().restore()
    expect(empty.activeView).toEqual({ kind: 'graph' })
  })

  it('ideas 页面使用标题路由且解析为 page PaneView', async () => {
    getPage.mockReturnValue({ id: 'idea-id', title: '2026-10-27', type: 'ideas' })
    getPageByTitle.mockReturnValue({ id: 'idea-id', title: '2026-10-27', type: 'ideas' })
    const store = usePanesStore()
    setup()
    store.ensurePane({ kind: 'page', ref: 'idea-id' })
    await nextTick()
    expect(mockReplace).toHaveBeenCalledWith('/ideas/2026-10-27')

    Object.assign(route, { name: 'ideas-page', path: '/ideas/2026-10-27', fullPath: '/ideas/2026-10-27', params: { date: '2026-10-27' } })
    setup().restore()
    expect(store.activeView).toEqual({ kind: 'page', ref: 'idea-id' })
  })
})
