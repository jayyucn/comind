<script setup lang="ts">
import { ref, computed, watch, defineAsyncComponent, onMounted, nextTick } from 'vue'
import { usePageStore } from '../../stores/pages'
import FilterPanel from './FilterPanel.vue'
import { computeVisibility, EMPTY_VISIBILITY, type FilterState, type SelectorNode, type SelectorEdge } from './graphSelectors'
import { snapshotToSelectorEdges, type GraphSnapshot } from './graphData'
import { initCoreClient } from '../../wasm/client'

const GraphView = defineAsyncComponent(() => import('./index.vue'))
const pageStore = usePageStore()

// 硬性超时包装：避免下游 Promise（如 Tauri 命令）永久挂起导致整页卡死且无任何日志。
// 超时后 reject，由调用方 catch 兜底（降级为空快照），页面始终可继续加载。
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    // 附着 handler，确保底层 promise 始终被处理（不会变成 unhandled rejection）
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
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
    const client = await initCoreClient()
    console.info('[GraphPage] buildGraphSnapshot: requesting full-graph snapshot via IPC...')
    const records = await withTimeout(
      client.buildGraphSnapshot(),
      10000,
      'build_graph_snapshot (Rust command)',
    )
    const elapsed = Math.round(performance.now() - startedAt)
    graphSnapshot.value = { edges: records }
    allEdges.value = snapshotToSelectorEdges(records)
    console.info(`[GraphPage] buildGraphSnapshot: OK — ${records.length} edges in ${elapsed}ms`)
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

onMounted(async () => {
  const startedAt = performance.now()
  console.info('[GraphPage] onMounted: loading /graph page (parallel: snapshot + GraphView mount)...')
  // 并行：拉取快照 + 等待 GraphView 挂载，然后才计算可见性与侧栏偏移。
  await Promise.all([
    loadGraphSnapshot(),
    waitForGraphViewMount(),
  ])
  await updateVisibility()
  await measureSidebarOffset()
  console.info(`[GraphPage] onMounted: ready in ${Math.round(performance.now() - startedAt)}ms`)
})

watch(graphViewRef, () => {
  if (graphViewRef.value) measureSidebarOffset()
})
</script>

<template>
  <div class="graph-page">
    <div class="graph-page-sidebar">
      <FilterPanel @filter-change="handleFilterChange" @collapsed-change="handleCollapsedChange" />
    </div>
    <GraphView ref="graphViewRef" v-bind="graphProps" :graph-snapshot="graphSnapshot" @request-refresh="handleRequestRefresh" />
  </div>
</template>

<style scoped>
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

</style>
