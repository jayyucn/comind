# ADR-0020: Collapse the six-layer frontend IPC chain

- **Status:** Accepted (2026-08-19)
- **Deciders:** jay
- **Related:** candidate 3 in `docs/architecture-deepening-backlog.md`; candidate 2 (`ADR-0019`) shares the "adapter is the seam" idea

## Context

The frontend reaches the Rust backend through a six-layer chain where every layer is a near-verbatim pass-through:

1. `src/wasm/client.ts` — `CoreClient` interface (**68 methods**, L42–133), `TauriClient` class (L135–409, **pure per-method forwarding**, no state, no constructor), `WasmClientAdapter` (L411–755, **22 stubs**).
2. `src/wasm/tauri-client.ts` (544 lines) — **103 exported `tauri*` functions** = 95 pure `invoke` forwards + 8 non-invoke functions (window control 4, platform detection 3, directory picker 1).

Adding one command touches 5 places: `commands.rs` + `lib.rs` + `tauri-client.ts` + `client.ts` (interface + Tauri forward) + `client.ts` (wasm stub). The `TauriClient` class and the `tauri*` functions are layer-for-layer identical — the interface and its implementation are equally wide.

**Measured facts** (2026-08-19):
- Frontend invokes **97 distinct** command strings; backend registers 98 + 2 (`renumber_blocks`, `build_document_order`).
- **15 call sites bypass `CoreClient`** and import `tauri*` functions directly: window/sync (8), S3/S6 Rust content-parser commands (6), graph snapshot (1).
- Of the 103 `tauri*` functions, **68** are referenced by `TauriClient`; of the remaining 35, **17 have zero consumers anywhere** (dead code: `tauriExportToMarkdown`, `tauriImportFromMarkdown`, workspace-path set, sync-config set, `tauriGetSyncQr`, `tauriSyncNow`, `tauriTriggerSync`, `tauriUnpairDevice`, `tauriParseDateTimeInput`, `tauriIsJournalTitle`, …).
- **`get_templates` is a live bug**: the frontend calls it, the backend has no such command — template loading in the Tauri build IPC-errors.

## Decision

Collapse the Tauri-side forwarding chain: delete `tauri-client.ts` and move every function to its honest home. `CoreClient` becomes the complete business-data command surface; platform capabilities get their own module. The wasm adapter is untouched (candidate 4).

### Q1–Q10 decisions (from `/grilling`)

| # | Decision | Outcome |
|---|---|---|
| Q1 | Scope | Tauri side only. `WasmClientAdapter` stays as-is (stubs belong to candidate 4). |
| Q2 | TauriClient body | Each method body is a direct `invoke('cmd', args)` (one line); the 8 methods that currently wrap `parseJsonResult` keep that wrapper (behavior-preserving). |
| Q3 | 8 non-invoke functions | New module `src/wasm/tauri-platform.ts` owns window control (4), platform detection (3), directory picker (1). |
| Q4 | Data-command merge | The 7 S3/S6 Rust content-parser commands with consumers move **into `CoreClient`** (68 → 75 methods): `parseDateInput`, `normalizeJournalTitle`, `isTodayTitle`, `extractLinksFromContent`, `applyRelationshipTypeToBlockContent`, `calculateNextRecurrence`, `checkHasTypedLinkToTarget`. `WasmClientAdapter` gains matching stubs (existing throw/empty style). |
| Q5 | `get_templates` | Backend gains a thin `get_templates` command (forwards `TemplateService::get_all`), registered in `lib.rs`. Fixes the live Tauri IPC error. |
| Q6 | Sync/connection | The ~6 sync functions (`getSyncStatus`, `getSyncStatusPC`, `connectToServer`, `disconnectSync`, `triggerFullSyncMobile`, `autoReconnect`) go to `tauri-platform.ts` — sync is Tauri-specific (web has no sync peer), avoiding wasm stubs. |
| Q7 | Tests | The 5 test files that `vi.mock('../wasm/tauri-client')` retarget their mocks (window/sync → `tauri-platform.ts`; parser → `client.ts`). No new TauriClient unit tests — the deletion itself is the test (pure forwarding layers vanish). |
| Q8 | Dead CoreClient methods | All 68 existing `CoreClient` methods are kept; auditing them is a follow-up (cost of per-method consumer tracing). |
| Q9 | 35 unreferenced functions | 7 parser commands → `CoreClient` (above); 11 with consumers → `tauri-platform.ts` (window 4 + directory 1 + sync 6); 17 with **zero consumers are deleted** (pure dead code — backend commands untouched). |
| Q10 | Dead-function deletion | Delete the 17 zero-consumer `tauri*` functions outright. No behavior change (nothing calls them); backend command cleanup registered as follow-up. |

### Target layout

```
src/wasm/
  client.ts          CoreClient (75) + TauriClient (direct invoke) + WasmClientAdapter (unchanged)
  tauri-platform.ts  NEW: window (4) + platform detect (3) + directory (1) + sync (6) ≈ 14 fns + SyncStatus etc.
  tauri-client.ts    DELETED (68 absorbed + 7 into CoreClient + 11 into platform + 17 deleted)
  types.ts           TauriGraphEdgeRecord and other types moved here
  index.ts           re-export adjusted (tauri-client → tauri-platform)
```

- **15 bypass sites rewired**: parser commands → `getCoreClient().parseDateInput(...)` etc.; window/sync → import `tauri-platform`; graph snapshot → `getCoreClient().buildGraphSnapshot()` (already on the interface).
- **Backend**: thin `get_templates` in `commands.rs` + registration in `lib.rs`.

### Considered options (rejections worth remembering)

- **Also collapse the wasm adapter now** — rejected: that is candidate 4's territory (its problem statement is wasm behavior, not transport duplication). Scope stays crisp.
- **Keep `tauri-client.ts` as the platform module** — rejected: its name says "tauri client" while the module would now hold platform capabilities; a renamed honest module (`tauri-platform.ts`) makes the boundary readable, and `client.ts` stops re-exporting platform functions.
- **Retain the 17 dead functions** — rejected: zero consumers, pure dead code; moving them to the new module would be "moving dead people into a new house", violating the simplicity rule. Deletion is the deletion-test outcome.
- **Unify error handling through a private `invoke` helper** — rejected for now: the current error flow is caller-owned; adding a wrapper would change error shapes. If uniform error formatting is wanted later, it is a small follow-up.
- **Fold sync status into `CoreClient`** — rejected: web has no sync, so wasm would carry 6 meaningless stubs; sync is a platform capability.
- **Audit the 68 `CoreClient` methods for dead ones now** — rejected: per-method consumer tracing across the store layer is a real cost; candidate 3's core win is the forwarding-layer deletion, not dead-method cleanup.

## Consequences

**Positive**
- **~800 lines of pass-through code deleted** (103 functions + the class forwards) — the six-layer chain collapses to interface + one implementation + one platform module.
- **New command touches 2 modules** (Rust `commands.rs` + `client.ts` interface & Tauri impl) instead of 5.
- `CoreClient` becomes the complete business-data surface — bypass sites stop existing for data commands.
- `get_templates` bug fixed (Tauri template loading stops IPC-erroring).
- Leverage: 75 methods implemented once in `TauriClient`; wasm implements the same interface (candidate 4 converges it later).

**Negative / Risk**
- **20+ files touched** by the rewire (15 bypass sites + 5 test mocks + `index.ts` + new module) — the same "one change touches many files" cost we are removing, paid once. Mitigated by typecheck + the retargeted vitest mocks.
- 17 dead functions removed: if a future feature wants them, the backend commands still exist (frontend wrapper is trivial to re-add).
- `WasmClientAdapter` gains 7 stubs for the parser commands (they have no wasm implementation); behavior on web is unchanged (they were never callable there — `invoke` without Tauri throws).

## Follow-ups (not in this change)

1. Backend dead-command cleanup (`renumber_blocks`, `build_document_order`, and any command orphaned by the 17 deleted wrappers).
2. Audit of the 68 pre-existing `CoreClient` methods for dead ones.
3. Candidate 4: converge `WasmClientAdapter` with `TauriClient` (stub count → 0).
4. Optional uniform error handling in `TauriClient` (private `invoke` helper).

## Acceptance gate

- `npm run typecheck` (or the repo's equivalent) — clean.
- Existing vitest suite green after the 5 mock retargets (no new tests required).
- Backend: `cargo check -p comind` — clean (thin `get_templates`).
- Manual spot-check: Tauri build template loading works (`get_templates` no longer errors).
