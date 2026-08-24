# ADR-0031: TableView 字段管理面板（per-tab 显示/隐藏 + 全局增/删）

- Status: accepted
- Date: 2026-08-22
- Supersedes: —
- Related: ADR-0005 (View/ViewQuery 模型), ADR-0006 (LayoutConfig schema), ADR-0027 (TableView 与 Task 解耦), ADR-0029 (Screen→Tab 两级 NamedView), ADR-0030 (TableView Custom Cell Renderer)

## Context

`TableView.vue`（`src/components/views/TableView.vue`，`generic="T"`）是实体无关的字段驱动表，按 `config.columns`（每个 Tab 持久化的 `TableConfig`）渲染列，列数据来自字段池 `props.fields: FieldDescriptor[]`。组件零业务耦合（ADR-0027）。

现状缺口：表格渲染哪些列、列序，完全由注入的 `config.columns` 决定，但**没有任何 UI 让用户在表格内调整**。本 ADR 为表格补上「字段管理」能力。

两条已经敲定的边界（grill 第 1–3 轮确认）：

1. **范围 = A（展示管理，非 schema 管理）**：只管理「哪些已注册字段显示为列」，不新建/修改实体真实字段（自定义属性系统，ADR-0002 `PropertyDefinition` / `applyCustomPropertyDiff` 那一套不在此触碰）。这是对 Airtable/Notion 「Fields」面板的对齐。
2. **「展示管理」分两层作用域**，正好映射面板里的两类操作：
   - **显示/隐藏开关 → 仅当前 Tab 生效**（改当前 Tab 的 `TableConfig.columns` 成员，不动全局在用集）；
   - **增/删字段 → 全局生效**（视觉层面、在传入的 `props.fields` 里增删，作用于所有 Tab 的 `TableConfig.columns`，不新建自定义属性、不碰字段底层数据）。

触发入口：用户指定放在 `QueryToolbar.vue` 最右侧的「字段」按钮。

`QueryToolbar.vue` 是通用展示壳（filter/sort/group 三按钮 + 搜索，全部 `emit` 事件上透传、不持有业务），故「字段」按钮同样只 `emit('fields')`，面板由消费方（`QueryToolbar` 的上层，即持有 `config` 的那层）持有并渲染——延续现有解耦契约。

## Decision

### 触发入口

`QueryToolbar.vue` 最右侧新增「字段」按钮，点击 `emit('fields')`。消费方监听该事件并打开一个 `BasePopover`（`src/components/common/BasePopover.vue`）浮层，内部渲染通用面板组件 `FieldManagerPanel.vue`（新建于 `src/components/query/`）。

### 面板组件 `FieldManagerPanel.vue`（通用、无持久化逻辑）

接收 props / emit 意图（消费方负责翻译为跨 Tab 的持久化）：

- **props**：
  - `fields: FieldDescriptor[]` — 完整字段池（`props.fields`）；
  - `activeFields: FieldDescriptor[]` — 在用字段集（Group 1，见下）；
  - `candidateFields: FieldDescriptor[]` — 候选字段池（Group 2，见下）；
  - `currentTabVisibleKeys: string[]` — 当前 Tab 实际显示的字段 key（驱动 👁 开关态）。
- **emit（意图，非实现）**：
  - `toggleVisibility(key: string)` — per-tab 显示/隐藏；
  - `reorder(keys: string[])` — per-tab 列排序；
  - `addGlobal(key: string)` — 全局新增；
  - `removeGlobal(key: string)` — 全局移除。
- **本地状态**：`editMode: boolean`（编辑开关，默认 `false`）、`search: string`（搜索框，同时过滤两组）。

### 两层数据模型（M1）

不设独立的「实体级基础列集」，直接复用每个 Tab 各自的 `TableConfig.columns`：

- **在用字段集（Group 1）** = 出现在 ≥1 个 Tab 的 `columns` 中的字段（全局操作后各 Tab 一致）。面板第一行展示。
- **候选字段池（Group 2）** = `props.fields` 减去 Group 1。仅「编辑开关开」时展示。

**操作 → 数据语义映射**（面板 emit 意图，消费方实现）：

| 操作 | 位置 | 语义 | 作用域 | 消费方落地 |
|---|---|---|---|---|
| `⋮⋮` 拖拽 | Group 1 每行 | 改列顺序 | **当前 Tab** | 重排当前 Tab 的 `config.columns` |
| 👁 开关 | Group 1 每行 | 显示/隐藏 | **当前 Tab** | 在/不在当前 Tab 的 `config.columns` 增删该 key；字段仍留 Group 1 |
| 🗑 删除 | Group 1 每行（仅编辑开） | 全局移除 | **所有 Tab** | 从每个 Tab 的 `config.columns` 删除该 key → 移入 Group 2 |
| `+` 新增 | Group 2 每行（仅编辑开） | 全局新增 | **所有 Tab** | 把该 key 追加进每个 Tab 的 `config.columns`（👁 默认开）→ 移入 Group 1 |

**感知优先级**：某字段在 Group 1（全局在用）但 👁 关 = 仅当前 Tab 不渲染（per-tab override），字段仍可在其他 Tab 显示、可一键重开。这与「删=移入候选池」形成干净的双级模型：
- 全局增/删 决定「某字段是否跨视图属于本表」；
- per-tab 显示/隐藏 决定「它在本视图显不显」。

### 面板形态（grill 第 2–3 轮确认）

- **顶部编辑开关（默认关）**：默认态只暴露安全的 per-tab 操作；全局增/删需显式开启，避免误删。
- **搜索框（顶部）**：同时过滤 Group 1 与 Group 2（按 `field.label`/`field.key` 实时筛选）。
- **Group 1（在用字段集）**：每行 `⋮⋮` + 字段图标 + 字段名 + 👁；编辑开时 👁 右侧追加 🗑。👁 关 → 整行置灰 + 眼睛图标斜杠态。
- **Group 2（候选字段池，仅编辑开）**：每行 字段图标 + 字段名 + `+`。按 `props.fields` 注册顺序排序。

### 全局增/删副作用（Round 4 确认）

- **全局新增（`+`）**：追加到**每个** Tab 的 `columns` 末尾；默认 👁 开（所有 Tab 立即可见）——符合「+ = 加入即用」。
- **全局移除（🗑）**：从**每个** Tab 的 `columns` 删除；字段移入 Group 2，`+` 可恢复。**不做删除确认**（误删成本低，属视觉层重排、不丢字段底层数据）。
- **不触碰实体 schema / 自定义属性 / 字段底层值**：纯 `TableConfig.columns` 成员与顺序的视觉层操作。

### 持久化归属

所有列变更最终落到各 Tab 的 `TableConfig.columns`（ADR-0005/0006/0009：Tab 拥有自己的 `config`）。面板与 `QueryToolbar` 一样只 emit 意图，由持有 `config` 的消费方调用 named-view store 持久化。组件保持实体无关、可复用于任意 Screen（TaskHub 的 Block / PagesLibrary 的 Page 各自注入不同 `fields`）。

## Considered Options

### 范围

- **(A) 仅展示管理（选定）**：只管列显示/隐藏/排序/全局增删（视觉层），不建自定义属性。最贴合 `TableView` 通用契约，体量小。
- (B) 实体 schema 管理：新建/编辑/删除真实字段（自定义属性）。Block 在 Block 编辑器已大半存在、Page 尚无，超出本表职责、爆炸式扩大范围。未取。
- (C) 两者合一：本次先做 A，C 留作后续扩展。

### 全局增/删的数据落点

- **(M1) 直接改所有 Tab 的 `columns`（选定）**：最小改动、纯视觉、复用现有持久化，无需新增「实体级基础列集」概念。
- (M2) 引入跨 Tab 共享的「基础列集」：更「正统」但多加一层持久化抽象，当前无必要。
- (M3) 全局增/删改 `props.fields` 本身：链路更长、且「增」来的字段还需再决定进不进 columns，语义绕。未取。

### 面板形态

- **(a) 单按钮 + 单 popover 内分两段（选定）**：上部 per-tab 显示/隐藏、下部（编辑开）全局增/删，正好映射两层作用域。
- (b) 两个独立按钮（「列」/「字段」）各开 popover：多一个入口，语义割裂。
- (c) 内联无弹层：占用工具条空间、与现有 popover 风格（filter/sort/group 均为 popover）不一致。未取。

### 编辑开关默认态

- **(a) 默认关（选定）**：默认只暴露安全 per-tab 操作，全局增删显式开启防误删。
- (b) 默认开 / (c) 常驻两段：误删风险高。未取。

### 全局新增默认可见性

- **(a) 默认 👁 开（选定）**：用户主动 `+` 即期望看到，所有 Tab 立即可见最直觉。
- (b) 默认关 / (c) 当前 Tab 开其他关：与「+ = 加入即用」直觉相悖。未取。

### 删除确认

- **(a) 不弹确认（选定）**：删除仅移入候选池、可 `+` 恢复，误删成本低。
- (b) 弹确认：摩擦高、与「可恢复」性质不匹配。未取。

## Consequences

- **正面**：通用表格首次获得「在表格内管理列」的能力，对齐 Airtable/Notion；两层作用域（per-tab 显示/隐藏 ↔ 全局增/删）语义清晰、互不污染；面板与 `QueryToolbar` 一样零业务耦合、可复用于任意 Screen；完全复用现有 `TableConfig.columns` 持久化，不新增数据结构。
- **中性**：全局增/删需消费方遍历所有 Tab 的 `config` 做批量变更（一次性写多 Tab）；编辑开关默认关，首次使用需主动开启才能见到增/删入口。
- **不触碰**：实体 schema、自定义属性系统、字段底层数据值——纯视觉层列管理。
- **待跟进（实现阶段）**：
  1. 新建 `FieldManagerPanel.vue`（通用）+ 在 `QueryToolbar.vue` 加「字段」按钮（`emit('fields')`）+ 消费方接 `BasePopover` 渲染面板；
  2. 消费方实现四个意图 → 跨 Tab 改写 `TableConfig.columns` 并经 named-view store 持久化；
  3. 拖拽排序用现有 `Sortable.js`（force-fallback 模式，见项目约定）或原生 HTML5 drag；
  4. 补 `FieldManagerPanel.test.ts`：per-tab 显示/隐藏不影响 Group 1 成员、全局增/删同步所有 Tab、删除移入候选池可恢复、搜索同时过滤两组。
- **验证建议**：`npm run dev` 手测——最右侧「字段」按钮开面板、编辑关时拖拽+👁、编辑开时 `+`/`🗑`、跨 Tab 验证全局生效、切 Tab 验证 per-tab 仅影响当前。
