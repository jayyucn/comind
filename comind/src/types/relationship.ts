export interface PredefinedRelationship {
  type: string
  inverse: string | null
  label: string
  inverseLabel: string
  color: string
}

export const PREDEFINED_RELATIONSHIPS: PredefinedRelationship[] = [
  // 层级关系
  { type: 'parent', inverse: 'child', label: '父级', inverseLabel: '子级', color: '#1890ff' },
  { type: 'child', inverse: 'parent', label: '子级', inverseLabel: '父级', color: '#1890ff' },

  // 依赖关系
  { type: 'depends-on', inverse: 'required-by', label: '依赖', inverseLabel: '被依赖', color: '#faad14' },
  { type: 'required-by', inverse: 'depends-on', label: '被依赖', inverseLabel: '依赖', color: '#faad14' },

  // 引用关系
  { type: 'references', inverse: 'referenced-by', label: '引用', inverseLabel: '被引用', color: '#52c41a' },
  { type: 'referenced-by', inverse: 'references', label: '被引用', inverseLabel: '引用', color: '#52c41a' },

  // 示例关系
  { type: 'example-of', inverse: 'has-example', label: '示例', inverseLabel: '有示例', color: '#eb2f96' },
  { type: 'has-example', inverse: 'example-of', label: '有示例', inverseLabel: '示例', color: '#eb2f96' },

  // 通用关系
  { type: 'related', inverse: 'related', label: '相关', inverseLabel: '相关', color: '#8c8c8c' },
  { type: 'similar', inverse: 'similar', label: '相似', inverseLabel: '相似', color: '#722ed1' },
]

/**
 * 根据类型获取预定义关系
 */
export const RELATIONSHIP_COLORS: Record<string, string> = Object.fromEntries(
  PREDEFINED_RELATIONSHIPS.map(r => [r.type, r.color])
)

export function getPredefinedRelationship(type: string): PredefinedRelationship | undefined {
  return PREDEFINED_RELATIONSHIPS.find(r => r.type === type)
}

/**
 * 获取关系的反向类型
 */
export function getInverseRelationshipType(type: string): string | null {
  const predefined = getPredefinedRelationship(type)
  return predefined?.inverse ?? null
}

/**
 * 获取关系类型对应的中文标签
 */
export function getRelationshipLabel(type: string): string {
  const predefined = getPredefinedRelationship(type)
  return predefined?.label ?? type
}

/**
 * 获取关系类型对应的颜色
 */
export function getRelationshipColor(type: string): string {
  const predefined = getPredefinedRelationship(type)
  return predefined?.color ?? '#8c8c8c'
}