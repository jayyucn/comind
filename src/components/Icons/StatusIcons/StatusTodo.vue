<script setup lang="ts">
/** 任务状态图标 · 待办（V2 实心徽章）。语法：24×24 网格 + 填充容器(18%) + 中心符号。默认方形 24。 */
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
  </svg>
</template>
