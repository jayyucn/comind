# 提取通用 PageTitle 组件统一页面标题样式

将各页面顶部标题从「各自硬编码的标题 markup」收敛为通用原语 `src/components/common/PageTitle.vue`，统一字号/字重/副标题配色，并为未来右侧操作区预留插槽。

**背景**：此前页面标题样式分散且互不一致——PagesLibrary 用 `--font-size-page-title` + bold（`.lib-title`/`.lib-count`），Trash 用 `--text-xl` + semibold（`.trash-title`/`.trash-count`），GraphView 用 `--text-2xl` + semibold（`.graph-view-title`）且右侧带布局切换控件。同一「页面标题」概念存在三套规范，不利于视觉统一与后续维护。

**决策**：
- 新建 `PageTitle.vue`（居 `common/`，与 `BasePopover` 同属共享原语）：`title`(string,必须) + `subtitle`(string,可选副标题，渲染在标题**同行右侧**) + 具名插槽 `actions`(右侧操作区，`margin-left:auto` 推到最右，默认空)。
- 规范字号/字重采用页面标题令牌 `--font-size-page-title` / `--font-bold`（即 PagesLibrary 现状，字面即「页面标题」语义），副标题用三级文字色 `--text-tertiary`；结构与 `.lib-title-container` 对齐（flex 行、baseline 对齐、同令牌间距与 padding）。
- 首个采用页 = PagesLibrary：替换其 `.lib-title-container`/`.lib-title`/`.lib-count` 三段 scoped 样式，模板改为 `<PageTitle title="页面库" :subtitle="`${filteredPages.length} 个页面`" />`。

**权衡**：统一到 `page-title` 令牌会让 Trash/GraphView 当前较小的标题**变大到 2rem**。此为刻意取舍——以命名令牌为唯一规范来源，避免再出现第三套字号；后续迁移 Trash/GraphView 时同步采用该规范即可。`actions` 插槽当前 PagesLibrary 未使用，待 GraphView 等带右侧控件的页面迁移时填入，避免现在就引入无关抽象。

**范围（本次不做）**：Trash / GraphView / IdeasTodayPanel 等其余页面的标题迁移留待后续逐个进行，本次仅交付组件并把参考页（PagesLibrary）接入。详见 `CONTEXT.md` 的 PageTitle 词条。

## 更新：四页接入完成

参考页之后，已将 Trash / GraphView / IdeasTodayPanel 迁移到 `PageTitle`，并为 TaskHub 新增标题：

- **Trash**（`TrashList.vue`）：`<h1 class="trash-title">` + `<span class="trash-count">` → `<PageTitle title="回收站" :subtitle="...">`；`.trash-header` 仅保留分隔线（删 `display:flex/justify/align` 与 `.trash-title`/`.trash-count`）。
- **GraphView**（`index.vue`）：标题 + 「已显示部分节点」提示 + 布局/适应/刷新/导出/层级控件整体迁入 `<PageTitle>`——提示作 `subtitle`（条件渲染），控件进 `#actions` 插槽；`.graph-view-header` 加 `.page-title-container { flex: 1; min-width: 0 }` 使标题行撑满、控件推到最右；删 `.graph-view-title` / `.graph-truncated-note`。
- **IdeasTodayPanel**：动态日期（原 `.today-date`）作 `title`；`.today-header` 去冗余 `gap`/`padding-top`，删 `.today-date` / `.today-label`（后者本就未使用）。
- **TaskHub**：顶部新增 `<PageTitle title="任务中心" />`。

**代价**：GraphView 的「已显示部分节点」从徽标（底色 + 边框）退化为普通三级副标题文本；Trash/GraphView 标题因统一到 `page-title` 令牌而变大到 2rem（见上「权衡」）。
