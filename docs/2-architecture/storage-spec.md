# 存储格式规范

> 版本：v0.7
> 日期：2026-05-19
> 状态：✅ 已实现（Phase 1 IndexedDB 部分）

***

## 0. Phase 适用说明

| Phase       | 存储方案                        | 适用文档                          |
| ----------- | --------------------------- | ----------------------------- |
| **Phase 1** | IndexedDB（Dexie.js）          | 本文档 §0.1（已实现）               |
| **Phase 2** | Markdown + SQLite（Core 层抽离） | 本文档 §1-§8（待实现）              |
| **Phase 3** | Markdown + SQLite（Tauri 原生） | 本文档 §1-§8（待实现）              |

### 0.1 Phase 1 IndexedDB 实现

**当前存储方案为 IndexedDB + Dexie.js，已完成实现。**

```typescript
// src/storage/db.ts
import Dexie, { type Table } from 'dexie'
import type { BlockRecord } from '../types/block'
import type { LinkRecord } from '../types/link'
import type { PageRecord } from '../types/page'
import type { PropertyRecord } from '../types/property'

export class ComindDB extends Dexie {
  blocks!: Table<BlockRecord, string>
  links!: Table<LinkRecord, string>
  pages!: Table<PageRecord, string>
  properties!: Table<PropertyRecord, string>

  constructor() {
    super('comind')
    this.version(4).stores({
      blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
      links: 'id, sourceBlockId, targetPageId, displayText, createdAt',
      pages: 'id, blockId, title, type, createdAt, updatedAt',
      properties: 'id, blockId, [blockId+key]'
    })
  }
}

export const db = new ComindDB()
```

**Record 类型定义：**

```typescript
// PageRecord（src/types/page.ts）
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
  createdAt: number          // 毫秒时间戳
  updatedAt: number
}

// BlockRecord（src/types/block.ts）
export interface BlockRecord {
  id: string
  pageId: string
  parentId: string | null
  pos: number                // Gap 排序位置（初始间隔 1000）
  content: string
  format: string             // JSON 字符串
  type: string               // 'bullet' | 'property' | 'query' | 'embed'
  properties: string         // JSON 字符串
  createdAt: number
  updatedAt: number
}

// LinkRecord（src/types/link.ts）
export interface LinkRecord {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  createdAt: number
}

// PropertyRecord（src/types/property.ts）
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

**与 v0.6 的主要差异：**

| 变更项 | v0.6 | v0.7（当前实现） |
|--------|------|-------------|
| Block 排序 | `leftId` | `pos`（Gap 排序） |
| Property 表 | 不存在 | 已实现（4 个表） |
| Dexie 版本 | version(1) | version(4) |
| Block 索引 | `leftId` | `pos` |
| Property 索引 | 不存在 | `blockId`, `[blockId+key]` |
| 时间戳格式 | ISO 8601 string | number（毫秒） |

**Phase 1 → Phase 2 迁移路径：**

1. Phase 1 实现 `IndexedDBAdapter`（基于 Dexie）✅
2. Phase 2 抽象 `StorageAdapter` 接口（定义统一的 CRUD 契约）
3. Phase 2 实现 `SQLiteAdapter`（本规范 §4 SQLite 表结构）
4. 提供迁移工具：IndexedDB → Markdown + SQLite

***

## 1. 概述

采用 **Markdown 文件 + SQLite 索引** 的混合存储模式（Phase 2/3）。

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

## 4. SQLite 数据库结构（Phase 2/3）

### 4.1 表结构

```sql
CREATE TABLE Page (
    id              TEXT PRIMARY KEY,     -- UUID v4
    blockId         TEXT,                 -- 根 Block ID
    title           TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'normal',  -- 'normal' | 'journal'
    icon            TEXT,
    cover           TEXT,
    aliases         TEXT NOT NULL DEFAULT '[]',  -- JSON 数组字符串
    filePath        TEXT,
    childrenCount   INTEGER NOT NULL DEFAULT 0,
    wordCount       INTEGER NOT NULL DEFAULT 0,
    createdAt       INTEGER NOT NULL,     -- 毫秒时间戳
    updatedAt       INTEGER NOT NULL,     -- 毫秒时间戳
    FOREIGN KEY (blockId) REFERENCES Block(id)
);

CREATE TABLE Block (
    id              TEXT PRIMARY KEY,     -- UUID v4
    pageId          TEXT NOT NULL,        -- 所属页面 ID
    parentId        TEXT,                 -- 父 Block ID
    pos             INTEGER NOT NULL DEFAULT 1000,  -- Gap 排序位置
    content         TEXT NOT NULL DEFAULT '',
    format          TEXT NOT NULL DEFAULT '{}',  -- JSON 字符串
    type            TEXT NOT NULL DEFAULT 'bullet',  -- 'bullet' | 'property' | 'query' | 'embed'
    properties      TEXT NOT NULL DEFAULT '{}',  -- JSON 字符串
    createdAt       INTEGER NOT NULL,     -- 毫秒时间戳
    updatedAt       INTEGER NOT NULL,     -- 毫秒时间戳
    FOREIGN KEY (pageId) REFERENCES Page(id)
);

CREATE TABLE Link (
    id              TEXT PRIMARY KEY,     -- UUID v4
    sourceBlockId   TEXT NOT NULL,        -- 链接来源 Block
    targetPageId    TEXT NOT NULL,        -- 链接目标 Page
    displayText     TEXT NOT NULL,
    createdAt       INTEGER NOT NULL,     -- 毫秒时间戳
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
    UNIQUE(blockId, key),
    FOREIGN KEY (blockId) REFERENCES Block(id)
);

-- 常用索引
CREATE INDEX idx_page_blockId    ON Page(blockId);
CREATE INDEX idx_page_type       ON Page(type);
CREATE INDEX idx_page_updatedAt  ON Page(updatedAt);
CREATE INDEX idx_block_pageId    ON Block(pageId);
CREATE INDEX idx_block_parentId  ON Block(parentId);
CREATE INDEX idx_block_pos       ON Block(pos);
CREATE INDEX idx_link_target     ON Link(targetPageId);
CREATE INDEX idx_link_source     ON Link(sourceBlockId);
CREATE INDEX idx_property_blockId ON Property(blockId);
CREATE INDEX idx_property_key    ON Property(key);
CREATE INDEX idx_property_type   ON Property(type);
```

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
