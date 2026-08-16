<script setup lang="ts">
/**
 * 通用日期选择组件 —— 单一方案，统一替换各处的「日期取值」不一致实现
 * （FilterBuilder 的原生 input[type=date]、cond-popover 内嵌的 CalendarPopover 等）。
 *
 * 两种模式：
 * - mode="single"：单选日期。modelValue 为 'YYYY-MM-DD' | undefined。
 * - mode="range" ：选日期区间（起止）。modelValue 为 [from, to] | undefined（任一为空串视为未填）。
 *
 * 交互：
 * - 触发按钮点击弹出日历（Teleport 到 body，fixed 定位，避免被外层 overflow 裁切，并做视口收边）。
 * - 区间两击选择：先点设「起点」（清空旧终点），再点设「终点」；若点的日期早于起点则视为新起点。
 * - 单选取定即关闭；区间设完终点关闭。
 *
 * 对外接口（与 project 约定一致：不可变 update 事件）：
 * - v-model（modelValue / update:modelValue）
 * - 取值通过 modelValue 传入，选择通过 update:modelValue 回传。
 */
import { computed, nextTick, ref } from 'vue'
import { Calendar } from 'lucide-vue-next'
import CalendarPopover from '../CalendarPopover.vue'

export type DatePickerValue = string | [string, string] | undefined

const props = withDefaults(
  defineProps<{
    /** 选择模式：单日期 / 日期区间。 */
    mode?: 'single' | 'range'
    /** 当前值：单日期为字符串，区间为 [from, to]。 */
    modelValue?: DatePickerValue
    /** 触发按钮占位符（缺省按模式给中文）。 */
    placeholder?: string
  }>(),
  { mode: 'single', modelValue: undefined, placeholder: '' },
)

const emit = defineEmits<{ 'update:modelValue': [value: DatePickerValue] }>()

const open = ref(false)
const triggerEl = ref<HTMLButtonElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const anchor = ref<{ x: number; y: number }>({ x: 0, y: 0 })

/* —— 取值（按模式归一） —— */
const singleValue = computed<string>(() =>
  props.mode === 'single' && typeof props.modelValue === 'string' ? props.modelValue : '',
)
const rangeTuple = computed<[string, string]>(() => {
  if (props.mode === 'range' && Array.isArray(props.modelValue)) {
    return [String(props.modelValue[0] ?? ''), String(props.modelValue[1] ?? '')]
  }
  return ['', '']
})

/* —— 展示文本 —— */
const placeholderText = computed(() =>
  props.placeholder || (props.mode === 'single' ? '选择日期' : '选择日期范围'),
)
const hasValue = computed(() =>
  props.mode === 'single' ? !!singleValue.value : !!(rangeTuple.value[0] || rangeTuple.value[1]),
)
const display = computed<string>(() => {
  if (props.mode === 'single') return singleValue.value || placeholderText.value
  const [f, t] = rangeTuple.value
  return f || t ? `${f || '…'} → ${t || '…'}` : placeholderText.value
})

/* —— 区间选择阶段：当前应设「起点」还是「终点」 —— */
const phase = computed<'from' | 'to'>(() => {
  const [f, t] = rangeTuple.value
  if (!f) return 'from'
  if (!t) return 'to'
  return 'from' // 起止已齐 → 下一次点击开启新区间
})
// 传给日历的活动高亮（当前正在设置的端点）
const calSelected = computed<string>(() =>
  props.mode === 'range' ? (phase.value === 'from' ? rangeTuple.value[0] : rangeTuple.value[1]) : singleValue.value,
)

/* —— 展开 / 收起 —— */
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

// 测量触发按钮位置并视口收边（避免被窗口裁切）
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
function onSelect(date: string) {
  if (props.mode === 'single') {
    emit('update:modelValue', date || undefined)
    close()
    return
  }
  // range
  const [f] = rangeTuple.value
  if (phase.value === 'from') {
    // 设起点，清空旧终点；保持打开以选终点
    emit('update:modelValue', [date, ''])
  } else if (!f || date >= f) {
    // 设终点（必须 >= 起点）
    emit('update:modelValue', [f, date])
    close()
  } else {
    // 点的日期早于起点 → 视为新起点
    emit('update:modelValue', [date, ''])
  }
}

function clearValue() {
  emit('update:modelValue', undefined)
}
</script>

<template>
  <div class="date-picker" :class="['dp-' + mode, { 'dp-open': open }]">
    <button
      ref="triggerEl"
      type="button"
      class="dp-trigger"
      :class="{ placeholder: !hasValue, open }"
      data-testid="dp-trigger"
      @click.stop="toggle"
    >
      <Calendar :size="14" class="dp-ico" />
      <span class="dp-text">{{ display }}</span>
      <span v-if="hasValue" class="dp-clear" title="清除" @click.stop="clearValue">×</span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panelEl"
        class="dp-root"
        :style="{ left: anchor.x + 'px', top: anchor.y + 'px' }"
      >
        <div class="dp-backdrop" @click="close"></div>
        <div class="dp-panel">
          <CalendarPopover
            inline
            :visible="true"
            data-testid="dp-calendar"
            :selected-date="calSelected"
            :range-start="mode === 'range' ? rangeTuple[0] : ''"
            :range-end="mode === 'range' ? rangeTuple[1] : ''"
            @select="onSelect"
          />
          <p v-if="mode === 'range'" class="dp-range-hint">
            {{ phase === 'from' ? '选择开始日期' : '选择结束日期' }}
          </p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
@use '../styles/mixins' as *;

.date-picker {
  display: inline-flex;
  min-width: 0;
}

.dp-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  outline: none;
  transition: border-color var(--transition-base);

  &:hover,
  &.open {
    border-color: var(--accent);
  }
}

.dp-trigger.placeholder .dp-text {
  color: var(--text-tertiary);
}

.dp-ico {
  color: var(--text-tertiary);
  flex: 0 0 auto;
}

.dp-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dp-clear {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  border-radius: 4px;

  &:hover {
    color: var(--error);
    background: var(--bg-hover);
  }
}

/* 浮动面板：Teleport 到 body，fixed 定位（避免被 FilterBuilder 面板 overflow 裁切） */
.dp-root {
  position: fixed;
  z-index: 1300;
}

.dp-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
}

.dp-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  box-shadow: var(--shadow-modal);
}

.dp-range-hint {
  margin: 0;
  text-align: center;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
</style>
