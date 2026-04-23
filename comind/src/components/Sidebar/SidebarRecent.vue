<script setup lang="ts">
import { useRecent } from '../../composables/useRecent'
import { usePageStore } from '../../stores/pages'
import PageItem from './PageItem.vue'

const emit = defineEmits<{
  navigate: [pageId: string]
}>()

const pageStore = usePageStore()
const { recentPages, isExpanded, toggleExpand } = useRecent()

function handleNavigate(pageId: string) {
  emit('navigate', pageId)
}
</script>

<template>
  <div class="recent-section">
    <div class="section-header" @click="toggleExpand">
      <span class="section-title">最近</span>
      <span class="expand-icon">{{ isExpanded ? '▲' : '▼' }}</span>
    </div>
    
    <div class="section-content">
      <PageItem
        v-for="page in recentPages"
        :key="page.id"
        :page="page"
        :active="pageStore.currentPageId === page.id"
        @click="handleNavigate(page.id)"
      />
      
      <div v-if="recentPages.length === 0" class="empty-text">
        暂无最近页面
      </div>
    </div>
  </div>
</template>

<style scoped>
.recent-section {
  padding: var(--space-2) 0;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  user-select: none;
}

.section-header:hover {
  background: var(--bg-hover);
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.expand-icon {
  font-size: 8px;
  color: var(--text-tertiary);
}

.section-content {
  padding: 0 var(--space-2);
}

.empty-text {
  padding: var(--space-2) var(--space-3);
  font-size: 12px;
  color: var(--text-tertiary);
  font-style: italic;
}
</style>