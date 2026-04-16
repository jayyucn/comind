# Block 编辑器项目规范

> 版本：v0.1
> 日期：2026-04-16
> 状态：已确认

***

## 1. 项目定位

本项目是一个类 Logseq 的 **Block（块）结构笔记与编辑系统**，核心运行在 Web 端，强调：

- Block 级编辑（不是 Markdown 文档编辑）
- Outliner 层级结构
- Journal（日记流）
- Page + \[\[引用]]
- 高性能（1000+ blocks 流畅）
- 单编辑器架构（TipTap）

***

## 2. 总体设计原则

### 2.1 单一编辑器原则（最重要）

系统中任何时刻：

- ❗只能存在 1 个 TipTap 编辑器实例
- ❗禁止多个 block 同时进入编辑状态

***

### 2.2 Block 是唯一数据单元

系统所有数据围绕 Block：

- 编辑
- 层级结构
- 存储
- 页面组成

禁止"文档级编辑模型"。

***

### 2.3 编辑 / 展示分离

每个 Block 只有两种状态：

- Display（展示态）：纯 HTML 渲染
- Edit（编辑态）：TipTap 实例

***

### 2.4 状态驱动，而非 DOM 驱动

所有行为必须通过状态机控制：

- activeBlockId
- cursor 状态
- block 树结构

禁止直接 DOM 操作控制业务逻辑。

***

## 3. 核心约束（必须严格遵守）

### 3.1 编辑器约束

- ❗任何时刻只能有 1 个 active editor
- ❗编辑器必须随 block 切换而销毁或复用
- ❗禁止多个 TipTap 同时存在

***

### 3.2 数据约束

- Block 是唯一数据来源（Single Source of Truth）
- UI 状态不得反向污染数据结构
- Pinia 为运行态状态中心
- IndexedDB 为持久化层

***

### 3.3 性能约束

- 必须使用虚拟列表（virtual list）
- Block 组件必须 memo 化
- 编辑器仅在 active block 上挂载

***

## 4. 核心数据模型

> 详细定义见 `data-model.md`

### Block

```ts
type Block = {
  id: string              // UUID v4
  content: string         // Block 原始文本内容
  parentId: string | null // 父 Block ID，null = 顶级
  pageId: string          // 所属 Page ID
  left: number            // 同级排序位置（初始间隔 100）
  createdAt: string       // ISO 8601 时间戳
  updatedAt: string       // ISO 8601 时间戳
  isPage: boolean         // 是否为 Page Block
  title?: string          // 页面标题（仅 isPage=true 时）
  properties?: Record<string, any>  // 属性对象
}
```

### Page

```ts
type Page = Block & {
  isPage: true
  title: string
}
```

**说明：** Page 本质上是 `isPage=true` 的 Block，详细字段定义见 `data-model.md` §3.1。

### 编辑器状态

```ts
type EditorState = {
  activeBlockId: string | null
  cursorOffset: number | null
}
```

***

## 5. 编辑行为规范（核心逻辑）

### 5.1 进入编辑（Activate）

触发条件：

- 点击 Block
- 键盘上下键导航

行为：

1. 设置 activeBlockId
2. 挂载 TipTap editor
3. 设置内容为 block.content
4. 设置光标位置

***

### 5.2 退出编辑（Deactivate）

触发条件：

- blur
- ESC
- 切换 block

行为：

1. 保存内容到 block
2. 销毁 editor 实例
3. activeBlockId = null

***

### 5.3 单编辑器规则

任何切换行为必须满足：

- 先保存当前 block
- 再销毁 editor
- 最后进入新 block

***

## 6. Block 操作规则（Outliner）

### 6.1 Enter（拆分 Block）

行为：

- 当前 block 按光标位置拆分
- 后半部分生成新 block
- 新 block 作为兄弟节点
- 光标移动到新 block

***

### 6.2 Backspace（合并 Block）

条件：

- 光标位于 block 开头

行为：

- 与上一个 block 合并
- 删除当前 block
- 光标移动到上一个 block 末尾

***

### 6.3 Tab（缩进）

行为：

- 当前 block 变为前一个 block 的子节点
- 更新 parentId 和 children

***

### 6.4 Shift + Tab（反缩进）

行为：

- 当前 block 提升层级
- 移出父节点，成为同级

***

## 7. 渲染规则

### 7.1 Block 渲染策略

```
如果 block.id === activeBlockId：
  渲染 TipTap Editor
否则：
  渲染静态 HTML
```

### 7.2 编辑器生命周期

- mount：创建 TipTap
- update：同步 Pinia
- unmount：销毁实例

### 7.3 虚拟列表

必须启用：

- 只渲染可见 block
- 限制 DOM 数量

***

## 8. 数据流规范

### 输入流

```
用户输入 → TipTap → Pinia → debounce → IndexedDB
```

### 输出流

```
IndexedDB → Pinia → Vue 渲染 → 虚拟列表展示
```

***

## 9. 性能规则

必须满足：

- 1000+ blocks 流畅滚动
- editor 切换无明显延迟
- 输入延迟 < 16ms
- 无重复 editor 实例

***

## 10. 禁止事项（非常重要）

### ❌ 禁止：

- 多 editor 并存
- 复杂 Markdown 实时解析
- graph 可视化（当前阶段）
- plugin 系统
- 全文搜索引擎
- UI 驱动数据结构变化

***

## 11. MVP 执行范围

### 必须实现：

- Block 编辑
- Enter / Backspace
- Tab / Shift+Tab
- Journal（日记页）
- Page 基础系统
- \[\[引用]]（简单解析）

### 暂不实现：

- Graph
- 协同编辑
- 插件系统
- 富文本复杂扩展
- editor pool 优化

***

## 12. 开发优先级

必须按顺序执行：

1. Block 渲染系统
2. 单 TipTap 编辑器
3. Enter / Backspace
4. Tab / Shift+Tab
5. 数据持久化
6. 虚拟列表优化

***

## 13. 成功标准

系统必须满足：

- 长时间使用不崩溃
- 1000+ blocks 流畅
- 编辑切换无卡顿
- 数据不丢失
- 单 editor 稳定运行

***

## 14. 核心原则总结

> 系统成功的关键不是功能数量，而是：
>
> **单编辑器 + 状态机 + Block 结构 + 性能约束**

***

