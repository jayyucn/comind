# ADR-0025: Block 复制粘贴 —— 引入"粘贴为 block"全链路与内部剪贴板格式

- 状态：已采纳（Accepted）
- 日期：2026-08-24
- 范围：
  - `src/components/BlockList.vue`（现有 `Ctrl/Cmd+C` 复制处理器；新增 `Ctrl/Cmd+V` block 粘贴处理器）
  - `src/composables/useCrossBlockSelection.ts`（`copyToClipboard` 改为产出结构化载荷，修复全页扫描与折叠不一致）
  - `src/services/serialize-block-tree.ts`（复用其树序列化能力承载内部剪贴板 JSON）
  - `src/stores/property.ts`（`setProperty` 跨页落地 properties）
  - `src/types/block.ts`（`Block` 数据模型，定义复制语义）
  - 新增内部 MIME 类型 `application/x-comind-block`
- 关联代码：`src/components/Block/index.vue`（现有 image paste 钩子保留，不受影响）、`src/stores/blocks.ts`（`createBlock` / `moveBlock`）、`src/stores/property.ts`
- 来源：用户「block 复制粘贴行为优化」+ `/grill-with-docs` 设计决策（4 轮确认：目标=打通粘贴为 block；范围=同页/跨页/子树，(c) 外部拆 block 推迟；载荷=content/type/format/properties/children；传输=自定义 MIME+text/plain 兜底；ID=一律重生成+仅重映射内部自引用；落点=上下文感知；层级=由 payload 显式决定；纯文本=Ctrl/Cmd+Shift+V；折叠修正；跨页 properties 新建行；外部兜底=单 block；分发=BlockList 层拦截）

---

## 背景 / 问题陈述

现状的 block 复制粘贴存在**结构性不对称**（2026-08-24 代码核查）：

1. **能复制、却粘不回来**：`copyToClipboard`（`useCrossBlockSelection.ts:142-185`）只把选中块的 `content` + 2 空格缩进拼成纯文本写入 OS 剪贴板；全代码库**没有任何 block 级 `Ctrl/Cmd+V` 处理器**。唯一 `paste` 钩子是 image-paste（覆盖当前块）。因此粘贴文本会落到 TipTap 默认行为——把多行文本**塞进单个 block**，不会还原成多个 block。复制是 block 语义，粘贴却是纯文本语义，两端不对齐。
2. **复制丢结构/属性**：`copyToClipboard` 只取 `content`，丢弃 `id`/`type`/`format`/`properties`/`pos`/`pageId`。`properties`（status/priority 等）存在独立 Property 表，复制后全丢。
3. **折叠块复制不一致（bug）**：`copyToClipboard` 遇 `format.collapsed` 会 early return 跳过子树（`:159`），但 `anchorIds`/`computeRange` 收集后代时**不检查 collapsed**——于是"选中能删、却复制不到"。
4. **全页扫描（性能）**：`copyToClipboard` 从全页根块起做 DFS，仅筛选 `anchorIds`（`:167-170`），选中 3 个块也要遍历整页——O(全页)。
5. **无内部剪贴板格式**：无自定义 MIME、无 JSON 载荷、无内存 store，无法区分内部/外部粘贴，也无"纯文本粘贴"路径。

既有可复用基础：`services/serialize-block-tree.ts` 已提供 `serializeBlockTree` / `deserializeBlockTree`（后者 `generateUUID` 重生成 id、`DFS` 递增 pos）——是内部剪贴板格式的现成底座。

**为何需要 ADR**：这是引入一种长期存在的内部数据格式（自定义 MIME + JSON 载荷）与一套粘贴分发规则——属于"不直观、改起来代价大、且有真实取舍"的决策，未来读者会问"为何不用内存 store / 为何不解析外部 HTML"，故须记录。

---

## 决策

### D1：核心目标 = 打通"粘贴为 block"全链路

本次优化的首要目标是让"复制的 block 以 block 形式、带结构地重现"。复制侧的结构/属性保留、折叠不一致等问题，作为"定义剪贴板格式"的副产品一并解决，不单独立项。

- 当前缺失的是粘贴的"另一半"——复制早已存在但只能产出纯文本。打通后，复制与粘贴两端均为 block 语义。

### D2：范围 = (a) 同页内、(b) 跨页、(d) 含子 block 子树；**(c) 外部文本→拆多个 block 明确推迟**

- 核心范围：(a) 复制后在本页别处粘贴（复制+移动/duplicate 语义）、(b) 从 Page A 复制到 Page B、(d) 复制含子 block 的子树。
- **(c) 外部应用（Word/浏览器/纯文本）复制 → 在 comind 拆成多个 block**：**推迟到下一步单独做**。本次不引入 HTML 解析 / 文本分行。理由：(a)(b)(d) 共用同一套内部剪贴板格式，是"粘贴为 block"的最小完整集；(c) 复杂度高一个量级，且与 D5/D12 的"外部兜底"设计正交。

### D3：性质 = 正确性/能力为主 + 低成本"粘贴为纯文本"

以让 paste-as-blocks 存在且正确为主；叠加一个低成本 UX：粘贴为纯文本选项（避免从别处带格式进来）。**不**引入 duplicate-block 命令（独立功能）。

### D4：剪贴板载荷 = `{ content, type, format, properties, children }`（递归）

复制时随 block 旅行的数据结构：

```ts
interface BlockClipPayload {
  content: string;                 // 文本
  type: 'bullet' | 'property' | 'query' | 'embed' | 'code' | 'image';
  format: Record<string, unknown> | null;   // heading 层级、collapsed 等
  properties: Record<string, { value: string; type: string }> | null; // 来自 Property 表
  children: BlockClipPayload[];    // 子树，递归
}
interface BlockClipboardPayload {
  version: 1;
  kind: 'blocks';
  blocks: BlockClipPayload[];      // 森林的顶层根
}
```

- **携带**：`content` / `type` / `format` / `properties` / `children`（子树）。
- **重生成（不携带语义）**：`id` / `parentId` / `pos` / `pageId` / `createdAt` / `updatedAt`——粘贴时一律新建。
  - **例外（D6 重映射所需）**：载荷节点**额外携带源 `id`**，仅供粘贴时基于「旧 id → 新 id」映射重写 `content` 内部自引用；该 id 绝不复用（**唯一例外见 D4b：剪切载荷命中本库软删时可复用 id 完成搬移**）。
- **不携带**：`renderSegments`（由 `content` 派生，可重算）。
- 复制只遍历 `anchorIds` 及其后代（**不再全页 DFS**，修 D4 性能 bug，见 D10）。

> ### 修订 D4b：剪切粘贴 = 搬走同一个块（id 复用的唯一例外）
>
> **背景**。按 D4，`剪切 → 粘贴` 得到的是副本：原件进回收站，副本持新 id。凡挂在块 id 上的东西由此全部脱钩 —— 指向它的 `(( ))` 引用断链、查询块的命名视图要经 `afterPaste` 显式克隆、字段值要 decode 后重建、块卡缓存要失效。每类块都得写一份补丁，每份补丁都有一次对不齐的机会；而跨页搬块只有剪切粘贴这一条路（侧栏不接受块拖放），页内搬移则早已是「改 `parentId`/`pos`、id 不变」的移动语义。两条移动路径的语义因此分叉。
>
> **决策**。
>
> 1. 载荷升 `version: 2`，新增 `op: 'cut' | 'copy'`。缺该字段（v1 载荷）或取值未知 → 一律按 `'copy'`：旧剪贴板内容与外部写入的载荷永不被误判为剪切。
> 2. 两个剪切出口都打 `op: 'cut'`：块入口菜单（单块）与块选区 `Ctrl+X`（多根森林）。`Ctrl+C` 与外部粘贴一律 `'copy'`。
> 3. 粘贴时若 `op === 'cut'` 且载荷**根 id 在本库存在且 `deleted_at` 非空** → 走搬移：级联复活仍软删的子树、整棵子树改写 `page_id`、根块改写 `parent_id`/`pos`，**id 不变**。任一目标不满足 → 整组回落新建副本。
> 4. **整组原子**：全部目标在一个事务内完成，任一失败整体回滚，不出现「一半搬了、一半是副本」。
> 5. 判据**不含时间窗、不含库标识**：同一库同步过来的块 id 相同、本就是同一块，复活是正确行为；不同库的 UUID 碰撞可忽略。
> 6. 搬进自己的子树（环）直接拒绝，回落新建。
> 7. 降级为新建**不提示**（跨机/跨库本来拿不到源行，不是异常）；搬移成功轻提示「已移动 N 个块到「页名」」，因为块从源页消失了，用户需要知道它去了哪。
> 8. **跨页搬移是一步撤销**：两页的「搬移后」快照被配成同一步（`linkCrossPageStep`），撤销/重做任意一侧都会连带另一侧。不做这件事有两个后果：用户要换页按第二次 `Ctrl+Z`；且在「先在源页撤销」的顺序下，同一 id 会以两个 `pageId` 同时存在于 store（`restoreEntry` 另按快照 id 集合剔除，作为该顺序的兜底）。
   - 源页必须**随载荷走**（`fromPageId`）：剪切已经把块从 store 摘掉，粘贴那一刻按 id 回查源页必然落空。缺该字段（v1/手工载荷）则退回「两页各撤一步」，不做半套。
9. **退回源页必须显式写 `page_id`**：`BlockService::update` 的形参不含页（编辑器打字路径从不换页），批次操作 `block`/`update` 因此只在「入参 `page_id` ≠ 现库 `page_id`」时按整行补写一次，并把**新旧两页**都记进 `page_ids`（字数重算）。缺这一步的表现是「块被复活了，却留在目标页」——`deleted_at` 已清空、`page_id` 仍指旧目标。
>
> **已否决的替代方案**。
>
> - *靠源块「是否软删」隐式推断意图*：省掉载荷字段，但「复制之后、粘贴之前源块被别的路径删掉」会被误判成剪切而搬走原文。显式 `op` 是唯一无歧义的判据。
> - *只在跨页时复活*：改动面更小，但同一个动作在两种落点下结果不同（引用断不断），用户无法预测。
> - *多块剪切仍走新建*：同样出现「选 1 块与选 10 块结果不同」，而「搬一段到另一页」恰恰是多块剪切的高频形态。
> - *剪切即「原子移动」的数据库原语（不带软删前置）*：剪贴板可以被别的应用覆盖、可以在另一台机器的另一个库里粘贴，移动只能是最优努力的快车道，不能成为粘贴的唯一语义 —— 故保留「新建副本」作为回落路径。
- *让 `move_blocks` 也能搬活块，用同一原语做撤销的退回*：该原语以「根块仍软删」为唯一复活前提，放宽它会连带破坏「同一份载荷连粘第二次回落新建」与「源块已被回收站恢复则新建副本」两条判据，把「搬移」和「新建」的边界弄糊。撤销需要的只是改 `page_id`，与复活无关，故落到批次更新上。

**验收分层**。判据分三层，缺一层就会漏掉一类缺陷：

1. 单测：载荷意图标记与归一化、搬移判据（含「块已不在内存」）、整组原子、降级回落、批次更新的跨页写入、两页快照配对。
2. e2e（合成 paste 事件，剪贴板桩）：同 id 复活 + 内容回来 + 提示出现；`op: 'copy'` 得到新 id；同一份剪切载荷连粘两次第二次降级。
3. 真机（Tauri 运行态）：真实 IPC `move_blocks`、提示文案、回收站状态、一次 `Ctrl+Z` 退回源页、`Ctrl+Y` 再搬回。
>
> **已知例外**。源页只有这一个块时，「每页至少留一块」闸门不会真删它（改为清空正文并保留），于是它仍是 live 状态 ⇒ 判据失败、回落新建，源页留一个空块、引用会断。这是闸门语义与搬移语义的固有冲突，接受为例外。
>
> **未覆盖**。同页内剪切粘贴的撤销仍是两步（撤销一次先回到「块被剪掉」那一刻），与改动前一致，不作为本次回归项。源页在撤销前又被编辑过时，`seq` 校验失败会放弃连带（退回两页各撤一步）—— 明确优于「退错一步」。剪切后按 `Ctrl+Z` 复活块时，查询块的命名视图仍停在孤儿前缀（`restoreEntry` 未接命名空间回挂）。

### D5：传输 = 自定义 MIME `application/x-comind-block`(JSON) + `text/plain` 兜底

- 写剪贴板时同时设置两种类型：
  - `application/x-comind-block` ← `BlockClipboardPayload` 的 JSON（`version: 2` 起带意图标记 `op`，见 D4b）；
  - `text/plain` ← 人类可读的缩进文本（现有 `content` + 2 空格缩进），便于粘到别的 App（如 Notepad）仍得可读文本。
- **粘贴分发**：剪贴板含 `application/x-comind-block` → 走 block 粘贴（D13）；否则视为外部（D12）。
- **为何不用纯内存 store（备选）**：内存 store 只能在应用内生效，跨进程/跨 App 丢失；自定义 MIME 是标准富剪贴板模式，既能区分内部/外部，又能让 `text/plain` 兜底保证外部可读。MIME 方案被采纳。

### D6：ID 与引用 = 一律重生成；仅重映射子树内部自引用

- 粘贴时对每个 block（及 property）一律 `generateUUID` 重生成 id，避免同页复制或跨页的 id 冲突。
- block `content` 可能含**跨记录引用**（`recordRef`，指向其它 block/Page）。重生成 id 时：
  - 指向**被粘贴子树内部**某 block 的引用 → 重映射到该 block 的**新** id（保证副本自洽）；
  - 指向**子树外部**的引用 → 保持原样（仍指向原外部目标）。
- 内容中的引用重映射在反序列化阶段完成（基于"旧 id → 新 id"映射表，仅覆盖子树内部成员）。

### D7：粘贴落点 = 上下文感知（按推荐）

- 有选中 block（或聚焦 block）→ 粘贴在**其后**；
- 无选中 → **追加到所在 Page 末尾**。
- 与主流笔记 App（Notion 等）一致，避免出现"复制了却不知道粘哪了"。

### D8：层级与排序 = 完全由 payload 显式决定（按推荐）

- 层级：完全由 `payload.children` 数组**显式**决定（复制时整棵选中子树都进 payload，不靠缩进推断），粘贴还原为一比一精确还原。
- 排序：森林的各顶层根节点按原 DFS 顺序，依次插入为目标之后的一个 sibling 组。
- **落点只决定整组插在哪，不改变内部层级/排序**——最可预测、最少惊奇。

### D9：粘贴为纯文本触发 = `Ctrl/Cmd+Shift+V`（按推荐，不做右键菜单）

- `Ctrl/Cmd+Shift+V` → 忽略自定义 MIME，直接走 `text/plain` 兜底，按当前 TipTap 单 block 行为粘贴纯文本。
- **不做**右键上下文菜单项"粘贴为纯文本"（用户明确只要快捷键）。若日后需要再补。

### D10：折叠块复制修正（顺手修 bug，按推荐）

- 复制**包含完整选中子树的全部后代、无视 `collapsed`**——折叠态只是视图状态，不应影响复制内容。
- 同时 `copyToClipboard` 改为只遍历 `anchorIds` 及其后代（不再全页 DFS），修掉现状 O(全页) 性能问题。
- 修复现状不一致：选中含折叠块的后代时，复制与删除行为对齐（都能覆盖完整子树）。

### D11：跨页 properties 落地（按推荐）

- Property 表是**全局、以 `block_id` 为键、无页面耦合**（核查 `crates/comind-core/src/storage/sqljs.rs:165` 的 `Property` 表无 `page_id` 列）。
- 跨页（及同页）粘贴时，对每个粘贴的 block，按 `payload.properties` 逐条 `setProperty(newBlockId, key, value, type)` **新建属性行**（属性 `id` 也新生成）。
- `sortOrder` 等展示元数据默认 0（当前 `setProperty` 写死 `sort_order=0`，影响极小；真要保真以后再扩展接口）。重点是 `value`/`type` 不丢——修掉现状"复制丢 properties"的已知 bug。

### D12：外部粘贴兜底 = 当前 TipTap 单 block 行为；(c) 不拆（用户决定）

- 剪贴板**没有** `application/x-comind-block` 时（外部 App / 纯文本 / HTML 粘贴）→ 不解析 HTML、不拆成多个 block，退回当前 TipTap 单 block 行为（纯文本落入当前块）。
- **(c) 外部文本→拆多个 block 明确推迟到下一步单独做**，不在本次范围。

> **修订注（ADR-0026 采纳后）**：本 D12 的"单 block 兜底"现**仅适用于行内光标粘贴**（caret 在块文本内、无 block 选择）场景。在 **block 级上下文**（有 block 选中/聚焦）下，外部粘贴已改为**拆分为多个 block**（见 ADR-0026 D1）。即：外部粘贴不再一律塌缩为单 block，而是按粘贴上下文分流。

### D13：粘贴分发规则 = BlockList/document 层拦截（按推荐）

- 用户按 `Ctrl/Cmd+V` 时：
  - 剪贴板含 `application/x-comind-block` → 在 **`BlockList`/document 层**拦截，执行 block 粘贴（按 D7 落点、D8 层级插入新 block 树）；
  - 否则（无自定义 MIME，或需行内编辑）→ 落到 TipTap 默认行内文本粘贴。
- **block 粘贴在 `BlockList` 层，不在 TipTap**：因为产出的是多个 block（树），不是行内文本；TipTap 只负责行内编辑。这样 (c) 外部粘贴天然走 TipTap 兜底，与 D5/D12 自洽。
- 触发时机：有 block 选中/聚焦时 `Ctrl+V` 走 block 粘贴；仅光标在块文本内、无 block 选择时走 TipTap 行内。

---

## 后果 / 权衡

- **正面**：
  - 复制与粘贴两端均为 block 语义，结构性不对称消除；
  - 复制保留 `type`/`format`/`properties`/子树，跨页复制不再丢属性（修已知 bug）；
  - 修复折叠块"选中能删却复制不到"的不一致 + 全页扫描性能问题；
  - 内部/外部粘贴通过自定义 MIME 干净区分，`text/plain` 兜底保证外部可读；
  - 复用 `serialize-block-tree.ts` 底座，新增代码量小。
- **负面 / 风险**：
  - 引入长期存在的内部 MIME 格式与 JSON 载荷——未来改 payload 结构需兼顾兼容性（用 `version` 字段演进）；
  - `Ctrl/Cmd+Shift+V` 纯文本仅快捷键、无右键菜单（用户取舍，范围收敛）；
  - (c) 外部拆 block 未做，从 Word/浏览器复制仍只进单 block（已知局限，已排期下一步）；
  - 跨记录引用重映射仅在子树内部生效，外部引用保持原目标——需测试验证副本自洽性。
- **权衡取舍**：
  - 自定义 MIME vs 内存 store：选 MIME（跨进程/跨 App 有效 + 标准富剪贴板），内存 store 被否决；
  - (c) 纳入 vs 推迟：选推迟（核心集 (a)(b)(d) 已最小完整，(c) 复杂度高一个量级且与兜底正交）；
  - 右键"粘贴为纯文本" vs 仅快捷键：选仅快捷键（用户明确收敛范围）；
  - block 粘贴放 BlockList 层 vs TipTap 内：选 BlockList 层（产出多 block 非行内文本，分层清晰）。

---

## 术语表（Glossary）

| 术语 | 含义 | 备注 |
|------|------|------|
| Block Clipboard Payload（剪贴板载荷） | 复制 block 时随行的结构化数据：`{ version, kind:'blocks', blocks: BlockClipPayload[] }`，每项含 `content`/`type`/`format`/`properties`/`children`（递归）；`id`/`pos`/时间戳不携带、粘贴时重生成 | ADR-0025 D4 |
| Paste as Blocks（粘贴为 block） | 将内部剪贴板载荷还原为一棵/多棵新 block 树插入目标页，而非落入单个 TipTap block | ADR-0025 D1/D7/D8/D13 |
| Internal Clipboard Format（内部剪贴板格式） | 自定义 MIME `application/x-comind-block` 承载 `BlockClipboardPayload` 的 JSON，配 `text/plain` 兜底以区分内部/外部粘贴 | ADR-0025 D5 |
| Paste as Plain Text（粘贴为纯文本） | `Ctrl/Cmd+Shift+V` 忽略自定义 MIME、走 `text/plain` 兜底，按 TipTap 单 block 行为粘贴纯文本 | ADR-0025 D9/D12 |
| 载荷意图标记（`op`） | `BlockClipboardPayload.op`：`'cut'` 才允许粘贴时把源块搬走，`'copy'` 一律新建；缺省/未知按 `'copy'` | ADR-0025 D4b |
| 剪切搬移（Move on Paste） | `op: 'cut'` 且载荷根块在本库仍软删时，粘贴把它复活并改归属页/父级/位置，**id 不变**，整组原子 | ADR-0025 D4b |
