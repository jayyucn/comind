import { computed, ref } from 'vue'

export interface RightSidebarSettings {
  defaultPanel: string
  panelOrder: string[]
  width: number
}

const STORAGE_KEY = 'comind-right-sidebar'

const MIN_WIDTH = 280
const MAX_WIDTH = 1000
const DEFAULT_WIDTH = 360

function loadSettings(): RightSidebarSettings {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      return {
        defaultPanel: parsed.defaultPanel ?? 'graph',
        panelOrder: parsed.panelOrder ?? ['graph'],
        width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parsed.width ?? DEFAULT_WIDTH)),
      }
    } catch { /* fallback */ }
  }
  return {
    defaultPanel: 'graph',
    panelOrder: ['graph'],
    width: DEFAULT_WIDTH
  }
}

function saveSettings(settings: RightSidebarSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

const visible = ref(false)
const settings = ref<RightSidebarSettings>(loadSettings())
const activePanelId = ref<string>(settings.value.defaultPanel)

/**
 * 面板回落（ADR-0047 D1）：把设置与当前面板中指向「未注册面板」的引用收敛到首个已注册
 * 面板，使已下架的面板（如 block-version）不再留下空白面板区与无高亮的 tab。
 * 只收敛内存状态、不改写 localStorage（存储交由后续正常写入自愈）；面板注册发生在模块加载
 * 之后（App.vue 的 registerPanel），故必须在注册完成后显式调用一次。
 *
 * 调用时机约束：必须在**全部** registerPanel 之后调用 —— 传入的 registeredIds 就是「幸存名单」，
 * 没被传进来的已注册面板 id 会被从 panelOrder 剔除，defaultPanel 若指向它则回落。
 * 现状：全仓唯一注册点是 App.vue（graph），本调用紧随其后（#104 下架 block-version 后仅剩一个面板）。
 * 将来若在子组件里懒注册新面板，必须把注册提到本调用之前，否则其 id 会被这次净化误删。
 */
export function reconcilePanels(registeredIds: string[]) {
  const first = registeredIds[0]
  if (!first) return

  const isRegistered = (id: string) => registeredIds.includes(id)
  const defaultPanel = isRegistered(settings.value.defaultPanel) ? settings.value.defaultPanel : first
  settings.value = {
    ...settings.value,
    defaultPanel,
    panelOrder: settings.value.panelOrder.filter(isRegistered),
  }

  // 未注册则跟随净化后的 defaultPanel —— 会话启动时当前面板本就由 defaultPanel 播种，同源。
  if (!isRegistered(activePanelId.value)) {
    activePanelId.value = defaultPanel
  }
}

export function useRightSidebar() {
  function setVisible(v: boolean) {
    visible.value = v
  }

  function toggleVisible() {
    visible.value = !visible.value
  }

  function setActivePanel(id: string) {
    activePanelId.value = id
  }

  function setWidth(w: number, persist = true) {
    settings.value = { ...settings.value, width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w)) }
    if (persist) saveSettings(settings.value)
  }

  function updateSettings(newSettings: Partial<RightSidebarSettings>) {
    settings.value = { ...settings.value, ...newSettings }
    saveSettings(settings.value)
  }

  function persistSettings() {
    saveSettings(settings.value)
  }

  return {
    visible: computed(() => visible.value),
    activePanelId: computed(() => activePanelId.value),
    settings: computed(() => settings.value),
    setVisible,
    toggleVisible,
    setActivePanel,
    setWidth,
    persistSettings,
    updateSettings
  }
}
