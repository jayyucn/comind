# 0005: Redefine View and ViewQuery Model (Task Hub Pilot)

**Status:** accepted

## Context

In Task Hub, the `TaskViewRust` entity currently conflates two ideas:

- a **named query configuration** ("新视图 4" — a `ViewQuery` of filter/sort/group), and
- a **render switch** (`view_type` ∈ table/board/calendar) carried as a field on that single config.

The UI therefore has two separate controls: a left dropdown that picks the named config, and a row of tabs that flips `view_type`. The query engine (`ViewQuery`) is defined as headless data that "excludes rendering concerns such as view type" (see `CONTEXT.md`).

The user re-framed the domain with three theses:

1. **视图其实是界面** — a View is the actual rendering interface, not a query config.
2. **表格 | 看板 | 日历 是 3 个视图** — table/board/calendar are three Views, not a `view_type` flag on one config.
3. **每一个页面至少有一个视图** — every screen has at least one View.

This ADR redefines the `View` / `ViewQuery` data model around those theses, piloted in Task Hub. Scope is Task Hub only; Pages Library keeps its local `viewMode` for now and is migrated later.

## Decision

Model a **View** as a concrete rendering interface that *composes* a headless `ViewQuery`:

```
View = {
  id: string
  name: string
  viewKind: 'table' | 'board' | 'calendar'   // was view_type
  query: ViewQuery                             // filter + sort + groupBy (headless)
  isDefault: number                           // exactly one entry-view per screen
  config: LayoutConfig                         // per-kind rendering metadata
  sortOrder: number                           // tab ordering
}
```

- `ViewQuery` stays a pure headless data model (`{ version, filter, sort, groupBy }`) with **zero** rendering knowledge. Each View owns exactly one ViewQuery (composition, not association).
- `viewKind` is the layout kind. Table/Board/Calendar are three View *instances* that coexist as tabs on a screen; a user may add or remove more Views of the same kind.
- `isDefault` marks the single View opened on entry (exactly one per screen). The three auto-seeded Views are not all default — only one carries `isDefault = 1`.
- `config` holds per-kind rendering metadata: `calendarDateField`, `tableColumns` (order/width). The board grouping column reuses `ViewQuery.groupBy` rather than a separate field.
- **Screen** (业务页面, e.g. Task Hub, Pages Library) is distinct from **Page** (document entity in `CONTEXT.md`). Views belong to a Screen.

### Persistence (`TaskViewRust`) reshape

| before | after |
| --- | --- |
| `id` | `id` |
| `name` | `name` |
| `view_type` | `viewKind` (`'table'|'board'|'calendar'`) |
| `query_json` | `queryJson` (serialized `ViewQuery`, now also carrying `groupBy`) |
| `group_by` | **removed** — folded into `ViewQuery.groupBy` |
| `is_default` | `isDefault` (entry-view semantics) |
| `sort_order` | `sortOrder` |
| — | `config` (JSON blob, nullable) |

On screen creation, seed three default Views (table/board/calendar); one is marked `isDefault`.

## Considered Options

**View identity — bundled config vs interface-with-viewKind**
- *A (current):* one named config + `view_type` flag. → Rejected: conflates query with render, contradicts the three theses.
- *B (chosen):* View = interface = `{ name, viewKind, query, ... }`; table/board/calendar are View instances. Matches theses 1–2.

**Query ownership — per-View vs per-Page shared**
- *A:* query shared at screen level, all layouts filter the same dataset. → Rejected: switching tabs would lose per-layout filtering; conflicts with Notion/Airtable mental model where each view keeps its own query.
- *B (chosen):* each View owns its ViewQuery. "新视图 4" is a named View carrying its query; switching layout can keep or diverge per view.

**Default semantics — entry-view vs preset-collection**
- *A (chosen):* `isDefault` = the one View opened on entry (exactly one). Reuses the existing single `is_default` column.
- *B:* `isDefault` = system-preset (multiple), entry tracked elsewhere. → Rejected: no current need, adds a field.

**Layout config placement — View.config vs fold into ViewQuery vs defer**
- *A (chosen):* `View.config` JSON blob for `calendarDateField` / `tableColumns`; board group reuses `ViewQuery.groupBy`. Keeps `ViewQuery` rendering-agnostic.
- *B:* fold layout config into `ViewQuery`. → Rejected: violates the documented "ViewQuery excludes rendering concerns" principle.
- *C:* defer / nullable. → Not chosen; `config` is cheap and keeps the model complete.

## Consequences

- `TaskViewRust` loses `group_by`; `ViewQuery.groupBy` becomes the single source of grouping truth.
- The query UI already lives inside `TaskViewBar` (ADR-0004) and is per-View — this ADR makes that ownership explicit and persistent.
- Migration needed: existing rows → `view_type`→`viewKind`, `group_by`→`queryJson.groupBy`, seed board/calendar Views where only a table View exists, set one `isDefault`.
- Pages Library remains on local `viewMode` (table/calendar) until a later ADR migrates it to this `View` model.
- **Open follow-ups:** (1) concrete `LayoutConfig` schema per `viewKind`; (2) seed/migration script for existing screens; (3) Pages Library adoption.
