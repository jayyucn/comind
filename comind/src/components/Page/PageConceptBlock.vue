<script setup lang="ts">
import { computed } from 'vue'
import { useBlockStore } from '../../stores/blocks'
import { useEditorStore } from '../../stores/editor'
import { usePropertyStore } from '../../stores/property'
import ConceptRender from '../Block/handlers/concept/ConceptRender.vue'

const props = defineProps<{
  pageId: string
}>()

const blockStore = useBlockStore()
const editorStore = useEditorStore()
const propertyStore = usePropertyStore()

const conceptBlock = computed(() =>
  blockStore.blocks.find(b => b.pageId === props.pageId && b.type === 'concept')
)

function getBlockPropertiesMap(): Record<string, any> {
  if (!conceptBlock.value) return {}
  const props = propertyStore.getBlockProperties(conceptBlock.value.id)
  const result: Record<string, any> = {}
  for (const prop of props) {
    result[prop.key] = prop.value
  }
  return result
}

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
      :properties="getBlockPropertiesMap()"
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
