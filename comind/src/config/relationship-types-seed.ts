import type { RelationshipTypeRecord } from '../storage/db'

/**
 * 内置关系类型种子（首启写入 IndexedDB；用户修改后不会被覆盖）。
 * id 命名规则：`rt_seed_<type>`。
 */
export const RELATIONSHIP_TYPES_SEED: Omit<RelationshipTypeRecord, 'id' | 'order'>[] = [
  { type: 'parent',      inverse: 'child',         label: '父级', inverseLabel: '子级',     color: '#1890ff', deleted: false, builtin: true },
  { type: 'depends-on',  inverse: 'required-by',   label: '依赖', inverseLabel: '被依赖',   color: '#faad14', deleted: false, builtin: true },
  { type: 'references',  inverse: 'referenced-by', label: '引用', inverseLabel: '被引用',   color: '#52c41a', deleted: false, builtin: true },
  { type: 'example-of',  inverse: 'has-example',   label: '示例', inverseLabel: '有示例',   color: '#eb2f96', deleted: false, builtin: true },
  { type: 'related',     inverse: null,            label: '相关', inverseLabel: '相关',     color: '#8c8c8c', deleted: false, builtin: true },
  { type: 'similar',     inverse: null,            label: '相似', inverseLabel: '相似',     color: '#722ed1', deleted: false, builtin: true },
]
