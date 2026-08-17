import type { Component } from 'vue'
import type { ScreenViewRust } from '../../wasm/types'

/** 视图类型选项：由消费方按实体注入（block: 表格/看板/日历；page: 表格/日历）。 */
export interface ViewTypeOption {
  key: 'table' | 'board' | 'calendar'
  label: string
  icon: Component
}

/** Screen 是否为默认（同实体唯一）。 */
export function isDefaultScreen(screen: ScreenViewRust | undefined | null): boolean {
  return !!screen && screen.is_default === 1
}

/** Screen 可删除：非默认，且 Screen 总数 > 1（始终保留至少一个）。 */
export function canDeleteScreen(screens: ScreenViewRust[], id: string): boolean {
  const s = screens.find((x) => x.id === id)
  return !!s && s.is_default !== 1 && screens.length > 1
}

/** Tab 可删除：同 Screen 内 Tab 总数 > 1（始终保留至少一个）。 */
export function canDeleteTab(tabs: ScreenViewRust[]): boolean {
  return tabs.length > 1
}

/** 按实体键提供默认视图名（首次加载且无视图时 seed）。 */
export function defaultViewNameForEntity(entityKey: string): string {
  if (entityKey === 'page') return '全部页面'
  return '全部任务'
}
