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
  - **例外（D6 重映射所需）**：载荷节点**额外携带源 `id`**，仅供粘贴时基于「旧 id → 新 id」映射重写 `content` 内部自引用；该 id 绝不复用。
- **不携带**：`renderSegments`（由 `content` 派生，可重算）。
- 复制只遍历 `anchorIds` 及其后代（**不再全页 DFS**，修 D4 性能 bug，见 D10）。

### D5：传输 = 自定义 MIME `application/x-comind-block`(JSON) + `text/plain` 兜底

- 写剪贴板时同时设置两种类型：
  - `application/x-comind-block` ← `BlockClipboardPayload` 的 JSON；
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
