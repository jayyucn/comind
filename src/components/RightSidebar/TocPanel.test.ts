// 右栏 TocPanel（ADR-0059 D6）测试：绑定 currentPageId、标题/书章提取、点击定位活动 pane。
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Block } from '../../types/block'
import type { FieldValue } from '../../types/field-value'

const {
  mockGetPage, mockCurrentPageId, mockBlocks, mockPropMap, mockLoadMultiBlockFieldValues,
  mockActivePaneId, mockOpenReaderWindow, mockIsTauri,
} = vi.hoisted(() => ({
  mockGetPage: vi.fn(),
  mockCurrentPageId: { value: '' as string },
  mockBlocks: { value: [] as Block[] },
  mockPropMap: new Map<string, FieldValue[]>(),
  mockLoadMultiBlockFieldValues: vi.fn(async () => {}),
  mockActivePaneId: { value: '' as string },
  mockOpenReaderWindow: vi.fn(async () => {}),
  mockIsTauri: { value: false },
}))

vi.mock('../../stores/pages', () => ({
  usePageStore: () => ({ currentPageId: mockCurrentPageId.value, getPage: mockGetPage }),
}))
vi.mock('../../stores/blocks', () => ({
  useBlockStore: () => ({ blocks: mockBlocks.value }),
}))
vi.mock('../../stores/fieldValue', () => ({
  useFieldValueStore: () => ({
    getBlockFieldValues: (blockId: string) => mockPropMap.get(blockId) ?? [],
    loadMultiBlockFieldValues: mockLoadMultiBlockFieldValues,
  }),
}))
vi.mock('../../stores/panes', () => ({
  usePanesStore: () => ({ activePaneId: mockActivePaneId.value }),
}))
vi.mock('../../composables/useReaderWindow', () => ({
  openReaderWindow: mockOpenReaderWindow,
}))
vi.mock('../../wasm/tauri-platform', () => ({
  isTauriEnvironment: () => mockIsTauri.value,
}))

import TocPanel from './TocPanel.vue'

const PAGE_ID = 'page-1'

beforeAll(() => {
  // jsdom 无 scrollIntoView，mock 掉供点击定位断言
  Element.prototype.scrollIntoView = vi.fn()
})

function makeBlock(
  id: string,
  pos: number,
  parentId: string | null = null,
  format: Record<string, unknown> = {},
  content = '',
): Block {
  return { id, pageId: PAGE_ID, parentId, pos, content, format, type: 'bullet', createdAt: 0, updatedAt: 0 }
}

function setProps(blockId: string, p: { part?: string; chapter?: string; cfi?: string }): void {
  const values: FieldValue[] = [
    ...(p.part ? [{ id: `${blockId}-part`, block_id: blockId, field_definition_id: 'fd-part', key: 'part', value_json: p.part, value_type: 'string', seq: 0, created_at: 0, updated_at: 0, version: 0, deleted_at: null }] : []),
    ...(p.chapter ? [{ id: `${blockId}-ch`, block_id: blockId, field_definition_id: 'fd-chapter', key: 'chapter', value_json: p.chapter, value_type: 'string', seq: 0, created_at: 0, updated_at: 0, version: 0, deleted_at: null }] : []),
    ...(p.cfi ? [{ id: `${blockId}-cfi`, block_id: blockId, field_definition_id: 'fd-cfi', key: 'cfi', value_json: p.cfi, value_type: 'string', seq: 0, created_at: 0, updated_at: 0, version: 0, deleted_at: null }] : []),
  ]
  mockPropMap.set(blockId, values)
}

let wrapper: ReturnType<typeof mount> | null = null

function mountPanel(pageType: string) {
  mockGetPage.mockReturnValue({ id: PAGE_ID, blockId: 'root-id', type: pageType, title: '测试' })
  wrapper = mount(TocPanel)
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPropMap.clear()
  mockBlocks.value = []
  mockCurrentPageId.value = PAGE_ID
  mockActivePaneId.value = 'p1'
  mockIsTauri.value = false
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('TocPanel — 普通源（heading 大纲）', () => {
  it('heading 块按 level 嵌套渲染', () => {
    mockBlocks.value = [
      makeBlock('h1a', 1000, null, { type: 'heading', level: 1 }, '概述'),
      makeBlock('h2a', 2000, null, { type: 'heading', level: 2 }, '背景'),
      makeBlock('h2b', 3000, null, { type: 'heading', level: 2 }, '方法'),
      makeBlock('h1b', 4000, null, { type: 'heading', level: 1 }, '结论'),
      makeBlock('plain', 5000, null, {}, '普通段落不进大纲'),
    ]
    mountPanel('doc')

    expect(wrapper!.find('.toc-list').exists()).toBe(true)
    const rows = wrapper!.findAll('.toc-row')
    expect(rows.length).toBe(4)
    expect(wrapper!.text()).toContain('概述')
    expect(wrapper!.text()).toContain('背景')
    expect(wrapper!.text()).toContain('方法')
    expect(wrapper!.text()).toContain('结论')
    expect(wrapper!.text()).not.toContain('普通段落不进大纲')
    // 普通页不触发字段值拉取
    expect(mockLoadMultiBlockFieldValues).not.toHaveBeenCalled()
  })

  it('编辑器手打标题（content # 前缀）→ 仍能生成大纲', () => {
    mockBlocks.value = [
      makeBlock('h1a', 1000, null, {}, '# 概述'),
      makeBlock('h2a', 2000, null, {}, '## 背景'),
      makeBlock('h1b', 4000, null, {}, '# 结论'),
    ]
    mountPanel('doc')
    expect(wrapper!.findAll('.toc-row').length).toBe(3)
    expect(wrapper!.text()).toContain('概述')
    expect(wrapper!.text()).toContain('背景')
    expect(wrapper!.text()).toContain('结论')
  })

  it('无 heading 块 → 空态', () => {
    mockBlocks.value = [makeBlock('a', 1000, null, {}, '纯文本')]
    mountPanel('doc')
    expect(wrapper!.find('.toc-empty').exists()).toBe(true)
  })
})

describe('TocPanel — 书源（type=book）', () => {
  it('part/chapter 分组为章→节', () => {
    mockBlocks.value = [
      makeBlock('n1', 1000), makeBlock('n2', 2000), makeBlock('n3', 3000),
    ]
    setProps('n1', { part: '第一部', chapter: '1.1', cfi: 'c1' })
    setProps('n2', { part: '第一部', chapter: '1.1', cfi: 'c2' })
    setProps('n3', { part: '第一部', chapter: '1.2', cfi: 'c3' })

    mountPanel('book')
    expect(wrapper!.text()).toContain('第一部')
    expect(wrapper!.text()).toContain('1.1')
    expect(wrapper!.text()).toContain('1.2')
    // 书页触发字段值拉取
    expect(mockLoadMultiBlockFieldValues).toHaveBeenCalled()
  })
})

describe('TocPanel — 点击定位活动 pane', () => {
  it('点击标题行滚动活动 pane 内对应块', async () => {
    mockBlocks.value = [
      makeBlock('h1a', 1000, null, { type: 'heading', level: 1 }, '概述'),
      makeBlock('h2a', 2000, null, { type: 'heading', level: 2 }, '背景'),
    ]
    // 构造活动 pane 的 DOM（pane-body 内挂 data-block-id）
    document.body.innerHTML = `
      <div data-pane-id="p1">
        <div class="pane-body">
          <div data-block-id="h1a"></div>
          <div data-block-id="h2a"></div>
        </div>
      </div>
    `
    mountPanel('doc')

    const h2a = document.querySelector('[data-block-id="h2a"]') as HTMLElement
    const scrollSpy = vi.fn()
    h2a.scrollIntoView = scrollSpy

    // 点击「背景」行 → 应滚动活动 pane 内的 h2a（而非全局 navigate-to-block 事件）
    const rows = wrapper!.findAll('.toc-row')
    await rows[1].trigger('click')

    expect(scrollSpy).toHaveBeenCalled()
  })

  it('Tauri + cfi 书源叶子 → 「原文」跳回阅读器', async () => {
    mockIsTauri.value = true
    mockBlocks.value = [makeBlock('n1', 1000)]
    setProps('n1', { part: '第一部', chapter: '1.1', cfi: 'c1' })
    mountPanel('book')

    const jump = wrapper!.find('.jump-btn')
    expect(jump.exists()).toBe(true)
    await jump.trigger('click')
    expect(mockOpenReaderWindow).toHaveBeenCalledWith(PAGE_ID, { jumpCfi: 'c1' })
  })
})
