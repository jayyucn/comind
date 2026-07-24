# 数据模型设计

> 版本：v0.6
> 日期：2026-07-24
> 状态：✅ 已实现
> 变更：v0.6 新增 version 和 deleted_at 字段，支持 LWW 同步和软删除

---

## 1. 核心设计决策

### 1.1 引入独立 Page 表

**决策：Page 与 Block 分离存储**

理由：
- Page 是 Block 的容器，不是 Block 的角色
- Page 分 `normal` 和 `journal` 两种类型，独立表查询更清晰
- `Page.blockId` 建立与根 Block 的 1:1 关联

### 1.2 Block.type 枚举化

**决策：`Block.type` 使用枚举**

```typescript
type BlockType = 'bullet' | 'property' | 'query' | 'embed'
```

支持未来扩展 `query`/`embed` 等类型。

### 1.3 Property 只关联 Block

**决策：Property 表只有 `blockId`，不关联 Page**

理由：
- Page 的属性通过其根 Block 表达
- 统一模型：所有属性都挂在 Block 上
- 查询逻辑一致，减少冗余

### 1.4 Gap 排序（pos 字段）

**决策：使用 `pos` 字段替代 `leftId`**

```typescript
interface Block {
  pos: number  // Gap 排序，初始间隔 1000
}
```

优势：
- 插入新 Block 时只需计算新 pos（无需更新相邻记录）
- 排序性能 O(n log n)（按 pos 排序）
- 避免 `leftId` 链式更新的复杂性

---

## 2. 数据模型

### 2.1 Page 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | string | PK, UUID | 唯一标识 |
| `blockId` | string \| null | FK → Block.id, UNIQUE | 关联根 Block，1:1 |
| `title` | string | NOT NULL | 页面标题 |
| `type` | string | NOT NULL, CHECK IN ('normal', 'journal') | 页面类型 |
| `icon` | string \| null |  | Emoji 图标 |
| `cover` | string \| null |  | 封面图路径 |
| `aliases` | string | NOT NULL, DEFAULT '[]' | 别名列表，JSON 数组 |
| `filePath` | string \| null |  | 关联文件路径 |
| `childrenCount` | integer | NOT NULL, DEFAULT 0 | 直接子 Block 数量 |
| `wordCount` | integer | NOT NULL, DEFAULT 0 | 页面总字数 |
| `createdAt` | number | NOT NULL | 创建时间戳（毫秒） |
| `updatedAt` | number | NOT NULL | 更新时间戳（毫秒） |
| `version` | number | NOT NULL, DEFAULT 0 | 单调递增版本号，用于同步 LWW 判断 |
| `deletedAt` | number \| null | DEFAULT NULL | 软删除时间戳（毫秒），NULL = 未删除 |

**说明：**
- `blockId` 建立 Page 与根 Block 的 1:1 关联
- `title` 独立存储，不依赖 Block.content
- `type` 区分普通页面和日记页面
- `aliases` 存储为 JSON 字符串（读取时解析）
- `version` 每次 update/delete 时 +1，用于多端同步时的 LWW（Last Write Wins）冲突解决
- `deletedAt` 替代旧 `deleted` 字段，同步时传播删除操作

**IndexedDB 定义：**
```typescript
// db.ts
db.version(1).stores({
  pages: '++id, title, type',
})
```

### 2.2 Block 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | string | PK, UUID | 唯一标识 |
| `pageId` | string | FK → Page.id, NOT NULL | 所属页面，必须非空 |
| `parentId` | string \| null | FK → Block.id | 父 Block（NULL = 根 Block） |
| `pos` | number | NOT NULL, DEFAULT 1000 | Gap 排序位置 |
| `content` | string | NOT NULL, DEFAULT '' | 块内容（纯文本） |
| `format` | string | NOT NULL, DEFAULT '{}' | 格式，JSON 对象 |
| `type` | string | NOT NULL, DEFAULT 'bullet' | 块类型 |
| `properties` | string | NOT NULL, DEFAULT '{}' | 附加属性，JSON 对象 |
| `createdAt` | number | NOT NULL | 创建时间戳（毫秒） |
| `updatedAt` | number | NOT NULL | 更新时间戳（毫秒） |
| `version` | number | NOT NULL, DEFAULT 0 | 单调递增版本号，用于同步 LWW 判断 |
| `deletedAt` | number \| null | DEFAULT NULL | 软删除时间戳（毫秒），NULL = 未删除 |

**说明：**
- `pageId` 必须非空，每个 Block 必须属于某个 Page
- `pos` 实现 Gap 排序（初始间隔 1000，插入时取中点）
- `format` 存储为 JSON 字符串（如 `{'bold': true}`）
- `properties` 存储为 JSON 字符串（与 Property 表冗余，用于快速查询）
- `version` 每次 update/delete 时 +1，用于多端同步时的 LWW（Last Write Wins）冲突解决
- `deletedAt` 同步时传播删除操作

**IndexedDB 定义：**
```typescript
// db.ts
db.version(1).stores({
  blocks: '++id, pageId, parentId, pos',
})
```

**Gap 排序算法：**
```typescript
// 计算新 Block 的 pos
function calcInsertPos(prevPos: number | null, nextPos: number | null): number {
  if (prevPos === null && nextPos === null) return 1000
  if (prevPos === null) return nextPos / 2
  if (nextPos === null) return prevPos + 1000
  return (prevPos + nextPos) / 2
}
```

### 2.3 Link 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | string | PK, UUID | 唯一标识 |
| `sourceBlockId` | string | FK → Block.id, NOT NULL | 源 Block |
| `targetPageId` | string \| null | FK → Page.id | 目标页面（内部链接） |
| `displayText` | string | NOT NULL | 显示文本 |
| `createdAt` | number | NOT NULL | 创建时间戳（毫秒） |
| `version` | number | NOT NULL, DEFAULT 0 | 单调递增版本号，用于同步 LWW 判断 |
| `deletedAt` | number \| null | DEFAULT NULL | 软删除时间戳（毫秒），NULL = 未删除 |

**说明：**
- 外部链接 `targetPageId` 为 NULL
- 内部链接同时存储 `targetPageId` 和 `displayText`
- 无 `type` 字段（Link 类型由 `targetPageId` 是否为 NULL 推断）
- `version` 每次 update/delete 时 +1，用于多端同步时的 LWW（Last Write Wins）冲突解决
- `deletedAt` 同步时传播删除操作

**IndexedDB 定义：**
```typescript
// db.ts
db.version(1).stores({
  links: '++id, sourceBlockId, targetPageId',
})
```

### 2.4 Property 表

> 详细定义见 `../3-features/property-spec.md`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | string | PK, UUID | 唯一标识 |
| `blockId` | string | FK → Block.id, NOT NULL | 所属 Block |
| `key` | string | NOT NULL | 属性名 |
| `value` | string | NOT NULL | 属性值，JSON 序列化 |
| `type` | string | NOT NULL | 属性类型 |
| `sortOrder` | number | NOT NULL, DEFAULT 0 | 排序权重 |
| `isHidden` | number | NOT NULL, DEFAULT 0 | 是否隐藏（0=显示, 1=隐藏） |
| `isDeleted` | number | NOT NULL, DEFAULT 0 | 软删除标记（0=正常, 1=删除） |
| `schemaVersion` | number | NOT NULL, DEFAULT 1 | Schema 版本 |
| `createdAt` | number | NOT NULL | 创建时间戳（毫秒） |
| `updatedAt` | number | NOT NULL | 更新时间戳（毫秒） |
| `version` | number | NOT NULL, DEFAULT 0 | 单调递增版本号，用于同步 LWW 判断 |
| `deletedAt` | number \| null | DEFAULT NULL | 软删除时间戳（毫秒），NULL = 未删除 |

**索引：**
- `blockId`：查询某个 Block 的所有属性
- `[blockId+key]`：复合索引，查询某个 Block 的特定属性（唯一约束）
- `key`：按属性名查询
- `type`：按属性类型查询

**IndexedDB 定义：**
```typescript
// db.ts
db.version(1).stores({
  properties: '++id, blockId, [blockId+key], key, type',
})
```

---

## 3. Page ↔ Block 联动规则

### 3.1 创建 Page

**代码实现：** `IndexedDBAdapter.createPageWithRootBlock()`

```
事务内：
  1. 创建根 Block（parentId = NULL, pos = 1000）
  2. 创建 Page，填充 blockId 指向根 Block
  3. 更新根 Block.pageId 指向 Page
  4. 事务提交（原子性保证）
```

**伪代码：**
```typescript
async createPageWithRootBlock(title: string, type: 'normal' | 'journal'): Promise<Page> {
  const now = Date.now()
  
  // 1. 创建根 Block
  const rootBlock: Block = {
    id: generateUUID(),
    pageId: '', // 先空，后续更新
    parentId: null,
    pos: 1000,
    content: '',
    format: {},
    type: 'bullet',
    properties: {},
    createdAt: now,
    updatedAt: now
  }
  
  // 2. 创建 Page
  const page: Page = {
    id: generateUUID(),
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
    updatedAt: now
  }
  
  // 3. 更新 Block.pageId
  rootBlock.pageId = page.id
  
  // 4. 事务保存
  await db.transaction('rw', [db.pages, db.blocks], async () => {
    await db.pages.put(pageToRecord(page))
    await db.blocks.put(blockToRecord(rootBlock))
  })
  
  return page
}
```

### 3.2 删除 Page

**代码实现：** `IndexedDBAdapter.deletePage()`

```
事务内：
  1. 查询 Page 所有 Block.id（递归）
  2. 删除这些 Block 的所有 Link（sourceBlockId）
  3. 删除指向该 Page 的所有 Link（targetPageId）
  4. 删除这些 Block 的所有 Property
  5. 删除这些 Block
  6. 删除 Page
```

**伪代码：**
```typescript
async deletePage(pageId: string): Promise<void> {
  await db.transaction('rw', [db.pages, db.blocks, db.links, db.properties], async () => {
    // 1. 获取页面所有 Block
    const blocks = await db.blocks.where('pageId').equals(pageId).toArray()
    const blockIds = blocks.map(b => b.id)
    
    // 2. 删除所有相关 Link（源 Block）
    await db.links.where('sourceBlockId').anyOf(blockIds).delete()
    
    // 3. 删除所有指向该页面的 Link
    await db.links.where('targetPageId').equals(pageId).delete()
    
    // 4. 删除所有相关 Property
    for (const blockId of blockIds) {
      await this.deletePropertiesByBlockId(blockId)
    }
    
    // 5. 删除所有 Block
    await db.blocks.bulkDelete(blockIds)
    
    // 6. 删除 Page
    await db.pages.delete(pageId)
  })
}
```

### 3.3 更新 Page.title

**代码实现：** `IndexedDBAdapter.renamePage()`

```
1. 更新 Page.title
2. 更新 Page.updatedAt
3. 保存 Page 记录
```

**注意：** 不修改 Block.content（标题存储在 Page 表，不在 Block 中）

### 3.4 删除 Block

**代码实现：** `IndexedDBAdapter.deleteBlock()`

```
事务内：
  1. 删除 Block 记录
  2. 删除 Block 的所有 Link（sourceBlockId）
  3. 删除 Block 的所有 Property
```

**级联删除多个 Block：** `IndexedDBAdapter.deleteBlockCascade()`

```
事务内：
  1. 批量删除 Block 记录
  2. 批量删除所有相关 Link
  3. 批量删除所有相关 Property
```

### 3.5 更新 Block.content

**代码实现：** `IndexedDBAdapter.saveBlock()`

```
事务内：
  1. 保存 Block 记录（blockToRecord）
  2. 解析 Block.content 中的 Link（parseBlockLinks）
  3. 删除旧 Link（sourceBlockId）
  4. 插入新 Link
```

** Link 解析与保存：**
```typescript
private async saveLinks(sourceBlockId: string, _pageId: string, linkParses: LinkParse[]): Promise<void> {
  // 删除旧链接
  await db.links.where('sourceBlockId').equals(sourceBlockId).delete()
  
  for (const link of linkParses) {
    if (!link.isExternal) {
      // 内部链接：查找或创建目标 Page
      const normalized = normalizeJournalTitle(link.targetTitle)
      const lookupTitle = normalized ?? link.targetTitle
      let targetPage = await db.pages.where('title').equals(lookupTitle).first()
      
      if (!targetPage) {
        const pageType = normalized ? 'journal' : inferPageType(link.targetTitle)
        const newPage = await this.createPageWithRootBlock(lookupTitle, pageType)
        targetPage = pageToRecord(newPage)
        await db.pages.put(targetPage)
      }
      
      await db.links.add({
        id: generateUUID(),
        sourceBlockId,
        targetPageId: targetPage.id,
        displayText: link.displayText,
        createdAt: Date.now()
      })
    }
  }
}
```

### 3.6 同步 Page 统计

**代码实现：** `IndexedDBAdapter.syncPageStats()`

```
1. 获取 Page 所有 Block（getBlockTree）
2. 计算 childrenCount（Block 数量）
3. 计算 wordCount（所有 Block.content 分词统计）
4. 更新 Page.childrenCount 和 Page.wordCount
```

**伪代码：**
```typescript
async syncPageStats(pageId: string): Promise<void> {
  const blocks = await this.getBlockTree(pageId)
  const count = blocks.length
  const words = blocks.reduce((sum, b) => sum + b.content.split(/\s+/).length, 0)
  
  const record = await db.pages.get(pageId)
  if (record) {
    const page = recordToPage(record)
    page.childrenCount = count
    page.wordCount = words
    page.updatedAt = Date.now()
    await db.pages.put(pageToRecord(page))
  }
}
```

---

## 4. 视图层抽象

### 4.1 usePageStore

代码层面通过 `usePageStore` 抽象 Page 和 Block 的联动：

```typescript
export const usePageStore = defineStore('page', () => {
  // State
  const pages = ref<Page[]>([])
  const currentPage = ref<Page | null>(null)
  const loading = ref(false)
  
  // Getters
  // ...
  
  // Actions
  async function createPage(title: string, type: 'normal' | 'journal'): Promise<Page>
  async function deletePage(pageId: string): Promise<void>
  async function renamePage(pageId: string, newTitle: string): Promise<void>
  async function loadPages(): Promise<void>
  async function loadPage(pageId: string): Promise<Page | undefined>
  
  return {
    pages,
    currentPage,
    loading,
    createPage,
    deletePage,
    renamePage,
    loadPages,
    loadPage,
  }
})
```

### 4.2 useBlockStore

Block 级别操作通过 `useBlockStore` 抽象：

```typescript
export const useBlockStore = defineStore('block', () => {
  // State
  const blocks = ref<Block[]>([])
  const loading = ref(false)
  
  // Getters
  // ...
  
  // Actions
  async function createBlock(pageId: string, content: string, parentId?: string | null): Promise<Block>
  async function updateBlock(blockId: string, updates: Partial<Block>): Promise<void>
  async function deleteBlock(blockId: string): Promise<void>
  async function moveBlock(blockId: string, targetParentId: string, pos: number): Promise<void>
  async function loadBlockTree(pageId: string): Promise<Block[]>
  
  return {
    blocks,
    loading,
    createBlock,
    updateBlock,
    deleteBlock,
    moveBlock,
    loadBlockTree,
  }
})
```

### 4.3 usePropertyStore

Property 操作通过 `usePropertyStore` 抽象（详见 `property-spec.md`）：

```typescript
export const usePropertyStore = defineStore('property', () => {
  // State
  const propertiesByBlock = ref<Map<string, Property[]>>(new Map())
  const loading = ref(false)
  
  // Getters
  const builtInProperties = computed<PropertyDefinition[]>(() => getAllPropertyDefinitions())
  
  // Actions
  function getBlockProperties(blockId: string): Property[]
  async function loadBlockProperties(blockId: string): Promise<Property[]>
  async function setProperty(blockId: string, key: string, value: PropertyValue, type?: PropertyType): Promise<Property>
  async function deleteProperty(id: string, blockId: string): Promise<void>
  async function updateSortOrder(blockId: string, sortedIds: string[]): Promise<void>
  async function toggleHidden(id: string, blockId: string): Promise<Property>
  
  return {
    propertiesByBlock,
    loading,
    builtInProperties,
    getBlockProperties,
    loadBlockProperties,
    setProperty,
    deleteProperty,
    updateSortOrder,
    toggleHidden,
  }
})
```

---

## 5. 已实现功能

| 功能 | 状态 | 说明 |
|------|------|------|
| Page CRUD | ✅ | 创建、读取、更新、删除 |
| Block CRUD | ✅ | 创建、读取、更新、删除 |
| Gap 排序 | ✅ | pos 字段，初始间隔 1000 |
| Link 解析 | ✅ | 自动解析 `[[页面名]]` 和 `#标签` |
| Property 读写 | ✅ | 支持 7 种数据类型 |
| 内置属性 | ✅ | status, priority, deadline, scheduled, project, area |
| 软删除 | ✅ | 所有核心实体支持 `deletedAt` 软删除字段 |
| 级联删除 | ✅ | 删除 Page/Block 时级联删除关联数据 |
| 统计同步 | ✅ | childrenCount, wordCount 自动同步 |
| 页面合并 | ✅ | 合并两个页面（迁移 Block + 重定向链接） |
| 版本号同步 | ✅ | Page/Block/Property/Link/DateRef 新增 `version` 字段，支持 LWW 冲突解决 |

---

## 6. 待实现功能

- [ ] 冲突处理策略（多端同步）
- [ ] 文件监听机制（外部 Markdown 文件变更）
- [ ] 全文搜索（FTS5 或类似方案）
- [ ] 数据加密选项（端到端加密）
- [ ] 按属性筛选 Block（`findBlocksByProperty`）
- [ ] 多条件组合查询（`findBlocks`）
- [ ] 自定义属性定义（用户可创建非内置属性）
- [ ] 属性继承（子 Block 继承父 Block 属性）

---

*文档基于代码实现更新（2026-05-19），替代 v0.4（2026-04-24）。*
