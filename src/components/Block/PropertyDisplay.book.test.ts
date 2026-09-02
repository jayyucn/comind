// 书笔记 Block 属性渲染单测（票 06 / ADR-0040 D3/D7）：quote/book/chapter
// 属性使笔记脱离书文件可读（其他端语义）；cfi 是系统属性不渲染；「↗ 原文」
// 按钮仅 Tauri 环境且 cfi 属性存在时显示，点击唤起阅读器窗口并携带 CFI。
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
  it('book/chapter/quote 渲染为可读文本（笔记脱离书文件可读，其他端语义）', () => {
    const wrapper = mountDisplay(noteProperties())

    const text = wrapper.text()
    expect(text).toContain('测试书')
    expect(text).toContain('第一章')
    expect(text).toContain('原文摘录一句')
  })

  it('cfi 是系统属性：不渲染原始 CFI 串（跳回原文的数据源，非展示信息）', () => {
    const wrapper = mountDisplay(noteProperties(true))

    expect(wrapper.text()).not.toContain(CFI)
    expect(wrapper.text()).not.toContain('epubcfi(')
  })

  it('Tauri 环境且有 cfi 属性：渲染「↗ 原文」按钮，点击唤起阅读器窗口（bookPageId + cfi）', async () => {
    const wrapper = mountDisplay(noteProperties())

    const btn = wrapper.find('button.jump-source-btn')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('原文')

    await btn.trigger('click')

    expect(mockOpenReaderWindow).toHaveBeenCalledTimes(1)
    expect(mockOpenReaderWindow).toHaveBeenCalledWith('book-1', { jumpCfi: CFI })
  })

  it('无 cfi 属性（普通笔记/手动建的 block）：不显示跳回原文按钮', () => {
    const wrapper = mountDisplay(noteProperties(false))

    expect(wrapper.find('button.jump-source-btn').exists()).toBe(false)
  })

  it('非 Tauri 环境（web/Android）：不显示跳回原文按钮', () => {
    mockIsTauri.mockReturnValue(false)
    const wrapper = mountDisplay(noteProperties())

    expect(wrapper.find('button.jump-source-btn').exists()).toBe(false)
  })
})
