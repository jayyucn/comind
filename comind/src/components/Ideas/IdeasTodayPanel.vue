<script setup lang="ts">
import { useRelationshipMenu } from '@/composables/useRelationshipMenu'
import { computed } from 'vue'
import { usePageStore } from '../../stores/pages'
import BlockList from '../BlockList.vue'
import RelationshipMenu from '../RelationshipMenu.vue'
import BlockTaskList from './BlockTaskList.vue'
import PageTitle from '../common/PageTitle.vue'

const relMenu = useRelationshipMenu()


const props = defineProps<{
  pageId: string
}>()

const emit = defineEmits<{
  navigate: [pageId: string, pageTitle: string]
}>()

const pageStore = usePageStore()

const page = computed(() =>
  pageStore.getPage(props.pageId)
)

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

function handleNavigate(pageId: string, pageTitle: string) {
  emit('navigate', pageId, pageTitle)
}
</script>

<template>
  <div class="today-panel">
    <div class="today-card" v-if="pageId">
      <div class="today-header">
        <PageTitle :title="`${getMonthDay(page?.title || '').month}${getMonthDay(page?.title || '').day}日 ${getWeekday(page?.title || '')}`" />
      </div>
      <div class="today-body">
        <BlockList :page-id="pageId" />
      </div>
      <BlockTaskList @navigate="handleNavigate" />
      <RelationshipMenu :menu="relMenu" />

    </div>

    <div class="today-card is-loading" v-else>
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
</template>

<style lang="scss" scoped>
.today-panel {
  flex: auto;
  display: flex;
  flex-direction: column;
  padding: 0 var(--space-8);
  overflow: hidden;
  padding-right: var(--space-8);
}

.today-card {
  background: transparent;
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: auto;
}

.today-header {
  top: 0;
  display: flex;
  align-items: center;
  background: transparent;
}

.today-body {
  padding-top: var(--space-3);
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
</style>
