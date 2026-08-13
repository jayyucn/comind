# ADR-0007: 消除「打开 /graph 图谱卡几秒」的性能治理

- 状态：已采纳（Accepted）
- 日期：2026-08-13
- 范围：Comind 桌面端（`Tauri v2` + `Vue 3` + `@antv/g6 v5.1.1`）导航到 `/graph` 的打开延迟
- 关联代码：
  - `src/router/index.ts`（守卫静态化）
  - `src/router/routes.ts`（路由组件静态化）
  - `src/components/GraphView/GraphPage.vue`（静态引入 GraphView + 走缓存）
  - `src/components/GraphView/graphSnapshotCache.ts`（新增：预取缓存）
  - `src-tauri/src/commands.rs::build_graph_snapshot`（改为 `open_readonly`）
  - `src-tauri/src/crates/comind-core/src/storage/sqlite.rs`（新增 `open_readonly`）

---

## 背景 / 问题陈述

用户报告：在「点滴」界面刷新后**快速点击侧栏「图谱」**，导航到 `/graph` 会**卡住几秒才打开**（非永久冻结，页面可交互，只是图谱内容晚到）。

经多轮插桩（浏览器控制台 `[nav-graph]` 打点 + Rust 侧分段计时 + `schedule` 测量），把延迟拆成**三层独立根因**，每一层用不同手段治理。三层叠加才是「卡几秒」的完整体验。

> 关键事实：Rust `eprintln!` 输出到 `tauri dev` **终端**而非浏览器 devtools，早期两轮 Rust 改动是「盲改」。最终把分段计时搬进返回结构、在浏览器控制台打印 `Rust: open Xms / query Yms | schedule ≈ Zms`，才拿到决定性数据。

---

## 决策 1（D1）：路由层动态 `import()` 被 dev server 模块 backlog 排队 → 三层静态化

**现象**（插桩数据）：`afterEach` 守卫放行后 `GraphPage` chunk 直到 `+2720ms` 才求值，G6 chunk 也 `+2801ms`；守卫内部本身 `+0ms`。
**根因**：`routes.ts` 里 `component: () => import('../components/GraphView/GraphPage.vue')` 与守卫内 `await import('../stores/blocks')` 都是**动态 `import()`**。在「刷新后立刻导航」时，这些请求被 dev server 初次喂模块的 **backlog 排队**，干等 ~2.7s（纯异步等待，主线程空闲 → 用户「可交互」）。第二个 import 时 backlog 已清空所以快。

**决策**：把关键路径上的动态 import **全部改为顶部静态 import**（这些模块本就被 `App.vue` 静态引入、无循环依赖）：
- `router/index.ts` 守卫：`useBlockStore` / `usePageStore` / `tauriNormalizeJournalTitle` / `tauriIsTodayTitle` 顶部静态引入。
- `router/routes.ts`：`/graph` 路由组件由 `() => import(...)` 改为静态 `GraphPage`。
- `GraphPage.vue` 内部：`defineAsyncComponent(() => import('./index.vue'))` 改为静态 `import GraphView`（GraphPage 本身体积很小；真正重的 G6 仍按需，但不进首屏关键路径）。

**后果**：`afterEach +1ms`、页面 + G6 外壳 `+11ms` 可交互。路由层延迟**彻底消失**。web 模式（sql.js）全程 ~272ms 也印证模块/G6 加载从来不是真正瓶颈，瓶颈只在 Tauri 环境的「刷新后紧接的关键路径 import 被 backlog 排队」。

---

## 决策 2（D2）：Rust `build_graph_snapshot` 等共享 mutex + DDL 写锁 → `open_readonly`

**现象**（静态化后复测）：`afterEach +1ms` 已好，但画布仍 ~2.7s 才出；`buildGraphSnapshot` IPC 返回 `8 edges in 2730ms`。
**根因（两步走，第一次判断错）**：
1. 最初误判为 `state.rs::DatabaseConnection`（`Arc<tokio::Mutex<SQLiteAdapter>>` 单连接单 mutex）被 ideas 后台加载饿死。改 `build_graph_snapshot` 用 `SQLiteAdapter::open` 开**独立只读连接** —— **无效**（仍 2558ms）。
2. 真正根因：`SQLiteAdapter::open` 顺带跑 `init_schema`（全套 `CREATE TABLE IF NOT EXISTS` = **DDL，需写锁**）。在 ideas 后台**写入期间**，独立连接的 DDL 与写者抢 `RESERVED` 锁，触发 `busy_timeout=5000` 干等 ~2.5s。纯 SELECT 读者在 WAL 下不被写者阻塞，但 **DDL 会** —— 所以「开独立连接 + DDL」反而更糟。

**决策**：在 `sqlite.rs` 新增 `SQLiteAdapter::open_readonly(path)` —— 只开裸连接 + 设 PRAGMA（`journal_mode=WAL` / `busy_timeout=5000` / `foreign_keys=ON`），**跳过 `init_schema`**（schema 已由主连接在启动时建好）。`build_graph_snapshot` 改用 `open_readonly`：纯读、不抢写锁、与 ideas 写负载并发。

**后果**：浏览器控制台 `Rust: open 14ms / query 0ms` —— 命令体从 2730ms 降到 **14ms**。`open_readonly` 修复**确认生效**（旧版慢是等 mutex + DDL 写锁；现在纯读 14ms）。

---

## 决策 3（D3）：并发 G6 画布渲染占主线程、推迟 IPC 回应 → 预取快照

**现象**（D2 修复后复测，铁证翻案）：
```
buildGraphSnapshot: OK — 8 edges in 2786ms (Rust: open 14ms / query 0ms) | schedule(命令等待调度) ≈ 2ms
buildGraphSnapshot: OK — 8 edges in 1199ms (Rust: open 1ms / query 0ms)  | schedule(命令等待调度) ≈ 7ms
```
**根因（决定性数据）**：
- `schedule = rust_start_wall - sendWall ≈ 2~7ms` → Rust 命令在 invoke 后 **2~7ms 内就开始执行**，**完全不存在命令调度饿死**。这**证伪**了「spawn_blocking 重构」的理论基础（见 D4）。
- `open 14ms / query 0ms` → Rust 命令体本身只 14ms。
- 数学拆分：`2ms(到Rust开始) + 14ms(Rust执行) + ~2770ms(Rust结束→JS收到) = 2786ms`。**整个 ~2.7s 在「Rust 命令结束」到「JS promise resolve」之间** = IPC **回应**路径 / JS 主线程被占。

真正残余瓶颈：JS 主线程在并发挂载/渲染**两个 G6 画布**（连点图谱 2 次时）期间忙于大量 <50ms 的 G6 渲染/响应微任务，这些零散占用不触发 `LONGTASK`（≥50ms）但累计把 IPC 回应处理推迟 → 图谱数据晚 ~1~2.8s 才填充。页面本身早已可交互（shell-first），用户**不会卡死**，只是数据晚到。

**决策（用户选定「预取快照」）**：app 启动 / hover 侧栏时**提前 `buildGraphSnapshot`**，点图谱时数据已在手、画布即时填充，彻底消除此二级延迟。
- 新增 `src/components/GraphView/graphSnapshotCache.ts`：模块级缓存 + `prefetchGraphSnapshot()`（App 启动 fire-and-forget）+ `getOrFetchGraphEdges()`（命中缓存即返）+ `refreshGraphSnapshotCache()`（命中后后台刷新保新鲜）。
- `App.vue` `onMounted` 调 `prefetchGraphSnapshot()`，导航 `/graph` 前快照已就绪。
- `GraphPage.vue::loadGraphSnapshot` 改用 `getOrFetchGraphEdges()`，命中打 `cache hit`，后台 `refreshGraphSnapshotCache()`。

**后果（Tauri 复测）**：
```
[GraphPage] buildGraphSnapshot: loaded 8 edges (cache hit) in 1ms / 0ms
[GraphPage] background load complete in 5ms / 3ms
[GraphView] initGraph done in 86ms / 45ms   ← afterlayout 即「画布可交互」
```
无任何 `schedule≈1800ms` 或 `in 2786ms`。残余延迟**彻底消失**。

---

## 决策 4（D4，已否决）：把 DB 命令改 `spawn_blocking`

**提出**：基于「Rust 命令被 ideas 后台加载饿死」的假设，主张把 `execute_with_adapter` 的同步 rusqlite 调用搬进 `tokio::task::spawn_blocking` 独立阻塞线程池。
**否决理由（数据证伪）**：`schedule ≈ 2~7ms` 证明 Rust 命令在 invoke 后几毫秒内就开始执行，**不存在调度饿死**。且此改动会引发 ~25 个命令的 `borrowed data escapes` / `F: Send + 'static` 编译错误（闭包捕获 `&str`/`&Block`/`&Page` 引用，不满足 `'static`），波及全命令面的大改。原始「页面打不开」已彻底解决，此 1.8s 仅「从仍在加载的点滴快速切回图谱」时出现且页面已可交互 —— 按「简约优先」原则**不做**。

---

## 收尾（本轮）

- 清理所有临时排查插桩：`src/utils/navTiming.ts`（删除）、`.debug/`（删除）、`router/index.ts` 与 `GraphPage.vue` / `index.vue` 的 `[nav-graph]` 打点（删除）；`commands.rs::build_graph_snapshot` 撤 `GraphSnapshotResult` 计时结构（**保留** `open_readonly` 修复）；`tauri-client.ts` / `client.ts` 的 `buildGraphSnapshot` 回归 `Promise<TauriGraphEdgeRecord[]>`。
- 清除本轮排查期加的 `console.info` 进度日志（`[GraphView]` 11 条、`[GraphPage]` 3 条）与路由里遗留的 DEV-only `[nav-timing]` `console.debug` 2 处；**保留**所有 `console.warn` / `console.error`（失败降级、全图截断、布局超时、PNG 导出）—— 它们是真正的安全网。
- 校验：`cargo check`（RUST_RC=0）+ `vue-tsc --noEmit`（VUE_RC=0）均通过。

---

## 术语表（Glossary）

| 术语 | 含义 |
| --- | --- |
| **backlog 排队** | dev server 在「刷新后立刻导航」时，关键路径上的动态 `import()` 请求被初次喂模块的队列阻塞，干等数秒。纯异步等待，主线程空闲。 |
| **WAL** | Write-Ahead Logging，SQLite 日志模式。`journal_mode=WAL` 下读不阻塞写、写不阻塞读（但 DDL 仍会抢锁）。 |
| **DDL 写锁** | `CREATE TABLE IF NOT EXISTS` 等 schema 变更需排他写锁；在并发写入期会触发 `busy_timeout` 等待。 |
| **open_readonly** | 本项目新增的 SQLite 连接模式：只开裸连接 + 设 PRAGMA，**跳过 `init_schema`**，专供纯读命令（如 `build_graph_snapshot`）并发于写入负载。 |
| **force 重绘风暴** | G6 v5 全量图默认 `force` 布局 = d3-force 逐帧 tick，每帧 onTick 全量重绘所有节点；大图下数百帧重绘把主线程占满数秒（早于本 ADR 已通过「初始 grid 布局 + 3000 节点截断」治理，见 `index.vue`）。 |
| **预取快照（prefetch snapshot）** | app 启动或 hover 时提前取 `buildGraphSnapshot` 并缓存；点图谱时数据已在手，规避主线程/IPC 回应延迟。 |
| **schedule** | 本次诊断引入的测量：`rust_start_wall - sendWall`，即前端 invoke 到 Rust 命令真正开始执行的墙钟耗时。≈2~7ms 证伪「调度饿死」。 |
| **LONGTASK** | PerformanceObserver 标记 ≥50ms 的主线程阻塞任务。本案 G6 渲染是大量 <50ms 微任务累计，不触发 LONGTASK，故「页面不卡但数据晚到」。 |
| **shell-first / non-blocking** | 先渲染 UI 外壳（布局 + 占位），再在后台异步执行数据加载与 G6 初始化，不阻塞首帧 paint。 |
| **Tauri 命令调度饿死（已证伪）** | 假设：DB 阻塞命令占 async worker 线程，导致 `build_graph_snapshot` 拿不到 worker 被饿死。被 `schedule≈2ms` 数据推翻。 |
