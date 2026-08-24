import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useEditorStore } from '../../stores/editor'
import { usePropertyStore } from '../../stores/property'
import { useBlockCardStore } from '../../stores/blockCard'
import PropertyQuickEditor from './PropertyQuickEditor.vue'

// 用占位 stub 替代 Teleport 弹层，使内容直接在 wrapper 内可查询
const BasePopoverStub = {
  props: ['visible', 'position'],
  template: '<div v-if="visible" data-testid="popover"><slot /></div>',
}

vi.mock('../../stores/editor', () => ({ useEditorStore: vi.fn() }))
vi.mock('../../stores/property', () => ({ usePropertyStore: vi.fn() }))
vi.mock('../../stores/blockCard', () => ({ useBlockCardStore: vi.fn() }))

const editorStoreMock = {
  quickPropertyEditor: {
    visible: true,
    blockId: 'block-1',
    key: 'project',
    position: { x: 0, y: 0 },
  },
  hideQuickPropertyEditor: vi.fn(),
}

type CardLike = { block_id: string; properties: Record<string, unknown> }

function mockStores(overrides: { cards?: CardLike[]; currentValue?: string } = {}) {
  const cards = overrides.cards ?? []
  vi.mocked(useEditorStore).mockReturnValue(editorStoreMock as unknown as ReturnType<typeof useEditorStore>)
  vi.mocked(usePropertyStore).mockReturnValue({
    getBlockProperty: vi.fn().mockReturnValue({ value: overrides.currentValue ?? 'Beta', type: 'string' }),
    setProperty: vi.fn().mockResolvedValue({}),
  } as unknown as ReturnType<typeof usePropertyStore>)
  vi.mocked(useBlockCardStore).mockReturnValue({
    cards,
    getCards: vi.fn().mockResolvedValue(cards),
  } as unknown as ReturnType<typeof useBlockCardStore>)
}

function mountEditor() {
  return mount(PropertyQuickEditor, {
    global: { stubs: { BasePopover: BasePopoverStub } },
  })
}

function card(blockId: string, project?: unknown) {
  return { block_id: blockId, properties: project === undefined ? {} : { project } }
}

function cardWithProps(blockId: string, props: Record<string, unknown>) {
  return { block_id: blockId, properties: props }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('PropertyQuickEditor — project/area 搜索列表分支', () => {
  it('按使用次数降序渲染已有项目，并高亮当前值', () => {
    mockStores({
      cards: [
        card('b1', 'Alpha'),
        card('b2', 'Beta'),
        card('b3', 'Alpha'),
        card('b4'),
        card('b5', 42), // 非字符串值忽略
      ],
      currentValue: 'Beta',
    })
    const wrapper = mountEditor()

    const options = wrapper.findAll('.project-option')
    expect(options).toHaveLength(2)
    expect(options[0].text()).toContain('Alpha')
    expect(options[1].text()).toContain('Beta')
    expect(options[0].find('.option-icon').text()).toBe('📁')
    expect(options[1].classes('selected')).toBe(true)
  })

  it('输入时实时过滤（不区分大小写的包含匹配）', async () => {
    mockStores({ cards: [card('b1', 'Alpha'), card('b2', 'Beta'), card('b3', 'Gamma')] })
    const wrapper = mountEditor()
    const input = wrapper.find('input.project-search')

    await input.setValue('al')
    const options = wrapper.findAll('.project-option')
    expect(options).toHaveLength(1)
    expect(options[0].text()).toContain('Alpha')
  })

  it('点击列表项保存所选项目并关闭弹层', async () => {
    mockStores({ cards: [card('b1', 'Alpha'), card('b2', 'Beta')] })
    const wrapper = mountEditor()

    await wrapper.findAll('.project-option')[1].trigger('click')

    const setProperty = vi.mocked(usePropertyStore()).setProperty
    expect(setProperty).toHaveBeenCalledWith('block-1', 'project', 'Beta', 'string')
    expect(editorStoreMock.hideQuickPropertyEditor).toHaveBeenCalled()
  })

  it('无匹配时回车以输入内容创建新项目', async () => {
    mockStores({ cards: [card('b1', 'Alpha')] })
    const wrapper = mountEditor()
    const input = wrapper.find('input.project-search')

    await input.setValue('NewProj')
    await input.trigger('keydown', { key: 'Enter' })

    const setProperty = vi.mocked(usePropertyStore()).setProperty
    expect(setProperty).toHaveBeenCalledWith('block-1', 'project', 'NewProj', 'string')
  })

  it('高亮列表项后回车选中该项而非输入内容', async () => {
    mockStores({ cards: [card('b1', 'Alpha'), card('b2', 'Beta')] })
    const wrapper = mountEditor()
    const input = wrapper.find('input.project-search')

    await input.setValue('a')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })

    const setProperty = vi.mocked(usePropertyStore()).setProperty
    expect(setProperty).toHaveBeenCalledWith('block-1', 'project', 'Alpha', 'string')
  })

  it('无任何已有项目时显示创建提示', () => {
    mockStores({ cards: [card('b1')] })
    const wrapper = mountEditor()

    expect(wrapper.find('.project-empty').text()).toContain('暂无项目')
  })

  it('area 同样走搜索列表分支，图标为 🌐 且数据来自 area 值', async () => {
    editorStoreMock.quickPropertyEditor = {
      visible: true,
      blockId: 'block-1',
      key: 'area',
      position: { x: 0, y: 0 },
    }
    mockStores({
      cards: [
        cardWithProps('b1', { area: '研发' }),
        cardWithProps('b2', { area: '个人' }),
        cardWithProps('b3', { area: '研发' }),
        cardWithProps('b4', {}),
      ],
      currentValue: '个人',
    })
    const wrapper = mountEditor()

    const options = wrapper.findAll('.project-option')
    expect(options).toHaveLength(2)
    expect(options[0].text()).toContain('研发')
    expect(options[0].find('.option-icon').text()).toBe('🌐')
    expect(options[1].text()).toContain('个人')
    expect(options[1].classes('selected')).toBe(true)
    expect(wrapper.find('input.project-search').attributes('placeholder')).toContain('领域')

    // 点击列表项保存到 area
    await wrapper.findAll('.project-option')[0].trigger('click')
    expect(vi.mocked(usePropertyStore()).setProperty).toHaveBeenCalledWith('block-1', 'area', '研发', 'string')
  })

  it('非搜索列表型内置属性不受影响（status 走 closedValues 下拉）', () => {
    editorStoreMock.quickPropertyEditor = {
      visible: true,
      blockId: 'block-1',
      key: 'status',
      position: { x: 0, y: 0 },
    }
    mockStores({ cards: [card('b1', 'Alpha')] })
    const wrapper = mountEditor()

    expect(wrapper.find('.project-list').exists()).toBe(false)
    expect(wrapper.find('.quick-option').exists()).toBe(true)
  })
})
