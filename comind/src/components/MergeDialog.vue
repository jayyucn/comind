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
      <div v-if="visible" class="dialog-overlay" @click.self="emit('cancel')">
        <div class="dialog-card">
          <div class="dialog-icon">⚡</div>
          <div class="dialog-title">合并页面</div>
          <div class="dialog-body">
            页面「<strong class="dialog-highlight">{{ sourceTitle }}</strong>」已存在，
            合并后将把所有内容移入已有页面。
          </div>
          <div class="dialog-actions">
            <button class="btn btn-cancel" @click="emit('cancel')">取消</button>
            <button class="btn btn-confirm" @click="emit('merge')">合并</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
</style>
