<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { usePageStore } from '../../stores/pages'
import { getPageRegistry, PAGE_ENTITY } from '../../composables/usePageQueryRegistry'
import { runPageQuery, filterSortPages } from '../../composables/usePageQueryEngine'
import type { QueryContext, ViewQuery } from '../../core/query'
import type { Page } from '../../types/page'
import PageTableView from './PageTableView.vue'
import PageCalendarView from './PageCalendarView.vue'
import FilterBuilder from '../query/FilterBuilder.vue'
import FilterChipBar from '../query/FilterChipBar.vue'
import { X, Search, LayoutGrid, CalendarDays, Filter, ArrowUpDown, Group } from 'lucide-vue-next'

defineOptions({ name: 'PagesLibrary' })

const pageStore = usePageStore()
const registry = getPageRegistry()

// 视图模式
type ViewMode = 'table' | 'calendar'
const viewMode = ref<ViewMode>('table')

// 筛选状态
const viewQuery = ref<ViewQuery>({
  version: 1,
  filter: { combinator: 'and', children: [] },
  sort: [],
  groupBy: null,
})
const showFilterPanel = ref(false)
const searchQuery = ref('')

// 芯片行显隐（Filter 按钮切换展开/收起）
const chipBarVisible = ref(false)
const chipBarRef = ref<InstanceType<typeof FilterChipBar> | null>(null)

// Header 三按钮激活态
const hasFilter = computed(() => viewQuery.value.filter.children.length > 0)
const hasSort = computed(() => viewQuery.value.sort.length > 0)
const hasGroup = computed(() => viewQuery.value.groupBy !== null)

// Header 按钮处理
function onFilterClick() {
  chipBarVisible.value = !chipBarVisible.value
}
function openChipMenu(kind: 'sort' | 'group', e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  chipBarVisible.value = true
  nextTick(() => {
    if (kind === 'sort') chipBarRef.value?.openSortMenu(el)
    else chipBarRef.value?.openGroupMenu(el)
  })
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
  await pageStore.loadAllPages()
})
</script>

<template>
  <div class="pages-library">
    <!-- 顶栏 -->
    <header class="lib-header">
      <div class="header-left">
        <h1 class="lib-title">页面库</h1>
        <span class="lib-count">{{ filteredPages.length }} 个页面</span>
      </div>

      <div class="header-actions">
        <!-- 搜索 -->
        <div class="search-box">
          <Search :size="14" :stroke-width="1.5" class="search-icon" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索标题..."
            class="search-input"
          />
        </div>

        <!-- 视图切换 -->
        <div class="view-switcher">
          <button
            :class="{ active: viewMode === 'table' }"
            title="表格视图"
            @click="viewMode = 'table'"
          >
            <LayoutGrid :size="15" />
          </button>
          <button
            :class="{ active: viewMode === 'calendar' }"
            title="日历视图"
            @click="viewMode = 'calendar'"
          >
            <CalendarDays :size="15" />
          </button>
        </div>

        <!-- 筛选 / 排序 / 分组 三按钮 -->
        <button
          class="hdr-btn"
          :class="{ active: hasFilter, collapsed: hasFilter && !chipBarVisible }"
          title="筛选"
          @click="onFilterClick"
        >
          <Filter :size="15" />
        </button>
        <button
          class="hdr-btn"
          :class="{ active: hasSort }"
          title="排序"
          @click="openChipMenu('sort', $event)"
        >
          <ArrowUpDown :size="15" />
        </button>
        <button
          class="hdr-btn"
          :class="{ active: hasGroup }"
          title="分组"
          @click="openChipMenu('group', $event)"
        >
          <Group :size="15" />
        </button>
      </div>
    </header>

    <!-- 筛选芯片行（Header 与 主内容之间） -->
    <Transition name="slide">
      <FilterChipBar
        v-if="chipBarVisible"
        ref="chipBarRef"
        v-model="viewQuery"
        :fields="pageRefFields"
        @open-advanced="showFilterPanel = true"
      />
    </Transition>

    <!-- 高级筛选面板（可折叠，经「高级筛选」进入） -->
    <Transition name="slide">
      <div v-if="showFilterPanel" class="filter-panel">
        <div class="filter-panel-header">
          <span class="filter-panel-title">筛选条件</span>
          <button class="filter-close" @click="showFilterPanel = false">
            <X :size="14" />
          </button>
        </div>
        <FilterBuilder
          :registry="registry"
          :entity-type="PAGE_ENTITY"
          :cross-record-sources="crossRecordSources"
          v-model="viewQuery"
        />
      </div>
    </Transition>

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
  min-height: 0;
  overflow: hidden;
  background: var(--bg-base);
}

/* ── 顶栏 ── */
.lib-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  gap: 16px;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.lib-title {
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
}

.lib-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* 搜索 */
.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base2);
  width: 200px;
  transition: border-color 120ms ease, background 120ms ease;
}

.search-box:focus-within {
  border-color: var(--accent, #6366f1);
  background: var(--bg-base);
}

.search-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.search-input {
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--text-sm);
  color: var(--text-primary);
  width: 100%;
  min-width: 0;
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

/* 视图切换器 */
.view-switcher {
  display: flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.view-switcher button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 30px;
  border: none;
  background: var(--bg-base);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background 80ms ease, color 80ms ease;
}

.view-switcher button:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.view-switcher button.active {
  background: var(--accent-bg, rgba(99, 102, 241, 0.1));
  color: var(--accent, #6366f1);
}

/* 筛选 / 排序 / 分组 三按钮 */
.hdr-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background 80ms ease, color 80ms ease, border-color 120ms ease;
}

.hdr-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

/* 有筛选/排序/分组时的激活态（filled） */
.hdr-btn.active {
  border-color: var(--accent, #6366f1);
  color: var(--accent, #6366f1);
  background: var(--accent-bg, rgba(99, 102, 241, 0.08));
}

/* 有筛选但芯片行被收起（仅描边，提示「有筛选但隐藏」） */
.hdr-btn.collapsed {
  border-color: var(--accent, #6366f1);
  color: var(--accent, #6366f1);
  background: transparent;
}

/* ── 筛选面板 ── */
.filter-panel {
  border-bottom: 1px solid var(--border);
  background: var(--bg-base2);
  padding: 12px 20px;
  flex-shrink: 0;
  max-height: 400px;
  overflow-y: auto;
}

.filter-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.filter-panel-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-secondary);
}

.filter-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background 80ms ease;
}

.filter-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* ── 主内容 ── */
.lib-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px;
}

/* ── 过渡动画 ── */
.slide-enter-active,
.slide-leave-active {
  transition: all 200ms ease;
  overflow: hidden;
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.slide-enter-to,
.slide-leave-from {
  opacity: 1;
  max-height: 400px;
}
</style>
