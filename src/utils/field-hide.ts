/**
 * 字段「隐藏」规则单源（ADR-0050 D18）。
 *
 * 规则存字段定义级（`PersistedFieldDefinition.hide_when`，全局共享），作用面 =
 * **块属性展示**（`BlockFieldZone.vue`）：符合条件的字段行不渲染。两个消费方：
 * - 标签管理页字段模板的「隐藏」列（下拉编辑 + 只读显示）→ 取值表 / 显示名 / 归一化；
 * - 块级字段区 → `isFieldHiddenByRule` 判定。
 */

/** 落库取值（token 名，与 Rust `FIELD_HIDE_WHEN_VALUES` 逐项对齐；存 token 不存散文）。 */
export const FIELD_HIDE_VALUES = [
  'never',
  'when_empty',
  'when_not_empty',
  'when_default',
  'when_unset_or_default',
  'always',
] as const

export type FieldHideValue = (typeof FIELD_HIDE_VALUES)[number]

/** 下拉显示名（与列头「隐藏」同一话语体系，短词优先——列宽只够四五个字）。 */
export const FIELD_HIDE_LABELS: Record<FieldHideValue, string> = {
  never: '从不',
  when_empty: '为空时',
  when_not_empty: '非空时',
  when_default: '为默认值时',
  when_unset_or_default: '未填或为默认时',
  always: '总是',
}

/** 下拉选项（保持语义顺序：从不 → 条件 → 总是）。 */
export const FIELD_HIDE_OPTIONS = FIELD_HIDE_VALUES.map((value) => ({
  value,
  label: FIELD_HIDE_LABELS[value],
}))

/**
 * 白名单归一：缺失 / 空串 / 白名单外的脏值一律回落 `never`。
 * 与 Rust `normalize_hide_when` 同判据 —— 两端任何一端放行了脏值，另一端也会拦住。
 */
export function normalizeHideWhen(value: string | null | undefined): FieldHideValue {
  return (FIELD_HIDE_VALUES as readonly string[]).includes(value ?? '')
    ? (value as FieldHideValue)
    : 'never'
}

/** 默认值 JSON 文本 → 参与比较的字符串（与 TagsLibrary.decodeDefault 同形）；无默认 → 空串。 */
export function decodeDefaultJson(jsonText: string | null | undefined): string {
  if (!jsonText) return ''
  try {
    const v = JSON.parse(jsonText)
    return v == null ? '' : String(v)
  } catch {
    return ''
  }
}

/**
 * 输入草稿 → default_value 落库形态（JSON 文本）；空串 / 非法数字 → null（即「无默认」）。
 *
 * 与 decodeDefaultJson 构成 default_value 的一对编解码单源（ADR-0057 D5 草稿+保存）。
 * 注意形态契约与 field-value-codec（FieldValue）相反：default_value 恒为 JSON 文本
 * （string 也要包裹成 '"李四"'），读侧 decodeDefaultJson 对非 JSON 文本静默丢弃——
 * 写侧直通原文会让默认值失效（FieldSettingsModal 曾直通落库，实证）。
 */
export function encodeDefaultJson(type: string, raw: string): string | null {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return null
  if (type === 'number') {
    const n = Number(trimmed)
    return Number.isNaN(n) ? null : JSON.stringify(n)
  }
  if (type === 'boolean') {
    return trimmed === 'true' ? 'true' : trimmed === 'false' ? 'false' : null
  }
  return JSON.stringify(trimmed)
}

/** 值是否为空：null / undefined / 空串 / 空数组。 */
function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
}

/** 布尔归一（兼容落库的 'true' / 'false' 字符串）。 */
function toBoolish(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  return String(v).trim().toLowerCase() === 'true'
}

/**
 * 日期 / 时间字符串 → 时间戳；解析失败返回 null（调用方回落字符串比较）。
 * 空格形替成 `T` 再解析——`new Date('yyyy-MM-dd HH:mm')` 在 Safari 恒 NaN。
 */
function toTimestamp(v: unknown): number | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  const iso = s.includes(' ') ? s.replace(' ', 'T') : s
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : t
}

/** relation 值取 targetId（内存形态为 `{ targetId, relationshipTypeId }`）。 */
function relationId(v: unknown): string {
  if (v && typeof v === 'object') {
    const id = (v as { targetId?: unknown }).targetId
    return id == null ? '' : String(id)
  }
  return v == null ? '' : String(v)
}

/**
 * 值语义相等（替代字符串裸比）。按类型归一后再比：
 * - array / multiSelect：忽略顺序按集合比；
 * - number：数值比（`'8.0'` == `8`）；
 * - boolean：布尔归一（`'true'` == `true`）；
 * - date / datetime：解析成时间戳比（失败回落字符串）；
 * - relation：比 targetId；
 * - 其余：字符串严格比。
 */
export function valuesEqual(a: unknown, b: unknown, type: string): boolean {
  const aEmpty = isEmptyValue(a)
  const bEmpty = isEmptyValue(b)
  if (aEmpty || bEmpty) return aEmpty && bEmpty

  if (type === 'array' || type === 'multiSelect') {
    const aa = Array.isArray(a) ? a : [a]
    const bb = Array.isArray(b) ? b : [b]
    if (aa.length !== bb.length) return false
    const sa = aa.map((x) => String(x)).sort()
    const sb = bb.map((x) => String(x)).sort()
    return sa.every((x, i) => x === sb[i])
  }
  if (type === 'number') {
    const na = Number(a)
    const nb = Number(b)
    return !Number.isNaN(na) && !Number.isNaN(nb) && na === nb
  }
  if (type === 'boolean') {
    return toBoolish(a) === toBoolish(b)
  }
  if (type === 'date' || type === 'datetime') {
    const ta = toTimestamp(a)
    const tb = toTimestamp(b)
    if (ta !== null && tb !== null) return ta === tb
    return String(a) === String(b)
  }
  if (type === 'relation') {
    return relationId(a) === relationId(b)
  }
  return String(a) === String(b)
}

/**
 * 值是否等于定义默认值。`defaultJson` 是落库的 `default_value`（JSON 文本）；
 * 无默认（null / 空串）或非法 JSON → 恒 false（「无默认的定义永不命中」）。
 */
export function isDefaultValue(
  value: unknown,
  defaultJson: string | null | undefined,
  type: string,
): boolean {
  if (defaultJson == null || defaultJson === '') return false
  let parsed: unknown
  try {
    parsed = JSON.parse(defaultJson)
  } catch {
    return false
  }
  if (parsed === null || parsed === undefined) return false
  return valuesEqual(value, parsed, type)
}

/**
 * 隐藏判定（块属性展示的唯一判据）。入参全部预先算好，本函数保持纯函数可单测：
 *
 * - `hasValue`：该块此字段是否填了值（空串 / 空数组 / 无属性行都算未填）；
 * - `value`：已填时的**解码原值**（不是字符串——语义比较需要类型信息）；
 * - `defaultJson`：定义默认值的落库 JSON 文本（`default_value` 原样）；
 * - `type`：字段类型（`valuesEqual` 的类型分派依据）。
 *
 * `when_default` 只在**确有值且等于默认**时隐藏——没填值不算「等于默认」，
 * 否则带默认值的字段会在未填写时整行消失，占位提示（—）也随之丢失。
 * `when_unset_or_default` 是上述语义的补集：未填**或**等于默认都隐藏，
 * 用于「只在有非默认真值时才显示」的场景（只读字段尤甚）。
 */
export function isFieldHiddenByRule(
  hideWhen: string,
  hasValue: boolean,
  value: unknown,
  defaultJson: string | null | undefined,
  type: string,
): boolean {
  switch (normalizeHideWhen(hideWhen)) {
    case 'always':
      return true
    case 'when_empty':
      return !hasValue
    case 'when_not_empty':
      return hasValue
    case 'when_default':
      return hasValue && isDefaultValue(value, defaultJson, type)
    case 'when_unset_or_default':
      return !hasValue || isDefaultValue(value, defaultJson, type)
    case 'never':
    default:
      return false
  }
}
