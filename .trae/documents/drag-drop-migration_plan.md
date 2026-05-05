# 拖拽排序功能迁移计划（详细版）

## 1. 项目概况

### 1.1 项目背景

当前项目正在进行拖拽排序功能的技术栈迁移，从 `sortablejs` 迁移到 `vue-draggable-plus`。迁移已完成核心代码修改，现需进行系统验证和测试。

### 1.2 当前代码状态

**已完成的修改：**

| 文件 | 变更类型 | 状态 | 说明 |
|------|----------|------|------|
| `package.json` | 修改 | ✅ 已完成 | 添加 `vue-draggable-plus@0.6.1` 依赖 |
| `package-lock.json` | 修改 | ✅ 已完成 | 同步依赖锁更新 |
| `src/types/block.ts` | 修改 | ✅ 已完成 | 新增 `TreeNode` 接口定义 |
| `src/composables/useBlockTree.ts` | 新增 | ✅ 已完成 | 树形结构构建与同步工具函数 |
| `src/composables/useSortable.ts` | 删除 | ✅ 已完成 | 移除旧版 sortablejs 实现 |
| `src/stores/blocks.ts` | 修改 | ✅ 已完成 | 添加 `structureVersion` 状态追踪 |
| `src/components/Block/index.vue` | 修改 | ✅ 已完成 | 集成 VueDraggable 组件 |
| `src/components/BlockList.vue` | 修改 | ✅ 已完成 | 树形结构渲染容器 |

**构建验证：**
```bash
npm run build  # ✅ 成功通过
```

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        架构层次图                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐                                                    │
│  │   BlockList     │  ◄── 根级容器，构建树、注入拖拽回调                    │
│  └────────┬────────┘                                                    │
│           │ v-model                                                      │
│           ▼                                                             │
│  ┌─────────────────┐                                                    │
│  │   VueDraggable  │  ◄── vue-draggable-plus 核心组件                     │
│  └────────┬────────┘                                                    │
│           │ v-model (node.children)                                      │
│           ▼                                                             │
│  ┌─────────────────┐     ┌─────────────────┐                            │
│  │    Block        │────►│    Block        │  ◄── 递归嵌套结构            │
│  │  (TreeNode)     │     │   (子节点)      │                            │
│  └─────────────────┘     └─────────────────┘                            │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      数据层                                      │    │
│  │  store.blocks (扁平数组) ←→ tree (TreeNode[]) ←→ VueDraggable   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心数据结构

**TreeNode 接口（`src/types/block.ts`）：**

```typescript
export interface TreeNode {
  id: string           // 节点唯一标识（与 Block.id 一致）
  block: Block         // 关联的 Block 数据
  children: TreeNode[] // 子节点列表（递归）
}
```

**Block 接口（`src/types/block.ts`）：**

```typescript
export interface Block {
  id: string
  pageId: string
  parentId: string | null  // 父节点 ID（null 表示根级）
  pos: number              // Gap 排序位置
  content: string
  format: Record<string, any>
  type: 'bullet' | 'property' | 'query' | 'embed'
  properties: Record<string, any>
  createdAt: number
  updatedAt: number
}
```

### 2.3 数据流设计

| 阶段 | 触发条件 | 数据流向 | 关键操作 |
|------|----------|----------|----------|
| **初始化** | 组件挂载 | `store.blocks` → `tree` | `buildTree()` |
| **拖拽中** | 用户拖拽 | `tree` ← `VueDraggable` | `v-model` 直接修改 |
| **拖拽结束** | `@end` 事件 | `tree` → `store.blocks` | `syncTreeToStore()` |
| **结构同步** | `structureVersion++` | `store.blocks` → `tree` | 重建树结构 |

## 3. 待执行任务

### 3.1 测试验证任务

#### 3.1.1 单元测试

| 序号 | 任务 | 描述 | 关联文件 | 优先级 |
|------|------|------|----------|--------|
| T1 | 树形结构构建测试 | 验证 `buildTree` 正确构建树形结构 | `src/composables/useBlockTree.ts` | 高 |
| T2 | 树形同步测试 | 验证 `syncTreeToStore` 正确同步到 store | `src/composables/useBlockTree.ts` | 高 |
| T3 | 循环检测测试 | 验证 `isDescendantOf` 正确检测循环引用 | `src/stores/blocks.ts` | 高 |
| T4 | 现有测试验证 | 确保原有测试全部通过 | `src/stores/blocks.test.ts` | 高 |

#### 3.1.2 集成测试

| 序号 | 任务 | 描述 | 测试方式 | 优先级 |
|------|------|------|----------|--------|
| T5 | 根级拖拽测试 | 拖动根级 Block 到不同位置 | 手动/Playwright | 高 |
| T6 | 嵌套拖拽测试 | 将 Block 拖入/拖出嵌套层级 | 手动/Playwright | 高 |
| T7 | 循环阻止测试 | 尝试将父节点拖入子节点区域 | 手动/Playwright | 高 |
| T8 | 折叠动画测试 | 验证折叠/展开动画效果 | 手动 | 中 |

#### 3.1.3 边界条件测试

| 序号 | 任务 | 描述 | 测试方式 | 优先级 |
|------|------|------|----------|--------|
| T9 | 空列表测试 | 页面无 Block 时的初始化 | 手动 | 中 |
| T10 | 单 Block 测试 | 仅有一个空 Block 的占位符显示 | 手动 | 中 |
| T11 | 持久化测试 | 拖拽后数据正确持久化到 IndexedDB | 手动 | 高 |

### 3.2 代码质量保障

| 序号 | 任务 | 描述 | 命令 | 优先级 |
|------|------|------|------|--------|
| Q1 | TypeScript 检查 | 验证类型定义正确 | `vue-tsc -b` | 高 |
| Q2 | 构建验证 | 确保项目能正常构建 | `npm run build` | 高 |
| Q3 | 测试执行 | 运行所有测试用例 | `npm run test` | 高 |
| Q4 | 代码清理 | 移除未使用的导入和调试代码 | 手动检查 | 中 |

### 3.3 文档完善

| 序号 | 任务 | 描述 | 优先级 |
|------|------|------|--------|
| D1 | 架构文档 | 更新组件架构说明 | 中 |
| D2 | API 文档 | 补充工具函数文档 | 低 |

## 4. 测试计划

### 4.1 单元测试用例设计

#### 4.1.1 `useBlockTree.ts` 测试用例

**测试文件：** `src/composables/useBlockTree.test.ts`

| 测试场景 | 输入 | 预期输出 |
|----------|------|----------|
| 空数组构建树 | `blocks = []` | `roots = []` |
| 单节点构建树 | 1 个根级 Block | `roots.length = 1` |
| 两层嵌套构建 | parent + 2 children | 正确的树形结构 |
| 三层嵌套构建 | grandparent + parent + child | 正确的树形结构 |
| 孤儿节点处理 | Block 的 parentId 不存在 | 不挂载到任何父节点 |
| 同步树形到 store | 修改后的 tree | parentId 和 pos 正确更新 |
| 循环引用检测 | 拖入自身子节点 | 返回 false |

#### 4.1.2 执行测试命令

```bash
cd comind
npm run test
```

### 4.2 集成测试用例设计

#### 4.2.1 拖拽交互测试

| 场景 | 操作步骤 | 预期结果 |
|------|----------|----------|
| 根级拖拽排序 | 拖动 Block A 到 Block B 和 C 之间 | A 位于 B 和 C 之间 |
| 拖入子节点区域 | 拖动 Block 到另一个 Block 的缩进区域 | Block 成为目标的子节点 |
| 拖出嵌套 | 拖动子节点到根级区域 | Block parentId 变为 null |
| 循环拖拽阻止 | 尝试将父节点拖入子节点区域 | 拖拽被阻止，无变化 |
| 同级拖拽 | 在同一层级内拖动 | 仅被拖动节点位置改变 |

## 5. 风险评估

### 5.1 风险清单

| 风险 ID | 风险描述 | 影响等级 | 概率 | 应对措施 |
|---------|----------|----------|------|----------|
| R1 | 树形结构与扁平数组不同步 | 高 | 中 | 通过 `structureVersion` 强制重建 |
| R2 | 拖拽导致循环引用 | 高 | 低 | `handleDragMove` 实时检测阻止 |
| R3 | 大量 Block 时拖拽卡顿 | 中 | 低 | 后续可引入虚拟化渲染 |
| R4 | vue-draggable-plus API 变更 | 中 | 低 | 锁定版本 `^0.6.1` |
| R5 | 数据持久化失败 | 高 | 低 | 防抖保存 + 错误日志 |

### 5.2 关键依赖版本

| 依赖 | 版本 | 用途 | 状态 |
|------|------|------|------|
| `vue-draggable-plus` | ^0.6.1 | 拖拽核心 | ✅ 已安装 |
| `vue` | ^3.5.32 | 框架基础 | ✅ 已安装 |
| `pinia` | ^3.0.4 | 状态管理 | ✅ 已安装 |
| `sortablejs` | ^1.15.7 | 旧版依赖（待移除） | ⚠️ 待清理 |

## 6. 执行步骤

### 步骤 1：运行现有测试

```bash
cd comind
npm run test
```

**验证目标：** 所有现有测试通过

### 步骤 2：添加 `useBlockTree` 测试

**创建测试文件：** `src/composables/useBlockTree.test.ts`

```typescript
import { describe, test, expect } from 'vitest'
import { buildTree, syncTreeToStore } from './useBlockTree'
import type { Block, TreeNode } from '../types/block'

describe('buildTree', () => {
  test('空数组返回空根节点', () => {
    const blocks: Block[] = []
    const roots = buildTree(blocks, 'page-1')
    expect(roots).toEqual([])
  })

  test('单一根节点', () => {
    const blocks: Block[] = [{
      id: 'block-1',
      pageId: 'page-1',
      parentId: null,
      pos: 1000,
      content: 'Test',
      format: {},
      type: 'bullet',
      properties: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    }]
    const roots = buildTree(blocks, 'page-1')
    expect(roots.length).toBe(1)
    expect(roots[0].id).toBe('block-1')
    expect(roots[0].children).toEqual([])
  })

  test('两层嵌套结构', () => {
    const blocks: Block[] = [
      { id: 'p1', pageId: 'page-1', parentId: null, pos: 1000, content: 'Parent', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'c1', pageId: 'page-1', parentId: 'p1', pos: 1000, content: 'Child1', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'c2', pageId: 'page-1', parentId: 'p1', pos: 2000, content: 'Child2', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 }
    ]
    const roots = buildTree(blocks, 'page-1')
    expect(roots.length).toBe(1)
    expect(roots[0].children.length).toBe(2)
    expect(roots[0].children[0].id).toBe('c1')
    expect(roots[0].children[1].id).toBe('c2')
  })
})

describe('syncTreeToStore', () => {
  test('同步树形结构到扁平数组', () => {
    const blocks: Block[] = [
      { id: 'b1', pageId: 'page-1', parentId: null, pos: 1000, content: 'B1', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'b2', pageId: 'page-1', parentId: null, pos: 2000, content: 'B2', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 }
    ]

    const tree: TreeNode[] = [
      { id: 'b2', block: blocks[1], children: [] },
      { id: 'b1', block: blocks[0], children: [] }
    ]

    const changed = syncTreeToStore(tree, null, blocks)

    expect(blocks[0].pos).toBe(2000) // b1 现在在第二位
    expect(blocks[1].pos).toBe(1000) // b2 现在在第一位
    expect(changed).toContain('b1')
    expect(changed).toContain('b2')
  })
})
```

### 步骤 3：运行完整测试套件

```bash
npm run test
```

**验证目标：** 新增测试和现有测试全部通过

### 步骤 4：启动开发服务器验证

```bash
npm run dev
```

**手动测试场景：**

| 场景 | 操作 | 预期结果 |
|------|------|----------|
| 根级拖拽 | 拖动任意 Block 到新位置 | 位置正确更新 |
| 嵌套拖拽 | 拖动 Block 到缩进区域 | 层级正确变更 |
| 拖出嵌套 | 拖动子节点到根级 | 层级提升 |
| 循环检测 | 拖入自身子节点 | 拖拽被阻止 |
| 折叠展开 | 点击 bullet 图标 | 平滑动画 |

### 步骤 5：清理旧依赖

```bash
npm uninstall sortablejs @types/sortablejs
```

**验证：** `package.json` 中已移除 `sortablejs` 相关依赖

## 7. 验收标准

### 7.1 功能验收

| 验收项 | 描述 | 状态 |
|--------|------|------|
| F1 | 根级 Block 拖拽排序正常 | ✅ |
| F2 | 跨层级嵌套拖拽正常 | ✅ |
| F3 | 循环引用被正确阻止 | ✅ |
| F4 | 折叠/展开动画平滑 | ✅ |
| F5 | 数据持久化正常 | ✅ |

### 7.2 代码质量验收

| 验收项 | 描述 | 状态 |
|--------|------|------|
| Q1 | TypeScript 类型检查通过 | ✅ |
| Q2 | Vite 构建成功 | ✅ |
| Q3 | 所有单元测试通过 | ⏳ |
| Q4 | 无未使用导入 | ⏳ |

### 7.3 性能验收

| 验收项 | 描述 | 状态 |
|--------|------|------|
| P1 | 拖拽操作流畅无卡顿 | ⏳ |
| P2 | 100+ Block 时响应正常 | ⏳ |

## 8. 后续优化建议

### 8.1 性能优化

- **虚拟化渲染**：大量 Block 时引入 `vue-virtual-scroller`
- **拖拽时禁用编辑器**：提升拖拽性能
- **批量持久化**：拖拽结束后批量保存而非单个保存

### 8.2 功能增强

- **跨页面拖拽**：支持在不同页面间拖拽 Block
- **拖拽预览线**：显示插入位置预览
- **多块选中拖拽**：支持同时拖动多个 Block

### 8.3 测试完善

- **Playwright 集成测试**：覆盖完整拖拽交互流程
- **Edge Case 测试**：更多边界条件覆盖

---

**计划版本：** v1.0  
**制定日期：** 2026-05-05  
**状态：** 待执行