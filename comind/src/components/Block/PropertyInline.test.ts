import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PropertyInline from './PropertyInline.vue'

// Mock stores
vi.mock('../../stores/property', () => ({
  usePropertyStore: () => ({
    getBlockProperties: () => [],
    getPropertyDef: () => null
  })
}))

vi.mock('../../stores/editor', () => ({
  useEditorStore: () => ({
    showPropertyEditor: vi.fn()
  })
}))

describe('PropertyInline', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders without errors', () => {
    const wrapper = mount(PropertyInline, {
      props: {
        blockId: 'test-block',
        position: 'between-bullet-content'
      }
    })
    expect(wrapper.find('.property-inline').exists()).toBe(true)
  })
})
