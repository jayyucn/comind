# ADR-0053: 动效 token 体系与双速分层（产品质感收敛）

> **状态：accepted（grill-me 收敛后实施，2026-10-04）**

## Context

ADR-0052 只覆盖了「创造/变换内容」的回应感（`--motion-*`，300ms 锁定），并明确把 hover/弹层/页面转场等更广表面留白。留白面上实际状况（已查证）：

- **160+ 处裸时长/缓动字面量**散落在 60+ 文件（80/100/120/150/180/200/220/250ms 混用，`ease`/`ease-out` 混用）；
- **`transition: all` 反模式 17+ 处**（含 `_mixins.scss` 三个 mixin、FilterPanel、Reader 域 10 处）；
- `shimmer`（IdeasList/IdeasHistoryList）与 `spin`（SettingsModal/_common.scss）keyframe 重复定义；
- 已退役风险：`$transition-*` SCSS 变量与 `--transition-*` CSS 桥接双轨并存，使用率不足四分之一；
- **零 `prefers-reduced-motion` 支持**。

用户提出「优化项目的动效，使之更具产品质感」。经 grill-me 拷问收敛：策略 = 体系 + 关键时刻双管齐下；性格 = 柔和优雅，但与高频编辑场景的矛盾用**双速分层**化解（微交互保快、门面时刻放柔）。

## 决策

### D1：双速分层（核心）

时长三档，按交互类别选档而非全局统一：

| 档 | 值 | 适用 |
|---|---|---|
| `--dur-fast` | 120ms | hover / press / focus / 右键菜单等微反馈 |
| `--dur-base` | 200ms | 折叠、勾选、一般状态切换 |
| `--dur-slow` | 260ms | 弹层 / 抽屉 / 门面进出场（柔和优雅落点） |

「创造/变换内容」回应感不受此分层约束（`--motion-duration: 300ms`，ADR-0052 锁定，独立类别）。

### D2：时长与缓动拆分为可组合 token

沿 ADR-0012/0032 治理路径：原始值进 `_primitives.scss`（`$dur-*` / `$ease-*`），语义暴露进 `_semantic.scss`（`--dur-*` / `--ease-*`）。缓动三支：

- `--ease-out = cubic-bezier(0.22, 1, 0.36, 1)` —— 与 ADR-0052 的 ease-out-soft **同值**，`--motion-ease` 改为组合引用，曲线单一事实源；
- `--ease-in = cubic-bezier(0.4, 0, 1, 1)` —— 出场加速离场；
- `--ease-in-out = cubic-bezier(0.65, 0, 0.35, 1)` —— 折叠 / 几何位移类。

选档口径：**类别优先、就近归档兜底**（微反馈一律 fast，即便原值 150-180ms；几何 resize 段配 `--ease-in-out`）。

### D3：出场永远比入场快

入场减速收尾（ease-out、档位高一级），出场加速离场（ease-in、档位低一级）——关闭动作不应拖泥带水。例外：右键/下拉菜单双向 `fast`（即时性优先）。

### D4：弹层家族统一编排

- **Modal 三兄弟**（BlockModal / SettingsModal / ConfirmDialog）：遮罩 slow 入 / base 出；面板 `translateY(4px) scale(0.97) → 1` 入，`translateY(2px) scale(0.98)` 沉退式出（幅度小于入场，收得更安静）。
- **PageDrawer**：遮罩同上；面板 slow 入 / base 出 `translateX(100%)`。
- **BasePopover / Toast**：base 入 / fast 出，位移 4px→2px。
- **RightSidebar**：保持 width 过渡 `--dur-base --ease-in-out`（工作区面板，高频切换）。

### D5：全量收敛

- 约 160 处字面量替换为 token（Reader / views / query / Block / 功能区 / 公共组件全域）；
- `transition: all` 全部按 hover/active 兄弟规则枚举实际属性；`_mixins.scss` 三个 `transition-*` mixin 删除（调用点显式化）；
- `$transition-*` / `--transition-*` / `--block-transition-collapse` 退役；
- `shimmer` 收敛进 `_common.scss` 全局定义（scoped 样式可引用全局 keyframes）；SettingsModal 本地 `spin` 删除（引用全局）。

### D6：豁免清单（不属分层体系）

`infinite` 循环动画（spin/shimmer/pulse，节奏非反馈）；`0ms` 瞬时切换（BlockDropIndicator 等）；`--motion-*`（ADR-0052）；Sortable/G6 JS 配置数字；`UNDO_FLASH_MS` 单源闪烁（JS 计时 + 动画时长共用常量，#115）；ChapterContent 的 WAAPI easing 字符串（不解析 CSS 变量）。

### D7：无障碍与 JS 闸门同步

- `_reset.scss` 新增全局 `prefers-reduced-motion: reduce` 压平（animation/transition 0.01ms + 迭代 1 次）；
- 折叠时长 300→200ms（`$dur-base`）：`useBlockCollapse.ts` 的 `COLLAPSE_ANIMATION_DURATION` 同步为 200（ADR-0045 display:none 时序闸门对齐，取小只会更早收布局，安全）。

## 验证

- `npm run build`（vue-tsc + vite）通过；
- 单测失败项经 `git stash` 对照验证为存量问题（tags store 初始化序，与本次 CSS/常量改动无关）；
- 浏览器实测：`--dur-*`/`--ease-*` 全部正确解析，`.bullet-dot` 计算样式含 `0.12s cubic-bezier(0.22, 1, 0.36, 1)`，`--motion-duration` 保持 300ms，弹层开合正常。

## 待决 / Open Questions

- **拖拽体验**（drop indicator / 拖影 / 落点反馈）：受 Sortable DOM 约束工程复杂度最高，单独一轮；
- 页面 / 视图转场（navigate-pulse 等）本轮未覆盖。

## 关联

- ADR-0012（token 治理）、ADR-0032（z-index 分层，本 ADR 的结构先例）、ADR-0045（折叠语义与 display:none 闸门）、ADR-0052（回应感动效，`--motion-*` 继续有效）。
