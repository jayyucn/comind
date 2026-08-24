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
        { id: 'p1', key: 'area', value: '个人', type: 'string' },
        { id: 'p2', key: 'project', value: 'Test Project', type: 'string' }
      ]),
      getPropertyDef: vi.fn((key: string) => {
        if (key === 'area') return { key: 'area', title: '领域', isBuiltIn: true, displayPosition: 'bottom-of-block' }
        if (key === 'project') return { key: 'project', title: '项目', isBuiltIn: true, displayPosition: 'bottom-of-block' }
        return undefined
      })
    }
    vi.mocked(usePropertyStore).mockReturnValue(mockStore as any)

    const wrapper = mount(PropertyDisplay, {
      props: { blockId: 'block-1' }
    })

    expect(wrapper.text()).not.toContain('领域')
    expect(wrapper.text()).toContain('个人')
    expect(wrapper.text()).toContain('🌐')
    // project 不再渲染"项目:"标签，仅显示图标+名称
    expect(wrapper.text()).not.toContain('项目')
    expect(wrapper.text()).toContain('📁')
    expect(wrapper.text()).toContain('Test Project')
  })

  it('hides properties where isHidden is true', () => {
    const mockStore = {
      getBlockProperties: vi.fn().mockReturnValue([
        { id: 'p1', key: 'area', value: '个人', type: 'string', isHidden: false },
        { id: 'p2', key: 'project', value: 'Test Project', type: 'string', isHidden: true }
      ]),
      getPropertyDef: vi.fn((key: string) => {
        if (key === 'area') return { key: 'area', title: '领域', isBuiltIn: true, displayPosition: 'bottom-of-block' }
        if (key === 'project') return { key: 'project', title: '项目', isBuiltIn: true, displayPosition: 'bottom-of-block' }
        return undefined
      })
    }
    vi.mocked(usePropertyStore).mockReturnValue(mockStore as any)

    const wrapper = mount(PropertyDisplay, {
      props: { blockId: 'block-1' }
    })

    expect(wrapper.text()).not.toContain('领域')
    expect(wrapper.text()).toContain('个人')
    expect(wrapper.text()).toContain('🌐')
    expect(wrapper.text()).not.toContain('项目')
    expect(wrapper.text()).not.toContain('Test Project')
  })

  it('applies built-in property styling', () => {
    const mockStore = {
      getBlockProperties: vi.fn().mockReturnValue([
        { id: 'p1', key: 'area', value: '个人', type: 'string' }
      ]),
      getPropertyDef: vi.fn().mockReturnValue({
        key: 'area', title: '领域', isBuiltIn: true, displayPosition: 'bottom-of-block'
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
