/**
 * 模板系统类型定义
 *
 * TemplateBlock 是模板内容的最小单元，与 Block 解耦——模板不携带 ID/timestamps/pos，
 * 由 TemplateRenderer 在渲染时分配这些字段。
 */

/**
 * 模板块（树形结构）
 *
 * - 'bullet'   → 普通 Block（type='bullet'），content 即为可见文本
 * - 'heading'  → 标题 Block（type='bullet'，format.type='heading'，format.level=headingLevel）
 * - 'property' → 属性 Block（type='property'，content 序列化为 `key:: value`）
 */
export interface TemplateBlock {
  type: 'bullet' | 'heading' | 'property'
  /** 可包含 {{name}} 占位符或 {{date}} 预定义变量 */
  content: string
  /** type=heading 时必填，写入 format.level */
  headingLevel?: 1 | 2 | 3
  /** type=property 时必填，序列化为 `key:: content` */
  propertyKey?: string
  /** 子块 */
  children?: TemplateBlock[]
}

/** 内置模板分类 */
export type BuiltinTemplateCategory = 'thinking-model' | 'work' | 'journal' | 'review'

/** 内置模板（静态 JSON，无存储） */
export interface BuiltinTemplate {
  id: string
  name: string
  aliases?: string[]
  category: BuiltinTemplateCategory
  description: string
  icon: string
  blocks: TemplateBlock[]
}

/** 用户模板（IndexedDB 存储） */
export interface UserTemplate {
  id: string
  name: string
  description?: string
  /** 自由分类字符串，默认 'custom' */
  category: string
  /** 来源页 ID（可追溯；源页删除不影响模板） */
  sourcePageId: string
  blocks: TemplateBlock[]
  createdAt: number
  updatedAt: number
}

/** 模板来源 */
export type TemplateSource = 'builtin' | 'user'

/** 归一化模板（运行时统一抽象） */
export interface NormalizedTemplate {
  id: string
  name: string
  aliases?: string[]
  category: string
  description: string
  icon: string
  source: TemplateSource
  blocks: TemplateBlock[]
}

/**
 * 预定义变量求值上下文
 *
 * 所有字段在 TemplateRenderer.render() 入口处一次性求值。
 * 模板执行过程中，content 字符串内的 {{var}} 会被替换。
 */
export interface TemplateContext {
  /** 本地化日期，例如 "2026年6月5日" */
  date: string
  /** 本地化时间，例如 "14:30" */
  time: string
  /** ISO 日期，例如 "2026-06-05" */
  isoDate: string
  /** 当前页面标题（Page.title） */
  pageTitle: string
  /**
   * 渲染时 `{{cursor}}` 被替换为该字面量；仅第一个出现的占位符最终成为 BlockDraft.cursorMarker。
   */
  cursor: '__CURSOR__'
  /** 剪贴板内容（读取失败时为空字符串） */
  clipboard: string
  /** 当前时间戳（毫秒） */
  now: number
}

/** Block 草稿（渲染产物，待写入 IndexedDB） */
export interface BlockDraft {
  /** 新分配的 Block ID（由 deserializeBlockTree 生成） */
  id: string
  pageId: string
  parentId: string | null
  /** 已计算 pos（基于 anchorBlock 重新分配） */
  pos: number
  /** 已展开变量替换（不再含 {{...}}） */
  content: string
  /**
   * Block 格式元数据
   *
   * 约定：heading 类型写入 `{ type: 'heading', level: 1 | 2 | 3 }`。
   * 与 `Block.format` 类型保持一致以便直接兼容。
   */
  format: Record<string, any>
  type: 'bullet' | 'property' | 'query' | 'embed' | 'code' | 'image'
  properties: Record<string, any>
  /** 来自 {{cursor}} 替换，插入后用于定位光标；仅第一个非 null 的生效 */
  cursorMarker: '__CURSOR__' | null
}
