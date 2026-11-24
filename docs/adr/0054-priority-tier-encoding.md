# ADR-0054: priority 四档定义统一与块行呈现（去底色 · 象限义 · 形状分档）

> **状态：accepted（2026-10-04）**。决策已锁定；验收阈值已量化；实施前需先跑一遍数据影响面核对。

## Context

块行内 priority 以整行 `.block-content` 底色呈现。该呈现存在四个独立缺陷。

### 缺陷一：分档责任错置 —— 展示位独自承担了全部编码职责

priority 在块上的两个位置分属**不同职责**，不构成重复：

| 位置 | 性质 | 职责 |
|---|---|---|
| 下方字段区（`BlockTagFields variant="list"`，`index.vue:638`） | **录入面** | ADR-0050 D1「挂载即显示」：渲染「字段名 + 值」或「字段名 + —」占位，每行 `role="button"` 点击唤起快速编辑器。形态是**属性表**，存在目的是引导填写|
| 整行底色（`.block.priority-* .block-content`，`_block.scss:491-509`） | **展示位** | 扫描级视觉信号 |

录入面与展示位各有独立职责，不适用 ADR-0050 D19 决策 1 的「单一权威展示位」不变量 ——
该不变量约束的是同一事实是否有两个**展示**权威源，而此处字段区是唯一**可写**入口。

真正的缺陷是职责边界：块行没有行内展示位（`tag.ts:73` 声明的 `right-of-content` 槽已被
ADR-0050 D19 决策 4 以「恒空」删除），导致**展示位仅剩底色一个**，而底色必须同时承担
「存在性」与「分档」两件事 —— 后者不该压在它身上（见缺陷二）。

附带效果：底色退场后，priority 的录入面仍在下方字段区、扫描级展示位由行内图标承担，
两者职责清晰分离。

### 缺陷二：分档编码压在单一不稳通道上

底色是块行上唯一的分档编码（展示位仅此一处，见缺陷一），强度量化如下（ΔE 为CIE76 色差，JND≈2.3；混合比取自 `_components.scss:63-65` 亮色 / `107-109` 暗色）：

| 判据 | 亮色（`--bg-base: #FFFFFF`） | 暗色（`--bg-base: #1A1A1E`） |
|---|---|---|
| Medium 底色 vs 基底 | **ΔE 4.00** / 对比度 **1.057** | ΔE 11.59 / 1.148 |
| High 底色 vs 基底 | ΔE 7.75 / 1.073 | ΔE 23.59 / 1.402 |
| Urgent 底色 vs 基底 | ΔE 12.45 / 1.241 | ΔE 26.00 / 1.242 |
| Low 底色 vs 基底 | **无底色（ΔE 0）** | 无底色 |
| 相邻档可分辨度 | Medium→High 10.57、High→Urgent 10.66 | 30.64 / 21.23 |
| 激活态叠加后衰减 | High −8.9%、Urgent −9.9% | Medium **−30.7%**、High −24.4%、Urgent **−34.8%** |

仓库内既有可辨门槛锚点：`--surface-subtle`（系统自己认定「这层底要能看出来」的弱底面板）相对 `--bg-base` 为亮色 **ΔE 3.52 / 对比度 1.091**、暗色 ΔE 7.79 / 1.214。

据此可确认三点：

1. **梯度分配与设计意图相反** —— 最不需要提醒的 Low 零信号、Medium 亮色勉强过阈，而最该被一眼看到的 Urgent 已超基准约 3.5 倍。
2. **「两级表达」在 Medium 档退化** —— `_block.scss:488` 注释称「强度由底色混合比 + 左侧色条两级表达」，但色条 `inset` 仅 High（2px）与 Urgent（3px）有，Medium 的色条宽度为 **0**，实际退化为纯底色一级，而那一级在亮色下不可见。
3. **叠加态吞信号** —— token 注释（`_components.scss:68-69`）声明「激活 block 的底色必须弱到不吞掉优先级底色」，实测暗色下叠加 `--block-active-bg` 后 Urgent 信号衰减 **34.8%**，与声明的意图直接背离。

### 缺陷三：四档存在两套互相矛盾的定义

| 值 | 象限语义（`tag.ts:77-79` description / `QuadrantView.vue:138-141`） | 排序（`useBlockQueryRegistry.ts:149` sortOrder） | 字段名字面暗示 |
|---|---|---|---|
| Urgent | 重要 **且** 紧急 | 1 | 高 |
| High | **不重要** 但紧急 | 2 | 高 |
| Medium | 重要 **但** 不紧急 | 3 | 中 |
| Low | 不重要 不紧急 | 4 | 低 |

`High`（高）的任务在象限语义下建议动作是「委托」，而 `Medium`（中）是「计划做」—— 排序与象限建议**恰好相反**。字段元数据的 description 站在象限一边，字段名的字面语义站在等级一边，两套读法共存。

### 缺陷四：行内图标属 Jira 旧图标同类

现状 `TASK_PRIORITY_ICONS` = ArrowDown / Minus / ArrowUp / AlertTriangle（`Icons/index.ts:12-17`，映射见 `Icon.vue:62-66`）。前三个属**横线族**，仅靠长度与方向微差分档；第四个跳到告警隐喻。该组合在多个入口生产使用：快捷编辑器priority 下拉（`FieldValueQuickEditor.vue:199`）、斜杠命令面板（`useSlashCommands.ts:267-304`）、TableView 彩色圆点（`useBlockQueryRegistry.ts:91-95`）、BoardView 卡片徽章。

### 业界对照（外部证据）

- **Jira 旧图标即本仓现状同类**。Atlassian 社区（Jira Priority Icons 反馈帖）：旧图标「difficult to differentiate from one another (namely Highest, High, and Medium), because they relied **solely on color**」；社区图标库 README：「The default priority icons in Jira are exactly **the same arrows of slightly different colour**.」Atlassian 已据此重设计，目标为「visually distinct at a glance **without relying on color**」且「clearly show an **ascending and descending sequence of urgency**」。重设计思路为形状化（如最高/最低加尾点、中间档用双头箭头）。
- **Todoist / TickTick**：四档映射艾森希ewell 矩阵，**同一形状配四色**，P4 为**无色**默认态；靠位置与排序分档而非形状。
- **Asana**：默认不给优先级上色（「most drop-down fields do not need any color」），颜色为少数场景的强调手段。

### 本质需求

> **priority 需要一个定义单一、且跨主题跨叠加态稳定成立的分档编码。**

现状两个方向都不稳：编码通道上，透明度随主题重算、被叠加态吃掉；定义上，等级义与象限义两套读法打架 —— 因此图标无论怎么画，总有一档读起来是错的。

反证检验：四象限视图用**位置**、表格用**排序**回答「有多急 / 有多重要」，都不依赖块行图标。故块行图标只需在**单看块行**时给出可辨的分档，不必承担全局排序职责；而底色承载的「整行色块」是图标替代不了的余光信号 —— 但它强度不可控（缺陷二），去底色不损失不可替代信息。

## 决策

### D1：四档定义（紧急为横轴、重要为纵轴）

`priority` 的语义为「重要 × 紧急」判断，**优先级顺序先按重要分档、重要者同级内再按紧急**：

| 档 | 语义 | 建议动作 | 标签 | 色 | 象限格位 |
|---|---|---|---|---|---|
| Urgent | 重要且紧急 | 立即做 | 立 | 红 | 右上 |
| High | 不重要但紧急 | 委托 | 委 | 橙 | 右下 |
| Medium | 重要不紧急 | 计划做 | 排 | 蓝 | 左上 |
| Low | 不重要不紧急 | 减少 | 减 | 灰 | 左下 |

**象限轴向**：**横轴 = 紧急（向右递增）、纵轴 = 重要（向上递增）**。
该轴向以 `QuadrantView` 的网格布局为准，块行图标与之**共用同一套读法** —— 同一字段禁止
两种轴向，否则用户在块行读到的格位与在象限视图看到的会相反。

`QuadrantView` 的格位由 `QUADRANTS` 数组顺序决定：`grid-template-columns: 1fr 1fr` +
先横后纵，展开为数组第 1 项 → 左上、第 2 项 → 右上、第 3 项 → 左下、第 4 项 → 右下。
故数组声明顺序须与块行图标的 `PRIORITY_QUADRANT` 一致 —— **改其一必须同步另一**。

**优先级顺序 = 重要优先**（与「纵轴=重要」同构）：`Urgent > Medium > High > Low`，
即先看重要的事，重要的事里再分紧急与否。

**落地约束**：`closedValues` 的四个裸值 `Low/Medium/High/Urgent` 已随 `systemFieldSeed.json` seed 落库（`field_definition.rs:172`），属**存量数据**。因此**四档的值不改、不迁移**，只改展示映射：

- `tag.ts` 的 `closedValues` 顺序与 `label`（取建议动作单字：立/委/排/减）；
- `useBlockQueryRegistry.ts` 的 `sortOrder`：`['Urgent', 'Medium', 'High', 'Low']`；
- `Icon.vue` 的 `PRIORITY_QUADRANT`（格位）与 `PRIORITY_DEFAULT_COLORS`（色）。

**色板不随轴向变动**：颜色是档位标识（红=Urgent / 橙=High / 蓝=Medium / 灰=Low），
轴向只决定图标点亮哪一格。

### D2：去掉块行底色，priority 的块行展示位由行内图标承担

- 删除 `.block.priority-* .block-content` 的 `background` 与 `inset` 左色条（`_block.scss:487-517`），及 `--priority-*-bg` 四个 token；
- **保留** `--priority-*-fg`（前景色，供图标着色），它是图标分档的辅助通道；
- 恢复 priority 的 `right-of-content` 行内渲染位（见 D4）⇒ 补上缺失的**扫描级展示位**；
- 删除后 `_block.scss:513-517` 的 Done/Canceled 让位规则中「清 background / 去 box-shadow」部分随之失效，仅 `status-done` / `status-canceled` 的删除线与文字弱化保留。

**职责边界（去底色后）**：下方字段区（`list` 变体）保持**唯一可写入口**不变，ADR-0050 D1「挂载即显示」的引导职责不受影响；行内图标只承担扫描级分档，**不承担录入**。两者不互斥，也不再需要裁定底色是否算「展示位」。

**副作用（待裁定）**：Done/Canceled 让位规则原本使「已完成的紧急任务」与「普通任务」视觉同形。去底色后该问题自动消失（本就无底色），但行内图标是否也需让位给终态，需单独裁定（见 Open Questions）。

### D3：图标按「象限方格」分档 —— 四档共用同一轮廓

判据：**四档必须在目标尺寸下可区分，而差异不得破坏家族相似性**。两条约束同时成立 ⇒ 四档轮廓必须完全相同，只允许在轮廓内部编码档位。

统一图元取 **2×2 象限方格**（艾森豪威尔矩阵本身）：四档共享四个完全相同的圆角方格轮廓，差别仅在**点亮哪一格** —— 点亮格实心填充，其余三格仅描边并降低不透明度。

| 档 | 语义 | 点亮格 | 颜色 |
|---|---|---|---|
| Urgent | 重要 **且** 紧急 | 右上 | 红 |
| Medium | 重要 **但** 不紧急 | 左上 | 蓝 |
| High | 紧急 **但** 不重要 | 右下 | 橙 |
| Low | 不重要 **且** 不紧急 | 左下 | 灰 |

**位置本身即语义**：四格位置固定不变（右上=重要+紧急、左上=重要、右下=紧急、左下=都不要），
读者无需记忆图例即可读出任意一档；且四档轮廓完全相同 ⇒ 家族感是严格的「同一图标，格子点亮位置不同」，
不存在风格参差。

**编码只用一个二值区分**：四格轮廓恒等，档位差异仅是「哪一格实心」这**单一位移**，
不需在 2×2 格内区分「实心/描边/细描边」等多重填充态。小尺寸下即使描边格糊成一体，
唯一的实心块仍以最高显著度给出位置读数；颜色（`--priority-*-fg`）作为辅助通道叠加在实心格上，
故形状通道不依赖颜色即可分档（D5#1 / D5#3）。

**与 status 图标并排不混淆**：priority 为方块阵列、status 为单个圆形轮廓 —— 形态差异明显（阵列 vs 单形）。
块行内两个行内位分工清晰：`status` 在 bullet 之后（`between-bullet-content`），
`priority` 在内容行尾（`right-of-content`）。

**实现要点**：Lucide 无此图元，需自绘 SVG（`Icon.vue` 现有映射表结构不变，仅换组件）。
几何以「外边界」为准分配四格 —— 24 单位 viewBox 中外边距 1、外格宽 10.5、外间隙 1；
描边居中对齐并按 `strokeWidth` 内缩 `sw/2`，保证实心格与描边格同尺寸、相邻格不被描边吞并。
未点亮格取 `stroke-opacity .45` 退居次要，实心格以 `currentColor` 承载颜色通道。

### D4：修订 ADR-0050 D19 决策 4（`right` 槽清理）

- D19 决策 1（单一展示位不变量）、2（chips 列存废是下游问题）、3（归属侧分类框架）、5（D17 替代解未采纳）**继续有效**；
- D19 决策 4 的「`right` 槽恒空清理」**由本 ADR 修订**：删除时 `right` 槽的前提（`right-of-content` 仅 priority 一个字段 ⇒ 删掉零行为变化）成立，但去底色后块行缺失扫描级展示位，priority 必须回到行内，槽位不再恒空；
- D19 决策 3 中「`list` 区独占无行内渲染位的其余」按上述职责边界重读：`list` 区是**录入面**，其内容不由行内渲染位决定，故 priority 留在其中不构成「双呈现」；
- **`list` 变体（录入面）保持渲染 priority 不变** —— 它是唯一可写入口，行内槽只承担展示不担
  录入，两者不互斥，**不适用 D19 的去重规则**（去重约束的是同一事实的两个**展示**源）；
- `icon-only` 样式口径已支持 `displayStyle === 'icon'`，恢复行内位无需新造样式。

### D5：验收阈值（保持 ADR-0054 前身结论，供实施回归）

形状通道与颜色通道须同时满足：

| # | 判据 | 阈值 |
|---|---|---|
| 1 | 相邻档在灰度下（去色后）可分辨 | ΔE ≥ 6 |
| 2 | 颜色相对 `--bg-base` 可辨 | ΔE ≥ 3.5（亮色）/ ≥ 7.8（暗色），即不低于 `--surface-subtle` 基准 |
| 3 | 分档编码的独立通道数 | ≥ 2（**位置** + 颜色） |
| 4 | 四档语义单调性 | 排序位与象限语义一致，排序不得与建议动作相反 |
| 5 | **家族相似性** | 四档轮廓完全相同，差异仅限轮廓内部 |

阈值 1 的必要性由 Jira 旧图标教训给出：四档若仅靠颜色区分，色觉障碍用户与低分辨率屏下会并档。阈值 2 沿用本仓库 `--surface-subtle` 自认基准，不自造标准。阈值 5 是本 ADR 追加的约束 —— 「统一风格」与「可区分」在图标设计中互相拉扯（填充度方案即典型反例：同外框但小尺寸并档），须同时验证而非二选一。

阈值 1 的必要性由 Jira 旧图标教训给出：四档若仅靠颜色区分，色觉障碍用户与低分辨率屏下会并档。阈值 2 沿用本仓库 `--surface-subtle` 自认基准，不自造标准。

### D6：块行展示位的分档强度 —— 栅格不变，强度只由点亮格承载（2026-10-06 追加）

**背景**：新建任务默认 `priority=Low`（`systemFieldSeed.json` 的 `defaultValue`）落地后，行尾图标从
「偶发信号」变成「每行常驻」，视觉层级需要下调。

**原则**：D5#1 要求相邻档在灰度下可辨，而档位读数完全依赖「点亮格在 2×2 栅格中的位置」——
**栅格（三个未点亮格）是读位置所必需的参照系**。故**栅格强度必须保持不变**，降层级只能作用在
**点亮格的墨色**上。若连同栅格一起调淡，实心块会失去参照系，反而跌破 D5#1。

**行尾槽（`BlockTagFields variant="right"`）取值**：

| 项 | 取值 |
|---|---|
| 尺寸 | 20 → **14**（见下「尺寸下限」） |
| 栅格（未点亮格） | `stroke-opacity .45` **不变** |
| 整体不透明度 | `.85`（非 hover）；hover 恢复 `1` |
| 点亮格墨色 | Medium / High / Urgent 保持 `--priority-*-fg`；**Low 压到 `.4`**（默认档是背景态，不是信号） |
| hover | **取消 `scale(1.15)` 放大**，改为恢复不透明度 —— hover 澄清而非膨胀 |

即**强度 ∝ 紧急度**，与 D2 引用的业界倾向一致（Todoist / TickTick 的 P4 为无色默认态、Asana 默认不上色）。

**尺寸下限（回应 Open Question）**：`BlockTagFields` 旧注释称「16px 粘连、20px 是清晰可辨的下限」，
该实测对象是**本 ADR 已否决的十字轴图元**，对现用的 2×2 方格不成立。行尾槽因此取 14，
判据以 D5#1（灰度下位置可辨）为准 —— 而栅格保持不变正是该判据成立的前提。

**不改 D5#2 阈值口径**：`--priority-*-fg` 相对 `--bg-base` 的 ΔE 约 30–40；即使整体降到不透明度 0.35，
Effective 色对 `--bg-base` 的 ΔE 仍约 11（亮）/ 21（暗），远高于 D5#2 的 3.5 / 7.8
⇒ 降层级**不触发**阈值例外，无需为此修订判据。

**作用域仅限块行展示位**：`Icon.vue` 的 `PRIORITY_DEFAULT_COLORS` 不动 —— 斜杠命令面板 / 快捷字段值编辑器 /
TableView / BoardView 的档位着色维持满强度（那些入口需要四档一眼可辨）。
`PriorityQuadrant` 新增 `pq-lit` / `pq-frame` 两个类名作为消费方定位锚点（**仅类名，不改几何**）。

## 已否决替代方案

- **十字轴 + 单格实心**：像素预算最省（2 条线 + 1 个点），但轴线本身不携带分档信息（纯装饰），
  且与 status 的圆形轮廓构成「线 vs 线」的弱对比；改用 2×2 方格后轮廓本身即矩阵、实心格的位移即档位。
- **只调底色参数、不引入第二通道**：四档仍全压在一个不稳通道上，D5#3（通道数）与 D5#1（灰度可辨）不达标 —— 治标不治本。
- **同外框 + 只变填充度**（实心 / 半实 / 描边 / 细描边）：家族感强，但实测 8px 下四档并档 —— 填充度是连续量，小尺寸必被压缩，且「半实」（外框内套一个内点）视觉上像外框损坏而非有意设计的第四级。已否决。
- **四档用四种不同几何形状**（实心三角 / 半实圆 / 空心方 / 空心圆）：可分档最强，但四档分属三个图形家族、风格参差，不满足阈值 5「统一风格」。已否决。
- **底色只服务 Urgent 一档**：Urgent 亮色 ΔE 12.45 已远超基准，扫描信号最强的一档保住了；但 Medium/High 的分档仍无载体，且四象限语义下 Medium（重要不紧急）恰恰是「计划做」的主要对象，不该无信号。
- **按重复次数分档（1/2/3/4 道斜杠）**：分档可靠（数数比看深浅更准），但家族感弱于「同一网格点亮不同格」—— 网格方案的位置本身携带象限语义，斜杠方案不携带；且 16px 下 4 道已糊成噪点。
- **以等级义（Low < Medium < High < Urgent）为准、弃用象限语义**：需改 `QuadrantView` 的象限标题与建议动作，且与 Todoist / TickTick 的既有模型相反；`tag.ts` 的 description 已站在象限一边，改动面更大。否决。
- **拆分「急」与「重要」为两个字段**：语义最干净，但需新增系统字段 + 存量数据迁移，且 `priority` 属 ADR-0049 承重系统字段（`is_system=1`，代码硬依赖），代价远超收益。
- **用左侧色条的形状/图元分档**：ADR-0050 D19 决策 4 清理 `right` 槽正是为消除「隐式行内优先级渲染位」的误导；再造一条仅靠像素宽度区分的通道会重新引入同类隐式约定。

## 实施影响面（待核对）

| 触点 | 说明 |
|---|---|
| `src/styles/components/_block.scss:487-517` | 删底色与色条规则；`status-done/canceled` 保留删除线部分 |
| `src/styles/tokens/_components.scss:62-65, 106-109` | 删 `--priority-*-bg` 四个 token；保留 `--priority-*-fg` |
| `src/components/Icons/Icon.vue:62-66` | `PRIORITY_ICONS` 换字形（影响快捷编辑器、斜杠面板、TableView、BoardView） |
| `src/types/tag.ts:76-80` | `label` 与象限读法对齐 |
| `src/composables/useBlockQueryRegistry.ts:91-95, 149` | `PRIORITY_COLORS` 色值对调（Medium↔High 归象限）、`sortOrder` 改序 |
| `src/components/Block/BlockTagFields.vue:302-316` | `fields` 排除口径**不变**（`list` 区继续渲染 priority 作录入面）；仅需确认 `right` 分支能复用既有 `icon-only` 样式 |
| `src/components/Block/index.vue` / `Backlinks.vue` | 恢复 `right` 变体容器 |
| `src/composables/useBlockFieldValueSync.ts:60-63` | `priorityClass` 改由图标驱动，`_block.scss` 类名不再承载底色 |
| `src/components/views/QuadrantView.vue:136-142` | 象限色值与新的 fg 色板对齐 |
| `src/components/Ideas/IdeasSnapshotNode.vue:45-56` | 快照节点同步去掉 priorityClass |

**无数据迁移**：`closedValues` 四值不动，仅展示映射变。

## 待决 / Open Questions

- 行内图标在Done / Canceled 终态下是否让位（现状底色的让位规则随去底色一并失效，图标是否需要新规则未定）。
- 图标在折叠态、窄行、无 status 任务块上的最小尺寸与是否退化为单色。（行尾槽部分由 D6 定于 14，
  且不退化单色；其余场景仍待定。）
- D5 阈值尚未固化为单测，需落成可回归的断言（颜色按 `tag-color` 既有双向比对范式，形状需新增拓扑快照测试）。

## 关联

- ADR-0050 D19（块上字段值单一展示位—— 不变量继续有效；本 ADR 修订其决策 4 的 `right` 槽清理，并厘清 D19 不变量与「录入面」不属同一范畴）
- ADR-0027（TableView 由彩色徽章改为带色下拉，priority 配色上提为字段元数据）
- ADR-0028（BoardView 卡片徽章由 `config.cardFields` 通用派生）
- ADR-0049（priority 为系统承重字段，`is_system=1`，字段 seed 与 Rust 共享）
- ADR-0012（token 治理：删`--priority-*-bg` 后前景色 token 的单源要求）