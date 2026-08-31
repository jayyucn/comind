<script setup lang="ts" generic="T">
import { computed, ref } from 'vue'
import { GripVertical } from 'lucide-vue-next'
import type { FieldDescriptor, Option } from '../../core/query'
import type { BoardConfig } from '../../core/view'

const props = defineProps<{
  /** 已过滤+排序的扁平列表。实体无关。 */
  items: T[]
  /** 实体字段描述符（驱动列/卡片按类型渲染）。 */
  fields: FieldDescriptor[]
  /** 分组字段 key（通常来自 ViewQuery.groupBy，如 'status'）。列由该字段 options 派生。 */
  groupBy: string
  /** 看板布局配置：cardFields 列出卡片额外徽章字段。 */
  config?: BoardConfig
  /** 取记录 id 的字段名（默认 'id'）。BlockCard 用 'block_id'。 */
  idKey?: string
}>()

const emit = defineEmits<{
  /** 拖拽改分组：把记录的分组字段值改为目标列值。 */
  cellChange: [itemId: string, fieldKey: string, value: unknown]
  /** 点击卡片导航到源记录。 */
  navigate: [itemId: string]
}>()

function idOf(item: T): string {
  return String((item as Record<string, unknown>)[props.idKey ?? 'id'])
}

function fieldOf(key: string): FieldDescriptor | undefined {
  return props.fields.find((f) => f.key === key)
}

function resolveOptions(field: FieldDescriptor | undefined): Option[] {
  if (!field?.options) return []
  return typeof field.options === 'function' ? field.options() : field.options
}

/** 分组列：优先取分组字段的 options（select 语义）；否则由记录实际取值派生唯一列。 */
const columns = computed<{ key: string; label: string; color?: string }[]>(() => {
  const groupField = fieldOf(props.groupBy)
  if (groupField) {
    const opts = resolveOptions(groupField)
    if (opts.length > 0) return opts.map((o) => ({ key: o.id, label: o.label, color: o.color }))
    const seen = new Map<string, string>()
    for (const item of props.items) {
      const v = groupField.get(item)
      const arr = Array.isArray(v) ? v : [v]
      for (const val of arr) {
        if (val != null && !seen.has(String(val))) seen.set(String(val), String(val))
      }
    }
    return [...seen.entries()].map(([key, label]) => ({ key, label }))
  }
  // 分组字段未注册：退化为单一「全部」列
  return [{ key: '__all__', label: '全部' }]
})

function matchGroup(value: unknown, colKey: string): boolean {
  return Array.isArray(value) ? value.map(String).includes(colKey) : String(value) === colKey
}

function cardsIn(colKey: string): T[] {
  const groupField = fieldOf(props.groupBy)
  if (!groupField || colKey === '__all__') return props.items
  return props.items.filter((i) => matchGroup(groupField.get(i), colKey))
}

/** 卡片标题：content 字段（或首个 text 字段）的取值。 */
const titleField = computed<FieldDescriptor | undefined>(
  () => fieldOf('content') ?? props.fields.find((f) => f.type === 'text'),
)

/** 卡片额外徽章字段（config.cardFields，缺省空 —— 块实体的默认集由调用方 boardConfig 注入）。 */
const metaFields = computed<FieldDescriptor[]>(
  () => (props.config?.cardFields ?? []).map((k) => fieldOf(k)).filter((f): f is FieldDescriptor => !!f),
)

function isOverdue(day?: unknown): boolean {
  if (typeof day !== 'string' || !day) return false
  const d = new Date(day)
  if (Number.isNaN(d.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

function formatDate(day?: unknown): string {
  if (typeof day !== 'string' || !day) return ''
  const d = new Date(day)
  if (Number.isNaN(d.getTime())) return String(day)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dayN = String(d.getDate()).padStart(2, '0')
  return `${m}-${dayN}`
}

/** 单条徽章元数据：按字段类型通用绘制（select 带色圆点 / date 逾期标红 / 默认文本）。 */
function metaChips(item: T): { text: string; color?: string; overdue?: boolean }[] {
  const out: { text: string; color?: string; overdue?: boolean }[] = []
  for (const f of metaFields.value) {
    const raw = f.get(item)
    if (raw == null || raw === '') continue
    if (f.type === 'select' || f.type === 'multiSelect') {
      const vals = Array.isArray(raw) ? raw : [raw]
      for (const v of vals) {
        const opt = resolveOptions(f).find((o) => o.id === v)
        if (opt) out.push({ text: opt.label, color: opt.color })
      }
    } else if (f.type === 'date') {
      const txt = formatDate(raw)
      if (txt) out.push({ text: `⏰ ${txt}`, overdue: isOverdue(raw) })
    } else {
      out.push({ text: String(raw) })
    }
  }
  return out
}

// ── 拖拽 ──
const draggedCardId = ref<string | null>(null)
// 当前拖拽悬停的列（高亮放置目标，弥补原生 HTML5 DnD 无列级反馈的缺失）
const dragOverCol = ref<string | null>(null)

function onDragStart(blockId: string, event: DragEvent) {
  draggedCardId.value = blockId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', blockId)
  }
}

function onDragOver(colKey: string, event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dragOverCol.value = colKey
}

function onColumnLeave(colKey: string, event: DragEvent) {
  // 仅当指针真正移出本列（而非进入子卡片）才清除，避免子元素间移动造成高亮闪烁
  const related = event.relatedTarget as Node | null
  const current = event.currentTarget as HTMLElement | null
  if (current && (!related || !current.contains(related)) && dragOverCol.value === colKey) {
    dragOverCol.value = null
  }
}

function onDrop(colKey: string, event: DragEvent) {
  event.preventDefault()
  const blockId = event.dataTransfer?.getData('text/plain')
  if (blockId && colKey !== '__all__') emit('cellChange', blockId, props.groupBy, colKey)
  draggedCardId.value = null
  dragOverCol.value = null
}

function onDragEnd() {
  draggedCardId.value = null
  dragOverCol.value = null
}
</script>

<template>
  <div class="board-view">
    <div
      v-for="col in columns"
      :key="col.key"
      class="board-column"
      :class="{ 'drag-over': dragOverCol === col.key }"
      @dragover="onDragOver(col.key, $event)"
      @dragleave="onColumnLeave(col.key, $event)"
      @drop="onDrop(col.key, $event)"
    >
      <div class="column-header">
        <span class="column-title" :style="col.color ? { color: col.color } : undefined">{{ col.label }}</span>
        <span class="column-count">{{ cardsIn(col.key).length }}</span>
      </div>

      <div class="column-cards">
        <div v-if="cardsIn(col.key).length === 0" class="column-empty">暂无卡片</div>

        <div
          v-for="card in cardsIn(col.key)"
          :key="idOf(card)"
          class="board-card"
          :class="{ dragging: draggedCardId === idOf(card) }"
          draggable="true"
          @dragstart="onDragStart(idOf(card), $event)"
          @dragend="onDragEnd"
          @click="emit('navigate', idOf(card))"
        >
          <div class="card-grip"><GripVertical :size="12" /></div>
          <div class="card-body">
            <p class="card-content">{{ titleField ? titleField.get(card) : idOf(card) }}</p>
            <div v-if="metaChips(card).length" class="card-meta">
              <span
                v-for="(chip, i) in metaChips(card)"
                :key="i"
                class="card-chip"
                :class="{ overdue: chip.overdue }"
                :style="chip.color ? { color: chip.color, borderColor: chip.color } : undefined"
              >{{ chip.text }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.board-view {
  display: flex;
  gap: 0;
  height: 100%;
  overflow-x: auto;
  padding: 12px;
}

.board-column {
  flex: 1;
  min-width: 220px;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-color, var(--app-split));

  &:last-child {
    border-right: none;
  }

  // 拖拽悬停的放置目标高亮（列级反馈，原生 DnD 默认无）
  &.drag-over {
    background: var(--accent-bg, rgba(99, 102, 241, 0.06));
    border-radius: 8px;
    box-shadow: inset 0 0 0 2px var(--accent);
  }
}

.column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 2px solid var(--border-color, var(--app-split));
}

.column-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}

.column-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  background: var(--bg-base2);
  padding: 1px 6px;
  border-radius: 10px;
}

.column-cards {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.column-empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.board-card {
  display: flex;
  gap: 6px;
  padding: 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: 8px;
  cursor: grab;
  transition: box-shadow 100ms ease, border-color 100ms ease, opacity 100ms ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    border-color: var(--accent);
  }

  &.dragging {
    opacity: 0.4;
  }
}

.card-grip {
  display: flex;
  align-items: flex-start;
  padding-top: 3px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.card-body {
  flex: 1;
  min-width: 0;
}

.card-content {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.card-chip {
  font-size: 11px;
  font-weight: var(--font-semibold);
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--border-color, var(--app-split));
  color: var(--text-secondary);

  &.overdue {
    color: var(--error, #DC2626);
    border-color: var(--error, #DC2626);
  }
}
</style>
