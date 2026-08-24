# ADR-0027: TableView 与 Task 解耦（通用字段驱动表）

- Status: accepted
- Date: 2026-08-17
- Supersedes: — (extends ADR-0005 / ADR-0006)
- Related: ADR-0005 (View/ViewQuery 模型), ADR-0006 (LayoutConfig schema)

## Context

`comind` 的视图模型已在 ADR-0005 重定义为「实体无关」：`View` 属于 `Screen`，适用于任意实体，而非仅 Task。`TableView.vue` 原位于 `TaskHub/views/`，却把**任务语义写死在组件内**：

- 字面量 `STATUS_OPTIONS = ['Todo','Doing','Done','Canceled']`、`PRIORITY_CONFIG`（P0–P3 配色）；
- `getStatus/getPriority/getDeadline/isDone/toggleDone` 等任务专属取值与交互；
- `props` 强绑 `BlockCard`，`emit('statusChange')` 直接对应「改状态」这一任务动作；
- `done` 勾选、`done` 行置灰、`deadline` 过期红色高亮、`priority` 彩色徽章均为组件内硬编码。

这与 ADR-0005「视图通用于任意实体」直接冲突：一个表格组件不该知道 Todo/Done 或优先级配色。

调研同时发现两块可复用的现状：

1. **查询引擎已有字段描述符体系** `FieldDescriptor{key,label,type,get,options}`（ADR-0002），Block 注册表（`useBlockQueryRegistry`）已声明 `status`(select+选项)/`priority`(select)/`project`/`dateRefDate`(date) 等。
2. **`priority` 的配色在数据中并不存在**——`ClosedValue` 只有 `{value,label,icon}`，原 `PRIORITY_CONFIG` 的 P0–P3 配色是组件本地写死，且与注册表的 `Low/Medium/High/Urgent` 取值还对不上（潜在不一致）。

结论：让 `TableView` 按字段描述符类型**通用渲染**，把任务专属交互上提为**字段元数据**，组件零任务代码。

## Decision

`TableView` 改写为**实体无关、字段驱动的通用表**（Vue 3.5 SFC 泛型 `generic="T"`）：

- `props`: `items: T[]`、`fields: FieldDescriptor[]`、`groups`、`grouped`、`sort`、`config?: TableConfig`、`idKey?: string`；
- `emit`: `cellChange(itemId, fieldKey, value)`（boolean/select 可编辑列）、`navigate(itemId)`（行/链接列）；
- 每格按 `FieldDescriptor.type` 渲染：`boolean`→可编辑勾选、`select`→带色下拉、`multiSelect`→徽章、`date`→文本、`text/number`→文本；
- 任务专属装饰走 `TableColumnConfig.role`（`'primary' | 'link' | 'overdue-date' | 'done'`），**留在 `LayoutConfig`**（渲染元数据归宿，ADR-0006），不污染无头 `FieldDescriptor`；`role: 'done'` 驱动行 `.is-done` 置灰。

任务 UX 上提为字段元数据：

- `core/query/types.ts`：`Option` 增加可选 `color`（无头求值忽略）。
- `core/view/types.ts`：`TableColumnConfig` 增加 `role`。
- `useBlockQueryRegistry.ts`：新增四个内置字段 `content`(text, primary)/`page`(text, link)/`done`(boolean, 由 `status==='Done'` 派生)/`deadline`(date, 取 `date_refs` 中 `deadline` kind)；`priority` 选项挂 `color`。

`TaskHub` 仅负责接线：`TableView` 接 `:fields="blockRefFields"`、`:items="flatCards"`、`:id-key="'block_id'"`；新增 `onCellChange(blockId, key, value)` 把 `done`/`status` 映射回 `handleStatusChange`，其余走 `propertyStore.setProperty`。

## Considered Options

### 解耦深度

- **(A) 通用字段驱动（选定）**：TableView 实体无关，靠 FieldDescriptor + TableConfig 渲染，事件通用化。最贴合 ADR-0005，可服务任意 Screen（含未来 PagesLibrary）。需给字段系统补少量元数据。
- **(B) 轻量去硬编码**：仍 `BlockCard` 类型，但用 block registry 驱动渲染、去除 Todo/Done/P0 字面量。改动小，但组件仍驻 `TaskHub/views`，未彻底解耦。
- **(C) 通用 + Task 插槽**：TableView 通用 + cell 插槽，TaskHub 包一层 `TaskTableView` 注入任务渲染。TableView 零任务代码，但多一层包装、插槽逻辑。

选 A：与已落地的视图模型一致，且字段描述符本就是「实体无关字段知识」的既定归宿。

### 任务交互（done/配色/截止高亮）去向

- **(A) 上提字段元数据（选定）**：Option.color + content/page/done/deadline 字段。全仓受益（芯片菜单等亦可显示配色选项）。
- **(B) 暂舍弃**：status 变纯下拉、取消快速 done/配色/过期高亮。UX 回退，不取。

### 行级 done 置灰

- 经 `role: 'done'` 驱动 `.is-done`（通用完成态表现），而非组件内 `status==='Done'` 硬编码。保留 UX，零任务代码。

## Consequences

- **正面**：`TableView` 不再 import/hardcode 任何 Task 概念，可复用于任意实体；任务 UX 由字段元数据承载，配色数据归一（修掉 P0–P3 与 `Low/High` 不一致的隐患）；列序/列宽/装饰全部 `TableConfig` 驱动，与 ADR-0006 一致。
- **中性**：`priority` 由「彩色徽章（只读）」变为「带色下拉（可编辑）」——交互更一致（status 同样是下拉），颜色以圆点+标签呈现；`done` 计数头（`x/total`）移除（任务专属，通用表不保留）。
- **需跟进**：`TableView` 当前仅 TaskHub 使用；`BoardView`/`CalendarView` 仍各自写死任务逻辑（不在本次范围，属后续同类解耦）。`TaskViewRust` 持久化 `config` 字段（ADR-0005 项②）落地后，`tableConfig` 由 `parseTableConfig(currentView.config)` 提供，组件无需改动。
- **验证**：`TableView.test.ts` 18 例（通用字段驱动 API）、`useBlockQueryRegistry.test.ts` 15 例全过。未跑全量 `vue-tsc`/`vite build`（仓库过大）；`npm run dev` 手测建议：勾选完成、状态下拉、优先级配色圆点、截止红色、链接跳转、分组、列序按 config。

## Known Issues & Tech Debt（grill 复盘, 2026-08-17）

对本次改造做缺陷审计（grill），结论如下：

- **D1（已修复，曾是 bug）**：`deadline` 字段原 `get` 仅取 `date_refs` 中 `deadline` kind，导致**仅含 `schedule` 日期的卡片在表格/看板丢失日期**。已改为 `find(deadline) ?? find(schedule)`，并新增 `schedule` 内置 date 字段供 CalendarView 按 `dateRefKind='schedule'` 入桶。回归测试见 `TableView.test.ts`「schedule-only date_ref」用例。
- **D2（故意保留）**：`cell-deadline` 对所有**未来日期**也渲染橙色（`--warning`），而非仅逾期红。用户确认「未来日期也橙色更醒目」为有意设计，非缺陷。
- **D3 / D4（已知 UX 技术债，后续补）**：
  - D3：截止只显示 `MM-DD`，丢年份（跨年任务显示错误日期）。
  - D4：完成进度 `DONE_COUNT/total` 表头被移除（通用表不保留任务专属头）。
  - 二者为纯 UX 回退、非架构必须，记入技术债，待「UX 打磨」阶段补回（年份格式 / 通用完成进度指标）。
- **D5（config 仍是只读桩，已知限制）**：`tableConfig`/`boardConfig`/`calendarConfig` 目前恒为组件内默认 seed（`TaskViewRust` 尚无 `config` 列，ADR-0005 项②暂缓），用户**尚不能**在 UI 编辑列序/列宽/看板徽章。是 ADR-0005 迁移的待办，非本次遗漏。
- **D6 / D7（已由 ADR-0028 解决）**：三个视图现已全部通用化并迁移至 `src/components/views/`（不再驻 `TaskHub/views`），看板/日历也改为字段驱动，消除「一个通用、两个写死」的架构分叉。详见 ADR-0028。

> 教训：绿测试曾掩盖 D1/D3/D4 的回归路径——这几个用例原本未覆盖 `schedule` 兜底、年份、完成进度。已补 `schedule-only` 回归用例；D3/D4 待 UX 阶段补测试。
