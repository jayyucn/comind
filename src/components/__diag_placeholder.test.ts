import { describe, test, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import Editor from './Editor.vue'

vi.mock('../composables/useNavigateToPage', () => ({
  useNavigateToPage: vi.fn(() => ({ navigateToPage: vi.fn() }))
}))

describe('DIAG: editor-placeholder', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test('A. showFullPlaceholder=true + content="" -> placeholder shows', async () => {
    const w = mount(Editor, { props: { blockId: 'b1', content: '', showFullPlaceholder: true } })
    await flushPromises()
    await nextTick()
    console.log('[A] HTML =', w.html())
    expect(w.find('.editor-placeholder').exists()).toBe(true)
    w.unmount()
  })

  test('B. prop flips false->true after mount', async () => {
    const w = mount(Editor, { props: { blockId: 'b1', content: '', showFullPlaceholder: false } })
    await flushPromises()
    expect(w.find('.editor-placeholder').exists()).toBe(false)
    await w.setProps({ showFullPlaceholder: true })
    await nextTick()
    console.log('[B] HTML =', w.html())
    expect(w.find('.editor-placeholder').exists()).toBe(true)
    w.unmount()
  })

  test('C. content non-empty -> "" via prop watch (hasContent staleness)', async () => {
    const w = mount(Editor, { props: { blockId: 'b1', content: 'hello', showFullPlaceholder: true } })
    await flushPromises()
    expect(w.find('.editor-placeholder').exists()).toBe(false)
    await w.setProps({ content: '' })
    await flushPromises()
    await nextTick()
    console.log('[C] HTML =', w.html())
    console.log('[C] placeholder exists =', w.find('.editor-placeholder').exists())
    w.unmount()
  })

  test('D. mount with content="" then user types then clears (onUpdate path)', async () => {
    const w = mount(Editor, { props: { blockId: 'b1', content: '', showFullPlaceholder: true } })
    await flushPromises()
    const editor = (w.vm as any).getEditor?.() ?? (w.vm as any).$.exposed?.getEditor?.()
    console.log('[D] editor?', !!editor)
    if (editor) {
      editor.commands.setContent('<p>abc</p>')
      editor.commands.insertContent('x')
      await nextTick()
      console.log('[D] after type, placeholder =', w.find('.editor-placeholder').exists())
      editor.commands.clearContent(true)
      editor.commands.insertContent('')
      await nextTick()
      console.log('[D] after clear, getText=', JSON.stringify(editor.getText()), 'placeholder =', w.find('.editor-placeholder').exists())
    }
    w.unmount()
  })
})
