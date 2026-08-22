# ADR-0012: z-index 层级 token 化（十层语义阶梯）

- Status: accepted
- Date: 2026-08-22
- Supersedes: —
- Related: 本仓库样式 token 体系（`src/styles/tokens/{primitives,semantic}.scss`）

## Context

改造前的 z-index 现状（全量盘点）：

1. **token 体系名存实亡**：`_primitives.scss` 只有 3 个 token（`$z-dropdown:100 / $z-modal:200 / $z-toast:300`），实际只被 `_common.scss`、`_block.scss` 共 4 处引用；其余约 30 处 z-index 全部是组件内硬编码。
2. **`1000` 语义爆炸**：抽屉、对话框、下拉菜单、拖拽指示线、折叠按钮等 10+ 种互不相关的概念共用 `1000`，靠 v-if 后挂载 + Teleport 追加的 DOM 顺序浮上，任何层级冲突都无从排查。
3. **层级倒挂**：`.tooltip` 误用 `$z-toast`；SyncStatusBar 弹层与系统浮层滚动条同为 `9999`，会盖住模态。
4. **弹层嵌套深度靠数值差编码**：`BasePopover(1100) → ValueEditor qb-popover(1200) → DatePicker(1300)` 三层弹层链，正是用数值差避免同层 DOM 顺序竞争——这是合理机制，规划时必须保留。
5. **滚动条 9999 实际缺陷**（实测反馈）：弹层一开，底部浮层滚动条会浮现到弹层之上。滚动条是页面装饰 chrome 而非全局顶层，`pointer-events:none` 让交互测试发现不了，视觉上仍跨层。
6. **堆叠上下文陷阱**：`.block-children` 恒有 `transform: translateY(0)`（`_block.scss`），任何渲染在嵌套 block 内的浮层都会失效；`PageMenuButton` 的下拉被困于 `.sticky-header(z:10)` 的局部堆叠上下文，其 `1001` 只是局部语义。

## Decision

### 十层语义阶梯（自底向上）

在 `_primitives.scss` 定义（组件 scoped 样式经 `_semantic.scss` 的 `--z-*` CSS 变量使用）：

| token | 值 | 语义 |
|---|---|---|
| `$z-base` | 0 | 内容层（0-2 微叠层豁免 token 化；`-1` backdrop 保持父容器内局部） |
| `$z-sticky` | 10 | 吸附 chrome：导航栏、拖拽柄、代码按钮、表头 |
| `$z-scrollbar` | 50 | 系统装饰：浮层滚动条（高于 sticky、低于一切浮层表面） |
| `$z-sidebar` | 100 | 侧栏浮层：移动端侧栏、FilterPanel、drop-indicator |
| `$z-dropdown` | 300 | 下拉菜单及需要浮于侧栏之上的小型控件（SlashCommand、通知、lang-menu、SyncStatusBar、侧栏折叠按钮、FilterPanel 折叠按钮） |
| `$z-drawer` | 600 | 抽屉：PageDrawer（低于 dialog，供抽屉内弹窗浮上） |
| `$z-dialog` | 700 | 对话框：共享弹窗、Settings、Selector、SearchPanel 等 |
| `$z-popover` | 900 | 弹层：BasePopover（overlay `$z-popover` / 面板 `$z-popover + 1`） |
| `$z-popover-nested` | `$z-popover + 20` | 弹层嵌套层：ValueEditor qb-popover |
| `$z-popover-deep` | `$z-popover + 40` | 弹层深层：DatePicker |
| `$z-overlay` | 1100 | 顶级覆盖：QrScanner、扫码层 |
| `$z-toast` | 1300 | 瞬时提示：Toast、工具提示 |

要点：

- **popover 单一 token + 派生**：嵌套深度用 `+20` 派生 token 表达，保留并显式化了原先"数值差编码深度"的机制；不再存在同层弹层互靠 DOM 顺序。
- **drawer < dialog**：MergeDialog 等对话框从 PageDrawer 内打开，dialog 必须高于 drawer。
- **toast 高于 overlay**：修复原先 Toast(2000)==QrScanner(2000) 同层、toast 被扫码层盖住的问题——提示信息永远可见。
- **scrollbar 用 50 而非 9999**：滚动条高于 sticky 吸附元素、低于一切浮层表面；模态 backdrop(600+) 自然压住它，弹层打开时不再浮现。
- **9999 从体系消失**：全表 0–1300 严格单调，无例外值。

### 使用约定（铁律）

1. **禁止组件内硬编码 z-index**：一律使用 `_semantic.scss` 暴露的 `var(--z-*)`（组件 scoped 样式）或 `_primitives.scss` 的 `$z-*`（全局 SCSS，需 `@use '../tokens/primitives' as *`）。
2. **浮层必须 Teleport 到 body**：任何渲染在 `transform/filter/backdrop-filter/opacity<1` 祖先内的浮层，其 z-index 会困于局部堆叠上下文而失效（已知陷阱：`.block-children` 的 `translateY(0)`）。弹层、菜单、抽屉等一律 `<Teleport to="body">`。
3. 特例：`PageMenuButton` 的菜单**有意**保持局部语义（header 内下拉本就该被模态压住），其 `var(--z-dropdown)` 只在本组件堆叠上下文内竞争——不得据此推断全局层级。

### 迁移范围（本次已执行）

- token 定义：`_primitives.scss`（12 个）+ `_semantic.scss`（`--z-*` 12 个）。
- 全局 SCSS：`_common.scss`（.nav-controls→`$z-sticky`、.dialog-overlay→`$z-dialog`）、`_dialog.scss`（1000→`$z-dialog`）、`_scrollbar.scss`（9999→`$z-scrollbar`）、`_block.scss`（.drop-indicator→`$z-sidebar`）。
- 组件（约 24 个 .vue）：按上表逐处迁移为 `var(--z-*)`。
- 死代码：删除 `.tooltip`/`.menu` 全局类（`_common.scss`，全仓零引用）与 `BlockHistoryDrawer.vue`（全仓零引用）。

## Consequences

- 新组件/新浮层直接引用 token，层级冲突从"调魔法数"变成"选语义层"，且可在本 ADR 追溯。
- `1000` 等值互靠 DOM 顺序的脆性局面解除（modal 族拆分、popover 族派生）。
- 滚动条不再盖弹层；toast 永在最顶；SyncStatusBar 不再越权压模态。
- 代价：迁移涉及约 24 个组件文件的样式改动，需逐文件验证暗色模式与嵌套场景无回归。
