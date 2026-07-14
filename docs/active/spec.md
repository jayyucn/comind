# comind 项目规范

> 版本：v1.0
> 日期：2026-05-21
> 状态：活跃
> 来源：合并自 `1-overview/SPEC.md` + `1-overview/TODO.md`

---

## 1. 项目概述

comind 是一个**个人大纲编辑工具**。

**目标用户：** 个人用户、知识工作者、需要大纲思考的人
**核心体验：** 像 Logseq 一样快速编辑大纲
**阶段划分：**

| 阶段     | 目标             | 技术栈                  |
| ------ | -------------- | -------------------- |
| Phase 1 | MVP，验证大纲编辑体验  | Vue 3 + tiptap + IndexedDB（纯 Web） |
| Phase 2 | Core 层抽离，文件系统支持 | 抽象存储接口，Markdown 文件读写  |
| Phase 3 | Tauri 套壳，原生应用  | Tauri + SQLite        |

**核心验收标准：**
1. 大纲编辑体验接近 Logseq（缩进/展开/拖拽/折叠）
2. 双向链接跳转流畅
3. 数据本地存储，刷新不丢失
4. 100+ Block 操作流畅

---

## 2. 产品定位

| 维度     | 说明                                      |
| ------ | --------------------------------------- |
| 核心价值   | 快速记录想法、大纲式整理思路、大纲式阅读                |
| 对标产品   | Logseq（大纲体验）、幕布（大纲结构）、Obsidian（双向链接） |
| 差异化    | 更轻量（个人工具）、纯本地（隐私）、大纲优先（非文档优先）    |
| 不做的事   | 协作编辑、云端同步、任务管理、笔记分享                  |

---

## 3. 核心概念

### 3.1 Block（唯一数据单元）

```
Block = {
  id: string              // UUID v4
  content: string         // 纯文本（不含格式标记）
  parentId: string | null // 父 Block，null = 顶级
  pos: number             // 排序位置（Gap 排序，初始间隔 1000）
  pageId: string          // 所属 Page ID
  properties: Record      // 属性对象
  folded: boolean         // 折叠状态
  type: string            // 'bullet' | 'property' | 'query'
  createdAt: string
  updatedAt: string
}
```

### 3.2 Page = Block 的特殊形态

- 每个 Page 有且仅有 1 个根 Block（`parentId = null`）
- Page 本质是 Block 树的根节点
- Page 有额外元数据（title, type, icon, cover, aliases）

### 3.3 Link（双向链接）

- 内部链接：`[[页面名]]` → 指向另一个 Page
- 外部链接：`https://...` → 指向外部资源
- 反向链接（Backlinks）：自动收集指向当前 Page 的所有链接

### 3.4 Property（属性）

- 语法：`key:: value`
- 存储：`Block.properties` 对象
- 支持类型：string, number, boolean, date, list, page reference

---

## 4. 功能规格

### 4.1 编辑器功能

- [x] Block 创建/编辑/删除
- [x] Block 嵌套（Tab/Shift+Tab）
- [x] Block 拖拽排序
- [x] Block 折叠/展开
- [x] Enter 拆分 Block（基于光标位置分流）
- [x] Backspace 合并 Block
- [x] 单编辑器架构（任何时刻只有 1 个 tiptap 实例）

### 4.2 链接功能

- [x] `[[WikiLink]]` 语法
- [x] 自动解析并写入 Link 表
- [x] 反向链接显示
- [x] 悬空链接处理
- [x] 外部链接支持

### 4.3 标签功能

- [x] `#标签` 解析
- [x] 标签高亮显示
- [ ] 标签筛选（Phase 2）

### 4.4 属性功能

- [x] `key:: value` 语法
- [ ] Property 行 UI 渲染
- [ ] Property 编辑器
- [ ] Property 筛选/查询

### 4.5 侧边栏

- [x] 页面列表
- [x] 点滴列表
- [x] 页面搜索
- [x] 页面跳转

### 4.6 数据存储

- [x] IndexedDB 存储
- [x] Dexie.js 封装
- [ ] Markdown 文件导出（Phase 2）
- [ ] SQLite 存储（Phase 3）

---

## 5. 技术栈

| 维度     | 选择                       |
| ------ | ------------------------ |
| 前端框架   | Vue 3 + TypeScript       |
| 状态管理   | Pinia                    |
| 构建工具   | Vite                     |
| 编辑器内核  | tiptap (ProseMirror)     |
| 本地存储   | IndexedDB (Dexie.js)     |
| 拖拽库    | Sortable.js              |
| 测试     | Vitest + Playwright      |

---

## 6. 架构约束

### 6.1 单编辑器原则

任何时刻只能存在 1 个活跃的 tiptap 编辑器实例，编辑器随 Block 切换而销毁或复用。

### 6.2 Block 是唯一数据单元

所有数据围绕 Block 构建，禁止引入"文档级编辑模型"。

### 6.3 状态驱动

所有行为通过状态机控制（`activeBlockId`、Block 树结构），禁止直接 DOM 操作控制业务逻辑。

### 6.4 分层架构

```
UI 层 (Vue Components)
    ↓
状态层 (Pinia Stores)
    ↓
存储层 (StorageAdapter → IndexedDB/SQLite)
```

---

## 7. TODO（未完成项）

### 7.1 编辑器

- [ ] Property 行编辑体验（`key:: value` 格式）
- [ ] 富文本支持（加粗、斜体、代码等）
- [ ] 撤销/重做（Ctrl+Z）
- [ ] Block 多选 + 批量操作
- [ ] 块级引用（Block Reference）

### 7.2 链接

- [ ] 链接预览（hover 显示目标 Page 摘要）
- [ ] Graph 视图（可视化 Page 关系图）
- [ ] 链接筛选（按类型/标签）

### 7.3 属性

- [ ] Property 可视化编辑器
- [ ] Property 筛选/查询面板
- [ ] 自定义属性类型

### 7.4 存储

- [ ] Markdown 文件导入/导出
- [ ] SQLite 存储层（Phase 3）
- [ ] 数据备份/恢复

### 7.5 性能

- [ ] 虚拟列表（500+ Block 场景）
- [ ] 懒加载（按需加载子树）
- [ ] 增量保存

### 7.6 其他

- [ ] 全文搜索
- [ ] 主题切换（暗色模式）
- [ ] 键盘快捷键自定义
- [ ] 插件系统（远期）

---

## 8. 验收标准

| 功能       | 验收标准                                  |
| -------- | --------------------------------------- |
| Block 创建 | 输入文字自动创建 Block，Enter 创建新 Block          |
| Block 嵌套 | Tab 缩进，Shift+Tab 取消缩进，支持多级嵌套           |
| Block 折叠 | 有子 Block 时可折叠/展开，折叠状态持久化               |
| Block 拖拽 | 拖拽调整顺序和层级，视觉反馈清晰，循环嵌套检测有效            |
| 双向链接    | `[[页面名]]` 创建链接，点击跳转，反向链接显示            |
| 标签       | `#标签` 解析并高亮                           |
| 本地存储    | 刷新页面数据不丢失，IndexedDB 正常读写               |
| 性能       | 100+ Block 操作流畅，无明显卡顿                  |

---

*本文档由 `SPEC.md` 和 `TODO.md` 合并生成，版本 v1.0*
