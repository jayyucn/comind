# Domain Glossary

This file is the single source of truth for domain terminology in comind. It is a glossary — no implementation details, no specs, no decisions. Those live in `docs/adr/`.

## Terms

### Page
A top-level document in the workspace. Identified by a UUID hex string. Has a title, type, and zero or more Blocks.

### Ideas Page (点滴页面)
A Page whose `type` is `ideas`. Titled with a date string in canonical `yyyy-MM-dd` format (e.g. `2026-08-05`). Represents a single day's journal/daily-notes entry.

Legacy compatibility: pages with `type` `journal` are treated as Ideas Pages.

### Today's Ideas Page (今日点滴页面)
The Ideas Page whose title matches today's local date. At most one exists per day.

### Block
A unit of content within a Page. Has a parent-child relationship (tree structure). A Page with no Blocks has an auto-created empty root Block.

### Ensure (确保存在)
Get-or-create pattern. Returns the existing entity if present; creates and returns it if absent. Must be idempotent — calling it multiple times has the same effect as calling it once.

### Field Descriptor (字段描述符)
The unit through which a business entity exposes a filterable field to the query system. Carries a key, label, data type, and a way to read the field's value from an item. Business code registers Field Descriptors; the query engine knows entities only through them. An `Option` may carry a `color` for rendering (e.g. select option labels); the evaluator ignores it.

### Condition (条件)
A single predicate in a query: field + operator + value.

### Condition Group (条件组)
A node in a query tree that combines Conditions and nested Condition Groups with an AND/OR combinator. A flat condition list is the degenerate case of a Condition Group.

### Screen (屏 / 业务页面)
A business surface in the app (e.g. Task Hub, Pages Library). Distinct from **Page** (document entity). Views belong to a Screen. See ADR-0005.

### View (视图)
A concrete rendering interface for a Screen: a specific layout plus its own query and layout config. A Screen has at least one View; by default a Task Hub screen co-exists with Table, Board, and Calendar Views as tabs. A View is `{ name, viewKind, query, isDefault, config }`. See ADR-0005.

### viewKind (视图类型)
The layout kind of a View: `table` | `board` | `calendar`. Not a render flag on a query — it is what makes a View a distinct interface.

### View Config (视图配置)
Per-kind rendering metadata carried by a View, as a `LayoutConfig` discriminated union keyed by `viewKind` (see ADR-0006). Members: `TableConfig { columns: {key, width?, role?}[] }`, `BoardConfig { cardFields?: string[] }` (grouping column reuses `ViewQuery.groupBy`; `cardFields` lists card badge fields), `CalendarConfig { dateRefKind: 'deadline' | 'schedule' }`. Each member carries `version: 1`. `TableConfig.columns[].role` (`'primary' | 'link' | 'overdue-date' | 'done'`) is render-only decoration kept here — off the headless Field Descriptor. Keeps rendering concerns off `ViewQuery`.

### Generic Views (通用视图)
Entity-agnostic view renderers driven by `FieldDescriptor[]` + `LayoutConfig`, located at `src/components/views/` (see ADR-0008). `TableView` / `BoardView` / `CalendarView` are all `generic="T"`, no hardcoded task semantics, no `BlockCard` import; task UX is lifted to field metadata (option `color`, `done`/`deadline`/`content`/`page` builtin fields). A Screen wires them by injecting its registry fields + a `config` seam.

### View Query (视图查询)
The complete query model: a Condition Group tree plus sort and grouping rules. Excludes rendering concerns such as view type, which remain in the business layer. A ViewQuery is owned (composed) by exactly one View — it is headless data, never aware of the interface that renders it. See ADR-0005.

### Query Engine (查询引擎)
The headless core of the filtering system: a registry of Field Descriptors plus an evaluator over Condition Group trees. Contains no UI dependencies and no knowledge of concrete business entities.

### Query Page Frame (查询页外壳)
The page-level shell that assembles a Screen's standard query interface — title, named-view bar (Screen→Tab two-level), query toolbar, and chip bar — above a body region it renders by hardcoding the generic views (TableView/BoardView/CalendarView). It owns the chip-bar orchestration, the named-view store binding, and the view switching; business Screens (Task Hub, Pages Library) inject only their entity key, view types, fields, view data (items/groups/sort/configs), and event handlers. See ADR-0023.

### Entity Default Layout (实体默认布局)
The built-in default `LayoutConfig` of a business entity for each view kind (table/board/calendar), owned by the entity's registration point (`useBlockQueryRegistry` / `usePageQueryRegistry`) and injected into the named-view store via its options so seed/create writes an entity-correct config. The generic protocol layer (`core/view`) holds only the `LayoutConfig` types and parsing, never entity-specific defaults. See ADR-0023 D7.

### Sync (同步)
The cross-device consistency mechanism: after a write path commits, the affected records are reported to the sync layer so the paired remote can converge. Desktop (Tauri) has a sync peer; the web build has none, so sync is a no-op there. See ADR-0019.
