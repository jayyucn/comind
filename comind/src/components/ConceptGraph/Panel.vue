<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { Graph } from '@antv/g6'
import type { NodeData } from '@antv/g6'
import { usePageStore } from '../../stores/pages'
import { storage } from '../../storage/indexedDB'
import { db } from '../../storage/db'
import { useNavigateToPage } from '../../composables/useNavigateToPage'
import { getRelationshipColor, getRelationshipLabel, getInverseRelationshipType } from '../../types/relationship'
import { useRightSidebar } from '../../composables/useRightSidebar'

const pageStore = usePageStore()
const { navigateToPage } = useNavigateToPage()
const rightSidebar = useRightSidebar()

const containerRef = ref<HTMLElement | null>(null)
const graphRef = ref<Graph | null>(null)
const maxDepth = ref(2)
const currentLayout = ref<string>('force')

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
      const label = getRelationshipLabel(link.relationshipType ?? 'related')
      edges.push({
        id: link.id,
        source: pid,
        target: link.targetPageId,
        data: {
          relationshipType: link.relationshipType ?? 'related',
          label,
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
      // 只遍历发现节点，不创建反向边（避免与 outLinks 的正向边冗余）
      await traverse(sourcePageId, level + 1)
    }
  }

  await traverse(pageId, 0)

  // 去重反向关系对：A→B(depends-on) 和 B→A(required-by) 只保留一条
  // 保留 source level 更低（离当前页更近）的那条
  const nodeLevelMap = new Map(nodes.map(n => [n.id, (n.data as any)?.level ?? Infinity]))
  const edgesToRemove = new Set<string>()
  for (let i = 0; i < edges.length; i++) {
    if (edgesToRemove.has(edges[i].id)) continue
    for (let j = i + 1; j < edges.length; j++) {
      if (edgesToRemove.has(edges[j].id)) continue
      const a = edges[i], b = edges[j]
      if (a.source === b.target && a.target === b.source) {
        const aType = a.data.relationshipType as string
        const bType = b.data.relationshipType as string
        const aInverse = getInverseRelationshipType(aType)
        if (aInverse === bType) {
          // 保留 source level 更低的边
          const aLevel = nodeLevelMap.get(a.source) ?? Infinity
          const bLevel = nodeLevelMap.get(b.source) ?? Infinity
          edgesToRemove.add(aLevel <= bLevel ? b.id : a.id)
        }
      }
    }
  }
  const dedupedEdges = edges.filter(e => !edgesToRemove.has(e.id))

  // 计算同一对节点间多条边的曲线偏移，避免重叠
  const edgeCountMap = new Map<string, number>()
  for (const edge of dedupedEdges) {
    const key = [edge.source, edge.target].sort().join('-')
    const idx = edgeCountMap.get(key) ?? 0
    edgeCountMap.set(key, idx + 1)
    if (idx === 0) {
      edge.data.curveOffset = 0
    } else {
      // 对称偏移：1→20, 2→-20, 3→40, 4→-40, ...
      const sign = idx % 2 === 1 ? 1 : -1
      const magnitude = Math.ceil(idx / 2) * 20
      edge.data.curveOffset = sign * magnitude
    }
  }

  return { nodes, edges: dedupedEdges }
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
    node: {
      type: 'rect',
      style: {
        size: (d: NodeData) => getNodeSize(!!d.data?.isCurrent),
        radius: 6,
        fill: (d: NodeData) => getNodeFill(!!d.data?.isCurrent),
        stroke: (d: NodeData) => getNodeStroke(!!d.data?.isCurrent),
        lineWidth: 1,
        labelText: (d: NodeData) => (d.data?.label as string) ?? '',
        labelPlacement: 'center',
        labelFill: (d: NodeData) => getNodeLabelFill(!!d.data?.isCurrent),
        labelFontSize: 11,
        labelFontWeight: (d: NodeData) => d.data?.isCurrent ? 600 : 400,
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
    if (nodeId && nodeId !== currentPageId.value) {
      navigateToPage(nodeId)
    }
  })

  graphRef.value = graph

  if (currentPageId.value) {
    await refreshGraphData(graph)
  } else {
    await graph.render()
  }
}

async function refreshGraphData(graph?: Graph) {
  const g = graph ?? graphRef.value
  if (!g || !currentPageId.value) return

  const { nodes, edges } = await buildGraphData(currentPageId.value, maxDepth.value)

  g.setData({ nodes, edges })
  await g.render()
  await g.fitView()
  // fitView 后缩小一点留出边距
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

watch(currentPageId, async () => {
  if (!rightSidebar.visible.value) return
  await refreshGraphData()
})

watch(maxDepth, async () => {
  if (!rightSidebar.visible.value) return
  await refreshGraphData()
})

// 侧边栏打开时刷新数据（隐藏期间可能切换了页面）
watch(() => rightSidebar.visible.value, async (visible) => {
  if (visible) await refreshGraphData()
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
