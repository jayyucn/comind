import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import BasePopover from './BasePopover.vue'

/** jsdom 不做布局，offsetWidth/Height 恒为 0；测试中在面板元素上覆盖 getter 模拟真实尺寸。 */
function fakeSize(el: HTMLElement, w: number, h: number) {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => w })
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => h })
}

/** 弹层 teleport 到 body，需从 document.body 取元素。 */
function panelEl(): HTMLElement | null {
  return document.body.querySelector('[data-testid="base-popover"]') as HTMLElement | null
}

describe('BasePopover 视口收边（ADR-0009）', () => {
  afterEach(() => {
    document.body.querySelectorAll('[data-testid="base-popover-overlay"]').forEach((n) => n.remove())
  })

  it('右侧溢出时反向贴边，不超出视口', async () => {
    const w = mount(BasePopover, {
      props: { visible: true, position: { x: 99999, y: 50 } },
      slots: { default: '<div style="width:300px;height:200px">p</div>' },
      attachTo: document.body,
    })
    const panel = panelEl()!
    fakeSize(panel, 300, 200)
    await w.vm.$nextTick()
    await w.vm.$nextTick()
    const vw = window.innerWidth
    expect(panel.style.left).toBe(`${Math.min(99999, vw - 300 - 8)}px`)
    w.unmount()
  })

  it('不溢出时保持原始左锚点', async () => {
    const w = mount(BasePopover, {
      props: { visible: true, position: { x: 120, y: 50 } },
      slots: { default: '<div style="width:300px;height:200px">p</div>' },
      attachTo: document.body,
    })
    const panel = panelEl()!
    fakeSize(panel, 300, 200)
    await w.vm.$nextTick()
    await w.vm.$nextTick()
    expect(panel.style.left).toBe('120px')
    w.unmount()
  })

  it('底部溢出时反向贴边', async () => {
    const w = mount(BasePopover, {
      props: { visible: true, position: { x: 100, y: 99999 } },
      slots: { default: '<div style="width:300px;height:200px">p</div>' },
      attachTo: document.body,
    })
    const panel = panelEl()!
    fakeSize(panel, 300, 200)
    await w.vm.$nextTick()
    await w.vm.$nextTick()
    const vh = window.innerHeight
    expect(panel.style.top).toBe(`${Math.min(99999, vh - 200 - 8)}px`)
    w.unmount()
  })

  it('未提供锚点时交回 CSS（不内联定位）', async () => {
    const w = mount(BasePopover, {
      props: { visible: true },
      slots: { default: '<div>p</div>' },
      attachTo: document.body,
    })
    const panel = panelEl()!
    expect(panel.style.left).toBe('')
    expect(panel.style.top).toBe('')
    w.unmount()
  })
})

describe('BasePopover 锚点避让（ADR-0038）', () => {
  afterEach(() => {
    document.body.querySelectorAll('[data-testid="base-popover-overlay"]').forEach((n) => n.remove())
    document.body.querySelectorAll('div').forEach((n) => {
      if (n.parentElement === document.body) n.remove()
    })
  })

  function fakeAnchor(r: { left: number; top: number; right: number; bottom: number }) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    el.getBoundingClientRect = () =>
      ({
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.right - r.left,
        height: r.bottom - r.top,
        x: r.left,
        y: r.top,
        toJSON() {},
      }) as DOMRect
    return el
  }

  it('底部放置：起点对齐且不溢出时落在输入框下方', async () => {
    const anchor = fakeAnchor({ left: 100, top: 500, right: 200, bottom: 520 })
    const w = mount(BasePopover, {
      props: { visible: true, anchorEl: anchor, placement: 'bottom' },
      slots: { default: '<div style="width:300px;height:200px">p</div>' },
      attachTo: document.body,
    })
    const panel = panelEl()!
    fakeSize(panel, 300, 200)
    await w.vm.$nextTick()
    await w.vm.$nextTick()
    expect(panel.style.left).toBe('100px')
    expect(panel.style.top).toBe('524px') // 520 + ANCHOR_GAP(4)
    w.unmount()
    anchor.remove()
  })

  it('输入框贴近视口底部、面板放下方会溢出时翻到上方', async () => {
    const anchor = fakeAnchor({ left: 100, top: 700, right: 200, bottom: 720 })
    const w = mount(BasePopover, {
      props: { visible: true, anchorEl: anchor, placement: 'bottom' },
      slots: { default: '<div style="width:300px;height:200px">p</div>' },
      attachTo: document.body,
    })
    const panel = panelEl()!
    fakeSize(panel, 300, 200)
    await w.vm.$nextTick()
    await w.vm.$nextTick()
    // 720+4+200=924 > 760(视口高)-8 → 翻到上方：700-200-4=496
    expect(panel.style.top).toBe('496px')
    expect(panel.style.left).toBe('100px')
    w.unmount()
    anchor.remove()
  })

  it('右侧放置空间不足时翻到左侧', async () => {
    const anchor = fakeAnchor({ left: 900, top: 100, right: 1000, bottom: 140 })
    const w = mount(BasePopover, {
      props: { visible: true, anchorEl: anchor, placement: 'right' },
      slots: { default: '<div style="width:300px;height:200px">p</div>' },
      attachTo: document.body,
    })
    const panel = panelEl()!
    fakeSize(panel, 300, 200)
    await w.vm.$nextTick()
    await w.vm.$nextTick()
    // 1000+4+300=1304 > 1024-8 → 翻到左侧：900-300-4=596
    expect(panel.style.left).toBe('596px')
    expect(panel.style.top).toBe('100px')
    w.unmount()
    anchor.remove()
  })

  it('面板高于两侧可用空间时翻到空间更大一侧并裁剪高度、不遮锚点', async () => {
    // 复现「翻转后还是遮挡调用方」：锚点居中、面板很高，上下都放不下。
    // 应翻到空间更大的上方，并把高度裁到可用空间内，使面板底沿不越过锚点顶沿。
    const anchor = fakeAnchor({ left: 100, top: 400, right: 200, bottom: 420 })
    const w = mount(BasePopover, {
      props: { visible: true, anchorEl: anchor, placement: 'bottom' },
      slots: { default: '<div style="width:300px;height:700px">p</div>' },
      attachTo: document.body,
    })
    const panel = panelEl()!
    fakeSize(panel, 300, 700)
    // jsdom 下 scrollHeight 默认 0，需覆盖以反映真实内容高度（naturalH 依据它，避免高度抖动）
    Object.defineProperty(panel, 'scrollHeight', { configurable: true, get: () => 700 })
    await w.vm.$nextTick()
    await w.vm.$nextTick()
    // 上方可用 = 400 - GAP(4) - EDGE(8) = 388；面板裁到 388 高，贴视口顶渲染，
    // 底沿 = 8 + 388 = 396 < 锚点顶 400 → 不遮锚点
    expect(panel.style.maxHeight).toBe('388px')
    expect(panel.style.top).toBe('8px')
    expect(panel.style.left).toBe('100px')
    w.unmount()
    anchor.remove()
  })

  it('anchorEl 解析为 null 时不内联定位（交回 CSS）', async () => {
    const w = mount(BasePopover, {
      props: { visible: true, anchorEl: null, placement: 'bottom' },
      slots: { default: '<div>p</div>' },
      attachTo: document.body,
    })
    const panel = panelEl()!
    expect(panel.style.left).toBe('')
    expect(panel.style.top).toBe('')
    w.unmount()
  })
})

describe('BasePopover 并发实例隔离（模块级共享状态校验）', () => {
  afterEach(() => {
    document.body.querySelectorAll('[data-testid="base-popover-overlay"]').forEach((n) => n.remove())
  })

  it('两个并发实例各自注册独立的 scroll 监听（无共享状态干扰）', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const a = mount(BasePopover, {
      props: { visible: true, anchorEl: document.createElement('div'), placement: 'bottom' },
      attachTo: document.body,
    })
    const b = mount(BasePopover, {
      props: { visible: true, anchorEl: document.createElement('div'), placement: 'bottom' },
      attachTo: document.body,
    })
    // 等 watch(immediate) 的 nextTick 链把 attachListeners 跑完
    await a.vm.$nextTick()
    await a.vm.$nextTick()
    await b.vm.$nextTick()
    await b.vm.$nextTick()
    // 若变量真是模块级，第二实例的 attachListeners 会因 `if (onScroll) return` 早退，
    // 只注册 1 个 scroll 监听；per-instance 则应各自注册（>=2）。
    const scrollAdds = addSpy.mock.calls.filter((c) => c[0] === 'scroll').length
    expect(scrollAdds).toBeGreaterThanOrEqual(2)
    addSpy.mockRestore()
    a.unmount()
    b.unmount()
  })
})
