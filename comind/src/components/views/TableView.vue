<script setup lang="ts" generic="T">
import { MapPin } from 'lucide-vue-next';
import { computed, ref, watch } from 'vue';
import type { Component } from 'vue';
import type { CellRegistry } from './types';
import BasePopover from '../common/BasePopover.vue';
import PaginationFooter from './PaginationFooter.vue';
import type { FieldDescriptor, Group, Option, SortRule } from '../../core/query';
import type { TableColumnConfig, TableConfig } from '../../core/view';

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

function columnWidth(col: TableColumnConfig): string | undefined {
  return col.width != null ? `${col.width}px` : undefined
}

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

function openSelectMenu(item: T, col: TableColumnConfig, e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
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

function selectedColor(options: Option[], value: unknown): string | undefined {
  return options.find((o) => o.id === value)?.color
}

/** 分组计数显示全量组内条数（ADR-0024：计数反映查询结果而非当前页切片）。 */
function groupTotal(key: string): number {
  return sections.value.find((s) => s.key === key)?.items.length ?? 0
}
</script>

<template>
  <div class="table-view">
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
        <table class="data-table">
          <thead>
            <tr>
              <th
                v-for="col in columns"
                :key="col.key"
                :class="`col-${col.key}`"
                :style="{ width: columnWidth(col) }"
              >
                {{ fieldOf(col.key)?.label ?? col.key }}<template v-if="getSortDir(col.key)">{{ renderSortIcon(col.key) }}</template>
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
                :class="[`col-${col.key}`, { 'cell-link': col.role === 'link' }]"
                :style="{ width: columnWidth(col) }"
                @click="onCellClick(item, col)"
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

                <!-- select：可编辑时弹下拉（BasePopover 菜单）；editable=false 时只读标签 -->
                <template v-else-if="fieldOf(col.key)?.type === 'select'">
                  <button
                    v-if="isFieldEditable(col)"
                    type="button"
                    class="cell-select"
                    :class="{ open: selectMenu?.itemId === idOf(item) && selectMenu?.fieldKey === col.key }"
                    :title="optionLabel(resolveOptions(fieldOf(col.key)), valueOf(item, col))"
                    @click.stop="openSelectMenu(item, col, $event)"
                  >
                    <span
                      v-if="selectedColor(resolveOptions(fieldOf(col.key)), valueOf(item, col))"
                      class="color-dot"
                      :style="{ background: selectedColor(resolveOptions(fieldOf(col.key)), valueOf(item, col)) }"
                    />
                    <span class="cell-select-label">{{ optionLabel(resolveOptions(fieldOf(col.key)), valueOf(item, col)) }}</span>
                  </button>
                  <span
                    v-else
                    class="cell-select-readonly"
                    :title="optionLabel(resolveOptions(fieldOf(col.key)), valueOf(item, col))"
                  >
                    <span
                      v-if="selectedColor(resolveOptions(fieldOf(col.key)), valueOf(item, col))"
                      class="color-dot"
                      :style="{ background: selectedColor(resolveOptions(fieldOf(col.key)), valueOf(item, col)) }"
                    />
                    <span class="cell-select-label">{{ optionLabel(resolveOptions(fieldOf(col.key)), valueOf(item, col)) }}</span>
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
                  >⏰ {{ formatDate(valueOf(item, col)) }}</span>
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
        <BasePopover :visible="selectMenu !== null" :position="selectMenuPos" @close="selectMenu = null">
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
  font-size: var(--text-sm);

  thead {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg-base);

    th {
      padding: 8px 10px;
      text-align: left;
      font-weight: var(--font-medium);
      color: var(--text-tertiary);
      border-bottom: 1px solid var(--border-color, var(--app-split));
      white-space: nowrap;
      font-size: var(--text-xs);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  }

  tbody tr {
    border-bottom: 1px solid var(--border-color, var(--app-split));
    cursor: pointer;
    transition: background 80ms ease;

    &:hover {
      background: var(--bg-hover);
    }

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
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 160px;
  padding: 2px 6px;
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: 4px;
  font-size: var(--text-xs);
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: inherit;
  cursor: pointer;

  &:hover {
    border-color: var(--accent);
  }

  &.open {
    border-color: var(--accent);
  }
}

/* select 只读态（FieldDescriptor.editable=false）：同布局但不带边框/指针 */
.cell-select-readonly {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 160px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: var(--text-xs);
  color: var(--text-primary);
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
