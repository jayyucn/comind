# ADR-0052: 编辑器动效（Motion）系统立项锚点

> **状态：proposed（grill-up 收敛；手感参数已 Demo 锁定，系统范围待确认）**。本文是决策锚点，不是实施规格。

## Context

用户提出「设计动画系统」。经 grill-up 向上拷问，该表述是**方案形态而非问题陈述**，真实需求被重新收敛如下。

### 前提事实核查（代码现状，已验证）

- 仓库 `package.json` 未引入任何动画库（framer-motion / gsap / motion-one / @vueuse/motion 均无）。
- 动效以三种方式散落，无中心化：
  1. **71 处裸 CSS `transition:`** 分布在 60+ 组件，时长与缓动各自为政（`80/100/120/150/160/200/220ms` 混用，`ease`/`ease-out` 混用）。
  2. **已有 token 却未用**：`--transition-base` / `--transition-fast` / `--transition-slow` 及 `_mixins.scss` 的 3 个 mixin 均存在，但大量组件仍写死 `100ms`/`120ms`（如 `Toast.vue:122`、`ReaderView.vue:534`、`query/QueryToolbar.vue:233`）。
  3. **11 套 Vue `<Transition>` 各写各的淡入/缩放**：`submenu`/`fade`/`toast`/`page-drawer`/`block-modal`/`toc-fade`/`toc-list`/`right-sidebar`/`settings-modal`/`base-popover-fade`/`menu`；`@keyframes` 重复（`shimmer` 在 `IdeasList.vue:200` 与 `IdeasHistoryList.vue:250` 各写一遍，`spin` 亦重复）。
- 仅 1 处 Web Animations API（`Reader/ChapterContent.vue:321`）。

结论：「仓库无任何动画系统」前提成立，但缺的是 **coherence** 还是 **capability** 需分别判断。

### 本质需求（grill-up 收敛结果）

> 让编辑器的「**创造 / 变换内容的动作**」都有顺滑、可感知的反馈（回应感），覆盖两类：
> ① **block 级** —— 插入 / 删除 / 拖拽落位；
> ② **内容插入** —— `#tag`+Enter、`/` 斜杠命令+Enter、`[[page]]`+Enter 等语法确认瞬间。

反证：满足该需求**不必**先造一整套「动画系统」——把 `--transition-*` token 真正用起来 + 1–2 个共享 block 进出过渡 + 拖拽 FLIP 工具即可。「设计动画系统」将手段（系统）当成了目标。

### 用户明确定性

- 目标非「统一现有动效」（coherence 单列），而是**整体更有质感**的质变。
- 质感落点 = **交互有回应感**，且明确扩展到内容插入瞬间（`#foo` / `/` / `[[page]]` 的 Enter 确认）。
- 手感主观，故采用 **Demo 优先**：先做对比原型定手感，再定系统范围。

## 决策

### D1：需求锚点 = 编辑器回应感，非「动画系统」

后续所有相关工作的锚点为上节「本质需求」。任何「加动画系统」的提案须先回指此需求论证必要性。

### D2：Demo 优先路径

1. 先交付独立单文件 HTML 对比 Demo（静止现状 vs 轻动效提案），覆盖 block 增删/拖拽 + 内容插入（`#` / `/` / `[[`）。
2. 用户据 Demo 定手感参数（时长 / 缓动 / 强度）。
3. **系统范围待 Demo 后确定**：最小可用层（token 收口 + 共享 block 过渡 + 拖拽 FLIP）vs 完整可复用系统，二者择一，届时另立实施 ADR。

### D3：既有 token 为单一事实源

无论最终形态，`--transition-*` 系列（及对应 SCSS mixin）是动效时长的唯一来源；新动效禁止写死 `ms` 字面量，沿用 ADR-0012 / ADR-0032 的 token 与 z-index 治理约束。

### D4：锁定的手感参数（Demo 实测，2026-10-01）

用户通过 `prototypes/motion-feel-demo.html` 双栏对比后锁定：

| 参数 | 值 | 说明 |
|---|---|---|
| 时长 Duration | **300ms** | 偏从容、可感知，非即时硬切 |
| 强度 Intensity | **2.0×** | 位移/缩放幅度最大档（入场位移约 ±20px、chip 入场 scale .85→1） |
| 缓动 Easing | ease-out-soft `cubic-bezier(.22,1,.36,1)`（默认，用户未单独指定） | 入场减速收尾，无回弹 |

> 注：用户仅显式指定时长与强度；缓动沿用 Demo 默认 ease-out-soft，如需 spring 回弹可改。

### D5：最小共享层落地（2026-10-01）

按「建最小共享层」确认实施，采用 **token 驱动的纯 CSS 动画**，不引入 Vue `<Transition>` 包裹（避免与 Sortable 的 DOM 操作冲突）：

- **token（`:root`，`src/styles/tokens/_components.scss`）**：`--motion-duration: 300ms`、`--motion-ease: cubic-bezier(.22,1,.36,1)`、`--motion-intensity: 2`、`--motion-distance: calc(10px * var(--motion-intensity))`。
- **顺带修复**：`_mixins.scss` 引用的 `--transition-base/fast/slow` 此前从未定义为 CSS 变量（仅 primitives 里有 SCSS 变量），导致三个 transition mixin 静默失效；已在 `:root` 补齐映射（值沿用 primitives，不改变既有观感）。
- **动画工具（`src/styles/components/_block.scss`）**：`block-enter`（block 挂载时下滑淡入）、`motion-pop`（chip 生成时 pop-in）；挂到 `.block` / `.block-tag` / `.block-link`。keyed 复用保证内容更新不重播，仅新节点挂载播放一次。
- **拖拽**：`BlockDraggableList.vue` 的 Sortable `:animation` 由 `200` 提到 `300`，对齐锁定时长（缓动 Sortable 内部固定，无法精确匹配 ease-out-soft）。
- **覆盖的「回应感」**：① block 插入（下滑淡入）② `#tag`+Enter、`[[page]]`+Enter 的内容插入 chip pop-in ③ 拖拽落位 300ms（Sortable 内置）。
- **未覆盖 / 遗留**：
  - **删除动画**：必须靠 Vue `<Transition>`（CSS 无法延迟卸载），而 `<Transition>` 与 Sortable 的 DOM 共存需在**运行中的 app** 验证，本回合未盲改高频区。下一刀做。
  - **`/` 斜杠命令插入**：插入的是 block，已被 `block-enter` 覆盖；无需额外处理。
  - **chip 加载闪入**：`motion-pop` 也会在初始加载时对已有 chip 播放一次（无 JS 门控），若用户觉得载入闪动过多可加门控。

## 待决 / Open Questions


- 系统范围：最小共享层 vs 完整系统（手感参数已锁定，**待用户确认**，见对话决策题）。
- 内容插入动效在 TipTap/ProseMirror 层的落点：inline decoration 变换（`#foo` 文本 → tag chip）的动画载体需与编辑器渲染层协调（关联 ADR-0050 D11 的 inline tag 渲染约束）。
- 是否纳入「页面 / 视图转场」「hover / 选中」等更广表面（用户当前明确排除，仅聚焦创造/变换瞬间）。

## 关联

- ADR-0012（token 治理）、ADR-0032（z-index 分层）、ADR-0050（inline tag 渲染约束）。
- 载体：本 ADR（对话来源的决策锚点，非 issue）。
