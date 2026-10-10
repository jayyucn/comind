<script setup lang="ts">
/**
 * 通用评分编辑器（issue T7 AC4）——与 NumberInput / DatePicker 同构
 * （common/ 下、v-model 契约、undefined = 未填），是 number 特化 spec='rating'
 * 字段的专属录入控件。
 *
 * 形态：1–N 星内联行（lucide-vue-next Star 图标，实心/空心），无弹层。
 *
 * 交互契约：
 * - 点击第 i 颗星 → 置值 i；
 * - 再次点击当前值所在星 → 清空（emit undefined，上层据此删值行）；
 * - 点击其它星 → 改值。
 *
 * 尺寸：28px 高度基线（与 NumberInput / DatePicker 触发器一致，静止态行内对齐）。
 * 样式：一律 var(--*) token。
 */
import { Star } from 'lucide-vue-next'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 当前评分；undefined = 未填。 */
    modelValue?: number
    /** 星数上限 N；默认 5。 */
    max?: number
    /** 无障碍标签。 */
    ariaLabel?: string
  }>(),
  { modelValue: undefined, max: 5, ariaLabel: '' },
)

const emit = defineEmits<{ 'update:modelValue': [value: number | undefined] }>()

/** 星序号 1..N（渲染上限做下界保护，非法 max 回落 5）。 */
const starCount = computed(() => (Number.isInteger(props.max) && props.max >= 1 ? props.max : 5))

/** 当前值越界（> N 或 < 1）按未填渲染。 */
const litCount = computed(() => {
  const v = props.modelValue
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > starCount.value) return 0
  return Math.floor(v)
})

function pick(i: number) {
  emit('update:modelValue', props.modelValue === i ? undefined : i)
}
</script>

<template>
  <span
    class="rating-input"
    :class="{ 'rating-input--empty': litCount === 0 }"
    role="group"
    :aria-label="ariaLabel || '评分'"
  >
    <button
      v-for="i in starCount"
      :key="i"
      type="button"
      class="rating-star-btn"
      :aria-label="`${i} 星`"
      @click="pick(i)"
    >
      <Star
        :size="16"
        class="rating-star"
        :class="{ 'rating-star--lit': i <= litCount }"
      />
    </button>
  </span>
</template>

<style lang="scss" scoped>
.rating-input {
  display: inline-flex;
  align-items: center;
  /* 28px 基线：与 NumberInput / DatePicker 触发器共用（静止态行内对齐） */
  height: 28px;
  gap: 2px;
}

.rating-star-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-tertiary);
  transition: color var(--dur-fast) var(--ease-out);

  &:hover {
    color: var(--text-secondary);
  }

  &:focus-visible {
    outline: 1px solid var(--accent);
    border-radius: var(--radius-sm);
  }
}

/* 实心星：强调色填充 + 同色描边（lucide 默认 fill=none，CSS fill 覆盖） */
.rating-star--lit {
  color: var(--accent);
  fill: currentColor;
}
</style>
