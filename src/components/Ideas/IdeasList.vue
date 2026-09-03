<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '@/stores/blocks'
import { useRelationshipMenu } from '@/composables/useRelationshipMenu'
import BlockList from '../BlockList.vue'
import PageTitle from '../common/PageTitle.vue'
import RelationshipMenu from '../RelationshipMenu.vue'
import IdeasHistoryList from './IdeasHistoryList.vue'
import SlashCommandMenu from '../SlashCommandMenu.vue'
import PropertyQuickEditor from '../Block/PropertyQuickEditor.vue'
import PropertyEditor from '../Block/PropertyEditor.vue'
import type { Page } from '../../types/page'

defineOptions({ name: 'IdeasList' })

const pageStore = usePageStore()
const relMenu = useRelationshipMenu()

const todayPage = ref<Page | null>(null)
const loadingToday = ref(true)

onMounted(async () => {
  try {
    todayPage.value = await pageStore.ensureTodayIdeasPage()
    await useBlockStore().ensurePageBlocks(todayPage.value.id)
  } finally {
    loadingToday.value = false
  }
})

function getWeekday(dateStr: string): string {
  const date = new Date(dateStr)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return weekdays[date.getDay()]
}

function getMonthDay(dateStr: string): { month: string; day: string } {
  const date = new Date(dateStr)
  return {
    month: `${date.getMonth() + 1}月`,
    day: `${date.getDate()}`,
  }
}

const todayTitle = computed(() => {
  const title = todayPage.value?.title || ''
  const { month, day } = getMonthDay(title)
  return `${month}${day}日 ${getWeekday(title)}`
})
</script>

<template>
  <div class="ideas-page-root">
    <div class="ideas-split-view">
      <!-- 今日面板：Rust 端幂等创建，保证一定存在；loading 期间显示骨架屏 -->
      <div class="today-panel">
        <div v-if="todayPage" class="today-card">
          <div class="today-header">
            <PageTitle :title="todayTitle" />
          </div>
          <div class="today-body">
            <BlockList :page-id="todayPage.id" />
          </div>
          <RelationshipMenu :menu="relMenu" />
        </div>
        <div v-else-if="loadingToday" class="today-card is-loading">
          <div class="skeleton-header">
            <div class="skeleton-badge"></div>
            <div class="skeleton-date"></div>
          </div>
          <div class="skeleton-body">
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
            <div class="skeleton-line"></div>
          </div>
        </div>
      </div>

      <IdeasHistoryList />
    </div>
  </div>

  <SlashCommandMenu />
  <PropertyQuickEditor />
  <PropertyEditor />
</template>

<style lang="scss" scoped>
.ideas-page-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.ideas-split-view {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  animation: fadeIn 200ms ease-out;
}

.today-panel {
  flex: auto;
  display: flex;
  flex-direction: column;
  padding: 0 0 0 var(--space-8);
  overflow: hidden;
  overflow-y: auto;
}

.today-card {
  background: transparent;
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: visible;
  margin-right: var(--space-8);
}

.today-header {
  top: 0;
  display: flex;
  align-items: center;
  background: transparent;
}

.today-body {
  padding-top: var(--space-3);
  min-height: 40vh;
  /* 填满 today-card 剩余高度：BlockList 撑满整个 body（内容少时留白区可双击建块） */
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* BlockList 填满 today-body */
.today-body :deep(.block-list) {
  flex: 1;
}

.today-card.is-loading {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.skeleton-header {
  display: flex;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border, #E7E5E4);
}

.skeleton-badge {
  width: 50px;
  height: 20px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 6px;
}

.skeleton-date {
  width: 120px;
  height: 16px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}

.skeleton-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-line {
  height: 10px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 3px;
}

.skeleton-line.short {
  width: 60%;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }

  100% {
    background-position: -200% 0;
  }
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
