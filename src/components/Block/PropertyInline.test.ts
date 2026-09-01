import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PropertyInline from './PropertyInline.vue'

const mocks = vi.hoisted(() => ({
  setProperty: vi.fn(),
  showPropertyEditor: vi.fn(),
  showQuickPropertyEditor: vi.fn(),
  blockProperties: [] as any[],
  propertyDef: null as any,
}))

vi.mock('../../stores/property', () => ({
  usePropertyStore: () => ({
    getBlockProperties: () => mocks.blockProperties,
    getPropertyDef: () => mocks.propertyDef,
    setProperty: mocks.setProperty,
  }),
}))

vi.mock('../../stores/editor', () => ({
  useEditorStore: () => ({
    showPropertyEditor: mocks.showPropertyEditor,
    showQuickPropertyEditor: mocks.showQuickPropertyEditor,
  }),
}))

/** 挂载一个只含指定 key/value 属性的 PropertyInline */
function mountWith(key: string, value: string) {
  mocks.blockProperties = [
    {
      id: 'p1',
      blockId: 'b1',
      key,
      value,
      type: 'string',
      sortOrder: 0,
      isHidden: false,
      isDeleted: false,
      schemaVersion: 1,
      createdAt: 0,
      updatedAt: 0,
    },
  ]
  mocks.propertyDef = {
    key,
    title: key === 'status' ? '状态' : '优先级',
    type: 'string',
    isBuiltIn: true,
    displayPosition: 'between-bullet-content',
    displayStyle: 'icon',
    closedValues: [{ value, label: String(value), icon: `status-todo` }],
  }
  return mount(PropertyInline, {
    props: { blockId: 'b1', position: 'between-bullet-content' as const },
  })
}

describe('PropertyInline', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.blockProperties = []
    mocks.propertyDef = null
  })

  it('renders without errors', () => {
    const wrapper = mount(PropertyInline, {
      props: { blockId: 'test-block', position: 'between-bullet-content' },
    })
    expect(wrapper.find('.property-inline').exists()).toBe(true)
  })

  describe('status 单击循环', () => {
    it.each([
      ['Todo', 'Doing'],
      ['Doing', 'Done'],
      ['Done', 'Todo'],
    ])('%s 单击后推进到 %s', async (from, to) => {
      const wrapper = mountWith('status', from)
      await wrapper.find('.property-inline-item').trigger('click')
      expect(mocks.setProperty).toHaveBeenCalledWith('b1', 'status', to, 'string')
      // 循环路径不弹菜单
      expect(mocks.showQuickPropertyEditor).not.toHaveBeenCalled()
    })

    it.each(['Canceled', 'Archived'])('环外值 %s 单击回到 Todo', async (from) => {
      const wrapper = mountWith('status', from)
      await wrapper.find('.property-inline-item').trigger('click')
      expect(mocks.setProperty).toHaveBeenCalledWith('b1', 'status', 'Todo', 'string')
    })
  })

  describe('长按 500ms 弹菜单', () => {
    it('按住到 500ms 弹出快捷菜单', async () => {
      vi.useFakeTimers()
      try {
        const wrapper = mountWith('status', 'Todo')
        await wrapper.find('.property-inline-item').trigger('pointerdown')
        expect(mocks.showQuickPropertyEditor).not.toHaveBeenCalled()

        vi.advanceTimersByTime(500)
        expect(mocks.showQuickPropertyEditor).toHaveBeenCalledWith(
          'b1',
          'status',
          expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('未到 500ms 就松手则不弹菜单', async () => {
      vi.useFakeTimers()
      try {
        const wrapper = mountWith('status', 'Todo')
        const item = wrapper.find('.property-inline-item')
        await item.trigger('pointerdown')
        vi.advanceTimersByTime(300)
        await item.trigger('pointerup')
        vi.advanceTimersByTime(500)
        expect(mocks.showQuickPropertyEditor).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('长按已弹菜单后，随后的 click 被吞掉（不触发循环）', async () => {
      vi.useFakeTimers()
      try {
        const wrapper = mountWith('status', 'Todo')
        const item = wrapper.find('.property-inline-item')
        await item.trigger('pointerdown')
        vi.advanceTimersByTime(500)
        await item.trigger('click')
        expect(mocks.setProperty).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('非 status 内置属性单击仍走快捷菜单（原行为不变）', async () => {
    const wrapper = mountWith('priority', 'High')
    await wrapper.find('.property-inline-item').trigger('click')
    expect(mocks.showQuickPropertyEditor).toHaveBeenCalled()
    expect(mocks.setProperty).not.toHaveBeenCalled()
  })
})
