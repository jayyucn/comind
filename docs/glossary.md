# Glossary（术语表）

> 项目领域术语与约定的单一来源。新增术语请追加，保持简短、可检索。

## O

**浮层滚动条 (Overlay Scrollbar)**
一种滚动指示条：平时隐藏，仅在用户滚动内容或悬停于可滚动容器时浮现于内容之上，停止交互后自动淡出。它**不占用布局空间**（不挤压内容、无布局偏移），区别于常驻于滚动槽、始终占据宽度的原生滚动条。本项目实现见 `src/utils/overlayScrollbar.ts` 与 `src/styles/components/_scrollbar.scss`，作为全局默认行为覆盖所有可滚动容器（Chromium 系）。

## S

**单例浮层 (Single Overlay Instance)**
全局仅创建一个浮层 DOM 元素，按当前活动滚动容器的几何实时定位，而非为每个容器各建一个。配合事件委托实现「全局默认、零 per-element 接线」。
