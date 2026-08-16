<script setup lang="ts">
import { ref, computed } from 'vue'
import { ChevronLeft, ChevronRight, Circle } from 'lucide-vue-next'
import type { BlockCard, DateRefLite } from '../../../wasm/types'

const props = defineProps<{
  cards: BlockCard[]
}>()

const emit = defineEmits<{
  navigateToBlock: [blockId: string]
}>()

const currentMonth = ref(new Date().getMonth())
const currentYear = ref(new Date().getFullYear())
const MAX_VISIBLE = 3

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

const monthLabel = computed(() => {
  return `${currentYear.value}年${currentMonth.value + 1}月`
})

const today = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

const cardsByDate = computed<Map<string, Array<{ card: BlockCard; ref: DateRefLite }>>>(() => {
  const map = new Map<string, Array<{ card: BlockCard; ref: DateRefLite }>>()
  for (const card of props.cards) {
    for (const dr of card.date_refs) {
      if (!dr.date_day) continue
      const bucket = map.get(dr.date_day) ?? []
      bucket.push({ card, ref: dr })
      map.set(dr.date_day, bucket)
    }
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

  // Previous month trailing days
  const prevLastDay = new Date(currentYear.value, currentMonth.value, 0)
  for (let i = 0; i < firstDow; i++) {
    const d = prevLastDay.getDate() - firstDow + i + 1
    const m = currentMonth.value === 0 ? 12 : currentMonth.value
    const y = currentMonth.value === 0 ? currentYear.value - 1 : currentYear.value
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    currentRow.push({ date: dateStr, day: d, isCurrentMonth: false, isToday: dateStr === today.value })
  }

  // Current month days
  for (let day = 1; day <= numDays; day++) {
    const dateStr = `${currentYear.value}-${String(currentMonth.value + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    currentRow.push({ date: dateStr, day, isCurrentMonth: true, isToday: dateStr === today.value })
    if (currentRow.length === 7) {
      rows.push(currentRow)
      currentRow = []
    }
  }

  // Next month leading days
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

function getRefColor(ref: DateRefLite, dateStr: string): string {
  const todayDate = new Date()
  todayDate.setHours(0, 0, 0, 0)
  const refDate = new Date(dateStr)
  refDate.setHours(0, 0, 0, 0)
  if (ref.kind === 'deadline' && refDate < todayDate) return 'overdue'
  if (ref.kind === 'deadline') return 'deadline'
  if (ref.kind === 'schedule') return 'schedule'
  return 'default'
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
      <div
        v-for="wd in WEEKDAYS"
        :key="'h-' + wd"
        class="cal-weekday"
      >
        {{ wd }}
      </div>

      <template v-for="row in calendarRows" :key="'r-' + row[0].date">
        <div
          v-for="cell in row"
          :key="cell.date"
          class="cal-cell"
          :class="{
            'is-today': cell.isToday,
            'is-other-month': !cell.isCurrentMonth,
          }"
        >
          <span class="cal-day-num">{{ cell.day }}</span>
          <div class="cal-events">
            <template v-if="cardsByDate.has(cell.date)">
              <template v-for="(item, idx) in (cardsByDate.get(cell.date) ?? []).slice(0, MAX_VISIBLE)" :key="idx">
                <div
                  class="cal-event"
                  :class="getRefColor(item.ref, cell.date)"
                  :title="item.card.content_preview"
                  @click="emit('navigateToBlock', item.card.block_id)"
                >
                  <Circle
                    v-if="getRefColor(item.ref, cell.date) === 'overdue'"
                    :size="6"
                    fill="currentColor"
                    class="dot"
                  />
                  <span class="event-text">{{ item.card.content_preview }}</span>
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

    <div v-if="cards.length === 0" class="calendar-empty">
      <p>没有带日期的任务</p>
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
