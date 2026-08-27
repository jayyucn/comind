import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import SlashCommandMenu from './SlashCommandMenu.vue'
import { useEditorStore } from '../stores/editor'
import { openImageFileDialog } from '../utils/imagePicker'

// 关键：mock 图片选择器，避免真实文件对话框挂起
vi.mock('../utils/imagePicker', () => ({
  openImageFileDialog: vi.fn().mockResolvedValue(null)
}))

describe('regression: /image + Enter must run image, not time', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    })
  })

  it('executes image command (not time) when /image typed then Enter pressed', async () => {
    const wrapper = mount(SlashCommandMenu, {
      global: {
        stubs: { Teleport: { template: '<div><slot /></div>' } }
      }
    })
    const vm = wrapper.vm as any
    const editorStore = useEditorStore()

    // 模拟一个已经激活、文本为 "/image" 的编辑器
    const editor = {
      state: {
        selection: { from: 6 }, // 光标停在 /image 末尾
        doc: {
          textBetween: (from: number, to: number) => {
            // range.to = 1（'/' 之后），to = 6 → 应返回 "image"
            if (from === 1 && to === 6) return 'image'
            return ''
          }
        }
      },
      chain: vi.fn().mockReturnThis(),
      deleteRange: vi.fn().mockReturnThis(),
      insertContent: vi.fn().mockReturnThis(),
      setTextSelection: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    }
    editorStore.activeEditor = editor
    editorStore.activeBlockId = 'block-1'

    // 触发菜单：range = {from:0, to:1}（'/' 在位置 0）
    document.dispatchEvent(new CustomEvent('slash-command-trigger', {
      detail: {
        view: { coordsAtPos: () => ({ left: 0, bottom: 0 }) },
        position: 0,
        range: { from: 0, to: 1 }
      }
    }))
    await flushPromises()
    await nextTick()

    // 复现回归前置条件：编辑器 'update' 监听未把 query 同步为 'image'
    // （模拟 activeEditor 晚于菜单打开就绪，监听器从未绑定）
    expect(vm.query).toBe('')

    // 回车
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    await nextTick()

    // 决定性判定：image 路径会调用 openImageFileDialog；time 路径不会。
    expect(openImageFileDialog).toHaveBeenCalled()
    // time 命令会 insertContent('HH:MM')；image 命令不应调用 insertContent
    expect(editor.insertContent).not.toHaveBeenCalled()
    // 修复后应解析到 image：deleteRange 被调用（移除 /image 文本）
    expect(editor.deleteRange).toHaveBeenCalled()
  })
})
