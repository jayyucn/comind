<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  /** 显示「今日不再提醒」复选框（通用能力，持久化由调用方处理）。 */
  showDontRemindToday?: boolean
  /** 隐藏取消按钮（用于纯提示型弹窗，如 alert）。 */
  hideCancel?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm', dontRemindToday: boolean): void
  (e: 'cancel'): void
}>()

const dontRemindToday = ref(false)

// 每次打开弹窗重置勾选状态，避免残留上一次的选择
watch(
  () => props.visible,
  (open) => {
    if (open) dontRemindToday.value = false
  }
)
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="dialog-overlay" @click.self="emit('cancel')">
        <div class="dialog-card">
          <div v-if="$slots.icon" class="dialog-icon"><slot name="icon" /></div>
          <div class="dialog-title">{{ title }}</div>
          <div class="dialog-body">
            <slot>{{ message }}</slot>
          </div>
          <label v-if="showDontRemindToday" class="dialog-dont-remind">
            <input type="checkbox" v-model="dontRemindToday" />
            <span>今日不再提醒</span>
          </label>
          <div class="dialog-actions">
            <button
              v-if="!hideCancel"
              class="btn btn-cancel"
              @click="emit('cancel')"
            >
              {{ cancelText || '取消' }}
            </button>
            <button
              class="btn btn-confirm"
              :class="{ danger }"
              @click="emit('confirm', dontRemindToday)"
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
