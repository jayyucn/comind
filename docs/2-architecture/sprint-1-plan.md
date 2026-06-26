# Phase 2 Sprint 1 详细计划

> 版本：v1.0
> 日期：2026-06-27
> 周期：Week 1-2（2026-07-01 ~ 2026-07-14）

---

## 1. 目标

完成 Core 层的架构设计和 Block/Link 基础服务的抽离，为 Phase 2 后续 Sprint 打下坚实基础。

## 2. 交付物

| 交付物 | 路径 | 说明 |
|--------|------|------|
| Core 层类型系统 | `src/core/types/index.ts` | ✅ 已完成 |
| BlockService | `src/core/services/blockService.ts` | ✅ 已完成 |
| LinkService | `src/core/services/linkService.ts` | ✅ 已完成 |
| TagService | `src/core/services/tagService.ts` | ✅ 已完成 |
| PropertyService | `src/core/services/propertyService.ts` | ✅ 已完成 |
| StorageAdapter 接口 | `src/core/storage/adapter.ts` | ✅ 已完成 |
| MemoryAdapter | `src/core/storage/memoryAdapter.ts` | ✅ 已完成（测试用） |
| Core 层单元测试 | `src/core/__tests__/*.test.ts` | ✅ 已完成（139 测试，覆盖率 95%+） |

## 3. 任务分解

### T1.1：Core 层类型系统 ✅

**状态**：已完成

**产出**：`src/core/types/index.ts`

**内容**：
- Block 类型（Block, BlockCreateOptions, BlockUpdateOptions, TreeNode）
- Page 类型（Page, PageCreateOptions, PageUpdateOptions）
- Link 类型（Link, LinkCreateOptions, LinkParse）
- Tag 类型（Tag, TagParse）
- Property 类型（Property, PropertyDefinition, PropertyValue）
- Search 类型（SearchResult, SearchOptions）
- 通用的 Result 和 PagedResult 类型

### T1.2：BlockService ✅

**状态**：已完成

**产出**：`src/core/services/blockService.ts`

**功能**：
- Block CRUD 操作（getById, getByPageId, getChildren, create, update, delete）
- 树形结构操作（buildTree）
- Block 移动（move, indent, outdent）
- Block 路径查询（getBlockPath）
- Gap Sort 排序和重平衡（checkAndRebalance）

### T1.3：LinkService ✅

**状态**：已完成

**产出**：`src/core/services/linkService.ts`

**功能**：
- Link CRUD 操作（getById, getBySourceBlockId, getBacklinks, create）
- 链接同步（syncBlockLinks）

### T1.4：TagService ✅

**状态**：已完成

**产出**：`src/core/services/tagService.ts`

**功能**：
- 标签解析（parseTags, extractUniqueTags）
- 标签高亮（highlightTags）

### T1.5：PropertyService ✅

**状态**：已完成

**产出**：`src/core/services/propertyService.ts`

**功能**：
- Property CRUD 操作（getByBlockId, getByKey, setProperty, deleteProperty）
- 属性类型推断（inferType）
- 属性解析（parseProperties，从 Block 内容中解析 `key:: value`）
- 属性同步（syncBlockProperties）

### T1.6：StorageAdapter 接口 ✅

**状态**：已完成

**产出**：`src/core/storage/adapter.ts`

**接口定义**：
- StorageAdapter 主接口
- BlockRepository, PageRepository, LinkRepository, TagRepository, PropertyRepository
- createStorageAdapter 工厂函数

### T1.7：MemoryAdapter ✅

**状态**：已完成

**产出**：`src/core/storage/memoryAdapter.ts`

**功能**：
- 所有 Repository 的内存实现
- 事务支持
- 用于单元测试

### T1.8：Core 层单元测试 ✅

**状态**：已完成

**产出**：`src/core/__tests__/blockService.test.ts`、`linkService.test.ts`、`tagService.test.ts`、`propertyService.test.ts`、`memoryAdapter.test.ts`

**测试覆盖**：
- 5 个测试文件，共 139 个测试
- Statements: 95.02%
- Branches: 88.6%
- Functions: 95.79%
- Lines: 96.95%

**测试内容**：
- BlockService: CRUD、树形结构、移动、缩进、路径查询
- LinkService: CRUD、链接同步、反向链接
- TagService: 解析、高亮、唯一标签提取
- PropertyService: CRUD、类型推断、属性同步
- MemoryAdapter: 事务、Repository 操作

## 4. 技术要点

### 4.1 框架无关原则

Core 层必须遵循以下原则：
- 不依赖 Vue、Pinia、tiptap 等前端框架
- 所有依赖通过参数注入
- 使用纯 TypeScript 类型，不依赖框架特定类型

### 4.2 Repository 模式

每个数据实体对应一个 Repository：
```typescript
interface BlockRepository {
  findById(id: string): Promise<Block | undefined>
  findByPageId(pageId: string): Promise<Block[]>
  // ...
}
```

### 4.3 事务支持

StorageAdapter 提供事务接口：
```typescript
async transaction<T>(callback: (tx: StorageAdapter) => Promise<T>): Promise<T>
```

## 5. 与现有代码的关系

### 5.1 保留现有 stores

Phase 2 不会立即删除现有 `stores/`，而是：
1. Core 层作为独立的领域逻辑层
2. Pinia stores 继续存在，作为 UI 层与 Core 层的桥接
3. 逐步将逻辑下沉到 Core 层

### 5.2 迁移策略

- Phase 2 Sprint 1-2：Core 层定义和基础服务
- Phase 2 Sprint 2：重构 Pinia stores 使用 Core 层
- Phase 3：完全移除框架依赖

## 6. 验收标准

| 标准 | 说明 |
|------|------|
| 构建通过 | `npm run build` 无错误 |
| 类型检查通过 | `vue-tsc -b` 无错误 |
| 单元测试通过 | Core 层测试覆盖率 ≥ 80% |
| 文档完整 | JSDoc 注释完整 |

## 7. 下一步

Sprint 1 完成后，进入 **Sprint 2（Week 3-4）**：

| 任务 | 描述 | 状态 |
|------|------|------|
| T2.1 | 抽离 Tag 解析逻辑 → TagService | ✅ 已完成 |
| T2.2 | 抽离 Property 解析逻辑 → PropertyService | ✅ 已完成 |
| T2.3 | 定义 StorageAdapter 接口 → adapter.ts | ✅ 已完成 |
| T2.4 | 实现 IndexedDB Adapter | ✅ 已完成 |
| T2.5 | 集成 Pinia Store 到 Core | ✅ 已完成 |

### T2.4：IndexedDB Adapter ✅

**状态**：已完成

**产出**：`src/core/storage/indexedDBAdapter.ts`

**功能**：
- 使用 Dexie.js 实现 StorageAdapter 接口
- Core 层类型与 Record 类型转换
- 支持 Block、Page、Link、Property Repository
- 事务支持
- 与现有 IndexedDB 数据库交互

### T2.5：集成 Pinia Store 到 Core ✅

**状态**：已完成

**产出**：
- `src/core/index.ts` - Core 层初始化入口
- `src/core/services/pageService.ts` - Page 服务
- 更新 `src/stores/blocks.ts` - 使用 Core 层
- 更新 `src/stores/pages.ts` - 使用 Core 层
- 更新 `src/stores/property.ts` - 使用 Core 层
- `tests/setup.ts` - 测试初始化

**集成内容**：
- Core 层初始化入口 (`initCore`)
- BlockService → blocks store
- PageService → pages store
- PropertyService → property store
- 测试环境支持

---

*文档版本 v1.1，Sprint 2 完成。*
