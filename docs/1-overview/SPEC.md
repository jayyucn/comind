# comind SPEC.md — 项目总规范

> 版本：v0.5
> 日期：2026-06-29
> 状态：Phase 2 已完成 ✅ | Phase 3 进行中 🔄

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

#### Phase 1.1（已完成 ✅ / 部分完成）

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
| Tauri 桌面壳      | Phase 3 进行中 🔄 |
| SQLite 存储      | Phase 3 待开始 ⏳ |

> **Phase 2 已完成 ✅：** 全文搜索（Lunr.js + bigram 中文分词）、Core 层抽离（7 个 Service）、StorageAdapter 接口（IndexedDB + Memory 双实现）、1340 tests passed

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

## 5. Phase 2 — 架构优化与搜索增强

### 5.1 核心目标（已完成 ✅）

> **架构解耦 + 搜索能力**

将核心业务逻辑从 Vue/Pinia/tiptap 框架中抽离，形成框架无关的 Core Layer，为 Phase 3 的 Tauri 桌面应用做准备；同时引入全文搜索功能，提升内容查找效率。

| 目标 | 描述 | 优先级 |
|------|------|--------|
| **架构解耦** | 将 Block、Link、Tag、Property、GapSort 逻辑抽离为框架无关的 Core Layer | P0 |
| **存储抽象** | 设计 `StorageAdapter` 接口，支持 IndexedDB → SQLite 平滑迁移 | P0 |
| **全文搜索** | 引入 Lunr.js + 中文分词，实现内容快速检索 | P0 |
| **质量保障** | 建立 Core 层单元测试体系，确保重构安全性 | P1 |

### 5.2 技术要求

#### 5.2.1 Core Layer 架构

```
src/core/
├── types/                # 类型定义（Block, Link, Tag, Property, Page, RelationshipType, UserTemplate）
├── services/             # 领域服务（7 个）
│   ├── blockService.ts           # Block CRUD + 树操作
│   ├── linkService.ts            # 双向链接管理
│   ├── tagService.ts             # 标签解析
│   ├── propertyService.ts        # 属性解析
│   ├── pageService.ts            # Page 管理
│   ├── relationshipTypeService.ts # 关系类型管理（含强度 strong/medium/weak）
│   └── templateService.ts        # 用户模板管理
├── storage/              # 存储抽象
│   ├── adapter.ts                # StorageAdapter 接口
│   ├── indexedDBAdapter.ts       # 生产实现（IndexedDB）
│   ├── memoryAdapter.ts          # 测试实现（内存）
│   └── repositories/             # 7 个 Repository 接口
└── search/               # 搜索模块
    ├── lunrSearch.ts             # Lunr.js + bigram 中文分词
    ├── indexManager.ts           # 增量索引（debounce 100ms）
    └── searchService.ts          # 搜索 API + Ctrl+K 集成
```

**核心原则：**
- Core Layer 不得依赖任何框架（Vue、Pinia、tiptap）
- 所有对外接口通过 TypeScript 类型定义
- 依赖注入通过参数传递，不使用全局状态

#### 5.2.2 StorageAdapter 设计

采用 **Repository 模式**，每个实体对应独立的 Repository：

```typescript
interface StorageAdapter {
  blocks: BlockRepository
  links: LinkRepository
  tags: TagRepository
  properties: PropertyRepository
  pages: PageRepository
  relationshipTypes: RelationshipTypeRepository
  userTemplates: TemplateRepository
  transaction<R>(fn: (tx: StorageAdapter) => Promise<R>): Promise<R>
}
```

**双实现：**
- `IndexedDBAdapter` — 生产环境，基于 Dexie.js
- `MemoryAdapter` — 测试环境，纯内存，无外部依赖

#### 5.2.3 全文搜索方案

- **引擎：** Lunr.js（纯 JS 实现，无外部依赖）
- **中文分词：** bigram（双字滑窗算法，替代原计划的 segmentit，零依赖且对中英混合搜索表现良好）
- **索引策略：** 增量更新，Block/Page CRUD 时通过 debounce 100ms 合并同步
- **搜索范围：** Block.content + Page.title
- **集成方式：** 首次搜索时从 IndexedDB 全量构建索引，后续增量更新

### 5.3 实施步骤（4 个 Sprint — 全部完成 ✅）

#### Sprint 1：Core 层架构设计 + Block/Link 抽离 ✅

| 任务 | 描述 | 交付物 | 状态 |
|------|------|--------|------|
| T1.1 | 定义 Core 层类型系统 | `core/types/` 目录 | ✅ |
| T1.2 | 抽离 Block 树操作逻辑 | `core/services/blockService.ts` | ✅ |
| T1.3 | 抽离 Gap Sort 排序算法 | `core/services/blockService.ts` | ✅ |
| T1.4 | 抽离 Link 管理逻辑 | `core/services/linkService.ts` | ✅ |
| T1.5 | 编写 Core 层单元测试 | `core/**/*.test.ts` | ✅ |

#### Sprint 2：Tag/Property 抽离 + StorageAdapter 接口 ✅

| 任务 | 描述 | 交付物 | 状态 |
|------|------|--------|------|
| T2.1 | 抽离 Tag 解析逻辑 | `core/services/tagService.ts` | ✅ |
| T2.2 | 抽离 Property 解析逻辑 | `core/services/propertyService.ts` | ✅ |
| T2.3 | 定义 StorageAdapter 接口 | `core/storage/adapter.ts` | ✅ |
| T2.4 | 实现 IndexedDB Adapter | `core/storage/indexedDBAdapter.ts` | ✅ |
| T2.5 | 集成 Pinia Store 到 Core | 重构 `stores/blocks.ts` 等 | ✅ |
| T2.6（扩展） | 迁移 RelationshipType 到 Core 层 | `core/services/relationshipTypeService.ts` | ✅ |
| T2.7（扩展） | 迁移 UserTemplate 到 Core 层 | `core/services/templateService.ts` | ✅ |
| T2.8（扩展） | 添加 MemoryAdapter 测试实现 | `core/storage/memoryAdapter.ts` | ✅ |

#### Sprint 3：Lunr.js 搜索集成 + 搜索 UI ✅

| 任务 | 描述 | 交付物 | 状态 |
|------|------|--------|------|
| T3.1 | 集成 Lunr.js + bigram 中文分词 | `core/search/lunrSearch.ts` | ✅ |
| T3.2 | 实现增量索引更新（debounce 100ms） | `core/search/indexManager.ts` | ✅ |
| T3.3 | 实现搜索 API | `core/search/searchService.ts` | ✅ |
| T3.4 | 创建搜索面板组件 | `components/SearchPanel.vue` | ✅ |
| T3.5 | 集成搜索快捷键（Ctrl+K） | 全局搜索触发 | ✅ |
| T3.6（扩展） | 索引自动更新集成到 stores | `stores/blocks.ts` + `stores/pages.ts` | ✅ |

#### Sprint 4：测试覆盖 + 回归验证 + 文档更新 ✅

| 任务 | 描述 | 交付物 | 状态 |
|------|------|--------|------|
| T4.1 | 完善 Core 层单元测试 | 覆盖率约 75-95%（Core services） | ✅ |
| T4.2 | 运行回归测试 | 1340 tests passed | ✅ |
| T4.3 | 性能基准测试 | 1000+ Block 操作 < 100ms | ✅ |
| T4.4 | 更新技术文档 | `docs/2-architecture/core-layer.md` v1.1 | ✅ |
| T4.5 | 更新开发指南 | `docs/5-development/dev-guide.md` | ✅ |

### 5.4 关键功能点

| 功能 | 说明 | 验收标准 | 实际结果 |
|------|------|----------|----------|
| Core Layer 抽离 | Block/Link/Tag/Property/GapSort 逻辑完全脱离框架 | 可独立运行单元测试 | ✅ 7 个 Service 全部抽离 |
| StorageAdapter | 抽象存储接口，支持多后端切换 | IndexedDB 实现通过测试 | ✅ IndexedDB + Memory 双实现 |
| 全文搜索 | Lunr.js 搜索，支持中文分词 | 搜索响应 < 200ms | ✅ 1000 Block 搜索 96ms |
| 增量索引 | Block 保存时自动更新索引 | 索引更新延迟 < 100ms | ✅ debounce 100ms 合并更新 |
| 搜索 UI | 全局搜索面板，支持模糊匹配 | 支持 Ctrl+K 触发 | ✅ Ctrl+K + 中英文混合搜索 |

### 5.5 实际成果（2026-06-28 验收）

| 成果 | 说明 |
|------|------|
| **框架无关的 Core Layer** | 7 个 Service 全部抽离，可在 Vue、React、Tauri 等不同环境中复用 |
| **存储抽象层** | Repository 模式 + IndexedDB/Memory 双实现，支持向 SQLite 平滑迁移 |
| **全文搜索能力** | Lunr.js + bigram 中文分词，1000 Block 搜索 < 100ms |
| **完善的测试体系** | 1340 tests passed，Core 层 services 覆盖率 75-95% |
| **性能验证** | 1000+ Block 创建 3.41ms，查询 0.16ms，删除 9.71ms |
| **技术文档** | `docs/2-architecture/core-layer.md` v1.1 完整架构文档 |

### 5.6 实际执行记录

| 阶段 | 计划周期 | 实际完成时间 | 说明 |
|------|------|------|------|
| Sprint 1 | Week 1-2 | 2026-06 中旬 | Core 层类型 + Block/Link 服务 |
| Sprint 2 | Week 3-4 | 2026-06 下旬 | Tag/Property + StorageAdapter + 扩展任务（RelationshipType/UserTemplate） |
| Sprint 3 | Week 5-6 | 2026-06-28 | Lunr.js 搜索 + bigram 分词 + 索引自动更新 |
| Sprint 4 | Week 7-8 | 2026-06-28~29 | 测试覆盖 + 性能基准 + 文档更新 |

### 5.7 相关资源链接

| 资源 | 路径 | 状态 |
|------|------|------|
| Core Layer 架构设计 | `docs/2-architecture/core-layer.md` | ✅ 已创建 v1.1 |
| StorageAdapter 接口规范 | `docs/2-architecture/storage-adapter.md` | ✅ 已创建 |
| Sprint 1 详细计划 | `docs/2-architecture/sprint-1-plan.md` | ✅ 已创建 |
| 全文搜索设计 | `docs/3-features/search-spec.md` | ✅ 已实现（bigram 方案） |
| 技术选型说明 | `docs/1-overview/tech-selection.md` | 已有 |
| 开发指南 | `docs/5-development/dev-guide.md` | 已有 |

***

## 6. Phase 3 — Rust Core 重写 + Tauri 桌面化（进行中 🔄）

### 6.1 核心变化

| 变化   | 说明 |
| ---- | ---- |
| **Core Layer 重写** | Phase 2 的 7 个 TS Service 全部迁移到 Rust，实现零依赖业务逻辑 |
| **存储层重构** | IndexedDB → SQLite（Rust 端 `rusqlite`，WASM 端 `sql.js`） |
| **属性系统统一** | 废弃 `block.properties`，所有属性统一使用独立 `properties` 表 |
| **全文搜索升级** | Lunr.js → SQLite FTS5，性能更好、集成更简单 |
| **桌面化** | Tauri 2.x 桌面应用，原生性能 |
| **WASM 编译** | 同一套 Rust Core 编译为桌面端和 Web WASM 版本 |
| **文件系统** | 引入 Markdown 文件读写（tauri-plugin-fs） |

### 6.2 架构决策（Grill-Me 评审确认）

| 决策项 | 确认方案 | 说明 |
|--------|----------|------|
| Core Layer 迁移 | **完全重写** | 7 个 Service 全部用 Rust 重写 |
| Web 端支持 | **WASM 编译** | 同一套 Rust 代码编译为 WASM，同步完成 |
| SQLite 位置 | **Rust 端** | 使用 `rusqlite`，通过 Tauri Command 桥接 |
| 事务方案 | **批处理 API** | `execute_batch` 收集操作，单次 IPC 调用 |
| 存储抽象 | **Trait 注入** | Repository trait 解耦业务逻辑与存储实现 |
| 属性系统 | **统一到 properties 表** | 废弃 `block.properties` |
| 搜索方案 | **SQLite FTS5** | 替代 Lunr.js，支持中文分词 |
| Command 模式 | **混合模式** | 查询细粒度 + 写操作粗粒度 + 批处理 API |
| 项目结构 | **单仓库单项目** | Tauri `src-tauri/` + Rust workspace `crates/` |

### 6.3 技术栈

| 维度 | 选择 |
|------|------|
| 桌面框架 | Tauri 2.11.3 |
| 后端语言 | Rust 1.80+ |
| SQLite 绑定 | rusqlite 0.32（features = ["bundled", "fts5"]） |
| WASM 绑定 | wasm-bindgen |
| WASM SQLite | sql.js |
| JSON 序列化 | serde + serde_json |
| ID 生成 | uuid |
| 文件系统插件 | tauri-plugin-fs 2 |
| 对话框插件 | tauri-plugin-dialog 2 |
| 日志插件 | tauri-plugin-log 2 |
| 更新插件 | tauri-plugin-updater 2（GitHub Releases 分发） |
| 前端框架 | Vue 3 + Vite（UI 层） |
| 状态管理 | Pinia（调用 Tauri Command） |
| 跨平台策略 | Windows 先行，macOS/Linux 后续扩展 |
| 权限模型 | 宽松权限（暂不上架应用商店） |

### 6.4 项目结构

```
comind/
├── src/                     # TS 前端代码（UI 层）
│   ├── components/          # Vue 组件
│   ├── composables/         # Vue composables
│   ├── stores/              # Pinia stores（重构后调用 Tauri Command）
│   └── main.ts              # 入口文件
├── src-tauri/               # Tauri Rust 代码
│   ├── src/
│   │   ├── main.rs          # Tauri 主入口
│   │   └── commands.rs      # Tauri Command 定义
│   ├── Cargo.toml
│   └── tauri.conf.json
├── crates/                  # Rust crates（Workspace）
│   ├── comind-core/         # Core Layer（业务逻辑）
│   │   ├── src/
│   │   │   ├── services/    # 7 个 Service（Block/Link/Page/Tag/Property/RelationshipType/Template）
│   │   │   ├── storage/     # Repository trait + SQLite 实现
│   │   │   ├── search/      # FTS5 搜索
│   │   │   └── types/       # 类型定义
│   │   └── Cargo.toml
│   └── comind-wasm/         # WASM 绑定
│       ├── src/
│       │   └── lib.rs       # wasm-bindgen 导出
│       └── Cargo.toml
├── Cargo.toml               # Workspace 根配置
├── package.json
└── vite.config.ts
```

### 6.5 实施步骤（6 个 Sprint）

#### Sprint 1（T3.1）⏳ 项目初始化 + Rust Core 基础架构

| 任务 | 描述 | 优先级 | 状态 |
|------|------|--------|------|
| T3.1.1 | 安装 Tauri CLI，初始化 `src-tauri/` 项目结构 | P0 | ⏳ |
| T3.1.2 | 创建 Rust workspace，`crates/comind-core/` 基础结构 | P0 | ⏳ |
| T3.1.3 | 定义 Core 层类型（Block、Page、Link、Tag、Property、RelationshipType、Template） | P0 | ⏳ |
| T3.1.4 | 定义 Repository trait（7 个） | P0 | ⏳ |
| T3.1.5 | 配置 tauri.conf.json、Cargo.toml、capabilities | P1 | ⏳ |

#### Sprint 2（T3.2）⏳ SQLite 存储层实现

| 任务 | 描述 | 优先级 | 状态 |
|------|------|--------|------|
| T3.2.1 | 设计 SQLite Schema（6 张表 + FTS5 搜索表） | P0 | ⏳ |
| T3.2.2 | 实现 SQLite Repository（rusqlite） | P0 | ⏳ |
| T3.2.3 | 实现 FTS5 全文搜索表 | P0 | ⏳ |
| T3.2.4 | 实现事务支持（BEGIN/COMMIT/ROLLBACK） | P1 | ⏳ |
| T3.2.5 | Rust 单元测试（核心逻辑） | P1 | ⏳ |

#### Sprint 3（T3.3）⏳ 7 个 Service 重写

| 任务 | 描述 | 优先级 | 状态 |
|------|------|--------|------|
| T3.3.1 | BlockService（CRUD + Gap Sort + 树形操作） | P0 | ⏳ |
| T3.3.2 | LinkService（双向链接管理） | P0 | ⏳ |
| T3.3.3 | PageService（页面管理） | P0 | ⏳ |
| T3.3.4 | PropertyService（属性解析 + CRUD） | P1 | ⏳ |
| T3.3.5 | TagService（标签解析） | P1 | ⏳ |
| T3.3.6 | RelationshipTypeService（关系类型管理） | P1 | ⏳ |
| T3.3.7 | TemplateService（模板管理） | P1 | ⏳ |

#### Sprint 4（T3.4）⏳ Tauri Command + TS 重构

| 任务 | 描述 | 优先级 | 状态 |
|------|------|--------|------|
| T3.4.1 | 定义 Tauri Command（混合模式） | P0 | ⏳ |
| T3.4.2 | 重构 Pinia stores，调用 Tauri Command | P0 | ⏳ |
| T3.4.3 | 移除 `block.properties`，迁移到 `properties` 表 | P1 | ⏳ |
| T3.4.4 | 性能基准测试（对比 TS Core） | P1 | ⏳ |
| T3.4.5 | E2E 测试验证（Playwright） | P1 | ⏳ |

#### Sprint 5（T3.5）⏳ WASM 编译 + Web 支持

| 任务 | 描述 | 优先级 | 状态 |
|------|------|--------|------|
| T3.5.1 | 创建 `crates/comind-wasm/`，导出 WASM 绑定 | P0 | ⏳ |
| T3.5.2 | 实现 WASM 存储后端（sql.js） | P0 | ⏳ |
| T3.5.3 | WASM 编译配置（wasm-pack） | P1 | ⏳ |
| T3.5.4 | Web 端集成 WASM（Vite 插件） | P1 | ⏳ |
| T3.5.5 | Web 端性能测试 | P1 | ⏳ |

#### Sprint 6（T3.6）⏳ Markdown 文件系统 + 构建打包

| 任务 | 描述 | 优先级 | 状态 |
|------|------|--------|------|
| T3.6.1 | Page 导出为 Markdown | P1 | ⏳ |
| T3.6.2 | Markdown 文件导入为 Page | P1 | ⏳ |
| T3.6.3 | 文件监听（外部编辑器修改同步） | P2 | ⏳ |
| T3.6.4 | Windows 打包（.msi/.exe） | P0 | ⏳ |
| T3.6.5 | macOS 打包（.dmg） | P1 | ⏳ |
| T3.6.6 | 自动更新配置 | P1 | ⏳ |

### 6.6 关键约束

- **Core Layer 完全迁移**：Phase 2 的 7 个 TS Service 全部用 Rust 重写，业务逻辑零框架依赖
- **存储层解耦**：通过 Repository trait 注入，支持 SQLite（桌面）和 sql.js（WASM）双实现
- **事务原子性**：写操作通过批处理 API 保证跨实体事务的原子性
- **属性系统统一**：所有属性统一使用 `properties` 表，废弃 `block.properties`
- **Web 兼容**：同一套 Rust Core 通过 WASM 编译支持 Web 端，同步完成
- **测试策略**：Rust 单元测试 + E2E 测试（Playwright），验证 Core 层迁移正确性

***

## 7. 用户旅程

### 7.1 典型使用场景

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

### 7.2 键盘快捷键

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

## 8. 单编辑器原则

> 这是 comind 最重要的架构约束。

### 8.1 核心规则

- ❗ 任何时刻，系统只能存在 **1 个活跃的 tiptap 编辑器实例**
- ❗ 任何时刻，只有 **1 个 Block 处于编辑状态**
- ❗ 编辑器必须随 Block 切换而销毁或复用

### 8.2 编辑器状态

| 状态           | 说明               |
| ------------ | ---------------- |
| Display（展示态） | 纯 HTML 渲染，无编辑器实例 |
| Edit（编辑态）    | tiptap 实例挂载，光标可见 |

### 8.3 切换规则

```
切换 Block 时：
  1. 保存当前 block.content
  2. 销毁当前 editor 实例
  3. activeBlockId = 新 block.id
  4. 挂载新 editor 实例
```

***

## 9. 数据流

```
用户输入 → tiptap → Pinia（运行态） → debounce → IndexedDB（持久化）

IndexedDB → Pinia → Vue 响应式渲染 → Block 组件展示
```

### 9.1 状态层次

| 层次        | 作用                                 |
| --------- | ---------------------------------- |
| Pinia     | 运行态状态（activeBlockId、Block 树、UI 状态） |
| IndexedDB | 持久化存储（Block、Page、Link）             |
| tiptap    | 单编辑器实例（文本编辑）                       |

### 9.2 链接解析时机

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

## 10. 性能约束

| 约束    | 目标                     |
| ----- | ---------------------- |
| 操作流畅度 | 1000+ Block 流畅滚动       |
| 编辑延迟  | < 16ms（接近即时）           |
| 编辑器切换 | 无明显卡顿                  |
| 渲染策略  | Block 组件 memo 化，避免重复渲染 |

> **虚拟列表：** Phase 1 暂不引入。100 个 Block 约 100 个 DOM 节点，浏览器性能完全可承受。待数据量增长至 500+ 出现性能瓶颈时再按需引入。

***

## 11. 文档体系

本文档是 comind 的总规范，各专项文档位于 `docs/` 目录：

### 11.1 目录结构

| 目录 | 内容 |
| --- | --- |
| `docs/1-overview/` | 项目概览 - SPEC、tech-selection、TODO |
| `docs/2-architecture/` | 架构设计 - data-model、routing-design、storage-spec、core-layer、storage-adapter、sprint-1-plan |
| `docs/3-features/` | 功能规格 - block-editor、link、tag、slash-commands |
| `docs/4-ui/` | UI/UX 设计 - ui-ux-spec、interaction-spec |
| `docs/5-development/` | 开发指南 - dev-guide、page-block-crud |
| `docs/6-reports/` | 验证报告 - 项目评估、功能验证报告 |
| `docs/7-sidebar/` | 侧边栏 - sidebar-implementation、sidebar-redesign |
| `docs/sort/` | 排序功能 - sortable-implementation、phase-1-1-plan |
| `docs/superpowers/` | 能力增强 - 特性设计与实现计划 |

### 11.2 核心文档

| 文档 | 描述 |
| --- | --- |
| [SPEC.md](docs/1-overview/SPEC.md) | 项目总规范 |
| [data-model.md](docs/2-architecture/data-model.md) | 核心数据模型（Block、Link、Tag、Property） |
| [core-layer.md](docs/2-architecture/core-layer.md) | Core Layer 架构设计 |
| [storage-adapter.md](docs/2-architecture/storage-adapter.md) | StorageAdapter 接口规范 |
| [storage-spec.md](docs/2-architecture/storage-spec.md) | 存储层规范 |
| [sprint-1-plan.md](docs/2-architecture/sprint-1-plan.md) | Phase 2 Sprint 1 详细计划 |
| [dev-guide.md](docs/5-development/dev-guide.md) | 开发指南 |
| [link-spec.md](docs/3-features/link-spec.md) | 双向链接系统详细规范 |
| [tech-selection.md](docs/1-overview/tech-selection.md) | 技术选型说明 |
| [ui-ux-spec.md](docs/4-ui/ui-ux-spec.md) | UI/UX 视觉系统规范 |
| [interaction-spec.md](docs/4-ui/interaction-spec.md) | 交互规格 |

***

## 12. 已确认事项

以下事项已在历次评审中确认：

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
| **Phase 2 Core 层抽离** | ✅ 已完成：Block/Link/Tag/Property/GapSort/RelationshipType/UserTemplate 全部抽离 |
| **Phase 2 StorageAdapter** | ✅ 已完成：Repository 模式，IndexedDB + Memory 双实现 |
| **Phase 2 全文搜索** | ✅ 已完成：Lunr.js + bigram 中文分词（替代 segmentit） |
| **Phase 2 测试体系** | ✅ 已完成：1340 tests passed，7 个性能基准测试 |
| **Phase 3 Tauri 套壳** | 🔄 进行中：项目结构已初始化，cargo build 中 |
| **Phase 3 SQLite 存储** | ⏳ 待开始：替换 IndexedDB，已配置 rusqlite 依赖 |
| **Phase 3 文件系统** | ⏳ 待开始：Markdown 导入/导出，已配置 tauri-plugin-fs |

***

## 13. 后续阶段规划

| 阶段 | 目标 | 说明 | 状态 |
| --- | --- | --- | --- |
| **Phase 1** | MVP 验证大纲编辑体验 | Block 嵌套、折叠、拖拽、双向链接 | ✅ 已完成 |
| **Phase 2** | 架构解耦 + 搜索能力 | Core Layer 抽离 + StorageAdapter + Lunr.js 搜索 | ✅ 已完成 |
| **Phase 3** | Tauri 套壳 | 桌面应用 + SQLite + 文件系统 | 🔄 进行中 |
| **Phase 4** | 功能增强 | Graph 可视化、插件系统、协同编辑 | ⏳ 规划中 |

### 13.1 待定事项

以下决策暂未确定，将在后续阶段补充：

| 事项           | 说明                                      |
| ------------ | --------------------------------------- |
| tiptap 自定义节点 | BlockNode / PageNode / LinkMark 的具体实现方案 |
| 折叠状态存储       | 存在 Block.properties 中 vs 单独状态字段         |
| 外部存储         | Block.content 是否支持大文本外部存储               |
| 版本历史         | 是否支持 Block 级别的历史版本回溯                    |
| Graph 可视化    | Phase 4 考虑                            |
| SQLite 迁移策略  | 全量迁移 vs 双写过渡                          |
| Markdown 兼容性 | 是否完全兼容 CommonMark 或自定义扩展               |

***

## 14. 质量状态（2026-06-29）

### 14.1 测试覆盖

| 测试类型 | 状态 | 详情 |
| --- | --- | --- |
| 单元测试 | ✅ 1340/1340 通过 | Vitest 覆盖 Core 层全部服务、composables、stores |
| 性能基准测试 | ✅ 7/7 通过 | 1000+ Block 创建/查询/删除/搜索/移动 |
| E2E 测试 | ✅ 通过 | Playwright 路由测试 |
| 安全审计 | ✅ 0 漏洞 | npm audit |

### 14.2 代码质量

| 指标 | 状态 |
| --- | --- |
| TypeScript 构建 | ✅ 通过（vue-tsc + vite build） |
| ESLint | ✅ 已配置 |
| 测试覆盖率 | ✅ Core 层 services 约 75-95% |
| Core 层架构 | ✅ 框架无关，纯 TypeScript |
| StorageAdapter | ✅ IndexedDB + Memory 双实现 |

### 14.3 测试详情

- **测试文件**: 76 passed, 1 skipped
- **总测试数**: 1340 passed, 24 skipped
- **性能基准**: 1000 Block 创建 3.41ms，搜索 96ms
- **新增测试**: relationshipTypeService (17), templateService (10), performance (7)

***

*文档 v0.5 Phase 2 已完成，Phase 3 进行中（Grill-Me 架构评审已完成，9 项关键决策确认）。*
