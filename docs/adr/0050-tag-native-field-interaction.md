# ADR-0050: Tag 本位字段交互与 Tag 聚合页

> **状态：D1–D12 已定稿（D5 / D7 已修订，见段内标注）；阶段 1（D1 / D5 / D7 / D10 + chip 点击导航）已实施（`b955b79`），阶段 2（D2 / D4）、阶段 3（D8）、阶段 4（D5 / D7 修订 + D11 / D12）待实施**。上游决议见 ADR-0049「方向决议：tag 本位，属性概念退役」段与 CONTEXT.md 词条 **Tag / Tag Field / Property (RETIRING)**。

## Context

ADR-0049 完成了数据层的字段统一（FieldDefinition / FieldValue），并在方向决议段确立**属性概念退役、tag 本位**。本 ADR 承接其交互层落地方案。

## 决策

### D1：挂载即显示
打 tag → 块上出现该 tag 的字段编辑区，无值字段以空占位可填。不存在独立属性入口。

### D2：程序化写值 = 「确保挂载 + 写字段值」原子意图
TaskHub `ensureTodo` 等程序化路径：先确保 `#task` 在 content，再写 status/priority 字段值。tag 本位的挂载前置，非属性补丁。

### D3：存量数据无需迁移
无 tag 但有字段值的存量块：值保留在库，tag 本位下无挂载即无编辑区（UI 不可见）；用户手动打 tag 后值自然恢复可见。不做回填脚本。

### D4：TaskHub 过滤源切 tags
数据源过滤从「`status` 值非空」（TaskHub.vue:91 现状）改为「`block.tags` 含系统 task tag」。挂了 `#task` 的块才是任务，与字段显示逻辑同源。

### D5：标签管理页 = 独立页面（列表 + 详情），含显式新建入口

页面双栏布局，逐段映射：

**左栏（列表）**：

| 页面元素 | 实现映射 |
|---|---|
| 标题「标签」+ 副标题「12 个标签 · 3 个带父标签 · 91 个成员」 | 派生统计：tag 总数 / 有 parent 的 tag 数 / 各 tag 直系成员数之和 |
| 搜索标签 | title 前缀/包含过滤（客户端） |
| **+ 新建标签** | 弹层 = 标题 + 可选父标签，即建；字段模板事后在详情区配。打标（挂到块）仍唯一走 content `#名`——建实体 ≠ 打标，与 ADR-0049 决策 #1 不冲突 |
| 筛选 chips 全部 / 最近使用 / 未使用 | 全部=全量；最近使用=按成员块 max(updated_at) 排序；未使用=直系成员数 0——**全部客户端派生自 `BlockCard.tags`（`280b2b8`），零新列** |
| 行：#标题 \| N 成员 \| M 个字段 \| 顶级标签 / ← 父名 / 未使用 | N=直系成员数；M=自身字段数（不含继承）；来源=tags store + 投影 |

**右栏（详情，选中 tag）**：

| 页面元素 | 实现映射 |
|---|---|
| #标题 + 「11 个成员 · 来自 4 个页面」 | 同左栏口径（直系成员数 + 去重 page_id） |
| 标签颜色（调色板） | 标签身份三要素之三（D11）：8 色固定调色板（`--tag-color-1..8`）+ 可清除（选中即写，无确认步骤；点当前色不落库）；色值存 design token 名，与聚合页身份条 / 成员块内联 chip 同源。系统标签只读——写入侧 Rust `reject_system_tag` 拒之，故 UI 不给可点入口（给了就是「点了没反应且无提示」的静默失败） |
| 描述（「添加描述」占位 / 描述文本） | 标签身份三要素之二（D11）：单行文本；系统标签只读（沿用本表「系统标签右栏只读」约束） |
| 字段模板：状态·下拉选择〔继承←项目〕/ 日期·日期〔自身〕/ + 添加字段 | 行=FieldDefinition（key/title/type）；badge 区分继承字段（解析器产出，见 D10）与自身字段；+ 添加字段 = 建 FieldDefinition + 追加 `Tag.field_ids`（用户 tag 同样支持） |
| 继承区：#项目 × / + 添加父标签 | **单父槽位**（D10）：已有父时按钮为更换/清除；环守卫拒绝成环 |
| 删除标签…（红字） | `TagService::delete`（is_system 拒删守卫延续 ADR-0049 决策 #9）；成员块值保留（决策 #7） |

### D6：撤销栈维持 ADR-0046 边界
程序化写值（含确保挂载的 content 变更）不入撤销栈——用户心智中程序化操作是「任务操作」而非「文本编辑」；手动 content 编辑（含删 `#task` 字样）照常可撤销。

### D7：tag 聚合页 = 独立新页面，形态对齐 Query Page

点击 chip → 导航到该 tag 的聚合页面，独立新页面。页面自上而下五段（示例：`#项目`），逐段映射实现载体：

| 页面元素 | 实现映射 | 现状 |
|---|---|---|
| 面包屑「标签 / #项目」 | 返回标签管理（D5）的导航 | 新 UI |
| 大标题 `#项目` + 副标题「24 个成员 · 来自 9 个页面」 | 成员数 = 挂该 tag 的块数；来源页数 = 成员块去重 page_id 计数 | 由投影派生 |
| 视图切换 表格 / 看板 / 日历 | `viewKind` 三枚举已有 | ✅ 直接复用 |
| 标题区 标签颜色 + 描述 | 标签身份三要素（D11）在聚合页的展示与就地编辑；空态显示占位。原统计卡已移除（见下方「D7 修订」） | 新 UI |
| 工具栏 筛选 / 分组 / 排序 / 显示字段 | QueryToolbar 既有 scope（「显示字段」= per-tab 列显示，TaskHub 字段管理同款） | ✅ 复用 |
| 表格列：内容 | `content_preview` | ✅ |
| 表格列：**来源页** | `BlockCard.page_id` 已有；页标题经 TS pages store 映射；点击跳源页面 | ✅ 阶段 1 已补（唯一轻量数据缺口，只读列） |
| 表格列：状态(chip) / 截止 / 工时 | `properties` / `date_refs` + 字段类型渲染 | ✅ TableView 已有 |
| 数据过滤「tags 含此 tag」 | 投影需有 tags 数据源：`BlockCard.tags: Vec<String>` 已加（`280b2b8`，D4 TaskHub 过滤切换同样依赖，一处扩展两处受益） | ✅ |

视图配置（筛选/分组/排序/显示字段）按 tag 维度持久化，沿用 TaskHub per-tab 配置先例。

阶段 1 实施形态：字段注册表按该 tag 的**有效字段**（Rust 解析结果）动态构造且限定在聚合页内（不并入任务中心注册表）；视图配置命名空间取 `tag:<tagId>`，与任务列表互不争抢；列模板在有效字段就绪前不回落到持久化配置，避免把未解析完的列集写库。

#### D7 修订：统计卡移除 + 设置入口

**统计卡移除（原「零配置自动出全」口径反转）。** 该口径有两点缺陷，实测中同时成立：

1. **命中率近零**：系统 12 个字段全为 `string` 型（`crates/comind-core/src/types/field_definition.rs:91-114`），故系统 tag 上数值卡恒不出，统计区退化为一张「成员数」卡 —— 它与副标题「N 个成员 · 来自 M 个页面」逐字重复，零信息增量。用户 tag 上还须同时满足「有 number 字段」与「至少一人填过」才出不重复的卡。
2. **无值即出卡**：`avg` 的分母取有值成员数、且卡片不显示样本量；0 人填时按 `0` 输出 —— 「合计 0 / 平均 0」被读作「该指标为 0」而非「无人填过」，属编造数据；部分人填时「平均 12」也无法判断是几人平均。

更根本的是**规则本身猜不出意图**：「按字段类型自动出卡」无从判断某个 number 字段是否该 tag 的核心指标。故整块移除，不修口径。

后续形态（若需要）：统计能力回归的前提是「成员多到一屏看不完」；实现方式为在视图配置中**显式指定统计字段**（随 per-tab 配置持久化、可随筛选变化），而非零配置自动出全。

**身份条。** 标题区之下设一行承载 tag 身份与模板入口：描述字段 + 颜色选色器 + 「设置」按钮。前两者与管理页右栏（D5）**同一组件、同一写入原语**，在聚合页侧只是**消费方**，不持有真相、不引入第二份状态；「设置」为模板类入口（见下）。系统标签整行身份只读（描述 / 颜色不可点），设置入口保留——模板本就不许改，但仍需能跳过去看到。

**设置入口。** 面包屑「标签 / #x」（已实施）保持为返回管理页的导航，语义不变；另设**设置入口** —— 跳转 `/tags` 并**选中当前 tag 的详情**（区别于面包屑的「仅到列表」）。入口形态与边界见 D12。

**字段面板的候选池边界。** 聚合页的列模板只由「内容 + 来源页 + 该 tag 的有效字段」构成，故字段面板的候选池（`candidateFields`）限同三者 —— 否则一个无字段的 tag 会把全量内置字段列成候选。注册表本身仍持全量内置字段：看板按 `groupBy='status'` 建分组列、日历按 `dateRefKind='deadline'` 落格均依赖这些描述符，收窄 `fields` 会让两者退化。筛选 / 排序 / 分组三个菜单沿用全量字段池（查询层按 block 属性筛选是数据事实）。

### D8：数据层改名 —— Tag 前缀直改
`FieldDefinition` → **`TagFieldDefinition`**，`FieldValue` → **`TagFieldValue`**——与现名一一对应加前缀，语义即「tag 模板里的字段 / 其值」，迁移机械可脚本化（Rust 类型 + 表名 + TS 类型 + serde rename 评估）。

### D10：父标签继承 —— 对齐 Tana Extend，单父树 + 向上聚合

**Tana 参考**（官方文章 "When to use Extend in supertags" 与产品文档）：
- Extend ≈ OOP 继承，**每个 supertag extend 一个 base**（单父）；`#todo` 被 `#dev task` / `#design task` / `#bug` 分别 extend。
- **查询向上聚合**：搜 `#todo` 返回「#todo 的所有命中，以及 extend 它的其他 supertag」——子 tag 成员无需挂父 tag 即可被父 tag 查询命中。
- Tana 的字段定义（`>字段名`）是 supertag 内的独立模板实体，**不是 tag**——与 ADR-0049 `FieldDefinition` 建模对齐，无需改。

**决策**：
1. **单父树**：`Tag.parent_id` 一列（nullable），双端幂等迁移；设父时沿链向上走做**环守卫**（拒绝成环）。多父被否（两条祖先链的同名消解需额外裁决，Tana 亦单父）。
2. **字段模板解析（Rust 单源）**：`effective_field_ids(tag)` = 自身 > 直接父 > 更近祖先（同名近者胜）。消费点：D1 挂载即显示的编辑区字段集合、聚合页列、管理页详情（继承 badge）。
3. **成员向上聚合**：聚合页 / 过滤（含 D4 TaskHub）的 tag 命中集合 = **自身 + 全部后代 tag（descendant 闭包）的成员**；管理页列表「N 个成员」显示**直系数**（非含后代的聚合数）。TaskHub 由此获得「extends #task 的自定义 tag 也进任务列表」的 Tana 语义。
4. **继承模板不写入成员**：继承只影响模板合成与查询可见性，不给任何块写任何东西。

### D9：三阶段实施
- **阶段 1（已实施，`b955b79`）**：UI tag 驱动 + 继承全套——挂载即显示（D1，字段集合走 effective 解析）、chip 点击导航聚合页（D7）、标签管理页（D5，含新建/删除/字段模板编辑/继承区）、`parent_id` 迁移 + 环守卫 + `effective_field_ids` 解析器 + descendant 闭包（D10）。
  - 实施形态：`/tags`（管理页）与 `/tags/:tagId`（聚合页）两条独立路由，聚合页复用查询页外壳与既有三视图栈；解析与闭包经 `tag tree` 单次读接口暴露（`parent_id` + `effective_field_ids` + `descendant_ids`），前端只做缓存与投影。删除用户标签前告知影响（成员数 / 来源页数 / 子标签失去继承 + 值保留可复挂恢复）。
- **阶段 2**：TaskHub 过滤源切 tags + descendant 闭包消费（D4）+ `ensureTodo` 原子化（D2）。
- **阶段 3**：数据层改名（D8）+ PropertyService 适配层删除 + UI 命名迁移（Property* 组件退役）。
每阶段可独立提交、独立验证（vue-tsc / lint / vitest 门禁）。

### D11：标签身份三要素 —— title + description + color

Tag 从「字段模板」升为「有身份的实体」：除既有 `title` 外，新增 `description`（单行文本）与 `color`（调色板选色，可空 = 无色）。

**数据层**：
- `Tag` 表新增两列 —— `description TEXT NOT NULL DEFAULT ''`、`color TEXT NOT NULL DEFAULT ''`（`''` = 无色）；双端（SQLite / SqlJs）幂等迁移，与既有的 `parent_id` 同款。
- **两列均不用 NULL**：sql.js 路径 NULL 与空串不可区分（`row_to_tag_js` 已为 `parent_id` 写「空串 → None」归一化），而此处空串是**有意义的值**；且 `batch.rs` 既有的 `optional_str_param` 会把空串折成 `None`，无法表达「清空」。故写入侧统一为「**缺失 / null = 保持不变，空串 = 清空**」单语义，两字段共用一个参数助手，无三态。
- Rust `Tag` struct 同步加字段（`#[serde(default)]` 保证旧 payload 可反序列化）；更新入参经 `TagService::update` 扩展承载。
- `src/types/tag-persisted.ts` 的 `PersistedTag` / `UpdateTagParams` 同步；`CreateTagParams` **不加**这两字段 —— 新建弹层（D5）只收标题 + 父标签，无消费方。

**颜色存储形态**：存 **design token 名**（如 `--tag-color-3`），不存 hex —— 沿用「组件样式只用 `var(--*)`、禁硬编码色值」铁律。调色板定为 **8 色**（`--tag-color-1..8`），取值集 =「无色（`''`）+ 8 色」；色值只在 `src/styles/tokens/_semantic.scss` 的亮 / 暗两个色块各定义一次，TS 侧名单（`src/utils/tag-color.ts`）是唯一消费入口，其单测直接读该 SCSS 双向比对以防两份名单漂移（漂移表现为色点渲染成透明点 / 已选色点不回来）。

亮色取 600/700 号段、暗色取 400 号段：chip 以该色**作文字色**，故须各自在亮底 / 暗底上过 WCAG AA（实测亮 4.5–5.9、暗 6.5–10）。第 1 位与既有默认色同源，且 `--color-tag` **收敛为其别名**（`var(--tag-color-1)`）——单源无重复；又因「无色」与「选色 1」观感一致，全部既存 tag（`color=''`）零观感变化，`.block-tag` 等既有消费点零改动。

**消费纪律**：色值来自存储（跨设备同步 / 旧版本 / 手改 DB 都可能给出任意串）且要拼进内联 `style`，故一律经白名单校验（`isTagColorToken`）后才进 HTML 属性，不白名单即留 CSS 注入面；未通过者按**无色**处理（落回 `--color-tag` 默认）。同一判据必须同时驱动「是否给出样式」与「空心环 / 实心点」的形态判断，否则历史非法值会出现「有类无色 / 无色无类」错配，最坏渲染成既无背景又无边框的不可见点。

**消费面（一个色值贯穿所有出现点，单源）**：

| 出现点 | 载体 |
|---|---|
| 成员块内联 `#tag` chip | **两态同形**，均为 `.block-tag` 胶囊、`#` 按字面渲染（切换编辑/渲染零抖动）。渲染态 = `useContentRenderer.ts` 产出，色**随 Rust `RenderSegment::Tag` 的 `color` 字段下发**（与 `is_system` 走同一次 tag 查找，无额外成本；渲染器是纯函数，若改用 `tag_id` 回查 store 会把状态依赖拖进渲染路径）。编辑态 = `InlineTagExtension` 的**单层 Decoration 盖住整个 `#tag`**，色由宿主（`Editor.vue`）注入 `title → info` 解析闭包（扩展不碰 Pinia；标签树异步到位后由宿主 dispatch 空 transaction 逼装饰重算）。`#` 不换成图标是**硬约束**：ProseMirror inline decoration 是扁平区间（渲染前 `removeOverlap` 强制消解部分重叠），同起点的「图标 + 胶囊」两层会被截断合并成同一元素，mask 图标与胶囊底色抢同一个 `background`，物理不可达 |
| 聚合页标题区 | `TagAggregateBody.vue` |
| 管理页列表行 / 详情标题 / 继承区父标签 chip | `TagsLibrary.vue` |

编辑态 chip 与 `useBlockEditorLifecycle.handleContentMousedown` 的 `.block-tag` 早退守卫相交：守卫须按「目标不在 `.ProseMirror` 内」收窄为渲染态专用，否则块激活后从 chip 字符内起拖会跳过 ADR-0035 的文本选区跟踪、拖不出本块。

描述与颜色有**两处编辑入口**（管理页右栏详情见 D5、聚合页标题区），但为**同一份数据、同一组写入原语**，不引入第二份状态；两处可编辑性约束一致（系统标签只读）。

### D12：设置入口 = 模板编辑单点 + 一步到达

标签设置按变更影响半径分两类，边界如下：

| 类别 | 内容 | 编辑面 |
|---|---|---|
| **身份**（D11） | 描述、颜色 | 管理页右栏详情 **+** 聚合页标题区（两处均可改） |
| **模板** | 字段模板增删（`Tag.field_ids`）、父标签继承（`parent_id`） | **仅管理页右栏详情**（D5），不重复实现 |

聚合页对模板类只提供**入口**，不复制编辑 UI：入口 = 跳转 `/tags` 并选中当前 tag。

理由：模板编辑牵动三类约束 —— 字段定义全局共享（改它等于改所有引用方）、系统标签只读、继承环守卫；两处实现必然漂移。身份类不同，它只影响本 tag 自身的展示，故可多入口。

### D13：字段默认值 —— 存于字段定义，打标时自动填入

`FieldDefinition` 新增 `default_value TEXT` 列，取值为 **JSON 文本**，形态与 `FieldValue.value_json` 一致（`number` 存 `8`，`string` 存 `"8"`）；`NULL` / 空串语义相同 —— 无默认。

**双写入路径**：`storage/entity/field_definition.rs` 只覆盖 native，`storage/sqljs.rs` 是另一份独立实现（含各自的 `CREATE TABLE` 与 `ALTER TABLE` 迁移）。新增列必须在两处同步，否则浏览器侧保存默认值会静默失效。存量库靠幂等迁移 `migrate_add_field_definition_default_value`（`pragma_table_info` 守卫）；注意 `open_in_memory` 只建表不跑迁移，故 `CREATE TABLE` 内也必须带该列。

**写入**：`field_definition` 的 create / update 两个 batch op 透传 `default_value`；update 用「请求含该键才写」的语义，因此传空串可显式清除。

**生效时机**：仅在区块**新获得**某个标签时填入，取差集 `(打标后的 tags) − (打标前的 tags)`，由 `TagService::apply_field_defaults_for_new_tags` 执行：遍历这些标签的有效字段（D10 继承链），跳过已有 `FieldValue` 的字段，其余按 `default_value` 落一条 `FieldValue`。重复打同一个标签、或单纯保存区块内容，都不会覆写已存在的手写值。接入点是 `block/set_tags` batch op —— 同步侧在此登记新建的 `FieldValue`。

理由：默认值若只存不用，就是给用户看的装饰，因此选择了「落到 `FieldValue`」而非「仅作字段定义属性」。限制在差集而非「每次保存都补」，是为了保证幂等 —— 否则用户清掉某个默认值后，一次无关保存又会把它写回来。自动填入失败不影响打标本身（错误只做诊断输出）。

### D14：字段面板呈现 —— 内联取色 + 四列就地编辑

管理页右栏（D5）的字段模板区调整三点：

1. **取色器内联**：`TagColorPicker` 增 `inline` prop；内联态直接渲染调色面板，不走 BasePopover，面板在不离开右栏的前提下完成取色（ADR-0009 D8 要求浮层 Teleport 的原由在此不适用 —— 它没有被 `transform` 祖先困住的布局前提）。
2. **四列就地编辑**：字段模板是「字段 | 类型 | 默认 | 来源」四列表格。字段列点一下变输入框（挂载即全选，回车 / 失焦落库，Esc 取消）；类型列恒为下拉，切换即落库（`select` 的展示名是**枚举**）；默认列对非枚举类型点一下按类型出控件（text / number / date）。来源列只读 —— 自身声明写「自身」，继承字段写声明它的祖先标签名（不再拼「继承 ←」，列头已说明语义）；列名最多 5 个字，截断的行才挂 `title`（hover tip）。页面不再有「编辑」按钮与行展开面板：编辑入口就是单元格本身，行点击不再兼作展开开关。
   - 继承字段（定义归祖先）与系统标签整行只读：不给输入框、不给类型下拉、不给移除入口 —— 定义是全局共享的，改它等于改所有引用方，UI 上给了入口就会撞 Rust 侧拒绝且无提示。
   - **枚举的选项长在「默认」列的下拉里**：该列是触发器，展开的面板同时承担「设默认值」与「维护选项」—— 点选项即设为默认，每行另有改名 / 删除，底部输入框回车追加（最后一项不给删，要换类型就动类型列）。改名 / 删除若命中当前默认值，默认值在同一条 update 里跟着改或清空，避免表里显示旧名而落库值已变。面板宽度随选项内容自适应（`width: max-content` + 上下限），底部输入框配 `size=1` —— 输入框默认 20 字符的固有宽度会把自适应顶没。
   - 「切成枚举」是两步写：选项还没补时**不落库**（`pendingSelectId` 本地挂起并直接打开选项面板），补第一个选项时才一次写完 `type: 'string'` + `closed_values`；反之清空选项即降级为文本。空选项的枚举无意义，先落库会让类型显示回退成文本，看着像没改。
3. **列表限高滚动**：`.tag-fields` 限 `max-height` + `overflow-y: auto`，字段数增长时不撑破右栏。

### D15：块下标签字段区展示治理（去重 + 全局字段展示偏好）

**Context**：`BlockTagFields`（块 content 下方「Tag 本位字段区」，D1 挂载即显示）当前将所有字段一律渲染为「标题: 值」纯文本 + `—` 占位，既不读 `displayStyle` / `displayPosition`，也无任何显隐控制。后果：① 字段在多处重复展示（如 `status` 已在 `PropertyInline` 内联槽以任务图标渲染，下方字段区又出「状态: 进行中」纯文本）；② 用户无法控制该区域整体是否显示、单个字段是否显示、以及以何种形态显示。

**决策**：

1. **按 `displayPosition` 自动去重（已实施，最小变更）**：`BlockTagFields` 渲染前剔除已由 `PropertyInline` 在**内联槽真正渲染**的字段，下方字段区不再重复。`PropertyInline` 实际只渲染 `displayPosition === 'between-bullet-content'` 的字段（如 `status`，以任务图标呈现在 bullet 与内容之间），故下方仅排除该类。`right-of-content` 当前仅 `priority`，而它已被 `PropertyInline` 显式排除出右侧槽（入口移至斜杠命令面板），并不在 inline 渲染，因此**必须保留在下方、不能一并排除**——去重不能简单按 `displayPosition` 枚举一刀切，必须对齐 `PropertyInline` 的真实渲染集。`bottom-of-block` 与未声明 `displayPosition`（自定义 tag 模板字段）始终留在下方字段区。判定经 `getPropertyDefinition(key)` 反查编译期 `FieldDefinition`（`PersistedFieldDefinition` 不持久化 `displayStyle` / `displayPosition`，见 `tag-persisted.ts:6`）。
2. **全局总开关**：新增全局偏好控制 `BlockTagFields` 区域整体是否渲染。**（待实施，超出本次诉求）**
3. **每字段展示偏好（全局，按 field key）**：偏好 map 以 field key 为键，值为 `{ hidden?: boolean, displayStyleOverride?: 'icon' | 'icon-text' | 'text' }`。`hidden` 控制该字段在下方字段区是否出现；`displayStyleOverride` 复用既有 `displayStyle` 枚举，决定以图标 / 图标+文字 / 文字三种形态之一呈现。**（待实施，超出本次诉求）**
4. **持久化归属 = 全局用户偏好（按字段 key）**：不按 tag、不按 block 实例。理由：下方字段区的字段是「块所挂标签的有效字段并集」，按 tag 会在多 tag 同名 / 合并时产生冲突，按 block 粒度过细且存储与 UI 成本过高；按字段 key 的全局映射无歧义、一处配置全仓生效。**（待实施，与第 2/3 条同批）**
5. **展示形态升级**：下方字段区从纯文本升级为三态渲染（图标 / 图标+文字 / 文字），复用 `PropertyDisplay` / `PropertyInline` 已有的 `getIcon` / `getLabel` 与 `displayStyle` 判定逻辑，不另造渲染器。**（待实施，与第 2/3 条同批）**

**已否决替代方案**：按「系统字段 → 独立 UI / 自定义字段 → 按类型 UI」分流的渲染器注册表。展示元数据本就统一按 `FieldDefinition`（`displayStyle` / `displayPosition`），不存在系统 / 自定义分流需求；去重与可控可见性由本决策覆盖，双轨注册表会重复既有统一机制且解决不了真实问题（信息重复展示 + 可见性不可控）。

**实施形态**：第 1 条（去重）已落地于 `src/components/Block/BlockTagFields.vue`（`fields` computed 经 `getPropertyDefinition` 反查，排除 `between-bullet-content`），配套断言见 `BlockTagFields.test.ts`。第 2–5 条（全局偏好 / 每字段显隐 / 三态渲染）为后续增量，待用户明确要求「可控可见性」时再开轻量 store（如 `useFieldDisplayPrefs`）与配置入口；本次仅解决「重复文字字段」诉求，不在下方引入图标渲染或偏好存储。

### D16：保存回写派生 block.tags + 系统任务 tag 自动 ensureTodo

**Context**：`_doSave` 保存成功后只回写 `renderSegments` / `id`，漏回写 Rust 从 content `#tag` 引用派生的 `block.tags`。`BlockTagFields`（D1 挂载即显示）读 `block.tags`，故在块内输入 `#tag` 后下方字段区不刷新，需手动切页 / 重开才更新；`#task` 等系统任务 tag 也不会因引用而自动建 `status` 属性，status 任务图标（由 `status` 属性驱动，非 tag 引用）因此不出现。

**决策**：
1. **保存回写派生 tags**：`_doSave` 在 `savedBlock.tags` 存在时写回 `currentBlock.tags = savedBlock.tags`。tags 是 content 引用经 Rust 解析的产物，本地 store 必须镜像该解析结果，否则 UI 滞后于输入。
2. **系统任务 tag 自动 ensureTodo**：新增 `systemTaskTagId()`，按「`is_system` 且其有效字段中含 `key==='status'`」稳健识别系统任务 tag（不硬编码 id / 标题，避免 seed id 或本地化标题变动失配）。块引用该 tag 且无 `status` 属性时，`fire-and-forget` 调 `ensureTodo`（幂等 + `ensureTodoInFlight` 并发守卫），失败不影响本次保存落库。

**理由**：① tags 真相在 Rust 侧（content 解析 → 标签归属），JS 重算只会漂移；回写是让 store 与真相一致的最小动作。② status 图标依赖 `status` 属性而非 tag 引用，原仅「内容含 dateRef」或 TaskHub 新增流程建属性；普通引用系统任务 tag 不会触发，故保存时兜底补建（D2 意图的落地：挂载即确保属性就位）。

**已否决替代方案**：① JS 侧重解析 content 算 tags —— 重复 Rust 逻辑、双份真相、漂移风险；② 硬编码系统任务 tag 的 id / 标题判定 —— seed id 或本地化标题一变即失配。

**实施形态**：落点 `src/stores/blocks.ts`（`_doSave` 回写 + `systemTaskTagId` + ensureTodo 兜底）；回归见 `src/stores/blocks.tags-sync.test.ts`（3 例：tags 回写 / 自动 ensureTodo / 已有 status 不重复）。已随 `08bc027` 提交。

## 开放问题

- `TagFieldDefinition` / `TagFieldValue` 表名是否随 Rust 类型同步改（含 serde rename 对已同步设备 payload 的兼容评估）。
