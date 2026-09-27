<script setup lang="ts">
/**
 * 标签管理页（ADR-0050 D5）：左栏（统计副标题 / 搜索 / 全部·最近使用·未使用 /
 * 行 = 标题胶囊 · 成员数 · 字段数 · 来源）+ 右栏详情（成员与来源页统计 / 字段模板四列表 /
 * 单父继承区 / 删除标签）。
 *
 * 字段模板是四列表（字段 | 类型 | 默认 | 来源）：前三列就地编辑（点一下变控件 / 类型下拉），
 * 第四列只读（自身 / 声明它的祖先标签）—— 没有「编辑」按钮与展开面板（ADR-0050 D14）。
 *
 * 边界与归属：
 * - 打标入口不在此页 —— 建实体 ≠ 打标，打标仍唯一走 content `#名`（ADR-0049 D6）。
 * - 「新建标签」= 标题 + 可选父标签；「+ 添加字段」= 建字段定义 + 追加该标签自身字段。
 * - 成员口径：管理页用**直系数**（ADR-0050 D10 #3）；含后代的聚合口径只在 tag 聚合页用。
 * - 字段数口径：**有效字段数**（含继承，即该标签下真正可填的字段数量）。
 * - 继承解析（有效字段集合）单源在 Rust，本页只消费 store 的解析结果。
 * - **系统标签右栏只读**：字段 / 继承 / 删除一律不给可点入口 —— Rust 侧
 *   `reject_system_tag` 已拒，UI 若照给按钮就是静默失败（点了没反应且无提示）。
 * - 字段定义是全局共享的，故只有**自身声明**的字段可在此编辑（继承方无权改他人定义）。
 * - 进聚合页的入口在本页右栏标题行（`/tags/:tagId`）。
 */
import { ChevronDown, Pencil, Plus, Search, X } from 'lucide-vue-next'
import type { ObjectDirective } from 'vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useNavigateToTag } from '../../composables/useNavigateToTag'
import { useBlockCardStore } from '../../stores/blockCard'
import { useTagsStore } from '../../stores/tags'
import type {
  PersistedFieldDefinition,
  PersistedTag,
  UpdateFieldDefinitionParams,
} from '../../types/tag-persisted'
import { isTagColorToken, tagDotStyle } from '../../utils/tag-color'
import BasePopover from '../common/BasePopover.vue'
import PageTitle from '../common/PageTitle.vue'
import ConfirmDialog from '../ConfirmDialog.vue'
import TagColorPicker from './TagColorPicker.vue'
import TagDescriptionField from './TagDescriptionField.vue'

/**
 * 预选标签（ADR-0050 D12「一步到达」）：聚合页的「设置」入口经 `/tags?tag=<id>` 传入，
 * 由路由 props 映射成入参 —— 组件不读 route，选中逻辑因此可脱路由单测。
 *
 * 语义是**选中提示**而非受控值：到达后用户仍可自由点其它标签（URL 不变，不反向回写）。
 */
const props = defineProps<{ selectTagId?: string }>()

const tagsStore = useTagsStore()
const blockCardStore = useBlockCardStore()
const { navigateToTag } = useNavigateToTag()

type FilterMode = 'all' | 'recent' | 'unused'

const searchQuery = ref('')
const filterMode = ref<FilterMode>('all')
const selectedTagId = ref<string | null>(null)

/** 应用「预选提示」：仅在提示能解析成真实标签时才改写选中态（否则交由下面的默认选中兜底）。 */
function applySelectHint() {
  const hint = props.selectTagId
  if (hint && tagsStore.getTagById(hint)) selectedTagId.value = hint
}

onMounted(async () => {
  await Promise.all([tagsStore.ensureLoaded(), blockCardStore.getCards()])
  applySelectHint()
  if (!selectedTagId.value && tagsStore.allTags.length) {
    selectedTagId.value = sortedByMembers(tagsStore.allTags)[0].id
  }
})

// 路由 props 可在不重新挂载的情况下变化（同路由只换 query）→ 提示需随之重放。
// 只在 `selectTagId` 自身变化时触发：不监听标签树，避免保存描述后的整体重读把用户
// 刚点开的标签拽回提示值。
watch(
  () => props.selectTagId,
  () => applySelectHint(),
)

// ── 左栏：统计与列表 ──────────────────────────────────────────

const statsSubtitle = computed(() => {
  const all = tagsStore.allTags
  const withParent = all.filter((t) => !!t.parent_id).length
  const members = all.reduce((sum, t) => sum + tagsStore.memberSummary(t.id).count, 0)
  return `${all.length} 个标签 · ${withParent} 个带父标签 · ${members} 个成员`
})

const filterChips = computed<Array<{ key: FilterMode; label: string; count: number | null }>>(
  () => [
    { key: 'all', label: '全部', count: tagsStore.allTags.length },
    { key: 'recent', label: '最近使用', count: null },
    { key: 'unused', label: '未使用', count: tagsStore.unusedTags().length },
  ],
)

function memberCount(tagId: string): number {
  return tagsStore.memberSummary(tagId).count
}

/** 有效字段数（含继承）——即该标签下真正可填的字段数量。 */
function fieldCount(tagId: string): number {
  return tagsStore.effectiveFieldIds(tagId).length
}

/** 按直系成员数降序，同数按标题——常用标签浮在上面。 */
function sortedByMembers(list: PersistedTag[]): PersistedTag[] {
  return [...list].sort(
    (a, b) => memberCount(b.id) - memberCount(a.id) || a.title.localeCompare(b.title),
  )
}

const filteredTags = computed<PersistedTag[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const base =
    filterMode.value === 'recent'
      ? tagsStore.recentTags()
      : filterMode.value === 'unused'
        ? tagsStore.unusedTags()
        : tagsStore.allTags
  const list = q ? base.filter((t) => t.title.toLowerCase().includes(q)) : [...base]
  // 「最近使用」按成员块 recent 序（store 已排）；其余按成员数降序
  return filterMode.value === 'recent' ? list : sortedByMembers(list)
})

/** 来源徽标：未使用 → 无成员；有父 → ← 父名；否则顶级标签。 */
function sourceLabel(tag: PersistedTag): string {
  if (memberCount(tag.id) === 0) return '未使用'
  const parent = tagsStore.parentTagOf(tag.id)
  return parent ? `← ${parent.title}` : '顶级标签'
}

// ── 右栏：详情 ────────────────────────────────────────────────

const selectedTag = computed(() =>
  selectedTagId.value ? tagsStore.getTagById(selectedTagId.value) : undefined,
)

/** 系统标签（内置定义）→ 右栏全部写入口收起，只留只读呈现。 */
const isSystemTag = computed(() => !!selectedTag.value?.is_system)

/**
 * 身份写入口（ADR-0050 D11/D12）：与聚合页标题区共用 `setIdentity` 与同一个字段组件，
 * 空串 = 清空描述。
 */
async function onSaveDescription(value: string) {
  if (!selectedTag.value) return
  await tagsStore.setIdentity(selectedTag.value.id, { description: value })
}

/** 身份写入口之三：颜色。`null` = 选了「无色」→ 发空串（D11：空串是有效值）。 */
async function onPickColor(color: string | null) {
  if (!selectedTag.value) return
  await tagsStore.setIdentity(selectedTag.value.id, { color: color ?? '' })
}

/**
 * 色点是否显示为「无色」空心环。判据必须与 `tagDotStyle` **同一个**（`isTagColorToken`）——
 * 否则未白名单的历史色值会出现「有类无色 / 无色无类」错配，最坏情况是渲染成一个
 * 既无背景又无边框的不可见点。
 */
function isColorless(color: string): boolean {
  return !isTagColorToken(color)
}

/** 进该标签的聚合页（D7）。 */
function openAggregatePage() {
  if (!selectedTag.value) return
  navigateToTag(selectedTag.value.id).catch((err) => {
    console.error('打开标签聚合页失败:', err)
  })
}

const detailSummary = computed(() =>
  selectedTag.value
    ? tagsStore.memberSummary(selectedTag.value.id)
    : { count: 0, pageCount: 0 },
)

/** 字段模板行：有效字段（含继承）+ 来源标签（自身 / 继承自哪个祖先）。 */
const detailFields = computed(() => {
  const tag = selectedTag.value
  if (!tag) return [] as Array<{ def: PersistedFieldDefinition; origin: PersistedTag | undefined }>
  return tagsStore.effectiveFieldDefinitions(tag.id).map((def) => ({
    def,
    origin: tagsStore.fieldOrigin(tag.id, def.id),
  }))
})

/** 字段类型显示名（`select` 是由 closed_values 派生的伪类型）。 */
const TYPE_LABELS: Record<string, string> = {
  string: '文本',
  number: '数值',
  date: '日期',
  boolean: '是/否',
  page: '页面引用',
  array: '列表',
  select: '枚举',
}

/** 类型点选顺序（新建与类型下拉共用；`select` 落库为 type string + closed_values）。 */
const FIELD_TYPE_VALUES = ['string', 'number', 'date', 'select']

const FIELD_TYPE_OPTIONS = FIELD_TYPE_VALUES.map((value) => ({ value, label: TYPE_LABELS[value] }))

function typeLabel(def: PersistedFieldDefinition): string {
  return TYPE_LABELS[def.closed_values?.length ? 'select' : def.type] ?? def.type
}

/** 该字段是否由本标签自己声明（决定能否从本标签移除 / 编辑其定义）。 */
function isOwnField(origin: PersistedTag | undefined): boolean {
  return !!origin && !!selectedTag.value && origin.id === selectedTag.value.id
}

/** 可编辑 = 自身声明 + 非系统标签（继承字段的定义归祖先，改它等于改所有引用方）。 */
function canEditField(origin: PersistedTag | undefined): boolean {
  return isOwnField(origin) && !isSystemTag.value
}

const parentTag = computed(() =>
  selectedTag.value ? tagsStore.parentTagOf(selectedTag.value.id) : undefined,
)

const parentCandidates = computed(() =>
  selectedTag.value ? tagsStore.parentCandidates(selectedTag.value.id) : [],
)

/** 单父槽位：已有父时按钮语义是「换掉它」，措辞须随之改（否则像是要再加一个父）。 */
const parentActionLabel = computed(() => (parentTag.value ? '更换父标签' : '+ 添加父标签'))

async function onPickParent(parentId: string) {
  if (!selectedTag.value || !parentId) return
  await tagsStore.setParent(selectedTag.value.id, parentId)
  parentPickerOpen.value = false
}

async function onClearParent() {
  if (!selectedTag.value) return
  await tagsStore.setParent(selectedTag.value.id, null)
}

async function onRemoveField(fieldDefinitionId: string) {
  if (!selectedTag.value) return
  // 移除的正是面板服务的那个字段 → 先收面板（锚点行会被摘掉，留着就是个无锚浮层）
  if (enumFieldId.value === fieldDefinitionId) closeEnumPanel()
  await tagsStore.removeFieldFromTag(selectedTag.value.id, fieldDefinitionId)
}

// ── 字段行：四列就地编辑（ADR-0050 D14） ───────────────────────
//
// 表头四列（字段 | 类型 | 默认 | 来源）里前三列都可就地改：字段名 / 默认是「点一下变控件」，
// 类型是下拉。同一时刻至多一个单元格处于编辑态；继承字段的定义归祖先 → 整行只读。

/** 就地编辑态：至多一个 (字段, 单元格)。 */
const editingFieldId = ref<string | null>(null)
const editingCell = ref<'name' | 'default' | null>(null)
const nameDraft = ref('')
const defaultDraft = ref('')

/** 「切成枚举、选项还没补」的字段 —— 选项补齐前的本地挂起态。 */
const pendingSelectId = ref<string | null>(null)

/**
 * 就地编辑控件：挂载即聚焦 + 全选（点字段名 → 直接改名，不必先删整段）。
 *
 * ⚠️ 受控值必须用 `:value` + `@input` 而非 `v-model`：vModelText 是在**自己的 mounted
 * 钩子**里才写 `el.value`，挂载钩子的执行顺序按模板里的书写顺序 —— 若本指令排在
 * v-model 之前，select() 会全选到空串（表现为光标停在末尾、看着像没选中）。
 */
const vFocusSelect: ObjectDirective<HTMLElement, boolean | undefined> = {
  mounted(el, binding) {
    if (binding.value === false) return
    el.focus()
    // `<select>` 没有 select()（只有文本类输入有）→ 有则全选，无则只聚焦。
    const selectable = el as HTMLElement & { select?: () => void }
    if (typeof selectable.select === 'function') selectable.select()
  },
}

/** 类型下拉的当前取值（`select` 是 type string + closed_values 派生的伪类型，显示名「枚举」）。 */
function typeValueOf(def: PersistedFieldDefinition): string {
  // 挂起态也按 select 呈现：否则「切成枚举」会因 `closed_values` 为空而显示回文本，
  // 看着像类型没改（先例：原生 select 回退显示首个选项）。
  if (pendingSelectId.value === def.id) return 'select'
  return def.closed_values?.length ? 'select' : def.type
}

/**
 * 类型下拉的候选项：当前类型若不在点选表内（历史遗留类型，如布尔 / 页面引用），
 * 把它补成一项 —— 否则原生 select 会回退显示首个选项，看着像「类型被改了」。
 */
function typeOptionsOf(def: PersistedFieldDefinition) {
  const current = typeValueOf(def)
  return FIELD_TYPE_VALUES.includes(current)
    ? FIELD_TYPE_OPTIONS
    : [{ value: current, label: TYPE_LABELS[current] ?? current }, ...FIELD_TYPE_OPTIONS]
}

function isEditing(fieldId: string, cell: 'name' | 'default'): boolean {
  return editingFieldId.value === fieldId && editingCell.value === cell
}

/** 字段行的形状（有效字段定义 + 声明它的标签）——单元格编辑的判据都挂在 origin 上。 */
type FieldRow = { def: PersistedFieldDefinition; origin: PersistedTag | undefined }

/** 单元格进编辑态：定义归祖先 / 系统标签 → 整行只读，点击不生效（改它等于改所有引用方）。 */
function startEdit(row: FieldRow, cell: 'name' | 'default') {
  if (!canEditField(row.origin)) return
  if (cell === 'name') {
    nameDraft.value = row.def.title
  } else {
    defaultDraft.value = decodeDefault(row.def.default_value)
  }
  editingFieldId.value = row.def.id
  editingCell.value = cell
}

function cancelEdit() {
  editingFieldId.value = null
  editingCell.value = null
}

/** 标题落库：空标题不写（改名成空会让字段无从指代），未变也不写。 */
async function commitName(def: PersistedFieldDefinition) {
  const title = nameDraft.value.trim()
  cancelEdit()
  if (!title || title === def.title) return
  await tagsStore.updateFieldDefinition({ id: def.id, title })
}

/** 默认值落库：形态 = JSON 文本（ADR-0050 D13）；空串 → null（即「无默认」）。 */
async function commitDefault(def: PersistedFieldDefinition) {
  const encoded = encodeDefault(def.type, defaultDraft.value)
  cancelEdit()
  // 空串与 null 同义（无默认）→ 归一后再比，避免每点一次都发一次空写。
  if (encoded === (def.default_value || null)) return
  await tagsStore.updateFieldDefinition({ id: def.id, default_value: encoded })
}

/** 枚举字段的默认值：点选项即落库（与输入框同一条 JSON 文本形态）。 */
async function pickEnumDefault(value: string) {
  const def = enumDef.value
  if (!def) return
  await tagsStore.updateFieldDefinition({ id: def.id, default_value: JSON.stringify(value) })
  closeEnumPanel()
}

async function clearEnumDefault() {
  const def = enumDef.value
  if (!def) return
  if (decodeDefault(def.default_value)) {
    await tagsStore.updateFieldDefinition({ id: def.id, default_value: null })
  }
  closeEnumPanel()
}

/**
 * 类型切换：`select` 落库为 type string + closed_values。**选项还没补时不落库** ——
 * 空选项的枚举没有意义，落下去类型显示会回退成文本，看着像没改；先本地挂起，并
 * 直接把「默认」列的选项面板推给用户（补第一个选项时才一次写完 type + closed_values）。
 */
async function onChangeType(def: PersistedFieldDefinition, next: string, anchor?: HTMLElement) {
  if (next === 'select') {
    if (def.closed_values?.length) return // 已是枚举
    pendingSelectId.value = def.id
    if (anchor) openEnumPanel(anchor, def)
    return
  }
  pendingSelectId.value = null
  await tagsStore.updateFieldDefinition({
    id: def.id,
    type: next,
    // 非选项型显式传 null：把「枚举 → 文本/数值」的降级写实（清掉选项）。
    closed_values: null,
  })
}

/** 「默认」列是否走枚举选项面板（选项就长在这个下拉里，含增 / 删 / 改）。 */
function isEnumRow(row: FieldRow): boolean {
  return canEditField(row.origin) && typeValueOf(row.def) === 'select'
}

// ── 枚举选项面板（挂在「默认」列，BasePopover） ──────────────────

const enumPanelOpen = ref(false)
const enumPanelAnchor = ref<HTMLElement | null>(null)
const enumPanelPos = ref({ x: 0, y: 0 })
const enumFieldId = ref<string | null>(null)
/** 新增选项的输入草稿。 */
const newOptionDraft = ref('')
/** 正在改名的选项下标（null = 无）。 */
const enumRenameIndex = ref<number | null>(null)
const enumRenameDraft = ref('')

/** 面板所服务的字段定义（写后整体重读 → 每次取最新的那份，不用闭包里的旧对象）。 */
const enumDef = computed(() =>
  detailFields.value.find((r) => r.def.id === enumFieldId.value)?.def,
)
const enumOptions = computed<string[]>(() => enumDef.value?.closed_values ?? [])
const enumDefaultValue = computed(() => (enumDef.value ? decodeDefault(enumDef.value.default_value) : ''))

function openEnumPanel(el: HTMLElement, def: PersistedFieldDefinition) {
  const rect = el.getBoundingClientRect()
  enumPanelAnchor.value = el
  enumPanelPos.value = { x: rect.left, y: rect.bottom + 4 }
  enumFieldId.value = def.id
  newOptionDraft.value = ''
  enumRenameIndex.value = null
  enumPanelOpen.value = true
}

function openEnumPanelByEvent(e: Event, def: PersistedFieldDefinition) {
  openEnumPanel(e.currentTarget as HTMLElement, def)
}

/** 关闭面板：挂起态一并放弃 —— 否则类型会停在「没有选项的枚举」上。 */
function closeEnumPanel() {
  enumPanelOpen.value = false
  enumFieldId.value = null
  enumRenameIndex.value = null
  pendingSelectId.value = null
}

/** 新增选项：挂起态下这第一个选项才把 type 一并写死（此前只本地挂起，未落库）。 */
async function addEnumOption() {
  const def = enumDef.value
  const raw = newOptionDraft.value.trim()
  if (!def || !raw || enumOptions.value.includes(raw)) {
    newOptionDraft.value = ''
    return
  }
  const values = [...enumOptions.value, raw]
  newOptionDraft.value = ''
  const wasPending = pendingSelectId.value === def.id
  await tagsStore.updateFieldDefinition(
    wasPending
      ? { id: def.id, type: 'string', closed_values: values }
      : { id: def.id, closed_values: values },
  )
  pendingSelectId.value = null
}

function startRenameOption(index: number) {
  enumRenameIndex.value = index
  enumRenameDraft.value = enumOptions.value[index] ?? ''
}

/**
 * 选项改名：改的是当前默认值 → 默认值跟着走（否则表里显示旧名、落库值对不上）。
 * 重名不改 —— 两个同名选项无法区分（写下去等于给自己埋一个选不出来的值）。
 */
async function commitRenameOption(index: number) {
  const def = enumDef.value
  const raw = enumRenameDraft.value.trim()
  enumRenameIndex.value = null
  if (!def || !raw) return
  const old = enumOptions.value[index]
  if (!old || old === raw) return
  if (enumOptions.value.includes(raw)) return
  const params: UpdateFieldDefinitionParams = {
    id: def.id,
    closed_values: enumOptions.value.map((v, i) => (i === index ? raw : v)),
  }
  if (decodeDefault(def.default_value) === old) params.default_value = JSON.stringify(raw)
  await tagsStore.updateFieldDefinition(params)
}

/** 删除选项：删的是当前默认值 → 默认值一并清空；最后一项不给删（要换类型就动类型列）。 */
async function removeEnumOption(index: number) {
  const def = enumDef.value
  if (!def || enumOptions.value.length <= 1) return
  const removed = enumOptions.value[index]
  const params: UpdateFieldDefinitionParams = {
    id: def.id,
    closed_values: enumOptions.value.filter((_, i) => i !== index),
  }
  if (removed && decodeDefault(def.default_value) === removed) params.default_value = null
  await tagsStore.updateFieldDefinition(params)
}

// ── 默认值（编解码与读侧显示） ─────────────────────────────────

/** 默认值落库形态 = JSON 文本（与 PersistedFieldValue.value_json 同形）；读回时反序列化为字符串。 */
function decodeDefault(jsonText: string | null | undefined): string {
  if (!jsonText) return ''
  try {
    const v = JSON.parse(jsonText)
    return v == null ? '' : String(v)
  } catch {
    return ''
  }
}

/** 输入草稿 → JSON 文本；空串 / 非法数字 → null（即「无默认」）。 */
function encodeDefault(type: string, raw: string | number): string | null {
  // 数值输入框由 Vue v-model 直接赋 number（而非字符串）→ 入参可能是 number，
  // 统一归一为字符串再判空 / 转 JSON，避免 raw.trim 在 number 上抛错。
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return null
  if (type === 'number') {
    const n = Number(trimmed)
    return Number.isNaN(n) ? null : JSON.stringify(n)
  }
  return JSON.stringify(trimmed)
}

/** 候选值文本 → 数组（空文本 → null，即非选项型）。 */
function parseOptions(raw: string): string[] | null {
  const values = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return values.length ? values : null
}

/** 默认编辑框的原生类型（枚举型不走这里 —— 它走「默认」列的选项面板）。 */
function defaultInputType(def: PersistedFieldDefinition): string {
  if (def.type === 'number') return 'number'
  if (def.type === 'date') return 'date'
  return 'text'
}

/** 默认列显示文本：无默认 → 破折号（窄列里不写「无默认」四个字）。 */
function defaultText(def: PersistedFieldDefinition): string {
  return decodeDefault(def.default_value) || '—'
}

// ── 来源列（窄列，长标签名截断 + hover tip） ───────────────────

/** 来源列最多显示 5 个字（列宽只够这么些），超出用省略号。 */
const ORIGIN_TITLE_MAX = 5

function originText(title: string): string {
  const chars = [...title]
  return chars.length > ORIGIN_TITLE_MAX
    ? `${chars.slice(0, ORIGIN_TITLE_MAX).join('')}…`
    : title
}

/** 是否真被截断 —— 只有截断的行才挂 title，没截断还弹 tip 是噪音。 */
function isOriginTruncated(title: string | undefined): boolean {
  return !!title && [...title].length > ORIGIN_TITLE_MAX
}

// 换标签时收起全部就地编辑态与选项面板：草稿是组件级单例，串到下一个标签上会被误落库。
watch(selectedTagId, () => {
  cancelEdit()
  closeEnumPanel()
})

// ── 继承区：父标签选择弹层（BasePopover） ──────────────────────

const parentPickerOpen = ref(false)
const parentPickerAnchor = ref<HTMLElement | null>(null)
const parentPickerPos = ref({ x: 0, y: 0 })

function openParentPicker(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  parentPickerAnchor.value = el
  parentPickerPos.value = { x: rect.left, y: rect.bottom + 4 }
  parentPickerOpen.value = true
}

// ── 删除（先告知影响） ────────────────────────────────────────

const showDeleteConfirm = ref(false)

/** 删除影响文案：成员规模 + 「值保留、可复挂恢复」语义 + 子标签失去继承。 */
const deleteImpact = computed(() => {
  const tag = selectedTag.value
  if (!tag) return ''
  const { count, pageCount } = tagsStore.memberSummary(tag.id)
  const children = tagsStore.childTags(tag.id).length
  const childNote = children > 0 ? `，其下 ${children} 个子标签会失去从这里继承的字段` : ''
  return `#${tag.title} 现有 ${count} 个成员（来自 ${pageCount} 个页面）${childNote}。成员块上已填的值会保留，重新挂载同名标签即可恢复。`
})

function onDeleteTag() {
  if (!selectedTag.value) return
  showDeleteConfirm.value = true
}

async function doDeleteTag() {
  if (!selectedTag.value) return
  const id = selectedTag.value.id
  showDeleteConfirm.value = false
  await tagsStore.deleteTag(id)
  const rest = sortedByMembers(tagsStore.allTags)
  selectedTagId.value = rest[0]?.id ?? null
}

// ── 新建标签弹层（BasePopover） ────────────────────────────────

const createOpen = ref(false)
const createAnchor = ref<HTMLElement | null>(null)
const createPos = ref({ x: 0, y: 0 })
const newTagTitle = ref('')
const newTagParentId = ref('')

function openCreatePopover(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  createAnchor.value = el
  createPos.value = { x: rect.left, y: rect.bottom + 4 }
  newTagTitle.value = ''
  newTagParentId.value = ''
  createOpen.value = true
}

async function submitCreateTag() {
  const title = newTagTitle.value.trim()
  if (!title) return
  await tagsStore.createTag({ title, parent_id: newTagParentId.value || null })
  createOpen.value = false
}

// ── 添加字段弹层（BasePopover） ────────────────────────────────

const addFieldOpen = ref(false)
const addFieldAnchor = ref<HTMLElement | null>(null)
const addFieldPos = ref({ x: 0, y: 0 })
const newFieldTitle = ref('')
const newFieldType = ref('string')
const newFieldOptions = ref('')

function openAddFieldPopover(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  addFieldAnchor.value = el
  addFieldPos.value = { x: rect.left, y: rect.bottom + 4 }
  newFieldTitle.value = ''
  newFieldType.value = 'string'
  newFieldOptions.value = ''
  addFieldOpen.value = true
}

async function submitAddField() {
  const title = newFieldTitle.value.trim()
  if (!title || !selectedTag.value) return
  const isSelect = newFieldType.value === 'select'
  await tagsStore.addFieldToTag(selectedTag.value.id, {
    title,
    type: isSelect ? 'string' : newFieldType.value,
    closed_values: isSelect ? parseOptions(newFieldOptions.value) : null,
  })
  addFieldOpen.value = false
}
</script>

<template>
  <div class="tags-page">
    <PageTitle
      title="标签"
      :subtitle="statsSubtitle"
    />

    <div class="tags-body">
      <!-- 左栏：筛选胶囊 + 行列表 -->
      <aside class="tag-list">
        <!-- 筛选胶囊靠左，搜索 / 新建靠右同一行 -->
        <div class="tag-filter-bar">
          <div class="tag-filter-chips">
            <button
              v-for="chip in filterChips"
              :key="chip.key"
              type="button"
              class="tag-filter-chip"
              :class="{ 'tag-filter-chip--active': filterMode === chip.key }"
              @click="filterMode = chip.key"
            >
              {{ chip.label }}
              <span
                v-if="chip.count !== null"
                class="tag-filter-count"
              >{{ chip.count }}</span>
            </button>
          </div>

          <div class="tag-list-actions">
            <label class="tag-search">
              <Search
                class="tag-search-icon"
                :size="14"
              />
              <input
                v-model="searchQuery"
                class="tag-search-input"
                type="text"
                placeholder="搜索标签"
              >
            </label>
            <button
              class="tag-create-btn"
              type="button"
              @click="openCreatePopover"
            >
              <Plus :size="14" />
              新建标签
            </button>
          </div>
        </div>

        <div class="tag-rows">
          <div
            v-for="tag in filteredTags"
            :key="tag.id"
            class="tag-row"
            :class="[`tag-row--${tag.id}`, { 'tag-row--active': selectedTagId === tag.id }]"
            role="button"
            tabindex="0"
            @click="selectedTagId = tag.id"
            @keydown.enter="selectedTagId = tag.id"
          >
            <span class="tag-row-label">
              <!-- 标签色（ADR-0050 D11）：色点在左，标题胶囊保持中性 —— 整行染色会盖过层级 -->
              <span
                class="tag-color-dot"
                :class="{ 'tag-color-dot--empty': isColorless(tag.color) }"
                :style="tagDotStyle(tag.color)"
              />
              <span class="tag-row-title">#{{ tag.title }}</span>
              <span
                v-if="tag.is_system"
                class="tag-row-system"
              >系统</span>
            </span>
            <span class="tag-row-meta tag-row-members">{{ memberCount(tag.id) }} 个成员</span>
            <span class="tag-row-meta">{{ fieldCount(tag.id) }} 个字段</span>
            <span
              class="tag-row-source"
              :class="{ 'tag-row-source--inherited': !!tag.parent_id }"
            >{{ sourceLabel(tag) }}</span>
          </div>
          <p
            v-if="!filteredTags.length"
            class="tag-list-empty"
          >
            没有匹配的标签
          </p>
        </div>
      </aside>

      <!-- 右栏：详情 -->
      <section class="tag-detail">
        <template v-if="selectedTag">
          <div class="tag-detail-head">
            <h2 class="tag-detail-title">
              #{{ selectedTag.title }}
            </h2>
            <button
              type="button"
              class="tag-detail-open"
              @click="openAggregatePage"
            >
              查看成员 →
            </button>
          </div>
          <p class="tag-detail-meta">
            {{ detailSummary.count }} 个成员 · 来自 {{ detailSummary.pageCount }} 个页面
          </p>
          <!-- 身份（ADR-0050 D11）：描述位于标题/副标题之下、字段模板之上（D12 顺序） -->
          <div class="tag-detail-desc">
            <TagDescriptionField
              :value="selectedTag.description"
              :readonly="isSystemTag"
              @save="onSaveDescription"
            />
          </div>
          <!-- 身份的第三要素：颜色。管理面板内联渲染选色面板（不弹窗，ADR-0050 D14） -->
          <div class="tag-detail-color">
            <span class="tag-detail-color-label">颜色</span>
            <TagColorPicker
              :value="selectedTag.color"
              :readonly="isSystemTag"
              inline
              @pick="onPickColor"
            />
          </div>
          <p
            v-if="isSystemTag"
            class="tag-system-note"
          >
            系统标签为内置定义：字段与继承均不可编辑
          </p>

          <h3 class="tag-section-title">
            字段模板
          </h3>
          <div class="tag-fields">
            <!-- 表头：字段 | 类型 | 默认 | 来源（+ 末尾操作列） -->
            <div class="tag-field-row tag-field-row--head">
              <div class="tag-field-line">
                <span class="tag-field-cell">字段</span>
                <span class="tag-field-cell">类型</span>
                <span class="tag-field-cell">默认</span>
                <span class="tag-field-cell">来源</span>
                <span class="tag-field-cell" />
              </div>
            </div>
            <div
              v-for="row in detailFields"
              :key="row.def.id"
              class="tag-field-row"
              :class="{ 'tag-field-row--editable': canEditField(row.origin) }"
            >
              <div class="tag-field-line">
                <!-- 字段名：点一下变输入框（挂载即全选）；继承字段的定义归祖先 → 只读 -->
                <input
                  v-if="isEditing(row.def.id, 'name')"
                  v-focus-select
                  class="tag-field-name-input"
                  type="text"
                  :value="nameDraft"
                  @input="nameDraft = ($event.target as HTMLInputElement).value"
                  @keydown.enter.prevent="commitName(row.def)"
                  @keydown.esc.prevent="cancelEdit()"
                  @blur="commitName(row.def)"
                >
                <span
                  v-else
                  class="tag-field-name"
                  :class="{ 'tag-field-name--editable': canEditField(row.origin) }"
                  :title="canEditField(row.origin) ? '点击改名' : undefined"
                  @click="startEdit(row, 'name')"
                >{{ row.def.title }}</span>

                <!-- 类型：下拉就地切换（继承 / 系统字段只显示类型名） -->
                <select
                  v-if="canEditField(row.origin)"
                  class="tag-field-type-select"
                  :value="typeValueOf(row.def)"
                  @change="onChangeType(row.def, ($event.target as HTMLSelectElement).value, $event.target as HTMLElement)"
                >
                  <option
                    v-for="opt in typeOptionsOf(row.def)"
                    :key="opt.value"
                    :value="opt.value"
                  >
                    {{ opt.label }}
                  </option>
                </select>
                <span
                  v-else
                  class="tag-field-type"
                >{{ typeLabel(row.def) }}</span>

                <!-- 默认：枚举型走选项面板（选项就在里面，可增/删/改），其余点一下变控件 -->
                <input
                  v-if="isEditing(row.def.id, 'default')"
                  v-focus-select
                  class="tag-field-default-input"
                  :type="defaultInputType(row.def)"
                  placeholder="无默认"
                  :value="defaultDraft"
                  @input="defaultDraft = ($event.target as HTMLInputElement).value"
                  @keydown.enter.prevent="commitDefault(row.def)"
                  @keydown.esc.prevent="cancelEdit()"
                  @blur="commitDefault(row.def)"
                >
                <button
                  v-else-if="isEnumRow(row)"
                  type="button"
                  class="tag-field-default tag-field-default--enum"
                  :class="{ 'tag-field-default--open': enumPanelOpen && enumFieldId === row.def.id }"
                  title="编辑选项 / 设默认值"
                  @click="openEnumPanelByEvent($event, row.def)"
                >
                  <span class="tag-field-default-text">{{ defaultText(row.def) }}</span>
                  <ChevronDown
                    class="tag-field-default-caret"
                    :size="12"
                  />
                </button>
                <span
                  v-else
                  class="tag-field-default"
                  :class="{ 'tag-field-default--editable': canEditField(row.origin) }"
                  :title="canEditField(row.origin) ? '点击设默认值' : undefined"
                  @click="startEdit(row, 'default')"
                >{{ defaultText(row.def) }}</span>

                <!-- 来源：自身 / 声明它的祖先标签（不再写「继承 ←」—— 列名已说明语义） -->
                <span
                  class="tag-field-origin"
                  :class="{ 'tag-field-origin--inherited': !isOwnField(row.origin) }"
                >
                  <template v-if="isOwnField(row.origin)">自身</template>
                  <template v-else>
                    <span
                      class="tag-field-origin-title"
                      :title="isOriginTruncated(row.origin?.title) ? row.origin?.title : undefined"
                    >{{ row.origin?.title ? originText(row.origin.title) : '—' }}</span>
                  </template>
                </span>

                <button
                  v-if="canEditField(row.origin)"
                  type="button"
                  class="tag-field-remove"
                  aria-label="移除字段"
                  @click.stop="onRemoveField(row.def.id)"
                >
                  ×
                </button>
                <span
                  v-else
                  class="tag-field-ops"
                />
              </div>
            </div>
            <p
              v-if="!detailFields.length"
              class="tag-fields-empty"
            >
              该标签还没有字段
            </p>
          </div>
          <button
            v-if="!isSystemTag"
            class="tag-add-field"
            type="button"
            @click="openAddFieldPopover"
          >
            + 添加字段
          </button>

          <h3 class="tag-section-title tag-section-title--inherit">
            继承
          </h3>
          <div
            v-if="parentTag"
            class="tag-parent-card"
          >
            <span class="tag-parent-label">
              <span
                class="tag-color-dot"
                :class="{ 'tag-color-dot--empty': isColorless(parentTag.color) }"
                :style="tagDotStyle(parentTag.color)"
              />
              <span class="tag-parent-chip">#{{ parentTag.title }}</span>
            </span>
            <button
              v-if="!isSystemTag"
              type="button"
              class="tag-parent-clear"
              aria-label="清除父标签"
              @click="onClearParent"
            >
              <X :size="12" />
            </button>
          </div>
          <p
            v-else
            class="tag-parent-none"
          >
            顶级标签
          </p>
          <button
            v-if="!isSystemTag"
            class="tag-parent-add"
            type="button"
            @click="openParentPicker"
          >
            {{ parentActionLabel }}
          </button>
          <p class="tag-inherit-note">
            继承字段不写入成员；同名字段以「自身 &gt; 直接父 &gt; 更远祖先」生效，成环请求会被拒绝。
          </p>

          <button
            v-if="!isSystemTag"
            type="button"
            class="tag-delete"
            @click="onDeleteTag"
          >
            删除标签…
          </button>
        </template>
        <p
          v-else
          class="tag-detail-empty"
        >
          选择左侧标签查看详情
        </p>
      </section>
    </div>

    <!-- 删除确认（先告知影响，spec 用户故事 16/17） -->
    <ConfirmDialog
      :visible="showDeleteConfirm"
      :title="`删除标签 #${selectedTag?.title ?? ''}`"
      :message="deleteImpact"
      confirm-text="删除"
      danger
      @confirm="doDeleteTag"
      @cancel="showDeleteConfirm = false"
    />

    <!-- 新建标签 -->
    <BasePopover
      :visible="createOpen"
      :position="createPos"
      :anchor-el="createAnchor"
      @close="createOpen = false"
    >
      <div class="tag-create-panel">
        <input
          v-model="newTagTitle"
          class="tag-create-title"
          type="text"
          placeholder="标签标题"
        >
        <select
          v-model="newTagParentId"
          class="tag-create-parent"
        >
          <option value="">
            无父标签
          </option>
          <option
            v-for="tag in tagsStore.allTags"
            :key="tag.id"
            :value="tag.id"
          >
            {{ tag.title }}
          </option>
        </select>
        <button
          type="button"
          class="tag-create-confirm"
          @click="submitCreateTag"
        >
          确认
        </button>
      </div>
    </BasePopover>

    <!-- 继承区：挑父标签（单父槽位，选中即替换） -->
    <BasePopover
      :visible="parentPickerOpen"
      :position="parentPickerPos"
      :anchor-el="parentPickerAnchor"
      @close="parentPickerOpen = false"
    >
      <div class="tag-parent-panel">
        <p
          v-if="!parentCandidates.length"
          class="tag-parent-empty"
        >
          没有可选父标签
        </p>
        <button
          v-for="candidate in parentCandidates"
          :key="candidate.id"
          type="button"
          class="tag-parent-option"
          @click="onPickParent(candidate.id)"
        >
          <span
            class="tag-color-dot"
            :class="{ 'tag-color-dot--empty': isColorless(candidate.color) }"
            :style="tagDotStyle(candidate.color)"
          />
          {{ candidate.title }}
        </button>
      </div>
    </BasePopover>

    <!-- 枚举字段的选项：挂在「默认」列的下拉里，选项可增 / 删 / 改（定义全局共享 → 只对自身声明的字段开放） -->
    <BasePopover
      :visible="enumPanelOpen"
      :position="enumPanelPos"
      :anchor-el="enumPanelAnchor"
      @close="closeEnumPanel"
    >
      <div class="tag-enum-panel">
        <button
          type="button"
          class="tag-enum-option tag-enum-option--none"
          :class="{ 'tag-enum-option--active': !enumDefaultValue }"
          @click="clearEnumDefault"
        >
          无默认
        </button>
        <div
          v-for="(opt, i) in enumOptions"
          :key="`${opt}-${i}`"
          class="tag-enum-row"
        >
          <input
            v-if="enumRenameIndex === i"
            v-focus-select
            class="tag-enum-input"
            type="text"
            :value="enumRenameDraft"
            @input="enumRenameDraft = ($event.target as HTMLInputElement).value"
            @keydown.enter.prevent="commitRenameOption(i)"
            @keydown.esc.prevent.stop="enumRenameIndex = null"
            @blur="commitRenameOption(i)"
          >
          <template v-else>
            <button
              type="button"
              class="tag-enum-option"
              :class="{ 'tag-enum-option--active': opt === enumDefaultValue }"
              :title="`设为默认：${opt}`"
              @click="pickEnumDefault(opt)"
            >
              {{ opt }}
            </button>
            <button
              type="button"
              class="tag-enum-icon"
              aria-label="改选项名"
              @click="startRenameOption(i)"
            >
              <Pencil :size="12" />
            </button>
            <button
              type="button"
              class="tag-enum-icon"
              :disabled="enumOptions.length <= 1"
              :title="enumOptions.length <= 1 ? '至少保留一个选项（要换类型请改「类型」列）' : '删除选项'"
              aria-label="删除选项"
              @click="removeEnumOption(i)"
            >
              <X :size="12" />
            </button>
          </template>
        </div>
        <input
          v-model="newOptionDraft"
          class="tag-enum-input tag-enum-input--new"
          type="text"
          size="1"
          placeholder="添加选项"
          @keydown.enter.prevent="addEnumOption"
          @keydown.esc.prevent.stop="closeEnumPanel()"
        >
      </div>
    </BasePopover>

    <!-- 添加字段 -->
    <BasePopover
      :visible="addFieldOpen"
      :position="addFieldPos"
      :anchor-el="addFieldAnchor"
      @close="addFieldOpen = false"
    >
      <div class="tag-field-panel">
        <input
          v-model="newFieldTitle"
          class="tag-field-title-input"
          type="text"
          placeholder="字段标题"
        >
        <select
          v-model="newFieldType"
          class="tag-field-type-select"
        >
          <option
            v-for="opt in FIELD_TYPE_OPTIONS"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
        <input
          v-if="newFieldType === 'select'"
          v-model="newFieldOptions"
          class="tag-field-options"
          type="text"
          placeholder="候选值，逗号分隔"
        >
        <button
          type="button"
          class="tag-field-confirm"
          @click="submitAddField"
        >
          添加字段
        </button>
      </div>
    </BasePopover>
  </div>
</template>

<style lang="scss" scoped>
.tags-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  padding: 0 var(--space-8) var(--space-7);
}

.tags-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--space-4);
  margin-top: var(--space-5);
}

/* ── 顶栏：搜索 / 新建（与筛选胶囊同行，靠右） ── */
.tag-search {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  width: 200px;
  height: 34px;
  padding: 0 var(--space-2);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.tag-search-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.tag-search-input {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: transparent;
  border: none;
  outline: none;

  &::placeholder {
    color: var(--text-tertiary);
  }
}

.tag-create-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 34px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-white);
  background: var(--accent);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;

  &:hover {
    background: var(--accent-hover);
  }
}

/* ── 左栏 ── */
.tag-list {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 筛选行：胶囊群靠左（可换行收缩），搜索 / 新建由 margin-left 推到最右 */
.tag-filter-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.tag-filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* margin-left: auto 把搜索 / 新建推到筛选行的最右 */
.tag-list-actions {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}

.tag-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 28px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  background: var(--surface-subtle);
  border: none;
  border-radius: 999px;
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
  }

  &--active {
    color: var(--accent-hover);
    background: var(--accent-subtle);
  }
}

.tag-filter-count {
  font-variant-numeric: tabular-nums;
}

.tag-rows {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tag-row {
  display: grid;
  // 标题胶囊自适应 + 成员数 / 字段数两列定宽 + 来源列吃余量
  grid-template-columns: auto 102px 102px 1fr;
  column-gap: var(--space-3);
  align-items: center;
  min-height: 52px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
  background: var(--surface-muted);
  border-radius: var(--radius-md);
  cursor: pointer;

  &:not(.tag-row--active):hover {
    background: var(--bg-hover);
  }
}

.tag-row-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

/* 标签色点（ADR-0050 D11）：无色渲染成空心环，与「有色实心点」一眼可分。
   有色的填充由 `tagDotStyle` 内联给出；无色时 `--empty` 补边框 —— 两者判据同源。 */
.tag-color-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.tag-color-dot--empty {
  border: 1px solid var(--border-strong);
}

.tag-row-title {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 var(--space-2);
  color: var(--text-primary);
  white-space: nowrap;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.tag-row-system,
.tag-row-source {
  color: var(--text-tertiary);
  white-space: nowrap;
}

.tag-row-meta {
  color: var(--text-secondary);
  white-space: nowrap;
}

.tag-row-source {
  overflow: hidden;
  text-overflow: ellipsis;

  &--inherited {
    color: var(--accent);
  }
}

.tag-row--active {
  background: var(--accent-subtle);

  .tag-row-title {
    color: var(--accent-hover);
    border-color: var(--accent-40);
  }

  .tag-row-members {
    color: var(--accent-hover);
  }
}

.tag-list-empty,
.tag-fields-empty,
.tag-detail-empty,
.tag-parent-empty {
  padding: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

/* ── 右栏 ── */
.tag-detail {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  /* 字段模板是四列表格（字段 | 类型 | 默认 | 来源）→ 右栏需比常规详情宽些才不挤 */
  width: 420px;
  overflow: auto;
  padding: var(--space-5);
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

/* 字段列表之外的区块保持自然高度（不被压缩）：只有字段列表可收缩 ——
   其最大高度即「留给下方继承区 + 删除标签按钮之后的剩余高度」，
   保证最底部的 tag-delete 始终完整可见。 */
.tag-detail > * {
  flex-shrink: 0;
}

.tag-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.tag-detail-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--text-primary);
}

/* 进聚合页（D7）的唯一入口 */
.tag-detail-open {
  flex-shrink: 0;
  padding: 0;
  font-size: var(--text-xs);
  color: var(--accent);
  background: transparent;
  border: none;
  cursor: pointer;

  &:hover {
    color: var(--accent-hover);
  }
}

.tag-detail-meta {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

/* 身份条：紧跟副标题，处于「标题组」与「字段模板」之间（ADR-0050 D11/D12） */
.tag-detail-desc {
  margin-top: var(--space-2);
}

/* 身份第三要素（颜色）：标签与选色器色点同行 */
.tag-detail-color {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.tag-detail-color-label {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.tag-system-note {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.tag-section-title {
  margin: var(--space-2) 0;
  font-size: var(--text-xs);
  font-weight: var(--font-normal);
  color: var(--text-tertiary);

  &--inherit {
    margin-top: var(--space-6);
  }
}

.tag-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  /* 最大高度不再写死：字段多时收缩、内部滚动，把下方（继承 / 删除）留在面板内（需求 #3） */
  flex-shrink: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: var(--space-1);
}

/* 一行 = 一条字段定义；行内四列（字段 | 类型 | 默认 | 来源）+ 末尾操作列 */
.tag-field-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-xs);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);

  /* 表头不是数据行：去掉行框，只留列名；吸顶不随列表滚动，行从其下滑过 */
  &--head {
    position: sticky;
    top: 0;
    padding: 0 var(--space-3) var(--space-1);
    color: var(--text-tertiary);
    /* 不透明底遮住滚过的行 —— 与右栏底色同源 */
    background: var(--surface-muted);
    border: none;
  }
}

.tag-field-line {
  display: grid;
  // 字段列自适应 + 类型列收紧到「刚好装下一个类型名」+ 默认/来源吃余量 + 操作列定宽。
  // 类型列宽是唯一的手调位：下拉框 width:100% 跟着它走，改列宽即可，不要两处都写死。
  // 50px = 「枚举」等两字类型 + 原生下拉箭头刚好装下（历史遗留的四字类型会略裁，罕见）。
  grid-template-columns: minmax(0, 1.2fr) 50px minmax(0, 1fr) minmax(0, 0.9fr) 20px;
  column-gap: var(--space-2);
  align-items: center;
  min-height: 26px;
}

.tag-field-cell {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 表头对齐跟数据行走同一套：字段列左对齐，类型 / 默认 / 来源三列居中 */
.tag-field-cell + .tag-field-cell {
  text-align: center;
}

/* ── 列：字段（点一下就地改名） ── */
.tag-field-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-primary);

  /* 可改名的字段给「可点」暗示：文本光标 + 悬停染色 */
  &--editable {
    cursor: text;

    &:hover {
      color: var(--accent-hover);
    }
  }
}

.tag-field-name-input,
.tag-field-default-input {
  width: 100%;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--text-primary);
  background: var(--bg-base2);
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  padding: 1px var(--space-1);
  outline: none;
}

/* 改名框是「编辑态」的唯一视觉信号 —— 用强调色边框与静态文本分开 */
.tag-field-name-input {
  border-color: var(--accent-40);
}

/* 默认值编辑框：与「默认」列的静态文本同列同对齐（居中） */
.tag-field-default-input {
  text-align: center;
}

/* ── 列：类型（下拉就地切换）—— 窄列，文字居中 ──
   宽度吃满列（列宽是唯一手调位），不再另写死一个值 —— 两者不一致就会左右留白。 */
.tag-field-type-select {
  width: 100%;
  min-width: 0;
  text-align: center;
  font-size: var(--text-xs);
  color: var(--text-primary);
  background: var(--bg-base2);
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  padding: 1px 1px;
}

/* 只读行没有下拉框 —— 与上面的 select 同列同对齐（居中），否则两态左边缘错开 */
.tag-field-type {
  overflow: hidden;
  color: var(--text-secondary);
  white-space: nowrap;
  text-align: center;
  text-overflow: ellipsis;
}

/* ── 列：默认（点一下就地设值）—— 窄列，文字居中 ── */
.tag-field-default {
  overflow: hidden;
  color: var(--text-secondary);
  white-space: nowrap;
  text-align: center;
  text-overflow: ellipsis;

  &--editable {
    cursor: text;

    &:hover {
      color: var(--accent-hover);
    }
  }
}

/* ── 列：来源（自身 / 声明它的祖先标签）—— 窄列，名字居中 ── */
.tag-field-origin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  color: var(--text-tertiary);

  &--inherited {
    color: var(--text-secondary);
  }
}

.tag-field-origin-title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ── 操作列：移除（静态帧不出现，悬停该行才露出） ── */
.tag-field-remove {
  display: inline-flex;
  visibility: hidden;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  cursor: pointer;

  &:hover {
    color: var(--error);
    background: var(--bg-hover);
  }
}

.tag-field-row:hover .tag-field-remove {
  visibility: visible;
}

.tag-field-ops {
  width: 20px;
}

/* 枚举字段的「默认」列是个下拉触发器：选项（可增 / 删 / 改）就在这个面板里 */
.tag-field-default--enum {
  display: flex;
  align-items: center;
  /* 「默认」列居中 —— 文本与箭头作为一个整体居中（不是两端对齐） */
  justify-content: center;
  gap: var(--space-1);
  width: 100%;
  min-width: 0;
  padding: 1px var(--space-1);
  font-size: var(--text-xs);
  color: var(--text-primary);
  background: var(--bg-base2);
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  cursor: pointer;

  &:hover {
    border-color: var(--border-strong);
  }

  &--open {
    border-color: var(--accent-40);
  }
}

.tag-field-default-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tag-field-default-caret {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

/* 宽度随选项内容自适应：选项名多是两三字，定宽会让「文字 ↔ 操作图标」之间空一大片。
   下限保证底部「添加选项」输入框可用，上限防止超长选项把面板撑到右栏外。 */
.tag-enum-panel {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: max-content;
  min-width: 104px;
  max-width: 260px;
  max-height: 240px;
  overflow-y: auto;
}

.tag-enum-row {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* 撑满整行 → 行尾的改名 / 删除按钮右对齐（各行的操作列同一条竖线）；超长名再截断 */
.tag-enum-option {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 200px;
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  text-align: left;
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  &:hover {
    background: var(--bg-hover);
  }

  /* 当前默认值 —— 与「无默认」判据同源（enumDefaultValue 是否为它） */
  &--active {
    color: var(--accent-hover);
  }

  &--none {
    color: var(--text-tertiary);
  }
}

.tag-enum-icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.tag-enum-input {
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--text-primary);
  background: var(--bg-base2);
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  padding: 2px var(--space-2);
  outline: none;
}

/* 改名框：顶掉选项名那一格（行内横向布局）；下限保证短选项也能舒服地改名 */
.tag-enum-row .tag-enum-input {
  flex: 1 1 auto;
  min-width: 72px;
}

/* 新增框：独占一行、宽度跟面板走。配套项在模板里（`size=1`）—— 输入框默认 20 字符的
   固有宽度会把 max-content 面板顶到 180px 以上，自适应就白做了。 */
.tag-enum-input--new {
  width: 100%;
  margin-top: var(--space-1);
}

.tag-add-field,
.tag-parent-add {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: var(--space-3);
  padding: 0;
  font-size: var(--text-xs);
  color: var(--accent);
  background: transparent;
  border: none;
  cursor: pointer;

  &:hover {
    color: var(--accent-hover);
  }
}

.tag-parent-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: 36px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.tag-parent-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.tag-parent-chip {
  color: var(--text-primary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tag-parent-clear {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
}

.tag-parent-none {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.tag-inherit-note {
  margin: var(--space-3) 0 0;
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--text-tertiary);
}

.tag-delete {
  margin-top: var(--space-6);
  padding: 0;
  font-size: var(--text-sm);
  color: var(--error);
  background: transparent;
  border: none;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

/* ── 弹层 ── */
.tag-create-panel,
.tag-field-panel,
.tag-parent-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 240px;
}

.tag-parent-panel {
  width: 180px;
  max-height: 260px;
  overflow: auto;
}

.tag-parent-option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
  text-align: left;
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
  }
}

.tag-create-title,
.tag-create-parent,
.tag-field-title-input,
.tag-field-options {
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: var(--bg-base2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px var(--space-2);
}

.tag-create-confirm,
.tag-field-confirm {
  height: 28px;
  font-size: var(--text-xs);
  color: var(--color-white);
  background: var(--accent);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;

  &:hover {
    background: var(--accent-hover);
  }
}
</style>
