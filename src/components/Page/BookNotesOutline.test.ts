// BookNotesOutline 组件测试（B 方案 v1：书 Page 章/节大纲投影）。
// 覆盖：双层/单层分组渲染与计数、点击行滚动定位事件、行尾「原文」跳回
// （Tauri 环境 + cfi 存在时）、章折叠、无归属笔记时不渲染。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Block } from '../../types/block'
import type { Property } from '../../wasm/types'

const {
  mockGetPage, mockBlocks, mockPropMap, mockLoadMultiBlockProperties,
  mockOpenReaderWindow, mockIsTauri,
} = vi.hoisted(() => ({
  mockGetPage: vi.fn(),
  mockBlocks: { value: [] as Block[] },
  mockPropMap: new Map<string, Property[]>(),
  mockLoadMultiBlockProperties: vi.fn(async () => {}),
  mockOpenReaderWindow: vi.fn(async () => {}),
  mockIsTauri: vi.fn(() => false),
}))

vi.mock('../../stores/pages', () => ({
  usePageStore: () => ({ getPage: mockGetPage }),
}))
vi.mock('../../stores/blocks', () => ({
  useBlockStore: () => ({ blocks: mockBlocks.value, structureVersion: 0 }),
}))
vi.mock('../../stores/property', () => ({
  usePropertyStore: () => ({
    getBlockProperties: (blockId: string) => mockPropMap.get(blockId) ?? [],
    loadMultiBlockProperties: mockLoadMultiBlockProperties,
  }),
}))
vi.mock('../../composables/useReaderWindow', () => ({
  openReaderWindow: mockOpenReaderWindow,
}))
vi.mock('../../wasm/tauri-platform', () => ({
  isTauriEnvironment: () => mockIsTauri(),
}))

import BookNotesOutline from './BookNotesOutline.vue'

const PAGE_ID = 'page-1'

function makeBlock(id: string, pos: number, parentId: string | null = null): Block {
  return { id, pageId: PAGE_ID, parentId, pos, content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0 }
}

function setProps(blockId: string, p: { part?: string; chapter?: string; cfi?: string }): void {
  const props: Property[] = [
    ...(p.part ? [{ id: `${blockId}-part`, block_id: blockId, key: 'part', value: p.part, type: 'string', sort_order: 0, is_hidden: 0, is_deleted: 0, schema_version: 1, created_at: 0, updated_at: 0 }] : []),
    ...(p.chapter ? [{ id: `${blockId}-ch`, block_id: blockId, key: 'chapter', value: p.chapter, type: 'string', sort_order: 0, is_hidden: 0, is_deleted: 0, schema_version: 1, created_at: 0, updated_at: 0 }] : []),
    ...(p.cfi ? [{ id: `${blockId}-cfi`, block_id: blockId, key: 'cfi', value: p.cfi, type: 'string', sort_order: 0, is_hidden: 0, is_deleted: 0, schema_version: 1, created_at: 0, updated_at: 0 }] : []),
  ]
  mockPropMap.set(blockId, props)
}

/** 挂载组件：数据 = page 根信息 + 笔记块 + 各自属性 */
function mountOutline() {
  mockGetPage.mockReturnValue({ id: PAGE_ID, blockId: 'root-id', type: 'book', title: '测试书' })
  return mount(BookNotesOutline, { props: { pageId: PAGE_ID } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPropMap.clear()
  mockBlocks.value = []
  mockIsTauri.mockReturnValue(false)
  mockGetPage.mockReturnValue({ id: PAGE_ID, blockId: 'root-id', type: 'book', title: '测试书' })
})

describe('BookNotesOutline', () => {
  it('双层（part/chapter）：章行 + 缩进节行 + 计数', () => {
    mockBlocks.value = [
      makeBlock('n1', 1000), makeBlock('n2', 2000), makeBlock('n3', 3000),
      makeBlock('n4', 4000), makeBlock('orphan', 5000),
    ]
    setProps('n1', { part: '第一部', chapter: '1.1', cfi: 'c1' })
    setProps('n2', { part: '第一部', chapter: '1.1', cfi: 'c2' })
    setProps('n3', { part: '第一部', chapter: '1.2', cfi: 'c3' })
    setProps('n4', { part: '第二部', chapter: '2.1', cfi: 'c4' })
    setProps('orphan', {})

    const wrapper = mountOutline()
    const text = wrapper.text()
    expect(text).toContain('本书笔记')
    expect(text).toContain('4 条')
    expect(text).toContain('第一部')
    expect(text).toContain('1.1')
    expect(text).toContain('1.2')
    expect(text).toContain('第二部')
    expect(text).toContain('2.1')
    // 无归属笔记不进大纲
    expect(wrapper.find('.outline-list').text()).not.toContain('orphan')

    // 章 count = 3（含节），节 count 2/1
    const chapterRows = wrapper.findAll('.chapter-row')
    expect(chapterRows[0].find('.row-count').text()).toBe('3')
    expect(chapterRows[1].find('.row-count').text()).toBe('1')
    const sectionRows = wrapper.findAll('.section-row')
    expect(sectionRows[0].find('.row-count').text()).toBe('2')
    expect(sectionRows[1].find('.row-count').text()).toBe('1')

    // 挂载即触发属性拉取（数据独立性：不依赖各 Block 的 useBlockPropertySync）
    expect(mockLoadMultiBlockProperties).toHaveBeenCalled()
  })

  it('点击章/节行 dispatch navigate-to-block 定位到组内首条笔记', async () => {
    mockBlocks.value = [makeBlock('n1', 1000), makeBlock('n2', 2000), makeBlock('n3', 3000)]
    setProps('n1', { part: '第一部', chapter: '1.1', cfi: 'c1' })
    setProps('n2', { part: '第一部', chapter: '1.1', cfi: 'c2' })
    setProps('n3', { part: '第一部', chapter: '1.2', cfi: 'c3' })

    const navSpy = vi.fn()
    window.addEventListener('navigate-to-block', navSpy)
    const wrapper = mountOutline()

    // 章行 → 组内最早笔记（n1）；节 1.2 行 → n3
    await wrapper.findAll('.chapter-row')[0].trigger('click')
    expect(navSpy).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { blockId: 'n1' } }))

    await wrapper.findAll('.section-row')[1].trigger('click')
    expect(navSpy).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { blockId: 'n3' } }))
    window.removeEventListener('navigate-to-block', navSpy)
  })

  it('单层（无 part）：章直接成组，无二级节行', () => {
    mockBlocks.value = [makeBlock('a', 1000), makeBlock('b', 2000)]
    setProps('a', { chapter: '第一章', cfi: 'ca' })
    setProps('b', { chapter: '第二章', cfi: 'cb' })

    const wrapper = mountOutline()
    expect(wrapper.text()).toContain('第一章')
    expect(wrapper.text()).toContain('第二章')
    expect(wrapper.find('.sections').exists()).toBe(false)
    expect(wrapper.findAll('.chapter-row').length).toBe(2)
  })

  it('全部笔记无归属（无 TOC 的书）→ 大纲不渲染', () => {
    mockBlocks.value = [makeBlock('a', 1000)]
    setProps('a', {})
    const wrapper = mountOutline()
    expect(wrapper.find('.book-notes-outline').exists()).toBe(false)
  })

  it('Tauri 环境 + cfi：行尾「原文」唤起阅读器跳回', async () => {
    mockIsTauri.mockReturnValue(true)
    mockBlocks.value = [makeBlock('n1', 1000), makeBlock('n2', 2000)]
    setProps('n1', { part: '第一部', chapter: '1.1', cfi: 'c1' })
    setProps('n2', { part: '第二部', chapter: '2.1' }) // 无 cfi → 无按钮

    const wrapper = mountOutline()
    const jumpButtons = wrapper.findAll('.jump-btn')
    expect(jumpButtons.length).toBe(1)

    await jumpButtons[0].trigger('click')
    expect(mockOpenReaderWindow).toHaveBeenCalledWith(PAGE_ID, { jumpCfi: 'c1' })
  })

  it('非 Tauri 环境：不显示「原文」跳回按钮', () => {
    mockBlocks.value = [makeBlock('n1', 1000)]
    setProps('n1', { part: '第一部', chapter: '1.1', cfi: 'c1' })
    const wrapper = mountOutline()
    expect(wrapper.find('.jump-btn').exists()).toBe(false)
  })

  it('点击章 chevron 折叠/展开该章节行，不影响定位整行', async () => {
    mockBlocks.value = [makeBlock('n1', 1000), makeBlock('n2', 2000), makeBlock('n3', 3000)]
    setProps('n1', { part: '第一部', chapter: '1.1', cfi: 'c1' })
    setProps('n2', { part: '第一部', chapter: '1.1', cfi: 'c2' })
    setProps('n3', { part: '第二部', chapter: '2.1', cfi: 'c3' })

    const wrapper = mountOutline()
    expect(wrapper.findAll('.section-row').length).toBe(2)

    // 折叠「第一部」（第一个 chevron）
    await wrapper.findAll('.chev')[0].trigger('click')
    const sectionRows = wrapper.findAll('.section-row')
    expect(sectionRows.length).toBe(1)
    expect(sectionRows[0].text()).toContain('2.1')

    // 再次点击展开
    await wrapper.findAll('.chev')[0].trigger('click')
    expect(wrapper.findAll('.section-row').length).toBe(2)
  })
})
