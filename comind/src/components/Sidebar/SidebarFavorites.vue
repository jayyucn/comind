<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useFavorites } from '../../composables/useFavorites'
import { usePageStore } from '../../stores/pages'
import PageItem from './PageItem.vue'

const emit = defineEmits<{
  'add-favorite': []
}>()

const router = useRouter()
const pageStore = usePageStore()
const { favoritePages, removeFavorite } = useFavorites()

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
    <div class="section-header">
      <span class="section-title">收藏</span>
      <button class="add-btn" title="添加收藏" @click="emit('add-favorite')">
        +
      </button>
    </div>
    
    <div class="section-content">
      <div
        v-for="page in favoritePages"
        :key="page.id"
        class="favorite-item"
      >
        <PageItem
          :page="page"
          :active="pageStore.currentPageId === page.id"
          @click="handleNavigate(page.id)"
        />
        <button 
          class="remove-btn" 
          title="取消收藏"
          @click="handleRemoveFavorite(page.id, $event)"
        >
          ×
        </button>
      </div>
      
      <div v-if="favoritePages.length === 0" class="empty-text">
        暂无收藏，点击 + 添加
      </div>
    </div>
  </div>
</template>

<style scoped>
.favorites-section {
  padding: var(--space-2) 0;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.add-btn {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--text-tertiary);
  font-size: 16px;
  line-height: 1;
  transition: all 80ms ease;
}

.add-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.section-content {
  padding: 0 var(--space-2);
}

.favorite-item {
  position: relative;
  display: flex;
  align-items: center;
}

.favorite-item:hover .remove-btn {
  opacity: 1;
}

.remove-btn {
  position: absolute;
  right: 4px;
  width: 18px;
  height: 18px;
  border: none;
  background: var(--bg-hover);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--text-tertiary);
  font-size: 14px;
  line-height: 1;
  opacity: 0;
  transition: all 80ms ease;
}

.remove-btn:hover {
  background: #FEE2E2;
  color: #DC2626;
}

.empty-text {
  padding: var(--space-2) var(--space-3);
  font-size: 12px;
  color: var(--text-tertiary);
  font-style: italic;
}
</style>