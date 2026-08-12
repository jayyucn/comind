# IPC 数据传输方式调研（2026-08-12）

## 结论
comind 当前 IPC = **Tauri v2 标准 JSON invoke 命令调用**，未启用 raw-ipc / Channel 流式传输。

## 证据
- `src-tauri/Cargo.toml`: `tauri = { version = "2.0", features = ["default"] }`（无 `raw-ipc` feature，Cargo.lock 中无 raw-ipc）
- `@tauri-apps/api` ^2.11.0；前端唯一 invoke 封装点 `src/wasm/tauri-client.ts`，共 93 处 invoke 调用
- `TauriClient`（`src/wasm/client.ts` L131）实现 `CoreClient` 接口，统一走 tauri-client 包装
- 序列化：Rust 侧 serde/serde_json；前端 `parseJsonResult()` 兼容"JSON 字符串 vs 对象"两种返回（历史遗留：Rust 命令曾手动 `serde_json::to_string`）
- 事件用 `@tauri-apps/api/event`（register_listener / remove_listener）
- 插件：dialog / notification / os / fs（各自走插件 IPC）

## 传输通道（按平台）
| 平台 | 通道 |
|------|------|
| Windows (WebView2) | `window.chrome.webview.postMessage` JSON-RPC |
| Android (WebView) | `window.__TAURI_INTERNALS__.invoke` → JNI → Rust |
| 载荷格式 | JSON（serde_json ↔ JSON.stringify），无分块/二进制优化 |

## 大 payload 场景
- `save_block_tree`（整棵树）、`execute_batch`、`import_from_markdown`、`batch_create_notifications` 均为一次性 JSON 传输
- 无 Channel/流式/分页，大 block 树存在序列化 + 单条消息大小限制风险

## 与同步的关系（非 IPC）
- 设备间同步走 WebSocket：PC `sync_server` 监听 8080（tokio-tungstenite + rustls），Android `sync_client` 连接
- 与 Tauri IPC 无关
