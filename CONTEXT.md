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

### Field Descriptor (字段描述符)
The unit through which a business entity exposes a filterable field to the query system. Carries a key, label, data type, and a way to read the field's value from an item. Business code registers Field Descriptors; the query engine knows entities only through them.

### Condition (条件)
A single predicate in a query: field + operator + value.

### Condition Group (条件组)
A node in a query tree that combines Conditions and nested Condition Groups with an AND/OR combinator. A flat condition list is the degenerate case of a Condition Group.

### View Query (视图查询)
The complete query model: a Condition Group tree plus sort and grouping rules. Excludes rendering concerns such as view type, which remain in the business layer.

### Query Engine (查询引擎)
The headless core of the filtering system: a registry of Field Descriptors plus an evaluator over Condition Group trees. Contains no UI dependencies and no knowledge of concrete business entities.
