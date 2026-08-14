# ADR-0009: 页面库筛选 UX 复刻 Notion 芯片模式

- 状态：已采纳（Accepted）
- 日期：2026-08-14
- 范围：页面库（`PagesLibrary`）的筛选/排序/分组交互层——新增芯片行 + 弹出层组件，复用不改动无头查询引擎（`src/core/query`）与既有 `FilterBuilder`（高级面板）。
- 关联代码：
  - `src/components/PagesLibrary/PagesLibrary.vue`（**仅集成调用点**：Header 三按钮 + `<FilterChipBar>` + 搜索/视图切换/本地 `viewQuery` 引用；不含查询 UI 组件本体）
  - `src/core/query/types.ts`（`ViewQuery` / `ConditionGroup` / `Condition` / `SortRule` / `FieldDescriptor` —— 本 ADR 不改动）
  - `src/components/query/FilterBuilder.vue`（复用为「高级筛选」逃逸舱，经 "Add advanced filter" 进入）
  - 【新增，统归 `src/components/query/`，引擎邻接通用原语】`FilterChipBar.vue` `FilterChip.vue` `ConditionPopover.vue` `FieldSelectMenu.vue` `SortMenu.vue` `SortChip.vue` `GroupMenu.vue` `GroupChip.vue` `FilterCombinatorToggle.vue` `ChipValueEditor.vue` `filterMeta.ts`
  - 【新增】`src/components/common/BasePopover.vue`（通用弹层原语，封装现有 Teleport+overlay 样板；因是万物共享基座，居 `common/` 而非 `query/`）

---

## 背景 / 问题陈述

页面库当前的筛选入口是 `ListFilter` 按钮 → 点击展开整块 `FilterBuilder` 面板（筛选/排序/分组三区块平铺，最高 ~400px）。这是「表单面板」模式，视觉重量大、信息密度低，与 Notion 表格视图的「芯片 + 弹出层」轻模式差距明显。

Notion 的筛选 UX 特征（来自用户提供的 5 张截图）：
1. 工具栏三个并列按钮 **Filter / Sort / Group**，点击弹出各自菜单/弹层。
2. 激活后，在「视图标签页」与「列头」之间出现一行 **filter chips**（`Type ∨`、`Score ∨`、`+ Filter`）。
3. 点 chip 或 `+ Filter` → 弹出 **字段选择下拉**（搜索 + 字段列表 + 底部 "Add advanced filter"）。
4. 高级筛选面板：`Where [字段] [操作符] [值]` 规则行 + `1 rule` 徽章。

引擎侧（`ViewQuery` + 丰富 `FilterOp` + 可嵌套 `ConditionGroup`）已经具备表达 Notion 全部筛选形态的能力，**瓶颈纯粹在 UI 层**。因此本 ADR 只动交互层，复用而非重写引擎。

---

## 决策 1（D1）：完整复刻 Notion 芯片模式，不重写引擎

不修改 `src/core/query` 任何类型。芯片体系是 `ViewQuery` 的一个**投影（projection）**——芯片行的状态完全由 `viewQuery.filter / sort / groupBy` 派生，编辑芯片即不可变地改写对应字段。这是与 ADR-0008 一致的原则：组件是引擎的唯一 UI 交付物。

## 决策 2（D2）：三按钮进 Header，芯片行在 Header 与 Table 之间

- `Filter` / `Sort` / `Group` 三个按钮移到 `PagesLibrary.vue` 的 Header 右侧（搜索框与视图切换旁），常驻可见。
- 芯片行（`FilterChipBar`）渲染于 Header 与 `PageTableView` 之间。
- 芯片行**出现条件** = `筛选条件>0 OR 排序键>0 OR 已分组`。零筛选/零排序/零分组且行被收起时，整条行不渲染。
- **Filter 按钮三态**（用户追加要求）：
  - 默认态：灰色图标（无筛选）
  - active-展开态：accent 色 + 芯片行可见（有筛选且行展开）
  - active-收起态：accent 色 + 芯片行隐藏（有筛选但用户手动收起）
  - 点击 Filter 按钮 = 切换芯片行显隐（collapse/expand），与「是否有筛选」解耦。

## 决策 3（D3）：所有字段经自适应芯片入口（Q3=C）

点 `+ Filter` 或某字段 chip → 弹出 `FieldSelectMenu` / `ConditionPopover`。**每个字段类型都走芯片入口**，内部按 `FieldType` 自适应值编辑器（见 D7）。不再区分「哪些字段能快速筛」。

## 决策 4（D4）：顶层 AND/OR 用 all/any 切换（Q4=A）

芯片行最左侧有一个 `全部满足 / 任一满足` 切换，直接投影为根 `ConditionGroup.combinator`（`'and'` / `'or'`）。所有扁平 chip 共享该 combinator。嵌套 OR（超出顶层）仍属高级面板职责（见 D6）。

## 决策 5（D5）：排序/分组与筛选同处一条芯片行（Q5=A / Q13=A）

- 排序：每个排序键渲染为一个 chip（`↑ 标题` / `↓ 更新时间`），多键并列；点 chip 弹 `SortMenu`（字段 + 方向 A→Z/Z→A 切换，复用引擎 `sort[]` 多键语义）。截图显示 Notion 排序 chip 形如 `↑ Name ∨` + popover 含字段选择 + 方向 + `Add sort` / `Delete sort`。
- 分组：单个 chip（`分组：类型`），点 chip 弹 `GroupMenu`（单字段 `groupBy` 选择）；`null` = 不分组时该 chip 不渲染。
- `all/any` 切换**仅绑定筛选**，不作用于排序/分组。

## 决策 6（D6）：扁平镜像 + 嵌套聚合（Q12=A）

芯片行只在「根 `ConditionGroup` 是纯 `Condition` 列表（无嵌套子组）」时逐条渲染 chip。若用户在高级面板里建了嵌套组（或字段引用值），芯片行退化为**一个不可内联编辑的聚合 chip**（如 `3 rules` 徽章样式），点它重新打开高级面板。这样既不丢失引擎嵌套能力，又不破坏芯片简洁性。

## 决策 7（D7）：值编辑器按类型自适应 + 暴露操作符（Q7=A / Q11=A / Q14=A）

新增轻量 `ChipValueEditor.vue`，**只处理 literal 值**（跨记录引用仍走高级面板，保持 `ValueEditor` 的「业务无关」纯洁性，符合项目约定）：
- `text` → 文本输入；`op` ∈ is/isNot/contains/notContains
- `number` → 数字输入；`op` ∈ eq/neq/gt/lt；`between` 给两个框
- `date` → 内嵌 `CalendarPopover` 的 inline 模式；`between` 给起止两个日历
- `select` → 可勾选选项列表（复用 `Option[]`），选项多时列表内加搜索；隐含 `is` / `hasAny`
- `multiSelect` → 同上，值存数组；`op` ∈ hasAny/hasAll
- `boolean` → 开关（`is` true/false），无值输入
- `isEmpty` / `isNotEmpty` → **无值输入**，popover 内只给操作符切换；chip 显示「字段 为空 / 不为空」

`ConditionPopover` 内部结构：`[字段名▾] [操作符▾] [ChipValueEditor]`，默认 `op` 按类型选最优，用户可改。

## 决策 8（D8）：抽 `BasePopover.vue` 通用弹层原语（Q9=A）

现有 `CalendarPopover` / `RelationshipMenu` / `GraphView/FilterPanel` 各自 Teleport+overlay 重复样板。本轮新建 4~5 个弹层，故抽一个薄封装 `BasePopover.vue`：Teleport to body + fixed overlay + `position:{x,y}`（来自 `getBoundingClientRect`）+ Escape + `@click.self` 关闭，样式复用现有令牌（`--bg-base` / `--border` / `--shadow-modal` / `--radius-md`）。所有新弹层包一层它。

## 决策 9（D9）：高级面板经 "Add advanced filter" 进入（Q15=A）

`FieldSelectMenu` 底部加一行 `Add advanced filter`（与 Notion 截图一致），点击打开 `FilterBuilder`（作为页面库下方的可折叠面板或 modal）。之后芯片行出现聚合 chip（D6）。本轮**不做持久化**（Q6=A：交互 UX 优先，SavedFilter / URL 参数 / 命名视图留待独立迭代）。

## 决策 10（D10）：查询 UI 组件归属 `components/query/`，非 `PagesLibrary/`（2026-08-15 增补）

实施到 #32 时重新审视目录归属，结论如下：

- **事实核查**：`ChipValueEditor` / `filterMeta` / `FilterChip` / `ConditionPopover` / `FieldSelectMenu` / `FilterCombinatorToggle` / `SortMenu` / `SortChip` / `GroupMenu` / `GroupChip` 这 10 个组件，**无一 import 任何 `PagesLibrary` 专属业务**——它们只依赖 `core/query`（通用引擎）+ `common/BasePopover` + `common/CalendarPopover`。`FilterChipBar` 的契约是 `v-model: ViewQuery` + `:fields: FieldDescriptor[]` + 若干 emit，渲染的是通用芯片与通用「高级筛选」逃逸舱（`FilterBuilder` 本身已在 `components/query/`），同样零业务耦合。
- **决策**：所有查询 UI 原语（含 `FilterChipBar`）统一置于 `src/components/query/`，与 `FilterBuilder.vue` 同目录，形成 `core/query`（引擎）↔ `components/query`（引擎 UI）的镜像分层。`BasePopover` 因是万物共享的弹层基座（不独属查询），仍居 `src/components/common/`。
- **page 侧仅留集成**：`PagesLibrary.vue` 只保留调用点（`<FilterChipBar v-model="viewQuery" :fields="...">`）、Header 三按钮、搜索/视图切换、本地 `viewQuery` 引用。查询 UI 组件本体不进 page 目录。
- **搬迁代价为零**：`PagesLibrary/` 与 `components/query/` 同为 `src/components/<X>/` 二级目录，组件内部所有相对 import（`../../core/query`、`../common/BasePopover.vue`、`../CalendarPopover.vue`、`./sibling`）路径完全一致，故 `git mv` 无需改任何文件内容，仅 `PagesLibrary.vue` 的引用路径随 #34 改为 `../query/...`。

---

- **保留现有「按钮→展开全面板」模式**（Q1=B/C）：视觉重量与信息密度无法对标 Notion。
- **禁用嵌套、强制扁平**（Q12=B）：丢失引擎顶层的嵌套 OR 能力。
- **扁平展开所有 Condition 无视嵌套**（Q12=C）：改了 chip 但嵌套 OR 语义仍藏在引擎，用户会困惑。
- **复用 `ValueEditor` 进芯片 popover**（Q11=B/C）：其含「其他记录…」跨记录入口，对快速筛选过重且违反其业务无关职责边界。
- **引入 floating-ui 库**（Q9=C）：新增依赖且与现有手动定位风格不一致。

## 后续行动

1. 新建 `BasePopover.vue` 并迁移 `CalendarPopover`/`RelationshipMenu` 验证不破（可选，但推荐）。
2. 落地 D1–D9 全部组件，串联 `PagesLibrary.vue`。
3. 为 `FilterChipBar` / `ConditionPopover` / `ChipValueEditor` 补单测（参考 `FilterBuilder.test.ts`）。
4. 持久化（SavedFilter / URL）作为独立 ADR 跟踪，不在本轮。
