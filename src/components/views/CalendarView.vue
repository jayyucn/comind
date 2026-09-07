<script setup lang="ts" generic="T">
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight, Circle } from 'lucide-vue-next'
import type { FieldDescriptor } from '../../core/query'
import type { CalendarConfig } from '../../core/view'

const props = defineProps<{
  /** 已过滤的扁平列表。实体无关。 */
  items: T[]
  /** 实体字段描述符（驱动按哪个 date 字段入桶）。 */
  fields: FieldDescriptor[]
  /** 日历布局配置：dateRefKind 决定按 deadline 还是 schedule 字段落格。 */
  config: CalendarConfig
  /** 取记录 id 的字段名（默认 'id'）。BlockCard 用 'block_id'。 */
  idKey?: string
}>()

const emit = defineEmits<{
  navigate: [itemId: string]
}>()

function idOf(item: T): string {
  return String((item as Record<string, unknown>)[props.idKey ?? 'id'])
}

/** 入桶日期字段：由 config.dateRefKind 选定（deadline / schedule 均为 Block 内置 date 字段）。 */
const dateField = computed<FieldDescriptor | undefined>(
  () => props.fields.find((f) => f.key === props.config.dateRefKind),
)
/** 卡片标题字段：content（或首个 text 字段）。 */
const titleField = computed<FieldDescriptor | undefined>(
  () => props.fields.find((f) => f.key === 'content') ?? props.fields.find((f) => f.type === 'text'),
)

const currentMonth = ref(new Date().getMonth())
const currentYear = ref(new Date().getFullYear())
const MAX_VISIBLE = 3

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

const monthLabel = computed(() => `${currentYear.value}年${currentMonth.value + 1}月`)

const today = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

/** 按选定 date 字段的 date_day 入桶（字段取值即 date_day 字符串）。 */
const cardsByDate = computed<Map<string, T[]>>(() => {
  const map = new Map<string, T[]>()
  const field = dateField.value
  if (!field) return map
  for (const item of props.items) {
    const day = field.get(item)
    if (typeof day !== 'string' || !day) continue
    const bucket = map.get(day) ?? []
    bucket.push(item)
    map.set(day, bucket)
  }
  return map
})

const calendarRows = computed(() => {
  const firstDay = new Date(currentYear.value, currentMonth.value, 1)
  const lastDay = new Date(currentYear.value, currentMonth.value + 1, 0)

  let firstDow = firstDay.getDay() - 1
  if (firstDow < 0) firstDow = 6

  const numDays = lastDay.getDate()
  const rows: { date: string; day: number; isCurrentMonth: boolean; isToday: boolean }[][] = []
  let currentRow: { date: string; day: number; isCurrentMonth: boolean; isToday: boolean }[] = []

  const prevLastDay = new Date(currentYear.value, currentMonth.value, 0)
  for (let i = 0; i < firstDow; i++) {
    const d = prevLastDay.getDate() - firstDow + i + 1
    const m = currentMonth.value === 0 ? 12 : currentMonth.value
    const y = currentMonth.value === 0 ? currentYear.value - 1 : currentYear.value
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    currentRow.push({ date: dateStr, day: d, isCurrentMonth: false, isToday: dateStr === today.value })
  }

  for (let day = 1; day <= numDays; day++) {
    const dateStr = `${currentYear.value}-${String(currentMonth.value + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    currentRow.push({ date: dateStr, day, isCurrentMonth: true, isToday: dateStr === today.value })
    if (currentRow.length === 7) {
      rows.push(currentRow)
      currentRow = []
    }
  }

  if (currentRow.length > 0) {
    for (let i = 1; currentRow.length < 7; i++) {
      const d = new Date(currentYear.value, currentMonth.value + 1, i)
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      currentRow.push({ date: dateStr, day: i, isCurrentMonth: false, isToday: dateStr === today.value })
    }
    rows.push(currentRow)
  }

  return rows
})

function prevMonth() {
  if (currentMonth.value === 0) {
    currentMonth.value = 11
    currentYear.value--
  } else {
    currentMonth.value--
  }
}

function nextMonth() {
  if (currentMonth.value === 11) {
    currentMonth.value = 0
    currentYear.value++
  } else {
    currentMonth.value++
  }
}

function goToday() {
  const todayDate = new Date()
  currentMonth.value = todayDate.getMonth()
  currentYear.value = todayDate.getFullYear()
}

/** 事件颜色类：deadline 过去标 overdue、未来标 deadline；schedule 统一 schedule。 */
function refColorClass(dateStr: string): string {
  if (props.config.dateRefKind === 'schedule') return 'schedule'
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return d < t ? 'overdue' : 'deadline'
}
</script>

<template>
  <div class="calendar-view">
    <div class="calendar-header">
      <div class="cal-nav">
        <button class="cal-nav-btn" @click="prevMonth" title="上个月">
          <ChevronLeft :size="16" />
        </button>
        <span class="cal-month-label">{{ monthLabel }}</span>
        <button class="cal-nav-btn" @click="nextMonth" title="下个月">
          <ChevronRight :size="16" />
        </button>
      </div>
      <button class="cal-today-btn" @click="goToday">今天</button>
    </div>

    <div class="calendar-grid">
      <div v-for="wd in WEEKDAYS" :key="'h-' + wd" class="cal-weekday">{{ wd }}</div>

      <template v-for="row in calendarRows" :key="'r-' + row[0].date">
        <div
          v-for="cell in row"
          :key="cell.date"
          class="cal-cell"
          :class="{ 'is-today': cell.isToday, 'is-other-month': !cell.isCurrentMonth }"
        >
          <span class="cal-day-num">{{ cell.day }}</span>
          <div class="cal-events">
            <template v-if="cardsByDate.has(cell.date)">
              <template
                v-for="item in (cardsByDate.get(cell.date) ?? []).slice(0, MAX_VISIBLE)"
                :key="idOf(item)"
              >
                <div
                  class="cal-event"
                  :class="refColorClass(cell.date)"
                  :title="titleField ? String(titleField.get(item) ?? '') : idOf(item)"
                  @click="emit('navigate', idOf(item))"
                >
                  <Circle
                    v-if="refColorClass(cell.date) === 'overdue'"
                    :size="6"
                    fill="currentColor"
                    class="dot"
                  />
                  <span class="event-text">{{
                    titleField ? String(titleField.get(item) ?? '') : idOf(item)
                  }}</span>
                </div>
              </template>
              <div
                v-if="(cardsByDate.get(cell.date)?.length ?? 0) > MAX_VISIBLE"
                class="cal-event more-events"
              >
                +{{ (cardsByDate.get(cell.date)?.length ?? 0) - MAX_VISIBLE }} 项
              </div>
            </template>
          </div>
        </div>
      </template>
    </div>

    <div v-if="items.length === 0" class="calendar-empty">
      <p>没有带日期的记录</p>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.calendar-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  padding: 12px;
}

.calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.cal-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cal-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
}

.cal-month-label {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  min-width: 120px;
  text-align: center;
}

.cal-today-btn {
  padding: 4px 12px;
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--text-xs);

  &:hover {
    background: var(--bg-hover);
  }
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  flex: 1;
  border-top: 1px solid var(--border-color, var(--app-split));
  border-left: 1px solid var(--border-color, var(--app-split));
}

.cal-weekday {
  padding: 6px;
  text-align: center;
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--text-tertiary);
  border-right: 1px solid var(--border-color, var(--app-split));
  border-bottom: 1px solid var(--border-color, var(--app-split));
  background: var(--bg-base2);
}

.cal-cell {
  min-height: 90px;
  padding: 4px;
  border-right: 1px solid var(--border-color, var(--app-split));
  border-bottom: 1px solid var(--border-color, var(--app-split));
  overflow: hidden;

  &.is-other-month {
    opacity: 0.3;
  }

  &.is-today {
    background: var(--accent-bg, rgba(99, 102, 241, 0.04));
  }
}

.cal-day-num {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  margin-bottom: 2px;

  .is-today & {
    color: var(--accent);
    font-weight: var(--font-semibold);
  }
}

.cal-events {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.cal-event {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 1px 4px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  line-height: 1.3;

  &.overdue {
    background: rgba(220, 38, 38, 0.1);
    color: var(--error, #DC2626);
    font-weight: var(--font-semibold);
  }

  &.deadline {
    background: rgba(217, 119, 6, 0.1);
    color: var(--warning, #D97706);
  }

  &.schedule {
    background: rgba(99, 102, 241, 0.1);
    color: var(--accent, #6366F1);
  }

  &:hover {
    filter: brightness(0.95);
  }
}

.dot {
  flex-shrink: 0;
}

.event-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.more-events {
  color: var(--text-tertiary);
  background: transparent;
  cursor: default;
  font-size: 10px;
}

.calendar-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  pointer-events: none;
}
</style>
