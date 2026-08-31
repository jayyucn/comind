# ADR-0039: BlockModal 重构为「单块子树编辑器」

- 状态：已采纳（Accepted）
- 日期：2026-08-31
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

**D4 — bullet 点开弹窗，折叠改由 chevron 承担；两者在 Block 组件内并存。**
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

## 否决的备选（及理由）

- **抽公共 Overlay 容器合并 BlockModal 与 PageDrawer**：省代码 <30 行，违反 AGENTS.md「简约优先 / 不为一次性代码做抽象」。
- **大改 `useModalKeyboard` 语义区分「命令面板类 vs 编辑器容器类」**：单块子树编辑器本就该恢复键盘，删除一行注册即可，无需重构压制机制本身。
- **扩展 `BlockList` 接收 `rootBlockId` 渲染子树**：`BlockList` 强耦合页面级拖拽/选区/粘贴文档监听，泛化成本高且会引入页面级副作用；裸 `<Block>` + `buildSubtree` 复用 `<Block>` 既有递归渲染与内部键盘 handler，改动半径更小。

## 影响 / 风险

- `Block/index.vue` bullet 交互变更影响**主编辑器每一页**：回归点 = 折叠仍可用（chevron）、dot 点击开弹窗、文本选区拖拽不受影响（mousedown 在 content 区，不在 bullet）。
- `insertBlockAtCursor` / `useBlockEditorLifecycle` 改动被 `blockModalRootId` 注入门控，主编辑器路径零影响；需确保注入键拼写一致（`inBlockModal` / `blockModalRootId`）。
- 删除 `useModalKeyboardRef('block-modal')` 后，若未来有「不该被键盘压制的编辑器容器」复用此模式，需同样评估——本仓当前仅 BlockModal 一例。

## 验证

- 现有 `BlockModal.test.ts` 5 条契约测试全部通过（渲染根块、点击激活、页标题、关闭按需 deactivate、守卫不误清他人激活态）。
- 新增：子树渲染含 children；弹窗内 Enter 在根块建 child（新块 parentId === 根 id）；Esc 在斜杠菜单打开时不关弹窗。
