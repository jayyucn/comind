/**
 * 页面留白双击判定（ADR-0070 D7 补丁）。
 *
 * 真实浏览器里「双击留白就近选词」的行为由 tests/blank-area-dblclick.spec.ts 断言；
 * 这里锁判定边界：空白才拦，块内 / 有文本的元素 / 内容区之外一律放行。
 */
import { describe, expect, it } from 'vitest'

import { isBlankSurfaceDoubleClick } from './blank-double-click'

function mount(html: string): void {
  document.body.innerHTML = html
}

/** 以目标元素为事件目标构造 mousedown（detail = 2 即双击的第二下） */
function mousedownOn(el: Element, detail: number): MouseEvent {
  const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail })
  Object.defineProperty(e, 'target', { value: el })
  return e
}

describe('isBlankSurfaceDoubleClick', () => {
  it('单击（detail < 2）一律放行', () => {
    mount('<div class="pane-body"><div class="blank"></div></div>')
    expect(isBlankSurfaceDoubleClick(mousedownOn(document.querySelector('.blank')!, 1))).toBe(false)
  })

  it('内容区内的无文本容器 = 空白，需要拦', () => {
    mount('<div class="pane-body"><div class="blank"></div></div>')
    expect(isBlankSurfaceDoubleClick(mousedownOn(document.querySelector('.blank')!, 2))).toBe(true)
  })

  it('自身带文本的元素放行（标题、正文文字照常选词）', () => {
    mount('<div class="pane-body"><h1 class="title">页面标题</h1></div>')
    expect(isBlankSurfaceDoubleClick(mousedownOn(document.querySelector('.title')!, 2))).toBe(false)
  })

  it('空白文本节点（模板缩进换行）不算文本', () => {
    mount('<div class="pane-body"><div class="blank">\n   </div></div>')
    expect(isBlankSurfaceDoubleClick(mousedownOn(document.querySelector('.blank')!, 2))).toBe(true)
  })

  it('块内元素一律豁免（空段落双击要能放光标）', () => {
    mount('<div class="pane-body"><div data-block-id="b1"><p></p></div></div>')
    const el = document.querySelector('[data-block-id] p')!
    expect(isBlankSurfaceDoubleClick(mousedownOn(el, 2))).toBe(false)
  })

  it('内容区之外（侧栏 / 顶栏）不参与', () => {
    mount('<div class="sidebar-wrapper"><div class="blank"></div></div>')
    expect(isBlankSurfaceDoubleClick(mousedownOn(document.querySelector('.blank')!, 2))).toBe(false)
  })
})
