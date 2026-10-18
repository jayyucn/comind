import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FieldValueEditor from './FieldValueEditor.vue'
import { useTagsStore } from '../../stores/tags'

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
  },
  setFieldValue: vi.fn().mockResolvedValue({ id: 'fv-1' }),
  // 无存量值行开关：置 true 时 getBlockFieldValue 返回 null（模拟「字段已配置类型但本块尚无值」）
  noExisting: false
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
    getBlockFieldValue: () => (hoisted.noExisting ? null : hoisted.existingField),
    setFieldValue: hoisted.setFieldValue
  })
}))

// PageRefPicker 的 ensurePagesLoaded 兜底路径会触达 client（幂等 catch，mock 掉避免真实 wasm）
vi.mock('../../wasm/client', () => ({
  initCoreClient: vi.fn(),
  getCoreClient: vi.fn()
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
    hoisted.noExisting = false
    hoisted.setFieldValue.mockClear()
    // 清空字段定义，避免跨用例污染
    useTagsStore().fieldDefinitions.splice(0, useTagsStore().fieldDefinitions.length)
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

  // ── page 引用类型（issue T3）────────────────────────────────

  it('类型下拉含「页面引用」（page）选项', () => {
    const wrapper = mount(FieldValueEditor, {
      global: { stubs: { Teleport: true } }
    })
    const options = wrapper.find('select').findAll('option')
    expect(options.some(o => o.text() === '页面引用')).toBe(true)
  })

  it('类型选 page：值区渲染 PageRefPicker（文本兜底已替换），选中页面后保存为 page 类型（AC1/AC2）', async () => {
    const { usePageStore } = await import('../../stores/pages')
    usePageStore().pages.push({
      id: 'p1', blockId: null, title: '目标页', type: 'normal', icon: null,
      cover: null, aliases: [], filePath: null, childrenCount: 0, wordCount: 0,
      createdAt: 1, updatedAt: 1, deleted: false, deletedAt: null,
    })

    const wrapper = mount(FieldValueEditor, {
      attachTo: document.body,
      global: { stubs: { Teleport: true } }
    })
    await wrapper.find('select').setValue('page')

    const trigger = wrapper.find('[data-testid="prp-trigger"]')
    expect(trigger.exists()).toBe(true)
    expect(trigger.text()).toBe('选择页面')
    // 文本兜底输入框不再渲染
    expect(wrapper.find('input[type="text"][placeholder="输入值"]').exists()).toBe(false)

    // 展开面板（Teleport 已 stub → 内容内联），选中候选
    await trigger.trigger('click')
    const option = wrapper.find('.prp-option')
    expect(option.exists()).toBe(true)
    await option.trigger('click')
    expect(wrapper.find('[data-testid="prp-trigger"]').text()).toBe('目标页')

    // 填属性名称（canSave 前置）后保存：值存 page id，类型 page
    await wrapper.find('input[placeholder="输入属性名称"]').setValue('相关页')
    expect(wrapper.find('.btn-primary').attributes('disabled')).toBeUndefined()
    await wrapper.find('.btn-primary').trigger('click')
    expect(hoisted.setFieldValue).toHaveBeenCalledTimes(1)
    const [blockId, key, value, type] = hoisted.setFieldValue.mock.calls[0]
    expect(blockId).toBe('test-block-id')
    expect(key).toBe('相关页')
    expect(value).toBe('p1')
    expect(type).toBe('page')
    wrapper.unmount()
  })

  // ── relation 关系引用（issue T5）────────────────────────────

  it('类型下拉含「关联」（relation）选项', () => {
    const wrapper = mount(FieldValueEditor, {
      global: { stubs: { Teleport: true } }
    })
    const options = wrapper.find('select').findAll('option')
    expect(options.some(o => o.text() === '关联')).toBe(true)
  })

  it('类型选 relation：值区渲染 RelationRefEditor（两段齐备才可保存），保存为 relation 类型（AC1/AC2）', async () => {
    const wrapper = mount(FieldValueEditor, {
      attachTo: document.body,
      global: { stubs: { Teleport: true } }
    })
    await wrapper.find('select').setValue('relation')

    const trigger = wrapper.find('[data-testid="rre-trigger"]')
    expect(trigger.exists()).toBe(true)
    expect(trigger.text()).toContain('未填')

    // 两段齐备前不可保存
    await wrapper.find('input[placeholder="输入属性名称"]').setValue('相关块')
    expect(wrapper.find('.btn-primary').attributes('disabled')).toBeDefined()

    // 经编辑器语义原子选定两段（Teleport 已 stub，走 expose 的原子最稳）
    const editor = wrapper.findComponent({ name: 'RelationRefEditor' })
    const api = editor.vm as unknown as { pickRelType: (id: string) => void; pickTarget: (id: string) => void }
    await api.pickRelType('rt_seed_related')
    await api.pickTarget('blk-1')
    await nextTick()

    expect(wrapper.find('.btn-primary').attributes('disabled')).toBeUndefined()
    await wrapper.find('.btn-primary').trigger('click')
    expect(hoisted.setFieldValue).toHaveBeenCalledTimes(1)
    const [blockId, key, value, type] = hoisted.setFieldValue.mock.calls[0]
    expect(blockId).toBe('test-block-id')
    expect(key).toBe('相关块')
    expect(value).toEqual({ targetId: 'blk-1', relationshipTypeId: 'rt_seed_related' })
    expect(type).toBe('relation')
    wrapper.unmount()
  })

  // ── 无存量值行时从字段定义取类型（附件后类型首次录入，issue）──

  it('编辑模式且本块无值行：类型取自字段定义而非默认 string（geo → 渲染坐标输入）', async () => {
    hoisted.editor.initialKey = '坐标'
    hoisted.noExisting = true
    // 字段设置里把「坐标」配成了 geo 类型，但本块尚未录入值
    useTagsStore().fieldDefinitions.push({
      id: 'fd-geo', key: '坐标', title: '坐标', type: 'geo',
      closed_values: null, default_value: null, hide_when: 'never',
      display_form_override: 'auto', min: null, max: null, step: null,
      spec: null, description: null,
    } as never)

    const wrapper = mountAttached()
    await nextTick()

    // 类型展示为「地理坐标」而非「文本」
    expect(wrapper.findAll('.form-static').map(el => el.text())).toEqual(['坐标', '地理坐标'])
    // 值区应渲染 geo 坐标输入（占位「纬度 lat」），而非普通文本输入框
    expect(wrapper.find('input[placeholder="纬度 lat"]').exists()).toBe(true)
    expect(wrapper.find('input[placeholder="输入值"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('编辑模式且本块无值行：字段定义类型为 color 时渲染色板而非文本框', async () => {
    hoisted.editor.initialKey = '主题色'
    hoisted.noExisting = true
    useTagsStore().fieldDefinitions.push({
      id: 'fd-color', key: '主题色', title: '主题色', type: 'color',
      closed_values: null, default_value: null, hide_when: 'never',
      display_form_override: 'auto', min: null, max: null, step: null,
      spec: null, description: null,
    } as never)

    const wrapper = mountAttached()
    await nextTick()

    expect(wrapper.findAll('.form-static').map(el => el.text())).toEqual(['主题色', '颜色'])
    // color 色板（.color-swatch 渲染）应存在
    expect(wrapper.find('.color-swatch').exists()).toBe(true)
    wrapper.unmount()
  })
})
