/**
 * field-value-codec —— 字段值的编解码单源（#117，架构评审候选 6）。
 *
 * 契约：DB 里 field_value.value_json 恒为字符串；string/page 类型直通存原文，
 * 其余类型（number/boolean/date/array）以 JSON 编码。规则此前散落 4 处
 * （field-value.ts ×2、useUndoRestore.ts、blocks.ts），且语义组合互不相同
 * （按值/按 type、容错/throw）——本模块收编为单源，裁定「读容错写严格」：
 *
 * - 编码按 **type** 判别（不再按「值是否 string」）：number 字段传字符串
 *   "42" 会存成 "\"42\""，读回类型保真——往返自洽优于静默变型。
 * - 解码按 type 判别 + safeParse 容错：非法 JSON（历史脏数据/外部写入/
 *   sync 端）返回原字符串并 console.warn，读路径永不因脏数据 throw。
 *
 * Rust 侧（batch.rs field_value set / get）只存取字符串、不解释内容，
 * 解释权全在本模块——见 ADR-0048 的 op 分派边界。
 */
import type { FieldType } from '../types/field-definition'

/**
 * 直通类型：DB 值即原文，不经 JSON。
 * select（选项 id）/ datetime（yyyy-MM-dd HH:mm）值本身即字符串，与 string 同待遇
 * （issue #140 F1 收口新增，无存量行故无迁移）；multiSelect 值为数组，走 JSON。
 * 注意 date **不在**直通之列：既有 date 行已按 JSON 形落库（'"2026-09-15"'），
 * 改直通会破坏存量读路径——date/datetime 的存储形态不对称是历史兼容的有意取舍。
 */
const PLAIN_TYPES: ReadonlySet<string> = new Set(['string', 'page', 'select', 'datetime'])

/** 判断该 type 是否走 JSON 编解码 */
function isJsonEncoded(type: FieldType | string): boolean {
  return !PLAIN_TYPES.has(type)
}

/**
 * 内存 FieldValueData → DB 字符串。
 * string/page 直通；其余 JSON.stringify。value 与 type 不符（如 number 型
 * 字段传字符串）时按 type 忠实编码，不做静默变型——由调用方保证传入值
 * 与声明 type 一致。
 */
export function encodeFieldValueData(value: unknown, type: FieldType | string): string {
  if (!isJsonEncoded(type)) {
    return typeof value === 'string' ? value : String(value)
  }
  return JSON.stringify(value)
}

/**
 * DB 字符串 → 内存 FieldValueData。
 * string/page 直通；其余 safeParse：非法 JSON 返回原字符串并 warn（容错，
 * 不 throw——历史脏数据/外部写入不应炸读路径与 setFieldValue 回读）。
 */
export function decodeFieldValueData(str: string, type: FieldType | string): unknown {
  if (!isJsonEncoded(type)) return str
  try {
    return JSON.parse(str)
  } catch {
    console.warn(`[field-value-codec] invalid JSON for type=${type}, returning raw string:`, str)
    return str
  }
}
