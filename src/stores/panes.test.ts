import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import { currentView, usePanesStore, type PaneView } from './panes'

const STORAGE_KEY = 'comind:panes'
const page = (ref: string): PaneView => ({ kind: 'page', ref })

function activeTab(store: ReturnType<typeof usePanesStore>) {
  const pane = store.panes.find(item => item.id === store.activePaneId)!
  return pane.tabs.find(item => item.id === pane.activeTabId)!
}

describe('panes store（PaneTab，ADR-0060）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('ensurePane 用 PaneView 初始化三层模型并派生 currentPageId', () => {
    const store = usePanesStore()
    store.ensurePane(page('page-a'))
    expect(store.panes).toHaveLength(1)
    expect(store.panes[0].tabs).toHaveLength(1)
    expect(store.panes[0].tabs[0].entries).toEqual([page('page-a')])
    expect(store.panes[0].tabs[0].cursor).toBe(0)
    expect(store.currentPageId).toBe('page-a')
  })

  it('非页目的地把 currentPageId 降级为 undefined', () => {
    const store = usePanesStore()
    store.ensurePane(page('page-a'))
    store.navigate({ kind: 'graph' })
    expect(store.currentPageId).toBeUndefined()
    store.navigate({ kind: 'tags', ref: 'tag-a' })
    expect(store.currentPageId).toBeUndefined()
  })

  it('每个 PaneTab 独立后退前进，新导航截断 forward', () => {
    const store = usePanesStore()
    store.ensurePane(page('a'))
    store.navigate(page('b'))
    store.navigate({ kind: 'tasks' })
    const firstTabId = activeTab(store).id
    store.goBack()
    expect(currentView(activeTab(store))).toEqual(page('b'))
    store.goForward()
    expect(currentView(activeTab(store))).toEqual({ kind: 'tasks' })
    store.goBack()
    store.navigate({ kind: 'graph' })
    expect(activeTab(store).entries).toEqual([page('a'), page('b'), { kind: 'graph' }])
    expect(store.canGoForward(store.activePaneId)).toBe(false)

    store.newTab('new-page')
    expect(activeTab(store).id).not.toBe(firstTabId)
    expect(store.canGoBack(store.activePaneId)).toBe(false)
    store.setActiveTab(store.activePaneId, firstTabId)
    expect(currentView(activeTab(store))).toEqual({ kind: 'graph' })
  })

  it('newTab 创建空白页标签并成为活动标签', () => {
    const store = usePanesStore()
    store.ensurePane({ kind: 'graph' })
    const tabId = store.newTab('blank-id')
    expect(tabId).not.toBe('')
    expect(store.activeTabId).toBe(tabId)
    expect(currentView(activeTab(store))).toEqual(page('blank-id'))
  })

  it('closeTab 保持每 pane 至少一个标签并移交活动标签', () => {
    const store = usePanesStore()
    store.ensurePane(page('a'))
    const first = activeTab(store).id
    const second = store.newTab('b')
    store.closeTab(store.activePaneId, second)
    expect(store.panes[0].tabs).toHaveLength(1)
    expect(store.activeTabId).toBe(first)
    store.closeTab(store.activePaneId, first)
    expect(store.panes[0].tabs).toHaveLength(1)
  })

  it('多 pane 时关闭最后一个标签 = 关闭该 pane（不再保护最后一个 tab）', () => {
    const store = usePanesStore()
    store.ensurePane(page('a'))
    store.openInOtherPane(page('b'))
    expect(store.panes).toHaveLength(2)
    const targetPaneId = store.activePaneId
    const targetTabId = store.activeTabId
    store.closeTab(targetPaneId, targetTabId)
    expect(store.panes).toHaveLength(1)
    expect(store.panes.some(pane => pane.id === targetPaneId)).toBe(false)
    expect(currentView(activeTab(store))).toEqual(page('a'))
  })

  it('openInOtherPane 在另一 pane 的活动标签 push 跨目的地视图', () => {
    const store = usePanesStore()
    store.ensurePane(page('a'))
    store.openInOtherPane({ kind: 'graph' })
    expect(store.panes).toHaveLength(2)
    expect(currentView(activeTab(store))).toEqual({ kind: 'graph' })
    const graphPaneId = store.activePaneId
    store.openInOtherPane({ kind: 'tasks' })
    expect(store.panes).toHaveLength(2)
    expect(store.activePaneId).not.toBe(graphPaneId)
    expect(currentView(activeTab(store))).toEqual({ kind: 'tasks' })
    expect(activeTab(store).entries).toEqual([page('a'), { kind: 'tasks' }])
  })

  it('closePane 保持至少一个 pane，关闭活动 pane 时移交活动权', () => {
    const store = usePanesStore()
    store.ensurePane(page('a'))
    store.closePane(store.activePaneId)
    expect(store.panes).toHaveLength(1)
    store.openInOtherPane(page('b'))
    store.closePane(store.activePaneId)
    expect(store.panes).toHaveLength(1)
    expect(currentView(activeTab(store))).toEqual(page('a'))
  })

  it('关闭非活动 pane 不改变当前活动 pane 和标签', () => {
    const store = usePanesStore()
    store.ensurePane(page('a'))
    store.openInOtherPane(page('b'))
    const activePaneId = store.activePaneId
    const activeTabId = store.activeTabId
    const otherId = store.panes.find(pane => pane.id !== activePaneId)!.id
    store.closePane(otherId)
    expect(store.activePaneId).toBe(activePaneId)
    expect(store.activeTabId).toBe(activeTabId)
  })

  it('未知 pane/tab id 的激活与历史操作是 no-op', () => {
    const store = usePanesStore()
    store.ensurePane(page('a'))
    store.activatePane('ghost')
    store.setActiveTab(store.activePaneId, 'ghost')
    store.goBack('ghost')
    expect(store.panes).toHaveLength(1)
    expect(currentView(activeTab(store))).toEqual(page('a'))
  })

  it('setSplitRatio 夹取到 [0.1, 0.9]', () => {
    const store = usePanesStore()
    store.setSplitRatio(0.05)
    expect(store.splitRatio).toBe(0.1)
    store.setSplitRatio(0.95)
    expect(store.splitRatio).toBe(0.9)
    store.setSplitRatio(0.42)
    expect(store.splitRatio).toBe(0.42)
  })

  it('splitView 单 pane 时复制当前视图到第二个 pane 并切方向', () => {
    const store = usePanesStore()
    store.ensurePane(page('a'))
    store.splitView('vertical')
    expect(store.layoutDirection).toBe('vertical')
    expect(store.panes).toHaveLength(2)
    expect(currentView(activeTab(store))).toEqual(page('a'))
    // 原 pane 不受影响
    const firstPane = store.panes[0]
    expect(currentView(firstPane.tabs[0])).toEqual(page('a'))
  })

  it('splitView 已有两个 pane 时仅切方向，不新建不覆盖', () => {
    const store = usePanesStore()
    store.ensurePane(page('a'))
    store.openInOtherPane(page('b'))
    const paneCount = store.panes.length
    const otherTabViews = store.panes.map(pane => pane.tabs.map(tab => tab.entries))
    store.splitView('horizontal')
    expect(store.layoutDirection).toBe('horizontal')
    expect(store.panes).toHaveLength(paneCount)
    expect(store.panes.map(pane => pane.tabs.map(tab => tab.entries))).toEqual(otherTabViews)
  })

  it('layoutDirection 持久化往返恢复', async () => {
    const first = usePanesStore()
    first.ensurePane(page('a'))
    first.splitView('vertical')
    await Promise.resolve()
    expect(first.layoutDirection).toBe('vertical')

    setActivePinia(createPinia())
    const restored = usePanesStore()
    restored.loadFromStorage()
    expect(restored.layoutDirection).toBe('vertical')
    expect(restored.panes).toHaveLength(2)
  })

  it('完整持久化往返恢复所有标签、历史和活动状态', async () => {
    const first = usePanesStore()
    first.ensurePane(page('a'))
    first.navigate({ kind: 'graph' })
    first.newTab('b')
    first.openInOtherPane({ kind: 'tasks' })
    first.setSplitRatio(0.3)
    await Promise.resolve()

    setActivePinia(createPinia())
    const restored = usePanesStore()
    restored.loadFromStorage()
    expect(restored.panes).toEqual(first.panes)
    expect(restored.activePaneId).toBe(first.activePaneId)
    expect(restored.activeTabId).toBe(first.activeTabId)
    expect(restored.splitRatio).toBe(0.3)
  })

  it('恢复后新建 pane/tab 不与存档 id 冲突', async () => {
    const store = usePanesStore()
    store.ensurePane(page('a'))
    store.openInOtherPane(page('b'))
    await nextTick()
    const saved = localStorage.getItem(STORAGE_KEY)
    expect(saved).not.toBeNull()
    setActivePinia(createPinia())
    const restored = usePanesStore()
    restored.loadFromStorage()
    restored.closePane(restored.panes[1].id)
    restored.openInOtherPane(page('c'))
    restored.newTab('d')
    const paneIds = restored.panes.map(pane => pane.id)
    const tabIds = restored.panes.flatMap(pane => pane.tabs.map(tab => tab.id))
    expect(new Set(paneIds).size).toBe(paneIds.length)
    expect(new Set(tabIds).size).toBe(tabIds.length)
  })

  it('restore 只激活 URL 匹配的当前 entry，未命中保留存储布局', () => {
    const store = usePanesStore()
    store.ensurePane(page('a'))
    store.newTab('b')
    store.openInOtherPane({ kind: 'graph' })
    store.restore(page('b'))
    expect(currentView(activeTab(store))).toEqual(page('b'))
    const before = store.activeTabId
    store.restore({ kind: 'trash' })
    expect(store.activeTabId).toBe(before)
  })

  it('restore 空态用 URL 初始化', () => {
    const store = usePanesStore()
    store.restore({ kind: 'trash' })
    expect(currentView(activeTab(store))).toEqual({ kind: 'trash' })
  })

  it('损坏或旧形态存储按无存档处理', () => {
    localStorage.setItem(STORAGE_KEY, '{broken')
    const store = usePanesStore()
    store.loadFromStorage()
    expect(store.panes).toHaveLength(0)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ panes: [{ id: 'p1', pageId: 'a' }] }))
    store.loadFromStorage()
    expect(store.panes).toHaveLength(0)
  })

  describe('reorderTabs (拖拽重排)', () => {
    it('按入参 id 顺序原地重排 pane.tabs，不改变标签数量', () => {
      const store = usePanesStore()
      store.ensurePane(page('a'))
      const first = store.activeTabId
      const second = store.newTab('b')
      const third = store.newTab('c')
      store.reorderTabs(store.activePaneId, [third, first, second])
      expect(store.panes[0].tabs.map((t) => t.id)).toEqual([third, first, second])
    })

    it('未知 pane id 是安全 no-op', () => {
      const store = usePanesStore()
      store.ensurePane(page('a'))
      store.newTab('b')
      const before = store.panes[0].tabs.map((t) => t.id)
      store.reorderTabs('ghost-pane', [store.activeTabId])
      expect(store.panes[0].tabs.map((t) => t.id)).toEqual(before)
    })

    it('ids 未覆盖的标签按原顺序兜底追加，不丢失', () => {
      const store = usePanesStore()
      store.ensurePane(page('a'))
      const first = store.activeTabId
      const second = store.newTab('b')
      store.reorderTabs(store.activePaneId, [second])
      expect(store.panes[0].tabs.map((t) => t.id)).toEqual([second, first])
    })
  })
})
