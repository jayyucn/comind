<script setup lang="ts">
import { ref } from 'vue'
import { useBlockStore } from '../../../../stores/blocks'

const props = defineProps<{
  blockId: string
  /** 是否存在保存失败（由父组件从 blockStore.saveErrors 派生，本组件不读 store 状态） */
  saveError: boolean
}>()

const emit = defineEmits<{
  (e: 'retry'): void
}>()

const blockStore = useBlockStore()
const retrying = ref(false)

async function handleRetry() {
  if (retrying.value) return
  retrying.value = true
  try {
    await blockStore.retrySave(props.blockId)
  } finally {
    retrying.value = false
  }
  emit('retry')
}
</script>

<template>
  <span
    v-if="saveError"
    class="save-error-dot"
    :class="{ 'save-error-dot--retrying': retrying }"
    @click.stop="handleRetry"
    title="保存失败，点击重试"
  ></span>
</template>
