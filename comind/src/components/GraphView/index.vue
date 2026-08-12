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
import { createAccumulator, traverseBFS, buildFullGraph, type RawLink, type VisibilityMap, type GraphSnapshot } from './graphData'

const pageStore = usePageStore()
const blockStore = useBlockStore()
const router = useRouter()

const props = defineProps<{
  highlightedNodeId?: string | null
  pageId?: string
  hiddenNodeIds?: Set<string>
  dimmedNodeIds?: Set<string>
  hiddenEdgeIds?: Set<string>
  /** 全量图谱快照：由父级 GraphPage 通过 1 次 IPC 拉取后传入，子组件不再独立发起 IPC */
  graphSnapshot?: GraphSnapshot | null
}>()

const emit = defineEmits<{
  /** 全量图谱刷新请求：冒泡给父级 GraphPage 重新拉取快照（避免子组件双数据源） */
  (e: 'request-refresh'): void
}>()

// 硬性超时包装：防止任何下游 Promise（G6 布局/绘制等）永久挂起导致整页卡死且无日志。
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

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

watch(() => [props.hiddenNodeIds, props.dimmedNodeIds, props.hiddenEdgeIds], () => {
  if (graphRef.value) refreshGraphData()
}, { deep: true })

// 父级重新拉取快照后（prop 变更），重建全量图谱（避免子组件自行发起 IPC）。
watch(() => props.graphSnapshot, () => {
  const n = props.graphSnapshot?.edges.length ?? 0
  console.info(`[GraphView] graphSnapshot prop changed (${n} edges) — triggering rebuild`)
  if (graphRef.value) refreshGraphData()
})

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
  const visibility: VisibilityMap = {
    hiddenNodeIds: props.hiddenNodeIds ?? new Set<string>(),
    dimmedNodeIds: props.dimmedNodeIds ?? new Set<string>(),
    hiddenEdgeIds: props.hiddenEdgeIds ?? new Set<string>(),
  }
  const acc = createAccumulator()
  const getPage = (id: string) => pageStore.getPage(id)
  const getBlock = (id: string) => blockStore.getBlock(id)

  if (!isPageScoped.value) {
    const allPages = pageStore.pages.filter(p => !p.deleted)
    // 全量图谱：快照由父级（GraphPage）通过 graphSnapshot prop 传入，
    // 不再独立发起第二份 IPC（见 handoff 6.A / Pitfall #2）。
    const snapshot = props.graphSnapshot ?? undefined
    await buildFullGraph(allPages, acc, visibility, currentPageId.value, highlightedNodeId.value, getPage, fetchNeighbors, getBlock, snapshot)
  } else {
    const rootId = currentPageId.value
    if (rootId) {
      await traverseBFS(rootId, maxDepth.value, acc, visibility, currentPageId.value, highlightedNodeId.value, getPage, fetchNeighbors, getBlock)
    }
  }
  return { nodes: acc.nodes, edges: acc.edges }
}

/**
 * 安全的 fitView 包装：
 * 1. nextTick 等 canvas 元素完成当前批次的绘制提交
 * 2. 第一次 fitView 基于旧包围盒算出近似缩放/平移
 * 3. 再 nextTick + 第二次 fitView，用已更新的 transform 拿到准确的 BBox
 * 这解决了 G6 v5 中 layout() resolve 后 canvas render bounds 未即时更新导致的节点溢出问题
 */
async function safeFitView(
  g: { fitView: Graph['fitView'] },
  options: { when?: 'overflow' | 'always'; direction?: 'x' | 'y' | 'both' } = { when: 'always' },
  animate = false,
) {
  if (!g) return
  await nextTick()
  await g.fitView(options, animate)
  await nextTick()
  await g.fitView(options, animate)
}

async function initGraph() {
  if (!containerRef.value) return
  console.info('[GraphView] initGraph: creating G6 Graph instance...')

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
    padding: [50,0, 100, 0],
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
      console.info('[GraphView] afterlayout fired — overlay will hide, canvas interactive')
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

  // 全量图谱：快照由父级拥有，未就绪前不构建——否则会得到空图，
  // 且违背「子组件不独立发起 IPC」的约束。快照通过 graphSnapshot prop 传入，
  // 对应的 watcher 会在快照到达时触发本函数重建。
  if (!isPageScoped.value && !props.graphSnapshot) {
    console.warn('[GraphView] refreshGraphData skipped: full-graph snapshot not ready yet (parent still loading)')
    return
  }

  const gen = ++refreshGeneration
  const startedAt = performance.now()
  console.info('[GraphView] refreshGraphData: building graph data...')

  const { nodes, edges } = await buildGraphData()

  // 守卫 1：await 期间图可能被 onBeforeUnmount / initGraph 重入销毁，
  // 此时 g 仍指向已 destroy 的实例（context 已被清空），
  // generation 守卫捕获不到这种情况。G6 destroy 后 this.context = {}，
  // 再调用 setData 会抛 "Cannot read properties of undefined (reading 'setData')"。
  if (gen !== refreshGeneration) {
    console.info('[GraphView] refreshGraphData: superseded during build (generation changed)')
    return
  }
  if (g.destroyed) return

  console.info(`[GraphView] refreshGraphData: built ${nodes.length} nodes / ${edges.length} edges in ${Math.round(performance.now() - startedAt)}ms; applying to canvas...`)
  if (nodes.length > 2000) {
    console.warn(`[GraphView] Large graph (${nodes.length} nodes) — force layout may be slow; consider filtering or a lighter layout.`)
  }

  g.setData({ nodes, edges: edges as EdgeData[] })
  await g.draw()
  console.info('[GraphView] refreshGraphData: draw done; starting layout (guarded by 15s timeout)...')
  try {
    await withTimeout(g.layout(), 15000, 'g.layout()')
  } catch (e) {
    // 布局挂起/失败不应阻塞页面：记录后继续，遮罩由 onMounted 安全网兜底解除。
    console.error('[GraphView] g.layout() timed out or failed — continuing without fitView:', e)
  }

  if (gen !== refreshGeneration) return
  if (g.destroyed) return

  await safeFitView(g, { when: 'always' }, false)
  console.info('[GraphView] refreshGraphData: complete')
}

async function handleLayoutChange(layout: string) {
  currentLayout.value = layout
  if (graphRef.value) {
    graphRef.value.setLayout({ type: layout, preventOverlap: true, nodeSize: 100, animate: isFirstLayoutDone.value })
    await graphRef.value.layout()
    await safeFitView(graphRef.value, { when: 'always' }, false)
  }
}

async function handleFitView() {
  if (graphRef.value) {
    await safeFitView(graphRef.value, { when: 'always' }, false)
  }
}

async function handleRefresh() {
  // 全量图谱：快照由父级（GraphPage）拥有，刷新应冒泡到父级重新拉取，
  // 不自行发起第二份 IPC（见 handoff Pitfall #2）。
  if (!isPageScoped.value) {
    emit('request-refresh')
    return
  }
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
  const startedAt = performance.now()
  console.info('[GraphView] onMounted: initializing graph canvas...')
  await nextTick()
  await initGraph()
  console.info(`[GraphView] onMounted: initGraph done in ${Math.round(performance.now() - startedAt)}ms`)

  // 安全网：若布局/afterlayout 因任何原因（G6 布局挂起、快照迟迟未到等）未触发，
  // 强制解除加载遮罩，避免画布被 overlay 永久阻塞导致“卡死/无法交互”。
  // 即使主线程被 force 布局短暂占用，超时后用户也能恢复交互。
  setTimeout(() => {
    if (!isFirstLayoutDone.value) {
      console.warn('[GraphView] layout did not complete within 12s; forcing overlay dismissal to restore interactivity (graph may still be settling).')
      isFirstLayoutDone.value = true
    }
  }, 12000)

  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (graphRef.value && containerRef.value) {
        graphRef.value.resize(containerRef.value.clientWidth, containerRef.value.clientHeight)
        safeFitView(graphRef.value, { when: 'always' }, false)
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
  height: var(--graph-header-height);
  align-items: center;
  justify-content: space-between;
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
  margin-left: var(--space-3);
  font-size: var(--text-2xl);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.graph-view-controls {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-right: var(--space-4);
}

.control-label {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  margin-right: 4px;
}

.control-value {
  font-size: var(--text-xs);
  color: var(--text-primary);
  font-weight: var(--font-medium);
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
  font-size: var(--text-sm);
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
  font-size: var(--text-xs);
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
  font-weight: var(--font-medium);
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
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-weight: var(--font-medium);
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
  font-size: var(--text-xs);
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
  font-weight: var(--font-semibold);
}
</style>
