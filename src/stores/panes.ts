import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

/** Pane → PaneTab → PaneView（ADR-0060）。store 不依赖 router。 */
export type PaneKind = 'page' | 'graph' | 'tasks' | 'tags' | 'pages' | 'trash'

export interface PaneView {
  kind: PaneKind
  ref?: string
}

export interface PaneTab {
  id: string
  entries: PaneView[]
  cursor: number
}

export interface Pane {
  id: string
  tabs: PaneTab[]
  activeTabId: string
}

const MAX_PANES = 2
const STORAGE_KEY = 'comind:panes'
const KINDS: readonly PaneKind[] = ['page', 'graph', 'tasks', 'tags', 'pages', 'trash']

interface PersistedState {
  panes: Pane[]
  activePaneId: string
  activeTabId: string
  splitRatio: number
}

export function currentView(tab: PaneTab): PaneView {
  return tab.entries[tab.cursor]
}

export function samePaneView(a: PaneView, b: PaneView): boolean {
  return a.kind === b.kind && a.ref === b.ref
}

function asView(view: PaneView | string): PaneView {
  return typeof view === 'string' ? { kind: 'page', ref: view } : view
}

function isValidView(value: unknown): value is PaneView {
  if (typeof value !== 'object' || value === null) return false
  const view = value as Record<string, unknown>
  if (!KINDS.includes(view.kind as PaneKind)) return false
  if (view.kind === 'page') return typeof view.ref === 'string' && view.ref !== ''
  if (view.kind === 'tags') return view.ref === undefined || (typeof view.ref === 'string' && view.ref !== '')
  return view.ref === undefined
}

function isValidTab(value: unknown): value is PaneTab {
  if (typeof value !== 'object' || value === null) return false
  const tab = value as Record<string, unknown>
  return typeof tab.id === 'string' && tab.id !== ''
    && Array.isArray(tab.entries) && tab.entries.length > 0 && tab.entries.every(isValidView)
    && typeof tab.cursor === 'number' && Number.isInteger(tab.cursor)
    && tab.cursor >= 0 && tab.cursor < tab.entries.length
}

function isValidPane(value: unknown): value is Pane {
  if (typeof value !== 'object' || value === null) return false
  const pane = value as Record<string, unknown>
  return typeof pane.id === 'string' && pane.id !== ''
    && Array.isArray(pane.tabs) && pane.tabs.length > 0 && pane.tabs.every(isValidTab)
    && typeof pane.activeTabId === 'string'
    && pane.tabs.some(tab => (tab as PaneTab).id === pane.activeTabId)
}

function clampRatio(ratio: number): number {
  return Math.min(0.9, Math.max(0.1, ratio))
}

export const usePanesStore = defineStore('panes', () => {
  const panes = ref<Pane[]>([])
  const activePaneId = ref('')
  const activeTabId = ref('')
  const splitRatio = ref(0.5)
  const hydrated = ref(false)

  let paneSeq = 0
  let tabSeq = 0

  function nextPaneId(): string {
    let id: string
    do {
      id = `pane-${++paneSeq}`
    } while (panes.value.some(pane => pane.id === id))
    return id
  }

  function nextTabId(): string {
    let id: string
    do {
      id = `pane-tab-${++tabSeq}`
    } while (panes.value.some(pane => pane.tabs.some(tab => tab.id === id)))
    return id
  }

  function createTab(view: PaneView): PaneTab {
    return { id: nextTabId(), entries: [view], cursor: 0 }
  }

  function createPane(view: PaneView): Pane {
    const tab = createTab(view)
    return { id: nextPaneId(), tabs: [tab], activeTabId: tab.id }
  }

  function activate(pane: Pane, tab: PaneTab): void {
    activePaneId.value = pane.id
    activeTabId.value = tab.id
    pane.activeTabId = tab.id
  }

  function activePane(): Pane | null {
    return panes.value.find(pane => pane.id === activePaneId.value) ?? null
  }

  function activeTab(pane: Pane): PaneTab | null {
    return pane.tabs.find(tab => tab.id === pane.activeTabId) ?? null
  }

  const activeView = computed<PaneView | null>(() => {
    const pane = activePane()
    const tab = pane ? activeTab(pane) : null
    return tab ? currentView(tab) : null
  })

  const currentPageId = computed<string | undefined>(() => {
    const view = activeView.value
    return view?.kind === 'page' ? view.ref : undefined
  })

  function persist(): void {
    if (typeof window === 'undefined') return
    const state: PersistedState = {
      panes: panes.value,
      activePaneId: activePaneId.value,
      activeTabId: activeTabId.value,
      splitRatio: splitRatio.value,
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // 存储不可用时降级为本次会话状态。
    }
  }

  function loadFromStorage(): void {
    if (typeof window === 'undefined') return
    hydrated.value = true
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const data = JSON.parse(raw) as Partial<PersistedState>
      if (!Array.isArray(data.panes) || data.panes.length === 0) return
      const valid = data.panes.filter(isValidPane).slice(0, MAX_PANES)
      if (valid.length === 0) return
      panes.value = valid
      const pane = valid.find(item => item.id === data.activePaneId) ?? valid[0]
      const tab = pane.tabs.find(item => item.id === data.activeTabId)
        ?? pane.tabs.find(item => item.id === pane.activeTabId)
        ?? pane.tabs[0]
      activate(pane, tab)
      splitRatio.value = clampRatio(typeof data.splitRatio === 'number' ? data.splitRatio : 0.5)
    } catch {
      // 损坏数据按无存档处理。
    }
  }

  watch([panes, activePaneId, activeTabId, splitRatio], persist, { deep: true })

  function activatePane(paneId: string): void {
    const pane = panes.value.find(item => item.id === paneId)
    const tab = pane ? activeTab(pane) : null
    if (pane && tab) activate(pane, tab)
  }

  function ensurePane(viewInput: PaneView | string): void {
    if (panes.value.length > 0) return
    const pane = createPane(asView(viewInput))
    panes.value.push(pane)
    activate(pane, pane.tabs[0])
  }

  function navigate(viewInput: PaneView | string, paneId = activePaneId.value): void {
    const view = asView(viewInput)
    const existing = panes.value.find(pane => pane.id === paneId)
    if (!existing) {
      ensurePane(view)
      return
    }
    const tab = activeTab(existing)
    if (!tab) return
    if (!samePaneView(currentView(tab), view)) {
      tab.entries = tab.entries.slice(0, tab.cursor + 1)
      tab.entries.push(view)
      tab.cursor = tab.entries.length - 1
    }
    activate(existing, tab)
  }

  function newTab(pageId: string, paneId = activePaneId.value): string {
    const pane = panes.value.find(item => item.id === paneId)
    if (!pane) return ''
    const tab = createTab({ kind: 'page', ref: pageId })
    pane.tabs.push(tab)
    activate(pane, tab)
    return tab.id
  }

  function closeTab(paneId: string, tabId: string): void {
    const pane = panes.value.find(item => item.id === paneId)
    if (!pane) return
    const index = pane.tabs.findIndex(tab => tab.id === tabId)
    if (index < 0) return
    // 关闭最后一个标签 = 关闭该 pane（多 pane 时）；单 pane 时必须保留至少一个标签。
    if (pane.tabs.length <= 1) {
      closePane(paneId)
      return
    }
    pane.tabs.splice(index, 1)
    if (pane.activeTabId === tabId) {
      pane.activeTabId = pane.tabs[Math.min(index, pane.tabs.length - 1)].id
    }
    if (activePaneId.value === paneId) activatePane(paneId)
  }

  function setActiveTab(paneId: string, tabId: string): void {
    const pane = panes.value.find(item => item.id === paneId)
    const tab = pane?.tabs.find(item => item.id === tabId)
    if (pane && tab) activate(pane, tab)
  }

  function openInOtherPane(viewInput: PaneView | string): void {
    const view = asView(viewInput)
    if (panes.value.length < MAX_PANES) {
      const pane = createPane(view)
      panes.value.push(pane)
      activate(pane, pane.tabs[0])
      return
    }
    const other = panes.value.find(pane => pane.id !== activePaneId.value) ?? panes.value[0]
    navigate(view, other.id)
  }

  function closePane(paneId: string): void {
    if (panes.value.length <= 1) return
    const index = panes.value.findIndex(pane => pane.id === paneId)
    if (index < 0) return
    panes.value.splice(index, 1)
    if (activePaneId.value === paneId) activatePane(panes.value[0].id)
  }

  function goBack(paneId = activePaneId.value): void {
    const pane = panes.value.find(item => item.id === paneId)
    const tab = pane ? activeTab(pane) : null
    if (!pane || !tab || tab.cursor <= 0) return
    tab.cursor--
    activate(pane, tab)
  }

  function goForward(paneId = activePaneId.value): void {
    const pane = panes.value.find(item => item.id === paneId)
    const tab = pane ? activeTab(pane) : null
    if (!pane || !tab || tab.cursor >= tab.entries.length - 1) return
    tab.cursor++
    activate(pane, tab)
  }

  function canGoBack(paneId: string): boolean {
    const pane = panes.value.find(item => item.id === paneId)
    const tab = pane ? activeTab(pane) : null
    return !!tab && tab.cursor > 0
  }

  function canGoForward(paneId: string): boolean {
    const pane = panes.value.find(item => item.id === paneId)
    const tab = pane ? activeTab(pane) : null
    return !!tab && tab.cursor < tab.entries.length - 1
  }

  function previousView(paneId: string): PaneView | null {
    const pane = panes.value.find(item => item.id === paneId)
    const tab = pane ? activeTab(pane) : null
    return tab && tab.cursor > 0 ? tab.entries[tab.cursor - 1] : null
  }

  /** URL 只激活匹配的当前 entry；无存档时才初始化，未命中时保留存储布局。 */
  function restore(view: PaneView): void {
    if (panes.value.length === 0) {
      ensurePane(view)
      return
    }
    for (const pane of panes.value) {
      const tab = pane.tabs.find(item => samePaneView(currentView(item), view))
      if (tab) {
        activate(pane, tab)
        return
      }
    }
  }

  function removePageFromHistory(pageId: string): void {
    for (const pane of panes.value) {
      for (const tab of pane.tabs) {
        const previous = currentView(tab)
        tab.entries = tab.entries.filter(view => !(view.kind === 'page' && view.ref === pageId))
        if (tab.entries.length === 0) tab.entries = [{ kind: 'pages' }]
        tab.cursor = Math.min(tab.cursor, tab.entries.length - 1)
        if (!samePaneView(previous, currentView(tab))) tab.cursor = Math.max(0, tab.cursor)
      }
    }
  }

  function setSplitRatio(ratio: number): void {
    splitRatio.value = clampRatio(ratio)
  }

  return {
    panes,
    activePaneId,
    activeTabId,
    splitRatio,
    hydrated,
    activeView,
    currentPageId,
    activatePane,
    ensurePane,
    navigate,
    newTab,
    closeTab,
    setActiveTab,
    openInOtherPane,
    closePane,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
    previousView,
    restore,
    removePageFromHistory,
    setSplitRatio,
    loadFromStorage,
  }
})
