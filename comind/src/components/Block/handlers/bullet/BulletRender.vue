<script setup lang="ts">
import { computed } from 'vue'
import { useContentRenderer, parseHeading } from '../../../../composables/useContentRenderer'

const props = defineProps<{
  content: string
  showPlaceholder?: boolean
  blockId?: string
}>()

const emit = defineEmits<{
  (e: 'content-click', event: MouseEvent): void
}>()

const { renderContentToHtml } = useContentRenderer()

const heading = computed(() => parseHeading(props.content))

const headingTag = computed(() => {
  if (!heading.value) return null
  return `h${heading.value.level}` as const
})

const headingContent = computed(() => {
  if (!heading.value) return ''
  return renderContentToHtml(heading.value.title, props.blockId ?? '')
})

const normalContent = computed(() => {
  if (heading.value) return ''
  return renderContentToHtml(props.content, props.blockId ?? '')
})

function handleClick(e: MouseEvent) {
  emit('content-click', e)
}
</script>

<template>
  <div class="block-text" @click="handleClick">
    <span v-if="showPlaceholder && !content" class="block-placeholder">写点什么…</span>
    <component
      v-else-if="headingTag"
      :is="headingTag"
      :class="['block-heading', headingTag]"
      v-html="headingContent"
    ></component>
    <span v-else v-html="normalContent"></span>
  </div>
</template>