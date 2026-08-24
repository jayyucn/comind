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
      <div v-if="visible" class="dialog-overlay" @click.self="emit('cancel')">
        <div class="dialog-card">
          <div class="dialog-title">{{ title }}</div>
          <div class="dialog-body">{{ message }}</div>
          <div class="dialog-actions">
            <button class="btn btn-cancel" @click="emit('cancel')">
              {{ cancelText || '取消' }}
            </button>
            <button
              class="btn btn-confirm"
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
</style>
