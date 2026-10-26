import { describe, it, expect, beforeEach } from 'vitest'

import { createPaneHistory } from './paneHistory'

describe('paneHistory（每 pane 独立导航栈，ADR-0059 D4）', () => {
  let history: ReturnType<typeof createPaneHistory>

  beforeEach(() => {
    history = createPaneHistory()
  })

  it('record：首条记录建立 [page] 栈，canGoBack/Forward 均 false', () => {
    history.record('p1', 'a')
    expect(history.canGoBack('p1')).toBe(false)
    expect(history.canGoForward('p1')).toBe(false)
  })

  it('record：连续导航顺序压栈', () => {
    history.record('p1', 'a')
    history.record('p1', 'b')
    history.record('p1', 'c')
    expect(history.back('p1')).toBe('b')
    expect(history.back('p1')).toBe('a')
    expect(history.back('p1')).toBeNull()
  })

  it('record：与栈顶当前项一致时不重复压栈', () => {
    history.record('p1', 'a')
    history.record('p1', 'b')
    history.record('p1', 'b') // 重复
    expect(history.back('p1')).toBe('a')
    expect(history.back('p1')).toBeNull()
  })

  it('back 后 forward 可回；back 后走新导航截断 forward 分支', () => {
    history.record('p1', 'a')
    history.record('p1', 'b')
    history.record('p1', 'c')
    expect(history.back('p1')).toBe('b')
    expect(history.canGoForward('p1')).toBe(true)
    expect(history.forward('p1')).toBe('c')
    expect(history.canGoForward('p1')).toBe(false)

    // 回退到 b 后走新导航 → 截断 c，栈变 [a, b, x]
    history.back('p1')
    history.record('p1', 'x')
    expect(history.canGoForward('p1')).toBe(false)
    expect(history.back('p1')).toBe('b')
    expect(history.back('p1')).toBe('a')
  })

  it('previous：只读窥视后退目标，不移动索引', () => {
    history.record('p1', 'a')
    history.record('p1', 'b')
    history.record('p1', 'c')
    // 栈顶 c，上级 = b；连续调用不改变当前位置
    expect(history.previous('p1')).toBe('b')
    expect(history.previous('p1')).toBe('b')
    expect(history.back('p1')).toBe('b')
    // 退到 b 后上级 = a；退到 a（栈首）无上级
    expect(history.previous('p1')).toBe('a')
    expect(history.back('p1')).toBe('a')
    expect(history.previous('p1')).toBeNull()
  })

  it('previous：pane 无栈时返回 null', () => {
    expect(history.previous('unknown')).toBeNull()
  })

  it('多 pane 栈相互独立', () => {
    history.record('p1', 'a')
    history.record('p1', 'b')
    history.record('p2', 'x')
    history.record('p2', 'y')
    expect(history.back('p1')).toBe('a')
    expect(history.back('p2')).toBe('x')
    expect(history.back('p1')).toBeNull()
    expect(history.back('p2')).toBeNull()
  })

  it('removePage：删除当前项钳制索引；删除更早项索引回退不漂移', () => {
    history.record('p1', 'a')
    history.record('p1', 'b')
    history.record('p1', 'c')
    history.back('p1') // 现在指向 b

    history.removePage('b') // 删除当前项
    // 栈变为 [a, c]，当前项 b 删除 → 钳到原位置（index 1 = c）
    expect(history.back('p1')).toBe('a')
    expect(history.forward('p1')).toBe('c')
  })

  it('removePage：删除更早的页不丢 forward', () => {
    history.record('p1', 'a')
    history.record('p1', 'b')
    history.record('p1', 'c')
    history.back('p1') // 指向 b
    history.removePage('a') // 删更早的 a
    // 栈 [b, c]，当前仍指向 b
    expect(history.canGoForward('p1')).toBe(true)
    expect(history.forward('p1')).toBe('c')
  })

  it('removePage：栈清空后该 pane 栈移除', () => {
    history.record('p1', 'a')
    history.removePage('a')
    expect(history.canGoBack('p1')).toBe(false)
    expect(history.canGoForward('p1')).toBe(false)
  })
})
