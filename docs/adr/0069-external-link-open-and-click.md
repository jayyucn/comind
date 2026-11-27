# 0069 外链打开通道与点击语义

- Status: accepted
- Date: 2026-11-27
- 关联: ADR-0067（正文 markdown 外链 chip）、ADR-0059（对称 pane）

## Context

正文外链 chip、Backlinks、Ideas 快照、web-link 卡片、字段值 url 与字段 richtext 里的 markdown 锚点，六处各写一份 `window.open(url, '_blank', 'noopener,noreferrer')`。浏览器里正常，桌面端点了**完全没反应**。

根因在内核层：wry 0.55 的 WebView2 分支在宿主未挂 `new_window_req_handler` 时，对 `NewWindowRequested` 直接 `args.SetHandled(true)` —— 新窗口请求被静默取消。本项目既没有 `tauri-plugin-opener`，也没有 `on_new_window` 处理器，所以 `window.open` 与真正的 `<a target="_blank">` 都打不开。浏览器环境（vite dev / Playwright）走的是原生新标签页，因此 e2e 永远暴露不出这个缺陷。

另一个选项是在建窗时挂 `on_new_window` 统一接管：技术上可行（tauri 2.11 提供 `WebviewWindowBuilder::from_config` 与 `NewWindowResponse`），但本项目主窗口与 `reader-*` 全部在 `tauri.conf.json` 声明、由 Tauri 自动创建，接管需要把建窗搬进 Rust `setup`，`decorations`/`transparent` 等配置出现两份真源。为一个打开外链的动作引入配置双写不划算。

## 决策

### D1 单点收口 `openExternalUrl`

`src/utils/external-link.ts` 是唯一入口：Tauri 环境动态加载 `@tauri-apps/plugin-opener` 的 `openUrl`，交给系统默认浏览器（Windows ShellExecute、Android Intent、iOS openURL）；非 Tauri 环境回落 `window.open`，保住浏览器与 e2e 的原生语义。

六处调用点全部改走它：正文读态 chip（`useBlockEditorLifecycle`）、Backlinks、Ideas 快照、web-link 卡片、字段值 url、字段 richtext 锚点。

选插件而不是自定义命令，是因为项目已有 Android/iOS 目标（`mobile.json`、`android:dev` / `android:build:apk`、barcode-scanner），`opener` crate 桌面专用，自定义命令会在移动端留一个缺口。

### D2 锚点兜底在 App 捕获阶段

字段 richtext 与阅读器里由 markdown 渲染出的 `<a target="_blank">` 走浏览器原生导航，不经任何 JS 调用点。`App.vue` 在 document 捕获阶段拦截 http(s) 锚点改道 `openExternalUrl`，**只在 Tauri 环境生效**——浏览器里原生新标签页语义最完整，接管只会多一层噪音。

自身已经处理点击的锚点（字段 url 特化）标 `data-external-handled`，兜底直接跳过，避免一次点击打开两遍。

### D3 协议白名单与失败策略

只放行 `http(s)`：`javascript:` / `file:` / `tauri:` 不进系统打开器。打开失败只 `console.error`，不弹提示——外链打不开是环境问题（无默认浏览器、系统拒绝），提示比不打开更吵。

### D4 点击协议：按下落光标，抬起才打开

读态与编辑态同一套语义：`mousedown` 记录目标 chip 的 URL 与落点，`mouseup` 四道门全过才打开——左键、位移 ≤ 4px、抬起时选区为空、按下落在**可见别名**上。

三个实现约束：

- **URL 必须在 mousedown 就取到**。读态一激活块，`BulletRender` 就被换成 `Editor`，`click` 的 target 会退到公共祖先，那时已经找不到 chip。这也是旧实现「`.block-link` 在 mousedown 一律提前 return」存在的原因；外链 chip 现在放行到激活路径，wiki link 等其余 chip 维持一步跳转。
- **隐藏语法格不算点链接**。编辑态里 `[`、`](url)` 两截零宽 span 也挂着 `.web-link-chip`，它们与可见别名像素重合；`target.closest('.pm-prefix-hidden')` 命中即不登记，点那里就只落光标（`handleClick` 的既有映射）。
- **`click` 不再打开**。打开动作上移到 `mouseup` 后，`handleContentClick` 里的 `data-external` 分支必须删除，否则一次点击会打开两遍；wiki link 的页面导航仍在 `click`。

读态点击因此会**激活整块**：光标落进 chip，从浏览器回来能直接接着敲字。这与读态 wiki link（一步导航、不激活）不同，理由是外链打开不离开当前页，页面应当保持可编辑。

已接受的代价：别名改字不能用鼠标单击进入（每次单击都会打开浏览器），只能用双击选词或拖选后再操作，或用方向键走进别名。双击的第二下（`detail > 1`）不重复打开，但第一下仍按单击处理——与浏览器里双击链接会开一次标签页一致。

### D5 `window.open` 在应用代码里是反模式

新增外链打开一律走 `openExternalUrl`。任何地方再写 `window.open(…, '_blank')` 都会在桌面端静默失效，而浏览器与 e2e 都看不出来。

### D6 打开后把焦点抢回本应用

`openUrl` 走 ShellExecute，系统浏览器启动时一定会取前台，正在 comind 里写字的人会被打断。Windows 没有「在后台标签页里打开 URL」的 API（浏览器自己的 `-new-tab` 之类同样会激活窗口），所以只能事后再抢回来。

`openExternalUrl` 在 `openUrl` 返回后，按 0 / 150 / 400 / 800 / 1300 / 2000 / 3000 ms 补调七次 `focus_main_window`。补多次是因为浏览器会**抢两次**前台（窗口刚建出来一次、页面加载完再激活一次），冷启动时第一次还会拖到 1s 以后。命令幂等：`main` 已是前台就直接返回。

Rust 侧（`src-tauri/src/window_focus.rs`）不能用 tauri 的 `set_focus()` 了事：Windows 前台锁只允许当前前台进程 / 前台进程启动的子进程调用 `SetForegroundWindow`，浏览器成为前台之后我们的调用会被静默拒绝（表现是任务栏闪一下）。实现改为把本线程输入队列临时挂到前台窗口的输入线程（`AttachThreadInput`）再 `SetForegroundWindow`，随后解除挂接；窗口最小化情形先 `ShowWindow(SW_RESTORE)`。

抢回窗口只是一半：键盘焦点还在 WebView2 子窗口之外，必须再 `Webview::set_focus()`，否则出现「窗口在前台、却要点一下才打得进字」。macOS / Linux 直接 `set_focus()`。

实测（Windows 11 / Edge 已常驻）：点开外链后约 100 ms 失去焦点（浏览器窗口出现），约 200 ms 抓回并保持。因此是一次可见的闪动，不是无感后台打开。

失败静默：抢焦点失败只意味着仍停在浏览器，不外抛、不提示。

已接受的代价：浏览器窗口会先冒出来再退回后台（一次可见的抢占）；若用户在这 1 秒内主动切到别的应用，会被抢回。

已否决：用 `focused: false` 的应用内 webview 窗口打开外链——零闪烁、焦点绝对不动，但走的是 comind 自己的窗口而非系统浏览器，没有地址栏与前进后退，登录态也与浏览器隔离。
