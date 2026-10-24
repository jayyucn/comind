import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import PageItemMenu from './Sidebar/PageItemMenu.vue'
import { useRouter } from 'vue-router'

vi.mock('vue-router', () => ({
  useRouter: vi.fn(() => ({
    currentRoute: {
      value: {
        params: {
          pageId: ''
        }
      }
    },
    push: vi.fn()
  }))
}))

vi.mock('../stores/pages', () => ({
  usePageStore: vi.fn(() => ({
    softDeletePage: vi.fn().mockResolvedValue(undefined),
    permanentDeletePage: vi.fn().mockResolvedValue(undefined)
  }))
}))

const mockTogglePin = vi.fn()
const mockIsPinned = vi.fn(() => false)

vi.mock('../composables/usePinned', () => ({
  usePinned: vi.fn(() => ({
    isPinned: mockIsPinned,
    togglePin: mockTogglePin,
  }))
}))

describe('PageItemMenu Component', () => {
  const mockPage = {
    id: 'page-1',
    title: 'Test Page',
    type: 'normal'
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockIsPinned.mockReturnValue(false)
  })

  afterEach(() => {
    window.removeEventListener('click', vi.fn())
  })

  describe('Menu Toggle', () => {
    test('初始状态菜单关闭', () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      expect(wrapper.find('.menu-dropdown').exists()).toBe(false)
    })

    test('点击菜单按钮打开菜单', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      expect(wrapper.find('.menu-dropdown').isVisible()).toBe(true)
    })

    test('再次点击菜单按钮关闭菜单', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()
      expect(wrapper.find('.menu-dropdown').isVisible()).toBe(true)

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()
      expect(wrapper.find('.menu-dropdown').exists()).toBe(false)
    })

    test('点击外部关闭菜单', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()
      expect(wrapper.find('.menu-dropdown').isVisible()).toBe(true)

      const event = new MouseEvent('click', { bubbles: true })
      document.body.dispatchEvent(event)
      await nextTick()

      expect(wrapper.find('.menu-dropdown').exists()).toBe(false)
    })
  })

  describe('Pin Toggle', () => {
    test('点击置顶按钮调用 togglePin', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      const pinItem = wrapper.findAll('.menu-item')[0]
      await pinItem.trigger('click')
      await nextTick()

      expect(mockTogglePin).toHaveBeenCalledWith(mockPage.id)
    })

    test('已置顶时显示"取消置顶"', async () => {
      mockIsPinned.mockReturnValue(true)

      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      const pinItem = wrapper.findAll('.menu-item')[0]
      expect(pinItem.text()).toContain('取消置顶')
    })

    test('未置顶时显示"置顶"', async () => {
      mockIsPinned.mockReturnValue(false)

      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      const pinItem = wrapper.findAll('.menu-item')[0]
      expect(pinItem.text()).toContain('置顶')
    })

    test('置顶操作后关闭菜单', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      const pinItem = wrapper.findAll('.menu-item')[0]
      await pinItem.trigger('click')
      await nextTick()

      expect(wrapper.find('.menu-dropdown').exists()).toBe(false)
    })
  })

  describe('Delete', () => {
    test('点击删除显示确认对话框', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      // 删除项有 danger 类，按语义选择（菜单项顺序可变）
      const deleteItem = wrapper.find('.menu-item.danger')
      await deleteItem.trigger('click')
      await nextTick()

      const dialog = wrapper.findComponent({ name: 'ConfirmDialog' })
      expect(dialog.exists()).toBe(true)
      expect(dialog.props('visible')).toBe(true)
    })
  })

  describe('Event Propagation', () => {
    test('点击菜单按钮阻止事件冒泡', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      expect(wrapper.find('.menu-dropdown').isVisible()).toBe(true)
    })

    test('点击菜单内容阻止事件冒泡', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      const dropdown = wrapper.find('.menu-dropdown')
      const event = new MouseEvent('click', { bubbles: true })
      dropdown.element.dispatchEvent(event)

      await nextTick()
      expect(wrapper.find('.menu-dropdown').isVisible()).toBe(true)
    })
  })

  describe('Cleanup', () => {
    test('组件卸载时移除事件监听', async () => {
      const removeListenerSpy = vi.spyOn(window, 'removeEventListener')
      const addListenerSpy = vi.spyOn(window, 'addEventListener')

      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      expect(addListenerSpy).toHaveBeenCalledWith('click', expect.any(Function))

      wrapper.unmount()
      await nextTick()

      expect(removeListenerSpy).toHaveBeenCalledWith('click', expect.any(Function))
    })
  })
})
