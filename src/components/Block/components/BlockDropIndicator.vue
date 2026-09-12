<script setup lang="ts">
/**
 * BlockDropIndicator - 拖放指示器
 *
 * 职责：根据 useBlockDragDrop 提供的响应式 style/class/visible 渲染指示器 div。
 * 消除原 index.vue 中的 document.querySelector('.drop-indicator') + 直接 DOM 操作。
 *
 * 数据来源：useBlockDragDrop 的 indicatorStyle / indicatorClass / indicatorVisible。
 * 样式约定：
 * - 基础样式（position:fixed; pointer-events:none; z-index:var(--z-sidebar)）保持与原
 *   getOrCreateIndicator 内联 cssText 一致，确保替换前后视觉等价。
 * - .visible 类控制透明度切换（与原逻辑一致）。
 * - 所有放置意图共用同一种槽位形态（横线 + 左竖头，见 _block.scss 的 .drop-indicator）；
 *   目标深度由 useBlockDragDrop 通过内联 left/width 表达，cssClass 不再区分动作类型。
 */
const props = defineProps<{
  style: Record<string, string>
  cssClass: string
  visible: boolean
}>()
</script>

<template>
  <div
    v-show="visible"
    class="drop-indicator"
    :class="[cssClass, { visible }]"
    :style="style"
  />
</template>

<style scoped>
.drop-indicator {
  position: fixed;
  pointer-events: none;
  z-index: var(--z-sidebar);
  opacity: 0;
  transition: opacity 0ms;
}
.drop-indicator.visible {
  opacity: 1;
}
</style>
