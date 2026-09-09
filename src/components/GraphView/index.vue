<script setup lang="ts">
import type { EdgeData, NodeData } from '@antv/g6'
import { Graph } from '@antv/g6'
import { Download, ExpandIcon, RefreshCw } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBlockStore } from '../../stores/blocks'
import { usePageStore } from '../../stores/pages'
import { getRelationshipStrength, STRENGTH_TO_WIDTH } from '../../types/relationship'
import { isTauriEnvironment, tauriSavePngDataUrl } from '../../wasm/tauri-platform'
import { buildFullGraph, createAccumulator, traverseBFS, type GraphSnapshot, type RawLink, type VisibilityMap } from './graphData'
import { getEdgeStyle, getNodeStyle } from './graphStyle'
import { computeForceLayoutInWorker } from './workerLayout'

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

// 让出主线程给浏览器完成首帧绘制：先渲染外壳（header + 占位 canvas），
// 再异步初始化 G6（可能较重），避免首帧卡顿 / 白屏，加载期间页面保持可交互。
function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })
}

// 大图阈值：全量图选中 force 且节点超过此值，初始布局改用快速布局，
// 避免 force 模拟在数百帧里反复全量重绘、把主线程占满数秒（表现为“卡路由”）。
const LARGE_GRAPH_NODES = 250
// 全量图节点安全上限：极端规模下截断，防止一次性渲染/布局阻塞主线程数秒。
// 正常笔记库远不会触发；仅作为最坏情况的兜底，避免任何规模下都“卡死”。
const MAX_FULL_GRAPH_NODES = 3000

// 导出 PNG 放大倍率。G6 toDataURL 无 scale 参数：offscreen 以「视口 CSS 尺寸 × devicePixelRatio」
// 渲染（canvas.js），固定 DPR 下导出像素被锁死，放大看即模糊。
// 故导出前临时把画布 resize 为 EXPORT_IMAGE_SCALE 倍再 fitView（相机 zoom 同步翻倍，
// 内容以更高物理像素绘制），toDataURL 后还原。2x 已是 DPR=1 屏幕下的显著提清档位。
const EXPORT_IMAGE_SCALE = 2

const containerRef = ref<HTMLElement | null>(null)
// G6 实例必须用 shallowRef 而非 ref：Vue 的 reactive Proxy 会包裹 Graph 实例，
// 破坏 @antv/g 事件边界（EventBoundary）的 identity 检查，触发
// "It is illegal to free an event not managed by this EventBoundary!" 并导致主线程自旋卡死
// （G6 v5 + Vue3 已知问题，见 antvis/G6#6791）。shallowRef 不深代理，实例保持原样。
const graphRef = shallowRef<Graph | null>(null)
const currentLayout = ref<string>('force')
const highlightedNodeId = ref<string | null>(null)
const isFirstLayoutDone = ref(false)
// 全量图因规模过大被截断时置位，用于在 header 显示提示（同时有 console.warn）
const fullGraphTruncated = ref(false)

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
    // 全量图谱：快照由父级（GraphPage）通过 graphSnapshot prop 传入，
    // 不再独立发起第二份 IPC（见 handoff 6.A / Pitfall #2）。
    // 按 updatedAt 降序排列：命中安全上限截断时，优先保留最近的页面。
    const allPages = [...pageStore.pages.filter(p => !p.deleted)]
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
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

// helper 参数用结构化类型而非 Graph 类：graphRef.value 的类型经 Vue UnwrapRef
// 解包后丢失类私有字段标识，无法赋给类类型（vue-tsc TS2345）。
type GraphLike = Pick<Graph, 'getNodeData' | 'getEdgeData' | 'getSize' | 'destroyed' | 'setData' | 'draw' | 'setLayout' | 'layout'>

/**
 * G6 原生主线程布局（force 会整段同步跑模拟，大图卡死 —— 仅作为 worker 失败时的回退）。
 */
async function runG6Layout(g: GraphLike, layoutType: string) {
  g.setLayout({ type: layoutType, preventOverlap: true, nodeSize: 100 })
  try {
    await withTimeout(g.layout(), 15000, 'g.layout()')
  } catch (e) {
    // 布局挂起/失败不应阻塞页面：记录后继续，遮罩由 onMounted 安全网兜底解除。
    console.error('[GraphView] g.layout() timed out or failed — continuing without fitView:', e)
  }
}

/**
 * force 布局走 Web Worker（见 workerLayout.ts）：
 * 读取当前图数据，在子线程完成力导向模拟，把终态坐标写回节点。
 * 返回 false 表示 worker 不可用/失败/超时，调用方应回退 runG6Layout。
 */
async function applyWorkerForceLayout(g: GraphLike): Promise<boolean> {
  const nodes = g.getNodeData()
  const edges = g.getEdgeData()
  const box = containerRef.value
  const [gw, gh] = g.getSize()
  const positions = await computeForceLayoutInWorker(
    nodes.map(n => ({ id: n.id })),
    edges.map(e => ({
      id: String(e.id ?? `${e.source}->${e.target}`),
      source: String(e.source),
      target: String(e.target),
    })),
    box?.clientWidth || gw,
    box?.clientHeight || gh,
  )
  if (!positions?.length) return false
  if (g.destroyed) return false
  const posMap = new Map(positions.map(p => [p.id, p]))
  g.setData({
    nodes: nodes.map(n => {
      const p = posMap.get(n.id)
      if (!p) return n
      return { ...n, style: { ...n.style, x: p.x, y: p.y } }
    }),
    edges,
  })
  await g.draw()
  // worker 路径不走 g.layout()，afterlayout 不会触发——手动解除首布局遮罩
  isFirstLayoutDone.value = true
  return true
}

async function initGraph() {
  if (!containerRef.value) return

  if (graphRef.value) {
    graphRef.value.off()
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
    padding: [50, 0, 100, 0],
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

  // 全量图谱：快照由父级拥有，未就绪前不构建——否则会得到空图，
  // 且违背「子组件不独立发起 IPC」的约束。快照通过 graphSnapshot prop 传入，
  // 对应的 watcher 会在快照到达时触发本函数重建。
  if (!isPageScoped.value && !props.graphSnapshot) {
    console.warn('[GraphView] refreshGraphData skipped: full-graph snapshot not ready yet (parent still loading)')
    return
  }

  const gen = ++refreshGeneration

  const { nodes, edges } = await buildGraphData()

  // 守卫 1：await 期间图可能被 onBeforeUnmount / initGraph 重入销毁，
  // 此时 g 仍指向已 destroy 的实例（context 已被清空），
  // generation 守卫捕获不到这种情况。G6 destroy 后 this.context = {}，
  // 再调用 setData 会抛 "Cannot read properties of undefined (reading 'setData')"。
  if (gen !== refreshGeneration) {
    return
  }
  if (g.destroyed) return

  // 全量图安全上限：极端规模下截断节点（及相关边），避免一次性渲染/布局阻塞主线程数秒。
  // 正常笔记库远不会触发；截断时按 recency 保留最近的页面（见 buildGraphData 的排序）。
  let renderNodes = nodes
  let renderEdges = edges
  if (!isPageScoped.value && nodes.length > MAX_FULL_GRAPH_NODES) {
    fullGraphTruncated.value = true
    renderNodes = nodes.slice(0, MAX_FULL_GRAPH_NODES)
    const keep = new Set(renderNodes.map(n => n.id))
    renderEdges = edges.filter(e => keep.has((e as EdgeData).source as string) && keep.has((e as EdgeData).target as string))
    console.warn(`[GraphView] Full graph truncated to ${MAX_FULL_GRAPH_NODES} of ${nodes.length} nodes to avoid a main-thread freeze on open. Use filters to narrow the view.`)
  } else {
    fullGraphTruncated.value = false
  }

  // 初始布局选择：大图（全量 + 选中 force）改用快速布局 grid，
  // 避免 force 模拟在数百帧里反复全量重绘、把主线程占满数秒（即“卡路由”现象）。
  // force / radial / dagre 仍可通过布局按钮按需切换；小图与页面作用域保持 force 不变。
  const effectiveLayout = (!isPageScoped.value && currentLayout.value === 'force' && renderNodes.length > LARGE_GRAPH_NODES)
    ? 'grid'
    : currentLayout.value
  g.setLayout({ type: effectiveLayout, preventOverlap: true, nodeSize: 100 })
  g.setData({ nodes: renderNodes, edges: renderEdges as EdgeData[] })

  if (effectiveLayout === 'force') {
    // force 走 Web Worker：坐标就绪前不 draw（否则节点全堆在原点闪现一坨），
    // applyWorkerForceLayout 成功后一次性 setData+draw。
    const applied = await applyWorkerForceLayout(g)
    if (gen !== refreshGeneration) return
    if (g.destroyed) return
    if (!applied) {
      // 回退：G6 原生主线程布局（worker 不可用/失败/超时）
      await g.draw()
      await runG6Layout(g, effectiveLayout)
    }
  } else {
    await g.draw()
    await runG6Layout(g, effectiveLayout)
  }

  if (gen !== refreshGeneration) return
  if (g.destroyed) return

  await safeFitView(g, { when: 'always' }, false)
}

async function handleLayoutChange(layout: string) {
  currentLayout.value = layout
  const g = graphRef.value
  if (!g) return
  if (layout === 'force') {
    const applied = await applyWorkerForceLayout(g)
    if (!applied && !g.destroyed) await runG6Layout(g, layout)
  } else {
    g.setLayout({ type: layout, preventOverlap: true, nodeSize: 100, animate: isFirstLayoutDone.value })
    await g.layout()
  }
  await safeFitView(g, { when: 'always' }, false)
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
  const g = graphRef.value
  if (!g) return
  try {
    // 高清导出：G6 toDataURL 分辨率 = 视口 CSS 尺寸 × devicePixelRatio（无倍率参数），
    // 固定 DPR 下导出图放大即糊。这里临时放大画布 + fitView，让内容以 2x 物理像素
    // 离屏重绘，拿到高分辨率 data URL 后立刻还原视图（期间画布有短暂一次闪变）。
    const [w, h] = g.getSize()
    const scaled = EXPORT_IMAGE_SCALE > 1 && w * EXPORT_IMAGE_SCALE < 16384 && h * EXPORT_IMAGE_SCALE < 16384
    if (scaled) {
      g.resize(w * EXPORT_IMAGE_SCALE, h * EXPORT_IMAGE_SCALE)
      await safeFitView(g, { when: 'always' }, false)
    }
    const dataURL = await g.toDataURL({
      type: 'image/png'
    })
    if (scaled) {
      g.resize(w, h)
      await safeFitView(g, { when: 'always' }, false)
    }
    const fileName = `concept-graph-${Date.now()}.png`
    if (isTauriEnvironment()) {
      // Tauri WebView2 会静默丢弃 <a download> + data URL 的点击（实测 toDataURL 成功、无下载触发），
      // 保存走原生「另存为」dialog + fs 写盘（tauriSavePngDataUrl）。
      const ok = await tauriSavePngDataUrl(dataURL, fileName)
      if (!ok) console.warn('[GraphView] PNG export cancelled or failed (see tauriSavePngDataUrl log)')
      return
    }
    const link = document.createElement('a')
    link.href = dataURL
    link.download = fileName
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
  const target = highlightedNodeId.value
  // 增量更新：只写变化节点的 data（全量 setData 会连同边一起重置，点击时产生可感知卡顿）
  const patches = []
  for (const node of g.getNodeData()) {
    const isHit = node.id === target
    if (Boolean((node.data as any).isHighlighted) === isHit) continue
    patches.push({ id: node.id, data: { ...node.data, isHighlighted: isHit } })
  }
  if (patches.length) g.updateNodeData(patches)
  g.draw()
}

let resizeObserver: ResizeObserver | null = null
let resizeRaf = 0

let disposed = false
onBeforeUnmount(() => { disposed = true })

onMounted(async () => {
  await nextTick()
  // 让浏览器先绘制外壳（header + 占位 canvas + 加载提示），再初始化 G6，
  // 确保首次 paint 不被重量级初始化阻塞，导航到 /graph 时无白屏、立即可交互。
  await nextFrame()
  if (disposed) return
  await initGraph()

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
    // 侧栏拖拽 resize 时 RO 每帧触发；不防抖会连环 resize + 双 fitView 把主线程打满。
    let resizeRaf = 0
    let lastW = -1
    let lastH = -1
    resizeObserver = new ResizeObserver(() => {
      const box = containerRef.value
      if (!graphRef.value || !box) return
      const w = box.clientWidth
      const h = box.clientHeight
      if (w === lastW && h === lastH) return
      lastW = w
      lastH = h
      cancelAnimationFrame(resizeRaf)
      resizeRaf = requestAnimationFrame(() => {
        if (!graphRef.value) return
        graphRef.value.resize(w, h)
        safeFitView(graphRef.value, { when: 'always' }, false)
      })
    })
    resizeObserver.observe(containerRef.value)
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(resizeRaf)
  resizeObserver?.disconnect()
  if (graphRef.value) {
    graphRef.value.off()
    graphRef.value.destroy()
    graphRef.value = null
  }
})
</script>

<template>
  <div class="graph-view">
    <div class="graph-view-header">
      <div class="graph-view-controls">
        <div class="control-group control-group-left">
          <button v-for="layout in ['force', 'radial', 'dagre']" :key="layout" class="layout-btn"
            :class="{ active: currentLayout === layout }" @click="handleLayoutChange(layout)">
            {{ layout === 'force' ? '力导向' : layout === 'radial' ? '径向' : '层级' }}
          </button>
        </div>
        <div class="control-group control-group-right">
          <button class="control-btn" @click="handleFitView">
            <ExpandIcon :size="14" />
            <span>适应视图</span>
          </button>
          <button class="control-btn" @click="handleRefresh">
            <RefreshCw :size="14" />
            <span>刷新</span>
          </button>
          <button class="control-btn" @click="handleExportPng">
            <Download :size="14" />
            <span>导出 PNG</span>
          </button>
        </div>
        <div v-if="isPageScoped" class="depth-control">
          <span class="depth-label">层级</span>
          <div class="depth-options">
            <button v-for="d in [1, 2, 3]" :key="d" class="depth-btn" :class="{ active: maxDepth === d }"
              @click="maxDepth = d">{{ d }}</button>
          </div>
        </div>
      </div>
    </div>
    <div class="graph-view-body">
      <div ref="containerRef" class="graph-view-canvas">
        <div v-if="!isFirstLayoutDone" class="graph-loading-overlay">
          <div class="loading-spinner"></div>
          <span>正在加载图谱数据…</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
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

/* 让 PageTitle 占据整行，actions（控件）推到最右 */
.graph-view-header .page-title-container {
  flex: 1;
  min-width: 0;
}

.graph-view-controls {
  display: flex;
  align-items: center;
  width: 100%;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  align-items: center;
}

.control-group-left {
  padding-left: var(--space-2);

  .layout-btn {
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-sidebar);
    cursor: pointer;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-family: inherit;
    transition: background 80ms ease, color 80ms ease;

    &:hover {
      background: var(--bg-hover);
      color: var(--text-secondary);
    }

    &.active {
      background: var(--bg-active);
      color: var(--text-primary);
      font-weight: var(--font-medium);
      border-color: #1890ff;
    }
  }
}

.control-group-right {
  padding-right: var(--space-2);
  gap: var(--space-1);

  .control-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: var(--space-6);
    padding: 0 10px;
    background: var(--bg-base);
    cursor: pointer;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-family: inherit;
    white-space: nowrap;
    transition: background 80ms ease;

    &:hover {
      background: var(--bg-hover);
    }
  }
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
  z-index: var(--z-sticky);
  gap: 8px;
  /* 纯视觉占位：不拦截任何指针事件，加载期间画布区域之外（header 控件 / 侧栏筛选）始终可交互 */
  pointer-events: none;
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
