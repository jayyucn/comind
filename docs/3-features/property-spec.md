# Property 规范

> 版本：v0.3
> 日期：2026-05-19
> 状态：✅ 已实现

---

## 1. 概述

Property（属性）是 comind 中用于为 Block 附加结构化元数据的机制。本文档定义 Property 的数据模型、存储策略、API 接口和 UI 交互。

**Property 的定位：**

| 特性 | Property | Link |
|------|----------|------|
| 语法 | `key:: value` | `[[页面名]]` 或 `#标签名` |
| 结构 | 键值对 | 关联引用（#标签名 渲染为 Page 链接） |
| 用途 | 元数据/配置 | 关联、分类 |
| 查询 | 支持按 key/value 筛选 | 按目标筛选 |

**核心设计决策：**
- Property 只关联 Block（通过 `blockId`），不直接关联 Page
- Page 的属性通过其根 Block 的 Property 表达
- 支持内置属性定义（带 UI 显示配置）

---

## 2. 数据模型

### 2.1 PropertyType（属性值类型）

```typescript
export type PropertyType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'array' | 'page'
```

**说明：**
- `page` 类型：引用另一个 Page（替代早期设计的 `link` 类型）
- 不支持 `link` 类型（Link 由独立 Link 表处理）

### 2.2 ClosedValue（封闭值选项）

```typescript
export interface ClosedValue {
  value: string | number | boolean
  label: string
  description?: string
  icon?: string
}
```

用于枚举类型的属性值（如下拉选择）。

### 2.3 PropertyDefinition（属性定义）

```typescript
export interface PropertyDefinition {
  key: string
  title: string
  type: PropertyType
  closedValues?: ClosedValue[]
  isBuiltIn?: boolean
  description?: string
  
  // UI 显示配置
  displayPosition?: 'between-bullet-content' | 'right-of-content' | 'bottom-of-block'
  displayStyle?: 'icon' | 'text' | 'icon-text'
}
```

**字段说明：**
- `key`：属性唯一标识（如 `status`、`priority`）
- `title`：显示名称（如 `状态`、`优先级`）
- `closedValues`：可选，枚举值列表
- `isBuiltIn`：是否为内置属性
- `displayPosition`：UI 显示位置
  - `between-bullet-content`：bullet 和内容之间（如状态图标）
  - `right-of-content`：内容右侧（如优先级标签）
  - `bottom-of-block`：Block 底部（如截止日期）
- `displayStyle`：显示样式
  - `icon`：仅图标
  - `text`：仅文本
  - `icon-text`：图标 + 文本

### 2.4 PropertyValueMap（类型映射）

```typescript
export type PropertyValueMap = {
  string: string
  number: number
  boolean: boolean
  date: string
  datetime: string
  array: string[]
  page: string
}

export type PropertyValue = PropertyValueMap[PropertyType]
```

### 2.5 Property（属性实例）

```typescript
export interface Property<T = PropertyValue> {
  id: string
  blockId: string          // 外键 → Block.id
  key: string
  value: T
  type: PropertyType
  sortOrder: number        // 排序权重
  isHidden: boolean        // 是否隐藏
  isDeleted: boolean       // 软删除标记
  schemaVersion: number    // Schema 版本
  createdAt: number        // 创建时间戳（毫秒）
  updatedAt: number        // 更新时间戳（毫秒）
}
```

**说明：**
- `sortOrder`：控制同一 Block 内属性的显示顺序
- `isHidden`：UI 可切换显示/隐藏
- `isDeleted`：软删除（不物理删除，便于恢复）
- `schemaVersion`：属性 Schema 版本（用于迁移）

### 2.6 PropertyRecord（IndexedDB 存储记录）

```typescript
export interface PropertyRecord {
  id: string
  blockId: string
  key: string
  value: string            // JSON 序列化
  type: string
  sortOrder: number
  isHidden: number         // 0 | 1（IndexedDB 不支持 boolean）
  isDeleted: number        // 0 | 1
  schemaVersion: number
  createdAt: number
  updatedAt: number
}
```

**IndexedDB 适配：**
- `value`：JSON 序列化存储
- `isHidden`/`isDeleted`：number（0 | 1）存储，读取时转换为 boolean

---

## 3. 内置属性

系统内置 6 个属性定义（`BUILT_IN_PROPERTIES`）：

### 3.1 status（状态）

```typescript
{
  key: 'status',
  title: '状态',
  type: 'string',
  isBuiltIn: true,
  displayPosition: 'between-bullet-content',
  displayStyle: 'icon',
  closedValues: [
    { value: 'Todo', label: '待办', icon: '○' },
    { value: 'Doing', label: '进行中', icon: '●' },
    { value: 'Done', label: '已完成', icon: '✓' },
    { value: 'Canceled', label: '已取消', icon: '✗' },
  ],
}
```

**显示效果：**
- 位置：bullet 和内容之间
- 样式：仅图标（○ ● ✓ ✗）

### 3.2 priority（优先级）

```typescript
{
  key: 'priority',
  title: '优先级',
  type: 'string',
  isBuiltIn: true,
  displayPosition: 'right-of-content',
  displayStyle: 'icon-text',
  closedValues: [
    { value: 'Low', label: '低', description: '不紧急不重要', icon: '🔵' },
    { value: 'Medium', label: '中', description: '重要不紧急', icon: '🟡' },
    { value: 'High', label: '高', description: '紧急不重要', icon: '🟠' },
    { value: 'Urgent', label: '急', description: '紧急且重要', icon: '🔴' },
  ],
}
```

**显示效果：**
- 位置：内容右侧
- 样式：图标 + 文本（如 🔴 急）

### 3.3 deadline（截止日期）

```typescript
{
  key: 'deadline',
  title: '截止日期',
  type: 'date',
  isBuiltIn: true,
  displayPosition: 'bottom-of-block',
  displayStyle: 'icon-text',
}
```

**显示效果：**
- 位置：Block 底部
- 样式：图标 + 文本（如 📅 2026-05-20）

### 3.4 scheduled（计划日期）

```typescript
{
  key: 'scheduled',
  title: '计划日期',
  type: 'date',
  isBuiltIn: true,
  displayPosition: 'bottom-of-block',
  displayStyle: 'icon-text',
}
```

### 3.5 project（项目）

```typescript
{
  key: 'project',
  title: '项目',
  type: 'string',
  isBuiltIn: true,
  displayPosition: 'bottom-of-block',
  displayStyle: 'icon-text',
}
```

### 3.6 area（领域）

```typescript
{
  key: 'area',
  title: '领域',
  type: 'string',
  isBuiltIn: true,
  displayPosition: 'bottom-of-block',
  displayStyle: 'icon-text',
}
```

---

## 4. 存储策略

### 4.1 IndexedDB 存储（已实现）

Property 表在 IndexedDB 中定义为：

```typescript
// db.ts
export const db = new Dexie('comind') as TypedDexie

db.version(1).stores({
  pages: '++id, title, type',
  blocks: '++id, pageId, parentId, pos',
  properties: '++id, blockId, [blockId+key], key, type',  // 复合索引
  links: '++id, sourceBlockId, targetPageId',
})
```

**索引说明：**
- `blockId`：查询某个 Block 的所有属性
- `[blockId+key]`：复合索引，查询某个 Block 的特定属性（唯一约束）
- `key`：按属性名查询（如查找所有 `status=Done` 的 Block）
- `type`：按属性类型查询

### 4.2 软删除策略

```typescript
// 软删除
async deleteProperty(id: string): Promise<void> {
  const record = await db.properties.get(id)
  if (record) {
    record.isDeleted = 1
    record.updatedAt = Date.now()
    await db.properties.put(record)
  }
}
```

**查询时过滤软删除：**
```typescript
async getProperties(blockId: string): Promise<Property[]> {
  const records = await db.properties
    .where('blockId').equals(blockId)
    .filter(p => !p.isDeleted)  // 过滤软删除
    .sortBy('sortOrder')
  return records.map(recordToProperty)
}
```

### 4.3 级联删除

删除 Block 时，级联删除其所有 Property：

```typescript
async deleteBlockCascade(blockIds: string[]): Promise<void> {
  await db.transaction('rw', [db.blocks, db.links, db.properties], async () => {
    await db.blocks.bulkDelete(blockIds)
    await db.links.where('sourceBlockId').anyOf(blockIds).delete()
    for (const blockId of blockIds) {
      await this.deletePropertiesByBlockId(blockId)
    }
  })
}
```

---

## 5. API 接口

### 5.1 PropertyService（业务逻辑层）

```typescript
class PropertyService {
  // 查询
  async getProperties(blockId: string): Promise<Property[]>
  async getProperty(blockId: string, key: string): Promise<Property | undefined>
  async getPropertiesByBlockIds(blockIds: string[]): Promise<Map<string, Property[]>>
  
  // 写入
  async setProperty(blockId: string, key: string, value: PropertyValue, type?: PropertyType): Promise<Property>
  
  // 删除
  async deleteProperty(id: string): Promise<void>       // 软删除
  async hardDeleteProperty(id: string): Promise<void>    // 硬删除
  async deletePropertiesByBlockId(blockId: string): Promise<void>
  
  // 排序
  async updateSortOrder(blockId: string, sortedIds: string[]): Promise<void>
  
  // 显示控制
  async toggleHidden(id: string): Promise<Property>
  
  // 定义查询
  getPropertyDefinition(key: string): PropertyDefinition | undefined
  getAllPropertyDefinitions(): PropertyDefinition[]
}
```

### 5.2 usePropertyStore（Pinia Store）

```typescript
export const usePropertyStore = defineStore('property', () => {
  // State
  const propertiesByBlock = ref<Map<string, Property[]>>(new Map())
  const loading = ref(false)
  
  // Getters
  const builtInProperties = computed<PropertyDefinition[]>(() => getAllPropertyDefinitions())
  
  // Actions
  function getPropertyDef(key: string): PropertyDefinition | undefined
  function getBlockProperties(blockId: string): Property[]
  function getBlockProperty(blockId: string, key: string): Property | undefined
  async function loadBlockProperties(blockId: string): Promise<Property[]>
  async function loadMultiBlockProperties(blockIds: string[]): Promise<void>
  async function setProperty(blockId: string, key: string, value: PropertyValue, type?: PropertyType): Promise<Property>
  async function deleteProperty(id: string, blockId: string): Promise<void>
  async function updateSortOrder(blockId: string, sortedIds: string[]): Promise<void>
  async function toggleHidden(id: string, blockId: string): Promise<Property>
  async function clearBlockCache(blockId: string): Promise<void>
  
  return { /* ... */ }
})
```

**缓存策略：**
- `propertiesByBlock`：内存缓存，key = blockId，value = Property[]
- `loadBlockProperties`：从 IndexedDB 加载并写入缓存
- `loadMultiBlockProperties`：批量加载多个 Block 的属性（性能优化）
- `clearBlockCache`：手动清除缓存（如 Block 删除后）

---

## 6. 语法规则

### 6.1 基础语法

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
项目:: [[项目A]]
```

**无效示例：**
```
key:value       ← 缺少空格
key :: value    ← 冒号前有空格
:: value        ← 缺少 key
key::           ← 缺少 value（空值需显式写 null 或 ""）
```

### 6.2 Key 命名规范

| 规则 | 说明 | 示例 |
|------|------|------|
| 只能使用 | 字母、数字、中文、`-`、`_` | `created-at`, `优先级` |
| 不能以数字开头 | 避免解析歧义 | ❌ `123key` |
| 区分大小写 | `Status` ≠ `status` | 建议小写 + 连字符 |
| 长度限制 | 1-64 字符 | 超出截断 |
| 保留前缀 | `sys-` 前缀保留给系统属性 | `sys-id`, `sys-version` |

### 6.3 Value 数据类型

Property value 支持以下类型：

| 类型 | 语法示例 | 存储格式 | 说明 |
|------|---------|---------|------|
| **String** | `标题:: 文档标题` | `"文档标题"` | 默认类型，纯文本 |
| **Number** | `进度:: 75` | `75` / `0.75` | 整数或浮点数 |
| **Boolean** | `完成:: true` | `true` / `false` | true/false |
| **Date** | `截止日期:: 2026-04-16` | `"2026-04-16"` | ISO 8601 日期 |
| **DateTime** | `创建时间:: 2026-04-16T10:30:00Z` | `"2026-04-16T10:30:00Z"` | ISO 8601 日期时间 |
| **Array** | `标签:: [设计, 数据]` | `["设计", "数据"]` | 方括号包裹，逗号分隔 |
| **Page** | `项目:: [[项目A]]` | `"项目A"` | 引用 Page 标题 |

### 6.4 类型推断规则

系统自动推断 value 类型（启发式）：

```typescript
function inferType(value: string): PropertyType {
  // 1. Boolean
  if (value === 'true' || value === 'false') return 'boolean'
  
  // 2. Number
  if (/^-?\d+$/.test(value)) return 'number'
  if (/^-?\d+\.\d+$/.test(value)) return 'number'
  
  // 3. Array
  if (value.startsWith('[') && value.endsWith(']')) return 'array'
  
  // 4. DateTime
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'datetime'
  
  // 5. Date
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date'
  
  // 6. Page（包含 [[...]]）
  if (/\[\[.+?\]\]/.test(value)) return 'page'
  
  // 7. String（默认）
  return 'string'
}
```

**注意：** 类型推断是启发式的，用户可通过 UI 强制指定类型。

### 6.5 特殊 Value 格式

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

---

## 7. 属性位置与解析

### 7.1 Block Properties（块属性）

嵌入在 Block 内容中：

```markdown
## 任务 A
status:: Done
优先级:: 高
截止日期:: 2026-04-20

这是任务 A 的详细描述...
```

**规则：**
- 位于 Block 内容开头（标题行之后）
- 连续多行属性，遇空行或正文结束
- 属性行不计入 Block.content（解析后提取）

### 7.2 属性与正文的边界

```markdown
## 任务标题
status:: Done        ← 属性
负责人:: 张三         ← 属性

这是正文内容...       ← 正文开始
status:: 进行中       ← 这行属于正文，不是属性！
```

**识别规则：**
- 标题行后的连续 `key:: value` 行 → 属性
- 遇空行、非 `key:: value` 格式行 → 正文开始
- 正文中的 `key:: value` 视为普通文本

### 7.3 Page Properties（页面属性）

Page 的属性通过其**根 Block** 表达：

```
Page.blockId → Block.properties
```

**规范：** Page 没有独立的属性存储，所有页面级属性都存储在根 Block 的 Property 表中。

---

## 8. UI 交互

### 8.1 属性显示位置

根据 `PropertyDefinition.displayPosition`：

| 位置 | 说明 | 示例 |
|------|------|------|
| `between-bullet-content` | bullet 和内容之间 | 状态图标（○ ● ✓ ✗） |
| `right-of-content` | 内容右侧 | 优先级标签（🔴 急） |
| `bottom-of-block` | Block 底部 | 截止日期（📅 2026-05-20） |

### 8.2 属性显示样式

根据 `PropertyDefinition.displayStyle`：

| 样式 | 说明 | 示例 |
|------|------|------|
| `icon` | 仅图标 | ● |
| `text` | 仅文本 | 进行中 |
| `icon-text` | 图标 + 文本 | ● 进行中 |

### 8.3 内置属性 UI 示例

#### status（状态）

显示位置：between-bullet-content  
显示样式：icon

```
○ 任务标题        ← Todo
● 任务标题        ← Doing
✓ 任务标题        ← Done
✗ 任务标题        ← Canceled
```

#### priority（优先级）

显示位置：right-of-content  
显示样式：icon-text

```
任务标题 🔴 急
任务标题 🟠 高
任务标题 🟡 中
任务标题 🔵 低
```

#### deadline（截止日期）

显示位置：bottom-of-block  
显示样式：icon-text

```
任务标题
📅 2026-05-20
```

### 8.4 属性编辑

**行内编辑：**
- 单击属性值 → 进入编辑
- 枚举类型：下拉选择（如 status、priority）
- 日期类型：日期选择器
- 文本类型：直接输入
- 按 Enter → 保存并退出
- 按 Esc → 取消编辑

**属性面板（侧边栏）：**

```
┌─────────────────┐
│ 属性            │
├─────────────────┤
│ 状态      ● 进行中 │
│ 优先级    🔴 高     │
│ 截止日期  2026-05-20│
│                 │
│ [+ 添加属性]    │
└─────────────────┘
```

### 8.5 属性排序

用户可拖拽排序属性，排序结果保存在 `Property.sortOrder`：

```typescript
async updateSortOrder(blockId: string, sortedIds: string[]): Promise<void> {
  const properties = await this.getProperties(blockId)
  const map = new Map(properties.map(p => [p.id, p]))
  
  for (let i = 0; i < sortedIds.length; i++) {
    const prop = map.get(sortedIds[i])
    if (prop) {
      prop.sortOrder = i
      prop.updatedAt = Date.now()
      await storage.saveProperty(prop)
    }
  }
}
```

### 8.6 属性隐藏/显示

```typescript
async toggleHidden(id: string): Promise<Property> {
  const prop = await storage.getPropertyById(id)
  if (!prop) throw new Error('Property not found')
  prop.isHidden = !prop.isHidden
  prop.updatedAt = Date.now()
  await storage.saveProperty(prop)
  return prop
}
```

---

## 9. 查询 API

### 9.1 基础查询

```typescript
// 获取 Block 的所有属性
function getBlockProperties(blockId: string): Property[]

// 获取 Block 的特定属性
function getBlockProperty(blockId: string, key: string): Property | undefined

// 获取属性定义
function getPropertyDef(key: string): PropertyDefinition | undefined

// 获取所有内置属性定义
function getAllPropertyDefinitions(): PropertyDefinition[]
```

### 9.2 复杂查询（待实现）

```typescript
// 按属性筛选 Block（待实现）
function findBlocksByProperty(
  key: string,
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'in' | 'contains',
  value: any
): Promise<Block[]>

// 多条件组合（待实现）
interface PropertyFilter {
  key: string
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'in' | 'contains'
  value: any
}

function findBlocks(filters: PropertyFilter[], logic: 'AND' | 'OR'): Promise<Block[]>
```

---

## 10. 与 Tag、Link 的关系

| 场景 | 处理 |
|------|------|
| Property value 含 `#标签` | 作为纯文本存储，不创建 Tag 关联 |
| Property value 含 `[[链接]]` | 解析为 `page` 类型，存储 Page 标题 |
| Tag 与 Property 同名 | 独立处理，互不影响 |
| 属性名 `tags` | 建议用数组类型存储，与 `#标签` 语法区分 |

**Link 表独立维护：**
- Link 表记录 `[[页面名]]` 的解析结果
- Property 表中的 `page` 类型仅存储 Page 标题，不创建 Link 记录
- 两者通过 Block.content 解析时统一处理

---

## 11. 测试用例

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
  
  test('Page 类型', () => {
    expect(parseProperty('项目:: [[项目A]]')).toEqual({
      key: '项目',
      value: '项目A',
      type: 'page',
    })
  })
  
  test('无效格式', () => {
    expect(parseProperty('key:value')).toBeNull()  // 缺少空格
    expect(parseProperty(':: value')).toBeNull()   // 缺少 key
  })
})

describe('PropertyService', () => {
  test('setProperty - 创建新属性', async () => {
    const prop = await propertyService.setProperty(blockId, 'status', 'Done', 'string')
    expect(prop.key).toBe('status')
    expect(prop.value).toBe('Done')
    expect(prop.sortOrder).toBe(0)
  })
  
  test('setProperty - 更新已有属性', async () => {
    await propertyService.setProperty(blockId, 'status', 'Done', 'string')
    const updated = await propertyService.setProperty(blockId, 'status', 'Todo', 'string')
    expect(updated.value).toBe('Todo')
  })
  
  test('soft delete - isDeleted 标记', async () => {
    const prop = await propertyService.setProperty(blockId, 'status', 'Done', 'string')
    await propertyService.deleteProperty(prop.id)
    const retrieved = await propertyService.getProperty(blockId, 'status')
    expect(retrieved).toBeUndefined()  // 软删除后查询不到
  })
})
```

---

## 12. 待实现功能

- [ ] 按属性筛选 Block（`findBlocksByProperty`）
- [ ] 多条件组合查询（`findBlocks`）
- [ ] 属性值验证（根据 `PropertyDefinition` 验证）
- [ ] 自定义属性定义（用户可创建非内置属性）
- [ ] 属性模板（批量应用属性定义）
- [ ] 属性继承（子 Block 继承父 Block 属性）

---

*文档基于代码实现更新（2026-05-19），替代 v0.2（2026-04-16）。*
