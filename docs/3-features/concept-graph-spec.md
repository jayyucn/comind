# 概念图谱（Concept Graph）方案设计

> 版本：v0.5
> 日期：2026-06-03
> 状态：**已实现 Phase 1 基础功能**

---

## 1. 概述

### 1.1 目标

为 comind 添加**概念图谱**功能，支持：

- 链接语义化：给双向链接添加关系类型（relationship type）
- 知识图谱可视化：在页面右侧边栏展示当前页面的关联网络
- 语法扩展：使用 `[[页面名]]^(关系类型)` 语法表达关系

### 1.2 核心原则

- **渐进式**：先支持基础语义，后续可扩展
- **向后兼容**：现有 `[[页面名]]` 语法继续有效，关系类型默认为 null
- **灵活配置**：预定义关系类型 + 用户自定义

### 1.3 实现状态

| Phase | 内容 | 状态 |
|-------|------|------|
| Phase 1 | 右侧边栏面板系统 + 概念图谱可视化 | ✅ 已完成 |
| Phase 2 | 关系类型选择菜单 + 编辑器支持 | 🔄 进行中 |
| Phase 3 | 自定义关系类型 + 高级图谱功能 | 📋 待开始 |

---

## 1. 概述

### 1.1 目标

为 comind 添加**概念图谱**功能，支持：

- 链接语义化：给双向链接添加关系类型（relationship type）
- 知识图谱可视化：在页面右侧边栏展示当前页面的关联网络
- 语法扩展：使用 `[[页面名]]^(关系类型)` 语法表达关系

### 1.2 核心原则

- **渐进式**：先支持基础语义，后续可扩展
- **向后兼容**：现有 `[[页面名]]` 语法继续有效，关系类型默认为 null
- **灵活配置**：预定义关系类型 + 用户自定义

---

## 2. 数据模型设计

### 2.1 Link 表扩展

在现有 Link 数据模型基础上新增字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `relationshipType` | string \| null | 关系类型（如 "depends-on", "parent", "related"） |
| `inverseRelationshipType` | string \| null | 反向关系类型（如 "required-by", "child", "related"） |

**类型定义变更**：

```typescript
// types/link.ts
export interface Link {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  relationshipType: string | null  // 新增
  inverseRelationshipType: string | null  // 新增
  createdAt: number
}

export interface LinkRecord {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  relationshipType: string | null  // 新增
  inverseRelationshipType: string | null  // 新增
  createdAt: number
}
```

### 2.2 预定义关系类型

提供一组常用的预定义关系类型，每种关系类型有对应的颜色配置：

```typescript
const PREDEFINED_RELATIONSHIPS = [
  // 层级关系
  { type: 'parent', inverse: 'child', label: '父级', inverseLabel: '子级', color: '#1890ff' },
  { type: 'child', inverse: 'parent', label: '子级', inverseLabel: '父级', color: '#1890ff' },
  
  // 依赖关系
  { type: 'depends-on', inverse: 'required-by', label: '依赖', inverseLabel: '被依赖', color: '#faad14' },
  { type: 'required-by', inverse: 'depends-on', label: '被依赖', inverseLabel: '依赖', color: '#faad14' },
  
  // 引用关系
  { type: 'references', inverse: 'referenced-by', label: '引用', inverseLabel: '被引用', color: '#52c41a' },
  { type: 'referenced-by', inverse: 'references', label: '被引用', inverseLabel: '引用', color: '#52c41a' },
  
  // 示例关系
  { type: 'example-of', inverse: 'has-example', label: '示例', inverseLabel: '有示例', color: '#eb2f96' },
  { type: 'has-example', inverse: 'example-of', label: '有示例', inverseLabel: '示例', color: '#eb2f96' },
  
  // 通用关系
  { type: 'related', inverse: 'related', label: '相关', inverseLabel: '相关', color: '#8c8c8c' },
  { type: 'similar', inverse: 'similar', label: '相似', inverseLabel: '相似', color: '#722ed1' },
]
```

### 2.3 IndexedDB Schema 升级

需要升级数据库版本从 6 到 7：

```typescript
// storage/db.ts
this.version(7)
  .stores({
    blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
    links: 'id, sourceBlockId, targetPageId, displayText, relationshipType, createdAt',  // 新增 relationshipType 索引
    pages: 'id, blockId, title, type, deleted, createdAt, updatedAt',
    properties: 'id, blockId, [blockId+key]',
    assets: 'id',
  })
  .upgrade((tx) => {
    // 给现有 links 表添加新字段，默认值为 null
    const linksStore = tx.store('links')
    // Dexie 会自动处理新增字段，旧记录缺失字段为 undefined
  })
```

---

## 3. 语法设计

### 3.1 新语法：`[[页面名]]^(关系类型)`（源文件存储格式）

示例：

| 语法 | 说明 |
|------|------|
| `[[项目A]]` | 无关系类型（兼容现有） |
| `[[项目A]]^(depends-on)` | 指定关系类型为 "depends-on" |
| `[[项目A|别名]]^(depends-on)` | 同时使用别名和关系类型 |
| `[[项目A]]^(我的自定义关系)` | 自定义关系类型 |

### 3.2 渲染格式：`[[页面名]]^depends-on`（用户看到的格式）

虽然源文件存 `[[页面名]]^(关系类型)`，但渲染时显示为 `[[页面名]]^depends-on`（不带括号）：

- `^` 符号始终显示，作为分隔符
- 关系类型用对应颜色显示（和概念图颜色一致）
- 点击 `^depends-on` 区域弹出关系类型选择菜单
- 点击 `[[页面名]]` 区域跳转到对应页面

### 3.3 反向关系可选语法

如果用户想要同时创建反向关系，可以使用：

| 语法 | 说明 |
|------|------|
| `[[项目A]]^(depends-on<->required-by)` | 同时创建反向关系 "required-by" |
| `[[项目A]]^(parent<->child)` | 同时创建反向关系 "child" |

简化形式（使用预定义的反向关系）：

| 语法 | 说明 |
|------|------|
| `[[项目A]]^(depends-on!)` | 使用预定义的反向关系自动创建 |
| `[[项目A]]^(parent!)` | 使用预定义的反向关系自动创建 |

### 3.4 关系类型选择菜单

**菜单触发**：
- 仅点击 `^depends-on` 这个关系类型部分弹出菜单
- 点击 `[[页面名]]` 部分跳转到对应页面
- 按 ESC 可以关闭菜单

**菜单内容**：
- 显示预定义关系类型的中文标签
- 每个选项用对应颜色显示
- 包含「移除关系类型」选项
- 风格和现有的 `[[ ]]` 链接补全菜单一致

**菜单行为**：
- 点击菜单选项后立即应用修改并关闭菜单
- 选择「移除关系类型」会把 `[[B]]^depends-on` 变成 `[[B]]`（保留链接，移除关系类型）

### 3.5 正则表达式设计

```typescript
// 匹配 [[页面名]]^(关系类型) 或 [[页面名|别名]]^(关系类型)
// 同时支持可选的反向关系语法
const LINK_WITH_RELATIONSHIP_REGEX = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]\^?\(([^)]+)\)/gi

// 关系类型内部解析：
// - "depends-on" → { type: "depends-on", inverse: null }
// - "depends-on<->required-by" → { type: "depends-on", inverse: "required-by" }
// - "depends-on!" → { type: "depends-on", inverse: "auto" }
const RELATIONSHIP_PATTERN = /^([^!<>]+)(?:!(?:<->([^!<>]+))?)?$/
```

### 3.6 LinkParse 类型扩展

```typescript
export interface LinkParse {
  targetTitle: string
  displayText: string
  position: number
  isExternal: boolean
  relationshipType: string | null  // 新增
  inverseRelationshipType: string | null  // 新增
}
```

---

## 4. 自动推断与同步机制

### 4.1 回车后自动推断反向关系

**触发时机**：用户输入 `[[B]]` 后按回车时

**流程**：
1. 检查 B 页面是否有指向 A 的关系类型
2. 如果有，自动在 A 页面的 `[[B]]` 后加上反向关系类型
3. 例如：B 页面有 `[[A]]^(child)`，则 A 页面的 `[[B]]` 自动变成 `[[B]]^(parent)`

### 4.2 同一页面内多链接同步

**核心原则**：同一个页面的多个指向相同页面的链接，关系类型必定一致

**同步范围**：所有指向相同页面的链接（同一页面内）

**同步机制**：通过 Vue 的响应式系统（computed/watch）实现

**行为示例**：
- A 页面有 Block 1、2、3 都有 `[[B]]^parent`
- 修改 Block 1 的关系类型为 `^child`
- Block 2、3 会立即同步更新为 `^child`

### 4.3 级联删除/修改的例外

**规则**：正在修改的地方不会自动删除

**场景示例**：
- A 页面有 Block 1、2、3 都有 `[[B]]^parent`
- 正在编辑 Block 1，把 `^parent` 删掉了
- Block 2、3 的 `^parent` 会被自动删除
- 但 Block 1 保持你修改后的状态
- 如果你在 Block 1 里又加上 `^child`，Block 2、3 会自动变成 `^child`

**源文件编辑保护**：
- 当你直接在 Markdown 源文件里删除或修改关系类型时（例如删掉 `^(...)` 的一部分）
- 其他相关链接的完整关系类型会被删除
- 但你正在编辑的这个地方保持原样

---

## 5. 存储层实现

### 5.1 解析逻辑变更

修改 `parseBlockLinks` 函数以支持新语法：

```typescript
// utils/parser.ts
export function parseBlockLinks(content: string): LinkParse[] {
  const results: LinkParse[] = []
  
  // 1. 先匹配带关系类型的链接 [[...]]^(...)
  const relationshipRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]\(([^)]+)\)/gi
  let match
  while ((match = relationshipRegex.exec(content)) !== null) {
    const target = match[1].trim()
    const display = (match[2] || target).trim()
    const relationshipPart = match[3].trim()
    
    // 解析关系类型部分
    const { relationshipType, inverseRelationshipType } = parseRelationshipPart(relationshipPart)
    
    results.push({
      targetTitle: target,
      displayText: display,
      position: match.index,
      isExternal: /^(https?:\/\/|ftp:\/\/|mailto:)/i.test(target),
      relationshipType,
      inverseRelationshipType,
    })
  }
  
  // 2. 再匹配普通链接 [[...]]（排除已匹配的位置）
  const plainRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/gi
  while ((match = plainRegex.exec(content)) !== null) {
    // 检查是否已被关系类型链接匹配
    const alreadyMatched = results.some(r => r.position === match.index)
    if (alreadyMatched) continue
    
    const target = match[1].trim()
    const display = (match[2] || target).trim()
    
    results.push({
      targetTitle: target,
      displayText: display,
      position: match.index,
      isExternal: /^(https?:\/\/|ftp:\/\/|mailto:)/i.test(target),
      relationshipType: null,
      inverseRelationshipType: null,
    })
  }
  
  // 排序去重...
  return results.sort((a, b) => a.position - b.position)
}

function parseRelationshipPart(part: string): {
  relationshipType: string | null
  inverseRelationshipType: string | null
} {
  // 格式 1: "depends-on<->required-by"
  const bidirectionalMatch = part.match(/^([^<]+)<->(.+)$/)
  if (bidirectionalMatch) {
    return {
      relationshipType: bidirectionalMatch[1].trim(),
      inverseRelationshipType: bidirectionalMatch[2].trim(),
    }
  }
  
  // 格式 2: "depends-on!"（自动使用预定义反向）
  const autoInverseMatch = part.match(/^(.+)!$/)
  if (autoInverseMatch) {
    const type = autoInverseMatch[1].trim()
    const predefined = PREDEFINED_RELATIONSHIPS.find(r => r.type === type)
    return {
      relationshipType: type,
      inverseRelationshipType: predefined?.inverse || null,
    }
  }
  
  // 格式 3: "depends-on"（单向）
  return {
    relationshipType: part.trim(),
    inverseRelationshipType: null,
  }
}
```

### 5.2 反向链接创建策略

当用户输入 `[[B]]^(depends-on!)` 时，会在 B 页面自动创建反向链接 `[[A]]^(required-by)`。具体策略：

**查找策略：**
1. 在 B 页面的所有 Block 中查找是否已有指向 A 的链接（精确匹配完整链接，包括 `[[A]]` 或 `[[A|别名]]`）
2. 如果找到：
   - 替换或追加关系类型
   - 如果 B 页面中有多个指向 A 的链接，所有链接的关系类型保持同步一致

**插入策略：**
1. 如果未找到现有链接，查找 B 页面最后一个一级 Block（parentId 为 null 的 Block，排除 isPage = true 的根 Block）
2. 如果 B 页面没有内容（全新页面）：
   - 先创建根 Block
   - 把反向链接作为根 Block 的内容

**同步策略：**
1. 当 A 页面删除/修改了链接时，目标页面的反向链接会自动删除/更新
2. 编辑冲突时后写入优先

### 5.3 保存逻辑变更

修改 `saveLinks` 方法以保存关系类型并处理反向链接：

```typescript
// storage/indexedDB.ts
private async saveLinks(sourceBlockId: string, _pageId: string, linkParses: LinkParse[]): Promise<{ skippedTrashedPages: string[] }> {
  const skippedTrashedPages: string[] = []

  await db.links.where('sourceBlockId').equals(sourceBlockId).delete()

  for (const link of linkParses) {
    if (!link.isExternal) {
      const normalized = normalizeJournalTitle(link.targetTitle)
      const lookupTitle = normalized ?? link.targetTitle
      const existingPage = await db.pages.where('title').equals(lookupTitle).first()

      if (existingPage && existingPage.deleted === 1) {
        skippedTrashedPages.push(lookupTitle)
        continue
      }

      if (existingPage) {
        // 保存正向链接
        await db.links.add({
          id: generateUUID(),
          sourceBlockId,
          targetPageId: existingPage.id,
          displayText: link.displayText,
          relationshipType: link.relationshipType,
          inverseRelationshipType: link.inverseRelationshipType,
          createdAt: Date.now(),
        })
        
        // 如果指定了反向关系，创建反向链接
        if (link.inverseRelationshipType) {
          await this.createInverseLink(
            sourceBlockId, 
            existingPage.id, 
            link.targetTitle, 
            link.inverseRelationshipType
          )
        }
      }
    }
  }

  return { skippedTrashedPages }
}

/**
 * 创建反向链接
 */
private async createInverseLink(
  sourceBlockId: string,
  targetPageId: string,
  targetPageTitle: string,
  inverseRelationshipType: string
): Promise<void> {
  // 获取源 Block 所在的页面信息
  const sourceBlock = await db.blocks.get(sourceBlockId)
  if (!sourceBlock) return
  
  const sourcePage = await db.pages.get(sourceBlock.pageId)
  if (!sourcePage) return
  
  // 1. 在目标页面查找现有指向源页面的链接
  const targetBlocks = await db.blocks.where('pageId').equals(targetPageId).toArray()
  let found = false
  
  for (const block of targetBlocks) {
    const links = parseBlockLinks(block.content)
    const hasLinkToSource = links.some(l => l.targetTitle === sourcePage.title)
    
    if (hasLinkToSource) {
      // 更新该 Block 中所有指向源页面的链接，追加关系类型
      const updatedContent = this.updateLinksWithRelationshipType(
        block.content,
        sourcePage.title,
        inverseRelationshipType
      )
      
      if (updatedContent !== block.content) {
        await db.blocks.update(block.id, { 
          content: updatedContent, 
          updatedAt: Date.now() 
        })
      }
      
      found = true
    }
  }
  
  if (found) return
  
  // 2. 未找到，插入到最后一个一级 Block
  const topLevelBlocks = targetBlocks.filter(b => 
    b.parentId === null && !b.isPage
  ).sort((a, b) => a.pos - b.pos)
  
  if (topLevelBlocks.length > 0) {
    // 追加到最后一个一级 Block
    const lastBlock = topLevelBlocks[topLevelBlocks.length - 1]
    const inverseLinkText = `[[${sourcePage.title}]]^(${inverseRelationshipType})`
    const separator = lastBlock.content.trim() ? ' ' : ''
    
    await db.blocks.update(lastBlock.id, {
      content: lastBlock.content + separator + inverseLinkText,
      updatedAt: Date.now()
    })
  } else {
    // 3. 目标页面没有内容，创建根 Block
    const rootBlock = await this.createRootBlockWithLink(
      targetPageId,
      sourcePage.title,
      inverseRelationshipType
    )
    
    // 更新页面的 blockId
    await db.pages.update(targetPageId, { blockId: rootBlock.id })
  }
}

/**
 * 更新 Block 内容中指向特定页面的链接，追加关系类型
 */
private updateLinksWithRelationshipType(
  content: string,
  targetPageTitle: string,
  relationshipType: string
): string {
  // 匹配 [[target]] 或 [[target|alias]]
  const linkRegex = new RegExp(
    `\\[\\[(${escapeRegex(targetPageTitle)})(?:\\|[^\\]]+?)?\\]\\](?:\\^\\([^)]+?\\))?`,
    'g'
  )
  
  return content.replace(linkRegex, (match, titlePart) => {
    // 提取原链接（不带关系类型的部分）
    const baseMatch = match.match(/^\[\[[^\]]+?\]\]/)
    if (!baseMatch) return match
    
    // 追加或替换关系类型
    return `${baseMatch[0]}^(${relationshipType})`
  })
}
```

---

## 6. 概念图谱可视化

### 6.1 组件位置

在页面右侧边栏新增 `ConceptGraph` 组件，与 Backlinks 类似。

### 6.2 可视化库推荐

推荐使用 **AntV/G6**：

- 中文文档友好
- 专门做图可视化
- 内置多种布局算法
- 社区活跃

备选方案：
- Cytoscape.js：更成熟，但中文资源少
- D3.js：最灵活，但上手复杂

### 6.3 概念图谱组件设计

```vue
<!-- components/ConceptGraph.vue -->
<template>
  <div class="concept-graph-panel">
    <div class="concept-graph-header">
      <span class="concept-graph-title">
        <span class="concept-graph-icon">🕸️</span>
        概念图谱
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
    <div ref="graphContainer" class="concept-graph-body"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, onBeforeUnmount } from 'vue'
import G6 from '@antv/g6'
import { usePageStore } from '../stores/pages'
import { storage } from '../storage/indexedDB'

const pageStore = usePageStore()
const graphContainer = ref<HTMLElement | null>(null)
const graphDepth = ref(2) // 默认 2 度
const graphLayout = ref('force') // 默认力导向
let graph: any = null

// 构建图数据
async function buildGraphData() {
  const currentPageId = pageStore.currentPageId
  if (!currentPageId) return { nodes: [], edges: [] }
  
  // 获取所有页面信息
  const allPages = await storage.getAllPages()
  const allLinks = await db.links.toArray()
  const allBlocks = await db.blocks.toArray()
  
  // 构建页面 ID 到页面的映射
  const pageIdMap = new Map(allPages.map(p => [p.id, p]))
  // 构建 Block ID 到页面 ID 的映射
  const blockPageMap = new Map(allBlocks.map(b => [b.id, b.pageId]))
  
  // 根据深度递归获取相关页面和链接
  const { pageIds, edges } = collectRelatedPagesAndEdges(
    currentPageId,
    graphDepth.value,
    pageIdMap,
    allLinks,
    blockPageMap
  )
  
  // 构建节点
  const nodes = Array.from(pageIds).map(pageId => {
    const page = pageIdMap.get(pageId)
    return {
      id: pageId,
      label: page?.title || '未知',
      // 当前页面高亮
      style: pageId === currentPageId ? { fill: '#1890ff', stroke: '#096dd9' } : undefined,
    }
  })
  
  // 构建边并应用关系类型颜色
  const graphEdges = edges.map(edge => ({
    ...edge,
    style: {
      stroke: getRelationshipColor(edge.relationshipType),
    },
  }))
  
  return { nodes, edges: graphEdges }
}

/**
 * 递归收集指定深度的相关页面和链接
 */
function collectRelatedPagesAndEdges(
  startPageId: string,
  maxDepth: number,
  pageIdMap: Map<string, any>,
  allLinks: any[],
  blockPageMap: Map<string, string>
) {
  const pageIds = new Set([startPageId])
  const edges: any[] = []
  const visited = new Set<string>()
  
  function traverse(currentPageId: string, currentDepth: number) {
    if (currentDepth > maxDepth || visited.has(currentPageId)) return
    visited.add(currentPageId)
    
    // 获取当前页面的出链和入链
    const outgoing = allLinks.filter(l => {
      const sourcePageId = blockPageMap.get(l.sourceBlockId)
      return sourcePageId === currentPageId
    })
    const incoming = allLinks.filter(l => l.targetPageId === currentPageId)
    
    // 处理出链
    for (const link of outgoing) {
      const targetPageId = link.targetPageId
      if (targetPageId && pageIdMap.has(targetPageId)) {
        pageIds.add(targetPageId)
        edges.push({
          source: currentPageId,
          target: targetPageId,
          label: link.relationshipType,
          relationshipType: link.relationshipType,
        })
        traverse(targetPageId, currentDepth + 1)
      }
    }
    
    // 处理入链
    for (const link of incoming) {
      const sourcePageId = blockPageMap.get(link.sourceBlockId)
      if (sourcePageId && pageIdMap.has(sourcePageId)) {
        pageIds.add(sourcePageId)
        edges.push({
          source: sourcePageId,
          target: currentPageId,
          label: link.relationshipType,
          relationshipType: link.relationshipType,
        })
        traverse(sourcePageId, currentDepth + 1)
      }
    }
  }
  
  traverse(startPageId, 1)
  return { pageIds, edges }
}

/**
 * 获取关系类型对应的颜色
 */
function getRelationshipColor(relationshipType: string | null): string {
  if (!relationshipType) return '#8c8c8c'
  
  const predefined = PREDEFINED_RELATIONSHIPS.find(r => r.type === relationshipType)
  return predefined?.color || '#8c8c8c'
}

// 初始化图谱
async function initGraph() {
  if (!graphContainer.value) return
  
  const data = await buildGraphData()
  
  // 配置布局
  let layoutConfig: any = {}
  if (graphLayout.value === 'force') {
    layoutConfig = { type: 'force', preventOverlap: true }
  } else if (graphLayout.value === 'dagre') {
    layoutConfig = { type: 'dagre', nodesep: 50, ranksep: 70 }
  } else if (graphLayout.value === 'circular') {
    layoutConfig = { type: 'circular', radius: 100 }
  }
  
  graph = new G6.Graph({
    container: graphContainer.value,
    width: graphContainer.value.clientWidth,
    height: 400,
    layout: layoutConfig,
    defaultNode: { size: 30 },
    defaultEdge: { type: 'cubic-horizontal' },
  })
  
  graph.data(data)
  graph.render()
}

onMounted(() => {
  initGraph()
})

watch([() => pageStore.currentPageId, graphDepth, graphLayout], () => {
  // 重新渲染图谱
  if (graph) graph.destroy()
  initGraph()
})

onBeforeUnmount(() => {
  if (graph) graph.destroy()
})
</script>

<style scoped>
.concept-graph-panel {
  border-top: 2px dashed var(--border);
  background: var(--bg-base);
}

.concept-graph-header {
  padding: var(--space-3) 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
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
  background: var(--bg-base);
  font-size: 12px;
}

.concept-graph-body {
  height: 400px;
}
</style>
```

### 6.4 新增存储方法

需要新增几个查询方法：

```typescript
// storage/indexedDB.ts
async getOutgoingLinks(pageId: string): Promise<LinkRecord[]> {
  // 获取页面所有 Block 的出链
  const blocks = await db.blocks.where('pageId').equals(pageId).toArray()
  const blockIds = blocks.map(b => b.id)
  return db.links.where('sourceBlockId').anyOf(blockIds).toArray()
}

async getPageById(pageId: string): Promise<Page | undefined> {
  const record = await db.pages.get(pageId)
  return record ? recordToPage(record) : undefined
}
```

---

## 7. UI 集成

### 7.1 页面布局变更

修改 `Page/index.vue`，在右侧边栏添加概念图谱：

```vue
<template>
  <div class="page-container">
    <div class="page-body">
      <main class="main-content">
        <!-- ... 现有内容 ... -->
      </main>

      <div class="right-sidebar">
        <Backlinks />
        <ConceptGraph />  <!-- 新增 -->
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-body {
  display: flex;
  gap: var(--space-6);
}

.main-content {
  flex: 1;
  min-width: 0;
}

.right-sidebar {
  width: 300px;
  flex-shrink: 0;
}
</style>
```

### 7.2 编辑器支持

在编辑器中输入 `[[` 后，支持快捷选择关系类型：

```
[[页面名]]^(
           ┌─────────────┐
           │ depends-on  │
           │ parent      │
           │ references  │
           │ related     │
           └─────────────┘
```

---

## 8. 实现阶段划分

### Phase 1: 数据模型 + 语法解析（MVP）

- [ ] 扩展 Link 数据类型
- [ ] 升级数据库 schema
- [ ] 实现新语法解析（`[[page]]^(type)`）
- [ ] 更新存储逻辑（支持关系类型）
- [ ] 反向链接创建和同步机制
- [ ] 实现回车后自动推断反向关系
- [ ] 实现同一页面内多链接同步机制（Vue 响应式）
- [ ] 实现级联删除/修改的例外处理（正在编辑的地方不自动删除）
- [ ] 编写测试

### Phase 2: 概念图谱可视化

- [ ] 安装 AntV/G6
- [ ] 实现 ConceptGraph 组件
- [ ] 新增存储查询方法
- [ ] 集成到页面布局（右侧边栏）
- [ ] 基础样式美化
- [ ] 可配置深度（1-3度）
- [ ] 关系类型着色
- [ ] 布局切换（力导向、层级、环形）

### Phase 3: 编辑器交互增强

- [ ] 实现 `[[页面名]]^depends-on` 渲染格式（不带括号，^ 始终显示）
- [ ] 实现关系类型颜色显示（和概念图颜色一致）
- [ ] 实现点击 `^depends-on` 弹出菜单，点击 `[[页面名]]` 跳转
- [ ] 实现关系类型选择菜单（显示中文标签，用对应颜色，包含「移除关系类型」）
- [ ] 实现菜单交互（ESC 关闭，点击立即应用）
- [ ] 关系类型管理（预定义+自定义，支持颜色配置）
- [ ] 反向关系创建 UI
- [ ] 图谱交互（点击跳转、缩放、拖拽）

### Phase 4: 高级功能

- [ ] 图谱导出（PNG/SVG）
- [ ] 全库图谱视图
- [ ] 自定义关系类型的持久化存储

---

## 9. 向后兼容性

- 现有 `[[页面名]]` 语法完全兼容，`relationshipType` 为 null
- 数据库迁移自动处理旧数据
- 概念图谱组件在无关系类型时仍可展示基础连接

---

## 10. 已确认的关键决策

### 10.1 反向链接策略
- **创建策略**：在目标页面自动创建实际的 Markdown 反向链接，直接创建不提示用户
- **查找策略**：精确匹配完整链接，所有指向同一页面的链接关系类型保持同步
- **插入策略**：最后一个一级 Block（parentId 为 null，非根 Block）
- **空白页面处理**：创建根 Block
- **同步策略**：自动删除/更新，编辑冲突后写入优先

### 10.2 概念图谱配置
- **默认展示深度**：2 度
- **可配置深度**：1-3 度可选
- **关系类型着色**：支持，每种预定义关系类型有对应颜色
- **布局切换**：支持力导向、层级、环形布局切换

### 10.3 自定义关系类型
- **支持用户自定义**：允许用户创建自定义关系类型
- **颜色配置**：用户可自定义关系类型的颜色

### 10.4 语法与渲染格式
- **源文件存储**：`[[页面名]]^(关系类型)`（带括号）
- **渲染显示**：`[[页面名]]^depends-on`（不带括号）
- **^ 符号**：始终显示，作为分隔符

### 10.5 关系类型交互
- **点击区域分离**：点击 `^depends-on` 弹出菜单，点击 `[[页面名]]` 跳转页面
- **菜单内容**：显示中文标签，用对应颜色，包含「移除关系类型」
- **菜单行为**：点击立即应用，ESC 关闭，风格和现有菜单一致
- **移除操作**：只删除关系类型，保留链接

### 10.6 自动推断与同步
- **自动推断**：回车后检查反向关系并自动添加
- **同步范围**：同一页面内所有指向相同页面的链接
- **同步机制**：Vue 响应式系统（computed/watch）
- **例外规则**：正在修改的地方不会自动删除

### 10.7 数据一致性保证
- **核心原则**：同一个页面的多个指向相同页面的链接，关系类型必定一致
- **冲突处理**：视为 bug，确保不会出现这种情况

