<script setup lang="ts">
/**
 * 标签管理页（ADR-0050 D5）：左栏（统计副标题 / 搜索 / 全部·最近使用·未使用 /
 * 行 = 标题胶囊 · 成员数 · 字段数 · 来源）+ 右栏详情（成员与来源页统计 / 字段模板卡片栅格 /
 * 单父继承区 / 删除标签）。
 *
 * 字段模板是类型色谱卡片栅格（ADR-0057 D2 的视觉升级，auto-fill 流式栅格）：
 * 卡片 = 类型色芯片（FieldLabel 图标即设置入口，按字段类型染色）+ 类型·来源元信息行
 * + 描述两行截断；全部字段配置（类型 / 默认 / 隐藏 / 形态 / 约束 / 特化 / 枚举选项）
 * 统一进字段设置弹窗（FieldSettingsModal，App 层常驻挂载）。
 *
 * 边界与归属：
 * - 打标入口不在此页 —— 建实体 ≠ 打标，打标仍唯一走 content `#名`（ADR-0049 D6）。
 * - 「新建标签」= 标题 + 可选父标签；「+ 添加字段」= 搜索合一式弹层 —— 引用已有
 *   FieldDefinition（不新建定义）或新建（ADR-0050 D10 修订增补）。
 * - 成员口径：管理页用**直系数**（ADR-0050 D10 #3）；含后代的聚合口径只在 tag 聚合页用。
 * - 字段数口径：**有效字段数**（含继承，即该标签下真正可填的字段数量）。
 * - 继承解析（有效字段集合）单源在 Rust，本页只消费 store 的解析结果。
 * - **系统标签右栏只读**：字段 / 继承 / 删除一律不给可点入口 —— Rust 侧
 *   `reject_system_tag` 已拒，UI 若照给按钮就是静默失败（点了没反应且无提示）。
 * - 字段定义是全局共享的，故只有**自身声明**的字段可在此编辑（继承方无权改他人定义）。
 * - 进聚合页的入口在本页右栏标题行（`/tags/:tagId`）。
 */
import { CornerUpRight, GripVertical, Layers, Link2, Plus, Search, X } from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'

import { useNavigateToTag } from '../../composables/useNavigateToTag'
import { useRelationshipTypes } from '../../composables/useRelationshipTypes'
import { useBlockCardStore } from '../../stores/blockCard'
import { useEditorStore } from '../../stores/editor'
import { useTagsStore } from '../../stores/tags'
import type {
  PersistedFieldDefinition,
  PersistedTag,
} from '../../types/tag-persisted'
import { displayFieldType } from '../../utils/field-type-icons'
import { isTagColorToken, tagDotStyle } from '../../utils/tag-color'
import { reorderOwnFieldIds, type SortableFieldRow } from '../../utils/tag-field-order'
import BasePopover from '../common/BasePopover.vue'
import FieldLabel from '../common/FieldLabel.vue'
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
const editorStore = useEditorStore()
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
  // 直系成员计数走 store 的单遍扫描缓存（Map 查表），避免逐标签全量过滤 cards
  const counts = tagsStore.directMemberCount
  const members = all.reduce((sum, t) => sum + (counts.get(t.id) ?? 0), 0)
  return `${all.length} 个标签 · ${withParent} 个带父标签 · ${members} 个成员`
})

const filterChips = computed<Array<{ key: FilterMode; label: string; count: number | null }>>(
  () => [
    { key: 'all', label: '全部', count: tagsStore.allTags.length },
    { key: 'recent', label: '最近', count: null },
    { key: 'unused', label: '未用', count: tagsStore.unusedTags().length },
  ],
)

function memberCount(tagId: string): number {
  // O(1) 查表（store 单遍扫描缓存），供排序比较器与逐行渲染反复调用
  return tagsStore.directMemberCount.get(tagId) ?? 0
}

/** 按直系成员数降序，同数按标题——常用标签浮在上面。 */
function sortedByMembers(list: PersistedTag[]): PersistedTag[] {
  return [...list].sort(
    (a, b) => memberCount(b.id) - memberCount(a.id) || a.title.localeCompare(b.title),
  )
}

/** 树节点：标签 + 在「全部」树里的缩进层级（0 = 根）。 */
interface TagNode {
  tag: PersistedTag
  depth: number
}

/**
 * 左栏渲染清单：
 * - 「全部」→ 树状：根按成员数降序，子标签递归嵌套在父下（depth 即层级）。
 * - 「最近使用」/「未使用」→ 扁平：分别按最近使用序 / 成员数降序，不体现层级。
 * 搜索在任意模式下按标题过滤；树状下保留命中节点的祖先链，避免子节点孤立缩进。
 */
const displayTags = computed<TagNode[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const matches = (t: PersistedTag) => !q || t.title.toLowerCase().includes(q)

  if (filterMode.value !== 'all') {
    // 「最近使用」按成员块 recent 序（store 已排）；其余按成员数降序 —— 均扁平
    const base =
      filterMode.value === 'recent' ? tagsStore.recentTags() : tagsStore.unusedTags()
    const list = q ? base.filter(matches) : [...base]
    const sorted = filterMode.value === 'recent' ? list : sortedByMembers(list)
    return sorted.map((tag) => ({ tag, depth: 0 }))
  }

  // 树状：先确定「可见」集合（命中，或命中节点的某个祖先）
  const visible = new Set<string>()
  if (q) {
    for (const t of tagsStore.allTags) {
      if (!matches(t)) continue
      let cur: PersistedTag | undefined = t
      while (cur) {
        visible.add(cur.id)
        cur = cur.parent_id ? tagsStore.getTagById(cur.parent_id) : undefined
      }
    }
  }
  const isVisible = (t: PersistedTag) => !q || visible.has(t.id)
  const childrenOf = (pid: string | null) =>
    tagsStore.allTags
      .filter((t) => (t.parent_id ?? null) === (pid ?? null) && isVisible(t))
      .sort((a, b) => memberCount(b.id) - memberCount(a.id) || a.title.localeCompare(b.title))

  const out: TagNode[] = []
  const walk = (pid: string | null, depth: number) => {
    for (const t of childrenOf(pid)) {
      out.push({ tag: t, depth })
      walk(t.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
})

// ── 左右栏可拖拽分隔（split pane） ─────────────────────────────
//
// 右栏详情宽度由用户拖拽决定（字段模板是四列表格，宽窄因人而异）；左栏 `flex:1` 吃剩余。
// 宽度存 localStorage，重载后保持上次的偏好。

const MIN_DETAIL_W = 600
const MAX_DETAIL_W = 800
// `.tags-body` 的 gap（var(--space-4)=16px）落在 resizer 与右栏之间，外加 resizer 自身宽 6px
const RESIZE_OFFSET = 16 + 6
const detailWidthKey = 'comind.tags.detail-width'

const detailWidth = ref<number>(loadDetailWidth())

function loadDetailWidth(): number {
  const saved = Number(localStorage.getItem(detailWidthKey))
  return saved >= MIN_DETAIL_W && saved <= MAX_DETAIL_W ? saved : 600
}

let resizing = false

function startResize(e: MouseEvent | TouchEvent) {
  resizing = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', stopResize)
  window.addEventListener('touchmove', onResize, { passive: false })
  window.addEventListener('touchend', stopResize)
  e.preventDefault()
}

function onResize(e: MouseEvent | TouchEvent) {
  if (!resizing) return
  const clientX =
    'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX
  const bodyEl = document.querySelector('.tags-body')
  const rect = bodyEl?.getBoundingClientRect()
  if (!rect) return
  const next = Math.max(
    MIN_DETAIL_W,
    Math.min(MAX_DETAIL_W, Math.round(rect.right - clientX - RESIZE_OFFSET)),
  )
  detailWidth.value = next
  // 触屏拖动若不做 preventDefault，页面会跟着滚
  if ('touches' in e) e.preventDefault()
}

function stopResize() {
  if (!resizing) return
  resizing = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', stopResize)
  window.removeEventListener('touchmove', onResize)
  window.removeEventListener('touchend', stopResize)
  localStorage.setItem(detailWidthKey, String(detailWidth.value))
}

onUnmounted(stopResize)

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

/** 字段模板行：有效字段（含继承）+ 来源三态（自身 / 引用←首个声明者 / 继承←祖先）。 */
const detailFields = computed<FieldRow[]>(() => {
  const tag = selectedTag.value
  if (!tag) return []
  return tagsStore.effectiveFieldDefinitions(tag.id).map((def) => {
    const origin = tagsStore.fieldOrigin(tag.id, def.id)
    const isOwn = !!origin && origin.id === tag.id
    if (isOwn) {
      const first = tagsStore.firstDeclarerOf(def.id)
      if (first && first.id !== tag.id) {
        return { def, origin, isOwn, kind: 'ref' as const, originTitle: first.title }
      }
      return { def, origin, isOwn, kind: 'own' as const, originTitle: '' }
    }
    return { def, origin, isOwn, kind: 'inherited' as const, originTitle: origin?.title ?? '' }
  })
})

/**
 * 字段模板排序（feat：字段可排序）：可见列表 `detailFields` 是计算属性（只读），Sortable 需要
 * 一个可变的本地数组作为拖拽载体。本地数组在「非拖拽中」且与来源不一致时才从 `detailFields`
 * 同步，避免覆盖拖拽过程中的中间态。继承字段（kind=inherited）不在 `field_ids` 内、不可重排，
 * 故只参与展示，不参与落库。
 */
const fieldRows = ref<FieldRow[]>([])
const dragging = ref(false)

watch(
  detailFields,
  (rows) => {
    if (dragging.value) return
    fieldRows.value = rows.map((r) => ({ ...r }))
  },
  { immediate: true },
)

/** 拖拽结束：抽出 own/ref 字段的新相对顺序并落库；无变化则跳过（省一次 IPC）。 */
async function onFieldReorder() {
  dragging.value = false
  const tag = selectedTag.value
  if (!tag || isSystemTag.value) return
  const next = reorderOwnFieldIds(fieldRows.value as SortableFieldRow[], tag.field_ids)
  if (next === tag.field_ids) return
  await tagsStore.setOwnFields(tag.id, next)
}

/** 该卡片是否可拖拽排序：仅自身声明（own/ref）字段，且非系统标签只读面。 */
function isSortable(row: FieldRow): boolean {
  return !isSystemTag.value && row.kind !== 'inherited'
}

/** 字段类型显示名（`select` 是由 closed_values 派生的伪类型）。 */
const TYPE_LABELS: Record<string, string> = {
  string: '文本',
  number: '数值',
  date: '日期',
  daterange: '日期区间',
  datetime: '日期时间',
  boolean: '是/否',
  page: '页面引用',
  array: '列表',
  file: '附件',
  relation: '关联',
  select: '枚举',
  multiSelect: '多选',
}

/** 类型点选顺序（新建与类型下拉共用；`select` 落库为 type string + closed_values；`multiSelect` 落库为 type multiSelect + closed_values；`relation` 落库为 type relation + closed_values=[关系类型 id]，issue T5）。 */
const FIELD_TYPE_VALUES = ['string', 'number', 'boolean', 'date', 'datetime', 'daterange', 'select', 'multiSelect', 'page', 'file', 'relation']

const FIELD_TYPE_OPTIONS = FIELD_TYPE_VALUES.map((value) => ({ value, label: TYPE_LABELS[value] }))

function typeLabel(def: PersistedFieldDefinition): string {
  if (def.type === 'multiSelect') return TYPE_LABELS.multiSelect
  // relation 的 closed_values 复用为关系类型配置位（单元素数组，见 tag-persisted.ts），
  // 不能按「有 closed_values 即枚举」派生
  if (def.type === 'relation') return TYPE_LABELS.relation
  return TYPE_LABELS[def.closed_values?.length ? 'select' : def.type] ?? def.type
}

const parentTag = computed(() =>
  selectedTag.value ? tagsStore.parentTagOf(selectedTag.value.id) : undefined,
)

const parentCandidates = computed(() =>
  selectedTag.value ? tagsStore.parentCandidates(selectedTag.value.id) : [],
)

// ── 继承树只读可视化（ADR-0050 D17 §3）─────────────────────────

/**
 * 祖先链（最近祖先在前，至根）+ 各祖先的字段贡献 / 被覆盖：
 * - 贡献 = 本标签未声明（继承而来）的有效字段，按 fieldOrigin（父链上最近的声明祖先）归组；
 * - 被覆盖 = 该祖先声明、但本标签也自行声明的字段（自身声明优先级更高，D10 解析序）。
 * 树内只读，节点点击仅做本页选中跳转。
 */
const inheritChain = computed(() => {
  const tag = selectedTag.value
  if (!tag) return []
  const chain: Array<{ tag: PersistedTag; contributed: string[]; covered: string[] }> = []
  const visited = new Set<string>([tag.id])
  let cursor = tagsStore.parentTagOf(tag.id)
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id)
    chain.push({ tag: cursor, contributed: [], covered: [] })
    cursor = tagsStore.parentTagOf(cursor.id)
  }
  if (!chain.length) return []
  const byOrigin = new Map<string, string[]>()
  for (const row of detailFields.value) {
    if (row.isOwn || !row.origin) continue
    const list = byOrigin.get(row.origin.id) ?? []
    list.push(row.def.title)
    byOrigin.set(row.origin.id, list)
  }
  for (const node of chain) {
    node.contributed = byOrigin.get(node.tag.id) ?? []
    node.covered = node.tag.field_ids
      .filter((id) => tag.field_ids.includes(id))
      .map((id) => tagsStore.getFieldDefinition(id)?.title ?? '')
      .filter(Boolean)
  }
  return chain
})

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

// ── 字段行：流式卡片（ADR-0057 D2）────────────────────────────
//
// 卡片只承担「识别 + 入口」：字段名 / 类型图标 / 描述 / 来源；全部配置统一进
// 字段设置弹窗（FieldSettingsModal）。同一时刻无本地编辑态 —— 不再有草稿串标签问题。

/**
 * 字段行的形状（有效字段定义 + 来源三态）。
 * 来源三态（ADR-0050 D10 修订增补 #4）：
 * - `own`：本标签声明且自己就是首个声明者 → 「自身」；
 * - `ref`：本标签声明但有人更早声明 → 「引用←X」（X = 首个声明者）；
 * - `inherited`：沿父链继承 → 「继承←X」（X = 父链上最近的声明祖先）。
 */
type FieldRow = {
  def: PersistedFieldDefinition
  origin: PersistedTag | undefined
  isOwn: boolean
  kind: 'own' | 'ref' | 'inherited'
  originTitle: string
}

/** 悬浮提示单源：关系态 = 引用/继承 + 完整来源名；own 态无提示。
 *  徽标本体不展示 kind 文字（专属图标 + 连杆线条已区分语义），关系语义收敛进 tooltip。 */
function originTipOf(row: FieldRow): string | undefined {
  if (row.kind === 'own' || !row.originTitle) return undefined
  return `${row.kind === 'ref' ? '引用' : '继承'}自 ${row.originTitle}`
}

/** 来源标签名（超 5 字截断 + …）；own 态为空。 */
function originSrcOf(row: FieldRow): string {
  return row.kind !== 'own' && row.originTitle ? originText(row.originTitle) : ''
}

// ── 候选值解析（添加字段弹层用） ───────────────────────────────
/** 候选值文本 → 数组（空文本 → null，即非选项型）。 */
function parseOptions(raw: string): string[] | null {
  const values = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return values.length ? values : null
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

// ── 恢复内置预设（ADR-0049 三态模型：预设删后可恢复） ─────────────
//
// 顶层全局按钮：仅当存在被软删的预设字段定义时才出现（store.hasDeletedPresets）。
// 点击批量复活 is_preset=1 且已软删的行，绝不覆盖活跃编辑。

async function onRestorePresets() {
  await tagsStore.restoreBuiltinPresets()
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

// ── 添加字段弹层（搜索合一式：引用已有定义或新建，ADR-0050 D10 修订增补） ──

const addFieldOpen = ref(false)
const addFieldAnchor = ref<HTMLElement | null>(null)
const addFieldPos = ref({ x: 0, y: 0 })
const addFieldQuery = ref('')
const creatingNew = ref(false)
const addFieldSearchInput = ref<HTMLInputElement | null>(null)
const newFieldTitle = ref('')
const newFieldType = ref('string')
const newFieldOptions = ref('')
/** 新建 relation 字段时选定的关系类型 id（issue T5；落 closed_values 配置位）。 */
const newFieldRelTypeId = ref('')

// 关系类型清单（relation 字段的新建选择用）：惰性加载，清单为空时下拉显示空态
const relationshipTypes = useRelationshipTypes()

function openAddFieldPopover(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  addFieldAnchor.value = el
  addFieldPos.value = { x: rect.left, y: rect.bottom + 4 }
  addFieldQuery.value = ''
  creatingNew.value = false
  newFieldTitle.value = ''
  newFieldType.value = 'string'
  newFieldOptions.value = ''
  newFieldRelTypeId.value = ''
  // fire-and-forget：清单加载失败不阻断面板（下拉为空态）
  void relationshipTypes.load().catch(() => {})
  addFieldOpen.value = true
  nextTick(() => addFieldSearchInput.value?.focus())
}

/** 每个定义的声明方数（候选行的「N 个标签」元信息；孤儿定义 = 0）。 */
const fieldUsage = computed<Map<string, number>>(() => {
  const map = new Map<string, number>()
  for (const t of tagsStore.allTags) {
    for (const id of t.field_ids) map.set(id, (map.get(id) ?? 0) + 1)
  }
  return map
})

interface FieldCandidate {
  def: PersistedFieldDefinition
  typeLabel: string
  usage: number
  isSystem: boolean
}

/**
 * 引用候选（ADR-0050 D10 修订增补 #2）：全部存活定义——含系统字段与孤儿定义，
 * 排除本标签有效字段集（自身已声明 ∪ 继承已覆盖）已含的，防冗余声明与双通道重叠。
 */
const fieldCandidates = computed<FieldCandidate[]>(() => {
  const tag = selectedTag.value
  if (!tag) return []
  const covered = new Set(tagsStore.effectiveFieldIds(tag.id))
  return tagsStore.fieldDefinitions
    .filter((d) => !d.deleted_at && !covered.has(d.id))
    .map((d) => ({
      def: d,
      typeLabel: typeLabel(d),
      usage: fieldUsage.value.get(d.id) ?? 0,
      isSystem: d.is_system,
    }))
})

const filteredCandidates = computed<FieldCandidate[]>(() => {
  const q = addFieldQuery.value.trim().toLowerCase()
  if (!q) return fieldCandidates.value
  return fieldCandidates.value.filter((c) => c.def.title.toLowerCase().includes(q))
})

/** 搜索词精确命中任一存活定义（含已被本标签覆盖的）→ 不出「新建」行，避免重名定义。 */
const queryExactHit = computed(() => {
  const q = addFieldQuery.value.trim().toLowerCase()
  if (!q) return false
  return tagsStore.fieldDefinitions.some(
    (d) => !d.deleted_at && d.title.trim().toLowerCase() === q,
  )
})

/** 精确命中且该定义已在有效字段集里 → 提示「已在该标签中」。 */
const coveredHint = computed(() => {
  if (!queryExactHit.value) return false
  const tag = selectedTag.value
  if (!tag) return false
  const q = addFieldQuery.value.trim().toLowerCase()
  const covered = tagsStore.effectiveFieldIds(tag.id)
  return tagsStore.fieldDefinitions.some(
    (d) => !d.deleted_at && d.title.trim().toLowerCase() === q && covered.includes(d.id),
  )
})

const canCreateFromQuery = computed(
  () => !!addFieldQuery.value.trim() && !queryExactHit.value,
)

/** 引用候选行：声明既有定义进本标签（不新建定义）。 */
async function pickCandidate(def: PersistedFieldDefinition) {
  const tag = selectedTag.value
  if (!tag) return
  await tagsStore.referenceField(tag.id, def.id)
  addFieldOpen.value = false
}

function startCreate() {
  creatingNew.value = true
  if (!newFieldTitle.value.trim()) newFieldTitle.value = addFieldQuery.value.trim()
}

function backToPick() {
  creatingNew.value = false
}

/** 回车语义：有候选引用首个；无候选且可新建 → 转新建表单（标题预填搜索词）。 */
function onSearchEnter() {
  if (creatingNew.value) return
  const first = filteredCandidates.value[0]
  if (first) {
    pickCandidate(first.def)
  } else if (canCreateFromQuery.value) {
    startCreate()
  }
}

async function submitAddField() {
  const title = newFieldTitle.value.trim()
  if (!title || !selectedTag.value) return
  const isSelect = newFieldType.value === 'select'
  // multiSelect 落库为 type multiSelect + closed_values（select 是 string + closed_values 的伪类型，T4）
  const isMulti = newFieldType.value === 'multiSelect'
  // relation 落库为 type relation + closed_values=[关系类型 id]（配置位语义，issue T5；
  // 未选关系类型时不落空数组——null = 未约定，值编辑器仍可逐值任选）
  const isRelation = newFieldType.value === 'relation'
  await tagsStore.addFieldToTag(selectedTag.value.id, {
    title,
    type: isSelect ? 'string' : newFieldType.value,
    closed_values: isSelect || isMulti
      ? parseOptions(newFieldOptions.value)
      : isRelation
        ? (newFieldRelTypeId.value ? [newFieldRelTypeId.value] : null)
        : null,
  })
  addFieldOpen.value = false
}
</script>

<template>
  <div class="tags-page">
    <div class="tags-header">
      <PageTitle
        title="标签"
        :subtitle="statsSubtitle"
      />
      <div class="tag-list-actions">
        <label class="tag-search ">
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
          v-if="tagsStore.hasDeletedPresets"
          class="tag-restore-btn"
          type="button"
          title="恢复被删除的内置预设字段"
          @click="onRestorePresets"
        >
          恢复内置预设
        </button>
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
        </div>

        <div class="tag-rows">
          <div
            v-for="node in displayTags"
            :key="node.tag.id"
            class="tag-row"
            :class="[`tag-row--${node.tag.id}`, `tag-row--depth-${node.depth}`, { 'tag-row--active': selectedTagId === node.tag.id }]"
            :style="node.depth ? { paddingLeft: `calc(var(--space-3) + ${node.depth} * var(--space-4))` } : undefined"
            role="button"
            tabindex="0"
            @click="selectedTagId = node.tag.id"
            @keydown.enter="selectedTagId = node.tag.id"
          >
            <span class="tag-row-label">
              <!-- 标签色（ADR-0050 D11）：色点在左，标题胶囊保持中性 —— 整行染色会盖过层级 -->
              <span
                class="tag-row-title"
                :style="tagDotStyle(node.tag.color)"
              >#{{ node.tag.title }}</span>
              <!-- 系统标签额外标记（右栏只读的同义提示） -->
              <span
                v-if="node.tag.is_system"
                class="tag-row-system"
              >系统</span>
            </span>
            <span class="tag-row-meta tag-row-members">{{ memberCount(node.tag.id) }} 个成员</span>
          </div>
          <p
            v-if="!displayTags.length"
            class="tag-list-empty"
          >
            没有匹配的标签
          </p>
        </div>
      </aside>

      <!-- 拖拽分隔：按住调整左右栏宽度（右栏 = 详情，左栏 flex 吃剩余） -->
      <div
        class="tag-resizer"
        :class="{ 'tag-resizer--active': resizing }"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整左右栏宽度"
        @mousedown.prevent="startResize"
        @touchstart.passive="startResize"
      />

      <!-- 右栏：详情 -->
      <section
        class="tag-detail"
        :style="{ width: detailWidth + 'px' }"
      >
        <template v-if="selectedTag">
          <div class="tag-detail-head">
            <h2
              class="tag-detail-title"
              :style="tagDotStyle(selectedTag.color)"
            >
              #{{ selectedTag.title }}
            </h2>
            <button
              type="button"
              class="tag-detail-open"
              aria-label="查看成员"
              title="查看成员"
              @click="openAggregatePage"
            >
              <CornerUpRight
                class="tag-detail-open-arrow"
                :size="16"
              />
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

          <div class="tag-fields-head">
            <h3 class="tag-section-title">
              字段模板
            </h3>
            <span
              v-if="detailFields.length"
              class="tag-fields-count"
            >{{ detailFields.length }}</span>
          </div>
          <!-- 字段模板卡片（ADR-0057 D2 视觉升级）：auto-fill 栅格 + 类型色谱芯片。
               卡片 = FieldLabel（图标按类型染色，即设置入口）+ 类型·来源元信息行
               + 描述两行截断；全部配置（类型 / 默认 / 隐藏 / 形态 / 约束 / 特化 /
               枚举选项）统一进字段设置弹窗。key 含标签 id：切换标签时整组重挂载，
               让交错入场动效每次都重放。 -->
          <!-- 字段模板排序：VueDraggable 接管卡片重排（仅 own/ref 卡可拖，继承卡与添加卡不可拖）。
               容器即栅格（class 落在本组件根 div 上），卡片为直接栅格子；添加字段卡 / 空态
               经 filter 排除出拖拽，仍作为栅格子保留在末尾。系统标签只读面整体禁用拖拽。 -->
          <VueDraggable
            v-model="fieldRows"
            class="tag-fields f-card-grid"
            :disabled="isSystemTag"
            handle=".f-card-grip"
            draggable=".f-card--sortable"
            filter=".tag-add-field, .tag-fields-empty"
            :animation="180"
            ghost-class="f-card-ghost"
            drag-class="f-card-drag"
            chosen-class="f-card-chosen"
            :force-fallback="true"
            :fallback-on-body="true"
            @start="dragging = true"
            @end="onFieldReorder"
          >
            <div
              v-for="(row, idx) in fieldRows"
              :key="`${selectedTag?.id ?? ''}-${row.def.id}`"
              class="f-card"
              :class="[
                `f-card--t-${displayFieldType(row.def)}`,
                { 'f-card--inherited': row.kind === 'inherited', 'f-card--sortable': isSortable(row) },
              ]"
              :style="{ '--i': Math.min(idx, 11) }"
            >
              <!-- 设置入口不分来源（ADR-0057 D1 修订）：自身 / 引用 / 继承一律可点开
                   弹窗（定义全局共享，改一处处处同步，继承方与声明方同权）；
                   editable 只影响 tooltip 文案，系统定义的只读由弹窗内 is_system 门承担。 -->
              <div class="f-card-head">
                <!-- 拖拽手柄：仅可排序卡片显示（own/ref 且非系统标签）；继承卡与系统面不给手柄。
                     手柄是 Sortable 唯一起拖点，故不影响卡片其余区域的点击打开设置。 -->
                <button
                  v-if="isSortable(row)"
                  class="f-card-grip"
                  type="button"
                  tabindex="-1"
                  aria-label="拖动调整字段顺序"
                  @click.prevent
                >
                  <GripVertical :size="14" />
                </button>
                <FieldLabel
                  :title="row.def.title"
                  :type="displayFieldType(row.def)"
                  :spec="row.def.spec"
                  :editable="!row.def.is_system"
                  openable
                  @open-settings="editorStore.openFieldSettings(row.def.id)"
                />
              </div>
              <div class="f-card-meta">
                <span class="f-card-type">{{ typeLabel(row.def) }}</span>
                <!-- 来源徽标（关系态 = 图标 + CSS 连杆 + src 三段式）：
                     引用 = Link2 + 实线连杆（sky），继承 = Network + 虚线连杆（rose，与卡片虚线边框同语义）；
                     kind 文字（引用/继承）不进徽标，随来源名收敛进悬浮提示。 -->
                <span
                  class="f-card-origin"
                  :class="{
                    'f-card-origin--own': row.kind === 'own',
                    'f-card-origin--ref': row.kind === 'ref',
                    'f-card-origin--inherited': row.kind === 'inherited',
                  }"
                  :title="originTipOf(row)"
                >
                  <Network
                    v-if="row.kind === 'inherited'"
                    class="f-card-origin-icon"
                    :size="10"
                  />
                  <Link2
                    v-else-if="row.kind === 'ref'"
                    class="f-card-origin-icon"
                    :size="10"
                  />
                  <span v-if="row.kind === 'own'">自身</span>
                  <span
                    v-if="row.kind !== 'own'"
                    class="f-card-origin-src"
                  >{{ originSrcOf(row) }}</span>
                </span>
              </div>
              <p
                class="f-card-desc"
                :class="{ 'f-card-desc--empty': !row.def.description }"
                :title="row.def.description || undefined"
              >
                {{ row.def.description || '未填写描述' }}
              </p>
            </div>
            <p
              v-if="!detailFields.length"
              class="tag-fields-empty"
            >
              <Layers
                class="tag-fields-empty-icon"
                :size="18"
              />
              该标签还没有字段
            </p>
            <button
              v-if="!isSystemTag"
              class="tag-add-field"
              type="button"
              @click="openAddFieldPopover"
            >
              <Plus :size="15" />
              <span>添加字段</span>
            </button>
          </VueDraggable>

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

          <!-- 继承树只读可视化（ADR-0050 D17 §3）：祖先链 + 各祖先的字段贡献 / 被覆盖。
               节点点击 = 本页选中该标签；树内不提供编辑，父标签修改仍走上方单父槽位。 -->
          <div
            v-if="inheritChain.length"
            class="tag-inherit-tree"
          >
            <div class="tag-inherit-tree-title">
              继承树
            </div>
            <div
              v-for="node in inheritChain"
              :key="node.tag.id"
              class="tag-inherit-node"
            >
              <button
                type="button"
                class="tag-inherit-node-btn"
                :title="`查看 #${node.tag.title}`"
                @click="selectedTagId = node.tag.id"
              >
                <span
                  class="tag-color-dot"
                  :class="{ 'tag-color-dot--empty': isColorless(node.tag.color) }"
                  :style="tagDotStyle(node.tag.color)"
                />
                <span class="tag-inherit-node-name">#{{ node.tag.title }}</span>
              </button>
              <span
                v-if="node.contributed.length"
                class="tag-inherit-node-fields"
              >贡献：{{ node.contributed.join(' / ') }}</span>
              <span
                v-if="node.covered.length"
                class="tag-inherit-node-covered"
                title="这些字段本标签已自行声明，生效优先级高于祖先"
              >被本标签覆盖：{{ node.covered.join(' / ') }}</span>
            </div>
          </div>

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

    <!-- 添加字段：搜索合一式（引用已有定义或新建，ADR-0050 D10 修订增补） -->
    <BasePopover
      :visible="addFieldOpen"
      :position="addFieldPos"
      :anchor-el="addFieldAnchor"
      @close="addFieldOpen = false"
    >
      <div class="tag-field-panel">
        <label class="tag-field-search">
          <Search
            class="tag-field-search-icon"
            :size="13"
          />
          <input
            ref="addFieldSearchInput"
            v-model="addFieldQuery"
            class="tag-field-search-input"
            type="text"
            placeholder="搜索或新建字段"
            @keydown.enter.prevent="onSearchEnter"
          >
        </label>

        <div
          v-if="creatingNew"
          class="tag-field-create"
        >
          <div class="tag-field-create-label">
            新建字段
          </div>
          <input
            v-model="newFieldTitle"
            class="tag-field-title-input"
            type="text"
            placeholder="字段标题"
            @keydown.enter.prevent="submitAddField"
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
            v-if="newFieldType === 'select' || newFieldType === 'multiSelect'"
            v-model="newFieldOptions"
            class="tag-field-options"
            type="text"
            placeholder="候选值，逗号分隔"
          >
          <!-- relation（issue T5）：选定关系类型（落 closed_values 配置位；未选 = 未约定） -->
          <select
            v-if="newFieldType === 'relation'"
            v-model="newFieldRelTypeId"
            class="tag-field-type-select"
          >
            <option
              value=""
              disabled
            >
              选择关系类型
            </option>
            <option
              v-for="rt in relationshipTypes.items.value"
              :key="rt.id"
              :value="rt.id"
            >
              {{ rt.label }}
            </option>
          </select>
          <div class="tag-field-create-actions">
            <button
              type="button"
              class="tag-field-back"
              @click="backToPick"
            >
              返回
            </button>
            <button
              type="button"
              class="tag-field-confirm"
              :disabled="!newFieldTitle.trim() || (newFieldType === 'relation' && !newFieldRelTypeId)"
              @click="submitAddField"
            >
              添加字段
            </button>
          </div>
        </div>

        <template v-else>
          <div class="tag-field-candidates">
            <button
              v-for="row in filteredCandidates"
              :key="row.def.id"
              type="button"
              class="tag-field-candidate"
              @click="pickCandidate(row.def)"
            >
              <span class="tag-field-candidate-title">{{ row.def.title }}</span>
              <span class="tag-field-candidate-meta">
                <span
                  v-if="row.isSystem"
                  class="tag-field-candidate-badge"
                >系统</span>
                {{ row.typeLabel }} · {{ row.usage > 0 ? `${row.usage} 个标签` : '未被使用' }}
              </span>
            </button>

            <div
              v-if="coveredHint"
              class="tag-field-candidates-empty"
            >
              「{{ addFieldQuery.trim() }}」已在该标签中
            </div>
            <button
              v-else-if="canCreateFromQuery"
              type="button"
              class="tag-field-candidate tag-field-candidate--create"
              @click="startCreate"
            >
              <Plus :size="13" />
              <span class="tag-field-candidate-title">新建「{{ addFieldQuery.trim() }}」</span>
            </button>
            <div
              v-else-if="!filteredCandidates.length"
              class="tag-field-candidates-empty"
            >
              全部可用字段已添加
            </div>
          </div>
          <button
            v-if="!addFieldQuery.trim()"
            type="button"
            class="tag-field-create-toggle"
            @click="startCreate"
          >
            <Plus :size="13" />
            手动新建字段
          </button>
        </template>
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

.tags-header {
  display: flex;
  align-items: flex-end;
  gap: var(--space-6);
  padding-bottom: var(--space-4);
  .tag-list-actions {
    padding-top: var(--space-8);
  }
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

/* 恢复内置预设：次按钮（与「新建标签」同尺寸，但走中性描边，区别于主操作） */
.tag-restore-btn {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  background: var(--bg-base2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
    border-color: var(--border-strong);
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
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.tag-filter-chips {
  --nvb-thumb: var(--bg-base);

  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px;
  flex: none;
  max-width: 55%;
  border-radius: var(--radius-sm, 6px);
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--surface-subtle);
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

[data-theme='dark'] .tag-filter-chips {
  --nvb-thumb: var(--bg-active);
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
  gap: 4px;
  white-space: nowrap;
  // 左右对称内边距 0.9em（对齐参考图实测比例）；右侧同时容下 hover 才淡入的 ⋯
  padding: 0 11px;
  height: 26px;
  border-radius: calc(var(--radius-sm, 6px) - 2px);
  cursor: grab;
  user-select: none;
  position: relative;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs, 0.75rem);
  font-weight: 500;
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  &:active {
    cursor: grabbing;
  }

  &.tag-filter-chip--active {
    background: var(--nvb-thumb);
    color: var(--text-primary);
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
  // 标题胶囊（1fr 吃余量，左对齐）+ 成员数定宽右对齐
  grid-template-columns: 1fr 102px;
  column-gap: var(--space-3);
  align-items: center;
  min-height: 30px;
  padding: 0 var(--space-6) 0 var(--space-3);
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  cursor: pointer;

  &:not(.tag-row--active):hover {
    background: var(--bg-hover);
  }
}

.tag-row-label {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

/* 标签色点（ADR-0050 D11）：无色渲染成空心环，与「有色实心点」一眼可分。
   有色的填充由 `tagDotStyle` 内联给出；无色时 `--empty` 补边框 —— 两者判据同源。 */

.tag-row-title {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 var(--space-2);
  color: var(--text-primary);
  white-space: nowrap;
  // background: var(--bg-base);
  // border: 1px solid var(--border);
  // border-radius: var(--radius-sm);
}

.tag-row-system {
  color: var(--text-tertiary);
  white-space: nowrap;
}

.tag-row-meta {
  color: var(--text-secondary);
  white-space: nowrap;
  text-align: right;
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
.tag-detail-empty,
.tag-parent-empty {
  padding: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

/* ── 拖拽分隔 ── */
.tag-resizer {
  flex-shrink: 0;
  align-self: stretch;
  width: 6px;
  user-select: none;
  cursor: col-resize;
  position: relative;
  // 命中盒 6px，但视觉只有 1px 线 —— 既好点又不喧宾夺主
  &::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 1px;
    background: var(--border);
    transition: background var(--dur-fast) var(--ease-out);
  }

  &:hover::after,
  &--active::after {
    background: var(--accent);
  }

  // 拖拽中给一层全高的浅色热区提示（仅视觉，不挡命中盒）
  &--active {
    background: var(--bg-hover);
  }
}

/* ── 右栏 ── */
.tag-detail {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  /* 字段模板是卡片栅格（类型色谱卡）→ 右栏需比常规详情宽些才不挤；
     具体宽度由用户拖拽决定（`.tag-resizer`），落库到 localStorage */
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

/* 进聚合页（D7）的唯一入口：方形 ghost 图标按钮，悬停时箭头右移示意跳转。
   图标用 lucide 矢量（CornerUpRight = 向右上外跳），继承 currentColor，暗色模式自适应。 */
.tag-detail-open {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--text-tertiary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);

  &:hover {
    color: var(--accent-hover);
    background: var(--bg-hover);
    border-color: var(--accent-40);

    .tag-detail-open-arrow {
      transform: translateX(2px);
    }
  }
}

.tag-detail-open-arrow {
  transition: transform var(--dur-fast) var(--ease-out);
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

/* 字段模板区（重设计）：区头（标题 + 数量徽标）+ auto-fill 流式栅格 */
.tag-fields-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-2) 0;

  .tag-section-title {
    margin: 0;
  }
}

.tag-fields-count {
  padding: 0 var(--space-2);
  font-size: var(--text-xs);
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
  background: var(--surface-subtle);
  border-radius: 999px;
}

/* 字段模板卡片栅格：auto-fill 弹性列宽（消除定宽 flex 的行尾孤块）；多字段时收缩 + 内部滚动 */
.tag-fields.f-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(216px, 1fr));
  gap: var(--space-2);
  padding: 1px;
  /* 最大高度不再写死：字段多时收缩、内部滚动，把下方（继承 / 删除）留在面板内（需求 #3） */
  flex-shrink: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: var(--space-1);
}

/* 单张字段卡：识别 + 入口（类型 / 默认 / 隐藏 / 形态 / 约束 / 特化 / 选项统一进字段设置弹窗）。
   --f-type 为该卡的字段类型色（下方色谱表分派），仅染图标芯片与 hover 描边，卡面保持中性。 */
.f-card {
  --f-type: var(--text-tertiary);

  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  box-sizing: border-box;
  padding: var(--space-3);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
  // 交错入场：--i 由 v-for 序号注入（封顶 11），切换标签整组重放
  animation: f-card-in var(--dur-base) var(--ease-out) backwards;
  animation-delay: calc(var(--i, 0) * 26ms);

  &:hover {
    border-color: color-mix(in srgb, var(--f-type) 42%, var(--border));
    box-shadow: var(--shadow-elevation-1);
    transform: translateY(-1px);
  }

  /* 继承字段：定义归祖先 → 虚线边框提示「只读来源」（ref 仍可编辑，不虚线） */
  &--inherited {
    border-style: dashed;
  }

  /* 可排序卡片：悬停时左缘浮现拖拽手柄（手柄是 Sortable 唯一起拖点） */
  &--sortable {
    .f-card-grip {
      opacity: 0;
    }

    &:hover .f-card-grip {
      opacity: 1;
    }
  }
}

/* 拖拽手柄：类型色弱化、静息隐藏、悬停浮现；只作 Sortable 起拖点，自身不接收点击 */
.f-card-grip {
  display: inline-flex;
  align-items: center;
  flex: none;
  padding: 0;
  color: var(--text-disabled);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: grab;
  transition: opacity var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);

  &:hover {
    color: var(--f-type);
  }

  &:active {
    cursor: grabbing;
  }
}

/* Sortable 拖拽态（force-fallback：克隆挂 body，故类作用域在全局仍可命中） */
.f-card-ghost {
  opacity: 0.4;
  border-style: dashed;
  border-color: var(--accent);
}

.f-card-drag {
  box-shadow: var(--shadow-elevation-3);
  cursor: grabbing;
}

.f-card-chosen {
  border-color: var(--accent);
}

/* 类型色谱（displayFieldType 分派，与 field-type-icons 同口径）：未列出的扩展类型走中性回落 */
.f-card--t-string {
  --f-type: #64748B;
}

.f-card--t-number {
  --f-type: #D97706;
}

.f-card--t-boolean {
  --f-type: #059669;
}

.f-card--t-date,
.f-card--t-datetime,
.f-card--t-daterange {
  --f-type: #2563EB;
}

.f-card--t-select,
.f-card--t-multiSelect {
  --f-type: #7C3AED;
}

.f-card--t-page {
  --f-type: #4F46E5;
}

.f-card--t-file {
  --f-type: #EA580C;
}

.f-card--t-relation {
  --f-type: #0891B2;
}

.f-card--t-array {
  --f-type: #0D9488;
}

/* 暗色：色相不变，整体上调到 400 档保证暗底可辨 */
[data-theme='dark'] {
  .f-card--t-string {
    --f-type: #94A3B8;
  }

  .f-card--t-number {
    --f-type: #FBBF24;
  }

  .f-card--t-boolean {
    --f-type: #34D399;
  }

  .f-card--t-date,
  .f-card--t-datetime,
  .f-card--t-daterange {
    --f-type: #60A5FA;
  }

  .f-card--t-select,
  .f-card--t-multiSelect {
    --f-type: #A78BFA;
  }

  .f-card--t-page {
    --f-type: #818CF8;
  }

  .f-card--t-file {
    --f-type: #FB923C;
  }

  .f-card--t-relation {
    --f-type: #22D3EE;
  }

  .f-card--t-array {
    --f-type: #2DD4BF;
  }
}

@keyframes f-card-in {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .f-card {
    animation: none;
  }
}

/* 卡片头：FieldLabel 在卡内升格为「类型色芯片」（deep 覆写只作用于本页，不影响 BlockFieldZone） */
.f-card-head {
  display: flex;
  align-items: center;
  min-width: 0;
}

.f-card :deep(.field-label) {
  gap: var(--space-2);
}

.f-card :deep(.field-label-entry) {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--f-type) 11%, transparent);
  color: var(--f-type);
  transition:
    background var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--f-type) 20%, transparent);
    color: var(--f-type);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--f-type) 14%, transparent);
  }

  svg {
    width: 14px;
    height: 14px;
  }
}

.f-card :deep(.field-label-name) {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}

/* 元信息行：类型文字标签 + 来源三态徽标（自身 / 引用←X / 继承←X，ADR-0050 D10 修订增补 #4） */
.f-card-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.f-card-type {
  flex: none;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  letter-spacing: 0.02em;
}

.f-card-origin {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  overflow: hidden;
  padding: 0 var(--space-2);
  font-size: var(--text-xs);
  line-height: 18px;
  white-space: nowrap;
  border-radius: 999px;

  /* 三态专属标识：own=强调填充（多数态，保持安静）；
     引用=Link2+实线连杆（sky，「借来的」）；继承=Network+虚线连杆（rose，lineage 语义，
     与卡片虚线边框同构）。色相不与类型色谱撞车：sky/rose 均未用于类型芯片。 */
  &--own {
    color: var(--accent-hover);
    background: var(--accent-06);
  }

  &--ref {
    color: #0369A1;
    background: color-mix(in srgb, #0284C7 9%, transparent);

    &:hover {
      background: color-mix(in srgb, #0284C7 16%, transparent);
    }
  }

  &--inherited {
    color: #BE123C;
    background: color-mix(in srgb, #E11D48 8%, transparent);

    &:hover {
      background: color-mix(in srgb, #E11D48 14%, transparent);
    }
  }
}

/* 关系态徽标带说明 tooltip（title=引用/继承自 X）→ help 光标提示可悬停；own 无 tooltip 保持 default */
.f-card-origin--ref,
.f-card-origin--inherited {
  cursor: help;
}

[data-theme='dark'] .f-card-origin--own {
  color: var(--accent);
}

[data-theme='dark'] .f-card-origin--ref {
  color: #7DD3FC;
  background: color-mix(in srgb, #38BDF8 12%, transparent);

  &:hover {
    background: color-mix(in srgb, #38BDF8 20%, transparent);
  }
}

[data-theme='dark'] .f-card-origin--inherited {
  color: #FB7185;
  background: color-mix(in srgb, #FB7185 12%, transparent);

  &:hover {
    background: color-mix(in srgb, #FB7185 20%, transparent);
  }
}

.f-card-origin-icon {
  flex: none;
}

/* 继承 = 虚线连杆（与卡片虚线边框同语义：来自祖先的血统线） */
.f-card-origin--inherited::before {
  border-top-style: dashed;
}

.f-card-origin-src {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 描述：最多两行，超出截断（完整内容看 title / 字段设置弹窗） */
.f-card-desc {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  font-size: var(--text-xs);
  font-weight: var(--font-normal);
  color: var(--text-secondary);
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  word-break: break-word;

  /* 空描述占位：灰字示意，保持有/无描述的卡片等高同构 */
  &--empty {
    color: var(--text-disabled);
  }
}

/* 添加字段：栅格内的虚线添加块 —— 与卡片同构，悬停点亮强调色 */
.tag-add-field {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-height: 84px;
  padding: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  background: transparent;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);

  &:hover {
    color: var(--accent);
    border-color: var(--accent-40);
    background: var(--accent-03);
  }
}

.tag-fields-empty {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  padding: var(--space-5) 0 var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-disabled);
}

.tag-fields-empty-icon {
  color: var(--text-disabled);
}

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

/* 继承树只读可视化（ADR-0050 D17 §3）：祖先链单轨 + 字段贡献 / 被覆盖 */
.tag-inherit-tree {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: var(--space-2);
  padding: var(--space-2);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.tag-inherit-tree-title {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.tag-inherit-node {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: var(--space-3);
  border-left: 1px solid var(--border);
}

.tag-inherit-node-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0;
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: transparent;
  border: none;
  cursor: pointer;
  align-self: flex-start;
  transition: color var(--dur-fast) var(--ease-out);

  &:hover {
    color: var(--accent);
  }
}

.tag-inherit-node-fields,
.tag-inherit-node-covered {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-inherit-node-covered {
  opacity: 0.75;
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

  &:disabled {
    opacity: 0.5;
    cursor: default;
    background: var(--accent);
  }
}

/* ── 添加字段弹层：搜索合一式（ADR-0050 D10 修订增补）──
   搜索引用已有定义（候选 = 全部存活定义 − 有效字段已含项），无命中转新建。 */
.tag-field-panel {
  width: 264px;
  padding: var(--space-2);
}

.tag-field-search {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  background: var(--bg-base2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  transition: border-color var(--dur-fast) var(--ease-out);

  &:focus-within {
    border-color: var(--accent);
  }
}

.tag-field-search-icon {
  flex: none;
  color: var(--text-tertiary);
}

.tag-field-search-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  font-size: var(--text-sm);
  color: var(--text-primary);
  background: transparent;
  border: none;
  outline: none;

  &::placeholder {
    color: var(--text-tertiary);
  }
}

.tag-field-candidates {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 228px;
  overflow-y: auto;
}

.tag-field-candidate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  min-height: 30px;
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
  text-align: left;
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);

  &:hover {
    background: var(--bg-hover);
  }
}

.tag-field-candidate-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-field-candidate-meta {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
  max-width: 62%;
  overflow: hidden;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-field-candidate-badge {
  flex: none;
  padding: 0 4px;
  font-size: 10px;
  line-height: 16px;
  color: var(--text-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.tag-field-candidate--create {
  color: var(--accent);

  &:hover {
    color: var(--accent-hover);
  }
}

.tag-field-candidates-empty {
  padding: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  text-align: center;
}

.tag-field-create-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  color: var(--accent);
  background: transparent;
  border: none;
  cursor: pointer;

  &:hover {
    color: var(--accent-hover);
  }
}

.tag-field-create {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.tag-field-create-label {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.tag-field-create-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.tag-field-back {
  padding: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
  }
}

.tag-field-create .tag-field-confirm {
  flex: 1;
}
</style>
