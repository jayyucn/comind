import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PropertyEditor from './PropertyEditor.vue'

// 可变状态：新建/编辑两种模式由各用例切换（组件只读它）
const hoisted = vi.hoisted(() => ({
  editor: {
    visible: true,
    blockId: 'test-block-id',
    initialKey: null as string | null,
    position: null as { x: number; y: number } | null
  },
  // 编辑模式读到的存量属性：默认用布尔值，顺带覆盖「焦点落在已选中的单选框」这条分支
  existingProperty: {
    id: 'prop-1',
    blockId: 'test-block-id',
    key: '测试',
    value: true as unknown,
    type: 'boolean'
  }
}))

// Mock editor store
vi.mock('../../stores/editor', () => ({
  useEditorStore: () => ({
    propertyEditor: hoisted.editor,
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
    getBlockProperty: () => hoisted.existingProperty,
    setProperty: vi.fn().mockResolvedValue({ id: 'prop-1' })
  })
}))

/** 挂到 document 上：默认焦点断言需要 document.activeElement（游离节点 focus 不生效） */
function mountAttached() {
  return mount(PropertyEditor, {
    attachTo: document.body,
    global: { stubs: { Teleport: true } }
  })
}

describe('PropertyEditor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    hoisted.editor.initialKey = null
    hoisted.existingProperty.type = 'boolean'
    hoisted.existingProperty.value = true
  })

  it('renders property editor dialog', () => {
    const wrapper = mount(PropertyEditor, {
      global: {
        stubs: {
          Teleport: true
        }
      }
    })

    expect(wrapper.find('.property-editor-panel').exists()).toBe(true)
    expect(wrapper.find('.dialog-header h3').text()).toBe('添加自定义属性')
  })

  it('shows property type dropdown', () => {
    const wrapper = mount(PropertyEditor, {
      global: {
        stubs: {
          Teleport: true
        }
      }
    })

    const typeSelect = wrapper.find('select')
    expect(typeSelect.exists()).toBe(true)
    const options = typeSelect.findAll('option')
    expect(options.length).toBeGreaterThan(0)
  })

  it('新建模式：默认聚焦属性名称 input', async () => {
    const wrapper = mountAttached()
    await nextTick()

    const nameInput = wrapper.find('input[type="text"]').element
    expect(document.activeElement).toBe(nameInput)
    wrapper.unmount()
  })

  it('编辑模式：名称与类型展示为纯文本，不渲染输入控件', async () => {
    hoisted.editor.initialKey = '测试'
    const wrapper = mountAttached()
    await nextTick()

    expect(wrapper.findAll('.form-static').map(el => el.text())).toEqual(['测试', '布尔值'])
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.find('input[type="text"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('编辑模式：默认聚焦值对应的控件（布尔 → 已选中的单选框）', async () => {
    hoisted.editor.initialKey = '测试'
    const wrapper = mountAttached()
    await nextTick()

    const focused = document.activeElement as HTMLInputElement
    expect(focused.type).toBe('radio')
    expect(focused.value).toBe('true')
    expect(focused.checked).toBe(true)
    wrapper.unmount()
  })

  it('编辑模式：默认聚焦值对应的控件（数组 → 标签输入框）', async () => {
    hoisted.editor.initialKey = '标签'
    hoisted.existingProperty.type = 'array'
    hoisted.existingProperty.value = ['a', 'b']
    const wrapper = mountAttached()
    await nextTick()

    const focused = document.activeElement as HTMLInputElement
    expect(focused.placeholder).toBe('输入标签，回车添加')
    expect(wrapper.findAll('.array-item').map(el => el.text())).toEqual(['a ×', 'b ×'])
    wrapper.unmount()
  })
})
