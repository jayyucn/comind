import { describe, test, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import PageLinkMenu from './PageLinkMenu.vue'

const mockPages = [
  { id: 'page-1', title: 'Project Notes', updatedAt: 1000, deleted: false },
  { id: 'page-2', title: 'Project Overview', updatedAt: 2000, deleted: false },
  { id: 'page-3', title: 'Meeting Notes', updatedAt: 3000, deleted: false },
  { id: 'page-4', title: 'My Project', updatedAt: 4000, deleted: false },
  { id: 'page-5', title: 'Project', updatedAt: 5000, deleted: false },
  { id: 'page-6', title: 'Other Page', updatedAt: 6000, deleted: false },
  { id: 'page-7', title: 'Another Project Page', updatedAt: 7000, deleted: false },
  { id: 'page-8', title: 'Proj', updatedAt: 8000, deleted: false },
  { id: 'page-9', title: 'PROJECT', updatedAt: 9000, deleted: false },
  { id: 'page-10', title: 'Test Page', updatedAt: 10000, deleted: false },
  { id: 'page-11', title: 'Last Page', updatedAt: 11000, deleted: false },
]

vi.mock('../stores/pages', () => ({
  usePageStore: vi.fn(() => ({
    pages: mockPages,
    loadAllPages: vi.fn().mockResolvedValue(undefined),
    createPage: vi.fn().mockImplementation((title: string) => ({
      id: `page-${Date.now()}`,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    }))
  }))
}))

vi.mock('../composables/useModalKeyboard', () => ({
  pushModal: vi.fn(),
  popModal: vi.fn()
}))

describe('PageLinkMenu', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('component structure', () => {
    test('should expose selectNext method', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: ''
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const vm = wrapper.vm as any
      expect(typeof vm.selectNext).toBe('function')
    })

    test('should expose selectPrev method', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: ''
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const vm = wrapper.vm as any
      expect(typeof vm.selectPrev).toBe('function')
    })

    test('should expose confirmSelect method', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: ''
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const vm = wrapper.vm as any
      expect(typeof vm.confirmSelect).toBe('function')
    })

    test('should expose close method', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: ''
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const vm = wrapper.vm as any
      expect(typeof vm.close).toBe('function')
    })

    test('should have selectedIndex starting at 0', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: ''
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const vm = wrapper.vm as any
      expect(vm.selectedIndex).toBe(0)
    })
  })

  describe('keyboard navigation boundary checks', () => {
    test('selectNext should not exceed menuItems length', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: ''
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const vm = wrapper.vm as any
      for (let i = 0; i < 10; i++) {
        vm.selectNext()
      }
      expect(vm.selectedIndex).toBe(vm.menuItems.length)
    })

    test('selectPrev should not go below 0', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: ''
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const vm = wrapper.vm as any
      for (let i = 0; i < 10; i++) {
        vm.selectPrev()
      }
      expect(vm.selectedIndex).toBe(0)
    })
  })

  describe('selectItem', () => {
    test('should emit select with item title', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: ''
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const vm = wrapper.vm as any
      vm.selectItem({ title: 'Test Page', type: 'page' })

      expect(wrapper.emitted('select')).toBeTruthy()
      expect(wrapper.emitted('select')![0]).toEqual(['Test Page'])
    })
  })

  describe('close action', () => {
    test('should emit close when close is called', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: ''
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const vm = wrapper.vm as any
      vm.close()

      expect(wrapper.emitted('close')).toBeTruthy()
    })

    test('clicking overlay should emit close', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: ''
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const overlay = wrapper.find('.wiki-link-menu-overlay')
      await overlay.trigger('click.self')

      expect(wrapper.emitted('close')).toBeTruthy()
    })
  })

  describe('positioning', () => {
    test('should apply position styles correctly', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: ''
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const menu = wrapper.find('.wiki-link-menu')
      expect(menu.exists()).toBe(true)
      expect(menu.attributes('style')).toContain('left: 100px')
      expect(menu.attributes('style')).toContain('top: 200px')
    })
  })
})
