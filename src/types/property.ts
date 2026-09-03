import { TASK_PRIORITY_ICONS, TASK_STATUS_ICONS } from "../components/Icons"

/**
 * 属性类型
 */
export type PropertyType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'page'

/**
 * 封闭值选项
 */
export interface ClosedValue {
  value: string | number | boolean
  label: string
  description?: string
  icon?: string
}

/**
 * 属性定义（元数据）
 * 全局配置，描述一个属性的元信息
 */
export interface PropertyDefinition {
  key: string
  title: string
  type: PropertyType
  closedValues?: ClosedValue[]
  isBuiltIn?: boolean
  description?: string

  // 新增配置字段
  displayPosition?: 'between-bullet-content' | 'right-of-content' | 'bottom-of-block'
  displayStyle?: 'icon-text' | 'icon' | 'text'
}

/**
 * 属性值映射（类型安全）
 */
export type PropertyValueMap = {
  string: string
  number: number
  boolean: boolean
  date: string
  array: string[]
  page: string
}

export type PropertyValue = PropertyValueMap[PropertyType]

/**
 * 属性实例
 * 存储在数据库中的实际数据
 */
export interface Property<T = PropertyValue> {
  id: string
  blockId: string
  key: string
  value: T
  type: PropertyType
  sortOrder: number
  isHidden: boolean
  isDeleted: boolean
  schemaVersion: number
  createdAt: number
  updatedAt: number
}

/**
 * 属性存储记录（IndexedDB）
 */
export interface PropertyRecord {
  id: string
  blockId: string
  key: string
  value: string
  type: string
  sortOrder: number
  isHidden: number
  isDeleted: number
  schemaVersion: number
  createdAt: number
  updatedAt: number
}

/**
 * 内置属性定义
 */
export const BUILT_IN_PROPERTIES: PropertyDefinition[] = [
  {
    key: 'status',
    title: '状态',
    type: 'string',
    isBuiltIn: true,
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
    isBuiltIn: true,
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
    isBuiltIn: true,
    displayPosition: 'bottom-of-block',
    displayStyle: 'icon-text',
  },
  {
    key: 'area',
    title: '领域',
    type: 'string',
    isBuiltIn: true,
    displayPosition: 'bottom-of-block',
    displayStyle: 'icon-text',
  },
  {
    // 书笔记四件套（票 06 / ADR-0040 D3/D7）：阅读器高亮升格为 Block 时写入。
    // book/chapter/quote 展示于 block 属性区（其他端语义：脱离书文件可读）；
    // cfi 是「跳回原文」的数据源，系统属性不渲染（同 language）。
    key: 'book',
    title: '书名',
    type: 'string',
    isBuiltIn: true,
    displayPosition: 'bottom-of-block',
    displayStyle: 'icon-text',
  },
  {
    key: 'part',
    title: '部/卷',
    type: 'string',
    isBuiltIn: true,
    // 系统属性：章节的双层父级，由 PropertyDisplay 紧凑展示，不进入属性列表
  },
  {
    key: 'chapter',
    title: '章节',
    type: 'string',
    isBuiltIn: true,
    displayPosition: 'bottom-of-block',
    displayStyle: 'icon-text',
  },
  {
    key: 'cfi',
    title: '原文锚点',
    type: 'string',
    isBuiltIn: true,
    // 系统属性：不设 displayPosition → 默认不显示，也不出现在属性列表（PropertyDisplay 过滤）
  },
  {
    key: 'quote',
    title: '原文',
    type: 'string',
    isBuiltIn: true,
    displayPosition: 'bottom-of-block',
    displayStyle: 'icon-text',
  },
  {
    key: 'sourceBlockId',
    title: '来源块 ID',
    type: 'string',
    isBuiltIn: true,
  }, {
    key: 'sourcePageId',
    title: '来源页面 ID',
    type: 'string',
    isBuiltIn: true,
  },
  {
    key: 'language',
    title: '语言',
    type: 'string',
    isBuiltIn: true,
    // 系统属性：不设 displayPosition → 默认不显示，也不出现在属性列表（PropertyDisplay 过滤）
  },
]

/**
 * 获取属性定义
 */
export function getPropertyDefinition(key: string): PropertyDefinition | undefined {
  return BUILT_IN_PROPERTIES.find(p => p.key === key)
}

/**
 * 获取所有属性定义
 */
export function getAllPropertyDefinitions(): PropertyDefinition[] {
  return [...BUILT_IN_PROPERTIES]
}
