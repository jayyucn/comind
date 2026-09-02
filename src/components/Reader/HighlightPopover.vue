<script setup lang="ts">
// 高亮点击浮层（票 05 / ADR-0040 D7/D10）：点击已有高亮文字时浮现于点击处，
// 提供「删除 / 写笔记（票 06 接管，预留禁用）」。删除仅删高亮行，不删关联
// Block（Block 独立可读，跨端承诺）。Teleport 到 body + var(--z-popover)
// （ADR-0032 浮层纪律）。点浮层外关闭（与 TypographyPanel 同一模式）。
import { onBeforeUnmount, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  /** 视口坐标（点击处） */
  x: number
  y: number
}>()

const emit = defineEmits<{
  remove: []
  close: []
}>()

/** 点浮层外关闭 */
function onDocMouseDown(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  if (!target) return
  if (target.closest('.highlight-popover')) return
  emit('close')
}

watch(
  () => props.visible,
  visible => {
    if (visible) document.addEventListener('mousedown', onDocMouseDown)
    else document.removeEventListener('mousedown', onDocMouseDown)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="highlight-popover"
      :style="{ left: `${x}px`, top: `${y}px` }"
      role="dialog"
      aria-label="高亮操作"
    >
      <button class="popover-btn" title="写笔记（即将上线）" disabled>写笔记</button>
      <button class="popover-btn danger" title="删除高亮" @click="emit('remove')">删除</button>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.highlight-popover {
  position: fixed;
  // 悬于点击处右下方，避免遮住被点的高亮文字
  transform: translate(8px, 8px);
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

.popover-btn {
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

  &.danger:hover {
    color: var(--color-error, #d93025);
  }

  &:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
}
</style>
