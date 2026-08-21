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
 * 按已注册的 date 类型字段 key 落格（CalendarView 动态查找该字段取值入桶）。
 * Block 内置 'deadline' | 'schedule'（date_refs 的 kind）；Page 等实体可用自己的 date 字段
 * （如 'updatedAt'），dateRefKind 不再限死字面量（ADR-0023 D6 修订）。
 */
export interface CalendarConfig {
  viewKind: 'calendar'
  version: 1
  dateRefKind: string
}

/** 视图布局配置判别联合。 */
export type LayoutConfig = TableConfig | BoardConfig | CalendarConfig

/** 按 viewKind 取对应配置类型（辅助，便于 store / 组件按需收窄）。 */
export type ConfigOf<K extends ViewKind> = Extract<LayoutConfig, { viewKind: K }>

/**
 * 解析视图存储的 config（JSON LayoutConfig）：
 * - 空 / 损坏 → null（调用方回退实体注册点提供的默认布局，如 BLOCK_DEFAULT_* 或 PAGE_DEFAULT_*，见 ADR-0023）；
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
