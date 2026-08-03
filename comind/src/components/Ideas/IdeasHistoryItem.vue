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
      <span class="timeline-line" aria-hidden="true"></span>
      <span class="timeline-dot" aria-hidden="true"></span>
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
  background: transparent;
  padding: 0 12px 0 20px;
  /* margin-bottom: 10px; */
  display: flex;
  border-left: 1px solid var(--border, #E7E5E4);
  flex-direction: column;
}

.history-header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  flex-shrink: 0;
}

.timeline-dot {
  position: absolute;
  left: -24px;
  top: 12px;
  transform: translateY(-50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent, #6366F1);
  z-index: 1;
}

.timeline-line {
  position: absolute;
  left: -16px;
  top: 12px;
  bottom: 0;
  width: 15px;
  height: 1px;
  background: var(--border, #E7E5E4);
  z-index: 1;
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
