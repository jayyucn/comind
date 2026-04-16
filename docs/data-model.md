# 数据模型设计文档

> 版本：v0.3
> 日期：2026-04-16
> 状态：评审完成，已修正

---

## 1. 概述

本文档定义 Logseq 类笔记工具的核心数据模型。

核心设计理念：

- **Block 是唯一基础单元** — Page 本质上是特殊的 Block
- **本地优先** — 数据存储以可读性、可迁移性为优先
- **双向链接是一等公民** — 链接结构单独建模，不依赖全文解析

---

## 2. 设计决策总览

| 决策项 | 选择 | 理由 |
|--------|------|------|
| Block 内容模型 | 纯文本 + 内联解析 | 简单，与 Markdown 一致，Logseq 验证过 |
| Page / Block 关系 | Page = Block（统一模型） | 模型统一，操作一致 |
| 双向链接粒度 | Page 级语义 + Block 级追溯 | 链接语义在 Page 维度，定位精确到 Block |
| 排序机制 | 整数 + Gap | 频繁拖拽友好，页面规模有限时重排成本低 |
| Property 存储 | Block.properties（JSON 字段） | 读写一体，高频查询属性按需建索引 |
| Tag 存储 | 从 content 解析，不存表（初版） | 简单，Logseq 一致；遇性能问题再迁移 |

---

## 3. 核心实体

### 3.1 Block

Block 是系统的唯一基础数据单元。一条大纲条目就是一个 Block。

**顶级 Block 不等于 Page：**
- `parentId = NULL` + `isPage = true` → 这是 Page（页面 Block）
- `parentId = NULL` + `isPage = false` → 这是顶级 Bullet（页面内的顶级条目）
- Page Block 的 content 第一行非 property 行即为页面标题

```
Block
├── id              UUID        主键，全局唯一
├── content         TEXT        Block 的原始文本内容
├── parentId        UUID | NULL 父 Block（NULL = 顶级节点）
├── pageId          UUID        所属页面 ID（冗余字段，加速查询）
├── left            INTEGER     同层级排序位置（初始间隔 100）
├── createdAt       TIMESTAMP   创建时间
├── updatedAt       TIMESTAMP   更新时间
├── isPage          BOOLEAN     是否为页面（顶级 Block = true）
├── title           TEXT | NULL 页面标题（仅 isPage = true 时有效）
└── properties      TEXT | NULL 属性 JSON（JSON 格式字符串）
```

**字段说明：**

| 字段 | 说明 |
|------|------|
| `id` | UUID v4，Block 的全局唯一标识 |
| `content` | 原始文本，`[[链接]]` 和 `#标签` 从中解析出来 |
| `parentId` | 父 Block ID。顶级 Block（isPage = true）的 parentId = NULL |
| `pageId` | 所属页面 Block 的 ID。顶级 Block 的 pageId = 自身 id |
| `left` | 排序字段。整数，同层级相邻 Block 之间预留间隔（初始 gap = 100） |
| `isPage` | true = 页面 Block（Page）；false = 普通条目（Bullet）。与 parentId 共同决定 Block 类型 |
| `title` | 页面显示名称（仅 isPage = true 时有效）。逻辑：properties.title 存在时取之，否则取 content 第一行非 property 行 |
| `properties` | JSON 字符串，存储属性键值对 |

**left 字段操作规则：**

```
初始插入：100, 200, 300, ...
在 100 和 200 之间插入：left = 150
在 200 和 300 之间插入：left = 250
gap 用完（差值 < 2）时，对该父级的所有子节点做局部重排：
  重排前：[100, 101, 102, 103]  (gap = 1)
  重排后：[100, 200, 300, 400]  (gap = 100)
```

**示例数据：**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "content": "项目名:: 数据模型设计\n这是正文内容",
  "parentId": null,
  "pageId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "left": 100,
  "createdAt": "2026-04-16T09:00:00Z",
  "updatedAt": "2026-04-16T09:30:00Z",
  "isPage": true,
  "title": "数据模型设计",
  "properties": "{\"项目名\": \"数据模型设计\"}"
}
```

```json
{
  "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "content": "这是子节点的内容",
  "parentId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "pageId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "left": 100,
  "createdAt": "2026-04-16T09:05:00Z",
  "updatedAt": "2026-04-16T09:05:00Z",
  "isPage": false,
  "title": null,
  "properties": null
}
```

---

### 3.2 Link

Link 记录页面间的双向引用关系。链接语义在 Page 维度，追溯粒度精确到 Block。

```
Link
├── id              UUID        主键
├── sourceBlockId   UUID        链接来源 Block（Block.id）
├── targetPageId    UUID        链接目标 Page（Block.id）
├── displayText     TEXT | NULL 链接显示文本（默认 = targetPage.title，即 [[标题]] 形式）
├── position        INTEGER | NULL  链接在 sourceBlock.content 中的字符位置
├── linkType        TEXT        链接类型：'internal' | 'external'
└── createdAt       TIMESTAMP   创建时间
```

**字段说明：**

| 字段 | 说明 |
|------|------|
| `sourceBlockId` | 链接文字所在的具体 Block。用于定位到段落 |
| `targetPageId` | 链接指向的目标 Page。聚合查询在此字段 |
| `displayText` | 链接的显示文本。`[[页面名]]` 时为"页面名"；`[[目标|别名]]` 时为"别名"；未指定时为 targetPage.title |
| `position` | 链接文字在 Block.content 中的起始字符位置（可选，支持锚点定位） |
| `linkType` | 链接类型。`internal` = 内部双链 `[[...]]`；`external` = 外部 URL |

**来源：**

- 正文中的 `[[页面名]]` → 写入 Link 表（displayText = "页面名"）
- 别名链接 `[[目标页面|别名]]` → 写入 Link 表（displayText = "别名"，targetPageId = "目标页面"）
- Property 中的 `[[页面名]]`（如 `负责人:: [[张三]]`）→ 同样写入 Link 表

**查询示例：**

```sql
-- 查询页面 B 的所有反向引用（按来源页面聚合）
SELECT DISTINCT b.pageId
FROM Link l
JOIN Block b ON l.sourceBlockId = b.id
WHERE l.targetPageId = 'B'

-- 查询页面 B 的所有反向引用（具体 Block + 内容预览）
SELECT l.sourceBlockId, b.content, b.pageId
FROM Link l
JOIN Block b ON l.sourceBlockId = b.id
WHERE l.targetPageId = 'B'
LIMIT 20

-- 查询 Block X 引用了哪些页面
SELECT l.targetPageId, p.title
FROM Link l
JOIN Block p ON l.targetPageId = p.id
WHERE l.sourceBlockId = 'X'
```

---

### 3.3 Tag（初版方案）

Tag 初版采用"从 content 解析，不存表"方案。

**解析规则：**

```
识别：Block.content 中的 #标签名
格式：#标签名（不含空格）
多标签：一条 Block.content 中可有多个 #标签
嵌套：#工作/项目A（斜杠表示层级标签）
```

**识别条件（需同时满足）：**
- `#` 后紧跟 Unicode 字母或汉字，不能以数字开头
- 标签结束于：行尾、换行、或遇到空格

**排除场景（以下场景中的 # 不识别为标签）：**
```
https://example.com/#section   ← 排除：URL 中的锚点
me@example.com                 ← 排除：邮箱中的井号
code#123                       ← 排除：代码片段
```

**示例：**

```markdown
#数据模型 #笔记工具
这是 Block 正文，包含 #设计 相关的讨论
```

解析后：
- 标签：`数据模型`、`笔记工具`、`设计`

**Phase 2 升级路径（性能优化）：**

当按标签查询的性能无法满足需求时，迁移到 Tag 表。详见 `tag-spec.md`（含 Phase 2 SQLite DDL、解析器实现、UI 交互规范）。

**迁移时机：** Phase 1 暂不使用 Tag 表，Tag 仅从 `Block.content` 解析不持久化；当出现 500+ Tag 或高频 Tag 查询需求时再引入 Tag 表。

---

## 4. Property 系统

### 4.1 存储格式

Block.properties 字段存储为 JSON 字符串：

```json
{
  "项目名": "数据模型设计",
  "状态": "进行中",
  "优先级": "P0",
  "参与者": ["张三", "李四"],
  "截止日期": "2026-04-20"
}
```

### 4.2 值类型

| 类型 | 示例写法 | 存储格式 |
|------|----------|----------|
| string | `状态:: 进行中` | `"进行中"` |
| number | `进度:: 80` | `80` |
| date | `截止:: 2026-04-20` | `"2026-04-20"` |
| boolean | `完成:: true` | `true` |
| list | `参与者:: [张三, 李四]` | `["张三", "李四"]` |
| page | `负责人:: [[张三]]` | `"张三"` + Link 表记录 |

**类型推断规则（按优先级）：**

```
布尔匹配  → boolean（值 = true / false）
日期匹配  → date（正则：^\d{4}-\d{2}-\d{2}$）
数字匹配  → number（正则：^\d+\.?\d*$）
列表匹配  → list（以方括号包裹，逗号分隔）
页面引用  → page（双链格式：[[...]]）
默认      → string
```

### 4.3 内置属性

系统识别的特殊属性，具有特定行为：

**页面级（isPage = true 时）：**

| 属性名 | 类型 | 说明 |
|--------|------|------|
| `title` | string | 页面标题（可与 Block.title 不同） |
| `alias` | list | 页面别名，影响搜索和链接匹配 |
| `tags` | list | 页面标签，影响分类 |
| `icon` | string | 页面图标（emoji 或图片路径） |
| `type` | string | 页面类型（如 "project"、"person"） |
| `created-at` | date | 创建时间（自动生成，用户不填） |
| `updated-at` | date | 更新时间（自动生成，用户不填） |

**Block 级：**

| 属性名 | 类型 | 说明 |
|--------|------|------|
| `id` | string | Block 唯一标识（UUID，用于锚点链接） |
| `collapsed` | boolean | Block 是否折叠 |
| `created-at` | date | 创建时间 |
| `updated-at` | date | 更新时间 |

### 4.4 Property 解析流程

```
Block content 输入
    │
    ▼
┌─────────────────────────────┐
│  提取 Property 行            │  规则：行首为 key:: value 格式
│  （从 content 顶部连续提取）   │  遇到第一行非 property 行则停止
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  类型推断 & 解析              │  按类型推断规则处理每个 value
│                               │  page 类型 → 追加 Link 记录
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  组装 Block 对象              │
│                               │
│  Block.properties = JSON.stringify(parsedProps)
│  Block.content    = 剩余正文文本
│  Block.title      = 第一行非 property 内容（仅 isPage=true 时）
│  Block.isPage     = (parentId == NULL)
└─────────────────────────────┘
```

**完整解析示例：**

输入 Block.content（原始）：

```markdown
状态:: 进行中
负责人:: [[张三]]
截止:: 2026-04-20
tags:: [数据, 设计]
这是 Block 的正文，包含 [[另一个页面]] 的链接
```

解析后：

```json
// Block.properties
{
  "状态": "进行中",
  "负责人": "张三",        // page 类型，值为页面名
  "截止": "2026-04-20",    // date 类型
  "tags": ["数据", "设计"] // list 类型
}

// Block.content
"这是 Block 的正文，包含 [[另一个页面]] 的链接"

// Link 表新增记录
{ "sourceBlockId": "<当前BlockID>", "targetPageId": "<张三的PageID>" }
{ "sourceBlockId": "<当前BlockID>", "targetPageId": "<另一个页面的PageID>" }
```

### 4.5 Property 查询

基于 JSON 字段查询：

```sql
-- 查找所有"状态 = 进行中"的 Block
SELECT * FROM Block
WHERE json_extract(properties, '$.状态') = '进行中'

-- 查找截止日期在范围内的 Block
SELECT * FROM Block
WHERE json_extract(properties, '$.截止') BETWEEN '2026-04-01' AND '2026-04-30'

-- 查找 tags 包含"设计"的 Block
SELECT * FROM Block
WHERE json_extract(properties, '$.tags') LIKE '%设计%'
```

**高频查询优化：**

对常用属性建立索引：

```sql
CREATE INDEX idx_prop_status
ON Block(json_extract(properties, '$.状态'));

CREATE INDEX idx_prop_deadline
ON Block(json_extract(properties, '$.截止'));
```

---

## 5. 实体关系图

```
┌──────────────────────────────────────────────────────────────┐
│                          Block                                │
│  (id, content, parentId, pageId, left, isPage, title, props) │
│                                                               │
│  ┌─────────────────────────┐                                 │
│  │  parentId = NULL        │  ←─── Page Block（isPage=true） │
│  │  isPage = true          │                                 │
│  │  title = "页面标题"      │                                 │
│  └──────────┬────────────────┘                                 │
│             │ children                                        │
│             ▼                                                  │
│  ┌─────────────────────────┐                                 │
│  │  Block（child）          │ ←─── Link ──→ targetPage        │
│  │  parentId = Page.id      │     sourceBlockId                │
│  │  content含 [[页面名]]    │     targetPageId                 │
│  └──────────┬────────────────┘                                 │
│             │ children                                        │
│             ▼                                                  │
│  ┌─────────────────────────┐                                 │
│  │  Block（grandchild）     │                                 │
│  │  content含 #标签名       │                                 │
│  └─────────────────────────┘                                 │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. 附录

### 6.1 典型页面 Block 数据结构

```
Page "数据模型设计"
│
├── Block "概述"
│   ├── properties: { "状态": "完成", "负责人": "张三" }
│   ├── Block "Block 是唯一基础单元"     (left=100)
│   │   └── Block "正文内容在这里"         (left=100)
│   ├── Block "整数 + Gap 排序机制"       (left=200)
│   └── Block "Property 系统已定义"       (left=300)
│
└── Block "下一步"
    ├── Block "确定存储格式"               (left=100)
    └── Block "技术选型"                   (left=200)
```

### 6.2 SQLite 建表 DDL

```sql
CREATE TABLE Block (
    id          TEXT PRIMARY KEY,     -- UUID v4
    content     TEXT NOT NULL DEFAULT '',
    parentId    TEXT,                 -- NULL = 顶级；isPage = true 时为 Page Block
    pageId      TEXT NOT NULL,        -- 所属页面 Block.id；Page Block 的 pageId = 自身 id
    "left"      INTEGER NOT NULL DEFAULT 0,
    createdAt   TEXT NOT NULL,        -- ISO 8601
    updatedAt   TEXT NOT NULL,        -- ISO 8601
    isPage      INTEGER NOT NULL DEFAULT 0,  -- 1 = Page Block，0 = Bullet
    title       TEXT,                  -- 页面显示名称，isPage = 1 时有效
    properties  TEXT,                  -- JSON 字符串，建议不超过 4KB
    filePath    TEXT                   -- 对应 Markdown 文件的相对路径
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
CREATE INDEX idx_block_left      ON Block(parentId, "left");
CREATE INDEX idx_block_isPage    ON Block(isPage);
CREATE INDEX idx_block_filePath  ON Block(filePath);
CREATE INDEX idx_link_target     ON Link(targetPageId);
CREATE INDEX idx_link_source     ON Link(sourceBlockId);
CREATE INDEX idx_link_type       ON Link(linkType);
```

---

## 7. 待定事项

以下决策暂未确定，将在后续迭代中补充：

| 事项 | 说明 |
|------|------|
| 外部存储 | Block.content 是否支持大文本外部存储（如单独的文件） |
| 版本历史 | 是否支持 Block 级别的历史版本回溯 |
| 全文搜索 | 使用 SQLite FTS 还是独立的搜索引擎 |
| 插件/扩展 | 自定义属性系统是否需要 Schema 约束 |
| 归档 / 加密 | Page 或 Block 是否支持加密、归档、打标签等文件级元数据 |

---

*文档由 AI 助手协助生成，待开发者评审确认。*
