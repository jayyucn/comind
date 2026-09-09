/**
 * padDateRefUnit 接入 handleConfirm 的集成测试
 *
 * 需求：date-ref/schedule/deadline 写入 block 时，单元两侧自动补空格
 * （文字/中文等非空白邻接 → 补空格；行尾 → 补尾随空格；已空白不重复补），
 * 防与邻接文字粘连成 `⏰s`。
 *
 * editor 模式用真实 @tiptap/core Editor（真实 PM doc，from/to 为 PM 位置，
 * 经 descendants 动态计算，勿手工数偏移）；content 模式用真实 block content
 * 字符串（from/to 为 JS 字符串索引，经 indexOf 动态计算）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { Editor } from '@tiptap/core'
import type { Editor as EditorType } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'

// ── 共享可变状态（供 handleConfirm 读写 editor / block store / client） ──────
const hoisted = vi.hoisted(() => {
  const propsByBlock = new Map<string, any[]>()
  const getProperties = vi.fn((blockId: string) =>
    Promise.resolve(propsByBlock.get(blockId) ?? [])
  )
  const setProperty = vi.fn((blockId: string, key: string, valueStr: string, type: string) => {
    const id = `${blockId}:${key}`
    const prop = {
      id,
      block_id: blockId,
      key,
      value: valueStr,
      type,
      sort_order: 0,
      is_hidden: 0,
      is_deleted: 0,
      schema_version: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    const arr = propsByBlock.get(blockId) ?? []
    const idx = arr.findIndex((p) => p.key === key)
    if (idx >= 0) arr[idx] = prop
    else arr.push(prop)
    propsByBlock.set(blockId, arr)
    return Promise.resolve(prop)
  })
  const deleteProperty = vi.fn(() => Promise.resolve())
  const client = { getProperties, setProperty, deleteProperty }
  return { propsByBlock, client, getProperties, setProperty, deleteProperty }
})

const editorState: any = {
  dateRefEditor: null as any,
  activeEditor: null as any,
  openDateRefEditor: vi.fn(function (payload: any) {
    editorState.dateRefEditor = { visible: true, ...payload }
  }),
  closeDateRefEditor: vi.fn(function () {
    editorState.dateRefEditor = null
  }),
}

const blockState: any = {
  blocks: [] as any[],
  updateBlockContent: vi.fn((blockId: string, content: string) => {
    const b = blockState.blocks.find((x: any) => x.id === blockId)
    if (b) b.content = content
  }),
}

vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(() => Promise.resolve(hoisted.client)),
}))
vi.mock('../stores/editor', () => ({
  useEditorStore: vi.fn(() => editorState),
}))
vi.mock('../stores/blocks', () => ({
  useBlockStore: vi.fn(() => blockState),
}))

import { useDateTimePickerPanel } from './useDateTimePickerPanel'

/** content 模式：在字符串中定位旧单元 [from, to)（JS 索引） */
function contentRange(content: string, syntax: string) {
  const from = content.indexOf(syntax)
  if (from < 0) throw new Error(`syntax not found in content: ${syntax}`)
  return { from, to: from + syntax.length }
}

/** editor 模式：在真实 PM doc 中定位旧单元 [from, to)（PM 位置） */
function docRange(doc: EditorType['state']['doc'], syntax: string) {
  let from = -1
  // 注意：descendants 回调返回 false = 剪枝（不再进入该节点子级），
  // 非 text 节点须 return undefined 放行，才能遍历到文本层
  doc.descendants((node, pos) => {
    if (node.isText) {
      const idx = node.text.indexOf(syntax)
      if (idx >= 0) from = pos + idx
    }
  })
  if (from < 0) throw new Error(`syntax not found in doc: ${syntax}`)
  return { from, to: from + syntax.length }
}

function makeRealEditor(content: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text],
    content,
  })
  return {
    editor,
    teardown: () => {
      editor.destroy()
      element.remove()
    },
  }
}

function openEditorPanel(partial: Record<string, unknown>) {
  editorState.dateRefEditor = {
    visible: true,
    blockId: 'b-editor',
    from: 0,
    to: 0,
    source: 'editor',
    kind: 'schedule',
    iso: '2026-07-15',
    recurrence: 'none',
    position: { x: 0, y: 0 },
    ...partial,
  }
}

let real: { editor: EditorType; teardown: () => void } | null = null

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  hoisted.propsByBlock.clear()
  editorState.dateRefEditor = null
  editorState.activeEditor = null
  blockState.blocks = []
})

afterEach(() => {
  real?.teardown()
  real = null
})

const NEW_SCHEDULE = { kind: 'schedule' as const, iso: '2026-07-20', recurrence: 'none' as const, leadMinutes: 0 }

describe('handleConfirm — content 模式两侧补空格', () => {
  it('行中替换（两侧已有空格）：不重复补', async () => {
    const panel = useDateTimePickerPanel()
    blockState.blocks = [{ id: 'b1', content: '任务 @2026-07-15 ⏰ 完成', type: 'bullet' }]
    const { from, to } = contentRange('任务 @2026-07-15 ⏰ 完成', '@2026-07-15 ⏰')
    editorState.dateRefEditor = {
      visible: true, blockId: 'b1', from, to, source: 'content',
      kind: 'deadline', iso: '2026-07-20', recurrence: 'daily', position: { x: 0, y: 0 },
    }
    await panel.handleConfirm({ kind: 'deadline', iso: '2026-07-20', recurrence: 'daily', leadMinutes: 0 })
    expect(blockState.updateBlockContent).toHaveBeenCalledWith('b1', '任务 @2026-07-20 ⏰|daily 完成')
  })

  it('行尾编辑（原无尾随空格）：左侧已有空格不动 + 补尾随空格', async () => {
    const panel = useDateTimePickerPanel()
    blockState.blocks = [{ id: 'b1', content: 'only @2026-07-15 📅', type: 'bullet' }]
    const { from, to } = contentRange('only @2026-07-15 📅', '@2026-07-15 📅')
    editorState.dateRefEditor = {
      visible: true, blockId: 'b1', from, to, source: 'content',
      kind: 'schedule', iso: '2026-07-20', recurrence: 'daily', position: { x: 0, y: 0 },
    }
    await panel.handleConfirm({ kind: 'schedule', iso: '2026-07-20', recurrence: 'daily', leadMinutes: 0 })
    expect(blockState.updateBlockContent).toHaveBeenCalledWith('b1', 'only @2026-07-20 📅|daily ')
  })

  it('文字后插入（行尾）：前后都补', async () => {
    const panel = useDateTimePickerPanel()
    blockState.blocks = [{ id: 'b1', content: '买牛奶', type: 'bullet' }]
    editorState.dateRefEditor = {
      visible: true, blockId: 'b1', from: 3, to: 3, source: 'content',
      kind: 'schedule', iso: '2026-07-20', recurrence: 'none', position: { x: 0, y: 0 },
    }
    await panel.handleConfirm({ kind: 'schedule', iso: '2026-07-20', recurrence: 'none', leadMinutes: 0 })
    expect(blockState.updateBlockContent).toHaveBeenCalledWith('b1', '买牛奶 @2026-07-20 📅 ')
  })

  it('块首插入（无左邻）：仅补右', async () => {
    const panel = useDateTimePickerPanel()
    blockState.blocks = [{ id: 'b1', content: 'x', type: 'bullet' }]
    editorState.dateRefEditor = {
      visible: true, blockId: 'b1', from: 0, to: 0, source: 'content',
      kind: 'schedule', iso: '2026-07-20', recurrence: 'none', position: { x: 0, y: 0 },
    }
    await panel.handleConfirm({ kind: 'schedule', iso: '2026-07-20', recurrence: 'none', leadMinutes: 0 })
    expect(blockState.updateBlockContent).toHaveBeenCalledWith('b1', '@2026-07-20 📅 x')
  })

  it('换行后行首编辑（左邻为 \\n）：补左空格，防单行渲染粘连', async () => {
    const panel = useDateTimePickerPanel()
    blockState.blocks = [{ id: 'b1', content: '交报告\n@2026-07-15 📅', type: 'bullet' }]
    const { from, to } = contentRange('交报告\n@2026-07-15 📅', '@2026-07-15 📅')
    editorState.dateRefEditor = {
      visible: true, blockId: 'b1', from, to, source: 'content',
      kind: 'schedule', iso: '2026-07-20', recurrence: 'none', position: { x: 0, y: 0 },
    }
    await panel.handleConfirm({ kind: 'schedule', iso: '2026-07-20', recurrence: 'none', leadMinutes: 0 })
    expect(blockState.updateBlockContent).toHaveBeenCalledWith('b1', '交报告\n @2026-07-20 📅 ')
  })
})

describe('handleConfirm — editor 模式两侧补空格（真实 PM doc）', () => {
  it('行尾替换旧单元：补尾随空格（往返保真后持久化不丢）', async () => {
    const panel = useDateTimePickerPanel()
    real = makeRealEditor('only @2026-07-15 📅')
    editorState.activeEditor = real.editor
    const { from, to } = docRange(real.editor.state.doc, '@2026-07-15 📅')
    // 应用里点击 date-ref 会先把光标落在单元上，handleConfirm 的 deleteRange+insertContent 就地替换
    real.editor.commands.setTextSelection({ from, to })
    openEditorPanel({ blockId: 'b1', from, to })
    await panel.handleConfirm(NEW_SCHEDULE)
    expect(real.editor.getText()).toBe('only @2026-07-20 📅 ')
  })

  it('句中替换（左右邻均为文字）：两侧都补', async () => {
    const panel = useDateTimePickerPanel()
    real = makeRealEditor('abc@2026-07-15 📅def')
    editorState.activeEditor = real.editor
    const { from, to } = docRange(real.editor.state.doc, '@2026-07-15 📅')
    real.editor.commands.setTextSelection({ from, to })
    openEditorPanel({ blockId: 'b1', from, to })
    await panel.handleConfirm(NEW_SCHEDULE)
    expect(real.editor.getText()).toBe('abc @2026-07-20 📅 def')
  })

  it('行中替换（两侧已有空格）：不重复补', async () => {
    const panel = useDateTimePickerPanel()
    real = makeRealEditor('任务 @2026-07-15 ⏰ 完成')
    editorState.activeEditor = real.editor
    const { from, to } = docRange(real.editor.state.doc, '@2026-07-15 ⏰')
    real.editor.commands.setTextSelection({ from, to })
    openEditorPanel({ blockId: 'b1', from, to })
    await panel.handleConfirm({ kind: 'deadline', iso: '2026-07-20', recurrence: 'daily', leadMinutes: 0 })
    expect(real.editor.getText()).toBe('任务 @2026-07-20 ⏰|daily 完成')
  })

  it('光标处纯插入（无旧单元可删）：按左右邻补空格', async () => {
    const panel = useDateTimePickerPanel()
    real = makeRealEditor('abc')
    // 光标置于 c 后（文档末尾）
    real.editor.commands.setTextSelection(real.editor.state.doc.content.size)
    editorState.activeEditor = real.editor
    const size = real.editor.state.doc.content.size
    openEditorPanel({ blockId: 'b1', from: size, to: size })
    await panel.handleConfirm(NEW_SCHEDULE)
    expect(real.editor.getText()).toBe('abc @2026-07-20 📅 ')
  })

  it('跨段落段首编辑（from>0 但 textBetween 跨段返回空）：按换行补左空格', async () => {
    const panel = useDateTimePickerPanel()
    // 两个段落：第一段 '交报告'，第二段 date-ref。段首的 textBetween(from-1,from) 跨段返回 ''
    real = makeRealEditor('<p>交报告</p><p>@2026-07-15 📅</p>')
    editorState.activeEditor = real.editor
    const { from, to } = docRange(real.editor.state.doc, '@2026-07-15 📅')
    real.editor.commands.setTextSelection({ from, to })
    openEditorPanel({ blockId: 'b1', from, to })
    await panel.handleConfirm(NEW_SCHEDULE)
    // 段首（换行后）补左空格，避免单行预览里 '交报告@2026-07-20...' 粘连。
    // 用 toContain 而非精确匹配：getText 跨段落返回 '\n\n'（TipTap 块分隔），与补空格无关。
    expect(real.editor.getText()).toContain(' @2026-07-20 📅 ')
  })
})
