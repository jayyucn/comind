/**
 * 属性类型
 */
export type PropertyType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'array' | 'page'

/**
 * 封闭值选项
 */
export interface ClosedValue {
  value: string | number | boolean
  label: string
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
}

/**
 * 属性值映射（类型安全）
 */
export type PropertyValueMap = {
  string: string
  number: number
  boolean: boolean
  date: string
  datetime: string
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
    closedValues: [
      { value: 'Todo', label: '待办', icon: '📋' },
      { value: 'Doing', label: '进行中', icon: '🔄' },
      { value: 'Done', label: '已完成', icon: '✅' },
      { value: 'Canceled', label: '已取消', icon: '❌' },
    ],
  },
  {
    key: 'priority',
    title: '优先级',
    type: 'string',
    isBuiltIn: true,
    closedValues: [
      { value: 'Low', label: '低', icon: '🟢' },
      { value: 'Medium', label: '中', icon: '🟡' },
      { value: 'High', label: '高', icon: '🟠' },
      { value: 'Urgent', label: '紧急', icon: '🔴' },
    ],
  },
  {
    key: 'deadline',
    title: '截止日期',
    type: 'date',
    isBuiltIn: true,
  },
  {
    key: 'tags',
    title: '标签',
    type: 'array',
    isBuiltIn: true,
  },
  {
    key: 'project',
    title: '项目',
    type: 'string',
    isBuiltIn: true,
  },
  {
    key: 'area',
    title: '领域',
    type: 'string',
    isBuiltIn: true,
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
