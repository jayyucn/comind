/**
 * 操作符派生表 —— 无头核心，纯 TS，不依赖 Vue / Pinia。
 *
 * 类型 → 默认操作符集的真源已收编进中央注册表（`types/field-type-registry.ts`，
 * issue #140 F1）；本模块只是引擎侧的查表入口，保留 {@link getDefaultOps} 与
 * {@link deriveOps} 签名不变，供求值器与 FilterBuilder 共用。
 */
import { FIELD_TYPE_REGISTRY, fieldTypeSpec } from '../../types/field-type-registry'
import type { FieldDescriptor, FilterOp } from './types'

/**
 * 各规范类型默认操作符集（中央注册表的引擎侧视图，键为规范联合成员；
 * 旧版键 'text' 已随词汇收口更名 'string'）。
 *
 * **必须惰性构建**：生产包里本模块与 `field-type-registry` 会落在不同的 chunk，
 * 而 wasm 那条动态导入链让共享 chunk 带上 top-level await（vite-plugin-top-level-await
 * 把 TLA 折叠成导出的 `__tla` promise）。打包后模块求值顺序不再保证注册表已赋值，
 * 若在模块顶层就 `Object.entries(FIELD_TYPE_REGISTRY)`，会拿到 undefined 并抛
 * `Cannot convert undefined or null to object`，整张模块图求值失败 → 应用白屏。
 * 首次访问时再建表即可绕开：交互期 TLA 早已完成。
 *
 * @see tests `operators.test.ts` 的「模块求值期不解引用注册表」用例
 */
let defaultOpsCache: Record<string, FilterOp[]> | null = null

/** 取各规范类型的默认操作符集（首次调用时构建，之后复用同一实例）。 */
export function getDefaultOps(): Record<string, FilterOp[]> {
  if (defaultOpsCache) return defaultOpsCache
  defaultOpsCache = Object.fromEntries(
    Object.entries(FIELD_TYPE_REGISTRY).map(([type, spec]) => [type, [...spec.filterOps]]),
  )
  return defaultOpsCache
}

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
