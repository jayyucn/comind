# SQLite ↔ Markdown 转换功能实施方案

## Context

用户请求"添加 sqlite 和 markdown 之间的转换入口"，并附加需求："增加 sqlite→md 自动同步的功能，每隔5秒自动同步一次，关闭页面或关闭程序时同步"。

**现状**：
- `SettingsModal.vue` 的"数据管理"区有两个**禁用**的导出/导入按钮（当前标签为 JSON）
- Tauri 后端有直接的 SQLite 访问能力（`DatabaseConnection`），但缺少文件 I/O 命令和 Markdown 序列化逻辑
- 项目 memory 规定使用 MD2 格式（带 HTML 注释元数据的 Markdown）用于无损往返
- SQLite 是唯一真相源，Markdown 仅用于一次性导出/导入

**目标**：
1. 启用 SettingsModal 的导出/导入按钮，实现 SQLite ↔ Markdown 转换
2. 添加自动同步开关（每5秒一次，关闭时同步）
3. 全部在 Rust 实现（Tauri 命令直接操作 SQLite + `std::fs` 读写文件）

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 架构层 | 全部在 Rust | 性能好、复用现有 `DatabaseConnection`、无 IPC 开销 |
| Property 表 | 导出/导入 | Property 表存储了 type/sort_order/is_hidden 等 UI 辅助字段，切换设备时需要同步 |
| RelationshipType | 导出/导入 | 用户自定义的关系类型需要同步 |
| UserTemplate | 导出/导入 | 用户自定义的模板需要同步 |
| 不支持的 Block type | 降级为 bullet | 与现有 `serialize-block-tree.ts` 行为一致 |
| 元数据格式 | 单行 JSON HTML 注释 | 复用 `serde_json`，无需引入 YAML |
| 同步开关运行时生效 | 配置变更需重启生效 | 与现有"数据库路径变更需重启"行为一致 |
| replace 策略实现 | 清空所有 Block/Link/Property + Page upsert | 避免软删除 Page 的 UNIQUE 冲突问题 |
| 同步间隔 | 5秒 | 确保内容快速同步，设备切换时内容一致 |
| 配置版本管理 | 添加 config_version 字段 | 支持默认值变更时自动迁移 |

**关键技术约束**（已验证）：
- `Page::delete` 是**软删除**（`UPDATE deleted=1`），SQLite UNIQUE 约束是全局的，所以不能简单"软删除后创建同名 Page"
- `Block::delete` 和 `Link::delete` 是**硬删除**
- `BlockService::build_tree(storage, page_id)` 返回 `BlockTree { block_map, root_blocks, children_map }`，可直接复用
- `PageService::get_by_title` 只查 `deleted=0`，无法找到已删除的 Page
- `Page.aliases` 在 Rust 是 JSON 字符串（如 `'["a","b"]'`），需 `serde_json::from_str::<Vec<String>>` 解析
- 当用户修改 Block 内容时，需要更新对应 Page 的 `updated_at` 字段，否则变更同步无法检测到变化

## MD2 格式规范

```
<!-- comind: {"id":"abc","type":"normal","icon":"📌","aliases":["别名"],"blockId":null,"createdAt":1700000000000,"updatedAt":1700000000000} -->

# 标题1
- 普通 bullet
  - 嵌套子 bullet，含 [[目标页面]]
  - ((depends-on))[[目标页面|显示文本]]
- 作者:: 张三
## 子标题
  - 更深的 bullet
```

- **文件名**：`{Page.title}.md`，非法字符 `/ \ : * ? " < > |` 替换为 `_`
- **第一行**：`<!-- comind: {JSON} -->`，包含 `id, type, icon, aliases, blockId, createdAt, updatedAt`（title 从文件名取）
- **正文**：Block 树的 Markdown 序列化
  - heading（format.type='heading'）：`#`/`##`/`###` + content，级别由 format.level 决定
  - bullet：`- ` + content
  - property：`- ` + content（content 本身是 `key:: value`）
  - query/embed/code/image/concept：降级为 `- ` + content
  - 嵌套：每级 2 空格缩进

## 实施步骤

### 步骤 1: Cargo.toml 添加 regex 依赖

**文件**：`d:\comind\comind\src-tauri\Cargo.toml`

在 `[dependencies]` 末尾添加：
```toml
regex = "1"
```

**验证**：`cargo check` 通过

### 步骤 2: 扩展 AppConfig

**文件**：`d:\comind\comind\src-tauri\src\config.rs`

- 派生 `Clone`
- 添加 3 个字段：`sync_enabled: bool`（默认 false）、`sync_directory: Option<String>`（默认 None）、`sync_interval_secs: u64`（默认 300）
- 更新 `Default` 实现

### 步骤 3: 新建 markdown.rs 模块

**文件**：`d:\comind\comind\src-tauri\src\markdown.rs`（新建）

核心函数：
```rust
pub fn export_all(storage: &mut dyn StorageAdapter, dir: &Path) -> Result<ExportResult, Box<dyn Error>>
pub fn import_all(storage: &mut dyn StorageAdapter, dir: &Path, strategy: &str) -> Result<ImportResult, Box<dyn Error>>
```

**导出逻辑**：
1. `PageService::get_all(storage)` 获取所有未删除 Page
2. 对每个 Page：`BlockService::build_tree(storage, &page.id)` 获取 Block 树
3. 序列化为 Markdown 字符串（HTML 注释元数据 + DFS 遍历 Block 树）
4. `std::fs::write` 写入 `{dir}/{sanitized_title}.md`

**导入逻辑**（三阶段）：
1. 解析所有 .md 文件（元数据 + Block 行）
2. 创建/更新 Page，建立 `title → page_id` 映射
3. 创建 Block 树（depth → parent_id 栈）+ 解析 Link

**replace 策略**（避免 UNIQUE 冲突）：
- 先遍历所有现有 Page，删除其 Block/Link/Property（硬删除）
- 删除所有非内置 RelationshipType 和 UserTemplate
- 对每个导入的 Page：`get_by_title`（deleted=0）找到则 UPDATE，找不到则 CREATE（新 ID，不冲突）

**merge 策略**：
- 不预清空
- 对每个导入的 Page：找到则删除其 Block/Link/Property 并 UPDATE，找不到则 CREATE
- 对 RelationshipType 和 UserTemplate：按 type/name 匹配，找到则 UPDATE，找不到则 CREATE

**Link 解析**：移植 `src/utils/parser.ts` 的 `extractLinkMatches` 逻辑到 Rust（用 `regex` crate，先匹配 `((type))[[...]]` 再匹配 `[[...]]`）

**返回类型**：
```rust
#[derive(Serialize)]
pub struct ExportResult { 
    pages_exported: usize, 
    blocks_exported: usize, 
    properties_exported: usize, 
    relationship_types_exported: usize, 
    templates_exported: usize, 
    directory: String 
}

#[derive(Serialize)]
pub struct ImportResult { 
    pages_imported: usize, 
    blocks_imported: usize, 
    properties_imported: usize, 
    links_created: usize, 
    relationship_types_imported: usize, 
    templates_imported: usize, 
    strategy: String 
}
```

**单元测试**：往返一致性测试（创建 Page+Block → 导出 → 清空 → 导入 → 验证数据）

### 步骤 4: 新建 sync.rs 模块

**文件**：`d:\comind\comind\src-tauri\src\sync.rs`（新建）

```rust
pub fn start_sync_task(app_handle: tauri::AppHandle)
pub fn sync_on_exit(app_handle: &tauri::AppHandle)
pub fn sync_on_minimize(app_handle: &tauri::AppHandle)
pub fn sync_on_focus(app_handle: &tauri::AppHandle)
```

**同步策略**：

| 场景 | 同步类型 | 触发方式 | 是否异步 |
|------|----------|----------|----------|
| 应用启动首次同步 | 全量同步 | `IS_FIRST_SYNC` 标志 | ✅ 异步 |
| 定时自动同步（每5秒） | 变更同步 | `tokio::time::interval` | ✅ 异步 |
| 应用退出 | 全量同步 | `RunEvent::ExitRequested` | ✅ 异步（后台执行，带超时） |
| 窗口最小化/切换到后台 | 变更同步 | `WindowEvent::Focused(false)` | ✅ 异步 |
| 窗口恢复/切换到前台 | 全量同步（仅距上次全量同步超过1小时） | `WindowEvent::Focused(true)` | ✅ 异步 |
| 用户手动点击"立即同步" | 全量同步 | Tauri 命令 | ✅ 异步 |
| 页面保存后（防抖5秒） | 变更同步 | 前端事件通知 | ✅ 异步 |

**全量同步（export_all）**：
- 导出所有 Page + Block + Property + RelationshipType + Template
- 覆盖所有文件
- 用于首次同步、应用退出、手动触发
- 应用启动后第一次同步执行全量同步，确保所有内容都能导出

**变更同步（export_changed）**：
- 只导出 `updated_at > last_sync_time` 的内容
- 只更新修改过的文件
- 用于定时同步、窗口切换等频繁场景
- 只有当 `last_sync_time > now`（上次同步时间在未来）时，才回退到全量同步
- 当用户修改 Block/Property 等内容时，需要更新对应 Page 的 `updated_at` 字段

**最后同步时间记录**：
- 在 `.comind.json` 中存储 `last_sync_time`
- 每次同步后更新
- 变更同步时读取作为过滤条件

**防抖机制**：
- 页面保存触发的同步使用 5 秒防抖
- 避免高频编辑导致的频繁同步

**异步执行策略**：
- 所有同步操作通过 `tauri::async_runtime::spawn` 在后台执行
- 应用退出时使用 `tokio::time::timeout(Duration::from_secs(3))` 设置 3 秒超时
- 如果超时，只记录日志，不阻塞退出（优先保证退出流畅）

`start_sync_task`：在 setup 中调用，读取 AppConfig，若 `sync_enabled` 则启动后台任务：
- 使用 `ConfigManager` 获取配置，支持运行时配置更新
- `tauri::async_runtime::spawn` + `tokio::time::interval(Duration::from_secs(sync_interval_secs))`
- 应用启动后第一次同步执行全量同步（`IS_FIRST_SYNC` 标志）
- 后续每 tick 调用 `markdown::export_changed`（变更同步）
- 动态检测配置变化，自动更新同步间隔

`ConfigManager`：基于 `Mutex` 的配置管理结构，解决多线程配置访问与更新问题：
- `get_config()`：获取配置的 `MutexGuard`
- `update_config()`：更新内存中的配置
- 所有配置读取路径（sync.rs、commands.rs）通过 ConfigManager 获取配置

**配置版本迁移**：
- `config_version` 字段记录配置版本（默认为 0）
- `CURRENT_CONFIG_VERSION` 常量定义当前版本
- 加载配置时自动执行迁移，迁移后保存更新配置
- 当前版本 0→1 迁移：将 `sync_interval_secs` 更新为新默认值 5

`sync_on_exit`：在 `RunEvent::ExitRequested` 中调用，**异步执行**一次 `markdown::export_all`（全量同步）：
- 使用 `tauri::async_runtime::spawn` 启动后台任务
- 使用 `tokio::time::timeout(Duration::from_secs(3))` 设置 3 秒超时
- 不阻止应用退出，优先保证用户体验

`sync_on_minimize`：在 `WindowEvent::Focused(false)` 中调用，**异步执行**一次 `markdown::export_changed`（变更同步）

`sync_on_focus`：在 `WindowEvent::Focused(true)` 中调用，若距上次全量同步超过 1 小时，则**异步执行**一次 `markdown::export_all`（全量同步）

### 步骤 5: commands.rs 新增 5 个 Tauri 命令

**文件**：`d:\comind\comind\src-tauri\src\commands.rs`

```rust
#[tauri::command]
pub async fn export_to_markdown(db: State<...>, directory: String) -> Result<ExportResult, String>

#[tauri::command]
pub async fn import_from_markdown(db: State<...>, directory: String, strategy: String) -> Result<ImportResult, String>

#[tauri::command]
pub async fn get_sync_config(app_config: State<...>) -> Result<serde_json::Value, String>

#[tauri::command]
pub async fn set_sync_config(config_manager: State<ConfigManager>, config_dir: State<...>, enabled: bool, directory: Option<String>, interval_secs: Option<u64>) -> Result<(), String>

#[tauri::command]
pub async fn sync_now(db: State<...>, app_config: State<...>) -> Result<ExportResult, String>
```

`set_sync_config` 通过 `AppConfig::load` + 修改 + `save` + `config_manager.update_config()` 实现（修改后通过 ConfigManager 更新内存状态，运行时生效）

`save_block_tree`、`set_property`、`delete_property`、`execute_batch` 命令在修改内容后会更新对应 Page 的 `updated_at` 字段，确保变更同步能检测到变化

### 步骤 6: main.rs 注册模块和命令

**文件**：`d:\comind\comind\src-tauri\src\main.rs`

- 声明 `mod markdown;` 和 `mod sync;`
- 在 `setup` 中调用 `sync::start_sync_task(app.handle().clone())`
- 将 `.run(tauri::generate_context!()).expect(...)` 改为 `.run(|app_handle, event| { if let tauri::RunEvent::ExitRequested { .. } = event { sync::sync_on_exit(app_handle); } })`
- 在 `invoke_handler` 中注册 5 个新命令

### 步骤 7: tauri-client.ts + client.ts 新增前端函数

**文件**：`d:\comind\comind\src\wasm\tauri-client.ts`

添加类型定义和 6 个调用函数：
- `tauriExportToMarkdown(directory): Promise<ExportResult>`
- `tauriImportFromMarkdown(directory, strategy): Promise<ImportResult>`
- `tauriGetSyncConfig(): Promise<SyncConfig>`
- `tauriSetSyncConfig(enabled, directory, intervalSecs): Promise<void>`
- `tauriSyncNow(): Promise<ExportResult>`（全量同步）
- `tauriTriggerSync(): Promise<ExportResult>`（变更同步，由前端防抖调用）

**文件**：`d:\comind\comind\src\wasm\client.ts`

添加 6 个导出函数（与 `getDbPath/setDbPath` 模式一致，Web 环境抛错或返回默认值）

**前端防抖机制**：
在 `blocks.ts` store 的 `_doSave` 函数末尾，调用 `triggerSyncDebounced()`：
```typescript
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null

function triggerSyncDebounced() {
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer)
  syncDebounceTimer = setTimeout(() => {
    triggerSync().catch(console.error)
  }, 5000)
}
```

这确保了：
- 高频编辑时不会频繁触发同步
- 最后一次编辑后 5 秒自动触发变更同步

### 步骤 8: SettingsModal.vue UI 改动

**文件**：`d:\comind\comind\src\components\Settings\SettingsModal.vue`

- **script setup**：添加同步配置状态、加载/保存函数、导出/导入处理函数
- **template**：替换第 229-242 行的两个禁用按钮区块为：
  1. 自动同步开关（toggle + 同步目录选择 + 立即同步按钮）
  2. 导出为 Markdown 按钮
  3. 从 Markdown 导入（策略下拉框 + 导入按钮）
- **style**：添加 toggle 开关样式和消息显示样式

## 关键文件路径

**新建**：
- `d:\comind\comind\src-tauri\src\markdown.rs` — 序列化/反序列化核心
- `d:\comind\comind\src-tauri\src\sync.rs` — 自动同步管理
- `d:\comind\comind\src-tauri\src\state.rs` — 状态管理（ConfigManager）

**修改**：
- `d:\comind\comind\src-tauri\Cargo.toml` — 添加 regex、log、tokio、simple_logger 依赖
- `d:\comind\comind\src-tauri\src\config.rs` — 扩展 AppConfig（添加 sync_enabled、sync_directory、sync_interval_secs、config_version）
- `d:\comind\comind\src-tauri\src\commands.rs` — 新增 5 个命令 + 修改 save_block_tree/set_property/delete_property/execute_batch 更新 Page updated_at
- `d:\comind\comind\src-tauri\src\main.rs` — 注册模块/命令 + 启动同步 + 关闭回调 + 日志初始化
- `d:\comind\comind\crates\comind-core\src\storage\sqlite.rs` — 添加默认关系类型初始化
- `d:\comind\comind\src\wasm\tauri-client.ts` — 新增调用函数
- `d:\comind\comind\src\wasm\client.ts` — 新增导出函数
- `d:\comind\comind\src\components\Settings\SettingsModal.vue` — UI 改动

**复用**（不修改）：
- `d:\comind\comind\crates\comind-core\src\services\block_service.rs` — `build_tree`
- `d:\comind\comind\crates\comind-core\src\services\page_service.rs` — `get_all/get_by_title/create/update`
- `d:\comind\comind\crates\comind-core\src\services\link_service.rs` — `create/delete_by_source_block_id`
- `d:\comind\comind\src\utils\parser.ts` — Link 解析逻辑参考（移植到 Rust）

## 验证方法

### 编译检查（必须全部通过）
```bash
cd D:\comind\comind\src-tauri && cargo build
cd D:\comind\comind\src-tauri && cargo test
cd D:\comind\comind && npm run build
cd D:\comind\comind && npm run test
```

### Rust 单元测试
- `test_export_import_roundtrip`：创建 Page+Block → 导出 → 清空 → 导入 → 验证数据一致
- `test_sanitize_filename`：非法字符替换
- `test_parse_links_from_content`：`((type))[[target|alias]]` 解析

### 前端功能验证
1. 打开设置 → 数据管理区
2. 验证"自动同步"开关可切换，切换后配置持久化
3. 验证选择同步目录后，"立即同步"按钮可用
4. 验证导出按钮可点击，导出后显示成功消息（页面数、块数）
5. 验证导入策略下拉框可选择（清空后导入/按标题合并）
6. 验证导入按钮可点击，导入后显示成功消息
7. 验证浏览器日志无错误

## 潜在风险

1. **UNIQUE 约束**：`Page::delete` 是软删除，已删除 Page 仍占用 title UNIQUE。replace 策略通过"不创建同名新 Page，而是 upsert"避免冲突。
2. **关闭时同步阻塞**：`sync_on_exit` 同步执行，会短暂阻塞退出。数据量通常不大，可接受。
3. **regex 移植**：Rust `regex` crate 不支持 lookbehind，需用先匹配 `((type))[[...]]` 再匹配 `[[...]]` 并排除已匹配区间的策略（与 TS 版一致）。
4. **配置修改需重启**：`set_sync_config` 修改配置文件后，内存中的 State 不会更新，需重启应用生效。UI 会显示"更改设置后需要重启应用生效"提示。
