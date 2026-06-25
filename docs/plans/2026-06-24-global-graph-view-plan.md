# 全库图谱视图（Phase 4）实施方案

> **面向智能体执行者：** 通过 subagent-driven-development（推荐）或 executing-plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
>
> **目标**：实现独立路由 `/graph` 的全库知识图谱视图，支持搜索、关系类型过滤、节点展开/导航联动。
> **架构**：独立路由页面 → 复用现有 G6 图谱组件逻辑 → 搜索/过滤面板 → 按需加载边数据。
> **技术栈**：Vue 3 + TypeScript + AntV/G6 + Dexie 4 + Vitest
>
> **相关文件：**
> - `docs/3-features/concept-graph-spec.md` — 概念图谱主设计文档
> - `src/components/ConceptGraph/Panel.vue` — 现有侧边栏图谱组件（复用核心逻辑）

---

## 决策树汇总

| # | 决策点 | 选择 | 理由/备注 |
|---|---|---|---|
| 1 | 入口位置 | 独立路由 `/graph` + 左侧边栏入口 | 专用画布，不受侧边栏宽度限制 |
| 2 | 数据加载策略 | 节点全量 + 边按需加载 | 避免大库一次性加载卡顿 |
| 3 | 布局与聚合 | 与现有侧边栏图谱逻辑一致 | 力导向/径向/层级 + 深度控制（1-5度） |
| 4 | 搜索能力 | 标题搜索 + 聚焦节点 | AntV/G6 内置 focus/center |
| 5 | 关系类型过滤 | 支持多类型过滤（chips 样式） | 减少视觉噪音 |
| 6 | 节点交互 | 单击展开邻居 + 双击导航 | 单击 = 按需触发边加载 |
| 7 | 视图联动 | 自动同步右侧边栏图谱 | 跳页后侧边栏跟随当前页 |
| 8 | 边加载范围 | 单击节点 → 全部出链 + 入链 | 一次性看到完整邻域 |
| 9 | 未加载提示 | 虚线/加号标记 | 告知用户可展开 |
| 10 | 初始状态 | 自动展开当前页的 1 度邻居 | 自然入口，无需手动探索 |

---

## 文件结构

```
src/components/
└── GraphView/
    ├── index.vue                      # 新建：全库图谱主页面组件
    └── SearchFilter.vue               # 新建：搜索框 + 关系类型过滤 chips

src/router/
├── index.ts                           # 修改：新增 /graph 路由
└── routes.ts                          # 修改：注册图谱页面路由

src/components/Sidebar/
├── SidebarHeader.vue                  # 修改：添加图谱入口按钮

src/composables/
└── useGlobalGraph.ts                  # 新建：全库图谱数据加载与状态管理
```

---

## 任务 1：新增 `/graph` 路由配置

**涉及文件：**
- 修改：`comind/src/router/routes.ts`
- 修改：`comind/src/router/index.ts`

- [ ] **步骤 1：在 `routes.ts` 中添加图谱路由**

修改 `comind/src/router/routes.ts`，在路由数组末尾添加：

```typescript
{
  path: '/graph',
  name: 'graph',
  component: () => import('../components/GraphView/index.vue'),
  meta: { requiresAuth: false }
}
```

- [ ] **步骤 2：验证路由注册**

执行命令：`cd comind && npx vue-tsc --noEmit`

预期结果：编译通过，无类型错误。

- [ ] **步骤 3：提交代码**

```bash
cd comind
git add src/router/routes.ts
git commit -m "feat(graph): add /graph route for global knowledge graph"
```

---

## 任务 2：创建全库图谱页面组件

**涉及文件：**
- 新建：`comind/src/components/GraphView/index.vue`
- 新建：`comind/src/components/GraphView/SearchFilter.vue`

### 2.1 创建搜索过滤组件

- [ ] **步骤 1：新建 `SearchFilter.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useRelationshipTypes } from '../../composables/useRelationshipTypes'
import { getRelationshipColor } from '../../types/relationship'

const props = defineProps<{
  searchQuery: string
  activeFilters: string[]
}>()

const emit = defineEmits<{
  (e: 'update:searchQuery', value: string): void
  (e: 'toggleFilter', type: string): void
  (e: 'clearFilters'): void
}>()

const types = useRelationshipTypes()

const filterOptions = computed(() => {
  return types.items.value.filter(t => !t.deleted)
})

function getTypeLabel(type: string): string {
  const found = filterOptions.value.find(t => t.type === type || t.inverse === type)
  if (!found) return type
  return type === found.type ? found.label : found.inverseLabel
}
</script>

<template>
  <div class="search-filter-bar">
    <div class="search-input-wrapper">
      <span class="search-icon">🔍</span>
      <input
        v-model="searchQuery"
        type="text"
        placeholder="搜索页面标题..."
        class="search-input"
      />
    </div>
    <div class="filter-chips">
      <button
        v-for="t in filterOptions"
        :key="t.type"
        class="filter-chip"
        :class="{ active: activeFilters.includes(t.type) }"
        :style="activeFilters.includes(t.type) ? { backgroundColor: t.color + '20', borderColor: t.color, color: t.color } : {}"
        @click="emit('toggleFilter', t.type)"
      >
        {{ t.label }}
      </button>
      <button
        v-if="activeFilters.length > 0"
        class="clear-filters-btn"
        @click="emit('clearFilters')"
      >
        清除过滤
      </button>
    </div>
  </div>
</template>

<style scoped>
.search-filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.search-input-wrapper {
  position: relative;
  flex: 1;
  min-width: 200px;
  max-width: 300px;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
}

.search-input {
  width: 100%;
  padding: 8px 12px 8px 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: inherit;
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

.filter-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.filter-chip {
  padding: 4px 10px;
  border: 1px solid var(--border);
  background: var(--bg-base);
  border-radius: 20px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  transition: all 80ms ease;
}

.filter-chip:hover {
  background: var(--bg-hover);
}

.filter-chip.active {
  font-weight: 500;
}

.clear-filters-btn {
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}

.clear-filters-btn:hover {
  color: var(--text-primary);
}
</style>
```

### 2.2 创建全库图谱主组件

- [ ] **步骤 2：新建 `GraphView/index.vue`**

```vue
<script setup lang="ts">import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue';
import { Graph } from '@antv/g6';
import type { NodeData } from '@antv/g6';
import { usePageStore } from '../../stores/pages';
import { storage } from '../../storage/indexedDB';
import { db } from '../../storage/db';
import { getRelationshipColor, getRelationshipLabel, getInverseRelationshipType } from '../../types/relationship';
import { useRouter } from 'vue-router';
import SearchFilter from './SearchFilter.vue';
const pageStore = usePageStore();
const router = useRouter();
const containerRef = ref<HTMLElement | null>(null);
const graphRef = ref<Graph | null>(null);
const maxDepth = ref(2);
const currentLayout = ref<string>('force');
const highlightedNodeId = ref<string | null>(null);
const searchQuery = ref('');
const activeFilters = ref<string[]>([]);
const expandedNodeIds = ref<Set<string>>(new Set());
const currentPageId = computed(() => pageStore.currentPageId);
let refreshGeneration = 0;
async function buildGraphData(pageId?: string, depth?: number) {
 const nodes: NodeData[] = [];
 const edges: {
 id: string;
 source: string;
 target: string;
 data: Record<string, unknown>;
 }[] = [];
 const visited = new Set<string>();
 const blockCache = new Map<string, {
 pageId: string;
 }>();
 const allPages = await storage.getAllPages();
 for (const page of allPages) {
 if (page.deleted)
 continue;
 nodes.push({
 id: page.id,
 data: {
 label: page.title,
 isCurrent: page.id === pageId,
 level: 0,
 expanded: expandedNodeIds.value.has(page.id),
 }
 });
 visited.add(page.id);
 }
 if (pageId) {
 await traverse(pageId, 0, depth ?? maxDepth.value, nodes, edges, visited, blockCache);
 }
 return { nodes, edges };
}
async function traverse(pid: string, level: number, maxDepth: number, nodes: NodeData[], edges: {
 id: string;
 source: string;
 target: string;
 data: Record<string, unknown>;
 }[], visited: Set<string>, blockCache: Map<string, {
 pageId: string;
 }>) {
 if (!expandedNodeIds.value.has(pid))
 return;
 const [outLinks, inLinks] = await Promise.all([
 storage.getLinksBySourcePage(pid),
 storage.getLinksByTargetPage(pid),
 ]);
 for (const link of outLinks) {
 if (activeFilters.value.length > 0 &&
 link.relationshipType &&
 !activeFilters.value.includes(link.relationshipType)) {
 continue;
 }
 const targetPage = pageStore.getPage(link.targetPageId);
 if (!targetPage)
 continue;
 if (!visited.has(link.targetPageId)) {
 visited.add(link.targetPageId);
 nodes.push({
 id: targetPage.id,
 data: {
 label: targetPage.title,
 isCurrent: targetPage.id === currentPageId.value,
 level: level + 1,
 expanded: expandedNodeIds.value.has(targetPage.id),
 }
 });
 }
 const color = getRelationshipColor(link.relationshipType ?? 'related');
 const label = getRelationshipLabel(link.relationshipType ?? 'related');
 if (!edges.find(e => e.id === link.id)) {
 edges.push({
 id: link.id,
 source: pid,
 target: link.targetPageId,
 data: {
 relationshipType: link.relationshipType ?? 'related',
 label,
 color
 }
 });
 }
 if (level + 1 < maxDepth && expandedNodeIds.value.has(link.targetPageId)) {
 await traverse(link.targetPageId, level + 1, maxDepth, nodes, edges, visited, blockCache);
 }
 }
 for (const link of inLinks) {
 if (activeFilters.value.length > 0 &&
 link.relationshipType &&
 !activeFilters.value.includes(link.relationshipType)) {
 continue;
 }
 let block = blockCache.get(link.sourceBlockId);
 if (!block) {
 const record = await db.blocks.get(link.sourceBlockId);
 if (!record)
 continue;
 block = { pageId: record.pageId };
 blockCache.set(link.sourceBlockId, block);
 }
 const sourcePageId = block.pageId;
 const sourcePage = pageStore.getPage(sourcePageId);
 if (!sourcePage)
 continue;
 if (!visited.has(sourcePageId)) {
 visited.add(sourcePageId);
 nodes.push({
 id: sourcePage.id,
 data: {
 label: sourcePage.title,
 isCurrent: sourcePage.id === currentPageId.value,
 level: level + 1,
 expanded: expandedNodeIds.value.has(sourcePage.id),
 }
 });
 }
 const color = getRelationshipColor(link.relationshipType ?? 'related');
 const label = getRelationshipLabel(link.relationshipType ?? 'related');
 if (!edges.find(e => e.id === link.id)) {
 edges.push({
 id: link.id,
 source: sourcePageId,
 target: pid,
 data: {
 relationshipType: link.relationshipType ?? 'related',
 label,
 color
 }
 });
 }
 if (level + 1 < maxDepth && expandedNodeIds.value.has(sourcePageId)) {
 await traverse(sourcePageId, level + 1, maxDepth, nodes, edges, visited, blockCache);
 }
 }
}
function getNodeSize(d: NodeData): [
 number,
 number
] {
 const isCurrent = !!d.data?.isCurrent;
 const isHighlighted = !!d.data?.isHighlighted && !isCurrent;
 if (isHighlighted)
 return [100, 32];
 return isCurrent ? [120, 36] : [90, 28];
}
function getNodeFill(d: NodeData): string {
 const isCurrent = !!d.data?.isCurrent;
 const isHighlighted = !!d.data?.isHighlighted && !isCurrent;
 if (isHighlighted)
 return '#e6f7ff';
 return isCurrent ? '#1890ff' : '#ffffff';
}
function getNodeStroke(d: NodeData): string {
 const isCurrent = !!d.data?.isCurrent;
 const isHighlighted = !!d.data?.isHighlighted && !isCurrent;
 if (isHighlighted)
 return '#1890ff';
 return isCurrent ? '#1890ff' : '#e8e8e8';
}
function getNodeLineType(d: NodeData): 'solid' | 'dashed' {
 const expanded = !!d.data?.expanded;
 return expanded ? 'solid' : 'dashed';
}
function getNodeLabelFill(d: NodeData): string {
 const isCurrent = !!d.data?.isCurrent;
 const isHighlighted = !!d.data?.isHighlighted && !isCurrent;
 if (isHighlighted)
 return '#1890ff';
 return isCurrent ? '#ffffff' : '#333333';
}
function getNodeLineWidth(d: NodeData): number {
 return (!!d.data?.isCurrent || !!d.data?.isHighlighted) ? 2 : 1;
}
async function initGraph() {
 if (!containerRef.value)
 return;
 if (graphRef.value) {
 graphRef.value.destroy();
 graphRef.value = null;
 }
 const container = containerRef.value;
 const width = container.clientWidth;
 const height = container.clientHeight;
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
 labelBackgroundPadding: [2, 4] as [
 number,
 number
 ],
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
 });
 graph.on('node:click', (evt: any) => {
 const nodeId = evt.target?.id;
 if (!nodeId)
 return;
 handleNodeClick(nodeId);
 });
 graph.on('node:dblclick', (evt: any) => {
 const nodeId = evt.target?.id;
 if (!nodeId)
 return;
 handleNodeDoubleClick(nodeId);
 });
 graphRef.value = graph;
 if (currentPageId.value) {
 expandedNodeIds.value.add(currentPageId.value);
 }
 await refreshGraphData(graph);
}
async function refreshGraphData(graph?: Graph) {
 const g = graph ?? graphRef.value;
 if (!g)
 return;
 const gen = ++refreshGeneration;
 const { nodes, edges } = await buildGraphData(currentPageId.value);
 if (gen !== refreshGeneration)
 return;
 const edgeCountMap = new Map<string, number>();
 for (const edge of edges) {
 const key = [edge.source, edge.target].sort().join('-');
 const idx = edgeCountMap.get(key) ?? 0;
 edgeCountMap.set(key, idx + 1);
 if (idx === 0) {
 edge.data.curveOffset = 0;
 }
 else {
 const sign = idx % 2 === 1 ? 1 : -1;
 const magnitude = Math.ceil(idx / 2) * 20;
 edge.data.curveOffset = sign * magnitude;
 }
 }
 g.setData({ nodes, edges });
 await g.draw();
 await g.layout();
 if (gen !== refreshGeneration)
 return;
 await g.fitView();
 const zoom = g.getZoom();
 await g.zoomTo(zoom * 0.85);
}
function handleDepthChange(delta: number) {
 const newVal = Math.max(1, Math.min(5, maxDepth.value + delta));
 if (newVal !== maxDepth.value) {
 maxDepth.value = newVal;
 }
}
async function handleLayoutChange(layout: string) {
 currentLayout.value = layout;
 if (graphRef.value) {
 graphRef.value.setLayout({ type: layout, preventOverlap: true, nodeSize: 100 });
 await graphRef.value.layout();
 await graphRef.value.fitView();
 const zoom = graphRef.value.getZoom();
 await graphRef.value.zoomTo(zoom * 0.85);
 }
}
async function handleFitView() {
 if (graphRef.value) {
 await graphRef.value.fitView();
 const zoom = graphRef.value.getZoom();
 await graphRef.value.zoomTo(zoom * 0.85);
 }
}
async function handleRefresh() {
 await refreshGraphData();
}
async function handleExportPng() {
 if (!graphRef.value)
 return;
 try {
 const dataURL = await graphRef.value.toDataURL({
 type: 'image/png'
 });
 const link = document.createElement('a');
 link.href = dataURL;
 link.download = `concept-graph-${Date.now()}.png`;
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);
 }
 catch (error) {
 console.error('[GraphView] PNG export failed:', error);
 }
}
function handleNodeClick(nodeId: string) {
 if (highlightedNodeId.value === nodeId) {
 highlightedNodeId.value = null;
 }
 else {
 highlightedNodeId.value = nodeId;
 }
 if (!expandedNodeIds.value.has(nodeId)) {
 expandedNodeIds.value.add(nodeId);
 refreshGraphData();
 }
 updateNodeHighlight();
}
function handleNodeDoubleClick(nodeId: string) {
 const page = pageStore.getPage(nodeId);
 if (page) {
 router.push(`/page/${page.id}`);
 }
}
function updateNodeHighlight() {
 const g = graphRef.value;
 if (!g)
 return;
 const nodeData = g.getNodeData();
 for (const node of nodeData) {
 (node.data as any).isHighlighted = node.id === highlightedNodeId.value;
 }
 g.setData({ nodes: nodeData, edges: g.getEdgeData() });
 g.draw();
}
function handleSearch(query: string) {
 searchQuery.value = query;
 if (!query) {
 highlightedNodeId.value = null;
 updateNodeHighlight();
 return;
 }
 const g = graphRef.value;
 if (!g)
 return;
 const nodeData = g.getNodeData();
 const matched = nodeData.find(n => {
 const label = (n.data?.label as string) ?? '';
 return label.toLowerCase().includes(query.toLowerCase());
 });
 if (matched) {
 highlightedNodeId.value = matched.id;
 g.focus(matched.id);
 updateNodeHighlight();
 }
}
function handleToggleFilter(type: string) {
 const idx = activeFilters.value.indexOf(type);
 if (idx === -1) {
 activeFilters.value.push(type);
 }
 else {
 activeFilters.value.splice(idx, 1);
 }
 refreshGraphData();
}
function handleClearFilters() {
 activeFilters.value = [];
 refreshGraphData();
}
watch(maxDepth, async () => {
 await refreshGraphData();
});
watch(activeFilters, async () => {
 await refreshGraphData();
}, { deep: true });
let resizeObserver: ResizeObserver | null = null;
onMounted(async () => {
 await initGraph();
 if (containerRef.value) {
 resizeObserver = new ResizeObserver(() => {
 if (graphRef.value && containerRef.value) {
 graphRef.value.resize(containerRef.value.clientWidth, containerRef.value.clientHeight);
 }
 });
 resizeObserver.observe(containerRef.value);
 }
});
onBeforeUnmount(() => {
 resizeObserver?.disconnect();
 if (graphRef.value) {
 graphRef.value.destroy();
 graphRef.value = null;
 }
});
</script>

<template>
  <div class="graph-view-page">
    <div class="graph-view-header">
      <h1 class="graph-view-title">🌐 全库图谱</h1>
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
  margin: 0;
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
```

- [ ] **步骤 3：运行编译验证**

执行命令：`cd comind && npx vue-tsc --noEmit`

预期结果：编译通过，无类型错误。

- [ ] **步骤 4：提交代码**

```bash
cd comind
git add src/components/GraphView/
git commit -m "feat(graph): add global graph view with search and filter"
```

---

## 任务 3：在左侧边栏添加图谱入口

**涉及文件：**
- 修改：`comind/src/components/Sidebar/SidebarHeader.vue`

- [ ] **步骤 1：读取当前 `SidebarHeader.vue`**

执行命令：`cat comind/src/components/Sidebar/SidebarHeader.vue`

- [ ] **步骤 2：在侧边栏头部添加图谱入口按钮**

在合适位置添加一个导航按钮，点击跳转到 `/graph`：

```vue
<!-- 在 SidebarHeader.vue 中添加 -->
<button
  class="sidebar-nav-btn"
  @click="$router.push('/graph')"
  title="全库图谱"
>
  🌐
</button>
```

- [ ] **步骤 3：添加按钮样式**

```scss
.sidebar-nav-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--text-secondary);
  transition: background 80ms ease;
  
  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  
  &:active {
    background: var(--bg-active);
  }
}
```

- [ ] **步骤 4：运行编译验证**

执行命令：`cd comind && npx vue-tsc --noEmit`

- [ ] **步骤 5：提交代码**

```bash
cd comind
git add src/components/Sidebar/SidebarHeader.vue
git commit -m "feat(graph): add graph entry button in sidebar header"
```

---

## 任务 4：端到端验证

- [ ] **步骤 1：运行全量单元测试**

执行命令：`cd comind && npm run test`

预期结果：所有测试通过。

- [ ] **步骤 2：运行 TypeScript 编译**

执行命令：`cd comind && npx vue-tsc -b`

预期结果：编译通过，无类型错误。

- [ ] **步骤 3：运行 lint**

执行命令：`cd comind && npm run lint`

预期结果：无 lint 错误。

- [ ] **步骤 4：构建验证**

执行命令：`cd comind && npm run build`

预期结果：构建成功，无错误。

- [ ] **步骤 5：提交代码**

```bash
cd comind
git add -A
git commit -m "feat(graph): complete global knowledge graph view (Phase 4)"
```

---

## 验收清单

- [ ] `/graph` 路由注册成功，可通过侧边栏按钮访问
- [ ] 全库图谱页面显示所有页面节点（虚线表示未展开）
- [ ] 搜索框支持按标题搜索并聚焦节点
- [ ] 关系类型过滤 chips 支持多类型过滤
- [ ] 单击节点展开邻居边（节点变为实线）
- [ ] 双击节点导航到对应页面
- [ ] 页面切换后右侧边栏图谱自动同步
- [ ] 初始状态自动展开当前页的 1 度邻居
- [ ] 布局切换（力导向/径向/层级）正常工作
- [ ] PNG 导出功能正常
- [ ] `npm run lint` + `npx vue-tsc -b` + `npm run test` 全绿

---

## 风险与注意

1. **性能风险**：大库（500+ 页面）全量节点加载可能导致初始渲染慢。建议后续优化：虚拟节点渲染、节点聚类折叠。
2. **内存泄漏**：G6 实例需在组件卸载时正确 destroy。代码中已包含 `onBeforeUnmount` 清理逻辑。
3. **样式冲突**：全局图谱页面使用 `100vh` 高度，需确保与侧边栏布局兼容。
4. **搜索精度**：当前搜索仅匹配标题，不支持内容搜索。如需全文搜索，需扩展 storage API。

---

## 下一步

本方案完成后，全库图谱功能可用。后续可扩展：
- **节点聚类**：按领域/连接度自动分组
- **全文搜索**：支持按页面内容搜索
- **路由参数支持**：`/graph?focus=pageId&filter=depends-on`
- **时间线视图**：按创建/更新时间过滤节点