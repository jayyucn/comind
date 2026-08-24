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

const mockToggleFavorite = vi.fn()
const mockIsFavorite = vi.fn(() => false)

vi.mock('../composables/useFavorites', () => ({
  useFavorites: vi.fn(() => ({
    isFavorite: mockIsFavorite,
    toggleFavorite: mockToggleFavorite,
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
    mockIsFavorite.mockReturnValue(false)
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

  describe('Favorite Toggle', () => {
    test('点击收藏按钮调用 toggleFavorite', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      const favItem = wrapper.findAll('.menu-item')[0]
      await favItem.trigger('click')
      await nextTick()

      expect(mockToggleFavorite).toHaveBeenCalledWith(mockPage.id)
    })

    test('已收藏时显示"取消收藏"', async () => {
      mockIsFavorite.mockReturnValue(true)

      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      const favItem = wrapper.findAll('.menu-item')[0]
      expect(favItem.text()).toContain('取消收藏')
    })

    test('未收藏时显示"收藏"', async () => {
      mockIsFavorite.mockReturnValue(false)

      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      const favItem = wrapper.findAll('.menu-item')[0]
      expect(favItem.text()).toContain('收藏')
    })

    test('收藏操作后关闭菜单', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      const favItem = wrapper.findAll('.menu-item')[0]
      await favItem.trigger('click')
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

      const deleteItem = wrapper.findAll('.menu-item')[1]
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
