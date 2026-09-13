# ADR-0035: 文本选择模型重构 —— Word 式跨 block 连续文本选择

- 状态：已采纳（Accepted）
- 日期：2026-08-24
- 修订：2026-09-13（#93 开放问题 1 写回；#94 D6 命中面修订；#95/#96 新增 D8 键盘删除语义；高亮跳过无文本节点块，新增 D9 并闭合开放问题 4；shift+click 延伸，新增 D10 并从 D7 范围外移出 Shift+Click）；2026-09-14（D8 增补 Ctrl+X 剪切同表）
- 范围：
  - `src/composables/useCrossBlockSelection.ts`（选区模型扩展：新增文本选区，保留块选区）
  - `src/components/BlockList.vue`（document 级拖拽/按键事件改为按"文本选区"语义驱动）
  - `src/components/Block/index.vue`（属性区 mousedown 纳入块选区追踪；内容区拖拽改为文本选区语义）
  - `src/services/selection-geometry.ts`（偏移 ↔ DOM Range 映射与高亮矩形计算）
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
- **起点在激活块内同样启动追踪**（2026-09-13 修订）：旧实现「已激活的 block 交给 ProseMirror 原生处理光标定位」提前 `return`，ProseMirror 独占拖拽 → 选区被钳在本块内、拖不出去。现激活块与非激活块**同构**：mousedown 都启动文本追踪、不 `preventDefault`（单击/双击语义仍归 ProseMirror）；拖过 4px 阈值后 `deactivateBlock()` 卸载编辑器，由 comind 统一接管——与非激活块起点完全一致。

### D2：两种选区互斥并存，手势分流

| 选区 | 含义 | 手势 | 用途 |
|------|------|------|------|
| 块选区（Block Selection） | block id 集合 | Ctrl/Cmd+Click 切换；**拖属性区** | block 复制/粘贴/删除 |
| 文本选区（Text Range） | 跨块字符范围 | 内容区**拖拽**；Shift+Click 延伸（D10） | 文本复制/删除（D8） |

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
- 选区高亮用**覆盖层**绘制（首尾部分字 + 中间整块），不侵入 block 内部结构、不改变 contenteditable 边界；无文本节点的块（空行 / 图片块）不产生矩形（D9）。
- 复制是纯读取（按偏移切片 `content` 拼接），无需行内富文本编辑能力。
- **否决的备选**：全 contenteditable（Notion 式）——把所有 block 改成同时可编辑、让原生选区跨块。会推翻 dev-guide 5.2 单编辑器模型与大量既有生命周期/粘贴逻辑，重写量巨大，与"打磨体验"定位不符。

### D5：文本选区复制输出 = 内容切片拼接

- 文本选区 `Ctrl+C` → 复制"内容切片拼接"：中间整块 `content` + 首尾按偏移切片，块间 `\n` 连接。
- 非文本块沿用其 `content` 的现有表示（image=`![alt](url)`、code=原文），不引入新的序列化约定。

### D6：块选区命中面 = 整块行（2026-09-13 修订，原为属性区）

- **原决策（2026-08-24）**：`mousedown` 落在 `.block-properties`（块下方属性 chips）启动块选区追踪。
- **暴露的问题**：该载体在**无属性块上高度为 0** → 「点不中」；且载体的存在性由「块有没有属性」决定，属偶然耦合。真机实测可命中带仅 ≈2px。
- **修订（#94）**：命中面的判据改为 **恒存在 + 可发现**，形态是**整条块行的可点带**，而非某个子元素。
  - `.block` 根挂 `onBlockMousedown`：仅左键 + `Ctrl/Cmd`，带**归属守卫**（`closest('[data-block-id]')` 防子块冒泡越权），并排除 `.block-content`（该区已被各类型的 mousedown 钩子占用）/ `.block-bullet` / 自交互元素（link / rel-type-label / date-ref / property-item）。
  - `.block-properties` 补 `min-height: $space-2`（8px），使块下方成为恒存在可点带；其左缘 = 块左缘 + 20px，**天然避开 bullet 列**。代价：每块行距 29 → 37px。
  - **不做**拖拽式范围选块（手势集合只扩 Ctrl/Cmd+Click）。

### D7：范围外（本轮不做）

- 键盘范围选择（Shift+↑↓）。~~Shift+Click~~ **已由 D10 补齐**。
- 选区浮动格式工具条（用户本轮选"仅复制"；**删除已由 D8 补齐**）。
- 行内富文本格式模型。
- "无 5px 阈值误触"随 D1 拖拽语义重写一并解决，不单独立项。

### D8：选区的键盘删除语义统一（2026-09-13，#95 / #96）

- **原则**：块选区与跨块文本选区在键盘删除上语义一致 —— **选中即被支配**；`Backspace` 与 `Delete` 同义（同一张 document 级分派表，且**无条件 `preventDefault`**）。
- **剪切同表（2026-09-14）**：`Ctrl/Cmd+X` 加入同一张分派表 = **先复制后删除**（复制口径与 `Ctrl+C` 完全一致；文本选区复制 `textRangeToText` 切片、块选区复制 ADR-0025 载荷），删除编排与 `Backspace` 共用同一函数（`deleteSelectedBlocks`）。无选区时不接管，保留编辑器原生行内剪切。复制函数在首个 `await` 前同步快照选区内容，先于删除的落库变更，无竞态。
- **文本选区的删除 = 按字符裁剪 + 端点合并**：头块保留 `[0, lo)`、尾块保留 `[hi, ∞)` 后接成一块（生存者 = 文档序靠前的头块），尾块的子块迁到生存块末尾；中间整块（含子树）删除。
- **端点落在非 `bullet` 类型（image/code/embed/query/property）**：该端点块原样保留，不裁剪也不合并 —— 这些类型没有「部分选中」这回事，且合并等于把生存者的类型强加给另一端、销毁其类型与渲染方式。
- **任何删除入口都必须同源（走关系清理收口）**：文本选区删除的「中间整块」经 `deleteTextRange` 的**必填**出口参数注入 `cleanupAfterDelete`；端点块因其内容只有一部分存活、不满足收口「整块内容全部消失」的前提而**不入被删集**——残余缺口（端点被丢弃片段里的 inverse typed-link 漏降级，方向安全）记为 **#100**。
- 端点偏移先经 `renderedOffsetToEncodedOffset` 换算（开放问题 1）再切片；删除后落点的 `cursorPos` 口径 = ProseMirror position（文本偏移 + 1）。

### D9：无文本节点的块 = 跳过，不弃整条选区（2026-09-13，闭合开放问题 4）

- **现象**：拖拽扫过空行（或图片块）时，高亮**整条消失**；空行夹在中间则该行留一个空洞。
- **根因**：高亮靠「偏移 ↔ DOM Range」逐块构造子 Range，而空行在无占位符时渲染成裸 `<span></span>`（`BulletRender.vue`）——**块内没有任何文本节点** → 构造不出 Range → 旧实现据此 `return []`，把前面已经选中的文本一并丢弃。
- **决策**：无文本节点的块（空行、图片/嵌入块）**不产生高亮矩形**，其余块的高亮不受影响。端点落在这种块上时，端点由**相邻文本块的边界兜底**（首侧取块首、尾侧取块末）——这就是开放问题 4「拖到其上时首尾偏移如何归一化」的答案：不归一化进该块，而是让它退出，端点吸附到相邻文本块。
- **实现要点**：端点判序不能再用 `Range.compareBoundaryPoints`（无文本节点时比较不了），改为按**块在文档序中的位置**判先后；同块内退回按字符偏移判序（否则反向拖拽塌缩成零宽）。
- **不影响选区成员资格**：删除仍按 D8 把中间的无文本块整块删除（含子树），复制仍含其 `content`——「不画高亮」只关乎显示。
- **回归网**：`src/services/selection-geometry.test.ts`。jsdom 未实现 `Range.getClientRects`（该模块此前只有真机验证），测试注入替身把「覆盖的块 + 覆盖字数」编码进矩形，使断言落在选中语义而非像素几何上。

### D10：shift+click 延伸已有文本选区 / 从光标起选（2026-09-13，同日修订）

- **语义**：`shift+click` = 把已有文本选区的**活动端（head）延伸到点击处**，anchor 不动（Word / 浏览器通用行为）；点击在 anchor 之前则选区反向，文档序归一交给消费方（几何层 / `textRangeToText` 已按位置判序）。**无选区但有光标时从光标起选**（同日用户翻转初裁——初版为「无选区退化为普通点击」；光标直接读激活块 PM 维护的 DOM selection 的 anchor，零新增「上次光标位置」状态）；两者皆无（光标不在任何块内容区内）才退化为普通点击。
- **shift+mousedown 后按住拖动 = 连续调整**：`startTextExtend` 置 `isTextDragging = true`，使既有拖拽循环直接接管——`handleDocMouseMove` 免 4px 阈值连续重调 head，`handleDocMouseUp` 走固化分支保留选区。零新增事件机制。从光标起选与延伸共用此循环（`startTextExtend(head, startPoint, anchorOverride?)`：有 range 用 range.anchor，无 range 用 override 先 `startTextTracking` 清场）。
- **激活块内接管并屏蔽**：shift+mousedown 且已有选区、或从光标起选时 `preventDefault`，抑制 ProseMirror 原生 shift+click（否则其原生蓝底选区与 comind 覆盖层双高亮）。注意：PM 的 mousedown 处理先于本分支运行（事件冒泡序），故从光标起选时读到的往往是 PM 已延伸过的**非折叠**选区——**取 anchor 而非要求折叠**（PM 的 shift 延伸保持 anchor = 原光标）。**从光标起选后立即 `deactivateBlock`**：维持「PM 挂载与 comind 文本选区不并存」不变量（双高亮只在失活落定前闪一帧）。
- **实现**：`useCrossBlockSelection.startTextExtend(head, startPoint, anchorOverride?)` + `selection-geometry.caretBlockOffsetFromDomSelection()`（光标→BlockOffset，textContent 口径与 `blockOffsetFromPoint` 一致）+ `useBlockEditorLifecycle.handleContentMousedown` 的 shift 分支（先于 clickCoords/激活路径；已有选区且 head 无效时不落普通路径，保住既有选区）。

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
  - 复制 only vs 复制+格式/删除：原选复制 only（契合"打磨"初衷）；**删除已于 2026-09-13 补齐（D8 / #95）**，格式仍留待后续。

---

## 开放问题 / 待确认

1. **偏移基准**：**已决（#93，2026-09-13）—— `TextRange.offset` 以 encoded（`block.content` 存储原文）为基准**，与 D5「复制输出 = 内容切片拼接」保持一致，不引入 decode 输出路径。几何模块仍按「界面渲染文本」给偏移，跨界处由 `src/services/render-text.ts` 的 `renderedOffsetToEncodedOffset` 换算（换算规则与渲染器同源；标记内部按落点吸附到标记边界，避免切出残缺标记）。locality / testability 债（几何坐标基准一等化、换算收敛到一处）留在 #99。
2. **高亮视觉**：覆盖层高亮如何与原生 `::selection`（激活块内）视觉一致，避免"一块一个颜色"的割裂。
3. **折叠块**：block 折叠时子块不可见，文本选区拖过折叠块如何表现（只选折叠块自身？）。
4. **图片/嵌入块在文本选区中的切片语义**：非文本块无字符偏移，拖到其上时首尾偏移如何归一化。→ **已于 2026-09-13 闭合（D9）**：该块退出高亮、端点吸附到相邻文本块边界；删除/复制的成员资格不变（D8）。

---

## 术语表（Glossary）

| 术语 | 含义 | 备注 |
|------|------|------|
| Block Selection（块选区） | 以整块为单位选中的 block id 集合，用于 block 级复制/粘贴/删除 | ADR-0035 D2 |
| Text Range（文本选区） | 跨多个 block 的连续文本范围，由首尾两个字符位置（各含 blockId 与字符偏移）界定 | ADR-0035 D1/D3/D8 |
| Block Offset（块偏移） | 文本选区端点：`{ blockId, offset }`，offset 为该 block 原文的字符偏移 | ADR-0035 D3 |
