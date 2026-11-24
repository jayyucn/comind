# 0061 外部表格粘贴为 table block

- Status: accepted
- Date: 2026-11-07
- 关联: ADR-0025（block 复制粘贴）、ADR-0026（外部粘贴拆分为 block）、ADR-0043（粘贴即建页）

## Context

ADR-0026 把外部剪贴板内容解析为 block 森林，但表格没有专门分支：`BLOCK_LEVEL_SELECTOR` 含 `table`/`tr`，`<table>` 命中的是「含块级后代 → 展平为同级」路径，最终 `td` 落到 `inlineBullets()`——**一行 N 列变成 N 个独立 bullet，行结构全部丢失**。

Excel / Sheets / 网页 / Word 复制表格时都会给 `text/html` 的一个 `<table>`（html 优先于 plain，ADR-0026 D2），因此这三类来源全部踩在同一条错误路径上。markdown 的 GFM 管道表格走 `parsePlainText` 的逐行拆分，退化成字面文本 bullet。TipTap 侧没有 table 扩展（`Editor.vue` 只挂 StarterKit，且关掉 heading/codeBlock/blockquote），行内粘贴也拿不到表格。

表格块本身已具备完整数据模型：`TableData` 持久化在 `Block.format.table`（`rows` / `header` / `headerAlign` / `aligns` / `merges`），`table-model.ts` 提供 `normalizeTableData` / `sanitizeCellText` / `alignKey` 等纯函数，`pasteBlocks` 的 `BlockClipPayload` 已能承载 `type: 'table'` + `format`。缺的只是「识别外部表格 → 转 `TableData`」这一层。

## 决策

### D1 单一解析模块

新增 `services/table-paste-parse.ts`，纯函数、不触碰 store：三条来源统一产出 `TableData`，再由 `tablePayload()` 包成 `{ content: '', type: 'table', format: { table }, properties: null, children: [] }` 的叶子载荷。表格块是叶子块，`content` 恒为空、`children` 恒为空。

### D2 布局表格门禁：有效列数 ≥ 2

展平 colspan 后的有效列数 `< 2` 的 `<table>` 视为排版容器（Gmail / Outlook 等邮件模板普遍是单列外套嵌套表），返回 `null`，调用方沿用 ADR-0026 的展平路径。不要求 `<th>` 存在——数据表未必有表头，而布局表几乎都是单列。

### D3 源优先级沿用 ADR-0026

内部 MIME > `text/html` > `text/plain`。表格识别在两处接入：

- HTML 路径：`mapElement` 的 `TABLE` 分支优先于块级容器展平分支
- 纯文本路径：先试 TSV，再逐行扫描 GFM 表格段

### D4 落点：空块就地转，否则插锚点后

整段内容只产出一个表格、无块选区、且活动块是**空 bullet 且无子块**时，就地改成 table（`updateBlockContent('')` → `updateBlockType('table')` → `updateBlockFormat({table})` → `activateBlock`），与 `useSlashCommands.insertTable` 口径一致，不留空壳、不新增行。其余情况走 `pasteBlocks` 的「插在锚点块之后」。

就地转的三次写入落在撤销栈的 500ms 快照窗口内（ADR-0046 D3），合成一步撤销。

### D5 结构完整映射

- **表头**：`thead` 存在或首行含 `<th>` → `header: true`；否则 `false`（严格按源，Excel 复制是纯 `td`，粘出来无表头样式，用户可一键 `toggleHeader`）
- **合并**：`colspan` / `rowspan` → `MergeRect`（闭区间，与 `merges` 同形），由 `normalizeTableData` 裁剪越界与重叠
- **对齐**：HTML 的 inline `text-align` / `align` 属性、GFM 分隔行的 `:---:` / `---:` → 逐格 `aligns`；`left` 是缺省值，不必落库

### D6 纯文本段边界

- **TSV**：整段所有行都 ≥ 2 列且列数完全一致才成表；任意一行列数不同则整段放弃，回落逐行 bullet。不按「连续同列数行」切段——`<tab>` 对齐的普通文本会被误切。段内支持 Excel 的双引号包裹（含制表符/换行的单元格用 `"…"` 包起来，`""` 是字面引号）；尾部空行忽略。
- **GFM**：必须命中「表头行 + `|---|` 分隔行」（分隔行须含内部 `|`），否则不识别；按行扫描，表格段之外的行走原逐行拆 bullet，因此「段落 + 表格 + 段落」可以共存。`\|` 还原为字面竖线。
- GFM 路径 `header` 恒为 `true`；TSV 无表头信息，恒为 `false`。

### D7 富文本降级为纯文本

单元格取 `textContent`：链接丢弃 URL 只留文字、加粗/斜体展开、`<img>` 跳过、`<br>` 拍成一个空格（`sanitizeCellText` 的单行纯文本约束）。不产出 HTML、不产出属性，与 ADR-0026 D3/D10 的安全口径一致。

### D8 嵌套表格拍平成一行

单元格内的 `<table>` 按行优先把其单元格文本用空格拼成一行，填进外层对应格。既不丢内容，也不把内层结构塞进外层网格。递归深度上限 4，超出退化为整段 `textContent`。

### D9 规模不设上限

转换不设行/列上限，一律建 table 块。`TableBlock` 编辑态为每格一个 `<textarea>`（`autoResize` 只在 focus/input/paste 触发，挂载时不触发），`renderedRow()` 无行虚拟化——大表格（数千格）的挂载成本确实随格数线性上升，但真实粘贴场景极少触及。

退出条件：出现实际卡顿报告时，改做「仅活动格挂 `<textarea>`，非活动格渲染 `<span>`」的结构性优化（`textarea[data-table-cell]` 是 `focusCell` / 跨格选区 / 粘贴 / 焦点恢复的共同基石，改动面大，须独立实施），而不是在粘贴侧加人为上限。

### D10 范围外：单元格内矩阵粘贴

`TableBlock.onCellPaste` 维持现状（把 `\t`/换行拍成空格后插入单格）。从当前格向右下展开矩阵涉及扩行扩列与合并区冲突规则，另立工单。

## 理由

- 表格是唯一有独立数据模型的结构化块类型，把三个来源都收口到 `TableData` 后，落库通道（`pasteBlocks` + `format.table`）无需任何改动。
- 门禁只看列数而不是表头，是因为「无表头的两列数据表」是真实且常见的一类，而布局表几乎必然是单列——用列数区分两者比用 `th` 更准。
- TSV 段边界取「整段一致」而非「连续同列数行切段」，是为了让误判发生在「不转换」而不是「切错表」：后者会让用户拿到两张语义错误的表，且难以察觉。
- 表头严格按源而非「首行一律当表头」，保持「解析是忠实映射」这一条不变量；表头开关是表格块上的一等交互，纠正成本极低。

## 已否决的替代方案

- **在 `parseExternalPaste` 里内联解析逻辑**：表格解析有 HTML 网格、GFM、带引号的 TSV 三套，混进 block 森林映射会让本来就长的 `mapElement` 无法单独测试。
- **用 `th` 存在性作为表格门禁**：无表头的数据表会被漏掉；且布局表也可能含 `th`。
- **TSV 按连续同列数行切段**：普通文本里两行 `a\tb` 就会凭空产出一张表。
- **超限降级为逐格 bullet 或 code block**：逐格 bullet 丢行结构，code block 让表格失去可视化编辑能力；两者都是在为尚未出现的性能问题付出可用性代价。
- **把富文本转成内部 wiki 链接**：外部 `<a>` 不是本库页面，转 `[[文本]]` 会误触发粘贴即建页（ADR-0043）。
- **在 TipTap 侧挂 table 扩展**：块级分发已经拦在 document 捕获阶段，行内粘贴路径与块模型（表格是叶子块）不兼容。

## 后果

- 新增 `src/services/table-paste-parse.ts`（`parseHtmlTableData` / `parseGfmTable` / `parseTsvTable` / `tablePayload`）。
- `src/services/external-paste-parse.ts`：`mapElement` 增 `TABLE` 分支；`parsePlainText` 改为「TSV 整段 → GFM 逐段扫描 → 逐行 bullet」。
- `src/components/BlockList.vue`：`handleDocPaste` 增「空块就地转表」分支。
- 回归网：`src/services/table-paste-parse.test.ts`（31 例：网格补齐、合并、对齐、布局表、嵌套、文本降级、GFM 转义与对齐、TSV 引号与列数一致）；`external-paste-parse.test.ts` 增 6 例（HTML 表格、混合内容、布局表回落、GFM/TSV 纯文本、TSV 列数不齐回落）。
- 已知召回下降：单列的「伪表格」（如两行单列表站信息）不再成表，按 bullet 落地——这是布局表门禁的必然代价。
- 粘贴性能与表格格数成正比，见 D9 的退出条件。
