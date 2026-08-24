<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { useRecent } from '../../composables/useRecent'
import { usePageStore } from '../../stores/pages'
import { ChevronUp, ChevronDown } from 'lucide-vue-next'
import PageItem from './PageItem.vue'
import PageItemMenu from './PageItemMenu.vue'
import { ref } from 'vue'

const router = useRouter()
const route = useRoute()
const pageStore = usePageStore()
const { recentPages, isExpanded, toggleExpand } = useRecent()

const renamingPageId = ref<string | null>(null)

function handleNavigate(pageId: string) {
  if (renamingPageId.value === pageId) return
  const page = pageStore.getPage(pageId)
  if (page?.type === 'ideas') {
    router.push(`/ideas/${page.title}`)
  } else {
    router.push(`/page/${pageId}`)
  }
}

function handleStartRename(pageId: string) {
  const page = pageStore.getPage(pageId)
  if (page?.type === 'ideas') return
  renamingPageId.value = pageId
}

function handleRename(pageId: string, newTitle: string) {
  pageStore.renamePage(pageId, newTitle)
  renamingPageId.value = null
}

function handleCancelRename() {
  renamingPageId.value = null
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
        :active="(route.name === 'page' || route.name === 'ideas-page') && pageStore.currentPageId === page.id"
        :is-renaming="renamingPageId === page.id"
        @click="handleNavigate(page.id)"
        @rename="(newTitle) => handleRename(page.id, newTitle)"
        @cancel-rename="handleCancelRename"
      >
        <template #suffix>
          <PageItemMenu
            :page="page"
            @rename="handleStartRename(page.id)"
          />
        </template>
      </PageItem>

      <div v-if="recentPages.length === 0" class="empty-text">
        浏览页面后将显示在此处
      </div>
    </div>
  </div>
</template>

<style scoped>
.recent-section {
  padding: 0;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
}

.section-header:hover .section-title {
  color: var(--text-secondary);
}

.section-title {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--text-tertiary);
  line-height: var(--leading-snug);
  transition: color 80ms ease;
}

.expand-icon {
  display: flex;
  align-items: center;
  color: var(--text-tertiary);
}

.section-content {
  padding: 0 4px;
}

.empty-text {
  padding: 6px 10px;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
</style>
