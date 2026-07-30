<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, nextTick, watch } from 'vue'
import { Graph } from '@antv/g6'
import type { EdgeData, NodeData } from '@antv/g6'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '../../stores/blocks'
import { getRelationshipStrength, STRENGTH_TO_WIDTH } from '../../types/relationship'
import { useRouter } from 'vue-router'
import { Download, ExpandIcon, RefreshCw } from 'lucide-vue-next'
import { getNodeStyle, getEdgeStyle } from './graphStyle'
import { createAccumulator, traverseBFS, buildFullGraph, type RawLink } from './graphData'

const pageStore = usePageStore()
const blockStore = useBlockStore()
const router = useRouter()

const props = defineProps<{
  highlightedNodeId?: string | null
  pageId?: string
  hiddenPageIds?: Set<string>
}>()

const containerRef = ref<HTMLElement | null>(null)
const graphRef = ref<Graph | null>(null)
const currentLayout = ref<string>('force')
const highlightedNodeId = ref<string | null>(null)
const isFirstLayoutDone = ref(false)

const currentPageId = computed(() => props.pageId ?? pageStore.currentPageId)
const maxDepth = ref(2)
const isPageScoped = computed(() => !!props.pageId)

let refreshGeneration = 0

watch(() => props.highlightedNodeId, (val) => {
  highlightedNodeId.value = val ?? null
  if (graphRef.value) updateNodeHighlight()
})

watch(() => props.hiddenPageIds, () => {
  if (graphRef.value) refreshGraphData()
}, { deep: true })

watch(currentPageId, () => refreshGraphData())

watch(maxDepth, () => {
  if (isPageScoped.value) refreshGraphData()
})

/** I/O 层：加载指定页面的 outlinks 和 backlinks */
async function fetchNeighbors(pageId: string): Promise<{ outLinks: RawLink[]; inLinks: RawLink[] }> {
  await blockStore.loadMultiPageBlocks([pageId])
  const outLinks = await blockStore.getOutlinks(pageId)
  const inLinks = await blockStore.getBacklinks(pageId)
  return { outLinks, inLinks }
}

/** 编排器：构建图数据 */
async function buildGraphData() {
  const hidden = props.hiddenPageIds ?? new Set<string>()
  const acc = createAccumulator()
  const getPage = (id: string) => pageStore.getPage(id)
  const getBlock = (id: string) => blockStore.getBlock(id)

  if (!isPageScoped.value) {
    const allPages = pageStore.pages.filter(p => !p.deleted)
    await buildFullGraph(allPages, acc, hidden, currentPageId.value, highlightedNodeId.value, getPage, fetchNeighbors, getBlock)
  } else {
    const rootId = currentPageId.value
    if (rootId) {
      await traverseBFS(rootId, maxDepth.value, acc, hidden, currentPageId.value, highlightedNodeId.value, getPage, fetchNeighbors, getBlock)
    }
  }
  return { nodes: acc.nodes, edges: acc.edges }
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
    padding: [100, 40, 20, 100],
    canvas: {
      enableMultiLayer: false,
    },
    node: {
      type: 'rect',
      style: {
        size: (d: NodeData) => getNodeStyle(d).size,
        radius: 6,
        fill: (d: NodeData) => getNodeStyle(d).fill,
        fillOpacity: (d: NodeData) => getNodeStyle(d).fillOpacity,
        stroke: (d: NodeData) => getNodeStyle(d).stroke,
        lineWidth: (d: NodeData) => getNodeStyle(d).lineWidth,
        lineType: (d: NodeData) => getNodeStyle(d).lineType,
        strokeOpacity: (d: NodeData) => getNodeStyle(d).strokeOpacity,
        labelText: (d: NodeData) => (d.data?.label as string) ?? '',
        labelPlacement: 'center',
        labelFill: (d: NodeData) => getNodeStyle(d).labelFill,
        labelFontSize: 11,
        labelFontWeight: (d: NodeData) => getNodeStyle(d).fontWeight,
      }
    },
    edge: {
      type: 'quadratic',
      style: {
        stroke: (d: any) => d.data?.isFiltered ? getEdgeStyle(d).stroke : (d.data?.color ?? getEdgeStyle(d).stroke),
        strokeOpacity: (d: any) => getEdgeStyle(d).strokeOpacity,
        strokeWidth: (d: any) => STRENGTH_TO_WIDTH[getRelationshipStrength((d.data?.relationshipType as string) ?? 'related')],
        endArrow: true,
        curveOffset: (d: any) => d.data?.curveOffset ?? 0,
        labelText: (d: any) => d.data?.label ?? '',
        labelFontSize: 9,
        labelFill: (d: any) => getEdgeStyle(d).labelFill,
        labelBackground: true,
        labelBackgroundFill: '#ffffff',
        labelBackgroundOpacity: 1,
        labelBackgroundRadius: 2,
        labelBackgroundPadding: [2, 4] as [number, number],
        endPointOffset: (d: any) => d.data?.endPointOffset ?? [0, 0],
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
    animation: false,
  })

  graph.on('afterlayout', () => {
    if (!isFirstLayoutDone.value) {
      isFirstLayoutDone.value = true
    }
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

  await refreshGraphData(graph)
}

async function refreshGraphData(graph?: Graph) {
  const g = graph ?? graphRef.value
  if (!g) return

  const gen = ++refreshGeneration

  const { nodes, edges } = await buildGraphData()

  if (gen !== refreshGeneration) return

  g.setData({ nodes, edges: edges as EdgeData[] })
  await g.draw()
  await g.layout()

  if (gen !== refreshGeneration) return

  await g.fitView({ when: 'always' }, false)
}

async function handleLayoutChange(layout: string) {
  currentLayout.value = layout
  if (graphRef.value) {
    graphRef.value.setLayout({ type: layout, preventOverlap: true, nodeSize: 100, animate: isFirstLayoutDone.value })
    await graphRef.value.layout()
    await graphRef.value.fitView({ when: 'always' }, false)
  }
}

async function handleFitView() {
  if (graphRef.value) {
    await graphRef.value.fitView({ when: 'always' }, false)
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
  <div class="graph-view">
    <div class="graph-view-header">
      <h1 class="graph-view-title">图谱</h1>
      <div class="graph-view-controls">
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
          <button class="control-btn" title="适应视图" @click="handleFitView"><ExpandIcon /></button>
          <button class="control-btn" title="刷新" @click="handleRefresh"><RefreshCw /></button>
          <button class="control-btn" title="导出 PNG" @click="handleExportPng"><Download /></button>
        </div>
        <div v-if="isPageScoped" class="depth-control">
          <span class="depth-label">层级</span>
          <div class="depth-options">
            <button
              v-for="d in [1, 2, 3]"
              :key="d"
              class="depth-btn"
              :class="{ active: maxDepth === d }"
              @click="maxDepth = d"
            >{{ d }}</button>
          </div>
        </div>
      </div>
    </div>
    <div class="graph-view-body">
      <div ref="containerRef" class="graph-view-canvas">
        <div v-if="!isFirstLayoutDone" class="graph-loading-overlay">
          <div class="loading-spinner"></div>
          <span>加载中...</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-base);
}

.graph-view-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 0 16px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.graph-view-body {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
}

.graph-view-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
}

.graph-view-controls {
  display: flex;
  align-items: center;
  gap: 16px;
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
  width: var(--icon-size);
  height: var(--icon-size);
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
  background: var(--bg-sidebar);
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
  position: relative;
}

.graph-loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg-base);
  z-index: 10;
  gap: 8px;
}

.graph-loading-overlay .loading-spinner {
  width: 28px;
  height: 28px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.graph-loading-overlay span {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}

.depth-control {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.depth-label {
  font-size: 11px;
  color: var(--text-tertiary);
  font-weight: 500;
}

.depth-options {
  display: flex;
  align-items: center;
  gap: 2px;
}

.depth-btn {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  background: var(--bg-base);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-secondary);
  font-family: inherit;
  transition: background 80ms ease, color 80ms ease, border-color 80ms ease;
}

.depth-btn:hover {
  background: var(--bg-hover);
}

.depth-btn.active {
  background: #1890ff;
  color: #fff;
  border-color: #1890ff;
  font-weight: 600;
}
</style>
