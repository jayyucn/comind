/**
 * pane 的 flex 取值（`App.vue` 的 `.pane-layout` 子项）。
 *
 * 抽出来的原因不是「三个魔法字符串」，而是一条**布局不变量**：
 * **第二个 pane 必须能被压缩到「剩余空间」，不能按内容 max-content 撑开。**
 *
 * 反例（2026-10-31 真机）：右栏 pane 原来只有 `flex-grow: 1` —— `flex-basis` 保持
 * `auto`、`.pane` 又带 `flex-shrink: 0`，于是它的宽度 = 内容 max-content。标签聚合页的
 * 看板 8 列（`min-width: 260px`）实测把右栏撑到 2224px，而 `.content-body` 只有 1575px
 * 且 `overflow-x: hidden`：多出来的列被裁在窗口外，既没有滚动条（全局关掉了）也没有
 * 横向容器可滚 —— 看板因此认为「自己不需要横滚」，翻页按钮 / 空白区平移 / ←→ 键盘
 * 三个入口同时失效（`scrollWidth - clientWidth <= 1` 直接 return）。
 *
 * 主轴的百分比 basis 在 vertical 布局下自动作用于高度，故这里不区分方向。
 */
export function paneFlexStyle(
  paneCount: number,
  index: number,
  splitRatio: number,
): Record<string, string> {
  // 单 pane：撑满容器
  if (paneCount <= 1) return { flexBasis: '100%', flexGrow: '1', flexShrink: '0' }
  // 首 pane：宽度由 splitRatio 决定，(0,0) 即「不长不缩」，拖分隔条改的是这个 basis
  if (index === 0) {
    return { flexBasis: `${(splitRatio * 100).toFixed(2)}%`, flexGrow: '0', flexShrink: '0' }
  }
  // 其余 pane：basis 0 + grow 1 = 吃掉剩余空间；shrink 1 才能被压到比内容更窄
  return { flexBasis: '0%', flexGrow: '1', flexShrink: '1' }
}
