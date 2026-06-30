# Phase 3 设计文档：Rust Core 重写 + Tauri 桌面化

> 版本：v1.0
> 日期：2026-06-30
> 状态：✅ 设计完成，待实施
> 依赖：Phase 2（Core Layer 抽离 + StorageAdapter + Lunr.js 搜索）

***

## 1. 概述

### 1.1 核心目标

Phase 3 的核心目标是将 Phase 2 的 TypeScript Core Layer 完全迁移到 Rust，同时实现 Tauri 桌面应用和 WASM Web 支持。

| 目标 | 描述 |
|------|------|
| **Core Layer 重写** | 7 个 TypeScript Service 全部用 Rust 重写，实现零依赖业务逻辑 |
| **存储层重构** | IndexedDB → SQLite（Rust 端 `rusqlite`，WASM 端 `sql.js`） |
| **属性系统统一** | 废弃 `block.properties` JSON 字段，所有属性统一使用独立 `properties` 表 |
| **全文搜索升级** | Lunr.js → SQLite FTS5，性能更好、集成更简单 |
| **桌面化** | Tauri 2.x 桌面应用，原生性能 |
| **WASM 编译** | 同一套 Rust Core 编译为桌面端和 Web WASM 版本 |
| **文件系统** | 引入 Markdown 文件读写（tauri-plugin-fs） |

### 1.2 架构决策（Grill-Me 评审确认）

| 决策项 | 确认方案 | 说明 |
|--------|----------|------|
| Core Layer 迁移 | 完全重写 | 7 个 Service 全部用 Rust 重写 |
| Web 端支持 | WASM 编译 | 同一套 Rust 代码编译为 WASM，同步完成 |
| SQLite 位置 | Rust 端 | 使用 `rusqlite`，通过 Tauri Command 桥接 |
| 事务方案 | 批处理 API | `execute_batch` 收集操作，单次 IPC 调用 |
| 存储抽象 | Trait 注入 | Repository trait 解耦业务逻辑与存储实现 |
| 属性系统 | 统一到 properties 表 | 废弃 `block.properties` |
| 搜索方案 | SQLite FTS5 | 替代 Lunr.js，支持中文分词 |
| Command 模式 | 混合模式 | 查询细粒度 + 写操作粗粒度 + 批处理 API |
| 项目结构 | 单仓库单项目 | Tauri `src-tauri/` + Rust workspace `crates/` |

***

## 2. 整体架构

### 2.1 分层架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           UI Layer (Vue 3)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐ │
│  │ Components   │  │ Pinia Stores │  │ Vue Router / Composables    │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┬───────────────┘ │
│         │                 │                          │                 │
│         ▼                 ▼                          ▼                 │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                     Bridge Layer                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐   │  │
│  │  │  Tauri Command Client / WASM Client (统一 API 接口)      │   │  │
│  │  └─────────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────┬──────────────────────────────────┘  │
│                                 │                                     │
├─────────────────────────────────┼─────────────────────────────────────┤
│                         Rust Core Layer                              │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐ │  │
│  │  │ Services │  │ Storage  │  │  Search  │  │  Types & Utils │ │  │
│  │  ├──────────┤  ├──────────┤  ├──────────┤  └────────────────┘ │  │
│  │  │ Block    │  │ SQLite   │  │ FTS5     │                      │  │
│  │  │ Link     │  │ (rusqlite)│  │ (icu)    │                      │  │
│  │  │ Page     │  │ Repository│  │          │                      │  │
│  │  │ Property │  │ Trait    │  │          │                      │  │
│  │  │ Tag      │  └──────────┘  └──────────┘                      │  │
│  │  │ RelType  │                                                   │  │
│  │  │ Template │                                                   │  │
│  │  └──────────┘                                                   │  │
│  └─────────────────────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────────────────┤
│                      Infrastructure Layer                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐ │
│  │ SQLite DB    │  │ Markdown IO  │  │ Assets (images, attachments) │ │
│  │ comind.db    │  │ (tauri-fs)   │  │                              │ │
│  └──────────────┘  └──────────────┘  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
用户操作 → Vue Component
    ↓
Pinia Store Action
    ↓
调用 Tauri Command / WASM Client
    ↓
Rust Core Service
    ↓
Repository Trait → SQLite Repository
    ↓
持久化到 SQLite
    ↓
返回结果 → Store 更新 → Component 重新渲染
```

***

## 3. 项目结构

```
comind/
├── src/                     # TS 前端代码（UI 层）
│   ├── components/          # Vue 组件（不变）
│   ├── composables/         # Vue composables（不变）
│   ├── stores/              # Pinia stores（重构后调用 Tauri Command）
│   │   ├── blocks.ts        # 调用 invoke('get_block'), invoke('save_block_tree')
│   │   ├── pages.ts         # 调用 invoke('get_page'), invoke('save_page')
│   │   ├── property.ts      # 调用 invoke('get_properties'), invoke('set_property')
│   │   └── ...
│   ├── core/                # TS Core（Phase 2 遗留，逐步废弃）
│   └── main.ts              # 入口文件（根据环境选择 Tauri 或 WASM 客户端）
├── src-tauri/               # Tauri Rust 代码
│   ├── src/
│   │   ├── main.rs          # Tauri 主入口 + 窗口配置
│   │   ├── commands.rs      # Tauri Command 定义（调用 comind-core）
│   │   └── state.rs         # 应用全局状态（数据库连接等）
│   ├── Cargo.toml           # Tauri 依赖配置
│   └── tauri.conf.json      # Tauri 配置
├── crates/                  # Rust crates（Workspace）
│   ├── comind-core/         # Core Layer（业务逻辑）
│   │   ├── src/
│   │   │   ├── services/    # 7 个 Service
│   │   │   ├── storage/     # Repository trait + SQLite 实现
│   │   │   ├── search/      # FTS5 搜索
│   │   │   ├── types/       # 类型定义
│   │   │   ├── utils/       # 工具函数
│   │   │   └── lib.rs       # 导出入口
│   │   └── Cargo.toml
│   └── comind-wasm/         # WASM 绑定
│       ├── src/
│       │   └── lib.rs       # wasm-bindgen 导出
│       └── Cargo.toml
├── Cargo.toml               # Workspace 根配置
├── package.json
├── vite.config.ts
└── tsconfig.json
```

***

## 4. SQLite Schema

### 4.1 表结构

```sql
-- Page 表
CREATE TABLE Page (
    id              TEXT PRIMARY KEY,
    block_id        TEXT,
    title           TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'normal',
    icon            TEXT,
    cover           TEXT,
    aliases         TEXT NOT NULL DEFAULT '[]',
    file_path       TEXT,
    children_count  INTEGER NOT NULL DEFAULT 0,
    word_count      INTEGER NOT NULL DEFAULT 0,
    deleted         INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    FOREIGN KEY (block_id) REFERENCES Block(id)
);

-- Block 表
CREATE TABLE Block (
    id              TEXT PRIMARY KEY,
    page_id         TEXT NOT NULL,
    parent_id       TEXT,
    pos             INTEGER NOT NULL DEFAULT 1000,
    content         TEXT NOT NULL DEFAULT '',
    format          TEXT NOT NULL DEFAULT '{}',
    type            TEXT NOT NULL DEFAULT 'bullet',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    FOREIGN KEY (page_id) REFERENCES Page(id)
);

-- Link 表
CREATE TABLE Link (
    id              TEXT PRIMARY KEY,
    source_block_id TEXT NOT NULL,
    target_page_id  TEXT NOT NULL,
    display_text    TEXT NOT NULL,
    relationship_type TEXT,
    created_at      INTEGER NOT NULL,
    FOREIGN KEY (source_block_id) REFERENCES Block(id),
    FOREIGN KEY (target_page_id) REFERENCES Page(id)
);

-- Property 表（统一属性存储）
CREATE TABLE Property (
    id              TEXT PRIMARY KEY,
    block_id        TEXT NOT NULL,
    key             TEXT NOT NULL,
    value           TEXT NOT NULL,
    type            TEXT NOT NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_hidden       INTEGER NOT NULL DEFAULT 0,
    is_deleted      INTEGER NOT NULL DEFAULT 0,
    schema_version  INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    UNIQUE(block_id, key),
    FOREIGN KEY (block_id) REFERENCES Block(id)
);

-- RelationshipType 表
CREATE TABLE RelationshipType (
    id              TEXT PRIMARY KEY,
    type            TEXT NOT NULL,
    inverse         TEXT,
    label           TEXT NOT NULL,
    inverse_label   TEXT NOT NULL,
    color           TEXT NOT NULL,
    order           INTEGER NOT NULL DEFAULT 0,
    strength        TEXT NOT NULL DEFAULT 'medium',
    deleted         INTEGER NOT NULL DEFAULT 0,
    builtin         INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

-- UserTemplate 表
CREATE TABLE UserTemplate (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,
    content         TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

-- FTS5 搜索表
CREATE VIRTUAL TABLE SearchIndex USING fts5(
    block_id,
    content,
    title,
    tokenize = 'icu zh'
);
```

### 4.2 索引

```sql
CREATE INDEX idx_page_blockId    ON Page(block_id);
CREATE INDEX idx_page_type       ON Page(type);
CREATE INDEX idx_page_updatedAt  ON Page(updated_at);
CREATE INDEX idx_block_pageId    ON Block(page_id);
CREATE INDEX idx_block_parentId  ON Block(parent_id);
CREATE INDEX idx_block_pos       ON Block(pos);
CREATE INDEX idx_link_target     ON Link(target_page_id);
CREATE INDEX idx_link_source     ON Link(source_block_id);
CREATE INDEX idx_property_blockId ON Property(block_id);
CREATE INDEX idx_property_key    ON Property(key);
```

### 4.3 关键变更

| 变更项 | Phase 2 | Phase 3 |
|--------|---------|---------|
| Block 排序字段 | `leftId` | `pos` |
| `block.properties` | JSON 字段 | **已废弃**，统一使用 Property 表 |
| RelationshipType.strength | 不存在 | 新增 `'strong' \| 'medium' \| 'weak'` |
| 搜索方案 | Lunr.js | SQLite FTS5 + ICU tokenizer |

***

## 5. Tauri Command 设计（混合模式）

### 5.1 细粒度查询命令

```rust
// 获取单个 Block
#[tauri::command]
async fn get_block(db: State<'_, DatabaseConnection>, block_id: &str) -> Result<Block, String>

// 获取页面的所有 Block
#[tauri::command]
async fn get_blocks_by_page(db: State<'_, DatabaseConnection>, page_id: &str) -> Result<Vec<Block>, String>

// 获取单个 Page
#[tauri::command]
async fn get_page(db: State<'_, DatabaseConnection>, page_id: &str) -> Result<Page, String>

// 获取所有 Page
#[tauri::command]
async fn get_all_pages(db: State<'_, DatabaseConnection>) -> Result<Vec<Page>, String>

// 获取反向链接
#[tauri::command]
async fn get_backlinks(db: State<'_, DatabaseConnection>, page_id: &str) -> Result<Vec<Link>, String>

// 全文搜索
#[tauri::command]
async fn search(db: State<'_, DatabaseConnection>, query: &str) -> Result<Vec<SearchResult>, String>

// 获取属性
#[tauri::command]
async fn get_properties(db: State<'_, DatabaseConnection>, block_id: &str) -> Result<Vec<Property>, String>

// 获取关系类型列表
#[tauri::command]
async fn get_relationship_types(db: State<'_, DatabaseConnection>) -> Result<Vec<RelationshipType>, String>
```

### 5.2 粗粒度写操作命令

```rust
// 保存整个 Block 树（批量写入）
#[tauri::command]
async fn save_block_tree(db: State<'_, DatabaseConnection>, blocks: Vec<BlockUpdate>) -> Result<Vec<Block>, String>

// 保存 Page
#[tauri::command]
async fn save_page(db: State<'_, DatabaseConnection>, page: PageUpdate) -> Result<Page, String>

// 删除 Page（级联删除 Block、Link、Property）
#[tauri::command]
async fn delete_page_cascade(db: State<'_, DatabaseConnection>, page_id: &str) -> Result<(), String>

// 设置属性
#[tauri::command]
async fn set_property(db: State<'_, DatabaseConnection>, block_id: &str, key: &str, value: &str, type_: &str) -> Result<Property, String>

// 删除属性
#[tauri::command]
async fn delete_property(db: State<'_, DatabaseConnection>, block_id: &str, key: &str) -> Result<(), String>
```

### 5.3 批处理 API（事务）

```rust
#[tauri::command]
async fn execute_batch(
    db: State<'_, DatabaseConnection>,
    operations: Vec<BatchOperation>
) -> Result<Vec<BatchResult>, String>

// BatchOperation 结构：
// { entity: "block" | "page" | "link" | "property" | "relationship_type" | "template",
//   action: "create" | "update" | "delete",
//   params: {...} }
```

***

## 6. WASM 编译设计

### 6.1 架构

```
┌────────────────────────────────────────────────────────────────┐
│                    Web 端 (浏览器)                              │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Vue 3 UI Layer                                          │ │
│  │  ├── components/                                         │ │
│  │  ├── stores/ (调用 comind-wasm)                          │ │
│  │  └── main.ts                                             │ │
│  └──────────────────────┬───────────────────────────────────┘ │
│                         │                                     │
│                         ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  comind-wasm (wasm-bindgen)                              │ │
│  │  ├── get_block(block_id: string) → Promise<Block>       │ │
│  │  ├── save_block_tree(blocks: Block[]) → Promise<Block[]>│ │
│  │  ├── search(query: string) → Promise<SearchResult[]>    │ │
│  │  └── ... (与 Tauri Command 一一对应)                      │ │
│  └──────────────────────┬───────────────────────────────────┘ │
│                         │                                     │
│                         ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  comind-core (编译为 WASM)                               │ │
│  │  ├── services/ (7 个 Service)                            │ │
│  │  ├── storage/ (sql.js 实现)                              │ │
│  │  └── search/ (FTS5 via sql.js)                           │ │
│  └──────────────────────────────────────────────────────────┘ │
│                         │                                     │
│                         ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  sql.js (SQLite WASM 编译)                               │ │
│  │  └── IndexedDB 持久化 (via Emscripten FS)                │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### 6.2 关键实现细节

| 组件 | 实现方式 | 说明 |
|------|----------|------|
| WASM 导出 | `wasm-bindgen` | 将 Rust 函数导出为 JS 可调用的 Promise API |
| 存储后端 | `sql.js` | SQLite 的 WASM 编译版本 |
| 数据持久化 | Emscripten FS + IndexedDB | sql.js 文件系统通过 IndexedDB 持久化 |
| 异步桥接 | `wasm_bindgen_futures` | 将 Rust async 函数转换为 JS Promise |
| 类型定义 | 自动生成 `.d.ts` | wasm-bindgen 自动生成 TypeScript 类型 |

### 6.3 编译流程

```bash
# 构建 WASM 包
cd crates/comind-wasm
wasm-pack build --target web --out-dir ../../comind/src/wasm

# 前端集成（vite.config.ts）
import wasm from "vite-plugin-wasm"
import topLevelAwait from "vite-plugin-top-level-await"

export default defineConfig({
  plugins: [vue(), wasm(), topLevelAwait()]
})
```

***

## 7. Markdown 文件系统设计

### 7.1 文件结构

```
工作区/
├── pages/                    # 页面 Markdown 文件目录
│   ├── 数据模型设计_20260416T103000.md
│   ├── 笔记工具_20260417T080000.md
│   └── ...
├── assets/                   # 资产文件目录
│   ├── images/
│   └── attachments/
└── comind.db                 # SQLite 数据库
```

### 7.2 文件命名规则

```
{清理后的页面标题}_{创建时间戳}.md
```

- 清理规则：移除 `/ \ : * ? " < > |`，合并连续空格，去除前后空格
- 时间戳格式：`YYYYMMDD'T'HHMMSS`
- 最大长度：128 字符（超出时截断）

### 7.3 文件格式（MD2）

```markdown
<!-- comind:page:{page_id} -->
<!-- comind:title:{页面标题} -->
<!-- comind:type:normal -->
<!-- comind:created_at:2026-06-30T10:30:00Z -->
<!-- comind:updated_at:2026-06-30T11:00:00Z -->

## Block 1 内容
status:: Done
这是 Block 1 的正文

### Block 1.1 内容
tags:: [设计, 数据]

## Block 2 内容
参考 [[存储规范]]
```

**关键设计：**
- 使用 HTML 注释存储元数据（`comind:key:value`），保持 Markdown 可读性
- Block 层级使用 Markdown 标题级别表示（`##` = 根 Block，`###` = 缩进 1）
- 属性行使用 `key:: value` 语法
- 链接使用 `[[页面名]]` 语法

### 7.4 导入/导出流程

**导出：**
```
SQLite → 遍历 Page + Block 树 → 生成 Markdown 文件 → 写入 pages/ 目录
```

**导入：**
```
扫描 pages/ 目录 → 解析 Markdown 文件 → 提取元数据和 Block 树 → 写入 SQLite
```

***

## 8. Sprint 规划（方案 A：完全并行）

### Sprint 1：项目初始化 + 基础架构

| 任务 | 描述 | 优先级 |
|------|------|--------|
| T3.1.1 | 安装 Tauri CLI，初始化 `src-tauri/` 项目结构 | P0 |
| T3.1.2 | 创建 Rust workspace，`crates/comind-core/` 基础结构 | P0 |
| T3.1.3 | 定义 Core 层类型（Block、Page、Link、Tag、Property、RelationshipType、Template） | P0 |
| T3.1.4 | 定义 Repository trait（7 个） | P0 |
| T3.1.5 | 配置 tauri.conf.json、Cargo.toml、capabilities | P1 |
| T3.1.6 | 创建 `crates/comind-wasm/` 基础结构 | P1 |

### Sprint 2：SQLite 存储层 + Service 重写

| 任务 | 描述 | 优先级 |
|------|------|--------|
| T3.2.1 | 实现 SQLite Repository（rusqlite） | P0 |
| T3.2.2 | 实现 FTS5 搜索索引同步（Block/Page CRUD 时自动更新索引） | P0 |
| T3.2.3 | 实现 BlockService（CRUD + Gap Sort + 树形操作） | P0 |
| T3.2.4 | 实现 LinkService（双向链接管理） | P0 |
| T3.2.5 | 实现 PageService（页面管理） | P0 |
| T3.2.6 | 实现 PropertyService（属性解析 + CRUD） | P1 |
| T3.2.7 | 实现 TagService（标签解析） | P1 |
| T3.2.8 | 实现 RelationshipTypeService（关系类型管理） | P1 |
| T3.2.9 | 实现 TemplateService（模板管理） | P1 |

### Sprint 3：Tauri Command + WASM 编译

| 任务 | 描述 | 优先级 |
|------|------|--------|
| T3.3.1 | 定义 Tauri Command（混合模式） | P0 |
| T3.3.2 | 实现 WASM 绑定（comind-wasm） | P0 |
| T3.3.3 | 实现 WASM 存储后端（sql.js） | P0 |
| T3.3.4 | WASM 编译配置（wasm-pack） | P1 |

### Sprint 4：TS 重构 + 属性系统统一

| 任务 | 描述 | 优先级 |
|------|------|--------|
| T3.4.1 | 重构 Pinia stores，调用 Tauri Command | P0 |
| T3.4.2 | 移除 `block.properties`，迁移到 `properties` 表 | P1 |
| T3.4.3 | Web 端集成 WASM（Vite 插件） | P0 |
| T3.4.4 | 性能基准测试（对比 TS Core） | P1 |

### Sprint 5：Markdown 文件系统 + 构建打包

| 任务 | 描述 | 优先级 |
|------|------|--------|
| T3.5.1 | Page 导出为 Markdown | P1 |
| T3.5.2 | Markdown 文件导入为 Page | P1 |
| T3.5.3 | 文件监听（外部编辑器修改同步） | P2 |
| T3.5.4 | Windows 打包（.msi/.exe） | P0 |
| T3.5.5 | macOS 打包（.dmg） | P1 |
| T3.5.6 | 自动更新配置 | P1 |

### Sprint 6：测试验证 + 文档更新

| 任务 | 描述 | 优先级 |
|------|------|--------|
| T3.6.1 | Rust 单元测试（核心逻辑） | P0 |
| T3.6.2 | WASM 测试（wasm-bindgen-test） | P1 |
| T3.6.3 | E2E 测试验证（Playwright） | P0 |
| T3.6.4 | 更新技术文档 | P1 |

***

## 9. 测试策略（渐进式）

| 测试类型 | 实现时机 | 覆盖范围 |
|----------|----------|----------|
| Rust 单元测试 | 每个 Service 实现完成后 | 核心业务逻辑（CRUD、Gap Sort、解析器） |
| WASM 测试 | Sprint 3 完成后 | WASM 绑定正确性、存储后端兼容性 |
| 性能基准测试 | Sprint 4 完成后 | 对比 TS Core，确保性能不退化 |
| E2E 测试 | Sprint 6 | 关键用户流程（创建 Page、编辑 Block、搜索、导航） |

***

## 10. 技术栈

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

***

## 11. 关键约束

| 约束 | 说明 |
|------|------|
| Core Layer 完全迁移 | Phase 2 的 7 个 TS Service 全部用 Rust 重写，业务逻辑零框架依赖 |
| 存储层解耦 | 通过 Repository trait 注入，支持 SQLite（桌面）和 sql.js（WASM）双实现 |
| 事务原子性 | 写操作通过批处理 API 保证跨实体事务的原子性 |
| 属性系统统一 | 所有属性统一使用 `properties` 表，废弃 `block.properties` |
| Web 兼容 | 同一套 Rust Core 通过 WASM 编译支持 Web 端，同步完成 |
| 测试策略 | Rust 单元测试 + E2E 测试（Playwright），验证 Core 层迁移正确性 |

***

## 12. 相关文档

| 文档 | 路径 |
|------|------|
| 项目总规范 | [docs/1-overview/SPEC.md](../../1-overview/SPEC.md) |
| Core Layer 架构设计 | [docs/2-architecture/core-layer.md](../../2-architecture/core-layer.md) |
| 存储层规范 | [docs/2-architecture/storage-spec.md](../../2-architecture/storage-spec.md) |
| Phase 3.5 规范 | [docs/2-architecture/phase-3.5-spec.md](../../2-architecture/phase-3.5-spec.md) |
| StorageAdapter 接口规范 | [docs/2-architecture/storage-adapter.md](../../2-architecture/storage-adapter.md) |

***

*文档 v1.0，2026-06-30 设计完成。*