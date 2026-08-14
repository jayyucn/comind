# ADR-0008: 值编辑器的值可以是「另一个字段」（字段引用值）

- 状态：已采纳（Accepted）
- 日期：2026-08-13
- 范围：通用查询系统的「条件值」数据模型 + 求值器 + FilterBuilder UI（`src/core/query`、`src/components/query`、`src/composables/use*QueryEngine`）
- 关联代码：
  - `src/core/query/types.ts`（`ConditionValue` 判别联合、`Condition.value`、`QueryContext`）
  - `src/core/query/evaluate.ts`（`resolveTarget` / `matchCondition` / `evalGroup` / `evaluate` 透传 `context`）
  - `src/core/query/serialize.ts`（`normalizeValue` 向前兼容包裹裸字面量）
  - `src/components/query/ValueEditor.vue`（固定值 / 字段 分段 + `+` 引用菜单）
  - `src/components/query/CrossRecordRefPicker.vue`（跨记录：选记录 + 选同类型字段，业务无关）
  - `src/components/query/ConditionRow.vue` / `ConditionGroup.vue` / `FilterBuilder.vue`（props 透传 `crossRecordSources`）
  - `src/composables/usePageQueryEngine.ts` / `useBlockQueryEngine.ts`（透传 `context`）
  - `src/components/PagesLibrary/PagesLibrary.vue`（`getById` 上下文 + `crossRecordSources` 注入，作为业务→引擎的唯一转换点）

---

## 背景 / 问题陈述

通用筛选系统的「值编辑器」原本只接受**字面量值**（如 `open`、`100`、`2026-01-05`）。用户提出：值编辑器的值**可以是另一个字段的值**，从而支持两类比较：

1. **同记录字段间比较**——「字数 > 子页面数」：比较目标取当前记录上的另一个字段。
2. **跨记录页面字段比较**——「本页字数 > 『产品规划』页的更新时间」：比较目标取**另一个 Page** 上的某个字段。

这要求把「条件值」从「单一字面量」扩展为「一个可解析为比较目标的引用」，且求值器必须能解析这些引用。

> 关键事实：无头求值器是**逐条自包含**的——`matchCondition(cond, item, registry, entityType)` 只拿到当前 `item`，没有通往其他记录的把手。因此「跨记录引用」**必须先有按 id 取目标实体的能力**，否则求值器无法解析。这正是本 ADR 引入 `QueryContext.getById` 的根本原因。

---

## 决策 1（D1）：`Condition.value` 改为判别联合 `ConditionValue`，而非可选 `valueField`

**提出**：把值模型扩展为「字段引用」。两种形态候选：
- 方案 A：在 `Condition` 上加可选 `valueField?: string`，与既有 `value` 并存。
- 方案 B（采纳）：把 `Condition.value` 改为判别联合：

```ts
export type ConditionValue =
  | { kind: 'literal'; value: unknown }   // 原字面量（JSON 直接存）
  | { kind: 'field'; field: string }      // 同记录字段引用
  | { kind: 'recordRef'; entityType: string; recordId: string; field: string } // 跨记录字段引用（业务无关）
```

**决策**：采纳方案 B。

**理由**：
- 判别联合让 `kind` 成为**显式标签**，求值时 `switch (cv.kind)` 类型安全、无歧义；方案 A 的 `value + valueField` 二选一要靠「哪个非空」推断，易错且无法表达「引用了哪个字段」的元信息。
- 旧版裸字面量由 `parseQuery`/`normalizeValue` 自动包裹为 `{ kind: 'literal', value }` 实现向前兼容（见 D4），序列化形状保持纯 JSON、可直接 `JSON.stringify` 往返。
- 用户明确确认「目前还没有正式数据，不用考虑旧数据的复杂迁移」，故只做 `parse` 层包裹，不引入版本号分支。

---

## 决策 2（D2）：同记录引用（field）走顶部「字段」开关；其余走「固定值」+ `+` 引用菜单

**UI 形态**（经用户确认，参考 Notion 的「+ 引用值」交互）：
- `ValueEditor` 顶部对「比较类 op 且非 between」展示「固定值 ｜ 字段」分段切换：
  - **字段**：切换到同记录字段引用，下拉列出**同类型且排除自身**的字段（如 `count` 条件的可选目标为同类型的 `score`）。
  - **固定值**：默认形态，字面量输入。
- 固定值输入框内有一个 **`+` 按钮**，弹出分层菜单：
  - 「当前记录字段」→ 平列同类型字段（`{ kind:'field' }`）。
  - 「其他记录…」→ 打开 `CrossRecordRefPicker`：先按标题搜索并选记录，再平列该记录上**同类型**字段（`{ kind:'recordRef', entityType, recordId, field }`）。
- 已选的跨记录引用以**不可编辑芯片**呈现（图标 + 文本 + `×` 清除），如 `📄 产品规划 · 字数`。

**约束 / v1 范围**：
- `isEmpty` / `isNotEmpty`：无值编辑器（由 `ConditionRow` 隐藏本组件）。
- `between`：仅字面量区间，不开放字段 / 页面引用（D2 中 `showRefControls` 在 `between` 时为 false）。
- 同记录 `field` 引用**免费**（只需 registry 列举同类型字段）；跨记录 `recordRef` 引用**需要 `QueryContext.getById`**（D3）。

---

## 决策 3（D3）：跨记录引用依赖 `QueryContext.getById`，无上下文则一律非匹配

**求值链路**：
- `evaluate(query, items, registry, entityType, context?)` 把 `context` 透传到 `matchCondition` → `resolveTarget`。
- `resolveTarget` 解析三种 `kind`：
  - `literal`：原值。
  - `field`：`registry.get(entityType, cv.field).get(item)`（同记录另一字段）。
  - `recordRef`：`context.getById(cv.entityType, cv.recordId)` 取目标实体 → `registry.get(cv.entityType, cv.field).get(targetItem)`。目标取不到或字段为空 → 返回 `undefined` → 比较类操作符遇空 → **非匹配**。

**桥接层接线**（`usePageQueryEngine` / `useBlockQueryEngine`）：
- 两引擎的 `filterSort*` / `group*` / `run*` 函数新增可选 `context?: QueryContext` 参数，透传给 `evaluate`。
- `PagesLibrary.vue` 提供 `queryContext = { getById: (et, id) => et === PAGE_ENTITY ? pageStore.getPage(id) : undefined }`（用**全量** store，不受列表搜索过滤影响），并注入 `crossRecordSources`（每条含 `id / title / entityType / fields`，由 PagesLibrary 把 Page 模型翻译为通用结构）给 `FilterBuilder` 的「其他记录…」入口。
- 不传 `context` 时（`TaskHub` 等尚未接入跨记录的调用方）`recordRef` 引用一律非匹配——这是**安全的默认行为**，不会误判。

---

## 决策 4（D4）：旧版裸字面量的向前兼容在 `parse` 层包裹，不改形状

`serialize.ts::normalizeValue(raw)`：
- 已是判别联合（含 `kind` 字段）→ 原样保留。
- 旧版裸字面量（如 `'open'`、`100`、`[from,to]`）→ 包裹为 `{ kind:'literal', value: raw }`。
- `undefined` → `undefined`（无值条件）。

运行时 `evaluate` **假定值已归一化**，不在此做兜底——归一化由 `parseQuery` 在反序列化边界完成。测试脚手架中的裸字面量条件对象已随本特性统一迁移为 `{ kind:'literal', value }`（`evaluate-*`、`use*QueryRegistry`、`FilterBuilder`、`queryFilterStore` 测试）。

---

## 收尾（本轮）

- 核心层：`types.ts`（判别联合 + `QueryContext`）、`evaluate.ts`（`resolveTarget` + `context` 透传）、`serialize.ts`（`normalizeValue`）。
- UI 层：新增 `CrossRecordRefPicker.vue`（业务无关）；重写 `ValueEditor.vue`（分段 + 引用菜单 + 芯片，完全不依赖业务模型）；`ConditionRow` / `ConditionGroup` / `FilterBuilder` 透传 `crossRecordSources`。
- 桥接层：`usePageQueryEngine` / `useBlockQueryEngine` 透传 `context`；`PagesLibrary.vue` 注入 `getById` + `crossRecordSources`（业务→引擎唯一转换点）。
- 测试：新增 `evaluate-refs.test.ts`（field / recordRef 解析，含「无 context」「目标缺失」「嵌套组」）；`FilterBuilder.test.ts` 新增字段引用 / 跨记录序列化 UI 测试；补齐两个 `use*QueryRegistry` 测试的 `cond` 助手迁移。
- 校验：作用域内测试 `14 files / 213 passed`（query 核心 + 组件 + 桥接 + store）。仓库其他 21 个失败用例属**既有、与查询引擎无关**（router 缺失 import、内容渲染 HTML 断言等），非本轮引入。

---

## 术语表（Glossary）

| 术语 | 含义 |
| --- | --- |
| **ConditionValue** | 条件值的判别联合：`literal`（字面量）/ `field`（同记录字段引用）/ `recordRef`（跨记录字段引用，业务无关）。`Condition.value` 的类型。 |
| **literal** | 字面量值。与旧版 `value` 等价，纯 JSON 直接存。 |
| **field（字段引用）** | 同记录字段引用：`{ kind:'field', field }`。求值时取当前记录上另一字段的值，实现字段间比较（如「字数 > 子页面数」）。 |
| **recordRef（记录字段引用）** | 跨记录字段引用（业务无关）：`{ kind:'recordRef', entityType, recordId, field }`。求值时经 `getById` 取目标实体再取其字段值。 |
| **QueryContext.getById** | 按 `entityType + id` 取实体对象的可选能力；跨记录引用解析的唯一把手。不提供时 `recordRef` 一律非匹配。 |
| **crossRecordSources** | 跨记录引用候选记录列表（`{ id, title, entityType, fields }`，业务无关），由业务层（如 `PagesLibrary`）翻译注入 `FilterBuilder` 的「其他记录…」入口。编辑器据此列出候选与字段，不查任何业务注册表。 |
| **showRefControls** | `ValueEditor` 内部标志：仅「比较类 op 且非 between」时展示引用控件（字段开关 / `+` 菜单）。 |
| **归一化（normalizeValue）** | 反序列化边界把旧版裸字面量包裹为 `{ kind:'literal' }` 的向前兼容处理。 |
