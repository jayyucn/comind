# comind 架构设计

> 版本：v4.2（同步基础能力）
> 日期：2026-07-24
> 状态：活跃
> 来源：合并自 data-model.md + storage-spec.md + routing-design.md + block-editor-spec.md + property-spec.md + block-ordering-redesign.md
> 更新：v0.5 Link 数据模型扩展（支持 relationshipType）；v4.2 新增 version 和 deleted_at 字段，支持 LWW 同步和软删除

---

## 1. 数据模型

### 1.1 核心设计决策

**Page 与 Block 是独立表。** Page 是 Block 的容器，不是 Block 本身。`Page.blockId` 建立与根 Block 的 1:1 关系。

**Block.type 是枚举：**

```typescript
type BlockType = 'bullet' | 'property' | 'query' | 'embed'
```

### 1.2 Block

```typescript
interface Block {
  id: string              // UUID v4
  pageId: string          // 所属页面（必须，非空）
  parentId: string | null // 父 Block（null = 直接子节点）
  pos: number             // 排序位置（Gap 排序，初始间隔 1000）
  content: string         // 纯文本
  format: Record<string, any> // 格式信息
  type: BlockType
  properties: Record<string, any> // 属性对象（存储层为 JSON 字符串）
  createdAt: number
  updatedAt: number
  version: number         // 单调递增版本号，用于同步 LWW 判断
  deletedAt: number | null // 软删除时间戳（毫秒），NULL = 未删除
}
```

**关键字段：**

| 字段 | 说明 |
|------|------|
| `id` | UUID v4，全局唯一 |
| `pageId` | 所属页面，**非空**。根 Block 也指向所属 Page |
| `parentId` | 父 Block ID，`null` = 直接子节点 |
| `pos` | 排序位置（Gap 整数排序，初始间隔 1000） |
| `content` | 纯文本内容，不含 Markdown 格式标记 |
| `format` | 格式信息（标题级别、列表类型等） |
| `properties` | 属性对象（`key:: value` 解析结果） |
| `version` | 单调递增版本号，每次 update/delete 时 +1，用于多端同步 LWW 冲突解决 |
| `deletedAt` | 软删除时间戳（毫秒），同步时传播删除操作 |

### 1.3 Page

```typescript
interface Page {
  id: string
  blockId: string | null  // 根 Block ID（新建时可能为空，写入时填充）
  title: string
  type: 'normal' | 'journal'
  icon: string | null
  cover: string | null
  aliases: string[]
  filePath: string | null
  childrenCount: number   // 缓存
  wordCount: number       // 缓存
  createdAt: number
  updatedAt: number
  version: number         // 单调递增版本号，用于同步 LWW 判断
  deletedAt: number | null // 软删除时间戳（毫秒），NULL = 未删除
}
```

### 1.4 Link

```typescript
interface Link {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  relationshipType: string | null  // v0.5 新增
  inverseRelationshipType: string | null  // v0.5 新增
  createdAt: number
  version: number         // 单调递增版本号，用于同步 LWW 判断
  deletedAt: number | null // 软删除时间戳（毫秒），NULL = 未删除
}
```

### 1.5 Property

- 语法：`key:: value`（行首，`::` 前后各一个空格）
- 解析时从 Block.content 提取，写入 `Block.properties`
- 显示类型：`text`、`url`、`date`、`page_ref`

---

## 2. 存储格式

### 2.1 Dexie Schema（版本 7，v0.5 扩展）

```typescript
this.version(7).stores({
  blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
  links: 'id, sourceBlockId, targetPageId, displayText, relationshipType, createdAt',  // v0.5 新增 relationshipType 索引
  pages: 'id, blockId, title, type, createdAt, updatedAt'
})
```

### 2.2 IDB 记录格式

```typescript
interface BlockRecord {
  id: string
  pageId: string
  parentId: string | null
  pos: number
  content: string
  format: string          // JSON 字符串
  type: string
  properties: string      // JSON 字符串
  createdAt: number
  updatedAt: number
}
```

### 2.3 Markdown 存储（Phase 2/3）

**Block → Markdown 转换：**

```markdown
## 一级标题（根 Block，title 行）
    - 子 Block 1（缩进 = 层级）
    - 子 Block 2
        - 孙 Block 1
```

**Page → Markdown 文件：**

```markdown
---
title: 页面标题
type: normal
icon: 📄
aliases: []
---

## 根 Block 标题
    - 子 Block 1
    - 子 Block 2
```

---

## 3. 路由设计

### 3.1 URL 结构

```
/                     → 首页（重定向到第一个页面）
/pages/:pageId        → 页面详情页
/journal/:date        → 日记页面
```

### 3.2 路由守卫

```typescript
router.beforeEach((to, from, next) => {
  // 保存当前 Block 内容（如果正在编辑）
  if (editorStore.activeBlockId) {
    editorStore.deactivateBlock()
  }
  next()
})
```

---

## 4. 编辑器架构

### 4.1 核心约束

**约束 1：单编辑器原则（最重要）**
- 任何时刻，系统只能存在 **1 个活跃的 tiptap 编辑器实例**
- 任何时刻，只有 **1 个 Block 处于编辑状态**
- 编辑器必须随 Block 切换而销毁或复用

**约束 2：Block 是唯一数据单元**
- 系统所有数据围绕 Block 构建：编辑、层级结构、存储、Page 组成
- 禁止引入"文档级编辑模型"

**约束 3：状态驱动，而非 DOM 驱动**
- 所有行为通过状态机控制（`activeBlockId`、Block 树结构）
- 禁止直接 DOM 操作控制业务逻辑

**约束 4：Phase 1 不引入虚拟列表**
- 100 个 Block ≈ 100 个 DOM 节点，浏览器性能完全可承受

### 4.2 Block 结构

```
BlockNode
├── content: string        // 纯文本
├── format: FormatInfo     // 格式（title, bullet, etc.）
├── properties: Record     // 属性
├── collapsed: boolean     // 折叠状态
└── children: BlockNode[]  // 子节点（运行时组装）
```

### 4.3 编辑器状态

```typescript
interface EditorState {
  activeBlockId: string | null  // 当前编辑中的 Block ID
}
```

---

## 5. 属性系统

### 5.1 Property 语法

```
status:: done           → { status: "done" }
due:: 2026-05-20        → { due: "2026-05-20" }
priority:: 1            → { priority: 1 }
done:: true             → { done: true }
tags:: [a, b]           → { tags: ["a", "b"] }
related:: [[页面名]]    → { related: "页面名" }
```

### 5.2 解析规则

1. 逐行检查 `^(key):: (value)$` 格式
2. 匹配行从 Block.content 中移除（不显示为文本）
3. 解析结果写入 Block.properties
4. 未匹配行保留为普通文本

### 5.3 值类型推断

| 模式 | 推断类型 |
|------|---------|
| `true` / `false` | boolean |
| `YYYY-MM-DD` | date |
| `[[...]]` | page_ref |
| `[...]` | list |
| `123` | number |
| 其他 | text |

---

## 6. 排序机制（Gap 整数排序）

### 6.1 核心思想

- 每个节点有一个 `pos: number` 字段，直接存储在 Block 主数据结构中
- 初始间隔为 1000（`GAP_SIZE`），预留足够的插入空间
- 同一 `parentId` 下的兄弟按 `pos` 升序排列
- 排序只需 `sort((a, b) => a.pos - b.pos)`，O(n log n)

### 6.2 核心算法

**插入位置计算：**

```typescript
function calcInsertPos(prevPos: number | null, nextPos: number | null): number {
  if (prevPos === null && nextPos === null) return GAP_SIZE
  if (prevPos === null) return nextPos! - GAP_SIZE
  if (nextPos === null) return prevPos + GAP_SIZE
  return (prevPos + nextPos) / 2
}
```

**间隔耗尽检测：** 当 `(prevPos + nextPos) / 2` 等于 `prevPos` 或 `nextPos` 时，需要重编号。

**重编号：**

```typescript
function renumberBlocks(blocks: Block[]): void {
  const sorted = [...blocks].sort((a, b) => a.pos - b.pos)
  sorted.forEach((block, index) => {
    block.pos = (index + 1) * GAP_SIZE
  })
}
```

### 6.3 关键规则：先计算 pos 再修改 parentId

所有涉及层级变更的操作（indent、outdent）**必须先计算新位置，再修改 parentId**：

```
✅ 正确顺序：
  children = getChildren(prev.id) // block 还在原层级，结果正确
  newPos = calcInsertPos(...)     // pos 计算正确
  block.parentId = newParentId    // 最后改层级
  block.pos = newPos
```

---

*本文档由 6 个架构相关文档合并而成，版本 v4.0*
