/**
 * 块级 Tag 字段区测试（ADR-0050 D1「挂载即显示」）。
 *
 * 接缝：只 mock `src/wasm/client` 边界；tags / property / editor 三个真 store 全真。
 * 有效字段集合由 mock 按 Rust 契约喂入（解析单源在 Rust，组件只消费）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import type { PersistedTagTreeEntry, PersistedFieldDefinition } from '../../types/tag-persisted'

const { mockInitCoreClient, mockClient } = vi.hoisted(() => {
  const mockClient = {
    getTagTree: vi.fn(),
    getFieldDefinitions: vi.fn(),
    getProperties: vi.fn(),
  }
  return { mockInitCoreClient: vi.fn(), mockClient }
})

vi.mock('../../wasm/client', () => ({
  initCoreClient: mockInitCoreClient,
  getCoreClient: vi.fn(),
}))

function treeEntry(
  over: Partial<PersistedTagTreeEntry> & { id: string; title: string },
): PersistedTagTreeEntry {
  return {
    field_ids: [],
    parent_id: null,
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

function fieldDef(
  over: Partial<PersistedFieldDefinition> & { id: string; title: string },
): PersistedFieldDefinition {
  return {
    key: over.id,
    type: 'string',
    closed_values: null,
    is_system: false,
    created_at: 1,
    updated_at: 1,
    version: 0,
    deleted_at: null,
    ...over,
  }
}

// 系统任务：自身字段 [状态]；开发任务：自身 [工时]，继承父 项目 的 [负责人]
const SYSTEM_TASK = treeEntry({
  id: 'sys-tag-system-task',
  title: '系统任务',
  field_ids: ['f-status'],
  is_system: true,
  effective_field_ids: ['f-status'],
})
const PROJECT = treeEntry({
  id: 't-project',
  title: '项目',
  field_ids: ['f-owner'],
  descendant_ids: ['t-dev'],
})
const DEV_TASK = treeEntry({
  id: 't-dev',
  title: '开发任务',
  field_ids: ['f-estimate'],
  parent_id: 't-project',
  effective_field_ids: ['f-estimate', 'f-owner'],
})

describe('BlockTagFields（块级 Tag 字段区）', () => {
  let BlockTagFields: typeof import('./BlockTagFields.vue').default
  let usePropertyStore: typeof import('../../stores/property').usePropertyStore
  let useEditorStore: typeof import('../../stores/editor').useEditorStore

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()

    vi.doMock('../../wasm/client', () => ({
      initCoreClient: mockInitCoreClient,
      getCoreClient: vi.fn(),
    }))

    BlockTagFields = (await import('./BlockTagFields.vue')).default
    usePropertyStore = (await import('../../stores/property')).usePropertyStore
    useEditorStore = (await import('../../stores/editor')).useEditorStore

    mockClient.getTagTree.mockResolvedValue([SYSTEM_TASK, PROJECT, DEV_TASK])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-status', key: 'status', title: '状态', is_system: true, closed_values: ['Todo', 'Done'] }),
      fieldDef({ id: 'f-owner', key: 'owner', title: '负责人' }),
      fieldDef({ id: 'f-estimate', key: 'estimate', title: '工时', type: 'number' }),
    ])
    mockClient.getProperties.mockResolvedValue([])
    mockInitCoreClient.mockResolvedValue(mockClient)
  })

  async function mountFields(blockId: string, tagIds: string[]) {
    const wrapper = mount(BlockTagFields, { props: { blockId, tagIds } })
    await flushPromises()
    return wrapper
  }

  it('未挂标签的块不渲染字段区（挂载即显示的另一面）', async () => {
    const wrapper = await mountFields('b1', [])
    expect(wrapper.find('.block-tag-fields').exists()).toBe(false)
  })

  it('挂标签后出现该标签的有效字段，无值字段以空占位可填', async () => {
    const wrapper = await mountFields('b1', ['t-dev'])
    const rows = wrapper.findAll('.block-tag-field-row')
    expect(rows.map((r) => r.find('.block-tag-field-title').text())).toEqual(['工时', '负责人'])
    // 两行都还没有值 → 占位
    expect(wrapper.findAll('.block-tag-field-placeholder')).toHaveLength(2)
    // 标签身份由 content 内联 chip 呈现（useContentRenderer）；字段区只出字段，不重复标签名
    expect(wrapper.find('.block-tag-fields').text()).not.toContain('#开发任务')
  })

  it('已有值显示值本身，未填字段仍留占位', async () => {
    mockClient.getProperties.mockResolvedValue([
      { id: 'p1', block_id: 'b1', key: 'estimate', value: '3', type: 'number', sort_order: 0, is_hidden: 0, is_deleted: 0, schema_version: 1, created_at: 1, updated_at: 1 },
    ])
    const wrapper = await mountFields('b1', ['t-dev'])
    await usePropertyStore().loadBlockProperties('b1')
    await flushPromises()

    const rows = wrapper.findAll('.block-tag-field-row')
    expect(rows[0].text()).toContain('3')
    expect(rows[1].find('.block-tag-field-placeholder').exists()).toBe(true)
  })

  it('多标签字段去重：同一字段只渲染一个编辑位', async () => {
    // 两个标签都携带 负责人（同一字段定义）
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 'a', title: 'A', field_ids: ['f-owner'], effective_field_ids: ['f-owner'] }),
      treeEntry({ id: 'b', title: 'B', field_ids: ['f-owner'], effective_field_ids: ['f-owner'] }),
    ])

    const wrapper = await mountFields('b1', ['a', 'b'])
    expect(wrapper.findAll('.block-tag-field-row')).toHaveLength(1)
  })

  it('点击字段打开既有快捷编辑器（位置来自触发元素）', async () => {
    const wrapper = await mountFields('b1', ['t-dev'])
    const editorStore = useEditorStore()

    await wrapper.find('.block-tag-field-row').trigger('click')

    expect(editorStore.quickPropertyEditor?.blockId).toBe('b1')
    expect(editorStore.quickPropertyEditor?.key).toBe('estimate')
  })

  it('悬空 / 软删 tag id 不产生字段区', async () => {
    const wrapper = await mountFields('b1', ['no-such-tag'])
    expect(wrapper.find('.block-tag-fields').exists()).toBe(false)
  })
})
