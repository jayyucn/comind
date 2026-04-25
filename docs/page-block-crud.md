# Page ↔ Block CRUD 联动逻辑

> 版本：v0.1
> 日期：2026-04-24
> 状态：初稿

---

## 核心原则

1. **Page 是主动方**：创建页面时连带创建根 Block
2. **Block 被动跟随**：修改 Page 元数据不影响 Block，反之亦然
3. **删除 Page = 删除整个 Block 树 + 相关 Link**
4. **所有操作在事务内完成**（Phase 2/3 SQLite）

---

## 数据结构确认

### Page 表

```typescript
interface Page {
  id: string              // 主键
  blockId: string | null  // 根 Block ID（新建时可能为空，写入时填充）

  title: string
  type: 'normal' | 'journal'
  icon: string | null
  cover: string | null
  aliases: string[]
  filePath: string | null

  childrenCount: number   // 缓存
  wordCount: number       // 缓存

  createdAt: string
  updatedAt: string
}
```

### Block 表

```typescript
interface Block {
  id: string
  pageId: string          // 所属页面（必须，非空）
  parentId: string | null // 父 Block（null = 直接子节点）
  leftId: string | null   // 左侧兄弟（Gap 排序）

  content: string         // 纯文本
  format: Record<string, any> // 格式信息

  type: 'bullet' | 'property' | 'query' | 'embed'
  properties: Record<string, any>

  createdAt: string
  updatedAt: string
}
```

### Link 表

```typescript
interface Link {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  createdAt: string
}
```

---

## 一、Create（创建）

### 场景 1：创建空白页面

**用户操作**：点击 "新建页面" 按钮

**前置**：用户输入了 title

```typescript
async function createPage(title: string, type: 'normal' | 'journal' = 'normal') {
  const now = new Date().toISOString()

  // 1. 创建根 Block（页面内容的根节点）
  const rootBlock = await blockStore.createBlock({
    pageId: null,        // 先 null，后面再更新
    parentId: null,
    leftId: null,
    content: '',
    format: {},
    type: 'bullet',
    properties: {},
  })

  // 2. 创建 Page，关联根 Block
  const page = await db.page.create({
    id: generateId(),
    blockId: rootBlock.id,
    title,
    type,
    icon: null,
    cover: null,
    aliases: [],
    filePath: null,
    childrenCount: 0,
    wordCount: 0,
    createdAt: now,
    updatedAt: now,
  })

  // 3. 回填 Block.pageId（建立双向关联）
  await blockStore.updateBlock(rootBlock.id, { pageId: page.id })

  return page
}
```

### 场景 2：创建日记页面（自动标题）

**用户操作**：点击 "新建日记"

**前置**：title = today's date（如 "2026-04-24"）

```typescript
async function createJournalPage(date: Date = new Date()) {
  const title = formatDate(date, 'yyyy-MM-dd')

  // 检查是否已存在
  const existing = await db.page.findOne({
    where: { title, type: 'journal' }
  })
  if (existing) return existing

  return createPage(title, 'journal')
}
```

### 场景 3：在页面内创建 Block

**用户操作**：在页面内输入文字

**前置**：Page 已存在，用户在编辑根 Block

```typescript
async function createBlock(pageId: string, content: string) {
  const page = await db.page.findById(pageId)

  // 找到最后一个直接子节点（用于 leftId 排序）
  const lastChild = await blockStore.getLastChild(page.blockId)

  return blockStore.createBlock({
    pageId,
    parentId: page.blockId,  // 挂到根 Block 下
    leftId: lastChild?.id ?? null,
    content,
    format: {},
    type: 'bullet',
    properties: {},
  })
}
```

---

## 二、Read（读取）

### 读取单个页面

```typescript
async function getPage(pageId: string) {
  const page = await db.page.findById(pageId)
  if (!page) return null

  // 加载页面下的所有 Block
  const blocks = await blockStore.getBlocksByPage(pageId)

  return {
    page,
    blocks,
  }
}
```

### 加载页面 Block 树（递归）

```typescript
async function getBlocksByPage(pageId: string) {
  const page = await db.page.findById(pageId)

  // 从根 Block 开始，递归加载子树
  const rootBlock = await blockStore.getBlock(page.blockId)
  const children = await blockStore.getChildren(rootBlock.id)

  // 递归加载所有层级
  return buildTree(rootBlock, children)
}

async function getChildren(parentId: string): Promise<Block[]> {
  return db.block
    .where('parentId').equals(parentId)
    .sortBy('leftId')  // 按 leftId 排序
}

function buildTree(block: Block, children: Block[]): BlockNode {
  return {
    ...block,
    children: children.map(child =>
      buildTree(child, getChildrenSync(child.id))
    )
  }
}
```

### 读取页面列表（元数据）

```typescript
async function getPages(options?: {
  type?: 'normal' | 'journal'
  search?: string
  limit?: number
  offset?: number
}) {
  let query = db.page.query()

  if (options?.type) {
    query = query.where('type').equals(options.type)
  }

  if (options?.search) {
    query = query.filter(p =>
      p.title.includes(options.search) ||
      p.aliases.some(a => a.includes(options.search))
    )
  }

  return query.sortBy('updatedAt', 'desc').slice(offset, limit)
}

// 日记列表
async function getJournals(yearMonth?: string) {
  const page = await db.page.find({
    where: { type: 'journal' }
  })

  if (yearMonth) {
    return page.filter(p => p.title.startsWith(yearMonth))
  }

  return page.sortBy('title', 'desc')
}
```

---

## 三、Update（更新）

### 更新 Page 元数据

```typescript
async function updatePage(pageId: string, patch: Partial<Page>) {
  const page = await db.page.findById(pageId)
  if (!page) throw new Error('Page not found')

  // 只更新 Page 表字段
  const updated = await db.page.update(pageId, {
    ...patch,
    updatedAt: new Date().toISOString(),
  })

  // 如果更新了 title，Block 的 content 呢？
  // → 保持独立：Page.title 是"显示标题"，Block.content 是"实际内容"
  // → 两者初始相同，但修改 Page.title 不会改 Block.content

  return updated
}
```

### 更新 Block 内容

```typescript
async function updateBlock(blockId: string, patch: Partial<Block>) {
  const block = await db.block.findById(blockId)

  // 更新 Block
  const updated = await db.block.update(blockId, {
    ...patch,
    updatedAt: new Date().toISOString(),
  })

  // 同步更新 Page 缓存
  if (block.pageId) {
    await syncPageStats(block.pageId)
  }

  return updated
}

// 同步页面统计（childrenCount, wordCount）
async function syncPageStats(pageId: string) {
  const blocks = await blockStore.getBlocksByPage(pageId)

  const count = blocks.length
  const words = blocks.reduce((sum, b) => sum + b.content.split(/\s+/).length, 0)

  await db.page.update(pageId, {
    childrenCount: count,
    wordCount: words,
    updatedAt: new Date().toISOString(),
  })
}
```

### 重命名页面（特殊场景）

```typescript
async function renamePage(pageId: string, newTitle: string) {
  const page = await db.page.findById(pageId)

  await db.transaction(async () => {
    // 1. 更新 Page.title
    await db.page.update(pageId, { title: newTitle })

    // 2. 可选：同步更新根 Block.content
    // → 如果希望"标题即内容"，解开注释
    // await blockStore.updateBlock(page.blockId, { content: newTitle })

  })
}
```

---

## 四、Delete（删除）

### 删除页面（级联删除）

```typescript
async function deletePage(pageId: string) {
  const page = await db.page.findById(pageId)
  if (!page) return

  await db.transaction(async () => {
    // 1. 删除所有相关 Link
    //    - source 在该页面内的链接
    //    - target 指向该页面的链接
    await db.link.where('sourceBlockId').in(
      await getAllBlockIds(pageId)
    ).delete()

    await db.link.where('targetPageId').equals(pageId).delete()

    // 2. 删除该页面下的所有 Block（递归）
    await deleteBlockTree(page.blockId)

    // 3. 删除 Page 本身
    await db.page.delete(pageId)

  })
}

async function deleteBlockTree(blockId: string) {
  // 递归删除所有子 Block
  const children = await db.block.where('parentId').equals(blockId).toArray()

  for (const child of children) {
    await deleteBlockTree(child.id)
  }

  await db.block.delete(blockId)
}
```

### 删除单个 Block

```typescript
async function deleteBlock(blockId: string) {
  const block = await db.block.findById(blockId)

  await db.transaction(async () => {
    // 1. 删除所有子 Block
    await deleteBlockTree(blockId)

    // 2. 删除以该 Block 为 source 的 Link
    await db.link.where('sourceBlockId').equals(blockId).delete()

    // 3. 同步父 Block 的页面统计
    if (block.pageId) {
      await syncPageStats(block.pageId)
    }

  })
}
```

---

## 五、事务边界

### 什么需要事务？

| 操作 | 是否需要事务 |
|------|------------|
| 创建页面 + 根 Block | ✅ |
| 删除页面 + 所有 Block + Link | ✅ |
| 移动 Block 到另一个页面 | ✅（更新 pageId） |
| 更新 Block 内容 | ❌（单表操作） |
| 更新 Page 元数据 | ❌（单表操作） |

### 存储层事务接口

```typescript
interface StorageTransaction {
  createPage(data: PageData): Promise<Page>
  createBlock(data: BlockData): Promise<Block>
  updateBlock(id: string, patch: Partial<Block>): Promise<Block>
  updatePage(id: string, patch: Partial<Page>): Promise<Page>
  deletePage(id: string): Promise<void>
  deleteBlock(id: string): Promise<void>

  // 批量操作
  batch(fn: (tx: StorageTransaction) => Promise<void>): Promise<void>
}

// 使用示例
await db.transaction(async (tx) => {
  const page = await tx.createPage({ title: '新页面' })
  const rootBlock = await tx.createBlock({ pageId: page.id, ... })
  await tx.updatePage(page.id, { blockId: rootBlock.id })
})
```

---

## 六、Phase 1 适配（LocalStorage）

```typescript
// LocalStorage 没有事务，用队列模拟
class LocalStorageAdapter {
  private queue: (() => Promise<void>)[] = []

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.queue.push(fn)
    return fn()  // 简化：立即执行
  }

  async syncPageStats(pageId: string) {
    // LocalStorage 下，统计更新延迟到下次读取时计算
    // 不做实时缓存
  }
}
```

### 操作联动表

| 操作 | 触发方 | 联动效果 |
|------|--------|----------|
| 创建 Page | 用户 | 自动创建根 Block，回填 blockId |
| 删除 Page | 用户 | 级联删除所有 Block + Link |
| 更新 Page.title | 用户 | 仅 Page 表，不动 Block |
| 创建 Block | 用户 | 绑定 pageId，可选更新统计 |
| 删除 Block | 用户 | 级联删除子 Block + Link，同步统计 |
| 更新 Block.content | 用户 | 同步 Page 统计（延迟） |

---

*文档由 AI 助手协助生成，待开发者评审确认。*