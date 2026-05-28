<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useRecent } from '../../composables/useRecent'
import { usePageStore } from '../../stores/pages'
import { ChevronUp, ChevronDown } from 'lucide-vue-next'
import PageItem from './PageItem.vue'

const router = useRouter()
const pageStore = usePageStore()
const { recentPages, isExpanded, toggleExpand } = useRecent()

function handleNavigate(pageId: string) {
  const page = pageStore.getPage(pageId)
  if (page?.type === 'journal') {
    router.push(`/journal/${page.title}`)
  } else {
    router.push(`/page/${pageId}`)
  }
}
</script>

<template>
  <div class="recent-section">
    <div class="section-header" @click="toggleExpand">
      <span class="section-title">最近</span>
      <span class="expand-icon">
        <ChevronUp v-if="isExpanded" :size="12" :stroke-width="2" />
        <ChevronDown v-else :size="12" :stroke-width="2" />
      </span>
    </div>

    <div v-show="isExpanded" class="section-content">
      <PageItem
        v-for="page in recentPages"
        :key="page.id"
        :page="page"
        :active="pageStore.currentPageId === page.id"
        @click="handleNavigate(page.id)"
      />

      <div v-if="recentPages.length === 0" class="empty-text">
        浏览页面后将显示在此处
      </div>
    </div>
  </div>
</template>

<style scoped>
.recent-section {
  padding: var(--space-1) 0;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  user-select: none;
  border-radius: 6px;
  margin: 0 var(--space-2);
  transition: background 80ms ease;
}

.section-header:hover {
  background: var(--bg-hover);
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--sidebar-text-hint);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  line-height: 1.4;
}

.expand-icon {
  display: flex;
  align-items: center;
  color: var(--sidebar-text-hint);
}

.section-content {
  padding: var(--space-1) var(--space-2);
}

.empty-text {
  padding: var(--space-2) var(--space-3);
  font-size: 12px;
  color: var(--sidebar-text-hint);
}
</style>