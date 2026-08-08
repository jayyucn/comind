# Task T1: BlockCard / DateRefLite Rust Type Definitions

## Objective
Create new Rust types for the BlockCard projection system in the task filter feature.

## Files Created
- **`crates/comind-core/src/types/block_card.rs`** — Two structs:
  - `DateRefLite` — Lightweight date reference with fields `kind`, `iso`, `date_day`, `recurrence`, `event_ts`
  - `BlockCard` — Lightweight block projection with fields `block_id`, `page_id`, `parent_id`, `content_preview`, `properties` (HashMap<String, serde_json::Value>), `date_refs` (Vec<DateRefLite>), `updated_at`

## Files Modified
- **`crates/comind-core/src/types/mod.rs`** — Added `pub mod block_card;` and `pub use block_card::*;`

## Verification
- `cargo check` in `src-tauri` passed with zero new errors
- Only pre-existing warning: unused `WsSource` type alias in `sync_server.rs` (unrelated)

## Design Notes
- `DateRefLite` drops: `id`, `block_id`, `lead_minutes`, `created_at`, `updated_at`, `version`, `deleted_at` from the full `DateRef`
- Uses standard serde derives matching existing patterns in `date_ref.rs` and `block.rs`
- No new dependencies — `serde_json::Value` already available via existing Cargo.toml deps
