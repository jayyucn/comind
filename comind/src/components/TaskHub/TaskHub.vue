<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBlockCardStore } from '../../stores/blockCard'
import { useTaskViewStore } from '../../stores/taskView'
import { usePropertyStore } from '../../stores/property'
import { applyQuery } from '../../composables/useBlockQuery'
import type { BlockCard } from '../../wasm/types'
import type { BlockQuery } from '../../types/blockQuery'
import TaskViewBar from './TaskViewBar.vue'
import TableView from './views/TableView.vue'
import BoardView from './views/BoardView.vue'
import CalendarView from './views/CalendarView.vue'

const router = useRouter()
const blockCardStore = useBlockCardStore()
const taskViewStore = useTaskViewStore()
const propertyStore = usePropertyStore()

const filteredCards = ref<BlockCard[]>([])

const currentViewQuery = computed<BlockQuery>(() => {
  const view = taskViewStore.views.find(v => v.id === taskViewStore.currentViewId)
  if (!view) return { filters: [], sort: [], groupBy: null }
  try {
    return JSON.parse(view.query_json)
  } catch {
    return { filters: [], sort: [], groupBy: null }
  }
})

const currentViewType = computed(() => {
  const view = taskViewStore.views.find(v => v.id === taskViewStore.currentViewId)
  return view?.view_type ?? 'table'
})

async function refresh() {
  const cards = await blockCardStore.getCards()
  filteredCards.value = applyQuery(cards, currentViewQuery.value)
}

onMounted(async () => {
  await taskViewStore.load()
  await refresh()
})

// Re-run query when view changes
watch(() => taskViewStore.currentViewId, async () => {
  await refresh()
})

// Handle status change from child views
async function handleStatusChange(blockId: string, newStatus: string) {
  await propertyStore.setProperty(blockId, 'status', newStatus)
  await refresh()
}

// Navigate to source block
async function handleNavigateToBlock(blockId: string) {
  const card = blockCardStore.cards.find(c => c.block_id === blockId)
  if (!card) return
  // Navigate to page containing this block — beforeEnter handles data loading
  router.push(`/page/${card.page_id}`)
  // Emit event for page to scroll to block after mount
  window.dispatchEvent(new CustomEvent('navigate-to-block', { detail: { blockId } }))
}

function handleRefresh() {
  refresh()
}
</script>

<template>
  <div class="task-hub">
    <TaskViewBar
      :current-view-type="currentViewType"
      :views="taskViewStore.views"
      :current-view-id="taskViewStore.currentViewId ?? undefined"
      @refresh="handleRefresh"
    />
    <div class="task-hub-view">
      <TableView
        v-if="currentViewType === 'table'"
        :cards="filteredCards"
        :query="currentViewQuery"
        @status-change="handleStatusChange"
        @navigate-to-block="handleNavigateToBlock"
      />
      <BoardView
        v-else-if="currentViewType === 'board'"
        :cards="filteredCards"
        :query="currentViewQuery"
        @status-change="handleStatusChange"
        @navigate-to-block="handleNavigateToBlock"
      />
      <CalendarView
        v-else-if="currentViewType === 'calendar'"
        :cards="filteredCards"
        :query="currentViewQuery"
        @navigate-to-block="handleNavigateToBlock"
      />
      <div v-else class="task-hub-empty">
        <p>暂无可用的视图</p>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.task-hub {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.task-hub-view {
  flex: 1;
  overflow: auto;
}

.task-hub-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
</style>
