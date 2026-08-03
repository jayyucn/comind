<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '../../stores/blocks'
import { useIdeas } from '../../composables/useIdeas'
import IdeasTodayPanel from './IdeasTodayPanel.vue'
import IdeasHistoryList from './IdeasHistoryList.vue'
import SlashCommandMenu from '../SlashCommandMenu.vue'
import PropertyQuickEditor from '../Block/PropertyQuickEditor.vue'
import PropertyEditor from '../Block/PropertyEditor.vue'

const pageStore = usePageStore()
const blockStore = useBlockStore()
const { ideasPages, isTodayTitle } = useIdeas()

const todayPage = computed(() => {
  return ideasPages.value.find(p => isTodayTitle(p.title))
})

const historyPages = computed(() => {
  return ideasPages.value
    .filter(p => !isTodayTitle(p.title))
    .sort((a, b) => b.title.localeCompare(a.title))
})

onMounted(async () => {
  await pageStore.loadAllPages()

  const ideasPageIds = pageStore.pages
    .filter(p => p.type === 'ideas')
    .map(p => p.id)

  if (ideasPageIds.length > 0) {
    await blockStore.loadMultiPageBlocks(ideasPageIds)
  }
})
</script>

<template>
  <div class="ideas-split-view">
    <IdeasTodayPanel v-if="todayPage" :page-id="todayPage.id" />
    <IdeasHistoryList :pages="historyPages" />
  </div>

  <SlashCommandMenu />
  <PropertyQuickEditor />
  <PropertyEditor />
</template>

<style scoped>
.ideas-split-view {
  display: flex;
  height: 100%;
  overflow: hidden;
}
</style>
