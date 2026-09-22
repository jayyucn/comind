# ADR-0050: Tag 本位字段交互与 Tag 聚合页

> **状态：D1–D10 已定稿；阶段 1（D1 / D5 / D7 / D10 + chip 点击导航）已实施（`b955b79`），阶段 2（D2 / D4）与阶段 3（D8）待实施**。上游决议见 ADR-0049「方向决议：tag 本位，属性概念退役」段与 CONTEXT.md 词条 **Tag / Tag Field / Property (RETIRING)**。

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
| 统计卡 成员(count) / 工时合计(sum) / 平均工时(avg) | **口径：自动出全**——成员数(count)恒显；数值字段自动出 sum+avg 卡（如工时），非数值字段（select/date）不出统计卡，零配置。对过滤后卡片客户端求值（单 tag 块数量级小）；数值字段 = TagFieldDefinition type == number |  |
| 工具栏 筛选 / 分组 / 排序 / 显示字段 | QueryToolbar 既有 scope（「显示字段」= per-tab 列显示，TaskHub 字段管理同款） | ✅ 复用 |
| 表格列：内容 | `content_preview` | ✅ |
| 表格列：**来源页** | `BlockCard.page_id` 已有；页标题经 TS pages store 映射；点击跳源页面 | ✅ 阶段 1 已补（唯一轻量数据缺口，只读列） |
| 表格列：状态(chip) / 截止 / 工时 | `properties` / `date_refs` + 字段类型渲染 | ✅ TableView 已有 |
| 数据过滤「tags 含此 tag」 | 投影需有 tags 数据源：`BlockCard.tags: Vec<String>` 已加（`280b2b8`，D4 TaskHub 过滤切换同样依赖，一处扩展两处受益） | ✅ |

视图配置（筛选/分组/排序/显示字段）按 tag 维度持久化，沿用 TaskHub per-tab 配置先例。

阶段 1 实施形态：字段注册表按该 tag 的**有效字段**（Rust 解析结果）动态构造且限定在聚合页内（不并入任务中心注册表）；视图配置命名空间取 `tag:<tagId>`，与任务列表互不争抢；列模板在有效字段就绪前不回落到持久化配置，避免把未解析完的列集写库。

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

## 开放问题

- `TagFieldDefinition` / `TagFieldValue` 表名是否随 Rust 类型同步改（含 serde rename 对已同步设备 payload 的兼容评估）。
