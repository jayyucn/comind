/**
 * 字段特化选项单源（ADR-0057 ②）。
 *
 * 设置弹窗的特化行以分段控制呈现（含「无」档 = 无特化，落库 null）；
 * 选项集封闭（issue T6/T7/T10 的落库值域），键 = 特化族底层类型。
 * spec 首段（head）由此表分派；currency 的参数化后缀（:符号/单位）不在
 * 分段内 —— 单位是独立的级联输入行（parseCurrencySpec 编解码）。
 */
export type SpecFamily = 'string' | 'number' | 'page'

export const FIELD_SPEC_OPTIONS: Record<SpecFamily, { value: string; label: string }[]> = {
  string: [
    { value: '', label: '无' },
    { value: 'email', label: '邮箱' },
    { value: 'phone', label: '电话' },
    { value: 'url', label: '链接' },
    { value: 'richtext', label: '富文本' },
  ],
  number: [
    { value: '', label: '无' },
    { value: 'currency', label: '货币' },
    { value: 'percent', label: '百分比' },
    { value: 'rating', label: '评分' },
  ],
  page: [
    { value: '', label: '无' },
    { value: 'person', label: '负责人' },
  ],
}
