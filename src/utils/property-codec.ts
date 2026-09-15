/**
 * property-codec —— 属性值的编解码单源（#117，架构评审候选 6）。
 *
 * 契约：DB 里 property.value 恒为字符串；string/page 类型直通存原文，
 * 其余类型（number/boolean/date/array）以 JSON 编码。规则此前散落 4 处
 * （property.ts ×2、useUndoRestore.ts、blocks.ts），且语义组合互不相同
 * （按值/按 type、容错/throw）——本模块收编为单源，裁定「读容错写严格」：
 *
 * - 编码按 **type** 判别（不再按「值是否 string」）：number 属性传字符串
 *   "42" 会存成 "\"42\""，读回类型保真——往返自洽优于静默变型。
 * - 解码按 type 判别 + safeParse 容错：非法 JSON（历史脏数据/外部写入/
 *   sync 端）返回原字符串并 console.warn，读路径永不因脏数据 throw。
 *
 * Rust 侧（batch.rs property set / get）只存取字符串、不解释内容，
 * 解释权全在本模块——见 ADR-0048 的 op 分派边界。
 */
import type { PropertyType } from '../types/property'

/** 直通类型：DB 值即原文，不经 JSON */
const PLAIN_TYPES: ReadonlySet<string> = new Set(['string', 'page'])

/** 判断该 type 是否走 JSON 编解码 */
function isJsonEncoded(type: PropertyType | string): boolean {
  return !PLAIN_TYPES.has(type)
}

/**
 * 内存 PropertyValue → DB 字符串。
 * string/page 直通；其余 JSON.stringify。value 与 type 不符（如 number 型
 * 属性传字符串）时按 type 忠实编码，不做静默变型——由调用方保证传入值
 * 与声明 type 一致。
 */
export function encodePropertyValue(value: unknown, type: PropertyType | string): string {
  if (!isJsonEncoded(type)) {
    return typeof value === 'string' ? value : String(value)
  }
  return JSON.stringify(value)
}

/**
 * DB 字符串 → 内存 PropertyValue。
 * string/page 直通；其余 safeParse：非法 JSON 返回原字符串并 warn（容错，
 * 不 throw——历史脏数据/外部写入不应炸读路径与 setProperty 回读）。
 */
export function decodePropertyValue(str: string, type: PropertyType | string): unknown {
  if (!isJsonEncoded(type)) return str
  try {
    return JSON.parse(str)
  } catch {
    console.warn(`[property-codec] invalid JSON for type=${type}, returning raw string:`, str)
    return str
  }
}
