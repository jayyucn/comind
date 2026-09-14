# ADR-0047: 块版本历史下架与「删除可恢复」的职责重划

- Status: accepted（2026-09-14 经 grilling 讨论，Jay 逐条确认）
- Date: 2026-09-14
- Supersedes: —
- Related: ADR-0046（撤销历史栈，本 ADR 是它的产品侧配套）、ADR-0042（Ideas 页面物化快照）、ADR-0045（折叠语义）、ADR-0019（写事务边界在 Rust 侧）
- Tracking: issue #104（下架）、issue #105（回收站）

## Context

grilling 期间 Jay 提出的反问（2026-09-14）：

> 从产品角度分析，如果有快照功能，之前的 block 版本历史功能是不是可以舍弃了？

核查结论：**这不是「功能冗余」，而是一栋没盖完的房子** —— 5 个零件里只有 1 个真正接线。

| 零件 | 设计里的意图 | 实际接线状态 | 证据 |
|---|---|---|---|
| 自动快照 | 编辑时自动留点 | **接上了**（每块约 3 分钟一条） | `blocks.ts:515-524` 用 Rust 在同一写事务内预建的 `saveResult.snapshot` 调 `scheduleVersion`；`blockVersion.ts:22-24` 2s debounce + 3 分钟冷却 + hash 去重 |
| 手动存档 | `manual` / `major_op` / `app_exit` 三种来源 | **没接**：`getSourceLabel` 定义了 5 种，实际只会产生 `auto` / `restore` | `BlockVersionPanel.vue:109-118` |
| 版本备注 | 每条版本可带 message | **没接**：`scheduleVersion` 从不传 message；`checkpointName` 前端→wasm→Rust 链路已通但无人传 | `blockVersion.ts:101`；`client.ts:310`、`wasm-client.ts:273` |
| 块上入口 | 块内按钮直达历史 | **没接**：`BlockHistoryButton.vue` 全仓 0 引用（孤儿）；唯一入口是右侧栏面板，而面板绑 `editorStore.activeBlockId` —— 必须先点进那个块 | `App.vue:38-43`（注册 id `block-version`）；`BlockVersionPanel.vue:35,149-151` |
| 保留策略 | 清理 30 天前的版本 | **没接**：`cleanup` 调 `delete_older_than(..., block_id="", cutoff)`，SQL 为 `WHERE block_id = '' AND created_at < ?`，永不命中 → 死代码，版本行只增不减 | `block_version_service.rs:164-175`、`entity/block_version.rs:162-172` |

### 鸡肋的根因不是「活太多」，是「切分方式错了」

它按**时间**切（每 3 分钟一条匿名快照），而用户心里的「版本」按**有意义的时刻**切（「我昨天存的那个终稿」）→ 列表里认不出哪条是哪条。再叠三个结构问题：

1. **入口是孤儿**（块上按钮 0 引用），且面板要求先激活块 —— 用户不知道有这东西。
2. **作用域只有单块**：拖拽 / 缩进 / 删除完全不进它的记录（`build_snapshot` 只取该块自己 + 其属性 + 其链接，`block_version_service.rs:193-208`），而丢数据恰恰多发生在结构操作上 —— **它连原始动机都覆盖不了**。
3. **永不清理**（见上表）。

### 三个「历史」机制的边界（本 ADR 重划）

| 维度 | 撤销栈（ADR-0046 新建） | 块版本历史（本 ADR 下架） | Ideas 页面物化快照（ADR-0042） |
|---|---|---|---|
| 存储 | 内存 | DB `BlockVersion` 表 | DB `page_snapshots` 表 |
| 寿命 | 会话内，重开即清 | 持久 | 持久 |
| 作用域 | 整页（含结构与删除） | 单块（不含结构） | 整页（只读渲染用） |
| 可见性 | 隐形，只有 `Ctrl+Z` | 右侧栏面板 | Ideas 历史页 |
| 使用方式 | 顺序回退 | 跳到某一版并恢复 | 只读回看 |
| 能救「块被删」 | 能（会话内） | **不能**（FK RESTRICT，删块前先删版本行） | — |
| 能救「跨重启后悔」 | 不能 | 能（若块还在） | 只读物化，不可恢复 |

**结论：概念互补，但现有实现承载不了它的概念。**

## Decision

| # | 决策点 | 裁定 |
|---|---|---|
| D1 | **块版本历史的处置** | **下架 UI + 停掉自动生成**：撤掉右侧栏 `block-version` 面板注册、移除 `scheduleVersion` 的调用点；**Rust 侧的 `BlockVersionService` 与表保留**（保留成本≈0，`restore` 的事务语义将来可复用）。**「跨会话回溯」作为需求挂账**，待撤销栈落地后以**显式命名的存档点（Checkpoint）**形状重提 —— 彼时 `checkpointName` 参数链仍在（`client.ts:310`、`wasm-client.ts:273` 已通，只差 UI）。<br>**承接地基已存在**：`SnapshotService::materialize_page`（`snapshot_service.rs:67-94`）已是**通用**整页序列化原语（入参任意 `Page` → `{blocks, properties}`，与 ADR-0046 D11 的信封同形）；只有「挑哪些页」是 Ideas 专用（`snapshot_stale_ideas_pages:33-63`），落表 `page_snapshots` 以 `page_id` 为键。复用它只需三件小事：① 暴露为 public ② 放开「一页一份」约束（`get_by_page_id` 返回 `Option`，说明现为 UNIQUE，而 Checkpoint 需一页多份）③ 给「名字」一个位置（`date` 列本就是 TEXT，可承载）。**全程不动 ADR-0046 一个字。**<br>**与 ADR-0046 D5 互相印证**：下架的不是「一个做得不好的功能」，而是判定「**每步 + 匿名 + 落库**」这个组合不该存在 —— 自动落库必然无限增长，匿名必然要按时间切（见 ADR-0046「机制与寿命的耦合」）。 |
| D2 | **「删除可恢复」独立立项** | 立**回收站**为独立议题（issue #105）。依据：块与块属性的删除**本来就是软删**（只打 `deleted_at`，物理行仍在：`sqlite.rs:535-537`、`entity/property.rs:249-260`）→ 回收站缺的只是「列出软删块 + 复活」原语与入口。**这条复活原语与 ADR-0046 撤销「恢复被删块」所需的是同一条**（一件事修两个洞），且它补的正是撤销栈救不了的洞（「没察觉就关掉 App」）。 |
| D3 | **命名纪律** | 三者不得再共用含糊词：撤销历史一律 **History Stack / 撤销历史栈**（ADR-0046）；持久化的具名存档点用 **Checkpoint**；**Snapshot / 快照**仅指 ADR-0042 的 Ideas 物化快照。 |

**推论**：

- 原始诉求里的「防误操作丢数据」由此**获得归属**：撤销栈管「察觉了并按 `Ctrl+Z`」（分钟级），回收站管「删了没察觉」（跨会话）。二者不再互相代言。
- 下架**不是删代码**：`BlockVersion` 表与 Rust service 不动，避免将来重建时失去 `restore` 的事务语义（块 + 属性 + 链接在同一事务内恢复，`block_version_service.rs:122-148`）。

## Consequences

- 右侧栏少一个面板。**副作用必须一并处理**：`block-version` 目前是 `useRightSidebar.ts` 的**默认面板**（`defaultPanel: 'block-version'`、`panelOrder: ['block-version','graph']`，:21-31），且 `activePanelId` 持久化在 localStorage → **只删注册会导致面板区空白且无 tab 高亮**（`RightSidebar/index.vue:27-28,77`）。下架须同时改默认值，并对「持久化 id 指向已注销面板」做回落。
- `BlockVersionPanel.vue` / `BlockHistoryButton.vue` / `stores/blockVersion.ts` 成为未被引用的实现（保留，不删）。
- 版本历史既有 DB 数据保留（不再新增）；`cleanup` 死代码随自动生成停止而失效 —— 是否修由回收站议题一并决定。
- 回收站一旦落地，「删除」这条路径的语义从「硬删」变为「可恢复」；须与 ADR-0046 的撤销恢复**共用同一条复活原语**，禁止两条路径各自实现。
- **真机确证（2026-09-14）**：`BlockVersion` 表 **7028 行** / 2256 块，`source` 仅 `auto`(7023) + `restore`(5)，`message` **全为 NULL** ⇒ 本文所述「自动在跑、手动存档与备注从未接线」是**观测事实**而非推测，表只增不减的风险已实际发生。

## Open questions（交 grilling / 后续议题，勿直接实施）

| # | 议题 | 说明 |
|---|---|---|
| 1 | 回收站的作用域与保留策略 | 全局一个回收站，还是按页面？保留多久？是否与 `BlockVersion` 那个已失效的保留策略合一？ |
| 2 | 回收站能否恢复「结构上下文」 | 复活块时父块可能已不存在、原位已被占 —— 回落规则未定。 |
| 3 | 「存档点」的正确形状（挂账，非本期） | 若将来重提：是「撤销栈某一步固化成 Checkpoint」，还是「独立于撤销栈的手动存档」？**地基已就位**（见 D1）—— 届时不必新建表或序列化原语，只差触发形状与 UI。 |
