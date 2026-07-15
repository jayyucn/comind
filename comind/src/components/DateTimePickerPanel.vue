<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { Calendar, Clock, Repeat, X, Check, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { useEditorStore } from '../stores/editor'
import type { DateRefKind, RecurrenceRule } from '../utils/date-ref'

export interface DateTimePickerConfirm {
  kind: DateRefKind
  iso: string
  recurrence: RecurrenceRule
}

const props = defineProps<{
  visible: boolean
  position: { x: number; y: number }
  kind: DateRefKind
  initialIso: string
  initialRecurrence: RecurrenceRule
}>()

const emit = defineEmits<{
  confirm: [value: DateTimePickerConfirm]
  cancel: []
}>()

const editorStore = useEditorStore()

const localKind = ref<DateRefKind>('schedule')
const localDate = ref('')
const localTime = ref('')
const localRecurrence = ref<RecurrenceRule>('none')
const enableTime = ref(false)

const today = computed(() => {
  const d = new Date()
  return d.toISOString().slice(0, 10)
})

const calendarYear = ref(2026)
const calendarMonth = ref(6)

const weekDays = ['一', '二', '三', '四', '五', '六', '日']

const calendarDays = computed(() => {
  const year = calendarYear.value
  const month = calendarMonth.value
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const days: { date: number; currentMonth: boolean; today: boolean; selected: boolean }[] = []

  const startPadding = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1
  const prevMonthLastDay = new Date(year, month, 0).getDate()
  for (let i = startPadding - 1; i >= 0; i--) {
    days.push({ date: prevMonthLastDay - i, currentMonth: false, today: false, selected: false })
  }

  for (let i = 1; i <= lastDay.getDate(); i++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`
    days.push({
      date: i,
      currentMonth: true,
      today: dateStr === today.value,
      selected: dateStr === localDate.value,
    })
  }

  const remaining = 42 - days.length
  for (let i = 1; i <= remaining; i++) {
    days.push({ date: i, currentMonth: false, today: false, selected: false })
  }

  return days
})

const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

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

function selectDate(day: { date: number; currentMonth: boolean }) {
  if (!day.currentMonth) {
    if (day.date > 15) {
      prevMonth()
    } else {
      nextMonth()
    }
    day.date = day.currentMonth ? day.date : (day.date > 15 ? day.date : day.date)
  }
  const year = calendarYear.value
  const month = calendarMonth.value
  localDate.value = `${year}-${String(month + 1).padStart(2, '0')}-${String(day.date).padStart(2, '0')}`
}

const previewIso = computed(() => {
  if (!localDate.value) return ''
  return enableTime.value && localTime.value
    ? `${localDate.value}T${localTime.value}`
    : localDate.value
})

const previewText = computed(() => {
  if (!previewIso.value) return ''
  const [datePart, timePart] = previewIso.value.split('T')
  if (!datePart) return ''
  const mmdd = datePart.slice(5)
  return timePart ? `${mmdd} ${timePart}` : mmdd
})

watch(
  () => props.visible,
  (v) => {
    if (v) {
      localKind.value = props.kind
      const [datePart, timePart] = (props.initialIso || today.value).split('T')
      localDate.value = datePart || today.value
      localTime.value = timePart || ''
      localRecurrence.value = props.initialRecurrence || 'none'
      enableTime.value = !!timePart

      if (localDate.value) {
        const [y, m] = localDate.value.split('-').map(Number)
        calendarYear.value = y
        calendarMonth.value = m - 1
      }
    }
  }
)

function toggleKind() {
  localKind.value = localKind.value === 'schedule' ? 'deadline' : 'schedule'
}

function handleConfirm() {
  if (!localDate.value) return
  emit('confirm', {
    kind: localKind.value,
    iso: previewIso.value,
    recurrence: localRecurrence.value,
  })
}

function handleCancel() {
  emit('cancel')
}

function onKeyDown(e: KeyboardEvent) {
  if (!props.visible) return
  if (e.key === 'Escape') {
    e.preventDefault()
    handleCancel()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    handleConfirm()
  }
}

onMounted(() => document.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <Teleport to="body">
    <Transition name="fade-slide">
      <div
        v-if="visible"
        class="dtp-panel"
        :style="{ left: `${position.x}px`, top: `${position.y}px` }"
        @click.stop
      >
        <div class="dtp-header">
          <span class="dtp-title">
            {{ localKind === 'schedule' ? '📅 计划时间' : '⏰ 截止时间' }}
          </span>
          <div class="dtp-header-actions">
            <button class="dtp-icon-btn" title="切换类型" @click="toggleKind">
              {{ localKind === 'schedule' ? '⏰' : '📅' }}
            </button>
            <button class="dtp-icon-btn" title="关闭" @click="handleCancel">
              <X :size="12" :stroke-width="2" />
            </button>
          </div>
        </div>

        <div class="dtp-calendar">
          <div class="dtp-calendar-header">
            <button class="dtp-calendar-nav" @click="prevMonth">
              <ChevronLeft :size="14" :stroke-width="2" />
            </button>
            <span class="dtp-calendar-title">
              {{ calendarYear }}年 {{ monthNames[calendarMonth] }}
            </span>
            <button class="dtp-calendar-nav" @click="nextMonth">
              <ChevronRight :size="14" :stroke-width="2" />
            </button>
          </div>

          <div class="dtp-calendar-weekdays">
            <span v-for="day in weekDays" :key="day" class="dtp-calendar-weekday">
              {{ day }}
            </span>
          </div>

          <div class="dtp-calendar-grid">
            <button
              v-for="(day, index) in calendarDays"
              :key="index"
              class="dtp-calendar-day"
              :class="{
                'dtp-calendar-day--other': !day.currentMonth,
                'dtp-calendar-day--today': day.today,
                'dtp-calendar-day--selected': day.selected,
              }"
              @click="selectDate(day)"
            >
              {{ day.date }}
            </button>
          </div>
        </div>

        <div class="dtp-time-toggle">
          <label class="dtp-checkbox-label">
            <input type="checkbox" v-model="enableTime" class="dtp-checkbox" />
            <span class="dtp-checkbox-text">设置时间</span>
          </label>
          <div v-if="enableTime" class="dtp-time-selector">
            <Clock :size="12" :stroke-width="2" />
            <select v-model="localTime" class="dtp-time-input">
              <option value="00:00">00:00</option>
              <option value="01:00">01:00</option>
              <option value="02:00">02:00</option>
              <option value="03:00">03:00</option>
              <option value="04:00">04:00</option>
              <option value="05:00">05:00</option>
              <option value="06:00">06:00</option>
              <option value="07:00">07:00</option>
              <option value="08:00">08:00</option>
              <option value="09:00">09:00</option>
              <option value="10:00">10:00</option>
              <option value="11:00">11:00</option>
              <option value="12:00">12:00</option>
              <option value="13:00">13:00</option>
              <option value="14:00">14:00</option>
              <option value="15:00">15:00</option>
              <option value="16:00">16:00</option>
              <option value="17:00">17:00</option>
              <option value="18:00">18:00</option>
              <option value="19:00">19:00</option>
              <option value="20:00">20:00</option>
              <option value="21:00">21:00</option>
              <option value="22:00">22:00</option>
              <option value="23:00">23:00</option>
            </select>
          </div>
        </div>

        <div class="dtp-field dtp-field--full">
          <label class="dtp-label">
            <Repeat :size="11" :stroke-width="2" /> 重复
          </label>
          <select v-model="localRecurrence" class="dtp-input dtp-input--select">
            <option value="none">不重复</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
            <option value="yearly">每年</option>
          </select>
        </div>

        <div class="dtp-footer">
          <span v-if="previewText" class="dtp-preview">
            {{ previewText
            }}<span v-if="localRecurrence !== 'none'" class="dtp-preview-rec">
              · {{ { daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' }[localRecurrence] }}
            </span>
          </span>
          <span v-else class="dtp-preview dtp-preview--empty">请选择日期</span>

          <div class="dtp-actions">
            <button class="dtp-btn dtp-btn--cancel" @click="handleCancel">取消</button>
            <button
              class="dtp-btn dtp-btn--confirm"
              :disabled="!localDate"
              @click="handleConfirm"
            >
              <Check :size="11" :stroke-width="2.5" /> 确定
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dtp-panel {
  position: fixed;
  z-index: 1100;
  width: 300px;
  background: var(--bg-base, #FAFAF8);
  border: 1px solid var(--border, #E7E5E4);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(28, 25, 23, 0.10);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: inherit;
}

.dtp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dtp-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.dtp-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.dtp-icon-btn {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
}

.dtp-icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.dtp-calendar {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dtp-calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.dtp-calendar-nav {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
}

.dtp-calendar-nav:hover {
  background: var(--bg-hover);
}

.dtp-calendar-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.dtp-calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.dtp-calendar-weekday {
  font-size: 10px;
  text-align: center;
  color: var(--text-tertiary);
  padding: 4px 0;
}

.dtp-calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.dtp-calendar-day {
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
  font-size: 12px;
  padding: 0;
}

.dtp-calendar-day:hover {
  background: var(--bg-hover);
}

.dtp-calendar-day--other {
  color: var(--text-tertiary);
}

.dtp-calendar-day--today {
  color: var(--accent);
  font-weight: 500;
}

.dtp-calendar-day--selected {
  background: var(--accent);
  color: #fff;
}

.dtp-calendar-day--today.dtp-calendar-day--selected {
  background: var(--accent);
  color: #fff;
}

.dtp-time-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.dtp-checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.dtp-checkbox {
  width: 14px;
  height: 14px;
  accent-color: var(--accent);
}

.dtp-checkbox-text {
  font-size: 12px;
  color: var(--text-secondary);
}

.dtp-time-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-tertiary);
}

.dtp-time-input {
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  appearance: auto;
  min-width: 70px;
}

.dtp-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  position: relative;
}

.dtp-field--full {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.dtp-label {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dtp-input {
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  min-width: 0;
}

.dtp-input:focus {
  border-color: var(--accent);
}

.dtp-input--select {
  flex: 1;
  cursor: pointer;
  appearance: auto;
}

.dtp-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 2px;
  border-top: 1px solid var(--border);
}

.dtp-preview {
  font-size: 12px;
  color: var(--text-primary);
}

.dtp-preview--empty {
  color: var(--text-tertiary);
  font-style: italic;
}

.dtp-preview-rec {
  color: var(--text-secondary);
}

.dtp-actions {
  display: flex;
  gap: 4px;
}

.dtp-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 10px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  transition: background 0.12s;
  border: 1px solid var(--border);
}

.dtp-btn--cancel {
  background: transparent;
  color: var(--text-secondary);
}

.dtp-btn--cancel:hover {
  background: var(--bg-hover);
}

.dtp-btn--confirm {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.dtp-btn--confirm:hover:not(:disabled) {
  opacity: 0.85;
}

.dtp-btn--confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
