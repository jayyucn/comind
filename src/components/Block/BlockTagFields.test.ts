/**
 * 块字段渲染载体测试（ADR-0050 D1「挂载即显示」+ ADR-0051 D6 职责全迁）。
 *
 * 接缝：只 mock `src/wasm/client` 边界；tags / fieldValue / editor 三个真 store 全真。
 * 覆盖 `list` / `between` / `chips` / `book-note` 四种 variant：
 * - `list`：Tag 字段区（有效字段并集、空占位、隐藏规则、status 去重）
 * - `between`：内联槽（status 图标、单击循环、长按弹快捷编辑器）
 * - `chips`：行尾 chips（前 2 个 + 「+N」浮层）
 * - `book-note`：书笔记来源行
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
    getProperties: vi.fn(),
    setProperty: vi.fn(),
    deleteProperty: vi.fn(),
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
    default_value: null,
    hide_when: 'never',
    ...over,
  }
}

/** 库内 FieldValue 行（新形状：value_json / value_type，无 value/type/...）。 */
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

// 任务：自身字段 [状态]；开发任务：自身 [工时]，继承父 项目 的 [负责人]
const SYSTEM_TASK = treeEntry({
  id: 'sys-tag-system-task',
  title: '任务',
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

describe('BlockTagFields（块字段渲染载体）', () => {
  let BlockTagFields: typeof import('./BlockTagFields.vue').default
  let useFieldValueStore: typeof import('../../stores/fieldValue').useFieldValueStore
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
    useFieldValueStore = (await import('../../stores/fieldValue')).useFieldValueStore
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

  afterEach(() => {
    document.body.innerHTML = ''
  })

  async function mountList(blockId: string, tagIds: string[]) {
    const wrapper = mount(BlockTagFields, { props: { blockId, tagIds } })
    await flushPromises()
    return wrapper
  }

  // ── list 变体：Tag 字段区（ADR-0050 D1）──────────────────────

  it('未挂标签的块不渲染字段区（挂载即显示的另一面）', async () => {
    const wrapper = await mountList('b1', [])
    expect(wrapper.find('.block-tag-fields').exists()).toBe(false)
  })

  it('挂标签后出现该标签的有效字段，无值字段以空占位可填', async () => {
    const wrapper = await mountList('b1', ['t-dev'])
    const rows = wrapper.findAll('.block-tag-field-row')
    expect(rows.map((r) => r.find('.block-tag-field-title').text())).toEqual(['工时', '负责人'])
    // 两行都还没有值 → 占位
    expect(wrapper.findAll('.block-tag-field-placeholder')).toHaveLength(2)
    // 标签身份由 content 内联 chip 呈现；字段区只出字段，不重复标签名
    expect(wrapper.find('.block-tag-fields').text()).not.toContain('#开发任务')
  })

  it('已有值显示值本身，未填字段仍留占位', async () => {
    mockClient.getProperties.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'estimate', value_json: '3', value_type: 'number' }),
    ])
    const wrapper = await mountList('b1', ['t-dev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const rows = wrapper.findAll('.block-tag-field-row')
    expect(rows[0].text()).toContain('3')
    expect(rows[1].find('.block-tag-field-placeholder').exists()).toBe(true)
  })

  it('多标签字段去重：同一字段只渲染一个编辑位', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 'a', title: 'A', field_ids: ['f-owner'], effective_field_ids: ['f-owner'] }),
      treeEntry({ id: 'b', title: 'B', field_ids: ['f-owner'], effective_field_ids: ['f-owner'] }),
    ])

    const wrapper = await mountList('b1', ['a', 'b'])
    expect(wrapper.findAll('.block-tag-field-row')).toHaveLength(1)
  })

  it('已在内联槽渲染的字段（status / between-bullet-content）不在下方字段区重复列文字', async () => {
    const wrapper = await mountList('b1', ['sys-tag-system-task'])
    // 标签已挂 → 容器仍在
    expect(wrapper.find('.block-tag-fields').exists()).toBe(true)
    // 但 status 已被排除
    expect(wrapper.findAll('.block-tag-field-row')).toHaveLength(0)
    expect(wrapper.find('.block-tag-fields').text()).not.toContain('状态')
  })

  it('无 displayPosition 的自定义字段仍保留在下方字段区（不过度去重）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-custom', title: '自定义', field_ids: ['f-owner'], effective_field_ids: ['f-owner'] }),
    ])

    const wrapper = await mountList('b1', ['t-custom'])
    expect(wrapper.findAll('.block-tag-field-row')).toHaveLength(1)
    expect(wrapper.find('.block-tag-field-title').text()).toBe('负责人')
  })

  it('点击字段打开既有快捷字段值编辑器（位置来自触发元素）', async () => {
    const wrapper = await mountList('b1', ['t-dev'])
    const editorStore = useEditorStore()

    await wrapper.find('.block-tag-field-row').trigger('click')

    expect(editorStore.quickFieldValueEditor?.blockId).toBe('b1')
    expect(editorStore.quickFieldValueEditor?.key).toBe('estimate')
  })

  it('悬空 / 软删 tag id 不产生字段区', async () => {
    const wrapper = await mountList('b1', ['no-such-tag'])
    expect(wrapper.find('.block-tag-fields').exists()).toBe(false)
  })

  // ── 隐藏规则（ADR-0050 D18，定义级共享，逐块判定）──

  it('隐藏规则 when_empty：未填的字段行消失，已填的照常显示', async () => {
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-owner', key: 'owner', title: '负责人', hide_when: 'when_empty' }),
      fieldDef({ id: 'f-estimate', key: 'estimate', title: '工时', type: 'number' }),
    ])
    mockClient.getProperties.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'estimate', value_json: '3', value_type: 'number' }),
    ])
    const wrapper = await mountList('b1', ['t-dev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const titles = wrapper
      .findAll('.block-tag-field-row')
      .map((r) => r.find('.block-tag-field-title').text())
    // 负责人（未填 + 为空时隐藏）消失；工时（已填 + 无规则）保留
    expect(titles).toEqual(['工时'])
  })

  it('隐藏规则 always / when_default：恒隐 / 等于默认才隐（未填不算等于默认）', async () => {
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-owner', key: 'owner', title: '负责人', hide_when: 'always' }),
      fieldDef({
        id: 'f-estimate',
        key: 'estimate',
        title: '工时',
        type: 'number',
        hide_when: 'when_default',
        default_value: '8',
      }),
    ])
    // estimate 未填：即便默认是 8 也不算「等于默认」→ 占位行保留
    const wrapper = await mountList('b1', ['t-dev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    let titles = wrapper
      .findAll('.block-tag-field-row')
      .map((r) => r.find('.block-tag-field-title').text())
    expect(titles).toEqual(['工时'])

    // 填的值等于默认 8 → 行消失
    mockClient.getProperties.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'estimate', value_json: '8', value_type: 'number' }),
    ])
    const wrapper2 = await mountList('b1', ['t-dev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()
    titles = wrapper2.findAll('.block-tag-field-row').map((r) => r.find('.block-tag-field-title').text())
    expect(titles).toEqual([])

    // 填的值不等于默认 → 行保留
    mockClient.getProperties.mockResolvedValue([
      fv({ id: 'v2', block_id: 'b1', key: 'estimate', value_json: '3', value_type: 'number' }),
    ])
    const wrapper3 = await mountList('b1', ['t-dev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()
    titles = wrapper3.findAll('.block-tag-field-row').map((r) => r.find('.block-tag-field-title').text())
    expect(titles).toEqual(['工时'])
  })

  // ── between 变体：内联槽（原 PropertyInline）────────────────

  function mountBetween(blockId: string, rows: FieldValue[]) {
    useFieldValueStore().fieldValuesByBlock.set(blockId, rows)
    return mount(BlockTagFields, { props: { blockId, variant: 'between' } })
  }

  it('between：以内联槽渲染 status 图标', () => {
    const wrapper = mountBetween('b1', [
      fv({ id: 'v1', block_id: 'b1', key: 'status', value_json: 'Todo' }),
    ])
    expect(wrapper.find('.property-inline').exists()).toBe(true)
    expect(wrapper.findAll('.property-inline-item')).toHaveLength(1)
    expect(wrapper.find('.property-icon').exists()).toBe(true)
  })

  it('between：单击 status 按 Todo → Doing → Done 循环落库', async () => {
    const wrapper = mountBetween('b1', [
      fv({ id: 'v1', block_id: 'b1', key: 'status', value_json: 'Todo' }),
    ])
    const fieldValueStore = useFieldValueStore()
    const spy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)

    await wrapper.find('.property-inline-item').trigger('click')

    expect(spy).toHaveBeenCalledWith('b1', 'status', 'Doing', 'string')
  })

  it('between：长按 500ms 弹快捷字段值编辑器', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mountBetween('b1', [
        fv({ id: 'v1', block_id: 'b1', key: 'status', value_json: 'Todo' }),
      ])
      const editorStore = useEditorStore()
      const spy = vi.spyOn(editorStore, 'showQuickFieldValueEditor')

      const item = wrapper.find('.property-inline-item')
      await item.trigger('pointerdown')
      expect(spy).not.toHaveBeenCalled()

      vi.advanceTimersByTime(500)
      expect(spy).toHaveBeenCalledWith(
        'b1',
        'status',
        expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  // ── chips 变体：行尾 chips（原 PropertyDisplay variant="chips"）──

  it('chips：只显示前 2 个字段，其余折进「+N」徽标与浮层', async () => {
    const wrapper = mount(BlockTagFields, {
      props: { blockId: 'b1', variant: 'chips' },
    })
    useFieldValueStore().fieldValuesByBlock.set('b1', [
      fv({ id: 'v1', block_id: 'b1', key: 'book', value_json: '测试书' }),
      fv({ id: 'v2', block_id: 'b1', key: 'chapter', value_json: '第一章' }),
      fv({ id: 'v3', block_id: 'b1', key: 'note', value_json: '备注值' }),
    ])
    await flushPromises()

    // 行内只显示前 2 个
    expect(wrapper.findAll('.property-item')).toHaveLength(2)

    const badge = wrapper.find('.chips-more-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('+1')

    // 点开徽标 → 浮层（Teleport 到 body）展示被收纳的第 3 个
    await badge.trigger('click')
    await flushPromises()
    const panel = document.body.querySelector('.property-list--full')
    expect(panel).not.toBeNull()
    expect(panel!.textContent).toContain('备注值')

    wrapper.unmount()
  })

  // ── book-note 变体：书笔记来源行（原 PropertyDisplay.book）──

  it('book-note：存在 quote 字段值时渲染书笔记来源行（Pin + 章节 + 原文引用）', async () => {
    useFieldValueStore().fieldValuesByBlock.set('b1', [
      fv({ id: 'v1', block_id: 'b1', key: 'book', value_json: '测试书' }),
      fv({ id: 'v2', block_id: 'b1', key: 'chapter', value_json: '第一章' }),
      fv({ id: 'v3', block_id: 'b1', key: 'quote', value_json: '原文摘录一句' }),
      fv({ id: 'v4', block_id: 'b1', key: 'cfi', value_json: 'epubcfi(/6/4!' }),
    ])
    const wrapper = mount(BlockTagFields, {
      props: { blockId: 'b1', variant: 'book-note' },
    })
    await flushPromises()

    const source = wrapper.find('.book-note-source')
    expect(source.exists()).toBe(true)
    expect(source.text()).toContain('第一章')
    expect(source.text()).toContain('原文摘录一句')
    // cfi 是数据源而非展示信息，不渲染原始串
    expect(wrapper.text()).not.toContain('epubcfi(')
  })
})
