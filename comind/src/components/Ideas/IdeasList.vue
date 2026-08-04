<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { usePageStore } from '../../stores/pages'
import IdeasTodayPanel from './IdeasTodayPanel.vue'
import IdeasHistoryList from './IdeasHistoryList.vue'
import SlashCommandMenu from '../SlashCommandMenu.vue'
import PropertyQuickEditor from '../Block/PropertyQuickEditor.vue'
import PropertyEditor from '../Block/PropertyEditor.vue'
import type { Page } from '../../types/page'
import { useBlockStore } from '@/stores/blocks'

const pageStore = usePageStore()

const todayPage = ref<Page | null>(null)
const loadingToday = ref(true)

onMounted(async () => {
  try {
    todayPage.value = await pageStore.ensureTodayIdeasPage()
    const blockStore = useBlockStore()
    await blockStore.loadPageBlocks(todayPage.value.id)
  } finally {
    loadingToday.value = false
  }
})
</script>

<template>
  <div class="ideas-split-view">
    <!-- 今日面板：Rust 端幂等创建，保证一定存在；loading 期间显示加载态 -->
    <IdeasTodayPanel v-if="todayPage" :page-id="todayPage.id" />
    <div v-else-if="loadingToday" class="today-panel-placeholder"></div>

    <IdeasHistoryList />
  </div>

  <SlashCommandMenu />
  <PropertyQuickEditor />
  <PropertyEditor />
</template>

<style scoped>
.ideas-split-view {
  display: flex;
  height: calc(100vh - var(--nav-height));
  overflow: hidden;
  animation: fadeIn 200ms ease-out;
}

.today-panel-placeholder {
  flex: 0 0 60%;
  display: flex;
  align-items: center;
  justify-content: center;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}
</style>
