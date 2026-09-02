<script setup lang="ts">
// 选区操作条（票 05 / ADR-0040 D7/D10）：选中正文文字后浮现于选区上方，
// 提供「高亮 / 写笔记（票 06 接管，预留禁用）/ 取消」。Teleport 到 body +
// var(--z-popover)（ADR-0032 浮层纪律）。容器 mousedown preventDefault：
// 点按钮不让浏览器清选区（选区是高亮 CFI 的来源）。
defineProps<{
  visible: boolean
  /** 视口坐标（选区矩形上方居中，由 ChapterContent 计算） */
  x: number
  y: number
}>()

const emit = defineEmits<{
  highlight: []
  cancel: []
}>()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="selection-toolbar"
      :style="{ left: `${x}px`, top: `${y}px` }"
      role="toolbar"
      aria-label="选区操作"
      @mousedown.prevent
    >
      <button class="toolbar-btn primary" title="高亮" @click="emit('highlight')">高亮</button>
      <button class="toolbar-btn" title="写笔记（即将上线）" disabled>写笔记</button>
      <button class="toolbar-btn" title="取消" @click="emit('cancel')">取消</button>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.selection-toolbar {
  position: fixed;
  // 以 (x,y) 为底边中点悬于选区上方
  transform: translate(-50%, calc(-100% - 8px));
  z-index: var(--z-popover);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-modal);
}

.toolbar-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  height: 26px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  transition: all 100ms ease;
  white-space: nowrap;

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.primary:hover {
    color: var(--accent);
  }

  &:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
}
</style>
