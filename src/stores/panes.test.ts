import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { usePanesStore } from './panes'

const STORAGE_KEY = 'comind:panes'

describe('panes store（对称分屏，ADR-0059）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('ensurePane 空态引导：建一个 pane 并设为活动', () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    expect(store.panes).toHaveLength(1)
    expect(store.panes[0].pageId).toBe('page-a')
    expect(store.activePaneId).toBe(store.panes[0].id)
  })

  it('ensurePane 已有 pane 时不重复建、不改活动 pane', () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    const firstId = store.activePaneId
    store.ensurePane('page-b')
    expect(store.panes).toHaveLength(1)
    expect(store.activePaneId).toBe(firstId)
  })

  it('openInOtherPane：单 pane → 拆成双 pane，目标页设为活动', () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    store.openInOtherPane('page-b')
    expect(store.panes).toHaveLength(2)
    const active = store.panes.find(p => p.id === store.activePaneId)!
    expect(active.pageId).toBe('page-b')
  })

  it('openInOtherPane：双 pane → 替换非活动 pane 并设为活动', () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    store.openInOtherPane('page-b') // 现在活动 = page-b
    const activePageB = store.activePaneId

    store.openInOtherPane('page-c') // 替换非活动（page-a）→ page-c
    expect(store.panes).toHaveLength(2)
    const active = store.panes.find(p => p.id === store.activePaneId)!
    expect(active.pageId).toBe('page-c')
    // 原来的活动 pane（page-b）保持不动
    const other = store.panes.find(p => p.id !== store.activePaneId)!
    expect(other.id).toBe(activePageB)
    expect(other.pageId).toBe('page-b')
  })

  it('closePane：保持至少 1 个 pane', () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    store.closePane(store.panes[0].id)
    expect(store.panes).toHaveLength(1)
  })

  it('closePane：关闭活动 pane 时活动权交给剩余第一个', () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    store.openInOtherPane('page-b') // 活动 = page-b
    const activeId = store.activePaneId
    store.closePane(activeId)
    expect(store.panes).toHaveLength(1)
    expect(store.panes[0].pageId).toBe('page-a')
    expect(store.activePaneId).toBe(store.panes[0].id)
  })

  it('closePane：关闭非活动 pane 时活动 pane 不变', () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    store.openInOtherPane('page-b') // 活动 = page-b
    const activeId = store.activePaneId
    const otherId = store.panes.find(p => p.id !== activeId)!.id
    store.closePane(otherId)
    expect(store.panes).toHaveLength(1)
    expect(store.activePaneId).toBe(activeId)
  })

  it('activatePane：未知 pane id 是 no-op', () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    const before = store.activePaneId
    store.activatePane('nonexistent')
    expect(store.activePaneId).toBe(before)
  })

  it('setActivePage：更新活动 pane 的页', () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    store.setActivePage('page-b')
    const active = store.panes.find(p => p.id === store.activePaneId)!
    expect(active.pageId).toBe('page-b')
    expect(store.panes).toHaveLength(1)
  })

  it('setActivePage：空态时引导一个 pane', () => {
    const store = usePanesStore()
    store.setActivePage('page-x')
    expect(store.panes).toHaveLength(1)
    expect(store.panes[0].pageId).toBe('page-x')
  })

  it('navigatePane：改指定 pane 的页并激活它', () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    store.openInOtherPane('page-b') // 活动 = page-b
    const pageAId = store.panes.find(p => p.pageId === 'page-a')!.id
    store.navigatePane(pageAId, 'page-c')
    expect(store.panes.find(p => p.id === pageAId)!.pageId).toBe('page-c')
    expect(store.activePaneId).toBe(pageAId)
  })

  it('navigatePane：未知 pane id 是 no-op', () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    store.navigatePane('ghost', 'page-x')
    expect(store.panes[0].pageId).toBe('page-a')
  })

  it('setSplitRatio：夹取到 [0.1, 0.9]', () => {
    const store = usePanesStore()
    store.setSplitRatio(0.05)
    expect(store.splitRatio).toBe(0.1)
    store.setSplitRatio(0.95)
    expect(store.splitRatio).toBe(0.9)
    store.setSplitRatio(0.42)
    expect(store.splitRatio).toBe(0.42)
  })

  it('loadFromStorage：恢复合法持久化状态', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        panes: [
          { id: 'p1', pageId: 'page-a' },
          { id: 'p2', pageId: 'page-b' },
        ],
        activePaneId: 'p2',
        splitRatio: 0.3,
      }),
    )
    const store = usePanesStore()
    store.loadFromStorage()
    expect(store.panes).toHaveLength(2)
    expect(store.activePaneId).toBe('p2')
    expect(store.splitRatio).toBe(0.3)
  })

  it('loadFromStorage：activePaneId 不在已存 pane 中时回退到第一个', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        panes: [{ id: 'p1', pageId: 'page-a' }],
        activePaneId: 'ghost',
        splitRatio: 0.5,
      }),
    )
    const store = usePanesStore()
    store.loadFromStorage()
    expect(store.activePaneId).toBe('p1')
  })

  it('loadFromStorage：损坏 JSON 按无持久化处理', () => {
    localStorage.setItem(STORAGE_KEY, '{broken')
    const store = usePanesStore()
    store.loadFromStorage()
    expect(store.panes).toHaveLength(0)
  })

  it('nextId：存档恢复后新建 pane 不与存档 id 冲突（重启撞 id 回归，F5）', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        panes: [{ id: 'pane-1', pageId: 'page-a' }],
        activePaneId: 'pane-1',
        splitRatio: 0.5,
      }),
    )
    const store = usePanesStore()
    store.loadFromStorage()
    store.openInOtherPane('page-b')
    expect(store.panes).toHaveLength(2)
    const ids = store.panes.map(p => p.id)
    expect(new Set(ids).size).toBe(2)
    expect(store.activePaneId).toBe(ids[1])
  })

  it('loadFromStorage：空 pane 数组按无持久化处理', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ panes: [], activePaneId: '', splitRatio: 0.5 }))
    const store = usePanesStore()
    store.loadFromStorage()
    expect(store.panes).toHaveLength(0)
  })

  it('状态变化自动持久化（deep watch）', async () => {
    const store = usePanesStore()
    store.ensurePane('page-a')
    store.openInOtherPane('page-b')
    await Promise.resolve() // 让 watch 回调跑一次
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.panes).toHaveLength(2)
    expect(saved.activePaneId).toBe(store.activePaneId)
  })
})
