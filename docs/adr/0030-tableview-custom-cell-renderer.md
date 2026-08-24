# 0010: TableView Custom Cell Renderer (opt-in via `cell` key + injected registry)

**Status:** accepted

## Context

`TableView` (`src/components/views/TableView.vue`, `generic="T"`) is the entity-agnostic table renderer. Cell rendering is today a hardcoded `v-if` chain over `FieldDescriptor.type` (boolean/select/multiSelect/date/text/number) and `TableColumnConfig.role` (primary/link/overdue-date/done) — there is no seam to render a cell any other way (TableView.vue:281-356).

Two forces push for an extension point:

1. **Concrete driver:** Block `content` needs a rich-text preview cell that the six built-in field types cannot express. More field extensions are expected later.
2. **Hard constraints:**
   - `TableColumnConfig` is part of the persisted, JSON-serializable `LayoutConfig` (parsed by `parseLayoutConfig`). A Vue component reference **cannot** live in config.
   - `core/query` (and `FieldDescriptor`) must stay headless — no Vue imports (ADR-0002, AGENTS.md). So the renderer cannot hang off the Field Descriptor either.

The mechanism must therefore (a) keep the rendering component out of persisted/headless data, (b) keep `core` free of Vue, and (c) not disturb the built-in type/role chain or the existing `cellChange`/`cellClick` interaction contract.

## Decision

### Config key `cell` (render-only, optional)

Add `cell?: string` to `TableColumnConfig` (sits beside `role`). `LayoutConfig.version` stays `1` → existing `TableConfig` JSON without `cell` parses unchanged; no migration.

### Injected registry (Vue-land only)

Add a `cellRegistry?: Record<string, Component>` prop to `QueryPageFrame`, forwarded verbatim to `TableView`. Each consumer (TaskHub for Block, PagesLibrary for Page) supplies its own map. `core/` never imports a component.

### Render precedence (opt-in)

In each `<td>`, `TableView` checks: if `col.cell` is set **and** `cellRegistry[col.cell]` exists → render `<component :is="cellRegistry[col.cell]" v-bind="cellProps" @change="...">`; otherwise fall through to the existing type/role `v-if` chain (unchanged). Pure opt-in: columns without a resolvable `cell` behave exactly as today.

### Component contract — `CellRenderer`

Defined as a types-only interface in `src/components/views/types.ts` (Vue layer):

- **props:** `{ item: T; value: unknown; field?: FieldDescriptor<T>; col: TableColumnConfig; editable: boolean }`
  - `value` reuses the built-in `valueOf(item, col)` (prefer `field.get`, fall back to `item[col.key]`).
  - `editable` lets the component decide whether to render editing UI (e.g. a read-only Block-content preview).
- **emit:** `change(value: unknown)`. `TableView` wraps it: `@change="(v) => emit('cellChange', idOf(item), col.key, v)` — reusing the existing `cellChange` contract, so business layers (`TaskHub`/`PagesLibrary`) need zero changes.

### Click handling contract

The `<td @click="onCellClick">` still reports `cellClick` for surface clicks. A custom cell's **internal interactive elements** (buttons/links) must `@click.stop`, exactly like the built-in checkbox/select — so they don't mis-fire `cellClick`; the cell surface itself bubbles and lets the business layer decide navigation by field key. This is documented as part of the `CellRenderer` contract.

### Scope

v1 covers `TableView` only. `BoardView` (`cardFields`) and `CalendarView` are out of scope (future follow-up).

## Considered Options

**Where the renderer is declared**

- *A — `TableColumnConfig.cell?: string` + injected `cellRegistry` (chosen):* component stays out of persisted/headless data; `core` stays clean; survives layout persistence; opt-in.
- *B — `FieldDescriptor.cell?: Component`:* → **rejected** — couples the headless query core to Vue components, violating ADR-0002 and AGENTS.md.
- *C — named slot `#cell-{key}` on `TableView`:* viable when persistence is **not** needed, but our driver (Block `content`) wants the cell choice to live in the persisted layout; slots also push per-column template into every consumer. **Rejected for the config-driven case** (kept as a possible future escape hatch for runtime-only overrides).
- *D — store `Component` directly in `LayoutConfig`:* → **rejected** — not JSON-serializable.

**Override scope**

- *A — opt-in (only when `col.cell` resolves) (chosen):* zero regression risk for existing columns.
- *B — custom component fully replaces built-in rendering:* more flexible but forces every custom cell to re-implement read-only/edit/done-row/link behavior. Rejected.

**Click protection**

- *A — internal elements `@click.stop`, surface bubbles (chosen):* mirrors built-in controls, no hidden DOM conventions.
- *B — `TableView` inspects `data-cell-internal` on `event.target`:* fragile, hidden contract. Rejected.

## Consequences

- `TableColumnConfig` gains optional `cell?`; all existing configs unaffected (`version` `1` unchanged).
- New prop pipeline `QueryPageFrame.cellRegistry` → `TableView.cellRegistry`.
- `core/query` and `FieldDescriptor` untouched; `CellRenderer` contract type lives in `src/components/views/types.ts`.
- **First real consumer is `TaskHub` (Block `content`), not `PagesLibrary`** — the two files used to analyse this were a sample; the mechanism is generic across both.
- Open follow-ups: (1) implement the concrete Block `content` cell component and register it in TaskHub's `cellRegistry`; (2) extend to `BoardView`/`CalendarView` if a real need appears; (3) add `TableView.test.ts` coverage for the custom-cell render + `change`→`cellChange` path and the click-stop contract.
