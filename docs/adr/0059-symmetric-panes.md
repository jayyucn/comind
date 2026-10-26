# 0059 对称分屏 Pane（Symmetric Panes）

- Status: accepted
- Date: 2026-10-25
- 关联: ADR-0032（z-index / Teleport 浮层）、ADR-0046（撤销按页隔离）、ADR-0016（编辑器 DOM 事件通道）

## Context

ADR-0058 把「分屏」实现为「主栏（RouterView）+ 副栏（单个 `<Page>`）」的非对称双栏，副栏以单值 `secondaryPageId` 表达，再次分屏替换副栏。该模型的隐含前提——存在一个「主栏」作为路由锚点——不满足需求：两侧应完全对等（同一页面结构、同等能力、各自独立导航），且副栏不应是「二等公民」。

对称 pane 才是这类大纲笔记工具（Logseq 双面板 / Obsidian 分叶）的正确终态。本文把 ADR-0058 的非对称模型升级为对称模型。

## 决策

### D1 Pane 数据模型

- `stores/panes.ts`（取代 `splitPane.ts`）：
  - `panes: Pane[]`，`Pane = { id: string; pageId: string }`，上限 2（数据结构为数组，预留 N）。
  - `activePaneId: string` —— 焦点 pane，驱动 `currentPageId` 与键盘/弹层路由。
  - `splitRatio: number` —— 左侧 pane 占比（夹取 0.1~0.9）。
- 动作：`openPane` / `openInOtherPane`（Ctrl+Click 分流目标）/ `closePane` / `activatePane` / `setSplitRatio`。

### D2 持久化（全持久化）

- 布局（两 pane 的 pageId、activePaneId、splitRatio）序列化到 `localStorage`，刷新后完整恢复两个 pane。
- 恢复时机：应用启动、路由 resolve 后，若持久化布局存在则载入；活动 pane 由 URL 页与已存 pane 匹配决定（URL 页不在已存布局中时，用 URL 页覆盖第一个 pane）。

### D3 路由与 URL（URL = 活动 pane 页）

- URL 永远指向活动 pane 的页。切换活动 pane 用 `router.replace`（**不 push**，避免污染历史）。
- `currentPageId`（`stores/pages.ts`）退化为派生值：`panes[activePaneId].pageId`，统一喂给侧栏高亮 / 反链 / 图谱 / Toc。
- 焦点跟随触发：pane 激活（块聚焦/输入框聚焦）、导航、关闭 pane；无焦点时不处理（保持最后值）。`selection.toggleBlock` 读取 `currentPageId` 前必须先完成焦点更新（顺序收口）。
- 非页面路由（TaskHub / 图谱 / 设置 / 阅读器）占满主区、不参与 pane；进入页面路由时恢复 pane 布局。

### D4 导航历史（每 pane 独立栈 + 浏览器历史完全解耦）

- `useNavigationHistory` 重构为 `Map<paneId, 栈>`：每个 pane 维护自己的页面访问栈。
- 应用内后退/前进按钮内嵌于各 pane 头部，作用于本 pane 栈。
- `Alt+←/→` 全局快捷键作用于活动 pane 的栈。
- 浏览器原生后退/前进**不再映射** pane 历史（完全解耦）；地址栏直接改动 URL 视为「活动 pane 载入新页」。

### D5 编辑器单例保持

- 不打破 `activeEditor`/`activeBlockId` 单例：同一时刻全局只有一个编辑光标，焦点跟随活动 pane。撤销层仍按 `pageId` 隔离（ADR-0046），无需改动。

### D6 Toc 右栏化

- Toc 从页面内浮动浮层改为右栏面板 tab（与图谱并列），绑定 `currentPageId`（= 活动 pane 页）。
- 保留 heading / book 数据提取与高亮；移除浮动定位与布局测量；scroll-spy 与点击跳转按活动 pane 的滚动容器路由。

## 理由

- **对称是目标而非实现手段**：非对称模型的「副栏」在路由、持久化、导航历史上处处需要特殊分支，对称模型把这些分支统一为「pane 数组 + 活动指针」。
- **`currentPageId` 派生**把「主栏页」与「工作页」两个含义合一：活动 pane 的页即工作页，侧栏/反链/图谱/Toc 全部同源。
- **每 pane 独立栈 + 浏览器解耦**是 Logseq/Obsidian 的成熟形态；浏览器原生历史是单一线性序列，无法表达两个独立栈，故必须解耦。
- 单光标保持不动，避免重开 `activeEditor` 单例这一全项目最深耦合点。

## 已否决的替代方案

- **非对称主/副栏（ADR-0058）**：副栏为单值、路由锚定主栏，无法满足「两侧完全对等」，被本文取代。
- **URL 表达全部 pane**：多页 URL 丑陋、破坏深链与分享语义，被否。
- **全局单栈导航历史**：无法满足「每 pane 独立前进后退」，被否。
- **打破 activeEditor 为双光标**：收益存疑、耦合面最深（14 文件消费 activeEditor），被否。

## 后果

- 浏览器原生后退/前进不再驱动应用内导航（可能引起用户预期差异），以 pane 内按钮 + `Alt+←/→` 补位。
- 持久化布局需定义「URL 页与已存布局不一致」的覆盖规则（D2）。
- 撤销层、块数据层无需改动；`Page` 组件 prop 驱动保持零改复用。
- 回归网：`stores/panes.test.ts`、pane 导航栈测试、TocPanel 测试、既有 `editorEvents`/`WikiLinkExtension`/`useBlockEditorLifecycle` 回归。
