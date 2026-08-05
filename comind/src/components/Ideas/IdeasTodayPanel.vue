<script setup lang="ts">
import { computed } from 'vue'
import { usePageStore } from '../../stores/pages'
import BlockList from '../BlockList.vue'

const props = defineProps<{
  pageId: string
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
</script>

<template>
  <div class="today-panel">
    <div class="today-header">
      <span class="today-date">{{ getMonthDay(page?.title || '').month }}{{ getMonthDay(page?.title || '').day }}日 {{
        getWeekday(page?.title || '') }}</span>
    </div>
    <div class="today-card" v-if="pageId">
      <div class="today-body">
        <BlockList :page-id="pageId" />
      </div>
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

<style scoped>
.today-panel {
  flex:auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.today-card {
  background: transparent;
  padding-left: var(--space-4);
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.today-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 0 var(--space-4) var(--space-4);
  background: transparent;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border, #E7E5E4);
  box-shadow: var(--shadow-border-bottom);
}


.today-date {
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  color: var(--text-primary, #1C1917);
}

.today-label {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary, #A8A29E);
  letter-spacing: 0.04em;
}

.today-body {
  flex: 1;
  padding-top: var(--space-3);
  overflow-y: auto;
  scrollbar-width: none;
}

.today-body::-webkit-scrollbar {
  display: none;
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
