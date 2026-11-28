import type { Editor } from '@tiptap/core'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import InlineFormatToolbar from './InlineFormatToolbar.vue'
import type { TextRange } from '../services/text-range'

/**
 * 「转为页面引用」按钮（D1/D3）。
 *
 * 这条判据的可见面只有三种：不渲染（跨块）、置灰 + 说明（单块但不可用）、可点。
 * 三态混淆是这类按钮最常见的坑（用户分不清「功能没有」和「这段文字不行」），
 * 所以三种状态各自钉一条。
 */
const range: TextRange = {
  anchor: { blockId: 'b1', offset: 2 },
  head: { blockId: 'b1', offset: 5 },
}

const SELECTOR = 'button[aria-label="转为页面引用"]'
const LINK_SELECTOR = 'button[aria-label="添加链接"]'

function mountToolbar(
  wrapPageRef?: { enabled: boolean; hint?: string } | null,
  link?: { enabled: boolean; hint?: string; text: string } | null,
) {
  return mount(InlineFormatToolbar, {
    attachTo: document.body,
    props: {
      range,
      rangeRect: { left: 40, top: 200, width: 60, height: 18 },
      rangeFormat: {},
      wrapPageRef,
      link,
    },
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('InlineFormatToolbar — 转为页面引用', () => {
  it('不传状态（跨 block）：按钮不渲染', () => {
    const wrapper = mountToolbar(null)
    expect(document.querySelector(SELECTOR)).toBeNull()
    wrapper.unmount()
  })

  it('置灰：可渲染但不可点，title 原样透出具体原因', () => {
    const wrapper = mountToolbar({ enabled: false, hint: '选区不能作为页面名，不能包含「[」' })
    const button = document.querySelector(SELECTOR) as HTMLButtonElement
    expect(button).not.toBeNull()
    expect(button.disabled).toBe(true)
    // 浮条只负责透传，不二次加工（文案单源在 page-name / render-text）
    expect(button.title).toBe('选区不能作为页面名，不能包含「[」')
    wrapper.unmount()
  })

  it('可用：点击抛出 wrap-page-ref', async () => {
    const wrapper = mountToolbar({ enabled: true })
    const button = document.querySelector(SELECTOR) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    button.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('wrap-page-ref')).toHaveLength(1)
    wrapper.unmount()
  })
})

/**
 * 编辑态：焦点交给一级面板时浮层不能自我收起（ADR-0071 回归）。
 *
 * 链接面板挂载即聚焦 URL 输入框，编辑器随即 `isFocused === false`；
 * 若把它当成「编辑器失焦」处理，`updatePosition` 会 hide() 并清掉二级状态，
 * 面板刚出现就消失（实测 200ms 内没了）。浮条自身与二级面板都在 `.floating-submenu`
 * 里，判据就看焦点是否落在那里面。
 */
describe('InlineFormatToolbar — 焦点进二级面板时不收起', () => {
  /** 只实现 updatePosition / state 真正会碰到的那几个成员 */
  function fakeEditor(focused: boolean) {
    return {
      isFocused: focused,
      state: {
        selection: { from: 1, to: 4 },
        doc: { content: { size: 11 } },
      },
      view: { coordsAtPos: () => ({ left: 40, right: 100, top: 200, bottom: 218 }) },
      isActive: () => false,
      getAttributes: () => ({}),
    } as unknown as Editor
  }

  function mountInEditorMode(focused: boolean) {
    return mount(InlineFormatToolbar, {
      attachTo: document.body,
      props: {
        editor: fakeEditor(focused),
        revision: 1,
        rangeFormat: {},
        link: { enabled: true, text: '飞书文档' },
      },
    })
  }

  it('编辑器失焦但焦点在二级面板里：浮层保持可见', async () => {
    const host = document.createElement('div')
    host.className = 'floating-submenu'
    const input = document.createElement('input')
    host.appendChild(input)
    document.body.appendChild(host)
    input.focus()

    const wrapper = mountInEditorMode(false)
    await wrapper.vm.$nextTick()

    expect(document.activeElement).toBe(input)
    expect(document.querySelector('.inline-format-toolbar')).not.toBeNull()
    wrapper.unmount()
  })

  it('编辑器失焦且焦点在别处：浮层收起', async () => {
    const wrapper = mountInEditorMode(false)
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.inline-format-toolbar')).toBeNull()
    wrapper.unmount()
  })
})

/**
 * 「添加链接」按钮（ADR-0071）。
 *
 * 三态与「转为页面引用」同构，但多一条闭环：点开面板 → 填 URL → 抛给宿主。
 * 按钮只是入口，真正的校验与写回都在宿主，浮层这条链不能悄悄断掉。
 */
describe('InlineFormatToolbar — 添加链接', () => {
  it('不传状态（跨块）：按钮不渲染', () => {
    const wrapper = mountToolbar(null, null)
    expect(document.querySelector(LINK_SELECTOR)).toBeNull()
    wrapper.unmount()
  })

  it('置灰：可渲染但不可点，title 透出原因', () => {
    const wrapper = mountToolbar(null, { enabled: false, hint: '选区包含已有链接，不能再次包裹', text: '' })
    const button = document.querySelector(LINK_SELECTOR) as HTMLButtonElement
    expect(button).not.toBeNull()
    expect(button.disabled).toBe(true)
    expect(button.title).toBe('选区包含已有链接，不能再次包裹')
    wrapper.unmount()
  })

  it('可用：点开面板，标题预填选区文字，填 URL 后抛出 add-link', async () => {
    const wrapper = mountToolbar(null, { enabled: true, text: '飞书文档' })
    const button = document.querySelector(LINK_SELECTOR) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    button.click()
    await wrapper.vm.$nextTick()

    const titleInput = document.querySelector('.inline-link-input') as HTMLInputElement
    expect(titleInput.value).toBe('飞书文档')

    const urlInput = document.querySelectorAll('.inline-link-input')[1] as HTMLInputElement
    urlInput.value = 'feishu.cn/docx'
    urlInput.dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()

    const applyButton = document.querySelector('.inline-link-apply') as HTMLButtonElement
    expect(applyButton.disabled).toBe(false)
    applyButton.click()
    await wrapper.vm.$nextTick()

    // 缺协议在面板里就补齐（extractHttpUrl 单源），宿主拿到的永远是可点的 http(s)
    expect(wrapper.emitted('add-link')).toEqual([['飞书文档', 'https://feishu.cn/docx']])
    wrapper.unmount()
  })
})
