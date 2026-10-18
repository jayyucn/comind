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

/**
 * 用户可逐字段选择的形态取值空间（封闭枚举，D21 决策 5 + 通用只读扩展）。
 * `readonly` = 纯展示形态：跨类型把值渲染为静态可读文字（不挂输入框 / 内联编辑器，
 * 整行不可点），字段区锁定不可编辑（值仍可经外部/SQL 写入）。仅用户可编辑字段可配，
 * 系统字段下拉本就禁用。
 */
export const DISPLAY_FORM_OVERRIDES = ['auto', 'icon', 'icon-text', 'text', 'chip', 'switch', 'readonly'] as const

/** 用户覆盖值类型；`auto` = 跟随类型默认映射 */
export type DisplayFormOverride = (typeof DISPLAY_FORM_OVERRIDES)[number]

/** 解析后的形态种类（渲染分派依据） */
export type DisplayFormKind = Exclude<DisplayFormOverride, 'auto'>

/** 各展示形态的中文 label（设置页下拉、提示文案共用）。 */
export const FORM_LABELS: Record<DisplayFormOverride, string> = {
  auto: '跟随类型',
  icon: '图标',
  'icon-text': '图标+文字',
  text: '文字',
  chip: '胶囊',
  switch: '开关',
  readonly: '只读',
}

/**
 * 内建图标键 → 图标字符（与 BlockFieldZone.getIcon 同源；命中即产出该字符）。
 * 这些键（tags/project/area/book/chapter/quote）在渲染侧 `getIcon` 直接产出图标，
 * 属「有图标来源」的类型；与布尔 ✓/✗、系统 status/priority 的编译期 closedValues
 * 图标并列，但此处只收「键驱动」子集——系统字段只读、展示形态下拉不可达。
 */
export const ICON_CHARS: ReadonlyMap<string, string> = new Map([
  ['tags', '🏷️'],
  ['project', '📁'],
  ['area', '🌐'],
  ['book', '📖'],
  ['chapter', '📄'],
  ['quote', '❝'],
])

/**
 * 字段是否「有图标来源」——即 icon / icon-text 展示形态对其有意义。
 * 判定：布尔（值即 ✓/✗）或内建图标键（ICON_CHARS）。
 * 用途：设置页据此收敛展示形态下拉，避免对无图标来源的字段给出不可达的
 * icon / icon-text 死选项（评估纪要：自建 select/multiSelect 暂不带图标）。
 */
export function fieldHasIconSource(def: { type: string; key?: string | null }): boolean {
  return def.type === 'boolean' || (def.key != null && ICON_CHARS.has(def.key))
}

/**
 * 展示形态下拉按字段类型配置（评估纪要 + 用户裁定：枚举选项随字段类型走）。
 * 每种类型只给有意义、可达的形态，避免不可达死选项：
 * - boolean：勾叉（icon，✓/✗）/ 开关（switch，开关 UI）/ 文字（是/否）/ 跟随类型
 * - 有图标来源（status/priority 系统字段、tags/project 等内建键）：图标 / 图标+文字 /
 *   胶囊 / 文字 / 跟随类型
 * - 枚举（select/multiSelect）：胶囊 / 文字 / 跟随类型
 * - 其余（string/number/date/...）：文字 / 跟随类型
 */
export function displayFormOptionsFor(opts: {
  type: string
  key?: string | null
}): { value: DisplayFormOverride; label: string }[] {
  const auto = { value: 'auto' as const, label: FORM_LABELS.auto }
  const readonly = { value: 'readonly' as const, label: FORM_LABELS.readonly }
  if (opts.type === 'boolean') {
    return [
      auto,
      { value: 'icon', label: '勾叉' },
      { value: 'switch', label: FORM_LABELS.switch },
      { value: 'text', label: FORM_LABELS.text },
      readonly,
    ]
  }
  if (fieldHasIconSource(opts)) {
    return [
      auto,
      { value: 'icon', label: FORM_LABELS.icon },
      { value: 'icon-text', label: FORM_LABELS['icon-text'] },
      { value: 'text', label: FORM_LABELS.text },
      { value: 'chip', label: FORM_LABELS.chip },
      readonly,
    ]
  }
  if (opts.type === 'select' || opts.type === 'multiSelect') {
    return [auto, { value: 'chip', label: FORM_LABELS.chip }, { value: 'text', label: FORM_LABELS.text }, readonly]
  }
  return [auto, { value: 'text', label: FORM_LABELS.text }, readonly]
}

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
