<script setup lang="ts">
defineProps<{
  visible: boolean
  sourceTitle: string
  targetTitle: string
}>()

const emit = defineEmits<{
  (e: 'merge'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="merge-overlay" @click.self="emit('cancel')">
        <div class="merge-dialog">
          <div class="merge-dialog-icon">⚡</div>
          <div class="merge-dialog-title">合并页面</div>
          <div class="merge-dialog-body">
            页面「<strong class="merge-highlight">{{ sourceTitle }}</strong>」已存在，
            合并后将把所有内容移入已有页面。
          </div>
          <div class="merge-dialog-actions">
            <button class="btn-cancel" @click="emit('cancel')">取消</button>
            <button class="btn-merge" @click="emit('merge')">合并</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.merge-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

.merge-dialog {
  background: var(--color-paper);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 28px var(--space-8);
  min-width: 360px;
  max-width: 420px;
  box-shadow: var(--shadow-modal);
}

.merge-dialog-icon {
  font-size: var(--text-sm);
  margin-bottom: var(--space-3);
}

.merge-dialog-title {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-ink);
  margin-bottom: var(--space-2);
}

.merge-dialog-body {
  font-size: var(--text-sm);
  color: var(--color-ink-secondary);
  line-height: 1.6;
  margin-bottom: var(--space-6);
}

.merge-highlight {
  color: var(--color-accent);
}

.merge-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-cancel {
  padding: 6px var(--space-4);
  background: transparent;
  color: var(--color-ink-secondary);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--text-xs);
  font-family: inherit;
  transition: background 120ms ease;
}

.btn-cancel:hover {
  background: rgba(0, 0, 0, 0.04);
}

.btn-merge {
  padding: 6px var(--space-4);
  background: var(--color-accent);
  color: var(--color-white);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--text-xs);
  font-family: inherit;
  transition: background 120ms ease;
}

.btn-merge:hover {
  background: var(--color-accent-deep);
}

/* 过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 180ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
