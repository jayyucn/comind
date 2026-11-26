# 0067 Markdown 外链 chip 与视图归属重构

- Status: accepted
- Date: 2026-11-25
- 取代: ADR-0066 的 D1（块类型与视图归属）、D2（URL 落点）、D5（默认视图）、D9（编辑边界）、D10（发现性入口）、D11（序列化）；D3/D4/D7/D8/D12 继续有效

## Context

ADR-0066 把链接做成独立的 `web-link` 块，四种视图都是它的 `format`。上线后的实际诉求是：链接/标题形态应当像普通文本一样参与行内编辑、跨块选区与正文流，而卡片/预览才需要独立块的展示能力。

CoMind 的正文解析链原本完全没有外链段生成：`[[https://…]]` 只在 `content_parse_service` 里产出 `is_external` 的 LinkDraft，但 `sync_links_for_block` 只入 internal links，渲染层的 `external_link` 段类型从未被生成过。也就是说「块正文里的外链 chip」是一个空位，不是既有能力。

Markdown `[标题](url)` 已在字段值的 mini-markdown 渲染里支持，但块正文走 `useContentRenderer` + Rust `renderSegments`，两条链互不相通。本决策把 markdown 外链接进正文链，并按「显示形态决定块类型」重新划分归属。

## 决策

### D1 链接/标题 = text 块正文里的 markdown chip；卡片/预览 = web-link 块

content 字面：`[标题](https://…)`，前后可夹普通文本。chip 是 text 块的**片段**，不是块；四视图仍是同一链接对象的可切换显示，但块身份随视图分组而变：

| 视图 | 块类型 | content |
|---|---|---|
| 链接视图 | `text` | `[URL](URL)`（显示文字=URL） |
| 标题视图 | `text` | `[标题](URL)`（显示文字=alias） |
| 卡片视图 | `web-link` | URL 原文 |
| 预览视图 | `web-link` | URL 原文 |

取代 ADR-0066 D1 的「一个块类型四视图」。理由：查询层读不到 `type`，但正文层读得到——把「像文本一样处理」的形态放回 text 块，跨块选区、搜索、导出自动受益，无需给 web-link 块单独补文本能力。

### D2 Rust 生成 external_link 段，前端只渲染标题

`render_segment_service` 直接扫描 `[标题](https://…)` 产出 `ExternalLink { start, end, url, display_text }`；段覆盖整个字面，`display_text` 是标题。外链不进 links 表（沿用现有约定），因此不走 link 查询路径。行内代码区间由 `inline_literal::visible_text` 掩成空白，代码里的 markdown 链接不出 chip。

前端 `useContentRenderer` 渲染 `<span class="block-link external web-link-chip" data-chip-url="…" data-chip-title="…">标题</span>`；`render-text` 的可见文本同步用 `display_text` 保持偏移换算一致。

segments 严格划分 content 的不变量不变；markdown 字面长 ≠ 可见长由既有的标记单元吸附处理，不新增换算规则。

### D3 视图切换 = 拆旧建新

chip → 卡片/预览：原 text 块拆成「前文本块 + web-link 块 + 后文本块」，前后为空则不建；切回时合并三段为一个 text 块，content 还原 `[标题](url)`。保留原块 id 给前文本（有子块/字段时跟着走），web-link 块与其后文本块新建。

卡片↔预览互通不拆块，只改 `format.link.view`（同一 web-link 块原地换形态）。

代价：视图切换不再是同一块的纯 format 变更，块身份会变；这是明确接受的取舍（换取「chip 形态是普通文本」）。

### D4 悬浮条是唯一入口，菜单按宿主分集

悬浮条紧贴 chip / 卡片块浮出，取代 ADR-0066 的 hover「显示为」面板与块入口菜单链接项：

| 宿主 | 菜单项 |
|---|---|
| chip（text 块） | 编辑链接、移除链接、视图切换下拉、复制原始链接 |
| 卡片/预览（web-link 块） | 视图切换下拉、复制原始链接 |

「编辑链接」是双输入框（显示文字 / 原始 URL）；chip 文字本身也可像普通文本一样直接编辑，等价于改 alias。

### D5 移除链接 = 只去链接关系，保留文字

`[标题](url)` → `标题` 明文，URL 丢弃，块仍是 text。该操作进撤销栈，Ctrl+Z 可找回。移除后「复制原始链接」不再有对象——菜单项由链接关系是否存在决定，不保留失效按钮。

### D6 粘贴与新落点

整段粘贴 URL：落在空 text 块上就地把 content 写成 `[域名](url)`，否则插入新 text 块；不再直接建 web-link 块。抓取成功后异步把域名 alias 换成网页标题；一旦 alias 被改过（当前文字既非域名也非 URL），重抓不再覆盖。

`/web` 斜杠命令与块菜单「转为网页链接」同样落 chip；后者服务存量裸 URL 的显式转换。

### D7 元数据与资源策略不变

抓取通道（Rust `fetch_web_link_metadata`）、本地 asset 化（favicon/封面）、抓取失败降级、全局开关、预览 iframe 的 CSP 与 sandbox 策略全部沿用 ADR-0066 D3/D7/D8/D12。

### D8 编辑态与读态同形：装饰隐藏语法字符，不改真源

编辑态用 TipTap/ProseMirror 装饰扩展扫描 `[别名](url)`：给 `[`、`](`、`url`、`)` 挂零宽透明样式与 `contenteditable=false`，只露别名；读态仍由 Rust 的 `external_link` 段渲染。文档内容一个字都不改，保存、撤销栈与 `inlineMarks` 偏移仍以完整字面为准。行内代码里的字面不装饰，与 D2 的掩白同口径。

键盘按「可见字」而非文档字符定语义：方向键跨过隐藏区；退格/删除只改可见别名一个字符，别名删空则整段 chip 消失；删除键在别名末尾跳过 chip 删右边第一个可见字。标题视图只改别名、URL 不变；链接视图直接打字同步改别名与 URL 两截，一旦不再像网址就拆掉隐藏 URL、只留输入的文字，且每次文档变化重扫，重新合法即重新成 chip。

悬浮条的编辑链接/移除链接在编辑态走 ProseMirror 事务就地改写，由常规 save 流程回写 store，保留光标与撤销栈；切卡片/预览会拆旧建新，先同步在途正文再走 D3。点击编辑态 chip 只落光标，不被 StarterKit 的 link mark 导航走。

## 已否决的替代方案

| 方案 | 否决理由 |
|---|---|
| 四个独立块类型 | 与正文流的文本操作不兼容，且查询层读不到 type |
| 一个 web-link 块 + format 切四视图（ADR-0066 D1） | 链接/标题形态拿不到 text 块的行内编辑与正文语义；本次明确改为按显示形态分块 |
| 扩展 `[[url|标题]]` 自绘语法 | 与 markdown 生态不兼容；标准 `[标题](url)` 已有字段侧渲染基础 |
| alias 存 format、content 只存显示文字 | 搜索/选区/导出拿到的是显示文字而非 URL，与「URL 是真源」冲突 |
| 视图切换原地换类型（不拆块） | 做不到 chip 前后夹普通文本；选择拆旧建新以保留正文顺序 |
| 移除链接后保留 URL 明文 | 选择保留标题文字、丢弃 URL（撤销可找回） |
| 悬浮条与旧 hover 面板/入口菜单并存 | 同一动作三处入口，菜单规则无法保证一致；悬浮条为唯一入口 |
| 编辑态用原子节点替换整段字面 | 保存要拼回字面、偏移与撤销需另设序列化；且原子内部不能直接打字，与 D4 的「chip 文字可直接编辑」冲突 |
| 编辑态只加 `contenteditable=false`、不加键盘护栏 | ProseMirror 的退格/删除走自身事务，不受浏览器 contenteditable 限制，仍会删掉隐藏字符写坏字面 |
| 按 URL 为 key 把别名存 format/字段值 | 一段正文可含多个链接，块级容器无法逐链接绑定；字段值还会污染全局字段定义与查询列 |

## 后果

### 改动面

| 位置 | 动作 |
|---|---|
| `crates/comind-core/src/types/page_with_blocks.rs` | `ExternalLink` 段加 `display_text` |
| `crates/comind-core/src/services/render_segment_service.rs` | 新增 markdown 外链扫描与段生成 |
| `src/wasm/types.ts` / `crates/pkg` | 段类型同步并重编 wasm |
| `src/composables/useContentRenderer.ts` | 外链 chip 只渲染标题，暴露 data 属性 |
| `src/services/render-text.ts` | 可见文本改用 `display_text` |
| `src/utils/web-link-chip.ts` | 新增：chip 字面读写单源 |
| `src/services/web-link-split.ts` | 新增：拆建计划纯函数 |
| `src/services/web-link-actions.ts` | 新增：编辑/移除/复制/拆建/alias 填充动作 |
| `src/composables/useWebLinkChipToolbar.ts` | 新增：悬浮条全局状态 |
| `src/components/Block/handlers/web-link/WebLinkToolbar.vue` | 新增：悬浮条与分集菜单、双输入框 |
| `src/components/Block/handlers/web-link/WebLinkBlock.vue` | 撤除旧 hover 面板与块入口菜单链接项，改驱动悬浮条 |
| `src/components/BlockList.vue` | chip 事件委托、粘贴落 chip、alias 异步填充 |
| `src/composables/useSlashCommands.ts` / `useBlockMenuActions.ts` | `/web` 与「转为网页链接」改落 chip |
| `src/extensions/WebLinkChipExtension.ts` | 新增：编辑态 chip 装饰、键盘护栏、链接视图输入同步 |
| `src/services/web-link-editor-actions.ts` | 新增：悬浮条在编辑态的就地改写与即时同步 |
| `src/components/Editor.vue` | 注册编辑态 chip 扩展，补零宽隐藏与光标样式 |

### 已知代价

1. 视图切换会变块身份（拆旧建新），反链/字段值不跨形态保留。
2. 菜单写入 chip 字面时方括号替换为全角替身；手动键入方括号仍可能破坏字面语法，导致 chip 拆解。编辑态的键盘护栏覆盖常见方向键/退格/删除与直接输入，IME 组合输入、跨 chip 拖拽选区尚未覆盖。
3. alias 自动填充只在仍是域名占位时发生，alias 被改过即锁定——永不自动更新到网页新标题。
4. `external_link` 段是新增解析路径，与字段值的 mini-markdown 渲染并存两套实现。

### 未做

- 编辑态 IME 组合输入与跨 chip 拖拽选区的边界语义。
- 卡片/预览视图下 chip 语法反向嵌入（一件链接两处显示）。
- 链接块进查询投影与字段化。
- 移动端悬浮条的触摸替代交互。
