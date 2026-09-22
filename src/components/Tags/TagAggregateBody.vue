<script setup lang="ts">
import { CalendarDays, ChevronRight, Columns, Table } from 'lucide-vue-next'
import { computed, markRaw, onMounted, ref } from 'vue'
import { createQueryEngine, createRegistry, type FieldDescriptor, type ViewQuery } from '../../core/query'
import { parseLayoutConfig, type BoardConfig, type CalendarConfig, type TableConfig } from '../../core/view'
import type { ViewTypeOption } from '../../core/view/management'
import {
  BLOCK_ENTITY,
  blockDefaultConfig,
  fieldTypeOf,
  registerBlockBuiltinFields,
} from '../../composables/useBlockQueryRegistry'
import { useNavigateToTag } from '../../composables/useNavigateToTag'
import { useBlockCardStore } from '../../stores/blockCard'
import { useEditorStore } from '../../stores/editor'
import { usePropertyStore } from '../../stores/property'
import { useScreenViewStore } from '../../stores/screenView'
import { useTagsStore } from '../../stores/tags'
import type { PersistedFieldDefinition } from '../../types/tag-persisted'
import type { PropertyType, PropertyValue } from '../../types/property'
import type { BlockCard } from '../../wasm/types'
import QueryPageFrame from '../common/QueryPageFrame.vue'
import PageDrawer from '../Page/PageDrawer.vue'
import BlockContentCell from '../views/BlockContentCell.vue'
import SourcePageCell from '../views/SourcePageCell.vue'
import TableView from '../views/TableView.vue'
import BoardView from '../views/BoardView.vue'
import CalendarView from '../views/CalendarView.vue'
import type { CellRegistry } from '../views/types'

/**
 * tag 聚合页本体（ADR-0050 D7）。
 *
 * 数据边界：成员集合 = `tagsStore.memberCards(tagId, 'aggregate')` —— 自身 + 后代闭包
 * （向上聚合，Tana semantics）；不含后代直系数由管理页负责展示。
 * 列模板来源 = 该 tag 的**有效字段**（自身 > 直接父 > 更近祖先，解析单源在 Rust）。
 *
 * 视图配置按 tag 维度持久化（`tag:<id>` 命名空间），与任务中心（`block`）互不干扰。
 * 挂载前置：标签树 / 卡片投影 / 页面标题表须已就绪 —— 本组件由 TagAggregatePage 的数据门
 * 以 tagId 为 key 挂载，故此处可直接同步读取有效字段，无需再处理加载态。
 */
const props = defineProps<{ tagId: string }>()

const tagsStore = useTagsStore()
const blockCardStore = useBlockCardStore()
const propertyStore = usePropertyStore()
const editorStore = useEditorStore()
const { navigateToTagLibrary } = useNavigateToTag()

// ── 视图配置（per-tag 命名空间） ──
// 不注入 defaultConfig：让 tab 的 config 落空串，由 tableConfig 的响应式回退接管——
// 回退列依赖 tag 字段模板（异步加载），注入静态默认会让首访就把错误列写进库。
const screenViewKey = `tag:${props.tagId}`
const screenViewStore = useScreenViewStore(screenViewKey, { defaultViewName: '全部成员' })
const viewQuery = computed<ViewQuery>(() => screenViewStore.workingQuery)
const currentViewType = computed(() => screenViewStore.currentViewType)
const currentTab = computed(() => screenViewStore.currentTab)

// ── tag 与成员派生 ──
const tag = computed(() => tagsStore.getTagById(props.tagId))
const summary = computed(() => tagsStore.memberSummary(props.tagId, 'aggregate'))
const memberCards = computed(() => tagsStore.memberCards(props.tagId, 'aggregate'))
/** 有效字段定义（列模板 / 统计卡 / 单元格写入类型都取自它）。 */
const tagFieldDefs = computed<PersistedFieldDefinition[]>(() =>
  tagsStore.effectiveFieldDefinitions(props.tagId),
)

// ── 查询引擎（本页私有注册表）──
// 用局部注册表而非全局单例：tag 字段只在聚合页有意义，注册进单例会污染任务中心的字段面板。
const registry = createRegistry()
registerBlockBuiltinFields(registry)
function toDescriptor(def: PersistedFieldDefinition): FieldDescriptor {
  const descriptor: FieldDescriptor = {
    key: def.key,
    label: def.title,
    type: fieldTypeOf(def.type),
    get: (item) => (item as BlockCard).properties?.[def.key],
  }
  if (def.closed_values && def.closed_values.length > 0) {
    descriptor.options = def.closed_values.map((v) => ({ id: v, label: v }))
  }
  return descriptor
}
// 来源页列（ADR-0050 D7）：复用内置 `page` 字段（筛选语义照旧），只把列标题改成「来源页」，
// 并由 `source-page` 自定义单元格把 page_id 映射成页标题。
const pageField = registry.get(BLOCK_ENTITY, 'page')
if (pageField) registry.register(BLOCK_ENTITY, { ...pageField, label: '来源页' })

/** 列 key → 落库类型（单元格写入时显式传参，避免按值推断改变字段型别）。 */
const propertyTypeByKey = new Map<string, PropertyType>()
for (const def of tagFieldDefs.value) {
  propertyTypeByKey.set(def.key, def.type as PropertyType)
  registry.register(BLOCK_ENTITY, toDescriptor(def))
}
const registryFields: FieldDescriptor[] = registry.list(BLOCK_ENTITY)

const blockEngine = createQueryEngine<BlockCard>(BLOCK_ENTITY)

const viewTypes: ViewTypeOption[] = [
  { key: 'table', label: '表格', icon: Table },
  { key: 'board', label: '看板', icon: Columns },
  { key: 'calendar', label: '日历', icon: CalendarDays },
]

const cellRegistry: CellRegistry = {
  'block-content': markRaw(BlockContentCell),
  'source-page': markRaw(SourcePageCell),
}

// ── 布局配置（持久化优先，回退本页默认）──
/** 表格默认列：内容 + 来源页 + 该 tag 的全部有效字段（ADR-0050 D7）。 */
const tagTableDefault = computed<TableConfig>(() => ({
  viewKind: 'table',
  version: 1,
  columns: [
    { key: 'content', role: 'primary', cell: 'block-content' },
    { key: 'page', cell: 'source-page' },
    ...tagFieldDefs.value.map((d) => ({ key: d.key })),
  ],
}))

const tableConfig = computed<TableConfig | undefined>(() => {
  if (currentViewType.value !== 'table') return undefined
  return (parseLayoutConfig(currentTab.value?.config, 'table') as TableConfig | null) ?? tagTableDefault.value
})

const boardConfig = computed<BoardConfig | undefined>(() => {
  if (currentViewType.value !== 'board') return undefined
  return (parseLayoutConfig(currentTab.value?.config, 'board') as BoardConfig | null) ?? (blockDefaultConfig('board') as BoardConfig)
})

const calendarConfig = computed<CalendarConfig>(() =>
  (parseLayoutConfig(currentTab.value?.config, 'calendar') as CalendarConfig | null) ?? (blockDefaultConfig('calendar') as CalendarConfig),
)

// ── 数据（搜索子串过滤 → 引擎过滤/排序/分组）──
const searchQuery = ref('')

const searchedCards = computed<BlockCard[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return memberCards.value
  return memberCards.value.filter((c) => (c.content_preview ?? '').toLowerCase().includes(q))
})

const groups = computed(() => blockEngine.run(searchedCards.value, viewQuery.value, registry))
const flatCards = computed<BlockCard[]>(() => groups.value.flatMap((g) => g.items))
const grouped = computed(() => viewQuery.value.groupBy !== null)

// ── 统计卡（ADR-0050 D7：零配置自动出全）──
// 成员数恒显；数值字段自动出「合计 / 平均」两卡；select/date/text 不出卡。
// 口径 = 该 tag 的成员集合（与副标题同源），故搜索/筛选不改变统计值。
const numericStats = computed(() =>
  tagFieldDefs.value
    .filter((d) => d.type === 'number')
    .map((d) => {
      const values = memberCards.value
        .map((c) => c.properties?.[d.key])
        .filter((v): v is number => typeof v === 'number')
      const sum = values.reduce((a, b) => a + b, 0)
      return { key: d.key, label: d.title, sum, avg: values.length > 0 ? sum / values.length : 0 }
    }),
)

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

// ── 交互 ──
/** 单元格编辑：按字段声明类型写入（TableView 零业务代码，由字段元数据驱动；ADR-0007）。 */
async function handleCellChange(blockId: string, key: string, value: unknown) {
  await propertyStore.setProperty(blockId, key, value as PropertyValue, propertyTypeByKey.get(key))
  await blockCardStore.getCards()
}

// 页面详情右侧弹层；来源页列 / 表格内容列点击 → 打开该成员块所属页面
const drawerPageId = ref<string | null>(null)

function openSourcePage(blockId: string) {
  const card = blockCardStore.cards.find((c) => c.block_id === blockId)
  if (card) drawerPageId.value = card.page_id
}

function handleCellClick(blockId: string, fieldKey: string) {
  if (fieldKey !== 'content' && fieldKey !== 'page') return
  openSourcePage(blockId)
}

// 看板 / 日历卡片点击：打开单 block 子树编辑弹窗（与任务中心同款）
function handleOpenBlock(blockId: string) {
  editorStore.openBlockModal(blockId)
}

onMounted(async () => {
  await screenViewStore.load()
})
</script>

<template>
  <QueryPageFrame
    v-model:search="searchQuery"
    :title="`#${tag?.title ?? ''}`"
    :subtitle="`${summary.count} 个成员 · 来自 ${summary.pageCount} 个页面`"
    entity-key="block"
    :screen-view-key="screenViewKey"
    :view-types="viewTypes"
    :fields="registryFields"
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
    :cell-registry="cellRegistry"
  >
    <template #breadcrumb>
      <nav class="tag-crumb">
        <button
          class="tag-crumb-link"
          type="button"
          @click="navigateToTagLibrary"
        >
          标签
        </button>
        <ChevronRight
          :size="12"
          class="tag-crumb-sep"
        />
        <span class="tag-crumb-current">#{{ tag?.title ?? '' }}</span>
      </nav>
    </template>

    <template #heading-extra>
      <div class="tag-stats">
        <div class="tag-stat">
          <span class="tag-stat-value">{{ summary.count }}</span>
          <span class="tag-stat-label">成员</span>
        </div>
        <div
          v-for="s in numericStats"
          :key="s.key"
          class="tag-stat"
        >
          <span class="tag-stat-value">{{ formatNumber(s.sum) }}</span>
          <span class="tag-stat-label">{{ s.label }}合计</span>
        </div>
        <div
          v-for="s in numericStats"
          :key="`avg-${s.key}`"
          class="tag-stat"
        >
          <span class="tag-stat-value">{{ formatNumber(s.avg) }}</span>
          <span class="tag-stat-label">平均{{ s.label }}</span>
        </div>
      </div>
    </template>

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
        @cell-change="handleCellChange"
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
        @cell-change="handleCellChange"
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
  </QueryPageFrame>

  <PageDrawer
    :page-id="drawerPageId"
    @close="drawerPageId = null"
  />
</template>

<style lang="scss" scoped>
.tag-crumb {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: var(--space-4);
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}

.tag-crumb-link {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
}

.tag-crumb-link:hover {
  color: var(--text-primary);
}

.tag-crumb-sep {
  flex-shrink: 0;
}

.tag-crumb-current {
  color: var(--text-secondary);
}

.tag-stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
}

.tag-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 76px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-base2);
}

.tag-stat-value {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.tag-stat-label {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
</style>
