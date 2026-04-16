# Tag 解析规范

> 版本：v0.2
> 日期：2026-04-16
> 状态：草案（Phase 2 特性，详细规范见本文档）

**Phase 1 定位：** Tag 从 `Block.content` 解析但不持久化到 Tag 表（见 `data-model.md` §3.3）。独立 Tag 表、Tag 管理视图、Tag 查询 API 属于 Phase 2 特性，Phase 1 暂不实现。

***

## 1. 概述

Tag（标签）是 comind 中用于内容分类和检索的核心元数据机制。本文档定义 Tag 的语法规则、解析时机、存储策略和 UI 交互。

**Tag 与 Link 的区别：**

| 特性 | Tag | Link |
|------|-----|------|
| 语法 | `#标签名` | `[[页面名]]` |
| 语义 | 分类/标记 | 引用/关联 |
| 目标 | 无（纯标记） | 有（指向特定 Page） |
| 显示 | 高亮样式 | 可点击链接 |

***

## 2. 语法定义

### 2.1 基础语法

```
#标签名
```

**规则：**

- 以 `#` 开头，后接标签名
- 标签名只能包含：字母、数字、中文、连字符 `-`、下划线 `_`
- 标签名不能以数字开头
- 标签名区分大小写（`#Tag` ≠ `#tag`）
- 标签名长度限制：1-64 字符

**有效示例：**

```
#设计
#数据模型
#Phase1
#bug-fix
#待办事项
```

**无效示例：**

```
#123tag      ← 以数字开头
#tag name    ← 包含空格
#tag/name    ← 包含斜杠
##tag        ← 双 #（Markdown 标题）
#            ← 空标签名
```

### 2.2 边界规则

Tag 的识别遵循**词边界**原则：

| 场景 | 是否识别为 Tag | 说明 |
|------|---------------|------|
| `这是#标签` | ❌ | `#` 前无空白或标点 |
| `这是 #标签` | ✅ | `#` 前有空格 |
| `(#标签)` | ✅ | `#` 前有标点 |
| `## 标题` | ❌ | Markdown H2 标题语法 |
| `#标签#` | ✅ | 第二个 `#` 是标签名的一部分 |
| `\#标签` | ❌ | 转义，不识别 |

**词边界字符：** 空格、制表符、换行、标点符号（`.,;:!?()[]{}"'`）

### 2.3 多标签连续

多个标签连续出现时，每个标签独立识别：

```
#设计 #数据模型 #Phase1
```

解析结果：`["设计", "数据模型", "Phase1"]`

### 2.4 标签与代码块

在代码块（`` ``` `` 或 `` ` `` 包裹）中的 `#` 不识别为 Tag：

```markdown
这是 #标签（会被识别）

```
这是 #标签（不会识别，在代码块内）
```

行内代码 `` `#标签` `` 也不识别。

***

## 3. 解析时机

### 3.1 触发条件

Tag 解析在以下时机触发：

| 时机 | 说明 |
|------|------|
| Block 保存时 | 用户完成编辑，保存 Block 内容 |
| 粘贴内容时 | 从外部粘贴包含 Tag 的文本 |
| 导入 Markdown 时 | 批量导入外部文件 |

### 3.2 解析流程

```
Block.content
    ↓
正则匹配所有 #标签
    ↓
过滤无效标签（代码块内、转义等）
    ↓
去重（同一 Block 内相同标签只存一次）
    ↓
Phase 1：存入 Pinia 内存状态（供实时搜索/过滤）
Phase 2/3：写入 Tag 表（持久化）
    ↓
更新内存索引
```

### 3.3 增量更新策略

为避免全量重建 Tag 索引，采用增量更新：

```typescript
// 伪代码
function updateBlockTags(blockId: string, newContent: string) {
  const oldTags = db.tags.where('blockId').equals(blockId).toArray()
  const newTags = parseTags(newContent)  // 从 content 解析
  
  const toDelete = oldTags.filter(t => !newTags.includes(t.name))
  const toAdd = newTags.filter(t => !oldTags.some(ot => ot.name === t))
  
  db.transaction('rw', db.tags, async () => {
    await db.tags.bulkDelete(toDelete.map(t => t.id))
    await db.tags.bulkAdd(toAdd.map(t => ({ blockId, name: t, createdAt: now() })))
  })
}
```

***

## 4. 存储策略

### 4.1 Phase 1（内存解析，不持久化）

Phase 1 Tag 仅从 `Block.content` 解析，供实时搜索/过滤使用，**不写入 Tag 表**。

```typescript
// Phase 1 Tag 解析（内存层）
// 解析结果供内存状态使用，不持久化
function parseTags(content: string): string[] {
  const tagRegex = /#([\p{L}_][\p{L}\p{N}_]*)/gu
  const tags: string[] = []
  let match
  while ((match = tagRegex.exec(content)) !== null) {
    const tag = match[1]
    if (!tag.includes('/') && !tag.includes('.')) {
      tags.push(tag)
    }
  }
  return [...new Set(tags)]  // 去重
}
```

**性能说明：** 按 Tag 查询 = 遍历所有 Block.content 逐条解析。500+ Tag 或高频查询时升级到 Tag 表。

### 4.2 Phase 2/3（Tag 表）

```sql
CREATE TABLE Tag (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    blockId     TEXT NOT NULL,
    name        TEXT NOT NULL,
    createdAt   TEXT NOT NULL,  -- ISO 8601
    UNIQUE(blockId, name),
    FOREIGN KEY (blockId) REFERENCES Block(id)
);

-- 索引
CREATE INDEX idx_tag_blockId ON Tag(blockId);
CREATE INDEX idx_tag_name ON Tag(name);
```

### 4.2 Phase 2/3（Tag 表）

当出现 500+ Tag 或高频按 Tag 查询需求时，迁移到 Tag 表：

```typescript
// Tag 表结构（Phase 2/3）
interface TagRecord {
  id?: number           // 自增主键
  blockId: string       // 所属 Block ID
  name: string          // 标签名（不含 #）
  createdAt: number     // 时间戳
}

// Dexie Schema
this.version(2).stores({
  tags: '++id, blockId, name, [blockId+name]'
})
```

```sql
-- SQLite DDL（来源 data-model.md §3.3）
CREATE TABLE Tag (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    blockId     TEXT NOT NULL,
    name        TEXT NOT NULL,
    createdAt   TEXT NOT NULL,
    UNIQUE(blockId, name),
    FOREIGN KEY (blockId) REFERENCES Block(id)
);
CREATE INDEX idx_tag_blockId ON Tag(blockId);
CREATE INDEX idx_tag_name ON Tag(name);
```

**索引说明：**

- `blockId`：查询某 Block 的所有标签
- `name`：查询某标签的所有 Block
- `[blockId+name]`：唯一约束，防止同一 Block 重复标签

### 4.3 增量更新策略（Phase 2/3）

```typescript
// 增量更新（Phase 2/3）
async function updateBlockTags(blockId: string, newContent: string): Promise<void> {
  const oldTags = await db.tags.where('blockId').equals(blockId).toArray()
  const newTagNames = parseTags(newContent)

  const toDelete = oldTags.filter(t => !newTagNames.includes(t.name))
  const toAdd = newTagNames
    .filter(name => !oldTags.some(ot => ot.name === name))
    .map(name => ({ blockId, name, createdAt: Date.now() }))

  await db.transaction('rw', db.tags, async () => {
    if (toDelete.length) await db.tags.bulkDelete(toDelete.map(t => t.id))
    if (toAdd.length) await db.tags.bulkAdd(toAdd)
  })
}
```

### 4.4 与 Block 的关系

```
Block A
├── content: "这是 #设计 文档"
└── Tags: ["设计"]（Phase 2/3 持久化到 Tag 表；Phase 1 仅内存解析）

Block B
├── content: "#设计 #数据模型 讨论"
└── Tags: ["设计", "数据模型"]
```

**注意：** Tag 只与 Block 关联，不与 Page 直接关联。查询某 Page 的所有标签需通过其 Block 聚合。

```
Block A
├── content: "这是 #设计 文档"
└── Tags: ["设计"]

Block B
├── content: "#设计 #数据模型 讨论"
└── Tags: ["设计", "数据模型"]
```

**注意：** Tag 只与 Block 关联，不与 Page 直接关联。查询某 Page 的所有标签需通过其 Block 聚合。

***

## 5. UI 交互

### 5.1 渲染样式

```css
.tag {
  display: inline;
  color: var(--tag-color, #0366d6);
  background: var(--tag-bg, rgba(3, 102, 214, 0.1));
  padding: 0 4px;
  border-radius: 3px;
  cursor: pointer;
}

.tag:hover {
  background: var(--tag-bg-hover, rgba(3, 102, 214, 0.2));
}
```

**渲染示例：**

> 这是 <span class="tag">#设计</span> 文档，包含 <span class="tag">#数据模型</span> 讨论。

### 5.2 点击交互

| 操作 | 行为 |
|------|------|
| 单击 Tag | 打开标签搜索视图，显示所有含该标签的 Block |
| 右键 Tag | 上下文菜单：复制标签名、搜索相关标签 |
| 悬停 Tag | 显示使用该标签的 Block 数量 |

### 5.3 输入辅助

**自动补全：**

输入 `#` 后显示标签建议列表：

```
用户输入: #设
建议列表:
  ├─ #设计 (12)
  ├─ #设置 (5)
  └─ #设计规范 (3)
```

**快捷输入：**

- `#` + 空格：取消当前标签输入
- `#` + Enter：选择第一个建议
- `#` + Tab：自动补全唯一匹配项

### 5.4 标签管理视图

**标签云/列表：**

```
┌─────────────────────────────────────┐
│ 所有标签                    排序 ▼  │
├─────────────────────────────────────┤
│                                     │
│  #设计 (23)    #数据模型 (15)       │
│  #Phase1 (12)  #待办 (8)            │
│  #bug (6)      #优化 (4)            │
│                                     │
└─────────────────────────────────────┘
```

点击标签进入该标签的 Block 列表视图。

***

## 6. 与 tiptap 集成

### 6.1 Node/Extension 设计

```typescript
import { Node } from '@tiptap/core'

export const Tag = Node.create({
  name: 'tag',
  
  group: 'inline',
  inline: true,
  selectable: true,
  
  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: element => element.getAttribute('data-tag'),
        renderHTML: attributes => ({
          'data-tag': attributes.name,
        }),
      },
    }
  },
  
  parseHTML() {
    return [
      {
        tag: 'span[data-tag]',
        getAttrs: element => ({
          name: element.getAttribute('data-tag'),
        }),
      },
    ]
  },
  
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(
      { class: 'tag' },
      HTMLAttributes
    ), `#${HTMLAttributes['data-tag']}`]
  },
  
  addInputRules() {
    return [
      // #标签名 + 空格/换行 → 转换为 Tag Node
      textInputRule({
        find: /(?:^|\s)(#[\w\u4e00-\u9fa5_-]+)$/,
        type: this.type,
        getAttributes: match => ({ name: match[1].slice(1) }),
      }),
    ]
  },
})
```

### 6.2 输入规则

| 输入 | 触发 | 结果 |
|------|------|------|
| `#设计` + 空格 | 自动转换 | Tag Node |
| `#设计` + 换行 | 自动转换 | Tag Node |
| Backspace 在 Tag 前 | 删除 Tag | 纯文本 `#设计` |

### 6.3 粘贴处理

粘贴包含 Tag 的文本时：

```typescript
// 粘贴处理器
handlePaste: (view, event, slice) => {
  const text = slice.content.textBetween(0, slice.content.size)
  const parsed = parseTags(text)
  
  // 将纯文本中的 #标签 转换为 Tag Nodes
  // 保持其他文本不变
}
```

***

## 7. 查询 API

### 7.1 基础查询

```typescript
// 获取某 Block 的所有标签
function getBlockTags(blockId: string): Promise<string[]>

// 获取某标签的所有 Block
function getTagBlocks(tagName: string): Promise<Block[]>

// 获取所有标签及使用次数
function getAllTags(): Promise<{ name: string; count: number }[]>
```

### 7.2 组合查询

```typescript
// 多标签交集（AND）
function getBlocksWithAllTags(tagNames: string[]): Promise<Block[]>

// 多标签并集（OR）
function getBlocksWithAnyTags(tagNames: string[]): Promise<Block[]>
```

***

## 8. 测试用例

### 8.1 解析测试

```typescript
describe('Tag Parser', () => {
  test('基础标签', () => {
    expect(parseTags('这是 #设计 文档')).toEqual(['设计'])
  })
  
  test('多个标签', () => {
    expect(parseTags('#设计 #数据模型 讨论')).toEqual(['设计', '数据模型'])
  })
  
  test('边界字符', () => {
    expect(parseTags('(#标签)')).toEqual(['标签'])
    expect(parseTags('这是#标签')).toEqual([])  // 无前导空白
  })
  
  test('代码块内忽略', () => {
    expect(parseTags('```\n#标签\n```')).toEqual([])
  })
  
  test('无效标签', () => {
    expect(parseTags('#123')).toEqual([])  // 数字开头
    expect(parseTags('#tag name')).toEqual([])  // 含空格
  })
  
  test('去重', () => {
    expect(parseTags('#设计 #设计')).toEqual(['设计'])
  })
})
```

***

## 9. 边界情况

| 场景 | 处理 |
|------|------|
| 标签名超长（>64） | 截断或拒绝，建议截断并提示 |
| 标签名含特殊字符 | 只识别有效部分，如 `#设计-2024!` → `#设计-2024` |
| 同名标签不同大小写 | 视为不同标签（`#Bug` ≠ `#bug`） |
| 空标签 `#` | 不识别，保持纯文本 |
| 与 Markdown 标题冲突 | `## 标题` 不识别为 Tag |

***

*文档由 AI 助手协助生成，待开发者评审确认。*
