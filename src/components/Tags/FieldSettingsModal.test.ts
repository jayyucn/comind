import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { Banknote, Hash, Star } from 'lucide-vue-next'
import FieldSettingsModal from './FieldSettingsModal.vue'
import { FIELD_SPEC_ICONS } from '../../utils/field-type-icons'

/**
 * FieldSettingsModal（ADR-0057 D1/D4/D5）：受控 props 弹窗、草稿+保存单源写库、
 * is_system 门禁（不渲染删除）、脏草稿关闭确认、使用于折叠列表。
 * Teleport 断言用 attachTo: document.body + 用例末 unmount（项目既有约定）。
 * 头部图标（modal-title-icon）：特化选中后跟随特化语义，无特化回落类型图标。
 */

const MOCK_DEF = {
  id: 'f1',
  key: 'status',
  title: '状态',
  type: 'select',
  closed_values: ['Todo', 'Doing'],
  default_value: null,
  hide_when: 'never',
  display_form_override: 'auto',
  is_system: false,
  is_preset: false,
  created_at: 1,
  updated_at: 1,
  version: 1,
  deleted_at: null,
  min: null,
  max: null,
  step: null,
  spec: null,
  description: null,
}

const updateFieldDefinition = vi.fn(async () => {})
const ensureLoaded = vi.fn(async () => {})
const deleteFieldDefinition = vi.fn(async () => ({ removed_values: 0 }))
const getFieldValuesByField = vi.fn(async () => [])
const openBlockModal = vi.fn()

/** 可变容器：单个用例可替换字段定义（如 is_system 门禁），用后恢复。 */
let mockFieldDefs = [MOCK_DEF]

vi.mock('../../stores/editor', () => ({
  useEditorStore: () => ({ openBlockModal }),
}))
vi.mock('../../stores/tags', () => ({
  useTagsStore: () => ({
    fieldDefinitions: mockFieldDefs,
    updateFieldDefinition,
    ensureLoaded,
  }),
}))
/** 已进缓存的块 id（getBlock 命中）；「存在但未缓存」与「不存在」集合由 hoisted 容器管理。 */
const { cachedBlockIds, existingUncachedIds, loadCallCount } = vi.hoisted(() => ({
  cachedBlockIds: new Set(['b1', 'b2']),
  existingUncachedIds: new Set<string>(),
  loadCallCount: { n: 0 },
}))

vi.mock('../../stores/blocks', () => ({
  useBlockStore: () => ({
    // 缓存视图：getBlock 只返回已缓存块；loadBlock 可加载「库中存在但未缓存」的块，
    // 复现 used-blocks 未主动加载导致误报「无内容或块已删除」的场景。
    getBlock: (id: string) => (cachedBlockIds.has(id) ? { id, content: `块内容 ${id}` } : undefined),
    loadBlock: async (id: string) => {
      loadCallCount.n += 1
      if (cachedBlockIds.has(id)) return { id, content: `块内容 ${id}` }
      if (existingUncachedIds.has(id)) return { id, content: `已加载 ${id}` }
      return undefined
    },
  }),
}))
vi.mock('../../wasm/client', () => ({
  initCoreClient: async () => ({
    getFieldValuesByField,
    deleteFieldDefinition,
  }),
}))
vi.mock('../../composables/useModalKeyboard', () => ({
  useModalKeyboardRef: vi.fn(),
}))

function mountModal(fieldId: string | null) {
  return mount(FieldSettingsModal, {
    props: { fieldId },
    attachTo: document.body,
    // Teleport stub：内容留在组件子树内，wrapper.find 可断言（项目 Teleport 测试约定）
    global: { stubs: { teleport: true } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFieldDefs = [MOCK_DEF]
  existingUncachedIds.clear()
  loadCallCount.n = 0
})

describe('FieldSettingsModal', () => {
  it('fieldId 为空时不渲染弹窗', () => {
    const w = mountModal(null)
    expect(w.find('.field-settings-overlay').exists()).toBe(false)
    w.unmount()
  })

  it('打开时草稿填充字段定义；隐藏规则下拉与选项 chips 渲染', () => {
    const w = mountModal('f1')
    const overlay = w.find('.field-settings-overlay')
    expect(overlay.exists()).toBe(true)
    expect((w.find('input.head-name').element as HTMLInputElement).value).toBe('状态')
    // select 类型 → 条件区渲染选项 chips（Todo/Doing）
    const chips = w.findAll('.opt-chip')
    expect(chips.map((c) => c.text().replace(/[×\s]/g, ''))).toEqual(['Todo', 'Doing'])
    // 隐藏下拉是五档条件枚举（非布尔开关）
    const hideSelect = w.findAll('select.mini-select').find((s) => s.findAll('option').some((o) => o.element.value === 'when_empty'))
    expect(hideSelect).toBeDefined()
    w.unmount()
  })

  it('保存：草稿一次性走 updateFieldDefinition（含 description 与 hide_when），成功后 emit close', async () => {
    const w = mountModal('f1')
    await w.find('input.head-name').setValue('任务状态')
    await w.find('input.head-desc').setValue('任务当前所处阶段')
    await w.find('[data-testid="field-settings-save"]').trigger('click')
    await vi.waitFor(() => expect(updateFieldDefinition).toHaveBeenCalledTimes(1))
    const params = updateFieldDefinition.mock.calls[0][0]
    expect(params).toMatchObject({
      id: 'f1',
      title: '任务状态',
      description: '任务当前所处阶段',
      hide_when: 'never',
      closed_values: ['Todo', 'Doing'],
    })
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })

  it('is_system 字段：弹窗可开但整体只读——保存/删除不渲染，配置控件全禁用', async () => {
    mockFieldDefs = [{ ...MOCK_DEF, is_system: true, display_form_override: 'chip' }]
    const w = mountModal('f1')
    // 只读横幅（信息性，非警示色文案）
    expect(w.find('.global-hint').text()).toContain('只读')
    // 保存 / 删除不渲染；footer 主按钮位变为「关闭」
    expect(w.find('[data-testid="field-settings-save"]').exists()).toBe(false)
    expect(w.find('[data-testid="field-settings-delete"]').exists()).toBe(false)
    expect(w.text()).toContain('关闭')
    // 下拉族全禁用（含展示形态——D21 决策 6：系统字段无 override 通路；
    // 保存侧 display_form_override 强制归 auto 的双保险仍在 save() 内，UI 不可达故不在此断言）
    for (const label of ['字段类型', '展示形态', '隐藏规则']) {
      expect(w.find(`select[aria-label="${label}"]`).attributes('disabled')).toBeDefined()
    }
    // 头部身份两件套（标题 / 描述）与默认值编辑器同禁
    expect(w.find('input.head-name').attributes('disabled')).toBeDefined()
    expect(w.find('.head-desc').attributes('disabled')).toBeDefined()
    // MOCK_DEF 是 select 型 → 默认值编辑器是枚举下拉（标签无差别选择器同时覆盖 input/select 分支）
    expect(w.find('[aria-label="字段默认值"]').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('默认值编解码往返：回填解 JSON 成人读值，保存按类型编码回 JSON 文本（直通回归网）', async () => {
    mockFieldDefs = [{ ...MOCK_DEF, type: 'string', closed_values: null, default_value: '"李四"' }]
    const w = mountModal('f1')
    // 落库形态是 JSON 文本 '"李四"' → 框里显示李四（不带引号）
    const input = w.find('input[aria-label="字段默认值"]')
    expect((input.element as HTMLInputElement).value).toBe('李四')

    await input.setValue('王五')
    await w.find('[data-testid="field-settings-save"]').trigger('click')
    await vi.waitFor(() => expect(updateFieldDefinition).toHaveBeenCalledTimes(1))
    expect(updateFieldDefinition.mock.calls[0][0].default_value).toBe('"王五"')
    w.unmount()
  })

  it('默认值编辑器按类型分派：number→数字框（JSON 数值落库）、boolean→三态、枚举→选项点选（无选项禁用）', async () => {
    mockFieldDefs = [{ ...MOCK_DEF, type: 'number', closed_values: null }]
    const w = mountModal('f1')
    const numInput = w.find('input[aria-label="字段默认值"]')
    expect(numInput.attributes('type')).toBe('number')
    await numInput.setValue('8')
    await w.find('[data-testid="field-settings-save"]').trigger('click')
    await vi.waitFor(() => expect(updateFieldDefinition).toHaveBeenCalledTimes(1))
    expect(updateFieldDefinition.mock.calls[0][0].default_value).toBe('8')
    w.unmount()

    mockFieldDefs = [{ ...MOCK_DEF, type: 'boolean', closed_values: null }]
    const wb = mountModal('f1')
    const boolSelect = wb.find('select[aria-label="字段默认值"]')
    expect(boolSelect.exists()).toBe(true)
    expect(boolSelect.findAll('option').map((o) => o.text())).toEqual(['无默认', '是', '否'])
    wb.unmount()

    // 枚举：选项来自 closed_values（改回 select mock）
    mockFieldDefs = [MOCK_DEF]
    const we = mountModal('f1')
    expect(we.find('select[aria-label="字段默认值"]').findAll('option').map((o) => o.text()))
      .toEqual(['无默认', 'Todo', 'Doing'])
    we.unmount()

    // 枚举无选项：禁用 + 提示先加选项
    mockFieldDefs = [{ ...MOCK_DEF, closed_values: [] }]
    const wd = mountModal('f1')
    expect(wd.find('select[aria-label="字段默认值"]').attributes('disabled')).toBeDefined()
    wd.unmount()
  })

  it('特化行是分段控制（含「无」档，ADR-0057 ②）：点选写 spec，string 五档', async () => {
    mockFieldDefs = [{ ...MOCK_DEF, type: 'string', closed_values: null }]
    const w = mountModal('f1')
    const seg = w.find('.seg-control')
    expect(seg.exists()).toBe(true)
    expect(seg.findAll('.seg-item').map((b) => b.text())).toEqual(['无', '邮箱', '电话', '链接', '富文本'])
    // spec null → 「无」档激活
    expect(seg.find('.seg-item--active').text()).toBe('无')

    await seg.findAll('.seg-item')[1].trigger('click') // 邮箱
    await w.find('[data-testid="field-settings-save"]').trigger('click')
    await vi.waitFor(() => expect(updateFieldDefinition).toHaveBeenCalledTimes(1))
    expect(updateFieldDefinition.mock.calls[0][0].spec).toBe('email')
    w.unmount()
  })

  it('头部图标随特化变化：无特化回落类型图标，选中 currency/rating 切换对应特化图标', async () => {
    mockFieldDefs = [{ ...MOCK_DEF, type: 'number', closed_values: null }]
    const w = mountModal('f1')
    const iconAt = () => w.find('.modal-title-icon')
    // number 无特化 → 类型图标（Hash）
    expect(iconAt().findComponent(Hash).exists()).toBe(true)

    const items = w.findAll('.seg-item')
    await items[1].trigger('click') // 货币
    expect(iconAt().findComponent(Banknote).exists()).toBe(true)

    await items[3].trigger('click') // 评分
    expect(iconAt().findComponent(Star).exists()).toBe(true)

    await items[0].trigger('click') // 无
    expect(iconAt().findComponent(Hash).exists()).toBe(true)
    w.unmount()
  })

  it('特化图标单源：FIELD_SPEC_ICONS 覆盖全部特化档（落库值域封闭）', () => {
    const heads = ['email', 'phone', 'url', 'richtext', 'currency', 'percent', 'rating', 'person']
    for (const h of heads) {
      expect(FIELD_SPEC_ICONS[h], `特化 ${h} 应有图标`).toBeDefined()
    }
    // 未知特化查询返回 null（调用方回落类型图标）
    expect(FIELD_SPEC_ICONS['mystery']).toBeUndefined()
  })

  it('number 特化：货币档展开级联单位行（符号默认省略）；类型切换清空 spec 与默认值', async () => {
    mockFieldDefs = [{ ...MOCK_DEF, type: 'number', closed_values: null, default_value: '8' }]
    const w = mountModal('f1')
    const items = w.findAll('.seg-item')
    expect(items.map((b) => b.text())).toEqual(['无', '货币', '百分比', '评分'])
    expect(w.find('input[aria-label="货币单位"]').exists()).toBe(false)

    await items[1].trigger('click') // 货币
    expect(w.find('input[aria-label="货币单位"]').exists()).toBe(true)
    await w.find('input[aria-label="货币单位"]').setValue('元')
    await w.find('input[aria-label="货币单位"]').trigger('change')
    await w.find('[data-testid="field-settings-save"]').trigger('click')
    await vi.waitFor(() => expect(updateFieldDefinition).toHaveBeenCalledTimes(1))
    // 符号默认 ¥ 省略（与退役的 onChangeCurrencyUnit 编码口径一致）
    expect(updateFieldDefinition.mock.calls[0][0].spec).toBe('currency:/元')
    // number 默认值不受特化切换影响（同 type 内形态兼容）
    expect(updateFieldDefinition.mock.calls[0][0].default_value).toBe('8')
    w.unmount()

    // 类型切换（@change 路径）：spec 归类型族所有 + 默认值形态随类型走 → 双清
    updateFieldDefinition.mockClear()
    mockFieldDefs = [{ ...MOCK_DEF, type: 'string', closed_values: null, spec: 'email', default_value: '"a@b.c"' }]
    const w2 = mountModal('f1')
    await w2.find('select[aria-label="字段类型"]').setValue('number')
    await w2.find('[data-testid="field-settings-save"]').trigger('click')
    await vi.waitFor(() => expect(updateFieldDefinition).toHaveBeenCalledTimes(1))
    expect(updateFieldDefinition.mock.calls[0][0].spec).toBeNull()
    expect(updateFieldDefinition.mock.calls[0][0].default_value).toBeNull()
    w2.unmount()
  })

  it('使用于：展开后按定义反查有值块，点击块项 openBlockModal', async () => {
    getFieldValuesByField.mockResolvedValue([
      { block_id: 'b1' },
      { block_id: 'b2' },
      { block_id: 'b1' }, // 重复块去重
    ])
    const w = mountModal('f1')
    expect(w.find('[data-testid="field-settings-used-list"]').exists()).toBe(false)
    await w.find('[data-testid="field-settings-used-toggle"]').trigger('click')
    await vi.waitFor(() => expect(getFieldValuesByField).toHaveBeenCalledWith('f1'))
    // 异步块加载完成后列表才渲染（Promise.all + loadBlock），需等待 used-item 出现
    await vi.waitFor(() => expect(w.findAll('.used-item')).toHaveLength(2))
    const items = w.findAll('.used-item')
    expect(items[0].text()).toBe('块内容 b1')
    await items[0].trigger('click')
    expect(openBlockModal).toHaveBeenCalledWith('b1')
    w.unmount()
  })

  it('使用于：block 未进缓存时主动 loadBlock 加载，而非误报「无内容或块已删除」', async () => {
    existingUncachedIds.add('b-remote')
    getFieldValuesByField.mockResolvedValue([{ block_id: 'b-remote' }])
    const w = mountModal('f1')
    await w.find('[data-testid="field-settings-used-toggle"]').trigger('click')
    await vi.waitFor(() => expect(getFieldValuesByField).toHaveBeenCalledWith('f1'))
    await vi.waitFor(() => expect(w.findAll('.used-item')).toHaveLength(1))
    const items = w.findAll('.used-item')
    expect(items[0].text()).toBe('已加载 b-remote')
    expect(loadCallCount.n).toBe(1)
    w.unmount()
  })

  it('使用于：真正不存在的块才回落「无内容或块已删除」占位', async () => {
    getFieldValuesByField.mockResolvedValue([{ block_id: 'b-gone' }])
    const w = mountModal('f1')
    await w.find('[data-testid="field-settings-used-toggle"]').trigger('click')
    await vi.waitFor(() => expect(getFieldValuesByField).toHaveBeenCalledWith('f1'))
    await vi.waitFor(() => expect(w.findAll('.used-item')).toHaveLength(1))
    const items = w.findAll('.used-item')
    expect(items[0].text()).toBe('（无内容或块已删除）')
    // 已尝试主动加载（loadBlock 一次），此后才判定为不存在
    expect(loadCallCount.n).toBe(1)
    w.unmount()
  })

  it('脏草稿点关闭 → 先弹放弃确认；确认后才 emit close', async () => {
    const w = mountModal('f1')
    await w.find('input.head-name').setValue('改过的名字')
    await w.find('[data-testid="field-settings-close"]').trigger('click')
    // 出现放弃确认弹窗，且弹窗本体尚未关闭
    expect(w.text()).toContain('放弃未保存的修改')
    expect(w.emitted('close')).toBeUndefined()
    // 确认放弃（ConfirmDialog 已随 teleport stub 留在子树内）
    const discardBtn = w.findAll('button').find((b) => b.text().includes('放弃修改'))
    expect(discardBtn).toBeDefined()
    await discardBtn!.trigger('click')
    await vi.waitFor(() => expect(w.emitted('close')).toHaveLength(1))
    w.unmount()
  })

  it('展示形态下拉按字段类型配置：枚举给胶囊/文字/只读，开关给勾叉/开关/文字/只读', async () => {
    // MOCK_DEF：select 型 → 枚举档：跟随类型 / 胶囊 / 文字 / 只读（通用只读扩展）
    const w = mountModal('f1')
    const formSelect = w.find('select[aria-label="展示形态"]')
    expect(formSelect.findAll('option').map((o) => o.element.value)).toEqual(['auto', 'chip', 'text', 'readonly'])
    w.unmount()

    // boolean 型 → 开关档：跟随类型 / 勾叉(icon) / 开关(switch) / 文字 / 只读
    mockFieldDefs = [{ ...MOCK_DEF, type: 'boolean', closed_values: null }]
    const wb = mountModal('f1')
    expect(wb.find('select[aria-label="展示形态"]').findAll('option').map((o) => o.element.value))
      .toEqual(['auto', 'icon', 'switch', 'text', 'readonly'])
    wb.unmount()
  })

  it('保存：类型不可达的残留覆盖（icon/switch）归一为 auto', async () => {
    // select 型（枚举）但历史残留 display_form_override='icon' / 'switch' → 均不在可达档，归一 auto
    for (const stale of ['icon', 'switch']) {
      updateFieldDefinition.mockClear()
      mockFieldDefs = [{ ...MOCK_DEF, display_form_override: stale }]
      const w = mountModal('f1')
      await w.find('[data-testid="field-settings-save"]').trigger('click')
      await vi.waitFor(() => expect(updateFieldDefinition).toHaveBeenCalledTimes(1))
      expect(updateFieldDefinition.mock.calls[0][0].display_form_override).toBe('auto')
      w.unmount()
    }
  })

  it('保存 relation 字段：保留 closed_values（约定的关系类型 id）不被清空', async () => {
    // relation 字段复用 closed_values[0] 存约定的关系类型 id（见 tag-persisted.ts）；
    // 保存时若按「非枚举即清空」会误删该约定——本用例锁定修复后的保留行为。
    mockFieldDefs = [{ ...MOCK_DEF, type: 'relation', closed_values: ['rt_seed_related'] }]
    const w = mountModal('f1')
    // 仅改标题触发保存（不改类型/选项）
    await w.find('input.head-name').setValue('关联字段')
    await w.find('[data-testid="field-settings-save"]').trigger('click')
    await vi.waitFor(() => expect(updateFieldDefinition).toHaveBeenCalledTimes(1))
    const params = updateFieldDefinition.mock.calls[0][0]
    expect(params.type).toBe('relation')
    expect(params.closed_values).toEqual(['rt_seed_related'])
    w.unmount()
  })
})
