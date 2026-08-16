import { describe, it, expect, afterEach } from 'vitest'
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
