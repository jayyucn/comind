<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useJournal } from '../../composables/useJournal'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '../../stores/blocks'
import JournalListItem from './JournalListItem.vue'
import SlashCommandMenu from '../SlashCommandMenu.vue'
import PropertyQuickEditor from '../Block/PropertyQuickEditor.vue'
import PropertyEditor from '../Block/PropertyEditor.vue'
import { Icon } from '../Icons'

const router = useRouter()
const journal = useJournal()
const pageStore = usePageStore()
const blockStore = useBlockStore()

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

// 确保今天的日记存在（先从 IDB 加载 pages，避免重复创建）
// 然后加载所有 journal page 的 blocks
onMounted(async () => {
  await pageStore.loadAllPages()
  if (!journal.todayJournalExists.value) {
    await journal.ensureTodayJournalExists()
    await nextTick()
    refreshKey.value++
  }

  // 加载所有 journal page 的 blocks 到 blockStore
  const journalIds = pageStore.pages
    .filter(p => p.type === 'journal')
    .map(p => p.id)
  if (journalIds.length > 0) {
    await blockStore.loadMultiPageBlocks(journalIds)
  }
})

function handleOpenPage(pageId: string) {
  const page = pageStore.getPage(pageId)
  if (page?.type === 'journal') {
    router.push(`/journal/${page.title}`)
  } else {
    router.push(`/page/${pageId}`)
  }
}
</script>

<template>
  <div class="journal-list-view">
    <!-- 日记条目列表 -->
    <div class="journal-entries">
      <JournalListItem
        v-for="journalPage in allJournals"
        :key="journalPage.id"
        :page-id="journalPage.id"
        @open-page="handleOpenPage"
      />

      <div v-if="allJournals.length === 0" class="empty-state">
        <div class="empty-icon">
          <Icon name="icon-calendar" :size="40" color="var(--text-tertiary)" />
        </div>
        <div class="empty-text">暂无日记</div>
      </div>
    </div>
  </div>

  <!-- SlashCommandMenu和PropertyQuickEditor、PropertyEditor放在JournalList外层，确保页面只有一个实例 -->
  <SlashCommandMenu />
  <PropertyQuickEditor />
  <PropertyEditor />
</template>

<style scoped>
.journal-list-view {
  max-width: var(--max-width);
  width: 100%;
  margin: 0 auto;
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