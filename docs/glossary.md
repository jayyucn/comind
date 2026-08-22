# Glossary（术语表）

> 项目领域术语与约定的单一来源。新增术语请追加，保持简短、可检索。

## O

**浮层滚动条 (Overlay Scrollbar)**
一种滚动指示条：平时隐藏，仅在用户滚动内容或悬停于可滚动容器时浮现于内容之上，停止交互后自动淡出。它**不占用布局空间**（不挤压内容、无布局偏移），区别于常驻于滚动槽、始终占据宽度的原生滚动条。本项目实现见 `src/utils/overlayScrollbar.ts` 与 `src/styles/components/_scrollbar.scss`，作为全局默认行为覆盖所有可滚动容器（Chromium 系）。

## S

**单例浮层 (Single Overlay Instance)**
全局仅创建一个浮层 DOM 元素，按当前活动滚动容器的几何实时定位，而非为每个容器各建一个。配合事件委托实现「全局默认、零 per-element 接线」。

## D

**脏点 (Dirty Marker)**
标记某个 Tab 的「可编辑查询 `workingQuery`」与其已提交 `query_json` 不一致、存在未保存更改的状态。store 中以 `dirty`（当前 Tab）与 `dirtyByTab`（全部 Tab 的 `Set<string>`）表达；切走时会把改动暂存为草稿，切回时恢复并保持脏点。

## N

**NamedViewBar**
可复用的两级（Screen→Tab）命名视图管理组件（`src/components/common/NamedViewBar.vue`），按 `entityKey` 隔离。负责 Screen 下拉（新建/重命名/设为默认/删除/计数）、Tabs 条（类型图标 + 名称 + 激活下划线 + 内联脏点「你调整了{筛选|排序|分组} 清除 保存」+ `…` 菜单的 重命名/复制/删除）、新建 Tab 弹窗。查询工具条（`QueryToolbar`+`QueryChipBar`）由消费方经 `<slot/>` 注入，消费方自己持有搜索/查询状态。取代原单级、与 Block 强耦合的 `TaskViewBar`。脏提示文案由 `diffQueryParts`（`src/core/view/management.ts`）按实际改动的查询部分生成，多者按 筛选>排序>分组 优先级排列。

## S

**Screen（命名容器 / 界面级）**
两级层级中的上层，对应一个业务界面（如任务中心、页面库）。`screen_view` 表中以 `parent_id` 为空串表示。携带 `name` 与全局唯一的 `is_default` 默认标记，本身不含查询；其子级 Tabs 各持一份 `ViewQuery`。记住每个 Screen 上次打开的 Tab。

**Screen→Tab 两级层级 (Two-Level Screen→Tab Hierarchy)**
视图管理模型：Screen（命名容器）一对多拥有 Tabs；Tab 即 ADR-0005 的「View」——一个固定 `view_type`（table/board/calendar，创建后不可改）的渲染界面，独占一份 headless `ViewQuery`。单一 `screen_view` 表以 `parent_id` 区分布局（空串=Screen，非空=Tab 所属 Screen 的 id）。见 ADR-0009。

## T

**Tab（视图标签 / 实例级）**
两级层级中的下层，等价于 ADR-0005 定义的「View」：一个固定渲染类型（创建时选定、之后不可变）的界面，拥有自己的 `query_json`（headless `ViewQuery`）与 `config`（`LayoutConfig`）。隶属于某个 Screen；同 Screen 内至少保留一个 Tab。

## W

**working query（可编辑查询）**
当前激活 Tab 正在编辑的 `ViewQuery`（`store.workingQuery`）。筛选/排序/分组预览直接由它驱动，故未保存即实时预览；仅当点击「保存」时经 `updateTab` 持久化。与已提交的 `query_json` 比较得出脏点。

**草稿暂存 (Draft Stash)**
切走一个
脏 Tab/Screen 时，把其 `workingQuery` 暂存进 `store.drafts[tabId]`；切回时恢复该草稿并保持脏点。保证跨 Tab、跨 Screen 切换不丢失未保存的筛选调整。

## F

**字段管理面板 (Field Management Panel)**
`QueryToolbar.vue` 最右侧「字段」按钮（`emit('fields')`）触发的 popover 内容，由消费方（`QueryToolbar` 上层、持有 `config` 的那层）经由 `BasePopover` 持有并渲染。面板本身是通用组件 `FieldManagerPanel.vue`（接收 `fields`/`activeFields`/`candidateFields`/`currentTabVisibleKeys`，emit `toggleVisibility`/`reorder`/`addGlobal`/`removeGlobal` 意图），不持有任何持久化逻辑；跨 Tab 的「全局」语义由消费方实现。分两段：编辑开关关时仅显示第一组（per-tab 显示/隐藏 + 拖拽排序）；开关开时出现第二组的 `+` 与每行的删除，对应全局增/删。见 ADR-0011。

**在用字段集 (Active Field Set)**
字段管理面板的第一组：当前属于本表的字段（出现在 ≥1 个 Tab 的 `TableConfig.columns` 中，全局操作后各 Tab 一致）。每行 `⋮⋮`(per-tab 拖拽排序) + 字段图标 + 字段名 + 👁(per-tab 显示/隐藏)；编辑开关开时 👁 右侧追加 🗑(全局移除)。👁 关的字段仍保留在第一组（全局仍在用），仅当前 Tab 暂不渲染。

**候选字段池 (Candidate Field Pool)**
字段管理面板的第二组：在 `props.fields` 中但不在「在用字段集」的字段。仅编辑开关开时显示。每行 字段图标 + 字段名 + `+`(全局新增：加入所有 Tab 的 `columns` 并默认 👁 开)，无拖拽、无 👁。按 `props.fields` 注册顺序排序。

**per-tab 显示/隐藏 (per-tab Show/Hide)**
字段管理面板中 👁 开关的语义：仅影响**当前 Tab** 的 `TableConfig.columns` 是否包含该字段，不改变全局在用集（区别于全局增/删）。关时整行置灰、眼睛图标呈斜杠态，字段可一键重新打开。

**全局增/删字段 (Global Add/Remove Field)**
字段管理面板在「编辑开关开」后暴露的能力：「增」=`+`、「删」=🗑，二者均作用于**所有 Tab** 的 `TableConfig.columns`（ADR-0011 的 M1 模型：直接改每个 Tab 的 columns，纯视觉层，不新建自定义属性、不触碰字段底层数据）。删仅把字段移入候选字段池（`+` 可恢复），故不做删除确认。
