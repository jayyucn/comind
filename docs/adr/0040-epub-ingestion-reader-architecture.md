# ADR-0040: 摄入侧 EPUB 阅读器架构（高亮→笔记→知识库）

- 状态：已采纳（Accepted）
- 日期：2026-09-02
- 范围：`src-tauri/`（书文件存储、SQLite 新表）、`crates/comind-core/`（高亮/进度表与 wasm 接口）、`src/components/`（阅读器窗口、gallery 视图）、`src/stores/`、`src/views/`。
- 关联：z-index 分层见 ADR-0032；查询页框架见 ADR-0023；块写路径编排见 ADR-0019；资产存储 `src/utils/asset.ts`。
- 触发：grill-with-docs 对「把读过的书里划的高亮和想法接进知识库」的刨根问底，锁定方向后落盘。

## 背景 / 问题陈述

comind 只有「产出侧」（写笔记、建链接、长图谱），没有「摄入侧」：读过的书里划的高亮和想法死在别的 app 里，永远代谢不成自己的 Block。v1 目标是 EPUB 导入 → 书房 → 阅读 → CFI 高亮 → 笔记 Block（进反链/图谱）→ 跳回原文 → 高亮管理，跨端优雅降级。不含 PDF、书内搜索、多色标注、web 端读书、高亮同步、导出。

## 决策

**D1 — EPUB 引擎：foliate-js 解析模块 + 主文档自渲染（非 iframe）。**
只用 `foliate-js` 的 `epub.js`（解析）与 `epubcfi.js`（CFI 锚定）两个模块；章节 XHTML 由自建渲染层 sanitize 后注入主文档滚动容器。
- 否决 epub.js（futurepress）全家桶：维护半死、API 老旧；其 iframe 渲染使主题注入/选区交互绕层。
- 否决 foliate-js 整装 `view.js`：同为 iframe（"自渲染非 iframe"仅在只用解析模块时成立），且自称 far from stable、无连续滚动。
- CFI 锚定是全链路最高风险点，由 foliate 成熟实现兜底；渲染层自建换排版/主题/浮层全掌控。

**D2 — 书 Page（`type=book`）元数据照常同步；跨端语义靠 UI 层过滤。**
sync 引擎是表级全量同步（`SyncTable` 枚举 9 张表，无行级过滤），不为此侵入核心链路。书 Page 是一条无内容元数据记录，同步成本≈0；无阅读器的端（Android/web）在 UI 层隐藏书房入口与 `type=book` 列表项。高亮/进度/书文件本来就不进 sync 表，天然仅桌面本地。
- 否决 sync 行级过滤（排除 `type='book'`）：侵入引擎，且书 Page 的 Property/Link 关联行需连带排除，边界复杂风险高。

**D3 — 笔记 Block 挂在书 Page 下（Readwise 模式）。**
书 Page 即笔记容器：高亮写的想法生成普通 bullet Block（属性 `book/chapter/cfi/quote`），挂在书 Page 下。反链/图谱/同步/跨端可读全部白拿——其他端打开书 Page 就是普通笔记页。
- 否决挂今日 Ideas Page：与用户选择相悖；书 Page 聚拢每本书的笔记。

**D4 — 书 Page = 普通笔记页；阅读器为独立 Tauri WebviewWindow。**
书 Page 从任何入口点进去都是现有块编辑器（零改动）；阅读器是独立窗口（`WebviewWindow`），从书房封面网格或书 Page 的「开始阅读」唤起。跳回原文（#8）= 唤起/新建阅读器窗口并定位 CFI。
- 独立窗口 = 独立 WebView = 独立 Pinia 内存态：阅读器窗口经 wasm client 直写同一 SQLite（同 Rust 进程），主窗口内存刷新用 Tauri 跨窗口事件（`emitTo`/`listen`）或 focus 时重载兜底。
- 否决阅读器为书 Page 唯一形态 + 内嵌编辑抽屉：块编辑器嵌入阅读器是新链路，其他端还得再造纯笔记页视图。

**D5 — 高亮/进度存 Rust SQLite 新表，不注册 `SyncTable`。**
新表（如 `BookHighlight`、`BookProgress`）与 Page/Block 同库，同备份/迁移单元；不入 `SyncTable` 枚举即不同步，兑现「高亮仅桌面本地」。高亮写入频率低（划线那一刻一次），FFI 成本无压力。
- 否决前端 Dexie/IndexedDB：桌面清缓存即丢高亮，与 SQLite 数据持久性不对等，数据分裂两处。

**D6 — 阅读进度记 CFI 锚点。**
进度 = 上次位置的文字级 CFI，与高亮同一套锚定基建；恢复时解析 CFI 得文本范围后滚动定位。排版参数（字号/行距/行宽）变化不漂移。
- 否决章节 index + 百分比偏移：排版一变位置就漂，跨会话恢复体验差。

**D7 — 高亮是独立实体，笔记 Block 是可选升级。**
高亮表存 `id / bookPageId / cfi / text / chapter / color / blockId?`。划线那一刻只写高亮表；写想法时才在书 Page 下 append 笔记 Block 并回填 `blockId` 关联。删除高亮不删关联 Block（Block 独立可读，跨端承诺）。
- 否决高亮即 Block（划线立刻生成 Block）：把随手划逼成知识库写入，书 Page 被空 Block 灌满，图谱被无想法的引用句污染。
- 双写切分：高亮表是**阅读器态**（text 供重绘/面板展示），Block 是**知识态**（quote 属性供独立可读）。

**D8 — 书文件存单个 .epub 原文件，内存解析。**
`workspace/books/` 下存原文件（复用/参照 `assetStorage` 的 Tauri 实现）；foliate-js 从 Blob 加载解析。封面一次性提取存 asset（书房网格用）。
- 否决解压成目录：解压只是手段而非目的；单文件形态备份/迁移/删除最简。

**D9 — 书房 = Pages Library 新 gallery 视图 tab。**
复用 Query Page Frame + Screen→Tab 体系（ADR-0023），查询条件 `type=book`；新增第四种 viewKind `gallery`（generic views 家族扩展，封面网格将来相册/素材库可复用）。

**D10 — 渲染安全与浮层纪律（工程必做项）。**
EPUB 章节 XHTML 是外部 HTML，注入主文档前必须过严格 sanitize（allowlist 标签/属性、剥 script）；浮层遵守 ADR-0032 z-index 铁律（`var(--z-*)` + Teleport 到 body）。

## 否决的备选（及理由）

- **epub.js 全家桶（futurepress）**：自带 CFI+annotations 出活最快，但项目维护半死、iframe 渲染与本项目主题注入/浮层纪律摩擦大。
- **先 epub.js 后换 foliate**：留 seam 的代价是可能写一次性代码；foliate 解析模块可直接 npm 引入（`foliate-js@1.0.1`，MIT），无需过渡。
- **sync 行级过滤排除书 Page**：见 D2，核心链路风险不对称。
- **高亮即 Block**：见 D7。

## 后果

- Rust 侧新增：书文件存储命令、`BookHighlight`/`BookProgress` 表及 wasm 接口（不进 SyncTable）。
- 前端新增：阅读器独立窗口路由（`/reader/:bookId`）、自渲染层（sanitize + CFI 定位 + 高亮浮层）、gallery viewKind、跨窗口数据刷新事件。
- 其他端（Android/web）：UI 过滤书房入口；书 Page 作为普通笔记页照常可用。
