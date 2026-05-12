# Property 规范

> 版本：v0.2
> 日期：2026-04-16
> 状态：草案（Phase 2 特性，详细规范见本文档）

**Phase 1 定位：** Property 作为 Block.content 的内嵌元数据（`key:: value` 嵌入正文），解析后序列化存入 `Block.properties` JSON 字段。独立 Property 表和 UI 属性面板属于 Phase 2 特性，Phase 1 暂不实现。

***

## 1. 概述

Property（属性）是 comind 中用于为 Block/Page 附加结构化元数据的机制。本文档定义 Property 的语法规则、数据类型、存储策略和 UI 交互。

**Property 的定位：**

| 特性 | Property | Tag | Link |
|------|----------|-----|------|
| 语法 | `key:: value` | `#标签名` | `[[页面名]]` |
| 结构 | 键值对 | 单值标记 | 关联引用 |
| 用途 | 元数据/配置 | 分类 | 关联 |
| 查询 | 支持按 key/value 筛选 | 按名称筛选 | 按目标筛选 |

***

## 2. 语法定义

### 2.1 基础语法

```
key:: value
```

**规则：**

- `key`：属性名，只能包含字母、数字、中文、连字符 `-`、下划线 `_`
- `::`：分隔符，冒号后必须有一个空格（`:: `）
- `value`：属性值，支持多种数据类型
- 一行一个属性

**有效示例：**

```
状态:: 进行中
优先级:: 高
created-at:: 2026-04-16
tags:: [设计, 数据模型]
完成度:: 0.75
```

**无效示例：**

```
key:value       ← 缺少空格
key :: value    ← 冒号前有空格
:: value        ← 缺少 key
key::           ← 缺少 value（空值需显式写 null 或 ""）
```

### 2.2 Key 命名规范

| 规则 | 说明 | 示例 |
|------|------|------|
| 只能使用 | 字母、数字、中文、`-`、`_` | `created-at`, `优先级` |
| 不能以数字开头 | 避免解析歧义 | ❌ `123key` |
| 区分大小写 | `Status` ≠ `status` | 建议小写 + 连字符 |
| 长度限制 | 1-64 字符 | 超出截断 |
| 保留前缀 | `sys-` 前缀保留给系统属性 | `sys-id`, `sys-version` |

**命名建议：**

- 使用小写字母 + 连字符（kebab-case）：`created-at`, `due-date`
- 或使用中文（用户友好）：`创建时间`, `截止日期`
- 避免混用中英文 key

### 2.3 Value 数据类型

Property value 支持以下类型：

| 类型 | 语法示例 | 存储格式 | 说明 |
|------|---------|---------|------|
| **String** | `标题:: 文档标题` | `"文档标题"` | 默认类型，纯文本 |
| **Number** | `进度:: 75` | `75` / `0.75` | 整数或浮点数 |
| **Boolean** | `完成:: true` | `true` / `false` | true/false |
| **Date** | `截止日期:: 2026-04-16` | `"2026-04-16"` | ISO 8601 日期 |
| **DateTime** | `创建时间:: 2026-04-16T10:30:00Z` | `"2026-04-16T10:30:00Z"` | ISO 8601 日期时间 |
| **Array** | `标签:: [设计, 数据]` | `["设计", "数据"]` | 方括号包裹，逗号分隔 |
| **Link** | `关联:: [[页面名]]` | `{"type": "link", "target": "页面名"}` | 内嵌页面引用 |

### 2.4 类型推断规则

系统自动推断 value 类型：

```typescript
function inferType(value: string): PropertyType {
  // 1. Boolean
  if (value === 'true' || value === 'false') return 'boolean'
  
  // 2. Number
  if (/^-?\d+$/.test(value)) return 'number'      // 整数
  if (/^-?\d+\.\d+$/.test(value)) return 'number' // 浮点数
  
  // 3. Array
  if (value.startsWith('[') && value.endsWith(']')) return 'array'
  
  // 4. DateTime
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'datetime'
  
  // 5. Date
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date'
  
  // 6. Link（包含 [[...]]）
  if (/\[\[.+?\]\]/.test(value)) return 'link'
  
  // 7. String（默认）
  return 'string'
}
```

**注意：** 类型推断是启发式的，用户可通过 UI 强制指定类型。

### 2.5 特殊 Value 格式

#### 多行文本

使用 `"""` 包裹：

```
描述:: """
这是多行描述内容。
可以包含换行和特殊字符：#标签 [[链接]]
第二行内容。
"""
```

#### 空值

```
备注:: null      ← 显式 null
备注:: ""        ← 空字符串
备注:: []        ← 空数组
```

***

## 3. 属性位置

### 3.1 Page Properties（页面属性）

位于 Markdown 文件头部，以 `---` 分隔：

```markdown
---
title:: 页面标题
created-at:: 2026-04-16T10:30:00Z
alias:: [别名1, 别名2]
type:: journal
---

# 页面标题

正文内容...
```

**规则：**

- 必须位于文件最开头
- 以 `---` 开始，以 `---` 或空行结束
- 仅对 Page Block 有效
- 系统保留属性：`title`, `created-at`, `updated-at`, `alias`, `type`

### 3.2 Block Properties（块属性）

嵌入在 Block 内容中：

```markdown
## 任务 A
状态:: 进行中
优先级:: 高
截止日期:: 2026-04-20

这是任务 A 的详细描述...
```

**规则：**

- 位于 Block 内容开头（标题行之后）
- 连续多行属性，遇空行或正文结束
- 属性行不计入 Block.content

### 3.3 属性与正文的边界

```markdown
## 任务标题
状态:: 进行中      ← 属性
负责人:: 张三       ← 属性

这是正文内容...     ← 正文开始
状态:: 已完成       ← 这行属于正文，不是属性！
```

**识别规则：**

- 标题行后的连续 `key:: value` 行 → 属性
- 遇空行、非 `key:: value` 格式行 → 正文开始
- 正文中的 `key:: value` 视为普通文本

***

## 4. 存储策略

### 4.1 Phase 1（Block.properties 缓存字段）

Phase 1 不引入独立 Property 表。Property 作为 Block.content 内嵌文本解析后，序列化存入 `Block.properties` JSON 字段。

```typescript
// Phase 1 存储：BlockRecord.properties
interface BlockRecord {
  id: string
  pageId: string          // 所属页面 ID（必须，非空）
  parentId: string | null // 父 Block（null = 直接子节点）
  leftId: string | null   // 左侧兄弟（Gap 排序）
  content: string         // 纯文本
  format: string          // JSON 字符串
  type: string            // 'bullet' | 'property' | 'query' | 'embed'
  properties: string      // JSON 字符串，如 '{"状态": "进行中", "优先级": "高"}'
  createdAt: number       // IndexedDB 内部存 number 时间戳，adapter 负责与 ISO string 互转
  updatedAt: number       // 同上
}

**写入流程：**
```
Block.content 输入
    ↓
Parser.parseBlockProperties(content)  // 提取所有 key:: value
    ↓
序列化为 JSON 对象
    ↓
写入 Block.properties（覆盖式）
    ↓
BlockRecord 整体写入 IndexedDB
```

**读取流程：**
```
从 IndexedDB 读取 BlockRecord
    ↓
JSON.parse(properties) → 内存对象
    ↓
UI 直接消费内存对象
```

**说明：**
- Phase 1 按 key 查询 = 全表扫描 BlockRecord + 逐条解析 JSON，性能较差但 MVP 可接受
- Phase 2 引入 Property 表后，按 key 查询走索引，性能提升

### 4.2 Phase 2/3（独立 Property 表）

```sql
CREATE TABLE Property (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    blockId     TEXT NOT NULL,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,        -- JSON 序列化
    type        TEXT NOT NULL,        -- 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'array' | 'link'
    createdAt   TEXT NOT NULL,        -- ISO 8601
    updatedAt   TEXT NOT NULL,        -- ISO 8601
    UNIQUE(blockId, key),
    FOREIGN KEY (blockId) REFERENCES Block(id)
);

-- 索引
CREATE INDEX idx_property_blockId ON Property(blockId);
CREATE INDEX idx_property_key ON Property(key);
CREATE INDEX idx_property_type ON Property(type);
```

### 4.3 Phase 2/3 缓存策略：Property 表与 Block.properties 双写

Phase 2/3 引入独立 Property 表后，`Block.properties` JSON 字段降级为只读缓存，Property 表为数据源：

```typescript
interface BlockRecord {
  id: string
  content: string
  // ...
  properties?: string  // JSON 字符串，如 '{"状态": "进行中", "优先级": "高"}'
}
```

**同步策略：**

- 写入时：同时更新 `Property` 表和 `Block.properties`
- 读取时：优先从 `Block.properties` 解析（单表查询）
- 不一致时：以 `Property` 表为准，重建缓存

***

## 5. 系统保留属性

### 5.1 Page 级保留属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `title` | string | 页面显示标题 |
| `created-at` | datetime | 创建时间 |
| `updated-at` | datetime | 最后更新时间 |
| `alias` | array | 页面别名列表 |
| `type` | string | 页面类型：`page` / `journal` |
| `journal-date` | date | 日志日期（type=journal 时） |

### 5.2 系统前缀 `sys-`

以 `sys-` 开头的属性保留给系统使用，用户不建议使用：

```
sys-version:: 1.0.0
sys-sync-id:: xxx-xxx
```

***

## 6. UI 交互

> **Phase 1 范围：** 仅支持在 Block 编辑态中直接编辑内嵌 `key:: value` 文本，不提供独立属性面板。Phase 2 新增属性面板和高级 UI。

### 6.1 Phase 1：Block 内嵌编辑

**行内编辑：**

```
┌─────────────────────────────────────┐
│ 状态:: [进行中 ▼]  优先级:: [高 ▼]   │
│ 负责人:: [张三      ]               │
│ 截止日期:: [2026-04-20]             │
└─────────────────────────────────────┘
```

**编辑模式：**

- 单击属性值 → 进入编辑
- 按 Enter → 保存并退出
- 按 Esc → 取消编辑
- 属性行末尾 `+` 按钮 → 添加新属性

### 6.2 属性面板

侧边栏属性面板：

```
┌─────────────────┐
│ 属性            │
├─────────────────┤
│ 状态      进行中 │
│ 优先级    高     │
│ 截止日期  4/20   │
│                 │
│ [+ 添加属性]    │
└─────────────────┘
```

### 6.3 属性输入辅助

**类型选择器：**

添加属性时选择类型：

```
属性名: [________]
属性类型: [文本 ▼]
          ├─ 文本
          ├─ 数字
          ├─ 日期
          ├─ 选项
          └─ 链接
```

**自动完成：**

- 输入属性名时提示已有属性
- 输入属性值时根据类型提示（如日期选择器、数字滑块）

### 6.4 属性筛选

查询构建器：

```
筛选: [状态 ▼] [等于 ▼] [已完成]
   AND [优先级 ▼] [属于 ▼] [高, 紧急]
   AND [截止日期 ▼] [早于 ▼] [今天]
```

***

## 7. 与 tiptap 集成

### 7.1 Property Node

```typescript
import { Node } from '@tiptap/core'

export const Property = Node.create({
  name: 'property',
  
  group: 'block',
  defining: true,
  
  addAttributes() {
    return {
      key: { default: '' },
      value: { default: '' },
      type: { default: 'string' },
    }
  },
  
  parseHTML() {
    return [
      {
        tag: 'div[data-property]',
        getAttrs: element => ({
          key: element.getAttribute('data-key'),
          value: element.getAttribute('data-value'),
          type: element.getAttribute('data-type'),
        }),
      },
    ]
  },
  
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(
      { 
        'data-property': '',
        'data-key': HTMLAttributes.key,
        'data-value': HTMLAttributes.value,
        'data-type': HTMLAttributes.type,
        class: 'property-line',
      },
      HTMLAttributes
    ), `${HTMLAttributes.key}:: ${HTMLAttributes.value}`]
  },
})
```

### 7.2 输入规则

输入 `key:: `（冒号+空格）自动识别为属性行：

```typescript
addInputRules() {
  return [
    textInputRule({
      find: /^([\w\u4e00-\u9fa5_-]+):: $/,
      type: this.type,
      getAttributes: match => ({ 
        key: match[1], 
        value: '',
        type: 'string',
      }),
    }),
  ]
}
```

***

## 8. 查询 API

### 8.1 基础查询

```typescript
// 获取 Block 的所有属性
function getBlockProperties(blockId: string): Promise<Record<string, any>>

// 获取特定属性值
function getProperty(blockId: string, key: string): Promise<any>

// 按属性筛选 Block
function findBlocksByProperty(
  key: string, 
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'in' | 'contains',
  value: any
): Promise<Block[]>
```

### 8.2 复杂查询

```typescript
// 多条件组合
interface PropertyFilter {
  key: string
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'in' | 'contains'
  value: any
}

function findBlocks(filters: PropertyFilter[], logic: 'AND' | 'OR'): Promise<Block[]>

// 使用示例
findBlocks([
  { key: '状态', operator: 'eq', value: '进行中' },
  { key: '优先级', operator: 'in', value: ['高', '紧急'] },
], 'AND')
```

***

## 9. 测试用例

```typescript
describe('Property Parser', () => {
  test('基础属性', () => {
    expect(parseProperty('状态:: 进行中')).toEqual({
      key: '状态',
      value: '进行中',
      type: 'string',
    })
  })
  
  test('数字类型', () => {
    expect(parseProperty('进度:: 75')).toEqual({
      key: '进度',
      value: 75,
      type: 'number',
    })
  })
  
  test('布尔类型', () => {
    expect(parseProperty('完成:: true')).toEqual({
      key: '完成',
      value: true,
      type: 'boolean',
    })
  })
  
  test('数组类型', () => {
    expect(parseProperty('标签:: [a, b, c]')).toEqual({
      key: '标签',
      value: ['a', 'b', 'c'],
      type: 'array',
    })
  })
  
  test('无效格式', () => {
    expect(parseProperty('key:value')).toBeNull()  // 缺少空格
    expect(parseProperty(':: value')).toBeNull()   // 缺少 key
  })
})
```

***

## 10. 与 Tag、Link 的关系

| 场景 | 处理 |
|------|------|
| Property value 含 `#标签` | 作为纯文本存储，不创建 Tag 关联 |
| Property value 含 `[[链接]]` | 解析为 link 类型，创建 Link 记录 |
| Tag 与 Property 同名 | 独立处理，互不影响 |
| 属性名 `tags` | 建议用数组类型存储，与 `#标签` 语法区分 |

***

*文档由 AI 助手协助生成，待开发者评审确认。*
