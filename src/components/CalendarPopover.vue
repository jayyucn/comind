<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import BasePopover from './common/BasePopover.vue'

const props = withDefaults(defineProps<{
  visible: boolean
  position?: { x: number; y: number }
  selectedDate: string // 'YYYY-MM-DD' | ''
  inline?: boolean
  /** 区间模式：起点（含），用于高亮整段。仅起止都存在时生效。 */
  rangeStart?: string
  /** 区间模式：终点（含），用于高亮整段。 */
  rangeEnd?: string
}>(), {
  inline: false,
  rangeStart: '',
  rangeEnd: '',
})

const emit = defineEmits<{
  select: [date: string]
  close: []
}>()

const calendarYear = ref(new Date().getFullYear())
const calendarMonth = ref(new Date().getMonth())

const today = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

const weekDays = ['一', '二', '三', '四', '五', '六', '日']

const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

const currentYear = computed(() => new Date().getFullYear())

const yearOptions = computed(() => {
  const y = currentYear.value
  return Array.from({ length: 21 }, (_, i) => y - 10 + i)
})

// 区间高亮辅助：起点/终点（含）与中间段
const rStart = computed(() => props.rangeStart)
const rEnd = computed(() => props.rangeEnd)
function rangeFlags(iso: string) {
  return {
    isRangeStart: !!rStart.value && iso === rStart.value,
    isRangeEnd: !!rEnd.value && iso === rEnd.value,
    inRange: !!rStart.value && !!rEnd.value && iso > rStart.value && iso < rEnd.value,
  }
}

const calendarDays = computed(() => {
  const year = calendarYear.value
  const month = calendarMonth.value
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const days: { date: number; currentMonth: boolean; today: boolean; selected: boolean; iso: string; isRangeStart: boolean; isRangeEnd: boolean; inRange: boolean }[] = []

  const startPadding = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1
  const prevMonthLastDay = new Date(year, month, 0).getDate()
  for (let i = startPadding - 1; i >= 0; i--) {
    const dayNum = prevMonthLastDay - i
    const prevMonth = month === 0 ? 11 : month - 1
    const prevYear = month === 0 ? year - 1 : year
    const iso = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
    days.push({ date: dayNum, currentMonth: false, today: iso === today.value, selected: iso === props.selectedDate, iso, ...rangeFlags(iso) })
  }

  for (let i = 1; i <= lastDay.getDate(); i++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`
    days.push({ date: i, currentMonth: true, today: iso === today.value, selected: iso === props.selectedDate, iso, ...rangeFlags(iso) })
  }

  const remaining = 42 - days.length
  for (let i = 1; i <= remaining; i++) {
    const nextMonth = month === 11 ? 0 : month + 1
    const nextYear = month === 11 ? year + 1 : year
    const iso = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`
    days.push({ date: i, currentMonth: false, today: iso === today.value, selected: iso === props.selectedDate, iso, ...rangeFlags(iso) })
  }

  return days
})

function prevMonth() {
  if (calendarMonth.value === 0) {
    calendarMonth.value = 11
    calendarYear.value--
  } else {
    calendarMonth.value--
  }
}

function nextMonth() {
  if (calendarMonth.value === 11) {
    calendarMonth.value = 0
    calendarYear.value++
  } else {
    calendarMonth.value++
  }
}

function selectDay(day: { iso: string; currentMonth: boolean }) {
  // Q9: 点击非当前月日期 → 切换月份并选中
  if (!day.currentMonth) {
    // 从 iso 解析目标年月
    const [y, m] = day.iso.split('-').map(Number)
    calendarYear.value = y
    calendarMonth.value = m - 1
  }
  emit('select', day.iso)
}

function handleOverlayClick() {
  if (!props.inline) emit('close')
}

// visible 变 true 时从 selectedDate 恢复月份
watch(
  () => props.visible,
  (v) => {
    if (v && props.selectedDate) {
      const [y, m] = props.selectedDate.split('-').map(Number)
      if (y && m) {
        calendarYear.value = y
        calendarMonth.value = m - 1
      }
    }
  }
)

// inline 模式下，selectedDate 变化时也同步月份
watch(
  () => props.selectedDate,
  (d) => {
    if (props.inline && d) {
      const [y, m] = d.split('-').map(Number)
      if (y && m) {
        calendarYear.value = y
        calendarMonth.value = m - 1
      }
    }
  }
)
</script>

<template>
  <!-- inline 模式：直接渲染日历网格 -->
  <div v-if="inline" class="cal-popover cal-popover--inline">
    <div class="cal-header">
      <select v-model="calendarYear" class="cal-year-select">
        <option v-for="y in yearOptions" :key="y" :value="y">{{ y }}年</option>
      </select>
      <span class="cal-month-label">{{ monthNames[calendarMonth] }}</span>
      <div class="cal-nav-group">
        <button class="cal-nav" @click="prevMonth">
          <ChevronLeft :size="14" :stroke-width="2" />
        </button>
        <button class="cal-nav" @click="nextMonth">
          <ChevronRight :size="14" :stroke-width="2" />
        </button>
      </div>
    </div>

    <div class="cal-weekdays">
      <span v-for="day in weekDays" :key="day" class="cal-weekday">{{ day }}</span>
    </div>

    <div class="cal-grid">
      <button
        v-for="(day, index) in calendarDays"
        :key="index"
        class="cal-day"
        :class="{
          'cal-day--other': !day.currentMonth,
          'cal-day--today': day.today,
          'cal-day--selected': day.selected || day.isRangeStart || day.isRangeEnd,
          'cal-day--in-range': day.inRange,
          'cal-day--range-start': day.isRangeStart,
          'cal-day--range-end': day.isRangeEnd,
        }"
        @click="selectDay(day)"
      >
        {{ day.date }}
      </button>
    </div>
  </div>

  <!-- 弹出模式 -->
  <BasePopover
    v-else
    :visible="visible"
    :position="position"
    @close="handleOverlayClick"
  >
    <div class="cal-popover">
          <div class="cal-header">
            <select v-model="calendarYear" class="cal-year-select">
              <option v-for="y in yearOptions" :key="y" :value="y">{{ y }}年</option>
            </select>
            <span class="cal-month-label">{{ monthNames[calendarMonth] }}</span>
            <div class="cal-nav-group">
              <button class="cal-nav" @click="prevMonth">
                <ChevronLeft :size="14" :stroke-width="2" />
              </button>
              <button class="cal-nav" @click="nextMonth">
                <ChevronRight :size="14" :stroke-width="2" />
              </button>
            </div>
          </div>

          <div class="cal-weekdays">
            <span v-for="day in weekDays" :key="day" class="cal-weekday">{{ day }}</span>
          </div>

          <div class="cal-grid">
            <button
              v-for="(day, index) in calendarDays"
              :key="index"
              class="cal-day"
              :class="{
                'cal-day--other': !day.currentMonth,
                'cal-day--today': day.today,
                'cal-day--selected': day.selected || day.isRangeStart || day.isRangeEnd,
                'cal-day--in-range': day.inRange,
                'cal-day--range-start': day.isRangeStart,
                'cal-day--range-end': day.isRangeEnd,
              }"
              @click="selectDay(day)"
            >
              {{ day.date }}
            </button>
      </div>
    </div>
  </BasePopover>
</template>

<style scoped>
@use '../styles/mixins' as *;

/* Popover 容器 */
.cal-popover {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-modal);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-family: inherit;
}

.cal-popover--inline {
  width: 100%;
  box-shadow: none;
  border: none;
  padding: 0;
}

/* Header */
.cal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 var(--space-1) 0;
  gap: var(--space-2);
}

.cal-year-select {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--accent);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  padding: 2px 20px 2px 6px;
  font-family: inherit;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23A8A29E' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 5px center;
  background-size: 10px;
  min-width: 72px;
  transition: border-color var(--transition-base);

  &:hover { border-color: var(--border-strong); }
  &:focus { border-color: var(--accent); box-shadow: var(--shadow-focus); }
}

.cal-month-label {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-primary);
}

.cal-nav-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.cal-nav {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  padding: 0;
  transition: background var(--transition-base);

  &:hover { background: var(--bg-hover); color: var(--text-primary); }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
}

/* Weekdays */
.cal-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.cal-weekday {
  font-size: var(--text-xs);
  text-align: center;
  color: var(--text-tertiary);
  padding: var(--space-1) 0;
}

/* Day grid */
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.cal-day {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  border-radius: 50%;
  font-size: var(--text-xs);
  padding: 0;
  transition: background var(--transition-base), color var(--transition-base);

  &:hover { background: var(--bg-hover); }
}

.cal-day--other {
  color: var(--text-tertiary);
}

.cal-day--today {
  color: var(--accent);
  font-weight: var(--font-medium);
}

/* Q7: 选中态 = subtle */
.cal-day--selected {
  background: var(--accent-subtle);
  color: var(--accent);
  font-weight: var(--font-medium);
}

/* Q8: today + selected = subtle + inset ring */
.cal-day--today.cal-day--selected {
  background: var(--accent-subtle);
  color: var(--accent);
  box-shadow: inset 0 0 0 1.5px var(--accent);
}

/* 区间：起点→终点 之间的整段浅色底 */
.cal-day--in-range {
  background: var(--accent-subtle);
  border-radius: 0;
}

/* 区间端点：与 selected 同款强调，保证起/止可见 */
.cal-day--range-start,
.cal-day--range-end {
  background: var(--accent);
  color: #fff;

  &:hover { background: var(--accent); color: #fff; }
}

.cal-day--today.cal-day--range-start,
.cal-day--today.cal-day--range-end {
  box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.7);
}

/* 过渡由 BasePopover 的 base-popover-fade 提供 */
</style>
