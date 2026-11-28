import { ref } from 'vue'

/**
 * 网页链接块的本地偏好（ADR-0066 D12）。
 *
 * 只有「是否自动抓取网页信息」一项：本应用会主动访问用户贴进来的每个网址，
 * 本地优先的产品应该让这件事可关。非知识数据，不进库。
 */
const STORAGE_KEY = 'comind.webLink.autoFetch'

function readAutoFetch(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? true : stored === '1'
  } catch {
    return true
  }
}

const autoFetch = ref(readAutoFetch())

export function useWebLinkSettings() {
  function setAutoFetch(enabled: boolean): void {
    autoFetch.value = enabled
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
    } catch {
      // 存储不可用（隐私模式）时只保留会话内取值
    }
  }

  return { autoFetch, setAutoFetch }
}

/**
 * 「刚落地的链接块」要自动浮出一次「显示为」面板（ADR-0066 D5）。
 *
 * 默认视图是链接视图（与飞书一致，不夺走原始 URL），代价是卡片能力靠悬停才能发现；
 * 补偿手段就是把面板在粘贴那一刻自动展开一次 —— 用户注意力还在时把四种视图摆在眼前。
 * 这里只传块 id，面板的定位与开关仍归组件自己。
 */
const panelRevealFor = ref<string | null>(null)
let revealTimer: number | undefined

export function revealWebLinkPanel(blockId: string): void {
  panelRevealFor.value = blockId
  if (revealTimer) clearTimeout(revealTimer)
  revealTimer = window.setTimeout(() => {
    if (panelRevealFor.value === blockId) panelRevealFor.value = null
  }, 4000)
}

export function useWebLinkPanelReveal() {
  return { panelRevealFor }
}
