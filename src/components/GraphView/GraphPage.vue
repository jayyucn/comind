<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePageStore } from '../../stores/pages'
import FilterPanel from './FilterPanel.vue'
import { snapshotToSelectorEdges, type GraphSnapshot } from './graphData'
import { computeVisibility, EMPTY_VISIBILITY, type FilterState, type SelectorEdge, type SelectorNode } from './graphSelectors'
import { getCachedGraphEdges, getOrFetchGraphEdges, refreshGraphSnapshotCache } from './graphSnapshotCache'

// 静态引入（非懒加载）：GraphPage 已被 routes.ts 静态引入（在首屏 entry 内），
// 故 G6 这一重依赖也一并随首屏加载，避免刷新后点图谱时该懒 chunk 的 import() 被
// dev server 模块 backlog 排队、导致画布又卡 ~2.7s 才出现。代价是首屏体积略增（桌面端可接受）。
import PageTitle from '../common/PageTitle.vue'
import GraphView from './index.vue'
const pageStore = usePageStore()

// 让出主线程给浏览器完成首帧绘制：先渲染外壳（布局 + 占位内容），
// 再启动重量级后台初始化，避免阻塞首次 paint（白屏 / 首帧卡顿）。
// 优先与渲染帧对齐的 requestAnimationFrame，隐藏标签页回退到 setTimeout(0)。
function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })
}

const currentFilterState = ref<FilterState>({
  search: '',
  relationshipTypes: [],
  timeRange: { start: null, end: null },
  showIdeas: true,
  dimIsolated: true,
})

const visibility = ref(EMPTY_VISIBILITY)
const filterPanelCollapsed = ref(true)
const sidebarWidth = computed(() => filterPanelCollapsed.value ? '0px' : '292px')

const graphViewRef = ref<InstanceType<typeof GraphView> | null>(null)
const sidebarTop = ref(0)
const sidebarHeight = ref('100%')

// 预加载的全量边快照（1 次 IPC），供筛选可见性计算与子组件复用
// 见 handoff 6.A：GraphPage 拥有快照，传给 GraphView 避免重复发起 IPC。
const graphSnapshot = ref<GraphSnapshot | null>(null)
const allEdges = ref<SelectorEdge[]>([])
const edgesLoaded = ref(false)

async function measureSidebarOffset() {
  await nextTick()
  const el = (graphViewRef.value?.$el as HTMLElement) ?? null
  if (!el) return
  const body = el.querySelector('.graph-view-body') as HTMLElement | null
  if (body) {
    sidebarTop.value = body.offsetTop
    sidebarHeight.value = `${el.clientHeight - body.offsetTop}px`
  }
}

// 一次性图谱快照：1 次 IPC 取回所有边关系（Rust 端 SQL JOIN），
// 映射为 SelectorEdge 供 computeVisibility 使用，并作为 prop 传给 GraphView 复用。
// 失败时降级为空快照（保证 edgesLoaded 置位、子组件 prop watch 仍触发），不阻塞页面。
async function loadGraphSnapshot() {
  const startedAt = performance.now()
  try {
    // 优先命中启动期预取的缓存（graphSnapshotCache），瞬时填充画布；
    // 缓存未就绪时才走 IPC。命中缓存后后台刷新，保证用户编辑链接后数据新鲜。
    const wasCached = getCachedGraphEdges() !== null
    const records = await getOrFetchGraphEdges()
    if (wasCached) refreshGraphSnapshotCache()
    graphSnapshot.value = { edges: records }
    allEdges.value = snapshotToSelectorEdges(records)
  } catch (e) {
    const elapsed = Math.round(performance.now() - startedAt)
    // 关键：即使 IPC 挂起/失败也置位 edgesLoaded，保证子组件 prop watch 触发、
    // 页面不被加载遮罩永久阻塞。若是超时，说明 Rust 命令（或其持有的 DB 锁）挂起，需进一步排查。
    console.error(
      `[GraphPage] buildGraphSnapshot FAILED after ${elapsed}ms — falling back to EMPTY graph. ` +
      `If this is a timeout, the Rust 'build_graph_snapshot' command (or a contending DB lock) is hanging. Reason:`,
      e,
    )
    graphSnapshot.value = { edges: [] }
    allEdges.value = []
  } finally {
    edgesLoaded.value = true
  }
}

// 等待异步子组件 GraphView 完成挂载，再继续可见性计算与侧栏测量。
function waitForGraphViewMount(): Promise<void> {
  if (graphViewRef.value) return Promise.resolve()
  return new Promise(resolve => {
    const stop = watch(graphViewRef, (val) => {
      if (val) {
        stop()
        resolve()
      }
    })
  })
}

const graphProps = computed(() => ({
  hiddenNodeIds: visibility.value.hiddenNodeIds,
  dimmedNodeIds: visibility.value.dimmedNodeIds,
  hiddenEdgeIds: visibility.value.hiddenEdgeIds,
}))

function handleFilterChange(filters: FilterState) {
  currentFilterState.value = filters

  if (!edgesLoaded.value) return

  const allPages: SelectorNode[] = pageStore.pages
    .filter(p => !p.deleted)
    .map(p => ({
      id: p.id,
      title: p.title,
      type: p.type,
      updatedAt: p.updatedAt,
      createdAt: p.createdAt,
      deleted: p.deleted,
    }))

  visibility.value = computeVisibility(allPages, allEdges.value, filters)
}

function handleCollapsedChange(collapsed: boolean) {
  filterPanelCollapsed.value = collapsed
}

async function updateVisibility() {
  const allPages: SelectorNode[] = pageStore.pages
    .filter(p => !p.deleted)
    .map(p => ({
      id: p.id,
      title: p.title,
      type: p.type,
      updatedAt: p.updatedAt,
      createdAt: p.createdAt,
      deleted: p.deleted,
    }))

  visibility.value = computeVisibility(allPages, allEdges.value, currentFilterState.value)
}

// 手动刷新（staleness 策略：仅手动刷新）。GraphView 内的刷新按钮通过
// request-refresh 事件冒泡到此，重新拉取快照并重新计算可见性。
async function handleRequestRefresh() {
  await loadGraphSnapshot()
  await updateVisibility()
}

// 页面数据变化时重新计算
watch(() => pageStore.pages, () => {
  if (edgesLoaded.value) updateVisibility()
}, { deep: false })

let disposed = false
onBeforeUnmount(() => { disposed = true })

onMounted(async () => {
  // 关键：先让浏览器绘制外壳（布局 + 占位内容），再启动后台加载，
  // 整个 onMounted 不阻塞在重活上，主线程空闲、页面立即可交互、无白屏。
  await nextFrame()
  // 后台并行执行：拉取快照 + 等待 GraphView 挂载，完成后才计算可见性与侧栏偏移。
  // 用 void 触发、不 await，保证 onMounted 立即返回；加载结果通过 prop 变更驱动子组件重建。
  void Promise.all([
    loadGraphSnapshot(),
    waitForGraphViewMount(),
  ]).then(async () => {
    if (disposed) return
    await updateVisibility()
    await measureSidebarOffset()
  }).catch((e) => {
    console.error('[GraphPage] background load failed:', e)
  })
})

watch(graphViewRef, () => {
  if (graphViewRef.value) measureSidebarOffset()
})
</script>

<template>
  <div class="graph-page-header">
    <PageTitle title="图谱" subtitle="已显示部分节点" />
  </div>
  <div class="graph-page">
    <div class="graph-page-sidebar">
      <FilterPanel @filter-change="handleFilterChange" @collapsed-change="handleCollapsedChange" />
    </div>
    <GraphView ref="graphViewRef" v-bind="graphProps" :graph-snapshot="graphSnapshot"
      @request-refresh="handleRequestRefresh" />
  </div>
</template>

<style scoped>
/* 标题与其它页面统一左边距（space-8 页面留白 + PageTitle 自身 space-4 内缩） */
.graph-page-header {
  padding: 0 var(--space-8);
}

.graph-page {
  position: relative;
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-base);
}

.graph-page :deep(.graph-view) {
  flex: 1;
  width: 100%;
  height: 100%;
}

.graph-page :deep(.graph-view-body) {
  padding-left: v-bind(sidebarWidth);
  transition: padding-left 200ms ease;
}
.graph-page :deep(.graph-view-body) {
}
</style>
