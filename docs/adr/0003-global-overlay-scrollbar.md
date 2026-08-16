# 全局浮层滚动条（Overlay Scrollbar）作为默认滚动交互

Status: accepted

应用需要「仅在内容滚动/悬停时才显示滚动条、且不挤压内容布局」的全局默认行为，覆盖所有可滚动容器而非单个局部元素。当前 `src/styles/base/_reset.scss` 仅用 `::-webkit-scrollbar` 定义了常驻细滚动条（溢出即显示、占据滚动槽宽度），不满足「浮层式、不占空间」诉求。

**Considered Options**

- *沿用原生 `::-webkit-scrollbar` 固定细滚动条（当前方案）*：实现最简单，但滚动条常驻、占用滚动槽宽度挤压内容；且无法做到「平时隐藏、仅滚动时浮现」。
- *`overflow: overlay` 伪浮层*：原生支持浮层滚动条（不占布局），但 Chrome 121+ 已移除该值，WebView2/新版 Edge 不可靠，弃用。
- *第三方库（perfect-scrollbar / simplebar）*：功能完整，但引入依赖与体积，且需逐个容器挂载/初始化，违背「全局默认、零 per-element 接线」诉求。
- *自研轻量浮层滚动条（采用）*：隐藏原生滚动条（`display:none` 同时移除占位 → 零布局偏移），由单例浮层指示条 + 事件委托（`scroll` 捕获 + `mousemove`）覆盖所有可滚动容器，自动浮现/淡出/可拖拽。代码量小（约 120 行 TS + 一段 SCSS），行为语义集中、易统一调整。

**Consequences**

- 原生滚动条在所有容器被隐藏，滚动交互改由浮层指示条负责（可拖拽滚动）。
- 仅面向 Chromium 系（WebView2 / Chrome / Edge）：Firefox 经 `scrollbar-width: none` 降级为「无可见滚动条」（无浮层自动隐藏）。若需 Firefox 浮层，后续再补。
- 浮层颜色随主题令牌 `--color-scrollbar` 自动适应明暗主题；尺寸取 `--scrollbar-size`。
- 单例 + 事件委托实现「全局默认」：新增可滚动容器无需任何接线即自动生效。
- 维护点集中在 `src/utils/overlayScrollbar.ts` 与 `src/styles/components/_scrollbar.scss`；`_reset.scss` 中旧的原生滚动条规则已移除。
- 已知取舍：当前仅实现纵向浮层（横向滚动容器不显示浮层，但不影响实际滚动）；如需横向再扩展。
