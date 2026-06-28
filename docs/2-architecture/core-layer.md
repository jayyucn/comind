# Core Layer 架构设计

> 版本：v1.1
> 日期：2026-06-28
> 状态：Phase 2 Sprint 4 - 已完成 Core 层主体架构

***

## 1. 设计目标

Core Layer 是 comind 的核心业务逻辑层，与任何前端框架无关。

### 1.1 核心原则

| 原则 | 说明 |
|------|------|
| **框架无关** | 不依赖 Vue、Pinia、tiptap 等任何框架 |
| **纯 TypeScript** | 仅使用 TypeScript 类型和原生 JavaScript API |
| **依赖注入** | 所有外部依赖通过构造函数参数注入 |
| **可测试** | 纯逻辑代码，易于单元测试 |
| **可复用** | 可在 Web、桌面、移动等不同环境中复用 |

### 1.2 为什么需要 Core Layer

| 问题 | Core Layer 解决方案 |
|------|---------------------|
| 业务逻辑与框架耦合 | 将业务逻辑抽离到独立的纯 TypeScript 层 |
| 难以进行单元测试 | 框架无关的代码更容易编写测试 |
| 未来迁移成本高 | 切换框架（如 React）只需重写 UI 层 |
| 多端复用困难 | Core 逻辑可在 Web、桌面、移动端复用 |

### 1.3 Phase 2 完成状态

| Sprint | 内容 | 状态 |
|--------|------|------|
| Sprint 1 | Core 层目录结构 + Block/Link 抽离 | ✅ 完成 |
| Sprint 2 | Tag/Property 抽离 + StorageAdapter 接口 | ✅ 完成 |
| Sprint 3 | Lunr.js 搜索集成 + 搜索 UI | ✅ 完成 |
| Sprint 4 | 测试覆盖 + 回归验证 + 文档更新 | 🔄 进行中 |

***

## 2. 架构总览

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────┐
│                    UI Layer                         │
│  (Vue 3 Components, Pinia Stores, tiptap Editor)    │
├─────────────────────────────────────────────────────┤
│                    Core Layer                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ Services │  │  Search  │  │  Storage Adapter │ │
│  └──────────┘  └──────────┘  └──────────────────┘ │
│  ┌──────────────────────────────────────────────┐  │
│  │               Types & Utils                  │  │
│  └──────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│              Infrastructure Layer                   │
│  (IndexedDB / SQLite / LocalStorage / FileSystem)   │
└─────────────────────────────────────────────────────┘
```

### 2.2 目录结构

```
src/core/
├── index.ts                 # 核心导出入口
├── types/
│   └── index.ts            # 类型定义（Block, Page, Link, Tag, Property...）
├── services/
│   ├── index.ts            # 服务导出
│   ├── blockService.ts     # Block 领域服务
│   ├── linkService.ts      # Link 领域服务
│   ├── tagService.ts       # Tag 领域服务
│   ├── propertyService.ts  # Property 领域服务
│   └── pageService.ts      # Page 领域服务（Phase 2 Sprint 2）
├── storage/
│   ├── index.ts            # 存储模块导出
│   ├── adapter.ts          # StorageAdapter 接口定义
│   ├── memoryAdapter.ts    # 内存存储实现（测试用）
│   └── indexedDBAdapter.ts # IndexedDB 实现（Phase 2 Sprint 2）
└── search/
    ├── index.ts            # 搜索模块导出
    ├── searchService.ts    # 搜索服务接口
    └── lunrSearch.ts       # Lunr.js 实现（Phase 2 Sprint 3）
```

***

## 3. 核心模块

### 3.1 类型系统 (Types)

**位置：** `src/core/types/index.ts`

定义所有业务实体的 TypeScript 类型：

| 类型 | 说明 |
|------|------|
| `Block` | 最小编辑单元 |
| `BlockType` | Block 类型枚举 |
| `BlockCreateOptions` | Block 创建选项 |
| `BlockUpdateOptions` | Block 更新选项 |
| `TreeNode` | Block 树形节点 |
| `SubtreeNode` | 简化树节点 |
| `BlockPath` | Block 路径 |
| `Page` | 顶级 Block（页面） |
| `PageType` | Page 类型枚举 |
| `Link` | 双向链接 |
| `LinkParse` | 链接解析结果 |
| `Tag` | 标签 |
| `TagParse` | 标签解析结果 |
| `Property` | 属性实例 |
| `PropertyDefinition` | 属性定义（元数据） |
| `PropertyType` | 属性类型枚举 |
| `PropertyValue` | 属性值联合类型 |
| `RelationshipType` | 关系类型（Phase 2 Sprint 2） |
| `UserTemplate` | 用户模板（Phase 2 Sprint 2） |
| `TemplateBlock` | 模板块结构 |
| `SearchResult` | 搜索结果 |
| `SearchOptions` | 搜索选项 |
| `Result<T>` | 通用操作结果 |
| `PagedResult<T>` | 分页结果 |

**设计原则：**
- 类型只描述数据结构，不包含逻辑
- 使用 `interface` 而非 `class`，避免运行时开销
- 类型字段与数据库表字段一一对应

### 3.2 领域服务 (Services)

**位置：** `src/core/services/`

每个业务实体对应一个 Service 类，封装核心业务逻辑。

#### BlockService

**职责：**
- Block CRUD 操作
- 树形结构构建与遍历
- Block 移动（拖拽、缩进、反缩进）
- Gap Sort 排序与重平衡

**关键方法：**

| 方法 | 说明 |
|------|------|
| `getById(id)` | 根据 ID 获取 Block |
| `getByPageId(pageId)` | 获取页面的所有 Block |
| `getChildren(parentId)` | 获取子 Block |
| `create(options)` | 创建 Block |
| `update(id, options)` | 更新 Block |
| `delete(id)` | 删除 Block（递归删除子 Block） |
| `buildTree(pageId)` | 构建 Block 树 |
| `move(blockId, newParentId, afterBlockId)` | 移动 Block |
| `indent(blockId)` | 缩进 Block |
| `outdent(blockId)` | 反缩进 Block |
| `getBlockPath(blockId)` | 获取 Block 路径 |

#### LinkService

**职责：**
- Link CRUD 操作
- 反向链接查询
- 链接同步（解析内容 → 更新数据库）

**关键方法：**

| 方法 | 说明 |
|------|------|
| `getById(id)` | 根据 ID 获取 Link |
| `getBySourceBlockId(blockId)` | 获取源 Block 的所有链接 |
| `getBacklinks(pageId)` | 获取页面的反向链接 |
| `create(options)` | 创建 Link |
| `createMany(optionsList)` | 批量创建 Link |
| `deleteBySourceBlockId(blockId)` | 删除源 Block 的所有链接 |
| `syncBlockLinks(blockId, pageId, parsedLinks)` | 同步 Block 的链接 |

#### TagService

**职责：**
- 标签解析（从文本中提取标签）
- 标签高亮
- 嵌套标签处理

**关键方法：**

| 方法 | 说明 |
|------|------|
| `parseTags(content)` | 解析文本中的所有标签 |
| `extractUniqueTags(content)` | 提取唯一标签名（含父标签） |
| `highlightTags(content)` | 高亮文本中的标签 |

#### PropertyService

**职责：**
- Property CRUD 操作
- 属性类型推断
- 内联属性解析
- 属性同步

**关键方法：**

| 方法 | 说明 |
|------|------|
| `getByBlockId(blockId)` | 获取 Block 的所有属性 |
| `getByKey(blockId, key)` | 根据 key 获取属性 |
| `setProperty(blockId, key, value, type?)` | 设置属性 |
| `deleteProperty(blockId, key)` | 删除属性 |
| `inferType(value)` | 推断属性值的类型 |
| `parseProperties(content)` | 从 Block 内容中解析属性 |
| `syncBlockProperties(blockId, content)` | 同步 Block 的属性 |

### 3.3 存储抽象 (Storage)

**位置：** `src/core/storage/`

详见 [StorageAdapter 接口规范](./storage-adapter.md)。

### 3.4 搜索模块 (Search)

**位置：** `src/core/search/`

Phase 2 Sprint 3 实现。

基于 Lunr.js + segmentit（中文分词）的全文搜索。

***

## 4. 数据流

### 4.1 读数据流

```
UI Layer (Vue Component)
    ↓
Pinia Store
    ↓
Core Service (e.g. BlockService)
    ↓
StorageAdapter (Repository)
    ↓
IndexedDB / SQLite
    ↓
返回数据 → Service 处理 → Store → Component 渲染
```

### 4.2 写数据流

```
用户操作 → UI Component
    ↓
Pinia Store Action
    ↓
Core Service (e.g. BlockService.update)
    ↓
StorageAdapter.transaction()
    ↓
Repository 操作
    ↓
持久化到 IndexedDB / SQLite
    ↓
返回结果 → Store 更新 → Component 重新渲染
```

***

## 5. 服务初始化

### 5.1 创建方式

```typescript
import { createStorageAdapter, BlockService, LinkService } from '@/core'

// 1. 创建 Storage Adapter
const storage = await createStorageAdapter('indexeddb')

// 2. 创建各个 Service
const blockService = new BlockService({ storage })
const linkService = new LinkService({ storage })
const tagService = new TagService()
const propertyService = new PropertyService({ storage })
```

### 5.2 Pinia 集成

```typescript
// stores/blocks.ts
import { defineStore } from 'pinia'
import { BlockService, createStorageAdapter } from '@/core'

let blockService: BlockService | null = null

async function getBlockService() {
  if (!blockService) {
    const storage = await createStorageAdapter('indexeddb')
    blockService = new BlockService({ storage })
  }
  return blockService
}

export const useBlocksStore = defineStore('blocks', {
  actions: {
    async loadPage(pageId: string) {
      const service = await getBlockService()
      const blocks = await service.getByPageId(pageId)
      // ...
    }
  }
})
```

***

## 6. 迁移策略

### 6.1 阶段一：Core 层定义（Sprint 1）

- ✅ 定义类型系统
- ✅ 定义 Service 接口
- ✅ 实现基础 Service
- ✅ 定义 StorageAdapter 接口
- ✅ 实现 MemoryAdapter（测试用）

### 6.2 阶段二：IndexedDB 适配（Sprint 2）

- 实现 IndexedDBAdapter
- 重构 Pinia stores 使用 Core Service
- 保持向后兼容

### 6.3 阶段三：SQLite 迁移（Phase 3）

- 实现 SQLiteAdapter
- 创建迁移工具
- 平滑切换存储后端

***

## 7. 测试策略

### 7.1 单元测试

- **测试目标：** Service 层的业务逻辑
- **测试方式：** 使用 MemoryAdapter 作为存储后端
- **覆盖率目标：** ≥ 80%

### 7.2 集成测试

- **测试目标：** StorageAdapter 与真实存储的交互
- **测试方式：** 使用实际的 IndexedDB（或 SQLite）
- **测试框架：** Vitest + 浏览器环境

### 7.3 测试示例

```typescript
// blockService.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { BlockService } from '@/core'
import { MemoryAdapter } from '@/core/storage/memoryAdapter'

describe('BlockService', () => {
  let service: BlockService
  let storage: MemoryAdapter

  beforeEach(() => {
    storage = new MemoryAdapter()
    service = new BlockService({ storage })
  })

  it('should create a block', async () => {
    const block = await service.create({
      pageId: 'page-1',
      content: 'Hello World',
    })

    expect(block.id).toBeDefined()
    expect(block.content).toBe('Hello World')
  })

  it('should build a tree', async () => {
    // ...
  })
})
```

***

## 8. 错误处理

### 8.1 错误分类

| 错误类型 | 说明 | 处理方式 |
|----------|------|----------|
| **参数错误** | 无效的 ID、空值等 | 抛出 Error，调用方处理 |
| **存储错误** | 数据库连接失败、事务失败 | 抛出 Error，记录日志 |
| **业务错误** | 逻辑冲突、状态异常 | 返回 Result 类型 |
| **并发错误** | 乐观锁冲突、事务冲突 | 重试或提示用户 |

### 8.2 Result 类型

对于可预期的业务错误，使用 Result 类型：

```typescript
interface Result<T = void> {
  success: boolean
  data?: T
  error?: string
}
```

***

## 9. 性能优化

### 9.1 缓存策略

- Service 层不做缓存（缓存由 Pinia Store 负责）
- StorageAdapter 可以实现查询缓存（可选）
- 搜索索引独立缓存（Lunr.js）

### 9.2 批量操作

- 优先使用批量操作减少 IO
- 事务中批量写入

### 9.3 惰性加载

- 树形数据按需加载
- 大数据量分页查询

***

## 10. 与现有代码的关系

### 10.1 保留的代码

以下代码继续存在，作为 UI 层：

| 模块 | 说明 |
|------|------|
| `src/stores/` | Pinia stores，作为 UI 与 Core 的桥接 |
| `src/components/` | Vue 组件 |
| `src/extensions/` | tiptap 扩展 |

### 10.2 迁移的代码

以下逻辑逐步迁移到 Core 层：

| 模块 | 当前位置 | 目标位置 |
|------|----------|----------|
| Block 树操作 | `src/stores/blocks.ts` | `src/core/services/blockService.ts` |
| Gap Sort | `src/stores/blocks.ts` | `src/core/services/blockService.ts` |
| Link 管理 | `src/stores/relationship.ts` | `src/core/services/linkService.ts` |
| Tag 解析 | `src/utils/parser.ts` | `src/core/services/tagService.ts` |
| Property 解析 | `src/utils/parser.ts` | `src/core/services/propertyService.ts` |

***

## 11. 相关文档

| 文档 | 链接 |
|------|------|
| SPEC.md | [项目总规范](../1-overview/SPEC.md) |
| data-model.md | [核心数据模型](./data-model.md) |
| storage-spec.md | [存储层规范](./storage-spec.md) |
| storage-adapter.md | [StorageAdapter 接口规范](./storage-adapter.md) |
| sprint-1-plan.md | [Sprint 1 详细计划](./sprint-1-plan.md) |

***

*文档 v1.0，Phase 2 规划中。*
