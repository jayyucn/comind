# WebSocket 同步引擎 - 实施计划（分解与优先级任务列表）

## [x] Task 1: 创建 sync 模块基础结构 + UserTemplate schema 迁移
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 在 `crates/comind-core/src/sync/` 下创建 `mod.rs`、`message.rs`、`state.rs`、`engine.rs`、`transport.rs`
  - 定义 `SyncMessage`、`RowPayload`、`SyncTable` 枚举（含 `updated_at` 字段）
  - 定义 `SyncState` 表 CRUD（`peer_device_name` 替换 `workspace_label`）
  - 为 `UserTemplate` 表添加 `version` + `deleted_at` 字段的 schema 迁移
- **Acceptance Criteria Addressed**: [AC-3]
- **Test Requirements**:
  - `programmatic` TR-1.1: `cargo check` 通过 ✅
  - `programmatic` TR-1.2: 消息序列化/反序列化测试通过
  - `programmatic` TR-1.3: SyncState 表 CRUD 测试通过
- **Notes**: 所有同步表已有 `updated_at` 字段，仅 UserTemplate 需要迁移；DateRef.updated_at 可空，需用 COALESCE 处理

## [x] Task 2: 完善 SyncEngine 核心（LWW + debounce + import_full/commit_full_sync）
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 创建 `sync/engine.rs`，实现 `SyncEngine` 结构体（`Arc<tokio::sync::Mutex<SQLiteAdapter>>`）
  - 实现 `handle_message`、`on_local_change`、`export_full`、`import_full`、`commit_full_sync` 方法（全部 async，内部 spawn_blocking）
  - 实现 LWW 合并逻辑（`(version, updated_at)` 字典序比较）
  - 实现 debounce 缓冲（per-table-per-row）
- **Acceptance Criteria Addressed**: [AC-3, AC-4, AC-5, AC-6, AC-8]
- **Test Requirements**:
  - `programmatic` TR-2.1: LWW 合并单元测试通过（version 不同、version 相同 updated_at 不同、软删除优先）
  - `programmatic` TR-2.2: 两台 SyncEngine 互发消息集成测试通过（数据一致）
  - `programmatic` TR-2.3: export_full / import_full 集成测试通过（含循环 FK）
  - `programmatic` TR-2.4: debounce 合并逻辑测试通过（同表多行合并、跨表分开发送）
- **Notes**: `commit_full_sync` 使用 `PRAGMA defer_foreign_keys = ON` + 单事务；debounce 500ms 窗口

## [x] Task 3: 实现 SyncTransport trait + SyncServer（PC 端）
- **Priority**: high
- **Depends On**: Task 2
- **Description**: 
  - 创建 `sync/transport.rs`，定义 `SyncTransport` trait
  - 创建 `src-tauri/src/sync_server.rs`，实现 WebSocket Server
  - Server 启动时开专用 DB 连接，bind 到特定 LAN 接口
  - 实现 QR 码生成（后端生成 base64 图片）
  - 实现配对流程（token 一次性、5 分钟过期、速率限制）
- **Acceptance Criteria Addressed**: [AC-1, AC-2]
- **Test Requirements**:
  - `programmatic` TR-3.1: `cargo check` 通过
  - `human-judgment` TR-3.2: 手动用 wscat 连接测试（发送 Pairing 消息验证）
  - `programmatic` TR-3.3: QR payload 格式验证（`comind://pair?ws=IP:PORT&token=UUID&name=...`）
  - `human-judgment` TR-3.4: PC 端启动后 Server 监听正确端口
- **Notes**: `connected_clients` 使用 `Option<String>`（MVP 仅 1 台）；token 速率限制：同一 IP 60s 内最多 3 次失败，拉黑 5 分钟

## [x] Task 4: 注册 Tauri 命令 + 配置 client_id/device_name
- **Priority**: high
- **Depends On**: Task 3
- **Description**: 
  - 在 `src-tauri/src/config.rs` 新增 `client_id` + `device_name` 字段
  - 在 `src-tauri/src/commands.rs` 新增 4 个同步命令：`get_sync_qr`、`get_paired_devices`、`unpair_device`、`trigger_full_sync`
  - 在 `src-tauri/src/main.rs` 启动 SyncServer，注册命令
  - 在 `src-tauri/src/state.rs` 管理 SyncServer 状态
- **Acceptance Criteria Addressed**: [AC-1, AC-2]
- **Test Requirements**:
  - `programmatic` TR-4.1: `cargo check` 通过
  - `programmatic` TR-4.2: `get_sync_qr` 命令返回有效 QR base64 图片
  - `human-judgment` TR-4.3: 应用启动后 client_id 生成并存入 config.json
- **Notes**: client_id 在首次启动时生成 UUID v4，存入 config.json；device_name 默认主机名

## [x] Task 5: 实现 SettingsModal.vue 设备同步区域
- **Priority**: medium
- **Depends On**: Task 4
- **Parallel With**: Task 6, Task 7（互不依赖，可并行开发）
- **Description**: 
  - 在 `SettingsModal.vue` 数据管理 tab 新增「设备同步」区域
  - 实现三种状态 UI：未配对、配对中（QR 弹窗 + 倒计时）、已配对（设备列表 + 操作按钮）
  - MVP 多设备限制：已配对时隐藏「显示配对二维码」按钮，显示提示
- **Acceptance Criteria Addressed**: [AC-1, AC-2]
- **Test Requirements**:
  - `programmatic` TR-5.1: `npm run build` 通过
  - `human-judgment` TR-5.2: 未配对状态显示正确（按钮 + 提示）
  - `human-judgment` TR-5.3: 配对中状态显示正确（QR 弹窗 + 倒计时）
  - `human-judgment` TR-5.4: 已配对状态显示正确（设备列表 + 操作按钮）
- **Notes**: QR 码通过 `<img :src="data:image/png;base64,...">` 渲染

## [x] Task 6: 实现本地变更检测钩子（record_and_notify）
- **Priority**: high
- **Depends On**: Task 2, Task 4
- **Parallel With**: Task 5, Task 7（互不依赖，可并行开发）
- **Description**: 
  - 创建集中 wrapper 函数 `record_and_notify`
  - 在 `commands.rs` 的 14 个写 command 中添加 `record_and_notify` 调用
  - 实现 `fetch_row_payloads` 从 DB 读取最新行数据构造 RowPayload
- **Acceptance Criteria Addressed**: [AC-4, AC-5]
- **Test Requirements**:
  - `programmatic` TR-6.1: `cargo check` 通过
  - `programmatic` TR-6.2: 编辑 Block 后成功触发 `record_and_notify`（日志验证）
  - `human-judgment` TR-6.3: wscat 连接后能收到 RowChange 消息
- **Notes**: 写 command 清单：save_block_tree、delete_block、save_page、delete_page、create_link/update_link/delete_link、set_property/delete_property、save_date_ref/delete_date_ref、create_relationship_type/update_relationship_type/delete_relationship_type、create_template/update_template/delete_template

## [ ] Task 7: 实现 SyncClient（Android 端）
- **Priority**: high
- **Depends On**: Task 3
- **Parallel With**: Task 5, Task 6（互不依赖，可并行开发）
- **Description**: 
  - 创建 `src-tauri/src/sync_client.rs`（条件编译 android）
  - 实现 WebSocket Client，从 QR 码初始化
  - 实现连接、配对、全量同步流程
  - 实现断线重连（指数退避 + 双向全量重传）
- **Acceptance Criteria Addressed**: [AC-2, AC-3, AC-7, AC-8]
- **Test Requirements**:
  - `programmatic` TR-7.1: Android 端编译通过（`cargo check`）
  - `human-judgment` TR-7.2: Android 扫码后成功配对
  - `human-judgment` TR-7.3: 配对后全量同步完成（7 表数据一致）
- **Notes**: 重连成功后触发双向全量同步（互发 FullSyncRequest{None}）；连续 3 次失败后停止，等待手动重连

## [ ] Task 8: 实现实时推送 + 定时全量校验
- **Priority**: high
- **Depends On**: Task 6, Task 7
- **Description**: 
  - 实现双向实时推送（PC → Android、Android → PC）
  - 实现 30 分钟定时全量校验（双向）
  - 实现心跳机制（30s ping / 90s timeout）
  - 实现消息大小限制（动态拆分）
- **Acceptance Criteria Addressed**: [AC-4, AC-5, AC-7, AC-9]
- **Test Requirements**:
  - `human-judgment` TR-8.1: PC 编辑 → Android 即时看到（< 500ms）
  - `human-judgment` TR-8.2: Android 编辑 → PC 即时看到（< 500ms）
  - `human-judgment` TR-8.3: 断线重连后双向全量同步成功
  - `programmatic` TR-8.4: 30 分钟定时校验触发（日志验证）
  - `programmatic` TR-8.5: 消息大小超限动态拆分测试通过
- **Notes**: 定时校验走全量重传（MVP），Phase 2 优化为增量

## [x] Task 9: 补充单元测试 + 集成测试
- **Priority**: medium
- **Depends On**: Task 2
- **Description**: 
  - 补充 LWW 合并单元测试（version 比较、软删除传播、同 version 同 updated_at）
  - 补充消息序列化单元测试
  - 补充全量同步集成测试（含循环 FK）
  - 补充离线编辑重连集成测试
- **Acceptance Criteria Addressed**: [AC-3, AC-8]
- **Test Requirements**:
  - `programmatic` TR-9.1: 所有单元测试通过（`cargo test`）
  - `programmatic` TR-9.2: 所有集成测试通过（`cargo test --test`）
- **Notes**: 集成测试使用内存 SQLite

## [ ] Task 10: E2E 验证 + 修复问题
- **Priority**: medium
- **Depends On**: Task 8
- **Description**: 
  - 手动 E2E 验证所有验收标准
  - 修复发现的问题
- **Acceptance Criteria Addressed**: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9]
- **Test Requirements**:
  - `human-judgment` TR-10.1: 所有验收标准验证通过
- **Notes**: E2E 验证清单见 checklist.md
