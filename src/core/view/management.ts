import type { Component } from 'vue'
import type { ViewQuery } from '../query'
import type { ScreenViewRust } from '../../wasm/types'

/** 视图类型选项：由消费方按实体注入（block: 表格/看板/日历/四象限；page: 表格/日历）。 */
export interface ViewTypeOption {
  key: 'table' | 'board' | 'calendar' | 'quadrant'
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

/** 视图查询可改动的部分，与 tab 脏提示文案一一对应。 */
export type QueryPart = 'filter' | 'sort' | 'group'

/** 脏提示显示优先级：筛选 > 排序 > 分组。 */
const QUERY_PART_PRIORITY: QueryPart[] = ['filter', 'sort', 'group']

/**
 * 工作查询相对已保存查询实际改动的部分，按 筛选>排序>分组 优先级排序。
 * 驱动 tab 脏提示文案「你调整了{筛选|排序|分组}」；无改动返回空数组。
 */
export function diffQueryParts(committed: ViewQuery, working: ViewQuery): QueryPart[] {
  const changed = new Set<QueryPart>()
  if (JSON.stringify(committed.filter) !== JSON.stringify(working.filter)) changed.add('filter')
  if (JSON.stringify(committed.sort) !== JSON.stringify(working.sort)) changed.add('sort')
  if ((committed.groupBy ?? null) !== (working.groupBy ?? null)) changed.add('group')
  return QUERY_PART_PRIORITY.filter((p) => changed.has(p))
}
