// 票 07 组件测试：HighlightPanel 面板本体 + ReaderView 集成。
// 覆盖：面板渲染（章节分组/组内创建时间倒序/有无笔记状态/笔记摘要 join）、
// 点条目 locate 事件、删除流（无笔记直删 / 有笔记二次确认的确认与取消分支，
// 删除仅删高亮行不删 Block）、追加与修改笔记流（复用 NoteInputPopover +
// createOrUpdateNoteBlock）、ReaderView 顶栏开关、常驻侧栏点条目 CFI 定位
// （面板保持展开）、删除后正文绘制层重绘（highlightVersion 联动）。
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { EPUB, EPUBSection } from 'foliate-js/epub.js'
import { cfiFromRange } from '../../services/epub-cfi'
import { useReaderTypography } from '../../composables/useReaderTypography'
import type { Block } from '../../types/block'
import type { BookHighlightRust, BookProgressRust } from '../../wasm/types'

const {
  mockLoadBook, mockGetBookProgress, mockUpsertBookProgress, mockGetBookHighlights,
  mockUpsertBookHighlight, mockDeleteBookHighlight, mockCreateOrUpdateNoteBlock,
  mockLoadNoteText, mockListen, mockLoadPageBlocks, mockStore,
} = vi.hoisted(() => {
  const mockLoadPageBlocks = vi.fn()
  return {
    mockLoadBook: vi.fn(),
    mockGetBookProgress: vi.fn(),
    mockUpsertBookProgress: vi.fn(),
    mockGetBookHighlights: vi.fn(),
    mockUpsertBookHighlight: vi.fn(),
    mockDeleteBookHighlight: vi.fn(),
    mockCreateOrUpdateNoteBlock: vi.fn(),
    mockLoadNoteText: vi.fn(),
    mockListen: vi.fn(),
    mockLoadPageBlocks,
    mockStore: { blocks: [] as Block[], loadPageBlocks: mockLoadPageBlocks },
  }
})

/** 绘制层断言用的 Fake Highlight（jsdom 无 CSS Custom Highlight API） */
class FakeHighlight {
  ranges: Range[]
  constructor(...ranges: Range[]) {
    this.ranges = ranges
  }
}

/** CSS.highlights 注册表（stub），供绘制断言 */
function highlightRegistry(): Map<string, FakeHighlight> {
  return (CSS as unknown as { highlights: Map<string, FakeHighlight> }).highlights
}

// 阅读器窗口为非 Tauri 环境（窗口控制早退）；jump-to 监听走 event mock
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mockListen }))
vi.mock('../../services/epub-loader', () => ({
  loadEpubFromStorage: (...args: unknown[]) => mockLoadBook(...args),
  formatLanguageMap: (x: unknown) => {
    if (typeof x === 'string') return x
    if (x && typeof x === 'object') {
      return String(Object.values(x as Record<string, unknown>)[0] ?? '')
    }
    return ''
  },
}))
vi.mock('../../wasm/client', () => ({
  initCoreClient: async () => ({
    getBookProgress: mockGetBookProgress,
    upsertBookProgress: mockUpsertBookProgress,
    getBookHighlights: mockGetBookHighlights,
    upsertBookHighlight: mockUpsertBookHighlight,
    deleteBookHighlight: mockDeleteBookHighlight,
  }),
  isTauriEnvironment: () => false,
}))
// 票 06/07 业务（生成/更新 Block）已由 book-note.test.ts 覆盖，此处 mock 验证接线
vi.mock('../../services/book-note', () => ({
  createOrUpdateNoteBlock: mockCreateOrUpdateNoteBlock,
  loadNoteText: mockLoadNoteText,
}))
// blocks store mock：reactive 包装（面板 join 摘要依赖 store.blocks 响应式，
// 写笔记后 Block 进 store → 摘要即时刷新，模拟真实 Pinia 行为）
vi.mock('../../stores/blocks', async () => {
  const { reactive } = await import('vue')
  return { useBlockStore: () => reactive(mockStore) }
})

import HighlightPanel from './HighlightPanel.vue'
import ReaderView from './ReaderView.vue'
import { useBlockStore } from '../../stores/blocks'

// ---- 测试数据构造 ----

/** 模拟 SQLite 内存库（get/delete 联动，重载即见删除结果） */
let db: BookHighlightRust[] = []

/** 章节 mock：createDocument 返回 DOMParser 解析的 Document */
function makeSection(id: string, bodyHtml: string): EPUBSection {
  return {
    id,
    createDocument: async () =>
      new DOMParser().parseFromString(`<html><body>${bodyHtml}</body></html>`, 'text/html'),
  }
}

/** EPUB 实例 mock：三章节 + 平铺 TOC */
function makeBook(): EPUB {
  const sections: EPUBSection[] = [
    makeSection('ch1.xhtml', '<h1>第一章</h1><p>第一章内容</p>'),
    makeSection('ch2.xhtml', '<h1>第二章</h1><p>第二章内容</p>'),
    makeSection('ch3.xhtml', '<h1>第三章</h1><p>第三章内容</p>'),
  ]
  const book = {
    metadata: { title: '测试书' },
    sections,
    toc: [
      { label: '第一章', href: 'ch1.xhtml', subitems: null },
      { label: '第二章', href: 'ch2.xhtml', subitems: null },
      { label: '第三章', href: 'ch3.xhtml', subitems: null },
    ],
    loadBlob: vi.fn(async (uri: string) => new Blob(['img:' + uri])),
    resolveHref: (href: string) => {
      const path = href.split('#')[0]
      const index = sections.findIndex(s => s.id === path)
      return index >= 0 ? { index, anchor: () => null } : null
    },
    getCover: async () => null,
  }
  return book as unknown as EPUB
}

/** 高亮记录构造（cfi 前缀 /6/N 对应 spine 序号 N/2-1） */
function makeHighlight(
  id: string,
  chapter: string,
  text: string,
  cfi: string,
  opts: { blockId?: string; createdAt?: number } = {},
): BookHighlightRust {
  return {
    id,
    book_page_id: 'book-1',
    cfi,
    text,
    chapter,
    color: 'yellow',
    block_id: opts.blockId ?? null,
    created_at: opts.createdAt ?? 1,
    updated_at: opts.createdAt ?? 1,
  }
}

/** 书 Page 上的笔记 Block 构造（join 摘要数据源） */
function makeBlock(id: string, content: string): Block {
  return {
    id,
    pageId: 'book-1',
    parentId: null,
    pos: 1000,
    content,
    format: {},
    type: 'bullet',
    createdAt: 1,
    updatedAt: 1,
  }
}

/** 首章/次章/末章 spine 前缀的 CFI（分组排序只看前缀，本地路径任意合法即可） */
const CH1_CFI = 'epubcfi(/6/2!/4/2/1:0)'
const CH2_CFI = 'epubcfi(/6/4!/4/2/1:0)'

function mountPanel(open = true) {
  return mount(HighlightPanel, {
    props: { open, bookId: 'book-1', bookTitle: '测试书' },
    attachTo: document.body,
  })
}

function mountReader(bookId = 'book-1') {
  return mount(ReaderView, { props: { bookId }, attachTo: document.body })
}

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock-object-url')
  URL.revokeObjectURL = vi.fn()
  ;(globalThis as { Highlight?: unknown }).Highlight = FakeHighlight
  ;(globalThis as { CSS?: unknown }).CSS = { highlights: new Map() }
})

afterAll(() => {
  delete (globalThis as { Highlight?: unknown }).Highlight
  delete (globalThis as { CSS?: unknown }).CSS
})

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadBook.mockReset()
  mockGetBookProgress.mockReset()
  mockGetBookProgress.mockResolvedValue(null)
  mockUpsertBookProgress.mockReset()
  mockUpsertBookProgress.mockResolvedValue({} as BookProgressRust)
  mockGetBookHighlights.mockReset()
  // 内存库语义：始终回显 db 当前状态（删除后重载即见变化）
  mockGetBookHighlights.mockImplementation(async () => db.map(h => ({ ...h })))
  mockUpsertBookHighlight.mockReset()
  mockUpsertBookHighlight.mockImplementation(async (h: BookHighlightRust) => h)
  mockDeleteBookHighlight.mockReset()
  mockDeleteBookHighlight.mockImplementation(async (id: string) => {
    db = db.filter(h => h.id !== id)
  })
  mockCreateOrUpdateNoteBlock.mockReset()
  mockCreateOrUpdateNoteBlock.mockImplementation(async (input: {
    text: string
    highlight: BookHighlightRust
  }) => {
    // 模拟真实 service：新建路径 Block 进 store（摘要可 join）+ 回填 block_id
    if (input.highlight.block_id) {
      return {
        blockId: input.highlight.block_id,
        created: false,
        highlight: input.highlight,
      }
    }
    useBlockStore().blocks.push(makeBlock('b-new', input.text))
    return {
      blockId: 'b-new',
      created: true,
      highlight: { ...input.highlight, block_id: 'b-new' },
    }
  })
  mockLoadNoteText.mockReset()
  mockLoadNoteText.mockResolvedValue('')
  mockListen.mockReset()
  mockListen.mockImplementation(async () => vi.fn())
  mockLoadPageBlocks.mockReset()
  mockLoadPageBlocks.mockResolvedValue(undefined)
  mockStore.blocks = []
  db = []
  useReaderTypography().updateTypography({
    fontSize: 17, lineHeight: 1.8, maxWidthCh: 42, theme: 'light',
  })
  localStorage.removeItem('comind-reader-typography')
  highlightRegistry().clear()
  document.getSelection()?.removeAllRanges()
})

afterEach(() => {
  document.body.innerHTML = ''
  document.getSelection()?.removeAllRanges()
  window.history.replaceState(null, '', '/')
})

// ---- 面板本体：渲染（分组/状态/摘要） ----

describe('HighlightPanel（渲染）', () => {
  it('按章节分组、组间书内顺序、组内创建时间倒序；有笔记的条目显示想法摘要', async () => {
    db = [
      makeHighlight('h-ch2-b', '第二章', '第二章后划的', CH2_CFI, { createdAt: 200 }),
      makeHighlight('h-ch1-b', '第一章', '第一章后划的', CH1_CFI, { createdAt: 150 }),
      makeHighlight('h-ch2-a', '第二章', '第二章先划的', CH2_CFI, { createdAt: 100 }),
      makeHighlight('h-ch1-a', '第一章', '第一章先划的', CH1_CFI, { createdAt: 50, blockId: 'b-1' }),
    ]
    mockStore.blocks = [makeBlock('b-1', '这条高亮的想法')]
    const wrapper = mountPanel()
    await flushPromises()

    const groups = document.body.querySelectorAll('.chapter-group')
    expect(groups).toHaveLength(2)
    // 组间按书内章节顺序（CFI 前缀 spine 序号）
    expect(groups[0].querySelector('.group-title')!.textContent).toBe('第一章')
    expect(groups[1].querySelector('.group-title')!.textContent).toBe('第二章')

    // 组内创建时间倒序（后划的在前）
    const ch1Items = groups[0].querySelectorAll('.highlight-item')
    expect(ch1Items).toHaveLength(2)
    expect(ch1Items[0].textContent).toContain('第一章后划的')
    expect(ch1Items[1].textContent).toContain('第一章先划的')
    const ch2Items = groups[1].querySelectorAll('.highlight-item')
    expect(ch2Items[0].textContent).toContain('第二章后划的')
    expect(ch2Items[1].textContent).toContain('第二章先划的')

    // 有笔记（block_id 且 join 到 Block content）→ 想法摘要；无笔记 → 无摘要
    expect(ch1Items[0].querySelector('.item-note')).toBeNull()
    const note = ch1Items[1].querySelector('.item-note')
    expect(note).toBeTruthy()
    expect(note!.textContent).toContain('这条高亮的想法')

    // 数据加载：高亮行 + 书 Page blocks（join 摘要）
    expect(mockGetBookHighlights).toHaveBeenCalledWith('book-1')
    expect(mockLoadPageBlocks).toHaveBeenCalledWith('book-1')
    wrapper.unmount()
  })

  it('block_id 指向的 Block 不在书 Page（异常数据）：不显示摘要、不出错', async () => {
    db = [makeHighlight('h-1', '第一章', '引文', CH1_CFI, { blockId: 'b-gone' })]
    mockStore.blocks = []
    const wrapper = mountPanel()
    await flushPromises()

    const items = document.body.querySelectorAll('.highlight-item')
    expect(items).toHaveLength(1)
    expect(items[0].querySelector('.item-note')).toBeNull()
    wrapper.unmount()
  })

  it('无高亮：空态提示', async () => {
    db = []
    const wrapper = mountPanel()
    await flushPromises()

    expect(document.body.querySelector('.highlight-item')).toBeNull()
    expect(document.body.querySelector('.panel-status')!.textContent).toContain('还没有高亮')
    wrapper.unmount()
  })

  it('默认关闭：折叠渲染、不拉数据，open 后才加载', async () => {
    db = [makeHighlight('h-1', '第一章', '引文', CH1_CFI)]
    const wrapper = mountPanel(false)
    await flushPromises()

    // 常驻侧栏：关闭态折叠（非 v-if 移除），且不拉数据（打开时才加载）
    expect(wrapper.get('.highlight-panel').classes()).toContain('collapsed')
    expect(mockGetBookHighlights).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

// ---- 面板本体：点条目跳转事件 ----

describe('HighlightPanel（点条目定位）', () => {
  it('点条目引文 → emit locate 携带该高亮 CFI（父级关抽屉并跳转）', async () => {
    db = [makeHighlight('h-1', '第一章', '第一章的引文', CH1_CFI)]
    const wrapper = mountPanel()
    await flushPromises()

    document.body.querySelector<HTMLButtonElement>('.highlight-panel .item-quote')!.click()
    const located = wrapper.emitted('locate')
    expect(located).toEqual([[CH1_CFI]])
    wrapper.unmount()
  })
})

// ---- 面板本体：删除流（含确认分支） ----

describe('HighlightPanel（删除流）', () => {
  it('无笔记条目：点删除直接删高亮行，列表移除并 emit changed', async () => {
    db = [makeHighlight('h-1', '第一章', '引文', CH1_CFI)]
    const wrapper = mountPanel()
    await flushPromises()

    document.body.querySelector<HTMLButtonElement>('button[title="删除高亮"]')!.click()
    await flushPromises()

    // 仅删高亮行（不动 Block：store blocks 无删除调用面）
    expect(mockDeleteBookHighlight).toHaveBeenCalledWith('h-1')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    // 列表移除 → 空态
    expect(document.body.querySelector('.highlight-item')).toBeNull()
    wrapper.unmount()
  })

  it('有笔记条目：点删除出二次确认（提示笔记保留）；取消不删，确认才删', async () => {
    db = [makeHighlight('h-1', '第一章', '引文', CH1_CFI, { blockId: 'b-1' })]
    mockStore.blocks = [makeBlock('b-1', '已有想法')]
    const wrapper = mountPanel()
    await flushPromises()

    // 点删除 → 出确认（不落库）
    document.body.querySelector<HTMLButtonElement>('button[title="删除高亮"]')!.click()
    await flushPromises()
    expect(mockDeleteBookHighlight).not.toHaveBeenCalled()
    const hint = document.body.querySelector('.confirm-hint')
    expect(hint).toBeTruthy()
    expect(hint!.textContent).toContain('保留')

    // 取消 → 收起确认、不删
    document.body.querySelector<HTMLButtonElement>('.confirm-cancel')!.click()
    await flushPromises()
    expect(mockDeleteBookHighlight).not.toHaveBeenCalled()
    expect(document.body.querySelector('.confirm-hint')).toBeNull()
    expect(document.body.querySelectorAll('.highlight-item')).toHaveLength(1)

    // 再删 → 确认 → 删高亮行
    document.body.querySelector<HTMLButtonElement>('button[title="删除高亮"]')!.click()
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('.confirm-ok')!.click()
    await flushPromises()
    expect(mockDeleteBookHighlight).toHaveBeenCalledWith('h-1')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    // 笔记 Block 保留（store blocks 不受影响）
    expect(useBlockStore().blocks).toHaveLength(1)
    wrapper.unmount()
  })
})

// ---- 面板本体：追加/修改笔记流（复用 NoteInputPopover） ----

describe('HighlightPanel（笔记流）', () => {
  it('无笔记条目点「写笔记」→ 浮层（quote 上下文）→ 提交：service 接管，摘要即时反映', async () => {
    db = [makeHighlight('h-1', '第一章', '第一章的引文', CH1_CFI)]
    const wrapper = mountPanel()
    await flushPromises()

    document.body.querySelector<HTMLButtonElement>('button[title="写笔记"]')!.click()
    await flushPromises()

    const popover = document.body.querySelector('.note-input-popover')
    expect(popover).toBeTruthy()
    // 高亮原文作上下文展示
    expect(popover!.textContent).toContain('第一章的引文')
    // 无已有笔记：不预填
    expect(mockLoadNoteText).not.toHaveBeenCalled()

    // 填写想法并保存
    const textarea = popover!.querySelector('textarea')!
    textarea.value = '新想法'
    textarea.dispatchEvent(new Event('input'))
    popover!.querySelector<HTMLButtonElement>('button.primary')!.click()
    await flushPromises()

    // service 接管：上下文四件套 + 高亮行 + 想法文本
    expect(mockCreateOrUpdateNoteBlock).toHaveBeenCalledTimes(1)
    const input = mockCreateOrUpdateNoteBlock.mock.calls[0][0]
    expect(input.text).toBe('新想法')
    expect(input.bookPageId).toBe('book-1')
    expect(input.bookTitle).toBe('测试书')
    expect(input.chapter).toBe('第一章')
    expect(input.quote).toBe('第一章的引文')
    expect(input.cfi).toBe(CH1_CFI)
    expect(input.highlight.id).toBe('h-1')

    // 浮层关闭；回填 block_id 后条目显示想法摘要（join store blocks）
    expect(document.body.querySelector('.note-input-popover')).toBeNull()
    const note = document.body.querySelector('.item-note')
    expect(note).toBeTruthy()
    expect(note!.textContent).toContain('新想法')
    wrapper.unmount()
  })

  it('已有笔记条目再写：浮层预填旧笔记文本，提交走更新路径（同一条高亮行）', async () => {
    db = [makeHighlight('h-1', '第一章', '引文', CH1_CFI, { blockId: 'b-1' })]
    mockStore.blocks = [makeBlock('b-1', '旧想法')]
    mockLoadNoteText.mockResolvedValue('旧想法')
    const wrapper = mountPanel()
    await flushPromises()

    document.body.querySelector<HTMLButtonElement>('button[title="写笔记"]')!.click()
    await flushPromises()

    // 预填旧文（从库读取）
    expect(mockLoadNoteText).toHaveBeenCalledWith('b-1')
    const textarea = document.body.querySelector('.note-input-popover textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe('旧想法')

    // 改写并保存
    textarea.value = '新想法'
    textarea.dispatchEvent(new Event('input'))
    document.body.querySelector<HTMLButtonElement>('.note-input-popover button.primary')!.click()
    await flushPromises()

    expect(mockCreateOrUpdateNoteBlock).toHaveBeenCalledTimes(1)
    const input = mockCreateOrUpdateNoteBlock.mock.calls[0][0]
    expect(input.text).toBe('新想法')
    expect(input.highlight.block_id).toBe('b-1')
    wrapper.unmount()
  })
})

// ---- ReaderView 集成：顶栏开关 / 点条目跳转 / 删除后正文重绘 ----

describe('ReaderView（票 07 高亮面板集成）', () => {
  /** 生成一条指向第二章段落开头的 CFI（真实链路：同构 DOM） */
  async function makeChapter2Cfi(): Promise<string> {
    mockLoadBook.mockResolvedValue(makeBook())
    const probe = mountReader()
    await flushPromises()
    await probe.get('button[title="下一章"]').trigger('click')
    await flushPromises()
    const contentEl = probe.get('.chapter-content').element as HTMLElement
    const textNode = contentEl.querySelector('p')!.firstChild!
    const anchor = document.createRange()
    anchor.setStart(textNode, 0)
    anchor.setEnd(textNode, 2)
    const cfi = cfiFromRange(contentEl, anchor, 1)
    probe.unmount()
    return cfi
  }

  /** 生成一条指向当前章（第一章）段落开头的高亮 CFI */
  async function makeChapter1HighlightCfi(): Promise<string> {
    mockLoadBook.mockResolvedValue(makeBook())
    const probe = mountReader()
    await flushPromises()
    const contentEl = probe.get('.chapter-content').element as HTMLElement
    const textNode = contentEl.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 3)
    const cfi = cfiFromRange(contentEl, range, 0)
    probe.unmount()
    return cfi
  }

  it('顶栏「本书高亮」按钮开关高亮侧栏', async () => {
    mockLoadBook.mockResolvedValue(makeBook())
    const wrapper = mountReader()
    await flushPromises()

    // 常驻侧栏：初始折叠
    expect(wrapper.get('.highlight-panel').classes()).toContain('collapsed')

    await wrapper.get('button[title="本书高亮"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.highlight-panel').classes()).not.toContain('collapsed')
    // 常驻侧栏无黑色遮罩
    expect(wrapper.find('.highlight-panel-overlay').exists()).toBe(false)

    // 面板关闭按钮 → 折叠
    await wrapper.get('.highlight-panel .panel-close-btn').trigger('click')
    await flushPromises()
    expect(wrapper.get('.highlight-panel').classes()).toContain('collapsed')
    wrapper.unmount()
  })

  it('面板点条目：切章 + CFI 定位滚动，侧栏保持常驻', async () => {
    const cfi = await makeChapter2Cfi()
    db = [makeHighlight('h-1', '第二章', '第二章内容', cfi)]

    mockLoadBook.mockResolvedValue(makeBook())
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      const wrapper = mountReader()
      await flushPromises()

      await wrapper.get('button[title="本书高亮"]').trigger('click')
      await flushPromises()
      // 面板列出该条
      const quote = document.body.querySelector<HTMLButtonElement>('.highlight-panel .item-quote')
      expect(quote).toBeTruthy()

      quote!.click()
      await flushPromises()

      // 切章定位（block: 'center'，跳转闪烁），侧栏保持展开（常驻）
      expect(wrapper.get('.highlight-panel').classes()).not.toContain('collapsed')
      expect(wrapper.get('.chapter-content').text()).toContain('第二章内容')
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView.mock.calls[0][0]).toEqual({ block: 'center' })
      const target = scrollIntoView.mock.contexts[0] as Element
      expect(target.textContent).toBe('第二章内容')
      wrapper.unmount()
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('面板删除高亮：正文绘制层同步移除（重载重绘）', async () => {
    const cfi = await makeChapter1HighlightCfi()
    db = [makeHighlight('h-1', '第一章', '第一章', cfi)]

    mockLoadBook.mockResolvedValue(makeBook())
    const wrapper = mountReader()
    await flushPromises()
    expect(highlightRegistry().get('reader-highlight')!.ranges).toHaveLength(1)

    await wrapper.get('button[title="本书高亮"]').trigger('click')
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('button[title="删除高亮"]')!.click()
    await flushPromises()

    expect(mockDeleteBookHighlight).toHaveBeenCalledWith('h-1')
    // 正文高亮重载重绘（内存库已删 → 绘制层清空）
    expect(highlightRegistry().get('reader-highlight')).toBeUndefined()
    // 面板列表同步移除
    expect(document.body.querySelector('.highlight-item')).toBeNull()
    wrapper.unmount()
  })
})
