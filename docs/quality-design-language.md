# 质感设计语言（Quality Design Language）

> 状态：已采纳（accepted）  ·  范围：通用层 + 浮层（Layer 1+2）+ 业务模块卡片（Layer 3，见 §8）
> 关联：AGENTS.md（简约/范围纪律）、ADR-0032（禁硬编码 z-index/色值）、token 单源治理
> 决策来源：grill-up「整体项目提升质感」→ 先评估、后决策；本文件为决策依据。

---

## 1. 目标与边界

**目标**：在现有 Logseq 式**极简扁平**基调上，用系统化的「层次」原语提升质感——克制、不浮夸，且**在亮/暗双主题都成立**。

**明确不做（避免范围蔓延）**：
- 不引入玻璃拟态、霓虹发光、拟物等强风格（维度③④⑤ 仅作演示，不落地）。
- 不重做配色、不增删强调色。
- 不触碰业务模块（TaskHub / Block / Reader 等）的**布局与逻辑**——Layer 3 仅**叠加质感层**（光照/动效 token 化），不改 DOM 结构与交互逻辑。

**验收标尺（可核对）**：浮层在双主题都「读得出」浮起；按钮 hover 有物理反馈；输入框静止态有雕刻感；无任何组件因质感改动而回归；所有视觉值走 `var(--*)` 单源，零硬编码色值/长度字面。

---

## 2. 核心原理：质感原语必须「主题反转」

上一轮方案（已丢弃）失败的根因：**单一高光技术无法在双主题都成立**。

| 技术 | 亮色（白底 #fff） | 暗色（近黑 #1A1A1E） |
|---|---|---|
| 白色 inset 顶部高光 | 白 on 白 → ΔE≈0，**不可见** | 白 on 近黑 → **可见** |
| 黑色投影抬升 | 黑 on 白 → **可见** | 黑 on 近黑 → ΔE≈0，**不可见** |

结论：
- **顶部高光**的颜色必须随主题反转——亮色用极淡**暗线**，暗色用极淡**亮线**。
- **抬升**的承载方式随主题分治——亮色靠投影，暗色靠「顶部高光 + 边框加强」（投影在暗底几乎无效）。

---

## 3. 质感原语（单源 token，双主题）

新增于 `src/styles/tokens/_semantic.scss`（`:root` 与 `[data-theme="dark"]` 各一份）；缓动原始值进 `_primitives.scss`（`$ease-spring`，ADR-0053 D2），主题成对的渐变/阴影原始值内联于 `_semantic.scss` 双主题段落。

| Token | 含义 | 亮色 `:root` | 暗色 `[data-theme="dark"]` |
|---|---|---|---|
| `--hairline-top` | 顶部受光高光色（主题反转） | `rgba(0, 0, 0, 0.05)` | `rgba(255, 255, 255, 0.07)` |
| `--shadow-inset-top` | 顶部内高光（单源，杜绝逐字复制） | `inset 0 1px 0 var(--hairline-top)` | 同左 |
| `--shadow-floating` | 浮层阴影 = 模态投影 + 顶部高光 | `var(--shadow-modal), var(--shadow-inset-top)` | 同左 |
| `--shadow-elevation-hover` | hover 微抬升（主题分治；暗色顶部高光组合 `--shadow-inset-top` 单源） | `0 2px 6px rgba(28, 25, 23, 0.10)` | `var(--shadow-inset-top), 0 2px 8px rgba(0,0,0,0.55)` |
| `--shadow-glow-accent` | 强调色发光（primary 按钮） | `0 1px 8px rgba(99,102,241,0.35)` | `0 1px 8px rgba(129,140,248,0.35)` |
| `--grad-surface` | 顶亮渐变表面（维度②：不再纯平） | `linear-gradient(180deg,#ffffff,#fafaf9)` | `linear-gradient(180deg,#202024,#1A1A1E)` |
| `--corner-glow` | accent 顶边光带（均匀泛入、无中心热点，任意面板尺寸观感一致；背景层，位于内容之下） | `linear-gradient(180deg, rgba(99,102,241,.055), rgba(99,102,241,.018) 8%, transparent 15%)` | `linear-gradient(180deg, rgba(129,140,248,.09), rgba(129,140,248,.03) 8%, transparent 18%)` |
| `--grad-border` | 渐变描边（维度②：替换平色 border，premium 感） | `linear-gradient(180deg, rgba(255,255,255,.95), rgba(0,0,0,.07))` | `linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,.02))` |
| `--grad-sheen` | 进度条流光扫光（infinite 循环，ADR-0053 D6 豁免；主题无关） | `linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)` | 同左 |
| `--ease-spring` | 弹入缓动（维度①：浮层/卡片入场） | `cubic-bezier(0.2,0.8,0.2,1)` | 同左（主题无关） |

既有 token 复用：`--shadow-modal`（浮层投影）、`--shadow-focus`（聚焦环）、`--border-strong`（暗色抬升的边框加强）、`--bg-hover`（列表行悬停微反馈）。

**DRY 铁律**：`inset 0 1px 0 var(--hairline-top)` 只许以 `--shadow-inset-top` 形式出现，禁止在组件里逐字复制（上一轮 code-review 硬伤）。`--grad-surface` / `--corner-glow` / `--grad-border` 同样为单源 token，组件只许引用、不得逐字写渐变。

---

## 4. 表面类型 × 质感契约

| 表面类型 | 例 | 静止态 | 交互态 |
|---|---|---|---|
| **浮层（临时）** Popover/Dropdown/Menu/Picker | BasePopover、EnumSelect、DatePicker、RelationRefEditor | `box-shadow: var(--shadow-floating)` | — |
| **强浮层** Dialog/Modal | `.dialog`、SettingsModal、NamedViewBar 弹窗 | `box-shadow: var(--shadow-floating)` | — |
| **按钮** Button | `.btn`、`.btn-primary` | 边框 + 底色 | hover：`box-shadow: var(--shadow-elevation-hover)` + `transform: translateY(-1px)`（维度①抬升）；active：`box-shadow:none; transform: scale(0.98)`（回沉） |
| **输入框** Input | `.input`、表单输入 | `box-shadow: var(--shadow-inset-top)`（雕刻感） | focus：`var(--shadow-focus), var(--shadow-inset-top)` |
| **浮层/对话框** Dialog/Popover | `.dialog`、`.base-popover` | `background: var(--corner-glow), var(--grad-surface)` + 渐变描边 + `box-shadow: var(--shadow-floating)` | 入场 `dialog-in` / `popover-fade` 弹入动画（维度①） |
| **卡片（浮起）** Board/Gallery 卡片 | `.board-card`、`.gallery-card` | `background: var(--grad-surface)`（维度②顶亮渐变） | hover：`box-shadow: var(--shadow-elevation-hover)` + `transform: translateY(-1~2px)`（维度①抬升） |
| **列表行（扁平）** 矩阵/表格行 | `.q-card`、table row | 弱底 | hover：底色位移 `var(--bg-hover)`（维度①，不做光照避免毁掉扁平列表观感） |
| **胶囊** | `.tab`、menu item | 弱底 `--surface-*` | hover：底色位移（不叠阴影，避免 ΔΕ 陷阱） |

**ΔΕ 安全**：顶部高光是**静态 inset**，不占用 hover 态；列表行 hover 只移底色，不叠高光，避免「表面 hover 吞掉嵌套控件 hover」的双层弱底陷阱。维度②的 corner-glow 以**背景层**实现（位于内容之下），绝不覆盖文字。

**维度判定原则**：是否上「光照（②）」取决于该表面是否为**浮起面**——浮起卡片/模态层吃渐变表面+角光；扁平列表行/表格行只给 hover 微反馈（①），强行光照会破坏其扁平层次。

---

## 5. 消费规范（MVP: Layer 1+2）

- **Layer 1（全局 token/mixin）**：`button-base` hover 加 `var(--shadow-elevation-hover)` + `translateY(-1px)`（维度①）；`input-base` 静止加 `var(--shadow-inset-top)`；`.dialog` 用 `var(--grad-surface)` + corner-glow + 渐变描边 + 入场动画。
- **Layer 2（浮层）**：所有 `box-shadow: var(--shadow-modal)` 的浮层面板统一替换为 `var(--shadow-floating)`（单一机械替换，单源生效）；`.base-popover` 同步吃维度②光照 + 弹入动画。
- **Layer 3（业务模块卡片）**：见 §8 应用映射。

---

## 6. 已否决的替代方案

- **「加白顶高光 + 黑投影」单一配方**：上一轮采用，亮色高光/暗色投影双双失效，已丢弃。
- **「只升级 3 个全局 mixin 即全站提质感」**：评估发现 `card` mixin 全仓仅 `.dialog` 一处消费，真实浮面多为组件独立 scoped 手写——mixin 杠杆极小，必须走 Layer 2 浮层替换 + Layer 3 逐组件。
- **维持现状极简风**：与「提升质感」诉求冲突，否决。但质感方向严格限定在「极简内更精致」，不引入强风格。

---

## 7. 决策待办（用户侧）

- ✅ Layer 3 已落地（Board/Gallery 卡片光照 + 全局动效 + 矩阵行 hover 反馈），见 §8。
- 是否将本语言沉淀为 `docs/adr/` 形式（当前为 spec，非正式 ADR）。
- 维度③玻璃拟态 / 维度④色彩鲜活 / 维度⑤列表 stagger 仅作演示（`prototypes/quality-aggressive-demo.html`），暂不落地。

---

## 8. Layer 3 业务模块 — 维度①+② 应用映射（已落地）

在 MVP（box-shadow）之上叠加**维度①动效 + 维度②表面渐变/光照**，按「是否浮起面」分级处理：

| 组件 | 表面 | 改动 |
|---|---|---|
| `BoardView.vue` `.board-card` | 浮起卡片 | `background: var(--grad-surface)`（**顺带修复原 `--bg-primary` 未定义导致透明背景的 bug**）+ hover `var(--shadow-elevation-hover)` + `translateY(-1px)`；硬编码阴影 → token |
| `GalleryView.vue` `.gallery-card` | 浮起卡片 | `background: var(--grad-surface)` + hover `var(--shadow-elevation-hover)`（硬编码阴影 → token），保留原 `translateY(-2px)` |
| `QuadrantView.vue` `.q-card` | 扁平列表行 | 不加光照；补 `:hover { background: var(--bg-hover) }` 悬停微反馈（维度①）——原先**完全无 hover 反馈** |
| `TaskProgressBar.vue` `.task-progress-fill` | 进行时填充条 | 流光扫光 `var(--grad-sheen)`（infinite 循环，ADR-0053 D6 豁免；完成态关闭） |
| `BasePopover.vue` `.base-popover` | 浮层 | `background: var(--corner-glow), var(--grad-surface)` + 渐变描边（transparent border + border-box 渐变层；面板 `overflow:auto`，滚动时描边不脱落，故不用 `::after`）+ 入场 `scale(0.96)` 弹入 |
| `.dialog` | 强浮层 | 入场 `dialog-in` 弹入（`--dur-slow` + 4px/0.97，ADR-0053 D4）+ 角光 + 渐变描边 |

**有意不做**：`TableView` 表格行、`CalendarView` 单元格属扁平网格，不做光照；`QuadrantView` 矩阵为四格 list，行级只给 hover 反馈；`.rel-tag` 等胶囊 hover 只移底色、不叠阴影（§4 ΔΕ 安全）。理由：扁平列表/网格上强光照会破坏其层次语义（维度判定原则见 §4）。

**Token 合规**：所有新增视觉值走 `--grad-surface` / `--corner-glow` / `--grad-border` / `--grad-sheen` / `--ease-spring` 单源 token，组件零硬编码色值/渐变；`prefers-reduced-motion` 由 `_reset.scss` 全局压平（ADR-0053 D7），组件不重复降级。
