# ADR-0050: Tag 本位字段交互与 Tag 聚合页

> **状态：D1–D21 已定稿（D21 已实施；D5 / D7 / D10 已修订，见段内标注）；阶段 1（D1 / D5 / D7 / D10 + chip 点击导航）已实施（`b955b79`）；阶段 2（D2 / D4）已实施（2026-10-07，见 D9）；D11 / D12 / D18 与 D17 §1/§3（继承树）、D19 / D20 均已实施；阶段 3（D8 改名）待按 D8 审计推进**。上游决议见 ADR-0049「方向决议：tag 本位，属性概念退役」段与 CONTEXT.md 词条 **Tag / Tag Field / Property (RETIRING)**。

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
| 标签颜色（调色板） | 标签身份三要素之三（D11）：9 色固定调色板（`--tag-color-1..9`）+ 可清除（选中即写，无确认步骤；点当前色不落库）；色值存 design token 名，与聚合页身份条 / 成员块内联 chip 同源。系统标签只读——写入侧 Rust `reject_system_tag` 拒之，故 UI 不给可点入口（给了就是「点了没反应且无提示」的静默失败） |
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

**实施前置核查（2026-10-07，审计结论改写成本结构）**：

全仓 `Property` 残留 = Rust 34 处 + TS 215 处，按改名风险分三档：

1. **持久化面（禁改 / 只能加别名）**：
   - `block.type == "property"`（`render_segment_service.rs:15/76/125`）：**库内数据**的 block 类型值，历史 property 块行永久存在 —— 字面值永久保留；
   - batch op entity 字符串 `("property", "create"/"set"/"update"/"delete")`（`batch.rs:368/409`）：同步队列里的 op 载荷键，历史 op 回放必须可解析 —— 只能**新增** `"field_value"` 别名双读，不可替换；
   - `FieldDefinition` / `FieldValue` 表名（`sqlite.rs` / `sqljs.rs`）：已同步设备的库文件持有旧表名，改表名 = 双端 `ALTER TABLE RENAME` 迁移 + serde 兼容评估 —— 即本 ADR 开放问题，**维持开放**。
2. **契约面（双端同步改、无持久化）**：wasm 命令名 `set_property` / `delete_property`（`comind-wasm/lib.rs:341/370`）↔ `client.ts` 方法名 —— 改名收益纯命名美学，代价是 JS/Rust/测试三处同步发版，且无任何行为差异。
3. **UI/内部面（安全、机械）**：TS 侧 215 处的大头 —— `PropertyInline` / `PropertyDisplay` 等组件名、`utils/property-codec.ts` 文件与导出名、注释与测试名。改名零行为变化，但触点面广（Block 域十余文件）。

**结论**：D8 的字面全量改名（Rust 类型加 `Tag` 前缀 + 表名迁移）在开放问题未裁决前**不实施**。建议拆解：3a = UI/内部面机械改名（独立纯命名 PR，随时可做）；3b = 契约面（双端同发，低收益）；3c = 表名（随开放问题裁决）。在 3c 落定前，`property` 命名在持久化面作为**兼容别名永久保留**。本核查即阶段 3 的现状交付；3a/3b/3c 的取舍待裁决后另立工单。

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

**D10 修订（2026-10-07）：字段复用与层级解耦**

背景：`FieldDefinition` 建模上本就是全局共享行（可被多个标签引用，改一处同步生效），但「添加字段」入口每次都新建定义，跨域复用模板只能手动重抄——抄出来的是同名不同 id 的独立定义，值不互通、改名不同步。

修订决策：
1. **字段模板复用与单父层级解耦**。层级（单父 `parent_id`）只保留成员聚合职责（本决策第 3 条不变），不再是字段复用的唯一通道。
2. **第一步 = 字段级引用**：「添加字段」入口增加「引用已有定义」（从其他标签借字段，而非必新建）。字段按定义引用组合：同名即同一定义、处处同步。零模型改动、零迁移；同名消解问题在此路径下不存在（同名就是同一行）。
3. **tag 级组合列后置**：仅当出现真实的「整组活引用」需求（组合一个标签后，其后续新增字段自动跟进）时，再引入 `composed_ids`（只借字段、不动成员）。届时需处理同名消解裁决与悬空组合引用（可复用既有「悬空引用保留、读侧过滤」语义）。
4. **多父 DAG 否决**：成员多维归属（一个标签同时属于两个聚合闭包）是 DAG 相对单父的唯一增量，而块的多标签能力已覆盖其大部分场景；其剩余价值仅为「分类完整性保证」（打了子标签必然被父聚合命中、不依赖手动补打），若该需求成真，单独立项，不与字段复用捆绑。维持单父避免两条祖先链的同名消解与 descendant 闭包多链化。

生效顺序：第 2 条先行实施；第 3 / 4 条为方向决议，不排期。

**D10 修订增补（2026-10-07）：字段引用实施决策**

第 2 条（字段级引用）的实施口径：

1. **入口 = 搜索合一式弹层**：现有「+ 添加字段」弹层顶部加搜索框，输入即过滤全部候选定义，点击即引用；无命中时出现「新建」表单（沿用现有 标题 / 类型 / 枚举候选值 表单）。单一入口同时覆盖「引用」与「新建」两种意图。入口仍在标签管理页右栏，D12 模板单点不变。
2. **候选范围**：全部存活 FieldDefinition——含 `is_system` 系统字段（status/priority 可不经继承直接引用）、含孤儿定义（见 CONTEXT.md 词条）；排除本标签有效字段集已含的（自身已声明 ∪ 继承已覆盖），防止冗余声明与继承/引用双通道重叠。
3. **编辑权**：字段行可编辑判据 = 本标签已声明该定义（`field_ids` 含之）**且**定义非 `is_system`。引用方与首个声明方同权就地编辑（定义全局共享、改一处处处同步）；继承行（未声明）依旧只读。此规则取代旧注释「只允许从声明它的那个标签发起编辑」——定义被多方引用成为常态后，「那个标签」无主。`is_system` 定义在任何标签的表中恒只读（与现状一致）。
4. **来源列三态**：自身 / 引用←X / 继承←X。X = 首个声明者（存活标签中 `created_at` 最早且 `field_ids` 含该定义者；全无其他声明者即自身）。前端计算，不给 FieldDefinition 加 owner 列。
5. **Rust 零改动**：引用 = `setOwnFields` 追加定义 id；`effective_field_ids`、块级并集去重（`BlockTagFields` 按定义 id）、打标默认值回填、聚合页列全部自动生效。同步落库走既有 `updateTag` 路径。
6. **移除语义不变**：× 统一只解除声明、不删定义（孤儿定义保留可复引）。

### D9：三阶段实施
- **阶段 1（已实施，`b955b79`）**：UI tag 驱动 + 继承全套——挂载即显示（D1，字段集合走 effective 解析）、chip 点击导航聚合页（D7）、标签管理页（D5，含新建/删除/字段模板编辑/继承区）、`parent_id` 迁移 + 环守卫 + `effective_field_ids` 解析器 + descendant 闭包（D10）。
  - 实施形态：`/tags`（管理页）与 `/tags/:tagId`（聚合页）两条独立路由，聚合页复用查询页外壳与既有三视图栈；解析与闭包经 `tag tree` 单次读接口暴露（`parent_id` + `effective_field_ids` + `descendant_ids`），前端只做缓存与投影。删除用户标签前告知影响（成员数 / 来源页数 / 子标签失去继承 + 值保留可复挂恢复）。
- **阶段 2（已实施，2026-10-07）**：TaskHub 过滤源切 tags + descendant 闭包消费（D4）+ ensureTodo 原子化收尾（D2）。
  - D4：`TaskHub.vue` 过滤谓词从「status 非空」切为「`card.tags` ∩ 任务命中集合」；命中集合 = `systemTaskTagId()` + `memberTagIds` 后代闭包（extends #task 的自定义 tag 也进任务列表）。标签树未就绪 / 无系统任务 tag 时降级回「status 非空」旧口径（不空列表）。
  - D2：`fieldValue.ensureTodo` 挂载前置——`ensureTaskTagMounted` 保证 content 含 `#任务` 字面（已挂载 / 文本已含则不动 content；追加后 `flushSave` 强制落库，Rust 保存时派生 `Block.tags`），随后才写 status；块缺失中止（无半态），标签树无系统任务 tag 时降级直写。象限新增流改为「先写象限 priority → ensureTodo（挂载 + status）」，避开默认 Low 的多余写入。
  - 回归：`TaskHub.test.ts`（D2 挂载：content 文本 + store tags 双确认；WASM 端 `getBlockCards` 恒空、`getBlocksByPage` 不带 tags，DB 侧取证面缺失）+ `TaskHub.d4filter.test.ts`（过滤口径 2 例，mock client 控制投影）。
- **阶段 3**：数据层改名（D8）+ PropertyService 适配层删除 + UI 命名迁移（Property* 组件退役）。
每阶段可独立提交、独立验证（vue-tsc / lint / vitest 门禁）。

### D11：标签身份三要素 —— title + description + color

Tag 从「字段模板」升为「有身份的实体」：除既有 `title` 外，新增 `description`（单行文本）与 `color`（调色板选色，可空 = 无色）。

**数据层**：
- `Tag` 表新增两列 —— `description TEXT NOT NULL DEFAULT ''`、`color TEXT NOT NULL DEFAULT ''`（`''` = 无色）；双端（SQLite / SqlJs）幂等迁移，与既有的 `parent_id` 同款。
- **两列均不用 NULL**：sql.js 路径 NULL 与空串不可区分（`row_to_tag_js` 已为 `parent_id` 写「空串 → None」归一化），而此处空串是**有意义的值**；且 `batch.rs` 既有的 `optional_str_param` 会把空串折成 `None`，无法表达「清空」。故写入侧统一为「**缺失 / null = 保持不变，空串 = 清空**」单语义，两字段共用一个参数助手，无三态。
- Rust `Tag` struct 同步加字段（`#[serde(default)]` 保证旧 payload 可反序列化）；更新入参经 `TagService::update` 扩展承载。
- `src/types/tag-persisted.ts` 的 `PersistedTag` / `UpdateTagParams` 同步；`CreateTagParams` **不加**这两字段 —— 新建弹层（D5）只收标题 + 父标签，无消费方。

**颜色存储形态**：存 **design token 名**（如 `--tag-color-3`），不存 hex —— 沿用「组件样式只用 `var(--*)`、禁硬编码色值」铁律。调色板定为 **9 色**（`--tag-color-1..9`），取值集 =「无色（`''`）+ 9 色」；色值只在 `src/styles/tokens/_semantic.scss` 的亮 / 暗两个色块各定义一次，TS 侧名单（`src/utils/tag-color.ts`）是唯一消费入口，其单测直接读该 SCSS 双向比对以防两份名单漂移（漂移表现为色点渲染成透明点 / 已选色点不回来）。

chip 以该色**作文字色**，故每色在亮/暗主题各给一值：亮主题 = 基准色固定色相/饱和度降亮（白底对比度 ≈5.0），暗主题 = 同参数升亮（暗底对比度 ≈5.5），实测亮 4.98–5.05、暗 5.46–5.55。色板为**柔和语义色板**：灰=默认 / 红=重要 / 橙=待办 / 琥珀=提醒 / 绿=完成 / 青=信息 / 蓝=概念 / 紫=思考 / 粉=个人。与 indigo 强调色系（`--color-accent` 亮 = `indigo-500` / 暗 = `indigo-400`）分离：全板距强调色最近为蓝 20.6°、紫 24.1°（柔和蓝紫 vs 鲜艳强调色，视觉可辨）；相邻色相间距除 橙↔琥珀 18.1° 外均 ≥27°。`--color-tag` **收敛为第 1 位别名**（`var(--tag-color-1)`，亮暗各一次）——单源无重复，且「无色」与「选色 1」观感一致，`.block-tag` 等既有消费点零改动。

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

**Status**：已废弃——实施代码已丢弃，展示控制改由 D17 以「挂字段定义的模板化配置」承载。

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

### D17：标签管理页重构 + 字段展示配置挂字段定义（取代 D15 展示治理）

**Status**：accepted（§1 左栏继承树 + 拖拽分隔条、§3 右栏继承树可视化已实施；§2 展示配置列被 D21 修订——显隐语义改为形态覆盖语义，整区可见性改挂块级，见 D21）

**Context**：D15 的展示治理（消费侧全局 localStorage 偏好 + 渲染前去重）实施后废弃，代码丢弃。重新审视问题本源：① 真正的空间瓶颈在标签管理页右栏——字段模板四列表、枚举选项、继承信息全挤在一个窄面板里；② 展示控制应该属于字段模板的一部分（模板语义），而非消费侧全局偏好。曾考虑以「字段管理弹窗」扩容，被否决：弹窗阻断左栏标签切换流，治标不治本。

**决策**：

1. **标签管理页整体重构**：左栏从平铺列表改为**标签继承树**——按父子层级缩进呈现（节点 = 色点 + 标题 + 字段数），现有筛选胶囊（全部 / 最近使用 / 未使用）与搜索保留并作用于树内过滤；左右栏默认加宽，中间加**可拖拽分隔条**（比例存 localStorage）。
2. **字段展示配置挂字段定义（默认不展示）**：`FieldDefinition` 新增持久化列（如 `block_display`），控制该字段是否在 block 下方字段区展示及展示形态；**默认不展示**，须在字段管理界面显式开启。一个字段一处配置，引用它的所有 tag 共享同一展示行为。**（D21 修订：「默认不展示」改为「默认展示、形态默认跟随字段类型」，该列语义由「是否展示」改为「展示形态覆盖」，见 D21。）**
3. **继承树只读可视化**：右栏新增继承树呈现——祖先链 + 各字段继承路径（哪个字段从哪个祖先来、被谁覆盖），节点可点击跳转对应标签；不提供树内编辑，父标签修改仍走现有继承区单父槽位。模板编辑单点保持在管理页右栏（D12 不变，仅空间变宽）。

**已否决替代方案**：

- **字段管理弹窗**（本议题最初形态）：阻断标签切换，且不解决页面空间结构问题。
- **D15 式消费侧全局偏好**（localStorage 按 field key + 默认全展示 + 渲染前去重）：与「字段属于 tag 模板」语义相悖；默认不展示的模板化配置使 status 双出去重自然成立，无需渲染侧去重逻辑。
- **展示配置挂 tag→field 绑定**：同字段可按 tag 差异化展示，但需将 `field_ids` 改为带属性结构或新建关联表，schema 与迁移成本过高。
- **树内编辑继承**：与继承区形成第二写入口，成环校验需重复实现。

**后果 / 待办**：

- 默认不展示是行为变更：既有 `bottom-of-block` 字段（project / area / book / chapter / quote 等）在 block 下方不再显示，须逐字段显式开启。
- Rust 加列走 `comind-core-add-column` 全流程（native + sqljs 双 CREATE TABLE、sqljs SELECT / INSERT / UPDATE、wasm32 check、wasm:build）。
- status 双出问题随「默认不展示」自然消失；D15 §1 的渲染前去重逻辑不再需要。
- 拖拽分隔条与树形左栏均属展示层，不触及 Rust schema；schema 变更仅 `block_display` 一列。

### D19：字段值单一权威展示位

**Status**：accepted（锚定诊断；具体归属侧待实施）

**Context**：D15 §1 的渲染前去重只对齐了**内联槽**（`between` / `right`），未对齐 `chips` 列，导致块上同一个字段值存在两个权威展示位。取证（`BlockTagFields.vue`）：

- `displayRows`（`chips` / `all` 消费）口径 = `bottom-of-block` 内置字段 + **全部自定义字段**（`!isSystemField`），排除 `deadline` / `scheduled`。
- `fields`（`list` 消费）口径 = 该块所挂标签的有效字段并集，**仅**排除 `between-bullet-content`。
- 两者筛选口径不同 ⇒ 一个「标签模板内声明、且已填值」的自定义字段，在行尾 chips 与 content 下方字段区各渲染一次；改值需盯两处确认，视觉上还要判断二者是否同一事实。

同时 `right` 内联槽已恒空：`inlineRows` 显式 `.filter(fv => fv.key !== 'priority')`，而全仓 `right-of-content` 仅 `priority` 一个字段（`tag.ts` FIELD_UI），该容器不渲染任何内容。

**决策**：

1. **不变量：块上每个字段值有且只有一个权威展示位。** 判据不是布局偏好，而是「同一事实两个权威源」——重复会让改值需要两处确认、且读者需自行推断两处是否同物。
2. **行尾 `chips` 列的存废是下游问题，不是本决策的答案。** 反证：单删 `chips` 列不消除重复（行内速览能力一并丢失，重复只是转移到「只能去下方找」）；单删 `list` 区则丢失模板字段的 `—` 占位与空字段引导（与 D1「挂载即显示」冲突）。故先定不变量，再定归属侧。
3. **归属侧按 `displayPosition` 分类落定**（实施时确认，见「实施形态」）：`between`内联槽独占 `between-bullet-content`，`chips` 列独占 `bottom-of-block`，`list` 区独占无行内渲染位的其余（`right-of-content` 的 priority + 无 `displayPosition` 的模板字段）。分类依据取编译期 `FieldDefinition.displayPosition` 这一既有单源，不新造判据。
4. **`right` 槽恒空代码清理**：`index.vue` 与 `Backlinks.vue` 的 `right` 变体容器、`BlockTagFields` 的 `right` 分支与 `inlineRows` 的 `priority` 排除一并移除。零行为变化（已恒空），纯减一层误导——留着会让读者以为存在行内优先级渲染位。
5. **D17 是本不变量的一条替代解**（未采纳）：其「`block_display` 默认不展示」也能使双出消失，但需新增持久化列。`hide_when` 已是同类控制列且含 `always`（详见「实施前置核查」），三条路径的成本对比见该节。

**已否决替代方案**：

- **直接删除行尾 `chips` 列**（诉求的原始形态）：把「去重缺陷」与「布局取舍」捆成一个是否题，删列只掩盖重复而不消除重复，且牺牲行内速览。 —— **此否决已被 D20 推翻**：后续核查证明该列的两个价值（行内速览、字段名）均被下方字段区完整覆盖且后者更准，删除不构成净损失。
- **扩展 D15 §1 去重逻辑、把 `chips` 消费的自定义字段从 `fields` 中剔除**：让行内 chips 独占自定义字段、下方字段区只剩内置字段。但两处筛选口径的差异（`有值` vs `模板内即显示`）本身承载不同语义（速览 vs 引导填写），强行对齐会牺牲 D1 的空字段引导。

**后果 / 待办**：

- 已实施（见下方「实施形态」）：不变量以`displayPosition` 分类落为消费侧去重，未新增任何
  schema 变更；恒空 `right` 槽已清理。
- **后续修正见 D20**：本段预设的「chips 列保留」前提不成立，该列已下线；块内字段展示统一由
  下方字段区承担。

**实施形态（2026-10-04）**：

不变量落为**消费侧去重谓词**，不动 schema：

1. **去重谓词**（`BlockTagFields.vue` `fields` computed）：排除面从仅
   `between-bullet-content` 扩为 `between-bullet-content` + `bottom-of-block`，即下方字段区
   不再重复 chips 列已渲染的字段。`right-of-content`（priority）仍保留在下方——它无行内渲染位。
   该式只作用于 `list` 变体；`chips` / `all` 共用的 `displayRows` 未改（`all` 由
   `Backlinks.vue` 消费，不在块行内，无本问题）。
2. **恒空 `right` 槽清理**：`index.vue` 与 `Backlinks.vue` 两处 `variant="right"` 调用点删除；
   组件内 `variant` 联合类型去掉 `right`、模板 `v-if` 收为 `between`、随之恒假的删除按钮删除；
   `inlineRows` 与 `betweenRows` 合并为一个（原先前者只是后者加 `right` 分支的别名）。
3. **回归网**：`BlockTagFields.test.ts` 三例——① `bottom-of-block` 字段不再出现在下方字段区；
   ② 混合标签（`book` + `owner`）下 chips 与下方字段区字段集合不相交（交叉断言）；
   ③ `priority` 仍留在下方。有效性已用「回退谓词 ⇒ 该例转红」逐例验过（避免假绿）。

**验证**：`vue-tsc -b` exit=0；`BlockTagFields.test.ts` 19 例全绿；改动文件 eslint 0 error。
全量 vitest 8 文件 12 例红，经对照实验（把三个改动文件 `git checkout HEAD --` 回到未改状态）
确认为既存基线——未改状态下同样 5 文件 9 例红，其中 `BlockList.task-progress.test.ts` 的
`client.getTagTree is not a function` 属 mock 夹具缺口（该 mock 只定义了 `getProperties` /
`setProperty`），`TagsLibrary.test.ts` 的 `最近` vs `最近使用` 属源码与断言文案不一致
（`TagsLibrary.vue:96`）。两者均与本次改动无交集。


**实施前置核查（2026-10-04，结论改写方案成本）**：

`hide_when`（D18 隐藏规则）已是**持久化到Rust 的字段定义级展示控制列**，且双存储路径齐备——
native（`storage/sqlite.rs:303` CREATE TABLE + `:620` 迁移）与 wasm（`storage/sqljs.rs:204` CREATE TABLE
+ `:347` 迁移 + SELECT / INSERT / UPDATE 全部携带）均已落地，配套消费侧基础设施完整：
`utils/field-hide.ts` 是判定单源（`FIELD_HIDE_VALUES` / `normalizeHideWhen` / `isFieldHiddenByRule`），
`TagsLibrary.vue` 管理页有第五列下拉就地编辑，`BlockTagFields.vue:356` 为块级消费方。

其取值表已含 `always`（=永不展示），即 D17 §2 所需的「可关闭展示」语义**已存在**。故D17 §2
新增 `block_display` 列的必要性需重估：三条候选路径 ——

1. **复用 `hide_when`（零schema 变更）**：`always` 承担「不在块字段区展示」。代价是语义叠加 ——
   「因值条件隐藏」与「因配置不展示」共用一列，下拉里 `always` 的字面意思（总是隐藏）与
   「该字段不参与块级展示」这一配置意图不完全等价，且改展示位归属需动既有列的取值空间。
2. **新增 `block_display` 列（D17 原案）**：语义独立、可反向恢复；但触发 `comind-core-add-column`
   全流程（native + sqljs 双CREATE TABLE /迁移、sqljs SELECT / INSERT / UPDATE、wasm32 check、
   wasm:build）。
3. ~~**先只做 D19 去重，`block_display` 暂缓**~~ —— **已采纳并实施**（见「实施形态」）：
   不依赖任何 schema 变更即消除了重复渲染。展示配置（路径 1 / 2）留待独立议题。

### D20：行内 chips 列下线，块内字段展示收敛到单一位

**Status**：accepted（已实施）

**Context**：D19 的去重按`displayPosition` 枚举分类实施后，实测仍存在重复，且暴露两层缺陷：

1. **分类维度错**：D19 只把 `bottom-of-block` 划给 chips，而自定义字段（`isSystem=false`、
   无 `displayPosition`）同时落在两处筛选谓词内—— `displayRows` 的 `!isSystemField` 收它、
   `fields` 排不掉它，**必然双现**。这是谓词的分类维度问题，不是漏判单个字段。
2. **标题失真**：chips 侧 `defOf` 只查系统 seed 派生的 `BUILT_IN_FIELDS`，自定义字段查不到
   定义，`titleOf` 的 `?? key` 回退 ⇒ 同一字段在 chips 侧显示 **field id**、在下方字段区显示
   真名。实测并存的形态：行尾 `f-muov2k…: 生活` 与下方 `分类: 生活`。

去重后该列已无独立价值 —— 逐项对照：行内速览（下方也渲染已填值）、字段名（下方**更准**）、
空值引导（已由下方 `—` 占位独占）。而它仍在付成本：撑高块行、占 420px 宽度预算、
整行铺背景纱。

**决策**：

1. **行内 chips 列下线**（`BlockTagFields` 的 `chips` 变体 + `index.vue` 的 `.block-row-properties`
   容器 + `hasRightProps` 判定）。块内字段展示统一由 `list`（content 下方字段区）承担。
2. **下方字段区不再排除 `bottom-of-block`**：它成了块内唯一展示位，域字段与自定义字段都在此
   列出。唯一排除项回到 `between-bullet-content`（status 以图标呈现，形态不同）。
3. **「+N」收纳机制随之移除**：`all` 变体（`Backlinks` 消费）改为全量平铺。
4. **行为守卫不因删渲染位而失效**：`SELF_INTERACTIVE_SELECTOR`（`index.vue`）中的
   `.property-item` / `.property-inline-item` 分支仍有效（分别由 `all` 变体与 `between`
   内联槽产出），仅行内 chips 一处消失，故选择器保持原样。

**已否决替代方案**：

- **保留 chips 列并修两处缺陷**（谓词去掉 `!isSystemField` + 标题按 `field_definition_id` 反查
  `tagsStore`）：仍留两类字段在两处，且要养两套标题取法（编译期反查 vs 持久化定义），
  同一字段仍可能因两套数据源而标题不一致。
- **锚到 `.block-content` 替代测试里的 chip**：块内容区本身要接 Ctrl+Click 切块，不属自交互
  元素，改锚等于换了一条不变量。改为锚 `.property-inline-item`（`between` 槽产出，仍在守卫内）。

**后果 / 待办**：

- 块行不再有右侧字段列，行高回落；`.block.has-right-props` 铺底规则与 `.block-row` 的
  `flex-wrap` 一并移除（后者的存在理由仅是 chips 宽度自适应）。
- `App.vue` 的容器查询注释更新（该锚点已无消费者，但 `inline-size: containment` 保留不动——
  移除会改变 abs/fixed 后代的包含块语义，需单独验证）。

**实施形态（2026-10-04）**：改动 6 文件（`BlockTagFields.vue` / `index.vue` / `Backlinks.vue` /
`App.vue` / 两个测试文件）。SCSS 删 137 行（`.block-row-properties` 全族 + `has-right-props`
铺底 + `flex-wrap`）。回归：`BlockTagFields.test.ts` 21 例（含新增「自定义字段是最高频场景，
其值只在下方出现一次」的复现用例）、`Block/index.test.ts` 23 例（守卫用例换锚并用「移出守卫
选择器 ⇒ 转红」验证仍有效）。`vue-tsc -b` exit=0、eslint 0 error、全量 vitest 8 文件 12 例红
与改动前基线逐字一致（零净增）。

### D21：块字段区字段驱动形态体系（类型默认形态 + 逐字段覆盖 + 块级整区隐藏）

**Status**：accepted（已实施，2026-10-09；组件 `BlockFieldZone.vue`，原 `BlockTagFields` 更名——Tag 只承担聚合字段的角色，块字段区渲染的是块的聚合字段）

**实施形态（2026-10-09）**：

- 形态解析单源：`src/utils/field-display-form.ts`（`typeDefaultForm` / `normalizeDisplayFormOverride` / `resolveDisplayForm`，覆盖优先级 = 用户覆盖 > 编译期 displayStyle > 类型默认；icon / icon-text 无可用图标字符时渲染兜底回落 text）。
- Rust 列 ×1：`FieldDefinition.display_form_override`（`hide_when` 同构全触点：COLS / 双轨行映射 / create / update / batch 处理器白名单归一、sqlite + sqljs 双 CREATE TABLE 与幂等迁移、wasm32 check、`wasm:build`）。块隐藏态走 `block.format.fields_hidden` JSON 键（折叠态同通道），Rust 零改动。
- 渲染分派：`BlockFieldZone.vue` `list` 变体按形态出 chip（数组为 chip 序列、page 为引用 chip 点击导航）/ ghost（无值虚线，点击即录入）/ icon（boolean 值即 ✓/✗）/ text；`all` 变体经同一注册表分派（编译期定义 + 持久化覆盖合并解析）。
- 配置面：`TagsLibrary.vue` 字段模板第六列「形态」（跟随类型 / 胶囊 / 图标 / 图标+文字 / 文字），继承 / 系统字段只读沿用 `canEditField`。
- 显隐交互：`block.format.fieldsHidden` 为真时整区不渲染；隐藏开关挂字段带右上（`.block-properties:hover` 淡入），恢复入口绝对定位到块下方间隙（`.block-row:hover` 淡入、一般兄弟组合器），两者平时 `opacity:0 + pointer-events:none`（可点性铁律）。
- 回归：`field-display-form.test.ts`（12 例）、`BlockFieldZone.test.ts`（29 例，含 D21 分派与 ghost；旧 right 槽「尺寸 18」预期系测试侧规格漂移，随实现修正为 14）、`blocks.fields-hidden.test.ts`（2 例）。

**Context**：D20 收敛后，块字段区（`BlockTagFields` `list` 变体）是块内唯一字段录入面，但所有字段一律渲染为「标题: 值」纯文本行 + `—` 空占位：竖向逐行堆叠使块显著增高；形态上无法区分枚举、日期、页面引用等值类型，扫读时关键值不可辨。D17 §2 预设的「字段级显隐配置（默认不展示）」与 D1「挂载即显示、空字段引导录入」的录入面定位相互矛盾——字段不显式开启就永远不出现在录入面，空字段引导无从谈起；且字段级显隐与「整个字段区不要了」的诉求不在同一粒度。

**决策**：

1. **类型 → 默认形态映射（单源注册表）**：字段表现形态由字段类型决定，映射表单源收口（候选落点 `utils/field-display-form.ts`）：`string` + `closed_values`（枚举）→ 值 chip（色源复用既有 token 通道）；纯 `string` → 文字形态（「标题: 值」）；`number` → 数字徽章；`boolean` → ✓/✗ 图标；`date` → 日期胶囊（对齐 dateRef 既有形态）；`array` → 值 chip 序列；`page` → 页面引用 chip（点击跳转，对齐 `[[page]]` 导航语义）。系统字段沿用各自专属形态（status = between 槽任务图标、priority = right 槽象限网格、deadline / scheduled = dateRef），不在下方字段区重复（现状不变）。
2. **逐字段形态覆盖**：字段定义持久化列承载形态覆盖（取代 D17 §2 的「是否展示」语义）；未设置时跟随类型默认映射。配置入口在字段管理表（D14 四列就地编辑表）新增一列，编辑交互对齐既有单元格就地编辑约定。
3. **整区隐藏按块逐块控制**：块级持久化隐藏态，存于 `block.format` JSON（`fields_hidden` 键，与折叠态 `collapsed` 同通道），Rust 侧零改动；隐藏后该块不渲染字段区。它是块数据的一部分，不是 UI 临时态。
4. **D1「挂载即显示」保持为默认**：字段区默认渲染（作为唯一录入面）；整区隐藏是用户显式动作的结果，不是新字段的默认行为。
5. **形态覆盖取值空间（单维枚举）**：`display_form_override = 'auto' | 'icon' | 'icon-text' | 'text' | 'chip'`；`auto`（缺省）跟随类型默认映射，不设两维矩阵与自由组合。`chip` 为胶囊化形态，底色一律取中性 surface token——色环只留给 tag 一家（沿用「存 token 名不存 hex」铁律，不扩 `--tag-color-*` 消费面）。
6. **系统字段不可配**：系统字段的形态与其无值表现由编译期覆盖层（`tag.ts`）定死，不进字段管理表；用户字段可逐字段覆盖（继承字段定义归祖先，只读判据沿用 D14 既有约定）。
7. **无值表现**：自定义字段按类型默认映射出无值形态（如枚举 / 日期类型的虚线 ghost 胶囊，点击即录入）；与 D18 `hide_when` 条件隐藏机制并存——规则命中优先于默认形态。
8. **隐藏 / 恢复交互（hover 门控）**：隐藏触发 = 字段区 hover 淡入的 ×；恢复 = 块 hover 时在该块与相邻块之间的间隙淡入轻量入口。两条入口平时均不可见（与折叠 chevron 同一交互习惯），块静息态与普通块无异——不设常驻 ghost 占位，不进 BlockModal。
9. **`all` 变体同步**：Backlinks 消费的 `all` 变体与 `list` 共用同一形态注册表与渲染分派；同一字段值跨变体形态一致（D19「同物两渲染」教训的延伸）。

**对既有决策的修订**：

- **D17 §2「默认不展示」修订为「默认展示、形态默认跟随类型」**：字段级显隐配置被块级整区隐藏与逐字段形态覆盖取代（理由见 Context）。
- D15 已废弃，其 §3–5（三态渲染枚举、按 field key 全局偏好）不再实施；形态粒度从「icon / icon-text / text 三态枚举」升级为「类型驱动形态」。

**已否决替代方案**：

- **统一 chips 单行流**（全部字段收成横排胶囊）：只解决竖向密度，不解决「按值类型区分形态」；胶囊配色需为每字段引入色源，先例只有 tag 色一处，成本与收益不成比例。
- **D15 式三态枚举逐字段手选**：icon / icon-text / text 三态表达不了「页面引用该跳转」「日期该成胶囊」这类类型特有形态；手选把配置成本推给用户。
- **字段级显隐（per-field hidden，D17 §2 原案）**：与块级整区隐藏粒度重叠；多 tag 块的字段并集做字段级显隐需另裁决冲突规则，块级开关无此问题。
- **折叠摘要行（默认收起、点击展开）**：录入面从一跳变两跳，与 D1 直接冲突。

**后果 / 待办**：

- Rust 加列 ×1：字段定义表 `display_form_override` 列（`hide_when` 同构，5 触点 + 迁移：native + sqljs 双 CREATE TABLE、sqljs 读写、wasm32 check、`wasm:build`）。块隐藏态走 `format` JSON，Rust 零改动。
- 字段管理表加「形态」第六列（现为五列：字段 | 类型 | 默认 | 来源 | 隐藏），grid 列宽模板同步一档；枚举选项下拉面板形态对齐 D14 既有约定。
- 块间间隙恢复入口的落点在 BlockList 布局层，需与块拖拽落点指示区互斥；hover 显隐走「隐形元素 `pointer-events: none`、hover 淡入可点」既有铁律。
- 各类型形态的具体视觉规格（chip 内边距 / 圆角档位、日期格式、page 引用样式）按既有 token 与截图迭代惯例在实施中收敛。

## 开放问题

- `TagFieldDefinition` / `TagFieldValue` 表名是否随 Rust 类型同步改（含 serde rename 对已同步设备 payload 的兼容评估）—— **D8 实施前置核查（2026-10-07）已给出三档拆解（3a/3b/3c），表名档（3c）维持开放，待裁决**。
- ~~D17 §2 的展示配置是否仍需要独立列，抑或复用 `hide_when` 的 `always`（见 D19 实施前置核查）~~ —— **已由 D21 闭合**：独立列承载「形态覆盖」（非显隐），整区可见性挂块级隐藏态。
- `book-note` 来源行与下方字段区在 `quote` 存在时都展示 book / chapter，是否需去重
  （D20 后`book-note` 仍是独立渲染位，见 D20 决策 1 的连带面）。
