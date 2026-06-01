<template>
  <div class="concept-graph">
    <div class="graph-header">
      <h3>概念图谱</h3>
      <div class="graph-controls">
        <select v-model="depth" class="depth-select">
          <option :value="1">1度关联</option>
          <option :value="2">2度关联</option>
          <option :value="3">3度关联</option>
        </select>
        <select v-model="layout" class="layout-select">
          <option value="force">力导向布局</option>
          <option value="dagre">层级布局</option>
          <option value="circular">环形布局</option>
        </select>
      </div>
    </div>
    <div ref="containerRef" class="graph-container"></div>
    <div v-if="loading" class="loading">加载中...</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import G6 from '@antv/g6'
import type { GraphData } from '@antv/g6'
import { storage } from '../storage/indexedDB'
import { usePageStore } from '../stores/pages'

const props = defineProps<{
  pageId: string
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const loading = ref(true)
const depth = ref(2)
const layout = ref('force')

const pageStore = usePageStore()

let graph: any = null

function createGraph(container: HTMLDivElement) {
  const width = container.offsetWidth
  const height = container.offsetHeight

  const layoutConfig: Record<string, any> = {
    force: {
      type: 'force',
      preventOverlap: true,
      nodeSize: 60,
      linkDistance: 150,
      nodeStrength: -50,
      edgeStrength: 0.5
    },
    dagre: {
      type: 'dagre',
      rankdir: 'TB',
      nodesep: 60,
      ranksep: 100
    },
    circular: {
      type: 'circular',
      radius: 150,
      startAngle: Math.PI / 2
    }
  }

  graph = new (G6 as any).Graph({
    container,
    width,
    height,
    layout: layoutConfig[layout.value] as any,
    defaultNode: {
      size: 60,
      style: {
        fill: '#fff',
        stroke: '#5B8FF9',
        lineWidth: 2,
        shadowColor: 'rgba(91, 143, 249, 0.3)',
        shadowBlur: 10
      },
      labelCfg: {
        position: 'bottom',
        style: {
          fontSize: 12,
          fill: '#333'
        }
      }
    },
    defaultEdge: {
      style: {
        lineWidth: 2,
        endArrow: {
          path: (G6 as any).Arrow.triangle(10, 12, 0),
          d: 12
        }
      },
      labelCfg: {
        autoRotate: true,
        style: {
          fontSize: 11,
          fill: '#666',
          background: {
            fill: '#fff',
            padding: [2, 4, 2, 4],
            radius: 2
          }
        }
      }
    }
  })

  graph.on('node:click', (e: any) => {
    const node = e.item
    const model = node?.getModel?.()
    if (model && model.id !== props.pageId) {
      const page = pageStore.getPage(model.id)
      if (page) {
        window.open(`/#/page/${page.id}`, '_self')
      }
    }
  })
}

async function loadGraphData() {
  if (!containerRef.value || !graph) return

  loading.value = true

  try {
    const data = await storage.getConceptGraph(props.pageId, depth.value)

    const graphData: GraphData = {
      nodes: data.nodes.map((node: any) => ({
        id: node.id,
        label: node.title.length > 8 ? node.title.substring(0, 8) + '...' : node.title,
        title: node.title,
        isCurrentPage: node.isCurrentPage,
        style: {
          fill: node.isCurrentPage ? '#1890ff' : '#fff',
          stroke: node.isCurrentPage ? '#1890ff' : '#5B8FF9',
          lineWidth: node.isCurrentPage ? 4 : 2,
          shadowColor: node.isCurrentPage ? 'rgba(24, 144, 255, 0.4)' : 'rgba(91, 143, 249, 0.3)'
        },
        labelCfg: {
          style: {
            fill: node.isCurrentPage ? '#fff' : '#333',
            fontSize: node.isCurrentPage ? 13 : 12
          }
        }
      })),
      edges: data.edges.map((edge: any) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.relationshipLabel,
        style: {
          stroke: edge.relationshipColor,
          lineWidth: 2
        }
      }))
    }

    graph.changeLayout({
      type: layout.value,
      ...(layout.value === 'force' && {
        preventOverlap: true,
        nodeSize: 60
      })
    })

    graph.data(graphData)
    graph.render()
  } catch (error) {
    console.error('Failed to load graph data:', error)
  } finally {
    loading.value = false
  }
}

function handleResize() {
  if (!containerRef.value || !graph) return
  const width = containerRef.value.offsetWidth
  const height = containerRef.value.offsetHeight
  graph.changeSize(width, height)
}

watch(depth, () => {
  loadGraphData()
})

watch(layout, () => {
  loadGraphData()
})

watch(() => props.pageId, () => {
  loadGraphData()
})

onMounted(async () => {
  await nextTick()
  if (containerRef.value) {
    createGraph(containerRef.value)
    await loadGraphData()
    window.addEventListener('resize', handleResize)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  graph?.destroy()
})
</script>

<style scoped>
.concept-graph {
  display: flex;
  flex-direction: column;
  height: 400px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.graph-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
}

.graph-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

.graph-controls {
  display: flex;
  gap: 8px;
}

.depth-select,
.layout-select {
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}

.graph-container {
  flex: 1;
  position: relative;
}

.loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #999;
  font-size: 14px;
}
</style>