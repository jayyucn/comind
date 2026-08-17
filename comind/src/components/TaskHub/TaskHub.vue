<script setup lang="ts">
import type { PropertyValue } from '@/types/property'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { runBlockQuery } from '../../composables/useBlockQueryEngine'
import { BLOCK_ENTITY, getBlockRegistry } from '../../composables/useBlockQueryRegistry'
import type { ViewQuery } from '../../core/query'
import { defaultLayoutConfig, parseLayoutConfig, type TableConfig, type BoardConfig, type CalendarConfig } from '../../core/view'
import { useBlockCardStore } from '../../stores/blockCard'
import { usePropertyStore } from '../../stores/property'
import { useScreenViewStore } from '../../stores/screenView'
import type { BlockCard } from '../../wasm/types'
import PageTitle from '../common/PageTitle.vue'
import TaskViewBar from './TaskViewBar.vue'
import BoardView from '../views/BoardView.vue'
import CalendarView from '../views/CalendarView.vue'
import TableView from '../views/TableView.vue'

const router = useRouter()
const blockCardStore = useBlockCardStore()
const screenViewStore = useScreenViewStore()
const propertyStore = usePropertyStore()

// 通用查询引擎注册表（组合根单例，内置字段 + 自定义 property 已注册）
const registry = getBlockRegistry()
// 实体级字段 schema 只需取一次（同实体所有记录共用）
const blockRefFields = registry.list(BLOCK_ENTITY)

// 当前激活视图的查询（ViewQuery）。芯片变更即写回 screenViewStore（命名视图持久化）。
const viewQuery = ref<ViewQuery>({
  version: 1,
  filter: { combinator: 'and', children: [] },
  sort: [],
  groupBy: null,
})
const searchQuery = ref('')

const currentViewType = computed(() => {
  const view = screenViewStore.views.find((v) => v.id === screenViewStore.currentViewId)
  return view?.view_type ?? 'table'
})

const currentView = computed(() =>
  screenViewStore.views.find((v) => v.id === screenViewStore.currentViewId),
)

// 视图布局配置（列序/列宽/卡片徽章/日历落格字段）。
// 优先读持久化的 ScreenViewRust.config（解析校验 viewKind 一致），否则回退内建默认。
const tableConfig = computed<TableConfig | undefined>(() => {
  if (currentViewType.value !== 'table') return undefined
  return (parseLayoutConfig(currentView.value?.config, 'table') as TableConfig | null) ?? (defaultLayoutConfig('table') as TableConfig)
})

const boardConfig = computed<BoardConfig | undefined>(() => {
  if (currentViewType.value !== 'board') return undefined
  return (parseLayoutConfig(currentView.value?.config, 'board') as BoardConfig | null) ?? (defaultLayoutConfig('board') as BoardConfig)
})

const calendarConfig = computed<CalendarConfig>(() =>
  (parseLayoutConfig(currentView.value?.config, 'calendar') as CalendarConfig | null) ?? (defaultLayoutConfig('calendar') as CalendarConfig),
)

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
  await screenViewStore.load()
  await refresh()
})

// Handle status change from child views
async function handleStatusChange(blockId: string, newStatus: string) {
  await propertyStore.setProperty(blockId, 'status', newStatus)
  await refresh()
}

// 通用表格单元格编辑：done/status 走状态更新，其余走属性更新（TableView 零任务代码，由字段元数据驱动；ADR-0007）
async function onCellChange(blockId: string, key: string, value: unknown) {
  if (key === 'done') {
    await handleStatusChange(blockId, value ? 'Done' : 'Todo')
    return
  }
  if (key === 'status') {
    await handleStatusChange(blockId, String(value))
    return
  }
  await propertyStore.setProperty(blockId, key, value as PropertyValue)
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

// 查询状态已整体迁入 TaskViewBar（参考 PagesLibrary 本地持有范式），此处镜像用于卡片过滤/分组计算
function onSearchQueryUpdate(q: string) {
  searchQuery.value = q
}
function onViewQueryUpdate(q: ViewQuery) {
  viewQuery.value = q
}
</script>

<template>
  <div class="task-hub">
    <PageTitle title="任务中心" :subtitle="`${flatCards.length} 个任务`" />

    <!-- 视图管理 + 查询工具条（筛选/排序/分组 + 搜索）+ 筛选芯片行：已整体迁入 TaskViewBar -->
    <TaskViewBar
      :current-view-type="currentViewType"
      :views="screenViewStore.views"
      :current-view-id="screenViewStore.currentViewId ?? undefined"
      @refresh="handleRefresh"
      @update:search-query="onSearchQueryUpdate"
      @update:view-query="onViewQueryUpdate"
    />

    <!-- 主内容区 -->
    <main class="lib-body">
      <TableView
        v-if="currentViewType === 'table'"
        :items="flatCards"
        :fields="blockRefFields"
        :groups="groups"
        :grouped="grouped"
        :sort="viewQuery.sort"
        :config="tableConfig"
        id-key="block_id"
        @cell-change="onCellChange"
        @navigate="handleNavigateToBlock"
      />
      <BoardView
        v-else-if="currentViewType === 'board'"
        :items="flatCards"
        :fields="blockRefFields"
        :group-by="viewQuery.groupBy ?? 'status'"
        :config="boardConfig"
        id-key="block_id"
        @cell-change="onCellChange"
        @navigate="handleNavigateToBlock"
      />
      <CalendarView
        v-else-if="currentViewType === 'calendar'"
        :items="flatCards"
        :fields="blockRefFields"
        :config="calendarConfig"
        id-key="block_id"
        @navigate="handleNavigateToBlock"
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
