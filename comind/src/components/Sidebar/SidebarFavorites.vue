<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { useFavorites } from '../../composables/useFavorites'
import { usePageStore } from '../../stores/pages'
import { ChevronUp, ChevronDown } from 'lucide-vue-next'
import PageItem from './PageItem.vue'
import PageItemMenu from './PageItemMenu.vue'
import { ref } from 'vue'

const router = useRouter()
const route = useRoute()
const pageStore = usePageStore()
const { favoritePages, isExpanded, toggleExpand } = useFavorites()

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
  <div class="favorites-section">
    <div class="section-header" @click="toggleExpand">
      <span class="section-title">收藏</span>
      <span class="expand-icon">
        <ChevronUp v-if="isExpanded" :size="12" :stroke-width="2" />
        <ChevronDown v-else :size="12" :stroke-width="2" />
      </span>
    </div>

    <div v-show="isExpanded" class="section-content">
      <PageItem
        v-for="page in favoritePages"
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

      <div v-if="favoritePages.length === 0" class="empty-text">
        暂无收藏页面
      </div>
    </div>
  </div>
</template>

<style scoped>
.favorites-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}

.section-header:hover .section-title {
  color: var(--text-secondary);
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  line-height: 1.4;
  transition: color 80ms ease;
}

.expand-icon {
  display: flex;
  align-items: center;
  color: var(--text-tertiary);
}

.section-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.section-content::-webkit-scrollbar {
  width: 4px;
}

.section-content::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}

.section-content::-webkit-scrollbar-track {
  background: transparent;
}

.empty-text {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
