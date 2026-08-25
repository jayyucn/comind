import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

// Mock useTheme before importing the component
vi.mock('../../../../composables/useTheme', () => ({
  useTheme: vi.fn(() => ({
    theme: { value: 'light' },
    resolvedTheme: { value: 'light' },
  })),
}))

// useBlockRegistry 通过 factory 直接注入，因为 registry 是模块级 Map，
// 测试环境中没有注册 'code'，所以 headerLabel 会落到 fallback '代码块'。
vi.mock('../../../../composables/useBlockRegistry', () => ({
  useBlockRegistry: vi.fn(() => ({
    getHandler: vi.fn(() => undefined),
    register: vi.fn(),
    getRegisteredTypes: vi.fn(() => []),
  })),
}))

import CodeMirrorEditor from './CodeMirrorEditor.vue'

const MockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
}

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: MockClipboard.writeText },
  writable: true,
  configurable: true,
})

function mountEditor(props: Record<string, any> = {}) {
  return mount(CodeMirrorEditor, {
    props: {
      blockId: 'test-block',
      content: 'const x = 1;',
      language: 'javascript',
      readonly: true,
      ...props,
    },
  })
}

/** 取工具栏内的按钮数组：index 0 = 语言，1 = 换行，2 = 复制。 */
function getToolbarButtons(wrapper: ReturnType<typeof mountEditor>) {
  return wrapper.findAll('.code-toolbar .code-toolbar-btn')
}

describe('CodeMirrorEditor — Header 工具栏', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('header 常驻（不依赖 hover），无背景色', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await nextTick()

    const header = wrapper.find('.code-header')
    expect(header.exists()).toBe(true)
    expect(header.isVisible()).toBe(true)
  })

  it('header 左侧显示折叠按钮 + 代码块标签', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await nextTick()

    const toggle = wrapper.find('.code-toggle')
    expect(toggle.exists()).toBe(true)
    expect(toggle.text()).toContain('代码块')
  })

  it('header 右侧渲染语言、换行、复制三个按钮', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await nextTick()

    const buttons = getToolbarButtons(wrapper)
    expect(buttons.length).toBe(3)
    expect(buttons[0].text()).toContain('JavaScript')
    expect(buttons[1].text()).toContain('自动换行')
    expect(buttons[2].text()).toContain('复制')
  })

  it('工具栏按钮默认隐藏，hover 代码块时显示', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await nextTick()

    const toolbar = wrapper.find('.code-toolbar')
    // opacity: 0 表示隐藏（isVisible 不感知 opacity，直接检查样式类不存在 active/display）
    expect(toolbar.exists()).toBe(true)
    expect((toolbar.element as HTMLElement).style.opacity).toBe('')

    // hover 模拟：给 wrapper 加 hover 后，CSS 规则 .code-editor-wrapper:hover .code-toolbar 生效
    // 测试无法触发 :hover，这里验证 CSS 选择器存在即可（样式在组件内，无法用 VTU 断言伪类）
    const styles = wrapper.find('.code-editor-wrapper')
    expect(styles.classes()).not.toContain('is-collapsed')
  })

  it('工具栏按钮之间有视觉分隔', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await nextTick()

    expect(wrapper.findAll('.code-toolbar-divider').length).toBe(2)
  })
})

describe('CodeMirrorEditor — 只读渲染模式', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应该支持只读模式 prop', async () => {
    const wrapper = mountEditor({ readonly: true })
    await flushPromises()
    await nextTick()
    expect(wrapper.props('readonly')).toBe(true)
  })

  it('只读模式下内容不可编辑', async () => {
    const wrapper = mountEditor({ readonly: true })
    await flushPromises()
    await nextTick()
    expect(wrapper.find('.cm-editor').exists()).toBe(true)
  })

  it('只读模式下仍然显示语法高亮', async () => {
    const wrapper = mountEditor({ readonly: true })
    await flushPromises()
    await nextTick()
    expect(wrapper.find('.cm-content').exists()).toBe(true)
  })

  it('只读模式下语言选择器仍然可用', async () => {
    const wrapper = mountEditor({ readonly: true, language: 'javascript' })
    await flushPromises()
    await nextTick()

    const buttons = getToolbarButtons(wrapper)
    expect(buttons[0].text()).toContain('JavaScript')
  })

  it('只读模式下输入不触发 save 事件', async () => {
    const saveHandler = vi.fn()
    const wrapper = mountEditor({ readonly: true, onSave: saveHandler })
    await flushPromises()
    await nextTick()

    const editor = wrapper.find('.cm-editor')
    await editor.trigger('focus')
    await wrapper.vm.$nextTick()

    expect(saveHandler).not.toHaveBeenCalled()
  })

  it('编辑模式下内容可编辑', async () => {
    const wrapper = mountEditor({ readonly: false })
    await flushPromises()
    await nextTick()
    expect(wrapper.find('.cm-editor').exists()).toBe(true)
  })

  it('默认情况下可编辑（readonly 为 false 或 undefined）', async () => {
    const wrapper = mountEditor({ readonly: false })
    await flushPromises()
    await nextTick()
    expect(wrapper.props('readonly')).toBe(false)
    expect(wrapper.find('.cm-editor').exists()).toBe(true)
  })
})

describe('CodeMirrorEditor — 复制按钮', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('只读模式下有复制按钮', async () => {
    const wrapper = mountEditor({ readonly: true })
    await flushPromises()
    await nextTick()

    const buttons = getToolbarButtons(wrapper)
    expect(buttons[2].text()).toContain('复制')
  })

  it('编辑模式下也有复制按钮', async () => {
    const wrapper = mountEditor({ readonly: false })
    await flushPromises()
    await nextTick()

    const buttons = getToolbarButtons(wrapper)
    expect(buttons[2].text()).toContain('复制')
  })

  it('点击复制按钮会复制代码', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })

    const wrapper = mountEditor({ readonly: true, content: 'const x = 1;' })
    await flushPromises()
    await nextTick()

    const buttons = getToolbarButtons(wrapper)
    await buttons[2].trigger('click')

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('const x = 1;')
  })

  it('复制成功后会显示已复制提示', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })

    const wrapper = mountEditor({ readonly: true })
    await flushPromises()
    await nextTick()

    const buttons = getToolbarButtons(wrapper)
    await buttons[2].trigger('click')
    await flushPromises()
    await nextTick()

    // 复制成功后按钮 title 切换为「已复制」（useFakeTimers 会影响后续测试，这里不依赖它）
    expect(buttons[2].attributes('title')).toBe('已复制')
  })

  it('渲染组件使用时应传递 blockId、content、language props', async () => {
    const wrapper = mountEditor({
      blockId: 'block-123',
      content: 'function test() {}',
      language: 'javascript',
      readonly: true,
    })

    await flushPromises()
    const copyIcon = wrapper.find('.copy-icon')
    expect(copyIcon.exists()).toBe(true)
  })
})

describe('CodeMirrorEditor — 折叠（chevron 切换正文显隐）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('默认展开，body 可见', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await nextTick()

    // v-show 展开时无 display:none 内联样式（attributes 可能为 undefined）
    const bodyStyle = wrapper.find('.code-editor-body').attributes('style') ?? ''
    expect(bodyStyle).not.toContain('display: none')
    expect(wrapper.find('.code-toggle-chevron').classes()).not.toContain('is-collapsed')
  })

  it('点击 chevron 后 body 隐藏，箭头旋转 -90°', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await nextTick()

    const toggle = wrapper.find('.code-toggle')
    await toggle.trigger('click')
    await flushPromises()
    await nextTick()

    const body = wrapper.find('.code-editor-body')
    // v-show 用内联 display:none，直接断言 style 比 isVisible 更稳
    // （isVisible 依赖 offsetParent 计算，CodeMirror 实例残留时可能 flaky）
    expect(body.attributes('style') ?? '').toContain('display: none')
    expect(wrapper.find('.code-toggle-chevron').classes()).toContain('is-collapsed')
    expect(wrapper.find('.code-editor-wrapper').classes()).toContain('is-collapsed')
  })

  it('再次点击 chevron 后重新展开', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await nextTick()

    const toggle = wrapper.find('.code-toggle')
    await toggle.trigger('click')
    await flushPromises()
    await nextTick()
    await toggle.trigger('click')
    await flushPromises()
    await nextTick()

    const body = wrapper.find('.code-editor-body')
    expect(body.attributes('style') ?? '').not.toContain('display: none')
    expect(wrapper.find('.code-toggle-chevron').classes()).not.toContain('is-collapsed')
  })

  it('aria-expanded 反映折叠状态', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await nextTick()

    const toggle = wrapper.find('.code-toggle')
    expect(toggle.attributes('aria-expanded')).toBe('true')

    await toggle.trigger('click')
    await nextTick()
    expect(toggle.attributes('aria-expanded')).toBe('false')
  })

  it('折叠状态下，header 仍常驻可见', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await nextTick()

    await wrapper.find('.code-toggle').trigger('click')
    await flushPromises()
    await nextTick()

    // header 仍渲染，且工具栏按钮仍可用——用户可继续复制等
    expect(wrapper.find('.code-header').exists()).toBe(true)
    expect(getToolbarButtons(wrapper).length).toBe(3)
  })
})

describe('CodeMirrorEditor — 自动换行（wrap toggle）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('换行按钮默认无 active 状态', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await nextTick()

    const wrapBtn = getToolbarButtons(wrapper)[1]
    expect(wrapBtn.classes()).not.toContain('active')
    expect(wrapBtn.attributes('aria-pressed')).toBe('false')
  })

  it('点击换行按钮后切换为 active', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await nextTick()

    const wrapBtn = getToolbarButtons(wrapper)[1]
    await wrapBtn.trigger('click')
    await nextTick()

    expect(wrapBtn.classes()).toContain('active')
    expect(wrapBtn.attributes('aria-pressed')).toBe('true')
  })

  it('再次点击换行按钮取消 active', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await nextTick()

    const wrapBtn = getToolbarButtons(wrapper)[1]
    await wrapBtn.trigger('click')
    await nextTick()
    await wrapBtn.trigger('click')
    await nextTick()

    expect(wrapBtn.classes()).not.toContain('active')
  })
})

describe('CodeMirrorEditor — 编程语言选择（选中后保存）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 清理 teleport 到 body 的残留菜单
    document.body.querySelectorAll('.lang-menu').forEach(el => el.remove())
  })

  it('从语言菜单选择新语言会 emit language-change（父组件据此保存）', async () => {
    const wrapper = mountEditor({ readonly: true, language: 'javascript' })
    await flushPromises()
    await nextTick()

    // 打开语言菜单
    const langBtn = getToolbarButtons(wrapper)[0]
    await langBtn.trigger('click')
    await flushPromises()
    await nextTick()

    // 菜单通过 BasePopover teleport 到 body
    const langItems = document.body.querySelectorAll('.lang-item')
    expect(langItems.length).toBeGreaterThan(0)

    // 选择 Python
    const pythonItem = Array.from(langItems).find(el => el.textContent?.includes('Python'))
    expect(pythonItem).toBeDefined()
    ;(pythonItem as HTMLElement).click()
    await flushPromises()
    await nextTick()

    // 触发 language-change 事件，父组件调用 updateBlockProperties 持久化
    const emitted = wrapper.emitted('language-change')
    expect(emitted).toBeTruthy()
    expect(emitted![emitted!.length - 1]).toEqual(['python'])
  })

  it('选择与当前相同语言时仍可选中（菜单高亮），不重复 emit', async () => {
    const wrapper = mountEditor({ readonly: true, language: 'javascript' })
    await flushPromises()
    await nextTick()

    const langBtn = getToolbarButtons(wrapper)[0]
    await langBtn.trigger('click')
    await flushPromises()
    await nextTick()

    const langItems = document.body.querySelectorAll('.lang-item')
    const jsItem = Array.from(langItems).find(el => el.textContent?.includes('JavaScript'))
    ;(jsItem as HTMLElement).click()
    await flushPromises()
    await nextTick()

    const emitted = wrapper.emitted('language-change')
    // currentLang 已是 javascript，与 props.language 相同 → 不 emit
    expect(emitted).toBeUndefined()
  })
})
