# ADR-0013: TableView 列宽拖拽缩放（表头手柄 + 持久化至 TableConfig）

- Status: accepted
- Date: 2026-08-23
- Supersedes: —
- Related: ADR-0005 (View/ViewQuery 模型), ADR-0006 (LayoutConfig schema), ADR-0007 (TableView 与 Task 解耦), ADR-0011 (TableView 字段管理面板)

## Context

`TableView.vue`（`src/components/views/TableView.vue`，`generic="T"`）是实体无关的字段驱动表，按 `config.columns`（`TableConfig`，每个 Tab 持久化）渲染列。`TableColumnConfig.width?: number` 已存在且 `columnWidth()` 已把它写到 `<th>`/`<td>` 的 `style.width`——但**没有任何 UI 能设置它**，列宽只能由调用方硬编码在 config 里。本 ADR 为表格补上「表头拖拽缩放列宽」能力。

设计经 grill 6 轮确认（含本次新增的第 6 轮「是否抽组件」）。

## Decision

### 1. 范围（grill Q1）
- 手柄只渲染在**两列之间的分隔线**上：每个非 `link`、非最末列的表头右缘一个缩放手柄。
- **最末列没有独立手柄**（其右缘即表格右缘、无相邻列可联动；拖它只会改变总宽，违背「总宽恒定」语义）。最末列通过**它左侧的分隔线**（倒数第二列的手柄）调整——拖该分隔线即「移动分隔线」语义，最末列与倒数第二列一增一减。
- `role: 'link'` 的导航列（默认 40px）**仍不提供自己的手柄**（其右缘作为表格右缘无下一列可联动），但**作为「被联动方」参与左分隔线的联动**——拖它**左边**那条分隔线时，本列随左列一增一减地变宽/变窄（起始宽按 40 兜底，可被推宽到任意值；亦可被推窄但 clamp 到 MIN=40）。`columnWidth(link)` 返回 `widths[link] ?? config.width ?? 40`，`totalWidth` 同步把 link 的 `widths[link]` 计入。这是用户反馈后明确的取舍：link 列默认窄但可被拖宽，以适应「页面引用」「导航链接」等长内容场景。
- 因此**每条手柄的拖拽都恰好改变两列**（本列 + 相邻下一列，含 link 列），其余列一律不动，表格总宽恒定。

### 2. 持久化归属（grill Q2）
- `TableView` 仍是**纯渲染器 / 哑发射器**：拖拽结束 `emit('columnResize', changes)`，其中 `changes: { key, width }[]` 一次性带回本列**与**相邻下一列的最终像素宽，**不**直接写 store、不表达业务意图（延续 ADR-0007/0011 解耦契约）。
- 宽度落库走与「列显隐 / 列排序」**完全相同**的通道：`QueryPageFrame` 监听 `@column-resize`，把 `changes` 汇总成 `Map<key,width>` 后 `store.patchActiveTabConfig((cfg) => ({ ...cfg, columns: cfg.columns.map((c) => widths.has(c.key) ? { ...c, width: widths.get(c.key) } : c) }))`。这是 ADR-0011 已确立的写回模式，缩放只是新增一种列变更意图。
- 父层（PagesLibrary / TaskHub）无需改动：`QueryPageFrame` 既持有 store 又负责 patch，config 经 store 回流后作为新 `props.config` 向下透传，`TableView` 重渲染即见新宽。

### 3. 表格布局（grill Q3 + 等比缩放 bug 修正 + 比例模式补强）
- `.data-table` 用 `table-layout: fixed`。**列宽由 JS 权重分配（比例模式）**，不再用 CSS 百分比 / auto 分摊：
  - **为何不用纯 CSS**：`table-layout: fixed` 下单元格 `min-width` 对列宽**无效**（CSS 规范：fixed 布局列宽只由表格宽与列宽声明决定）。实测容器压窄时列被压到 33px / 9px、`min-width: 40px` 完全不生效、也无横向滚动——「压缩到下限后滚动」必须由 JS 计算。
  - **渲染宽**：`containerWidth`（`.table-scroll` 宽度，`ResizeObserver` 跟踪；jsdom/SSR 无 observer 退化为 0）+ 各列基准像素 `colPxOf`（link 40 / `config.width` / 拖拽结果 / 未设列 `DEFAULT_COL_WIDTH=160` 兜底）。`distributeColumnWidths`（`src/components/views/tableWidths.ts` 纯函数）计算：表格宽 `W = max(containerWidth, n×40)`，每列 `= 40 + (W − n×40) × (colPx − 40) 权重`，**末列吸收舍入误差**使总和恰为 W。
  - **容器变化**（用户需求 1）：容器变宽 → 剩余空间增大 → 各列按权重等比伸缩、铺满无留白；容器变窄到 `W = n×40` → 每列停在 40px 下限，表格宽 `n×40 > 容器` → `.table-scroll` 横向滚动。正是「等比例变化，直到列宽达到最小值后开始滚动」。
  - **拖拽时**：边界联动只改两列基准像素（`widths`），权重随之更新 → 只有这两列渲染宽变化，其余列纹丝不动；**不再需要**「填充 / 精确」双模式切换（旧模型），也彻底规避了「多列显式 + width:100% → 剩余空间按比例分摊给所有列」的等比缩放 bug。
  - 表格与单元格设 `box-sizing: border-box`：`content-box` 会把 `border-right: 1px` 加在列宽之外，导致每列 +1px、总和超出表格宽。
- `DEFAULT_COL_WIDTH = 160` 兜底：仅作为**比例基准**参与权重计算，不写入存储。

### 4. 拖拽交互与提交时机（grill Q4）
- 每列 `<th>` 右缘一个 ~6px 拖拽热区 `<span class="col-resizer">`，锚定在 `.th-inner`（普通块级包裹层，规避 table-cell 对绝对定位子元素包含块不可靠的问题）；`position:absolute; right:0; top:0; height:100%; width:6px; cursor:col-resize; user-select:none; touch-action:none`；`touch-action:none` 防止触控时触发页面滚动。
- 用 **Pointer Events**（一次覆盖鼠标 / 触控 / 笔），不依赖 `mouse*` 系列。
- **边界联动（唯一语义）**：手柄在「本列与下一列的分隔线」上，拖拽 =「移动这条分隔线」——拖宽本列时，紧邻的下一列同步变窄，**两列宽度之和恒定**（总表宽不变），其余列不参与。`pointerdown` 时按渲染顺序 `columns` 找到紧邻下一列（`next` 始终存在——手柄不渲染在末列右缘）并记录其起点宽；下一列为 `link` 列时按 `(next.width ?? 40)` 兜底，**仍参与联动**（用户可拖宽 link 列以显示完整路径）。`pointermove` 计算 `delta`，本列 `newW = clamp(dragStartW + delta, MIN)`，并受「下一列不低于 MIN」约束上限 `dragStartW + (dragStartNextW - MIN)`，下一列取 `dragStartNextW - (newW - dragStartW)`；`pointerup` 提交并 `emit('columnResize', changes)`：`changes` 含本列 + 下一列，随后移除监听。
- 用 `window` 级监听（而非 pointer capture）以保证快速拖出元素外不丢事件；`onUnmounted` 中兜底移除，防组件卸载时悬挂全局监听。

### 5. 宽度约束（grill Q5）
- 最小 40px（防塌缩为 0）；**不设硬上限**（超宽走 `.table-scroll` 横向滚动）；暂不做吸附步长（保持简约，后续可加）。

### 6. 不抽独立组件（grill Q6）
- **不**把表头 / 缩放手柄提取为 `TableHeader.vue` / `ColumnResizer.vue`：全仓仅 `TableView` 一个消费方，提取属 premature abstraction，违反 AGENTS.md「简约优先 / 不为一次性使用做抽象」。缩放逻辑在 `TableView` 内聚即可。**例外**：比例分配的纯函数独立为 `tableWidths.ts`（可单测的布局计算，无 Vue 依赖）。

### 7. 字段增减策略（用户确认）
- **新增字段**：无 `width` → `colPxOf` 按 `DEFAULT_COL_WIDTH=160` 兜底参与权重分配，自动获得比例空间、其余列比例相应缩小，无需额外处理。
- **删除字段**：`syncWidths` **清理式**删除不在 `config.columns` 中的残留 key → 列宽度**遗忘**，重新添加时回退 160（用户选择「清理」而非保留）。`visible=false` 的隐藏列仍在 config.columns，宽度保留（显隐不丢宽）。
- **重置列宽**：暂不提供（YAGNI，用户确认）。

### 本地状态模型
- `widths: reactive<Record<string, number>>`：**清理式同步**（见 §7）——`syncWidths` 先删除残留 key 再写入 config 显式 width；`watch(props.config)` 触发（tab 切换 / 外部 patch / 列增减时刷新）。`onResizeStart` 把尚未设宽的列快照为当前渲染宽（`th.getBoundingClientRect().width`，jsdom 为 0 → 160 兜底）。
- `colPxOf(col)`：基准像素（link 40 / `widths` / `config.width` / 160 兜底），拖拽联动改写的是 `widths`。
- `colWidths` computed：`distributeColumnWidths(colPxOf × n, containerWidth, 40)` 得到各列渲染像素（末列吸收误差）。
- `columnWidth(col)`：`Math.round(colWidths[key])px`——每列都有显式像素宽，`table-layout: fixed` 完全按给定值渲染。
- `tableStyle = { width: tableWidth px }`，`tableWidth = max(containerWidth, n×40)`。
- `containerWidth`：`onMounted` 读 `.table-scroll.clientWidth` 并 `ResizeObserver` 持续跟踪，`onUnmounted` disconnect；jsdom 无 ResizeObserver → 仅初始值 0（全列退化为 40px 下限）。

## Considered Options

### 持久化 vs 仅会话内
- **(A) 持久化至 TableConfig（选定）**：config 本就是列布局的单一真相，缩放与显隐/排序同通道写回，跨会话/切 tab 保留，零新增数据结构。
- (B) 仅会话内（刷新即丢）：实现更短但每次重开都要重新拖，体验差且无收益——config 已具备承载能力，不取。

### table-layout: fixed vs auto
- **(A) fixed（选定）**：宽度精确、拖拽手感确定，内容溢出走既有省略/换行（`.cell-primary` 已有 line-clamp）。
- (B) 保持 auto：内容过长会撑开列，拖拽不精确、宽度不作数，未取。

### 提取 TableHeader / ColumnResizer 组件
- **(A) 不提取、内联（选定）**：单消费方，YAGNI，符合 AGENTS.md 简约优先。
- (B) 抽 `TableHeader.vue`：多一层抽象与测试面，当前无第二调用方，未取。

### Pointer Events vs 仅 mouse 事件
- **(A) Pointer Events（选定）**：鼠标/触控/笔通吃；`touch-action:none` 防触控滚动劫持。
- (B) 仅 `mouse*`：触控设备不可拖，未取。

### emit 时机：pointermove 每次 vs pointerup 一次
- **(A) pointerup 提交一次（选定）**：避免拖拽过程中高频写 store 造成抖动/写库压力；本地映射已提供实时反馈。
- (B) 每次 move 都 emit：写库过频，未取。

## Consequences

- **正面**：通用表格首次获得「表头拖拽缩放列宽」能力，且与 ADR-0011 的「列显隐/排序」共用一套 patch 通道，架构一致；`TableView` 仍零业务耦合、可复用于任意 Screen（Block / Page 各自注入 `fields`）；完全复用现有 `TableConfig.columns` 持久化，不新增数据结构。
- **中性**：比例模式下每列 = 40px 下限 + 剩余空间按权重分配，容器变化时各列同步伸缩、铺满无留白（右侧不留白）；压缩到下限后横向滚动。拖拽只改两列基准像素、总宽恒定。jsdom/SSR 无 ResizeObserver 时退化为全列 40px 下限（布局仅在真实浏览器生效）。列删除后宽度遗忘（用户选择），重新添加回退默认。
- **不触碰**：实体 schema、自定义属性、字段底层数据值——纯视觉层列宽。
- **编号提示（待跟进）**：本 ADR 按 `docs/adr/` 实际最高编号 **0012** 递增为 0013；但 `TableView.vue` 等源码注释引用到 ADR-0024 / ADR-0023（如分页、Page 实体），目录中 0013–0024 文件缺失，疑似注释编号先于文件创建或文件被删。**建议**：统一 reconcile（补齐或重编号注释），避免未来读者混淆。
- **验证建议**：`npm run test TableView` 补用例——拖拽后 `columnResize` 以正确的 `{key,width}[]`（本列 + 相邻下一列）触发、link 列无手柄且作为被联动方可变宽、最末列无独立手柄但可通过其左侧分隔线联动改变、最小宽 40px 不被压破；`tableWidths.test.ts` 单测权重分配（等宽均分 / 权重分配 / 容器伸缩 / 触底滚动 / 末列误差吸收）；`npm run dev` 手测——拖某列时下一列同步变窄/变宽、其余列不动、刷新后宽度保留、切 tab 互不影响、**调整窗口宽度时各列等比伸缩、窄到下限后出现横向滚动**。
