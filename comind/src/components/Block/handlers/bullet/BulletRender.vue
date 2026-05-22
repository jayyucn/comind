<script setup lang="ts">
import { useContentRenderer } from '../../../../composables/useContentRenderer'

const props = defineProps<{
  content: string
  showPlaceholder?: boolean
}>()

const emit = defineEmits<{
  (e: 'content-click', event: MouseEvent): void
}>()

const { renderContentToHtml } = useContentRenderer()

function handleClick(e: MouseEvent) {
  emit('content-click', e)
}
</script>

<template>
  <div class="block-text" @click="handleClick">
    <span v-if="showPlaceholder && !content" class="block-placeholder">Type something...</span>
    <span v-else v-html="renderContentToHtml(content)"></span>
  </div>
</template>