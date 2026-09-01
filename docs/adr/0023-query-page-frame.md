# ADR-0023: 查询页外壳 QueryPageFrame —— 整页骨架与编排内聚

- 状态：已采纳（Accepted）
- 日期：2026-08-21
- 范围：`src/components/common/QueryPageFrame.vue`（新建）、`src/components/TaskHub/TaskHub.vue`、`src/components/PagesLibrary/PagesLibrary.vue`（迁移）；lib-body 容器样式统一为带边框卡片。
- 关联代码：
  - 新建：`src/components/common/QueryPageFrame.vue`
  - 迁移：`src/components/TaskHub/TaskHub.vue`、`src/components/PagesLibrary/PagesLibrary.vue`
  - 复用：`src/components/common/NamedViewBar.vue`、`src/components/common/PageTitle.vue`、`src/components/query/QueryToolbar.vue`、`src/components/query/QueryChipBar.vue`、`src/composables/useChipBarOrchestration.ts`（ADR-0022 Q6）
- 来源：用户对「将 TaskHub.vue 里的 NamedViewBar、QueryChipBar、lib-body 抽象出来」的 `/grill-with-docs` 决策（2 轮确认，全部按推荐）。

---

## 背景 / 问题陈述

`TaskHub.vue` 与 `PagesLibrary.vue` 是仓库里仅有的两个「查询页」——它们各自装配了**完全相同的一整套页面骨架**：

```
PageTitle + NamedViewBar(slot QueryToolbar) + QueryChipBar + <main class="lib-body">
```

差异仅在业务侧（entity key、视图类型、字段注册表、跨记录源、主内容区的视图切换），而骨架与编排是**逐字重复**：

- 装配代码约 40+ 行两页复制（NamedViewBar 的 QueryToolbar slot 绑定、QueryChipBar 的 workingQuery 绑定、chipBarVisible 同步）；
- `useChipBarOrchestration(viewQuery)` 的 9 行编排（ADR-0022 Q6 已抽成共享 composable）在每个页面重复调用与接线；
- `lib-body` 的 `<main>` + 样式在每页重复定义，且两页样式不同（TaskHub 带三边边框 + 底部圆角，PagesLibrary 无边框）——连类名 `lib-body` 都是 PagesLibrary 语义泄漏进 TaskHub 的痕迹。

`NamedViewBar` 与 `QueryChipBar` 虽已独立成组件，但「页面级骨架 + 编排」这一层从未抽象——新增第三个查询页（如未来某实体页）仍要复制整段装配。

---

## 决策

### D1：新建 `common/QueryPageFrame.vue` 整页外壳，装配与编排全部内聚

外壳组件持有并接线：

- `PageTitle`（title/subtitle prop）
- `NamedViewBar`（entityKey/viewTypes/defaultViewName/defaultViewType prop）+ 其 slot 内注入 `QueryToolbar`（搜索 v-model + 三按钮转发）
- `QueryChipBar`（fields/registry/crossRecordSources prop；绑定 `store.workingQuery` / `setWorkingQuery`）
- `<main class="lib-body">` 主内容区（默认 slot，消费方注入视图切换）
- **编排内聚**：外壳内部调用 `useScreenViewStore(entityKey, ...)` 与 `useChipBarOrchestration(viewQuery)`，页面不再重复任何编排接线。

外壳零业务依赖：只依赖 `core/query` 类型、`core/view/management` 的 `ViewTypeOption`、共享 composable 与通用组件，不 import 任何实体 store/registry（符合 ADR-0009 分层）。消费方仅需注入 props + 默认 slot。

### D2：TaskHub 与 PagesLibrary 均迁移到外壳；lib-body 样式统一

- 两页同时迁移（外壳立刻有真实第二消费者，契约被验证）；
- 页面层保留业务：数据 store、查询引擎与字段清单、布局配置解析（TaskHub）、跨记录源（PagesLibrary）、搜索过滤（依赖外壳 `v-model:search`）、视图切换 slot、事件处理；
- **lib-body 样式统一为 TaskHub 的「带三边边框 + 底部圆角 + margin-bottom」卡片形态**——与 NamedViewBar 的顶边边框拼成完整卡片。PagesLibrary 外观顺带升级，两页视觉一致。不为单一视觉差异保留 prop（简约优先）。
- 页面不再定义 `.lib-body` / 根容器样式（外壳承担）；页面内仅在 slot 中保留自己的空态样式（如 `.task-hub-empty`）。

### D3：`entityKey` 单一 prop 同时充当 screen_view 命名空间与引擎实体命名空间

NamedViewBar 需要 `entityKey`（screen_view.entity），QueryChipBar 需要 `entityType`（引擎命名空间）。当前两个页面两者恒同值（`'block'` / `'page'`），外壳合并为一个 `entityKey` prop 内部复用。

**假设**：screen_view 是按实体隔离的命名视图存储，其 entity 键与查询引擎的实体命名空间天然同构。若未来某实体需分离二者，再拆分为两个 prop 即可（当前不存在该场景，不为它设计）。

### D4：搜索词契约 `v-model:search`

外壳持有搜索输入态（喂 QueryToolbar 的 `v-model`），通过 `search` prop + `update:search` emit 与父级双向同步；父级经 `v-model:search` 接收并在自己的数据 computed 里做子串过滤（TaskHub 按 `content_preview`、PagesLibrary 按 `title`）。外壳不做任何过滤——过滤逻辑与实体数据绑定，留在业务层。

### D5：命名与分层

- 组件名 `QueryPageFrame`，置于 `common/`（与 NamedViewBar/PageTitle 同目录）；
- `Query` 前缀呼应 ADR-0014 的命名约定（query 级展示壳），`Frame` 表达「页面骨架/外壳」语义；
- 外壳仅做装配与编排，不感知任何实体——后续新增查询页只需复制「props + slot」调用面，不再复制骨架。

### D6：主内容区由消费方经具名 slot 注入视图，外壳零视图耦合（二次修订）

**修订背景**：D6 初版用具名 slot（`#table/#board/#calendar`），后修订为「外壳硬编码渲染通用三件套」
（Table/Board/Calendar，ADR-0028 通用化），理由是当时视图皆字段驱动、实体无关。但 `QuadrantView`
（艾森豪威尔矩阵，直接 `import type { BlockCard }`、吃 `priority`/`status`/`deadline`）是**任务专有视图**，
被塞进通用外壳后破坏了 ADR-0009「零业务依赖」契约，且「三件套」描述与现实不符（实为四件）。故二次修订
回退到具名 slot 方案——这次前提成立：视图是否通用、有哪些视图，完全由消费方决定。

外壳为泛型组件（`generic="T"`），`lib-body` 仅渲染一个具名 slot（不再 import 任何视图组件）：

```
<main class="lib-body">
  <slot :name="currentViewType" :context="viewContext" />
  <div v-if="!$slots[currentViewType]" class="view-empty">暂无可用的视图</div>
</main>
```

- **`currentViewType`**：由 `useScreenViewStore(entityKey)` 得出（与 NamedViewBar 同源），即 slot 名；
  `viewTypes` prop 决定 NamedViewBar 可建哪些 tab 类型，`currentViewType` 不会越出；
- **`viewContext`**：外壳把共享数据契约打包成对象透传给 slot——`items/fields/groups/grouped/sort/
  groupBy/tableConfig/boardConfig/calendarConfig/quadrantConfig/idKey/cellRegistry`；
- **视图组件与事件由消费方在 slot 内注入**：`TaskHub` 提供 `#table/#board/#calendar/#quadrant`
  （各自绑定 `ctx` + 事件 `cell-change`/`navigate`/`open-block`/`add-item`），`PagesLibrary` 仅
  `#table/#calendar`；外壳不再 `emit` 任何视图事件（仅透传 `update:search`）；
- **`CalendarConfig.dateRefKind` 从字面量放宽为 `string`**：原 `'deadline'|'schedule'` 仅适用 Block 的
  date_refs；Page 无这两个字段，日历按 `updatedAt` 落格（沿用原 PageCalendarView 语义），由
  `PAGE_DEFAULT_CALENDAR_CONFIG`（`dateRefKind: 'updatedAt'`）表达。CalendarView 本就按
  `fields.find(f => f.key === config.dateRefKind)` 动态查找字段，渲染逻辑零改动；
  `refColorClass` 对非 schedule 走 deadline 颜色分支（过去标红），仅视觉小差异，接受；
- **好处**：外壳真正成为零业务依赖的纯骨架（ADR-0009 契约诚实兑现）；新增第 5 种视图类型只需扩展
  `ViewKind` + 实体 registry 的 `defaultConfig` + 消费方加一个 slot，外壳与另一消费方零改动
  （消除 Shotgun Surgery）。

### D7：上游修复——默认布局归实体注册点，store 经注入接收（修订后续）

**背景**：D6 落地后暴露上游缺陷——`stores/screenView.ts`（实体无关）在 seed/create 时调用
`core/view` 的 `defaultLayoutConfig()`，而该函数产出的是 **Block 专属默认**（DEFAULT_TABLE_CONFIG 七列、
`dateRefKind:'deadline'`）。对 Page 实体写入的是无效字段 config，通用 TableView 按列渲染全空
（已在 PagesLibrary 侧临时忽略持久化 config 修复渲染，但上游错误仍在）。

**决策**：
- **默认布局真相归实体注册点**：Block 默认（`BLOCK_DEFAULT_TABLE_CONFIG/BOARD/CALENDAR` + `blockDefaultConfig`）
  迁至 `useBlockQueryRegistry`；Page 默认（`PAGE_DEFAULT_*` + `pageDefaultConfig`）已在 `usePageQueryRegistry`；
  **core/view 移除 `DEFAULT_TABLE_CONFIG` 与 `defaultLayoutConfig`，只留协议**（LayoutConfig 类型 + parseLayoutConfig）；
- **store 经 options 注入默认布局**：`useScreenViewStore(entityKey, { defaultConfig: (kind) => LayoutConfig })`，
  seed/create 时用注入值写 config；**未注入则写空串**（渲染层「无 config → 回退消费方默认」兜底）。
  页面（父组件 setup）先于外壳/NamedViewBar（子组件）创建 store，注入时序可靠；
- **消费方回退引用实体默认**：TaskHub 回退 `blockDefaultConfig(kind)`、PagesLibrary 恢复
  `parse ?? PAGE_DEFAULT_*`（seed 已写入正确 config，缺失才回退）；
- **存量数据清理**：清空存量 page 实体 tab 的错误 config（`UPDATE screen_view SET config='' WHERE entity='page'`），
  让回退逻辑接管；block 存量 config 为正确字段，不动。

**权衡**：选择「注入」而非「seed 置空」——config 是 View 的固有属性（ADR-0005/0006），seed 即写入实体正确默认，
比「永远缺席、靠组件回退」更贴合模型，且未来列配置 UI 的 diff 基准正确。代价是 store 多一个注入接口。

---

## 后果 / 权衡

- **正面**：两页合计删除约 80 行重复装配与样式 + 删除两个 Page 专属视图（约 400 行硬编码渲染）；新查询页零成本复用外壳；页面回归纯业务（数据 + 引擎 + props + 事件）；lib-body 类名不再泄漏；视图切换与空态由外壳统一承担；Page 视图与 Block 视图共用一套通用渲染器，行为一致；**默认布局真相单一来源（实体注册点）、store 零实体假设、core/view 协议层干净（D7）**。
- **负面 / 风险**：
  - PagesLibrary 主内容区外观变化（无边框 → 带边框卡片）——属有意统一，Q3 已确认；
  - PagesLibrary 表格视觉与交互变化（原 PageTableView 硬编码列/type 徽章 → 通用 TableView 字段驱动列/select 菜单）——列等价但样式细节略有差异，接受（D6 修订）；
  - 外壳 props 较多（约 19 个），但全部为透传或页面级配置，无业务耦合；
  - `CalendarConfig.dateRefKind` 放宽为 string 后失去字面量约束——由字段注册表约束兜底（CalendarView 找不到字段则空日历）；
  - `useScreenViewStore` 在外壳与页面两处调用（同 key pinia 单例）——页面保留调用仅为读取 `currentTab`/`workingQuery`，若未来外壳需要暴露这些只读值可再收敛；
  - store 的 `defaultConfig` 注入依赖「页面先于子组件创建 store」的时序——当前成立（父 setup 先于子 setup），新增页面需遵循同一模式。
- **权衡取舍**：选择「外壳内聚编排」而非「外壳仅做布局壳 + 页面继续接线」，因为编排接线正是两页重复最重的部分，留在页面则抽象只完成一半。选择「合并 entityKey」而非「双 prop 显式透传」，因为当前两处恒同值，双 prop 是为不存在的场景留设计。选择「store 注入默认布局」而非「seed 置空走回退」（D7），因为 config 是 View 的固有属性，seed 即写入正确默认更贴合模型。

---

## 术语表（Glossary）

| 术语 | 含义 | 备注 |
|------|------|------|
| `QueryPageFrame` | 查询页外壳：装配标题、命名视图条（Screen→Tab）、查询工具条、芯片行与主内容区的整页骨架组件；编排（芯片显隐/激活态/按钮转发、命名视图 store 绑定、搜索词持有）内聚其中；泛型组件（generic="T"），主内容区经具名 slot（`#<viewType>` + `viewContext`）由消费方注入视图，外壳零视图耦合 | `src/components/common/`；零业务依赖（ADR-0009） |
| `lib-body` | 外壳的主内容区容器（`<main>`）：带边框卡片形态，flex:1 + 滚动 | 类名保留历史拼写 |
| `v-model:search` | 外壳与消费方之间搜索词的受控契约：外壳持有输入态，父级经 `update:search` 落库并做数据过滤 | ADR-0023 D4 |
| `entityKey` | 外壳单一命名空间 prop：同时充当 screen_view.entity（NamedViewBar）与查询引擎实体命名空间（QueryChipBar） | ADR-0023 D3；当前两处恒同值 |
| 视图数据契约 | 外壳打包透传给具名 slot 的 `viewContext` 对象：items/fields/groups/grouped/sort/groupBy/tableConfig/boardConfig/calendarConfig/quadrantConfig/idKey/cellRegistry；视图组件与事件（cell-change/navigate/open-block/…）由消费方在 slot 内自行接线 | ADR-0023 D6 |
| `PAGE_DEFAULT_TABLE_CONFIG` / `PAGE_DEFAULT_CALENDAR_CONFIG` / `PAGE_DEFAULT_BOARD_CONFIG` | Page 实体内建默认布局：表格 6 列（标题/类型/创建/更新/字数/子页面）、日历按 updatedAt 落格、看板默认徽章集 | `usePageQueryRegistry`；替代原 PageTableView/PageCalendarView 硬编码 |
| `BLOCK_DEFAULT_TABLE_CONFIG` / `BLOCK_DEFAULT_BOARD_CONFIG` / `BLOCK_DEFAULT_CALENDAR_CONFIG` | Block 实体内建默认布局：表格 7 列（done/content/status/priority/project/deadline/page）、看板徽章 priority+deadline、日历按 deadline 落格 | `useBlockQueryRegistry`；自 `core/view` 上收（D7） |
| `blockDefaultConfig` / `pageDefaultConfig` | 实体默认布局统一入口：`(kind) => LayoutConfig`，经 `useScreenViewStore` options 注入，seed/create 写入正确 config | ADR-0023 D7；未注入时 store 写空串、渲染层回退 |
