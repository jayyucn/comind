<script setup lang="ts">
import type { PropertyValue } from '@/types/property'
import { CalendarDays, Columns, Table } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { createQueryEngine } from '../../core/query'
import { blockDefaultConfig, BLOCK_ENTITY, getBlockRegistry } from '../../composables/useBlockQueryRegistry'
import type { ViewQuery } from '../../core/query'
import { parseLayoutConfig, type BoardConfig, type CalendarConfig, type TableConfig } from '../../core/view'
import type { ViewTypeOption } from '../../core/view/management'
import { useBlockCardStore } from '../../stores/blockCard'
import { usePropertyStore } from '../../stores/property'
import { useScreenViewStore } from '../../stores/screenView'
import type { BlockCard } from '../../wasm/types'
import QueryPageFrame from '../common/QueryPageFrame.vue'

const router = useRouter()
const blockCardStore = useBlockCardStore()
// 命名视图 store（与 QueryPageFrame 内部同 key 单例共享；此处仅读取 currentViewType/currentTab）。
// 首建注入实体默认布局（blockDefaultConfig）——seed/create 时写入 Block 正确的 config（ADR-0023 上游修复）。
const screenViewStore = useScreenViewStore('block', { defaultConfig: blockDefaultConfig })
const propertyStore = usePropertyStore()

// 通用查询引擎注册表（组合根单例，内置字段 + 自定义 property 已注册）
const registry = getBlockRegistry()
// 统一引擎：实体类型在工厂创建时绑定（ADR-0022 Q7）
const blockEngine = createQueryEngine<BlockCard>(BLOCK_ENTITY)
// 实体级字段 schema 只需取一次（同实体所有记录共用）
const blockRefFields = registry.list(BLOCK_ENTITY)

// block 实体可选的视图类型（注入 QueryPageFrame → NamedViewBar）
const blockViewTypes: ViewTypeOption[] = [
  { key: 'table', label: '表格', icon: Table },
  { key: 'board', label: '看板', icon: Columns },
  { key: 'calendar', label: '日历', icon: CalendarDays },
]

// 搜索词（外壳 v-model:search 持有；父侧子串过滤，与 PagesLibrary 对 title 过滤同构）
const searchQuery = ref('')

// 当前激活 tab 的可编辑查询（单一数据源：NamedViewBar 的保存/清除/切换均作用于它）。
// 与外壳内部 viewQuery 同源（store.workingQuery），此处供引擎计算消费。
const viewQuery = computed<ViewQuery>(() => screenViewStore.workingQuery)

const currentViewType = computed(() => screenViewStore.currentViewType)

const currentTab = computed(() => screenViewStore.currentTab)

// 视图布局配置（列序/列宽/卡片徽章/日历落格字段）。
// 优先读持久化的 ScreenViewRust.config（解析校验 viewKind 一致），否则回退实体注册点默认（BLOCK_DEFAULT_*）。
const tableConfig = computed<TableConfig | undefined>(() => {
  if (currentViewType.value !== 'table') return undefined
  return (parseLayoutConfig(currentTab.value?.config, 'table') as TableConfig | null) ?? (blockDefaultConfig('table') as TableConfig)
})

const boardConfig = computed<BoardConfig | undefined>(() => {
  if (currentViewType.value !== 'board') return undefined
  return (parseLayoutConfig(currentTab.value?.config, 'board') as BoardConfig | null) ?? (blockDefaultConfig('board') as BoardConfig)
})

const calendarConfig = computed<CalendarConfig>(() =>
  (parseLayoutConfig(currentTab.value?.config, 'calendar') as CalendarConfig | null) ?? (blockDefaultConfig('calendar') as CalendarConfig),
)

// 搜索（父侧子串过滤，与 PagesLibrary 对 title 过滤同构）
const searchedCards = computed<BlockCard[]>(() => {
  const cards = blockCardStore.cards
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return cards
  return cards.filter((c) => (c.content_preview ?? '').toLowerCase().includes(q))
})

// 统一引擎：过滤 + 排序 + 分组一步到位（基于 store.workingQuery，未保存即实时预览）
const groups = computed(() =>
  blockEngine.run(searchedCards.value, viewQuery.value, registry),
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
</script>

<template>
  <QueryPageFrame
    title="任务中心"
    :subtitle="`${flatCards.length} 个任务`"
    entity-key="block"
    :view-types="blockViewTypes"
    v-model:search="searchQuery"
    :fields="blockRefFields"
    :registry="registry"
    :items="flatCards"
    :groups="groups"
    :grouped="grouped"
    :sort="viewQuery.sort"
    :group-by="viewQuery.groupBy ?? 'status'"
    :table-config="tableConfig"
    :board-config="boardConfig"
    :calendar-config="calendarConfig"
    id-key="block_id"
    @cell-change="onCellChange"
    @navigate="handleNavigateToBlock"
  />
</template>
