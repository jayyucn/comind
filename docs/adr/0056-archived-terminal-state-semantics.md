# ADR-0056: Archived 终态语义 —— 统计不参与 · 与 Canceled 的边界 · 环外取回

> **状态：accepted（2026-10-11）**。grilling 评审定案；统计口径已随本次变更落地。

## Context

status 封闭值扩至五态（`Todo / Doing / Done / Canceled / Archived`，seed + Rust 侧先行）时，Archived 的**聚合口径**未同步定义，产生三个实际语义冲突：

| 冲突点 | 表现 |
|---|---|
| 子任务进度条 | 归档任务计入 total 且非 done → 归档拉低进度条 |
| 父任务自动同步（useParentTaskStatusSync） | 只豁免 Canceled → 归档父被强改回 Doing/Done；归档子把 Done 父拉回 Doing |
| 状态入口 | UI 曾无任何途径写入 Archived（FIELD_UI 覆盖层漏列），补齐后入口语义需一并定义 |

## Decision

**D1 —— 统计不参与（与 Canceled 同待遇）**：Archived 不计 progress 的 total 也不计 done；父任务同步豁免 Archived（归档父不被改写、归档子不计入有效子任务）。

- 否决「算已完成」：归档不是完成语义，且归档一个半途任务会虚增进度；
- 否决「混合口径」（进度不参与、父同步仍改写）：与「存放态」自相矛盾——归档的目的是移出活跃视野，同步却持续触碰它。

**D2 —— 与 Canceled 的语义边界**：两者同为**非参与终态**，共享「不参与统计」口径，但含义相反——Canceled = **否定任务**（明确放弃，红色弱化）；Archived = **收纳注意力**（移出活跃视野但不否定）。术语定义见 CONTEXT.md（Task Status / Canceled / Archived 词条）。

**D3 —— 环外取回**：status 图标点击循环只含参与态（`Todo → Doing → Done`），环外终态（Canceled / Archived）点击回 Todo——归档是存放态，点击即取回；归档动作本身走长按菜单，不进单击循环。

## Consequences

- 四象限落格资格（QuadrantView `qualifies`）无需改动：只认 Todo/Doing/Done，Archived 天然不落格；
- `ensureTodo` 防呆不受影响（仅在无 status 时补值，不触碰已有 Archived）；
- 查询注册表 sortOrder 已含 Archived（沉底），与 D1 口径一致。
