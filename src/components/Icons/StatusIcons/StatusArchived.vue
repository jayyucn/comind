<script setup lang="ts">
/**
 * 任务状态图标 · 已归档（V2 实心徽章）。语法：24×24 网格 + 填充容器(18%) + 中心符号。
 * 符号随容器变化：圆形容器本身不是「盒子」，需画出盒子；方形容器即盒子，只留向下归档箭头。
 * 默认方形 24。
 */
withDefaults(defineProps<{
  size?: number | string
  color?: string
  strokeWidth?: number | string
  shape?: 'round' | 'square'
}>(), {
  size: 24,
  color: 'currentColor',
  strokeWidth: 2,
  shape: 'square',
})
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    :stroke="color"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle v-if="shape === 'round'" cx="12" cy="12" r="9" :fill="color" fill-opacity="0.18" stroke="none" />
    <rect v-else x="3" y="3" width="18" height="18" rx="5" :fill="color" fill-opacity="0.18" stroke="none" />
    <template v-if="shape === 'round'">
      <path d="M12 8v2.6 M10.4 9.8l1.6 1.5 1.6-1.5" />
      <rect x="8.5" y="13" width="7" height="4.3" rx="1" />
    </template>
    <template v-else>
      <path d="M12 8v5 M9.5 10.5L12 13l2.5-2.5" />
    </template>
  </svg>
</template>
