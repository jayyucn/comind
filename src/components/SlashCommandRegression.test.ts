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

/**
 * script setup 的内部状态：测试态下经 wrapper.vm 读取（用 unknown 过渡，避免 any）。
 */
type MenuVm = { query: string; visible: boolean }

/**
 * 造一个极简编辑器替身：doc 用纯文本建模（textBetween = 切片），
 * 与 ProseMirror 的语义一致——位置就是字符下标，所以 range/cursor 组合都可验。
 */
function makeEditor(text: string, cursor: number) {
  return {
    state: {
      selection: { from: cursor },
      doc: {
        textBetween: (from: number, to: number) => text.slice(from, to)
      }
    },
    view: { dom: document.createElement('div') },
    chain: vi.fn().mockReturnThis(),
    deleteRange: vi.fn().mockReturnThis(),
    insertContent: vi.fn().mockReturnThis(),
    setTextSelection: vi.fn().mockReturnThis(),
    focus: vi.fn().mockReturnThis(),
    run: vi.fn(),
    on: vi.fn(),
    off: vi.fn()
  }
}

async function openMenu(editor: ReturnType<typeof makeEditor>, range: { from: number; to: number }) {
  const wrapper = mount(SlashCommandMenu, {
    global: {
      stubs: { Teleport: { template: '<div><slot /></div>' } }
    }
  })
  const editorStore = useEditorStore()
  editorStore.activeEditor = editor
  editorStore.activeBlockId = 'block-1'

  document.dispatchEvent(new CustomEvent('slash-command-trigger', {
    detail: {
      view: { coordsAtPos: () => ({ left: 0, bottom: 0 }) },
      position: range.from,
      range
    }
  }))
  await flushPromises()
  await nextTick()
  return wrapper
}

function pressEnter(composing = false) {
  const event = new KeyboardEvent('keydown', { key: 'Enter' })
  if (composing) {
    Object.defineProperty(event, 'isComposing', { value: true })
  }
  document.dispatchEvent(event)
}

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
    const editor = makeEditor('/image', 6)
    const wrapper = await openMenu(editor, { from: 0, to: 1 })
    const vm = wrapper.vm as unknown as MenuVm

    // 复现回归前置条件：编辑器 'update' 监听未把 query 同步为 'image'
    // （模拟 activeEditor 晚于菜单打开就绪，监听器从未绑定）
    expect(vm.query).toBe('')

    // 回车
    pressEnter()
    await flushPromises()
    await nextTick()

    // 决定性判定：image 路径会调用 openImageFileDialog；time 路径不会。
    expect(openImageFileDialog).toHaveBeenCalled()
    // time 命令会 insertContent('HH:MM')；image 命令不应调用 insertContent
    expect(editor.insertContent).not.toHaveBeenCalled()
    // 修复后应解析到 image：deleteRange 被调用（移除 /image 文本）
    expect(editor.deleteRange).toHaveBeenCalled()
  })

  it('IME 组合期回车不执行任何命令（不插入当前时间）', async () => {
    // 中文输入法下输入命令字母：文档里只有已提交的 '/'，'img' 仍在组合缓冲区，
    // 光标停在 '/' 之后 → query 解析为空。组合期回车是「确认候选词」，不能执行命令。
    const editor = makeEditor('/img', 1)
    const wrapper = await openMenu(editor, { from: 0, to: 1 })

    pressEnter(true)
    await flushPromises()
    await nextTick()

    expect(editor.insertContent).not.toHaveBeenCalled()
    expect(editor.deleteRange).not.toHaveBeenCalled()
    expect(openImageFileDialog).not.toHaveBeenCalled()
    // 面板保持打开，等组合结束后继续正常使用
    expect((wrapper.vm as unknown as MenuVm).visible).toBe(true)
  })

  it('IME 组合结束后同步 query，回车命中 image 而非 time', async () => {
    const editor = makeEditor('/', 1)
    const wrapper = await openMenu(editor, { from: 0, to: 1 })

    // 组合提交：文本进入文档、光标移到末尾，DOM 派发 compositionend
    editor.state.selection.from = 4
    editor.state.doc.textBetween = (from: number, to: number) => '/img'.slice(from, to)
    editor.view.dom.dispatchEvent(new Event('compositionend'))
    await nextTick()

    // 组合结束即完成过滤（不等回车补同步），否则列表仍是全量、首项 /time 高亮
    expect((wrapper.vm as unknown as MenuVm).query).toBe('img')

    pressEnter()
    await flushPromises()
    await nextTick()

    expect(openImageFileDialog).toHaveBeenCalled()
    expect(editor.insertContent).not.toHaveBeenCalled()
  })

  it('range 失效（命令文本已不是 / 开头）时回车只关面板，不执行首项 /time', async () => {
    // range 停在上一次触发的位置（指向 'i'），文档已变 → 无法确认命令文本
    const editor = makeEditor('/image', 6)
    const wrapper = await openMenu(editor, { from: 1, to: 2 })

    pressEnter()
    await flushPromises()
    await nextTick()

    expect(editor.insertContent).not.toHaveBeenCalled()
    expect(editor.deleteRange).not.toHaveBeenCalled()
    expect(openImageFileDialog).not.toHaveBeenCalled()
    expect((wrapper.vm as unknown as MenuVm).visible).toBe(false)
  })
})
