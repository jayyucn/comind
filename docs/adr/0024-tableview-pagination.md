# ADR-0024: TableView 渲染层分页 —— 分页在视图组件内，数据源保持全量加载

- 状态：已采纳（Accepted）
- 日期：2026-08-21
- 范围：`src/components/views/TableView.vue`（新增分页能力）；`src/components/views/TableView.test.ts`（补用例）。BoardView / CalendarView 不受影响（不启用分页）。
- 关联代码：`src/components/views/TableView.vue`、`src/components/common/QueryPageFrame.vue`（调用方，零改动）、`src/components/TaskHub/TaskHub.vue` / `src/components/PagesLibrary/PagesLibrary.vue`（间接受益）
- 来源：用户「从点滴切换页面库/任务卡顿」的性能诊断 + `/grill-with-docs` 分页设计决策（4 轮确认：动机=性能、作用对象=记录跨组连续切页、机制=页码分页、层级=TableView 内部；细节：默认 50 行/页、查询变化回第 1 页、越界 clamp、控件底部居右含行数下拉）。

---

## 背景 / 问题陈述

用户报告「从点滴（/ideas）切换到页面库（/pages）或任务（/tasks）时卡顿 1-2 秒」。诊断（2026-08-21）确认**两条独立根因**：

1. **/pages 首次卡（~2.7s）**：懒 chunk 被 dev server 初次喂模块的 backlog 排队——`routes.ts` 中 `PagesLibrary` 仍是 `() => import()` 懒加载，与图谱页已修复（`c4a78e5a` 静态化 `GraphPage`）同因漏修。已单独修复（本 ADR 之外）。
2. **/tasks 每次卡（1-2s）**：1600 个任务卡片在每次挂载 `TaskHub` 时全量渲染 DOM（`KeepAlive include="IdeasList"` 只缓存点滴列表，TaskHub 每次销毁重建）。实测 TableView 渲染耗时与行数线性相关（headless chromium：100 行 ~14ms → 1600 行 ~148ms，total ~350ms），用户 WebView 环境放大到 1-2s 合理。

**排除的假设**（证据）：
- 全局 SQLite 锁竞争（`Arc<Mutex<SQLiteAdapter>>`）：用户「从任务切页面库不卡」→ 若锁被占，页面库的 `getAllPages` IPC 也会排队，故排除；
- 页面库全量重拉：仅 122 页，数据量小，非瓶颈；
- 数据源层分页（只加载当前页）：`getAllPages`（Page 元数据，122 行）与 `get_blocks_projection`（BlockCard 投影，1600 行）均为毫秒级 IPC，且 `getCards()` 有缓存（非空不重拉）——**加载不是瓶颈，渲染才是**。

---

## 决策

### D1：分页在 TableView 内部实现（渲染层分页），数据源保持全量加载

TableView 新增可选 prop `pageSize?: number`（缺省 **50**），当前页与页大小切换为用户不可见的组件内部 `ref`。分页逻辑（slice + 页码 state + 控件）全部在组件内，**调用方 `QueryPageFrame` / `TaskHub` / `PagesLibrary` 零改动**——它们继续传全量 `items`/`groups`。

- 符合 ADR-0008「通用视图自带渲染细节」分层：分页是 TableView 的渲染能力，不是查询语义；
- **查询引擎契约不变**：过滤/排序/分组仍在前端内存对全量数据执行（`blockEngine.run`），分页只影响「渲染多少行」——筛选、排序、分组的结果完整性不受分页影响（如筛选后剩 30 条则自然单页）；
- **明确不做的**：数据源层分页（Rust 端 `LIMIT/OFFSET` + 查询下推）。当前数据规模 IPC 不是瓶颈，且下推会丢失前端实时预览（敲条件即时过滤）能力。**升级阈值**：数据量到万级、单次 IPC 到 MB 级时再评估，届时复用同一套设计（Rust 端加参数即可）。

### D2：分页作用对象 = 记录跨组连续切页

分组模式（`grouped`）下，分页作用于**全部记录的扁平序列**（排序后），每页 N 条，组头只在页面内自然出现——不做「每组内独立分页」。

- 与 `sections` 计算模型一致（平铺 = 单一全量大桶；分组 = 多桶）；
- 实现：分页切片在扁平记录上做，切片内再按原分组 key 聚合成渲染 sections（组 key/label 来自原 `groups`）；
- 语义最简：页码是「表格」的属性，不随分组结构变化。

### D3：页码重置与越界保护

- **查询变化回第 1 页**：`sort` prop、`grouped` prop、`items` 长度变化（筛选/搜索/排序改变结果集）时重置 `page = 1`。行内容编辑（`cellChange`，行数不变）不触发重置；
- **越界 clamp**：删除/筛选导致当前页超出总页数时，自动回落到最后一页（watch 总页数，`page = min(page, totalPages)`）；
- 空列表沿用现有空态（不显示分页条）。

### D4：分页控件形态

表格底部、**居右**，一行内包含：

```
[每页行数下拉框(20/50/100)]  ‹ 上一页 · 第 x/N 页 · 下一页 ›  共 M 条
```

- 行数下拉切换即时生效（改 pageSize 后 clamp 当前页），不做受控 prop——页大小是渲染偏好，组件内 state 即可（可后续上移为 config 若出现跨会话持久化需求）；
- 不做数字页码串（1 2 3 … N）：32 页数字串过长；上一页/下一页 + 页码指示满足定位需求，后续需要再加；
- **分页条抽为独立组件 `views/PaginationFooter.vue` 并固定底部（修订）**：受控组件（`page/totalPages/pageSize/total` props + `update:page`/`update:pageSize` emits，页码 clamp 由父组件负责）；`TableView` 根容器改 flex column——内容滚动区 `.table-scroll`（flex:1 + overflow:auto，表头 sticky 逻辑不变），footer 置于滚动容器外固定底部，**内容滚动时分页条保持可见**。分页状态（currentPage/pageSize）仍在 TableView 内，组件不含业务逻辑、不感知实体（与 ADR-0008/0023 分层一致）。

---

## 后果 / 权衡

- **正面**：
  - 每次挂载 /tasks 的 DOM 渲染从 1600 行降到 ≤50 行（实测 100 行 ~14ms），卡顿直接消除；
  - 调用方零改动（`QueryPageFrame` 契约不变），TaskHub / PagesLibrary 自动受益（122 页 < 50 自动单页无感）；
  - 查询引擎、数据加载、IPC 全不动——改动面最小、可逆性好；
- **负面 / 风险**：
  - BoardView / CalendarView 不受益（仍全量渲染）——用户报告卡顿在表格视图，看板/日历的虚拟化是独立 feature（可复用 `vue-virtual-scroller` 死依赖，未定）；
  - 分组模式下「组计数」（`group-count`）显示的是**全量组内条数**还是**当前页条数**需实现时明确（建议：全量——计数反映查询结果而非渲染切片）；
  - 行数下拉引入少量新 UI 文案/样式，需补测试（分页切片、重置、clamp、控件渲染）。
- **权衡取舍**：选择「渲染层分页」而非「数据源层分页」——因为诊断证实 IPC 加载毫秒级且非瓶颈、查询引擎需全量内存、实时预览不可牺牲；数据源分页的收益（省几十 ms IPC）远小于成本（架构改动 + 失去实时过滤）。选择「TableView 内部」而非「QueryPageFrame 外壳」——分页是视图渲染细节，外壳不掺渲染（与 ADR-0008/0023 分层一致）；外壳持有会改变 `items` 语义（切片而非全量），反而更隐蔽。

---

## 术语表（Glossary）

| 术语 | 含义 | 备注 |
|------|------|------|
| 渲染层分页 | 分页仅作用于 TableView 的渲染切片（slice），数据源保持全量加载；查询引擎对全量数据执行过滤/排序/分组 | ADR-0024 D1 |
| 记录跨组连续切页 | 分组模式下分页作用于全部记录的扁平序列，组头随切片自然出现；非每组内独立分页 | ADR-0024 D2 |
| 页码重置 | 查询输入变化（sort/grouped/items 长度）时当前页回第 1 页；行编辑不触发 | ADR-0024 D3 |
| 越界 clamp | 删除/筛选后当前页超出总页数时回落到最后一页 | ADR-0024 D3 |
