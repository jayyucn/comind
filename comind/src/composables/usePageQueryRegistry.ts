/**
 * Page 查询字段描述符注册表 —— 通用查询引擎的第二个真实消费方（issue #25）。
 *
 * 把 Page 的可筛字段接入无头引擎的 {@link Registry}（entityType = 'page'）：
 * - 内置字段：title(text) / type(select) / createdAt, updatedAt(date, yyyy-MM-dd) /
 *   childrenCount, wordCount(number) / aliases(multiSelect)
 * - 日期字段沿用 Ideas Page 的 yyyy-MM-dd 规范：timestamp(ms) → 本地 yyyy-MM-dd 字符串
 *
 * Page 无自定义属性系统，注册表为静态（全部内置），无运行时增删。
 * 本模块是「引擎与业务解耦」主张的实证：不修改引擎一行，仅通过注册即获得筛选/排序/分组能力。
 */
import { createRegistry, type Option, type Registry } from '../core/query'
import type { BoardConfig, CalendarConfig, LayoutConfig, TableConfig, ViewKind } from '../core/view'
import type { Page } from '../types/page'

/** 引擎命名空间：所有 Page 字段注册于此。 */
export const PAGE_ENTITY = 'page'

/**
 * Page 实体内建默认表格列（对应原 PageTableView 的 6 列：标题/类型/创建/更新/字数/子页面）。
 * 视图未携带持久化 config（或解析失败）时回退此值；列 key 对应 registerPageBuiltinFields 注册的字段。
 */
export const PAGE_DEFAULT_TABLE_CONFIG: TableConfig = {
  viewKind: 'table',
  version: 1,
  columns: [
    { key: 'title', role: 'primary' },
    { key: 'type' },
    { key: 'createdAt' },
    { key: 'updatedAt' },
    { key: 'wordCount' },
    { key: 'childrenCount' },
  ],
}

/**
 * Page 实体内建默认日历布局：按 updatedAt 落格（沿用原 PageCalendarView 语义）。
 */
export const PAGE_DEFAULT_CALENDAR_CONFIG: CalendarConfig = {
  viewKind: 'calendar',
  version: 1,
  dateRefKind: 'updatedAt',
}

/** Page 实体内建默认看板布局：无 cardFields（当前 Page 视图类型不含 board，保留默认徽章集）。 */
export const PAGE_DEFAULT_BOARD_CONFIG: BoardConfig = {
  viewKind: 'board',
  version: 1,
}

/** Page 实体默认布局统一入口（store seed/create 经 options 注入）。 */
export function pageDefaultConfig(kind: ViewKind): LayoutConfig {
  switch (kind) {
    case 'table': return PAGE_DEFAULT_TABLE_CONFIG
    case 'board': return PAGE_DEFAULT_BOARD_CONFIG
    case 'calendar': return PAGE_DEFAULT_CALENDAR_CONFIG
  }
}

/** timestamp(ms) → 本地 yyyy-MM-dd（沿用 Ideas Page 规范）。空/非法返回 undefined（视为空值）。 */
function toDateKey(ts: number | null | undefined): string | undefined {
  if (!ts) return undefined
  const d = new Date(ts)
  if (isNaN(d.getTime())) return undefined
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const TYPE_OPTIONS: Option[] = [
  { id: 'normal', label: '普通' },
  { id: 'ideas', label: '灵感' },
]

function asPage(item: unknown): Page {
  return item as Page
}

/** 注册 Page 全部内置字段描述符到注册表。 */
export function registerPageBuiltinFields(registry: Registry): void {
  registry.register(PAGE_ENTITY, {
    key: 'title',
    label: '标题',
    type: 'text',
    get: (item) => asPage(item).title,
  })

  registry.register(PAGE_ENTITY, {
    key: 'type',
    label: '类型',
    type: 'select',
    options: TYPE_OPTIONS,
    get: (item) => asPage(item).type,
  })

  // 创建/更新日期：timestamp → yyyy-MM-dd（Ideas 规范），用于 before/after/between/排序/分组
  registry.register(PAGE_ENTITY, {
    key: 'createdAt',
    label: '创建日期',
    type: 'date',
    dateBucket: 'day',
    get: (item) => toDateKey(asPage(item).createdAt),
  })

  registry.register(PAGE_ENTITY, {
    key: 'updatedAt',
    label: '更新日期',
    type: 'date',
    dateBucket: 'day',
    get: (item) => toDateKey(asPage(item).updatedAt),
  })

  registry.register(PAGE_ENTITY, {
    key: 'childrenCount',
    label: '子页面数',
    type: 'number',
    get: (item) => asPage(item).childrenCount,
  })

  registry.register(PAGE_ENTITY, {
    key: 'wordCount',
    label: '字数',
    type: 'number',
    get: (item) => asPage(item).wordCount,
  })

  // 别名为字符串数组，multiSelect 语义（hasAny/hasAll）
  registry.register(PAGE_ENTITY, {
    key: 'aliases',
    label: '别名',
    type: 'multiSelect',
    get: (item) => asPage(item).aliases ?? [],
  })
}

let singleton: Registry | null = null

/** 应用级单例注册表：首次调用创建并注册内置字段；测试应自行 createRegistry()。 */
export function getPageRegistry(): Registry {
  if (!singleton) {
    singleton = createRegistry()
    registerPageBuiltinFields(singleton)
  }
  return singleton
}

/**
 * 组合根注册 composable：返回单例注册表与 entityType。
 * Page 无自定义属性系统，注册表为静态（全内置），无运行时增删。
 */
export function usePageQueryRegistry() {
  const registry = getPageRegistry()
  return { registry, entityType: PAGE_ENTITY }
}
