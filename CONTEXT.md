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

### Image Block

A Block whose `type` is `image`. Stores its image reference in `content` as `![alt](asset://id)` or `![alt](url)`. Has no edit state; insertion is via the `/image` slash command, and operations such as zoom, copy, replace, delete, and alignment are exposed through a hover toolbar. When selected, it shows a bounding border with four corner handles for inline resizing (display size is persisted in `block.format.width/height`). Display alignment is controlled by `block.format.align`. See ADR-0037.

### BlockModal (单块子树编辑弹窗)
A centered modal that opens a single Block as the **root of a subtree editor**: it renders the Block and its full descendant tree, with working block-level keyboard (Enter/Tab/arrows) and auto-focused root on open. Triggered from list/board/calendar cards and from a Block's bullet dot. Distinct from **PageDrawer** — see ADR-0039.

### Subtree Editor (子树编辑器)
The editing model behind BlockModal: a Block plus its complete subtree is editable in place, but no new *root-level sibling* may be created (Enter at the root creates a child, staying inside the visible subtree). Contrast with a full-page editor. See ADR-0039.

### Bullet-to-Open
Interaction convention: clicking a Block's `bullet-dot` opens BlockModal for that Block (primary editor entry from any view). Collapse/expand is delegated to a separate `bullet-chevron` shown on hover when the Block has children. Inside BlockModal the dot is a no-op. See ADR-0039.

### inBlockModal / blockModalRootId (注入键)
Two `provide`/`inject` keys used to scope Block behavior inside BlockModal: `inBlockModal` (true inside the modal → bullet dot is a no-op) and `blockModalRootId` (the modal's root Block id → its Enter forces a child, its Outdent is a no-op, keeping edits within the subtree). Absent in the main editor, so main-editor behavior is unchanged. See ADR-0039.

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
Per-kind rendering metadata carried by a View, as a `LayoutConfig` discriminated union keyed by `viewKind` (see ADR-0006). Members: `TableConfig { columns: {key, width?, role?, cell?}[] }`, `BoardConfig { cardFields?: string[] }` (grouping column reuses `ViewQuery.groupBy`; `cardFields` lists card badge fields), `CalendarConfig { dateRefKind: 'deadline' | 'schedule' }`. Each member carries `version: 1`. `TableConfig.columns[].role` (`'primary' | 'link' | 'overdue-date' | 'done'`) and `TableConfig.columns[].cell` are render-only decoration kept here — off the headless Field Descriptor. `cell` is an optional string key that, when present and resolved through an injected `cellRegistry`, delegates the cell to a consumer-provided component instead of the built-in type/role renderer (see ADR-0010). Keeps rendering concerns off `ViewQuery`.

### Custom Cell (自定义单元格渲染器)
A consumer-provided `TableView` cell renderer. Declared by an optional `cell` string key on `TableColumnConfig` and resolved at runtime through an injected `cellRegistry` (so the Vue component stays out of the persisted, headless `LayoutConfig`). The component receives `{ item, value, field?, col, editable }` and emits `change(value)`, which `TableView` re-emits as the standard `cellChange(itemId, fieldKey, value)`. Opt-in: only used when `col.cell` resolves; otherwise the built-in type/role renderer runs. Introduced by ADR-0010. _Avoid_: custom field type, cell component stored on Field Descriptor.

### Generic Views (通用视图)
Entity-agnostic view renderers driven by `FieldDescriptor[]` + `LayoutConfig`, located at `src/components/views/` (see ADR-0008). `TableView` / `BoardView` / `CalendarView` are all `generic="T"`, no hardcoded task semantics, no `BlockCard` import; task UX is lifted to field metadata (option `color`, `done`/`deadline`/`content`/`page` builtin fields). A Screen wires them by injecting its registry fields + a `config` seam. `TableView` additionally owns **render-layer pagination** (records are sliced into pages of `pageSize` for rendering; the data source stays fully loaded so the query engine keeps filtering/sorting/grouping over the complete set) — see ADR-0024. Table clicks are reported as a **cell-level fact** `cellClick(itemId, fieldKey)` — no role inference, no navigate semantics; the *business layer* (TaskHub/PagesLibrary) decides whether a field key (e.g. `content`/`title`) triggers navigation. `BoardView`/`CalendarView` keep the card-level `navigate(itemId)` event. Cell **interactivity** is configurable per field via `FieldDescriptor.editable` (default editable: `select` pops the edit menu, `boolean` renders a checkbox; set `false` for read-only display, e.g. Page `type` label) — orthogonal to filtering, which always uses the field type. A column may additionally opt out of the built-in renderer entirely via `TableColumnConfig.cell` (see ADR-0010): when set and resolved by the injected `cellRegistry`, `TableView` renders the consumer's component with `{ item, value, field?, col, editable }` and re-emits its `change` as the standard `cellChange` — so custom cells reuse the same interaction contract as built-ins.

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

### Block Clipboard Payload (剪贴板载荷)
The structured data carried when a Block is copied: `{ version, kind: 'blocks', blocks: BlockClipPayload[] }`, each item carrying `content`, `type`, `format`, `properties`, and recursive `children`. `parentId`/`pos`/`pageId`/timestamps are NOT carried — they are regenerated on paste. Exception: the source `id` IS carried on each item solely so subtree-internal self-references in `content` can be remapped to the new ids on paste (ADR-0025 D6); the id itself is never reused. Serialized to the OS clipboard as custom MIME `application/x-comind-block` plus a `text/plain` fallback. See ADR-0025. _Avoid_: clipboard text, copied string.

### Paste as Blocks (粘贴为 block)
Restoring an internal clipboard payload into one or more new Block trees inserted into the target page, rather than dropping the text into a single TipTap block. The missing half of copy today — copy existed but paste-as-blocks did not. See ADR-0025. _Avoid_: paste, paste text.

### Internal Clipboard Format (内部剪贴板格式)
The custom MIME type `application/x-comind-block` carrying the `BlockClipboardPayload` JSON on the OS clipboard, with a `text/plain` fallback. Distinguishes an internal block-paste from an external paste (plain text / HTML from another app). See ADR-0025. _Avoid_: clipboard store, in-memory clipboard.

### Paste as Plain Text (粘贴为纯文本)
`Ctrl/Cmd+Shift+V` — ignores the custom MIME and pastes the `text/plain` fallback as plain text into the current single block via TipTap's default behavior. Introduced by ADR-0025. _Avoid_: paste without formatting, paste as text.

### External Paste Splitting (外部粘贴拆分)
Parsing external clipboard content (`text/html` / `text/plain` from another app) into multiple comind blocks — preserving paragraphs, list nesting, and heading levels — instead of collapsing into a single block. Active only in a block-level paste context (selected/focused block); an inline-caret paste still falls through to TipTap's single-block behavior. Introduced by ADR-0026. _Avoid_: paste from clipboard, import external text.

### Block-level Paste Context (block 级粘贴上下文)
A paste scenario where a block is selected or focused (not editing inline text). Both internal block-paste (ADR-0025) and external paste-splitting (ADR-0026) trigger here; an inline-caret paste does not. See ADR-0026 D1/D8.

### External Paste Parser (外部粘贴解析器)
`src/services/external-paste-parse.ts` — parses `text/html` via the native `DOMParser` + a strict allowlist sanitizer into a `BlockClipPayload` forest, and splits `text/plain` on `\n` (trim, skip blank lines). New in ADR-0026. _Avoid_: innerHTML, DOMPurify (v1).

### Clipboard Source Priority (剪贴板源优先级)
For external paste, `text/html` takes precedence over `text/plain` (richer structure: paragraphs / lists / headings). See ADR-0026 D2.

### Selection (选区)
The user's currently active selected state. At any moment it is exactly one of **Block Selection** or **Text Range** — the two are mutually exclusive. See ADR-0035. _Avoid_: 选中集, highlight.

### Block Selection (块选区)
A set of Block ids selected as whole units, toggled via Ctrl/Cmd+Click or by dragging from a block's property region. Powers block-level copy/paste/delete (ADR-0025/0026). Distinct from **Text Range**. See ADR-0035. _Avoid_: 多块选择, multi-select, 整块选择.

### Text Range (文本选区)
A contiguous text range spanning multiple Blocks, bounded by two char positions — each a `{ blockId, offset }` into that block's raw content — with everything between them in document order selected, like a word processor. Created by dragging across block content. Powers text copy. Distinct from **Block Selection**; the two are mutually exclusive. See ADR-0035. _Avoid_: 文字选择, selection range, 文本选择.

### Project (项目)
A Block's built-in string property (`key: 'project'`). Its value is free text — a project name, not a reference to an entity or Page. Editing surfaces offer previously used values (derived from the full block snapshot, usage-ranked) as input convenience; typing a new name and re-selecting an old name have identical semantics. _Avoid_: project entity, project relation, 项目引用.

### Area (领域)
A Block's built-in string property (`key: 'area'`). Same free-text semantics and input convenience as **Project**: the value is a string, never a reference. _Avoid_: area entity, 领域引用.
