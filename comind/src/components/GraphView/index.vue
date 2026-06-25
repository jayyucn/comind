<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue'
import { Graph } from '@antv/g6'
import type { NodeData } from '@antv/g6'
import { usePageStore } from '../../stores/pages'
import { storage } from '../../storage/indexedDB'
import { db } from '../../storage/db'
import { getRelationshipColor, getRelationshipLabel, getDirectionInGroup, getGroupByType } from '../../types/relationship'
import { useRouter } from 'vue-router'
import SearchFilter from './SearchFilter.vue'

const pageStore = usePageStore()
const router = useRouter()

const containerRef = ref<HTMLElement | null>(null)
const graphRef = ref<Graph | null>(null)
const maxDepth = ref(2)
const currentLayout = ref<string>('force')
const highlightedNodeId = ref<string | null>(null)
const searchQuery = ref('')
const activeFilters = ref<string[]>([])
const expandedNodeIds = ref<Set<string>>(new Set())

const currentPageId = computed(() => pageStore.currentPageId)

let refreshGeneration = 0

function filterLinkByType(relationshipType: string | null | undefined): boolean {
  if (activeFilters.value.length === 0) return true
  if (!relationshipType) return false
  return activeFilters.value.includes(relationshipType)
}

function normalizeEdge(edge: { id: string; source: string; target: string; data: Record<string, unknown> }) {
  const type = edge.data.relationshipType as string
  const direction = getDirectionInGroup(type)
  const group = getGroupByType(type)
  
  if (direction === 'inverse' && group) {
    const forwardType = group.type
    return {
      id: edge.id,
      source: edge.target,
      target: edge.source,
      data: {
        ...edge.data,
        relationshipType: forwardType,
        label: getRelationshipLabel(forwardType),
        color: getRelationshipColor(forwardType),
      }
    }
  }
  return edge
}

function getEdgeDedupeKey(edge: { source: string; target: string; data: Record<string, unknown> }): string {
  const type = edge.data.relationshipType as string
  const group = getGroupByType(type)
  const groupKey = group ? group.type : type
  return `${edge.source}-${edge.target}-${groupKey}`
}

async function loadPageNodeEdges(
  pageId: string,
  nodes: NodeData[],
  edges: { id: string; source: string; target: string; data: Record<string, unknown> }[],
  visitedEdges: Set<string>,
  blockCache: Map<string, { pageId: string }>
) {
  const [outLinks, inLinks] = await Promise.all([
    storage.getLinksBySourcePage(pageId),
    storage.getLinksByTargetPage(pageId),
  ])

  for (const link of outLinks) {
    if (!filterLinkByType(link.relationshipType)) continue
    if (visitedEdges.has(link.id)) continue
    const targetPage = pageStore.getPage(link.targetPageId)
    if (!targetPage) continue

    if (!nodes.find(n => n.id === targetPage.id)) {
      nodes.push({
        id: targetPage.id,
        data: {
          label: targetPage.title,
          isCurrent: targetPage.id === currentPageId.value,
          expanded: expandedNodeIds.value.has(targetPage.id),
        }
      })
    }

    const color = getRelationshipColor(link.relationshipType ?? 'related')
    const label = getRelationshipLabel(link.relationshipType ?? 'related')
    visitedEdges.add(link.id)
    edges.push({
      id: link.id,
      source: pageId,
      target: link.targetPageId,
      data: {
        relationshipType: link.relationshipType ?? 'related',
        label,
        color
      }
    })
  }

  for (const link of inLinks) {
    if (!filterLinkByType(link.relationshipType)) continue
    if (visitedEdges.has(link.id)) continue

    let block = blockCache.get(link.sourceBlockId)
    if (!block) {
      const record = await db.blocks.get(link.sourceBlockId)
      if (!record) continue
      block = { pageId: record.pageId }
      blockCache.set(link.sourceBlockId, block)
    }

    const sourcePageId = block.pageId
    const sourcePage = pageStore.getPage(sourcePageId)
    if (!sourcePage) continue

    if (!nodes.find(n => n.id === sourcePageId)) {
      nodes.push({
        id: sourcePage.id,
        data: {
          label: sourcePage.title,
          isCurrent: sourcePage.id === currentPageId.value,
          expanded: expandedNodeIds.value.has(sourcePage.id),
        }
      })
    }

    const color = getRelationshipColor(link.relationshipType ?? 'related')
    const label = getRelationshipLabel(link.relationshipType ?? 'related')
    visitedEdges.add(link.id)
    edges.push({
      id: link.id,
      source: sourcePageId,
      target: pageId,
      data: {
        relationshipType: link.relationshipType ?? 'related',
        label,
        color
      }
    })
  }
}

async function buildGraphData() {
  const nodes: NodeData[] = []
  const edges: { id: string; source: string; target: string; data: Record<string, unknown> }[] = []
  const visitedEdges = new Set<string>()
  const blockCache = new Map<string, { pageId: string }>()

  const allPages = await storage.getAllPages()
  for (const page of allPages) {
    if (page.deleted) continue
    nodes.push({
      id: page.id,
      data: {
        label: page.title,
        isCurrent: page.id === currentPageId.value,
        expanded: expandedNodeIds.value.has(page.id),
      }
    })
  }

  const toExpand = Array.from(expandedNodeIds.value)
  for (const pid of toExpand) {
    await loadPageNodeEdges(pid, nodes, edges, visitedEdges, blockCache)
  }

  const normalizedEdges = edges.map(e => normalizeEdge(e))

  const seenKeys = new Set<string>()
  const dedupedEdges: typeof edges = []
  for (const edge of normalizedEdges) {
    const key = getEdgeDedupeKey(edge)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    dedupedEdges.push(edge)
  }

  const edgeCountMap = new Map<string, number>()
  const pairKey = (a: string, b: string) => [a, b].sort().join('-')
  for (const edge of dedupedEdges) {
    const key = pairKey(edge.source, edge.target)
    const idx = edgeCountMap.get(key) ?? 0
    edgeCountMap.set(key, idx + 1)
    if (idx === 0) {
      edge.data.curveOffset = 0
    } else {
      const sign = idx % 2 === 1 ? 1 : -1
      const magnitude = Math.ceil(idx / 2) * 20
      edge.data.curveOffset = sign * magnitude
    }
  }

  return { nodes, edges: dedupedEdges }
}

function getNodeSize(d: NodeData): [number, number] {
  const isCurrent = !!d.data?.isCurrent
  const isHighlighted = !!d.data?.isHighlighted && !isCurrent
  if (isHighlighted) return [100, 32]
  return isCurrent ? [120, 36] : [90, 28]
}

function getNodeFill(d: NodeData): string {
  const isCurrent = !!d.data?.isCurrent
  const isHighlighted = !!d.data?.isHighlighted && !isCurrent
  if (isHighlighted) return '#e6f7ff'
  return isCurrent ? '#1890ff' : '#ffffff'
}

function getNodeStroke(d: NodeData): string {
  const isCurrent = !!d.data?.isCurrent
  const isHighlighted = !!d.data?.isHighlighted && !isCurrent
  if (isHighlighted) return '#1890ff'
  return isCurrent ? '#1890ff' : '#e8e8e8'
}

function getNodeLineType(d: NodeData): 'solid' | 'dashed' {
  const expanded = !!d.data?.expanded
  return expanded ? 'solid' : 'dashed'
}

function getNodeLabelFill(d: NodeData): string {
  const isCurrent = !!d.data?.isCurrent
  const isHighlighted = !!d.data?.isHighlighted && !isCurrent
  if (isHighlighted) return '#1890ff'
  return isCurrent ? '#ffffff' : '#333333'
}

function getNodeLineWidth(d: NodeData): number {
  return (!!d.data?.isCurrent || !!d.data?.isHighlighted) ? 2 : 1
}

async function initGraph() {
  if (!containerRef.value) return

  if (graphRef.value) {
    graphRef.value.destroy()
    graphRef.value = null
  }

  const container = containerRef.value
  const width = container.clientWidth
  const height = container.clientHeight

  const graph = new Graph({
    container,
    width,
    height,
    canvas: {
      enableMultiLayer: false,
    },
    node: {
      type: 'rect',
      style: {
        size: (d: NodeData) => getNodeSize(d),
        radius: 6,
        fill: (d: NodeData) => getNodeFill(d),
        stroke: (d: NodeData) => getNodeStroke(d),
        lineWidth: (d: NodeData) => getNodeLineWidth(d),
        lineType: (d: NodeData) => getNodeLineType(d),
        labelText: (d: NodeData) => (d.data?.label as string) ?? '',
        labelPlacement: 'center',
        labelFill: (d: NodeData) => getNodeLabelFill(d),
        labelFontSize: 11,
        labelFontWeight: (d: NodeData) => d.data?.isCurrent ? 600 : d.data?.isHighlighted ? 500 : 400,
      }
    },
    edge: {
      type: 'quadratic',
      style: {
        stroke: (d: any) => d.data?.color ?? '#8c8c8c',
        strokeWidth: 1.5,
        endArrow: true,
        curveOffset: (d: any) => d.data?.curveOffset ?? 0,
        labelText: (d: any) => d.data?.label ?? '',
        labelFontSize: 9,
        labelFill: '#999999',
        labelBackground: true,
        labelBackgroundFill: '#ffffff',
        labelBackgroundOpacity: 1,
        labelBackgroundRadius: 2,
        labelBackgroundPadding: [2, 4] as [number, number],
      }
    },
    layout: {
      type: currentLayout.value,
      preventOverlap: true,
      nodeSize: 100,
    },
    behaviors: [
      'drag-canvas',
      'zoom-canvas',
      'drag-element',
    ],
    animation: true,
  })

  graph.on('node:click', (evt: any) => {
    const nodeId = evt.target?.id
    if (!nodeId) return
    handleNodeClick(nodeId)
  })

  graph.on('node:dblclick', (evt: any) => {
    const nodeId = evt.target?.id
    if (!nodeId) return
    handleNodeDoubleClick(nodeId)
  })

  graphRef.value = graph

  if (currentPageId.value && !expandedNodeIds.value.has(currentPageId.value)) {
    expandedNodeIds.value.add(currentPageId.value)
  }

  await refreshGraphData(graph)
}

async function refreshGraphData(graph?: Graph) {
  const g = graph ?? graphRef.value
  if (!g) return

  const gen = ++refreshGeneration

  const { nodes, edges } = await buildGraphData()

  if (gen !== refreshGeneration) return

  g.setData({ nodes, edges })
  await g.draw()
  await g.layout()

  if (gen !== refreshGeneration) return

  await g.fitView()
  const zoom = g.getZoom()
  await g.zoomTo(zoom * 0.85)
}

function handleDepthChange(delta: number) {
  const newVal = Math.max(1, Math.min(5, maxDepth.value + delta))
  if (newVal !== maxDepth.value) {
    maxDepth.value = newVal
  }
}

async function handleLayoutChange(layout: string) {
  currentLayout.value = layout
  if (graphRef.value) {
    graphRef.value.setLayout({ type: layout, preventOverlap: true, nodeSize: 100 })
    await graphRef.value.layout()
    await graphRef.value.fitView()
    const zoom = graphRef.value.getZoom()
    await graphRef.value.zoomTo(zoom * 0.85)
  }
}

async function handleFitView() {
  if (graphRef.value) {
    await graphRef.value.fitView()
    const zoom = graphRef.value.getZoom()
    await graphRef.value.zoomTo(zoom * 0.85)
  }
}

async function handleRefresh() {
  await refreshGraphData()
}

async function handleExportPng() {
  if (!graphRef.value) return
  try {
    const dataURL = await graphRef.value.toDataURL({
      type: 'image/png'
    })
    const link = document.createElement('a')
    link.href = dataURL
    link.download = `concept-graph-${Date.now()}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } catch (error) {
    console.error('[GraphView] PNG export failed:', error)
  }
}

function handleNodeClick(nodeId: string) {
  if (highlightedNodeId.value === nodeId) {
    highlightedNodeId.value = null
  } else {
    highlightedNodeId.value = nodeId
  }

  if (!expandedNodeIds.value.has(nodeId)) {
    expandedNodeIds.value.add(nodeId)
    refreshGraphData()
  }
  updateNodeHighlight()
}

function handleNodeDoubleClick(nodeId: string) {
  const page = pageStore.getPage(nodeId)
  if (page) {
    router.push(`/page/${page.id}`)
  }
}

function updateNodeHighlight() {
  const g = graphRef.value
  if (!g) return
  const nodeData = g.getNodeData()
  for (const node of nodeData) {
    (node.data as any).isHighlighted = node.id === highlightedNodeId.value
  }
  g.setData({ nodes: nodeData, edges: g.getEdgeData() })
  g.draw()
}

function handleSearch(query: string) {
  searchQuery.value = query
  if (!query) {
    highlightedNodeId.value = null
    updateNodeHighlight()
    return
  }

  const g = graphRef.value
  if (!g) return

  const nodeData = g.getNodeData()
  const matched = nodeData.find(n => {
    const label = (n.data?.label as string) ?? ''
    return label.toLowerCase().includes(query.toLowerCase())
  })

  if (matched) {
    highlightedNodeId.value = matched.id
    if (typeof (g as any).focus === 'function') {
      (g as any).focus(matched.id)
    }
    updateNodeHighlight()
  }
}

function handleToggleFilter(type: string) {
  const idx = activeFilters.value.indexOf(type)
  if (idx === -1) {
    activeFilters.value.push(type)
  } else {
    activeFilters.value.splice(idx, 1)
  }
}

function handleClearFilters() {
  activeFilters.value = []
}

watch(activeFilters, () => {
  refreshGraphData()
}, { deep: true })

let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  await nextTick()
  await initGraph()

  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (graphRef.value && containerRef.value) {
        graphRef.value.resize(containerRef.value.clientWidth, containerRef.value.clientHeight)
      }
    })
    resizeObserver.observe(containerRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (graphRef.value) {
    graphRef.value.destroy()
    graphRef.value = null
  }
})
</script>

<template>
  <div class="graph-view-page">
    <div class="graph-view-header">
      <h1 class="graph-view-title"></h1>
      <div class="graph-view-controls">
        <div class="control-group">
          <span class="control-label">深度</span>
          <button class="control-btn" @click="handleDepthChange(-1)">−</button>
          <span class="control-value">{{ maxDepth }}</span>
          <button class="control-btn" @click="handleDepthChange(1)">+</button>
        </div>
        <div class="control-group">
          <button
            v-for="layout in ['force', 'radial', 'dagre']"
            :key="layout"
            class="layout-btn"
            :class="{ active: currentLayout === layout }"
            @click="handleLayoutChange(layout)"
          >
            {{ layout === 'force' ? '力导向' : layout === 'radial' ? '径向' : '层级' }}
          </button>
        </div>
        <div class="control-group">
          <button class="control-btn" title="适应视图" @click="handleFitView">⊞</button>
          <button class="control-btn" title="刷新" @click="handleRefresh">↻</button>
          <button class="control-btn" title="导出 PNG" @click="handleExportPng">⤓</button>
        </div>
      </div>
    </div>
    <SearchFilter
      :search-query="searchQuery"
      :active-filters="activeFilters"
      @update:search-query="handleSearch"
      @toggle-filter="handleToggleFilter"
      @clear-filters="handleClearFilters"
    />
    <div ref="containerRef" class="graph-view-canvas"></div>
  </div>
</template>

<style scoped>
.graph-view-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-base);
}

.graph-view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.graph-view-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  padding-top: 20px;
}

.graph-view-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.control-label {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-right: 4px;
}

.control-value {
  font-size: 12px;
  color: var(--text-primary);
  font-weight: 500;
  min-width: 18px;
  text-align: center;
}

.control-btn {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  background: var(--bg-base);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-secondary);
  font-family: inherit;
  transition: background 80ms ease;
}

.control-btn:hover {
  background: var(--bg-hover);
}

.layout-btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  background: var(--bg-base);
  cursor: pointer;
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: inherit;
  transition: background 80ms ease, color 80ms ease;
}

.layout-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.layout-btn.active {
  background: var(--bg-active);
  color: var(--text-primary);
  font-weight: 500;
  border-color: #1890ff;
}

.graph-view-canvas {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
