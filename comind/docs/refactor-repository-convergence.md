# Refactor: Repository triple-write convergence

> Implementation spec for **candidate 1** (Collapse the triple-written Repository implementations).
> All decisions are recorded in **ADR-0018**. This document is the build plan.

## Goal

Converge the 3 storage implementations (`SQLiteAdapter`, `SQLiteTransactionAdapter`, `SqlJsAdapter`) onto
**per-entity shared definition modules**, so that:

- ~2,000 lines of pure duplication are removed (mostly the rusqlite adapter pair).
- column-order drift becomes structurally impossible (single `COLS` source of truth).
- a field/schema change touches one module, not three files.

## Phases

- **Phase 0 — Pilot (DateRef).** This PR. Proves the pattern end-to-end across native / sql.js / transaction.
- **Phase 1–12 — Roll out** the remaining 12 entities in the ADR-0018 Q10 order. Each lands as its own small PR.

## Phase 0 plan — DateRef pilot

### New file: `crates/comind-core/src/storage/entity/date_ref.rs`

Owns everything DateRef-specific:

```rust
pub struct Col { pub name: &'static str }
pub const DATE_REF_COLS: &[Col] = &[
    Col{name:"id"}, Col{name:"block_id"}, Col{name:"kind"}, Col{name:"iso"},
    Col{name:"date_day"}, Col{name:"recurrence"}, Col{name:"lead_minutes"},
    Col{name:"event_ts"}, Col{name:"created_at"}, Col{name:"updated_at"},
    Col{name:"version"}, Col{name:"deleted_at"},
];

pub fn date_ref_select_cols() -> String { /* "id, block_id, …" from COLS */ }
pub fn date_ref_insert_sql()  -> &'static str { /* INSERT INTO DateRef (…) VALUES (?,…) from COLS */ }

pub fn row_to_date_ref_native(row: &rusqlite::Row) -> Result<DateRef, Box<dyn Error>>;
pub fn row_to_date_ref_js(row: &HashMap<String,String>) -> DateRef; // iterate COLS order, lookup by name, parse

pub fn date_ref_params(d: &DateRef) -> Vec<...>;        // bind in COLS order (native: &[&dyn ToSql])
pub fn date_ref_create(exec: &dyn Executor, d: &DateRef) -> Result<DateRef, …>;
pub fn date_ref_get_by_block_id(exec: &dyn Executor, block_id: &str) -> Result<Vec<DateRef>, …>;
pub fn date_ref_query_by_date_range(exec: &dyn Executor, kind:&str, from:&str, to:&str) -> Result<Vec<DateRef>, …>;
pub fn date_ref_query_overdue(exec: &dyn Executor, today:&str) -> Result<Vec<DateRef>, …>;
pub fn date_ref_query_due_non_recurring(exec: &dyn Executor, now_ms:i64) -> Result<Vec<DateRef>, …>;
pub fn date_ref_create_many(exec: &dyn Executor, ds:&[DateRef]) -> Result<Vec<DateRef>, …>;
pub fn date_ref_delete(exec: &dyn Executor, id:&str) -> Result<(), …>;
pub fn date_ref_delete_by_block_id(exec: &dyn Executor, block_id:&str) -> Result<(), …>;
```

### `Executor` trait (`crates/comind-core/src/storage/executor.rs`)

```rust
pub trait Executor {
    fn execute(&self, sql:&str, params:&[&dyn ToSql]) -> Result<usize, Box<dyn Error>>;
    fn query_map<T, F>(&self, sql:&str, params:&[&dyn ToSql], f:F)
        -> Result<Vec<T>, Box<dyn Error>>
        where F: FnMut(&rusqlite::Row) -> Result<T, Box<dyn Error>>;
    fn last_insert_rowid(&self) -> i64;
}
impl Executor for rusqlite::Connection { … }
impl Executor for rusqlite::Transaction<'_> { … }
```

### Rewire (three sites)

- **`SQLiteAdapter`** (`sqlite.rs` L2046): `impl DateRefRepository` methods become 1-line calls to the free fns with `&self.conn`.
- **`SqlJsAdapter`** (`sqljs.rs` L932): `impl DateRefRepository` methods call `date_ref_*` with its `query()` / `run_with_params` and `row_to_date_ref_js` (iterated in COLS order).
- **`SQLiteTransactionAdapter`** (`sqlite.rs` L4300): DateRef methods delegate to the same free fns with the tx `&Transaction`. (Pilot keeps the rest of the struct intact; full deletion at rollout end.)

### `transaction()` (repository.rs L185)

`TransactionalStorageAdapter::transaction` wraps the closure: `BEGIN` on `&mut self.conn`, build a
`TxContext { tx: &Transaction }` whose `StorageAdapter` methods forward to free fns on the tx, run closure,
`COMMIT` or `ROLLBACK` on error. During pilot only DateRef is wired through `TxContext`; other traits still use
the legacy `SQLiteTransactionAdapter` until migrated.

### Tests

- **Unit** (`entity/date_ref.rs`): `row_to_date_ref_native` / `row_to_date_ref_js` round-trip a fixture `DateRef` → assert equality (pure fn).
- **Native round-trip** (`sqlite.rs` integration or `entity/date_ref.rs` `#[cfg(test)]`): in-memory `Connection`, run `date_ref_create` + `date_ref_get_by_block_id`, assert persisted values; exercise `query_due_non_recurring` / `query_overdue` with crafted timestamps.
- **sql.js**: best-effort in wasm harness (if available in CI); otherwise a `HashMap` fixture test of `row_to_date_ref_js`.

### Acceptance (ADR-0018 Q10)

All green + code review before merge. No behavior change for non-DateRef entities.

## Rollout order (post-pilot)

- **Done (committed on `refactor-repository-convergence`):** DateRef, Block, Page, Link — each via the same shared-module + `Executor` pattern; the Q10 review gate is skipped per jay's go-ahead, so entities accumulate in one open convergence PR.
- **Remaining:** Property → RelationshipType → Template → Search → BlockVersion → Notification → SavedFilter → ScreenView → NotificationConfig.
- When the last entity lands, delete `SQLiteTransactionAdapter` entirely (Q3a).
