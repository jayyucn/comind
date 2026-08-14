import { describe, it, expect, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import BasePopover from './BasePopover.vue'

const mountOptions = {
  global: {
    stubs: {
      Teleport: { template: '<div><slot /></div>' },
    },
  },
}

describe('BasePopover', () => {
  let wrapper: VueWrapper | null = null

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('visible=false 时不渲染面板', () => {
    wrapper = mount(BasePopover, { props: { visible: false }, ...mountOptions })
    expect(wrapper.find('[data-testid="base-popover"]').exists()).toBe(false)
  })

  it('visible=true 时渲染面板并透传 slot 内容', async () => {
    wrapper = mount(BasePopover, {
      props: { visible: true },
      slots: { default: '<span class="slot-content">hello</span>' },
      ...mountOptions,
    })
    await nextTick()
    expect(wrapper.find('[data-testid="base-popover"]').exists()).toBe(true)
    expect(wrapper.find('.slot-content').text()).toBe('hello')
  })

  it('position 投影为面板 left/top', async () => {
    wrapper = mount(BasePopover, {
      props: { visible: true, position: { x: 120, y: 64 } },
      ...mountOptions,
    })
    await nextTick()
    const panel = wrapper.find('[data-testid="base-popover"]').element as HTMLElement
    expect(panel.style.left).toBe('120px')
    expect(panel.style.top).toBe('64px')
  })

  it('点击 overlay 空白触发 close（closeOnOverlay 默认 true）', async () => {
    wrapper = mount(BasePopover, { props: { visible: true }, ...mountOptions })
    await nextTick()
    await wrapper.find('[data-testid="base-popover-overlay"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('点击面板不触发 close（@click.stop 阻止冒泡）', async () => {
    wrapper = mount(BasePopover, { props: { visible: true }, ...mountOptions })
    await nextTick()
    await wrapper.find('[data-testid="base-popover"]').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('closeOnOverlay=false 时点击 overlay 不关闭', async () => {
    wrapper = mount(BasePopover, {
      props: { visible: true, closeOnOverlay: false },
      ...mountOptions,
    })
    await nextTick()
    await wrapper.find('[data-testid="base-popover-overlay"]').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('Escape 触发 close', async () => {
    wrapper = mount(BasePopover, { props: { visible: true }, ...mountOptions })
    await nextTick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
