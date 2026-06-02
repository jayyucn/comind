# 概念图谱 - 右侧边栏设计

## 概述

为概念图谱功能设计一个可扩展的右侧边栏系统，支持后续添加更多面板。

## 架构

```
App.vue
├── Sidebar (左侧，现有)
├── Page/Index (主要内容区域)
│   ├── Page Header
│   ├── BlockList
│   └── Backlinks (底部，现有)
└── RightSidebar (新增，右侧通用面板)
    ├── RightSidebarTabs (标签切换)
    └── RightSidebarContent
        └── ConceptGraphPanel (概念图谱面板)

SettingsModal (现有，新增配置项)
└── "外观" 部分
    └── 右侧边栏配置
```

## 文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/composables/useRightSidebar.ts` | 新增 | 右侧边栏状态管理 |
| `src/components/RightSidebar/index.vue` | 新增 | 右侧边栏容器 |
| `src/components/RightSidebar/Tabs.vue` | 新增 | 标签切换组件 |
| `src/components/RightSidebar/panels.ts` | 新增 | 面板注册机制 |
| `src/components/ConceptGraph/Panel.vue` | 新增 | 概念图谱面板 |
| `src/components/ConceptGraph/Canvas.vue` | 新增 | G6 图谱渲染 |
| `src/components/ConceptGraph/Controls.vue` | 新增 | 控制面板 |
| `src/components/Settings/SettingsModal.vue` | 修改 | 新增右侧边栏配置项 |
| `src/App.vue` | 修改 | 集成 RightSidebar |

## useRightSidebar 设计

参考 `useTheme.ts` 的模式。

```typescript
export interface RightSidebarSettings {
  defaultPanel: string
  panelOrder: string[]
}

const STORAGE_KEY = 'comind-right-sidebar'

function loadSettings(): RightSidebarSettings {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch { /* fallback */ }
  }
  // 默认值
  return {
    defaultPanel: 'concept-graph',
    panelOrder: ['concept-graph']
  }
}

function saveSettings(settings: RightSidebarSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

// 运行时状态（不持久化）
const visible = ref(false)
const activePanelId = ref<string>(loadSettings().defaultPanel)
const settings = ref<RightSidebarSettings>(loadSettings())

export function useRightSidebar() {
  function setVisible(v: boolean) { visible.value = v }
  function setActivePanel(id: string) { activePanelId.value = id }
  function updateSettings(newSettings: Partial<RightSidebarSettings>) {
    settings.value = { ...settings.value, ...newSettings }
    saveSettings(settings.value)
  }

  return {
    visible: computed(() => visible.value),
    activePanelId: computed(() => activePanelId.value),
    settings: computed(() => settings.value),
    setVisible,
    setActivePanel,
    updateSettings
  }
}
```

## 面板注册机制

```typescript
// src/components/RightSidebar/panels.ts
import type { Component } from 'vue'

export interface RightSidebarPanel {
  id: string
  label: string
  icon: string
  component: Component
}

import ConceptGraphPanel from '../ConceptGraph/Panel.vue'

export const registeredPanels: RightSidebarPanel[] = [
  {
    id: 'concept-graph',
    label: '概念图谱',
    icon: '🧠',
    component: ConceptGraphPanel
  }
  // 未来扩展：{ id: 'analytics', ... }
]
```

## 概念图谱数据结构

### G6 节点数据
```typescript
interface GraphNode {
  id: string              // pageId
  label: string           // 页面标题
  isCurrent: boolean      // 是否当前页面
  level: number           // 层级深度
  x?: number
  y?: number
}
```

### G6 边数据
```typescript
interface GraphEdge {
  id: string
  source: string          // source pageId
  target: string          // target pageId
  relationshipType: string
  label?: string          // 关系标签（可选）
  color: string           // 基于关系类型的颜色
}
```

### 图谱配置
```typescript
interface GraphConfig {
  maxDepth: number        // 最大深度（默认 2）
  layout: 'force' | 'radial' | 'dagre'  // 布局类型
  showEdgeLabels: boolean // 是否显示边标签
}
```

## 关系类型颜色映射

```typescript
export const RELATIONSHIP_COLORS: Record<string, string> = {
  parent: '#1890ff',    // 蓝色 - 父级
  child: '#fa8c16',     // 橙色 - 子级
  related: '#8c8c8c',   // 灰色 - 相关
}
```

## 概念图谱功能模块

### 第一阶段（MVP）
- 基础 G6 集成
- 力导向布局
- 圆角矩形节点
- 彩色边（按关系类型）
- 点击节点跳转页面
- 当前页面高亮

### 第二阶段（增强）
- 缩放/平移控制
- 视图重置按钮
- 深度调整（1-3 层）
- 布局切换（力导向/径向/DAGRE）

### 第三阶段（完善）
- 节点搜索/高亮
- 导出图谱
- 更多自定义选项

## 设置界面新增项

在 `SettingsModal.vue` 的 "外观" 部分新增：
- 默认面板选择
- 面板顺序拖拽排序
