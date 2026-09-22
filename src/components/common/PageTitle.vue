<script setup lang="ts">
/**
 * 通用页面标题原语。
 * 统一各页面顶部标题样式：标题（h1）+ 可选副标题（标题下方次行）+ 右侧操作区插槽。
 * 规范：字号/字重用页面标题令牌（--font-size-page-title / --font-bold），
 * 副标题用三级文字色（--text-tertiary）。参考 PagesLibrary 的 .lib-title-container。
 */
defineProps<{
  /** 标题文本 */
  title: string
  /** 可选副标题，渲染在标题下方次行；为空则不渲染 */
  subtitle?: string
}>()
</script>

<template>
  <div class="page-title-container">
    <div class="page-title-text">
      <h1 class="page-title">
        {{ title }}
      </h1>
      <span
        v-if="subtitle"
        class="page-title-subtitle"
      >{{ subtitle }}</span>
    </div>
    <div
      v-if="$slots.actions"
      class="page-title-actions"
    >
      <slot name="actions" />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.page-title-container {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  // 标题整体向下移动半个 nav header 高度，避开顶部透明 sticky-header（窗口控制区）的重叠区
  padding: calc( var(--nav-height) / 2) var(--space-4) 0;
  gap: var(--space-2);
  flex-shrink: 0;
}

/* 标题 + 副标题竖排占位，操作区因此被推向最右 */
.page-title-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
}

.page-title {
  font-size: var(--font-size-page-title);
  font-weight: var(--font-bold);
  color: var(--text-primary);
  margin: 0;
  line-height: var(--leading-tight);
  white-space: nowrap;
}

.page-title-subtitle {
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}

/* 右侧操作区（搜索 / 按钮 / 布局切换等），有内容时推到最右 */
.page-title-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  // 顶部 sticky-header（整条 --nav-height 高、pointer-events: auto）是窗口拖拽面，
  // 落进它命中区里的控件点不动（实测 elementFromPoint 命中 HEADER）。标题/副标题非交互
  // 可以压在带内，操作区不行 —— 整体再让开半个高度，恰好落到拖拽带下沿。
  margin-top: calc(var(--nav-height) / 2);
}
</style>
