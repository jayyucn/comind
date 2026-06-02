<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { usePageStore } from '../stores/pages'
import { storage } from '../storage/indexedDB'
import { db } from '../storage/db'
import { getRelationshipColor } from '../types/relationship'

interface GraphNode {
  id: string
  label: string
  isCurrent: boolean
  x: number
  y: number
}

interface GraphEdge {
  source: string
  target: string
  label?: string
  relationshipType: string | null
  color: string
}

const pageStore = usePageStore()
const graphDepth = ref(2)
const graphLayout = ref<'force' | 'dagre' | 'circular'>('force')
const nodes = ref<GraphNode[]>([])
const edges = ref<GraphEdge[]>([])
const isLoading = ref(false)

/** 递归构建图数据 */
async function buildGraphData() {
  const currentPageId = pageStore.currentPageId
  if (!currentPageId) {
    nodes.value = []
    edges.value = []
    return
  }

  isLoading.value = true
  try {
    const allPages = await storage.getAllPages()
    const allBlocks = await db.blocks.toArray()
    const allLinks = await db.links.toArray()

    // 构建页面 ID 到对象的映射
    const pageIdMap = new Map(allPages.map(p => [p.id, p]))
    // 构建 Block ID 到页面 ID 的映射
    const blockPageMap = new Map(allBlocks.map(b => [b.id, b.pageId]))

    // 根据深度收集节点
    const pageIds = new Set([currentPageId])
    const newEdges: GraphEdge[] = []
    const visited = new Set<string>()

    function traverse(pageId: string, depth: number) {
      if (depth > graphDepth.value || visited.has(pageId)) return
      visited.add(pageId)

      // 查找从当前页面出发的链接
      for (const link of allLinks) {
        const sourcePageId = blockPageMap.get(link.sourceBlockId)
        if (sourcePageId === pageId) {
          const targetPageId = link.targetPageId
          if (targetPageId && pageIdMap.has(targetPageId)) {
            pageIds.add(targetPageId)
            const relType = link.relationshipType
            const color = getRelationshipColor(relType || '')
            newEdges.push({
              source: pageId,
              target: targetPageId,
              label: relType || undefined,
              relationshipType: relType,
              color
            })
            traverse(targetPageId, depth + 1)
          }
        }
      }

      // 查找指向当前页面的链接
      for (const link of allLinks) {
        if (link.targetPageId === pageId) {
          const sourcePageId = blockPageMap.get(link.sourceBlockId)
          if (sourcePageId && pageIdMap.has(sourcePageId)) {
            pageIds.add(sourcePageId)
            const relType = link.relationshipType
            const color = getRelationshipColor(relType || '')
            newEdges.push({
              source: sourcePageId,
              target: pageId,
              label: relType || undefined,
              relationshipType: relType,
              color
            })
            traverse(sourcePageId, depth + 1)
          }
        }
      }
    }

    traverse(currentPageId, 1)

    // 计算简单的布局（圆形布局）
    const newNodes: GraphNode[] = []
    const radius = 80
    const centerX = 150
    const centerY = 100
    const nodeCount = pageIds.size

    let index = 0
    for (const pageId of pageIds) {
      const page = pageIdMap.get(pageId)
      if (page) {
        let x = centerX
        let y = centerY
        if (nodeCount > 1) {
          const angle = (index / nodeCount) * 2 * Math.PI
          x = centerX + radius * Math.cos(angle)
          y = centerY + radius * Math.sin(angle)
        }
        newNodes.push({
          id: pageId,
          label: page.title,
          isCurrent: pageId === currentPageId,
          x,
          y
        })
        index++
      }
    }

    nodes.value = newNodes
    edges.value = newEdges
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  buildGraphData()
})

watch([() => pageStore.currentPageId, graphDepth, graphLayout], () => {
  buildGraphData()
})

/** 通过 ID 获取节点 */
function getNode(nodeId: string): GraphNode | undefined {
  return nodes.value.find(n => n.id === nodeId)
}

/** 获取唯一关系类型列表 */
function getUniqueRelationships() {
  const unique: Array<{ label: string | null; color: string }> = []
  const seen = new Set<string | null>()
  
  for (const edge of edges.value) {
    if (!seen.has(edge.relationshipType)) {
      seen.add(edge.relationshipType)
      unique.push({ label: edge.relationshipType, color: edge.color })
    }
  }
  
  return unique
}
</script>

<template>
  <div class="concept-graph-panel">
    <div class="concept-graph-header">
      <span class="concept-graph-title">
        🕸️ 概念图谱
      </span>
      <div class="concept-graph-controls">
        <select v-model="graphDepth" class="depth-select">
          <option :value="1">1 度</option>
          <option :value="2">2 度</option>
          <option :value="3">3 度</option>
        </select>
        <select v-model="graphLayout" class="layout-select">
          <option value="force">力导向</option>
          <option value="dagre">层级</option>
          <option value="circular">环形</option>
        </select>
      </div>
    </div>
    <div ref="graphContainer" class="concept-graph-body">
      <div v-if="isLoading" class="loading">加载中...</div>
      <div v-else-if="nodes.length === 0" class="placeholder">
        <p>暂无页面关联数据</p>
      </div>
      <svg v-else class="graph-svg" width="300" height="200">
        <!-- 先画边 -->
        <g class="edges">
          <line
            v-for="(edge, i) in edges"
            :key="`edge-${i}`"
            :x1="getNode(edge.source)?.x ?? 0"
            :y1="getNode(edge.source)?.y ?? 0"
            :x2="getNode(edge.target)?.x ?? 0"
            :y2="getNode(edge.target)?.y ?? 0"
            :stroke="edge.color"
            stroke-width="2"
            stroke-linecap="round"
          />
        </g>
        <!-- 再画节点 -->
        <g class="nodes">
          <g
            v-for="node in nodes"
            :key="node.id"
            class="node"
            :class="{ 'node-current': node.isCurrent }"
            :transform="`translate(${node.x}, ${node.y})`"
          >
            <circle
              r="20"
              :fill="node.isCurrent ? '#1890ff' : '#52c41a'"
              stroke="#fff"
              stroke-width="2"
            />
            <text
              text-anchor="middle"
              dy="4"
              :fill="node.isCurrent ? '#fff' : '#fff'"
              font-size="10"
            >
              {{ node.label.substring(0, 3) }}
            </text>
            <title>{{ node.label }}</title>
          </g>
        </g>
      </svg>
      <!-- 关系图例 -->
      <div class="legend" v-if="edges.length > 0">
        <div class="legend-title">关系类型：</div>
        <div class="legend-items">
          <div class="legend-item" v-for="(item, i) in getUniqueRelationships()" :key="i">
            <span class="legend-color" :style="{ background: item.color }"></span>
            <span class="legend-label">{{ item.label || '默认' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.concept-graph-panel {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 2px dashed var(--border);
  background: var(--bg);
}

.concept-graph-header {
  padding: 0 0 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.concept-graph-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.concept-graph-controls {
  display: flex;
  gap: 8px;
}

.depth-select,
.layout-select {
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
}

.concept-graph-body {
  height: auto;
  min-height: 200px;
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 16px;
  position: relative;
}

.loading,
.placeholder {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
  padding: 40px 0;
  p {
    margin: 4px 0;
  }
}

.graph-svg {
  width: 100%;
  height: 200px;
}

.legend {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.legend-title {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.legend-items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.legend-color {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  display: inline-block;
}
</style>
