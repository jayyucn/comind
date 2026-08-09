# UI/UX 设计

> 更新日期：2026-08-09\
> 覆盖变更：2026-08-08 ~ 2026-08-09

用户界面和交互设计文档。

## 文档列表

| 文件 | 说明 |
| --- | --- |
| [ui-ux-spec.md](ui-ux-spec.md) | UI/UX 规格 - 视觉设计、布局规范（2026-08-09 更新：新增 TaskHub 视图布局 Token、块错误状态样式） |
| [interaction-spec.md](interaction-spec.md) | 交互规格 - 用户操作、快捷键、拖拽交互（2026-08-09 更新：§8 TaskHub 多视图交互；§9 块保存失败重试交互） |

## 新增/变更交互速览（2026-08-08 ~ 08-09）

### 1. TaskHub 任务中心（新增组件）

| 组件 | 位置 | 交互说明 |
| --- | --- | --- |
| **TaskHub.vue** | `/taskhub` 路由 | 任务管理主面板，含 TaskViewBar + FilterBar + 视图区 |
| **TaskViewBar** | TaskHub 顶部 | 视图切换（Table / Board / Calendar）、视图管理（新建/重命名/删除）、刷新按钮 |
| **TaskFilterBar** | TaskHub 视图上方 | 声明式过滤条件编辑（字段选择 / 操作符 / 值输入 / AND 组合），支持保存为 SavedFilter |
| **TableView** | TaskHub 默认视图 | 列可配置表格：行=BlockCard，列=属性/日期引用，支持行点击跳转源 Block |
| **BoardView** | TaskHub 看板视图 | 按 status 属性值分列，拖拽列内卡片（或点击状态切换），点击卡片跳转 |
| **CalendarView** | TaskHub 日历视图 | 按月展示带日期引用的 Block，月切换 + 日期点击钻取 |
| **BlockTaskItem** | IdeasTodayPanel / IdeasHistoryList | 单任务项：checkbox（切换 status）+ 内容预览 + 跳转按钮 |
| **BlockTaskList** | Ideas 拆分布局 | 任务分组列表（今日 / 待处理），聚合 BlockCard 查询结果 |

### 2. 块保存失败状态（新增交互）

**位置：** `Block/index.vue` 左侧操作区

| 状态 | 视觉 | 用户操作 |
| --- | --- | --- |
| 保存中 | 标准状态，无特殊标识 | — |
| **保存失败** | Block 左侧边缘出现 **🔴 红色小圆点**（error token），Block 背景轻量 error-subtle | 悬停红点显示 Tooltip："保存失败，点击重试"；点击红点触发重新保存流程 |
| 重试成功 | 红点消失，恢复标准态 | — |

**实现文件：** [Block/index.vue](file:///D:/comind/comind/src/components/Block/index.vue)、[_block.scss](file:///D:/comind/comind/src/styles/components/_block.scss)

### 3. Sidebar 任务项（新增）

**SidebarTaskItem.vue**：Sidebar 中快捷展示未完成任务摘要，点击跳转 TaskHub 或对应 Page。

## 快速链接

- [交互验证报告](../6-reports/interaction-spec-verification-report.md)
- [TaskHub 设计文档](file:///D:/comind/docs/superpowers/specs/2026-08-07-ideas-task-panel-design.md)
- [TaskHub 实现计划](file:///D:/comind/docs/superpowers/plans/2026-08-07-ideas-task-panel-plan.md)
