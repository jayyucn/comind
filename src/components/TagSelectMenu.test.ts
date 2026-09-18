import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import TagSelectMenu from './TagSelectMenu.vue'
import { useEditorStore } from '../stores/editor'
import { usePageStore } from '../stores/pages'
import { useTagStore } from '../composables/useTagStore'

vi.mock('../stores/editor', () => ({ useEditorStore: vi.fn() }))
vi.mock('../stores/pages', () => ({ usePageStore: vi.fn() }))
vi.mock('../composables/useTagStore', () => ({ useTagStore: vi.fn() }))

let updateListener: (() => void) | null = null
// 控制的编辑器文本（textBetween 返回值）
let docText = ''
let cursorPos = 0

function makeEditorMock() {
  return {
    on: vi.fn((evt: string, cb: () => void) => { if (evt === 'update') updateListener = cb }),
    off: vi.fn(),
    chain: vi.fn().mockReturnThis(),
    deleteRange: vi.fn().mockReturnThis(),
    focus: vi.fn().mockReturnThis(),
    run: vi.fn(),
    view: { dom: document.createElement('div') },
    state: {
      selection: { get from() { return cursorPos } },
      doc: { textBetween: vi.fn(() => docText) },
    },
  }
}

function mountMenu() {
  return mount(TagSelectMenu, {
    global: { stubs: { Teleport: { template: '<div><slot /></div>' } } },
  })
}

function dispatchTrigger(range = { from: 0, to: 1 }, position = 0) {
  document.dispatchEvent(new CustomEvent('tag-input-trigger', {
    detail: {
      view: { coordsAtPos: () => ({ left: 100, bottom: 200 }) },
      position,
      range,
    },
  }))
}

describe('TagSelectMenu（#132）', () => {
  let applyTag: ReturnType<typeof vi.fn>
  let createTagPage: ReturnType<typeof vi.fn>
  let editor: ReturnType<typeof makeEditorMock>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    updateListener = null
    docText = ''
    cursorPos = 0

    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })

    editor = makeEditorMock()
    vi.mocked(useEditorStore).mockReturnValue({
      activeEditor: editor,
      activeBlockId: 'block-1',
    } as any)

    createTagPage = vi.fn(async (title: string) => ({ id: `tag-${title}`, title }))
    vi.mocked(usePageStore).mockReturnValue({
      pages: [
        { id: 'tag-book', title: 'Book', type: 'tag', deleted: false },
        { id: 'tag-person', title: 'Person', type: 'tag', deleted: false },
        { id: 'page-normal', title: 'SomePage', type: 'normal', deleted: false },
      ],
      createTagPage,
      ensurePagesLoaded: vi.fn().mockResolvedValue(undefined),
    } as any)

    applyTag = vi.fn().mockResolvedValue({ id: 'link-1' })
    vi.mocked(useTagStore).mockReturnValue({ applyTag } as any)
  })

  it('tag-input-trigger 打开面板并列出已有标签页（排除普通页）', async () => {
    const wrapper = mountMenu()
    dispatchTrigger()
    await flushPromises()

    expect(wrapper.find('.tag-select-menu').exists()).toBe(true)
    const text = wrapper.text()
    expect(text).toContain('Book')
    expect(text).toContain('Person')
    expect(text).not.toContain('SomePage')
  })

  it('点击已有标签 → 删除 #word 文本并 applyTag(blockId, tagPageId)', async () => {
    const wrapper = mountMenu()
    dispatchTrigger()
    await flushPromises()

    // 第一个候选项 = Book
    await wrapper.findAll('.tag-select-item')[0].trigger('click')
    await flushPromises()

    expect(editor.deleteRange).toHaveBeenCalled()
    expect(editor.run).toHaveBeenCalled()
    expect(applyTag).toHaveBeenCalledWith('block-1', 'tag-book')
  })

  it('输入新标签名 → 出现「创建」项，选中后 createTagPage + applyTag', async () => {
    const wrapper = mountMenu()
    dispatchTrigger()
    await flushPromises()

    // 模拟用户继续输入：“#NewTag” → 同步查询词
    docText = '#NewTag'
    cursorPos = 7
    updateListener?.()
    await flushPromises()

    expect(wrapper.text()).toContain('创建')
    const items = wrapper.findAll('.tag-select-item')
    await items[items.length - 1].trigger('click')
    await flushPromises()

    expect(createTagPage).toHaveBeenCalledWith('NewTag')
    expect(applyTag).toHaveBeenCalledWith('block-1', 'tag-NewTag')
  })
})
