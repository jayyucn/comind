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
  <div class="history-item" v-if="page">
    <div class="history-header">
      <span class="history-date">{{ getMonthDay(page.title).month }}{{ getMonthDay(page.title).day }}日</span>
      <span class="history-weekday">{{ getWeekday(page.title) }}</span>
    </div>
    <div class="history-body">
      <BlockList :page-id="pageId" />
    </div>
  </div>
</template>

<style scoped>
.history-item {
  background: #fff;
  border: 1px solid var(--border, #E7E5E4);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
}

.history-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border, #E7E5E4);
  flex-shrink: 0;
}

.history-date {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #1C1917);
}

.history-weekday {
  font-size: 10px;
  color: var(--text-tertiary, #A8A29E);
}

.history-body {
  flex: 1;
  overflow: hidden;
}
</style>
