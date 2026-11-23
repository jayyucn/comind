import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import Editor from './Editor.vue'

vi.mock('../composables/useNavigateToPage', () => ({
  useNavigateToPage: vi.fn(() => ({ navigateToPage: vi.fn() }))
}))

// 回归：Shift-Enter 的段内换行（hardBreak）保存后消失。
// 根因：TipTap 的 getText / textBetween 只累加文本节点，跳过无文本的 hardBreak；
// 修复：Editor 侧统一走 docToText（hardBreak → `\n`），marks 偏移也把它算作 1 个字符。
function getEditor(w: VueWrapper) {
  const vm = w.vm as any
  return vm.getEditor?.() ?? vm.$.exposed?.getEditor?.()
}

function getExposed(w: VueWrapper) {
  return (w.vm as any).$?.exposed ?? (w.vm as any)
}

describe('Editor 段内硬换行（Shift-Enter）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('内容里的 `\\n` 解析成 hardBreak，读回仍是 `\\n`', async () => {
    const content = '第一行\n第二行'
    const w = mount(Editor, { props: { blockId: 'b1', content, showFullPlaceholder: true } })
    await flushPromises()
    const editor = getEditor(w)
    let breaks = 0
    editor.state.doc.descendants((node: any) => {
      if (node.type.name === 'hardBreak') breaks += 1
    })
    expect(breaks).toBe(1)
    expect(getExposed(w).getText()).toBe(content)
    w.unmount()
  })

  it('blur 保存的正文带换行符（数据丢失路径）', async () => {
    const content = '第一行\n第二行'
    const w = mount(Editor, { props: { blockId: 'b1', content, showFullPlaceholder: true } })
    await flushPromises()
    getEditor(w)?.view.dom.dispatchEvent(new FocusEvent('blur'))
    await flushPromises()
    expect(w.emitted('save')?.at(-1)?.[0]).toBe(content)
    w.unmount()
  })

  it('编辑器里新打出的硬换行进入保存载荷', async () => {
    const w = mount(Editor, { props: { blockId: 'b1', content: '甲', showFullPlaceholder: true } })
    await flushPromises()
    const editor = getEditor(w)
    // 光标落在「甲」之后（文档位置 2），插入硬换行再补字
    editor.chain().setTextSelection(2).setHardBreak().run()
    editor.chain().insertContent('乙').run()
    await flushPromises()
    expect(getExposed(w).getText()).toBe('甲\n乙')
    editor.view.dom.dispatchEvent(new FocusEvent('blur'))
    await flushPromises()
    expect(w.emitted('save')?.at(-1)?.[0]).toBe('甲\n乙')
    w.unmount()
  })

  it('硬换行之后的行内格式偏移把换行算作 1 个字符', async () => {
    const content = 'ab\ncd'
    const w = mount(Editor, { props: { blockId: 'b1', content, showFullPlaceholder: true } })
    await flushPromises()
    const editor = getEditor(w)
    // 位置：1=a 2=b 3=hardBreak 4=c 5=d —— 选中「cd」加粗
    editor.chain().setTextSelection({ from: 4, to: 6 }).toggleBold().run()
    await flushPromises()
    const payload = getExposed(w).getContent()
    expect(payload.text).toBe('ab\ncd')
    expect(payload.marks).toEqual([{ start: 3, end: 5, bold: true }])
    w.unmount()
  })
})
