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

const { mockInitCoreClient, mockClient, navigateToPageMock, mockAssetStorage, relTypeState } = vi.hoisted(() => {
  const mockClient = {
    getTagTree: vi.fn(),
    getFieldDefinitions: vi.fn(),
    getDeletedPresetFieldDefinitions: vi.fn().mockResolvedValue([]),
    restoreBuiltinPresets: vi.fn().mockResolvedValue({ restored: 0 }),
    getFieldValues: vi.fn(),
    setFieldValue: vi.fn(),
    deleteFieldValue: vi.fn(),
  }
  // file 字段（issue T9）的资产通道 mock：FileRefEditor 经 assetStorage 探测/加载
  const mockAssetStorage = {
    save: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    getUrl: vi.fn(),
    loadUrl: vi.fn(),
    revokeUrl: vi.fn(),
  }
  // relation 字段（issue T5）用：useRelationshipTypes 打桩数据（可变数组，
  // 各用例按需填充；RelationRefEditor 渲染关系类型清单与着色消费它）
  const relTypeState = {
    current: [] as Array<{ id: string; type: string; label: string; color: string }>,
  }
  return { mockInitCoreClient: vi.fn(), mockClient, navigateToPageMock: vi.fn(), mockAssetStorage, relTypeState }
})

vi.mock('../../wasm/client', () => ({
  initCoreClient: mockInitCoreClient,
  getCoreClient: vi.fn(),
}))

// useRelationshipTypes 打桩：绕开其 seed 写库逻辑（真实 load 会经 executeBatch
// 补种子行，jsdom 下无谓且脆弱）；RelationRefEditor 只读 items / all / load。
vi.mock('../../composables/useRelationshipTypes', () => ({
  useRelationshipTypes: () => ({
    items: { value: relTypeState.current },
    all: { value: relTypeState.current },
    load: vi.fn().mockResolvedValue(undefined),
  }),
}))

// asset.ts 顶层构造 Dexie（jsdom 无 indexedDB），且 file 分支只应有 mock 行为——整模块 mock 掉
vi.mock('../../utils/asset', () => ({ assetStorage: mockAssetStorage }))

// page 引用 chip 的跳转断言用（T3）；真实实现依赖 router + wasm，测试里 mock 掉
vi.mock('../../composables/useNavigateToPage', () => ({
  useNavigateToPage: () => ({ navigateToPage: navigateToPageMock }),
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

  it('挂标签后出现该标签的有效字段；number 直挂 NumberInput、纯 string 直挂 TextField（字段值家族）', async () => {
    const wrapper = await mountList('b1', ['t-dev'])
    const rows = wrapper.findAll('.block-field-zone-row')
    expect(rows.map(rowTitle)).toEqual(['工时', '负责人'])
    // 工时（number）直挂 NumberInput；负责人（纯 string）直挂 TextField（始终显示输入框）
    expect(wrapper.find('.number-input').exists()).toBe(true)
    expect(wrapper.find('.text-field').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tf-input"]').exists()).toBe(true)
    // 纯 string 已直挂 TextField 而非 ghost 占位
    expect(wrapper.find('.block-field-zone-chip--ghost').exists()).toBe(false)
    // 标签身份由 content 内联 chip 呈现；字段区只出字段，不重复标签名
    expect(wrapper.find('.block-field-zone').text()).not.toContain('#开发任务')
  })

  it('已有值：number 直挂 NumberInput 显示数值，未填 string 字段直挂 TextField（空输入框）', async () => {
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'estimate', value_json: '3', value_type: 'number' }),
    ])
    const wrapper = await mountList('b1', ['t-dev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    expect((wrapper.find('.number-input input').element as HTMLInputElement).value).toBe('3')
    // 未填的纯 string 字段直挂 TextField（空输入框），不再出静态占位
    expect(wrapper.find('.text-field').exists()).toBe(true)
    expect((wrapper.find('[data-testid="tf-input"]').element as HTMLInputElement).value).toBe('')
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

  it('boolean 字段已有值：值区直挂 BooleanCheck，icon 形态值即 ✓（勾选交互）', async () => {
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

    const check = wrapper.find('[data-testid="boolean-check"]')
    expect(check.exists()).toBe(true)
    expect(check.text()).toBe('✓')
    expect(check.attributes('aria-checked')).toBe('true')
    // false 值 → ✗
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'done', value_json: 'false', value_type: 'boolean' }),
    ])
    const wrapper2 = await mountList('b1', ['t-d'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()
    expect(wrapper2.find('[data-testid="boolean-check"]').text()).toBe('✗')
    wrapper2.unmount()
  })

  it('boolean 字段未填：BooleanCheck ghost 占位，整行非按钮且不弹通用编辑器', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-d', title: '完成', field_ids: ['f-done'], effective_field_ids: ['f-done'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-done', key: 'done', title: '完成', type: 'boolean' }),
    ])

    const wrapper = await mountList('b1', ['t-d'])
    const editorStore = useEditorStore()

    const row = wrapper.find('.block-field-zone-row')
    const check = wrapper.find('[data-testid="boolean-check"]')
    expect(check.exists()).toBe(true)
    expect(check.classes()).toContain('bc-empty')
    expect(check.attributes('aria-checked')).toBe('false')
    // boolean 行不是按钮（编辑由内嵌 BooleanCheck 独占，openFieldRow 早退）
    expect(row.attributes('role')).toBeUndefined()

    // 点击勾选控件不应弹通用快速编辑器
    await check.trigger('click')
    expect(editorStore.quickFieldValueEditor).toBeNull()
    wrapper.unmount()
  })

  it('boolean 字段经 BooleanCheck 勾选落库为 boolean 类型：true → false 切换', async () => {
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

    const fieldValueStore = useFieldValueStore()
    const spy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)

    // true 点击 → emit false → 落库 boolean
    await wrapper.find('[data-testid="boolean-check"]').trigger('click')
    await flushPromises()

    expect(spy).toHaveBeenCalledTimes(1)
    const [bid, key, val, type] = spy.mock.calls[0]
    expect(bid).toBe('b1')
    expect(key).toBe('done')
    expect(val).toBe(false)
    expect(type).toBe('boolean')
    wrapper.unmount()
  })

  it('boolean 字段未填点击即录入：ghost → emit true 落库 boolean', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-d', title: '完成', field_ids: ['f-done'], effective_field_ids: ['f-done'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-done', key: 'done', title: '完成', type: 'boolean' }),
    ])

    const wrapper = await mountList('b1', ['t-d'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const fieldValueStore = useFieldValueStore()
    const spy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)

    // 未填（ghost）点击 → emit true → 落库 boolean
    await wrapper.find('[data-testid="boolean-check"]').trigger('click')
    await flushPromises()

    expect(spy).toHaveBeenCalledTimes(1)
    const [bid, key, val, type] = spy.mock.calls[0]
    expect(bid).toBe('b1')
    expect(key).toBe('done')
    expect(val).toBe(true)
    expect(type).toBe('boolean')
    wrapper.unmount()
  })

  it('boolean 字段有值：出现 × 清除按钮，点击走 deleteFieldValue 删行回到未填', async () => {
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

    // 有值时才暴露清除按钮（未填是 ghost 占位，不需要清除）
    expect(wrapper.find('[data-testid="boolean-check"]').exists()).toBe(true)
    const clear = wrapper.find('.bfz-clear-button')
    expect(clear.exists()).toBe(true)

    const fieldValueStore = useFieldValueStore()
    const delSpy = vi.spyOn(fieldValueStore, 'deleteFieldValue').mockResolvedValue(undefined as never)
    const setSpy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)

    await clear.trigger('click')
    await flushPromises()

    expect(delSpy).toHaveBeenCalledTimes(1)
    expect(delSpy.mock.calls[0][0]).toBe('v1')
    expect(setSpy).not.toHaveBeenCalled()
    wrapper.unmount()
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

  // ── datetime 类型字段值区挂 DateTimePicker（T2）────────────────

  it('datetime 字段已有值：值区渲染 DateTimePicker 触发器，显示「yyyy-MM-dd HH:mm」原文', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-ev', title: '事件', field_ids: ['f-dt'], effective_field_ids: ['f-dt'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-dt', key: 'when', title: '时间', type: 'datetime' }),
    ])
    // datetime 为 codec 直通类型：value_json 存原文（无 JSON 引号）
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'when', value_json: '2026-09-06 10:44', value_type: 'datetime' }),
    ])

    const wrapper = await mountList('b1', ['t-ev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    expect(wrapper.find('.block-field-zone-chip').exists()).toBe(false)
    expect(wrapper.find('.dtp-trigger').exists()).toBe(true)
    expect(wrapper.find('.dtp-text').text()).toBe('2026-09-06 10:44')
    wrapper.unmount()
  })

  it('datetime 字段经 DateTimePicker 选日期落库为 datetime 类型，值带时间部分', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-ev', title: '事件', field_ids: ['f-dt'], effective_field_ids: ['f-dt'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-dt', key: 'when', title: '时间', type: 'datetime' }),
    ])

    const wrapper = await mountList('b1', ['t-ev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const fieldValueStore = useFieldValueStore()
    const spy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)

    const picker = wrapper.findComponent({ name: 'DateTimePicker' })
    expect(picker.exists()).toBe(true)
    ;(picker.vm as unknown as { onSelect: (d: string) => void }).onSelect('2026-09-06')
    await flushPromises()

    expect(spy).toHaveBeenCalledTimes(1)
    const [bid, key, val, type] = spy.mock.calls[0]
    expect(bid).toBe('b1')
    expect(key).toBe('when')
    expect(type).toBe('datetime')
    expect(val).toBe('2026-09-06 00:00')
    expect(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(val as string)).toBe(true)
    wrapper.unmount()
  })

  it('datetime 字段清除：DateTimePicker 清除按钮走删行语义（无行即空）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-ev', title: '事件', field_ids: ['f-dt'], effective_field_ids: ['f-dt'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-dt', key: 'when', title: '时间', type: 'datetime' }),
    ])
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'when', value_json: '2026-09-06 10:44', value_type: 'datetime' }),
    ])

    const wrapper = await mountList('b1', ['t-ev'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const fieldValueStore = useFieldValueStore()
    const setSpy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)
    const delSpy = vi.spyOn(fieldValueStore, 'deleteFieldValue').mockResolvedValue(undefined as never)

    await wrapper.find('.dtp-clear').trigger('click')
    await flushPromises()

    expect(delSpy).toHaveBeenCalledTimes(1)
    expect(delSpy.mock.calls[0][0]).toBe('v1')
    expect(setSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('datetime 字段未填：值区渲染 DateTimePicker 占位（非 ghost），点击不弹通用编辑器', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-ev', title: '事件', field_ids: ['f-dt'], effective_field_ids: ['f-dt'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-dt', key: 'when', title: '时间', type: 'datetime' }),
    ])

    const wrapper = await mountList('b1', ['t-ev'])
    const editorStore = useEditorStore()

    const row = wrapper.find('.block-field-zone-row')
    expect(wrapper.find('.dtp-trigger').exists()).toBe(true)
    expect(wrapper.find('.dtp-text').text()).toBe('选择日期时间')
    // 有专属内联编辑器 → 不出 ghost，整行非按钮
    expect(wrapper.find('.block-field-zone-chip--ghost').exists()).toBe(false)
    expect(row.attributes('role')).toBeUndefined()

    await wrapper.find('.dtp-trigger').trigger('click')
    expect(editorStore.quickFieldValueEditor).toBeNull()
    // 面板 Teleport 到 body 展开
    expect(document.body.querySelector('.dtp-panel')).not.toBeNull()
    wrapper.unmount()
  })

  it('all 变体：datetime 值按 chip 形态渲染「yyyy-MM-dd HH:mm」胶囊（AC3）', async () => {
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-dt', key: 'when', title: '时间', type: 'datetime' }),
    ])
    await useTagsStore().ensureLoaded()
    useFieldValueStore().fieldValuesByBlock.set('b1', [
      fv({ id: 'v1', block_id: 'b1', key: 'when', value_json: '2026-09-06 10:44', value_type: 'datetime' }),
    ])

    const wrapper = mount(BlockFieldZone, {
      props: { blockId: 'b1', variant: 'all' },
    })
    await flushPromises()

    const chip = wrapper.find('.property-item.block-field-zone-chip')
    expect(chip.exists()).toBe(true)
    expect(chip.find('.bfz-chip-value').text()).toBe('2026-09-06 10:44')

    wrapper.unmount()
  })

  // ── daterange 类型字段值区挂 DateRangePicker（issue T8）──────────────────

  function mountDaterangeTag() {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-dr', title: '区间', field_ids: ['f-dr'], effective_field_ids: ['f-dr'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-dr', key: 'span', title: '周期', type: 'daterange' }),
    ])
  }

  it('daterange 字段已有值：值区渲染 DateRangePicker 触发器，显示「start → end」区间形态', async () => {
    mountDaterangeTag()
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'span', value_json: '{"start":"2026-01-01","end":"2026-01-31"}', value_type: 'daterange' }),
    ])

    const wrapper = await mountList('b1', ['t-dr'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    // 不走 chip / ghost，直接挂 DateRangePicker
    expect(wrapper.find('.block-field-zone-chip').exists()).toBe(false)
    expect(wrapper.find('[data-testid="drp-trigger"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="drp-text"]').text()).toBe('2026-01-01 → 2026-01-31')
  })

  it('daterange 单端脏数据：降级显示单端', async () => {
    mountDaterangeTag()
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'span', value_json: '{"start":"2026-01-01","end":""}', value_type: 'daterange' }),
    ])

    const wrapper = await mountList('b1', ['t-dr'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    expect(wrapper.find('[data-testid="drp-text"]').text()).toBe('2026-01-01')
  })

  it('daterange 字段未填：值区渲染 DateRangePicker（占位），整行非按钮且不弹通用编辑器', async () => {
    mountDaterangeTag()
    const wrapper = await mountList('b1', ['t-dr'])
    const editorStore = useEditorStore()

    const row = wrapper.find('.block-field-zone-row')
    expect(wrapper.find('[data-testid="drp-trigger"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="drp-text"]').text()).toContain('选择日期区间')
    // 未填 → 占位，而非 ghost chip「未填」
    expect(wrapper.find('.block-field-zone-chip--ghost').exists()).toBe(false)
    // daterange 行不是按钮（编辑由内嵌 DateRangePicker 独占，openFieldRow 早退）
    expect(row.attributes('role')).toBeUndefined()

    // DateRangePicker 触发器自带 @click.stop，点击不应触发整行快速编辑器
    await wrapper.find('[data-testid="drp-trigger"]').trigger('click')
    expect(editorStore.quickFieldValueEditor).toBeNull()
    wrapper.unmount()
  })

  it('daterange 字段两击选区间落库为 daterange 类型（{ start, end } 内存形）', async () => {
    mountDaterangeTag()

    const wrapper = await mountList('b1', ['t-dr'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const fieldValueStore = useFieldValueStore()
    const spy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)

    const dp = wrapper.findComponent({ name: 'DateRangePicker' })
    const onSelect = (dp.vm as unknown as { onSelect: (d: string) => void }).onSelect
    onSelect('2026-01-10') // 第一击：设起点（不提交）
    expect(spy).not.toHaveBeenCalled()
    onSelect('2026-01-20') // 第二击：设终点，两端齐提交
    await flushPromises()

    expect(spy).toHaveBeenCalledTimes(1)
    const [bid, key, val, type] = spy.mock.calls[0]
    expect(bid).toBe('b1')
    expect(key).toBe('span')
    expect(val).toEqual({ start: '2026-01-10', end: '2026-01-20' })
    expect(type).toBe('daterange')
    wrapper.unmount()
  })

  it('daterange 字段清除：DateRangePicker 清除按钮走删行语义（无行即空）', async () => {
    mountDaterangeTag()
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'span', value_json: '{"start":"2026-01-01","end":"2026-01-31"}', value_type: 'daterange' }),
    ])

    const wrapper = await mountList('b1', ['t-dr'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const fieldValueStore = useFieldValueStore()
    const setSpy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)
    const delSpy = vi.spyOn(fieldValueStore, 'deleteFieldValue').mockResolvedValue(undefined as never)

    await wrapper.find('[data-testid="drp-clear"]').trigger('click')
    await flushPromises()

    expect(delSpy).toHaveBeenCalledTimes(1)
    expect(delSpy.mock.calls[0][0]).toBe('v1')
    expect(setSpy).not.toHaveBeenCalled()
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

  // ── number 特化族（issue T7）：currency / percent / rating 展示分派 ──

  it('number 特化 currency：编辑仍是 NumberInput，符号 ¥ 前置、配置单位后置', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-cur', title: '记账', field_ids: ['f-amount'], effective_field_ids: ['f-amount'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-amount', key: 'amount', title: '金额', type: 'number', spec: 'currency:¥/元' }),
    ])
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'amount', value_json: '42', value_type: 'number' }),
    ])

    const wrapper = await mountList('b1', ['t-cur'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    // 编辑仍是数字输入
    expect(wrapper.find('.number-input').exists()).toBe(true)
    expect((wrapper.find('.number-input input').element as HTMLInputElement).value).toBe('42')
    // 展示带符号 / 单位
    expect(wrapper.find('.bfz-currency-symbol').text()).toBe('¥')
    expect(wrapper.find('.bfz-currency-unit').text()).toBe('元')
    wrapper.unmount()
  })

  it('number 特化 percent：默认约束 0–100 传入 NumberInput，带细进度条', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-pct', title: '进度', field_ids: ['f-progress'], effective_field_ids: ['f-progress'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-progress', key: 'progress', title: '进度', type: 'number', spec: 'percent' }),
    ])
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'progress', value_json: '42', value_type: 'number' }),
    ])

    const wrapper = await mountList('b1', ['t-pct'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    // 编辑仍是 NumberInput；percent 默认界 0–100 生效（步进顶到 max 后提示「已达最大值 100」可反证，
    // 这里直接断言进度条展示 + 值百分比宽度）
    const track = wrapper.find('.bfz-percent-track')
    expect(track.exists()).toBe(true)
    expect(track.attributes('style')).toContain('--bfz-percent: 42%')
    wrapper.unmount()
  })

  it('number 特化 rating：值区直挂 RatingInput 星级编辑，实心数与值一致', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-rate', title: '评分', field_ids: ['f-stars'], effective_field_ids: ['f-stars'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-stars', key: 'stars', title: '评分', type: 'number', spec: 'rating' }),
    ])
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'stars', value_json: '3', value_type: 'number' }),
    ])

    const wrapper = await mountList('b1', ['t-rate'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    // 不再走 NumberInput，改挂 RatingInput
    expect(wrapper.find('.number-input').exists()).toBe(false)
    expect(wrapper.find('.rating-input').exists()).toBe(true)
    expect(wrapper.findAll('.rating-star--lit')).toHaveLength(3)

    // 点击第 5 颗星落库为 number 类型 5
    const fieldValueStore = useFieldValueStore()
    const spy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)
    await wrapper.findAll('.rating-star-btn')[4].trigger('click')
    await flushPromises()
    expect(spy).toHaveBeenCalledWith('b1', 'stars', 5, 'number')
    wrapper.unmount()
  })

  it('number 特化 rating 未填：RatingInput 全空心，点击置值；再点同值走删行语义', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-rate', title: '评分', field_ids: ['f-stars'], effective_field_ids: ['f-stars'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-stars', key: 'stars', title: '评分', type: 'number', spec: 'rating' }),
    ])

    const wrapper = await mountList('b1', ['t-rate'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    expect(wrapper.findAll('.rating-star--lit')).toHaveLength(0)

    const fieldValueStore = useFieldValueStore()
    const setSpy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)
    const delSpy = vi.spyOn(fieldValueStore, 'deleteFieldValue').mockResolvedValue(undefined as never)

    // 置值 2
    await wrapper.findAll('.rating-star-btn')[1].trigger('click')
    await flushPromises()
    expect(setSpy).toHaveBeenCalledWith('b1', 'stars', 2, 'number')

    // 模拟已有值 2 → 再点第 2 颗星 → 清空删行
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'stars', value_json: '2', value_type: 'number' }),
    ])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()
    await wrapper.findAll('.rating-star-btn')[1].trigger('click')
    await flushPromises()
    expect(delSpy).toHaveBeenCalledTimes(1)
    expect(delSpy.mock.calls[0][0]).toBe('v1')
    wrapper.unmount()
  })

  // ── 纯 string 字段：值区直挂 TextField（字段值家族补全）────────────────────────

  it('纯 string 字段已有值：值区渲染 TextField，输入框显示原文', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-note', title: '笔记', field_ids: ['f-note'], effective_field_ids: ['f-note'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-note', key: 'note', title: '备注' }),
    ])
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'note', value_json: '随手记一句' }),
    ])

    const wrapper = await mountList('b1', ['t-note'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    // 纯 string 不走 chip / 占位，直接挂 TextField
    expect(wrapper.find('.block-field-zone-chip').exists()).toBe(false)
    expect(wrapper.find('.block-field-zone-placeholder').exists()).toBe(false)
    expect(wrapper.find('.text-field').exists()).toBe(true)
    expect((wrapper.find('[data-testid="tf-input"]').element as HTMLInputElement).value).toBe('随手记一句')
  })

  it('纯 string 字段未填：值区渲染 TextField（空输入框），整行非按钮且不弹通用编辑器', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-note', title: '笔记', field_ids: ['f-note'], effective_field_ids: ['f-note'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-note', key: 'note', title: '备注' }),
    ])

    const wrapper = await mountList('b1', ['t-note'])
    const editorStore = useEditorStore()

    const row = wrapper.find('.block-field-zone-row')
    expect(wrapper.find('.text-field').exists()).toBe(true)
    // 未填 → 空输入框，而非 ghost chip「未填」
    expect(wrapper.find('.block-field-zone-chip--ghost').exists()).toBe(false)
    // 纯 string 行不是按钮（编辑由内嵌 TextField 独占，openFieldRow 早退）
    expect(row.attributes('role')).toBeUndefined()

    // 点击 TextField 输入框不应弹通用快速编辑器
    await wrapper.find('[data-testid="tf-input"]').trigger('click')
    expect(editorStore.quickFieldValueEditor).toBeNull()
  })

  it('纯 string 字段经 TextField 提交落库为 string 类型', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-note', title: '笔记', field_ids: ['f-note'], effective_field_ids: ['f-note'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-note', key: 'note', title: '备注' }),
    ])

    const wrapper = await mountList('b1', ['t-note'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const fieldValueStore = useFieldValueStore()
    const spy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)

    const input = wrapper.find('[data-testid="tf-input"]')
    await input.setValue('新备注')
    await input.trigger('blur')
    await flushPromises()

    expect(spy).toHaveBeenCalledTimes(1)
    const [bid, key, val, type] = spy.mock.calls[0]
    expect(bid).toBe('b1')
    expect(key).toBe('note')
    expect(val).toBe('新备注')
    expect(type).toBe('string')
    wrapper.unmount()
  })

  it('纯 string 字段清除：TextField 清除按钮走删行语义（无行即空）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-note', title: '笔记', field_ids: ['f-note'], effective_field_ids: ['f-note'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-note', key: 'note', title: '备注' }),
    ])
    mockClient.getFieldValues.mockResolvedValue([
      fv({ id: 'v1', block_id: 'b1', key: 'note', value_json: '随手记一句' }),
    ])

    const wrapper = await mountList('b1', ['t-note'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()

    const fieldValueStore = useFieldValueStore()
    const setSpy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)
    const delSpy = vi.spyOn(fieldValueStore, 'deleteFieldValue').mockResolvedValue(undefined as never)

    await wrapper.find('[data-testid="tf-clear"]').trigger('click')
    await flushPromises()

    expect(delSpy).toHaveBeenCalledTimes(1)
    expect(delSpy.mock.calls[0][0]).toBe('v1')
    expect(setSpy).not.toHaveBeenCalled()
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
    // 纯 string 自定义字段直挂 TextField，值落在输入框而非静态文字
    expect((wrapper.find('[data-testid="tf-input"]').element as HTMLInputElement).value).toBe('生活')
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

  // ── page 引用字段（issue T3）────────────────────────────────

  /** page 类型字段的公共桩：标签 + 字段定义（type: 'page'）。 */
  async function mountPageField(row?: FieldValue) {
    const { usePageStore } = await import('../../stores/pages')
    const pageStore = usePageStore()
    pageStore.pages.push({
      id: 'p1', blockId: null, title: '目标页', type: 'normal', icon: null,
      cover: null, aliases: [], filePath: null, childrenCount: 0, wordCount: 0,
      createdAt: 1, updatedAt: 1, deleted: false, deletedAt: null,
    })
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-page', title: '引用', field_ids: ['f-ref'], effective_field_ids: ['f-ref'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-ref', key: 'ref', title: '相关页面', type: 'page' }),
    ])
    mockClient.getFieldValues.mockResolvedValue(row ? [row] : [])
    const wrapper = await mountList('b1', ['t-page'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()
    return wrapper
  }

  it('page 字段有值：chip 显示目标页标题（page id 反查）并带 page 样式（AC3）', async () => {
    const wrapper = await mountPageField(
      fv({ id: 'v1', block_id: 'b1', key: 'ref', value_json: 'p1', value_type: 'page' }),
    )
    const chip = wrapper.find('.block-field-zone-chip--page')
    expect(chip.exists()).toBe(true)
    expect(chip.find('.bfz-chip-value').text()).toBe('目标页')
    expect(chip.classes()).not.toContain('block-field-zone-chip--dangling')
    wrapper.unmount()
  })

  it('page 字段悬空 id：chip 降级显示原始 id（弱化样式）（AC3）', async () => {
    const wrapper = await mountPageField(
      fv({ id: 'v1', block_id: 'b1', key: 'ref', value_json: 'p-gone', value_type: 'page' }),
    )
    const chip = wrapper.find('.block-field-zone-chip--page')
    expect(chip.exists()).toBe(true)
    expect(chip.find('.bfz-chip-value').text()).toBe('p-gone')
    expect(chip.classes()).toContain('block-field-zone-chip--dangling')
    wrapper.unmount()
  })

  it('page chip 点击：navigateToPage 跳转目标页（AC3）', async () => {
    const wrapper = await mountPageField(
      fv({ id: 'v1', block_id: 'b1', key: 'ref', value_json: 'p1', value_type: 'page' }),
    )
    await wrapper.find('.block-field-zone-chip--page').trigger('click')
    expect(navigateToPageMock).toHaveBeenCalledWith('p1')
    wrapper.unmount()
  })

  it('page 字段未填：值区直挂 PageRefPicker（pageRef 文本兜底已替换），整行非按钮且不弹通用编辑器（AC2）', async () => {
    const wrapper = await mountPageField()
    const row = wrapper.find('.block-field-zone-row')
    const editorStore = useEditorStore()

    expect(wrapper.find('[data-testid="prp-trigger"]').exists()).toBe(true)
    // 未填 → picker 占位，而非 ghost chip「未填」
    expect(wrapper.find('.block-field-zone-chip--ghost').exists()).toBe(false)
    // page 行不是按钮（编辑由内嵌 PageRefPicker 独占，openFieldRow 早退）
    expect(row.attributes('role')).toBeUndefined()

    await wrapper.find('[data-testid="prp-trigger"]').trigger('click')
    await flushPromises()
    expect(editorStore.quickFieldValueEditor).toBeNull()
    wrapper.unmount()
  })

  it('page 字段经 PageRefPicker 选中页面落库为 page 类型（AC2）', async () => {
    const wrapper = await mountPageField()
    const fieldValueStore = useFieldValueStore()
    const spy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)

    await wrapper.find('[data-testid="prp-trigger"]').trigger('click')
    await flushPromises()
    ;(document.body.querySelectorAll('.prp-option')[0] as HTMLElement).click()
    await flushPromises()

    expect(spy).toHaveBeenCalledTimes(1)
    const [bid, key, val, type] = spy.mock.calls[0]
    expect(bid).toBe('b1')
    expect(key).toBe('ref')
    expect(val).toBe('p1')
    expect(type).toBe('page')
    wrapper.unmount()
  })

  it('page 字段有值：chip 旁出现 × 清除按钮，点击走 deleteFieldValue 置空（此前只能覆盖无法清空）', async () => {
    const wrapper = await mountPageField(
      fv({ id: 'v1', block_id: 'b1', key: 'ref', value_json: 'p1', value_type: 'page' }),
    )
    const chip = wrapper.find('.block-field-zone-chip--page')
    expect(chip.exists()).toBe(true)

    // 此前 page chip 无清除入口（onPageRefChange 把空值吞掉），现补上
    const clear = wrapper.find('.bfz-clear-button')
    expect(clear.exists()).toBe(true)

    const fieldValueStore = useFieldValueStore()
    const delSpy = vi.spyOn(fieldValueStore, 'deleteFieldValue').mockResolvedValue(undefined as never)
    const setSpy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)

    await clear.trigger('click')
    await flushPromises()

    expect(delSpy).toHaveBeenCalledTimes(1)
    expect(delSpy.mock.calls[0][0]).toBe('v1')
    expect(setSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  // ── page 特化 person（负责人，issue T10）─────────────────────

  /** person 特化 page 字段的公共桩：标签 + 字段定义（type: 'page', spec: 'person'）+ person 页。 */
  async function mountPersonField(row?: FieldValue) {
    const { usePageStore } = await import('../../stores/pages')
    const pageStore = usePageStore()
    pageStore.pages.push(
      {
        id: 'pp1', blockId: 'blk-person', title: '张三', type: 'normal', icon: null,
        cover: null, aliases: [], filePath: null, childrenCount: 0, wordCount: 0,
        createdAt: 1, updatedAt: 1, deleted: false, deletedAt: null,
      },
      {
        id: 'pp2', blockId: 'blk-other', title: '项目页', type: 'normal', icon: null,
        cover: null, aliases: [], filePath: null, childrenCount: 0, wordCount: 0,
        createdAt: 1, updatedAt: 1, deleted: false, deletedAt: null,
      },
    )
    // person 页判据：主页块挂 'person' 标签（utils/person-page 单源）
    const { useBlockStore } = await import('../../stores/blocks')
    useBlockStore().blocks.push(
      { id: 'blk-person', pageId: 'pg-person', parentId: null, pos: 0, content: '', format: {}, type: 'bullet', tags: ['person'], createdAt: 1, updatedAt: 1 },
      { id: 'blk-other', pageId: 'pg-other', parentId: null, pos: 0, content: '', format: {}, type: 'bullet', tags: ['project'], createdAt: 1, updatedAt: 1 },
    )
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-person', title: '任务', field_ids: ['f-owner-ref'], effective_field_ids: ['f-owner-ref'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-owner-ref', key: 'ownerRef', title: '负责人', type: 'page', spec: 'person' }),
    ])
    mockClient.getFieldValues.mockResolvedValue(row ? [row] : [])
    const wrapper = await mountList('b1', ['t-person'])
    await useFieldValueStore().loadBlockFieldValues('b1')
    await flushPromises()
    return wrapper
  }

  it('person 特化有值：人员 chip（--person 样式 + 首字圆形头像 + 名字），点击跳转目标页（AC3）', async () => {
    const wrapper = await mountPersonField(
      fv({ id: 'v1', block_id: 'b1', key: 'ownerRef', value_json: 'pp1', value_type: 'page' }),
    )
    const chip = wrapper.find('.block-field-zone-chip--person')
    expect(chip.exists()).toBe(true)
    // 名字沿用 page 引用反查；头像取标题首字
    expect(chip.find('.bfz-chip-value').text()).toBe('张三')
    expect(chip.find('.bfz-person-avatar').text()).toBe('张')
    // 跳转与 page 引用同路径
    await chip.trigger('click')
    expect(navigateToPageMock).toHaveBeenCalledWith('pp1')
    wrapper.unmount()
  })

  it('person 特化未填：直挂 PageRefPicker 且候选仅 person 页（personOnly 过滤，AC2）', async () => {
    const wrapper = await mountPersonField()
    const trigger = wrapper.find('[data-testid="prp-trigger"]')
    expect(trigger.exists()).toBe(true)
    expect(trigger.text()).toBe('选择人员')

    await trigger.trigger('click')
    await flushPromises()
    const options = [...document.body.querySelectorAll('.prp-option')]
    expect(options).toHaveLength(1)
    expect(options[0].getAttribute('data-page-id')).toBe('pp1')
    wrapper.unmount()
  })

  // ── file 字段（附件，issue T9）────────────────────────────────

  /** file 类型字段的公共桩：标签 + 字段定义（type: 'file'）。 */
  function stubFileField() {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-file', title: '资料', field_ids: ['f-attach'], effective_field_ids: ['f-attach'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-attach', key: 'attach', title: '附件', type: 'file' }),
    ])
  }

  it('file 字段无值：值区直挂 28px 上传按钮，不出通用编辑器 ghost（issue T9）', async () => {
    stubFileField()
    const wrapper = await mountList('b1', ['t-file'])

    const add = wrapper.find('.file-ref-add')
    expect(add.exists()).toBe(true)
    expect(add.text()).toBe('上传附件')
    // file 是行内编辑器：整行不再是点击目标（openFieldRow 对其早退）
    expect(wrapper.find('.block-field-zone-row--inline-editor').exists()).toBe(true)
    wrapper.unmount()
  })

  it('file 字段有值（图片 mime）：渲染缩略图 + 文件名，缩略图来自资产通道 loadUrl（issue T9）', async () => {
    stubFileField()
    useFieldValueStore().fieldValuesByBlock.set('b1', [
      fv({
        id: 'v1', block_id: 'b1', key: 'attach',
        value_json: JSON.stringify({ path: 'asset://asset_img_1', name: '截图.png', mime: 'image/png' }),
        value_type: 'file',
      }),
    ])
    mockAssetStorage.get.mockResolvedValue({ id: 'asset_img_1', name: '截图.png', mimeType: 'image/png' })
    mockAssetStorage.loadUrl.mockResolvedValue('blob:mock-thumb-url')

    const wrapper = await mountList('b1', ['t-file'])
    // probe 是挂载后的异步动作，等它落地
    await flushPromises()

    const chip = wrapper.find('.file-ref-chip')
    expect(chip.exists()).toBe(true)
    expect(chip.classes()).toContain('file-ref-chip--image')
    expect(chip.find('.file-ref-thumb').exists()).toBe(true)
    expect((chip.find('.file-ref-thumb').element as HTMLImageElement).src).toBe('blob:mock-thumb-url')
    expect(chip.find('.file-ref-name').text()).toBe('截图.png')
    expect(chip.classes()).not.toContain('file-ref-chip--missing')
    wrapper.unmount()
  })

  it('file 字段有值（非图片 mime）：渲染附件 chip（Paperclip 图标 + 文件名），无缩略图（issue T9）', async () => {
    stubFileField()
    useFieldValueStore().fieldValuesByBlock.set('b1', [
      fv({
        id: 'v1', block_id: 'b1', key: 'attach',
        value_json: JSON.stringify({ path: 'asset://asset_pdf_1', name: '报告.pdf', mime: 'application/pdf' }),
        value_type: 'file',
      }),
    ])
    mockAssetStorage.get.mockResolvedValue({ id: 'asset_pdf_1', name: '报告.pdf', mimeType: 'application/pdf' })

    const wrapper = await mountList('b1', ['t-file'])
    await flushPromises()

    const chip = wrapper.find('.file-ref-chip')
    expect(chip.exists()).toBe(true)
    expect(chip.find('.file-ref-thumb').exists()).toBe(false)
    expect(chip.find('.file-ref-icon').exists()).toBe(true)
    expect(chip.find('.file-ref-name').text()).toBe('报告.pdf')
    expect(chip.classes()).not.toContain('file-ref-chip--missing')
    wrapper.unmount()
  })

  it('file 字段悬空引用：资产探测失败 → chip 弱化样式降级，文件名仍可见（issue T9）', async () => {
    stubFileField()
    useFieldValueStore().fieldValuesByBlock.set('b1', [
      fv({
        id: 'v1', block_id: 'b1', key: 'attach',
        value_json: JSON.stringify({ path: 'asset://asset_gone', name: '丢失.pdf', mime: 'application/pdf' }),
        value_type: 'file',
      }),
    ])
    // 悬空：资产不存在（Web 返回 undefined / Tauri 抛 'Asset not found'，两者都走降级）
    mockAssetStorage.get.mockResolvedValue(undefined)

    const wrapper = await mountList('b1', ['t-file'])
    await flushPromises()

    const chip = wrapper.find('.file-ref-chip')
    expect(chip.exists()).toBe(true)
    expect(chip.classes()).toContain('file-ref-chip--missing')
    expect(chip.find('.file-ref-name').text()).toBe('丢失.pdf')
    wrapper.unmount()
  })

  it('file 字段清除：× 按钮 emit undefined → 删行语义（issue T9）', async () => {
    stubFileField()
    useFieldValueStore().fieldValuesByBlock.set('b1', [
      fv({
        id: 'v1', block_id: 'b1', key: 'attach',
        value_json: JSON.stringify({ path: 'asset://asset_pdf_1', name: '报告.pdf', mime: 'application/pdf' }),
        value_type: 'file',
      }),
    ])
    mockAssetStorage.get.mockResolvedValue({ id: 'asset_pdf_1', name: '报告.pdf', mimeType: 'application/pdf' })
    mockClient.deleteFieldValue.mockResolvedValue(undefined)

    const wrapper = await mountList('b1', ['t-file'])
    await flushPromises()

    await wrapper.find('.file-ref-clear').trigger('click')
    await flushPromises()

    // 删行语义：client 收到 (blockId, key)（store 就地移除该行）
    expect(mockClient.deleteFieldValue).toHaveBeenCalledWith('b1', 'attach')
    wrapper.unmount()
  })

  // ── relation 字段（关系引用，issue T5）：值区直挂 RelationRefEditor ──

  /** relation 字段挂载基建：标签 + 定义（closed_values 携带约定的关系类型 id 配置位） */
  async function mountRelationList(fieldValues: FieldValue[]) {
    mockClient.getTagTree.mockResolvedValue([
      treeEntry({ id: 't-rel', title: '关联', field_ids: ['f-rel'], effective_field_ids: ['f-rel'] }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-rel', key: 'rel', title: '关联字段', type: 'relation', closed_values: ['rt_seed_related'] }),
    ])
    relTypeState.current = [{ id: 'rt_seed_related', type: 'related', label: '相关', color: '#1890ff' }]
    // 目标解析数据源：真实 pages store 直接注入一页（RelationRefEditor 按页 id 反查标题）
    const { usePageStore } = await import('../../stores/pages')
    const pageStore = usePageStore()
    ;(pageStore as unknown as { pages: unknown }).pages = [
      {
        id: 'page-1', blockId: null, title: '项目主页', type: 'normal', icon: null,
        cover: null, aliases: [], filePath: null, childrenCount: 0, wordCount: 0, createdAt: 1, updatedAt: 1,
      },
    ]
    useFieldValueStore().fieldValuesByBlock.set('b1', fieldValues)
    const wrapper = mount(BlockFieldZone, { props: { blockId: 'b1', tagIds: ['t-rel'] } })
    await flushPromises()
    return wrapper
  }

  it('relation 字段无值：值区渲染 RelationRefEditor ghost chip「未填」，整行非按钮（编辑由内嵌控件独占）', async () => {
    const wrapper = await mountRelationList([])
    const row = wrapper.find('.block-field-zone-row')
    const trigger = wrapper.find('[data-testid="rre-trigger"]')
    expect(trigger.exists()).toBe(true)
    expect(trigger.text()).toContain('未填')
    expect(trigger.classes()).toContain('block-field-zone-chip--ghost')
    expect(row.attributes('role')).toBeUndefined()
    wrapper.unmount()
  })

  it('relation 字段有值：chip 按关系类型着色（--relation-color 变量 + relation 类），显示目标标题', async () => {
    const wrapper = await mountRelationList([
      fv({
        id: 'v1', block_id: 'b1', key: 'rel',
        value_json: JSON.stringify({ targetId: 'page-1', relationshipTypeId: 'rt_seed_related' }),
        value_type: 'relation',
      }),
    ])

    const trigger = wrapper.find('[data-testid="rre-trigger"]')
    expect(trigger.exists()).toBe(true)
    expect(trigger.classes()).toContain('block-field-zone-chip--relation')
    expect(trigger.classes()).not.toContain('block-field-zone-chip--dangling')
    expect(trigger.text()).toContain('项目主页')
    expect(trigger.text()).toContain('相关')
    expect(trigger.attributes('style')).toContain('--relation-color: #1890ff')
    wrapper.unmount()
  })

  it('relation 字段悬空 targetId 降级：目标不在清单 →「未知目标」+ dangling 中性类，无着色变量', async () => {
    const wrapper = await mountRelationList([
      fv({
        id: 'v1', block_id: 'b1', key: 'rel',
        value_json: JSON.stringify({ targetId: 'gone-target', relationshipTypeId: 'rt_seed_related' }),
        value_type: 'relation',
      }),
    ])

    const trigger = wrapper.find('[data-testid="rre-trigger"]')
    expect(trigger.classes()).toContain('block-field-zone-chip--dangling')
    expect(trigger.classes()).not.toContain('block-field-zone-chip--relation')
    expect(trigger.text()).toContain('未知目标')
    expect(trigger.attributes('style') ?? '').not.toContain('--relation-color')
    wrapper.unmount()
  })

  it('relation 字段经 RelationRefEditor 选目标：payload 两段齐备落库为 relation 类型', async () => {
    const wrapper = await mountRelationList([])
    await flushPromises()

    const fieldValueStore = useFieldValueStore()
    const spy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)

    // 字段定义 closed_values[0] 约定关系类型 → 选目标即成完整 payload
    const editor = wrapper.findComponent({ name: 'RelationRefEditor' })
    await (editor.vm as unknown as { pickTarget: (id: string) => void }).pickTarget('page-1')
    await flushPromises()

    expect(spy).toHaveBeenCalledTimes(1)
    const [bid, key, val, type] = spy.mock.calls[0]
    expect(bid).toBe('b1')
    expect(key).toBe('rel')
    expect(val).toEqual({ targetId: 'page-1', relationshipTypeId: 'rt_seed_related' })
    expect(type).toBe('relation')
    wrapper.unmount()
  })

  it('relation 字段清除：× 按钮 emit undefined → 删行语义（无行即空）', async () => {
    const wrapper = await mountRelationList([
      fv({
        id: 'v1', block_id: 'b1', key: 'rel',
        value_json: JSON.stringify({ targetId: 'page-1', relationshipTypeId: 'rt_seed_related' }),
        value_type: 'relation',
      }),
    ])

    const fieldValueStore = useFieldValueStore()
    const setSpy = vi.spyOn(fieldValueStore, 'setFieldValue').mockResolvedValue(undefined as never)
    const delSpy = vi.spyOn(fieldValueStore, 'deleteFieldValue').mockResolvedValue(undefined as never)

    await wrapper.find('[data-testid="rre-clear"]').trigger('click')
    await flushPromises()

    expect(delSpy).toHaveBeenCalledTimes(1)
    expect(delSpy.mock.calls[0][0]).toBe('v1')
    expect(setSpy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
