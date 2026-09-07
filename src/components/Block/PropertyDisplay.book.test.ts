// 书笔记 Block 属性渲染单测（票 06 / ADR-0040 D3/D7）：quote/book/chapter
// 书笔记以紧凑来源行展示：Pin + [卷/部 /] 章节 + 原文引用；
// cfi 是系统属性不渲染；仅 Tauri 环境且 cfi 属性存在时整行可点击。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { BUILT_IN_PROPERTIES } from '../../types/property'
import type { Property } from '../../types/property'

const { mockOpenReaderWindow, mockIsTauri } = vi.hoisted(() => ({
  mockOpenReaderWindow: vi.fn(),
  mockIsTauri: vi.fn(),
}))

vi.mock('../../composables/useReaderWindow', () => ({
  openReaderWindow: mockOpenReaderWindow,
}))
vi.mock('../../wasm/tauri-platform', () => ({
  isTauriEnvironment: () => mockIsTauri(),
}))
vi.mock('../../stores/property', () => ({ usePropertyStore: vi.fn() }))
vi.mock('../../stores/blocks', () => ({ useBlockStore: vi.fn() }))

import { usePropertyStore } from '../../stores/property'
import { useBlockStore } from '../../stores/blocks'
import PropertyDisplay from './PropertyDisplay.vue'

const CFI = 'epubcfi(/6/4!/4/10/2:0)'

/** 笔记 Block 四件套属性实例 */
function noteProperties(withCfi = true): Property[] {
  const entries: Array<[string, string]> = [
    ['book', '测试书'],
    ['chapter', '第一章'],
    ['quote', '原文摘录一句'],
  ]
  if (withCfi) entries.push(['cfi', CFI])
  return entries.map(([key, value], i) => ({
    id: `p-${i}`,
    blockId: 'b-1',
    key,
    value,
    type: 'string' as const,
    sortOrder: i,
    isHidden: false,
    isDeleted: false,
    schemaVersion: 1,
    createdAt: 0,
    updatedAt: 0,
  }))
}

/** 挂载 PropertyDisplay：property store mock 返回给定属性；block store mock 返回书 Page 归属 */
function mountDisplay(props: Property[], blockPageId = 'book-1') {
  vi.mocked(usePropertyStore).mockReturnValue({
    getBlockProperties: vi.fn(() => props),
    getPropertyDef: vi.fn((key: string) => BUILT_IN_PROPERTIES.find(p => p.key === key)),
  } as unknown as ReturnType<typeof usePropertyStore>)
  vi.mocked(useBlockStore).mockReturnValue({
    getBlock: vi.fn(() => ({ id: 'b-1', pageId: blockPageId })),
  } as unknown as ReturnType<typeof useBlockStore>)
  return mount(PropertyDisplay, { props: { blockId: 'b-1' } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mockIsTauri.mockReturnValue(true)
  mockOpenReaderWindow.mockReset()
  mockOpenReaderWindow.mockResolvedValue(undefined)
})

describe('PropertyDisplay（书笔记属性渲染）', () => {
  it('书笔记以紧凑来源行展示：Pin + 章节 + 原文引用（无引号）', () => {
    const wrapper = mountDisplay(noteProperties())

    const source = wrapper.find('.book-note-source')
    expect(source.exists()).toBe(true)
    expect(source.text()).toContain('第一章')
    expect(source.text()).toContain('原文摘录一句')
    expect(source.text()).not.toContain('"原文摘录一句"')

    // 不再以展开的属性列表展示书名/章节/原文
    expect(wrapper.find('.property-list').exists()).toBe(false)
  })

  it('存在 part 属性时以双层结构展示：父章节 / 子章节', () => {
    const props = [...noteProperties(), {
      id: 'p-part',
      blockId: 'b-1',
      key: 'part',
      value: '第五部',
      type: 'string' as const,
      sortOrder: 4,
      isHidden: false,
      isDeleted: false,
      schemaVersion: 1,
      createdAt: 0,
      updatedAt: 0,
    }]
    const wrapper = mountDisplay(props)

    const source = wrapper.find('.book-note-source')
    expect(source.exists()).toBe(true)
    expect(source.text()).toContain('第五部 / 第一章')
  })

  it('cfi 是系统属性：不渲染原始 CFI 串（跳回原文的数据源，非展示信息）', () => {
    const wrapper = mountDisplay(noteProperties(true))

    expect(wrapper.text()).not.toContain(CFI)
    expect(wrapper.text()).not.toContain('epubcfi(')
  })

  it('Tauri 环境且有 cfi 属性：来源行可点击，唤起阅读器窗口（bookPageId + cfi）', async () => {
    const wrapper = mountDisplay(noteProperties())

    const source = wrapper.find('.book-note-source')
    expect(source.exists()).toBe(true)
    expect(source.classes()).toContain('can-jump')

    await source.trigger('click')

    expect(mockOpenReaderWindow).toHaveBeenCalledTimes(1)
    expect(mockOpenReaderWindow).toHaveBeenCalledWith('book-1', { jumpCfi: CFI })
  })

  it('无 cfi 属性（普通笔记/手动建的 block）：来源行仍展示，但不可跳转', () => {
    const wrapper = mountDisplay(noteProperties(false))

    expect(wrapper.find('.book-note-source').exists()).toBe(true)
    expect(wrapper.find('.book-note-source').classes()).not.toContain('can-jump')
  })

  it('非 Tauri 环境（web/Android）：来源行仍展示，但不可跳转', () => {
    mockIsTauri.mockReturnValue(false)
    const wrapper = mountDisplay(noteProperties())

    expect(wrapper.find('.book-note-source').exists()).toBe(true)
    expect(wrapper.find('.book-note-source').classes()).not.toContain('can-jump')
  })
})
