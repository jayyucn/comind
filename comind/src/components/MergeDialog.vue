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
  background: rgba(28, 25, 23, 0.3);
  backdrop-filter: blur(4px);
}

.merge-dialog {
  background: #fffbf5;
  border: 1px solid #e8e0d4;
  border-radius: 12px;
  padding: 28px 32px;
  min-width: 360px;
  max-width: 420px;
  box-shadow: 0 8px 32px rgba(28, 25, 23, 0.12);
}

.merge-dialog-icon {
  font-size: 20px;
  margin-bottom: 12px;
}

.merge-dialog-title {
  font-family: 'Noto Sans SC', 'Geist', sans-serif;
  font-size: 16px;
  font-weight: 600;
  color: #1c1917;
  margin-bottom: 8px;
}

.merge-dialog-body {
  font-size: 14px;
  color: #57534e;
  line-height: 1.6;
  margin-bottom: 24px;
}

.merge-highlight {
  color: #b45309;
}

.merge-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-cancel {
  padding: 6px 16px;
  background: transparent;
  color: #57534e;
  border: 1px solid #d6d3d1;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  transition: background 120ms ease;
}

.btn-cancel:hover {
  background: rgba(0, 0, 0, 0.04);
}

.btn-merge {
  padding: 6px 16px;
  background: #b45309;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  transition: background 120ms ease;
}

.btn-merge:hover {
  background: #92400e;
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
