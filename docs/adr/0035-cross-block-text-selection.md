# ADR-0035: 文本选择模型重构 —— Word 式跨 block 连续文本选择

- 状态：已采纳（Accepted）
- 日期：2026-08-24
- 范围：
  - `src/composables/useCrossBlockSelection.ts`（选区模型扩展：新增文本选区，保留块选区）
  - `src/components/BlockList.vue`（document 级拖拽/按键事件改为按"文本选区"语义驱动）
  - `src/components/Block/index.vue`（属性区 mousedown 纳入块选区追踪；内容区拖拽改为文本选区语义）
  - 关联 ADR：**ADR-0025 / ADR-0026**（block 剪贴板链路，依赖块选区不变）；**dev-guide 5.2 单编辑器模型**（本 ADR 的前提约束）。
- 来源：用户「文本选择功能优化」，经 grilling 收敛：作用域 = block 内文字选区 + 跨 block 多选，动机 = 打磨体验。

---

## 背景 / 问题陈述

现状的"选择"是**二分的**：单 block 内只有原生文字选区（且只能停在单个 contenteditable 内），跨 block 则只有"整块"粒度的多选（`useCrossBlockSelection` 的 `anchorIds`）。两者之间没有中间态——用户无法像 Word 那样从 A 块的某个字拖到 C 块的某个字，选出一段连续的文本流。

代码核查（2026-08-24）支撑事实：

1. **跨块多选是整块粒度**：`useCrossBlockSelection.computeRange` 按树前序收集**整块** id 集合，无字符偏移概念；`copyToClipboard` 走 ADR-0025 的结构化块载荷。
2. **无 5px 阈值**：设计文档 `2026-05-23-cross-block-selection-design.md` 写"长拖 >5px 才进入选择"，但 `BlockList.vue:handleDocMouseMove` 只要 `elementFromPoint` 跨进相邻 block 就 `isDragging=true`，轻微越界即误触。
3. **属性区无法作为起点**：`Block/index.vue` 的 mousedown 只挂在 `.block-content`；`.block-properties`（块下方属性 chips）按下不触发任何选区追踪。
4. **单编辑器模型**：同一时刻仅 `isActive` 的 block 挂载 TipTap（`index.vue` `v-if="isActive"`），其余 block 是 readonly `renderComponent`——原生选区无法跨 contenteditable。
5. **`renderSegments` 已携带字符偏移**：`src/wasm/types.ts` 的 `RenderSegment` 有 `{ type, start, end }`，即渲染层已建立"内联标记 ↔ 原文字符偏移"映射，为几何→偏移换算提供地基。

**为何需要 ADR**：本改动把"选择"从单一"块集合"扩展为"块集合 + 跨块字符范围"双模型，并要在**保持单编辑器**的前提下实现跨块文本选择——这是硬反转、取舍不直观、后人会困惑"为何不用原生跨块选区"，须记录。

---

## 决策

### D1：目标 = Word 式跨 block 连续文本选择

- 内容区拖拽产生**文本选区（Text Range）**：首尾是部分字（带字符偏移）、中间是整块，文档序连续，如 Word 的多行选择。
- **推翻**旧行为"内容区拖拽 = 整块选择"（`computeRange` 的整块收集不再作为拖拽的主语义）。

### D2：两种选区互斥并存，手势分流

| 选区 | 含义 | 手势 | 用途 |
|------|------|------|------|
| 块选区（Block Selection） | block id 集合 | Ctrl/Cmd+Click 切换；**拖属性区** | block 复制/粘贴/删除 |
| 文本选区（Text Range） | 跨块字符范围 | 内容区**拖拽** | 文本复制 |

- 同一时刻至多一种生效；进入其一清除另一。
- 复制分流：有文本选区 → 复制文本（D5）；有块选区 → 走 ADR-0025/0026 结构化块复制；皆无 → 浏览器默认。
- 现有 `anchorIds`/`selectedIds` 保留为"块选区"的载体，ADR-0025/0026 零破坏。

### D3：选区数据模型

```ts
// 文本选区（新增）
type BlockOffset = { blockId: string; offset: number }  // offset = 该 block 原文的字符偏移
type TextRange = { anchor: BlockOffset; head: BlockOffset }  // 保留方向性，供将来 Shift+↑↓ 扩展

// 块选区（现有，规范化命名）
type BlockSelection = Set<string>  // block id 集合（沿用 anchorIds/selectedIds）
```

`anchor/head` 保留方向性而非规范化为 `{start,end}`，代价近乎为零，为键盘范围选择留扩展余地。

### D4：实现路径 = 自定义选区覆盖层（保持单编辑器）

- 拖拽时用 `document.caretRangeFromPoint` / `caretPositionFromPoint` 定位首尾 DOM 位置，再借 `renderSegments` 的 `{start,end}` 把 DOM 位置映射回原文字符偏移，得到 `TextRange`。
- 选区高亮用**覆盖层**绘制（首尾部分字 + 中间整块），不侵入 block 内部结构、不改变 contenteditable 边界。
- 复制是纯读取（按偏移切片 `content` 拼接），无需行内富文本编辑能力。
- **否决的备选**：全 contenteditable（Notion 式）——把所有 block 改成同时可编辑、让原生选区跨块。会推翻 dev-guide 5.2 单编辑器模型与大量既有生命周期/粘贴逻辑，重写量巨大，与"打磨体验"定位不符。

### D5：文本选区复制输出 = 内容切片拼接

- 文本选区 `Ctrl+C` → 复制"内容切片拼接"：中间整块 `content` + 首尾按偏移切片，块间 `\n` 连接。
- 非文本块沿用其 `content` 的现有表示（image=`![alt](url)`、code=原文），不引入新的序列化约定。

### D6：属性区纳入块选区追踪起点

- `mousedown` 落在 `.block-properties`（块下方属性 chips）也启动块选区追踪，拖拽即从该块开始整块选择——修复"从属性区选不中"。

### D7：范围外（本轮不做）

- 键盘范围选择（Shift+Click / Shift+↑↓）。
- 选区浮动格式工具条（用户本轮选"仅复制"）。
- 行内富文本格式模型。
- "无 5px 阈值误触"随 D1 拖拽语义重写一并解决，不单独立项。

---

## 后果 / 权衡

- **正面**：
  - 消除"要么单块文字、要么整块"的二分，获得 Word 式连续文本选择；
  - 保持单编辑器模型，改动增量、可控，复用 `renderSegments` 的偏移映射地基；
  - 块选区与 ADR-0025/0026 剪贴板链路零破坏；
  - 属性区成为合法选择起点，顺带修复误触与选不中的不顺手。
- **负面 / 风险**：
  - 覆盖层高亮与原生 `::selection` 的视觉一致性需额外对齐（开放问题 2）；
  - 几何→偏移映射对 inline 标记块（link/date_ref/typed_link）需借 `renderSegments` 换算，实现非平凡；
  - 折叠块内文本选区的表现需明确（开放问题 3）。
- **权衡取舍**：
  - 覆盖层 vs 全 contenteditable：选覆盖层（单编辑器不动，增量可控）；
  - 文本选区 vs 整块选择替换拖拽：选文本选区（直接命中"Word 式"诉求）；
  - `{anchor,head}` vs `{start,end}`：选前者（保留方向性，为键盘扩展留余地）；
  - 复制 only vs 复制+格式/删除：选复制 only（契合"打磨"初衷，格式/删除留待后续）。

---

## 开放问题 / 待确认

1. **偏移基准**：TipTap 内编辑用 decoded 文本（中文 label），而 `block.content` 是 encoded（英文 type）——`TextRange.offset` 以哪个为基准？需与 `handleSplit` 的 decode↔encode 偏移转换对齐。
2. **高亮视觉**：覆盖层高亮如何与原生 `::selection`（激活块内）视觉一致，避免"一块一个颜色"的割裂。
3. **折叠块**：block 折叠时子块不可见，文本选区拖过折叠块如何表现（只选折叠块自身？）。
4. **图片/嵌入块在文本选区中的切片语义**：非文本块无字符偏移，拖到其上时首尾偏移如何归一化。

---

## 术语表（Glossary）

| 术语 | 含义 | 备注 |
|------|------|------|
| Block Selection（块选区） | 以整块为单位选中的 block id 集合，用于 block 级复制/粘贴/删除 | ADR-0035 D2 |
| Text Range（文本选区） | 跨多个 block 的连续文本范围，由首尾两个字符位置（各含 blockId 与字符偏移）界定 | ADR-0035 D1/D3 |
| Block Offset（块偏移） | 文本选区端点：`{ blockId, offset }`，offset 为该 block 原文的字符偏移 | ADR-0035 D3 |
