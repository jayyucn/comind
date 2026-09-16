/**
 * 撤销/重做「无可撤即 no-op」回归（#122 第 3 项）
 *
 * 症状：空历史（页面刚载入 / 已撤到底）下按 Ctrl+Z，旧的 runUndoOrRedo 先
 * `deactivateBlock()` 再判空 —— 结果什么也没撤，却把正在编辑的块踢出编辑态
 * （光标丢失）。要求：无可撤/可重做时**连激活态都不许动**。
 *
 * 夹具取最小面：真实 pinia + 真实 blockStore（wasm 走 jsdom 适配，与
 * BlockList.undo-redo.test.ts 同口径）+ 真实历史栈，不挂组件 —— 本票验的是
 * 编排层的守卫顺序，挂 BlockList 只会引入 jsdom 脆弱性而不增加信号。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { canRedo, canUndo, configureUndoHistory, ensureStack, resetUndoHistory } from './useUndoHistory'
import { runUndoOrRedo } from './useUndoRestore'

// jsdom 无 matchMedia；import 链中模块级求值可能调用（先例：TaskHub.test.ts）
vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

async function flushAsync() {
  await nextTick()
  await new Promise(r => setTimeout(r, 0))
  await nextTick()
}

describe('runUndoOrRedo 空历史守卫（#122）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetUndoHistory()
    configureUndoHistory({ idleMs: 20 })
  })

  afterEach(() => {
    resetUndoHistory()
  })

  test('无可撤销历史：不改激活态，返回 null', async () => {
    const store = useBlockStore()
    const editor = useEditorStore()
    const pageId = 'page-undo-noop-undo'
    const a = await store.createBlock({ pageId, content: 'hello' })
    ensureStack(pageId)
    expect(canUndo(pageId)).toBe(false)

    editor.activateBlock(a.id, 3)
    const res = await runUndoOrRedo(pageId, 'undo')

    expect(res).toBeNull()
    expect(editor.activeBlockId).toBe(a.id)
  })

  test('无可重做历史：同样不改激活态（对照组，钉住 chord 两侧的守卫）', async () => {
    const store = useBlockStore()
    const editor = useEditorStore()
    const pageId = 'page-undo-noop-redo'
    const a = await store.createBlock({ pageId, content: 'hello' })
    ensureStack(pageId)
    expect(canRedo(pageId)).toBe(false)

    editor.activateBlock(a.id, 3)
    const res = await runUndoOrRedo(pageId, 'redo')

    expect(res).toBeNull()
    expect(editor.activeBlockId).toBe(a.id)
  })

  test('有可撤销历史：照常退出编辑态并移动游标（对照组，证明守卫不是一律 no-op）', async () => {
    const store = useBlockStore()
    const editor = useEditorStore()
    const pageId = 'page-undo-noop-control'
    const a = await store.createBlock({ pageId, content: 'hello' })
    // 落库：createBlock/updateBlockContent 都是防抖保存，不 flush 则 wasm 侧查无此块
    await store.flushSave(a.id)
    ensureStack(pageId)

    await store.updateBlockContent(a.id, 'hello world')
    await store.flushSave(a.id)
    await flushAsync()
    editor.activateBlock(a.id)

    // 只断言编排层：有得撤 ⇒ 编辑态照旧退出（#109 既有语义，不得被守卫吃掉）、
    // 游标确实退到栈底。落库侧（restoreEntry 的 executeBatch 单事务）由
    // BlockList.undo-redo.test.ts 的集成网覆盖 —— 那里有真实 page 注册，本网没有。
    await runUndoOrRedo(pageId, 'undo')

    expect(editor.activeBlockId).toBeNull()
    expect(canUndo(pageId)).toBe(false)
  })
})
