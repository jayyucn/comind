# Property System 规范

> 版本：1.0
> 日期：2026-05-13
> 状态：已确认

## 一、概述

Property 系统是 comind 中为 Block/Page 附加结构化元数据的核心功能，采用独立的 Property 表存储，支持内置属性、自定义属性、类型化渲染、按属性筛选等。

### 设计原则

1. **类型安全**：通过泛型约束属性值类型
2. **元数据与实例分离**：PropertyDefinition 全局配置，Property 是实例数据
3. **性能优先**：数据库索引精简，减少冗余字段
4. **可扩展**：预留自定义属性入口，无需重构表结构

---

## 二、数据模型

### 2.1 类型定义

```typescript
// types/property.ts

/**
 * 属性定义（元数据）
 * 全局配置，描述一个属性的元信息
 */
interface PropertyDefinition {
  key: string           // 属性唯一标识（如 "status"、"priority"）
  title: string         // 显示名称（如 "状态"、"优先级"）
  type: PropertyType
  closedValues?: ClosedValue[]  // 封闭值选项（下拉选择用）
  isBuiltIn?: boolean   // 是否内置属性
  description?: string  // 属性描述
}

/**
 * 封闭值选项
 */
interface ClosedValue {
  value: string | number | boolean
  label: string
  icon?: string
}

/**
 * 属性类型
 */
type PropertyType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'array' | 'page'

/**
 * 属性实例
 * 存储在数据库中的实际数据
 */
interface Property<T = PropertyValue> {
  id: string
  blockId: string
  key: string            // 引用 PropertyDefinition.key
  value: T
  type: PropertyType    // 冗余字段，方便查询，避免关联
  sortOrder: number     // 排序顺序，默认 0
  isHidden: boolean     // 是否隐藏（UI 不显示，但仍参与筛选）
  isDeleted: boolean    // 软删除标记（仅用于属性级别的撤销）
  schemaVersion: number // 数据版本（兼容老数据，当前 1）
  createdAt: number
  updatedAt: number
}

/**
 * 按类型约束 value 的映射表
 */
type PropertyValueMap = {
  string: string
  number: number
  boolean: boolean
  date: string          // ISO 8601 date, e.g. "2026-05-13"
  datetime: string      // ISO 8601 datetime, e.g. "2026-05-13T10:30:00Z"
  array: string[]       // 字符串数组，用于标签、多选等
  page: string          // pageId，引用其他页面
}

type PropertyValue = PropertyValueMap[PropertyType]
```

### 2.2 内置属性定义

```typescript
const BUILT_IN_PROPERTIES: PropertyDefinition[] = [
  {
    key: 'status',
    title: '状态',
    type: 'string',
    isBuiltIn: true,
    closedValues: [
      { value: 'Todo', label: '待办', icon: '📋' },
      { value: 'Doing', label: '进行中', icon: '🔄' },
      { value: 'Done', label: '已完成', icon: '✅' },
      { value: 'Canceled', label: '已取消', icon: '❌' },
    ],
  },
  {
    key: 'priority',
    title: '优先级',
    type: 'string',
    isBuiltIn: true,
    closedValues: [
      { value: 'Low', label: '低', icon: '🟢' },
      { value: 'Medium', label: '中', icon: '🟡' },
      { value: 'High', label: '高', icon: '🟠' },
      { value: 'Urgent', label: '紧急', icon: '🔴' },
    ],
  },
  {
    key: 'deadline',
    title: '截止日期',
    type: 'date',
    isBuiltIn: true,
  },
  {
    key: 'tags',
    title: '标签',
    type: 'array',
    isBuiltIn: true,
  },
]
```

---

## 三、数据库设计

### 3.1 表结构

在 `storage/indexedDB.ts` 中新增 `properties` 表：

```typescript
{
  name: 'properties',
  keyPath: 'id',
  indexes: [
    // 查询一个 Block 的所有属性
    { name: 'blockId', keyPath: 'blockId', unique: false },
    // 同块同 key 唯一约束 + 快速查询
    { name: 'blockId_key', keyPath: ['blockId', 'key'], unique: true },
  ],
}
```

### 3.2 索引策略

| 索引 | 用途 |
|------|------|
| `blockId` | 查询一个 Block 的所有属性 |
| `blockId_key` | 同块同 key 唯一约束 + 快速查询特定属性 |

**注意**：不单独建 `key` 索引，业务几乎不会全局按 key 查。

---

## 四、业务规则

### 4.1 同块同 key 覆盖策略

- 同一个 Block 同一个 key 只能有一条 Property 记录
- 新增同 key 属性时，直接覆盖旧值（不弹窗提示）
- 由数据库的 `blockId_key` 唯一索引保证

### 4.2 排序规则

- `sortOrder` 字段控制属性在 Block 下方的显示顺序
- 默认值：0
- 新增属性自动放在末尾（sortOrder = max_sortOrder + 1）
- 用户可拖拽调整，更新 sortOrder

### 4.3 删除规则

- **Block 删除**：物理级联删除关联的所有 Property，减少垃圾数据
- **Property 删除**：软删除（isDeleted = true），支持撤销
- **数据清理**：后台定期清理 isDeleted = true 且超过一定时间的记录

### 4.4 值格式化校验

写入 Property 表前自动校验和格式化：

| 类型 | 格式化规则 |
|------|-----------|
| `string` | trim()，去除首尾空格 |
| `number` | 转为数字类型，非法值拒绝写入 |
| `boolean` | 严格 true/false |
| `date` | 格式化为 ISO 8601 date（YYYY-MM-DD） |
| `datetime` | 格式化为 ISO 8601 datetime |
| `array` | 确保是字符串数组，去重 |
| `page` | 验证 pageId 存在 |

---

## 五、架构分层

```
┌─────────────────────────────────────────┐
│  组件层（Block.vue 等）                 │
│  - 属性显示 UI                          │
│  - 属性编辑弹窗                         │
│  - 属性筛选 UI                          │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│  Store 层（stores/property.ts）         │
│  - 响应式状态管理                       │
│  - 缓存 PropertyDefinition             │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│  Service 层（services/property.ts）     │
│  - DB 操作封装                           │
│  - 业务逻辑（同 key 覆盖、级联删除等）  │
│  - 值格式化校验                          │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│  Storage 层（indexedDB.ts）             │
│  - 原始 CRUD                            │
└─────────────────────────────────────────┘
```

### 5.1 Service 层接口

```typescript
// services/property.ts

interface PropertyService {
  // --- CRUD ---
  getProperties(blockId: string): Promise<Property[]>
  getProperty(blockId: string, key: string): Promise<Property | null>
  createProperty(data: Omit<Property, 'id' | 'createdAt' | 'updatedAt'>): Promise<Property>
  updateProperty(id: string, data: Partial<Property>): Promise<Property>
  deleteProperty(id: string): Promise<void>  // 软删除
  hardDeleteProperty(id: string): Promise<void>  // 物理删除

  // --- 批量操作 ---
  getPropertiesByBlockIds(blockIds: string[]): Promise<Map<string, Property[]>>
  deletePropertiesByBlockId(blockId: string): Promise<void>  // 物理级联

  // --- 查询 ---
  findBlocksByProperty(key: string, operator: Operator, value: any): Promise<string[]>

  // --- 元数据 ---
  getPropertyDefinition(key: string): PropertyDefinition | undefined
  getAllPropertyDefinitions(): PropertyDefinition[]
}
```

---

## 六、UI 与交互

### 6.1 属性显示

- **位置**：Block 内容下方
- **折叠/收起**：属性 >= 3 个时默认折叠，点击展开
- **视觉区分**：
  - 内置属性：使用主题色
  - 自定义属性：使用中性色
- **isHidden**：不显示，但仍参与筛选

### 6.2 属性编辑

- **添加方式**：斜杠命令 `/add property`
- **快捷编辑**：点击已显示的属性直接弹窗改值
- **删除**：属性右侧的删除按钮，软删除
- **拖拽排序**：按住拖动调整顺序

### 6.3 类型化渲染

| 类型 | 渲染方式 |
|------|---------|
| `string` | 文本，若有 closedValues 则显示下拉选择 |
| `number` | 数字输入框 |
| `boolean` | 复选框 |
| `date` | 日期选择器 |
| `datetime` | 日期时间选择器 |
| `array` | 标签列表，支持增删 |
| `page` | 页面链接，可点击跳转 |

---

## 七、阶段划分

### 阶段 1：核心数据层

**目标**：数据模型、数据库、Service 层

- [ ] 新增 `types/property.ts`
- [ ] 修改 `storage/indexedDB.ts` 添加 properties 表
- [ ] 新增 `services/property.ts`
- [ ] 新增 `stores/property.ts`
- [ ] 基础 CRUD 单元测试

### 阶段 2：UI 显示层

**目标**：Block 下方显示属性

- [ ] Block 组件集成属性显示
- [ ] 类型化渲染组件
- [ ] 折叠/收起功能
- [ ] 视觉区分（内置 vs 自定义）

### 阶段 3：属性编辑

**目标**：完整的编辑交互

- [ ] 斜杠命令集成
- [ ] 属性编辑弹窗
- [ ] 快捷编辑（点击直接改）
- [ ] 拖拽排序
- [ ] 隐藏/显示切换

### 阶段 4：查询筛选

**目标**：按属性筛选 Block

- [ ] 属性查询 Service 方法
- [ ] 筛选 UI 组件
- [ ] 集成到现有筛选系统

---

## 八、与现有系统集成

### 8.1 Block 生命周期

- **Block 创建**：无特殊处理
- **Block 更新**：无特殊处理
- **Block 删除**：调用 `propertyService.deletePropertiesByBlockId(blockId)` 物理级联

### 8.2 与 Tag/Link 的关系

- Property 系统独立于 Tag/Link
- `tags` 属性与 `#tag` 语法是两回事
- `page` 类型的 value 是 pageId，不通过 Link 表

---

## 九、数据迁移

首次发布无需迁移，schemaVersion 初始为 1。

后续结构变更时：
1. 增加 schemaVersion
2. Service 层做兼容处理
3. 后台异步迁移老数据

---

## 十、测试要点

### 单元测试

- [ ] 值格式化校验
- [ ] 同 key 覆盖逻辑
- [ ] sortOrder 排序逻辑
- [ ] 级联删除

### E2E 测试

- [ ] 斜杠命令添加属性
- [ ] 点击编辑属性
- [ ] 拖拽排序
- [ ] 隐藏/显示
- [ ] 筛选功能
