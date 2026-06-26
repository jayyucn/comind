// d:\comind\comind\src\types\relationship.ts
import { useRelationshipTypes } from '../composables/useRelationshipTypes'
import type { Strength } from '../storage/db'

export type { Strength }

/** 强度等级到图谱线宽（px）的映射 */
export const STRENGTH_TO_WIDTH: Record<Strength, number> = {
  strong: 2.5,
  medium: 1.5,
  weak: 1
}

/** 关系组（菜单用；正反两条共享一条记录；自反 inverse 为 null） */
export interface RelationshipGroup {
  type: string
  inverse: string | null
  label: string
  inverseLabel: string
  color: string
}

/**
 * 兼容旧 API：返回 type 对应的展示信息。
 * 注：旧 PREDEFINED_RELATIONSHIPS 接口不再导出，因为新数据模型是"成对组"而非"单条记录"。
 */
export interface PredefinedRelationship {
  type: string
  inverse: string | null
  label: string
  inverseLabel: string
  color: string
}

function findByType(type: string): PredefinedRelationship | undefined {
  const all = useRelationshipTypes().all.value
  // 正向/反向都匹配
  const found = all.find(r => r.type === type || r.inverse === type)
  if (!found) return undefined
  const isForward = found.type === type
  return {
    type: found.type,
    inverse: found.inverse,
    label: isForward ? found.label : found.inverseLabel,
    inverseLabel: isForward ? found.inverseLabel : found.label,
    color: found.color
  }
}

export function getPredefinedRelationship(type: string): PredefinedRelationship | undefined {
  return findByType(type)
}

export function getInverseRelationshipType(type: string): string | null {
  const all = useRelationshipTypes().all.value
  const found = all.find(r => r.type === type || r.inverse === type)
  if (!found) return null
  // 正向查询：返回 inverse（自反时 inverse 为 null，回退到自身 type）
  if (found.type === type) return found.inverse ?? found.type
  // 反向查询：返回组的正向 type
  return found.type
}

export function getRelationshipLabel(type: string): string {
  const all = useRelationshipTypes().all.value
  const found = all.find(r => r.type === type || r.inverse === type)
  if (!found) return type
  const isForward = found.type === type
  if (found.deleted) return `${isForward ? found.label : found.inverseLabel} (已删除)`
  return isForward ? found.label : found.inverseLabel
}

export function getRelationshipColor(type: string): string {
  const all = useRelationshipTypes().all.value
  const found = all.find(r => r.type === type || r.inverse === type)
  if (!found) return '#8c8c8c'
  if (found.deleted) return '#bfbfbf'
  return found.color
}

/** 根据 type 反查强度等级；未找到或字段缺失时回退 'medium' */
export function getRelationshipStrength(type: string): Strength {
  const all = useRelationshipTypes().all.value
  const found = all.find(r => r.type === type || r.inverse === type)
  return found?.strength ?? 'medium'
}

/** 根据 type 反查所属组 */
export function getGroupByType(type: string): RelationshipGroup | undefined {
  const items = useRelationshipTypes().items.value
  return items.find(g => g.type === type || g.inverse === type)
}

/** 判断 type 在组里是 forward 还是 inverse；自反为 forward；不存在为 null */
export function getDirectionInGroup(type: string): 'forward' | 'inverse' | null {
  const group = getGroupByType(type)
  if (!group) return null
  if (type === group.type) return 'forward'
  return 'inverse'
}
