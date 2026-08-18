/**
 * 视图布局配置（LayoutConfig）—— 渲染专属元数据，与查询引擎无关。
 *
 * 每个 View 持有一份与其 viewKind 匹配的 LayoutConfig（见 docs/adr/0005、0006）。
 * 与 ViewQuery 一样为无头纯数据、可 JSON 序列化，带 version 以支持迁移。
 * 判别联合以 viewKind 作为判别字段，加载时校验 config.viewKind === view.viewKind。
 */

/** 视图布局类型。与 View.viewKind 同源。 */
export type ViewKind = 'table' | 'board' | 'calendar'

/** 表格列装饰角色（渲染专属，属 LayoutConfig 而非无头 FieldDescriptor）。 */
export type TableColumnRole = 'primary' | 'link' | 'overdue-date' | 'done'

/** 表格列配置：顺序由数组顺序决定；width 为像素，缺省时组件用自身默认列宽。 */
export interface TableColumnConfig {
  key: string
  width?: number
  /** 渲染装饰：primary=主文本(加粗省略号) / link=导航按钮 / overdue-date=过去日期标红 / done=布尔完成列(驱动行置灰)。 */
  role?: TableColumnRole
}

/** 表格视图布局配置。 */
export interface TableConfig {
  viewKind: 'table'
  version: 1
  columns: TableColumnConfig[]
}

/**
 * 看板视图布局配置。
 * 分组列复用 ViewQuery.groupBy（不在 config 中重复存储）。
 * cardFields 列出卡片上额外渲染为小徽章的字段 key（除分组列与 content 标题外），
 * 按字段类型通用绘制（select 带色圆点、date 逾期标红等）。缺省时通用视图用默认集。
 */
export interface BoardConfig {
  viewKind: 'board'
  version: 1
  cardFields?: string[]
}

/**
 * 日历视图布局配置。
 * 按卡片 date_refs 的某一 kind 落格（与卡片数据模型一致），默认 'deadline'。
 */
export interface CalendarConfig {
  viewKind: 'calendar'
  version: 1
  dateRefKind: 'deadline' | 'schedule'
}

/** 视图布局配置判别联合。 */
export type LayoutConfig = TableConfig | BoardConfig | CalendarConfig

/** 按 viewKind 取对应配置类型（辅助，便于 store / 组件按需收窄）。 */
export type ConfigOf<K extends ViewKind> = Extract<LayoutConfig, { viewKind: K }>

/**
 * 表格视图的内建默认列配置，与迁移前硬编码的 7 列布局一致（check→done、其余同名）。
 * 视图未携带 config（持久化层尚未写入 config 字段）时，TableView 回退到此默认。
 * 列 key 对应 Block 字段描述符；role 承载渲染装饰（主文本/链接/截止高亮/完成），
 * 保持组件零任务代码（见 ADR-0005/0006/0007）。
 */
export const DEFAULT_TABLE_CONFIG: TableConfig = {
  viewKind: 'table',
  version: 1,
  columns: [
    { key: 'done', role: 'done' },
    { key: 'content', role: 'primary' },
    { key: 'status' },
    { key: 'priority' },
    { key: 'project' },
    { key: 'deadline', role: 'overdue-date' },
    { key: 'page', role: 'link' },
  ],
}

/**
 * 某 viewKind 的内建默认布局配置。
 * 视图尚未持久化 config（或解析失败回退）时，由 store / 组件取此值。
 */
export function defaultLayoutConfig(kind: ViewKind): LayoutConfig {
  switch (kind) {
    case 'table':
      return DEFAULT_TABLE_CONFIG
    case 'board':
      return { viewKind: 'board', version: 1, cardFields: ['priority', 'deadline'] }
    case 'calendar':
      return { viewKind: 'calendar', version: 1, dateRefKind: 'deadline' }
  }
}

/**
 * 解析视图存储的 config（JSON LayoutConfig）：
 * - 空 / 损坏 → null（调用方回退 defaultLayoutConfig）；
 * - 解析成功但 viewKind 与期望不符 → null（避免错位渲染）。
 */
export function parseLayoutConfig(
  json: string | undefined | null,
  expectedKind: ViewKind,
): LayoutConfig | null {
  if (!json) return null
  try {
    const obj = JSON.parse(json) as LayoutConfig
    if (obj && obj.viewKind === expectedKind && obj.version === 1) return obj
  } catch {
    /* 解析失败回退 null */
  }
  return null
}
