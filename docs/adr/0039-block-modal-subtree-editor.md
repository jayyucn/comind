# ADR-0039: BlockModal 重构为「单块子树编辑器」

- 状态：已采纳（Accepted）。D4 的「主编辑器 dot 开弹窗」被 D9 取代（2026-11-21）；D9 里 dot/图标两套入口外观被 D10 取代（2026-11-21）；D1–D3、D5–D8 仍然有效。
- 日期：2026-08-31（D9、D10 修订：2026-11-21）
- 范围：`src/components/Block/BlockModal.vue`、`src/components/Block/index.vue`（bullet 交互）、`src/composables/useBlockTree.ts`（buildSubtree）、`src/stores/blocks.ts`（insertBlockAtCursor）、`src/stores/editor.ts`（blockModalBlockId）、`src/components/TaskHub/TaskHub.vue`。
- 关联：模态键盘压制栈见 `src/composables/useModalKeyboard.ts`；激活机制见 `src/stores/editor.ts`；z-index 分层见 ADR-0032。
- 触发：grill-with-docs 对 `重构 BlockModal.vue 功能` 的刨根问底，锁定方向后落盘。

## 背景 / 问题陈述

`BlockModal` 原是「任务中心四象限卡片点击后弹出的单 block 编辑弹窗」，做法是用 `buildTree` 的合成单节点树（`children: []`）直接渲染 `<Block>`，**绕过 `BlockList`**。由此暴露三类问题：

1. **只显示单块**：`children: []` 导致子块（子任务、备注、检查项）完全不可见、不可编辑——而任务几乎必然有子项。
2. **键盘被自己关掉**：组件注册了 `useModalKeyboardRef('block-modal', visible)`，使 `hasModalOpen()` 在弹窗期间恒为 true；`EnterAsBlockExtension` 内 15 处 `if (hasModalOpen()) return false` 因此全部早退，**Enter/Tab/方向键全部退化**为 TipTap 单块默认行为。该机制本为「斜杠命令面板那类浮层」设计，被一个**编辑器容器**复用了。
3. **手写补丁**：`onBodyClick` 补激活、`setTimeout` + `window.dispatchEvent('navigate-to-block')` 跨组件通信，都是绕过既有机制的旁路。

同时产品上希望**统一入口**：列表/看板/日历卡片、以及主编辑器里的 bullet 点，都应能打开这个弹窗。

## 决策

**D1 — 语义定为「单块子树编辑器」（subtree editor），而非表单或迷你页面。**
弹窗以被点 block 为**根**，渲染其**完整子树**（根 + 所有后代），子块可见、可编辑。
- 否决「表单（仅根块）」：与任务必有子项的现实冲突，且会让"子块不显示"成为缺陷而非设计。
- 否决「迷你页面（含新建兄弟块）」：`createBlock` 在该语境下语义歧义——弹窗看不到兄弟，用户建出的根级兄弟块会当场消失在视野外，无解。

**D2 — 退出模态键盘压制栈。**
删除 `BlockModal` 中的 `useModalKeyboardRef('block-modal', visible)`。删除后 `hasModalOpen()` 仅在**真正嵌套的浮层**（斜杠菜单 `slash-command`、关系菜单 `relationship-menu`、wiki-link 菜单、block 选择器等**自身已注册模态**）打开时为 true，编辑器键盘行为正确：
- 弹窗内无浮层 → Enter=拆分/新建、Tab=缩进、方向键=跨块移动光标，全部生效；
- 弹窗内打开斜杠菜单等 → 这些浮层自己 push 了模态，`hasModalOpen()` 仍为 true，Enter 被正确压制，不冲突。
代价与对应处理见 D5。

**D3 — 打开即自动激活根块并聚焦光标。**
`blockId` 变化时 `loadBlock` 后 `editorStore.activateBlock(rootId, 1)`，免去「先点一下才能编辑」。子块点击仍由保留的 `onBodyClick` 补激活（该逻辑即现有契约测试的验证对象，保留）。

**D4 — bullet 点开弹窗，折叠改由 chevron 承担；两者在 Block 组件内并存。（主编辑器部分已被 D9 取代）**
- `.block-bullet` 内 `bullet-dot` 点击 → `editorStore.openBlockModal(blockId)`（主编辑器语境）；
- 有子块时 `bullet-chevron` 显示在 dot **左侧、hover 才显现**，`@click.stop="toggleCollapse"` 负责折叠/展开；
- 弹窗内（`inject('inBlockModal') === true`）dot 点击为 **no-op**（避免递归开弹窗）。
- 主编辑器现有「点 bullet 折叠」手势被此拆分取代：折叠仍在（chevron），但默认态仅显示 dot，更贴近主流块编辑器习惯。

**D5 — Esc 守卫嵌套浮层。**
`BlockModal` 的 `onKeydown` 改为：`if (e.key === 'Escape' && visible) { if (hasModalOpen()) return; close() }`。即 Esc 先让**嵌套浮层**（其自身已注册模态、`hasModalOpen()` 为 true）消费，仅当无任何浮层打开时才关闭弹窗。这是 D2 删除 block-modal 注册后必须补的一处——否则弹窗内打开斜杠菜单再按 Esc 会连弹窗一起关掉。

**D6 — 子树根的 Enter 强制建 child，不建根级兄弟。**
`insertBlockAtCursor` 新增 `opts.forceParentId`：当调用方传入（仅限弹窗根块）且当前块无展开子节点时，`newParentId` 取 `forceParentId`（= 根块自身 id），使新块成为根的子块，留在可见子树内。
`useBlockEditorLifecycle` 注入 `blockModalRootId`（由 `BlockModal` 通过 `provide` 下发）：`handleSplit` 在 `blockId === blockModalRootId` 时传 `forceParentId`；`handleOutdent` 在同条件下 **no-op**（防止根块被 outdent 逃出子树成为页面根兄弟）。
**主编辑器因无 `blockModalRootId` 注入，行为完全不变**（forceParentId 为 undefined，走原分支）。

**D7 — 弹窗控制提升为 store 级，统一多入口。**
`editorStore` 新增 `blockModalBlockId` ref + `openBlockModal(id)` / `closeBlockModal()`。`TaskHub` 的局部 `drawerBlockId` ref 移除，改用 store 值；主编辑器 bullet（D4）与四象限卡片（`@open-block`）均经同一 `openBlockModal`，入口收敛。

**D8 — PageDrawer 保留，两层入口并存。**
`PagesLibrary.vue` 等处仍用 `PageDrawer`（整页上下文 / 跳转来源）。语义分界线：**「改这一条」用 BlockModal（子树），「看整页/跳转来源」用 PageDrawer（整页）**。两者不合并、不抽公共 Overlay（两份壳子各 ~130 行，抽公共容器省不下 30 行，属一次性代码不必要抽象）。

**D9 — 入口菜单覆盖全部块类型；主编辑器不再从 bullet 打开 BlockModal（取代 D4 的主编辑器部分）。**

D4 把 dot 定为「开弹窗」的唯一手势，前提是「卡片只能显示单块」。该前提在主编辑器里不成立：整页子树本来就全量可见，弹窗等于把眼前内容再弹一遍；而 dot 是唯一的可点入口，被弹窗占着，文本类块就一直没有任何鼠标可达的结构操作（上方插入 / 清空 / 删除）。D9 改为：

1. **入口语义统一**：`.block-bullet` 的 dot 与类型图标点击都是「打开本块菜单」，不再按块类型分裂。
2. **菜单归外壳**：`Block/index.vue` 持有 `BasePopover` 与通用段（`BlockMenuCommon`）。类型专属项由 handler 经 `useBlockEntryMenuExtra` 注册 —— `render(close)` 交出菜单项、可选 `afterPaste` 交出粘贴收尾。表格交「首行表头 / 均分列宽」，查询块只交 `afterPaste`。
   - 否决「把表格状态上提 store」：为一个开关搬动 2900 行组件的表内状态，回归面远大于收益。
   - 否决「每个 handler 各加 `openEntryMenu`」：四个无菜单的 handler 要连带改 editor/render 共 8 个组件，且入口仍分裂成两套 popover。
3. **通用段单源**：项序与分组只在 `BlockMenuCommon` 定义，所有块类型共用；没有专属项时传 `noDividerTop`（不传会出现菜单顶部一条没头没尾的线）。
4. **「重置为文本块」改名「清空」**：动作不变（删块 + 原地新建空块，级联软删子树，一步撤销兜底）。文案描述用户意图而非类型实现 —— 用户不关心它是什么块。已接受的代价：清空带子块的块会连子块一起没，清空表格块会连表格数据一起没。
5. **主编辑器不再有 BlockModal 入口**（dot 不再调 `openBlockModal`）。弹窗在**任务中心卡片、查询结果「内容」列、标签聚合卡片、Ideas 快照、字段设置**保留：那些表面的块只有一行摘要，弹窗仍是唯一就地编辑手段。
6. **弹窗内 dot 保持 no-op**（`inBlockModal` 未变）：子树根有 D6 的「禁 outdent / Enter 建子块」特例，菜单搬进去要另裁一套可用性规则，不在本次范围。
7. **空块 dot 保持默认隐藏**（hover 或块激活才现）；dot 去掉 `title` —— 点它就直接展开菜单，不再多一层提示。

配套：启动核销 `cleanup_orphan_screen_views` 增加「活命名空间已有行 ⇒ 丢弃孤儿」判据。否则「撤销复活 → 用户重新配了视图 → 下次启动把孤儿挂回」会在同一个 `query-block:<id>` 下并出两组 Screen。回收站里的查询块在核销中仍按「不存在」处理（配置随重启丢弃），与「清空 = 配置丢弃」同一取舍。

**D10 — 入口统一为「类型字形 + 拖拽握把」胶囊，外壳不再渲染 bullet dot（取代 D9 第 1、7 条中关于 dot 的部分）。**

D9 之后入口仍有两套外观：table/query 是 hover 才现的类型图标，其余类型是常显的 6px 圆点。同一列里显现时机与尺寸都不一致，读起来像两个控件；文本类块也没有任何类型标识。D10 统一为：

1. **单一胶囊**：`.block-bullet` 内恒渲染一个 `.block-entry-icon`，内容为类型字形 + `GripVertical` 握把。字形由 handler 的 `entryIcon` 给出（bullet→`Type`、code→`Code`、image→`Image`、embed→`Layers`、table/query 沿用原图标），缺省落文本字形。胶囊同时承担三件事：类型标识、点击开菜单、按下即拖拽（手柄仍是整格 `.block-bullet`）。
2. **显现时机统一**：所有块类型（含空块）都是 hover 块时才现。随之删除 `hide-empty-bullet` 及其判空链（`isEmptyBlock` / `siblings` / `isEdgeInLevel` / `hideBulletForEmpty`）——「空块一排圆点」的问题随 dot 下线消失。
3. **几何**：入口格仍是 20px（布局基准，正文起点由它决定），胶囊 24px 向左悬出 4px，右缘贴住入口格右缘。悬出的 4px 落进缩进槽 / 页边留白（`.main-content` 左内边距 24px）。表格角块把胶囊高度收到 12px 并去掉上下边框，命中面严格等于角块，不压首行条。
4. **chevron 让位**：折叠箭头从 `left: -16px` 移到 `-24px`，避免与胶囊左缘（-4px）重叠；深度 0 时该位置正好是正文容器的左内边距边缘。
5. **dot 保留但不进编辑器**：`.bullet-dot` 基础样式留给 Backlinks / Ideas 快照 / embed 子块（纯展示圆点，各自覆写 hover 与 cursor）。

已否决：**把入口格加宽到能容纳参考比例的胶囊**（约 34px）——正文整体右移，且打碎表格「入口格即表格左侧 gutter、行列条带压在格的右半」的角块几何，抬层让位那套逻辑随之失效，代价与收益不成比例。已否决：**常显 dot 与 hover 图标并存**——同列两种显现时机，正是本次要消除的不一致。

## 否决的备选（及理由）

- **抽公共 Overlay 容器合并 BlockModal 与 PageDrawer**：省代码 <30 行，违反 AGENTS.md「简约优先 / 不为一次性代码做抽象」。
- **大改 `useModalKeyboard` 语义区分「命令面板类 vs 编辑器容器类」**：单块子树编辑器本就该恢复键盘，删除一行注册即可，无需重构压制机制本身。
- **扩展 `BlockList` 接收 `rootBlockId` 渲染子树**：`BlockList` 强耦合页面级拖拽/选区/粘贴文档监听，泛化成本高且会引入页面级副作用；裸 `<Block>` + `buildSubtree` 复用 `<Block>` 既有递归渲染与内部键盘 handler，改动半径更小。

## 影响 / 风险

- `Block/index.vue` bullet 交互变更影响**主编辑器每一页**：回归点 = 折叠仍可用（chevron）、入口胶囊点击开菜单（D9 起不再开弹窗）、文本选区拖拽不受影响（mousedown 在 content 区，不在 bullet）。
- `insertBlockAtCursor` / `useBlockEditorLifecycle` 改动被 `blockModalRootId` 注入门控，主编辑器路径零影响；需确保注入键拼写一致（`inBlockModal` / `blockModalRootId`）。
- 删除 `useModalKeyboardRef('block-modal')` 后，若未来有「不该被键盘压制的编辑器容器」复用此模式，需同样评估——本仓当前仅 BlockModal 一例。
- D9 之后，菜单的开关状态只在 Block 外壳一处；handler 卸载（含两态重挂载、双 pane 同页）必须按实例身份注销专属段，否则会把另一份还在用的注册删掉。

## 验证

- 现有 `BlockModal.test.ts` 5 条契约测试全部通过（渲染根块、点击激活、页标题、关闭按需 deactivate、守卫不误清他人激活态）。
- 新增：子树渲染含 children；弹窗内 Enter 在根块建 child（新块 parentId === 根 id）；Esc 在斜杠菜单打开时不关弹窗。
- D9/D10：`Block/index.test.ts` 锁「点入口胶囊出通用段菜单且不再调 `openBlockModal`」「弹窗内入口胶囊仍是 no-op」；`useBlockEntryMenuExtra.test.ts` 锁注册/身份化注销；e2e `tests/block-entry.spec.ts` 锁文本块菜单项序与「无 `.block-modal-overlay`」；Rust `filter_service_test.rs` 锁核销「活命名空间被占用时丢弃孤儿」。

