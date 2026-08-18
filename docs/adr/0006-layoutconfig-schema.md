# 0006: LayoutConfig Schema (View 渲染配置)

**Status:** accepted
**Supersedes / extends:** ADR-0005 (View / ViewQuery 模型重定义)
**Scope:** Task Hub 试点；其余 Screen 暂沿用现有本地布局状态

## Context

ADR-0005 将 `View.config` 定为"每 kind 渲染元数据"的承载字段（挂在 `View` 上，与无头的 `ViewQuery` 分离）。但当时未敲定 `config` 的具体类型形态与字段集。

落地前先摸清现有三个视图组件的**实际**布局消费（避免凭空设计）：

- `TableView.vue`：列（check / content / status / priority / project / deadline / page）顺序与宽度**硬编码在 CSS**，无用户可配项。
- `BoardView.vue`：`COLUMNS` 写死 4 个 status 列，分组恒为 `status`（ADR-0015 重构约定"看板恒按 status"）——**当前零可配布局**；新模型说"看板分组列复用 `ViewQuery.groupBy`"，实现尚未接。
- `CalendarView.vue`：直接读 `card.date_refs`（kind = `deadline` / `schedule`）落格，**不读属性字段**。

结论：现状几乎零持久化布局配置。故 `LayoutConfig` 应是"最小但类型安全、面向未来"的 schema，而非照抄现有硬编码。

## Decision

`LayoutConfig` 为**判别联合**，以 `viewKind` 作为判别字段；每个成员自带 `version: 1` 以支持独立迁移；存放在 `src/core/view/types.ts`（与 `core/query` 平级，明确不属于查询引擎）。

```ts
export type ViewKind = 'table' | 'board' | 'calendar'

export interface TableColumnConfig { key: string; width?: number }
export interface TableConfig    { viewKind: 'table';    version: 1; columns: TableColumnConfig[] }
export interface BoardConfig     { viewKind: 'board';    version: 1 }   // 分组列复用 ViewQuery.groupBy
export interface CalendarConfig  { viewKind: 'calendar'; version: 1; dateRefKind: 'deadline' | 'schedule' }

export type LayoutConfig = TableConfig | BoardConfig | CalendarConfig
export type ConfigOf<K extends ViewKind> = Extract<LayoutConfig, { viewKind: K }>
```

字段集刻意保持最小：
- **table**：`columns`（`{key, width?}[]`，顺序即数组序；width 缺省走组件默认）。
- **board**：空（分组列由 `ViewQuery.groupBy` 提供，不在 config 重复存储）。
- **calendar**：`dateRefKind`（`deadline` | `schedule`，默认 `deadline`），与卡片 `date_refs` 数据模型一致。

## Considered Options

### 形态：判别联合 vs 单一松散对象
- **A. 判别联合（选定）**：类型安全；config 可独立序列化/迁移；store 加载时校验 `config.viewKind === view.viewKind`。符合项目严格 TS 风格。
- **B. 单一松散 `ViewConfig`**（`tableColumns?` / `dateRefKind?` 可选字段混排）：实现简单，但无类型保护，未来加字段易出错、难约束"哪种视图能用哪些字段"。

### 日历日期源：date_refs kind vs 属性字段
- **A. `dateRefKind`（选定）**：用 `date_refs` 的 kind 落格，与现有卡片数据模型一致，无需额外映射层。
- **B. 属性字段 `dateField: string`**（CONTEXT.md 原写的 `calendarDateField`）：需卡片有对应 date 属性，与现有 `date_refs` 数据不一致，要另建映射，过度设计。

### 范围：仅定义 schema vs 一并重接线视图
- **仅定义 schema（选定）**：本任务交付类型与文档；视图组件接 `LayoutConfig` 属实现工作，与"定义 schema"解耦，留给后续（ADR-0005 待办 ② 迁移 / 视图接线）。
- **一并重接**：范围蔓延，违反简约优先。

## Consequences

- 新增 `src/core/view/{types.ts,index.ts}`，与 `core/query` 同构（不污染查询引擎）。
- `TaskViewRust.config`（JSON 字符串）现在有了对应的强类型契约；迁移脚本（ADR-0005 待办 ②）须按此 schema 生成/校验。
- 各视图组件后续可从 `LayoutConfig` 读取列序/宽度/日历 kind，替代当前硬编码；board 仍需先接 `ViewQuery.groupBy` 方能用 config 之外的分组。
- `View Config` 术语表条目据此细化（判别联合 + `dateRefKind` + `version`）。
- 未做：未写迁移脚本、未改动 `TaskViewRust`（均属 ADR-0005 待办 ②，本环境未提交）。

### 后续落地（TableView 已接 TableConfig）

`TableView.vue` 现已成为第一个消费 `LayoutConfig` 的视图：`config?: TableConfig` prop，
`columns = config?.columns ?? DEFAULT_TABLE_CONFIG.columns`（`DEFAULT_TABLE_CONFIG` 同样定义在
`src/core/view/types.ts`，即迁移前硬编码的 7 列，确保布局零变更）。表头/单元格按 `columns` 顺序
`v-for` 渲染；列宽来自 `col.width`（缺省走 `COLUMN_META.defaultWidth`，content 不固定宽）。
`TaskHub.vue` 经 `tableConfig` computed 向 `<TableView :config>` 传 `DEFAULT_TABLE_CONFIG`
（table 视图时），作为持久化 config 接入前的 seam——待 ADR-0005 待办 ② 为 `TaskViewRust` 加
`config` 列后，仅需改该 computed 为 `parseTableConfig(currentView.config)`，组件无需改动。
现有 22 个 TableView 测试全部通过（回归验证）。
