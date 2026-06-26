# comind SPEC.md — 项目总规范

> 版本：v0.4
> 日期：2026-06-26
> 状态：Phase 2 规划已确认

***

## 1. 一句话定义

**comind** 是一个以 **Block（块）** 为核心的本地优先（local-first）大纲编辑系统，用于结构化思考，而非传统笔记工具。

> comind 的目标不是帮助你写得更多，而是帮助你想得更清晰。

***

## 2. 核心定位

### 2.1 不是什么

- ❌ 不是 Markdown 编辑器
- ❌ 不是 Word / 富文本文档编辑器
- ❌ 不是 Notion / Obsidian 那样的功能聚合产品
- ❌ 不是"第二大脑"（至少不是 Phase 1 的目标）

### 2.2 是什么

- ✅ 基于 Block 的 Outliner（大纲编辑器）
- ✅ 强调层级结构（嵌套、折叠、拖拽排序）
- ✅ Page = 顶级 Block，双向链接是一等公民
- ✅ 本地优先，数据可读、可迁移
- ✅ 单编辑器架构，编辑体验优先

### 2.3 核心价值

> 让**思考本身**成为一等公民。

系统不强迫用户组织内容，而是对混乱思维提供**最低结构约束**——一个 Block。

***

## 3. 核心概念

### 3.1 Block — 唯一数据单元

系统所有数据围绕 Block 构建：

| 概念      | 说明                                            |
| ------- | --------------------------------------------- |
| Block   | 最小编辑单位，一段文字 + 可选子 Block                       |
| Page    | 顶级 Block（parentId = NULL，isPage = true）       |
| Bullet  | 普通 Block（parentId ≠ NULL，或顶级但 isPage = false） |
| Content | Block 的文本内容，`[[双链]]` 和 `#Page名`（Page 链接）从中解析             |

> **核心原则：** 所有能力必须围绕 Block 构建，禁止引入"文档级模型"。

### 3.2 Link — 双向链接

| 概念           | 说明                                  |
| ------------ | ----------------------------------- |
| `[[页面名]]`    | 创建指向 Page 的内部链接                     |
| `[[目标\|别名]]` | 链接带显示别名                             |
| 反向链接         | 系统自动维护，记录哪些 Block 引用了当前 Page        |
| linkType     | `internal`（双链）vs `external`（外部 URL） |

### 3.3 Tag — 标签

| 概念     | 说明                                    |
| ------ | ------------------------------------- |
| `#标签名` | 从 Block.content 中解析，Phase 1 不单独存储表    |
| 层级标签   | `#工作/项目A`（斜杠表示层级）                     |
| 排除规则   | URL 中的锚点（`https://...#section`）、邮箱不识别 |

> **Phase 1 标签处理：** 解析并高亮显示，暂不实现点击筛选功能（推迟至 Phase 1.1）。

### 3.4 Property — 属性

| 概念            | 说明                                             |
| ------------- | ---------------------------------------------- |
| `key:: value` | Block 的元数据，存储在 Block.properties（JSON）          |
| 页面级属性         | `title`、`alias`、`tags`、`icon`、`type`           |
| Block 级属性     | `collapsed`（折叠状态）                              |
| 类型推断          | string / number / date / boolean / list / page |

### 3.5 排序机制 — Gap Sort

| 概念     | 说明                              |
| ------ | ------------------------------- |
| 排序字段   | `left`，整数类型                     |
| 初始间隔   | gap = 100（100, 200, 300, ...）   |
| 中间插入   | 取左右邻居的平均值（如 100 和 200 之间插入 150） |
| Gap 用尽 | 当差值 < 2 时，对该父级的所有子节点局部重排        |

***

## 4. Phase 1 — MVP 目标

### 4.1 核心目标

> **验证大纲编辑体验**

用 Web 技术快速原型，验证 Block 嵌套、折叠、拖拽是否顺手，验证双向链接跳转是否流畅。

### 4.2 技术栈

| 维度    | 选择                           |
| ----- | ---------------------------- |
| 前端框架  | Vue 3 + TypeScript + 组合式 API |
| 状态管理  | Pinia                        |
| 构建工具  | Vite                         |
| 编辑器内核 | tiptap（ProseMirror）          |
| 本地存储  | IndexedDB（via Dexie.js）      |
| 路由    | Vue Router                   |

详细选型依据见 `tech-selection.md`。

### 4.3 Phase 1 功能范围

#### 必须实现（MVP）

| 功能            | 说明                             |
| ------------- | ------------------------------ |
| Block 创建      | 输入文字自动创建 Block                 |
| Enter 拆分      | 在 Block 内按光标位置拆分               |
| Backspace 合并  | 与上一个 Block 合并                  |
| Tab 缩进        | 当前 Block 成为前一个 Block 的子节点      |
| Shift+Tab 反缩进 | 当前 Block 提升层级                  |
| Block 折叠/展开   | 有子 Block 时可折叠，折叠状态持久化          |
| Block 拖拽排序    | 调整顺序和层级，视觉反馈清晰                 |
| Page 系统       | 顶级 Block = Page，支持创建和编辑页面标题    |
| 双向链接          | `[[页面名]]` 创建链接，点击跳转            |
| 链接解析          | **保存时解析** `[[...]]`，渲染时显示可点击链接 |
| 标签解析          | `#标签` 高亮显示（Phase 1 不实现点击筛选）    |
| 反向链接显示        | Page 底部面板展示当前页面的所有引用来源         |
| 本地持久化         | IndexedDB 存储，刷新页面数据不丢失         |
| 性能基线          | 100+ Block 操作流畅，无明显卡顿          |

#### Phase 1.1（已完成 ✅ / 部分完成

> **2026-05-12 更新：** 以下功能实现情况。

| 功能 | 状态 | 说明 |
|------|------|------|
| 属性解析 `key:: value` | ⚠️ 部分完成 | parser.ts 已实现，保存时未调用 |
| 属性类型推断 | ⚠️ 部分完成 | parsePropertyValue 已实现，保存时未整合 |
| 属性 UI 渲染 | ❌ 未完成 | Block 组件中未实现 |
| 标签点击筛选 | ✅ 已实现 | TagFilterPanel 组件，点击标签 → 筛选所有含该标签的 Block |
| 命令面板（斜杠命令） | ✅ 已实现 | `/` 触发 SlashCommandMenu，支持创建页面、切换页面等命令 |
| Journal（日记流） | ✅ 已实现 | 自动创建每日日记 Page，JournalList 日记列表视图 |
| 外部链接编辑态高亮 | ✅ 已实现 | `[[https://...]]` 编辑态可点击，安全打开外部链接 |

#### 暂不实现

| 功能             | 原因             |
| -------------- | -------------- |
| 富文本（加粗、斜体、颜色等） | Phase 1 聚焦大纲体验 |
| Graph 可视化      | Phase 3/4 考虑     |
| 多设备同步          | 远期规划           |
| 协同编辑           | 远期规划           |
| 图片/附件          | Phase 2 考虑     |
| Tauri 桌面壳      | Phase 3 引入     |
| SQLite 存储      | Phase 3 引入     |

> **Phase 2 规划功能：** 全文搜索（Lunr.js + 中文分词）、Core 层抽离、StorageAdapter 接口

### 4.4 Phase 1 验收标准

| 功能       | 验收标准                            |
| -------- | ------------------------------- |
| Block 创建 | 输入文字自动创建 Block，Enter 创建新 Block  |
| Block 嵌套 | Tab 缩进，Shift+Tab 取消缩进，支持多级嵌套    |
| Block 折叠 | 有子 Block 时可折叠/展开，折叠状态持久化        |
| Block 拖拽 | 拖拽调整顺序和层级，视觉反馈清晰                |
| 双向链接     | `[[页面名]]` 创建链接，点击跳转             |
| 反向链接     | Page 底部面板显示所有引用来源，点击跳转至来源 Block |
| 标签       | `#标签` 解析并高亮显示                   |
| 本地存储     | 刷新页面数据不丢失，IndexedDB 正常读写        |
| 性能       | 100+ Block 操作流畅，无明显卡顿           |

***

## 5. Phase 2 & Phase 3 预览

### Phase 2：Core 层抽离

| 变化                | 说明                                                |
| ----------------- | ------------------------------------------------- |
| Core 独立           | Block/Link/Tag 逻辑抽离为框架无关的 Core Layer              |
| Storage Interface | 抽象 `StorageAdapter` 接口，支持 IndexedDB → SQLite 平滑迁移 |
| 全文搜索              | 引入搜索能力                                            |
| 测试覆盖              | Core 层单元测试覆盖                                      |

### Phase 3：Tauri 套壳

| 变化   | 说明                            |
| ---- | ----------------------------- |
| 桌面化  | Tauri（Rust）桌面应用               |
| 存储   | IndexedDB → SQLite (rusqlite) |
| 文件系统 | 引入 Markdown 文件读写              |
| 性能   | 原生性能，支持更大数据量                  |

***

## 6. 用户旅程

### 6.1 典型使用场景

**场景：记录"数据模型设计"这个项目**

```
1. 创建 Page
   → 输入 "数据模型设计" → 生成顶级 Block（isPage = true）

2. 添加 Block
   → 输入 "概述" → 子 Block
   → 输入 "Block 是唯一基础单元" → 孙 Block

3. 添加 Property
   → 输入 "状态:: 进行中" → properties 存储 { "状态": "进行中" }

4. 创建链接
   → 输入 "参考 [[存储规范]]" → 保存时解析为内部链接

5. 创建标签
   → 输入 "#笔记工具" → Block.content 中解析出标签（高亮显示）

6. 折叠/展开
   → 点击 "概述" 前面的折叠图标 → 子 Block 隐藏/显示

7. 拖拽排序
   → 拖动 "Block 是唯一基础单元" → 调整到另一个位置

8. 查看反向链接
   → 打开 [[存储规范]] 页面 → 底部面板显示 "数据模型设计 引用了你"
```

### 6.2 键盘快捷键

| 快捷键               | 行为                                       |
| ----------------- | ---------------------------------------- |
| `Enter`（Block 中间） | 按光标位置拆分，当前 Block 内容截断，后续生成新 Block        |
| `Enter`（Block 末尾） | 拆分为空 Block，光标移至新 Block                   |
| `Backspace`       | 光标在 Block 开头时 → 与上一个 Block 合并，删除当前 Block |
| `Tab`             | 缩进 → 当前 Block 成为前一个 Block 的子节点           |
| `Shift + Tab`     | 反缩进 → 当前 Block 提升一个层级，成为前一个 Block 的兄弟    |
| `↑ / ↓`           | 在 Block 之间导航（不进入编辑状态）                    |
| `ESC`             | 退出编辑状态，Block 回到展示态                       |

> Phase 1 暂不绑定全局快捷键，所有行为在 Block 编辑上下文中触发。

***

## 7. 单编辑器原则

> 这是 comind 最重要的架构约束。

### 7.1 核心规则

- ❗ 任何时刻，系统只能存在 **1 个活跃的 tiptap 编辑器实例**
- ❗ 任何时刻，只有 **1 个 Block 处于编辑状态**
- ❗ 编辑器必须随 Block 切换而销毁或复用

### 7.2 编辑器状态

| 状态           | 说明               |
| ------------ | ---------------- |
| Display（展示态） | 纯 HTML 渲染，无编辑器实例 |
| Edit（编辑态）    | tiptap 实例挂载，光标可见 |

### 7.3 切换规则

```
切换 Block 时：
  1. 保存当前 block.content
  2. 销毁当前 editor 实例
  3. activeBlockId = 新 block.id
  4. 挂载新 editor 实例
```

***

## 8. 数据流

```
用户输入 → tiptap → Pinia（运行态） → debounce → IndexedDB（持久化）

IndexedDB → Pinia → Vue 响应式渲染 → Block 组件展示
```

### 8.1 状态层次

| 层次        | 作用                                 |
| --------- | ---------------------------------- |
| Pinia     | 运行态状态（activeBlockId、Block 树、UI 状态） |
| IndexedDB | 持久化存储（Block、Page、Link）             |
| tiptap    | 单编辑器实例（文本编辑）                       |

### 8.2 链接解析时机

**Phase 1 方案：保存时解析 + 编辑时临时高亮**

```
用户输入 [[页面名]]
    │
    ▼
tiptap Mark 层（纯 UI）
  → 输入时检测 [[...]] 语法，添加临时高亮样式
  → 无数据库操作，不写 Link 表
    │
    │ 保存时（blur / Ctrl+S / 自动保存）
    ▼
Parser.parseBlockContent(content)
  → 提取所有 [[...]] 匹配
  → 分类：内部链接 / 外部链接
  → 查表：匹配 targetPageId（未找到 → 悬空链接）
    │
    ▼
Link 表操作（事务）
  → 删除 sourceBlockId 的旧 Link
  → 插入新 Link 记录
    │
    ▼
渲染时 → 从 IndexedDB 读取 Link 表 → 渲染可点击链接
```

**说明（来源 `link-spec.md` §3.1）：**
- 编辑态：tiptap Mark 层实时检测语法并临时高亮，用户可感知但无持久化
- 保存时：完整解析，持久化到 Link 表
- 渲染时（展示态）：读取 Link 表，渲染可点击链接

***

## 9. 性能约束

| 约束    | 目标                     |
| ----- | ---------------------- |
| 操作流畅度 | 1000+ Block 流畅滚动       |
| 编辑延迟  | < 16ms（接近即时）           |
| 编辑器切换 | 无明显卡顿                  |
| 渲染策略  | Block 组件 memo 化，避免重复渲染 |

> **虚拟列表：** Phase 1 暂不引入。100 个 Block 约 100 个 DOM 节点，浏览器性能完全可承受。待数据量增长至 500+ 出现性能瓶颈时再按需引入。

***

## 10. 文档体系

本文档是 comind 的总规范，各专项文档位于 `docs/` 目录：

### 目录结构

| 目录 | 内容 |
| --- | --- |
| `docs/1-overview/` | 项目概览 - SPEC、tech-selection、TODO |
| `docs/2-architecture/` | 架构设计 - data-model、routing-design、storage-spec |
| `docs/3-features/` | 功能规格 - block-editor、link、tag、slash-commands |
| `docs/4-ui/` | UI/UX 设计 - ui-ux-spec、interaction-spec |
| `docs/5-development/` | 开发指南 - dev-guide、page-block-crud |
| `docs/6-reports/` | 验证报告 - 项目评估、功能验证报告 |
| `docs/7-sidebar/` | 侧边栏 - sidebar-implementation、sidebar-redesign |
| `docs/sort/` | 排序功能 - sortable-implementation、phase-1-1-plan |
| `docs/superpowers/` | 能力增强 - 特性设计与实现计划 |

### 核心文档

| 文档 | 描述 |
| --- | --- |
| [SPEC.md](docs/1-overview/SPEC.md) | 项目总规范 |
| [data-model.md](docs/2-architecture/data-model.md) | 核心数据模型（Block、Link、Tag、Property） |
| [dev-guide.md](docs/5-development/dev-guide.md) | 开发指南 |
| [link-spec.md](docs/3-features/link-spec.md) | 双向链接系统详细规范 |
| [storage-spec.md](docs/2-architecture/storage-spec.md) | 存储层规范 |
| [tech-selection.md](docs/1-overview/tech-selection.md) | 技术选型说明 |
| [ui-ux-spec.md](docs/4-ui/ui-ux-spec.md) | UI/UX 视觉系统规范 |
| [interaction-spec.md](docs/4-ui/interaction-spec.md) | 交互规格 |

***

## 11. 已确认事项

以下事项已在本轮评审中确认：

| 事项           | 结论                        |
| ------------ | ------------------------- |
| 链接解析时机       | Phase 1 采用"保存时解析"方案       |
| 反向链接         | 纳入 Phase 1，显示在 Page 底部面板  |
| 标签点击筛选       | ✅ Phase 1.1 已实现           |
| Journal（日记流） | ✅ Phase 1.1 已实现           |
| 虚拟列表         | Phase 1 跳过，按需引入           |
| 产品定位         | "而非传统笔记工具"                |
| 外部链接安全       | ✅ 使用 `noopener,noreferrer`  |
| 单编辑器架构       | ✅ 已实现                    |

***

## 12. 后续阶段规划

| 阶段 | 目标 | 说明 |
| --- | --- | --- |
| **Phase 2** | 创建 Block 领域服务 | 将 `blocks.ts` 的树遍历/位置计算下沉到领域服务 |
| **Phase 3** | 组件拆分 | 将 `Block/index.vue` 拖拽逻辑抽为独立模块 |

### 待定事项

以下决策暂未确定，将在后续阶段补充：

| 事项           | 说明                                      |
| ------------ | --------------------------------------- |
| tiptap 自定义节点 | BlockNode / PageNode / LinkMark 的具体实现方案 |
| 折叠状态存储       | 存在 Block.properties 中 vs 单独状态字段         |
| 外部存储         | Block.content 是否支持大文本外部存储               |
| 版本历史         | 是否支持 Block 级别的历史版本回溯                    |
| Graph 可视化    | Phase 2/3 考虑                            |

***

## 13. 质量状态（2026-05-12）

### 测试覆盖

| 测试类型 | 状态 | 详情 |
| --- | --- | --- |
| 单元测试 | ✅ 66/66 通过 | Vitest + 覆盖 blocks、parser、blockTree |
| E2E 测试 | ✅ 10/10 通过 | Playwright 路由测试 |
| 安全审计 | ✅ 0 漏洞 | npm audit |

### 代码质量

| 指标 | 状态 |
| --- | --- |
| TypeScript 构建 | ✅ 通过 |
| ESLint | ✅ 已配置 |
| 测试覆盖率 | ✅ 可用 |

***

*文档 v0.4 Phase 2 规划已确认。*
