# 0060 PaneTab：pane 内多标签与跨目的地泛化

- Status: accepted
- Date: 2026-10-26
- 关联: ADR-0059（对称分屏 Pane，本文取代其 D1/D3/D4）、ADR-0046（撤销按页隔离）、ADR-0032（z-index / Teleport）、ADR-0029（Screen/Tab 查询层级）

## Context

ADR-0059 把 pane 定义成 `{ id, pageId }`（单目的地），并显式排除非页路由（TaskHub / 图谱 / 设置 / 阅读器）参与 pane——它们占满主区、不分屏。

用户要求：pane 管理的**不只是 Page 页面，还要包含图谱、任务等全部顶层目的地**；且要**浏览器式的多标签**——「pane 装 tabs，tab 装路由」。本文把 ADR-0059 的「单目的地 pane」升级为「窗格 + 多标签 + 跨目的地」三层模型，并推翻 ADR-0059 D3 的「非页路由占满主区、不参与 pane」。

## 决策

### D1 三层数据模型

```ts
type PaneKind = 'page' | 'graph' | 'tasks' | 'tags' | 'pages' | 'trash'
// 'tags' 带 ref => 标签聚合页；不带 ref => 标签页库

interface PaneView { kind: PaneKind; ref?: string } // ref: page→pageId; tags→tagId; 其余无 ref
interface PaneTab  { id: string; entries: PaneView[]; cursor: number } // 当前视图 = entries[cursor]
interface Pane     { id: string; tabs: PaneTab[]; activeTabId: string }
```

- 顶层 store：`panes: Pane[]`（上限 2，结构预留 N）、`activePaneId: string`、`splitRatio: number`（左 pane 占比 0.1~0.9，pane 级，不变）。
- `currentPageId` 派生改为：活跃 pane 的活跃 tab 的 `entries[cursor]`，`kind==='page'` 时取 `ref`，否则 `undefined`。

### D2 命名与术语边界

- 新概念统称 **PaneTab**，与 glossary 现有 **Tab**（查询视图实例 table/board/calendar，`screen_view` 表，ADR-0029）**不是同一概念**；后者是 TaskHub / 标签聚合内部的查询视图切换层，两者正交（PaneTab 装 `tasks` 时，TaskHub 内部仍用自己的 query Tab 切 table/board/calendar）。
- `PaneView.kind` 与 `core/view/types.ts` 的 `ViewKind`（查询视图类型）不混淆：ViewKind 仅在 PaneTab=`tasks` 之后由 TaskHub 内部使用。

### D3 渲染架构（ViewHost 本地渲染）

- 新增 `ViewHost` 组件，按 `PaneView.kind` 渲染对应组件：
  - `page`→`<Page>`、`graph`→`<GraphPage>`、`tasks`→`<TaskHub>`、
  - `tags`(+ref)→`<TagAggregatePage>`、`tags`(-ref)→`<TagsLibrary>`、`pages`→`<PagesLibrary>`、`trash`→`<TrashList>`。
- 两个 pane 都直接 `<ViewHost :view="activeTab.currentView" />`。**router 不再承担多 pane 渲染**，仅用于「活动 pane 的活动 tab 的 URL 同步」（`router.replace`），不参与非活动 pane 渲染。
- 取代 ADR-0059 的 `isPageRoute` 分支（页面路由渲染 pane、非页路由 `<RouterView>` 占满主区）。`routes.ts` 的组件映射迁移进 `ViewHost`；路由守卫（afterEach 预取等）仅对活动 tab 触发。

### D4 导航历史下沉到 PaneTab

- 原 ADR-0059 D4「每 pane 一栈」（`usePanesNavigation` 的 `Map<paneId, 栈>`）撤销，历史内建于每个 PaneTab 的 `entries/cursor`。
- 应用内后退/前进按钮与 `Alt+←/→` 全局快捷键作用于**活跃 pane 的活跃 tab** 的 `entries/cursor`。
- `usePanesNavigation` 退役，历史状态并入 pane store（entries/cursor 即历史）。

### D5 手势合约

- 点左侧栏 / 命令入口 → 导航到**当前激活 pane 的活跃 tab**（push 新 entry，截断 forward）。
- 点 tab 条「+」→ 新建**空白页** tab（`PaneView {kind:'page', ref:<新页 id>}`），成为活动 tab（空白页等同于当前页，可继续导航）。
- `Ctrl+Click`（保留 ADR-0059）→ 在**另一 pane** 的活跃 tab 打开（push entry）；不足 2 pane 时新建 pane。
- （未来增强，非 v1：中键点击 / 右键「在新标签打开」把指定目的地直接开新 tab。）

### D6 持久化（全持久化）

- `localStorage` 存：两 pane 的全部 tabs（含每个 tab 的 `entries/cursor`）+ `activePaneId` + `activeTabId` + `splitRatio`，刷新完整恢复。
- 取代 ADR-0059 D2 的「仅两 pane 的 pageId」形态。

### D7 URL 与启动协调

- URL = 活动 pane 活动 tab 的当前 `PaneView` 对应路由（`/page/:id`、`/graph`、`/tasks`、`/tags`、`/tags/:tagId`、`/pages`、`/trash`）；切换活动 tab/pane 用 `router.replace`（不 push）。
- 启动恢复：先读 localStorage；若 URL 指向的 view 匹配某 pane 某 tab 的当前 entry → 激活该 pane/tab；否则忽略 URL、用存储布局；仅当**无任何存储**时 URL 才用于初始化。

### D8 非页目的地降级

- 活跃 tab 为 `graph`/`tasks`/`tags`/`pages`/`trash` 时 `currentPageId=undefined`：侧栏不高亮任何页、反链面板与 Toc 右栏隐藏、GraphPanel（右栏）显示全图不聚焦。干净降级。

### D9 关闭保底规则

- 每 pane 至少保留 1 个 tab（最后 1 个 tab 的关闭按钮禁用）。
- 关闭 pane：仅剩 1 pane 时忽略（保持 ≥1 pane）；否则关 pane 并把活动权交给剩余 pane（其活跃 tab 不变）。

### D10 keep-alive 策略（全保活）

- 所有 tab 全 keep-alive（含 Page）。切走再切回组件实例保留（滚动 / 展开 / graph 布局 / 查询状态都在），浏览器式直觉。
- 已知代价：每个 Page tab 常驻一个 ProseMirror 编辑器实例，内存随 tab 总数线性增长（本仓编辑器实例敏感，ADR-0059 D5 把 `activeEditor` 做成全局单例即为简化此问题）。用户明确选 C 换取浏览器式体验；若未来多 tab 内存吃紧，可降级为「仅非 Page 类保活」。

## 理由

- 浏览器式三层（Pane → PaneTab → PaneView）是大纲笔记工具（Logseq 多页签 / Obsidian 分叶）的成熟终态；用户点名要 tabs + 跨目的地，单层 pane 已不够。
- `ViewHost` 本地渲染把「两 pane 共用一 URL」的冲突收口为「router 仅作活动 tab 地址镜像」，避免活动 / 非活动双渲染路径分叉。
- 历史内建于 PaneTab（`entries/cursor`）使「切 tab = 切历史」「前进/后退作用于当前 tab」天然成立，比外置 `Map<paneId, 栈>` 更贴合浏览器语义。
- 全 keep-alive 换取直觉体验，代价（编辑器实例数）已记录，可控可降级。

## 已否决的替代方案

- 维持 `Pane={id,pageId}`、另起 `nonPagePanes` 并行管理：破坏 ADR-0059 对称初衷，两套数据。
- pane 直接存路由描述符 `{name,params}`：路由细节进持久化，路由改名即脏数据。
- URL 表达全部 pane（多视图 URL）：ADR-0059 已否，丑陋且破坏分享语义。
- 渲染用「活动 RouterView + 非活动 ViewHost」双路径：活动 / 非活动逻辑易不一致，多一套 bug 源。
- 不 keep-alive / 仅活动 pane 保活：用户选 C 求浏览器直觉，A/B 的回 tab 重渲染闪烁不可接受。

## 后果

- `stores/panes.ts` 数据模型重写（Pane→含 tabs 数组；新增 PaneTab / PaneView 类型）；`usePanesNavigation` 退役，历史并入 store。
- `App.vue` 移除 `isPageRoute` 分支，改渲染对称 pane 布局 + 每 pane 的 tab 条 + `<ViewHost>`；`paneTitle` / `paneParentTitle` 改为读 `entries[cursor]` 的 view 标题（非页类用固定名）。
- 新增 `ViewHost` 组件承接 `routes.ts` 的组件映射；路由守卫逻辑迁移（仅活动 tab 触发）。
- `currentPageId` 派生来源改为活跃 tab 的 view，影响侧栏高亮 / 反链 / Toc / GraphPanel 聚焦逻辑（D8 降级）。
- 撤销层、块数据层、`activeEditor` 单例无需改动（ADR-0046 / 0059 D5 仍成立）。
- 回归网：`stores/panes.test.ts`（新数据模型）、pane/tab 导航与持久化测试、`ViewHost` 路由映射测试、现有 `editorEvents` / `useBlockEditorLifecycle` 回归。
