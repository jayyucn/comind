/**
 * 数值特化族的展示格式化与约束纯函数（issue T7：currency / percent / rating）。
 *
 * 特化标记存于字段定义 `spec`（T6 引入的 `spec?: string`；'currency' | 'percent' |
 * 'rating'），底层类型仍为 'number'——不扩 FieldType 联合。本模块 headless 纯函数，
 * 供 BlockFieldZone 展示分派与字段管理面板配置消费。
 *
 * currency spec 语法（最小路径：编码进 spec 字符串本身，无需新持久化列）：
 *   'currency'               → 默认符号 ¥（中文环境惯例），无单位
 *   'currency:<symbol>'      → 自定义符号（如 'currency:$'）
 *   'currency:<symbol>/<unit>' → 自定义符号 + 后置单位（如 'currency:¥/元'）
 */

/** 默认货币符号（中文环境惯例） */
export const DEFAULT_CURRENCY_SYMBOL = '¥'

/** 货币格式：符号前置 + 单位后置 */
export interface CurrencyFormat {
  symbol: string
  unit: string
}

/** 解析 currency spec → { symbol, unit }；非 currency spec / 空值回落默认 ¥。 */
export function parseCurrencySpec(spec: string | null | undefined): CurrencyFormat {
  const raw = (spec ?? '').trim()
  if (!raw.startsWith('currency')) return { symbol: DEFAULT_CURRENCY_SYMBOL, unit: '' }
  const body = raw.slice('currency'.length)
  const [symbol = '', unit = ''] = body.startsWith(':') ? body.slice(1).split('/') : []
  return { symbol: symbol || DEFAULT_CURRENCY_SYMBOL, unit }
}

/** 货币展示格式化：符号前置 + 数值 + 单位后置（¥42 / 42元 / $42）。非有限数回落空串。 */
export function formatCurrency(value: number, format: CurrencyFormat = { symbol: DEFAULT_CURRENCY_SYMBOL, unit: '' }): string {
  const num = Number.isFinite(value) ? String(value) : ''
  return `${format.symbol}${num}${format.unit}`
}

/**
 * number 字段的有效约束界：spec 为 percent 时默认 min=0 / max=100
 * （复用 ADR-0055 的 min/max 通道，不改其机制；用户显式配置的界优先，
 * null/undefined 才落默认）；其余 spec 原样透传（null 归一）。
 */
export function effectiveNumberBounds(
  spec: string | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined,
): { min: number | null; max: number | null } {
  if (spec !== 'percent') return { min: min ?? null, max: max ?? null }
  return { min: min ?? 0, max: max ?? 100 }
}
