import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hasModalOpen } from '../../composables/useModalKeyboard'
import EnterAsBlockExtension from '../EnterAsBlockExtension'

// 派发侧测试：验证各键盘快捷键在 view.dom 上 dispatch 正确的 enter-as-block CustomEvent。
// 不挂真 TipTap，用轻量 fake editor 捕获 dispatch。
vi.mock('../../composables/useModalKeyboard', () => ({
  hasModalOpen: vi.fn(() => false),
}))

interface LogEntry {
  name: string
  detail: any
}

function makeEditor(opts: {
  text?: string
  parentOffset?: number
  parentSize?: number
  from?: number
  to?: number
} = {}) {
  const dom = document.createElement('div')
  const log: LogEntry[] = []
  dom.addEventListener('enter-as-block', (e) => log.push({ name: 'enter-as-block', detail: (e as CustomEvent).detail }))
  dom.addEventListener('delete-between-property', (e) => {
    log.push({ name: 'delete-between-property', detail: (e as CustomEvent).detail })
    // 默认不 preventDefault：模拟「无属性可删」，backspace 继续走 merge/delete
  })

  const text = opts.text ?? ''
  const parentOffset = opts.parentOffset ?? 0
  const parentSize = opts.parentSize ?? text.length
  const from = opts.from ?? 0
  const to = opts.to ?? text.length

  const runMock = vi.fn()
  const chainObj = {
    setContent: vi.fn(() => chainObj),
    focus: vi.fn(() => chainObj),
    run: runMock,
  }

  const editor: any = {
    view: { dom },
    getText: () => text,
    state: {
      selection: {
        from,
        to,
        $from: { parentOffset, parent: { content: { size: parentSize } } },
      },
    },
    commands: { setHardBreak: vi.fn(() => true) },
    chain: vi.fn(() => chainObj),
  }

  return { editor, dom, log, runMock }
}

const shortcuts = EnterAsBlockExtension.config.addKeyboardShortcuts()

describe('EnterAsBlockExtension — 派发侧', () => {
  beforeEach(() => {
    vi.mocked(hasModalOpen).mockReturnValue(false)
  })

  it('Enter → enter-as-block { type: split, pos }', () => {
    const { editor, log } = makeEditor({ text: 'hello', from: 2 })
    shortcuts['Enter']({ editor })
    expect(log).toEqual([{ name: 'enter-as-block', detail: { type: 'split', pos: 2 } }])
  })

  it('Shift-Enter → setHardBreak（不 dispatch enter-as-block）', () => {
    const { editor, log } = makeEditor()
    const ret = shortcuts['Shift-Enter']({ editor })
    expect(ret).toBe(true)
    expect(log).toEqual([])
  })

  it('Backspace 内容为空且在行首 → delete-between-property + enter-as-block { delete }', () => {
    const { editor, log } = makeEditor({ text: '', parentOffset: 0, from: 0, to: 0 })
    shortcuts['Backspace']({ editor })
    expect(log).toEqual([
      { name: 'delete-between-property', detail: {} },
      { name: 'enter-as-block', detail: { type: 'delete' } },
    ])
  })

  it('Backspace 内容非空且在行首 → delete-between-property + enter-as-block { merge }', () => {
    const { editor, log } = makeEditor({ text: 'abc', parentOffset: 0, from: 0, to: 0 })
    shortcuts['Backspace']({ editor })
    expect(log).toEqual([
      { name: 'delete-between-property', detail: {} },
      { name: 'enter-as-block', detail: { type: 'merge' } },
    ])
  })

  it('Tab → enter-as-block { indent }', () => {
    const { editor, log } = makeEditor()
    shortcuts['Tab']({ editor })
    expect(log).toEqual([{ name: 'enter-as-block', detail: { type: 'indent' } }])
  })

  it('Shift-Tab → enter-as-block { outdent }', () => {
    const { editor, log } = makeEditor()
    shortcuts['Shift-Tab']({ editor })
    expect(log).toEqual([{ name: 'enter-as-block', detail: { type: 'outdent' } }])
  })

  it('ArrowUp 在行首 → enter-as-block { moveUp }', () => {
    const { editor, log } = makeEditor({ parentOffset: 0 })
    shortcuts['ArrowUp']({ editor })
    expect(log).toEqual([{ name: 'enter-as-block', detail: { type: 'moveUp' } }])
  })

  it('ArrowUp 不在行首 → 不 dispatch', () => {
    const { editor, log } = makeEditor({ parentOffset: 3 })
    const ret = shortcuts['ArrowUp']({ editor })
    expect(ret).toBe(false)
    expect(log).toEqual([])
  })

  it('ArrowDown 在行尾 → enter-as-block { moveDown }', () => {
    const { editor, log } = makeEditor({ text: 'abcde', parentOffset: 5, parentSize: 5 })
    shortcuts['ArrowDown']({ editor })
    expect(log).toEqual([{ name: 'enter-as-block', detail: { type: 'moveDown' } }])
  })

  it('Escape → enter-as-block { exitEdit }', () => {
    const { editor, log } = makeEditor()
    shortcuts['Escape']({ editor })
    expect(log).toEqual([{ name: 'enter-as-block', detail: { type: 'exitEdit' } }])
  })

  it('Mod-s → enter-as-block { save }（不受模态层影响）', () => {
    vi.mocked(hasModalOpen).mockReturnValue(true)
    const { editor, log } = makeEditor()
    shortcuts['Mod-s']({ editor })
    expect(log).toEqual([{ name: 'enter-as-block', detail: { type: 'save' } }])
  })

  it('Mod-1..6 → 调 applyHeading（chain.setContent.focus.run），不 dispatch enter-as-block', () => {
    const { editor, log, runMock } = makeEditor({ text: 'hello' })
    for (const key of ['Mod-1', 'Mod-2', 'Mod-3', 'Mod-4', 'Mod-5', 'Mod-6']) {
      const ret = shortcuts[key]({ editor })
      expect(ret).toBe(true)
    }
    expect(runMock).toHaveBeenCalledTimes(6)
    expect(log).toEqual([])
  })

  it('模态打开时 Enter 直接返回 false、不 dispatch', () => {
    vi.mocked(hasModalOpen).mockReturnValue(true)
    const { editor, log } = makeEditor()
    const ret = shortcuts['Enter']({ editor })
    expect(ret).toBe(false)
    expect(log).toEqual([])
  })
})
