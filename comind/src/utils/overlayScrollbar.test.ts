// 全局浮层滚动条：路由切换后浮层残留的回归测试
//
// Bug：滚动容器被路由卸载（或 KeepAlive 缓存隐藏）后，浮层仍以 is-visible 钉在旧位置；
// 修复前无事件触发时需等 300ms 隐藏定时器到期才消失（短暂残留）。
// 修复：1) 事件入口校验 activeEl 是否仍实际渲染，失效即立即隐藏；
//       2) MutationObserver 兜底——DOM 卸载后微任务级立即隐藏，不等定时器/事件。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initOverlayScrollbars } from './overlayScrollbar'

function makeScrollableContainer(): HTMLElement {
  const el = document.createElement('div')
  el.style.overflowY = 'auto'
  // jsdom 无布局引擎，scrollHeight/clientHeight 恒为 0，需 mock 出「确有纵向溢出」
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 300 })
  Object.defineProperty(el, 'scrollTop', { configurable: true, value: 100 })
  document.body.appendChild(el)
  return el
}

function getOverlay(): HTMLElement | null {
  return document.querySelector('.cm-overlay-scrollbar')
}

describe('overlayScrollbar 路由切换后浮层残留', () => {
  beforeAll(() => {
    // jsdom 无布局引擎：getClientRects() 恒为空，mock 为「元素已渲染」
    const rect = {
      x: 0, y: 0, width: 10, height: 10,
      top: 0, right: 10, bottom: 10, left: 0,
    } as DOMRect
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList)
    initOverlayScrollbars()
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    // 仅移除测试容器，保留 body 上的浮层单例
    document.querySelectorAll('body > div:not(.cm-overlay-scrollbar)').forEach((el) => el.remove())
  })

  it('滚动时浮层出现（正常路径）', () => {
    const container = makeScrollableContainer()
    container.dispatchEvent(new Event('scroll'))
    expect(getOverlay()?.classList.contains('is-visible')).toBe(true)
  })

  it('容器被移除（模拟路由切换）后，移动鼠标立即隐藏浮层，不残留', () => {
    const container = makeScrollableContainer()
    container.dispatchEvent(new Event('scroll'))
    expect(getOverlay()?.classList.contains('is-visible')).toBe(true)

    // 模拟路由切换：旧容器从 DOM 卸载
    container.remove()

    // 模拟用户在新页面上持续移动鼠标（每次 mousemove 都会重置隐藏定时器，
    // 修复前浮层因此永不隐藏，残影钉在旧位置）
    for (let i = 0; i < 3; i++) {
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    }

    expect(getOverlay()?.classList.contains('is-visible')).toBe(false)
  })

  it('容器被移除且无任何后续事件（鼠标静止）时，浮层在微任务级立即隐藏，无短暂残留', async () => {
    vi.useFakeTimers() // 冻结 300ms 隐藏定时器，验证不是靠定时器到期才隐藏
    try {
      const container = makeScrollableContainer()
      container.dispatchEvent(new Event('scroll'))
      expect(getOverlay()?.classList.contains('is-visible')).toBe(true)

      // 模拟路由切换：仅卸载 DOM，之后不派发任何鼠标/滚动事件
      container.remove()

      // MutationObserver 回调在微任务 checkpoint 执行；推进 0ms 只 flush 微任务，
      // 不触发 300ms 隐藏定时器——修复前浮层仍 visible（需等定时器），修复后立即隐藏
      await vi.advanceTimersByTimeAsync(0)

      expect(getOverlay()?.classList.contains('is-visible')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
