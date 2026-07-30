<script setup lang="ts">
import { ref, computed, watch, defineAsyncComponent, onMounted, nextTick } from 'vue'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '../../stores/blocks'
import FilterPanel from './FilterPanel.vue'
import type { FilterState } from './FilterPanel.vue'

const GraphView = defineAsyncComponent(() => import('./index.vue'))
const pageStore = usePageStore()
const blockStore = useBlockStore()

const currentFilterState = ref<FilterState>({ conditions: [], expandedGroups: new Set() })
const highlightedNodeId = ref<string | null>(null)
const hiddenPageIds = ref<Set<string>>(new Set())
const stats = ref({ normalNodes: 0, filteredNodes: 0, normalEdges: 0, filteredEdges: 0 })

const graphViewRef = ref<InstanceType<typeof GraphView> | null>(null)
const sidebarTop = ref(0)
const sidebarHeight = ref('100%')

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

// 透传给 GraphView 的高亮节点和隐藏节点
const graphProps = computed(() => ({
  highlightedNodeId: highlightedNodeId.value,
  hiddenPageIds: hiddenPageIds.value,
}))

function applyFilterConditions(pageId: string): boolean {
  const page = pageStore.getPage(pageId)
  if (!page) return false

  for (const condition of currentFilterState.value.conditions) {
    let matches = true

    switch (condition.type) {
      case 'ideas':
        if (page.type === 'ideas') {
          matches = !!condition.value
        }
        break

      case 'time': {
        const dateRange = condition.value as { start: number | null; end: number | null }
        if (dateRange.start !== null || dateRange.end !== null) {
          const pageTime = page.createdAt
          if (dateRange.start !== null && pageTime < dateRange.start) matches = false
          if (dateRange.end !== null && pageTime >= dateRange.end) matches = false
        }
        break
      }

      case 'search': {
        const query = condition.value as string
        if (query.trim()) {
          const q = query.toLowerCase()
          if (!page.title.toLowerCase().includes(q)) matches = false
        }
        break
      }
    }

    if (!matches) {
      if (condition.logic === 'NOT') return true
      return false
    }
  }

  return true
}

function handleFilterChange(filters: FilterState) {
  currentFilterState.value = filters

  const searchCondition = filters.conditions.find(c => c.type === 'search')
  const query = (searchCondition?.value as string) ?? ''
  if (!query) {
    highlightedNodeId.value = null
  } else {
    const matched = pageStore.pages.find(p =>
      !p.deleted && p.title.toLowerCase().includes(query.toLowerCase())
    )
    highlightedNodeId.value = matched?.id ?? null
  }

  // updateStats 由 watch(currentFilterState) 触发，无需手动调
}

async function updateStats() {
  const allPages = pageStore.pages.filter(p => !p.deleted)

  const hideJournals = currentFilterState.value.conditions.some(
    c => c.type === 'ideas' && c.value === false
  )
  const newHiddenIds = new Set<string>()
  if (hideJournals) {
    for (const p of allPages) {
      if (p.type === 'ideas') newHiddenIds.add(p.id)
    }
  }

  // 先更新隐藏集合，让 GraphView 尽早拿到正确值
  hiddenPageIds.value = newHiddenIds

  const isFilteredMap = new Map<string, boolean>()
  for (const page of allPages) {
    if (newHiddenIds.has(page.id)) continue
    isFilteredMap.set(page.id, !applyFilterConditions(page.id))
  }

  let normalNodes = 0, filteredNodes = 0
  for (const page of allPages) {
    if (newHiddenIds.has(page.id)) continue
    if (isFilteredMap.get(page.id) ?? false) filteredNodes++
    else normalNodes++
  }

  // 关系类型后处理：无任何选中类型边的节点额外置灰
  const relCondition = currentFilterState.value.conditions.find(c => c.type === 'relationship')
  const selectedRelTypes = (relCondition?.value as string[]) ?? []
  if (selectedRelTypes.length > 0) {
    // 简化：只统计节点数，边统计留给 GraphView 内部
    const nodeHasSelectedType = new Set<string>()
    for (const page of allPages) {
      if (newHiddenIds.has(page.id)) continue
      const outlinks = await blockStore.getOutlinks(page.id)
      for (const link of outlinks) {
        const type = link.relationshipType ?? 'related'
        if (selectedRelTypes.includes(type)) {
          nodeHasSelectedType.add(page.id)
          nodeHasSelectedType.add(link.targetPageId)
        }
      }
    }
    for (const page of allPages) {
      if (newHiddenIds.has(page.id)) continue
      if (!nodeHasSelectedType.has(page.id) && !(isFilteredMap.get(page.id) ?? false)) {
        filteredNodes++
        normalNodes--
      }
    }
  }

  stats.value.normalNodes = normalNodes
  stats.value.filteredNodes = filteredNodes
  stats.value.normalEdges = 0
  stats.value.filteredEdges = 0
}

watch(currentFilterState, () => {
  updateStats()
}, { deep: true })

onMounted(() => {
  measureSidebarOffset()
})

// 异步组件加载后重新测量
watch(graphViewRef, () => {
  if (graphViewRef.value) measureSidebarOffset()
})

updateStats()
</script>

<template>
  <div class="graph-page">
    <div class="graph-page-sidebar">
      <div class="stats-group">
        <span class="stat-item">
          节点： <strong>{{ stats.normalNodes }}</strong> / 置灰 {{ stats.filteredNodes }}
        </span>
      </div>
      <FilterPanel @filter-change="handleFilterChange" />
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

.graph-page-sidebar {
  position: absolute;
  top: v-bind(sidebarTop + 'px');
  left: 0;
  z-index: 100;
  height: v-bind(sidebarHeight);
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  overflow: hidden;
}

.graph-page-sidebar > * {
  pointer-events: auto;
}

.stats-group {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--bg-base);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  margin-left: 12px;
  width: fit-content;
}

.stat-item strong {
  color: var(--text-primary);
}
</style>
