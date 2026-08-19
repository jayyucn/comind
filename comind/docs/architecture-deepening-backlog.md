# 架构深化候选登记（Deepening Backlog）

> 来源：`/improve-codebase-architecture` 评审（2026-08-18，8 个深化候选）。
> 评审热点取自近 3 个月提交频率。候选 6、候选 1 已由本会话完成（见下）。
> 本文档是**登记册**：逐条记录候选的事实与开放决策点，便于后续逐个 `/grilling` 落地。

## 状态总览

| # | 标题 | 评级 | 状态 | 依赖 |
|---|------|------|------|------|
| 1 | Collapse the triple-written Repository implementations | Strong | ✅ **已完成** | 地基（2/4 依赖它，已解锁） |
| 2 | Move write-path orchestration behind the Service seam | Strong | 🟡 **已 grill（待 /implement）** | 依赖 1 ✅ |
| 3 | Collapse the six-layer frontend IPC chain | Strong | 🔲 待启动 | 无（前端） |
| 4 | Converge the WASM adapter with the Tauri adapter | Worth exploring | 🔲 待启动 | 依赖 2 |
| 5 | Extract App.vue's nine cross-cutting responsibilities | Worth exploring | 🟡 **已 grill（待 /implement）** | 无（前端） |
| 6 | One event table for Editor's 14 DOM events | Worth exploring | ✅ **已完成** | — |
| 7 | Deduplicate the query-UI value editors and screen wiring | Worth exploring | 🔲 待启动 | 半依赖 6 |
| 8 | Close the generic-views leverage gap | Speculative | 🔲 待启动（最低优先级） | 半依赖 7 |

**候选 6 已完成**：`refactor-editor-event-table` 分支（commit `ed4020c`，13 文件，+1127/−339）。
决策与理由见 `docs/adr/0016-editor-dom-event-transport.md`，方案见 `docs/refactor-editor-event-table.md`。
两个 follow-up（换传输层、2 个模板外单监听器 `delete-between-property` / `slash-command-trigger`）已在 ADR-0016 列为独立后续，不计入本登记册的 7 项。

**候选 1 已完成**：`refactor-repository-convergence` 分支（13 个实体迁移提交 + Q3a 删除 `SQLiteTransactionAdapter`，commit `4ef5c2a`；`sqlite.rs` 4,643 → 1,589 行，净删重复 ≈2,000 行）。
决策与理由见 `docs/adr/0018-repository-convergence.md`（含 13 个实体逐条 Landing record + Q3a 段落）。
验收门：native `cargo check -p comind-core --tests` 0 warnings、wasm `cargo check --target wasm32-unknown-unknown -p comind-core`、`cargo test --lib` = 137 passed / 4 个预存无关失败不变（零新增失败）。
收敛 PR 仍未合入 main，累积这些提交待一次性 review。

## 推荐推进序（来自评审 Top recommendation）

> **候选 1 已完成**（ADR-0018，2026-08-19）：deletion test 兑现——≈2,000 行纯复制删除、列序 drift 结构性消除；候选 2 与候选 4 的地基已就绪。
> **候选 2 已 grill**（ADR-0019，2026-08-19）：写路径编排收进 `BlockWriteService` 的 14 项决策已定，待 /implement。

- **地基链**：1 ✅ → 2 🟡（已 grill，待 /implement）→ 4（4 显式依赖 2 落地先行）
- **前端独立链**：3（IPC 链）、5（App.vue 拆分）可并行，互不阻塞
- **查询/视图链**：7（值编辑器 + chip-bar 合一，半依赖 6 已铺垫）→ 8（通用视图 leverage，speculative，优先级最低）

---

## 候选 1 · Collapse the triple-written Repository implementations

- **评级**：Strong · in-process
- **状态**：✅ **已完成（2026-08-19）**——见 ADR-0018 与本页顶部完成记录。
- **涉及文件**（落地后）
  - `crates/comind-core/src/storage/sqlite.rs`（1,589 行：`SQLiteAdapter` + `TxContext<'a>`；`SQLiteTransactionAdapter` 已删除）
  - `crates/comind-core/src/storage/sqljs.rs`（1,264 行，SELECT 列清单已由共享模块派生）
  - `crates/comind-core/src/storage/executor.rs`（57 行：`Executor` trait，`Connection` / `Transaction` 双实现）
  - `crates/comind-core/src/storage/entity/`（13 个 `<entity>.rs` 共享模块 + `mod.rs`）
  - `crates/comind-core/src/storage/repository.rs`（188 行，13 个子 trait / 约 103 个方法，未变）
- **Problem**：同一份 repository 逻辑写三遍；`sqljs` 的列顺序已与 `sqlite` 不一致，是现成的 bug 温床。
- **Solution**：每实体的 SQL / 列序 / row mapping 收敛为一个定义模块，三个实现共享；事务 adapter 退化为 executor 差异。
- **Wins**（已兑现）：删除约 2,000 行纯复制；列序 drift 在类型上不可能；locality：改一处即改全部。
- **依赖**：无（地基）。候选 2、4 依赖它。
- **✅ 开放决策已定（ADR-0018）**
  1. `SQLiteTransactionAdapter` 是否真只差 executor？→ **是**（Q3/Q9）：引入 `Executor` trait，事务路径改由 `TxContext<'a>` 调**同一批**共享自由函数（`&self.conn` 分别取 `&Transaction` / `&Connection`）；`transaction()` 负责 BEGIN/COMMIT，闭包出错经 `Transaction` 析构自动 ROLLBACK。Q3a（commit `4ef5c2a`）已删除该 struct。
  2. `sqljs` 列序 drift 的具体 bug 实例？→ **Q4b 结构性消除**：`COLS` 为列名+列序唯一来源，两引擎 SELECT/INSERT 列清单都从它派生，`row_to_*_js` 按 `COLS` 顺序按名读取，与 native 按位读取同构。DateRef/Block/Page/Link/Property/RelationshipType/Template/BlockVersion/Notification/SavedFilter/ScreenView 各有实测 drift 记录（见 ADR-0018）；Search（FTS 计算行）与 NotificationConfig（单行表）drift N/A。
  3. 定义模块粒度：每实体一份 vs 全局一份？→ **每实体一份**（Q2，`entity/<entity>.rs`），保持 locality 与小 diff。

---

## 候选 2 · Move write-path orchestration behind the Service seam

- **评级**：Strong · in-process
- **状态**：✅ **已 grill（2026-08-19）**——共识见 `docs/adr/0019-block-write-orchestration.md`。
- **涉及文件**
  - `src-tauri/src/commands.rs`（`save_block_tree` L573–673；`delete_block` L675–736；**44 处**绕过 Service 直调仓储；事务包装仅 4 个调用点）
  - `crates/comind-wasm/src/lib.rs`（`save_block_tree` L116–172 逐行复制，且静默丢弃 snapshot）
- **Problem**：block 保存编排（快照、segments、sync 收集、通知）住在 IPC 模块里，被复制进 WASM 模块，两份已实际 drift。
- **Solution**：编排收进 `comind-core` 的一个深模块；两个 IPC 入口退化为薄 adapter；事务边界随编排走，不再只有 4 个命令有事务。
- **Wins**：snapshot 不再被 WASM 静默丢弃；新增保存副作用改一处；interface 即测试面——直接测编排。
- **依赖**：候选 1 ✅（SQL 定义已收敛，地基就绪，可启动）。
- **grill 共识速览**（决策细节见 ADR-0019，Q1–Q19 共 14 项）
  - home：新深模块 `BlockWriteService`（`services/block_write.rs`），save/delete 编排同址（Q1/Q9=A）；不扩展 `BlockService`（会成上帝服务）。
  - 范围：**只收编写路径三命令**（save_block_tree / delete_block / delete_page_cascade）；其余 ~30 处直调登记 follow-up（Q2=A）。
  - wasm：走**同一编排**（Q3=A）——快照/segments/touch 对齐（行为变更仅限 wasm），sync/通知 no-op 注入；wasm 事务保持 no-op 透传（Q7=A，BEGIN/COMMIT 列为 follow-up）。
  - 事务：编排**自管事务**（`adapter.transaction(...)`，Q4=A）；通知边界 = 编排返回 `HashMap<SyncTable, Vec<String>>`（SyncTable 已在 core），命令层 spawn（Q6=A）。
  - 快照：**不自动落库**、统一构建真实快照（Q5=A）——修复 wasm 侧 `BlockVersionStore.scheduleVersion()` 输入残缺。
  - 删除：`delete_block_cascade` + `delete_page_cascade` 两公开函数共享单 block 删除骨架（Q8/Q14=A）。
  - 输入：命令层解析 JSON → 编排接收 `Vec<Block>`（Q11=A）；编排调 Service（Q12=A），补两个薄转发（`NotificationService::get_by_block_id`、`BlockVersionService::delete_by_block_id`）。
  - 容错：快照/分段失败保持 `unwrap_or_default()`（Q19=A）。
  - 测试：save + delete 编排 in-memory 全链路测试，**含事务回滚用例**（Q10=A）。
- **✅ 开放决策已定（ADR-0019）**：backlog 原 3 问（副作用随编排走 / wasm 事务语义 / service home）均已收敛。
- **🔸 待 /implement / 开放 follow-up**
  1. 剩余 ~30 处直调仓储收编（查询、通知写入）。
  2. wasm `TransactionalStorageAdapter` 接入真实 sql.js `BEGIN/COMMIT`。
  3. 快照自动落库（独立产品决策）。
  4. `execute_batch` / `save_page` 编排（当前薄，暂不动）。

---

## 候选 3 · Collapse the six-layer frontend IPC chain

- **评级**：Strong · ports & adapters
- **涉及文件**
  - `src/wasm/client.ts`（`CoreClient` interface 66 方法 L42–133；`TauriClient` class L135–410 纯转发）
  - `src/wasm/tauri-client.ts`（544 行：103 个 `tauri*` 函数、98 次 `invoke`）
- **Problem**：新增一个命令要改 5 个文件；`TauriClient` class 与 `tauri*` 函数是逐方法直通，interface 与 implementation 一样宽。
- **Solution**：`Tauri` adapter 直接实现 `CoreClient`（每个方法体即一次 `invoke`）；删除 class 转发层与 103 个 `tauri*` 函数。
- **Wins**：删除约 800 行直通代码；新命令只碰 2 个模块；leverage：66 方法一处实现。
- **依赖**：无（前端）。与候选 2/4 共享「adapter 即 seam」理念。
- **🔸 待 grill / 开放决策**
  1. `CoreClient` 是否应同时服务 WASM adapter（与候选 4 合并考量）？
  2. 66 方法是否真需全保留（是否有已死的桥接方法可顺手删）？

---

## 候选 4 · Converge the WASM adapter with the Tauri adapter

- **评级**：Worth exploring · ports & adapters
- **涉及文件**
  - `src/wasm/client.ts`（`WASM adapter` L411–767：约 20 个 stub；`ensureTodayIdeasPage` L524–538 用 TS 重实现 Rust 幂等逻辑；`getOutlinks` L554–560 用 `as any` 运行时探测）
  - `src/wasm/web-version-storage.ts` · `src/wasm/web-notification-storage.ts`（IndexedDB 平行实现，Rust 侧已有对应 Repository）
- **Problem**：两个 adapter 不仅机制不同，行为也不同：stub、`as any` 探测、以及 Rust 已有之物的 IndexedDB 平行实现。
- **Solution**：`BlockVersion` / `Notification` 的 WASM 路径改走 `comind-core` repository（sqljs 实现）；删除 TS 重实现。
- **Wins**：幂等逻辑只剩一份；删除时区 bug 现场；seam 变诚实——adapter 只差传输。
- **依赖**：候选 1 ✅ 已完成；候选 2（Service seam）先行。
- **🔸 待 grill / 开放决策**
  1. WASM 路径是否需要离线 IndexedDB（网络缺失场景）？
  2. `ensureTodayIdeasPage` 幂等逻辑能否在 sqljs 层复用？
  3. web 版通知存储是否要一并迁？

---

## 候选 5 · Extract App.vue's nine cross-cutting responsibilities

- **评级**：Worth exploring · in-process
- **涉及文件**
  - `src/App.vue`（544 行 · 9 类职责 · 全仓最热前端文件 49 次提交 · 无测试）
- **9 类职责**：窗口控制 L134–165 · 全局快捷键 L102–119 · 自实现导航历史栈 L210–294 · 回收站恢复对话框 · BlockSelector 编排 · 右侧面板注册 · graph 预取 · sync toast watch · date-ref 面板挂载
- **Problem**：每个横切功能都往根模块加；导航历史是手卷栈，全仓最热却零测试。
- **Solution**：导航历史抽成独立模块并配测试；窗口控制、快捷键、面板注册各归其位。
- **Wins**：导航历史首次可测；locality：热点分散退热；根模块 interface 收窄。
- **依赖**：无（前端）。
- **状态**：✅ **已 grill（2026-08-18）**——共识见 `docs/adr/0017-app-composition-extraction.md`，方案见 `docs/refactor-app-composition.md`。
- **grill 共识速览**（决策细节见 ADR-0017）
  - 范围：**一次性大 PR 全抽**（Q1=B）；新模块落 `src/app/`（Q2=B）；每模块隔离单测、App.vue 无挂载测试（Q3=A）。
  - 边界：`src/app/` = 应用级编排（只服务 App 根装配）；`src/composables/` = 跨 feature 通用（Q4=A）。
  - 7 个抽出模块：`useNavigationHistory`（自维护栈+自注册回收回调，只暴露 `canGoBack/canGoForward/goBack/goForward`）、`useWindowControls`（窗口+连接一体，Q10=B）、`useGlobalHotkeys({onToggleSearch})`（Q9=A）、`useTrashedPageRestore`、`useGraphSidebarToggle`、`useEmbedSelector`、`useSyncPeerToast`（Q15=A）。
  - 导航历史：**保留** `window.history.go(±1)` 耦合（Q6=A）、**不持久化**内存态（Q8=A）。
  - 3 项保留不抽：graph 预取直调、`handleMainClick` 胶水、两处 `registerPanel`。
  - **不**合并 7 模块为单文件（Q14 子问否定）。
- **🔸 待 /implement / 开放 follow-up**
  1. `useWindowControls` 是否拆出 `useTauriConnection`（若评审挑战「窗口+连接一体」）。
  2. `onRemovePageFromHistory` 单槽→多槽（若第二个消费者出现）。
  3. graph 预取 / `handleMainClick` / `registerPanel` 进一步收口（未来单独评估）。

---

## 候选 7 · Deduplicate the query-UI value editors and screen wiring

- **评级**：Worth exploring · in-process
- **涉及文件**
  - `src/components/query/ChipValueEditor.vue`（252 行）↔ `ValueEditor.vue`（541 行）：类型分派 / `NO_VALUE_OPS` / `isRangeOp` / `DatePicker` 接线全部重复
  - `PagesLibrary.vue` L36–51 ↔ `TaskHub.vue` L117–125：chip-bar 编排近乎逐行相同，另有约 25 行相同模板
  - `useBlockQueryEngine.ts` ↔ `usePageQueryEngine.ts`：各约 45 行，仅类型名不同
- **Problem**：三对近平行模块；ADR-0009/0010 的 leverage 被逐屏复制的编排代码稀释。
- **Solution**：值编辑器合一（literal / 引用为 prop 分派）；chip-bar 编排抽为一个 composable；引擎桥接合一。
- **Wins**：删除三对平行模块；新 Screen 接入成本趋零；deletion test 通过——复杂度消失而非平移。
- **依赖**：候选 6（ValueEditor 解耦，`crossRecordSources` 注入点已在 ADR-0008 固定）已部分铺垫；ADR-0008/0009/0010 已定义 leverage。
- **🔸 待 grill / 开放决策**
  1. `ValueEditor` 与 `ChipValueEditor` 的语义差异是否仅 literal/引用（确认 prop 分派无遗漏）？
  2. 合一后 `crossRecordSources` 注入点是否改动（ADR-0008 已固定，需验证）？

---

## 候选 8 · Close the generic-views leverage gap

- **评级**：Speculative · in-process
- **涉及文件**
  - `src/components/views/{Table,Board,Calendar}View.vue`（通用视图，但仅 1 个消费方：TaskHub；`idOf`/`fieldOf`/`resolveOptions` 三份重复；`BoardView` L71–73 / `CalendarView` L31–33 硬编码 `'content'`）
  - `src/components/PagesLibrary/PageTableView.vue`（261 行）+ `PageCalendarView.vue`（258 行）—— 页面专用平行视图
  - `GraphPage.vue`（226）+ `FilterPanel.vue`（693）+ `graphSelectors.ts`（196）—— 平行筛选体系，零 `core/query` 使用
- **Problem**：ADR 目标是「实体无关、一处实现多处复用」，实际通用视图目前只为 1 个实体服务，另有两套平行体系在系统之外。
- **Solution**：把 `'content'` 回退与 `dateRefKind` 语义收进 `FieldDescriptor` 元数据；PagesLibrary 迁上通用视图（删除 519 行）；评估 GraphView 筛选接入 `core/query`。
- **Wins**：leverage：一处实现三处复用；删除约 1,600 行平行体系；一个筛选心智模型。
- **依赖**：候选 7（`FieldDescriptor` / 值编辑器合一）的部分基础；ADR-0008 缺口重开。
- **🔸 待 grill / 开放决策**
  1. 是否现在做（speculative，优先级最低）？
  2. GraphView 筛选接入 `core/query` 的 ROI 如何？
  3. PagesLibrary 迁通用视图的 regression 风险如何控制？

---

## 术语表（本登记册复用）

- **深模块（deep module）**：小接口、大行为背后的模块；对外窄、对内深，是 leverage 的来源。
- **deletion test**：删掉某层/某模块后，复杂度直接消失（而非平移到别处）即证明它是纯复制——是「该不该抽」的判别法。
- **seam（接缝）**：模块间唯一允许相互依赖的窄接口；adapter 即 seam。
- **leverage（杠杆）**：一处实现被多处复用的收益；若该实现被逐处复制，则 leverage 被稀释。
- **drift（漂移）**：同一逻辑的多个副本随时间不一致（如列序、行为），是现成 bug 温床。
- **ports & adapters（端口与适配器）**：内层定义 port（接口），外层 adapter 只差传输机制；adapter 不应携带行为差异。

---

## 下一步

登记册就绪后，逐个候选走 `/grilling` 决策树 → 产出该候选的 ADR + 重构方案文档（参照候选 1 的 `0018-repository-convergence.md`、候选 6 的 `0016-editor-dom-event-transport.md` + `refactor-editor-event-table.md`）。
- **候选 1 已完成**；**候选 2 已 grill（ADR-0019）**，待 `/implement`（下一步）。
- 前端独立链：候选 3 可并行；候选 5 已 grill，可直接 `/implement`（方案见 `docs/refactor-app-composition.md`）。
- 查询/视图链：候选 7（半依赖 6 已铺垫）→ 候选 8（speculative，最低优先级）。
