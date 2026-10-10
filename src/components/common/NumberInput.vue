<script setup lang="ts">
/**
 * 通用数值编辑器 —— 与 DatePicker 同构（common/ 下、v-model 契约、类型感知），
 * 是 number 字段的专属录入控件（ADR-0055）。
 *
 * 形态：内联「数字输入框 + ± 步进按钮」，无弹层（数值不需要日历式面板）。
 *
 * 接口：
 * - v-model（modelValue: number | undefined / update:modelValue）：未填 = undefined
 *   （与 DatePicker 一致，且与 deleteFieldValue 的「无行即空」语义一致）。
 * - placeholder：空值占位符。
 * - min / max / step：可选数值约束（来自字段定义，ADR-0055 D5）；null/undefined = 无约束。
 *
 * 越界处理（ADR-0055 D7）：
 * - 失焦（blur）或回车：解析后夹到 [min, max]；若配置 step，就近取整到以 min 为基准的 step 倍数。
 * - 自由键入允许小数；未配置 step 时 ± 步进增量为 1，且不做事后小数夹取。
 * - 清空输入框 → emit undefined（上层据此删值行）。
 *
 * 对外不可变 update 事件，与 project 约定一致。
 */
import { computed, ref, watch } from 'vue'

export type NumberInputValue = number | undefined

const props = withDefaults(
  defineProps<{
    /** 当前值；undefined = 未填。 */
    modelValue?: NumberInputValue
    /** 空值占位符。 */
    placeholder?: string
    /** 下界（含）；null/undefined = 无下界。 */
    min?: number | null
    /** 上界（含）；null/undefined = 无上界。 */
    max?: number | null
    /** 步进 / 取整步长；null/undefined = 步进 1 且不取整。 */
    step?: number | null
    /** 无障碍标签（缺省用 placeholder）。 */
    ariaLabel?: string
  }>(),
  { modelValue: undefined, placeholder: '', min: null, max: null, step: null, ariaLabel: '' },
)

const emit = defineEmits<{ 'update:modelValue': [value: NumberInputValue] }>()

const draft = ref<string>(props.modelValue == null ? '' : String(props.modelValue))
const focused = ref(false)

/** 约束值归一：null/undefined → null；其余强转 number（非法 → null）。 */
function toNum(v: number | null | undefined): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}
const numMin = computed(() => toNum(props.min))
const numMax = computed(() => toNum(props.max))
const numStep = computed(() => toNum(props.step))

/** 解析输入框原文：空 → null；非法 → null。 */
function parseRaw(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isNaN(n) ? null : n
}

/** 以 min 为基准，把值就近取整到 step 倍数（无 step 或 step=0 → 原值）。 */
function snap(v: number): number {
  const st = numStep.value
  const base = numMin.value ?? 0
  if (st === null || st === 0) return v
  return base + Math.round((v - base) / st) * st
}

/** 夹边界 + 取整（夹 → 取整 → 再夹，保证不出界）。 */
function clampSnap(v: number): number {
  let r = v
  if (numMin.value !== null && r < numMin.value) r = numMin.value
  if (numMax.value !== null && r > numMax.value) r = numMax.value
  r = snap(r)
  if (numMin.value !== null && r < numMin.value) r = numMin.value
  if (numMax.value !== null && r > numMax.value) r = numMax.value
  return r
}

/** 失焦 / 回车：解析 → 夹边界取整 → 提交（空 → undefined）。 */
function commit() {
  const parsed = parseRaw(draft.value)
  if (parsed === null) {
    emit('update:modelValue', undefined)
    return
  }
  const clamped = clampSnap(parsed)
  draft.value = String(clamped)
  emit('update:modelValue', clamped)
}

/** ± 步进：从当前输入（或 min，或 0）出发，按 step(默认 1) 步进后夹边界取整。 */
function stepBy(deltaSign: 1 | -1) {
  const cur = parseRaw(draft.value) ?? numMin.value ?? 0
  const st = numStep.value ?? 1
  const next = clampSnap(cur + deltaSign * st)
  draft.value = String(next)
  emit('update:modelValue', next)
}

function onInput(e: Event) {
  draft.value = (e.target as HTMLInputElement).value
}
function onFocus() {
  focused.value = true
}
function onBlur() {
  focused.value = false
  commit()
}

// 外部值变化（非聚焦态）同步到草稿，避免打字时被回写覆盖。
watch(
  () => props.modelValue,
  (v) => {
    if (!focused.value) draft.value = v == null ? '' : String(v)
  },
)

// 测试钩子：暴露语义原子（increment/decrement/commit），绕过 jsdom 合成事件的不确定性。
// 不参与生产交互。
defineExpose({ increment: () => stepBy(1), decrement: () => stepBy(-1), commit })
</script>

<template>
  <span
    class="number-input"
    :class="{ 'ni-empty': draft === '' }"
  >
    <button
      class="ni-step"
      type="button"
      tabindex="-1"
      aria-label="减少"
      @click="stepBy(-1)"
    >−</button>
    <input
      ref="inputEl"
      class="ni-input"
      type="text"
      inputmode="decimal"
      :value="draft"
      :placeholder="placeholder"
      :aria-label="ariaLabel || placeholder || '数值'"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown.enter.prevent="commit"
    >
    <button
      class="ni-step"
      type="button"
      tabindex="-1"
      aria-label="增加"
      @click="stepBy(1)"
    >+</button>
  </span>
</template>

<style lang="scss" scoped>
.number-input {
  display: inline-flex;
  align-items: center;
  /* 与 DatePicker 触发器共用 28px 高度基线（静止态对齐） */
  height: 28px;
  background: var(--bg-base);
  /* 渐进披露（与 dp-clear 同构）：静止态 ghost，边框透明占位防浮现时宽高跳动 */
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  overflow: hidden;
  transition: border-color var(--dur-base) var(--ease-out);

  &:hover,
  &:focus-within {
    border-color: var(--border-color, rgba(255, 255, 255, 0.08));
  }
}

.ni-step {
  width: 26px;
  /* 28px 容器 - 上下边框 */
  height: 26px;
  flex: none;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  /* 静止态隐藏步进（隐形态必须 pointer-events:none），hover/聚焦浮现 */
  opacity: 0;
  pointer-events: none;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out),
    opacity var(--dur-base) var(--ease-out);

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.number-input:hover .ni-step,
.number-input:focus-within .ni-step {
  opacity: 1;
  pointer-events: auto;
}

.ni-input {
  width: 56px;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  text-align: center;
  font-size: var(--text-sm);
  font-family: inherit;
  outline: none;

  &::placeholder {
    color: var(--text-tertiary);
  }
}

/* 空值态：占位符更弱，提示「此处可填」 */
.number-input.ni-empty .ni-input::placeholder {
  color: var(--text-tertiary);
  opacity: 0.7;
}
</style>
