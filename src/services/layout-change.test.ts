import { describe, expect, it, vi } from 'vitest'

import { emitLayoutChange, onLayoutChange } from './layout-change'

/**
 * 布局变更广播的契约（消费方：BlockList 覆盖层 / BasePopover 锚点 / TableBlock 二级浮层）。
 * 几何行为由 e2e `tests/layout-change-reanchor.spec.ts` 覆盖，这里只锁广播语义：
 * 订阅即收到、退订即不收到、回调内退订不会打断本轮派发。
 */
describe('layout-change 广播', () => {
  it('订阅后收到广播，退订后不再收到', () => {
    const spy = vi.fn()
    const off = onLayoutChange(spy)
    emitLayoutChange()
    expect(spy).toHaveBeenCalledTimes(1)
    off()
    emitLayoutChange()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('回调里退订不会打断同一轮的其余订阅方', () => {
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = onLayoutChange(() => {
      first()
      offFirst()
    })
    const offSecond = onLayoutChange(second)
    emitLayoutChange()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    emitLayoutChange()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
    offSecond()
  })
})
