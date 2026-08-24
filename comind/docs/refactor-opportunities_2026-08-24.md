# 重构机会分析报告

## 1. commands.rs — 巨型 God File（1862 行）

### 问题
- 单文件承载了所有 Tauri IPC command，已膨胀到近 1900 行
- 混合了：Block/Page/Link/Property CRUD、Screen/Tab 管理、Notification、Sync、DateRef、Batch、Graph、Markdown Export/Import、Versioning、Settings 等 10+ 个领域
- 任何领域的小改动都会触发整个文件的重新编译

### 重构方向
按领域拆分为独立模块：
```
src/commands/
  mod.rs          # 仅保留 execute_with_adapter / execute_with_transaction_adapter + re-export
  block.rs        # get_block, get_blocks_by_page, save_block_tree, delete_block, versioning
  page.rs         # get_page, get_all_pages, save_page, delete_page_cascade
  filter.rs       # saved_filters, screen_views, tabs
  link.rs         # get_backlinks, get_outlinks
  notification.rs # notification CRUD, settings, check_and_fire
  sync_cmd.rs     # sync_now, trigger_sync, get_sync_config, export/import markdown
  date_ref.rs     # query_date_refs, overdue, recurring
  graph.rs        # build_graph_snapshot
  batch.rs        # execute_batch
  misc.rs         # pure computation commands (parse_date, extract_links, etc.)
```

### 收益
- 编译并行度提升（各模块可独立编译）
- 代码审查/导航效率提升
- 新人 onboarding 更容易定位领域逻辑

---

## 2. commands.rs — 同步通知代码重复（~20 处相同模式）

### 问题
写操作后触发同步通知的代码重复出现：
```rust
let sync_server_clone = sync_server.inner().clone();
tokio::spawn(async move {
    sync_server_clone.record_and_notify(SyncTable::Page, vec![page_id]).await;
});
```

出现在：save_page, delete_page_cascade, save_block_tree, delete_block, set_property, delete_property, rebuild_date_refs 等至少 8 处

### 重构方向
提取一个宏或泛型辅助函数：
```rust
async fn with_sync_notify<F, R>(
    sync_server: &SyncServerHandle,
    table: SyncTable,
    ids: Vec<String>,
    f: F,
) -> Result<R, String>
where
    F: FnOnce() -> Result<R, String>,
{
    let result = f();
    if result.is_ok() {
        let sync_server_clone = sync_server.inner().clone();
        tokio::spawn(async move {
            sync_server_clone.record_and_notify(table, ids).await;
        });
    }
    result
}
```

### 收益
- 消除重复代码
- 统一错误处理和通知逻辑
- 减少未来遗漏通知的风险

---

## 3. sync.rs — 同步任务重复代码（~100 行重复模式）

### 问题
`sync_on_exit`, `sync_on_minimize`, `sync_on_focus` 三个函数共享几乎相同的模式：
- 获取 config
- 检查 sync_enabled
- 获取 sync_dir
- 获取 adapter lock
- 调用 markdown::export_all/export_changed
- 设置 SYNC_IN_PROGRESS 标志

### 重构方向
提取通用骨架：
```rust
async fn run_sync_task<F>(
    app_handle: &AppHandle,
    task_name: &str,
    f: F,
) where
    F: FnOnce(&mut dyn StorageAdapter, &Path) -> Result<ExportResult, String>,
{
    // 统一的 config 获取、enabled 检查、lock 管理、错误日志
}
```

### 收益
- 消除 3 处重复代码
- 统一超时、错误处理、日志格式

---

## 4. lib.rs — setup 函数过长（~250 行）

### 问题
`run()` 函数的 `.setup()` 闭包承担了：
- 目录创建
- 数据库初始化
- 通知设置 seed
- ConfigManager 注册
- SyncServer 启动（含条件编译）
- SyncClient 初始化（移动端）
- 插件注册

### 重构方向
将 setup 拆分为多个 `fn setup_*()`：
```rust
fn setup_directories(app: &AppHandle) -> Result<(), String> { ... }
fn setup_database(app: &AppHandle) -> Result<DatabaseConnection, String> { ... }
fn setup_sync_server(app: &AppHandle, db: &DatabaseConnection) { ... }
fn setup_plugins(app: &AppHandle) { ... }
```

### 收益
- setup 逻辑清晰可测试
- 每个子 setup 可独立单元测试

---

## 5. commands.rs — execute_batch 巨型 match（~300 行）

### 问题
`execute_batch` 是一个巨大的 match 表达式，处理 12+ 种 entity/action 组合，每个分支都有大量重复代码（sync_changes 收集、PageService::update 调用）。

### 重构方向
1. 为每个 entity 实现 `BatchOperation` trait：
```rust
trait BatchOperation {
    fn execute(&self, storage: &mut dyn StorageAdapter) -> Result<serde_json::Value, String>;
    fn collect_sync_changes(&self) -> Vec<(SyncTable, String)>;
}
```
2. 使用注册表模式（Registry Pattern）自动分发

### 收益
- 新增 batch 操作无需修改 execute_batch 主体
- 每个操作可独立测试
- 消除重复的条件分支代码

---

## 6. state.rs — SyncServerHandle 平台条件编译过多

### 问题
`SyncServerHandle` 通过 `#[cfg(not(target_os = "android"))]` 和 `#[cfg(target_os = "android")]` 在结构体级别做条件编译，导致代码可读性差。

### 重构方向
使用 trait 抽象统一接口：
```rust
trait SyncHandle {
    async fn record_and_notify(&self, table: SyncTable, ids: Vec<String>);
}

struct DesktopSyncHandle { ... }
struct MobileSyncHandle { ... }
```
在编译时通过 feature flag 选择实现。

### 收益
- 消除 `#cfg` 噪音
- 统一接口契约
- 便于未来扩展其他平台（iOS）

---

## 7. sync_server.rs — SyncServerInner 字段过多（~12 个 Arc）

### 问题
`SyncServerInner` 持有 12 个 `Arc<...>` 字段，构造函数重复初始化代码长。

### 重构方向
使用 Builder 模式：
```rust
let server = SyncServer::builder()
    .db_path(db_path)
    .device_name(device_name)
    .build()?;
```

### 收益
- 构造函数简洁
- 可选字段有默认值
- 编译期保证必填字段

---

## 8. 整体架构建议：引入 CQRS 风格分层

当前 commands.rs 直接调用 Service + StorageAdapter，随着功能增长，可考虑：

```
Command Handler (Tauri command)
  ↓
Application Service (业务编排)
  ↓
Domain Service (纯业务逻辑)
  ↓
Repository / StorageAdapter (数据访问)
```

目前 `execute_with_adapter` 已初步体现 Repository 模式，但 commands 仍直接调用 Service，未来可考虑引入 Application Service 层统一处理事务、同步通知、权限校验等横切关注点。

---

## 优先级建议

| 优先级 | 重构项 | 工作量 | 收益 |
|--------|--------|--------|------|
| 🔴 高 | 1. commands.rs 按领域拆分 | 中 | 编译速度、可维护性 |
| 🔴 高 | 2. 同步通知代码去重 | 低 | 消除重复、减少 bug |
| 🟡 中 | 3. sync.rs 提取通用骨架 | 低 | 消除重复 |
| 🟡 中 | 5. execute_batch 注册表模式 | 中 | 可扩展性 |
| 🟢 低 | 4. lib.rs setup 拆分 | 低 | 可读性 |
| 🟢 低 | 6. SyncServerHandle trait 抽象 | 中 | 跨平台 clarity |
| 🟢 低 | 7. SyncServer Builder 模式 | 低 | 构造函数简洁 |
