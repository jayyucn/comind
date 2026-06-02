import { ref, computed } from 'vue'

export interface RightSidebarSettings {
  defaultPanel: string
  panelOrder: string[]
}

const STORAGE_KEY = 'comind-right-sidebar'

function loadSettings(): RightSidebarSettings {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch { /* fallback */ }
  }
  return {
    defaultPanel: 'concept-graph',
    panelOrder: ['concept-graph']
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

  function updateSettings(newSettings: Partial<RightSidebarSettings>) {
    settings.value = { ...settings.value, ...newSettings }
    saveSettings(settings.value)
  }

  return {
    visible: computed(() => visible.value),
    activePanelId: computed(() => activePanelId.value),
    settings: computed(() => settings.value),
    setVisible,
    toggleVisible,
    setActivePanel,
    updateSettings
  }
}
