# 提取 QueryToolbar：页面库 Header 三按钮 + 搜索

将 `PagesLibrary.vue` 顶栏的「筛选 / 排序 / 分组 三按钮 + 搜索框」抽到 `src/components/query/QueryToolbar.vue`，与 `FilterBuilder` / `FilterChipBar` 同目录。组件保持**纯展示**：搜索词经 `v-model`（`modelValue` / `update:modelValue`）受控，三按钮仅 `emit('filter' | 'sort' | 'group')` 并透传原生 `MouseEvent` 用于锚定菜单；激活/收起态（`hasFilter` / `hasSort` / `hasGroup` / `chipBarVisible`）由父组件以 prop 注入。芯片行编排逻辑（`chipBarVisible`、`chipBarRef`、`onFilterClick`、`openChipMenu`）仍留在 `PagesLibrary`。

**刻意不做**：「视图切换」（表格 / 日历）不进入 `QueryToolbar`，继续作为 `PagesLibrary` 的本地集成点——它是视图展示关注点，不属于 query 语义。

理由：延续 ADR-0009 的边界——`query/` 只放引擎邻接、不耦合实体业务的通用原语。把展示壳与芯片编排解耦后，`QueryToolbar` 可被任意含「搜索 + 筛选/排序/分组」的视图复用，且 `PagesLibrary` 回归为单纯的集成调用点；同时把原散落在 `PagesLibrary` scoped 样式里的 `.search-box` / `.hdr-btn` 一并迁入新组件，消除重复样式根。
