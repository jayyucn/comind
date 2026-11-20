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

function mountToolbar(wrapPageRef?: { enabled: boolean; hint?: string } | null) {
  return mount(InlineFormatToolbar, {
    attachTo: document.body,
    props: {
      range,
      rangeRect: { left: 40, top: 200, width: 60, height: 18 },
      rangeFormat: {},
      wrapPageRef,
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

  it('置灰：可渲染但不可点，title 给出判据', () => {
    const wrapper = mountToolbar({ enabled: false, hint: '选区不能作为页面名：含 | [ ] 或换行，或只有空白' })
    const button = document.querySelector(SELECTOR) as HTMLButtonElement
    expect(button).not.toBeNull()
    expect(button.disabled).toBe(true)
    expect(button.title).toContain('选区不能作为页面名')
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
