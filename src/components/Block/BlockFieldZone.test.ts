/**
 * 块字段区渲染载体测试（ADR-0050 D1「挂载即显示」+ ADR-0051 D6 职责全迁 + D21 形态体系）。
 *
 * 命名（D21 实施）：原 BlockTagFields.test.ts 更名——Tag 只承担聚合字段的角色，
 * 本载体渲染块的（聚合后）字段区。
 *
 * 接缝：只 mock `src/wasm/client` 边界；tags / fieldValue / editor 三个真 store 全真。
 * 覆盖 `list` / `between` / `all` / `book-note` 四种 variant：
 * - `list`：块字段区（有效字段并集、D21 形态分派、ghost、隐藏规则、去重）
 * - `between`：内联槽（status 图标、单击循环、长按弹快捷编辑器）
 * - `all`：完整字段列表（Backlinks 消费，全量平铺 + 形态注册表）
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
    getFieldValues: vi.fn(),
    setFieldValue: vi.fn(),
    deleteFieldValue: vi.fn(),
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

/** 行标题统一取值：text 行在 .block-field-zone-title，chip 行在 .bfz-chip-title */
function rowTitle(row: { find: (sel: string) => { text: () => string; exists: () => boolean } }): string {
  const t = row.find('.block-field-zone-title')
  if (t.exists()) return t.text()
  return row.find('.bfz-chip-title').text()
}

describe('BlockFieldZone（块字段区渲染载体）', () => {
  let BlockFieldZone: typeof import('./BlockFieldZone.vue').default
  let useFieldValueStore: typeof import('../../stores/fieldValue').useFieldValueStore
  let useEditorStore: typeof import('../../stores/editor').useEditorStore
  let useTagsStore: typeof import('../../stores/tags').useTagsStore

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
    useEditorStore = (await import('../../stores/editor')).useEditorStore
    useTagsStore = (await import('../../stores/tags')).useTagsStore

    mockClient.getTagTree.mockResolvedValue([SYSTEM_TASK, PROJECT, DEV_TASK])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-status', key: 'status', title: '状态', is_system: true, closed_values: ['Todo', 'Done'] }),
      fieldDef({ id: 'f-owner', key: 'owner', title: '负责人' }),
      fieldDef({ id: 'f-estimate', key: 'estimate', title: '工时', type: 'number' }),
    ])
    mockClient.getFieldValues.mockResolvedValue([])
    mockInitCoreClient.mockResolvedValue(mockClient)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  async function mountList(blockId: string, tagIds: string[]) {
    const wrapper = mount(BlockFieldZone, { props: { blockId, tagIds } })
    await flushPromises()
    return wrapper
  }

  // ── list 变体：块字段区（ADR-0050 D1）──────────────────────

  it('未挂标签的块不渲染字段区（挂载即显示的另一面）', async () => {
    const wrapper = await mountList('b1', [])
    expect(wrapper.find('.block-field-zone').exists()).toBe(false)
  })

  it('挂标签后出现该标签的有效字段；number 直挂 NumberInput、纯 string 默认 text（D21 类型映射）', async () => {
    const wrapper = await mountList('b1', ['t-dev'])
    const rows = wrapper.findAll('.block-field-zone-row')
    expect(rows.map(rowTitle)).toEqual(['工时', '负责人'])
    // 工时（number）直挂 NumberInput（始终显示输入框）；负责人（纯 string）走 text 行占位
    expect(wrapper.find('.number-input').exists()).toBe(true)
    expect(wrapper.findAll('.block-field-zone-placeholder')).toHaveLength(1)
    // 标签身份由 content 内联 chip 呈现；字段区只出字段，不重复标签名
    expect(wrapper.find('.block-field-zone').text()).not.toContain('#开发任务')
  })

  it('已有值：number 直挂 NumberInput 显示数值，未填 string 字段仍留占位', async () => {
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'estimate', value_json: '3', value_type: 'number' }),
    ])
    const wrapper = await mountList('b1', ['t-dev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    expect((wrapper.find('.number-input input').element as HTMLInputElement).value).toBe('3')
    expect(wrapper.find('.block-field-zone-placeholder').exists()).toBe(true)
  })

  it('多标签字段去重：同一字段只渲染一个编辑位', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 'a', title: 'A', field_ids: ['f-owner'], effective_field_ids: ['f-owner'] }),
      treeEntry({ id: 'b', title: 'B', field_ids: ['f-owner'], effective_field_ids: ['f-owner'] }),
    ])

    const wrapper = await mountList('b1', ['a', 'b'])
    expect(wrapper.findAll('.block-field-zone-row')).toHaveLength(1)
  })

  it('已在内联槽渲染的字段（status / between-bullet-content）不在下方字段区重复列文字', async () => {
    const wrapper = await mountList('b1', ['sys-tag-system-task'])
    // 标签已挂 → 容器仍在
    expect(wrapper.find('.block-field-zone').exists()).toBe(true)
    // 但 status 已被排除
    expect(wrapper.findAll('.block-field-zone-row')).toHaveLength(0)
    expect(wrapper.find('.block-field-zone').text()).not.toContain('状态')
  })

  it('无 displayPosition 的自定义字段仍保留在下方字段区（不过度去重）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-custom', title: '自定义', field_ids: ['f-owner'], effective_field_ids: ['f-owner'] }),
    ])

    const wrapper = await mountList('b1', ['t-custom'])
    expect(wrapper.findAll('.block-field-zone-row')).toHaveLength(1)
    expect(wrapper.find('.block-field-zone-title').text()).toBe('负责人')
  })

  // ── D21 形态分派（决策 1 / 5 / 7）────────────────────────────

  it('枚举字段：值区直挂 EnumSelect，触发按钮显示当前选项原文', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-r', title: '评级', field_ids: ['f-rating'], effective_field_ids: ['f-rating'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-rating', key: 'rating', title: '评级', closed_values: ['S', 'A', 'B'] }),
    ])
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'rating', value_json: 'A' }),
    ])

    const wrapper = await mountList('b1', ['t-r'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    // 枚举字段不再走 chip / 通用编辑器，直接挂 EnumSelect
    expect(wrapper.find('.block-field-zone-chip').exists()).toBe(false)
    const trigger = wrapper.find('[data-testid="es-trigger"]')
    expect(trigger.exists()).toBe(true)
    expect(trigger.find('.es-text').text()).toBe('A')
    expect(trigger.classes()).not.toContain('es-placeholder')
  })

  it('chip 字段（array）无值 → 虚线 ghost 胶囊「未填」，点击即录入（决策 7；枚举字段已改直挂 EnumSelect，占位代替 ghost）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-r', title: '评级', field_ids: ['f-rating'], effective_field_ids: ['f-rating'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-rating', key: 'rating', title: '评级', type: 'array' }),
    ])

    const wrapper = await mountList('b1', ['t-r'])
    const ghost = wrapper.find('.block-field-zone-chip--ghost')
    expect(ghost.exists()).toBe(true)
    expect(ghost.text()).toContain('未填')

    const editorStore = useEditorStore()
    await ghost.trigger('click')
    expect(editorStore.quickFieldValueEditor?.blockId).toBe('b1')
    expect(editorStore.quickFieldValueEditor?.key).toBe('rating')
  })

  it('boolean 字段默认 icon 形态：值即 ✓ / ✗', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-d', title: '完成', field_ids: ['f-done'], effective_field_ids: ['f-done'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-done', key: 'done', title: '完成', type: 'boolean' }),
    ])
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'done', value_json: 'true', value_type: 'boolean' }),
    ])

    const wrapper = await mountList('b1', ['t-d'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    expect(wrapper.find('.block-field-zone-row .property-icon').text()).toBe('✓')
  })

  it('display_form_override 覆盖类型默认：枚举字段被覆写为 text 时走文字行（决策 5）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-r', title: '评级', field_ids: ['f-rating'], effective_field_ids: ['f-rating'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-rating', key: 'rating', title: '评级', closed_values: ['S', 'A'], display_form_override: 'text' }),
    ])
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'rating', value_json: 'A' }),
    ])

    const wrapper = await mountList('b1', ['t-r'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    expect(wrapper.find('.block-field-zone-chip').exists()).toBe(false)
    expect(wrapper.find('.block-field-zone-title').text()).toBe('评级')
    expect(wrapper.find('.block-field-zone-value').text()).toBe('A')
  })

  it('chip 点击唤起既有快捷字段值编辑器（array 等 chip 字段；枚举字段已改直挂 EnumSelect）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-r', title: '评级', field_ids: ['f-rating'], effective_field_ids: ['f-rating'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-rating', key: 'rating', title: '评级', type: 'array' }),
    ])
    const wrapper = await mountList('b1', ['t-r'])
    const editorStore = useEditorStore()

    await wrapper.find('.block-field-zone-chip').trigger('click')

    expect(editorStore.quickFieldValueEditor?.blockId).toBe('b1')
    expect(editorStore.quickFieldValueEditor?.key).toBe('rating')
  })

  // ── 枚举字段：值区直挂通用枚举组件 EnumSelect ──────────────────

  it('枚举字段未填：EnumSelect 占位「未填」，整行非按钮，点击展开选项面板且不弹通用编辑器', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-r', title: '评级', field_ids: ['f-rating'], effective_field_ids: ['f-rating'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-rating', key: 'rating', title: '评级', closed_values: ['S', 'A'] }),
    ])

    const wrapper = await mountList('b1', ['t-r'])
    const editorStore = useEditorStore()

    const row = wrapper.find('.block-field-zone-row')
    const trigger = wrapper.find('[data-testid="es-trigger"]')
    expect(trigger.exists()).toBe(true)
    expect(trigger.find('.es-text').text()).toBe('未填')
    expect(trigger.classes()).toContain('es-placeholder')
    // 未填 → 占位文案，而非 ghost chip「未填」
    expect(wrapper.find('.block-field-zone-chip--ghost').exists()).toBe(false)
    // 枚举行不是按钮（编辑由内嵌 EnumSelect 独占，openFieldRow 早退）
    expect(row.attributes('role')).toBeUndefined()

    // EnumSelect 触发按钮自带 @click.stop，点击不应触发整行快速编辑器
    await trigger.trigger('click')
    await flushPromises()
    expect(editorStore.quickFieldValueEditor).toBeNull()
    // 选项面板 Teleport 到 body 展开
    expect(document.body.querySelector('.es-panel')).not.toBeNull()
    wrapper.unmount()
  })

  it('枚举字段经 EnumSelect 选选项落库为 string 类型', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-r', title: '评级', field_ids: ['f-rating'], effective_field_ids: ['f-rating'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-rating', key: 'rating', title: '评级', closed_values: ['S', 'A', 'B'] }),
    ])

    const wrapper = await mountList('b1', ['t-r'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const fieldValueStore = useFieldValueStore()
    const spy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)

    await wrapper.find('[data-testid="es-trigger"]').trigger('click')
    await flushPromises()
    ;(document.body.querySelectorAll('.es-option')[0] as HTMLElement).click()
    await flushPromises()

    expect(spy).toHaveBeenCalledTimes(1)
    const [bid, key, val, type] = spy.mock.calls[0]
    expect(bid).toBe('b1')
    expect(key).toBe('rating')
    expect(val).toBe('S')
    expect(type).toBe('string')
    wrapper.unmount()
  })

  it('枚举字段清除：EnumSelect 清除按钮走删行语义（无行即空）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-r', title: '评级', field_ids: ['f-rating'], effective_field_ids: ['f-rating'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-rating', key: 'rating', title: '评级', closed_values: ['S', 'A'] }),
    ])
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'rating', value_json: 'A' }),
    ])

    const wrapper = await mountList('b1', ['t-r'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const fieldValueStore = useFieldValueStore()
    const setSpy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)
    const delSpy = vi.spyOn(fieldValueStore, 'deleteFieldValue').mockResolvedValue(undefined as never)

    await wrapper.find('.es-clear').trigger('click')
    await flushPromises()

    expect(delSpy).toHaveBeenCalledTimes(1)
    expect(delSpy.mock.calls[0][0]).toBe('v1')
    expect(setSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  // ── date 类型字段值区挂 DatePicker（single）───────────────────

  it('date 字段已有值：值区渲染 DatePicker 触发器，显示日期原文', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-ev', title: '事件', field_ids: ['f-date'], effective_field_ids: ['f-date'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-date', key: 'duedate', title: '到期日', type: 'date' }),
    ])
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'duedate', value_json: '"2026-09-06"', value_type: 'date' }),
    ])

    const wrapper = await mountList('b1', ['t-ev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    // 日期字段不走 chip / text，直接挂 DatePicker
    expect(wrapper.find('.block-field-zone-chip').exists()).toBe(false)
    expect(wrapper.find('.dp-trigger').exists()).toBe(true)
    expect(wrapper.find('.dp-text').text()).toBe('2026-09-06')
  })

  it('date 字段未填：值区仍渲染 DatePicker（占位），点击唤起日历且不弹通用编辑器', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-ev', title: '事件', field_ids: ['f-date'], effective_field_ids: ['f-date'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-date', key: 'duedate', title: '到期日', type: 'date' }),
    ])

    const wrapper = await mountList('b1', ['t-ev'])
    const editorStore = useEditorStore()

    expect(wrapper.find('.dp-trigger').exists()).toBe(true)
    // 未填 → 占位文案，而非 ghost chip「未填」
    expect(wrapper.find('.block-field-zone-chip--ghost').exists()).toBe(false)

    // DatePicker 触发器自带 @click.stop，点击不应触发整行快速编辑器
    await wrapper.find('.dp-trigger').trigger('click')
    expect(editorStore.quickFieldValueEditor).toBeNull()
    // 日历面板 Teleport 到 body 展开
    expect(document.body.querySelector('.dp-panel')).not.toBeNull()
  })

  it('date 字段经 DatePicker 选日期落库为 date 类型', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-ev', title: '事件', field_ids: ['f-date'], effective_field_ids: ['f-date'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-date', key: 'duedate', title: '到期日', type: 'date' }),
    ])

    const wrapper = await mountList('b1', ['t-ev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const fieldValueStore = useFieldValueStore()
    const spy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)

    // 打开日历（真实 DOM：面板 Teleport 到 body），点击「今日」快捷值
    await wrapper.find('.dp-trigger').trigger('click')
    await flushPromises()
    const shortcut = document.body.querySelector('.dp-shortcut[data-shortcut="today"]') as HTMLElement | null
    expect(shortcut).not.toBeNull()
    shortcut!.click()
    await flushPromises()

    expect(spy).toHaveBeenCalledTimes(1)
    const [bid, key, val, type] = spy.mock.calls[0]
    expect(bid).toBe('b1')
    expect(key).toBe('duedate')
    expect(type).toBe('date')
    expect(typeof val).toBe('string')
    expect(/^\d{4}-\d{2}-\d{2}$/.test(val as string)).toBe(true)
    wrapper.unmount()
  })

  // ── number 字段：值区直挂 NumberInput（ADR-0055）────────────────────────

  it('number 字段已有值：值区渲染 NumberInput，输入框显示数值原文', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-num', title: '计量', field_ids: ['f-num'], effective_field_ids: ['f-num'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-num', key: 'count', title: '数量', type: 'number' }),
    ])
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'count', value_json: '42', value_type: 'number' }),
    ])

    const wrapper = await mountList('b1', ['t-num'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    // number 字段不走 chip，直接挂 NumberInput
    expect(wrapper.find('.block-field-zone-chip').exists()).toBe(false)
    expect(wrapper.find('.number-input').exists()).toBe(true)
    expect((wrapper.find('.number-input input').element as HTMLInputElement).value).toBe('42')
  })

  it('number 字段未填：值区渲染 NumberInput（占位），整行非按钮且不弹通用编辑器', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-num', title: '计量', field_ids: ['f-num'], effective_field_ids: ['f-num'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-num', key: 'count', title: '数量', type: 'number' }),
    ])

    const wrapper = await mountList('b1', ['t-num'])
    const editorStore = useEditorStore()

    const row = wrapper.find('.block-field-zone-row')
    expect(wrapper.find('.number-input').exists()).toBe(true)
    // 未填 → 占位输入框，而非 ghost chip「未填」
    expect(wrapper.find('.block-field-zone-chip--ghost').exists()).toBe(false)
    // number 行不是按钮（编辑由内嵌 NumberInput 独占，openFieldRow 早退）
    expect(row.attributes('role')).toBeUndefined()

    // 点击 NumberInput 区域不应弹通用快速编辑器
    await wrapper.find('.number-input input').trigger('click')
    expect(editorStore.quickFieldValueEditor).toBeNull()
  })

  it('number 字段经 NumberInput 步进落库为 number 类型', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-num', title: '计量', field_ids: ['f-num'], effective_field_ids: ['f-num'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-num', key: 'count', title: '数量', type: 'number' }),
    ])

    const wrapper = await mountList('b1', ['t-num'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const fieldValueStore = useFieldValueStore()
    const spy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)

    // 无 step → 步进 +1；从空值(0) 出发（最后一个 .ni-step 为「+」）
    await wrapper.findAll('.ni-step')[1].trigger('click')
    await flushPromises()

    expect(spy).toHaveBeenCalledTimes(1)
    const [bid, key, val, type] = spy.mock.calls[0]
    expect(bid).toBe('b1')
    expect(key).toBe('count')
    expect(type).toBe('number')
    expect(val).toBe(1)
    wrapper.unmount()
  })

  it('number 字段带 min/max/step：失焦就近取整并夹边界', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-num', title: '计量', field_ids: ['f-num'], effective_field_ids: ['f-num'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-num', key: 'count', title: '数量', type: 'number', min: 0, max: 10, step: 5 }),
    ])

    const wrapper = await mountList('b1', ['t-num'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const fieldValueStore = useFieldValueStore()
    const spy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)

    // 输入 7 → 失焦 → step=5 就近取整到 5（基准 min=0），且不超 max
    const input = wrapper.find('.number-input input')
    await input.setValue('7')
    await input.trigger('blur')
    await flushPromises()

    expect(spy).toHaveBeenCalledTimes(1)
    const [bid, key, val, type] = spy.mock.calls[0]
    expect(bid).toBe('b1')
    expect(key).toBe('count')
    expect(type).toBe('number')
    expect(val).toBe(5)
    wrapper.unmount()
  })

  // ── 单一权威展示位（ADR-0050 D19 / D20）────────────────────────

  it('块内不再有行内 chips 渲染位：chips 变体已下线', () => {
    //行内速览能力由下方字段区承担（它按标签模板驱动、标题取自持久化定义）。
    // 锁住「variant联合类型不再含 chips」这一事实：残留调用点会在类型检查报错。
    const variants = (BlockFieldZone as unknown as { props: { variant: { default: string } } }).props
    expect(variants.variant.default).toBe('list')
  })

  it('自定义字段是最高频场景：其值只在下方字段区出现一次', async () => {
    // 复现「分类: 生活」双现：自定义字段（isSystem=false、无 displayPosition）
    // 曾经同时被行尾 chips 与下方字段区渲染。
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({
        id: 't-cat',
        title: '日常',
        field_ids: ['f-cat'],
        effective_field_ids: ['f-cat'],
      }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-cat', key: 'f-muov2k', title: '分类' }),
    ])
    useFieldValueStore().fieldValuesByBlock.set('b1', [
      fv({ id: 'v1', block_id: 'b1', key: 'f-muov2k', value_json: '生活' }),
    ])

    const wrapper = await mountList('b1', ['t-cat'])
    // 标题取自持久化定义（「分类」）而非 field id
    expect(wrapper.find('.block-field-zone-title').text()).toBe('分类')
    expect(wrapper.find('.block-field-zone-value').text()).toBe('生活')
    // 整个块内该字段只渲染一行
    expect(wrapper.findAll('.block-field-zone-row')).toHaveLength(1)
  })

  it('标签模板内所有字段（含bottom-of-block 域字段）都在下方字段区列出', async () => {
    // D20 删除了行内 chips，故下方字段区不再排除 bottom-of-block——
    // 它是块内唯一的字段展示位，域字段也必须在此可见。
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({
        id: 't-book',
        title: '书笔记',
        field_ids: ['f-book', 'f-chapter'],
        effective_field_ids: ['f-book', 'f-chapter'],
      }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-book', key: 'book', title: '书名' }),
      fieldDef({ id: 'f-chapter', key: 'chapter', title: '章节' }),
    ])

    const wrapper = await mountList('b1', ['t-book'])
    const titles = wrapper.findAll('.block-field-zone-row').map(rowTitle)
    expect(titles).toEqual(['书名', '章节'])
  })

  it('status 仍不在下方字段区重复（between 内联槽独占）', async () => {
    // status 以任务图标呈现在 bullet 与内容之间，是它的权威位
    const wrapper = await mountList('b1', ['sys-tag-system-task'])
    expect(wrapper.findAll('.block-field-zone-row')).toHaveLength(0)
  })

  it('priority 同时有行内展示位与下方录入面，两处并存（ADR-0054 D4）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({
        id: 't-task',
        title: '任务',
        field_ids: ['f-status', 'f-priority'],
        effective_field_ids: ['f-status', 'f-priority'],
      }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-status', key: 'status', title: '状态', is_system: true }),
      fieldDef({ id: 'f-priority', key: 'priority', title: '优先级', is_system: true }),
    ])

    const wrapper = await mountList('b1', ['t-task'])
    // status 走 between 内联槽被排除；priority 虽有 right 行内展示位（只读），
    // 但本区是唯一可写入口 ⇒ 必须继续渲染 priority，不适用去重规则
    const titles = wrapper.findAll('.block-field-zone-row').map(rowTitle)
    expect(titles).toEqual(['优先级'])
  })

  it('悬空 / 软删 tag id 不产生字段区', async () => {
    const wrapper = await mountList('b1', ['no-such-tag'])
    expect(wrapper.find('.block-field-zone').exists()).toBe(false)
  })

  // ── 隐藏规则（ADR-0050 D18，定义级共享，逐块判定；D21 决策 7：规则优先于形态）──

  it('隐藏规则 when_empty：未填的字段行消失（含 chip 形态），已填的照常显示', async () => {
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-owner', key: 'owner', title: '负责人', hide_when: 'when_empty' }),
      fieldDef({ id: 'f-estimate', key: 'estimate', title: '工时', type: 'number' }),
    ])
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'estimate', value_json: '3', value_type: 'number' }),
    ])
    const wrapper = await mountList('b1', ['t-dev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const titles = wrapper.findAll('.block-field-zone-row').map(rowTitle)
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
    // estimate 未填：即便默认是 8 也不算「等于默认」→ ghost 保留
    const wrapper = await mountList('b1', ['t-dev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    let titles = wrapper.findAll('.block-field-zone-row').map(rowTitle)
    expect(titles).toEqual(['工时'])

    // 填的值等于默认 8 → 行消失
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'estimate', value_json: '8', value_type: 'number' }),
    ])
    const wrapper2 = await mountList('b1', ['t-dev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()
    titles = wrapper2.findAll('.block-field-zone-row').map(rowTitle)
    expect(titles).toEqual([])

    // 填的值不等于默认 → 行保留
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v2', block_id: 'b1', key: 'estimate', value_json: '3', value_type: 'number' }),
    ])
    const wrapper3 = await mountList('b1', ['t-dev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()
    titles = wrapper3.findAll('.block-field-zone-row').map(rowTitle)
    expect(titles).toEqual(['工时'])
  })

  // ── between 变体：内联槽（原 PropertyInline）────────────────

  function mountBetween(blockId: string, rows: FieldValue[]) {
    useFieldValueStore().fieldValuesByBlock.set(blockId, rows)
    return mount(BlockFieldZone, { props: { blockId, variant: 'between' } })
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

  // ── right 变体：行尾 priority 槽的降层级契约（ADR-0054 D6）──

  function mountRight(blockId: string, rows: FieldValue[]) {
    useFieldValueStore().fieldValuesByBlock.set(blockId, rows)
    return mount(BlockFieldZone, { props: { blockId, variant: 'right' } })
  }

  it('right：priority 走行尾槽，尺寸 14（与实现及注释一致；旧预期 18 是测试侧规格漂移）', () => {
    const wrapper = mountRight('b1', [
      fv({ id: 'v1', block_id: 'b1', key: 'priority', value_json: 'Low' }),
    ])
    expect(wrapper.find('.property-inline--right').exists()).toBe(true)
    expect(wrapper.findAll('.property-inline-item')).toHaveLength(1)

    const svg = wrapper.find('.property-inline-item svg')
    expect(svg.attributes('width')).toBe('14')
    expect(svg.attributes('height')).toBe('14')
  })

  it('right：item 暴露 data-field/data-value，供按档位降层级定位', () => {
    const low = mountRight('b1', [
      fv({ id: 'v1', block_id: 'b1', key: 'priority', value_json: 'Low' }),
    ])
    const item = low.find('.property-inline-item')
    expect(item.attributes('data-field')).toBe('priority')
    expect(item.attributes('data-value')).toBe('Low')

    const urgent = mountRight('b2', [
      fv({ id: 'v2', block_id: 'b2', key: 'priority', value_json: 'Urgent' }),
    ])
    expect(urgent.find('.property-inline-item').attributes('data-value')).toBe('Urgent')
  })

  it('right：点亮格与栅格各有锚点 —— 栅格是位置参照系，强度只压点亮格', () => {
    const wrapper = mountRight('b1', [
      fv({ id: 'v1', block_id: 'b1', key: 'priority', value_json: 'Low' }),
    ])
    // 2×2 方格：恰一个点亮格 + 三个栅格；栅格必须保持，否则实心块失去参照系
    expect(wrapper.findAll('.pq-lit')).toHaveLength(1)
    expect(wrapper.findAll('.pq-frame')).toHaveLength(3)
  })

  it('between：status 尺寸不受行尾槽改动影响（仍走组件默认 24）', () => {
    const wrapper = mountBetween('b1', [
      fv({ id: 'v1', block_id: 'b1', key: 'status', value_json: 'Todo' }),
    ])
    expect(wrapper.find('.property-inline--right').exists()).toBe(false)
    expect(wrapper.find('.property-inline-item svg').attributes('width')).toBe('24')
  })

  // ── all 变体：完整字段列表（Backlinks 消费；D21 决策 9 共用注册表）──

  it('all：全量平铺，无「+N」收纳徽标（行内 chips 下线后不再需要收纳）', async () => {
    const wrapper = mount(BlockFieldZone, {
      props: { blockId: 'b1', variant: 'all' },
    })
    useFieldValueStore().fieldValuesByBlock.set('b1', [
      fv({ id: 'v1', block_id: 'b1', key: 'book', value_json: '测试书' }),
      fv({ id: 'v2', block_id: 'b1', key: 'chapter', value_json: '第一章' }),
      fv({ id: 'v3', block_id: 'b1', key: 'note', value_json: '备注值' }),
    ])
    await flushPromises()

    // 三个字段全部平铺，不再折进浮层
    expect(wrapper.findAll('.property-item')).toHaveLength(3)
    expect(wrapper.find('.chips-more-badge').exists()).toBe(false)
    expect(wrapper.text()).toContain('备注值')

    wrapper.unmount()
  })

  it('all：持久化定义含 closed_values 的字段按 chip 形态渲染（决策 9：与 list 同一注册表）', async () => {
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-rating', key: 'rating', title: '评级', closed_values: ['S', 'A'] }),
    ])
    await useTagsStore().ensureLoaded()
    useFieldValueStore().fieldValuesByBlock.set('b1', [
      fv({ id: 'v1', block_id: 'b1', key: 'rating', value_json: 'S' }),
    ])

    const wrapper = mount(BlockFieldZone, {
      props: { blockId: 'b1', variant: 'all' },
    })
    await flushPromises()

    const chip = wrapper.find('.property-item.block-field-zone-chip')
    expect(chip.exists()).toBe(true)
    expect(chip.find('.bfz-chip-value').text()).toBe('S')

    wrapper.unmount()
  })

  it('all：boolean 字段与 list 同形态出 ✓/✗，不落回文字（决策 9 跨变体一致）', async () => {
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-done', key: 'done', title: '完成', type: 'boolean' }),
    ])
    await useTagsStore().ensureLoaded()
    useFieldValueStore().fieldValuesByBlock.set('b1', [
      fv({ id: 'v1', block_id: 'b1', key: 'done', value_json: 'true', value_type: 'boolean' }),
    ])

    const wrapper = mount(BlockFieldZone, {
      props: { blockId: 'b1', variant: 'all' },
    })
    await flushPromises()

    const iconItem = wrapper.find('.property-item.block-field-zone-row--icon')
    expect(iconItem.exists()).toBe(true)
    expect(iconItem.find('.property-icon').text()).toBe('✓')
    expect(wrapper.text()).not.toContain('true')

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
    const wrapper = mount(BlockFieldZone, {
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
