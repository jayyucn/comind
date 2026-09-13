# ADR-0045: 折叠语义 —— 单一权威 + 「无子节点 ⇒ 不折叠」不变量

- Status: accepted（口径 2026-09-14 锚定；实现手段同日经 grilling 裁定，见 Decision 追加）
- Date: 2026-09-14
- Supersedes: —
- Related: ADR-0039（bullet-chevron 承担折叠/展开）、ADR-0035（跨块文本选区的几何层）、ADR-0025 D8/D10（复制完整子树、无视 collapsed 的既有口径）、ADR-0032（浮层与堆叠上下文）

## Context

2026-09-14 对「折叠态 × 操作」做了一轮 grill-up 审计（只读考古，未改代码）。结论：**折叠的「隐藏」没有任何单一权威，三份真相互不相通，且没有任何消费者被强制从唯一来源派生**，于是每个操作各错各的。

### 三份真相

| # | 真相 | 在哪 | 谁在读 |
|---|---|---|---|
| ① | 持久化 `format.collapsed` | `useBlockCollapse.ts:20,30` → `blocks.ts:1349 updateBlockFormat` → Rust `Block.format: String`（**跨重载存活**） | 仅 store 与 `useBlockCollapse.calcAllChildrenHeight` |
| ② | DOM class | `Block/index.vue:165` 输出 `.is-collapsed`（**无人读**）；拖拽读的是**另一个** class `.block-bullet.collapsed`（`useBlockDragDrop.ts:407/566/578`） | 仅拖拽；且读法与 ② 不同源 |
| ③ | 布局后果 | `_block.scss:210-215` 的 `.is-collapsed { max-height: 0; overflow: hidden }` —— **只裁剪、不移除布局** | 几何层（`selection-geometry.ts` / TOC / `scrollIntoView`）**读不到任何折叠标记** |

### 前提核查（载体里的断言 vs 代码现状）

| 断言 | 核查结果 | 证据 |
|---|---|---|
| 「折叠后删除会保留折叠状态」 | **成立**，但触发条件比表述窄：仅当该次删除会让**该页顶层块归零**时命中 store 闸门 | `blocks.ts:1243-1263`（保留文档序最后一块）+ `:1277-1280`（只 `updateBlockContent(id, '')`，**不碰 `format`**） |
| 「删除保留了部分内容」 | **不成立**：被保留块的内容被清空，残留的是**空块**；「剩余内容」属 Ctrl+X 的正常行为 | 同上；`BlockList.vue:247-273`（逐字复制品，`keptId` + 清内容 + `activateBlock`） |
| 「折叠态拖拽选择时隐藏子节点的高亮还在」 | **成立** | `selection-geometry.ts:151-154` 枚举全部 `[data-block-id]`，无折叠过滤；`Range.getClientRects()` 不受 overflow 裁剪；overlay Teleport 到 body（`BlockList.vue:582`） |
| 既有 issue 是否已跟踪 | **无**（`gh issue list --search 折叠/collapsed` 零命中） | — |
| 静态推理的 5 条同类破缺（方向键落隐藏块、Tab 缩进/nest 进折叠块、Backspace 合并目标为折叠块、Del 键同闸门） | **用户确认为真**（2026-09-14：「静态推理的内容基本属实」） | 7 条清单落在 issue **#101** |

### 本质需求

> **折叠的「隐藏」必须由一个权威表达，并对所有消费者（数据变更 / 几何 / 导航 / 命中）一致生效。**

**阶梯**：加个「删除时重置 collapsed」的补丁 → 为什么？→ 因为残留折叠态会让新子节点默认不可见 → 为什么这算坏？→ 因为「折叠」在撒谎：它声称有被隐藏的东西，实际没有 → 为什么不能容忍它撒谎？→ 因为每个消费者都各自决定信不信它，于是同类 bug 会源源不断 → **本质：隐藏只能有一个真相，且消费者必须从它派生。**

**反证**：改 `display: none` 能修幽灵高亮；给 store 加不变量能修 stale 残留；让导航读 `.is-collapsed` 能修光标进隐藏块 —— 三条**手段**都能满足同一目标，说明目标提炼正确，而非钉死某一手段。

## Decision

### ① 唯一权威：`format.collapsed`（持久化），DOM class 与几何判定都必须由它派生

- 禁止新增第四份「折叠真相」。任何判定「这个块是否隐藏」的代码，必须落到同一来源。
- 拖拽侧现读 `.block-bullet.collapsed`（②的变体）属漂移：读 DOM class 本身可接受（同一 DOM 内必然一致），但**不得**演化成独立语义（例如拖拽认为"展开"而 store 认为"折叠"）。

### ② 不变量：无子节点 ⇒ 不折叠

- 块一旦没有子节点，`format.collapsed` 必须为 `false`。
- 对账点在「某块的子节点集合发生变更」的收口处，而非散落在各操作：`deleteBlocks` 闸门清空（`blocks.ts:1277-1280`）、`mergeBlockInto` 子树转移（`:987-1011`）、拖拽 `syncTreeToStore`、粘贴森林插入、`indent`/`outdent`。
- 读取侧兜底：折叠是否生效 = `format.collapsed && 有子节点`。这条兜底同时让历史遗留的 stale 数据（用户库中已存在的残留）无需迁移即自愈。
- 理由：stale 态当前**不可见也不可修** —— chevron 渲染条件是 `v-if="node.children.length > 0"`（`Block/index.vue:513`），`toggleCollapse` 自带 `children.length === 0 → return` 守卫（`useBlockCollapse.ts:25`）。用户既看不到折叠指示、也没有展开入口，直到新建子节点时才被"默认折叠"绊一下。

### ③ 几何消费者必须显式回答「隐藏子树算不算」

`selection-geometry.ts` 目前无任何折叠判定，导致：
- 文本选区跨过折叠父块时，隐藏后代照画高亮（幽灵高亮，已复现）；
- TOC / `scrollIntoView` 会把坐标算到不可见处。

本 ADR 只裁定「必须有一个显式口径」，具体**是"几何层过滤折叠祖先"还是"折叠改为移除布局"**属实现手段，留待 Open questions。

### ④ 已成立、不再改动的既有口径（明确记录，防回改）

- **复制/剪切无视 `collapsed`，取完整子树**：`block-clipboard.ts:22`，ADR-0025 D8/D10。故「选区含隐藏块」在数据侧是**有意**的。
- **Ctrl+A 与拖拽扩展选区把隐藏块纳入 `anchorIds`**：`useCrossBlockSelection.ts:226-236`、`:126-181`。语义侧含隐藏子树、视觉侧不含（高亮被 `hasSelectedAncestor` 抑制 / 被裁剪），这是**有意差异**，不得当成 bug 顺手"修平"。
- **Enter 拆分不进折叠块**：`insertBlockAtCursor` 的 `hasExpandedChildren`（`blocks.ts:680-692`）已在处理，属正常。
- **粘贴以锚点块的 `parentId` 落兄弟位**：`blocks.ts:1372-1389`，可见，属正常。

## Decision 追加（grilling 2026-09-14 裁定，全部按推荐锁定）

| # | 决策点 | 裁定 |
|---|---|---|
| D1 | 折叠的隐藏手段 | **改为布局移除**：`.is-collapsed:not(.is-animating)` → `display: none`。动画期沿用现有 `isAnimating`(300ms = `$transition-collapse`) 兜时序（折叠：过渡跑完再 display:none；展开：`is-collapsed` 先摘除故 display 自然恢复，过渡照跑）。所有几何消费者零改动即自动一致 —— 没布局就等于不可见。 |
| D2 | 不变量的对账点 | **读取侧兜底为唯一判定**（`format.collapsed && 有子节点`）+ **写入侧只在闸门清空处补一次复位**。因为无单一收口（`parentId` 写点 ≥4 处在 store、拖拽/BlockModal 走 `useBlockTree.syncTreeToStore`、粘贴另建块），写入侧全面收口=改 6+ 处且新增路径必漏（正是本 bug 的成因模式）。存量 stale 数据**免迁移**。 |
| D3 | 方向键落点 | **方向键用折叠感知遍历**，落点只能是可见块。理由：折叠是用户的视图意图，导航不得偷偷改它（故否决"激活时自动展开祖先"，也否决"禁止进入折叠子树"——后者会让键盘连走断掉）。`useCrossBlockSelection` 的选区**成员资格**不在此列，维持含隐藏块（见 ④）。 |
| D4 | 结构变更落入折叠块 | **自动展开父块**：Tab 缩进 / 拖拽 nest / Backspace 合并落进折叠父块时，顺手 `collapsed=false`。与 ADR-0039「落点 = 可见结果」一致；否决"允许隐藏（现状）"与"拒绝落入"。 |
| D5 | TOC / Backlinks | **不尊重折叠**：二者是文档导航与引用索引，列的是"文档里有什么"而非"此刻屏幕上显示什么"。不补判定。 |
| D9 | 交付 | 一次落完 D1–D5 + 回归网，跑 `vue-tsc` 与受影响套件，留 PR 供评审。 |

**推论（随 D1 自动成立，不另立决策）**：`display: none` 后拖拽**不必**再读折叠标志 —— `readChildContainer` 拿到的容器本来就没有可见子块。但本期**未改动**拖拽的读取方式（仍读 `.block-bullet.collapsed`）：它与渲染读的是同一份 DOM 真相，不构成第四份。`useBlockCollapse.calcAllChildrenHeight` 的临时 `max-height: none` 量高只作用于未折叠子块，实测未受影响。

### 真机验证（2026-09-14，tauri-mcp，临时页 `__collapse-verify-20260914`，验完已永久删除）

| 项 | 结果 |
|---|---|
| D1 折叠 = 布局移除 | 折叠 → `.block-children is-collapsed` + `display:none`（高 0）；展开 → `has-children` + `display:block`（高 78px） |
| **#1 stale 残留（用户报的症状）** | 折叠父块（flag=true）→ 删光其全部子节点 → **`format.collapsed` 自动复位 `false`**；再建子节点 → 容器 `display:block`、新块高 37px → **症状消失** |
| **#2 幽灵高亮（用户报的症状）** | 文本选区跨过折叠块（anchor/head 落在上下两块）→ 高亮只画 3 条矩形 = 恰好 3 个可见行；隐藏子节点盒为 **0×0**（布局中已不存在）→ 失去成因 |
| D4 落入折叠块 | 对折叠父块执行 `indent` → 父块 `collapsed→false`、子块可见（高 37px） |
| D3 方向键落点 | **未真机验证**：`press_key` 不冒泡到 document、合成按键也不触发原生编辑行为（TipTap 路径）→ 只在单测层验证 |
| 拖拽 nest | 仅单测（`syncTreeToStore` 的 `affected` 累加器 3 例）+ 类型检查，未真机拖拽 |

### 真机发现的第 4 条决策（原实现有硬伤，已修）

`useBlockCollapse` 里的 `collapsedFlag` 原本是**挂载时从 store 拷出的本地 ref**，只单向同步（本地 → store）。真机实测：把 `format.collapsed` 写进 store 后，容器类名与 `display` **纹丝不动** —— 即 D2/D4 的写入侧复位**到不了屏幕**，用户的症状根本不会被修掉。改为 `computed({ get: 读 block.format.collapsed, set: 写 updateBlockFormat })` 直连权威，同时消掉这份第二真相。**该结论并入 ①**：读取也必须直连权威，禁止本地副本。

## Open questions（遗留）

1. `display: none` 对 `calcAllChildrenHeight` / 折叠动画首帧的影响需实测（D1 的推论，实现期自查，非决策）。
2. TOC / Backlinks 的平铺口径已裁定（D5），若未来引入"折叠态 TOC"，须回来修订本条。

## Consequences

- 修 bug 从"逐个操作打补丁"收敛为"一个不变量 + 一个权威"。
- 代价：`format.collapsed` 从"纯视图标志"升格为**有不变量的受管状态**，任何新增的子树结构变更路径都必须考虑对账（新增路径要遵守 ②）。
- 用户库中既存的 stale 残留（0 子节点 + `collapsed=true`）**不需要数据迁移**：读取侧兜底即自愈。
