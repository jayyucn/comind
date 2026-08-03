# Domain Glossary

This file is the single source of truth for domain terminology in comind. It is a glossary — no implementation details, no specs, no decisions. Those live in `docs/adr/`.

## Terms

### Page
A top-level document in the workspace. Identified by a UUID hex string. Has a title, type, and zero or more Blocks.

### Ideas Page (点滴页面)
A Page whose `type` is `ideas`. Titled with a date string in canonical `yyyy-MM-dd` format (e.g. `2026-08-05`). Represents a single day's journal/daily-notes entry.

Legacy compatibility: pages with `type` `journal` are treated as Ideas Pages.

### Today's Ideas Page (今日点滴页面)
The Ideas Page whose title matches today's local date. At most one exists per day.

### Block
A unit of content within a Page. Has a parent-child relationship (tree structure). A Page with no Blocks has an auto-created empty root Block.

### Ensure (确保存在)
Get-or-create pattern. Returns the existing entity if present; creates and returns it if absent. Must be idempotent — calling it multiple times has the same effect as calling it once.
