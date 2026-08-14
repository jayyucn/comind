<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBlockCardStore } from '../../stores/blockCard'
import { useTaskViewStore } from '../../stores/taskView'
import { usePropertyStore } from '../../stores/property'
import { applyQuery } from '../../composables/useBlockQuery'
import { getBlockRegistry, BLOCK_ENTITY } from '../../composables/useBlockQueryRegistry'
import { runBlockQuery } from '../../composables/useBlockQueryEngine'
import type { ViewQuery } from '../../core/query'
import type { BlockCard } from '../../wasm/types'
import type { BlockQuery } from '../../types/blockQuery'
import FilterBuilder from '../query/FilterBuilder.vue'
import TaskViewBar from './TaskViewBar.vue'
import TableView from './views/TableView.vue'
import BoardView from './views/BoardView.vue'
import CalendarView from './views/CalendarView.vue'

const router = useRouter()
const blockCardStore = useBlockCardStore()
const taskViewStore = useTaskViewStore()
const propertyStore = usePropertyStore()

// 通用查询引擎注册表（组合根单例，内置字段 + 自定义 property 已注册）
const registry = getBlockRegistry()

// 新引擎开关：默认关闭 → 旧 applyQuery 行为完全保留（并存期）
const useNewEngine = ref(false)
const viewQuery = ref<ViewQuery>({
  version: 1,
  filter: { combinator: 'and', children: [] },
  sort: [],
  groupBy: null,
})

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

// 显示列表：新引擎开启时经 runBlockQuery（evaluate + groupItems）完成筛选/排序/分组；
// 关闭时沿用旧 applyQuery（BlockQuery），行为不变。两者共享 blockCardStore.cards 数据源。
const filteredCards = computed<BlockCard[]>(() => {
  const cards = blockCardStore.cards
  if (useNewEngine.value) {
    return runBlockQuery(cards, viewQuery.value, registry, BLOCK_ENTITY).flatMap((g) => g.items)
  }
  return applyQuery(cards, currentViewQuery.value)
})

async function refresh() {
  // 仅确保卡片已加载；显示结果由 filteredCards computed 派生
  await blockCardStore.getCards()
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
    <div class="task-hub-engine-bar">
      <label class="engine-toggle">
        <input
          type="checkbox"
          :checked="useNewEngine"
          @change="useNewEngine = ($event.target as HTMLInputElement).checked"
        />
        新筛选引擎（通用查询）
      </label>
    </div>
    <div v-if="useNewEngine" class="task-hub-newfilter">
      <FilterBuilder :registry="registry" :entity-type="BLOCK_ENTITY" v-model="viewQuery" />
    </div>
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

.task-hub-engine-bar {
  display: flex;
  align-items: center;
  padding: 6px 16px;
  border-bottom: 1px solid var(--border-color, var(--app-split, #ddd));
  background: var(--bg-base2);
}

.engine-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs, 12px);
  color: var(--text-secondary, #444);
  cursor: pointer;
}

.task-hub-newfilter {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, var(--app-split, #ddd));
  background: var(--bg-base2);
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
