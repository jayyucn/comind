/**
 * resolveUndoChord 单测（ADR-0046 T4 / #109）。
 * 三键裁决是统一栈接管键盘的唯一入口：语义错一处，块内文字就会退回「无反应」或误重做。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { resolveUndoChord, takeOverUndoRedo } from './undo-chord'
import { ensureStack, resetUndoHistory } from '../composables/useUndoHistory'

/** 只喂裁决真正读的字段，避免为造 KeyboardEvent 引入 jsdom 噪音 */
function chord(key: string, mods: Partial<Record<'ctrl' | 'meta' | 'shift' | 'alt', boolean>> = {}) {
  return {
    key,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
  }
}

describe('撤销键位裁决', () => {
  it('Ctrl+Z / Cmd+Z → undo', () => {
    expect(resolveUndoChord(chord('z', { ctrl: true }))).toBe('undo')
    expect(resolveUndoChord(chord('z', { meta: true }))).toBe('undo')
    // 大写 'Z'（真实键盘按住 Shift 时的 key）也走 undo —— 裁决只认 Ctrl 有无
    expect(resolveUndoChord(chord('Z', { ctrl: true }))).toBe('undo')
  })

  it('Ctrl+Shift+Z / Cmd+Shift+Z → redo', () => {
    expect(resolveUndoChord(chord('Z', { ctrl: true, shift: true }))).toBe('redo')
    expect(resolveUndoChord(chord('z', { meta: true, shift: true }))).toBe('redo')
  })

  it('Ctrl+Y（含带 Shift）→ redo —— 兼容 Windows 习惯', () => {
    expect(resolveUndoChord(chord('y', { ctrl: true }))).toBe('redo')
    expect(resolveUndoChord(chord('Y', { ctrl: true, shift: true }))).toBe('redo')
  })

  it('无修饰键 / 仅 Shift 的 z、y 不接管（正常输入）', () => {
    expect(resolveUndoChord(chord('z'))).toBeNull()
    expect(resolveUndoChord(chord('y', { shift: true }))).toBeNull()
  })

  it('带 Alt 的组合不接管（Ctrl+Alt+Z 是其它语义，如输入法/系统级）', () => {
    expect(resolveUndoChord(chord('z', { ctrl: true, alt: true }))).toBeNull()
    expect(resolveUndoChord(chord('z', { ctrl: true, shift: true, alt: true }))).toBeNull()
  })

  it('其它 Ctrl 组合不误命中', () => {
    expect(resolveUndoChord(chord('a', { ctrl: true }))).toBeNull()
    expect(resolveUndoChord(chord('c', { ctrl: true }))).toBeNull()
    expect(resolveUndoChord(chord('x', { ctrl: true }))).toBeNull()
    expect(resolveUndoChord(chord('v', { ctrl: true, shift: true }))).toBeNull()
  })
})

/**
 * takeOverUndoRedo 接管门单测（#114）。
 * 四步相同链（chord → scope → hasStack 门 → preventDefault/stopPropagation）的唯一实现：
 * 语义错一处 = 双接管（同键跑两次 undo）或漏接管。只测外部行为 —— 返回值与两个
 * 事件方法是否被调，scope 解析器注入、不碰 DOM。
 */
describe('takeOverUndoRedo 接管门（#114）', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => resetUndoHistory())

  /** 最小事件形状：裁决读键位修饰键 + 接管动作写 preventDefault/stopPropagation */
  function keyEvent(
    key: string,
    mods: Partial<Record<'ctrl' | 'meta' | 'shift' | 'alt', boolean>> = {},
    overrides: Partial<{ defaultPrevented: boolean }> = {},
  ): KeyboardEvent {
    return {
      key,
      ctrlKey: !!mods.ctrl,
      metaKey: !!mods.meta,
      shiftKey: !!mods.shift,
      altKey: !!mods.alt,
      defaultPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      ...overrides,
    } as unknown as KeyboardEvent
  }

  const anyPage = () => 'p-takeover'

  it('chord + scope + 有栈 → 返回 {pageId, chord} 且 preventDefault/stopPropagation 各一次', () => {
    ensureStack('p-takeover')
    const e = keyEvent('z', { ctrl: true })
    expect(takeOverUndoRedo(e, anyPage)).toEqual({ pageId: 'p-takeover', chord: 'undo' })
    expect(e.preventDefault).toHaveBeenCalledTimes(1)
    expect(e.stopPropagation).toHaveBeenCalledTimes(1)
  })

  it('非 undo chord → null，不 preventDefault（按键交还原生行为）', () => {
    const e = keyEvent('c', { ctrl: true })
    expect(takeOverUndoRedo(e, anyPage)).toBeNull()
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(e.stopPropagation).not.toHaveBeenCalled()
  })

  it('scope 解析为 null（非块内焦点）→ null，不 preventDefault', () => {
    const e = keyEvent('z', { ctrl: true })
    expect(takeOverUndoRedo(e, () => null)).toBeNull()
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('无栈页 → null，不 preventDefault（D6 机制边界：从未整页加载不接管）', () => {
    const e = keyEvent('z', { ctrl: true })
    expect(takeOverUndoRedo(e, () => 'p-no-stack')).toBeNull()
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('不读 defaultPrevented —— 让位是调用方（App 兜底）的职责，接管门不越俎代庖', () => {
    ensureStack('p-takeover')
    const e = keyEvent('z', { ctrl: true }, { defaultPrevented: true })
    expect(takeOverUndoRedo(e, anyPage)).toEqual({ pageId: 'p-takeover', chord: 'undo' })
  })
})
