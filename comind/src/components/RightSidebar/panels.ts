import type { Component } from 'vue'

export interface RightSidebarPanel {
  id: string
  label: string
  icon: string
  component: Component
}

let panels: RightSidebarPanel[] = []

export function registerPanel(panel: RightSidebarPanel) {
  if (!panels.find(p => p.id === panel.id)) {
    panels.push(panel)
  }
}

export function getRegisteredPanels(): RightSidebarPanel[] {
  return panels
}

export function getPanelById(id: string): RightSidebarPanel | undefined {
  return panels.find(p => p.id === id)
}
