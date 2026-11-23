# 0063 块正文类型更名与段落高亮

- Status: accepted
- Date: 2026-11-23
- 关联: ADR-0009（分层边界）、ADR-0025（块复制粘贴）、ADR-0032（z-index）、ADR-0039（块入口与段落样式）、ADR-0045（折叠 = 子树 + 字段带）、ADR-0062（有序列表序号）

## Context

**段落级的视觉强调没有落点。**

- 行内高亮已完整存在：TipTap mark `inlineBackgroundColor` + `InlineColorPalette` 八色背景 + 跨块选区 `apply-range`，落库为 `format.inlineMarks[].background`。它以**字符区间**为单位，所以空块、图片块、表格块无法强调；多段连续强调要反复重建选区；且它是字符样式，不随段落移动。
- **段落样式的真源是正文前缀**：标题沿 `parseHeading`（`# `）、列表沿 `parseList`（`- ` / `1. `），由 `parseParagraphStyle` 单点判定，切样式就是整体换掉前缀（`Block/index.vue` 的 `setParagraphStyle`）。样式不存 `format`。
- 另有**一条遗留真源**：模板把标题存成 `format = {type:'heading', level}`，正文里没有前缀（`serialize-block-tree.ts` 两端契约）；`TocPanel` 与模板序列化读 `format.type`，而渲染只读前缀 —— 模板创建的标题在目录里是标题、在正文里是段落。
- 查询引擎只读 `FieldValue` 表并投影为 `BlockCard.properties`；`BlockCard` 既无 `format` 也无 `type`，查询 filter 没有按块类型过滤的路径。

同时 `bullet` 作为默认类型的命名与实际语义已经背离：它承担的绝大多数内容是普通正文与标题，而非列表项。

## 决策

### D1 `bullet` 更名为 `text`，双读归一，不跑数据迁移

写入路径一律写 `text`；读出路径把历史值 `bullet` 归一为 `text`。归一点在 Rust 行读取层（`storage/entity/block.rs` 的 `row_to_block_native` / `row_to_block_js`，共用 `normalize_block_type`），前端只见到 `text`。`DEFAULT_BLOCK_TYPE` 与建表 `DEFAULT` 一并改为 `text`。

正文类块类型由 `is_text_like` 单点判定（`text` / `bullet` / `property`），`render_segment_service` 的三处白名单读它 —— **漏改则正文不生成 `renderSegments`**。

理由：库内既有数据全部是 `bullet`，一次性 SQL 迁移不可回退，且旧版客户端读到新值会不认。双读归一可回退、无停机，代价是兼容逻辑长期存在。

**已知风险**：若块写路径以读出的整行做 upsert，历史 `bullet` 会被静默改写成 `text`，等价于隐式迁移。实现时必须确认写路径只写被修改的列。

### D2 高亮是块属性 `format.callout`，不是块类型

```ts
format.callout?: 'info' | 'warn' | 'success' | 'danger'
```

四种语义共用一套渲染，只有壳的色相与图标不同。新增块类型需要注册类型、改入口字形、改剪贴载荷与 `is_text_like` 白名单，而**查询层读不到 `type`**，所以「做成类型」换不来任何可聚合性，只换来四份类型表。

理由：高亮是「这段正文的样式」，与标题、列表同层（都是给正文定性），不是「一种新的渲染模式」。以属性承载还让它与正文完全解耦：不占前缀、不影响 `renderSegments` 偏移、不进 `content_preview`、不被导出文本带上。

## D3 视觉壳挂 `.block-content`

壳 = 左描边 2px + 8% 语义底色 + 20px 语义图标列 + 间隙，正文因此从块左边界起内缩 36px（2 + 6 + 20 + 8）。块胶囊（`.block-bullet`，`width:64px; margin-left:-64px`）完全不动，悬在壳外。

挂载层的排除过程：

| 候选层 | 排除理由 |
|---|---|
| `.block` | 连字段区与整棵子树一起罩住 ⇒ 变成「包子树」 |
| `.block-row` | 首个子元素是 `.block-indent`（宽度 = depth × 14px），其左边界是页面最左而非本块正文起点；描边会随嵌套加深愈发偏离正文，且底色会把 64px 胶囊区整片罩进去 |
| `.block-inner` | 胶囊 `.block-bullet` 是它的子元素，`padding-left` 会把胶囊一并右移 |
| `.block-body` | 内含 `BlockFieldZone`（between 变体），padding 会把字段 chip 右移，而下方 `.block-properties` 的 `margin-left` 是独立算式 ⇒ 同一块的字段带错位 |

`.block-content` 是唯一只含正文的层（`display:flex`，无 padding），左边界即正文起点。图标作为它的第一个子元素（`flex: 0 0 20px`），正文与图标同处一个 flex 行 —— 这是唯一不需要负边距、也不需要改动胶囊几何的排法。

配色复用 `--info / --warning / --success / --error`，四语义各固定一个字形的图标（`CalloutToneIcon.vue`），不开放自定义。

### D4 与段落样式互斥，执行点单点

一个块要么是某种文本样式（正文前缀），要么是高亮（`format`）。执行集中在 `Block/index.vue` 的两个入口，方向**不对称**：

| 动作 | 结果 |
|---|---|
| 选文本样式（含「普通文本」） | 先清 `format.callout`，再写前缀 —— 因此「普通文本」也是取消高亮的入口 |
| 选「高亮」格 | 已高亮 ⇒ 取消；未高亮 ⇒ 设默认 `warn`（同一格即开关） |
| 点块内图标 | 四语义浮层切换，不再动前缀 |

设高亮时先把前缀降为正文（标题不能同时是高亮）；移除高亮时不动前缀（此刻它已是正文，要不要改回标题由用户另行决定）。

### D5 行为约定

| 行为 | 约定 |
|---|---|
| Enter | 新块继承同一语义（`insertBlockAtCursor` 的 `blockFormat` 参数下发） |
| 适用范围 | 仅正文类块。表格、代码、图片、查询块不参与 |
| 编辑态图标 | 保留且可点；点击先退出编辑再开浮层（不退出则会「浮层开着、光标仍在正文」） |
| 行内底色 | 共存但收敛：壳内行内底色改为壳色相 14%（原 28%），且块内有行内底色时壳底退到 3% |
| 激活态 | 壳底让位（`transparent`），语义的可见性交给描边与图标 —— 否则与 `--block-active-bg` 串色（暗色 `--info` 与其同为 `#818CF8` 系） |

### D6 标题遗留真源双读归一

`parseParagraphStyle` 增加 `format` 选项：正文完全没有前缀、而 `format.type === 'heading'` 时，按 `format.level` 认出标题（4–6 级保留 `level`、不点亮样式行）。**前缀永远优先**；一旦用前缀定下样式，`setParagraphStyle` 清掉 `format.type` / `level`，两处声明不再长期并存。

## 已否决的替代方案

| 方案 | 否决理由 |
|---|---|
| 四个独立块类型（`callout-info` 等） | 查询层不读 `type`（`BlockCard` 无该字段），做成类型换不来可聚合性，只换来四份类型表与四处注册 |
| 语义存 `FieldValue` 枚举字段 | 字段必须属于某个 tag（`BUILT_IN_FIELDS = SYSTEM_TAGS.flatMap(s => s.fields)`），需要先引入无主字段机制 |
| 高亮写成正文前缀标记（如 `> `） | 每个标记都要过 `ParagraphStylePreviewExtension` 的隐藏逻辑与插入符归零几何；且标记会进 `content_preview` 与导出文本 |
| 查询层支持块类型（投影加 `block_type` + 虚拟字段） | 本需求不要求跨视图可查；改动跨 Rust 投影、`BlockCard`、查询注册表三处，收益为零 |
| 一次性数据迁移 `bullet` → `text` | 不可回退，旧版客户端不认新值 |
| 本次一并把 `heading` / 有序列表提为显式类型 | 会把混合模型改成半显式模型（只剩 ol 仍隐式），风险高于收益；留作独立议题 |
| 允许高亮与标题共存 | 四语义 × 六级标题 = 24 种视觉组合，且壳的描边高度要随字号变 |

## 后果

### 改动面（D1，已落地）

Rust：`storage/entity/block.rs`（两条读路径归一 + 缺省值）、`types/block.rs`（`DEFAULT_BLOCK_TYPE` / `normalize_block_type` / `is_text_like`）、`services/render_segment_service.rs`（三处白名单）、`storage/sqljs.rs` 与 `storage/sqlite.rs`（建表 `DEFAULT`）、`src-tauri/src/markdown.rs`（导入写 `text`）。

前端：`Block['type']` 与 `TemplateBlock` 联合类型、`builtin-templates.ts`（51 处字面量）、`stores/blocks.ts`、`serialize-block-tree.ts` 等生产文件与约 45 个测试文件。

### 改动面（D2–D6）

| 文件 | 动作 |
|---|---|
| `src/utils/callout.ts` | 新增：枚举、文案、`calloutToneOf`、`calloutFormatPatch`、`CALLOUT_TONE_ICONS` 字形单源 |
| `src/components/Block/components/CalloutToneIcon.vue` | 新增：四语义固定字形 |
| `src/components/Block/index.vue` | 壳 class、语义图标、切换浮层、互斥、`hasInlineBg`、标题兜底、入口胶囊改读语义字形 |
| `src/components/Block/components/BlockMenuTextStyle.vue` | 七格两行网格（4+3：文本/H1/H2/H3 ‖ 有序/无序/高亮），「高亮」是普通一格（`data-text-style="callout"`），`calloutTone` prop 决定点亮 |
| `src/composables/useContentRenderer.ts` | `parseParagraphStyle` 的 `format` 双读兜底 |
| `src/components/Block/handlers/bullet/BulletRender.vue` | 把 `blockFormat` 喂给样式判定 |
| `src/components/Block/composables/useBlockEditorLifecycle.ts` | Enter 继承 | 
| `src/styles/components/_block.scss` | 壳、图标列、切换浮层、行内底色收敛、激活态让位 |

### 已知代价

1. **普通文本块不能既高亮又是标题** —— 互斥是「一种样式声明」的直接后果。
2. **高亮不进查询、看板、卡片投影**：投影面继续显示纯文本，语义只活在主编辑器里。
3. **行内底色在壳内被收敛到壳的色相**：同块只用一种色，代价是用户选的标记色在壳内不再原样显示。
4. **多段连续高亮靠 Enter 继承**，不是框选一个区域。
5. **双读归一逻辑长期存在**（`bullet` 与标题两条），直到各自有迁移收尾。

### 未做

- `/高亮` 斜杠命令仍插入字面量 `^^`（全仓无解析器）。改它需要把前缀降级逻辑搬进 `useSlashCommands`，与本决策的落点分离，单独处理。
- 表格 / 代码 / 图片 / 查询块不能高亮。
- 投影渲染面（`BlockContentCell` / `TableView` / `BoardView` / `GalleryView` / `QuadrantView` / `CalendarView`）不显示高亮。
