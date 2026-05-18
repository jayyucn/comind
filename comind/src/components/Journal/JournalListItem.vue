<script setup lang="ts">
import { computed } from 'vue'
import { useJournal } from '../../composables/useJournal'
import { usePageStore } from '../../stores/pages'
import BlockList from '../BlockList.vue'
import Backlinks from '../Backlinks.vue'

const props = defineProps<{
  pageId: string
}>()

const emit = defineEmits<{
  'open-page': [pageId: string]
}>()

const journal = useJournal()
const pageStore = usePageStore()

const page = computed(() => pageStore.getPage(props.pageId))

function getWeekday(dateStr: string): string {
  const date = new Date(dateStr)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return weekdays[date.getDay()]
}

function openPage() {
  emit('open-page', props.pageId)
}
</script>

<template>
  <div class="journal-list-item" :class="{ 'is-today': page?.title === journal.today.value }">
    <!-- 日期标题（点击跳转独立页面，不可编辑） -->
    <header
      class="entry-header"
      @click="openPage"
    >
      <span class="entry-icon">📅</span>
      <span class="entry-date">{{ page?.title }}</span>
      <span class="entry-weekday">{{ getWeekday(page?.title || '') }}</span>
      <span v-if="page?.title === journal.today.value" class="today-badge">今天</span>
    </header>

    <!-- 内容区 -->
    <div class="entry-content">
      <BlockList :page-id="pageId" />

      <div class="block-list-footer">
        <Backlinks :page-id="pageId" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.journal-list-item {
  width: 100%;
  padding-bottom: var(--space-6);
  margin-bottom: var(--space-6);
  border-bottom: 1px solid var(--border);
}

.journal-list-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
  margin-bottom: 0;
}

.journal-list-item.is-today .entry-header {
  color: var(--accent);
}

.entry-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-bottom: var(--space-4);
  cursor: pointer;
  transition: opacity 80ms;
}

.entry-header:hover {
  opacity: 0.8;
}

.entry-icon {
  font-size: 16px;
}

.entry-date {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.entry-weekday {
  font-size: 13px;
  color: var(--text-secondary);
}

.today-badge {
  font-size: 12px;
  padding: 2px 8px;
  background: var(--accent);
  color: white;
  border-radius: 10px;
  margin-left: auto;
}

.entry-content {
  padding: 0;
  display: flex;
  flex-direction: column;
  min-height: 400px;
}

.block-list-footer {
  padding-top: var(--space-4);
  margin-top: auto;
}

.block-list-footer > :deep(.backlinks-panel) {
  padding-top: var(--space-4);
}
</style>