import { TASK_PRIORITY_ICONS, TASK_STATUS_ICONS } from '../components/Icons'
import type { FieldDefinition } from './property'
import seedJson from './systemFieldSeed.json'

/**
 * 字段模板实体（Tag）：系统内置与用户自定义共用此类型。
 *
 * - 系统 Tag 的「字段数据」（key / title / type / 分类 / closed 裸值）单一来源为
 *   `systemFieldSeed.json`（同时驱动 Rust seed，见 ADR-0049 D3 修订 + 2026-09-30 三态模型）。
 *   本文件只承载「UI 展示覆盖层」（displayPosition / displayStyle / 图标 / label），
 *   不再重复字段数据本身——消除 TS 常量与 Rust seed 的双写漂移。
 * - 用户 Tag 落 SQLite 新表 tag（D6 待评审）。
 * - `extends` 继承字段先预留，继承能力另立 ADR（ADR-0049 D8）。
 */
export interface Tag {
  key: string
  title: string
  fields: FieldDefinition[]
  isSystem?: boolean
  extends?: string
}

/** systemFieldSeed.json 的类型契约（仅声明 Rust/TS 共享的字段数据部分）。 */
interface SeedField {
  id: string
  key: string
  title: string
  type: string
  isSystem: boolean
  isPreset: boolean
  closedValues?: string[]
  defaultValue?: string | null
  hideWhen?: string
}
interface SeedTag {
  key: string
  title: string
  isSystem: boolean
  /** 引用顶层 fields 的 id（uuid）；字段定义已独立为顶层配置，tag 仅引用。 */
  fieldIds: string[]
}
interface SeedCatalog {
  /** 顶层字段定义（独立配置；tag 经 fieldIds 引用）。 */
  fields: SeedField[]
  tags: SeedTag[]
}

const seed = seedJson as SeedCatalog

/** 顶层字段定义按 id 建索引，供 tag 经 fieldIds 解析出字段对象。 */
const seedFieldMap = new Map(seed.fields.map((f) => [f.id, f]))

/**
 * 系统内置 Tag 的「UI 展示覆盖层」：仅补展示语义（布局位置 / 风格 / 图标 / label），
 * 不含字段数据（数据来自 systemFieldSeed.json）。key 未列出的字段默认不展示。
 */
type FieldUiOverlay = Partial<
  Pick<FieldDefinition, 'displayPosition' | 'displayStyle' | 'closedValues'>
>

const FIELD_UI: Record<string, FieldUiOverlay> = {
  status: {
    displayPosition: 'between-bullet-content',
    displayStyle: 'icon',
    closedValues: [
      { value: 'Todo', label: '待办', icon: TASK_STATUS_ICONS.Todo },
      { value: 'Doing', label: '进行中', icon: TASK_STATUS_ICONS.Doing },
      { value: 'Done', label: '已完成', icon: TASK_STATUS_ICONS.Done },
      { value: 'Canceled', label: '已取消', icon: TASK_STATUS_ICONS.Canceled },
    ],
  },
  priority: {
    displayPosition: 'right-of-content',
    displayStyle: 'icon',
    closedValues: [
      { value: 'Low', label: '低', description: '不紧急不重要', icon: TASK_PRIORITY_ICONS.Low },
      { value: 'Medium', label: '中', description: '重要不紧急', icon: TASK_PRIORITY_ICONS.Medium },
      { value: 'High', label: '高', description: '紧急不重要', icon: TASK_PRIORITY_ICONS.High },
      { value: 'Urgent', label: '急', description: '紧急且重要', icon: TASK_PRIORITY_ICONS.Urgent },
    ],
  },
  project: { displayPosition: 'bottom-of-block', displayStyle: 'icon-text' },
  area: { displayPosition: 'bottom-of-block', displayStyle: 'icon-text' },
  book: { displayPosition: 'bottom-of-block', displayStyle: 'icon-text' },
  part: {},
  chapter: { displayPosition: 'bottom-of-block', displayStyle: 'icon-text' },
  cfi: {},
  quote: { displayPosition: 'bottom-of-block', displayStyle: 'icon-text' },
  sourceBlockId: {},
  sourcePageId: {},
  language: {},
}

/**
 * 系统内置 Tag：内置契约字段的单一结构来源（ADR-0049 D3 修订）。
 * 字段 key/title/type 由 systemFieldSeed.json 派生，展示层由 FIELD_UI 覆盖。
 * 新增内置字段只改 systemFieldSeed.json 一处，定义层（BUILT_IN_PROPERTIES）、
 * 注册层（BUILTIN_KEYS）、渲染层（isSystemField）自动跟随。
 */
export const SYSTEM_TAGS: Tag[] = seed.tags.map((tag) => ({
  key: tag.key,
  title: tag.title,
  isSystem: tag.isSystem,
  // 经 fieldIds 从顶层 fields 解析出字段对象（字段定义独立后，tag 不再内嵌字段数据）。
  fields: tag.fieldIds
    .map((id) => seedFieldMap.get(id))
    .filter((f): f is SeedField => f !== undefined)
    .map((f) => ({
      key: f.key,
      title: f.title,
      type: f.type as FieldDefinition['type'],
      ...FIELD_UI[f.key],
    })),
}))

/** 字段 key → 所属 Tag（未命中即用户自定义字段，返回 undefined）。 */
export function getFieldTag(key: string): Tag | undefined {
  return SYSTEM_TAGS.find((t) => t.fields.some((f) => f.key === key))
}

/** key 是否属于系统内置 Tag（替代字段级 isBuiltIn，见 ADR-0049 D5）。 */
export function isSystemField(key: string): boolean {
  return getFieldTag(key)?.isSystem ?? false
}
