# ADR-0022: Deduplicate the query-UI value editors and screen wiring

- **Status:** Accepted (2026-08-20)
- **Deciders:** jay
- **Related:** candidate 7 in `docs/architecture-deepening-backlog.md`; candidate 6 (ADR-0016, ValueEditor decoupling) prepared the seam; ADR-0008 fixed `crossRecordSources` injection; ADR-0009/0010 defined the leverage target; candidate 8 (generic-views leverage) depends on this one.

## Context

The query UI carries three pairs of near-parallel modules where the second copy is a thin rename of the first — the leverage promised by ADR-0009/0010 is diluted by per-screen duplicated wiring:

1. **Value editors** — `ChipValueEditor.vue` (252 lines, literal-only) vs `ValueEditor.vue` (541 lines, literal/field/recordRef). Verbatim duplication: `NO_VALUE_OPS`/`isEmptyOp` sets, `isRangeOp`/`isRange` between/within predicates, DatePicker wiring (`mode: isRange ? 'range' : 'single'`), type-dispatch structure. Deliberate divergences: Chip uses segmented buttons for boolean, ValueEditor uses `<select>`; Chip maps empty string → `undefined`, ValueEditor → `null`; Chip select has a search box, ValueEditor's does not; ValueEditor supports field/recordRef references, Chip does not.
2. **Chip-bar orchestration** — `PagesLibrary.vue` L36–51 and `TaskHub.vue` L117–125 share **9 verbatim JS lines** (chipBarVisible/chipBarRef/hasFilter/hasSort/hasGroup/openChipMenu) plus ~25 lines of near-identical template (only `:fields`, `:entity-type`, and PagesLibrary's `:cross-record-sources` differ).
3. **Engine bridges** — `useBlockQueryEngine.ts` (47 lines) vs `usePageQueryEngine.ts` (48 lines): function bodies **verbatim identical** modulo the type name `BlockCard ↔ Page` (`filterSortX`/`groupX`/`runX` wrapping `evaluate`+`groupItems` from `core/query`).

**Measured facts** (2026-08-20, baseline `68a5a19`):
- `ChipValueEditor` has a single production consumer: `ConditionPopover.vue` (`:154`), which already holds a `FieldDescriptor` (`:11`) but **no `entityType` prop** (must be passed down from `QueryChipBar`, which has it at `:30`). `ValueEditor`'s single consumer is `ConditionRow.vue` (`:111`) which already has `entityType`.
- Both edit paths live inside `QueryChipBar`: chip popover (ConditionPopover → ChipValueEditor) and filter builder (FilterBuilder → ConditionGroup → ConditionRow → ValueEditor).
- Engine-bridge consumers: `TaskHub.vue` (`runBlockQuery`, L73–75), `PagesLibrary.vue` (`filterSortPages`/`runPageQuery`, L84/88), plus two tests (`useBlockQueryRegistry.test.ts`, `usePageQueryRegistry.test.ts`).
- Shared value type is `ConditionValue` (core/query/types.ts L77–80): `{kind:'literal'|'field'|'recordRef', ...}`; there is **no `ValueDescriptor`** — `FieldDescriptor` is the field-level descriptor.
- ADR-0008's `crossRecordSources` injection point is intact: PagesLibrary translates records → prop; `ValueEditor.vue` L44 still accepts `crossRecordSources?: ReferenceableRecord[]`.

## Decision

Converge all three pairs onto single implementations; the chip path becomes a mode of the full editor instead of a separate component.

### Q1–Q8 decisions (from `/grilling`)

| # | Decision | Outcome |
|---|---|---|
| Q1 | Editor direction | **ChipValueEditor is deleted**; `ConditionPopover` renders `ValueEditor` with its existing `FieldDescriptor` + `entityType` (passed down from `QueryChipBar`). |
| Q2 | Scope | **All three convergences in one change** (editor + chip-bar orchestration + engine bridge) — deletion test pays off once. |
| Q3 | Empty-value semantics | Unified to `null` (ValueEditor's current behavior); Chip's `undefined` mapping goes away. |
| Q4 | Boolean UI | Unified to `<select>` (ValueEditor's current behavior); Chip's segmented buttons go away. |
| Q5 | Reference capability | `ValueEditor` gains an `allowRefs?: boolean = true` prop. `ConditionPopover` passes `false`, keeping the chip path literal-only (no reference picker UI, no `crossRecordSources` need there). |
| Q6 | Chip-bar orchestration | Extracted as `useChipBarOrchestration` composable (the 9 refs/computed/openChipMenu lines). The ~25 template lines stay in both screens (QueryChipBar is a large component; a wrapper panel buys little). |
| Q7 | Engine bridge | `createQueryEngine(entityType)` factory returns `{ filterSort, group, run }` (entityType bound); `useBlockQueryEngine`/`usePageQueryEngine` deleted. Consumers and both tests retarget. |
| Q8 | Tests | `ChipValueEditor.test.ts` deleted with the component; `ValueEditor.test.ts` gains `allowRefs=false` literal-only cases covering the former chip semantics (null semantics, select boolean). |

**Verified, not changed**: `crossRecordSources` injection point stays per ADR-0008 (PagesLibrary translates, ValueEditor receives); the engine bridge signature already carries an `entityType` param, so the factory binds it.

### Target layout

```
core/query/engine.ts             NEW: createQueryEngine(entityType) -> { filterSort<T>, group<T>, run<T> }
composables/useChipBarOrchestration.ts  NEW: 9-line orchestration (visible/computed/openChipMenu)
components/query/ValueEditor.vue  + allowRefs prop; reference UI gated behind it
components/query/ChipValueEditor.vue   DELETED (252 lines)
composables/useBlockQueryEngine.ts     DELETED (47 lines)
composables/usePageQueryEngine.ts      DELETED (48 lines)
components/query/ConditionPopover.vue  render ValueEditor (descriptor + entityType + allowRefs=false)
components/PagesLibrary/PagesLibrary.vue  use useChipBarOrchestration + createQueryEngine(PAGE_ENTITY)
components/TaskHub/TaskHub.vue           use useChipBarOrchestration + createQueryEngine(BLOCK_ENTITY)
```

### Considered options (rejections worth remembering)

- **Keep both editors, extract shared helpers** — rejected: the two components would still drift (boolean UI, null/undefined); the deletion test only passes when the second editor is gone.
- **Fold ValueEditor into ChipValueEditor** — rejected: ValueEditor's reference capability is the reason the chip path is a *mode*, not the other way around.
- **Always show references in the chip path** — rejected: ConditionPopover has no entityType context today and chip editing is a quick literal entry; `allowRefs=false` keeps behavior identical (Q5).
- **Wrap QueryChipBar in a panel component** — rejected: the template differences (fields/entity-type/cross-record-sources) are small and the component's props/emit surface is large; a composable captures the shared state without a new component layer (Q6).
- **Generic functions instead of a factory** — rejected: the consumers already pass `entityType` per call; a factory binds it once at screen level and keeps call sites shorter (Q7).

## Consequences

**Positive**
- **~395 lines deleted** (252 editor + 95 engine bridges + test) and two parallel modules removed; the chip path is now a mode of one editor.
- One editor to extend: a new field kind lands in `ValueEditor` once and serves both the chip popover and the filter rows.
- Chip-bar screens share one orchestration; the engine bridge is one generic implementation, so a third entity type costs zero new code.
- Behavior converges on ValueEditor's semantics (null, select), eliminating the chip's divergent empty-value and boolean UI.

**Negative / Risk**
- **Chip editing UI becomes the full editor** (larger popover, select boolean instead of segmented buttons, null instead of undefined) — deliberate behavior change, covered by the new `allowRefs=false` tests (Q8).
- `ConditionPopover` needs an `entityType` prop threaded from `QueryChipBar` — a small prop addition to a shared component.
- Two engine-bridge tests must retarget to `createQueryEngine` — they are pure-function tests, so the retarget is mechanical.

## Follow-ups (not in this change)

1. **Candidate 8**: close the generic-views leverage gap — move `'content'` fallback and `dateRefKind` semantics into `FieldDescriptor` metadata; migrate PagesLibrary's `PageTableView`/`PageCalendarView` onto `views/{Table,Board,Calendar}View`; evaluate GraphView filter integration with `core/query`. Depends on this candidate's `FieldDescriptor`/editor convergence.
2. `ValueEditor`'s select search box (Chip had one, VE does not) — worth porting if select options grow.

## Acceptance gate

- `npm run typecheck` equivalent (`vue-tsc -b`) — no new errors (pre-existing TS6133 set unchanged).
- `vitest run` — no new failing files vs baseline; `ValueEditor.test.ts` covers `allowRefs=false` literal-only; engine tests retargeted to `createQueryEngine`.
- Manual spot-check: chip popover in TaskHub edits literal values identically (null semantics); PagesLibrary filter rows unchanged; board/table/calendar grouping/sorting still work after engine-bridge swap.
