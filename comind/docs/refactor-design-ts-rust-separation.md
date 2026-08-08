# comind 架构重构设计文档：TS/Rust 严格职责分离

| 字段 | 值 |
|------|----|
| 文档版本 | 0.4 (Draft) |
| 创建日期 | 2026-08-08 |
| 状态 | 待评审 |
| 适用范围 | comind 桌面端（Tauri）及 Android 端；WASM（浏览器）端见第 11 节 |
| 关联项目 | D:\comind\comind |

---

## 1. 背景

comind 是一个 Tauri 2 应用，前端使用 Vue 3 + TypeScript，后端使用 Rust（含独立 crate `comind-core`，位于 `crates/comind-core/`）。前期架构调研确认：业务逻辑当前分散在 TS 层与 Rust 层之间，职责边界模糊。典型现象——

- 通知调度引擎（`checkAndFire`、recurrence 周期推进、通知状态机）实现于 `src/services/notification-service.ts`。
- 内容解析（`parseBlockLinks`、`parseContent`、`parsePropertyValue`）、日期解析（`date-parser`、`date-ref`、`recurrence`）、Block 排序（`block-helpers` 的 Gap 算法）实现于 `src/utils/`。
- 上述逻辑在 TS 层执行后，通过 `executeBatch` / `saveBlockTree` 等命令将数据写回 Rust 层。Rust 层在写入路径中已部分承担派生数据维护职责（如 `DateRefService::sync_date_refs_for_block`、`DateRefService::reschedule_notifications_on_change`），但 Link 同步与 Property 同步仍由 TS 驱动。

这种分布导致三个问题：

1. **规则漂移**：同一业务规则在两端各有一份实现。dateRef 语法已明确以 Rust `DateRefService::extract_date_refs` 为单一事实来源，但 link 解析（`parseBlockLinks`）与 recurrence 推进（`calculateEventTime`）仍由 TS 持有，两端逻辑可能随迭代偏移。
2. **IPC 往返偏多**：实测单次 debounce 保存（300ms）触发 7–10 次 IPC（`saveBlockTree` + `_syncBlockLinks` + `_createBlockVersion` 的 4 次查询 + `syncPayloadForBlock` 的 3–4 次操作）。
3. **职责混杂**：TS 层承担了大量与 UI 无关的计算负载（排序、解析、调度），增加前端 bundle 体积与内存占用。

本重构的目标是将所有业务逻辑（数据处理、业务规则、计算逻辑）收口到 Rust 层（优先 `comind-core`），TS 层收敛为纯 UI 渲染与交互层。数据迁移不在本次范围内；架构合理性与长期可维护性优先于短期开发成本；需建立 TS/Rust 通信接口的类型安全规范；保持现有功能完整性；建立单元与集成测试体系。全部迁移内容一次性完成交付，不做分期。

### 1.1 范围说明

**纳入范围**：
- `src/services/notification-service.ts` 的全部业务逻辑
- `src/utils/parser.ts`、`src/utils/date-parser.ts`、`src/utils/recurrence.ts`、`src/utils/journal-detect.ts`、`src/utils/quiet-hours.ts`、`src/utils/date-ref.ts` 中的解析与判定逻辑
- `src/utils/block-helpers.ts` 中的排序与位置计算逻辑
- `src/stores/blocks.ts` 中 `_syncBlockLinks`、`_createBlockVersion`、`safeCalcInsertPos` 等业务编排
- `src-tauri/src/commands.rs` 中 `save_block_tree`、`execute_batch`、`delete_block` 等写入命令的事务化与统一路径
- 渲染层数据消费改造（新增 `getPageWithBlocks` 接口，TS 渲染路径切换为消费结构化数据）

**排除范围**（需显式标注，避免遗漏）：
- `src/services/migrate.ts`：存量数据迁移脚本（`T15`），属一次性运维工具，非持续业务逻辑。其引用的 `serializeDateRef` 可在迁移完成后改为调用 Rust 命令，但迁移逻辑本身不纳入重构。
- `src/services/serialize-block-tree.ts`：Block 树 ↔ TemplateBlock 树的序列化，服务于模板系统。模板的创建/渲染由 `template-renderer.ts` 与 `TemplateService`（Rust 已有）承担，不迁移 TS 侧的序列化逻辑。
- `src/services/template-renderer.ts`：模板变量展开（`{{date}}`、`{{page_title}}` 等）属 UI 层文本变换，保留 TS。
- `src/config/builtin-templates.ts`：内置模板定义，属数据配置而非业务逻辑，保留 TS。
- `src/config/relationship-types-seed.ts`：内置关系类型种子数据（`is-a`、`part-of`、`depends-on` 等 8 种），属数据配置而非业务逻辑。Rust 侧 `RelationshipTypeService` 已有种子写入能力，但种子内容定义保留 TS（与 UI 展示的 `label`/`color`/`group` 字段紧耦合）。
- WASM（浏览器）端适配，见第 11 节。

---

## 2. 重构原则

1. **单一事实来源**：每条业务规则只在 Rust 层实现一次，TS 层不再持有该规则的副本。
2. **最小 IPC 原则**：一次用户操作触发的 IPC 调用次数应尽量减少；能在一个 Rust 命令内完成的链式操作不拆分为多次命令。
3. **事务原子性**：一个写入命令内涉及的多实体变更（block、dateRef、link、notification、blockVersion）必须要么全部成功、要么全部回滚。
4. **类型安全**：TS 与 Rust 之间的数据结构以共享类型定义约束，避免运行时结构漂移。
5. **功能等价**：重构前后用户可见行为不变；现有测试全部保留并随迁移适配。
6. **可测试性**：Rust 层业务逻辑以纯函数 + 服务层的形式存在，不依赖 Tauri runtime 即可单元测试；TS 层 UI 逻辑以组件 + composable 测试覆盖。

---

## 3. 分层架构目标态

```
┌─────────────────────────────────────────────────────────┐
│  TS 层 (Vue 3)                                          │
│  茌责：UI 渲染、用户交互、本地 UI 状态、乐观更新          │
│  - components/    展示组件                               │
│  - composables/   交互逻辑（含 editingBlockId 等 UI 状态）│
│  - stores/        内存状态管理（reactive 数据缓存）       │
│  - extensions/     ProseMirror 编辑器扩展                 │
│  - wasm/          通信层（CoreClient 接口 + 实现）        │
│  - utils/         仅保留纯展示辅助（HTML 转义、格式化显示）│
│  - config/        数据配置（模板定义、种子数据）          │
│  - services/      仅保留 UI 变换（template-renderer）     │
└───────────────────────────┬─────────────────────────────┘
                            │ CoreClient 接口（类型安全）
┌───────────────────────────┴─────────────────────────────┐
│  Rust 层 (comind + comind-core)                          │
│  职责：全部业务逻辑、数据持久化、派生数据维护、同步        │
│  - comind-core/services/  业务规则与服务编排             │
│  - comind-core/storage/   仓储与事务                     │
│  - comind-core/types/     领域模型                       │
│  - src-tauri/commands.rs  Tauri 命令入口（薄适配层）      │
└─────────────────────────────────────────────────────────┘
```

---

## 4. 职责迁移清单

### 4.1 通知调度引擎（完全迁移至 Rust）

**当前位置**：`src/services/notification-service.ts`

**迁移内容**：
- `checkAndFire` 整体（含 recurring 周期计算、到期判定、通知创建/复用/去重、软删除锚点维护）。
- `calculateEventTime`（recurrence 推进算法，复用 `comind-core` 的 `chrono`）。
- `fireNotification` 状态机（pending → unread → dismissed）。
- `syncPayloadForBlock`（编辑路径事件驱动的通知 payload 同步）。
- `loadNotificationSettingsSync` / `saveNotificationSettings`（设置读写，从 localStorage 迁移至 Rust 内存 + 持久化，见 5.5 节）。

**Rust 侧落地**：
- 新增 `comind-core/services/notification_service.rs`。
- 新增 Tauri 命令 `check_and_fire`、`sync_payload_for_block`、`get_notification_settings`、`save_notification_settings`。
- `BlockService::update` 内部在 `reschedule_notifications_on_change` 之后追加 `NotificationService::sync_payload_for_block` 调用，使编辑路径的通知同步在写入事务内完成，零额外 IPC。

**当前 IPC 链路**：`checkAndFire` 在 TS 侧调用 `batchCheckAndFireData(now)`（1 次 IPC 获取 recurring_refs + due_non_recurring + blocks + pages + notifications），然后在 TS 侧完成计算与判定后，对需创建/更新的通知逐条调用 `updateNotification`（N×M 次 IPC）。

**重构后**：`check_and_fire` 命令在 Rust 内部完成上述全部步骤（查询 + 计算 + 通知写入），`batchCheckAndFireData` 命令的查询逻辑被 `check_and_fire` 内部复用。`batchCheckAndFireData` 命令本身保留（供调试与 WASM 端 fallback），但 TS 侧不再直接调用。

**TS 侧保留**：`useNotificationScheduler`（定时器编排，每 60s 调一次 `client.checkAndFire()`）、`useNotificationStore`（内存通知列表、UI 展示状态）。调度器的"主实例锁"（Web Locks API）属于浏览器环境设施，保留在 TS。

### 4.2 内容解析器（存储路径与渲染路径均迁移至 Rust）

**当前位置**：`src/utils/parser.ts`（`parseBlockLinks`、`parseContent`、`parsePropertyValue`）

**迁移边界决策**：
- **存储路径**：Block 保存时由 Rust 负责从 `block.content` 解析出 links 与 properties，并维护 Link 表与 Property 表。TS 不再调用 `parseBlockLinks` 后自行构造 link 数组传给 Rust。
- **渲染路径**：`useContentRenderer` 不再对 `block.content` 做正则解析生成 HTML。改为接收 Rust 一并返回的结构化数据（links、dateRefs），TS 仅做 HTML 转义与 span 拼装。具体接口设计见第 7 节。

**Rust 侧落地**：
- 新增 `comind-core/services/content_parse_service.rs`（或扩展 `LinkService`），提供 `extract_links_from_content(content) -> Vec<LinkDraft>` 与 `extract_properties_from_content(content) -> Vec<PropertyDraft>`。
- `BlockService::update` / `create` 内部调用上述解析，随后经 `LinkService::sync_links_for_block` 与 `PropertyService` 维护派生数据。Page 查找（link 目标页面匹配）直接在 Rust 内对 Page 表查询，准确性优于当前 TS 依赖内存缓存的方案。
- `parsePropertyValue` 的类型推断（boolean / date / page-reference / number / list / string）在 Rust 侧以 `PropertyValue` 枚举实现。

**已解决的障碍**：`LinkService::sync_links_for_block` 原有 trait bound 为 `S: TransactionalStorageAdapter`，而 `BlockService::update` 的签名为 `storage: &mut dyn StorageAdapter`（非事务型）。方案 B（见 5.1 节决策 4）将 `sync_links_for_block` 签名改为 `&mut dyn StorageAdapter`，不再自行开事务，trait bound 不匹配问题消除。

**TS 侧删除**：`src/utils/parser.ts`、`stores/blocks.ts` 中的 `_syncBlockLinks` 函数、`utils/date-ref.ts` 中的 `parseDateRefs`（渲染用）。

### 4.3 跨 Block 关系类型同步（编排保留 TS，解析下沉 Rust）

**当前位置**：`src/composables/useRelationshipSync.ts`

**业务逻辑**：当用户在一个 block 中设置 `((type))[[target]]` 关系类型后，需将该关系类型同步到同页面内其他 block 中对同一 `target` 的链接上。`editingBlockId` 标记当前正在编辑的 block，同步时跳过（避免覆盖编辑中的内容）。

**迁移决策**：
- **编排逻辑保留 TS**：遍历同页面 block、跳过 `editingBlockId`、决定哪些 block 需要更新——这些逻辑依赖 UI 状态（`editingBlockId`），属交互编排，保留 TS。
- **解析逻辑下沉 Rust**：`parseBlockLinks`（从 content 提取链接与关系类型）与 `applyRelationshipTypeToBlockContent`（对 content 做关系类型的字符串替换/追加/移除）迁移至 Rust。TS 侧通过新增的 Rust 命令 `apply_relationship_sync`（输入：block_id + target_title + relationship_type，输出：更新后的 content）获取结果，再做编排。

**理由**：`applyRelationshipTypeToBlockContent` 的核心是正则替换（`((old))[[target]]` → `((new))[[target]]`），属业务规则；但决定"哪些 block 需要同步"依赖 UI 状态，属交互逻辑。

### 4.4 Block 排序与树操作（内存计算迁移至 Rust 读写路径）

**当前位置**：`src/utils/block-helpers.ts`（`calcInsertPos`、`renumberBlocks`、`isDescendantOf`、`buildDocumentOrder`、`getSortedSiblings` 等）

**迁移决策**：Rust 在读写时保证数据已排序且结构合法，TS 仅消费已排序数据，不再做任何排序或位置计算。

**Rust 侧现状（已具备）**：
- `BlockService::calculate_gap_sort_pos` / `calculate_gap_sort_pos_for_root`：插入位置计算（空列表返回 1000，否则按 gap > 1 取中间值或末尾 +1000）。
- `BlockService::build_tree`：返回 `BlockTree`（含 `block_map`、`root_blocks`、`children_map`，`root_blocks` 与各 `children_map` 子列表均按 `pos` 升序排列）。
- `BlockRepository::get_by_page_id`：查询指定页面的所有 block（需确认 SQL 是否 `ORDER BY pos`，若否则需追加）。

**待补充**：
- `BlockService::reorder`：当前实现为直接设置 `parent_id` 与 `pos` 后 `update`，**无循环引用检测**。需增加 `is_descendant_of` 检查：若目标 `parent_id` 是当前 block 的后代，返回 `Err`，由 TS 捕捉后回滚（见 5.4 节）。
- `getBlocksByPage` 查询返回结果保证按 `pos` 升序（SQL `ORDER BY pos`），TS 不再调用 `sortByPos`。

**TS 侧删除**：`calcInsertPos`、`renumberBlocks`、`isDescendantOf`、`buildDocumentOrder` 及相关的 `safeCalcInsertPos` 包装逻辑。`block-helpers.ts` 仅保留纯展示辅助（如 `pmPosToTextOffset` / `textOffsetToPmPos`，这些是 ProseMirror 光标转换，直接服务于 UI）。

### 4.5 BlockVersion 快照（内联至保存路径，消除 4 次 IPC）

**当前位置**：`stores/blocks.ts` 的 `_createBlockVersion`，每次保存后执行 4 次 IPC（`getBlock` / `getPage` / `getProperties` / `getOutlinks`）组装 `BlockSnapshot`。

**迁移方案**：`save_block_tree` 命令的返回值从 `Vec<Block>` 扩展为 `Vec<BlockSaveResult>`，其中：

```rust
struct BlockSaveResult {
    block: Block,
    snapshot: Option<BlockSnapshot>,  // None 表示无需版本快照
}
```

`snapshot` 由 Rust 在写入事务内利用已在内存中的数据直接组装（block、page、properties、links），零额外 IPC。TS 侧 `_createBlockVersion` 改为直接消费返回值中的 `snapshot`。

**Rust 侧落地**：新增 `BlockService::build_snapshot(block_id) -> BlockSnapshot`，在 `save_block_tree` 事务内对每个保存的 block 调用，随结果一并返回。

### 4.6 日期、期刊检测与静默时段（纯计算迁移至 Rust）

**迁移内容**：
- `utils/date-parser.ts`（`parseDateInput`、`parseDateTimeInput`、`resolveDate`）：相对日期、中文星期、中文时间解析。
- `utils/recurrence.ts`（`calculateNextRecurrence`）：recurrence 推进。
- `utils/journal-detect.ts`（`isJournalTitle`、`normalizeJournalTitle`、`inferPageType`）：8 种日期格式检测与规范化。
- `utils/quiet-hours.ts`（`isQuietHours`）：跨午夜静默时段判定。

**依赖说明**：`isQuietHours` 不是纯函数——它依赖 `NotificationSettings` 中的 `quiet_hours_start` / `quiet_hours_end` 参数。迁移后从 Rust 内存中的通知设置（见 5.5 节）读取参数。因此 `isQuietHours` 迁移依赖通知设置迁移（5.5 节）的完成。

**Rust 侧落地**：上述纯函数迁移至 `comind-core/utils/`（或各 service 内的 `parse` 模块），以纯函数形式实现并附单元测试。TS 侧如渲染需要（如 `formatIsoDisplay` 仅用于展示格式化），保留展示层薄封装，但解析判定逻辑以 Rust 返回的结构化字段为准。

---

## 5. 关键设计决策

### 5.1 写入命令的事务原子性与 trait bound 统一

**现状问题**：

`execute_with_adapter`（`commands.rs:33`）对传入的闭包签名要求为 `FnOnce(&mut dyn StorageAdapter) -> Result<R, Box<dyn Error>>`，即传入的是 `&mut dyn StorageAdapter`（非事务型）。而 `BlockService::update` / `create` / `delete` 的签名也是 `storage: &mut dyn StorageAdapter`。

但 `LinkService::sync_links_for_block` 的签名为 `S: TransactionalStorageAdapter`，要求泛型 `S` 实现 `TransactionalStorageAdapter` trait。这意味着 `BlockService::update` 内部无法直接调用 `LinkService::sync_links_for_block`，因为 `&mut dyn StorageAdapter` 不满足 `TransactionalStorageAdapter` bound。

`comind-core` 中已有 `TransactionalStorageAdapter` trait（`repository.rs:170`）与 `SQLiteAdapter` / `SqlJsAdapter` 的实现（`sqlite.rs:2233` / `sqljs.rs:1332`），以及事务内适配器 `SQLiteTransactionAdapter`（`sqlite.rs:3452`）。

**决策**：

1. **`execute_with_adapter` 区分读写路径**：
   - 读路径：继续使用 `&mut dyn StorageAdapter`（非事务型，避免无谓的事务开销）。
   - 写路径：新增 `execute_with_transaction_adapter`，在命令层开启一个事务，返回处于事务内的 `&mut dyn StorageAdapter` 给闭包。闭包内所有 service 层调用（`BlockService::update`、`LinkService::sync_links_for_block`、`DateRefService::sync_date_refs_for_block` 等）都操作这个已处于事务内的 adapter。

2. **Service 层签名不改动**：`BlockService::create` / `update` / `delete` 与 `LinkService::sync_links_for_block` 统一使用 `&mut dyn StorageAdapter`。事务管理责任上移到命令层（`execute_with_transaction_adapter`），service 层不关心是否在事务内——调用方负责保证。方案 B（决策 4）已将 `sync_links_for_block` 的 `S: TransactionalStorageAdapter` 约束去掉，trait bound 不匹配问题消除。

3. **事务边界**：`save_block_tree`、`delete_block`、`execute_batch` 等写入命令的整个操作体（block 变更 + dateRef 同步 + link 同步 + property 同步 + notification reschedule / sync payload + blockVersion 快照写入）包在一个事务内。任一子步骤失败，整个事务回滚，Rust 命令返回 `Err(String)`，TS 侧据此回滚内存状态（见 5.4 节）。

4. **嵌套事务安全**：采用方案 B —— `LinkService::sync_links_for_block` 签名从 `S: TransactionalStorageAdapter` 改为 `&mut dyn StorageAdapter`，不再自行调用 `storage.transaction()`。由调用方（`BlockService::update` / `create` / `delete`）负责开启一个事务，内部所有子操作（block 写入、dateRef 同步、link 同步、notification reschedule / sync payload、blockVersion 快照写入）都在同一事务内完成。事务边界清晰：一次写入一个事务，无嵌套。

### 5.2 同步通知范围扩展

**现状问题**：`save_block_tree` 成功后仅调用 `record_and_notify(SyncTable::Block, block_ids)`。重构后同一事务内会变更 Link 表（link 同步）与 Notification 表（payload 同步），但这些变更未被纳入同步通知，导致对端设备（如 Android）收不到 link / notification 的增量同步。

`execute_batch` 已有 `sync_changes: HashMap<SyncTable, Vec<String>>` 收集机制（`commands.rs:887`），但 `save_block_tree` 未采用，仅硬编码 `SyncTable::Block`。

**决策**：`save_block_tree` 也采用 `SyncChanges` 收集机制，事务闭包返回 `(Vec<BlockSaveResult>, SyncChanges)`，命令在事务提交后遍历 `SyncChanges` 批量调用 `record_and_notify`。具体扩展：
- block 变更 → `SyncTable::Block`（已有）。
- link 同步产生的增删 → `SyncTable::Link`。
- notification payload 同步产生的变更 → `SyncTable::Notification`。
- property 同步产生的增删 → `SyncTable::Property`。

### 5.3 execute_batch 统一写入路径

**现状问题**：`execute_batch` 中的 block 操作直接调用 repository 层（`storage.blocks().create()` 等），绕过 `BlockService`，因此不触发 dateRef 同步、link 同步、notification reschedule。而 `save_block_tree` 走 `BlockService`，两者行为不一致。经 `execute_batch` 删除的 block 可能遗留 dateRef 与 notification 孤儿记录。

**决策**：`execute_batch` 中的 block / page / link / property 操作改为调用对应 Service 层方法，而非直接操作 repository。Service 层内部维护所有派生数据（dateRef 同步、link 同步、notification reschedule、notification 硬删、blockVersion 清理），保证两条写入路径行为一致。

### 5.4 乐观更新与错误回滚策略

**现状问题**：TS 层当前采用乐观更新——`deleteBlocks` 先从 `blocks.value` 移除（同步触发 UI 重渲染），再 `setTimeout(0)` fire-and-forget 调 `execute_batch`；`createBlock` / `updateBlockContent` 先改内存再 debounce 保存。若 Rust 事务失败，TS 侧无回滚机制，UI 展示与数据库不一致。重构后单次事务涵盖更多实体，失败影响面更大。

**行业实践参照**：
- **Linear**：前端乐观更新，发起请求前保存内存状态快照，请求失败时回滚到快照并弹出错误提示。
- **Logseq**：前端持有 Datascript 内存数据库，所有变更以事务形式提交，事务原子性保证 UI 与内存 DB 始终一致；持久化通过 IPC 发给 Rust 后端，失败时事务整体不生效，UI 自然反映回滚态。
- **Obsidian**：无乐观更新层，直接写本地文件。
- **CRDT 方案（Yjs / Automerge）**：本地操作立即生效且不可失败，冲突由合并算法解决（对照参考，不采用）。
- **Tauri 生态通用模式**：命令返回 `Result<T, String>`，前端 `try/catch`，失败时回滚内存状态。

**决策（Linear 风格：请求前快照 + 失败回滚）**：

1. **单 block 编辑保存失败（`_doSave` 抛错）**：
   - 保持当前乐观更新——不回滚内容，用户刚输入的文字必须保留。
   - 在 `blocks.ts` store 新增 `saveErrors: ReactiveMap<string, boolean>`（blockId → 是否保存失败）。
   - `_doSave` 的 catch 块中 `saveErrors.set(block.id, true)`；成功后 `saveErrors.delete(block.id)`。
   - **UI 交互**：BulletRender 渲染态在 block 文本末尾右侧显示 8×8px 红色圆点，`cursor: pointer`，hover 显示 tooltip "保存失败，点击重试"。点击红点 → 红点变为旋转 loading 图标 → 调用 `blockStore.retrySave(blockId)` 重新执行 `_doSave` → 成功后消失 / 失败后恢复红点。
   - 仅在 block 处于渲染态（非编辑态）时显示红点。编辑态不显示——编辑态还在输入，下次 debounce save 会自动重试。
   - 编辑器仍可继续编辑，不被阻塞。

2. **批量结构性操作失败（`deleteBlocks` / `moveBlock` / `indent` / `outdent` / `reorder`）**：
   - 在发起 RPC 前对受影响的 `blocks.value` 子数组保存深拷贝快照。
   - RPC 失败时：
     - 用快照恢复 `blocks.value`；
     - 触发 `structureVersion` 递增以重建树；
     - 调用 `blockCardStore.invalidate` 清除相关缓存；
     - 弹出 toast **"操作失败，已撤销"**（非阻塞，3 秒自动消失）。
   - 不提供重试按钮——结构性操作失败通常是事务冲突或数据问题，重试不一定成功；用户可重新操作。

3. **Rust 侧保证**：写入命令在事务失败时返回明确错误字符串（含失败实体与原因），TS 侧据此区分"可重试"（如 Gap 耗尽、循环引用）与"不可重试"（如 FK 约束、磁盘错误）错误，分别给出不同提示。

4. **事务原子性是回滚策略的基础**：`save_block_tree` 的事务原子性（5.1）保证 Rust 侧要么全成功要么全回滚，TS 侧快照回滚才能与数据库最终态对齐。若 Rust 侧非原子，TS 侧回滚后数据库仍可能有部分写入，造成新不一致。

### 5.5 通知设置存储迁移

**现状**：`loadNotificationSettingsSync` / `saveNotificationSettings` 读写 `localStorage` 键 `comind-notification-settings`。`notificationStore` 初始化时同步读取，避免铃铛默认 `enabled=true` 的闪现。

**决策**：通知设置独立为 `NotificationConfig`，存 SQLite 表 `notification_config`（单行表，id=1），不混入 AppConfig JSON 文件。

**理由**：
1. **语义不同**：AppConfig 是设备环境配置（workspace 路径、同步网络参数），NotificationSettings 是用户业务偏好（要不要提醒、几点静默），混入 AppConfig 会让其膨胀。
2. **访问模式不同**：AppConfig 启动时一次性加载、运行时几乎不变；NotificationSettings 每次调用 `checkAndFire` 时读内存、设置页面随时改。独立配置 + 内存缓存更清晰。
3. **多设备同步**：AppConfig 是每设备一份（不同设备 workspace 路径不同），不应跨设备同步。NotificationSettings 是用户偏好，应跨设备一致——放数据库可通过 `SyncTable::NotificationConfig`（新增枚举值）传播。
4. **`web_browser_notifications_enabled`** 仅 WASM 端有意义，桌面/Android 端恒 false。独立结构可在 Rust 侧按平台条件处理。

**具体方案**：

```rust
// comind-core/src/types/notification_config.rs
pub struct NotificationConfig {
    pub id: i64,                    // 固定为 1（单行表）
    pub enabled: bool,
    pub schedule_enabled: bool,
    pub deadline_enabled: bool,
    pub overdue_enabled: bool,
    pub quiet_hours_start: Option<String>,  // "22:00"
    pub quiet_hours_end: Option<String>,    // "08:00"
    pub web_browser_notifications_enabled: bool,  // 桌面/Android 端恒 false
}
```

- Rust 进程启动时加载到内存 `Arc<RwLock<NotificationConfig>>`。
- `get_notification_settings` 命令从内存读取（< 0.1ms）。
- `save_notification_settings` 命令写数据库 + 更新内存。
- 新增 `SyncTable::NotificationConfig` 枚举值，支持多设备同步。
- TS 侧在 `App.vue` 初始化时阻塞等待一次 `client.getNotificationSettings()`，写入 `notificationStore` 后再渲染通知相关 UI，消除默认值闪现。

---

## 6. TS/Rust 通信接口规范

### 6.1 接口定义约束

- `CoreClient` 接口（`src/wasm/client.ts`）为 TS 侧唯一对外通信契约。所有方法签名变更需同步更新 Tauri 实现（`tauri-client.ts`）与 WASM 实现（`wasm-client.ts`，WASM 端不在本期范围，新方法在 WASM 端显式标注 `unsupported` 并抛出明确错误）。
- Rust 命令的输入/输出结构体以 `serde` 派生，TS 侧通过 `src/wasm/types.ts` 镜像定义。两端类型以手动确保一致（项目未引入代码生成工具链），关键结构体变更需在 PR 描述中显式列出。
- 错误统一以 `Result<T, String>` 返回，错误字符串为可读中文（面向用户 toast）或英文代码（面向调试），不在错误字符串中拼接敏感数据。

### 6.2 批量接口优先

为遵循最小 IPC 原则，优先设计批量 / 聚合接口：
- `saveBlockTree`：单次调用完成 block 保存 + 全部派生数据同步（dateRef、link、property、notification）+ 快照返回（替代原 7–10 次 IPC）。
- `build_graph_snapshot`：单次 SQL JOIN 返回所有页面边关系（已有，保留）。
- `batchCheckAndFireData`：单次返回 recurring refs + due non-recurring + blocks + pages + notifications（已有，保留；重构后 `check_and_fire` 命令在 Rust 内部直接消费其查询逻辑，TS 不再直接调用）。
- 新增 `getPageWithBlocks(page_id)`：单次返回 page 元信息 + 已排序 blocks + 各 block 的渲染指令（links、dateRefs 的位置与展示信息），供渲染层直接消费，消除渲染路径对 `block.content` 的二次解析。

#### 6.2.1 `getPageWithBlocks` 返回结构定义

```rust
/// 单次 getPageWithBlocks 命令返回的结构
#[derive(Serialize, Deserialize)]
pub struct PageWithBlocks {
    pub page: Page,
    pub blocks: Vec<BlockRenderData>,
}

/// 单个 block 的渲染数据（含原始 content + 渲染指令）
#[derive(Serialize, Deserialize)]
pub struct BlockRenderData {
    pub block: Block,
    pub children: Vec<String>,          // 子 block ID 列表（已按 pos 排序）
    pub render_segments: Vec<RenderSegment>, // content 的分段渲染指令
}

/// content 中一段连续区域的渲染指令
/// TS 侧按 start/end offset 切割 content，对纯文本段做 HTML 转义，对 link/dateRef 段生成对应 span
#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RenderSegment {
    /// 纯文本段（无 link/dateRef 的普通文字）
    #[serde(rename = "text")]
    Text { start: usize, end: usize },

    /// 内部链接段 [[target]] 或 [[target|alias]]
    #[serde(rename = "link")]
    Link {
        start: usize,
        end: usize,
        target_page_title: String,
        display_text: String,
    },

    /// 带关系类型的链接段 ((type))[[target|alias]]
    #[serde(rename = "typed_link")]
    TypedLink {
        start: usize,
        end: usize,
        target_page_title: String,
        display_text: String,
        relationship_type: String,   // 如 "depends-on"
        rel_label: String,           // 如 "依赖于"
        rel_color: String,           // 如 "#3B82F6"
    },

    /// 外部链接段 [[https://...]]
    #[serde(rename = "external_link")]
    ExternalLink {
        start: usize,
        end: usize,
        url: String,
    },

    /// DateRef 段 @2026-08-03 ⏰|daily|30
    #[serde(rename = "date_ref")]
    DateRef {
        start: usize,
        end: usize,
        kind: String,               // "ref" / "schedule" / "deadline"
        iso: String,
        recurrence: String,         // "none" / "daily" / "weekly" / "monthly" / "yearly"
        lead_minutes: i64,
        is_overdue: bool,            // Rust 侧计算（仅 deadline 且已过期）
    },
}
```

**TS 镜像类型**（`src/wasm/types.ts`）：

```typescript
export interface PageWithBlocks {
  page: Page
  blocks: BlockRenderData[]
}

export interface BlockRenderData {
  block: Block
  children: string[]
  renderSegments: RenderSegment[]
}

export type RenderSegment =
  | { type: 'text'; start: number; end: number }
  | { type: 'link'; start: number; end: number; targetPageTitle: string; displayText: string }
  | { type: 'typed_link'; start: number; end: number; targetPageTitle: string; displayText: string; relationshipType: string; relLabel: string; relColor: string }
  | { type: 'external_link'; start: number; end: number; url: string }
  | { type: 'date_ref'; start: number; end: number; kind: string; iso: string; recurrence: string; leadMinutes: number; isOverdue: boolean }
```

**设计要点**：
- `render_segments` 仅对 `bullet` 和 `property` 类型的 block 有意义（这两种类型的 content 含 `[[links]]`、`@dateRef`、`((type))[[links]]` 等内联语法）。对其他 block 类型（`code`、`image`、`embed`），`render_segments` 返回空数组 `[]`，TS 侧组件（CodeMirrorEditor / ImageRender / EmbedRender）直接消费 `block.content` 与 `block.format`，不走 `useContentRenderer`。
- `render_segments` 覆盖 content 的全部区间（无间隙），TS 侧只需遍历段数组、按 start/end 截取原文、对 text 段做 HTML 转义、对其他段生成对应 span HTML 即可。
- 段类型用 `#[serde(tag = "type")]` 标签枚举，TS 侧用 discriminated union 对应。
- `is_overdue` 由 Rust 侧计算（消除 TS 侧 `isOverdue` 函数与 `new Date()` 时区依赖）。
- `rel_label` / `rel_color` 由 Rust 侧从 `RelationshipType` 表查询填入，TS 侧不再调用 `getPredefinedRelationship`。
- `target_page_title` 由 Rust 侧在解析 link 时 JOIN Page 表获得，比 TS 依赖内存缓存更准确。

**TS 侧渲染函数**（重构后）：

```typescript
function renderContentToHtml(segments: RenderSegment[], content: string): string {
  let html = ''
  for (const seg of segments) {
    const raw = content.slice(seg.start, seg.end)
    switch (seg.type) {
      case 'text':
        html += escapeHtml(raw)
        break
      case 'link':
        html += `<span class="block-link" data-page="${escapeAttr(seg.targetPageTitle)}">${escapeHtml(raw)}</span>`
        break
      case 'typed_link':
        html += `<span class="rel-type-label" style="--rel-color:${seg.relColor}">${escapeHtml(seg.relLabel)}</span>`
          + `<span class="block-link" data-page="${escapeAttr(seg.targetPageTitle)}">${escapeHtml(seg.displayText)}</span>`
        break
      case 'external_link':
        html += `<span class="block-link external" data-external="${escapeAttr(seg.url)}">${escapeHtml(seg.url)}</span>`
        break
      case 'date_ref':
        const classes = ['date-ref', seg.kind, seg.isOverdue ? 'overdue' : ''].filter(Boolean).join(' ')
        html += `<span class="${classes}" data-kind="${seg.kind}" data-iso="${escapeAttr(seg.iso)}" ...>${escapeHtml(raw)}</span>`
        break
    }
  }
  return html
}
```

该函数纯展示逻辑，不含任何正则解析或业务判定。

### 6.3 已知技术债：build_graph_snapshot 绕过 service 层

`build_graph_snapshot` 命令（`commands.rs:432`）直接使用 `adapter.conn.prepare(SQL)` 执行原始 SQL JOIN，绕过 service 与 repository 层。这是性能优化手段（单次 JOIN 替代 N×3 次 IPC），功能等价于全量遍历 Link 表 + JOIN Block/Page 表。本期不做重构（读取路径不影响事务原子性），但标记为已知技术债：若未来 schema 变更，需同步更新此处 SQL。

---

## 7. 渲染层数据消费改造

当前 `useContentRenderer` 接收 `string`（纯文本），内部正则解析 links / dateRefs 生成 HTML。重构后改为接收结构化数据（见 6.2.1 节定义的 `RenderSegment` 数组）：

```typescript
interface RenderInput {
  content: string
  segments: RenderSegment[]   // 见 6.2.1 节
}

function renderContentToHtml(input: RenderInput): string
```

`RenderSegment` 由 `getPageWithBlocks` 接口一并返回。TS 侧移除 `utils/date-ref.ts` 的 `parseDateRefs`（渲染用），仅保留 `formatIsoDisplay`（展示格式化，纯 UI）。`useContentRenderer` 不再对 content 做解析，仅按段数组做 HTML 转义与 span 拼装。

此改造与存储路径解析迁移（4.2 节）一并在本次重构中完成。存储路径迁移后，Rust 侧已有 `extract_links_from_content` 与 `extract_date_refs` 的解析能力；`getPageWithBlocks` 在查询时复用这些能力，将结构化数据随 block 一并返回给 TS 渲染层。这样 TS 侧不再保留任何对 `block.content` 的正则解析逻辑，彻底消除双份逻辑风险。

---

## 8. 测试策略

### 8.1 Rust 单元测试（comind-core）

- 每个 service 迁移后附带 `_test.rs`，覆盖：正常路径、边界条件（空内容、非法格式）、事务回滚（故意触发子步骤失败验证回滚）。
- 纯函数（日期解析、recurrence 推进、journal 检测、quiet-hours）以表驱动测试覆盖中英文输入、时区边界、跨午夜区间。
- 通知引擎测试覆盖：recurring 周期推进正确性、notification 状态机（pending → unread → dismissed）、软删除锚点不重建、原地改期（reschedule）仅当 iso 变化。

### 8.2 Rust 集成测试

- `save_block_tree` 事务集成测试：验证一次保存后 block / dateRef / link / notification / blockVersion 全部一致；验证故意构造的 link 同步失败后事务整体回滚。
- `execute_batch` 与 `save_block_tree` 行为一致性测试：经 `execute_batch` 删除 block 后，验证 dateRef 与 notification 孤儿记录已被清理（与 `save_block_tree` 路径一致）。
- `getPageWithBlocks` 集成测试：验证返回的 block 列表已按 pos 升序、各 block 的 links 与 dateRefs 完整且与存储一致。

### 8.3 TS 单元测试

- 现有 `utils/parser.test.ts`、`date-ref.test.ts`、`recurrence.test.ts`、`block-helpers.test.ts`、`notification-service.test.ts` 等：解析类测试在逻辑迁移至 Rust 后，改为对 Rust 命令的集成测试或删除（避免双份）。
- UI 层测试（components、composables）保留并随接口变更适配。
- 新增回滚策略测试：`deleteBlocks` 在 RPC 失败时正确恢复 `blocks.value` 快照；`_doSave` 在 `saveBlockTree` 返回错误时正确标记 block 为失败态。
- 新增渲染层测试：`useContentRenderer` 接收结构化 `RenderInput` 后正确生成 HTML，不再依赖正则解析。

### 8.4 端到端测试

- 高频编辑场景：模拟快速连续输入（每 50ms 一次，共 20 次），验证最终数据库状态与 UI 一致、无孤儿记录、无 IPC 堆积。
- 跨设备同步：桌面端编辑触发 link / notification 变更后，验证 Android 端能收到对应增量同步。

---

## 9. 实施路线图

全部迁移内容一次性完成交付。以下为内部工作顺序（非分期交付，仅为实施时的依赖排序）：

| 步骤 | 内容 | 关键交付 | 风险 | 前置依赖 |
|------|------|----------|------|----------|
| S1 | 基础设施：`execute_with_transaction_adapter`、`LinkService::sync_links_for_block` 签名改为 `&mut dyn StorageAdapter`（方案 B）、`SyncChanges` 收集机制接入 `save_block_tree` | 写路径原子性基座 | 中（影响所有写入路径） | 无 |
| S2 | 通知调度引擎迁移至 Rust（4.1）+ 通知设置迁移（5.5） | `notification_service.rs` + 命令 + 设置存储 + 测试 | 中（recurrence 时区） | S1 |
| S3 | 内容解析器迁移（4.2）：存储路径 + 渲染路径 | `content_parse_service.rs` / `LinkService` 解析 + `BlockService::update` 内联 link 同步 | 中 | S1 |
| S4 | BlockVersion 快照内联（4.5） | `saveBlockTree` 返回 `BlockSaveResult` | 低 | S1, S3 |
| S5 | Block 排序与树操作收口（4.4） | `reorder` 循环检测 + 排序保证 | 低 | S1 |
| S6 | 日期 / 期刊 / recurrence / quiet-hours 迁移（4.6） | `comind-core/utils` 纯函数 + 测试 | 低 | S2（`isQuietHours` 依赖通知设置） |
| S7 | 跨 block 关系类型同步：解析下沉 Rust（4.3） | `apply_relationship_sync` 命令 + 测试 | 中 | S3 |
| S8 | 统一写入路径（5.3）+ 同步通知扩展（5.2） | `execute_batch` 走 Service 层 + `SyncChanges` 全覆盖 | 中 | S1–S3 |
| S9 | 回滚策略落地（5.4） | 快照回滚 + 错误提示 + 重试 UI | 中 | S1, S8 |
| S10 | 渲染层结构化数据改造（第 7 节） | `getPageWithBlocks` + `RenderSegment` 结构 + `useContentRenderer` 改造 | 中 | S3 |

**关键依赖链**：S1 是所有写路径改造的前置；S2 是 S6 中 `isQuietHours` 迁移的前置；S3 是 S4、S7、S8、S10 的前置；S8 是 S9 的前置（回滚策略依赖统一写入路径保证事务原子性）。所有步骤在同一个交付周期内完成。

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| recurrence 推进时区偏差（WASM `chrono::Local` bug） | 通知时间错误 | WASM 端不在本期范围；桌面/Android 使用 `chrono::Local` 已验证；新增 Rust 测试锁定本地 9:00 语义 |
| 事务锁持有时间增长（~1.5ms → ~4–5ms） | 快速切换 block 编辑时排队 | 锁持有远低于 300ms debounce 间隔，实测排队概率 < 1.5%；必要时拆分大事务 |
| 回滚快照内存占用（批量删除大量 block） | 短时内存峰值 | 仅对结构性操作保存受影响子数组快照，非全量 |
| TS/Rust 类型漂移 | 运行时结构不匹配 | 关键结构体变更在 PR 描述显式列出；集成测试覆盖 |
| `execute_with_transaction_adapter` 新增影响所有写入命令 | 写入路径行为变更 | 全量排查写入命令（`save_block_tree`、`delete_block`、`execute_batch` 等），统一切换到 `execute_with_transaction_adapter`，每步完成后运行全量测试 |
| 嵌套事务（`BlockService::update` 内调 `LinkService::sync_links_for_block` 又开事务） | 嵌套事务语义不明确 | 采用方案 B：`sync_links_for_block` 不自行开事务，改为接受 `&mut dyn StorageAdapter`，由调用方统一管理事务边界 |
| 一次性交付工作量大、回归风险高 | 中间状态不稳定导致全量功能不可用 | 按内部依赖顺序（S1→S10）逐步合并到特性分支，每步完成后运行全量测试，确保中间状态可编译可运行；最终一次性合并到主分支 |

---

## 11. WASM（浏览器）端说明

重构范围限定 Tauri 桌面端与 Android 端。WASM 端（`WasmClientAdapter`）当前以下能力受限或缺失：SavedFilter / TaskView / BlockCard 返回空或抛错；blockVersion / notification 走 localStorage；`ensureTodayIdeasPage` 用 `getAllPages` fallback；`chrono::Local` 存在时区 bug（ADR 0001）。

迁移至 Rust 的通知调度引擎、内容解析在 WASM 端的行为需单独评估：
- 若 WASM 端需保留通知能力，需先解决 `chrono::Local` 时区问题或显式使用 UTC + 偏移。
- `useRelationshipSync` 的跨 block 关系同步（依赖 `editingBlockId` UI 状态）保留在 TS 层，其调用的解析逻辑从 Rust 获取（见 4.3 边界决策）。
- 新增的 Rust 命令在 `WasmClientAdapter` 中应显式标注 `unsupported` 并抛出明确错误，避免静默 fallback 导致行为不一致。

WASM 端完整适配列为后续迭代，不在本次交付物内。

---

## 12. 参考

- 项目现有代码调研（architecture audit，2026-08-08）：`crates/comind-core/src/services/`、`src-tauri/src/commands.rs`、`src/stores/blocks.ts`、`src/services/notification-service.ts`、`src/utils/`、`src/composables/useRelationshipSync.ts`。
- `TransactionalStorageAdapter` trait：`crates/comind-core/src/storage/repository.rs:170`。
- `SQLiteAdapter` 事务实现：`crates/comind-core/src/storage/sqlite.rs:2233`。
- `LinkService::sync_links_for_block`（trait bound `TransactionalStorageAdapter`）：`crates/comind-core/src/services/link_service.rs:84`。
- `BlockService::update`（trait bound `StorageAdapter`，含 dateRef 同步 + notification reschedule）：`crates/comind-core/src/services/block_service.rs:83`。
- `execute_with_adapter`（`&mut dyn StorageAdapter`）：`src-tauri/src/commands.rs:33`。
- `save_block_tree`（返回 `Vec<Block>`，仅通知 `SyncTable::Block`）：`src-tauri/src/commands.rs:484`。
- `execute_batch`（已有 `sync_changes: HashMap<SyncTable, Vec<String>>` 收集）：`src-tauri/src/commands.rs:887`。
- `build_graph_snapshot`（直接 SQL JOIN，绕过 service 层）：`src-tauri/src/commands.rs:432`。
- Logseq 架构：前端 Datascript 内存数据库 + 事务原子性 + Rust 持久化。
- Linear 乐观更新模式：请求前快照 + 失败回滚 + 错误提示。
- Tauri 官方命令模式：`#[tauri::command]` 返回 `Result<T, String>`。
- CRDT 方案（Yjs / Automerge）：本地操作不可失败，冲突自动合并（对照参考，不采用）。

---

## 13. 附录：迁移前后 IPC 次数对比

| 操作 | 迁移前 IPC 次数 | 迁移后 IPC 次数 | 变化 |
|------|---------------|---------------|------|
| 单 block debounce 保存 | 7–10（saveBlockTree + _syncBlockLinks + _createBlockVersion×4 + syncPayloadForBlock×3-4） | 1–2（saveBlockTree 含快照返回 + 版本消费） | −70% ~ −80% |
| 批量删除 block | 1（fire-and-forget execute_batch） | 1（事务内完成级联清理） | 持平，但一致性增强 |
| 通知调度（每 60s） | 1（batchCheckAndFireData）+ N×M 写（updateNotification） | 1（check_and_fire 内部完成查询 + 计算 + 写入） | 大幅减少 |
| 页面加载渲染 | 0 次 IPC（内存正则解析） | 1 次 IPC（getPageWithBlocks 一并返回结构化数据） | 消除 TS 侧二次正则解析 |
