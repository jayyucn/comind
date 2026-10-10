<script setup lang="ts">
/**
 * 特化文本编辑器（issue T6）—— email / phone 等带格式校验的单行文本。
 *
 * 与 TextField 同契约（字段值家族一致，可直接互换）：
 * - v-model（modelValue: string | undefined）：undefined = 未填（上层删行）。
 * - 28px 高度基线 + 渐进披露（清除 × hover 浮现）。
 * - 失焦 / 回车提交；trim 后为空 → emit undefined。
 *
 * 特化差异：提交前经 `field-type-registry` 的特化校验（查 spec 单源）——
 * 校验失败在输入框下方出红字提示（var(--error)），且**不 emit**（回车不落库）。
 */
import { computed, ref, watch } from 'vue'
import { stringSpecialization } from '../../types/field-type-registry'

export type SpecializedTextValue = string | undefined

const props = withDefaults(
  defineProps<{
    /** 当前值；undefined = 未填。 */
    modelValue?: SpecializedTextValue
    /** 特化种类（email / phone ...），决定校验规则（查 STRING_SPECIALIZATIONS 单源）。 */
    spec: string
    /** 空值占位符。 */
    placeholder?: string
    /** 无障碍标签（缺省用 placeholder）。 */
    ariaLabel?: string
  }>(),
  { modelValue: undefined, placeholder: '输入文本', ariaLabel: '' },
)

const emit = defineEmits<{ 'update:modelValue': [value: SpecializedTextValue] }>()

const draft = ref<string>(props.modelValue ?? '')
const focused = ref(false)
/** 校验失败文案；null = 无错。 */
const error = ref<string | null>(null)

const validate = computed(() => stringSpecialization(props.spec)?.validate)
const hasValue = computed(() => draft.value.trim().length > 0)

/** 失焦 / 回车：空 → undefined（删行）；校验失败 → 红字提示且不 emit；合法 → 提交。 */
function commit() {
  const trimmed = draft.value.trim()
  if (trimmed === '') {
    error.value = null
    if (props.modelValue !== undefined) emit('update:modelValue', undefined)
    return
  }
  const message = validate.value?.(trimmed) ?? null
  if (message) {
    error.value = message
    return
  }
  error.value = null
  if (trimmed === props.modelValue) return
  emit('update:modelValue', trimmed)
}

function onInput(e: Event) {
  draft.value = (e.target as HTMLInputElement).value
  // 重新输入即清错（错误提示只在提交时判定，不打字过程中实时纠错）
  error.value = null
}

function clearValue() {
  draft.value = ''
  error.value = null
  emit('update:modelValue', undefined)
}

// 外部值变化（非聚焦态）同步到草稿，避免打字时被回写覆盖（与 TextField 同构）。
watch(
  () => props.modelValue,
  (v) => {
    if (!focused.value) draft.value = v ?? ''
  },
)

// 测试钩子：暴露语义原子（commit / clearValue），绕过 jsdom 合成事件的不确定性。
defineExpose({ commit: () => commit(), clearValue })
</script>

<template>
  <span class="spec-text">
    <span
      class="spec-text-field"
      :class="{ 'st-invalid': !!error, 'st-focused': focused }"
    >
      <input
        class="st-input"
        type="text"
        :value="draft"
        :placeholder="placeholder"
        :aria-label="ariaLabel || placeholder || '文本'"
        :aria-invalid="!!error"
        data-testid="st-input"
        @input="onInput"
        @focus="focused = true"
        @blur="focused = false; commit()"
        @keydown.enter.prevent="commit"
      >
      <span
        v-if="hasValue"
        class="st-clear"
        title="清除"
        role="button"
        tabindex="-1"
        data-testid="st-clear"
        @click.stop="clearValue"
      >×</span>
    </span>
    <!-- 校验失败提示：红字（var(--error) token），出现在编辑器下方 -->
    <span
      v-if="error"
      class="st-error"
      data-testid="st-error"
    >{{ error }}</span>
  </span>
</template>

<style lang="scss" scoped>
.spec-text {
  display: inline-flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 80px;
}

/* 28px 高度基线：与 TextField / DatePicker / NumberInput / EnumSelect 对齐（静止态） */
.spec-text-field {
  display: inline-flex;
  align-items: center;
  position: relative;
  height: 28px;
  background: transparent;
  border-radius: var(--radius-sm);
  transition: background-color var(--dur-base) var(--ease-out);

  &:hover {
    background: var(--bg-hover);
  }

  &.st-focused {
    background: var(--bg-active);
  }

  /* 校验失败：错误态底色信号（保持行内，不弹层） */
  &.st-invalid {
    background: var(--error-08, rgba(239, 68, 68, 0.08));
  }
}

.st-input {
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

.st-clear {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  font-size: 14px;
  line-height: 1;
  padding: 0 6px 0 2px;
  border-radius: 4px;
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

.spec-text:hover .st-clear,
.spec-text-field:focus-within .st-clear,
.st-clear:hover {
  opacity: 1;
  transform: translateX(0) scale(1);
  pointer-events: auto;
}

/* 校验失败红字提示：编辑器下方，字号取最小档不抢行高 */
.st-error {
  margin-top: 1px;
  padding-left: 8px;
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--error);
}
</style>
