<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useFavorites } from '../../composables/useFavorites'
import { usePageStore } from '../../stores/pages'
import { ChevronUp, ChevronDown, X } from 'lucide-vue-next'
import PageItem from './PageItem.vue'

const router = useRouter()
const pageStore = usePageStore()
const { favoritePages, removeFavorite, isExpanded, toggleExpand } = useFavorites()

function handleNavigate(pageId: string) {
  const page = pageStore.getPage(pageId)
  if (page?.type === 'journal') {
    router.push(`/journal/${page.title}`)
  } else {
    router.push(`/page/${pageId}`)
  }
}

function handleRemoveFavorite(pageId: string, event: Event) {
  event.stopPropagation()
  removeFavorite(pageId)
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
      <div
        v-for="page in favoritePages"
        :key="page.id"
        class="favorite-item"
      >
        <PageItem
          :page="page"
          :active="pageStore.currentPageId === page.id"
          @click="handleNavigate(page.id)"
        >
          <template #suffix>
            <button
              class="remove-btn"
              title="取消收藏"
              @click="handleRemoveFavorite(page.id, $event)"
            >
              <X :size="12" :stroke-width="2" />
            </button>
          </template>
        </PageItem>
      </div>

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

.favorite-item {
  position: relative;
}

.favorite-item:hover .remove-btn {
  opacity: 1;
}

.remove-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--sidebar-text-hint);
  opacity: 0;
  transition: all 80ms ease;
  flex-shrink: 0;
}

.remove-btn:hover {
  background: #FEE2E2;
  color: #DC2626;
}

.empty-text {
  padding: var(--space-2) var(--space-3);
  font-size: 12px;
  color: var(--sidebar-text-hint);
}
</style>