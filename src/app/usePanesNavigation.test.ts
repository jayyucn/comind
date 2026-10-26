import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref, type EffectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const route = reactive<{
  fullPath: string
  path: string
  name: string | undefined
  params: Record<string, string>
}>({
  fullPath: '/',
  path: '/',
  name: undefined,
  params: {},
})

const mockReplace = vi.fn()
const mockPush = vi.fn()

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}))

const currentPageId = ref('')
const setCurrentPage = vi.fn((id: string) => {
  currentPageId.value = id
})
const getPage = vi.fn()
const getPageByTitle = vi.fn()
const onRemovePageFromHistory = vi.fn()

vi.mock('../stores/pages', () => ({
  usePageStore: () => ({ currentPageId, setCurrentPage, getPage, getPageByTitle, onRemovePageFromHistory }),
}))

import { usePanesStore } from '../stores/panes'
import { usePanesNavigation } from './usePanesNavigation'

const STORAGE_KEY = 'comind:panes'

let scope: EffectScope

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  scope = effectScope()
  route.fullPath = '/'
  route.path = '/'
  route.name = undefined
  route.params = {}
  mockReplace.mockReset()
  mockPush.mockReset()
  currentPageId.value = ''
  setCurrentPage.mockClear()
  getPage.mockReset()
  getPageByTitle.mockReset()
  getPage.mockReturnValue(undefined)
  getPageByTitle.mockReturnValue(undefined)
  // 启动等价态：App onMounted 会先 loadFromStorage（localStorage 已清 → 仅置 hydrated）
  usePanesStore().loadFromStorage()
})

afterEach(() => {
  scope.stop()
})

/** 在独立 effectScope 内创建编排层，避免跨测试 watcher 泄漏 */
function setupNav() {
  return scope.run(() => usePanesNavigation())!
}

describe('usePanesNavigation 编排层（ADR-0059）', () => {
  it('restore：空态 + 页面路由 → 引导一个 pane 并派生 currentPageId', () => {
    route.name = 'page'
    route.params = { pageId: 'p1' }
    route.path = '/page/p1'
    route.fullPath = '/page/p1'

    const nav = setupNav()
    const store = usePanesStore()
    nav.restore()

    expect(store.panes).toHaveLength(1)
    expect(store.panes[0].pageId).toBe('p1')
    expect(store.activePaneId).toBe(store.panes[0].id)
    expect(currentPageId.value).toBe('p1')
  })

  it('restore：URL 页已在布局中 → 激活持有它的 pane', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        panes: [
          { id: 'p1', pageId: 'page-a' },
          { id: 'p2', pageId: 'page-b' },
        ],
        activePaneId: 'p1',
        splitRatio: 0.5,
      }),
    )
    route.name = 'page'
    route.params = { pageId: 'page-b' }
    route.path = '/page/page-b'
    route.fullPath = '/page/page-b'

    const store = usePanesStore()
    store.loadFromStorage()
    const nav = setupNav()
    nav.restore()

    expect(store.activePaneId).toBe('p2')
    expect(currentPageId.value).toBe('page-b')
  })

  it('restore：URL 页不在已存布局 → 用 URL 页覆盖第一个 pane 并激活', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        panes: [
          { id: 'p1', pageId: 'page-a' },
          { id: 'p2', pageId: 'page-b' },
        ],
        activePaneId: 'p2', // 活动 = 第二个 pane，用以区分「第一个」与「活动」
        splitRatio: 0.5,
      }),
    )
    route.name = 'page'
    route.params = { pageId: 'page-c' }
    route.path = '/page/page-c'
    route.fullPath = '/page/page-c'

    const store = usePanesStore()
    store.loadFromStorage()
    const nav = setupNav()
    nav.restore()

    // 覆盖的是第一个 pane（p1），不是活动 pane（p2）
    expect(store.panes).toHaveLength(2)
    expect(store.panes[0].pageId).toBe('page-c')
    expect(store.panes[1].pageId).toBe('page-b')
    expect(store.activePaneId).toBe('p1')
    expect(currentPageId.value).toBe('page-c')
  })

  it('activatePane → currentPageId 同步派生（flush sync）', () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    store.openInOtherPane('page-b') // 活动 = page-b
    const pageAId = store.panes.find(p => p.pageId === 'page-a')!.id
    setupNav()

    expect(currentPageId.value).toBe('page-b')

    store.activatePane(pageAId)
    // flush sync：无需 nextTick 即已派生
    expect(currentPageId.value).toBe('page-a')
  })

  it('activatePane → URL replace 到活动 pane 页', async () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    store.openInOtherPane('page-b')
    const pageAId = store.panes.find(p => p.pageId === 'page-a')!.id
    route.name = 'page'
    route.params = { pageId: 'page-b' }
    route.path = '/page/page-b'
    route.fullPath = '/page/page-b'
    setupNav()

    store.activatePane(pageAId)
    await nextTick()
    expect(mockReplace).toHaveBeenCalledWith('/page/page-a')
  })

  it('URL → pane：页面路由变化 → 活动 pane 跟随', async () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    route.name = 'page'
    route.params = { pageId: 'page-a' }
    route.path = '/page/page-a'
    route.fullPath = '/page/page-a'
    setupNav()

    route.params = { pageId: 'page-b' }
    route.path = '/page/page-b'
    route.fullPath = '/page/page-b'
    await nextTick()

    const active = store.panes.find(p => p.id === store.activePaneId)!
    expect(active.pageId).toBe('page-b')
    expect(currentPageId.value).toBe('page-b')
  })

  it('URL → pane：ideas-page 路由按标题解析到页 id', async () => {
    getPageByTitle.mockReturnValue({ id: 'idea-1', title: '2026-10-25', type: 'ideas' })
    const store = usePanesStore()
    route.name = 'page'
    route.params = { pageId: 'page-a' }
    route.path = '/page/page-a'
    route.fullPath = '/page/page-a'
    setupNav()

    route.name = 'ideas-page'
    route.params = { date: '2026-10-25' }
    route.path = '/ideas/2026-10-25'
    route.fullPath = '/ideas/2026-10-25'
    await nextTick()

    expect(store.panes).toHaveLength(1)
    expect(store.panes[0].pageId).toBe('idea-1')
  })

  it('非页面路由：URL→pane 不建 pane、不动 currentPageId', async () => {
    const store = usePanesStore()
    setupNav()

    route.name = 'tasks'
    route.params = {}
    route.path = '/tasks'
    route.fullPath = '/tasks'
    await nextTick()

    expect(store.panes).toHaveLength(0)
    expect(currentPageId.value).toBe('')
  })

  it('URL 已一致时不再 replace（no-op 守卫）', async () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    route.name = 'page'
    route.params = { pageId: 'page-a' }
    route.path = '/page/page-a'
    route.fullPath = '/page/page-a'
    setupNav()

    store.activatePane(store.panes[0].id) // 活动 pane 页不变
    await nextTick()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('导航历史：连续导航压栈，后退/前进作用于本 pane 并改页', async () => {
    route.name = 'page'
    route.params = { pageId: 'page-a' }
    route.path = '/page/page-a'
    route.fullPath = '/page/page-a'
    const nav = setupNav()
    const store = usePanesStore()
    nav.restore() // 初始页入栈

    // 外部导航到 page-b、page-c（压栈）
    route.params = { pageId: 'page-b' }
    route.path = '/page/page-b'
    route.fullPath = '/page/page-b'
    await nextTick()
    route.params = { pageId: 'page-c' }
    route.path = '/page/page-c'
    route.fullPath = '/page/page-c'
    await nextTick()

    const paneId = store.activePaneId
    expect(store.panes.find(p => p.id === paneId)!.pageId).toBe('page-c')
    expect(nav.canGoBack(paneId)).toBe(true)

    nav.goBack(paneId)
    expect(store.panes.find(p => p.id === paneId)!.pageId).toBe('page-b')
    expect(nav.canGoForward(paneId)).toBe(true)

    nav.goForward(paneId)
    expect(store.panes.find(p => p.id === paneId)!.pageId).toBe('page-c')
    expect(nav.canGoForward(paneId)).toBe(false)
  })

  it('openInOtherPane 替换非活动 pane（目标页=活动 pane 页）仍记录被替换 pane 的历史（运行时实测缺陷回归）', () => {
    const store = usePanesStore()
    const nav = setupNav()
    store.ensurePane('page-a')
    store.openInOtherPane('page-b') // p1=page-a, p2=page-b, active=p2
    const p1 = store.panes[0]

    // 目标页恰为活动 pane 当前页：替换 p1（page-a → page-b），activePanePageId 前后不变
    store.openInOtherPane('page-b')
    expect(store.panes[0].pageId).toBe('page-b')
    // 缺陷形态：p1 的真实导航（page-a → page-b）必须入栈，后退可用
    expect(nav.canGoBack(p1.id)).toBe(true)
    nav.goBack(p1.id)
    expect(store.panes[0].pageId).toBe('page-a')
  })

  it('后退/前进改动 pane 页并同步 currentPageId（浏览器历史解耦，不调 window.history）', async () => {
    route.name = 'page'
    route.params = { pageId: 'page-a' }
    route.path = '/page/page-a'
    route.fullPath = '/page/page-a'
    const nav = setupNav()
    const store = usePanesStore()
    nav.restore()

    route.params = { pageId: 'page-b' }
    route.path = '/page/page-b'
    route.fullPath = '/page/page-b'
    await nextTick()

    const paneId = store.activePaneId
    nav.goBack(paneId)
    expect(currentPageId.value).toBe('page-a')
    // 浏览器原生历史不参与：replace 而非 go(±1)
    expect(mockReplace).toHaveBeenCalledWith('/page/page-a')
  })

  it('URL→pane 在 hydrate 前不写 pane（启动竞态覆盖存档布局回归，F4）', async () => {
    // 模拟真实启动：main.ts 有意不 await router.isReady()，App onMounted 的
    // loadFromStorage 排在多个 await 之后 —— 初始路由解析先于读档完成。
    setActivePinia(createPinia()) // 重置为未 hydrate 态（beforeEach 已 hydrate）
    const store = usePanesStore()
    const nav = setupNav()
    expect(store.hydrated).toBe(false)

    route.name = 'page'
    route.params = { pageId: 'page-x' }
    route.path = '/page/page-x'
    route.fullPath = '/page/page-x'
    await nextTick()
    // 未读档：URL→pane 不写（否则 ensurePane + persist 会覆盖存档的双 pane 布局）
    expect(store.panes).toHaveLength(0)

    // 读档后由 restore() 负责 reconcile（无存档 → 引导一个 pane 装 URL 页）
    store.loadFromStorage()
    nav.restore()
    expect(store.panes).toHaveLength(1)
    expect(store.panes[0].pageId).toBe('page-x')
  })
})
