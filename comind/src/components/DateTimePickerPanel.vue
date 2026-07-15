<script setup lang="ts">
/**
 * DateTimePickerPanel — 日期 / 时间 / 重复选择器面板
 *
 * 用法：
 *   import { useDateTimePickerPanel } from '../composables/useDateTimePickerPanel'
 *   const { visible, position, open, close, confirm } = useDateTimePickerPanel()
 *
 * emit confirm({ kind, iso, recurrence })
 * emit cancel
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { Calendar, Clock, Repeat, X, Check } from 'lucide-vue-next'
import { useEditorStore } from '../stores/editor'
import type { DateRefKind, RecurrenceRule } from '../utils/date-ref'

export interface DateTimePickerConfirm {
  kind: DateRefKind
  iso: string
  recurrence: RecurrenceRule
}

const props = defineProps<{
  visible: boolean
  /** 锚点屏幕坐标 */
  position: { x: number; y: number }
  /** 当前 dateRef 的 kind */
  kind: DateRefKind
  /** 预填 ISO，格式 2026-07-15 或 2026-07-15T14:00 */
  initialIso: string
  /** 预填 recurrence */
  initialRecurrence: RecurrenceRule
}>()

const emit = defineEmits<{
  confirm: [value: DateTimePickerConfirm]
  cancel: []
}>()

const editorStore = useEditorStore()

// ── 本地状态（每次 open 时从 props 同步） ──────────────────────────────────────
const localDate = ref('')
const localTime = ref('')
const localRecurrence = ref<RecurrenceRule>('none')

// mode：date → 只显示日期选择；datetime → 日期 + 时间
const mode = computed<'date' | 'datetime'>(() => {
  // deadline 默认带时间；schedule 也带时间
  return 'datetime'
})

// 预设快捷日期
const today = computed(() => {
  const d = new Date()
  return d.toISOString().slice(0, 10)
})

const tomorrow = computed(() => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
})

const nextWeek = computed(() => {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toISOString().slice(0, 10)
})

// 选中日期的星期标签
const dayLabel = computed(() => {
  if (!localDate.value) return ''
  const d = new Date(localDate.value + 'T00:00:00')
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
})

// 实时预览 ISO
const previewIso = computed(() => {
  if (!localDate.value) return ''
  return localTime.value
    ? `${localDate.value}T${localTime.value}`
    : localDate.value
})

// 预览文本（与 date-ref.ts 的 formatIsoDisplay 保持一致）
const previewText = computed(() => {
  if (!previewIso.value) return ''
  const [datePart, timePart] = previewIso.value.split('T')
  if (!datePart) return ''
  const mmdd = datePart.slice(5) // MM-DD
  return timePart ? `${mmdd} ${timePart}` : mmdd
})

// ── 同步 props → 本地状态 ──────────────────────────────────────────────────────
watch(
  () => props.visible,
  (v) => {
    if (v) {
      // 从 initialIso 分离 date / time
      const [datePart, timePart] = (props.initialIso || today.value).split('T')
      localDate.value = datePart || today.value
      localTime.value = timePart || ''
      localRecurrence.value = props.initialRecurrence || 'none'
    }
  }
)

// ── 快捷日期 ──────────────────────────────────────────────────────────────────
function setDate(date: string) {
  localDate.value = date
}

function setToday() { localDate.value = today.value; localTime.value = '' }
function setTomorrow() { localDate.value = tomorrow.value; localTime.value = '' }
function setNextWeek() { localDate.value = nextWeek.value; localTime.value = '' }

// ── 确认 / 取消 ────────────────────────────────────────────────────────────────
function handleConfirm() {
  if (!localDate.value) return
  emit('confirm', {
    kind: props.kind,
    iso: previewIso.value,
    recurrence: localRecurrence.value,
  })
}

function handleCancel() {
  emit('cancel')
}

// ── 键盘 ───────────────────────────────────────────────────────────────────────
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

// ── 生命周期 ──────────────────────────────────────────────────────────────────
onMounted(() => document.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeyDown))

// ── 焦点管理 ───────────────────────────────────────────────────────────────────
const dateInputRef = ref<HTMLInputElement | null>(null)
watch(
  () => props.visible,
  async (v) => {
    if (v) {
      await nextTick()
      dateInputRef.value?.focus()
    }
  }
)
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
        <!-- 标题栏 -->
        <div class="dtp-header">
          <span class="dtp-title">
            {{ kind === 'schedule' ? '📅 计划时间' : '⏰ 截止时间' }}
          </span>
          <button class="dtp-icon-btn" title="关闭" @click="handleCancel">
            <X :size="12" :stroke-width="2" />
          </button>
        </div>

        <!-- 日期 + 时间 -->
        <div class="dtp-fields">
          <div class="dtp-field">
            <label class="dtp-label">
              <Calendar :size="11" :stroke-width="2" /> 日期
            </label>
            <input
              ref="dateInputRef"
              v-model="localDate"
              type="date"
              class="dtp-input dtp-input--date"
            />
            <span v-if="dayLabel" class="dtp-day-label">{{ dayLabel }}</span>
          </div>

          <div v-if="mode === 'datetime'" class="dtp-field">
            <label class="dtp-label">
              <Clock :size="11" :stroke-width="2" /> 时间
            </label>
            <input
              v-model="localTime"
              type="time"
              class="dtp-input dtp-input--time"
              placeholder="—"
            />
          </div>
        </div>

        <!-- 快捷日期 -->
        <div class="dtp-presets">
          <button class="dtp-preset-btn" @click="setToday">今天</button>
          <button class="dtp-preset-btn" @click="setTomorrow">明天</button>
          <button class="dtp-preset-btn" @click="setNextWeek">下周</button>
        </div>

        <!-- 重复规则 -->
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

        <!-- 预览 + 确认 -->
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
  width: 280px;
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

.dtp-fields {
  display: flex;
  gap: 8px;
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

.dtp-day-label {
  position: absolute;
  right: 8px;
  bottom: 6px;
  font-size: 10px;
  color: var(--text-tertiary);
  pointer-events: none;
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

.dtp-input--date {
  flex: 1;
  color-scheme: light;
}

.dtp-input--time {
  width: 90px;
}

.dtp-input--select {
  flex: 1;
  cursor: pointer;
  appearance: auto;
}

.dtp-presets {
  display: flex;
  gap: 4px;
}

.dtp-preset-btn {
  flex: 1;
  padding: 4px 0;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-secondary);
  font-family: inherit;
  transition: background 0.12s;
}

.dtp-preset-btn:hover {
  background: var(--bg-active);
  color: var(--text-primary);
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
  color: var(--color-paper);
  border-color: var(--accent);
}

.dtp-btn--confirm:hover:not(:disabled) {
  opacity: 0.85;
}

.dtp-btn--confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 动画 */
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
