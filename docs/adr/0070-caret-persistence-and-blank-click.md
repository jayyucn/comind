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

1. （已被 D6 覆盖）本机 WebView2 不发 DOM 焦点事件的问题，由 D6 的 Tauri 窗口事件路径 + 焦点链自愈解决。轮询 `document.hasFocus()` 仍被否决——300ms 轮询换一个低频场景不值。
2. 「点空白退出编辑」的旧习惯改为 Esc。
3. BlockModal 关闭后点空白不恢复（见 D3）。
4. 顶部 48px 死区、分隔条等非可编辑 chrome 上单击同样会把光标带回块（符合「始终聚焦」的字面语义）。

### D6 WebView2 焦点链卡死自愈（桌面端）

真机取证：打开外链把前台让给浏览器后，本机 WebView2 的 Chromium 焦点认知被冻结——DOM focus/blur 零广播、`activeElement` 停在旧元素上、`document.hasFocus()` 恒 true；窗口重新激活时键盘焦点不会回到 webview 子 HWND，键盘事件全部丢失（0 个 keydown 到达页面，连 `document` 捕获层都没有）。D4 的焦点事件路径在本机因此失效，且键盘整体不可用远重于「光标不恢复」。

决策：桌面端在 Tauri `onFocusChanged`（Rust 侧窗口事件，实测可达）上做焦点链自愈——抖动平息后（拖尾 debounce 120ms）调用 `getCurrentWebview().setFocus()`（映射 WebView2 `MoveFocus(Programmatic)`，官方解法），同时维持 D4 的 `tryRestore({ requireLostFocus })`。MoveFocus 只动 Win32 键盘焦点链，不改页内 DOM 选区 / activeElement。

两个必须处理的实测约束：

1. **激活抖动串**：窗口重新激活时 WebView2 抛出一串 focus↔blur 抖动（85ms 内 4 条、以 blur 收尾）。kick 必须等抖动平息后拖尾补出——在串中第一个 focus 上即踢会被收尾 blur 打回。
2. **MoveFocus 自激反射**：kick 会反向触发 GotFocus/LostFocus 合成事件（focus↔blur 每 ~6ms 一对、无限循环，输入法工具栏持续闪烁）。kick 后设 800ms 冷却期；冷却内按 200ms 反射带区分——带内事件（实测反射延迟 0~130ms）视为自激反射吞掉，带外事件视为真实抖动、推迟到冷却期满 + SETTLE 补踢。快速 alt-tab 往返落在冷却内也不丢自愈。

已否决提案存档：

- 每个 focus 事件直接 kick——自激死循环，且 kick 在抖动串中被收尾 blur 打回，键盘仍死。
- 纯死人间隔判别（距上次 blur ≥600ms 才 kick）——抖动串以 blur 收尾，串首 kick 被打回，键盘仍死。
- 窗口抢前台（AttachThreadInput 强制置前）——强制抢占系统前台侵入性过强，撤回。

后果：

- capabilities 新增 `core:webview:allow-set-webview-focus`（`default.json` / `mobile.json`，自愈代码在所有 Tauri 平台分支内运行）。
- 实现：`useCaretPersistence.ts` Tauri 分支（拖尾 debounce + 冷却 + 反射带）。
- 真机验证：修复后 59 个真实 keydown 到达页面、13 分钟窗口切换 35 条焦点事件全为人级间隔、无自激对、输入法不闪。

### D7 底部留白：末尾空块与单击落光标

**不变量**：每页根级末尾恰有一个空块（`parentId` 指向页面根块、`content` 为空、恒为普通段落）。

- **补齐时机**：页面数据就绪后（末块非空则补一个）；末块由空转实后立即补。
- **允许删除**：删掉后再次补齐。补齐不产生撤销步骤——`absorbTrailingBlock` 只把该块并入栈顶快照，不新增一步，否则撤销一次会截断 redo 分支，且第一下 Ctrl+Z 撤掉的是一个凭空出现的空块。
- **不继承 `ol`/`ul`**：有序列表的序号是 content 字面前缀，空块若参与列表，序号写回会把它变成非空，进而反复触发补齐。

**单击语义**：`.block-root-list` 的底部 padding 整片可命中（原 `.page-body` 的 `space-6` 间距下移为 `.backlinks-panel` 的 `margin-top`，使留白连成一片）。单击时：

- 只有 `e.target` 是根容器自身才接管——块正文、表格、查询视图、入口胶囊内部不抢；
- 光标落到末尾空块（`activateBlock(id, 1)`）。

**与 D2 / D4 的关系**：D2 已取消「点块外空白退出激活」，留白因此没有既有语义可冲突；D4 的指针恢复把 `.block-root-list` 排除在可恢复区之外，避免与落光标竞争同一次点击。

**布局前提**：根容器类名 `.block-root-list` 必须与列表行 `.block-list` 分离。同名时全局列表行样式（`display: flex` + `align-items: baseline`）会把根容器当行渲染，底部留白与被压成 0 宽，`elementFromPoint` 永远取不到，单击与末尾空行同时失效，且 `baseline` 会把正文整体下推。

已否决提案存档：

- 纯虚拟渲染行（不落库，点击时才实体化）——无法在中文输入法下可靠工作：组合输入期间字符未定稿，此时创建块并转发字符，光标与候选词位置难以对齐。
- 顶部拦首字符再建块——同属接管组合输入，风险同上。
- 末尾空块继承列表格式并续号——见上「不继承」的成因。

后果：

- 每页多一个空块；Rust 侧 Markdown 导出会在文件末尾多一个空行（未做裁剪）。
- 查询投影已有空卡片过滤（`excludeEmptyCards`）、TOC 只取标题块，二者不受影响。
- 回归面：`BlockList.selection-orchestration` / `keyboard-delete` / `undo-redo` 的夹具显式补末尾空块，块集合断言按新语义取值。

## 后果

- ADR-0069 D4 的登记机制（`requestCaretRestore` / 2 分钟时效 / 一次性消费）废弃删除，其「打开外链回来能接着敲」的目标由本决策的常驻恢复覆盖。
- 实现：`src/composables/useCaretPersistence.ts`（记录 + 三通道触发 + 让位矩阵），`stores/editor.ts`（`lastEditPoint` / `setLastEditPoint` / `clearLastEditPoint`），`BlockList.vue` Esc 第三级，`App.vue` 移除 `handleMainClick` 与旧 `handleWindowFocus`。
- 回归面：`useCaretPersistence.test.ts`（决策矩阵 11 例）、`editor.test.ts`、`useBlockEditorLifecycle.test.ts`、`tests/web-link-open.spec.ts`。
