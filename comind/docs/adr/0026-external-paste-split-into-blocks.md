# ADR-0026: Block 复制粘贴（续）—— 外部粘贴拆分为多个 block

- 状态：已采纳（Accepted）
- 日期：2026-08-24
- 范围：
  - `src/components/BlockList.vue`（新增集中式粘贴控制器，承载外部拆分逻辑）
  - `src/services/external-paste-parse.ts`（新增：外部剪贴板 HTML/纯文本 → block 载荷）
  - `src/components/Editor.vue`（仅作为兜底：行内光标粘贴仍走 TipTap 默认）
  - `src/components/Block/index.vue`（现有 `onPaste` 仅处理 image，保持不变）
  - `src/stores/blocks.ts`（`createBlock` / `safeCalcInsertPos` 复用，无新增批量 API）
  - 新增内部常量：外部源格式优先级（html > plain）
- 关联 ADR：本 ADR 是 **ADR-0025 的延续与细化**；其中 **D12（外部粘贴 → 单 block 兜底）在"block 级上下文"下被本 ADR 推翻**，行内光标粘贴仍保留 TipTap 单 block 行为。
- 来源：用户「block 复制粘贴行为优化」+ 接受 ADR-0025 后，将推迟项 (c)「外部文本→拆多个 block」独立成稿。

---

## 背景 / 问题陈述

ADR-0025 打通了"内部粘贴为 block"全链路，但**推迟了 (c) 外部粘贴拆分**：从 Word / 浏览器 / Notepad 复制内容进来时，当前行为是把多行文本**塞进单个 TipTap block**（ADR-0025 §背景 #1、D12），既丢失段落结构，也丢失列表/标题层级。

这带来两个落差：

1. **结构落差**：从 Word 复制一段带小标题 + 项目符号列表的文字，进来后变成一大坨纯文本，用户得手动重建每个 block。
2. **与内部粘贴不一致**：内部 block 粘贴能精确还原层级（ADR-0025 D8），而外部粘贴却塌缩成单 block——同为"粘贴"，体验割裂。

**为何需要 ADR**：外部拆分引入"HTML→block 的解析映射"与"block 级 vs 行内光标的粘贴分流"两套长期约定，且 HTML 解析涉及**不可信输入的安全净化**，取舍不直观、改起来代价大，须记录。

**代码核查（2026-08-24）支撑事实**：
- 当前 `onPaste`（`Block/index.vue:375`）仅委托给 block-type 钩子，唯一实现是 image 钩子；非 image 文本回落 TipTap 默认 → 多行进单 block。
- 块插入：`stores/blocks.ts:550` `createBlock(opts)` 支持 `parentId`/`pos`/`type`/`format`，无批量 API；`pos` 走 `safeCalcInsertPos` 间隔缓冲（间隔 1000），N 次顺序 `createBlock` 安全（save 经 `_scheduleSave` 去抖合并）。
- **运行时无 HTML 解析/净化基础设施**：`src` 内无 `DOMParser`/`DOMPurify`/`sanitize-html`/`marked`/`turndown`；仅 `Editor.vue:262` `textToHtml` 做 `&<>` 转义 + `\n→<br>`（生成侧，非解析侧）；`jsdom` 仅 dev 依赖。
- TipTap 未配置 `handlePaste`/`transformPasted`；既有 `BlockTypeHooks.onPaste` 契约（`types/block-type.ts:43`）是已确立的粘贴钩子模式（仅 image 实现）。
- 块 `content` 为**纯字符串**（HTML 仅在 TipTap 内瞬时存在）；`type` 联合不含 `heading`/`paragraph`/`blockquote`——标题由内容前缀 `#{1,6}\s+` 派生（`extensions/HeadingPreviewExtension.ts`，正则 `/^(#{1,6})\s+/`）；普通文本块即 `bullet` 类型。

---

## 决策（草案，待评审）

### D1：范围 = 外部粘贴拆分为多 block；触发于"block 级上下文"

- 覆盖两类外部源：
  - **(c1) `text/html`**：来自 Word / 浏览器 / 富文本编辑器的结构化内容；
  - **(c2) `text/plain` 多行**：来自 Notepad / 终端等纯文本。
- **触发条件 = block 级上下文**：有 block 被选中或聚焦（非正在编辑块内文本）时按 `Ctrl/Cmd+V` → 走外部拆分。
- **行内光标粘贴（caret 在块文本内、无 block 选择）→ 不走拆分**，回落 TipTap 默认单 block 行内粘贴。这**细化 ADR-0025 D12**：D12 原意"外部→单 block"仅保留给行内场景；block 级场景改为拆分。
- **不在本范围**：内部 block 粘贴（ADR-0025 已定义）、`Ctrl/Cmd+Shift+V` 纯文本粘贴（ADR-0025 D9，仍忽略结构、单 block 落文本）。

### D2：源格式优先级 = HTML 优先于纯文本

- 剪贴板**同时**含 `text/html` 与 `text/plain` 时 → 取 `text/html`（结构更完整：段落 / 列表 / 标题可还原）。
- 仅含 `text/plain` → 按换行拆分（D6）。
- 仅含 `text/html`、无纯文本兜底 → 直接解析 HTML。
- 理由：HTML 携带层级与语义，纯文本只剩换行，优先 HTML 才能还原列表嵌套与标题。

### D3：HTML 解析 = 浏览器原生 `DOMParser` + 严格 allowlist 净化（v1 不引第三方依赖）

- 用 webview/浏览器原生 `DOMParser` 把 HTML 字符串解析为 DOM（Tauri webview 与浏览器均可用），**不引入 jsdom 到运行时**（jsdom 仅 dev）。
- **净化（必须，因外部 HTML 不可信）**：解析后按 allowlist 处理——
  - 丢弃 `<script>`/`<style>` 及所有 `on*` 事件属性、`javascript:`/`data:`（非图片）协议；
  - 未知标签 unwrap 为文本（保留其文本子节点）；
  - 仅保留白名单标签与少数安全属性（`href`/`src` 仅 http/https/相对）。
- **v1 不引入 DOMPurify**；allowlist 自实现即可覆盖白名单标签集。若后续白名单膨胀再评估 DOMPurify。（开放问题：是否改用 DOMPurify 以减少维护面。）

### D4：HTML 元素 → block 类型映射

| 源元素 | 目标 block | 说明 |
|--------|-----------|------|
| `<p>`、`<div>`、游离文本节点 | `bullet` | 默认文本块（comind 普通文本即 bullet 类型） |
| `<li>`（位于 `<ul>/<ol>`） | `bullet` | 按列表嵌套进入父项 `children`（见 D5） |
| `<h1>`–`<h6>` | `bullet` | 内容前缀 `#`×N + 空格（如 `<h2>`→`## 文本`），复用 `HeadingPreviewExtension` 派生标题 |
| `<pre>`、`<code>` | `code` | 代码块类型 |
| `<blockquote>` | `bullet` | v1 不渲染引用样式，保留纯文本为 bullet（见开放问题：是否加 `> ` 前缀） |
| `<img>` | **v1 忽略/剥离** | 外部图片导入（下载到 asset、转 `image` 块）复杂度高，推迟；v1 直接丢弃或留 URL 文本 |
| 行内标签 `<b>/<i>/<a>/<span>` 等 | 折叠为纯文本 | block `content` 为字符串，行内格式（加粗/斜体/链接）v1 **不保留**（见 D9） |

### D5：嵌套层级 = 仅列表嵌套保留，其余展平

- `<ul>/<ol>` 内的 `<li>` 按 DOM 嵌套递归进入父 `<li>` 的 `children`——**保留列表层级**（与 ADR-0025 D4/D8 的 `children` 结构同构）。
- 非列表嵌套（如 `<div>` 套 `<div>`）→ 展平为同级 sibling 序列（comind 的层级是列表驱动的，非通用 DOM 树）。
- 映射产出的中间结构沿用 ADR-0025 的 `BlockClipPayload` 形状（`content/type/format/properties/children`），但 `properties` 恒为 `null`（外部无 Property 表数据）、`format` 仅标题前缀隐含。

### D6：纯文本拆分粒度 = 按 `\n` 切分、trim、跳过空行

- `text/plain` 按 `\n` 切分；每行 `trim()`；**连续/孤立空行跳过**，不生成空 block。
- 每行 → 一个 `bullet` block，内容即该行文本。
- 顺序 = 原文本自上而下。

### D7：插入落点与排序 = 复用 ADR-0025 D7/D8

- **落点**：block 级上下文下有选中/聚焦 block → 插在其后；无选中 → 追加页面末尾（同 ADR-0025 D7 上下文感知）。
- **排序**：拆分出的 block 序列按源顺序（HTML DOM 序 / 纯文本行序）作为一组 sibling 依次插入锚点之后（同 ADR-0025 D8）。
- 复用 `createBlock` + `safeCalcInsertPos` 间隔缓冲计算 `pos`，保证 N 个 block 顺序插入不冲突。

### D8：拦截与分发 = BlockList 层集中控制器（与 ADR-0025 D13 一致）

- 在 `BlockList.vue` 新增**集中式粘贴控制器**（建议 `usePasteController` composable 或 `BlockList` 内 handler），统一决策——与 ADR-0025 D13「block 粘贴放 BlockList 层、不放 TipTap」一致：
  1. **内部 MIME 命中**（`application/x-comind-block`）→ 内部 block 粘贴（ADR-0025 D13）；
  2. **外部命中**（有 `text/html` 或 `text/plain`）+ block 级上下文 → 调 `external-paste-parse.ts` 解析 → 循环 `createBlock` 插入；
  3. **行内光标 / 无 block 上下文** → `return false`，交给 TipTap 默认行内粘贴（单 block）。
- `Block/index.vue` 现有 `onPaste`（image 钩子）保持不变；image 粘贴优先级高于外部拆分（image 先消费）。
- 不改动 TipTap 配置（不引 `handlePaste`），避免在 TipTap 内部耦合 block 粘贴逻辑。

### D9：行内格式损失（v1 已知局限）

- 外部富文本的**行内格式**（加粗/斜体/下划线/行内链接/颜色）在 v1 **不保留**——因 block `content` 为纯字符串，且无行内富文本模型。
- 影响：从 Word 复制的加粗标题文字会作为普通文本落入 block（标题层级因 `<hN>` 前缀仍保留，D4）。
- 后续可扩展：在 `content` 内用应用既有的 `[[...]]`/标记语法保留链接，或引入行内富文本模型——超出本 ADR。

### D10：安全 = 外部 HTML 一律净化后再插入

- 任何进入 block `content` 的外部 HTML 文本，须先经 D3 的 allowlist 净化；禁止原始 `innerHTML` 直接写入（即便 `v-html` 仅用于内部内容，外部源也绝不走 `v-html`）。
- 图片/链接 URL 仅放行 http/https/相对路径，阻断 `javascript:`/`data:`（非图片）。

---

## 后果 / 权衡

- **正面**：
  - 外部粘贴从"塌缩单 block"升级为"按段落/列表/标题还原多 block"，与内部粘贴体验对齐；
  - 复用 ADR-0025 的 `children` 结构与 `createBlock` 间隔缓冲，新增代码量小、与既有架构同构；
  - 集中式 `BlockList` 控制器统一内部/外部/行内三类粘贴分发，职责清晰；
  - 严格 allowlist 净化，外部不可信 HTML 不引入 XSS 面。
- **负面 / 风险**：
  - v1 损失行内格式（加粗/斜体/链接）——已知的表达力退化（D9）；
  - `<img>` 外部图片不导入（D4），用户从网页复制的图片会丢失；
  - 无 DOMParser 之外的运行时解析库，allowlist 需随白名单标签维护（D3 开放问题）；
  - blockquote 无渲染样式，v1 退化为普通 bullet（D4 开放问题）；
  - 与 ADR-0025 D12 的"外部→单 block"表述冲突，需在 D12 加注"行内场景除外"，避免读者困惑。
- **权衡取舍**：
  - 外部拆分 vs 维持 D12 单 block：选拆分（消除体验割裂，且 ADR-0025 已把 (c) 排期）；
  - HTML 优先 vs 纯文本优先：选 HTML 优先（结构更完整）；
  - DOMParser+allowlist vs DOMPurify：v1 选前者（零新增依赖），DOMPurify 留作备选；
  - block 级触发拆分 vs 全局拆分：选 block 级（行内粘贴保留 TipTap 直觉，最少惊奇）；
  - 列表嵌套保留 vs 全展平：选仅列表嵌套保留（与 comind 列表驱动的层级模型一致）。

---

## 开放问题 / 待确认（评审时定）

1. **标题前缀**：`<hN>` → `#`×N + 空格 是否与应用 `HeadingPreviewExtension` 完全对齐（已查正则 `/^(#{1,6})\s+/`，基本确认，待实现时回归测试）。
2. **blockquote**：v1 退化为普通 bullet，是否要加 `> ` 前缀以保留语义标记？
3. **行内格式**：是否接受 v1 丢失加粗/斜体/链接（D9），还是 v1 就要用标记语法保链接？
4. **图片**：`<img>` v1 直接忽略，还是降级为图片 URL 文本块？
5. **净化库**：自实现 allowlist 是否足够，还是改用 DOMPurify 降低维护/审计成本？
6. **与 D12 的措辞**：本 ADR 采纳后，需回头给 ADR-0025 D12 加"行内场景除外"的修订注。

**评审结论（已采纳）**：以上开放问题按文中推荐默认全部采纳——`text/html` 源优先、原生 `DOMParser` + allowlist 净化（v1 不引 DOMPurify）、仅列表嵌套保留其余展平、行内格式 v1 不保留、`<img>` 忽略、blockquote 退化为普通 bullet；D12 修订注已随本 ADR 采纳同步补入 ADR-0025。

---

## 术语表（Glossary）

| 术语 | 含义 | 备注 |
|------|------|------|
| External Paste Splitting（外部粘贴拆分） | 将来自外部应用的 `text/html` / `text/plain` 剪贴板内容，在 block 级上下文下解析为多个 comind block（段落/列表/标题层级还原），而非塌缩为单 block | ADR-0026 D1/D2/D4/D5/D6 |
| Block-level Paste Context（block 级粘贴上下文） | 有 block 被选中或聚焦（非编辑块内文本）时的粘贴场景；外部拆分与内部 block 粘贴均在此触发，行内光标粘贴不触发 | ADR-0026 D1/D8 |
| External Paste Parser（外部粘贴解析器） | 新增 `src/services/external-paste-parse.ts`：HTML 经 `DOMParser`+allowlist 净化后映射为 `BlockClipPayload` 森林；纯文本按 `\n` 拆分 | ADR-0026 D3/D4/D5/D6 |
| Clipboard Source Priority（剪贴板源优先级） | 外部粘贴时 `text/html` 优先于 `text/plain` 的取值规则 | ADR-0026 D2 |
