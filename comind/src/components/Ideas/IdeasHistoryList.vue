<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { format } from 'date-fns'
import type { Page } from '../../types/page'
import IdeasHistoryItem from './IdeasHistoryItem.vue'
import MonthPicker from '../MonthPicker.vue'

const props = defineProps<{
  pages: Page[]
}>()

const MAX_LENGTH = 31
const currentMonth = format(new Date(), 'yyyy-MM')
const selectedMonth = ref(currentMonth)

// 历史数据首次到达时，若当前月无记录，跳到最近有记录的月份
let monthInitialized = false
watch(
  () => props.pages,
  (pages) => {
    if (monthInitialized || pages.length === 0) return
    monthInitialized = true
    const hasCurrent = pages.some(p => p.title.startsWith(currentMonth))
    if (!hasCurrent) {
      selectedMonth.value = pages[0].title.slice(0, 7)
    }
  },
  { immediate: true }
)

const filteredPages = computed(() => {
  return props.pages
    .filter(p => p.title.startsWith(selectedMonth.value))
    .slice(0, MAX_LENGTH)
})

const isEmpty = computed(() => filteredPages.value.length === 0)

// 所有点滴页对应的 yyyy-MM 集合，供 MonthPicker 标记有数据的月份
const monthsWithData = computed(() => {
  return Array.from(new Set(props.pages.map(p => p.title.slice(0, 7))))
})
</script>

<template>
  <div class="history-list">
    <div class="history-sticky-header">
      <MonthPicker v-model="selectedMonth" :months-with-data="monthsWithData" />
    </div>

    <div v-if="!isEmpty" class="history-scroller">
      <IdeasHistoryItem v-for="page in filteredPages" :key="page.id" :page-id="page.id" />
    </div>

    <div v-else class="empty-state">
      <div class="empty-text">该月份暂无历史点滴</div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.history-list {
  flex: 0 0 40%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.history-sticky-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: sticky;
  top: 0;
  background: var(--bg-base, #F5F5F7);
  padding: 8px 12px;
  z-index: 2;
  border-bottom: 1px solid var(--border, #E7E5E4);
  backdrop-filter: blur(4px);
}

.history-scroller {
  flex: 1;
  overflow-y: auto;
  background: var(--bg-base, #F5F5F7);
  padding: 0 12px 0 20px;
  position: relative;
}



.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.empty-text {
  font-size: 12px;
  color: var(--text-tertiary, #A8A29E);
}
</style>
