# T2: get_blocks_projection() Implementation Report

## Date: 2026-08-08

## Objective
Implement `get_blocks_projection()` — a Rust service that returns a lightweight projection (`BlockCard[]`) of all non-deleted blocks with their properties and date_refs aggregated.

## What was done

### 1. Added `get_all()` to Repository Traits
- **`BlockRepository`**: Added `fn get_all(&self) -> Result<Vec<Block>, Box<dyn Error>>;`
- **`PropertyRepository`**: Added `fn get_all(&self) -> Result<Vec<Property>, Box<dyn Error>>;`
- `DateRefRepository` already had `get_all()` — no change needed.

### 2. Implemented in SQLiteAdapter (`sqlite.rs`)
- `BlockRepository::get_all`: `SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at, version, deleted_at FROM Block WHERE deleted_at IS NULL`
- `PropertyRepository::get_all`: `SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at FROM Property WHERE is_deleted = 0 AND deleted_at IS NULL`
- Also added to `SQLiteTransactionAdapter<'a>` (the transactional version that wraps a savepoint)

### 3. Implemented in SqlJsAdapter (`sqljs.rs`)
- `BlockRepository::get_all`: Same SQL, using `Self::query()` and `row_to_block()`
- `PropertyRepository::get_all`: Same SQL, using `Self::query()` and `row_to_property()`

### 4. Created `block_projection_service.rs`
New service module at `crates/comind-core/src/services/block_projection_service.rs` with:

```rust
pub fn get_blocks_projection(
    storage: &mut dyn StorageAdapter,
) -> Result<Vec<BlockCard>, Box<dyn Error>>
```

**Strategy**: Three separate queries + Rust-side HashMap assembly:
1. Query all non-deleted blocks via `BlockRepository::get_all()`
2. Query all non-deleted properties via `PropertyRepository::get_all()` → HashMap by block_id
3. Query all non-deleted date_refs via `DateRefRepository::get_all()` → HashMap by block_id
4. Assembly: For each block, look up properties and date_refs from HashMaps

**content_preview generation**:
- Regex strips `{{schedule:...}}` and `{{deadline:...}}` patterns
- Collapses whitespace
- Truncates to 200 chars with `...` suffix

**Property values**: Parse from JSON string to `serde_json::Value` via `serde_json::from_str`, fallback to raw string on parse error.

### 5. Updated `services/mod.rs`
- Added `pub mod block_projection_service;`
- Added `pub use block_projection_service::*;`

### 6. Dependencies
- `regex` crate was already in `Cargo.toml` (version 1.10) — no changes needed

## Verification
- ✅ `cargo check` passes with zero new errors
- ✅ 4 unit tests pass (content_preview stripping, truncation, property parsing)
- ✅ 46 pre-existing tests pass (1 pre-existing failure in `test_build_tree` unrelated)

## Files Modified
- `crates/comind-core/src/storage/repository.rs` — Added `get_all()` to BlockRepository and PropertyRepository traits
- `crates/comind-core/src/storage/sqlite.rs` — Implemented get_all() in SQLiteAdapter and SQLiteTransactionAdapter
- `crates/comind-core/src/storage/sqljs.rs` — Implemented get_all() in SqlJsAdapter
- `crates/comind-core/src/services/mod.rs` — Added module export

## Files Created
- `crates/comind-core/src/services/block_projection_service.rs` — New projection service with full implementation
