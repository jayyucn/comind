import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive, nextTick } from 'vue'

const route = reactive<{ fullPath: string; params: Record<string, any> }>({
  fullPath: '/',
  params: {},
})
const getPage = vi.fn(() => undefined)
const getPageByTitle = vi.fn(() => undefined)
const onRemovePageFromHistory = vi.fn()

vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('../stores/pages', () => ({
  usePageStore: () => ({ getPage, getPageByTitle, onRemovePageFromHistory }),
}))

import { useNavigationHistory } from './useNavigationHistory'

beforeEach(() => {
  route.fullPath = '/'
  route.params = {}
  getPage.mockReset()
  getPageByTitle.mockReset()
  getPage.mockReturnValue(undefined)
  getPageByTitle.mockReturnValue(undefined)
  onRemovePageFromHistory.mockReset()
  vi.spyOn(window.history, 'go').mockImplementation(() => {})
})

describe('useNavigationHistory', () => {
  it('初始无前后历史', () => {
    const nav = useNavigationHistory()
    expect(nav.canGoBack.value).toBe(false)
    expect(nav.canGoForward.value).toBe(false)
  })

  it('导航后前进可用、后退不可用', async () => {
    const nav = useNavigationHistory()
    route.fullPath = '/graph'
    await nextTick()
    expect(nav.canGoBack.value).toBe(true)
    expect(nav.canGoForward.value).toBe(false)
  })

  it('goBack 调 window.history.go(-1)', async () => {
    const nav = useNavigationHistory()
    route.fullPath = '/graph'
    await nextTick()
    nav.goBack()
    expect(window.history.go).toHaveBeenCalledWith(-1)
    expect(nav.canGoBack.value).toBe(false)
  })

  it('中段跳转后截断后续历史', async () => {
    const nav = useNavigationHistory()
    route.fullPath = '/graph'
    await nextTick()
    route.fullPath = '/ideas'
    await nextTick()
    nav.goBack() // 回到 /graph（index 1，仍可前进到 /ideas）
    expect(nav.canGoForward.value).toBe(true)
    route.fullPath = '/tasks'
    await nextTick()
    expect(nav.canGoForward.value).toBe(false) // 中段跳转截断后续历史，无前进
  })

  it('removePage 过滤栈并回退索引', async () => {
    getPage.mockImplementation((id: string) =>
      id === 'abc' ? { id: 'abc' } : id === 'def' ? { id: 'def' } : undefined
    )
    const nav = useNavigationHistory()
    route.fullPath = '/p/abc'
    route.params = { pageId: 'abc' }
    await nextTick()
    route.fullPath = '/p/def'
    route.params = { pageId: 'def' }
    await nextTick()

    const removeFn = onRemovePageFromHistory.mock.calls[0][0] as (pageId: string) => void
    removeFn('abc')

    expect(nav.canGoBack.value).toBe(true)
    expect(nav.canGoForward.value).toBe(false)
  })

  it('removePage：删除更早的页不会让当前索引前漂', async () => {
    getPage.mockImplementation((id: string) =>
      ['abc', 'def', 'ghi'].includes(id) ? { id } : undefined
    )
    const nav = useNavigationHistory()
    route.fullPath = '/p/abc'
    route.params = { pageId: 'abc' }
    await nextTick()
    route.fullPath = '/p/def'
    route.params = { pageId: 'def' }
    await nextTick()
    route.fullPath = '/p/ghi'
    route.params = { pageId: 'ghi' }
    await nextTick()
    nav.goBack() // 回到 /p/def，当前指向 def，/p/ghi 在其后
    const removeFn = onRemovePageFromHistory.mock.calls[0][0] as (pageId: string) => void
    removeFn('abc') // 删除位于当前项之前的页
    expect(nav.canGoBack.value).toBe(true)
    expect(nav.canGoForward.value).toBe(true) // /p/ghi 仍在前面，不应因删除更早的页而丢失
    expect(nav.historyIndex?.value).toBe(1) // 仍指向 /p/def，而非漂移到 /p/ghi
  })

  it('浏览器前进/后退：栈索引与真实历史同步且不重复压栈', async () => {
    const nav = useNavigationHistory()
    route.fullPath = '/graph'
    await nextTick()
    route.fullPath = '/ideas'
    await nextTick()
    // 模拟用户直接点击浏览器“后退”：路由回到 /graph，但应用未走 goBack()
    route.fullPath = '/graph'
    await nextTick()
    expect(nav.historyIndex?.value).toBe(1) // 回到 /graph
    expect(nav.canGoForward.value).toBe(true) // /ideas 仍在前面
    expect(nav.canGoBack.value).toBe(true)
  })
})
