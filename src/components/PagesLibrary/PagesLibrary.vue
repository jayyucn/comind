<script setup lang="ts">
import { BookOpen, BookPlus, CalendarDays, LayoutGrid } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { createQueryEngine } from '../../core/query'
import {
  getPageRegistry,
  LIBRARY_TAB_QUERY,
  PAGE_DEFAULT_CALENDAR_CONFIG,
  PAGE_DEFAULT_GALLERY_CONFIG,
  PAGE_DEFAULT_TABLE_CONFIG,
  PAGE_ENTITY,
  pageDefaultConfig,
  pageViewKinds,
  type PageViewKind,
} from '../../composables/usePageQueryRegistry'
import type { QueryContext, ViewQuery } from '../../core/query'
import { parseLayoutConfig, type CalendarConfig, type GalleryConfig, type TableConfig } from '../../core/view'
import type { ViewTypeOption } from '../../core/view/management'
import { usePageStore } from '../../stores/pages'
import { useScreenViewStore } from '../../stores/screenView'
import { openReaderWindow } from '../../composables/useReaderWindow'
import { importEpub } from '../../services/book-import'
import { loadBookGalleryProgress } from '../../services/book-progress'
import { isTauriEnvironment } from '../../wasm/tauri-platform'
import type { Page } from '../../types/page'
import QueryPageFrame from '../common/QueryPageFrame.vue'
import PageDrawer from '../Page/PageDrawer.vue'
import TableView from '../views/TableView.vue'
import CalendarView from '../views/CalendarView.vue'
import GalleryView from '../views/GalleryView.vue'

defineOptions({ name: 'PagesLibrary' })

// 跨端（票 08 / ADR-0040 D2）：书房（gallery）仅桌面端——web/Android 无阅读器，
// 书房 tab 不出现；书 Page 本身照常作为普通笔记页打开（阅读入口只在桌面显示）。
const isDesktop = isTauriEnvironment()

const pageStore = usePageStore()
// 命名视图 store（与 QueryPageFrame 内部同 key 单例共享；此处读取 currentTab/workingQuery）。
// 首建注入实体默认布局（pageDefaultConfig）——seed/create 时写入 Page 正确的 config（ADR-0023 上游修复）。
const screenViewStore = useScreenViewStore('page', { defaultConfig: pageDefaultConfig })
const registry = getPageRegistry()
// 统一引擎：实体类型在工厂创建时绑定（ADR-0022 Q7）
const pageEngine = createQueryEngine<Page>(PAGE_ENTITY)

// page 实体可选的视图类型（注入 QueryPageFrame → NamedViewBar；类型创建后固定。
// 同时决定外壳渲染哪几个视图——table/calendar + 桌面端 gallery 书房，不含 board）
const VIEW_TYPE_META: Record<PageViewKind, { label: string; icon: typeof LayoutGrid }> = {
  table: { label: '表格', icon: LayoutGrid },
  calendar: { label: '日历', icon: CalendarDays },
  gallery: { label: '书房', icon: BookOpen },
}
const pageViewTypes: ViewTypeOption[] = pageViewKinds(isDesktop).map((key) => ({ key, ...VIEW_TYPE_META[key] }))

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
const galleryConfig = computed<GalleryConfig>(() =>
  (parseLayoutConfig(screenViewStore.currentTab?.config, 'gallery') as GalleryConfig | null) ?? PAGE_DEFAULT_GALLERY_CONFIG,
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
  const pages = pageEngine.filterSort(allPages.value, viewQuery.value, registry, queryContext.value)
  // 书房（gallery）数据源兜底（票 08 / ADR-0040 D9）：书房卡片是阅读器入口（openReaderWindow），
  // items 必须全是书 Page。不依赖书房 tab 的保存查询——种子 LIBRARY_TAB_QUERY 虽已 type=book，
  // 但 tab 查询可被用户复制/改动而漂移，故在供给层强制排除 type !== 'book' 的页面。
  return screenViewStore.currentViewType === 'gallery' ? pages.filter((p) => p.type === 'book') : pages
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

// ── 书房（票 08 / ADR-0040 D9）：gallery 视图 tab 的种子、进度与导入 ──

/**
 * 书房 tab 种子：桌面端确保存在一个 gallery 视图 tab（查询 type=book）。
 * 已存在（含用户复制出的副本）则跳过；被删除后下次进入重建——桌面端保证书房入口常在（v1 语义）。
 * web/Android 不调用（书房 tab 不出现，ADR-0040 D2）。
 */
async function ensureLibraryTab(): Promise<void> {
  if (screenViewStore.views.some((v) => v.view_type === 'gallery')) return
  const prevTabId = screenViewStore.currentTabId
  await screenViewStore.createTab('书房', 'gallery', LIBRARY_TAB_QUERY)
  // 种子后回到用户原本所在的 tab（createTab 末尾会选中新 tab）
  if (prevTabId && prevTabId !== screenViewStore.currentTabId) {
    await screenViewStore.selectTab(prevTabId)
  }
}

/** 书房卡片进度（bookPageId → 0~1）；进度数据仅桌面本地（ADR-0040 D5） */
const bookProgress = ref<Record<string, number>>({})

async function refreshBookProgress(): Promise<void> {
  if (!isDesktop) return
  const bookIds = pageStore.pages.filter((p) => p.type === 'book').map((p) => p.id)
  bookProgress.value = await loadBookGalleryProgress(bookIds)
}

/** 书房卡片点击 → 开阅读器独立窗口（复用票 03 入口；gallery 仅桌面注册，web 不会走到这里） */
function handleOpenReader(bookId: string): void {
  void openReaderWindow(bookId)
}

const importing = ref(false)

/** 书房导入入口（票 08）：复用票 01 的导入 service；完成后刷新书 Page，网格即时出现新书 */
async function handleImportEpub(): Promise<void> {
  if (importing.value) return
  importing.value = true
  try {
    const page = await importEpub()
    if (page) {
      await pageStore.loadAllPages()
      await refreshBookProgress()
    }
  } catch (e) {
    console.error('[书房] 导入 EPUB 失败:', e)
  } finally {
    importing.value = false
  }
}

onMounted(async () => {
  await screenViewStore.load()
  await pageStore.loadAllPages()
  if (isDesktop) {
    await ensureLibraryTab()
    await refreshBookProgress()
    // 阅读器窗口关掉回到主窗口时刷新进度环（ADR-0040 D4 focus 兜底）
    window.addEventListener('focus', refreshBookProgress)
  }
})

onBeforeUnmount(() => {
  if (isDesktop) window.removeEventListener('focus', refreshBookProgress)
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
    :gallery-config="galleryConfig"
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
        @cell-click="handleCellClick"
      />
    </template>
    <template #calendar="{ context }">
      <CalendarView
        :items="context.items"
        :fields="context.fields"
        :config="context.calendarConfig"
        :id-key="context.idKey"
        @navigate="handleNavigateToPage"
      />
    </template>
    <!-- 书房（票 08 / ADR-0040 D9）：封面网格 + 导入入口；卡片点击开阅读器窗口（仅桌面注册） -->
    <template #gallery="{ context }">
      <div class="library-gallery">
        <div class="library-toolbar">
          <button class="import-epub-btn" :disabled="importing" @click="handleImportEpub">
            <BookPlus :size="14" />
            {{ importing ? '导入中…' : '导入 EPUB' }}
          </button>
        </div>
        <GalleryView
          :items="context.items"
          :fields="context.fields"
          :config="galleryConfig"
          :progress="bookProgress"
          @navigate="handleOpenReader"
        >
          <template #empty>
            <BookOpen :size="40" class="empty-icon" />
            <p class="empty-hint">书房还是空的，导入第一本 EPUB 开始阅读</p>
            <button class="import-epub-btn primary" :disabled="importing" @click="handleImportEpub">
              <BookPlus :size="14" />
              {{ importing ? '导入中…' : '导入 EPUB' }}
            </button>
          </template>
        </GalleryView>
      </div>
    </template>
  </QueryPageFrame>

  <!-- 页面详情右侧弹层（替代整页路由跳转） -->
  <PageDrawer :page-id="drawerPageId" @close="drawerPageId = null" />
</template>

<style lang="scss" scoped>
// 书房 gallery 区域：工具栏（导入入口）+ 封面网格（票 08）
.library-gallery {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.library-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 0 12px 8px;
  flex: none;
}

.import-epub-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-base);
  color: var(--text-secondary);
  font: 500 var(--text-xs, 0.75rem)/1 var(--font-sans, sans-serif);
  cursor: pointer;
  transition: all 120ms ease;

  &:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-03);
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }

  &.primary {
    background: var(--accent);
    border-color: transparent;
    color: #141417;
    font-weight: 600;

    &:hover:not(:disabled) {
      background: #93a1fa;
    }
  }
}

.empty-icon {
  color: var(--text-tertiary);
  opacity: 0.5;
}

.empty-hint {
  margin: 0;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
</style>
