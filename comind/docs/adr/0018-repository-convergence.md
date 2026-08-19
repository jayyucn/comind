# ADR-0018: Collapse the triple-written Repository implementations

- **Status:** Accepted (2026-08-18)
- **Deciders:** jay
- **Related:** candidate 1 in `docs/architecture-deepening-backlog.md`; ADR-0017 (App composition extraction)

## Context

`comind-core` persists the same domain model through **three** near-identical code paths:

1. `SQLiteAdapter` (`crates/comind-core/src/storage/sqlite.rs` L445–2535) — native rusqlite, normal path.
2. `SQLiteTransactionAdapter` (`crates/comind-core/src/storage/sqlite.rs` L2549–4643) — native rusqlite, transaction path. Its repo-method bodies are near-verbatim copies of (1); only the executor (`&Connection` vs `&Transaction`) differs — `BEGIN`/`COMMIT` live inside `transaction()`.
3. `SqlJsAdapter` (`crates/comind-core/src/storage/sqljs.rs`) — browser/wasm sql.js, a third independent implementation.

`repository.rs` declares **13 sub-traits / ~103 methods**. Total pure duplication ≈ **2,000 lines**.

Two concrete defects this creates:

- **Column-order drift (latent bug).** Native adapters read rows **by position** (`row.get(0)`, typed). sql.js reads **by name** (`row.get("id")`) from a `HashMap<String, String>` and `.parse()`s every value. The SELECT column lists of the two engines have already diverged; by-name reading hides it today, but it is a live "drift 温床".
- **Maintenance tax.** Any schema/field change must be made in 3 places; the two rusqlite copies are the easiest to let drift.

## Decision

Converge all three paths onto **shared, per-entity definition modules** under `crates/comind-core/src/storage/entity/<entity>.rs`.

1. **(Q1) Shared SQL + mapping module.** One module per entity owns the canonical column list `COLS`, the SELECT column string, the INSERT column string + bind order, and the row→struct mapping. The ~2,000 lines of duplication collapse because both rusqlite adapters delegate to the same free functions.
2. **(Q2) One file per entity** (`entity/date_ref.rs`, `block.rs`, …) rather than one global query file — keeps locality and diffs small.
3. **(Q3) Eliminate `SQLiteTransactionAdapter` as a standalone struct.** Introduce an `Executor` trait implemented by both `&Connection` and `&Transaction` (`last_insert_rowid`, `execute`, `query_map`). Every repo method body becomes a free function `fn date_ref_create(exec: &dyn Executor, d: &DateRef)`. `SQLiteAdapter` calls with `&self.conn`; `transaction()` spins `BEGIN`, runs the closure against a `TxContext` whose methods call the same free functions on the `&Transaction`, then `COMMIT`/`ROLLBACK`. The struct is deleted once **all** entities are migrated (during rollout it stays as a thin delegator for not-yet-migrated entities).
4. **(Q4b) sql.js also converges to the shared column order.** `COLS` is the single source of truth for column **names + order**. Both adapters derive their SELECT/INSERT column lists from `COLS`. sql.js's `row_to_*` iterates `COLS` **in order** (looking each column up by name in its `HashMap`), so it is positionally aligned with the native `row.get(i)` and the two engines are isomorphic under one ordering. Column-order drift becomes structurally impossible.
   - *Note:* rusqlite also supports by-name `row.get("col")`. We deliberately keep the native side **positional** to match Q4b (sql.js by-position/isomorphic). Switching both to by-name later is a small, optional follow-up — out of scope here.
5. **(Q5) Testing, phased.** (a) Pure `row_to_*` / param builders unit-tested directly. (b) Native sqlite round-trip tests (insert → select → assert) on a real in-memory `Connection`. (c) sql.js tested best-effort in its wasm/jsdom harness.
6. **(Q6) Scope, phased.** Pilot **one** entity end-to-end (sqlite + sqljs + tx) to prove the pattern, then roll out entity-by-entity.

### Round 2 — pilot contract

- **(Q7) Pilot entity = DateRef.** Leaf entity, fewest callers, smallest blast radius; exercises `create` / `get_by_block_id` / `query_by_date_range` / `query_overdue` / `query_due_non_recurring` / `create_many` / `delete` / `delete_by_block_id`. Current sites: `sqlite.rs` `SQLiteAdapter` impl L2046 (INSERT L2224), `SQLiteTransactionAdapter` INSERT L4300; `sqljs.rs` `row_to_date_ref` L460, impl L932 (methods L946/961/971/987).
- **(Q8) Module API = explicit pure functions + `COLS` const** (no macros, no trait-object mapping):
  ```rust
  pub const DATE_REF_COLS: &[Col] = &[ Col{name:"id",..}, /* … 12 cols … */ ];
  pub fn date_ref_select_cols() -> String { /* join COLS names */ }
  pub fn row_to_date_ref_native(row: &rusqlite::Row) -> Result<DateRef, …> { /* get(i) in COLS order */ }
  pub fn row_to_date_ref_js(row: &HashMap<String,String>) -> DateRef { /* lookup by COLS name, parse */ }
  pub fn date_ref_insert_sql() -> &'static str { /* from COLS */ }
  pub fn date_ref_params(d: &DateRef) -> Vec<Param> { /* from COLS order */ }
  ```
- **(Q9) TxExecutor = shared free functions behind an `Executor` trait** (option a). `SQLiteTransactionAdapter` is removed at rollout end; during pilot its `DateRef` methods delegate to the shared fns.
- **(Q10) Acceptance gate.** Pilot merged only when: DateRef shared across all three contexts; native sqlite round-trip tests green; sql.js best-effort green; drift structurally impossible; existing `cargo test` + frontend integration tests green; code review passed. Rollout order: DateRef → Block → Page → Link → Property → RelationshipType → Template → Search → BlockVersion → Notification → SavedFilter → ScreenView → NotificationConfig.

## Consequences

**Positive**
- ~2,000 lines of pure duplication removed (mostly the rusqlite adapter pair).
- Column-order drift eliminated by construction (single `COLS` source of truth).
- Locality: a field change touches one module, not three files.
- `transaction()` boundary semantics unified; the standalone tx adapter struct disappears at rollout end.

**Negative / Risk**
- sql.js extraction code is **not** literally shared with rusqlite (typed `Row` vs `HashMap<String,String>`), so sql.js keeps its own `row_to_*` — but it is now **driven by `COLS` order**, so drift is gone; only the value-coercion lines remain duplicated.
- `Executor` trait adds a small indirection. **Implementation note (post-pilot):** because the trait's `query_map<T, F>` carries a generic `F`, the trait is *not* dyn-compatible, so we do **not** use `&dyn Executor`. Instead the repo free functions are generic over `E: Executor` (`fn date_ref_get_all<E: Executor>(exec: &E)`). This keeps zero-cost monomorphization and sidesteps the `Row`-lifetime / dyn-compatibility issue entirely.
- The standalone `SQLiteTransactionAdapter` cannot be deleted until **all 13** entities are migrated; until then it stays as a thin delegator.

## Pilot scope (this change)

Migrate **DateRef only**: create `storage/entity/date_ref.rs`; rewire `SQLiteAdapter::DateRefRepository`, `SqlJsAdapter::DateRefRepository`, and `SQLiteTransactionAdapter::DateRefRepository` to the shared module; add `Executor` trait + `TxContext`; add unit + native round-trip tests. Other entities untouched.

## Pilot landing record (2026-08-18)

Implemented on branch `refactor-repository-convergence`.

**Files**
- `crates/comind-core/src/storage/entity/date_ref.rs` (new) — `DATE_REF_COLS` const, `date_ref_select_cols()`, `date_ref_insert_sql()`, `row_to_date_ref_native()` (native, by-position), `row_to_date_ref_js()` (sql.js, by-name), and 12 free functions `date_ref_*` generic over `E: Executor`. Unit test `row_to_date_ref_js_roundtrip`.
- `crates/comind-core/src/storage/executor.rs` (new) — `Executor` trait (`execute` + `query_map`) implemented for `rusqlite::Connection` and `rusqlite::Transaction`. Gated `#[cfg(not(wasm32))]`.
- `crates/comind-core/src/storage/entity/mod.rs` (new) — `pub mod date_ref;`
- `crates/comind-core/src/storage/mod.rs` — added `pub mod entity;` (always) and `pub mod executor;` (`cfg(not wasm32)`) + re-exports.
- `crates/comind-core/src/storage/sqlite.rs` — `SQLiteAdapter` and `SQLiteTransactionAdapter` `DateRefRepository` impls now delegate to the shared free functions; import added.
- `crates/comind-core/src/storage/sqljs.rs` — `SqlJsAdapter::DateRefRepository` now SELECTs via `date_ref_select_cols()` and maps via `row_to_date_ref_js`; the dead `row_to_date_ref` fn removed.

**Q4b confirmation (column-order drift fixed).** Measured pre-pilot drift: native `get_all` SELECT order was `…created_at, event_ts…` while sql.js emitted `…event_ts, updated_at, version, deleted_at, created_at` (created_at LAST). Both now derive SELECT columns from the single `DATE_REF_COLS` (`…created_at, event_ts, updated_at, version, deleted_at`), so the two engines are positionally aligned under one ordering. Drift is structurally impossible.

## Pilot landing record — Block (2026-08-19)

Implemented on branch `refactor-repository-convergence` (commit `3c14506`, on top of DateRef `08eaa45` → icon commit `626c8395`). Net −106 lines (281 ins / 387 del) across 4 files.

**Files**
- `crates/comind-core/src/storage/entity/block.rs` (new, 227 lines) — `BLOCK_COLS` const (11 cols, matches `row_to_block_native` positional indices), `block_select_cols()`, `block_insert_sql()`, `row_to_block_native()` (by-position), `row_to_block_js()` (by-name; preserves sql.js semantics: `parent_id` empty→`None`, `format` default `"{}"`, `type` default `"bullet"`), `block_params()`, and 11 free functions (`block_get_all / get_by_id / get_by_page_id / get_children / get_by_ids / insert / update / soft_delete_by_id / ids_by_page_id / soft_delete_by_page_id`) generic over `E: Executor`. Unit tests `row_to_block_js_roundtrip` + `row_to_block_js_parent_id_some`.
- `crates/comind-core/src/storage/entity/mod.rs` — added `pub mod block;`
- `crates/comind-core/src/storage/sqlite.rs` — native `SQLiteAdapter` and transaction `SQLiteTransactionAdapter` `BlockRepository` impls now delegate to the shared free functions. Block-table SQL is shared; the **SearchIndex side-effect** (`update_search_index` + `DELETE FROM SearchIndex`) stays in the adapter because it touches `Page`/`SearchIndex` (adapter-local state), so `create`/`update` call `block_insert`/`block_update` then `self.update_search_index(block)`, and `delete`/`delete_by_page_id` call the shared soft-delete fns then clean `SearchIndex`.
- `crates/comind-core/src/storage/sqljs.rs` — `SqlJsAdapter::BlockRepository` SELECTs via `block_select_cols()` and maps via `row_to_block_js` (Q4b fix). **Behavior-preserving divergence kept on purpose:** sql.js INSERT/UPDATE/DELETE SQL is unchanged (it emits `deleted_at = NULL` literally in INSERT and rewrites `parent_id` empty→`""` in `create`/`update`), so sql.js behavior is identical to before. The dead `row_to_block` fn was removed (superseded by `row_to_block_js`).

**Q4b confirmation (Block).** Measured pre-pilot drift: native Block SELECT order was `id, page_id, parent_id, pos, content, format, type, created_at, updated_at, version, deleted_at`, while sql.js emitted `…version, deleted_at, created_at, updated_at` (trailing order differs). Now both derive the SELECT column list from the single `BLOCK_COLS` (`…created_at, updated_at, version, deleted_at`); `row_to_block_js` reads by name, so the positional difference is inert and drift is structurally impossible.

**Verification.** `cargo check -p comind-core --tests` (native) ✅ 0 warnings; `cargo check --target wasm32-unknown-unknown -p comind-core` (sql.js path) ✅. `cargo test --lib`: **118 passed** (incl. 2 new block-js roundtrip tests), **4 pre-existing failures unchanged & unrelated** (`services::block_service_test::test_build_tree`, `services::render_segment_service_test::test_chinese_content_char_offsets`, `services::render_segment_service_test::test_link_to_nonexistent_page_skipped`, `sync::engine::tests::test_full_sync_export_empty`) — identical set to the DateRef baseline, so the Block change introduced zero new failures.

**One transparency note (intentional WHERE/INSERT-level divergence preserved).** To avoid changing sql.js observable behavior, the shared `block_*` fns drive only the **Block-table** SQL; sql.js keeps its own INSERT/UPDATE/DELETE text (the `deleted_at = NULL` literal + `parent_id` empty fallback). Native + transaction share the Block-table SQL exactly. Aligning the sql.js INSERT text to the native param style is a separate, optional cleanup left for later.

**Deliberate, documented divergence preserved (WHERE clause).** The native `query_due_non_recurring` / `query_all_recurring` include a `kind != 'ref'` predicate; the pre-pilot sql.js versions omitted it. The pilot kept sql.js's original WHERE clauses unchanged (so sql.js behavior is untouched) while unifying only the SELECT column order. This leaves a known WHERE-level divergence between native and sql.js for these two queries; it can be reconciled in a later phase if desired. **No behavior change for either engine vs pre-pilot.**

**Tests**
- `cargo check -p comind-core --tests` (native) — green, 0 warnings.
- `cargo check --target wasm32-unknown-unknown -p comind-core` (sql.js path) — green.
- `cargo test -p comind-core --lib` — 116 pass. 4 failures are **pre-existing and unrelated** to this change: `services::block_service_test::test_build_tree`, `services::render_segment_service_test::test_chinese_content_char_offsets` (offsets come from content parsing via `DateRefService::extract_date_refs`, not the storage layer), `services::render_segment_service_test::test_link_to_nonexistent_page_skipped` (FK-constraint test setup), `sync::engine::tests::test_full_sync_export_empty`. None touch `storage/`.

## Pilot landing record — Page (2026-08-19)

Implemented on branch `refactor-repository-convergence`, on top of DateRef (`08eaa45`) + Block (`3c14506`) + ADR (`b8be714`). The review gate (Q10a) is intentionally skipped per jay's go-ahead — entities roll out one-by-one without a per-entity merge gate; this commit feeds the already-open convergence PR.

**Files**
- `crates/comind-core/src/storage/entity/page.rs` (new, 283 lines) — `PAGE_COLS` const (15 cols, canonical order = native positional order, matches `row_to_page_native` indices), `page_select_cols()`, `page_insert_sql()`, `page_update_sql()`, `row_to_page_native()` (by-position), `row_to_page_js()` (by-name; preserves sql.js semantics: empty-string→`None` for `block_id`/`icon`/`cover`/`file_path`, numeric defaults `0`, `deleted` default `0`), `page_params()` + `page_update_params()`, and 11 free functions (`page_get_by_id / get_by_title_including_deleted / get_by_title / get_all / get_trash / get_by_ids / get_ideas_by_month / get_ideas_months / create / update / delete`) generic over `E: Executor`. Unit tests `row_to_page_js_roundtrip` + `row_to_page_js_block_id_some`.
- `crates/comind-core/src/storage/entity/mod.rs` — added `pub mod page;`
- `crates/comind-core/src/storage/sqlite.rs` — native `SQLiteAdapter` and transaction `SQLiteTransactionAdapter` `PageRepository` impls now delegate to the shared free functions (each method body collapsed to a 1-line call with `&self.conn`). **Unlike Block, Page has no `SearchIndex` side-effect**, so `create`/`update`/`delete` delegate fully with no adapter-local cleanup.
- `crates/comind-core/src/storage/sqljs.rs` — `SqlJsAdapter::PageRepository` SELECTs via `page_select_cols()` and maps via `row_to_page_js` (Q4b fix). The dead `row_to_page` fn was removed (superseded by `row_to_page_js`). **Behavior-preserving divergence kept on purpose:** sql.js INSERT/UPDATE/DELETE SQL is unchanged (its column order differs from native and it forces `deleted_at = NULL` in INSERT, rewriting empty fields to `""`), so sql.js behavior is identical to before.

**Q4b confirmation (Page).** Native and wasm `Page` tables have the **same 15 physical columns**, but the pre-pilot SELECT column **order** differed (native: `…deleted, created_at, updated_at, version, deleted_at`; wasm: `…deleted, version, deleted_at, created_at, updated_at`). Both now derive the SELECT column list from the single `PAGE_COLS`; `row_to_page_js` reads by name, so the positional difference is inert and drift is structurally impossible.

**Deletion-semantics unification (intentional, behavior-preserving).** Pre-pilot, native `get_by_id` / `get_by_ids` filtered only on `deleted_at IS NULL`, while wasm (and native `get_all` / `get_by_title` / `get_ideas_*`) filtered on `deleted = 0 AND deleted_at IS NULL`. The shared fns now use `deleted = 0 AND deleted_at IS NULL` uniformly. This is safe because `delete` always sets **both** `deleted = 1` and `deleted_at` together, so a row with `deleted_at IS NULL` necessarily has `deleted = 0`; no real query result changes.

**Verification.** `cargo check -p comind-core --tests` (native) ✅ 0 warnings; `cargo check --target wasm32-unknown-unknown -p comind-core` (sql.js path) ✅. `cargo test -p comind-core --lib`: **120 passed** (incl. 2 new page-js roundtrip tests), **4 pre-existing failures unchanged & unrelated** — identical set to the DateRef/Block baselines (`services::block_service_test::test_build_tree`, `services::render_segment_service_test::test_chinese_content_char_offsets`, `services::render_segment_service_test::test_link_to_nonexistent_page_skipped`, `sync::engine::tests::test_full_sync_export_empty`) — zero new failures introduced.

**Net change.** `page.rs` +283 (new, incl. tests); `sqlite.rs` net ≈ −490 (both Page impls collapsed from ~289→~46 lines each); `sqljs.rs` net ≈ −20. Overall net reduction ≈ **−260 lines** of pure duplication while adding the same convergence guarantee as DateRef/Block.

**Next:** continue Page → Link → Property → RelationshipType → Template → Search → BlockVersion → Notification → SavedFilter → ScreenView → NotificationConfig, each behind the same shared-module + `Executor` pattern. After the last entity lands, delete `SQLiteTransactionAdapter` entirely (Q3a). The convergence PR stays open and accumulates these entity commits for one review.
