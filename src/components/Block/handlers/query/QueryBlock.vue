<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { CalendarDays, Columns, LayoutGrid, Table } from 'lucide-vue-next'
import { computed, markRaw, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import type { FieldValueData } from '@/types/field-definition'

import { BLOCK_ENTITY, blockDefaultConfig, getBlockRegistry } from '../../../../composables/useBlockQueryRegistry'
import type { ViewQuery } from '../../../../core/query'
import { createQueryEngine } from '../../../../core/query'
import { type BoardConfig, type CalendarConfig, type LayoutConfig, parseLayoutConfig, type QuadrantConfig, type TableConfig, type ViewKind } from '../../../../core/view'
import type { ViewTypeOption } from '../../../../core/view/management'
import { cloneQueryViewNamespace, queryViewEntity } from '../../../../services/query-view-namespace'
import { useBlockCardStore } from '../../../../stores/blockCard'
import { useBlockStore } from '../../../../stores/blocks'
import { useEditorStore } from '../../../../stores/editor'
import { useFieldValueStore } from '../../../../stores/fieldValue'
import { usePageStore } from '../../../../stores/pages'
import { usePanesStore } from '../../../../stores/panes'
import { peekScreenViewStore, useScreenViewStore } from '../../../../stores/screenView'
import type { Block } from '../../../../types/block'
import type { BlockCard } from '../../../../wasm/types'
import BasePopover from '../../../common/BasePopover.vue'
import QueryPageFrame from '../../../common/QueryPageFrame.vue'
import { isQuadrantCard } from '../../../TaskHub/quadrant-filter'
import BlockContentCell from '../../../views/BlockContentCell.vue'
import BoardView from '../../../views/BoardView.vue'
import CalendarView from '../../../views/CalendarView.vue'
import QuadrantView from '../../../views/QuadrantView.vue'
import SourcePageCell from '../../../views/SourcePageCell.vue'
import TableView from '../../../views/TableView.vue'
import type { CellRegistry } from '../../../views/types'
import BlockMenuCommon from '../../components/BlockMenuCommon.vue'
import { normalizePageColumn } from './page-column'
import { excludeEmptyCards } from './source-cards'

/**
 * 查询块：把查询页外壳（QueryPageFrame）嵌进文档正文，去掉 PageTitle，其余（命名视图条 /
 * 查询工具条 / 芯片行 / 主内容区四视图）原样复用（ADR-0023 D1 的第二次真实消费）。
 *
 * 三个口径与任务中心**刻意不同**：
 * - 数据源 = `blockCardStore.cards` **剔除空块**（无正文），不按 status 筛（块内查询要能查
 *   无状态块；辨识靠 content 预览列）。空块必须剔：文档里每条空行都是一个块，放进结果集会让
 *   块内一插就吐出成百上千条空白行，且这些行在内容列上完全无法辨识。
 * - 命名空间按块隔离：`screenViewKey = query-block:<blockId>`，每块各自一套筛选/排序/列宽，
 *   与任务中心（`block`）、页面库（`page`）互不影响。引擎实体命名空间仍是 `block`。
 * - 默认列 = 内容 / 页面 / 更新时间（任务中心那套 status/priority/deadline 面向前途未卜的
 *   任务流；块内查询是「在正文里引用一段数据」，先给辨识 + 溯源 + 时效三列，其余列按需从
 *   字段面板加）。
 *
 * 编辑器协议：与 table 块同构——editorComponent 与 renderComponent 都是本组件，
 * 并在挂载态切换时被**重新挂载两次**（Block/index.vue 的两态分支）。因此本组件不持有
 * 必须跨挂载存活的局部状态，一切状态落在 store（screenView / blockCard）。
 */
const props = defineProps<{ blockId: string }>()

/** 每块独立的命名视图命名空间（落库键）。块删除时由 `blockStore.deleteBlocks` 统一改挂孤儿前缀。 */
const screenViewKey = queryViewEntity(props.blockId)

const blockCardStore = useBlockCardStore()
const fieldValueStore = useFieldValueStore()
const blockStore = useBlockStore()
const pageStore = usePageStore()
const panesStore = usePanesStore()
const editorStore = useEditorStore()
const router = useRouter()

/**
 * 查询块默认表格列。列宽是比例模式（ADR-0013）的权重基准，不是死宽：块内宽度约 400~700px，
 * 内容列吃大头，页面 / 更新时间各占一格（`MM-dd HH:mm` 约 105px 起才不截断）。
 * 只对「未持久化 config」的视图生效——用户拖过列宽后按自己的 config 渲染。
 */
const QUERY_BLOCK_TABLE_DEFAULT: TableConfig = {
  viewKind: 'table',
  version: 1,
  columns: [
    { key: 'content', role: 'primary', cell: 'block-content', width: 220 },
    { key: 'page', cell: 'source-page', width: 130 },
    { key: 'updatedAt', width: 130 },
  ],
}

/** 除表格外的三种布局沿用 Block 实体默认（看板/日历/矩阵块内语义不变）。 */
function queryBlockDefaultConfig(kind: ViewKind): LayoutConfig {
  return kind === 'table' ? QUERY_BLOCK_TABLE_DEFAULT : blockDefaultConfig(kind)
}

// 必须先于 QueryPageFrame 内部同 key 的调用：store 注册表按 key 缓存首个创建者，
// 此处带 defaultConfig，子组件那次不带（同 TaskHub 的接法）。
const screenViewStore = useScreenViewStore(screenViewKey, {
  defaultConfig: queryBlockDefaultConfig,
  defaultViewName: '查询',
})

const registry = getBlockRegistry()
const blockEngine = createQueryEngine<BlockCard>(BLOCK_ENTITY)
const blockRefFields = registry.list(BLOCK_ENTITY)

const viewTypes: ViewTypeOption[] = [
  { key: 'table', label: '表格', icon: Table },
  { key: 'board', label: '看板', icon: Columns },
  { key: 'calendar', label: '日历', icon: CalendarDays },
  { key: 'quadrant', label: '矩阵', icon: LayoutGrid },
]

// content 列用富预览组件接管渲染；page 列用 source-page 把 page_id 映射成页标题（与标签聚合页同款）
const cellRegistry: CellRegistry = {
  'block-content': markRaw(BlockContentCell),
  'source-page': markRaw(SourcePageCell),
}

const searchQuery = ref('')

const viewQuery = computed<ViewQuery>(() => screenViewStore.workingQuery)
const currentViewType = computed(() => screenViewStore.currentViewType)
const currentTab = computed(() => screenViewStore.currentTab)

/** 数据源：剔除空块（见 source-cards.ts），其余全量——不按 status / 优先级筛。 */
const sourceCards = computed<BlockCard[]>(() => excludeEmptyCards(blockCardStore.cards))

/** 工具条搜索只在 content 预览上做子串过滤，与任务中心同构。 */
const searchedCards = computed<BlockCard[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return sourceCards.value
  return sourceCards.value.filter((c) => (c.content_preview ?? '').toLowerCase().includes(q))
})

// 四象限入格门槛（priority + status 齐备）不变；搜索已在 searchedCards 里做过，这里传空串。
const quadrantSource = computed<BlockCard[]>(() =>
  searchedCards.value.filter((c) => isQuadrantCard(c, '')),
)

const tableConfig = computed<TableConfig | undefined>(() => {
  if (currentViewType.value !== 'table') return undefined
  const parsed = parseLayoutConfig(currentTab.value?.config, 'table') as TableConfig | null
  return parsed ? normalizePageColumn(parsed) : QUERY_BLOCK_TABLE_DEFAULT
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

const groups = computed(() => blockEngine.run(searchedCards.value, viewQuery.value, registry))
const flatCards = computed<BlockCard[]>(() => groups.value.flatMap((g) => g.items))
const grouped = computed(() => viewQuery.value.groupBy !== null)

async function refresh() {
  await blockCardStore.getCards()
}

onMounted(async () => {
  // 页面列要显示页标题（source-page 经 pageStore 查 id→title），故先确保页面列表在内存里
  void pageStore.ensurePagesLoaded()
  await screenViewStore.load()
  await refresh()
})

async function onCellChange(blockId: string, key: string, value: unknown) {
  if (key === 'done') {
    await handleStatusChange(blockId, value ? 'Done' : 'Todo')
    return
  }
  if (key === 'status') {
    await handleStatusChange(blockId, String(value))
    return
  }
  await fieldValueStore.setFieldValue(blockId, key, value as FieldValueData)
  if (key === 'priority') {
    fieldValueStore.ensureTodo(blockId).catch(() => {})
  }
  await refresh()
}

async function handleStatusChange(blockId: string, newStatus: string) {
  await fieldValueStore.setFieldValue(blockId, 'status', newStatus)
  await refresh()
}

/** 块内打开单块子树弹窗：不整页跳转，避免把正文当前上下文换掉。 */
function handleOpenBlock(blockId: string) {
  editorStore.openBlockModal(blockId)
}

/**
 * 点「页面」列 → 路由跳转到该页（真跳转，不弹抽屉）。
 * 与标签聚合页（抽屉预览）刻意不同：块内这一列是「这条数据住在哪」的溯源入口，
 * 用户点它就是想过去改，多一层抽屉等于多点一次。
 *
 * Ctrl/⌘+Click → 在**另一栏**打开（ADR-0059 对称 pane，与编辑态/渲染态的 wiki link 同口径）：
 * 单栏时自动拆成双栏，已有双栏时写到非活动栏。分屏读正文时最常见的诉求正是「左边看着
 * 这段论述，右边把源页开出来改」——整页跳转会连论述一起换掉。
 */
function handleCellClick(blockId: string, fieldKey: string, event?: MouseEvent) {
  if (fieldKey === 'content') {
    handleOpenBlock(blockId)
    return
  }
  if (fieldKey !== 'page') return
  const card = blockCardStore.cards.find((c) => c.block_id === blockId)
  const pageId = card?.page_id
  if (!pageId) return
  if (event && (event.ctrlKey || event.metaKey)) {
    panesStore.openInOtherPane(pageId)
    return
  }
  // 已在目标页（查询块所在页）时不重复导航，避免无意义的路由跳转把撤销/滚动状态打乱
  if (router.currentRoute.value.params.pageId === pageId) return
  router.push({ name: 'page', params: { pageId } })
}

// ── 块级菜单（入口在 Block 外壳，菜单本体留在这里 → BasePopover）──────────
// 入口图标由 .block-bullet 统一渲染（兼拖拽手柄），点击时把那个元素当锚点传进来；
// 菜单内容依赖本块 store 状态，不外泄给外壳。通用五项（缩进/复制/剪切/粘贴/删除）
// 由 BlockMenuCommon 渲染，本组件只提供 query 专属的粘贴收尾。
const menuOpen = ref(false)
const menuAnchor = ref<HTMLElement | null>(null)

function openEntryMenu(anchorEl: HTMLElement) {
  menuAnchor.value = anchorEl
  menuOpen.value = true
}

/**
 * 粘贴收尾（类型专属）：粘进来的是查询块副本时，把源块的命名视图克隆到新块键。
 * 配置不在剪贴板上，不显式搬一次，副本会掉回默认三列，看起来像「复制漏了东西」。
 * 通用段只负责「复制/粘贴整块」，不认识 query 这个类型 —— 所以这一步留在类型侧。
 *
 * 克隆是「清空目标命名空间 + 重建」：副本早在挂载时就 seed 并把那套默认行的 id 读进了自己的
 * store（`views` / `currentTabId`），库里的行被换掉后内存仍指向死 id —— 接着改列宽就会写向
 * 已删除的 tab。故克隆后按新块键重读一次；副本尚未挂载时跳过（它挂载时的 load 会读到新行，
 * 此处再造一个 store 反而可能和它并发 seed 两套默认屏）。
 */
async function afterPaste(created: Block[], sourceIds: string[]): Promise<void> {
  const sourceId = sourceIds[0]
  const copy = created[0]
  if (!sourceId || !copy || copy.type !== 'query') return
  await cloneQueryViewNamespace(sourceId, copy.id)
  await peekScreenViewStore(queryViewEntity(copy.id))?.load()
}

/** 矩阵新增任务：落今日 Ideas 页（与任务中心同一落点，ADR-0042 T1）。 */async function handleQuadrantAdd(priority: string, title: string) {
  const page = await pageStore.ensureTodayIdeasPage()
  if (!blockStore.blocks.some((b) => b.pageId === page.id)) {
    await blockStore.loadPageBlocks(page.id)
  }
  const block = await blockStore.createBlock({ pageId: page.id, content: title })
  // 字段值外键依赖 block 行先落库（createBlock 是防抖保存）
  await blockStore.flushSave(block.id)
  await fieldValueStore.setFieldValue(block.id, 'priority', priority)
  await fieldValueStore.ensureTodo(block.id)
  await refresh()
}

/**
 * 编辑器协议最小集（BlockTypeEditorExposed）：本块无文本编辑态，
 * 与 TableBlock 同构——`getEditor` 恒返回 undefined，令 Block/index.vue 的
 * 聚焦链路（setActiveEditor / coordsAtPos）整体跳过，不产生幽灵活动编辑器。
 */
defineExpose({
  syncContent: () => {},
  focus: () => {},
  focusRange: () => {},
  getText: () => '',
  markSaved: () => {},
  getEditor: () => undefined as unknown as Editor,
  cancelDebouncedSave: () => {},
  /** 入口菜单：Block 外壳渲染图标，点击时把该元素当锚点传进来 */
  openEntryMenu,
})
</script>

<template>
  <div class="query-block">
    <!-- 入口图标不在这里：已上提到 Block/index.vue 的 .block-bullet（类型图标兼拖拽手柄），
         点图标调本组件的 openEntryMenu(el)，锚点从外面传进来。 -->
    <BasePopover
      :visible="menuOpen"
      :anchor-el="menuAnchor"
      placement="bottom"
      @close="menuOpen = false"
    >
      <div
        class="block-entry-menu"
        @mousedown.prevent
      >
        <!-- 通用段（缩进 / 复制剪切粘贴 / 删除）与 table 块共用同一份实现。
             query 块没有类型专属项，所以不要前置分隔线（否则菜单顶部横着一条空线）。 -->
        <BlockMenuCommon
          :block-id="blockId"
          no-divider-top
          :after-paste="afterPaste"
          @close="menuOpen = false"
        />
      </div>
    </BasePopover>

    <QueryPageFrame
      v-model:search="searchQuery"
      hide-title
      embedded
      entity-key="block"
      :screen-view-key="screenViewKey"
      :default-view-name="'查询'"
      :view-types="viewTypes"
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
      :cell-registry="cellRegistry"
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
          :items="quadrantSource"
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
  </div>
</template>

<style lang="scss" scoped>
/* 高度策略：上限由宿主给（默认 560px，块内不占满整页），内容少时按内容收缩、超出时
   .lib-body 内部滚动。上下限都用局部变量承载，改高度不必翻样式。
   左侧 20px 是块级入口的 gutter（与 table 块同位）；顶部 16px 放 14px 高的入口按钮，
   两处都用 padding 而不是 table 那套负 margin —— 本块带 `overflow: hidden`（裁剪
   max-height 溢出），负 offset 的入口会被直接裁掉。 */
.query-block {
  --query-block-max-height: 560px;
  --query-block-min-height: 140px;
  --query-block-pad-top: 8px;

  position: relative;
  display: flex;
  flex-direction: column;
  min-height: var(--query-block-min-height);
  max-height: var(--query-block-max-height);
  /* 不再向左侧借 20px gutter：入口已上提到 .block-bullet（Block 外壳统一渲染）， */
  /* 内容起点直接落在块内容左缘，与其它块正文对齐。 */
  margin: var(--space-1) 0;
  padding: var(--query-block-pad-top) 0 0;
  // border: 1px solid var(--border-color);
  // border-radius: var(--radius-md);
  overflow: hidden;

  /* 表头固定：sticky 只相对**最近的滚动容器**生效。整页查询页里 `.table-scroll`
     （overflow: auto）就是滚动容器，表格的 `thead { position: sticky }` 绑它即可；
     嵌入块内高度跟随内容，滚动发生在 `.lib-body`，`.table-scroll` 自身不产生滚动
     ⇒ 表头随行一起滚走。故在块内退掉 `.table-scroll` 的滚动容器身份，
     并把 `.table-view` 的 `height: 100%` 放回 auto（嵌入模式下父级高度由内容决定，
     百分比定高会让表格撑成整块高、把滚动留给内层），使表头绑定到 `.lib-body`。 */
  :deep(.table-view) {
    height: auto;
  }

  :deep(.table-scroll) {
    overflow: visible;
  }
}

/* 菜单（BasePopover 内）的样式全部收口，本组件不再持有：
   - 容器与分隔线 → src/styles/components/_block.scss 的 .block-entry-menu
   - 菜单行       → src/components/common/BlockMenuItem.vue */
</style>
