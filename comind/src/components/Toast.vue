<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { Info, X } from 'lucide-vue-next'

export interface ToastMessage {
  id: string
  message: string
  type?: 'info' | 'warning' | 'error'
}

defineProps<{
  visible: boolean
  messages: ToastMessage[]
}>()

const emit = defineEmits<{
  remove: [id: string]
}>()

function dismiss(id: string) {
  emit('remove', id)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="visible && messages.length > 0" class="toast-container">
        <div
          v-for="msg in messages"
          :key="msg.id"
          class="toast-item"
          :class="`toast-item--${msg.type || 'info'}`"
        >
          <Info :size="14" :stroke-width="2" />
          <span class="toast-message">{{ msg.message }}</span>
          <button class="toast-close" @click="dismiss(msg.id)">
            <X :size="12" :stroke-width="2" />
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  top: 60px;
  right: 20px;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toast-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--bg-base, #FAFAF8);
  border: 1px solid var(--border, #E7E5E4);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(28, 25, 23, 0.08);
  font-size: 13px;
  color: var(--text-primary);
  min-width: 240px;
  max-width: 360px;
}

.toast-item--info {
  border-left: 3px solid var(--accent);
}

.toast-item--warning {
  border-left: 3px solid #F59E0B;
}

.toast-item--error {
  border-left: 3px solid #EF4444;
}

.toast-message {
  flex: 1;
  line-height: 1.4;
}

.toast-close {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
  transition: background 0.12s;
}

.toast-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>
