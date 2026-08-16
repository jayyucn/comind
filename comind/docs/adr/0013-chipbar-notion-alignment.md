# ADR-0013: 芯片栏对齐 Notion —— 移除常驻且/或、聚合 chip、排序聚合、高级筛选改 Popover

- 状态：已采纳（Accepted）
- 日期：2026-08-16
- 范围：页面库（`PagesLibrary`）芯片行（`FilterChipBar`）及高级筛选面板的**形态与触发**——纯交互层调整，不改无头查询引擎（`src/core/query`）类型。本 ADR 是 ADR-0009 的**修订件**，明确取代其中 D4、D5、D6、D9 的部分结论。
- 关联代码：
  - `src/components/query/FilterChipBar.vue`（移除 `FilterCombinatorToggle`；聚合 chip 触发逻辑）
  - `src/components/query/FilterCombinatorToggle.vue`（**移除**，逻辑移入 popover 面板内）
  - `src/components/query/FilterBuilder.vue`（由大面板降级为 popover 内容；删除排序/分组区域）
  - `src/components/query/SortChip.vue` / `GroupChip.vue`（**移除**独立排序 chip 与 `+ Sort`/`+ Group`）
  - `src/components/query/FieldSelectMenu.vue`（底部 "Add advanced filter" 作为 popover 第二触发点）
  - `src/core/query/operators.ts`（多 select 标签、日期 `is within`）
- 来源：用户在 `app.notion.com` 真实界面截图的现场观察（4 张截图 + 多轮 `/grilling` 对齐）。

---

## 背景 / 问题陈述

ADR-0009 落地后，页面库芯片栏已基本是 Notion 风格，但用户在 app.notion.com 实际对照发现三处保真度偏差（截图铁证）：

1. **常驻且/或开关偏离 Notion**：ADR-0009 D4 在芯片行最左侧放了一个常驻 `全部满足/任一满足` 切换（`FilterCombinatorToggle`）。Notion 实际**没有**这个常驻开关——And/Or 逻辑藏在「N rule(s) ▾」聚合 chip 内部的面板里。
2. **排序 chip 未聚合**：ADR-0009 D5 让每个排序键渲染一个独立 chip（`↑ 标题`、`↑ 类型`）。Notion 永远把排序折叠成单个 `↓ N sorts ▾` 聚合 chip，不展开成单芯片。
3. **芯片栏冗余入口与重面板**：ADR-0009 D9 的高级筛选是「页面库下方的可折叠大面板」（含筛选/排序/分组三区块，最高 ~400px）。Notion 的高级筛选是**从聚合 chip 弹出的 Popover**（仅筛选条件），且芯片栏内没有 `+ Sort`/`+ Group`（与 QueryToolbar 已有按钮重复）。

用户现场观察的 Notion 芯片栏状态机：

| 状态 | 芯片栏内容 |
|------|-----------|
| 空 | `[+ Filter]`（仅此） |
| 简单筛选（扁平） | `[属性▾] [属性▾] … [+ Filter]`（逐个属性芯片） |
| 纯嵌套/高级（无扁平条件） | `[≡ N rule(s) ▾] [+ Filter]` |
| **混合（扁平 + 嵌套）** | **`[属性▾] [属性▾] … [≡ N rule(s) ▾] [+ Filter]`**（高级 chip 始终在扁平 chip 左侧） |
| 含排序 | `[↓ N sorts ▾] [+ Filter]`（排序永远折叠） |
| 筛选 + 排序 | `[↓ N sorts ▾] [属性▾] … [≡ N rule(s) ▾] [+ Filter]` |

**整体从左到右顺序（sorts | group | filters | +Filter）**：

`[↓ N sorts ▾] [分组：字段 ▾] [≡ N rule(s) ▾] [属性▾] … [+ Filter]`

- 排序 chip 永远最左；分组 chip（激活时）次之；筛选区内部：高级聚合 chip 在扁平 chip 左侧，扁平 chip 按创建顺序从左到右；`+ Filter` 收尾。
- 分组从「芯片栏上方独立指示」改为**芯片栏内聚合 chip**（点开经 `GroupMenu` 编辑；选「不分组」即取消分组）。 |

---

## 决策 1（D1，修订 D4/F1）：移除芯片栏常驻且/或开关

删除 `FilterChipBar` 条左侧的 `FilterCombinatorToggle`（`全部满足/任一满足`）。**空态芯片栏只剩 `+ Filter`**。And/Or 逻辑不再在栏上可见，根组默认 `combinator: 'and'`。

- 文件处置：`FilterCombinatorToggle.vue` 移除或降为内部子组件（仅供 popover 面板内复用），不再出现在芯片栏。

## 决策 2（D2，修订 D6/F2）：嵌套/高级条件折叠为聚合 chip，扁平条件保持独立 chip

**核心原则：扁平条件（`Condition`）始终以独立 chip 展示在芯片栏；只有无法用单芯片表达的嵌套子组（`ConditionGroup`）才聚合成 `≡ N rule(s) ▾` chip。两者共存于同一芯片栏。**

- 纯扁平条件 → 逐条独立 chip（不变）
- 含嵌套子组 → 嵌套部分聚合成 `≡ N rule(s) ▾`（标签仅计嵌套组内条件数），**扁平条件仍以独立 chip 并列显示**
- 点击聚合 chip → 打开 popover 面板（D5）**只编辑嵌套子组本身**（扁平条件不入面板、也不作为子节点存在于该嵌套组内，面板因此能区分"高级规则"与"普通 flat chip"）

## 决策 3（D3，修订 D5/F3）：排序 chip 聚合

**删除**独立排序 chip（`SortChip.vue` 多键并列形态）。排序键在芯片栏统一折叠为单个 `↓ N sorts ▾` 聚合 chip，点开编辑/删除/添加排序条件。排序的添加入口仅保留 QueryToolbar 排序按钮 + 聚合 chip 内编辑。

## 决策 4（D4，F4）：移除芯片栏内 `+ Sort` / `+ Group`，分组改为栏内聚合 chip

芯片栏内不再渲染 `+ Sort` 和 `+ Group` 按钮——QueryToolbar 上方已有常驻的排序/分组按钮，属重复入口。分组不再以「芯片栏上方独立指示」呈现，而是**激活时作为芯片栏内的聚合 chip**（标签 `分组：字段 ▾`），位于排序 chip 之后、筛选 chip 之前（见上方状态表整体顺序）；点开经 `GroupMenu` 编辑，选「不分组」即取消分组。`FilterChipBar` 直接从 `modelValue.groupBy` 派生该 chip，父组件 `PagesLibrary` 不再单独渲染分组指示。

## 决策 5（D5，修订 D9/F6+F7）：高级筛选 = Popover，且只含筛选

`FilterBuilder` 从「页面库下方可折叠大面板」降级为**聚合 chip 弹出的 Popover**：

- **两个触发点**：(a) `≡ N rule(s) ▾` 聚合 chip（带已有规则）；(b) `+ Filter` 菜单底部的 "Add advanced filter"（从空开始）。
- **内容 = 仅筛选条件**：删除 `FilterBuilder` 内的「排序」与「分组」两个区域（它们已有独立入口：聚合 chip / QueryToolbar 按钮）。
- **形态**：从 chip 锚定的小 Popover（Teleport + overlay + 点外部关闭），非全宽面板。
- **内部 And/Or 改为下拉选择器**（非双按钮 toggle），位置在每组级（与 Notion 截图一致）；根组默认 `and`。

## 决策 6（D6，Q2）：多 select 操作符标签改 Notion 措辞

`operators.ts` 中多 select 的 UI 标签由 `hasAny / hasAll` 改为 `contains / does not contain`（中文「包含 / 不包含」）。**仅改 UI 标签，引擎 `FilterOp` 枚举不改名**（避免牵动序列化/求值/测试）。`hasAll` 仅在高级面板内作为额外选项保留。

## 决策 7（D7，Q6）：补日期操作符 `is within`

`operators.ts` 日期类型补充 `is within`（本周内/本月内等范围）。文本类型 `starts with / ends with` 本轮**不做**（暂保持 is/isNot/contains/…）。

## 决策 8（D8，Q7/Q8 确认）：保留项

- 属性芯片**保留完整摘要**（属性 + 操作符 + 值），不对齐 Notion「只显示属性名」——comind 芯片行横向空间充足，摘要信息密度更高。
- 面板内嵌套用背景色区分（非 Notion 缩进），`Where` 前缀不加（Notion 特有措辞偏好）。

---

## 未采纳 / 本期不做（明确 defer）

- **彩色属性 token（Q1）**：属性名/值按属性类型着色——本期不实现（纯展示层，独立小任务）。
- **多 select 值渲染彩色药丸（Q3）**：已选标签渲染为多枚彩色小药丸——随 Q1 一起 defer。
- **持久化 / 命名视图 / URL 同步（Q5）**：引擎已存 WASM，但芯片栏无保存/命名/分享入口——独立迭代。
- **其他体验优化**：用户明确「暂不考虑」，留待后续。

## 被本 ADR 取代的 ADR-0009 决策

- D4（顶层 AND/OR 用 all/any 常驻切换）→ 改为 D1（移除常驻，收进 popover）。
- D5（排序/分组与筛选同处一条芯片行、各自展开 chip）→ 改为 D3（排序聚合）、D4（删 `+ Sort`/`+ Group`）；分组移出芯片行。
- D6（扁平镜像 + 嵌套聚合）→ 措辞对齐 Notion `N rule(s)`，行为实质一致（D2）。
- D9（高级面板经 "Add advanced filter" 进入，可折叠大面板含三区块）→ 改为 D5（popover，仅筛选条件）。

---

## 后续行动

1. `FilterChipBar`：移除 `FilterCombinatorToggle` 渲染；加 `N rule(s) ▾` 聚合 chip（扁平→折叠切换）；`N sorts ▾` 聚合 chip 渲染。
2. 删除 `SortChip.vue` 独立形态与芯片栏内 `+ Sort`/`+ Group`（或保留组件但不再在栏内渲染）。
3. `FilterBuilder`：改 popover 形态；删除排序/分组区域；组内 And/Or 改下拉。
4. `FieldSelectMenu`：底部 "Add advanced filter" 触发 popover（第二触发点）。
5. `operators.ts`：多 select 标签 contains/doesNotContain；日期补 isWithin。
6. 补/改 `FilterChipBar` 单测覆盖新形态（含空态只 `+ Filter`、聚合 chip 折叠）。
