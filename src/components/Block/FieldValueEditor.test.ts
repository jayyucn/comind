import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FieldValueEditor from './FieldValueEditor.vue'

// 可变状态：新建/编辑两种模式由各用例切换（组件只读它）
const hoisted = vi.hoisted(() => ({
  editor: {
    visible: true,
    blockId: 'test-block-id',
    initialKey: null as string | null,
    position: null as { x: number; y: number } | null
  },
  // 编辑模式读到的存量字段值行：默认用布尔值，顺带覆盖「焦点落在已选中的单选框」这条分支
  existingField: {
    id: 'fv-1',
    block_id: 'test-block-id',
    field_definition_id: 'fd-1',
    key: '测试',
    value_json: 'true' as string,
    value_type: 'boolean' as string,
    seq: 0,
    created_at: 0,
    updated_at: 0,
    version: 0,
    deleted_at: null as number | null
  }
}))

// Mock editor store
vi.mock('../../stores/editor', () => ({
  useEditorStore: () => ({
    fieldValueEditor: hoisted.editor,
    hideFieldValueEditor: vi.fn(),
    showFieldValueEditor: vi.fn()
  })
}))

// Mock field value store
vi.mock('../../stores/fieldValue', () => ({
  useFieldValueStore: () => ({
    getBlockFieldValue: () => hoisted.existingField,
    setFieldValue: vi.fn().mockResolvedValue({ id: 'fv-1' })
  })
}))

/** 挂到 document 上：默认焦点断言需要 document.activeElement（游离节点 focus 不生效） */
function mountAttached() {
  return mount(FieldValueEditor, {
    attachTo: document.body,
    global: { stubs: { Teleport: true } }
  })
}

describe('FieldValueEditor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    hoisted.editor.initialKey = null
    hoisted.existingField.value_type = 'boolean'
    hoisted.existingField.value_json = 'true'
  })

  it('renders property editor dialog', () => {
    const wrapper = mount(FieldValueEditor, {
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
    const wrapper = mount(FieldValueEditor, {
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
    hoisted.existingField.value_type = 'array'
    hoisted.existingField.value_json = '["a","b"]'
    const wrapper = mountAttached()
    await nextTick()

    const focused = document.activeElement as HTMLInputElement
    expect(focused.placeholder).toBe('输入标签，回车添加')
    expect(wrapper.findAll('.array-item').map(el => el.text())).toEqual(['a ×', 'b ×'])
    wrapper.unmount()
  })
})
