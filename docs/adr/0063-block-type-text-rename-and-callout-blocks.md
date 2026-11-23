# 0063 块正文类型更名与高亮块

- Status: accepted
- Date: 2026-11-23
- 关联: ADR-0009（分层边界）、ADR-0025（块复制粘贴）、ADR-0032（z-index）、ADR-0039（块入口与段落样式）、ADR-0045（折叠 = 子树 + 字段带）、ADR-0062（有序列表序号）

## Context

块级强调（给整块加底色）在现有能力里没有落点：

- 行内高亮已完整存在：TipTap mark `inlineBackgroundColor` + `InlineColorPalette` 八色背景 + 跨块选区 `apply-range`，落库为 `format.inlineMarks[].background`。它以**字符区间**为单位，因此空块、图片块、表格块无法强调；多段连续强调要反复重建选区；且它是字符样式，不是块的属性。
- 块类型体系是**渲染模式 + format 修饰**的混合模型。`Block['type']` 只有 `bullet / property / query / embed / code / image / table`——正文、标题、有序列表都是 `bullet` 靠 `format` 分化（`headingLevel` / `olIndex` + 正文前缀，见 ADR-0062）。
- slash 命令 `highlight`（`useSlashCommands.ts:485-491`）只往正文插入字面量 `^^`，全仓没有任何解析器认识该语法（`mini-markdown` 只处理 `**` `*` `` ` `` `[]()`），因此该入口产出的是脏文本。
- 查询引擎只读 `FieldValue` 表并投影为 `BlockCard.properties`，`BlockCard` 不含 `type` 也不含 `format`，查询 filter 没有任何按块类型过滤的路径。

同时 `bullet` 作为默认类型的命名与实际语义已经背离：它承担的绝大多数内容是普通正文与标题，而非列表项。

## 决策

### D1 `bullet` 更名为 `text`，双读归一，不跑数据迁移

写入路径一律写 `text`；读出路径把历史值 `bullet` 归一为 `text`。归一点在 Rust 行读取层（`storage/entity/block.rs`），前端只见到 `text`。

理由：库内既有数据全部是 `bullet`，一次性 SQL 迁移不可回退，且旧版客户端读到新值会不认。双读归一可回退、无停机，代价是兼容逻辑长期存在。

**已知风险**：若块写路径以读出的整行做 upsert，历史 `bullet` 会被静默改写成 `text`，等价于隐式迁移。实现时必须确认写路径只写被修改的列，或显式排除 `type`。

### D2 高亮块是四个独立块类型

新增 `callout-info` / `callout-warn` / `callout-success` / `callout-danger`，与 `text` 共用编辑器组件，只在渲染壳与入口字形上不同。

理由：查询层只认 `type`，若用一个 `callout` 类型承载四语义，则「筛出所有警示块」无法仅靠类型达成，必须再引第二路数据源（`format` 或字段），出现同一语义两处真相。四个类型让 `type` 一列同时回答「是不是高亮块」与「是哪种语义」。

代价：类型表 ×4，切换语义等于切换类型。

### D3 视觉壳只包自身一行

壳 = 左描边 2px + 8% 语义底色，挂在 `.block-row` 上；**不挂 `.block`**——`.block` 同时包住本行、字段区与整棵子树，挂错一层就变成 D2 已否决的「包子树」。

块胶囊（`.block-bullet`，`width:64px; margin-left:-64px`）留在壳外，不改变既有负边距布局。

配色复用 `--info / --warning / --success / --error`，四语义各自固定一个入口字形，不开放自定义图标。投影视图（查询行、看板卡片）保留描边与底色，不出图标。

### D4 行为约定

| 行为 | 约定 |
|---|---|
| Enter | 新块继承同一 callout 类型 |
| 与标题 | 互斥。callout 不读 `format.headingLevel` |
| 有序列表 | callout 块不参与序号推导，且视为 ol 段的断点 |
| 语义切换 | 走「转为」菜单，等同于切换块类型 |
| 正文内容 | 与 `text` 完全一致，含行内 marks、字段区、子块、折叠 |

### D5 查询层新增块类型字段

`BlockCard` 增加 `block_type`，由 Rust 投影填充；前端在 `useBlockQueryRegistry` 注册一个虚拟字段（`key: 'blockType'`，`get: (item) => asCard(item).block_type`），复用现有字段选择器与筛选 UI。

旧投影载荷可能缺该字段，读侧按 `text` 兜底。

### D6 `/高亮` 命令改为插入高亮块

移除插入 `^^` 的实现，改为把当前块转为 `callout-info`（无当前块时新建一个）。

## 已否决的替代方案

| 方案 | 否决理由 |
|---|---|
| 语义存 `format.callout`（属性而非类型） | 查询引擎与 `BlockCard` 不读 `format`，语义无法被 filter / 看板 / 卡片投影读取；若要读取需在投影层另开一路源，出现两处真相 |
| 单个 `callout` 类型 + 枚举字段（`FieldValue`） | 字段必须属于某个 tag（`BUILT_IN_FIELDS = SYSTEM_TAGS.flatMap(s => s.fields)`），需要先引入无主字段机制；且类型与字段双写同一概念 |
| 引入全局字段机制（打破字段必属于 tag） | 本需求不需要新机制，改动面覆盖字段单源、查询层、字段管理面板、字段区渲染四处 |
| 一次性数据迁移 `bullet` → `text` | 不可回退，旧版客户端不认新值 |
| 本次一并把 `heading` / 有序列表提为显式类型 | 会把混合模型改成半显式模型（只剩 ol 仍隐式），且 type 列迁移风险高于本需求收益；留作独立议题 |
| 保留 `^^` 行内高亮语法并实现解析器 | 行内高亮已由结构化 `inlineMarks` 承载，再引入一套字符语法会产生第二套真相 |

## 后果

### 改动面

**Rust（生产代码）**

| 文件 | 现行 | 动作 |
|---|---|---|
| `crates/comind-core/src/storage/entity/block.rs:55,68` 与 `row_to_block_native` | type 缺省填 `bullet`，原生路径无兜底 | 两条读路径统一走 `normalize_block_type`；缺省与历史 `bullet` 都归一为 `text`（D1 唯一归一点） |
| `crates/comind-core/src/types/block.rs:62` | 建块默认 `bullet` | 改用 `DEFAULT_BLOCK_TYPE` |
| `crates/comind-core/src/storage/sqljs.rs:160`、`storage/sqlite.rs:111` | 建表 `DEFAULT 'bullet'` | 改 `'text'`（只影响新建库，存量库由读侧归一兜住） |
| `crates/comind-core/src/services/render_segment_service.rs:16,77,126` | 白名单只认 `bullet` / `property` | 改用 `is_text_like`，同时认 `text` / `bullet` / `property`——**漏改则高亮块正文不生成 renderSegments** |
| `src-tauri/src/markdown.rs:102,106` | markdown 导入写 `bullet` | 改 `text` |
| `crates/comind-core/src/services/block_card.rs`、`block_projection_service.rs` | `BlockCard` 无 type | 增 `block_type` 并由投影填充（D5） |

测试代码同步：`services/block_write.rs:460`、`src-tauri/src/commands.rs:2106` 两处硬编码在 `#[cfg(test)]` 模块内，与各 `*_test.rs` 的字面量一并改；`storage/entity/block.rs` 的 `row_to_block_js_roundtrip` 兼作归一回归（输入 `bullet`，断言读出 `text`）。

**前端（生产代码）**

| 文件 | 处数 | 动作 |
|---|---|---|
| `src/config/builtin-templates.ts` | 51 | `'bullet'` → `'text'` |
| `src/stores/blocks.ts` | 9 | 同上；`resetBlockToText` 语义随之统一 |
| `src/services/serialize-block-tree.ts` | 8 | 同上 |
| `src/types/template.ts` | 4 | 类型字面量 |
| `src/components/BlockList.vue` | 3 | |
| `src/components/Block/index.vue` | 2 | 含 handler 注册入口（`import './handlers/bullet'`） |
| `src/services/text-range.ts`、`external-paste-parse.ts`、`book-note.ts`、`utils/block-helpers.ts`、`components/Block/handlers/bullet/index.ts`、`components/Block/composables/useBlockEditorLifecycle.ts`、`handlers/image/ImageRender.vue`、`handlers/embed/EmbedRender.vue` | 各 1 | |
| `src/types/block.ts` | — | `Block['type']` 联合类型加四个 callout 值 |
| `src/composables/useSlashCommands.ts` | 1 | `highlight` 命令改为插入高亮块（D6） |
| `src/composables/useBlockQueryRegistry.ts` | — | 注册 `blockType` 虚拟字段（D5） |
| `src/wasm/types.ts` | — | `BlockCard` 增 `block_type?` |
| 测试文件（约 45 个） | — | 同步字面量；既有红基线见下 |

**样式与注册**

- 新增渲染壳样式，挂在 `.block-row` 的同级 class 上（禁止改 `.block::before` 导轨——已下线，不存在）。
- 四个 callout 类型注册进 `useBlockRegistry`，共用 `bullet` 的编辑器组件，`entryIcon` 各自一个字形。
- 「转为」菜单与块胶囊菜单各加四项。

### 待查

- 卡片投影渲染层的 DOM 结构（`BlockContentCell.vue` / `TableView.vue`）——D3 的「投影保描边不出图标」需要在卡片单元格上加壳，当前尚未核对挂载点。
- 旧剪贴板载荷中 `type: 'bullet'` 的兼容路径（`BlockClipPayload` 携带 `type`）。
- 写路径整行 upsert 的行为（见 D1 已知风险）。

### 已知代价

1. 普通 `text` 块不能高亮——加底色等于换类型。
2. 高亮块不能同时是标题。
3. 多段连续高亮靠 Enter 继承，不是框选区域。
4. 类型体系仍是混合模型：`heading` 靠 `format.headingLevel`，有序列表靠 `format.olIndex` + 正文前缀。本决策只开了 callout 一个显式窗口。
5. 双读归一逻辑长期存在，直到某次迁移收尾。
