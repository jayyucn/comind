/**
 * 操作符派生表 —— 无头核心，纯 TS，不依赖 Vue / Pinia。
 *
 * 类型 → 默认操作符集的真源已收编进中央注册表（`types/field-type-registry.ts`，
 * issue #140 F1）；本模块只是引擎侧的查表入口，保留 `DEFAULT_OPS` 导出与
 * {@link deriveOps} 签名不变，供求值器与 FilterBuilder 共用。
 */
import type { FieldDescriptor, FilterOp } from './types'
import { FIELD_TYPE_REGISTRY, fieldTypeSpec } from '../../types/field-type-registry'

/**
 * 各规范类型默认操作符集（中央注册表的引擎侧视图，键为规范联合成员；
 * 旧版键 'text' 已随词汇收口更名 'string'）。
 */
export const DEFAULT_OPS: Record<string, FilterOp[]> = Object.fromEntries(
  Object.entries(FIELD_TYPE_REGISTRY).map(([type, spec]) => [type, [...spec.filterOps]]),
)

/**
 * 派生字段可用操作符集。
 *
 * - 字段声明了 `ops`：以覆盖为准（可扩展或缩减默认集）。
 * - 否则查中央注册表取类型默认集。
 * - 自定义类型（不在注册表中）且未声明 `ops`：返回空数组，
 *   v1 引擎不认识该类型，交由调用方决定（通常该字段尚不可筛选）。
 *
 * 返回的是副本，调用方改动不影响内部映射。
 */
export function deriveOps(descriptor: FieldDescriptor): FilterOp[] {
  return [...(descriptor.ops ?? fieldTypeSpec(descriptor.type).filterOps)]
}
