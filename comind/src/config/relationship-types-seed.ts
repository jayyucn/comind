import type { RelationshipType } from '../core/types'

/**
 * 内置关系类型种子（首启写入 IndexedDB；用户修改后不会被覆盖）。
 * id 命名规则：`rt_seed_<type>`。
 *
 * strength 分档：
 * - strong（客观关系）：is-a / part-of / depends-on / causes
 * - medium（解释性关系）：uses / supports / contradicts
 * - weak（无法准确归类）：related
 */
export const RELATIONSHIP_TYPES_SEED: Omit<RelationshipType, 'id' | 'order' | 'createdAt' | 'updatedAt'>[] = [
  { type: 'is-a', inverse: 'has-instance', label: '是一个', inverseLabel: '有实例', description: null, color: '#1890ff', group: 'concept', strength: 'strong', deleted: false, builtin: true },
  { type: 'part-of', inverse: 'has-part', label: '属于', inverseLabel: '包含', description: null, color: '#13c2c2', group: 'concept', strength: 'strong', deleted: false, builtin: true },
  { type: 'depends-on', inverse: 'required-by', label: '依赖', inverseLabel: '被依赖', description: null, color: '#f5222d', group: 'concept', strength: 'strong', deleted: false, builtin: true },
  { type: 'uses', inverse: 'used-by', label: '使用', inverseLabel: '被使用', description: null, color: '#eb2f96', group: 'action', strength: 'medium', deleted: false, builtin: true },
  { type: 'causes', inverse: 'caused-by', label: '导致', inverseLabel: '由...导致', description: null, color: '#fa8c16', group: 'action', strength: 'strong', deleted: false, builtin: true },
  { type: 'supports', inverse: 'supported-by', label: '支持', inverseLabel: '被支持', description: null, color: '#52c41a', group: 'work', strength: 'medium', deleted: false, builtin: true },
  { type: 'contradicts', inverse: 'contradicted-by', label: '反驳', inverseLabel: '被反驳', description: null, color: '#722ed1', group: 'work', strength: 'medium', deleted: false, builtin: true },
  { type: 'related', inverse: null, label: '相关', inverseLabel: '相关', description: null, color: '#8c8c8c', group: 'custom', strength: 'weak', deleted: false, builtin: true }
]
