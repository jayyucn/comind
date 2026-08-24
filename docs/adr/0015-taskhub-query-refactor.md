# ADR-0015: TaskHub 查询 UI 改造 —— 对齐 PagesLibrary 的统一查询系统

- 状态：已采纳（Accepted）
- 日期：2026-08-17
- 范围：`src/components/TaskHub/**` 与 `src/stores/taskView.ts` 的查询 UI 重构；复用 `src/components/query/`（QueryToolbar / QueryChipBar / FilterBuilder / SortMenu）与 `src/core/query` 引擎。
- 关联代码：
  - 参考实现：`src/components/PagesLibrary/PagesLibrary.vue`（改造的「目标形态」）
  - 编排壳：`src/components/query/QueryToolbar.vue`、`src/components/query/QueryChipBar.vue`
  - 引擎：`src/composables/useBlockQueryEngine.ts`（`runBlockQuery`）、`src/composables/useBlockQueryRegistry.ts`（`getBlockRegistry` / `BLOCK_ENTITY`）
  - 待改：`src/components/TaskHub/TaskHub.vue`、`TaskViewBar.vue`、`views/{Table,Board,Calendar}View.vue`、`src/stores/taskView.ts`
  - 待删：`src/components/TaskHub/TaskFilterBar.vue`、`src/composables/useBlockQuery.ts`（含 `applyQuery`）、`src/types/blockQuery.ts`
- 来源：用户对「照着 PagesLibrary 改造 TaskHub」的 `/grill-with-docs` 决策（5 轮确认 + 表格分组深度确认）。

---

## 背景 / 问题陈述

`TaskHub`（任务中心）目前仍停留在**旧查询体系**，与已落地的 `PagesLibrary`（页面库）形成两套并行范式：

| 维度 | PagesLibrary（目标） | TaskHub（现状） |
|------|----------------------|-----------------|
| 查询 UI | `QueryToolbar`（筛选/排序/分组 + 搜索）+ `QueryChipBar`（芯片编辑器） | `TaskViewBar`（含「筛选」按钮）+ `TaskFilterBar`（内联旧筛选面板） |
| 查询模型 | `ViewQuery` `{version,filter, sort, groupBy}` | `BlockQuery` `{filters, sort, groupBy}`（旧） |
| 引擎 | 始终 `runPageQuery`（新无头引擎） | 手动 `useNewEngine` 开关：开→`FilterBuilder`+`runBlockQuery`，关→`applyQuery`（旧） |
| 分组 | `groupBy` 由芯片驱动，表格渲染分组区块 | 看板硬编码按 `status` 分列；表格无分组渲染 |
| 视图持久化 | 无（内存态） | 有（`taskViewStore` 命名视图：保存/切换/重命名/删除/设为默认） |
| 搜索 | 有（标题子串） | 无 |

痛点：同一套「筛选/排序/分组」能力在仓库里存在两套实现、两套数据模型、两套交互，维护成本高且行为不一致。本次改造把 TaskHub 拉到与 PagesLibrary 相同的统一查询系统上，同时**保留 TaskHub 独有的命名视图持久化能力**（PagesLibrary 没有，但 TaskHub 的用户价值所在）。

---

## 决策

### D1：保留「命名视图」持久化，存储格式由 `BlockQuery` 迁移到 `ViewQuery`

不照 PagesLibrary 改成纯内存态。保留 `taskViewStore` 的命名视图（保存/切换/重命名/删除/设为默认），但把每个视图存进 `query_json` 的查询格式从旧 `BlockQuery` 改为新 `ViewQuery`。`QueryToolbar`/`QueryChipBar` 的 `v-model` 绑定到**当前激活视图**的 `ViewQuery`：芯片变更即写回 `taskViewStore.update`。

- 新增迁移适配器 `blockQueryToViewQuery(bq)`：加载视图时若 JSON 带 `version===1` 直接用；若带顶层 `filters`（旧 `BlockQuery`）则尽力转换（`field.key`/`op`/`value` 映射），**不支持的 op 条件静默丢弃**，避免新引擎 `evaluate` 遇到未知 op 而崩溃。
- `taskViewStore` 的 `save/update` 仍保留 WASM 的 `groupBy` 形参，但统一传 `''`（groupBy 已内置于 `ViewQuery`）。
- 默认视图「全部任务」的 `query_json` 改为 `{version:1, filter:{combinator:'and',children:[]}, sort:[], groupBy:null}`。

### D2：删除 `useNewEngine` 手动开关，始终走新引擎

移除 `TaskHub.vue` 的 `useNewEngine` ref 与旧 `applyQuery` 分支，过滤/排序/分组统一经 `runBlockQuery(cards, viewQuery, registry, BLOCK_ENTITY, context)`。与 PagesLibrary 完全对齐，消除新旧并存包袱。

### D3：看板视图恒按 `status` 分组；`groupBy` 仅作用于表格视图

- `BoardView` 维持现状：按 `status` 四列（Todo/Doing/Done/Canceled）自分组，忽略 `query.groupBy`（其 `query` prop 一并移除）。
- `CalendarView` 维持按 `date_refs` 自分组，移除 `query` prop。
- `TableView` 在 `query.groupBy` 非空时**渲染分组区块**（组标题行 + 组内卡片，仿 `PageTableView`），为空时平铺。

### D4：删除旧代码（TaskFilterBar / applyQuery / BlockQuery）

迁移完成后删除 `src/components/TaskHub/TaskFilterBar.vue`、`src/composables/useBlockQuery.ts`（及其 `applyQuery`/`evaluateCondition` 与对应测试 `useBlockQuery.test.ts`）、`src/types/blockQuery.ts` 类型（并清理 `types/index.ts` 的 re-export）。`queryFilterStore` 已是基于 `ViewQuery` 的独立存储，其「跳过旧 BlockQuery 行」的兼容逻辑与测试保留不动。

### D5：表格渲染分组区块（仿 PageTableView）

`TableView` 改写为 props `cards: BlockCard[]` + `groups: Group<BlockCard>[]` + `grouped: boolean` + `sort: SortRule[]`：
- `grouped` 为真 → 仿 `PageTableView` 渲染 `group-header`（组标签 + 计数）+ 组内表格；
- 为假 → 平铺表格。
- 表头排序方向图标由 `sort`（新 `ViewQuery.sort`，`{field: string, dir}` 扁平字段键）驱动，替代旧 `BlockQuery.sort` 的 `{field:{kind,key}}` 形状。

### D6：保留搜索框，父侧按 `content_preview` 过滤

`QueryToolbar` 自带搜索框（不可按消费者关闭，属共享组件），TaskHub 复用之。搜索在父侧对 `blockCardStore.cards` 做 `content_preview` 子串过滤（与 PagesLibrary 对 `page.title` 过滤同构），过滤后再进入 `runBlockQuery`。

### D7：跨记录引用（recordRef）暂不接入 TaskHub

`QueryChipBar` 的 `:cross-record-sources` 在 TaskHub 传 `undefined`（与旧 TaskHub 无跨记录引用一致）。`evaluate` 在缺少 `getById` 上下文时 recordRef 一律非匹配；因无候选源，UI 也不会暴露 recordRef 入口。后续如需「引用其他任务」可再补 `queryContext.getById` + block 源列表。

---

## 数据迁移（存量视图 JSON）

```
BlockQuery { filters:[{field:{kind,key}, op, value}], sort:[...], groupBy }
        │  blockQueryToViewQuery
        ▼
ViewQuery  { version:1,
             filter:{ combinator:'and',
                      children:[{field:key, op, value?} ...] },  // 不支持的 op 条件丢弃
             sort:[{field:key, dir} ...],
             groupBy }
```

- 新引擎 `evaluate` 不认识的 `op` → 该条件不进入 `children`（静默丢弃），保证加载后视图仍可正常渲染；用户下一次编辑即被新 `ViewQuery` 覆盖。
- 全新数据库：无存量视图，`load()` 自动建「全部任务」默认视图，直接是新 `ViewQuery`，无迁移路径触发。

---

## 后果 / 权衡

- **正面**：TaskHub 与 PagesLibrary 共用同一套查询 UI/模型/引擎，行为一致、维护单一；命名视图能力完整保留；删除约 3 个旧文件 + 旧测试，代码更干净。
- **负面 / 风险**：
  - 存量旧 `BlockQuery` 视图的 `op` 若不被新引擎支持会被静默丢弃（D1 迁移），可能导致个别老视图的筛选「看起来变了」——属已知可接受的迁移损耗。
  - `TableView` 改动较大（分组渲染 + 新 sort 形状），需同步更新其测试。
  - 搜索框 placeholder 仍显示「搜索标题...」（共享组件文案），实际过滤任务内容；文案不一致但不影响功能，留待后续统一。
- **权衡取舍**：选择「保留命名视图 + 迁移格式」而非「照 PagesLibrary 全内存态」，因为视图持久化是 TaskHub 的真实用户价值，丢弃代价高于迁移成本。选择「删除旧代码」而非保留作参考，因为本仓库已明确「并存期」结束、以新引擎为唯一真相。

---

## 术语表（Glossary）

| 术语 | 含义 | 备注 |
|------|------|------|
| `ViewQuery` | 新统一查询模型 `{version, filter:ConditionGroup, sort:SortRule[], groupBy:string\|null}` | `src/core/query` 定义；PagesLibrary 与改造后 TaskHub 共用 |
| `BlockQuery` | 旧查询模型 `{filters, sort, groupBy}`（已废弃） | 本次改造后从 TaskHub 子树移除 |
| `ConditionGroup` | 条件树节点 `{combinator:'and'\|'or', children:(Condition\|ConditionGroup)[]}` | 新引擎筛选结构 |
| `Condition` | 单条谓词 `{field:string, op, value?}` | 扁平筛选条件；旧 `BlockQuery.filters[]` 映射目标 |
| `SortRule` | 排序键 `{field:string, dir:'asc'\|'desc'}` | 新引擎；旧 `BlockQuery.sort` 为 `{field:{kind,key},...}` |
| `runBlockQuery` | 端到端引擎：过滤+排序+分组，返回 `Group<BlockCard>[]` | `useBlockQueryEngine`；`groupBy=null` 时返回单一全量桶 |
| `Group<T>` | 分组桶 `{key, label, items:T[]}` | 表格/分组渲染的基本单元 |
| `BLOCK_ENTITY` | 引擎命名空间常量 `'block'` | `useBlockQueryRegistry` 注册 Block 全部字段 |
| `QueryToolbar` | 查询工具条展示壳：筛选/排序/分组三按钮 + 可收起搜索框 | 纯展示，不持有芯片编排逻辑 |
| `QueryChipBar` | 芯片行编排器：持有完整 `ViewQuery`，暴露 `openToolbarMenu(kind, el)` 与 `update:modelValue`/`visible-change` | 筛选/排序/分组 chip 的编辑入口 |
| `FilterBuilder` | 高级筛选树构建面板（BasePopover 内） | 仅建 `ConditionGroup`，`showSortGroup=false` |
| `SortMenu` | 排序编辑器弹窗（BasePopover 内） | 多行可拖拽排序规则 |
| `命名视图` | `taskViewStore` 持久化的具名查询+视图类型（保存/切换/重命名/删除/设默认） | TaskHub 独有，PagesLibrary 无 |
| `useNewEngine` | TaskHub 旧有的「新/旧引擎」手动开关（已删除） | 本次 D2 移除 |
| `cross-record-sources` | 跨记录引用候选记录列表（recordRef 数据源） | TaskHub 本次传 `undefined`（D7） |
| `content_preview` | BlockCard 的内容预览文本 | TaskHub 搜索过滤字段（D6） |
