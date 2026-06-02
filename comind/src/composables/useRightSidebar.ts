import { ref, computed } from 'vue'

export interface RightSidebarSettings {
  defaultPanel: string
  panelOrder: string[]
  width: number
}

const STORAGE_KEY = 'comind-right-sidebar'

const MIN_WIDTH = 280
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 360

function loadSettings(): RightSidebarSettings {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      return {
        defaultPanel: parsed.defaultPanel ?? 'concept-graph',
        panelOrder: parsed.panelOrder ?? ['concept-graph'],
        width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parsed.width ?? DEFAULT_WIDTH)),
      }
    } catch { /* fallback */ }
  }
  return {
    defaultPanel: 'concept-graph',
    panelOrder: ['concept-graph'],
    width: DEFAULT_WIDTH
  }
}

function saveSettings(settings: RightSidebarSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

const visible = ref(false)
const settings = ref<RightSidebarSettings>(loadSettings())
const activePanelId = ref<string>(settings.value.defaultPanel)

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
