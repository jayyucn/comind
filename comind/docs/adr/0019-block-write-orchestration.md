# ADR-0019: Move write-path orchestration behind the Service seam

- **Status:** Accepted (2026-08-19)
- **Deciders:** jay
- **Related:** candidate 2 in `docs/architecture-deepening-backlog.md`; ADR-0018 (repository convergence, its foundation)

## Context

The block write path — saving a block tree, deleting a block, deleting a page cascade — is orchestrated **inside the IPC layer**, not in a service module:

1. `src-tauri/src/commands.rs` `save_block_tree` (L573–673) and `delete_block` (L675–736) carry the full orchestration: upsert via `BlockService`, snapshot build, render-segment build, Link/Property/Notification collection for sync, page touch, and (outside the transaction) a `tokio::spawn` of `record_and_notify`.
2. `crates/comind-wasm/src/lib.rs` `save_block_tree` (L116–172) **re-implements the same orchestration** and has already drifted: no transaction, no sync collection, no page touch, no notification — and `snapshot: String::new()` silently discards the snapshot. `delete_page_cascade` (L254–272) partially copies the delete orchestration.
3. The orchestration is **untestable**: it lives in Tauri command bodies that depend on `State`/DB pool; there is no pure-Rust test exercising the whole save/delete chain.
4. 44 direct storage-repository accesses bypass the service layer in `commands.rs` (Notification 17, Block 7, Property 5, RelationshipType/Template 3 each, BlockVersion 2, Page 3, Link 1, DateRef 1). Only 4 commands wrap writes in a transaction (`save_block_tree`, `delete_block`, `delete_page_cascade` L810, `execute_batch` L1055) — transaction boundaries are hand-managed at each call site.

ADR-0018 (repository convergence) delivered the foundation: storage is collapsed onto shared per-entity modules behind an `Executor` trait, and `Transaction`/`Connection` differ only by executor. The service layer (`BlockService` etc.) is platform-agnostic — it reaches storage through `&mut dyn StorageAdapter` trait objects, so the same services compile for both native and wasm.

## Decision

Extract the write-path orchestration into a new deep module `BlockWriteService` in `comind-core` (`crates/comind-core/src/services/block_write.rs`), shared by both IPC entry points. The Tauri commands and the wasm lib become thin adapters: parse input, call the orchestration, spawn the async notification after commit.

### Q1–Q19 decisions (from `/grilling`)

| # | Decision | Outcome |
|---|---|---|
| Q1 | Home | New deep module `BlockWriteService`; save and delete orchestration co-located. Not an extension of `BlockService` (would grow it into a god service — the orchestration crosses 7 entities + sync). |
| Q2 | Scope | Only the three write-path commands (`save_block_tree`, `delete_block`, `delete_page_cascade`). The remaining ~30 direct storage accesses (queries, notification writes) are tracked as follow-ups, not cleaned here. |
| Q3 | wasm alignment | wasm calls the **same** orchestration functions. Side effects are aligned: real snapshot build, real render segments, page touch. Sync/notification are no-ops on web (no sync server) — `sync_changes` is dropped by the wasm adapter. |
| Q4 | Transaction | The orchestration functions own the transaction (`adapter.transaction(|storage| …)`), so any caller (IPC command, future batch op, service) gets atomicity for free. |
| Q5 | Snapshot | Still **not** auto-persisted (that would change behavior — versions are only written by the manual `create_block_version`). The orchestration uniformly builds a real snapshot string; wasm no longer returns `String::new()`. |
| Q6 | Notification boundary | The orchestration returns `sync_changes: HashMap<SyncTable, Vec<String>>` (core already owns `SyncTable` in `sync/message.rs`); the command layer spawns `record_and_notify` after commit. core stays synchronous with no tokio dependency. |
| Q7 | wasm transaction | `SqlJsAdapter` already implements `TransactionalStorageAdapter` but as a pass-through no-op. Keep the no-op (behavior-preserving; single-threaded in-memory DB, no concurrency). Wiring real sql.js `BEGIN/COMMIT` is a follow-up. |
| Q8/Q14 | Delete orchestration | Two public functions sharing one single-block delete skeleton: `delete_block_cascade(adapter, block_id)` and `delete_page_cascade(adapter, page_id)` (loops the skeleton + target-side links + page delete). Naming matches the existing commands. |
| Q9 | Module | `crates/comind-core/src/services/block_write.rs`, exporting `BlockWriteService` (a module, matching the services/ naming convention). |
| Q10 | Tests | In-memory full-chain tests for save and delete orchestration, **including a rollback case** (mid-orchestration failure leaves no partial writes). `SQLiteAdapter` already implements `TransactionalStorageAdapter`, so tests drive the real adapter. |
| Q11 | Save input | Commands parse `serde_json::Value` → `Vec<Block>`; orchestration receives structured `Block`s, never frontend JSON. |
| Q12 | Call levels | Orchestration calls services (`BlockService`, `LinkService`, `PropertyService`, `PageService`, `BlockVersionService`), reusing the derivation logic already inside `BlockService::create/update` (dateRef/link/property sync). The two remaining direct accesses become thin service forwards: `NotificationService::get_by_block_id`, `BlockVersionService::delete_by_block_id` (both currently missing). |
| Q19 | Failure tolerance | Snapshot/segment build failures keep `.unwrap_or_default()` (empty string / empty list) — failing must not abort the save. Behavior preserved. |

### Interface sketch

```rust
// crates/comind-core/src/services/block_write.rs
pub struct SaveOutcome {
    pub results: Vec<BlockSaveResult>,                    // block + snapshot + render_segments
    pub sync_changes: HashMap<SyncTable, Vec<String>>,
}

pub fn save_blocks(
    adapter: &mut dyn TransactionalStorageAdapter,
    blocks: Vec<Block>,
) -> Result<SaveOutcome, Box<dyn Error>>;                // owns adapter.transaction(…)

pub fn delete_block_cascade(
    adapter: &mut dyn TransactionalStorageAdapter,
    block_id: &str,
) -> Result<HashMap<SyncTable, Vec<String>>, Box<dyn Error>>;

pub fn delete_page_cascade(
    adapter: &mut dyn TransactionalStorageAdapter,
    page_id: &str,
) -> Result<HashMap<SyncTable, Vec<String>>, Box<dyn Error>>;
```

### Considered options (rejections worth remembering)

- **Extend `BlockService` instead of a new module** — rejected: the orchestration spans Block/BlockVersion/Link/Property/Page/Notification/sync; hanging it on `BlockService` would turn a focused service into a god service. The new module is the deep module: narrow interface (3 functions), large behavior (the whole write path).
- **Full cleanup of all 44 direct accesses** — rejected: most are reads/notifications unrelated to orchestration; bundling them doubles the blast radius. They are registered as follow-ups.
- **Keep wasm's lean variant (dedupe only, no behavior alignment)** — rejected: the two orchestration copies have *already* drifted (wasm silently missing sync/touch/notification/snapshot). Sharing one orchestration makes the divergence explicit (web no-ops) instead of accidental.
- **Orchestration spawns notifications itself** — rejected: would drag tokio into `comind-core`. Returning `sync_changes` keeps core synchronous; the IPC layer decides the async.
- **Real sql.js `BEGIN/COMMIT` now** — rejected for this change: wasm is single-threaded over an in-memory DB (no concurrency), and the no-op keeps behavior identical. Follow-up if atomicity on web matters.
- **Snapshot auto-persistence on save** — rejected for this change: it is a user-visible behavior change (every save would create version history). Tracked separately.
- **Single `delete_tree(adapter, target)` entry** — rejected: two public functions match the two existing commands and keep call sites obvious; "unification" means the shared skeleton, not a forced single entry.

## Consequences

**Positive**
- The write path is **testable for the first time**: save + delete orchestration covered by in-memory full-chain tests including a rollback case (the transaction boundary the orchestration owns).
- **One source of truth** for save/delete side effects: wasm and native call the same functions; a new save side effect is written once. The existing wasm drift (no transaction, no touch, no sync, no snapshot) is eliminated by alignment, and web-only no-ops (sync/notification) are explicit.
- Transaction boundaries travel with the orchestration — future callers cannot "forget" the transaction.
- wasm users get real snapshot + render segments back (fixes the wasm-side version-history input that `BlockVersionStore.scheduleVersion()` consumes).

**Negative / Risk**
- **Regression risk on the hottest path**: save is the most frequent write; moving the orchestration must preserve upsert semantics, page-touch, tolerance, and notification timing. Mitigated by the new chain tests + the existing acceptance gates.
- **Behavior change on wasm only**: wasm now also page-touches (`updated_at` changes) and builds real snapshots/segments — intended alignment (Q3/Q5), but a change from today's wasm behavior.
- `NotificationService::get_by_block_id` and `BlockVersionService::delete_by_block_id` need to be added as thin forwards.
- wasm transaction stays a no-op — a known, documented gap (follow-up).

## Follow-ups (not in this change)

1. Remaining ~30 direct storage accesses in `commands.rs` (queries, notification writes).
2. Real sql.js `BEGIN/COMMIT` in the wasm `TransactionalStorageAdapter`.
3. Snapshot auto-persistence on save (separate product decision).
4. `execute_batch` and `save_page` orchestration (currently thin; revisit if they grow).

## Acceptance gate

- Native `cargo check -p comind-core --tests` — 0 warnings.
- wasm `cargo check --target wasm32-unknown-unknown -p comind-core` — clean.
- `cargo test -p comind-core --lib` — 137 existing + new orchestration tests pass; the 4 pre-existing failures (`services::block_service_test::test_build_tree`, `services::render_segment_service_test::test_chinese_content_char_offsets`, `services::render_segment_service_test::test_link_to_nonexistent_page_skipped`, `sync::engine::tests::test_full_sync_export_empty`) unchanged & unrelated.
