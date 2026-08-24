<script setup lang="ts">
/**
 * 通用页面标题原语。
 * 统一各页面顶部标题样式：标题（h1）+ 可选副标题（同行右侧）+ 右侧操作区插槽。
 * 规范：字号/字重用页面标题令牌（--font-size-page-title / --font-bold），
 * 副标题用三级文字色（--text-tertiary）。参考 PagesLibrary 的 .lib-title-container。
 */
defineProps<{
  /** 标题文本 */
  title: string
  /** 可选副标题，渲染在标题同行右侧；为空则不渲染 */
  subtitle?: string
}>()
</script>

<template>
  <div class="page-title-container">
    <h1 class="page-title">{{ title }}</h1>
    <span v-if="subtitle" class="page-title-subtitle">{{ subtitle }}</span>
    <div v-if="$slots.actions" class="page-title-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.page-title-container {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  padding: var(--space-2) var(--space-4) 0;
  gap: var(--space-2);
  flex-shrink: 0;
}

.page-title {
  font-size: var(--font-size-page-title);
  font-weight: var(--font-bold);
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
}

.page-title-subtitle {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}

/* 右侧操作区（搜索 / 按钮 / 布局切换等），有内容时推到最右 */
.page-title-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
