<script setup lang="ts">
/**
 * 通用文本编辑器 —— 与 DatePicker / NumberInput / EnumSelect 同构（common/ 下、
 * v-model 契约、28px 高度基线 + 渐进披露语言），是纯 string（自由文本）字段的
 * 专属录入控件。
 *
 * 形态：内联「单行文本输入框 + 清除 ×」，无弹层（自由文本不需要日历 / 选项面板）。
 *
 * 接口（与 project 约定一致：不可变 update 事件）：
 * - v-model（modelValue: string | undefined / update:modelValue）：未填 = undefined
 *   （与 DatePicker / NumberInput / EnumSelect 一致，且与 deleteFieldValue 的
 *   「无行即空」语义一致）。
 * - placeholder：空值占位符。
 *
 * 提交语义（ADR 字段值家族统一）：
 * - 失焦（blur）或回车（Enter）：解析后提交（trim 后为空 → emit undefined）。
 * - 清空输入框 → emit undefined（上层据此删值行）。
 * - 清除 × 按钮：hover 浮现，点击 emit undefined。
 *
 * 对外不可变 update 事件，与 project 约定一致。
 */
import { computed, nextTick, ref, watch } from 'vue'

export type TextFieldValue = string | undefined

const props = withDefaults(
  defineProps<{
    /** 当前值；undefined = 未填。 */
    modelValue?: TextFieldValue
    /** 空值占位符。 */
    placeholder?: string
    /** 无障碍标签（缺省用 placeholder）。 */
    ariaLabel?: string
    /** 最大输入长度（可选）。 */
    maxlength?: number
  }>(),
  { modelValue: undefined, placeholder: '输入文本', ariaLabel: '', maxlength: undefined },
)

const emit = defineEmits<{ 'update:modelValue': [value: TextFieldValue] }>()

const draft = ref<string>(props.modelValue ?? '')
const focused = ref(false)

/** 是否有值（非空串）。清除 × 仅在有时显示。 */
const hasValue = computed(() => draft.value.trim().length > 0)

/** 失焦 / 回车：trim 后为空 → undefined（删行）；否则提交 trim 后的原文。 */
function commit() {
  const trimmed = draft.value.trim()
  if (trimmed === '') {
    if (props.modelValue !== undefined) emit('update:modelValue', undefined)
    return
  }
  if (trimmed === props.modelValue) return
  emit('update:modelValue', trimmed)
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

/** 清除：emit undefined，上层据此删值行（「无行即空」语义）。 */
function clearValue() {
  draft.value = ''
  emit('update:modelValue', undefined)
  nextTick(() => void (inputEl.value as HTMLInputElement | null)?.focus())
}

const inputEl = ref<HTMLInputElement | null>(null)

// 外部值变化（非聚焦态）同步到草稿，避免打字时被回写覆盖。
watch(
  () => props.modelValue,
  (v) => {
    if (!focused.value) draft.value = v ?? ''
  },
)

// 测试钩子：暴露语义原子（commit / clearValue），绕过 jsdom 合成事件的不确定性。
// 不参与生产交互。
defineExpose({ commit: () => commit(), clearValue })
</script>

<template>
  <span
    class="text-field"
    :class="{ 'tf-empty': !hasValue, 'tf-focused': focused }"
  >
    <input
      ref="inputEl"
      class="tf-input"
      type="text"
      :value="draft"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :aria-label="ariaLabel || placeholder || '文本'"
      data-testid="tf-input"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown.enter.prevent="commit"
    >
    <span
      v-if="hasValue"
      class="tf-clear"
      title="清除"
      role="button"
      tabindex="-1"
      data-testid="tf-clear"
      @click.stop="clearValue"
    >×</span>
  </span>
</template>

<style lang="scss" scoped>
.text-field {
  display: inline-flex;
  align-items: center;
  position: relative;
  /* 与 DatePicker / NumberInput / EnumSelect 共用 28px 高度基线（静止态对齐） */
  height: 28px;
  flex: 1 1 auto;
  min-width: 80px;
  background: transparent;
  border-radius: var(--radius-sm);
  /* 切换动效：无边框，hover/focus 时背景柔和浮起作为聚焦态信号 */
  transition: background-color var(--dur-base) var(--ease-out);

  &:hover {
    background: var(--bg-hover);
  }

  &:focus-within {
    background: var(--bg-active);
  }
}

.tf-input {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
  padding: 0 8px;
  outline: none;

  &::placeholder {
    color: var(--text-tertiary);
  }
}

.tf-clear {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  font-size: 14px;
  line-height: 1;
  padding: 0 6px 0 2px;
  border-radius: 4px;
  /* 渐进披露（与 dp-/es-/ni- 同构）：隐形态必须 pointer-events:none；
     切换动效：opacity + 轻微滑入缩放，浮现时柔和不跳动 */
  opacity: 0;
  transform: translateX(4px) scale(0.85);
  pointer-events: none;
  transition: opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);

  &:hover {
    color: var(--error);
    background: var(--bg-hover);
  }
}

.text-field:hover .tf-clear,
.text-field:focus-within .tf-clear,
.tf-clear:hover {
  opacity: 1;
  transform: translateX(0) scale(1);
  pointer-events: auto;
}
</style>
