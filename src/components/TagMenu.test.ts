import { describe, test, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TagMenu from './TagMenu.vue'

const mockTags = [
  { id: 't1', title: 'Work', color: '--tag-color-1', deleted_at: null, is_system: false, lastUsedAt: 100 },
  { id: 't2', title: 'Workout', color: '--tag-color-2', deleted_at: null, is_system: false, lastUsedAt: 200 },
  { id: 't3', title: 'Reading', color: '--tag-color-3', deleted_at: null, is_system: false, lastUsedAt: 300 },
  { id: 't4', title: 'Deleted', color: '', deleted_at: 999, is_system: false, lastUsedAt: 400 },
]

vi.mock('../stores/tags', () => ({
  useTagsStore: vi.fn(() => ({
    allTags: mockTags.filter((t) => !t.deleted_at),
    recentTags: () =>
      [...mockTags]
        .filter((t) => !t.deleted_at)
        .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)),
  })),
}))

vi.mock('../composables/useModalKeyboard', () => ({
  pushModal: vi.fn(),
  popModal: vi.fn(),
}))

function mountMenu(query: string) {
  return mount(TagMenu, {
    props: {
      visible: true,
      position: { x: 100, y: 200 },
      range: { from: 0, to: 0 },
      query,
    },
    global: {
      stubs: { Teleport: { template: '<div><slot /></div>' } },
    },
  })
}

describe('TagMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('空查询', () => {
    test('展示最近标签列表（按 lastUsedAt 倒序），默认选中第一个', async () => {
      const wrapper = mountMenu('')
      await flushPromises()
      const vm = wrapper.vm as any
      expect(vm.menuItems.length).toBe(3)
      expect(vm.menuItems[0].title).toBe('Reading')
      expect(vm.selectedIndex).toBe(0)
    })

    test('空查询不显示创建选项', async () => {
      const wrapper = mountMenu('')
      await flushPromises()
      const vm = wrapper.vm as any
      expect(vm.menuItems.find((i: any) => i.type === 'create')).toBeUndefined()
    })
  })

  describe('过滤', () => {
    test('按标题包含过滤（不区分大小写）', async () => {
      const wrapper = mountMenu('work')
      await flushPromises()
      const vm = wrapper.vm as any
      const titles = vm.filteredTags.map((t: any) => t.title)
      expect(titles).toContain('Work')
      expect(titles).toContain('Workout')
    })

    test('已删除标签不出现', async () => {
      const wrapper = mountMenu('Deleted')
      await flushPromises()
      const vm = wrapper.vm as any
      expect(vm.filteredTags.some((t: any) => t.title === 'Deleted')).toBe(false)
    })
  })

  describe('创建选项', () => {
    test('有匹配的标签时不显示创建选项', async () => {
      const wrapper = mountMenu('Work')
      await flushPromises()
      const vm = wrapper.vm as any
      expect(vm.menuItems.find((i: any) => i.type === 'create')).toBeUndefined()
    })

    test('无匹配标签时出现创建选项', async () => {
      const wrapper = mountMenu('BrandNewTag')
      await flushPromises()
      const vm = wrapper.vm as any
      const create = vm.menuItems.find((i: any) => i.type === 'create')
      expect(create).toBeDefined()
      expect(create.title).toBe('BrandNewTag')
    })

    test('无匹配时创建选项即唯一项且默认选中（满足「出现创建选项并选中」）', async () => {
      const wrapper = mountMenu('BrandNewTag')
      await flushPromises()
      const vm = wrapper.vm as any
      expect(vm.menuItems.length).toBe(1)
      expect(vm.menuItems[0].type).toBe('create')
      expect(vm.selectedIndex).toBe(0)
    })
  })

  describe('select / close', () => {
    test('点击渲染出的列表项（鼠标）emit select 对应标题', async () => {
      const wrapper = mountMenu('')
      await flushPromises()
      const firstItem = wrapper.find('.tm-item')
      expect(firstItem.exists()).toBe(true)
      await firstItem.trigger('click')
      expect(wrapper.emitted('select')).toBeTruthy()
      expect(wrapper.emitted('select')![0]).toEqual(['Reading'])
    })

    test('点击创建项 emit select 对应标题', async () => {
      const wrapper = mountMenu('BrandNewTag')
      await flushPromises()
      const createItem = wrapper.find('.tm-item.tm-create')
      expect(createItem.exists()).toBe(true)
      await createItem.trigger('click')
      expect(wrapper.emitted('select')).toBeTruthy()
      expect(wrapper.emitted('select')![0]).toEqual(['BrandNewTag'])
    })

    test('confirmSelect 在有选项时 emit select 选中项标题', async () => {
      const wrapper = mountMenu('BrandNewTag')
      await flushPromises()
      const vm = wrapper.vm as any
      vm.confirmSelect()
      expect(wrapper.emitted('select')).toBeTruthy()
      expect(wrapper.emitted('select')![0]).toEqual(['BrandNewTag'])
    })

    test('close 时 emit close', async () => {
      const wrapper = mountMenu('')
      await flushPromises()
      const vm = wrapper.vm as any
      vm.close()
      expect(wrapper.emitted('close')).toBeTruthy()
    })

    test('query 变化时选中项重置为第一个', async () => {
      const wrapper = mountMenu('')
      await flushPromises()
      const vm = wrapper.vm as any
      vm.selectNext()
      expect(vm.selectedIndex).toBe(1)
      await wrapper.setProps({ query: 'Work' })
      expect(vm.selectedIndex).toBe(0)
    })
  })
})
