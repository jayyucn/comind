<script setup lang="ts" generic="T">
import {
  Calendar,
  CheckSquare,
  ChevronDown,
  Hash,
  Link2,
  ListChecks,
  ListFilter,
  MapPin,
  Type,
} from 'lucide-vue-next';
import type { Component } from 'vue';
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import type { FieldDescriptor, Group, Option, SortRule } from '../../core/query';
import type { TableColumnConfig, TableConfig } from '../../core/view';
import BasePopover from '../common/BasePopover.vue';
import PaginationFooter from './PaginationFooter.vue';
import type { CellRegistry } from './types';
import { distributeColumnWidths } from './tableWidths';

/** 缺省每页行数。 */
const DEFAULT_PAGE_SIZE = 50

const props = defineProps<{
  /** 已过滤+排序的扁平列表（非分组时直接渲染）。实体无关，任意记录类型皆可。 */
  items: T[]
  /** 实体字段描述符（驱动每格按类型渲染 + 选项/标签）。由调用方注入对应注册表字段。 */
  fields: FieldDescriptor[]
  /** 分组桶（groupBy 设了时按桶渲染）。 */
  groups: Group<T>[]
  /** 是否按 groupBy 渲染分组区块。 */
  grouped: boolean
  /** 当前排序规则（驱动表头方向图标）。 */
  sort: SortRule[]
  /** 表格布局配置：列序与列宽来自 TableConfig（ADR-0005/0006）。缺省按安全兜底。 */
  config?: TableConfig
  /** 取记录 id 的字段名（默认 'id'）。BlockCard 用 'block_id'。 */
  idKey?: string
  /** 每页行数（ADR-0024 渲染层分页：仅切片渲染，数据源仍全量，查询引擎契约不变）。缺省 50；组件内可经下拉切换。 */
  pageSize?: number
  /** 自定义单元格渲染器注册表：cell key → Vue 组件。opt-in：仅当列配置含 cell 且命中时才委派（ADR-0010）。 */
  cellRegistry?: CellRegistry
}>()

const emit = defineEmits<{
  /** 单元格编辑（boolean/select 可编辑列触发）。 */
  cellChange: [itemId: string, fieldKey: string, value: unknown]
  /**
   * 单元格点击：上报「点了哪个记录的哪个字段」的事实（itemId + fieldKey）。
   * 组件不表达任何业务意图、不判断列角色；是否跳转/如何处理由业务方按字段 key 裁决。
   */
  cellClick: [itemId: string, fieldKey: string]
  /**
   * 列宽拖拽缩放（表头手柄，ADR-0013 边界联动）：上报本次拖拽涉及的列宽变更集合。
   * 拖宽本列时紧邻的下一列同步变窄（总宽恒定），故一次性带回本列与下一列的最终像素宽。
   * 组件哑发射、不写 store；由外壳经 store.patchActiveTabConfig 落库（与列显隐/排序同通道）。
   */
  columnResize: [changes: { key: string; width: number }[]]
  /** 表头菜单：列对齐（左/中/右）—— 由外壳经 patchActiveTabConfig 写回 TableColumnConfig.align。 */
  columnAlign: [key: string, align: 'left' | 'center' | 'right']
  /** 表头菜单：隐藏字段（visible=false，ADR-0011 同通道）。 */
  columnVisibility: [key: string, visible: boolean]
  /** 表头菜单：重置列宽（清除该列 width，回落到组件默认列宽）。 */
  columnReset: [key: string]
}>()

/** 渲染分区：分组时取分组桶；平铺时合成单一全量分区。 */
const sections = computed<Group<T>[]>(
  () => props.grouped ? props.groups : [{ key: '', label: '', items: props.items }],
)

// ── 渲染层分页（ADR-0024） ──
// 记录跨组连续切页：先把所有分区的记录按序扁平化，slice 出当前页，再按原分区 key 重组渲染。
const paginationEnabled = computed(() => {
  const ps = props.pageSize ?? DEFAULT_PAGE_SIZE
  return ps > 0 && props.items.length > ps
})
/** 扁平化记录序列（保留分区边界，供翻页后重组）。 */
const flattened = computed<{ key: string; label: string; item: T }[]>(() => {
  const out: { key: string; label: string; item: T }[] = []
  for (const s of sections.value) {
    for (const item of s.items) out.push({ key: s.key, label: s.label, item })
  }
  return out
})
const pageSize = ref(props.pageSize ?? DEFAULT_PAGE_SIZE)
const currentPage = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(flattened.value.length / pageSize.value)))
/** 当前页渲染切片：跨组连续切页后按原分区 key 重组（ADR-0024 D2）。未启用分页时返回全量。 */
const pageSections = computed<Group<T>[]>(() => {
  const flat = flattened.value
  if (!paginationEnabled.value) {
    // 禁用分页（pageSize<=0）：渲染全量（旧行为）
    if (!props.grouped) return [{ key: '', label: '', items: flat.map((p) => p.item) }]
    const all = new Map<string, { key: string; label: string; items: T[] }>()
    for (const p of flat) {
      const b = all.get(p.key) ?? { key: p.key, label: p.label, items: [] }
      b.items.push(p.item)
      all.set(p.key, b)
    }
    return [...all.values()]
  }
  const start = (currentPage.value - 1) * pageSize.value
  const pageItems = flat.slice(start, start + pageSize.value)
  if (!props.grouped) {
    return [{ key: '', label: '', items: pageItems.map((p) => p.item) }]
  }
  const buckets = new Map<string, { key: string; label: string; items: T[] }>()
  for (const p of pageItems) {
    const b = buckets.get(p.key) ?? { key: p.key, label: p.label, items: [] }
    b.items.push(p.item)
    buckets.set(p.key, b)
  }
  return [...buckets.values()]
})
/** 是否显示分页条（启用分页时；单页/空态不显示）。 */
const showPagination = computed(() => paginationEnabled.value)

// 查询输入变化（排序/分组/结果集长度）→ 回第 1 页（ADR-0024 D3）；行内编辑不触发（items 引用变化但长度不变）。
watch(
  () => [props.sort, props.grouped, flattened.value.length] as const,
  () => { currentPage.value = 1 },
)
// 越界保护：删除/筛选导致当前页超界 → clamp 到最后一页（ADR-0024 D3）。
watch(totalPages, (n) => {
  if (currentPage.value > n) currentPage.value = n
})

function onPageChange(p: number) {
  currentPage.value = Math.min(Math.max(1, p), totalPages.value)
}

/** 页大小切换：改后 clamp 当前页（ADR-0024 D4）。 */
function onPageSizeChange(size: number) {
  pageSize.value = size
  if (currentPage.value > totalPages.value) currentPage.value = totalPages.value
}

/**
 * 列序：config 优先；否则安全兜底为仅主文本列（content）。
 * 不回退到全部注册字段——否则忘记传 config 的通用消费方会渲染一张含内部字段（dateRefKind 等）的不可用例表。
 * TaskHub 永远传 BLOCK_DEFAULT_TABLE_CONFIG，故块实体仍见 7 列（ADR-0007 D8 修复）。
 */
/** 渲染列：config 优先；过滤 per-tab 隐藏列（visible===false，ADR-0011）。缺省兜底为仅主文本列。 */
const columns = computed<TableColumnConfig[]>(
  () => (props.config?.columns ?? [{ key: 'content' }]).filter((c) => c.visible !== false),
)

function idOf(item: T): string {
  return String((item as Record<string, unknown>)[props.idKey ?? 'id'])
}

function fieldOf(key: string): FieldDescriptor | undefined {
  return props.fields.find((f) => f.key === key)
}

/** 表头类型图标（lucide）：link 角色列 → Link2；其余按字段类型映射；未知类型不渲染。 */
function headerIconOf(col: TableColumnConfig) {
  if (col.role === 'link') return Link2
  const type = fieldOf(col.key)?.type
  if (type === 'text') return Type
  if (type === 'number') return Hash
  if (type === 'date') return Calendar
  if (type === 'select') return ListFilter
  if (type === 'multiSelect') return ListChecks
  if (type === 'boolean') return CheckSquare
  return undefined
}

/** 自定义单元格：列配置含 cell 且注册表命中 → 接管整格渲染（opt-in，ADR-0010）。否则回退内置 type/role 链。 */
function hasCell(col: TableColumnConfig): boolean {
  return !!col.cell && !!props.cellRegistry?.[col.cell]
}
function resolveCell(col: TableColumnConfig): Component {
  return props.cellRegistry![col.cell!]
}
/** 自定义单元格回传变更：包成既有 cellChange 契约，业务层零改动（ADR-0010）。 */
function onCustomChange(col: TableColumnConfig, item: T, value: unknown) {
  emit('cellChange', idOf(item), col.key, value)
}

/** 字段单元格交互是否可编辑（FieldDescriptor.editable，缺省可编辑；Page.type 等显式 false 为只读）。 */
function isFieldEditable(col: TableColumnConfig): boolean {
  return fieldOf(col.key)?.editable !== false
}

/** 单元格原始值：优先字段取值器，缺字段时回退读取记录同名属性。 */
function valueOf(item: T, col: TableColumnConfig): unknown {
  const field = fieldOf(col.key)
  if (field) return field.get(item)
  return (item as Record<string, unknown>)[col.key]
}

function resolveOptions(field: FieldDescriptor | undefined): Option[] {
  if (!field?.options) return []
  return typeof field.options === 'function' ? field.options() : field.options
}

/** 列宽缩放：本地映射做拖拽实时反馈；link 列默认 40px 且无手柄、可被左分隔线联动改写（ADR-0013）。 */
const MIN_COL_WIDTH = 60
/** 缺省列宽兜底（未设宽列/新增字段的比例基准；jsdom 快照失败兜底；不写入存储）。 */
const DEFAULT_COL_WIDTH = 160

/** 本地列宽映射：以 config.columns[].width 初始化；拖拽时即时写入做反馈；config 变化（切 tab / 外部 patch）时同步。 */
const widths = reactive<Record<string, number>>({})
/**
 * 清理式同步（ADR-0013）：先删除不在 config 中的残留 key（列被删除即遗忘宽度，重新添加时用默认 160），
 * 再写入 config 中的显式 width。visible=false 的隐藏列仍在 config.columns，宽度保留（显隐不丢宽）。
 */
function syncWidths() {
  const cols = props.config?.columns
  if (!cols) return
  const keys = new Set(cols.map((c) => c.key))
  for (const k of Object.keys(widths)) {
    if (!keys.has(k)) delete widths[k]
  }
  for (const c of cols) {
    if (c.width != null) widths[c.key] = c.width
  }
}
syncWidths()
watch(() => props.config, () => syncWidths())

/** 单列基准像素宽：link 默认 40px 但可被左分隔线联动改写（用户场景：拖宽"页面"列看完整路径）；数据列取本地映射，未设（新增字段/未拖过）按 DEFAULT_COL_WIDTH=160 兜底。 */
function colPxOf(col: TableColumnConfig): number {
  if (col.role === 'link') return widths[col.key] ?? col.width ?? 40
  return widths[col.key] ?? col.width ?? DEFAULT_COL_WIDTH
}

// ── 比例模式（ADR-0013）：容器宽由 ResizeObserver 跟踪，列宽由 JS 权重分配 ──
// 背景：table-layout:fixed 下单元格 min-width 对列宽无效（CSS 规范），「压缩到下限后横向滚动」
// 必须由 JS 计算（见 tableWidths.ts）。jsdom/SSR 无 ResizeObserver → 退化为全下限（每列 40px）。
const rootEl = ref<HTMLElement | null>(null)
const containerWidth = ref(0)
let ro: ResizeObserver | null = null
function observeContainer() {
  const scroll = rootEl.value?.querySelector<HTMLElement>('.table-scroll') ?? null
  if (!scroll) return
  containerWidth.value = scroll.clientWidth
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      containerWidth.value = scroll.clientWidth
    })
    ro.observe(scroll)
  }
}
onMounted(observeContainer)
/** 各列渲染像素宽：min + 剩余空间按 (基准宽 - min) 权重分配；末列吸收误差（总和 = 表格宽）。 */
const colWidths = computed<Record<string, number>>(() => {
  const cs = columns.value
  const arr = distributeColumnWidths(cs.map((c) => colPxOf(c)), containerWidth.value, MIN_COL_WIDTH)
  return Object.fromEntries(cs.map((c, i) => [c.key, arr[i]]))
})
/** 表格宽 = max(容器宽, 各列下限之和)；容器更窄时表格宽保持下限之和 → .table-scroll 横向滚动。 */
const tableWidth = computed<number>(() => {
  const n = columns.value.length
  return Math.max(containerWidth.value, n * MIN_COL_WIDTH)
})
const tableStyle = computed<Record<string, string>>(() => ({ width: `${tableWidth.value}px` }))

/**
 * 单列渲染宽：colWidths 中的像素值（四舍五入）。表格宽与各列宽都由 JS 计算，
 * 容器变化时按权重等比伸缩；拖拽边界联动改基准像素 → 权重随之更新，无需切换模式。
 */
function columnWidth(col: TableColumnConfig): string | undefined {
  const w = colWidths.value[col.key]
  return w != null ? `${Math.round(w)}px` : undefined
}

// ── 表头拖拽缩放（边界联动，ADR-0013）：每条分隔线只改左右两列，一增一减、总宽恒定，其余列不动。
// Pointer Events + window 级 move/up 防丢事件；onUnmounted 兜底清理 ──
let dragKey: string | null = null
let dragNextKey: string | null = null
let dragStartX = 0
let dragStartW = 0
let dragStartNextW = 0

function onResizeStart(col: TableColumnConfig, e: PointerEvent) {
  if (col.role === 'link') return
  e.preventDefault()

  // 快照所有数据列的当前渲染宽：让基准像素反映真实内容宽（而非估算 160），
  // 拖拽联动改基准像素 → 比例权重随之更新（比例模式，ADR-0013）。
  const headerRow = (e.currentTarget as HTMLElement).closest('thead') as HTMLElement | null
  const thElems = headerRow?.querySelectorAll('th') ?? []
  for (let i = 0; i < columns.value.length && i < thElems.length; i++) {
    const c = columns.value[i]
    if (c.role === 'link') continue
    if (widths[c.key] == null) {
      widths[c.key] = thElems[i].getBoundingClientRect().width || DEFAULT_COL_WIDTH
    }
  }

  // 相邻下一列（按渲染顺序）：边界联动的另一侧。手柄只渲染在「两列之间」，故此处恒有 next。
  // next 为 link 列时也参与联动（用户场景：拖"截止↔页面"让"页面"列变宽），link 起始宽按 40 兜底。
  const idx = columns.value.findIndex((c) => c.key === col.key)
  const next = idx >= 0 ? columns.value[idx + 1] : undefined

  dragKey = col.key
  dragStartX = e.clientX
  dragStartW = widths[col.key] ?? MIN_COL_WIDTH

  if (next) {
    dragNextKey = next.key
    dragStartNextW = widths[next.key] ?? (next.role === 'link' ? next.width ?? 40 : MIN_COL_WIDTH)
  } else {
    dragNextKey = null
  }

  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
}

function onResizeMove(e: PointerEvent) {
  if (!dragKey) return
  const delta = e.clientX - dragStartX
  let newW = Math.max(MIN_COL_WIDTH, dragStartW + delta)
  // 联动：本列增长不越过「下一列 ≥ MIN」的界（两列之和恒定）
  if (dragNextKey) newW = Math.min(newW, dragStartW + (dragStartNextW - MIN_COL_WIDTH))
  const clampedDelta = newW - dragStartW
  widths[dragKey] = newW
  if (dragNextKey) widths[dragNextKey] = Math.max(MIN_COL_WIDTH, dragStartNextW - clampedDelta)
}

function onResizeEnd() {
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
  if (dragKey) {
    const changes = [{ key: dragKey, width: Math.round(widths[dragKey]!) }]
    if (dragNextKey) changes.push({ key: dragNextKey, width: Math.round(widths[dragNextKey]!) })
    emit('columnResize', changes)
  }
  dragKey = null
  dragNextKey = null
}

onUnmounted(() => {
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
})

/** 行置灰：存在 role='done' 列且该字段为真时（通用完成态表现）。 */
function isDoneRow(item: T): boolean {
  const doneCol = columns.value.find((c) => c.role === 'done')
  if (!doneCol) return false
  return Boolean(valueOf(item, doneCol))
}

function onCellClick(item: T, col: TableColumnConfig) {
  // 只上报「点了哪个记录的哪个字段」的事实（itemId + fieldKey）；可编辑控件（checkbox/select）
  // 已在控件上 stopPropagation，不会误报。跳转与否由业务方按字段 key 裁决。
  emit('cellClick', idOf(item), col.key)
}

/** td 整体点击：根据字段类型分发——select + editable 直接唤起菜单；其余走 onCellClick。
 *  整个 cell 都是点击区域（边框已去掉，padding 内空白处同样响应）。 */
function onCellMaybeOpenSelect(item: T, col: TableColumnConfig, e: MouseEvent) {
  if (fieldOf(col.key)?.type === 'select' && isFieldEditable(col)) {
    openSelectMenu(item, col, e)
    return
  }
  onCellClick(item, col)
}

/** 该 cell 是否处于 select 菜单打开态（用于视觉指示 .open 类）。 */
function isSelectMenuOpen(item: T, col: TableColumnConfig): boolean {
  return selectMenu.value?.itemId === idOf(item) && selectMenu.value?.fieldKey === col.key
}

function onBoolChange(item: T, col: TableColumnConfig, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  emit('cellChange', idOf(item), col.key, checked)
}

// ── select 单元格选项菜单（BasePopover 弹层，替代原生 <select>） ──
const selectMenu = ref<{
  itemId: string
  fieldKey: string
  options: Option[]
  value: unknown
} | null>(null)
const selectMenuPos = ref<{ x: number; y: number }>({ x: 0, y: 0 })
// 锚点元素（点击的单元格），供 BasePopover 避让/翻转，避免菜单翻到顶部遮住单元格（ADR-0038）
const selectMenuAnchor = ref<HTMLElement | null>(null)

function openSelectMenu(item: T, col: TableColumnConfig, e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  selectMenuAnchor.value = el
  selectMenuPos.value = { x: r.left, y: r.bottom + 4 }
  selectMenu.value = {
    itemId: idOf(item),
    fieldKey: col.key,
    options: resolveOptions(fieldOf(col.key)),
    value: valueOf(item, col),
  }
}

function pickSelectOption(id: string) {
  if (!selectMenu.value) return
  const { itemId, fieldKey } = selectMenu.value
  emit('cellChange', itemId, fieldKey, id)
  selectMenu.value = null
}

// ── 表头菜单（BasePopover 弹层）：列对齐 / 隐藏字段 / 重置列宽 ──
// 点击表头标题唤起；仅 emit 意图，由外壳经 patchActiveTabConfig 持久化（与列宽/显隐同通道）。
const headerMenu = ref<{ col: TableColumnConfig } | null>(null)
const headerMenuPos = ref<{ x: number; y: number }>({ x: 0, y: 0 })
// 锚点元素（点击的表头），供 BasePopover 避让/翻转，避免菜单翻到顶部遮住表头（ADR-0038）
const headerMenuAnchor = ref<HTMLElement | null>(null)

function openHeaderMenu(col: TableColumnConfig, e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  headerMenuAnchor.value = el
  headerMenuPos.value = { x: r.left, y: r.bottom + 4 }
  headerMenu.value = { col }
}

/** 菜单激活态：未显式设置时按数据单元格默认左对齐。 */
function alignOf(col: TableColumnConfig): 'left' | 'center' | 'right' {
  return col.align ?? 'left'
}

function setColumnAlign(align: 'left' | 'center' | 'right') {
  if (!headerMenu.value) return
  emit('columnAlign', headerMenu.value.col.key, align)
  headerMenu.value = null
}

function hideColumn() {
  if (!headerMenu.value) return
  emit('columnVisibility', headerMenu.value.col.key, false)
  headerMenu.value = null
}

function resetColumnWidth() {
  if (!headerMenu.value) return
  emit('columnReset', headerMenu.value.col.key)
  headerMenu.value = null
}

// ── 渲染辅助 ──
function formatDate(day?: unknown): string {
  if (typeof day !== 'string' || !day) return ''
  const d = new Date(day)
  if (Number.isNaN(d.getTime())) return String(day)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dayN = String(d.getDate()).padStart(2, '0')
  return `${m}-${dayN}`
}

function isOverdue(day?: unknown): boolean {
  if (typeof day !== 'string' || !day) return false
  const d = new Date(day)
  if (Number.isNaN(d.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

function getSortDir(fieldKey: string): string | null {
  return props.sort.find((s) => s.field === fieldKey)?.dir ?? null
}

function renderSortIcon(fieldKey: string): string {
  const dir = getSortDir(fieldKey)
  if (!dir) return ''
  return dir === 'asc' ? ' ↑' : ' ↓'
}

function optionLabel(options: Option[], id: unknown): string {
  return options.find((o) => o.id === id)?.label ?? String(id ?? '')
}

/** select cell 是否为占位态（值为空 / 未匹配任何选项）。驱动模板 .empty 标记类与 label 显隐。 */
function isSelectEmpty(item: T, col: TableColumnConfig): boolean {
  const v = valueOf(item, col)
  if (v == null || v === '') return true
  return !resolveOptions(fieldOf(col.key)).some((o) => o.id === v)
}

function selectedColor(options: Option[], value: unknown): string | undefined {
  return options.find((o) => o.id === value)?.color
}

/** 分组计数显示全量组内条数（ADR-0024：计数反映查询结果而非当前页切片）。 */
function groupTotal(key: string): number {
  return sections.value.find((s) => s.key === key)?.items.length ?? 0
}
</script>

<template>
  <div class="table-view" ref="rootEl">
    <div class="table-scroll">
      <div v-if="items.length === 0" class="empty-state">
        <p>没有数据</p>
        <span class="empty-hint">尝试修改筛选条件</span>
      </div>

      <template v-else>
        <div v-for="section in pageSections" :key="section.key" class="table-section">
        <div v-if="grouped" class="group-header">
          <span class="group-label">{{ section.label || '全部' }}</span>
          <span class="group-count">{{ groupTotal(section.key) }}</span>
        </div>
        <table class="data-table" :style="tableStyle">
          <thead>
            <tr>
              <th
                v-for="(col, i) in columns"
                :key="col.key"
                :class="`col-${col.key}`"
                :style="{ width: columnWidth(col), textAlign: col.align }"
              >
                <div class="th-inner">
                  <component :is="headerIconOf(col)" v-if="headerIconOf(col)" class="col-header-icon" :size="12" />
                  <button
                    type="button"
                    class="th-label"
                    :class="{ open: headerMenu?.col.key === col.key }"
                    :title="`${fieldOf(col.key)?.label ?? col.key}：菜单`"
                    @click.stop="openHeaderMenu(col, $event)"
                  >{{ fieldOf(col.key)?.label ?? col.key }}<template v-if="getSortDir(col.key)">{{ renderSortIcon(col.key) }}</template></button>
                  <span
                    v-if="col.role !== 'link' && i < columns.length - 1"
                    class="col-resizer"
                    data-testid="col-resizer"
                    @pointerdown.stop="onResizeStart(col, $event)"
                  />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in section.items"
              :key="idOf(item)"
              class="data-row"
              :class="{ 'is-done': isDoneRow(item) }"
            >
              <td
                v-for="col in columns"
                :key="col.key"
                :class="[`col-${col.key}`, { 'cell-link': col.role === 'link' }, `align-${col.align ?? 'left'}`]"
                :style="{ width: columnWidth(col), textAlign: col.align }"
                @click="onCellMaybeOpenSelect(item, col, $event)"
              >
                <!-- 自定义单元格：命中注册表才委派，否则回退内置链（含 role 兜底） -->
                <template v-if="hasCell(col)">
                  <component
                    :is="resolveCell(col)"
                    :item="item"
                    :value="valueOf(item, col)"
                    :field="fieldOf(col.key)"
                    :col="col"
                    :editable="isFieldEditable(col)"
                    @change="(v: unknown) => onCustomChange(col, item, v)"
                  />
                </template>

                <!-- boolean：可编辑勾选；editable=false 时只读勾选态 -->
                <template v-else-if="fieldOf(col.key)?.type === 'boolean'">
                  <input
                    v-if="isFieldEditable(col)"
                    type="checkbox"
                    class="bool-check"
                    :checked="Boolean(valueOf(item, col))"
                    @click.stop
                    @change="onBoolChange(item, col, $event)"
                  />
                  <span v-else class="cell-bool-readonly">{{ Boolean(valueOf(item, col)) ? '✓' : '' }}</span>
                </template>

                <!-- select：整个 cell 为点击区域（去边框、无 padding）；ChevronDown 常驻渲染，
                  仅 hover / 菜单打开（.open）时显示（CSS 控制），靠右对齐；.empty 仅作空态标记 -->
                <template v-else-if="fieldOf(col.key)?.type === 'select'">
                  <span
                    class="cell-select"
                    :class="{
                      readonly: !isFieldEditable(col),
                      open: isSelectMenuOpen(item, col),
                      empty: isSelectEmpty(item, col),
                    }"
                    :title="optionLabel(resolveOptions(fieldOf(col.key)), valueOf(item, col))"
                  >
                    <span
                      v-if="selectedColor(resolveOptions(fieldOf(col.key)), valueOf(item, col))"
                      class="color-dot"
                      :style="{ background: selectedColor(resolveOptions(fieldOf(col.key)), valueOf(item, col)) }"
                    />
                    <span
                      v-if="!isSelectEmpty(item, col)"
                      class="cell-select-label"
                    >{{ optionLabel(resolveOptions(fieldOf(col.key)), valueOf(item, col)) }}</span>
                    <ChevronDown :size="14" class="cell-select-chevron" />
                  </span>
                </template>

                <!-- multiSelect：彩色徽章（只读） -->
                <template v-else-if="fieldOf(col.key)?.type === 'multiSelect'">
                  <span
                    v-for="v in (Array.isArray(valueOf(item, col)) ? valueOf(item, col) as unknown[] : [])"
                    :key="String(v)"
                    class="cell-badge"
                    :style="selectedColor(resolveOptions(fieldOf(col.key)), v) ? { color: selectedColor(resolveOptions(fieldOf(col.key)), v), borderColor: selectedColor(resolveOptions(fieldOf(col.key)), v) } : {}"
                  >{{ optionLabel(resolveOptions(fieldOf(col.key)), v) }}</span>
                </template>

                <!-- date：按 role overdue-date 过去标红 -->
                <template v-else-if="fieldOf(col.key)?.type === 'date'">
                  <span
                    v-if="formatDate(valueOf(item, col))"
                    class="cell-deadline"
                    :class="{ overdue: col.role === 'overdue-date' && isOverdue(valueOf(item, col)) }"
                  >{{ formatDate(valueOf(item, col)) }}</span>
                </template>

                <!-- primary 文本（link 角色渲染为导航按钮） -->
                <template v-else-if="col.role === 'link'">
                  <button class="link-btn" :title="String(valueOf(item, col) ?? '')" type="button">
                    <MapPin :size="12" />
                  </button>
                </template>
                <template v-else-if="col.role === 'primary'">
                  <span class="cell-primary" :title="String(valueOf(item, col) ?? '')">{{ valueOf(item, col) }}</span>
                </template>

                <!-- 默认：文本/数字 -->
                <template v-else>
                  <span class="cell-text">{{ valueOf(item, col) }}</span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- select 单元格选项菜单 -->
        <BasePopover
          :visible="selectMenu !== null"
          :position="selectMenuPos"
          :anchor-el="selectMenuAnchor"
          placement="bottom"
          @close="selectMenu = null"
        >
          <ul class="select-menu" data-testid="select-menu">
            <li
              v-for="opt in selectMenu?.options ?? []"
              :key="opt.id"
              class="select-option"
              :class="{ selected: opt.id === selectMenu?.value }"
              @click="pickSelectOption(opt.id)"
            >
              <span v-if="opt.color" class="color-dot" :style="{ background: opt.color }" />
              <span class="select-option-label">{{ opt.label }}</span>
            </li>
          </ul>
        </BasePopover>

        <!-- 表头菜单：列对齐 / 隐藏字段 / 重置列宽 -->
        <BasePopover
          :visible="headerMenu !== null"
          :position="headerMenuPos"
          :anchor-el="headerMenuAnchor"
          placement="bottom"
          @close="headerMenu = null"
        >
          <div class="col-menu" data-testid="col-menu">
            <div class="col-menu-label">对齐方式</div>
            <div class="col-menu-align">
              <button
                v-for="a in ['left', 'center', 'right'] as const"
                :key="a"
                type="button"
                class="col-menu-align-btn"
                :class="{ active: headerMenu && alignOf(headerMenu.col) === a }"
                @click="setColumnAlign(a)"
              >{{ a === 'left' ? '左' : a === 'center' ? '中' : '右' }}</button>
            </div>
            <button type="button" class="col-menu-item" @click="hideColumn">隐藏此字段</button>
            <button type="button" class="col-menu-item" @click="resetColumnWidth">重置列宽</button>
          </div>
        </BasePopover>
      </template>
    </div>

    <!-- 固定底部分页条（ADR-0024 D4）：置于滚动容器外，内容滚动时保持可见；仅多页时显示 -->
    <PaginationFooter
      v-if="showPagination"
      :total="flattened.length"
      :page="currentPage"
      :total-pages="totalPages"
      :page-size="pageSize"
      @update:page="onPageChange"
      @update:page-size="onPageSizeChange"
    />
  </div>
</template>

<style lang="scss" scoped>
.table-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 内容滚动区：footer 固定底部，滚动只发生在该容器内（ADR-0024 D4） */
.table-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.table-section {
  margin-bottom: 16px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--text-secondary);
  background: var(--bg-hover);
  border-radius: var(--radius-sm);
  margin-bottom: 4px;
}

.group-count {
  color: var(--text-tertiary);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-tertiary);
  gap: 4px;

  p {
    font-size: var(--text-base);
    margin: 0;
  }
}

.empty-hint {
  font-size: var(--text-sm);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: var(--text-sm);

  /* 列宽由 JS 精确计算（ADR-0013 比例模式）：content-box 会把 border-right 加在宽度之外
     导致每列 +1px、总和超出表格宽。border-box 让列宽含边框，总和恰为表格宽。 */
  th,
  td {
    box-sizing: border-box;
  }

  thead {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg-base2);

    th {
      padding: 0;
      text-align: center;
      font-weight: var(--font-medium);
      color: var(--text-tertiary);
      border-bottom: 1px solid var(--border-color, var(--app-split));
      border-right: 1px solid var(--border-color, var(--app-split));
      white-space: nowrap;
      font-size: var(--text-xs);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* 包裹层：th 是 table-cell，其 sticky/relative 对绝对定位子元素的包含块行为不可靠，
       故用普通块级 .th-inner 作 resizer 的锚点（ADR-0013 修复：手柄曾锚到 sticky thead 跑到整表最右）。 */
    .th-inner {
      position: relative;
      padding: 8px 10px;
      height: 100%;
    }

    /* 表头类型图标（lucide，12px）：跟随表头文字色（--text-tertiary），与标题基线对齐 */
    .col-header-icon {
      vertical-align: -1.5px;
      margin-right: 4px;
      opacity: 0.85;
    }

    /* 表头标题按钮：点击唤起列菜单（对齐/隐藏/重置列宽）。reset 原生 button 样式，
       文字跟随 th 的 tertiary 色，hover / 菜单打开时提亮为 primary。 */
    .th-label {
      background: none;
      border: none;
      padding: 0;
      font: inherit;
      color: inherit;
      letter-spacing: inherit;
      text-transform: inherit;
      cursor: pointer;
      border-radius: 4px;

      &:hover,
      &.open {
        color: var(--text-primary);
      }
    }

    /* 表头右缘拖拽手柄（ADR-0013）：absolute 锚定到 .th-inner，落在该列右缘 */
    th .col-resizer {
      position: absolute;
      top: 0;
      right: 0;
      width: 6px;
      height: 100%;
      cursor: col-resize;
      user-select: none;
      touch-action: none;
      z-index: 1;

      &:hover {
        background: var(--accent);
        opacity: 0.35;
      }
    }
  }

  tbody tr {
    border-bottom: 1px solid var(--border-color, var(--app-split));
    cursor: pointer;

    &.is-done {
      opacity: 0.55;

      .cell-primary {
        text-decoration: line-through;
      }
    }
  }

  td {
    padding: 8px 10px;
    vertical-align: middle;
    border-right: 1px solid var(--border-color, var(--app-split));
    transition: background 80ms ease;

    &:hover {
      background: var(--bg-hover);
    }
  }
}

.cell-text {
  color: var(--text-primary);
}

.cell-primary {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--text-primary);
  max-width: 400px;
}

.cell-link {
  text-align: center;
  width: 40px;
}

/* 末列右缘不画分割线（表格右缘即容器边界）。 */
.data-table th:last-child,
.data-table td:last-child {
  border-right: none;
}

.link-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-tertiary);
  padding: 2px;
  border-radius: 4px;

  &:hover {
    color: var(--accent);
    background: var(--bg-hover);
  }
}

.bool-check {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.cell-select {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border-radius: 4px;
  font-size: var(--text-xs);
  color: var(--text-primary);
  font-family: inherit;
  cursor: pointer;

  /* 只读态（FieldDescriptor.editable=false）：去掉指针暗示 */
  &.readonly {
    cursor: default;
    color: var(--text-secondary);
  }

  /* 菜单打开时高亮（select 字段点击 cell 后） */
  &.open {
    color: var(--accent);
  }
}

/* 下拉箭头：靠右（margin-left:auto）；默认隐藏（未交互不显示），
   仅 cell hover 或菜单打开（.open，即「选中」）时显示，有值/无值一致。
   只读态永远隐藏（不可交互，避免误导）。 */
.cell-select-chevron {
  margin-left: auto;
  color: var(--text-tertiary);
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 80ms ease;

  .cell-select:hover &,
  .cell-select.open & {
    opacity: 1;
  }

  .cell-select.readonly & {
    opacity: 0;
  }
}

/* select 单元格对齐（ADR 修复）：td 的 text-align 对 flex 容器无效，
   须由列对齐类驱动 .cell-select 的 justify-content。左对齐沿用默认（label 左上、chevron 靠右），
   居中/右对齐时整体居中/右靠，并取消 chevron 的 margin-left:auto 以免其脱离分组被推到最右。 */
.data-table td.align-center .cell-select {
  justify-content: center;
}

.data-table td.align-right .cell-select {
  justify-content: flex-end;
}

.data-table td.align-center .cell-select .cell-select-chevron,
.data-table td.align-right .cell-select .cell-select-chevron {
  margin-left: 4px;
}

/* boolean 只读态：勾选符号占位 */
.cell-bool-readonly {
  display: inline-block;
  min-width: 14px;
  font-size: var(--text-xs);
  color: var(--accent);
  text-align: center;
}

.color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.cell-select-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-menu {
  list-style: none;
  margin: 0;
  padding: 4px;
  min-width: 140px;
  max-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.select-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--text-primary);
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    background: var(--bg-hover);
  }

  &.selected {
    font-weight: var(--font-semibold);
  }
}

.select-option-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 表头列菜单（对齐/隐藏/重置列宽） */
.col-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  min-width: 150px;
}

.col-menu-label {
  padding: 6px 8px 2px;
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--text-secondary);
}

/* 对齐三选一：分段按钮组 */
.col-menu-align {
  display: flex;
  gap: 2px;
  padding: 0 8px 6px;
  border-bottom: 1px solid var(--border-color, var(--app-split));
  margin-bottom: 4px;
}

.col-menu-align-btn {
  flex: 1;
  padding: 4px 0;
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;

  &:hover {
    border-color: var(--accent);
  }

  &.active {
    border-color: var(--accent);
    background: var(--accent-bg);
    color: var(--text-primary);
  }
}

.col-menu-item {
  text-align: left;
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    background: var(--bg-hover);
  }
}

.cell-badge {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid;
  font-size: 11px;
  font-weight: var(--font-semibold);
  margin-right: 4px;
}

.cell-deadline {
  font-size: var(--text-xs);
  white-space: nowrap;

  &.overdue {
    color: var(--error, #DC2626);
    font-weight: var(--font-semibold);
  }

  &:not(.overdue) {
    color: var(--warning, #D97706);
  }
}
</style>
