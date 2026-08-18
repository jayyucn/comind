# 0009: Two-Level Screen→Tab Named View Model & `NamedViewBar`

**Status:** accepted

## Context

ADR-0005 redefined a **View** as a concrete rendering interface (table/board/calendar) that owns exactly one headless `ViewQuery`. It was piloted in Task Hub behind the single-level `TaskViewBar`, and explicitly deferred (a) the Pages Library adoption and (b) the concrete layout-config schema.

Two gaps remained once we tried to make it real:

1. **No container level.** A "Screen" (业务界面, e.g. Task Hub, Pages Library) needs to own *several* named Views, each with its own query, and remember which one was last open. ADR-0005's model had a flat list of Views with a single `is_default` entry-view — there was no named *container* above the Views. The user's thesis "每一个页面至少有一个视图" actually implies *pages contain views*, i.e. a two-level hierarchy.
2. **Coupling.** `TaskViewBar` was hard-wired to the Block entity (it imported `useBlockQueryRegistry`, `BLOCK_ENTITY`, and held its own query state). Pages Library therefore could not reuse it and kept a separate local `viewMode` — exactly the duplication ADR-0005 said it would migrate away from.

This ADR promotes the model to a **two-level Screen→Tab hierarchy**, evolves the single `screen_view` table with a `parent_id` column (no new table), and extracts a reusable public `NamedViewBar` that both Task Hub and Pages Library consume through a per-entity store.

> Terminology reconciliation: the "View" from ADR-0005 is now called a **Tab**. A **Screen** is the named container above Tabs. Tab = one concrete interface (table/board/calendar) owning one `ViewQuery`.

## Decision

### Two-level hierarchy (one-to-many)

```
Screen (命名容器)
  ├─ is_default : 1|0      // exactly one default Screen per entity
  ├─ view_type           // container type hint (e.g. table), not a Tab render kind
  └─ Tabs[]              // each Tab is a View from ADR-0005
        ├─ view_type : 'table'|'board'|'calendar'   // FIXED at creation — the render kind
        ├─ query_json : ViewQuery                   // owned, headless
        ├─ config     : LayoutConfig
        └─ is_default : (unused at Tab level)
```

- A **Screen** carries a name, a default flag, and *no query*. It is the entry point and remembers the last-open Tab.
- A **Tab** is the ADR-0005 View: a fixed `view_type` (the render kind, immutable after creation) plus its own `query_json` and `config`. Type is chosen in the new-Tab modal and cannot be changed later (matches Notion/Airtable mental model).
- Switching Tabs keeps each Tab's query intact. Switching Screens switches the whole set of Tabs.

### Single-table evolution (`parent_id`)

Reuse the existing `screen_view` table. Add one column:

| column | meaning |
| --- | --- |
| `parent_id` | `''` (empty) ⇒ this row is a **Screen**; non-empty ⇒ this row is a **Tab**, value = owning Screen's `id` |

This avoids a second table and the migration/join cost, while the `entity` column already isolates per business entity (block/page). Both storage adapters (`SqlJsAdapter`, `SQLiteAdapter` + `SQLiteTransactionAdapter`) get an idempotent `ALTER TABLE ADD COLUMN parent_id TEXT` migration; `ScreenView::new(entity, parent_id, …)` takes the new argument.

### Per-entity store factory

`useScreenViewStore(entityKey, options)` returns a **Pinia store isolated per `entityKey`** via a module-level `storeRegistry` (`screenView:${entityKey}`). The same `entityKey` returns the same instance; `block` and `page` never collide. The store manages:

- `screens`, `currentScreen`, `currentScreenId`
- `currentTabs`, `currentTab`, `currentTabId`, `currentViewType`
- `workingQuery` (the editable query of the active Tab) + `dirty` / `dirtyByTab` (per-Tab dirty markers)
- `drafts` (stashed unsaved queries, keyed by tabId) + `lastTabByScreen` (memory of last-open Tab per Screen)

### Explicit save + draft stash

- The active Tab's query is edited live in `workingQuery`; filtering/preview is driven by it, so changes preview immediately but are **not** persisted until explicit save.
- `setWorkingQuery(q)` recomputes the dirty marker by comparing `JSON.stringify(q)` against the committed `query_json`.
- Switching away from a dirty Tab **stashes** `workingQuery` into `drafts[tabId]`; switching back **restores** it (across both Tabs and Screens). `saveActiveTab()` persists via `updateTab` and clears the marker; `discardActiveTab()` reverts to committed.
- This replaces ADR-0005's implicit auto-persist-on-change behavior with an intentional "你调整了{筛选|排序|分组} → 清除/保存" UX. The inline hint lists which query parts (`filter` / `sort` / `groupBy`) actually changed, ordered by 筛选>排序>分组 priority (computed by `diffQueryParts` in `src/core/view/management.ts`).

### Reusable `NamedViewBar` (decoupled)

`src/components/common/NamedViewBar.vue` is entity-agnostic:

- Props: `entityKey`, `viewTypes: ViewTypeOption[]`, optional `defaultViewName` / `defaultViewType`.
- Owns: Screen dropdown (new / rename-by-pencil-and-double-click / set-default / delete / count), Tabs strip (type icon + name + active underline + inline dirty controls + kebab/`…` menu with rename/copy/delete), new-Tab modal (name + type segmented control).
- Consumes `useScreenViewStore(entityKey)` internally; the parent injects `QueryToolbar` + `QueryChipBar` via `<slot/>` and owns the search/query state (the bar calls `store.setWorkingQuery` / `store.workingQuery`).

The old single-level `TaskViewBar.vue` is deleted. `TaskHub` (`entityKey='block'`) and `PagesLibrary` (`entityKey='page'`, default Screen "全部页面", types table/calendar) both render `NamedViewBar`. Pages Library's redundant standalone `viewMode` switcher is removed — the Tab's fixed `view_type` now drives rendering.

## Considered Options

**Hierarchy shape — flat list vs two-level Screen→Tab**
- *A (prior, ADR-0005):* flat list of Views with one `is_default`. → Rejected here: cannot express "a Screen remembers its last-open View" or group multiple named Views under one interface.
- *B (chosen):* Screen→Tab two-level. Matches the user's "page contains views" thesis and Notion/Airtable.

**Storage — separate `screen`/`tab` tables vs single `screen_view` + `parent_id`**
- *A:* two tables + join. → Rejected: more migration, more adapter code, no functional gain given 1-N and existing `entity` isolation.
- *B (chosen):* single table, `parent_id` empty ⇒ Screen. Minimal, reuses all existing infrastructure.

**View type mutability — mutable vs fixed-at-creation**
- *A:* allow changing a Tab's `view_type` later. → Rejected: a Tab's `config`/`LayoutConfig` is kind-specific; mutating kind silently breaks config. Fixed-at-creation is simpler and matches the reference apps.
- *B (chosen):* type chosen in new-Tab modal, immutable after.

**Rollout — incremental vs full in one pass**
- *A:* ship backend + store, wire only TaskHub, defer Pages Library. → Rejected: leaves the duplication ADR-0005 set out to remove.
- *B (chosen):* full pass — backend two-level + TS client + store + `NamedViewBar` + wire both consumers + tests + this ADR.

## Consequences

- `screen_view` gains `parent_id`; both Rust storage adapters migrated idempotently; `ScreenView::new` signature changed (all callers updated: `filter_service`, Tauri commands, `CoreClient`).
- `TaskViewBar` removed; `TaskHub` and `PagesLibrary` consume `NamedViewBar`. Pages Library now has persisted, named, per-entity views (previously it had none).
- Save is now explicit (dirty marker + clear/save), not auto-on-every-keystroke. Users must click 保存 to persist a Tab's query.
- Per-entity isolation via `storeRegistry` prevents block/page view state from colliding.
- **Open follow-ups:** (1) concrete `LayoutConfig` schema per `viewKind` (ADR-0005 open item still stands); (2) migration of pre-existing single-level rows into Screen+Tab (seed a default Screen wrapping each legacy View); (3) drag-reorder of Tabs/Screens (`sort_order` already supported).
