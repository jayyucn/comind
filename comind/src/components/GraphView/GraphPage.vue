<script setup lang="ts">
import { ref, computed, watch, defineAsyncComponent, onMounted, nextTick } from 'vue'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '../../stores/blocks'
import FilterPanel from './FilterPanel.vue'
import { computeVisibility, EMPTY_VISIBILITY, type FilterState, type SelectorNode, type SelectorEdge } from './graphSelectors'

const GraphView = defineAsyncComponent(() => import('./index.vue'))
const pageStore = usePageStore()
const blockStore = useBlockStore()

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

// 预加载的全量边数据
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

async function loadAllEdges() {
  const allPages = pageStore.pages.filter(p => !p.deleted)
  const edges: SelectorEdge[] = []
  const seenEdgeIds = new Set<string>()

  for (const page of allPages) {
    const outLinks = await blockStore.getOutlinks(page.id)
    for (const link of outLinks) {
      if (seenEdgeIds.has(link.id)) continue
      seenEdgeIds.add(link.id)
      edges.push({
        id: link.id,
        sourcePageId: page.id,
        targetPageId: link.targetPageId,
        relationshipType: link.relationshipType,
      })
    }
  }

  allEdges.value = edges
  edgesLoaded.value = true
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

// 页面数据变化时重新计算
watch(() => pageStore.pages, () => {
  if (edgesLoaded.value) updateVisibility()
}, { deep: false })

onMounted(async () => {
  await loadAllEdges()
  await updateVisibility()
  await measureSidebarOffset()
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
    <GraphView ref="graphViewRef" v-bind="graphProps" />
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
