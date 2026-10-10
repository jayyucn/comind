<script setup lang="ts">
/**
 * 日期区间选择组件（issue T8，daterange 字段编辑器）。
 *
 * 复用 CalendarPopover 的 inline 区间面板（rangeStart/rangeEnd + 两击选择），
 * 触发器自持展示逻辑——与 DatePicker（single/range 通用触发器）职责分离：
 * - 两端齐：显示「start → end」胶囊
 * - 只有一端：降级显示单端（脏数据/半填容错，正常编辑流不会产生单端持久值）
 * - 无值：占位「选择日期区间」（undefined = 未填 = 删行契约，与 date 同口径）
 *
 * 交互（与 DatePicker range 模式同语义）：
 * - 第一击设起点（清空旧终点），保持展开；第二击若 >= 起点则设终点并收起，
 *   若早于起点则视为新起点（逆序纠正）。
 * - 触发器 × 清除 → emit undefined（上层删行）。
 * - start 为空则 end 一并清空：本组件只对外提交「两端齐的 {start,end}」或
 *   undefined，绝不发出单端值。
 *
 * 触发按钮 28px 高度基线（与 DatePicker / NumberInput 对齐）；浮层 Teleport 到
 * body、fixed 定位 + 视口收边，z-index 只用 var(--z-*)。
 */
import { Calendar } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import CalendarPopover from '../CalendarPopover.vue'

export interface DateRangePickerValue {
  start: string
  end: string
}

const props = withDefaults(
  defineProps<{
    /** 当前值：{ start, end }（两端 yyyy-MM-dd）；undefined = 未填。 */
    modelValue?: DateRangePickerValue
    /** 触发按钮占位符。 */
    placeholder?: string
  }>(),
  { modelValue: undefined, placeholder: '' },
)

const emit = defineEmits<{ 'update:modelValue': [value: DateRangePickerValue | undefined] }>()

const open = ref(false)
const triggerEl = ref<HTMLButtonElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const anchor = ref<{ x: number; y: number }>({ x: 0, y: 0 })

/** 内部草稿（两击选择过程态）；受控值回写时同步。 */
const draft = ref<DateRangePickerValue | undefined>(cloneOf(props.modelValue))

function cloneOf(v: DateRangePickerValue | undefined): DateRangePickerValue | undefined {
  return v ? { start: v.start, end: v.end } : undefined
}

watch(
  () => props.modelValue,
  (v) => {
    draft.value = cloneOf(v)
  },
)

/* —— 触发器展示文本（完整 → start → end；单端降级显示单端；无值占位）—— */
const display = computed<string>(() => {
  const v = draft.value
  if (!v || (!v.start && !v.end)) return placeholderText.value
  if (v.start && v.end) return `${v.start} → ${v.end}`
  // 只有起或止：降级显示单端
  return v.start || v.end
})

const hasValue = computed(() => {
  const v = draft.value
  return !!v && !!(v.start || v.end)
})

const placeholderText = computed(() => props.placeholder || '选择日期区间')

/* —— 展开 / 收起（同 DatePicker：Teleport + fixed + 视口收边）—— */
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

/* —— 两击选择（同 DatePicker range 语义）—— */
/** 当前应设「起点」还是「终点」。 */
const phase = computed<'from' | 'to'>(() => {
  const v = draft.value
  if (!v || !v.start) return 'from'
  if (!v.end) return 'to'
  return 'from' // 起止已齐 → 下一次点击开启新区间
})

// 传给日历的活动高亮（当前正在设置的端点）
const calSelected = computed<string>(() => {
  const v = draft.value
  if (!v) return ''
  return phase.value === 'from' ? v.start : v.end
})

function onSelect(date: string) {
  if (!date) return
  const v = draft.value
  if (phase.value === 'from') {
    // 设起点，清空旧终点；保持打开以选终点
    draft.value = { start: date, end: '' }
  } else if (!v?.start || date >= v.start) {
    // 设终点（必须 >= 起点），两端齐才对外提交
    draft.value = { start: v!.start, end: date }
    emit('update:modelValue', { start: v!.start, end: date })
    close()
  } else {
    // 点的日期早于起点 → 视为新起点（逆序纠正）
    draft.value = { start: date, end: '' }
  }
}

function clearValue() {
  draft.value = undefined
  emit('update:modelValue', undefined)
}

defineExpose({
  /** 测试钩子：直接暴露选择语义原子（jsdom 下绕过 DOM 合成事件不确定性）。 */
  onSelect,
})
</script>

<template>
  <div class="date-range-picker">
    <button
      ref="triggerEl"
      type="button"
      class="drp-trigger"
      :class="{ placeholder: !hasValue, open }"
      data-testid="drp-trigger"
      @click.stop="toggle"
    >
      <Calendar
        :size="14"
        class="drp-ico"
      />
      <span
        class="drp-text"
        data-testid="drp-text"
      >{{ display }}</span>
      <span
        v-if="hasValue"
        class="drp-clear"
        title="清除"
        data-testid="drp-clear"
        @click.stop="clearValue"
      >×</span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panelEl"
        class="drp-root"
        :style="{ left: anchor.x + 'px', top: anchor.y + 'px' }"
      >
        <div
          class="drp-backdrop"
          @click="close"
        />
        <div
          class="drp-panel"
          data-testid="drp-panel"
        >
          <CalendarPopover
            inline
            :visible="true"
            data-testid="drp-calendar"
            :selected-date="calSelected"
            :range-start="draft?.start ?? ''"
            :range-end="draft?.end ?? ''"
            @select="onSelect"
          />
          <p class="drp-range-hint">
            {{ phase === 'from' ? '选择开始日期' : '选择结束日期' }}
          </p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.date-range-picker {
  display: inline-flex;
  min-width: 0;
}

.drp-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  /* 28px 高度基线：与 DatePicker / NumberInput 静止态外框对齐（BlockFieldZone 同列并排） */
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

.drp-trigger.placeholder .drp-text {
  color: var(--text-tertiary);
}

.drp-ico {
  color: var(--text-tertiary);
  flex: 0 0 auto;
}

.drp-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drp-clear {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  border-radius: 4px;
  /* 仅 hover 触发按钮时显示（透明占位避免宽度跳动）；隐形态必须 pointer-events:none */
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-base) var(--ease-out);

  &:hover {
    color: var(--error);
    background: var(--bg-hover);
  }
}

.drp-trigger:hover .drp-clear,
.drp-trigger.open .drp-clear,
.drp-clear:hover {
  opacity: 1;
  pointer-events: auto;
}

/* 浮动面板：Teleport 到 body，fixed 定位（避免被外层 overflow 裁切） */
.drp-root {
  position: fixed;
  z-index: var(--z-popover-deep);
}

.drp-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
}

.drp-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  box-shadow: var(--shadow-modal);
}

.drp-range-hint {
  margin: 0;
  text-align: center;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
</style>
