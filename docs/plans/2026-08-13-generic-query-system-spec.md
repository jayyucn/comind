# 通用高级筛选系统 — Spec

> 对应设计文档：`docs/2-architecture/generic-query-system.md`
> 对应决策：`docs/adr/0002-generic-query-engine-registry-decoupling.md`
> 术语以 `CONTEXT.md` 为准（Field Descriptor / Condition / Condition Group / View Query / Query Engine）。

## Problem Statement

当前 `BlockQuery`（`src/types/blockQuery.ts`）把筛选、排序、分组能力绑死在 Block 实体上——`BlockField` 硬编码了 property/content/dateRef 三种字段，任何新业务实体（Page、未来的图谱节点、通知）想要筛选，都得重写一遍筛选逻辑或强行塞进 Block 的概念。随着接入方增多，筛选语义会碎片化、维护成本随实体数线性增长。我们需要一个**与业务解耦**的通用查询引擎：业务实体只通过声明"字段描述符"接入，引擎对实体本身一无所知，从而获得可复用的高级筛选、排序、分组能力。

## Solution

交付一个无头（headless）查询引擎（纯 TypeScript，不依赖 Vue/Pinia）+ 一个通用 `FilterBuilder` 组件。

- 业务实体在组合根通过注册 **Field Descriptor**（key、label、数据类型、同步取值 getter、可选操作符覆盖、select 选项、date 分桶粒度）接入引擎。
- 引擎核心由**注册表**（`createRegistry()`，按 entityType 命名空间，支持运行时增删）和**求值器**（`evaluate(query, items, registry, entityType)` 纯函数，全量内存求值）组成。
- 查询模型 **ViewQuery** = 嵌套条件组树（AND/OR + 组级 negate）+ 多键排序 + 单字段分组，整体为可序列化的纯数据，带 `version: 1`。
- 通用 UI `FilterBuilder` 由注册表驱动：字段选择器、按类型派生的操作符选择器、按类型分派的值编辑器、条件组嵌套（软限 3 层）。
- 旧 `BlockQuery` / `TaskView` / `savedFilter` **暂不迁移**，并存期冻结旧模型新增操作符；现有 savedFilter 的 WASM 持久化 API 直接复用（存不透明 JSON 字符串）。

## User Stories

1. As a feature developer, I want to register a Block field as a Field Descriptor at app startup, so that the query engine can filter/sort/group Block without me writing any query logic.
2. As a feature developer, I want to register a Page field as a Field Descriptor, so that Page lists gain advanced filtering without coupling to Block's query code.
3. As a feature developer, I want to register a field via a synchronous getter, so that derived/computed fields are filterable.
4. As a feature developer, I want to register a field whose value lives in a user-defined property, so that dynamically-created Block properties become filterable at runtime (registry supports add/remove after init).
5. As a feature developer, I want to override the default operator set for a field, so that a particular field can expose only the operations that make sense for it.
6. As a feature developer, I want the registry to be an explicit instance, not a global singleton, so that tests can instantiate an isolated registry.
7. As a feature developer, I want the query core to never import Vue or Pinia, so that the engine is reusable and independently testable.
8. As an end user, I want to combine filters with AND and OR arbitrarily nested, so that I can express `(status is open AND priority is high) OR (assignee is me)`-style queries.
9. As an end user, I want a group-level NOT on a condition group, so that I can express "NOT (A AND B)" without manually applying De Morgan's law.
10. As an end user, I want a flat list of filters to behave as the simple AND case it is today, so that migration from the old flat model is lossless.
11. As an end user, I want `isEmpty` / `isNotEmpty` to match fields that have no value, so that I can find items missing a property.
12. As an end user, I want comparison filters on empty fields to never match, so that "priority is high" does not accidentally catch items with no priority (consistent with common note/task-app semantics, not SQL three-valued logic).
13. As an end user, I want text filters with `contains` / `isNot` / `isEmpty`, so that I can do substring and exact matching on text.
14. As an end user, I want number filters with `eq` / `neq` / `gt` / `lt`, so that I can range-filter numeric fields.
15. As an end user, I want date filters with `before` / `after` / `between`, so that I can filter by day-granular dates consistent with the Ideas Page `yyyy-MM-dd` convention.
16. As an end user, I want single-select filters with `is` / `isNot`, so that I can filter by status/priority-like enums.
17. As an end user, I want multi-select filters with `hasAny` / `hasAll`, so that I can match items carrying one-or-more / all of a set of tags.
18. As an end user, I want boolean filters with `is`, so that I can filter done/not-done style flags.
19. As an end user, I want a single-select option list that comes from a static array or a synchronous provider function, so that both fixed enums and store-derived lists are supported.
20. As an end user, I want select values stored by id (not label), so that renaming an option label does not break saved queries.
21. As an end user, I want a condition referencing a deleted option to stop matching, so that stale queries degrade gracefully rather than erroring.
22. As an end user, I want to sort by multiple keys in order (primary, secondary, …), so that ties on the first key break on the second.
23. As an end user, I want to group results by a single field, so that the view shows buckets (board columns / calendar days).
24. As an end user, I want date grouping to bucket by day / week / month (declared per field), so that calendar-style grouping works at the right granularity.
25. As an end user, I want my saved query to round-trip through JSON with a `version` field, so that future schema changes can be detected.
26. As an end user, I want my query persisted via the existing savedFilter mechanism, so that no backend change is required.
27. As a feature developer, I want the `FilterBuilder` component to be driven entirely by the registry for the active entityType, so that I get filtering UI for free after registering fields.
28. As a feature developer, I want value editors to be dispatched by field type, so that I don't hand-build an editor per field.
29. As an end user, I want condition-group nesting limited to 3 levels in the UI, so that queries stay manageable.
30. As an end user, I want the FilterBuilder to hide the group-level negate control in v1, so that the UI stays simple while the model supports it for later.
31. As a feature developer, I want a pure-function evaluator I can call in a Vue `computed` for memoized re-evaluation, so that list filtering re-runs only when inputs change.
32. As a maintainer, I want the old `BlockQuery` to keep working unchanged during coexistence, so that migration is deferred without breaking current features.
33. As a maintainer, I want new filtering requirements to land only in the new engine during coexistence, so that migration cost does not snowball.

## Implementation Decisions

- **Module layout**: a headless core under `src/core/query/` (types, operator-derivation table, registry, evaluator, serialize) with no Vue/Pinia imports; a generic Vue UI under `src/components/query/` (only `FilterBuilder`); per-entity adapters in feature folders register Field Descriptors.
- **Query model shape** (from the design doc; the authoritative schema lives there):
  - `FieldDescriptor { key, label, type, get(item), ops?, options? | (()=>options)?, dateBucket?, path? }`
  - `FieldType = 'text' | 'number' | 'date' | 'select' | 'multiSelect' | 'boolean'` (an open union to leave room for custom types, but the engine only implements these six in v1).
  - `Condition { field, op, value? }`; `ConditionGroup { combinator: 'and'|'or', negate?, children: (Condition|ConditionGroup)[] }`; flat `FilterCondition[]` is the degenerate single-and-group.
  - `ViewQuery { version: 1, filter: ConditionGroup, sort: SortRule[], groupBy: string | null }`; `SortRule { field, dir }`.
- **Operator derivation**: a type→operator table supplies defaults; a field may override via `ops`. The default tables (text/number/date/select/multiSelect/boolean) are specified in the design doc and implemented as a single lookup function.
- **Empty-value semantics**: getter returns `undefined`/`null` → treated as empty; comparison operators return `false` on empty; only `isEmpty`/`isNotEmpty` match emptiness. Select options deleted → condition degrades to non-match. Values stored by option `id`.
- **Registry**: `createRegistry()` returns an instance with `register(entityType, descriptor)`, `unregister(entityType, key)`, `list(entityType)`, and a reactive subscription so `FilterBuilder` follows runtime field changes (needed for dynamic Block properties).
- **Evaluator**: `evaluate(query, items, registry, entityType) => items[]`, pure and total, full re-evaluation of the candidate set. Re-computation is delegated to a Vue `computed` in the consuming store/UI. List rendering virtualization is handled by `vue-virtual-scroller`, out of scope here.
- **Scale assumption (Q16 unresolved)**: designed for sub-thousand-item sets; evaluator ships with zero optimization. Trigger for re-evaluation: at ≥10k items add condition short-circuit ordering + result caching; at ≥100k items revisit ADR-0002 to discuss SQL pushdown.
- **Serialization**: ViewQuery serialized to JSON with `version: 1`. The migration chain is **deferred** — the version field is present, but no `migrate()` is implemented until a v2 appears. Persistence reuses the existing savedFilter WASM API (opaque string), backend untouched.
- **SQL pushdown, custom FieldTypes, async option providers, multi-level grouping, and group aggregates** are explicitly out of v1 scope; the model leaves non-breaking room for each (see design doc "预留口子" table).
- **ADR-0002** governs the three architectural commitments: registry-based decoupling, ideal-model-first with a coexistence period, and in-memory evaluation with reserved pushdown path.

## Testing Decisions

- **What a good test looks like**: test only external behavior of the engine — given a ViewQuery + items + registry, assert the returned item set. Do **not** assert internal tree-walking order or registry internals.
- **Primary seam (highest, single)**: the core query module as pure functions — `evaluate`, `createRegistry`, the operator-derivation table, and `serialize`/`parse`. These are exercised with plain vitest (no Vue, no WASM, no Pinia), matching the existing `src/stores/__tests__/taskView.test.ts` style of `describe/it/expect` with `vi.mock` for the client layer where needed.
- **Secondary seam**: `FilterBuilder` component behavior (renders field/operator/value controls from a registry fixture; nested groups; value editor dispatch) via `@vue/test-utils`. Kept separate from the core seam.
- **Coverage priorities**:
  - Operator-derivation table: each type yields expected default ops; `ops` override works.
  - Empty-value semantics: every comparison op returns false on empty; `isEmpty`/`isNotEmpty` correct; deleted-option degradation.
  - Condition tree: AND/OR combinations, nested groups, group-level `negate`.
  - Multi-key sort and single-field grouping (incl. date bucketing day/week/month).
  - Serialize/parse round-trip preserves `version` and query; malformed/missing fields take defaults.
  - Registry: register/list/unregister per entityType; runtime add/remove reflects in evaluator.

## Out of Scope

- SQL pushdown / WASM query translation (reserved only).
- Custom FieldTypes beyond the six built-ins; async option providers.
- Multi-level grouping and group aggregates (counts/sums computed by UI on demand, not in the model).
- View-type rendering (table/board/calendar) and the saved-view toolbar UI (TaskView already owns these).
- Migrating `BlockQuery` / `TaskView` / `savedFilter` from the old model; the migrate chain for ViewQuery schema versions.
- Freezing or rewriting any feature currently depending on `BlockQuery`.

## Further Notes

- The coexistence period with `BlockQuery` is deliberate (ADR-0002): freeze new operators on the old model so migration stays lossless and cost does not compound.
- The scale assumption (sub-thousand) is unverified (Q16); if it proves wrong early, the evaluator is the only module that needs to change, and the migration-chain stub is the place to add v2 handling.
- CONTEXT.md already carries the five domain terms this spec uses; no glossary changes needed beyond those.
