<script setup lang="ts">
/**
 * 日期时间选择组件（T2，issue #140 datetime 的编辑器落地）。
 *
 * 与 DatePicker.vue 同构（触发按钮 + Teleport 浮层 + CalendarPopover 内嵌日历），
 * 差异仅在值契约与时间档：
 * - 值格式固定 'yyyy-MM-dd HH:mm'（FieldValueDataMap.datetime），undefined = 未填。
 * - 时间用 <input type="time">（HH:mm 两档，原生控件自校验）。
 * - 选日期后**保持面板打开**：日期只是 datetime 值的前半段，需留在面板里调时间
 *   （DatePicker 单选即关的语义在此不适用）。
 * - 未选日期时时间输入禁用：时间没有独立语义，避免「只有时间没有日期」的半值。
 *   选日期时未调过时间 → 以 '00:00' 兜底落库，保证值恒带时间部分。
 *
 * 值拼装为纯字符串操作（slice / 正则拆段），不经 new Date('yyyy-MM-dd HH:mm')
 * 空格形解析（Safari NaN，跨引擎约定）；日历点选回传的日期由 CalendarPopover 保证
 * 'yyyy-MM-dd' 形。对外接口与 DatePicker 一致：v-model（undefined = 未填 = 删行，
 * 28px 触发按钮基线契约同 NumberInput / DatePicker）。
 */
import { Calendar } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import CalendarPopover from '../CalendarPopover.vue'

const props = withDefaults(
  defineProps<{
    /** 当前值：'yyyy-MM-dd HH:mm' | undefined（未填）。 */
    modelValue?: string
    /** 触发按钮占位符。 */
    placeholder?: string
  }>(),
  { modelValue: undefined, placeholder: '' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>()

const open = ref(false)
const triggerEl = ref<HTMLButtonElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const anchor = ref<{ x: number; y: number }>({ x: 0, y: 0 })

/* —— 值拆段（纯字符串，不经 Date 解析） —— */
const datePart = computed<string>(() => {
  const v = props.modelValue
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}( |$)/.test(v) ? v.slice(0, 10) : ''
})

/** 时间档草稿：跟随 modelValue 的时间段；无值时为空（禁用态）。 */
const timeDraft = ref('')
watch(
  () => props.modelValue,
  (v) => {
    const m = typeof v === 'string' ? v.match(/^\d{4}-\d{2}-\d{2} (\d{2}:\d{2})$/) : null
    timeDraft.value = m ? m[1] : ''
  },
  { immediate: true },
)

/* —— 展示文本 —— */
const placeholderText = computed(() => props.placeholder || '选择日期时间')
const hasValue = computed(() => !!props.modelValue)
const display = computed<string>(() => props.modelValue || placeholderText.value)

/* —— 展开 / 收起（与 DatePicker 同款视口收边） —— */
function toggle() {
  if (open.value) close()
  else openPanel()
}
function openPanel() {
  open.value = true
  nextTick(placePanel)
}
function close() {
  open.value = false
}

function placePanel() {
  const btn = triggerEl.value
  if (!btn) return
  const r = btn.getBoundingClientRect()
  let x = r.left
  let y = r.bottom + 4
  const el = panelEl.value
  if (el && typeof window !== 'undefined') {
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (x + el.offsetWidth > vw - 8) x = Math.max(8, vw - el.offsetWidth - 8)
    if (y + el.offsetHeight > vh - 8) {
      const above = r.top - el.offsetHeight - 4
      y = above >= 8 ? above : Math.max(8, vh - el.offsetHeight - 8)
    }
  }
  anchor.value = { x, y }
}

/* —— 取值回调 —— */

/** 日历点选：拼上当前时间档（未调过 → '00:00'）回传；面板保持打开以便调时间。 */
function onSelect(date: string) {
  if (!date) return
  emit('update:modelValue', `${date} ${timeDraft.value || '00:00'}`)
}

/** 时间档变更：仅在有日期部分时回传（时间没有独立语义，不产半值）。 */
function onTimeInput(e: Event) {
  const t = (e.target as HTMLInputElement).value
  timeDraft.value = t
  if (datePart.value && t) emit('update:modelValue', `${datePart.value} ${t}`)
}

function clearValue() {
  timeDraft.value = ''
  emit('update:modelValue', undefined)
}

// 测试钩子：jsdom 下跳过 CalendarPopover 的 DOM 合成事件不确定性，
// 暴露 onSelect 语义原子（与 DatePicker 的 defineExpose 同约定）。
defineExpose({ onSelect })
</script>

<template>
  <div class="date-time-picker">
    <button
      ref="triggerEl"
      type="button"
      class="dtp-trigger"
      :class="{ placeholder: !hasValue, open }"
      data-testid="dtp-trigger"
      @click.stop="toggle"
    >
      <Calendar
        :size="14"
        class="dtp-ico"
      />
      <span class="dtp-text">{{ display }}</span>
      <span
        v-if="hasValue"
        class="dtp-clear"
        title="清除"
        @click.stop="clearValue"
      >×</span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panelEl"
        class="dtp-root"
        :style="{ left: anchor.x + 'px', top: anchor.y + 'px' }"
      >
        <div
          class="dtp-backdrop"
          @click="close"
        />
        <div class="dtp-panel">
          <CalendarPopover
            inline
            :visible="true"
            data-testid="dtp-calendar"
            :selected-date="datePart"
            @select="onSelect"
          />
          <div
            class="dtp-time-row"
            data-testid="dtp-time-row"
          >
            <label
              class="dtp-time-label"
              for="dtp-time-input"
            >时间</label>
            <input
              id="dtp-time-input"
              v-model="timeDraft"
              type="time"
              class="dtp-time"
              data-testid="dtp-time"
              :disabled="!datePart"
              @click.stop
              @input="onTimeInput"
            >
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
@use '../styles/mixins' as *;

.date-time-picker {
  display: inline-flex;
  min-width: 0;
}

/* 触发按钮与 DatePicker 同基线：28px 高度契约（BlockFieldZone 同列并排） */
.dtp-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  min-height: 28px;
  box-sizing: border-box;
  border: none;
  outline: none;
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  transition: background var(--dur-base) var(--ease-out);

  &:hover,
  &.open {
    background: var(--bg-hover);
  }
}

.dtp-trigger.placeholder .dtp-text {
  color: var(--text-tertiary);
}

.dtp-ico {
  color: var(--text-tertiary);
  flex: 0 0 auto;
}

.dtp-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dtp-clear {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  border-radius: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-base) var(--ease-out);

  &:hover {
    color: var(--error);
    background: var(--bg-hover);
  }
}

.dtp-trigger:hover .dtp-clear,
.dtp-trigger.open .dtp-clear,
.dtp-clear:hover {
  opacity: 1;
  pointer-events: auto;
}

/* 浮动面板：Teleport 到 body，fixed 定位（同 DatePicker，避免外层 overflow 裁切） */
.dtp-root {
  position: fixed;
  z-index: var(--z-popover-deep);
}

.dtp-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
}

.dtp-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  box-shadow: var(--shadow-modal);
}

/* 时间档行：日历下方一行（label + 原生 time 输入），与面板 padding 节奏一致 */
.dtp-time-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-1);
}

.dtp-time-label {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.dtp-time {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-sm);
  outline: none;

  &:focus {
    border-color: var(--accent);
  }

  &:disabled {
    color: var(--text-tertiary);
    cursor: not-allowed;
  }
}
</style>
