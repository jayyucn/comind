# 开发指南

> 更新日期：2026-08-09\
> 覆盖变更：2026-08-08 ~ 2026-08-09

开发者相关的文档和指南。

## 文档列表

| 文件 | 说明 |
| --- | --- |
| [dev-guide.md](dev-guide.md) | 开发指南 - 环境搭建、开发流程、测试（2026-08-09 重大更新：§7 Rust Core 开发指南；§8 TaskHub 查询引擎 API） |
| [page-block-crud.md](page-block-crud.md) | Page/Block CRUD - 页面和块的增删改查操作 |

## 新增开发要点（2026-08-08 ~ 08-09）

### §1 Rust Core Layer 开发规范

**构建环境：**
```bash
# 首次构建 Rust Core（Tauri 桌面端）
cd comind
npm run tauri:build         # 生产构建
npm run tauri:dev           # 开发模式（热重载）

# WebAssembly 构建（Web 端）
wasm-pack build crates/comind-wasm --target web --out-dir ../../src/wasm/pkg
```

**新增 Rust Service 编写规范：**
1. Service 定义于 `crates/comind-core/src/services/xxx_service.rs`，纯逻辑 + StorageAdapter trait 注入
2. 在 `services/mod.rs` 中 `pub mod xxx_service; pub use xxx_service::*;`
3. Tauri 命令封装于 `src-tauri/src/commands.rs`，参数扁平化，返回 `Result<T, String>`
4. WASM 端同步封装于 `src/wasm/client.ts`（`CoreClient` trait） + `src/wasm/tauri-client.ts`（invoke 实现）

### §2 TS 侧调用 Rust Core API（通过 `wasm/client.ts`）

```typescript
// 初始化客户端（单例）
import { initCoreClient, type CoreClient } from '@/wasm/client'
const client = await initCoreClient()

// ==== 通知配置 ====
await client.getNotificationConfig()           // 获取通知配置
await client.saveNotificationConfig(cfg)       // 保存通知配置
await client.checkDueNotifications()           // 触发到期提醒检查

// ==== 日期工具（Rust 解析）====
await client.parseDateRef("明天下午3点")        // 自然语言 → DateRef
await client.detectJournalPage("2026-08-09")    // 是否为日记标题
await client.nextRecurrence("FREQ=WEEKLY;BYDAY=MO") // 下次重复时间

// ==== 内容解析 ====
await client.extractLinksFromContent("[[页面]] ((type))[[目标|别名]]")
await client.extractPropertiesFromContent("status:: done\ndue:: 2026-08-15")
await client.parseRenderSegments(blockContent)  // → text/link/property 渲染段

// ==== BlockCard / 查询 ====
await client.getBlockCards()                    // 获取所有块投影卡片
```

### §3 BlockQuery 查询引擎（TS 侧，`useBlockQuery.ts`）

```typescript
import { applyQuery } from '@/composables/useBlockQuery'
import type { BlockQuery } from '@/types/blockQuery'

const query: BlockQuery = {
  filters: [
    // 支持字段：content / property(key) / dateRef(kind|date)
    { field: { kind: 'property', key: 'status' }, op: 'isNot', value: 'done' },
    { field: { kind: 'dateRef', ref: 'date' }, op: 'before', value: '2026-08-15' },
  ],
  sort: [
    { field: { kind: 'property', key: 'priority' }, direction: 'desc' },
    { field: { kind: 'content' }, direction: 'asc' },
  ],
  groupBy: { kind: 'property', key: 'status' }, // UI 层分组使用
}
const result: BlockCard[] = applyQuery(allCards, query)
```

**支持操作符（FilterOp）：** `hasAny` | `isEmpty` | `is` | `isNot` | `contains` | `before` | `after`

### §4 TaskHub 相关 Store

| Store | 文件 | 用途 |
| --- | --- | --- |
| `useBlockCardStore` | `src/stores/blockCard.ts` | BlockCard 缓存 + 脏标记刷新（`invalidate(blockId?)`） |
| `useTaskViewStore` | `src/stores/taskView.ts` | 视图方案 CRUD + 当前视图切换（持久化 JSON 查询） |
| `useSavedFilterStore` | `src/stores/savedFilter.ts` | 保存的过滤器预设 CRUD |
| `useBlockQuery` | `src/composables/useBlockQuery.ts` | 纯函数查询引擎 `applyQuery()` |

### §5 路由新增

```typescript
// src/router/routes.ts
{ path: '/taskhub', name: 'TaskHub', component: () => import('@/components/TaskHub/TaskHub.vue') }
```

## 快速链接

- [项目概览](../1-overview/)
- [架构设计](../2-architecture/)
- [Rust Core 入口](file:///D:/comind/comind/crates/comind-core/src/lib.rs)
- [Tauri Commands](file:///D:/comind/comind/src-tauri/src/commands.rs)
- [TS→Rust 迁移说明](file:///D:/comind/comind/docs/refactor-design-ts-rust-separation.md)
