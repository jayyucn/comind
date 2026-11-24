# ADR-0038: BasePopover 接管锚点避让（anchorEl + placement）

- 状态：已采纳（Accepted）
- 日期：2026-08-28
- 范围：`src/components/common/BasePopover.vue` 定位契约扩展；调用方增量迁移（非强制）。
- 关联：扩展 ADR-0009 D8 的 `position:{x,y}` 薄封装契约；z-index 分层见 ADR-0032。

## 背景 / 问题陈述

`BasePopover` 当前（ADR-0009 D8）只收一个 `position:{x,y}` 点，仅做**视口边缘收边**（`Math.min/Math.max` 夹到 `EDGE_MARGIN`），**完全不知道输入框盒子在哪**。由此两类"遮住输入框"：

1. **调用方自传错点**：传锚点 `top/left`（如 `Editor` 的 `menuPosition`、`NamedViewBar` 的 `tabMenuPos`），面板左上角直接压在输入框上——属调用方 bug。
2. **垂直翻转 bug（更隐蔽）**：输入框贴视口底部、调用方传 `bottom + 4` 时，面板本该在下方，但首选侧放不下时 `Math.max(EDGE_MARGIN, vh - panelH - EDGE_MARGIN)` 把 `top` 夹到 `8px`，面板弹到视口顶部，**反而盖住输入框及中间一切**——根因是 `position` 路径无 side 信息，组件无从判断该往下还是往上。

"面板不遮蔽输入框"的职责边界不清：避让逻辑该内聚到 `BasePopover`，还是维持"薄封装、各自修调用方"？本 ADR 给出结论。

## 决策

**D1 — 避让职责内聚到 BasePopover。**
新增两个可选 prop：
- `anchorEl?: HTMLElement | (() => HTMLElement | null)`：触发元素（或返回元素的 getter，用于条件渲染的场景）。
- `placement?: 'bottom' | 'top' | 'left' | 'right'`，默认 `'bottom'`：首选放置侧。

**D2 — 锚点自测 + 首选侧定位 + 起点对齐 + 翻转 + 收边。**
当提供 `anchorEl` 时，组件用 `getBoundingClientRect()` 自测锚点盒子，按以下顺序定位：
1. 按 `placement` 首选侧放置，**起点对齐**（bottom/top → 面板左缘对齐锚点左缘；left/right → 面板上缘对齐锚点）—对齐策略写死、不暴露 prop。
2. 首选侧空间不足（溢出视口）→ **自动翻到对侧**（下↔上、左↔右）。
3. 翻到对侧仍放不下 → 再贴视口边收边（沿用 `EDGE_MARGIN`），与现有收边一致。
保证尽量不遮输入框，符合本次目标。

**D3 — 打开期间实时重定位。**
打开后监听 `scroll` / `resize`（window + 最近滚动祖先），锚点或视口变动即重算位置；关闭/卸载时清理监听，避免泄漏（沿用现有 `ResizeObserver disconnect` 的清理模式）。

**D4 — 旧 `position` 路径原样保留为兜底，本次不迁移。**
未传 `anchorEl` 时，行为完全不变（含其已知收边局限与"翻到顶部"bug）。本次**不修旧路径、不强制迁移任何旧调用方**——遵循"精准限定修改范围"。

**D5 — 事件驱动型调用方的接法（约定，非强制）。**
约 20 处调用方中，`PropertyDisplay` / `PropertyInline` / `QueryPageFrame` / `TableView`(`headerMenu`/`selectMenu`) 等在点击时从 `event.currentTarget` 现取盒子、无稳定 ref。接 `anchorEl` 时，调用方在点击处把 `e.currentTarget` 捕获进一个 ref 再打开弹层即可；是否迁移由各自按需决定。

## 否决的备选（及理由）

- **维持薄封装、各自修调用方**：20 处各自踩坑，无单一真相源，同类 bug 会反复出现。
- **传 `anchorRect` 而非 `anchorEl`**：需调用方自算盒子并传普通对象，解耦但重复样板；`anchorEl` 让组件自测、可复用既有测量思路。
- **纯 `auto` 最佳侧**：调用方失去"下方优先"表达力（芯片行习惯面板在下方）。
- **位置+对齐组合（'bottom-start' 等）**：过度灵活，API 过重，当前无此需求。
- **仅打开时算一次（不实时跟踪）**：滚动后弹层脱离输入框，体验回退。
- **可配置 `align` prop**：当前无需求，徒增 prop。
- **本次顺带迁移全部旧调用方 / 修旧路径收边**：超出范围，违背 D4 的精准修改原则。

## 后果

- 新弹层（及后续选择迁移的调用方）不再遮输入框，且滚动时跟随锚点。
- 组件内部新增锚点测量 + `scroll`/`resize` 监听逻辑；必须保证卸载/关闭时清理，否则泄漏。
- 事件驱动调用方接 `anchorEl` 需捕获元素 ref，属增量迁移成本。
- 旧 `position` 路径的"翻到顶部遮输入框"bug 仍存，直至对应调用方改走 `anchorEl`。

## 后续行动

1. 实现 D1–D3：新增 `anchorEl` / `placement` prop 与测量/翻转/实时监听逻辑，`position` 路径保持不变。
2. 为 `anchorEl` + 翻转 + 实时重定位补单测（参考 `BasePopover.test.ts`）。
3. 各调用方按需迁移到 `anchorEl`（非强制，不在本 ADR 范围）。

## 迁移记录

- **`SlashCommandMenu.vue`（2026-08-28，已迁移 + 端到端验证）**：首个迁移的调用方，因其锚点是 ProseMirror 光标——典型"光标贴视口底部时旧 `position` 路径被夹到 `top:8` 反而遮住编辑器"场景。
  - 锚点来源：触发时记录 `view`+`pos`，用 getter `anchorElProp` 经 `view.domAtPos(pos)` 实时反查光标所在元素（文本节点取其父元素）。未触发时返回 `undefined`，回退 `position` 模式。
  - `position` ref 保留：仍被下游 `showQuickPropertyEditor` / `openDateRefEditor` / `showSlashCommand` 复用，故 `BasePopover` 同时传 `:position`（首帧兜底）+ `:anchor-el` + `placement="bottom"`。
  - `anchorFromView` 用 try/catch 兜底（view 无 `domAtPos` 时返回 null → 回退 position 模式），保证旧测试 mock 不崩。
  - 验证：`SlashCommandMenu.test.ts` 新增用例确认触发后 `anchorView`/`anchorPos` 被记录、`anchorElProp` 为可反查光标的 getter、菜单正常渲染；全量 20 项测试通过。

## 实现后修正：翻转后仍遮挡锚点（2026-08-28）

初版翻转逻辑的缺陷：仅 `if (overflows(首选)) 翻对侧`，再统一 `Math.max(pos.top, EDGE_MARGIN)` 收边。
当面板比任一单侧可用空间都高（如 640px 菜单、锚点在视口中部）时，翻到上方后 `pos.top` 仍被夹到
`EDGE_MARGIN`，面板整体下移重新压住锚点——即「翻转之后还是遮挡调用方」。

修正（`BasePopover.vue` `panelStyle` 锚点分支）：
1. 先判定「首选侧是否在视口内且不与锚点重叠」，否则用翻对侧；两者都放不下时，**选可用空间更大的一侧**。
2. 放不下时不再盲目夹到视口边，而是**把面板高度/宽度裁剪到该侧可用空间内**（`maxHeight`/`maxWidth`），
   使面板底/右沿不越过锚点，从根本上杜绝遮挡。
3. 裁剪决策依据 `scrollHeight`/`scrollWidth`（内容真实尺寸，不受 maxHeight 影响），避免
   `ResizeObserver` 因高度变化反复触发、与定位计算形成抖动循环。

回归测试：`BasePopover.test.ts` 新增「面板高于两侧可用空间时翻到空间更大一侧并裁剪高度、不遮锚点」，
断言 `maxHeight=388px`/`top=8px`/`left=100px`（面板底沿 396 < 锚点顶 400）。BasePopover 9/9、SlashCommandMenu 12/12 通过。

### 迁移记录 #2：NamedViewBar 的 Tab ⋯ 菜单（2026-08-28）

`NamedViewBar.vue` 的 `openTabMenu(id, e)` 从 `e.currentTarget.getBoundingClientRect()` 取 `tabMenuPos`
传给 `BasePopover :position`——正是「旧 position 路径翻到顶部遮住 tab」的现存受害方。

- 新增 `tabMenuAnchor` ref，在 `openTabMenu` 内同步捕获 `e.currentTarget`（点击的 ⋯ 按钮，DOM 稳定）。
- `BasePopover` 调用改为同时传 `:position`（首帧兜底）+ `:anchor-el="tabMenuAnchor"` + `placement="bottom"`。
- `tabMenuPos` 保留作首帧兜底；旧 position 路径不动，行为兜底一致。
- 验证：`eslint` 0 error（仅文件既有的模板格式 warning）；无既有测试文件覆盖，端到端逻辑由 `BasePopover.test.ts` 锚点用例保障。

### 勘误：所谓「模块级共享状态」为误判（2026-08-28）

实现时曾标注 `resizeObserver`/`scrollTargets`/`onScroll` 为「模块级 `let`，并发弹层会互相干扰」。经判别测试验证此为**误判**：
`<script setup>` 顶层 `let`/`const`/`function` 均在编译后的 `setup()` 函数体内，每次组件实例化重跑，是**实例局部变量**，并非模块级共享。

`BasePopover.test.ts` 新增「两个并发实例各自注册独立 scroll 监听」用例：用 `vi.spyOn(window,'addEventListener')` 统计，
同时开两个实例时 `scroll` 注册次数 `>=2`（若真共享则第二个实例 `attachListeners` 会因 `if (onScroll) return` 早退、仅 1 次）。测试通过，证明确无跨实例干扰。

结论：无需实例化解；该用例转为回归守卫——日后若有人误将这些变量提到模块作用域，测试会立刻失败。

### 迁移记录 #3：批量迁移旧 position 调用方（2026-08-28）

把 ADR-0009 遗留的 `:position` 调用方迁到 `anchorEl` 避让模式，分两类：

**事件驱动型（点击时 `e.currentTarget` 即稳定锚点，捕获进 ref）——**
- `CodeMirrorEditor.vue` 语言菜单：复用既有的 `langButtonRef` 作 `:anchor-el`，`placement="bottom"`。
- `TableView.vue` `selectMenu` / `headerMenu`：新增 `selectMenuAnchor` / `headerMenuAnchor` ref，在 `openSelectMenu` / `openHeaderMenu` 内捕获 `e.currentTarget`，`placement="bottom"`。
- `QueryPageFrame.vue` 字段面板：新增 `fieldsPanelAnchor`，原 `position` 用 `x:r.right`（面板在按钮右侧），故 `placement="right"`（horizontal 意图保留）。
- `NamedViewBar.vue` Screen 下拉：复用既有 `screenTriggerRef` 作 `:anchor-el`，`placement="bottom"`（顺带，与 tabMenu 同文件）。

**光标坐标型（ProseMirror 文本位置 → 穿透中间组件）——**
- `Editor.vue` 的 `menuPosition` → `PageLinkMenu`：锚点是光标，无 DOM ref。在 `editorEvents.ts` 的 `handleWikiLinkTrigger`（握有 `view`+`position`）用 `view.domAtPos(position)` 反查光标元素，存入新增 `ctx.menuAnchorEl`；
  `EditorEventCtx` 接口新增 `menuAnchorEl: Ref<HTMLElement | null>`（测试 stub 同步补 `ref(null)`）；
  `Editor.vue` 新增 `menuAnchorEl` ref 并塞进 ctx、传给 `<PageLinkMenu :anchor-el>`；`PageLinkMenu.vue` 新增 `anchorEl?` prop 透传给 `BasePopover`，`placement="bottom"`。

**未迁移（父组件持有 position 并向下透传，迁需穿透中间层，超出本次范围）：**
`CalendarPopover` / `DateRefKindSelector` / `DateTimePickerPanel` / `PropertyQuickEditor` / `RelationshipMenu` / `QueryChipBar`（→ ConditionPopover/FieldSelectMenu/GroupMenu/SortMenu）。这些的锚点归属父组件，要根治需父级传 `anchorEl`，留待后续按需处理。

**验证：** 全部相关测试通过——`BasePopover` 10、`editorEvents` 13、`PageLinkMenu`、`CodeMirrorEditor` 30、`TableView` 55、`Editor` 39（共 167）。`eslint`：本次改动**未引入新 error**（仅修掉一处 `no-useless-assignment`）；既有 `any`/`_event` 报错均在未触碰代码，与迁移无关。

## 实现后修正：光标型锚点改用视口矩形（D1 修订，2026-11-11）

**问题**：`SlashCommandMenu` 原以 `view.domAtPos(pos)` 反查光标所在元素作锚点。ProseMirror 在文本位置边界返回的是**整行段落元素**（`<p>`），其 `getBoundingClientRect()` 是整行盒子，`left` 固定在行首而非光标 x。面板首帧走 `position` 点模式（`coordsAtPos` 精确坐标）位置正确，`nextTick` 切到锚点模式后被横向钉到内容区左缘；空块时行首≈光标，仅在已有文本后输入 `/` 才暴露。

**决策**：`anchorEl` 联合类型扩展为 `HTMLElement | DOMRect | (() => HTMLElement | DOMRect | null)`。DOMRect 形态供「锚点没有稳定 DOM」的调用方使用：由调用方实时给出锚点视口矩形，`BasePopover` 直接把它作为 `anchorRect`，不再调用 `getBoundingClientRect()`。区分元素与矩形用鸭子类型（数值 `left`/`top`），不依赖 `instanceof`，跨 realm 安全。

- 元素锚点路径行为不变：仍自测 `getBoundingClientRect()`、挂最近滚动祖先、非模态外部点击用 `contains` 判定。
- 矩形锚点没有 DOM 祖先可挂；`window` 的 scroll 监听本就用 capture 阶段，能接住任意后代滚动，配合 `onLayoutChange` 完成实时重定位。
- `SlashCommandMenu` 改为用 `view.coordsAtPos(pos)` 构造 `0×0` 光标点矩形，getter 每次重算，滚动/布局变化时面板精确跟随光标；取坐标失败时返回 null，回退 `position` 点模式。

**后果**：面板横向贴在光标处，保留 D2 的避让/翻转/收边与 D3 的实时重定位；其他调用方无需改动。

**回归网**：`tests/slash-menu-anchor-position.spec.ts`（已有文本后输入 `/`，断言面板 x 明显大于段落行首）、`BasePopover.test.ts`（矩形锚点定位 + resize 实时重算 + 非模态外部点击）、`SlashCommandMenu.test.ts`（锚点为 0×0 光标矩形）。

## 实现后修正：锚点来源必须是用户可见的编辑器（D1 补充，2026-11-11）

**问题**：面板先正确弹出，随即整体跳到视口左上角。实测坐标序列：面板 `left/top` 由 `655.359 / 238.891` 在数帧内变成 `8 / 8`（收边后 `EDGE_MARGIN` 的边界值）。

根因不在坐标换算，在**锚点来源**。同一 pane 的多个 tab 视图不卸载非活动 tab，只把它置为 `display:none`，其中的 Block / 编辑器组件照常挂载、照常响应全局 `activeBlockId`。`isActive` 的 pane 作用域护栏只区分 pane，不区分同 pane 内的多个 tab，于是两个 tab 里的同源块都被判成 active；隐藏那份的编辑器会随正文同步走到 `/` 右侧，用 0 尺寸的 DOM 触发 `slash-command-trigger`。它的 `coordsAtPos` 恒返回 (0,0)，覆盖掉可见编辑器刚设好的锚点。实测该事件序列为 `[642×22 @ 655] → [642×22 @ 655] → [0×0 @ 0]`。

同一缺陷还有第二个面：隐藏编辑器会抢先执行 `setActiveEditor`，使全局 `activeEditor` 指向一份看不见的实例。斜杠命令的 `syncQuery` / `bindEditorUpdate` 都以它为源，于是「输入 `/t` 不过滤列表」「回车读不到命令文本」—— 同一根因的连带症状。

**决策**：不可见的编辑器不得成为锚点来源，也不得成为活动编辑器。

- 新增 `utils/element-visibility.ts` 的 `hasHiddenAncestor(el)`：自身或任一祖先 `display:none` / `visibility:hidden` 即判隐藏。刻意不用「尺寸是否为 0」——jsdom 不布局、任何元素都报 0，那会把测试与尚未完成布局的正常挂载一并误杀。
- `SlashCommandMenu` 收到触发事件后先判来源：隐藏容器里的编辑器、已脱离文档的 DOM 一律丢弃，不覆盖现有锚点。测试替身没有 `view.dom` 时按可信处理，保持旧行为。
- `Block.focusActiveEditor` 登记 `setActiveEditor` 前过同一判据。

**后果**：面板全程贴住光标，不再产生第二次坐标；斜杠命令的过滤与命令文本回读恢复正常。非活动 tab 里的编辑器仍会挂载（本轮未改 `isActive` 的可见性口径），只是不再产生副作用。

**回归网**：`SlashCommandMenu.test.ts`（隐藏容器实例的重复触发被丢弃，锚点仍停在光标处）、`Block/index.test.ts`（`display:none` 容器内的编辑器不登记 activeEditor）。
