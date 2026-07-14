<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useFavorites } from '../../composables/useFavorites'
import { usePageStore } from '../../stores/pages'
import { ChevronUp, ChevronDown } from 'lucide-vue-next'
import PageItem from './PageItem.vue'
import PageItemMenu from './PageItemMenu.vue'
import { ref } from 'vue'

const router = useRouter()
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
        :active="pageStore.currentPageId === page.id"
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
  color: var(--sidebar-text-secondary);
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