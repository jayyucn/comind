/**
 * 通用查询引擎 —— 无头核心入口（不依赖 Vue / Pinia）。
 *
 * 已交付：查询模型类型（#15）、注册表（#15）、操作符派生表（#16）、求值器 v1（#17）。
 * 嵌套组/negate、其余字段类型、排序/分组、序列化、FilterBuilder、业务适配器等由后续工单补齐。
 */
export * from './types'
export * from './registry'
export * from './operators'
export * from './evaluate'
export * from './serialize'
