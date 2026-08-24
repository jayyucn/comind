<script setup lang="ts">
import { CalendarDays, LayoutGrid } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { createQueryEngine } from '../../core/query'
import {
  getPageRegistry,
  PAGE_DEFAULT_CALENDAR_CONFIG,
  PAGE_DEFAULT_TABLE_CONFIG,
  PAGE_ENTITY,
  pageDefaultConfig,
} from '../../composables/usePageQueryRegistry'
import type { QueryContext, ViewQuery } from '../../core/query'
import { parseLayoutConfig, type CalendarConfig, type TableConfig } from '../../core/view'
import type { ViewTypeOption } from '../../core/view/management'
import { usePageStore } from '../../stores/pages'
import { useScreenViewStore } from '../../stores/screenView'
import type { Page } from '../../types/page'
import QueryPageFrame from '../common/QueryPageFrame.vue'
import PageDrawer from '../Page/PageDrawer.vue'

defineOptions({ name: 'PagesLibrary' })

const pageStore = usePageStore()
// 命名视图 store（与 QueryPageFrame 内部同 key 单例共享；此处读取 currentTab/workingQuery）。
// 首建注入实体默认布局（pageDefaultConfig）——seed/create 时写入 Page 正确的 config（ADR-0023 上游修复）。
const screenViewStore = useScreenViewStore('page', { defaultConfig: pageDefaultConfig })
const registry = getPageRegistry()
// 统一引擎：实体类型在工厂创建时绑定（ADR-0022 Q7）
const pageEngine = createQueryEngine<Page>(PAGE_ENTITY)

// page 实体可选的视图类型（注入 QueryPageFrame → NamedViewBar；类型创建后固定。
// 同时决定外壳渲染哪几个视图——table/calendar，不含 board）
const pageViewTypes: ViewTypeOption[] = [
  { key: 'table', label: '表格', icon: LayoutGrid },
  { key: 'calendar', label: '日历', icon: CalendarDays },
]

const searchQuery = ref('')
// 当前激活 tab 的可编辑查询（单一数据源：NamedViewBar 的保存/清除/切换均作用于它）。
// 与外壳内部 viewQuery 同源（store.workingQuery），此处供引擎计算消费。
const viewQuery = computed<ViewQuery>(() => screenViewStore.workingQuery)
const grouped = computed(() => viewQuery.value.groupBy !== null)

// 视图布局配置：优先读持久化的 ScreenViewRust.config（解析校验 viewKind 一致），否则回退 Page 内建默认。
// 上游修复（ADR-0023）后 seed 写入的即是 Page 正确默认；存量错误 config（旧 seed 的 Block 列）经数据迁移清空。
const tableConfig = computed<TableConfig>(() =>
  (parseLayoutConfig(screenViewStore.currentTab?.config, 'table') as TableConfig | null) ?? PAGE_DEFAULT_TABLE_CONFIG,
)
const calendarConfig = computed<CalendarConfig>(() =>
  (parseLayoutConfig(screenViewStore.currentTab?.config, 'calendar') as CalendarConfig | null) ?? PAGE_DEFAULT_CALENDAR_CONFIG,
)

// 跨记录字段引用所需的求值上下文：按 id 取 Page（用全量 store，不受搜索过滤影响）。
// 不提供时 recordRef 引用一律非匹配。
const queryContext = computed<QueryContext>(() => ({
  getById: (entityType, id) => (entityType === PAGE_ENTITY ? pageStore.getPage(id) : undefined),
}))

// 跨记录引用候选记录：把 Page 模型翻译为通用的 ReferenceableRecord（业务 → 引擎契约的唯一转换点）。
// 每条记录自带该实体（PAGE_ENTITY）的全部字段，供 ValueEditor 的「其他记录…」入口直接列出同类型字段，
// 编辑器本身不再查询任何业务注册表。
// 实体级字段 schema 只需取一次（同实体所有记录共用），避免逐记录重复 registry.list。
const pageRefFields = registry.list(PAGE_ENTITY)
const crossRecordSources = computed(() =>
  pageStore.pages.map((p) => ({
    id: p.id,
    title: p.title || '(无标题)',
    entityType: PAGE_ENTITY,
    fields: pageRefFields,
  })),
)

// 数据
const allPages = computed<Page[]>(() => {
  let pages = [...pageStore.pages]
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    pages = pages.filter(p => p.title.toLowerCase().includes(q))
  }
  return pages
})

const filteredPages = computed(() => {
  return pageEngine.filterSort(allPages.value, viewQuery.value, registry, queryContext.value)
})

const pageGroups = computed(() => {
  return pageEngine.run(allPages.value, viewQuery.value, registry, queryContext.value)
})

// Navigate to source page：改为右侧弹层（PageDrawer），不整页跳路由
const drawerPageId = ref<string | null>(null)
function handleNavigateToPage(pageId: string) {
  drawerPageId.value = pageId
}

// 表格单元格点击：仅标题（title 字段）跳转到源页面——跳转语义属业务层，TableView 只上报事实
function handleCellClick(pageId: string, fieldKey: string) {
  if (fieldKey !== 'title') return
  handleNavigateToPage(pageId)
}

onMounted(async () => {
  await screenViewStore.load()
  await pageStore.loadAllPages()
})
</script>

<template>
  <QueryPageFrame
    title="页面库"
    :subtitle="`${filteredPages.length} 个页面`"
    entity-key="page"
    :view-types="pageViewTypes"
    default-view-name="全部页面"
    default-view-type="table"
    v-model:search="searchQuery"
    :fields="pageRefFields"
    :registry="registry"
    :cross-record-sources="crossRecordSources"
    :items="filteredPages"
    :groups="pageGroups"
    :grouped="grouped"
    :sort="viewQuery.sort"
    :group-by="null"
    :table-config="tableConfig"
    :calendar-config="calendarConfig"
    @navigate="handleNavigateToPage"
    @cell-click="handleCellClick"
  />

  <!-- 页面详情右侧弹层（替代整页路由跳转） -->
  <PageDrawer :page-id="drawerPageId" @close="drawerPageId = null" />
</template>
