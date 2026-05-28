<script setup lang="ts">
import { computed } from 'vue'
import { useJournal } from '../../composables/useJournal'
import { usePageStore } from '../../stores/pages'
import BlockList from '../BlockList.vue'
import Backlinks from '../Backlinks.vue'
import { TaskIcon } from '../Icons'
import { FilePen } from 'lucide-vue-next'

const props = defineProps<{
  pageId: string
}>()

const emit = defineEmits<{
  'open-page': [pageId: string]
}>()

const journal = useJournal()
const pageStore = usePageStore()

const page = computed(() => pageStore.getPage(props.pageId))
const isToday = computed(() => page.value?.title === journal.today.value)

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

function openPage() {
  emit('open-page', props.pageId)
}
</script>

<template>
  <div class="journal-entry" :class="{ 'is-today': isToday }" v-if="page">
    <div class="entry-date-card" @click="openPage">
      <div class="date-left">
        <div class="date-icon-box">
          <TaskIcon name="icon-calendar" :size="18" :color="isToday ? 'var(--accent)' : 'var(--text-tertiary)'" />
        </div>
        <div class="date-divider"></div>
        <div class="date-text">
          <span class="date-month-day">{{ getMonthDay(page.title).month }}{{ getMonthDay(page.title).day }}日</span>
          <span class="date-weekday">{{ getWeekday(page.title || '') }}</span>
        </div>
      </div>
      <div class="date-right">
        <span v-if="isToday" class="today-tag">今天</span>
        <span class="entry-chevron"><FilePen /></span>
      </div>
    </div>

    <div class="entry-body">
      <BlockList :page-id="pageId" />
      <div class="entry-footer">
        <Backlinks :page-id="pageId" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.journal-entry {
  position: relative;
  padding: var(--space-5) 0;
  margin-bottom: var(--space-4);
}

.entry-date-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-4);
  margin-bottom: var(--space-4);
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
  transition: opacity 120ms ease;
}

.entry-date-card:hover {
  opacity: 0.75;
}

.date-left {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.date-icon-box {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--accent-06);
  flex-shrink: 0;
}

.is-today .date-icon-box {
  background: var(--accent-subtle);
}

.date-divider {
  width: 1px;
  height: 20px;
  background: var(--border);
}

.date-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.date-month-day {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}

.date-weekday {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.3;
}

.date-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
}

.today-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  line-height: 1.4;
}

.entry-chevron {
  font-size: 14px;
  color: var(--text-tertiary);
  transition: transform 160ms ease;
}

.entry-date-card:hover .entry-chevron {
  transform: translateX(3px);
  color: var(--accent);
}

.entry-body {
  padding: 0;
  display: flex;
  flex-direction: column;
  min-height: 360px;
}

.entry-footer {
  padding-top: var(--space-4);
  margin-top: auto;
}

.entry-footer > :deep(.backlinks-panel) {
  padding-top: var(--space-4);
}
</style>