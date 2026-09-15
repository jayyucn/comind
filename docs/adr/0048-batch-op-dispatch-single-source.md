# ADR-0048: execute_batch 的 op 分派单源下沉 comind-core（batch 模块 + OpEffect）

- Status: accepted（2026-09-15 经 grilling 讨论，Jay 逐条确认）
- Date: 2026-09-15
- Supersedes: —
- Related: ADR-0046（撤销历史栈，撤销恢复是 execute_batch 的最大消费方）、ADR-0019（写事务边界在 Rust 侧）
- Tracking: issue #116（架构评审批次 5，候选 5/6）

## Context

落库链的 `(entity, action)` op 分派表存在**两份**：

- Tauri：`src-tauri/src/commands.rs` `execute_batch`（约 400 行，17 个 arm）
- WASM：`crates/comind-wasm/src/lib.rs` `execute_batch`（约 290 行，21 个 arm）

同构但各自漂移，靠注释互相提醒对齐。**漂移已产生三个真 bug**（2026-09-15 实证）：

| # | 差异点 | Tauri | WASM | 性质 |
|---|---|---|---|---|
| 1 | entity 命名 | `relationship_type` | `relationshipType` | **潜伏 bug**：前端 `wasm/types.ts` 与 `useRelationshipTypes.ts` 实发 snake_case → WASM 路径 relationship ops 落 unknown arm 静默失败 |
| 2 | block delete | 走 `BlockService::delete`（S8：dateRef 清理 + notification 硬删 + link/property 级联） | 手动删 link/property，缺 dateRef/notification 清理 | 语义漂移，S8 单源被绕开 |
| 3 | template create/update | 全量 `UserTemplate` 反序列化 | 逐字段构造 + 合并更新 | **潜伏 bug**：前端只发 `{id, name, category, content}`（rename 只发 `{id, name}`）→ 缺 `created_at/updated_at` 反序列化失败 → 整批回滚 → 前端 try/catch 静默吞掉 → **桌面端 template 创建/重命名实际不可用** |

架构定性：分派表是 shallow module——接口（17~21 个 arm 的 match）与实现（每个 arm 3~10 行参数解析 + 服务调用）几乎一样复杂，且同一份知识写了两遍。真正的 bug 全藏在两份的**漂移**里。

## Decision

| # | 决策点 | 裁定 |
|---|---|---|
| D1 | 下沉形态 | `crates/comind-core/src/services/batch.rs` 新模块：`apply_batch(storage, ops) -> Result<Vec<OpEffect>>`。两个 adapter 的 `execute_batch` 各剩薄调用。分派语义单源，core 可直接单测 |
| D2 | op 面 | 两份的**并集**：block get/create/update/delete/undelete、page get/create/update/delete、link create/delete/sync_by_block、property create/set/update/delete、relationship_type create/update/delete、template get/create/update/delete。消灭「单侧 op」类目 |
| D3 | entity 命名 | 统一 **snake_case**（前端契约即如此）；`relationshipType` 匹配废弃 |
| D4 | 逐 arm 择优（按调用方真实契约裁定） | ① block delete 统一走 `BlockService::delete`（WASM 补齐 dateRef/notification 清理）；② block undelete 统一结构化返回 `{success, revived}`（旧 WASM 返回值里的 `page_id` 移入 `OpEffect.page_ids`，语义等价）；③ unknown op 统一 Ok 容错（返回 `{"error": ...}`，不失败、不回滚）；④ template create 字段解析（id 空则 generate_id）、update 走 `Service::update` 合并语义（前端发增量）——修复上表 bug #3；⑤ relationship_type create/update 保留全量反序列化 + repo 直写（前端种子同步发完整行，合并语义会静默丢 type/inverse/deleted 变更） |
| D5 | 循环与容错 | 循环、unknown op 容错在 core 的 `apply_batch`；**事务设施不动**——Tauri `execute_with_transaction_adapter` / WASM `adapter.transaction` 照旧包裹，任一 op 失败整批回滚（ADR-0046 约束3 语义不变） |
| D6 | Tauri 特有副作用 | `OpEffect { value, sync: Vec<(SyncTable, String)>, page_ids }` 中性返回。`SyncTable` 本就是 core 的 ungated 纯数据类型（types/sync_table.rs，注释明说 wasm build 也能报告 sync 变化），故直接类型化。Tauri 层事务内消费 page_ids 做 page touch（保持原语义随批回滚）、提交成功后聚合 sync 做 `record_and_notify`；WASM 忽略这两个字段 |

## Consequences

- 新增 op 只改 `batch.rs` 一处；两条路径自动获得同语义。
- core 单测（`batch_test.rs`）逐 op 钉住裁定：roundtrip、级联删除、undelete no-op、property set upsert 复活、relationship_type snake_case 回归钉、template 增量契约回归钉、unknown 容错、整批回滚。
- 前端零改动（`BatchOperation` 类型与 entity 字符串不变；前端不读取 batch 结果值）。
- 行为修正会立即在原「静默失败」的路径上生效：WASM relationship ops、桌面端 template 创建/重命名——这些路径从此真正写库。

## 非目标

- 不动 sync 机制本身（SyncTable / 同步协议留在 Tauri 层消费）。
- 不重设计 op 信封格式（JSON entity/action/params 形状不变）。
- property-codec（架构评审候选 6）另行处理。
