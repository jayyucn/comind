<script setup lang="ts">
import { computed } from 'vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import type { Page } from '../../types/page'
import IdeasHistoryItem from './IdeasHistoryItem.vue'

const props = defineProps<{
  pages: Page[]
}>()

const itemSize = 300
const buffer = 5

const isEmpty = computed(() => props.pages.length === 0)
</script>

<template>
  <div class="history-list">
    <div class="history-sticky-header">历史 · 倒序</div>

    <RecycleScroller
      v-if="!isEmpty"
      class="history-scroller"
      :items="pages"
      :item-size="itemSize"
      :buffer="buffer"
      key-field="id"
    >
      <template #default="{ item }">
        <IdeasHistoryItem :page-id="item.id" />
      </template>
    </RecycleScroller>

    <div v-else class="empty-state">
      <div class="empty-text">暂无历史点滴</div>
    </div>
  </div>
</template>

<style scoped>
.history-list {
  flex: 0 0 40%;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border, #E7E5E4);
  overflow: hidden;
}

.history-sticky-header {
  position: sticky;
  top: 0;
  background: var(--bg-base, #F5F5F7);
  font-size: 10px;
  font-weight: 700;
  color: var(--text-secondary, #44403C);
  padding: 8px 12px;
  letter-spacing: 0.05em;
  z-index: 2;
  border-bottom: 1px solid var(--border, #E7E5E4);
  backdrop-filter: blur(4px);
}

.history-scroller {
  flex: 1;
  padding: 8px 12px;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.empty-text {
  font-size: 12px;
  color: var(--text-tertiary, #A8A29E);
}
</style>
