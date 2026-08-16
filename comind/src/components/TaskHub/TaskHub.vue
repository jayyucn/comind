<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBlockCardStore } from '../../stores/blockCard'
import { useTaskViewStore, parseViewQuery } from '../../stores/taskView'
import { usePropertyStore } from '../../stores/property'
import { runBlockQuery } from '../../composables/useBlockQueryEngine'
import { getBlockRegistry, BLOCK_ENTITY } from '../../composables/useBlockQueryRegistry'
import type { ViewQuery } from '../../core/query'
import type { BlockCard } from '../../wasm/types'
import PageTitle from '../common/PageTitle.vue'
import QueryToolbar from '../query/QueryToolbar.vue'
import QueryChipBar from '../query/QueryChipBar.vue'
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
// 实体级字段 schema 只需取一次（同实体所有记录共用）
const blockRefFields = registry.list(BLOCK_ENTITY)

// 当前激活视图的查询（ViewQuery）。芯片变更即写回 taskViewStore（命名视图持久化）。
const viewQuery = ref<ViewQuery>({
  version: 1,
  filter: { combinator: 'and', children: [] },
  sort: [],
  groupBy: null,
})
const searchQuery = ref('')

// 芯片行显隐（Filter 按钮切换展开/收起）
const chipBarVisible = ref(false)
const chipBarRef = ref<InstanceType<typeof QueryChipBar> | null>(null)

const currentViewType = computed(() => {
  const view = taskViewStore.views.find((v) => v.id === taskViewStore.currentViewId)
  return view?.view_type ?? 'table'
})

// Header 三按钮激活态（供 QueryToolbar 描边；与 PagesLibrary 同源）
const hasFilter = computed(() => viewQuery.value.filter.children.length > 0)
const hasSort = computed(() => viewQuery.value.sort.length > 0)
const hasGroup = computed(() => viewQuery.value.groupBy !== null)

// Header 三按钮处理：统一转发给 QueryChipBar.openToolbarMenu（芯片行显隐/菜单策略内聚其中）
function openChipMenu(kind: 'filter' | 'sort' | 'group', e: MouseEvent) {
  chipBarRef.value?.openToolbarMenu(kind, e.currentTarget as HTMLElement)
}

// 加载当前激活视图的查询（兼容存量旧 BlockQuery → ViewQuery 迁移）
function loadActiveView() {
  const view = taskViewStore.views.find((v) => v.id === taskViewStore.currentViewId)
  viewQuery.value = view ? parseViewQuery(view.query_json) : {
    version: 1,
    filter: { combinator: 'and', children: [] },
    sort: [],
    groupBy: null,
  }
  searchQuery.value = ''
}

// 芯片/搜索变更：更新本地 viewQuery 并持久化到当前激活视图
function onQueryUpdate(q: ViewQuery) {
  viewQuery.value = q
  const view = taskViewStore.views.find((v) => v.id === taskViewStore.currentViewId)
  if (!view) return
  void taskViewStore.update(
    view.id,
    view.name,
    JSON.stringify(q),
    view.view_type,
    '',
    view.is_default === 1,
    view.sort_order,
  )
}

// 搜索（父侧子串过滤，与 PagesLibrary 对 title 过滤同构）
const searchedCards = computed<BlockCard[]>(() => {
  const cards = blockCardStore.cards
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return cards
  return cards.filter((c) => (c.content_preview ?? '').toLowerCase().includes(q))
})

// 统一引擎：过滤 + 排序 + 分组一步到位
const groups = computed(() =>
  runBlockQuery(searchedCards.value, viewQuery.value, registry, BLOCK_ENTITY),
)
const flatCards = computed<BlockCard[]>(() => groups.value.flatMap((g) => g.items))
const grouped = computed(() => viewQuery.value.groupBy !== null)

async function refresh() {
  await blockCardStore.getCards()
}

onMounted(async () => {
  await taskViewStore.load()
  await refresh()
  loadActiveView()
})

// 切换视图：重新加载该视图的查询
watch(() => taskViewStore.currentViewId, () => loadActiveView())

// Handle status change from child views
async function handleStatusChange(blockId: string, newStatus: string) {
  await propertyStore.setProperty(blockId, 'status', newStatus)
  await refresh()
}

// Navigate to source block
async function handleNavigateToBlock(blockId: string) {
  const card = blockCardStore.cards.find((c) => c.block_id === blockId)
  if (!card) return
  router.push(`/page/${card.page_id}`)
  window.dispatchEvent(new CustomEvent('navigate-to-block', { detail: { blockId } }))
}

function handleRefresh() {
  refresh()
}
</script>

<template>
  <div class="task-hub">
    <PageTitle title="任务中心" :subtitle="`${flatCards.length} 个任务`" />

    <!-- 视图管理：命名视图切换 / 类型切换 / 保存 / 重命名 / 删除 / 设为默认 -->
    <TaskViewBar
      :current-view-type="currentViewType"
      :views="taskViewStore.views"
      :current-view-id="taskViewStore.currentViewId ?? undefined"
      @refresh="handleRefresh"
    />

    <!-- 查询工具条：筛选 / 排序 / 分组 三按钮 + 搜索（与 PagesLibrary 一致） -->
    <header class="lib-header">
      <div class="header-actions">
        <QueryToolbar
          v-model="searchQuery"
          :has-filter="hasFilter"
          :has-sort="hasSort"
          :has-group="hasGroup"
          :chip-bar-visible="chipBarVisible"
          @filter="openChipMenu('filter', $event)"
          @sort="openChipMenu('sort', $event)"
          @group="openChipMenu('group', $event)"
        />
      </div>
    </header>

    <!-- 筛选芯片行（QueryToolbar 三按钮唤起；显隐/菜单策略内聚于 QueryChipBar） -->
    <QueryChipBar
      ref="chipBarRef"
      v-model="viewQuery"
      :fields="blockRefFields"
      :registry="registry"
      :entity-type="BLOCK_ENTITY"
      @visible-change="chipBarVisible = $event"
      @update:model-value="onQueryUpdate"
    />

    <!-- 主内容区 -->
    <main class="lib-body">
      <TableView
        v-if="currentViewType === 'table'"
        :cards="flatCards"
        :groups="groups"
        :grouped="grouped"
        :sort="viewQuery.sort"
        @status-change="handleStatusChange"
        @navigate-to-block="handleNavigateToBlock"
      />
      <BoardView
        v-else-if="currentViewType === 'board'"
        :cards="flatCards"
        @status-change="handleStatusChange"
        @navigate-to-block="handleNavigateToBlock"
      />
      <CalendarView
        v-else-if="currentViewType === 'calendar'"
        :cards="flatCards"
        @navigate-to-block="handleNavigateToBlock"
      />
      <div v-else class="task-hub-empty">
        <p>暂无可用的视图</p>
      </div>
    </main>
  </div>
</template>

<style lang="scss" scoped>
.task-hub {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  padding: 0 var(--space-8);
}

.lib-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 10px 0 4px;
  margin: 0 var(--space-4);
  border-bottom: 1px solid var(--border);
  gap: 16px;
  flex-shrink: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.lib-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px;
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
