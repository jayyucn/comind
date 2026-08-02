# 任务系统与筛选系统（通用 Block 筛选）设计文档

> **日期**：2026-08-02
> **状态**：已确认，待实施
> **前置条件**：属性系统 `property`（已实现）、日期引用 `date_ref`（已实现）、任务生命周期 `ensureTodo` / `advanceDateRefInBlock`（已实现）
> **关联**：本设计即 `docs/3-features/property-spec.md` §9.2「复杂查询（待实现）」的正式落地

---

## 1. 概述

### 1.1 目标

参考 Notion 的视图系统，在 comind 中构建两层能力：

1. **通用筛选系统（基础层）**：作用于**所有 block** 的筛选引擎。用户可**自定义筛选规则**（任意属性字段 / 内容 / 日期引用 + 多条件组合），并**保存**为命名规则，跨场景复用。
2. **任务系统（消费层）**：一个「全局任务中心」，把带 `status` 属性的 block 聚合起来，以**表格 / 看板 / 日历**三种视图展示，并支持**多个命名视图**（每条 = 一条保存的筛选规则 + 展示方式）。

### 1.2 决策摘要

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 任务系统形态 | 全局任务中心（非页面内视图） | 复用「任务 = 带 status 的 block」模型，聚合成本低、立即出价值 |
| 首版视图 | 表格 + 看板 + 日历 | 覆盖任务的「列表 / 流转 / 时间」三视角 |
| 命名视图 | 支持多命名视图 | 对齐 Notion「同一数据多视图」精髓 |
| 查询主干方案 | 后端投影 + 前端纯函数引擎（方案 A） | 本地优先、离线可用；筛选逻辑集中可单测；未来扩页面内视图只换数据源 |
| 数据投影范围 | 全部 block 的轻量投影 | 通用且支持 `content contains` 式筛选；本地优先下万级 block 无压力 |
| 持久化分层 | `saved_filters`（通用）+ `task_views`（任务视图）两表 | 职责清晰，符合「筛选系统为基础系统」定位 |

### 1.3 非目标（首版不做）

- 页面内数据库视图（Notion inline DB block）——架构已预留（筛选引擎与数据源无关），留作后续
- 筛选条件 OR 分组（首版仅 AND 叠加）
- 看板按 `status` 以外的维度分组（首版看板固定按 `status`）
- Gallery / Timeline / List 视图
- 命名视图跨设备同步（数据写入后端表，但同步接入留待与同步引擎联动的单独阶段）

---

## 2. 架构

```
┌─ 筛选系统（基础层，通用，作用于所有 block）──────────────────────┐
│  数据源: get_blocks_projection() → 全部 block 的 BlockCard 投影    │
│  引擎:   applyQuery(cards, query) 纯函数（筛选 + 排序）            │
│  持久化: saved_filters（自定义 + 可保存的筛选规则）                │
└─────────────────────────────────────────────────────────────────┘
        ▲ 被消费（同一份投影 + 同一引擎）
┌─ 任务中心（消费者，表格 / 看板 / 日历）─────────────────────────┐
│  默认规则: status exists（即「任务」）                            │
│  命名视图: saved filter + viewType + groupBy（存 task_views 表）   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 分层

- **数据层**：Rust core 新增 `get_blocks_projection()`（native + WASM 双绑定），返回 `BlockCard[]`。
- **引擎层**：`src/composables/useTaskQuery.ts` 中的纯函数 `applyQuery`，零 Vue 依赖，可单测。
- **持久化层**：`saved_filters` + `task_views` 两张后端表，前端对应 store。
- **视图层**：`TaskHub` 容器 + `TaskViewBar` / `TaskFilterBar` + `TableView` / `BoardView` / `CalendarView`。

### 2.2 复用的现有能力

| 现有能力 | 位置 | 本设计复用方式 |
|----------|------|----------------|
| 属性系统 | `src/types/property.ts`、`src/stores/property.ts` | `BUILT_IN_PROPERTIES` 提供 `status`/`priority` 枚举与 `closedValues`；`setProperty` 用于行内改状态/优先级 |
| 日期引用 | `crates/.../types/date_ref.rs` + `queryDateRefs` 等 | `BlockCard.date_refs` 承载 deadline/schedule，供日历与日期筛选 |
| 任务生命周期 | `property.ts#ensureTodo` / `advanceDateRefInBlock` | 带 date-ref 的 block 自动成任务；看板拖到 Done 触发周期推进 |
| 核心客户端 | `src/wasm/client.ts` | 新增 `getBlockCards()` / `getSavedFilters()` 等方法沿用同一绑定模式 |
| block 定位 | `useBlockRegistry` / `useBlockTree` | 点任务跳回源 block（实现时核实具体 API） |

---

## 3. 数据层：BlockCard 投影

### 3.1 Rust 类型

```rust
// 轻量日期引用（复用 date_ref 表字段，去重后投影）
struct DateRefLite {
    kind: String,        // "deadline" | "schedule" | ...
    iso: String,
    date_day: String,    // YYYY-MM-DD，用于范围/逾期/分组
    recurrence: String,
    event_ts: i64,       // 预计算事件时间戳（毫秒）
}

// 单个 block 的轻量投影（不搬子树/格式）
struct BlockCard {
    block_id: String,
    page_id: String,
    parent_id: String,
    content_preview: String,              // 去掉 {{schedule:…}}/{{deadline:…}} 标记后的摘要
    properties: HashMap<String, Value>,  // 完整属性映射（含 status/priority/project/area + 用户自定义）
    date_refs: Vec<DateRefLite>,
    updated_at: i64,
}
```

> **一致性说明**：`property-spec.md` 曾把 `deadline`/`scheduled` 列为属性且含 `datetime` 类型，但**当前代码**日期统一走 `DateRef`（内联 `{{deadline:…}}`），`PropertyType` 实际为 `string|number|boolean|date|array|page`。本设计以代码为准：日期经 `date_refs` 字段筛选，属性字段支持任意 `key`（含用户自定义）。

### 3.2 核心方法 `get_blocks_projection()`

- 语义：跨所有页，查出每个 block 的轻量投影。
- 实现（native + WASM）：一次 SQL 组装——`blocks` 全量（或按 `updated_at` 增量，见 §3.3）→ 关联该 block 的全部 `properties` → 关联 `date_refs` → 组装 `BlockCard`。
- 前端：`src/wasm/client.ts` 新增 `getBlockCards(): Promise<BlockCard[]>`（解析 `properties` 的 JSON 值）。
- 不在投影里包含 block 的 `content` 全文 / `children` / `format`，控制内存。

### 3.3 缓存与失效

- 前端 `src/stores/blockCard.ts`（新增）持有 `cards: Ref<BlockCard[]>`，首次打开任务中心/筛选 UI 时加载一次。
- 失效触发：订阅现有 `blockStore` / `propertyStore` / `dateRef` 的写操作（`updateBlockContent` / `setProperty` / date-ref 变更）→ 标记脏，下次进入重拉或增量更新对应 card。
- 首版采用「进入即全量重拉 + 内存缓存」，增量更新留后续优化。

---

## 4. 筛选引擎（纯函数）

### 4.1 类型定义（新增 `src/types/blockQuery.ts`）

```ts
// 可筛选字段：任意属性 key + 内容 + 日期引用维度
type BlockField =
  | { kind: 'property'; key: string }      // 任意属性（status/priority/project/area/自定义）
  | { kind: 'content' }                    // block.content
  | { kind: 'dateRef'; ref: 'kind' | 'date' }  // date_refs 的 kind 或 date_day

type FilterOp = 'is' | 'isNot' | 'before' | 'after' | 'contains' | 'hasAny' | 'isEmpty'

interface FilterCondition {
  field: BlockField
  op: FilterOp
  value: any           // is/isNot/contains 用标量；before/after 用日期；isEmpty 忽略 value
}

interface SortRule { field: BlockField; dir: 'asc' | 'desc' }

type GroupBy = 'status' | 'priority' | 'project' | 'area' | 'dateRefDate' | null

type ViewType = 'table' | 'board' | 'calendar'

// 通用筛选规则（applyQuery 的输入）
interface BlockQuery {
  filters: FilterCondition[]
  sort: SortRule[]
  groupBy: GroupBy
}

// 保存的筛选规则（持久化，对应 saved_filters 表）
interface SavedFilter { id: string; name: string; query: BlockQuery }

// 任务中心命名视图（持久化，对应 task_views 表）
interface TaskView {
  id: string
  name: string
  query: BlockQuery
  viewType: ViewType
  groupBy: GroupBy
  isDefault: boolean
}
```

### 4.2 `applyQuery` 语义

```ts
// 纯函数：输入全部卡片 + 规则，输出筛选 + 排序后的数组
function applyQuery(cards: BlockCard[], q: BlockQuery): BlockCard[]
```

- **筛选**：所有 `filters` 以 **AND** 叠加；每条按 `op` 求值（见 §4.3）。
- **排序**：按 `sort` 规则链式比较（属性按类型比较：number 数值、date/dateRef 时间序、其余字符串序）。
- **分组**：分组不在 `applyQuery` 内做（保持纯筛选+排序），由视图层按需基于 `groupBy` 对结果分组。
- 无 Vue 依赖、无副作用，便于单测。

### 4.3 操作符支持

| Op | 适用字段 | 语义 |
|----|----------|------|
| `is` | property / content / dateRef.kind | 等于（枚举/标量精确匹配；content 视为相等） |
| `isNot` | property / dateRef.kind | 不等于 |
| `contains` | content / property(string) | 子串包含（大小写不敏感） |
| `before` | dateRef.date / property(date) | 早于给定日期 |
| `after` | dateRef.date / property(date) | 晚于给定日期 |
| `hasAny` | property / content / dateRef.kind | 字段有值：property=该属性存在；content=内容非空；dateRef.kind=存在该 kind 的日期引用（如 `hasAny deadline`） |
| `isEmpty` | property / content / dateRef | 该字段无值 |

### 4.4 规则可自定义

- 规则构建器 UI（§5.3）通用：字段下拉 = 内置属性 + 用户自定义属性（从已加载 card 的 properties key 集合推导）+ `content` + `dateRef.kind` / `dateRef.date`；操作符按字段类型动态给出；值输入复用 `closedValues`（枚举）与 `DateTimePickerPanel`（日期）。
- 可叠加多条 `FilterCondition`（AND）。
- 「另存为筛选规则」→ 写入 `saved_filters`，可命名、 reuse 于任意消费者。

---

## 5. 视图层：任务中心

### 5.1 `TaskHub` 容器

- 全局路由/浮层（**不是 outline 里的 page**，避免污染图谱与日记）。
- 挂载：加载 `cards` → 取当前 `TaskView`（默认或上次选择）→ `applyQuery(cards, view.query)` → 按 `view.viewType` 渲染。
- 持有 `currentView` 状态与 `cards` 引用；任何属性/日期变更后重跑 `applyQuery`。

### 5.2 `TaskViewBar`

- 视图切换：`[表格] [看板] [日历]`
- 命名视图切换器（下拉：列出 `task_views`，含默认「全部任务」）
- 操作：`[筛选]`（开/合 `TaskFilterBar`）、`[存为新视图]`、`[设为默认]`、`[重命名]`、`[删除]`

### 5.3 `TaskFilterBar`（规则构建器，通用）

- 构造 `FilterCondition[]`（字段 / 操作符 / 值），多条件 AND 叠加。
- 枚举字段（`status`/`priority`）直接读 `BUILT_IN_PROPERTIES.closedValues`；日期类复用 `DateTimePickerPanel`。
- 「应用」→ 更新当前 `TaskView.query.filters`；「另存为筛选规则」→ `saved_filters`。
- 该构建器与引擎**完全解耦**，未来任何「按条件查 block」的界面可复用。

### 5.4 `TableView`

- 列：`☑完成` / 内容 / 状态 / 优先级 / 项目 / 截止(dateRef) / 页面。
- 表头可排序（写 `SortRule`）。
- 行内改 `status`/`priority` → 复用 `propertyStore.setProperty`（Done 自动触发周期推进）。
- 点行 → 跳回源 block（§7）。

### 5.5 `BoardView`

- 按 `status` 分列（Todo / Doing / Done / Canceled）。
- 卡片可在列间拖拽 → `setProperty(status=目标列)`；完成列自动触发 `advanceDateRefInBlock`。
- 卡片显示：内容摘要 + 优先级 + 截止。

### 5.6 `CalendarView`

- 月格视图；事件按 `date_refs[].date_day` 落格（`deadline` 红 / `schedule` 蓝，沿用现有配色 token）。
- 点事件 → 跳回源 block。
- 首版仅展示，不支持在日历上拖拽改日期（留后续）。

---

## 6. 持久化：保存的筛选规则与命名视图

### 6.1 `saved_filters` 表（通用）

```rust
struct SavedFilterRow {
    id: String,
    name: String,
    query_json: String,   // 序列化的 BlockQuery
    created_at: i64,
    updated_at: i64,
}
```

- Core 方法：`get_saved_filters()` / `save_saved_filter(name, query_json)` / `update_saved_filter(id, ...)` / `delete_saved_filter(id)`。
- 前端 `src/stores/savedFilter.ts`：加载、CRUD、应用。

### 6.2 `task_views` 表（任务中心）

```rust
struct TaskViewRow {
    id: String,
    name: String,
    query_json: String,   // 序列化的 BlockQuery
    view_type: String,    // table | board | calendar
    group_by: String,     // 见 GroupBy
    is_default: i64,      // 0 | 1
    sort_order: i64,
    created_at: i64,
    updated_at: i64,
}
```

- Core 方法：`get_task_views()` / `save_task_view(...)` / `update_task_view(...)` / `delete_task_view(id)` / `set_default_task_view(id)`。
- 默认视图「全部任务」：`query = { filters: [{ field:{kind:'property',key:'status'}, op:'hasAny', value:null }], sort:[], groupBy:null }`，`viewType: 'table'`。

### 6.3 前端 store

- `src/stores/taskView.ts`：当前视图、视图列表、切换、CRUD、应用 `query` 到引擎。

### 6.4 同步考量

- `saved_filters` / `task_views` 为用户数据，语义上应随同步跨设备一致。
- **风险**：当前 `wasm32` 构建被 `SqlJsAdapter` 缺 `notifications` 访问器阻塞（pre-existing）；新增两表必须同时加到 **native `SQLiteAdapter`** 与 **WASM `SqlJsAdapter`**，并在同步引擎的表集合中加入这两表（参考 websocket-sync-engine 设计中的 7 表集合）。
- 首版可先保证单机可用；跨设备同步接入作为与同步引擎联动的单独阶段（见 §13）。

---

## 7. 入口与导航

- **入口**：左侧栏新增「✅ 任务」常驻项 + 命令面板 `> 打开任务中心`（不进 outline，不入图谱）。
- **跳回源 block**：点表格行 / 看板卡 / 日历事件 → 载入所属页（未载则拉取）→ 滚动并高亮原 block（复用现有 block 定位/滚动能力，实现时核实 `useBlockRegistry` / `useBlockTree` 具体 API）。
- **在 hub 内编辑**：勾选完成 → `setProperty(status=Done)` → 自动触发周期推进；改优先级/状态 → `setProperty`，本地卡片即时刷新后重跑 `applyQuery`。

---

## 8. 数据流

```
TaskHub 挂载
  → blockCardStore.load()  → client.getBlockCards()  → BlockCard[]
  → 取 currentView.query
  → applyQuery(cards, query)  → 过滤+排序后的 cards
  → 按 viewType 渲染（table/board/calendar）
改动（status/priority/date）
  → propertyStore/dateRef 写  → blockCardStore 标记脏
  → 重跑 applyQuery  → 视图刷新
```

---

## 9. 错误处理

- `getBlockCards()` 失败 → 任务中心显示空态 + 「重试」按钮，不崩溃。
- 命名视图/`saved_filters` 配置损坏（JSON 解析失败）→ 回退默认视图「全部任务」，并记录告警。
- 跳回源 block 失败（页/块不存在）→ 提示「源已删除」，从当前视图移除该卡片。

---

## 10. 测试策略

| 层 | 对象 | 重点 |
|----|------|------|
| 引擎 | `applyQuery` | 各 `op`（is/isNot/before/after/contains/hasAny/isEmpty）+ 多条件 AND + 多排序；纯函数单测，无 Vue |
| 持久化 | `savedFilter` / `taskView` store | CRUD、默认视图、损坏回退 |
| 组件 | `TableView` / `BoardView` | 渲染筛选集、表头排序、拖拽改 `status`、勾选触发周期推进 |
| 后端 | `get_blocks_projection()` | 返回正确卡片（含 properties + date_refs 投影） |
| 后端 | `saved_filters` / `task_views` | 增删改查 + 序列化往返 |

- **范围外**：现存 57 项历史失败测试不动（既定策略）。

---

## 11. 与现有系统的关系

- **property-spec §9.2**：本文档即其「按属性筛选 / 多条件组合查询（待实现）」的落地，术语对齐（`PropertyFilter` ≈ `FilterCondition`）。
- **date_ref**：日期筛选经 `BlockCard.date_refs`，不依赖 `property` 的 `date` 类型。
- **任务生命周期**：`ensureTodo` 保证带 date-ref 的 block 自动获得 `status`（成为任务）；`advanceDateRefInBlock` 在看板拖到 Done 时推进周期任务——任务中心直接消费这两条既有逻辑，不重复实现。

---

## 12. 实施阶段建议

1. **P1 数据层**：`BlockCard` / `DateRefLite` + `get_blocks_projection()`（native + WASM）+ `blockCard` store + 缓存失效。
2. **P2 引擎**：`blockQuery` 类型 + `applyQuery` 纯函数 + 单测。
3. **P3 持久化**：`saved_filters` / `task_views` 两表（双适配器）+ 对应 store + CRUD。
4. **P4 视图**：`TaskHub` + `TaskViewBar` + `TaskFilterBar` + `TableView` + `BoardView` + `CalendarView`。
5. **P5 入口/导航**：侧栏项 + 命令面板 + 跳回源 block。
6. **P6 测试与打磨**：组件测 + 端到端联调 + 配色/空态/错误态。

> 每个阶段产出可独立验证；P1–P3 可与视图并行由不同单元推进。

---

## 13. 风险与开放问题

| 项 | 说明 | 缓解 |
|----|------|------|
| WASM 适配器 | `wasm32` 构建因 `SqlJsAdapter` 缺访问器被阻塞；新增表须补 `SqlJsAdapter` | 实施 P1/P3 时同步补 `SqlJsAdapter` 访问器，先确保 native 跑通再解 WASM |
| 全量投影性能 | 超大 vault 下 `get_blocks_projection()` 全量拉取 | 首版全量 + 内存缓存；后续可改 `updated_at` 增量 |
| 同步接入 | 命名视图跨设备一致需改同步表集合 | 首版保证单机；同步作为单独阶段联动同步引擎 |
| OR 条件 | 首版仅 AND | 字段模型已支持，后续加 `logic: 'AND'|'OR'` |
| 看板分组维度 | 首版固定 `status` | `GroupBy` 类型已预留其他维度 |
