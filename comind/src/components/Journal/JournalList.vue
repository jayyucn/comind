<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useJournal } from '../../composables/useJournal'
import { usePageStore } from '../../stores/pages'
import JournalListItem from './JournalListItem.vue'
import SlashCommandMenu from '../SlashCommandMenu.vue'

const emit = defineEmits<{
  'open-page': [pageId: string]
}>()

const journal = useJournal()
const pageStore = usePageStore()

// 用于强制刷新的计数器
const refreshKey = ref(0)

// 所有日记（按日期倒序）
const allJournals = computed(() => {
  // 依赖refreshKey强制刷新
  refreshKey.value
  return pageStore.pages
    .filter(p => p.type === 'journal')
    .sort((a, b) => b.title.localeCompare(a.title))
})

// 确保今天的日记存在
onMounted(async () => {
  if (!journal.todayJournalExists.value) {
    await journal.ensureTodayJournalExists()
    await nextTick()
    refreshKey.value++
  }
})
</script>

<template>
  <div class="journal-list-view">
    <!-- 日记条目列表 -->
    <div class="journal-entries">
      <JournalListItem
        v-for="journalPage in allJournals"
        :key="journalPage.id"
        :page-id="journalPage.id"
        @open-page="emit('open-page', $event)"
      />

      <div v-if="allJournals.length === 0" class="empty-state">
        <div class="empty-icon">📅</div>
        <div class="empty-text">暂无日记</div>
      </div>
    </div>
  </div>

  <!-- SlashCommandMenu放在JournalList外层，确保页面只有一个实例 -->
  <SlashCommandMenu />
</template>

<style scoped>
.journal-list-view {
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
  padding: var(--space-8) 48px;
  box-sizing: border-box;
}

.journal-entries {
  display: flex;
  flex-direction: column;
}

.empty-state {
  text-align: center;
  padding: var(--space-8) 0;
  color: var(--text-secondary);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: var(--space-4);
}

.empty-text {
  font-size: 14px;
}
</style>