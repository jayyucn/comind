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
