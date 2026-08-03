<script setup lang="ts">
import { computed } from 'vue'
import { usePageStore } from '../../stores/pages'
import BlockList from '../BlockList.vue'

const props = defineProps<{
  pageId: string
}>()

const pageStore = usePageStore()

const page = computed(() => pageStore.getPage(props.pageId))

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
  <div class="today-panel" v-if="page">
    <div class="today-card">
      <div class="today-header">
        <span class="today-badge">今天</span>
        <span class="today-date">{{ getMonthDay(page.title).month }}{{ getMonthDay(page.title).day }}日 {{ getWeekday(page.title) }}</span>
        <span class="today-label">可编辑</span>
      </div>
      <div class="today-body">
        <BlockList :page-id="pageId" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.today-panel {
  flex: 0 0 60%;
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow: hidden;
}

.today-card {
  background: #fff;
  border: 1px solid var(--accent-subtle, #C7D2FE);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.12);
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.today-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border, #E7E5E4);
  flex-shrink: 0;
}

.today-badge {
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--accent, #6366F1);
  padding: 3px 10px;
  border-radius: 6px;
  letter-spacing: 0.03em;
}

.today-date {
  font-size: 14px;
  font-weight: 600;
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
  overflow-y: auto;
  scrollbar-width: none;
}

.today-body::-webkit-scrollbar {
  display: none;
}
</style>
