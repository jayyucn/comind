<script setup lang="ts" generic="T">
import { MapPin } from 'lucide-vue-next';
import { computed } from 'vue';
import type { FieldDescriptor, Group, Option, SortRule } from '../../core/query';
import type { TableColumnConfig, TableConfig } from '../../core/view';

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
}>()

const emit = defineEmits<{
  /** 单元格编辑（boolean/select 可编辑列触发）。 */
  cellChange: [itemId: string, fieldKey: string, value: unknown]
  /** 点击行或链接列导航到源记录。 */
  navigate: [itemId: string]
}>()

/** 渲染分区：分组时取分组桶；平铺时合成单一全量分区。 */
const sections = computed<Group<T>[]>(
  () => props.grouped ? props.groups : [{ key: '', label: '', items: props.items }],
)

/**
 * 列序：config 优先；否则安全兜底为仅主文本列（content）。
 * 不回退到全部注册字段——否则忘记传 config 的通用消费方会渲染一张含内部字段（dateRefKind 等）的不可用例表。
 * TaskHub 永远传 DEFAULT_TABLE_CONFIG，故块实体仍见 7 列（ADR-0007 D8 修复）。
 */
const columns = computed<TableColumnConfig[]>(
  () => props.config?.columns ?? [{ key: 'content' }],
)

function idOf(item: T): string {
  return String((item as Record<string, unknown>)[props.idKey ?? 'id'])
}

function fieldOf(key: string): FieldDescriptor | undefined {
  return props.fields.find((f) => f.key === key)
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

function onCellClick(col: TableColumnConfig, e: MouseEvent) {
  // 可编辑/链接列点按不触发整行导航
  if (col.role === 'link' || col.role === 'done' || fieldOf(col.key)?.type === 'boolean' || fieldOf(col.key)?.type === 'select') {
    e.stopPropagation()
  }
}

function onBoolChange(item: T, col: TableColumnConfig, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  emit('cellChange', idOf(item), col.key, checked)
}

function onSelectChange(item: T, col: TableColumnConfig, e: Event) {
  const value = (e.target as HTMLSelectElement).value
  emit('cellChange', idOf(item), col.key, value)
}

function onRowClick(item: T) {
  emit('navigate', idOf(item))
}

function onLinkClick(item: T, e: MouseEvent) {
  e.stopPropagation()
  emit('navigate', idOf(item))
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
</script>

<template>
  <div class="table-view">
    <div v-if="items.length === 0" class="empty-state">
      <p>没有数据</p>
      <span class="empty-hint">尝试修改筛选条件</span>
    </div>

    <template v-else>
      <div v-for="section in sections" :key="section.key" class="table-section">
        <div v-if="grouped" class="group-header">
          <span class="group-label">{{ section.label || '全部' }}</span>
          <span class="group-count">{{ section.items.length }}</span>
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
              @click="onRowClick(item)"
            >
              <td
                v-for="col in columns"
                :key="col.key"
                :class="[`col-${col.key}`, { 'cell-link': col.role === 'link' }]"
                :style="{ width: columnWidth(col) }"
                @click="onCellClick(col, $event)"
              >
                <!-- boolean：可编辑勾选 -->
                <template v-if="fieldOf(col.key)?.type === 'boolean'">
                  <input
                    type="checkbox"
                    class="bool-check"
                    :checked="Boolean(valueOf(item, col))"
                    @change="onBoolChange(item, col, $event)"
                  />
                </template>

                <!-- select：带色下拉（可编辑） -->
                <template v-else-if="fieldOf(col.key)?.type === 'select'">
                  <span class="cell-select">
                    <span
                      v-if="selectedColor(resolveOptions(fieldOf(col.key)), valueOf(item, col))"
                      class="color-dot"
                      :style="{ background: selectedColor(resolveOptions(fieldOf(col.key)), valueOf(item, col)) }"
                    />
                    <select
                      class="select-input"
                      :value="valueOf(item, col) as string"
                      @change="onSelectChange(item, col, $event)"
                    >
                      <option v-for="opt in resolveOptions(fieldOf(col.key))" :key="opt.id" :value="opt.id">
                        {{ opt.label }}
                      </option>
                    </select>
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
                  <button class="link-btn" :title="String(valueOf(item, col) ?? '')" @click="onLinkClick(item, $event)">
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
    </template>
  </div>
</template>

<style lang="scss" scoped>
.table-view {
  height: 100%;
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
}

.color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.select-input {
  padding: 2px 6px;
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: 4px;
  font-size: var(--text-xs);
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
  cursor: pointer;

  &:focus {
    border-color: var(--accent);
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
