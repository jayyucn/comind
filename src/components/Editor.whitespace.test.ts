import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import Editor from './Editor.vue'

vi.mock('../composables/useNavigateToPage', () => ({
  useNavigateToPage: vi.fn(() => ({ navigateToPage: vi.fn() }))
}))

// 回归：内容往返丢行尾空格（bug：'@2026-09-08 📅 ' 进编辑器一次 → blur 保存后尾随空格永久消失）。
// 根因：ProseMirror 默认折叠空白，textToHtml → HTML 解析丢段内行尾空格；
// 修复：Editor.vue 所有解析入口开启 parseOptions.preserveWhitespace（useEditor 初载 + 两处 setContent）。
function getEditor(w: VueWrapper) {
  const vm = w.vm as any
  return vm.getEditor?.() ?? vm.$.exposed?.getEditor?.()
}

describe('Editor content whitespace round-trip', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('keeps trailing space after date-ref on initial mount parse', async () => {
    const content = 'only @2026-09-08 📅 '
    const w = mount(Editor, { props: { blockId: 'b1', content, showFullPlaceholder: true } })
    await flushPromises()
    expect(getEditor(w)?.getText()).toBe(content)
    w.unmount()
  })

  it('keeps trailing space when content is pushed externally via props watch', async () => {
    const w = mount(Editor, { props: { blockId: 'b1', content: 'x', showFullPlaceholder: true } })
    await flushPromises()
    const newContent = 'only @2026-09-08 📅 '
    await w.setProps({ content: newContent })
    await flushPromises()
    await nextTick()
    expect(getEditor(w)?.getText()).toBe(newContent)
    w.unmount()
  })

  it('emits save payload with trailing space intact on blur (data-loss path)', async () => {
    const content = 'only @2026-09-08 📅 '
    const w = mount(Editor, { props: { blockId: 'b1', content, showFullPlaceholder: true } })
    await flushPromises()
    const editor = getEditor(w)
    editor?.view.dom.dispatchEvent(new FocusEvent('blur'))
    await flushPromises()
    const saved = w.emitted('save')
    expect(saved).toBeTruthy()
    expect(saved?.at(-1)?.[0]).toBe(content)
    w.unmount()
  })

  it('keeps internal consecutive spaces (full-preserve semantics)', async () => {
    const content = 'a  b @2026-09-08 📅 '
    const w = mount(Editor, { props: { blockId: 'b1', content, showFullPlaceholder: true } })
    await flushPromises()
    expect(getEditor(w)?.getText()).toBe(content)
    w.unmount()
  })

  it('does not alter content without trailing whitespace', async () => {
    const content = 'plain text with @2026-09-08 📅'
    const w = mount(Editor, { props: { blockId: 'b1', content, showFullPlaceholder: true } })
    await flushPromises()
    expect(getEditor(w)?.getText()).toBe(content)
    w.unmount()
  })
})
