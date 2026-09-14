/**
 * resolveUndoChord 单测（ADR-0046 T4 / #109）。
 * 三键裁决是统一栈接管键盘的唯一入口：语义错一处，块内文字就会退回「无反应」或误重做。
 */
import { describe, it, expect } from 'vitest'
import { resolveUndoChord } from './undo-chord'

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
