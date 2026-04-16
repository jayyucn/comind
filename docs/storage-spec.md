# 存储格式规范

> 版本：v0.3
> 日期：2026-04-16
> 状态：评审完成，已确认

---

## 1. 概述

采用 **Markdown 文件 + SQLite 索引** 的混合存储模式。

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

| 组件 | 职责 |
|------|------|
| Markdown 文件（`pages/`） | 持久化存储，用户可直接读写，支持 Git 版本控制 |
| SQLite 数据库（`comind.db`） | 全文索引、双向链接、属性查询、Block 树结构缓存 |
| assets 目录 | 图片、附件等二进制资源统一存储 |

**读写关系：**

```
用户编辑 Markdown 文件
    ↓ 解析
写入/更新 SQLite 索引（内存树 + Link 表）
    ↓ 持久化
下次启动 → 扫描 Markdown 文件 → 对齐 SQLite → 重建内存状态
```

---

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

| 页面标题 | 文件名 |
|----------|--------|
| `数据模型设计` | `数据模型设计_20260416T103000.md` |
| `笔记/工具调研` | `笔记工具调研_20260416T103000.md` |
| `What's new?` | `Whats new_20260416T103000.md` |
| `Project: Phase 1` | `Project Phase 1_20260416T103000.md` |

### 2.2 标题冲突

同一目录下不允许标题 + 时间戳完全相同的文件。若用户创建同名 Page：

- 第二个 Page 使用不同时间戳（精确到秒），可区分
- 若同一秒内创建两个同名 Page，第二条时间戳进位到下一秒

---

## 3. Markdown 文件格式

### 3.1 文件结构

```
[文件头：Page Properties]
---
title:: 页面标题
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
Page Block（isPage=true）         # 页面标题                    ← H1 = 页面级
├── Block A（level=1）            ## Block A 内容               ← ## = 缩进 1
│   ├── Block B（level=2）         ### Block B 内容              ← ### = 缩进 2
│   └── Block C（level=2）         ### Block C 内容
└── Block D（level=1）            ## Block D 内容
```

**映射规则：**

| Block 缩进层级 | Markdown 标题级别 | 说明 |
|----------------|-------------------|------|
| 0（Page 自身） | H1（`#`） | 仅标题行，无正文 |
| 1 | H2（`##`） | |
| 2 | H3（`###`） | |
| 3+ | H4+（`####` 及以上） | 深层缩进 |
| 无标题 Block | 普通段落（无 `#` 前缀） | 仅正文，无子节点时 |

**Block 内不存缩进信息**，层级完全由标题级别决定。

**Block.content 的边界规则：**

- Block = 标题行 + 后续正文，直到下一个同级或更高级标题出现
- 标题行本身（去除 `#` 后的文字）不计入 Block.content
- 无子节点的 Block：标题行 + 正文段落到下一个同级标题为止

**示例：**

```markdown
# 数据模型设计                    ← Page Block（H1）：content = ""
## Block A 内容                  ← Block A（H2）：content = "Block A 内容"
这是 Block A 的后续正文
### Block B 内容                 ← Block B（H3）：content = "Block B 内容"
Block B 的正文段落
### Block C 内容                 ← Block C（H3）：content = "Block C 内容"
## Block D                       ← Block D（H2）：content = "Block D"
```

解析后各 Block.content：
- Page：`""`
- Block A：`"这是 Block A 的后续正文"`
- Block B：`"Block B 的正文段落"`
- Block C：`""`
- Block D：`""`

### 3.3 多行 Block

Block 内容跨越多行时，使用 Markdown 引用块（`>`）或缩进段落：

```markdown
## Block A 内容（第一行）
这是 Block A 的第二行内容
Block A 的第三行

### 子 Block B
```

### 3.4 Property 行与正文的区分

- Property 行：在 `---` 分隔区域内的 `key:: value` 行
- 正文 Property 行：在 `---` 区域外的 `key:: value` 行，嵌入在 Block 内容中

```markdown
---
title:: 页面标题
---

## Block A
状态:: 进行中
这是 Block A 的正文

## Block B
tags:: [设计, 数据]
```

解析时：
- `---` 之间的行 → Page Properties
- Block 内容中的 `key:: value` → 该 Block 的 properties

---

## 4. SQLite 数据库结构

### 4.1 表结构

```sql
CREATE TABLE Block (
    id          TEXT PRIMARY KEY,     -- UUID v4
    content     TEXT NOT NULL DEFAULT '',
    parentId    TEXT,                  -- NULL = 顶级；isPage = true 时为 Page Block
    pageId      TEXT NOT NULL,        -- 所属页面 Block.id；Page Block 的 pageId = 自身 id
    "left"      INTEGER NOT NULL DEFAULT 0,
    createdAt   TEXT NOT NULL,        -- ISO 8601，创建时间
    updatedAt   TEXT NOT NULL,        -- ISO 8601，文件 mtime 或编辑时间
    isPage      INTEGER NOT NULL DEFAULT 0,  -- 1 = Page Block，0 = Bullet
    title       TEXT,                  -- 页面显示名称，isPage = 1 时有效
    properties  TEXT,                  -- JSON 字符串，建议不超过 4KB
    filePath    TEXT                   -- 对应 Markdown 文件的相对路径（相对于工作区根目录）
);

CREATE TABLE Link (
    id              TEXT PRIMARY KEY,
    sourceBlockId   TEXT NOT NULL,
    targetPageId    TEXT,              -- 内部链接指向 Page.id；外部链接时 NULL
    displayText     TEXT,              -- 链接显示文本；NULL 时用 targetPage.title
    position        INTEGER,           -- 链接在 sourceBlock.content 中的字符偏移
    linkType        TEXT NOT NULL DEFAULT 'internal',  -- 'internal' | 'external'
    createdAt       TEXT NOT NULL,     -- ISO 8601
    FOREIGN KEY (sourceBlockId) REFERENCES Block(id)
);

-- 常用索引
CREATE INDEX idx_block_pageId    ON Block(pageId);
CREATE INDEX idx_block_parentId  ON Block(parentId);
CREATE INDEX idx_block_left     ON Block(parentId, "left");
CREATE INDEX idx_block_isPage   ON Block(isPage);
CREATE INDEX idx_block_filePath ON Block(filePath);
CREATE INDEX idx_link_target    ON Link(targetPageId);
CREATE INDEX idx_link_source    ON Link(sourceBlockId);
```

**新增字段说明：**

| 字段 | 说明 |
|------|------|
| `Block.filePath` | 该 Block 所属 Markdown 文件的相对路径，如 `pages/数据模型设计_20260416T103000.md` |
| `Link.linkType` | 链接类型：`internal`（内部双链 `[[...]]`）或 `external`（外部 URL） |

### 4.2 Link 表 linkType 字段

- `[[页面名]]` → `linkType = 'internal'`
- 外部 URL（如 `https://example.com`）→ `linkType = 'external'`，`targetPageId` 字段留空

**说明：** 外部链接写入 Link 表的目的：支持"哪些 Block 引用了某个外部 URL"的查询。

---

## 5. 日志（Journal）规范

### 5.1 设计原则

日志遵循"**一个条目 = 一个 Page = 一个文件**"的原则，与普通 Page 完全一致。

### 5.2 文件命名

日志文件以 `日志_` 前缀区分：

```
日志_20260416T000000.md      ← 2026年4月16日的日志页
日志_20260417T000000.md      ← 2026年4月17日的日志页
```

日志文件同样存于 `pages/` 目录，与普通 Page 共用同一命名空间和文件命名规则（标题 + 时间戳）。

### 5.3 日志文件的 Page 属性

日志 Page 使用 `journal-date` 属性标识日期：

```markdown
---
journal-date:: 2026-04-16
type:: journal
---

## 上午
状态:: 进行中
开始数据模型设计

## 下午
完成文档初稿
```

| 属性 | 值 | 说明 |
|------|-----|------|
| `journal-date` | `YYYY-MM-DD` | 日志条目日期，用于日历视图 |
| `type` | `journal` | 标识为日志类型（可选，辅助分类） |
| `title` | 可选 | 日志标题，默认为日期 |

### 5.4 日志索引页（待实现）

日志列表（如"4月所有日志"）是一个普通的 Page，通过属性筛选或链接聚合展示。

多 Page 文件（`---` 分隔符支持多 Page 在同一文件内）暂不支持，留待后续迭代。

---

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

---

## 7. 同步与一致性

### 7.1 启动时对齐流程

```
启动
  ↓
扫描 pages/ 目录下所有 .md 文件
  ↓
按文件时间戳和内容解析 Block 树
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

---

## 8. 待定事项

| 事项 | 说明 |
|------|------|
| 冲突处理 | 多端同时编辑同一文件的冲突解决策略 |
| 文件监听 | 外部编辑器修改文件时的实时监听方案（inotify / FSEvents） |
| 加密存储 | 特定 Page 或文件级别的加密方案 |
| 全文搜索 | SQLite FTS vs 外部搜索引擎的选型 |
| 多 Page 文件 | `---` 分隔符支持多 Page 在同一 Markdown 文件内，暂不支持 |

---

*文档由 AI 助手协助生成，待开发者评审确认。*
