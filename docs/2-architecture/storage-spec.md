# 存储格式规范

> 版本：v0.10
> 日期：2026-08-27
> 状态：✅ 已实现（comind-core SQLite 核心；Web 落 IndexedDB / Desktop 落原生 SQLite）
> 变更：v0.10 校正存储架构——结构化数据已由 comind-core（SQLite）统一管理，Dexie 仅保留 assets 表；v0.9 新增 version 和 deleted_at 字段，支持 LWW 同步和软删除

***

## 0. Phase 适用说明

| 构建目标 | 存储引擎 | 物理位置 | 说明 |
| ------- | ------- | ------- | ---- |
| **Web** | SQLite（`@wasm/comind_wasm` / sql.js WASM） | IndexedDB（整个 `.sqlite` 文件） | 主存储；`getWorkspacePath()` 在非 Tauri 环境返回 `'Web: IndexedDB'` |
| **Desktop（Tauri）** | SQLite（`comind-core` 原生） | 磁盘 SQLite 文件 | 主存储；经 Tauri 命令访问，不走 IndexedDB |
| **资产（Web）** | IndexedDB（Dexie） | IndexedDB（`comind-assets` 库 `assets` 表） | 仅二进制 blob，见 `src/utils/asset.ts` |
| **资产（Desktop）** | — | 磁盘 `workspace/assets/` 目录（文件 + `assets.json` 清单） | 与 `sqlite/`、`markdown/` 并列；经 `save_asset_file` / `read_asset_file` / `delete_asset_file` Tauri 命令访问 |

> 逻辑表结构（Block / Page / Link / Property / …）统一见本文档 §4 的 SQLite schema，由 `comind-core` 同时服务 Web 与 Desktop，保证两端 schema 一致。Markdown 文件（§3）目前仅作为 Desktop 端的导出/导入边车通道（`export_to_markdown` / `import_from_markdown` Tauri 命令），并非主存储。

### 0.1 当前实现：comind-core（SQLite）— 已实现

**结构化数据（blocks / pages / links / properties / templates / relationshipTypes / notifications / dateRefs / savedFilters / screenViews 等）统一由 Rust/WASM 核心 `comind-core` 管理，存储引擎为 SQLite。** 前端不直接接触数据库，所有读写经 `src/wasm/client.ts` 的 `CoreClient` 接口，按运行环境分流：

- **Web 构建**：`WasmClientAdapter` → `@wasm/comind_wasm`（由 `crates/comind-core` 编译）→ **sql.js（WASM 版 SQLite）**，持久化后端为 **IndexedDB**（整个 `.sqlite` 数据库文件落盘）。`getWorkspacePath()` 在非 Tauri 环境返回 `'Web: IndexedDB'`。
- **桌面构建（Tauri）**：`TauriClient` → Tauri 命令（`invoke('save_page')` 等）→ 原生 **SQLite 文件**（磁盘），不走 IndexedDB。

逻辑表结构即本文档 §4 的 SQLite schema（`Block.format` 等 `TEXT` 列以 JSON 字符串存储，详见 §4.1），由 `comind-core` 同时服务 Web / Desktop 两端，保证 schema 一致。

> ⚠️ 旧实现 `ComindDB`（Dexie，`blocks/pages/links/...` 表）已无活跃引用，属历史代码。新的结构化数据读写请勿再依赖 Dexie。

**Dexie 仅残留用于资产存储（Web 端）**：`src/utils/asset.ts` 的 Web 实现仍用 Dexie（`comind-assets` 库）的 `assets` 表存图片等二进制 blob，与结构化数据解耦。Desktop（Tauri）端资产不走 IndexedDB，落盘到 `workspace/assets/` 目录（与 `sqlite/`、`markdown/` 并列），前端 `assetStorage` 按 `isTauriEnvironment()` 自动分流。

以下 Record 类型即对应 §4 SQLite 表的逻辑结构（运行时对象，由 comind-core 持久化为数据库行）：

**Record 类型定义：**

```typescript
// PageRecord（comind/src/types/page.ts）
export interface PageRecord {
  id: string
  blockId: string | null
  title: string
  type: 'normal' | 'journal'
  icon: string | null
  cover: string | null
  aliases: string            // JSON 数组字符串
  filePath: string | null
  childrenCount: number
  wordCount: number
  deleted: number            // 0 | 1（软删除标记）
  createdAt: number          // 毫秒时间戳
  updatedAt: number
}

// BlockRecord（comind/src/types/block.ts）
export interface BlockRecord {
  id: string
  pageId: string
  parentId: string | null
  pos: number                // Gap 排序位置（初始间隔 1000）
  content: string
  format: string             // JSON 字符串
  type: string               // 'bullet' | 'property' | 'query' | 'embed'
  createdAt: number
  updatedAt: number
}

// LinkRecord（comind/src/types/link.ts）
export interface LinkRecord {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  relationshipType: string | null  // 关系类型（v0.6+ 新增）
  createdAt: number
}

// PropertyRecord（comind/src/types/property.ts）
export interface PropertyRecord {
  id: string
  blockId: string
  key: string
  value: string              // JSON 序列化
  type: string
  sortOrder: number
  isHidden: number           // 0 | 1（IndexedDB 不支持 boolean）
  isDeleted: number          // 0 | 1
  schemaVersion: number
  createdAt: number
  updatedAt: number
}
```

**架构修正（v0.10）：**

本文档早期版本将「IndexedDB + Dexie」描述为当前主存储（Phase 1）。**该描述已过时**：结构化数据现由 `comind-core`（SQLite）统一托管，Dexie 仅用于 `assets` 表。下表中的「Dexie 版本」对比不再适用于主存储，仅作历史参考：

| 变更项 | 旧（Dexie / IndexedDB 时代） | 当前（comind-core / SQLite） |
|--------|------|-------------|
| 主存储引擎 | Dexie（IndexedDB） | SQLite（Web: sql.js / Desktop: 原生） |
| relationshipTypes 表 | — | 已实现（见 §4） |
| templates 表 | — | 已实现（见 §4） |
| Page.deleted 字段 | — | 已实现（见 §4） |
| Link.relationshipType 字段 | 已存在 | 继续保留（见 §4） |
| assets 存储 | Dexie `assets` 表 | Web：Dexie `assets` 表（唯一仍用 Dexie 之处）；Desktop：`workspace/assets/` 目录 |

**存储演进路径（历史 + 当前）：**

1. （历史）早期实现 `IndexedDBAdapter`（基于 Dexie），结构化数据直接存 IndexedDB。
2. （当前✅）`comind-core` 统一以 SQLite 为存储引擎：Web 用 sql.js（WASM）持久化到 IndexedDB，Desktop 用 Tauri 原生 SQLite；前端经 `src/wasm/client.ts` 的 `CoreClient` 接口访问。
3. （当前✅）Web 端 Dexie 仅保留 `assets` 表（`src/utils/asset.ts`）存二进制 blob；Desktop 端资产改为落盘 `workspace/assets/` 目录（与 `sqlite/`、`markdown/` 并列），`assetStorage` 按 Tauri 环境自动分流。
4. （规划）Markdown 文件作为可移植边车通道：Desktop 端 `export_to_markdown` / `import_from_markdown`，与 §4 SQLite 主存储双向同步。

***

## 1. 概述

采用 **SQLite 为唯一真相源（comind-core）** 的存储模式，Markdown 文件目前仅作为 Desktop 端的导出/导入边车通道（见 §0.1）。

```
工作区/
├── pages/                    # 页面 Markdown 文件目录
│   ├── 数据模型设计_20260416T103000.md
│   ├── 笔记工具_20260417T080000.md
│   └── ...
│
├── assets/                   # 资产文件目录
│   ├── images/
│   │   └── 截图_20260416.png
│   └── attachments/
│
└── comind.db                 # SQLite 索引数据库
```

**职责划分：**

| 组件                      | 职责                         |
| ----------------------- | -------------------------- |
| Markdown 文件（`pages/`）   | 持久化存储，用户可直接读写，支持 Git 版本控制  |
| SQLite 数据库（`comind.db`） | 全文索引、双向链接、属性查询、Block 树结构缓存 |
| assets 目录               | 图片、附件等二进制资源统一存储            |

**读写关系：**

```
用户编辑 Markdown 文件
    ↓ 解析
写入/更新 SQLite 索引（内存树 + Link 表）
    ↓ 持久化
下次启动 → 扫描 Markdown 文件 → 对齐 SQLite → 重建内存状态
```

***

## 2. 文件命名规则

### 2.1 命名格式

```
{清理后的页面标题}_{创建时间戳}.md
```

- **清理规则**：标题中以下字符被移除或替换
  - `/ \ : * ? " < > |` → 全部移除
  - 连续空格 → 合并为一个空格
  - 前后空格 → 去除
  - 标题最大长度：128 字符（超出时截断）
- **创建时间戳格式**：`YYYYMMDD'T'HHMMSS`（例如 `20260416T103000`）

**示例：**

| 页面标题               | 文件名                                  |
| ------------------ | ------------------------------------ |
| `数据模型设计`           | `数据模型设计_20260416T103000.md`          |
| `笔记/工具调研`          | `笔记工具调研_20260416T103000.md`          |
| `What's new?`      | `Whats new_20260416T103000.md`       |
| `Project: Phase 1` | `Project Phase 1_20260416T103000.md` |

### 2.2 标题冲突

同一目录下不允许标题 + 时间戳完全相同的文件。若用户创建同名 Page：

- 第二个 Page 使用不同时间戳（精确到秒），可区分
- 若同一秒内创建两个同名 Page，第二条时间戳进位到下一秒

***

## 3. Markdown 文件格式

### 3.1 文件结构

```
[文件头：Page Properties]
---
title:: 页面标题
type:: normal
created-at:: 2026-04-16T10:30:00Z
updated-at:: 2026-04-16T11:00:00Z
alias:: [别名1, 别名2]
---

[正文 Block 树：使用 Markdown 标题级别表示层级]
```

**说明：**

- Page Properties 写在文件头部，以 `---` 分隔。遇第二个 `---` 或空行结束
- Properties 格式：`key:: value`，和 Block property 一致
- 正文部分使用 `#`（H1）、`##`（H2）等标题级别表示 Block 的嵌套层级
- 同一文件内只包含一个 Page 的完整 Block 树

### 3.2 Block 树与 Markdown 标题的映射

```
Block 树                           Markdown 文件内容
─────────────────────────────────────────────────────────
Page（独立实体）                # 页面标题                    ← H1 = 页面标题
├── 根 Block（parentId = null）  ## 根 Block 内容             ← H2 = 根 Block
│   ├── Block A（level=1）        ### Block A 内容            ← ### = 缩进 1
│   │   ├── Block B（level=2）     #### Block B 内容           ← #### = 缩进 2
│   │   └── Block C（level=2）     #### Block C 内容
│   └── Block D（level=1）        ### Block D 内容
```

**映射规则：**

| Block 缩进层级 | Markdown 标题级别   | 说明        |
| ---------- | --------------- | --------- |
| 根 Block    | H2（`##`）        | 页面内容的根节点 |
| 1          | H3（`###`）       | <br />    |
| 2          | H4（`####`）      | <br />    |
| 3+         | H5+（`#####` 及以上） | 深层缩进      |
| 无标题 Block  | 普通段落（无 `#` 前缀）  | 仅正文，无子节点时 |

**Block.content 的边界规则：**

- Block = 标题行 + 后续正文，直到下一个同级或更高级标题出现
- 标题行本身（去除 `#` 后的文字）不计入 Block.content
- 无子节点的 Block：标题行 + 正文段落到下一个同级标题为止

**示例：**

```markdown
# 数据模型设计                    ← Page 标题
## 根 Block 内容                  ← 根 Block（H2）：content = "根 Block 内容"
这是根 Block 的后续正文
### Block A 内容                 ← Block A（H3）：content = "Block A 内容"
Block A 的正文段落
### Block B 内容                 ← Block B（H3）：content = "Block B 内容"
```

解析后各 Block.content：

- 根 Block：`"这是根 Block 的后续正文"`
- Block A：`"Block A 的正文段落"`
- Block B：`""`

### 3.3 多行 Block

Block 内容跨越多行时，使用 Markdown 引用块（`>`）或缩进段落：

```markdown
## 根 Block 内容（第一行）
这是根 Block 的第二行内容
根 Block 的第三行

### 子 Block A
```

### 3.4 Property 行与正文的区分

- Property 行：在 `---` 分隔区域内的 `key:: value` 行
- 正文 Property 行：在 `---` 区域外的 `key:: value` 行，嵌入在 Block 内容中

```markdown
---
title:: 页面标题
type:: normal
---

## 根 Block
status:: Done
这是根 Block 的正文

### Block A
tags:: [设计, 数据]
```

解析时：

- `---` 之间的行 → Page Properties
- Block 内容中的 `key:: value` → 该 Block 的 properties

***

## 4. SQLite 数据库结构（comind-core 当前实现）

> 本节 schema 即 `comind-core`（`crates/comind-core/src/storage/sqlite.rs` 与 `sqljs.rs`）实际使用的逻辑表结构，同时服务 Web（sql.js）与 Desktop（原生 SQLite）。`Block.format` 等 `TEXT` 列以 JSON 字符串存储（运行时为对象，写入时 `JSON.stringify`、读取时 `JSON.parse`，见 `src/stores/blocks.ts`）。

### 4.1 表结构

```sql
CREATE TABLE Page (
    id              TEXT PRIMARY KEY,     -- UUID v4
    blockId         TEXT,                 -- 根 Block ID
    title           TEXT NOT NULL UNIQUE, -- 唯一（comind-core 强制 UNIQUE）
    type            TEXT NOT NULL DEFAULT 'normal',  -- 'normal' | 'journal' | 'ideas'
    icon            TEXT,
    cover           TEXT,
    aliases         TEXT NOT NULL DEFAULT '[]',  -- JSON 数组字符串
    filePath        TEXT,
    childrenCount   INTEGER NOT NULL DEFAULT 0,
    wordCount       INTEGER NOT NULL DEFAULT 0,
    deleted         INTEGER NOT NULL DEFAULT 0,  -- 软删除标记（0 | 1）
    createdAt       INTEGER NOT NULL,     -- 毫秒时间戳
    updatedAt       INTEGER NOT NULL,     -- 毫秒时间戳
    version         INTEGER NOT NULL DEFAULT 0,  -- 单调递增版本号，用于 LWW 同步
    deleted_at      INTEGER,              -- 软删除时间戳（毫秒），NULL = 未删除
    FOREIGN KEY (blockId) REFERENCES Block(id)
);

CREATE TABLE Block (
    id              TEXT PRIMARY KEY,     -- UUID v4
    pageId          TEXT NOT NULL,        -- 所属页面 ID
    parentId        TEXT,                 -- 父 Block ID
    pos             INTEGER NOT NULL DEFAULT 1000,  -- Gap 排序位置
    content         TEXT NOT NULL DEFAULT '',
    format          TEXT NOT NULL DEFAULT '{}',  -- JSON 字符串（运行时为 Record<string, any>）
    type            TEXT NOT NULL DEFAULT 'bullet',  -- 'bullet' | 'property' | 'query' | 'embed' | 'code' | 'image'
    createdAt       INTEGER NOT NULL,     -- 毫秒时间戳
    updatedAt       INTEGER NOT NULL,     -- 毫秒时间戳
    version         INTEGER NOT NULL DEFAULT 0,  -- 单调递增版本号，用于 LWW 同步
    deleted_at      INTEGER,              -- 软删除时间戳（毫秒），NULL = 未删除
    FOREIGN KEY (pageId) REFERENCES Page(id)
);
-- 注：Block 的「属性」不存于 Block 表，而存于独立的 Property 表（见下）。

CREATE TABLE Link (
    id              TEXT PRIMARY KEY,     -- UUID v4
    sourceBlockId   TEXT NOT NULL,        -- 链接来源 Block
    targetPageId    TEXT NOT NULL,        -- 链接目标 Page
    displayText     TEXT NOT NULL,
    relationship_type TEXT,               -- 关系类型（v0.6+ 新增）
    createdAt       INTEGER NOT NULL,     -- 毫秒时间戳
    updatedAt       INTEGER NOT NULL,     -- 毫秒时间戳
    version         INTEGER NOT NULL DEFAULT 0,  -- 单调递增版本号，用于 LWW 同步
    deleted_at      INTEGER,              -- 软删除时间戳（毫秒），NULL = 未删除
    FOREIGN KEY (sourceBlockId) REFERENCES Block(id),
    FOREIGN KEY (targetPageId) REFERENCES Page(id)
);

CREATE TABLE Property (
    id              TEXT PRIMARY KEY,     -- UUID v4
    blockId         TEXT NOT NULL,        -- 所属 Block
    key             TEXT NOT NULL,        -- 属性名
    value           TEXT NOT NULL,        -- JSON 序列化
    type            TEXT NOT NULL,        -- 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'array' | 'page'
    sortOrder       INTEGER NOT NULL DEFAULT 0,
    isHidden        INTEGER NOT NULL DEFAULT 0,   -- 0 | 1
    isDeleted       INTEGER NOT NULL DEFAULT 0,   -- 0 | 1
    schemaVersion   INTEGER NOT NULL DEFAULT 1,
    createdAt       INTEGER NOT NULL,     -- 毫秒时间戳
    updatedAt       INTEGER NOT NULL,     -- 毫秒时间戳
    version         INTEGER NOT NULL DEFAULT 0,  -- 单调递增版本号，用于 LWW 同步
    deleted_at      INTEGER,              -- 软删除时间戳（毫秒），NULL = 未删除
    UNIQUE(blockId, key),
    FOREIGN KEY (blockId) REFERENCES Block(id)
);

-- 常用索引
CREATE INDEX idx_page_blockId    ON Page(blockId);
CREATE INDEX idx_page_type       ON Page(type);
CREATE INDEX idx_page_updatedAt  ON Page(updatedAt);
CREATE INDEX idx_page_version    ON Page(version);
CREATE INDEX idx_page_deletedAt  ON Page(deleted_at);
CREATE INDEX idx_block_pageId    ON Block(pageId);
CREATE INDEX idx_block_parentId  ON Block(parentId);
CREATE INDEX idx_block_pos       ON Block(pos);
CREATE INDEX idx_block_version   ON Block(version);
CREATE INDEX idx_block_deletedAt ON Block(deleted_at);
CREATE INDEX idx_link_target     ON Link(targetPageId);
CREATE INDEX idx_link_source     ON Link(sourceBlockId);
CREATE INDEX idx_link_version    ON Link(version);
CREATE INDEX idx_link_deletedAt  ON Link(deleted_at);
CREATE INDEX idx_property_blockId ON Property(blockId);
CREATE INDEX idx_property_key    ON Property(key);
CREATE INDEX idx_property_type   ON Property(type);
CREATE INDEX idx_property_version ON Property(version);
CREATE INDEX idx_property_deletedAt ON Property(deleted_at);
```

**与 v0.7 SQLite 的主要差异：**

| 变更项 | v0.7 | v0.9 |
|--------|------|------|
| Page.version | 不存在 | 已实现 |
| Page.deleted_at | 不存在 | 已实现 |
| Block.version | 不存在 | 已实现 |
| Block.deleted_at | 不存在 | 已实现 |
| Link.version | 不存在 | 已实现 |
| Link.deleted_at | 不存在 | 已实现 |
| Property.version | 不存在 | 已实现 |
| Property.deleted_at | 不存在 | 已实现 |

**与 v0.6 SQLite 的主要差异：**

| 变更项 | v0.6 | v0.7 |
|--------|------|------|
| Block 排序字段 | `leftId` | `pos` |
| Property 表 | 不存在 | 已定义 |
| 时间戳格式 | ISO 8601 TEXT | INTEGER（毫秒） |
| Page.aliases | 可 NULL | NOT NULL DEFAULT '[]' |
| Link.type 字段 | 存在 | 移除（由 targetPageId 是否 NULL 推断） |

### 4.2 Link 表说明

- `[[页面名]]` → 写入 Link 表，`targetPageId` 为目标 Page 的 ID
- 外部 URL（如 `https://example.com`）→ 暂不写入 Link 表，后续版本支持
- 内部链接解析时自动创建目标 Page（如不存在）

### 4.3 Property 表说明

- 详见 `../3-features/property-spec.md`
- Phase 2/3 引入 Property 表后，`Block.properties` JSON 字段降级为只读缓存
- 同步策略：写入时双写，读取时优先从 `Block.properties` 解析，不一致时以 Property 表为准

***

## 5. 日志（Journal）规范

### 5.1 设计原则

日志遵循"**一个条目 = 一个 Page = 一个文件**"的原则，与普通 Page 完全一致。

### 5.2 文件命名

日志文件以日期为标题：

```
2026-04-16_20260416T000000.md      ← 2026年4月16日的日志页
2026-04-17_20260417T000000.md      ← 2026年4月17日的日志页
```

日志文件同样存于 `pages/` 目录，与普通 Page 共用同一命名空间和文件命名规则。

### 5.3 日志文件的 Page 属性

日志 Page 使用 `type: 'journal'` 标识：

```markdown
---
title:: 2026-04-16
type:: journal
created-at:: 2026-04-16T00:00:00Z
updated-at:: 2026-04-16T18:00:00Z
---

## 上午
status:: Doing
开始数据模型设计

## 下午
status:: Done
完成文档初稿
```

| 属性     | 值            | 说明               |
| ------ | ------------ | ---------------- |
| `title` | `YYYY-MM-DD` | 日志标题，默认为日期       |
| `type`  | `journal`    | 标识为日志类型          |

### 5.4 日志索引页（待实现）

日志列表（如"4月所有日志"）是一个普通的 Page，通过属性筛选或链接聚合展示。

***

## 6. 资产文件规范

### 6.1 目录结构

```
assets/
├── images/
│   ├── 截图_20260416.png
│   └── 图表_20260417.jpg
├── attachments/
│   └── 文档_20260416.pdf
└── exports/                   # 导出文件（可选）
```

### 6.2 文件命名

```
{描述}_{时间戳}.{扩展名}
```

- 图片：`assets/images/截图_20260416T103000.png`
- 附件：`assets/attachments/文档_20260416T103000.pdf`

### 6.3 Markdown 中的引用

```markdown
![截图](./assets/images/截图_20260416.png)
```

引用路径为相对路径，从 Page 文件所在目录出发。

***

## 7. 同步与一致性

### 7.1 启动时对齐流程

```
启动
  ↓
扫描 pages/ 目录下所有 .md 文件
  ↓
按文件时间戳和内容解析 Page 和 Block 树
  ↓
更新 SQLite（增量：只更新 mtime 或 content hash 变化的文件）
  ↓
全量内存树构建完成
```

### 7.2 编辑时同步

- **用户编辑 Markdown 文件**（外部）→ 启动时对齐，或后台文件监听触发增量解析
- **应用内编辑** → 同时写入 Markdown 文件 + 更新 SQLite

### 7.3 数据完整性

- SQLite 是索引，不是唯一真相源
- Markdown 文件损坏或缺失 → 从 SQLite 重建（或提示用户）
- SQLite 损坏或缺失 → 从 Markdown 文件完整重建
- 两者同时存在时，以最新 `updatedAt` 的为准

***

## 8. 待定事项

| 事项        | 说明                                      |
| --------- | --------------------------------------- |
| 冲突处理      | 多端同时编辑同一文件的冲突解决策略                       |
| 文件监听      | 外部编辑器修改文件时的实时监听方案（inotify / FSEvents）   |
| 加密存储      | 特定 Page 或文件级别的加密方案                      |
| 全文搜索      | SQLite FTS vs 外部搜索引擎的选型                 |
| 多 Page 文件 | `---` 分隔符支持多 Page 在同一 Markdown 文件内，暂不支持 |

***

*文档基于代码实现更新（2026-05-19），替代 v0.6（2026-04-24）。*
