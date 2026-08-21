import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// 在 PageDrawer import 之前替换 Page/index.vue：真实编辑器依赖 stores/router/CodeMirror，
// 本测试只验抽屉外壳契约（显示/关闭/opened），不加载编辑器实现链
vi.mock('./index.vue', () => ({
  default: { name: 'PageIndexStub', template: '<div data-testid="page-index-stub" />' },
}))

import PageDrawer from './PageDrawer.vue'

afterEach(() => {
  document.body.querySelectorAll('.page-drawer-backdrop').forEach((n) => n.remove())
})

describe('PageDrawer (right-side page panel)', () => {
  it('renders nothing when pageId is null', () => {
    const wrapper = mount(PageDrawer, { props: { pageId: null } })
    expect(wrapper.find('.page-drawer-backdrop').exists()).toBe(false)
    expect(document.body.querySelector('.page-drawer-backdrop')).toBeFalsy()
  })

  it('renders drawer into body when pageId set and emits opened after mount', () => {
    const wrapper = mount(PageDrawer, { props: { pageId: 'p1' } })
    expect(document.body.querySelector('.page-drawer-backdrop')).toBeTruthy()
    expect(document.body.querySelector('[data-testid="page-drawer-close"]')).toBeTruthy()
    expect(document.body.querySelector('[data-testid="page-index-stub"]')).toBeTruthy()
    expect(wrapper.emitted('opened')).toBeTruthy()
  })

  it('emits close when close button clicked', async () => {
    const wrapper = mount(PageDrawer, { props: { pageId: 'p1' } })
    const btn = document.body.querySelector('[data-testid="page-drawer-close"]') as HTMLElement
    btn.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('emits close when backdrop clicked (not the drawer body)', async () => {
    const wrapper = mount(PageDrawer, { props: { pageId: 'p1' } })
    const backdrop = document.body.querySelector('.page-drawer-backdrop') as HTMLElement
    backdrop.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
