/**
 * BlockFieldZone string 特化分派测试（issue T6）：email 校验提示、url 可点击、
 * richtext 多行编辑、无特化零回归。接缝与 BlockFieldZone.test.ts 相同——只 mock
 * `src/wasm/client` 边界，tags / fieldValue / editor 三个真 store 全真。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import type { PersistedTagTreeEntry, PersistedFieldDefinition } from '../../types/tag-persisted'
import type { FieldValue } from '../../types/field-value'

const { mockInitCoreClient, mockClient } = vi.hoisted(() => {
  const mockClient = {
    getTagTree: vi.fn(),
    getFieldDefinitions: vi.fn(),
    getDeletedPresetFieldDefinitions: vi.fn().mockResolvedValue([]),
    restoreBuiltinPresets: vi.fn().mockResolvedValue({ restored: 0 }),
    getFieldValues: vi.fn(),
    setFieldValue: vi.fn(),
    deleteFieldValue: vi.fn(),
    getDateRefsByBlock: vi.fn().mockResolvedValue([]),
  }
  return { mockInitCoreClient: vi.fn(), mockClient }
})

vi.mock('../../wasm/client', () => ({
  initCoreClient: mockInitCoreClient,
  getCoreClient: vi.fn(),
}))

function treeEntry(over: Partial<PersistedTagTreeEntry> & { id: string; title: string }): PersistedTagTreeEntry {
  return {
    field_ids: [],
    parent_id: null,
    description: '',
    color: '',
    is_system: false,
    created_at: 1,
    updated_at: 1,
    version: 0,
    deleted_at: null,
    effective_field_ids: [],
    descendant_ids: [],
    ...over,
  }
}

function fieldDef(over: Partial<PersistedFieldDefinition> & { id: string; title: string }): PersistedFieldDefinition {
  return {
    key: over.id,
    type: 'string',
    closed_values: null,
    is_system: false,
    created_at: 1,
    updated_at: 1,
    version: 0,
    deleted_at: null,
    default_value: null,
    hide_when: 'never',
    ...over,
  }
}

function fv(over: Partial<FieldValue> & { id: string; block_id: string; key: string }): FieldValue {
  return {
    field_definition_id: over.key,
    value_json: '',
    value_type: 'string',
    seq: 0,
    created_at: 1,
    updated_at: 1,
    version: 0,
    deleted_at: null,
    ...over,
  }
}

const TAG = treeEntry({
  id: 't1',
  title: '联系',
  field_ids: ['f-email', 'f-phone', 'f-url', 'f-note', 'f-plain'],
  effective_field_ids: ['f-email', 'f-phone', 'f-url', 'f-note', 'f-plain'],
})

describe('BlockFieldZone string 特化（issue T6）', () => {
  let BlockFieldZone: typeof import('./BlockFieldZone.vue').default
  let useFieldValueStore: typeof import('../../stores/fieldValue').useFieldValueStore

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()

    vi.doMock('../../wasm/client', () => ({
      initCoreClient: mockInitCoreClient,
      getCoreClient: vi.fn(),
    }))

    BlockFieldZone = (await import('./BlockFieldZone.vue')).default
    useFieldValueStore = (await import('../../stores/fieldValue')).useFieldValueStore

    mockClient.getTagTree.mockResolvedValue([TAG])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-email', key: 'email', title: '邮箱', spec: 'email' }),
      fieldDef({ id: 'f-phone', key: 'phone', title: '电话', spec: 'phone' }),
      fieldDef({ id: 'f-url', key: 'homepage', title: '主页', spec: 'url' }),
      fieldDef({ id: 'f-note', key: 'note', title: '笔记', spec: 'richtext' }),
      fieldDef({ id: 'f-plain', key: 'plain', title: '备注' }),
    ])
    mockClient.getFieldValues.mockResolvedValue([])
    mockClient.setFieldValue.mockImplementation(async (b: string, k: string, valueJson: string, valueType: string) =>
      fv({ id: `v-${Math.random().toString(36).slice(2)}`, block_id: b, key: k, value_json: valueJson, value_type: valueType }),
    )
    mockInitCoreClient.mockResolvedValue(mockClient)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  async function mountList(blockId: string, tagIds: string[]) {
    const wrapper = mount(BlockFieldZone, { props: { blockId, tagIds } })
    await flushPromises()
    return wrapper
  }

  it('email 特化：直挂 SpecializedText（st-input），非 TextField', async () => {
    const wrapper = await mountList('b1', ['t1'])
    const row = wrapper.find('[data-field="email"]')
    expect(row.exists()).toBe(true)
    expect(row.find('[data-testid="st-input"]').exists()).toBe(true)
    expect(row.find('[data-testid="tf-input"]').exists()).toBe(false)
  })

  it('email 特化：非法输入提交出红字提示且不落库', async () => {
    const wrapper = await mountList('b1', ['t1'])
    const row = wrapper.find('[data-field="email"]')
    await row.find('[data-testid="st-input"]').setValue('不是邮箱')
    await row.find('[data-testid="st-input"]').trigger('keydown.enter')
    await flushPromises()

    expect(row.find('[data-testid="st-error"]').exists()).toBe(true)
    expect(row.find('[data-testid="st-error"]').text()).toBe('邮箱格式不正确')
    expect(mockClient.setFieldValue).not.toHaveBeenCalled()
  })

  it('email 特化：合法输入提交落库（setFieldValue 收到规范值）', async () => {
    const wrapper = await mountList('b1', ['t1'])
    const row = wrapper.find('[data-field="email"]')
    await row.find('[data-testid="st-input"]').setValue('a@b.com')
    await row.find('[data-testid="st-input"]').trigger('keydown.enter')
    await flushPromises()

    expect(row.find('[data-testid="st-error"]').exists()).toBe(false)
    expect(mockClient.setFieldValue).toHaveBeenCalledWith('b1', 'email', 'a@b.com', 'string')
  })

  it('url 特化：有值渲染可点击链接，点击走 window.open（noopener）', async () => {
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'homepage', value_json: 'example.com/page', value_type: 'string' }),
    ])
    const wrapper = await mountList('b1', ['t1'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const link = wrapper.find('[data-field="homepage"] a.block-field-zone-link')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('https://example.com/page')

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    await link.trigger('click')
    expect(openSpy).toHaveBeenCalledWith('https://example.com/page', '_blank', 'noopener,noreferrer')
  })

  it('url 特化：无值渲染占位（整行走快速编辑器，不出链接）', async () => {
    const wrapper = await mountList('b1', ['t1'])
    const row = wrapper.find('[data-field="homepage"]')
    expect(row.find('a.block-field-zone-link').exists()).toBe(false)
    expect(row.find('.block-field-zone-placeholder').exists()).toBe(true)
  })

  it('richtext 特化：点展示位进多行 textarea，blur 提交落库', async () => {
    const wrapper = await mountList('b1', ['t1'])
    const row = wrapper.find('[data-field="note"]')
    await row.find('[data-testid="bfz-richtext-placeholder"]').trigger('click')

    const textarea = row.find('[data-testid="bfz-richtext-input"]')
    expect(textarea.exists()).toBe(true)
    expect(textarea.element.tagName).toBe('TEXTAREA')

    await textarea.setValue('**粗** 正文')
    await textarea.trigger('blur')
    await flushPromises()

    expect(mockClient.setFieldValue).toHaveBeenCalledWith('b1', 'note', '**粗** 正文', 'string')
  })

  it('richtext 特化：有值渲染最小 markdown（粗体 → strong）', async () => {
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v2', block_id: 'b1', key: 'note', value_json: '**重点** 与 `<img>`', value_type: 'string' }),
    ])
    const wrapper = await mountList('b1', ['t1'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const rich = wrapper.find('[data-testid="bfz-richtext"]')
    expect(rich.exists()).toBe(true)
    expect(rich.find('strong').text()).toBe('重点')
    // HTML 输入被转义，无注入面
    expect(rich.find('img').exists()).toBe(false)
  })

  it('无 spec 的 string 字段仍走 TextField（原路径零回归）', async () => {
    const wrapper = await mountList('b1', ['t1'])
    const row = wrapper.find('[data-field="plain"]')
    expect(row.find('[data-testid="tf-input"]').exists()).toBe(true)
    expect(row.find('[data-testid="st-input"]').exists()).toBe(false)
  })
})
