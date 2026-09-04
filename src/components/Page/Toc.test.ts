// 通用 TOC 组件测试（替代原 BookNotesOutline.test.ts）。
// 注意：Toc 浮层 Teleport 到 body，故断言需查询 document.body，而非 wrapper 子树。
// 覆盖：
// - 书源：章→节双层/单层分组、计数、点击派发 navigate-to-block、行尾「原文」跳回（Tauri+cfi）、
//   章折叠、无归属笔记不渲染、书页触发属性拉取；
// - 普通源：heading 块按 level 嵌套、点击派发 navigate-to-block、无 cfi 按钮、不触发属性拉取；
// - 浮层收起/展开。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
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

import Toc from './Toc.vue'

const PAGE_ID = 'page-1'

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
  const props: Property[] = [
    ...(p.part ? [{ id: `${blockId}-part`, block_id: blockId, key: 'part', value: p.part, type: 'string', sort_order: 0, is_hidden: 0, is_deleted: 0, schema_version: 1, created_at: 0, updated_at: 0 }] : []),
    ...(p.chapter ? [{ id: `${blockId}-ch`, block_id: blockId, key: 'chapter', value: p.chapter, type: 'string', sort_order: 0, is_hidden: 0, is_deleted: 0, schema_version: 1, created_at: 0, updated_at: 0 }] : []),
    ...(p.cfi ? [{ id: `${blockId}-cfi`, block_id: blockId, key: 'cfi', value: p.cfi, type: 'string', sort_order: 0, is_hidden: 0, is_deleted: 0, schema_version: 1, created_at: 0, updated_at: 0 }] : []),
  ]
  mockPropMap.set(blockId, props)
}

// 浮层 Teleport 到 body，断言统一查 document.body
function q(sel: string): Element | null {
  return document.body.querySelector(sel)
}
function qa(sel: string): Element[] {
  return Array.from(document.body.querySelectorAll(sel))
}
function bodyText(): string {
  return document.body.textContent ?? ''
}

let wrapper: ReturnType<typeof mount> | null = null
function mountToc(pageType: string) {
  mockGetPage.mockReturnValue({ id: PAGE_ID, blockId: 'root-id', type: pageType, title: '测试' })
  wrapper = mount(Toc, { props: { pageId: PAGE_ID } })
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPropMap.clear()
  mockBlocks.value = []
  mockIsTauri.mockReturnValue(false)
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('Toc — 书源（type=book）', () => {
  it('双层（part/chapter）：章行 + 缩进节行 + 计数 + 属性拉取', () => {
    mockBlocks.value = [
      makeBlock('n1', 1000), makeBlock('n2', 2000), makeBlock('n3', 3000),
      makeBlock('n4', 4000), makeBlock('orphan', 5000),
    ]
    setProps('n1', { part: '第一部', chapter: '1.1', cfi: 'c1' })
    setProps('n2', { part: '第一部', chapter: '1.1', cfi: 'c2' })
    setProps('n3', { part: '第一部', chapter: '1.2', cfi: 'c3' })
    setProps('n4', { part: '第二部', chapter: '2.1', cfi: 'c4' })
    setProps('orphan', {})

    mountToc('book')
    const text = bodyText()
    expect(text).toContain('目录')
    // 大纲条目总数 = 章(2) + 节(1.1/1.2/2.1 = 3) = 5
    expect(q('.toc-count')?.textContent).toBe('5')
    expect(text).toContain('第一部')
    expect(text).toContain('1.1')
    expect(text).toContain('1.2')
    expect(text).toContain('第二部')
    expect(text).toContain('2.1')
    // 无归属笔记不进大纲
    expect(q('.toc-list')?.textContent).not.toContain('orphan')

    // 章 2 个 + 节 3 个 = 5 行
    expect(qa('.toc-row').length).toBe(5)
    const sectionRows = qa('.toc-children .toc-row')
    expect(sectionRows.length).toBe(3)
    expect(sectionRows[0].textContent).toContain('1.1')
    expect(sectionRows[1].textContent).toContain('1.2')
    expect(sectionRows[2].textContent).toContain('2.1')

    // 书页挂载即触发属性拉取
    expect(mockLoadMultiBlockProperties).toHaveBeenCalled()
  })

  it('点击章/节行 dispatch navigate-to-block 定位到对应块', async () => {
    mockBlocks.value = [makeBlock('n1', 1000), makeBlock('n2', 2000), makeBlock('n3', 3000)]
    setProps('n1', { part: '第一部', chapter: '1.1', cfi: 'c1' })
    setProps('n2', { part: '第一部', chapter: '1.1', cfi: 'c2' })
    setProps('n3', { part: '第一部', chapter: '1.2', cfi: 'c3' })

    const navSpy = vi.fn()
    window.addEventListener('navigate-to-block', navSpy)
    mountToc('book')

    // 章行 → 组内最早笔记（n1）
    qa('.toc-row')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(navSpy).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { blockId: 'n1' } }))

    // 节 1.2 行 → n3
    qa('.toc-children .toc-row')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(navSpy).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { blockId: 'n3' } }))
    window.removeEventListener('navigate-to-block', navSpy)
  })

  it('单层（无 part）：章直接成组，无二级节行', () => {
    mockIsTauri.mockReturnValue(true)
    mockBlocks.value = [makeBlock('a', 1000), makeBlock('b', 2000)]
    setProps('a', { chapter: '第一章', cfi: 'ca' })
    setProps('b', { chapter: '第二章', cfi: 'cb' })

    mountToc('book')
    expect(bodyText()).toContain('第一章')
    expect(bodyText()).toContain('第二章')
    expect(q('.toc-children')).toBeNull()
    // 两层均为叶子（各带 cfi）→ 共 2 个「原文」按钮
    expect(qa('.jump-btn').length).toBe(2)
  })

  it('全部笔记无归属（无 TOC 的书）→ 大纲不渲染', () => {
    mockBlocks.value = [makeBlock('a', 1000)]
    setProps('a', {})
    mountToc('book')
    expect(q('.toc-panel')).toBeNull()
  })

  it('Tauri 环境 + cfi：叶子节点行尾「原文」唤起阅读器跳回', async () => {
    mockIsTauri.mockReturnValue(true)
    mockBlocks.value = [makeBlock('n1', 1000), makeBlock('n2', 2000)]
    setProps('n1', { part: '第一部', chapter: '1.1', cfi: 'c1' })
    setProps('n2', { part: '第二部', chapter: '2.1' }) // 无 cfi → 无按钮

    mountToc('book')
    const jumpButtons = qa('.jump-btn')
    // 第一部章行(带 cfi 的章首条笔记) + 其下 1.1 节行 均显示「原文」= 2
    expect(jumpButtons.length).toBe(2)

    jumpButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(mockOpenReaderWindow).toHaveBeenCalledWith(PAGE_ID, { jumpCfi: 'c1' })
  })

  it('非 Tauri 环境：不显示「原文」按钮', () => {
    mockBlocks.value = [makeBlock('n1', 1000)]
    setProps('n1', { part: '第一部', chapter: '1.1', cfi: 'c1' })
    mountToc('book')
    expect(q('.jump-btn')).toBeNull()
  })
})

describe('Toc — 普通源（type=doc，heading 大纲）', () => {
  it('heading 块按 format.level 嵌套，点击派发 navigate-to-block', async () => {
    mockBlocks.value = [
      makeBlock('h1a', 1000, null, { type: 'heading', level: 1 }, '概述'),
      makeBlock('h2a', 2000, null, { type: 'heading', level: 2 }, '背景'),
      makeBlock('h2b', 3000, null, { type: 'heading', level: 2 }, '方法'),
      makeBlock('h1b', 4000, null, { type: 'heading', level: 1 }, '结论'),
      makeBlock('plain', 5000, null, {}, '普通段落不进大纲'),
    ]
    mountToc('doc')

    expect(bodyText()).toContain('概述')
    expect(bodyText()).toContain('背景')
    expect(bodyText()).toContain('方法')
    expect(bodyText()).toContain('结论')
    expect(q('.toc-list')?.textContent).not.toContain('普通段落不进大纲')

    // 顶层 2 章（概述/结论），概述下 2 节（背景/方法）
    expect(qa('.toc-row').length).toBe(4)
    const subRows = qa('.toc-children .toc-row')
    expect(subRows.length).toBe(2)

    // 普通页不触发属性拉取
    expect(mockLoadMultiBlockProperties).not.toHaveBeenCalled()
    // heading 无 cfi → 无「原文」按钮
    expect(q('.jump-btn')).toBeNull()

    const navSpy = vi.fn()
    window.addEventListener('navigate-to-block', navSpy)
    qa('.toc-row')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(navSpy).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { blockId: 'h1a' } }))
    subRows[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(navSpy).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { blockId: 'h2b' } }))
    window.removeEventListener('navigate-to-block', navSpy)
  })

  it('无 heading 块 → 大纲不渲染', () => {
    mockBlocks.value = [makeBlock('a', 1000, null, {}, '纯文本'), makeBlock('b', 2000)]
    mountToc('doc')
    expect(q('.toc-panel')).toBeNull()
  })

  it('编辑器手打标题（content `# ` 前缀、format 为空）→ 仍能生成大纲', async () => {
    // 真实世界里用户打 # 标题 时块 type 仍是 bullet、format 无 heading 标记，
    // 标题级别由 content 前缀长度决定（BulletRender 同款 parseHeading）。
    mockBlocks.value = [
      makeBlock('h1a', 1000, null, {}, '# 概述'),
      makeBlock('h2a', 2000, null, {}, '## 背景'),
      makeBlock('h3a', 3000, null, {}, '### 子细节'),
      makeBlock('h1b', 4000, null, {}, '# 结论'),
      makeBlock('plain', 5000, null, {}, '普通段落不进大纲'),
    ]
    mountToc('doc')

    expect(bodyText()).toContain('概述')
    expect(bodyText()).toContain('背景')
    expect(bodyText()).toContain('子细节')
    expect(bodyText()).toContain('结论')
    expect(q('.toc-list')?.textContent).not.toContain('普通段落不进大纲')

    // 顶层 2（概述/结论），概述下 背景→子细节 两级
    expect(qa('.toc-row').length).toBe(4)
    const subRows = qa('.toc-children .toc-row')
    expect(subRows.length).toBe(2)

    const navSpy = vi.fn()
    window.addEventListener('navigate-to-block', navSpy)
    qa('.toc-row')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(navSpy).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { blockId: 'h1a' } }))
    window.removeEventListener('navigate-to-block', navSpy)
  })
})

describe('Toc — 浮层收起/展开', () => {
  it('点击收起后出现 reopen 入口，再次展开恢复列表', async () => {
    mockBlocks.value = [makeBlock('h1a', 1000, null, { type: 'heading', level: 1 }, '概述')]
    mountToc('doc')

    expect(q('.toc-list')).not.toBeNull()
    q('.toc-toggle')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(q('.toc-list')).toBeNull()
    expect(q('.toc-reopen')).not.toBeNull()

    q('.toc-reopen')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(q('.toc-list')).not.toBeNull()
  })
})
