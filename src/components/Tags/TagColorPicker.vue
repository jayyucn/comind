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
import { Ban } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import { TAG_COLORS, isTagColorToken, tagDotStyle } from '../../utils/tag-color';
import BasePopover from '../common/BasePopover.vue';

const props = defineProps<{
  /** 当前色（调色板 token 名）；空串 / 非法值 = 无色 */
  value: string
  /** 只读（系统标签） */
  readonly?: boolean
  /** 内联模式：直接渲染选色面板（不弹窗），用于标签管理面板（ADR-0050 D14） */
  inline?: boolean
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
  <!-- 内联模式（ADR-0050 D14）：直接渲染选色面板，不弹窗，嵌入管理面板 -->
  <div
    v-if="inline && !readonly"
    class="tag-color-panel"
  >
    <div class="tag-color-grid">
      <button
        type="button"
        class="tag-color-swatch tag-color-swatch--none"
        :class="{ 'tag-color-swatch--active': !selected }"
        aria-label="无色"
        title="无色"
        :aria-pressed="!selected"
        @click="choose(null)"
      >
        <Ban :size="20" />
      </button>
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
  <!-- 内联 + 只读：静态色点（系统标签无写入口） -->
  <span
    v-else-if="inline && readonly"
    class="tag-color-trigger tag-color-trigger--readonly"
    :class="{ 'tag-color-trigger--empty': !selected }"
    :style="dotStyle"
    aria-hidden="true"
  />

  <!-- 弹窗模式（聚合页标题区沿用） -->
  <template v-else>
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
        <div class="tag-color-grid">
          <button
            type="button"
            class="tag-color-swatch tag-color-swatch--none"
            :class="{ 'tag-color-swatch--active': !selected }"
            aria-label="无色"
            title="无色"
            :aria-pressed="!selected"
            @click="choose(null)"
          >
            <Ban :size="20" />
          </button>
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

/* 面板只含一行色点：宽度自适应内容，不换行 */
.tag-color-panel {
  padding: var(--space-1);
  width: max-content;
}

.tag-color-grid {
  display: flex;
  flex-wrap: nowrap;
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

/* 无色档：空心环 + Ban 图标居中，观感与色点一致 */
.tag-color-swatch--none {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border-strong);
}

/* 选中环用 outline：任何底色上都可见，且不参与布局（不会把色点挤小） */
.tag-color-swatch--active {
  outline: 2px solid var(--text-primary);
  outline-offset: 1px;
}
</style>
