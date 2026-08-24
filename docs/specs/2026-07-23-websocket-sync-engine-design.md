# WebSocket 同步引擎设计文档

> **日期**：2026-07-23
> **状态**：已确认，待实施
> **阶段**：Phase 1 MVP — 传输层
> **前置条件**：数据层改造已完成（version/deleted_at/BlockVersion 安全网）

---

## 1. 概述

### 1.1 目标

实现 PC 端（Tauri Desktop）与 Android 端（Tauri Mobile）之间的局域网 WebSocket 直连同步，采用实体级 LWW（Last-Write-Wins）行级合并策略。

### 1.2 决策摘要

| 决策项 | 选择 | 理由 |
|--------|------|------|
| Android 路线 | Tauri 2.0 Mobile | 复用全部 Rust + comind-core 代码 |
| 同步通道 | 局域网 WebSocket 直连 | 无需云服务，低延迟 |
| PC 角色 | WebSocket Server | PC 在线即可，简单直接 |
| Android 角色 | WebSocket Client | 扫码连接 PC |
| 冲突策略 | LWW 行级覆盖（基于 version 字段） | MVP 简单有效 |
| 同步触发 | 实时推送 + 定时全量校验（30 分钟） | 实时性 + 自愈能力 |
| 同步表 | Block, Page, Link, Property, DateRef, RelationshipType, Template（7 表） | 核心数据 + 关系类型 + 模板，BlockVersion 留在 Phase 2 |
| 连接发现 | QR 码传递 ws 地址 + 一次性 token | 简单可靠 |
| 安全级别 | Token 认证（一次性 + 5 分钟过期） | 局域网内足够 |
| 多设备 | MVP 仅支持 1 台 Android 配对 | 简单，多设备转发留 Phase 2 |
| 传输格式 | JSON 行载荷 + 应用层 LWW | 人类可读，调试方便 |

### 1.3 非目标（MVP 不做）

- 云端中转同步
- Patch Sync（只传变更字段）
- 冲突保留副本
- 多数据库同时同步
- 多设备实时转发（PC 中继路由）
- 多数据库同步（用户切换活跃 DB，当前代码仅支持单 DB）
- Domain Event / OpLog / HLC（Phase 3）

---

## 2. 架构

```
PC (Tauri Desktop)                              Android (Tauri Mobile)
┌─────────────────────────────┐                 ┌─────────────────────────────┐
│  Vue UI                     │                 │  Vue UI                     │
│  ↑↓ Tauri Commands          │                 │  ↑↓ Tauri Commands          │
│  ┌─────────────────────┐    │                 │  ┌─────────────────────┐    │
│  │ Main DB Connection  │    │                 │  │ Main DB Connection  │    │
│  │ (std::Mutex, Tauri) │    │                 │  │ (std::Mutex, Tauri) │    │
│  └─────────────────────┘    │                 │  └─────────────────────┘    │
│  ┌─────────────────────┐    │                 │  ┌─────────────────────┐    │
│  │ Sync DB Connection  │    │                 │  │ Sync DB Connection  │    │
│  │ (tokio::Mutex,      │    │                 │  │ (tokio::Mutex,      │    │
│  │  专用连接, WAL)     │    │                 │  │  专用连接, WAL)     │    │
│  │ ↑↓ spawn_blocking   │    │                 │  │ ↑↓ spawn_blocking   │    │
│  │ SyncEngine          │←───WebSocket─────────│  SyncEngine          │    │
│  └─────────────────────┘    │                 │  └─────────────────────┘    │
│  SyncServer (Server)        │                 │  SyncClient (Client)        │
│  QR: ws://ip:port           │                 │  扫码连接                    │
└─────────────────────────────┘                 └─────────────────────────────┘
```

- PC 端在 Tauri 进程内嵌入 WebSocket Server，生命周期跟随应用
- Android 端作为 WebSocket Client，扫码后连接
- SyncEngine 作为 comind-core 的子模块，PC 和 Android 共享同一套 LWW 合并逻辑
- 传输层用 trait 抽象，Server/Client 各自实现

### 2.1 并发模型：专用连接 + tokio::Mutex + spawn_blocking

**核心问题**：`rusqlite::Connection` 是同步阻塞 API，不能跨 `.await` 持有，也不能直接在 tokio async 上下文中调用。现有 `DatabaseConnection` 用 `std::sync::Mutex`，适合 Tauri 命令的同步调用模式，但不适合 async WebSocket handler。

**方案**：SyncServer/SyncClient 启动时开一个**专用 SQLite 连接**，与主应用的 DB 连接独立。两者都开 WAL 模式（已开），WAL 模式下多连接并发读写安全。

```rust
// SyncEngine 持有专用连接，用 tokio::sync::Mutex 保护
pub struct SyncEngine {
    client_id: String,
    db: Arc<tokio::sync::Mutex<SQLiteAdapter>>,
}

impl SyncEngine {
    pub fn new(client_id: String, db_path: &Path) -> Result<Self> {
        let adapter = SQLiteAdapter::open(db_path)?;  // 专用连接
        Ok(Self {
            client_id,
            db: Arc::new(tokio::sync::Mutex::new(adapter)),
        })
    }

    /// 所有 DB 操作通过 spawn_blocking 执行
    pub async fn handle_message(&self, msg: SyncMessage) -> Result<Vec<SyncMessage>> {
        let db = self.db.clone();
        let client_id = self.client_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut adapter = db.blocking_lock();
            // 在这里执行同步的 DB 操作
            sync_handle_message(&adapter, &client_id, msg)
        }).await?
    }

    pub async fn on_local_change(&self, table: SyncTable, rows: Vec<RowPayload>)
        -> Result<Option<SyncMessage>> {
        let db = self.db.clone();
        tokio::task::spawn_blocking(move || {
            let mut adapter = db.blocking_lock();
            sync_on_local_change(&adapter, table, rows)
        }).await?
    }

    pub async fn export_full(&self, table: SyncTable, batch_size: usize)
        -> Result<Vec<SyncMessage>> {
        let db = self.db.clone();
        let client_id = self.client_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut adapter = db.blocking_lock();
            sync_export_full(&adapter, &client_id, table, batch_size)
        }).await?
    }

    pub async fn import_full(&self, table: SyncTable, rows: Vec<RowPayload>)
        -> Result<()> {
        let db = self.db.clone();
        tokio::task::spawn_blocking(move || {
            let mut adapter = db.blocking_lock();
            sync_import_full(&adapter, table, rows)
        }).await?
    }
}
```

**关键设计原则**：
1. **专用连接**：SyncServer 启动时 `SQLiteAdapter::open(db_path)` 开独立连接，不共享主应用的 `DatabaseConnection`。WAL 模式下两个连接可并发读写。
2. **tokio::sync::Mutex**：用 `tokio::sync::Mutex` 而非 `std::sync::Mutex`，因为 `std::sync::Mutex` 不能跨 `.await` 持有，会阻塞 tokio reactor。
3. **spawn_blocking**：所有 rusqlite 操作通过 `tokio::task::spawn_blocking` 在阻塞线程池执行，不阻塞 async runtime。`spawn_blocking` 内部用 `blocking_lock()` 获取 tokio Mutex。
4. **Arc 共享**：`Arc<tokio::sync::Mutex<SQLiteAdapter>>` 允许多个 WS handler task 共享同一连接。同一时刻只有一个 task 能操作 DB（串行化），但 DB 操作通常很快（毫秒级），不会成为瓶颈。
5. **SyncEngine 是 Sync + Send**：因为 `Arc<tokio::sync::Mutex<SQLiteAdapter>>` 是 `Send + Sync`，SyncEngine 可以安全地跨 tokio task 传递。

**为什么不从 `Box<dyn StorageAdapter>` 改为具体类型？**
SyncEngine 在 comind-core 中定义，但 `SQLiteAdapter` 也在 comind-core 中。MVP 阶段两端都用 SQLite，直接持有具体类型最简单。如果未来需要抽象，可以用 `Arc<tokio::sync::Mutex<Box<dyn StorageAdapter + Send>>>`。

---

## 3. SyncMessage 协议

所有 WebSocket 消息都是 JSON 序列化的 `SyncMessage`。

### 3.1 消息定义

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum SyncMessage {
    /// 行变更推送 — 实时推送单行或多行变更
    RowChange {
        table: SyncTable,
        rows: Vec<RowPayload>,
        client_id: String,   // 发送方标识，防回环
    },
    /// 全量同步请求
    FullSyncRequest {
        client_id: String,
        last_sync_at: Option<i64>,  // 有则增量，无则全量
    },
    /// 全量同步响应 — 分批发送
    FullSyncResponse {
        table: SyncTable,
        rows: Vec<RowPayload>,
        batch_index: usize,
        total_batches: usize,
        client_id: String,
    },
    /// 心跳/保活
    PingPong {
        client_id: String,
        timestamp: i64,
    },
    /// 配对认证
    Pairing {
        token: String,
        client_id: String,
        device_name: String,
    },
    /// 配对成功确认
    PairingAck {
        server_client_id: String,
        paired: bool,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RowPayload {
    pub id: String,
    pub data: serde_json::Value,   // 整行 JSON
    pub version: i64,              // 本地计数器，跨设备无全序关系
    pub updated_at: i64,           // 数据行最后修改时间戳（ms），作为 LWW tiebreaker
    pub deleted_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub enum SyncTable {
    Block, Page, Link, Property, DateRef, RelationshipType, Template,
}
```

### 3.2 LWW 合并逻辑

**背景问题**：`version` 是每行本地计数器（`version = version + 1`），跨设备无全序关系。两台设备各自从 v5 递增到 v6 是必然发生的并发场景。仅按 version 比较会导致 version 相同时双向 SKIP → 数据发散。

**解决方案**：RowPayload 携带 `updated_at` 时间戳作为 tiebreaker。LWW 按 `(version, updated_at)` 字典序比较，保证收敛性。

接收方收到 `RowChange` 时：

```
for row in rows:
    existing = SELECT version, updated_at, deleted_at FROM <table> WHERE id = row.id
    if existing is None:
        INSERT row
    elif (row.version, row.updated_at) > (existing.version, existing.updated_at):
        UPDATE row (覆盖)
    elif (row.version, row.updated_at) == (existing.version, existing.updated_at):
        -- 极端情况：同 version + 同 updated_at（极低概率）
        -- 删除优先：任一方有 deleted_at 则取删除
        -- 否则 last-to-arrive wins，保证收敛
        if row.deleted_at is Some OR existing.deleted_at is Some:
            UPDATE row (删除优先)
        else:
            UPDATE row (last-to-arrive wins)
    else:
        skip (本地版本更新或相同，丢弃)
```

**收敛性证明**：
- 两端收到相同的 `(version, updated_at)` 对，比较结果确定且一致
- 不存在 A 覆盖 B 同时 B 覆盖 A 的情况
- 极端同时间戳场景采用 last-to-arrive wins，两端最终一致（可能需要一次额外推送）

**时钟依赖**：LAN + NTP 环境下时钟漂移通常 < 50ms，`updated_at` 作为 tiebreaker 足够可靠。时钟倒退会导致旧写覆盖新写，但不会发散。Phase 3 的 HLC 方案可彻底消除时钟依赖。

---

## 4. SyncEngine 核心模块

### 4.1 模块结构

```
crates/comind-core/src/sync/
├── mod.rs          # 模块入口
├── message.rs      # SyncMessage / RowPayload / SyncTable
├── engine.rs       # SyncEngine: LWW 合并、全量导出/导入
├── state.rs        # SyncState 表操作
└── transport.rs    # WebSocket 传输层抽象（trait）
```

### 4.2 SyncEngine 接口（async，所有 DB 操作通过 spawn_blocking）

```rust
pub struct SyncEngine {
    client_id: String,
    db: Arc<tokio::sync::Mutex<SQLiteAdapter>>,  // 专用连接
}

impl SyncEngine {
    /// 打开专用 SQLite 连接
    pub fn new(client_id: String, db_path: &Path) -> Result<Self>;

    /// 处理收到的 SyncMessage，返回需要回复的消息（async）
    pub async fn handle_message(&self, msg: SyncMessage) -> Result<Vec<SyncMessage>>;

    /// 本地数据变更后，生成推送消息（async）
    pub async fn on_local_change(&self, table: SyncTable, rows: Vec<RowPayload>)
        -> Result<Option<SyncMessage>>;

    /// LWW 合并（内部同步函数，在 spawn_blocking 内调用）
    fn apply_lww_sync(adapter: &mut SQLiteAdapter, table: SyncTable, row: &RowPayload) -> Result<()>;

    /// 全量导出（async）
    pub async fn export_full(&self, table: SyncTable, batch_size: usize)
        -> Result<Vec<SyncMessage>>;

    /// 全量导入 — 缓存批次到内存（async，不写 DB）
    /// 多次调用累积，直到所有批次到齐后由 commit_full_sync() 统一提交
    pub async fn import_full(&self, table: SyncTable, rows: Vec<RowPayload>)
        -> Result<()>;

    /// 全量同步提交 — 所有批次到齐后，单事务 + defer_foreign_keys 写入 DB
    /// 在 batch_index == total_batches - 1 时自动触发
    pub async fn commit_full_sync(&self) -> Result<()>;
}
```

**WS handler 模式**：
```rust
// 每条 WebSocket 消息 spawn 一个 task
let engine = self.engine.clone();  // Arc clone
tokio::spawn(async move {
    let replies = engine.handle_message(msg).await?;
    for reply in replies {
        ws.send(serialize(&reply)).await?;
    }
});
```

**为什么 SyncEngine 用 `&self` 而非 `&mut self`？**
因为 `Arc<tokio::sync::Mutex<SQLiteAdapter>>` 内部可变性 —— 多个 task 可以同时持有 `Arc` clone，通过 Mutex 串行化 DB 访问。SyncEngine 本身不需要 `&mut self`。

### 4.3 SyncState 表

```sql
CREATE TABLE IF NOT EXISTS SyncState (
    client_id        TEXT PRIMARY KEY,
    peer_device_name TEXT,                 -- 对方设备名（PC 端存 Android 名，Android 端存 PC 名）
    last_sync_at     INTEGER NOT NULL DEFAULT 0,
    last_sync_type   TEXT,                -- 'full' | 'incremental'
    paired_at        INTEGER,
    is_paired         INTEGER NOT NULL DEFAULT 0,
    last_seen_at     INTEGER
);
```

### 4.4 传输层抽象

```rust
pub trait SyncTransport {
    fn send(&mut self, msg: &SyncMessage) -> Result<()>;
    fn recv(&mut self) -> Result<Option<SyncMessage>>;
    fn is_connected(&self) -> bool;
}

// PC 端：WebSocket Server
pub struct WebSocketServer { ... }
impl SyncTransport for WebSocketServer { ... }

// Android 端：WebSocket Client
pub struct WebSocketClient { ... }
impl SyncTransport for WebSocketClient { ... }
```

### 4.5 本地变更检测接线（方案 2：Command 层显式钩子）

**背景**：SyncEngine 的 `on_local_change` 接口需要被调用方触发。现有写入路径（Tauri command → adapter.repository.update）完全绕过 SyncEngine。MVP 采用显式钩子方案。

**方案选择**：Command 层显式调用 + 集中 wrapper 函数。每个**写** command 在写完 DB 后，调用 `record_and_notify(table, rows)` 通知 SyncEngine。

**不选其他方案的理由**：
- 方案 1（包装 StorageAdapter）：侵入式，需改 Tauri state 管理，10 个 repository 方法包装量大
- 方案 3（SQLite 触发器）：MVP 增加触发器 + 清理机制复杂度
- 方案 4（轮询 updated_at）：实时性差，全表扫描代价

**集中 wrapper 设计**：

```rust
// src-tauri/src/commands.rs 或独立的 sync_notifier.rs

/// 所有写 command 在写完 DB 后必须调用此函数
pub async fn record_and_notify(
    app: &AppHandle,
    table: SyncTable,
    row_ids: Vec<String>,
) {
    let sync_server = app.state::<SyncServerState>();
    if !sync_server.is_paired() { return; }  // 未配对则跳过

    // 从 DB 读取最新行数据，构造 RowPayload
    let rows = fetch_row_payloads(&sync_server.engine, table, &row_ids).await;

    // 交给 SyncEngine debounce + 推送
    sync_server.engine.record_change(table, rows).await;
}
```

**调用点清单**（commands.rs 中的写 command）：

| Command | 同步表 | 说明 |
|---------|--------|------|
| save_block_tree | Block, Property | 创建/更新 block 及内联属性 |
| delete_block | Block | 软删除 |
| save_page | Page | 创建/更新页面 |
| delete_page | Page | 软删除 |
| create_link / update_link / delete_link | Link | 链接 CRUD |
| set_property / delete_property | Property | 属性 CRUD |
| save_date_ref / delete_date_ref | DateRef | 日期引用 CRUD |
| create_relationship_type / update_relationship_type / delete_relationship_type | RelationshipType | 关系类型 CRUD |
| create_template / update_template / delete_template | Template | 模板 CRUD |

**代码审查约束**：每个写 command 必须调用 `record_and_notify`。新增写 command 时，`record_and_notify` 调用是必须的 code review 检查项。

**Phase 2 优化**：迁移到方案 3（SQLite 触发器 + pending_changes 表），消除遗漏风险。

### 4.6 debounce 粒度

**规则**：per-table-per-row，跨表同 tick flush。

- **per-table-per-row**：每张表维护一个 `HashMap<row_id, RowPayload>`，500ms 窗口内同一 row 的多次变更只保留最新 version + updated_at。
- **跨表变更**：用户编辑 Block A 内容 + 内联属性（触发 Block 表和 Property 表变更）→ 生成 **2 条 RowChange**（各表各一条），但**同一 tick 一起 flush**。
- **同表多 row**：Block A + Block B 合并为 `RowChange(Block, [A, B])` 一条消息。
- **"取最新 version"**：每行独立取最新，不跨行合并 version。

```rust
// SyncEngine 内部 debounce buffer
pub struct DebounceBuffer {
    // per-table-per-row 缓冲
    buffers: HashMap<SyncTable, HashMap<String, RowPayload>>,
    flush_timer: Option<tokio::time::JoinHandle<()>>,
}

impl DebounceBuffer {
    /// 记录变更，500ms 后 flush
    pub fn record(&mut self, table: SyncTable, rows: Vec<RowPayload>);
    /// flush 时：每张表生成一条 RowChange，包含该表所有待推送 row
    pub fn flush(&mut self) -> Vec<SyncMessage>;
}
```

**时序示例**：

```
T0ms:   用户编辑 Block A 内容 → record_and_notify(Block, [A])
T0ms:   内联属性变更 → record_and_notify(Property, [P1])
T50ms:  用户快速编辑 Block B → record_and_notify(Block, [B])
T500ms: flush → 发送 2 条消息：
         RowChange(Block, [A_v6, B_v3], client_id=me)
         RowChange(Property, [P1_v2], client_id=me)
```

---

## 5. PC 端 WebSocket Server + QR 配对

### 5.0 PC 端同步 UI 流程

**入口**：嵌入 `SettingsModal` →「数据管理」tab → 新增「设备同步」区域。不新增独立组件入口。

**首次使用流程**：

```
用户打开设置 → 数据管理
  ↓
看到「设备同步」区域
  - 状态：未配对设备
  - [显示配对二维码] 按钮
  ↓
点击按钮
  - 调用 get_sync_qr 命令
  - 弹出 QR 码弹窗（或内联显示）
  - QR 下方显示：ws 地址、等待状态
  - QR 码 5 分钟过期，过期后显示 [刷新] 按钮
  ↓
Android 扫码 → 配对成功
  - QR 弹窗自动关闭
  - 「设备同步」区域更新为：
    - 已配对设备列表（设备名 + 上次同步时间 + 在线状态）
    - [立即全量同步] 按钮
    - [取消配对] 按钮
  - 后台开始全量同步
  ↓
后续使用
  - 实时同步在后台静默运行，无需用户操作
  - 设置 → 数据管理 → 设备同步 → 管理已配对设备
```

**UI 组件变更**：

```
SettingsModal.vue
  └─ 数据管理 tab
     ├─ 现有：数据库路径
     ├─ 现有：文件同步（markdown 导出）
     └─ 新增：设备同步
        ├─ 未配对：[显示配对二维码] 按钮
        ├─ 配对中：QR 弹窗 + 倒计时
        └─ 已配对：
           ├─ 设备列表（设备名、在线状态、上次同步）
           ├─ [立即全量同步] 按钮
           └─ [取消配对] 按钮

**MVP 多设备限制**：已配对时隐藏「显示配对二维码」按钮，显示提示「取消配对后可配对新设备」。MVP 仅支持 1 台 Android 配对。
```

不需要独立的 `SyncPanel.vue` 组件，直接在 `SettingsModal.vue` 数据管理 tab 内新增区域。

### 5.1 Server 生命周期

- 在 Tauri `setup` 阶段启动
- 默认端口 38721，被占时自动递增
- 配对 token 一次性使用，5 分钟过期
- 随应用关闭而停止

### 5.2 SyncServer 核心接口

```rust
pub struct SyncServer {
    ws_listener: Option<tokio::task::JoinHandle<()>>,
    port: u16,
    pairing_token: String,
    connected_clients: Arc<tokio::sync::Mutex<Option<String>>>,  // MVP: 仅 1 台
    engine: Arc<SyncEngine>,  // 共享 SyncEngine（内部有专用 DB 连接）
}

impl SyncServer {
    /// 启动 Server，开专用 DB 连接
    pub async fn start(db_path: &Path, port: u16) -> Result<Self>;
    pub fn get_qr_payload(&self) -> String;
    pub fn regenerate_token(&mut self);
    pub fn stop(&mut self);
}
```

**关键变更**：`start` 接收 `db_path` 而非 adapter，自己开专用连接。不再有双重锁问题。

### 5.3 QR 码格式

```
comind://pair?ws=192.168.1.100:38721&token=abc123def456...&name=我的工作电脑

`name` = PC 端 config.device_name，用于 Android 端设备列表显示。
```

### 5.4 配对流程

1. PC 启动 → `SyncServer::start()` → 生成 pairing_token
2. PC UI 显示 QR 码（调用 `get_sync_qr` 命令）
3. Android 扫码 → 解析 ws 地址和 token
4. Android 发送 `Pairing { token, client_id, device_name }`
5. PC 验证 token → 存储 SyncState → 回复 `PairingAck`
6. PC 发送 `FullSyncResponse`（7 表分批）
7. Android 回复 `FullSyncRequest { last_sync_at }`
8. 进入实时推送模式

### 5.5 Tauri 命令新增

```rust
#[tauri::command]
fn get_sync_qr(app: AppHandle) -> Result<String, String>;

#[tauri::command]
fn get_paired_devices(app: AppHandle) -> Result<Vec<PairedDevice>, String>;

#[tauri::command]
fn unpair_device(app: AppHandle, client_id: String) -> Result<(), String>;

#[tauri::command]
fn trigger_full_sync(app: AppHandle) -> Result<(), String>;
```

---

## 6. Android 端 WebSocket Client

### 6.1 SyncClient 核心

```rust
pub struct SyncClient {
    ws_stream: Option<WebSocketStream<...>>,
    client_id: String,
    server_url: String,
    pairing_token: String,
    engine: Arc<SyncEngine>,  // 共享 SyncEngine（内部有专用 DB 连接）
    reconnect_backoff: Duration,
}

impl SyncClient {
    /// 从 QR 码初始化，开专用 DB 连接
    pub fn from_qr(qr_payload: &str, db_path: &Path) -> Result<Self>;
    pub async fn connect_and_pair(&mut self) -> Result<()>;
    async fn reconnect(&mut self);
    pub async fn on_local_change(&self, table: SyncTable, rows: Vec<RowPayload>);
}
```

### 6.2 Android UI 流程

1. 首次打开 → 显示扫码入口
2. 系统摄像头扫码（`tauri-plugin-barcode-scanner`）
3. 解析 QR → 初始化 SyncClient → connect_and_pair
4. 配对成功 → 全量同步 → 进入主界面
5. 后台静默运行：实时推送 + 定时全量

### 6.3 断线重连

- 指数退避：1s → 2s → 4s → 8s → 16s → 30s（封顶）
- 重连 3 次失败后停止，等待用户手动重连
- 重连成功后触发**双向全量同步**（见 7.4 节）
- 退避序列：1s → 2s → 4s（第 3 次失败即停止）

---

## 7. 同步时序

### 7.1 首次配对 + 全量同步

**发送顺序无关**（接收端累积后单事务提交），但建议 RelationshipType → Template → Page → Block → Link → Property → DateRef 以便日志可读。

```
Android                             PC
  │                                  │
  │── Pairing {token, id, name}────→│  验证 token
  │                                  │  存 SyncState(is_paired=1)
  │←── PairingAck {server_id}──────│
  │                                  │
  │── FullSyncRequest {None}───────→│
  │                                  │
  │←─ FullSyncResp(RelType, 1/N)────│  分表分批
  │←─ FullSyncResp(Template, 1/N)──│
  │←─ FullSyncResp(Page, 1/N)───────│
  │←─ FullSyncResp(Block, 1/N)──────│
  │←─ FullSyncResp(Link, ...)────────│
  │←─ FullSyncResp(Property, ...)───│
  │←─ FullSyncResp(DateRef, ...)────│
  │                                  │
  │  逐批 import_full（仅缓存）     │
  │  最后一批到齐后：                │
  │    BEGIN TRANSACTION             │
  │    PRAGMA defer_foreign_keys=ON  │
  │    逐表 apply_lww（INSERT/UPDATE）│
  │    COMMIT                        │
  │    （FK 检查延迟到 COMMIT，      │
  │     此时所有行已就位，循环 FK 自洽）│
  │  更新 SyncState.last_sync_at    │
  │                                  │
  │──── PingPong ──────────────────→│  实时模式
  │←─── PingPong ──────────────────│
```

**commit_full_sync 逻辑**：
```rust
fn commit_full_sync(adapter: &mut SQLiteAdapter, buffer: &FullSyncBuffer) -> Result<()> {
    adapter.conn.execute("PRAGMA defer_foreign_keys = ON", [])?;
    // 在事务内逐表逐行 apply_lww
    for (table, rows) in buffer.drain() {
        for row in rows {
            apply_lww_sync(adapter, table, &row)?;
        }
    }
    // COMMIT 时 FK 检查 —— 如果数据自洽则成功，否则回滚
    Ok(())
}
```

**触发时机**：接收端跟踪每张表的 `batch_index / total_batches`，所有表的所有批次到齐后自动调用 `commit_full_sync()`。

### 7.2 实时推送

```
PC 编辑 Block A                     Android 编辑 Block B
  │                                  │
  │── RowChange(Block, [A])────────→│  apply_lww
  │                                  │
  │←── RowChange(Block, [B])─────────│  apply_lww
```

### 7.3 定时全量校验（30 分钟）

**双向**：Android 和 PC 都主动发 `FullSyncRequest{None}`，对方回 `FullSyncResponse`。接收端累积后单事务 + `defer_foreign_keys` 提交（同 7.1）。

```
Android                             PC
  │── FullSyncRequest {None}──────→│  Android 拉取 PC 全量
  │←─ FullSyncResp(...) ───────────│
  │  累积 + commit_full_sync()     │
  │                                  │
  │←── FullSyncRequest {None}──────│  PC 拉取 Android 全量
  │── FullSyncResp(...) ─────────→│
  │                                  │  PC 累积 + commit_full_sync()
```

注：MVP 阶段定时校验走全量重传，Phase 2 优化为增量。

### 7.4 重连后双向全量同步（MVP）

**背景**：原设计重连后只有 Android 单向拉取 PC 的变更，Android 的离线编辑积压无法推送到 PC，导致数据丢失。MVP 采用双向全量重传解决此问题。

```
Android                             PC
  │                                  │
  │── FullSyncRequest {None}───────→│  ① Android 拉取 PC 全量
  │←─ FullSyncResp(...) ────────────│  （7 表分批）
  │  逐批 import_full（缓存）       │
  │  全部到齐后 commit_full_sync()  │
  │    （单事务 + defer_foreign_keys）│
  │                                  │
  │←── FullSyncRequest {None}──────│  ② PC 拉取 Android 全量
  │── FullSyncResp(...) ─────────→│  （7 表分批）
  │                                  │  PC 逐批 import_full（缓存）
  │                                  │  全部到齐后 commit_full_sync()
  │                                  │
  │──── PingPong ──────────────────→│  ③ 实时模式
  │←─── PingPong ──────────────────│
```

**关键设计点**：
1. **双向全量**：重连后双方互发 `FullSyncRequest{None}`，各自回复 `FullSyncResponse`（7 表分批）。
2. **LWW 保证收敛**：全量数据通过 `apply_lww` 逐行合并，`(version, updated_at)` 字典序比较确保最终一致。
3. **`SyncState.last_sync_at` 语义**：MVP 阶段记录「上次双向全量同步完成的时间戳」，用于 UI 显示和日志，**不用于增量过滤**（因为 MVP 走全量）。
4. **Phase 2 优化**：改为增量推送（查 `updated_at > last_sync_at` 的行，用 `RowChange` 推送），届时 `last_sync_at` 才用于增量过滤。

**离线编辑不丢失保证**：

```
场景：Android 离线编辑 Block X → v6, updated_at=T2
        PC 同时有 Block X → v5
重连后：
  ① Android 拉取 PC 全量 → PC 的 X(v5) 到达 Android → LWW: (v5,...) < (v6,T2) → SKIP
  ② PC 拉取 Android 全量 → Android 的 X(v6,T2) 到达 PC → LWW: (v6,T2) > (v5,...) → UPDATE
结果：PC 更新为 v6，Android 保持 v6 ✅ 收敛
```

```
场景：双方离线编辑 Block X
  PC:     X → v6, updated_at=T2, content="PC 内容"
  Android: X → v6, updated_at=T3, content="Android 内容" (T3 > T2)
重连后：
  ① Android 收到 PC 的 X(v6,T2) → LWW: (v6,T2) < (v6,T3) → SKIP
  ② PC 收到 Android 的 X(v6,T3) → LWW: (v6,T3) > (v6,T2) → UPDATE
结果：两端都变为「Android 内容」v6 ✅ 收敛（PC 的编辑被 LWW 覆盖，这是 LWW 的预期行为）
```

---

| 场景 | 处理策略 | 用户可见行为 |
|------|----------|-------------|
| WiFi 断开 | 指数退避重连 | 同步状态变为"断开" |
| PC 端未运行 | 重连 3 次后停止 | 提示"PC 端不可达" |
| 配对 token 过期 | 配对失败 | 提示重新扫码 |
| 全量同步中断 | 已缓存批次丢弃，无半成品状态（未 commit 无副作用），重连后重传 | 进度条暂停 |
| version 冲突 | (version, updated_at) 字典序 LWW 静默覆盖 | 无 |
| 数据库锁竞争 | busy timeout 5s | 同步延迟 |
| 消息反序列化失败 | 记录日志，跳过 | 无 |
| 批量消息过大 | 分批，每批 ≤ 100 行 | 无 |

### 边界场景

**离线编辑冲突**：双方离线编辑同一行 → 重连后互推 RowChange → LWW 比较 (version, updated_at) 字典序 → 高版本+晚时间戳覆盖。version 和 updated_at 都相同则 last-to-arrive wins，保证收敛。

**软删除传播**：PC 删除 Block → RowChange 携带 deleted_at → Android apply_lww → 本地标记软删除 → 查询自动过滤。

**连续变更合并**：本地 debounce 500ms，合并为一条 RowChange（取最新 version）。

**回环检测**：RowChange 携带 client_id，接收方跳过 client_id == self.client_id 的消息。

---

## 9. 文件变更清单

### 新增文件

```
crates/comind-core/src/sync/
├── mod.rs              # 模块入口
├── message.rs          # SyncMessage, RowPayload, SyncTable
├── engine.rs           # SyncEngine: handle_message, apply_lww, export_full, import_full
├── state.rs            # SyncState 表 CRUD
└── transport.rs        # SyncTransport trait

src-tauri/src/
├── sync_server.rs      # PC 端 WebSocket Server + QR 生成
└── sync_client.rs      # Android 端 WebSocket Client（条件编译 android）
```

### 修改文件（UI）

```
src/components/Settings/SettingsModal.vue
  + 数据管理 tab 新增「设备同步」区域
  + 未配对/配对中/已配对三种状态 UI
  + QR 码弹窗组件（可用 qrcode 库前端生成）
```

### 修改文件

```
crates/comind-core/src/lib.rs           + pub mod sync;
crates/comind-core/src/storage/sqlite.rs  + SyncState DDL + 实现
                                         + UserTemplate 表 version + deleted_at 迁移
crates/comind-core/src/storage/sqljs.rs   + SyncState DDL + 实现（低优先级）
                                         + UserTemplate 表 version + deleted_at 迁移
src-tauri/Cargo.toml                    + tokio-tungstenite, qrcode
src-tauri/src/main.rs                   + 启动 SyncServer, 注册命令
src-tauri/src/commands.rs              + get_sync_qr, get_paired_devices, unpair_device, trigger_full_sync
                                        + 每个写 command 加 record_and_notify 调用
src-tauri/src/state.rs                 + 管理 SyncServer 状态
src-tauri/src/config.rs               + client_id, device_name 字段
```

---

## 10. 实现顺序

| 步骤 | 内容 | 验证方式 |
|------|------|----------|
| 1 | sync/message.rs + sync/state.rs + UserTemplate 迁移 | `cargo check` 通过 |
| 2 | sync/engine.rs（async + spawn_blocking + LWW） | 单元测试：LWW 合并、软删除传播 |
| 3 | sync/transport.rs + sync_server.rs（专用连接） | PC 启动 Server，手动 WebSocket 连接测试 |
| 4 | commands.rs 钩子 + SettingsModal.vue 设备同步区域 | PC 显示 QR 码，wscat 连接测试，编辑后推送验证 |
| 5 | sync_client.rs | Android 扫码配对 + 全量同步 |
| 6 | 实时推送 + 定时全量 + 重连双向全量 | 双端编辑实时同步验证 + 离线编辑不丢失 |

---

## 11. 测试策略

| 层级 | 方式 | 内容 |
|------|------|------|
| 单元测试 | Rust `#[test]` | LWW 合并、version 比较、软删除传播、消息序列化 |
| 集成测试 | Rust + 内存 SQLite | 两台 SyncEngine 互发消息，验证数据一致 |
| E2E 测试 | 手动 | QR 配对 → 全量同步 → 双端编辑 → 数据一致 |

### MVP 验收标准

- [ ] PC 端启动后显示 QR 码
- [ ] Android 扫码后配对成功
- [ ] 全量同步：7 张表数据一致
- [ ] 实时同步：PC 编辑 → Android 即时看到
- [ ] 实时同步：Android 编辑 → PC 即时看到
- [ ] 软删除：PC 删除 Block → Android 对应 Block 消失
- [ ] 断线重连：WiFi 断开 → 恢复后自动重连 → 双向全量同步 → 数据一致
- [ ] 离线编辑不丢失：Android 离线编辑 → 重连后 PC 收到离线编辑内容
- [ ] 定时全量校验：30 分钟后自动双向校验，补齐遗漏

---

## 12. 依赖新增

```toml
# src-tauri/Cargo.toml
tokio-tungstenite = "0.24"     # WebSocket 实现
qrcode = "0.14"                # QR 码生成（PC 端）
# tokio 已有，features = ["full"] 已包含 sync + spawn_blocking
# Android 端扫码：tauri-plugin-barcode-scanner
```

---

## 13. 后续阶段（不在 MVP 范围）

- **Phase 2**：多设备实时转发（PC 中继路由 + 消息缓冲）、增量同步、SQLite 触发器 + pending_changes 表（替代显式钩子，消除遗漏风险）、Patch Sync、BlockVersion 跨设备同步、冲突保留副本
- **Phase 3**：Domain Event / OpLog / HLC（混合逻辑时钟，消除 updated_at 的时钟依赖）、云端中转同步
