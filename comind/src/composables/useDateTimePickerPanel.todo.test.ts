/**
 * 自动 Todo 行为测试（/schedule、/deadline → block 变 todo 任务）
 *
 * 行为约定：
 * 1. 插入 schedule / deadline 类型的 dateRef 时，若 block 尚无 status，自动补 Todo
 * 2. block 已有 status（Done/Doing 等）时不降级、不重复设置
 * 3. 删除 dateRef（更新 content）不会反向清除 status —— 此约束通过"不设置删除逻辑"保证，
 *    本文件仅测试"添加"方向的自动 Todo，反向清除不在 handleConfirm 中实现
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── 共享可变状态（供 handleConfirm 读写） ──────────────────────────────────
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

  const deleteProperty = vi.fn((blockId: string, key: string) => {
    const arr = propsByBlock.get(blockId) ?? []
    propsByBlock.set(
      blockId,
      arr.filter((p) => p.key !== key)
    )
    return Promise.resolve()
  })

  const client = { getProperties, setProperty, deleteProperty }
  return { propsByBlock, client, getProperties, setProperty, deleteProperty }
})

// ── 共享可变状态（供 handleConfirm 读写 editor / block store） ─────────────
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
  updateBlockContent: vi.fn(),
}

// ── Mock 依赖 ─────────────────────────────────────────────────────────────
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
import { usePropertyStore } from '../stores/property'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  hoisted.propsByBlock.clear()
  editorState.dateRefEditor = null
  editorState.activeEditor = null
  blockState.blocks = []
})

describe('handleConfirm — 自动标记 Todo', () => {
  it('content 模式：插入 schedule dateRef，无 status → 自动补 Todo', async () => {
    const panel = useDateTimePickerPanel()

    blockState.blocks = [{ id: 'b1', content: '买牛奶', type: 'bullet' }]
    editorState.dateRefEditor = {
      visible: true,
      blockId: 'b1',
      from: 3,
      to: 3,
      source: 'content',
      kind: 'schedule',
      iso: '2026-07-20',
      recurrence: 'none',
      position: { x: 0, y: 0 },
    }

    await panel.handleConfirm({ kind: 'schedule', iso: '2026-07-20', recurrence: 'none' })

    // dateRef 已写入 content
    expect(blockState.updateBlockContent).toHaveBeenCalledTimes(1)
    expect(blockState.updateBlockContent).toHaveBeenCalledWith('b1', '买牛奶@2026-07-20 📅')

    // 自动补 Todo
    const todoCall = hoisted.setProperty.mock.calls.find((c) => c[0] === 'b1' && c[1] === 'status')
    expect(todoCall).toBeDefined()
    expect(todoCall![2]).toBe('Todo')
  })

  it('content 模式：插入 deadline dateRef，无 status → 自动补 Todo', async () => {
    const panel = useDateTimePickerPanel()

    blockState.blocks = [{ id: 'b2', content: '交报告', type: 'bullet' }]
    editorState.dateRefEditor = {
      visible: true,
      blockId: 'b2',
      from: 3,
      to: 3,
      source: 'content',
      kind: 'deadline',
      iso: '2026-07-25',
      recurrence: 'none',
      position: { x: 0, y: 0 },
    }

    await panel.handleConfirm({ kind: 'deadline', iso: '2026-07-25', recurrence: 'none' })

    expect(blockState.updateBlockContent).toHaveBeenCalledWith('b2', '交报告@2026-07-25 ⏰')
    const todoCall = hoisted.setProperty.mock.calls.find((c) => c[0] === 'b2' && c[1] === 'status')
    expect(todoCall).toBeDefined()
    expect(todoCall![2]).toBe('Todo')
  })

  it('已有 status（如 Done）时不降级为 Todo', async () => {
    const panel = useDateTimePickerPanel()
    const propertyStore = usePropertyStore()

    // 先通过 store 设置 status=Done（会写回 propsByBlock 并刷新内存）
    await propertyStore.setProperty('b3', 'status', 'Done', 'string')
    // 仅关心本次 handleConfirm 是否"补" Todo
    hoisted.setProperty.mockClear()

    blockState.blocks = [{ id: 'b3', content: '已完成的任务', type: 'bullet' }]
    editorState.dateRefEditor = {
      visible: true,
      blockId: 'b3',
      from: 5,
      to: 5,
      source: 'content',
      kind: 'schedule',
      iso: '2026-07-20',
      recurrence: 'none',
      position: { x: 0, y: 0 },
    }

    await panel.handleConfirm({ kind: 'schedule', iso: '2026-07-20', recurrence: 'none' })

    expect(blockState.updateBlockContent).toHaveBeenCalledTimes(1)
    // 不应再调用 setProperty('status', 'Todo')
    const todoCall = hoisted.setProperty.mock.calls.find((c) => c[0] === 'b3' && c[1] === 'status')
    expect(todoCall).toBeUndefined()
  })

  it('editor 模式：插入 schedule dateRef，无 status → 自动补 Todo', async () => {
    const panel = useDateTimePickerPanel()

    const chainable: any = {
      deleteRange: () => chainable,
      insertContent: () => chainable,
      insertContentAt: () => chainable,
      run: vi.fn(),
    }
    const chainMock = vi.fn(() => chainable)
    editorState.activeEditor = {
      state: {
        doc: {
          content: { size: 20 },
          textBetween: () => '@',
          descendants: () => {},
        },
        selection: { from: 5 },
      },
      chain: chainMock,
    }
    editorState.dateRefEditor = {
      visible: true,
      blockId: 'b4',
      from: 3,
      to: 5,
      source: 'editor',
      kind: 'schedule',
      iso: '2026-07-20',
      recurrence: 'none',
      position: { x: 0, y: 0 },
    }

    await panel.handleConfirm({ kind: 'schedule', iso: '2026-07-20', recurrence: 'none' })

    expect(chainMock).toHaveBeenCalled()
    const todoCall = hoisted.setProperty.mock.calls.find((c) => c[0] === 'b4' && c[1] === 'status')
    expect(todoCall).toBeDefined()
    expect(todoCall![2]).toBe('Todo')
  })

  it('blockId 缺失时不设置 status', async () => {
    const panel = useDateTimePickerPanel()

    blockState.blocks = [{ id: 'b5', content: '普通块', type: 'bullet' }]
    editorState.dateRefEditor = {
      visible: true,
      blockId: null,
      from: 4,
      to: 4,
      source: 'content',
      kind: 'schedule',
      iso: '2026-07-20',
      recurrence: 'none',
      position: { x: 0, y: 0 },
    }

    await panel.handleConfirm({ kind: 'schedule', iso: '2026-07-20', recurrence: 'none' })

    expect(hoisted.setProperty).not.toHaveBeenCalled()
  })
})
