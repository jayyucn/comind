import { describe, expect, it } from 'vitest'

import { paneFlexStyle } from './pane-layout'

/**
 * 分屏 pane 的伸缩规则。
 *
 * 关键回归：第二个 pane 必须**可收缩**（flex-basis 0 + shrink 1）。曾经只给 grow 1，
 * basis 停在 auto 且 CSS 里 shrink 0 —— 内容 max-content 有多大 pane 就多宽，看板因此
 * 被撑出容器（真机 2224px vs 可见 1575px），横向滚动入口全失效。
 */
describe('paneFlexStyle', () => {
  it('单 pane 撑满容器', () => {
    expect(paneFlexStyle(1, 0, 0.5)).toEqual({ flexBasis: '100%', flexGrow: '1', flexShrink: '0' })
  })

  it('首 pane 按 splitRatio 固定宽度、不参与伸缩', () => {
    expect(paneFlexStyle(2, 0, 0.3)).toEqual({ flexBasis: '30.00%', flexGrow: '0', flexShrink: '0' })
  })

  it('第二 pane 吃剩余空间，且能被压缩（basis 0 + shrink 1）', () => {
    const style = paneFlexStyle(2, 1, 0.3)
    expect(style.flexBasis).toBe('0%')
    expect(style.flexGrow).toBe('1')
    expect(style.flexShrink).toBe('1')
  })

  it('splitRatio 夹取外的值不改变伸缩语义（换算成百分比原样透传）', () => {
    expect(paneFlexStyle(2, 0, 0.125).flexBasis).toBe('12.50%')
  })
})
