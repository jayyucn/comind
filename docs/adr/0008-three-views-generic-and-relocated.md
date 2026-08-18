# ADR-0008: 三个视图全部通用化并迁移至 components/views

- Status: accepted
- Date: 2026-08-17
- Extends: ADR-0005 (View 模型), ADR-0006 (LayoutConfig), ADR-0007 (TableView 解耦)
- Related: ADR-0002 (字段注册表解耦)

## Context

ADR-0007 把 `TableView` 改写为实体无关、字段驱动的通用表，但当时 `BoardView`/`CalendarView` 仍是**任务专属硬编码**（写死 `STATUS_OPTIONS`/`PRIORITY_COLORS`、`BlockCard` 强绑、`date_refs` 直读），且三个视图都驻在 `TaskHub/views/`。这与 ADR-0005「视图通用于任意实体」只落地了 1/3，造成两个真问题：

1. **架构分叉（D7）**：切换 `viewKind` 时，一个是通用字段驱动、两个写死任务逻辑——未来要修得修三遍，且「视图系统」名不副实。
2. **位置误导（D6）**：`TableView` 已 `generic="T"`、零 `BlockCard`，却躺在 `TaskHub/views/`，名字也在骗后来人「这是任务专属表」。

grill 复盘确认：本意是**一次性让三个视图都通用**，并把通用视图作为可复用的「视图系统」资源。

## Decision

### 1. 三个视图统一为字段驱动通用组件

`BoardView`/`CalendarView` 同 `TableView` 改为 `generic="T"`，完全靠 `FieldDescriptor[]` + `LayoutConfig` 渲染，删除一切任务字面量与 `BlockCard` 强绑：

- **BoardView**：`props` = `items` / `fields` / `groupBy`(分组字段 key，通常来自 `ViewQuery.groupBy`) / `config?: BoardConfig` / `idKey?`；`emit` = `cellChange(itemId, groupBy, colValue)`（拖拽改分组）/ `navigate`。列由 `groupBy` 字段的 `options` 派生；卡片标题取 `content` 字段；卡片徽章由 `config.cardFields`（默认 `[]`，块实体经 TaskHub 注入 `['priority','deadline']`）按字段类型通用绘制（select 带色圆点、date 逾期标红）。
- **CalendarView**：`props` = `items` / `fields` / `config: CalendarConfig` / `idKey?`；`emit` = `navigate`。按 `config.dateRefKind` 选定 `deadline`/`schedule` 字段取值（`date_day`）入桶；颜色类由 `dateRefKind` + 是否逾期派生。不再直读 `date_refs`。
- 二者均**不 import `BlockCard`**、不含 `Todo/Done/P0` 字面量；任务 UX 全由字段元数据（选项 color、`overdue-date` role）承载。

### 2. 迁移到共享位置

三个通用视图从 `src/components/TaskHub/views/` 移至 `src/components/views/`，与 `core/view`(schema) 组成一致的「通用视图系统」包。`TaskHub` 仅保留接线（注入 `blockRefFields`、各 `config` seam、事件路由）。

### 3. schema 增补

- `BoardConfig` 增加 `cardFields?: string[]`（卡片额外徽章字段，渲染专属，不重复存分组列）。
- `useBlockQueryRegistry` 新增 `schedule` 内置 date 字段（配合 `CalendarConfig.dateRefKind='schedule'`）；`deadline` 字段 `get` 修复为 `find(deadline) ?? find(schedule)`（见 ADR-0007 D1）。

## Considered Options

### 三视图通用化范围

- **(A) 一次性全部通用（选定）**：Board/Calendar 同 Table 改为字段驱动并迁移。彻底消除分叉，视图系统名副其实。工作量最大但一次到位。
- **(B) 仅 Table 通用、Board/Calendar 留任务硬编码**：最小改动，但 D6/D7 不解决，未来维护三套逻辑。
- **(C) 抽象共享 BaseView**：抽基类统一三视图。过度抽象，违反「简约优先」——三者渲染结构差异大（表/列/网格），共性只在「字段驱动」理念，不值得建继承层。

选 A：与 ADR-0005 一致，且 `FieldDescriptor` 体系已能同时支撑查询与渲染（见 graphify 复盘），通用化边际成本低。

### 看板分组列来源

- **(A) 复用 `ViewQuery.groupBy`（选定）**：分组列即当前查询的分组字段，与表格分组同源；`BoardConfig` 不重复存。`groupBy` 为 `null` 时 TaskHub 回退 `'status'`。
- **(B) BoardConfig 自带 groupField**：与 `ViewQuery.groupBy` 可能不一致，冗余。

### 卡片徽章字段

- **(A) `config.cardFields` 显式列出（选定）**：任意 Screen 自定卡片上显示哪些字段徽章；通用组件零块假设。
- **(B) 组件内置默认 `['priority','deadline']`**：把块假设写死进通用组件，违反 D6 初衷。故默认 `[]`，块实体调优由 TaskHub 的 `boardConfig` 注入。

## Consequences

- **正面**：三个视图类型/渲染完全对称，均实体无关、可服务任意 Screen；`TaskHub/views/` 目录消失，消除位置误导；`FieldDescriptor` 一处注册、查询菜单与三视图同时受益（graphify 已证）。
- **中性**：`TableView` 之前无 `BoardView`/`CalendarView` 测试，本次补 `BoardView.test.ts`(10)、`CalendarView.test.ts`(5)、`TableView.test.ts` 增至 20（含 D1/D8 回归），并随文件迁移到 `components/views/`。
- **需跟进**：
  - D3/D4（年份格式、完成进度头）仍为已知 UX 技术债（ADR-0007）。
  - D5：`tableConfig`/`boardConfig`/`calendarConfig` 仍是 seam，待 `TaskViewRust` 加 `config` 列（ADR-0005 项②）后由 `parseXConfig(currentView.config)` 提供。
  - `PagesLibrary` 的 `viewMode` 仍未接入统一 View 模型（ADR-0005 项③，用户暂缓）。
- **验证**：`components/views/*` 三测试 + `useBlockQueryRegistry.test.ts` 全绿（50 例）。未跑全量 `vue-tsc`/`vite build`；`npm run dev` 手测建议：看板拖拽改状态、日历按 deadline/schedule 入桶与配色、三视图切换、列序/徽章由 config 驱动。
