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

**Transparency notes (added post-review 2026-08-19).**
- **wasm INSERT rewrite (corrected 2026-08-19).** The sql.js `create` INSERT text was rewritten to derive its column list from `date_ref_select_cols()` (canonical `DATE_REF_COLS` order). The pre-pilot text was **count-broken** (12-column INSERT with 10 bind params against only 9 `?` placeholders, values `9×?, 0, NULL`) and would fail at runtime in wasm; the rewrite fixed the count. **However the initial rewrite also misordered the binds** (kept the old wasm `…lead_minutes, event_ts, created_at, updated_at` order against the canonical `…lead_minutes, created_at, event_ts, updated_at` column order), swapping `created_at` and `event_ts` on every wasm insert — fixed in commit `000f307`. With that correction the inserted values match intent (same 10 bound values in canonical order, literal `0` version, literal NULL `deleted_at`); the earlier "no observable behavior change" claim in this note was wrong and is superseded. This remains the one case where the "keep wasm INSERT/UPDATE/DELETE text as-is" rule was not followed; the corrected form is kept because the old was broken.
- **`get_all` error semantics.** Pre-pilot native `get_all` used `rows.filter_map(Result::ok).collect()` (row errors silently dropped); the shared `date_ref_get_all` propagates row errors (`query_map(...).map_err(bx)`). Accepted as intentional hardening — no silent data loss.

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

## Pilot landing record — Link (2026-08-19)

Implemented on branch `refactor-repository-convergence`, on top of DateRef (`08eaa45`) + Block (`3c14506`) + Page (`e948143`) + ADR. The review gate (Q10a) remains intentionally skipped per jay's go-ahead.

**Files**
- `crates/comind-core/src/storage/entity/link.rs` (new, 241 lines) — `LINK_COLS` const (9 cols, canonical order = native positional order = `Link` struct field order), `link_select_cols()`, `link_insert_sql()`, `row_to_link_native()` (by-position), `row_to_link_js()` (by-name; preserves sql.js semantics: `relationship_type` empty→`None`, `deleted_at` parse-fail→`None`), `link_params()`, and 9 free functions (`link_get_by_id / get_by_source_block_id / get_by_source_block_ids / get_by_target_page_id / insert / create_many / delete / delete_by_source_block_id / delete_by_target_page_id`) generic over `E: Executor`. Unit tests `row_to_link_js_roundtrip` + `row_to_link_js_relationship_none`.
- `crates/comind-core/src/storage/entity/mod.rs` — added `pub mod link;`
- `crates/comind-core/src/storage/sqlite.rs` — native `SQLiteAdapter` and transaction `SQLiteTransactionAdapter` `LinkRepository` impls now delegate to the shared free functions (each method body collapsed to a 1-line call with `&self.conn`). **Link has no `SearchIndex` side-effect**, so `create`/`create_many`/`delete` delegate fully with no adapter-local cleanup. Both impls are byte-identical in body, replaced together via a brace-matcher that skips string literals (a `format!("{...}")` with a `{}` was the trap that overran an earlier naive attempt).
- `crates/comind-core/src/storage/sqljs.rs` — `SqlJsAdapter::LinkRepository` SELECTs via `link_select_cols()` and maps via `row_to_link_js` (Q4b fix). `get_by_source_block_ids` was a per-source loop calling `get_by_source_block_id`; it is now a single batch `IN (...)` query mirroring native (converges the query strategy, not just the row mapping). The dead `row_to_link` fn was removed (superseded by `row_to_link_js`).

**Q4b confirmation (Link).** Pre-pilot drift: native SELECT order was `id, source_block_id, target_page_id, display_text, relationship_type, created_at, updated_at, version, deleted_at`, while wasm emitted `id, source_block_id, target_page_id, display_text, relationship_type, updated_at, version, deleted_at, created_at` (**created_at LAST**). Both now derive the SELECT column list from the single `LINK_COLS`; `row_to_link_js` reads by name, so the positional difference is inert and drift is structurally impossible.

**Behavior-preserving divergence kept on purpose.** sql.js INSERT/UPDATE/DELETE text is unchanged (its `create` forces `version = 0` and `deleted_at = NULL`, and `create_many` loops calling `create`); only the SELECT column order and `get_by_source_block_ids` (loop→batch `IN`) changed, both behavior-preserving. Empty `relationship_type`→`None` and `deleted_at` parse→`Option` coercion are unchanged.

**Verification.** `cargo check -p comind-core --tests` (native) ✅ 0 warnings; `cargo check --target wasm32-unknown-unknown -p comind-core` (sql.js path) ✅. `cargo test -p comind-core --lib`: **122 passed** (incl. 2 new link-js roundtrip tests), **4 pre-existing failures unchanged & unrelated** — identical set to the DateRef/Block/Page baselines (`services::block_service_test::test_build_tree`, `services::render_segment_service_test::test_chinese_content_char_offsets`, `services::render_segment_service_test::test_link_to_nonexistent_page_skipped`, `sync::engine::tests::test_full_sync_export_empty`) — zero new failures introduced.

**Net change.** `link.rs` +241 (new, incl. tests); `sqlite.rs` net ≈ −260 (both Link impls collapsed from ~166→~39 lines each); `sqljs.rs` net ≈ −19. Overall net reduction ≈ **−34 lines** of pure duplication while adding the same convergence guarantee as DateRef/Block/Page.

**Next:** continue Link → Property → RelationshipType → Template → Search → BlockVersion → Notification → SavedFilter → ScreenView → NotificationConfig, each behind the same shared-module + `Executor` pattern. After the last entity lands, delete `SQLiteTransactionAdapter` entirely (Q3a). The convergence PR stays open and accumulates these entity commits for one review.

## Landing record — Property (2026-08-19)

Implemented on branch `refactor-repository-convergence` (commit `e18559f`), on top of DateRef/Block/Page/Link. Review gate (Q10a) intentionally skipped per jay's go-ahead.

**Files**
- `crates/comind-core/src/storage/entity/property.rs` (new) — `PROPERTY_COLS` const (13 cols, canonical order = native positional = struct field order), `property_select_cols()`, `property_insert_sql()`, `row_to_property_native()` (by-position), `row_to_property_js()` (by-name; preserves sql.js semantics: empty `block_id`→`None`, numeric defaults `0`, `is_deleted` default `0`), `property_params()`, and 11 free functions (`property_get_all / get_by_id / get_by_block_id / get_by_block_ids / get_by_block_id_and_key / query_block_ids_by_key_value / create / upsert / update / delete / delete_by_block_id`) generic over `E: Executor`. Unit tests `row_to_property_js_roundtrip` + `row_to_property_js_block_id_some`. (*Note: `update`/`upsert` SQL is inline in the shared fns; there is no separate `property_update_sql()`/`property_update_params()` — this record was corrected 2026-08-19 to drop the nonexistent names.*)
- `crates/comind-core/src/storage/entity/mod.rs` — added `pub mod property;`
- `crates/comind-core/src/storage/sqlite.rs` — native + transaction `TxContext` `PropertyRepository` impls delegate to the shared free functions.
- `crates/comind-core/src/storage/sqljs.rs` — `SqlJsAdapter::PropertyRepository` SELECTs via `property_select_cols()` and maps via `row_to_property_js` (Q4b). Dead `row_to_property` removed.

**Convergence note (added 2026-08-19).** sql.js `get_by_block_ids` was a per-source loop calling `get_by_block_id`; it is now a single batch `IN (...)` query mirroring native (converges the query strategy, not just the row mapping) — behavior-preserving.

**Q4b confirmation (Property).** Native and wasm `Property` tables share the same 13 physical columns; both derive SELECT/INSERT column lists from `PROPERTY_COLS`. `row_to_property_js` reads by name, so positional differences are inert and drift is structurally impossible.

**Verification.** `cargo check -p comind-core --tests` (native) ✅ 0 warnings; `cargo check --target wasm32-unknown-unknown -p comind-core` (sql.js path) ✅. `cargo test -p comind-core --lib`: **124 passed**, **4 pre-existing failures unchanged & unrelated** — identical set to the DateRef/Block/Page/Link baselines. Zero new failures introduced.

## Landing record — RelationshipType (2026-08-19)

Implemented on branch `refactor-repository-convergence` (commit `260fe73`).

**Files**
- `crates/comind-core/src/storage/entity/relationship_type.rs` (new) — `RELATIONSHIP_TYPE_COLS` const (12 cols; `order` is a SQL reserved word, so `relationship_type_select_cols()` / `*_insert_sql()` backtick-wrap it), `row_to_relationship_type_native()` / `row_to_relationship_type_js()`, and 6 free functions (`relationship_type_get_by_id / get_by_type / get_all / create / update / delete`) generic over `E: Executor`. Unit tests `row_to_relationship_type_js_roundtrip` + `row_to_relationship_type_js_defaults`.
- `crates/comind-core/src/storage/entity/mod.rs` — added `pub mod relationship_type;`
- `crates/comind-core/src/storage/sqlite.rs` — native + tx `RelationshipTypeRepository` impls delegate to shared free functions.
- `crates/comind-core/src/storage/sqljs.rs` — `SqlJsAdapter::RelationshipTypeRepository` SELECTs via `relationship_type_select_cols()` (backtick `order`) and maps via `row_to_relationship_type_js` (Q4b). Dead `row_to_relationship_type` removed.

**Q4b confirmation (RelationshipType).** The `order` reserved word is handled once in `relationship_type_select_cols()` (backtick-wrapped) and reused by both engines, so the 12-column list is single-sourced; `row_to_relationship_type_js` reads by name. Drift structurally impossible.

**Verification.** native + wasm check ✅ 0 warnings; `cargo test --lib`: **126 passed**, 4 pre-existing failures unchanged & unrelated. Zero new failures.

## Landing record — Template (2026-08-19)

Implemented on branch `refactor-repository-convergence` (commit `6368fce`).

**Files**
- `crates/comind-core/src/storage/entity/template.rs` (new) — `TEMPLATE_COLS` const (6 cols), `template_select_cols()`, `template_insert_sql()`, `row_to_template_native()` / `row_to_template_js()`, and 6 free functions (`template_get_by_id / get_by_name / get_all / create / update / delete`) generic over `E: Executor` (returns `UserTemplate`). Unit tests `row_to_template_js_roundtrip` + `row_to_template_js_defaults`.
- `crates/comind-core/src/storage/entity/mod.rs` — added `pub mod template;`
- `crates/comind-core/src/storage/sqlite.rs` — native + tx `TemplateRepository` impls delegate to shared free functions.
- `crates/comind-core/src/storage/sqljs.rs` — `SqlJsAdapter::TemplateRepository` SELECTs via `template_select_cols()` and maps via `row_to_template_js` (Q4b). Dead `row_to_template` removed.

**Q4b confirmation (Template).** Both engines derive the 6-column SELECT/INSERT lists from `TEMPLATE_COLS`; `row_to_template_js` reads by name. Drift structurally impossible.

**Verification.** native + wasm check ✅ 0 warnings; `cargo test --lib`: **128 passed**, 4 pre-existing failures unchanged & unrelated. Zero new failures.

## Landing record — Search (2026-08-19)

Implemented on branch `refactor-repository-convergence` (commit `f1c06b7`).

**Files**
- `crates/comind-core/src/storage/entity/search.rs` (new) — `SEARCH_INDEX_COLS` const (3 cols: `block_id, content, title`; FTS5 virtual table), `search_index_insert_sql()`, and 3 free functions (`search_index_search / upsert / delete`) generic over `E: Executor`. `search_index_search` builds an FTS5 `MATCH` query and returns `Vec<SearchResult>` (score via `bm25`). `use crate::types::SearchResult;` gated `#[cfg(not(wasm32))]`. Native round-trip test `search_index_roundtrip` on an in-memory `Connection`. `row_to_*` is intentionally absent (search returns a computed `SearchResult`, not a stored row).
- `crates/comind-core/src/storage/entity/mod.rs` — added `pub mod search;`
- `crates/comind-core/src/storage/sqlite.rs` — native + tx `SearchRepository` impls delegate to `search_index_*` free functions; the Block `create`/`update` path still calls `search_index_upsert`/`delete` via the adapter (SearchIndex side-effect lives in the adapter, not the shared fn).
- `crates/comind-core/src/storage/sqljs.rs` — `SqlJsAdapter::SearchRepository` left as a no-op stub (no FTS in wasm); native + wasm share the `SearchIndex` write/delete SQL.

**Q4b confirmation (Search).** `SearchIndex` has no by-position row mapping (it is a computed FTS result), so column-order drift is N/A; the 3-column `SEARCH_INDEX_COLS` is the single source for the write/delete SQL used by both native and tx paths.

**Verification.** native + wasm check ✅ 0 warnings; `cargo test --lib`: **129 passed**, 4 pre-existing failures unchanged & unrelated. Zero new failures.

## Landing record — BlockVersion (2026-08-19)

Implemented on branch `refactor-repository-convergence` (commit `690278e`).

**Files**
- `crates/comind-core/src/storage/entity/block_version.rs` (new) — `BLOCK_VERSION_COLS` const (9 cols), `block_version_select_cols()`, `block_version_insert_sql()`, `row_to_block_version_native()` / `row_to_block_version_js()` (preserves sql.js: `message`/`restored_from_version_id` empty→`None`, numeric default `0`), `block_version_params()`, and 7 free functions (`block_version_get_by_id / get_by_block_id / get_latest_version / create / delete / delete_by_block_id / delete_older_than`) generic over `E: Executor`. Unit tests `row_to_block_version_js_roundtrip` + `row_to_block_version_js_option_none`.
- `crates/comind-core/src/storage/entity/mod.rs` — added `pub mod block_version;`
- `crates/comind-core/src/storage/sqlite.rs` — native + tx `BlockVersionRepository` impls delegate to shared free functions (removes the last inline `BlockVersion` SQL from the tx path).
- `crates/comind-core/src/storage/sqljs.rs` — `SqlJsAdapter::BlockVersionRepository` SELECTs via `block_version_select_cols()` and maps via `row_to_block_version_js` (Q4b). Dead `row_to_block_version` removed.

**Q4b confirmation (BlockVersion).** Both engines derive the 9-column SELECT/INSERT lists from `BLOCK_VERSION_COLS`; `row_to_block_version_js` reads by name. Drift structurally impossible.

**Verification.** native + wasm check ✅ 0 warnings; `cargo test --lib`: **131 passed**, 4 pre-existing failures unchanged & unrelated. Zero new failures.

## Landing record — Notification (2026-08-19)

Implemented on branch `refactor-repository-convergence` (commit `0e9c61d`).

**Files**
- `crates/comind-core/src/storage/entity/notification.rs` (new) — `NOTIFICATION_COLS` const (11 cols), `notification_select_cols()`, `notification_insert_sql()`, `row_to_notification_native()` / `row_to_notification_js()` (preserves sql.js: `status` default `"unread"`, `snooze_until` empty→`None`, numeric default `0`), `notification_params()`, and 18 free functions (`notification_get_by_id / get_by_block_id / get_by_block_ids / find_by_event / query_unread / query_pending_due / query_recent / create / batch_create / update_status / set_snooze / delete / delete_by_block_id / delete_by_block_and_kind / delete_older_than / mark_all_read / update_payload / reschedule`) generic over `E: Executor`. `update_status`/`set_snooze`/`update_payload` re-fetch via `notification_get_by_id` after the write. Unit tests `row_to_notification_js_roundtrip` + `row_to_notification_js_defaults`.
- `crates/comind-core/src/storage/entity/mod.rs` — added `pub mod notification;`
- `crates/comind-core/src/storage/sqlite.rs` — native + tx `NotificationRepository` impls delegate to shared free functions (removes the last inline `Notification` SQL, including the `IN (...)` batch query, from the tx path).
- `crates/comind-core/src/storage/sqljs.rs` — `SqlJsAdapter::NotificationRepository` SELECTs via `notification_select_cols()` and maps via `row_to_notification_js` (Q4b). Dead `row_to_notification` removed.

**Q4b confirmation (Notification).** Both engines derive the 11-column SELECT list from `NOTIFICATION_COLS`; `row_to_notification_js` reads by name. Drift structurally impossible.

**Verification.** native + wasm check ✅ 0 warnings; `cargo test --lib`: **133 passed**, 4 pre-existing failures unchanged & unrelated. Zero new failures.

## Landing record — SavedFilter (2026-08-19)

Implemented on branch `refactor-repository-convergence` (commit `ff60f83`).

**Files**
- `crates/comind-core/src/storage/entity/saved_filter.rs` (new) — `SAVED_FILTER_COLS` const (5 cols), `saved_filter_select_cols()`, `saved_filter_insert_sql()`, `row_to_saved_filter_native()` / `row_to_saved_filter_js()` (preserves sql.js: `created_at`/`updated_at` parse-fail→`0`), `saved_filter_params()`, and 5 free functions (`saved_filter_get_all / get_by_id / create / update / delete`) generic over `E: Executor`. Unit tests `row_to_saved_filter_js_roundtrip` + `row_to_saved_filter_js_defaults`.
- `crates/comind-core/src/storage/entity/mod.rs` — added `pub mod saved_filter;`
- `crates/comind-core/src/storage/sqlite.rs` — native + tx `SavedFilterRepository` impls delegate to shared free functions (removes the last inline `SavedFilter` SQL from the tx path).
- `crates/comind-core/src/storage/sqljs.rs` — `SqlJsAdapter::SavedFilterRepository` SELECTs via `saved_filter_select_cols()` and maps via `row_to_saved_filter_js` (Q4b); sql.js previously inlined the struct and now uses the shared `row_to_saved_filter_js`.

**Q4b confirmation (SavedFilter).** Both engines derive the 5-column SELECT/INSERT lists from `SAVED_FILTER_COLS`; `row_to_saved_filter_js` reads by name. Drift structurally impossible.

**Verification.** native + wasm check ✅ 0 warnings; `cargo test --lib`: **135 passed**, 4 pre-existing failures unchanged & unrelated. Zero new failures.

## Landing record — ScreenView (2026-08-19)

Implemented on branch `refactor-repository-convergence` (commit `f244dbf`).

**Files**
- `crates/comind-core/src/storage/entity/screen_view.rs` (new) — `SCREEN_VIEW_COLS` const (12 cols; INSERT order) and `screen_view_select_cols()` which returns a **reordered** SELECT (`id, name, query_json, view_type, group_by, is_default, sort_order, COALESCE(config, '') AS config, entity, parent_id, created_at, updated_at`) — `config` is `COALESCE`'d to `""` and `entity`/`parent_id` appear after `config` so the native positional read matches the struct. `screen_view_insert_sql()`, `row_to_screen_view_native()` (by that SELECT positional order) / `row_to_screen_view_js()` (by-name; `entity` default `"block"`, numeric parse-fail→`0`, `config` default `""`), create/update params, and 5 free functions (`screen_view_get_all_by_entity / get_by_id / create / update / delete`) generic over `E: Executor`. Unit tests `row_to_screen_view_js_roundtrip` + `row_to_screen_view_js_defaults`.
- `crates/comind-core/src/storage/entity/mod.rs` — added `pub mod screen_view;`
- `crates/comind-core/src/storage/sqlite.rs` — native + tx `ScreenViewRepository` impls delegate to shared free functions (removes the last inline `ScreenView` SQL, including the `COALESCE(config, '')` SELECT, from the tx path).
- `crates/comind-core/src/storage/sqljs.rs` — `SqlJsAdapter::ScreenViewRepository` SELECTs via `screen_view_select_cols()` and maps via `row_to_screen_view_js` (Q4b).

**Q4b confirmation (ScreenView).** SELECT column order now comes from the single `screen_view_select_cols()` (with the `COALESCE(config, '')` and reordering) used by both native and tx; sql.js reads by name. Drift structurally impossible.

**Verification.** native + wasm check ✅ 0 warnings; `cargo test --lib`: **137 passed**, 4 pre-existing failures unchanged & unrelated. Zero new failures.

## Landing record — NotificationConfig (2026-08-19)

Implemented on branch `refactor-repository-convergence` (commit `ca896be`).

**Files**
- `crates/comind-core/src/storage/entity/notification_config.rs` (new) — `NOTIFICATION_CONFIG_COLS` const (8 cols; single-row table `notification_config`, `id = 1`), `notification_config_select_cols()`, `row_to_notification_config_native()` (booleans read as `row.get::<_, i64>(n)? != 0`), and 2 free functions (`notification_config_get` WHERE id=1 / `notification_config_save` INSERT … ON CONFLICT(id) DO UPDATE SET …) generic over `E: Executor`. Booleans bound as `as i64`. `use crate::types::NotificationConfig;` gated `#[cfg(not(wasm32))]`. No separate test module (mapping covered by the shared module's type-level coercion).
- `crates/comind-core/src/storage/entity/mod.rs` — added `pub mod notification_config;`
- `crates/comind-core/src/storage/sqlite.rs` — native + tx `NotificationConfigRepository` impls delegate to shared free functions (removes the last inline `NotificationConfig` SQL from the tx path).
- `crates/comind-core/src/storage/sqljs.rs` — `SqlJsAdapter::NotificationConfigRepository` left as a no-op stub (wasm persists config via `localStorage`); native + tx share the single-row upsert.

**Q4b confirmation (NotificationConfig).** Single-row table; booleans encoded as `i64(0/1)` in one place. Column-order drift N/A.

**Verification.** native + wasm check ✅ 0 warnings; `cargo test --lib`: **137 passed**, 4 pre-existing failures unchanged & unrelated. Zero new failures.

## Q3a landing record — delete `SQLiteTransactionAdapter`, introduce `TxContext` (2026-08-19)

Implemented on branch `refactor-repository-convergence` (commit `4ef5c2a`), after all 13 entities landed.

**What changed**
- The standalone `SQLiteTransactionAdapter<'a>` struct is **deleted** (Q3). In its place, `TxContext<'a> { conn: rusqlite::Transaction<'a> }` implements all 13 repo sub-traits + `StorageAdapter`; every method calls the **same** shared free functions on `&self.conn` (`&Transaction`) that `SQLiteAdapter` calls on `&self.conn` (`&Connection`).
- The 5 entities that still carried inline SQL in the tx path (BlockVersion, SavedFilter, ScreenView, Notification, NotificationConfig) now delegate to the shared modules — eliminating the last ≈ 480 lines of rusqlite duplication.
- `SQLiteAdapter::transaction()` spins `BEGIN`, builds `TxContext { conn: tx }`, runs the closure against `&mut TxContext`, then `COMMIT`; on closure error the `Transaction` is dropped → `ROLLBACK` (behavior-preserving).
- `executor.rs` doc comment updated (`SQLiteTransactionAdapter` → `TxContext`).

**Net change.** `sqlite.rs` net ≈ **−480 lines** (the whole tx inline-impl block replaced by free-fn delegates + a thin `TxContext`); `executor.rs` +1 line (comment). This completes the ≈ 2,000-line duplication removal projected by ADR-0018.

**Verification.** `cargo check -p comind-core --tests` (native) ✅ 0 warnings; `cargo check --target wasm32-unknown-unknown -p comind-core` (sql.js path) ✅; `cargo test -p comind-core --lib`: **137 passed**, **4 pre-existing failures unchanged & unrelated** (`services::block_service_test::test_build_tree`, `services::render_segment_service_test::test_chinese_content_char_offsets`, `services::render_segment_service_test::test_link_to_nonexistent_page_skipped`, `sync::engine::tests::test_full_sync_export_empty`) — identical set to every per-entity baseline, so the Q3a change introduced zero new failures.

**Status.** All 13 entities converged; `SQLiteTransactionAdapter` removed; the convergence PR stays open and accumulates these commits for one review.
