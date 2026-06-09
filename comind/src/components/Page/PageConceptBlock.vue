<script setup lang="ts">
import { computed } from 'vue'
import { useBlockStore } from '../../stores/blocks'
import { useEditorStore } from '../../stores/editor'
import ConceptRender from '../Block/handlers/concept/ConceptRender.vue'

const props = defineProps<{
  pageId: string
}>()

const blockStore = useBlockStore()
const editorStore = useEditorStore()

// 查找当前页面的 concept 块
const conceptBlock = computed(() =>
  blockStore.blocks.find(b => b.pageId === props.pageId && b.type === 'concept')
)

function activateConcept() {
  if (conceptBlock.value) {
    editorStore.activateBlock(conceptBlock.value.id, 1)
  }
}
</script>

<template>
  <div v-if="conceptBlock" class="page-concept-block">
    <ConceptRender
      :block-id="conceptBlock.id"
      :content="conceptBlock.content"
      :properties="conceptBlock.properties"
      @content-click="activateConcept"
      @exit-edit="editorStore.deactivateBlock()"
    />
  </div>
</template>

<style scoped>
.page-concept-block {
  margin-bottom: 16px;
}
</style>
