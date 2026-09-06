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
 * 动态值（dynamic 模式，仅 single 生效）：
 * - dynamic=false（默认）：快捷按钮/键入把相对日期表达式 resolve 成固定 'YYYY-MM-DD' 落库
 *   （适合日历本身、date-ref 等需要「具体某一天」的场景）。
 * - dynamic=true：快捷按钮 / 键入 emit **表达式 token**（today / +3 / 下周一…）而不固化日期，
 *   由上层落库为动态相对值；求值方每次按当天解析，实现条件跟随日期流转。
 *   日历点选仍 emit 完整 'YYYY-MM-DD'（静态），上层可按格式区分两种值。
 *
 * 对外接口（与 project 约定一致：不可变 update 事件）：
 * - v-model（modelValue / update:modelValue）
 * - 取值通过 modelValue 传入，选择通过 update:modelValue 回传。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { Calendar } from 'lucide-vue-next'
import CalendarPopover from '../CalendarPopover.vue'
import { formatRelativeExpr, parseRelativeDate, relativeDateShortcuts } from '../../utils/date-parser'

export type DatePickerValue = string | [string, string] | undefined

const props = withDefaults(
  defineProps<{
    /** 选择模式：单日期 / 日期区间。 */
    mode?: 'single' | 'range'
    /** 当前值：单日期为字符串，区间为 [from, to]。dynamic 下也可以是相对表达式 token。 */
    modelValue?: DatePickerValue
    /** 触发按钮占位符（缺省按模式给中文）。 */
    placeholder?: string
    /** 单日期模式：快捷/键入产出相对表达式 token（动态值）而非固化日期。仅 single 生效。 */
    dynamic?: boolean
  }>(),
  { mode: 'single', modelValue: undefined, placeholder: '', dynamic: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: DatePickerValue] }>()

const open = ref(false)
const triggerEl = ref<HTMLButtonElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const anchor = ref<{ x: number; y: number }>({ x: 0, y: 0 })

/** dynamic 仅在 single 模式真正生效（range 始终产出静态区间日期）。 */
const dynamicActive = computed(() => props.dynamic && props.mode === 'single')

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
  if (props.mode === 'single') {
    const v = singleValue.value
    if (!v) return placeholderText.value
    // dynamic 模式下 modelValue 可能是相对表达式 token（今日/本周起始…），显示中文；
    // 完整日期（日历点选）原样显示。
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return formatRelativeExpr(v)
    return v
  }
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

/* —— 快捷动态值（今日 / 昨日 / ... / 本月末） —— */
// dynamic=false：resolve 成 yyyy-MM-dd 落库（具体某天）。
// dynamic=true：emit token（today/weekStart/...），由上层按动态相对值处理。
type ShortcutKey =
  | 'today' | 'yesterday' | 'tomorrow'
  | 'weekStart' | 'weekEnd'
  | 'monthStart' | 'monthEnd'

const shortcutLabels: Record<ShortcutKey, string> = {
  today: '今日',
  yesterday: '昨日',
  tomorrow: '明日',
  weekStart: '本周起始',
  weekEnd: '本周末',
  monthStart: '本月初',
  monthEnd: '本月末',
}

const shortcuts = computed(() => relativeDateShortcuts())

function applyShortcut(key: ShortcutKey) {
  if (dynamicActive.value) {
    // 动态值：emit 表达式 token，不固化日期（single 即关闭，与 onSelect 行为一致）
    onDynamicValue(key)
    return
  }
  const date = shortcuts.value[key]
  onSelect(date)
}

/** dynamic 单值提交：emit token 并收起。 */
function onDynamicValue(token: string) {
  if (props.mode === 'range') return // 防御：dynamic 仅 single 生效
  emit('update:modelValue', token)
  close()
}

/* —— 键入相对日期 —— */
const customInput = ref('')
const customError = ref('')
// 切换触发器展开态时清空输入与错误
watch(open, (v) => {
  if (v) {
    customInput.value = ''
    customError.value = ''
  }
})

function commitCustom() {
  const text = customInput.value.trim()
  if (!text) {
    customError.value = ''
    return
  }
  const resolved = parseRelativeDate(text)
  if (!resolved) {
    customError.value = `无法识别「${text}」，试试 2026-09-06 / +3 / 下周一`
    return
  }
  customError.value = ''
  if (dynamicActive.value) {
    // 动态值：键入表达式原文落库（8 位完整日期仍按静态由上层判定）
    onDynamicValue(text)
    return
  }
  onSelect(resolved)
}

function onCustomKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitCustom()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    customInput.value = ''
    customError.value = ''
  }
}

// 测试钩子：仅在 vitest/jsdom 下通过 wrapper.vm 跳过 DOM 合成事件的不确定性。
// 不参与生产交互，仅暴露 applyShortcut / commitCustom 两个语义原子。
defineExpose({
  applyShortcut,
  commitCustom,
})

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
          <!-- 快捷值（今日 / 昨日 / ... / 本月末）：
               dynamic=false → resolve 为 yyyy-MM-DD 落库（具体某天）
               dynamic=true  → emit token（动态值，求值时刻按当天解析） -->
          <div class="dp-shortcuts" data-testid="dp-shortcuts">
            <button
              v-for="key in (['today','yesterday','tomorrow','weekStart','weekEnd','monthStart','monthEnd'] as const)"
              :key="key"
              type="button"
              class="dp-shortcut"
              :class="{ active: dynamicActive && singleValue === key }"
              :data-shortcut="key"
              @click="applyShortcut(key)"
            >
              {{ shortcutLabels[key] }}
            </button>
          </div>
          <!-- 键入：相对日期表达式（今天 / +3 / 下周一 / 2026-09-06） -->
          <div class="dp-custom" data-testid="dp-custom">
            <input
              v-model="customInput"
              type="text"
              class="dp-custom-input"
              placeholder="或键入：今天 / +3 / 下周一 / 2026-09-06…"
              data-testid="dp-custom-input"
              @keydown="onCustomKeydown"
            />
            <button
              type="button"
              class="dp-custom-apply"
              data-testid="dp-custom-apply"
              @click="commitCustom"
            >
              确定
            </button>
          </div>
          <p v-if="customError" class="dp-custom-error" data-testid="dp-custom-error">
            {{ customError }}
          </p>

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
  z-index: var(--z-popover-deep);
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

/* 快捷动态值按钮：单行 7 个 chip，与日历共享 panel 的 padding 节奏 */
.dp-shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.dp-shortcut {
  flex: 1 1 auto;
  min-width: 56px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
  outline: none;
  transition: border-color var(--transition-base), background var(--transition-base);

  &:hover {
    border-color: var(--accent);
    background: var(--bg-hover);
  }

  &.active {
    border-color: var(--accent);
    background: var(--accent-bg);
    color: var(--accent);
    font-weight: 500;
  }
}

/* 键入行：input + 按钮 */
.dp-custom {
  display: flex;
  gap: 4px;
  align-items: center;
}

.dp-custom-input {
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
}

.dp-custom-apply {
  flex: 0 0 auto;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--bg-base, #fff);
  font-family: inherit;
  font-size: var(--text-sm);
  cursor: pointer;

  &:hover {
    filter: brightness(1.05);
  }
}

.dp-custom-error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--error);
}
</style>
