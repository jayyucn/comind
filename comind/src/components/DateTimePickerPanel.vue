<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { Clock, Repeat, Check } from 'lucide-vue-next'
import CalendarPopover from './CalendarPopover.vue'
import { useEditorStore } from '../stores/editor'
import { useBlockStore } from '../stores/blocks'
import { parseDateRefs } from '../utils/date-ref'
import type { DateRefKind, RecurrenceRule } from '../utils/date-ref'

export interface DateTimePickerConfirm {
  kind: DateRefKind
  iso: string
  recurrence: RecurrenceRule
  leadMinutes: number
}

const props = defineProps<{
  visible: boolean
  position: { x: number; y: number }
  kind: DateRefKind
  initialIso: string
  initialRecurrence: RecurrenceRule
  initialLeadMinutes?: number
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
const localLeadMinutes = ref(0)
const enableTime = ref(false)

const today = computed(() => {
  const d = new Date()
  return d.toISOString().slice(0, 10)
})

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

const recurrenceLabel = computed(() => {
  const map: Record<string, string> = { daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' }
  return map[localRecurrence.value] || ''
})

let initializingKind = false

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      initializingKind = true
      localKind.value = props.kind
      const [datePart, timePart] = (props.initialIso || today.value).split('T')
      localDate.value = datePart || today.value
      localTime.value = timePart || ''
      localRecurrence.value = props.initialRecurrence || 'none'
      localLeadMinutes.value = props.initialLeadMinutes || 0
      enableTime.value = !!timePart

      await nextTick()
      initializingKind = false
    }
  }
)

let kindGuard = false

watch(localKind, (newKind, oldKind) => {
  if (kindGuard) { kindGuard = false; return }

  if (initializingKind) return

  if (newKind === 'deadline') {
    localRecurrence.value = 'none'
  }

  if (oldKind !== undefined && newKind !== oldKind) {
    const state = editorStore.dateRefEditor
    if (state && state.blockId) {
      const blockStore = useBlockStore()
      const block = blockStore.blocks.find(b => b.id === state.blockId)
      if (block) {
        const refs = parseDateRefs(block.content)
        if (refs.some(r => r.kind === newKind)) {
          const label = newKind === 'deadline' ? '截止时间' : '计划时间'
          editorStore.showToast(`该任务已有${label}`, 'warning')
          kindGuard = true
          localKind.value = oldKind
        }
      }
    }
  }
})

function handleConfirm() {
  if (!localDate.value) return
  emit('confirm', {
    kind: localKind.value,
    iso: previewIso.value,
    recurrence: localRecurrence.value,
    leadMinutes: localLeadMinutes.value,
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

onMounted(() => document.addEventListener('keydown', onKeyDown, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeyDown, true))
</script>

<template>
  <Teleport to="body">
    <Transition name="dtp-fade">
      <div
        v-if="visible"
        class="dtp-overlay"
        @click.self="handleCancel"
      >
        <div
          class="dtp-panel"
          :style="{ left: `${position.x}px`, top: `${position.y}px` }"
          @click.stop
        >
          <!-- Kind 切换 -->
          <div class="dtp-section dtp-kind-row">
            <div class="dtp-kind-wrapper">
              <span class="dtp-kind-icon">{{ localKind === 'schedule' ? '📅' : '⏰' }}</span>
              <select v-model="localKind" class="dtp-select dtp-select--kind">
                <option value="schedule">计划时间</option>
                <option value="deadline">截止时间</option>
              </select>
            </div>
          </div>

          <!-- 日历（inline CalendarPopover） -->
          <div class="dtp-section">
            <CalendarPopover
              inline
              :visible="true"
              :selected-date="localDate"
              @select="(date: string) => localDate = date"
            />
          </div>

          <!-- 时间设置 -->
          <div class="dtp-section dtp-time-toggle">
            <label class="dtp-checkbox-label">
              <input type="checkbox" v-model="enableTime" class="dtp-checkbox" />
              <span class="dtp-checkbox-text">设置时间</span>
            </label>
            <div v-if="enableTime" class="dtp-time-selector">
              <Clock :size="12" :stroke-width="2" />
              <select v-model="localTime" class="dtp-select dtp-select--time">
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

          <!-- 重复（仅 schedule） -->
          <div v-if="localKind !== 'deadline'" class="dtp-section dtp-field-row">
            <label class="dtp-field-label">
              <Repeat :size="11" :stroke-width="2" /> 重复
            </label>
            <select v-model="localRecurrence" class="dtp-select dtp-select--field">
              <option value="none">不重复</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
              <option value="yearly">每年</option>
            </select>
          </div>

          <!-- 提前提醒 -->
          <div class="dtp-section dtp-field-row">
            <label class="dtp-field-label">
              <Clock :size="11" :stroke-width="2" /> 提前提醒
            </label>
            <select v-model="localLeadMinutes" class="dtp-select dtp-select--field">
              <option :value="0">准时提醒</option>
              <option :value="15">提前 15 分钟</option>
              <option :value="30">提前 30 分钟</option>
              <option :value="60">提前 1 小时</option>
              <option :value="120">提前 2 小时</option>
              <option :value="720">提前 12 小时</option>
              <option :value="1440">提前 1 天</option>
            </select>
          </div>

          <!-- Footer -->
          <div class="dtp-footer">
            <span v-if="previewText" class="dtp-preview">
              {{ previewText }}<span v-if="recurrenceLabel" class="dtp-preview-rec"> · {{ recurrenceLabel }}</span>
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
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
@use '../styles/mixins' as *;

.dtp-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: var(--overlay);
}

.dtp-panel {
  position: fixed;
  z-index: 1101;
  width: var(--panel-width-md);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-modal);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-family: inherit;
}

/* Sections */
.dtp-section {
  display: flex;
  flex-direction: column;
}

/* Kind row */
.dtp-kind-row {
  flex-direction: row;
  align-items: center;
}

.dtp-kind-wrapper {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.dtp-kind-icon {
  font-size: var(--text-sm);
  line-height: var(--leading-none);
}

/* Select 统一样式（Q21） */
.dtp-select {
  font-family: inherit;
  cursor: pointer;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23A8A29E' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 6px center;
  background-size: 12px;
  transition: border-color var(--transition-base), box-shadow var(--transition-base);

  &:hover { border-color: var(--border-strong); }
  &:focus { border-color: var(--accent); box-shadow: var(--shadow-focus); }
  &:disabled { background: var(--bg-hover); cursor: not-allowed; opacity: 0.5; }
}

.dtp-select--kind {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-secondary);
  padding: 3px 24px 3px 6px;
}

.dtp-select--time {
  font-size: var(--text-xs);
  padding: 3px 20px 3px 6px;
  min-width: 70px;
}

.dtp-select--field {
  font-size: var(--text-sm);
  padding: var(--space-1) var(--space-2);
  flex: 1;
}

/* Time toggle */
.dtp-time-toggle {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-1) 0;
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
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.dtp-time-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-tertiary);
}

/* Field rows */
.dtp-field-row {
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
}

.dtp-field-label {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: var(--letter-wide-1);
  white-space: nowrap;
}

/* Footer */
.dtp-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border);
}

.dtp-preview {
  font-size: var(--text-sm);
  color: var(--text-primary);
  font-weight: var(--font-medium);
}

.dtp-preview--empty {
  color: var(--text-tertiary);
  font-style: italic;
  font-weight: var(--font-normal);
}

.dtp-preview-rec {
  color: var(--text-secondary);
  font-weight: var(--font-normal);
}

.dtp-actions {
  display: flex;
  gap: var(--space-1);
}

/* Buttons (Q22) */
.dtp-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-sm);
  font-family: inherit;
  transition: background var(--transition-base), border-color var(--transition-base), transform var(--transition-base);
}

.dtp-btn--cancel {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }

  &:active:not(:disabled) {
    background: var(--bg-active);
    transform: scale(0.98);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
}

.dtp-btn--confirm {
  background: var(--accent);
  color: var(--color-white);
  border: 1px solid var(--accent);

  &:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  &:active:not(:disabled) {
    transform: scale(0.98);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
}

/* Transition */
.dtp-fade-enter-active,
.dtp-fade-leave-active {
  transition: opacity var(--transition-base), transform var(--transition-base);
}

.dtp-fade-enter-from,
.dtp-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
