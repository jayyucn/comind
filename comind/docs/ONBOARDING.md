# Comind 开发者入门指南

> 基于项目知识图谱自动生成 | 分析时间: 2026-05-28

---

## 项目概览

**Comind** 是一个基于 Vue 3 的本地优先的块编辑器和知识管理应用。

| 属性 | 值 |
|------|-----|
| 语言 | TypeScript, Vue, SCSS, Rust (后端) |
| 前端框架 | Vue 3, TipTap (编辑器), Pinia (状态管理) |
| 后端框架 | Tauri (Rust), WebAssembly |
| 数据存储 | SQLite (Tauri), IndexedDB/Dexie (Web) |
| 构建工具 | Vite, wasm-pack, Cargo |
| 测试框架 | Vitest, Playwright |
| 目标平台 | 桌面 (Windows/macOS/Linux), Android, Web |

### 核心特性

- **块编辑器**: 基于 TipTap 的块级编辑系统，支持拖拽排序、缩进、多级嵌套
- **知识图谱**: 基于 AntV G6 的概念关系图谱可视化
- **本地优先**: 所有数据本地存储，支持离线使用
- **跨平台**: Tauri 桌面应用 + Android 移动端 + Web 版
- **日期引用**: 支持在块中插入日期引用（`@date`），带提醒和重复规则
- **关系管理**: 块之间的关系链接（引用、关系类型），可在图谱中可视化
- **双向链接**: WikiLink 页面链接、反链（Backlinks）查看
- **模板系统**: 可复用的块模板，支持变量展开

---

## 架构分层

项目按以下层次组织，从入口到工具层层递进：

### 1. 入口层 (Entry)

应用启动和根组件。

| 文件 | 说明 |
|------|------|
| `src/main.ts` | 应用入口，初始化 CoreClient（Tauri/Rust 后端），创建 Vue 实例 |
| `src/App.vue` | 根组件，布局框架：左侧边栏 + 主内容区 + 右侧面板。管理全局快捷键、窗口控制、历史导航栈 |

### 2. 路由层 (Routing)

Vue Router 配置和路由守卫。

| 文件 | 说明 |
|------|------|
| `src/router/index.ts` | Router 实例，包含全局前置守卫（页面自动加载/创建） |
| `src/router/routes.ts` | 路由表：`/ideas`（创意列表）、`/ideas/:date`（日记页面）、`/page/:pageId`（普通页面）、`/trash`（回收站）、`/graph`（概念图谱） |
| `src/router/types.ts` | RouteMeta 类型扩展（fullWidth、hideRightSidebarToggle） |

### 3. 状态管理层 (State)

Pinia stores，集中管理应用状态。

| 文件 | 说明 |
|------|------|
| `src/stores/pages.ts` | 页面 CRUD、收藏/最近列表、日记页面创建、回收站管理 |
| `src/stores/blocks.ts` | 块 CRUD、排序（Gap 位置算法）、父子关系、批量操作、保存防抖 |
| `src/stores/editor.ts` | 编辑器状态：活跃块、光标位置、斜杠命令面板、Toast 消息 |
| `src/stores/property.ts` | 属性定义和值管理、属性类型推断、日期引用解析 |
| `src/stores/blockVersion.ts` | 块版本历史管理 |
| `src/stores/notification.ts` | 通知系统状态 |
| `src/stores/user-templates.ts` | 用户自定义模板管理 |

### 4. 组件层 (Components)

Vue 组件，按功能分组。

#### 核心编辑组件

| 文件 | 说明 |
|------|------|
| `src/components/Editor.vue` | TipTap 编辑器封装，加载所有扩展，处理保存/拆分/合并/缩进等操作 |
| `src/components/BlockList.vue` | 块列表容器，TreeNode 树构建、VueDraggable 拖拽、根级渲染 |
| `src/components/Block/index.vue` | 单个 Block 组件（递归），根据类型渲染不同 handler，管理编辑生命周期 |

#### 侧边栏组件

| 文件 | 说明 |
|------|------|
| `src/components/Sidebar/index.vue` | 侧边栏入口，代理到 SidebarContainer |
| `src/components/Sidebar/SidebarContainer.vue` | 侧边栏主容器，包含收藏、最近、日记等子面板 |
| `src/components/Sidebar/PageItem.vue` | 页面列表项，支持拖拽和右键菜单 |

#### 功能组件

| 文件 | 说明 |
|------|------|
| `src/components/GraphView/index.vue` | 概念图谱可视化（AntV G6），支持力导向布局、BFS 邻域加载 |
| `src/components/Page/index.vue` | 页面视图容器，加载块列表 |
| `src/components/Ideas/IdeasList.vue` | 创意/日记列表页 |
| `src/components/Trash/TrashList.vue` | 回收站页面 |
| `src/components/SearchPanel.vue` | 全局搜索面板（Ctrl+K） |
| `src/components/PageLinkMenu.vue` | WikiLink 页面链接选择菜单 |
| `src/components/SlashCommandMenu.vue` | 斜杠命令菜单 |
| `src/components/ConfirmDialog.vue` | 确认对话框（恢复回收站页面等） |
| `src/components/BlockSelector.vue` | 块选择器组件 |

#### Block Handler 组件

| 文件 | 说明 |
|------|------|
| `src/components/Block/PropertyDisplay.vue` | 属性块显示模式 |
| `src/components/Block/PropertyEditor.vue` | 属性块编辑模式 |
| `src/components/Block/PropertyInline.vue` | 属性行内编辑 |
| `src/components/Block/handlers/code/CodeEditor.vue` | CodeMirror 代码编辑器集成 |
| `src/components/Block/handlers/code/CodeRender.vue` | 代码块渲染 |
| `src/components/Block/handlers/bullet/BulletRender.vue` | 项目符号块渲染 |
| `src/components/Block/handlers/image/ImageRender.vue` | 图片块渲染 |
| `src/components/Block/handlers/embed/EmbedRender.vue` | 嵌入块渲染 |

### 5. 编辑器层 (Editor)

TipTap 核心扩展和组合式函数。

#### 组合式函数 (Composables)

| 文件 | 说明 |
|------|------|
| `src/composables/useBlockTree.ts` | **核心**: 从扁平 blocks[] 构建 TreeNode 树，同步树变更回 store |
| `src/composables/useDragDrop.ts` | 拖拽区域计算、排序位置计算 |
| `src/composables/useSlashCommands.ts` | 斜杠命令定义、过滤、分组、解析 |
| `src/composables/useJournal.ts` | 日记页面判断、日记标题规范化 |
| `src/composables/useSidebar.ts` | 侧边栏折叠状态管理 |
| `src/composables/useFavorites.ts` | 页面收藏管理 |
| `src/composables/useRecent.ts` | 最近访问页面追踪 |
| `src/composables/useNavigateToPage.ts` | 页面导航逻辑 |
| `src/composables/useBlockRegistry.ts` | 块类型注册表 |
| `src/composables/useCrossBlockSelection.ts` | 跨块选择（Shift+点击） |
| `src/composables/useSyncStatus.ts` | 多设备同步状态 |
| `src/composables/useTheme.ts` | 主题管理 |
| `src/composables/useIdeas.ts` | 创意功能逻辑 |
| `src/composables/useRightSidebar.ts` | 右侧面板（图谱/版本历史）管理 |

#### TipTap 扩展

| 文件 | 说明 |
|------|------|
| `src/extensions/DateRefExtension.ts` | 日期引用扩展，解析 `@date` 语法，渲染为可点击装饰 |
| `src/extensions/DateRefTriggerExtension.ts` | 日期引用触发扩展，处理 `@date` 输入触发 |
| `src/extensions/WikiLinkExtension.ts` | WikiLink 扩展，处理 `[[page]]` 语法 |
| `src/extensions/WikiLinkTriggerExtension.ts` | WikiLink 触发扩展，处理 `[[` 输入触发链接菜单 |
| `src/extensions/RelationshipTriggerExtension.ts` | 关系触发扩展，处理关系链接 |
| `src/extensions/SlashCommandExtension.ts` | 斜杠命令扩展，处理 `/` 输入触发命令面板 |
| `src/extensions/EnterAsBlockExtension.ts` | Enter 键创建新块扩展 |
| `src/extensions/BracketPairExtension.ts` | 括号对自动补全扩展 |
| `src/extensions/HeadingPreviewExtension.ts` | 标题预览扩展 |

### 6. 存储层 (Storage)

数据持久化，基于 Rust Core Client 和 Web 降级方案。

| 文件 | 说明 |
|------|------|
| `src/wasm/client.ts` | CoreClient 工厂：优先 Tauri invoke → WebAssembly → Web 降级 |
| `src/wasm/tauri-client.ts` | Tauri 平台实现：invoke 调用 Rust 命令 |
| `src/wasm/wasm-client.ts` | WebAssembly 实现：通过 wasm-bindgen 调用 Rust |
| `src/wasm/web-version-storage.ts` | Web 版版本存储（localStorage） |
| `src/wasm/web-notification-storage.ts` | Web 版通知存储 |
| `src/wasm/types.ts` | Core 数据类型定义 |
| `src/storage/db.ts` | Dexie 数据库封装（Web 降级使用） |

### 7. 服务层 (Services)

业务逻辑服务。

| 文件 | 说明 |
|------|------|
| `src/services/template-renderer.ts` | 模板渲染器：变量展开、模板块序列化/反序列化 |
| `src/services/migrate.ts` | 数据迁移服务 |

### 8. 类型层 (Types)

TypeScript 类型定义。

| 文件 | 说明 |
|------|------|
| `src/types/block.ts` | Block/BlockRecord/TreeNode 核心类型 |
| `src/types/page.ts` | Page/PageRecord 核心类型 |
| `src/types/property.ts` | Property/PropertyDefinition/PropertyType 定义 |
| `src/types/block-type.ts` | BlockType 处理者接口（编辑器/渲染器暴露） |
| `src/types/command.ts` | 斜杠命令类型 |
| `src/types/link.ts` | 链接类型 |
| `src/types/relationship.ts` | 关系类型定义、颜色/标签映射 |
| `src/types/template.ts` | 模板类型 |
| `src/types/notification.ts` | 通知类型 |
| `src/types/search.ts` | 搜索结果类型 |
| `src/types/asset.ts` | 资产类型 |

### 9. 工具层 (Utils)

纯函数工具集。

| 文件 | 说明 |
|------|------|
| `src/utils/block-helpers.ts` | **核心工具**: Gap 排序算法、位置计算、树操作 |
| `src/utils/parser.ts` | 内容解析、WikiLink 提取、属性值解析 |
| `src/utils/leftCalculator.ts` | 缩进层级计算（indent/outdent/reindex） |
| `src/utils/date-parser.ts` | 日期输入解析 |
| `src/utils/date-ref.ts` | 日期引用正则、重复规则、提醒计算 |
| `src/utils/journal-detect.ts` | 日记标题检测和规范化 |
| `src/utils/property.ts` | 属性值格式化、类型推断 |
| `src/utils/debounce.ts` | 防抖函数 |
| `src/utils/id.ts` | UUID 生成 |
| `src/utils/asset.ts` | 资产管理工具 |
| `src/utils/recurrence.ts` | 重复规则计算 |
| `src/utils/quiet-hours.ts` | 免打扰时段 |
| `src/utils/logger.ts` | 日志工具 |

### 10. Rust 后端

| 目录/文件 | 说明 |
|-----------|------|
| `src-tauri/src/lib.rs` | Tauri Rust 入口 |
| `src-tauri/src/commands.rs` | Tauri 命令实现（CRUD 操作） |
| `src-tauri/src/state.rs` | Rust 端状态管理 |
| `src-tauri/src/sync.rs` | 多设备同步逻辑 |
| `crates/comind-core/src/lib.rs` | 核心库（数据库操作） |
| `crates/comind-core/src/sync/mod.rs` | 同步核心逻辑 |
| `crates/comind-wasm/src/lib.rs` | WASM 绑定导出 |

---

## 核心概念

### Block 数据模型

```
Page (页面)
  └── Block (块，根块 blockId)
        ├── Block (子块，parentId = 根块ID)
        │     └── Block (嵌套子块)
        └── ...
```

**Block 核心字段:**
- `id`: 唯一标识
- `pageId`: 所属页面
- `parentId`: 父块 ID（null 为根级）
- `pos`: Gap 排序位置（初始间隔 1000）
- `content`: 内容（HTML 字符串）
- `type`: 块类型（bullet/property/query/embed/code/image）
- `format`: 格式化属性

### Gap 排序算法

项目使用 **Gap 排序** 算法管理块顺序：
- 每个块分配一个 `pos` 值，初始间隔 1000
- 插入时计算两相邻块之间的中间位置
- 当间隙耗尽（两块 pos 差 < 阈值）时触发 `renumberBlocks` 重新编号
- `calcInsertPos()` 和 `safeCalcInsertPos()` 为核心计算函数

### CoreClient 抽象

数据访问通过 `CoreClient` 抽象层，支持三种后端实现：
1. **Tauri** (桌面): 通过 `invoke()` 调用 Rust 命令 → SQLite
2. **WebAssembly** (Web): 通过 wasm-bindgen 调用 Rust → SQLite (wasm)
3. **Web** (降级): 使用 Dexie/IndexedDB

选择优先级: Tauri > WASM > Web

### TipTap 扩展架构

编辑器通过自定义 TipTap 扩展实现功能：
- 每个扩展封装一组 ProseMirror 插件
- 扩展间通过事件（如 `dateRefClick`）和 `notify*` 函数通信
- 触发扩展（Trigger）监听特定输入模式（`[[`, `@date`, `/`）
- 触发后弹出对应菜单/面板

### 状态管理模式

```
Pinia Store (响应式)
  ↕ sync
CoreClient (异步)
  ↕ invoke/wasm
Rust/SQLite (持久化)
```

- 编辑操作先更新 store，再异步持久化
- `SAVE_DEBOUNCE_MS` (300ms) 防抖保存
- 块变更通过 `structureVersion` 触发树重建

### 拖拽系统

- 使用 `vue-draggable-plus` (基于 Sortable.js)
- `computeDropZone()` 计算放置区域
- `computeSortPosition()` 计算排序位置
- `useBlockDragDrop` composable 封装拖拽逻辑
- 支持跨块选择（Shift+点击）

---

## 引导式学习路径

按以下顺序逐步理解项目：

### 步骤 1: 项目概览
> 了解项目入口文件和根组件结构

1. `src/main.ts` — 看应用如何启动、如何初始化 CoreClient
2. `src/App.vue` — 理解整体布局（侧边栏 + 内容区 + 右侧面板）、全局状态初始化

### 步骤 2: 状态管理
> 掌握 Pinia stores 的状态管理模式

3. `src/stores/pages.ts` — 页面 CRUD、日记页面自动创建
4. `src/stores/blocks.ts` — 块操作、Gap 排序算法、保存防抖
5. `src/stores/editor.ts` — 编辑器活动状态、斜杠命令面板
6. `src/stores/property.ts` — 属性系统、日期引用

### 步骤 3: 编辑器核心
> 理解 TipTap 编辑器和自定义扩展机制

7. `src/components/Editor.vue` — TipTap 实例化、扩展加载、保存/拆分/合并
8. `src/extensions/DateRefExtension.ts` — 日期引用实现
9. `src/extensions/SlashCommandExtension.ts` — 斜杠命令实现

### 步骤 4: 块编辑器系统
> 深入 Block 组件架构和块树管理

10. `src/components/BlockList.vue` — TreeNode 树构建、VueDraggable 拖拽
11. `src/components/Block/index.vue` — 递归 Block 组件、类型 handler
12. `src/composables/useBlockTree.ts` — 树构建算法、store 同步
13. `src/composables/useDragDrop.ts` — 拖拽计算

### 步骤 5: 存储层
> 探索 CoreClient 抽象和多后端支持

14. `src/wasm/client.ts` — CoreClient 工厂和后端选择
15. `src/wasm/tauri-client.ts` — Tauri 平台实现
16. `src/wasm/wasm-client.ts` — WebAssembly 实现
17. `src/storage/db.ts` — Dexie 降级存储

### 步骤 6: 工具函数
> 学习核心算法实现

18. `src/utils/block-helpers.ts` — Gap 排序、位置计算
19. `src/utils/parser.ts` — 内容解析、链接提取
20. `src/utils/leftCalculator.ts` — 缩进计算

### 步骤 7: 页面管理
> 了解页面创建、导航和日记功能

21. `src/components/Page/index.vue` — 页面视图
22. `src/components/Ideas/IdeasList.vue` — 日记列表
23. `src/composables/useJournal.ts` — 日记检测
24. `src/composables/useNavigateToPage.ts` — 页面导航

---

## 文件地图

### 入口
```
src/main.ts          → 应用启动、CoreClient 初始化、Vue 挂载
src/App.vue          → 根布局、全局快捷键、历史导航、设备同步
```

### 路由
```
src/router/index.ts  → Router 实例 + 全局守卫
src/router/routes.ts → 路由表定义
src/router/types.ts  → RouteMeta 类型
```

### 状态管理
```
src/stores/pages.ts       → 页面生命周期
src/stores/blocks.ts      → 块生命周期 + Gap 排序
src/stores/editor.ts      → 编辑器 UI 状态
src/stores/property.ts    → 属性数据
src/stores/blockVersion.ts → 版本历史
src/stores/notification.ts → 通知
src/stores/user-templates.ts → 用户模板
```

### 核心组件
```
src/components/Editor.vue      → TipTap 编辑器封装
src/components/BlockList.vue    → 块列表容器（拖拽 + 树渲染）
src/components/Block/index.vue  → 块组件（递归）
src/components/GraphView/index.vue → 概念图谱
src/components/Sidebar/        → 侧边栏系列
src/components/Ideas/          → 日记/创意
src/components/Trash/          → 回收站
src/components/SearchPanel.vue → 全局搜索
```

### 编辑器扩展
```
src/extensions/DateRefExtension.ts          → 日期引用
src/extensions/DateRefTriggerExtension.ts   → 日期触发
src/extensions/WikiLinkExtension.ts         → WikiLink
src/extensions/WikiLinkTriggerExtension.ts  → WikiLink 触发
src/extensions/RelationshipTriggerExtension.ts → 关系触发
src/extensions/SlashCommandExtension.ts     → 斜杠命令
src/extensions/EnterAsBlockExtension.ts     → Enter 新块
src/extensions/BracketPairExtension.ts      → 括号补全
src/extensions/HeadingPreviewExtension.ts   → 标题预览
```

### 组合式函数
```
src/composables/useBlockTree.ts         → 树构建 + store 同步
src/composables/useDragDrop.ts          → 拖拽计算
src/composables/useSlashCommands.ts     → 斜杠命令
src/composables/useJournal.ts           → 日记判断
src/composables/useSidebar.ts           → 侧边栏状态
src/composables/useFavorites.ts         → 收藏
src/composables/useRecent.ts            → 最近访问
src/composables/useNavigateToPage.ts    → 页面导航
src/composables/useCrossBlockSelection.ts → 跨块选择
src/composables/useBlockRegistry.ts     → 块类型注册
src/composables/useSyncStatus.ts        → 同步状态
src/composables/useTheme.ts             → 主题
src/composables/useIdeas.ts             → 创意管理
src/composables/useRightSidebar.ts      → 右侧面板
```

### 存储/后端
```
src/wasm/client.ts              → CoreClient 工厂
src/wasm/tauri-client.ts        → Tauri 实现
src/wasm/wasm-client.ts         → WASM 实现
src/wasm/web-version-storage.ts → Web 版本存储
src/wasm/web-notification-storage.ts → Web 通知存储
src/storage/db.ts               → Dexie 数据库
src-tauri/src/                  → Rust 后端
crates/comind-core/             → 核心库（数据库 + 同步）
crates/comind-wasm/             → WASM 绑定
```

### 工具
```
src/utils/block-helpers.ts   → Gap 排序、树操作
src/utils/parser.ts          → 内容解析
src/utils/leftCalculator.ts  → 缩进计算
src/utils/date-ref.ts        → 日期引用
src/utils/date-parser.ts     → 日期解析
src/utils/journal-detect.ts  → 日记检测
src/utils/debounce.ts        → 防抖
src/utils/id.ts              → UUID
src/utils/property.ts        → 属性工具
src/utils/recurrence.ts      → 重复规则
```

---

## 复杂度热点

以下文件逻辑复杂，新成员应重点关注：

### 🔴 高复杂度

| 文件 | 原因 |
|------|------|
| `src/stores/blocks.ts` | 块 CRUD + Gap 排序算法 + 防抖保存 + 批量操作，是最核心也最复杂的 store |
| `src/composables/useBlockTree.ts` | TreeNode 树构建和 store 双向同步，涉及递归树操作 |
| `src/utils/block-helpers.ts` | Gap 排序核心算法（`calcInsertPos`, `renumberBlocks`），位置计算逻辑密集 |
| `src/components/Block/index.vue` | 递归组件 + 多种 handler + 拖拽 + 编辑生命周期，组件逻辑复杂 |
| `src/components/Editor.vue` | TipTap 实例管理 + 多扩展集成 + 保存/拆分/合并操作 |

### 🟡 中等复杂度

| 文件 | 原因 |
|------|------|
| `src/composables/useDragDrop.ts` | 拖拽区域和排序位置计算 |
| `src/extensions/SlashCommandExtension.ts` | 斜杠命令的触发、解析、UI 交互 |
| `src/extensions/DateRefExtension.ts` | 正则解析 + 装饰渲染 + 事件通信 |
| `src/router/index.ts` | 路由守卫中的页面自动加载/创建逻辑 |
| `src/wasm/client.ts` | 多后端选择和 CoreClient 抽象 |
| `src/utils/leftCalculator.ts` | 缩进层级计算 |
| `src/services/template-renderer.ts` | 模板变量展开和块序列化 |

### ⚠️ 修改注意事项

1. **修改 Gap 排序算法前**: 充分理解 `pos` 值的含义和 Gap 耗尽机制，查看 `block-helpers.test.ts`
2. **修改 Block 组件前**: 理解 TreeNode 数据流（BlockList → VueDraggable → Block → syncTreeToStore）
3. **修改 CoreClient 相关代码**: 必须同时检查 Tauri/WASM/Web 三种实现
4. **修改路由守卫**: 注意页面自动创建逻辑，可能影响首次加载体验
5. **修改 TipTap 扩展**: 注意扩展间的事件通信（notify 函数），避免破坏协作

---

## 开发环境快速上手

### 安装和运行

```bash
# 安装依赖
cd comind
npm install

# Web 开发模式
npm run dev

# Tauri 桌面开发
npm run tauri:dev

# Android 开发
npm run android:dev
```

### 构建

```bash
# 类型检查 + 构建
npm run build

# Tauri 构建
npm run tauri:build

# WASM 构建
npm run wasm:build
```

### 测试

```bash
# 单元测试
npm run test

# 测试监听模式
npm run test:watch

# 测试覆盖率
npm run test:coverage

# E2E 测试 (Playwright)
# 查看 playwright.config.ts 和 tests/ 目录
```

### 代码质量

```bash
# Lint
npm run lint

# 自动修复
npm run lint:fix
```

### 关键配置文件

| 文件 | 说明 |
|------|------|
| `package.json` | 依赖和脚本 |
| `vite.config.ts` | Vite 构建配置 |
| `tsconfig.json` / `tsconfig.app.json` | TypeScript 配置 |
| `vitest.config.ts` | 测试配置 |
| `playwright.config.ts` | E2E 测试配置 |
| `eslint.config.js` | ESLint 配置 |
| `src-tauri/tauri.conf.json` | Tauri 配置 |

---

## 技术决策记录

### 为什么用 Gap 排序？
- 避免频繁 reindex 全表
- 支持高并发插入
- 实现简单且高效

### 为什么 CoreClient 抽象？
- 同一套业务逻辑运行在 Tauri/WASM/Web 三种环境
- 通过 invoke() / wasm-bindgen / HTTP 切换后端
- 保持前端代码零改动

### 为什么用 Pinia (非 Vuex)？
- Vue 3 官方推荐
- 更好的 TypeScript 支持
- 更轻量的 API

### 为什么 TipTap？
- 基于 ProseMirror，可靠的文档模型
- 扩展性强，自定义扩展方便
- Vue 3 官方支持

### 数据流向
```
用户输入 → TipTap Editor → 防抖保存 (300ms)
  → Pinia Store 更新 → CoreClient.saveBlocks()
  → Rust 后端 → SQLite 持久化
  ← 返回操作结果
```

---

## 常见问题

### Q: 如何添加新的块类型？
1. 在 `src/types/block-type.ts` 定义处理器接口
2. 在 `src/components/Block/handlers/` 下创建渲染组件
3. 在 `src/composables/useBlockRegistry.ts` 注册新类型
4. 如需新的数据库字段，修改 Rust 端 schema

### Q: 如何添加新的斜杠命令？
1. 在 `src/composables/useSlashCommands.ts` 的 `commands` 数组添加
2. 实现命令的 `execute` 函数
3. 在 `SlashCommandExtension.ts` 中处理触发逻辑

### Q: 如何切换数据后端？
- Tauri 环境自动使用 Rust/SQLite
- Web 环境优先使用 WASM，降级为 Dexie/IndexedDB
- 检查 `isTauriEnvironment()` 返回值

### Q: 块的 pos 值如何工作？
- 初始块 pos = 1000, 2000, 3000...
- 插入时取两相邻块的中间值
- 间隙 < 1 时触发重新编号（`renumberBlocks`）
- 详细实现见 `block-helpers.ts`

### Q: 如何调试 Tauri 后端？
- 使用 `npm run tauri:dev` 启动（含 DevTools）
- Rust 日志输出到控制台
- 使用 `getCoreClient()` 获取客户端实例进行调试
