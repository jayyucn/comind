# ADR-0021: Converge the WASM adapter with the Tauri adapter

- **Status:** Accepted (2026-08-20)
- **Deciders:** jay
- **Related:** candidate 4 in `docs/architecture-deepening-backlog.md`; candidate 1 (`ADR-0018`, sqljs implements every repository trait) and candidate 2 (`ADR-0019`, shared write orchestration) are its foundations; candidate 3 (`ADR-0020`) shares the "adapter is the seam" idea.

## Context

`WasmClientAdapter` (`src/wasm/client.ts` L411–755) implements `CoreClient` for the web build. Unlike `TauriClient` — a transport-only forwarder — the wasm adapter carries **TypeScript re-implementations of logic that Rust already owns**, in three places:

1. **BlockVersion path** (6 methods, L601–631) → `web-version-storage.ts` (106 lines, Dexie/IndexedDB). The same versioning logic exists in Rust: `BlockVersionRepository` implemented for `SqlJsAdapter` (`storage/sqljs.rs` L1138) and `BlockVersionService` (`services/block_version_service.rs`, full CRUD + restore + cleanup).
2. **Notification path** (12 methods, L633–679) → `web-notification-storage.ts` (139 lines, Dexie/IndexedDB). `NotificationRepository` for `SqlJsAdapter` already exists (`sqljs.rs` L656) with **identical semantics** — `delete_older_than` also keeps `dismissed` rows as dedup anchors.
3. **`ensureTodayIdeasPage`** (L524–538, ~15 lines) re-implements the idempotent today-page logic in TS; the authoritative implementation is `PageService::ensure_today_ideas_page` (`page_service.rs` L59), a generic `StorageAdapter` service shared by Tauri.

Plus two dead-code artifacts:

- **`getOutlinks`** (L554–560) probes `typeof wasm.get_outlinks === 'function'` via `as any` — but the wasm command has existed since before this session (`comind-wasm/src/lib.rs` L339, typed in `wasm-client.ts` L20). The probe is historical dead code.
- **`getIdeasMonths`** (L512–522) derives months from `get_all_pages` because the wasm command is missing — the Rust side has no command for it.

**Measured facts** (2026-08-20, baseline `42e66c2` = remote main after #44):
- `comind-wasm/src/lib.rs` exposes **24 commands**; the Tauri side has the full set — `ensure_today_ideas_page`, block_version (create/get_by_id/list/restore/cleanup/delete), notification (get/get_by_block/query_unread/query_recent/create/batch_create/update_status/update_payload/set_snooze/delete/cleanup/mark_all_read) are **not exported to wasm**.
- **`chrono` enables the `wasmbind` feature** for the wasm target (`comind-core/Cargo.toml` L26) — `chrono::Local` in wasm reads the browser's local timezone. The "wasm timezone bug, see ADR 0001" comment in `client.ts` L526 is **stale** (no ADR 0001 exists; `docs/adr/` starts at 0007).
- The two Dexie databases (`comind-block-versions`, `comind-notifications`) have **no web-side creator path for notifications** (`checkAndFire`/`syncPayloadForBlock` are no-ops on wasm; nothing else calls `createNotification`) — the notification table is always empty on web. BlockVersion, by contrast, is written on web too (`stores/blockVersion.ts` has no environment guard).
- The web database is already persistent: `SqlJsAdapter` serializes the whole DB to `localStorage` (`comind:sqljs-database`), so moving these tables to sqljs keeps them persistent.
- `dexie` stays as a dependency (`src/utils/asset.ts` uses it); `fake-indexeddb` stays (other tests use it). The two `web-*-storage.ts` files have **zero test references**.

## Decision

Make the wasm path use the same Rust logic as Tauri: expose the missing commands from `comind-wasm`, point `WasmClientAdapter` at them, and delete the TS re-implementations. The adapter then differs from Tauri only in transport.

### Q1–Q7 decisions (from `/grilling`)

| # | Decision | Outcome |
|---|---|---|
| Q1 | Offline IndexedDB | Not needed. Web persistence is already `localStorage` via `SqlJsAdapter`; IndexedDB is a redundant parallel layer. Both Dexie files are deleted. |
| Q2 | `ensureTodayIdeasPage` reuse | Reuse the shared `PageService::ensure_today_ideas_page` (generic `StorageAdapter` service; `chrono` `wasmbind` makes `chrono::Local` correct in wasm — the stale timezone comment is removed). The TS re-implementation is deleted. |
| Q3 | Notification storage migration | Migrate it. Web has no notification-creation path (table always empty), so behavior is equivalent after the move; the adapter stops being a lie. |
| Q4 | Existing Dexie data | Not migrated; loss accepted. Dexie data is web dev/preview-only (production data lives in Tauri's SQLite). Recorded as a behavior change. |
| Q5 | `getOutlinks` probe | Delete the `as any` runtime probe; call `wasm.get_outlinks` directly (command + type already exist). |
| Q6 | Tests | Native test added in `page_service_test.rs` for `ensure_today_ideas_page` idempotency (two calls → same page; title is `YYYY-MM-DD`, timezone-independent). No new wasm tests: the 19 commands are thin forwards with no logic. The missing `lib_test.rs` (declared in `comind-wasm/src/lib.rs` but never created; wasm-bindgen tests have never run) is a follow-up, not fixed here. |
| Q7 | Acceptance gate | `cargo check -p comind-core --tests` (native, 0 warnings) · `cargo check --target wasm32-unknown-unknown -p comind-wasm` (the 19 new commands compile) · `cargo test -p comind-core --lib` (regression + new ensure_today case) · `npm run typecheck` + `vitest run` (frontend; all affected tests mock `CoreClient` — zero impact). |

### Target layout

```
Rust · crates/comind-wasm/src/lib.rs      +19 thin commands (~250 lines), same shape as Tauri:
  ensure_today_ideas_page                 → PageService::ensure_today_ideas_page(adapter)
  create_block_version / get_block_versions / get_block_version_by_id / restore_block_version /
  cleanup_block_versions / delete_block_version   → BlockVersionService (generic, reused)
  get_notification / get_notifications_by_block / query_unread_notifications / query_recent_notifications /
  create_notification / batch_create_notifications / update_notification_status / update_notification_payload /
  set_notification_snooze / delete_notification / cleanup_notifications / mark_all_notifications_read
                                           → storage.notifications().xxx() (same thin forwards as commands.rs)

TS · src/wasm/wasm-client.ts              +19 methods (~60 lines)
TS · src/wasm/client.ts                   WasmClientAdapter rewired (20 method bodies):
                                           block_version 6 + notification 12 → wasm commands
                                           ensureTodayIdeasPage → wasm command (TS re-impl deleted)
                                           getOutlinks → direct call (probe deleted)
                                           2 Dexie imports removed
DELETED                                    src/wasm/web-version-storage.ts (106 lines)
                                           src/wasm/web-notification-storage.ts (139 lines)
KEPT                                       dexie (utils/asset.ts) · fake-indexeddb (other tests)

Rust · comind-core/src/services/page_service_test.rs   + ensure_today_ideas_page idempotency case
```

### Considered options (rejections worth remembering)

- **Keep Dexie for offline IndexedDB** — rejected: web persistence is already `localStorage` (sqljs serializes the whole DB); a second browser store for the same data is a redundant parallel layer with no consumer story.
- **Migrate Dexie rows to sqljs** — rejected: the rows are web dev/preview artifacts, not production data (Tauri's SQLite is the production store); a one-time migration would pay complexity for throwaway data.
- **Keep the TS `ensureTodayIdeasPage`** — rejected: it is exactly the kind of TS re-implementation the candidate exists to delete; the shared service is generic and the stale timezone fear is unfounded (`wasmbind`).
- **Fix the wasm test infrastructure now (`lib_test.rs`)** — rejected: `wasm-bindgen-test` has never run in this repo (the module file was never created); that is an infrastructure repair, not part of storage convergence. Registered as follow-up.
- **Also add a `get_templates` wasm command** — rejected for now: wasm template loading works via the `execute_batch` op path; the thin command is a nice cleanup but belongs to candidate 3's implementation, not candidate 4's storage convergence.

## Consequences

**Positive**
- **245 lines of Dexie parallel implementation deleted** (106 + 139); `BlockVersion`/`Notification` on web now read the same sqljs repository as every other entity — one storage, one set of semantics.
- **Idempotent today-page logic lives once** (Rust); the TS re-implementation and its stale "timezone bug / ADR 0001" comment are gone.
- `getOutlinks` loses its `as any` runtime probe (dead code that silently hid the real command).
- The wasm adapter becomes honest: it differs from Tauri only in transport, not in behavior or logic.

**Negative / Risk**
- **Web BlockVersion history loss**: Dexie rows (dev/preview data) stop being read. Accepted (Q4); documented as a behavior change.
- **+19 wasm commands** add ~250 Rust lines; each is a thin forward (same shape as `commands.rs`), no logic duplication.
- `SqlJsAdapter` persists the whole DB to `localStorage` (capacity ~5–10 MB); adding BlockVersion/Notification tables grows the blob. Pre-existing constraint, recorded as a follow-up risk.

## Follow-ups (not in this change)

1. **wasm test infrastructure**: `lib_test.rs` is declared (`comind-wasm/src/lib.rs` L2) but never created; `wasm-bindgen-test` is a dev-dependency but has never run. Repair + at least one smoke test.
2. **Candidate 3 implementation**: ADR-0020 is accepted (docs cherry-picked into this branch so `main` keeps a continuous ADR sequence) but the code (delete `tauri-client.ts`, `tauri-platform.ts`, `TauriClient` direct `invoke`, backend `get_templates`) is **not yet implemented** — `/implement` separately on top of this candidate.
3. `getTemplates` on wasm still goes through the `execute_batch` op hack; a thin wasm command would match Tauri (piggy-back on candidate 3's implementation).
4. `localStorage` capacity: the sqljs blob grows with every table; watch for a future move to IndexedDB-backed persistence (the opposite of today's Dexie removal — a transport, not a logic, decision).

## Acceptance gate

- `cargo check -p comind-core --tests` — native, 0 warnings.
- `cargo check --target wasm32-unknown-unknown -p comind-wasm` — the 19 new commands compile.
- `cargo test -p comind-core --lib` — regression green + new `ensure_today_ideas_page` idempotency case.
- `npm run typecheck` — clean.
- `vitest run` — green (affected tests mock `CoreClient`; no test touches the deleted files).
