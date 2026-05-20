<script setup lang="ts">
defineProps<{
  visible: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="confirm-overlay" @click.self="emit('cancel')">
        <div class="confirm-dialog">
          <div class="confirm-title">{{ title }}</div>
          <div class="confirm-message">{{ message }}</div>
          <div class="confirm-actions">
            <button class="btn-cancel" @click="emit('cancel')">
              {{ cancelText || '取消' }}
            </button>
            <button
              class="btn-confirm"
              :class="{ danger }"
              @click="emit('confirm')"
            >
              {{ confirmText || '确认' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

.confirm-dialog {
  background: var(--color-paper);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px;
  min-width: 320px;
  max-width: 400px;
  box-shadow: var(--shadow-modal);
}

.confirm-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-ink);
  margin-bottom: 8px;
}

.confirm-message {
  font-size: var(--text-sm);
  color: var(--color-ink-secondary);
  line-height: 1.6;
  margin-bottom: 20px;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-cancel {
  padding: 6px 16px;
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

.btn-confirm {
  padding: 6px 16px;
  background: var(--color-accent);
  color: var(--color-white);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--text-xs);
  font-family: inherit;
  transition: background 120ms ease;
}

.btn-confirm:hover {
  background: var(--color-accent-deep);
}

.btn-confirm.danger {
  background: var(--error);
}

.btn-confirm.danger:hover {
  background: #b91c1c;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 180ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
