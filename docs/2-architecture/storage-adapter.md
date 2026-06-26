# StorageAdapter 接口规范

> 版本：v1.0
> 日期：2026-06-27
> 状态：Phase 2 规划

***

## 1. 设计目标

StorageAdapter 是 comind 的存储抽象层，提供统一的数据访问接口，支持不同的存储后端。

### 1.1 核心目标

| 目标 | 说明 |
|------|------|
| **存储后端无关** | Core 层不依赖具体的存储实现 |
| **平滑迁移** | 支持从 IndexedDB 平滑迁移到 SQLite |
| **类型安全** | 使用 TypeScript 类型定义确保类型安全 |
| **事务支持** | 跨实体的原子操作支持 |
| **可测试** | 提供内存实现，便于单元测试 |

### 1.2 设计模式

采用 **Repository 模式 + Facade 模式**：

- **Repository**：每个实体对应一个 Repository 接口，封装该实体的所有数据访问
- **Facade**：`StorageAdapter` 作为统一入口，聚合所有 Repository

***

## 2. 总体架构

### 2.1 分层结构

```
┌────────────────────────────────────────────┐
│              Core Services                 │
│  (BlockService, LinkService, ...)          │
├────────────────────────────────────────────┤
│           StorageAdapter (Facade)          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │  Block   │ │   Page   │ │   Link   │   │
│  │   Repo   │ │   Repo   │ │   Repo   │   │
│  └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐ ┌──────────┐                 │
│  │   Tag    │ │ Property │                 │
│  │   Repo   │ │   Repo   │                 │
│  └──────────┘ └──────────┘                 │
├────────────────────────────────────────────┤
│         Storage Implementation            │
│  (IndexedDB / SQLite / Memory)             │
└────────────────────────────────────────────┘
```

### 2.2 类型关系

```typescript
// 主接口
interface StorageAdapter {
  blocks: BlockRepository
  pages: PageRepository
  links: LinkRepository
  tags: TagRepository
  properties: PropertyRepository
  transaction<T>(callback): Promise<T>
  close(): Promise<void>
  isReady(): boolean
}
```

***

## 3. Repository 接口

### 3.1 BlockRepository

**位置：** `src/core/storage/adapter.ts`

**用途：** Block 数据访问

```typescript
interface BlockRepository {
  // 单条查询
  findById(id: string): Promise<Block | undefined>

  // 列表查询
  findByPageId(pageId: string): Promise<Block[]>
  findByParentId(parentId: string | null): Promise<Block[]>
  findByIds(ids: string[]): Promise<Block[]>

  // 分页查询
  findAll(limit?: number, offset?: number): Promise<PagedResult<Block>>

  // 写入操作
  create(options: BlockCreateOptions): Promise<Block>
  update(id: string, options: BlockUpdateOptions): Promise<Block>
  delete(id: string): Promise<void>

  // 批量操作
  deleteByPageId(pageId: string): Promise<void>
  reorder(parentId: string | null, blockIds: string[]): Promise<void>
}
```

**方法说明：**

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `findById` | `id: string` | `Block \| undefined` | 根据 ID 查询单个 Block |
| `findByPageId` | `pageId: string` | `Block[]` | 查询页面的所有 Block，按 pos 排序 |
| `findByParentId` | `parentId: string \| null` | `Block[]` | 查询子 Block，按 pos 排序 |
| `findByIds` | `ids: string[]` | `Block[]` | 批量查询 |
| `findAll` | `limit?, offset?` | `PagedResult<Block>` | 分页查询所有 Block |
| `create` | `options: BlockCreateOptions` | `Block` | 创建新 Block |
| `update` | `id, options` | `Block` | 更新 Block |
| `delete` | `id: string` | `void` | 删除单个 Block |
| `deleteByPageId` | `pageId: string` | `void` | 删除页面的所有 Block |
| `reorder` | `parentId, blockIds` | `void` | 重新排序（Gap 重平衡） |

### 3.2 PageRepository

**用途：** Page（页面）数据访问

```typescript
interface PageRepository {
  // 单条查询
  findById(id: string): Promise<Page | undefined>
  findByTitle(title: string): Promise<Page | undefined>

  // 列表查询
  findByIds(ids: string[]): Promise<Page[]>
  findAll(limit?: number, offset?: number): Promise<PagedResult<Page>>
  findRecent(limit?: number): Promise<Page[]>
  findDeleted(limit?: number, offset?: number): Promise<PagedResult<Page>>

  // 写入操作
  create(options: PageCreateOptions): Promise<Page>
  update(id: string, options: PageUpdateOptions): Promise<Page>

  // 删除操作（软删除 + 硬删除）
  softDelete(id: string): Promise<void>
  restore(id: string): Promise<void>
  permanentDelete(id: string): Promise<void>
  emptyTrash(): Promise<void>
}
```

**方法说明：**

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `findById` | `id: string` | `Page \| undefined` | 根据 ID 查询 |
| `findByTitle` | `title: string` | `Page \| undefined` | 根据标题查询 |
| `findByIds` | `ids: string[]` | `Page[]` | 批量查询 |
| `findAll` | `limit?, offset?` | `PagedResult<Page>` | 分页查询（未删除） |
| `findRecent` | `limit?: number` | `Page[]` | 最近更新的页面 |
| `findDeleted` | `limit?, offset?` | `PagedResult<Page>` | 分页查询已删除页面 |
| `create` | `options` | `Page` | 创建页面 |
| `update` | `id, options` | `Page` | 更新页面 |
| `softDelete` | `id: string` | `void` | 软删除（移入回收站） |
| `restore` | `id: string` | `void` | 从回收站恢复 |
| `permanentDelete` | `id: string` | `void` | 永久删除 |
| `emptyTrash` | - | `void` | 清空回收站 |

### 3.3 LinkRepository

**用途：** Link（双向链接）数据访问

```typescript
interface LinkRepository {
  // 单条查询
  findById(id: string): Promise<Link | undefined>

  // 列表查询
  findBySourceBlockId(blockId: string): Promise<Link[]>
  findByTargetPageId(pageId: string): Promise<Link[]>
  findAll(limit?: number, offset?: number): Promise<PagedResult<Link>>

  // 写入操作
  create(options: LinkCreateOptions): Promise<Link>
  update(id: string, options: Partial<LinkCreateOptions>): Promise<Link>
  delete(id: string): Promise<void>

  // 批量操作
  deleteBySourceBlockId(blockId: string): Promise<void>
  deleteByTargetPageId(pageId: string): Promise<void>
}
```

**方法说明：**

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `findById` | `id: string` | `Link \| undefined` | 根据 ID 查询 |
| `findBySourceBlockId` | `blockId: string` | `Link[]` | 查询源 Block 的所有链接 |
| `findByTargetPageId` | `pageId: string` | `Link[]` | 查询指向页面的所有链接（反向链接） |
| `findAll` | `limit?, offset?` | `PagedResult<Link>` | 分页查询所有链接 |
| `create` | `options` | `Link` | 创建链接 |
| `update` | `id, options` | `Link` | 更新链接 |
| `delete` | `id: string` | `void` | 删除链接 |
| `deleteBySourceBlockId` | `blockId: string` | `void` | 删除源 Block 的所有链接 |
| `deleteByTargetPageId` | `pageId: string` | `void` | 删除指向页面的所有链接 |

### 3.4 TagRepository

**用途：** Tag（标签）数据访问

> 注意：Phase 1 中标签从 Block.content 解析，不使用独立存储。
> Phase 2 可扩展为独立 Tag 表。

```typescript
interface TagRepository {
  findById(id: string): Promise<Tag | undefined>
  findByName(name: string): Promise<Tag | undefined>
  findAll(): Promise<Tag[]>
  create(name: string, parentId?: string | null): Promise<Tag>
  update(id: string, updates: Partial<Tag>): Promise<Tag>
  delete(id: string): Promise<void>
}
```

### 3.5 PropertyRepository

**用途：** Property（属性）数据访问

```typescript
interface PropertyRepository {
  // 单条查询
  findById(id: string): Promise<Property | undefined>
  findByKey(blockId: string, key: string): Promise<Property | undefined>

  // 列表查询
  findByBlockId(blockId: string): Promise<Property[]>
  findAll(limit?: number, offset?: number): Promise<PagedResult<Property>>

  // 写入操作
  create(options: PropertyCreateOptions): Promise<Property>
  update(id: string, options: PropertyUpdateOptions): Promise<Property>
  upsert(blockId, key, value, type?): Promise<Property>

  // 删除操作
  delete(id: string): Promise<void>
  deleteByBlockId(blockId: string): Promise<void>
  deleteByBlockIdAndKey(blockId: string, key: string): Promise<void>
}
```

**方法说明：**

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `findById` | `id: string` | `Property \| undefined` | 根据 ID 查询 |
| `findByKey` | `blockId, key` | `Property \| undefined` | 根据 Block 和 key 查询 |
| `findByBlockId` | `blockId: string` | `Property[]` | 查询 Block 的所有属性 |
| `findAll` | `limit?, offset?` | `PagedResult<Property>` | 分页查询所有属性 |
| `create` | `options` | `Property` | 创建属性 |
| `update` | `id, options` | `Property` | 更新属性 |
| `upsert` | `blockId, key, value, type?` | `Property` | 存在则更新，不存在则创建 |
| `delete` | `id: string` | `void` | 删除属性（软删除：isDeleted=true） |
| `deleteByBlockId` | `blockId: string` | `void` | 删除 Block 的所有属性 |
| `deleteByBlockIdAndKey` | `blockId, key` | `void` | 删除指定 key 的属性 |

***

## 4. 事务支持

### 4.1 事务接口

```typescript
interface StorageAdapter {
  transaction<T>(callback: (tx: StorageAdapter) => Promise<T>): Promise<T>
}
```

### 4.2 使用方式

```typescript
// 在事务中执行多个操作
await storage.transaction(async (tx) => {
  // 操作 1：创建 Block
  const block = await tx.blocks.create({ pageId: 'page-1', content: 'Hello' })

  // 操作 2：创建链接
  await tx.links.create({
    sourceBlockId: block.id,
    targetPageId: 'target-page',
  })

  // 操作 3：创建属性
  await tx.properties.upsert(block.id, 'status', 'todo')
})
```

### 4.3 事务特性

| 特性 | 说明 |
|------|------|
| **原子性** | 所有操作成功或全部回滚 |
| **一致性** | 事务结束后数据保持一致状态 |
| **隔离性** | 事务间互不干扰 |
| **持久性** | 事务提交后数据持久化 |

### 4.4 实现要求

| 存储后端 | 事务实现 |
|----------|----------|
| **IndexedDB** | 使用 IndexedDB 原生事务 |
| **SQLite** | 使用 SQLite 事务（BEGIN/COMMIT/ROLLBACK） |
| **Memory** | 同步执行，天然原子 |

***

## 5. 工厂函数

### 5.1 createStorageAdapter

```typescript
type StorageAdapterType = 'indexeddb' | 'sqlite' | 'memory'

async function createStorageAdapter(
  type: StorageAdapterType,
  options?: Record<string, any>
): Promise<StorageAdapter>
```

### 5.2 使用方式

```typescript
import { createStorageAdapter } from '@/core/storage'

// IndexedDB（浏览器环境）
const idbStorage = await createStorageAdapter('indexeddb', {
  databaseName: 'comind',
  version: 1,
})

// SQLite（桌面环境，Phase 3）
const sqliteStorage = await createStorageAdapter('sqlite', {
  filePath: '/path/to/comind.db',
})

// Memory（测试环境）
const memoryStorage = await createStorageAdapter('memory')
```

### 5.3 选项配置

**IndexedDB 选项：**

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `databaseName` | `string` | `'comind'` | 数据库名称 |
| `version` | `number` | `1` | 数据库版本 |

**SQLite 选项：**

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `filePath` | `string` | - | 数据库文件路径 |
| `journalMode` | `string` | `'WAL'` | 日志模式 |

***

## 6. 实现要求

### 6.1 通用要求

| 要求 | 说明 |
|------|------|
| **类型安全** | 所有实现必须符合 TypeScript 类型定义 |
| **错误处理** | 失败时抛出明确的 Error，包含错误信息 |
| **排序约定** | `findByParentId` 等列表查询默认按 pos 升序排序 |
| **软删除** | Page 和 Property 支持软删除（deleted/isDeleted 字段） |

### 6.2 IndexedDB 实现要求

- 使用 Dexie.js 封装 IndexedDB
- 表结构与现有 `db.ts` 保持一致
- 支持 Dexie 原生事务
- 性能：单条查询 < 1ms，列表查询 < 10ms（1000 条以内）

### 6.3 SQLite 实现要求（Phase 3）

- 使用 `better-sqlite3` 或 `sql.js`
- 表结构与 IndexedDB 对应
- 支持 SQL 事务
- 支持全文搜索（FTS5）

### 6.4 Memory 实现要求

- 纯内存存储，不持久化
- 用于单元测试和开发调试
- 所有操作同步完成（Promise 包装）

***

## 7. 分页格式

```typescript
interface PagedResult<T> {
  items: T[]        // 当前页数据
  total: number     // 总条数
  page: number      // 当前页码（从 1 开始）
  pageSize: number  // 每页条数
  hasMore: boolean  // 是否有更多数据
}
```

***

## 8. 错误码

| 错误类型 | 说明 | 触发场景 |
|----------|------|----------|
| `NotFoundError` | 记录不存在 | findById 返回 undefined |
| `ValidationError` | 数据验证失败 | create/update 参数不合法 |
| `ConstraintError` | 约束冲突 | 唯一键冲突 |
| `TransactionError` | 事务失败 | 事务回滚 |
| `ConnectionError` | 连接失败 | 数据库连接异常 |

***

## 9. 与现有代码的对应关系

| 现有代码 | 对应 Repository | 说明 |
|----------|-----------------|------|
| `db.blocks` | `BlockRepository` | Dexie 表 |
| `db.pages` | `PageRepository` | Dexie 表 |
| `db.links` | `LinkRepository` | Dexie 表 |
| `db.properties` | `PropertyRepository` | Dexie 表 |
| `saveBlock()` | `blocks.create/update` | 保存 Block |
| `saveLinks()` | `links.*` | 保存链接 |
| `PropertyService` | `properties.*` | 属性 CRUD |

***

## 10. 迁移路径

### Phase 2 Sprint 2：IndexedDBAdapter

1. 实现 IndexedDBAdapter
2. 重构 Pinia stores 使用 StorageAdapter
3. 逐步移除直接的 Dexie 调用

### Phase 3：SQLiteAdapter

1. 实现 SQLiteAdapter
2. 编写迁移工具（IndexedDB → SQLite）
3. 支持配置切换存储后端

***

## 11. 相关文档

| 文档 | 链接 |
|------|------|
| SPEC.md | [项目总规范](../1-overview/SPEC.md) |
| core-layer.md | [Core Layer 架构设计](./core-layer.md) |
| storage-spec.md | [存储层规范](./storage-spec.md) |
| data-model.md | [核心数据模型](./data-model.md) |

***

*文档 v1.0，Phase 2 规划中。*
