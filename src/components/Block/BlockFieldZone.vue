<script setup lang="ts">
/**
 * 块字段区渲染载体（ADR-0050 D1「挂载即显示」＋ ADR-0051 D6 职责全迁 + D21 形态体系）。
 *
 * 命名（D21 实施，2026-10-08）：原 `BlockTagFields` 更名为 `BlockFieldZone`——
 * Tag 在字段模型里只承担「聚合字段」的角色（模板声明 + 有效字段并集解析），
 * 本组件渲染的是**块的（聚合后）字段**，与 tag 本体无关。
 *
 * 单一载体承载块字段值的全部渲染位：
 * - `between`：bullet 与内容之间的内联槽（如 status 任务图标）
 * - `right`：内容行尾内联槽（priority 象限网格图标，ADR-0054 D3）
 * - `book-note`：书笔记来源行（Pin + 章节 + 原文引用）
 * - `all`：完整字段列表（Backlinks 等）
 * - `list`：content 下方「挂载即显示」的块字段区（含空占位、隐藏规则）
 *
 * 块上每个字段值有且只有一个权威展示位（ADR-0050 D19 / D20）：行内 chips 列已下线，
 * 块内字段展示统一由 `list` 承担——它按标签模板驱动、标题取自持久化定义。
 *
 * **D21 形态体系**：`list` / `all` 共用同一形态注册表（`utils/field-display-form.ts`），
 * 每字段按「用户覆盖 > 编译期 displayStyle > 类型默认映射」解析形态
 * （chip / icon / icon-text / text）；chip 形态无值出虚线 ghost 胶囊（点击即录入），
 * `hide_when` 规则命中优先于一切形态（D21 决策 1/5/7/9）。
 *
 * `list` 变体以**标签本位为主、孤儿值兜底**：字段集合 = 该块已挂标签的有效字段并集
 * （解析单源在 Rust：`effective_field_ids`）∪ 孤儿字段（块上已有值、但其 key 不在
 * 任何已挂标签的有效字段并集中——删 tag / 去 tag 后悬空保留的值，弱区分样式标注
 * 以断链图标（Unlink）标注「未关联标签」仍可见可编辑）；其余变体沿用「块上已有字段值行 → 按字段定义渲染」的口径。
 * 该集合的**推导单源已抽到 `./composables/useBlockFieldRows`**（Block/index.vue 的折叠守卫
 * 消费同一份，两处零漂移）——本组件只按集合逐行渲染形态。
 *
 * 值读写走 fieldValue store；行内存储形态是库内 `FieldValue` 原形，读取端统一经
 * `decodeFieldValueData` 还原内存值（`useBlockFieldRows` 的 `dataOf`）。
 */
import { Pin, Unlink } from 'lucide-vue-next'
import { computed, nextTick, onMounted, ref, toRef } from 'vue'

import { useNavigateToPage } from '../../composables/useNavigateToPage'
import { openReaderWindow } from '../../composables/useReaderWindow'
import { useBlockStore } from '../../stores/blocks'
import { useEditorStore } from '../../stores/editor'
import { useFieldValueStore } from '../../stores/fieldValue'
import { usePageStore } from '../../stores/pages'
import { useTagsStore } from '../../stores/tags'
import type { FileRefValue, RelationRefValue } from '../../types/field-definition'
import { numberSpecialization, pageSpecialization, specHeadOf, stringSpecialization } from '../../types/field-type-registry'
import type { FieldValue } from '../../types/field-value'
import { isSystemField } from '../../types/tag'
import type { PersistedFieldDefinition } from '../../types/tag-persisted'
import { type DisplayFormKind, ICON_CHARS, resolveDisplayForm, typeDefaultForm } from '../../utils/field-display-form'
import { effectiveNumberBounds, formatCurrency, parseCurrencySpec } from '../../utils/field-number-format'
import { displayFieldType } from '../../utils/field-type-icons'
import { safeEvaluateFormula } from '../../utils/formula'
import { renderInlineMarkdown, toExternalHref } from '../../utils/mini-markdown'
import { isTagColorToken,TAG_COLORS } from '../../utils/tag-color'
import { isTauriEnvironment } from '../../wasm/tauri-platform'
import BooleanCheck, { type BooleanCheckValue } from '../common/BooleanCheck.vue'
import DatePicker, { type DatePickerValue } from '../common/DatePicker.vue'
import DateRangePicker, { type DateRangePickerValue } from '../common/DateRangePicker.vue'
import DateTimePicker from '../common/DateTimePicker.vue'
import EnumSelect, { type EnumOption, type EnumSelectValue } from '../common/EnumSelect.vue'
import FieldLabel from '../common/FieldLabel.vue'
import FileRefEditor from '../common/FileRefEditor.vue'
import MultiEnumSelect from '../common/MultiEnumSelect.vue'
import NumberInput, { type NumberInputValue } from '../common/NumberInput.vue'
import PageRefPicker from '../common/PageRefPicker.vue'
import RatingInput from '../common/RatingInput.vue'
import RelationRefEditor from '../common/RelationRefEditor.vue'
import SpecializedText from '../common/SpecializedText.vue'
import TextField, { type TextFieldValue } from '../common/TextField.vue'
import { Icon } from '../Icons'
import { dataOf, defOf, useBlockFieldRows } from './composables/useBlockFieldRows'

const props = withDefaults(defineProps<{
  blockId: string
  /** 该块已挂的 tag id（来自 Block.tags 派生缓存）；仅 `list` 变体消费。 */
  tagIds?: string[]
  variant?: 'between' | 'right' | 'book-note' | 'all' | 'list'
}>(), {
  tagIds: () => [],
  variant: 'list',
})

const tagsStore = useTagsStore()
const fieldValueStore = useFieldValueStore()
const editorStore = useEditorStore()
const blockStore = useBlockStore()
const pageStore = usePageStore()
const { navigateToPage } = useNavigateToPage()

onMounted(() => {
  if (props.variant !== 'list') return
  // 幂等：标签树未加载时补一次（块可能在标签页未访问过的会话里直接渲染）
  void tagsStore.ensureLoaded()
})

// ── 字段值行集合（单源：./composables/useBlockFieldRows）──────
// `rows` / `fields` / `orphanKeySet` / `rawValueOf` / `hasStatusValue` / `persistedDefOf`
// 全部出自该 composable——**它同时是 Block/index.vue 折叠守卫的数据源**，两处同源 ⇒
// 「能折叠」与「折叠下去藏了什么」零漂移。此前的 `tags.length` 代理已废弃。
// `dataOf` / `defOf` 是模块级纯函数（解码内存值 / 反查编译期定义），从同一处引入。
const {
  rows,
  persistedDefOf,
  rawValueOf,
  hasStatusValue,
  orphanKeySet,
  fields,
} = useBlockFieldRows(toRef(props, 'blockId'), toRef(props, 'tagIds'))

/** 按 displayPosition 取行（内联槽用） */
function rowsAt(position: string): FieldValue[] {
  return rows.value.filter((fv) => defOf(fv.key)?.displayPosition === position)
}

/**
 * 内联槽行，按变体分流：`between` = bullet 与内容之间（status 任务图标）；
 * `right` = 内容行尾（priority 象限网格图标，ADR-0054 D3 恢复此槽）。
 *
 * `right` 槽此前以「恒空」为由移除（ADR-0050 D19 决策 4）：当时
 * `right-of-content` 全仓仅 priority 一个字段，而整行底色已承担扫描级信号，
 * 行内位被认为多余。ADR-0054 去掉底色后块行缺失扫描级展示位，故恢复。
 *
 * 两个内联槽分属不同字段、位置不同不构成重复；`list` 区（录入面）仍渲染
 * priority —— 它是唯一可写入口，与只读展示位职责不同、不互斥。
 *
 * 成对投影：`right` 槽的 priority 在块无有效 status 值时隐藏（见 hasStatusValue）。
 */
const inlineRows = computed<FieldValue[]>(() => {
  const position = props.variant === 'right' ? 'right-of-content' : 'between-bullet-content'
  const at = rowsAt(position)
  if (props.variant === 'right' && !hasStatusValue.value) {
    return at.filter((fv) => fv.key !== 'priority')
  }
  return at
})

/**
 * chips / all 变体的可见行：bottom-of-block 内置字段 + 全部自定义字段，
 * 排除已内联为 dateRef 的 deadline / scheduled。
 * 「是否系统字段」由所属 Tag 的 isSystem 承载（ADR-0049 D5）。
 */
const displayRows = computed<FieldValue[]>(() =>
  rows.value.filter((fv) => {
    // T14: deadline/scheduled 已内联为 dateRef，不在字段面板展示
    if (fv.key === 'deadline' || fv.key === 'scheduled') return false
    return defOf(fv.key)?.displayPosition === 'bottom-of-block' || !isSystemField(fv.key)
  }),
)

// ── 图标 / 文案（封闭值取 label，数组拼接，其余原样）──

/** page 引用值展示：page id 反查目标页标题，悬空 id（目标页已删 / 无效）降级显示原始 id（T3 AC3）。 */
function pageTitleOf(id: string): string {
  return pageStore.getPage(id)?.title ?? id
}

/** page 引用悬空判定：目标页不在 pages store（已删 / 无效 id），供 chip 弱化样式用。 */
function isDanglingPageRef(id: string): boolean {
  return !pageStore.getPage(id)
}

function getIcon(key: string, value: unknown): string | null {
  const def = defOf(key)
  if (def?.closedValues) {
    const cv = def.closedValues.find((c) => c.value === value)
    if (cv?.icon) return cv.icon
  }
  // 内建图标键（与 field-display-form.ICON_CHARS 同源）：命中即产出该字符
  return ICON_CHARS.get(key) ?? null
}

function getLabel(key: string, value: unknown): string {
  // formula（issue T11）：标题/通用文案展示「计算结果」而非表达式原文
  const formulaRow = fieldValueStore.getBlockFieldValue(props.blockId, key)
  if (formulaRow?.value_type === 'formula') {
    return formulaDisplay({ key, type: 'formula' } as PersistedFieldDefinition) ?? ''
  }
  // relation（issue T5）：值是 { targetId, relationshipTypeId } 对象——all 变体等
  // 通用分支兜底展示 targetId（list 变体走 RelationRefEditor 专属分支，不经此），
  // 避免 String(对象) 渲染成 "[object Object]"
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && 'targetId' in (value as Record<string, unknown>)) {
    return String((value as { targetId: unknown }).targetId)
  }
  const def = defOf(key)
  // currency 特化（T7，code-review Spec#2）：all 变体等通用文案路径也带符号/单位，
  // 与 list 变体行内展示同源（formatCurrency 单源在 utils/field-number-format）
  const persistedDef = persistedDefOf(key)
  if (persistedDef?.type === 'number' && numberSpecKindOf(persistedDef) === 'currency' && typeof value === 'number') {
    return formatCurrency(value, currencyFormatOf(persistedDef))
  }
  // page 引用值即 page id：统一反查标题展示（悬空降级原始 id），
  // list / all 变体 chip 与 title 提示同走此分支（T3 AC3）
  if (def?.type === 'page') return pageTitleOf(String(value))
  // 数组值 + 编译期 closedValues（multiSelect）：逐 id 映射 label，悬空 id 降级原始值（T4）
  if (def?.closedValues && Array.isArray(value)) {
    return value
      .map((v) => def.closedValues!.find((c) => String(c.value) === String(v))?.label ?? String(v))
      .join('、')
  }
  if (def?.closedValues) {
    const cv = def.closedValues.find((c) => c.value === value)
    if (cv?.label) return cv.label
  }
  switch (key) {
    case 'project':
    case 'area':
      return String(value)
    case 'tags':
      return Array.isArray(value) ? value.join(', ') : String(value)
    default:
      return String(value)
  }
}

function isSvgIcon(icon: string): boolean {
  return icon.startsWith('status-') || icon.startsWith('priority-') || icon.startsWith('icon-')
}

/** 字段标题（chips 的 hover 全量与浮层用）；无定义时回退 key */
function titleOf(key: string): string {
  return defOf(key)?.title ?? key
}

// ── 编辑器入口（快捷菜单与完整编辑器共用同一锚点约定：触发元素左下 + 4px）──

function editorPosition(el: HTMLElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect()
  return { x: rect.left, y: rect.bottom + 4 }
}

function openEditor(key: string, el: HTMLElement) {
  if (isSystemField(key)) {
    editorStore.showQuickFieldValueEditor(props.blockId, key, editorPosition(el))
  } else {
    editorStore.showFieldValueEditor(props.blockId, key, editorPosition(el))
  }
}

function deleteRow(fv: FieldValue, event: MouseEvent) {
  event.stopPropagation()
  void fieldValueStore.deleteFieldValue(fv.id, props.blockId)
}

// ── between / right 内联槽交互 ──────────────────────────────

const hoveredId = ref<string | null>(null)

/** status 单击循环顺序；环外值（Canceled / Archived 等）一律回到首个 */
const STATUS_CYCLE = ['Todo', 'Doing', 'Done'] as const
const LONG_PRESS_MS = 500

let longPressTimer: ReturnType<typeof setTimeout> | null = null
let longPressHandled = false

function clearLongPress() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function onPointerDown(fv: FieldValue, event: PointerEvent) {
  clearLongPress()
  longPressHandled = false
  if (event.button !== 0) return
  // currentTarget 在 setTimeout 回调里已被置空，必须同步取 rect
  const el = event.currentTarget as HTMLElement
  longPressTimer = setTimeout(() => {
    longPressTimer = null
    longPressHandled = true
    openEditor(fv.key, el)
  }, LONG_PRESS_MS)
}

/** status 专用：Todo → Doing → Done → Todo 循环，直接落库，不弹菜单 */
function cycleStatus(fv: FieldValue) {
  const current = dataOf(fv) as (typeof STATUS_CYCLE)[number]
  const idx = STATUS_CYCLE.indexOf(current)
  const next = idx === -1 ? STATUS_CYCLE[0] : STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
  void fieldValueStore.setFieldValue(props.blockId, fv.key, next, 'string')
}

function onInlineClick(fv: FieldValue, event: MouseEvent) {
  clearLongPress()
  // 长按已弹过菜单，吞掉随后的 click
  if (longPressHandled) {
    longPressHandled = false
    return
  }
  if (fv.key === 'status') {
    cycleStatus(fv)
    return
  }
  openEditor(fv.key, event.currentTarget as HTMLElement)
}

/** 悬浮提示：quote 给全文，其余给「字段名: 值」 */
function chipTitleAttr(fv: FieldValue): string | undefined {
  const value = dataOf(fv)
  if (fv.key === 'quote') return String(value)
  // project/area 不渲染字段名，提示里也不重复
  if (fv.key === 'project' || fv.key === 'area') return String(value)
  return `${titleOf(fv.key)}: ${getLabel(fv.key, value)}`
}

// ── book-note 来源行 ────────────────────────────────────────

function strByKey(key: string): string {
  const fv = rows.value.find((r) => r.key === key)
  return fv ? String(dataOf(fv)) : ''
}

/** cfi 字段值（「跳回原文」的数据源） */
const sourceCfi = computed(() => strByKey('cfi'))
/** 父级章节字段值（卷/部，双层结构时使用） */
const part = computed(() => strByKey('part'))
/** 章节字段值 */
const chapter = computed(() => strByKey('chapter'))
/** 原文引用字段值 */
const quote = computed(() => strByKey('quote'))

/** 章节展示：双层结构 part/chapter，单层仅 chapter */
const chapterLabel = computed(() => {
  if (!chapter.value) return ''
  if (part.value) return `${part.value} / ${chapter.value}`
  return chapter.value
})

/** 书笔记：存在原文引用字段（quote 是书笔记四件套的核心展示字段） */
const isBookNote = computed(() => !!quote.value)

/** 仅 Tauri 环境且 cfi 字段存在时显示（web/Android 无阅读器窗口） */
const canJumpToSource = computed(() => isTauriEnvironment() && !!sourceCfi.value)

/** 唤起（或聚焦）该书阅读器窗口并定位到高亮处：bookPageId 即 Block 所属书 Page */
async function jumpToSource(): Promise<void> {
  const cfi = sourceCfi.value
  if (!cfi) return
  const bookPageId = blockStore.getBlock(props.blockId)?.pageId
  if (!bookPageId) return
  await openReaderWindow(bookPageId, { jumpCfi: cfi })
}

// ── list 变体：块字段区 ─────────────────────────────────────

/**
 * 本组件只负责按 `fields`（集合口径见 ./composables/useBlockFieldRows 文件头）
 * 逐字段解析形态并渲染；集合推导（标签驱动 ∪ 孤儿、displayPosition / hide_when /
 * status↔priority 成对过滤）**不在本组件**——它与 Block/index.vue 的折叠守卫共用同一份。
 */

/** 当前值文本（选项型取 label，数组拼接，其余原样）；无值 → null（渲染占位）。 */
function valueText(def: PersistedFieldDefinition): string | null {
  // formula（issue T11）：值由表达式在渲染时按兄弟字段派生；无表达式/无行 → null（幽灵占位）
  if (def.type === 'formula') return formulaDisplay(def)
  // geo（issue T12）：地名 + 经纬度
  if (def.type === 'geo') return geoDisplay(def)
  // json（issue T12）：任意结构化值，序列化为单行文本
  if (def.type === 'json') return jsonDisplay(def)
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return null
  const value = dataOf(fv)
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value)) return value.length ? value.map(String).join('、') : null
  // 结构化值类型的文字投影（形态覆盖为 text / icon-text 时的静态文字行，D21 决策 5）：
  // 逐类型给出可读文案，禁止 [object Object] / 裸 id 漏出。
  if (def.type === 'boolean') return value === true ? '是' : '否'
  if (def.type === 'daterange') {
    const r = value as { start?: unknown; end?: unknown }
    return [r.start, r.end]
      .filter((p) => p !== null && p !== undefined && p !== '')
      .map(String)
      .join(' → ') || null
  }
  if (def.type === 'page') return pageTitleOf(String(value))
  if (def.type === 'file') return fileValue(def)?.name ?? null
  if (def.type === 'relation') return relationTargetTitle(def)
  if (def.type === 'color') return colorLabelOf(def) || null
  if (def.type === 'number' && typeof value === 'number') {
    return numberSpecKindOf(def) === 'currency'
      ? formatCurrency(value, currencyFormatOf(def))
      : String(value)
  }
  const closed = def.closed_values?.find((v) => String(v) === String(value))
  return closed ? String(closed) : String(value)
}

/** 构建同块数值环境（排除自身字段），供公式求值。 */
function blockNumberEnv(selfKey: string): Record<string, number> {
  const env: Record<string, number> = {}
  for (const sib of fieldValueStore.getBlockFieldValues(props.blockId)) {
    if (sib.key === selfKey) continue
    const v = dataOf(sib)
    if (typeof v === 'number' && !Number.isNaN(v)) env[sib.key] = v
  }
  return env
}

/** formula 字段计算结果显示（issue T11）：读表达式 + 兄弟环境求值；失败 → null。 */
function formulaDisplay(def: PersistedFieldDefinition): string | null {
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return null
  const expr = dataOf(fv)
  if (typeof expr !== 'string' || !expr.trim()) return null
  const r = safeEvaluateFormula(expr, blockNumberEnv(def.key))
  return r === null ? null : String(r)
}

/** geo 字段展示文本（issue T12）："地名（lat, lng）" 或 "lat, lng"。 */
function geoDisplay(def: PersistedFieldDefinition): string | null {
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return null
  const g = dataOf(fv)
  if (!g || typeof g !== 'object' || Array.isArray(g) || !('lat' in g) || !('lng' in g)) return null
  const geo = g as { lat: number; lng: number; name?: string }
  const coord = `${geo.lat}, ${geo.lng}`
  return geo.name ? `${geo.name}（${coord}）` : coord
}

/** json 字段展示文本（issue T12）：序列化；非对象/空 → null。 */
function jsonDisplay(def: PersistedFieldDefinition): string | null {
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return null
  const j = dataOf(fv)
  if (j === null || j === undefined || j === '') return null
  try {
    return JSON.stringify(j)
  } catch {
    return null
  }
}

/** color 字段的 token 值（issue T12）；非法 → null（回落幽灵）。 */
function colorValueOf(def: PersistedFieldDefinition): string | null {
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return null
  const v = dataOf(fv)
  return typeof v === 'string' && isTagColorToken(v) ? v : null
}

/** color 字段的展示名（issue T12）：查 TAG_COLORS 表。 */
function colorLabelOf(def: PersistedFieldDefinition): string {
  const token = colorValueOf(def)
  return TAG_COLORS.find((c) => c.token === token)?.label ?? token ?? ''
}

/** date 类型字段的当前值（'YYYY-MM-DD' | undefined），供 DatePicker 绑定。 */
function dateValue(def: PersistedFieldDefinition): string | undefined {
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return undefined
  const v = dataOf(fv)
  return typeof v === 'string' && v ? v : undefined
}

/**
 * date 字段取值回调（DatePicker single 模式）：选日期 → 落库为 date 类型；
 * 清除（undefined / 空串）→ 删行（field-value 以「无行」表示空）。
 */
async function onDateChange(def: PersistedFieldDefinition, value: DatePickerValue) {
  if (value === undefined || value === '') {
    const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
    if (fv) await fieldValueStore.deleteFieldValue(fv.id, props.blockId)
    return
  }
  if (typeof value === 'string') {
    await fieldValueStore.setFieldValue(props.blockId, def.key, value, 'date')
  }
}

/**
 * datetime 字段取值回调（DateTimePicker，T2）：'yyyy-MM-dd HH:mm' 整值落库为
 * datetime 类型；清除（undefined / 空串）→ 删行（field-value 以「无行」表示空）。
 */
async function onDateTimeChange(def: PersistedFieldDefinition, value: string | undefined) {
  if (!value) {
    const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
    if (fv) await fieldValueStore.deleteFieldValue(fv.id, props.blockId)
    return
  }
  await fieldValueStore.setFieldValue(props.blockId, def.key, value, 'datetime')
}

/** daterange 类型字段的当前值（{ start, end } | undefined），供 DateRangePicker 绑定。 */
function daterangeValueOf(def: PersistedFieldDefinition): DateRangePickerValue | undefined {
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return undefined
  const v = dataOf(fv)
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && 'start' in v && 'end' in v) {
    return v as DateRangePickerValue
  }
  return undefined
}

/**
 * daterange 字段取值回调（DateRangePicker）：两端齐 → 落库为 daterange 类型
 * （内存形 { start, end }，codec 走 JSON 分支）；
 * 清除（undefined = 未填）→ 删行（field-value 以「无行」表示空）。
 */
async function onDaterangeChange(def: PersistedFieldDefinition, value: DateRangePickerValue | undefined) {
  if (value === undefined || !value.start || !value.end) {
    const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
    if (fv) await fieldValueStore.deleteFieldValue(fv.id, props.blockId)
    return
  }
  await fieldValueStore.setFieldValue(props.blockId, def.key, { start: value.start, end: value.end }, 'daterange')
}

/** number 类型字段的当前值（number | undefined），供 NumberInput 绑定。 */
function numberValue(def: PersistedFieldDefinition): number | undefined {
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return undefined
  const v = dataOf(fv)
  return typeof v === 'number' ? v : undefined
}

/**
 * number 字段取值回调（NumberInput）：有值 → 落库为 number 类型；
 * 清除（undefined）→ 删行（field-value 以「无行」表示空）。
 */
async function onNumberChange(def: PersistedFieldDefinition, value: NumberInputValue) {
  if (value === undefined) {
    const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
    if (fv) await fieldValueStore.deleteFieldValue(fv.id, props.blockId)
    return
  }
  await fieldValueStore.setFieldValue(props.blockId, def.key, value, 'number')
}

// ── number 特化族（issue T7）：currency / percent / rating ────────────────

/**
 * number 特化种类（'currency' | 'percent' | 'rating'；null = 无特化）。
 * 合法性经中央注册表 `numberSpecialization` 查表（currency spec 可带符号/单位
 * 后缀如 'currency:¥/元'，查表取首段）；未知 / 缺省 → null，走原 number 路径（零回归）。
 */
function numberSpecKindOf(def: PersistedFieldDefinition): string | null {
  const head = specHeadOf(def.spec)
  return numberSpecialization(head) ? head : null
}

/** currency 特化的符号/单位（解析单源 parseCurrencySpec；默认 ¥）。 */
function currencyFormatOf(def: PersistedFieldDefinition) {
  return parseCurrencySpec(def.spec)
}

// ── page 特化族（issue T10）：person（负责人）─────────────────────────────

/**
 * page 特化种类（'person'；null = 无特化）。
 * 合法性经中央注册表 `pageSpecialization` 查表（与 numberSpecKindOf 同构先例）；
 * 未知 / 缺省 → null，走原 page 路径（零回归）。
 */
function pageSpecKindOf(def: PersistedFieldDefinition): string | null {
  const head = specHeadOf(def.spec)
  return pageSpecialization(head) ? head : null
}

/** 是否 person 特化（负责人）：picker 过滤与人员 chip 样式共用此判定。 */
function isPersonField(def: PersistedFieldDefinition): boolean {
  return pageSpecKindOf(def) === 'person'
}

/** 人员 chip 头像字：目标页标题首字（悬空 id 降级取 id 首字；空白兜底 '?'）。 */
function personAvatarChar(id: string): string {
  return pageTitleOf(id).trim().charAt(0) || '?'
}

/**
 * number 特化的有效约束界：percent 默认 0–100（复用 ADR-0055 min/max 通道，
 * 用户显式配置优先）；其余原样透传。纯函数单源在 utils/field-number-format。
 */
function effectiveBoundsOf(def: PersistedFieldDefinition): { min: number | null; max: number | null } {
  return effectiveNumberBounds(numberSpecKindOf(def), def.min, def.max)
}

/** percent 特化的进度百分比（0–100 夹界；未填 / 非数值 = 0，进度条空）。 */
function percentOf(def: PersistedFieldDefinition): number {
  const v = numberValue(def)
  if (v === undefined || !Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, v))
}

/**
 * boolean 类型字段的当前值（boolean | undefined），供 BooleanCheck 绑定。
 * 非 boolean 值（历史脏数据 / 无行）一律视为未填。
 */
function booleanValue(def: PersistedFieldDefinition): BooleanCheckValue {
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return undefined
  const v = dataOf(fv)
  return typeof v === 'boolean' ? v : undefined
}

/**
 * boolean 字段取值回调（BooleanCheck 勾选切换）：true / false → 落库为 boolean 类型；
 * 清除（undefined）→ 删行（field-value 以「无行」表示空）。控件本身不发 undefined
 * （checkbox 切换语义），此分支是与字段值家族对齐的防御性收口。
 */
async function onBooleanChange(def: PersistedFieldDefinition, value: BooleanCheckValue) {
  if (value === undefined) {
    const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
    if (fv) await fieldValueStore.deleteFieldValue(fv.id, props.blockId)
    return
  }
  await fieldValueStore.setFieldValue(props.blockId, def.key, value, 'boolean')
}

/** 开关形态（switch）点击切换：未填/否→是，是→否（落库走 onBooleanChange）。 */
function onBooleanToggle(def: PersistedFieldDefinition) {
  void onBooleanChange(def, !booleanValue(def))
}

/** all 变体开关形态的取值（非 boolean 值一律视为空），供开关 UI 着色。 */
function allBooleanValue(fv: FieldValue): BooleanCheckValue {
  const v = dataOf(fv)
  return v === true ? true : v === false ? false : undefined
}

/**
 * 纯 string（自由文本）字段的当前值（string | undefined），供 TextField 绑定。
 * 仅非选项型 string（排除 closed_values 非空的枚举）走 TextField；枚举被
 * display_form_override 覆写为 text 时仍走静态文字行（见下方 text 分支兜底）。
 */
function textValue(def: PersistedFieldDefinition): string | undefined {
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return undefined
  const v = dataOf(fv)
  return typeof v === 'string' && v !== '' ? v : undefined
}

/** 特化感知占位符（收尾）：email/phone/url/richtext 给语义文案，
 *  其余回退到既有的「输入${def.title} / 输入文本」。spec 可能带参数（email:x@y.z），
 *  须用 specHeadOf 归一头部再匹配，否则命中不到。 */
function stringPlaceholderOf(def: PersistedFieldDefinition): string {
  const head = specHeadOf(def.spec)
  let hint: string
  switch (head) {
    case 'email': hint = '输入邮箱地址'; break
    case 'phone': hint = '输入电话号码'; break
    case 'url': hint = '输入链接 URL'; break
    case 'richtext': hint = '输入 markdown（**粗** *斜* `码` [链](接)）'; break
    default: hint = def.title ? `输入${def.title}` : '输入文本'
  }
  return hint
}

/**
 * 纯 string 字段取值回调（TextField）：有值 → 落库为 string 类型；
 * 清除（undefined / 空串）→ 删行（field-value 以「无行」表示空）。
 */
async function onTextChange(def: PersistedFieldDefinition, value: TextFieldValue) {
  if (value === undefined || value === '') {
    const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
    if (fv) await fieldValueStore.deleteFieldValue(fv.id, props.blockId)
    return
  }
  await fieldValueStore.setFieldValue(props.blockId, def.key, value, 'string')
}

// ── string 特化（issue T6）：url 链接 / richtext 多行 markdown ──────────

/** url 特化字段的点击 href（无 scheme 补 https://，javascript: 等拒渲染）；null = 不可点。 */
function urlHrefOf(def: PersistedFieldDefinition): string | null {
  return toExternalHref(valueText(def))
}

/** 外链打开：跟随仓库既有做法（Backlinks / useBlockEditorLifecycle）——window.open + noopener。 */
function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** 正在就地理编辑的 richtext 字段 id（null = 无；至多一个）。 */
const richEditingId = ref<string | null>(null)
const richDraft = ref('')
const richTextareaEl = ref<HTMLTextAreaElement | null>(null)

function isRichEditing(def: PersistedFieldDefinition): boolean {
  return richEditingId.value === def.id
}

/** 进 richtext 就地编辑：草稿取当前值，渲染落地后聚焦并自动增高。 */
function startRichEdit(def: PersistedFieldDefinition) {
  richDraft.value = textValue(def) ?? ''
  richEditingId.value = def.id
  nextTick(() => {
    // v-for 内的模板 ref 被 Vue 收成数组（至多一个编辑中的 textarea，取最后挂载者）
    const raw = richTextareaEl.value as unknown
    const el = (Array.isArray(raw) ? raw[raw.length - 1] : raw) as HTMLTextAreaElement | null
    if (!el) return
    autoGrowRich({ target: el } as unknown as Event)
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
}

/** textarea 自动增高：先回 auto 再取 scrollHeight，支持删行回缩。 */
function autoGrowRich(e: Event) {
  const el = e.target as HTMLTextAreaElement | undefined
  if (!el?.style) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

/** richtext 提交：空串 → 删行；非空按原样落库（markdown 内容不 trim 内部换行）。 */
async function commitRichEdit(def: PersistedFieldDefinition) {
  richEditingId.value = null
  const raw = richDraft.value
  await onTextChange(def, raw.trim() === '' ? undefined : raw)
}

/** Esc 取消 richtext 编辑（回显原值，不落库）。 */
function cancelRichEdit() {
  richEditingId.value = null
}

/** richtext 展示侧：最小 markdown 渲染（纯函数，转义优先，v-html 安全）。 */
function richHtml(def: PersistedFieldDefinition): string {
  return renderInlineMarkdown(valueText(def) ?? '')
}

// ── file 字段（附件，issue T9）：值区直挂 FileRefEditor ─────────────

/** file 类型字段的当前值（FileRefValue | undefined），供 FileRefEditor 绑定。 */
function fileValue(def: PersistedFieldDefinition): FileRefValue | undefined {
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return undefined
  const v = dataOf(fv)
  if (v === null || v === undefined || v === '') return undefined
  return typeof v === 'object' && !Array.isArray(v) ? (v as FileRefValue) : undefined
}

/**
 * file 字段取值回调（FileRefEditor）：有值 → 落库为 file 类型（JSON 编码，
 * 值形 { path, name, mime? }，path 为 asset://<id> 引用）；清除（undefined）
 * → 删行（field-value 以「无行」表示空）。
 */
async function onFileChange(def: PersistedFieldDefinition, value: FileRefValue | undefined) {
  if (value === undefined) {
    const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
    if (fv) await fieldValueStore.deleteFieldValue(fv.id, props.blockId)
    return
  }
  await fieldValueStore.setFieldValue(props.blockId, def.key, value, 'file')
}

// ── page 字段（页面引用，issue T3）：值区直挂 PageRefPicker ─────────

/**
 * page 字段取值回调（PageRefPicker）：选中页面 → 落库 page id 为 page 类型
 * （codec 直通存储）；undefined（无清除入口）不处理——既有值改选走 chip 跳转。
 */
/**
 * page 字段取值回调（PageRefPicker）：选中页面 → 落库 page id 为 page 类型
 * （codec 直通存储）；清除（undefined / 空串）→ 删行（field-value 以「无行」表示空）。
 * 此前此处 `if (!value) return` 把清除信号吞掉，导致 page 字段一旦有值只能覆盖、
 * 无法置空（list 变体无 × 删除按钮）。现与字段值家族其它类型对齐走删行语义。
 */
async function onPageRefChange(def: PersistedFieldDefinition, value: string | undefined) {
  if (!value) {
    const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
    if (fv) await fieldValueStore.deleteFieldValue(fv.id, props.blockId)
    return
  }
  await fieldValueStore.setFieldValue(props.blockId, def.key, value, 'page')
}

// ── relation 字段（关系引用，issue T5）：值区直挂 RelationRefEditor ──

/**
 * relation 字段当前值（RelationRefValue | undefined），供 RelationRefEditor 绑定。
 * 解码形态非对象（历史脏数据 / 非法 JSON 容错返回原字符串）时按未填降级——
 * 渲染端不因脏数据炸读路径。
 */
function relationValue(def: PersistedFieldDefinition): RelationRefValue | undefined {
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return undefined
  const v = dataOf(fv)
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined
  const rel = v as Partial<RelationRefValue>
    return typeof rel.targetId === 'string' && rel.targetId ? (v as RelationRefValue) : undefined
}

/** relation 目标的展示名（text / icon-text 形态的静态文字用）：页名优先，块取内容，
 *  悬空 id 原样回落（与 RelationRefEditor 的目标解析口径一致）。 */
function relationTargetTitle(def: PersistedFieldDefinition): string | null {
  const rv = relationValue(def)
  if (!rv) return null
  return pageStore.getPage(rv.targetId)?.title
    ?? blockStore.getBlock(rv.targetId)?.content?.trim()
    ?? rv.targetId
}

/**
 * relation 字段取值回调（RelationRefEditor）：两段齐备的 payload → 落库为
 * relation 类型（JSON 编码，值形 { targetId, relationshipTypeId }）；清除
 * （undefined）→ 删行（field-value 以「无行」表示空）。
 */
async function onRelationChange(def: PersistedFieldDefinition, value: RelationRefValue | undefined) {
  if (value === undefined) {
    const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
    if (fv) await fieldValueStore.deleteFieldValue(fv.id, props.blockId)
    return
  }
  await fieldValueStore.setFieldValue(props.blockId, def.key, value, 'relation')
}

// ── 枚举字段（封闭选项）：值区直挂通用枚举组件 EnumSelect ─────────────

/** 枚举字段判定：封闭选项非空即选项型（与 field-display-form 的 isOptionTypeDef 同判据）。
 *  relation（issue T5）除外：其 closed_values 复用为「约定的关系类型 id」配置位
 *  （单元素数组，见 tag-persisted.ts），不是选项语义，不得按枚举分派。 */
function isEnumField(def: PersistedFieldDefinition): boolean {
  return def.type !== 'relation' && (def.closed_values?.length ?? 0) > 0
}

/**
 * 枚举选项（EnumSelect 数据源）：编译期定义优先（closedValues 带 label / icon /
 * description，如 status / priority），持久化 closed_values 字符串兜底（用户自建枚举）。
 */
function enumOptionsOf(def: PersistedFieldDefinition): EnumOption[] {
  const compiled = defOf(def.key)
  if (compiled?.closedValues?.length) {
    return compiled.closedValues.map((cv) => ({
      value: String(cv.value),
      label: cv.label ?? String(cv.value),
      icon: cv.icon ?? null,
      description: cv.description ?? null,
    }))
  }
  return (def.closed_values ?? []).map((v) => ({ value: v, label: v }))
}

/** 枚举字段的当前值（string | undefined），供 EnumSelect 绑定（undefined = 未填）。 */
function enumValue(def: PersistedFieldDefinition): EnumSelectValue {
  return rawValueOf(def) ?? undefined
}

/**
 * 枚举字段取值回调（EnumSelect）：有值 → 落库为 string 类型（枚举值即字符串）；
 * 清除（undefined）→ 删行（field-value 以「无行」表示空）。
 * priority 的成对副作用（补默认 status=Todo，不挂 #任务 tag）由
 * fieldValueStore.setFieldValue 写入收口统一处理。
 */
async function onEnumChange(def: PersistedFieldDefinition, value: EnumSelectValue) {
  if (value === undefined) {
    const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
    if (fv) await fieldValueStore.deleteFieldValue(fv.id, props.blockId)
    return
  }
  await fieldValueStore.setFieldValue(props.blockId, def.key, value, 'string')
}

// ── multiSelect（多选枚举，T4）：值区直挂 MultiEnumSelect ─────────────

/** multiSelect 字段的当前值（string[] | undefined），供 MultiEnumSelect 绑定（undefined = 未填）。 */
function multiEnumValue(def: PersistedFieldDefinition): string[] | undefined {
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return undefined
  const v = dataOf(fv)
  return Array.isArray(v) && v.length ? v.map(String) : undefined
}

/**
 * multiSelect 取值回调（MultiEnumSelect）：有值 → 落库为 multiSelect 类型（选项 id 数组，
 * codec JSON 编码）；清空 / undefined → 删行（field-value 以「无行」表示空）。
 */
async function onMultiEnumChange(def: PersistedFieldDefinition, value: string[] | undefined) {
  if (!value?.length) {
    const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
    if (fv) await fieldValueStore.deleteFieldValue(fv.id, props.blockId)
    return
  }
  await fieldValueStore.setFieldValue(props.blockId, def.key, value, 'multiSelect')
}

/**
 * 行是否已挂专属内联编辑器（date / number / boolean / file / page / relation / 枚举 chip 形态）：
 * 整行让位给控件，行不再是点击目标（role/tabindex 均不挂），openFieldRow 对其早退。
 * 形态感知（D21 决策 5）：override 把形态改走 text 时值区是静态文字，整行保持可点击
 * → 快速编辑器（string 除外——其文字形态即内联 TextField 编辑器，见尾条）。
 */
function rowHasInlineEditor(def: PersistedFieldDefinition): boolean {
  // 只读形态（readonly）：纯展示，不挂任何内联编辑器（D21 通用只读扩展）。
  if (formOf(def) === 'readonly') return false
  if (formOf(def) === 'text' && def.type !== 'string') return false
  return (
    (def.type === 'date' && usesDefaultForm(def))
    || (def.type === 'datetime' && usesDefaultForm(def))
    || (def.type === 'daterange' && usesDefaultForm(def))
    || (def.type === 'number' && usesDefaultForm(def))
    || (def.type === 'boolean' && (formOf(def) === 'icon' || formOf(def) === 'icon-text'))
    || (def.type === 'file' && usesDefaultForm(def))
    || (def.type === 'page' && usesDefaultForm(def))
    || (def.type === 'relation' && usesDefaultForm(def))
    || (isEnumField(def) && formOf(def) === 'chip')
    // string 特化（issue T6）：url 有值时值区是可点击链接（非编辑控件）→ 整行保持
    // 可点击（点行唤快速编辑器改值）；url 无值及其他 string 特化仍走内联编辑器。
    || (def.type === 'string' && !isEnumField(def) && !(def.spec === 'url' && textValue(def) !== null))
  )
}

// ── D21 形态解析与分派 ──────────────────────────────────────

/** 布尔值的图标字符（icon 形态下值即 ✓/✗，无需额外图标资源） */
function iconCharOf(def: PersistedFieldDefinition): string | null {
  if (def.type === 'boolean') {
    return rawValueOf(def) === 'true' ? '✓' : '✗'
  }
  const value = rawValueOf(def)
  if (value === null) return null
  return getIcon(def.key, value)
}

/**
 * list 变体的逐字段有效形态（D21 决策 1/5/6）：
 * 解析单源 `resolveDisplayForm`（用户覆盖 > 编译期 displayStyle > 类型默认），
 * 叠加一条渲染兜底——icon / icon-text 无可用图标字符时回落 text，
 * 避免渲染出空图标位。
 */
const formByDefId = computed<Record<string, DisplayFormKind>>(() => {
  const out: Record<string, DisplayFormKind> = {}
  for (const def of fields.value) {
    let form = resolveDisplayForm(def)
    if ((form === 'icon' || form === 'icon-text') && iconCharOf(def) === null) {
      form = 'text'
    }
    // switch 仅对 boolean 有意义；非布尔字段落到 switch 回落 text（与 icon 无字符回落同口径）
    if (form === 'switch' && def.type !== 'boolean') {
      form = 'text'
    }
    out[def.id] = form
  }
  return out
})

function formOf(def: PersistedFieldDefinition): DisplayFormKind {
  return formByDefId.value[def.id] ?? 'text'
}

/**
 * 类型专属编辑器分支的门控（D21 决策 5：形态覆盖必须生效）：
 * resolved 形态 = 类型默认形态时命中——编辑器控件（DatePicker / NumberInput /
 * BooleanCheck / FileRefEditor / PageRefPicker / RelationRefEditor）即该类型默认
 * chip / icon 形态的实现载体；override 把形态改走别的档时让位给通用形态分支
 * （静态文字 / 图标行 / 通用 chip），编辑经整行点击 → 快速编辑器（全类型支持）。
 */
function usesDefaultForm(def: PersistedFieldDefinition): boolean {
  return formOf(def) === typeDefaultForm(def.type, isEnumField(def))
}

/**
 * chip 形态的值序列：array → 每值一枚（chip 序列，D21 决策 1；multiSelect 的选项
 * id 经 closedValues 映射为 label，悬空 id 降级显示原始值，T4 AC4）；
 * 标量 → 单枚（选项型取 label）；无值 → null（渲染 ghost 胶囊，决策 7）。
 */
function chipValues(def: PersistedFieldDefinition): string[] | null {
  const fv = fieldValueStore.getBlockFieldValue(props.blockId, def.key)
  if (!fv) return null
  const value = dataOf(fv)
  if (value === null || value === undefined || value === '') return null
  // boolean + chip 覆写（D21 决策 5）：通用 chip 分支的值文案（raw true/false 不可读）
  if (def.type === 'boolean') return [value === true ? '是' : '否']
  if (Array.isArray(value)) {
    if (!value.length) return null
    if (def.type === 'multiSelect') return value.map((v) => multiEnumLabelOf(def, String(v)))
    return value.map(String)
  }
  // currency 特化（T7）：chip 形态标量同样带符号/单位（code-review Spec#2）
  if (def.type === 'number' && numberSpecKindOf(def) === 'currency' && typeof value === 'number') {
    return [formatCurrency(value, currencyFormatOf(def))]
  }
  const closed = def.closed_values?.find((v) => String(v) === String(value))
  return [closed ? String(closed) : String(value)]
}

/**
 * multiSelect 选项 id → 展示文案：编译期 closedValues 的 label 优先；
 * 持久化 closed_values 的 value 即文案（value==label）；悬空 id 降级显示原始值。
 */
function multiEnumLabelOf(def: PersistedFieldDefinition, id: string): string {
  const compiled = defOf(def.key)?.closedValues
  const cv = compiled?.find((c) => String(c.value) === id)
  if (cv) return cv.label
  return id
}

/** chip / icon 行的点击：page 类型跳转目标页（对齐 [[page]] 导航语义），其余唤起编辑器 */
function onFieldActivate(event: Event, def: PersistedFieldDefinition, value?: string) {
  if (def.type === 'page' && value) {
    void navigateToPage(value)
    return
  }
  openFieldRow(event, def)
}

/** 点击 / Enter 唤起该字段的快速编辑器（锚点 = 行元素矩形）；参数取 Event 以兼容键盘触发。 */
function openFieldRow(event: Event, def: PersistedFieldDefinition) {
  // 只读形态（readonly）：字段区锁定，点击整行不弹编辑器（D21 通用只读扩展）。
  if (formOf(def) === 'readonly') return
  // date / number / boolean / 枚举（chip 形态）字段的值区已挂专属内联编辑器
  // （DatePicker / NumberInput / BooleanCheck / EnumSelect），不再弹通用编辑器。
  if (rowHasInlineEditor(def)) return
  editorStore.showQuickFieldValueEditor(props.blockId, def.key, editorPosition(event.currentTarget as HTMLElement))
}

/**
 * 整行是否作为「可点击按钮」呈现（role/tabindex 依据）：
 * 内联编辑器独占的行（date/number/boolean/枚举…）与只读形态行都不是点击目标。
 * 替代原先 `!rowHasInlineEditor` 的单判据，把 readonly 也排除出可交互集（D21 通用只读扩展）。
 */
function interactive(def: PersistedFieldDefinition): boolean {
  return !rowHasInlineEditor(def) && formOf(def) !== 'readonly'
}

/** all 变体的图标字符：布尔值即 ✓/✗（与 list 的 iconCharOf 同语义），其余走编译期 getIcon。 */
function allIconCharOf(fv: FieldValue): string | null {
  const value = dataOf(fv)
  if (value === true) return '✓'
  if (value === false) return '✗'
  return getIcon(fv.key, value)
}

/**
 * all 变体的逐字段形态：编译期定义 + 持久化覆盖列合并解析（D21 决策 9——
 * 与 list 共用同一注册表）；icon / icon-text 无可用图标字符时回落 text，
 * 与 list 变体的渲染兜底保持一致，避免同一字段跨变体两种形态。
 */
function allFormOf(fv: FieldValue): DisplayFormKind {
  let form: DisplayFormKind = 'text'
  const persisted = persistedDefOf(fv.key)
  if (persisted) {
    form = resolveDisplayForm(persisted)
  } else {
    const compiled = defOf(fv.key)
    if (compiled) {
      form = resolveDisplayForm({
        type: compiled.type,
        closedValues: compiled.closedValues,
        displayStyle: compiled.displayStyle,
      })
    }
  }
  if ((form === 'icon' || form === 'icon-text') && allIconCharOf(fv) === null) {
    form = 'text'
  }
  const allType = persistedDefOf(fv.key)?.type ?? defOf(fv.key)?.type
  if (form === 'switch' && allType !== 'boolean') {
    form = 'text'
  }
  return form
}
</script>

<template>
  <!-- 内联槽：between（bullet 与内容之间，status 任务图标）
       / right（内容行尾，priority 象限网格图标，ADR-0054 D3） -->
  <div
    v-if="variant === 'between' || variant === 'right'"
    class="property-inline"
    :class="`property-inline--${variant}`"
  >
    <div
      v-for="fv in inlineRows"
      :key="fv.id"
      class="property-inline-item"
      :class="{
        'built-in': isSystemField(fv.key),
        'icon-only': defOf(fv.key)?.displayStyle === 'icon'
      }"
      :data-field="fv.key"
      :data-value="String(dataOf(fv))"
      @mouseenter="hoveredId = fv.id"
      @mouseleave="hoveredId = null"
      @pointerdown="onPointerDown(fv, $event)"
      @pointerup="clearLongPress"
      @pointerleave="clearLongPress"
      @pointercancel="clearLongPress"
      @click.stop="onInlineClick(fv, $event)"
    >
      <template v-if="getIcon(fv.key, dataOf(fv))">
        <span class="property-icon">
          <Icon
            v-if="isSvgIcon(getIcon(fv.key, dataOf(fv)) as string)"
            :name="getIcon(fv.key, dataOf(fv)) as string"
            :size="variant === 'right' ? 14 : undefined"
          />
          <span v-else>{{ getIcon(fv.key, dataOf(fv)) }}</span>
        </span>
        <span
          v-if="defOf(fv.key)?.displayStyle !== 'icon'"
          class="property-label"
        >
          {{ getLabel(fv.key, dataOf(fv)) }}
        </span>
      </template>
      <template v-else>
        <span>{{ getLabel(fv.key, dataOf(fv)) }}</span>
      </template>
    </div>
  </div>

  <!-- 书笔记：紧凑一行展示来源信息（Pin + 章节 + 原文引用），不展开字段列表 -->
  <div
    v-else-if="(variant === 'book-note' || variant === 'all') && isBookNote"
    class="property-display book-note-source"
    :class="{ 'can-jump': canJumpToSource }"
    :title="canJumpToSource ? '跳回原文（在阅读器中定位高亮）' : undefined"
    @click.stop="jumpToSource"
  >
    <Pin
      :size="14"
      class="source-pin"
      color="var(--accent)"
    />
    <span
      v-if="chapterLabel"
      class="source-chapter"
    >{{ chapterLabel }}</span>
    <span
      v-if="quote"
      class="source-quote"
    >{{ quote }}</span>
  </div>

  <!-- all：完整字段列表（Backlinks 消费；D21 决策 9：与 list 共用形态注册表） -->
  <div
    v-else-if="variant === 'all' && !isBookNote && displayRows.length > 0"
    class="property-display"
  >
    <div class="property-list">
      <template
        v-for="fv in displayRows"
        :key="fv.id"
      >
        <!-- 只读形态（readonly，D21 通用只读扩展）：all 变体同样纯展示——静态可读值，
             不绑点击（字段区锁定不可编辑），值区悬浮提示"只读"。优先于下方各形态分支。 -->
        <span
          v-if="allFormOf(fv) === 'readonly'"
          class="property-item bfz-readonly-item"
          :title="`${titleOf(fv.key)}: ${dataOf(fv) != null && dataOf(fv) !== '' ? getLabel(fv.key, dataOf(fv)) : '—'}（只读）`"
        >
          <span class="bfz-chip-title">{{ titleOf(fv.key) }}</span>
          <span
            class="bfz-readonly-value"
            title="只读，不可在字段区编辑"
          >
            <template v-if="defOf(fv.key)?.type === 'boolean'">
              <span
                v-if="allIconCharOf(fv)"
                class="property-icon"
              >{{ allIconCharOf(fv) }}</span>
              <span
                v-else
                class="block-field-zone-placeholder"
              >—</span>
            </template>
            <span
              v-else-if="dataOf(fv) != null && dataOf(fv) !== ''"
              class="property-value"
            >{{ getLabel(fv.key, dataOf(fv)) }}</span>
            <span
              v-else
              class="block-field-zone-placeholder"
            >—</span>
          </span>
        </span>

        <!-- chip 形态（all 变体） -->
        <span
          v-else-if="allFormOf(fv) === 'chip'"
          class="property-item block-field-zone-chip"
          :class="{ 'block-field-zone-chip--ghost': dataOf(fv) === null || dataOf(fv) === '' }"
          :title="chipTitleAttr(fv)"
          @click.stop="openEditor(fv.key, $event.currentTarget as HTMLElement)"
        >
          <span class="bfz-chip-title">{{ titleOf(fv.key) }}</span>
          <span class="bfz-chip-value">{{ getLabel(fv.key, dataOf(fv)) }}</span>
        </span>
        <!-- icon / icon-text 形态（决策 9：与 list 同语义，boolean 值即 ✓/✗） -->
        <span
          v-else-if="allFormOf(fv) === 'icon'"
          class="property-item block-field-zone-row--icon"
          :title="chipTitleAttr(fv)"
          @click.stop="openEditor(fv.key, $event.currentTarget as HTMLElement)"
        >
          <span class="property-icon">{{ allIconCharOf(fv) }}</span>
        </span>
        <span
          v-else-if="allFormOf(fv) === 'icon-text'"
          class="property-item block-field-zone-row--icon"
          :title="chipTitleAttr(fv)"
          @click.stop="openEditor(fv.key, $event.currentTarget as HTMLElement)"
        >
          <span class="property-icon">{{ allIconCharOf(fv) }}</span>
          <span class="property-value">{{ getLabel(fv.key, dataOf(fv)) }}</span>
        </span>
        <!-- switch 形态（boolean 开关 UI；all 变体展示型，点击整行唤起编辑器，与 icon/icon-text 同口径） -->
        <span
          v-else-if="allFormOf(fv) === 'switch'"
          class="property-item block-field-zone-row--switch"
          :title="chipTitleAttr(fv)"
          @click.stop="openEditor(fv.key, $event.currentTarget as HTMLElement)"
        >
          <span
            class="bfz-switch"
            :class="{
              'bfz-switch--on': allBooleanValue(fv) === true,
              'bfz-switch--off': allBooleanValue(fv) === false,
              'bfz-switch--empty': allBooleanValue(fv) === undefined,
            }"
            role="img"
            :aria-label="allBooleanValue(fv) === true ? '是' : allBooleanValue(fv) === false ? '否' : '未填'"
          >
            <span class="bfz-switch-knob" />
          </span>
        </span>
        <!-- text 形态（既有 item 渲染） -->
        <div
          v-else
          class="property-item"
          :class="{ 'built-in': isSystemField(fv.key), 'quote-item': fv.key === 'quote' }"
          :title="chipTitleAttr(fv)"
          @mouseenter="hoveredId = fv.id"
          @mouseleave="hoveredId = null"
          @click.stop="openEditor(fv.key, $event.currentTarget as HTMLElement)"
        >
          <!-- project/area 直接以图标+名称展示，不渲染字段名 -->
          <span
            v-if="fv.key !== 'project' && fv.key !== 'area'"
            class="property-key"
          >{{ titleOf(fv.key) }}:</span>
          <span class="property-value">
            <template v-if="getIcon(fv.key, dataOf(fv))">
              <Icon
                v-if="isSvgIcon(getIcon(fv.key, dataOf(fv)) as string)"
                :name="getIcon(fv.key, dataOf(fv)) as string"
              />
              <span v-else>{{ getIcon(fv.key, dataOf(fv)) }}</span>
              <span v-if="getLabel(fv.key, dataOf(fv)) && defOf(fv.key)?.displayStyle !== 'icon'">
                {{ getLabel(fv.key, dataOf(fv)) }}
              </span>
            </template>
            <span v-else>{{ getLabel(fv.key, dataOf(fv)) }}</span>
          </span>
          <button
            v-if="hoveredId === fv.id"
            class="delete-button"
            title="删除字段值"
            @click.stop="deleteRow(fv, $event)"
          >
            ×
          </button>
        </div>
      </template>
    </div>
  </div>

  <!-- list：content 下方「挂载即显示」的块字段区（D21 形态分派 + 两列对齐网格）。
       布局对齐 Tana 式字段表：左列字段名（定宽）、右列值区（值前圆点 / chip / 图标）。 -->
  <div
    v-else-if="variant === 'list' && fields.length"
    class="block-field-zone"
  >
    <div
      v-for="def in fields"
      :key="def.id"
      class="block-field-zone-row"
      :role="interactive(def) ? 'button' : undefined"
      :tabindex="interactive(def) ? 0 : undefined"
      :class="{ 'block-field-zone-row--orphan': orphanKeySet.has(def.key), 'block-field-zone-row--inline-editor': rowHasInlineEditor(def), 'block-field-zone-row--readonly': formOf(def) === 'readonly' }"
      :data-field="def.key"
      @click="openFieldRow($event, def)"
      @keydown.enter="openFieldRow($event, def)"
    >
      <!-- 字段名 + 设置入口（ADR-0057 D1）：类型图标即入口（icon 点击 .stop，不会连带
           触发整行快速编辑器），emit → editorStore.openFieldSettings（App 层弹窗）。
           设置入口不分来源：系统定义也可点开（弹窗内整体只读），与标签管理页同权。 -->
      <span class="block-field-zone-title">
        <FieldLabel
          :title="def.title"
          :type="displayFieldType(def)"
          :editable="!def.is_system"
          openable
          @open-settings="editorStore.openFieldSettings(def.id)"
        />
        <span
          v-if="orphanKeySet.has(def.key)"
          class="block-field-zone-orphan-tag"
          title="未关联标签"
        >
          <Unlink :size="12" />
        </span>
      </span>
      <span class="block-field-zone-value">
        <!-- ① 文字形态（D21 决策 5：override 覆写为 text，或 icon 无图标字符回落 text；
             string 除外——其文字形态即内联编辑器，见下方 string 分支）：静态文字行，
             整行保持可点击（rowHasInlineEditor 放行）→ 快速编辑器全类型可编辑。 -->
        <template v-if="formOf(def) === 'text' && def.type !== 'string'">
          <span
            v-if="valueText(def) !== null"
            class="block-field-zone-text"
          >{{ valueText(def) }}</span>
          <span
            v-else
            class="block-field-zone-placeholder"
          >—</span>
        </template>

        <!-- ①·b 只读形态（readonly，D21 通用只读扩展）：跨类型纯展示——复用各类型现有
             可读静态输出（boolean 取 ✓/✗ 图标、其余取 valueText 文字），不挂输入框 /
             内联编辑器，整行不可点（openFieldRow 对 readonly 早退）。值区弱化配色 +
             悬浮提示"只读"；无值出「—」。优先于下方所有类型专属分支。 -->
        <template v-else-if="formOf(def) === 'readonly'">
          <span
            class="bfz-readonly-value"
            title="只读，不可在字段区编辑"
          >
            <template v-if="def.type === 'boolean' && iconCharOf(def)">
              <span class="property-icon">{{ iconCharOf(def) }}</span>
            </template>
            <span
              v-else-if="valueText(def) !== null"
              class="block-field-zone-text"
            >{{ valueText(def) }}</span>
            <span
              v-else
              class="block-field-zone-placeholder"
            >—</span>
          </span>
        </template>

        <!-- ② 图标 / 图标+文字形态（override 或编译期 displayStyle）：值前图标位，
             icon-text 才带值文本；boolean 除外——其 ✓/✗ 图标由 BooleanCheck 承载交互。
             走到这里 iconCharOf 必非空（formByDefId 已把无图标字符的回落为 text）。 -->
        <template v-else-if="(formOf(def) === 'icon' || formOf(def) === 'icon-text') && def.type !== 'boolean'">
          <span class="property-icon">{{ iconCharOf(def) }}</span>
          <span
            v-if="formOf(def) === 'icon-text'"
            class="block-field-zone-text"
          >{{ valueText(def) ?? '—' }}</span>
        </template>

        <!-- daterange 类型字段：值区直接挂 DateRangePicker（区间形态「start → end」胶囊，
             无值占位、单端降级显示单端），点击唤起区间日历录入；
             自带 @click.stop 不触发整行快速编辑器，清除走删行语义（issue T8）。
             门控（usesDefaultForm）：形态覆盖改走 text / icon 档时让位给上方通用形态分支。 -->
        <template v-else-if="def.type === 'daterange' && usesDefaultForm(def)">
          <DateRangePicker
            :model-value="daterangeValueOf(def)"
            placeholder="选择日期区间"
            @update:model-value="onDaterangeChange(def, $event)"
          />
        </template>

        <!-- date 类型字段：值区直接挂 DatePicker（single），点击唤起日历录入；
             自带 @click.stop 不触发整行快速编辑器，清除走删行语义。 -->
        <template v-else-if="def.type === 'date' && usesDefaultForm(def)">
          <DatePicker
            :model-value="dateValue(def)"
            mode="single"
            placeholder="选择日期"
            @update:model-value="onDateChange(def, $event)"
          />
        </template>

        <!-- datetime 类型字段：值区直接挂 DateTimePicker（日历 + 时分档，T2），
             'yyyy-MM-dd HH:mm' 整值落库；自带 @click.stop 不触发整行快速编辑器，
             清除走删行语义（与 date 同路径，dateValue 的字符串提取对两者通用）。 -->
        <template v-else-if="def.type === 'datetime' && usesDefaultForm(def)">
          <DateTimePicker
            :model-value="dateValue(def)"
            placeholder="选择日期时间"
            @update:model-value="onDateTimeChange(def, $event)"
          />
        </template>

        <!-- number 特化 rating（issue T7）：值区直挂 RatingInput 星级编辑（1–N 星），
             点击置值 / 再点同值清空走删行语义（undefined = 未填契约与 NumberInput 一致）。 -->
        <template v-else-if="def.type === 'number' && numberSpecKindOf(def) === 'rating' && usesDefaultForm(def)">
          <RatingInput
            :model-value="numberValue(def)"
            :aria-label="def.title || '评分'"
            @update:model-value="onNumberChange(def, $event)"
          />
        </template>

        <!-- number 类型字段：值区直接挂 NumberInput（内联输入 + ± 步进），
             约束来自字段定义（min/max/step，percent 特化默认 0–100），清除走删行语义（ADR-0055）。
             特化装饰（issue T7）：currency 符号前置 / 单位后置（编辑仍是数字输入）；
             percent 附细进度条展示当前值在 0–100 区间的进度。无特化走原路径零回归。 -->
        <template v-else-if="def.type === 'number' && usesDefaultForm(def)">
          <span
            v-if="numberSpecKindOf(def) === 'currency'"
            class="bfz-currency-symbol"
          >{{ currencyFormatOf(def).symbol }}</span>
          <NumberInput
            :model-value="numberValue(def)"
            :min="effectiveBoundsOf(def).min"
            :max="effectiveBoundsOf(def).max"
            :step="def.step"
            placeholder="输入数值"
            @update:model-value="onNumberChange(def, $event)"
          />
          <span
            v-if="numberSpecKindOf(def) === 'currency' && currencyFormatOf(def).unit"
            class="bfz-currency-unit"
          >{{ currencyFormatOf(def).unit }}</span>
          <span
            v-else-if="numberSpecKindOf(def) === 'percent'"
            class="bfz-percent-track"
            :style="{ '--bfz-percent': `${percentOf(def)}%` }"
            :aria-label="`进度 ${percentOf(def)}%`"
          >
            <span class="bfz-percent-fill" />
          </span>
        </template>

        <!-- boolean 类型字段：值区直接挂 BooleanCheck（勾选交互，icon / icon-text 形态下
             值即 ✓ / ✗，无值出 ghost 占位；icon-text 额外带值文本）。点击直接切换落库，
             不弹通用编辑器；BooleanCheck 仅循环 undefined→true→false→true，无法回到
             undefined，故在有值时附 × 清除按钮，走 onBooleanChange(def, undefined) 删行
             （未填语义）。两者均 @click.stop 不触发整行快速编辑器。
             chip / text 覆写不走此分支：分别落通用 chip（是/否）与静态文字行。 -->
        <template v-else-if="def.type === 'boolean' && (formOf(def) === 'icon' || formOf(def) === 'icon-text')">
          <BooleanCheck
            :model-value="booleanValue(def)"
            :aria-label="def.title || '布尔值'"
            @update:model-value="onBooleanChange(def, $event)"
          />
          <span
            v-if="formOf(def) === 'icon-text'"
            class="block-field-zone-text"
          >{{ valueText(def) ?? '—' }}</span>
          <button
            v-if="booleanValue(def) !== undefined"
            type="button"
            class="bfz-clear-button"
            title="清除"
            :aria-label="`清除${def.title || '布尔值'}`"
            @click.stop="onBooleanChange(def, undefined)"
          >
            ×
          </button>
        </template>

        <!-- boolean 开关形态（switch）：值区直挂开关 UI，点击直接切换落库，不弹编辑器；
             自带 @click.stop 不触发整行快速编辑器；有值附 × 清除按钮走删行语义。
             icon / icon-text 覆写不走此分支（走上方 BooleanCheck 勾叉分支）。 -->
        <template v-else-if="def.type === 'boolean' && formOf(def) === 'switch'">
          <button
            type="button"
            class="bfz-switch"
            :class="{
              'bfz-switch--on': booleanValue(def) === true,
              'bfz-switch--off': booleanValue(def) === false,
              'bfz-switch--empty': booleanValue(def) === undefined,
            }"
            role="switch"
            :aria-checked="booleanValue(def) === true"
            :aria-label="def.title || '开关'"
            :title="booleanValue(def) === true ? '是（点击切换为否）' : booleanValue(def) === false ? '否（点击切换为是）' : '未填（点击标记为是）'"
            @click.stop="onBooleanToggle(def)"
          >
            <span class="bfz-switch-knob" />
          </button>
          <button
            v-if="booleanValue(def) !== undefined"
            type="button"
            class="bfz-clear-button"
            title="清除"
            :aria-label="`清除${def.title || '开关'}`"
            @click.stop="onBooleanChange(def, undefined)"
          >
            ×
          </button>
        </template>

        <!-- relation 类型字段（关系引用，issue T5）：值区直挂 RelationRefEditor
             （两段式面板：关系类型 + 目标块/页搜索）。有值渲染按关系类型着色的
             链接 chip（--relation-color 变量，色值来自 relationship_type 用户数据，
             非代码硬编码；悬空目标降级中性 chip）；清除走删行语义。
             字段定义约定的关系类型经 closed_values[0] 传入（配置位见 tag-persisted.ts）。
             自带 @click.stop 不触发整行快速编辑器，清除走删行语义。
             门控（usesDefaultForm）：text 覆写让位给静态文字行（valueText 出目标标题）。 -->
        <template v-else-if="def.type === 'relation' && usesDefaultForm(def)">
          <RelationRefEditor
            :model-value="relationValue(def)"
            :relationship-type-id="def.closed_values?.[0] ?? ''"
            :exclude-id="blockId"
            @update:model-value="onRelationChange(def, $event)"
          />
        </template>

        <!-- 枚举字段（封闭选项 + chip 形态）：值区直挂通用枚举组件 EnumSelect，
             选项取编译期定义（label/icon/description）优先、持久化 closed_values 兜底；
             multiSelect（T4）分流到 MultiEnumSelect（多选 chip，值以数组落库）。
             触发按钮自带 @click.stop 不触发整行快速编辑器，清除走删行语义。 -->
        <template v-else-if="isEnumField(def) && formOf(def) === 'chip'">
          <MultiEnumSelect
            v-if="def.type === 'multiSelect'"
            :options="enumOptionsOf(def)"
            :model-value="multiEnumValue(def)"
            placeholder="未填"
            @update:model-value="onMultiEnumChange(def, $event)"
          />
          <EnumSelect
            v-else
            :options="enumOptionsOf(def)"
            :model-value="enumValue(def)"
            placeholder="未填"
            @update:model-value="onEnumChange(def, $event)"
          />
        </template>

        <!-- file 字段（附件，issue T9）：值区直挂 FileRefEditor——无值 28px 上传按钮，
             有值图片缩略图 / 附件 chip，点击 chip 内置 lightbox 预览；清除走删行语义。
             自带 @click.stop 不触发整行快速编辑器。 -->
        <template v-else-if="def.type === 'file' && usesDefaultForm(def)">
          <FileRefEditor
            :model-value="fileValue(def)"
            @update:model-value="onFileChange(def, $event)"
          />
        </template>

        <!-- page 字段（页面引用，issue T3）：有值渲染引用 chip（page id 反查标题展示，
             悬空 id 降级原始 id 弱化样式），点击跳转目标页（onFieldActivate 导航语义）；
             无值直挂 PageRefPicker（搜索选择现有页面，值存 page id 落库），
             自带 @click.stop 不触发整行快速编辑器（pageRef 文本兜底已替换）。
             page 特化 person（issue T10）：picker 候选限定 person 页（personOnly），
             有值渲染人员 chip（首字圆形头像 + 名字，点击跳转与 page 引用同路径）。 -->
        <template v-else-if="def.type === 'page' && usesDefaultForm(def)">
          <template v-if="chipValues(def)">
            <span
              v-for="(v, i) in chipValues(def)"
              :key="i"
              class="block-field-zone-chip"
              :class="{
                'block-field-zone-chip--page': true,
                'block-field-zone-chip--person': isPersonField(def),
                'block-field-zone-chip--dangling': isDanglingPageRef(v),
              }"
              :data-field="def.key"
              :title="`${titleOf(def.key)}: ${pageTitleOf(v)}`"
              @click.stop="onFieldActivate($event, def, v)"
              @keydown.enter.stop="onFieldActivate($event, def, v)"
            >
              <span
                v-if="isPersonField(def)"
                class="bfz-person-avatar"
                aria-hidden="true"
              >{{ personAvatarChar(v) }}</span>
              <span class="bfz-chip-value">{{ pageTitleOf(v) }}</span>
            </span>
            <button
              type="button"
              class="bfz-clear-button"
              title="清除"
              :aria-label="`清除${def.title || '页面引用'}`"
              @click.stop="onPageRefChange(def, undefined)"
            >
              ×
            </button>
          </template>
          <PageRefPicker
            v-else
            :person-only="isPersonField(def)"
            :placeholder="isPersonField(def) ? '选择人员' : '选择页面'"
            @update:model-value="onPageRefChange(def, $event)"
          />
        </template>

        <!-- color 类型字段（issue T12）：色板图例 + 名称。值区直挂色点（复用
              --tag-color-* token），非法 token 回落幽灵占位；整行点击唤起编辑器改色。 -->
        <template v-else-if="def.type === 'color' && usesDefaultForm(def)">
          <span
            v-if="colorValueOf(def)"
            class="bfz-color-swatch"
            :style="{ background: `var(${colorValueOf(def)})` }"
            :title="colorLabelOf(def)"
          />
          <span
            v-if="colorValueOf(def)"
            class="bfz-color-label"
          >{{ colorLabelOf(def) }}</span>
          <span
            v-else
            class="block-field-zone-placeholder"
          >—</span>
        </template>

        <!-- chip 形态（非枚举）：array（chip 序列）/ boolean + chip 覆写（是/否）/
             number + chip 覆写（徽章）。字段名已在左列，chip 本体不再内嵌标题。 -->
        <template v-else-if="formOf(def) === 'chip'">
          <template v-if="chipValues(def)">
            <span
              v-for="(v, i) in chipValues(def)"
              :key="i"
              class="block-field-zone-chip"
              :data-field="def.key"
              @click.stop="onFieldActivate($event, def, v)"
              @keydown.enter.stop="onFieldActivate($event, def, v)"
            >
              <span class="bfz-chip-value">{{ v }}</span>
            </span>
          </template>
          <!-- 无值：虚线 ghost 胶囊，点击即录入（D21 决策 7） -->
          <span
            v-else
            class="block-field-zone-chip block-field-zone-chip--ghost"
            :data-field="def.key"
            @click.stop="openFieldRow($event, def)"
            @keydown.enter.stop="openFieldRow($event, def)"
          >
            <span class="bfz-chip-value bfz-chip-value--ghost">未填</span>
          </span>
        </template>

        <!-- 纯 string（自由文本）字段：按特化标记分派（issue T6）——
             url：有值出可点击链接（点行改值），无值占位；richtext：多行 textarea 就地编辑 +
             最小 markdown 渲染；email / phone：SpecializedText（格式校验 + 红字提示）；
             无特化：TextField（单行输入 + 清除 ×，原路径零回归）。
             自带 @click.stop 不触发整行快速编辑器，清除走删行语义。
             readonly 形态已在上方 ①·b 分支优先处理，此处不再命中。 -->
        <template v-else-if="def.type === 'string' && !isEnumField(def) && formOf(def) !== 'readonly'">
          <!-- url 特化（AC3）：字段区可点击打开 -->
          <template v-if="def.spec === 'url'">
            <a
              v-if="urlHrefOf(def)"
              class="block-field-zone-link"
              :href="urlHrefOf(def) ?? undefined"
              :title="`打开链接：${valueText(def)}`"
              @click.stop.prevent="openExternal(urlHrefOf(def) as string)"
            >{{ valueText(def) }}</a>
            <span
              v-else
              class="block-field-zone-placeholder"
            >—</span>
          </template>

          <!-- richtext 特化（AC4）：多行 textarea 编辑 / markdown 渲染切换 -->
          <template v-else-if="def.spec === 'richtext'">
            <textarea
              v-if="isRichEditing(def)"
              ref="richTextareaEl"
              v-model="richDraft"
              class="bfz-richtext-input"
              rows="2"
              placeholder="输入 markdown（**粗** *斜* `码` [链](接)）"
              :aria-label="`编辑${def.title}`"
              data-testid="bfz-richtext-input"
              @input="autoGrowRich"
              @blur="commitRichEdit(def)"
              @keydown.esc.prevent="cancelRichEdit"
            />
            <!-- vue/no-v-html: mini-markdown 渲染器先整体 HTML 转义再套标记（renderInlineMarkdown），受控输出 -->
            <!-- eslint-disable vue/no-v-html -->
            <span
              v-else-if="valueText(def) !== null"
              class="bfz-richtext"
              title="点击编辑"
              data-testid="bfz-richtext"
              @click.stop="startRichEdit(def)"
              v-html="richHtml(def)"
            />
            <!-- eslint-enable vue/no-v-html -->
            <span
              v-else
              class="block-field-zone-placeholder"
              title="点击填写"
              data-testid="bfz-richtext-placeholder"
              @click.stop="startRichEdit(def)"
            >—</span>
          </template>

          <!-- email / phone 特化（AC2）：格式校验 + 错误提示 + 回车不落库 -->
          <SpecializedText
            v-else-if="def.spec && stringSpecialization(def.spec)"
            :spec="def.spec"
            :model-value="textValue(def)"
            :placeholder="stringPlaceholderOf(def)"
            @update:model-value="onTextChange(def, $event)"
          />

          <TextField
            v-else
            :model-value="textValue(def)"
            :placeholder="stringPlaceholderOf(def)"
            @update:model-value="onTextChange(def, $event)"
          />
        </template>

        <!-- 最终兜底（string + closed_values 的 text 覆写等少数路径）：静态文字行，
             值前圆点标记，无值出「—」占位；整行仍是点击目标（唤起通用编辑器）。 -->
        <template v-else>
          <span
            v-if="valueText(def) !== null"
            class="block-field-zone-text"
          >{{ valueText(def) }}</span>
          <span
            v-else
            class="block-field-zone-placeholder"
          >—</span>
        </template>
      </span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
/* ── 内联槽（原 PropertyInline） ── */
.property-inline {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 内容行尾槽（priority 象限网格图标，ADR-0054 D3）：
   与 `between` 槽同为内联位置差异，靠 margin-left 推到行尾。
   尺寸 18 —— 旧注释的「20px 下限」实测对象是已被 ADR 否决的十字轴图元，
   对现用的 2×2 方格不成立；18 为按 D5#1（灰度下位置可辨）复核后的取值。
   本槽同时承担降层级（ADR-0054 D6）：强度只压点亮格，栅格（参照系）保持不变。 */
.property-inline--right {
  margin-left: auto;
  padding-left: 10px;
}

/* 整体减重：让图标比正文轻，不再与正文字号争视觉重量 */
.property-inline--right .property-inline-item {
  opacity: 0.7;
  transition: opacity var(--dur-fast) var(--ease-out);
}

/* hover 澄清而非膨胀：恢复到全不透明，取消 `between` 槽沿用的 scale(1.15) 放大 */
.property-inline--right .property-inline-item:hover {
  transform: none;
  opacity: 1;
}

/* 默认档 Low 不是信号、是「背景态」（新建任务默认即 Low，出现频率最高）：
   只压暗点亮格 —— 栅格照旧，位置读数不受影响 */
.property-inline--right .property-inline-item[data-field='priority'][data-value='Low'] :deep(.pq-lit) {
  opacity: 0.4;
}

/* hover 恢复 Low 的可辨性，保住「可点击编辑」的发现性 */
.property-inline--right .property-inline-item[data-field='priority'][data-value='Low']:hover :deep(.pq-lit) {
  opacity: 1;
}

.property-inline--right :deep(.property-icon) {
  /* 图标尺寸由上方 Icon 的 :size 传入（本槽为 14），此处仅对齐基线 */
  line-height: 1;
  opacity: 0.8;
}

.property-inline-item {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 2px 6px;
  padding-right: 20px;
  transition: background var(--dur-fast) var(--ease-out);
  font-size: var(--text-sm);
  position: relative;
  /* 确保内部所有元素的基线对齐 */
  line-height: var(--leading-normal);
}

.property-inline-item.built-in {
  font-weight: var(--font-medium);
}

.property-inline-item.icon-only {
  padding: 2px 0;
  padding-right: 0;
}

.property-inline-item.icon-only .property-icon {
  margin-right: 0;
  font-size: var(--text-lg);
  display: flex;
  align-items: center;
  justify-content: center;
}

.property-inline-item:hover {
  transform: scale(1.15);
}

.property-icon {
  margin-right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 确保 icon 和文本的垂直对齐 */
  line-height: var(--leading-none);
}

/* ── chips / all / book-note（原 PropertyDisplay） ── */
.property-display {
  margin-top: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  // 刻意不设 max-width：本类名同时被书笔记来源行（.property-display.book-note-source）
  // 复用，在此限宽会把来源行框成 240px 窄条、长原文引用竖着堆成几百像素高（实测 426px）。
  // 刻意不做主题自适应：几乎不可见的微暗纱。
  background-color: var(--surface-faint);
}

/* 书笔记紧凑来源行：Pin + [章节] + 原文引用（原文引用可完整换行） */
.book-note-source {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  width: 100%;
  gap: 6px;
  /* 左缘与字段区 list 行对齐（统一由 .block-properties 的 margin-left 定位，
     不再单独右缩进——来源行 / 字段行 / 子块 status 图标同列） */
  padding: 4px 8px;
  border-radius: 4px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.book-note-source.can-jump {
  cursor: pointer;
}

.book-note-source.can-jump:hover {
  background: var(--accent-08);
  color: var(--accent);
}

.source-pin {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.source-chapter {
  flex-shrink: 0;
  color: var(--text-secondary);
  font-weight: 500;
}

/* 原文引用占满整行（换行到第二行），左对齐到章节之下 */
.source-quote {
  flex: 1 1 100%;
  margin-left: 14px;
  color: var(--text-tertiary);
  font-style: italic;
}

.property-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0px;
}

/* 票 06：quote 字段（高亮原文）单行截断，悬浮 title 看全文 */
.property-item.quote-item .property-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 420px;
  display: inline-block;
  vertical-align: bottom;
}

.property-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-sm);
  cursor: pointer;
  padding: 2px 4px;
  // 行内：× 只在 hover 出现，故常驻不留 20px 占位——那会把每个 chip 白撑宽 16px
  // （实测 93.1 → 77.1），两列合计 32px 提前顶到容器 max-width 上限。
  // 浮层内的 item 例外（× 常驻），见 .property-list--full 规则。
  padding-right: 4px;
  border-radius: 4px;
  transition: background var(--dur-fast) var(--ease-out);
  position: relative;
}

.property-item:hover {
  background: var(--accent-08);
  // hover 才为「×」腾位（容器右端固定，chips 区整体向左扩 16px；实测不换行、不推正文）
  padding-right: 20px;
}

/* 浮层是字段的管理面：× 常驻显示，因此也要常驻留出占位——与行内「hover 才腾位」相反 */
.property-list--full .property-item {
  padding-right: 20px;
}

.property-item.built-in .property-key {
  color: var(--primary-color, #007bff);
  font-weight: var(--font-medium);
}

.property-key {
  color: #6b7280;
}

.property-value {
  color: #374151;
}

.delete-button {
  position: absolute;
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--heading-5);
  line-height: var(--leading-none);
  color: #9ca3af;
  padding: 0 4px;
  border-radius: 4px;
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.delete-button:hover {
  color: #374151;
  background: rgba(0, 0, 0, 0.05);
}

/* ── list 变体（块字段区，D21 形态分派 + 两列对齐网格） ── */
/* 布局对齐 Tana 式字段表：每行 = 左列字段名（FieldLabel：类型图标 + 定宽名，超长省略；
   左列定宽 = 6em 名 + 26px 图标与间距）+ 右列值区。
   定宽而非 max-content——独立行的 track 各自求解时 max-content 会对不齐。 */
.block-field-zone {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px 0;
}

.block-field-zone-row {
  display: grid;
  grid-template-columns: calc(6em + 26px) minmax(0, 1fr);
  column-gap: var(--space-3, 12px);
  align-items: center;
  font-size: var(--text-sm);
  cursor: pointer;
  border-radius: var(--radius-sm);
  padding: 2px 6px;

  /* 行 hover 底只给「真可点」的行：整行点一下开快速编辑器。
     date / number / boolean / 枚举行不是点击目标（openFieldRow 对四者早退，编辑由内嵌
     DatePicker / NumberInput / BooleanCheck / EnumSelect 独占），只读形态行同样非交互，
     故排除其行 hover，避免「行底 + 控件 hover」在暗色下并档糊成一片。 */
  &:not(.block-field-zone-row--inline-editor):not(.block-field-zone-row--readonly):hover {
    background: var(--surface-subtle);
  }
}

/* date / number / boolean / 枚举行非按钮：光标回默认，焦点交给内嵌控件。 */
.block-field-zone-row--inline-editor {
  cursor: default;
}

/* 只读形态（D21 通用只读扩展）：整行非交互——光标默认、字段名弱化、去 hover 底。 */
.block-field-zone-row--readonly {
  cursor: default;

  .block-field-zone-title {
    color: var(--text-tertiary);
  }
}

.bfz-readonly-value {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  /* 只读值弱化：与字段名同档 tertiary，明确"展示态、不可编辑"。 */
  color: var(--text-tertiary);

  .property-icon,
  .property-value,
  .block-field-zone-text {
    color: inherit;
  }
}

/* all 变体只读项：非交互，与 list 变体同视觉基调。 */
.bfz-readonly-item {
  cursor: default;
}

.block-field-zone-title {
  display: inline-flex;
  overflow: hidden;
  align-items: center;
  min-width: 0;
  color: var(--text-secondary);
  white-space: nowrap;

  /* FieldLabel 的名格在左列剩余空间内截断（列宽 = 6em 名 + 26px 图标与间距） */
  :deep(.field-label) {
    min-width: 0;
  }
}

/* 孤儿字段（选项 A）：删 tag / 去 tag 后悬空值——弱区分样式让值可见可编辑。
   标题降权 + 尾部 Unlink 断链图标（12px，--text-tertiary），不抢正常字段的视觉权重。 */
.block-field-zone-row--orphan .block-field-zone-title {
  color: var(--text-tertiary);
}

.block-field-zone-orphan-tag {
  display: inline-flex;
  color: var(--text-tertiary);
  margin-left: 6px;
  flex: none;
  opacity: 0.85;
  vertical-align: middle;
}

/* 右列值区：多值（chip 序列）折行排布 */
.block-field-zone-value {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
  min-width: 0;
}

/* text 形态的值行：值前小圆点标记（对齐参考布局的 bullet 节奏） */
.block-field-zone-text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-primary);
  min-width: 0;

  &::before {
    flex: none;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--text-tertiary);
    content: '';
  }
}

.block-field-zone-placeholder {
  color: var(--text-tertiary);
}

.block-field-zone-row .property-icon {
  margin-right: 0;
  color: var(--text-secondary);
  font-size: var(--text-base);
  line-height: var(--leading-none);
}

/* chip 形态（D21 决策 5）：描边幽灵款——1px 中性描边 + 透明底，不与 block-tag /
   date-ref 的实底胶囊争层级（字段值退后，色环仍只留给 tag 一家）；hover 才补淡底。
   list 变体下 chip 不内嵌字段名（左列已示），all 变体的 chip 仍带 .bfz-chip-title。 */
.block-field-zone-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 0 7px;
  font-size: var(--text-sm);
  line-height: calc(var(--leading-normal) * var(--text-sm));
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);

  &:hover {
    background: var(--surface-subtle);
    border-color: var(--border-strong);
  }
}

/* page 引用 chip：强调色值文本（对齐 [[page]] 的 block-link 语义） */
.block-field-zone-chip--page .bfz-chip-value {
  color: var(--accent);
}

/* page 引用悬空 id（目标页已删 / 无效）：降级显示原始 id，弱化样式示断链 */
.block-field-zone-chip--dangling .bfz-chip-value {
  color: var(--text-tertiary);
}

/* person 特化（issue T10）：人员 chip —— 首字圆形头像 + 名字（无真实头像数据，
   首字圆形头像顶位；底色取强调色低透明 token，名字沿用 page 引用的强调色）。
   点击跳转与 page 引用同路径（onFieldActivate），圆角改全圆示「人」。 */
.block-field-zone-chip--person {
  border-radius: 999px;

  .bfz-person-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent-08);
    color: var(--accent);
    font-size: var(--text-xs);
    line-height: 1;
  }
}

.bfz-chip-title {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.bfz-chip-value {
  color: var(--text-primary);
}

/* 无值 ghost（D21 决策 7）：与填充 chip 同构、虚线示缺，点击即录入。
   填充侧改描边款后，虚线/实线的对比不再倒挂——虚线=空位，实线=有值。 */
.block-field-zone-chip--ghost {
  border-style: dashed;

  .bfz-chip-title,
  .bfz-chip-value--ghost {
    color: var(--text-tertiary);
  }
}

/* ── string 特化（issue T6） ── */

/* url 特化：字段区可点击链接（强调色对齐 page 引用 chip 的 block-link 语义） */
.block-field-zone-link {
  color: var(--accent);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  min-width: 0;

  &:hover {
    text-decoration: underline;
  }
}

/* richtext 展示态：最小 markdown 渲染（v-html 内容已转义），保留换行间距 */
.bfz-richtext {
  color: var(--text-primary);
  min-width: 0;
  max-width: 100%;
  word-break: break-word;
  cursor: text;

  :deep(code) {
    padding: 0 4px;
    border-radius: var(--radius-sm);
    background: var(--surface-subtle);
    font-size: var(--text-sm);
  }

  :deep(a) {
    color: var(--accent);
  }
}

/* richtext 编辑态：多行 textarea，自动增高（JS 设 height），行内不起编辑浮层 */
.bfz-richtext-input {
  flex: 1 1 auto;
  min-width: 0;
  box-sizing: border-box;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
  line-height: var(--leading-normal);
  padding: 4px 8px;
  outline: none;
  resize: none;
  overflow: hidden;
  min-height: 28px;
  border-radius: var(--radius-sm);

  &::placeholder {
    color: var(--text-tertiary);
  }

  &:focus {
    background: var(--bg-active);
  }
}

/* ── number 特化族装饰（issue T7）────────────────────────── */

/* currency：符号前置 / 单位后置（编辑仍是 NumberInput 数字输入） */
.bfz-currency-symbol,
.bfz-currency-unit {
  flex: none;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-none);
}

/* percent：细进度条（值在 0–100 区间的进度；CSS var 传值，无 JS 宽度计算） */
.bfz-percent-track {
  --bfz-percent: 0%;

  position: relative;
  flex: 0 1 80px;
  height: 4px;
  border-radius: 2px;
  background: var(--surface-subtle);
  overflow: hidden;
}

.bfz-percent-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--bfz-percent);
  border-radius: 2px;
  background: var(--accent);
  transition: width var(--dur-base) var(--ease-out);
}

/* 内联清除按钮（boolean / page 字段值区）：与 .delete-button 同源的弱化 ×，
   仅在有值时存在，点击走删行语义（boolean→onBooleanChange(def, undefined)；
   page→onPageRefChange(def, undefined)）。常态隐藏，整行 hover / 键盘 focus
   时显形（与 .delete-button 同口径），不抢控件、隐藏时也不占 tab 序。 */
.bfz-clear-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  font-size: var(--text-base);
  line-height: var(--leading-none);
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out),
    visibility var(--dur-fast) var(--ease-out);

  .block-field-zone-row:hover &,
  .block-field-zone-row:focus-within & {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
  }

  &:hover {
    color: var(--text-primary);
    background: var(--surface-subtle);
  }
}

/* ── T12 color 字段色板图例 ── */

.bfz-color-swatch {
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px var(--border-color);
}

.bfz-color-label {
  color: var(--text-primary);
  font-size: var(--text-sm);
}

/* ── boolean 开关形态（switch）：28px 基线对齐专属控件，点按切换落库 ── */
.bfz-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: none;
  width: 34px;
  height: 18px;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-hover);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);

  .bfz-switch-knob {
    position: absolute;
    left: 1px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--text-tertiary);
    transition:
      transform var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  /* 否：仍为 off 态，但显出微弱边框以区别于空 */
  &--off .bfz-switch-knob {
    background: var(--text-secondary);
  }

  /* 是：开启态，滑块右移 + 强调色（复用 success 绿，与 BooleanCheck 勾叉同语义） */
  &--on {
    background: var(--success);
    border-color: var(--success);

    .bfz-switch-knob {
      transform: translateX(16px);
      background: #fff;
    }
  }

  /* 未填：虚线示缺（与 chip / BooleanCheck ghost 同构） */
  &--empty {
    border-style: dashed;
    background: transparent;

    .bfz-switch-knob {
      background: var(--text-tertiary);
    }
  }

  &:hover {
    border-color: var(--border-strong);
  }
}
</style>
