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
      expect(vm.selectedIndex).toBe(vm.menuItems.length - 1)
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

      const overlay = wrapper.find('.base-popover-overlay')
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

      const panel = wrapper.find('.base-popover')
      expect(panel.exists()).toBe(true)
      expect(panel.attributes('style')).toContain('left: 100px')
      expect(panel.attributes('style')).toContain('top: 200px')
    })
  })

  describe('搜索排序逻辑', () => {
    test('空查询时按更新时间倒序排列，显示前10条', async () => {
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
      const filteredPages = vm.filteredPages
      
      expect(filteredPages.length).toBe(10)
      expect(filteredPages[0].title).toBe('Last Page')
      expect(filteredPages[1].title).toBe('Test Page')
    })

    test('精确匹配的结果排在最前面', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: 'Project'
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const vm = wrapper.vm as any
      const filteredPages = vm.filteredPages
      
      expect(filteredPages[0].title).toBe('PROJECT')
      expect(filteredPages[1].title).toBe('Project')
    })

    test('以查询词开头的结果排在精确匹配之后', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: 'Proj'
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const vm = wrapper.vm as any
      const filteredPages = vm.filteredPages
      
      expect(filteredPages[0].title).toBe('Proj')
      expect(filteredPages[1].title).toBe('PROJECT')
      expect(filteredPages[2].title).toBe('Project')
    })

    test('搜索不区分大小写', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: 'project'
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const vm = wrapper.vm as any
      const filteredPages = vm.filteredPages
      
      expect(filteredPages.some(p => p.title === 'Project')).toBe(true)
      expect(filteredPages.some(p => p.title === 'PROJECT')).toBe(true)
    })

    test('只显示前10条搜索结果', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: 'P'
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const vm = wrapper.vm as any
      const filteredPages = vm.filteredPages
      
      expect(filteredPages.length).toBe(10)
    })

    test('不显示已删除的页面', async () => {
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
      const filteredPages = vm.filteredPages
      
      expect(filteredPages.every(p => !p.deleted)).toBe(true)
    })

    test('菜单选项包含创建新页面选项', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: 'New Page That Does Not Exist'
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const vm = wrapper.vm as any
      const menuItems = vm.menuItems
      
      const createItem = menuItems.find(item => item.type === 'create')
      expect(createItem).toBeDefined()
      expect(createItem?.title).toBe('New Page That Does Not Exist')
    })

    test('当查询词为空时不显示创建新页面选项', async () => {
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
      const menuItems = vm.menuItems
      
      const createItem = menuItems.find(item => item.type === 'create')
      expect(createItem).toBeUndefined()
    })

    test('当查询词已存在时不显示创建新页面选项', async () => {
      const wrapper = mount(PageLinkMenu, {
        props: {
          visible: true,
          position: { x: 100, y: 200 },
          range: { from: 10, to: 20 },
          query: 'Project'
        },
        global: {
          stubs: {
            Teleport: { template: '<div><slot /></div>' }
          }
        }
      })

      await flushPromises()

      const vm = wrapper.vm as any
      const menuItems = vm.menuItems
      
      const createItem = menuItems.find(item => item.type === 'create')
      expect(createItem).toBeUndefined()
    })
  })
})
