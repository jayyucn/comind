# ADR 0001: Ideas Page Creation Logic Moves to Rust

Date: 2026-08-04
Status: Accepted

## Context

The IdeasTodayPanel in IdeasList.vue is conditionally rendered with `v-if="todayPage"`, where `todayPage` is a computed searching `pageStore.pages` for a page whose title matches today's date. On first visit, the panel sometimes never renders.

### Root cause

The page creation logic in TS (`useIdeas.ts`) is unreliable due to a stale-state failure mode:

1. `pageStore.createPage()` checks for existence via `getPageByTitle()`, which reads the in-memory `pages.value` cache.
2. If `pages.value` is stale (doesn't include today's page even though it exists in Rust), TS calls `client.savePage()`.
3. Rust's `PageService::create` rejects with "Page with title '...' already exists".
4. The catch block in `ensureTodayIdeasExists()` tries to recover by reading `ideasPages.value` — still stale — finds nothing, and silently fails.
5. The session-level dedup flag `createdTodayThisSession` is already set, so no retry occurs until app restart.

The page exists in Rust but never enters `pages.value`. `todayPage` stays undefined. The `v-if` hides the panel.

### Additional problem

`loadAllPages()` is called from both `App.vue` and `IdeasList.vue` onMounted, creating a lost-update race where one call's stale response overwrites the other's fresh data in `pages.value`.

## Decision

Move the Ideas page creation and history retrieval logic from TS to Rust:

1. **Rust command `ensure_today_ideas_page()`**: Idempotent get-or-create. Uses `chrono::Local` to compute today's date. Returns the page regardless of whether it was found or created. Does NOT depend on TS's in-memory cache — Rust is the single source of truth.

2. **Rust command `get_ideas_pages_by_month(year, month)`**: Returns Page metadata for a given month. Replaces the pattern of loading all pages into memory and filtering in TS. IdeasList fetches history on demand by month.

3. **TS side**: Remove `checkAndEnsureTodayIdeas`, `ensureTodayIdeasExists`, `createdTodayThisSession`, `todayIdeasExists`, and `ideasPages` from `useIdeas.ts`. Remove `loadAllPages()` call from `IdeasList.vue`. Remove `v-if="todayPage"` — the panel always renders, showing its skeleton until the page-id is available.

4. **Router guard**: For `ideas-page` route with today's date, call `ensure_today_ideas_page()` instead of `createPage()`.

## Consequences

### Timezone handling

Rust uses `chrono::Local::now()` to compute "today". This works correctly on Tauri (desktop + Android) where the system timezone is available.

**WASM breakage accepted**: `chrono::Local` in WASM returns UTC, causing a timezone mismatch for non-UTC users after local midnight. This is documented and accepted — the project is Tauri-primary. WASM is a development/testing convenience, not a production target. If WASM support becomes required, the command can be extended to accept an optional date parameter (TS passes the browser-local date string).

### Idempotency

The `ensure_today_ideas_page` command is idempotent at the Rust level: it checks `get_by_title` first, returns if exists, otherwise creates. The `execute_with_adapter` mutex ensures atomicity — no TOCTOU race between check and create.

### Scope

`loadAllPages` is NOT removed globally. Only `IdeasList.vue` stops calling it. `App.vue`, the router guard, and other consumers (sidebar, graph view, page link menu, recent pages) continue to use `loadAllPages` and `pageStore.pages` as before. The global refactor is a separate future decision.
