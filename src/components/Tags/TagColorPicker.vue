<script setup lang="ts">
/**
 * 标签色选色器（ADR-0050 D11 身份三要素之三 / D12）。
 *
 * 两处挂载（标签管理页右栏 / 聚合页标题区）共用，组件**不持有真相** —— 只 emit `pick`
 * （`null` = 无色），落库由调用方经 `tagsStore.setIdentity` 收口（身份可多入口、同一份
 * 数据同一组原语），避免出现第二份状态。
 *
 * 系统标签只读（D5「系统标签右栏只读」延伸至此）：Rust 侧 `reject_system_tag` 已拒写，
 * UI 若照给可点入口就是「点了没反应且无提示」的静默失败 —— 故只读时不渲染可点元素，
 * 只留一个不可交互的色点。
 */
import { computed, ref } from 'vue'
import { TAG_COLORS, isTagColorToken, tagDotStyle } from '../../utils/tag-color'
import BasePopover from '../common/BasePopover.vue'

const props = defineProps<{
  /** 当前色（调色板 token 名）；空串 / 非法值 = 无色 */
  value: string
  /** 只读（系统标签） */
  readonly?: boolean
}>()

const emit = defineEmits<{
  /** `null` = 选了「无色」；调用方据此发空串（D11：空串是有效值，不是「未改」） */
  pick: [color: string | null]
}>()

const open = ref(false)
const triggerEl = ref<HTMLElement | null>(null)

/** 存储值可能是空串、也可能是未白名单的历史值 → 统一收敛成「无色」。 */
const selected = computed(() => (isTagColorToken(props.value) ? props.value : null))

/** 色点内联样式（无色时不带背景，由 CSS 给空心环）。 */
const dotStyle = computed(() => tagDotStyle(selected.value))

function choose(token: string | null) {
  open.value = false
  // 点自己当前那一色不落库：省掉一次无意义的写与 store 重读
  if (token === selected.value) return
  emit('pick', token)
}
</script>

<template>
  <button
    v-if="!readonly"
    ref="triggerEl"
    type="button"
    class="tag-color-trigger"
    :class="{ 'tag-color-trigger--empty': !selected, 'tag-color-trigger--open': open }"
    :style="dotStyle"
    :aria-label="selected ? '更改标签颜色' : '设置标签颜色'"
    :title="selected ? '更改标签颜色' : '设置标签颜色'"
    @click="open = !open"
  />
  <span
    v-else
    class="tag-color-trigger tag-color-trigger--readonly"
    :class="{ 'tag-color-trigger--empty': !selected }"
    :style="dotStyle"
    aria-hidden="true"
  />

  <BasePopover
    :visible="open"
    :anchor-el="triggerEl"
    @close="open = false"
  >
    <div class="tag-color-panel">
      <button
        type="button"
        class="tag-color-none"
        :class="{ 'tag-color-none--active': !selected }"
        @click="choose(null)"
      >
        无色
      </button>
      <div class="tag-color-grid">
        <button
          v-for="option in TAG_COLORS"
          :key="option.token"
          type="button"
          class="tag-color-swatch"
          :class="{ 'tag-color-swatch--active': option.token === selected }"
          :style="{ background: `var(${option.token})` }"
          :aria-label="option.label"
          :title="option.label"
          :aria-pressed="option.token === selected"
          @click="choose(option.token)"
        />
      </div>
    </div>
  </BasePopover>
</template>

<style lang="scss" scoped>
.tag-color-trigger {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 50%;
  cursor: pointer;
}

/* 无色：空心环 —— 与「有色实心点」一眼可分 */
.tag-color-trigger--empty {
  border-color: var(--border-strong);
  background: transparent;
}

.tag-color-trigger--open {
  box-shadow: 0 0 0 3px var(--accent-10);
}

.tag-color-trigger--readonly {
  cursor: default;
}

.tag-color-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 168px;
}

.tag-color-none {
  padding: var(--space-1) var(--space-2);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.tag-color-none:hover {
  background: var(--bg-hover);
}

.tag-color-none--active {
  color: var(--accent);
}

.tag-color-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.tag-color-swatch {
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
}

/* 选中环用 outline：任何底色上都可见，且不参与布局（不会把色点挤小） */
.tag-color-swatch--active {
  outline: 2px solid var(--text-primary);
  outline-offset: 1px;
}
</style>
