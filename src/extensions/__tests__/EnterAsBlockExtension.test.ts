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
  atFirstLine?: boolean
  atLastLine?: boolean
  caretX?: number
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

  const endOfTextblock = (dir: 'up' | 'down' | 'left' | 'right') => {
    if (dir === 'up') return opts.atFirstLine ?? false
    if (dir === 'down') return opts.atLastLine ?? false
    return false
  }
  const coordsAtPos = () => ({ left: opts.caretX ?? 0, top: 0, bottom: 12, right: 10 })

  const editor: any = {
    view: { dom, endOfTextblock, coordsAtPos },
    getText: () => text,
    state: {
      selection: {
        from,
        to,
        head: from,
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

  it('ArrowUp 在首行 → enter-as-block { moveUp, x }（携带 caret 水平坐标）', () => {
    const { editor, log } = makeEditor({ parentOffset: 3, atFirstLine: true, caretX: 42 })
    shortcuts['ArrowUp']({ editor })
    expect(log).toEqual([{ name: 'enter-as-block', detail: { type: 'moveUp', x: 42 } }])
  })

  it('ArrowUp 不在首行（中间行）→ 不 dispatch，交原生换行', () => {
    const { editor, log } = makeEditor({ parentOffset: 3, atFirstLine: false, caretX: 42 })
    const ret = shortcuts['ArrowUp']({ editor })
    expect(ret).toBe(false)
    expect(log).toEqual([])
  })

  it('ArrowDown 在末行 → enter-as-block { moveDown, x }', () => {
    const { editor, log } = makeEditor({ text: 'abcde', parentOffset: 5, parentSize: 5, atLastLine: true, caretX: 64 })
    shortcuts['ArrowDown']({ editor })
    expect(log).toEqual([{ name: 'enter-as-block', detail: { type: 'moveDown', x: 64 } }])
  })

  it('ArrowDown 不在末行（中间行）→ 不 dispatch', () => {
    const { editor, log } = makeEditor({ text: 'abcde', parentOffset: 2, parentSize: 5, atLastLine: false, caretX: 64 })
    const ret = shortcuts['ArrowDown']({ editor })
    expect(ret).toBe(false)
    expect(log).toEqual([])
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
