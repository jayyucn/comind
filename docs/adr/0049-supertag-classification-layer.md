# ADR-0049: 超级标签分类层（Supertag）——以现有原语扩展，不新建子系统

- Status: accepted（2026-09-18 经 grill-up 前提核查 + 四轮 grill + 一轮审视，Jay 逐条确认；设计已锚定，尚未实施）
- Date: 2026-09-18
- Supersedes: —
- Related: ADR-0009（无头查询分层）、ADR-0022（查询引擎工厂，实体无关）、ADR-0040（book 页种，加 'book' 同模式）、ADR-0032（z-index / token 规范，UI 须守）
- Tracking: 来自 Tana Supertag 文章的需求启发，但**文章结论不当前提**

## Context

需求启发：用户希望 CoMind 具备类似 Tana Supertag 的能力——任意节点贴标签即自动挂上结构化字段模板，并能把全库同标签节点聚合成视图。

**grill-up 前提核查（性价比最高的一步）显示：该诉求若按「从零设计一套 Supertag 子系统」理解是错的。** 事实核查 CoMind 现状：

| 维度 | 现状 | 与「标签+字段+视图+聚合」重叠 |
|---|---|---|
| 标签原语 | 全仓无 tag/supertag 实体；分类靠属性值（内建 `project`/`area`） | 完全缺失 |
| Block 属性 | `usePropertyStore`（set/delete→WASM）；`PropertyType` = string/number/boolean/date/array/page | 强重叠（字段已存在） |
| 引用/链接 | `WikiLinkExtension` 处理 `[[page]]` 与 `((type))[[X]]` typed-link；`Link` = block→page + `relationshipType`（用户可增删的注册表） | 部分（关系类型可复用） |
| TaskHub Page/View | `ScreenViewRust` 两级（Screen=Page / Tab=View）；字段经 `useBlockQueryRegistry`/`usePageQueryRegistry` | 强重叠（视图已存在） |
| 查询引擎 | `src/core/query/` 无头：filter（嵌套 AND/OR/negate）、sort、groupBy；`savedFilter` 存查询 | 强重叠（聚合入口已存在） |
| 视图系统 | 通用抽象，按 `entityKey` 复用：TaskHub(block) 与 PagesLibrary(page) 共用 Table/Board/Calendar/Quadrant/Gallery | 强重叠（普通 block 也能渲染成表/看板/日历） |

**额外领域事实（用户更正）：** (1) CoMind 中 **page 即 block**，仅 `blockId` 当前恒为空（既存不一致）；(2) 存在**两套正交 type 轴**——`Block.type`（`block.ts:8` = 结构/内容角色 `'bullet'|'property'|'query'|'embed'|'code'|'image'`）与 `Page.type`（`page.ts:6` = 页种 `'normal'|'ideas'|'book'`）。

**上爬本质需求（JTBD）：** CoMind 需要一层「捕获优先、跨切分类」的薄机制——贴标签即自动挂字段模板并聚合全库，且**不引入与现有属性/查询/视图平行的第三套子系统**。文章隐含的「需新建整套 Supertag 子系统」对 CoMind 不成立——是**扩展，不是发明**。

## Decision

| # | 决策点 | 裁定 |
|---|---|---|
| D1 | 标签载体 | 标签 = **page（即 block）**，经现有 `block→page` 的 `Link`（`relationshipType='tag'`）引用。**不新建存储原语，不放宽 Link**（`Link.targetPageId` 不变，仅增 relationshipType）。 |
| D2 | 标签识别 | 扩 `Page.type` union 加 `'tag'`（**页种轴**），照 ADR-0040 加 `'book'` 的同模式（4 处：page.ts / wasm/types.ts ×2 / 建厂）。不另起 `isTag` 属性，避免第二套分类轴撕裂单一判别器。与 `Block.type`（结构轴）正交。 |
| D3 | 字段模板存储 | tag-page 的 `template` 属性（`FieldDescriptor[]` JSON），**复用现有 FieldDescriptor 词汇**（零新类型）。O(1) 读取、单一数据源；编辑走结构化面板（复用 `FieldManagerPanel` / `PropertyEditor`）。 |
| D4 | 字段注入 | **派生，不物化**：`effectiveFields(block) = union(tagTemplates(incomingTagLinks(block)), block.ownProps)`；`tagTemplates = resolveInheritance(tagPage.template, parentTagPages)`。读取侧解析，改 tag 模板即时对所有节点生效（零传播写）。字段值 = 用户填写时作为普通属性落 `PropertyStore`。 |
| D5 | 聚合入口 | `resolveTagMembers(tagPageId)` 经链接查询得 `sourceBlockId` 集合 → 作为 `items` 喂现有 `evaluate(items, query, ...)`（`evaluate.ts:351` 本就吃实体集合）。**查询引擎零改**。标签落地页 = 打开 tag-page → 渲染其成员 block（无需扩展 savedFilter）。 |
| D6 | rollup（唯一真新增引擎能力） | 向查询引擎分组输出补 `count/sum/avg` 算子，纯函数、易测，对**所有分组视图通用**，不只服务于标签。 |
| D7 | 继承 | tag-page 间以 `relationshipType='extend'` link；有效模板 = 自身 ∪ 父（递归），读取侧派生。数据模型留槽，UI/传播逻辑 v2 再做。 |
| D8（必做 R1） | 页列表过滤 | tag-page 须从普通页列表/搜索（Sidebar `PageItem.vue:46` 的 `switch(page.type)`、PagesLibrary、页搜索）过滤；审计所有 `page.type` switch 的 default；配 tag 专属图标。 |
| D9（必做 R2） | 保留关系类型 | `'tag'`/`'extend'` 为**系统保留 relationshipType**，不进用户 `useRelationshipTypes` 注册表（否则与用户自建 'tag' 撞车、且错误出现在 typed-link 选择器）。创建关系时拦截保留名；tag/extend 链接仅由 `useTagStore` 程序化建。 |
| D10 | 类型统一前置 | `PropertyType` / `FieldType` 双类型模型统一到 `FieldType`（架构评审 C1 去债），模板字段类型与存储一致。 |
| D11 | 延期项 | 继承 UI、Related Content、Command 节点、AI 不在 v1；`block→block` 通用链接（ref-picker 类）独立 ADR，不绑进本设计。 |

## Consequences

- **零新存储种类**：复用 `PropertyStore` / `Link` / 查询引擎 / 通用视图（Table/Board/Calendar/Quadrant/Gallery）。
- 改动面收敛：① `Page.type` 4 处 + `createTagPage`（照 `book-import.ts`）；② `link.ts` 增 `relationshipType` `'tag'`/`'extend'`（R2 保留）；③ `useTagStore`（tagBlock/untagBlock/isTagPage/effectiveFields/resolveTagMembers）；④ `src/core/query/` 仅补 rollup 算子；⑤ `WikiLinkExtension`/`RelationshipMenu` 新增「打标签」入口；⑥ R1 页列表过滤。
- 测试面（locality 高，纯函数易覆盖）：`effectiveFields`、`resolveTagMembers`、rollup 均纯函数单测；回归现有 `evaluate`/`sortItems`/`groupItems` 单测 + `block→page` 链接行为 + `blockId` 空值状态不受影响。
- 与 ADR-0009（无头查询分层）、ADR-0022（引擎工厂实体无关）、ADR-0040（页种扩展先例）一致；UI 须守 ADR-0032 z-index + token 规范（BasePopover / `var(--z-*)` / design tokens）。

## 非目标

- 不新建第三套「标签/属性」存储原语。
- **不放宽 `Link` 到 `block→block`**（这是独立的大议题，ref-picker 类需求另开 ADR）。
- 不实现继承 UI / Related Content / Command 节点 / AI（v1 延期，见 D11）。
- 以下实现期边界裁定不在此 ADR 锁定：多标签同名字段冲突优先级（E1）、继承环防环（E2）、删标签级联清 link（E3）、`effectiveFields` 缓存（E4）、`template` 存 JSON 字符串（E6）、打标签输入 UX `#foo` 拦截 vs 命令 vs RelationshipMenu（E5）。
