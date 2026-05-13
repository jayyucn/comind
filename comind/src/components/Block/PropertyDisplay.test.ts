import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { usePropertyStore } from '../../stores/property'
import PropertyDisplay from './PropertyDisplay.vue'

// Mock Property Store
vi.mock('../../stores/property', () => ({
  usePropertyStore: vi.fn()
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('PropertyDisplay', () => {
  it('renders nothing when there are no properties', () => {
    const mockStore = {
      getBlockProperties: vi.fn().mockReturnValue([]),
      getPropertyDef: vi.fn()
    }
    vi.mocked(usePropertyStore).mockReturnValue(mockStore as any)

    const wrapper = mount(PropertyDisplay, {
      props: { blockId: 'block-1' }
    })

    expect(wrapper.text()).toBe('')
    expect(wrapper.find('.property-display').exists()).toBe(false)
  })

  it('renders properties when they exist', () => {
    const mockStore = {
      getBlockProperties: vi.fn().mockReturnValue([
        { id: 'p1', key: 'status', value: 'Todo', type: 'string' },
        { id: 'p2', key: 'priority', value: 'High', type: 'string' }
      ]),
      getPropertyDef: vi.fn((key: string) => {
        if (key === 'status') return { key: 'status', title: '状态', isBuiltIn: true }
        if (key === 'priority') return { key: 'priority', title: '优先级', isBuiltIn: true }
        return undefined
      })
    }
    vi.mocked(usePropertyStore).mockReturnValue(mockStore as any)

    const wrapper = mount(PropertyDisplay, {
      props: { blockId: 'block-1' }
    })

    expect(wrapper.text()).toContain('状态')
    expect(wrapper.text()).toContain('Todo')
    expect(wrapper.text()).toContain('优先级')
    expect(wrapper.text()).toContain('High')
  })

  it('hides properties where isHidden is true', () => {
    const mockStore = {
      getBlockProperties: vi.fn().mockReturnValue([
        { id: 'p1', key: 'status', value: 'Todo', type: 'string', isHidden: false },
        { id: 'p2', key: 'priority', value: 'High', type: 'string', isHidden: true }
      ]),
      getPropertyDef: vi.fn((key: string) => {
        if (key === 'status') return { key: 'status', title: '状态', isBuiltIn: true }
        if (key === 'priority') return { key: 'priority', title: '优先级', isBuiltIn: true }
        return undefined
      })
    }
    vi.mocked(usePropertyStore).mockReturnValue(mockStore as any)

    const wrapper = mount(PropertyDisplay, {
      props: { blockId: 'block-1' }
    })

    expect(wrapper.text()).toContain('状态')
    expect(wrapper.text()).not.toContain('优先级')
    expect(wrapper.text()).not.toContain('High')
  })

  it('applies built-in property styling', () => {
    const mockStore = {
      getBlockProperties: vi.fn().mockReturnValue([
        { id: 'p1', key: 'status', value: 'Todo', type: 'string' }
      ]),
      getPropertyDef: vi.fn().mockReturnValue({
        key: 'status', title: '状态', isBuiltIn: true
      })
    }
    vi.mocked(usePropertyStore).mockReturnValue(mockStore as any)

    const wrapper = mount(PropertyDisplay, {
      props: { blockId: 'block-1' }
    })

    const propertyItem = wrapper.find('.property-item')
    expect(propertyItem.classes('built-in')).toBe(true)
  })
})
