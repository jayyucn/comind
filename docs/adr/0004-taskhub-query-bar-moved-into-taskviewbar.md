# TaskHub 查询条（lib-header）整体迁入 TaskViewBar

Status: accepted

`TaskHub.vue` 原先同时持有「视图管理栏」与「查询条」：`lib-header`（`<QueryToolbar>`：搜索 + 筛选/排序/分组三按钮）与其平级的 `<QueryChipBar>`（筛选芯片行）。查询状态（`viewQuery`/`searchQuery`/`chipBarVisible`/`chipBarRef` + `hasFilter/hasSort/hasGroup` + `openChipMenu`/`loadActiveView`/`onQueryUpdate`）也全部堆在 `TaskHub` 内。这一块与视图管理语义耦合但物理分散，且与已先完成同样抽离的 `PagesLibrary.vue` 结构不对称。

我们决定把 `lib-header` **连同** `QueryChipBar` 整体迁入 `TaskViewBar.vue`，使「视图管理 + 查询工具条 + 筛选芯片行」同处一个组件，查询状态本地持有，范式与 `PagesLibrary.vue` 对齐。

**Considered Options**

- *只迁 lib-header、QueryChipBar 留 TaskHub*：最贴合「只迁 lib-header」的字面范围、改动最小；但筛选/排序/分组按钮唤起芯片菜单需经 emit 事件由 TaskHub 转发给 `chipBarRef`，组件边界割裂、芯片菜单链路跨文件。
- *（选定）lib-header 与 QueryChipBar 一并迁入 TaskViewBar，查询状态本地持有*：参考 `PagesLibrary.vue` 的本地持有范式，`chipBarRef` 直接指向同文件内的 `QueryChipBar`，芯片菜单可直接 `chipBarRef.openToolbarMenu(...)` 唤起，无需事件中转；与 PagesLibrary 构成对称，便于后续统一抽象。
- *查询状态提升到共享 store / 事件总线*：彻底解耦，但引入新全局状态与间接层，改动面大，当前属于 YAGNI。

关于**状态归属**的配套取舍（TaskHub 持有下发 / TaskViewBar 本地持有 / 提升到 store）：选定「TaskViewBar 本地持有」，与 PagesLibrary 同构。卡片数据（`blockCardStore`）归 `TaskHub`，故 `searchedCards`/`groups`/`flatCards` 这类卡片计算仍留在 `TaskHub`；`TaskViewBar` 通过 `emit('update:view-query')` / `emit('update:search-query')` 把查询状态回传，`TaskHub` 仅镜像这两个 ref 用于过滤/分组，不持有查询真相源。

**时序问题**：子组件 `onMounted` 早于父组件 `taskViewStore.load()` 完成，若沿用 `onMounted` 载入激活视图会因 store 未就绪而落空。改为 `watch(() => [taskViewStore.currentViewId, taskViewStore.views], loadActiveView, { immediate: true })`——store 就绪即载入激活视图查询，view 切换亦重载；`immediate` 兜底初次挂载。

**Consequences**

- `TaskViewBar.vue` 成为「视图管理 + 查询工具条 + 筛选芯片行」的组合头部，根节点 `.task-view-bar-root`（列向）内含 `.task-view-bar`、`.lib-header`、`<QueryChipBar>` 三段；原两道 `border-bottom` 分隔线保留，视觉结构不变。
- `TaskHub.vue` 删除 `lib-header`/`QueryChipBar` 标记、相关 import（`QueryToolbar`/`QueryChipBar`/`parseViewQuery`/`watch`）与全部查询状态逻辑；仅保留 `viewQuery`/`searchQuery` 镜像 ref、卡片计算（`searchedCards`/`groups`/`flatCards`/`grouped`）与状态变更处理（`handleStatusChange`/`handleNavigateToBlock`/`handleRefresh`）。
- 查询状态的唯一真相源从 `TaskHub` 转移到 `TaskViewBar`；视图查询的持久化（`taskViewStore.update`）改由 `TaskViewBar.onQueryUpdate` 负责。
- 与 `PagesLibrary.vue` 结构对齐，后续若要抽公共 `QueryBar` 组件已有对称基础。
- 回归风险点：搜索/筛选/排序/分组交互、命名视图切换后的查询载入、芯片菜单唤起，需在 `npm run dev` 中手测确认（本次未跑全量类型检查，因仓库为 Rust+WASM+Vue 单体、规模过大）。
