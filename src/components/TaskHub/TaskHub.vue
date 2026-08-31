<script setup lang="ts">
import type { PropertyValue } from '@/types/property'
import { CalendarDays, Columns, LayoutGrid, Table } from 'lucide-vue-next'
import { computed, markRaw, onMounted, ref } from 'vue'
import { createQueryEngine } from '../../core/query'
import { blockDefaultConfig, BLOCK_ENTITY, getBlockRegistry } from '../../composables/useBlockQueryRegistry'
import type { ViewQuery } from '../../core/query'
import { parseLayoutConfig, type BoardConfig, type CalendarConfig, type QuadrantConfig, type TableConfig } from '../../core/view'
import type { ViewTypeOption } from '../../core/view/management'
import { useBlockCardStore } from '../../stores/blockCard'
import { useBlockStore } from '../../stores/blocks'
import { useEditorStore } from '../../stores/editor'
import { usePageStore } from '../../stores/pages'
import { usePropertyStore } from '../../stores/property'
import { useScreenViewStore } from '../../stores/screenView'
import type { BlockCard } from '../../wasm/types'
import QueryPageFrame from '../common/QueryPageFrame.vue'
import PageDrawer from '../Page/PageDrawer.vue'
import BlockContentCell from '../views/BlockContentCell.vue'
import TableView from '../views/TableView.vue'
import BoardView from '../views/BoardView.vue'
import CalendarView from '../views/CalendarView.vue'
import QuadrantView from '../views/QuadrantView.vue'
import type { CellRegistry } from '../views/types'

const blockCardStore = useBlockCardStore()
// 命名视图 store（与 QueryPageFrame 内部同 key 单例共享；此处仅读取 currentViewType/currentTab）。
// 首建注入实体默认布局（blockDefaultConfig）——seed/create 时写入 Block 正确的 config（ADR-0023 上游修复）。
const screenViewStore = useScreenViewStore('block', { defaultConfig: blockDefaultConfig })
const propertyStore = usePropertyStore()
// 四象限新增任务：block 经编辑器 store 创建（走既有 _scheduleSave 通路），页面自动建/复用
const blockStore = useBlockStore()
const pageStore = usePageStore()
const editorStore = useEditorStore()

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
  { key: 'quadrant', label: '四象限', icon: LayoutGrid },
]

// 自定义单元格注册表（ADR-0010）：content 列用富预览组件接管渲染。组件须 markRaw 避免被 Vue 误设为响应式。
const blockCellRegistry: CellRegistry = { 'block-content': markRaw(BlockContentCell) }

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

const quadrantConfig = computed<QuadrantConfig | undefined>(() => {
  if (currentViewType.value !== 'quadrant') return undefined
  return (parseLayoutConfig(currentTab.value?.config, 'quadrant') as QuadrantConfig | null) ?? (blockDefaultConfig('quadrant') as QuadrantConfig)
})

// 数据源：排除 status 为空的 blocks（普通非任务段落），再做搜索子串过滤
// （与 PagesLibrary 对 title 过滤同构；status 以 property 存于 card.properties['status']）
const searchedCards = computed<BlockCard[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return blockCardStore.cards.filter((c) => {
    const status = c.properties?.['status']
    if (status === undefined || status === null || status === '') return false
    if (!q) return true
    return (c.content_preview ?? '').toLowerCase().includes(q)
  })
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

// 四象限新增任务：落到自动建/复用的「任务收集」页，status=Todo、priority=目标象限值。
// 标题即 block content；创建后刷新卡片投影让新任务立即入格。
const TASK_INBOX_PAGE_TITLE = '任务收集'

async function handleQuadrantAdd(priority: string, title: string) {
  const page = await pageStore.getOrCreatePageByTitle(TASK_INBOX_PAGE_TITLE)
  const block = await blockStore.createBlock({ pageId: page.id, content: title })
  // createBlock 落库是防抖的；block_properties.block_id 外键依赖 block 行先存在，
  // 必须先 flushSave 强制持久化，否则紧跟的 setProperty 触发 FOREIGN KEY constraint failed
  await blockStore.flushSave(block.id)
  await propertyStore.setProperty(block.id, 'status', 'Todo')
  await propertyStore.setProperty(block.id, 'priority', priority)
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

// 页面详情右侧弹层（替代整页路由跳转）；pendingFocusBlock 记录待定位的 block（抽屉挂载后转发）
const drawerPageId = ref<string | null>(null)
const pendingFocusBlock = ref<string | null>(null)
// 单 block 子树编辑弹窗由全局 BlockModal（App.vue 内）响应 editorStore.blockModalBlockId，
// 此处不再维护局部实例；四象限卡片 / 看板 / 日历卡片通过 editorStore.openBlockModal 打开。

// Navigate to source block：打开抽屉 + 记录定位目标
async function handleNavigateToBlock(blockId: string) {
  const card = blockCardStore.cards.find((c) => c.block_id === blockId)
  if (!card) return
  pendingFocusBlock.value = blockId
  drawerPageId.value = card.page_id
}

// 四象限卡片点击：打开单 block 子树编辑弹窗（聚焦编辑该任务，不整页跳转）
function handleOpenBlock(blockId: string) {
  editorStore.openBlockModal(blockId)
}

// 抽屉内 Page 组件挂载完成后转发定位事件（此时监听器已注册，事件不会丢失）
function onDrawerOpened() {
  if (pendingFocusBlock.value) {
    window.dispatchEvent(new CustomEvent('navigate-to-block', { detail: { blockId: pendingFocusBlock.value } }))
    pendingFocusBlock.value = null
  }
}

// 表格单元格点击：仅标题（content 字段）跳转到源 block——跳转语义属业务层，TableView 只上报事实
function handleCellClick(blockId: string, fieldKey: string) {
  if (fieldKey !== 'content') return
  void handleNavigateToBlock(blockId)
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
    :quadrant-config="quadrantConfig"
    id-key="block_id"
    :cell-registry="blockCellRegistry"
  >
    <template #table="{ context }">
      <TableView
        :items="context.items"
        :fields="context.fields"
        :groups="context.groups"
        :grouped="context.grouped"
        :sort="context.sort"
        :config="context.tableConfig"
        :id-key="context.idKey"
        :cell-registry="context.cellRegistry"
        @column-resize="context.onColumnResize"
        @column-align="context.onColumnAlign"
        @column-visibility="context.onColumnVisibility"
        @column-reset="context.onColumnReset"
        @cell-change="onCellChange"
        @cell-click="handleCellClick"
      />
    </template>
    <template #board="{ context }">
      <BoardView
        :items="context.items"
        :fields="context.fields"
        :group-by="context.groupBy ?? ''"
        :config="context.boardConfig"
        :id-key="context.idKey"
        @cell-change="onCellChange"
        @navigate="handleOpenBlock"
      />
    </template>
    <template #calendar="{ context }">
      <CalendarView
        :items="context.items"
        :fields="context.fields"
        :config="context.calendarConfig"
        :id-key="context.idKey"
        @navigate="handleOpenBlock"
      />
    </template>
    <template #quadrant="{ context }">
      <QuadrantView
        :items="context.items"
        :id-key="context.idKey"
        :config="context.quadrantConfig"
        :sort="context.sort"
        :registry="context.registry"
        :entity-type="context.entityType"
        @cell-change="onCellChange"
        @open-block="handleOpenBlock"
        @add-item="handleQuadrantAdd"
      />
    </template>
  </QueryPageFrame>

  <!-- 页面详情右侧弹层（替代整页路由跳转；打开后定位到来源 block） -->
  <PageDrawer :page-id="drawerPageId" @close="drawerPageId = null" @opened="onDrawerOpened" />

  <!-- 单 block 子树编辑弹窗由全局 BlockModal（App.vue）响应 editorStore.blockModalBlockId，此处不再渲染 -->
</template>
