import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PropertyEditor from './PropertyEditor.vue'

// Mock editor store
vi.mock('../../stores/editor', () => ({
  useEditorStore: () => ({
    propertyEditor: {
      visible: true,
      blockId: 'test-block-id',
      initialKey: null
    },
    hidePropertyEditor: vi.fn(),
    showPropertyEditor: vi.fn()
  })
}))

// Mock property store
vi.mock('../../stores/property', () => ({
  usePropertyStore: () => ({
    builtInProperties: [
      { key: 'status', title: '状态', type: 'string', closedValues: [
        { value: 'Todo', label: '待办', icon: '📋' }
      ]},
      { key: 'priority', title: '优先级', type: 'string' }
    ],
    getPropertyDef: (key: string) => {
      if (key === 'status') return {
        key: 'status',
        title: '状态',
        type: 'string',
        closedValues: [{ value: 'Todo', label: '待办', icon: '📋' }]
      }
      return undefined
    },
    getBlockProperty: () => undefined,
    setProperty: vi.fn().mockResolvedValue({ id: 'prop-1' })
  })
}))

describe('PropertyEditor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders property editor dialog', () => {
    const wrapper = mount(PropertyEditor, {
      global: {
        stubs: {
          Teleport: true
        }
      }
    })

    expect(wrapper.find('.property-editor-dialog').exists()).toBe(true)
    expect(wrapper.find('.dialog-header h3').text()).toBe('添加属性')
  })

  it('shows built-in properties in dropdown', () => {
    const wrapper = mount(PropertyEditor, {
      global: {
        stubs: {
          Teleport: true
        }
      }
    })

    const options = wrapper.findAll('select option')
    expect(options.length).toBeGreaterThan(0)
  })
})
