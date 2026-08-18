<script setup lang="ts">
import { CalendarDays, LayoutGrid } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { filterSortPages, runPageQuery } from '../../composables/usePageQueryEngine'
import { getPageRegistry, PAGE_ENTITY } from '../../composables/usePageQueryRegistry'
import type { QueryContext, ViewQuery } from '../../core/query'
import type { ViewTypeOption } from '../../core/view/management'
import { usePageStore } from '../../stores/pages'
import { useScreenViewStore } from '../../stores/screenView'
import type { Page } from '../../types/page'
import PageTitle from '../common/PageTitle.vue'
import NamedViewBar from '../common/NamedViewBar.vue'
import QueryChipBar from '../query/QueryChipBar.vue'
import QueryToolbar from '../query/QueryToolbar.vue'
import PageCalendarView from './PageCalendarView.vue'
import PageTableView from './PageTableView.vue'

defineOptions({ name: 'PagesLibrary' })

const pageStore = usePageStore()
const screenViewStore = useScreenViewStore('page')
const registry = getPageRegistry()

// page 实体可选的视图类型（注入 NamedViewBar；类型创建后固定）
const pageViewTypes: ViewTypeOption[] = [
  { key: 'table', label: '表格', icon: LayoutGrid },
  { key: 'calendar', label: '日历', icon: CalendarDays },
]

// 当前激活 tab 的可编辑查询（单一数据源：NamedViewBar 的保存/清除/切换均作用于它）
const viewQuery = computed<ViewQuery>(() => screenViewStore.workingQuery)
const viewMode = computed(() => screenViewStore.currentViewType as 'table' | 'calendar')
const searchQuery = ref('')

// 芯片行显隐（Filter 按钮切换展开/收起）
const chipBarVisible = ref(false)
const chipBarRef = ref<InstanceType<typeof QueryChipBar> | null>(null)

// Header 三按钮激活态
const hasFilter = computed(() => viewQuery.value.filter.children.length > 0)
const hasSort = computed(() => viewQuery.value.sort.length > 0)
const hasGroup = computed(() => viewQuery.value.groupBy !== null)

// Header 三按钮处理（筛选/排序/分组共用）
// chipbar 的显隐与「toolbar 请求如何处理」的策略均已内聚到 QueryChipBar
// （openToolbarMenu：选中字段后由它自行显示并锚定 popover；toolbar 点击的 toggle/开菜单分支也由它决定）。
// 父级只把按钮点击转发给 chipBarRef.openToolbarMenu，并通过 visible-change 同步 chipBarVisible
// 给 QueryToolbar 的描边态。hasFilter/hasSort/hasGroup 仍留此处，仅用于 QueryToolbar 的按钮描边态。
function openChipMenu(kind: 'filter' | 'sort' | 'group', e: MouseEvent) {
  chipBarRef.value?.openToolbarMenu(kind, e.currentTarget as HTMLElement)
}

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
  return filterSortPages(allPages.value, viewQuery.value, registry, PAGE_ENTITY, queryContext.value)
})

const pageGroups = computed(() => {
  return runPageQuery(allPages.value, viewQuery.value, registry, PAGE_ENTITY, queryContext.value)
})

onMounted(async () => {
  await screenViewStore.load()
  await pageStore.loadAllPages()
})
</script>

<template>
  <div class="pages-library">
    <PageTitle title="页面库" :subtitle="`${filteredPages.length} 个页面`" />

    <!-- 视图管理（Screen→Tab 两级 + 查询工具条 + 未保存提示均内聚于 NamedViewBar） -->
    <NamedViewBar entity-key="page" :view-types="pageViewTypes" default-view-name="全部页面" default-view-type="table">
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
    </NamedViewBar>

    <!-- 筛选芯片行（QueryToolbar 三按钮唤起；绑定 store.workingQuery） -->
    <QueryChipBar
      ref="chipBarRef"
      :model-value="screenViewStore.workingQuery"
      :fields="pageRefFields"
      :registry="registry"
      :entity-type="PAGE_ENTITY"
      :cross-record-sources="crossRecordSources"
      @update:model-value="screenViewStore.setWorkingQuery"
      @visible-change="chipBarVisible = $event"
    />

    <!-- 主内容区 -->
    <main class="lib-body">
      <PageTableView v-if="viewMode === 'table'" :pages="filteredPages" :groups="pageGroups" />
      <PageCalendarView v-else :pages="filteredPages" />
    </main>
  </div>
</template>

<style scoped>
.pages-library {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0 var(--space-8);
  min-height: 0;
  overflow: hidden;
  background: var(--bg-base);
}

/* 主内容 */
.lib-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px;
}
</style>
