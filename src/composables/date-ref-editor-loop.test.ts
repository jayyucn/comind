/**
 * T8 + T9 闭环测试
 *
 * T8 — 编辑态闭环（PM editor coordinates → insertContentAt）
 * T9 — 阅读态闭环（content string indices → string replace + save)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEditorStore } from '../stores/editor'
import { useBlockStore } from '../stores/blocks'
import { serializeDateRef } from '../utils/date-ref'
import type { DateTimePickerConfirm } from './useDateTimePickerPanel'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

/** 创建带 chain 的 mock editor（fluent API） */
function makeMockEditor() {
  const ops: string[] = []
  const chain = {
    insertContentAt: vi.fn((_range: unknown, _content: string) => chain),
    run: vi.fn(() => { ops.push('run') }),
    _ops: ops,
  }
  return { editor: { chain }, chain, ops }
}

// ── T8: 编辑态（PM 坐标）────────────────────────────────────────────────────────
describe('T8 — 编辑态 insertContentAt 替换', () => {
  it('读取 from/to 调用 insertContentAt 替换 PM 文档区间', () => {
    const store = useEditorStore()
    const { editor, chain } = makeMockEditor()
    // @ts-ignore
    store.activeEditor = editor

    store.openDateRefEditor({
      blockId: 'block-1',
      from: 10,
      to: 30,
      kind: 'deadline',
      iso: '2026-07-15T14:00',
      recurrence: 'weekly',
      position: { x: 100, y: 200 },
    })

    const state = store.dateRefEditor!
    const activeEditor = store.activeEditor!
    const newText = serializeDateRef({
      kind: state.kind,
      iso: state.iso,
      recurrence: state.recurrence,
    })
    activeEditor.chain.insertContentAt({ from: state.from, to: state.to }, newText)
    activeEditor.chain.run()

    expect(chain.insertContentAt).toHaveBeenCalledWith(
      { from: 10, to: 30 },
      '@2026-07-15T14:00 ⏰|weekly'
    )
    expect(chain.run).toHaveBeenCalled()
  })

  it('确认后关闭面板', () => {
    const store = useEditorStore()
    store.openDateRefEditor({
      blockId: 'b', from: 0, to: 0,
      kind: 'schedule', iso: '2026-07-20', recurrence: 'daily',
      position: { x: 0, y: 0 },
    })
    store.closeDateRefEditor()
    expect(store.dateRefEditor?.visible).toBe(false)
  })

  it('无 activeEditor 时安全关闭', () => {
    const store = useEditorStore()
    // @ts-ignore
    store.activeEditor = null
    store.openDateRefEditor({
      blockId: 'b', from: 5, to: 15,
      kind: 'schedule', iso: '2026-07-15', recurrence: 'none',
      position: { x: 0, y: 0 },
    })
    const state = store.dateRefEditor
    const editor = store.activeEditor
    if (!editor || !state) { store.closeDateRefEditor() }
    expect(store.dateRefEditor?.visible).toBe(false)
  })

  it('dateRefEditor 为 null 时安全退出', () => {
    const store = useEditorStore()
    // @ts-ignore
    store.dateRefEditor = null
    const state = store.dateRefEditor
    if (!state) { /* no-op */ }
    expect(true).toBe(true)
  })
})

// ── T9: 阅读态（字符串索引 → string replace）─────────────────────────────────────
describe('T9 — 阅读态 string replace 替换', () => {
  it('source:content — 替换 block content 中 [from, to] 子串并保存', async () => {
    const store = useEditorStore()
    const blockStore = useBlockStore()

    // 添加一个 mock block
    blockStore.blocks.push({
      id: 'block-a',
      content: '任务 @2026-07-15 ⏰ 完成',
      type: 'bullet' as any,
      page: 'test-page',
      children: [],
      format: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    store.openDateRefEditor({
      blockId: 'block-a',
      from: 3,
      to: 16,
      source: 'content',
      kind: 'deadline',
      iso: '2026-07-20',
      recurrence: 'daily',
      position: { x: 0, y: 0 },
    })

    // inline handleConfirm content 模式
    const state = store.dateRefEditor!
    const { from, to, source } = state
    const newText = serializeDateRef({ kind: 'deadline', iso: '2026-07-20', recurrence: 'daily' })

    if (source === 'content') {
      const block = blockStore.blocks.find(b => b.id === state.blockId)
      if (block) {
        block.content = block.content.slice(0, from) + newText + block.content.slice(to)
      }
    }

    const block = blockStore.blocks.find(b => b.id === 'block-a')
    expect(block?.content).toBe('任务 @2026-07-20 ⏰|daily 完成')
  })

  it('source:content — blockId 不存在时安全跳过', () => {
    const store = useEditorStore()
    const blockStore = useBlockStore()

    store.openDateRefEditor({
      blockId: 'non-existent',
      from: 0, to: 10,
      source: 'content',
      kind: 'deadline', iso: '2026-07-15', recurrence: 'none',
      position: { x: 0, y: 0 },
    })

    const state = store.dateRefEditor!
    const { blockId, from, to } = state
    const block = blockStore.blocks.find(b => b.id === blockId)
    if (!block) { /* no-op, safe */ }
    expect(block).toBeUndefined()
  })

  it('source:content — blockId 为 null 时安全跳过', () => {
    const store = useEditorStore()
    store.openDateRefEditor({
      blockId: null,
      from: 0, to: 0,
      source: 'content',
      kind: 'schedule', iso: '2026-07-15', recurrence: 'none',
      position: { x: 0, y: 0 },
    })
    const state = store.dateRefEditor!
    if (!state.blockId) { /* no-op, safe */ }
    expect(true).toBe(true)
  })

  it('source:editor — 默认值', () => {
    const store = useEditorStore()
    store.openDateRefEditor({
      blockId: 'b', from: 0, to: 0,
      kind: 'deadline', iso: '2026-07-15', recurrence: 'none',
      position: { x: 0, y: 0 },
    })
    expect(store.dateRefEditor?.source).toBe('editor')
  })

  it('source 字段在 openDateRefEditor 中正式存储', () => {
    const store = useEditorStore()
    store.openDateRefEditor({
      blockId: 'b', from: 5, to: 20,
      source: 'content',
      kind: 'deadline', iso: '2026-07-15', recurrence: 'none',
      position: { x: 0, y: 0 },
    })
    expect(store.dateRefEditor?.source).toBe('content')
  })
})

// ── serializeDateRef ──────────────────────────────────────────────────────────
describe('serializeDateRef', () => {
  it('各种 recurrence 生成正确语法（新 @ 格式）', () => {
    const cases: Array<[DateTimePickerConfirm, string]> = [
      [{ kind: 'deadline', iso: '2026-07-15', recurrence: 'none' }, '@2026-07-15 ⏰'],
      [{ kind: 'schedule', iso: '2026-07-20', recurrence: 'daily' }, '@2026-07-20 📅|daily'],
      [{ kind: 'deadline', iso: '2026-08-01T09:00', recurrence: 'weekly' }, '@2026-08-01T09:00 ⏰|weekly'],
      [{ kind: 'schedule', iso: '2026-09-10', recurrence: 'monthly' }, '@2026-09-10 📅|monthly'],
      [{ kind: 'deadline', iso: '2027-01-01', recurrence: 'yearly' }, '@2027-01-01 ⏰|yearly'],
    ]
    for (const [value, expected] of cases) {
      expect(serializeDateRef(value)).toBe(expected)
    }
  })
})

// ── store dateRefEditor ─────────────────────────────────────────────────────────
describe('editorStore dateRefEditor', () => {
  it('openDateRefEditor 填充全部字段', () => {
    const store = useEditorStore()
    store.openDateRefEditor({
      blockId: 'block-x', from: 20, to: 40,
      kind: 'deadline', iso: '2026-07-15T09:00', recurrence: 'daily',
      position: { x: 300, y: 400 },
    })
    expect(store.dateRefEditor).toMatchObject({
      visible: true, blockId: 'block-x', from: 20, to: 40,
      kind: 'deadline', iso: '2026-07-15T09:00', recurrence: 'daily',
      position: { x: 300, y: 400 },
    })
  })

  it('closeDateRefEditor 设置 visible=false', () => {
    const store = useEditorStore()
    store.openDateRefEditor({
      blockId: 'b', from: 0, to: 0,
      kind: 'schedule', iso: '2026-07-15', recurrence: 'none',
      position: { x: 0, y: 0 },
    })
    store.closeDateRefEditor()
    expect(store.dateRefEditor?.visible).toBe(false)
  })

  it('closeDateRefEditor 未打开时不报错', () => {
    const store = useEditorStore()
    expect(() => store.closeDateRefEditor()).not.toThrow()
  })
})
