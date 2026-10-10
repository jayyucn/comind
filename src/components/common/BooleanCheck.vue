<script setup lang="ts">
/**
 * 通用布尔编辑器 —— 与 DatePicker / NumberInput / TextField / EnumSelect 同构
 * （common/ 下、v-model 契约、28px 高度基线 + 渐进披露语言），是 boolean 字段的
 * 专属录入控件。
 *
 * 形态：内联「勾选图标」，无弹层（布尔不需要日历 / 选项面板）。icon 形态下值即
 * ✓ / ✗（与 `field-type-registry` 的 displayForm:'icon' 同语义）：
 * - true       → ✓（点亮，success 色）
 * - false      → ✗（secondary 色）
 * - undefined  → ghost 占位：虚线框 + 未点亮 ✓（与 chip 形态 ghost 一致的
 *   「点击即录入」交互语义，D21 决策 7）
 *
 * 接口（与 project 约定一致：不可变 update 事件）：
 * - v-model（modelValue: boolean | undefined / update:modelValue）：未填 = undefined
 *   （与 DatePicker / NumberInput / TextField 一致，且与 deleteFieldValue 的
 *   「无行即空」语义一致）。
 *
 * 切换语义（checkbox）：非 true（undefined / false）点击 → true；true 点击 → false。
 * 清除（回到 undefined）不在本控件承担——与 FieldValueEditor 的「是/否」单选同口径，
 * 上层需要删行语义时自行处理 undefined emit。
 *
 * 对外不可变 update 事件，与 project 约定一致。
 */
import { computed } from 'vue'

export type BooleanCheckValue = boolean | undefined

const props = withDefaults(
  defineProps<{
    /** 当前值；undefined = 未填。 */
    modelValue?: BooleanCheckValue
    /** 无障碍标签（缺省「布尔值」，建议传字段名）。 */
    ariaLabel?: string
  }>(),
  { modelValue: undefined, ariaLabel: '' },
)

const emit = defineEmits<{ 'update:modelValue': [value: BooleanCheckValue] }>()

const checked = computed(() => props.modelValue === true)
/** 无值态：ghost 占位（undefined / 非 boolean 入参一律视为未填）。 */
const empty = computed(() => props.modelValue !== true && props.modelValue !== false)

/** 点击切换：非 true → true，true → false（落库由上层处理）。 */
function toggle() {
  emit('update:modelValue', !checked.value)
}
</script>

<template>
  <button
    type="button"
    class="boolean-check"
    :class="{ 'bc-empty': empty, 'bc-checked': checked }"
    role="checkbox"
    :aria-checked="checked"
    :aria-label="ariaLabel || '布尔值'"
    :title="checked ? '是（点击切换为否）' : empty ? '未填（点击标记为是）' : '否（点击切换为是）'"
    data-testid="boolean-check"
    @click.stop="toggle"
  >
    {{ checked || empty ? '✓' : '✗' }}
  </button>
</template>

<style lang="scss" scoped>
.boolean-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 与 DatePicker / NumberInput / TextField / EnumSelect 共用 28px 高度基线（静止态对齐） */
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: var(--text-base);
  line-height: var(--leading-none);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);

  &:hover {
    background: var(--bg-hover);
    border-color: var(--border-color);
  }
}

/* 已勾选：点亮 */
.bc-checked {
  color: var(--success);
}

/* 否：可见但不抢眼 */
.boolean-check:not(.bc-checked):not(.bc-empty) {
  color: var(--text-secondary);
}

/* 无值 ghost：虚线示缺（与 chip 形态 ghost 同构），未点亮 ✓ 暗示「点击即录入」 */
.bc-empty {
  border-style: dashed;
  border-color: var(--border-color);
  color: var(--text-tertiary);
}
</style>
