<script setup lang="ts">
import { CalendarDays, ChevronRight, Columns, Table } from 'lucide-vue-next'
import { computed, markRaw, onMounted, ref, watch } from 'vue'

import {
  BLOCK_ENTITY,
  blockDefaultConfig,
  fieldTypeOf,
  registerBlockBuiltinFields,
} from '../../composables/useBlockQueryRegistry'
import { useNavigateToTag } from '../../composables/useNavigateToTag'
import { createQueryEngine, createRegistry, type FieldDescriptor, type ViewQuery } from '../../core/query'
import { type BoardConfig, type CalendarConfig, parseLayoutConfig, type TableConfig } from '../../core/view'
import type { ViewTypeOption } from '../../core/view/management'
import { useBlockCardStore } from '../../stores/blockCard'
import { useBlockStore } from '../../stores/blocks'
import { useEditorStore } from '../../stores/editor'
import { useFieldValueStore } from '../../stores/fieldValue'
import { useScreenViewStore } from '../../stores/screenView'
import { useTagsStore } from '../../stores/tags'
import type { FieldType, FieldValueData } from '../../types/field-definition'
import type { PersistedFieldDefinition } from '../../types/tag-persisted'
import { displayFieldType } from '../../utils/field-type-icons'
import type { BlockCard } from '../../wasm/types'
import QueryPageFrame from '../common/QueryPageFrame.vue'
import PageDrawer from '../Page/PageDrawer.vue'
import BlockContentCell from '../views/BlockContentCell.vue'
import BoardView from '../views/BoardView.vue'
import CalendarView from '../views/CalendarView.vue'
import SourcePageCell from '../views/SourcePageCell.vue'
import TableView from '../views/TableView.vue'
import type { CellRegistry } from '../views/types'
import TagColorPicker from './TagColorPicker.vue'
import TagDescriptionField from './TagDescriptionField.vue'

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
const fieldValueStore = useFieldValueStore()
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
const fieldTypeByKey = new Map<string, FieldType>()
for (const def of tagFieldDefs.value) {
  fieldTypeByKey.set(def.key, def.type as FieldType)
  registry.register(BLOCK_ENTITY, toDescriptor(def))
}
const registryFields: FieldDescriptor[] = registry.list(BLOCK_ENTITY)

/**
 * 字段面板的候选池（ADR-0050 D7）：本页列模板只由「内容 + 来源页 + 该 tag 的有效字段」构成，
 * 故候选限同三者。注册表本身必须保留全部内置字段 —— 日历按 `dateRefKind='deadline'` 落格、
 * 分组芯片按 block 属性（含内置 status / priority）筛选排序都靠这些描述符；但那些字段不属于
 * 本页的列语义，混进候选会让一个无字段的 tag 列出 19 个无关内置字段（真机实证 2026-09-23）。
 * 顺序沿用注册顺序（内容 / 来源页在前，tag 字段在后）。
 */
const columnFieldKeys = new Set(['content', 'page', ...tagFieldDefs.value.map((d) => d.key)])
const candidateFields: FieldDescriptor[] = registryFields.filter((f) => columnFieldKeys.has(f.key))

const blockEngine = createQueryEngine<BlockCard>(BLOCK_ENTITY)

const ALL_VIEW_TYPES: ViewTypeOption[] = [
  { key: 'table', label: '表格', icon: Table },
  { key: 'board', label: '看板', icon: Columns },
  { key: 'calendar', label: '日历', icon: CalendarDays },
]

/**
 * 看板分组字段 —— 跟随标签自己的字段模板，不固定用全局 `status`。
 *
 * 规则（产品决策）：用户经分组芯片显式指定时优先；否则取该标签有效字段中第一个
 * select / multiSelect。两者都没有 ⇒ 该标签没有「阶段」语义，看板不成立：
 * `viewTypes` 不列 board（新用户看不到入口），历史 board tab 落到配置引导态。
 *
 * ⚠️ 类型判定必须走 `displayFieldType`：单选在库里是**伪类型** —— `type='string'` +
 * `closed_values` 非空（TagsLibrary 新建单选即如此落库）。直读 `def.type` 会把单选
 * 判成文本，看板永远判定为「没有分组字段」而落到引导态。
 *
 * 为什么不再固定 `status`：标签页的字段模型是标签私有的（`effectiveFieldDefinitions`），
 * 而 status 是全局任务字段。固定 status 会让绝大多数非任务标签的看板恒为 5 个空列，
 * 且看板列与表格列（无 status 列）对不上，拖拽还会静默把笔记任务化。
 */
const BOARD_GROUP_TYPES = new Set(['select', 'multiSelect'])
const boardGroupField = computed<FieldDescriptor | null>(() => {
  // 显式分组只在「本页字段模板内的枚举字段」上生效：内置 status / priority 不属于标签模板，
  // 沿用会把旧 tab 残留的 groupBy='status' 顶回 5 个空列 —— 本次要修掉的正是这个行为。
  const explicit = viewQuery.value.groupBy
  if (explicit && columnFieldKeys.has(explicit)) {
    const explicitDef = tagFieldDefs.value.find((d) => d.key === explicit)
    if (explicitDef && BOARD_GROUP_TYPES.has(displayFieldType(explicitDef))) {
      return registry.get(BLOCK_ENTITY, explicit) ?? null
    }
  }
  const def = tagFieldDefs.value.find((d) => BOARD_GROUP_TYPES.has(displayFieldType(d)))
  return def ? registry.get(BLOCK_ENTITY, def.key) ?? null : null
})
const boardGroupBy = computed(() => boardGroupField.value?.key ?? '')
const hasBoardView = computed(() => boardGroupField.value !== null)
const viewTypes = computed<ViewTypeOption[]>(() =>
  hasBoardView.value ? ALL_VIEW_TYPES : ALL_VIEW_TYPES.filter((v) => v.key !== 'board'),
)

const cellRegistry: CellRegistry = {
  'block-content': markRaw(BlockContentCell),
  'source-page': markRaw(SourcePageCell),
}

// ── 布局配置（持久化优先，回退本页默认）──
/**
 * 表格默认列：内容 + 来源页 + 该 tag 的全部有效字段（ADR-0050 D7）。
 * 列宽是比例模式（ADR-0013）的权重基准：内容列 720 吸收剩余空间、来源页 140、字段列 110 紧凑 ——
 * 对齐设计稿「内容占大半、元数据列贴右」的比例。只对未持久化 config 的视图生效，已存视图仍按自身 config。
 */
const tagTableDefault = computed<TableConfig>(() => ({
  viewKind: 'table',
  version: 1,
  columns: [
    { key: 'content', role: 'primary', cell: 'block-content', width: 720 },
    { key: 'page', cell: 'source-page', width: 140 },
    ...tagFieldDefs.value.map((d) => ({ key: d.key, width: 110 })),
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

// ── 身份（ADR-0050 D11）──
// 身份三要素在标题区自证并就地编辑：色点（颜色）+ 描述。写入口与标签管理页右栏同一个
// （`setIdentity`），符合 D12「身份可多入口、同一份数据同一组原语」。
const description = computed(() => tag.value?.description ?? '')
const tagColor = computed(() => tag.value?.color ?? '')
const isSystemTag = computed(() => !!tag.value?.is_system)

async function saveDescription(value: string) {
  await tagsStore.setIdentity(props.tagId, { description: value })
}

/** 选色器给 `null` = 选了「无色」→ 发空串（D11：空串是有效值，不是「未改」）。 */
async function saveColor(color: string | null) {
  await tagsStore.setIdentity(props.tagId, { color: color ?? '' })
}

// ── 交互 ──
/** 单元格编辑：按字段声明类型写入（TableView 零业务代码，由字段元数据驱动；ADR-0007）。 */
async function handleCellChange(blockId: string, key: string, value: unknown) {
  await fieldValueStore.setFieldValue(blockId, key, value as FieldValueData, fieldTypeByKey.get(key))
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

// ── 成员页块加载（内容列 `#tag` chip 着色的前提，ADR-0050 D11 消费面）──
// BulletRender 按 block-id 回查 blockStore 取 renderSegments；聚合页若不加载成员页，
// 内容列 chip 永远落到无色正则兜底（颜色 / 系统中性样式全丢）。
// loadMultiPageBlocks 单次 IPC 取多页（含 render_segments），isPageFullyLoaded
// 缓存令重复触发为空转；成员集合变化（打标/摘标）经 key 去重后自动补载新页。
const blockStore = useBlockStore()
const memberPageKey = computed(() => memberCards.value.map((c) => c.page_id).join(','))
watch(memberPageKey, (key) => {
  if (key) void blockStore.loadMultiPageBlocks(key.split(','))
}, { immediate: true })

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
    :candidate-fields="candidateFields"
    :registry="registry"
    :items="flatCards"
    :groups="groups"
    :grouped="grouped"
    :sort="viewQuery.sort"
    :group-by="boardGroupBy"
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
          @click="navigateToTagLibrary()"
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
      <!-- 身份条（ADR-0050 D11）：颜色 + 描述在左、模板设置入口在右（D12） -->
      <div class="tag-identity">
        <TagColorPicker
          :value="tagColor"
          :readonly="isSystemTag"
          @pick="saveColor"
        />
        <TagDescriptionField
          :value="description"
          :readonly="isSystemTag"
          @save="saveDescription"
        />
        <button
          type="button"
          class="tag-settings"
          @click="navigateToTagLibrary(tagId)"
        >
          设置
        </button>
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
        v-if="hasBoardView"
        :items="context.items"
        :fields="context.fields"
        :group-by="boardGroupBy"
        :config="context.boardConfig"
        :id-key="context.idKey"
        tint-columns
        @cell-change="handleCellChange"
        @navigate="handleOpenBlock"
      />
      <!-- 无 select 字段的标签没有阶段语义：不硬塞 5 个空列，直接指向配置入口 -->
      <div
        v-else
        class="board-unconfigured"
      >
        <p class="board-unconfigured-title">
          看板需要一个可选字段来分组
        </p>
        <p class="board-unconfigured-hint">
          为该标签添加一个单选字段（如「阶段」「状态」），成员就会按它排成列；也可以在工具条的分组里指定任意字段。
        </p>
        <button
          type="button"
          class="board-unconfigured-action"
          @click="navigateToTagLibrary(tagId)"
        >
          去设置字段
        </button>
      </div>
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

/*
 * 身份条：色点 + 描述与标题/副标题左缘对齐（PageTitle 自带 --space-4 水平内边距，
 * 外壳已给 --space-8，此处补同一份额外缩进），设置入口右贴边。
 * 居中对齐而非 flex-start：描述可能换行，色点与「设置」跟着它居中比贴顶更稳。
 */
.tag-identity {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-4) var(--space-3);
  margin-bottom: var(--space-2);
  border-bottom: 1px solid var(--border);
}

.tag-settings {
  flex-shrink: 0;
  margin-left: auto;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.tag-settings:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* 看板配置引导：无分组字段时替代空列（不要用「暂无卡片」冒充数据为空） */
.board-unconfigured {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: 100%;
  padding: var(--space-8);
  text-align: center;
}

.board-unconfigured-title {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.board-unconfigured-hint {
  margin: 0;
  max-width: 380px;
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--text-tertiary);
}

.board-unconfigured-action {
  margin-top: var(--space-2);
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.board-unconfigured-action:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
</style>
