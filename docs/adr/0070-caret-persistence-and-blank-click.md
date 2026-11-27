# 0070 光标持久化与空白点击语义

- Status: accepted
- Date: 2026-11-27
- 关联: ADR-0069 D4（外链打开后的光标归还，被本决策替代其登记机制）、ADR-0059（对称 pane）

## Context

点外链会把前台交给系统浏览器，本窗口失焦期间 Chromium 不渲染插入符；用户切回来若不先点一下，光标等于丢了。第一版方案（ADR-0069 D4 登记 + 回窗口补光标）在真机上不生效，实测根因是触发源全灭：

- DOM `window` focus/blur：在本机 WebView2 上整轮零触发（连最小化都不发 blur）。
- Tauri `tauri://focus` / `tauri://blur`（`onFocusChanged`）：同样零触发。事件管道本身完好（自发自收测试通过、监听器存活），是运行时在真实焦点变化时根本不广播。
- e2e（Playwright Chromium）里这些事件正常派发，因此单测与 e2e 全绿也测不出。

实测可靠的信号只有两个：`focusin`（编辑器聚焦时正常冒泡，可做记录），与 `pointerdown/pointerup`（用户点回应用必触发，不依赖焦点事件）。

同时确认了一个交互层面的矛盾：现状「点块外空白 = 取消块激活」（`handleMainClick` → `deactivateBlock`），与「光标始终聚焦在块上」正面相撞——只要点一次空白，光标就没了。

## 决策

### D1 光标始终聚焦在块上（两态同形）

应用内光标是持久资源：只要用户没有切换页面、没有激活其它 pane、没有用 Esc 显式退出，光标就属于上次编辑的位置。窗口失焦（浏览器抢前台 / alt-tab）回来后，插入符应当还原，不需要再点一次。

### D2 关闭「点块外空白取消激活」

删除 `handleMainClick` 的 `deactivateBlock()`（连同绑定）。点空白不再是退出编辑的手势。配套：

- 跨块选区/格选区的清除不在 `handleMainClick`，不受影响（已核实）。
- 点右栏仍保持激活（原 right-sidebar 例外随函数删除而消失，行为不变）。
- **Esc 补为唯一键盘退出出口**：BlockList 的 Esc 处理加第三级——格选区 → 跨块/文本选区 → 无选区时退出块激活（层层退出，与格选区分支同口径）。退出时顺带清除「上次编辑点」记录。

### D3 上次编辑点：常驻记录，混合方案

`editorStore.lastEditPoint`，`focusin` 捕获阶段常驻记录：

- `pm`：`{paneId, blockId, editor}`。字符偏移**信任 PM 内部选区**——实例活着时 `commands.focus()` 自还原到原字符位。不另记 pos：显式 pos 会随撤销/粘贴过期，成为第二份可能互相矛盾的真源。
- `input`：pane 内原生输入框记 `{el(WeakRef), selectionStart, selectionEnd}`，恢复时显式回设（input 内部虽也保留选区，显式设置跨浏览器一致）。**只记 pane 内的输入框**：顶栏全局搜索等无 pane 语境的输入不该被恢复抢回焦点。
- 按钮/面板等非可编辑聚焦不动记录。

作废由恢复门控隐式保证（块已不激活 / 元素已摘除 / pane 不匹配一律不恢复），显式清除只有 Esc 退出块激活一处。BlockModal 打开中恢复挂起（弹窗关闭后活动块已被 `deactivateBlock`，记录自然失效——这是已接受的边界，不做弹窗关闭后的重激活）。

### D4 恢复触发：pointerup 点击为主，焦点事件为辅

**点击路径（本机唯一可靠通道）**：`pointerdown` 记落点，`pointerup` 判定——左键、位移 ≤4px（与 ADR-0069 D4 外链打开、selection-geometry 跨块选区同口径）、抬起时选区折叠、落点在可恢复区。四道门全过才恢复。空白拖拽仍是跨块选区起手，互不干扰。

**焦点事件路径**：DOM `window` focus、Tauri `onFocusChanged`、`visibilitychange`（变 visible）——本机不发，但浏览器、e2e 与其它 WebView 环境受益，保留。要求「焦点真丢了」（`activeElement` 是 body）才补，不抢仍持有焦点的输入框。

**可恢复区**：落点不在 `.block`（块有自己的点击语义：读态点击激活、编辑态 native 落点）、不在 `.right-sidebar`、不在弹层（`.base-popover-overlay` / `.block-modal-overlay`）、非可编辑元素。

**pane 限定**：记录的 paneId 必须等于当前活动 pane。

### D5 已接受的代价

1. 本机 WebView2 不发焦点事件：alt-tab 回来**不点击就不会恢复**（无事件可用；第一次点击即恢复）。轮询 `document.hasFocus()` 可覆盖但被否决——300ms 轮询换一个低频场景不值。
2. 「点空白退出编辑」的旧习惯改为 Esc。
3. BlockModal 关闭后点空白不恢复（见 D3）。
4. 顶部 48px 死区、分隔条等非可编辑 chrome 上单击同样会把光标带回块（符合「始终聚焦」的字面语义）。

## 后果

- ADR-0069 D4 的登记机制（`requestCaretRestore` / 2 分钟时效 / 一次性消费）废弃删除，其「打开外链回来能接着敲」的目标由本决策的常驻恢复覆盖。
- 实现：`src/composables/useCaretPersistence.ts`（记录 + 三通道触发 + 让位矩阵），`stores/editor.ts`（`lastEditPoint` / `setLastEditPoint` / `clearLastEditPoint`），`BlockList.vue` Esc 第三级，`App.vue` 移除 `handleMainClick` 与旧 `handleWindowFocus`。
- 回归面：`useCaretPersistence.test.ts`（决策矩阵 11 例）、`editor.test.ts`、`useBlockEditorLifecycle.test.ts`、`tests/web-link-open.spec.ts`。
