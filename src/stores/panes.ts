import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

/**
 * 对称分屏 Pane 状态（ADR-0059，取代 ADR-0058 的 splitPane）。
 *
 * - panes：pane 数组（上限 2，结构预留 N），每个 pane 持有一个 pageId。
 * - activePaneId：焦点 pane，驱动 currentPageId 与键盘/弹层路由。
 * - splitRatio：左侧 pane 占比（0.1~0.9）。
 * - 全持久化：panes + activePaneId + splitRatio 写 localStorage，刷新后恢复。
 *
 * 路由同步（URL = 活动 pane 页）不在本 store 内，由调用方（App.vue / composable）
 * 用 router.replace 完成，保持 store 无 router 依赖、可单测。
 */
export interface Pane {
  id: string
  pageId: string
}

const MAX_PANES = 2
const STORAGE_KEY = 'comind:panes'

interface PersistedState {
  panes: Pane[]
  activePaneId: string
  splitRatio: number
}

function isValidPane(p: unknown): p is Pane {
  if (typeof p !== 'object' || p === null) return false
  const o = p as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.pageId === 'string' && o.pageId !== ''
}

function clampRatio(r: number): number {
  return Math.min(0.9, Math.max(0.1, r))
}

export const usePanesStore = defineStore('panes', () => {
  const panes = ref<Pane[]>([])
  const activePaneId = ref('')
  const splitRatio = ref(0.5)
  /** 已从 localStorage 读档（true 后 URL→pane 才允许写 pane，防启动竞态覆盖存档布局） */
  const hydrated = ref(false)

  let seq = 0
  function nextId(): string {
    // 防撞：存档恢复后（loadFromStorage 不回推 seq）新建 pane 可能与存档 id 冲突
    // （运行时实测缺陷 F5：重启后新建 pane 与存档 pane 同为 'pane-1'）
    let id: string
    do {
      id = `pane-${++seq}`
    } while (panes.value.some(p => p.id === id))
    return id
  }

  function persist(): void {
    if (typeof window === 'undefined') return
    const state: PersistedState = {
      panes: panes.value,
      activePaneId: activePaneId.value,
      splitRatio: splitRatio.value,
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // 存储不可用（隐私模式/配额）时静默降级为不持久化
    }
  }

  function loadFromStorage(): void {
    if (typeof window === 'undefined') return
    // 先置位再读：无存档（首次启动）也要放行后续 URL→pane；有存档时，
    // 本调用前的任何 pane 写入都会覆盖存档（运行时实测的启动竞态，见下）
    hydrated.value = true
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const data = JSON.parse(raw) as Partial<PersistedState>
      if (!Array.isArray(data.panes) || data.panes.length === 0) return
      const valid = data.panes.filter(isValidPane).slice(0, MAX_PANES)
      if (valid.length === 0) return
      panes.value = valid
      activePaneId.value = valid.some(p => p.id === data.activePaneId)
        ? (data.activePaneId as string)
        : valid[0].id
      splitRatio.value = clampRatio(typeof data.splitRatio === 'number' ? data.splitRatio : 0.5)
    } catch {
      // 损坏数据按无持久化处理
    }
  }

  watch([panes, activePaneId, splitRatio], persist, { deep: true })

  /** 活动 pane（不存在时回退 null） */
  function activePane(): Pane | null {
    return panes.value.find(p => p.id === activePaneId.value) ?? null
  }

  /** 焦点切换：把某个 pane 设为活动（光标进入该 pane 时调用） */
  function activatePane(paneId: string): void {
    if (panes.value.some(p => p.id === paneId)) {
      activePaneId.value = paneId
    }
  }

  /** 导航：把活动 pane 的页设为 pageId（路由导航时调用，活动 pane 不存在则建一个） */
  function setActivePage(pageId: string): void {
    const active = activePane()
    if (active) {
      active.pageId = pageId
      return
    }
    if (panes.value.length === 0) {
      const id = nextId()
      panes.value.push({ id, pageId })
      activePaneId.value = id
    }
  }

  /** 导航：把指定 pane 的页设为 pageId 并激活它（pane 内后退/前进时调用） */
  function navigatePane(paneId: string, pageId: string): void {
    const pane = panes.value.find(p => p.id === paneId)
    if (!pane) return
    pane.pageId = pageId
    activePaneId.value = paneId
  }

  /** 引导：确保至少一个 pane（应用启动、路由 resolve 后调用） */
  function ensurePane(pageId: string): void {
    if (panes.value.length === 0) {
      const id = nextId()
      panes.value.push({ id, pageId })
      activePaneId.value = id
    }
  }

  /**
   * Ctrl+Click 分流：在「非活动 pane」打开目标页。
   * - 0/1 个 pane → 新增一个 pane 装目标页并设为活动；
   * - 2 个 pane → 目标页替换非活动 pane，并设为活动（焦点跟随新打开内容）。
   */
  function openInOtherPane(pageId: string): void {
    if (panes.value.length < MAX_PANES) {
      const id = nextId()
      panes.value.push({ id, pageId })
      activePaneId.value = id
      return
    }
    const other = panes.value.find(p => p.id !== activePaneId.value) ?? panes.value[0]
    other.pageId = pageId
    activePaneId.value = other.id
  }

  /** 关闭一个 pane；保持至少 1 个 pane。关闭的是活动 pane 时，活动权交给剩余第一个。 */
  function closePane(paneId: string): void {
    if (panes.value.length <= 1) return
    const idx = panes.value.findIndex(p => p.id === paneId)
    if (idx === -1) return
    panes.value.splice(idx, 1)
    if (activePaneId.value === paneId) {
      activePaneId.value = panes.value[0].id
    }
  }

  function setSplitRatio(r: number): void {
    splitRatio.value = clampRatio(r)
  }

  return {
    panes,
    activePaneId,
    splitRatio,
    hydrated,
    activatePane,
    setActivePage,
    navigatePane,
    ensurePane,
    openInOtherPane,
    closePane,
    setSplitRatio,
    loadFromStorage,
  }
})
