/**
 * 字段「隐藏」规则单源（ADR-0050 D18）。
 *
 * 规则存字段定义级（`PersistedFieldDefinition.hide_when`，全局共享），作用面 =
 * **块属性展示**（`BlockTagFields.vue`）：符合条件的字段行不渲染。两个消费方：
 * - 标签管理页字段模板的「隐藏」列（下拉编辑 + 只读显示）→ 取值表 / 显示名 / 归一化；
 * - 块级字段区 → `isFieldHiddenByRule` 判定。
 */

/** 落库取值（token 名，与 Rust `FIELD_HIDE_WHEN_VALUES` 逐项对齐；存 token 不存散文）。 */
export const FIELD_HIDE_VALUES = [
  'never',
  'when_empty',
  'when_not_empty',
  'when_default',
  'always',
] as const

export type FieldHideValue = (typeof FIELD_HIDE_VALUES)[number]

/** 下拉显示名（与列头「隐藏」同一话语体系，短词优先——列宽只够四五个字）。 */
export const FIELD_HIDE_LABELS: Record<FieldHideValue, string> = {
  never: '从不',
  when_empty: '为空时',
  when_not_empty: '非空时',
  when_default: '为默认值时',
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
 * 隐藏判定（块属性展示的唯一判据）。入参全部预先算好，本函数保持纯函数可单测：
 *
 * - `hasValue`：该块此字段是否填了值（空串 / 空数组 / 无属性行都算未填）；
 * - `valueString`：已填时的值字符串形态（`String(value)`，数组 join 后再比）；
 * - `defaultString`：定义默认值的字符串形态（`decodeDefaultJson` 的产出）。
 *
 * `when_default` 只在**确有值且等于默认**时隐藏——没填值不算「等于默认」，
 * 否则带默认值的字段会在未填写时整行消失，占位提示（—）也随之丢失。
 */
export function isFieldHiddenByRule(
  hideWhen: string,
  hasValue: boolean,
  valueString: string,
  defaultString: string,
): boolean {
  switch (normalizeHideWhen(hideWhen)) {
    case 'always':
      return true
    case 'when_empty':
      return !hasValue
    case 'when_not_empty':
      return hasValue
    case 'when_default':
      return hasValue && defaultString !== '' && valueString === defaultString
    case 'never':
    default:
      return false
  }
}
