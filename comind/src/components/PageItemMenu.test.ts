import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import PageItemMenu from './Sidebar/PageItemMenu.vue'
import ConfirmDialog from './ConfirmDialog.vue'
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

vi.mock('../composables/useFavorites', () => ({
  useFavorites: vi.fn(() => ({
    removeFavorite: vi.fn()
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

  describe('Rename Functionality', () => {
    test('点击重命名按钮发出 rename 事件', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      await wrapper.find('.menu-item').trigger('click')
      await nextTick()

      expect(wrapper.emitted('rename')).toBeDefined()
      expect(wrapper.emitted('rename')?.length).toBe(1)
    })

    test('重命名后关闭菜单', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      await wrapper.find('.menu-item').trigger('click')
      await nextTick()

      expect(wrapper.find('.menu-dropdown').exists()).toBe(false)
    })
  })

  describe('Delete Submenu', () => {
    test('点击删除项打开子菜单', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      const deleteItem = wrapper.findAll('.menu-item')[1]
      await deleteItem.trigger('click')
      await nextTick()

      expect(wrapper.find('.submenu').isVisible()).toBe(true)
    })

    test('再次点击删除项关闭子菜单', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      const deleteItem = wrapper.findAll('.menu-item')[1]
      await deleteItem.trigger('click')
      await nextTick()
      expect(wrapper.find('.submenu').isVisible()).toBe(true)

      await deleteItem.trigger('click')
      await nextTick()
      expect(wrapper.find('.submenu').exists()).toBe(false)
    })

    test('子菜单箭头图标旋转动画', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      const arrowIcon = wrapper.find('.arrow-icon')
      expect(arrowIcon.classes()).not.toContain('rotated')

      const deleteItem = wrapper.findAll('.menu-item')[1]
      await deleteItem.trigger('click')
      await nextTick()

      const rotatedArrow = wrapper.find('.arrow-icon.rotated')
      expect(rotatedArrow.exists()).toBe(true)
    })
  })

  describe('Soft Delete', () => {
    test('点击移至回收站显示确认对话框', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      const deleteItem = wrapper.findAll('.menu-item')[1]
      await deleteItem.trigger('click')
      await nextTick()

      const softDeleteItem = wrapper.find('.submenu-item')
      await softDeleteItem.trigger('click')
      await nextTick()

      const dialog = wrapper.findComponent(ConfirmDialog)
      expect(dialog.exists()).toBe(true)
      expect(dialog.props('visible')).toBe(true)
    })
  })

  describe('Permanent Delete', () => {
    test('点击永久删除显示确认对话框', async () => {
      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      await wrapper.find('.menu-trigger').trigger('click')
      await nextTick()

      const deleteItem = wrapper.findAll('.menu-item')[1]
      await deleteItem.trigger('click')
      await nextTick()

      const permanentDeleteItem = wrapper.findAll('.submenu-item')[1]
      await permanentDeleteItem.trigger('click')
      await nextTick()

      const dialogs = wrapper.findAllComponents(ConfirmDialog)
      expect(dialogs.length).toBe(2)
      expect(dialogs[1].props('visible')).toBe(true)
    })
  })

  describe('Event Propagation', () => {
    test('点击菜单按钮阻止事件冒泡', async () => {
      const clickOutsideSpy = vi.fn()
      window.addEventListener('click', clickOutsideSpy)

      const wrapper = mount(PageItemMenu, {
        props: { page: mockPage }
      })

      const event = new MouseEvent('click', { bubbles: true })
      await wrapper.find('.menu-trigger').trigger('click')

      await nextTick()
      window.removeEventListener('click', clickOutsideSpy)

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
