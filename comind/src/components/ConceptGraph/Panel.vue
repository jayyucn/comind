<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { Graph } from '@antv/g6'
import type { NodeData } from '@antv/g6'
import { usePageStore } from '../../stores/pages'
import { storage } from '../../storage/indexedDB'
import { db } from '../../storage/db'
import { useNavigateToPage } from '../../composables/useNavigateToPage'
import { getRelationshipColor } from '../../types/relationship'

const pageStore = usePageStore()
const { navigateToPage } = useNavigateToPage()

const containerRef = ref<HTMLElement | null>(null)
const graphRef = ref<Graph | null>(null)
const maxDepth = ref(2)
const currentLayout = ref<string>('force')
const showEdgeLabels = ref(true)

const currentPageId = computed(() => pageStore.currentPageId)

async function buildGraphData(pageId: string, depth: number) {
  const nodes: NodeData[] = []
  const edges: { id: string; source: string; target: string; data: Record<string, unknown> }[] = []
  const visited = new Set<string>()

  async function traverse(pid: string, level: number) {
    if (level > depth || visited.has(pid)) return
    visited.add(pid)

    const page = pageStore.getPage(pid)
    if (!page) return

    nodes.push({
      id: page.id,
      data: {
        label: page.title,
        isCurrent: page.id === pageId,
        level
      }
    })

    const outLinks = await storage.getLinksBySourcePage(pid)
    const inLinks = await storage.getLinksByTargetPage(pid)

    for (const link of outLinks) {
      const targetPage = pageStore.getPage(link.targetPageId)
      if (!targetPage) continue
      const color = getRelationshipColor(link.relationshipType ?? 'related')
      edges.push({
        id: link.id,
        source: pid,
        target: link.targetPageId,
        data: {
          relationshipType: link.relationshipType ?? 'related',
          label: link.relationshipType ?? '',
          color
        }
      })
      await traverse(link.targetPageId, level + 1)
    }

    for (const link of inLinks) {
      const block = await db.blocks.get(link.sourceBlockId)
      if (!block) continue
      const sourcePageId = block.pageId
      const sourcePage = pageStore.getPage(sourcePageId)
      if (!sourcePage) continue
      const edgeId = `inv-${link.id}`
      if (edges.find(e => e.id === edgeId)) continue
      const color = getRelationshipColor(link.relationshipType ?? 'related')
      edges.push({
        id: edgeId,
        source: sourcePageId,
        target: pid,
        data: {
          relationshipType: link.relationshipType ?? 'related',
          label: link.relationshipType ?? '',
          color
        }
      })
      await traverse(sourcePageId, level + 1)
    }
  }

  await traverse(pageId, 0)
  return { nodes, edges }
}

function getNodeSize(isCurrent: boolean): [number, number] {
  return isCurrent ? [120, 36] : [90, 28]
}

function getNodeFill(isCurrent: boolean): string {
  return isCurrent ? '#1890ff' : '#ffffff'
}

function getNodeStroke(isCurrent: boolean): string {
  return isCurrent ? '#1890ff' : '#e8e8e8'
}

function getNodeLabelFill(isCurrent: boolean): string {
  return isCurrent ? '#ffffff' : '#333333'
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
    autoFit: 'view',
    node: {
      type: 'rect',
      style: {
        size: (d: NodeData) => getNodeSize(!!d.data?.isCurrent),
        radius: 6,
        fill: (d: NodeData) => getNodeFill(!!d.data?.isCurrent),
        stroke: (d: NodeData) => getNodeStroke(!!d.data?.isCurrent),
        lineWidth: 1,
        labelText: (d: NodeData) => (d.data?.label as string) ?? '',
        labelFill: (d: NodeData) => getNodeLabelFill(!!d.data?.isCurrent),
        labelFontSize: 11,
        labelFontWeight: (d: NodeData) => d.data?.isCurrent ? 600 : 400,
      }
    },
    edge: {
      type: 'line',
      style: {
        stroke: (d: any) => d.data?.color ?? '#8c8c8c',
        strokeWidth: 1.5,
        endArrow: true,
        labelText: (d: any) => showEdgeLabels.value ? (d.data?.label ?? '') : '',
        labelFontSize: 9,
        labelFill: '#999999',
        labelBackground: true,
        labelBackgroundFill: '#fafafa',
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
    if (nodeId && nodeId !== currentPageId.value) {
      navigateToPage(nodeId)
    }
  })

  graphRef.value = graph

  if (currentPageId.value) {
    await refreshGraphData(graph)
  }

  await graph.render()
}

async function refreshGraphData(graph?: Graph) {
  const g = graph ?? graphRef.value
  if (!g || !currentPageId.value) return

  const { nodes, edges } = await buildGraphData(currentPageId.value, maxDepth.value)

  g.setData({ nodes, edges })
  await g.render()
  await g.fitView()
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
  }
}

async function handleFitView() {
  if (graphRef.value) {
    await graphRef.value.fitView()
  }
}

async function handleRefresh() {
  await refreshGraphData()
}

watch(currentPageId, async () => {
  await refreshGraphData()
})

watch(maxDepth, async () => {
  await refreshGraphData()
})

let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
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
  <div class="concept-graph-panel">
    <div class="concept-graph-controls">
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
      </div>
    </div>
    <div ref="containerRef" class="concept-graph-canvas"></div>
  </div>
</template>

<style scoped>
.concept-graph-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.concept-graph-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.control-label {
  font-size: 10px;
  color: var(--text-tertiary);
  margin-right: 2px;
}

.control-value {
  font-size: 11px;
  color: var(--text-primary);
  font-weight: 500;
  min-width: 14px;
  text-align: center;
}

.control-btn {
  width: 22px;
  height: 22px;
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
  transition: background 80ms ease;
}

.control-btn:hover {
  background: var(--bg-hover);
}

.layout-btn {
  padding: 2px 6px;
  border: 1px solid var(--border);
  background: var(--bg-base);
  cursor: pointer;
  border-radius: var(--radius-sm);
  font-size: 10px;
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

.concept-graph-canvas {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
