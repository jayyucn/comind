/**
 * 字段展示形态解析单源（ADR-0050 D21 决策 1 / 5 / 6）。
 *
 * 块字段区的每个字段按「展示形态」渲染，解析优先级：
 *   1. 用户逐字段覆盖 `display_form_override`（持久化列，仅用户字段可配——系统字段
 *      不可配，见 D21 决策 6）；非 `auto` 时胜过一切。
 *   2. 编译期覆盖层 `displayStyle`（系统字段的定死通道，`types/field-definition.ts`）。
 *   3. 类型 → 默认形态映射（D21 决策 1）：选项型（枚举）/ date / array / page /
 *      number → `chip`（胶囊家族，number 的徽章、date 的日期胶囊、page 的引用 chip
 *      都是该形态下按类型加修饰类的渲染细节）；boolean → `icon`（值即 ✓/✗）；
 *      纯 string → `text`（「标题: 值」文字，现状兜底）。
 *
 * 输入吃双轨定义形：持久化形（`PersistedFieldDefinition`，`closed_values: string[]`）
 * 与编译期形（`FieldDefinition`，`closedValues: ClosedValue[]`）——用可选字段的结构化
 * 判定兼容两者，不做类型转换层。
 *
 * chip 底色一律中性 surface token；色环只留给 tag 一家（D21 决策 5）。
 */
import { fieldTypeSpec } from '../types/field-type-registry'

/** 用户可逐字段选择的形态取值空间（封闭枚举，D21 决策 5） */
export const DISPLAY_FORM_OVERRIDES = ['auto', 'icon', 'icon-text', 'text', 'chip'] as const

/** 用户覆盖值类型；`auto` = 跟随类型默认映射 */
export type DisplayFormOverride = (typeof DISPLAY_FORM_OVERRIDES)[number]

/** 解析后的形态种类（渲染分派依据） */
export type DisplayFormKind = Exclude<DisplayFormOverride, 'auto'>

/** 解析输入：持久化形 / 编译期形定义的公共切面（两轨字段名都收） */
export interface DisplayFormSource {
  type: string
  /** 持久化形的选项列表（非空 = 选项型） */
  closed_values?: string[] | null
  /** 编译期形的选项列表（非空 = 选项型） */
  closedValues?: unknown[] | null
  /** 用户逐字段覆盖（持久化列；缺省 / 空 / 非法 = auto） */
  display_form_override?: string | null
  /** 编译期展示形态（系统字段定死通道） */
  displayStyle?: 'icon-text' | 'icon' | 'text'
}

/**
 * 类型 → 默认形态映射（D21 决策 1）。
 *
 * 类型默认形态的真源是中央注册表（`types/field-type-registry.ts`，issue #140 F1）；
 * 本函数保留 `isOptionType` 参数以兼容旧词汇「string + closedValues 即选项型」——
 * 枚举在规范词汇下已是 select / multiSelect，但存量定义仍可能以 string+closedValues
 * 声明，两者都归 chip 家族。
 *
 * @param type 字段类型（规范 FieldType 或未知类型——未知按注册表回落 text）
 * @param isOptionType 是否选项型（closed_values 非空）
 */
export function typeDefaultForm(type: string, isOptionType: boolean): DisplayFormKind {
  if (isOptionType) return 'chip'
  return fieldTypeSpec(type).displayForm
}

/** 覆盖值归一：取值空间外的输入（含空串 / null / 非字符串）一律回落 auto */
export function normalizeDisplayFormOverride(value: unknown): DisplayFormOverride {
  return (DISPLAY_FORM_OVERRIDES as readonly unknown[]).includes(value)
    ? (value as DisplayFormOverride)
    : 'auto'
}

/** 选项型判定：持久化形或编译期形任一有非空选项即成立 */
function isOptionTypeDef(def: DisplayFormSource): boolean {
  return (def.closed_values?.length ?? 0) > 0 || (def.closedValues?.length ?? 0) > 0
}

/**
 * 形态解析单源：override（非 auto）> displayStyle > 类型默认。
 * 系统字段没有 override 通路（配置面只读，D21 决策 6），其形态由
 * `displayStyle` 或类型映射定死——两者都属于「编译期定死」语义。
 */
export function resolveDisplayForm(def: DisplayFormSource): DisplayFormKind {
  const override = normalizeDisplayFormOverride(def.display_form_override)
  if (override !== 'auto') return override
  if (def.displayStyle) return def.displayStyle
  return typeDefaultForm(def.type, isOptionTypeDef(def))
}
