# Concept Block 功能规格

&gt; 版本：v1.0
&gt; 日期：2026-06-07
&gt; 状态：✅ 已实现

---

## 概述

Concept Block 是一种标准化的概念深潜工具，帮助用户系统地理解和记录一个概念。通过固定的四区结构（核心定义、边界范围、对标辨析、实例应用），确保每个概念都得到完整且深度的处理。

**核心特点：**
- 每个页面最多一个 Concept Block，固定在页面顶部（标题下方，Blocks 列表上方）
- Concept Block 不作为普通 Block 渲染，而是作为 Page 元数据存储
- 支持折叠/展开，编辑与展示模式切换
- Tab 键在输入字段间导航

---

## 功能规格

### 1. 四区结构

Concept Block 包含四个固定区域，每个区域可独立折叠/展开。

#### 01 · 核心定义
- **色彩编码**：琥珀色标签（#D97706）
- **内容**：一句话抓本质，用自己的话精简复述核心内涵
- **渲染**：引用块样式，带左边框
- **默认状态**：展开

#### 02 · 边界范围
- **色彩编码**：绿色（外延）/ 红色（禁区）
- **内容**：
  - **外延**：包含哪些事物、适用场景
  - **禁区**：哪些不属于该概念、反例
- **渲染**：绿红并排双栏
- **默认状态**：展开

#### 03 · 对标辨析
- **色彩编码**：靛蓝色
- **内容**：与相近、易混淆概念的对比，列明关键差异
- **渲染**：VS 对比卡（左右并排）
- **默认状态**：展开

#### 04 · 实例与应用
- **色彩编码**：紫色
- **内容**：
  - **正向实例**：2～3 个具体示例
  - **落地用法**：现实中什么时候用、解决什么问题
- **渲染**：实例卡片 + 用法卡片
- **默认状态**：展开

---

### 2. 数据模型

#### 存储方式（关键变更！）
Concept Block **不再作为普通 Block 类型存储**，而是作为 **Page 元数据**存储在：

```typescript
// src/types/page.ts
interface Page {
  // ... 原有字段
  format?: {
    concept?: {
      // 概念名称（与页面标题同步）
      name?: string
      // 各区内容
      definition?: string
      boundaryExtension?: string
      boundaryForbidden?: string
      comparisonLeft?: string
      comparisonRight?: string
      exampleInstances?: string
      exampleUsage?: string
      // 各区折叠状态
      collapsed?: {
        definition?: boolean
        boundary?: boolean
        comparison?: boolean
        example?: boolean
      }
    }
  }
}
```

#### 与 Block 树的关系
- Concept Block 不在 BlockList 中渲染
- `buildTree` 函数会过滤掉 type: 'concept' 的 Block（用于向后兼容）
- 通过 `/concept` 命令触发后，直接在 Page 元数据中创建

---

### 3. 交互设计

#### 触发方式
- 通过斜杠命令 `/concept` 触发
- 自动在页面顶部创建 Concept Block
- 自动激活编辑模式

#### 编辑模式
- 所有输入字段支持内联编辑
- **Tab 键导航**：按 Tab 在字段间切换焦点
  - 核心定义 → 外延 → 禁区 → 左侧对比 → 右侧对比 → 实例 → 用法
- **自动保存**：blur 或按 Escape 时自动保存
- **激活时自动聚焦**：激活时自动聚焦第一个空字段

#### 展示模式
- 空字段显示占位符（斜体，灰色）
- 点击任意区域进入编辑模式
- 区域折叠/展开状态在编辑与展示模式间保持同步

---

### 4. 组件结构

| 组件 | 路径 | 说明 |
|------|------|------|
| **PageConceptBlock** | `src/components/Page/PageConceptBlock.vue` | 概念块容器组件 |
| **ConceptRender** | `src/components/Block/handlers/concept/ConceptRender.vue` | 概念块渲染（编辑/展示模式切换） |
| **ConceptSection** | `src/components/Block/handlers/concept/ConceptSection.vue` | 单个区域的折叠/展开组件 |

---

## 技术实现

### 渲染层级

```
Page
  ├── PageHeader (页面标题)
  ├── PageConceptBlock (新概念组件) ← 新增
  │   ├── 概念块四区结构
  │   └── 编辑/展示模式切换
  └── BlockList (原有内容)
```

### 关键变更点

| 模块 | 变更 | 说明 |
|------|------|------|
| `App.vue` | 添加 `.concept-block` 排除 | 点击 Concept Block 不触发块失活 |
| `Page/index.vue` | 添加 PageConceptBlock 组件 | 渲染在标题和 BlockList 之间 |
| `useBlockTree.ts` | 过滤 type: 'concept' | 从 BlockList 中排除概念块 |
| `useSlashCommands.ts` | 简化 `/concept` 命令 | 不再移动 Block 到顶部 |
| `Block/index.vue` | 移除 concept 特殊处理 | 不再需要 bullet 和拖拽的条件判断 |

### 事件处理

#### 防止事件冒泡
在 `App.vue` 的 `handleMainClick` 中添加了对 `.concept-block` 的检测，避免点击概念块时调用 `deactivateBlock`。

在 `ConceptRender.vue` 中使用 `@click.stop` 阻止事件传播。

---

## 占位符文本

| 字段 | 占位符 |
|------|--------|
| 核心定义 | "一句话抓本质..." |
| 外延 | "包含哪些事物..." |
| 禁区 | "哪些不属于该概念..." |
| 左侧对比 | "左侧对比..." |
| 右侧对比 | "右侧对比..." |
| 实例 | "2-3个正向实例..." |
| 用法 | "现实中什么时候用..." |

---

## 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 存储方式 | Page 元数据，非 Block | 避免了 Block 树中概念块的特殊处理和渲染问题 |
| 位置 | 固定顶部，不可拖拽 | 概念块是页面的元信息，不是可排序的内容块 |
| 数量限制 | 每页一个 | 避免重复和混乱 |
| Tab 导航 | 字段间切换 | 提升编辑效率 |
| 折叠同步 | 编辑/展示模式共享状态 | 一致的用户体验 |

---

## 相关文档

- [斜杠命令规格](./slash-commands-spec.md)
- [块编辑器规格](./block-editor-spec.md)
- [数据模型](../2-architecture/data-model.md)
- [设计文档](../superpowers/specs/2026-06-06-concept-block-design.md)

---

*文档基于最新代码实现（2026-06-07）。*
