import { TASK_PRIORITY_ICONS, TASK_STATUS_ICONS } from '../components/Icons'
import type { FieldDefinition } from './property'

/**
 * 字段模板实体（Tag）：系统内置与用户自定义共用此类型。
 *
 * - 系统 Tag 为编译期常量（SYSTEM_TAGS，不落库）。
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

/**
 * 系统内置 Tag：内置契约字段的单一来源（ADR-0049 D3）。
 * 新增内置字段只改对应分组一处，定义层（BUILT_IN_PROPERTIES）、
 * 注册层（BUILTIN_KEYS）、渲染层（isSystemField）自动跟随。
 */
export const SYSTEM_TAGS: Tag[] = [
  {
    key: 'system-task',
    title: '系统任务',
    isSystem: true,
    fields: [
      {
        key: 'status',
        title: '状态',
        type: 'string',
        displayPosition: 'between-bullet-content',
        displayStyle: 'icon',
        closedValues: [
          { value: 'Todo', label: '待办', icon: TASK_STATUS_ICONS.Todo },
          { value: 'Doing', label: '进行中', icon: TASK_STATUS_ICONS.Doing },
          { value: 'Done', label: '已完成', icon: TASK_STATUS_ICONS.Done },
          { value: 'Canceled', label: '已取消', icon: TASK_STATUS_ICONS.Canceled },
        ],
      },
      {
        key: 'priority',
        title: '优先级',
        type: 'string',
        displayPosition: 'right-of-content',
        displayStyle: 'icon',
        closedValues: [
          { value: 'Low', label: '低', description: '不紧急不重要', icon: TASK_PRIORITY_ICONS.Low },
          { value: 'Medium', label: '中', description: '重要不紧急', icon: TASK_PRIORITY_ICONS.Medium },
          { value: 'High', label: '高', description: '紧急不重要', icon: TASK_PRIORITY_ICONS.High },
          { value: 'Urgent', label: '急', description: '紧急且重要', icon: TASK_PRIORITY_ICONS.Urgent },
        ],
      },
      {
        key: 'project',
        title: '项目',
        type: 'string',
        displayPosition: 'bottom-of-block',
        displayStyle: 'icon-text',
      },
      {
        key: 'area',
        title: '领域',
        type: 'string',
        displayPosition: 'bottom-of-block',
        displayStyle: 'icon-text',
      },
    ],
  },
  {
    key: 'system-book-note',
    title: '系统书笔记',
    isSystem: true,
    fields: [
      // 书笔记四件套（票 06 / ADR-0040 D3/D7）：阅读器高亮升格为 Block 时写入。
      // book/chapter/quote 展示于 block 属性区（其他端语义：脱离书文件可读）；
      // cfi 是「跳回原文」的数据源，系统属性不渲染（同 language）。
      {
        key: 'book',
        title: '书名',
        type: 'string',
        displayPosition: 'bottom-of-block',
        displayStyle: 'icon-text',
      },
      {
        key: 'part',
        title: '部/卷',
        type: 'string',
        // 系统属性：章节的双层父级，由 PropertyDisplay 紧凑展示，不进入属性列表
      },
      {
        key: 'chapter',
        title: '章节',
        type: 'string',
        displayPosition: 'bottom-of-block',
        displayStyle: 'icon-text',
      },
      {
        key: 'cfi',
        title: '原文锚点',
        type: 'string',
        // 系统属性：不设 displayPosition → 默认不显示（isSystemField 过滤）
      },
      {
        key: 'quote',
        title: '原文',
        type: 'string',
        displayPosition: 'bottom-of-block',
        displayStyle: 'icon-text',
      },
      {
        key: 'sourceBlockId',
        title: '来源块 ID',
        type: 'string',
      },
      {
        key: 'sourcePageId',
        title: '来源页面 ID',
        type: 'string',
      },
      {
        key: 'language',
        title: '语言',
        type: 'string',
        // 系统属性：不设 displayPosition → 默认不显示（isSystemField 过滤）
      },
    ],
  },
]

/** 字段 key → 所属 Tag（未命中即用户自定义字段，返回 undefined）。 */
export function getFieldTag(key: string): Tag | undefined {
  return SYSTEM_TAGS.find((t) => t.fields.some((f) => f.key === key))
}

/** key 是否属于系统内置 Tag（替代字段级 isBuiltIn，见 ADR-0049 D5）。 */
export function isSystemField(key: string): boolean {
  return getFieldTag(key)?.isSystem ?? false
}
